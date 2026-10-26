// Piezas compartidas de los reportes diarios por WhatsApp: las usa el webhook
// (lo que contesta el instalador) y la función whatsapp-reportes (el cron que
// pide, insiste y manda el resumen).
import { sendText, sendTemplate, toSendPhone, last10 } from './whatsapp.ts';
import { logWa, waIdFrom } from './log.ts';

export const ZONA = 'America/Mexico_City';

// "Hoy" es el de la CDMX, no el de UTC: a las 6 pm de México en UTC ya es mañana.
export function hoyCDMX(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(d);
}
export function horaCDMX(d = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: ZONA, hour: 'numeric', hour12: false }).format(d)) % 24;
}
export function diaAntes(fecha: string): string {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function telefonoDe(e: any): string | null {
  for (const t of [e?.telefono_personal, e?.obra_app_phone, e?.phone]) {
    const d = last10(t || '');
    if (d.length === 10) return '52' + d;
  }
  return null;
}

export function primerNombre(nombre: string | null | undefined): string {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return 'equipo';
  // El padrón trae a varios como "APELLIDO APELLIDO NOMBRE"; si el primero
  // parece apellido conocido no hay forma segura de saberlo: se usa tal cual.
  const p = partes[0].toLowerCase();
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export const normalizar = (s: string) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ¿La persona nos escribió en las últimas 24 h? Dentro de esa ventana se puede
// mandar texto libre (gratis); fuera, sólo plantilla.
export async function ventanaAbierta(sb: any, telefono: string): Promise<boolean> {
  const desde = new Date(Date.now() - 23.5 * 3600 * 1000).toISOString();
  const { data } = await sb.from('whatsapp_messages').select('id')
    .eq('direction', 'in').ilike('phone_e164', '%' + last10(telefono)).gte('created_at', desde).limit(1);
  return !!data?.length;
}

// Manda un aviso a alguien del equipo: texto si la ventana está abierta, si no,
// la plantilla aprobada omm_aviso_equipo con el texto compactado en una línea
// (Meta no deja saltos de línea en los parámetros).
//
// Con la ventana cerrada un texto largo (el resumen, las actividades por
// aprobar) no cabe bien en una plantilla de una línea. Se guarda completo en
// wa_pendientes_entrega y se le entrega en cuanto conteste (whatsapp-webhook,
// supervisor.ts → entregarPendientes). Con la ventana abierta, lo que pase de
// 3,800 caracteres se manda en partes (WhatsApp corta en 4,096).
export function partirTexto(texto: string, max = 3800): string[] {
  const partes: string[] = [];
  let actual = '';
  for (const trozo of texto.split('\n\n')) {
    if (actual && (actual + '\n\n' + trozo).length > max) { partes.push(actual); actual = trozo; }
    else actual = actual ? actual + '\n\n' + trozo : trozo;
  }
  if (actual) partes.push(actual);
  // Un solo bloque más largo que el máximo se corta a la fuerza.
  return partes.flatMap(p => p.length <= max ? [p] : (p.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) || [p]));
}

export async function avisar(sb: any, telefono: string, saludo: string, texto: string, compacto: string, motivo = 'aviso'): Promise<{ ok: boolean; error?: string; diferido?: boolean }> {
  const to = toSendPhone(telefono);
  const abierta = await ventanaAbierta(sb, to);
  try {
    if (abierta) {
      for (const parte of partirTexto(texto)) {
        const resp = await sendText(to, parte);
        await logWa(sb, { direction: 'out', phone_e164: '+' + to, wa_message_id: waIdFrom(resp), kind: 'text', body: parte, status: 'enviado', sender_type: 'equipo' });
      }
      return { ok: true };
    }
    const diferir = texto.length > 300;
    if (diferir) await sb.from('wa_pendientes_entrega').insert({ telefono10: last10(to), texto, motivo });
    let p2 = compacto.replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ');
    const cola = diferir ? ' — contesta *ver* y te lo mando completo' : '';
    p2 = (p2.length + cola.length > 880 ? p2.slice(0, 870 - cola.length) + '…' : p2) + cola;
    const resp = await sendTemplate(to, 'omm_aviso_equipo', [saludo || 'equipo', p2]);
    await logWa(sb, { direction: 'out', phone_e164: '+' + to, wa_message_id: waIdFrom(resp), kind: 'template', template_name: 'omm_aviso_equipo', body: `Hola ${saludo || 'equipo'}, tienes un aviso del ERP de OMM: ${p2}.`, status: 'enviado', sender_type: 'equipo' });
    return { ok: true, diferido: diferir };
  } catch (e) {
    const error = String((e as Error)?.message || e).slice(0, 300);
    await logWa(sb, { direction: 'out', phone_e164: '+' + to, kind: abierta ? 'text' : 'template', body: texto.slice(0, 500), status: 'fallido', error, sender_type: 'equipo' });
    return { ok: false, error };
  }
}

// ── Buscar la obra que mencionó el instalador ───────────────────────────────
// En orden: obras → leads → propiedades de mantenimiento. Se califica por la
// proporción de palabras del mensaje que aparecen en el nombre.
const VACIAS = new Set(['obra', 'la', 'el', 'los', 'las', 'de', 'del', 'en', 'con', 'fui', 'estuve', 'hoy', 'a', 'al', 'y', 'que', 'casa', 'depto', 'departamento', 'proyecto', 'por', 'para', 'me', 'mande', 'mandaron', 'es', 'esta', 'esa', 'ese']);

export interface Candidato { tipo: 'obra' | 'lead' | 'propiedad'; id: string; nombre: string; score: number }

function calificar(palabras: string[], nombre: string): number {
  const n = ' ' + normalizar(nombre) + ' ';
  if (!palabras.length) return 0;
  let hits = 0;
  for (const p of palabras) if (n.includes(' ' + p) || (p.length >= 4 && n.includes(p))) hits++;
  return hits / palabras.length;
}

export async function buscarObra(sb: any, texto: string): Promise<Candidato[]> {
  const palabras = normalizar(texto).split(' ').filter(w => w.length >= 3 && !VACIAS.has(w));
  if (!palabras.length) return [];
  const [ob, ld, pr] = await Promise.all([
    sb.from('obras').select('id, nombre, cliente').limit(1000),
    sb.from('leads').select('id, name, company').is('archived_at', null).limit(3000),
    sb.from('maintenance_properties').select('id, name, client_name').eq('is_active', true).limit(1000),
  ]);
  const top = (lista: Candidato[]) => {
    const buenos = lista.filter(c => c.score >= 0.5).sort((a, b) => b.score - a.score);
    if (!buenos.length) return [];
    const mejor = buenos[0].score;
    return buenos.filter(c => c.score >= mejor - 0.001).slice(0, 5);
  };
  const obras = top((ob.data || []).map((o: any) => ({ tipo: 'obra' as const, id: o.id, nombre: o.nombre, score: Math.max(calificar(palabras, o.nombre), calificar(palabras, `${o.nombre} ${o.cliente || ''}`) * 0.95) })));
  if (obras.length) return obras;
  const leads = top((ld.data || []).map((l: any) => ({ tipo: 'lead' as const, id: l.id, nombre: l.name, score: calificar(palabras, l.name) })));
  if (leads.length) return leads;
  return top((pr.data || []).map((p: any) => ({ tipo: 'propiedad' as const, id: p.id, nombre: `${p.name}${p.client_name ? ' (' + p.client_name + ')' : ''}`, score: calificar(palabras, `${p.name} ${p.client_name || ''}`) })));
}

// Teléfono de un empleado: su ficha, y si no lo tiene ahí, el número con el que
// está dado de alta en el asistente (agent_contacts, por empleado o por usuario).
export async function telefonoDeEmpleado(sb: any, e: any): Promise<string | null> {
  const t = telefonoDe(e);
  if (t || !e?.id) return t;
  const { data: au } = await sb.from('app_users').select('id').eq('employee_id', e.id).limit(1).maybeSingle();
  let q = sb.from('agent_contacts').select('phone_e164').eq('is_active', true).limit(1);
  q = au?.id ? q.or(`employee_id.eq.${e.id},app_user_id.eq.${au.id}`) : q.eq('employee_id', e.id);
  const { data: ac } = await q.maybeSingle();
  const d = last10(ac?.phone_e164 || '');
  return d.length === 10 ? '52' + d : null;
}

// Al revés: de un teléfono al empleado. Primero la ficha; si no, el asistente.
export async function empleadoDeTelefono(sb: any, phone: string): Promise<any | null> {
  const t = last10(phone);
  const { data } = await sb.from('employees').select('id, nombre, telefono_personal, obra_app_phone, phone').eq('activo', true);
  const e = (data || []).find((x: any) => [x.telefono_personal, x.obra_app_phone, x.phone].some((y: string) => last10(y || '') === t));
  if (e) return e;
  const { data: acs } = await sb.from('agent_contacts').select('phone_e164, employee_id, app_user_id').eq('is_active', true);
  const ac = (acs || []).find((a: any) => last10(a.phone_e164) === t);
  if (!ac) return null;
  let empId = ac.employee_id;
  if (!empId && ac.app_user_id) {
    const { data: au } = await sb.from('app_users').select('employee_id').eq('id', ac.app_user_id).maybeSingle();
    empId = au?.employee_id || null;
  }
  return empId ? (data || []).find((x: any) => x.id === empId) || null : null;
}
