-- Acceso específico a la sección de Mantenimiento en la app de campo (obra-app).
-- Solo empleados con mantenimiento_app=true ven "Mis visitas" y reciben visitas asignadas.
-- Aplicada en Supabase el 2026-06-23.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS mantenimiento_app boolean NOT NULL DEFAULT false;
