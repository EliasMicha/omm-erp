-- Cotizaciones de mantenimiento: tipo de cambio, programación e instalación por concepto.
-- El catálogo está mayormente en USD; el editor convierte a la moneda de la cotización con tipo_cambio.
-- Aplicada en Supabase el 2026-06-23.

ALTER TABLE public.maintenance_quotes
  ADD COLUMN IF NOT EXISTS tipo_cambio numeric,
  ADD COLUMN IF NOT EXISTS programacion numeric NOT NULL DEFAULT 0;

ALTER TABLE public.maintenance_quote_items
  ADD COLUMN IF NOT EXISTS installation numeric NOT NULL DEFAULT 0;
