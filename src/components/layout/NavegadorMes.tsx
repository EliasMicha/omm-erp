import { ReactNode } from 'react'
import { useIsMobile } from '../../lib/useIsMobile'

// Navegador ◀ mes ▶ usado en Facturación y Contabilidad.
// En celular cabe en una sola línea (flechas cortas) y el resumen/acciones
// bajan a su propio renglón en vez de salirse de la pantalla.

interface Props {
  etiqueta: string          // "Noviembre de 2026"
  offset: number            // 0 = mes actual
  onCambiar: (nuevo: number) => void
  resumen?: ReactNode       // "4 facturas en …"
  acciones?: ReactNode      // botones extra (Conciliación)
}

const btn = { padding: '6px 10px', fontSize: 12, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' as const }

export default function NavegadorMes({ etiqueta, offset, onCambiar, resumen, acciones }: Props) {
  const isMobile = useIsMobile()
  const hoy = offset !== 0 ? (
    <button onClick={() => onCambiar(0)} style={{ ...btn, fontSize: 11, background: 'rgba(87,255,154,0.08)', border: '1px solid rgba(87,255,154,0.3)', color: '#10B981' }}>Hoy</button>
  ) : null

  if (isMobile) {
    return (
      <div style={{ marginBottom: 12, padding: '8px 10px', background: '#141414', border: '1px solid #222', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => onCambiar(offset - 1)} aria-label="Mes anterior" style={{ ...btn, padding: '8px 12px', fontSize: 14 }}>‹</button>
          <span style={{ flex: 1, minWidth: 0, textAlign: 'center' as const, fontSize: 14, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{etiqueta}</span>
          {hoy}
          <button onClick={() => onCambiar(offset + 1)} aria-label="Mes siguiente" style={{ ...btn, padding: '8px 12px', fontSize: 14 }}>›</button>
        </div>
        {resumen && <div style={{ fontSize: 11, color: '#777', marginTop: 6, textAlign: 'center' as const }}>{resumen}</div>}
        {acciones && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{acciones}</div>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '10px 14px', background: '#141414', border: '1px solid #222', borderRadius: 10, flexWrap: 'wrap', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => onCambiar(offset - 1)} style={btn}>◀ Mes anterior</button>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', minWidth: 160, textAlign: 'center' as const }}>{etiqueta}</span>
        <button onClick={() => onCambiar(offset + 1)} style={btn}>Mes siguiente ▶</button>
        {hoy}
      </div>
      {(resumen || acciones) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {resumen && <span style={{ fontSize: 11, color: '#888' }}>{resumen}</span>}
          {acciones}
        </div>
      )}
    </div>
  )
}
