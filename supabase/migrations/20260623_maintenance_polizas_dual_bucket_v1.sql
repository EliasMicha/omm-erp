-- Pólizas: doble cubeta (preventivas vs emergencias/bomberazos) + datos del plan
-- Aplicada en Supabase el 2026-06-23.

ALTER TABLE public.maintenance_contracts
  ADD COLUMN IF NOT EXISTS plan_tier text,
  ADD COLUMN IF NOT EXISTS preventive_visits_included integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preventive_visits_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emergency_visits_included integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emergency_visits_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS project_value numeric,
  ADD COLUMN IF NOT EXISTS payment_plan text,
  ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS service_levels jsonb;

ALTER TABLE public.maintenance_visits
  ADD COLUMN IF NOT EXISTS visit_kind text NOT NULL DEFAULT 'preventiva';

-- Descuenta la cubeta correcta de la póliza según el tipo de visita
CREATE OR REPLACE FUNCTION public.increment_contract_visit(p_contract_id uuid, p_kind text)
RETURNS void LANGUAGE sql AS $$
  UPDATE public.maintenance_contracts SET
    emergency_visits_used  = emergency_visits_used  + (CASE WHEN p_kind IN ('emergencia','bomberazo') THEN 1 ELSE 0 END),
    preventive_visits_used = preventive_visits_used + (CASE WHEN p_kind IN ('emergencia','bomberazo') THEN 0 ELSE 1 END),
    visits_used = COALESCE(visits_used, 0) + 1,
    updated_at = now()
  WHERE id = p_contract_id;
$$;
