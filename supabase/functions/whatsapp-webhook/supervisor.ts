// Jefe de cuadrilla (hoy Alfredo Sánchez): a las 9 pm recibe el resumen de lo
// que reportó su equipo y las actividades que la IA detectó en esos reportes.
// Él decide por WhatsApp cuáles se suben a la obra y con qué fecha.
//
// Lo que pidió Elias: "detecto estas actividades que se deben de resolver en
// cada uno, las subo y si sí, qué fecha les pongo. Automáticamente se le
// asignará a la misma persona que lo reporta; si lo quiere cambiar, tiene que
// ingresar al sistema".
//
// Piezas:
//  - armarPropuestas()     la usa whatsapp-reportes (resumen) para numerar las
//                          actividades detectadas en reporte_propuestas.
//  - textoPropuestas()     el bloque numerado que se le manda.
//  - intentarSupervisor()  el webhook: si el jefe contesta con una decisión
//                          ("todas para el viernes", "1 y 3 el 30, la 2 no"),
//                          da de alta las actividades en obra_actividades.
//  - entregarPendientes()  lo que no cupo en una plantilla porque su ventana de
//                          24 h estaba cerrada, se le entrega cuando contesta.
import { sendText, toSendPhone, last10, markAsRead, downloadMedia } from './whatsapp.ts';
import { logWa, waIdFrom } from './log.ts';
import { hoyCDMX, normalizar, empleadoDeTelefono, primerNombre, partirTexto } from './reportesComun.ts';
import { transcribir } from './reportes.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const DIAS_ABIERTAS = 7;

export function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso + 'T12:00:00Z')).replace(/\./g, '');
}
const haceDias = (n: number) => { const d = new Date(hoyCDMX() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

async function responder(sb: any, telefono: string, texto: string) {
  const to = toSendPhone(telefono);
  try {
    const resp = await sendText(to, texto);
    await logWa(sb, { direction: 'out', phone_e164: '+' + to, wa_message_id: waIdFrom(resp), kind: 'text', body: texto, status: 'enviado', sender_type: 'equipo' });
  } catch (e) {
    await logWa(sb, { direction: 'out', phone_e164: '+' + to, kind: 'text', body: texto, status: 'fallido', error: String(e).slice(0, 300), sender_type: 'equipo' });
  }
}

async function registrarEntrada(sb: any, msg: any, cuerpo?: string) {
  await logWa(sb, {
    direction: 'in', phone_e164: '+' + msg.from, wa_message_id: msg.id, kind: msg.type,
    body: cuerpo || msg.text?.body || `[${msg.type}]`, sender_type: 'equipo',
  });
  try { await markAsRead(msg.id); } catch (_) { /* no crítico */ }
}

// ── Propuestas ──────────────────────────────────────────────────────────────

export interface Propuesta {
  id: string; numero: number; fecha: string; obra_id: string; obra: string; reporte_id: string | null;
  employee_id: string | null; quien: string; descripcion: string; sistema: string | null; area: string | null;
}

export async function abiertasDe(sb: any, supervisorId: string): Promise<Propuesta[]> {
  const { data } = await sb.from('reporte_propuestas')
    .select('id, numero, fecha, obra_id, reporte_id, employee_id, descripcion, sistema, area, obras(nombre), employees:employee_id(nombre)')
    .eq('supervisor_id', supervisorId).eq('estado', 'propuesta').gte('fecha', haceDias(DIAS_ABIERTAS))
    .order('numero');
  const { data: al } = await sb.from('reporte_diario_personas').select('employee_id, alias');
  const alias = new Map((al || []).map((a: any) => [a.employee_id, a.alias]));
  return (data || []).map((p: any) => ({
    id: p.id, numero: p.numero, fecha: p.fecha, obra_id: p.obra_id, reporte_id: p.reporte_id, obra: p.obras?.nombre || 'Obra',
    employee_id: p.employee_id, quien: (p.employee_id && alias.get(p.employee_id)) || primerNombre(p.employees?.nombre),
    descripcion: p.descripcion, sistema: p.sistema, area: p.area,
  }));
}

/**
 * Convierte los pendientes que la IA sacó de cada reporte (obra_reportes.ai_pendientes)
 * en propuestas numeradas para el jefe. No repite lo que ya se le propuso de ese
 * reporte ni lo que ya existe como actividad abierta en la obra. La numeración
 * sigue a las que todavía no decide, para que "la 3" siempre sea la misma.
 */
export async function armarPropuestas(sb: any, supervisorId: string, fecha: string, reps: any[]): Promise<number> {
  const conPend = reps.filter((r: any) => r.obra_id && Array.isArray(r.ai_pendientes) && r.ai_pendientes.length);
  if (!conPend.length) return 0;
  const [{ data: previas }, { data: hoyTodas }, { data: acts }] = await Promise.all([
    sb.from('reporte_propuestas').select('reporte_id, descripcion').in('reporte_id', conPend.map((r: any) => r.id)),
    sb.from('reporte_propuestas').select('numero').eq('supervisor_id', supervisorId).eq('fecha', fecha),
    sb.from('obra_actividades').select('obra_id, descripcion').in('obra_id', [...new Set(conPend.map((r: any) => r.obra_id))]).neq('status', 'completada'),
  ]);
  const abiertas = await abiertasDe(sb, supervisorId);
  let numero = Math.max(0, ...abiertas.map(p => p.numero), ...(hoyTodas || []).map((p: any) => p.numero));
  const ya = new Set((previas || []).map((p: any) => p.reporte_id + '|' + normalizar(p.descripcion)));
  const existe = new Set((acts || []).map((a: any) => a.obra_id + '|' + normalizar(a.descripcion)));
  const filas: any[] = [];
  for (const r of conPend) {
    for (const p of r.ai_pendientes) {
      const d = String(p?.descripcion || '').trim();
      if (!d) continue;
      const k = normalizar(d);
      if (ya.has(r.id + '|' + k) || existe.has(r.obra_id + '|' + k)) continue;
      ya.add(r.id + '|' + k);
      filas.push({
        fecha, numero: ++numero, supervisor_id: supervisorId, reporte_id: r.id, obra_id: r.obra_id,
        employee_id: r.instalador_id || null, descripcion: d.slice(0, 400), sistema: p.sistema || null, area: p.area || null,
      });
    }
  }
  if (!filas.length) return 0;
  const { error } = await sb.from('reporte_propuestas').insert(filas);
  if (error) { console.error('armarPropuestas', error); return 0; }
  return filas.length;
}

export function textoPropuestas(ps: Propuesta[], hoy: string): string {
  if (!ps.length) return '🛠️ No detecté actividades nuevas por resolver.';
  const lineas = ps.map(p => `${p.numero}. *${p.obra}* — ${p.descripcion} _(${p.quien}${p.fecha !== hoy ? ', del ' + fechaCorta(p.fecha) : ''})_`);
  return [
    `🛠️ *Detecté ${ps.length === 1 ? 'esta actividad' : `estas ${ps.length} actividades`} por resolver:*`,
    lineas.join('\n'),
    `¿Las subo a su obra y qué fecha les pongo? Contesta, por ejemplo:\n• *todas para el viernes*\n• *1 y 3 para el 30 de octubre, la 2 no*`,
    `Se asignan a quien la reportó. Si quieres cambiar al responsable, entra al ERP → Obra → Actividades.`,
  ].join('\n\n');
}

// ── Leer la decisión del jefe ───────────────────────────────────────────────

interface Decision { numeros: number[]; accion: 'subir' | 'descartar'; fecha: string | null }
interface Lectura { tipo: 'decision' | 'duda' | 'otro'; decisiones: Decision[] }

function calendario(hoy: string): string {
  const f = new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  const out: string[] = [];
  for (let i = 0; i < 21; i++) {
    const d = new Date(hoy + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
    out.push(`${d.toISOString().slice(0, 10)} = ${f.format(d)}${i === 0 ? ' (hoy)' : i === 1 ? ' (mañana)' : ''}`);
  }
  return out.join('\n');
}

export async function leerDecision(texto: string, ps: Propuesta[], contexto: string[]): Promise<Lectura> {
  const nada: Lectura = { tipo: 'otro', decisiones: [] };
  if (!ANTHROPIC_API_KEY || !texto.trim()) return nada;
  const hoy = hoyCDMX();
  const prompt = `Eres el asistente de OMM Technologies. Al jefe de cuadrilla le mandamos una lista numerada de actividades detectadas en los reportes de obra de su equipo y le preguntamos cuáles subimos al sistema y con qué fecha compromiso.

Actividades pendientes de decidir:
${ps.map(p => `${p.numero}. [${p.obra}] ${p.descripcion} (reportó ${p.quien})`).join('\n')}

Lo último que le escribió el bot:
"""${contexto.join('\n---\n').slice(-2500)}"""

Calendario (zona CDMX):
${calendario(hoy)}

El jefe contestó:
"""${texto.slice(0, 2000)}"""

Devuelve SOLO un JSON sin markdown:
{"tipo": "decision"|"duda"|"otro", "decisiones": [{"numeros": [int], "accion": "subir"|"descartar", "fecha": "YYYY-MM-DD"|null}]}

Reglas:
- "decision": dice cuáles subir o no subir. "todas"/"todo"/"sí a todo" = todos los números de la lista. "la 2 no", "quita la 4", "esa ya quedó" = descartar.
- La fecha es la fecha compromiso. Usa el calendario: "el viernes" = el próximo viernes a partir de hoy; "mañana", "el lunes", "en una semana", "30 de octubre". Si la fecha se dice una vez para varias, aplica a todas las de esa frase.
- Si dice que suba alguna sin decir fecha, y tampoco viene en el contexto, fecha = null (le vamos a preguntar).
- Si sólo contesta una fecha ("el viernes") y en el contexto el bot le preguntó la fecha de ciertos números, la decisión es subir esos números con esa fecha.
- "duda": pregunta algo de la lista o no se entiende qué decidió.
- "otro": el mensaje no tiene que ver con la lista (su propio reporte de obra, fotos, otra plática). Ante la duda entre "otro" y "decision", si no menciona números, "todas", ni fechas, es "otro".
- Sólo números que estén en la lista.`;
  for (const model of ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5']) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) continue;
      const body = await res.json();
      const raw = (body.content || []).map((b: any) => b.text || '').join('');
      const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      const validos = new Set(ps.map(p => p.numero));
      const tipo = ['decision', 'duda', 'otro'].includes(j.tipo) ? j.tipo : 'otro';
      const decisiones: Decision[] = (Array.isArray(j.decisiones) ? j.decisiones : []).map((d: any) => ({
        numeros: (Array.isArray(d.numeros) ? d.numeros : []).map(Number).filter((n: number) => validos.has(n)),
        accion: d.accion === 'descartar' ? 'descartar' : 'subir',
        fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha || '')) ? String(d.fecha) : null,
      })).filter((d: Decision) => d.numeros.length);
      return { tipo: tipo === 'decision' && !decisiones.length ? 'duda' : tipo, decisiones };
    } catch (_) { /* siguiente modelo */ }
  }
  return nada;
}

async function ultimosDelBot(sb: any, telefono: string): Promise<string[]> {
  const { data } = await sb.from('whatsapp_messages').select('body').eq('direction', 'out')
    .ilike('phone_e164', '%' + last10(telefono)).gte('created_at', new Date(Date.now() - 3 * 86400e3).toISOString())
    .order('created_at', { ascending: false }).limit(3);
  return (data || []).map((m: any) => String(m.body || '')).reverse();
}

// ── Aplicar ─────────────────────────────────────────────────────────────────

async function aplicar(sb: any, supervisor: any, ps: Propuesta[], decisiones: Decision[]) {
  const hoy = hoyCDMX();
  const porNumero = new Map(ps.map(p => [p.numero, p]));
  const subidas: { p: Propuesta; fecha: string }[] = [];
  const descartadas: Propuesta[] = [];
  const sinFecha: number[] = [];
  const pasadas: number[] = [];
  const vistos = new Set<number>();
  for (const d of decisiones) {
    for (const n of d.numeros) {
      if (vistos.has(n)) continue;
      const p = porNumero.get(n);
      if (!p) continue;
      if (d.accion === 'subir' && !d.fecha) { sinFecha.push(n); continue; }
      if (d.accion === 'subir' && d.fecha! < hoy) { pasadas.push(n); continue; }
      vistos.add(n);
      // Se reclama la propuesta antes de escribir: si llegan dos mensajes casi
      // juntos, sólo uno la sube (mismo patrón que la entrega de inventario).
      const { data: tomada } = await sb.from('reporte_propuestas')
        .update({ estado: d.accion === 'subir' ? 'aprobada' : 'descartada', fecha_compromiso: d.fecha, decidido_at: new Date().toISOString() })
        .eq('id', p.id).eq('estado', 'propuesta').select('id');
      if (!tomada?.length) continue;
      if (d.accion === 'descartar') { descartadas.push(p); continue; }
      const { data: act, error } = await sb.from('obra_actividades').insert({
        obra_id: p.obra_id, reporte_id: p.reporte_id, sistema: p.sistema || 'Redes', area: p.area,
        descripcion: p.descripcion, status: 'pendiente', porcentaje: 0, order_index: 900,
        // obra_actividades_origen_check sólo acepta manual|cotizacion|ai_reporte|adendum.
        origen: 'ai_reporte',
        instalador_id: p.employee_id, fecha_fin_plan: d.fecha,
        notas: `Detectada en el reporte de ${p.quien} del ${fechaCorta(p.fecha)}. La aprobó ${primerNombre(supervisor.nombre)} por WhatsApp.`,
      }).select('id').single();
      if (error) {
        console.error('aplicar propuesta', error);
        await sb.from('reporte_propuestas').update({ estado: 'propuesta', fecha_compromiso: null, decidido_at: null }).eq('id', p.id);
        sinFecha.push(n); // se vuelve a preguntar
        continue;
      }
      await sb.from('reporte_propuestas').update({ actividad_id: act.id }).eq('id', p.id);
      subidas.push({ p, fecha: d.fecha! });
    }
  }
  return { subidas, descartadas, sinFecha: sinFecha.filter(n => !vistos.has(n)), pasadas: pasadas.filter(n => !vistos.has(n)) };
}

/**
 * 'no'    = no es jefe, no tiene nada por decidir, o el mensaje no es una decisión.
 * 'listo' = se atendió (y quedó en la bitácora).
 */
export async function intentarSupervisor(sb: any, msg: any): Promise<'no' | 'listo'> {
  const from = String(msg.from || '');
  if (!['text', 'audio', 'voice'].includes(msg.type)) return 'no';
  const emp = await empleadoDeTelefono(sb, from);
  if (!emp) return 'no';
  const { data: sup } = await sb.from('reporte_supervisores').select('employee_id').eq('employee_id', emp.id).eq('activo', true).maybeSingle();
  if (!sup) return 'no';
  const ps = await abiertasDe(sb, emp.id);
  if (!ps.length) return 'no';

  let texto = String(msg.text?.body || '').trim();
  if (!texto && (msg.type === 'audio' || msg.type === 'voice')) {
    try {
      const m = msg.audio || msg.voice;
      const { bytes, mimeType } = await downloadMedia(m.id);
      texto = (await transcribir(bytes, mimeType)) || '';
    } catch (_) { /* sin transcripción: que lo vea el flujo de reportes */ }
  }
  if (!texto) return 'no';

  const l = await leerDecision(texto, ps, await ultimosDelBot(sb, from));
  if (l.tipo === 'otro') return 'no';
  await registrarEntrada(sb, msg, msg.type === 'text' ? texto : '🎤 ' + texto);

  if (l.tipo === 'duda') {
    await responder(sb, from, `No te entendí bien 🙏 Estas siguen pendientes:\n\n${ps.map(p => `${p.numero}. *${p.obra}* — ${p.descripcion} _(${p.quien})_`).join('\n')}\n\nContesta con los números y la fecha, por ejemplo: *1 y 3 para el viernes, la 2 no*. O *todas para el lunes*.`);
    return 'listo';
  }

  const r = await aplicar(sb, emp, ps, l.decisiones);
  const quedan = await abiertasDe(sb, emp.id);
  const partes: string[] = [];
  if (r.subidas.length) {
    partes.push(`✅ Subí ${r.subidas.length === 1 ? '1 actividad' : `${r.subidas.length} actividades`}:\n` +
      r.subidas.map(s => `• *${s.p.obra}* — ${s.p.descripcion} → ${s.p.quien}, ${fechaCorta(s.fecha)}`).join('\n'));
  }
  if (r.descartadas.length) partes.push(`🗑️ No subí: ${r.descartadas.map(p => p.numero).join(', ')}.`);
  if (r.pasadas.length) partes.push(`⚠️ La fecha de ${r.pasadas.join(', ')} ya pasó. ¿Qué fecha les pongo?`);
  if (r.sinFecha.length) partes.push(`📅 ¿Qué fecha les pongo a ${r.sinFecha.length === 1 ? 'la ' + r.sinFecha[0] : 'la ' + r.sinFecha.slice(0, -1).join(', ') + ' y la ' + r.sinFecha.slice(-1)}?`);
  const pendientes = quedan.filter(p => !r.sinFecha.includes(p.numero) && !r.pasadas.includes(p.numero));
  if (pendientes.length) partes.push(`Siguen sin decidir: ${pendientes.map(p => p.numero).join(', ')}.`);
  if (r.subidas.length) partes.push('Quedaron asignadas a quien las reportó. Para cambiar al responsable, entra al ERP → Obra → Actividades.');
  if (!partes.length) partes.push('Esas ya estaban decididas. No cambié nada.');
  await responder(sb, from, partes.join('\n\n'));
  return 'listo';
}

// ── Entregas diferidas ──────────────────────────────────────────────────────

const ACUSE = /^\s*(ver|verlo|a ver|ok|okay|va|vale|s[ií]|dale|listo|m[aá]ndalo|enviamelo|env[ií]alo|gracias|ok gracias|👍|👌)[\s.!]*$/i;

/**
 * Lo que se le quiso mandar mientras su ventana de 24 h estaba cerrada (le llegó
 * sólo la plantilla). Al contestar, la ventana se abre: se le entrega completo.
 * 'listo' si el mensaje era sólo el acuse ("ver", "ok"): no hay nada más que hacer.
 */
export async function entregarPendientes(sb: any, msg: any): Promise<'no' | 'listo'> {
  const t10 = last10(String(msg.from || ''));
  const { data: pend } = await sb.from('wa_pendientes_entrega').update({ entregado_at: new Date().toISOString() })
    .eq('telefono10', t10).is('entregado_at', null).gte('created_at', new Date(Date.now() - 3 * 86400e3).toISOString())
    .select('id, texto, created_at');
  if (!pend?.length) return 'no';
  const esAcuse = msg.type === 'text' && ACUSE.test(String(msg.text?.body || ''));
  if (esAcuse) await registrarEntrada(sb, msg);
  for (const p of [...pend].sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))) {
    for (const parte of partirTexto(p.texto)) await responder(sb, msg.from, parte);
  }
  return esAcuse ? 'listo' : 'no';
}

