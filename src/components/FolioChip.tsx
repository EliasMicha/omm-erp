// ─────────────────────────────────────────────────────────────────────────────
//  FolioChip — el folio OMM, con un click para copiarlo.
//
//  Existe para una cosa muy concreta: el folio se escribe en el concepto de la
//  transferencia. Si hay que teclearlo a mano se teclea mal, y un folio mal
//  escrito no se autoasigna. Por eso el chip copia al portapapeles y avisa.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export default function FolioChip({ folio, prefijo, color, size = 11, titulo }: {
  folio?: string | null
  /** 'COT-' mientras la cotizacion no es contrato. */
  prefijo?: string
  /** Solo para casos donde el folio SI es el protagonista. Por defecto va en
   *  gris: es un dato de referencia, no una alerta. */
  color?: string
  size?: number
  titulo?: string
}) {
  const [copiado, setCopiado] = useState(false)
  const [hover, setHover] = useState(false)
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

  const tono = copiado ? '#10B981' : color || (hover ? '#ccc' : '#8a8a8a')

  return (
    <span onClick={copiar}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title={titulo || 'Copiar ' + texto}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
        fontSize: size, fontWeight: 600, letterSpacing: '0.04em', color: tono,
        background: 'transparent',
        border: '1px solid ' + (copiado ? '#10B98155' : hover ? '#3a3a3a' : '#282828'),
        borderRadius: 5, padding: '2px 6px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        whiteSpace: 'nowrap', transition: 'color 0.12s, border-color 0.12s',
      }}>
      {copiado ? <Check size={size - 1} /> : <Copy size={size - 1} style={{ opacity: hover ? 0.6 : 0.3 }} />}
      {copiado ? 'copiado' : texto}
    </span>
  )
}
