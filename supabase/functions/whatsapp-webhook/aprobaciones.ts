// Estado de cuenta que pide un cliente por WhatsApp — con el OK de Elias.
//
// Elias decidió (25-oct): "siempre pedir tu OK". El flujo:
//   1. Un cliente escribe "¿me mandas mi estado de cuenta?". Si su número está
//      en los contactos del lead (contactos_externos, o leads.contact_phone),
//      se arma el PDF —el mismo del botón del CRM— y se le manda a ELIAS con la
//      pregunta "¿Se lo mando?". Al cliente se le contesta que en un momento.
//   2. Elias contesta "sí" (o "sí 2" si hay varias) → sale al cliente. "no" → no.
// Un número que no está ligado a ningún lead NO recibe nada: a Elias le llega
// el aviso para darlo de alta. Un estado de cuenta es información financiera:
// nunca sale a un número que nadie dio de alta.
import { sendText, markAsRead, last10, toSendPhone } from './whatsapp.ts';
import { logWa, waIdFrom } from './log.ts';
import { avisar, avisarDocumento, alHistorial, ventanaAbierta, mandarDocumento, telefonoDeEmpleado, primerNombre } from './reportesComun.ts';
import { generarEstadoCuentaPdf } from '../_shared/estadoCuentaPdf.ts';
import { datosEstadoCuenta, nombreArchivoEstadoCuenta } from '../_shared/estadoCuenta.ts';

const PIDE_ESTADO = /estado\s+de\s+cuenta|cu[aá]nto\s+(le\s+|les\s+)?(debo|debemos|adeudo)|mi\s+saldo|saldo\s+(pendiente|actual)|mi\s+adeudo|lo\s+que\s+(debo|llevo\s+pagado)|cu[aá]nto\s+(me\s+)?falta\s+(por\s+)?pagar|relaci[oó]n\s+de\s+pagos/i;

export const pideEstadoDeCuenta = (texto: string) => PIDE_ESTADO.test(texto || '');

async function responder(sb: any, tel: string, texto: string, extra: Record<string, unknown> = {}) {
  const to = toSendPhone(tel);
  try {
    const resp = await sendText(to, texto);
    await logWa(sb, { direction: 'out', phone_e164: '+' + to, wa_message_id: waIdFrom(resp), kind: 'text', body: texto, status: 'enviado', ...extra });
  } catch (e) {
    await logWa(sb, { direction: 'out', phone_e164: '+' + to, kind: 'text', body: texto, status: 'fallido', error: String(e).slice(0, 300), ...extra });
  }
}

async function elDG(sb: any) {
  const { data } = await sb.from('employees').select('id, nombre, telefono_personal, obra_app_phone, phone').eq('puesto', 'DIRECTOR GENERAL').eq('activo', true).limit(1).maybeSingle();
  return data ? { emp: data, tel: await telefonoDeEmpleado(sb, data) } : null;
}

/** Leads a los que pertenece un teléfono: contactos_externos y leads.contact_phone. */
export async function leadsDeTelefono(sb: any, tel: string): Promise<{ lead: any; nombre: string; autorizado: boolean }[]> {
  const t10 = last10(tel);
  const [{ data: ce }, { data: ld }] = await Promise.all([
    sb.from('contactos_externos').select('nombre, lead_id, telefono, recibe_estado_cuenta, leads(id, name, company)').eq('activo', true).not('lead_id', 'is', null),
    sb.from('leads').select('id, name, company, contact_name, contact_phone').is('archived_at', null).not('contact_phone', 'is', null),
  ]);
  const out = new Map<string, { lead: any; nombre: string; autorizado: boolean }>();
  for (const c of ce || []) if (last10(c.telefono || '') === t10 && c.leads) out.set(c.lead_id, { lead: c.leads, nombre: c.nombre, autorizado: !!c.recibe_estado_cuenta });
  for (const l of ld || []) if (last10(l.contact_phone || '') === t10 && !out.has(l.id)) out.set(l.id, { lead: l, nombre: l.contact_name || l.name, autorizado: false });
  return [...out.values()];
}

/** El cliente pidió su estado de cuenta. true = ya se atendió (no seguir con el flujo de tickets). */
export async function intentarEstadoCuentaCliente(sb: any, msg: any, texto: string): Promise<boolean> {
  if (!pideEstadoDeCuenta(texto)) return false;
  const tel10 = last10(msg.from);
  const dg = await elDG(sb);
  const leads = await leadsDeTelefono(sb, msg.from);
  await logWa(sb, { direction: 'in', phone_e164: '+' + msg.from, wa_message_id: msg.id, kind: msg.type, body: texto, sender_type: leads.length ? 'cliente' : 'desconocido' });
  try { await markAsRead(msg.id); } catch (_) { /* no crítico */ }

  if (!leads.length) {
    await responder(sb, msg.from, 'Con gusto. Déjame verificar tus datos y te lo compartimos en breve.', { sender_type: 'desconocido' });
    if (dg?.tel) {
      const t = `📄 El número +52 ${tel10} pidió su estado de cuenta por WhatsApp, pero no está ligado a ningún cliente.\n«${texto.slice(0, 300)}»\nSi es cliente, dalo de alta en CRM → su lead → Contactos y me lo vuelve a pedir.`;
      await avisar(sb, dg.tel, primerNombre(dg.emp.nombre), t, `un número no registrado (${tel10}) pidió su estado de cuenta; dalo de alta en el CRM si es cliente`, 'aprobacion');
      await alHistorial(sb, dg.emp.id, t);
    }
    return true;
  }

  // ¿Ya está pendiente? No se arma dos veces el mismo día.
  const { data: ya } = await sb.from('wa_aprobaciones').select('id').eq('para_tel10', tel10).in('estado', ['pendiente'])
    .gte('created_at', new Date(Date.now() - 24 * 3600e3).toISOString()).limit(1);
  if (ya?.length) { await responder(sb, msg.from, 'Ya lo estamos preparando, en un momento te lo compartimos.', { sender_type: 'cliente' }); return true; }
  if (!dg?.tel) { await responder(sb, msg.from, 'Con gusto, en un momento te lo compartimos.', { sender_type: 'cliente' }); return true; }

  await responder(sb, msg.from, `Con gusto${leads[0].nombre ? ', ' + primerNombre(leads[0].nombre) : ''}. En un momento te lo compartimos por aquí.`, { sender_type: 'cliente' });

  const { data: pend } = await sb.from('wa_aprobaciones').select('numero').eq('aprobador_tel10', last10(dg.tel)).eq('estado', 'pendiente');
  let numero = Math.max(0, ...(pend || []).map((p: any) => p.numero));
  for (const x of leads.slice(0, 3)) {
    const datos = await datosEstadoCuenta(sb, x.lead.id, { name: x.lead.name, company: x.lead.company });
    numero++;
    if (!datos.quotations.length) {
      await sb.from('wa_aprobaciones').insert({ numero, tipo: 'estado_cuenta', estado: 'fallida', aprobador_tel10: last10(dg.tel), para_tel10: tel10, para_nombre: x.nombre, lead_id: x.lead.id, solicitud: texto.slice(0, 500), motivo_error: 'sin contratos vigentes' });
      const t = `📄 ${x.nombre} (${x.lead.name}) pidió su estado de cuenta, pero ese lead no tiene contratos vigentes. No le mandé nada; contéstale tú.`;
      await avisar(sb, dg.tel, primerNombre(dg.emp.nombre), t, t, 'aprobacion');
      await alHistorial(sb, dg.emp.id, t);
      continue;
    }
    const bytes = new Uint8Array(generarEstadoCuentaPdf(datos).output('arraybuffer') as ArrayBuffer);
    const archivo = nombreArchivoEstadoCuenta(x.lead.name);
    const path = `aprobaciones/${tel10}/${Date.now()}-${archivo.replace(/[^\w.\-]+/g, '_')}`;
    const { error: eUp } = await sb.storage.from('agent-documents').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (eUp) { console.error('aprobacion upload', eUp); continue; }
    const caption = `📄 *${numero}.* ${x.nombre} (${x.lead.name}) pidió su estado de cuenta por WhatsApp:\n«${texto.slice(0, 200)}»\n¿Se lo mando? Contesta *sí${numero > 1 ? ' ' + numero : ''}* o *no${numero > 1 ? ' ' + numero : ''}*.` +
      (x.autorizado ? '' : '\n(No está marcado como "recibe estado de cuenta" en sus contactos.)');
    await sb.from('wa_aprobaciones').insert({ numero, tipo: 'estado_cuenta', aprobador_tel10: last10(dg.tel), para_tel10: tel10, para_nombre: x.nombre, lead_id: x.lead.id, documento_path: path, documento_nombre: archivo, caption: `Estado de cuenta · ${x.lead.name}`, solicitud: texto.slice(0, 500) });
    await avisarDocumento(sb, dg.tel, primerNombre(dg.emp.nombre), { bytes, filename: archivo, mime: 'application/pdf', caption }, `${x.nombre} pidió su estado de cuenta de ${x.lead.name}; revisa el PDF y contesta sí o no`, 'aprobacion');
    await alHistorial(sb, dg.emp.id, caption.replace(/\*/g, '') + ' (te mandé el PDF)');
  }
  return true;
}

const SI = /^\s*(s[ií]|sip|claro|dale|adelante|ok|va|m[aá]nd\w*|env[ií]a\w*|aprobado|autorizado)(?![a-záéíóúñ])([\s,.!]+(m[aá]nd\w*|env[ií]a\w*|por\s+favor))*[\s,.!]*(?<n>\d{1,2})?\s*[.!]*$/i;
const NO = /^\s*(no|nel|todav[ií]a\s+no|no\s+se\s+lo\s+mandes|espera)(?![a-záéíóúñ])[\s,.!]*(?<n>\d{1,2})?\s*[.!]*$/i;

/** Elias contestando "sí" / "no" a una aprobación pendiente. */
export async function intentarAprobacion(sb: any, msg: any): Promise<'no' | 'listo'> {
  if (msg.type !== 'text') return 'no';
  const texto = String(msg.text?.body || '');
  const si = texto.match(SI), no = texto.match(NO);
  if (!si && !no) return 'no';
  const { data: pend } = await sb.from('wa_aprobaciones').select('*').eq('aprobador_tel10', last10(msg.from)).eq('estado', 'pendiente')
    .gte('created_at', new Date(Date.now() - 72 * 3600e3).toISOString()).order('numero');
  if (!pend?.length) return 'no';
  const n = Number((si || no)!.groups?.n || 0);
  // Un "sí" / "ok" / "no" suelto sólo cuenta si lo último que le mandé fue la
  // pregunta: Elias contesta "ok" a muchas cosas y esto manda un documento
  // financiero a un tercero. Con número ("sí 2") no hay ambigüedad.
  if (!n) {
    const { data: ult } = await sb.from('whatsapp_messages').select('body').eq('direction', 'out').ilike('phone_e164', '%' + last10(msg.from))
      .order('created_at', { ascending: false }).limit(1);
    if (!/se lo mando\?|pidi[oó] su estado de cuenta|contesta \*?ver/i.test(String(ult?.[0]?.body || ''))) return 'no';
  }
  await logWa(sb, { direction: 'in', phone_e164: '+' + msg.from, wa_message_id: msg.id, kind: 'text', body: texto, sender_type: 'equipo' });
  try { await markAsRead(msg.id); } catch (_) { /* no crítico */ }
  const ap = n ? pend.find((p: any) => p.numero === n) : pend.length === 1 ? pend[0] : null;
  if (!ap) {
    await responder(sb, msg.from, `¿Cuál? Tengo ${pend.length} pendientes:\n${pend.map((p: any) => `${p.numero}. ${p.para_nombre} — ${p.caption || p.tipo}`).join('\n')}\nContesta *sí N* o *no N*.`, { sender_type: 'equipo' });
    return 'listo';
  }
  const ahora = new Date().toISOString();
  if (no) {
    await sb.from('wa_aprobaciones').update({ estado: 'rechazada', decidido_at: ahora }).eq('id', ap.id).eq('estado', 'pendiente');
    await responder(sb, msg.from, `Va, no se lo mando a ${ap.para_nombre}. Contéstale tú cuando quieras.`, { sender_type: 'equipo' });
    return 'listo';
  }
  // Reclamar antes de mandar: un doble "sí" no lo manda dos veces.
  const { data: tomada } = await sb.from('wa_aprobaciones').update({ estado: 'aprobada', decidido_at: ahora }).eq('id', ap.id).eq('estado', 'pendiente').select('id');
  if (!tomada?.length) return 'listo';
  if (!(await ventanaAbierta(sb, ap.para_tel10))) {
    await sb.from('wa_aprobaciones').update({ estado: 'fallida', motivo_error: 'ventana de 24 h cerrada' }).eq('id', ap.id);
    await responder(sb, msg.from, `No se lo pude mandar a ${ap.para_nombre}: pasaron más de 24 h desde que escribió y WhatsApp ya no deja mandarle archivos. Cuando vuelva a escribir, pídemelo otra vez.`, { sender_type: 'equipo' });
    return 'listo';
  }
  const { data: blob } = await sb.storage.from('agent-documents').download(ap.documento_path);
  if (!blob) {
    await sb.from('wa_aprobaciones').update({ estado: 'fallida', motivo_error: 'no se encontró el PDF' }).eq('id', ap.id);
    await responder(sb, msg.from, 'No encontré el PDF guardado. Pídemelo otra vez.', { sender_type: 'equipo' });
    return 'listo';
  }
  const r = await mandarDocumento(sb, ap.para_tel10, { bytes: new Uint8Array(await blob.arrayBuffer()), filename: ap.documento_nombre || 'estado_de_cuenta.pdf', mime: 'application/pdf', caption: `${ap.caption || 'Estado de cuenta'}. Cualquier duda, aquí estamos. — OMM Technologies` }, { sender_type: 'cliente' });
  await sb.from('wa_aprobaciones').update({ estado: r.ok ? 'enviada' : 'fallida', motivo_error: r.error || null }).eq('id', ap.id);
  await responder(sb, msg.from, r.ok ? `✅ Se lo mandé a ${ap.para_nombre}.` : `⚠️ WhatsApp no lo aceptó: ${r.error}`, { sender_type: 'equipo' });
  return 'listo';
}
