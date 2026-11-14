// Precios de Syscom contra el catálogo (2026-11-14).
//
// Cada noche la Edge Function `syscom` revisa los productos de Syscom del
// catálogo y deja el resultado en syscom_precios. Aquí se decide:
//   · Diferencias → "Actualizar costo" (syscom_aplicar_precios) o "Ignorar".
//     Nada se cambia solo: así lo pidió Elias.
//   · Por ligar → productos que no se encontraron por modelo exacto; se ligan
//     a mano con uno de los candidatos o buscando en Syscom.
// Actualizar el costo no toca cotizaciones ya hechas: sólo las nuevas.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Btn } from '../layout/UI'
import { useIsMobile } from '../../lib/useIsMobile'
import { X, RefreshCw, Loader2, Search, Link2, ExternalLink } from 'lucide-react'
import {
  FilaPrecioSyscom, ProductoSyscom, sincronizarSyscom, ligarSyscom, buscarSyscom,
  textoExistencia, colorExistencia,
} from '../../lib/syscom'

interface ProdLigado { id: string; name: string; modelo: string | null; sku: string | null; cost: number | null; moneda: string | null; markup: number | null; precio_venta: number | null; image_url: string | null; specialty: string | null; costo_mano_obra: number | null }
interface Fila extends FilaPrecioSyscom { producto: ProdLigado | null }

type Pestana = 'distinto' | 'ligar' | 'sin_costo' | 'ignorado' | 'igual'

const money = (n: number | null | undefined, mon = 'USD') =>
  n == null ? '—' : (mon === 'MXN' ? '$' : 'US$') + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function pct(f: Fila): number | null {
  const c = Number(f.producto?.cost ?? f.costo_catalogo) || 0
  if (!c || f.precio_comparable == null) return null
  return (Number(f.precio_comparable) - c) / c * 100
}

function ventaNueva(f: Fila): number | null {
  const p = f.producto
  if (!p || f.precio_comparable == null) return null
  const m = Number(p.markup) || 0
  if (!(m > 0 && m < 100)) return null
  const base = Number(f.precio_comparable) + (p.specialty === 'elec' ? Number(p.costo_mano_obra) || 0 : 0)
  return Math.round(base / (1 - m / 100) * 100) / 100
}

export default function PreciosSyscom({ onClose, onCambio }: { onClose: () => void; onCambio?: () => void }) {
  const isMobile = useIsMobile()
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [pestana, setPestana] = useState<Pestana>('distinto')
  const [sentido, setSentido] = useState<'todos' | 'sube' | 'baja'>('todos')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [trabajando, setTrabajando] = useState('')
  const [aviso, setAviso] = useState('')

  async function cargar() {
    setCargando(true); setError('')
    const todas: Fila[] = []
    for (let desde = 0; ; desde += 1000) {
      const { data, error: e } = await supabase.from('syscom_precios')
        .select('*, producto:catalog_products(id,name,modelo,sku,cost,moneda,markup,precio_venta,image_url,specialty,costo_mano_obra)')
        .order('catalog_product_id').range(desde, desde + 999)
      if (e) { setError(e.message); break }
      todas.push(...((data || []) as any))
      if (!data || data.length < 1000) break
    }
    setFilas(todas.filter(f => f.producto))
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const cuenta = useMemo(() => ({
    distinto: filas.filter(f => f.estado === 'distinto').length,
    ligar: filas.filter(f => f.estado === 'no_encontrado' || f.estado === 'ambiguo').length,
    ignorado: filas.filter(f => f.estado === 'ignorado').length,
    sin_costo: filas.filter(f => f.estado === 'sin_costo').length,
    igual: filas.filter(f => f.estado === 'igual').length,
    otros: filas.filter(f => f.estado === 'sin_precio' || f.estado === 'error').length,
  }), [filas])

  const ultima = useMemo(() => {
    let m = 0
    for (const f of filas) { const t = f.consultado_at ? new Date(f.consultado_at).getTime() : 0; if (t > m) m = t }
    return m ? new Date(m) : null
  }, [filas])

  const visibles = useMemo(() => {
    let l: Fila[]
    if (pestana === 'ligar') l = filas.filter(f => f.estado === 'no_encontrado' || f.estado === 'ambiguo')
    else l = filas.filter(f => f.estado === pestana)
    if (pestana === 'distinto' && sentido !== 'todos') l = l.filter(f => { const p = pct(f) ?? 0; return sentido === 'sube' ? p > 0 : p < 0 })
    if (pestana === 'distinto' || pestana === 'ignorado') l = [...l].sort((a, b) => Math.abs(pct(b) ?? 0) - Math.abs(pct(a) ?? 0))
    else l = [...l].sort((a, b) => String(a.producto?.name).localeCompare(String(b.producto?.name)))
    return l
  }, [filas, pestana, sentido])

  async function revisarAhora() {
    setTrabajando('revisar'); setAviso(''); setError('')
    const desde = new Date().toISOString()
    try {
      for (let vuelta = 0; vuelta < 10; vuelta++) {
        const r = await sincronizarSyscom(desde)
        setAviso(`Revisando… ${r.revisar - r.pendientes} de ${r.revisar}`)
        if (r.pendientes <= 0) { setAviso(`Listo: se revisaron ${r.revisar} productos.`); break }
      }
    } catch (e: any) { setError('No se pudo revisar: ' + e.message) }
    await cargar()
    setTrabajando('')
  }

  async function aplicar(ids: string[]) {
    if (!ids.length) return
    if (!confirm(`¿Actualizar el costo de ${ids.length} producto(s) al precio de Syscom?\n\nEl precio de venta del catálogo se recalcula con su mismo margen. Las cotizaciones ya hechas no cambian.`)) return
    setTrabajando('aplicar'); setError('')
    const { data, error: e } = await supabase.rpc('syscom_aplicar_precios', { p_ids: ids })
    if (e) setError('No se pudo actualizar: ' + e.message)
    else { setAviso(`Se actualizó el costo de ${data} producto(s).`); onCambio?.() }
    setSel(new Set()); await cargar(); setTrabajando('')
  }

  async function ignorar(ids: string[]) {
    if (!ids.length) return
    setTrabajando('ignorar'); setError('')
    const { data, error: e } = await supabase.rpc('syscom_ignorar_precios', { p_ids: ids })
    if (e) setError('No se pudo ignorar: ' + e.message)
    else setAviso(`${data} diferencia(s) ignorada(s). Regresan si Syscom vuelve a cambiar el precio.`)
    setSel(new Set()); await cargar(); setTrabajando('')
  }

  async function ligar(f: Fila, sp: ProductoSyscom) {
    setTrabajando('ligar:' + f.catalog_product_id); setError('')
    try { await ligarSyscom(f.catalog_product_id, sp.id); setAviso(`${f.producto?.name} quedó ligado a ${sp.modelo}.`) }
    catch (e: any) { setError('No se pudo ligar: ' + e.message) }
    await cargar(); setTrabajando('')
  }

  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  // "Todos" deja fuera las diferencias de 50% o más: casi siempre son moneda o
  // unidad mal capturada (p. ej. un costo en pesos marcado USD) y conviene verlas una por una.
  const seleccionables = visibles.filter(f => pestana !== 'distinto' || Math.abs(pct(f) ?? 0) < 50)
  const todosSel = seleccionables.length > 0 && seleccionables.every(f => sel.has(f.catalog_product_id))
  const selEnVista = visibles.filter(f => sel.has(f.catalog_product_id)).map(f => f.catalog_product_id)

  const PEST: { k: Pestana; label: string; n: number }[] = [
    { k: 'distinto', label: 'Diferencias', n: cuenta.distinto },
    { k: 'ligar', label: 'Por ligar', n: cuenta.ligar },
    { k: 'sin_costo', label: 'Sin costo en catálogo', n: cuenta.sin_costo },
    { k: 'ignorado', label: 'Ignoradas', n: cuenta.ignorado },
    { k: 'igual', label: 'Al día', n: cuenta.igual },
  ]

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1150, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 0 : 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#141414', border: isMobile ? 'none' : '1px solid #2a2a2a', borderRadius: isMobile ? 0 : 12, width: isMobile ? '100vw' : 'min(1100px, 100%)', height: isMobile ? '100dvh' : '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
        {/* Encabezado */}
        <div style={{ padding: isMobile ? '12px 12px 10px' : '16px 20px 12px', borderBottom: '1px solid #222' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 700, color: '#fff' }}>Precios de Syscom</div>
              <div style={{ fontSize: 11, color: '#777', marginTop: 3 }}>
                Costo OMM de contado, sin IVA. {ultima ? `Última revisión: ${ultima.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Todavía no se ha revisado.'} Se revisa solo cada noche.
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 4 }}><X size={18} /></button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Btn size="sm" onClick={revisarAhora} disabled={!!trabajando}>
              {trabajando === 'revisar' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />} Revisar ahora
            </Btn>
            {aviso && <span style={{ fontSize: 11, color: '#10B981' }}>{aviso}</span>}
            {error && <span style={{ fontSize: 11, color: '#F87171' }}>{error}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto' }}>
            {PEST.map(p => (
              <button key={p.k} onClick={() => { setPestana(p.k); setSel(new Set()) }} style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                border: '1px solid ' + (pestana === p.k ? '#10B981' : '#333'), background: pestana === p.k ? '#10B98122' : 'transparent', color: pestana === p.k ? '#10B981' : '#999',
              }}>{p.label} ({p.n})</button>
            ))}
            {cuenta.otros > 0 && <span style={{ fontSize: 10, color: '#666', alignSelf: 'center', whiteSpace: 'nowrap' }}>{cuenta.otros} sin precio o con error</span>}
          </div>
        </div>

        {/* Barra de acciones */}
        {pestana === 'sin_costo' && visibles.length > 0 && (
          <div style={{ padding: isMobile ? '8px 12px 0' : '8px 20px 0', fontSize: 11, color: '#888' }}>
            Estos productos tienen costo 0 en el catálogo (por ejemplo, "suministrado por el cliente"). No se cuentan como diferencia; actualiza sólo los que de verdad deban tener costo.
          </div>
        )}
        {(pestana === 'distinto' || pestana === 'ignorado' || pestana === 'sin_costo') && visibles.length > 0 && (
          <div style={{ padding: isMobile ? '8px 12px' : '8px 20px', borderBottom: '1px solid #1e1e1e', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#aaa', cursor: 'pointer' }}>
              <input type="checkbox" checked={todosSel} onChange={() => setSel(todosSel ? new Set() : new Set(seleccionables.map(f => f.catalog_product_id)))} />
              Todos{pestana === 'distinto' && seleccionables.length < visibles.length ? ` (menos ${visibles.length - seleccionables.length} de ±50% o más)` : ''}
            </label>
            {pestana === 'distinto' && (
              <select value={sentido} onChange={e => setSentido(e.target.value as any)} style={{ background: '#1a1a1a', border: '1px solid #333', color: '#ccc', borderRadius: 6, padding: '4px 8px', fontSize: isMobile ? 16 : 11, fontFamily: 'inherit' }}>
                <option value="todos">Suben y bajan</option>
                <option value="sube">Sólo los que subieron</option>
                <option value="baja">Sólo los que bajaron</option>
              </select>
            )}
            <div style={{ flex: 1 }} />
            <Btn size="sm" variant="primary" disabled={!selEnVista.length || !!trabajando} onClick={() => aplicar(selEnVista)}>
              {trabajando === 'aplicar' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : null} Actualizar costo ({selEnVista.length})
            </Btn>
            {pestana === 'distinto' && <Btn size="sm" disabled={!selEnVista.length || !!trabajando} onClick={() => ignorar(selEnVista)}>Ignorar ({selEnVista.length})</Btn>}
          </div>
        )}

        {/* Lista */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '6px 0' : '6px 0 12px' }}>
          {cargando ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#666', fontSize: 12 }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /></div>
          ) : visibles.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#555', fontSize: 12 }}>
              {pestana === 'distinto' ? 'No hay diferencias por revisar.' : pestana === 'ligar' ? 'Todos los productos de Syscom están ligados.' : 'Nada aquí.'}
            </div>
          ) : pestana === 'ligar' ? (
            visibles.map(f => <RenglonLigar key={f.catalog_product_id} f={f} onLigar={sp => ligar(f, sp)} ocupado={trabajando === 'ligar:' + f.catalog_product_id} isMobile={isMobile} />)
          ) : (
            visibles.map(f => <RenglonPrecio key={f.catalog_product_id} f={f} marcado={sel.has(f.catalog_product_id)} onMarcar={() => toggle(f.catalog_product_id)} conCasilla={pestana !== 'igual'} isMobile={isMobile} />)
          )}
        </div>
      </div>
    </div>
  )
}

function Miniatura({ src }: { src: string | null | undefined }) {
  return src
    ? <img src={src} alt="" style={{ width: 34, height: 34, objectFit: 'contain', background: '#fff', borderRadius: 6, flexShrink: 0 }} />
    : <div style={{ width: 34, height: 34, background: '#1e1e1e', borderRadius: 6, flexShrink: 0 }} />
}

function RenglonPrecio({ f, marcado, onMarcar, conCasilla, isMobile }: { f: Fila; marcado: boolean; onMarcar: () => void; conCasilla: boolean; isMobile: boolean }) {
  const p = f.producto!
  const mon = (f.moneda_catalogo || p.moneda || 'USD').toUpperCase()
  const d = pct(f)
  const sube = (d ?? 0) > 0
  const color = d == null ? '#888' : Math.abs(d) < 0.5 ? '#888' : sube ? '#F87171' : '#10B981'
  const vn = ventaNueva(f)
  return (
    <div onClick={conCasilla ? onMarcar : undefined} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '9px 12px' : '8px 20px', borderBottom: '1px solid #1c1c1c', cursor: conCasilla ? 'pointer' : 'default', background: marcado ? '#10B98110' : 'transparent' }}>
      {conCasilla && <input type="checkbox" checked={marcado} onChange={onMarcar} onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }} />}
      <Miniatura src={p.image_url || f.imagen} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#ddd', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ fontSize: 10.5, color: '#777', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span>{p.modelo || p.sku}{f.modelo_syscom && f.modelo_syscom !== p.modelo ? ` · Syscom: ${f.modelo_syscom}` : ''}</span>
          <span style={{ color: colorExistencia(f.existencia) }}>{textoExistencia(f.existencia)}</span>
          {f.link && <a href={f.link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#666', display: 'inline-flex', alignItems: 'center', gap: 2 }}><ExternalLink size={10} /> syscom.mx</a>}
        </div>
        {d != null && Math.abs(d) >= 50 && (
          <div style={{ fontSize: 10, color: '#F59E0B', marginTop: 2 }}>⚠ Diferencia muy grande: revisa si el costo está en otra moneda o en otra unidad antes de actualizar.</div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: isMobile ? 110 : 260, display: 'flex', gap: isMobile ? 0 : 18, justifyContent: 'flex-end', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-end' : 'center' }}>
        {!isMobile && <div style={{ fontSize: 11, color: '#888', minWidth: 80 }}><div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase' }}>Catálogo</div>{money(p.cost, mon)}</div>}
        <div style={{ fontSize: isMobile ? 12 : 11, color: '#ddd', fontWeight: 700, minWidth: 80 }}>
          {!isMobile && <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', fontWeight: 400 }}>Syscom</div>}
          {money(f.precio_comparable, mon)}
        </div>
        <div style={{ fontSize: 11, color, fontWeight: 700, minWidth: 54 }}>
          {d == null ? '—' : (sube ? '▲ +' : '▼ ') + d.toFixed(1) + '%'}
          {isMobile && <span style={{ color: '#666', fontWeight: 400 }}> · antes {money(p.cost, mon)}</span>}
        </div>
        {!isMobile && <div style={{ fontSize: 10, color: '#666', minWidth: 90 }} title="Precio de venta del catálogo si actualizas, con el mismo margen">
          <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase' }}>Venta nueva</div>{vn != null ? money(vn, mon) : '—'}
        </div>}
      </div>
    </div>
  )
}

function RenglonLigar({ f, onLigar, ocupado, isMobile }: { f: Fila; onLigar: (sp: ProductoSyscom) => void; ocupado: boolean; isMobile: boolean }) {
  const p = f.producto!
  const [q, setQ] = useState('')
  const [res, setRes] = useState<ProductoSyscom[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [err, setErr] = useState('')
  const cands = res ?? (f.candidatos || [])
  async function buscar() {
    if (q.trim().length < 2) return
    setBuscando(true); setErr('')
    try { setRes((await buscarSyscom(q.trim())).productos.slice(0, 8)) } catch (e: any) { setErr(e.message) }
    setBuscando(false)
  }
  return (
    <div style={{ padding: isMobile ? '10px 12px' : '10px 20px', borderBottom: '1px solid #1c1c1c' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Miniatura src={p.image_url} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: '#ddd', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
          <div style={{ fontSize: 10.5, color: '#777', marginTop: 2 }}>
            Modelo en catálogo: <b style={{ color: '#aaa' }}>{p.modelo || '—'}</b>{p.sku && p.sku !== p.modelo ? ` · SKU ${p.sku}` : ''} · {f.estado === 'ambiguo' ? 'Syscom tiene varios con ese modelo' : 'No apareció con ese modelo'}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: isMobile ? 0 : 44 }}>
        {cands.length > 0 && <div style={{ fontSize: 10, color: '#666' }}>{res ? 'Resultados:' : '¿Es alguno de estos?'}</div>}
        {cands.map(c => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#bbb' }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <b style={{ color: '#ddd' }}>{c.modelo}</b> · {c.marca} · {c.titulo}
            </span>
            <span style={{ color: '#ddd', whiteSpace: 'nowrap' }}>{money(c.precio_descuento)}</span>
            <Btn size="sm" disabled={ocupado} onClick={() => onLigar(c)}><Link2 size={11} /> Ligar</Btn>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') buscar() }} placeholder="Buscar en Syscom por modelo o nombre"
            style={{ flex: 1, minWidth: 0, background: '#111', border: '1px solid #333', borderRadius: 6, padding: '5px 8px', color: '#fff', fontSize: isMobile ? 16 : 11, fontFamily: 'inherit', outline: 'none' }} />
          <Btn size="sm" onClick={buscar} disabled={buscando}>{buscando ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={11} />}</Btn>
        </div>
        {err && <div style={{ fontSize: 10, color: '#F87171' }}>{err}</div>}
      </div>
    </div>
  )
}
