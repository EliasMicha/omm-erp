-- Cotizaciones de mantenimiento (dentro del módulo, conectadas a catalog_products)
-- Aplicada en Supabase el 2026-06-23.

CREATE SEQUENCE IF NOT EXISTS maintenance_quotes_folio_seq START 1000;

CREATE TABLE IF NOT EXISTS public.maintenance_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.maintenance_properties(id) ON DELETE CASCADE,
  upsell_id uuid REFERENCES public.maintenance_upsell(id) ON DELETE SET NULL,
  folio integer NOT NULL DEFAULT nextval('maintenance_quotes_folio_seq'),
  title text NOT NULL DEFAULT 'Cotización de mantenimiento',
  status text NOT NULL DEFAULT 'borrador',
  currency text NOT NULL DEFAULT 'MXN',
  subtotal numeric NOT NULL DEFAULT 0,
  iva numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  valid_until date,
  follow_up_at date,
  notes text,
  sent_at timestamptz, accepted_at timestamptz, rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maint_quotes_property ON public.maintenance_quotes(property_id);
CREATE INDEX IF NOT EXISTS idx_maint_quotes_upsell ON public.maintenance_quotes(upsell_id);
CREATE INDEX IF NOT EXISTS idx_maint_quotes_status ON public.maintenance_quotes(status);

CREATE TABLE IF NOT EXISTS public.maintenance_quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.maintenance_quotes(id) ON DELETE CASCADE,
  catalog_product_id uuid,
  name text NOT NULL,
  marca text, modelo text, sku text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_cost numeric, markup numeric,
  unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  notes text, order_index integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maint_quote_items_quote ON public.maintenance_quote_items(quote_id);

ALTER TABLE public.maintenance_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_quote_items ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_quotes' AND policyname='maint_quotes_all') THEN
    CREATE POLICY maint_quotes_all ON public.maintenance_quotes FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_quote_items' AND policyname='maint_quote_items_all') THEN
    CREATE POLICY maint_quote_items_all ON public.maintenance_quote_items FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
