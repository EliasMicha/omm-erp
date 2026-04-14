// Edge Function: whatsapp-webhook
// Recibe eventos de WhatsApp Cloud API, los procesa con el agente y responde.
// Deploy: supabase functions deploy whatsapp-webhook --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { sendText, verifyWebhook, verifySignature, downloadMedia, markAsRead } from '../_shared/whatsapp.ts';
import { runAgent } from '../_shared/agent.ts';
import type { ClaudeMessage, ContentBlock } from '../_shared/types.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const HISTORY_LIMIT = 20; // últimos N mensajes que mandamos a Claude

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // --- GET: handshake de verificación de Meta ---
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const result = verifyWebhook(mode, token, challenge);
    return result
      ? new Response(result, { status: 200 })
      : new Response('Forbidden', { status: 403 });
  }

  // --- POST: evento entrante ---
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();

  // Verificar firma HMAC
  const signature = req.headers.get('x-hub-signature-256');
  const valid = await verifySignature(rawBody, signature);
  if (!valid) {
    console.warn('Invalid signature');
    return new Response('Forbidden', { status: 403 });
  }

  // Responder rápido a Meta (<5s) y procesar en background
  const payload = JSON.parse(rawBody);
  queueMicrotask(() => handleEvent(payload).catch(e => console.error('handleEvent error:', e)));
  return new Response('ok', { status: 200 });
});

async function handleEvent(payload: any) {
  // Estructura: entry[].changes[].value.messages[]
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const messages = value?.messages ?? [];
      for (const msg of messages) {
        await processMessage(msg, value);
      }
    }
  }
}

async function processMessage(msg: any, value: any) {
  const fromPhone = '+' + msg.from; // Meta manda sin '+'
  const waMessageId = msg.id;

  // 1. Verificar contacto autorizado
  const { data: contact } = await supabase
    .from('agent_contacts')
    .select('*')
    .eq('phone_e164', fromPhone)
    .eq('is_active', true)
    .maybeSingle();

  if (!contact) {
    console.log(`Unauthorized contact: ${fromPhone}`);
    // Opcional: responder con mensaje de rechazo suave
    await sendText(msg.from, 'Este número no está autorizado para usar el asistente de OMM. Contacta a Elias si necesitas acceso.');
    return;
  }

  // 2. Marcar como leído
  try { await markAsRead(waMessageId); } catch (_) { /* no crítico */ }

  // 3. Obtener/crear conversación activa
  let { data: conversation } = await supabase
    .from('agent_conversations')
    .select('*')
    .eq('contact_id', contact.id)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) {
    const { data: newConv, error } = await supabase
      .from('agent_conversations')
      .insert({ contact_id: contact.id })
      .select()
      .single();
    if (error) throw error;
    conversation = newConv;
  }

  // 4. Construir bloques de contenido según tipo de mensaje
  const userBlocks = await buildContentBlocks(msg, conversation.id);
  if (userBlocks.length === 0) {
    await sendText(msg.from, 'Recibí tu mensaje pero no pude procesarlo. ¿Puedes mandarlo como texto?');
    return;
  }

  // 5. Cargar historial reciente (para contexto)
  const history = await loadHistory(conversation.id);

  // 6. Correr el agente
  let result;
  try {
    result = await runAgent({
      contact,
      conversation,
      history,
      newUserMessage: userBlocks,
      supabase,
    });
  } catch (e) {
    console.error('Agent error:', e);
    await sendText(msg.from, '⚠️ Tuve un error procesando tu mensaje. Ya estoy notificando al equipo.');
    return;
  }

  // 7. Persistir mensajes nuevos
  const rowsToInsert = result.allNewMessages.map((m, i) => ({
    conversation_id: conversation!.id,
    role: m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result')
      ? 'tool'
      : m.role,
    content: m.content,
    wa_message_id: i === 0 ? waMessageId : null,
    tokens_input: i === 0 ? result.totalInputTokens : null,
    tokens_output: i === result.allNewMessages.length - 1 ? result.totalOutputTokens : null,
  }));
  await supabase.from('agent_messages').insert(rowsToInsert);

  await supabase
    .from('agent_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversation.id);

  // 8. Enviar respuesta por WhatsApp
  if (result.finalText) {
    await sendText(msg.from, result.finalText);
  }
}

async function buildContentBlocks(msg: any, conversationId: string): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];

  switch (msg.type) {
    case 'text':
      blocks.push({ type: 'text', text: msg.text.body });
      break;

    case 'image': {
      const { bytes, mimeType } = await downloadMedia(msg.image.id);
      const base64 = toBase64(bytes);
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } });
      if (msg.image.caption) blocks.push({ type: 'text', text: msg.image.caption });
      await storeDocument(conversationId, 'inbound', 'image', bytes, mimeType, `wa-${msg.id}.jpg`);
      break;
    }

    case 'document': {
      const { bytes, mimeType } = await downloadMedia(msg.document.id);
      const filename = msg.document.filename ?? `wa-${msg.id}`;
      await storeDocument(conversationId, 'inbound', inferKind(filename, mimeType), bytes, mimeType, filename);

      if (mimeType === 'application/pdf') {
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: toBase64(bytes) },
        });
      } else {
        // XML, txt, etc. — los mandamos como texto
        const text = new TextDecoder().decode(bytes);
        blocks.push({ type: 'text', text: `[Documento adjunto: ${filename}]\n\n${text.slice(0, 50000)}` });
      }
      if (msg.document.caption) blocks.push({ type: 'text', text: msg.document.caption });
      break;
    }

    case 'audio':
    case 'voice':
      blocks.push({ type: 'text', text: '[Usuario envió audio — transcripción aún no implementada]' });
      break;

    default:
      blocks.push({ type: 'text', text: `[Mensaje tipo ${msg.type} no soportado aún]` });
  }

  return blocks;
}

async function loadHistory(conversationId: string): Promise<ClaudeMessage[]> {
  const { data } = await supabase
    .from('agent_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  if (!data) return [];
  return data
    .reverse()
    .map((m: any) => ({
      // 'tool' en BD se convierte a 'user' para Claude (así lo espera la API)
      role: m.role === 'tool' ? 'user' : m.role,
      content: m.content,
    }));
}

async function storeDocument(
  conversationId: string,
  direction: 'inbound' | 'outbound',
  kind: string,
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
) {
  const path = `agent/${conversationId}/${Date.now()}-${filename}`;
  const { error: upErr } = await supabase.storage
    .from('agent-documents')
    .upload(path, bytes, { contentType: mimeType, upsert: false });
  if (upErr) { console.error('Storage upload error:', upErr); return; }

  await supabase.from('agent_documents').insert({
    conversation_id: conversationId,
    direction,
    kind,
    storage_path: path,
    mime_type: mimeType,
    size_bytes: bytes.length,
  });
}

function inferKind(filename: string, mime: string): string {
  const f = filename.toLowerCase();
  if (f.endsWith('.xml')) return 'xml_factura';
  if (f.includes('estado') || f.includes('cuenta')) return 'pdf_estado_cuenta';
  if (f.includes('csf')) return 'csf';
  if (f.includes('reporte')) return 'reporte_obra';
  if (mime === 'application/pdf') return 'pdf';
  return 'otro';
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
