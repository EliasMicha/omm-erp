-- Aplicada en Supabase el 2026-09-26. Copia para el repo.
-- Una sola definicion de "vendido" y "cobrado", espejo en SQL de la logica de
-- src/pages/Cobranza.tsx (vendidoDe y cobradoDe). Si una cambia, la otra tambien.
--
-- Cotejo: node con la logica del front NO sirve con llave anon — RLS oculta
-- payment_allocations (anon ve 0 de 62) y el resultado sale mal. Validar con
-- service role, o con una segunda formulacion SQL.
create or replace function public.omm_notes_json(t text)
returns jsonb language plpgsql immutable as $$
begin return coalesce(t,'')::jsonb; exception when others then return '{}'::jsonb; end $$;

create or replace view public.v_cobranza_cotizacion as
with q as (
  select c.id, c.name, c.specialty, c.total, c.total_final, c.commercial_year,
         public.omm_notes_json(c.notes) j
  from public.quotations c
  where c.stage = 'contrato' and c.vigente = true
),
base as (
  select q.id quotation_id, q.name, q.specialty, q.commercial_year,
         nullif(q.j->>'lead_id','')::uuid lead_id,
         case when q.j->>'currency' = 'MXN' then 'MXN' else 'USD' end moneda,
         case
           when q.total_final is not null and q.total_final::text <> ''
                and q.total_final::text ~ '^-?[0-9]+(\.[0-9]+)?$' then q.total_final::numeric
           when q.specialty in ('esp','cort','ilum','proy','dist','elec') then coalesce(q.total,0)
           else coalesce(q.total,0) * 1.16
         end vendido
  from q
),
aplicados as (select distinct bank_movement_id id from public.payment_allocations where bank_movement_id is not null)
select b.quotation_id, b.name, b.specialty, b.lead_id, b.moneda, b.commercial_year,
       round(b.vendido,2) vendido,
       round(coalesce((select sum(pa.monto) from public.payment_allocations pa where pa.quotation_id=b.quotation_id),0)
           + coalesce((select sum(m.monto) from public.bank_movements m
                        where m.quotation_id=b.quotation_id and m.tipo='abono'
                          and coalesce(m.moneda,'MXN')=b.moneda
                          and not exists (select 1 from aplicados a where a.id=m.id)),0)
           + coalesce((select sum(m.monto) from public.cash_movements m
                        where m.quotation_id=b.quotation_id and m.tipo='cobro_cliente'
                          and coalesce(m.moneda,'MXN')=b.moneda
                          and not exists (select 1 from aplicados a where a.id=m.id)),0)
       ,2) cobrado
from base b;

create or replace view public.v_cobranza_lead as
select l.id lead_id, l.name lead, l.company despacho, l.codigo clave,
       count(*) contratos,
       round(sum(v.vendido) filter (where v.moneda='MXN'),2) vendido_mxn,
       round(sum(v.cobrado) filter (where v.moneda='MXN'),2) cobrado_mxn,
       round(sum(v.vendido) filter (where v.moneda='USD'),2) vendido_usd,
       round(sum(v.cobrado) filter (where v.moneda='USD'),2) cobrado_usd
from public.v_cobranza_cotizacion v join public.leads l on l.id = v.lead_id
group by l.id, l.name, l.company, l.codigo;

-- Las vistas corren con los privilegios de su dueño: darselas a anon
-- destaparia las aplicaciones de pago que RLS si oculta.
grant select on public.v_cobranza_cotizacion, public.v_cobranza_lead to authenticated;
revoke select on public.v_cobranza_cotizacion, public.v_cobranza_lead from anon;
