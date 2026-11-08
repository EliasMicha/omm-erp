-- Token de la API de Syscom (client_credentials, dura 1 año). Solo lo lee/escribe
-- la Edge Function `syscom` con service_role: RLS activo y SIN políticas.
create table if not exists public.syscom_token (
  id int primary key default 1 check (id = 1),
  access_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.syscom_token enable row level security;
revoke all on public.syscom_token from anon, authenticated;
