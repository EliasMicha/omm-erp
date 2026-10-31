// Groups API de WhatsApp (cuenta oficial, palomita azul) — 2026-10-30.
// Lo usan whatsapp-grupos (crear, invitar, mandar) y whatsapp-webhook (lo que llega
// de los grupos). Recibe las credenciales para no amarrarse a una copia de whatsapp.ts.
//
// Reglas de Meta que importan aquí:
//   - máximo 8 participantes además de OMM; sólo se entra con la liga de invitación;
//   - crear es asíncrono: el group_id y la liga llegan por el webhook
//     group_lifecycle_update (y también se pueden buscar en la lista de grupos);
//   - la ventana de 24 h es del GRUPO: se abre cuando cualquiera escribe en él;
//   - en grupos sólo texto, archivos y plantillas (nada de botones ni listas).

export const GRUPOS_VERSION = 'v24.0';
export const MAX_PARTICIPANTES = 8;

type Cred = { token: string; phoneNumberId: string };

export async function gApi(cred: Cred, method: string, path: string, body?: unknown, version = GRUPOS_VERSION): Promise<any> {
  const res = await fetch(`https://graph.facebook.com/${version}/${path.replace(/^\//, '')}`, {
    method,
    headers: { Authorization: `Bearer ${cred.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let j: any = {};
  try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
  if (!res.ok) {
    const e = j?.error;
    throw new Error(`Graph ${res.status}${e?.code ? ' (' + e.code + ')' : ''}: ${e?.error_user_msg || e?.message || txt.slice(0, 300)}`);
  }
  return j;
}

export const crearGrupo = (c: Cred, subject: string, description?: string, aprobacion = false) =>
  gApi(c, 'POST', `${c.phoneNumberId}/groups`, {
    messaging_product: 'whatsapp', subject: subject.slice(0, 128),
    ...(description ? { description: description.slice(0, 2048) } : {}),
    join_approval_mode: aprobacion ? 'approval_required' : 'auto_approve',
  });

export async function listarGrupos(c: Cred): Promise<{ id: string; subject: string; created_at?: string }[]> {
  const r = await gApi(c, 'GET', `${c.phoneNumberId}/groups?limit=100`);
  return r?.data?.groups || r?.groups || (Array.isArray(r?.data) ? r.data : []);
}

export const infoGrupo = (c: Cred, gid: string) =>
  gApi(c, 'GET', `${gid}?fields=subject,description,participants,total_participant_count,join_approval_mode,suspended,creation_timestamp`);
export const ligaGrupo = async (c: Cred, gid: string): Promise<string | null> => (await gApi(c, 'GET', `${gid}/invite_link`))?.invite_link || null;
export const nuevaLiga = async (c: Cred, gid: string): Promise<string | null> => (await gApi(c, 'POST', `${gid}/invite_link`, { messaging_product: 'whatsapp' }))?.invite_link || null;
export const quitarParticipantes = (c: Cred, gid: string, users: string[]) =>
  gApi(c, 'DELETE', `${gid}/participants`, { messaging_product: 'whatsapp', participants: users.slice(0, 8).map(u => ({ user: u })) });
export const solicitudes = async (c: Cred, gid: string) => (await gApi(c, 'GET', `${gid}/join_requests`))?.data || [];
export const aprobar = (c: Cred, gid: string, ids: string[]) => gApi(c, 'POST', `${gid}/join_requests`, { messaging_product: 'whatsapp', join_requests: ids });
export const rechazar = (c: Cred, gid: string, ids: string[]) => gApi(c, 'DELETE', `${gid}/join_requests`, { messaging_product: 'whatsapp', join_requests: ids });
export const borrarGrupo = (c: Cred, gid: string) => gApi(c, 'DELETE', gid);

// Mensajes AL grupo (recipient_type group, to = group_id).
export const textoAGrupo = (c: Cred, gid: string, body: string) =>
  gApi(c, 'POST', `${c.phoneNumberId}/messages`, { messaging_product: 'whatsapp', recipient_type: 'group', to: gid, type: 'text', text: { body: body.slice(0, 4000), preview_url: true } });
export const documentoAGrupo = (c: Cred, gid: string, mediaId: string, filename: string, caption?: string, tipo: 'document' | 'image' = 'document') =>
  gApi(c, 'POST', `${c.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp', recipient_type: 'group', to: gid, type: tipo,
    [tipo]: tipo === 'image' ? { id: mediaId, caption } : { id: mediaId, filename, caption },
  });
export const plantillaAGrupo = (c: Cred, gid: string, name: string, params: string[], lang = 'es_MX') =>
  gApi(c, 'POST', `${c.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp', recipient_type: 'group', to: gid, type: 'template',
    template: { name, language: { code: lang }, components: params.length ? [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: String(p || '-').slice(0, 900) })) }] : [] },
  });
