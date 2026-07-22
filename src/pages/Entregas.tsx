import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Btn, KpiCard, SectionHeader, EmptyState, Loading } from '../components/layout/UI'
import { fetchAllActiveCatalog } from '../lib/catalog'
import { SPECIALTY_CONFIG } from '../lib/utils'
import { Plus, X, Trash2, Warehouse, Building2, ArrowRight, ClipboardList, PackagePlus, ChevronRight, ChevronLeft, LayoutDashboard, Truck, Calendar, CalendarDays, Clock, Inbox, PackageCheck, MapPin, Wrench, Laptop, Pencil } from 'lucide-react'
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
  const [tab, setTab] = useState<'dashboard' | 'agenda' | 'porlead' | 'inventario' | 'movimientos' | 'registrar' | 'herramienta'>('dashboard')
  const [preselectPo, setPreselectPo] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const [obras, setObras] = useState<Obra[]>([])
  const [leadsInv, setLeadsInv] = useState<{ id: string; nombre: string }[]>([])
  const [empleados, setEmpleados] = useState<Emp[]>([])
  const [pos, setPos] = useState<any[]>([])
  const [catalog, setCatalog] = useState<any[]>([])

  const [movimientos, setMovimientos] = useState<any[]>([])
  const [stockBodega, setStockBodega] = useState<any[]>([])
  const [stockObra, setStockObra] = useState<any[]>([])

  const obraName = (id: string | null) => obras.find(o => o.id === id)?.nombre || '—'
  const obraProject = (id: string | null) => obras.find(o => o.id === id)?.project_id || null

  async function loadBase() {
    const [oR, eR, pR, cotR] = await Promise.all([
      supabase.from('obras').select('id, nombre, project_id').order('nombre'),
      supabase.from('employees').select('id, nombre, puesto, area').order('nombre'),
      supabase.from('purchase_orders').select('id, po_number, project_id, status, supplier_id, quotation_id, lead_id').neq('status', 'cancelada').order('po_number', { ascending: false }).limit(300),
      supabase.from('quotations').select('notes, specialty').eq('stage', 'contrato'),
    ])
    setObras((oR.data as any) || [])
    setEmpleados((eR.data as any) || [])
    const posRaw = (pR.data as any[]) || []
    // El "destino" del inventario es el LEAD con cotización en contrato (con material) — no la tabla obras
    const ids = new Set<string>()
    ;((cotR.data as any[]) || []).forEach(c => { if (c.specialty !== 'proy' && c.specialty !== 'cort') { try { const lid = JSON.parse(c.notes || '{}').lead_id; if (lid) ids.add(lid) } catch {} } })
    // Enriquecer OCs con proveedor + lead (para que el listado sea legible: OC · obra · proveedor)
    const supIds = [...new Set(posRaw.map(p => p.supplier_id).filter(Boolean))]
    const qIds = [...new Set(posRaw.map(p => p.quotation_id).filter(Boolean))]
    const [supR, qR2] = await Promise.all([
      supIds.length ? supabase.from('suppliers').select('id, name').in('id', supIds) : Promise.resolve({ data: [] as any[] }),
      qIds.length ? supabase.from('quotations').select('id, notes').in('id', qIds) : Promise.resolve({ data: [] as any[] }),
    ])
    const supM: Record<string, string> = {}; ((supR.data as any[]) || []).forEach(s => supM[s.id] = s.name)
    const q2l: Record<string, string> = {}; ((qR2.data as any[]) || []).forEach(x => { try { const lid = JSON.parse(x.notes || '{}').lead_id; if (lid) q2l[x.id] = lid } catch {} })
    const leadIds = new Set<string>([...ids])
    posRaw.forEach(p => { const lid = p.lead_id || q2l[p.quotation_id]; if (lid) leadIds.add(lid) })
    const leadNameM: Record<string, string> = {}
    if (leadIds.size) { const { data: ld } = await supabase.from('leads').select('id, name').in('id', [...leadIds]); ((ld as any[]) || []).forEach(l => leadNameM[l.id] = l.name) }
    setPos(posRaw.map(p => { const lid = p.lead_id || q2l[p.quotation_id]; return { ...p, _prov: supM[p.supplier_id] || '', _lead: (lid && leadNameM[lid]) || '' } }))
    setLeadsInv([...ids].map(id => ({ id, nombre: leadNameM[id] || 'Lead' })).filter(l => l.nombre !== 'Lead' || true).sort((a, b) => a.nombre.localeCompare(b.nombre)))
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
          { id: 'agenda', label: 'Agenda / Ruta', icon: <CalendarDays size={14} /> },
          { id: 'porlead', label: 'Inventario por lead', icon: <ClipboardList size={14} /> },
          { id: 'inventario', label: 'Bodega / Obra', icon: <Warehouse size={14} /> },
          { id: 'movimientos', label: 'Movimientos', icon: <ClipboardList size={14} /> },
          { id: 'registrar', label: 'Registrar', icon: <PackagePlus size={14} /> },
          { id: 'herramienta', label: 'Herramienta', icon: <Wrench size={14} /> },
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
      {tab === 'agenda' && <TabAgenda isMobile={isMobile} obras={obras} empleados={empleados} />}
      {tab === 'porlead' && <TabInventarioLead obras={obras} isMobile={isMobile} />}
      {tab === 'inventario' && <TabInventario stockBodega={stockBodega} stockObra={stockObra} obras={leadsInv} isMobile={isMobile} />}
      {tab === 'movimientos' && <TabMovimientos movimientos={movimientos} obras={leadsInv} isMobile={isMobile} />}
      {tab === 'registrar' && (
        <TabRegistrar
          obras={leadsInv} empleados={empleados} pos={pos} catalog={catalog}
          obraProject={obraProject} isMobile={isMobile} initialPoId={preselectPo}
          onSaved={async () => { await Promise.all([loadInventario(), loadMovimientos()]); setPreselectPo(''); setTab('movimientos') }}
        />
      )}
      {tab === 'herramienta' && <TabHerramienta obras={leadsInv} empleados={empleados} isMobile={isMobile} />}
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
  const [detalle, setDetalle] = useState<any | null>(null)
  const [poMap, setPoMap] = useState<Record<string, any>>({})
  const [q2l, setQ2l] = useState<Record<string, string>>({})
  const [leadMap, setLeadMap] = useState<Record<string, string>>({})
  const [supMap, setSupMap] = useState<Record<string, string>>({})
  const obraName = (id: string | null) => obras.find((o: any) => o.id === id)?.nombre || null

  // Cargar OCs (num interna + orden proveedor + lead) y leads referenciados
  useEffect(() => {
    (async () => {
      const poIds = [...new Set(movimientos.map((m: any) => m.po_id).filter(Boolean))]
      const qIds = [...new Set(movimientos.map((m: any) => m.quotation_id).filter(Boolean))]
      const pR = poIds.length
        ? await supabase.from('purchase_orders').select('id, po_number, supplier_doc_number, quotation_id, lead_id, supplier_id').in('id', poIds)
        : { data: [] as any[] }
      const pm: any = {}; ((pR.data as any[]) || []).forEach(p => pm[p.id] = p); setPoMap(pm)
      const allQ = [...new Set([...qIds, ...((pR.data as any[]) || []).map(p => p.quotation_id).filter(Boolean)])]
      const supIds = [...new Set(((pR.data as any[]) || []).map(p => p.supplier_id).filter(Boolean))]
      const [qR, lR, sR] = await Promise.all([
        allQ.length ? supabase.from('quotations').select('id, notes').in('id', allQ) : Promise.resolve({ data: [] as any[] }),
        supabase.from('leads').select('id, name'),
        supIds.length ? supabase.from('suppliers').select('id, name').in('id', supIds) : Promise.resolve({ data: [] as any[] }),
      ])
      const q2: any = {}; ((qR.data as any[]) || []).forEach(x => { try { const lid = JSON.parse(x.notes || '{}').lead_id; if (lid) q2[x.id] = lid } catch { } }); setQ2l(q2)
      const lm: any = {}; ((lR.data as any[]) || []).forEach(l => lm[l.id] = l.name); setLeadMap(lm)
      const sm: any = {}; ((sR.data as any[]) || []).forEach(s => sm[s.id] = s.name); setSupMap(sm)
    })()
  }, [movimientos])

  // Agrupar por folio/batch → un renglón por movimiento (no por equipo)
  const grupos = useMemo(() => {
    const map = new Map<string, any>()
    for (const m of movimientos) {
      const key = m.batch_id || m.id
      if (!map.has(key)) map.set(key, { ...m, _items: [m] })
      else map.get(key)._items.push(m)
    }
    return Array.from(map.values())
  }, [movimientos])

  const po = (m: any) => (m.po_id ? poMap[m.po_id] : null)
  const leadDe = (m: any) => {
    const p = po(m)
    const qid = m.quotation_id || p?.quotation_id
    const lid = (qid && q2l[qid]) || p?.lead_id
    return (lid && leadMap[lid]) || null
  }
  const refInterna = (m: any) => po(m)?.po_number || m.folio || '—'
  const ordenProv = (m: any) => po(m)?.supplier_doc_number || null
  const provNombre = (m: any) => { const p = po(m); return p ? supMap[p.supplier_id] : null }

  const lista = grupos.filter((m: any) => {
    if (fTipo !== 'todos' && m.tipo !== fTipo) return false
    if (fObra && m.origen_obra_id !== fObra && m.destino_obra_id !== fObra) return false
    if (q.trim()) {
      const s = q.toLowerCase().trim()
      const items = m._items.map((x: any) => `${x.marca || ''} ${x.modelo || ''} ${x.descripcion || ''}`).join(' ').toLowerCase()
      const hay = items.includes(s) || (refInterna(m) || '').toLowerCase().includes(s) || (ordenProv(m) || '').toLowerCase().includes(s) || (leadDe(m) || '').toLowerCase().includes(s) || (m.folio || '').toLowerCase().includes(s)
      if (!hay) return false
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
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar equipo, OC, lead…" style={{ ...inputStyle, width: 'auto', minWidth: 200, marginLeft: 'auto' }} />
      </div>

      {lista.length === 0 ? <EmptyState message="Sin movimientos registrados. Usa 'Registrar movimiento' para empezar." /> : (
        <div style={{ overflowX: 'auto', border: '1px solid #1f1f1f', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#0f0f0f', color: '#777', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px' }}>Fecha</th>
                <th style={{ padding: '10px 12px' }}>Tipo</th>
                <th style={{ padding: '10px 12px' }}>OC interna / Folio</th>
                <th style={{ padding: '10px 12px' }}>Orden proveedor</th>
                <th style={{ padding: '10px 12px' }}>Lead</th>
                <th style={{ padding: '10px 12px' }}>Entrega</th>
                <th style={{ padding: '10px 12px' }}>Recibe</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((m: any) => {
                const cfg = TIPO_CFG[m.tipo as Tipo]
                const op = ordenProv(m); const pn = provNombre(m)
                return (
                  <tr key={m.batch_id || m.id} onClick={() => setDetalle(m)} style={{ borderTop: '1px solid #1a1a1a', color: '#ccc', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#131313')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fechaCorta(m.fecha)}</td>
                    <td style={{ padding: '8px 12px' }}><span style={{ fontSize: 11, fontWeight: 600, color: cfg?.color || '#888' }}>{cfg?.icon} {cfg?.label || m.tipo}</span></td>
                    <td style={{ padding: '8px 12px', color: '#eee', whiteSpace: 'nowrap' }}>{refInterna(m)}</td>
                    <td style={{ padding: '8px 12px', color: '#aaa', whiteSpace: 'nowrap' }}>{op || '—'}{pn ? <span style={{ display: 'block', color: '#666', fontSize: 10 }}>{pn}</span> : null}</td>
                    <td style={{ padding: '8px 12px', color: '#ccc' }}>{leadDe(m) || <span style={{ color: '#555' }}>—</span>}</td>
                    <td style={{ padding: '8px 12px', color: '#aaa' }}>{m.movido_por_nombre || '—'}</td>
                    <td style={{ padding: '8px 12px', color: '#aaa' }}>{m.recibido_por || '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: '#57FF9A', fontSize: 11 }}>ver ›</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {detalle && (
        <MovimientoDetalleModal
          m={detalle} items={detalle._items}
          refInterna={refInterna(detalle)} ordenProv={ordenProv(detalle)} provNombre={provNombre(detalle)}
          lead={leadDe(detalle)} origen={puntoOrigen(detalle)} destino={puntoDestino(detalle)}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  )
}

function MovimientoDetalleModal({ m, items, refInterna, ordenProv, provNombre, lead, origen, destino, onClose }: any) {
  const cfg = TIPO_CFG[m.tipo as Tipo]
  const Row = ({ k, v }: any) => v ? (
    <div style={{ display: 'flex', gap: 8 }}><span style={{ color: '#777', minWidth: 130 }}>{k}</span><span style={{ color: '#ddd' }}>{v}</span></div>
  ) : null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 12, width: 'min(680px,100%)', maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f1f1f', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}><span style={{ color: cfg?.color || '#888' }}>{cfg?.icon} {cfg?.label || m.tipo}</span></div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{origen} → {destino} · {fechaCorta(m.fecha)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '16px 20px', display: 'grid', gap: 6, fontSize: 12.5 }}>
          <Row k="OC interna / Folio" v={refInterna} />
          <Row k="Orden proveedor" v={ordenProv ? `${ordenProv}${provNombre ? ' · ' + provNombre : ''}` : (provNombre || null)} />
          <Row k="Lead" v={lead} />
          <Row k="Entrega" v={m.movido_por_nombre} />
          <Row k="Recibe" v={m.recibido_por} />
          <Row k="Motivo" v={m.motivo} />
          <Row k="Notas" v={m.notas} />
        </div>
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ fontSize: 11, color: '#777', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>Equipos ({items.length})</div>
          <div style={{ border: '1px solid #1f1f1f', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#0f0f0f', color: '#777', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px' }}>Equipo</th>
                <th style={{ padding: '8px 12px', textAlign: 'center' }}>Cant.</th>
              </tr></thead>
              <tbody>
                {items.map((it: any) => (
                  <tr key={it.id} style={{ borderTop: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '8px 12px', color: '#eee' }}>{it.marca ? it.marca + ' ' : ''}{it.modelo || it.descripcion}{it.modelo && it.descripcion && it.descripcion !== it.modelo ? <span style={{ display: 'block', color: '#666', fontSize: 10 }}>{it.descripcion}</span> : null}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#fff' }}>{F(it.qty)} <span style={{ color: '#666', fontWeight: 400, fontSize: 10 }}>{it.unit || 'pza'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
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
                {pos.map((p: any) => <option key={p.id} value={p.id}>{[p.po_number, p._lead, p._prov].filter(Boolean).join('  ·  ')}</option>)}
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
type Parte = { qty: number; fecha: string | null }
type Fase = { total: number; partes: Parte[] }
const mkFase = (): Fase => ({ total: 0, partes: [] })
// Cada parcialidad se acumula por fecha (misma fecha = misma parcialidad)
const addParte = (f: Fase, qty: number, fecha: string | null) => {
  if (!qty) return
  f.total += qty
  const ex = f.partes.find(p => p.fecha === fecha)
  if (ex) ex.qty += qty
  else f.partes.push({ qty, fecha })
}

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
        .filter(c => c.specialty !== 'proy' && c.specialty !== 'cort')  // Proyecto = ingeniería (sin material); Cortinas = fuera por ahora
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
      // Eléctricas: se cotizan por salida / metro lineal, no por producto → el inventario NO se rige
      // por los items de la cotización sino por el conjunto de sus COMPRAS (tubo, cable, codos…).
      const esElec = cot.specialty === 'elec'
      const map = new Map<string, any>()
      const ensure = (it: any) => {
        const k = keyOf(it)
        if (!map.has(k)) map.set(k, { key: k, marca: it.marca || '', modelo: it.modelo || '', descripcion: it.name || it.descripcion || '', vendido: mkFase(), comprado: mkFase(), recibido: mkFase(), entregado: mkFase() })
        return map.get(k)
      }
      // Vendido (una fecha: la del contrato) — omitido para eléctricas
      if (!esElec) qItems.filter(i => i.quotation_id === cot.id).forEach(i => { const r = ensure(i); addParte(r.vendido, Number(i.quantity) || 0, (cot.created_at || '').slice(0, 10)) })
      // Comprado (una parcialidad por OC / fecha de OC)
      poItems.filter(pi => poCot[pi.purchase_order_id] === cot.id).forEach(pi => { const r = ensure(pi); addParte(r.comprado, Number(pi.quantity) || 0, poFecha[pi.purchase_order_id] || null) })
      // Recibido + Entregado (una parcialidad por movimiento del libro / su fecha)
      movs.forEach((m: any) => {
        const mCot = m.quotation_id || (m.po_id ? poCot[m.po_id] : null)
        if (mCot !== cot.id) return
        const r = ensure(m)
        if (m.tipo === 'recepcion_compra') addParte(r.recibido, Number(m.qty) || 0, (m.fecha || '').slice(0, 10))
        if (m.destino_tipo === 'obra') addParte(r.entregado, Number(m.qty) || 0, (m.fecha || '').slice(0, 10))
      })
      const arts = Array.from(map.values()).sort((a, b) => (a.descripcion || '').localeCompare(b.descripcion || ''))
      return { cot, arts, esElec }
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
                {d.esElec && <span style={{ fontSize: 10, fontWeight: 600, color: '#FFB347', background: '#FFB34718', padding: '2px 7px', borderRadius: 4 }}>inventario por compras</span>}
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
                        <th style={{ padding: '8px 10px', textAlign: 'center' }}>{d.esElec ? 'Vendido (n/a)' : 'Vendido'}</th>
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
                          <FaseCell f={a.comprado} ref_={d.esElec ? undefined : a.vendido.total} />
                          <FaseCell f={a.recibido} ref_={a.comprado.total} />
                          <FaseCell f={a.entregado} ref_={a.recibido.total} />
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
  const falta = ref_ !== undefined && f.total < ref_
  const color = f.total === 0 ? '#555' : falta ? '#D97706' : '#10B981'
  const fmt = (n: number) => Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 })
  const partes = [...f.partes].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
  return (
    <td style={{ padding: '6px 10px', textAlign: 'center', verticalAlign: 'top' }}>
      <div style={{ fontWeight: 800, fontSize: 14, color }}>{f.total > 0 ? fmt(f.total) : '—'}</div>
      {/* Una sola parcialidad → solo la fecha. Varias → desglose cantidad · fecha */}
      {partes.length === 1 && partes[0].fecha && <div style={{ fontSize: 9, color: '#666' }}>{fechaCorta(partes[0].fecha)}</div>}
      {partes.length > 1 && partes.map((p, i) => (
        <div key={i} style={{ fontSize: 9, color: '#888' }}>{fmt(p.qty)} · {p.fecha ? fechaCorta(p.fecha) : '—'}</div>
      ))}
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
  const [quotToLead, setQuotToLead] = useState<Record<string, string>>({})
  const [verPo, setVerPo] = useState<any>(null)
  const [rutaTasks, setRutaTasks] = useState<any[]>([])

  useEffect(() => {
    (async () => {
      setLoading(true)
      const hoyStr = new Date().toISOString().slice(0, 10)
      const [poR, sR, lR, oR, mR, mhR] = await Promise.all([
        supabase.from('purchase_orders').select('id, po_number, status, logistics_mode, logistics_target_obra_id, expected_delivery, delivered_at, total, currency, supplier_id, lead_id, quotation_id, created_at').neq('status', 'cancelada').order('created_at', { ascending: false }).limit(500),
        supabase.from('suppliers').select('id, name'),
        supabase.from('leads').select('id, name'),
        supabase.from('obras').select('id, nombre'),
        supabase.from('stock_movements').select('po_id').eq('tipo', 'recepcion_compra').eq('anulado', false).not('po_id', 'is', null),
        supabase.from('stock_movements').select('id').eq('anulado', false).eq('fecha', hoyStr),
      ])
      const posData = (poR.data as any[]) || []
      setPos(posData)
      const sm: any = {}; ((sR.data as any[]) || []).forEach(s => sm[s.id] = s.name); setSupMap(sm)
      const lm: any = {}; ((lR.data as any[]) || []).forEach(l => lm[l.id] = l.name); setLeadMap(lm)
      const om: any = {}; ((oR.data as any[]) || []).forEach(o => om[o.id] = o.nombre); setObraMap(om)
      setRecibidas(new Set(((mR.data as any[]) || []).map(m => m.po_id)))
      setMovHoy(((mhR.data as any[]) || []).length)
      // Ruta: tareas de hoy y mañana (agenda) pendientes
      const man = new Date(); man.setDate(man.getDate() + 1); const mananaStr = man.toISOString().slice(0, 10)
      const tR = await supabase.from('logistics_tasks').select('*').gte('fecha', hoyStr).lte('fecha', mananaStr).neq('estatus', 'cancelada').neq('estatus', 'completada')
      setRutaTasks((tR.data as any[]) || [])
      // Resolver el lead vía cotización cuando la OC no trae lead_id (como hace Compras)
      const qids = [...new Set(posData.map(p => p.quotation_id).filter(Boolean))]
      if (qids.length) {
        const { data: qd } = await supabase.from('quotations').select('id, notes').in('id', qids)
        const q2l: Record<string, string> = {}
        ;((qd as any[]) || []).forEach(q => { try { const lid = JSON.parse(q.notes || '{}').lead_id; if (lid) q2l[q.id] = lid } catch {} })
        setQuotToLead(q2l)
      }
      setLoading(false)
    })()
  }, [])

  if (loading) return <Loading />

  const hoy = new Date().toISOString().slice(0, 10)
  const recibida = (po: any) => po.status === 'recibida' || recibidas.has(po.id) || !!po.delivered_at
  // Solo OCs CONFIRMADAS (aprobada/pedida/parcial) entran a los listados accionables.
  // Las de borrador van aparte en "no confirmadas".
  const confirmada = (po: any) => ['aprobada', 'pedida', 'recibida_parcial'].includes(po.status)
  const activa = (po: any) => confirmada(po) && !recibida(po)
  const isPickup = (m: string) => m === 'pickup_to_bodega' || m === 'pickup_to_obra'
  const isProv = (m: string) => m === 'supplier_to_bodega' || m === 'supplier_to_obra'

  const porRecolectar = pos.filter(p => activa(p) && isPickup(p.logistics_mode))
  const porRecibir = pos.filter(p => activa(p) && isProv(p.logistics_mode))
  const pendienteLog = pos.filter(p => activa(p) && (!p.logistics_mode || p.logistics_mode === 'pending'))
  const agendaHoy = pos.filter(p => activa(p) && p.expected_delivery === hoy)
  const vencidas = pos.filter(p => activa(p) && p.expected_delivery && p.expected_delivery < hoy)
  const noConfirmadas = pos.filter(p => p.status === 'borrador')

  const destino = (p: any) => p.logistics_target_obra_id ? (obraMap[p.logistics_target_obra_id] || 'Obra') : 'Bodega'
  const money = (p: any) => (p.currency === 'USD' ? 'US$' : '$') + F(p.total || 0)
  const leadName = (p: any) => leadMap[p.lead_id] || leadMap[quotToLead[p.quotation_id]] || '—'

  const POTabla = ({ rows, accion, colorAccion }: { rows: any[]; accion?: string; colorAccion?: string }) => (
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
                <td style={{ padding: '8px 10px' }}><button onClick={() => setVerPo(p)} style={{ background: 'none', border: 'none', color: '#67E8F9', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, padding: 0, textDecoration: 'underline' }}>{p.po_number}</button></td>
                <td style={{ padding: '8px 10px' }}>{supMap[p.supplier_id] || '—'}</td>
                <td style={{ padding: '8px 10px', color: '#aaa' }}>{leadName(p)}</td>
                <td style={{ padding: '8px 10px', color: '#aaa' }}>{destino(p)}</td>
                <td style={{ padding: '8px 10px', color: venc ? '#DC2626' : '#aaa', fontWeight: venc ? 700 : 400 }}>{p.expected_delivery ? fechaCorta(p.expected_delivery) : '—'}{venc ? ' ⚠' : ''}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{money(p)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  {accion ? <button onClick={() => onOperar(p.id)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: (colorAccion || '#888') + '22', border: `1px solid ${(colorAccion || '#888')}55`, borderRadius: 6, color: colorAccion || '#888', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{accion}</button> : null}
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

      {rutaTasks.length > 0 && (
        <Seccion titulo={`Ruta — hoy y mañana (${rutaTasks.length})`} icon={<CalendarDays size={16} color="#67E8F9" />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...rutaTasks].sort((a, b) => ((a.fecha || '') + (a.hora || '99')).localeCompare((b.fecha || '') + (b.hora || '99'))).map((t: any) => {
              const cfg = TAREA_CFG[t.tipo] || TAREA_CFG.otro; const prio = PRIO_CFG[t.prioridad]
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0f0f0f', border: '1px solid #1f1f1f', borderLeft: `3px solid ${prio?.color || '#666'}`, borderRadius: 8, padding: '8px 12px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#888', minWidth: 78 }}>{fechaCorta(t.fecha)}{t.hora ? ' ' + String(t.hora).slice(0, 5) : ''}</span>
                  <span style={{ fontSize: 13, color: '#eee', fontWeight: 600 }}>{cfg.icon} {t.titulo}</span>
                  {t.ubicacion && <span style={{ fontSize: 11, color: '#888' }}>· {t.ubicacion}</span>}
                  {t.estatus === 'en_ruta' && <span style={{ fontSize: 10, color: '#60A5FA' }}>● en ruta</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: prio?.color }}>{prio?.label}</span>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 10 }}><Btn size="sm" variant="default" onClick={() => onIr('agenda')}><CalendarDays size={12} /> Ver agenda de la semana</Btn></div>
        </Seccion>
      )}

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
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>OCs confirmadas pero sin modo logístico (recolección / proveedor). Defínelo en Compras — igual puedes recibirlas.</div>
          <POTabla rows={pendienteLog} accion="Recibir" colorAccion="#D97706" />
        </Seccion>
      )}

      {noConfirmadas.length > 0 && (
        <Seccion titulo={`Órdenes no confirmadas — borrador (${noConfirmadas.length})`} icon={<PackagePlus size={16} color="#666" />}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Están en borrador: no se reciben hasta confirmarlas (aprobar / pedir) en Compras. Pica la OC para ver su contenido.</div>
          <POTabla rows={noConfirmadas} />
        </Seccion>
      )}

      {verPo && <PoContenidoModal po={verPo} supMap={supMap} leadName={leadName(verPo)} confirmada={confirmada(verPo)} onClose={() => setVerPo(null)} onRecibir={() => { onOperar(verPo.id); setVerPo(null) }} />}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        <Btn size="sm" variant="default" onClick={() => onIr('porlead')}><ClipboardList size={12} /> Ver inventario por lead</Btn>
        <Btn size="sm" variant="default" onClick={() => onIr('registrar')}><PackagePlus size={12} /> Registrar movimiento</Btn>
        <Btn size="sm" variant="default" onClick={() => onIr('movimientos')}><Truck size={12} /> Ver movimientos</Btn>
      </div>
    </div>
  )
}

// Modal: contenido de una OC (qué hay que recibir)
function PoContenidoModal({ po, supMap, leadName, confirmada, onClose, onRecibir }: any) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data } = await supabase.from('po_items').select('name, marca, modelo, quantity, unit').eq('purchase_order_id', po.id).order('order_index')
      setItems((data as any[]) || [])
      setLoading(false)
    })()
  }, [po.id])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#141414', border: '1px solid #333', borderRadius: 14, width: 'min(760px, 96vw)', maxHeight: '85vh', overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{po.po_number} · {supMap[po.supplier_id] || 'Sin proveedor'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 14 }}>Lead: {leadName || '—'} · Contenido de la orden ({items.length} partidas)</div>
        {loading ? <Loading /> : items.length === 0 ? <EmptyState message="Esta OC no tiene partidas." /> : (
          <div style={{ border: '1px solid #1f1f1f', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#0f0f0f', color: '#777', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px' }}>Marca</th><th style={{ padding: '8px 10px' }}>Modelo</th><th style={{ padding: '8px 10px' }}>Descripción</th><th style={{ padding: '8px 10px', textAlign: 'center' }}>Cantidad</th>
              </tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #1a1a1a', color: '#ccc' }}>
                    <td style={{ padding: '6px 10px' }}>{it.marca || '—'}</td>
                    <td style={{ padding: '6px 10px' }}>{it.modelo || '—'}</td>
                    <td style={{ padding: '6px 10px', color: '#eee' }}>{it.name}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700, color: '#fff' }}>{F(it.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          {confirmada
            ? <Btn variant="primary" onClick={onRecibir}><PackagePlus size={12} /> Registrar recepción</Btn>
            : <span style={{ fontSize: 11, color: '#D97706' }}>OC en borrador — confírmala en Compras para poder recibirla.</span>}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════ AGENDA / RUTA SEMANAL ═══════════════════════════
const TAREA_CFG: Record<string, { label: string; icon: string; color: string }> = {
  recoleccion: { label: 'Recolección', icon: '🚚', color: '#A78BFA' },
  entrega:     { label: 'Entrega',     icon: '📦', color: '#10B981' },
  compra:      { label: 'Compra',      icon: '🛒', color: '#60A5FA' },
  muestra:     { label: 'Muestra',     icon: '🎨', color: '#F59E0B' },
  herramienta: { label: 'Herramienta', icon: '🔧', color: '#94A3B8' },
  visita:      { label: 'Visita',      icon: '📍', color: '#F472B6' },
  otro:        { label: 'Otro',        icon: '•',  color: '#9CA3AF' },
}
const PRIO_CFG: Record<string, { label: string; color: string }> = {
  alta: { label: 'Alta', color: '#DC2626' }, media: { label: 'Media', color: '#D97706' }, baja: { label: 'Baja', color: '#10B981' },
}
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const mondayOf = (offset: number) => { const t = new Date(); t.setHours(12, 0, 0, 0); const dow = (t.getDay() + 6) % 7; t.setDate(t.getDate() - dow + offset * 7); return t }

function TabAgenda({ isMobile, obras, empleados }: any) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [tasks, setTasks] = useState<any[]>([])
  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<any>(null)

  const weekDays = useMemo(() => { const mon = mondayOf(weekOffset); return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d }) }, [weekOffset])
  const weekStart = isoDay(weekDays[0]); const weekEnd = isoDay(weekDays[6])
  const hoyStr = isoDay(new Date())

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('logistics_tasks').select('*').gte('fecha', weekStart).lte('fecha', weekEnd).neq('estatus', 'cancelada')
    setTasks((data as any[]) || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [weekStart])
  useEffect(() => { supabase.from('leads').select('id, name').order('name').then(({ data }) => setLeads((data as any[]) || [])) }, [])

  const tasksByDay = (iso: string) => tasks.filter(t => t.fecha === iso).sort((a, b) => {
    if ((a.hora || '') !== (b.hora || '')) return (a.hora || '99') < (b.hora || '99') ? -1 : 1
    const p = (x: string) => x === 'alta' ? 0 : x === 'media' ? 1 : 2
    return p(a.prioridad) - p(b.prioridad)
  })

  async function cycleEstatus(t: any) {
    const next = t.estatus === 'pendiente' ? 'en_ruta' : t.estatus === 'en_ruta' ? 'completada' : 'pendiente'
    await supabase.from('logistics_tasks').update({ estatus: next }).eq('id', t.id); load()
  }
  async function del(t: any) { if (!confirm('¿Eliminar esta tarea?')) return; await supabase.from('logistics_tasks').update({ estatus: 'cancelada' }).eq('id', t.id); load() }

  const navBtn: React.CSSProperties = { background: '#141414', border: '1px solid #333', borderRadius: 8, padding: '6px 10px', color: '#ccc', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }
  const rango = weekDays[0].toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) + ' – ' + weekDays[6].toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: '2-digit' })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setWeekOffset(w => w - 1)} style={navBtn}><ChevronLeft size={16} /></button>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', minWidth: 170, textAlign: 'center' }}>{rango}</div>
        <button onClick={() => setWeekOffset(w => w + 1)} style={navBtn}><ChevronRight size={16} /></button>
        {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} style={{ ...navBtn, color: '#10B981' }}>Hoy</button>}
        <Btn size="sm" variant="primary" style={{ marginLeft: 'auto' }} onClick={() => setModal({ fecha: hoyStr })}><Plus size={12} /> Nueva tarea</Btn>
      </div>

      {loading ? <Loading /> : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(7,1fr)', gap: 8 }}>
          {weekDays.map((d, i) => {
            const iso = isoDay(d); const esHoy = iso === hoyStr; const dayTasks = tasksByDay(iso)
            return (
              <div key={iso} style={{ background: '#0e0e0e', border: `1px solid ${esHoy ? '#10B981' : '#1f1f1f'}`, borderRadius: 10, padding: 8, minHeight: 130 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: esHoy ? '#10B981' : '#aaa' }}>{DIAS[i]} {d.getDate()}</div>
                  <button onClick={() => setModal({ fecha: iso })} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><Plus size={14} /></button>
                </div>
                {dayTasks.length === 0 && <div style={{ fontSize: 10, color: '#3a3a3a', textAlign: 'center', padding: '12px 0' }}>—</div>}
                {dayTasks.map(t => {
                  const cfg = TAREA_CFG[t.tipo] || TAREA_CFG.otro; const prio = PRIO_CFG[t.prioridad]; const done = t.estatus === 'completada'
                  return (
                    <div key={t.id} onClick={() => setModal(t)} style={{ background: '#161616', border: `1px solid ${t.estatus === 'en_ruta' ? '#2563EB' : '#262626'}`, borderLeft: `3px solid ${prio?.color || '#666'}`, borderRadius: 6, padding: '6px 8px', marginBottom: 6, opacity: done ? 0.55 : 1, cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#eee', textDecoration: done ? 'line-through' : 'none' }}>{cfg.icon} {t.titulo}</div>
                        <button onClick={e => { e.stopPropagation(); del(t) }} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', flexShrink: 0, padding: 0 }}><X size={11} /></button>
                      </div>
                      {(t.hora || t.ubicacion) && <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>{t.hora ? t.hora.slice(0, 5) + ' ' : ''}{t.ubicacion ? '· ' + t.ubicacion : ''}</div>}
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        <button onClick={e => { e.stopPropagation(); cycleEstatus(t) }} style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: done ? '#10B98122' : t.estatus === 'en_ruta' ? '#2563EB22' : '#33333366', color: done ? '#10B981' : t.estatus === 'en_ruta' ? '#60A5FA' : '#999' }}>
                          {done ? '✓ Completada' : t.estatus === 'en_ruta' ? '● En ruta' : 'Pendiente'}
                        </button>
                        {t.tipo === 'entrega' && Array.isArray(t.items) && t.items.length > 0 && (
                          <button onClick={e => { e.stopPropagation(); generarRecibosEntrega({ folio: t.folio || t.id.slice(0, 8), fecha: t.fecha, leadName: leads.find((l: any) => l.id === t.lead_id)?.name || t.titulo, ubicacion: t.ubicacion, chofer: t.asignado_nombre, recibeNombre: t.recibe_nombre, recibeRol: t.recibe_rol, items: t.items, notas: t.notas }) }} style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: '#57FF9A22', color: '#57FF9A' }}>🧾 Recibos</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {modal && <TareaModal init={modal} obras={obras} leads={leads} empleados={empleados} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />}
    </div>
  )
}

const fmtQ = (n: number) => Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 })

// Genera 2 recibos imprimibles (chofer + obra) — uno por entrega, consolidando orígenes
function generarRecibosEntrega({ folio, fecha, leadName, ubicacion, chofer, recibeNombre, recibeRol, items, notas }: any) {
  const rolLabel: any = { instalador: 'Instalador OMM', residente: 'Residente de obra', cliente: 'Cliente' }
  const fechaTxt = (() => { try { return new Date(fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }) } catch { return fecha } })()
  const filas = items.map((it: any, i: number) => `<tr><td style="text-align:center">${i + 1}</td><td>${it.marca || ''}</td><td>${it.modelo || ''}</td><td>${it.descripcion || ''}</td><td style="text-align:center;font-weight:700">${fmtQ(it.qty)}</td></tr>`).join('')
  const totalPzs = items.reduce((s: number, it: any) => s + Number(it.qty || 0), 0)
  const bloque = (titulo: string, quienLabel: string, quienNombre: string, leyenda: string) => `
    <div class="recibo">
      <div class="hd"><div><div class="logo">OMM</div><div class="sub">OMM Technologies · Entrega de material</div></div>
        <div style="text-align:right"><div class="folio">${folio}</div><div class="sub">${fechaTxt}</div></div></div>
      <div class="tt">${titulo}</div>
      <table class="meta"><tr><td style="width:55%"><b>Obra / Lead:</b> ${leadName}</td><td><b>Ubicación:</b> ${ubicacion || '—'}</td></tr>
        <tr><td><b>Chofer:</b> ${chofer || '—'}</td><td><b>${quienLabel}:</b> ${quienNombre || '—'}</td></tr></table>
      <table class="items"><thead><tr><th style="width:34px">#</th><th>Marca</th><th>Modelo</th><th>Descripción</th><th style="width:60px">Cant.</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><td colspan="4" style="text-align:right"><b>Total de piezas</b></td><td style="text-align:center"><b>${fmtQ(totalPzs)}</b></td></tr></tfoot></table>
      ${notas ? `<div class="notas"><b>Notas:</b> ${notas}</div>` : ''}
      <div class="leyenda">${leyenda}</div>
      <div class="firmas"><div class="fw"><div class="ln"></div>${quienNombre || quienLabel}<div class="sub">Firma de quien recibe</div></div>
        <div class="fw"><div class="ln"></div>OMM Technologies<div class="sub">Entregó</div></div></div>
    </div>`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Recibos ${folio}</title><style>
    *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
    body{margin:0;color:#111}
    .recibo{padding:34px 40px;page-break-after:always}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:10px}
    .logo{font-size:30px;font-weight:800;letter-spacing:1px}
    .sub{font-size:11px;color:#666;margin-top:2px}
    .folio{font-size:15px;font-weight:700}
    .tt{font-size:16px;font-weight:800;margin:18px 0 12px;text-transform:uppercase}
    table{width:100%;border-collapse:collapse;font-size:12px}
    .meta td{padding:3px 0;font-size:12px}
    .items{margin-top:8px}
    .items th{background:#111;color:#fff;padding:7px 8px;text-align:left;font-size:11px}
    .items td{border-bottom:1px solid #ddd;padding:6px 8px}
    .items tfoot td{border:none;padding-top:8px}
    .notas{margin-top:12px;font-size:12px}
    .leyenda{margin-top:20px;font-size:11px;color:#333;line-height:1.5;border:1px solid #ccc;border-radius:6px;padding:10px}
    .firmas{display:flex;gap:60px;margin-top:54px}
    .fw{flex:1;text-align:center;font-size:12px}
    .ln{border-top:1px solid #111;margin-bottom:6px;height:1px}
    @media print{.recibo{padding:24px 30px}}
  </style></head><body>
  ${bloque('Recibo del chofer', 'Recibe (chofer)', chofer, 'El chofer confirma que RECIBE la mercancía descrita, en buen estado y en las cantidades indicadas, haciéndose responsable de su traslado hasta la obra destino.')}
  ${bloque('Recibo en obra', (rolLabel[recibeRol] || 'Recibe en obra'), recibeNombre, 'Quien recibe en obra confirma haber RECIBIDO la mercancía descrita en las cantidades indicadas y en buen estado.')}
  <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
  </body></html>`
  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close() }
}

function TareaModal({ init, obras, leads, empleados, onClose, onSaved }: any) {
  const [tipo, setTipo] = useState(init.tipo || 'otro')
  const [titulo, setTitulo] = useState(init.titulo || '')
  const [fecha, setFecha] = useState(init.fecha || new Date().toISOString().slice(0, 10))
  const [hora, setHora] = useState(init.hora ? String(init.hora).slice(0, 5) : '')
  const [ubicacion, setUbicacion] = useState(init.ubicacion || '')
  const [prioridad, setPrioridad] = useState(init.prioridad || 'media')
  const [leadId, setLeadId] = useState(init.lead_id || '')
  const [obraId, setObraId] = useState(init.obra_id || '')
  const [asignado, setAsignado] = useState(init.asignado_a || '')
  const [notas, setNotas] = useState(init.notas || '')
  const [saving, setSaving] = useState(false)

  // ── Entrega builder ──
  const [invByLead, setInvByLead] = useState<Record<string, any> | null>(null)
  const [loadingInv, setLoadingInv] = useState(false)
  const [entLead, setEntLead] = useState(init.tipo === 'entrega' ? (init.lead_id || '') : '')
  const [sel, setSel] = useState<Record<string, { qty: number; on: boolean }>>({})
  const [recibeNombre, setRecibeNombre] = useState(init.recibe_nombre || '')
  const [recibeRol, setRecibeRol] = useState(init.recibe_rol || 'instalador')

  // ── Recolección builder ──
  const [recoLoaded, setRecoLoaded] = useState(false)
  const [loadingReco, setLoadingReco] = useState(false)
  const [recoPos, setRecoPos] = useState<any[]>([])
  const [supMap, setSupMap] = useState<Record<string, string>>({})
  const [recoProv, setRecoProv] = useState('')
  const [recoPo, setRecoPo] = useState(init.po_id || '')
  const [recoItems, setRecoItems] = useState<any[]>(Array.isArray(init.items) && init.tipo === 'recoleccion' ? init.items : [])

  // Personal que puede recibir en obra (por puesto de campo)
  const FIELD_RE = /INSTALADOR|OFICIAL|CHALAN|MANTENIMIENTO|INGENIERO INSTALAC|COORDINADOR LOG|CHOFER|RESIDENTE|DIRECTOR INSTALA/i
  const personalCampo = (empleados || []).filter((e: any) => FIELD_RE.test((e.puesto || '')))

  useEffect(() => {
    if (tipo !== 'entrega' || invByLead) return
    (async () => { setLoadingInv(true); setInvByLead(await cargarInventarioEntregable()); setLoadingInv(false) })()
  }, [tipo])

  useEffect(() => {
    if (tipo !== 'recoleccion' || recoLoaded) return
    (async () => {
      setLoadingReco(true)
      const { data: pR } = await supabase.from('purchase_orders').select('id, po_number, supplier_id, quotation_id, status, logistics_mode').neq('status', 'cancelada')
      // Recolección = las que NOSOTROS recogemos (modo pickup) o sin modo definido; nunca borrador
      const pos = ((pR.data as any[]) || []).filter(p => p.status !== 'borrador' && (!p.logistics_mode || String(p.logistics_mode).startsWith('pickup')))
      setRecoPos(pos)
      const supIds = [...new Set(pos.map(p => p.supplier_id).filter(Boolean))]
      if (supIds.length) { const { data: sR } = await supabase.from('suppliers').select('id, name').in('id', supIds); const m: any = {}; ((sR.data as any[]) || []).forEach(s => m[s.id] = s.name); setSupMap(m) }
      setRecoLoaded(true); setLoadingReco(false)
    })()
  }, [tipo])

  async function cargarRecoItems(poId: string) {
    setRecoPo(poId)
    if (!poId) { setRecoItems([]); return }
    const { data } = await supabase.from('po_items').select('catalog_product_id, name, marca, modelo, quantity, unit').eq('purchase_order_id', poId)
    setRecoItems(((data as any[]) || []).map(it => ({ catalog_product_id: it.catalog_product_id || null, marca: it.marca || '', modelo: it.modelo || '', descripcion: it.name || '', qty: Number(it.quantity) || 1, unit: it.unit || 'pza' })))
  }

  useEffect(() => {
    if (init.id && init.tipo === 'entrega' && Array.isArray(init.items)) {
      const s: any = {}; init.items.forEach((it: any) => { s[it.key] = { qty: Number(it.qty) || 0, on: true } }); setSel(s)
    }
  }, [])

  async function cargarInventarioEntregable(): Promise<Record<string, any>> {
    const { data: cotsRaw } = await supabase.from('quotations').select('id,name,specialty,notes,created_at').eq('stage', 'contrato')
    const cots = ((cotsRaw as any[]) || []).filter(c => c.specialty !== 'proy' && c.specialty !== 'cort').map(c => { let lead_id: string | null = null; try { lead_id = JSON.parse(c.notes || '{}').lead_id || null } catch { }; return { id: c.id, name: c.name, specialty: c.specialty, lead_id } }).filter(c => c.lead_id)
    const cotIds = cots.map(c => c.id)
    if (!cotIds.length) return {}
    const { data: posRaw } = await supabase.from('purchase_orders').select('id,quotation_id,status').in('quotation_id', cotIds)
    const pos = ((posRaw as any[]) || []).filter(p => p.status !== 'cancelada')
    const poCot: any = {}; pos.forEach(p => poCot[p.id] = p.quotation_id)
    const confirmedPoIds = pos.filter(p => p.status !== 'borrador').map(p => p.id)
    const allPoIds = pos.map(p => p.id)
    let poItems: any[] = []
    if (confirmedPoIds.length) { const { data } = await supabase.from('po_items').select('purchase_order_id,catalog_product_id,name,marca,modelo,quantity').in('purchase_order_id', confirmedPoIds); poItems = data || [] }
    const mv1 = (await supabase.from('stock_movements').select('*').eq('anulado', false).in('quotation_id', cotIds)).data || []
    const mv2 = allPoIds.length ? ((await supabase.from('stock_movements').select('*').eq('anulado', false).in('po_id', allPoIds)).data || []) : []
    const movs = [...mv1, ...mv2.filter((m: any) => !mv1.find((x: any) => x.id === m.id))]
    const keyOf = (it: any) => it.catalog_product_id || `${(it.marca || '').toLowerCase()}|${(it.modelo || '').toLowerCase()}|${(it.name || it.descripcion || '').toLowerCase()}`
    const leadName = (lid: string) => (leads.find((l: any) => l.id === lid)?.name) || 'Lead'
    const byLead: Record<string, any> = {}
    const ensureLead = (lid: string) => { if (!byLead[lid]) byLead[lid] = { name: leadName(lid), map: new Map() }; return byLead[lid] }
    const ensureLine = (lid: string, cot: any, it: any) => { const L = ensureLead(lid); const k = cot.id + '::' + keyOf(it); if (!L.map.has(k)) L.map.set(k, { key: k, quotation_id: cot.id, cotName: cot.name, specialty: cot.specialty, marca: it.marca || '', modelo: it.modelo || '', descripcion: it.name || it.descripcion || '', comprado: 0, recibido: 0, entregado: 0 }); return L.map.get(k) }
    cots.forEach(cot => { poItems.filter(pi => poCot[pi.purchase_order_id] === cot.id).forEach(pi => { const r = ensureLine(cot.lead_id!, cot, pi); r.comprado += Number(pi.quantity) || 0 }) })
    movs.forEach((m: any) => { const mCot = m.quotation_id || (m.po_id ? poCot[m.po_id] : null); const cot = cots.find(c => c.id === mCot); if (!cot) return; const r = ensureLine(cot.lead_id!, cot, m); if (m.tipo === 'recepcion_compra') r.recibido += Number(m.qty) || 0; if (m.destino_tipo === 'obra') r.entregado += Number(m.qty) || 0 })
    const out: Record<string, any> = {}
    Object.entries(byLead).forEach(([lid, v]: any) => {
      const lines = Array.from(v.map.values()).map((r: any) => ({ ...r, en_bodega: Math.max(0, r.recibido - r.entregado), por_recibir: Math.max(0, r.comprado - r.recibido), por_entregar: Math.max(0, r.comprado - r.entregado) })).filter((r: any) => r.por_entregar > 0).sort((a: any, b: any) => (a.specialty || '').localeCompare(b.specialty || '') || (a.descripcion || '').localeCompare(b.descripcion || ''))
      if (lines.length) out[lid] = { name: v.name, lines }
    })
    return out
  }

  const esEntrega = tipo === 'entrega'
  const esReco = tipo === 'recoleccion'
  const provList = [...new Set(recoPos.map(p => p.supplier_id).filter(Boolean))].map(id => ({ id, name: supMap[id] || 'Proveedor' })).sort((a, b) => a.name.localeCompare(b.name))
  const recoPoObj = recoPos.find(p => p.id === recoPo)
  const leadsInv = invByLead ? Object.entries(invByLead).map(([id, v]: any) => ({ id, name: v.name, n: v.lines.length })).sort((a, b) => a.name.localeCompare(b.name)) : []
  const lineas = (entLead && invByLead && invByLead[entLead]) ? invByLead[entLead].lines : []
  const leadNameEnt = invByLead && invByLead[entLead] ? invByLead[entLead].name : ''

  function toggle(ln: any) { setSel(s => { const cur = s[ln.key]; if (cur?.on) return { ...s, [ln.key]: { ...cur, on: false } }; const def = ln.en_bodega > 0 ? ln.en_bodega : ln.por_entregar; return { ...s, [ln.key]: { qty: cur?.qty || def, on: true } } }) }
  function setQty(k: string, v: number) { setSel(s => ({ ...s, [k]: { qty: v, on: true } })) }
  const itemsSel = () => lineas.filter((l: any) => sel[l.key]?.on && (sel[l.key]?.qty || 0) > 0).map((l: any) => ({ key: l.key, quotation_id: l.quotation_id, marca: l.marca, modelo: l.modelo, descripcion: l.descripcion, qty: Number(sel[l.key].qty) }))

  async function guardar() {
    if (esReco) {
      if (!recoPo) { alert('Selecciona la orden de compra a recolectar.'); return }
      setSaving(true)
      const prov = supMap[recoPoObj?.supplier_id] || 'Proveedor'
      const row: any = { tipo: 'recoleccion', titulo: (titulo.trim() || ('Recolección — ' + prov + (recoPoObj?.po_number ? ' · ' + recoPoObj.po_number : ''))), fecha, hora: hora || null, ubicacion: ubicacion || null, prioridad, lead_id: null, obra_id: null, po_id: recoPo, asignado_a: asignado || null, asignado_nombre: empleados.find((e: any) => e.id === asignado)?.nombre || null, notas: notas || null, items: recoItems }
      const res = init.id ? await supabase.from('logistics_tasks').update(row).eq('id', init.id) : await supabase.from('logistics_tasks').insert(row)
      if (res.error) { alert('Error: ' + res.error.message); setSaving(false); return }
      setSaving(false); onSaved(); return
    }
    if (esEntrega) {
      if (!entLead) { alert('Selecciona la obra/lead destino (solo aparecen los que tienen inventario).'); return }
      const items = itemsSel()
      if (items.length === 0) { alert('Marca al menos un equipo a entregar.'); return }
      setSaving(true)
      const folio = init.folio || ('ENT-' + fecha.slice(2).replace(/-/g, '') + '-' + Math.floor(Math.random() * 900 + 100))
      const chofer = empleados.find((e: any) => e.id === asignado)?.nombre || ''
      const row: any = { tipo: 'entrega', titulo: (titulo.trim() || ('Entrega — ' + leadNameEnt)), fecha, hora: hora || null, ubicacion: ubicacion || null, prioridad, lead_id: entLead, obra_id: null, po_id: null, asignado_a: asignado || null, asignado_nombre: chofer || null, notas: notas || null, items, recibe_nombre: recibeNombre || null, recibe_rol: recibeRol || null, folio }
      const res = init.id ? await supabase.from('logistics_tasks').update(row).eq('id', init.id) : await supabase.from('logistics_tasks').insert(row)
      if (res.error) { alert('Error: ' + res.error.message); setSaving(false); return }
      generarRecibosEntrega({ folio, fecha, leadName: leadNameEnt, ubicacion, chofer, recibeNombre, recibeRol, items, notas })
      setSaving(false); onSaved(); return
    }
    if (!titulo.trim()) { alert('Ponle un título a la tarea.'); return }
    setSaving(true)
    const row: any = { tipo, titulo: titulo.trim(), fecha, hora: hora || null, ubicacion: ubicacion || null, prioridad, lead_id: leadId || null, obra_id: obraId || null, asignado_a: asignado || null, asignado_nombre: empleados.find((e: any) => e.id === asignado)?.nombre || null, notas: notas || null }
    const res = init.id ? await supabase.from('logistics_tasks').update(row).eq('id', init.id) : await supabase.from('logistics_tasks').insert(row)
    if (res.error) { alert('Error: ' + res.error.message); setSaving(false); return }
    setSaving(false); onSaved()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#141414', border: '1px solid #333', borderRadius: 14, width: (esEntrega || esReco) ? 'min(720px, 96vw)' : 'min(560px, 96vw)', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{init.id ? (esEntrega ? 'Editar entrega' : esReco ? 'Editar recolección' : 'Editar tarea') : (esEntrega ? 'Programar entrega' : esReco ? 'Programar recolección' : 'Nueva tarea de ruta')}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <label style={labelStyle}>Tipo</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 14 }}>
          {Object.keys(TAREA_CFG).map(k => (
            <button key={k} onClick={() => setTipo(k)} style={{ padding: '6px 4px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 600, background: tipo === k ? TAREA_CFG[k].color + '22' : '#0e0e0e', border: `1px solid ${tipo === k ? TAREA_CFG[k].color : '#2a2a2a'}`, color: tipo === k ? '#fff' : '#999' }}>{TAREA_CFG[k].icon} {TAREA_CFG[k].label}</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div><label style={labelStyle}>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Hora</label><input type="time" value={hora} onChange={e => setHora(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Prioridad</label>
            <select value={prioridad} onChange={e => setPrioridad(e.target.value)} style={inputStyle}>
              {Object.keys(PRIO_CFG).map(k => <option key={k} value={k}>{PRIO_CFG[k].label}</option>)}
            </select>
          </div>
        </div>

        {esReco ? (
          <>
            <label style={labelStyle}>Proveedor</label>
            {loadingReco ? <div style={{ fontSize: 12, color: '#888', padding: '8px 0', marginBottom: 12 }}>Cargando órdenes por recolectar…</div> : (
              <select value={recoProv} onChange={e => { setRecoProv(e.target.value); setRecoPo(''); setRecoItems([]) }} style={{ ...inputStyle, marginBottom: 12 }}>
                <option value="">Selecciona proveedor…</option>
                {provList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {!loadingReco && provList.length === 0 && <div style={{ fontSize: 12, color: '#D97706', marginBottom: 12 }}>No hay órdenes por recolectar (modo pickup, confirmadas).</div>}

            {recoProv && (
              <>
                <label style={labelStyle}>Orden de compra</label>
                <select value={recoPo} onChange={e => cargarRecoItems(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
                  <option value="">Selecciona OC…</option>
                  {recoPos.filter(p => p.supplier_id === recoProv).map(p => <option key={p.id} value={p.id}>{p.po_number}</option>)}
                </select>
              </>
            )}

            {recoPo && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Qué se recolecta ({recoItems.length} partidas)</label>
                <div style={{ border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead><tr style={{ background: '#0f0f0f', color: '#777', textAlign: 'left' }}>
                      <th style={{ padding: '7px 8px' }}>Equipo</th>
                      <th style={{ padding: '7px 8px', textAlign: 'center', width: 70 }}>Cant.</th>
                    </tr></thead>
                    <tbody>
                      {recoItems.length === 0 ? <tr><td colSpan={2} style={{ padding: '10px 8px', color: '#666', fontSize: 11 }}>Esta OC no tiene partidas.</td></tr> : recoItems.map((it, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #1a1a1a', color: '#ccc' }}>
                          <td style={{ padding: '6px 8px', color: '#eee' }}>{it.marca ? it.marca + ' ' : ''}{it.modelo || it.descripcion}{it.modelo && it.descripcion && it.descripcion !== it.modelo ? <span style={{ display: 'block', color: '#666', fontSize: 10 }}>{it.descripcion}</span> : null}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700, color: '#fff' }}>{fmtQ(it.qty)} <span style={{ color: '#666', fontWeight: 400, fontSize: 10 }}>{it.unit}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <label style={labelStyle}>Ubicación / dirección de recolección</label>
            <input value={ubicacion} onChange={e => setUbicacion(e.target.value)} placeholder="Dónde se recoge el material" style={{ ...inputStyle, marginBottom: 12 }} />

            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Chofer / responsable</label>
              <select value={asignado} onChange={e => setAsignado(e.target.value)} style={inputStyle}>
                <option value="">—</option>
                {empleados.map((e: any) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </div>
          </>
        ) : esEntrega ? (
          <>
            <label style={labelStyle}>Destino — obra / lead con inventario</label>
            {loadingInv ? <div style={{ fontSize: 12, color: '#888', padding: '8px 0', marginBottom: 12 }}>Cargando inventario entregable…</div> : (
              <select value={entLead} onChange={e => { setEntLead(e.target.value); setSel({}) }} style={{ ...inputStyle, marginBottom: 12 }}>
                <option value="">Selecciona…</option>
                {leadsInv.map(l => <option key={l.id} value={l.id}>{l.name} ({l.n} {l.n === 1 ? 'artículo' : 'artículos'})</option>)}
              </select>
            )}
            {!loadingInv && leadsInv.length === 0 && <div style={{ fontSize: 12, color: '#D97706', marginBottom: 12 }}>No hay obras con inventario pendiente de entregar (comprado o en bodega).</div>}

            {entLead && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Equipos a entregar — marca lo que se manda</label>
                <div style={{ border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead><tr style={{ background: '#0f0f0f', color: '#777', textAlign: 'left' }}>
                      <th style={{ padding: '7px 8px', width: 30 }}></th>
                      <th style={{ padding: '7px 8px' }}>Equipo</th>
                      <th style={{ padding: '7px 8px', textAlign: 'center' }}>Disponibilidad</th>
                      <th style={{ padding: '7px 8px', textAlign: 'center', width: 72 }}>Enviar</th>
                    </tr></thead>
                    <tbody>
                      {lineas.map((l: any) => {
                        const esp = SPECIALTY_CONFIG[l.specialty as keyof typeof SPECIALTY_CONFIG]
                        const on = !!sel[l.key]?.on
                        return (
                          <tr key={l.key} style={{ borderTop: '1px solid #1a1a1a', color: '#ccc', background: on ? '#132015' : 'transparent' }}>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}><input type="checkbox" checked={on} onChange={() => toggle(l)} style={{ cursor: 'pointer' }} /></td>
                            <td style={{ padding: '6px 8px', color: '#eee' }}>
                              <div>{l.marca ? l.marca + ' ' : ''}{l.modelo || l.descripcion}</div>
                              <div style={{ fontSize: 9.5, color: '#666' }}>{esp ? <span style={{ color: esp.color }}>{esp.label}</span> : ''}{l.modelo && l.descripcion && l.descripcion !== l.modelo ? ' · ' + l.descripcion : ''}</div>
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <span style={{ color: l.en_bodega > 0 ? '#10B981' : '#555' }}>Bodega {fmtQ(l.en_bodega)}</span>
                              {l.por_recibir > 0 && <span style={{ color: '#D97706' }}> · por recibir {fmtQ(l.por_recibir)}</span>}
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                              <input type="number" min={0} max={l.por_entregar} value={sel[l.key]?.qty ?? ''} placeholder={String(l.en_bodega > 0 ? l.en_bodega : l.por_entregar)} onChange={e => setQty(l.key, Math.min(l.por_entregar, Number(e.target.value) || 0))} style={{ ...inputStyle, width: 60, padding: '4px 6px', textAlign: 'center' }} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>Si un artículo está "por recibir", primero se recolecta del proveedor y luego se entrega todo junto — un solo recibo.</div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div><label style={labelStyle}>Recibe en obra (nombre)</label>
                {recibeRol === 'instalador' ? (
                  <select value={recibeNombre} onChange={e => setRecibeNombre(e.target.value)} style={inputStyle}>
                    <option value="">— Elige instalador —</option>
                    {personalCampo.map((e: any) => <option key={e.id} value={e.nombre}>{e.nombre}{e.puesto ? ' · ' + e.puesto.trim() : ''}</option>)}
                  </select>
                ) : (
                  <input value={recibeNombre} onChange={e => setRecibeNombre(e.target.value)} placeholder="Nombre de quien recibe" style={inputStyle} />
                )}
              </div>
              <div><label style={labelStyle}>Rol de quien recibe</label>
                <select value={recibeRol} onChange={e => setRecibeRol(e.target.value)} style={inputStyle}>
                  <option value="instalador">Instalador OMM</option>
                  <option value="residente">Residente de obra</option>
                  <option value="cliente">Cliente</option>
                </select>
              </div>
            </div>

            <label style={labelStyle}>Ubicación de entrega</label>
            <input value={ubicacion} onChange={e => setUbicacion(e.target.value)} placeholder="Dirección de la obra" style={{ ...inputStyle, marginBottom: 12 }} />

            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Chofer / responsable de llevarlo</label>
              <select value={asignado} onChange={e => setAsignado(e.target.value)} style={inputStyle}>
                <option value="">—</option>
                {empleados.map((e: any) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </div>
          </>
        ) : (
          <>
            <label style={labelStyle}>Título</label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ej. Llevar muestras de tela a cliente" style={{ ...inputStyle, marginBottom: 12 }} />

            <label style={labelStyle}>Ubicación</label>
            <input value={ubicacion} onChange={e => setUbicacion(e.target.value)} placeholder="Dirección / obra / lugar" style={{ ...inputStyle, marginBottom: 12 }} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div><label style={labelStyle}>Lead (opcional)</label>
                <select value={leadId} onChange={e => setLeadId(e.target.value)} style={inputStyle}>
                  <option value="">—</option>
                  {leads.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>Obra (opcional)</label>
                <select value={obraId} onChange={e => setObraId(e.target.value)} style={inputStyle}>
                  <option value="">—</option>
                  {obras.map((o: any) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Asignado a</label>
              <select value={asignado} onChange={e => setAsignado(e.target.value)} style={inputStyle}>
                <option value="">—</option>
                {empleados.map((e: any) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </div>
          </>
        )}

        <div style={{ marginBottom: 18 }}><label style={labelStyle}>Notas</label><input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Detalle (opcional)" style={inputStyle} /></div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Btn variant="default" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : (esEntrega ? (init.id ? 'Guardar y generar recibos' : 'Programar y generar recibos') : esReco ? (init.id ? 'Guardar' : 'Programar recolección') : (init.id ? 'Guardar' : 'Crear tarea'))}</Btn>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════ HERRAMIENTA Y EQUIPO ═══════════════════════════
const CAT_CFG: Record<string, { label: string; icon: string; color: string }> = {
  herramienta: { label: 'Herramienta', icon: '🔧', color: '#F59E0B' },
  computo: { label: 'Cómputo', icon: '💻', color: '#3B82F6' },
  vehiculo: { label: 'Vehículo', icon: '🚚', color: '#10B981' },
  mobiliario: { label: 'Mobiliario', icon: '🪑', color: '#A78BFA' },
  otro: { label: 'Otro', icon: '📦', color: '#6B7280' },
}
const EST_CFG: Record<string, { label: string; color: string }> = {
  activo: { label: 'Activo', color: '#10B981' },
  en_reparacion: { label: 'En reparación', color: '#D97706' },
  perdido: { label: 'Perdido', color: '#DC2626' },
  baja: { label: 'Baja', color: '#6B7280' },
}

function TabHerramienta({ obras, empleados, isMobile }: any) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<any>(null)
  const [fCat, setFCat] = useState('todas')
  const [fEst, setFEst] = useState('activos')
  const [q, setQ] = useState('')

  const load = async () => { setLoading(true); const { data } = await supabase.from('assets').select('*').order('nombre'); setRows((data as any[]) || []); setLoading(false) }
  useEffect(() => { load() }, [])

  async function darBaja(a: any) { if (!confirm(`¿Dar de baja "${a.nombre}"?`)) return; await supabase.from('assets').update({ estatus: 'baja', updated_at: new Date().toISOString() }).eq('id', a.id); load() }

  const lista = rows.filter(a => {
    if (fCat !== 'todas' && a.categoria !== fCat) return false
    if (fEst === 'activos' && a.estatus === 'baja') return false
    if (fEst !== 'activos' && fEst !== 'todos' && a.estatus !== fEst) return false
    if (q.trim()) { const s = q.toLowerCase(); if (!(`${a.nombre} ${a.marca || ''} ${a.modelo || ''} ${a.serie || ''} ${a.responsable_nombre || ''} ${a.ubicacion_nombre || ''}`.toLowerCase().includes(s))) return false }
    return true
  })
  const activos = rows.filter(a => a.estatus !== 'baja')
  const valorTotal = activos.reduce((s, a) => s + Number(a.valor || 0), 0)
  const enRep = rows.filter(a => a.estatus === 'en_reparacion').length

  if (loading) return <Loading />
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        <KpiCard label="Activos" value={activos.length} icon={<Wrench size={16} />} />
        <KpiCard label="En reparación" value={enRep} color="#D97706" icon={<Wrench size={16} />} />
        <KpiCard label="Equipos de cómputo" value={activos.filter(a => a.categoria === 'computo').length} color="#3B82F6" icon={<Laptop size={16} />} />
        <KpiCard label="Valor estimado" value={'$' + fmtQ(valorTotal)} color="#10B981" icon={<PackageCheck size={16} />} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={fCat} onChange={e => setFCat(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="todas">Todas las categorías</option>
          {Object.keys(CAT_CFG).map(k => <option key={k} value={k}>{CAT_CFG[k].icon} {CAT_CFG[k].label}</option>)}
        </select>
        <select value={fEst} onChange={e => setFEst(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="activos">Activos (no baja)</option>
          <option value="en_reparacion">En reparación</option>
          <option value="perdido">Perdidos</option>
          <option value="baja">Bajas</option>
          <option value="todos">Todos</option>
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar equipo, serie, responsable…" style={{ ...inputStyle, width: 'auto', minWidth: 220 }} />
        <Btn size="sm" variant="primary" style={{ marginLeft: 'auto' }} onClick={() => setModal({})}><Plus size={12} /> Nuevo equipo</Btn>
      </div>

      {lista.length === 0 ? <EmptyState message="Sin equipos registrados. Usa 'Nuevo equipo' para empezar." /> : (
        <div style={{ overflowX: 'auto', border: '1px solid #1f1f1f', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 820 }}>
            <thead>
              <tr style={{ background: '#0f0f0f', color: '#777', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px' }}>Equipo</th>
                <th style={{ padding: '10px 12px' }}>Categoría</th>
                <th style={{ padding: '10px 12px' }}>Serie / código</th>
                <th style={{ padding: '10px 12px' }}>Responsable</th>
                <th style={{ padding: '10px 12px' }}>Ubicación</th>
                <th style={{ padding: '10px 12px' }}>Estatus</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {lista.map(a => {
                const cat = CAT_CFG[a.categoria] || CAT_CFG.otro; const est = EST_CFG[a.estatus] || EST_CFG.activo
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid #1a1a1a', color: '#ccc' }}>
                    <td style={{ padding: '8px 12px', color: '#eee' }}>{a.nombre}{(a.marca || a.modelo) ? <span style={{ display: 'block', color: '#666', fontSize: 10 }}>{a.marca} {a.modelo}</span> : null}</td>
                    <td style={{ padding: '8px 12px' }}><span style={{ fontSize: 11, fontWeight: 600, color: cat.color }}>{cat.icon} {cat.label}</span></td>
                    <td style={{ padding: '8px 12px', color: '#aaa' }}>{a.serie || '—'}</td>
                    <td style={{ padding: '8px 12px' }}>{a.responsable_nombre || <span style={{ color: '#555' }}>Sin asignar</span>}</td>
                    <td style={{ padding: '8px 12px', color: '#aaa' }}>{a.ubicacion_nombre || (a.ubicacion_tipo === 'oficina' ? 'Oficina' : a.ubicacion_tipo === 'bodega' ? 'Bodega' : '—')}</td>
                    <td style={{ padding: '8px 12px' }}><span style={{ fontSize: 11, fontWeight: 600, color: est.color }}>● {est.label}</span></td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button onClick={() => setModal(a)} style={{ background: 'none', border: 'none', color: '#67E8F9', cursor: 'pointer', marginRight: 8 }}><Pencil size={14} /></button>
                      {a.estatus !== 'baja' && <button onClick={() => darBaja(a)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><Trash2 size={14} /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && <AssetModal init={modal} obras={obras} empleados={empleados} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />}
    </div>
  )
}

function AssetModal({ init, obras, empleados, onClose, onSaved }: any) {
  const [nombre, setNombre] = useState(init.nombre || '')
  const [categoria, setCategoria] = useState(init.categoria || 'herramienta')
  const [marca, setMarca] = useState(init.marca || '')
  const [modelo, setModelo] = useState(init.modelo || '')
  const [serie, setSerie] = useState(init.serie || '')
  const [responsable, setResponsable] = useState(init.responsable_id || '')
  const [ubTipo, setUbTipo] = useState(init.ubicacion_tipo || 'oficina')
  const [ubObra, setUbObra] = useState(init.ubicacion_obra_id || '')
  const [estatus, setEstatus] = useState(init.estatus || 'activo')
  const [valor, setValor] = useState(init.valor ?? '')
  const [fechaAsig, setFechaAsig] = useState(init.fecha_asignacion || '')
  const [notas, setNotas] = useState(init.notas || '')
  const [saving, setSaving] = useState(false)

  async function guardar() {
    if (!nombre.trim()) { alert('Ponle nombre al equipo.'); return }
    setSaving(true)
    const respNombre = empleados.find((e: any) => e.id === responsable)?.nombre || null
    const obraNombre = ubTipo === 'obra' ? (obras.find((o: any) => o.id === ubObra)?.nombre || null) : (ubTipo === 'oficina' ? 'Oficina' : 'Bodega')
    const row: any = {
      nombre: nombre.trim(), categoria, marca: marca || null, modelo: modelo || null, serie: serie || null,
      responsable_id: responsable || null, responsable_nombre: respNombre,
      ubicacion_tipo: ubTipo, ubicacion_obra_id: ubTipo === 'obra' ? (ubObra || null) : null, ubicacion_nombre: obraNombre,
      estatus, valor: valor === '' ? null : Number(valor), fecha_asignacion: fechaAsig || null, notas: notas || null, updated_at: new Date().toISOString(),
    }
    const res = init.id ? await supabase.from('assets').update(row).eq('id', init.id) : await supabase.from('assets').insert(row)
    if (res.error) { alert('Error: ' + res.error.message); setSaving(false); return }
    setSaving(false); onSaved()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#141414', border: '1px solid #333', borderRadius: 14, width: 'min(620px, 96vw)', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{init.id ? 'Editar equipo' : 'Nuevo equipo'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <label style={labelStyle}>Nombre del equipo</label>
        <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Taladro Bosch, Laptop Dell Latitude…" style={{ ...inputStyle, marginBottom: 12 }} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div><label style={labelStyle}>Categoría</label>
            <select value={categoria} onChange={e => setCategoria(e.target.value)} style={inputStyle}>
              {Object.keys(CAT_CFG).map(k => <option key={k} value={k}>{CAT_CFG[k].icon} {CAT_CFG[k].label}</option>)}
            </select>
          </div>
          <div><label style={labelStyle}>Marca</label><input value={marca} onChange={e => setMarca(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Modelo</label><input value={modelo} onChange={e => setModelo(e.target.value)} style={inputStyle} /></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div><label style={labelStyle}>Serie / código interno</label><input value={serie} onChange={e => setSerie(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Responsable</label>
            <select value={responsable} onChange={e => setResponsable(e.target.value)} style={inputStyle}>
              <option value="">— Sin asignar —</option>
              {empleados.map((e: any) => <option key={e.id} value={e.id}>{e.nombre}{e.puesto ? ' · ' + e.puesto.trim() : ''}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: ubTipo === 'obra' ? '1fr 1fr' : '1fr', gap: 10, marginBottom: 12 }}>
          <div><label style={labelStyle}>Ubicación</label>
            <select value={ubTipo} onChange={e => setUbTipo(e.target.value)} style={inputStyle}>
              <option value="oficina">Oficina</option>
              <option value="bodega">Bodega</option>
              <option value="obra">En una obra</option>
            </select>
          </div>
          {ubTipo === 'obra' && (
            <div><label style={labelStyle}>Obra</label>
              <select value={ubObra} onChange={e => setUbObra(e.target.value)} style={inputStyle}>
                <option value="">— Elige obra —</option>
                {obras.map((o: any) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div><label style={labelStyle}>Estatus</label>
            <select value={estatus} onChange={e => setEstatus(e.target.value)} style={inputStyle}>
              {Object.keys(EST_CFG).map(k => <option key={k} value={k}>{EST_CFG[k].label}</option>)}
            </select>
          </div>
          <div><label style={labelStyle}>Valor (MXN)</label><input type="number" value={valor} onChange={e => setValor(e.target.value)} placeholder="0" style={inputStyle} /></div>
          <div><label style={labelStyle}>Fecha asignación</label><input type="date" value={fechaAsig} onChange={e => setFechaAsig(e.target.value)} style={inputStyle} /></div>
        </div>

        <div style={{ marginBottom: 18 }}><label style={labelStyle}>Notas</label><input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Estado físico, accesorios, etc." style={inputStyle} /></div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Btn variant="default" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : (init.id ? 'Guardar' : 'Registrar equipo')}</Btn>
        </div>
      </div>
    </div>
  )
}
