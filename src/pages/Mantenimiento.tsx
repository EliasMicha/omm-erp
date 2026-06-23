import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { SectionHeader, KpiCard, Table, Th, Td, Badge, Btn, EmptyState, Loading } from '../components/layout/UI'
import { F, formatDate } from '../lib/utils'
import { useIsMobile } from '../lib/useIsMobile'
import GeneradorPoliza from './GeneradorPoliza'
import { TabCotizaciones, QuoteEditorModal } from './MaintQuotes'
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
  plan_tier: string | null
  preventive_visits_included: number
  preventive_visits_used: number
  emergency_visits_included: number
  emergency_visits_used: number
  project_value: number | null
  payment_plan: string | null
  service_levels: any
  is_active: boolean
  notes: string
  created_at: string
  updated_at: string
  // joined
  property?: Property
}

const TIER_CFG: Record<string, { label: string; color: string }> = {
  bronce: { label: 'Bronce', color: '#b87333' },
  plata: { label: 'Plata', color: '#9ca3af' },
  oro: { label: 'Oro', color: '#f5b301' },
  platino: { label: 'Platino', color: '#a78bfa' },
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
  checkin_lat: number | null
  checkin_lng: number | null
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
  mantenimiento_app?: boolean | null
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

type Tab = 'dashboard' | 'propiedades' | 'agenda' | 'reportes' | 'tickets' | 'polizas' | 'oportunidades' | 'cotizaciones'

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
  const [tab, setTab] = useState<Tab>('dashboard')
  const [loading, setLoading] = useState(true)

  // Data
  const [properties, setProperties] = useState<Property[]>([])
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [visits, setVisits] = useState<Visit[]>([])
  const [upsells, setUpsells] = useState<Upsell[]>([])
  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [equipmentAll, setEquipmentAll] = useState<MaintEquipment[]>([])

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
  const [showGenerador, setShowGenerador] = useState(false)
  const [showFromLead, setShowFromLead] = useState(false)
  const [showEquipo, setShowEquipo] = useState(false)

  // Filters
  const [searchProp, setSearchProp] = useState('')
  const [ticketStatusFilter, setTicketStatusFilter] = useState<TicketStatus | ''>('')
  const [ticketPriorityFilter, setTicketPriorityFilter] = useState<TicketPriority | ''>('')
  const [ticketPropertyFilter, setTicketPropertyFilter] = useState('')

  // ── Load data ──────────────────────────────────────────────────────────

  async function loadAll() {
    setLoading(true)
    const [pRes, tRes, cRes, vRes, uRes, eRes, eqRes] = await Promise.all([
      supabase.from('maintenance_properties').select('*').order('name'),
      supabase.from('maintenance_tickets').select('*').order('created_at', { ascending: false }),
      supabase.from('maintenance_contracts').select('*').order('end_date', { ascending: false }),
      supabase.from('maintenance_visits').select('*').order('visit_date', { ascending: false }),
      supabase.from('maintenance_upsell').select('*').order('created_at', { ascending: false }),
      supabase.from('employees').select('id, nombre, name, area, foto_url, activo, mantenimiento_app').eq('activo', true).order('nombre'),
      supabase.from('maintenance_equipment').select('id, property_id, marca, modelo, garantia_fin'),
    ])
    setProperties(pRes.data || [])
    setTickets(tRes.data || [])
    setContracts(cRes.data || [])
    setVisits(vRes.data || [])
    setUpsells(uRes.data || [])
    setTechnicians((eRes.data as Technician[]) || [])
    setEquipmentAll((eqRes.data as MaintEquipment[]) || [])
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
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'propiedades', label: 'Propiedades' },
    { key: 'agenda', label: 'Agenda' },
    { key: 'reportes', label: 'Reportes' },
    { key: 'tickets', label: 'Tickets' },
    { key: 'polizas', label: 'Pólizas' },
    { key: 'oportunidades', label: 'Oportunidades' },
    { key: 'cotizaciones', label: 'Cotizaciones' },
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
          onFromLead={() => setShowFromLead(true)}
          isMobile={isMobile}
          openTicketsForProperty={openTicketsForProperty}
          lastVisitForProperty={lastVisitForProperty}
        />
      )}

      {tab === 'dashboard' && (
        <TabDashboard
          properties={properties} tickets={tickets} contracts={contracts}
          visits={visits} upsells={upsells} equipment={equipmentAll} techMap={techMap}
          onGoTab={(t) => setTab(t)}
          onOpenProperty={id => setSelectedPropertyId(id)}
          onOpenTicket={id => { setSelectedTicketId(id); setTab('tickets') }}
          isMobile={isMobile}
        />
      )}

      {tab === 'agenda' && (
        <TabAgenda
          visits={visits} propMap={propMap} techMap={techMap}
          onOpenProperty={id => setSelectedPropertyId(id)}
          onSchedule={() => setShowSchedule(true)}
          onEquipo={() => setShowEquipo(true)}
          isMobile={isMobile}
        />
      )}

      {tab === 'reportes' && (
        <TabReportes visits={visits} propMap={propMap} techMap={techMap} isMobile={isMobile} />
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
          onGenerar={() => setShowGenerador(true)}
          isMobile={isMobile}
        />
      )}

      {tab === 'cotizaciones' && (
        <TabCotizaciones
          properties={properties.map(p => ({ id: p.id, name: p.name, client_name: p.client_name, address: p.address, city: p.city, client_phone: p.client_phone }))}
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
      {showFromLead && (
        <CreateFromLeadModal onClose={() => setShowFromLead(false)} onCreated={() => { setShowFromLead(false); loadAll() }} />
      )}
      {showEquipo && (
        <EquipoCampoModal onClose={() => setShowEquipo(false)} onUpdated={loadAll} />
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
      {showGenerador && (
        <GeneradorPoliza
          properties={properties.map(p => ({ id: p.id, name: p.name, client_name: p.client_name, address: p.address, city: p.city }))}
          onClose={() => setShowGenerador(false)}
          onCreated={() => { setShowGenerador(false); loadAll() }}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

const MXN = (n: number) => '$' + Math.round(n).toLocaleString('es-MX')
const USD = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const hoursBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3600000

function DashCard({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 14, padding: 18 }}>{children}</div>
}
function DashTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 14 }}>{children}</div>
}
function BarRow({ label, value, max, color, suffix }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: '#ccc' }}>{label}</span>
        <span style={{ color: '#fff', fontWeight: 600 }}>{value}{suffix || ''}</span>
      </div>
      <div style={{ height: 7, background: '#1f1f1f', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${w}%`, height: '100%', background: color }} />
      </div>
    </div>
  )
}

function TabDashboard({ properties, tickets, contracts, visits, upsells, equipment, techMap, onGoTab, onOpenProperty, onOpenTicket, isMobile }: {
  properties: Property[]; tickets: TicketRow[]; contracts: Contract[]; visits: Visit[]; upsells: Upsell[]
  equipment: MaintEquipment[]; techMap: Record<string, Technician>
  onGoTab: (t: Tab) => void; onOpenProperty: (id: string) => void; onOpenTicket: (id: string) => void; isMobile: boolean
}) {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const in30 = new Date(now.getTime() + 30 * 864e5)
  const in60 = new Date(now.getTime() + 60 * 864e5)
  const in7 = new Date(now.getTime() + 7 * 864e5).toISOString().slice(0, 10)
  const monthKey = today.slice(0, 7)

  const isExpired = (c: Contract) => !!c.end_date && new Date(c.end_date + 'T00:00:00') < now
  const activePolizas = contracts.filter(c => c.is_active && !isExpired(c))

  // Ingresos recurrentes por moneda nativa
  const mrr = (cur: string) => activePolizas.filter(c => (cur === 'USD' ? c.currency === 'USD' : c.currency !== 'USD'))
    .reduce((s, c) => s + (c.monthly_fee || (c.annual_fee || 0) / 12), 0)
  const mrrMXN = mrr('MXN'), mrrUSD = mrr('USD')

  // Tier distribution
  const tierCount = (t: string) => activePolizas.filter(c => c.plan_tier === t).length

  // Pólizas por vencer / vencidas / cubetas agotadas
  const porVencer = contracts.filter(c => c.is_active && c.end_date && new Date(c.end_date + 'T00:00:00') > now && new Date(c.end_date + 'T00:00:00') < in30)
  const vencidas = contracts.filter(c => c.is_active && isExpired(c))
  const cubetaAgotada = activePolizas.filter(c =>
    (c.preventive_visits_included > 0 && c.preventive_visits_used >= c.preventive_visits_included) ||
    (c.emergency_visits_included > 0 && c.emergency_visits_used >= c.emergency_visits_included))
  const prevRestantes = activePolizas.reduce((s, c) => s + Math.max(0, c.preventive_visits_included - c.preventive_visits_used), 0)
  const bombRestantes = activePolizas.reduce((s, c) => s + Math.max(0, c.emergency_visits_included - c.emergency_visits_used), 0)

  // Tickets
  const abiertos = tickets.filter(t => t.status === 'abierto' || t.status === 'en_progreso' || t.status === 'esperando_cliente')
  const urgentesAbiertos = abiertos.filter(t => t.priority === 'urgente' || t.priority === 'alta')
  const sinAsignar = abiertos.filter(t => !t.assigned_to)
  const countBy = <T extends string>(arr: TicketRow[], key: (t: TicketRow) => T) => {
    const m: Record<string, number> = {}
    arr.forEach(t => { const k = key(t); m[k] = (m[k] || 0) + 1 })
    return m
  }
  const byPriority = countBy(abiertos, t => t.priority)
  const byCategory = countBy(abiertos, t => t.category)
  const slaResponseBreaches = abiertos.filter(t => !t.first_response_at && hoursBetween(t.reported_at || t.created_at, now.toISOString()) > (t.sla_response_hours || 24))
  const resolved = tickets.filter(t => t.resolved_at)
  const resolvedOnTime = resolved.filter(t => hoursBetween(t.reported_at || t.created_at, t.resolved_at!) <= (t.sla_resolution_hours || 72)).length
  const slaCompliance = resolved.length > 0 ? Math.round((resolvedOnTime / resolved.length) * 100) : null
  const avgResolution = resolved.length > 0 ? resolved.reduce((s, t) => s + hoursBetween(t.reported_at || t.created_at, t.resolved_at!), 0) / resolved.length : null

  // Visitas
  const visitasSemana = visits.filter(v => v.status === 'programada' && v.visit_date >= today && v.visit_date <= in7)
  const completadasMes = visits.filter(v => v.status === 'completada' && (v.completed_at || v.visit_date || '').slice(0, 7) === monthKey)
  const pendientesVisita = visits.filter(v => v.status === 'programada' && v.visit_date <= today)

  // Upsells
  const upActivos = upsells.filter(u => u.status !== 'convertida' && u.status !== 'rechazada')
  const upValMXN = upActivos.filter(u => u.currency !== 'USD').reduce((s, u) => s + (u.estimated_value || 0), 0)
  const upValUSD = upActivos.filter(u => u.currency === 'USD').reduce((s, u) => s + (u.estimated_value || 0), 0)
  const upByStatus = (s: UpsellStatus) => upsells.filter(u => u.status === s)

  // Propiedades + garantías
  const propsConPoliza = new Set(activePolizas.map(c => c.property_id))
  const sinPoliza = properties.filter(p => p.is_active && !propsConPoliza.has(p.id))
  const garantiasPorVencer = equipment.filter(e => e.garantia_fin && new Date(e.garantia_fin) > now && new Date(e.garantia_fin) < in60)

  // Alertas accionables
  const alerts: { icon: any; color: string; text: string; action?: () => void }[] = []
  vencidas.forEach(c => alerts.push({ icon: AlertTriangle, color: '#DC2626', text: `Póliza vencida: ${properties.find(p => p.id === c.property_id)?.name || c.name}`, action: () => onOpenProperty(c.property_id) }))
  porVencer.forEach(c => alerts.push({ icon: Clock, color: '#D97706', text: `Póliza por vencer (${c.end_date ? formatDate(c.end_date) : ''}): ${properties.find(p => p.id === c.property_id)?.name || c.name}`, action: () => onOpenProperty(c.property_id) }))
  cubetaAgotada.forEach(c => alerts.push({ icon: Shield, color: '#D97706', text: `Visitas agotadas: ${properties.find(p => p.id === c.property_id)?.name || c.name}`, action: () => onGoTab('polizas') }))
  urgentesAbiertos.slice(0, 6).forEach(t => alerts.push({ icon: Ticket, color: '#DC2626', text: `Ticket ${t.priority}: #${t.ticket_number} ${t.subject}`, action: () => onOpenTicket(t.id) }))
  slaResponseBreaches.slice(0, 6).forEach(t => alerts.push({ icon: Clock, color: '#DC2626', text: `SLA vencido sin respuesta: #${t.ticket_number} ${t.subject}`, action: () => onOpenTicket(t.id) }))
  garantiasPorVencer.slice(0, 6).forEach(e => alerts.push({ icon: Wrench, color: '#D97706', text: `Garantía por vencer (${e.garantia_fin ? formatDate(e.garantia_fin) : ''}): ${[e.marca, e.modelo].filter(Boolean).join(' ')}`, action: () => onOpenProperty(e.property_id) }))

  const maxTickets = Math.max(1, ...Object.values(byPriority), ...Object.values(byCategory))
  const maxTier = Math.max(1, tierCount('bronce'), tierCount('plata'), tierCount('oro'), tierCount('platino'))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPIs principales */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="Ingreso recurrente MXN" value={`${MXN(mrrMXN)}/mes`} color="#10B981" icon={<DollarSign size={16} />} />
        {mrrUSD > 0
          ? <KpiCard label="Ingreso recurrente USD" value={`${USD(mrrUSD)}/mes`} color="#10B981" icon={<DollarSign size={16} />} />
          : <KpiCard label="Pólizas activas" value={String(activePolizas.length)} color="#2563EB" icon={<Shield size={16} />} />}
        <KpiCard label="Tickets abiertos" value={String(abiertos.length)} color={abiertos.length ? '#D97706' : '#6B7280'} icon={<Ticket size={16} />} />
        <KpiCard label="Visitas esta semana" value={String(visitasSemana.length)} color="#A78BFA" icon={<Calendar size={16} />} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="Cumplimiento SLA" value={slaCompliance !== null ? `${slaCompliance}%` : '—'} color={slaCompliance !== null && slaCompliance < 80 ? '#DC2626' : '#10B981'} icon={<CheckCircle size={16} />} />
        <KpiCard label="Resolución prom." value={avgResolution !== null ? `${Math.round(avgResolution)} h` : '—'} icon={<Clock size={16} />} />
        <KpiCard label="Visitas restantes" value={`${prevRestantes + bombRestantes}`} color="#2563EB" icon={<Wrench size={16} />} />
        <KpiCard label="Pipeline upsell MXN" value={MXN(upValMXN)} color="#A78BFA" icon={<TrendingUp size={16} />} />
      </div>

      {/* Alertas */}
      <DashCard>
        <DashTitle>Requiere atención ({alerts.length})</DashTitle>
        {alerts.length === 0 ? (
          <div style={{ color: '#10B981', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}><CheckCircle size={15} /> Todo en orden, sin alertas.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
            {alerts.slice(0, 20).map((a, i) => {
              const Icon = a.icon
              return (
                <button key={i} onClick={a.action} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', textAlign: 'left',
                  background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 9, cursor: a.action ? 'pointer' : 'default',
                  color: '#ccc', fontSize: 12, fontFamily: 'inherit',
                }}>
                  <Icon size={14} color={a.color} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.text}</span>
                </button>
              )
            })}
          </div>
        )}
      </DashCard>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
        {/* Pólizas */}
        <DashCard>
          <DashTitle>Pólizas por plan</DashTitle>
          {(['bronce', 'plata', 'oro', 'platino'] as const).map(t => (
            <BarRow key={t} label={TIER_CFG[t].label} value={tierCount(t)} max={maxTier} color={TIER_CFG[t].color} />
          ))}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, paddingTop: 12, borderTop: '1px solid #222', fontSize: 12, color: '#888' }}>
            <span>Por vencer: <b style={{ color: '#D97706' }}>{porVencer.length}</b></span>
            <span>Vencidas: <b style={{ color: '#DC2626' }}>{vencidas.length}</b></span>
            <span>Visitas restantes: <b style={{ color: '#10B981' }}>{prevRestantes} prev · {bombRestantes} bomb.</b></span>
          </div>
        </DashCard>

        {/* Tickets */}
        <DashCard>
          <DashTitle>Tickets abiertos por prioridad</DashTitle>
          {(['urgente', 'alta', 'media', 'baja'] as const).map(p => (
            <BarRow key={p} label={PRIORITY_CFG[p]?.label || p} value={byPriority[p] || 0} max={maxTickets} color={PRIORITY_CFG[p]?.color || '#888'} />
          ))}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, paddingTop: 12, borderTop: '1px solid #222', fontSize: 12, color: '#888' }}>
            <span>Sin asignar: <b style={{ color: sinAsignar.length ? '#D97706' : '#10B981' }}>{sinAsignar.length}</b></span>
            <span>SLA vencido: <b style={{ color: slaResponseBreaches.length ? '#DC2626' : '#10B981' }}>{slaResponseBreaches.length}</b></span>
          </div>
        </DashCard>

        {/* Pipeline upsell */}
        <DashCard>
          <DashTitle>Pipeline de oportunidades</DashTitle>
          {(['identificada', 'propuesta', 'aceptada', 'convertida'] as UpsellStatus[]).map(s => {
            const items = upByStatus(s)
            const val = items.reduce((a, u) => a + (u.estimated_value || 0), 0)
            const cfg = UPSELL_STATUS_CFG[s]
            return <BarRow key={s} label={`${cfg.label} (${items.length})`} value={Math.round(val)} max={Math.max(1, upValMXN + upValUSD)} color={cfg.color} />
          })}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #222', fontSize: 12, color: '#888' }}>
            Valor activo: <b style={{ color: '#A78BFA' }}>{MXN(upValMXN)}{upValUSD > 0 ? ` · ${USD(upValUSD)} USD` : ''}</b>
          </div>
        </DashCard>

        {/* Cartera */}
        <DashCard>
          <DashTitle>Cartera</DashTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <RowKV k="Propiedades activas" v={String(properties.filter(p => p.is_active).length)} />
            <RowKV k="Con póliza activa" v={String(propsConPoliza.size)} color="#10B981" />
            <RowKV k="Sin póliza (oportunidad)" v={String(sinPoliza.length)} color={sinPoliza.length ? '#D97706' : '#888'} />
            <RowKV k="Visitas completadas (mes)" v={String(completadasMes.length)} />
            <RowKV k="Visitas pendientes / vencidas" v={String(pendientesVisita.length)} color={pendientesVisita.length ? '#D97706' : '#888'} />
            <RowKV k="Garantías por vencer (60d)" v={String(garantiasPorVencer.length)} color={garantiasPorVencer.length ? '#D97706' : '#888'} />
          </div>
        </DashCard>
      </div>
    </div>
  )
}

function RowKV({ k, v, color = '#fff' }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid #1c1c1c' }}>
      <span style={{ color: '#888' }}>{k}</span>
      <span style={{ color, fontWeight: 700 }}>{v}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: PROPIEDADES
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// TAB: REPORTES (levantamientos del técnico en sitio)
// ═══════════════════════════════════════════════════════════════════════════

const VISIT_KIND_CFG: Record<string, { label: string; color: string }> = {
  preventiva: { label: 'Preventiva', color: '#10B981' },
  emergencia: { label: 'Bomberazo', color: '#f59e0b' },
  bomberazo: { label: 'Bomberazo', color: '#f59e0b' },
  garantia: { label: 'Garantía', color: '#3b82f6' },
  otro: { label: 'Otro', color: '#888' },
}

function hasReport(v: Visit): boolean {
  return v.status === 'completada'
    || (Array.isArray(v.photos) && v.photos.length > 0)
    || !!(v.work_performed && v.work_performed.trim())
    || !!(v.report && (v.report.observaciones || v.report.recomendacion))
}

function TabReportes({ visits, propMap, techMap, isMobile }: {
  visits: Visit[]; propMap: Record<string, Property>; techMap: Record<string, Technician>; isMobile: boolean
}) {
  const [search, setSearch] = useState('')
  const [techFilter, setTechFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [selected, setSelected] = useState<Visit | null>(null)

  const reportes = useMemo(() => {
    let list = visits.filter(hasReport)
    if (techFilter) list = list.filter(v => v.technician_id === techFilter)
    if (kindFilter) list = list.filter(v => (v as any).visit_kind === kindFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(v => (propMap[v.property_id]?.name || '').toLowerCase().includes(q) || (v.work_performed || '').toLowerCase().includes(q))
    }
    return list.sort((a, b) => (b.completed_at || b.visit_date || '').localeCompare(a.completed_at || a.visit_date || ''))
  }, [visits, search, techFilter, kindFilter, propMap])

  const techsWithReports = useMemo(() => {
    const ids = new Set(visits.filter(hasReport).map(v => v.technician_id).filter(Boolean) as string[])
    return Array.from(ids).map(id => techMap[id]).filter(Boolean)
  }, [visits, techMap])

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#555' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar propiedad o trabajo realizado..." style={{ ...inputStyle, paddingLeft: 30 }} />
        </div>
        <select value={kindFilter} onChange={e => setKindFilter(e.target.value)} style={{ ...selectStyle, maxWidth: 170 }}>
          <option value="">Todos los tipos</option>
          <option value="preventiva">Preventiva</option>
          <option value="emergencia">Bomberazo</option>
          <option value="garantia">Garantía</option>
          <option value="otro">Otro</option>
        </select>
        <select value={techFilter} onChange={e => setTechFilter(e.target.value)} style={{ ...selectStyle, maxWidth: 200 }}>
          <option value="">Todos los técnicos</option>
          {techsWithReports.map(t => <option key={t.id} value={t.id}>{techName(t)}</option>)}
        </select>
      </div>

      {reportes.length === 0 ? (
        <EmptyState message="No hay reportes aún. Aparecen aquí cuando el técnico completa una visita en la app de campo." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {reportes.map(v => {
            const prop = propMap[v.property_id]
            const tech = v.technician_id ? techMap[v.technician_id] : null
            const kind = VISIT_KIND_CFG[(v as any).visit_kind] || VISIT_KIND_CFG.otro
            const nPhotos = Array.isArray(v.photos) ? v.photos.length : 0
            return (
              <button key={v.id} onClick={() => setSelected(v)} style={{
                textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer',
                background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 14, color: '#fff',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prop?.name || 'Propiedad'}</div>
                  <Badge label={kind.label} color={kind.color} />
                </div>
                <div style={{ fontSize: 11, color: '#888', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span>{formatDate(v.completed_at || v.visit_date)}</span>
                  {tech && <span>· {techName(tech)}</span>}
                  {nPhotos > 0 && <span style={{ color: '#06b6d4' }}>· {nPhotos} 📷</span>}
                  {v.billable && <span style={{ color: '#f59e0b' }}>· facturable</span>}
                </div>
                {v.work_performed && <div style={{ fontSize: 12, color: '#bbb', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{v.work_performed}</div>}
                {v.report?.recomendacion && (
                  <div style={{ fontSize: 11, color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 4 }}>★ Oportunidad detectada</div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {selected && (
        <VisitReportModal visit={selected} property={propMap[selected.property_id]} tech={selected.technician_id ? techMap[selected.technician_id] : null} onClose={() => setSelected(null)} />
      )}
    </>
  )
}

function VisitReportModal({ visit, property, tech, onClose }: {
  visit: Visit; property?: Property; tech?: Technician | null; onClose: () => void
}) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    (async () => {
      const paths = Array.isArray(visit.photos) ? visit.photos : []
      if (paths.length === 0) return
      const { data } = await supabase.storage.from('mantenimiento-evidencias').createSignedUrls(paths, 3600)
      setUrls((data || []).map((d: any) => d.signedUrl).filter(Boolean))
    })()
  }, [visit.id])

  const kind = VISIT_KIND_CFG[(visit as any).visit_kind] || VISIT_KIND_CFG.otro
  const mapsUrl = visit.checkin_lat && visit.checkin_lng ? `https://www.google.com/maps/search/?api=1&query=${visit.checkin_lat},${visit.checkin_lng}` : null

  return (
    <ModalShell title={`Reporte — ${property?.name || 'Visita'}`} onClose={onClose} width={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: '#888' }}>
          <Badge label={kind.label} color={kind.color} />
          <span>{formatDate(visit.completed_at || visit.visit_date)}</span>
          {tech && <span>· Técnico: {techName(tech)}</span>}
          {visit.duration_hours && <span>· {visit.duration_hours} h</span>}
          {visit.billable && <span style={{ color: '#f59e0b' }}>· Facturable {visit.amount_charged ? F(visit.amount_charged) : ''}</span>}
        </div>

        {/* Fotos */}
        {Array.isArray(visit.photos) && visit.photos.length > 0 && (
          <div>
            <div style={infoLabel}>Evidencia fotográfica ({visit.photos.length})</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
              {urls.length === 0
                ? <div style={{ fontSize: 12, color: '#666' }}>Cargando fotos...</div>
                : urls.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer" style={{ display: 'block', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: '#0f0f0f' }}>
                    <img src={u} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={`evidencia ${i + 1}`} />
                  </a>
                ))}
            </div>
          </div>
        )}

        <ReportField label="Trabajo realizado" value={visit.work_performed} />
        <ReportField label="Refacciones / material usado" value={visit.parts_used} />
        <ReportField label="Observaciones / levantamiento" value={visit.report?.observaciones} />
        {visit.report?.recomendacion && (
          <div>
            <div style={{ ...infoLabel, color: '#a78bfa' }}>★ Recomendación de venta</div>
            <div style={{ fontSize: 13, color: '#ddd', lineHeight: 1.5, background: '#1a1530', border: '1px solid #2a2045', borderRadius: 8, padding: 12 }}>{visit.report.recomendacion}</div>
          </div>
        )}

        {/* Trazabilidad */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: '#666', borderTop: '1px solid #222', paddingTop: 12 }}>
          {visit.en_route_at && <span>En camino: {new Date(visit.en_route_at).toLocaleString('es-MX')}</span>}
          {visit.arrived_at && <span>Llegada: {new Date(visit.arrived_at).toLocaleString('es-MX')}</span>}
          {visit.completed_at && <span>Completada: {new Date(visit.completed_at).toLocaleString('es-MX')}</span>}
          {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer" style={{ color: '#3b82f6', textDecoration: 'none' }}>📍 Ubicación de check-in</a>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Btn onClick={onClose}>Cerrar</Btn>
        </div>
      </div>
    </ModalShell>
  )
}

const infoLabel: React.CSSProperties = { fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }
function ReportField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || !value.trim()) return null
  return (
    <div>
      <div style={infoLabel}>{label}</div>
      <div style={{ fontSize: 13, color: '#ddd', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  )
}

function TabPropiedades({ properties, tickets, visits, searchProp, setSearchProp, onSelect, onNew, onFromLead, isMobile, openTicketsForProperty, lastVisitForProperty }: {
  properties: Property[]; tickets: TicketRow[]; visits: Visit[]
  searchProp: string; setSearchProp: (v: string) => void
  onSelect: (id: string) => void; onNew: () => void; onFromLead: () => void; isMobile: boolean
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
        <Btn onClick={onFromLead}><Users size={14} /> Desde lead</Btn>
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

function VisitBucket({ used, included, label, color }: { used: number; included: number; label: string; color: string }) {
  const remaining = Math.max(0, (included || 0) - (used || 0))
  const exhausted = included > 0 && used >= included
  const fillPct = included > 0 ? Math.min(100, (used / included) * 100) : 0
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
        <span style={{ color: '#888' }}>{label}</span>
        <span style={{ color: exhausted ? '#DC2626' : '#ccc', fontWeight: 600 }}>{remaining} rest.</span>
      </div>
      <div style={{ height: 5, background: '#1f1f1f', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${fillPct}%`, height: '100%', background: exhausted ? '#DC2626' : color }} />
      </div>
      <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>{used}/{included} usadas</div>
    </div>
  )
}

function TabPolizas({ contracts, propMap, onNew, onGenerar, isMobile }: {
  contracts: Contract[]; propMap: Record<string, Property>; onNew: () => void; onGenerar: () => void; isMobile: boolean
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

  const active = contracts.filter(c => c.is_active && !isExpired(c))
  const mrrMXN = active.reduce((s, c) => s + (c.currency !== 'USD' ? (c.monthly_fee || (c.annual_fee || 0) / 12) : 0), 0)
  const mrrUSD = active.reduce((s, c) => s + (c.currency === 'USD' ? (c.monthly_fee || (c.annual_fee || 0) / 12) : 0), 0)
  const alertas = contracts.filter(c => isExpired(c) || isExpiringSoon(c)
    || (c.is_active && c.preventive_visits_included > 0 && c.preventive_visits_used >= c.preventive_visits_included)
    || (c.is_active && c.emergency_visits_included > 0 && c.emergency_visits_used >= c.emergency_visits_included)).length

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Pólizas activas" value={String(active.length)} icon={<Shield size={16} />} />
        <KpiCard label="Ingreso recurrente MXN" value={`${F(mrrMXN)}/mes`} color="#2563EB" icon={<DollarSign size={16} />} />
        {mrrUSD > 0 && <KpiCard label="Ingreso recurrente USD" value={`$${Math.round(mrrUSD).toLocaleString('en-US')}/mes`} color="#10B981" icon={<DollarSign size={16} />} />}
        <KpiCard label="Alertas" value={String(alertas)} color={alertas > 0 ? '#D97706' : '#6B7280'} icon={<AlertTriangle size={16} />} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 14, color: '#888' }}>{contracts.length} pólizas registradas</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={onNew}><Plus size={14} /> Manual</Btn>
          <Btn variant="primary" onClick={onGenerar}><FileText size={14} /> Generar póliza</Btn>
        </div>
      </div>

      {contracts.length === 0 ? <EmptyState message="No hay pólizas. Usa 'Generar póliza' para crear una con la calculadora." /> : (
        <Table>
          <thead>
            <tr>
              <Th>Propiedad</Th>
              <Th>Plan</Th>
              {!isMobile && <Th>Vigencia</Th>}
              <Th>Cuota</Th>
              <Th>Preventivas</Th>
              <Th>Bomberazos</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {contracts.map(c => {
              const prop = propMap[c.property_id]
              const expired = isExpired(c)
              const expiringSoon = isExpiringSoon(c)
              const fee = c.monthly_fee ? `${F(c.monthly_fee)}/mes` : c.annual_fee ? `${F(c.annual_fee)}/año` : '--'
              const tier = c.plan_tier ? TIER_CFG[c.plan_tier] : null
              return (
                <tr key={c.id}
                  style={{ background: expiringSoon ? '#D9770608' : expired ? '#DC262608' : 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
                  onMouseLeave={e => (e.currentTarget.style.background = expiringSoon ? '#D9770608' : expired ? '#DC262608' : 'transparent')}>
                  <Td>{prop?.name || '--'}</Td>
                  <Td>
                    {tier ? <Badge label={tier.label} color={tier.color} /> : <span style={{ fontSize: 12, color: '#fff' }}>{c.name}</span>}
                    <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{c.payment_plan || c.contract_type}</div>
                  </Td>
                  {!isMobile && (
                    <Td muted>{c.start_date ? formatDate(c.start_date) : '--'} — {c.end_date ? formatDate(c.end_date) : '--'}</Td>
                  )}
                  <Td>{fee}</Td>
                  <Td><VisitBucket used={c.preventive_visits_used} included={c.preventive_visits_included} label="Preventivas" color="#10B981" /></Td>
                  <Td><VisitBucket used={c.emergency_visits_used} included={c.emergency_visits_included} label="Bomberazos" color="#f59e0b" /></Td>
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
  const [showQuote, setShowQuote] = useState(false)

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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{upsell.title}</div>
          <div style={{ fontSize: 13, color: '#888' }}>{property?.name || '--'}</div>
        </div>
        {property && <Btn variant="primary" onClick={() => setShowQuote(true)}><FileText size={14} /> Crear cotización</Btn>}
      </div>

      {showQuote && property && (
        <QuoteEditorModal
          properties={[{ id: property.id, name: property.name, client_name: property.client_name, address: property.address, city: property.city, client_phone: property.client_phone }]}
          prefill={{ property_id: property.id, upsell_id: upsell.id, title: upsell.title }}
          onClose={() => setShowQuote(false)}
          onSaved={() => { setShowQuote(false); onReload() }}
        />
      )}

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
// MODAL: EQUIPO DE CAMPO (quién ve la sección de Mantenimiento en la app)
// ═══════════════════════════════════════════════════════════════════════════

interface EmpRow { id: string; nombre: string | null; name: string | null; area: string | null; foto_url: string | null; mantenimiento_app: boolean | null; app_activo: boolean | null }

function EquipoCampoModal({ onClose, onUpdated }: { onClose: () => void; onUpdated: () => void }) {
  const [emps, setEmps] = useState<EmpRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dirty, setDirty] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('employees')
      .select('id, nombre, name, area, foto_url, mantenimiento_app, app_activo')
      .eq('activo', true).order('nombre')
    setEmps((data as EmpRow[]) || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function toggle(id: string, val: boolean) {
    setEmps(es => es.map(e => e.id === id ? { ...e, mantenimiento_app: val } : e))
    setDirty(true)
    await supabase.from('employees').update({ mantenimiento_app: val }).eq('id', id)
  }

  function close() { if (dirty) onUpdated(); onClose() }

  const filtered = emps.filter(e => {
    if (!search) return true
    const q = search.toLowerCase()
    return (e.nombre || e.name || '').toLowerCase().includes(q) || (e.area || '').toLowerCase().includes(q)
  })
  const activos = emps.filter(e => e.mantenimiento_app).length

  return (
    <ModalShell title="Equipo de campo · Mantenimiento" onClose={close} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12, color: '#888' }}>
          Solo los empleados activados aquí verán la sección de visitas de Mantenimiento en la app de campo y podrán recibir visitas asignadas. <b style={{ color: '#10B981' }}>{activos}</b> con acceso.
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar empleado..." style={inputStyle} />
        {loading ? <Loading /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {filtered.map(e => {
              const on = !!e.mantenimiento_app
              return (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 15, background: '#1a1a1a', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#888' }}>
                    {e.foto_url ? <img src={e.foto_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : (e.nombre || e.name || '?').slice(0, 1)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.nombre || e.name || 'Empleado'}</div>
                    <div style={{ fontSize: 10, color: '#666' }}>
                      {e.area || 'Sin área'}{on && !e.app_activo ? ' · ⚠ sin acceso app' : ''}
                    </div>
                  </div>
                  <button onClick={() => toggle(e.id, !on)} style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative',
                    background: on ? '#10B981' : '#333', transition: 'background 0.15s', flexShrink: 0,
                  }}>
                    <span style={{ position: 'absolute', top: 2, left: on ? 22 : 2, width: 20, height: 20, borderRadius: 10, background: '#fff', transition: 'left 0.15s' }} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Btn variant="primary" onClick={close}>Listo</Btn>
        </div>
      </div>
    </ModalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL: CREAR PROPIEDAD DESDE LEAD
// ═══════════════════════════════════════════════════════════════════════════

interface LeadOpt {
  id: string; name: string | null; company: string | null
  contact_name: string | null; contact_phone: string | null; contact_email: string | null
  project_id: string | null; status: string | null
}
interface QuotOpt { id: string; name: string | null; specialty: string | null; total: number | null; stage: string | null }

function CreateFromLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [leads, setLeads] = useState<LeadOpt[]>([])
  const [search, setSearch] = useState('')
  const [leadId, setLeadId] = useState('')
  const [quots, setQuots] = useState<QuotOpt[]>([])
  const [quotId, setQuotId] = useState('')
  const [loadingQuots, setLoadingQuots] = useState(false)
  const [form, setForm] = useState({
    name: '', client_name: '', client_phone: '', client_email: '',
    address: '', city: '', notes: '', contract_type: 'por_visita' as 'poliza' | 'por_visita',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const s = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    supabase.from('leads')
      .select('id, name, company, contact_name, contact_phone, contact_email, project_id, status')
      .order('status', { ascending: true }).order('name', { ascending: true })
      .then(({ data }) => setLeads((data as LeadOpt[]) || []))
  }, [])

  const lead = leads.find(l => l.id === leadId)

  async function selectLead(id: string) {
    setLeadId(id)
    setQuotId('')
    const l = leads.find(x => x.id === id)
    if (!l) return
    setForm({
      name: l.name || l.company || '',
      client_name: l.contact_name || l.company || l.name || '',
      client_phone: l.contact_phone || '',
      client_email: l.contact_email || '',
      address: '', city: '', notes: `Importada del lead ${l.name || l.company || ''}.`.trim(),
      contract_type: 'por_visita',
    })
    // Buscar cotizaciones relacionadas (por project_id o por lead_id en notes)
    setLoadingQuots(true)
    const found = new Map<string, QuotOpt>()
    if (l.project_id) {
      const { data } = await supabase.from('quotations').select('id, name, specialty, total, stage').eq('project_id', l.project_id)
      ;(data || []).forEach((q: any) => found.set(q.id, q))
    }
    const { data: byNotes } = await supabase.from('quotations').select('id, name, specialty, total, stage').ilike('notes', `%${id}%`).limit(20)
    ;(byNotes || []).forEach((q: any) => found.set(q.id, q))
    const list = Array.from(found.values())
    setQuots(list)
    if (list.length === 1) setQuotId(list[0].id)
    setLoadingQuots(false)
  }

  async function save() {
    if (!leadId) { setError('Selecciona un lead'); return }
    if (!form.name.trim()) { setError('El nombre de la propiedad es requerido'); return }
    setSaving(true); setError('')
    let phone = form.client_phone.trim()
    if (phone && !phone.startsWith('+')) phone = '+' + phone.replace(/[^0-9]/g, '')
    const { data: prop, error: err } = await supabase.from('maintenance_properties').insert({
      name: form.name.trim(),
      client_name: form.client_name.trim(),
      client_phone: phone,
      client_email: form.client_email.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      notes: form.notes.trim(),
      contract_type: form.contract_type,
      original_quotation_id: quotId || null,
      is_active: true,
    }).select('id').single()
    if (err) { setSaving(false); setError(err.message); return }

    // Crear contacto desde el lead (llave para identificar quien escribe)
    if (prop && (form.client_name.trim() || phone)) {
      await supabase.from('maintenance_contacts').insert({
        property_id: prop.id,
        name: form.client_name.trim() || 'Cliente',
        phone_e164: phone || null,
        email: form.client_email.trim() || null,
        role: 'dueño',
        is_primary: true,
      })
    }
    // Sembrar equipos desde la cotización si se ligó una
    if (prop && quotId) {
      await supabase.rpc('seed_maintenance_equipment_from_quotation', { p_property_id: prop.id, p_quotation_id: quotId }).catch(() => {})
    }
    setSaving(false)
    onCreated()
  }

  const filteredLeads = useMemo(() => {
    if (!search) return leads.slice(0, 200)
    const q = search.toLowerCase()
    return leads.filter(l =>
      (l.name || '').toLowerCase().includes(q) ||
      (l.company || '').toLowerCase().includes(q) ||
      (l.contact_name || '').toLowerCase().includes(q)
    ).slice(0, 200)
  }, [leads, search])

  return (
    <ModalShell title="Crear propiedad desde lead" onClose={onClose} width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>Buscar lead</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nombre, despacho o contacto..."
            style={{ ...inputStyle, marginTop: 4, marginBottom: 8 }} />
          <select value={leadId} onChange={e => selectLead(e.target.value)} style={selectStyle} size={1}>
            <option value="">Selecciona un lead ({leads.length})...</option>
            {filteredLeads.map(l => (
              <option key={l.id} value={l.id}>
                {(l.name || l.company || 'Lead')}{l.contact_name ? ` — ${l.contact_name}` : ''}{l.status ? ` · ${l.status}` : ''}
              </option>
            ))}
          </select>
        </div>

        {lead && (
          <>
            <div style={{ height: 1, background: '#222' }} />
            <Field label="Nombre de la propiedad *" value={form.name} onChange={s('name')} placeholder="Ej: Residencia Los Olivos" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Cliente" value={form.client_name} onChange={s('client_name')} />
              <Field label="Teléfono (WhatsApp)" value={form.client_phone} onChange={s('client_phone')} placeholder="+52..." />
            </div>
            <Field label="Email" value={form.client_email} onChange={s('client_email')} />
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <Field label="Dirección" value={form.address} onChange={s('address')} placeholder="Calle y número" />
              <Field label="Ciudad" value={form.city} onChange={s('city')} placeholder="Ciudad" />
            </div>

            <div>
              <label style={labelStyle}>
                Cotización original {loadingQuots && <span style={{ color: '#555' }}>· buscando...</span>}
              </label>
              {quots.length === 0 ? (
                <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                  {loadingQuots ? 'Buscando cotizaciones del lead...' : 'No se encontraron cotizaciones ligadas. Podrás ligarlas y sembrar equipos después desde el expediente.'}
                </div>
              ) : (
                <select value={quotId} onChange={e => setQuotId(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
                  <option value="">Sin ligar (no sembrar equipos)</option>
                  {quots.map(q => (
                    <option key={q.id} value={q.id}>{q.name || 'Cotización'}{q.specialty ? ` · ${q.specialty}` : ''}{q.total ? ` · ${F(q.total)}` : ''}</option>
                  ))}
                </select>
              )}
              {quotId && <div style={{ fontSize: 11, color: '#10B981', marginTop: 4 }}>Se sembrarán los equipos de esta cotización (sin precios).</div>}
            </div>

            <div>
              <label style={labelStyle}>Tipo de contrato</label>
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                {(['poliza', 'por_visita'] as const).map(ct => {
                  const cfg = CONTRACT_TYPE_CFG[ct]
                  const active = form.contract_type === ct
                  return (
                    <button key={ct} onClick={() => setForm(f => ({ ...f, contract_type: ct }))} style={{
                      padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                      fontWeight: active ? 600 : 400, border: `1px solid ${active ? cfg.color : '#333'}`,
                      background: active ? cfg.color + '22' : 'transparent', color: active ? cfg.color : '#666',
                    }}>{cfg.label}</button>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {error && <div style={{ color: '#DC2626', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={save} disabled={saving || !lead}>{saving ? 'Creando...' : 'Crear propiedad'}</Btn>
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

function TabAgenda({ visits, propMap, techMap, onOpenProperty, onSchedule, onEquipo, isMobile }: {
  visits: Visit[]
  propMap: Record<string, Property>
  techMap: Record<string, Technician>
  onOpenProperty: (id: string) => void
  onSchedule: () => void
  onEquipo: () => void
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
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={onEquipo}><Users size={14} /> Equipo</Btn>
          <Btn variant="primary" onClick={onSchedule}><Plus size={14} /> Programar visita</Btn>
        </div>
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
    scheduled_time: '09:00', route_order: '', notes: '', visit_kind: 'preventiva',
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
      visit_kind: form.visit_kind,
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
            {technicians.filter(t => t.mantenimiento_app).map(t => <option key={t.id} value={t.id}>{techName(t)}{t.area ? ` (${t.area})` : ''}</option>)}
          </select>
          {technicians.filter(t => t.mantenimiento_app).length === 0 && (
            <span style={{ fontSize: 10, color: '#D97706', marginTop: 4 }}>Nadie tiene acceso a Mantenimiento aún. Actívalos en "Equipo" (tab Agenda).</span>
          )}
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

        <label style={labelStyle}>
          Tipo de visita
          <select value={form.visit_kind} onChange={e => set('visit_kind')(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
            <option value="preventiva">Preventiva (limpieza / actualización)</option>
            <option value="emergencia">Bomberazo / emergencia</option>
            <option value="garantia">Garantía</option>
            <option value="otro">Otro</option>
          </select>
        </label>

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
    status: 'programada' as string, visit_kind: 'preventiva',
  })
  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('employees').select('id, nombre, name, area, foto_url, activo, mantenimiento_app').eq('activo', true).eq('mantenimiento_app', true).order('nombre')
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
      visit_kind: form.visit_kind,
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

    // Si la visita quedó completada y tiene póliza, descontar la cubeta correcta
    if (form.status === 'completada' && contractId) {
      await supabase.rpc('increment_contract_visit', { p_contract_id: contractId, p_kind: form.visit_kind }).catch(() => {})
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

        <label style={labelStyle}>
          Tipo de visita
          <select value={form.visit_kind} onChange={e => s('visit_kind')(e.target.value)} style={{ ...selectStyle, marginTop: 4 }}>
            <option value="preventiva">Preventiva (limpieza / actualización)</option>
            <option value="emergencia">Bomberazo / emergencia</option>
            <option value="garantia">Garantía</option>
            <option value="otro">Otro</option>
          </select>
        </label>

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
