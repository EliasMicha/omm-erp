-- Jefe de cuadrilla (Alfredo): resumen de las 9 pm y aprobación de actividades
-- detectadas en los reportes de WhatsApp. Aplicada como migración
-- `reportes_supervisor_propuestas` el 2026-10-25.
create table if not exists public.reporte_supervisores (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  areas text[],
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.reporte_propuestas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  numero int not null,
  supervisor_id uuid references public.employees(id) on delete set null,
  reporte_id uuid references public.obra_reportes(id) on delete cascade,
  obra_id uuid not null references public.obras(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  descripcion text not null,
  sistema text,
  area text,
  estado text not null default 'propuesta' check (estado in ('propuesta','aprobada','descartada')),
  fecha_compromiso date,
  actividad_id uuid references public.obra_actividades(id) on delete set null,
  decidido_at timestamptz,
  created_at timestamptz not null default now(),
  unique (fecha, supervisor_id, numero)
);
create index if not exists ix_rp_abiertas on public.reporte_propuestas (supervisor_id, estado, fecha);
create table if not exists public.wa_pendientes_entrega (
  id uuid primary key default gen_random_uuid(),
  telefono10 text not null,
  texto text not null,
  motivo text,
  created_at timestamptz not null default now(),
  entregado_at timestamptz
);
create index if not exists ix_wpe_tel on public.wa_pendientes_entrega (telefono10, created_at desc) where entregado_at is null;
alter table public.reporte_supervisores enable row level security;
alter table public.reporte_propuestas enable row level security;
alter table public.wa_pendientes_entrega enable row level security;
create policy rsup_todo on public.reporte_supervisores for all using ((select usuario_real())) with check ((select usuario_real()));
create policy rprop_leer on public.reporte_propuestas for select using ((select usuario_real()));
revoke all on public.reporte_supervisores, public.reporte_propuestas, public.wa_pendientes_entrega from anon;
grant select, insert, update, delete on public.reporte_supervisores to authenticated;
grant select on public.reporte_propuestas to authenticated;
insert into public.reporte_supervisores (employee_id, areas)
select id, array['INSTALACIONES ESPECIALES'] from public.employees where nombre = 'ALFREDO SANCHEZ HUERTA' and activo
on conflict (employee_id) do nothing;
