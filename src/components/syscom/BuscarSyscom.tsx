// Buscar en Syscom (2026-11-14).
//
// Busca en la API de Syscom (precio OMM de contado, sin IVA, y existencia) y
// deja usar el producto:
//   · si ya está en el catálogo (mismo modelo, o ya ligado) → "Usar este";
//   · si no → "Agregar al catálogo": se da de alta con proveedor Syscom, costo
//     en USD y el margen que se elija, y queda ligado para la revisión
//     nocturna de precios.
// onElegir recibe la fila completa de catalog_products, la misma forma que
// usan los cotizadores al agregar desde el catálogo.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Btn } from '../layout/UI'
import { useIsMobile } from '../../lib/useIsMobile'
import { X, Search, Loader2, Plus, Check, ExternalLink } from 'lucide-react'
import {
  ProductoSyscom, buscarSyscom, ligarSyscom, claveModelo, textoExistencia, colorExistencia,
  SYSCOM_SUPPLIER_ID, SYSCOM_PROVIDER,
} from '../../lib/syscom'

// Valores del enum product_system.
const SISTEMAS = ['Redes', 'CCTV', 'Audio', 'Acceso', 'Control de acceso', 'Iluminacion', 'Control de iluminacion', 'Lutron', 'Somfy', 'Humo', 'Telefonia', 'Celular', 'BMS', 'Electrico', 'Cortinas', 'General']

interface EnCatalogo { id: string; modelo: string | null; sku: string | null }

export default function BuscarSyscom({ onClose, onElegir, sistema = 'General', especialidad = 'esp', textoElegir = 'Usar este', inicial = '' }: {
  onClose: () => void
  onElegir?: (producto: any) => void
  sistema?: string
  especialidad?: string
  textoElegir?: string
  inicial?: string
}) {
  const isMobile = useIsMobile()
  const [q, setQ] = useState(inicial)
  const [res, setRes] = useState<ProductoSyscom[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [paginas, setPaginas] = useState(1)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')
  const [enCat, setEnCat] = useState<Map<string, string>>(new Map()) // clave modelo → catalog id
  const [porSyscomId, setPorSyscomId] = useState<Map<string, string>>(new Map())
  const [alta, setAlta] = useState<ProductoSyscom | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ;(async () => {
      const m = new Map<string, string>()
      for (let desde = 0; ; desde += 1000) {
        const { data } = await supabase.from('catalog_products').select('id, modelo, sku')
          .or(`supplier_id.eq.${SYSCOM_SUPPLIER_ID},provider.ilike."${SYSCOM_PROVIDER}%"`)
          .or('is_active.is.null,is_active.eq.true').range(desde, desde + 999)
        for (const p of (data || []) as EnCatalogo[]) {
          if (p.modelo) m.set(claveModelo(p.modelo), p.id)
          if (p.sku && !m.has(claveModelo(p.sku))) m.set(claveModelo(p.sku), p.id)
        }
        if (!data || data.length < 1000) break
      }
      setEnCat(m)
      const { data: lig } = await supabase.from('syscom_precios').select('catalog_product_id, syscom_id').not('syscom_id', 'is', null)
      setPorSyscomId(new Map((lig || []).map((r: any) => [String(r.syscom_id), r.catalog_product_id])))
    })()
    if (inicial.trim().length >= 2) buscar(1)
  }, [])

  async function buscar(pag = 1) {
    if (q.trim().length < 2) return
    setBuscando(true); setError('')
    try {
      const r = await buscarSyscom(q.trim(), pag)
      setRes(pag === 1 ? r.productos : [...res, ...r.productos]); setTotal(r.total); setPagina(pag); setPaginas(r.paginas)
    } catch (e: any) { setError(e.message) }
    setBuscando(false)
  }

  const idEnCatalogo = (sp: ProductoSyscom) => porSyscomId.get(sp.id) || enCat.get(claveModelo(sp.modelo)) || null

  async function usar(catId: string) {
    const { data, error: e } = await supabase.from('catalog_products').select('*').eq('id', catId).single()
    if (e || !data) { setError('No se pudo leer el producto del catálogo'); return }
    onElegir?.(data)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1160, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 0 : 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#141414', border: isMobile ? 'none' : '1px solid #2a2a2a', borderRadius: isMobile ? 0 : 12, width: isMobile ? '100vw' : 'min(860px, 100%)', height: isMobile ? '100dvh' : '84vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
        <div style={{ padding: isMobile ? '12px' : '16px 20px', borderBottom: '1px solid #222' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, fontSize: isMobile ? 15 : 16, fontWeight: 700, color: '#fff' }}>Buscar en Syscom</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 4 }}><X size={18} /></button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#555' }} />
              <input ref={ref} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') buscar(1) }}
                placeholder="Modelo o nombre: U7-PRO, cámara bala 4MP, NK688…"
                style={{ width: '100%', boxSizing: 'border-box', background: '#111', border: '1px solid #333', borderRadius: 8, padding: '8px 10px 8px 32px', color: '#fff', fontSize: isMobile ? 16 : 13, fontFamily: 'inherit', outline: 'none' }} />
            </div>
            <Btn variant="primary" onClick={() => buscar(1)} disabled={buscando || q.trim().length < 2}>
              {buscando ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : 'Buscar'}
            </Btn>
          </div>
          <div style={{ fontSize: 10.5, color: '#666', marginTop: 6 }}>Precio OMM de contado (con descuento financiero), en dólares y sin IVA.{total ? ` ${total} resultados.` : ''}</div>
          {error && <div style={{ fontSize: 11, color: '#F87171', marginTop: 6 }}>{error}</div>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {!buscando && res.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: '#555', fontSize: 12 }}>{q.trim().length >= 2 && total === 0 && pagina === 1 && !error ? 'Escribe y presiona Buscar.' : ''}</div>
          )}
          {res.map(sp => {
            const cid = idEnCatalogo(sp)
            return (
              <div key={sp.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: isMobile ? '10px 12px' : '10px 20px', borderBottom: '1px solid #1c1c1c' }}>
                {sp.imagen
                  ? <img src={sp.imagen} alt="" style={{ width: isMobile ? 44 : 52, height: isMobile ? 44 : 52, objectFit: 'contain', background: '#fff', borderRadius: 6, flexShrink: 0 }} />
                  : <div style={{ width: 52, height: 52, background: '#1e1e1e', borderRadius: 6, flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: '#eee', fontWeight: 700 }}>{sp.modelo} <span style={{ color: '#777', fontWeight: 400 }}>· {sp.marca}</span></div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isMobile ? 'nowrap' : 'normal', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{sp.titulo}</div>
                  <div style={{ fontSize: 10.5, marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ color: colorExistencia(sp.existencia) }}>{textoExistencia(sp.existencia)}</span>
                    {sp.link && <a href={sp.link} target="_blank" rel="noreferrer" style={{ color: '#666', display: 'inline-flex', alignItems: 'center', gap: 2 }}><ExternalLink size={10} /> syscom.mx</a>}
                    {cid && <span style={{ color: '#10B981', display: 'inline-flex', alignItems: 'center', gap: 2 }}><Check size={10} /> Ya está en el catálogo</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{sp.precio_descuento != null ? 'US$' + sp.precio_descuento.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : <span style={{ fontSize: 10, color: '#888' }}>{sp.sin_precio || 'Sin precio'}</span>}</div>
                  {cid
                    ? (onElegir ? <Btn size="sm" variant="primary" onClick={() => usar(cid)}>{textoElegir}</Btn> : null)
                    : <Btn size="sm" variant={onElegir ? 'primary' : 'default'} disabled={sp.precio_descuento == null} onClick={() => setAlta(sp)}><Plus size={11} /> {onElegir ? 'Agregar' : 'Al catálogo'}</Btn>}
                </div>
              </div>
            )
          })}
          {pagina < paginas && res.length > 0 && (
            <div style={{ padding: 14, textAlign: 'center' }}>
              <Btn size="sm" onClick={() => buscar(pagina + 1)} disabled={buscando}>{buscando ? 'Cargando…' : 'Ver más resultados'}</Btn>
            </div>
          )}
        </div>
      </div>

      {alta && (
        <AltaCatalogo sp={alta} sistema={sistema} especialidad={especialidad} conElegir={!!onElegir}
          onCancelar={() => setAlta(null)}
          onCreado={(prod) => {
            setEnCat(m => { const n = new Map(m); n.set(claveModelo(prod.modelo), prod.id); return n })
            setPorSyscomId(m => { const n = new Map(m); n.set(alta.id, prod.id); return n })
            setAlta(null)
            onElegir?.(prod)
          }} />
      )}
    </div>
  )
}

function AltaCatalogo({ sp, sistema, especialidad, conElegir, onCancelar, onCreado }: {
  sp: ProductoSyscom; sistema: string; especialidad: string; conElegir: boolean
  onCancelar: () => void; onCreado: (prod: any) => void
}) {
  const isMobile = useIsMobile()
  const [nombre, setNombre] = useState(sp.titulo.slice(0, 200))
  const [sis, setSis] = useState(SISTEMAS.includes(sistema) ? sistema : 'General')
  const [margen, setMargen] = useState(35)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const costo = sp.precio_descuento || 0
  const venta = margen > 0 && margen < 100 ? Math.round(costo / (1 - margen / 100) * 100) / 100 : costo

  async function guardar() {
    if (!nombre.trim()) { setError('Ponle nombre'); return }
    setGuardando(true); setError('')
    const { data, error: e } = await supabase.from('catalog_products').insert({
      name: nombre.trim(), description: sp.titulo || null, marca: sp.marca || null, modelo: sp.modelo, sku: sp.modelo,
      provider: SYSCOM_PROVIDER, supplier_id: SYSCOM_SUPPLIER_ID,
      system: sis, type: 'material', specialty: especialidad,
      unit: 'pza', clave_unidad: 'H87', cost: costo, moneda: 'USD', markup: margen, precio_venta: venta, iva_rate: 0.16,
      image_url: sp.imagen, is_active: true, precio_actualizado_at: new Date().toISOString(),
    }).select('*').single()
    if (e || !data) { setError('No se pudo dar de alta: ' + (e?.message || 'sin respuesta')); setGuardando(false); return }
    // Queda ligado para la revisión nocturna. Si esto falla, el producto ya
    // existe y la revisión lo encontrará por modelo: no se detiene el alta.
    try { await ligarSyscom(data.id, sp.id) } catch (_) { /* se liga solo en la noche */ }
    onCreado(data)
  }

  const iS: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#111', border: '1px solid #333', borderRadius: 8, padding: '7px 10px', color: '#fff', fontSize: isMobile ? 16 : 12, fontFamily: 'inherit', outline: 'none' }
  return (
    <div onClick={e => { e.stopPropagation(); onCancelar() }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1170, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#181818', border: '1px solid #2a2a2a', borderRadius: isMobile ? '14px 14px 0 0' : 12, padding: 18, width: isMobile ? '100vw' : 440, boxSizing: 'border-box' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Agregar al catálogo</div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{sp.modelo} · {sp.marca} · proveedor Syscom</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          <label style={{ fontSize: 11, color: '#888' }}>Nombre<input value={nombre} onChange={e => setNombre(e.target.value)} style={{ ...iS, marginTop: 4 }} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
            <label style={{ fontSize: 11, color: '#888' }}>Sistema
              <select value={sis} onChange={e => setSis(e.target.value)} style={{ ...iS, marginTop: 4 }}>{SISTEMAS.map(s => <option key={s} value={s}>{s}</option>)}</select>
            </label>
            <label style={{ fontSize: 11, color: '#888' }}>Margen %
              <input type="number" value={margen} onChange={e => setMargen(parseFloat(e.target.value) || 0)} style={{ ...iS, marginTop: 4 }} />
            </label>
          </div>
          <div style={{ fontSize: 12, color: '#bbb', background: '#111', borderRadius: 8, padding: '8px 10px' }}>
            Costo US${costo.toFixed(2)} → venta <b style={{ color: '#10B981' }}>US${venta.toFixed(2)}</b> <span style={{ color: '#666' }}>(sin IVA)</span>
          </div>
          {error && <div style={{ fontSize: 11, color: '#F87171' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn onClick={onCancelar}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : conElegir ? 'Agregar y usar' : 'Agregar al catálogo'}</Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
