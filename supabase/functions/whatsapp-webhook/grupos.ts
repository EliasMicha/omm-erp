// Lo que llega de los grupos de WhatsApp (2026-10-30).
//
// Regla: el asistente NO participa en los grupos. Un mensaje con group_id se
// guarda en whatsapp_grupo_mensajes (lo ve el equipo en /wa y /whatsapp) y ahí
// termina: no pasa por el agente, ni por el reporte diario, ni por clientes. Sin
// esto, lo que Elias o un instalador escribiera en el grupo le llegaría al asistente
// como mensaje privado (y el instalador podría "reportar" sin querer).
//
// También se atienden los eventos de grupo (campos group_lifecycle_update,
// group_participants_update, group_status_update) para tener el group_id, la liga
// y los participantes al día.
import { downloadMedia } from './whatsapp.ts';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'video/mp4': 'mp4', 'application/pdf': 'pdf',
};

export async function guardarMensajeGrupo(sb: any, msg: any, value: any): Promise<void> {
  const gid = String(msg.group_id);
  const perfil = (value?.contacts || []).find((c: any) => c.wa_id === msg.from)?.profile?.name || null;
  const media = msg.image || msg.audio || msg.voice || msg.video || msg.document || msg.sticker || null;
  let mediaPath: string | null = null;
  if (media?.id) {
    try {
      const { bytes, mimeType } = await downloadMedia(media.id);
      const base = String(mimeType || '').split(';')[0];
      const nombre = msg.document?.filename ? String(msg.document.filename).replace(/[^\w.\-]+/g, '_') : `${msg.id}.${EXT[base] || 'bin'}`;
      const path = `grupos/${gid}/${Date.now()}-${nombre}`;
      const { error } = await sb.storage.from('agent-documents').upload(path, bytes, { contentType: base || 'application/octet-stream', upsert: true });
      if (!error) mediaPath = path; else console.error('grupo media upload:', error.message);
    } catch (e) { console.error('grupo media:', e); }
  }
  const body = msg.text?.body || media?.caption || (msg.type === 'location' ? `📍 ${msg.location?.name || ''} ${msg.location?.latitude},${msg.location?.longitude}`.trim() : null) || `[${msg.type}]`;
  const { error } = await sb.from('whatsapp_grupo_mensajes').insert({
    group_id: gid, direction: 'in', from_phone: '+' + msg.from, from_nombre: perfil, wa_message_id: msg.id,
    kind: msg.type, body, media_path: mediaPath, status: 'recibido',
  });
  if (error && !/duplicate/i.test(error.message)) console.error('whatsapp_grupo_mensajes:', error.message);
  // Un grupo creado fuera del ERP (o cuyo webhook de creación no llegó) se da de alta.
  await sb.from('whatsapp_grupos').upsert({ group_id: gid, nombre: 'Grupo de WhatsApp', estado: 'activo' }, { onConflict: 'group_id', ignoreDuplicates: true });
}

export async function eventosGrupo(sb: any, grupos: any[]): Promise<void> {
  const ahora = new Date().toISOString();
  for (const g of grupos || []) {
    const gid = g.group_id;
    if (!gid) continue;
    try {
      if (g.type === 'group_create') {
        // Si el ERP lo creó, hay un renglón 'creando' con ese nombre y sin group_id.
        const { data: pend } = await sb.from('whatsapp_grupos').select('id').is('group_id', null).eq('estado', 'creando')
          .eq('nombre', String(g.subject || '').trim()).order('created_at', { ascending: false }).limit(1);
        const datos = { group_id: gid, invite_link: g.invite_link || null, estado: g.errors?.length ? 'error' : 'activo', error: g.errors?.length ? JSON.stringify(g.errors).slice(0, 500) : null, updated_at: ahora };
        if (pend?.length) await sb.from('whatsapp_grupos').update(datos).eq('id', pend[0].id);
        else await sb.from('whatsapp_grupos').upsert({ ...datos, nombre: g.subject || 'Grupo de WhatsApp' }, { onConflict: 'group_id' });
      } else if (g.type === 'group_delete') {
        await sb.from('whatsapp_grupos').update({ estado: 'borrado', updated_at: ahora }).eq('group_id', gid);
      } else if (g.type === 'group_participants_add' || g.type === 'group_participants_remove') {
        const { data: row } = await sb.from('whatsapp_grupos').select('participantes').eq('group_id', gid).maybeSingle();
        const actual: any[] = Array.isArray(row?.participantes) ? row.participantes : [];
        const ids = new Set(actual.map((p: any) => String(p.wa_id)));
        for (const p of g.added_participants || []) if (p?.wa_id) ids.add(String(p.wa_id));
        for (const p of g.removed_participants || []) ids.delete(String(p?.wa_id || p?.input || '').replace(/\D/g, ''));
        await sb.from('whatsapp_grupos').update({ participantes: [...ids].map(w => ({ wa_id: w })), updated_at: ahora }).eq('group_id', gid);
      } else if (g.type === 'group_suspend' || g.type === 'group_suspend_cleared') {
        await sb.from('whatsapp_grupos').update({ estado: g.type === 'group_suspend' ? 'suspendido' : 'activo', updated_at: ahora }).eq('group_id', gid);
      }
    } catch (e) { console.error('eventosGrupo:', e); }
  }
}

// Los estados (enviado/entregado/leído/fallido) de lo que mandamos al grupo.
const STATUS_MAP: Record<string, string> = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' };
export async function estadosGrupo(sb: any, statuses: any[]): Promise<void> {
  for (const st of statuses || []) {
    const status = STATUS_MAP[st.status];
    if (!status || !st.id) continue;
    const err = st.errors?.[0] ? `${st.errors[0].code}: ${st.errors[0].title || st.errors[0].message || ''}` : null;
    try {
      // En un grupo cada participante manda su propio estado: no se regresa de
      // "leído" a "entregado" por el de alguien más lento.
      const orden = ['enviado', 'entregado', 'leido'];
      const { data: m } = await sb.from('whatsapp_grupo_mensajes').select('id, status').eq('wa_message_id', st.id).eq('direction', 'out').maybeSingle();
      if (!m) continue;
      if (status !== 'fallido' && orden.indexOf(m.status) >= orden.indexOf(status)) continue;
      await sb.from('whatsapp_grupo_mensajes').update({ status, error: err, updated_at: new Date().toISOString() }).eq('id', m.id);
    } catch (_) { /* no crítico */ }
  }
}
