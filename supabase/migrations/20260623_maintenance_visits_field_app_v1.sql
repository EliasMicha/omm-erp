-- Fase 1 (Mantenimiento como unidad de negocio): app de campo + agenda de visitas
-- Aplicada en Supabase el 2026-06-23.

-- 1) Extender maintenance_visits para scheduling + reporte de campo
ALTER TABLE public.maintenance_visits
  ADD COLUMN IF NOT EXISTS scheduled_time time,
  ADD COLUMN IF NOT EXISTS technician_id uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS route_order integer,
  ADD COLUMN IF NOT EXISTS en_route_at timestamptz,
  ADD COLUMN IF NOT EXISTS arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_lat numeric,
  ADD COLUMN IF NOT EXISTS checkin_lng numeric,
  ADD COLUMN IF NOT EXISTS checkin_accuracy numeric,
  ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS report jsonb,
  ADD COLUMN IF NOT EXISTS client_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS signature_url text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_maintenance_visits_tech_date
  ON public.maintenance_visits (technician_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_visits_status
  ON public.maintenance_visits (status);

-- 2) RPC para incrementar visitas usadas de una póliza
CREATE OR REPLACE FUNCTION public.increment_visits_used(contract_id_param uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.maintenance_contracts
  SET visits_used = COALESCE(visits_used, 0) + 1,
      updated_at = now()
  WHERE id = contract_id_param;
$$;

-- 3) Bucket de evidencias de visitas + políticas
INSERT INTO storage.buckets (id, name, public)
VALUES ('mantenimiento-evidencias', 'mantenimiento-evidencias', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='mant_evidencias_all_authenticated') THEN
    CREATE POLICY mant_evidencias_all_authenticated ON storage.objects FOR ALL TO authenticated
      USING (bucket_id = 'mantenimiento-evidencias') WITH CHECK (bucket_id = 'mantenimiento-evidencias');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='mant_evidencias_read_anon') THEN
    CREATE POLICY mant_evidencias_read_anon ON storage.objects FOR SELECT TO anon
      USING (bucket_id = 'mantenimiento-evidencias');
  END IF;
END $$;
