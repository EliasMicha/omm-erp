import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Loading, Badge, SectionHeader } from '../components/layout/UI'
import {
  ArrowLeft, FileText, DollarSign, ShoppingCart, Briefcase,
  HardHat, AlertTriangle, ChevronDown, ChevronRight, ExternalLink,
  CheckCircle2, Clock, XCircle, TrendingUp, Package, BarChart3
} from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════
const F = (n: number) => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const PCT = (n: number) => (n * 100).toFixed(1) + '%'

const STAGE_COLORS: Record<string, string> = {
  oportunidad: '#F59E0B', cotizando: '#3B82F6', negociacion: '#C084FC',
  contrato: '#57FF9A', perdido: '#EF4444', pausado: '#6B7280',
}
const STAGE_LABELS: Record<string, string> = {
  oportunidad: 'Oportunidad', cotizando: 'Cotizando', negociacion: 'Negociación',
  contrato: 'Contrato', perdido: 'Perdido', pausado: 'Pausado',
}
const PO_STATUS_COLOR: Record<string, string> = {
  borrador: '#6B7280', enviada: '#3B82F6', confirmada: '#57FF9A',
  entregada: '#34D399', cancelada: '#EF4444',
}
const MILESTONE_COLOR: Record<string, string> = {
  pendiente: '#F59E0B', vigente: '#3B82F6', cobrado: '#57FF9A', vencido: '#EF4444',
}
const TASK_STATUS_ICON: Record<string, React.ReactNode> = {
  pendiente: <Clock size={12} color="#F59E0B" />,
  en_progreso: <BarChart3 size={12} color="#3B82F6" />,
  completada: <CheckCircle2 size={12} color="#57FF9A" />,
  bloqueada: <XCircle size={12} color="#EF4444" />,
}
const BLOQUEO_SEV_COLOR: Record<string, string> = {
  baja: '#F59E0B', media: '#F97316', alta: '#EF4444', critica: '#DC2626',
}

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function LeadDashboard() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [lead, setLead] = useState<any>(null)
  const [quotations, setQuotations] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [pos, setPos] = useState<any[]>([])
  const [milestones, setMilestones] = useState<any[]>([])
  const [obras, setObras] = useState<any[]>([])
  const [obraActividades, setObraActividades] = useState<any[]>([])
  const [obraBloqueos, setObraBloqueos] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [phases, setPhases] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [quotItems, setQuotItems] = useState<any[]>([])
  const [tipoCambio] = useState(20.50)

  // Collapsible sections
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    cotizaciones: true, estado: true, compras: true, proyectos: true, obra: true, bloqueos: true,
  })
  const toggle = (k: string) => setExpanded(p => ({ ...p, [k]: !p[k] }))

  useEffect(() => { if (id) load() }, [id])

  async function load() {
    setLoading(true)
    // 1. Lead
    const { data: leadData } = await supabase.from('leads').select('*').eq('id', id!).single()
    setLead(leadData)
    if (!leadData) { setLoading(false); return }

    // 2. All quotations — filter by lead_id in notes JSON
    const { data: allQuots } = await supabase.from('quotations').select('*')
    const leadQuots = (allQuots || []).filter(q => {
      try {
        const n = typeof q.notes === 'string' ? JSON.parse(q.notes) : q.notes
        return n?.lead_id === id
      } catch { return false }
    })
    setQuotations(leadQuots)
    const quotIds = new Set(leadQuots.map(q => q.id))

    // 3. Projects linked via lead_id OR cotizacion_id
    const { data: allProjects } = await supabase.from('projects').select('*')
    const leadProjects = (allProjects || []).filter(p =>
      p.lead_id === id || (p.cotizacion_id && quotIds.has(p.cotizacion_id))
    )
    setProjects(leadProjects)
    const projIds = new Set(leadProjects.map(p => p.id))

    // 4. Parallel: POs, milestones, obras, tasks, phases, employees, quotation items
    const [posRes, msRes, obrasRes, tasksRes, phasesRes, empRes, qiRes] = await Promise.all([
      supabase.from('purchase_orders').select('*').in('project_id', [...projIds]),
      supabase.from('payment_milestones').select('*').in('project_id', [...projIds]),
      supabase.from('obras').select('*').in('project_id', [...projIds]),
      supabase.from('project_tasks').select('*').in('project_id', [...projIds]),
      supabase.from('project_phases').select('*').in('project_id', [...projIds]),
      supabase.from('employees').select('id,nombre,area').eq('activo', true),
      supabase.from('quotation_items').select('*').in('quotation_id', [...quotIds]),
    ])
    setPos(posRes.data || [])
    setMilestones(msRes.data || [])
    setEmployees(empRes.data || [])
    setQuotItems(qiRes.data || [])
    setTasks(tasksRes.data || [])
    setPhases(phasesRes.data || [])

    const obrasList = obrasRes.data || []
    setObras(obrasList)

    // 5. Obra actividades & bloqueos
    if (obrasList.length > 0) {
      const obraIds = obrasList.map(o => o.id)
      const [actRes, bloqRes] = await Promise.all([
        supabase.from('obra_actividades').select('*').in('obra_id', obraIds),
        supabase.from('obra_bloqueos').select('*').in('obra_id', obraIds),
      ])
      setObraActividades(actRes.data || [])
      setObraBloqueos(bloqRes.data || [])
    }

    setLoading(false)
  }

  // ── COMPUTED ──────────────────────────────────────────────────
  const getQuotCurrency = (q: any): 'USD' | 'MXN' => {
    try {
      const n = typeof q.notes === 'string' ? JSON.parse(q.notes) : q.notes
      return n?.currency === 'MXN' ? 'MXN' : 'USD'
    } catch { return 'USD' }
  }

  const toMXN = (amount: number, currency: string) =>
    currency === 'USD' ? amount * tipoCambio : amount

  // Financial summary
  const financials = useMemo(() => {
    const contratos = quotations.filter(q => q.stage === 'contrato')
    let totalVendido = 0
    contratos.forEach(q => {
      const proj = projects.find(p => p.cotizacion_id === q.id)
      const amount = proj ? (proj.contract_value || 0) : (q.total || 0)
      totalVendido += toMXN(amount, getQuotCurrency(q))
    })

    const totalCobrado = milestones
      .filter(m => m.status === 'cobrado')
      .reduce((s, m) => s + (m.amount || 0), 0)

    let totalComprado = 0
    pos.filter(po => po.status !== 'cancelada').forEach(po => {
      totalComprado += toMXN(po.total || 0, po.currency || 'MXN')
    })

    const totalCompras = quotItems.reduce((s, qi) => s + ((qi.cost || 0) * (qi.quantity || 0)), 0)
    const porCobrar = Math.max(0, totalVendido - totalCobrado)
    const porComprar = Math.max(0, totalCompras - totalComprado)

    return { totalVendido, totalCobrado, totalComprado, totalCompras, porCobrar, porComprar }
  }, [quotations, projects, milestones, pos, quotItems, tipoCambio])

  // Bloqueos automáticos
  const autoBloqueos = useMemo(() => {
    const list: { tipo: string; descripcion: string; severidad: string; fuente: string }[] = []

    // Cobranza: cobrado < gastado = alerta
    if (financials.totalCobrado < financials.totalComprado && financials.totalComprado > 0) {
      list.push({
        tipo: 'Cobranza', severidad: 'alta',
        descripcion: `Cobrado (${F(financials.totalCobrado)}) es menor a lo comprado (${F(financials.totalComprado)})`,
        fuente: 'Estado de cuenta',
      })
    }

    // Milestones vencidos
    const vencidos = milestones.filter(m => m.status === 'vencido')
    if (vencidos.length > 0) {
      const montoVencido = vencidos.reduce((s, m) => s + (m.amount || 0), 0)
      list.push({
        tipo: 'Cobranza', severidad: 'alta',
        descripcion: `${vencidos.length} cobro(s) vencido(s) por ${F(montoVencido)}`,
        fuente: 'Milestones',
      })
    }

    // Cotizaciones pendientes sin decisión (más de 15 días en oportunidad/cotizando)
    const now = new Date()
    quotations.filter(q => q.stage === 'oportunidad' || q.stage === 'cotizando').forEach(q => {
      const created = new Date(q.created_at)
      const days = Math.floor((now.getTime() - created.getTime()) / 86400000)
      if (days > 15) {
        list.push({
          tipo: 'Decisión cliente', severidad: 'media',
          descripcion: `"${q.name}" lleva ${days} días sin aprobación`,
          fuente: 'Cotizaciones',
        })
      }
    })

    // POs sin confirmar por más de 7 días
    pos.filter(po => po.status === 'enviada').forEach(po => {
      const created = new Date(po.created_at)
      const days = Math.floor((now.getTime() - created.getTime()) / 86400000)
      if (days > 7) {
        list.push({
          tipo: 'Compras', severidad: 'baja',
          descripcion: `PO ${po.po_number} enviada hace ${days} días sin confirmar`,
          fuente: 'Compras',
        })
      }
    })

    // Tareas bloqueadas en proyecto
    tasks.filter(t => t.status === 'bloqueada').forEach(t => {
      list.push({
        tipo: 'Proyecto', severidad: 'media',
        descripcion: `Tarea bloqueada: "${t.name}"${t.notes ? ' — ' + t.notes : ''}`,
        fuente: 'Proyecto',
      })
    })

    return list
  }, [financials, milestones, quotations, pos, tasks])

  // All bloqueos: obra_bloqueos (manual from obra) + auto-detected
  const allBloqueos = useMemo(() => {
    const manual = obraBloqueos.map(b => ({
      tipo: b.tipo || 'Obra',
      descripcion: b.descripcion,
      severidad: b.severidad || 'media',
      fuente: 'Obra',
      status: b.status,
      fecha: b.fecha_reporte,
    }))
    const auto = autoBloqueos.map(b => ({ ...b, status: 'activo', fecha: null }))
    return [...auto, ...manual.filter(b => b.status !== 'resuelto')]
  }, [obraBloqueos, autoBloqueos])

  // ── RENDER ────────────────────────────────────────────────────
  if (loading) return <Loading />
  if (!lead) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#555' }}>
      <div style={{ fontSize: 18, marginBottom: 12 }}>Lead no encontrado</div>
      <button onClick={() => navigate('/crm')} style={linkBtnS}>← Volver a CRM</button>
    </div>
  )

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate('/crm')} style={{ ...linkBtnS, padding: '6px 10px' }}>
          <ArrowLeft size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{lead.name}</div>
          <div style={{ fontSize: 13, color: '#666' }}>
            {lead.company && <span>{lead.company} · </span>}
            {lead.contact_name && <span>{lead.contact_name} · </span>}
            <Badge label={lead.status} color={lead.status === 'ganado' ? '#57FF9A' : lead.status === 'perdido' ? '#EF4444' : '#3B82F6'} />
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 24 }}>
        <KpiMini label="Total Vendido" value={F(financials.totalVendido)} color="#57FF9A" />
        <KpiMini label="Cobrado" value={F(financials.totalCobrado)} color="#34D399" />
        <KpiMini label="Por Cobrar" value={F(financials.porCobrar)} color={financials.porCobrar > 0 ? '#F59E0B' : '#57FF9A'} />
        <KpiMini label="Comprado" value={F(financials.totalComprado)} color="#3B82F6" />
        <KpiMini label="Por Comprar" value={F(financials.porComprar)} color={financials.porComprar > 0 ? '#F59E0B' : '#57FF9A'} />
        <KpiMini label="Bloqueos" value={String(allBloqueos.length)} color={allBloqueos.length > 0 ? '#EF4444' : '#57FF9A'} />
      </div>

      {/* ══════════ 1. COTIZACIONES ══════════ */}
      <Section title="Cotizaciones" icon={<FileText size={14} />} count={quotations.length} expanded={expanded.cotizaciones} onToggle={() => toggle('cotizaciones')}>
        {quotations.length === 0 ? (
          <Empty text="Sin cotizaciones vinculadas" />
        ) : (
          <table style={tblS}>
            <thead>
              <tr style={trHeadS}>
                <th style={thS}>Nombre</th>
                <th style={thS}>Especialidad</th>
                <th style={thS}>Etapa</th>
                <th style={{ ...thS, textAlign: 'right' }}>Total</th>
                <th style={thS}>Moneda</th>
                <th style={thS}>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {quotations.map(q => {
                const curr = getQuotCurrency(q)
                const sym = curr === 'USD' ? 'US$' : '$'
                return (
                  <tr key={q.id} style={trS}>
                    <td style={tdS}><span style={{ color: '#fff', fontWeight: 500 }}>{q.name}</span></td>
                    <td style={tdS}><Badge label={q.specialty?.toUpperCase() || '—'} color="#555" /></td>
                    <td style={tdS}><Badge label={STAGE_LABELS[q.stage] || q.stage} color={STAGE_COLORS[q.stage] || '#555'} /></td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: q.stage === 'contrato' ? '#57FF9A' : '#888' }}>
                      {sym}{(q.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 0 })}
                    </td>
                    <td style={tdS}>
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: curr === 'USD' ? '#3B82F620' : '#57FF9A20', color: curr === 'USD' ? '#3B82F6' : '#57FF9A' }}>{curr}</span>
                    </td>
                    <td style={{ ...tdS, color: '#555' }}>{q.created_at?.slice(0, 10)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* ══════════ 2. ESTADO DE CUENTA ══════════ */}
      <Section title="Estado de Cuenta" icon={<DollarSign size={14} />} count={milestones.length} expanded={expanded.estado} onToggle={() => toggle('estado')}>
        {/* Summary bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          <MiniStat label="Total vendido" value={F(financials.totalVendido)} accent="#57FF9A" />
          <MiniStat label="Cobrado" value={F(financials.totalCobrado)} accent="#34D399" />
          <MiniStat label="Por cobrar" value={F(financials.porCobrar)} accent="#F59E0B" />
          <MiniStat label="% Cobro" value={financials.totalVendido > 0 ? PCT(financials.totalCobrado / financials.totalVendido) : '—'} accent="#3B82F6" />
        </div>
        {/* Progress bar */}
        {financials.totalVendido > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: '#1a1a1a' }}>
              <div style={{ width: `${Math.min((financials.totalCobrado / financials.totalVendido) * 100, 100)}%`, background: '#57FF9A', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}
        {/* Milestones table */}
        {milestones.length === 0 ? (
          <Empty text="Sin hitos de cobro registrados" />
        ) : (
          <table style={tblS}>
            <thead>
              <tr style={trHeadS}>
                <th style={thS}>Hito</th>
                <th style={thS}>Proyecto</th>
                <th style={thS}>Vencimiento</th>
                <th style={thS}>Estado</th>
                <th style={{ ...thS, textAlign: 'right' }}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {milestones.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).map(m => {
                const proj = projects.find(p => p.id === m.project_id)
                return (
                  <tr key={m.id} style={trS}>
                    <td style={tdS}><span style={{ color: '#fff', fontWeight: 500 }}>{m.name}</span></td>
                    <td style={{ ...tdS, color: '#666', fontSize: 11 }}>{proj?.name || '—'}</td>
                    <td style={{ ...tdS, color: m.status === 'vencido' ? '#EF4444' : '#888' }}>{m.due_date || '—'}</td>
                    <td style={tdS}><Badge label={m.status} color={MILESTONE_COLOR[m.status] || '#555'} /></td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: m.status === 'cobrado' ? '#57FF9A' : '#fff' }}>{F(m.amount || 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {/* Alerta: cobrado < comprado */}
        {financials.totalCobrado < financials.totalComprado && financials.totalComprado > 0 && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#EF444410', border: '1px solid #EF444440', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={14} color="#EF4444" />
            <span style={{ fontSize: 12, color: '#EF4444' }}>Lo cobrado es menor a lo comprado. Diferencia: {F(financials.totalComprado - financials.totalCobrado)}</span>
          </div>
        )}
      </Section>

      {/* ══════════ 3. COMPRAS FALTANTES ══════════ */}
      <Section title="Compras" icon={<ShoppingCart size={14} />} count={pos.length} expanded={expanded.compras} onToggle={() => toggle('compras')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          <MiniStat label="Presupuesto compras" value={F(financials.totalCompras)} accent="#3B82F6" />
          <MiniStat label="Comprado" value={F(financials.totalComprado)} accent="#F59E0B" />
          <MiniStat label="Por comprar" value={F(financials.porComprar)} accent={financials.porComprar > 0 ? '#EF4444' : '#57FF9A'} />
          <MiniStat label="% Avance" value={financials.totalCompras > 0 ? PCT(financials.totalComprado / financials.totalCompras) : '—'} accent="#3B82F6" />
        </div>
        {pos.length === 0 ? (
          <Empty text="Sin órdenes de compra" />
        ) : (
          <table style={tblS}>
            <thead>
              <tr style={trHeadS}>
                <th style={thS}>OC #</th>
                <th style={thS}>Proyecto</th>
                <th style={thS}>Estado</th>
                <th style={thS}>Moneda</th>
                <th style={{ ...thS, textAlign: 'right' }}>Total</th>
                <th style={thS}>Entrega</th>
              </tr>
            </thead>
            <tbody>
              {pos.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map(po => {
                const proj = projects.find(p => p.id === po.project_id)
                const sym = po.currency === 'USD' ? 'US$' : '$'
                return (
                  <tr key={po.id} style={{ ...trS, opacity: po.status === 'cancelada' ? 0.4 : 1 }}>
                    <td style={tdS}><span style={{ color: '#fff', fontWeight: 500 }}>{po.po_number || '—'}</span></td>
                    <td style={{ ...tdS, color: '#666', fontSize: 11 }}>{proj?.name || '—'}</td>
                    <td style={tdS}><Badge label={po.status} color={PO_STATUS_COLOR[po.status] || '#555'} /></td>
                    <td style={tdS}>
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: po.currency === 'USD' ? '#3B82F620' : '#57FF9A20', color: po.currency === 'USD' ? '#3B82F6' : '#57FF9A' }}>{po.currency || 'MXN'}</span>
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: '#fff' }}>{sym}{(po.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 0 })}</td>
                    <td style={{ ...tdS, color: '#888' }}>{po.expected_delivery || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* ══════════ 4. PROYECTOS (DISEÑO) ══════════ */}
      <Section title="Proyectos (Diseño)" icon={<Briefcase size={14} />} count={projects.length} expanded={expanded.proyectos} onToggle={() => toggle('proyectos')}>
        {projects.length === 0 ? (
          <Empty text="Sin proyectos de diseño vinculados" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {projects.map(proj => {
              const projPhases = phases.filter(ph => ph.project_id === proj.id).sort((a, b) => a.order_index - b.order_index)
              const projTasks = tasks.filter(t => t.project_id === proj.id)
              const totalTasks = projTasks.length
              const completedTasks = projTasks.filter(t => t.status === 'completada').length
              const pctAvance = totalTasks > 0 ? completedTasks / totalTasks : 0

              return (
                <div key={proj.id} style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 8, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{proj.name}</div>
                      <div style={{ fontSize: 11, color: '#555' }}>
                        {proj.specialty?.toUpperCase()} · {proj.status} · {F(proj.contract_value || 0)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#57FF9A' }}>{PCT(pctAvance)}</div>
                      <div style={{ fontSize: 10, color: '#555' }}>{completedTasks}/{totalTasks} tareas</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 6, borderRadius: 3, background: '#1a1a1a', marginBottom: 10 }}>
                    <div style={{ width: `${pctAvance * 100}%`, height: '100%', borderRadius: 3, background: '#57FF9A', transition: 'width 0.3s' }} />
                  </div>
                  {/* Phases & tasks */}
                  {projPhases.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {projPhases.map(ph => {
                        const phaseTasks = projTasks.filter(t => t.phase_id === ph.id)
                        const phDone = phaseTasks.filter(t => t.status === 'completada').length
                        return (
                          <div key={ph.id} style={{ padding: '6px 10px', background: '#0a0a0a', borderRadius: 6, border: '1px solid #1a1a1a' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 12, color: '#aaa', fontWeight: 500 }}>{ph.name}</span>
                              <span style={{ fontSize: 10, color: '#555' }}>{phDone}/{phaseTasks.length}</span>
                            </div>
                            {phaseTasks.length > 0 && (
                              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {phaseTasks.map(t => (
                                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#888', padding: '2px 6px', background: '#111', borderRadius: 4 }}>
                                    {TASK_STATUS_ICON[t.status] || <Clock size={10} />}
                                    {t.name}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* ══════════ 5. OBRA (IMPLEMENTACIÓN) ══════════ */}
      <Section title="Obra (Implementación)" icon={<HardHat size={14} />} count={obras.length} expanded={expanded.obra} onToggle={() => toggle('obra')}>
        {obras.length === 0 ? (
          <Empty text="Sin obras de implementación vinculadas" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {obras.map(obra => {
              const acts = obraActividades.filter(a => a.obra_id === obra.id)
              const avgPct = acts.length > 0 ? acts.reduce((s, a) => s + (a.porcentaje || 0), 0) / acts.length : (obra.avance_global || 0)
              return (
                <div key={obra.id} style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 8, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{obra.nombre}</div>
                      <div style={{ fontSize: 11, color: '#555' }}>
                        {obra.status} · {obra.direccion || ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#3B82F6' }}>{Math.round(avgPct)}%</div>
                      <div style={{ fontSize: 10, color: '#555' }}>{acts.length} actividades</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 6, borderRadius: 3, background: '#1a1a1a', marginBottom: 10 }}>
                    <div style={{ width: `${avgPct}%`, height: '100%', borderRadius: 3, background: '#3B82F6', transition: 'width 0.3s' }} />
                  </div>
                  {/* Actividades */}
                  {acts.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {acts.sort((a, b) => (a.order_index || 0) - (b.order_index || 0)).map(a => (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: '#0a0a0a', borderRadius: 4, border: '1px solid #1a1a1a' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: '#aaa' }}>{a.descripcion || a.sistema}</span>
                            {a.area && <span style={{ fontSize: 9, color: '#555' }}>({a.area})</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 40, height: 4, borderRadius: 2, background: '#1a1a1a' }}>
                              <div style={{ width: `${a.porcentaje || 0}%`, height: '100%', borderRadius: 2, background: (a.porcentaje || 0) >= 100 ? '#57FF9A' : '#3B82F6' }} />
                            </div>
                            <span style={{ fontSize: 10, color: '#888', minWidth: 28, textAlign: 'right' }}>{a.porcentaje || 0}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* ══════════ 6. BLOQUEOS ══════════ */}
      <Section title="Bloqueos / Temas a revisar" icon={<AlertTriangle size={14} />} count={allBloqueos.length} expanded={expanded.bloqueos} onToggle={() => toggle('bloqueos')}>
        {allBloqueos.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#57FF9A', fontSize: 13 }}>
            <CheckCircle2 size={20} style={{ verticalAlign: -4, marginRight: 6 }} />
            Sin bloqueos detectados
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {allBloqueos.sort((a, b) => {
              const sev = { critica: 0, alta: 1, media: 2, baja: 3 }
              return (sev[a.severidad as keyof typeof sev] ?? 4) - (sev[b.severidad as keyof typeof sev] ?? 4)
            }).map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: '#111', border: `1px solid ${BLOQUEO_SEV_COLOR[b.severidad] || '#333'}30`, borderRadius: 8, borderLeft: `3px solid ${BLOQUEO_SEV_COLOR[b.severidad] || '#555'}` }}>
                <AlertTriangle size={14} color={BLOQUEO_SEV_COLOR[b.severidad] || '#F59E0B'} style={{ marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: '#fff', fontWeight: 500 }}>{b.descripcion}</div>
                  <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
                    <Badge label={b.tipo} color={BLOQUEO_SEV_COLOR[b.severidad] || '#555'} />
                    <span style={{ marginLeft: 8 }}>Fuente: {b.fuente}</span>
                    <span style={{ marginLeft: 8 }}>Severidad: {b.severidad}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// UI helpers
// ═══════════════════════════════════════════════════════════════════

function Section({ title, icon, count, expanded, onToggle, children }: {
  title: string; icon: React.ReactNode; count: number; expanded: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px',
        background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 13, fontWeight: 600, textAlign: 'left',
      }}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        {title}
        <span style={{ fontSize: 11, color: '#444', fontWeight: 400, marginLeft: 4 }}>({count})</span>
      </button>
      {expanded && <div style={{ padding: '0 18px 16px' }}>{children}</div>}
    </div>
  )
}

function KpiMini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ padding: '8px 10px', background: '#111', borderRadius: 8, border: '1px solid #1a1a1a' }}>
      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: accent, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 16, textAlign: 'center', color: '#444', fontSize: 12 }}>{text}</div>
}

// Styles
const linkBtnS: React.CSSProperties = {
  background: '#111', border: '1px solid #222', borderRadius: 6, color: '#888', cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
}
const tblS: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 }
const trHeadS: React.CSSProperties = { borderBottom: '1px solid #333' }
const trS: React.CSSProperties = { borderBottom: '1px solid #1a1a1a' }
const thS: React.CSSProperties = { padding: '8px 10px', fontSize: 10, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left', whiteSpace: 'nowrap' }
const tdS: React.CSSProperties = { padding: '10px 10px', fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
