import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { ANTHROPIC_API_KEY } from '../lib/config'
import { Project, CatalogProduct, ProjectLine, PurchasePhase } from '../types'
import { F, FUSD, FCUR, SPECIALTY_CONFIG, PHASE_CONFIG, formatDate } from '../lib/utils'
import { Badge, Btn, KpiCard, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { useIsMobile } from '../lib/useIsMobile'
import { Plus, ChevronLeft, X, Search, Trash2, Save, ShoppingCart, Truck, Package, Users2, FileText, Copy, Sparkles, Upload, ClipboardList, CheckCircle2, Circle, Clock, Download } from 'lucide-react'
import { generatePOPdf } from '../lib/poPdf'

// ─── Types ────────────────────────────────────────────────────────────────────
type POStatus = 'borrador' | 'aprobada' | 'pedida' | 'recibida_parcial' | 'recibida' | 'cancelada'
type PaymentTerms = 'contado' | 'credito_15' | 'credito_30' | 'credito_60' | 'anticipo_50'
type LogisticsMode = 'pending' | 'pickup_to_bodega' | 'pickup_to_obra' | 'supplier_to_bodega' | 'supplier_to_obra'

interface Obra { id: string; nombre: string; project_id?: string }

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
  // Datos bancarios para auto-conciliacion
  clabe?: string
  cuenta_bancaria?: string
  banco?: string
  bnet_codigo?: string
  // Logística (default para POs de este proveedor — Entregas v2)
  default_logistics_mode?: LogisticsMode | null
}

interface PurchaseOrder {
  id: string
  created_at: string
  updated_at: string
  po_number: string
  project_id?: string
  supplier_id?: string
  quotation_id?: string
  lead_id?: string | null
  specialty: ProjectLine
  purchase_phase?: PurchasePhase
  status: POStatus
  subtotal: number
  iva: number
  total: number
  currency: 'MXN' | 'USD'
  supplier_doc_number?: string
  notes?: string
  requested_by?: string
  approved_by?: string
  approved_at?: string
  expected_delivery?: string
  delivered_at?: string
  project?: Project
  supplier?: Supplier
  // Logística (Entregas v2)
  logistics_mode?: LogisticsMode
  logistics_target_obra_id?: string | null
  logistics_target_obra?: Obra
}

interface POItem {
  id: string
  created_at: string
  purchase_order_id: string
  catalog_product_id?: string
  name: string
  description?: string
  marca?: string
  modelo?: string
  system?: string
  unit: string
  quantity: number
  unit_cost: number
  total: number
  currency: 'MXN' | 'USD'
  quantity_received: number
  order_index: number
  // Cotejo fields — valores reales de la compra
  real_name?: string
  real_marca?: string
  real_modelo?: string
  real_unit_cost?: number
  real_quantity?: number
  real_total?: number
  cotejo_status: 'pendiente' | 'cotejado' | 'sustituido'
  cotejo_notes?: string
}

interface POPayment {
  id: string
  purchase_order_id: string
  amount: number
  currency: 'MXN' | 'USD'
  payment_date: string
  method: string
  reference?: string
  receipt_url?: string
  receipt_filename?: string
  notes?: string
  created_at: string
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

// Modo logístico — cómo llega el material de una PO
const LOGISTICS_CFG: Record<LogisticsMode, { label: string; short: string; color: string; needsObra: boolean; description: string }> = {
  pending:            { label: 'Por decidir',              short: 'Pendiente',     color: '#6B7280', needsObra: false, description: 'Aún no se decide cómo llega' },
  pickup_to_bodega:   { label: 'Recolectar → bodega',      short: 'Recol→Bodega',  color: '#3B82F6', needsObra: false, description: 'OMM va por ella y la lleva a bodega' },
  pickup_to_obra:     { label: 'Recolectar → directo a obra', short: 'Recol→Obra', color: '#F59E0B', needsObra: true,  description: 'OMM va por ella y la lleva directo a la obra' },
  supplier_to_bodega: { label: 'Proveedor → bodega',       short: 'Prov→Bodega',   color: '#8B5CF6', needsObra: false, description: 'Proveedor envía a bodega OMM' },
  supplier_to_obra:   { label: 'Proveedor → directo a obra', short: 'Prov→Obra',   color: '#EC4899', needsObra: true,  description: 'Proveedor envía directo a la obra' },
}

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

function SearchableSelect({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; placeholder?: string
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)
  const filtered = search ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase())) : options

  useEffect(() => {
    function handleClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div
        onClick={() => { setOpen(true); setSearch('') }}
        style={{
          padding: '8px 10px', background: '#1e1e1e', border: '1px solid ' + (open ? '#57FF9A' : '#333'),
          borderRadius: 8, color: selected ? '#fff' : '#666', fontSize: 13, cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected?.label || placeholder || 'Seleccionar...'}</span>
        {value && <button onClick={e => { e.stopPropagation(); onChange(''); setSearch('') }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0, marginLeft: 6 }}><X size={12} /></button>}
      </div>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#1e1e1e', border: '1px solid #444', borderRadius: 8, marginTop: 2, maxHeight: 220, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #333' }}>
            <input
              autoFocus
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar..."
              style={{ width: '100%', padding: '6px 8px', background: '#141414', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box' as const, outline: 'none' }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {placeholder && (
              <div onClick={() => { onChange(''); setOpen(false) }}
                style={{ padding: '7px 10px', fontSize: 12, color: '#666', cursor: 'pointer', borderBottom: '1px solid #222' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#252525')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                {placeholder}
              </div>
            )}
            {filtered.map(o => (
              <div key={o.value} onClick={() => { onChange(o.value); setOpen(false); setSearch('') }}
                style={{ padding: '7px 10px', fontSize: 12, color: o.value === value ? '#57FF9A' : '#ccc', cursor: 'pointer', background: o.value === value ? 'rgba(87,255,154,0.08)' : 'transparent' }}
                onMouseEnter={e => { if (o.value !== value) e.currentTarget.style.background = '#252525' }}
                onMouseLeave={e => { if (o.value !== value) e.currentTarget.style.background = 'transparent' }}>
                {o.label}
              </div>
            ))}
            {filtered.length === 0 && <div style={{ padding: '10px', fontSize: 11, color: '#555', textAlign: 'center' }}>Sin resultados</div>}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function Compras() {
  const isMobile = useIsMobile()
  const [view, setView] = useState<'dashboard' | 'lista' | 'seguimiento' | 'proveedores'>('dashboard')
  const [editingPO, setEditingPO] = useState<string | null>(null)
  const [editingSupplier, setEditingSupplier] = useState<string | null>(null)
  const [seguimientoDetail, setSeguimientoDetail] = useState<string | null>(null)

  if (editingPO) return <POEditor poId={editingPO} onBack={() => { setEditingPO(null); setView('lista') }} />
  if (editingSupplier) return <SupplierDetail supplierId={editingSupplier} onBack={() => { setEditingSupplier(null); setView('proveedores') }} />

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px' }}>
      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: isMobile ? 2 : 4, marginBottom: 20, borderBottom: '1px solid #222', paddingBottom: 8, flexWrap: 'wrap' }}>
        {([
          { key: 'dashboard', label: 'Dashboard', icon: ShoppingCart },
          { key: 'lista', label: 'Órdenes de compra', icon: FileText },
          { key: 'seguimiento', label: 'Seguimiento', icon: ClipboardList },
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
      {view === 'seguimiento' && !seguimientoDetail && <ProcurementTracker onOpenPO={id => setEditingPO(id)} onOpenDetail={id => setSeguimientoDetail(id)} />}
      {view === 'seguimiento' && seguimientoDetail && <ProcurementDetail quotationId={seguimientoDetail} onBack={() => setSeguimientoDetail(null)} onOpenPO={id => setEditingPO(id)} />}
      {view === 'proveedores' && <SupplierList onOpen={id => setEditingSupplier(id)} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function ComprasDashboard({ onOpenPO, onGoToList }: { onOpenPO: (id: string) => void; onGoToList: () => void }) {
  const isMobile = useIsMobile()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('purchase_orders').select('*,project:projects(name),supplier:suppliers(name),quotation:quotations(name,client_name,notes)')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setOrders(data || []); setLoading(false) })
  }, [])

  // Helper to extract lead name from a PO (via quotation.notes JSON or quotation.client_name)
  const getLeadName = (o: PurchaseOrder) => {
    const q = (o as any).quotation
    if (!q) return null
    try { const n = typeof q.notes === 'string' ? JSON.parse(q.notes) : q.notes; if (n?.lead_name) return n.lead_name } catch {}
    return q.client_name || null
  }
  const getQuotName = (o: PurchaseOrder) => (o as any).quotation?.name || null

  if (loading) return <Loading />

  const active = orders.filter(o => !['recibida', 'cancelada'].includes(o.status))
  const totalPendienteMXN = active.filter(o => o.currency === 'MXN').reduce((s, o) => s + o.total, 0)
  const totalPendienteUSD = active.filter(o => o.currency === 'USD').reduce((s, o) => s + o.total, 0)
  const thisMonth = orders.filter(o => {
    const d = new Date(o.created_at)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const totalMesMXN = thisMonth.filter(o => o.currency === 'MXN').reduce((s, o) => s + o.total, 0)
  const totalMesUSD = thisMonth.filter(o => o.currency === 'USD').reduce((s, o) => s + o.total, 0)
  const porRecibir = orders.filter(o => o.status === 'pedida' || o.status === 'recibida_parcial').length

  // Group by supplier
  const bySupplier: Record<string, any> = {}
  orders.forEach(o => {
    const sn = (o.supplier as any)?.name || 'Sin proveedor'
    if (!bySupplier[sn]) bySupplier[sn] = { name: sn, totalMXN: 0, totalUSD: 0, count: 0 }
    if (o.currency === 'USD') bySupplier[sn].totalUSD += o.total
    else bySupplier[sn].totalMXN += o.total
    bySupplier[sn].count++
  })
  const topSuppliers = Object.values(bySupplier).sort((a: any, b: any) => (b.totalMXN + b.totalUSD) - (a.totalMXN + a.totalUSD)).slice(0, 5) as any[]

  // Group by lead (from quotation)
  const byLead: Record<string, any> = {}
  active.forEach(o => {
    const ln = getLeadName(o) || (o.project as any)?.name || 'Sin lead'
    if (!byLead[ln]) byLead[ln] = { name: ln, totalMXN: 0, totalUSD: 0 }
    if (o.currency === 'USD') byLead[ln].totalUSD += o.total
    else byLead[ln].totalMXN += o.total
  })
  const topLeads = Object.values(byLead).sort((a: any, b: any) => (b.totalMXN + b.totalUSD) - (a.totalMXN + a.totalUSD)).slice(0, 5) as any[]

  return (
    <div>
      <SectionHeader title="Compras" subtitle={`${orders.length} órdenes totales`}
        action={<Btn variant="primary" onClick={onGoToList}><Plus size={14} /> Nueva OC</Btn>} />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label="OC Activas" value={active.length} color="#3B82F6" icon={<FileText size={16} />} />
        <KpiCard label="Pendiente MXN" value={F(totalPendienteMXN)} color="#F59E0B" icon={<ShoppingCart size={16} />} />
        <KpiCard label="Pendiente USD" value={FUSD(totalPendienteUSD)} color="#F59E0B" icon={<ShoppingCart size={16} />} />
        <KpiCard label="Mes MXN" value={F(totalMesMXN)} color="#57FF9A" icon={<Package size={16} />} />
        <KpiCard label="Mes USD" value={FUSD(totalMesUSD)} color="#57FF9A" icon={<Package size={16} />} />
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
                <span style={{ fontSize: 12, fontWeight: 600, color: '#57FF9A', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  {s.totalMXN > 0 && <span>{F(s.totalMXN)}</span>}
                  {s.totalUSD > 0 && <span style={{ color: '#A78BFA' }}>{FUSD(s.totalUSD)}</span>}
                  <span style={{ color: '#555', fontWeight: 400 }}>({s.count})</span>
                </span>
              </div>
            ))
          }
        </div>
        {/* By lead */}
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Compras por lead (activas)</div>
          {topLeads.length === 0 ? <EmptyState message="Sin datos" /> :
            topLeads.map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1e1e1e' }}>
                <span style={{ fontSize: 12, color: '#ccc' }}>{p.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  {p.totalMXN > 0 && <span style={{ color: '#F59E0B' }}>{F(p.totalMXN)}</span>}
                  {p.totalUSD > 0 && <span style={{ color: '#A78BFA' }}>{FUSD(p.totalUSD)}</span>}
                </span>
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
              <Th>OC #</Th><Th>Proveedor</Th><Th>Cotización</Th><Th>Lead</Th><Th>Especialidad</Th><Th>Fase</Th><Th>Estado</Th><Th right>Total MXN</Th><Th right>Total USD</Th>
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
                    <Td muted>{getQuotName(o) || '--'}</Td>
                    <Td muted>{getLeadName(o) || '--'}</Td>
                    <Td><Badge label={esp.icon + ' ' + esp.label} color={esp.color} /></Td>
                    <Td>{phaseCfg ? <Badge label={phaseCfg.label} color={phaseCfg.color} /> : <span style={{color:'#555',fontSize:11}}>--</span>}</Td>
                    <Td><Badge label={st.label} color={st.color} /></Td>
                    <Td right>{o.currency === 'MXN' ? <span style={{ fontWeight: 600, color: '#57FF9A' }}>{F(o.total)}</span> : <span style={{ color: '#333' }}>—</span>}</Td>
                  <Td right>{o.currency === 'USD' ? <span style={{ fontWeight: 600, color: '#57FF9A' }}>{FUSD(o.total)}</span> : <span style={{ color: '#333' }}>—</span>}</Td>
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
//  PROCUREMENT TRACKER — Cotizaciones cerradas → resumen de compras
// ═══════════════════════════════════════════════════════════════════════════════

interface QuotSummary {
  id: string
  name: string
  lead_name: string
  specialty: string
  totalItems: number
  itemsConOC: number
  itemsPedidos: number
  itemsFaltantes: number
  costoTotal: number
  costoPedido: number
  costoFaltante: number
  currency: string
  numOCs: number
}

function ProcurementTracker({ onOpenPO, onOpenDetail }: { onOpenPO: (id: string) => void; onOpenDetail: (quotId: string) => void }) {
  const isMobile = useIsMobile()
  const [rows, setRows] = useState<QuotSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      // 1. All closed quotations (excluyendo Proyectos — son servicios sin compras)
      const { data: quots } = await supabase
        .from('quotations')
        .select('id, name, client_name, notes, specialty')
        .eq('stage', 'contrato')
        .neq('specialty', 'proy')
        .order('updated_at', { ascending: false })

      if (!quots || quots.length === 0) { setLoading(false); return }
      const quotIds = quots.map(q => q.id)

      // 2. All material items
      const { data: qItems } = await supabase
        .from('quotation_items')
        .select('id, quotation_id, catalog_product_id, cost, total, provider_currency')
        .in('quotation_id', quotIds)
        .eq('type', 'material')

      // 3. All POs linked to these quotations
      const { data: pos } = await supabase
        .from('purchase_orders')
        .select('id, quotation_id, status')
        .in('quotation_id', quotIds)

      // 4. PO items for cross-reference
      const poIds = (pos || []).map(p => p.id)
      let poItems: any[] = []
      if (poIds.length > 0) {
        const { data } = await supabase
          .from('po_items')
          .select('purchase_order_id, catalog_product_id')
          .in('purchase_order_id', poIds)
        poItems = data || []
      }

      // 5. Build per-quotation summary
      const paidStatuses: POStatus[] = ['pedida', 'recibida_parcial', 'recibida']

      const summaries: QuotSummary[] = quots.map(q => {
        const notes = typeof q.notes === 'string' ? (() => { try { return JSON.parse(q.notes) } catch { return {} } })() : (q.notes || {})
        const items = (qItems || []).filter(qi => qi.quotation_id === q.id)
        const quotPOs = (pos || []).filter(p => p.quotation_id === q.id)
        const quotPOIds = new Set(quotPOs.map(p => p.id))

        // Build set of catalog_product_ids that have a PO item
        const itemsWithPO = new Set<string>()
        const itemsPedido = new Set<string>()
        for (const pi of poItems) {
          if (!quotPOIds.has(pi.purchase_order_id) || !pi.catalog_product_id) continue
          itemsWithPO.add(pi.catalog_product_id)
          const po = quotPOs.find(p => p.id === pi.purchase_order_id)
          if (po && paidStatuses.includes(po.status as POStatus)) {
            itemsPedido.add(pi.catalog_product_id)
          }
        }

        const totalItems = items.length
        const itemsConOC = items.filter(i => i.catalog_product_id && itemsWithPO.has(i.catalog_product_id)).length
        const itemsPedidosCount = items.filter(i => i.catalog_product_id && itemsPedido.has(i.catalog_product_id)).length
        const itemsFaltantes = totalItems - itemsConOC
        const currency = items[0]?.provider_currency || 'USD'

        const costoTotal = items.reduce((s, i) => s + Number(i.total), 0)
        const costoPedido = items.filter(i => i.catalog_product_id && itemsWithPO.has(i.catalog_product_id)).reduce((s, i) => s + Number(i.total), 0)
        const costoFaltante = costoTotal - costoPedido

        return {
          id: q.id,
          name: q.name,
          lead_name: notes.lead_name || q.client_name || '',
          specialty: q.specialty || '',
          totalItems,
          itemsConOC,
          itemsPedidos: itemsPedidosCount,
          itemsFaltantes,
          costoTotal,
          costoPedido,
          costoFaltante,
          currency,
          numOCs: quotPOs.length,
        }
      }).filter(q => q.totalItems > 0)

      setRows(summaries)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <Loading />

  // Totals
  const totItems = rows.reduce((s, r) => s + r.totalItems, 0)
  const totConOC = rows.reduce((s, r) => s + r.itemsConOC, 0)
  const totFaltantes = rows.reduce((s, r) => s + r.itemsFaltantes, 0)
  const totCosto = rows.reduce((s, r) => s + r.costoTotal, 0)
  const totPedido = rows.reduce((s, r) => s + r.costoPedido, 0)
  const totFaltante = rows.reduce((s, r) => s + r.costoFaltante, 0)

  return (
    <div>
      <SectionHeader title="Seguimiento de compras" subtitle={`${rows.length} cotizaciones cerradas · ${totItems} productos`} />

      {/* Progress bar */}
      {totItems > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: '#1a1a1a' }}>
            {totConOC > 0 && <div style={{ width: `${(totConOC / totItems) * 100}%`, background: '#3B82F6', transition: 'width 0.3s' }} />}
            {totFaltantes > 0 && <div style={{ width: `${(totFaltantes / totItems) * 100}%`, background: '#F59E0B', transition: 'width 0.3s' }} />}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11 }}>
            <span style={{ color: '#3B82F6' }}>{totConOC} productos con OC ({Math.round((totConOC / totItems) * 100)}%)</span>
            <span style={{ color: '#F59E0B' }}>{totFaltantes} productos faltantes ({Math.round((totFaltantes / totItems) * 100)}%)</span>
          </div>
        </div>
      )}

      {/* Summary table */}
      <div style={{ overflowX: 'auto' }}>
        <Table>
          <thead><tr>
            <Th>Lead</Th>
            <Th>Cotización</Th>
            <Th>Área</Th>
            <Th right>OCs</Th>
            <Th right>Productos</Th>
            <Th right>Faltantes</Th>
            <Th right>Costo total</Th>
            <Th right>Total pedido</Th>
            <Th right>Total faltante</Th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9}><EmptyState message="No hay cotizaciones cerradas" /></td></tr>}
            {rows.map(r => {
              const espCfg = SPECIALTY_CONFIG[r.specialty as ProjectLine]
              const pctOC = r.totalItems > 0 ? Math.round((r.itemsConOC / r.totalItems) * 100) : 0
              return (
                <tr key={r.id} onClick={() => onOpenDetail(r.id)} style={{ cursor: 'pointer' }}>
                  <Td><span style={{ fontWeight: 600, color: '#fff' }}>{r.lead_name}</span></Td>
                  <Td muted>{r.name}</Td>
                  <Td>{espCfg ? <Badge label={espCfg.icon + ' ' + espCfg.label} color={espCfg.color} /> : <span style={{ color: '#555' }}>--</span>}</Td>
                  <Td right>{r.numOCs > 0 ? <span style={{ color: '#3B82F6', fontWeight: 600 }}>{r.numOCs}</span> : <span style={{ color: '#444' }}>0</span>}</Td>
                  <Td right>{r.totalItems}</Td>
                  <Td right>
                    {r.itemsFaltantes > 0
                      ? <span style={{ color: '#F59E0B', fontWeight: 600 }}>{r.itemsFaltantes}</span>
                      : <span style={{ color: '#57FF9A' }}>✓</span>}
                  </Td>
                  <Td right><span style={{ fontWeight: 600, color: '#ccc' }}>{FCUR(r.costoTotal, r.currency)}</span></Td>
                  <Td right>
                    <span style={{ color: r.costoPedido > 0 ? '#57FF9A' : '#444', fontWeight: 600 }}>
                      {FCUR(r.costoPedido, r.currency)}
                    </span>
                  </Td>
                  <Td right>
                    <span style={{ color: r.costoFaltante > 0 ? '#F59E0B' : '#57FF9A', fontWeight: 600 }}>
                      {r.costoFaltante > 0 ? FCUR(r.costoFaltante, r.currency) : '✓'}
                    </span>
                  </Td>
                </tr>
              )
            })}
            {/* Totals row */}
            {rows.length > 1 && (
              <tr style={{ borderTop: '2px solid #333' }}>
                <Td><span style={{ fontWeight: 700, color: '#fff' }}>Total</span></Td>
                <Td>{' '}</Td>
                <Td>{' '}</Td>
                <Td right><span style={{ fontWeight: 700, color: '#fff' }}>{rows.reduce((s, r) => s + r.numOCs, 0)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: '#fff' }}>{totItems}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: totFaltantes > 0 ? '#F59E0B' : '#57FF9A' }}>{totFaltantes}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: '#fff' }}>{FUSD(totCosto)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: '#57FF9A' }}>{FUSD(totPedido)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: totFaltante > 0 ? '#F59E0B' : '#57FF9A' }}>{totFaltante > 0 ? FUSD(totFaltante) : '✓'}</span></Td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PROCUREMENT DETAIL — Desglose producto por producto
// ═══════════════════════════════════════════════════════════════════════════════

interface DetailItem {
  qi_id: string
  name: string
  quantity: number
  cost: number
  total: number
  currency: string
  supplier: string
  system: string
  // PO info
  po_id: string | null
  po_number: string | null
  po_status: POStatus | null
  po_supplier_name: string | null
  supplier_doc: string | null
  po_date: string | null
  expected_delivery: string | null
  delivered_at: string | null
  // Status
  proc_status: 'vendido' | 'oc_generada' | 'pedido'
}

function ProcurementDetail({ quotationId, onBack, onOpenPO }: { quotationId: string; onBack: () => void; onOpenPO: (id: string) => void }) {
  const isMobile = useIsMobile()
  const [items, setItems] = useState<DetailItem[]>([])
  const [quotInfo, setQuotInfo] = useState<{ name: string; lead_name: string; specialty: string }>({ name: '', lead_name: '', specialty: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      // Quotation info
      const { data: q } = await supabase
        .from('quotations')
        .select('name, client_name, notes, specialty')
        .eq('id', quotationId)
        .single()

      if (q) {
        const notes = typeof q.notes === 'string' ? (() => { try { return JSON.parse(q.notes) } catch { return {} } })() : (q.notes || {})
        setQuotInfo({ name: q.name, lead_name: notes.lead_name || q.client_name || '', specialty: q.specialty || '' })
      }

      // Material items only
      const { data: qItems } = await supabase
        .from('quotation_items')
        .select('id, catalog_product_id, name, quantity, cost, total, provider, provider_currency, system')
        .eq('quotation_id', quotationId)
        .eq('type', 'material')
        .order('order_index')

      // POs for this quotation
      const { data: pos } = await supabase
        .from('purchase_orders')
        .select('id, po_number, status, supplier_doc_number, created_at, expected_delivery, delivered_at, supplier:suppliers(name)')
        .eq('quotation_id', quotationId)

      // PO items
      const poIds = (pos || []).map(p => p.id)
      let poItemsData: any[] = []
      if (poIds.length > 0) {
        const { data } = await supabase
          .from('po_items')
          .select('purchase_order_id, catalog_product_id')
          .in('purchase_order_id', poIds)
        poItemsData = data || []
      }

      // Build lookup
      const paidStatuses: POStatus[] = ['pedida', 'recibida_parcial', 'recibida']
      const poLookup: Record<string, any> = {}
      for (const pi of poItemsData) {
        const po = (pos || []).find(p => p.id === pi.purchase_order_id)
        if (po && pi.catalog_product_id) {
          poLookup[pi.catalog_product_id] = {
            po_id: po.id,
            po_number: po.po_number,
            po_status: po.status,
            po_supplier_name: (po.supplier as any)?.name || '',
            supplier_doc: po.supplier_doc_number || null,
            po_date: po.created_at,
            expected_delivery: po.expected_delivery,
            delivered_at: po.delivered_at,
          }
        }
      }

      const detail: DetailItem[] = (qItems || []).map(qi => {
        const po = qi.catalog_product_id ? poLookup[qi.catalog_product_id] : null
        let proc_status: 'vendido' | 'oc_generada' | 'pedido' = 'vendido'
        if (po) {
          proc_status = paidStatuses.includes(po.po_status) ? 'pedido' : 'oc_generada'
        }
        return {
          qi_id: qi.id,
          name: qi.name,
          quantity: Number(qi.quantity),
          cost: Number(qi.cost),
          total: Number(qi.total),
          currency: qi.provider_currency || 'USD',
          supplier: qi.provider || '',
          system: qi.system || '',
          po_id: po?.po_id || null,
          po_number: po?.po_number || null,
          po_status: po?.po_status || null,
          po_supplier_name: po?.po_supplier_name || null,
          supplier_doc: po?.supplier_doc || null,
          po_date: po?.po_date || null,
          expected_delivery: po?.expected_delivery || null,
          delivered_at: po?.delivered_at || null,
          proc_status,
        }
      })

      setItems(detail)
      setLoading(false)
    }
    load()
  }, [quotationId])

  if (loading) return <Loading />

  const espCfg = SPECIALTY_CONFIG[quotInfo.specialty as ProjectLine]
  const statusColors: Record<string, string> = { vendido: '#F59E0B', oc_generada: '#3B82F6', pedido: '#57FF9A' }
  const statusLabels: Record<string, string> = { vendido: 'Sin OC', oc_generada: 'OC Generada', pedido: 'Pedido' }

  return (
    <div>
      {/* Header with back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: 'none', border: '1px solid #333', borderRadius: 8, padding: '6px 12px', color: '#888', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ChevronLeft size={14} /> Volver
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{quotInfo.lead_name}</div>
          <div style={{ fontSize: 12, color: '#555', display: 'flex', alignItems: 'center', gap: 8 }}>
            {quotInfo.name}
            {espCfg && <Badge label={espCfg.icon + ' ' + espCfg.label} color={espCfg.color} />}
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['vendido', 'oc_generada', 'pedido'] as const).map(s => {
          const cnt = items.filter(i => i.proc_status === s).length
          return cnt > 0 ? (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: statusColors[s] }} />
              <span style={{ color: statusColors[s], fontWeight: 600 }}>{cnt}</span>
              <span style={{ color: '#555' }}>{statusLabels[s]}</span>
            </div>
          ) : null
        })}
        <span style={{ color: '#333' }}>|</span>
        <span style={{ fontSize: 12, color: '#888' }}>{items.length} productos total</span>
      </div>

      {/* Detail table */}
      <div style={{ overflowX: 'auto' }}>
        <Table>
          <thead><tr>
            <Th>Status</Th>
            <Th>Producto</Th>
            <Th>Proveedor cotizado</Th>
            <Th right>Cant</Th>
            <Th right>Total</Th>
            <Th>OC Interna</Th>
            <Th>Proveedor OC</Th>
            <Th>Doc Proveedor</Th>
            <Th>Fecha OC</Th>
            <Th>Entrega esperada</Th>
            <Th>Recibido</Th>
          </tr></thead>
          <tbody>
            {items.map(item => (
              <tr key={item.qi_id}>
                <Td>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: statusColors[item.proc_status],
                    padding: '2px 8px', borderRadius: 10,
                    background: statusColors[item.proc_status] + '18',
                  }}>
                    {statusLabels[item.proc_status]}
                  </span>
                </Td>
                <Td>
                  <div style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: '#ccc' }}>
                    {item.name}
                  </div>
                </Td>
                <Td muted>{item.supplier || '--'}</Td>
                <Td right>{item.quantity}</Td>
                <Td right><span style={{ fontWeight: 600, color: '#ccc' }}>{FCUR(item.total, item.currency)}</span></Td>
                <Td>
                  {item.po_number ? (
                    <span onClick={() => { if (item.po_id) onOpenPO(item.po_id) }}
                      style={{ fontSize: 11, color: '#3B82F6', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>
                      {item.po_number}
                    </span>
                  ) : <span style={{ color: '#333' }}>—</span>}
                </Td>
                <Td muted>{item.po_supplier_name || '--'}</Td>
                <Td muted>{item.supplier_doc || '--'}</Td>
                <Td muted>{item.po_date ? formatDate(item.po_date) : '--'}</Td>
                <Td muted>{item.expected_delivery ? formatDate(item.expected_delivery) : '--'}</Td>
                <Td>
                  {item.delivered_at
                    ? <span style={{ color: '#57FF9A', fontSize: 11 }}>{formatDate(item.delivered_at)}</span>
                    : <span style={{ color: '#333' }}>—</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PO LIST
// ═══════════════════════════════════════════════════════════════════════════════
function POList({ onOpen }: { onOpen: (id: string) => void }) {
  const isMobile = useIsMobile()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  // Resumen de cotejo por OC: { po_id: { total: items, cotejados, sumCotejo } }
  const [cotejoSummary, setCotejoSummary] = useState<Record<string, { total: number; cotejados: number; sumCotejo: number; sumCatalogo: number }>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('todas')
  const [filterSpec, setFilterSpec] = useState<string>('todas')
  const [showNew, setShowNew] = useState(false)
  const [showFromQuote, setShowFromQuote] = useState(false)
  const [showFromPDF, setShowFromPDF] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([
      supabase.from('purchase_orders').select('*,project:projects(name,client_name),supplier:suppliers(name),quotation:quotations(name,client_name,notes)')
        .order('created_at', { ascending: false }),
      supabase.from('po_items').select('purchase_order_id, total, real_total, cotejo_status'),
    ]).then(([poRes, itemsRes]) => {
      setOrders(poRes.data || [])
      // Calcular resumen de cotejo por OC. sumCotejo y sumCatalogo son SUBTOTALES.
      // Los totales mostrados al usuario incluyen IVA 16% (sumCotejo * 1.16).
      const summary: Record<string, { total: number; cotejados: number; sumCotejo: number; sumCatalogo: number }> = {}
      for (const it of (itemsRes.data as any[]) || []) {
        const pid = it.purchase_order_id
        if (!summary[pid]) summary[pid] = { total: 0, cotejados: 0, sumCotejo: 0, sumCatalogo: 0 }
        summary[pid].total += 1
        summary[pid].sumCatalogo += Number(it.total) || 0
        const isCotejado = it.cotejo_status === 'cotejado' || it.cotejo_status === 'sustituido'
        if (isCotejado) summary[pid].cotejados += 1
        // Si cotejado y hay real_total, usar real_total; sino fallback al catálogo
        const valor = isCotejado && it.real_total != null ? Number(it.real_total) : Number(it.total) || 0
        summary[pid].sumCotejo += valor
      }
      setCotejoSummary(summary)
      setLoading(false)
    })
  }
  useEffect(load, [])

  async function downloadPdf(o: PurchaseOrder) {
    const [{ data: poFull }, { data: poItems }] = await Promise.all([
      supabase.from('purchase_orders').select('*,supplier:suppliers(*),quotation:quotations(name)').eq('id', o.id).single(),
      supabase.from('po_items').select('*').eq('purchase_order_id', o.id).order('order_index'),
    ])
    if (!poFull || !poItems) return
    const catIds = [...new Set(poItems.map((it: any) => it.catalog_product_id).filter(Boolean))]
    let catMap = new Map<string, any>()
    if (catIds.length) {
      const { data: cats } = await supabase.from('catalog_products').select('id,marca,modelo').in('id', catIds)
      if (cats) catMap = new Map(cats.map(c => [c.id, c]))
    }
    const enriched = poItems.map((it: any) => ({
      ...it,
      marca: it.catalog_product_id ? catMap.get(it.catalog_product_id)?.marca || '' : '',
      modelo: it.catalog_product_id ? catMap.get(it.catalog_product_id)?.modelo || '' : '',
    }))
    generatePOPdf(poFull as any, enriched)
  }

  const getLeadName = (o: PurchaseOrder) => {
    const q = (o as any).quotation
    if (!q) return null
    try { const n = typeof q.notes === 'string' ? JSON.parse(q.notes) : q.notes; if (n?.lead_name) return n.lead_name } catch {}
    return q.client_name || null
  }
  const getQuotName = (o: PurchaseOrder) => (o as any).quotation?.name || null

  let lista = orders
  if (filterStatus !== 'todas') lista = lista.filter(o => o.status === filterStatus)
  if (filterSpec !== 'todas') lista = lista.filter(o => o.specialty === filterSpec)
  if (search) {
    const q = search.toLowerCase()
    lista = lista.filter(o =>
      o.po_number.toLowerCase().includes(q) ||
      (o.supplier as any)?.name?.toLowerCase().includes(q) ||
      (o.project as any)?.name?.toLowerCase().includes(q) ||
      (o as any).quotation?.name?.toLowerCase().includes(q) ||
      (getLeadName(o) || '').toLowerCase().includes(q)
    )
  }

  // Helper: total cotejado de una OC con IVA 16% (real_total cuando aplique, sino catálogo)
  // sumCotejo es SUBTOTAL — se multiplica por 1.16 para igualar a o.total que ya incluye IVA
  const getCotejoTotal = (o: PurchaseOrder) => {
    const s = cotejoSummary[o.id]?.sumCotejo
    return s != null ? s * 1.16 : o.total
  }
  const totalFilteredMXN = lista.filter(o => o.currency === 'MXN').reduce((s, o) => s + getCotejoTotal(o), 0)
  const totalFilteredUSD = lista.filter(o => o.currency === 'USD').reduce((s, o) => s + getCotejoTotal(o), 0)

  return (
    <div>
      <SectionHeader title="Órdenes de compra"
        subtitle={`${lista.length} órdenes | MXN: ${F(totalFilteredMXN)} · USD: ${FUSD(totalFilteredUSD)}`}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={() => setShowFromPDF(true)} style={{ borderColor: '#A855F7', color: '#C084FC' }}><Sparkles size={14} /> Desde PDF (IA)</Btn>
          <Btn onClick={() => setShowFromQuote(true)}><Copy size={14} /> Desde cotización</Btn>
            <Btn variant="primary" onClick={() => setShowNew(true)}><Plus size={14} /> Nueva OC</Btn>
          </div>
        } />

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap', fontSize: isMobile ? 11 : 12 }}>
        <div style={{ position: 'relative', flex: isMobile ? '1 1 100%' : '0 0 220px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#555' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar OC, proveedor, cotización, lead..."
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
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <thead><tr>
              <Th>OC #</Th><Th>Proveedor</Th><Th>Cotización</Th><Th>Lead</Th><Th>Especialidad</Th><Th>Fase</Th><Th>Estado</Th><Th>Cotejo</Th><Th>Fecha</Th><Th right>Total MXN</Th><Th right>Total USD</Th><Th></Th>
          </tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={12}><EmptyState message="Sin órdenes de compra" /></td></tr>}
            {lista.map(o => {
              const st = PO_STATUS_CFG[o.status]
              const esp = SPECIALTY_CONFIG[o.specialty]
              const phaseCfg = o.purchase_phase ? PHASE_CONFIG[o.purchase_phase] : null
              const summary = cotejoSummary[o.id]
              const cotejoPct = summary && summary.total > 0 ? (summary.cotejados / summary.total) : 0
              const allCotejado = summary && summary.cotejados > 0 && summary.cotejados === summary.total
              const noCotejado = !summary || summary.cotejados === 0
              const cotejoColor = allCotejado ? '#57FF9A' : noCotejado ? '#6B7280' : '#F59E0B'
              const cotejoLabel = !summary || summary.total === 0
                ? 'Sin items'
                : allCotejado ? `✓ ${summary.cotejados}/${summary.total}`
                : noCotejado ? `Sin cotejar`
                : `${summary.cotejados}/${summary.total}`
              // Total con IVA 16% para mostrar al usuario (igual a pagos reales / o.total)
              const displayTotal = summary?.sumCotejo != null ? summary.sumCotejo * 1.16 : o.total
              return (
                <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(o.id)}>
                  <Td><span style={{ fontWeight: 600, color: '#fff' }}>{o.po_number}</span></Td>
                  <Td>{(o.supplier as any)?.name || <span style={{ color: '#555' }}>--</span>}</Td>
                  <Td muted>{getQuotName(o) || '--'}</Td>
                  <Td muted>{getLeadName(o) || '--'}</Td>
                  <Td><Badge label={esp.icon + ' ' + esp.label} color={esp.color} /></Td>
                  <Td>{phaseCfg ? <Badge label={phaseCfg.label} color={phaseCfg.color} /> : <span style={{color:'#555',fontSize:11}}>--</span>}</Td>
                  <Td><Badge label={st.label} color={st.color} /></Td>
                  <Td><Badge label={cotejoLabel} color={cotejoColor} /></Td>
                  <Td muted>{formatDate(o.created_at)}</Td>
                  <Td right>{o.currency === 'MXN' ? <span style={{ fontWeight: 600, color: allCotejado ? '#57FF9A' : noCotejado ? '#ccc' : '#F59E0B' }} title={allCotejado ? 'Total cotejado' : noCotejado ? 'Total catálogo (sin cotejar)' : 'Mezcla de catálogo + cotejado'}>{F(displayTotal)}</span> : <span style={{ color: '#333' }}>—</span>}</Td>
                  <Td right>{o.currency === 'USD' ? <span style={{ fontWeight: 600, color: allCotejado ? '#57FF9A' : noCotejado ? '#ccc' : '#F59E0B' }} title={allCotejado ? 'Total cotejado' : noCotejado ? 'Total catálogo (sin cotejar)' : 'Mezcla de catálogo + cotejado'}>{FUSD(displayTotal)}</span> : <span style={{ color: '#333' }}>—</span>}</Td>
                  <Td><div style={{ display: 'flex', gap: 4 }}>
                    <Btn size="sm" onClick={e => { e?.stopPropagation(); downloadPdf(o) }}><Download size={13} /></Btn>
                    <Btn size="sm" onClick={e => { e?.stopPropagation(); onOpen(o.id) }}>Abrir</Btn>
                  </div></Td>
                </tr>
              )
            })}
            </tbody>
          </Table>
        </div>
      )}

      {showNew && <NuevaPOModal onClose={() => setShowNew(false)} onCreated={id => { setShowNew(false); onOpen(id) }} />}
      {showFromQuote && <POFromQuoteModal onClose={() => setShowFromQuote(false)} onCreated={id => { setShowFromQuote(false); onOpen(id) }} />}
      {showFromPDF && <POFromPDFModal onClose={() => setShowFromPDF(false)} onCreated={(id) => { setShowFromPDF(false); load(); onOpen(id) }} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NUEVA PO DESDE PDF (IA)
// ═══════════════════════════════════════════════════════════════════════════════

function POFromPDFModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [step, setStep] = useState<'upload' | 'processing' | 'review'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [extracted, setExtracted] = useState<any>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [saving, setSaving] = useState(false)

  // Form state for review step
  const [supplierId, setSupplierId] = useState('')
  const [createNewSupplier, setCreateNewSupplier] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [specialty, setSpecialty] = useState<ProjectLine>('elec')
  const [phase, setPhase] = useState<PurchasePhase>('roughin')
  const [items, setItems] = useState<any[]>([])
  const [supplierData, setSupplierData] = useState({ name: '', rfc: '', contact_name: '', contact_phone: '', contact_email: '', address: '' })
  const [currency, setCurrency] = useState<'MXN' | 'USD'>('USD')
  const [notes, setNotes] = useState('')
  const [docNumber, setDocNumber] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      supabase.from('projects').select('*').order('name'),
    ]).then(([s, p]) => {
      setSuppliers((s.data as Supplier[]) || [])
      setProjects((p.data as Project[]) || [])
    })
  }, [])

  async function processFile(f: File) {
    setFile(f)
    setStep('processing')
    setError('')
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res((r.result as string).split(',')[1])
        r.onerror = () => rej(new Error('Error leyendo archivo'))
        r.readAsDataURL(f)
      })

      const systemPrompt = `Eres un experto en compras y procurement de instalaciones eléctricas y especiales en México. Extrae los datos de esta orden de compra, cotización o factura proforma de proveedor.

Devuelve SOLO un JSON sin markdown, sin explicaciones, con esta estructura exacta:
{
  "supplier": {
    "name": "nombre comercial completo del proveedor",
    "rfc": "RFC si aparece, vacío si no",
    "contact_name": "nombre del contacto/vendedor si aparece",
    "contact_phone": "teléfono si aparece",
    "contact_email": "email si aparece",
    "address": "dirección completa si aparece"
  },
  "document_number": "folio del proveedor (su número de cotización/OC/factura)",
  "document_date": "YYYY-MM-DD",
  "currency": "MXN o USD (detectar del documento, default USD si no es claro)",
  "items": [
    {
      "name": "nombre corto del producto",
      "description": "descripción detallada con marca/modelo/especificaciones",
      "quantity": 0,
      "unit": "pza/m/kg/etc",
      "unit_cost": 0,
      "total": 0
    }
  ],
  "subtotal": 0,
  "iva": 0,
  "total": 0,
  "notes": "condiciones de entrega, garantía, tiempo de entrega, forma de pago, observaciones relevantes"
}

REGLAS:
- Todos los montos siempre positivos
- Si no encuentras un campo, usa string vacío para texto o 0 para números
- El campo "items" debe contener TODOS los productos del documento, sin omitir ninguno
- Si el documento muestra IVA desglosado, sepáralo en "iva". Si solo muestra total, calcula iva = total - subtotal
- Detecta moneda por símbolo (\$ MXN, USD, US\$, etc.) o por contexto`

      const messages = [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: systemPrompt }
        ]
      }]

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
          'anthropic-version': '2023-06-01',
          'x-api-key': ANTHROPIC_API_KEY,
        },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 8000, messages }),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        setError('Error API: ' + (errData.error?.message || response.status))
        setStep('upload')
        return
      }

      const data = await response.json()
      const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        setError('No se pudo extraer JSON de la respuesta')
        setStep('upload')
        return
      }
      const parsed = JSON.parse(jsonMatch[0].replace(/```json|```/g, '').trim())

      // Pre-fill form
      setExtracted(parsed)
      setSupplierData(parsed.supplier || { name: '', rfc: '', contact_name: '', contact_phone: '', contact_email: '', address: '' })
      setItems((parsed.items || []).map((it: any) => ({
        name: it.name || '',
        description: it.description || '',
        quantity: Number(it.quantity) || 1,
        unit: it.unit || 'pza',
        unit_cost: Number(it.unit_cost) || 0,
        total: Number(it.total) || 0,
      })))
      setCurrency(parsed.currency === 'MXN' ? 'MXN' : 'USD')
      setNotes(parsed.notes || '')
      setDocNumber(parsed.document_number || '')

      // Auto-match supplier by name (fuzzy)
      const extractedName = (parsed.supplier?.name || '').toLowerCase().trim()
      if (extractedName) {
        const match = suppliers.find(s => {
          const n = s.name.toLowerCase()
          if (n === extractedName) return true
          if (n.includes(extractedName) || extractedName.includes(n)) return true
          const firstWord = extractedName.split(' ')[0]
          if (firstWord.length > 3 && n.includes(firstWord)) return true
          return false
        })
        if (match) {
          setSupplierId(match.id)
          setCreateNewSupplier(false)
        } else {
          setCreateNewSupplier(true)
        }
      }

      setStep('review')
    } catch (e) {
      setError('Error: ' + (e as Error).message)
      setStep('upload')
    }
  }

  function updateItem(idx: number, field: string, value: any) {
    const updated = [...items]
    updated[idx] = { ...updated[idx], [field]: value }
    if (field === 'quantity' || field === 'unit_cost') {
      updated[idx].total = (Number(updated[idx].quantity) || 0) * (Number(updated[idx].unit_cost) || 0)
    }
    setItems(updated)
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx))
  }

  const subtotal = items.reduce((s, it) => s + (Number(it.total) || 0), 0)
  const iva = Math.round(subtotal * 0.16)
  const total = subtotal + iva

  async function crear() {
    setSaving(true)
    setError('')

    let finalSupplierId = supplierId

    // Create new supplier if needed
    if (createNewSupplier && supplierData.name) {
      // Build supplier insert with only safe columns; put address into notas to avoid schema mismatch
      const supplierInsert: any = {
        name: supplierData.name,
        rfc: supplierData.rfc || null,
        contact_name: supplierData.contact_name || null,
        contact_phone: supplierData.contact_phone || null,
        contact_email: supplierData.contact_email || null,
        is_active: true,
      }
      if (supplierData.address) {
        supplierInsert.notas = 'Dirección: ' + supplierData.address
      }
      const { data: newSup, error: supErr } = await supabase.from('suppliers').insert(supplierInsert).select().single()
      if (supErr || !newSup) {
        setError('Error al crear proveedor: ' + (supErr?.message || 'desconocido'))
        setSaving(false)
        return
      }
      finalSupplierId = newSup.id
    }

    if (!finalSupplierId) {
      setError('Selecciona o crea un proveedor')
      setSaving(false)
      return
    }

    if (items.length === 0) {
      setError('Agrega al menos un item')
      setSaving(false)
      return
    }

    // Generate folio
    const now = new Date()
    const prefix = `OC-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`
    const { count } = await supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).like('po_number', `${prefix}%`)
    const num = String((count || 0) + 1).padStart(3, '0')
    const po_number = `${prefix}-${num}`

    const { data: po, error: err } = await supabase.from('purchase_orders').insert({
      po_number,
      project_id: projectId || null,
      supplier_id: finalSupplierId,
      specialty,
      status: 'borrador',
      purchase_phase: phase,
      subtotal,
      iva,
      total,
      currency,
      supplier_doc_number: docNumber || null,
      notes: notes || null,
    }).select().single()

    if (err || !po) {
      setError(err?.message || 'Error al crear OC')
      setSaving(false)
      return
    }

    const poItems = items.map((it: any, i: number) => ({
      purchase_order_id: po.id,
      catalog_product_id: null,
      name: it.name,
      description: it.description || null,
      system: null,
      unit: it.unit || 'pza',
      quantity: Number(it.quantity) || 1,
      unit_cost: Number(it.unit_cost) || 0,
      total: Number(it.total) || 0,
      currency,
      quantity_received: 0,
      order_index: i,
    }))
    await supabase.from('po_items').insert(poItems)

    setSaving(false)
    onCreated(po.id)
  }

  const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
  const modalStyle: React.CSSProperties = { background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24, width: 720, maxHeight: '90vh', overflowY: 'auto' }
  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { fontSize: 11, color: '#666', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4, display: 'block' }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color="#C084FC" /> OC desde PDF (IA)
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {error && <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: 10, color: '#f87171', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        {step === 'upload' && (
          <div>
            <div style={{ border: '2px dashed #2a2a2a', borderRadius: 12, padding: 40, textAlign: 'center' as const, cursor: 'pointer' }}
              onClick={() => document.getElementById('pdf-input')?.click()}
              onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).style.borderColor = '#A855F7' }}
              onDragLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#2a2a2a' }}
              onDrop={e => {
                e.preventDefault()
                ;(e.currentTarget as HTMLDivElement).style.borderColor = '#2a2a2a'
                const f = e.dataTransfer.files[0]
                if (f && f.type === 'application/pdf') processFile(f)
                else setError('Sube un archivo PDF')
              }}>
              <Upload size={32} color="#666" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 14, color: '#aaa', marginBottom: 4 }}>Arrastra un PDF aquí o haz click</div>
              <div style={{ fontSize: 11, color: '#555' }}>Orden de compra, cotización o factura proforma del proveedor</div>
            </div>
            <input id="pdf-input" type="file" accept="application/pdf" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
          </div>
        )}

        {step === 'processing' && (
          <div style={{ padding: 60, textAlign: 'center' as const }}>
            <div style={{ fontSize: 14, color: '#C084FC', marginBottom: 8 }}><Sparkles size={20} /> Analizando PDF con IA...</div>
            <div style={{ fontSize: 11, color: '#555' }}>Extrayendo proveedor, productos y montos</div>
          </div>
        )}

        {step === 'review' && (
          <div style={{ display: 'grid', gap: 14 }}>
            {/* Proveedor */}
            <div>
              <label style={labelStyle}>Proveedor</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <button onClick={() => setCreateNewSupplier(false)} style={{ padding: '5px 12px', borderRadius: 16, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${!createNewSupplier ? '#57FF9A' : '#333'}`, background: !createNewSupplier ? '#57FF9A22' : 'transparent', color: !createNewSupplier ? '#57FF9A' : '#666' }}>Existente</button>
                <button onClick={() => setCreateNewSupplier(true)} style={{ padding: '5px 12px', borderRadius: 16, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${createNewSupplier ? '#A855F7' : '#333'}`, background: createNewSupplier ? '#A855F722' : 'transparent', color: createNewSupplier ? '#C084FC' : '#666' }}>Crear nuevo</button>
              </div>
              {!createNewSupplier ? (
                <select value={supplierId} onChange={e => setSupplierId(e.target.value)} style={inputStyle}>
                  <option value="">-- Selecciona proveedor --</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  <input placeholder="Nombre" value={supplierData.name} onChange={e => setSupplierData({ ...supplierData, name: e.target.value })} style={inputStyle} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <input placeholder="RFC" value={supplierData.rfc} onChange={e => setSupplierData({ ...supplierData, rfc: e.target.value })} style={inputStyle} />
                    <input placeholder="Contacto" value={supplierData.contact_name} onChange={e => setSupplierData({ ...supplierData, contact_name: e.target.value })} style={inputStyle} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <input placeholder="Teléfono" value={supplierData.contact_phone} onChange={e => setSupplierData({ ...supplierData, contact_phone: e.target.value })} style={inputStyle} />
                    <input placeholder="Email" value={supplierData.contact_email} onChange={e => setSupplierData({ ...supplierData, contact_email: e.target.value })} style={inputStyle} />
                  </div>
                </div>
              )}
            </div>

            {/* Folio del proveedor */}
            <div>
              <label style={labelStyle}>Folio del proveedor (su número de OC/cotización)</label>
              <input value={docNumber} onChange={e => setDocNumber(e.target.value)} placeholder="Ej. OV-12345" style={inputStyle} />
            </div>

            {/* Proyecto + Especialidad + Fase + Moneda */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelStyle}>Obra / Proyecto</label>
                <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inputStyle}>
                  <option value="">-- Sin proyecto --</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Moneda</label>
                <select value={currency} onChange={e => setCurrency(e.target.value as 'MXN' | 'USD')} style={inputStyle}>
                  <option value="USD">USD</option>
                  <option value="MXN">MXN</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Especialidad</label>
                <select value={specialty} onChange={e => setSpecialty(e.target.value as ProjectLine)} style={inputStyle}>
                  {Object.entries(SPECIALTY_CONFIG).map(([k, v]: any) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Fase</label>
                <select value={phase} onChange={e => setPhase(e.target.value as PurchasePhase)} style={inputStyle}>
                  {Object.entries(PHASE_CONFIG).map(([k, v]: any) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>

            {/* Items */}
            <div>
              <label style={labelStyle}>Items extraídos ({items.length})</label>
              <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 10, padding: 8, maxHeight: 240, overflowY: 'auto' }}>
                {items.length === 0 && <div style={{ fontSize: 11, color: '#555', padding: 10, textAlign: 'center' as const }}>No se extrajeron items</div>}
                {items.map((it, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 60px 60px 90px 90px 24px', gap: 4, padding: '6px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'center' }}>
                    <input value={it.name} onChange={e => updateItem(i, 'name', e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} placeholder="Producto" />
                    <input type="number" value={it.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} />
                    <input value={it.unit} onChange={e => updateItem(i, 'unit', e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} />
                    <input type="number" value={it.unit_cost} onChange={e => updateItem(i, 'unit_cost', e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} />
                    <input type="number" value={it.total} onChange={e => updateItem(i, 'total', e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} />
                    <button onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 2 }}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </div>

            {/* Totales */}
            <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 10, padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 12 }}>
              <div><div style={{ color: '#555', fontSize: 10 }}>Subtotal</div><div style={{ color: '#fff', fontWeight: 600 }}>{currency === 'USD' ? FUSD(subtotal) : F(subtotal)}</div></div>
              <div><div style={{ color: '#555', fontSize: 10 }}>IVA (16%)</div><div style={{ color: '#fff', fontWeight: 600 }}>{currency === 'USD' ? FUSD(iva) : F(iva)}</div></div>
              <div><div style={{ color: '#555', fontSize: 10 }}>Total</div><div style={{ color: '#57FF9A', fontWeight: 700 }}>{currency === 'USD' ? FUSD(total) : F(total)}</div></div>
            </div>

            {/* Notas */}
            <div>
              <label style={labelStyle}>Notas</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, minHeight: 50, fontFamily: 'inherit', resize: 'vertical' }} />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          {step === 'review' && <Btn variant="primary" onClick={crear} disabled={saving || items.length === 0}>{saving ? 'Creando...' : 'Crear OC'}</Btn>}
        </div>
      </div>
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
      supabase.from('quotations').select('*,project:projects!quotations_project_id_fkey(name,client_name)').in('stage', ['propuesta', 'contrato']).order('updated_at', { ascending: false }),
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
    ]).then(([lRes, qRes, sRes]) => {
      setLeads(lRes.data || [])
      setQuotations(qRes.data || [])
      setSuppliers(sRes.data || [])
      setLoading(false)
    })
  }, [])

  // Filter quotations by lead (check notes.lead_id first, fallback to name match)
  const filteredQuotes = selectedLead
    ? quotations.filter(q => {
        try {
          const meta = JSON.parse(q.notes || '{}')
          if (meta.lead_id === selectedLead) return true
        } catch {}
        const leadName = leads.find(l => l.id === selectedLead)?.name?.toLowerCase() || ''
        return leadName && (q.client_name?.toLowerCase().includes(leadName) || q.name?.toLowerCase().includes(leadName))
      })
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

      // Enrich items with catalog data (provider, moneda, cost) for filtering and correct pricing
      const catIds = [...new Set(items.map(it => it.catalog_product_id).filter(Boolean))]
      let catMap = new Map<string, { provider: string; moneda: string; cost: number }>()
      if (catIds.length > 0) {
        const { data: catProducts } = await supabase.from('catalog_products').select('id, provider, moneda, cost').in('id', catIds)
        ;(catProducts || []).forEach((p: any) => catMap.set(p.id, { provider: p.provider || '', moneda: p.moneda || 'USD', cost: Number(p.cost) || 0 }))
      }
      items = items.map((it: any) => {
        const cat = it.catalog_product_id ? catMap.get(it.catalog_product_id) : null
        // Always use catalog cost if available (quotation_items.cost can be wrong — sometimes has precio_venta)
        const realCost = cat?.cost || Number(it.cost) || 0
        return { ...it, cost: realCost, _provider: it.provider || cat?.provider || '', _moneda: cat?.moneda || 'USD' }
      })

      // Consolidate duplicate products (same catalog_product_id or same name) — sum quantities
      const consolidated = new Map<string, any>()
      items.forEach((it: any) => {
        const key = it.catalog_product_id || it.name
        if (consolidated.has(key)) {
          const existing = consolidated.get(key)
          existing.quantity = Number(existing.quantity) + Number(it.quantity)
        } else {
          consolidated.set(key, { ...it, quantity: Number(it.quantity) })
        }
      })
      items = Array.from(consolidated.values())

      // Filter by phase — strict filter
      if (selectedPhase) {
        items = items.filter(it => it.purchase_phase === selectedPhase)
      }
      // Filter by supplier — strict, using enriched _provider from catalog
      if (selectedSupplier) {
        const sup = suppliers.find(s => s.id === selectedSupplier)
        if (sup) {
          const supLower = sup.name.toLowerCase()
          items = items.filter(it => {
            if (it.supplier_id === selectedSupplier) return true
            const provLower = (it._provider || '').toLowerCase()
            if (!provLower) return false
            if (supLower.includes(provLower) || provLower.includes(supLower)) return true
            const supFirst = supLower.split(' ')[0]
            const provFirst = provLower.split(' ')[0]
            if (provFirst.length > 2 && supFirst.includes(provFirst)) return true
            if (supFirst.length > 2 && provFirst.includes(supFirst)) return true
            return false
          })
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

    const supplierName = suppliers.find(s => s.id === selectedSupplier)?.name || ''
    const phaseCfg = PHASE_CONFIG[selectedPhase]

    // Group items by currency (MXN/USD). If mixed, create 2 separate POs.
    const itemsByCurrency: Record<string, any[]> = { MXN: [], USD: [] }
    previewItems.forEach((it: any) => {
      const cur = it._moneda === 'MXN' ? 'MXN' : 'USD'
      itemsByCurrency[cur].push(it)
    })

    const currencies = (['MXN','USD'] as const).filter(c => itemsByCurrency[c].length > 0)
    let createdIds: string[] = []
    let baseCount = count || 0

    for (let ci = 0; ci < currencies.length; ci++) {
      const cur = currencies[ci]
      const groupItems = itemsByCurrency[cur]
      const groupSubtotal = groupItems.reduce((s: number, it: any) => s + (it.cost * it.quantity), 0)
      const groupIva = Math.round(groupSubtotal * 0.16)
      const thisNum = String(baseCount + 1 + ci).padStart(3, '0')
      const thisPoNumber = `${prefix}-${thisNum}`

      const { data: po, error: err } = await supabase.from('purchase_orders').insert({
        po_number: thisPoNumber,
        project_id: quote.project_id || null,
        supplier_id: selectedSupplier || null,
        quotation_id: quote.id,
        specialty: quote.specialty,
        status: 'borrador',
        purchase_phase: selectedPhase,
        subtotal: groupSubtotal,
        iva: groupIva,
        total: groupSubtotal + groupIva,
        currency: cur,
        notes: `${quote.name} | ${supplierName} | ${phaseCfg?.label || selectedPhase}${currencies.length > 1 ? ' | ' + cur : ''}`,
      }).select().single()

      if (err || !po) { setError(err?.message || 'Error al crear'); setSaving(false); return }
      createdIds.push(po.id)

      const poItems = groupItems.map((it: any, i: number) => ({
        purchase_order_id: po.id,
        catalog_product_id: it.catalog_product_id || null,
        name: it.name,
        description: it.description || null,
        marca: it.marca || null,
        modelo: it.modelo || null,
        system: it.system || null,
        unit: 'pza',
        quantity: it.quantity,
        unit_cost: it.cost,
        total: it.cost * it.quantity,
        currency: cur,
        quantity_received: 0,
        order_index: i,
      }))
      await supabase.from('po_items').insert(poItems)
    }

    setSaving(false)
    onCreated(createdIds[0])
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
          <SearchableSelect label="Lead (opcional — filtra cotizaciones)" value={selectedLead}
            onChange={v => { setSelectedLead(v); setSelectedQuote('') }}
            options={leads.map(l => ({ value: l.id, label: `${l.name}${l.company ? ' | ' + l.company : ''}` }))}
            placeholder="-- Todos los leads --" />

          {/* Cotización */}
          <SearchableSelect label="Cotización (propuesta o contrato)" value={selectedQuote}
            onChange={v => setSelectedQuote(v)}
            options={filteredQuotes.map(q => ({
              value: q.id,
              label: `${q.name} — ${(q.project as any)?.name || 'Sin proyecto'} — ${F(q.specialty === 'elec' ? (q.total || 0) * 1.16 : (q.total || 0))}`,
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
  const [obras, setObras] = useState<Obra[]>([])
  const [leads, setLeads] = useState<Array<{ id: string; name: string; company?: string }>>([])
  const [quotations, setQuotations] = useState<Array<{ id: string; name: string; lead_id: string; specialty?: string; total?: number; currency?: string }>>([])
  // Cache de cotizaciones por lead — se llena bajo demanda con query directa a Supabase
  // usando LIKE sobre notes. Garantiza que aparezcan TODAS las cotizaciones del lead
  // aunque el cache global esté desactualizado o falle el parseo de notes.
  const [quotesByLead, setQuotesByLead] = useState<Record<string, Array<{ id: string; name: string; lead_id: string; specialty?: string; total?: number; currency?: string }>>>({})
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showAddItem, setShowAddItem] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')
  // Agentes/playbooks de cotización por proveedor (dispatcher)
  const [playbooks, setPlaybooks] = useState<Array<{ id: string; supplier_id: string; name: string; method: string; config: any; active: boolean }>>([])
  const [showAgentModal, setShowAgentModal] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([
      supabase.from('purchase_orders').select('*,project:projects(name,client_name),supplier:suppliers(*)').eq('id', poId).single(),
      supabase.from('po_items').select('*').eq('purchase_order_id', poId).order('order_index'),
      supabase.from('catalog_products').select('*').eq('is_active', true).order('name'),
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      supabase.from('projects').select('*').eq('status', 'activo').order('name'),
      supabase.from('obras').select('id,nombre,project_id').order('nombre'),
      supabase.from('leads').select('id,name,company').order('updated_at', { ascending: false }),
      supabase.from('quotations').select('id,name,notes,specialty,total,updated_at').order('updated_at', { ascending: false }),
      supabase.from('supplier_quote_playbooks').select('*').eq('active', true),
    ]).then(([poRes, itemsRes, catRes, supRes, projRes, obrRes, leadRes, quoRes, pbRes]) => {
      setPO(poRes.data)
      setItems(itemsRes.data || [])
      setCatalog(catRes.data || [])
      setSuppliers(supRes.data || [])
      setProjects(projRes.data || [])
      setObras(obrRes.data || [])
      setLeads((leadRes.data as any[]) || [])
      // Mapear quotations con lead_id y currency parseados desde notes JSON
      const qList = ((quoRes.data as any[]) || []).map(q => {
        let lead_id = ''
        let currency = ''
        try {
          const m = typeof q.notes === 'string' ? JSON.parse(q.notes || '{}') : q.notes
          if (m?.lead_id) lead_id = m.lead_id
          if (m?.currency) currency = m.currency
        } catch {}
        return { ...q, lead_id, currency }
      })
      setQuotations(qList)
      setPlaybooks((pbRes?.data as any[]) || [])
      setLoading(false)
    })
  }
  useEffect(load, [poId])

  // Helper dispatcher: devuelve el playbook activo para un supplier_id, o null
  const getPlaybookForSupplier = (supplierId: string | null | undefined) => {
    if (!supplierId) return null
    return playbooks.find(p => p.supplier_id === supplierId) || null
  }

  // Carga cotizaciones de un lead específico. Estrategia:
  // 1. Query por UUID del lead como substring (sin comillas — porque las comillas
  //    en el patrón URL-encoded pueden fallar en algunos casos).
  // 2. Filtrar del lado cliente parseando notes JSON para confirmar match exacto
  //    de lead_id (evita falsos positivos por UUIDs similares).
  async function loadQuotesForLead(leadId: string) {
    if (!leadId) return
    const { data, error } = await supabase
      .from('quotations')
      .select('id,name,notes,specialty,total,updated_at')
      .ilike('notes', `%${leadId}%`)
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('loadQuotesForLead error:', error)
      return
    }
    // Filtrar del lado cliente: parsear notes y confirmar lead_id exacto
    const list = ((data as any[]) || [])
      .map(q => {
        let parsedLeadId = ''
        let currency = ''
        try {
          const m = typeof q.notes === 'string' ? JSON.parse(q.notes || '{}') : q.notes
          if (m?.lead_id) parsedLeadId = m.lead_id
          if (m?.currency) currency = m.currency
        } catch {}
        return { ...q, lead_id: parsedLeadId, currency }
      })
      .filter(q => q.lead_id === leadId)
    console.log(`[loadQuotesForLead] lead=${leadId} → ${list.length} cotizaciones`)
    setQuotesByLead(prev => ({ ...prev, [leadId]: list }))
    // Merge en el cache global por si la cotización seleccionada es nueva
    setQuotations(prev => {
      const existing = new Map(prev.map(q => [q.id, q]))
      for (const q of list) existing.set(q.id, q)
      return Array.from(existing.values())
    })
  }

  // Effective lead_id: po.lead_id (columna directa) o derivado de la cotización vinculada.
  // Necesario para POs viejas que no tienen lead_id guardado pero sí tienen quotation_id.
  const linkedQuoteForEffect = quotations.find(q => q.id === po?.quotation_id)
  const effectiveLeadId: string = ((po as any)?.lead_id || linkedQuoteForEffect?.lead_id || '') as string

  // Autocargar cotizaciones del lead cuando cambia el effective lead_id
  useEffect(() => {
    if (effectiveLeadId && !quotesByLead[effectiveLeadId]) {
      loadQuotesForLead(effectiveLeadId)
    }
  }, [effectiveLeadId])

  if (loading || !po) return <div style={{ padding: '24px 28px' }}><Loading /></div>

  const stCfg = PO_STATUS_CFG[po.status]
  const esp = SPECIALTY_CONFIG[po.specialty]

  // Recalcular totales — usa real_total cuando el item esta cotejado
  // (cotejo_status='cotejado'|'sustituido' y real_total != null). Asi:
  // - Subtotal/total reflejan el monto REAL pagado/recibido
  // - po.total queda con el monto cotejado al guardar (no se sobreescribe con catalogo)
  // - La lista de OCs (POList) muestra el monto correcto automaticamente
  const itemValue = (it: POItem): number => {
    const isCotejado = it.cotejo_status === 'cotejado' || it.cotejo_status === 'sustituido'
    return isCotejado && it.real_total != null ? Number(it.real_total) : Number(it.total) || 0
  }
  const subtotal = items.reduce((s, it) => s + itemValue(it), 0)
  const subtotalCatalogo = items.reduce((s, it) => s + (Number(it.total) || 0), 0)
  const iva = Math.round(subtotal * 0.16)
  const total = subtotal + iva

  async function guardar() {
    if (!po) return
    setSaving(true)
    // Update all items
    for (const it of items) {
      await supabase.from('po_items').update({
        name: it.name, description: it.description, system: it.system, unit: it.unit,
        marca: it.marca || null, modelo: it.modelo || null,
        quantity: it.quantity, unit_cost: it.unit_cost, total: it.total,
        quantity_received: it.quantity_received,
        real_name: it.real_name || null, real_unit_cost: it.real_unit_cost ?? null,
        real_quantity: it.real_quantity ?? null, real_total: it.real_total ?? null,
        real_marca: it.real_marca || null, real_modelo: it.real_modelo || null,
        cotejo_status: it.cotejo_status || 'pendiente', cotejo_notes: it.cotejo_notes || null,
      }).eq('id', it.id)
    }
    // Update PO totals
    await supabase.from('purchase_orders').update({
      subtotal, iva, total,
      supplier_id: po.supplier_id || null,
      project_id: po.project_id || null,
      quotation_id: po.quotation_id || null,
      lead_id: (po as any).lead_id || null,
      notes: po.notes || null,
      supplier_doc_number: po.supplier_doc_number || null,
      expected_delivery: po.expected_delivery || null,
      logistics_mode: po.logistics_mode || 'pending',
      logistics_target_obra_id: po.logistics_target_obra_id || null,
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
      marca: (product as any).marca || null,
      modelo: (product as any).modelo || null,
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
  const partialCotejado = cotejados > 0 && cotejados < totalItems
  const cotejoComplete = allCotejado || totalItems === 0
  // Labels dinamicos del panel de totales
  const subtotalLabel = allCotejado ? 'Subtotal cotejado' : partialCotejado ? `Subtotal (${cotejados}/${totalItems} cotejados)` : 'Subtotal catálogo'
  const totalLabel = allCotejado ? 'Total cotejado' : partialCotejado ? 'Total mixto' : 'Total catálogo'

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
          <Btn size="sm" onClick={() => {
            const catMap = new Map(catalog.map(c => [c.id, c]))
            const enriched = items.map(it => ({
              ...it,
              marca: it.catalog_product_id ? (catMap.get(it.catalog_product_id) as any)?.marca || '' : '',
              modelo: it.catalog_product_id ? (catMap.get(it.catalog_product_id) as any)?.modelo || '' : '',
            }))
            generatePOPdf(po as any, enriched)
          }}><Download size={14} /> PDF</Btn>
          <Btn size="sm" variant="ghost" onClick={() => {
            const catMap = new Map(catalog.map(c => [c.id, c]))
            const enriched = items.map(it => ({
              ...it,
              marca: it.catalog_product_id ? (catMap.get(it.catalog_product_id) as any)?.marca || '' : '',
              modelo: it.catalog_product_id ? (catMap.get(it.catalog_product_id) as any)?.modelo || '' : '',
            }))
            generatePOPdf(po as any, enriched, { sinCostos: true })
          }}><FileText size={14} /> PDF sin costos</Btn>
          {/* Botón Dispatcher de agentes — solo si supplier tiene playbook activo */}
          {(() => {
            const pb = getPlaybookForSupplier(po.supplier_id)
            if (!pb) return null
            return (
              <Btn size="sm" variant="primary" onClick={() => setShowAgentModal(true)}
                style={{ background: 'rgba(168,85,247,0.15)', borderColor: '#A855F7', color: '#C084FC' }}>
                ⚡ Cotizar con agente
              </Btn>
            )
          })()}
          {statusActions.map(a => (
            <div key={a.target} title={a.tooltip} style={{ display: 'inline-flex' }}>
              <Btn variant={a.variant} size="sm" disabled={a.disabled} onClick={() => changeStatus(a.target)}>{a.label}</Btn>
            </div>
          ))}
        </div>
      </div>

      {/* PO info row 1: Proveedor / Lead / Cotización / Info proveedor */}
      {(() => {
        // Lead source of truth: po.lead_id (columna directa). Fallback: derivarlo
        // desde la cotización vinculada para POs viejas que no tenían lead_id guardado.
        const linkedQuote = quotations.find(q => q.id === po.quotation_id)
        const currentLeadId = (po as any).lead_id || linkedQuote?.lead_id || ''
        // Cotizaciones del lead actual — usa cache directo de Supabase (source of truth)
        const cachedQuotes = currentLeadId ? quotesByLead[currentLeadId] : undefined
        const quotesForLead = currentLeadId
          ? (cachedQuotes ?? quotations.filter(q => q.lead_id === currentLeadId))
          : []
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <SearchableSelect label="Proveedor" value={po.supplier_id || ''}
                onChange={v => {
                  setPO(p => {
                    if (!p) return p
                    const next: PurchaseOrder = { ...p, supplier_id: v }
                    if ((!p.logistics_mode || p.logistics_mode === 'pending') && v) {
                      const sup = suppliers.find(s => s.id === v)
                      if (sup?.default_logistics_mode) next.logistics_mode = sup.default_logistics_mode
                    }
                    return next
                  })
                  setDirty(true)
                }}
                options={suppliers.map(s => ({ value: s.id, label: s.name }))} placeholder="-- Sin proveedor --" />
              {/* Badge indicador de agente disponible */}
              {(() => {
                const pb = getPlaybookForSupplier(po.supplier_id)
                if (!pb) {
                  return po.supplier_id ? (
                    <div style={{ marginTop: 4, fontSize: 10, color: '#555' }}>
                      Sin agente — cotiza manual
                    </div>
                  ) : null
                }
                const methodLabel = pb.method === 'web_portal' ? 'Web portal' : pb.method === 'email_rfq' ? 'Email RFQ' : pb.method
                return (
                  <div style={{
                    marginTop: 4, fontSize: 10, fontWeight: 600,
                    color: '#C084FC', display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    ⚡ Agente disponible · {methodLabel}
                  </div>
                )
              })()}
            </div>
            <SearchableSelect label="Lead" value={currentLeadId}
              onChange={v => {
                // Persistir lead_id directamente en el PO (columna BD).
                // Si la cotización actual NO pertenece al nuevo lead, limpiar quotation_id.
                setPO(p => {
                  if (!p) return p
                  const next: any = { ...p, lead_id: v || null }
                  const currentQ = quotations.find(q => q.id === p.quotation_id)
                  if (currentQ && currentQ.lead_id !== v) {
                    next.quotation_id = null
                  }
                  return next
                })
                setDirty(true)
                // Cargar cotizaciones del lead nuevo desde Supabase (LIKE sobre notes)
                if (v) loadQuotesForLead(v)
              }}
              options={leads.map(l => ({ value: l.id, label: `${l.name}${l.company ? ' — ' + l.company : ''}` }))}
              placeholder="-- Sin lead --" />
            <div style={{ position: 'relative' }}>
              <SearchableSelect label="Cotización" value={po.quotation_id || ''}
                onChange={v => {
                  // Al elegir cotización, sincronizar lead_id desde notes de la cot (si no había lead_id antes)
                  setPO(p => {
                    if (!p) return p
                    const next: any = { ...p, quotation_id: v || null }
                    if (v) {
                      const allQ = [...quotations, ...Object.values(quotesByLead).flat()]
                      const q = allQ.find(qq => qq.id === v)
                      if (q?.lead_id && !next.lead_id) next.lead_id = q.lead_id
                    }
                    return next
                  })
                  setDirty(true)
                }}
                options={quotesForLead.map(q => ({
                  value: q.id,
                  label: `${q.name}${q.specialty ? ' (' + q.specialty + ')' : ''}${q.total ? ' — ' + F(q.total) + ' ' + (q.currency || '') : ''}`,
                }))}
                placeholder={currentLeadId ? (quotesForLead.length === 0 ? 'Sin cotizaciones del lead' : '-- Sin cotización --') : '-- Selecciona lead primero --'} />
              {currentLeadId && (
                <button
                  onClick={async () => { await loadQuotesForLead(currentLeadId) }}
                  title="Recargar cotizaciones del lead desde Supabase"
                  style={{ position: 'absolute', top: 0, right: 0, background: 'none', border: 'none', color: '#57FF9A', cursor: 'pointer', fontSize: 10, padding: 0 }}
                >↻ Recargar</button>
              )}
            </div>
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
        )
      })()}

      {/* PO info row 2: Entrega esperada + Folio del proveedor */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12, marginBottom: 12 }}>
        <Field label="Entrega esperada" value={po.expected_delivery || ''} type="date"
          onChange={v => { setPO(p => p ? { ...p, expected_delivery: v } : p); setDirty(true) }} />
        <Field label="Folio / cotización del proveedor" value={po.supplier_doc_number || ''}
          onChange={v => { setPO(p => p ? { ...p, supplier_doc_number: v } : p); setDirty(true) }}
          placeholder="ej. OV-12345 / Cot-2024-789" />
        <div></div>
      </div>

      {/* Logística row (Entregas v2) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: LOGISTICS_CFG[(po.logistics_mode || 'pending') as LogisticsMode].needsObra ? '1fr 1fr 2fr' : '1fr 3fr',
        gap: 12, marginBottom: 20, padding: '12px 14px',
        background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 10,
      }}>
        <SelectField label="Modo logístico"
          value={po.logistics_mode || 'pending'}
          onChange={v => {
            const nextMode = v as LogisticsMode
            setPO(p => {
              if (!p) return p
              const next: PurchaseOrder = { ...p, logistics_mode: nextMode }
              // Si el modo nuevo no requiere obra destino, limpiarla
              if (!LOGISTICS_CFG[nextMode].needsObra) next.logistics_target_obra_id = null
              return next
            })
            setDirty(true)
          }}
          options={(Object.keys(LOGISTICS_CFG) as LogisticsMode[]).map(k => ({
            value: k, label: LOGISTICS_CFG[k].label,
          }))}
        />
        {LOGISTICS_CFG[(po.logistics_mode || 'pending') as LogisticsMode].needsObra && (
          <SelectField label="Obra destino"
            value={po.logistics_target_obra_id || ''}
            onChange={v => { setPO(p => p ? { ...p, logistics_target_obra_id: v || null } : p); setDirty(true) }}
            options={obras.map(o => ({ value: o.id, label: o.nombre }))}
            placeholder="-- Seleccionar obra --"
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Qué significa</div>
          <div style={{ fontSize: 11, color: '#999', lineHeight: 1.4 }}>
            {LOGISTICS_CFG[(po.logistics_mode || 'pending') as LogisticsMode].description}
            {(po.logistics_mode || 'pending') === 'pending' && po.supplier_id && (() => {
              const sup = suppliers.find(s => s.id === po.supplier_id)
              if (sup?.default_logistics_mode) {
                return <div style={{ color: '#666', fontSize: 10, marginTop: 2 }}>Default del proveedor: {LOGISTICS_CFG[sup.default_logistics_mode].short}</div>
              }
              return null
            })()}
          </div>
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

        <div style={{ overflowX: 'auto', width: '100%', WebkitOverflowScrolling: 'touch' as const }}>
        <Table>
          <thead><tr>
            <Th>#</Th><Th>Artículo original</Th><Th>Modelo</Th><Th>Sistema</Th><Th>Unidad</Th><Th right>Cant</Th><Th right>P.U. catálogo</Th><Th right>Total catálogo</Th>
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
                <Td>
                  {canEdit ? (
                    <input value={it.modelo || ''} onChange={e => updateItem(it.id, 'modelo', e.target.value)}
                      placeholder="—"
                      style={{ background: 'transparent', border: 'none', color: it.modelo ? '#ccc' : '#444', fontSize: 11, fontFamily: 'monospace', width: 90, outline: 'none' }} />
                  ) : <span style={{ color: it.modelo ? '#ccc' : '#444', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap' as const }}>{it.modelo || '—'}</span>}
                  {it.marca && <div style={{ fontSize: 9, color: '#555', marginTop: 1, whiteSpace: 'nowrap' as const }}>{it.marca}</div>}
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
          {/* Panel principal: muestra los montos COTEJADOS cuando aplique (real_total),
              sino los catálogo. po.total ya se guarda con este valor al guardar. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#888' }}>{subtotalLabel}</span>
            <span style={{ fontSize: 12, color: '#ccc' }}>{F(subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#888' }}>IVA (16%)</span>
            <span style={{ fontSize: 12, color: '#ccc' }}>{F(iva)}</span>
          </div>
          <div style={{ borderTop: '1px solid #333', paddingTop: 8, display: 'flex', justifyContent: 'space-between', marginBottom: subtotal !== subtotalCatalogo ? 10 : 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{totalLabel}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: allCotejado ? '#57FF9A' : partialCotejado ? '#F59E0B' : '#ccc' }}>{F(total)}</span>
          </div>
          {/* Referencia: si el cotejado difiere del catálogo, mostrar la diferencia */}
          {subtotal !== subtotalCatalogo && (
            <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: '#666' }}>vs Catálogo</span>
                <span style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>{F(subtotalCatalogo * 1.16)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#666' }}>Diferencia</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: total - (subtotalCatalogo * 1.16) > 0 ? '#EF4444' : '#57FF9A', fontFamily: 'monospace' }}>
                  {total - (subtotalCatalogo * 1.16) > 0 ? '+' : ''}{F(total - (subtotalCatalogo * 1.16))}
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

      {/* Modal del agente de cotización (dispatcher por proveedor) */}
      {showAgentModal && (() => {
        const pb = getPlaybookForSupplier(po.supplier_id)
        if (!pb) return null
        const supplier = (po.supplier as any) || suppliers.find(s => s.id === po.supplier_id)
        const config = pb.config || {}
        const itemsToCotizar = items
          .map(it => {
            const cat = catalog.find(c => c.id === it.catalog_product_id)
            return { name: it.name || cat?.name || '', modelo: cat?.modelo || '', marca: cat?.marca || '', qty: it.quantity }
          })
          .filter(it => it.modelo)

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: '#141414', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 16, padding: 24, width: 720, maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                    ⚡ Agente de cotización · {supplier?.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                    Playbook: <span style={{ color: '#C084FC' }}>{pb.name}</span> · Método: <span style={{ color: '#C084FC' }}>{pb.method}</span>
                  </div>
                </div>
                <button onClick={() => setShowAgentModal(false)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={18} /></button>
              </div>

              {/* Estado del playbook */}
              <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 11, color: '#aaa' }}>
                {config.mapping_status === 'POC EXITOSO end-to-end. Listo para construir UI integration.' ? (
                  <span style={{ color: '#57FF9A' }}>✓ POC validado · {config.poc_validated || ''}</span>
                ) : (
                  <span style={{ color: '#F59E0B' }}>⚠ Playbook en construcción</span>
                )}
              </div>

              {/* Items que se van a cotizar */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Items para cotizar ({itemsToCotizar.length})
                </div>
                <div style={{ background: '#0a0a0a', border: '1px solid #222', borderRadius: 8, maxHeight: 180, overflowY: 'auto' }}>
                  {itemsToCotizar.length === 0 ? (
                    <div style={{ padding: 12, color: '#555', fontSize: 11, textAlign: 'center' }}>
                      Los items de esta OC no tienen modelo definido. Agrega modelos del catálogo para que el agente pueda cotizarlos.
                    </div>
                  ) : (
                    itemsToCotizar.map((it, i) => (
                      <div key={i} style={{ padding: '8px 12px', borderBottom: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: '#ddd' }}>
                          <span style={{ color: '#C084FC', fontWeight: 600, fontFamily: 'monospace' }}>{it.modelo}</span>
                          {it.marca && <span style={{ color: '#666', marginLeft: 6 }}>· {it.marca}</span>}
                        </span>
                        <span style={{ color: '#888' }}>qty {it.qty}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Instrucciones por método */}
              {pb.method === 'web_portal' && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    Cómo cotizar (web portal)
                  </div>
                  <ol style={{ paddingLeft: 20, fontSize: 11, color: '#ccc', lineHeight: 1.7 }}>
                    <li>Abre <a href={config.portal_url} target="_blank" rel="noreferrer" style={{ color: '#C084FC' }}>{config.portal_url}</a> y loguéate si no estás dentro</li>
                    <li>Click "Add Project" — crea proyecto con nombre <code style={{ background: '#1a1a1a', padding: '1px 5px', borderRadius: 3, color: '#C084FC' }}>OMM {po.po_number}</code></li>
                    <li>Para cada modelo de arriba: click "Add Product by Model Number" → mete modelo y qty → save</li>
                    <li>Lutron muestra el List Price en tiempo real. Anótalos.</li>
                    <li>Cuando termines, regresa al ERP y captura los precios reales en el cotejo de OC</li>
                  </ol>
                  <Btn size="sm" variant="primary"
                    onClick={() => window.open(config.portal_url, '_blank')}
                    style={{ background: 'rgba(168,85,247,0.2)', borderColor: '#A855F7', color: '#C084FC', marginTop: 8 }}>
                    Abrir {supplier?.name} en nueva pestaña
                  </Btn>
                </div>
              )}

              {pb.method === 'email_rfq' && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    Cómo cotizar (email RFQ)
                  </div>
                  <div style={{ fontSize: 11, color: '#aaa' }}>
                    Email template configurado en el playbook. Próximamente: botón "Generar email" que abre Gmail con el draft pre-llenado.
                  </div>
                </div>
              )}

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, borderTop: '1px solid #2a2a2a' }}>
                <Btn variant="ghost" onClick={() => setShowAgentModal(false)}>Cerrar</Btn>
              </div>
            </div>
          </div>
        )
      })()}

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
    {po && <PaymentsSection poId={po.id} poTotal={po.total} poCurrency={po.currency} poStatus={po.status} onStatusChange={(newStatus) => setPO({ ...po, status: newStatus })} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PAYMENTS SECTION (inside POEditor)
// ═══════════════════════════════════════════════════════════════════════════════

function PaymentsSection({ poId, poTotal, poCurrency, poStatus, onStatusChange }: { poId: string; poTotal: number; poCurrency: 'MXN' | 'USD'; poStatus: POStatus; onStatusChange: (newStatus: POStatus) => void }) {
  const [payments, setPayments] = useState<POPayment[]>([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('purchase_order_payments').select('*').eq('purchase_order_id', poId).order('payment_date', { ascending: false })
    setPayments((data as POPayment[]) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [poId])

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este pago?')) return
    await supabase.from('purchase_order_payments').delete().eq('id', id)
    load()
  }

  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const pct = poTotal > 0 ? Math.min(100, (totalPaid / poTotal) * 100) : 0
  const fmtMoney = (n: number) => poCurrency === 'USD' ? FUSD(n) : F(n)

  return (
    <div style={{ marginTop: 20, background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Pagos ({payments.length})</div>
        <Btn variant="primary" onClick={() => setShowModal(true)}><Plus size={12} /> Registrar pago</Btn>
      </div>

      {/* Progreso */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 4 }}>
          <span>Pagado: {fmtMoney(totalPaid)} de {fmtMoney(poTotal)}</span>
          <span style={{ color: pct >= 100 ? '#57FF9A' : pct > 0 ? '#F59E0B' : '#555' }}>{pct.toFixed(0)}%</span>
        </div>
        <div style={{ height: 6, background: '#1a1a1a', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: pct + '%', background: pct >= 100 ? '#57FF9A' : '#F59E0B', transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* Lista de pagos */}
      {loading ? <div style={{ fontSize: 11, color: '#555', padding: 10 }}>Cargando...</div> :
        payments.length === 0 ? <div style={{ fontSize: 11, color: '#555', padding: 10, textAlign: 'center' as const }}>Sin pagos registrados</div> :
        <div>
          {payments.map(p => (
            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px 110px 24px', gap: 8, padding: '8px 0', borderBottom: '1px solid #1a1a1a', fontSize: 11, alignItems: 'center' }}>
              <span style={{ color: '#888' }}>{formatDate(p.payment_date)}</span>
              <span style={{ color: '#aaa' }}>{p.method}{p.reference ? ' · ' + p.reference : ''}</span>
              <span style={{ color: '#57FF9A', fontWeight: 600 }}>{fmtMoney(p.amount)}</span>
              <span>{p.receipt_url ? <a href={p.receipt_url} target="_blank" rel="noopener noreferrer" style={{ color: '#A78BFA', fontSize: 10 }}>Ver comprobante</a> : <span style={{ color: '#444', fontSize: 10 }}>Sin comprobante</span>}</span>
              <button onClick={() => handleDelete(p.id)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 2 }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      }

      {showModal && <RegistrarPagoModal poId={poId} poCurrency={poCurrency} poTotal={poTotal} totalPaid={totalPaid} poStatus={poStatus} onClose={() => setShowModal(false)} onCreated={(newStatus) => { setShowModal(false); load(); if (newStatus) onStatusChange(newStatus) }} />}
    </div>
  )
}

function RegistrarPagoModal({ poId, poCurrency, poTotal, totalPaid, poStatus, onClose, onCreated }: { poId: string; poCurrency: 'MXN' | 'USD'; poTotal: number; totalPaid: number; poStatus: POStatus; onClose: () => void; onCreated: (newStatus: POStatus | null) => void }) {
  const [amount, setAmount] = useState<string>(String(Math.max(0, poTotal - totalPaid)))
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState('transferencia')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function crear() {
    const numAmount = Number(amount)
    if (!numAmount || numAmount <= 0) { setError('Monto inválido'); return }
    setSaving(true)
    setError('')

    let receipt_url: string | null = null
    let receipt_filename: string | null = null

    if (file) {
      const filename = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = poId + '/' + filename
      const { error: upErr } = await supabase.storage.from('payment-receipts').upload(path, file)
      if (upErr) {
        setError('Error al subir comprobante: ' + upErr.message)
        setSaving(false)
        return
      }
      const { data: urlData } = supabase.storage.from('payment-receipts').getPublicUrl(path)
      receipt_url = urlData.publicUrl
      receipt_filename = file.name
    }

    const { error: insErr } = await supabase.from('purchase_order_payments').insert({
      purchase_order_id: poId,
      amount: numAmount,
      currency: poCurrency,
      payment_date: paymentDate,
      method,
      reference: reference || null,
      receipt_url,
      receipt_filename,
      notes: notes || null,
    })

    if (insErr) {
      setError('Error al guardar pago: ' + insErr.message)
      setSaving(false)
      return
    }

    // Si la OC estaba en borrador o aprobada, pasarla a 'pedida' al primer pago (Opción B)
    let newStatus: POStatus | null = null
    if (poStatus === 'borrador' || poStatus === 'aprobada') {
      const { error: updErr } = await supabase.from('purchase_orders').update({ status: 'pedida' }).eq('id', poId)
      if (!updErr) newStatus = 'pedida'
    }

    setSaving(false)
    onCreated(newStatus)
  }

  const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }
  const modalStyle: React.CSSProperties = { background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24, width: 520, maxHeight: '90vh', overflowY: 'auto' }
  const inpStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const lblStyle: React.CSSProperties = { fontSize: 11, color: '#666', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4, display: 'block' }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Registrar pago</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {error && <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: 10, color: '#f87171', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lblStyle}>Monto ({poCurrency})</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={inpStyle} />
            </div>
            <div>
              <label style={lblStyle}>Fecha</label>
              <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} style={inpStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lblStyle}>Método</label>
              <select value={method} onChange={e => setMethod(e.target.value)} style={inpStyle}>
                <option value="transferencia">Transferencia</option>
                <option value="cheque">Cheque</option>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div>
              <label style={lblStyle}>Referencia</label>
              <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Folio SPEI, num cheque..." style={inpStyle} />
            </div>
          </div>

          <div>
            <label style={lblStyle}>Comprobante (opcional)</label>
            <input type="file" accept="application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] || null)} style={{ ...inpStyle, padding: 6 }} />
            {file && <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>{file.name}</div>}
          </div>

          <div>
            <label style={lblStyle}>Notas</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inpStyle, minHeight: 40, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={crear} disabled={saving}>{saving ? 'Guardando...' : 'Guardar pago'}</Btn>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUPPLIER LIST
// ═══════════════════════════════════════════════════════════════════════════════
function SupplierList({ onOpen }: { onOpen: (id: string) => void }) {
  const isMobile = useIsMobile()
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

      <div style={{ marginBottom: 16, position: 'relative', maxWidth: isMobile ? '100%' : 300 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#555' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar proveedor..."
          style={{
            width: '100%', padding: '7px 10px 7px 30px', background: '#1e1e1e', border: '1px solid #333',
            borderRadius: 8, color: '#fff', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box',
          }} />
      </div>

      {loading ? <Loading /> : (
        <div style={{ overflowX: 'auto' }}>
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
        </div>
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
interface BankAccount {
  id: string
  supplier_id: string
  etiqueta: string
  moneda: string
  clabe: string
  cuenta_bancaria: string
  banco: string
  bnet_codigo: string
  is_default: boolean
}

function SupplierDetail({ supplierId, onBack }: { supplierId: string; onBack: () => void }) {
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [bankDirty, setBankDirty] = useState(false)
  const [savingBank, setSavingBank] = useState(false)

  const loadBankAccounts = async () => {
    const { data } = await supabase.from('supplier_bank_accounts').select('*').eq('supplier_id', supplierId).order('created_at')
    setBankAccounts((data || []).map((a: any) => ({
      id: a.id, supplier_id: a.supplier_id, etiqueta: a.etiqueta || 'Principal',
      moneda: a.moneda || 'MXN', clabe: a.clabe || '', cuenta_bancaria: a.cuenta_bancaria || '',
      banco: a.banco || '', bnet_codigo: a.bnet_codigo || '', is_default: a.is_default || false,
    })))
  }

  useEffect(() => {
    Promise.all([
      supabase.from('suppliers').select('*').eq('id', supplierId).single(),
      supabase.from('purchase_orders').select('*,project:projects(name)').eq('supplier_id', supplierId).order('created_at', { ascending: false }),
    ]).then(([sRes, oRes]) => {
      setSupplier(sRes.data)
      setOrders(oRes.data || [])
      setLoading(false)
    })
    loadBankAccounts()
  }, [supplierId])

  if (loading || !supplier) return <div style={{ padding: '24px 28px' }}><Loading /></div>

  const totalCompras = orders.reduce((s, o) => s + o.total, 0)

  async function guardar() {
    if (!supplier) return
    setSaving(true)
    // NOTA: la tabla suppliers en DB usa nombres en español (contacto, telefono,
    // email, direccion, notas, sistemas) y NO tiene payment_terms. La UI de este
    // editor lee/escribe nombres en inglés, por lo que hay un bug pre-existente
    // donde varios campos no persisten. Aquí salvo SOLO las columnas que sí
    // existen en DB para evitar que la llamada entera falle.
    await supabase.from('suppliers').update({
      name: supplier.name,
      rfc: supplier.rfc || null,
      is_active: supplier.is_active,
      default_logistics_mode: supplier.default_logistics_mode || null,
    }).eq('id', supplier.id)
    setSaving(false); setDirty(false)
  }

  const addBankAccount = () => {
    setBankAccounts(prev => [...prev, {
      id: 'new_' + Date.now(), supplier_id: supplierId, etiqueta: prev.length === 0 ? 'Principal' : 'Cuenta ' + (prev.length + 1),
      moneda: 'MXN', clabe: '', cuenta_bancaria: '', banco: '', bnet_codigo: '', is_default: prev.length === 0,
    }])
    setBankDirty(true)
  }

  const updBank = (idx: number, field: string, value: any) => {
    setBankAccounts(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a))
    setBankDirty(true)
  }

  const removeBank = async (idx: number) => {
    const acct = bankAccounts[idx]
    if (!acct.id.startsWith('new_')) {
      await supabase.from('supplier_bank_accounts').delete().eq('id', acct.id)
    }
    setBankAccounts(prev => prev.filter((_, i) => i !== idx))
    setBankDirty(true)
  }

  const guardarBancos = async () => {
    setSavingBank(true)
    for (const acct of bankAccounts) {
      const payload = {
        supplier_id: supplierId, etiqueta: acct.etiqueta, moneda: acct.moneda,
        clabe: acct.clabe || null, cuenta_bancaria: acct.cuenta_bancaria || null,
        banco: acct.banco || null, bnet_codigo: acct.bnet_codigo || null, is_default: acct.is_default,
      }
      if (acct.id.startsWith('new_')) {
        await supabase.from('supplier_bank_accounts').insert(payload)
      } else {
        await supabase.from('supplier_bank_accounts').update(payload).eq('id', acct.id)
      }
    }
    await loadBankAccounts()
    setSavingBank(false)
    setBankDirty(false)
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
          <div style={{ marginTop: 8, padding: '10px 12px', background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Cuentas bancarias</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {bankDirty && (
                  <Btn size="sm" variant="primary" onClick={guardarBancos} style={{ fontSize: 10, padding: '2px 8px' }}>
                    {savingBank ? 'Guardando...' : 'Guardar cuentas'}
                  </Btn>
                )}
                <button onClick={addBankAccount} style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#57FF9A', cursor: 'pointer', padding: '2px 8px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={10} /> Agregar cuenta
                </button>
              </div>
            </div>
            {bankAccounts.length === 0 && (
              <div style={{ fontSize: 12, color: '#555', textAlign: 'center', padding: '12px 0' }}>Sin cuentas bancarias registradas</div>
            )}
            {bankAccounts.map((acct, idx) => (
              <div key={acct.id} style={{ padding: '10px 10px', background: '#111', border: '1px solid #222', borderRadius: 8, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                    <input value={acct.etiqueta} onChange={e => updBank(idx, 'etiqueta', e.target.value)}
                      style={{ background: 'transparent', border: 'none', color: '#fff', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', width: 120, outline: 'none' }}
                      placeholder="Etiqueta" />
                    <select value={acct.moneda} onChange={e => updBank(idx, 'moneda', e.target.value)}
                      style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, color: acct.moneda === 'USD' ? '#60A5FA' : '#57FF9A', fontSize: 11, fontWeight: 600, padding: '2px 6px', cursor: 'pointer', fontFamily: 'inherit' }}>
                      <option value="MXN">MXN</option>
                      <option value="USD">USD</option>
                    </select>
                    {acct.is_default && <span style={{ fontSize: 9, color: '#F59E0B', fontWeight: 600, textTransform: 'uppercase' }}>Default</span>}
                    {!acct.is_default && (
                      <button onClick={() => { setBankAccounts(prev => prev.map((a, i) => ({ ...a, is_default: i === idx }))); setBankDirty(true) }}
                        style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 9, fontFamily: 'inherit' }}>Hacer default</button>
                    )}
                  </div>
                  <button onClick={() => removeBank(idx)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: 2 }}><Trash2 size={12} /></button>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <Field label="CLABE" value={acct.clabe} onChange={v => updBank(idx, 'clabe', v)} />
                  <Field label="Cuenta bancaria" value={acct.cuenta_bancaria} onChange={v => updBank(idx, 'cuenta_bancaria', v)} />
                  <Field label="Banco" value={acct.banco} onChange={v => updBank(idx, 'banco', v)} />
                  <Field label="Código BNET (BBVA)" value={acct.bnet_codigo} onChange={v => updBank(idx, 'bnet_codigo', v)} />
                </div>
              </div>
            ))}
          </div>
          <SelectField label="Condiciones de pago" value={supplier.payment_terms}
            onChange={v => upd('payment_terms', v)}
            options={Object.entries(PAYMENT_TERMS_CFG).map(([k, v]) => ({ value: k, label: v }))} />
          <SelectField label="Default logístico (se precarga en POs nuevas)"
            value={supplier.default_logistics_mode || ''}
            onChange={v => upd('default_logistics_mode', v || null)}
            options={(Object.keys(LOGISTICS_CFG) as LogisticsMode[])
              .filter(k => k !== 'pending')
              .map(k => ({ value: k, label: LOGISTICS_CFG[k].label }))}
            placeholder="-- Sin default (PO queda en Pendiente) --" />
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
