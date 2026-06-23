import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { SectionHeader, KpiCard, Table, Th, Td, Badge, Btn, EmptyState, Loading } from '../components/layout/UI'
import { F, formatDate } from '../lib/utils'
import { useIsMobile } from '../lib/useIsMobile'
import {
  Plus, X, Search, ArrowLeft, Building2, Phone, Mail, MapPin, Wrench,
  Ticket, Calendar, TrendingUp, Clock, CheckCircle, AlertTriangle,
  ChevronRight, FileText, Eye, DollarSign, Shield, Users, ArrowRight
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

interface Property {
  id: string
  name: string
  client_name: string
  client_phone: string
  client_email: string
  address: string
  city: string
  notes: string
  systems_installed: string[]
  original_quotation_id: string | null
  contract_type: 'poliza' | 'por_visita'
  is_active: boolean
  created_at: string
  updated_at: string
}

interface Contract {
  id: string
  property_id: string
  name: string
  contract_type: string
  start_date: string
  end_date: string
  monthly_fee: number | null
  annual_fee: number | null
  currency: string
  visits_included: number
  visits_used: number
  is_active: boolean
  notes: string
  created_at: string
  updated_at: string
  // joined
  property?: Property
}

type TicketCategory = 'falla' | 'mantenimiento_preventivo' | 'solicitud_nueva' | 'garantia' | 'otro'
type TicketPriority = 'baja' | 'media' | 'alta' | 'urgente'
type TicketStatus = 'abierto' | 'en_progreso' | 'esperando_cliente' | 'resuelto' | 'cerrado'

interface TicketRow {
  id: string
  property_id: string
  contract_id: string | null
  ticket_number: number
  subject: string
  description: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  systems_affected: string[]
  assigned_to: string
  source: string
  reported_at: string
  first_response_at: string | null
  resolved_at: string | null
  closed_at: string | null
  sla_response_hours: number | null
  sla_resolution_hours: number | null
  billable: boolean
  amount: number | null
  currency: string
  notes: string
  created_at: string
  updated_at: string
  // joined
  property?: Property
}

interface Visit {
  id: string
  ticket_id: string | null
  property_id: string
  contract_id: string | null
  visit_date: string
  scheduled_time: string | null
  technician: string
  technician_id: string | null
  route_order: number | null
  duration_hours: number | null
  work_performed: string
  parts_used: string
  cost: number | null
  billable: boolean
  amount_charged: number | null
  currency: string
  status: 'programada' | 'completada' | 'cancelada'
  en_route_at: string | null
  arrived_at: string | null
  completed_at: string | null
  photos: string[] | null
  report: any
  notes: string
  created_at: string
}

interface Technician {
  id: string
  nombre: string | null
  name: string | null
  area: string | null
  foto_url: string | null
}

function techName(t: Technician | undefined | null): string {
  if (!t) return 'Sin asignar'
  return t.nombre || t.name || 'Técnico'
}

interface MaintContact {
  id: string
  property_id: string
  name: string
  phone_e164: string | null
  email: string | null
  role: string
  is_primary: boolean
  notes: string | null
}

interface MaintEquipment {
  id: string
  property_id: string
  system: string | null
  marca: string | null
  modelo: string | null
  sku: string | null
  ubicacion: string | null
  cantidad: number | null
  serial: string | null
  fecha_instalacion: string | null
  garantia_fin: string | null
  image_url: string | null
  notes: string | null
  source_quotation_item_id: string | null
}

const CONTACT_ROLES = ['dueño', 'administrador', 'arquitecto', 'contacto_sitio', 'otro']

type UpsellStatus = 'identificada' | 'propuesta' | 'aceptada' | 'rechazada' | 'convertida'

interface Upsell {
  id: string
  property_id: string
  ticket_id: string | null
  title: string
  description: string
  estimated_value: number
  currency: string
  status: UpsellStatus
  assigned_to: string
  quotation_id: string | null
  notes: string
  created_at: string
  updated_at: string
  // joined
  property?: Property
}

// ── Config ─────────────────────────────────────────────────────────────────

const SYSTEMS_OPTIONS = [
  { id: 'audio', label: 'Audio', color: '#8B5CF6' },
  { id: 'redes', label: 'Redes', color: '#06B6D4' },
  { id: 'cctv', label: 'CCTV', color: '#2563EB' },
  { id: 'control_acceso', label: 'Control de Acceso', color: '#D97706' },
  { id: 'control_iluminacion', label: 'Control de Iluminación', color: '#A78BFA' },
  { id: 'lutron', label: 'Lutron', color: '#9333EA' },
  { id: 'electrico', label: 'Eléctrico', color: '#EAB308' },
]

const SYSTEM_COLOR: Record<string, string> = {}
SYSTEMS_OPTIONS.forEach(s => { SYSTEM_COLOR[s.id] = s.color; SYSTEM_COLOR[s.label] = s.color })

const CONTRACT_TYPE_CFG: Record<string, { label: string; color: string }> = {
  poliza: { label: 'Póliza', color: '#7C3AED' },
  por_visita: { label: 'Por Visita', color: '#2563EB' },
}

const PRIORITY_CFG: Record<TicketPriority, { label: string; color: string }> = {
  urgente: { label: 'Urgente', color: '#DC2626' },
  alta: { label: 'Alta', color: '#F97316' },
  media: { label: 'Media', color: '#D97706' },
  baja: { label: 'Baja', color: '#6B7280' },
}

const STATUS_CFG: Record<TicketStatus, { label: string; color: string }> = {
  abierto: { label: 'Abierto', color: '#2563EB' },
  en_progreso: { label: 'En Progreso', color: '#D97706' },
  esperando_cliente: { label: 'Esperando Cliente', color: '#7C3AED' },
  resuelto: { label: 'Resuelto', color: '#10B981' },
  cerrado: { label: 'Cerrado', color: '#6B7280' },
}

const CATEGORY_CFG: Record<TicketCategory, { label: string; color: string }> = {
  falla: { label: 'Falla', color: '#DC2626' },
  mantenimiento_preventivo: { label: 'Preventivo', color: '#2563EB' },
  solicitud_nueva: { label: 'Solicitud Nueva', color: '#10B981' },
  garantia: { label: 'Garantía', color: '#D97706' },
  otro: { label: 'Otro', color: '#6B7280' },
}

const UPSELL_STATUS_CFG: Record<UpsellStatus, { label: string; color: string }> = {
  identificada: { label: 'Identificada', color: '#6B7280' },
  propuesta: { label: 'Propuesta', color: '#2563EB' },
  aceptada: { label: 'Aceptada', color: '#10B981' },
  rechazada: { label: 'Rechazada', color: '#DC2626' },
  convertida: { label: 'Convertida', color: '#10B981' },
}

const VISIT_STATUS_CFG: Record<string, { label: string; color: string }> = {
  programada: { label: 'Programada', color: '#2563EB' },
  completada: { label: 'Completada', color: '#10B981' },
  cancelada: { label: 'Cancelada', color: '#6B7280' },
}

type Tab = 'propiedades' | 'agenda' | 'tickets' | 'polizas' | 'oportunidades'

// ── Shared UI ──────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  background: '#1e1e1e', border: '1px solid #333', borderRadius: 8,
  color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle, appearance: 'auto' as const,
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: '#555', textTransform: 'uppercase',
  letterSpacing: '0.06em', display: 'block',
}

const modalOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

function ModalShell({ title, onClose, children, width = 520 }: {
  title: string; onClose: () => void; children: React.ReactNode; width?: number
}) {
  return (
    <div style={modalOverlay} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#111', border: '1px solid #222', borderRadius: 14,
        width, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder = '', type = 'text', disabled = false }: {
  label: string; value: string; onChange?: (v: string) => void
  placeholder?: string; type?: string; disabled?: boolean
}) {
  return (
    <label style={labelStyle}>
      {label}
      <input type={type} value={value} onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        style={{ ...inputStyle, marginTop: 4, background: disabled ? '#111' : '#1e1e1e', color: disabled ? '#555' : '#fff' }} />
    </label>
  )
}

function TextArea({ label, value, onChange, placeholder = '', rows = 3 }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number
}) {
  return (
    <label style={labelStyle}>
      {label}
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        style={{ ...inputStyle, marginTop: 4, resize: 'vertical', minHeight: 60 }} />
    </label>
  )
}

function SystemsBadges({ systems }: { systems: string[] }) {
  if (!systems || systems.length === 0) return <span style={{ color: '#444', fontSize: 11 }}>--</span>
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {systems.map(s => {
        const color = SYSTEM_COLOR[s] || '#6B7280'
        return <Badge key={s} label={s} color={color} />
      })}
    </div>
  )
}

function slaDisplay(reportedAt: string, slaHours: number | null): { text: string; color: string } {
  if (!slaHours) return { text: '--', color: '#555' }
  const reported = new Date(reportedAt).getTime()
  const deadline = reported + slaHours * 3600000
  const now = Date.now()
  const remaining = deadline - now
  if (remaining < 0) return { text: 'Vencido', color: '#DC2626' }
  const hrs = Math.floor(remaining / 3600000)
  const mins = Math.floor((remaining % 3600000) / 60000)
  if (hrs < 4) return { text: `${hrs}h ${mins}m`, color: '#D97706' }
  return { text: `${hrs}h`, color: '#10B981' }
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function Mantenimiento() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<Tab>('propiedades')
  const [loading, setLoading] = useState(true)

  // Data
  const [properties, setProperties] = useState<Property[]>([])
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [visits, setVisits] = useState<Visit[]>([])
  const [upsells, setUpsells] = useState<Upsell[]>([])
  const [technicians, setTechnicians] = useState<Technician[]>([])

  // Views
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [selectedUpsellId, setSelectedUpsellId] = useState<string | null>(null)

  // Modals
  const [showNewProperty, setShowNewProperty] = useState(false)
  const [showNewTicket, setShowNewTicket] = useState(false)
  const [showNewContract, setShowNewContract] = useState(false)
  const [showNewUpsell, setShowNewUpsell] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)

  // Filters
  const [searchProp, setSearchProp] = useState('')
  const [ticketStatusFilter, setTicketStatusFilter] = useState<TicketStatus | ''>('')
  const [ticketPriorityFilter, setTicketPriorityFilter] = useState<TicketPriority | ''>('')
  const [ticketPropertyFilter, setTicketPropertyFilter] = useState('')

  // ── Load data ──────────────────────────────────────────────────────────

  async function loadAll() {
    setLoading(true)
    const [pRes, tRes, cRes, vRes, uRes, eRes] = await Promise.all([
      supabase.from('maintenance_properties').select('*').order('name'),
      supabase.from('maintenance_tickets').select('*').order('created_at', { ascending: false }),
      supabase.from('maintenance_contracts').select('*').order('end_date', { ascending: false }),
      supabase.from('maintenance_visits').select('*').order('visit_date', { ascending: false }),
      supabase.from('maintenance_upsell').select('*').order('created_at', { ascending: false }),
      supabase.from('employees').select('id, nombre, name, area, foto_url, activo').eq('activo', true).order('nombre'),
    ])
    setProperties(pRes.data || [])
    setTickets(tRes.data || [])
    setContracts(cRes.data || [])
    setVisits(vRes.data || [])
    setUpsells(uRes.data || [])
    setTechnicians((eRes.data as Technician[]) || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  // ── Helpers ────────────────────────────────────────────────────────────

  const propMap = useMemo(() => {
    const m: Record<string, Property> = {}
    properties.forEach(p => { m[p.id] = p })
    return m
  }, [properties])

  const techMap = useMemo(() => {
    const m: Record<string, Technician> = {}
    technicians.forEach(t => { m[t.id] = t })
    return m
  }, [technicians])

  const ticketsForProperty = (pid: string) => tickets.filter(t => t.property_id === pid)
  const visitsForProperty = (pid: string) => visits.filter(v => v.property_id === pid)
  const contractsForProperty = (pid: string) => contracts.filter(c => c.property_id === pid)
  const upsellsForProperty = (pid: string) => upsells.filter(u => u.property_id === pid)
  const openTicketsForProperty = (pid: string) => ticketsForProperty(pid).filter(t => t.status === 'abierto' || t.status === 'en_progreso' || t.status === 'esperando_cliente')
  const lastVisitForProperty = (pid: string) => {
    const pv = visitsForProperty(pid).filter(v => v.status === 'completada')
    return pv.length > 0 ? pv[0] : null
  }

  // ── Tabs ───────────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string }[] = [
    { key: 'propiedades', label: 'Propiedades' },
    { key: 'agenda', label: 'Agenda' },
    { key: 'tickets', label: 'Tickets' },
    { key: 'polizas', label: 'Pólizas' },
    { key: 'oportunidades', label: 'Oportunidades' },
  ]

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) return <div style={{ padding: 32 }}><Loading /></div>

  // Detail views take over
  if (selectedPropertyId) {
    return <PropertyDetail
      property={propMap[selectedPropertyId]}
      tickets={ticketsForProperty(selectedPropertyId)}
      visits={visitsForProperty(selectedPropertyId)}
      contracts={contractsForProperty(selectedPropertyId)}
      upsells={upsellsForProperty(selectedPropertyId)}
      propMap={propMap}
      onBack={() => setSelectedPropertyId(null)}
      onOpenTicket={id => { setSelectedPropertyId(null); setSelectedTicketId(id); setTab('tickets') }}
      onReload={loadAll}
      isMobile={isMobile}
    />
  }

  if (selectedTicketId) {
    const ticket = tickets.find(t => t.id === selectedTicketId)
    if (ticket) return <TicketDetail
      ticket={ticket}
      property={propMap[ticket.property_id]}
      visits={visits.filter(v => v.ticket_id === ticket.id)}
      onBack={() => setSelectedTicketId(null)}
      onReload={loadAll}
      isMobile={isMobile}
    />
  }

  if (selectedUpsellId) {
    const upsell = upsells.find(u => u.id === selectedUpsellId)
    if (upsell) return <UpsellDetail
      upsell={upsell}
      property={propMap[upsell.property_id]}
      onBack={() => setSelectedUpsellId(null)}
      onReload={loadAll}
      isMobile={isMobile}
    />
  }

  return (
    <div style={{ padding: isMobile ? 16 : 32, maxWidth: 1400, margin: '0 auto' }}>
      <SectionHeader title="Mantenimiento" subtitle="Gestión de propiedades, tickets y pólizas de servicio" />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #222', marginBottom: 24 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: tab === t.key ? 600 : 400, fontFamily: 'inherit',
            color: tab === t.key ? '#10B981' : '#666',
            borderBottom: tab === t.key ? '2px solid #10B981' : '2px solid transparent',
            transition: 'all 0.15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'propiedades' && (
        <TabPropiedades
          properties={properties} tickets={tickets} visits={visits}
          searchProp={searchProp} setSearchProp={setSearchProp}
          onSelect={id => setSelectedPropertyId(id)}
          onNew={() => setShowNewProperty(true)}
          isMobile={isMobile}
          openTicketsForProperty={openTicketsForProperty}
          lastVisitForProperty={lastVisitForProperty}
        />
      )}

      {tab === 'agenda' && (
        <TabAgenda
          visits={visits} propMap={propMap} techMap={techMap}
          onOpenProperty={id => setSelectedPropertyId(id)}
          onSchedule={() => setShowSchedule(true)}
          isMobile={isMobile}
        />
      )}

      {tab === 'tickets' && (
        <TabTickets
          tickets={tickets} properties={properties} propMap={propMap}
          statusFilter={ticketStatusFilter} setStatusFilter={setTicketStatusFilter}
          priorityFilter={ticketPriorityFilter} setPriorityFilter={setTicketPriorityFilter}
          propertyFilter={ticketPropertyFilter} setPropertyFilter={setTicketPropertyFilter}
          onSelect={id => setSelectedTicketId(id)}
          onNew={() => setShowNewTicket(true)}
          isMobile={isMobile}
        />
      )}

      {tab === 'polizas' && (
        <TabPolizas
          contracts={contracts} propMap={propMap}
          onNew={() => setShowNewContract(true)}
          isMobile={isMobile}
        />
      )}

      {tab === 'oportunidades' && (
        <TabOportunidades
          upsells={upsells} propMap={propMap}
          onSelect={id => setSelectedUpsellId(id)}
          onNew={() => setShowNewUpsell(true)}
          isMobile={isMobile}
        />
      )}

      {/* Modals */}
      {showNewProperty && (
        <NewPropertyModal onClose={() => setShowNewProperty(false)} onCreated={() => { setShowNewProperty(false); loadAll() }} />
      )}
      {showNewTicket && (
        <NewTicketModal properties={properties} onClose={() => setShowNewTicket(false)} onCreated={() => { setShowNewTicket(false); loadAll() }} />
      )}
      {showNewContract && (
        <NewContractModal properties={properties} onClose={() => setShowNewContract(false)} onCreated={() => { setShowNewContract(false); loadAll() }} />
      )}
      {showNewUpsell && (
        <NewUpsellModal properties={properties} onClose={() => setShowNewUpsell(false)} onCreated={() => { setShowNewUpsell(false); loadAll() }} />
      )}
      {showSchedule && (
        <ProgramarVisitaModal
          properties={properties} tickets={tickets} contracts={contracts} technicians={technicians}
          onClose={() => setShowSchedule(false)}
          onCreated={() => { setShowSchedule(false); loadAll() }}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: PROPIEDADES
// ═══════════════════════════════════════════════════════════════════════════

function TabPropiedades({ properties, tickets, visits, searchProp, setSearchProp, onSelect, onNew, isMobile, openTicketsForProperty, lastVisitForProperty }: {
  properties: Property[]; tickets: TicketRow[]; visits: Visit[]
  searchProp: string; setSearchProp: (v: string) => void
  onSelect: (id: string) => void; onNew: () => void; isMobile: boolean
  openTicketsForProperty: (pid: string) => TicketRow[]
  lastVisitForProperty: (pid: string) => Visit | null
}) {
  const totalOpen = tickets.filter(t => t.status === 'abierto' || t.status === 'en_progreso' || t.status === 'esperando_cliente').length
  const conPoliza = properties.filter(p => p.contract_type === 'poliza').length
  const porVisita = properties.filter(p => p.contract_type === 'por_visita').length

  const filtered = useMemo(() => {
    if (!searchProp) return properties
    const s = searchProp.toLowerCase()
    return properties.filter(p =>
      p.name.toLowerCase().includes(s) ||
      p.client_name.toLowerCase().includes(s) ||
      (p.city || '').toLowerCase().includes(s) ||
      (p.address || '').toLowerCase().includes(s)
    )
  }, [properties, searchProp])

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Total Propiedades" value={properties.length} icon={<Building2 size={16} />} />
        <KpiCard label="Con Póliza" value={conPoliza} color="#7C3AED" icon={<Shield size={16} />} />
        <KpiCard label="Por Visita" value={porVisita} color="#2563EB" icon={<Wrench size={16} />} />
        <KpiCard label="Tickets Abiertos" value={totalOpen} color={totalOpen > 0 ? '#D97706' : '#10B981'} icon={<Ticket size={16} />} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#555' }} />
          <input value={searchProp} onChange={e => setSearchProp(e.target.value)}
            placeholder="Buscar propiedad, cliente, ciudad..."
            style={{ ...inputStyle, paddingLeft: 30 }} />
        </div>
        <Btn variant="primary" onClick={onNew}><Plus size={14} /> Nueva Propiedad</Btn>
      </div>

      {filtered.length === 0 ? <EmptyState message="No hay propiedades registradas" /> : (
        <Table>
          <thead>
            <tr>
              <Th>Propiedad</Th>
              <Th>Cliente</Th>
              {!isMobile && <Th>Teléfono</Th>}
              {!isMobile && <Th>Sistemas</Th>}
              <Th>Tipo</Th>
              <Th>Tickets</Th>
              {!isMobile && <Th>Última Visita</Th>}
              <Th />
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const openT = openTicketsForProperty(p.id)
              const lastV = lastVisitForProperty(p.id)
              const ct = CONTRACT_TYPE_CFG[p.contract_type] || CONTRACT_TYPE_CFG.por_visita
              return (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(p.id)}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <Td>
                    <div style={{ fontWeight: 500, color: '#fff', fontSize: 13 }}>{p.name}</div>
                    {p.city && <div style={{ fontSize: 11, color: '#555' }}>{p.city}</div>}
                  </Td>
                  <Td>{p.client_name}</Td>
                  {!isMobile && <Td muted>{p.client_phone || '--'}</Td>}
                  {!isMobile && <Td><SystemsBadges systems={p.systems_installed || []} /></Td>}
                  <Td><Badge label={ct.label} color={ct.color} /></Td>
                  <Td>
                    {openT.length > 0 ? (
                      <span style={{ color: '#D97706', fontWeight: 600, fontSize: 12 }}>{openT.length}</span>
                    ) : (
                      <span style={{ color: '#555', fontSize: 12 }}>0</span>
                    )}
                  </Td>
                  {!isMobile && <Td muted>{lastV ? formatDate(lastV.visit_date) : '--'}</Td>}
                  <Td>
                    <Btn size="sm" variant="ghost" onClick={e => { e?.stopPropagation(); onSelect(p.id) }}>
                      <Eye size={14} />
                    </Btn>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: TICKETS
// ═══════════════════════════════════════════════════════════════════════════

function TabTickets({ tickets, properties, propMap, statusFilter, setStatusFilter, priorityFilter, setPriorityFilter, propertyFilter, setPropertyFilter, onSelect, onNew, isMobile }: {
  tickets: TicketRow[]; properties: Property[]; propMap: Record<string, Property>
  statusFilter: TicketStatus | ''; setStatusFilter: (v: TicketStatus | '') => void
  priorityFilter: TicketPriority | ''; setPriorityFilter: (v: TicketPriority | '') => void
  propertyFilter: string; setPropertyFilter: (v: string) => void
  onSelect: (id: string) => void; onNew: () => void; isMobile: boolean
}) {
  const today = new Date().toISOString().slice(0, 10)
  const open = tickets.filter(t => t.status === 'abierto').length
  const inProgress = tickets.filter(t => t.status === 'en_progreso').length
  const resolvedToday = tickets.filter(t => t.status === 'resuelto' && t.resolved_at && t.resolved_at.slice(0, 10) === today).length
  const withSla = tickets.filter(t => t.sla_response_hours && t.status !== 'cerrado')
  const slaMet = withSla.filter(t => {
    if (!t.reported_at || !t.sla_response_hours) return true
    if (t.first_response_at) {
      const diff = (new Date(t.first_response_at).getTime() - new Date(t.reported_at).getTime()) / 3600000
      return diff <= t.sla_response_hours
    }
    const remaining = new Date(t.reported_at).getTime() + t.sla_response_hours * 3600000 - Date.now()
    return remaining > 0
  })
  const slaPct = withSla.length > 0 ? Math.round(slaMet.length / withSla.length * 100) : 100

  const filtered = useMemo(() => {
    let res = tickets
    if (statusFilter) res = res.filter(t => t.status === statusFilter)
    if (priorityFilter) res = res.filter(t => t.priority === priorityFilter)
    if (propertyFilter) res = res.filter(t => t.property_id === propertyFilter)
    return res
  }, [tickets, statusFilter, priorityFilter, propertyFilter])

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Abiertos" value={open} color="#2563EB" icon={<Ticket size={16} />} />
        <KpiCard label="En Progreso" value={inProgress} color="#D97706" icon={<Clock size={16} />} />
        <KpiCard label="Resueltos Hoy" value={resolvedToday} color="#10B981" icon={<CheckCircle size={16} />} />
        <KpiCard label="SLA Cumplido" value={`${slaPct}%`} color={slaPct >= 90 ? '#10B981' : slaPct >= 70 ? '#D97706' : '#DC2626'} icon={<AlertTriangle size={16} />} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as TicketStatus | '')}
          style={{ ...selectStyle, width: 'auto', minWidth: 130 }}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as TicketPriority | '')}
          style={{ ...selectStyle, width: 'auto', minWidth: 130 }}>
          <option value="">Todas las prioridades</option>
          {Object.entries(PRIORITY_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)}
          style={{ ...selectStyle, width: 'auto', minWidth: 160 }}>
          <option value="">Todas las propiedades</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={onNew}><Plus size={14} /> Nuevo Ticket</Btn>
      </div>

      {filtered.length === 0 ? <EmptyState message="No hay tickets con estos filtros" /> : (
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Propiedad</Th>
              <Th>Asunto</Th>
              {!isMobile && <Th>Categoría</Th>}
              <Th>Prioridad</Th>
              <Th>Estado</Th>
              {!isMobile && <Th>Asignado</Th>}
              {!isMobile && <Th>Reportado</Th>}
              {!isMobile && <Th>SLA</Th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => {
              const prop = propMap[t.property_id]
              const cat = CATEGORY_CFG[t.category] || CATEGORY_CFG.otro
              const pri = PRIORITY_CFG[t.priority] || PRIORITY_CFG.baja
              const st = STATUS_CFG[t.status] || STATUS_CFG.abierto
              const sla = slaDisplay(t.reported_at || t.created_at, t.sla_response_hours)
              return (
                <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(t.id)}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <Td><span style={{ color: '#888', fontWeight: 500 }}>#{t.ticket_number}</span></Td>
                  <Td>{prop?.name || '--'}</Td>
                  <Td>
                    <div style={{ fontWeight: 500, color: '#fff', fontSize: 12 }}>{t.subject}</div>
                  </Td>
                  {!isMobile && <Td><Badge label={cat.label} color={cat.color} /></Td>}
                  <Td><Badge label={pri.label} color={pri.color} /></Td>
                  <Td><Badge label={st.label} color={st.color} /></Td>
                  {!isMobile && <Td muted>{t.assigned_to || '--'}</Td>}
                  {!isMobile && <Td muted>{t.reported_at ? formatDate(t.reported_at) : formatDate(t.created_at)}</Td>}
                  {!isMobile && <Td><span style={{ color: sla.color, fontSize: 12, fontWeight: 500 }}>{sla.text}</span></Td>}
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: POLIZAS
// ═══════════════════════════════════════════════════════════════════════════

function TabPolizas({ contracts, propMap, onNew, isMobile }: {
  contracts: Contract[]; propMap: Record<string, Property>; onNew: () => void; isMobile: boolean
}) {
  const now = new Date()
  const soonThreshold = new Date(now.getTime() + 30 * 24 * 3600000) // 30 days

  const isExpiringSoon = (c: Contract) => {
    if (!c.end_date) return false
    const end = new Date(c.end_date + 'T00:00:00')
    return end > now && end < soonThreshold
  }

  const isExpired = (c: Contract) => {
    if (!c.end_date) return false
    return new Date(c.end_date + 'T00:00:00') < now
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: '#888' }}>{contracts.length} contratos registrados</div>
        <Btn variant="primary" onClick={onNew}><Plus size={14} /> Nueva Póliza</Btn>
      </div>

      {contracts.length === 0 ? <EmptyState message="No hay pólizas registradas" /> : (
        <Table>
          <thead>
            <tr>
              <Th>Propiedad</Th>
              <Th>Póliza</Th>
              {!isMobile && <Th>Vigencia</Th>}
              <Th>Cuota</Th>
              <Th>Visitas</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {contracts.map(c => {
              const prop = propMap[c.property_id]
              const expired = isExpired(c)
              const expiringSoon = isExpiringSoon(c)
              const fee = c.monthly_fee ? `${F(c.monthly_fee)}/mes` : c.annual_fee ? `${F(c.annual_fee)}/año` : '--'
              return (
                <tr key={c.id}
                  style={{ background: expiringSoon ? '#D9770608' : expired ? '#DC262608' : 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
                  onMouseLeave={e => (e.currentTarget.style.background = expiringSoon ? '#D9770608' : expired ? '#DC262608' : 'transparent')}>
                  <Td>{prop?.name || '--'}</Td>
                  <Td>
                    <div style={{ fontWeight: 500, color: '#fff', fontSize: 12 }}>{c.name}</div>
                    {c.contract_type && <div style={{ fontSize: 10, color: '#555' }}>{c.contract_type}</div>}
                  </Td>
                  {!isMobile && (
                    <Td muted>
                      {c.start_date ? formatDate(c.start_date) : '--'} — {c.end_date ? formatDate(c.end_date) : '--'}
                    </Td>
                  )}
                  <Td>{fee}</Td>
                  <Td>
                    <span style={{ color: c.visits_used >= c.visits_included ? '#DC2626' : '#ccc', fontWeight: 500, fontSize: 12 }}>
                      {c.visits_used}/{c.visits_included}
                    </span>
                  </Td>
                  <Td>
                    {expired
                      ? <Badge label="Vencida" color="#DC2626" />
                      : expiringSoon
                        ? <Badge label="Por Vencer" color="#D97706" />
                        : c.is_active
                          ? <Badge label="Activa" color="#10B981" />
                          : <Badge label="Inactiva" color="#6B7280" />
                    }
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: OPORTUNIDADES (Kanban)
// ═══════════════════════════════════════════════════════════════════════════

function TabOportunidades({ upsells, propMap, onSelect, onNew, isMobile }: {
  upsells: Upsell[]; propMap: Record<string, Property>
  onSelect: (id: string) => void; onNew: () => void; isMobile: boolean
}) {
  const totalValue = upsells.reduce((s, u) => s + (u.estimated_value || 0), 0)
  const converted = upsells.filter(u => u.status === 'convertida').length
  const pipeline: UpsellStatus[] = ['identificada', 'propuesta', 'aceptada', 'convertida']

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Total Oportunidades" value={upsells.length} icon={<TrendingUp size={16} />} />
        <KpiCard label="Valor Estimado" value={F(totalValue)} color="#2563EB" icon={<DollarSign size={16} />} />
        <KpiCard label="Convertidas" value={converted} color="#10B981" icon={<CheckCircle size={16} />} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Btn variant="primary" onClick={onNew}><Plus size={14} /> Nueva Oportunidad</Btn>
      </div>

      {/* Kanban */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : `repeat(${pipeline.length}, 1fr)`,
        gap: 12,
      }}>
        {pipeline.map(status => {
          const cfg = UPSELL_STATUS_CFG[status]
          const items = upsells.filter(u => u.status === status)
          return (
            <div key={status} style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#ccc' }}>{cfg.label}</span>
                </div>
                <span style={{ fontSize: 11, color: '#555' }}>{items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map(u => {
                  const prop = propMap[u.property_id]
                  return (
                    <div key={u.id} onClick={() => onSelect(u.id)} style={{
                      background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8,
                      padding: 12, cursor: 'pointer', transition: 'border-color 0.15s',
                    }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = cfg.color + '66')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2a2a')}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#fff', marginBottom: 4 }}>{u.title}</div>
                      <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>{prop?.name || '--'}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{F(u.estimated_value || 0)}</span>
                        <span style={{ fontSize: 10, color: '#555' }}>{formatDate(u.created_at)}</span>
                      </div>
                    </div>
                  )
                })}
                {items.length === 0 && (
                  <div style={{ padding: 16, textAlign: 'center', color: '#333', fontSize: 11 }}>Sin oportunidades</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PROPERTY DETAIL
// ═══════════════════════════════════════════════════════════════════════════

function PropertyDetail({ property, tickets, visits, contracts, upsells, propMap, onBack, onOpenTicket, onReload, isMobile }: {
  property: Property; tickets: TicketRow[]; visits: Visit[]; contracts: Contract[]; upsells: Upsell[]
  propMap: Record<string, Property>
  onBack: () => void; onOpenTicket: (id: string) => void; onReload: () => void; isMobile: boolean
}) {
  const [contacts, setContacts] = useState<MaintContact[]>([])
  const [equipment, setEquipment] = useState<MaintEquipment[]>([])
  const [showAddContact, setShowAddContact] = useState(false)
  const [showAddEquipment, setShowAddEquipment] = useState(false)
  const [seeding, setSeeding] = useState(false)

  async function loadExpediente() {
    if (!property) return
    const [cRes, eRes] = await Promise.all([
      supabase.from('maintenance_contacts').select('*').eq('property_id', property.id).order('is_primary', { ascending: false }),
      supabase.from('maintenance_equipment').select('*').eq('property_id', property.id).order('system', { ascending: true }),
    ])
    setContacts((cRes.data as MaintContact[]) || [])
    setEquipment((eRes.data as MaintEquipment[]) || [])
  }
  useEffect(() => { loadExpediente() }, [property?.id])

  async function seedFromQuotation() {
    if (!property?.original_quotation_id) return
    setSeeding(true)
    const { data, error } = await supabase.rpc('seed_maintenance_equipment_from_quotation', {
      p_property_id: property.id, p_quotation_id: property.original_quotation_id,
    })
    setSeeding(false)
    if (error) { alert('Error al sembrar equipos: ' + error.message); return }
    await loadExpediente()
    alert(`${data ?? 0} equipo(s) importado(s) de la cotización original.`)
  }

  async function deleteContact(id: string) {
    if (!confirm('¿Eliminar este contacto?')) return
    await supabase.from('maintenance_contacts').delete().eq('id', id)
    loadExpediente()
  }
  async function deleteEquipment(id: string) {
    if (!confirm('¿Eliminar este equipo?')) return
    await supabase.from('maintenance_equipment').delete().eq('id', id)
    loadExpediente()
  }

  if (!property) return <div style={{ padding: 32, color: '#555' }}>Propiedad no encontrada. <Btn onClick={onBack}>Volver</Btn></div>

  const activeContract = contracts.find(c => c.is_active && (!c.end_date || new Date(c.end_date + 'T00:00:00') >= new Date()))

  // Timeline: mix tickets and visits sorted by date desc
  const timeline = useMemo(() => {
    const items: Array<{ date: string; type: 'ticket' | 'visit'; data: TicketRow | Visit }> = []
    tickets.forEach(t => items.push({ date: t.reported_at || t.created_at, type: 'ticket', data: t }))
    visits.forEach(v => items.push({ date: v.visit_date || v.created_at, type: 'visit', data: v }))
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return items
  }, [tickets, visits])

  const ct = CONTRACT_TYPE_CFG[property.contract_type] || CONTRACT_TYPE_CFG.por_visita

  return (
    <div style={{ padding: isMobile ? 16 : 32, maxWidth: 1200, margin: '0 auto' }}>
      {/* Back */}
      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: '#10B981', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: 'inherit',
        marginBottom: 20, padding: 0,
      }}>
        <ArrowLeft size={16} /> Volver a Propiedades
      </button>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{property.name}</div>
          <div style={{ fontSize: 13, color: '#888' }}>{property.client_name}</div>
        </div>
        <Badge label={ct.label} color={ct.color} />
      </div>

      {/* Info cards */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Property info */}
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 12 }}>Información</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {property.client_phone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Phone size={14} style={{ color: '#555' }} />
                <span style={{ fontSize: 13, color: '#ccc' }}>{property.client_phone}</span>
              </div>
            )}
            {property.client_email && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Mail size={14} style={{ color: '#555' }} />
                <span style={{ fontSize: 13, color: '#ccc' }}>{property.client_email}</span>
              </div>
            )}
            {property.address && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MapPin size={14} style={{ color: '#555' }} />
                <span style={{ fontSize: 13, color: '#ccc' }}>{property.address}{property.city ? `, ${property.city}` : ''}</span>
              </div>
            )}
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Sistemas Instalados</div>
              <SystemsBadges systems={property.systems_installed || []} />
            </div>
            {property.notes && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Notas</div>
                <div style={{ fontSize: 12, color: '#888', lineHeight: 1.4 }}>{property.notes}</div>
              </div>
            )}
          </div>
        </div>

        {/* Active contract */}
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 12 }}>Póliza / Contrato Activo</div>
          {activeContract ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{activeContract.name}</div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {activeContract.start_date ? formatDate(activeContract.start_date) : '--'} — {activeContract.end_date ? formatDate(activeContract.end_date) : '--'}
              </div>
              <div style={{ fontSize: 13, color: '#ccc' }}>
                Cuota: {activeContract.monthly_fee ? `${F(activeContract.monthly_fee)}/mes` : activeContract.annual_fee ? `${F(activeContract.annual_fee)}/año` : '--'}
              </div>
              <div style={{ fontSize: 13, color: activeContract.visits_used >= activeContract.visits_included ? '#DC2626' : '#ccc' }}>
                Visitas: {activeContract.visits_used}/{activeContract.visits_included}
              </div>
              <Badge label="Activa" color="#10B981" />
            </div>
          ) : (
            <div style={{ color: '#444', fontSize: 13 }}>Sin contrato activo</div>
          )}
        </div>
      </div>

      {/* Expediente: Contactos + Equipos */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Contactos */}
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#888' }}>Contactos</div>
            <button onClick={() => setShowAddContact(true)} style={miniBtn}><Plus size={12} /> Agregar</button>
          </div>
          {contacts.length === 0 ? (
            <div style={{ color: '#444', fontSize: 12, padding: '8px 0' }}>Sin contactos. Agrega quién puede reportar fallas (con teléfono).</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {contacts.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid #1e1e1e' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: '#fff', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.name}
                      {c.is_primary && <span style={{ fontSize: 9, color: '#10B981' }}>★ principal</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      <span style={{ textTransform: 'capitalize' }}>{c.role.replace('_', ' ')}</span>
                      {c.phone_e164 && <> · {c.phone_e164}</>}
                      {c.email && <> · {c.email}</>}
                    </div>
                  </div>
                  <button onClick={() => deleteContact(c.id)} style={trashBtn}><X size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Equipos instalados */}
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#888' }}>Equipos instalados <span style={{ color: '#555', fontWeight: 400 }}>· sin precios</span></div>
            <div style={{ display: 'flex', gap: 6 }}>
              {property.original_quotation_id && (
                <button onClick={seedFromQuotation} disabled={seeding} style={miniBtn}>
                  {seeding ? 'Sembrando...' : '↻ Desde cotización'}
                </button>
              )}
              <button onClick={() => setShowAddEquipment(true)} style={miniBtn}><Plus size={12} /> Agregar</button>
            </div>
          </div>
          {equipment.length === 0 ? (
            <div style={{ color: '#444', fontSize: 12, padding: '8px 0' }}>
              Sin equipos. {property.original_quotation_id ? 'Usa "Desde cotización" para sembrarlos automáticamente.' : 'Agrega los equipos manualmente.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
              {equipment.map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid #1e1e1e' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>
                      {[e.marca, e.modelo].filter(Boolean).join(' ') || e.notes || 'Equipo'}
                      {e.cantidad && e.cantidad > 1 ? <span style={{ color: '#888', fontWeight: 400 }}> ×{e.cantidad}</span> : null}
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {e.system && <span style={{ color: '#10B981' }}>{e.system}</span>}
                      {e.ubicacion && <span>· {e.ubicacion}</span>}
                      {e.sku && <span>· {e.sku}</span>}
                      {e.garantia_fin && <span style={{ color: new Date(e.garantia_fin) < new Date() ? '#DC2626' : '#888' }}>· gar. {formatDate(e.garantia_fin)}</span>}
                    </div>
                  </div>
                  <button onClick={() => deleteEquipment(e.id)} style={trashBtn}><X size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Upsell opportunities */}
      {upsells.length > 0 && (
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 12 }}>Oportunidades de Upsell</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {upsells.map(u => {
              const cfg = UPSELL_STATUS_CFG[u.status]
              return (
                <div key={u.id} style={{
                  background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: 12, minWidth: 180,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#fff', marginBottom: 4 }}>{u.title}</div>
                  <div style={{ fontSize: 12, color: cfg.color, fontWeight: 600, marginBottom: 4 }}>{F(u.estimated_value || 0)}</div>
                  <Badge label={cfg.label} color={cfg.color} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 16 }}>Historial</div>
        {timeline.length === 0 ? (
          <div style={{ color: '#444', fontSize: 13, textAlign: 'center', padding: 20 }}>Sin actividad registrada</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {timeline.map((item, i) => {
              const isTicket = item.type === 'ticket'
              const t = item.data as TicketRow
              const v = item.data as Visit
              return (
                <div key={`${item.type}-${isTicket ? t.id : v.id}`} style={{
                  display: 'flex', gap: 12, padding: '12px 0',
                  borderBottom: i < timeline.length - 1 ? '1px solid #1e1e1e' : 'none',
                }}>
                  {/* Icon */}
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: isTicket ? '#2563EB22' : '#10B98122',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {isTicket ? <Ticket size={14} style={{ color: '#2563EB' }} /> : <Wrench size={14} style={{ color: '#10B981' }} />}
                  </div>
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isTicket ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: '#fff', cursor: 'pointer' }}
                            onClick={() => onOpenTicket(t.id)}>
                            #{t.ticket_number} — {t.subject}
                          </span>
                          <Badge label={STATUS_CFG[t.status]?.label || t.status} color={STATUS_CFG[t.status]?.color || '#6B7280'} />
                          <Badge label={PRIORITY_CFG[t.priority]?.label || t.priority} color={PRIORITY_CFG[t.priority]?.color || '#6B7280'} />
                        </div>
                        {t.description && <div style={{ fontSize: 11, color: '#666', marginTop: 4, lineHeight: 1.4 }}>{t.description.slice(0, 120)}{t.description.length > 120 ? '...' : ''}</div>}
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>Visita</span>
                          {v.technician && <span style={{ fontSize: 11, color: '#888' }}>por {v.technician}</span>}
                          <Badge label={VISIT_STATUS_CFG[v.status]?.label || v.status} color={VISIT_STATUS_CFG[v.status]?.color || '#6B7280'} />
                        </div>
                        {v.work_performed && <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{v.work_performed.slice(0, 120)}{v.work_performed.length > 120 ? '...' : ''}</div>}
                        {v.duration_hours && <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>Duración: {v.duration_hours}h</div>}
                      </>
                    )}
                  </div>
                  {/* Date */}
                  <div style={{ fontSize: 11, color: '#555', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {formatDate(item.date)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showAddContact && (
        <AddContactModal propertyId={property.id} onClose={() => setShowAddContact(false)}
          onCreated={() => { setShowAddContact(false); loadExpediente() }} />
      )}
      {showAddEquipment && (
        <AddEquipmentModal propertyId={property.id} onClose={() => setShowAddEquipment(false)}
          onCreated={() => { setShowAddEquipment(false); loadExpediente() }} />
      )}
    </div>
  )
}

// Estilos compartidos del expediente
const miniBtn: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '5px 10px',
  color: '#10B981', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  display: 'flex', alignItems: 'center', gap: 4,
}
const trashBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: 4, flexShrink: 0,
}

function AddContactModal({ propertyId, onClose, onCreated }: {
  propertyId: string; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({ name: '', phone_e164: '', email: '', role: 'dueño', is_primary: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const s = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.name.trim()) { setError('El nombre es requerido'); return }
    setSaving(true); setError('')
    let phone = form.phone_e164.trim()
    if (phone && !phone.startsWith('+')) phone = '+' + phone.replace(/[^0-9]/g, '')
    const { error: err } = await supabase.from('maintenance_contacts').insert({
      property_id: propertyId,
      name: form.name.trim(),
      phone_e164: phone || null,
      email: form.email.trim() || null,
      role: form.role,
      is_primary: form.is_primary,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  return (
    <ModalShell title="Agregar contacto" onClose={onClose} width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Nombre *" value={form.name} onChange={s('name')} placeholder="Nombre del contacto" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Teléfono (WhatsApp)" value={form.phone_e164} onChange={s('phone_e164')} placeholder="+52..." />
          <label style={labelStyle}>
            Rol
            <select value={form.role} onChange={e => s('role')(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
              {CONTACT_ROLES.map(r => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r.replace('_', ' ')}</option>)}
            </select>
          </label>
        </div>
        <Field label="Email" value={form.email} onChange={s('email')} placeholder="correo@ejemplo.com" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#ccc' }}>
          <input type="checkbox" checked={form.is_primary} onChange={e => setForm(f => ({ ...f, is_primary: e.target.checked }))} />
          Contacto principal
        </label>
        {error && <div style={{ color: '#DC2626', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Agregar'}</Btn>
        </div>
      </div>
    </ModalShell>
  )
}

function AddEquipmentModal({ propertyId, onClose, onCreated }: {
  propertyId: string; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    marca: '', modelo: '', system: '', ubicacion: '', cantidad: '1', sku: '', serial: '', garantia_fin: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const s = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.marca.trim() && !form.modelo.trim() && !form.notes.trim()) { setError('Indica al menos marca, modelo o descripción'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('maintenance_equipment').insert({
      property_id: propertyId,
      marca: form.marca.trim() || null,
      modelo: form.modelo.trim() || null,
      system: form.system.trim() || null,
      ubicacion: form.ubicacion.trim() || null,
      cantidad: form.cantidad ? parseFloat(form.cantidad) : 1,
      sku: form.sku.trim() || null,
      serial: form.serial.trim() || null,
      garantia_fin: form.garantia_fin || null,
      notes: form.notes.trim() || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  return (
    <ModalShell title="Agregar equipo" onClose={onClose} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Marca" value={form.marca} onChange={s('marca')} placeholder="Ej. Lutron" />
          <Field label="Modelo" value={form.modelo} onChange={s('modelo')} placeholder="Ej. RA2 Select" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <label style={labelStyle}>
            Sistema
            <select value={form.system} onChange={e => s('system')(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
              <option value="">--</option>
              {SYSTEMS_OPTIONS.map(o => <option key={o.id} value={o.label}>{o.label}</option>)}
            </select>
          </label>
          <Field label="Ubicación" value={form.ubicacion} onChange={s('ubicacion')} placeholder="Sala, cocina..." />
          <Field label="Cantidad" value={form.cantidad} onChange={s('cantidad')} type="number" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="SKU / No. parte" value={form.sku} onChange={s('sku')} placeholder="Opcional" />
          <Field label="Serie" value={form.serial} onChange={s('serial')} placeholder="Opcional" />
        </div>
        <Field label="Fin de garantía" value={form.garantia_fin} onChange={s('garantia_fin')} type="date" />
        <TextArea label="Notas" value={form.notes} onChange={s('notes')} placeholder="Detalle del equipo..." rows={2} />
        {error && <div style={{ color: '#DC2626', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Agregar equipo'}</Btn>
        </div>
      </div>
    </ModalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TICKET DETAIL
// ═══════════════════════════════════════════════════════════════════════════

function TicketDetail({ ticket, property, visits, onBack, onReload, isMobile }: {
  ticket: TicketRow; property?: Property; visits: Visit[]
  onBack: () => void; onReload: () => void; isMobile: boolean
}) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status)
  const [notes, setNotes] = useState(ticket.notes || '')
  const [saving, setSaving] = useState(false)
  const [showAddVisit, setShowAddVisit] = useState(false)

  const cat = CATEGORY_CFG[ticket.category] || CATEGORY_CFG.otro
  const pri = PRIORITY_CFG[ticket.priority] || PRIORITY_CFG.baja
  const st = STATUS_CFG[status] || STATUS_CFG.abierto
  const sla = slaDisplay(ticket.reported_at || ticket.created_at, ticket.sla_response_hours)

  async function saveChanges() {
    setSaving(true)
    const updates: Record<string, unknown> = { status, notes, updated_at: new Date().toISOString() }
    if (status === 'resuelto' && !ticket.resolved_at) updates.resolved_at = new Date().toISOString()
    if (status === 'cerrado' && !ticket.closed_at) updates.closed_at = new Date().toISOString()
    if (status !== 'abierto' && !ticket.first_response_at) updates.first_response_at = new Date().toISOString()
    await supabase.from('maintenance_tickets').update(updates).eq('id', ticket.id)
    setSaving(false)
    onReload()
  }

  return (
    <div style={{ padding: isMobile ? 16 : 32, maxWidth: 1000, margin: '0 auto' }}>
      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: '#10B981', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: 'inherit',
        marginBottom: 20, padding: 0,
      }}>
        <ArrowLeft size={16} /> Volver a Tickets
      </button>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>#{ticket.ticket_number}</span>
          <span style={{ fontSize: 18, fontWeight: 500, color: '#ccc' }}>{ticket.subject}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Badge label={cat.label} color={cat.color} />
          <Badge label={pri.label} color={pri.color} />
          <Badge label={st.label} color={st.color} />
          {ticket.billable && <Badge label="Facturable" color="#D97706" />}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Left: description and status change */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Descripción</div>
            <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ticket.description || 'Sin descripción'}</div>
          </div>

          {ticket.systems_affected && ticket.systems_affected.length > 0 && (
            <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Sistemas Afectados</div>
              <SystemsBadges systems={ticket.systems_affected} />
            </div>
          )}

          {/* Change status */}
          <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Actualizar Ticket</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={labelStyle}>
                Estado
                <select value={status} onChange={e => setStatus(e.target.value as TicketStatus)}
                  style={{ ...selectStyle, marginTop: 4 }}>
                  {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <TextArea label="Notas" value={notes} onChange={setNotes} placeholder="Agregar notas..." rows={3} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant="primary" onClick={saveChanges} disabled={saving}>
                  {saving ? 'Guardando...' : 'Guardar Cambios'}
                </Btn>
                <Btn onClick={() => setShowAddVisit(true)}>
                  <Calendar size={14} /> Registrar Visita
                </Btn>
              </div>
            </div>
          </div>
        </div>

        {/* Right: info sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Detalles</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <InfoRow label="Propiedad" value={property?.name || '--'} />
              <InfoRow label="Cliente" value={property?.client_name || '--'} />
              <InfoRow label="Asignado a" value={ticket.assigned_to || '--'} />
              <InfoRow label="Reportado" value={ticket.reported_at ? formatDate(ticket.reported_at) : formatDate(ticket.created_at)} />
              {ticket.first_response_at && <InfoRow label="Primera Respuesta" value={formatDate(ticket.first_response_at)} />}
              {ticket.resolved_at && <InfoRow label="Resuelto" value={formatDate(ticket.resolved_at)} />}
              <InfoRow label="SLA" value={sla.text} valueColor={sla.color} />
              {ticket.billable && ticket.amount && <InfoRow label="Monto" value={F(ticket.amount)} />}
            </div>
          </div>

          {/* Visit history for this ticket */}
          <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Visitas del Ticket</div>
            {visits.length === 0 ? (
              <div style={{ color: '#444', fontSize: 12 }}>Sin visitas registradas</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visits.map(v => (
                  <div key={v.id} style={{ borderBottom: '1px solid #1e1e1e', paddingBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: '#ccc' }}>{formatDate(v.visit_date)}</span>
                      <Badge label={VISIT_STATUS_CFG[v.status]?.label || v.status} color={VISIT_STATUS_CFG[v.status]?.color || '#6B7280'} />
                    </div>
                    {v.technician && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Técnico: {v.technician}</div>}
                    {v.work_performed && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{v.work_performed}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add visit modal */}
      {showAddVisit && (
        <AddVisitModal
          ticketId={ticket.id}
          propertyId={ticket.property_id}
          contractId={ticket.contract_id}
          onClose={() => setShowAddVisit(false)}
          onCreated={() => { setShowAddVisit(false); onReload() }}
        />
      )}
    </div>
  )
}

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: '#555' }}>{label}</span>
      <span style={{ fontSize: 12, color: valueColor || '#ccc', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// UPSELL DETAIL
// ═══════════════════════════════════════════════════════════════════════════

function UpsellDetail({ upsell, property, onBack, onReload, isMobile }: {
  upsell: Upsell; property?: Property; onBack: () => void; onReload: () => void; isMobile: boolean
}) {
  const [status, setStatus] = useState<UpsellStatus>(upsell.status)
  const [notes, setNotes] = useState(upsell.notes || '')
  const [saving, setSaving] = useState(false)

  const cfg = UPSELL_STATUS_CFG[status]
  const pipeline: UpsellStatus[] = ['identificada', 'propuesta', 'aceptada', 'convertida']
  const currentIdx = pipeline.indexOf(status)

  async function saveChanges() {
    setSaving(true)
    await supabase.from('maintenance_upsell').update({
      status, notes, updated_at: new Date().toISOString(),
    }).eq('id', upsell.id)
    setSaving(false)
    onReload()
  }

  async function advance() {
    if (currentIdx < pipeline.length - 1) {
      const next = pipeline[currentIdx + 1]
      setStatus(next)
      setSaving(true)
      await supabase.from('maintenance_upsell').update({
        status: next, updated_at: new Date().toISOString(),
      }).eq('id', upsell.id)
      setSaving(false)
      onReload()
    }
  }

  return (
    <div style={{ padding: isMobile ? 16 : 32, maxWidth: 800, margin: '0 auto' }}>
      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: '#10B981', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: 'inherit',
        marginBottom: 20, padding: 0,
      }}>
        <ArrowLeft size={16} /> Volver a Oportunidades
      </button>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{upsell.title}</div>
        <div style={{ fontSize: 13, color: '#888' }}>{property?.name || '--'}</div>
      </div>

      {/* Progress bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
        {pipeline.map((s, i) => {
          const c = UPSELL_STATUS_CFG[s]
          const active = i <= currentIdx
          return (
            <div key={s} style={{
              flex: 1, height: 6, borderRadius: 3,
              background: active ? c.color : '#222',
              transition: 'background 0.2s',
            }} />
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        {pipeline.map((s, i) => {
          const c = UPSELL_STATUS_CFG[s]
          return (
            <span key={s} style={{ fontSize: 10, color: i <= currentIdx ? c.color : '#444', fontWeight: i === currentIdx ? 600 : 400 }}>
              {c.label}
            </span>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Detalles</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <InfoRow label="Valor Estimado" value={F(upsell.estimated_value || 0)} valueColor="#10B981" />
            <InfoRow label="Moneda" value={upsell.currency || 'MXN'} />
            <InfoRow label="Asignado a" value={upsell.assigned_to || '--'} />
            <InfoRow label="Creado" value={formatDate(upsell.created_at)} />
            <InfoRow label="Estado" value={cfg.label} valueColor={cfg.color} />
          </div>
        </div>

        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Descripción</div>
          <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{upsell.description || 'Sin descripción'}</div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>
            Estado
            <select value={status} onChange={e => setStatus(e.target.value as UpsellStatus)}
              style={{ ...selectStyle, marginTop: 4 }}>
              {Object.entries(UPSELL_STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <TextArea label="Notas" value={notes} onChange={setNotes} placeholder="Agregar notas..." rows={3} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="primary" onClick={saveChanges} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Btn>
            {currentIdx < pipeline.length - 1 && (
              <Btn onClick={advance} style={{ background: '#1e1e1e', color: UPSELL_STATUS_CFG[pipeline[currentIdx + 1]].color, border: `1px solid ${UPSELL_STATUS_CFG[pipeline[currentIdx + 1]].color}44` }}>
                Avanzar a {UPSELL_STATUS_CFG[pipeline[currentIdx + 1]].label} <ArrowRight size={14} />
              </Btn>
            )}
            {status !== 'rechazada' && (
              <Btn variant="danger" onClick={async () => {
                setStatus('rechazada')
                await supabase.from('maintenance_upsell').update({ status: 'rechazada', updated_at: new Date().toISOString() }).eq('id', upsell.id)
                onReload()
              }}>
                Rechazar
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL: NEW PROPERTY
// ═══════════════════════════════════════════════════════════════════════════

function NewPropertyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', client_name: '', client_phone: '', client_email: '',
    address: '', city: '', notes: '',
    systems_installed: [] as string[],
    contract_type: 'poliza' as 'poliza' | 'por_visita',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const s = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))
  const toggleSystem = (sys: string) => {
    setForm(f => ({
      ...f,
      systems_installed: f.systems_installed.includes(sys)
        ? f.systems_installed.filter(x => x !== sys)
        : [...f.systems_installed, sys],
    }))
  }

  async function save() {
    if (!form.name.trim()) { setError('El nombre es requerido'); return }
    if (!form.client_name.trim()) { setError('El nombre del cliente es requerido'); return }
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('maintenance_properties').insert({
      name: form.name.trim(),
      client_name: form.client_name.trim(),
      client_phone: form.client_phone.trim(),
      client_email: form.client_email.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      notes: form.notes.trim(),
      systems_installed: form.systems_installed,
      contract_type: form.contract_type,
      is_active: true,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  return (
    <ModalShell title="Nueva Propiedad" onClose={onClose} width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Nombre de la Propiedad *" value={form.name} onChange={s('name')} placeholder="Ej: Residencia Los Olivos" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Cliente *" value={form.client_name} onChange={s('client_name')} placeholder="Nombre del cliente" />
          <Field label="Teléfono" value={form.client_phone} onChange={s('client_phone')} placeholder="+52 33 1234 5678" />
        </div>
        <Field label="Email" value={form.client_email} onChange={s('client_email')} placeholder="cliente@email.com" type="email" />
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Field label="Dirección" value={form.address} onChange={s('address')} placeholder="Calle y número" />
          <Field label="Ciudad" value={form.city} onChange={s('city')} placeholder="Ciudad" />
        </div>

        {/* Systems */}
        <div>
          <label style={labelStyle}>Sistemas Instalados</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {SYSTEMS_OPTIONS.map(sys => {
              const active = form.systems_installed.includes(sys.label)
              return (
                <button key={sys.id} onClick={() => toggleSystem(sys.label)} style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: active ? 600 : 400,
                  border: `1px solid ${active ? sys.color : '#333'}`,
                  background: active ? sys.color + '22' : 'transparent',
                  color: active ? sys.color : '#666',
                }}>
                  {sys.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Contract type */}
        <div>
          <label style={labelStyle}>Tipo de Contrato</label>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            {(['poliza', 'por_visita'] as const).map(ct => {
              const cfg = CONTRACT_TYPE_CFG[ct]
              const active = form.contract_type === ct
              return (
                <button key={ct} onClick={() => setForm(f => ({ ...f, contract_type: ct }))} style={{
                  padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: active ? 600 : 400,
                  border: `1px solid ${active ? cfg.color : '#333'}`,
                  background: active ? cfg.color + '22' : 'transparent',
                  color: active ? cfg.color : '#666',
                }}>
                  {cfg.label}
                </button>
              )
            })}
          </div>
        </div>

        <TextArea label="Notas" value={form.notes} onChange={s('notes')} placeholder="Notas adicionales..." />

        {error && <div style={{ color: '#DC2626', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Crear Propiedad'}</Btn>
        </div>
      </div>
    </ModalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL: NEW TICKET
// ═══════════════════════════════════════════════════════════════════════════

function NewTicketModal({ properties, onClose, onCreated }: {
  properties: Property[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    property_id: '', subject: '', description: '',
    category: 'falla' as TicketCategory,
    priority: 'media' as TicketPriority,
    systems_affected: [] as string[],
    assigned_to: '', billable: false, amount: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const s = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))
  const toggleSystem = (sys: string) => {
    setForm(f => ({
      ...f,
      systems_affected: f.systems_affected.includes(sys)
        ? f.systems_affected.filter(x => x !== sys)
        : [...f.systems_affected, sys],
    }))
  }

  // When property is selected, pre-fill available systems
  const selectedProp = properties.find(p => p.id === form.property_id)

  async function save() {
    if (!form.property_id) { setError('Selecciona una propiedad'); return }
    if (!form.subject.trim()) { setError('El asunto es requerido'); return }
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('maintenance_tickets').insert({
      property_id: form.property_id,
      subject: form.subject.trim(),
      description: form.description.trim(),
      category: form.category,
      priority: form.priority,
      systems_affected: form.systems_affected,
      assigned_to: form.assigned_to.trim() || null,
      billable: form.billable,
      amount: form.billable && form.amount ? parseFloat(form.amount) : null,
      currency: 'MXN',
      status: 'abierto',
      reported_at: new Date().toISOString(),
      sla_response_hours: form.priority === 'urgente' ? 2 : form.priority === 'alta' ? 4 : form.priority === 'media' ? 8 : 24,
      sla_resolution_hours: form.priority === 'urgente' ? 8 : form.priority === 'alta' ? 24 : form.priority === 'media' ? 48 : 72,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  return (
    <ModalShell title="Nuevo Ticket" onClose={onClose} width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={labelStyle}>
          Propiedad *
          <select value={form.property_id} onChange={e => s('property_id')(e.target.value)}
            style={{ ...selectStyle, marginTop: 4 }}>
            <option value="">Seleccionar propiedad...</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name} — {p.client_name}</option>)}
          </select>
        </label>

        <Field label="Asunto *" value={form.subject} onChange={s('subject')} placeholder="Describe brevemente el problema" />
        <TextArea label="Descripción" value={form.description} onChange={s('description')} placeholder="Detalle del reporte..." rows={3} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={labelStyle}>
            Categoría
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as TicketCategory }))}
              style={{ ...selectStyle, marginTop: 4 }}>
              {Object.entries(CATEGORY_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            Prioridad
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as TicketPriority }))}
              style={{ ...selectStyle, marginTop: 4 }}>
              {Object.entries(PRIORITY_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
        </div>

        {/* Systems affected */}
        <div>
          <label style={labelStyle}>Sistemas Afectados</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {(selectedProp?.systems_installed?.length ? SYSTEMS_OPTIONS.filter(s => selectedProp.systems_installed.includes(s.label)) : SYSTEMS_OPTIONS).map(sys => {
              const active = form.systems_affected.includes(sys.label)
              return (
                <button key={sys.id} onClick={() => toggleSystem(sys.label)} style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: active ? 600 : 400,
                  border: `1px solid ${active ? sys.color : '#333'}`,
                  background: active ? sys.color + '22' : 'transparent',
                  color: active ? sys.color : '#666',
                }}>
                  {sys.label}
                </button>
              )
            })}
          </div>
        </div>

        <Field label="Asignado a" value={form.assigned_to} onChange={s('assigned_to')} placeholder="Nombre del técnico" />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#ccc' }}>
            <input type="checkbox" checked={form.billable} onChange={e => setForm(f => ({ ...f, billable: e.target.checked }))} />
            Facturable
          </label>
          {form.billable && (
            <div style={{ flex: 1 }}>
              <Field label="Monto" value={form.amount} onChange={s('amount')} placeholder="0.00" type="number" />
            </div>
          )}
        </div>

        {error && <div style={{ color: '#DC2626', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Crear Ticket'}</Btn>
        </div>
      </div>
    </ModalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL: NEW CONTRACT / POLIZA
// ═══════════════════════════════════════════════════════════════════════════

function NewContractModal({ properties, onClose, onCreated }: {
  properties: Property[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    property_id: '', name: '', start_date: '', end_date: '',
    monthly_fee: '', annual_fee: '', currency: 'MXN', visits_included: '12',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const s = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.property_id) { setError('Selecciona una propiedad'); return }
    if (!form.name.trim()) { setError('El nombre es requerido'); return }
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('maintenance_contracts').insert({
      property_id: form.property_id,
      name: form.name.trim(),
      contract_type: 'poliza',
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      monthly_fee: form.monthly_fee ? parseFloat(form.monthly_fee) : null,
      annual_fee: form.annual_fee ? parseFloat(form.annual_fee) : null,
      currency: form.currency,
      visits_included: parseInt(form.visits_included) || 12,
      visits_used: 0,
      is_active: true,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  return (
    <ModalShell title="Nueva Póliza" onClose={onClose} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={labelStyle}>
          Propiedad *
          <select value={form.property_id} onChange={e => s('property_id')(e.target.value)}
            style={{ ...selectStyle, marginTop: 4 }}>
            <option value="">Seleccionar propiedad...</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name} — {p.client_name}</option>)}
          </select>
        </label>

        <Field label="Nombre de la Póliza *" value={form.name} onChange={s('name')} placeholder="Ej: Póliza Anual 2025" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Fecha Inicio" value={form.start_date} onChange={s('start_date')} type="date" />
          <Field label="Fecha Fin" value={form.end_date} onChange={s('end_date')} type="date" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Cuota Mensual" value={form.monthly_fee} onChange={s('monthly_fee')} placeholder="0.00" type="number" />
          <Field label="Cuota Anual" value={form.annual_fee} onChange={s('annual_fee')} placeholder="0.00" type="number" />
          <label style={labelStyle}>
            Moneda
            <select value={form.currency} onChange={e => s('currency')(e.target.value)}
              style={{ ...selectStyle, marginTop: 4 }}>
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
            </select>
          </label>
        </div>

        <Field label="Visitas Incluidas" value={form.visits_included} onChange={s('visits_included')} type="number" />

        {error && <div style={{ color: '#DC2626', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Crear Póliza'}</Btn>
        </div>
      </div>
    </ModalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL: NEW UPSELL
// ═══════════════════════════════════════════════════════════════════════════

function NewUpsellModal({ properties, onClose, onCreated }: {
  properties: Property[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    property_id: '', title: '', description: '',
    estimated_value: '', currency: 'MXN', assigned_to: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const s = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.property_id) { setError('Selecciona una propiedad'); return }
    if (!form.title.trim()) { setError('El título es requerido'); return }
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('maintenance_upsell').insert({
      property_id: form.property_id,
      title: form.title.trim(),
      description: form.description.trim(),
      estimated_value: parseFloat(form.estimated_value) || 0,
      currency: form.currency,
      assigned_to: form.assigned_to.trim() || null,
      status: 'identificada',
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  return (
    <ModalShell title="Nueva Oportunidad" onClose={onClose} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={labelStyle}>
          Propiedad *
          <select value={form.property_id} onChange={e => s('property_id')(e.target.value)}
            style={{ ...selectStyle, marginTop: 4 }}>
            <option value="">Seleccionar propiedad...</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name} — {p.client_name}</option>)}
          </select>
        </label>

        <Field label="Título *" value={form.title} onChange={s('title')} placeholder="Ej: Upgrade sistema de audio" />
        <TextArea label="Descripción" value={form.description} onChange={s('description')} placeholder="Detalle de la oportunidad..." rows={3} />

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Field label="Valor Estimado" value={form.estimated_value} onChange={s('estimated_value')} placeholder="0.00" type="number" />
          <label style={labelStyle}>
            Moneda
            <select value={form.currency} onChange={e => s('currency')(e.target.value)}
              style={{ ...selectStyle, marginTop: 4 }}>
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
            </select>
          </label>
        </div>

        <Field label="Asignado a" value={form.assigned_to} onChange={s('assigned_to')} placeholder="Responsable" />

        {error && <div style={{ color: '#DC2626', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Crear Oportunidad'}</Btn>
        </div>
      </div>
    </ModalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL: ADD VISIT (from ticket detail)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// TAB: AGENDA (programación de visitas por día / técnico)
// ═══════════════════════════════════════════════════════════════════════════

function visitStateLabel(v: Visit): { label: string; color: string } {
  if (v.status === 'completada') return { label: 'Completada', color: '#10B981' }
  if (v.status === 'cancelada') return { label: 'Cancelada', color: '#888' }
  if (v.arrived_at) return { label: 'En sitio', color: '#3b82f6' }
  if (v.en_route_at) return { label: 'En camino', color: '#f59e0b' }
  return { label: 'Programada', color: '#A78BFA' }
}

function fmtHora(t: string | null): string {
  if (!t) return '--:--'
  return t.slice(0, 5)
}

function TabAgenda({ visits, propMap, techMap, onOpenProperty, onSchedule, isMobile }: {
  visits: Visit[]
  propMap: Record<string, Property>
  techMap: Record<string, Technician>
  onOpenProperty: (id: string) => void
  onSchedule: () => void
  isMobile: boolean
}) {
  const today = new Date().toISOString().slice(0, 10)
  const sorted = [...visits].sort((a, b) => {
    if (a.visit_date !== b.visit_date) return a.visit_date < b.visit_date ? -1 : 1
    const ra = a.route_order ?? 999, rb = b.route_order ?? 999
    if (ra !== rb) return ra - rb
    return (a.scheduled_time ?? '99').localeCompare(b.scheduled_time ?? '99')
  })

  const upcoming = sorted.filter(v => v.visit_date >= today && v.status !== 'completada' && v.status !== 'cancelada')
  const past = sorted.filter(v => !(v.visit_date >= today && v.status !== 'completada' && v.status !== 'cancelada'))
    .sort((a, b) => a.visit_date < b.visit_date ? 1 : -1).slice(0, 40)

  const groupByDate = (arr: Visit[]) => {
    const g: Record<string, Visit[]> = {}
    arr.forEach(v => { (g[v.visit_date] ||= []).push(v) })
    return g
  }
  const upGroups = groupByDate(upcoming)
  const pastGroups = groupByDate(past)
  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' })

  const Row = (v: Visit) => {
    const st = visitStateLabel(v)
    const prop = propMap[v.property_id]
    const tech = v.technician_id ? techMap[v.technician_id] : null
    return (
      <div key={v.id} style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
        background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 10, marginBottom: 6,
      }}>
        <div style={{ width: 52, fontSize: 13, fontWeight: 700, color: '#A78BFA', flexShrink: 0 }}>{fmtHora(v.scheduled_time)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button onClick={() => onOpenProperty(v.property_id)} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#fff',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit', textAlign: 'left',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
          }}>
            {prop?.name || 'Propiedad'}
          </button>
          <div style={{ fontSize: 11, color: '#777', display: 'flex', gap: 8, marginTop: 2 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {tech?.foto_url
                ? <img src={tech.foto_url} style={{ width: 16, height: 16, borderRadius: 8, objectFit: 'cover' }} alt="" />
                : <Users size={12} />}
              {techName(tech)}
            </span>
            {v.ticket_id && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Ticket size={11} /> Ticket</span>}
          </div>
        </div>
        <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 8, background: st.color + '1f', color: st.color, fontWeight: 600, flexShrink: 0 }}>
          {st.label}
        </span>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <KpiCard label="Próximas" value={String(upcoming.length)} />
          <KpiCard label="Hoy" value={String(upcoming.filter(v => v.visit_date === today).length)} />
        </div>
        <Btn variant="primary" onClick={onSchedule}><Plus size={14} /> Programar visita</Btn>
      </div>

      {upcoming.length === 0 && (
        <EmptyState message="No hay visitas programadas. Usa 'Programar visita' para agendar." />
      )}

      {Object.keys(upGroups).sort().map(date => (
        <div key={date} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: '#10B981', fontWeight: 600, textTransform: 'capitalize', marginBottom: 8 }}>{fmtDate(date)}</div>
          {upGroups[date].map(Row)}
        </div>
      ))}

      {past.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Historial reciente</div>
          {Object.keys(pastGroups).sort().reverse().map(date => (
            <div key={date} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'capitalize', marginBottom: 6 }}>{fmtDate(date)}</div>
              {pastGroups[date].map(Row)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Modal para programar (agendar) una visita asignando técnico, fecha y hora
function ProgramarVisitaModal({ properties, tickets, contracts, technicians, onClose, onCreated }: {
  properties: Property[]
  tickets: TicketRow[]
  contracts: Contract[]
  technicians: Technician[]
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    property_id: '', ticket_id: '', technician_id: '',
    visit_date: new Date().toISOString().slice(0, 10),
    scheduled_time: '09:00', route_order: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  const openTicketsForProp = tickets.filter(t =>
    t.property_id === form.property_id && t.status !== 'resuelto' && t.status !== 'cerrado')

  async function save() {
    if (!form.property_id) { setError('Selecciona la propiedad'); return }
    if (!form.technician_id) { setError('Asigna un técnico'); return }
    if (!form.visit_date) { setError('La fecha es requerida'); return }
    setSaving(true); setError('')

    const tech = technicians.find(t => t.id === form.technician_id)
    const activeContract = contracts.find(c => c.property_id === form.property_id && c.is_active)

    const { error: err } = await supabase.from('maintenance_visits').insert({
      property_id: form.property_id,
      ticket_id: form.ticket_id || null,
      contract_id: activeContract?.id || null,
      technician_id: form.technician_id,
      technician: techName(tech),
      visit_date: form.visit_date,
      scheduled_time: form.scheduled_time || null,
      route_order: form.route_order ? parseInt(form.route_order, 10) : null,
      status: 'programada',
      notes: form.notes.trim() || null,
      currency: 'MXN',
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  return (
    <ModalShell title="Programar visita" onClose={onClose} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={labelStyle}>
          Propiedad *
          <select value={form.property_id} onChange={e => set('property_id')(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
            <option value="">Selecciona propiedad...</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}{p.client_name ? ` — ${p.client_name}` : ''}</option>)}
          </select>
        </label>

        {form.property_id && openTicketsForProp.length > 0 && (
          <label style={labelStyle}>
            Ticket relacionado (opcional)
            <select value={form.ticket_id} onChange={e => set('ticket_id')(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
              <option value="">Sin ticket (visita / preventivo)</option>
              {openTicketsForProp.map(t => <option key={t.id} value={t.id}>#{t.ticket_number} · {t.subject}</option>)}
            </select>
          </label>
        )}

        <label style={labelStyle}>
          Técnico asignado *
          <select value={form.technician_id} onChange={e => set('technician_id')(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
            <option value="">Selecciona técnico...</option>
            {technicians.map(t => <option key={t.id} value={t.id}>{techName(t)}{t.area ? ` (${t.area})` : ''}</option>)}
          </select>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Fecha *" value={form.visit_date} onChange={set('visit_date')} type="date" />
          <label style={labelStyle}>
            Hora
            <input type="time" value={form.scheduled_time} onChange={e => set('scheduled_time')(e.target.value)}
              style={{ ...selectStyle, marginTop: 4 }} />
          </label>
          <Field label="Orden ruta" value={form.route_order} onChange={set('route_order')} placeholder="1" type="number" />
        </div>

        <TextArea label="Notas para el técnico" value={form.notes} onChange={set('notes')} placeholder="Instrucciones, acceso, contacto en sitio..." rows={2} />

        {error && <div style={{ color: '#DC2626', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Agendando...' : 'Programar visita'}</Btn>
        </div>
      </div>
    </ModalShell>
  )
}

function AddVisitModal({ ticketId, propertyId, contractId, onClose, onCreated }: {
  ticketId: string; propertyId: string; contractId: string | null
  onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    visit_date: new Date().toISOString().slice(0, 10),
    scheduled_time: '', technician_id: '', technician: '', duration_hours: '', work_performed: '',
    parts_used: '', cost: '', billable: false, amount_charged: '',
    status: 'programada' as string,
  })
  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('employees').select('id, nombre, name, area, foto_url, activo').eq('activo', true).order('nombre')
      .then(({ data }) => setTechnicians((data as Technician[]) || []))
  }, [])

  const s = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.visit_date) { setError('La fecha es requerida'); return }
    setSaving(true)
    setError('')
    const tech = technicians.find(t => t.id === form.technician_id)
    const { error: err } = await supabase.from('maintenance_visits').insert({
      ticket_id: ticketId,
      property_id: propertyId,
      contract_id: contractId,
      visit_date: form.visit_date,
      scheduled_time: form.scheduled_time || null,
      technician_id: form.technician_id || null,
      technician: tech ? techName(tech) : null,
      duration_hours: form.duration_hours ? parseFloat(form.duration_hours) : null,
      work_performed: form.work_performed.trim(),
      parts_used: form.parts_used.trim(),
      cost: form.cost ? parseFloat(form.cost) : null,
      billable: form.billable,
      amount_charged: form.billable && form.amount_charged ? parseFloat(form.amount_charged) : null,
      currency: 'MXN',
      status: form.status,
    })
    setSaving(false)
    if (err) { setError(err.message); return }

    // If visit completed and has a contract, increment visits_used
    if (form.status === 'completada' && contractId) {
      await supabase.rpc('increment_visits_used', { contract_id_param: contractId }).catch(() => {
        // fallback: manual update
        supabase.from('maintenance_contracts').select('visits_used').eq('id', contractId).single()
          .then(({ data }) => {
            if (data) {
              supabase.from('maintenance_contracts').update({ visits_used: (data.visits_used || 0) + 1 }).eq('id', contractId)
            }
          })
      })
    }

    onCreated()
  }

  return (
    <ModalShell title="Registrar Visita" onClose={onClose} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Fecha *" value={form.visit_date} onChange={s('visit_date')} type="date" />
          <label style={labelStyle}>
            Hora
            <input type="time" value={form.scheduled_time} onChange={e => s('scheduled_time')(e.target.value)}
              style={{ ...selectStyle, marginTop: 4 }} />
          </label>
          <label style={labelStyle}>
            Estado
            <select value={form.status} onChange={e => s('status')(e.target.value)}
              style={{ ...selectStyle, marginTop: 4 }}>
              <option value="programada">Programada</option>
              <option value="completada">Completada</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <label style={labelStyle}>
            Técnico
            <select value={form.technician_id} onChange={e => s('technician_id')(e.target.value)}
              style={{ ...selectStyle, marginTop: 4 }}>
              <option value="">Sin asignar...</option>
              {technicians.map(t => <option key={t.id} value={t.id}>{techName(t)}</option>)}
            </select>
          </label>
          <Field label="Duración (hrs)" value={form.duration_hours} onChange={s('duration_hours')} placeholder="2.5" type="number" />
        </div>

        <TextArea label="Trabajo Realizado" value={form.work_performed} onChange={s('work_performed')} placeholder="Descripción del trabajo..." rows={3} />
        <Field label="Refacciones Utilizadas" value={form.parts_used} onChange={s('parts_used')} placeholder="Lista de refacciones" />
        <Field label="Costo" value={form.cost} onChange={s('cost')} placeholder="0.00" type="number" />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#ccc' }}>
            <input type="checkbox" checked={form.billable} onChange={e => setForm(f => ({ ...f, billable: e.target.checked }))} />
            Facturable
          </label>
          {form.billable && (
            <div style={{ flex: 1 }}>
              <Field label="Monto Cobrado" value={form.amount_charged} onChange={s('amount_charged')} placeholder="0.00" type="number" />
            </div>
          )}
        </div>

        {error && <div style={{ color: '#DC2626', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Registrar Visita'}</Btn>
        </div>
      </div>
    </ModalShell>
  )
}
