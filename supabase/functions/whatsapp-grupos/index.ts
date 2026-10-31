// Edge Function: whatsapp-grupos (2026-10-30)
// Grupos de WhatsApp del número de OMM, para DG y Administración. El bot NO habla
// en los grupos: aquí sólo se crean, se invita gente y se escribe a nombre de quien
// está en el ERP.
//
//   diag        → prueba la Groups API (también con la llave del cron, desde SQL)
//   crear       → { nombre, descripcion?, tipo: 'obra'|'interno', obra_id?, lead_id?, aprobacion? }
//   info        → { group_id }  participantes, liga y solicitudes pendientes (y las guarda)
//   invitar     → { group_id, to, nombre? }  le manda la liga por su chat individual
//   enviar      → { group_id, text } | { group_id, archivo: { base64, filename, mime }, caption? }
//   quitar      → { group_id, telefono }
//   nueva_liga  → { group_id }  (la anterior deja de servir)
//   solicitud   → { group_id, ids[], aprobar: boolean }
//   borrar      → { group_id }
//
// Deploy: verify_jwt=false (revisa el JWT o x-cron-key por dentro).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getWhatsAppCredentials, sendText, sendTemplate, toSendPhone, uploadMedia } from '../whatsapp-send/whatsapp.ts';
import { logWa, waIdFrom } from '../whatsapp-send/log.ts';
import { TEMPLATES } from '../_shared/waPlantillas.ts';
import * as G from '../_shared/waGrupos.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const ult10 = (t: string) => String(t || '').replace(/\D/g, '').slice(-10);
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));
const render = (name: string, params: string[]) => (TEMPLATES.find(x => x.name === name)?.text || name).replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? '');

async function quien(req: Request): Promise<{ ok: boolean; uid?: string; nombre?: string; cron?: boolean }> {
  const key = req.headers.get('x-cron-key');
  if (key) {
    const { data } = await sb.rpc('reportes_cron_ok', { p_key: key });
    return { ok: data === true, cron: true };
  }
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false };
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) return { ok: false };
  const { data: au } = await sb.from('app_users').select('permission_area, activo, es_bot, nombre').eq('auth_user_id', u.user.id).maybeSingle();
  if (!au?.activo || au.es_bot || !['DG', 'Administracion'].includes(au.permission_area)) return { ok: false };
  return { ok: true, uid: u.user.id, nombre: String(au.nombre || 'OMM').split(/\s+/)[0] };
}

async function esDelEquipo(tel10: string): Promise<{ nombre: string } | null> {
  const { data } = await sb.from('employees').select('nombre, telefono_personal, obra_app_phone, phone').eq('activo', true);
  const e = (data || []).find((x: any) => [x.telefono_personal, x.obra_app_phone, x.phone].some((t: string) => ult10(t) === tel10));
  if (e) return e;
  const { data: ac } = await sb.from('agent_contacts').select('display_name, phone_e164').eq('is_active', true);
  const a = (ac || []).find((x: any) => ult10(x.phone_e164) === tel10);
  return a ? { nombre: a.display_name } : null;
}

async function grupo(gid: string) {
  const { data } = await sb.from('whatsapp_grupos').select('*').eq('group_id', gid).maybeSingle();
  return data;
}

// ── crear ───────────────────────────────────────────────────────────────────
async function crear(p: any, who: any) {
  const { data: aj } = await sb.from('whatsapp_ajustes').select('valor').eq('clave', 'grupos_listos').maybeSingle();
  if (aj?.valor !== true) return { ok: false, error: 'Los grupos todavía no están activados: falta publicar la versión del asistente que separa los mensajes de grupo. Si se crea antes, lo que escriban en el grupo le llegaría al asistente como mensaje privado.' };
  const nombre = String(p.nombre || '').trim();
  if (!nombre) return { ok: false, error: 'Falta el nombre del grupo.' };
  const tipo = p.tipo === 'interno' ? 'interno' : 'obra';
  const cred = await getWhatsAppCredentials();
  const antes = new Set((await G.listarGrupos(cred).catch(() => [])).map(g => g.id));
  const { data: row, error } = await sb.from('whatsapp_grupos').insert({
    nombre, descripcion: p.descripcion || null, tipo, obra_id: p.obra_id || null, lead_id: p.lead_id || null,
    join_approval_mode: p.aprobacion ? 'approval_required' : 'auto_approve', created_by: who.uid || null,
  }).select('*').single();
  if (error) return { ok: false, error: error.message };
  let resp: any;
  try { resp = await G.crearGrupo(cred, nombre, p.descripcion, !!p.aprobacion); }
  catch (e) {
    await sb.from('whatsapp_grupos').update({ estado: 'error', error: String(e).slice(0, 500), updated_at: new Date().toISOString() }).eq('id', row.id);
    return { ok: false, error: 'Meta no creó el grupo: ' + String(e) };
  }
  // Crear es asíncrono. Si la respuesta no trae el id, se busca el grupo nuevo en
  // la lista (el webhook group_lifecycle_update también lo completa).
  let gid: string | null = resp?.id || resp?.group_id || null;
  for (let i = 0; !gid && i < 6; i++) {
    await espera(1500);
    const lista = await G.listarGrupos(cred).catch(() => []);
    const nuevo = lista.find(g => !antes.has(g.id) && String(g.subject || '').trim() === nombre.slice(0, 128));
    if (nuevo) gid = nuevo.id;
  }
  if (!gid) {
    await sb.from('whatsapp_grupos').update({ error: 'Meta aceptó la creación; el grupo aparece en cuanto confirme (unos segundos).', updated_at: new Date().toISOString() }).eq('id', row.id);
    return { ok: true, pendiente: true, id: row.id, nota: 'Meta está creando el grupo. Aparece en la lista en unos segundos.' };
  }
  const liga = await G.ligaGrupo(cred, gid).catch(() => null);
  await sb.from('whatsapp_grupos').update({ group_id: gid, invite_link: liga, estado: 'activo', error: null, updated_at: new Date().toISOString() }).eq('id', row.id);
  return { ok: true, group_id: gid, invite_link: liga };
}

// ── info ────────────────────────────────────────────────────────────────────
async function info(gid: string) {
  const cred = await getWhatsAppCredentials();
  const [i, liga] = await Promise.all([G.infoGrupo(cred, gid), G.ligaGrupo(cred, gid).catch(() => null)]);
  const sol = i?.join_approval_mode === 'approval_required' ? await G.solicitudes(cred, gid).catch(() => []) : [];
  await sb.from('whatsapp_grupos').update({
    participantes: i?.participants || [], invite_link: liga, nombre: i?.subject || undefined,
    estado: i?.suspended === true || i?.suspended === 'true' ? 'suspendido' : 'activo', updated_at: new Date().toISOString(),
  }).eq('group_id', gid);
  return { ok: true, participantes: i?.participants || [], total: Number(i?.total_participant_count || (i?.participants || []).length), invite_link: liga, solicitudes: sol, suspendido: i?.suspended === true || i?.suspended === 'true' };
}

// ── invitar: la liga le llega por su chat individual ────────────────────────
async function invitar(p: any, who: any) {
  const g = await grupo(p.group_id);
  if (!g?.group_id) return { ok: false, error: 'No encontré ese grupo.' };
  const tel10 = ult10(p.to);
  if (tel10.length !== 10) return { ok: false, error: 'El número debe tener 10 dígitos.' };
  const cred = await getWhatsAppCredentials();
  const liga = g.invite_link || await G.ligaGrupo(cred, g.group_id);
  if (!liga) return { ok: false, error: 'El grupo no tiene liga de invitación.' };
  const nPart = Array.isArray(g.participantes) ? g.participantes.length : 0;
  if (nPart >= G.MAX_PARTICIPANTES) return { ok: false, error: `El grupo ya tiene ${nPart} participantes: WhatsApp no deja más de ${G.MAX_PARTICIPANTES}.` };
  const dest = toSendPhone('+52' + tel10);
  const equipo = await esDelEquipo(tel10);
  const destinatario = String(p.nombre || equipo?.nombre || '').trim().split(/\s+/)[0].replace(/^\+.*/, '') || (equipo ? 'equipo' : 'buen día');
  const { data: rec } = await sb.from('whatsapp_messages').select('id').eq('direction', 'in').ilike('phone_e164', '%' + tel10)
    .gte('created_at', new Date(Date.now() - 23.5 * 3600e3).toISOString()).limit(1);
  const extra = { sender_type: equipo ? 'equipo' : 'cliente', sent_by: who.uid || null } as const;
  try {
    if (rec?.length) {
      const texto = `${destinatario}, te invito al grupo de WhatsApp *${g.nombre}* de OMM. Entra con esta liga:\n${liga}`;
      const resp = await sendText(dest, texto);
      await logWa(sb, { direction: 'out', phone_e164: '+' + dest, wa_message_id: waIdFrom(resp), kind: 'text', body: texto, status: 'enviado', ...extra });
      return { ok: true, como: 'texto' };
    }
    const plano = `te invito al grupo de WhatsApp «${g.nombre}» de OMM. Entra con esta liga: ${liga}`;
    const [tpl, params] = equipo
      ? ['omm_aviso_equipo', [destinatario, `de parte de ${who.nombre || 'OMM'}: ${plano}`]]
      : ['omm_mensaje_cliente', [destinatario, who.nombre || 'OMM', plano]];
    const resp = await sendTemplate(dest, tpl, params as string[]);
    await logWa(sb, { direction: 'out', phone_e164: '+' + dest, wa_message_id: waIdFrom(resp), kind: 'template', template_name: tpl, body: render(tpl, params as string[]), status: 'enviado', ...extra });
    return { ok: true, como: 'plantilla ' + tpl };
  } catch (e) {
    await logWa(sb, { direction: 'out', phone_e164: '+' + dest, kind: 'text', body: `Invitación al grupo ${g.nombre}`, status: 'fallido', error: String(e).slice(0, 400), ...extra });
    return { ok: false, error: String(e) };
  }
}

// ── enviar al grupo ─────────────────────────────────────────────────────────
async function enviar(p: any, who: any) {
  const g = await grupo(p.group_id);
  if (!g?.group_id) return { ok: false, error: 'No encontré ese grupo.' };
  const cred = await getWhatsAppCredentials();
  const { data: rec } = await sb.from('whatsapp_grupo_mensajes').select('id').eq('group_id', g.group_id).eq('direction', 'in')
    .gte('created_at', new Date(Date.now() - 23.5 * 3600e3).toISOString()).limit(1);
  const ventana = !!rec?.length;
  const base = { group_id: g.group_id, direction: 'out', sent_by: who.uid || null };

  if (p.archivo) {
    if (!ventana) return { ok: false, error: 'En las últimas 24 h nadie ha escrito en el grupo: WhatsApp no deja mandar archivos hasta que alguien escriba. Manda primero un mensaje de texto.' };
    const a = p.archivo;
    const bin = atob(String(a.base64 || '').replace(/^data:[^,]+,/, ''));
    const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (!bytes.length || bytes.length > 15 * 1024 * 1024) return { ok: false, error: 'El archivo está vacío o pasa de 15 MB.' };
    const filename = String(a.filename || 'archivo').replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]+/g, '_');
    const mime = String(a.mime || 'application/octet-stream');
    const path = `grupos/${g.group_id}/out-${Date.now()}-${filename.replace(/[^\w.\-]+/g, '_')}`;
    await sb.storage.from('agent-documents').upload(path, bytes, { contentType: mime, upsert: true });
    const tipo = /^image\/(jpeg|png)$/.test(mime) ? 'image' : 'document';
    try {
      const mediaId = await uploadMedia(bytes, mime, filename);
      const r = await G.documentoAGrupo(cred, g.group_id, mediaId, filename, p.caption || undefined, tipo);
      await sb.from('whatsapp_grupo_mensajes').insert({ ...base, wa_message_id: waIdFrom(r), kind: tipo, body: p.caption || `(${filename})`, media_path: path, status: 'enviado' });
      return { ok: true };
    } catch (e) {
      await sb.from('whatsapp_grupo_mensajes').insert({ ...base, kind: tipo, body: p.caption || filename, media_path: path, status: 'fallido', error: String(e).slice(0, 500) });
      return { ok: false, error: String(e) };
    }
  }

  const text = String(p.text || '').trim();
  if (!text) return { ok: false, error: 'Falta el mensaje.' };
  if (ventana) {
    try {
      const r = await G.textoAGrupo(cred, g.group_id, text);
      await sb.from('whatsapp_grupo_mensajes').insert({ ...base, wa_message_id: waIdFrom(r), kind: 'text', body: text, status: 'enviado' });
      return { ok: true, como: 'texto' };
    } catch (e) {
      await sb.from('whatsapp_grupo_mensajes').insert({ ...base, kind: 'text', body: text, status: 'fallido', error: String(e).slice(0, 500) });
      return { ok: false, error: String(e) };
    }
  }
  // Ventana cerrada: plantilla (los parámetros no admiten saltos de línea).
  const plano = text.replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').slice(0, 900).trim();
  const [tpl, params] = g.tipo === 'interno'
    ? ['omm_aviso_equipo', ['equipo', `de parte de ${who.nombre || 'OMM'}: ${plano}`]]
    : ['omm_mensaje_cliente', ['a todos', who.nombre || 'OMM', plano]];
  try {
    const r = await G.plantillaAGrupo(cred, g.group_id, tpl, params as string[]);
    await sb.from('whatsapp_grupo_mensajes').insert({ ...base, wa_message_id: waIdFrom(r), kind: 'template', template_name: tpl, body: render(tpl, params as string[]), status: 'enviado' });
    return { ok: true, como: 'plantilla ' + tpl };
  } catch (e) {
    await sb.from('whatsapp_grupo_mensajes').insert({ ...base, kind: 'template', template_name: tpl, body: render(tpl, params as string[]), status: 'fallido', error: String(e).slice(0, 500) });
    return { ok: false, error: String(e) };
  }
}

// ── diag: ¿la cuenta tiene la Groups API? ──────────────────────────────────
async function diag() {
  const cred = await getWhatsAppCredentials();
  const out: any[] = [];
  for (const v of ['v21.0', 'v23.0', 'v24.0', 'v25.0']) {
    try { const r = await G.gApi(cred, 'GET', `${cred.phoneNumberId}/groups?limit=5`, undefined, v); out.push({ v, ok: true, r }); }
    catch (e) { out.push({ v, ok: false, error: String(e).slice(0, 300) }); }
  }
  return { ok: true, pruebas: out };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST' }, 405);
  const who = await quien(req);
  if (!who.ok) return json({ ok: false, error: 'No autorizado' }, 401);
  const p = await req.json().catch(() => ({}));
  try {
    if (p.action === 'diag') return json(await diag());
    if (who.cron) return json({ ok: false, error: 'Con la llave del cron sólo diag' }, 403);
    const cred = () => getWhatsAppCredentials();
    switch (p.action) {
      case 'crear': return json(await crear(p, who));
      case 'info': return json(await info(String(p.group_id || '')));
      case 'invitar': return json(await invitar(p, who));
      case 'enviar': return json(await enviar(p, who));
      case 'quitar': {
        const tel = String(p.telefono || '').replace(/\D/g, '');
        if (!tel) return json({ ok: false, error: 'Falta el teléfono.' });
        await G.quitarParticipantes(await cred(), p.group_id, [tel]);
        return json(await info(p.group_id));
      }
      case 'nueva_liga': {
        const liga = await G.nuevaLiga(await cred(), p.group_id);
        await sb.from('whatsapp_grupos').update({ invite_link: liga, updated_at: new Date().toISOString() }).eq('group_id', p.group_id);
        return json({ ok: true, invite_link: liga });
      }
      case 'solicitud': {
        const ids = (p.ids || []).map(String);
        if (!ids.length) return json({ ok: false, error: 'Faltan las solicitudes.' });
        if (p.aprobar) await G.aprobar(await cred(), p.group_id, ids); else await G.rechazar(await cred(), p.group_id, ids);
        return json(await info(p.group_id));
      }
      case 'borrar': {
        await G.borrarGrupo(await cred(), p.group_id);
        await sb.from('whatsapp_grupos').update({ estado: 'borrado', updated_at: new Date().toISOString() }).eq('group_id', p.group_id);
        return json({ ok: true });
      }
      default: return json({ ok: false, error: `Acción desconocida: ${p.action}` }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
