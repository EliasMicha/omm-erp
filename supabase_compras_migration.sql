-- ═══════════════════════════════════════════════════════════════
-- MÓDULO DE COMPRAS — Migración completa para Supabase
-- Ejecutar en Supabase SQL Editor EN ORDEN
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. TABLA PROVEEDORES (crear primero) ────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  rfc TEXT,
  address TEXT,
  payment_terms TEXT DEFAULT 'credito_30'
    CHECK (payment_terms IN ('contado','credito_15','credito_30','credito_60','anticipo_50')),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  systems TEXT[] DEFAULT '{}'
);

-- ─── 2. ÓRDENES DE COMPRA ────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  po_number TEXT NOT NULL UNIQUE,
  project_id UUID REFERENCES projects(id),
  supplier_id UUID REFERENCES suppliers(id),
  quotation_id UUID REFERENCES quotations(id),
  specialty TEXT DEFAULT 'esp'
    CHECK (specialty IN ('esp','elec','ilum','cort','proy')),
  purchase_phase TEXT DEFAULT 'inicio'
    CHECK (purchase_phase IN ('inicio','roughin','acabados','cierre')),
  status TEXT DEFAULT 'borrador'
    CHECK (status IN ('borrador','aprobada','pedida','recibida_parcial','recibida','cancelada')),
  subtotal NUMERIC DEFAULT 0,
  iva NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  notes TEXT,
  requested_by TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  expected_delivery DATE,
  delivered_at TIMESTAMPTZ
);

-- ─── 3. PARTIDAS DE OC (con campos de cotejo) ───────────────
CREATE TABLE IF NOT EXISTS po_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  catalog_product_id UUID REFERENCES catalog_products(id),
  name TEXT NOT NULL,
  description TEXT,
  system TEXT,
  unit TEXT DEFAULT 'pza',
  quantity NUMERIC DEFAULT 1,
  unit_cost NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  quantity_received NUMERIC DEFAULT 0,
  order_index INTEGER DEFAULT 0,
  -- Cotejo: valores reales vs catálogo
  real_name TEXT,            -- nombre/modelo real (si hubo sustitución)
  real_unit_cost NUMERIC,    -- precio unitario real del proveedor
  real_quantity NUMERIC,     -- cantidad real (puede variar por empaque)
  real_total NUMERIC,        -- total real de la compra
  cotejo_status TEXT DEFAULT 'pendiente'
    CHECK (cotejo_status IN ('pendiente','cotejado','sustituido')),
  cotejo_notes TEXT           -- notas del cotejo (razón de sustitución, etc.)
);

-- ─── 4. NUEVOS CAMPOS EN CATÁLOGO ────────────────────────────
-- supplier_id = distribuidor (quién me lo vende)
-- purchase_phase = en qué fase de obra se compra
-- provider (ya existe) = marca del producto
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS purchase_phase TEXT DEFAULT 'inicio'
  CHECK (purchase_phase IN ('inicio','roughin','acabados','cierre'));

-- ─── 5. NUEVOS CAMPOS EN PARTIDAS DE COTIZACIÓN ─────────────
-- Se heredan del catálogo al agregar producto a la cotización
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS purchase_phase TEXT DEFAULT 'inicio'
  CHECK (purchase_phase IN ('inicio','roughin','acabados','cierre'));

-- ═══════════════════════════════════════════════════════════════
-- ÍNDICES
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_po_project ON purchase_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_phase ON purchase_orders(purchase_phase);
CREATE INDEX IF NOT EXISTS idx_po_quotation ON purchase_orders(quotation_id);
CREATE INDEX IF NOT EXISTS idx_po_number ON purchase_orders(po_number);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON po_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_cotejo ON po_items(cotejo_status);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active);
CREATE INDEX IF NOT EXISTS idx_cat_supplier ON catalog_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_cat_phase ON catalog_products(purchase_phase);

-- ═══════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon - suppliers" ON suppliers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon - purchase_orders" ON purchase_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon - po_items" ON po_items FOR ALL USING (true) WITH CHECK (true);
