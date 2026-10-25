-- 2026-10-24 · Finanzas reescrito
-- 1) quotations.fecha_contrato (+ fuente) con trigger y backfill
-- 2) finanzas_tablero(p_desde, p_hasta): única fuente del módulo Finanzas
alter table public.quotations add column if not exists fecha_contrato date;
alter table public.quotations add column if not exists fecha_contrato_fuente text;
-- 'etapa' | 'primer_cobro' | 'por_confirmar' | 'manual'

create or replace function public.omm_tg_fecha_contrato() returns trigger
language plpgsql as $$
begin
  if new.stage::text = 'contrato' and new.fecha_contrato is null
     and (tg_op = 'INSERT' or old.stage::text is distinct from 'contrato') then
    new.fecha_contrato := current_date;
    new.fecha_contrato_fuente := 'etapa';
  end if;
  return new;
end $$;

create or replace trigger trg_fecha_contrato before insert or update of stage on public.quotations
for each row execute function public.omm_tg_fecha_contrato();

-- Backfill (ya aplicado el 24-oct; idempotente: solo filas con fecha vacía)
with c as (
  select q.id, q.commercial_year cy, q.stage_changed_at sc, q.created_at cr,
   (select min(f) from (
      select min(fecha) f from bank_movements b where b.quotation_id=q.id and b.tipo='abono'
      union all select min(m.fecha) from cash_movements m where m.quotation_id=q.id and m.tipo='cobro_cliente'
      union all select min(b.fecha) from payment_allocations pa join bank_movements b on b.id=pa.bank_movement_id where pa.quotation_id=q.id) x) fc
  from quotations q where q.stage::text='contrato' and q.fecha_contrato is null)
update quotations q set
  fecha_contrato = case
     when c.fc is not null and c.fc < coalesce(c.sc, c.cr)::date then c.fc
     when c.cy is not null and extract(year from coalesce(c.sc,c.cr)) > c.cy then make_date(c.cy,12,1)
     else coalesce(c.sc, c.cr)::date end,
  fecha_contrato_fuente = case
     when c.fc is not null and c.fc < coalesce(c.sc, c.cr)::date then 'primer_cobro'
     when c.cy is not null and extract(year from coalesce(c.sc,c.cr)) > c.cy then 'por_confirmar'
     when (c.sc::date - c.cr::date) <= 1 and c.cr < '2026-07-01' then 'por_confirmar'
     else 'etapa' end
from c where c.id = q.id and q.fecha_contrato is null;

-- Línea de negocio de una cotización. Proyecto se parte en sus disciplinas;
-- el diseño de iluminación vive con iluminación (mismo equipo).
create or replace function public.omm_linea_negocio(p_spec text, p_name text) returns text
language sql immutable as $$
  select case
    when p_spec is null then 'sin_liga'
    when p_spec <> 'proy' then p_spec
    when coalesce(p_name,'') ~* 'ilumina' then 'ilum'
    when coalesce(p_name,'') ~* 'electric|eléctric' then 'proy_elec'
    else 'proy_esp' end
$$;

create or replace function public.omm_linea_de_area(p_area text) returns text
language sql immutable as $$
  select case upper(coalesce(p_area,''))
    when 'INSTALACIONES ESPECIALES' then 'esp'
    when 'ELECTRICO' then 'elec'
    when 'ILUMINACION' then 'ilum'
    when 'INGENIERIAS ESPECIALES' then 'proy_esp'
    when 'INGENIERIAS ELECTRICAS' then 'proy_elec'
    when 'NULED' then 'otras_empresas'
    when 'CASA LUCE' then 'otras_empresas'
    else 'estructura' end
$$;

-- Tablero de Finanzas. Todo en moneda NATIVA (mxn / usd por separado);
-- el cliente convierte con el TC del año (src/lib/fx.ts) y lo dice en pantalla.
-- SECURITY INVOKER: respeta RLS (nómina solo Administración).
create or replace function public.finanzas_tablero(p_desde date, p_hasta date)
returns jsonb language plpgsql stable as $$
declare
  v_desde date := date_trunc('month', p_desde)::date;
  v_hasta date := (date_trunc('month', p_hasta) + interval '1 month')::date;
  r jsonb := '{}'::jsonb;
begin
  with meses as (
    select generate_series(v_desde, v_hasta - interval '1 day', interval '1 month')::date m
  ),
  b as (
    select date_trunc('month', fecha)::date m, case when moneda='USD' then 'usd' else 'mxn' end cur,
      case
       when tipo='abono' and categoria='cobro_cliente' then 'cobranza'
       when tipo='cargo' and categoria='cobro_cliente' then 'cobranza_dev'
       when categoria in ('traspaso_interno','traspaso') then 'traspaso'
       when tipo='abono' and categoria='prestamo' then 'fin_entra'
       when tipo='cargo' and categoria in ('prestamo','pago_tdc') then 'fin_sale'
       when tipo='abono' and categoria in ('pago_proveedor','proveedor_obra','proveedor','anticipo_proveedor')
            and (quotation_id is not null or lead_id is not null) then 'cobranza'
       when tipo='abono' and categoria in ('pago_proveedor','proveedor_obra','proveedor','anticipo_proveedor') then 'prov_dev'
       when tipo='abono' then 'otros_ing'
       when categoria in ('pago_proveedor','proveedor','proveedor_obra','anticipo_proveedor') then 'proveedores'
       when categoria in ('nomina','nomina_admin','nomina_directa') then 'nomina'
       when categoria in ('impuestos','impuestos_nomina') then 'impuestos'
       when categoria in ('gasto_general','gasto_operativo','servicio','comision','comision_bancaria') then 'gastos'
       else 'sin_clasificar' end k,
      monto, (tipo='abono' and categoria='prestamo') es_disp
    from bank_movements where fecha >= v_desde and fecha < v_hasta
  ),
  c as (
    select date_trunc('month', fecha)::date m, case when moneda='USD' then 'usd' else 'mxn' end cur,
      case
       when tipo='cobro_cliente' then 'cobranza'
       when tipo='aportacion' then 'aportacion'
       when tipo='pago_proveedor' then 'proveedores'
       when tipo='nomina_efectivo' then 'nomina'
       when direccion='egreso' then 'gastos'
       else 'otros_ing' end k, monto
    from cash_movements where fecha >= v_desde and fecha < v_hasta
  ),
  mov as (
    select m, cur, k, sum(monto) s from (
      select m, cur, k, monto from b
      union all
      select m, cur, 'efvo_' || k, monto from c) z group by 1,2,3
  ),
  ven as (
    select date_trunc('month', coalesce(q.fecha_contrato,
              (select min(q2.fecha_contrato) from quotations q2 where q2.version_group_id = q.version_group_id),
              q.stage_changed_at::date, q.created_at::date))::date m,
           lower(v.moneda) cur, sum(v.vendido) s, count(*) n
    from v_cobranza_cotizacion v join quotations q on q.id = v.quotation_id
    where q.archived_at is null
    group by 1,2
  ),
  nom as (
    select make_date(anio, mes, 1) m,
           sum(coalesce(total_transferencia,0) + coalesce(total_efectivo,0)) s,
           bool_or(coalesce(estatus, status::text) = 'cerrado') cerrado
    from payroll_periods group by 1
  ),
  disp as (select m, count(*) n from b where es_disp group by 1)
  select jsonb_set(r, '{meses}', coalesce(jsonb_agg(jsonb_build_object(
    'mes', to_char(me.m, 'YYYY-MM'),
    'cobranza_banco_mxn', coalesce((select s from mov where m=me.m and cur='mxn' and k='cobranza'),0) - coalesce((select s from mov where m=me.m and cur='mxn' and k='cobranza_dev'),0),
    'cobranza_banco_usd', coalesce((select s from mov where m=me.m and cur='usd' and k='cobranza'),0) - coalesce((select s from mov where m=me.m and cur='usd' and k='cobranza_dev'),0),
    'cobranza_efvo_mxn',  coalesce((select s from mov where m=me.m and cur='mxn' and k='efvo_cobranza'),0),
    'cobranza_efvo_usd',  coalesce((select s from mov where m=me.m and cur='usd' and k='efvo_cobranza'),0),
    'vendido_mxn', coalesce((select s from ven where m=me.m and cur='mxn'),0),
    'vendido_usd', coalesce((select s from ven where m=me.m and cur='usd'),0),
    'contratos',   coalesce((select sum(n) from ven where m=me.m),0),
    'proveedores_mxn', coalesce((select sum(s) from mov where m=me.m and cur='mxn' and k in ('proveedores','efvo_proveedores')),0) - coalesce((select s from mov where m=me.m and cur='mxn' and k='prov_dev'),0),
    'proveedores_usd', coalesce((select sum(s) from mov where m=me.m and cur='usd' and k in ('proveedores','efvo_proveedores')),0) - coalesce((select s from mov where m=me.m and cur='usd' and k='prov_dev'),0),
    'nomina_banco',  coalesce((select sum(s) from mov where m=me.m and k='nomina'),0),
    'nomina_efvo',   coalesce((select sum(s) from mov where m=me.m and k='efvo_nomina'),0),
    'nomina_modulo', coalesce((select s from nom where m=me.m),0),
    'nomina_cerrada', coalesce((select cerrado from nom where m=me.m), false),
    'impuestos', coalesce((select sum(s) from mov where m=me.m and k='impuestos'),0),
    'gastos_mxn', coalesce((select sum(s) from mov where m=me.m and cur='mxn' and k in ('gastos','efvo_gastos')),0),
    'gastos_usd', coalesce((select sum(s) from mov where m=me.m and cur='usd' and k in ('gastos','efvo_gastos')),0),
    'sin_clasificar_mxn', coalesce((select s from mov where m=me.m and cur='mxn' and k='sin_clasificar'),0),
    'sin_clasificar_usd', coalesce((select s from mov where m=me.m and cur='usd' and k='sin_clasificar'),0),
    'otros_ingresos_mxn', coalesce((select sum(s) from mov where m=me.m and cur='mxn' and k in ('otros_ing','efvo_otros_ing')),0),
    'otros_ingresos_usd', coalesce((select sum(s) from mov where m=me.m and cur='usd' and k in ('otros_ing','efvo_otros_ing')),0),
    'revolvente_dispuesto', coalesce((select sum(s) from mov where m=me.m and k='fin_entra'),0),
    'revolvente_pagado',    coalesce((select sum(s) from mov where m=me.m and k='fin_sale'),0),
    'disposiciones',        coalesce((select n from disp where m=me.m),0),
    'aportaciones',         coalesce((select sum(s) from mov where m=me.m and k='efvo_aportacion'),0)
  ) order by me.m), '[]'::jsonb))
  into r from meses me;

  with v as (
    select vc.lead_id, lower(vc.moneda) cur, sum(vc.vendido) vendido, sum(vc.cobrado) cob_q, count(*) n,
           min(coalesce(q.fecha_contrato, q.stage_changed_at::date)) primer_contrato
    from v_cobranza_cotizacion vc join quotations q on q.id = vc.quotation_id
    where vc.lead_id is not null and q.archived_at is null group by 1,2),
  extra as (
    select lead_id, case when moneda='USD' then 'usd' else 'mxn' end cur, sum(monto) m from bank_movements b
     where tipo='abono' and categoria in ('cobro_cliente','pago_proveedor','proveedor_obra','proveedor','anticipo_proveedor') and quotation_id is null and lead_id is not null
       and not exists (select 1 from payment_allocations pa where pa.bank_movement_id=b.id) group by 1,2
    union all
    select lead_id, case when moneda='USD' then 'usd' else 'mxn' end, sum(monto) from cash_movements
     where tipo='cobro_cliente' and quotation_id is null and lead_id is not null group by 1,2),
  ultimo as (
    select lead_id, max(f) f from (
      select coalesce(b.lead_id, nullif(omm_notes_json(q.notes)->>'lead_id','')::uuid) lead_id, b.fecha f
        from bank_movements b left join quotations q on q.id=b.quotation_id
       where b.tipo='abono' and (b.categoria='cobro_cliente' or (b.categoria in ('pago_proveedor','proveedor_obra','proveedor','anticipo_proveedor') and (b.quotation_id is not null or b.lead_id is not null)))
      union all
      select coalesce(m.lead_id, nullif(omm_notes_json(q.notes)->>'lead_id','')::uuid), m.fecha
        from cash_movements m left join quotations q on q.id=m.quotation_id where m.tipo='cobro_cliente'
      union all
      select nullif(omm_notes_json(q.notes)->>'lead_id','')::uuid, b.fecha
        from payment_allocations pa join bank_movements b on b.id=pa.bank_movement_id join quotations q on q.id=pa.quotation_id
    ) z where lead_id is not null group by 1),
  l as (
    select v.lead_id, v.cur, v.vendido, v.cob_q + coalesce((select sum(e.m) from extra e where e.lead_id=v.lead_id and e.cur=v.cur),0) cobrado,
           v.n, v.primer_contrato, u.f ultimo_cobro
    from v left join ultimo u on u.lead_id=v.lead_id),
  lc as (
    select l.*, greatest(vendido - cobrado, 0) saldo,
      case when ultimo_cobro is null then 'sin_cobro'
           when current_date - ultimo_cobro <= 90 then 'al_corriente'
           when current_date - ultimo_cobro <= 180 then 'lenta'
           else 'parada' end estado
    from l)
  select r || jsonb_build_object('cartera', jsonb_build_object(
      'resumen', coalesce((select jsonb_agg(jsonb_build_object('cur',cur,'estado',estado,'saldo',round(s,2),'leads',n))
                   from (select cur, estado, sum(saldo) s, count(*) n from lc where saldo > 1 group by 1,2) t), '[]'::jsonb),
      'leads', coalesce((select jsonb_agg(x order by (x->>'saldo')::numeric desc) from (
                  select jsonb_build_object('lead_id', lc.lead_id, 'lead', le.name, 'clave', le.codigo, 'cur', lc.cur,
                    'vendido', round(lc.vendido,2), 'cobrado', round(lc.cobrado,2), 'saldo', round(lc.saldo,2),
                    'contratos', lc.n, 'primer_contrato', lc.primer_contrato, 'ultimo_cobro', lc.ultimo_cobro, 'estado', lc.estado) x
                  from lc join leads le on le.id = lc.lead_id where lc.saldo > 1) t), '[]'::jsonb)))
  into r;

  with p as (
    select po.id, po.folio, po.po_number, po.status, case when po.currency='USD' then 'usd' else 'mxn' end cur,
           po.total, po.fecha_maxima_pago, s.name proveedor, le.name lead,
           coalesce((select sum(amount) from purchase_order_payments x where x.purchase_order_id=po.id),0) pagado
    from purchase_orders po
    left join suppliers s on s.id = po.supplier_id
    left join leads le on le.id = po.lead_id
    where po.status in ('aprobada','pedida','recibida','recibida_parcial','borrador') and po.pagada_at is null),
  q as (
    select p.*, greatest(total - pagado, 0) saldo,
      case when status = 'borrador' then 'por_aprobar'
           when fecha_maxima_pago is null then 'sin_fecha'
           when fecha_maxima_pago < current_date then 'vencida'
           when fecha_maxima_pago <= current_date + 7 then 'semana'
           when fecha_maxima_pago <= current_date + 30 then 'mes'
           else 'despues' end bucket
    from p)
  select r || jsonb_build_object('cxp', jsonb_build_object(
      'resumen', coalesce((select jsonb_agg(jsonb_build_object('cur',cur,'bucket',bucket,'saldo',round(s,2),'n',n))
                   from (select cur, bucket, sum(saldo) s, count(*) n from q where saldo > 0.5 group by 1,2) t), '[]'::jsonb),
      'ocs', coalesce((select jsonb_agg(x order by (x->>'saldo')::numeric desc) from (
                  select jsonb_build_object('id', id, 'folio', coalesce(folio, po_number), 'status', status, 'cur', cur,
                    'total', round(total,2), 'pagado', round(pagado,2), 'saldo', round(saldo,2), 'fecha_maxima_pago', fecha_maxima_pago,
                    'proveedor', proveedor, 'lead', lead, 'bucket', bucket) x
                  from q where saldo > 0.5) t), '[]'::jsonb)))
  into r;

  with cob as (
    select omm_linea_negocio(qq.specialty::text, qq.name) linea,
           case when b.moneda='USD' then 'usd' else 'mxn' end cur, coalesce(pa.monto_origen, pa.monto) s
      from payment_allocations pa join bank_movements b on b.id=pa.bank_movement_id join quotations qq on qq.id=pa.quotation_id
     where b.fecha >= v_desde and b.fecha < v_hasta and b.tipo='abono'
    union all
    select case when b.quotation_id is null then 'sin_liga' else omm_linea_negocio(qq.specialty::text, qq.name) end,
           case when b.moneda='USD' then 'usd' else 'mxn' end, b.monto
      from bank_movements b left join quotations qq on qq.id=b.quotation_id
     where b.tipo='abono' and b.fecha >= v_desde and b.fecha < v_hasta
       and (b.categoria='cobro_cliente' or (b.categoria in ('pago_proveedor','proveedor_obra','proveedor','anticipo_proveedor') and (b.quotation_id is not null or b.lead_id is not null)))
       and not exists (select 1 from payment_allocations pa where pa.bank_movement_id=b.id)
    union all
    select case when b.quotation_id is null then 'sin_liga' else omm_linea_negocio(qq.specialty::text, qq.name) end,
           case when b.moneda='USD' then 'usd' else 'mxn' end, -b.monto
      from bank_movements b left join quotations qq on qq.id=b.quotation_id
     where b.tipo='cargo' and b.categoria='cobro_cliente' and b.fecha >= v_desde and b.fecha < v_hasta
    union all
    select case when m.quotation_id is null then 'sin_liga' else omm_linea_negocio(qq.specialty::text, qq.name) end,
           case when coalesce(m.moneda,'MXN')='USD' then 'usd' else 'mxn' end, m.monto
      from cash_movements m left join quotations qq on qq.id=m.quotation_id
     where m.tipo='cobro_cliente' and m.fecha >= v_desde and m.fecha < v_hasta),
  prov as (
    select case when b.quotation_id is null then 'sin_liga' else omm_linea_negocio(qq.specialty::text, qq.name) end linea,
           case when b.moneda='USD' then 'usd' else 'mxn' end cur,
           case when b.tipo='cargo' then b.monto else -b.monto end s
      from bank_movements b left join quotations qq on qq.id=b.quotation_id
     where b.categoria in ('pago_proveedor','proveedor','proveedor_obra','anticipo_proveedor') and b.fecha >= v_desde and b.fecha < v_hasta
       and not (b.tipo='abono' and (b.quotation_id is not null or b.lead_id is not null))
    union all
    select case when m.quotation_id is null then 'sin_liga' else omm_linea_negocio(qq.specialty::text, qq.name) end,
           case when coalesce(m.moneda,'MXN')='USD' then 'usd' else 'mxn' end, m.monto
      from cash_movements m left join quotations qq on qq.id=m.quotation_id
     where m.tipo='pago_proveedor' and m.fecha >= v_desde and m.fecha < v_hasta),
  nom as (
    select omm_linea_de_area(e.area) linea, sum(coalesce(pi.neto_a_pagar_cfdi,0) + coalesce(pi.total_efectivo_final,0)) s,
           count(distinct pi.employee_id) personas
      from payroll_items pi join payroll_periods pp on pp.id=pi.period_id join employees e on e.id=pi.employee_id
     where make_date(pp.anio, pp.mes, 1) >= v_desde and make_date(pp.anio, pp.mes, 1) < v_hasta
     group by 1),
  ven as (
    select omm_linea_negocio(q.specialty::text, q.name) linea, lower(v.moneda) cur, sum(v.vendido) s
      from v_cobranza_cotizacion v join quotations q on q.id=v.quotation_id
     where q.archived_at is null
       and coalesce(q.fecha_contrato, q.stage_changed_at::date) >= v_desde and coalesce(q.fecha_contrato, q.stage_changed_at::date) < v_hasta
     group by 1,2),
  lineas as (
    select linea from cob union select linea from prov union select linea from nom union select linea from ven)
  select r || jsonb_build_object('lineas', coalesce(jsonb_agg(jsonb_build_object(
      'linea', li.linea,
      'vendido_mxn', coalesce((select s from ven where linea=li.linea and cur='mxn'),0),
      'vendido_usd', coalesce((select s from ven where linea=li.linea and cur='usd'),0),
      'cobrado_mxn', coalesce((select sum(s) from cob where linea=li.linea and cur='mxn'),0),
      'cobrado_usd', coalesce((select sum(s) from cob where linea=li.linea and cur='usd'),0),
      'proveedores_mxn', coalesce((select sum(s) from prov where linea=li.linea and cur='mxn'),0),
      'proveedores_usd', coalesce((select sum(s) from prov where linea=li.linea and cur='usd'),0),
      'nomina', coalesce((select s from nom where linea=li.linea),0),
      'personas', coalesce((select personas from nom where linea=li.linea),0)
    )), '[]'::jsonb))
  into r from lineas li;

  select r || jsonb_build_object(
    'frescura', jsonb_build_object(
      'cuentas', coalesce((select jsonb_agg(jsonb_build_object('cuenta', cuenta, 'moneda', moneda, 'ultimo', u)) from
                   (select cuenta, max(moneda) moneda, max(fecha) u from bank_movements group by cuenta) t), '[]'::jsonb),
      'efectivo', (select max(fecha) from cash_movements),
      'nomina', (select max(coalesce(fecha_hasta, period_end)) from payroll_periods)),
    'por_confirmar', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'folio', q.folio, 'name', q.name,
            'lead', omm_notes_json(q.notes)->>'lead_name', 'fecha_contrato', q.fecha_contrato,
            'moneda', v.moneda, 'vendido', v.vendido) order by v.vendido desc)
        from quotations q join v_cobranza_cotizacion v on v.quotation_id = q.id
        where q.fecha_contrato_fuente = 'por_confirmar' and q.archived_at is null), '[]'::jsonb),
    'generado', now())
  into r;

  return r;
end $$;

revoke execute on function public.finanzas_tablero(date, date) from public, anon;
grant execute on function public.finanzas_tablero(date, date) to authenticated;
