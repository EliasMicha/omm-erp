import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllActiveCatalog } from '../lib/catalog'
import { F, STAGE_CONFIG } from '../lib/utils'
import { Btn, Loading } from '../components/layout/UI'
import { Plus, ChevronDown, ChevronRight, X, Trash2, Image as ImageIcon, Search, ArrowLeftRight, Sparkles, Upload, Loader2, FileText, RefreshCw, BookOpen, Pencil, Package, Save, Ungroup } from 'lucide-react'
import BotonCatalogo from '../components/BotonCatalogo'
import VersionManager, { VersionSnapshot } from '../components/VersionManager'
import EditCotInfoModal from '../components/EditCotInfoModal'
import { useIsMobile } from '../lib/useIsMobile'
import { tcForYear } from '../lib/fx'
import { normalizarMoneda, monedaDeCosto, convertir, convertirSiSePuede, simbolo, type Moneda } from '../lib/moneda'
import {
  BundleCat, agruparPorBundle, totalesDeBundle, cargarBundles,
  insertarBundle, cambiarQtyBundle, desagruparBundle, guardarComoBundle,
} from '../lib/bundlesIlum'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════
interface IlumProduct {
  id: string; subsectionId: string; catalogId: string | null
  name: string; description: string; imageUrl: string | null
  quantity: number; cost: number; markup: number; price: number; order: number
  /** Moneda del COSTO. La dicta el catálogo y no cambia con la cotización. */
  monedaCosto: Moneda
  marca?: string | null; modelo?: string | null; sku?: string | null
  watts?: number | null; lumens?: number | null; cct?: string | null
  nomenclatura?: string | null
  /** Si viene de un bundle: la instancia a la que pertenece y su multiplicador. */
  bundleId?: string | null; bundleInstanceId?: string | null; bundleName?: string | null
  bundleQty?: number | null; bundleUnitQty?: number | null
}

interface IlumSubsection {
  id: string; name: string; collapsed: boolean; order: number
}

interface IlumQuote {
  id: string; name: string; stage: string; notes: any
  client_name?: string | null; project_id?: string | null
}

interface CatProduct {
  id: string; name: string; description: string; cost: number; markup: number; precio_venta: number
  provider: string; unit: string; marca?: string | null; modelo?: string | null; sku?: string | null
  image_url?: string | null; watts?: number | null; lumens?: number | null; cct?: string | null
}

const SUBSECTION_PRESETS = ['Luminarias', 'Fuentes de Poder', 'Perfiles', 'Drivers', 'Accesorios', 'Control']

function uid(): string { return Math.random().toString(36).slice(2, 10) }
function fmt(n: number): string { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

/**
 * Totales de un renglón.
 *
 * OJO con las monedas: `p.price` está en la moneda de VENTA de la cotización y
 * `p.cost` en la del PROVEEDOR, que no tienen por qué ser la misma. Para que
 * `costReal` y `utilidad` signifiquen algo hay que pasar el costo a moneda de
 * venta primero — si no, se resta un costo en pesos de una venta en dólares y
 * el margen sale en −384%, que es exactamente lo que estaba pasando en el
 * bloque de análisis interno.
 *
 * `monedaCot` y `tc` son opcionales para no romper a quien solo quiere `total`
 * (que nunca depende de la moneda del costo).
 */
function calcLine(p: IlumProduct, monedaCot?: Moneda, tc?: number) {
  const nativo = p.cost > 0 ? p.cost : p.price * (1 - p.markup / 100)
  const mCosto = normalizarMoneda(p.monedaCosto)
  let costReal = nativo
  if (monedaCot && mCosto !== monedaCot) {
    const conv = convertirSiSePuede(nativo, mCosto, monedaCot, Number(tc) || 0)
    if (conv !== null) costReal = conv
  }
  const total = p.price * p.quantity
  const utilidad = p.price - costReal
  return { costReal, total, utilidad, costNativo: nativo, monedaCosto: mCosto }
}

const S = {
  input: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 12, fontFamily: 'inherit', padding: '5px 8px', textAlign: 'right' as const, width: 70 },
  th: { padding: '6px 8px', fontSize: 9, fontWeight: 600, color: '#444', textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '1px solid #222', whiteSpace: 'nowrap' as const },
  td: { padding: '6px 8px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a' },
  tdR: { padding: '6px 8px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a', textAlign: 'right' as const },
  tdM: { padding: '6px 8px', fontSize: 12, fontWeight: 600, color: '#fff', borderBottom: '1px solid #1a1a1a', textAlign: 'right' as const },
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCT ROW
// ═══════════════════════════════════════════════════════════════════
function ProductRow({ p, onUpdate, onRemove, selected, onToggleSelect, onSubstitute, monedaCot }: {
  p: IlumProduct; onUpdate: (id: string, f: string, v: number | string) => void; onRemove: (id: string) => void
  selected?: boolean; onToggleSelect?: (id: string) => void; onSubstitute?: (p: IlumProduct) => void
  /** Moneda de venta de la cotización, para marcar los costos que vienen en otra. */
  monedaCot?: Moneda
}) {
  // El COSTO es del proveedor y va en SU moneda; el PRECIO va en la de la
  // cotización. Cuando no coinciden hay que decirlo en el renglón: si no, la
  // fila enseña 782.45 junto a 1203.77 y parece que son la misma moneda.
  const monCosto = normalizarMoneda(p.monedaCosto)
  const cruzado = !!monedaCot && monCosto !== monedaCot
  // Solo el total: costReal y utilidad se sacaban aquí y no se usaban, y sin
  // la moneda de venta habrían salido mal de todas formas.
  const { total } = calcLine(p)
  return (
    <tr style={{ background: selected ? '#10B9810D' : undefined }}>
      {onToggleSelect && (
        <td style={{ ...S.td, width: 28, textAlign: 'center', padding: '6px 4px' }}>
          <input type="checkbox" checked={!!selected} onChange={() => onToggleSelect(p.id)} style={{ accentColor: '#10B981', cursor: 'pointer' }} />
        </td>
      )}
      <td style={{ ...S.td, width: 44, textAlign: 'center' }}>
        {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 4 }} />
          : <div style={{ width: 36, height: 36, background: '#1a1a1a', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}><ImageIcon size={12} color="#333" /></div>}
      </td>
      <td style={{ ...S.td, width: 90 }}>
        <input
          key={`nom-${p.id}-${p.nomenclatura || ''}`}
          type="text"
          defaultValue={p.nomenclatura || ''}
          placeholder="—"
          onBlur={e => onUpdate(p.id, 'nomenclatura', e.target.value.trim())}
          style={{ ...S.input, width: 80, fontWeight: 600, color: '#10B981', textAlign: 'center' }}
        />
      </td>
      <td style={{ ...S.td, minWidth: 180 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#ddd' }}>{p.name}</div>
        {p.description && <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>{p.description}</div>}
      </td>
      <td style={{ ...S.td, fontSize: 11, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.marca || ''}>{p.marca || '—'}</td>
      <td style={{ ...S.td, fontSize: 11, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.modelo || ''}>{p.modelo || '—'}</td>
      <td style={{ ...S.tdR, fontSize: 11, color: '#666' }}>{p.watts ? p.watts + 'W' : '—'}</td>
      <td style={S.td}>
        <input key={`qty-${p.id}-${p.quantity}`} type="number" defaultValue={p.quantity} min={1} onBlur={e => onUpdate(p.id, 'quantity', parseInt(e.target.value) || 1)} style={{ ...S.input, width: '100%', boxSizing: 'border-box' }} />
      </td>
      <td style={S.tdR}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input key={`cost-${p.id}-${p.cost}`} type="number" defaultValue={p.cost} step={0.01} onBlur={e => onUpdate(p.id, 'cost', parseFloat(e.target.value) || 0)}
            style={{ ...S.input, width: '100%', boxSizing: 'border-box', color: cruzado ? '#FBBF24' : undefined }} />
          {cruzado && (
            <span title={`Este producto está costeado en ${monCosto}. El precio de venta ya está convertido a ${monedaCot}.`}
              style={{ fontSize: 8.5, fontWeight: 700, color: '#FBBF24', border: '1px solid #FBBF2455', borderRadius: 4, padding: '1px 3px', flexShrink: 0 }}>
              {monCosto}
            </span>
          )}
        </div>
      </td>
      <td style={S.tdR}><input key={`markup-${p.id}-${p.markup}`} type="number" defaultValue={p.markup} step={1} onBlur={e => onUpdate(p.id, 'markup', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: '100%', boxSizing: 'border-box', color: p.markup >= 25 ? '#10B981' : p.markup >= 15 ? '#D97706' : '#DC2626' }} /></td>
      <td style={S.tdR}><input key={`price-${p.id}-${p.price}`} type="number" defaultValue={p.price} step={0.01} onBlur={e => onUpdate(p.id, 'price', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: '100%', boxSizing: 'border-box' }} /></td>
      <td style={{ ...S.tdM, color: '#10B981' }}>${fmt(total)}</td>
      <td style={{ ...S.td, width: 28 }}>{onSubstitute && p.catalogId && <button onClick={() => onSubstitute(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: 0.5 }} title="Sustituir en todo el proyecto"><ArrowLeftRight size={12} color="#2563EB" /></button>}</td>
      <td style={{ ...S.td, width: 28 }}><button onClick={() => onRemove(p.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Trash2 size={12} /></button></td>
    </tr>
  )
}

// ═══════════════════════════════════════════════════════════════════
// BUNDLE — un renglón que agrupa varios productos
// ═══════════════════════════════════════════════════════════════════
/**
 * Cabecera de un bundle dentro de la tabla. Los hijos existen como renglones
 * de verdad en la base; aquí solo se pintan colapsados. Cambiar la cantidad
 * recalcula los hijos desde su cantidad por unidad.
 */
function BundleRow({ nombre, qty, hijos, abierto, onAbrir, onQty, onDesagrupar, onUpdate, onRemove, monedaCot, tcCot, cols }: {
  nombre: string; qty: number; hijos: IlumProduct[]; abierto: boolean
  onAbrir: () => void; onQty: (n: number) => void; onDesagrupar: () => void
  onUpdate: (id: string, f: string, v: number | string) => void; onRemove: (id: string) => void
  monedaCot?: Moneda; tcCot?: number; cols: number
}) {
  const costoEn = (h: IlumProduct) => calcLine(h, monedaCot, tcCot).costReal
  const t = totalesDeBundle(hijos as any, qty, costoEn as any)
  const piezas = hijos.reduce((s, h) => s + Number(h.quantity || 0), 0)
  return (
    <>
      <tr style={{ background: '#7C3AED10' }}>
        <td colSpan={cols - 7} style={{ ...S.td, borderBottom: '1px solid #2a2a2a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={onAbrir} title={abierto ? 'Colapsar' : 'Ver productos'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
              {abierto ? <ChevronDown size={13} color="#A78BFA" /> : <ChevronRight size={13} color="#A78BFA" />}
            </button>
            <Package size={13} color="#A78BFA" />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#A78BFA' }}>{nombre}</span>
            <span style={{ fontSize: 10, color: '#666' }}>
              {hijos.length} producto(s) · {piezas} pza en total
            </span>
          </div>
        </td>
        <td style={S.td}>
          <input key={`bq-${hijos[0]?.id}-${qty}`} type="number" min={1} defaultValue={qty}
            title="Cuántas veces se repite este bundle"
            onBlur={e => { const n = parseInt(e.target.value) || 1; if (n !== qty) onQty(n) }}
            style={{ ...S.input, width: '100%', boxSizing: 'border-box', color: '#A78BFA', fontWeight: 700 }} />
        </td>
        <td style={{ ...S.tdR, fontSize: 11, color: '#666' }}>${fmt(t.costoUnit)}</td>
        <td style={{ ...S.tdR, fontSize: 11, color: t.margen >= 25 ? '#10B981' : t.margen >= 15 ? '#D97706' : '#DC2626' }}>
          {t.margen.toFixed(0)}%
        </td>
        <td style={{ ...S.tdR, fontSize: 11, color: '#888' }}>${fmt(t.precioUnit)}</td>
        <td style={{ ...S.tdM, color: '#A78BFA' }}>${fmt(t.total)}</td>
        <td style={S.td}></td>
        <td style={{ ...S.td, width: 28 }}>
          <button onClick={onDesagrupar} title="Desagrupar: deja los productos sueltos, no los borra"
            style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}>
            <Ungroup size={12} />
          </button>
        </td>
      </tr>
      {abierto && hijos.map(h => (
        <ProductRow key={h.id} p={h} onUpdate={onUpdate} onRemove={onRemove} monedaCot={monedaCot} />
      ))}
    </>
  )
}

/** Picker de bundles: elegir cuál y cuántas veces. */
function BundlePicker({ onClose, onInsert, subsectionName }: {
  onClose: () => void
  onInsert: (b: BundleCat, qty: number) => Promise<void> | void
  subsectionName: string
}) {
  const [bundles, setBundles] = useState<BundleCat[]>([])
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState('')
  const [busca, setBusca] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [metiendo, setMetiendo] = useState<string | null>(null)

  useEffect(() => {
    cargarBundles('ilum')
      .then(bs => setBundles(bs))
      .catch(e => setErr(e?.message || String(e)))
      .finally(() => setCargando(false))
  }, [])

  const q = busca.trim().toLowerCase()
  const lista = !q ? bundles : bundles.filter(b =>
    b.name.toLowerCase().includes(q) || (b.description || '').toLowerCase().includes(q))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12, width: 700, maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' as const }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Package size={15} color="#A78BFA" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Insertar bundle</div>
            <div style={{ fontSize: 10.5, color: '#666' }}>a la sección {subsectionName}</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        <div style={{ padding: '10px 16px', borderBottom: '1px solid #1a1a1a' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} color="#555" style={{ position: 'absolute', left: 9, top: 8 }} />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar bundle…"
              style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 6, color: '#ddd', fontSize: 12, fontFamily: 'inherit', padding: '6px 8px 6px 28px', width: '100%', boxSizing: 'border-box' as const, outline: 'none' }} />
          </div>
        </div>

        <div style={{ overflowY: 'auto' as const, flex: 1, padding: '8px 16px 16px' }}>
          {cargando && <div style={{ padding: 20 }}><Loading /></div>}
          {err && <div style={{ color: '#DC2626', fontSize: 12, padding: 12 }}>{err}</div>}
          {!cargando && !err && lista.length === 0 && (
            <div style={{ color: '#666', fontSize: 12, padding: '20px 4px', lineHeight: 1.7 }}>
              No hay bundles de iluminación todavía.<br />
              Arma una sección en la cotización y usa <b style={{ color: '#A78BFA' }}>Guardar como bundle</b>,
              o créalos desde Catálogo.
            </div>
          )}
          {lista.map(b => {
            const n = qty[b.id] || 1
            const abierta = abierto === b.id
            return (
              <div key={b.id} style={{ border: '1px solid #222', borderRadius: 8, marginBottom: 8, background: '#0e0e0e' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px' }}>
                  <button onClick={() => setAbierto(abierta ? null : b.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                    {abierta ? <ChevronDown size={13} color="#555" /> : <ChevronRight size={13} color="#555" />}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#ddd' }}>{b.name}</div>
                    <div style={{ fontSize: 10, color: '#555' }}>
                      {b.items.length} producto(s){b.description ? ' · ' + b.description : ''}
                    </div>
                  </div>
                  <input type="number" min={1} value={n}
                    onChange={e => setQty(p => ({ ...p, [b.id]: Math.max(1, parseInt(e.target.value) || 1) }))}
                    title="¿Cuántas veces?"
                    style={{ ...S.input, width: 62, color: '#A78BFA', fontWeight: 700 }} />
                  <Btn size="sm" variant="primary" disabled={metiendo === b.id}
                    onClick={async () => { setMetiendo(b.id); try { await onInsert(b, n) } finally { setMetiendo(null) } }}>
                    {metiendo === b.id ? <Loader2 size={12} /> : <Plus size={12} />} Insertar
                  </Btn>
                </div>
                {abierta && (
                  <div style={{ borderTop: '1px solid #1a1a1a', padding: '6px 12px 10px 34px' }}>
                    {b.items.map(i => (
                      <div key={i.id} style={{ display: 'flex', gap: 8, fontSize: 11, color: '#888', padding: '2px 0' }}>
                        <span style={{ color: '#A78BFA', minWidth: 26, textAlign: 'right' as const }}>{i.quantity}×</span>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{i.product?.name || '—'}</span>
                        <span style={{ color: '#555' }}>{i.product?.marca || ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CATALOG MODAL FOR ILUM PRODUCTS
// ═══════════════════════════════════════════════════════════════════
function IlumCatalogModal({ onClose, onSelect, subsectionName }: {
  onClose: () => void; onSelect: (p: CatProduct) => void; subsectionName: string
}) {
  const isMobile = useIsMobile()
  const [catalog, setCatalog] = useState<CatProduct[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchAllActiveCatalog({ specialty: 'ilum' })
      .then((data: any) => { setCatalog(data || []); setLoading(false) })
  }, [])

  const filtered = search.length >= 2
    ? catalog.filter(p => { const s = search.toLowerCase(); return p.name.toLowerCase().includes(s) || (p.description || '').toLowerCase().includes(s) || (p.modelo || '').toLowerCase().includes(s) || (p.marca || '').toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s) || (p.provider || '').toLowerCase().includes(s) })
    : catalog

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: isMobile ? 0 : 16, padding: isMobile ? 12 : 20, width: isMobile ? '100vw' : 700, height: isMobile ? '100vh' : 'auto', maxHeight: isMobile ? '100vh' : '80vh', display: 'flex', flexDirection: 'column' as const, margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Agregar producto — {subsectionName}</div>
            <div style={{ fontSize: 11, color: '#555' }}>Busca en el catálogo de iluminación</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#444' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto..."
              style={{ width: '100%', padding: '8px 10px 8px 30px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit' }} autoFocus />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: isMobile ? 'auto' : 'visible' }}>
          {loading ? <Loading /> : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 20px', color: '#444', fontSize: 13 }}>
              {search ? 'Sin resultados' : 'Catálogo vacío'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#1a1a1a' }}>
                <th style={{ ...S.th, textAlign: 'left' }}>Producto</th>
                <th style={S.th}>Marca</th>
                <th style={S.th}>Modelo</th>
                <th style={S.th}>W</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Costo</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Precio</th>
                <th style={S.th}></th>
              </tr></thead>
              <tbody>
                {filtered.slice(0, 50).map(p => {
                  const precio = p.precio_venta > 0 ? p.precio_venta : Math.round(p.cost / (1 - p.markup / 100) * 100) / 100
                  return (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(p)}
                      onMouseEnter={e => { e.currentTarget.style.background = '#1a1a1a' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      <td style={{ ...S.td }}><div style={{ fontWeight: 500, color: '#ddd' }}>{p.name}</div>{p.description && <div style={{ fontSize: 10, color: '#555' }}>{p.description}</div>}</td>
                      <td style={{ ...S.td, fontSize: 10, color: '#666' }}>{p.marca || '—'}</td>
                      <td style={{ ...S.td, fontSize: 10, color: '#666' }}>{p.modelo || '—'}</td>
                      <td style={{ ...S.tdR, fontSize: 10, color: '#666' }}>{p.watts ? p.watts + 'W' : '—'}</td>
                      <td style={{ ...S.tdR, fontSize: 10, color: '#555' }}>${fmt(p.cost)}</td>
                      <td style={{ ...S.tdR, fontWeight: 600, color: '#10B981' }}>${fmt(precio)}</td>
                      <td style={S.td}><Btn size="sm" variant="primary">+ Agregar</Btn></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SUBSECTION BLOCK
// ═══════════════════════════════════════════════════════════════════
function SubsectionBlock({ subsection, products, onToggle, onUpdate, onRemove, onAdd, allProducts, selectedIds, onToggleSelect, onSelectAll, onSubstitute, monedaCot, tcCot, onAddBundle, onBundleQty, onDesagrupar, onGuardarComoBundle }: {
  subsection: IlumSubsection; products: IlumProduct[]; onToggle: () => void
  onUpdate: (id: string, f: string, v: number | string) => void; onRemove: (id: string) => void
  onAdd: () => void; allProducts: IlumProduct[]
  selectedIds?: Set<string>; onToggleSelect?: (id: string) => void; onSelectAll?: (ids: string[], select: boolean) => void; onSubstitute?: (p: IlumProduct) => void
  monedaCot?: Moneda; tcCot?: number
  onAddBundle?: () => void
  onBundleQty?: (instanceId: string, n: number) => void
  onDesagrupar?: (instanceId: string) => void
  onGuardarComoBundle?: () => void
}) {
  const subTotal = products.reduce((s, p) => s + calcLine(p).total, 0)
  // Los renglones de un mismo bundle se dibujan como una sola linea.
  const grupos = agruparPorBundle(products as any) as any[]
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const nCols = (onToggleSelect ? 1 : 0) + 13
  return (
    <div style={{ marginBottom: 10 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: 'pointer', background: '#111', borderRadius: 6, marginBottom: 2 }}>
        {subsection.collapsed ? <ChevronRight size={12} color="#555" /> : <ChevronDown size={12} color="#555" />}
        <span style={{ fontSize: 12, fontWeight: 700, color: '#10B981', textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>{subsection.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#666' }}>{products.length}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>${fmt(subTotal)}</span>
      </div>
      {!subsection.collapsed && (<>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 940, borderCollapse: 'collapse', tableLayout: 'fixed' as const }}>
          <colgroup>
            {onToggleSelect && <col style={{ width: 30 }} />}
            <col style={{ width: 46 }} />{/* IMG */}
            <col style={{ width: 92 }} />{/* NOMENCL */}
            <col />{/* PRODUCTO (flexible) */}
            <col style={{ width: 96 }} />{/* MARCA */}
            <col style={{ width: 100 }} />{/* MODELO */}
            <col style={{ width: 52 }} />{/* W */}
            <col style={{ width: 62 }} />{/* CANT */}
            <col style={{ width: 92 }} />{/* COSTO */}
            <col style={{ width: 70 }} />{/* MG% */}
            <col style={{ width: 92 }} />{/* PRECIO */}
            <col style={{ width: 98 }} />{/* TOTAL */}
            <col style={{ width: 30 }} />{/* sustituir */}
            <col style={{ width: 30 }} />{/* eliminar */}
          </colgroup>
          <thead><tr style={{ background: '#0e0e0e' }}>
            {onToggleSelect && (
              <th style={{ ...S.th, width: 28, textAlign: 'center', padding: '6px 4px' }}>
                <input type="checkbox"
                  checked={products.length > 0 && products.every(p => selectedIds?.has(p.id))}
                  onChange={() => {
                    const allSelected = products.length > 0 && products.every(p => selectedIds?.has(p.id))
                    const ids = products.map(p => p.id)
                    if (onSelectAll) onSelectAll(ids, !allSelected)
                  }}
                  style={{ accentColor: '#10B981', cursor: 'pointer' }} />
              </th>
            )}
            <th style={{ ...S.th, textAlign: 'center' }}>IMG</th>
            <th style={{ ...S.th, textAlign: 'center' }}>NOMENCL.</th>
            <th style={S.th}>PRODUCTO</th>
            <th style={S.th}>MARCA</th>
            <th style={S.th}>MODELO</th>
            <th style={{ ...S.th, textAlign: 'right' }}>W</th>
            <th style={{ ...S.th, textAlign: 'center' }}>CANT.</th>
            <th style={{ ...S.th, textAlign: 'right' }}>COSTO</th>
            <th style={{ ...S.th, textAlign: 'right' }}>MG%</th>
            <th style={{ ...S.th, textAlign: 'right' }}>PRECIO</th>
            <th style={{ ...S.th, textAlign: 'right' }}>TOTAL</th>
            <th style={S.th}></th><th style={S.th}></th>
          </tr></thead>
          <tbody>
            {grupos.map(g => g.tipo === 'suelto' ? (
              <ProductRow key={g.fila.id} p={g.fila} onUpdate={onUpdate} onRemove={onRemove} selected={selectedIds?.has(g.fila.id)} onToggleSelect={onToggleSelect} onSubstitute={onSubstitute} monedaCot={monedaCot} />
            ) : (
              <BundleRow key={g.instanceId} nombre={g.nombre} qty={g.qty} hijos={g.hijos}
                abierto={abiertos.has(g.instanceId)}
                onAbrir={() => setAbiertos(prev => { const n = new Set(prev); n.has(g.instanceId) ? n.delete(g.instanceId) : n.add(g.instanceId); return n })}
                onQty={n => onBundleQty && onBundleQty(g.instanceId, n)}
                onDesagrupar={() => onDesagrupar && onDesagrupar(g.instanceId)}
                onUpdate={onUpdate} onRemove={onRemove} monedaCot={monedaCot} tcCot={tcCot} cols={nCols} />
            ))}
          </tbody>
        </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', gap: 8, flexWrap: 'wrap' as const }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
            <Btn size="sm" onClick={onAdd}><Plus size={12} /> Producto</Btn>
            {onAddBundle && <Btn size="sm" onClick={onAddBundle}><Package size={12} /> Bundle</Btn>}
            {onGuardarComoBundle && products.length > 0 && (
              <Btn size="sm" onClick={onGuardarComoBundle} title="Guarda esta sección en el catálogo para reusarla en otras cotizaciones">
                <Save size={12} /> Guardar como bundle
              </Btn>
            )}
          </div>
          <span style={{ fontSize: 10, color: '#555' }}>{subsection.name.toUpperCase()} TOTAL <span style={{ fontWeight: 700, color: '#fff', marginLeft: 6 }}>${fmt(subTotal)}</span></span>
        </div>
      </>)}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AI IMPORT MODAL — Importar listado de productos con AI (Iluminación)
// ═══════════════════════════════════════════════════════════════════
interface AIExtractedItemIlum {
  _rowId: string
  subsection: string
  marca: string
  modelo: string
  descripcion: string
  cantidad: number
  precio_unitario: number | null
  costo: number | null
  moneda: 'USD' | 'MXN' | null
  provider: string
  watts: number | null
  lumens: number | null
  cct: string | null
  notas: string
  match_status: 'exact' | 'partial' | 'none'
  catalog_product_id: string | null
  sku?: string | null
}

function AIImportModalIlum({ cotId, subsections, onClose, onImported }: {
  cotId: string
  subsections: IlumSubsection[]
  onClose: () => void
  onImported: () => void
}) {
  const isMobile = useIsMobile()
  const [step, setStep] = useState<'upload' | 'processing' | 'review' | 'inserting'>('upload')
  const [items, setItems] = useState<AIExtractedItemIlum[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [confidence, setConfidence] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')
  const [insertedCount, setInsertedCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function fileToBase64(file: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res((r.result as string).split(',')[1])
      r.onerror = () => rej(new Error('Error leyendo archivo'))
      r.readAsDataURL(file)
    })
  }

  async function callExtractAPI(body: any): Promise<{ items: any[]; confidence: string; warnings: string[] }> {
    const r = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, context: 'iluminacion', subsections: subsections.map(s => s.name) }),
    })
    const data = await r.json()
    if (!r.ok || !data.ok) throw new Error(data.error || 'Error en /api/extract (' + r.status + ')')
    return { items: data.items || [], confidence: data.confidence || 'medium', warnings: data.warnings || [] }
  }

  async function loadXLSX(): Promise<any> {
    if ((window as any).XLSX) return (window as any).XLSX
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('No se pudo cargar SheetJS desde CDN'))
      document.head.appendChild(script)
    })
    if (!(window as any).XLSX) throw new Error('SheetJS cargado pero no disponible en window')
    return (window as any).XLSX
  }

  function mapSubsection(name: string): string {
    const s = (name || '').toLowerCase().trim()
    if (!s) return subsections[0]?.name || 'Luminarias'
    if (s.includes('luminaria') || s.includes('lamp') || s.includes('light') || s.includes('downlight') || s.includes('spot')) return 'Luminarias'
    if (s.includes('fuente') || s.includes('power') || s.includes('supply')) return 'Fuentes de Poder'
    if (s.includes('perfil') || s.includes('profile') || s.includes('channel')) return 'Perfiles'
    if (s.includes('driver') || s.includes('ballast') || s.includes('transformador')) return 'Drivers'
    if (s.includes('accesorio') || s.includes('accessor') || s.includes('mounting') || s.includes('bracket')) return 'Accesorios'
    if (s.includes('control') || s.includes('dimmer') || s.includes('switch') || s.includes('sensor')) return 'Control'
    return subsections[0]?.name || 'Luminarias'
  }

  function findCol(row: any, candidates: string[]): any {
    const keys = Object.keys(row)
    for (const cand of candidates) {
      const hit = keys.find(k => k.toLowerCase().trim() === cand.toLowerCase().trim())
      if (hit && row[hit] != null && String(row[hit]).trim() !== '') return row[hit]
    }
    return null
  }

  function tryParseStructuredRows(rows: any[]): { items: any[]; confidence: string; warnings: string[] } | null {
    if (!rows || rows.length === 0) return null
    const firstRow = rows[0]
    if (!firstRow || typeof firstRow !== 'object') return null
    const keys = Object.keys(firstRow).map(k => k.toLowerCase())
    const hasModel = keys.some(k => k === 'model' || k === 'modelo' || k === 'part number' || k === 'sku')
    if (!hasModel) return null

    const items: any[] = []
    const warnings: string[] = []
    for (const row of rows) {
      const model = findCol(row, ['Model', 'Modelo', 'Part Number', 'SKU'])
      if (!model) continue
      const manufacturer = findCol(row, ['Manufacturer', 'Marca', 'Brand', 'Fabricante']) || ''
      const category = findCol(row, ['Category', 'Categoría', 'Categoria', 'Subsección', 'Subseccion', 'System', 'Sistema', 'Type', 'Tipo']) || ''
      const description = findCol(row, ['Short Description', 'Description', 'Descripción', 'Descripcion', 'Product Description']) || ''
      const qtyRaw = findCol(row, ['Item Ext Qty', 'Item Unit Qty', 'Qty', 'Quantity', 'Cantidad', 'Cant'])
      const qty = qtyRaw != null ? parseFloat(String(qtyRaw)) : 1
      const priceRaw = findCol(row, ['Unit Price', 'Precio Unitario', 'Price', 'Precio', 'Item Unit Price', 'Sell Price', 'MSRP', 'P.U.', 'PU'])
      const price = priceRaw != null ? parseFloat(String(priceRaw).replace(/[$,]/g, '')) : null
      const costRaw = findCol(row, ['costo', 'Costo', 'Costo Unitario', 'Unit Cost', 'Cost', 'Dealer Cost', 'Net Cost'])
      const costVal = costRaw != null ? parseFloat(String(costRaw).replace(/[$,]/g, '')) : null
      const wattsRaw = findCol(row, ['Watts', 'W', 'Potencia', 'Wattage'])
      const lumensRaw = findCol(row, ['Lumens', 'Lm', 'Lúmenes', 'Lumenes', 'Flujo'])
      const cctRaw = findCol(row, ['CCT', 'Color Temp', 'Temperatura', 'Kelvin', 'K'])
      const currency = findCol(row, ['Selling Currency', 'Cost Currency', 'Currency', 'Moneda'])
      let moneda: 'USD' | 'MXN' | null = null
      if (currency) {
        const c = String(currency).toUpperCase()
        if (c.includes('USD') || c.includes('DLL') || c === 'US$') moneda = 'USD'
        else if (c.includes('MXN') || c.includes('PESO') || c === 'MX$') moneda = 'MXN'
      }

      items.push({
        subsection: mapSubsection(String(category)),
        marca: String(manufacturer).trim(),
        modelo: String(model).trim(),
        descripcion: String(description).trim(),
        cantidad: isNaN(qty) ? 1 : Math.max(1, Math.round(qty)),
        precio_unitario: price != null && !isNaN(price) ? price : null,
        costo: costVal != null && !isNaN(costVal) ? costVal : null,
        watts: wattsRaw ? parseFloat(String(wattsRaw)) || null : null,
        lumens: lumensRaw ? parseFloat(String(lumensRaw)) || null : null,
        cct: cctRaw ? String(cctRaw).trim() : null,
        moneda,
        provider: findCol(row, ['Vendor', 'Proveedor', 'Supplier', 'Distribuidor']) || String(manufacturer).trim(),
        notas: '',
      })
    }
    if (items.length === 0) return null
    const skipped = rows.length - items.length
    if (skipped > 0) warnings.push(skipped + ' fila(s) sin modelo fueron omitidas')
    warnings.push('Parseado directamente del Excel (' + items.length + ' items) — sin usar AI')
    return { items, confidence: 'high', warnings }
  }

  function tryParseStructured(text: string): { items: any[]; confidence: string; warnings: string[] } | null {
    if (!text || text.length < 50) return null
    const firstLine = text.split('\n')[0]
    const sep = firstLine.includes('\t') ? '\t' : ','
    const lines = text.split('\n').filter(l => l.trim().length > 0)
    if (lines.length < 2) return null
    function splitCSV(line: string): string[] {
      const out: string[] = []; let cur = ''; let inQ = false
      for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (c === '"' && (i === 0 || line[i-1] !== '\\')) { inQ = !inQ } else if (c === sep && !inQ) { out.push(cur); cur = '' } else { cur += c }
      }
      out.push(cur)
      return out.map(s => s.trim().replace(/^"|"$/g, ''))
    }
    const headers = splitCSV(lines[0])
    const rows: any[] = []
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCSV(lines[i]); const row: any = {}
      headers.forEach((h, idx) => { row[h] = cells[idx] || null })
      rows.push(row)
    }
    return tryParseStructuredRows(rows)
  }

  async function handleFile(file: File) {
    setError(null); setStep('processing'); setProgress('Leyendo archivo...')
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase()
      let extracted: { items: any[]; confidence: string; warnings: string[] }

      if (['csv', 'tsv', 'txt'].includes(ext)) {
        const text = await file.text()
        const dtResult = tryParseStructured(text)
        if (dtResult) { extracted = dtResult } else {
          setProgress('Analizando con AI...'); extracted = await callExtractAPI({ kind: 'text', payload: text })
        }
      } else if (['xlsx', 'xls'].includes(ext)) {
        setProgress('Cargando parser de Excel...')
        const XLSX = await loadXLSX()
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        let rows: any[] = []
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName]
          const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false })
          if (matrix.length === 0) continue
          const headerKeywords = ['model', 'modelo', 'part number', 'marca', 'quantity', 'cantidad', 'description', 'descripcion', 'price', 'precio', 'watts', 'costo', 'sku']
          let headerRowIdx = 0
          for (let i = 0; i < Math.min(matrix.length, 10); i++) {
            const cells = (matrix[i] || []).map((c: any) => String(c || '').toLowerCase().trim())
            const matches = cells.filter((c: string) => headerKeywords.some(kw => c === kw || c.includes(kw))).length
            if (matches >= 2) { headerRowIdx = i; break }
          }
          const headers = (matrix[headerRowIdx] || []).map((h: any, idx: number) => String(h || '').trim() || ('col_' + idx))
          const dataRows: any[] = []
          for (let i = headerRowIdx + 1; i < matrix.length; i++) {
            const row: any = {}; const cells = matrix[i] || []; let hasData = false
            headers.forEach((h: string, idx: number) => { const v = cells[idx]; row[h] = v != null && v !== '' ? v : null; if (v != null && String(v).trim() !== '') hasData = true })
            if (hasData) dataRows.push(row)
          }
          if (dataRows.length > rows.length) rows = dataRows
        }
        setProgress('Detectando formato...')
        const structured = tryParseStructuredRows(rows)
        if (structured) { extracted = structured } else {
          setProgress('Analizando con AI...')
          let text = ''; for (const name of wb.SheetNames) { text += '\n=== Hoja: ' + name + ' ===\n'; text += XLSX.utils.sheet_to_csv(wb.Sheets[name]) }
          extracted = await callExtractAPI({ kind: 'text', payload: text })
        }
      } else if (ext === 'pdf') {
        setProgress('Codificando PDF...'); const base64 = await fileToBase64(file)
        setProgress('Analizando PDF con AI...'); extracted = await callExtractAPI({ kind: 'pdf', payload: base64 })
      } else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        setProgress('Codificando imagen...'); const base64 = await fileToBase64(file)
        const mediaType = 'image/' + (ext === 'jpg' ? 'jpeg' : ext)
        setProgress('Analizando imagen con AI...'); extracted = await callExtractAPI({ kind: 'image', payload: base64, mediaType })
      } else {
        throw new Error('Formato no soportado: .' + ext + ' (usa Excel, CSV, PDF o imagen)')
      }

      setProgress('Verificando catálogo...')
      const matched = await matchCatalog(extracted.items)
      setItems(matched); setWarnings(extracted.warnings || []); setConfidence(extracted.confidence || 'medium'); setStep('review')
    } catch (err: any) { setError(err.message || 'Error procesando archivo'); setStep('upload') }
  }

  async function matchCatalog(rawItems: any[]): Promise<AIExtractedItemIlum[]> {
    const result: AIExtractedItemIlum[] = []
    for (const it of rawItems) {
      const row: AIExtractedItemIlum = {
        _rowId: uid(), subsection: it.subsection || subsections[0]?.name || 'Luminarias',
        marca: it.marca || '', modelo: it.modelo || '', descripcion: it.descripcion || '',
        cantidad: parseInt(it.cantidad) || 1, precio_unitario: it.precio_unitario != null ? Number(it.precio_unitario) : null,
        costo: it.costo != null ? Number(it.costo) : null, moneda: it.moneda === 'USD' || it.moneda === 'MXN' ? it.moneda : null,
        provider: it.provider || it.marca || '', watts: it.watts || null, lumens: it.lumens || null, cct: it.cct || null,
        notas: it.notas || '', match_status: 'none', catalog_product_id: null,
      }
      if (!row.modelo) { result.push(row); continue }
      const { data: exact } = await supabase.from('catalog_products').select('id, name, modelo').eq('modelo', row.modelo).eq('specialty', 'ilum').limit(5)
      if (exact && exact.length === 1) { row.match_status = 'exact'; row.catalog_product_id = exact[0].id }
      else if (exact && exact.length > 1) { row.match_status = 'partial'; row.catalog_product_id = exact[0].id }
      else {
        const { data: fuzzy } = await supabase.from('catalog_products').select('id, name, modelo').ilike('modelo', '%' + row.modelo + '%').eq('specialty', 'ilum').limit(5)
        if (fuzzy && fuzzy.length > 0) { row.match_status = 'partial'; row.catalog_product_id = fuzzy[0].id }
      }
      result.push(row)
    }
    return result
  }

  function updateRow(rowId: string, field: keyof AIExtractedItemIlum, value: any) {
    setItems(prev => prev.map(it => it._rowId === rowId ? { ...it, [field]: value } : it))
  }

  function removeRow(rowId: string) { setItems(prev => prev.filter(it => it._rowId !== rowId)) }

  async function handleConfirm() {
    setStep('inserting'); setError(null); setInsertedCount(0)
    try {
      // 0) Moneda y tipo de cambio de ESTA cotización.
      //    Viven en quotations.notes (currency / tipoCambio), igual que en los
      //    demás cotizadores. Si la cotización es en dólares y hay productos
      //    costeados en pesos, sin TC no se puede convertir: se avisa y se
      //    detiene, en vez de importar precios en la moneda equivocada.
      const { data: cotNotes } = await supabase.from('quotations').select('notes').eq('id', cotId).maybeSingle()
      let metaCot: any = {}
      try { metaCot = JSON.parse((cotNotes as any)?.notes || '{}') } catch { metaCot = {} }
      const monedaCot: Moneda = normalizarMoneda(metaCot.currency)
      const tcCot = Number(metaCot.tipoCambio) || 0
      // Conservador a propósito: una fila SIN moneda declarada también cuenta
      // como cruce posible, porque su moneda la va a resolver el catálogo
      // renglón por renglón y aquí todavía no se sabe.
      const hayCruce = items.some(it => !it.moneda || normalizarMoneda(it.moneda) !== monedaCot)
      if (hayCruce && !(tcCot > 0)) {
        throw new Error(`Esta cotización es en ${monedaCot} y hay partidas costeadas en la otra moneda, pero la cotización no tiene tipo de cambio. Captúralo en la cotización antes de importar.`)
      }

      // 1) Ensure subsections exist
      setProgress('Sincronizando subsecciones...')
      const subCache: Record<string, string> = {}
      subsections.forEach(s => { subCache[s.name.toLowerCase().trim()] = s.id })
      const uniqueSubNames = Array.from(new Set(items.map(it => (it.subsection || 'Luminarias').trim()).filter(Boolean)))
      for (const name of uniqueSubNames) {
        const key = name.toLowerCase()
        if (subCache[key]) continue
        const { data: newSub, error: subErr } = await supabase.from('quotation_areas').insert({
          quotation_id: cotId, name: name.trim(), order_index: Object.keys(subCache).length,
        }).select().single()
        if (subErr) throw new Error('Error creando subsección "' + name + '": ' + subErr.message)
        if (newSub) subCache[key] = newSub.id
      }

      // 2) Process each item
      setProgress('Procesando productos...')
      let inserted = 0
      const createdProducts: Record<string, { id: string; cost: number; moneda: string }> = {}
      for (const it of items) {
        if (!it.modelo) continue
        let catalogProductId = it.catalog_product_id
        let prodCost = it.costo || 0
        let prodMoneda: string = it.moneda || 'USD'

        if (!catalogProductId) {
          const cacheKey = it.modelo.toLowerCase().trim()
          if (createdProducts[cacheKey]) {
            catalogProductId = createdProducts[cacheKey].id
            prodCost = it.costo || createdProducts[cacheKey].cost
            prodMoneda = it.moneda || createdProducts[cacheKey].moneda
          } else {
            const { data: existingByModelo } = await supabase.from('catalog_products').select('id, cost, moneda, provider, marca, modelo, sku, image_url, markup').eq('modelo', it.modelo).limit(1).single()
            if (existingByModelo) {
              catalogProductId = existingByModelo.id
              prodCost = it.costo || Number(existingByModelo.cost) || 0
              prodMoneda = it.moneda || existingByModelo.moneda || 'USD'
              createdProducts[cacheKey] = { id: existingByModelo.id, cost: prodCost, moneda: prodMoneda }
            }
          }
        }

        if (!catalogProductId) {
          const newProductCost = it.costo || it.precio_unitario || 0
          const newProductMoneda = it.moneda || 'USD'
          const defaultMarkup = 35
          const precioVenta = it.precio_unitario || (newProductCost > 0 ? Math.round(newProductCost / (1 - defaultMarkup / 100) * 100) / 100 : 0)
          const productName = it.descripcion || ((it.marca + ' ' + it.modelo).trim())
          const computedMarkup = newProductCost > 0 && precioVenta > 0 ? Math.round((1 - newProductCost / precioVenta) * 100) : defaultMarkup
          const { data: newProd, error: prodErr } = await supabase.from('catalog_products').insert({
            name: productName, description: it.descripcion || null, system: 'Iluminacion', specialty: 'ilum',
            type: 'material', unit: 'pza', cost: newProductCost, markup: computedMarkup, precio_venta: precioVenta,
            provider: it.provider || null, marca: it.marca || null, modelo: it.modelo, moneda: newProductMoneda,
            watts: it.watts || null, lumens: it.lumens || null, cct: it.cct || null,
            clave_unidad: 'H87', iva_rate: 0.16, is_active: true,
          }).select().single()
          if (prodErr) {
            if (prodErr.code === '23505') {
              const { data: dup } = await supabase.from('catalog_products').select('id').eq('modelo', it.modelo).single()
              if (dup) { catalogProductId = dup.id; prodCost = newProductCost; prodMoneda = newProductMoneda; createdProducts[it.modelo.toLowerCase().trim()] = { id: dup.id, cost: newProductCost, moneda: newProductMoneda } }
              else { console.error('Error creando producto:', prodErr, it); continue }
            } else { console.error('Error creando producto:', prodErr, it); continue }
          }
          if (newProd) { catalogProductId = newProd.id; prodCost = newProductCost; prodMoneda = newProductMoneda; createdProducts[it.modelo.toLowerCase().trim()] = { id: newProd.id, cost: newProductCost, moneda: newProductMoneda } }
        } else {
          const { data: existing } = await supabase.from('catalog_products').select('cost, moneda, provider, markup, marca, modelo, sku, image_url, watts, lumens, cct').eq('id', catalogProductId).single()
          if (existing) {
            prodCost = it.costo || Number(existing.cost) || 0
            prodMoneda = it.moneda || existing.moneda || 'USD'
            if (!it.marca && existing.marca) it.marca = existing.marca
            if (!it.modelo && existing.modelo) it.modelo = existing.modelo
            if (!it.sku && (existing as any).sku) it.sku = (existing as any).sku
            if (!it.watts && existing.watts) it.watts = existing.watts
            if (!it.lumens && existing.lumens) it.lumens = existing.lumens
            if (!it.cct && existing.cct) it.cct = existing.cct
          }
        }

        const defaultMarkup = 35
        // ── Moneda ─────────────────────────────────────────────────────────
        // El precio del proveedor viene en SU moneda (Illux factura en pesos,
        // otras marcas en dólares) y así se queda el costo: es lo que se le va
        // a comprar. Lo que se convierte es el precio de venta, a la moneda de
        // ESTA cotización y con SU tipo de cambio. Antes no había conversión
        // alguna aquí: una cotización en dólares terminaba con luminarias
        // valuadas en pesos bajo el signo de dólar.
        const monedaProd: Moneda = normalizarMoneda(prodMoneda)
        let precioNat: number
        if (it.precio_unitario && it.precio_unitario > 0) { precioNat = it.precio_unitario }
        else if (prodCost > 0) { precioNat = Math.round(prodCost / (1 - defaultMarkup / 100) * 100) / 100 }
        else { precioNat = 0 }
        const margin = prodCost > 0 && precioNat > 0 ? Math.round((1 - prodCost / precioNat) * 100) : defaultMarkup
        const precio = convertir(precioNat, monedaProd, monedaCot, tcCot)

        const subId = subCache[(it.subsection || 'Luminarias').toLowerCase().trim()]
        if (!subId) { console.warn('Sin subsección para item', it); continue }
        const itemName = it.descripcion || ((it.marca + ' ' + it.modelo).trim())

        const { error: itemErr } = await supabase.from('quotation_items').insert({
          quotation_id: cotId, area_id: subId, catalog_product_id: catalogProductId,
          name: itemName, description: it.descripcion || null, system: 'Iluminacion', type: 'material',
          quantity: it.cantidad, cost: prodCost, markup: margin, price: precio, total: precio * it.cantidad,
          provider_currency: monedaProd,
          installation_cost: 0, order_index: inserted,
          marca: it.marca || null, modelo: it.modelo || null, sku: it.sku || null,
          notes: JSON.stringify({ watts: it.watts, lumens: it.lumens, cct: it.cct }),
        })
        if (itemErr) { console.error('Error insertando item:', itemErr, it); continue }
        inserted++; setInsertedCount(inserted)
      }

      onImported(); onClose()
    } catch (err: any) { setError(err.message || 'Error en la importación'); setStep('review') }
  }

  const exactCount = items.filter(i => i.match_status === 'exact').length
  const partialCount = items.filter(i => i.match_status === 'partial').length
  const noneCount = items.filter(i => i.match_status === 'none').length
  const allSubNames = Array.from(new Set([...subsections.map(s => s.name), ...SUBSECTION_PRESETS]))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1030 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: isMobile ? 0 : 16, padding: isMobile ? 12 : 20, width: isMobile ? '100vw' : '92vw', maxWidth: isMobile ? 'none' : 1200, height: isMobile ? '100vh' : 'auto', maxHeight: isMobile ? '100vh' : '92vh', display: 'flex', flexDirection: 'column' as const, margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={14} color="#10B981" /> Importar con AI — Iluminación
            </div>
            <div style={{ fontSize: 11, color: '#555' }}>Sube un listado en Excel, CSV, PDF o imagen — la AI extrae los productos de iluminación</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {error && <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: 10, color: '#f87171', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        {step === 'upload' && (
          <div onClick={() => fileInputRef.current?.click()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }} onDragOver={e => e.preventDefault()}
            style={{ border: '2px dashed #333', borderRadius: 12, padding: '60px 20px', textAlign: 'center', cursor: 'pointer', color: '#666' }}>
            <Upload size={36} color="#444" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: '#ccc', marginBottom: 6 }}>Arrastra un archivo o haz clic</div>
            <div style={{ fontSize: 11, color: '#555' }}>Excel (.xlsx, .csv, .tsv), PDF, imagen (JPG, PNG, WEBP)</div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt,.pdf,.jpg,.jpeg,.png,.webp,.gif" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </div>
        )}

        {step === 'processing' && (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <Loader2 size={32} color="#10B981" style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
            <div style={{ fontSize: 13, color: '#ccc' }}>{progress}</div>
          </div>
        )}

        {step === 'inserting' && (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <Loader2 size={32} color="#10B981" style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
            <div style={{ fontSize: 13, color: '#ccc' }}>{progress}</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>Insertados: {insertedCount} / {items.length}</div>
          </div>
        )}

        {step === 'review' && (<>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10, fontSize: 11 }}>
            <span style={{ color: '#888' }}>Confianza: <span style={{ color: confidence === 'high' ? '#10B981' : confidence === 'medium' ? '#D97706' : '#DC2626', fontWeight: 600 }}>{confidence}</span></span>
            <span style={{ color: '#888' }}>{items.length} items detectados</span>
            <span style={{ color: '#10B981' }}>✓ {exactCount} en catálogo</span>
            <span style={{ color: '#D97706' }}>~ {partialCount} parciales</span>
            <span style={{ color: '#06B6D4' }}>+ {noneCount} nuevos</span>
          </div>

          {warnings.length > 0 && (
            <div style={{ background: '#2a200a', border: '1px solid #3a2e10', borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: '#D97706', fontWeight: 600, marginBottom: 4 }}>Advertencias:</div>
              {warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#aaa' }}>• {w}</div>)}
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', border: '1px solid #222', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#1a1a1a' }}>
                <tr>
                  <th style={S.th}></th>
                  <th style={{ ...S.th, textAlign: 'left' }}>Subsección</th>
                  <th style={{ ...S.th, textAlign: 'left' }}>Marca</th>
                  <th style={{ ...S.th, textAlign: 'left' }}>Modelo</th>
                  <th style={{ ...S.th, textAlign: 'left' }}>Descripción</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>W</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Cant</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Costo</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>P. Venta</th>
                  <th style={S.th}>Mon</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it._rowId}>
                    <td style={{ ...S.td, textAlign: 'center', width: 28 }}>
                      {it.match_status === 'exact' && <span title="En catálogo" style={{ color: '#10B981' }}>✓</span>}
                      {it.match_status === 'partial' && <span title="Match parcial" style={{ color: '#D97706' }}>~</span>}
                      {it.match_status === 'none' && <span title="Se creará nuevo" style={{ color: '#06B6D4' }}>+</span>}
                    </td>
                    <td style={S.td}>
                      <select value={it.subsection} onChange={e => updateRow(it._rowId, 'subsection', e.target.value)}
                        style={{ padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }}>
                        {allSubNames.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={S.td}><input value={it.marca} onChange={e => updateRow(it._rowId, 'marca', e.target.value)} style={{ width: 90, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }} /></td>
                    <td style={S.td}><input value={it.modelo} onChange={e => updateRow(it._rowId, 'modelo', e.target.value)} style={{ width: 110, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }} /></td>
                    <td style={S.td}><input value={it.descripcion} onChange={e => updateRow(it._rowId, 'descripcion', e.target.value)} style={{ width: 180, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }} /></td>
                    <td style={S.tdR}><input type="number" value={it.watts ?? ''} onChange={e => updateRow(it._rowId, 'watts', e.target.value ? parseFloat(e.target.value) : null)} style={{ width: 50, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} /></td>
                    <td style={S.tdR}><input type="number" value={it.cantidad} onChange={e => updateRow(it._rowId, 'cantidad', parseInt(e.target.value) || 1)} style={{ width: 50, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} /></td>
                    <td style={S.tdR}><input type="number" step={0.01} value={it.costo ?? ''} onChange={e => updateRow(it._rowId, 'costo', e.target.value ? parseFloat(e.target.value) : null)} style={{ width: 70, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#D97706', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} /></td>
                    <td style={S.tdR}><input type="number" step={0.01} value={it.precio_unitario ?? ''} onChange={e => updateRow(it._rowId, 'precio_unitario', e.target.value ? parseFloat(e.target.value) : null)} style={{ width: 70, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} /></td>
                    <td style={S.td}>
                      <select value={it.moneda || ''} onChange={e => updateRow(it._rowId, 'moneda', (e.target.value || null) as any)}
                        style={{ padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }}>
                        <option value="">—</option><option value="USD">USD</option><option value="MXN">MXN</option>
                      </select>
                    </td>
                    <td style={{ ...S.td, width: 28 }}><button onClick={() => removeRow(it._rowId)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><X size={12} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" onClick={handleConfirm} disabled={items.length === 0}>Importar {items.length} items a la cotización</Btn>
          </div>
        </>)}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function CotEditorIlum({ cotId, onBack, onSwitchVersion }: { cotId: string; onBack: () => void; onSwitchVersion?: (id: string) => void }) {
  const isMobile = useIsMobile()
  const [quote, setQuote] = useState<IlumQuote | null>(null)
  const [subsections, setSubsections] = useState<IlumSubsection[]>([])
  const [products, setProducts] = useState<IlumProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [customSubInput, setCustomSubInput] = useState('')
  const [catalogModal, setCatalogModal] = useState<{ open: boolean; subsectionId: string } | null>(null)
  const [bundlePicker, setBundlePicker] = useState<string | null>(null)   // subsectionId
  const [guardandoBundle, setGuardandoBundle] = useState<string | null>(null) // subsectionId
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [substitutingProduct, setSubstitutingProduct] = useState<IlumProduct | null>(null)
  const [showAIImport, setShowAIImport] = useState(false)
  const [showPdfPicker, setShowPdfPicker] = useState(false)
  const [ilumConfig, setIlumConfig] = useState({ ivaRate: 16, descuento: 0, nominaPct: 20 })
  // Moneda de VENTA de esta cotización y su tipo de cambio pactado. Viven en
  // la raíz de quotations.notes, igual que en los demás cotizadores, para que
  // el PDF y el catálogo de licitación los lean.
  const [monedaCot, setMonedaCot] = useState<Moneda>('MXN')
  const [tcCot, setTcCot] = useState<number>(0)
  const [showBulkMargin, setShowBulkMargin] = useState(false)
  const [bulkMarginInput, setBulkMarginInput] = useState('')
  const [showEditInfo, setShowEditInfo] = useState(false)

  // Oculta el bot flotante mientras el editor está abierto (estorba sobre la tabla/totales)
  useEffect(() => {
    document.body.classList.add('hide-chatbot')
    return () => document.body.classList.remove('hide-chatbot')
  }, [])

  // Load quotation, subsections, and products
  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: quoteData } = await supabase.from('quotations').select('*').eq('id', cotId).single()
      if (quoteData) {
        setQuote(quoteData)
        try {
          const n = typeof quoteData.notes === 'string' ? JSON.parse(quoteData.notes) : (quoteData.notes || {})
          if (n.ilumConfig) setIlumConfig(c => ({ ...c, ...n.ilumConfig }))
          setMonedaCot(normalizarMoneda(n.currency))
          setTcCot(Number(n.tipoCambio) || 0)
        } catch {}
      }

      const { data: subsData } = await supabase.from('quotation_areas').select('*').eq('quotation_id', cotId).order('order_index')
      if (subsData) setSubsections(subsData.map(s => ({ ...s, collapsed: false })))

      const { data: prodData } = await supabase.from('quotation_items').select('*').eq('quotation_id', cotId).order('order_index')
      if (prodData) {
        const prods = prodData.map((p: any) => {
          let notes: any = {}
          try { notes = JSON.parse(p.notes || '{}') } catch {}
          return {
            id: p.id, subsectionId: p.area_id, catalogId: p.catalog_product_id,
            name: p.name, description: p.description || '', imageUrl: p.image_url,
            quantity: p.quantity || 1, cost: p.cost || 0, markup: p.markup || 0, price: p.price || 0, order: p.order_index || 0,
            monedaCosto: normalizarMoneda(p.provider_currency),
            marca: p.marca, modelo: p.modelo, sku: p.sku,
            watts: notes.watts || null, lumens: notes.lumens || null, cct: notes.cct || null,
            nomenclatura: p.nomenclatura || null,
            bundleId: p.bundle_id || null,
            bundleInstanceId: p.bundle_instance_id || null,
            bundleQty: p.bundle_qty != null ? Number(p.bundle_qty) : null,
            bundleUnitQty: p.bundle_unit_qty != null ? Number(p.bundle_unit_qty) : null,
          }
        })
        // El nombre del bundle vive en el catalogo, no en el renglon.
        const bundleIds = [...new Set(prods.map((p: any) => p.bundleId).filter(Boolean))]
        if (bundleIds.length > 0) {
          const { data: bn } = await supabase.from('catalog_bundles').select('id,name').in('id', bundleIds as string[])
          const nm = new Map((bn || []).map((b: any) => [b.id, b.name]))
          prods.forEach((p: any) => { if (p.bundleId) p.bundleName = nm.get(p.bundleId) || 'Bundle' })
        }
        // Enrich with catalog data for watts/lumens/cct if missing
        const catalogIds = [...new Set(prods.filter((p: any) => p.catalogId && !p.watts).map((p: any) => p.catalogId))]
        if (catalogIds.length > 0) {
          const { data: catData } = await supabase.from('catalog_products').select('id,watts,lumens,cct').in('id', catalogIds)
          if (catData) {
            const catMap = new Map(catData.map((c: any) => [c.id, c]))
            prods.forEach((p: any) => {
              if (p.catalogId && !p.watts) {
                const cat = catMap.get(p.catalogId)
                if (cat) { p.watts = cat.watts; p.lumens = cat.lumens; p.cct = cat.cct }
              }
            })
          }
        }
        setProducts(prods)
      }

      setLoading(false)
    }
    load()
  }, [cotId])

  // Add subsection (preset or custom)
  async function addSubsection(name: string) {
    if (!name.trim() || subsections.some(s => s.name === name)) return
    const { data } = await supabase.from('quotation_areas').insert({
      quotation_id: cotId, name: name.trim(), order_index: subsections.length,
    }).select().single()
    if (data) setSubsections([...subsections, { id: data.id, name: data.name, collapsed: false, order: data.order_index }])
    setCustomSubInput('')
  }

  // Remove subsection (cascade: deletes all products in it after confirmation)
  async function removeSubsection(id: string) {
    const subProducts = products.filter(p => p.subsectionId === id)
    const subName = subsections.find(s => s.id === id)?.name || 'esta subsección'
    if (subProducts.length > 0) {
      if (!confirm(`"${subName}" tiene ${subProducts.length} producto(s). ¿Eliminar la subsección y todos sus productos?`)) return
      const { error: delItemsErr } = await supabase.from('quotation_items').delete().eq('area_id', id)
      if (delItemsErr) { alert('Error eliminando productos: ' + delItemsErr.message); return }
      setProducts(prev => prev.filter(p => p.subsectionId !== id))
      setSelectedIds(prev => new Set([...prev].filter(x => !subProducts.some(p => p.id === x))))
    } else {
      if (!confirm(`¿Eliminar la subsección "${subName}"?`)) return
    }
    const { error: delAreaErr } = await supabase.from('quotation_areas').delete().eq('id', id)
    if (delAreaErr) { alert('Error eliminando subsección: ' + delAreaErr.message); return }
    setSubsections(subsections.filter(s => s.id !== id))
  }

  // Toggle subsection collapse
  function toggleSubsection(id: string) {
    setSubsections(subsections.map(s => s.id === id ? { ...s, collapsed: !s.collapsed } : s))
  }

  /**
   * El costo de una partida expresado en la moneda de la COTIZACIÓN.
   *
   * El costo guardado nunca se mueve de la moneda del proveedor; esto es solo
   * para poder compararlo contra el precio de venta. Si falta el TC devuelve
   * el costo tal cual: es lo único que se puede hacer, y el aviso de que falta
   * el tipo de cambio ya sale arriba, en la barra de moneda.
   */
  function costoEnMonedaCot(p: { cost: number; monedaCosto?: Moneda }): number {
    const m = normalizarMoneda(p.monedaCosto)
    if (m === monedaCot) return Number(p.cost) || 0
    const c = convertirSiSePuede(Number(p.cost) || 0, m, monedaCot, tcCot)
    return c === null ? (Number(p.cost) || 0) : c
  }

  /**
   * Cambiar la moneda de VENTA de la cotizacion.
   *
   * Cambiar la etiqueta no cambia el dinero. Antes este boton solo escribia
   * `currency` en notes: una cotizacion de USD 42 pasaba a decir "$42 MXN" y
   * el margen real se desplomaba a −896% porque el costo seguia en dolares.
   * Igual que en el cotizador ESP, hay que reescribir los precios.
   *
   *   USD → MXN: precio × TC        MXN → USD: precio ÷ TC
   *
   * Los COSTOS no se tocan: viven en la moneda en que factura cada proveedor y
   * eso no lo decide la cotizacion, lo decide el proveedor. Es tambien la
   * moneda en que Compras va a emitir la orden.
   *
   * El MG% tampoco se toca, y no es descuido: `costoEnMonedaCot` convierte el
   * costo con el MISMO factor con el que se multiplica el precio, asi que la
   * razon (precio − costo)/precio queda igual. Recalcularlo solo introduciria
   * error de redondeo.
   */
  async function convertirMonedaCotizacion(destino: Moneda) {
    if (destino === monedaCot) return

    // Sin partidas no hay nada que convertir: solo se fija la moneda.
    if (products.length === 0) { await guardarMoneda({ currency: destino }); return }

    const tc = Number(tcCot) || 0
    if (!(tc > 0)) {
      alert('Escribe primero el tipo de cambio.\n\nSin TC no se pueden convertir los precios, y cambiar solo la etiqueta dejaria la cotizacion diciendo ' + destino + ' con numeros de ' + monedaCot + '.')
      return
    }

    const aMXN = destino === 'MXN'
    const factor = aMXN ? tc : 1 / tc
    const r2 = (n: number) => Math.round(n * 100) / 100
    const ejemplo = products[0]
    if (!confirm(
      'Convertir toda la cotizacion a ' + (aMXN ? 'PESOS (MXN)' : 'DOLARES (USD)') + '\n\n' +
      '\u2022 Tipo de cambio fijo: ' + tc + '\n' +
      '\u2022 Los precios de venta se ' + (aMXN ? 'multiplican \u00d7 ' : 'dividen \u00f7 ') + tc + '\n' +
      '\u2022 Los COSTOS no se tocan: se quedan en la moneda en que factura cada proveedor\n' +
      '\u2022 ' + products.length + ' partida(s) se actualizaran\n' +
      '\u2022 Ejemplo: ' + simbolo(monedaCot) + fmt(ejemplo.price) + ' ' + monedaCot +
        ' \u2192 ' + simbolo(destino) + fmt(r2(ejemplo.price * factor)) + ' ' + destino + '\n\n' +
      'Esto reescribe los precios en ' + destino + '. \u00bfContinuar?'
    )) return

    const convertidos = products.map(p => ({ ...p, price: r2(p.price * factor) }))

    // Se escribe la DB ANTES de mover la moneda en pantalla: si algo falla, la
    // cotizacion se queda entera en su moneda original en vez de a medias.
    for (const p of convertidos) {
      const { error } = await supabase.from('quotation_items')
        .update({ price: p.price, total: r2(p.price * p.quantity) })
        .eq('id', p.id)
      if (error) {
        alert('Se detuvo la conversion: ' + error.message + '\n\nLa cotizacion sigue en ' + monedaCot + '. Vuelve a intentar.')
        return
      }
    }

    setProducts(convertidos)
    await guardarMoneda({ currency: destino, tipoCambio: tc })
  }

  /** Guarda moneda y TC en la raíz de notes, que es donde los busca el PDF. */
  async function guardarMoneda(next: { currency?: Moneda; tipoCambio?: number }) {
    if (next.currency !== undefined) setMonedaCot(next.currency)
    if (next.tipoCambio !== undefined) setTcCot(next.tipoCambio)
    const { data } = await supabase.from('quotations').select('notes').eq('id', cotId).maybeSingle()
    let n: any = {}
    try { n = JSON.parse((data as any)?.notes || '{}') } catch { n = {} }
    await supabase.from('quotations').update({ notes: JSON.stringify({ ...n, ...next }) }).eq('id', cotId)
  }

  // Update product field
  //
  // COSTO, MG% y PRECIO son tres caras del mismo número: precio = costo / (1 − mg).
  // Antes cada celda se guardaba sola, así que mover el margen dejaba el precio
  // igual y la cotización salía con un margen que no era el que decía. Ahora al
  // tocar una, la que sobra se recalcula:
  //
  //   MG%   → recalcula PRECIO   (subir margen sube lo que cobras: lo esperado)
  //   PRECIO → recalcula MG%     (cerraste en un precio; el margen es lo que resulte)
  //   COSTO  → recalcula MG%     (el precio ya se le dijo al cliente; lo que cambia
  //                               es tu margen, y ahí es donde quieres verlo)
  async function updateProduct(id: string, field: string, value: number | string) {
    const p = products.find(x => x.id === id)
    if (!p) return
    const updated: any = { ...p, [field]: value }

    const num = typeof value === 'number' ? value : parseFloat(String(value))
    const r2 = (n: number) => Math.round(n * 100) / 100

    // El COSTO está en la moneda del proveedor y el PRECIO en la de la
    // cotización. Para relacionarlos hay que pasar el costo a la moneda de
    // venta primero — si no, un producto costeado en pesos dentro de una
    // cotización en dólares producía un margen y un precio absurdos: el margen
    // salía negativo de miles por ciento, o el precio quedaba en el número de
    // pesos con signo de dólar.
    const costoVenta = costoEnMonedaCot(updated)

    if (field === 'markup') {
      // Sin costo no hay de dónde sacar el precio; margen sobre 0 daría 0 y
      // borraría el precio capturado a mano.
      const mg = Math.min(Math.max(num || 0, -900), 99)
      updated.markup = mg
      if (costoVenta > 0) updated.price = r2(costoVenta / (1 - mg / 100))
    } else if (field === 'price') {
      updated.price = num || 0
      updated.markup = costoVenta > 0 && updated.price > 0
        ? Math.round((1 - costoVenta / updated.price) * 100)
        : updated.markup
    } else if (field === 'cost') {
      // Lo que se teclea aquí es el costo del proveedor, en SU moneda.
      updated.cost = num || 0
      const cv = costoEnMonedaCot(updated)
      updated.markup = cv > 0 && updated.price > 0
        ? Math.round((1 - cv / updated.price) * 100)
        : updated.markup
    }

    setProducts(products.map(x => x.id === id ? updated : x))

    const { total } = calcLine(updated)
    const payload: any = { total }
    if (field === 'quantity') payload.quantity = updated.quantity
    else { payload.cost = updated.cost; payload.markup = updated.markup; payload.price = updated.price }
    await supabase.from('quotation_items').update(payload).eq('id', id)
  }

  // Remove product
  async function removeProduct(id: string) {
    setProducts(products.filter(p => p.id !== id))
    await supabase.from('quotation_items').delete().eq('id', id)
    setSelectedIds(new Set([...selectedIds].filter(x => x !== id)))
  }

  // Add product from catalog
  // ── Bundles ────────────────────────────────────────────────────────────
  // Se guardan explotados (un quotation_items por producto) y se pintan
  // agrupados. Compras y Seguimiento necesitan la cantidad real por producto.
  async function insertarBundleEnSeccion(subsectionId: string, bundle: BundleCat, qty: number) {
    try {
      const nuevas = await insertarBundle({
        cotId, subsectionId, bundle, qty,
        monedaCot, tc: tcCot,
        ordenInicial: products.filter(p => p.subsectionId === subsectionId).length,
      })
      setProducts(prev => [...prev, ...nuevas.map(n => ({ ...n, subsectionId }))])
      setBundlePicker(null)
    } catch (e: any) {
      alert('No se pudo insertar el bundle: ' + (e?.message || String(e)))
    }
  }

  async function cambiarCantidadBundle(instanceId: string, n: number) {
    const hijos = products.filter(p => p.bundleInstanceId === instanceId)
    if (!hijos.length) return
    try {
      const cambios = await cambiarQtyBundle(hijos as any, n)
      const porId = new Map(cambios.map(c => [c.id, c]))
      setProducts(prev => prev.map(p => {
        const c = porId.get(p.id)
        return c ? { ...p, quantity: c.quantity, bundleQty: c.bundleQty } : p
      }))
    } catch (e: any) {
      alert('No se pudo cambiar la cantidad: ' + (e?.message || String(e)))
    }
  }

  async function desagrupar(instanceId: string) {
    const hijos = products.filter(p => p.bundleInstanceId === instanceId)
    if (!hijos.length) return
    if (!confirm(`Desagrupar "${hijos[0].bundleName || 'bundle'}"? Los ${hijos.length} productos se quedan en la cotización, sueltos.`)) return
    try {
      await desagruparBundle(hijos.map(h => h.id))
      setProducts(prev => prev.map(p => p.bundleInstanceId === instanceId
        ? { ...p, bundleId: null, bundleInstanceId: null, bundleName: null, bundleQty: null, bundleUnitQty: null }
        : p))
    } catch (e: any) {
      alert('No se pudo desagrupar: ' + (e?.message || String(e)))
    }
  }

  async function guardarSeccionComoBundle(subsectionId: string) {
    const sub = subsections.find(x => x.id === subsectionId)
    const filas = products.filter(p => p.subsectionId === subsectionId)
    if (!filas.length) return
    const sugerido = `${sub?.name || 'Sección'} — ${quote?.client_name || quote?.name || ''}`.trim().replace(/[—-]\s*$/, '').trim()
    const nombre = prompt('Nombre del bundle:', sugerido)
    if (nombre == null) return
    setGuardandoBundle(subsectionId)
    try {
      const r = await guardarComoBundle({
        nombre,
        descripcion: `Creado desde la cotización ${quote?.name || cotId}`,
        filas: filas.map(f => ({
          catalogId: f.catalogId, name: f.name, quantity: f.quantity,
          bundleQty: f.bundleQty, bundleUnitQty: f.bundleUnitQty,
        })),
      })
      alert(r.omitidos.length
        ? `Bundle "${nombre}" guardado con ${r.guardados} producto(s).\n\nQuedaron fuera ${r.omitidos.length} que no están en el catálogo:\n· ${r.omitidos.slice(0, 6).join('\n· ')}`
        : `Bundle "${nombre}" guardado con ${r.guardados} producto(s). Ya lo puedes insertar en cualquier cotización.`)
    } catch (e: any) {
      alert('No se pudo guardar: ' + (e?.message || String(e)))
    }
    setGuardandoBundle(null)
  }

  async function addProductFromCatalog(subsectionId: string, catProduct: CatProduct) {
    const markup = catProduct.markup || 35
    // El precio de lista viene en la moneda del proveedor. Si esta cotización
    // es en otra, se CONVIERTE. Antes se metía tal cual: un producto dado de
    // alta en pesos entraba a una cotización en dólares con el número de pesos
    // bajo el signo de dólar, y el total de la cotización quedaba inflado ~18x
    // sin que nada lo delatara.
    const monedaCosto = monedaDeCosto(catProduct)
    const precioNat = catProduct.precio_venta > 0 ? catProduct.precio_venta : (catProduct.cost > 0 && markup < 100 ? Math.round(catProduct.cost / (1 - markup / 100) * 100) / 100 : 0)
    let price: number
    try { price = convertir(precioNat, monedaCosto, monedaCot, tcCot) }
    catch (e: any) { alert(e.message); return }
    const total = price * 1
    const { data, error } = await supabase.from('quotation_items').insert({
      quotation_id: cotId, area_id: subsectionId, catalog_product_id: catProduct.id,
      name: catProduct.name, description: catProduct.description || null, image_url: catProduct.image_url || null,
      quantity: 1, cost: catProduct.cost || 0, markup, price, provider_currency: monedaCosto,
      total, order_index: products.filter(p => p.subsectionId === subsectionId).length,
      system: 'Iluminacion', type: 'material',
      marca: catProduct.marca || null, modelo: catProduct.modelo || null, sku: catProduct.sku || null,
      notes: JSON.stringify({ watts: catProduct.watts, lumens: catProduct.lumens, cct: catProduct.cct }),
    }).select().single()
    if (error) { alert('Error: ' + error.message); return }
    if (data) {
      setProducts(prev => [...prev, {
        id: data.id, subsectionId, catalogId: catProduct.id,
        name: catProduct.name, description: catProduct.description || '',
        imageUrl: catProduct.image_url || null,
        quantity: 1, cost: catProduct.cost || 0, markup, price, monedaCosto,
        order: products.filter(p => p.subsectionId === subsectionId).length,
        marca: catProduct.marca, modelo: catProduct.modelo, sku: catProduct.sku,
        watts: catProduct.watts, lumens: catProduct.lumens, cct: catProduct.cct,
      }])
    }
    setCatalogModal(null)
  }

  // Substitute product globally
  async function substituteProduct(oldProduct: IlumProduct, newCatProd: CatProduct) {
    if (!oldProduct.catalogId) return
    const oldCatalogId = oldProduct.catalogId
    const affected = products.filter(p => p.catalogId === oldCatalogId)
    const count = affected.length
    if (!confirm(`¿Sustituir "${oldProduct.name}" por "${newCatProd.name}" en ${count} ubicación(es)?`)) return

    const markup = newCatProd.markup || 35
    // Mismo cruce de moneda que al agregar: precio a la moneda de la
    // cotización, costo intacto en la del proveedor.
    const monedaCosto = monedaDeCosto(newCatProd)
    const precioNat = newCatProd.precio_venta > 0 ? newCatProd.precio_venta : (newCatProd.cost > 0 && markup < 100 ? Math.round(newCatProd.cost / (1 - markup / 100) * 100) / 100 : 0)
    let price: number
    try { price = convertir(precioNat, monedaCosto, monedaCot, tcCot) }
    catch (e: any) { alert(e.message); return }

    setProducts(prev => prev.map(p => {
      if (p.catalogId !== oldCatalogId) return p
      return { ...p, catalogId: newCatProd.id, name: newCatProd.name, description: newCatProd.description || '', imageUrl: newCatProd.image_url || null, cost: newCatProd.cost || 0, markup, price, monedaCosto, marca: newCatProd.marca || null, modelo: newCatProd.modelo || null, sku: newCatProd.sku || null, watts: newCatProd.watts, lumens: newCatProd.lumens, cct: newCatProd.cct }
    }))

    for (const p of affected) {
      await supabase.from('quotation_items').update({
        catalog_product_id: newCatProd.id, name: newCatProd.name, description: newCatProd.description || null,
        image_url: newCatProd.image_url || null, cost: newCatProd.cost || 0, markup, price, provider_currency: monedaCosto,
        total: price * p.quantity, marca: newCatProd.marca || null, modelo: newCatProd.modelo || null, sku: newCatProd.sku || null,
        notes: JSON.stringify({ watts: newCatProd.watts, lumens: newCatProd.lumens, cct: newCatProd.cct }),
      }).eq('id', p.id)
    }
    setSubstitutingProduct(null)
    alert(`${count} producto(s) sustituido(s).`)
  }

  // Update quotation name
  async function updateQuoteName(name: string) {
    if (!quote) return
    setQuote({ ...quote, name })
    await supabase.from('quotations').update({ name }).eq('id', cotId)
  }

  // Toggle product selection
  function toggleProductSelect(id: string) {
    const newIds = new Set(selectedIds)
    if (newIds.has(id)) newIds.delete(id)
    else newIds.add(id)
    setSelectedIds(newIds)
  }

  function selectAllProducts(ids: string[], select: boolean) {
    const newSet = new Set(selectedIds)
    if (select) ids.forEach(id => newSet.add(id))
    else ids.forEach(id => newSet.delete(id))
    setSelectedIds(newSet)
  }

  async function syncSelectedWithCatalog() {
    const ids = Array.from(selectedIds)
    const toSync = products.filter(p => ids.includes(p.id) && p.catalogId)
    if (toSync.length === 0) { alert('Ninguno de los productos seleccionados tiene catálogo vinculado.'); return }
    if (!confirm(`¿Sincronizar ${toSync.length} producto(s) con su catálogo? Esto actualizará costo, precio y margen.`)) return

    const catalogIds = [...new Set(toSync.map(p => p.catalogId!).filter(Boolean))]
    const { data: catProds } = await supabase.from('catalog_products').select('*').in('id', catalogIds)
    if (!catProds || catProds.length === 0) { alert('No se encontraron productos en catálogo.'); return }

    const catMap = new Map(catProds.map((c: any) => [c.id, c]))
    let synced = 0

    for (const p of toSync) {
      const cat = catMap.get(p.catalogId!)
      if (!cat) continue
      const markup = cat.markup > 0 ? cat.markup : (p.markup || 35)
      // Sincronizar con el catálogo también cruza la moneda: el catálogo está
      // en la del proveedor y la cotización en la de venta.
      const monedaCosto = monedaDeCosto(cat)
      const precioNat = cat.precio_venta > 0 ? cat.precio_venta : (cat.cost > 0 && markup < 100 ? Math.round(cat.cost / (1 - markup / 100) * 100) / 100 : 0)
      let price: number
      try { price = convertir(precioNat, monedaCosto, monedaCot, tcCot) }
      catch (e: any) { alert(e.message); return }
      const total = price * p.quantity

      setProducts(prev => prev.map(pr => pr.id === p.id ? {
        ...pr, cost: cat.cost || 0, price, markup, monedaCosto,
        imageUrl: cat.image_url || pr.imageUrl,
        marca: cat.marca || pr.marca, modelo: cat.modelo || pr.modelo, sku: cat.sku || pr.sku,
        watts: cat.watts ?? pr.watts, lumens: cat.lumens ?? pr.lumens, cct: cat.cct || pr.cct,
      } : pr))

      await supabase.from('quotation_items').update({
        cost: cat.cost || 0, price, markup, total, provider_currency: monedaCosto,
        image_url: cat.image_url || null,
        marca: cat.marca || null, modelo: cat.modelo || null, sku: cat.sku || null,
      }).eq('id', p.id)
      synced++
    }

    setSelectedIds(new Set())
    alert(`${synced} producto(s) sincronizado(s) con catálogo.`)
  }

  // Auto-numerar nomenclaturas: asigna L-01, L-02… a items sin nomenclatura en orden
  // (por subsección y luego por orden dentro de cada subsección). Por default skipea
  // items que ya tienen nomenclatura — pregunta antes si querés sobreescribir.
  async function autoNumberNomenclaturas() {
    if (products.length === 0) { alert('No hay productos para numerar.'); return }
    const withNom = products.filter(p => p.nomenclatura && p.nomenclatura.trim()).length
    const withoutNom = products.length - withNom
    let overwrite = false
    if (withNom > 0) {
      const choice = confirm(
        `${withoutNom} item(s) sin nomenclatura · ${withNom} ya tienen.\n\n` +
        `OK = solo asignar a los que NO tienen (preserva los existentes)\n` +
        `Cancelar = abort\n\n` +
        `(Si quieres sobreescribir todo, primero borra los existentes manualmente o cancela este diálogo y avísame)`
      )
      if (!choice) return
    } else {
      if (!confirm(`Asignar nomenclatura L-01, L-02… a los ${products.length} item(s)?`)) return
    }
    // Sort by subsection order_index, then by item order_index
    const subOrder = new Map(subsections.map((s, i) => [s.id, i]))
    const sortedProducts = [...products].sort((a, b) => {
      const subA = subOrder.get(a.subsectionId) ?? 999
      const subB = subOrder.get(b.subsectionId) ?? 999
      if (subA !== subB) return subA - subB
      return (a.order || 0) - (b.order || 0)
    })
    let counter = 1
    const updates: Array<{ id: string; nomenclatura: string }> = []
    for (const p of sortedProducts) {
      if (p.nomenclatura && p.nomenclatura.trim() && !overwrite) {
        counter++  // still consume the number so it stays in sync with position
        continue
      }
      const code = 'L-' + String(counter).padStart(2, '0')
      updates.push({ id: p.id, nomenclatura: code })
      counter++
    }
    // Apply in local state
    const updateMap = new Map(updates.map(u => [u.id, u.nomenclatura]))
    setProducts(prev => prev.map(p => updateMap.has(p.id) ? { ...p, nomenclatura: updateMap.get(p.id)! } : p))
    // Persist to DB
    for (const u of updates) {
      await supabase.from('quotation_items').update({ nomenclatura: u.nomenclatura }).eq('id', u.id)
    }
    alert(`✓ Asignadas ${updates.length} nomenclaturas (L-01 a L-${String(counter - 1).padStart(2, '0')}).`)
  }

  async function syncAllWithCatalog() {
    const toSync = products.filter(p => p.catalogId)
    if (toSync.length === 0) { alert('No hay productos vinculados a catálogo.'); return }
    if (!confirm(`¿Sincronizar ${toSync.length} producto(s) con su catálogo? Esto actualizará costo, precio y margen.`)) return

    const catalogIds = [...new Set(toSync.map(p => p.catalogId!).filter(Boolean))]
    const { data: catProds } = await supabase.from('catalog_products').select('*').in('id', catalogIds)
    if (!catProds || catProds.length === 0) { alert('No se encontraron productos en catálogo.'); return }

    const catMap = new Map(catProds.map((c: any) => [c.id, c]))
    let synced = 0

    for (const p of toSync) {
      const cat = catMap.get(p.catalogId!)
      if (!cat) continue
      const markup = cat.markup > 0 ? cat.markup : (p.markup || 35)
      const price = cat.precio_venta > 0 ? cat.precio_venta : (cat.cost > 0 && markup < 100 ? Math.round(cat.cost / (1 - markup / 100) * 100) / 100 : 0)
      const total = price * p.quantity

      setProducts(prev => prev.map(pr => pr.id === p.id ? {
        ...pr, cost: cat.cost || 0, price, markup,
        imageUrl: cat.image_url || pr.imageUrl,
        marca: cat.marca || pr.marca, modelo: cat.modelo || pr.modelo, sku: cat.sku || pr.sku,
        watts: cat.watts ?? pr.watts, lumens: cat.lumens ?? pr.lumens, cct: cat.cct || pr.cct,
      } : pr))

      await supabase.from('quotation_items').update({
        cost: cat.cost || 0, price, markup, total,
        image_url: cat.image_url || null,
        marca: cat.marca || null, modelo: cat.modelo || null, sku: cat.sku || null,
      }).eq('id', p.id)
      synced++
    }
    alert(`${synced} producto(s) sincronizado(s) con catálogo.`)
  }

  async function bulkDeleteSelected() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!confirm(`¿Eliminar ${ids.length} producto(s)?`)) return
    for (const id of ids) {
      await supabase.from('quotation_items').delete().eq('id', id)
    }
    setProducts(prev => prev.filter(p => !ids.includes(p.id)))
    setSelectedIds(new Set())
  }

  async function updateIlumConfig(field: string, value: number) {
    const next = { ...ilumConfig, [field]: value }
    setIlumConfig(next)
    // Persist to quotation notes
    const { data: cotData } = await supabase.from('quotations').select('notes').eq('id', cotId).single()
    let existingNotes: any = {}
    try { existingNotes = typeof cotData?.notes === 'string' ? JSON.parse(cotData.notes) : (cotData?.notes || {}) } catch {}
    await supabase.from('quotations').update({ notes: JSON.stringify({ ...existingNotes, ilumConfig: next }) }).eq('id', cotId)
  }

  // Calculate totals
  const subtotal = useMemo(() => products.reduce((s, p) => s + calcLine(p).total, 0), [products])
  const descuentoAmt = Math.round(subtotal * (ilumConfig.descuento || 0) / 100 * 100) / 100
  const subtotalDesc = subtotal - descuentoAmt
  const ivaAmt = Math.round(subtotalDesc * ilumConfig.ivaRate / 100 * 100) / 100
  const grandTotal = subtotalDesc + ivaAmt

  // Sync total to quotation record
  useEffect(() => {
    if (!loading && grandTotal >= 0) {
      supabase.from('quotations').update({ total: Math.round(grandTotal * 100) / 100, total_final: Math.round(grandTotal * 100) / 100 }).eq('id', cotId).then(() => {})
    }
  }, [grandTotal, loading, cotId])

  // ─── MG Real del proyecto (con descuento + nómina) ─────────────────
  // revenueBilled = subtotal × (1 − desc/100); nomina = revenueBilled × nomPct/100
  // MG Real = (revenueBilled − costoProductos − nomina) / revenueBilled
  // Cuántas partidas están costeadas en una moneda distinta a la de venta, y
  // si falta el TC para poder convertirlas. Va antes de `overallMargin` porque
  // la barra de moneda lo pinta arriba de la tabla.
  const productosCruzados = products.filter(p => normalizarMoneda(p.monedaCosto) !== monedaCot).length
  const tcSugerido = tcForYear(new Date().getFullYear())
  const necesitaTC = productosCruzados > 0 && !(tcCot > 0)

  const overallMargin = useMemo(() => {
    let revenue = 0, cost = 0
    products.forEach(p => {
      // El costo se compara YA convertido a la moneda de venta.
      const c = calcLine(p, monedaCot, tcCot)
      revenue += p.price * p.quantity
      cost += c.costReal * p.quantity
    })
    const descFactor = 1 - (ilumConfig.descuento || 0) / 100
    const revenueBilled = revenue * descFactor
    const nomina = revenueBilled * (ilumConfig.nominaPct || 0) / 100
    return revenueBilled > 0 ? Math.round(((revenueBilled - cost - nomina) / revenueBilled) * 1000) / 10 : 0
  }, [products, ilumConfig.descuento, ilumConfig.nominaPct, monedaCot, tcCot])

  // Bulk-margin: escala precios proporcionalmente para que MG Real llegue al target.
  //   newRevenueBilled = totalCost / (1 − (target + nomPct)/100)
  //   newRevenueListprice = newRevenueBilled / (1 − desc/100)
  //   scale = newRevenue / currentRevenue
  async function applyBulkMargin(targetPct: number) {
    if (isNaN(targetPct) || targetPct < 0 || targetPct >= 100) {
      alert('Margen inválido. Usa un valor entre 0 y 99.9 (%).')
      return
    }
    let totalCost = 0, productRev = 0
    products.forEach(p => {
      const c = calcLine(p, monedaCot, tcCot)
      totalCost += c.costReal * p.quantity
      productRev += p.price * p.quantity
    })
    if (totalCost === 0) { alert('No hay productos con costo. Captura costos antes de ajustar margen.'); return }
    if (productRev === 0) { alert('No hay revenue de productos para escalar.'); return }

    const nomPct = ilumConfig.nominaPct || 0
    const descPct = ilumConfig.descuento || 0
    const effectiveDenom = 1 - (targetPct + nomPct) / 100
    if (effectiveDenom <= 0) {
      alert(`No alcanzable: target ${targetPct}% + nómina ${nomPct}% = ${targetPct + nomPct}% no deja revenue para costos. Reduce el target o ajusta nominaPct.`)
      return
    }
    const descFactor = 1 - descPct / 100
    if (descFactor <= 0) { alert('Descuento inválido (debe ser < 100%).'); return }
    const newRevenueBilled = totalCost / effectiveDenom
    const newRevenue = newRevenueBilled / descFactor
    const scale = newRevenue / productRev

    const currentRevBilled = productRev * descFactor
    const currentNomina = currentRevBilled * nomPct / 100
    const currentMg = currentRevBilled > 0 ? ((currentRevBilled - totalCost - currentNomina) / currentRevBilled) * 100 : 0

    if (!confirm(
      `Ajustar margen del proyecto:\n\n` +
      `• Actual: ${currentMg.toFixed(1)}% → Target: ${targetPct}%\n` +
      `• Nómina prorrateada: ${nomPct}% del revenue\n` +
      (descPct > 0 ? `• Descuento aplicado: ${descPct}% (listprice sube extra para compensar)\n` : '') +
      `• Precios se escalarán × ${scale.toFixed(4)}\n` +
      `• Productos: $${fmt(productRev)} → $${fmt(productRev * scale)}\n\n` +
      `¿Aplicar?`
    )) return

    const updated = products.map(p => {
      const newPrice = Math.round(p.price * scale * 100) / 100
      const newMarkup = (p.cost > 0 && newPrice > 0) ? Math.round((1 - p.cost / newPrice) * 100) : p.markup
      return { ...p, price: newPrice, markup: newMarkup }
    })
    setProducts(updated)

    for (const p of updated) {
      const newTotal = p.price * p.quantity
      await supabase.from('quotation_items').update({
        price: p.price,
        markup: p.markup,
        total: Math.round(newTotal * 100) / 100,
      }).eq('id', p.id)
    }
  }

  const subsectionTotals = useMemo(() => {
    const map: Record<string, number> = {}
    subsections.forEach(s => {
      map[s.id] = products.filter(p => p.subsectionId === s.id).reduce((s, p) => s + calcLine(p).total, 0)
    })
    return map
  }, [subsections, products])

  function getVersionSnapshot(): VersionSnapshot {
    return {
      config: { ...ilumConfig },
      areas: subsections.map(s => ({ id: s.id, name: s.name, order: s.order })),
      items: products.map(p => {
        const { total, costReal } = calcLine(p, monedaCot, tcCot)
        return {
          id: p.id, areaId: p.subsectionId, name: p.name,
          description: [p.marca, p.modelo, p.watts ? p.watts + 'W' : null].filter(Boolean).join(' | ') || p.description,
          quantity: p.quantity, price: p.price, cost: costReal, total,
          system: 'Iluminacion',
        }
      }),
      total: grandTotal,
      subtotal: subtotalDesc,
      editorType: 'ilum',
      meta: { ivaRate: ilumConfig.ivaRate, descuento: ilumConfig.descuento, nominaPct: ilumConfig.nominaPct },
    }
  }

  if (loading) return <Loading />

  return (
    <div style={{ background: '#0e0e0e', minHeight: '100vh', padding: isMobile ? '12px' : '20px', color: '#ccc' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #222' }}>
          {/* Renglón 1: regresar + título (línea completa) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {'<'} Cotizaciones
            </button>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  type="text" value={quote?.name || ''} onChange={e => updateQuoteName(e.target.value)}
                  placeholder="Nombre de cotización"
                  style={{ background: 'transparent', border: 'none', fontSize: 17, fontWeight: 700, color: '#fff', width: '100%', fontFamily: 'inherit' }}
                />
                {(quote?.client_name) && <div style={{ fontSize: 11, color: '#666', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{quote.client_name}</div>}
              </div>
              <button onClick={() => setShowEditInfo(true)} title="Editar datos de la cotización (cliente, lead, proyecto)" style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}><Pencil size={14} /></button>
              <BotonCatalogo cotId={cotId} />
            </div>
          </div>
          {/* Renglón 2: etapas + acciones */}
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(STAGE_CONFIG).map(([id, s]) => (
              <button
                key={id}
                onClick={() => quote && supabase.from('quotations').update({ stage: id }).eq('id', cotId).then(() => setQuote({ ...quote, stage: id }))}
                style={{
                  padding: '6px 12px', borderRadius: 6, fontSize: isMobile ? 10 : 11, fontWeight: 600, fontFamily: 'inherit',
                  background: quote?.stage === id ? s.color + '33' : 'transparent',
                  border: quote?.stage === id ? '1px solid ' + s.color : '1px solid #333',
                  color: quote?.stage === id ? s.color : '#666', cursor: 'pointer',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowAIImport(true)} style={{ padding: '6px 12px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #10B98144', background: 'transparent', color: '#10B981', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Sparkles size={12} /> {isMobile ? 'AI' : 'Importar con AI'}</button>
          <button onClick={syncAllWithCatalog} style={{ padding: '6px 12px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #2563EB44', background: 'transparent', color: '#2563EB', display: 'inline-flex', alignItems: 'center', gap: 4 }}><RefreshCw size={12} /> {isMobile ? 'Sync' : 'Sync catálogo'}</button>
          <button onClick={autoNumberNomenclaturas} title="Asigna L-01, L-02… a items sin nomenclatura" style={{ padding: '6px 12px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #10B98144', background: 'transparent', color: '#10B981', display: 'inline-flex', alignItems: 'center', gap: 4 }}>🏷 {isMobile ? 'Num' : 'Auto-numerar'}</button>
          <button onClick={() => setShowPdfPicker(true)} style={{ padding: '6px 12px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #06B6D444', background: 'transparent', color: '#06B6D4', display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileText size={12} /> {isMobile ? 'PDF' : 'Exportar PDF'}</button>
          <VersionManager cotId={cotId} getCurrentSnapshot={getVersionSnapshot} onSwitchVersion={onSwitchVersion || (() => {})} accentColor="#10B981" compact={isMobile} />
          {quote && (quote.stage === 'contrato' || quote.stage === 'propuesta') && (
            <button onClick={() => window.open(`/cotizacion/${cotId}/memoria-tecnica`, '_blank')} style={{ padding: '6px 12px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #D9770644', background: 'transparent', color: '#D97706', display: 'inline-flex', alignItems: 'center', gap: 4 }}><BookOpen size={12} /> {isMobile ? 'Memoria' : 'Memoria Técnica'}</button>
          )}
          {/* Badge MG Real — click para bulk adjust */}
          {!isMobile && (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button
                onClick={() => { setShowBulkMargin(v => !v); setBulkMarginInput(String(overallMargin)) }}
                title={`MG Real = (revenue − costo productos − nómina ${ilumConfig.nominaPct}%) / revenue billed. Click para ajustar.`}
                style={{
                  padding: '6px 12px', borderRadius: 20, fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  border: '1px solid ' + (necesitaTC ? '#555' : overallMargin >= 25 ? '#10B981' : overallMargin >= 15 ? '#D97706' : '#DC2626'),
                  background: (necesitaTC ? '#555' : overallMargin >= 25 ? '#10B981' : overallMargin >= 15 ? '#D97706' : '#DC2626') + '22',
                  color: necesitaTC ? '#888' : overallMargin >= 25 ? '#10B981' : overallMargin >= 15 ? '#D97706' : '#DC2626',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >MG Real {necesitaTC ? '—' : overallMargin + '%'}</button>
              {showBulkMargin && (
                <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 30, background: '#141414', border: '1px solid #333', borderRadius: 10, padding: 12, minWidth: 320, boxShadow: '0 10px 30px rgba(0,0,0,0.6)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Ajustar margen real del proyecto</div>
                  <div style={{ fontSize: 10, color: '#888', marginBottom: 8, lineHeight: 1.5 }}>
                    Escala precios proporcionalmente para que <b style={{ color: '#D97706' }}>MG Real</b> (revenue billed − costo − nómina <b style={{ color: '#D97706' }}>{ilumConfig.nominaPct}%</b>) llegue al target.
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="number" step={0.5} min={0} max={99.9}
                      value={bulkMarginInput}
                      onChange={e => setBulkMarginInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { applyBulkMargin(parseFloat(bulkMarginInput)); setShowBulkMargin(false) } }}
                      placeholder="ej. 35"
                      style={{ ...S.input, flex: 1, fontSize: 12, textAlign: 'right' }}
                      autoFocus
                    />
                    <span style={{ fontSize: 11, color: '#888' }}>%</span>
                    <button
                      onClick={() => { applyBulkMargin(parseFloat(bulkMarginInput)); setShowBulkMargin(false) }}
                      style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, background: '#10B98122', border: '1px solid #10B981', color: '#10B981', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
                    >Aplicar</button>
                    <button
                      onClick={() => setShowBulkMargin(false)}
                      style={{ padding: '5px 8px', fontSize: 11, background: 'none', border: '1px solid #333', color: '#888', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
                    >Cancelar</button>
                  </div>
                  <div style={{ fontSize: 9, color: '#555', marginTop: 6 }}>
                    Actual: {overallMargin}% · Target: {bulkMarginInput || '—'}% · Desc: {ilumConfig.descuento}% · Nóm: {ilumConfig.nominaPct}%
                  </div>
                </div>
              )}
            </div>
          )}
          <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: '#10B981' }}>{simbolo(monedaCot)}{fmt(grandTotal)} {monedaCot}</div>
          </div>
        </div>

        {/* ── Moneda de venta y tipo de cambio ─────────────────────────────
            Iluminación no tenía dónde declarar esto, así que el editor no
            sabía en qué moneda estaba cobrando: los productos entraban con el
            número del catálogo tal cual y una cotización en dólares terminaba
            sumando pesos. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', marginTop: 8, background: '#0f0f0f', border: '1px solid ' + (necesitaTC ? '#DC2626' : '#1f1f1f'), borderRadius: 8 }}>
          <span style={{ fontSize: 9.5, color: '#666', textTransform: 'uppercase', letterSpacing: '.06em' }}>Se cobra en</span>
          {(['MXN', 'USD'] as Moneda[]).map(m => (
            <button key={m} onClick={() => convertirMonedaCotizacion(m)}
              style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                border: '1px solid ' + (monedaCot === m ? '#10B981' : '#333'),
                background: monedaCot === m ? '#10B98122' : 'transparent',
                color: monedaCot === m ? '#10B981' : '#666',
              }}>{m}</button>
          ))}
          <span style={{ fontSize: 9.5, color: '#666', textTransform: 'uppercase', letterSpacing: '.06em', marginLeft: 6 }}>Tipo de cambio</span>
          <input type="number" step={0.01} value={tcCot || ''} placeholder={tcSugerido.toFixed(2)}
            onChange={e => setTcCot(parseFloat(e.target.value) || 0)}
            onBlur={e => guardarMoneda({ tipoCambio: parseFloat(e.target.value) || 0 })}
            style={{ ...S.input, width: 80, fontSize: 11, textAlign: 'right' }} />
          <span style={{ fontSize: 9.5, color: '#666' }}>MXN por dólar</span>
          {/* El TC se sugiere pero NUNCA se aplica solo: un tipo de cambio que
              nadie eligió es justo el tipo de suposición silenciosa que dejó
              cotizaciones con pesos contados como dólares. */}
          {!tcCot && (
            <button onClick={() => guardarMoneda({ tipoCambio: tcSugerido })}
              style={{ padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #333', background: 'transparent', color: '#888' }}>
              Usar {tcSugerido}
            </button>
          )}
          {necesitaTC ? (
            <span style={{ fontSize: 10, color: '#DC2626', fontWeight: 600, marginLeft: 'auto' }}>
              Hay {productosCruzados} producto(s) costeados en la otra moneda. Captura el tipo de cambio para poder convertir su precio de venta.
            </span>
          ) : productosCruzados > 0 ? (
            <span style={{ fontSize: 10, color: '#888', marginLeft: 'auto' }}>
              {productosCruzados} producto(s) costeados en la otra moneda, convertidos a {monedaCot} al TC {tcCot}.
            </span>
          ) : null}
        </div>

        {/* Subsection Presets */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: isMobile ? 4 : 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {SUBSECTION_PRESETS.map(preset => {
              const exists = subsections.some(s => s.name === preset)
              return (
                <button
                  key={preset}
                  onClick={() => !exists && addSubsection(preset)}
                  disabled={exists}
                  style={{
                    padding: '6px 12px', borderRadius: 6, fontSize: isMobile ? 10 : 11, fontWeight: 600, fontFamily: 'inherit',
                    background: exists ? '#10B98133' : '#1a1a1a', border: exists ? '1px solid #10B981' : '1px solid #333',
                    color: exists ? '#10B981' : '#666', cursor: exists ? 'default' : 'pointer', opacity: exists ? 1 : 0.6,
                  }}
                >
                  {preset}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text" value={customSubInput} onChange={e => setCustomSubInput(e.target.value)} placeholder="Nombre personalizado..."
              onKeyDown={e => e.key === 'Enter' && addSubsection(customSubInput)}
              style={{ flex: 1, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', color: '#ccc', fontSize: 12, fontFamily: 'inherit' }}
            />
            <Btn size="sm" onClick={() => addSubsection(customSubInput)}>Agregar</Btn>
          </div>
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', marginBottom: 12,
            background: '#10B98111', border: '1px solid #10B98133', borderRadius: 10, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#10B981' }}>{selectedIds.size} sel.</span>
            <span style={{ width: 1, height: 16, background: '#333' }} />
            <button onClick={syncSelectedWithCatalog} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, background: '#2563EB22', border: '1px solid #2563EB44', color: '#2563EB', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
              <RefreshCw size={11} /> Sync catálogo
            </button>
            <button onClick={bulkDeleteSelected} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, background: '#DC262622', border: '1px solid #DC262644', color: '#DC2626', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Trash2 size={11} /> Eliminar
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setSelectedIds(new Set())} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
              Deseleccionar
            </button>
          </div>
        )}

        {/* Subsections */}
        {subsections.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#555' }}>Agrega una subsección para comenzar</div>
        ) : (
          subsections.map(sub => (
            <div key={sub.id} style={{ marginBottom: 16 }}>
              <SubsectionBlock
                monedaCot={monedaCot}
                subsection={sub}
                products={products.filter(p => p.subsectionId === sub.id)}
                onToggle={() => toggleSubsection(sub.id)}
                onUpdate={updateProduct}
                onRemove={removeProduct}
                onAdd={() => setCatalogModal({ open: true, subsectionId: sub.id })}
                allProducts={products}
                selectedIds={selectedIds}
                onToggleSelect={toggleProductSelect}
                onSelectAll={selectAllProducts}
                onSubstitute={(p) => setSubstitutingProduct(p)}
                tcCot={tcCot}
                onAddBundle={() => setBundlePicker(sub.id)}
                onBundleQty={cambiarCantidadBundle}
                onDesagrupar={desagrupar}
                onGuardarComoBundle={guardandoBundle === sub.id ? undefined : () => guardarSeccionComoBundle(sub.id)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px', gap: 20 }}>
                <button
                  onClick={() => removeSubsection(sub.id)}
                  style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}
                >
                  Eliminar
                </button>
                <span style={{ fontSize: 11, color: '#555' }}>SUBTOTAL <span style={{ fontWeight: 700, color: '#fff', marginLeft: 8 }}>${fmt(subsectionTotals[sub.id] || 0)}</span></span>
              </div>
            </div>
          ))
        )}

        {/* Summary Footer */}
        <div style={{ marginTop: 30, padding: '20px', background: '#111', borderRadius: 10, borderTop: '2px solid #10B981' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: isMobile ? 20 : 40, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Config inputs */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ fontSize: 10, color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
                IVA %
                <input type="number" value={ilumConfig.ivaRate} step={1} min={0}
                  onChange={e => updateIlumConfig('ivaRate', parseFloat(e.target.value) || 0)}
                  style={{ width: 50, padding: '4px 6px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }} />
              </label>
              <label style={{ fontSize: 10, color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
                Desc %
                <input type="number" value={ilumConfig.descuento} step={1} min={0} max={100}
                  onChange={e => updateIlumConfig('descuento', parseFloat(e.target.value) || 0)}
                  style={{ width: 50, padding: '4px 6px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }} />
              </label>
            </div>
            {/* Breakdown */}
            <div style={{ minWidth: 200 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 4 }}>
                <span>Subtotal</span>
                <span style={{ color: '#ccc' }}>${fmt(subtotal)}</span>
              </div>
              {(ilumConfig.descuento || 0) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#D97706', marginBottom: 4 }}>
                  <span>Descuento {ilumConfig.descuento}%</span>
                  <span>-${fmt(descuentoAmt)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 8 }}>
                <span>IVA {ilumConfig.ivaRate}%</span>
                <span style={{ color: '#ccc' }}>${fmt(ivaAmt)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, borderTop: '1px solid #333', paddingTop: 8 }}>
                <span style={{ color: '#10B981' }}>TOTAL</span>
                <span style={{ color: '#10B981' }}>${fmt(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Análisis Interno — margen real con nómina y descuento */}
          <div style={{ marginTop: 16, padding: 12, background: '#1a1414', border: '1px solid #332222', borderRadius: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Análisis Interno</div>
            {/* Sin tipo de cambio no se puede restar un costo en pesos de una
                venta en dólares. Antes se restaba de todos modos y salía un
                MG real de −404%, que no es un margen: es una resta de dos
                monedas distintas. Más vale no dar el número que darlo mal. */}
            {necesitaTC ? (
              <div style={{ fontSize: 11, color: '#DC2626', lineHeight: 1.6 }}>
                No se puede calcular el margen todavía: {productosCruzados} producto(s) están costeados en {monedaCot === 'USD' ? 'pesos' : 'dólares'} y esta cotización se cobra en {monedaCot}. Captura el tipo de cambio arriba y aparece.
              </div>
            ) : (() => {
              let vtProd = 0, ctProd = 0
              products.forEach(p => {
                // Costo convertido a la moneda de venta: aquí es donde salía
                // el −384%, restando pesos de una venta en dólares.
                const c = calcLine(p, monedaCot, tcCot)
                vtProd += p.price * p.quantity
                ctProd += c.costReal * p.quantity
              })
              const mgProd = vtProd > 0 ? Math.round((vtProd - ctProd) / vtProd * 100) : 0
              const descPct = ilumConfig.descuento || 0
              const descFactor = 1 - descPct / 100
              const descMonto = vtProd * (descPct / 100)
              const vtBilled = vtProd * descFactor
              const nomPct = ilumConfig.nominaPct || 0
              const nomina = vtBilled * nomPct / 100
              const mgBruto = vtBilled > 0 ? Math.round((vtBilled - ctProd) / vtBilled * 1000) / 10 : 0
              const mgReal = vtBilled > 0 ? Math.round((vtBilled - ctProd - nomina) / vtBilled * 1000) / 10 : 0
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>Venta productos (listprice)</span><span style={{ color: '#fff', fontWeight: 600 }}>${fmt(vtProd)}</span></div>
                    {descPct > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}>
                        <span style={{ color: '#DC2626' }}>− Descuento {descPct}%</span>
                        <span style={{ color: '#DC2626' }}>−${fmt(descMonto)}</span>
                      </div>
                    )}
                    {descPct > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 10, fontWeight: 600, borderTop: '1px solid #332222', marginTop: 3, paddingTop: 5 }}>
                        <span style={{ color: '#ccc' }}>Revenue billed</span>
                        <span style={{ color: '#fff' }}>${fmt(vtBilled)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10, marginTop: 4 }}><span style={{ color: '#888' }}>− Costo productos</span><span style={{ color: '#DC2626' }}>−${fmt(ctProd)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}>
                      <span style={{ color: '#888', display: 'flex', alignItems: 'center', gap: 4 }}>
                        − Nómina
                        <input
                          type="number" value={nomPct} step={1} min={0} max={50}
                          onChange={e => updateIlumConfig('nominaPct', Math.max(0, Math.min(50, parseFloat(e.target.value) || 0)))}
                          title="% del revenue billed para gastos de nómina (área + administración) — placeholder 20%"
                          style={{ width: 45, padding: '2px 4px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 10, fontWeight: 600, fontFamily: 'inherit', textAlign: 'right' }}
                        />
                        <span style={{ fontSize: 9, color: '#555' }}>%</span>
                      </span>
                      <span style={{ color: '#DC2626' }}>−${fmt(nomina)}</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}>
                      <span style={{ color: '#888' }}>MG productos</span>
                      <span style={{ color: mgProd >= 25 ? '#10B981' : mgProd >= 15 ? '#D97706' : '#DC2626', fontWeight: 600 }}>{mgProd}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}>
                      <span style={{ color: '#888' }}>MG bruto{descPct > 0 ? ' (c/ desc)' : ''}</span>
                      <span style={{ color: '#aaa', fontWeight: 600 }}>{mgBruto}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderTop: '1px solid #332222', marginTop: 4, paddingTop: 6 }}>
                      <span style={{ color: '#D97706', fontWeight: 700 }}>MG real (c/ nómina{descPct > 0 ? ' y desc' : ''})</span>
                      <span style={{ color: mgReal >= 25 ? '#10B981' : mgReal >= 15 ? '#D97706' : '#DC2626', fontWeight: 700, fontSize: 15 }}>{mgReal}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>Utilidad real</span><span style={{ color: mgReal >= 0 ? '#10B981' : '#DC2626', fontWeight: 600 }}>${fmt(vtBilled - ctProd - nomina)}</span></div>
                    <div style={{ fontSize: 8, color: '#555', marginTop: 6, lineHeight: 1.4 }}>
                      MG productos = sin desc. MG bruto = con desc, sin nómina. MG real = con desc y nómina prorrateada. % nómina editable.
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Catalog Modal */}
      {catalogModal?.open && (
        <IlumCatalogModal
          onClose={() => setCatalogModal(null)}
          onSelect={p => addProductFromCatalog(catalogModal.subsectionId, p)}
          subsectionName={subsections.find(s => s.id === catalogModal.subsectionId)?.name || ''}
        />
      )}

      {bundlePicker && (
        <BundlePicker
          onClose={() => setBundlePicker(null)}
          onInsert={(b, qty) => insertarBundleEnSeccion(bundlePicker, b, qty)}
          subsectionName={subsections.find(s => s.id === bundlePicker)?.name || ''}
        />
      )}

      {/* Editar datos de la cotización (cliente, lead, proyecto) */}
      {showEditInfo && quote && (
        <EditCotInfoModal
          cotId={cotId}
          name={quote.name}
          clientName={quote.client_name || ''}
          projectId={quote.project_id || null}
          onClose={() => setShowEditInfo(false)}
          onSaved={(name, client, projId) => {
            setQuote(q => q ? { ...q, name, client_name: client, project_id: projId || null } : q)
            setShowEditInfo(false)
          }}
        />
      )}

      {/* Substitute Modal */}
      {substitutingProduct && (
        <IlumCatalogModal
          onClose={() => setSubstitutingProduct(null)}
          onSelect={p => substituteProduct(substitutingProduct, p)}
          subsectionName={`Sustituir: ${substitutingProduct.name} (${products.filter(p => p.catalogId === substitutingProduct.catalogId).length} ubicaciones)`}
        />
      )}

      {/* AI Import Modal */}
      {showAIImport && (
        <AIImportModalIlum
          cotId={cotId}
          subsections={subsections}
          onClose={() => setShowAIImport(false)}
          onImported={() => {
            // Reload data
            async function reload() {
              const { data: subsData } = await supabase.from('quotation_areas').select('*').eq('quotation_id', cotId).order('order_index')
              if (subsData) setSubsections(subsData.map((s: any) => ({ ...s, collapsed: false })))
              const { data: prodData } = await supabase.from('quotation_items').select('*').eq('quotation_id', cotId).order('order_index')
              if (prodData) {
                const prods = prodData.map((p: any) => {
                  let notes: any = {}; try { notes = JSON.parse(p.notes || '{}') } catch {}
                  return { id: p.id, subsectionId: p.area_id, catalogId: p.catalog_product_id, name: p.name, description: p.description || '', imageUrl: p.image_url, quantity: p.quantity || 1, cost: p.cost || 0, markup: p.markup || 0, price: p.price || 0, order: p.order_index || 0, marca: p.marca, modelo: p.modelo, sku: p.sku, watts: notes.watts || null, lumens: notes.lumens || null, cct: notes.cct || null }
                })
                setProducts(prods)
              }
            }
            reload()
          }}
        />
      )}

      {/* PDF format picker */}
      {showPdfPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1030, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#141414', border: '1px solid #333', borderRadius: isMobile ? 0 : 16, padding: isMobile ? 12 : 24, width: isMobile ? '100vw' : 620, maxWidth: isMobile ? 'none' : '92vw', height: isMobile ? '100vh' : 'auto', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={16} color="#06B6D4" /> Exportar a PDF — Iluminación
              </div>
              <button onClick={() => setShowPdfPicker(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 18 }}>Elige el formato. Cada uno abre en una pestaña nueva con vista previa imprimible.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              {([
                { id: 'ejecutivo', icon: '📄', title: 'Ejecutivo', desc: 'Para cliente final. Diseño formal, sin costos internos ni markups. La versión que mandas por email.' },
                { id: 'tecnico', icon: '🔧', title: 'Técnico detallado', desc: 'Para ingeniería. Incluye SKUs, proveedores, costos internos y markups. Uso interno o cliente técnico.' },
                { id: 'lista', icon: '📋', title: 'Lista de precios', desc: 'Tabla simple sin agrupar. Ideal para comparar precios rápido.' },
              ] as const).map(opt => (
                <button key={opt.id} onClick={() => { window.open('/cotizacion/' + cotId + '/pdf/' + opt.id, '_blank'); setShowPdfPicker(false) }}
                  style={{ padding: '14px 16px', background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 10, cursor: 'pointer', textAlign: 'left', color: '#ddd', fontFamily: 'inherit', display: 'flex', gap: 12, alignItems: 'center' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#06B6D4'; e.currentTarget.style.background = '#0e1419' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.background = '#0e0e0e' }}>
                  <div style={{ fontSize: 24 }}>{opt.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{opt.title}</div>
                    <div style={{ fontSize: 11, color: '#888', lineHeight: 1.4 }}>{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
