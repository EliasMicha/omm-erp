// Piezas de UI compartidas por las pestañas de Finanzas.
import { ReactNode, CSSProperties } from 'react'

export const ESTADO_COLOR: Record<string, string> = {
  bueno: '#0ca30c',
  alerta: '#fab219',
  critico: '#d03b3b',
  neutro: '#77766f',
}

export function Tarjeta({ titulo, subtitulo, children, accion }: {
  titulo: string; subtitulo?: string; children: ReactNode; accion?: ReactNode
}) {
  return (
    <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '16px 18px', marginBottom: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e7e3' }}>{titulo}</div>
          {subtitulo && <div style={{ fontSize: 11, color: '#77766f', marginTop: 2, maxWidth: 760 }}>{subtitulo}</div>}
        </div>
        {accion}
      </div>
      {children}
    </div>
  )
}

// Indicador con número principal, una línea de contexto y, si aplica, un
// estado (bueno/alerta/crítico) que siempre va con texto, nunca solo color.
export function Indicador({ etiqueta, valor, detalle, estado, estadoTexto, delta }: {
  etiqueta: string
  valor: string
  detalle?: ReactNode
  estado?: 'bueno' | 'alerta' | 'critico' | 'neutro'
  estadoTexto?: string
  delta?: { texto: string; bueno: boolean } | null
}) {
  const c = estado ? ESTADO_COLOR[estado] : null
  return (
    <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '14px 16px', minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: '#77766f', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{etiqueta}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.15 }}>{valor}</div>
      {delta && (
        <div style={{ fontSize: 11, marginTop: 3, color: delta.bueno ? '#3fbf3f' : '#e66767' }}>{delta.texto}</div>
      )}
      {detalle && <div style={{ fontSize: 11, color: '#a9a8a1', marginTop: 4, lineHeight: 1.45 }}>{detalle}</div>}
      {c && estadoTexto && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, fontWeight: 600, color: '#e8e7e3', background: c + '22', border: '1px solid ' + c + '55', borderRadius: 20, padding: '2px 9px' }}>
          <span style={{ width: 7, height: 7, borderRadius: 7, background: c }} />
          {estadoTexto}
        </div>
      )}
    </div>
  )
}

export function Rejilla({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${cols <= 2 ? 300 : cols === 3 ? 240 : 190}px, 1fr))`, gap: 12, marginBottom: 16 }}>
      {children}
    </div>
  )
}

export function Nota({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, color: '#77766f', lineHeight: 1.5, marginTop: 8 }}>{children}</div>
}

export function Pildora({ texto, color }: { texto: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: '#e8e7e3', background: color + '22', border: '1px solid ' + color + '55', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: 6, background: color }} />
      {texto}
    </span>
  )
}

export const thS: CSSProperties = {
  padding: '8px 10px', background: '#1a1a1a', fontSize: 10, fontWeight: 600, color: '#77766f',
  textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #222', whiteSpace: 'nowrap', textAlign: 'right',
}
export const tdS: CSSProperties = {
  padding: '8px 10px', fontSize: 12, color: '#d6d5d0', borderBottom: '1px solid #1c1c1c', textAlign: 'right',
  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
}
