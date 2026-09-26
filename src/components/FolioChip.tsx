// ─────────────────────────────────────────────────────────────────────────────
//  FolioChip — el folio OMM, con un click para copiarlo.
//
//  Existe para una cosa muy concreta: el folio se escribe en el concepto de la
//  transferencia. Si hay que teclearlo a mano se teclea mal, y un folio mal
//  escrito no se autoasigna. Por eso el chip copia al portapapeles y avisa.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export default function FolioChip({ folio, prefijo, color = '#06B6D4', size = 11, titulo }: {
  folio?: string | null
  /** 'COT-' mientras la cotizacion no es contrato. */
  prefijo?: string
  color?: string
  size?: number
  titulo?: string
}) {
  const [copiado, setCopiado] = useState(false)
  if (!folio) return null
  const texto = (prefijo || '') + folio

  async function copiar(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(texto)
    } catch {
      // Safari sin permiso de portapapeles: el fallback de toda la vida.
      const ta = document.createElement('textarea')
      ta.value = texto; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* ni modo */ }
      document.body.removeChild(ta)
    }
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1600)
  }

  return (
    <span onClick={copiar} title={titulo || 'Copiar ' + texto + ' para el concepto de la transferencia'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
        fontSize: size, fontWeight: 700, letterSpacing: '0.04em',
        color: copiado ? '#10B981' : color,
        background: (copiado ? '#10B981' : color) + '14',
        border: '1px solid ' + (copiado ? '#10B981' : color) + '44',
        borderRadius: 6, padding: '2px 7px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        whiteSpace: 'nowrap',
      }}>
      {copiado ? <Check size={size - 1} /> : <Copy size={size - 1} style={{ opacity: 0.55 }} />}
      {copiado ? 'copiado' : texto}
    </span>
  )
}
