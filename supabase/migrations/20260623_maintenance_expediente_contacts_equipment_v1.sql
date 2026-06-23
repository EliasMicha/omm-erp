-- Expediente de propiedad: contactos + equipos instalados (sin precios)
-- Aplicada en Supabase el 2026-06-23.

CREATE TABLE IF NOT EXISTS public.maintenance_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.maintenance_properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone_e164 text,
  email text,
  role text NOT NULL DEFAULT 'dueño',
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maintenance_contacts_property ON public.maintenance_contacts(property_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_contacts_phone ON public.maintenance_contacts(phone_e164);

CREATE TABLE IF NOT EXISTS public.maintenance_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.maintenance_properties(id) ON DELETE CASCADE,
  system text, marca text, modelo text, sku text, ubicacion text,
  cantidad numeric DEFAULT 1, serial text,
  fecha_instalacion date, garantia_fin date,
  image_url text, notes text,
  source_quotation_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maintenance_equipment_property ON public.maintenance_equipment(property_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_equipment_source ON public.maintenance_equipment(source_quotation_item_id) WHERE source_quotation_item_id IS NOT NULL;

-- Siembra equipos desde la cotización original (sin precios), idempotente
CREATE OR REPLACE FUNCTION public.seed_maintenance_equipment_from_quotation(p_property_id uuid, p_quotation_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.maintenance_equipment
    (property_id, system, marca, modelo, sku, cantidad, image_url, source_quotation_item_id, notes)
  SELECT p_property_id, qi.system::text, qi.marca, qi.modelo, qi.sku,
         COALESCE(qi.quantity, 1), qi.image_url, qi.id, qi.name
  FROM public.quotation_items qi
  WHERE qi.quotation_id = p_quotation_id
    AND (COALESCE(qi.marca,'') <> '' OR COALESCE(qi.modelo,'') <> '')
    AND NOT EXISTS (SELECT 1 FROM public.maintenance_equipment me WHERE me.source_quotation_item_id = qi.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

ALTER TABLE public.maintenance_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_equipment ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_contacts' AND policyname='maint_contacts_all') THEN
    CREATE POLICY maint_contacts_all ON public.maintenance_contacts FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_equipment' AND policyname='maint_equipment_all') THEN
    CREATE POLICY maint_equipment_all ON public.maintenance_equipment FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
