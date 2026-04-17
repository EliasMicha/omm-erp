-- ============================================================================
-- OMM ERP — Entregas v2 · PASO 2 de 5
-- Fecha:     2026-04-16
-- Autor:     Elias / Claude
-- Objetivo:  Extender la tabla deliveries con columnas para el módulo v2.
--              * folio auto (ENT-000001) vía sequence + trigger
--              * vínculos estructurados: po_id, obra_id, installer_id
--              * firmas como URL (signature pad en frontend → storage)
--              * updated_at + notes
--              * nuevo valor 'recoleccion_directa' en enum delivery_type
--                (recolección que va directo a obra saltándose bodega)
--
-- YA APLICADA vía MCP apply_migration. Este archivo queda como registro.
-- Idempotente. 0 filas en deliveries al momento de aplicar, safe DROP NOT NULL.
-- ============================================================================


-- 1. Nuevo valor en enum delivery_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'delivery_type' AND e.enumlabel = 'recoleccion_directa'
  ) THEN
    ALTER TYPE delivery_type ADD VALUE 'recoleccion_directa';
  END IF;
END $$;


-- 2. Relajar origin/destination a nullable
ALTER TABLE deliveries ALTER COLUMN origin DROP NOT NULL;
ALTER TABLE deliveries ALTER COLUMN destination DROP NOT NULL;


-- 3. Columnas nuevas
ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS folio                  text UNIQUE,
  ADD COLUMN IF NOT EXISTS po_id                  uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS obra_id                uuid REFERENCES obras(id)           ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS installer_id           uuid REFERENCES employees(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signature_driver_url   text,
  ADD COLUMN IF NOT EXISTS signature_receiver_url text,
  ADD COLUMN IF NOT EXISTS notes                  text,
  ADD COLUMN IF NOT EXISTS updated_at             timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN deliveries.folio IS
  'Folio auto-generado: ENT-000001. Se asigna al INSERT por trigger.';
COMMENT ON COLUMN deliveries.po_id IS
  'PO que originó esta entrega/recolección. NULL si es movimiento manual bodega→obra.';
COMMENT ON COLUMN deliveries.obra_id IS
  'Obra destino. NULL si es solo recolección a bodega.';
COMMENT ON COLUMN deliveries.installer_id IS
  'Líder instalador receptor (auto-seleccionado desde installer_daily_assignment).';


-- 4. Secuencia + función + trigger para folio
CREATE SEQUENCE IF NOT EXISTS deliveries_folio_seq START 1;

CREATE OR REPLACE FUNCTION generate_delivery_folio()
RETURNS trigger AS $$
BEGIN
  IF NEW.folio IS NULL OR NEW.folio = '' THEN
    NEW.folio := 'ENT-' || LPAD(nextval('deliveries_folio_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deliveries_folio_trigger ON deliveries;
CREATE TRIGGER deliveries_folio_trigger
  BEFORE INSERT ON deliveries
  FOR EACH ROW
  EXECUTE FUNCTION generate_delivery_folio();


-- 5. Trigger de updated_at (usa set_updated_at ya existente en el schema)
DROP TRIGGER IF EXISTS deliveries_set_updated_at ON deliveries;
CREATE TRIGGER deliveries_set_updated_at
  BEFORE UPDATE ON deliveries
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- 6. Índices
CREATE INDEX IF NOT EXISTS idx_deliveries_po_id
  ON deliveries(po_id)        WHERE po_id        IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deliveries_obra_id
  ON deliveries(obra_id)      WHERE obra_id      IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deliveries_installer_id
  ON deliveries(installer_id) WHERE installer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deliveries_folio
  ON deliveries(folio);
CREATE INDEX IF NOT EXISTS idx_deliveries_status
  ON deliveries(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_delivery_date
  ON deliveries(delivery_date);


-- ============================================================================
-- FIN PASO 2
-- Verificación post-aplicación:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='deliveries'
--       AND column_name IN ('folio','po_id','obra_id','installer_id',
--                           'signature_driver_url','signature_receiver_url',
--                           'notes','updated_at');
--   SELECT enumlabel FROM pg_enum e
--     JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='delivery_type';
--   SELECT trigger_name FROM information_schema.triggers
--     WHERE event_object_table='deliveries';
-- ============================================================================
