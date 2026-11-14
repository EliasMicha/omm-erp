-- ═══════════════════════════════════════════════════════════════════════════
--  Precios de Syscom contra el catálogo (2026-11-14)
--
--  syscom_precios: una fila por producto del catálogo que se compra a Syscom
--  ("SISTEMAS Y SERVICIOS DE COMUNICACION"). La llena la Edge Function `syscom`
--  (acción `sincronizar`, con la llave de servicio) cada noche.
--
--  La regla de Elias: si el precio no coincide, NO se toca el catálogo solo.
--  Se enseña la diferencia y él aprueba (syscom_aplicar_precios) o la ignora
--  (syscom_ignorar_precios). Ignorar recuerda el precio: si Syscom lo vuelve a
--  mover, la diferencia regresa.
--
--  Actualizar el costo del catálogo NO cambia cotizaciones ya hechas
--  (trg_sync_catalog_to_items sólo propaga provider/supplier_id).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.syscom_precios (
  catalog_product_id uuid primary key references public.catalog_products(id) on delete cascade,
  syscom_id          text,
  modelo_syscom      text,
  marca              text,
  titulo             text,
  imagen             text,
  link               text,
  precio_usd         numeric,      -- costo OMM: precio_descuento con financiero, USD, sin IVA
  precio_especial    numeric,
  existencia         integer,
  tc_syscom          numeric,
  costo_catalogo     numeric,      -- foto del costo del catálogo al revisar
  moneda_catalogo    text,
  precio_comparable  numeric,      -- precio Syscom en la moneda del catálogo
  estado             text not null default 'pendiente'
                     check (estado in ('pendiente','igual','distinto','ignorado','sin_costo','no_encontrado','ambiguo','sin_precio','error')),
  candidatos         jsonb,
  ignorado_precio    numeric,
  decision           text check (decision in ('aplicado','ignorado','ligado')),
  decision_at        timestamptz,
  decision_por       text,
  error              text,
  consultado_at      timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists idx_syscom_precios_estado on public.syscom_precios(estado);
create index if not exists idx_syscom_precios_syscom_id on public.syscom_precios(syscom_id) where syscom_id is not null;

alter table public.syscom_precios enable row level security;

drop policy if exists syscom_precios_leer on public.syscom_precios;
create policy syscom_precios_leer on public.syscom_precios for select
  using ((select usuario_real()));
drop policy if exists syscom_precios_insertar on public.syscom_precios;
create policy syscom_precios_insertar on public.syscom_precios for insert
  with check ((select usuario_real()));
drop policy if exists syscom_precios_actualizar on public.syscom_precios;
create policy syscom_precios_actualizar on public.syscom_precios for update
  using ((select usuario_real())) with check ((select usuario_real()));

revoke all on public.syscom_precios from anon;
grant select, insert, update on public.syscom_precios to authenticated;

-- ── Aprobar: el costo del catálogo toma el precio de Syscom ────────────────
-- SECURITY INVOKER: corre con los permisos (y la RLS) de quien aprueba.
-- precio_venta se recalcula con el MISMO margen del producto (la fórmula de
-- Catalogo.tsx: costo / (1 - margen/100); en eléctricas el costo incluye la
-- mano de obra).
create or replace function public.syscom_aplicar_precios(p_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
  quien text := coalesce((select nombre from app_users where auth_user_id = auth.uid() limit 1), 'ERP');
begin
  with s as (
    select sp.catalog_product_id id, round(sp.precio_comparable, 2) nuevo
    from syscom_precios sp
    where sp.catalog_product_id = any(p_ids)
      and sp.estado in ('distinto','ignorado','sin_costo')
      and sp.precio_comparable is not null and sp.precio_comparable > 0
  ), upd as (
    update catalog_products c set
      cost = s.nuevo,
      precio_venta = case
        when coalesce(c.markup, 0) > 0 and c.markup < 100
          then round((s.nuevo + case when c.specialty::text = 'elec' then coalesce(c.costo_mano_obra, 0) else 0 end) / (1 - c.markup / 100), 2)
        else c.precio_venta end,
      precio_actualizado_at = now()
    from s where c.id = s.id
    returning c.id, c.cost
  )
  update syscom_precios sp set
    estado = 'igual', costo_catalogo = upd.cost, decision = 'aplicado',
    decision_at = now(), decision_por = quien, ignorado_precio = null
  from upd where sp.catalog_product_id = upd.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Ignorar: se queda el costo del catálogo hasta que Syscom cambie otra vez ─
create or replace function public.syscom_ignorar_precios(p_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
  quien text := coalesce((select nombre from app_users where auth_user_id = auth.uid() limit 1), 'ERP');
begin
  update syscom_precios set
    estado = 'ignorado', ignorado_precio = precio_usd, decision = 'ignorado',
    decision_at = now(), decision_por = quien
  where catalog_product_id = any(p_ids) and estado = 'distinto';
  get diagnostics n = row_count;
  return n;
end $$;

-- Costo 0 en el catálogo casi siempre es "suministrado por el cliente": no
-- es una diferencia que aprobar. Se aparta en 'sin_costo' (pestaña propia).
-- Va en trigger para que aplique escriba quien escriba la fila.
create or replace function public.syscom_precios_sin_costo()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.estado = 'distinto' and coalesce(new.costo_catalogo, 0) <= 0 then
    new.estado := 'sin_costo';
  end if;
  return new;
end $$;
drop trigger if exists trg_syscom_precios_sin_costo on public.syscom_precios;
create trigger trg_syscom_precios_sin_costo before insert or update on public.syscom_precios
  for each row execute function public.syscom_precios_sin_costo();

revoke all on function public.syscom_aplicar_precios(uuid[]) from public, anon;
revoke all on function public.syscom_ignorar_precios(uuid[]) from public, anon;
grant execute on function public.syscom_aplicar_precios(uuid[]) to authenticated;
grant execute on function public.syscom_ignorar_precios(uuid[]) to authenticated;

-- ── Cron: la Edge Function decide qué falta (lo no revisado en 20 h) ────────
create or replace function public.syscom_cron_llamar()
returns bigint
language sql
security definer
set search_path = public, vault, net
as $$
  select net.http_post(
    url := 'https://ubbumxommqjcpdozpunf.supabase.co/functions/v1/syscom',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'reportes_cron_key')),
    body := jsonb_build_object('accion', 'sincronizar'),
    timeout_milliseconds := 150000);
$$;
revoke all on function public.syscom_cron_llamar() from public, anon, authenticated;

-- 3:00 a 4:20 am CDMX (09:00–10:20 UTC), cada 20 min: cada vuelta toma lo
-- que no se ha revisado hoy, así que las primeras hacen el trabajo y las demás
-- terminan en segundos.
select cron.unschedule(jobid) from cron.job where jobname = 'syscom-precios';
select cron.schedule('syscom-precios', '0,20,40 9 * * *', $$select public.syscom_cron_llamar()$$);
