import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { F, formatDate } from '../lib/utils'
import { KpiCard, ProgressBar, Badge, Loading, SectionHeader } from '../components/layout/UI'
import { useIsMobile } from '../lib/useIsMobile'
import { useAuth } from '../contexts/AuthContext'
import {
  AlertTriangle, Calendar, DollarSign, Users, FolderOpen, FileText, Clock,
  Target, ChevronDown, ChevronRight, TrendingUp, CreditCard, Briefcase,
  CheckCircle2, UserCheck
} from 'lucide-react'
import ActionItems from '../components/ActionItems'
import CalendarWidget from '../components/CalendarWidget'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface PaymentMilestone {
  id: string
  name: string
  amount: number
  due_date: string | null
  status: string
  paid_at: string | null
  currency: string | null
  project_id: string
  project_name: string
  client_name: string
}

interface Project {
  id: string
  name: string
  client_name: string
  contract_value: number
  advance_pct: number
  status: string
  specialty: string
  start_date: string | null
  end_date_planned: string | null
}

interface Employee {
  id: string
  name: string
  nombre: string | null
  area: string | null
  puesto: string | null
}

interface AreaCount {
  area: string
  count: number
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const card: React.CSSProperties = {
  background: '#111', border: '1px solid #222', borderRadius: 10, padding: '10px 14px',
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const STATUS_COLORS: Record<string, string> = {
  pendiente: '#F59E0B',
  vencido: '#EF4444',
  cobrado: '#57FF9A',
  cancelado: '#666',
}

const STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  vencido: 'Vencido',
  cobrado: 'Cobrado',
  cancelado: 'Cancelado',
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function DashboardAdmin() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const myEmployeeId = authUser?.employee_id

  const [loading, setLoading] = useState(true)
  const [milestones, setMilestones] = useState<PaymentMilestone[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [adminTeam, setAdminTeam] = useState<Employee[]>([])
  const [areaCounts, setAreaCounts] = useState<AreaCount[]>([])
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    cobranza: true, pendientes: true, calendario: true,
    proyectos: true, equipo: true, tareas: true,
  })

  const toggle = (key: string) => setExpandedSections(p => ({ ...p, [key]: !p[key] }))

  // ── LOAD DATA ──
  useEffect(() => {
    async function load() {
      const [milRes, projRes, empRes] = await Promise.all([
        supabase.from('payment_milestones')
          .select('id, name, amount, due_date, status, paid_at, currency, project_id, project:projects(name, client_name)')
          .order('due_date', { ascending: true, nullsFirst: false }),
        supabase.from('projects')
          .select('id, name, client_name, contract_value, advance_pct, status, specialty, start_date, end_date_planned')
          .eq('status', 'activo')
          .order('contract_value', { ascending: false }),
        supabase.from('employees')
          .select('id, name, nombre, area, puesto')
          .eq('is_active', true)
          .order('area'),
      ])

      const allMilestones = (milRes.data || []).map((m: any) => ({
        ...m,
        project_name: m.project?.name || 'Sin proyecto',
        client_name: m.project?.client_name || '',
      })) as PaymentMilestone[]

      const allProjects = (projRes.data || []) as Project[]
      const allEmployees = (empRes.data || []) as Employee[]

      setMilestones(allMilestones)
      setProjects(allProjects)
      setEmployees(allEmployees)
      setAdminTeam(allEmployees.filter(e => e.area === 'ADMINISTRACION'))

      // Build area counts
      const counts: Record<string, number> = {}
      allEmployees.forEach(e => {
        const a = e.area || 'Sin área'
        counts[a] = (counts[a] || 0) + 1
      })
      setAreaCounts(
        Object.entries(counts)
          .map(([area, count]) => ({ area, count }))
          .sort((a, b) => b.count - a.count)
      )

      setLoading(false)
    }
    load()
  }, [])

  // ── COMPUTED DATA ──
  const now = new Date().toISOString().slice(0, 10)

  // Cobranza stats
  const pendientes = useMemo(() => milestones.filter(m => m.status === 'pendiente'), [milestones])
  const vencidos = useMemo(() => milestones.filter(m => m.status === 'vencido'), [milestones])
  const cobrados = useMemo(() => milestones.filter(m => m.status === 'cobrado'), [milestones])
  const totalPorCobrar = useMemo(() => [...pendientes, ...vencidos].reduce((s, m) => s + m.amount, 0), [pendientes, vencidos])
  const totalVencido = useMemo(() => vencidos.reduce((s, m) => s + m.amount, 0), [vencidos])
  const totalCobrado = useMemo(() => cobrados.reduce((s, m) => s + m.amount, 0), [cobrados])

  // This week payments
  const weekEnd = new Date()
  weekEnd.setDate(weekEnd.getDate() + 7)
  const weekStr = weekEnd.toISOString().slice(0, 10)
  const dueThisWeek = useMemo(
    () => pendientes.filter(m => m.due_date && m.due_date >= now && m.due_date <= weekStr),
    [pendientes, now, weekStr]
  )
  const dueThisWeekAmount = useMemo(() => dueThisWeek.reduce((s, m) => s + m.amount, 0), [dueThisWeek])

  // Pipeline total (active projects)
  const pipelineTotal = useMemo(() => projects.reduce((s, p) => s + p.contract_value, 0), [projects])

  // Project billing stats
  const projectBilling = useMemo(() => {
    return projects.map(p => {
      const pMilestones = milestones.filter(m => m.project_id === p.id)
      const billed = pMilestones.filter(m => m.status === 'cobrado').reduce((s, m) => s + m.amount, 0)
      const pending = pMilestones.filter(m => m.status === 'pendiente' || m.status === 'vencido').reduce((s, m) => s + m.amount, 0)
      const overdue = pMilestones.filter(m => m.status === 'vencido').reduce((s, m) => s + m.amount, 0)
      const billedPct = p.contract_value > 0 ? Math.round((billed / p.contract_value) * 100) : 0
      return { project: p, billed, pending, overdue, billedPct, milestoneCount: pMilestones.length }
    }).sort((a, b) => b.overdue - a.overdue || b.pending - a.pending)
  }, [projects, milestones])

  // All upcoming / overdue milestones sorted
  const cobranzaList = useMemo(() => {
    return [...vencidos, ...pendientes].sort((a, b) => {
      // Vencidos first
      if (a.status === 'vencido' && b.status !== 'vencido') return -1
      if (a.status !== 'vencido' && b.status === 'vencido') return 1
      // Then by date
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      return 1
    })
  }, [vencidos, pendientes])

  if (loading) return <Loading />

  const totalEmployees = employees.length

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px', maxWidth: 1300 }}>
      <SectionHeader
        title="Panel Administrativo"
        subtitle={`${totalEmployees} empleados · ${projects.length} proyectos activos · Pipeline: ${F(pipelineTotal)}`}
      />

      {/* ── KPI ROW ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Por cobrar" value={F(totalPorCobrar)} color="#3B82F6" icon={<DollarSign size={16} />} />
        <KpiCard label="Vencido" value={F(totalVencido)} color={totalVencido > 0 ? '#EF4444' : '#57FF9A'} icon={<AlertTriangle size={16} />} />
        <KpiCard label="Esta semana" value={F(dueThisWeekAmount)} color="#F59E0B" icon={<Calendar size={16} />} />
        <KpiCard label="Cobrado total" value={F(totalCobrado)} color="#57FF9A" icon={<CheckCircle2 size={16} />} />
        <KpiCard label="Empleados" value={totalEmployees} color="#C084FC" icon={<Users size={16} />} />
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 1: Cobranza (60%) | Pendientes + Calendario (40%)
         ══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 20, marginBottom: 20 }}>
        {/* LEFT — Cobranza pipeline */}
        <div>
          <CollapsibleHeader
            title="Cobranza"
            count={cobranzaList.length}
            icon={<CreditCard size={15} />}
            expanded={expandedSections.cobranza}
            onToggle={() => toggle('cobranza')}
            extra={vencidos.length > 0 ? <span style={{ fontSize: 11, color: '#EF4444', fontWeight: 600 }}>{vencidos.length} vencido{vencidos.length > 1 ? 's' : ''}</span> : undefined}
          />
          {expandedSections.cobranza && (
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {cobranzaList.length === 0 ? (
                <EmptyState text="Sin cobros pendientes" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {cobranzaList.map(m => {
                    const isOverdue = m.status === 'vencido'
                    const isDueSoon = m.due_date && m.due_date >= now && m.due_date <= weekStr
                    return (
                      <div key={m.id} style={{
                        ...card,
                        borderLeft: `3px solid ${isOverdue ? '#EF4444' : isDueSoon ? '#F59E0B' : '#333'}`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 13, fontWeight: 500,
                              color: isOverdue ? '#EF4444' : '#fff',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {m.name}
                            </div>
                            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                              {m.project_name} · {m.client_name}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#57FF9A' }}>
                              {F(m.amount)}
                            </div>
                            <div style={{ fontSize: 10, color: isOverdue ? '#EF4444' : '#666', marginTop: 2 }}>
                              {m.due_date ? formatDate(m.due_date) : 'Sin fecha'}
                              {isOverdue && ' · VENCIDO'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — Pendientes + Calendario */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Pendientes */}
          <div>
            <ActionItems
              myEmployeeId={myEmployeeId!}
              myArea="ADMINISTRACION"
              teamEmployees={adminTeam}
              projects={projects.map(p => ({ id: p.id, name: p.name }))}
              userEmail={authUser?.email || ''}
              isMobile={isMobile}
            />
          </div>

          {/* Calendario */}
          <div>
            <CollapsibleHeader title="Calendario" icon={<Calendar size={15} />} expanded={expandedSections.calendario !== false} onToggle={() => toggle('calendario')} />
            {expandedSections.calendario !== false && (
              <div style={{ background: '#111', border: '1px solid #222', borderRadius: 12, padding: '12px 16px', maxHeight: 280, overflowY: 'auto' }}>
                <CalendarWidget userEmail={authUser?.email || ''} isMobile={isMobile} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 2: Proyectos + facturación | Equipo por área | Cobros recientes
         ══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr', gap: 20 }}>
        {/* COL 1 — Proyectos con avance de facturación */}
        <div>
          <CollapsibleHeader title="Proyectos — Facturación" count={projects.length} icon={<FolderOpen size={15} />} expanded={expandedSections.proyectos} onToggle={() => toggle('proyectos')} />
          {expandedSections.proyectos && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
              {projectBilling.length === 0 && <EmptyState text="Sin proyectos activos" />}
              {projectBilling.map(pb => (
                <div key={pb.project.id} onClick={() => navigate('/proyectos')} style={{
                  ...card, cursor: 'pointer', transition: 'border-color 0.15s',
                  borderLeft: pb.overdue > 0 ? '3px solid #EF4444' : '3px solid #333',
                }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#444'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#222'}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {pb.project.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#666' }}>{pb.project.client_name}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{F(pb.project.contract_value)}</div>
                    </div>
                  </div>
                  {/* Billing progress bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ flex: 1 }}>
                      <ProgressBar pct={pb.billedPct} />
                    </div>
                    <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>{pb.billedPct}% cobrado</span>
                  </div>
                  {/* Mini stats */}
                  <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                    {pb.billed > 0 && <span style={{ color: '#57FF9A' }}>Cobrado: {F(pb.billed)}</span>}
                    {pb.pending > 0 && <span style={{ color: '#F59E0B' }}>Pendiente: {F(pb.pending)}</span>}
                    {pb.overdue > 0 && <span style={{ color: '#EF4444', fontWeight: 600 }}>Vencido: {F(pb.overdue)}</span>}
                    {pb.milestoneCount === 0 && <span style={{ color: '#444' }}>Sin hitos de cobro</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* COL 2 — Equipo por área */}
        <div>
          <CollapsibleHeader title="Equipo" count={totalEmployees} icon={<Users size={15} />} expanded={expandedSections.equipo} onToggle={() => toggle('equipo')} />
          {expandedSections.equipo && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {areaCounts.map(ac => {
                const pct = totalEmployees > 0 ? Math.round((ac.count / totalEmployees) * 100) : 0
                const areaColors: Record<string, string> = {
                  'ELECTRICO': '#3B82F6',
                  'INSTALACIONES ESPECIALES': '#8B5CF6',
                  'INGENIERIAS ESPECIALES': '#C084FC',
                  'ADMINISTRACION': '#57FF9A',
                  'ILUMINACION': '#F59E0B',
                  'INGENIERIAS ELECTRICAS': '#06B6D4',
                }
                const color = areaColors[ac.area] || '#888'
                return (
                  <div key={ac.area} onClick={() => navigate('/empleados')} style={{
                    ...card, cursor: 'pointer', transition: 'border-color 0.15s',
                    borderLeft: `3px solid ${color}`,
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#444'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = '#222'}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#fff' }}>
                        {ac.area.charAt(0) + ac.area.slice(1).toLowerCase()}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color }}>
                        {ac.count}
                      </span>
                    </div>
                    <div style={{ height: 4, background: '#222', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )
              })}
              {/* Total */}
              <div style={{ ...card, background: '#0d0d0d', borderTop: '1px solid #333', marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#888' }}>Total</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{totalEmployees}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* COL 3 — Cobros recientes (últimos cobrados) */}
        <div>
          <CollapsibleHeader title="Cobros Recientes" count={cobrados.length} icon={<TrendingUp size={15} />} expanded={expandedSections.tareas} onToggle={() => toggle('tareas')} />
          {expandedSections.tareas && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
              {cobrados.length === 0 ? (
                <EmptyState text="Sin cobros registrados aún" />
              ) : (
                cobrados.slice(0, 12).map(m => (
                  <div key={m.id} style={{
                    ...card,
                    borderLeft: '3px solid #57FF9A',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>{m.project_name}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#57FF9A' }}>{F(m.amount)}</span>
                      {m.paid_at && <span style={{ fontSize: 10, color: '#555' }}>{formatDate(m.paid_at)}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

function CollapsibleHeader({ title, count, icon, expanded, onToggle, extra, color }: {
  title: string; count?: number; icon?: React.ReactNode; expanded: boolean; onToggle: () => void; extra?: React.ReactNode; color?: string
}) {
  return (
    <div onClick={onToggle} style={{
      display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 0', marginBottom: 8,
      userSelect: 'none',
    }}>
      {expanded ? <ChevronDown size={14} color="#666" /> : <ChevronRight size={14} color="#666" />}
      {icon}
      <span style={{ fontSize: 15, fontWeight: 700, color: color || '#fff' }}>{title}</span>
      {count !== undefined && (
        <span style={{ fontSize: 12, color: '#555', fontWeight: 400 }}>({count})</span>
      )}
      {extra && <span style={{ marginLeft: 'auto' }}>{extra}</span>}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: 20, color: '#444', fontSize: 13, textAlign: 'center' }}>{text}</div>
}
