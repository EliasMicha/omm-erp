// Lo que contesta un instalador cuando el bot le pidió su reporte del día.
//
// Entra antes que el agente y que el flujo de clientes: si la persona tiene una
// solicitud abierta (hoy, o ayer antes de mediodía), su mensaje es parte del
// reporte. Todo se guarda en obra_reportes —igual que si lo subiera desde la
// app de obra— por medio de reporte_wa_agregar(), que bloquea la solicitud para
// que cinco fotos simultáneas no creen cinco reportes.
//
// Reglas que pidió Elias:
//  - Se pide según la planeación. Si dice "no fui a esa obra", se le pregunta a
//    dónde fue y se sigue con esa.
//  - Si la obra no está en el ERP, el reporte se guarda igual con el nombre tal
//    cual y se avisa en el resumen. Nunca se tira un reporte.
import { sendText, downloadMedia, last10, toSendPhone, markAsRead } from './whatsapp.ts';
import { logWa, waIdFrom } from './log.ts';
import { hoyCDMX, horaCDMX, diaAntes, buscarObra, empleadoDeTelefono, type Candidato } from './reportesComun.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Instaladores: después del resumen todavía se les reciben fotos tardías.
// Gente con asistente (Elias, directores): sólo mientras el reporte está vivo,
// para no confundir sus pláticas normales con el bot con un reporte.
const ABIERTAS = ['pedido', 'insistido', 'recibiendo', 'aclarando', 'cerrado', 'sin_respuesta'];
const ABIERTAS_AGENTE = ['pedido', 'insistido', 'recibiendo', 'aclarando'];

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
    .select('id, fecha, obra_id, obra_texto, estado, candidatos, ultimo_mensaje_at, reporte_id, obras(nombre)')
    .eq('employee_id', employeeId).in('fecha', fechas).in('estado', esAgente ? ABIERTAS_AGENTE : ABIERTAS)
    .order('fecha', { ascending: false }).order('created_at', { ascending: true });
  return (data || []).map((s: any) => ({ ...s, nombre: s.obras?.nombre || s.obra_texto || null }));
}

// Transcripción: la llave de OpenAI vive en Vercel. Los instaladores no tienen
// usuario del ERP, así que la función se identifica con su llave de servicio.
async function transcribir(bytes: Uint8Array, mime: string): Promise<string | null> {
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

// Crea (o reusa) la solicitud de una obra que el instalador mencionó y que no
// venía en la planeación.
async function solicitudPara(sb: any, base: any, emp: any, telefono: string, c: { obra_id?: string | null; obra_texto?: string | null; estado?: string; candidatos?: any }) {
  if (c.obra_texto) {
    const { data: ya } = await sb.from('reporte_solicitudes').select('id').eq('fecha', base.fecha).eq('employee_id', emp.id)
      .eq('obra_texto', c.obra_texto).neq('estado', 'cancelado').limit(1).maybeSingle();
    if (ya) return ya.id;
  }
  if (c.obra_id) {
    const { data: ya } = await sb.from('reporte_solicitudes').select('id').eq('fecha', base.fecha).eq('employee_id', emp.id)
      .eq('obra_id', c.obra_id).is('obra_texto', null).neq('estado', 'cancelado').maybeSingle();
    if (ya) {
      await sb.from('reporte_solicitudes').update({ estado: 'recibiendo' }).eq('id', ya.id).in('estado', ['no_fue', 'pedido', 'insistido']);
      return ya.id;
    }
  }
  const { data, error } = await sb.from('reporte_solicitudes').insert({
    fecha: base.fecha, employee_id: emp.id, telefono, origen: 'instalador',
    obra_id: c.obra_id ?? null, obra_texto: c.obra_texto ?? null,
    estado: c.estado ?? 'recibiendo', candidatos: c.candidatos ?? null, pedido_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

// Resuelve el nombre que dio el instalador. Devuelve la solicitud donde se
// guarda lo que siga, y el mensaje para contestarle.
async function resolverMencion(sb: any, base: any, emp: any, telefono: string, mencion: string): Promise<{ solicitudId: string; respuesta: string }> {
  const cands: Candidato[] = await buscarObra(sb, mencion);
  const obras = cands.filter(c => c.tipo === 'obra');
  if (obras.length === 1) {
    const id = await solicitudPara(sb, base, emp, telefono, { obra_id: obras[0].id });
    return { solicitudId: id, respuesta: `Anotado en *${obras[0].nombre}*. Si no es esa obra, dime cuál.` };
  }
  if (obras.length > 1) {
    const id = await solicitudPara(sb, base, emp, telefono, { estado: 'aclarando', candidatos: obras.map(o => ({ id: o.id, nombre: o.nombre })) });
    return { solicitudId: id, respuesta: `¿Cuál de estas es?\n${obras.map((o, i) => `${i + 1}. ${o.nombre}`).join('\n')}\nContesta con el número.` };
  }
  const nombre = cands[0] ? `${cands[0].nombre} (${cands[0].tipo === 'lead' ? 'cliente en CRM, sin obra' : 'mantenimiento'})` : mencion;
  const id = await solicitudPara(sb, base, emp, telefono, { obra_texto: nombre });
  return { solicitudId: id, respuesta: `Lo guardo como *${cands[0]?.nombre || mencion}*. Esa obra no está dada de alta en el ERP; le aviso a Elias para ligarla. Mándame tu reporte aquí mismo.` };
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

async function atender(sb: any, msg: any, from: string, emp: any, abiertas: any[], telefono: string, esAgente: boolean): Promise<boolean> {

  // 1. Contenido del mensaje.
  let texto = String(msg.text?.body || msg.image?.caption || msg.document?.caption || msg.video?.caption || '').trim();
  let foto: string | null = null;
  let audioPath: string | null = null;
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
      texto = t ? `🎤 ${t}` : (texto || '[Nota de voz sin transcribir]');
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

  // 2. ¿Estaba contestando una aclaración?
  const aclarando = abiertas.find((s: any) => s.estado === 'aclarando');
  if (aclarando && texto && !foto && !audioPath) {
    const cands = Array.isArray(aclarando.candidatos) ? aclarando.candidatos : [];
    const n = Number((texto.match(/^\s*(\d{1,2})\s*$/) || [])[1]);
    if (cands.length && n >= 1 && n <= cands.length) {
      const elegido = cands[n - 1];
      await sb.from('reporte_solicitudes').update({ estado: 'cancelado' }).eq('id', aclarando.id);
      const id = await solicitudPara(sb, aclarando, emp, telefono, { obra_id: elegido.id });
      await sb.rpc('reporte_wa_agregar', { p_solicitud: id, p_texto: null, p_foto: null, p_audio_path: null });
      await responder(sb, from, `Listo, *${elegido.nombre}*. Mándame tu reporte: qué avanzaste, fotos y pendientes.`);
      return true;
    }
    // Contestó con un nombre: se resuelve.
    await sb.from('reporte_solicitudes').update({ estado: 'cancelado' }).eq('id', aclarando.id);
    const r = await resolverMencion(sb, aclarando, emp, telefono, texto);
    await responder(sb, from, r.respuesta);
    return true;
  }

  const planeadas = abiertas.filter((s: any) => s.estado !== 'aclarando');

  // 3. Sin texto (foto, audio sin transcribir): va a la solicitud más reciente.
  if (!texto) {
    const destino = [...planeadas].sort((a: any, b: any) => String(b.ultimo_mensaje_at || '').localeCompare(String(a.ultimo_mensaje_at || '')))[0] || planeadas[0];
    if (!destino) return true;
    await sb.rpc('reporte_wa_agregar', { p_solicitud: destino.id, p_texto: null, p_foto: foto, p_audio_path: audioPath });
    return true;
  }

  // 4. Hay texto: ¿de qué obra habla y es reporte?
  const nombres = planeadas.map((s: any) => s.nombre || 'obra sin nombre');
  const l = await leer(texto, nombres);

  if (l.tipo === 'charla') {
    if (esAgente) return false; // que lo atienda el asistente
    const yaMando = planeadas.some((s: any) => s.reporte_id);
    if (!yaMando) await responder(sb, from, `Va. Cuando puedas mándame tu reporte de hoy de *${nombres.join('* y *')}*: qué avanzaste, fotos y pendientes.`);
    return true;
  }

  if (l.tipo === 'no_fue') {
    const objetivo = l.obra_idx != null ? planeadas[l.obra_idx] : planeadas.length === 1 ? planeadas[0] : null;
    if (objetivo && !objetivo.reporte_id) await sb.from('reporte_solicitudes').update({ estado: 'no_fue' }).eq('id', objetivo.id);
    if (!l.obra_mencionada) {
      await solicitudPara(sb, planeadas[0], emp, telefono, { estado: 'aclarando' });
      await responder(sb, from, '¿A qué obra fuiste hoy?');
      return true;
    }
    const r = await resolverMencion(sb, planeadas[0], emp, telefono, l.obra_mencionada);
    if (linea) await sb.rpc('reporte_wa_agregar', { p_solicitud: r.solicitudId, p_texto: linea, p_foto: foto, p_audio_path: audioPath });
    await responder(sb, from, r.respuesta);
    return true;
  }

  if (l.tipo === 'sin_obra') {
    for (const s of planeadas) if (!s.reporte_id) await sb.from('reporte_solicitudes').update({ estado: 'no_fue' }).eq('id', s.id);
    const id = await solicitudPara(sb, planeadas[0], emp, telefono, { obra_texto: `Sin obra: ${l.obra_mencionada || 'no especificó'}` });
    await sb.rpc('reporte_wa_agregar', { p_solicitud: id, p_texto: linea, p_foto: foto, p_audio_path: audioPath });
    await responder(sb, from, 'Anotado ✅. Queda registrado que hoy no estuviste en obra.');
    return true;
  }

  // Reporte.
  const destino = l.obra_idx != null ? planeadas[l.obra_idx]
    : planeadas.length === 1 ? planeadas[0]
    : [...planeadas].sort((a: any, b: any) => String(b.ultimo_mensaje_at || '').localeCompare(String(a.ultimo_mensaje_at || '')))[0];
  const primero = !destino.reporte_id;
  await sb.rpc('reporte_wa_agregar', { p_solicitud: destino.id, p_texto: linea, p_foto: foto, p_audio_path: audioPath });
  if (primero) {
    const faltan = planeadas.filter((s: any) => s.id !== destino.id && !s.reporte_id).map((s: any) => s.nombre);
    await responder(sb, from, `Recibido ✅ *${destino.nombre}*. Si tienes fotos o algo más, mándalo aquí.` +
      (faltan.length ? ` Me falta tu reporte de *${faltan.join('* y *')}*.` : ''));
  }
  return true;
}
