-- Ciclo de cobranza por LEAD (no por cotización: muchos cobros se ligan a la
-- obra y no a una cotización). Devuelve, por lead y moneda, lo contratado y
-- cada cobro con su fecha. Los cobros cuentan EXACTAMENTE igual que la
-- cartera de finanzas_tablero:
--   1. repartos de payment_allocations a cotizaciones con contrato,
--   2. abonos ligados a una cotización (misma moneda) que no están repartidos,
--   3. cobros en efectivo ligados a una cotización,
--   4. abonos de cliente ligados solo al lead (sin cotización ni reparto),
--   5. efectivo ligado solo al lead.
-- El análisis (curva, ciclo, pronóstico) se hace en el cliente.
-- SECURITY INVOKER: respeta el RLS.
create or replace function public.finanzas_ciclo_cobranza()
returns jsonb language sql stable security invoker set search_path = public as $$
with qv as (
  select vc.quotation_id, vc.lead_id, lower(vc.moneda) cur, vc.vendido, vc.specialty::text esp,
         coalesce(q.fecha_contrato, q.stage_changed_at::date) contrato
    from v_cobranza_cotizacion vc join quotations q on q.id = vc.quotation_id
   where vc.lead_id is not null and q.archived_at is null),
aplicados as (select distinct bank_movement_id id from payment_allocations where bank_movement_id is not null),
pagos as (
  select qv.lead_id, qv.cur, b.fecha, pa.monto
    from payment_allocations pa join qv on qv.quotation_id = pa.quotation_id
    join bank_movements b on b.id = pa.bank_movement_id
  union all
  select qv.lead_id, qv.cur, m.fecha, m.monto
    from bank_movements m join qv on qv.quotation_id = m.quotation_id
   where m.tipo = 'abono' and lower(coalesce(m.moneda, 'MXN')) = qv.cur
     and not exists (select 1 from aplicados a where a.id = m.id)
  union all
  select qv.lead_id, qv.cur, m.fecha, m.monto
    from cash_movements m join qv on qv.quotation_id = m.quotation_id
   where m.tipo = 'cobro_cliente' and lower(coalesce(m.moneda, 'MXN')) = qv.cur
  union all
  select b.lead_id, case when b.moneda = 'USD' then 'usd' else 'mxn' end, b.fecha, b.monto
    from bank_movements b
   where b.tipo = 'abono' and b.categoria in ('cobro_cliente','pago_proveedor','proveedor_obra','proveedor','anticipo_proveedor')
     and b.quotation_id is null and b.lead_id is not null
     and not exists (select 1 from payment_allocations pa where pa.bank_movement_id = b.id)
  union all
  select m.lead_id, case when m.moneda = 'USD' then 'usd' else 'mxn' end, m.fecha, m.monto
    from cash_movements m
   where m.tipo = 'cobro_cliente' and m.quotation_id is null and m.lead_id is not null
),
por_dia as (
  select lead_id, cur, fecha, sum(monto) monto from pagos group by 1, 2, 3
),
l as (
  select lead_id, cur, sum(vendido) vendido, sum(cotizaciones_esp) cotizaciones, min(contrato) primer_contrato,
         jsonb_object_agg(coalesce(esp, 'otro'), round(vendido, 2)) por_especialidad
    from (select lead_id, cur, esp, sum(vendido) vendido, count(*) cotizaciones_esp, min(contrato) contrato
            from qv group by 1, 2, 3) z
   group by 1, 2
),
-- Cobertura: de todo lo que entró de clientes, cuánto quedó ligado a un lead
-- con contrato (lo que sí entra al análisis). Por año y moneda.
cob_total as (
  select extract(year from fecha)::int anio, case when moneda = 'USD' then 'usd' else 'mxn' end cur, sum(monto) total
    from (select fecha, moneda, monto from bank_movements
           where tipo = 'abono' and (categoria = 'cobro_cliente'
                 or (categoria in ('pago_proveedor','proveedor_obra','proveedor','anticipo_proveedor') and (quotation_id is not null or lead_id is not null)))
          union all
          select fecha, moneda, monto from cash_movements where tipo = 'cobro_cliente') t
   group by 1, 2),
cob_ligado as (
  select extract(year from p.fecha)::int anio, p.cur, sum(p.monto) ligado
    from por_dia p where exists (select 1 from l where l.lead_id = p.lead_id and l.cur = p.cur and l.vendido > 0)
   group by 1, 2)
select jsonb_build_object(
  'datos_desde', (select min(fecha) from bank_movements),
  'cobertura', coalesce((select jsonb_agg(jsonb_build_object('anio', t.anio, 'cur', t.cur, 'total', round(t.total, 2),
                   'ligado', round(coalesce(g.ligado, 0), 2)) order by t.anio, t.cur)
                from cob_total t left join cob_ligado g on g.anio = t.anio and g.cur = t.cur), '[]'::jsonb),
  'hoy', current_date,
  'leads', coalesce((select jsonb_agg(jsonb_build_object(
      'lead_id', l.lead_id, 'cur', l.cur, 'lead', le.name, 'clave', le.codigo,
      'vendido', round(l.vendido, 2), 'cotizaciones', l.cotizaciones,
      'primer_contrato', l.primer_contrato, 'por_especialidad', l.por_especialidad,
      'pagos', coalesce((select jsonb_agg(jsonb_build_array(p.fecha, round(p.monto, 2)) order by p.fecha)
                           from por_dia p where p.lead_id = l.lead_id and p.cur = l.cur), '[]'::jsonb)))
    from l join leads le on le.id = l.lead_id where l.vendido > 0), '[]'::jsonb)
)
$$;

revoke execute on function public.finanzas_ciclo_cobranza() from public, anon;
grant execute on function public.finanzas_ciclo_cobranza() to authenticated;
