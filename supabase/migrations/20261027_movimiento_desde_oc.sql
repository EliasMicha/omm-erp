-- Conciliación: cuando un CARGO queda ligado a una orden de compra (porque el
-- folio venía en el concepto o porque alguien la ligó a mano), la OC ya dice
-- de quién es el dinero. Se completa lo que falte, sin pisar lo que alguien
-- capturó a mano:
--   · cotización y lead           ← los de la OC, si el movimiento no los trae
--   · proyecto (texto que se ve)  ← nombre de la cotización o del lead
--   · categoría                   ← 'pago_proveedor' (o se deja 'anticipo_proveedor'),
--                                   solo si categoria_manual = false
--   · tipo de gasto               ← por especialidad de la cotización, si no hay
--   · beneficiario                ← el proveedor de la OC, si no hay
-- Corre después de tg_movimiento_folio (orden alfabético de triggers).
create or replace function public.omm_tg_movimiento_desde_oc()
returns trigger language plpgsql as $$
declare
  po record;
  v_esp text;
  v_cot_nombre text;
  v_lead_nombre text;
begin
  if new.purchase_order_id is null or coalesce(new.tipo, 'cargo') <> 'cargo' then
    return new;
  end if;
  select o.supplier_id, o.quotation_id, o.lead_id, s.name proveedor
    into po
    from purchase_orders o left join suppliers s on s.id = o.supplier_id
   where o.id = new.purchase_order_id;
  if not found then
    return new;
  end if;

  if new.quotation_id is null then new.quotation_id := po.quotation_id; end if;
  if new.lead_id is null then
    new.lead_id := coalesce(po.lead_id,
      (select nullif(omm_notes_json(q.notes)->>'lead_id', '')::uuid from quotations q where q.id = new.quotation_id));
  end if;

  select q.specialty::text, q.name into v_esp, v_cot_nombre from quotations q where q.id = new.quotation_id;
  select l.name into v_lead_nombre from leads l where l.id = new.lead_id;

  if coalesce(new.proyecto, '') = '' then
    new.proyecto := coalesce(v_cot_nombre, v_lead_nombre, '');
  end if;

  if not coalesce(new.categoria_manual, false) and coalesce(new.categoria, '') <> 'anticipo_proveedor' then
    new.categoria := 'pago_proveedor';
  end if;

  if new.tipo_gasto is null and coalesce(new.categoria, '') in ('pago_proveedor', 'anticipo_proveedor') then
    new.tipo_gasto := case v_esp
      when 'elec' then 'material_electrico'
      when 'ilum' then 'luminarias'
      when 'esp'  then 'instalaciones_especiales'
      when 'cort' then 'cortinas_persianas'
      else null end;
  end if;

  if new.beneficiario_id is null and po.supplier_id is not null then
    new.beneficiario_id := po.supplier_id;
    new.beneficiario_tipo := 'proveedor';
    if coalesce(new.beneficiario, '') = '' then new.beneficiario := po.proveedor; end if;
  end if;

  return new;
end $$;

create or replace trigger tg_movimiento_oc
  before insert or update of purchase_order_id, concepto on public.bank_movements
  for each row execute function public.omm_tg_movimiento_desde_oc();
