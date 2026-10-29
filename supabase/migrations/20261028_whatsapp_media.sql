-- Ver fotos, audios, videos y documentos en /wa y /whatsapp (2026-10-28).
--
-- 1. Los buckets rechazaban videos y PDF (allowed_mime_types), así que los videos de
--    los instaladores nunca se guardaron. Se amplía la lista.
-- 2. agent-documents no tenía política de lectura: nadie con sesión podía abrir lo que
--    guarda el bot. Se abre a Administración/DG, igual que la pantalla de WhatsApp.
-- 3. wa_media(ids): dónde quedó guardado el archivo de cada mensaje. El webhook guarda
--    el archivo con el wa_message_id en el nombre (wa_<id>. en obra-reportes,
--    wa-<id>. en agent-documents) pero no siempre escribe media_path; esta función lo
--    encuentra sin tener que redesplegar el webhook.

update storage.buckets set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp','image/heic','image/gif',
  'audio/mp4','audio/mpeg','audio/wav','audio/webm','audio/ogg','audio/m4a','audio/aac','audio/amr',
  'video/mp4','video/3gpp','video/quicktime','video/webm',
  'application/pdf','text/xml','application/xml','text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword','application/vnd.ms-excel','application/octet-stream'
] where id in ('agent-documents','obra-reportes');

drop policy if exists agent_documents_select on storage.objects;
create policy agent_documents_select on storage.objects for select to authenticated
  using (bucket_id = 'agent-documents' and (select public.es_area(array['Administracion'])));

create or replace function public.wa_media(p_ids uuid[])
returns table(id uuid, bucket text, path text, mime text)
language sql stable security definer set search_path = public, storage
as $$
  select m.id, o.bucket_id::text, o.name, o.metadata->>'mimetype'
  from public.whatsapp_messages m
  cross join lateral (
    select ob.bucket_id, ob.name, ob.metadata from storage.objects ob
    where ob.bucket_id in ('agent-documents','obra-reportes','cotizaciones-pdf')
      and (
        (m.media_path is not null and ob.name = m.media_path)
        or (m.media_path is null and m.wa_message_id is not null
            and ob.bucket_id in ('agent-documents','obra-reportes')
            and (strpos(ob.name, 'wa_' || m.wa_message_id || '.') > 0
                 or strpos(ob.name, 'wa-' || m.wa_message_id || '.') > 0))
      )
    order by (ob.bucket_id = 'agent-documents') desc
    limit 1
  ) o
  where m.id = any(p_ids)
    and public.es_area(array['Administracion'])
$$;
revoke all on function public.wa_media(uuid[]) from public, anon;
grant execute on function public.wa_media(uuid[]) to authenticated;
