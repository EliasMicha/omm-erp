// Mensajes de clientes (números que NO están en agent_contacts).
// Identifica al cliente por maintenance_contacts.phone_e164 (últimos 10 dígitos),
// levanta o actualiza un ticket en maintenance_tickets y contesta con el folio.
// Si el número no está registrado, contesta una sola vez al día y queda en la bitácora.

import { sendText, markAsRead, downloadMedia, last10, toSendPhone } from './whatsapp.ts';
import { logWa, waIdFrom } from './log.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const SISTEMAS = ['Audio', 'Redes', 'CCTV', 'Control de Acceso', 'Control de Iluminación', 'Lutron', 'Eléctrico'];
const CATEGORIAS = ['falla', 'mantenimiento_preventivo', 'solicitud_nueva', 'garantia', 'otro'];
const PRIORIDADES = ['baja', 'media', 'alta', 'urgente'];
const OPEN_STATUSES = ['abierto', 'en_progreso', 'esperando_cliente'];

interface Clasificacion {
  es_reporte: boolean;
  asunto: string;
  categoria: string;
  prioridad: string;
  sistemas: string[];
}

function extractText(msg: any): string {
  switch (msg.type) {
    case 'text': return msg.text?.body || '';
    case 'image': return msg.image?.caption || '';
    case 'video': return msg.video?.caption || '';
    case 'document': return msg.document?.caption || '';
    case 'button': return msg.button?.text || '';
    case 'interactive': return msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
    default: return '';
  }
}

function describeMedia(msg: any): string {
  switch (msg.type) {
    case 'image': return '[foto]';
    case 'video': return '[video]';
    case 'audio': case 'voice': return '[nota de voz]';
    case 'document': return `[documento ${msg.document?.filename || ''}]`.trim();
    case 'location': return `[ubicación ${msg.location?.latitude},${msg.location?.longitude}]`;
    default: return '';
  }
}

async function storeMedia(supabase: any, msg: any): Promise<string | null> {
  const media = msg.image || msg.video || msg.document || msg.audio;
  if (!media?.id) return null;
  try {
    const { bytes, mimeType } = await downloadMedia(media.id);
    const ext = (mimeType.split('/')[1] || 'bin').split(';')[0];
    const path = `whatsapp/${last10(msg.from)}/${Date.now()}-${msg.id}.${ext}`;
    const { error } = await supabase.storage.from('agent-documents').upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) { console.error('storeMedia:', error.message); return null; }
    return path;
  } catch (e) {
    console.error('storeMedia exc:', e);
    return null;
  }
}

async function clasificar(texto: string, propiedad: string): Promise<Clasificacion> {
  const fallback: Clasificacion = {
    es_reporte: true,
    asunto: (texto || 'Mensaje por WhatsApp').slice(0, 80),
    categoria: 'falla', prioridad: 'media', sistemas: [],
  };
  if (!ANTHROPIC_API_KEY || !texto.trim()) return fallback;
  const prompt = `Eres el triage de mantenimiento de OMM Technologies (instalaciones eléctricas, audio, redes, CCTV, control de acceso, control de iluminación Lutron) en CDMX.
Un cliente de la propiedad "${propiedad}" escribió por WhatsApp:
"""${texto.slice(0, 3000)}"""

Devuelve SOLO un JSON, sin markdown:
{"es_reporte": boolean, "asunto": string, "categoria": string, "prioridad": string, "sistemas": string[]}
- es_reporte: false si es solo saludo, agradecimiento, confirmación ("ok", "gracias", "sí a las 10") o plática sin solicitud. true si reporta falla, pide servicio, visita, cotización o cambio.
- asunto: máx 70 caracteres, en español, concreto (ej. "Bocinas de terraza sin sonido").
- categoria: una de ${CATEGORIAS.join(', ')}.
- prioridad: una de ${PRIORIDADES.join(', ')}. urgente = seguridad, sin luz/energía en toda la casa, acceso bloqueado, riesgo; alta = sistema principal caído; media = falla parcial; baja = ajuste o duda.
- sistemas: subconjunto de ${JSON.stringify(SISTEMAS)}.`;
  for (const model of ['claude-haiku-4-5', 'claude-sonnet-4-5']) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) { console.error('clasificar', model, res.status, await res.text()); continue; }
      const body = await res.json();
      const raw = (body.content || []).map((b: any) => b.text || '').join('');
      const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      return {
        es_reporte: json.es_reporte !== false,
        asunto: String(json.asunto || fallback.asunto).slice(0, 80),
        categoria: CATEGORIAS.includes(json.categoria) ? json.categoria : 'falla',
        prioridad: PRIORIDADES.includes(json.prioridad) ? json.prioridad : 'media',
        sistemas: Array.isArray(json.sistemas) ? json.sistemas.filter((s: string) => SISTEMAS.includes(s)) : [],
      };
    } catch (e) {
      console.error('clasificar exc', model, e);
    }
  }
  return fallback;
}

async function repliedRecently(supabase: any, phone: string, minutes: number): Promise<boolean> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { data } = await supabase.from('whatsapp_messages')
    .select('id').eq('direction', 'out').ilike('phone_e164', `%${last10(phone)}`)
    .gte('created_at', since).limit(1);
  return !!(data && data.length);
}

async function reply(supabase: any, msgFrom: string, text: string, extra: Record<string, unknown>) {
  const to = toSendPhone(msgFrom);
  try {
    const resp = await sendText(to, text);
    await logWa(supabase, { direction: 'out', phone_e164: '+' + to, wa_message_id: waIdFrom(resp), kind: 'text', body: text, status: 'enviado', ...extra });
  } catch (e) {
    await logWa(supabase, { direction: 'out', phone_e164: '+' + to, kind: 'text', body: text, status: 'fallido', error: String(e), ...extra });
  }
}

function fmtHora(d = new Date()) {
  return d.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export async function handleClienteMessage(supabase: any, msg: any) {
  const phone = '+' + msg.from;
  const texto = extractText(msg);
  const media = describeMedia(msg);
  const contenido = [texto, media].filter(Boolean).join(' ');
  try { await markAsRead(msg.id); } catch (_) { /* no crítico */ }
  const mediaPath = await storeMedia(supabase, msg);

  // 1. ¿Quién es? (los teléfonos se capturan a mano: comparar por últimos 10 dígitos)
  const { data: contactos } = await supabase
    .from('maintenance_contacts')
    .select('id, name, property_id, phone_e164, is_primary, property:maintenance_properties(id, name, client_name)')
    .not('phone_e164', 'is', null);
  const matches = (contactos || []).filter((c: any) => last10(c.phone_e164) === last10(msg.from));

  if (!matches.length) {
    await logWa(supabase, { direction: 'in', phone_e164: phone, wa_message_id: msg.id, kind: msg.type, body: contenido, media_path: mediaPath, sender_type: 'desconocido' });
    if (!(await repliedRecently(supabase, msg.from, 24 * 60))) {
      await reply(supabase, msg.from,
        'Hola, gracias por escribir a OMM Technologies. Este número aún no está registrado con nosotros. ¿Nos compartes tu nombre y la dirección o proyecto? Un asesor te atenderá en breve.',
        { sender_type: 'desconocido' });
    }
    return;
  }

  // Si el contacto está en varias propiedades, preferir la que ya tiene ticket abierto, luego el contacto principal.
  const propIds = matches.map((m: any) => m.property_id);
  const { data: abiertos } = await supabase.from('maintenance_tickets')
    .select('id, ticket_number, property_id, status, description, subject, reported_at')
    .in('property_id', propIds).eq('source', 'whatsapp').in('status', OPEN_STATUSES)
    .gte('reported_at', new Date(Date.now() - 72 * 3600_000).toISOString())
    .order('reported_at', { ascending: false }).limit(1);
  const abierto = abiertos?.[0] || null;
  const contacto = (abierto && matches.find((m: any) => m.property_id === abierto.property_id))
    || matches.find((m: any) => m.is_primary) || matches[0];
  const propNombre = contacto.property?.name || 'tu propiedad';
  const nombre = (contacto.name || '').split(' ')[0] || '';
  const base = { sender_type: 'cliente' as const, maintenance_contact_id: contacto.id, property_id: contacto.property_id };

  // 2. Ticket abierto reciente → agregar al mismo reporte
  if (abierto) {
    const linea = `\n\n[${fmtHora()}] ${contacto.name}: ${contenido || '(mensaje sin texto)'}${mediaPath ? ` (archivo: ${mediaPath})` : ''}`;
    const upd: Record<string, unknown> = { description: (abierto.description || '') + linea, updated_at: new Date().toISOString() };
    if (abierto.status === 'esperando_cliente') upd.status = 'abierto';
    await supabase.from('maintenance_tickets').update(upd).eq('id', abierto.id);
    await logWa(supabase, { direction: 'in', phone_e164: phone, wa_message_id: msg.id, kind: msg.type, body: contenido, media_path: mediaPath, ticket_id: abierto.id, ...base });
    if (!(await repliedRecently(supabase, msg.from, 15))) {
      await reply(supabase, msg.from, `Recibido${nombre ? ', ' + nombre : ''}. Lo agregamos a tu reporte #${abierto.ticket_number}.`, { ...base, ticket_id: abierto.id });
    }
    return;
  }

  // 3. Nuevo mensaje → ¿es un reporte?
  const cls = await clasificar(contenido, propNombre);
  if (!cls.es_reporte) {
    await logWa(supabase, { direction: 'in', phone_e164: phone, wa_message_id: msg.id, kind: msg.type, body: contenido, media_path: mediaPath, ...base });
    if (!(await repliedRecently(supabase, msg.from, 12 * 60))) {
      await reply(supabase, msg.from,
        `Hola${nombre ? ' ' + nombre : ''}, gracias por escribir a OMM. ¿En qué te podemos ayudar? Si algo falla en ${propNombre}, cuéntanos qué sistema y qué está pasando; puedes mandar fotos o video.`,
        base);
    }
    return;
  }

  const { data: contratos } = await supabase.from('maintenance_contracts')
    .select('id').eq('property_id', contacto.property_id).eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1);
  const descripcion = `${contenido || '(mensaje sin texto)'}${mediaPath ? `\n(archivo: ${mediaPath})` : ''}\n\n— Recibido por WhatsApp de ${contacto.name} (${phone}) el ${fmtHora()}`;
  const { data: ticket, error } = await supabase.from('maintenance_tickets').insert({
    property_id: contacto.property_id,
    contract_id: contratos?.[0]?.id || null,
    subject: cls.asunto,
    description: descripcion,
    category: cls.categoria,
    priority: cls.prioridad,
    systems_affected: cls.sistemas,
    source: 'whatsapp',
    ai_classification: { ...cls, canal: 'whatsapp', wa_message_id: msg.id, contacto_id: contacto.id },
    reported_at: new Date().toISOString(),
  }).select('id, ticket_number').single();

  if (error || !ticket) {
    console.error('insert ticket:', error);
    await logWa(supabase, { direction: 'in', phone_e164: phone, wa_message_id: msg.id, kind: msg.type, body: contenido, media_path: mediaPath, error: error?.message || 'ticket no creado', ...base });
    await reply(supabase, msg.from, `Hola${nombre ? ' ' + nombre : ''}, recibimos tu mensaje. Un coordinador de OMM te contactará en breve.`, base);
    return;
  }

  await logWa(supabase, { direction: 'in', phone_e164: phone, wa_message_id: msg.id, kind: msg.type, body: contenido, media_path: mediaPath, ticket_id: ticket.id, ...base });
  const prio: Record<string, string> = { urgente: 'Urgente', alta: 'Alta', media: 'Media', baja: 'Baja' };
  await reply(supabase, msg.from,
    `Hola${nombre ? ' ' + nombre : ''}, recibimos tu reporte en OMM.\n` +
    `Folio #${ticket.ticket_number} — ${cls.asunto}\n` +
    `Prioridad: ${prio[cls.prioridad] || cls.prioridad}\n` +
    `Un coordinador te contactará para agendar la visita. Puedes mandar fotos o video por aquí y se agregan al reporte.`,
    { ...base, ticket_id: ticket.id });
}
