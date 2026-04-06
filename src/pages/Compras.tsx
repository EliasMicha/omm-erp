import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Project, CatalogProduct, ProjectLine, PurchasePhase } from '../types'
import { F, SPECIALTY_CONFIG, PHASE_CONFIG, formatDate } from '../lib/utils'
import { Badge, Btn, KpiCard, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { Plus, ChevronLeft, X, Search, Trash2, Save, ShoppingCart, Truck, Package, Users2, FileText, Copy } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
type POStatus = 'borrador' | 'aprobada' | 'pedida' | 'recibida_parcial' | 'recibida' | 'cancelada'
type PaymentTerms = 'contado' | 'credito_15' | 'credito_30' | 'credito_60' | 'anticipo_50'

interface Supplier {
  id: string
  created_at: string
  name: string
  contact_name?: string
  contact_phone?: string
  contact_email?: string
  rfc?: string
  address?: string
  payment_terms: PaymentTerms
  notes?: string
  is_active: boolean
  systems: string[]
}

interface PurchaseOrder {
  id: string
  created_at: string
  updated_at: string
  po_number: string
  project_id?: string
  supplier_id?: string
  quotation_id?: string
  specialty: ProjectLine
  purchase_phase?: PurchasePhase
  status: POStatus
  subtotal: number
  iva: number
  total: number
  notes?: string
  requested_by?: string
  approved_by?: string
  approved_at?: string
  expected_delivery?: string
  delivered_at?: string
  project?: Project
  supplier?: Supplier
}

interface POItem {
  id: string
  created_at: string
  purchase_order_id: string
  catalog_product_id?: string
  name: string
  description?: string
  system?: string
  unit: string
  quantity: number
  unit_cost: number
  total: number
  quantity_received: number
  order_index: number
  // Cotejo fields — valores reales de la compra
  real_name?: string
  real_unit_cost?: number
  real_quantity?: number
  real_total?: number
  cotejo_status: 'pendiente' | 'cotejado' | 'sustituido'
  cotejo_notes?: string
}

// ─── Config ───────────────────────────────────────────────────────────────────
const PO_STATUS_CFG: Record<POStatus, { label: string; color: string; order: number }> = {
  borrador:         { label: 'Borrador',         color: '#6B7280', order: 0 },
  aprobada:         { label: 'Aprobada',         color: '#3B82F6', order: 1 },
  pedida:           { label: 'Pedida',           color: '#F59E0B', order: 2 },
  recibida_parcial: { label: 'Parcial',          color: '#C084FC', order: 3 },
  recibida:         { label: 'Recibida',         color: '#57FF9A', order: 4 },
  cancelada:        { label: 'Cancelada',        color: '#EF4444', order: 5 },
}

const PAYMENT_TERMS_CFG: Record<PaymentTerms, string> = {
  contado:      'Contado',
  credito_15:   'Crédito 15 días',
  credito_30:   'Crédito 30 días',
  credito_60:   'Crédito 60 días',
  anticipo_50:  'Anticipo 50%',
}

const SYSTEM_OPTIONS = ['Redes', 'CCTV', 'Audio', 'Lutron', 'Acceso', 'Somfy', 'Electrico', 'Iluminacion', 'Cortinas', 'General']

// ─── Reusable Field ───────────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder = '', type = 'text', disabled = false }: {
  label: string; value: string; onChange?: (v: string) => void
  placeholder?: string; type?: string; disabled?: boolean
}) {
  return (
    <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block' }}>
      {label}
      <input type={type} value={value} onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        style={{
          display: 'block', width: '100%', marginTop: 4, padding: '8px 10px',
          background: disabled ? '#111' : '#1e1e1e', border: '1px solid #333',
          borderRadius: 8, color: disabled ? '#555' : '#fff', fontSize: 13,
          fontFamily: 'inherit', boxSizing: 'border-box' as const,
        }} />
    </label>
  )
}

function SelectField({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; placeholder?: string
}) {
  return (
    <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block' }}>
      {label}
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{
          display: 'block', width: '100%', marginTop: 4, padding: '8px 10px',
          background: '#1e1e1e', border: '1px solid #333', borderRadius: 8,
          color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const,
        }}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function Compras() {
  const [view, setView] = useState<'dashboard' | 'lista' | 'proveedores'>('dashboard')
  const [editingPO, setEditingPO] = useState<string | null>(null)
  const [editingSupplier, setEditingSupplier] = useState<string | null>(null)

  if (editingPO) return <POEditor poId={editingPO} onBack={() => { setEditingPO(null); setView('lista') }} />
  if (editingSupplier) return <SupplierDetail supplierId={editingSupplier} onBack={() => { setEditingSupplier(null); setView('proveedores') }} />

  return (
    <div style={{ padding: '24px 28px' }}>
      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #222', paddingBottom: 8 }}>
        {([
          { key: 'dashboard', label: 'Dashboard', icon: ShoppingCart },
          { key: 'lista', label: 'Órdenes de compra', icon: FileText },
          { key: 'proveedores', label: 'Proveedores', icon: Users2 },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setView(key)}
            style={{
              padding: '8px 16px', borderRadius: '8px 8px 0 0', fontSize: 12, cursor: 'pointer',
              fontFamily: 'inherit', fontWeight: view === key ? 600 : 400, border: 'none',
              background: view === key ? '#1e1e1e' : 'transparent',
              color: view === key ? '#57FF9A' : '#666',
              borderBottom: view === key ? '2px solid #57FF9A' : '2px solid transparent',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {view === 'dashboard' && <ComprasDashboard onOpenPO={id => { setEditingPO(id) }} onGoToList={() => setView('lista')} />}
      {view === 'lista' && <POList onOpen={id => setEditingPO(id)} />}
      {view === 'proveedores' && <SupplierList onOpen={id => setEditingSupplier(id)} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function ComprasDashboard({ onOpenPO, onGoToList }: { onOpenPO: (id: string) => void; onGoToList: () => void }) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('purchase_orders').select('*,project:projects(name),supplier:suppliers(name)')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setOrders(data || []); setLoading(false) })
  }, [])

  if (loading) return <Loading />

  const active = orders.filter(o => !['recibida', 'cancelada'].includes(o.status))
  const totalPendiente = active.reduce((s, o) => s + o.total, 0)
  const thisMonth = orders.filter(o => {
    const d = new Date(o.created_at)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const totalMes = thisMonth.reduce((s, o) => s + o.total, 0)
  const porRecibir = orders.filter(o => o.status === 'pedida' || o.status === 'recibida_parcial').length

  // Group by supplier
  const bySupplier: Record<string, { name: string; total: number; count: number }> = {}
  orders.forEach(o => {
    const sn = (o.supplier as any)?.name || 'Sin proveedor'
    if (!bySupplier[sn]) bySupplier[sn] = { name: sn, total: 0, count: 0 }
    bySupplier[sn].total += o.total
    bySupplier[sn].count++
  })
  const topSuppliers = Object.values(bySupplier).sort((a, b) => b.total - a.total).slice(0, 5)

  // Group by project
  const byProject: Record<string, { name: string; total: number }> = {}
  active.forEach(o => {
    const pn = (o.project as any)?.name || 'Sin proyecto'
    if (!byProject[pn]) byProject[pn] = { name: pn, total: 0 }
    byProject[pn].total += o.total
  })
  const topProjects = Object.values(byProject).sort((a, b) => b.total - a.total).slice(0, 5)

  return (
    <div>
      <SectionHeader title="Compras" subtitle={`${orders.length} órdenes totales`}
        action={<Btn variant="primary" onClick={onGoToList}><Plus size={14} /> Nueva OC</Btn>} />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label="OC Activas" value={active.length} color="#3B82F6" icon={<FileText size={16} />} />
        <KpiCard label="Total pendiente" value={F(totalPendiente)} color="#F59E0B" icon={<ShoppingCart size={16} />} />
        <KpiCard label="Compras del mes" value={F(totalMes)} color="#57FF9A" icon={<Package size={16} />} />
        <KpiCard label="Por recibir" value={porRecibir} color="#C084FC" icon={<Truck size={16} />} />
      </div>

      {/* Status summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8, marginBottom: 24 }}>
        {(Object.entries(PO_STATUS_CFG) as [POStatus, typeof PO_STATUS_CFG[POStatus]][]).map(([k, v]) => {
          const cnt = orders.filter(o => o.status === k).length
          return (
            <div key={k} style={{
              background: '#141414', border: '1px solid #222', borderRadius: 10,
              padding: '10px 12px', borderLeft: `3px solid ${v.color}`,
            }}>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', marginBottom: 4 }}>{v.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{cnt}</div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Top suppliers */}
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Top proveedores</div>
          {topSuppliers.length === 0 ? <EmptyState message="Sin datos" /> :
            topSuppliers.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1e1e1e' }}>
                <span style={{ fontSize: 12, color: '#ccc' }}>{s.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#57FF9A' }}>{F(s.total)} <span style={{ color: '#555', fontWeight: 400 }}>({s.count})</span></span>
              </div>
            ))
          }
        </div>
        {/* By project */}
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Compras por proyecto (activas)</div>
          {topProjects.length === 0 ? <EmptyState message="Sin datos" /> :
            topProjects.map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1e1e1e' }}>
                <span style={{ fontSize: 12, color: '#ccc' }}>{p.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#F59E0B' }}>{F(p.total)}</span>
              </div>
            ))
          }
        </div>
      </div>

      {/* Recent orders */}
      {active.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Órdenes activas recientes</div>
          <Table>
            <thead><tr>
              <Th>OC #</Th><Th>Proveedor</Th><Th>Proyecto</Th><Th>Especialidad</Th><Th>Fase</Th><Th>Estado</Th><Th right>Total</Th>
            </tr></thead>
            <tbody>
              {active.slice(0, 8).map(o => {
                const st = PO_STATUS_CFG[o.status]
                const esp = SPECIALTY_CONFIG[o.specialty]
                const phaseCfg = o.purchase_phase ? PHASE_CONFIG[o.purchase_phase] : null
                return (
                  <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => onOpenPO(o.id)}>
                    <Td><span style={{ fontWeight: 600, color: '#fff' }}>{o.po_number}</span></Td>
                    <Td>{(o.supplier as any)?.name || '--'}</Td>
                    <Td muted>{(o.project as any)?.name || '--'}</Td>
                    <Td><Badge label={esp.icon + ' ' + esp.label} color={esp.color} /></Td>
                    <Td>{phaseCfg ? <Badge label={phaseCfg.label} color={phaseCfg.color} /> : <span style={{color:'#555',fontSize:11}}>--</span>}</Td>
                    <Td><Badge label={st.label} color={st.color} /></Td>
                    <Td right><span style={{ fontWeight: 600, color: '#57FF9A' }}>{F(o.total)}</span></Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PO LIST
// ═══════════════════════════════════════════════════════════════════════════════
function POList({ onOpen }: { onOpen: (id: string) => void }) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('todas')
  const [filterSpec, setFilterSpec] = useState<string>('todas')
  const [showNew, setShowNew] = useState(false)
  const [showFromQuote, setShowFromQuote] = useState(false)

  const load = () => {
    setLoading(true)
    supabase.from('purchase_orders').select('*,project:projects(name,client_name),supplier:suppliers(name)')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setOrders(data || []); setLoading(false) })
  }
  useEffect(load, [])

  let lista = orders
  if (filterStatus !== 'todas') lista = lista.filter(o => o.status === filterStatus)
  if (filterSpec !== 'todas') lista = lista.filter(o => o.specialty === filterSpec)
  if (search) {
    const q = search.toLowerCase()
    lista = lista.filter(o =>
      o.po_number.toLowerCase().includes(q) ||
      (o.supplier as any)?.name?.toLowerCase().includes(q) ||
      (o.project as any)?.name?.toLowerCase().includes(q)
    )
  }

  const totalFiltered = lista.reduce((s, o) => s + o.total, 0)

  return (
    <div>
      <SectionHeader title="Órdenes de compra"
        subtitle={`${lista.length} órdenes | Total: ${F(totalFiltered)}`}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={() => setShowFromQuote(true)}><Copy size={14} /> Desde cotización</Btn>
            <Btn variant="primary" onClick={() => setShowNew(true)}><Plus size={14} /> Nueva OC</Btn>
          </div>
        } />

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '0 0 220px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#555' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar OC, proveedor, proyecto..."
            style={{
              width: '100%', padding: '7px 10px 7px 30px', background: '#1e1e1e',
              border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 12, fontFamily: 'inherit',
              boxSizing: 'border-box',
            }} />
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['todas', ...Object.keys(PO_STATUS_CFG)].map(s => {
            const on = filterStatus === s
            const cfg = s !== 'todas' ? PO_STATUS_CFG[s as POStatus] : null
            return (
              <button key={s} onClick={() => setFilterStatus(s)} style={{
                padding: '4px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${on ? (cfg?.color || '#57FF9A') : '#333'}`,
                background: on ? (cfg?.color || '#57FF9A') + '22' : 'transparent',
                color: on ? (cfg?.color || '#57FF9A') : '#555', fontWeight: on ? 600 : 400,
              }}>{s === 'todas' ? 'Todas' : cfg?.label}</button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['todas', 'esp', 'elec', 'ilum', 'cort'].map(f => {
            const on = filterSpec === f
            const cfg = f !== 'todas' ? SPECIALTY_CONFIG[f as ProjectLine] : null
            return (
              <button key={f} onClick={() => setFilterSpec(f)} style={{
                padding: '4px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${on ? (cfg?.color || '#57FF9A') : '#333'}`,
                background: on ? (cfg?.color || '#57FF9A') + '22' : 'transparent',
                color: on ? (cfg?.color || '#57FF9A') : '#555', fontWeight: on ? 600 : 400,
              }}>{f === 'todas' ? 'Todas' : cfg?.icon + ' ' + cfg?.label}</button>
            )
          })}
        </div>
      </div>

      {loading ? <Loading /> : (
        <Table>
          <thead><tr>
            <Th>OC #</Th><Th>Proveedor</Th><Th>Proyecto</Th><Th>Especialidad</Th><Th>Fase</Th><Th>Estado</Th><Th>Fecha</Th><Th right>Total</Th><Th></Th>
          </tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={9}><EmptyState message="Sin órdenes de compra" /></td></tr>}
            {lista.map(o => {
              const st = PO_STATUS_CFG[o.status]
              const esp = SPECIALTY_CONFIG[o.specialty]
              const phaseCfg = o.purchase_phase ? PHASE_CONFIG[o.purchase_phase] : null
              return (
                <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(o.id)}>
                  <Td><span style={{ fontWeight: 600, color: '#fff' }}>{o.po_number}</span></Td>
                  <Td>{(o.supplier as any)?.name || <span style={{ color: '#555' }}>--</span>}</Td>
                  <Td muted>{(o.project as any)?.name || '--'}</Td>
                  <Td><Badge label={esp.icon + ' ' + esp.label} color={esp.color} /></Td>
                  <Td>{phaseCfg ? <Badge label={phaseCfg.label} color={phaseCfg.color} /> : <span style={{color:'#555',fontSize:11}}>--</span>}</Td>
                  <Td><Badge label={st.label} color={st.color} /></Td>
                  <Td muted>{formatDate(o.created_at)}</Td>
                  <Td right><span style={{ fontWeight: 600, color: '#57FF9A' }}>{F(o.total)}</span></Td>
                  <Td><Btn size="sm" onClick={e => { e?.stopPropagation(); onOpen(o.id) }}>Abrir</Btn></Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {showNew && <NuevaPOModal onClose={() => setShowNew(false)} onCreated={id => { setShowNew(false); onOpen(id) }} />}
      {showFromQuote && <POFromQuoteModal onClose={() => setShowFromQuote(false)} onCreated={id => { setShowFromQuote(false); onOpen(id) }} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NUEVA PO (MANUAL)
// ═══════════════════════════════════════════════════════════════════════════════
function NuevaPOModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [form, setForm] = useState({ project_id: '', supplier_id: '', specialty: 'esp' as ProjectLine, notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('projects').select('*').eq('status', 'activo').order('name').then(({ data }) => setProjects(data || []))
    supabase.from('suppliers').select('*').eq('is_active', true).order('name').then(({ data }) => setSuppliers(data || []))
  }, [])

  async function crear() {
    setSaving(true); setError('')
    // Generate PO number: OC-YYMM-NNN
    const now = new Date()
    const prefix = `OC-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`
    const { count } = await supabase.from('purchase_orders').select('id', { count: 'exact', head: true })
      .like('po_number', `${prefix}%`)
    const num = String((count || 0) + 1).padStart(3, '0')
    const po_number = `${prefix}-${num}`

    const { data, error: err } = await supabase.from('purchase_orders').insert({
      po_number,
      project_id: form.project_id || null,
      supplier_id: form.supplier_id || null,
      specialty: form.specialty,
      status: 'borrador',
      subtotal: 0, iva: 0, total: 0,
      notes: form.notes || null,
    }).select().single()

    setSaving(false)
    if (err) { setError(err.message); return }
    if (data) onCreated(data.id)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24, width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Nueva orden de compra</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          <SelectField label="Proyecto" value={form.project_id} onChange={v => setForm(f => ({ ...f, project_id: v }))}
            options={projects.map(p => ({ value: p.id, label: `${p.name} — ${p.client_name}` }))} placeholder="-- Seleccionar proyecto --" />
          <SelectField label="Proveedor" value={form.supplier_id} onChange={v => setForm(f => ({ ...f, supplier_id: v }))}
            options={suppliers.map(s => ({ value: s.id, label: s.name }))} placeholder="-- Seleccionar proveedor --" />
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Especialidad
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {(Object.entries(SPECIALTY_CONFIG) as [ProjectLine, typeof SPECIALTY_CONFIG[ProjectLine]][])
                .filter(([k]) => k !== 'proy')
                .map(([k, v]) => (
                  <button key={k} onClick={() => setForm(f => ({ ...f, specialty: k }))}
                    style={{
                      padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                      border: `1px solid ${form.specialty === k ? v.color : '#333'}`,
                      background: form.specialty === k ? v.color + '22' : 'transparent',
                      color: form.specialty === k ? v.color : '#666',
                    }}>
                    {v.icon} {v.label}
                  </button>
                ))}
            </div>
          </label>
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Notas
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              placeholder="Instrucciones especiales, referencia de cotización del proveedor..."
              style={{
                display: 'block', width: '100%', marginTop: 4, padding: '8px 10px',
                background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff',
                fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
              }} />
          </label>
        </div>
        {error && <div style={{ color: '#EF4444', fontSize: 12, marginTop: 10 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={crear}>{saving ? 'Creando...' : 'Crear OC'}</Btn>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PO FROM QUOTATION
// ═══════════════════════════════════════════════════════════════════════════════
function POFromQuoteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [leads, setLeads] = useState<any[]>([])
  const [quotations, setQuotations] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [selectedLead, setSelectedLead] = useState('')
  const [selectedQuote, setSelectedQuote] = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState('')
  const [selectedPhase, setSelectedPhase] = useState('inicio' as PurchasePhase)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [previewItems, setPreviewItems] = useState<any[]>([])

  useEffect(() => {
    Promise.all([
      supabase.from('leads').select('id,name,company').order('name'),
      supabase.from('quotations').select('*,project:projects(name,client_name)').in('stage', ['propuesta', 'contrato']).order('updated_at', { ascending: false }),
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
    ]).then(([lRes, qRes, sRes]) => {
      setLeads(lRes.data || [])
      setQuotations(qRes.data || [])
      setSuppliers(sRes.data || [])
      setLoading(false)
    })
  }, [])

  // Filter quotations by lead
  const filteredQuotes = selectedLead
    ? quotations.filter(q => q.client_name?.toLowerCase().includes(leads.find(l => l.id === selectedLead)?.name?.toLowerCase() || ''))
    : quotations

  // Load preview items when quote + supplier + phase are selected
  useEffect(() => {
    if (!selectedQuote) { setPreviewItems([]); return }
    async function loadItems() {
      const { data: areas } = await supabase.from('quotation_areas').select('id').eq('quotation_id', selectedQuote)
      const areaIds = (areas || []).map((a: any) => a.id)
      if (areaIds.length === 0) { setPreviewItems([]); return }
      let query = supabase.from('quotation_items').select('*').in('area_id', areaIds).eq('type', 'material')
      const { data } = await query.order('order_index')
      let items = data || []
      // Filter by phase in JS (column may not exist in DB)
      if (selectedPhase) {
        const phaseFiltered = items.filter(it => it.purchase_phase === selectedPhase)
        if (phaseFiltered.length > 0) items = phaseFiltered
        // If no items match the phase, show all (phase column might not exist)
      }
      // Filter by supplier if selected
      if (selectedSupplier) {
        const sup = suppliers.find(s => s.id === selectedSupplier)
        if (sup) {
          const supLower = sup.name.toLowerCase()
          const filtered = items.filter(it => {
            if (it.supplier_id === selectedSupplier) return true
            const provLower = (it.provider || '').toLowerCase()
            // Match if provider name is contained in supplier name or vice versa
            if (provLower && (supLower.includes(provLower) || provLower.includes(supLower))) return true
            // Match first word (brand name like "Hikvision" in "Hikvision Mexico SA de CV")
            const supFirst = supLower.split(' ')[0]
            const provFirst = provLower.split(' ')[0]
            if (provFirst.length > 2 && supFirst.includes(provFirst)) return true
            if (supFirst.length > 2 && provFirst.includes(supFirst)) return true
            return false
          })
          // Only apply filter if it matches something; otherwise show all
          if (filtered.length > 0) items = filtered
        }
      }
      setPreviewItems(items)
    }
    loadItems()
  }, [selectedQuote, selectedSupplier, selectedPhase])

  async function crear() {
    if (!selectedQuote) { setError('Selecciona una cotización'); return }
    if (previewItems.length === 0) { setError('No hay productos que cumplan el filtro'); return }
    setSaving(true); setError('')

    const quote = quotations.find(q => q.id === selectedQuote)
    if (!quote) { setError('Cotización no encontrada'); setSaving(false); return }

    const now = new Date()
    const prefix = `OC-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`
    const { count } = await supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).like('po_number', `${prefix}%`)
    const num = String((count || 0) + 1).padStart(3, '0')
    const po_number = `${prefix}-${num}`

    const subtotal = previewItems.reduce((s: number, it: any) => s + (it.cost * it.quantity), 0)
    const iva = Math.round(subtotal * 0.16)
    const supplierName = suppliers.find(s => s.id === selectedSupplier)?.name || ''
    const phaseCfg = PHASE_CONFIG[selectedPhase]

    const { data: po, error: err } = await supabase.from('purchase_orders').insert({
      po_number,
      project_id: quote.project_id || null,
      supplier_id: selectedSupplier || null,
      quotation_id: quote.id,
      specialty: quote.specialty,
      status: 'borrador',
      purchase_phase: selectedPhase,
      subtotal, iva, total: subtotal + iva,
      notes: `${quote.name} | ${supplierName} | ${phaseCfg?.label || selectedPhase}`,
    }).select().single()

    if (err || !po) { setError(err?.message || 'Error al crear'); setSaving(false); return }

    if (previewItems.length > 0) {
      const poItems = previewItems.map((it: any, i: number) => ({
        purchase_order_id: po.id,
        catalog_product_id: it.catalog_product_id || null,
        name: it.name,
        description: it.description || null,
        system: it.system || null,
        unit: 'pza',
        quantity: it.quantity,
        unit_cost: it.cost,
        total: it.cost * it.quantity,
        quantity_received: 0,
        order_index: i,
      }))
      await supabase.from('po_items').insert(poItems)
    }

    setSaving(false)
    onCreated(po.id)
  }

  if (loading) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24 }}><Loading /></div>
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24, width: 620, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>OC desde cotización</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          {/* Lead filter */}
          <SelectField label="Lead (opcional — filtra cotizaciones)" value={selectedLead}
            onChange={v => { setSelectedLead(v); setSelectedQuote('') }}
            options={leads.map(l => ({ value: l.id, label: `${l.name}${l.company ? ' | ' + l.company : ''}` }))}
            placeholder="-- Todos los leads --" />

          {/* Cotización */}
          <SelectField label="Cotización (propuesta o contrato)" value={selectedQuote}
            onChange={v => setSelectedQuote(v)}
            options={filteredQuotes.map(q => ({
              value: q.id,
              label: `${q.name} — ${(q.project as any)?.name || 'Sin proyecto'} — ${F(q.total)}`,
            }))} placeholder="-- Seleccionar cotización --" />

          {/* Proveedor */}
          <SelectField label="Proveedor (opcional — filtra productos)" value={selectedSupplier}
            onChange={v => setSelectedSupplier(v)}
            options={suppliers.map(s => ({ value: s.id, label: s.name }))} placeholder="-- Todos los proveedores --" />

          {/* Fase */}
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Fase de compra
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {(Object.entries(PHASE_CONFIG) as [PurchasePhase, typeof PHASE_CONFIG[PurchasePhase]][]).map(([k, v]) => (
                <button key={k} onClick={() => setSelectedPhase(k)}
                  style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                    border: `1px solid ${selectedPhase === k ? v.color : '#333'}`,
                    background: selectedPhase === k ? v.color + '22' : 'transparent',
                    color: selectedPhase === k ? v.color : '#666',
                  }}>
                  {v.label}
                </button>
              ))}
            </div>
          </label>

          {/* Preview */}
          {selectedQuote && (
            <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: '#555', fontWeight: 600, marginBottom: 6 }}>
                {previewItems.length} productos encontrados — Costo total: {F(previewItems.reduce((s: number, it: any) => s + it.cost * it.quantity, 0))}
              </div>
              {previewItems.slice(0, 8).map((it: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10, color: '#666' }}>
                  <span style={{ color: '#aaa' }}>{it.quantity}× {it.name}</span>
                  <span>${(it.cost * it.quantity).toFixed(2)}</span>
                </div>
              ))}
              {previewItems.length > 8 && <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>...y {previewItems.length - 8} más</div>}
            </div>
          )}
        </div>
        {error && <div style={{ color: '#EF4444', fontSize: 12, marginTop: 10 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={crear} disabled={saving || previewItems.length === 0}>{saving ? 'Generando...' : `Generar OC (${previewItems.length} items)`}</Btn>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PO EDITOR (Detail view)
// ═══════════════════════════════════════════════════════════════════════════════
function POEditor({ poId, onBack }: { poId: string; onBack: () => void }) {
  const [po, setPO] = useState<PurchaseOrder | null>(null)
  const [items, setItems] = useState<POItem[]>([])
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showAddItem, setShowAddItem] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([
      supabase.from('purchase_orders').select('*,project:projects(name,client_name),supplier:suppliers(*)').eq('id', poId).single(),
      supabase.from('po_items').select('*').eq('purchase_order_id', poId).order('order_index'),
      supabase.from('catalog_products').select('*').eq('is_active', true).order('name'),
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      supabase.from('projects').select('*').eq('status', 'activo').order('name'),
    ]).then(([poRes, itemsRes, catRes, supRes, projRes]) => {
      setPO(poRes.data)
      setItems(itemsRes.data || [])
      setCatalog(catRes.data || [])
      setSuppliers(supRes.data || [])
      setProjects(projRes.data || [])
      setLoading(false)
    })
  }
  useEffect(load, [poId])

  if (loading || !po) return <div style={{ padding: '24px 28px' }}><Loading /></div>

  const stCfg = PO_STATUS_CFG[po.status]
  const esp = SPECIALTY_CONFIG[po.specialty]

  // Recalculate totals from items
  const subtotal = items.reduce((s, it) => s + it.total, 0)
  const iva = Math.round(subtotal * 0.16)
  const total = subtotal + iva

  async function guardar() {
    if (!po) return
    setSaving(true)
    // Update all items
    for (const it of items) {
      await supabase.from('po_items').update({
        name: it.name, description: it.description, system: it.system, unit: it.unit,
        quantity: it.quantity, unit_cost: it.unit_cost, total: it.total,
        quantity_received: it.quantity_received,
        real_name: it.real_name || null, real_unit_cost: it.real_unit_cost ?? null,
        real_quantity: it.real_quantity ?? null, real_total: it.real_total ?? null,
        cotejo_status: it.cotejo_status || 'pendiente', cotejo_notes: it.cotejo_notes || null,
      }).eq('id', it.id)
    }
    // Update PO totals
    await supabase.from('purchase_orders').update({
      subtotal, iva, total,
      supplier_id: po.supplier_id || null,
      project_id: po.project_id || null,
      notes: po.notes || null,
      expected_delivery: po.expected_delivery || null,
      updated_at: new Date().toISOString(),
    }).eq('id', po.id)
    setSaving(false); setDirty(false)
    load()
  }

  async function changeStatus(newStatus: POStatus) {
    if (!po) return
    const updates: any = { status: newStatus, updated_at: new Date().toISOString() }
    if (newStatus === 'aprobada') {
      updates.approved_at = new Date().toISOString()
      updates.approved_by = 'DG'
    }
    if (newStatus === 'recibida') {
      updates.delivered_at = new Date().toISOString()
    }
    await supabase.from('purchase_orders').update(updates).eq('id', po.id)
    load()
  }

  async function addItemFromCatalog(product: CatalogProduct) {
    const newItem = {
      purchase_order_id: po!.id,
      catalog_product_id: product.id,
      name: product.name,
      description: product.description || null,
      system: product.system || null,
      unit: product.unit,
      quantity: 1,
      unit_cost: product.cost,
      total: product.cost,
      quantity_received: 0,
      order_index: items.length,
      cotejo_status: 'pendiente',
    }
    const { data } = await supabase.from('po_items').insert(newItem).select().single()
    if (data) setItems(prev => [...prev, data])
    setShowAddItem(false)
    setDirty(true)
  }

  async function addManualItem() {
    const newItem = {
      purchase_order_id: po!.id,
      name: 'Nuevo artículo',
      unit: 'pza',
      quantity: 1,
      unit_cost: 0,
      total: 0,
      quantity_received: 0,
      order_index: items.length,
      cotejo_status: 'pendiente',
    }
    const { data } = await supabase.from('po_items').insert(newItem).select().single()
    if (data) setItems(prev => [...prev, data])
    setDirty(true)
  }

  async function removeItem(id: string) {
    await supabase.from('po_items').delete().eq('id', id)
    setItems(prev => prev.filter(it => it.id !== id))
    setDirty(true)
  }

  function updateItem(id: string, field: string, value: any) {
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it
      const updated = { ...it, [field]: value }
      if (field === 'quantity' || field === 'unit_cost') {
        updated.total = Math.round(updated.quantity * updated.unit_cost * 100) / 100
      }
      return updated
    }))
    setDirty(true)
  }

  async function deletePO() {
    await supabase.from('po_items').delete().eq('purchase_order_id', po!.id)
    await supabase.from('purchase_orders').delete().eq('id', po!.id)
    onBack()
  }

  const canEdit = po.status === 'borrador' || po.status === 'aprobada'

  // Cotejo metrics
  const cotejados = items.filter(it => it.cotejo_status === 'cotejado' || it.cotejo_status === 'sustituido').length
  const totalItems = items.length
  const allCotejado = totalItems > 0 && cotejados === totalItems
  const cotejoComplete = allCotejado || totalItems === 0

  // Compute real totals (use real values if cotejado, otherwise original)
  const realSubtotal = items.reduce((s, it) => {
    if (it.cotejo_status === 'cotejado' || it.cotejo_status === 'sustituido') {
      return s + (it.real_total ?? it.total)
    }
    return s + it.total
  }, 0)
  const realIva = Math.round(realSubtotal * 0.16)
  const realTotal = realSubtotal + realIva
  const diffTotal = realTotal - total

  // Status action buttons
  const statusActions: { label: string; target: POStatus; variant: 'primary' | 'default' | 'danger'; disabled?: boolean; tooltip?: string }[] = []
  if (po.status === 'borrador') {
    statusActions.push({
      label: cotejoComplete ? 'Aprobar OC' : `Cotejo ${cotejados}/${totalItems}`,
      target: 'aprobada',
      variant: 'primary',
      disabled: !cotejoComplete,
      tooltip: !cotejoComplete ? 'Coteja todas las partidas antes de aprobar' : undefined,
    })
  } else if (po.status === 'aprobada') {
    statusActions.push({ label: 'Marcar como pedida', target: 'pedida', variant: 'primary' })
  } else if (po.status === 'pedida') {
    statusActions.push({ label: 'Recepción parcial', target: 'recibida_parcial', variant: 'default' })
    statusActions.push({ label: 'Recibida completa', target: 'recibida', variant: 'primary' })
  } else if (po.status === 'recibida_parcial') {
    statusActions.push({ label: 'Recibida completa', target: 'recibida', variant: 'primary' })
  }
  if (!['recibida', 'cancelada'].includes(po.status)) {
    statusActions.push({ label: 'Cancelar', target: 'cancelada', variant: 'danger' })
  }

  // Filter catalog for add-item modal
  const filteredCatalog = catalogSearch
    ? catalog.filter(p => p.name.toLowerCase().includes(catalogSearch.toLowerCase()) || (p.system || '').toLowerCase().includes(catalogSearch.toLowerCase()))
    : catalog.slice(0, 20)

  return (
    <div style={{ padding: '24px 28px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 4 }}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{po.po_number}</span>
            <Badge label={stCfg.label} color={stCfg.color} />
            <Badge label={esp.icon + ' ' + esp.label} color={esp.color} />
            {po.purchase_phase && PHASE_CONFIG[po.purchase_phase] && <Badge label={PHASE_CONFIG[po.purchase_phase].label} color={PHASE_CONFIG[po.purchase_phase].color} />}
          </div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
            Creada {formatDate(po.created_at)}
            {po.approved_at && ` | Aprobada ${formatDate(po.approved_at)}`}
            {po.delivered_at && ` | Recibida ${formatDate(po.delivered_at)}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {statusActions.map(a => (
            <div key={a.target} title={a.tooltip} style={{ display: 'inline-flex' }}>
              <Btn variant={a.variant} size="sm" disabled={a.disabled} onClick={() => changeStatus(a.target)}>{a.label}</Btn>
            </div>
          ))}
        </div>
      </div>

      {/* PO info row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
        <SelectField label="Proveedor" value={po.supplier_id || ''} onChange={v => { setPO(p => p ? { ...p, supplier_id: v } : p); setDirty(true) }}
          options={suppliers.map(s => ({ value: s.id, label: s.name }))} placeholder="-- Seleccionar --" />
        <SelectField label="Proyecto" value={po.project_id || ''} onChange={v => { setPO(p => p ? { ...p, project_id: v } : p); setDirty(true) }}
          options={projects.map(p => ({ value: p.id, label: p.name }))} placeholder="-- Sin proyecto --" />
        <Field label="Entrega esperada" value={po.expected_delivery || ''} type="date"
          onChange={v => { setPO(p => p ? { ...p, expected_delivery: v } : p); setDirty(true) }} />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Proveedor info</div>
          {po.supplier ? (
            <div style={{ fontSize: 11, color: '#888' }}>
              {(po.supplier as Supplier).contact_name && <div>{(po.supplier as Supplier).contact_name}</div>}
              {(po.supplier as Supplier).contact_phone && <div>{(po.supplier as Supplier).contact_phone}</div>}
              {(po.supplier as Supplier).payment_terms && <div style={{ color: '#57FF9A' }}>{PAYMENT_TERMS_CFG[(po.supplier as Supplier).payment_terms]}</div>}
            </div>
          ) : <div style={{ fontSize: 11, color: '#444' }}>Sin proveedor asignado</div>}
        </div>
      </div>

      {/* Items table */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Partidas ({items.length})</div>
            {po.status === 'borrador' && totalItems > 0 && (
              <div style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                background: allCotejado ? 'rgba(87,255,154,0.1)' : 'rgba(245,158,11,0.1)',
                color: allCotejado ? '#57FF9A' : '#F59E0B',
                border: `1px solid ${allCotejado ? '#57FF9A33' : '#F59E0B33'}`,
              }}>
                Cotejo: {cotejados}/{totalItems} {allCotejado ? '✓' : ''}
              </div>
            )}
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 6 }}>
              <Btn size="sm" onClick={addManualItem}><Plus size={12} /> Manual</Btn>
              <Btn size="sm" variant="primary" onClick={() => setShowAddItem(true)}><Package size={12} /> Del catálogo</Btn>
            </div>
          )}
        </div>

        <Table>
          <thead><tr>
            <Th>#</Th><Th>Artículo original</Th><Th>Sistema</Th><Th>Unidad</Th><Th right>Cant</Th><Th right>P.U. catálogo</Th><Th right>Total catálogo</Th>
            {po.status === 'borrador' && (<>
              <Th>Artículo real</Th><Th right>Cant real</Th><Th right>P.U. real</Th><Th right>Total real</Th><Th right>Δ</Th><Th>Estado</Th>
            </>)}
            {(po.status === 'pedida' || po.status === 'recibida_parcial') && <Th right>Recibido</Th>}
            {canEdit && <Th></Th>}
          </tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={14}><EmptyState message="Agrega partidas a esta orden" /></td></tr>}
            {items.map((it, idx) => {
              const rTotal = it.real_total ?? (it.real_unit_cost != null && it.real_quantity != null ? Math.round(it.real_unit_cost * it.real_quantity * 100) / 100 : null)
              const diff = rTotal != null ? rTotal - it.total : null
              const cotejoColor = it.cotejo_status === 'cotejado' ? '#57FF9A' : it.cotejo_status === 'sustituido' ? '#C084FC' : '#6B7280'
              const cotejoLabel = it.cotejo_status === 'cotejado' ? 'Cotejado' : it.cotejo_status === 'sustituido' ? 'Sustituido' : 'Pendiente'

              return (
              <tr key={it.id} style={{ background: it.cotejo_status === 'pendiente' && po.status === 'borrador' ? 'rgba(107,114,128,0.05)' : undefined }}>
                <Td muted>{idx + 1}</Td>
                <Td>
                  {canEdit ? (
                    <input value={it.name} onChange={e => updateItem(it.id, 'name', e.target.value)}
                      style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 12, fontFamily: 'inherit', width: '100%', outline: 'none' }} />
                  ) : <span style={{ color: '#fff', fontSize: 12 }}>{it.name}</span>}
                  {it.description && <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{it.description}</div>}
                </Td>
                <Td muted>{it.system || '--'}</Td>
                <Td>
                  {canEdit ? (
                    <input value={it.unit} onChange={e => updateItem(it.id, 'unit', e.target.value)}
                      style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 12, fontFamily: 'inherit', width: 40, textAlign: 'center', outline: 'none' }} />
                  ) : it.unit}
                </Td>
                <Td right>
                  {canEdit ? (
                    <input type="number" value={it.quantity} onChange={e => updateItem(it.id, 'quantity', parseFloat(e.target.value) || 0)}
                      style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 12, fontFamily: 'inherit', width: 60, textAlign: 'right', outline: 'none' }} />
                  ) : it.quantity}
                </Td>
                <Td right>
                  {canEdit ? (
                    <input type="number" value={it.unit_cost} onChange={e => updateItem(it.id, 'unit_cost', parseFloat(e.target.value) || 0)}
                      style={{ background: 'transparent', border: 'none', color: '#ccc', fontSize: 12, fontFamily: 'inherit', width: 80, textAlign: 'right', outline: 'none' }} />
                  ) : F(it.unit_cost)}
                </Td>
                <Td right><span style={{ fontWeight: 500, color: '#888' }}>{F(it.total)}</span></Td>

                {/* ── COTEJO COLUMNS (borrador only) ── */}
                {po.status === 'borrador' && (<>
                  <Td>
                    <input value={it.real_name || ''} onChange={e => updateItem(it.id, 'real_name', e.target.value)}
                      placeholder={it.name}
                      style={{
                        background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 4,
                        color: it.real_name ? '#fff' : '#444', fontSize: 11, fontFamily: 'inherit',
                        width: '100%', outline: 'none', padding: '3px 6px',
                      }} />
                  </Td>
                  <Td right>
                    <input type="number" value={it.real_quantity ?? ''} onChange={e => {
                      const rq = parseFloat(e.target.value) || 0
                      const rc = it.real_unit_cost ?? it.unit_cost
                      updateItem(it.id, 'real_quantity', rq)
                      updateItem(it.id, 'real_total', Math.round(rq * rc * 100) / 100)
                    }}
                      placeholder={String(it.quantity)}
                      style={{
                        background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 4,
                        color: it.real_quantity != null ? '#fff' : '#444', fontSize: 11,
                        fontFamily: 'inherit', width: 55, textAlign: 'right', padding: '3px 6px',
                      }} />
                  </Td>
                  <Td right>
                    <input type="number" value={it.real_unit_cost ?? ''} onChange={e => {
                      const rc = parseFloat(e.target.value) || 0
                      const rq = it.real_quantity ?? it.quantity
                      updateItem(it.id, 'real_unit_cost', rc)
                      updateItem(it.id, 'real_total', Math.round(rq * rc * 100) / 100)
                    }}
                      placeholder={String(it.unit_cost)}
                      style={{
                        background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 4,
                        color: it.real_unit_cost != null ? '#fff' : '#444', fontSize: 11,
                        fontFamily: 'inherit', width: 75, textAlign: 'right', padding: '3px 6px',
                      }} />
                  </Td>
                  <Td right>
                    <span style={{ fontWeight: 600, color: rTotal != null ? '#57FF9A' : '#444', fontSize: 12 }}>
                      {rTotal != null ? F(rTotal) : '--'}
                    </span>
                  </Td>
                  <Td right>
                    {diff != null && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: diff > 0 ? '#EF4444' : diff < 0 ? '#57FF9A' : '#555' }}>
                        {diff > 0 ? '+' : ''}{F(diff)}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <select value={it.cotejo_status || 'pendiente'}
                      onChange={e => { updateItem(it.id, 'cotejo_status', e.target.value); setDirty(true) }}
                      style={{
                        background: cotejoColor + '15', border: `1px solid ${cotejoColor}44`,
                        borderRadius: 12, color: cotejoColor, fontSize: 10, fontWeight: 600,
                        padding: '2px 8px', fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
                      }}>
                      <option value="pendiente">Pendiente</option>
                      <option value="cotejado">Cotejado</option>
                      <option value="sustituido">Sustituido</option>
                    </select>
                  </Td>
                </>)}

                {(po.status === 'pedida' || po.status === 'recibida_parcial') && (
                  <Td right>
                    <input type="number" value={it.quantity_received}
                      onChange={e => updateItem(it.id, 'quantity_received', parseFloat(e.target.value) || 0)}
                      style={{
                        background: it.quantity_received >= it.quantity ? 'rgba(87,255,154,0.1)' : 'rgba(245,158,11,0.1)',
                        border: `1px solid ${it.quantity_received >= it.quantity ? '#57FF9A44' : '#F59E0B44'}`,
                        borderRadius: 4, color: it.quantity_received >= it.quantity ? '#57FF9A' : '#F59E0B',
                        fontSize: 12, fontFamily: 'inherit', width: 60, textAlign: 'right', padding: '2px 6px',
                      }} />
                  </Td>
                )}
                {canEdit && (
                  <Td>
                    <button onClick={() => removeItem(it.id)}
                      style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: 4, opacity: 0.6 }}>
                      <Trash2 size={14} />
                    </button>
                  </Td>
                )}
              </tr>
              )
            })}
          </tbody>
        </Table>
      </div>

      {/* Totals + Notes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>
        <div>
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Notas
            <textarea value={po.notes || ''} onChange={e => { setPO(p => p ? { ...p, notes: e.target.value } : p); setDirty(true) }}
              rows={3} placeholder="Notas internas, referencia de cotización del proveedor..."
              style={{
                display: 'block', width: '100%', marginTop: 4, padding: '8px 10px',
                background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff',
                fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
              }} />
          </label>
        </div>
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#888' }}>Subtotal catálogo</span>
            <span style={{ fontSize: 12, color: '#ccc' }}>{F(subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#888' }}>IVA (16%)</span>
            <span style={{ fontSize: 12, color: '#ccc' }}>{F(iva)}</span>
          </div>
          <div style={{ borderTop: '1px solid #333', paddingTop: 8, display: 'flex', justifyContent: 'space-between', marginBottom: po.status === 'borrador' && cotejados > 0 ? 12 : 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Total catálogo</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#57FF9A' }}>{F(total)}</span>
          </div>
          {/* Show real totals if any items are cotejado */}
          {po.status === 'borrador' && cotejados > 0 && (
            <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: '#888' }}>Subtotal real</span>
                <span style={{ fontSize: 12, color: '#ccc' }}>{F(realSubtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: '#888' }}>IVA real (16%)</span>
                <span style={{ fontSize: 12, color: '#ccc' }}>{F(realIva)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Total real</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#3B82F6' }}>{F(realTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#888' }}>Diferencia</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: diffTotal > 0 ? '#EF4444' : diffTotal < 0 ? '#57FF9A' : '#555' }}>
                  {diffTotal > 0 ? '+' : ''}{F(diffTotal)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, paddingTop: 16, borderTop: '1px solid #222' }}>
        <div>
          {po.status === 'borrador' && (
            <Btn variant="danger" size="sm" onClick={() => { if (confirm('Eliminar esta OC?')) deletePO() }}>
              <Trash2 size={14} /> Eliminar OC
            </Btn>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={onBack}>Volver</Btn>
          {dirty && <Btn variant="primary" onClick={guardar}><Save size={14} /> {saving ? 'Guardando...' : 'Guardar cambios'}</Btn>}
        </div>
      </div>

      {/* Add from catalog modal */}
      {showAddItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24, width: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Agregar del catálogo</div>
              <button onClick={() => setShowAddItem(false)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#555' }} />
              <input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} placeholder="Buscar producto..."
                style={{
                  width: '100%', padding: '7px 10px 7px 30px', background: '#1e1e1e', border: '1px solid #333',
                  borderRadius: 8, color: '#fff', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box',
                }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredCatalog.map(p => (
                <div key={p.id} onClick={() => addItemFromCatalog(p)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 12px', borderBottom: '1px solid #1e1e1e', cursor: 'pointer',
                  }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#fff' }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: '#555' }}>{p.system} | {p.provider || 'Sin proveedor'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: '#57FF9A', fontWeight: 600 }}>{F(p.cost)}</div>
                    <div style={{ fontSize: 10, color: '#555' }}>/{p.unit}</div>
                  </div>
                </div>
              ))}
              {filteredCatalog.length === 0 && <EmptyState message="Sin resultados" />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUPPLIER LIST
// ═══════════════════════════════════════════════════════════════════════════════
function SupplierList({ onOpen }: { onOpen: (id: string) => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)

  const load = () => {
    setLoading(true)
    supabase.from('suppliers').select('*').order('name')
      .then(({ data }) => { setSuppliers(data || []); setLoading(false) })
  }
  useEffect(load, [])

  const lista = search
    ? suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || (s.contact_name || '').toLowerCase().includes(search.toLowerCase()))
    : suppliers

  return (
    <div>
      <SectionHeader title="Proveedores" subtitle={`${suppliers.length} proveedores`}
        action={<Btn variant="primary" onClick={() => setShowNew(true)}><Plus size={14} /> Nuevo proveedor</Btn>} />

      <div style={{ marginBottom: 16, position: 'relative', maxWidth: 300 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#555' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar proveedor..."
          style={{
            width: '100%', padding: '7px 10px 7px 30px', background: '#1e1e1e', border: '1px solid #333',
            borderRadius: 8, color: '#fff', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box',
          }} />
      </div>

      {loading ? <Loading /> : (
        <Table>
          <thead><tr>
            <Th>Proveedor</Th><Th>Contacto</Th><Th>Teléfono</Th><Th>RFC</Th><Th>Condiciones</Th><Th>Sistemas</Th><Th>Estado</Th><Th></Th>
          </tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={8}><EmptyState message="Sin proveedores" /></td></tr>}
            {lista.map(s => (
              <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(s.id)}>
                <Td><span style={{ fontWeight: 600, color: '#fff' }}>{s.name}</span></Td>
                <Td muted>{s.contact_name || '--'}</Td>
                <Td muted>{s.contact_phone || '--'}</Td>
                <Td muted>{s.rfc || '--'}</Td>
                <Td><Badge label={PAYMENT_TERMS_CFG[s.payment_terms]} color="#3B82F6" /></Td>
                <Td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(s.systems || []).slice(0, 3).map(sys => (
                      <span key={sys} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: '#1e1e1e', color: '#888', border: '1px solid #333' }}>{sys}</span>
                    ))}
                    {(s.systems || []).length > 3 && <span style={{ fontSize: 10, color: '#555' }}>+{s.systems.length - 3}</span>}
                  </div>
                </Td>
                <Td><Badge label={s.is_active ? 'Activo' : 'Inactivo'} color={s.is_active ? '#57FF9A' : '#EF4444'} /></Td>
                <Td><Btn size="sm" onClick={e => { e?.stopPropagation(); onOpen(s.id) }}>Ver</Btn></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {showNew && <NuevoSupplierModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NUEVO SUPPLIER MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function NuevoSupplierModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', contact_name: '', contact_phone: '', contact_email: '', rfc: '',
    address: '', payment_terms: 'credito_30' as PaymentTerms, notes: '', systems: [] as string[],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const s = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))
  const toggleSystem = (sys: string) =>
    setForm(f => ({ ...f, systems: f.systems.includes(sys) ? f.systems.filter(x => x !== sys) : [...f.systems, sys] }))

  async function crear() {
    if (!form.name.trim()) { setError('El nombre es requerido'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('suppliers').insert({
      name: form.name.trim(), contact_name: form.contact_name || null,
      contact_phone: form.contact_phone || null, contact_email: form.contact_email || null,
      rfc: form.rfc || null, address: form.address || null,
      payment_terms: form.payment_terms, notes: form.notes || null,
      systems: form.systems, is_active: true,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24, width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Nuevo proveedor</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          <Field label="Nombre / Razón social *" value={form.name} onChange={s('name')} placeholder="ej. Ubiquiti MX, Hikvision..." />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Contacto" value={form.contact_name} onChange={s('contact_name')} placeholder="Nombre del contacto" />
            <Field label="Teléfono" value={form.contact_phone} onChange={s('contact_phone')} placeholder="+52 55..." />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Email" value={form.contact_email} onChange={s('contact_email')} placeholder="correo@proveedor.com" />
            <Field label="RFC" value={form.rfc} onChange={s('rfc')} placeholder="RFC del proveedor" />
          </div>
          <Field label="Dirección" value={form.address} onChange={s('address')} placeholder="Dirección fiscal" />
          <SelectField label="Condiciones de pago" value={form.payment_terms}
            onChange={v => setForm(f => ({ ...f, payment_terms: v as PaymentTerms }))}
            options={Object.entries(PAYMENT_TERMS_CFG).map(([k, v]) => ({ value: k, label: v }))} />
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Sistemas que provee
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {SYSTEM_OPTIONS.map(sys => {
                const active = form.systems.includes(sys)
                return (
                  <button key={sys} onClick={() => toggleSystem(sys)}
                    style={{
                      padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                      fontWeight: active ? 600 : 400,
                      border: `1px solid ${active ? '#57FF9A' : '#333'}`,
                      background: active ? '#57FF9A22' : 'transparent',
                      color: active ? '#57FF9A' : '#666',
                    }}>{sys}</button>
                )
              })}
            </div>
          </label>
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Notas
            <textarea value={form.notes} onChange={e => s('notes')(e.target.value)} rows={2}
              placeholder="Notas sobre el proveedor, horarios, condiciones especiales..."
              style={{
                display: 'block', width: '100%', marginTop: 4, padding: '8px 10px',
                background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff',
                fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
              }} />
          </label>
        </div>
        {error && <div style={{ color: '#EF4444', fontSize: 12, marginTop: 10 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={crear}>{saving ? 'Guardando...' : 'Crear proveedor'}</Btn>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUPPLIER DETAIL
// ═══════════════════════════════════════════════════════════════════════════════
function SupplierDetail({ supplierId, onBack }: { supplierId: string; onBack: () => void }) {
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('suppliers').select('*').eq('id', supplierId).single(),
      supabase.from('purchase_orders').select('*,project:projects(name)').eq('supplier_id', supplierId).order('created_at', { ascending: false }),
    ]).then(([sRes, oRes]) => {
      setSupplier(sRes.data)
      setOrders(oRes.data || [])
      setLoading(false)
    })
  }, [supplierId])

  if (loading || !supplier) return <div style={{ padding: '24px 28px' }}><Loading /></div>

  const totalCompras = orders.reduce((s, o) => s + o.total, 0)

  async function guardar() {
    if (!supplier) return
    setSaving(true)
    await supabase.from('suppliers').update({
      name: supplier.name, contact_name: supplier.contact_name || null,
      contact_phone: supplier.contact_phone || null, contact_email: supplier.contact_email || null,
      rfc: supplier.rfc || null, address: supplier.address || null,
      payment_terms: supplier.payment_terms, notes: supplier.notes || null,
      systems: supplier.systems, is_active: supplier.is_active,
    }).eq('id', supplier.id)
    setSaving(false); setDirty(false)
  }

  const upd = (field: string, value: any) => {
    setSupplier(s => s ? { ...s, [field]: value } : s)
    setDirty(true)
  }

  const toggleSystem = (sys: string) => {
    if (!supplier) return
    const systems = supplier.systems.includes(sys) ? supplier.systems.filter(x => x !== sys) : [...supplier.systems, sys]
    upd('systems', systems)
  }

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 4 }}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{supplier.name}</div>
          <div style={{ fontSize: 12, color: '#555' }}>{orders.length} órdenes | Total: {F(totalCompras)}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn size="sm" onClick={() => upd('is_active', !supplier.is_active)}>
            {supplier.is_active ? 'Desactivar' : 'Activar'}
          </Btn>
          {dirty && <Btn variant="primary" size="sm" onClick={guardar}><Save size={14} /> {saving ? 'Guardando...' : 'Guardar'}</Btn>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Nombre / Razón social" value={supplier.name} onChange={v => upd('name', v)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Contacto" value={supplier.contact_name || ''} onChange={v => upd('contact_name', v)} />
            <Field label="Teléfono" value={supplier.contact_phone || ''} onChange={v => upd('contact_phone', v)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Email" value={supplier.contact_email || ''} onChange={v => upd('contact_email', v)} />
            <Field label="RFC" value={supplier.rfc || ''} onChange={v => upd('rfc', v)} />
          </div>
          <Field label="Dirección" value={supplier.address || ''} onChange={v => upd('address', v)} />
          <SelectField label="Condiciones de pago" value={supplier.payment_terms}
            onChange={v => upd('payment_terms', v)}
            options={Object.entries(PAYMENT_TERMS_CFG).map(([k, v]) => ({ value: k, label: v }))} />
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Sistemas
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {SYSTEM_OPTIONS.map(sys => {
                const active = (supplier.systems || []).includes(sys)
                return (
                  <button key={sys} onClick={() => toggleSystem(sys)}
                    style={{
                      padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: active ? 600 : 400,
                      border: `1px solid ${active ? '#57FF9A' : '#333'}`,
                      background: active ? '#57FF9A22' : 'transparent', color: active ? '#57FF9A' : '#666',
                    }}>{sys}</button>
                )
              })}
            </div>
          </label>
        </div>

        {/* Order history */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Historial de compras</div>
          {orders.length === 0 ? <EmptyState message="Sin órdenes con este proveedor" /> : (
            <div style={{ border: '1px solid #222', borderRadius: 12, overflow: 'hidden' }}>
              {orders.map(o => {
                const st = PO_STATUS_CFG[o.status]
                return (
                  <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #1e1e1e' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{o.po_number}</div>
                      <div style={{ fontSize: 10, color: '#555' }}>{(o.project as any)?.name || 'Sin proyecto'} | {formatDate(o.created_at)}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Badge label={st.label} color={st.color} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#57FF9A' }}>{F(o.total)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
