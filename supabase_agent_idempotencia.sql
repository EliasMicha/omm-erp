-- Aplicada en Supabase el 2026-09-26. Copia para el repo.
-- Idempotencia de las escrituras que hacen los bots por MCP.
create table if not exists public.agent_idempotencia (
  clave        text primary key,
  tool_name    text not null,
  actor_email  text,
  origen       text,
  estado       text not null default 'en_proceso' check (estado in ('en_proceso','hecho','error')),
  resultado    jsonb,
  error_message text,
  leased_until timestamptz not null default (now() + interval '2 minutes'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_agent_idem_creada on public.agent_idempotencia (created_at desc);
alter table public.agent_idempotencia enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='agent_idempotencia' and policyname='agent_idem_all') then
    create policy agent_idem_all on public.agent_idempotencia for all using (true) with check (true);
  end if;
end $$;
