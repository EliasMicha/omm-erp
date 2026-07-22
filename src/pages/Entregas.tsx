import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Btn, KpiCard, SectionHeader, EmptyState, Loading } from '../components/layout/UI'
import { fetchAllActiveCatalog } from '../lib/catalog'
import { SPECIALTY_CONFIG } from '../lib/utils'
import { Plus, X, Trash2, Warehouse, Building2, ArrowRight, ClipboardList, PackagePlus, ChevronRight, LayoutDashboard, Truck, Calendar, Clock, Inbox, PackageCheck } from 'lucide-react'
import { useIsMobile } from '../lib/useIsMobile'

// ─────────────────────────────────────────────────────────────────────────────
//  Módulo Entregas / Inventario — sobre el libro de movimientos (stock_movements)
//  Toda la trazabilidad se deriva de un solo libro append-only.
// ─────────────────────────────────────────────────────────────────────────────

type Tipo = 'recepcion_compra' | 'bodega_a_obra' | 'obra_a_obra' | 'obra_a_bodega'

const TIPO_CFG: Record<Tipo, { label: string; color: string; icon: string; desc: string }> = {
  recepcion_compra: { label: 'Recepción de compra', color: '#10B981', icon: '📥', desc: 'Llega material (de proveedor) a bodega o directo a obra' },
  bodega_a_obra:    { label: 'Bodega → Obra',        color: '#2563EB', icon: '🚚', desc: 'Surtir material de bodega a una obra' },
  obra_a_obra:      { label: 'Obra → Obra',          color: '#D97706', icon: '🔄', desc: 'Reasignar material de una obra a otra' },
  obra_a_bodega:    { label: 'Obra → Bodega',        color: '#8B5CF6', icon: '↩️', desc: 'Devolver sobrante / cambio a inventario general' },
}

interface Obra { id: string; nombre: string; project_id?: string | null }
interface Emp { id: string; nombre: string }
interface Linea { key: string; catalog_product_id: string | null; descripcion: string; marca: string | null; modelo: string | null; qty: number; unit: string }

const F = (n: number) => Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const fechaCorta = (d: string) => new Date((d || '').includes('T') ? d : d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13, background: '#0e0e0e', border: '1px solid #2a2a2a',
  borderRadius: 8, color: '#eee', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' }

export default function Entregas() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<'dashboard' | 'porlead' | 'inventario' | 'movimientos' | 'registrar'>('dashboard')
  const [preselectPo, setPreselectPo] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const [obras, setObras] = useState<Obra[]>([])
  const [empleados, setEmpleados] = useState<Emp[]>([])
  const [pos, setPos] = useState<any[]>([])
  const [catalog, setCatalog] = useState<any[]>([])

  const [movimientos, setMovimientos] = useState<any[]>([])
  const [stockBodega, setStockBodega] = useState<any[]>([])
  const [stockObra, setStockObra] = useState<any[]>([])

  const obraName = (id: string | null) => obras.find(o => o.id === id)?.nombre || '—'
  const obraProject = (id: string | null) => obras.find(o => o.id === id)?.project_id || null

  async function loadBase() {
    const [oR, eR, pR] = await Promise.all([
      supabase.from('obras').select('id, nombre, project_id').order('nombre'),
      supabase.from('employees').select('id, nombre').order('nombre'),
      supabase.from('purchase_orders').select('id, po_number, project_id, status').neq('status', 'cancelada').order('po_number', { ascending: false }).limit(300),
    ])
    setObras((oR.data as any) || [])
    setEmpleados((eR.data as any) || [])
    setPos((pR.data as any) || [])
    fetchAllActiveCatalog().then(setCatalog).catch(() => {})
  }

  async function loadInventario() {
    const [b, o] = await Promise.all([
      supabase.from('v_stock_bodega').select('*'),
      supabase.from('v_stock_obra').select('*'),
    ])
    setStockBodega((b.data as any) || [])
    setStockObra((o.data as any) || [])
  }

  async function loadMovimientos() {
    const { data } = await supabase.from('stock_movements').select('*').eq('anulado', false).order('created_at', { ascending: false }).limit(500)
    setMovimientos((data as any) || [])
  }

  useEffect(() => {
    (async () => {
      setLoading(true)
      await loadBase()
      await Promise.all([loadInventario(), loadMovimientos()])
      setLoading(false)
    })()
  }, [])

  if (loading) return <Loading />

  return (
    <div style={{ padding: isMobile ? 12 : 24, maxWidth: 1400, margin: '0 auto' }}>
      <SectionHeader title="Entregas e Inventario" subtitle="Movimientos de material con trazabilidad total — bodega, obras y compras" />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#0f0f0f', borderRadius: 10, padding: 4, border: '1px solid #1f1f1f', flexWrap: 'wrap' }}>
        {([
          { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
          { id: 'porlead', label: 'Inventario por lead', icon: <ClipboardList size={14} /> },
          { id: 'inventario', label: 'Bodega / Obra', icon: <Warehouse size={14} /> },
          { id: 'movimientos', label: 'Movimientos', icon: <ClipboardList size={14} /> },
          { id: 'registrar', label: 'Registrar', icon: <PackagePlus size={14} /> },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: isMobile ? '1 1 100%' : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '10px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
            background: tab === t.id ? '#1a1a1a' : 'transparent', border: tab === t.id ? '1px solid #333' : '1px solid transparent',
            color: tab === t.id ? '#fff' : '#888',
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      {tab === 'dashboard' && <TabDashboard isMobile={isMobile} onOperar={(poId: string) => { setPreselectPo(poId); setTab('registrar') }} onIr={(t: any) => setTab(t)} />}
      {tab === 'porlead' && <TabInventarioLead obras={obras} isMobile={isMobile} />}
      {tab === 'inventario' && <TabInventario stockBodega={stockBodega} stockObra={stockObra} obras={obras} isMobile={isMobile} />}
      {tab === 'movimientos' && <TabMovimientos movimientos={movimientos} obras={obras} isMobile={isMobile} />}
      {tab === 'registrar' && (
        <TabRegistrar
          obras={obras} empleados={empleados} pos={pos} catalog={catalog}
          obraProject={obraProject} isMobile={isMobile} initialPoId={preselectPo}
          onSaved={async () => { await Promise.all([loadInventario(), loadMovimientos()]); setPreselectPo(''); setTab('movimientos') }}
        />
      )}
    </div>
  )
}

// ═══════════════════════════ INVENTARIO ═══════════════════════════
function TabInventario({ stockBodega, stockObra, obras, isMobile }: any) {
  const [sub, setSub] = useState<'bodega' | 'obra'>('bodega')
  const [obraSel, setObraSel] = useState<string>('')
  const [q, setQ] = useState('')

  const obrasConStock = useMemo(() => {
    const ids = new Set(stockObra.map((r: any) => r.obra_id))
    return obras.filter((o: any) => ids.has(o.id))
  }, [stockObra, obras])

  const filtroTxt = (r: any) => {
    const s = q.toLowerCase().trim()
    if (!s) return true
    return (r.descripcion || '').toLowerCase().includes(s) || (r.marca || '').toLowerCase().includes(s) || (r.modelo || '').toLowerCase().includes(s)
  }

  const bodega = stockBodega.filter(filtroTxt)
  const obraRows = stockObra.filter((r: any) => (!obraSel || r.obra_id === obraSel) && filtroTxt(r))

  const totalBodega = stockBodega.reduce((s: number, r: any) => s + Number(r.en_bodega || 0), 0)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
        <KpiCard label="SKUs en bodega" value={stockBodega.length} icon={<Warehouse size={16} />} />
        <KpiCard label="Piezas en bodega" value={F(totalBodega)} color="#2563EB" icon={<PackagePlus size={16} />} />
        <KpiCard label="Obras con material" value={obrasConStock.length} color="#D97706" icon={<Building2 size={16} />} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 2, background: '#141414', borderRadius: 8, padding: 2, border: '1px solid #222' }}>
          {([['bodega', 'Bodega (general)'], ['obra', 'Por obra']] as const).map(([id, lbl]) => (
            <button key={id} onClick={() => setSub(id)} style={{ padding: '6px 12px', fontSize: 12, fontWeight: sub === id ? 600 : 400, color: sub === id ? '#fff' : '#777', background: sub === id ? '#2a2a2a' : 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>{lbl}</button>
          ))}
        </div>
        {sub === 'obra' && (
          <select value={obraSel} onChange={e => setObraSel(e.target.value)} style={{ ...inputStyle, width: 'auto', minWidth: 200 }}>
            <option value="">— Todas las obras —</option>
            {obras.map((o: any) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        )}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar equipo…" style={{ ...inputStyle, width: 'auto', minWidth: 200, marginLeft: 'auto' }} />
      </div>

      <InvTable rows={sub === 'bodega' ? bodega : obraRows} mode={sub} obraName={(id: string) => obras.find((o: any) => o.id === id)?.nombre || '—'} />
    </div>
  )
}

function InvTable({ rows, mode, obraName }: { rows: any[]; mode: 'bodega' | 'obra'; obraName: (id: string) => string }) {
  if (rows.length === 0) return <EmptyState message="Sin material registrado todavía. Registra movimientos para poblar el inventario." />
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #1f1f1f', borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#0f0f0f', color: '#777', textAlign: 'left' }}>
            <th style={{ padding: '10px 12px' }}>Marca</th>
            <th style={{ padding: '10px 12px' }}>Modelo</th>
            <th style={{ padding: '10px 12px' }}>Descripción</th>
            {mode === 'obra' && <th style={{ padding: '10px 12px' }}>Obra</th>}
            <th style={{ padding: '10px 12px', textAlign: 'right' }}>Cantidad</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid #1a1a1a', color: '#ccc' }}>
              <td style={{ padding: '8px 12px' }}>{r.marca || '—'}</td>
              <td style={{ padding: '8px 12px' }}>{r.modelo || '—'}</td>
              <td style={{ padding: '8px 12px', color: '#eee' }}>{r.descripcion || '—'}</td>
              {mode === 'obra' && <td style={{ padding: '8px 12px', color: '#aaa' }}>{obraName(r.obra_id)}</td>}
              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#fff', fontSize: 14 }}>{F(mode === 'bodega' ? r.en_bodega : r.en_obra)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════ MOVIMIENTOS (LIBRO) ═══════════════════════════
function TabMovimientos({ movimientos, obras, isMobile }: any) {
  const [fTipo, setFTipo] = useState<string>('todos')
  const [fObra, setFObra] = useState<string>('')
  const [q, setQ] = useState('')
  const obraName = (id: string | null) => obras.find((o: any) => o.id === id)?.nombre || null

  const lista = movimientos.filter((m: any) => {
    if (fTipo !== 'todos' && m.tipo !== fTipo) return false
    if (fObra && m.origen_obra_id !== fObra && m.destino_obra_id !== fObra) return false
    if (q.trim()) {
      const s = q.toLowerCase().trim()
      if (!((m.descripcion || '').toLowerCase().includes(s) || (m.marca || '').toLowerCase().includes(s) || (m.modelo || '').toLowerCase().includes(s) || (m.folio || '').toLowerCase().includes(s))) return false
    }
    return true
  })

  const puntoOrigen = (m: any) => m.origen_tipo === 'obra' ? (obraName(m.origen_obra_id) || 'Obra') : m.origen_tipo === 'bodega' ? 'Bodega' : m.origen_tipo === 'proveedor' ? 'Proveedor' : '—'
  const puntoDestino = (m: any) => m.destino_tipo === 'obra' ? (obraName(m.destino_obra_id) || 'Obra') : m.destino_tipo === 'bodega' ? `Bodega${m.bucket_destino === 'general' ? ' (general)' : ''}` : '—'

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={fTipo} onChange={e => setFTipo(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="todos">Todos los tipos</option>
          {(Object.keys(TIPO_CFG) as Tipo[]).map(t => <option key={t} value={t}>{TIPO_CFG[t].label}</option>)}
        </select>
        <select value={fObra} onChange={e => setFObra(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="">Todas las obras</option>
          {obras.map((o: any) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar equipo o folio…" style={{ ...inputStyle, width: 'auto', minWidth: 200, marginLeft: 'auto' }} />
      </div>

      {lista.length === 0 ? <EmptyState message="Sin movimientos registrados. Usa 'Registrar movimiento' para empezar." /> : (
        <div style={{ overflowX: 'auto', border: '1px solid #1f1f1f', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#0f0f0f', color: '#777', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px' }}>Fecha</th>
                <th style={{ padding: '10px 12px' }}>Tipo</th>
                <th style={{ padding: '10px 12px' }}>Equipo</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}>Cant.</th>
                <th style={{ padding: '10px 12px' }}>Movimiento</th>
                <th style={{ padding: '10px 12px' }}>Quién</th>
                <th style={{ padding: '10px 12px' }}>Folio</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((m: any) => {
                const cfg = TIPO_CFG[m.tipo as Tipo]
                return (
                  <tr key={m.id} style={{ borderTop: '1px solid #1a1a1a', color: '#ccc' }}>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fechaCorta(m.fecha)}</td>
                    <td style={{ padding: '8px 12px' }}><span style={{ fontSize: 11, fontWeight: 600, color: cfg?.color || '#888' }}>{cfg?.icon} {cfg?.label || m.tipo}</span></td>
                    <td style={{ padding: '8px 12px', color: '#eee' }}>{m.marca ? m.marca + ' ' : ''}{m.modelo || m.descripcion}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#fff' }}>{F(m.qty)}</td>
                    <td style={{ padding: '8px 12px', color: '#aaa', whiteSpace: 'nowrap' }}>{puntoOrigen(m)} <span style={{ color: '#555' }}>→</span> {puntoDestino(m)}{m.motivo ? <span style={{ color: '#777', fontStyle: 'italic' }}> · {m.motivo}</span> : ''}</td>
                    <td style={{ padding: '8px 12px', color: '#aaa' }}>{m.movido_por_nombre || '—'}</td>
                    <td style={{ padding: '8px 12px', color: '#666', fontSize: 11 }}>{m.folio || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════ REGISTRAR MOVIMIENTO ═══════════════════════════
function TabRegistrar({ obras, empleados, pos, catalog, obraProject, isMobile, onSaved, initialPoId }: any) {
  const [tipo, setTipo] = useState<Tipo>('recepcion_compra')
  const [poId, setPoId] = useState('')
  const [poQuotationId, setPoQuotationId] = useState<string | null>(null)
  const [destinoKind, setDestinoKind] = useState<'bodega' | 'obra'>('bodega') // solo recepción
  const [origenObra, setOrigenObra] = useState('')
  const [destinoObra, setDestinoObra] = useState('')
  const [motivo, setMotivo] = useState('sobrante')
  const [movidoPor, setMovidoPor] = useState('')
  const [recibidoPor, setRecibidoPor] = useState('')
  const [notas, setNotas] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [lineas, setLineas] = useState<Linea[]>([])
  const [saving, setSaving] = useState(false)

  // Si venimos del Dashboard con una OC preseleccionada → recepción precargada
  useEffect(() => { if (initialPoId) { setTipo('recepcion_compra'); cargarDesdeOC(initialPoId) } }, [])

  // buscador de catálogo
  const [catQ, setCatQ] = useState('')
  const matches = catQ.trim().length >= 2
    ? catalog.filter((p: any) => {
      const s = catQ.toLowerCase()
      return (p.name || '').toLowerCase().includes(s) || (p.marca || '').toLowerCase().includes(s) || (p.modelo || '').toLowerCase().includes(s)
    }).slice(0, 20)
    : []

  function addLinea(p: any) {
    setLineas(x => [...x, { key: Math.random().toString(36).slice(2), catalog_product_id: p.id, descripcion: p.name || '', marca: p.marca || p.provider || '', modelo: p.modelo || '', qty: 1, unit: 'pza' }])
    setCatQ('')
  }
  function addLineaLibre() {
    setLineas(x => [...x, { key: Math.random().toString(36).slice(2), catalog_product_id: null, descripcion: '', marca: '', modelo: '', qty: 1, unit: 'pza' }])
  }
  const updLinea = (key: string, patch: Partial<Linea>) => setLineas(x => x.map(l => l.key === key ? { ...l, ...patch } : l))
  const rmLinea = (key: string) => setLineas(x => x.filter(l => l.key !== key))

  async function cargarDesdeOC(id: string) {
    setPoId(id)
    if (!id) { setPoQuotationId(null); return }
    const [itR, poR] = await Promise.all([
      supabase.from('po_items').select('catalog_product_id, name, marca, modelo, quantity, unit').eq('purchase_order_id', id),
      supabase.from('purchase_orders').select('quotation_id').eq('id', id).single(),
    ])
    setPoQuotationId((poR.data as any)?.quotation_id || null)
    setLineas(((itR.data as any[]) || []).map((it: any) => ({ key: Math.random().toString(36).slice(2), catalog_product_id: it.catalog_product_id || null, descripcion: it.name || '', marca: it.marca || '', modelo: it.modelo || '', qty: Number(it.quantity) || 1, unit: it.unit || 'pza' })))
  }

  function validar(): string | null {
    if (lineas.length === 0) return 'Agrega al menos un producto.'
    if (lineas.some(l => !l.descripcion.trim() || !(l.qty > 0))) return 'Cada renglón necesita descripción y cantidad mayor a 0.'
    if (tipo === 'recepcion_compra' && destinoKind === 'obra' && !destinoObra) return 'Elige la obra destino.'
    if (tipo === 'bodega_a_obra' && !destinoObra) return 'Elige la obra destino.'
    if (tipo === 'obra_a_obra' && (!origenObra || !destinoObra)) return 'Elige obra origen y destino.'
    if (tipo === 'obra_a_obra' && origenObra === destinoObra) return 'La obra origen y destino no pueden ser la misma.'
    if (tipo === 'obra_a_bodega' && !origenObra) return 'Elige la obra origen.'
    return null
  }

  async function guardar() {
    const err = validar()
    if (err) { alert(err); return }
    setSaving(true)
    try {
      const batch = (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2)
      const folio = 'MOV-' + fecha.slice(2).replace(/-/g, '') + '-' + Math.floor(Math.random() * 900 + 100)
      const empName = empleados.find((e: any) => e.id === movidoPor)?.nombre || ''

      let origen_tipo: string | null = null, origen_obra_id: string | null = null
      let destino_tipo: string | null = null, destino_obra_id: string | null = null
      let bucket_destino: string | null = null, proyecto_id: string | null = null

      if (tipo === 'recepcion_compra') {
        origen_tipo = 'proveedor'
        if (destinoKind === 'obra') { destino_tipo = 'obra'; destino_obra_id = destinoObra; bucket_destino = 'proyecto'; proyecto_id = obraProject(destinoObra) }
        else { destino_tipo = 'bodega'; bucket_destino = 'general' }
      } else if (tipo === 'bodega_a_obra') {
        origen_tipo = 'bodega'; destino_tipo = 'obra'; destino_obra_id = destinoObra; bucket_destino = 'proyecto'; proyecto_id = obraProject(destinoObra)
      } else if (tipo === 'obra_a_obra') {
        origen_tipo = 'obra'; origen_obra_id = origenObra; destino_tipo = 'obra'; destino_obra_id = destinoObra; bucket_destino = 'proyecto'; proyecto_id = obraProject(destinoObra)
      } else if (tipo === 'obra_a_bodega') {
        origen_tipo = 'obra'; origen_obra_id = origenObra; destino_tipo = 'bodega'; bucket_destino = 'general'
      }

      const rows = lineas.map(l => ({
        fecha, catalog_product_id: l.catalog_product_id, descripcion: l.descripcion.trim(), marca: l.marca || null, modelo: l.modelo || null,
        qty: Number(l.qty), unit: l.unit || 'pza', tipo,
        origen_tipo, origen_obra_id, destino_tipo, destino_obra_id, bucket_destino, proyecto_id,
        po_id: tipo === 'recepcion_compra' ? (poId || null) : null,
        quotation_id: tipo === 'recepcion_compra' ? (poQuotationId || null) : null,
        motivo: tipo === 'obra_a_bodega' ? motivo : null,
        movido_por: movidoPor || null, movido_por_nombre: empName || null, recibido_por: recibidoPor || null,
        notas: notas || null, folio, batch_id: batch,
      }))

      const { error } = await supabase.from('stock_movements').insert(rows)
      if (error) { alert('Error al guardar: ' + error.message); setSaving(false); return }
      alert(`✅ ${rows.length} movimiento(s) registrado(s). Folio ${folio}`)
      setLineas([]); setPoId(''); setPoQuotationId(null); setNotas(''); setRecibidoPor('')
      await onSaved()
    } catch (e: any) {
      alert('Error: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const necesitaOrigenObra = tipo === 'obra_a_obra' || tipo === 'obra_a_bodega'
  const necesitaDestinoObra = tipo === 'bodega_a_obra' || tipo === 'obra_a_obra' || (tipo === 'recepcion_compra' && destinoKind === 'obra')

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Tipo de movimiento */}
      <label style={labelStyle}>Tipo de movimiento</label>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 8, marginBottom: 20 }}>
        {(Object.keys(TIPO_CFG) as Tipo[]).map(t => (
          <button key={t} onClick={() => { setTipo(t); setLineas([]); setPoId(''); setPoQuotationId(null) }} style={{
            padding: '12px 10px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            background: tipo === t ? TIPO_CFG[t].color + '18' : '#0e0e0e', border: `1px solid ${tipo === t ? TIPO_CFG[t].color : '#2a2a2a'}`,
            color: tipo === t ? '#fff' : '#aaa',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{TIPO_CFG[t].icon} {TIPO_CFG[t].label}</div>
            <div style={{ fontSize: 10, color: '#777', marginTop: 3, lineHeight: 1.3 }}>{TIPO_CFG[t].desc}</div>
          </button>
        ))}
      </div>

      {/* Origen / destino contextual */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {tipo === 'recepcion_compra' && (
          <>
            <div>
              <label style={labelStyle}>Orden de compra (opcional — precarga los productos)</label>
              <select value={poId} onChange={e => cargarDesdeOC(e.target.value)} style={inputStyle}>
                <option value="">— Sin OC / captura manual —</option>
                {pos.map((p: any) => <option key={p.id} value={p.id}>{p.po_number}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>¿A dónde llega?</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {([['bodega', 'Bodega'], ['obra', 'Directo a obra']] as const).map(([id, lbl]) => (
                  <button key={id} onClick={() => setDestinoKind(id)} style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, background: destinoKind === id ? '#1a1a1a' : '#0e0e0e', border: `1px solid ${destinoKind === id ? '#10B981' : '#2a2a2a'}`, color: destinoKind === id ? '#fff' : '#888' }}>{lbl}</button>
                ))}
              </div>
            </div>
          </>
        )}
        {necesitaOrigenObra && (
          <div>
            <label style={labelStyle}>Obra origen</label>
            <select value={origenObra} onChange={e => setOrigenObra(e.target.value)} style={inputStyle}>
              <option value="">— Elige obra —</option>
              {obras.map((o: any) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
        )}
        {necesitaDestinoObra && (
          <div>
            <label style={labelStyle}>Obra destino</label>
            <select value={destinoObra} onChange={e => setDestinoObra(e.target.value)} style={inputStyle}>
              <option value="">— Elige obra —</option>
              {obras.map((o: any) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
        )}
        {tipo === 'obra_a_bodega' && (
          <div>
            <label style={labelStyle}>Motivo</label>
            <select value={motivo} onChange={e => setMotivo(e.target.value)} style={inputStyle}>
              <option value="sobrante">Sobrante</option>
              <option value="cambio">Cambio / no se usó</option>
              <option value="garantia">Garantía / defectuoso</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        )}
      </div>

      {/* Productos */}
      <label style={labelStyle}>Equipos / material</label>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <input value={catQ} onChange={e => setCatQ(e.target.value)} placeholder="Buscar producto en catálogo (marca, modelo, nombre)…" style={inputStyle} />
        {matches.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#141414', border: '1px solid #333', borderRadius: 8, marginTop: 4, maxHeight: 260, overflowY: 'auto' }}>
            {matches.map((p: any) => (
              <div key={p.id} onClick={() => addLinea(p)} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #222', fontSize: 12, color: '#ddd' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1e1e1e')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ color: '#888' }}>{p.marca || p.provider || ''}</span> {p.modelo ? <b>{p.modelo}</b> : ''} — {p.name}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ marginBottom: 8 }}><Btn size="sm" variant="default" onClick={addLineaLibre}><Plus size={12} /> Renglón manual</Btn></div>

      {lineas.length > 0 && (
        <div style={{ border: '1px solid #1f1f1f', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: '#0f0f0f', color: '#777', textAlign: 'left' }}>
              <th style={{ padding: '8px 10px' }}>Marca</th><th style={{ padding: '8px 10px' }}>Modelo</th><th style={{ padding: '8px 10px' }}>Descripción</th><th style={{ padding: '8px 10px', width: 90 }}>Cantidad</th><th style={{ width: 36 }}></th>
            </tr></thead>
            <tbody>
              {lineas.map(l => (
                <tr key={l.key} style={{ borderTop: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '4px 6px' }}><input value={l.marca || ''} onChange={e => updLinea(l.key, { marca: e.target.value })} style={{ ...inputStyle, padding: '5px 7px' }} /></td>
                  <td style={{ padding: '4px 6px' }}><input value={l.modelo || ''} onChange={e => updLinea(l.key, { modelo: e.target.value })} style={{ ...inputStyle, padding: '5px 7px' }} /></td>
                  <td style={{ padding: '4px 6px' }}><input value={l.descripcion} onChange={e => updLinea(l.key, { descripcion: e.target.value })} style={{ ...inputStyle, padding: '5px 7px' }} /></td>
                  <td style={{ padding: '4px 6px' }}><input type="number" min={0} value={l.qty} onChange={e => updLinea(l.key, { qty: Number(e.target.value) })} style={{ ...inputStyle, padding: '5px 7px', textAlign: 'center', fontWeight: 700 }} /></td>
                  <td style={{ padding: '4px 6px', textAlign: 'center' }}><button onClick={() => rmLinea(l.key)} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer' }}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Meta */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
        <div><label style={labelStyle}>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inputStyle} /></div>
        <div><label style={labelStyle}>Quién lo movió</label>
          <select value={movidoPor} onChange={e => setMovidoPor(e.target.value)} style={inputStyle}>
            <option value="">— Elige —</option>
            {empleados.map((e: any) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div><label style={labelStyle}>Recibió (nombre)</label><input value={recibidoPor} onChange={e => setRecibidoPor(e.target.value)} placeholder="Quién recibió" style={inputStyle} /></div>
      </div>
      <div style={{ marginBottom: 20 }}><label style={labelStyle}>Notas</label><input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Notas del movimiento (opcional)" style={inputStyle} /></div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Btn variant="primary" onClick={guardar} disabled={saving || lineas.length === 0}>{saving ? 'Guardando…' : `Registrar movimiento (${lineas.length})`}</Btn>
      </div>
    </div>
  )
}

// ═══════════════════════════ INVENTARIO POR LEAD + COTIZACIÓN ═══════════════════════════
type Fase = { qty: number; fecha: string | null }
const mkFase = (): Fase => ({ qty: 0, fecha: null })
const maxFecha = (a: string | null, b: string | null) => !a ? b : !b ? a : (a > b ? a : b)

function TabInventarioLead({ isMobile }: any) {
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState<any[]>([])
  const [cots, setCots] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [leadSel, setLeadSel] = useState<string>('')
  const [detalle, setDetalle] = useState<any[] | null>(null)
  const [loadingDet, setLoadingDet] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const [lR, qR] = await Promise.all([
        supabase.from('leads').select('id, name, status').order('name'),
        supabase.from('quotations').select('id, name, specialty, notes, created_at, updated_at').eq('stage', 'contrato'),
      ])
      setLeads((lR.data as any[]) || [])
      const cotsParsed = ((qR.data as any[]) || [])
        .filter(c => c.specialty !== 'proy')  // Proyecto = servicio/ingeniería, no lleva inventario físico
        .map(c => {
          let lead_id: string | null = null
          try { lead_id = JSON.parse(c.notes || '{}').lead_id || null } catch {}
          return { id: c.id, name: c.name, specialty: c.specialty, lead_id, created_at: c.created_at }
        })
      setCots(cotsParsed)
      setLoading(false)
    })()
  }, [])

  const leadsConCots = useMemo(() => {
    const cnt: Record<string, number> = {}
    cots.forEach(c => { if (c.lead_id) cnt[c.lead_id] = (cnt[c.lead_id] || 0) + 1 })
    // El eje es la COTIZACIÓN: aparece cualquier lead que tenga ≥1 cotización en contrato
    // (con equipo). No se filtra por status del lead.
    return leads.filter(l => cnt[l.id]).map(l => ({ ...l, nCots: cnt[l.id] }))
  }, [leads, cots])

  const leadsFiltrados = leadsConCots.filter(l => !q.trim() || (l.name || '').toLowerCase().includes(q.toLowerCase()))

  async function abrirLead(leadId: string) {
    setLeadSel(leadId); setLoadingDet(true); setDetalle(null)
    const cotsLead = cots.filter(c => c.lead_id === leadId)
    const cotIds = cotsLead.map(c => c.id)
    if (cotIds.length === 0) { setDetalle([]); setLoadingDet(false); return }

    const [qiR, poR] = await Promise.all([
      supabase.from('quotation_items').select('quotation_id, catalog_product_id, name, marca, modelo, quantity').in('quotation_id', cotIds),
      supabase.from('purchase_orders').select('id, quotation_id, created_at, approved_at').in('quotation_id', cotIds),
    ])
    const qItems = (qiR.data as any[]) || []
    const posData = (poR.data as any[]) || []
    const poIds = posData.map(p => p.id)
    const poCot: Record<string, string> = {}; posData.forEach(p => { poCot[p.id] = p.quotation_id })
    const poFecha: Record<string, string> = {}; posData.forEach(p => { poFecha[p.id] = (p.approved_at || p.created_at || '').slice(0, 10) })

    let poItems: any[] = []
    if (poIds.length) { const { data } = await supabase.from('po_items').select('purchase_order_id, catalog_product_id, name, marca, modelo, quantity').in('purchase_order_id', poIds); poItems = data || [] }

    const mv1 = (await supabase.from('stock_movements').select('*').eq('anulado', false).in('quotation_id', cotIds)).data || []
    const mv2 = poIds.length ? ((await supabase.from('stock_movements').select('*').eq('anulado', false).in('po_id', poIds)).data || []) : []
    const movs = [...mv1, ...mv2.filter((m: any) => !mv1.find((x: any) => x.id === m.id))]

    const keyOf = (it: any) => it.catalog_product_id || `${(it.marca || '').toLowerCase()}|${(it.modelo || '').toLowerCase()}|${(it.name || it.descripcion || '').toLowerCase()}`

    const detalleCots = cotsLead.map(cot => {
      const map = new Map<string, any>()
      const ensure = (it: any) => {
        const k = keyOf(it)
        if (!map.has(k)) map.set(k, { key: k, marca: it.marca || '', modelo: it.modelo || '', descripcion: it.name || it.descripcion || '', vendido: mkFase(), comprado: mkFase(), recibido: mkFase(), entregado: mkFase() })
        return map.get(k)
      }
      // Vendido
      qItems.filter(i => i.quotation_id === cot.id).forEach(i => { const r = ensure(i); r.vendido.qty += Number(i.quantity) || 0; r.vendido.fecha = maxFecha(r.vendido.fecha, (cot.created_at || '').slice(0, 10)) })
      // Comprado
      poItems.filter(pi => poCot[pi.purchase_order_id] === cot.id).forEach(pi => { const r = ensure(pi); r.comprado.qty += Number(pi.quantity) || 0; r.comprado.fecha = maxFecha(r.comprado.fecha, poFecha[pi.purchase_order_id] || null) })
      // Recibido + Entregado (del libro)
      movs.forEach((m: any) => {
        const mCot = m.quotation_id || (m.po_id ? poCot[m.po_id] : null)
        if (mCot !== cot.id) return
        const r = ensure(m)
        if (m.tipo === 'recepcion_compra') { r.recibido.qty += Number(m.qty) || 0; r.recibido.fecha = maxFecha(r.recibido.fecha, (m.fecha || '').slice(0, 10)) }
        if (m.destino_tipo === 'obra') { r.entregado.qty += Number(m.qty) || 0; r.entregado.fecha = maxFecha(r.entregado.fecha, (m.fecha || '').slice(0, 10)) }
      })
      const arts = Array.from(map.values()).sort((a, b) => (a.descripcion || '').localeCompare(b.descripcion || ''))
      return { cot, arts }
    })
    setDetalle(detalleCots)
    setLoadingDet(false)
  }

  if (loading) return <Loading />

  // Vista lista de leads
  if (!leadSel) {
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar lead…" style={{ ...inputStyle, maxWidth: 320 }} />
          <span style={{ fontSize: 11, color: '#666' }}>{leadsFiltrados.length} leads con cotización en contrato</span>
        </div>
        {leadsFiltrados.length === 0 ? <EmptyState message="No hay leads con cotizaciones en contrato." /> : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2,1fr)', gap: 10 }}>
            {leadsFiltrados.map(l => (
              <button key={l.id} onClick={() => abrirLead(l.id)} style={{ textAlign: 'left', padding: '14px 16px', background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 10, cursor: 'pointer', color: '#eee', fontFamily: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#67E8F9')} onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2a2a')}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{l.name}</span>
                <span style={{ fontSize: 11, color: '#888' }}>{l.nCots} {l.nCots === 1 ? 'cotización' : 'cotizaciones'} <ChevronRight size={14} style={{ verticalAlign: 'middle' }} /></span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Vista detalle de un lead
  const leadName = leads.find(l => l.id === leadSel)?.name || 'Lead'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button onClick={() => { setLeadSel(''); setDetalle(null) }} style={{ background: '#141414', border: '1px solid #333', borderRadius: 8, padding: '6px 10px', color: '#ccc', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>← Leads</button>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{leadName}</div>
      </div>

      {loadingDet ? <Loading /> : (detalle || []).length === 0 ? <EmptyState message="Este lead no tiene cotizaciones en contrato." /> : (
        (detalle || []).map((d: any) => {
          const esp = SPECIALTY_CONFIG[d.cot.specialty as keyof typeof SPECIALTY_CONFIG]
          return (
            <div key={d.cot.id} style={{ marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, padding: '8px 12px', background: '#0f0f0f', borderRadius: 8, borderLeft: `4px solid ${esp?.color || '#666'}` }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{d.cot.name}</span>
                {esp && <span style={{ fontSize: 11, fontWeight: 600, color: esp.color }}>{esp.icon} {esp.label}</span>}
                <span style={{ fontSize: 10, color: '#666', marginLeft: 'auto' }}>{d.arts.length} artículos</span>
              </div>
              {d.arts.length === 0 ? <div style={{ fontSize: 12, color: '#666', padding: '4px 12px' }}>Sin artículos.</div> : (
                <div style={{ overflowX: 'auto', border: '1px solid #1f1f1f', borderRadius: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, minWidth: 760 }}>
                    <thead>
                      <tr style={{ background: '#0f0f0f', color: '#777', textAlign: 'left' }}>
                        <th style={{ padding: '8px 10px' }}>Marca</th>
                        <th style={{ padding: '8px 10px' }}>Modelo</th>
                        <th style={{ padding: '8px 10px' }}>Descripción</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center' }}>Vendido</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center' }}>Comprado</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center' }}>Recibido</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center' }}>Entregado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.arts.map((a: any) => (
                        <tr key={a.key} style={{ borderTop: '1px solid #1a1a1a', color: '#ccc' }}>
                          <td style={{ padding: '6px 10px' }}>{a.marca || '—'}</td>
                          <td style={{ padding: '6px 10px' }}>{a.modelo || '—'}</td>
                          <td style={{ padding: '6px 10px', color: '#eee' }}>{a.descripcion || '—'}</td>
                          <FaseCell f={a.vendido} />
                          <FaseCell f={a.comprado} ref_={a.vendido.qty} />
                          <FaseCell f={a.recibido} ref_={a.comprado.qty} />
                          <FaseCell f={a.entregado} ref_={a.recibido.qty} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

function FaseCell({ f, ref_ }: { f: Fase; ref_?: number }) {
  // color: si esta fase quedó por debajo de la fase anterior (ref_), marcar en ámbar (falta)
  const falta = ref_ !== undefined && f.qty < ref_
  const color = f.qty === 0 ? '#555' : falta ? '#D97706' : '#10B981'
  return (
    <td style={{ padding: '6px 10px', textAlign: 'center' }}>
      <div style={{ fontWeight: 800, fontSize: 14, color }}>{f.qty > 0 ? Number(f.qty).toLocaleString('es-MX', { maximumFractionDigits: 2 }) : '—'}</div>
      {f.fecha && <div style={{ fontSize: 9, color: '#666' }}>{fechaCorta(f.fecha)}</div>}
    </td>
  )
}

// ═══════════════════════════ DASHBOARD DE LOGÍSTICA ═══════════════════════════
function TabDashboard({ isMobile, onOperar, onIr }: any) {
  const [loading, setLoading] = useState(true)
  const [pos, setPos] = useState<any[]>([])
  const [supMap, setSupMap] = useState<Record<string, string>>({})
  const [leadMap, setLeadMap] = useState<Record<string, string>>({})
  const [obraMap, setObraMap] = useState<Record<string, string>>({})
  const [recibidas, setRecibidas] = useState<Set<string>>(new Set())
  const [movHoy, setMovHoy] = useState<number>(0)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const hoyStr = new Date().toISOString().slice(0, 10)
      const [poR, sR, lR, oR, mR, mhR] = await Promise.all([
        supabase.from('purchase_orders').select('id, po_number, status, logistics_mode, logistics_target_obra_id, expected_delivery, delivered_at, total, currency, supplier_id, lead_id, created_at').neq('status', 'cancelada').order('created_at', { ascending: false }).limit(500),
        supabase.from('suppliers').select('id, name'),
        supabase.from('leads').select('id, name'),
        supabase.from('obras').select('id, nombre'),
        supabase.from('stock_movements').select('po_id').eq('tipo', 'recepcion_compra').eq('anulado', false).not('po_id', 'is', null),
        supabase.from('stock_movements').select('id').eq('anulado', false).eq('fecha', hoyStr),
      ])
      setPos((poR.data as any[]) || [])
      const sm: any = {}; ((sR.data as any[]) || []).forEach(s => sm[s.id] = s.name); setSupMap(sm)
      const lm: any = {}; ((lR.data as any[]) || []).forEach(l => lm[l.id] = l.name); setLeadMap(lm)
      const om: any = {}; ((oR.data as any[]) || []).forEach(o => om[o.id] = o.nombre); setObraMap(om)
      setRecibidas(new Set(((mR.data as any[]) || []).map(m => m.po_id)))
      setMovHoy(((mhR.data as any[]) || []).length)
      setLoading(false)
    })()
  }, [])

  if (loading) return <Loading />

  const hoy = new Date().toISOString().slice(0, 10)
  const recibida = (po: any) => recibidas.has(po.id) || !!po.delivered_at
  const isPickup = (m: string) => m === 'pickup_to_bodega' || m === 'pickup_to_obra'
  const isProv = (m: string) => m === 'supplier_to_bodega' || m === 'supplier_to_obra'

  const porRecolectar = pos.filter(p => isPickup(p.logistics_mode) && !recibida(p))
  const porRecibir = pos.filter(p => isProv(p.logistics_mode) && !recibida(p))
  const pendienteLog = pos.filter(p => (!p.logistics_mode || p.logistics_mode === 'pending') && !recibida(p))
  const agendaHoy = pos.filter(p => p.expected_delivery === hoy && !recibida(p))
  const pedidos = pos.filter(p => p.status === 'pedida')
  const vencidas = pos.filter(p => p.expected_delivery && p.expected_delivery < hoy && !recibida(p) && (isPickup(p.logistics_mode) || isProv(p.logistics_mode)))

  const destino = (p: any) => p.logistics_target_obra_id ? (obraMap[p.logistics_target_obra_id] || 'Obra') : 'Bodega'
  const money = (p: any) => (p.currency === 'USD' ? 'US$' : '$') + F(p.total || 0)

  const POTabla = ({ rows, accion, colorAccion }: { rows: any[]; accion: string; colorAccion: string }) => (
    <div style={{ overflowX: 'auto', border: '1px solid #1f1f1f', borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
        <thead><tr style={{ background: '#0f0f0f', color: '#777', textAlign: 'left' }}>
          <th style={{ padding: '8px 10px' }}>OC</th>
          <th style={{ padding: '8px 10px' }}>Proveedor</th>
          <th style={{ padding: '8px 10px' }}>Lead</th>
          <th style={{ padding: '8px 10px' }}>Destino</th>
          <th style={{ padding: '8px 10px' }}>Fecha esp.</th>
          <th style={{ padding: '8px 10px', textAlign: 'right' }}>Total</th>
          <th style={{ padding: '8px 10px', textAlign: 'right' }}></th>
        </tr></thead>
        <tbody>
          {rows.map(p => {
            const venc = p.expected_delivery && p.expected_delivery < hoy
            return (
              <tr key={p.id} style={{ borderTop: '1px solid #1a1a1a', color: '#ccc' }}>
                <td style={{ padding: '8px 10px', fontWeight: 600, color: '#eee' }}>{p.po_number}</td>
                <td style={{ padding: '8px 10px' }}>{supMap[p.supplier_id] || '—'}</td>
                <td style={{ padding: '8px 10px', color: '#aaa' }}>{leadMap[p.lead_id] || '—'}</td>
                <td style={{ padding: '8px 10px', color: '#aaa' }}>{destino(p)}</td>
                <td style={{ padding: '8px 10px', color: venc ? '#DC2626' : '#aaa', fontWeight: venc ? 700 : 400 }}>{p.expected_delivery ? fechaCorta(p.expected_delivery) : '—'}{venc ? ' ⚠' : ''}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{money(p)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <button onClick={() => onOperar(p.id)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: colorAccion + '22', border: `1px solid ${colorAccion}55`, borderRadius: 6, color: colorAccion, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{accion}</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  const Seccion = ({ titulo, icon, children }: any) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 14, fontWeight: 700, color: '#fff' }}>{icon} {titulo}</div>
      {children}
    </div>
  )

  return (
    <div>
      {/* KPIs del día/semana */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 12, marginBottom: 22 }}>
        <KpiCard label="Por recolectar" value={porRecolectar.length} color="#A78BFA" icon={<Truck size={16} />} />
        <KpiCard label="Por recibir" value={porRecibir.length} color="#60A5FA" icon={<Inbox size={16} />} />
        <KpiCard label="Agendado hoy" value={agendaHoy.length} color="#10B981" icon={<Calendar size={16} />} />
        <KpiCard label="Vencidas" value={vencidas.length} color="#DC2626" icon={<Clock size={16} />} />
        <KpiCard label="Movs. hoy" value={movHoy} color="#67E8F9" icon={<PackageCheck size={16} />} />
      </div>

      {vencidas.length > 0 && (
        <Seccion titulo={`Atrasadas — requieren atención (${vencidas.length})`} icon={<Clock size={16} color="#DC2626" />}>
          <POTabla rows={vencidas} accion="Registrar" colorAccion="#DC2626" />
        </Seccion>
      )}

      <Seccion titulo={`Ruta / agenda de hoy (${agendaHoy.length})`} icon={<Calendar size={16} color="#10B981" />}>
        {agendaHoy.length === 0 ? <EmptyState message="Nada agendado para hoy (según fecha esperada de las OCs)." /> : <POTabla rows={agendaHoy} accion="Registrar" colorAccion="#10B981" />}
      </Seccion>

      <Seccion titulo={`Por recolectar — OMM recoge (${porRecolectar.length})`} icon={<Truck size={16} color="#A78BFA" />}>
        {porRecolectar.length === 0 ? <EmptyState message="Nada pendiente de recolectar." /> : <POTabla rows={porRecolectar} accion="Recibir" colorAccion="#A78BFA" />}
      </Seccion>

      <Seccion titulo={`Por recibir — llega de proveedor (${porRecibir.length})`} icon={<Inbox size={16} color="#60A5FA" />}>
        {porRecibir.length === 0 ? <EmptyState message="Nada pendiente de recibir." /> : <POTabla rows={porRecibir} accion="Recibir" colorAccion="#60A5FA" />}
      </Seccion>

      {pendienteLog.length > 0 && (
        <Seccion titulo={`Sin logística definida (${pendienteLog.length})`} icon={<PackagePlus size={16} color="#D97706" />}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Estas OCs no tienen modo logístico (recolección / proveedor). Defínelo en Compras.</div>
          <POTabla rows={pendienteLog} accion="Recibir" colorAccion="#D97706" />
        </Seccion>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        <Btn size="sm" variant="default" onClick={() => onIr('porlead')}><ClipboardList size={12} /> Ver inventario por lead</Btn>
        <Btn size="sm" variant="default" onClick={() => onIr('registrar')}><PackagePlus size={12} /> Registrar movimiento</Btn>
        <Btn size="sm" variant="default" onClick={() => onIr('movimientos')}><Truck size={12} /> Ver movimientos</Btn>
      </div>
    </div>
  )
}
