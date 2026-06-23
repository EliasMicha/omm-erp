-- Orden del día (queja/motivo) + condiciones en cotizaciones de mantenimiento.
-- El PDF de cotización de mantenimiento ahora replica el PDF oficial e incluye estas secciones.
-- Aplicada en Supabase el 2026-06-23.

ALTER TABLE public.maintenance_quotes
  ADD COLUMN IF NOT EXISTS orden_dia text,
  ADD COLUMN IF NOT EXISTS condiciones text;

CREATE OR REPLACE FUNCTION public.gen_visita_suelta_quote()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  has_poliza boolean; v_price numeric; q_id uuid; v_orden text;
  v_cond text := 'Esta cotización NO incluye materiales ni refacciones; de requerirse, se cotizan por separado y requieren autorización previa del cliente. Incluye únicamente la mano de obra / servicio descrito. Precios en MXN. Sujeto a disponibilidad de agenda. Garantía de 30 días sobre la mano de obra del servicio realizado.';
BEGIN
  IF NEW.contract_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.maintenance_contracts c
    WHERE c.property_id = NEW.property_id AND c.is_active
      AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
  ) INTO has_poliza;
  IF has_poliza THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.maintenance_quotes WHERE visit_id = NEW.id) THEN RETURN NEW; END IF;

  SELECT COALESCE(value, 3000) INTO v_price FROM public.maintenance_settings WHERE key = 'precio_visita_suelta';
  IF v_price IS NULL THEN v_price := 3000; END IF;

  IF NEW.ticket_id IS NOT NULL THEN
    SELECT NULLIF(TRIM(COALESCE(subject,'') || CASE WHEN description IS NOT NULL AND description <> '' THEN ' — ' || description ELSE '' END), '')
    INTO v_orden FROM public.maintenance_tickets WHERE id = NEW.ticket_id;
  END IF;
  IF v_orden IS NULL THEN v_orden := NULLIF(TRIM(COALESCE(NEW.notes,'')), ''); END IF;

  INSERT INTO public.maintenance_quotes (property_id, visit_id, title, status, currency, subtotal, iva, total, notes, follow_up_at, orden_dia, condiciones)
  VALUES (NEW.property_id, NEW.id, 'Visita suelta (sin póliza)', 'borrador', 'MXN',
          v_price, ROUND(v_price * 0.16, 2), ROUND(v_price * 1.16, 2),
          'Generada automáticamente: visita sin póliza. Ajusta antes de enviar al cliente.', NEW.visit_date, v_orden, v_cond)
  RETURNING id INTO q_id;

  INSERT INTO public.maintenance_quote_items (quote_id, name, quantity, unit_price, total, order_index)
  VALUES (q_id, 'Visita de mantenimiento a sitio (sin póliza)', 1, v_price, v_price, 0);
  RETURN NEW;
END $$;
