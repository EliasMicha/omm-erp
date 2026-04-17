-- ============================================================================
-- OMM ERP — Migración Entregas v2 · PASO 1 de 5
-- Fecha:     2026-04-16
-- Autor:     Elias / Claude
-- Objetivo:  Habilitar modo logístico por PO + default por proveedor, y crear
--            tabla delivery_items para trazabilidad fina por item
--            (cotizado → pedido → recibido → entregado) a nivel obra.
--
-- Esta migración NO toca datos existentes. Solo agrega columnas (con default
-- seguro), enums nuevos y una tabla nueva. Es idempotente: se puede correr
-- varias veces sin romper nada.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. ENUM logistics_mode
--    Describe CÓMO llega el material de una PO.
--    pending             → aún no se decide
--    pickup_to_bodega    → OMM va por ella y la lleva a bodega
--    pickup_to_obra      → OMM va por ella y la lleva directo a obra
--    supplier_to_bodega  → proveedor la envía a bodega OMM
--    supplier_to_obra    → proveedor la envía directo a obra
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logistics_mode') THEN
    CREATE TYPE logistics_mode AS ENUM (
      'pending',
      'pickup_to_bodega',
      'pickup_to_obra',
      'supplier_to_bodega',
      'supplier_to_obra'
    );
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 2. suppliers.default_logistics_mode
--    Default que se precarga al crear una PO con este proveedor.
--    NULL = sin default (la PO queda en 'pending' hasta que alguien decida).
-- ----------------------------------------------------------------------------
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS default_logistics_mode logistics_mode;

COMMENT ON COLUMN suppliers.default_logistics_mode IS
  'Default logístico para nuevas POs de este proveedor. Editable a nivel PO.';


-- ----------------------------------------------------------------------------
-- 3. purchase_orders.logistics_mode + logistics_target_obra_id
--    logistics_mode             → cómo llega ESTA PO (override del default).
--    logistics_target_obra_id   → obra destino cuando el modo es *_to_obra
--                                 (entrega directa saltándose bodega).
-- ----------------------------------------------------------------------------
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS logistics_mode logistics_mode NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS logistics_target_obra_id uuid REFERENCES obras(id) ON DELETE SET NULL;

COMMENT ON COLUMN purchase_orders.logistics_mode IS
  'Cómo llega esta PO. pending hasta resolverse. Override del default del proveedor.';
COMMENT ON COLUMN purchase_orders.logistics_target_obra_id IS
  'Obra destino cuando logistics_mode es pickup_to_obra o supplier_to_obra.';

CREATE INDEX IF NOT EXISTS idx_po_logistics_mode
  ON purchase_orders(logistics_mode);
CREATE INDEX IF NOT EXISTS idx_po_logistics_target_obra
  ON purchase_orders(logistics_target_obra_id)
  WHERE logistics_target_obra_id IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 4. ENUM delivery_item_direction
--    Describe el EFECTO de cada renglón de entrega sobre el inventario.
--    in_bodega             → entrada a bodega OMM (recolección normal).
--    in_obra               → entrada directa a obra (sin pasar por bodega:
--                             recolección directa, o envío proveedor→obra).
--    out_bodega_to_obra    → salida de bodega OMM hacia una obra.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_item_direction') THEN
    CREATE TYPE delivery_item_direction AS ENUM (
      'in_bodega',
      'in_obra',
      'out_bodega_to_obra'
    );
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 5. Tabla delivery_items
--    Renglón por renglón de cada delivery. Es la fuente de verdad para:
--      * Recibido en bodega       = Σ qty donde direction = 'in_bodega'
--      * Recibido en obra X       = Σ qty donde direction = 'in_obra'
--                                    AND obra_id = X
--      * Entregado a obra X       = Σ qty donde direction IN
--                                    ('in_obra','out_bodega_to_obra')
--                                    AND obra_id = X
--      * Lo que sigue en bodega   = Σ in_bodega - Σ out_bodega_to_obra
--
--    Reemplaza la columna jsonb deliveries.items creada en v1 (se puede
--    deprecar en paso 3, no se borra aquí por seguridad).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delivery_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id     uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,

  -- Vínculo con la cadena de compras (nullable para items manuales sueltos)
  po_id           uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  po_item_id      uuid REFERENCES po_items(id) ON DELETE SET NULL,
  product_id      uuid REFERENCES catalog_products(id) ON DELETE SET NULL,

  -- Descripción y cantidad (redundantes respecto a po_item pero se guardan
  -- para congelar el estado al momento de la entrega)
  description     text NOT NULL,
  qty             numeric NOT NULL CHECK (qty > 0),
  unit            text,

  -- Efecto sobre el inventario
  direction       delivery_item_direction NOT NULL,

  -- Obra destino (requerida si direction es in_obra o out_bodega_to_obra)
  obra_id         uuid REFERENCES obras(id) ON DELETE SET NULL,

  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE delivery_items IS
  'Renglones de cada delivery. Es la fuente de verdad del inventario por obra.';
COMMENT ON COLUMN delivery_items.direction IS
  'in_bodega: entra a bodega OMM | in_obra: entra directo a obra | out_bodega_to_obra: sale de bodega a obra.';
COMMENT ON COLUMN delivery_items.obra_id IS
  'Obra destino. Obligatorio cuando direction != in_bodega.';

-- Validación: si direction requiere obra, obra_id no debe ser NULL
-- (no lo enforzamos con CHECK porque ON DELETE SET NULL puede volverlo NULL
--  legítimamente cuando se borra una obra — lo validamos en frontend / trigger
--  opcional en paso 3).

CREATE INDEX IF NOT EXISTS idx_delivery_items_delivery_id
  ON delivery_items(delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_items_po_id
  ON delivery_items(po_id) WHERE po_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_items_po_item_id
  ON delivery_items(po_item_id) WHERE po_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_items_obra_id
  ON delivery_items(obra_id) WHERE obra_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_items_product_id
  ON delivery_items(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_items_direction
  ON delivery_items(direction);


-- ----------------------------------------------------------------------------
-- 6. RLS en delivery_items (mismo patrón que el resto de tablas)
-- ----------------------------------------------------------------------------
ALTER TABLE delivery_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_items_all_authenticated ON delivery_items;
CREATE POLICY delivery_items_all_authenticated ON delivery_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- 7. (Opcional, NO se crea en este paso) — vistas de rollup
--    La vista obra_material_status (Cotizado | Pedido | Recibido | Entregado
--    por producto por obra) se construye en el PASO 4 cuando definamos la
--    política de match producto↔quotation_item. Placeholder comentado:
--
--      CREATE OR REPLACE VIEW obra_material_status AS
--        SELECT obra_id, product_id, description,
--               cotizado, pedido, recibido, entregado, ...
--        FROM (...) ...;
-- ----------------------------------------------------------------------------


-- ============================================================================
-- FIN PASO 1
-- Para verificar después de correr:
--   SELECT typname FROM pg_type
--     WHERE typname IN ('logistics_mode','delivery_item_direction');
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='purchase_orders'
--       AND column_name IN ('logistics_mode','logistics_target_obra_id');
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='suppliers' AND column_name='default_logistics_mode';
--   SELECT count(*) FROM delivery_items;  -- debe devolver 0
-- ============================================================================
