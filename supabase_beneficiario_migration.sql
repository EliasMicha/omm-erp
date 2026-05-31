-- Migración: separar Beneficiario (real, FK a catálogos) del Concepto detectado
-- Sesión 2026-05-31: el extractor IA usaba beneficiario para guardar categorías
-- ("SPEI nómina", "Pagofactura", "Depósito cliente") en vez del nombre real
-- del proveedor/cliente/empleado. Esta migración corrige el esquema.

-- 1. Agregar nuevas columnas
ALTER TABLE bank_movements
  ADD COLUMN IF NOT EXISTS concepto_detectado text,
  ADD COLUMN IF NOT EXISTS beneficiario_id uuid,
  ADD COLUMN IF NOT EXISTS beneficiario_tipo text
    CHECK (beneficiario_tipo IS NULL OR beneficiario_tipo IN ('proveedor', 'cliente', 'empleado', 'manual'));

-- 2. Migrar histórico: mover valores actuales de beneficiario → concepto_detectado
--    y vaciar beneficiario para que aparezca como "sin asignar" en la UI
UPDATE bank_movements
SET concepto_detectado = beneficiario,
    beneficiario = NULL
WHERE beneficiario IS NOT NULL
  AND beneficiario_id IS NULL;

-- 3. Index para búsqueda por beneficiario asignado
CREATE INDEX IF NOT EXISTS idx_bank_movements_beneficiario
  ON bank_movements(beneficiario_id, beneficiario_tipo)
  WHERE beneficiario_id IS NOT NULL;

-- 4. Verificación
SELECT
  COUNT(*) FILTER (WHERE concepto_detectado IS NOT NULL) AS con_detectado,
  COUNT(*) FILTER (WHERE beneficiario IS NULL AND beneficiario_id IS NULL) AS sin_asignar,
  COUNT(*) FILTER (WHERE beneficiario_id IS NOT NULL) AS con_asignacion_real
FROM bank_movements;
