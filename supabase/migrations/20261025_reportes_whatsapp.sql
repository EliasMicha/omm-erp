-- Reportes diarios de obra por WhatsApp (2026-10-25)
--
-- Elias define QUIÉN reporta (reporte_diario_personas). Cada día a las 6 pm el
-- bot revisa la planeación (installer_daily_assignment) y le pide a cada uno el
-- reporte de la obra donde estuvo asignado. Lo que contesta se guarda en
-- obra_reportes, igual que si lo subiera desde la app de obra. A las 9 pm se
-- manda el resumen de cada obra a su lista (reporte_obra_destinatarios).

-- 1. Un reporte puede llegar de una obra que no está en el ERP: se guarda igual,
--    con el nombre tal cual, y se liga después. Nunca se tira un reporte.
alter table public.obra_reportes alter column obra_id drop not null;
alter table public.obra_reportes
  add column if not exists obra_texto text,
  add column if not exists origen text not null default 'app',
  add column if not exists solicitud_id uuid;

-- 2. Quién tiene que reportar diario.
create table if not exists public.reporte_diario_personas (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  activo boolean not null default true,
  notas text,
  created_at timestamptz not null default now()
);

-- 3. A quién le llega el resumen de cada obra. Sin renglones = Elias (DG) + el
--    coordinador de la obra.
create table if not exists public.reporte_obra_destinatarios (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  telefono text,
  nombre text,
  created_at timestamptz not null default now(),
  check (employee_id is not null or telefono is not null)
);
create unique index if not exists uq_rod_obra_emp on public.reporte_obra_destinatarios (obra_id, employee_id) where employee_id is not null;
create unique index if not exists uq_rod_obra_tel on public.reporte_obra_destinatarios (obra_id, telefono) where telefono is not null;

-- 4. Cada petición diaria (persona × obra × día) y en qué va.
create table if not exists public.reporte_solicitudes (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  obra_id uuid references public.obras(id) on delete set null,
  obra_texto text,
  telefono text not null,
  estado text not null default 'pedido'
    check (estado in ('pedido','insistido','recibiendo','aclarando','no_fue','sin_respuesta','cerrado','cancelado')),
  candidatos jsonb,
  origen text not null default 'planeacion',
  pedido_at timestamptz,
  insistido_at timestamptz,
  ultimo_mensaje_at timestamptz,
  reporte_id uuid references public.obra_reportes(id) on delete set null,
  resumen_enviado_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_rs_dia_persona_obra
  on public.reporte_solicitudes (fecha, employee_id, obra_id) nulls not distinct
  where estado <> 'cancelado' and obra_texto is null;
create index if not exists ix_rs_abiertas on public.reporte_solicitudes (employee_id, fecha desc);

-- RLS: el ERP edita personas y destinatarios; las solicitudes sólo se leen
-- (las escribe la función con service_role).
alter table public.reporte_diario_personas enable row level security;
alter table public.reporte_obra_destinatarios enable row level security;
alter table public.reporte_solicitudes enable row level security;

drop policy if exists rdp_todo on public.reporte_diario_personas;
create policy rdp_todo on public.reporte_diario_personas for all
  using ((select usuario_real())) with check ((select usuario_real()));
drop policy if exists rod_todo on public.reporte_obra_destinatarios;
create policy rod_todo on public.reporte_obra_destinatarios for all
  using ((select usuario_real())) with check ((select usuario_real()));
drop policy if exists rs_leer on public.reporte_solicitudes;
create policy rs_leer on public.reporte_solicitudes for select
  using ((select usuario_real()));

revoke all on public.reporte_diario_personas, public.reporte_obra_destinatarios, public.reporte_solicitudes from anon;
grant select, insert, update, delete on public.reporte_diario_personas, public.reporte_obra_destinatarios to authenticated;
grant select on public.reporte_solicitudes to authenticated;

-- 5. Agregar lo que manda el instalador al reporte del día, sin carreras:
--    cinco fotos llegan como cinco webhooks casi al mismo tiempo. El renglón de
--    la solicitud se bloquea, así que sólo uno crea el reporte y los demás se
--    le suman.
create or replace function public.reporte_wa_agregar(
  p_solicitud uuid, p_texto text default null, p_foto text default null,
  p_audio_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s public.reporte_solicitudes%rowtype;
  rid uuid;
begin
  select * into s from public.reporte_solicitudes where id = p_solicitud for update;
  if not found then raise exception 'solicitud % no existe', p_solicitud; end if;

  rid := s.reporte_id;
  if rid is null then
    insert into public.obra_reportes (obra_id, instalador_id, fecha, texto_raw, fotos, audio_path,
                                      tipo_reporte, procesado, origen, solicitud_id, obra_texto)
    values (s.obra_id, s.employee_id, s.fecha, null, '{}', null, 'general', false, 'whatsapp', s.id, s.obra_texto)
    returning id into rid;
  end if;

  update public.obra_reportes set
    texto_raw = case when coalesce(p_texto,'') = '' then texto_raw
                     else coalesce(texto_raw || E'\n', '') || p_texto end,
    fotos = case when p_foto is null then fotos else array_append(coalesce(fotos,'{}'), p_foto) end,
    audio_path = coalesce(audio_path, p_audio_path),
    obra_id = s.obra_id,
    obra_texto = s.obra_texto,
    procesado = false
  where id = rid;

  update public.reporte_solicitudes set
    reporte_id = rid,
    estado = case when estado in ('pedido','insistido','aclarando') then 'recibiendo' else estado end,
    ultimo_mensaje_at = now()
  where id = s.id;
  return rid;
end $$;
revoke all on function public.reporte_wa_agregar(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.reporte_wa_agregar(uuid, text, text, text) to service_role;

-- 6. Llave del cron: vive en el vault; pg_cron la manda en un header y la
--    función la compara aquí. Nunca pasa por el código ni por el chat.
create or replace function public.reportes_cron_ok(p_key text) returns boolean
language sql security definer set search_path = public, vault as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'reportes_cron_key' and decrypted_secret = p_key)
$$;
revoke all on function public.reportes_cron_ok(text) from public, anon, authenticated;
grant execute on function public.reportes_cron_ok(text) to service_role;

-- 7. Cómo saluda el bot a cada quien (el padrón trae varios con el apellido primero).
alter table public.reporte_diario_personas add column if not exists alias text;
