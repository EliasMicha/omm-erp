// Edge Function: whatsapp-webhook
// Recibe eventos de WhatsApp Cloud API, los procesa con el agente y responde.
// Deploy: supabase functions deploy whatsapp-webhook --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { sendText, verifyWebhook, verifySignature, downloadMedia, markAsRead, phoneVariants, toSendPhone, last10 } from './whatsapp.ts';
import { handleClienteMessage } from './clientes.ts';
import { intentarReporte } from './reportes.ts';
import { intentarSupervisor, entregarPendientes } from './supervisor.ts';
import { intentarAprobacion } from './aprobaciones.ts';
import { empleadoDeTelefono } from './reportesComun.ts';
import { logWa, applyStatuses, waIdFrom } from './log.ts';
import { runAgent } from './agent.ts';
import { isDelegationCoach } from './delegation.ts';
import { sesionDe } from './sesion.ts';
import type { ClaudeMessage, ContentBlock } from './types.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const HISTORY_LIMIT = 20; // últimos N mensajes que mandamos a Claude

// Meta manda números mexicanos con un '1' extra después del 52 (ej. 5215555011014).
// Para RESPONDER, Meta exige el formato sin ese '1' (ej. 525555011014).
// Esta función normaliza el número antes de mandarlo.
function toReplyPhone(fromRaw: string): string {
  // fromRaw viene sin '+', ej. "5215555011014"
  if (fromRaw.startsWith('521') && fromRaw.length === 13) {
    return '52' + fromRaw.slice(3); // "525555011014"
  }
  return fromRaw;
}

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
  EdgeRuntime.waitUntil(handleEvent(payload).catch(e => console.error('handleEvent error:', e)));
  return new Response('ok', { status: 200 });
});

async function handleEvent(payload: any) {
  // Estructura: entry[].changes[].value.messages[]
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const messages = value?.messages ?? [];
      for (const msg of messages) {
        try {
          await processMessage(msg, value);
        } catch (e) {
          console.error('processMessage error:', e);
        }
      }
      if (value?.statuses?.length) await applyStatuses(supabase, value.statuses);
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
    .in('phone_e164', phoneVariants(fromPhone))
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  // 0a. Lo que no se le pudo mandar completo porque su ventana de 24 h estaba
  //     cerrada (le llegó sólo la plantilla): al contestar, se le entrega.
  try { if (await entregarPendientes(supabase, msg) === 'listo') return; }
  catch (e) { console.error('entregarPendientes:', e); }

  // 0b. Elias contestando "sí"/"no" a algo que pidió un cliente (estado de cuenta).
  try { if (await intentarAprobacion(supabase, msg) === 'listo') return; }
  catch (e) { console.error('intentarAprobacion:', e); }

  // 0c. El jefe de cuadrilla contestando qué actividades subir y con qué fecha.
  //     Si tiene asistente (modo coordinador), lo decide el agente con
  //     decidir_propuestas: entiende "la 2 y la 4 el jueves, y recuérdame…".
  if (!contact) {
    try { if (await intentarSupervisor(supabase, msg) === 'listo') return; }
    catch (e) { console.error('intentarSupervisor:', e); }
  }

  // 0d. ¿Tiene un reporte de obra pendiente? (instaladores a los que el bot les
  //     pidió su reporte del día). Va antes que el agente y que clientes.
  let rep: 'no' | 'listo' | 'agente' = 'no';
  try { rep = await intentarReporte(supabase, msg, !!contact); }
  catch (e) { console.error('intentarReporte:', e); }
  if (rep === 'listo') return;

  if (!contact) {
    // Alguien del equipo sin asistente (un instalador fuera de su reporte): no es
    // cliente. Se le contesta corto en vez de pedirle nombre y dirección.
    let emp: any = null;
    try { emp = await empleadoDeTelefono(supabase, msg.from); } catch (_) { /* sigue como cliente */ }
    if (emp) { await respuestaEquipo(msg, emp); return; }
    // No es del equipo → flujo de clientes (tickets de mantenimiento)
    await handleClienteMessage(supabase, msg);
    return;
  }

  if (rep !== 'agente') {
    await logWa(supabase, {
      direction: 'in', phone_e164: fromPhone, wa_message_id: waMessageId, kind: msg.type,
      body: msg.text?.body || msg.image?.caption || msg.document?.caption || `[${msg.type}]`,
      sender_type: 'equipo', agent_contact_id: contact.id,
    });
    // 2. Marcar como leído
    try { await markAsRead(waMessageId); } catch (_) { /* no crítico */ }
  }

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
  const userBlocks = await buildContentBlocks(msg, conversation.id, contact);
  if (userBlocks.length === 0) {
    await sendText(toReplyPhone(msg.from), 'Recibí tu mensaje pero no pude procesarlo. ¿Puedes mandarlo como texto?');
    return;
  }

  // 5. Cargar historial reciente (para contexto)
  const history = await loadHistory(conversation.id, isDelegationCoach(contact));

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
    await sendText(toReplyPhone(msg.from), 'Tuve un error procesando tu mensaje. Por favor vuelve a intentarlo.');
    return;
  }

  // 7. Persistir mensajes nuevos
  const persistedAt = Date.now();
  const rowsToInsert = result.allNewMessages.map((m, i) => ({
    conversation_id: conversation!.id,
    role: m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result')
      ? 'tool'
      : m.role,
    content: m.content,
    created_at: new Date(persistedAt + i).toISOString(),
    wa_message_id: i === 0 ? waMessageId : null,
    tokens_input: i === 0 ? result.totalInputTokens : null,
    tokens_output: i === result.allNewMessages.length - 1 ? result.totalOutputTokens : null,
  }));
  const { error: historyError } = await supabase.from('agent_messages').insert(rowsToInsert);
  if (historyError) throw historyError;

  await supabase
    .from('agent_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversation.id);

  // 8. Enviar respuesta por WhatsApp
  if (result.finalText) {
    const to = toReplyPhone(msg.from);
    try {
      const resp = await sendText(to, result.finalText);
      await logWa(supabase, { direction: 'out', phone_e164: '+' + to, wa_message_id: waIdFrom(resp), kind: 'text', body: result.finalText, status: 'enviado', sender_type: 'equipo', agent_contact_id: contact.id });
    } catch (e) {
      await logWa(supabase, { direction: 'out', phone_e164: '+' + to, kind: 'text', body: result.finalText, status: 'fallido', error: String(e), sender_type: 'equipo', agent_contact_id: contact.id });
      throw e;
    }
  }
}

async function buildContentBlocks(msg: any, conversationId: string, contact: any): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];

  switch (msg.type) {
    case 'text':
      blocks.push({ type: 'text', text: msg.text.body });
      break;

    case 'image': {
      const { bytes, mimeType } = await downloadMedia(msg.image.id);
      // Claude acepta hasta ~5 MB por imagen y solo jpeg/png/gif/webp.
      if (bytes.length > 4_500_000 || !/^image\/(jpeg|png|gif|webp)$/.test(mimeType)) {
        blocks.push({ type: 'text', text: `[Foto que no pude abrir (${mimeType}, ${(bytes.length / 1e6).toFixed(1)} MB). Pídele que la mande más chica o como captura.]` });
      } else {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: toBase64(bytes) } });
      }
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
    case 'voice': {
      const media = msg.audio || msg.voice;
      const { bytes, mimeType } = await downloadMedia(media.id);
      await storeDocument(conversationId, 'inbound', inferKind(`wa-${msg.id}.ogg`, mimeType), bytes, mimeType, `wa-${msg.id}.ogg`);
      const t = await transcribirAudio(bytes, mimeType, contact);
      if (t.ok) {
        blocks.push({ type: 'text', text: `[Nota de voz transcrita]: ${t.texto}` });
        // En la bitácora (y en la vista de chats) se lee lo que dijo, no "[audio]".
        await supabase.from('whatsapp_messages').update({ body: '🎤 ' + t.texto }).eq('wa_message_id', msg.id);
      } else {
        blocks.push({ type: 'text', text: `[Nota de voz que no se pudo transcribir: ${t.error}. Pídele que lo mande por escrito.]` });
      }
      break;
    }

    default:
      blocks.push({ type: 'text', text: `[Mensaje tipo ${msg.type} no soportado aún]` });
  }

  return blocks;
}

async function loadHistory(conversationId: string, coach = false): Promise<ClaudeMessage[]> {
  const { data, error } = await supabase
    .from('agent_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    // Antes 100 en modo delegación: con tanto historial de "solo puedo leer" el modelo
    // seguía negándose aunque ya tuviera las herramientas.
    .limit(coach ? 30 : HISTORY_LIMIT);

  if (error) throw error;
  if (!data) return [];
  const limpio = recortarInicio(data.slice().reverse()).reverse();
  data.length = 0; data.push(...limpio);
  // Reconsultamos ERP en el piloto. No reenviar pares de herramientas cortados
  // por el límite ni adjuntos grandes de encargos anteriores.
  if (coach) return data.reverse().flatMap((m: any) => {
    if (m.role !== 'user' && m.role !== 'assistant') return [];
    const text = typeof m.content === 'string' ? m.content : m.content
      .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    return text ? [{ role: m.role, content: text }] : [];
  });
  return data
    .reverse()
    .map((m: any) => ({
      // 'tool' en BD se convierte a 'user' para Claude (así lo espera la API)
      role: m.role === 'tool' ? 'user' : m.role,
      content: m.content,
    }));
}

// Notas de voz → texto. La llave de OpenAI vive en Vercel (api/chatbot.ts?action=transcribir);
// se llama con el JWT de la persona, así que sin usuario del ERP ligado no hay transcripción.
async function transcribirAudio(bytes: Uint8Array, mime: string, contact: any): Promise<{ ok: true; texto: string } | { ok: false; error: string }> {
  try {
    const ses = await sesionDe(supabase, contact);
    if (!ses) return { ok: false, error: 'tu número no está ligado a un usuario del ERP' };
    const r = await fetch('https://omm-erp.vercel.app/api/chatbot?action=transcribir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ses.token}` },
      body: JSON.stringify({ audio_base64: toBase64(bytes), mime }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || !b?.ok) return { ok: false, error: b?.error || `transcripción ${r.status}` };
    const texto = String(b.texto || '').trim();
    return texto ? { ok: true, texto } : { ok: false, error: 'el audio venía vacío o sin voz' };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 150) };
  }
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

// Empleado sin asistente que escribe fuera de su reporte del día. Queda en la
// bitácora (Elias lo ve en /whatsapp) y se le contesta máximo una vez cada 12 h.
async function respuestaEquipo(msg: any, emp: any) {
  await logWa(supabase, {
    direction: 'in', phone_e164: '+' + msg.from, wa_message_id: msg.id, kind: msg.type,
    body: msg.text?.body || msg.image?.caption || msg.document?.caption || `[${msg.type}]`, sender_type: 'equipo',
  });
  try { await markAsRead(msg.id); } catch (_) { /* no crítico */ }
  const desde = new Date(Date.now() - 12 * 3600e3).toISOString();
  const { data: ya } = await supabase.from('whatsapp_messages').select('id').eq('direction', 'out')
    .ilike('phone_e164', '%' + last10(msg.from)).like('body', 'Hola%este número es el asistente%').gte('created_at', desde).limit(1);
  if (ya?.length) return;
  const { data: al } = await supabase.from('reporte_diario_personas').select('alias').eq('employee_id', emp.id).maybeSingle();
  const pn = String(emp.nombre || '').split(/\s+/)[0] || '';
  const nombre = (al?.alias || '').trim() || (pn.charAt(0) + pn.slice(1).toLowerCase());
  const texto = `Hola ${nombre}, este número es el asistente de OMM. Por aquí te pido tu reporte diario de obra a las 6 pm. Para cualquier otra cosa, avísale a tu jefe directo.`;
  const to = toSendPhone(msg.from);
  try {
    const resp = await sendText(to, texto);
    await logWa(supabase, { direction: 'out', phone_e164: '+' + to, wa_message_id: waIdFrom(resp), kind: 'text', body: texto, status: 'enviado', sender_type: 'equipo' });
  } catch (e) {
    await logWa(supabase, { direction: 'out', phone_e164: '+' + to, kind: 'text', body: texto, status: 'fallido', error: String(e).slice(0, 300), sender_type: 'equipo' });
  }
}

// El historial se corta por número de mensajes y puede empezar a media plática:
// con un resultado de herramienta huérfano o con un mensaje del asistente (los
// automáticos del cron se guardan así). La API pide empezar con un mensaje del
// usuario que no sea un tool_result: se descarta lo que quede antes.
function recortarInicio(cronologico: any[]): any[] {
  const esToolResult = (m: any) => m.role === 'tool' || (Array.isArray(m.content) && m.content.some((b: any) => b?.type === 'tool_result'));
  let i = 0;
  while (i < cronologico.length && (cronologico[i].role !== 'user' || esToolResult(cronologico[i]))) i++;
  // Los automáticos del asistente que quedaron antes del corte se conservan como
  // contexto, en un solo mensaje del usuario, para que "la 3" siga teniendo sentido.
  const previos = cronologico.slice(0, i).filter((m: any) => m.role === 'assistant')
    .map((m: any) => (Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content || '') }]).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n'))
    .filter((t: string) => t.startsWith('[Mensaje automático'));
  const resto = cronologico.slice(i);
  if (!previos.length) return resto;
  return [{ role: 'user', content: [{ type: 'text', text: '[Contexto: mensajes automáticos que el asistente me mandó antes]\n' + previos.join('\n\n') }] }, ...resto];
}
