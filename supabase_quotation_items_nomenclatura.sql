-- ═══════════════════════════════════════════════════════════════════
-- Migration: agregar columna `nomenclatura` a quotation_items
-- Fecha: 2026-05-21
-- Contexto: cotizador de Iluminación — campo editable por línea de
-- cotización para el identificador del plano arquitectónico
-- (ej. "L-101", "D-AC-01", "AC-V1"). Vacío por default. Persiste
-- por proyecto (cotización).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.quotation_items
  ADD COLUMN IF NOT EXISTS nomenclatura text;

-- Índice parcial: solo indexa los que tienen valor (la mayoría serán NULL)
CREATE INDEX IF NOT EXISTS idx_quotation_items_nomenclatura
  ON public.quotation_items (nomenclatura)
  WHERE nomenclatura IS NOT NULL;

-- Verificación (opcional, comentado):
-- SELECT id, name, marca, modelo, nomenclatura FROM public.quotation_items LIMIT 5;
