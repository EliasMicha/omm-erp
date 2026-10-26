-- Coordinador de obra por WhatsApp (Alfredo) + documentos por WhatsApp.
-- Aplicada como migración `coordinador_y_documentos_wa` el 2026-10-26.

-- ── Contactos externos de un lead u obra ───────────────────────────────────
-- Clientes, arquitectos, residentes, seguristas. Hoy sólo 3 de 181 leads traen
-- teléfono (leads.contact_phone): sin esta lista el bot no puede reconocer a un
-- cliente que pide su estado de cuenta ni a quién va dirigido un reporte.
create table if not exists public.contactos_externos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  obra_id uuid references public.obras(id) on delete cascade,
  nombre text not null,
  rol text not null default 'cliente'
    check (rol in ('cliente','arquitecto','residente','segurista','administracion','otro')),
  empresa text,
  telefono text,
  email text,
  recibe_estado_cuenta boolean not null default false,
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  check (lead_id is not null or obra_id is not null)
);
create index if not exists ix_ce_lead on public.contactos_externos (lead_id);
create index if not exists ix_ce_obra on public.contactos_externos (obra_id);
create index if not exists ix_ce_tel on public.contactos_externos (right(regexp_replace(coalesce(telefono,''), '\D', '', 'g'), 10));
alter table public.contactos_externos enable row level security;
create policy ce_todo on public.contactos_externos for all
  using ((select usuario_real())) with check ((select usuario_real()));
revoke all on public.contactos_externos from anon;
grant select, insert, update, delete on public.contactos_externos to authenticated;

-- ── Recordatorios del coordinador ──────────────────────────────────────────
create table if not exists public.coordinador_recordatorios (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  cuando timestamptz not null,
  texto text not null,
  obra_id uuid references public.obras(id) on delete set null,
  origen text not null default 'bot',
  enviado_at timestamptz,
  cancelado boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ix_cr_pend on public.coordinador_recordatorios (cuando) where enviado_at is null and not cancelado;

-- ── Lo que el coordinador le pide a Elias o a Logística ────────────────────
create table if not exists public.coordinador_pedidos (
  id uuid primary key default gen_random_uuid(),
  de_employee_id uuid references public.employees(id) on delete set null,
  destino text not null check (destino in ('elias','logistica')),
  tipo text not null default 'otro' check (tipo in ('pago','compra','recoger','entregar','otro')),
  obra_id uuid references public.obras(id) on delete set null,
  detalle text not null,
  monto numeric,
  moneda text,
  fecha_limite date,
  action_item_id uuid,
  project_task_id uuid,
  aviso_ok boolean,
  aviso_error text,
  created_at timestamptz not null default now()
);

-- ── Aprobaciones por WhatsApp (p. ej. estado de cuenta que pide un cliente) ─
create table if not exists public.wa_aprobaciones (
  id uuid primary key default gen_random_uuid(),
  numero int not null default 1,
  tipo text not null default 'estado_cuenta' check (tipo in ('estado_cuenta','documento')),
  estado text not null default 'pendiente'
    check (estado in ('pendiente','aprobada','rechazada','enviada','fallida','vencida')),
  aprobador_tel10 text not null,
  para_tel10 text not null,
  para_nombre text,
  lead_id uuid references public.leads(id) on delete set null,
  documento_path text,
  documento_nombre text,
  caption text,
  solicitud text,
  motivo_error text,
  created_at timestamptz not null default now(),
  decidido_at timestamptz
);
create index if not exists ix_wa_aprob_pend on public.wa_aprobaciones (aprobador_tel10, created_at desc) where estado = 'pendiente';

-- ── Entregas diferidas: ahora también documentos ───────────────────────────
alter table public.wa_pendientes_entrega
  add column if not exists documento_path text,
  add column if not exists documento_nombre text,
  add column if not exists caption text;

alter table public.coordinador_recordatorios enable row level security;
alter table public.coordinador_pedidos enable row level security;
alter table public.wa_aprobaciones enable row level security;
create policy cr_leer on public.coordinador_recordatorios for select using ((select usuario_real()));
create policy cp_leer on public.coordinador_pedidos for select using ((select usuario_real()));
create policy wap_leer on public.wa_aprobaciones for select using ((select usuario_real()));
revoke all on public.coordinador_recordatorios, public.coordinador_pedidos, public.wa_aprobaciones from anon;
grant select on public.coordinador_recordatorios, public.coordinador_pedidos, public.wa_aprobaciones to authenticated;

-- ── Cron: domingo de planeación y recordatorios ────────────────────────────
-- Domingo 17:00 CDMX = 23:00 UTC; 19:00 CDMX = lunes 01:00 UTC.
select cron.schedule('wa-domingo', '0 23 * * 0', $$select public.reportes_cron_llamar('domingo')$$);
select cron.schedule('wa-domingo-insistir', '0 1 * * 1', $$select public.reportes_cron_llamar('domingo_insistir')$$);
-- Cada 15 min, pero sólo llama a la función si hay algo que mandar.
select cron.schedule('wa-recordatorios', '*/15 * * * *',
  $$select public.reportes_cron_llamar('recordatorios')
    where exists (select 1 from public.coordinador_recordatorios
                  where enviado_at is null and not cancelado and cuando <= now())$$);
