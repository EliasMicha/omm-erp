// Edge Function: whatsapp-send
// Salientes de WhatsApp desde el ERP (usuario con sesión de Supabase Auth).
//   status          → número conectado + plantillas y su estado de aprobación
//   setup_templates → crea en Meta las plantillas de OMM que falten (DG/Administración)
//   send_template   → { to, template, params[] }
//   send_text       → { to, text }  (solo funciona si esa persona escribió en las últimas 24 h)
//   visit_notify    → { visit_id, kind: 'programada' | 'en_camino' }
//   send_document   → { to, documento: { tipo: 'cotizacion', cotizacion_id, formato? }
//                                    | { tipo: 'estado_cuenta', lead_id, cotizaciones?: string[] }
//                                    | { tipo: 'archivo', base64, filename, mime }, caption? }
//                     Con la ventana de 24 h abierta sale el archivo. Cerrada: a alguien del
//                     equipo le llega el aviso y el archivo cuando conteste; a un cliente no se
//                     puede (Meta sólo deja plantillas de texto) y se explica.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { sendTemplate, sendText, graphGet, graphPost, getWhatsAppCredentials, toSendPhone, uploadMedia, sendDocument } from './whatsapp.ts';
import { generarEstadoCuentaPdf } from '../_shared/estadoCuentaPdf.ts';
import { datosEstadoCuenta, nombreArchivoEstadoCuenta } from '../_shared/estadoCuenta.ts';
import { logWa, waIdFrom } from './log.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Plantillas de OMM (categoría UTILITY, español México). Meta no acepta que el texto empiece o termine con variable.
const TEMPLATES = [
  {
    name: 'omm_visita_programada',
    text: 'Hola {{1}}, confirmamos tu visita de servicio de OMM Technologies en {{2}} el {{3}} a las {{4}}. Te atenderá {{5}}. Si necesitas cambiar el horario, responde a este mensaje.',
    example: ['Ana', 'Casa Lomas', 'lunes 27 de octubre', '10:00', 'Juan Pérez'],
  },
  {
    name: 'omm_tecnico_en_camino',
    text: 'Hola {{1}}, {{2}} de OMM Technologies va en camino a {{3}} para tu visita de servicio. Si necesitas algo, responde a este mensaje.',
    example: ['Ana', 'Juan Pérez', 'Casa Lomas'],
  },
  {
    name: 'omm_ticket_actualizado',
    text: 'Hola {{1}}, tu reporte #{{2}} con OMM Technologies cambió de estado: {{3}}. Responde a este mensaje si tienes dudas.',
    example: ['Ana', '128', 'resuelto'],
  },
  {
    name: 'omm_aviso_equipo',
    text: 'Hola {{1}}, tienes un aviso del ERP de OMM: {{2}}. Responde a este mensaje para atenderlo con el asistente.',
    example: ['Ricardo', 'tienes 3 tareas por vencer hoy'],
  },
];

function render(name: string, params: string[]) {
  const t = TEMPLATES.find(x => x.name === name);
  if (!t) return `[${name}] ${params.join(' | ')}`;
  return t.text.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? '');
}

async function whoIs(req: Request): Promise<{ uid: string; area: string | null; installer: boolean; auth?: string; estadoCuenta?: boolean } | null> {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: au } = await admin.from('app_users').select('permission_area, activo, es_bot, puede_estado_cuenta').eq('auth_user_id', uid).maybeSingle();
  if (au && au.activo && !au.es_bot) return { uid, area: au.permission_area, installer: false, auth, estadoCuenta: au.permission_area === 'DG' || !!au.puede_estado_cuenta };
  const { data: emp } = await admin.from('employees').select('id').eq('auth_user_id', uid).maybeSingle();
  if (emp) return { uid, area: null, installer: true };
  return null;
}

async function sendAndLog(to: string, template: string, params: string[], extra: Record<string, unknown>) {
  const dest = toSendPhone(to);
  const body = render(template, params);
  try {
    const resp = await sendTemplate(dest, template, params);
    const id = waIdFrom(resp);
    await logWa(admin, { direction: 'out', phone_e164: '+' + dest, wa_message_id: id, kind: 'template', template_name: template, body, status: 'enviado', ...extra });
    return { ok: true, wa_message_id: id, to: '+' + dest };
  } catch (e) {
    await logWa(admin, { direction: 'out', phone_e164: '+' + dest, kind: 'template', template_name: template, body, status: 'fallido', error: String(e), ...extra });
    return { ok: false, error: String(e), to: '+' + dest };
  }
}

function fechaLarga(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' });
}

async function visitNotify(visitId: string, kind: string, uid: string) {
  const { data: v, error } = await admin.from('maintenance_visits')
    .select('id, property_id, ticket_id, visit_date, scheduled_time, technician, technician_id, property:maintenance_properties(name, address)')
    .eq('id', visitId).maybeSingle();
  if (error || !v) return { ok: false, error: 'Visita no encontrada' };
  const { data: contacts } = await admin.from('maintenance_contacts')
    .select('id, name, phone_e164, is_primary').eq('property_id', v.property_id).not('phone_e164', 'is', null)
    .order('is_primary', { ascending: false });
  const c = (contacts || []).find((x: any) => (x.phone_e164 || '').replace(/\D/g, '').length >= 10);
  if (!c) return { ok: false, error: 'La propiedad no tiene contacto con teléfono (Expediente → Contactos).' };
  let tecnico = v.technician || '';
  if (v.technician_id) {
    const { data: e } = await admin.from('employees').select('*').eq('id', v.technician_id).maybeSingle();
    if (e) tecnico = e.nombre || e.name || e.full_name || tecnico;
  }
  tecnico = tecnico || 'nuestro técnico';
  const nombre = (c.name || '').split(' ')[0] || 'cliente';
  const lugar = (v as any).property?.name || 'tu propiedad';
  const extra = { sender_type: 'cliente', maintenance_contact_id: c.id, property_id: v.property_id, ticket_id: v.ticket_id, visit_id: v.id, sent_by: uid };
  if (kind === 'en_camino') {
    return await sendAndLog(c.phone_e164, 'omm_tecnico_en_camino', [nombre, tecnico, lugar], extra);
  }
  const hora = (v.scheduled_time || '').slice(0, 5) || 'la hora acordada';
  const r = await sendAndLog(c.phone_e164, 'omm_visita_programada', [nombre, lugar, fechaLarga(v.visit_date), hora, tecnico], extra);
  if (r.ok) await admin.from('maintenance_visits').update({ client_notified_at: new Date().toISOString() }).eq('id', v.id);
  return r;
}

// ── Documentos ──────────────────────────────────────────────────────────────
const ult10 = (t: string) => String(t || '').replace(/\D/g, '').slice(-10);
const b64aBytes = (b64: string) => { const bin = atob(b64.replace(/^data:[^,]+,/, '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

async function esDelEquipo(tel10: string): Promise<{ id: string; nombre: string } | null> {
  const { data } = await admin.from('employees').select('id, nombre, telefono_personal, obra_app_phone, phone').eq('activo', true);
  const e = (data || []).find((x: any) => [x.telefono_personal, x.obra_app_phone, x.phone].some((t: string) => ult10(t) === tel10));
  if (e) return e;
  const { data: ac } = await admin.from('agent_contacts').select('display_name, phone_e164, employee_id').eq('is_active', true);
  const a = (ac || []).find((x: any) => ult10(x.phone_e164) === tel10);
  return a ? { id: a.employee_id || '', nombre: a.display_name } : null;
}

async function prepararDocumento(p: any, who: any): Promise<{ bytes: Uint8Array; filename: string; mime: string; caption: string; interno?: boolean } | { error: string }> {
  const d = p.documento || {};
  const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: who.auth } } });
  if (d.tipo === 'cotizacion') {
    if (!d.cotizacion_id) return { error: 'Falta cotizacion_id.' };
    // Con el cliente de la persona: si RLS no le deja ver la cotización, no la manda.
    const { data: cot } = await user.from('quotations').select('id, folio, name, total_final, total').eq('id', d.cotizacion_id).maybeSingle();
    if (!cot) return { error: 'No encontré esa cotización (o no tienes acceso).' };
    const { data: pdfs } = await user.from('cotizacion_pdfs').select('formato, interno, storage_path, filename, total_al_generar, generado_at').eq('quotation_id', cot.id).order('generado_at', { ascending: false });
    const pdf = d.formato ? (pdfs || []).find((x: any) => x.formato === d.formato) : ((pdfs || []).find((x: any) => !x.interno) || null);
    if (!pdf) return { error: `${cot.folio || cot.name} no tiene PDF${d.formato ? ' ' + d.formato : ''} guardado: ábrela en el ERP y dale "Descargar PDF" una vez.` };
    const { data: blob, error } = await admin.storage.from('cotizaciones-pdf').download(pdf.storage_path);
    if (error || !blob) return { error: 'No pude leer el PDF guardado.' };
    const hoy = Number(cot.total_final ?? cot.total), antes = pdf.total_al_generar == null ? null : Number(pdf.total_al_generar);
    if (antes != null && Math.abs(hoy - antes) > 0.01 && !d.aunque_este_viejo) return { error: `El PDF guardado es anterior al último cambio de la cotización (era ${antes}, hoy ${hoy}). Descárgala otra vez en el ERP antes de mandarla.` };
    return { bytes: new Uint8Array(await blob.arrayBuffer()), filename: pdf.filename, mime: 'application/pdf', caption: p.caption || `${cot.folio || ''} · ${cot.name}`.replace(/^ · /, ''), interno: !!pdf.interno };
  }
  if (d.tipo === 'estado_cuenta') {
    if (!who.estadoCuenta) return { error: 'Tu usuario no tiene permiso de estados de cuenta.' };
    if (!d.lead_id) return { error: 'Falta lead_id.' };
    const { data: lead } = await user.from('leads').select('id, name, company').eq('id', d.lead_id).maybeSingle();
    if (!lead) return { error: 'No encontré ese lead.' };
    const datos = await datosEstadoCuenta(user, lead.id, { name: lead.name, company: lead.company });
    if (!datos.quotations.length) return { error: `${lead.name} no tiene contratos vigentes: no hay estado de cuenta.` };
    if (Array.isArray(d.cotizaciones) && d.cotizaciones.length) datos.soloCotizaciones = d.cotizaciones;
    const bytes = new Uint8Array(generarEstadoCuentaPdf(datos).output('arraybuffer') as ArrayBuffer);
    return { bytes, filename: nombreArchivoEstadoCuenta(lead.name), mime: 'application/pdf', caption: p.caption || `Estado de cuenta · ${lead.name}` };
  }
  if (d.tipo === 'archivo') {
    if (!d.base64 || !d.filename) return { error: 'Falta el archivo.' };
    const bytes = b64aBytes(String(d.base64));
    if (bytes.length > 15 * 1024 * 1024) return { error: 'El archivo pasa de 15 MB.' };
    return { bytes, filename: String(d.filename).replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]+/g, '_'), mime: String(d.mime || 'application/octet-stream'), caption: p.caption || '' };
  }
  return { error: 'documento.tipo es cotizacion, estado_cuenta o archivo.' };
}

async function sendDocumentAction(p: any, who: any) {
  if (!['DG', 'Administracion', 'Ventas_Ingenieria'].includes(who.area || '')) return { ok: false, error: 'Mandar documentos es para Dirección, Administración y Ventas/Ingeniería.' };
  if (!p.to) return { ok: false, error: 'Falta a quién (to).' };
  const tel10 = ult10(p.to);
  const doc = await prepararDocumento(p, who);
  if ('error' in doc) return { ok: false, error: doc.error };
  const equipo = await esDelEquipo(tel10);
  if (doc.interno && !equipo) return { ok: false, error: 'Ese PDF es el formato técnico (trae costos internos): no sale a un cliente. Manda el ejecutivo.' };
  const { data: rec } = await admin.from('whatsapp_messages').select('id').eq('direction', 'in').ilike('phone_e164', '%' + tel10)
    .gte('created_at', new Date(Date.now() - 23.5 * 3600e3).toISOString()).limit(1);
  const ventana = !!rec?.length;
  // Copia de lo que salió, para la bitácora.
  const path = `enviados/${tel10}/${Date.now()}-${doc.filename.replace(/[^\w.\-]+/g, '_')}`;
  await admin.storage.from('agent-documents').upload(path, doc.bytes, { contentType: doc.mime, upsert: true });
  const dest = toSendPhone('+52' + tel10);
  if (!ventana) {
    if (!equipo) return { ok: false, error: 'No ha escrito en las últimas 24 h: WhatsApp no deja mandarle archivos (sólo plantillas de texto). Pídele que escriba al número de OMM y vuelve a intentarlo.' };
    await admin.from('wa_pendientes_entrega').insert({ telefono10: tel10, texto: doc.caption || doc.filename, motivo: 'documento', documento_path: path, documento_nombre: doc.filename, caption: doc.caption || null });
    const nombre = (equipo.nombre || '').split(/\s+/)[0] || 'equipo';
    const param = `te mandaron ${doc.caption || doc.filename} — contesta *ver* y te lo mando`.slice(0, 900);
    const r = await sendAndLog(dest, 'omm_aviso_equipo', [nombre, param], { sender_type: 'equipo', sent_by: who.uid });
    return { ...r, diferido: true, nota: 'Le llegó el aviso; el archivo se le entrega cuando conteste.' };
  }
  try {
    const mediaId = await uploadMedia(doc.bytes, doc.mime, doc.filename);
    const resp = await sendDocument(dest, mediaId, doc.filename, doc.caption || undefined);
    await logWa(admin, { direction: 'out', phone_e164: '+' + dest, wa_message_id: waIdFrom(resp), kind: 'document', body: (doc.caption ? doc.caption + ' ' : '') + `(${doc.filename})`, media_path: path, status: 'enviado', sent_by: who.uid, sender_type: equipo ? 'equipo' : 'cliente' });
    return { ok: true, archivo: doc.filename };
  } catch (e) {
    await logWa(admin, { direction: 'out', phone_e164: '+' + dest, kind: 'document', body: doc.caption || doc.filename, media_path: path, status: 'fallido', error: String(e), sent_by: who.uid });
    return { ok: false, error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  const who = await whoIs(req);
  if (!who) return json({ ok: false, error: 'No autorizado' }, 401);
  let p: any = {};
  try { p = await req.json(); } catch (_) { /* vacío */ }
  const action = p.action || 'status';
  const isAdmin = who.area === 'DG' || who.area === 'Administracion';

  try {
    if (action === 'visit_notify') {
      if (!p.visit_id) return json({ ok: false, error: 'visit_id requerido' }, 400);
      return json(await visitNotify(p.visit_id, p.kind === 'en_camino' ? 'en_camino' : 'programada', who.uid));
    }
    if (who.installer) return json({ ok: false, error: 'No autorizado' }, 403);

    if (action === 'status') {
      const wabaId = Deno.env.get('WHATSAPP_WABA_ID') || '';
      let phone: any = null, templates: any[] = [], err: string | null = null;
      try {
        const { phoneNumberId } = await getWhatsAppCredentials();
        phone = await graphGet(`${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type,throughput`);
        phone.id = phoneNumberId;
        if (wabaId) {
          const t = await graphGet(`${wabaId}/message_templates?fields=name,status,language,category,rejected_reason&limit=100`);
          templates = (t.data || []).filter((x: any) => x.name.startsWith('omm_'));
        }
      } catch (e) { err = String(e); }
      return json({ ok: !err, configured: !!phone, waba_id: wabaId || null, phone, templates, expected: TEMPLATES.map(t => t.name), error: err });
    }

    if (action === 'setup_templates') {
      if (!isAdmin) return json({ ok: false, error: 'Solo DG / Administración' }, 403);
      const wabaId = Deno.env.get('WHATSAPP_WABA_ID');
      if (!wabaId) return json({ ok: false, error: 'Falta el secreto WHATSAPP_WABA_ID' }, 400);
      const existing = await graphGet(`${wabaId}/message_templates?fields=name&limit=200`);
      const have = new Set((existing.data || []).map((x: any) => x.name));
      const results: any[] = [];
      for (const t of TEMPLATES) {
        if (have.has(t.name)) { results.push({ name: t.name, skipped: true }); continue; }
        try {
          const r = await graphPost(`${wabaId}/message_templates`, {
            name: t.name, language: 'es_MX', category: 'UTILITY',
            components: [{ type: 'BODY', text: t.text, example: { body_text: [t.example] } }],
          });
          results.push({ name: t.name, ok: true, status: r.status });
        } catch (e) { results.push({ name: t.name, ok: false, error: String(e) }); }
      }
      return json({ ok: true, results });
    }

    if (action === 'send_template') {
      if (!p.to || !p.template) return json({ ok: false, error: 'to y template requeridos' }, 400);
      return json(await sendAndLog(p.to, p.template, (p.params || []).map(String), { sender_type: p.sender_type || 'desconocido', sent_by: who.uid }));
    }

    if (action === 'send_text') {
      if (!p.to || !p.text) return json({ ok: false, error: 'to y text requeridos' }, 400);
      const dest = toSendPhone(p.to);
      try {
        const resp = await sendText(dest, String(p.text));
        await logWa(admin, { direction: 'out', phone_e164: '+' + dest, wa_message_id: waIdFrom(resp), kind: 'text', body: String(p.text), status: 'enviado', sent_by: who.uid });
        return json({ ok: true });
      } catch (e) {
        await logWa(admin, { direction: 'out', phone_e164: '+' + dest, kind: 'text', body: String(p.text), status: 'fallido', error: String(e), sent_by: who.uid });
        return json({ ok: false, error: String(e) });
      }
    }
    if (action === 'send_document') return json(await sendDocumentAction(p, who));
    return json({ ok: false, error: `Acción desconocida: ${action}` }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
