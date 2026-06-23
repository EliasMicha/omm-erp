-- Auto-cotización de "visita suelta" cuando la visita no está cubierta por póliza.
-- Aplicada en Supabase el 2026-06-23.

CREATE TABLE IF NOT EXISTS public.maintenance_settings (
  key text PRIMARY KEY,
  value numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.maintenance_settings (key, value) VALUES ('precio_visita_suelta', 3000)
ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.maintenance_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_settings' AND policyname='maint_settings_all') THEN
    CREATE POLICY maint_settings_all ON public.maintenance_settings FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.maintenance_quotes
  ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.maintenance_visits(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_maint_quotes_visit ON public.maintenance_quotes(visit_id);

CREATE OR REPLACE FUNCTION public.gen_visita_suelta_quote()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE has_poliza boolean; v_price numeric; q_id uuid;
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

  INSERT INTO public.maintenance_quotes (property_id, visit_id, title, status, currency, subtotal, iva, total, notes, follow_up_at)
  VALUES (NEW.property_id, NEW.id, 'Visita suelta (sin póliza)', 'borrador', 'MXN',
          v_price, ROUND(v_price * 0.16, 2), ROUND(v_price * 1.16, 2),
          'Generada automáticamente: visita sin póliza. Ajusta antes de enviar al cliente.', NEW.visit_date)
  RETURNING id INTO q_id;

  INSERT INTO public.maintenance_quote_items (quote_id, name, quantity, unit_price, total, order_index)
  VALUES (q_id, 'Visita de mantenimiento a sitio (sin póliza)', 1, v_price, v_price, 0);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gen_visita_suelta ON public.maintenance_visits;
CREATE TRIGGER trg_gen_visita_suelta
  AFTER INSERT ON public.maintenance_visits
  FOR EACH ROW EXECUTE FUNCTION public.gen_visita_suelta_quote();
