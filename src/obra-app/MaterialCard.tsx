// ═══════════════════════════════════════════════════════════════════════════
// MaterialCard — la tarjeta de un producto de la obra en la app de campo.
//
// La usan dos pantallas y por eso vive aparte:
//   · "Materiales" de la ficha de obra → solo consulta (sin selector)
//   · "Pedir material"                 → con selector de cantidad
//
// Al tocarla abre el HISTORIAL: quién recibió qué y cuándo. Ese era el hueco
// real — el instalador que llega el martes no sabe si el equipo ya está en
// obra ni quién lo firmó, porque casi nunca es el mismo que lo recibió.
// ═══════════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import { Minus, Plus, ChevronDown, ChevronRight, PackageCheck } from 'lucide-react'
import type { RenglonMaterial } from '../lib/materialesObra'

const box: React.CSSProperties = {
  background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12, padding: 12,
}
const input: React.CSSProperties = {
  padding: '10px 12px', background: '#0a0a0a', border: '1px solid #262626',
  borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
}
const avisoBase: React.CSSProperties = {
  fontSize: 11, padding: '6px 9px', borderRadius: 8, marginBottom: 9, lineHeight: 1.35,
}

/** Cifra + etiqueta corta: el instalador tiene que leerlo de un vistazo. */
export function Chip({ n, t, c }: { n: number; t: string; c: string }) {
  return (
    <div style={{ padding: '4px 9px', borderRadius: 8, background: '#0a0a0a', border: '1px solid #1f1f1f', textAlign: 'center', minWidth: 62 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: c, lineHeight: 1.1 }}>{n}</div>
      <div style={{ fontSize: 9, color: '#666', marginTop: 1 }}>{t}</div>
    </div>
  )
}

const fechaLarga = (f: string | null) => {
  if (!f) return 'sin fecha'
  try {
    return new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return f }
}

export default function MaterialCard({ r, cantidad, onCantidad }: {
  r: RenglonMaterial
  /** si no viene, la tarjeta es de solo consulta */
  cantidad?: number
  onCantidad?: (n: number) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const conSelector = typeof cantidad === 'number' && !!onCantidad
  const n = cantidad || 0
  const tope = r.porSolicitar > 0 ? r.porSolicitar : r.cotizado
  const falta = Math.max(0, r.cotizado - r.recibido)
  const yaEnObra = r.recibido > 0 ? ` Ya tienes ${r.recibido} en obra.` : ''

  const recepciones = r.eventos.filter(e => e.etapa === 'recibido')
  const solicitudes = r.eventos.filter(e => e.etapa === 'solicitado')
  const compras = r.eventos.filter(e => e.etapa === 'pedido')

  const aviso = falta === 0
    ? { bg: '#0d1a12', bd: '#10B98133', c: '#4ADE80', t: 'Completo en obra, ya está todo aquí.' }
    : r.enBodega > 0
      ? { bg: '#1a1508', bd: '#D9770644', c: '#FBBF24', t: `Hay ${r.enBodega} en bodega apartado para esta obra — solo falta que lo manden.${yaEnObra}` }
      : r.enBodegaGeneral > 0
        ? { bg: '#12131a', bd: '#60A5FA33', c: '#93c5fd', t: `Hay ${r.enBodegaGeneral} en bodega general (de otra obra). Se puede pedir prestado.${yaEnObra}` }
        : r.pedido > r.recibido
          ? { bg: '#141414', bd: '#333', c: '#aaa', t: `Ya está comprado, todavía no llega a bodega.${yaEnObra}` }
          : r.enBorrador > 0
            ? { bg: '#1a0d0d', bd: '#DC262633', c: '#f87171', t: `La orden de compra está en borrador: todavía no se le pide al proveedor.${yaEnObra}` }
            : { bg: '#1a0d0d', bd: '#DC262633', c: '#f87171', t: `No hay en bodega y no está comprado todavía.${yaEnObra}` }

  return (
    <div style={{
      ...box,
      borderColor: n > 0 ? '#10B98155' : '#1a1a1a',
      background: n > 0 ? '#0d1a12' : '#0f0f0f',
    }}>
      {/* Marca · modelo · sistema mandan: es como se identifica el equipo en la caja */}
      <div onClick={() => setAbierto(v => !v)} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
          {abierto ? <ChevronDown size={13} color="#666" /> : <ChevronRight size={13} color="#666" />}
          <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
            {r.modelo || r.marca || r.descripcion.slice(0, 40)}
          </span>
          {r.marca && r.modelo && <span style={{ fontSize: 12, fontWeight: 600, color: '#aaa' }}>{r.marca}</span>}
          {r.sistema && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#4ADE80', background: '#10B98115',
              border: '1px solid #10B98133', padding: '1px 7px', borderRadius: 6,
            }}>{r.sistema}</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#777', marginBottom: 8, lineHeight: 1.35 }}>{r.descripcion}</div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <Chip n={r.cotizado} t="del proyecto" c="#888" />
          <Chip n={r.enBodega} t="en bodega" c={r.enBodega > 0 ? '#FBBF24' : '#555'} />
          <Chip n={r.solicitado} t="solicitado" c={r.solicitado > 0 ? '#A78BFA' : '#555'} />
          <Chip n={falta} t="te falta" c={falta > 0 ? '#FBBF24' : '#4ADE80'} />
        </div>

        <div style={{ ...avisoBase, background: aviso.bg, border: `1px solid ${aviso.bd}`, color: aviso.c }}>
          {aviso.t}
        </div>

        {!abierto && recepciones.length > 0 && (
          <div style={{ fontSize: 10, color: '#60A5FA', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
            <PackageCheck size={11} />
            Recibido por {recepciones[recepciones.length - 1].quien} el {fechaLarga(recepciones[recepciones.length - 1].fecha)} — toca para ver todo
          </div>
        )}
      </div>

      {/* ── HISTORIAL ── */}
      {abierto && (
        <div style={{
          marginBottom: 10, padding: '10px 11px', background: '#0a0a0a',
          border: '1px solid #1a1a1a', borderRadius: 10,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#ccc', marginBottom: 8 }}>Historial de este equipo</div>

          {recepciones.length === 0 && solicitudes.length === 0 && compras.length === 0 && (
            <div style={{ fontSize: 11, color: '#666' }}>Todavía no hay movimientos de este producto.</div>
          )}

          {recepciones.length > 0 && (
            <div style={{ marginBottom: solicitudes.length || compras.length ? 10 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#60A5FA', marginBottom: 5 }}>RECIBIDO EN OBRA</div>
              {recepciones.map((e, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0',
                  borderTop: i ? '1px solid #161616' : 'none',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#60A5FA', minWidth: 42 }}>
                    {e.cantidad} <span style={{ fontSize: 9, color: '#555' }}>{r.unidad}</span>
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: '#ddd', fontWeight: 600 }}>{e.quien}</div>
                    <div style={{ fontSize: 10, color: '#777' }}>
                      {fechaLarga(e.fecha)}{e.ref ? ` · ${e.ref}` : ''}
                    </div>
                    {e.detalle && <div style={{ fontSize: 10, color: '#666' }}>{e.detalle}</div>}
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
                Total en obra: <b style={{ color: '#60A5FA' }}>{r.recibido} {r.unidad}</b> de {r.cotizado} del proyecto.
              </div>
            </div>
          )}

          {solicitudes.length > 0 && (
            <div style={{ marginBottom: compras.length ? 10 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#A78BFA', marginBottom: 5 }}>SOLICITADO DESDE LA OBRA</div>
              {solicitudes.map((e, i) => (
                <div key={i} style={{ fontSize: 11, color: '#999', padding: '3px 0' }}>
                  <b style={{ color: '#ddd' }}>{e.cantidad} {r.unidad}</b> · {e.quien} · {fechaLarga(e.fecha)}
                  {e.ref ? ` · ${e.ref}` : ''}{e.detalle ? ` · ${e.detalle}` : ''}
                </div>
              ))}
            </div>
          )}

          {compras.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#FBBF24', marginBottom: 5 }}>ÓRDENES DE COMPRA</div>
              {compras.map((e, i) => (
                <div key={i} style={{ fontSize: 11, color: '#999', padding: '3px 0' }}>
                  <b style={{ color: '#ddd' }}>{e.cantidad} {r.unidad}</b> · {e.ref || 'sin folio'} · {fechaLarga(e.fecha)}
                  {e.detalle ? ` · ${e.detalle}` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Selector de cantidad (solo en "Pedir material") ── */}
      {conSelector && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => onCantidad!(n - 1)} disabled={n === 0} style={{
            width: 38, height: 38, borderRadius: 10, border: '1px solid #262626',
            background: '#141414', color: n === 0 ? '#333' : '#fff', cursor: n === 0 ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Minus size={16} /></button>
          <input type="number" inputMode="numeric" value={n || ''} placeholder="0"
            onChange={e => onCantidad!(Number(e.target.value))}
            style={{ ...input, width: 74, textAlign: 'center', padding: '9px 4px', fontWeight: 700 }} />
          <button onClick={() => onCantidad!(n + 1)} style={{
            width: 38, height: 38, borderRadius: 10, border: '1px solid #10B98155',
            background: '#10B98118', color: '#4ADE80', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Plus size={16} /></button>
          <span style={{ fontSize: 11, color: '#666' }}>{r.unidad}</span>
          {tope > 0 && (
            <button onClick={() => onCantidad!(tope)} style={{
              marginLeft: 'auto', fontSize: 11, color: '#4ADE80', background: 'transparent',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline',
            }}>Todo ({tope})</button>
          )}
        </div>
      )}
    </div>
  )
}
