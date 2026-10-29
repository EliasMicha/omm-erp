// Lo que contesta un instalador cuando el bot le pidió su reporte del día.
//
// Entra antes que el agente y que el flujo de clientes: si la persona tiene una
// solicitud abierta (hoy, o ayer antes de mediodía), su mensaje es parte del
// reporte. Todo se guarda en obra_reportes —igual que si lo subiera desde la
// app de obra— por medio de reporte_wa_agregar(), que bloquea la solicitud para
// que cinco fotos simultáneas no creen cinco reportes.
//
// El orden, como lo pidió Elias (2026-10-29): "no podemos asegurar que la
// planeación se cumpla al 100%… el primer mensaje será que te confirmen en qué
// obra estaban. Después, que te den la retro, y que les mandes de regreso lo que
// captes —avances, bloqueos y avisos— para que confirmen que está bien".
//
//   1. ¿En qué obra estuviste?   (obra_confirmada=false)
//   2. Mándame tu reporte         (recibiendo)
//   3. Esto entendí, ¿está bien?  (por_confirmar → confirmado, o corrige)
//      La lectura la manda lectura.ts: el cron cuando deja de mandar cosas
//      3 minutos, o aquí mismo al momento cuando corrige.
//
// Si la obra no está en el ERP, el reporte se guarda igual con el nombre tal
// cual y se avisa en el resumen. Nunca se tira un reporte.
import { sendText, downloadMedia, last10, toSendPhone, markAsRead } from './whatsapp.ts';
import { logWa, waIdFrom } from './log.ts';
import { hoyCDMX, horaCDMX, diaAntes, buscarObra, empleadoDeTelefono, normalizar, type Candidato } from './reportesComun.ts';
import { enviarLectura } from './lectura.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Instaladores: después del resumen todavía se les reciben fotos tardías.
// Gente con asistente (Elias, directores): sólo mientras el reporte está vivo,
// para no confundir sus pláticas normales con el bot con un reporte.
const ABIERTAS = ['pedido', 'insistido', 'recibiendo', 'aclarando', 'por_confirmar', 'confirmado', 'cerrado', 'sin_respuesta'];
const ABIERTAS_AGENTE = ['pedido', 'insistido', 'recibiendo', 'aclarando', 'por_confirmar'];

async function responder(sb: any, from: string, texto: string) {
  const to = toSendPhone(from);
  try {
    const resp = await sendText(to, texto);
    await logWa(sb, { direction: 'out', phone_e164: '+' + to, wa_message_id: waIdFrom(resp), kind: 'text', body: texto, status: 'enviado', sender_type: 'equipo' });
  } catch (e) {
    await logWa(sb, { direction: 'out', phone_e164: '+' + to, kind: 'text', body: texto, status: 'fallido', error: String(e).slice(0, 300), sender_type: 'equipo' });
  }
}

const empleadoPorTelefono = empleadoDeTelefono;

async function solicitudesAbiertas(sb: any, employeeId: string, esAgente: boolean) {
  const hoy = hoyCDMX();
  const fechas = horaCDMX() < 12 ? [hoy, diaAntes(hoy)] : [hoy];
  const { data } = await sb.from('reporte_solicitudes')
    .select('id, fecha, obra_id, obra_texto, estado, candidatos, ultimo_mensaje_at, reporte_id, obra_confirmada, lectura_enviada_at, obras(nombre)')
    .eq('employee_id', employeeId).in('fecha', fechas).in('estado', esAgente ? ABIERTAS_AGENTE : ABIERTAS)
    .order('fecha', { ascending: false }).order('created_at', { ascending: true });
  return (data || []).map((s: any) => ({ ...s, nombre: s.obras?.nombre || s.obra_texto || null }));
}

// Transcripción: la llave de OpenAI vive en Vercel. Los instaladores no tienen
// usuario del ERP, así que la función se identifica con su llave de servicio.
export async function transcribir(bytes: Uint8Array, mime: string): Promise<string | null> {
  try {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const r = await fetch('https://omm-erp.vercel.app/api/chatbot?action=transcribir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-omm-internal': SERVICE_KEY },
      body: JSON.stringify({ audio_base64: btoa(bin), mime }),
    });
    const b = await r.json().catch(() => ({}));
    return r.ok && b?.ok && String(b.texto || '').trim() ? String(b.texto).trim() : null;
  } catch { return null; }
}

interface Lectura { tipo: 'reporte' | 'no_fue' | 'sin_obra' | 'charla'; obra_idx: number | null; obra_mencionada: string | null }

async function leer(texto: string, obras: string[]): Promise<Lectura> {
  const base: Lectura = { tipo: 'reporte', obra_idx: null, obra_mencionada: null };
  if (!ANTHROPIC_API_KEY || !texto.trim()) return base;
  const lista = obras.map((o, i) => `${i}: ${o}`).join('\n') || '(ninguna)';
  const prompt = `Eres el asistente de OMM Technologies que recibe el reporte diario de un instalador por WhatsApp.
Hoy le pedimos reporte de estas obras (según la planeación):
${lista}

El instalador escribió:
"""${texto.slice(0, 3000)}"""

Devuelve SOLO un JSON sin markdown: {"tipo": string, "obra_idx": number|null, "obra_mencionada": string|null}
- tipo "reporte": cuenta lo que hizo, avances, pendientes, problemas o material (aunque sea corto). obra_idx = índice de la lista si se puede saber de cuál habla; si sólo hay una, 0.
- tipo "no_fue": dice que NO estuvo en la obra que le pedimos (fue a otra, lo cambiaron). obra_mencionada = la obra o lugar a donde sí fue, tal cual lo escribió, o null si no lo dice. Si en el mismo mensaje también cuenta lo que hizo, igual es "no_fue".
- tipo "sin_obra": no estuvo en ninguna obra (bodega, recoger material, proveedor, oficina, falta, permiso, incapacidad). obra_mencionada = qué hizo, breve.
- tipo "charla": sólo saludo, "ok", "gracias", "ahorita lo mando", o una pregunta que no es reporte.
- Si menciona otra obra que no está en la lista como lugar donde trabajó, es "no_fue" con obra_mencionada.`;
  for (const model of ['claude-haiku-4-5', 'claude-sonnet-4-5']) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) continue;
      const body = await res.json();
      const raw = (body.content || []).map((b: any) => b.text || '').join('');
      const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      const tipo = ['reporte', 'no_fue', 'sin_obra', 'charla'].includes(j.tipo) ? j.tipo : 'reporte';
      const idx = Number.isInteger(j.obra_idx) && j.obra_idx >= 0 && j.obra_idx < obras.length ? j.obra_idx : null;
      return { tipo, obra_idx: idx, obra_mencionada: j.obra_mencionada ? String(j.obra_mencionada).slice(0, 200) : null };
    } catch (_) { /* siguiente modelo */ }
  }
  return base;
}

// ── Textos que se repiten (whatsapp-reportes usa los mismos al pedir) ───────
const lista = (xs: string[]) => xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1];

/** Paso 1: ¿en qué obra estuviste? */
export function preguntaObra(saludo: string, obras: string[]): { texto: string; compacto: string } {
  if (obras.length <= 1) {
    const o = obras[0] || 'la obra';
    return {
      texto: `Hola ${saludo} 👷 Antes de tu reporte: ¿hoy estuviste en *${o}*?\nContesta *sí*, o dime en qué obra estuviste (o si no fuiste a obra).`,
      compacto: `antes de tu reporte: ¿hoy estuviste en ${o}? Contesta sí, o dime en qué obra estuviste`,
    };
  }
  return {
    texto: `Hola ${saludo} 👷 Antes de tu reporte: según la planeación hoy te tocaba\n${obras.map((o, i) => `${i + 1}. *${o}*`).join('\n')}\n¿En cuál estuviste? Contesta con el número (o los números), o dime en qué obra estuviste.`,
    compacto: `antes de tu reporte: ¿en qué obra estuviste hoy? Según la planeación: ${obras.map((o, i) => `${i + 1}) ${o}`).join(', ')}. Contesta con el número o dime cuál`,
  };
}

/** Paso 2: ya con la obra, que cuente cómo le fue. */
export function pedirReporte(obras: string[]): string {
  return `Perfecto, *${lista(obras)}* ✅\nAhora cuéntame cómo te fue: qué avanzaste, si algo te detuvo (bloqueos) y cualquier aviso (material que falta, algo que debamos saber). Fotos y notas de voz también sirven.\nCuando termines te mando lo que entendí para que me lo confirmes.`;
}

// ── Paso 3: ¿confirma la lectura? ───────────────────────────────────────────
// Sin IA: un "sí" no necesita modelo, y una corrección tampoco (todo lo que no
// sea "sí" o un "no" pelón se toma como corrección y se vuelve a leer).
// "sí" sólo si, quitando las palabras de asentir y de cortesía, no queda nada:
// "sí, nada más que fueron 3 cámaras" es una corrección, no una confirmación.
const AFIRMA = /^(s[ií]+|sip|simon|ok|okay|okey|va|vale|claro|correcto|esta bien|todo bien|bien|perfecto|asi es|exacto|confirmo|confirmado|listo|de acuerdo|afirmativo)\b/;
const RELLENO = new Set(['si', 'sii', 'siii', 'sip', 'simon', 'ok', 'okay', 'okey', 'va', 'vale', 'claro', 'correcto', 'esta', 'estan', 'bien', 'todo', 'perfecto', 'asi', 'es', 'exacto', 'confirmo', 'confirmado', 'listo', 'de', 'acuerdo', 'afirmativo', 'gracias', 'muchas', 'mil', 'jefe', 'inge', 'ingeniero', 'buenas', 'noches', 'tardes', 'saludos', 'ya', 'quedo', 'queda', 'eso', 'y', 'muy', 'super', 'excelente', 'sale', 'que', 'tal', 'le', 'te']);
export function esAfirmativo(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return /👍|✅|👌/.test(texto);
  if (!AFIRMA.test(t)) return false;
  return t.split(' ').every(w => RELLENO.has(w));
}
const esNoPelon = (texto: string) => /^(no|nop|nel|negativo|esta mal|no esta bien)$/.test(normalizar(texto).replace(/[^a-z ]+/g, '').trim());

// ── Paso 1: ¿qué obra contestó? ─────────────────────────────────────────────
interface LecturaObra { tipo: 'confirma' | 'otra' | 'sin_obra' | 'charla'; indices: number[]; obra_mencionada: string | null; trae_reporte: boolean }

async function leerObra(texto: string, obras: string[]): Promise<LecturaObra> {
  // Atajos sin modelo: "sí" con una sola obra, o puros números.
  if (obras.length === 1 && esAfirmativo(texto)) return { tipo: 'confirma', indices: [0], obra_mencionada: null, trae_reporte: false };
  const nums = texto.trim().match(/^\s*\d{1,2}(\s*(,|y|e|\s)\s*\d{1,2})*\s*$/) ? (texto.match(/\d{1,2}/g) || []).map(Number) : [];
  if (nums.length && nums.every(n => n >= 1 && n <= obras.length)) return { tipo: 'confirma', indices: [...new Set(nums.map(n => n - 1))], obra_mencionada: null, trae_reporte: false };

  const base: LecturaObra = { tipo: 'charla', indices: [], obra_mencionada: null, trae_reporte: false };
  if (!ANTHROPIC_API_KEY || !texto.trim()) return base;
  const prompt = `Eres el asistente de OMM Technologies. Le preguntamos a un instalador en qué obra estuvo hoy.
Según la planeación le tocaba:
${obras.map((o, i) => `${i}: ${o}`).join('\n')}

Contestó:
"""${texto.slice(0, 3000)}"""

Devuelve SOLO un JSON sin markdown: {"tipo": string, "indices": number[], "obra_mencionada": string|null, "trae_reporte": boolean}
- "confirma": dice que sí estuvo en una o varias de la lista ("sí", "la 1", "en las dos", "sí, en Sacal"). indices = las de la lista donde estuvo.
- "otra": estuvo en otra obra que no está en la lista (o lo cambiaron). obra_mencionada = la obra o lugar tal cual lo escribió. Si además estuvo en alguna de la lista, ponla en indices.
- "sin_obra": no estuvo en ninguna obra (bodega, proveedor, oficina, recoger material, falta, permiso, incapacidad). obra_mencionada = qué hizo, breve.
- "charla": saludo, "ahorita te digo", una pregunta, o no dice dónde estuvo.
- trae_reporte = true si además cuenta lo que hizo (avances, problemas, material).`;
  for (const model of ['claude-haiku-4-5', 'claude-sonnet-4-5']) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) continue;
      const body = await res.json();
      const raw = (body.content || []).map((b: any) => b.text || '').join('');
      const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      const tipo = ['confirma', 'otra', 'sin_obra', 'charla'].includes(j.tipo) ? j.tipo : 'charla';
      const indices = (Array.isArray(j.indices) ? j.indices : []).filter((i: any) => Number.isInteger(i) && i >= 0 && i < obras.length);
      if (tipo === 'confirma' && !indices.length) indices.push(0);
      return { tipo, indices: [...new Set(indices as number[])], obra_mencionada: j.obra_mencionada ? String(j.obra_mencionada).slice(0, 200) : null, trae_reporte: !!j.trae_reporte };
    } catch (_) { /* siguiente modelo */ }
  }
  return base;
}

// ── Mover una solicitud a la obra donde de verdad estuvo ────────────────────
// Se reusa la misma solicitud (no se crea otra) para que las fotos que mandó
// antes de decir la obra se vayan con ella.
async function repuntar(sb: any, s: any, destino: { obra_id?: string | null; obra_texto?: string | null; estado?: string }) {
  const obra_id = destino.obra_id ?? null;
  const obra_texto = destino.obra_texto ?? null;
  await sb.from('reporte_solicitudes').update({
    obra_id, obra_texto, obra_confirmada: true, candidatos: null, ultimo_mensaje_at: new Date().toISOString(),
    estado: destino.estado || (s.reporte_id ? 'recibiendo' : 'pedido'),
  }).eq('id', s.id);
  if (s.reporte_id) await sb.from('obra_reportes').update({ obra_id, obra_texto }).eq('id', s.reporte_id);
}

// Resuelve el nombre que dio el instalador sobre la solicitud s.
// ok=true: ya quedó en una obra (nombre); ok=false: se le preguntó cuál (aclarando).
async function resolverEn(sb: any, s: any, mencion: string): Promise<{ ok: boolean; nombre: string; respuesta?: string }> {
  const cands: Candidato[] = await buscarObra(sb, mencion);
  const obras = cands.filter(c => c.tipo === 'obra');
  if (obras.length === 1) {
    await repuntar(sb, s, { obra_id: obras[0].id });
    return { ok: true, nombre: obras[0].nombre };
  }
  if (obras.length > 1) {
    await sb.from('reporte_solicitudes').update({ estado: 'aclarando', candidatos: obras.map(o => ({ id: o.id, nombre: o.nombre })) }).eq('id', s.id);
    return { ok: false, nombre: '', respuesta: `¿Cuál de estas es?\n${obras.map((o, i) => `${i + 1}. ${o.nombre}`).join('\n')}\nContesta con el número.` };
  }
  const nombre = cands[0] ? `${cands[0].nombre} (${cands[0].tipo === 'lead' ? 'cliente en CRM, sin obra' : 'mantenimiento'})` : mencion;
  await repuntar(sb, s, { obra_texto: nombre });
  return { ok: true, nombre: cands[0]?.nombre || mencion, respuesta: `Lo guardo como *${cands[0]?.nombre || mencion}*. Esa obra no está dada de alta en el ERP; le aviso a Elias para ligarla.` };
}

/**
 * 'no'      = no tiene reporte pendiente; sigue el flujo normal.
 * 'listo'   = era parte del reporte y ya se atendió (y se registró en la bitácora).
 * 'agente'  = tiene reporte abierto pero el mensaje es plática y es del equipo con
 *             asistente: que lo conteste el agente (la entrada ya quedó en la bitácora).
 */
export async function intentarReporte(sb: any, msg: any, esAgente: boolean): Promise<'no' | 'listo' | 'agente'> {
  const from = String(msg.from || '');
  const emp = await empleadoPorTelefono(sb, from);
  if (!emp) return 'no';
  const abiertas = await solicitudesAbiertas(sb, emp.id, esAgente);
  if (!abiertas.length) return 'no';
  const telefono = '52' + last10(from);
  await logWa(sb, {
    direction: 'in', phone_e164: '+' + from, wa_message_id: msg.id, kind: msg.type,
    body: msg.text?.body || msg.image?.caption || msg.document?.caption || `[${msg.type}]`, sender_type: 'equipo',
  });
  try { await markAsRead(msg.id); } catch (_) { /* no crítico */ }
  const r = await atender(sb, msg, from, emp, abiertas, telefono, esAgente);
  return r ? 'listo' : 'agente';
}

const agregar = (sb: any, solicitudId: string, texto: string | null, foto: string | null, audio: string | null) =>
  sb.rpc('reporte_wa_agregar', { p_solicitud: solicitudId, p_texto: texto, p_foto: foto, p_audio_path: audio });

const masReciente = (xs: any[]) => [...xs].sort((a: any, b: any) => String(b.ultimo_mensaje_at || '').localeCompare(String(a.ultimo_mensaje_at || '')))[0] || xs[0];

async function atender(sb: any, msg: any, from: string, emp: any, abiertas: any[], telefono: string, esAgente: boolean): Promise<boolean> {

  // ── Contenido del mensaje ─────────────────────────────────────────────────
  let texto = String(msg.text?.body || msg.image?.caption || msg.document?.caption || msg.video?.caption || '').trim();
  let foto: string | null = null;
  let audioPath: string | null = null;
  let audioSinTexto = false;
  const fecha = abiertas[0].fecha;
  const carpeta = `${emp.id}/${fecha}`;
  try {
    if (msg.type === 'image' || msg.type === 'video') {
      const m = msg.image || msg.video;
      const { bytes, mimeType } = await downloadMedia(m.id);
      const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : mimeType.startsWith('video') ? 'mp4' : 'jpg';
      const path = `${carpeta}/wa_${msg.id}.${ext}`;
      const { error } = await sb.storage.from('obra-reportes').upload(path, bytes, { contentType: mimeType, upsert: true });
      if (!error) { if (msg.type === 'image') foto = path; else texto = (texto ? texto + ' ' : '') + `[Video: ${path}]`; }
    } else if (msg.type === 'audio' || msg.type === 'voice') {
      const m = msg.audio || msg.voice;
      const { bytes, mimeType } = await downloadMedia(m.id);
      const path = `${carpeta}/wa_${msg.id}.ogg`;
      const { error } = await sb.storage.from('obra-reportes').upload(path, bytes, { contentType: mimeType, upsert: true });
      if (!error) audioPath = path;
      const t = await transcribir(bytes, mimeType);
      if (!t) audioSinTexto = true;
      texto = t ? `🎤 ${t}` : (texto || '');
      if (t) await sb.from('whatsapp_messages').update({ body: '🎤 ' + t }).eq('wa_message_id', msg.id);
    } else if (msg.type === 'document') {
      const { bytes, mimeType } = await downloadMedia(msg.document.id);
      const nombre = (msg.document.filename || `wa_${msg.id}`).replace(/[^\w.\-]+/g, '_');
      const path = `${carpeta}/${nombre}`;
      await sb.storage.from('obra-reportes').upload(path, bytes, { contentType: mimeType, upsert: true });
      texto = (texto ? texto + ' ' : '') + `[Documento: ${nombre}]`;
    } else if (msg.type === 'location') {
      texto = `[Ubicación: ${msg.location?.latitude}, ${msg.location?.longitude}${msg.location?.name ? ' — ' + msg.location.name : ''}]`;
    }
  } catch (e) {
    console.error('reporte media', e);
  }
  const hora = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const linea = texto ? `[${hora}] ${texto}` : null;
  // Sólo un archivo, sin nada escrito (video o documento sin pie, ubicación).
  const sinTextoUtil = !texto || /^\[(Video|Documento|Ubicación)[^\]]*\]$/.test(texto);
  const ahora = new Date().toISOString();

  const vivas = abiertas.filter((s: any) => !['no_fue', 'cancelado'].includes(s.estado));

  // ── 3. Le mandamos la lectura: ¿la confirma o la corrige? ─────────────────
  const porConf = vivas.filter((s: any) => s.estado === 'por_confirmar');
  if (porConf.length) {
    const s = [...porConf].sort((a: any, b: any) => String(b.lectura_enviada_at || '').localeCompare(String(a.lectura_enviada_at || '')))[0];
    if (audioSinTexto) {
      await agregar(sb, s.id, null, null, audioPath);
      await responder(sb, from, 'No alcancé a entender la nota de voz 🙏 ¿Me lo escribes? Contesta *sí* si el resumen está bien.');
      return true;
    }
    if (!texto || sinTextoUtil) {           // foto o video de más: evidencia, sin volver a leer
      await agregar(sb, s.id, linea, foto, audioPath);
      return true;
    }
    if (esAfirmativo(texto)) {
      await sb.from('reporte_solicitudes').update({ estado: 'confirmado', confirmado_at: new Date().toISOString() }).in('id', porConf.map((x: any) => x.id));
      await responder(sb, from, '¡Gracias! Tu reporte quedó confirmado ✅');
      return true;
    }
    if (esNoPelon(texto)) {
      await responder(sb, from, '¿Qué hay que corregir? Escríbemelo o mándame una nota de voz.');
      return true;
    }
    // Corrección: se agrega al reporte y se vuelve a leer al momento.
    await agregar(sb, s.id, `[${hora}] [Corrección] ${texto}`, foto, audioPath);
    const r = await enviarLectura(sb, s.id, { corregida: true });
    if (!r.ok) await responder(sb, from, 'Anotado tu cambio ✅. No pude volver a armar el resumen; Elias lo revisa.');
    return true;
  }

  // ── Aclarando: le dimos varias obras parecidas para escoger ───────────────
  const aclarando = vivas.find((s: any) => s.estado === 'aclarando');
  if (aclarando && texto && !foto) {
    const cands = Array.isArray(aclarando.candidatos) ? aclarando.candidatos : [];
    const n = Number((texto.match(/^\s*(\d{1,2})\s*$/) || [])[1]);
    if (cands.length && n >= 1 && n <= cands.length) {
      await repuntar(sb, aclarando, { obra_id: cands[n - 1].id });
      await responder(sb, from, aclarando.reporte_id
        ? `Listo, *${cands[n - 1].nombre}* ✅. Mándame lo que falte; cuando termines te mando lo que entendí para que me lo confirmes.`
        : pedirReporte([cands[n - 1].nombre]));
      return true;
    }
    const r = await resolverEn(sb, aclarando, texto);
    await responder(sb, from, r.ok ? (r.respuesta ? r.respuesta + '\n\n' : '') + pedirReporte([r.nombre]) : r.respuesta!);
    return true;
  }

  // ── 1. Todavía no nos dice en qué obra estuvo ─────────────────────────────
  const confirmadas = vivas.filter((s: any) => s.obra_confirmada && s.estado !== 'aclarando');
  const sinConfirmar = vivas.filter((s: any) => !s.obra_confirmada && ['pedido', 'insistido', 'recibiendo'].includes(s.estado));
  if (sinConfirmar.length && !confirmadas.length) {
    const nombres = sinConfirmar.map((s: any) => s.nombre || 'obra sin nombre');
    if (audioSinTexto) {
      await responder(sb, from, `No alcancé a entender la nota de voz 🙏 ${preguntaObra('', nombres).texto.replace(/^Hola\s+👷 Antes de tu reporte: /, '')}`);
      return true;
    }
    if (!texto || sinTextoUtil) {
      // Mandó fotos antes de decir la obra: se guardan en la planeada (se mueven
      // si luego dice otra) y se le vuelve a preguntar, una sola vez.
      const yaTenia = !!sinConfirmar[0].reporte_id;
      await agregar(sb, sinConfirmar[0].id, linea, foto, audioPath);
      if (!yaTenia) await responder(sb, from, `Recibido 📷. Antes dime: ${preguntaObra('', nombres).texto.replace(/^Hola\s+👷 Antes de tu reporte: /, '')}`);
      return true;
    }
    const l = await leerObra(texto, nombres);

    if (l.tipo === 'charla') {
      if (esAgente) return false;
      await responder(sb, from, preguntaObra('', nombres).texto.replace(/^Hola\s+👷 /, ''));
      return true;
    }

    if (l.tipo === 'sin_obra') {
      const s0 = sinConfirmar[0];
      for (const s of sinConfirmar.slice(1)) if (!s.reporte_id) await sb.from('reporte_solicitudes').update({ estado: 'no_fue' }).eq('id', s.id);
      await repuntar(sb, s0, { obra_texto: `Sin obra: ${l.obra_mencionada || 'no especificó'}`, estado: 'confirmado' });
      await agregar(sb, s0.id, linea, foto, audioPath);
      await sb.from('reporte_solicitudes').update({ estado: 'confirmado', confirmado_at: new Date().toISOString() }).eq('id', s0.id);
      await responder(sb, from, 'Anotado ✅. Queda registrado que hoy no estuviste en obra.');
      return true;
    }

    if (l.tipo === 'confirma') {
      const elegidas = l.indices.map(i => sinConfirmar[i]).filter(Boolean);
      const resto = sinConfirmar.filter((s: any) => !elegidas.includes(s));
      // ultimo_mensaje_at: la lectura espera 3 minutos de silencio desde AQUÍ, no
      // desde las fotos que haya mandado antes de decir la obra.
      await sb.from('reporte_solicitudes').update({ obra_confirmada: true, ultimo_mensaje_at: ahora }).in('id', elegidas.map((s: any) => s.id));
      for (const s of resto) if (!s.reporte_id) await sb.from('reporte_solicitudes').update({ estado: 'no_fue' }).eq('id', s.id);
      // Si mandó fotos antes y resultó que no fue a esa obra, se pasan a la primera que sí.
      for (const s of resto) if (s.reporte_id) await repuntar(sb, s, { obra_id: elegidas[0].obra_id, obra_texto: elegidas[0].obra_texto });
      if (l.trae_reporte) {
        await agregar(sb, elegidas[0].id, linea, foto, audioPath);
        await responder(sb, from, `Anotado en *${lista(elegidas.map((s: any) => s.nombre))}* ✅. Si tienes más (fotos, avances, bloqueos, avisos), mándalo. En unos minutos te mando lo que entendí para que me lo confirmes.`);
      } else {
        await responder(sb, from, pedirReporte(elegidas.map((s: any) => s.nombre)));
      }
      return true;
    }

    // 'otra': estuvo en otra obra. Se mueve la primera planeada (con lo que ya
    // haya mandado) a esa obra; las demás planeadas se marcan "no fue", salvo las
    // que también confirmó.
    const tambien = l.indices.map(i => sinConfirmar[i]).filter(Boolean);
    if (tambien.length) await sb.from('reporte_solicitudes').update({ obra_confirmada: true, ultimo_mensaje_at: ahora }).in('id', tambien.map((s: any) => s.id));
    const libres = sinConfirmar.filter((s: any) => !tambien.includes(s));
    const vehiculo = libres[0];
    if (!vehiculo) {   // confirmó todas y además mencionó otra: se crea una más
      const { data: nueva } = await sb.from('reporte_solicitudes').insert({ fecha, employee_id: emp.id, telefono, origen: 'instalador', estado: 'pedido', pedido_at: new Date().toISOString() }).select('*').single();
      if (nueva) libres.push(nueva);
    }
    for (const s of libres.slice(1)) if (!s.reporte_id) await sb.from('reporte_solicitudes').update({ estado: 'no_fue' }).eq('id', s.id);
    if (!libres[0]) return true;
    if (!l.obra_mencionada) {
      await sb.from('reporte_solicitudes').update({ estado: 'aclarando', candidatos: null }).eq('id', libres[0].id);
      await responder(sb, from, '¿En qué obra estuviste hoy?');
      return true;
    }
    const r = await resolverEn(sb, libres[0], l.obra_mencionada);
    if (r.ok && l.trae_reporte) await agregar(sb, libres[0].id, linea, foto, audioPath);
    const nombresOk = [...tambien.map((s: any) => s.nombre), ...(r.ok ? [r.nombre] : [])];
    if (!r.ok) { await responder(sb, from, r.respuesta!); return true; }
    await responder(sb, from, (r.respuesta ? r.respuesta + '\n\n' : '') + (l.trae_reporte
      ? `Anotado ✅. Si tienes más (fotos, avances, bloqueos, avisos), mándalo. En unos minutos te mando lo que entendí para que me lo confirmes.`
      : pedirReporte(nombresOk)));
    return true;
  }

  // ── 2. Ya dijo la obra: es su reporte ─────────────────────────────────────
  const destinos = (confirmadas.length ? confirmadas : vivas).filter((s: any) => s.estado !== 'aclarando');
  if (!destinos.length) return true;
  if (!texto || sinTextoUtil) {
    await agregar(sb, masReciente(destinos).id, audioSinTexto ? `[${hora}] [Nota de voz sin transcribir]` : linea, foto, audioPath);
    return true;
  }
  const nombres = destinos.map((s: any) => s.nombre || 'obra sin nombre');
  const l = await leer(texto, nombres);

  if (l.tipo === 'charla') {
    if (esAgente) return false;
    if (!destinos.some((s: any) => s.reporte_id)) await responder(sb, from, pedirReporte(nombres));
    return true;
  }

  if (l.tipo === 'no_fue' || l.tipo === 'sin_obra') {
    // Cambió de opinión después de confirmar la obra.
    const s = l.obra_idx != null ? destinos[l.obra_idx] : masReciente(destinos);
    if (l.tipo === 'sin_obra') {
      await repuntar(sb, s, { obra_texto: `Sin obra: ${l.obra_mencionada || 'no especificó'}` });
      await agregar(sb, s.id, linea, foto, audioPath);
      await sb.from('reporte_solicitudes').update({ estado: 'confirmado', confirmado_at: new Date().toISOString() }).eq('id', s.id);
      await responder(sb, from, 'Anotado ✅. Queda registrado que hoy no estuviste en obra.');
      return true;
    }
    if (!l.obra_mencionada) {
      await sb.from('reporte_solicitudes').update({ estado: 'aclarando', candidatos: null }).eq('id', s.id);
      await responder(sb, from, '¿En qué obra estuviste hoy?');
      return true;
    }
    const r = await resolverEn(sb, s, l.obra_mencionada);
    if (r.ok && linea) await agregar(sb, s.id, linea, foto, audioPath);
    await responder(sb, from, r.ok ? `${r.respuesta ? r.respuesta + ' ' : ''}Lo cambio a *${r.nombre}* ✅.` : r.respuesta!);
    return true;
  }

  // Reporte.
  const destino = l.obra_idx != null ? destinos[l.obra_idx] : destinos.length === 1 ? destinos[0] : masReciente(destinos);
  const primero = !destino.reporte_id;
  await agregar(sb, destino.id, linea, foto, audioPath);
  // Agregó algo de fondo a un reporte ya confirmado: se le vuelve a leer.
  if (destino.estado === 'confirmado') await sb.from('reporte_solicitudes').update({ estado: 'recibiendo' }).eq('id', destino.id);
  if (primero) {
    const faltan = destinos.filter((s: any) => s.id !== destino.id && !s.reporte_id).map((s: any) => s.nombre);
    await responder(sb, from, `Recibido ✅ *${destino.nombre}*. Si tienes más (fotos, avances, bloqueos, avisos), mándalo. En unos minutos te mando lo que entendí para que me lo confirmes.` +
      (faltan.length ? ` También me falta tu reporte de *${faltan.join('* y *')}*.` : ''));
  }
  return true;
}
