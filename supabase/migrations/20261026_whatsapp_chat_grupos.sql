-- Grupo de cada chat de WhatsApp en la vista de Conversaciones.
-- El grupo se calcula solo (equipo → coordinación, contacto de mantenimiento →
-- servicios, contacto de un lead → clientes, desconocido → general); esta
-- tabla guarda SOLO lo que alguien movió a mano, para que valga igual en el
-- celular y en la computadora.
create table if not exists public.whatsapp_chat_grupos (
  telefono10 text primary key check (telefono10 ~ '^[0-9]{10}$'),
  grupo text not null check (grupo in ('clientes','coordinacion','servicios','general')),
  updated_by uuid references public.app_users(id) default public.mi_app_user(),
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_chat_grupos enable row level security;
drop policy if exists wa_grupos_select on public.whatsapp_chat_grupos;
drop policy if exists wa_grupos_insert on public.whatsapp_chat_grupos;
drop policy if exists wa_grupos_update on public.whatsapp_chat_grupos;
drop policy if exists wa_grupos_delete on public.whatsapp_chat_grupos;
create policy wa_grupos_select on public.whatsapp_chat_grupos for select to authenticated using ((select public.usuario_real()));
create policy wa_grupos_insert on public.whatsapp_chat_grupos for insert to authenticated with check ((select public.es_area(array['Administracion'])));
create policy wa_grupos_update on public.whatsapp_chat_grupos for update to authenticated using ((select public.es_area(array['Administracion']))) with check ((select public.es_area(array['Administracion'])));
create policy wa_grupos_delete on public.whatsapp_chat_grupos for delete to authenticated using ((select public.es_area(array['Administracion'])));
revoke all on public.whatsapp_chat_grupos from anon;
grant select, insert, update, delete on public.whatsapp_chat_grupos to authenticated;
