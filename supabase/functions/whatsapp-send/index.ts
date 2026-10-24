// Edge Function: whatsapp-send
// Salientes de WhatsApp desde el ERP (usuario con sesión de Supabase Auth).
//   status          → número conectado + plantillas y su estado de aprobación
//   setup_templates → crea en Meta las plantillas de OMM que falten (DG/Administración)
//   send_template   → { to, template, params[] }
//   send_text       → { to, text }  (solo funciona si esa persona escribió en las últimas 24 h)
//   visit_notify    → { visit_id, kind: 'programada' | 'en_camino' }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { sendTemplate, sendText, graphGet, graphPost, getWhatsAppCredentials, toSendPhone } from './whatsapp.ts';
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

async function whoIs(req: Request): Promise<{ uid: string; area: string | null; installer: boolean } | null> {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: au } = await admin.from('app_users').select('permission_area, activo, es_bot').eq('auth_user_id', uid).maybeSingle();
  if (au && au.activo && !au.es_bot) return { uid, area: au.permission_area, installer: false };
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
    return json({ ok: false, error: `Acción desconocida: ${action}` }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
