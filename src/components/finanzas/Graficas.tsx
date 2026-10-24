// Gráficas SVG del tablero de Finanzas — sin librerías (cero dependencias
// nuevas = cero sorpresas en el build de Vercel).
//
// Paleta categórica validada para el fondo #141414 (modo oscuro), en orden
// fijo: azul, naranja, aqua, amarillo, magenta, violeta. Cada concepto tiene
// SIEMPRE el mismo color en todas las gráficas.
import { useEffect, useRef, useState, ReactNode, RefObject } from 'react'

export const COLOR = {
  vendido: '#3987e5',
  nomina: '#d95926',
  cobrado: '#199e70',
  proveedores: '#c98500',
  impuestos: '#d55181',
  gastos: '#9085e9',
  sinClasificar: '#6f6e69',
  bueno: '#0ca30c',
  alerta: '#fab219',
  critico: '#d03b3b',
  positivo: '#3987e5',
  negativo: '#e66767',
}

const TINTA = '#e8e7e3'
const TINTA2 = '#a9a8a1'
const MUTED = '#77766f'
const GRID = '#232322'
const BASE = '#3a3a37'
const SUPERFICIE = '#141414'

export interface Serie {
  nombre: string
  color: string
  valores: number[]
  // Puntos marcados como incompletos (se dibujan huecos/atenuados).
  incompletos?: boolean[]
  punteada?: boolean
}

export interface LineaRef {
  valor: number
  etiqueta: string
  color: string
}

function useAncho(): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => setW(Math.max(280, el.clientWidth))
    medir()
    let ro: ResizeObserver | null = null
    try {
      ro = new ResizeObserver(medir)
      ro.observe(el)
    } catch (e) {
      window.addEventListener('resize', medir)
    }
    return () => {
      if (ro) ro.disconnect()
      window.removeEventListener('resize', medir)
    }
  }, [])
  return [ref, w]
}

function pasoBonito(rango: number, partes: number): number {
  if (rango <= 0) return 1
  const crudo = rango / partes
  const pot = Math.pow(10, Math.floor(Math.log10(crudo)))
  const f = crudo / pot
  const b = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return b * pot
}

function escala(minV: number, maxV: number, partes: number): { min: number; max: number; ticks: number[] } {
  let lo = Math.min(0, minV)
  let hi = Math.max(0, maxV)
  if (hi === lo) hi = lo + 1
  const paso = pasoBonito(hi - lo, partes)
  lo = Math.floor(lo / paso) * paso
  hi = Math.ceil(hi / paso) * paso
  const ticks: number[] = []
  for (let v = lo; v <= hi + paso / 2; v += paso) ticks.push(Math.round(v * 1e6) / 1e6)
  return { min: lo, max: hi, ticks }
}

// Barra con la punta redondeada (4px) y la base pegada al cero.
function barraPath(x: number, y0: number, y1: number, w: number): string {
  const h = Math.abs(y1 - y0)
  if (h < 0.5 || w <= 0) return ''
  const r = Math.min(4, w / 2, h)
  if (y1 < y0) {
    // hacia arriba
    return `M${x},${y0} L${x},${y1 + r} Q${x},${y1} ${x + r},${y1} L${x + w - r},${y1} Q${x + w},${y1} ${x + w},${y1 + r} L${x + w},${y0} Z`
  }
  // hacia abajo
  return `M${x},${y0} L${x},${y1 - r} Q${x},${y1} ${x + r},${y1} L${x + w - r},${y1} Q${x + w},${y1} ${x + w},${y1 - r} L${x + w},${y0} Z`
}

export function Leyenda({ items }: { items: { nombre: string; color: string; forma?: 'barra' | 'linea' | 'punteada' }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginBottom: 10 }}>
      {items.map(it => (
        <span key={it.nombre} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: TINTA2 }}>
          {it.forma === 'linea' || it.forma === 'punteada' ? (
            <svg width="18" height="8"><line x1="1" y1="4" x2="17" y2="4" stroke={it.color} strokeWidth="2" strokeDasharray={it.forma === 'punteada' ? '4 3' : undefined} strokeLinecap="round" /></svg>
          ) : (
            <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color, display: 'inline-block' }} />
          )}
          {it.nombre}
        </span>
      ))}
    </div>
  )
}

interface TooltipFila { nombre: string; color: string; valor: string; nota?: string }

function Tooltip({ x, ancho, titulo, filas }: { x: number; ancho: number; titulo: string; filas: TooltipFila[] }) {
  const w = 220
  const left = Math.max(0, Math.min(ancho - w, x - w / 2))
  return (
    <div style={{
      position: 'absolute', top: 4, left, width: w, pointerEvents: 'none', zIndex: 5,
      background: '#1d1d1c', border: '1px solid #333', borderRadius: 8, padding: '8px 10px',
      boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: TINTA, marginBottom: 6 }}>{titulo}</div>
      {filas.map(f => (
        <div key={f.nombre} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, lineHeight: '18px' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: f.color, flexShrink: 0 }} />
          <span style={{ color: TINTA2, flex: 1 }}>{f.nombre}{f.nota ? <span style={{ color: MUTED }}> · {f.nota}</span> : null}</span>
          <span style={{ color: TINTA, fontVariantNumeric: 'tabular-nums' }}>{f.valor}</span>
        </div>
      ))}
    </div>
  )
}

// ── Barras agrupadas + líneas, un solo eje ───────────────────────────────
export function GraficaMensual({ etiquetas, barras, lineas, formato, alto, refs, tenues, extraTooltip }: {
  etiquetas: string[]
  barras: Serie[]
  lineas: Serie[]
  formato: (v: number) => string
  alto?: number
  refs?: LineaRef[]
  tenues?: boolean[]          // meses en curso: barras atenuadas
  extraTooltip?: (i: number) => TooltipFila[]
}) {
  const [ref, ancho] = useAncho()
  const [hover, setHover] = useState<number | null>(null)
  const H = alto || 260
  const m = { t: 12, r: 12, b: 26, l: 58 }
  const iw = ancho - m.l - m.r
  const ih = H - m.t - m.b
  const nM = etiquetas.length
  const todos: number[] = []
  barras.forEach(s => s.valores.forEach(v => todos.push(v)))
  lineas.forEach(s => s.valores.forEach(v => todos.push(v)))
  ;(refs || []).forEach(r => todos.push(r.valor))
  const sc = escala(Math.min(0, ...todos), Math.max(0, ...todos), 4)
  const y = (v: number) => m.t + ih - ((v - sc.min) / (sc.max - sc.min)) * ih
  const banda = nM > 0 ? iw / nM : iw
  const cx = (i: number) => m.l + banda * i + banda / 2
  const grupo = Math.min(banda * 0.72, 56)
  const nb = Math.max(1, barras.length)
  const bw = Math.max(2, (grupo - (nb - 1) * 2) / nb)
  const cada = Math.ceil(nM / Math.max(1, Math.floor(iw / 52)))

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }} onMouseLeave={() => setHover(null)}>
      <svg width={ancho} height={H} style={{ display: 'block' }} role="img">
        {sc.ticks.map(t => (
          <g key={t}>
            <line x1={m.l} x2={ancho - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? BASE : GRID} strokeWidth={1} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill={MUTED} style={{ fontVariantNumeric: 'tabular-nums' }}>{formato(t)}</text>
          </g>
        ))}
        {hover !== null && <rect x={m.l + banda * hover} y={m.t} width={banda} height={ih} fill="#ffffff" opacity={0.04} />}
        {barras.map((s, si) => s.valores.map((v, i) => {
          const x = cx(i) - grupo / 2 + si * (bw + 2)
          const d = barraPath(x, y(0), y(v), bw)
          if (!d) return null
          const tenue = (tenues && tenues[i]) || (s.incompletos && s.incompletos[i])
          return <path key={s.nombre + i} d={d} fill={s.color} opacity={tenue ? 0.45 : 1} />
        }))}
        {(refs || []).map(r => (
          <g key={r.etiqueta}>
            <line x1={m.l} x2={ancho - m.r} y1={y(r.valor)} y2={y(r.valor)} stroke={r.color} strokeWidth={1.5} strokeDasharray="5 4" />
          </g>
        ))}
        {lineas.map(s => {
          let d = ''
          s.valores.forEach((v, i) => { d += (i === 0 ? 'M' : 'L') + cx(i) + ',' + y(v) + ' ' })
          return (
            <g key={s.nombre}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.punteada ? '6 4' : undefined} />
              {!s.punteada && s.valores.map((v, i) => {
                const hueco = s.incompletos && s.incompletos[i]
                return <circle key={i} cx={cx(i)} cy={y(v)} r={hover === i ? 5 : 4} fill={hueco ? SUPERFICIE : s.color} stroke={hueco ? s.color : SUPERFICIE} strokeWidth={2} />
              })}
            </g>
          )
        })}
        {etiquetas.map((e, i) => ((nM - 1 - i) % cada === 0) ? (
          <text key={e + i} x={cx(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={hover === i ? TINTA : MUTED}>{e}</text>
        ) : null)}
        {etiquetas.map((e, i) => (
          <rect key={'h' + i} x={m.l + banda * i} y={m.t} width={banda} height={ih + m.b} fill="transparent"
            onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <Tooltip x={cx(hover)} ancho={ancho} titulo={etiquetas[hover] + (tenues && tenues[hover] ? ' (en curso)' : '')}
          filas={[
            ...barras.map(s => ({ nombre: s.nombre, color: s.color, valor: formato(s.valores[hover]), nota: s.incompletos && s.incompletos[hover] ? 'incompleto' : undefined })),
            ...lineas.map(s => ({ nombre: s.nombre, color: s.color, valor: formato(s.valores[hover]), nota: s.incompletos && s.incompletos[hover] ? 'incompleto' : undefined })),
            ...(extraTooltip ? extraTooltip(hover) : []),
          ]} />
      )}
    </div>
  )
}

// ── Entradas arriba, salidas apiladas abajo, flujo neto como línea ───────
export function GraficaFlujo({ etiquetas, entradas, salidas, neto, formato, alto, tenues }: {
  etiquetas: string[]
  entradas: Serie
  salidas: Serie[]
  neto: Serie
  formato: (v: number) => string
  alto?: number
  tenues?: boolean[]
}) {
  const [ref, ancho] = useAncho()
  const [hover, setHover] = useState<number | null>(null)
  const H = alto || 300
  const m = { t: 12, r: 12, b: 26, l: 58 }
  const iw = ancho - m.l - m.r
  const ih = H - m.t - m.b
  const nM = etiquetas.length
  const totSal = etiquetas.map((_, i) => salidas.reduce((s, x) => s + Math.max(0, x.valores[i]), 0))
  const maxV = Math.max(0, ...entradas.valores, ...neto.valores)
  const minV = Math.min(0, ...totSal.map(v => -v), ...neto.valores)
  const sc = escala(minV, maxV, 5)
  const y = (v: number) => m.t + ih - ((v - sc.min) / (sc.max - sc.min)) * ih
  const banda = nM > 0 ? iw / nM : iw
  const cx = (i: number) => m.l + banda * i + banda / 2
  const bw = Math.min(banda * 0.56, 34)
  const cada = Math.ceil(nM / Math.max(1, Math.floor(iw / 52)))

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }} onMouseLeave={() => setHover(null)}>
      <svg width={ancho} height={H} style={{ display: 'block' }} role="img">
        {sc.ticks.map(t => (
          <g key={t}>
            <line x1={m.l} x2={ancho - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? BASE : GRID} strokeWidth={1} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill={MUTED}>{formato(t)}</text>
          </g>
        ))}
        {hover !== null && <rect x={m.l + banda * hover} y={m.t} width={banda} height={ih} fill="#ffffff" opacity={0.04} />}
        {etiquetas.map((_, i) => {
          const x = cx(i) - bw / 2
          const op = tenues && tenues[i] ? 0.45 : 1
          const piezas: ReactNode[] = []
          const dIn = barraPath(x, y(0), y(Math.max(0, entradas.valores[i])), bw)
          if (dIn) piezas.push(<path key="in" d={dIn} fill={entradas.color} opacity={op} />)
          // Salidas apiladas hacia abajo, con 2px de separación entre tramos.
          let acc = 0
          const visibles = salidas.filter(s => s.valores[i] > 0)
          visibles.forEach((s, k) => {
            const v = s.valores[i]
            const y0 = y(-acc) + (acc > 0 ? 1 : 0)
            const y1 = y(-(acc + v)) - (k < visibles.length - 1 ? 1 : 0)
            acc += v
            if (y1 - y0 < 0.5) return
            const d = k === visibles.length - 1 ? barraPath(x, y0, y1, bw) : `M${x},${y0} L${x + bw},${y0} L${x + bw},${y1} L${x},${y1} Z`
            piezas.push(<path key={s.nombre} d={d} fill={s.color} opacity={op} />)
          })
          return <g key={i}>{piezas}</g>
        })}
        {(() => {
          let d = ''
          neto.valores.forEach((v, i) => { d += (i === 0 ? 'M' : 'L') + cx(i) + ',' + y(v) + ' ' })
          return (
            <g>
              <path d={d} fill="none" stroke={neto.color} strokeWidth={2} strokeLinejoin="round" />
              {neto.valores.map((v, i) => (
                <circle key={i} cx={cx(i)} cy={y(v)} r={hover === i ? 5 : 4} fill={neto.color} stroke={SUPERFICIE} strokeWidth={2} />
              ))}
            </g>
          )
        })()}
        {etiquetas.map((e, i) => ((nM - 1 - i) % cada === 0) ? (
          <text key={e + i} x={cx(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={hover === i ? TINTA : MUTED}>{e}</text>
        ) : null)}
        {etiquetas.map((e, i) => (
          <rect key={'h' + i} x={m.l + banda * i} y={m.t} width={banda} height={ih + m.b} fill="transparent"
            onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <Tooltip x={cx(hover)} ancho={ancho} titulo={etiquetas[hover] + (tenues && tenues[hover] ? ' (en curso)' : '')}
          filas={[
            { nombre: entradas.nombre, color: entradas.color, valor: formato(entradas.valores[hover]) },
            ...salidas.map(s => ({ nombre: s.nombre, color: s.color, valor: '−' + formato(s.valores[hover]) })),
            { nombre: neto.nombre, color: neto.color, valor: formato(neto.valores[hover]) },
          ]} />
      )}
    </div>
  )
}

// ── Barras horizontales (admite negativos: diverge desde el cero) ────────
export function BarrasH({ filas, formato, colorPositivo, colorNegativo }: {
  filas: { etiqueta: string; valor: number; nota?: string; color?: string }[]
  formato: (v: number) => string
  colorPositivo?: string
  colorNegativo?: string
}) {
  const [ref, ancho] = useAncho()
  const [hover, setHover] = useState<number | null>(null)
  const filaH = 30
  const etW = Math.min(210, ancho * 0.38)
  const valW = 78
  const m = { t: 4, b: 4 }
  const H = m.t + m.b + filas.length * filaH
  const vals = filas.map(f => f.valor)
  const lo = Math.min(0, ...vals)
  const hi = Math.max(0, ...vals)
  const x0 = etW + 8
  const x1 = ancho - valW
  const span = (hi - lo) || 1
  const x = (v: number) => x0 + ((v - lo) / span) * (x1 - x0)
  const pos = colorPositivo || COLOR.positivo
  const neg = colorNegativo || COLOR.negativo
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={ancho} height={H} style={{ display: 'block' }} role="img">
        {lo < 0 && <line x1={x(0)} x2={x(0)} y1={m.t} y2={H - m.b} stroke={BASE} />}
        {filas.map((f, i) => {
          const yy = m.t + i * filaH
          const a = x(Math.min(0, f.valor))
          const b = x(Math.max(0, f.valor))
          const w = Math.max(0, b - a)
          const r = Math.min(4, w / 2)
          const c = f.color || (f.valor >= 0 ? pos : neg)
          // punta redondeada del lado del valor
          const d = w < 0.5 ? '' : f.valor >= 0
            ? `M${a},${yy + 7} L${b - r},${yy + 7} Q${b},${yy + 7} ${b},${yy + 7 + r} L${b},${yy + 23 - r} Q${b},${yy + 23} ${b - r},${yy + 23} L${a},${yy + 23} Z`
            : `M${b},${yy + 7} L${a + r},${yy + 7} Q${a},${yy + 7} ${a},${yy + 7 + r} L${a},${yy + 23 - r} Q${a},${yy + 23} ${a + r},${yy + 23} L${b},${yy + 23} Z`
          return (
            <g key={f.etiqueta} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={yy} width={ancho} height={filaH} fill={hover === i ? '#ffffff' : 'transparent'} opacity={0.04} />
              <text x={etW} y={yy + 19} textAnchor="end" fontSize="11" fill={TINTA2}>{f.etiqueta.length > 34 ? f.etiqueta.slice(0, 33) + '…' : f.etiqueta}</text>
              {d && <path d={d} fill={c} />}
              <text x={ancho - 2} y={yy + 19} textAnchor="end" fontSize="11" fill={TINTA} style={{ fontVariantNumeric: 'tabular-nums' }}>{formato(f.valor)}</text>
            </g>
          )
        })}
      </svg>
      {hover !== null && filas[hover].nota && (
        <div style={{ position: 'absolute', top: m.t + hover * filaH + filaH, left: x0, background: '#1d1d1c', border: '1px solid #333', borderRadius: 6, padding: '4px 8px', fontSize: 11, color: TINTA2, pointerEvents: 'none', zIndex: 5 }}>
          {filas[hover].nota}
        </div>
      )}
    </div>
  )
}
