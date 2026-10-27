-- BBVA corta el texto libre del concepto a 18 caracteres. "Material MATIE01C30"
-- llega como "Material MATIE01C3": el folio de la OC pierde su último dígito y
-- omm_folio_en_concepto ya no lo encuentra (o encuentra solo la cotización).
--
-- Rescate SEGURO: una OC cuyo folio compacto, recortado 1 a 3 caracteres
-- (mínimo 8), aparece en el concepto, Y cuyo total es EXACTAMENTE el monto del
-- cargo, Y que no esté cancelada ni ligada ya a otro movimiento. Solo se asigna
-- si hay UNA candidata; con dos o más se deja para la persona.
create or replace function public.omm_oc_por_folio_truncado(p_concepto text, p_monto numeric, p_mov uuid default null)
returns table(folio text, lead_id uuid, quotation_id uuid, purchase_order_id uuid)
language sql stable as $$
  with c as (select omm_compacta(p_concepto) txt),
  cand as (
    select po.id, po.folio, po.lead_id, po.quotation_id, omm_compacta(po.folio) cf
      from purchase_orders po
     where po.folio is not null
       and po.status::text <> 'cancelada'
       and abs(coalesce(po.total, 0) - coalesce(p_monto, -1)) < 0.01
       and not exists (select 1 from bank_movements b
                        where b.purchase_order_id = po.id and b.id is distinct from p_mov)),
  hit as (
    select cand.* from cand, c
     where length(cand.cf) >= 9
       and exists (select 1 from generate_series(greatest(8, length(cand.cf) - 3), length(cand.cf) - 1) k
                    where position(left(cand.cf, k) in c.txt) > 0))
  select h.folio, h.lead_id, h.quotation_id, h.id from hit h
   where (select count(*) from hit) = 1
$$;

create or replace function public.omm_tg_movimiento_folio()
returns trigger language plpgsql as $$
declare m record; t record;
begin
  -- Un movimiento que alguien ya clasifico no se toca.
  if new.lead_id is not null or new.quotation_id is not null or new.purchase_order_id is not null then
    return new;
  end if;
  if coalesce(new.concepto, '') = '' then
    return new;
  end if;
  select * into m from omm_folio_en_concepto(new.concepto);
  -- Sin OC completa en el concepto (no hubo folio, o solo el de la cotización):
  -- puede venir el folio de la OC cortado por el banco. Se rescata solo con monto exacto.
  if (m.folio is null or m.purchase_order_id is null) and coalesce(new.tipo, 'cargo') = 'cargo' then
    select * into t from omm_oc_por_folio_truncado(new.concepto, new.monto, new.id);
    if t.purchase_order_id is not null then
      new.folio_detectado := t.folio;
      new.asignacion_auto := true;
      new.lead_id := t.lead_id;
      new.quotation_id := t.quotation_id;
      new.purchase_order_id := t.purchase_order_id;
      new.confianza_autodetect := 'alta';
      return new;
    end if;
  end if;
  if m.folio is null then
    return new;
  end if;
  new.folio_detectado := m.folio;
  new.asignacion_auto := true;
  new.lead_id := m.lead_id;
  new.quotation_id := m.quotation_id;
  new.purchase_order_id := m.purchase_order_id;
  new.confianza_autodetect := case when m.nivel = 'compra' then 'alta' else 'media' end;
  return new;
end $$;

-- Respaldo + relleno aplicados el 2026-10-27 (8 cargos):
-- create table bank_movements_respaldo_folio_trunc_20261027 as select ... (cargos sin OC con candidato único);
-- update bank_movements set purchase_order_id/quotation_id/lead_id/folio_detectado from omm_oc_por_folio_truncado(...)
--   where tipo='cargo' and purchase_order_id is null and (asignacion_auto or sin asignación).
-- tg_movimiento_oc completó proyecto, categoría (pago_proveedor), tipo_gasto y beneficiario.
