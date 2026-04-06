-- Tabla para movimientos bancarios (conciliación)
CREATE TABLE IF NOT EXISTS bank_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  fecha DATE NOT NULL,
  concepto TEXT NOT NULL DEFAULT '',
  referencia TEXT DEFAULT '',
  monto NUMERIC(14,2) NOT NULL DEFAULT 0,
  tipo TEXT NOT NULL CHECK (tipo IN ('cargo', 'abono')),
  saldo NUMERIC(14,2) DEFAULT 0,
  categoria TEXT DEFAULT 'otro',
  proyecto TEXT DEFAULT '',
  beneficiario TEXT DEFAULT '',
  conciliado BOOLEAN DEFAULT false,
  factura_match_id UUID REFERENCES facturas(id),
  factura_match_info TEXT DEFAULT '',
  banco TEXT DEFAULT 'BBVA',
  cuenta TEXT DEFAULT ''
);

-- Index para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_bank_movements_fecha ON bank_movements(fecha);
CREATE INDEX IF NOT EXISTS idx_bank_movements_conciliado ON bank_movements(conciliado);

-- RLS (permitir todo para authenticated, anon para dev)
ALTER TABLE bank_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON bank_movements FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON bank_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);
