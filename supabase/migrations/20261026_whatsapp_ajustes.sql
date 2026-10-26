-- Interruptor del bot de WhatsApp (y futuros ajustes). bot_pausado=true: el webhook
-- guarda los mensajes pero no llama a ninguna IA. Ver CLAUDE.md, "Bot en pausa".
create table if not exists public.whatsapp_ajustes (
  clave text primary key,
  valor jsonb not null,
  actualizado_at timestamptz not null default now(),
  actualizado_por uuid
);
alter table public.whatsapp_ajustes enable row level security;
drop policy if exists wa_ajustes_select on public.whatsapp_ajustes;
create policy wa_ajustes_select on public.whatsapp_ajustes for select using ((select usuario_real()));
drop policy if exists wa_ajustes_update on public.whatsapp_ajustes;
create policy wa_ajustes_update on public.whatsapp_ajustes for update using ((select es_area(array['DG','Administracion'])));
revoke all on public.whatsapp_ajustes from anon;
insert into public.whatsapp_ajustes (clave, valor) values ('bot_pausado', 'true'::jsonb)
on conflict (clave) do nothing;
