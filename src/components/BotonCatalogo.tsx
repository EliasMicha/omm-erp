// ═══════════════════════════════════════════════════════════════════════════
// BotonCatalogo — exporta la cotización abierta como catálogo de conceptos en
// formato de licitación (.xlsx). Se monta igual en los 6 cotizadores porque el
// exportador lee de quotation_items, no del estado del editor.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { exportarCatalogoLicitacion } from '../lib/catalogoLicitacion'

export default function BotonCatalogo({ cotId }: { cotId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  async function exportar(conPrecios: boolean) {
    setBusy(conPrecios ? 'val' : 'cot'); setError('')
    try {
      await exportarCatalogoLicitacion(cotId, { conPrecios })
      setAbierto(false)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally { setBusy('') }
  }

  const opt: React.CSSProperties = {
    width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 7, fontSize: 11,
    fontFamily: 'inherit', cursor: 'pointer', border: '1px solid #333', background: 'transparent',
    color: '#ddd', marginBottom: 6, lineHeight: 1.35,
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setAbierto(v => !v)} title="Exportar catálogo de conceptos para licitación (Excel)"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600, fontFamily: 'inherit',
          cursor: 'pointer', padding: '4px 10px', borderRadius: 8, border: '1px solid #16A34A55', background: '#16A34A18', color: '#4ADE80' }}>
        <FileSpreadsheet size={12} /> Catálogo (licitación)
      </button>
      {abierto && (
        <div style={{ position: 'absolute', right: 0, top: 28, zIndex: 70, width: 292, background: '#141414', border: '1px solid #333', borderRadius: 10, padding: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.65)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#ccc', marginBottom: 8 }}>Exportar catálogo de conceptos</div>
          <button disabled={!!busy} onClick={() => exportar(false)} style={{ ...opt, border: '1px solid #16A34A55', background: '#16A34A18', color: '#4ADE80', fontWeight: 700 }}>
            {busy === 'cot' ? 'Generando…' : 'Para cotizar (sin precios)'}
            <div style={{ fontSize: 9, color: '#7a9', fontWeight: 400, marginTop: 2 }}>Conceptos, marca/modelo de referencia, unidad y cantidad. P. unitario e importe en blanco para que el tercero los llene.</div>
          </button>
          <button disabled={!!busy} onClick={() => exportar(true)} style={opt}>
            {busy === 'val' ? 'Generando…' : 'Valorizado (con tus precios)'}
            <div style={{ fontSize: 9, color: '#888', fontWeight: 400, marginTop: 2 }}>Los mismos conceptos con precio unitario, importe, subtotal, IVA y total.</div>
          </button>
          <div style={{ fontSize: 9, color: '#666', lineHeight: 1.45 }}>
            Numeración jerárquica por partida (1, 1.1, 1.2…). En Especiales sale una pestaña por sistema más un resumen.
          </div>
          {error && <div style={{ fontSize: 10, color: '#EF4444', marginTop: 8 }}>⚠ {error}</div>}
        </div>
      )}
    </div>
  )
}
