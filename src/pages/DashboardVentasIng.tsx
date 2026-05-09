import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { F, SPECIALTY_CONFIG, formatDate } from '../lib/utils'
import { KpiCard, ProgressBar, Badge, Loading, SectionHeader } from '../components/layout/UI'
import { useIsMobile } from '../lib/useIsMobile'
import { useAuth } from '../contexts/AuthContext'
import {
  AlertTriangle, Clock, FolderOpen, FileText, TrendingUp,
  Users, ChevronDown, ChevronRight, Target, Zap, Calendar,
  BarChart3, ArrowRight, CheckCircle2, Circle, Timer
} from 'lucide-react'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface Quotation {
  id: string
  name: string
  client_name: string
  stage: string
  specialty: string
  total: number
  created_at: string
  updated_at: string
  stage_changed_at: string
  assignee_id: string | null
  notes: string
}

interface ProjectTask {
  id: string
  name: string
  status: string
  priority: number
  due_date: string | null
  progress: number
  assignee_id: string | null
  project_id: string
  project_name: string
  project_specialty: string
  completed_at: string | null
}

interface Project {
  id: string
  name: string
  client_name: string
  specialty: string
  advance_pct: number
  start_date: string | null
  end_date_planned: string | null
  area_lead_id: string | null
  site_lead_id: string | null
}

interface Employee {
  id: string
  name: string
  nombre: string | null
  puesto: string | null
  area: string | null
}

interface SlaConfig {
  entity_type: string
  stage: string
  max_days: number
  alert_days: number
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const card: React.CSSProperties = {
  background: '#111', border: '1px solid #222', borderRadius: 12, padding: '16px 20px',
}
const cardHover = (e: React.MouseEvent<HTMLDivElement>, enter: boolean) => {
  e.currentTarget.style.borderColor = enter ? '#444' : '#222'
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const STAGES = ['oportunidad', 'estimacion', 'propuesta', 'contrato'] as const
const STAGE_LABELS: Record<string, string> = {
  oportunidad: 'Oportunidad', estimacion: 'Estimación', propuesta: 'Propuesta', contrato: 'Contrato'
}
const STAGE_COLORS: Record<string, string> = {
  oportunidad: '#888', estimacion: '#F59E0B', propuesta: '#3B82F6', contrato: '#57FF9A'
}
// Probability for forecast
const STAGE_PROB: Record<string, number> = {
  oportunidad: 0.1, estimacion: 0.3, propuesta: 0.6, contrato: 0.9
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function getLeadId(notes: string): string {
  try { return JSON.parse(notes || '{}').lead_id || '' } catch { return '' }
}
function getCurrency(notes: string): string {
  try { return JSON.parse(notes || '{}').currency || 'USD' } catch { return 'USD' }
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function DashboardVentasIng() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const isEjecutor = authUser?.nivel === 'ejecutor'
  const myEmployeeId = authUser?.employee_id

  const [loading, setLoading] = useState(true)
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [slaConfigs, setSlaConfigs] = useState<SlaConfig[]>([])
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    pipeline: true, alerts: true, team: true, tasks: true, projects: true, cotizaciones: true
  })

  const toggle = (key: string) => setExpandedSections(p => ({ ...p, [key]: !p[key] }))

  // ── LOAD DATA ──
  useEffect(() => {
    async function load() {
      let taskQuery = supabase.from('project_tasks')
        .select('id, name, status, priority, due_date, progress, assignee_id, project_id, completed_at, project:projects(name, specialty)')
        .neq('status', 'completada')
        .order('due_date', { ascending: true, nullsFirst: false })

      if (isEjecutor && myEmployeeId) {
        taskQuery = taskQuery.eq('assignee_id', myEmployeeId)
      }

      const [quotRes, taskRes, projRes, empRes, slaRes] = await Promise.all([
        supabase.from('quotations')
          .select('id, name, client_name, stage, specialty, total, created_at, updated_at, stage_changed_at, assignee_id, notes')
          .order('created_at', { ascending: false }),
        taskQuery,
        supabase.from('projects')
          .select('id, name, client_name, specialty, advance_pct, start_date, end_date_planned, area_lead_id, site_lead_id')
          .eq('status', 'activo')
          .order('created_at', { ascending: false }),
        supabase.from('employees')
          .select('id, name, nombre, puesto, area')
          .or('area.ilike.%ingenier%,area.ilike.%proyecto%,area.ilike.%diseño%,area.ilike.%venta%')
          .eq('activo', true)
          .order('name'),
        supabase.from('sla_config').select('entity_type, stage, max_days, alert_days'),
      ])

      setQuotations((quotRes.data || []) as Quotation[])
      setTasks((taskRes.data || []).map((t: any) => ({
        ...t,
        project_name: t.project?.name || 'Sin proyecto',
        project_specialty: t.project?.specialty || '',
      })))
      setProjects((projRes.data || []) as Project[])
      setEmployees((empRes.data || []) as Employee[])
      setSlaConfigs((slaRes.data || []) as SlaConfig[])
      setLoading(false)
    }
    load()
  }, [])

  // ── COMPUTED DATA ──

  const now = new Date().toISOString().slice(0, 10)
  const today = new Date()

  // Pipeline by stage
  const pipeline = useMemo(() => {
    return STAGES.map(s => {
      const cots = quotations.filter(q => q.stage === s)
      return {
        stage: s,
        label: STAGE_LABELS[s],
        color: STAGE_COLORS[s],
        count: cots.length,
        totalMXN: cots.filter(q => getCurrency(q.notes) === 'MXN').reduce((sum, q) => sum + (q.total || 0), 0),
        totalUSD: cots.filter(q => getCurrency(q.notes) !== 'MXN').reduce((sum, q) => sum + (q.total || 0), 0),
      }
    })
  }, [quotations])

  // SLA alerts — cotizaciones stalled
  const slaAlerts = useMemo(() => {
    const alerts: { quotation: Quotation; days: number; maxDays: number; severity: 'warning' | 'danger' }[] = []
    quotations.forEach(q => {
      if (q.stage === 'contrato') return // contrato is "done"
      const sla = slaConfigs.find(s => s.entity_type === 'quotation' && s.stage === q.stage)
      if (!sla) return
      const days = daysSince(q.stage_changed_at || q.updated_at || q.created_at)
      if (days >= sla.alert_days) {
        alerts.push({
          quotation: q,
          days,
          maxDays: sla.max_days,
          severity: days >= sla.max_days ? 'danger' : 'warning',
        })
      }
    })
    return alerts.sort((a, b) => b.days - a.days)
  }, [quotations, slaConfigs])

  // Overdue tasks
  const overdueTasks = useMemo(() => tasks.filter(t => t.due_date && t.due_date < now), [tasks, now])

  // This week tasks
  const thisWeekEnd = new Date()
  thisWeekEnd.setDate(thisWeekEnd.getDate() + 7)
  const thisWeekStr = thisWeekEnd.toISOString().slice(0, 10)
  const dueThisWeek = useMemo(() => tasks.filter(t => t.due_date && t.due_date >= now && t.due_date <= thisWeekStr), [tasks, now, thisWeekStr])

  // Forecast — weighted pipeline
  const forecast = useMemo(() => {
    let mxn = 0, usd = 0
    quotations.forEach(q => {
      const prob = STAGE_PROB[q.stage] || 0
      const cur = getCurrency(q.notes)
      if (cur === 'MXN') mxn += (q.total || 0) * prob
      else usd += (q.total || 0) * prob
    })
    return { mxn, usd }
  }, [quotations])

  // Employee name map
  const empMap = useMemo(() => {
    const m: Record<string, string> = {}
    employees.forEach(e => { m[e.id] = e.nombre || e.name })
    return m
  }, [employees])

  // Team scorecard — per employee
  const teamScorecard = useMemo(() => {
    return employees.map(emp => {
      const myQuots = quotations.filter(q => q.assignee_id === emp.id)
      const myTasks = tasks.filter(t => t.assignee_id === emp.id)
      const myOverdue = myTasks.filter(t => t.due_date && t.due_date < now)
      const stalledQuots = myQuots.filter(q => {
        if (q.stage === 'contrato') return false
        const sla = slaConfigs.find(s => s.entity_type === 'quotation' && s.stage === q.stage)
        return sla && daysSince(q.stage_changed_at || q.updated_at || q.created_at) >= sla.max_days
      })
      return {
        employee: emp,
        quotCount: myQuots.length,
        taskCount: myTasks.length,
        overdueCount: myOverdue.length,
        stalledCount: stalledQuots.length,
        score: Math.max(0, 100 - (myOverdue.length * 15) - (stalledQuots.length * 10)),
      }
    }).filter(s => s.quotCount > 0 || s.taskCount > 0)
      .sort((a, b) => b.score - a.score)
  }, [employees, quotations, tasks, slaConfigs, now])

  // Cotizaciones that need action (no assignee, stalled, etc.)
  const actionItems = useMemo(() => {
    const items: { quotation: Quotation; reason: string; urgency: number }[] = []
    quotations.forEach(q => {
      if (q.stage === 'contrato') return
      const days = daysSince(q.stage_changed_at || q.updated_at || q.created_at)
      if (!q.assignee_id) {
        items.push({ quotation: q, reason: 'Sin asignar', urgency: 3 })
      }
      const sla = slaConfigs.find(s => s.entity_type === 'quotation' && s.stage === q.stage)
      if (sla && days >= sla.max_days) {
        items.push({ quotation: q, reason: `${days}d en ${STAGE_LABELS[q.stage]}`, urgency: days >= sla.max_days * 1.5 ? 5 : 4 })
      } else if (sla && days >= sla.alert_days) {
        items.push({ quotation: q, reason: `${days}d en ${STAGE_LABELS[q.stage]}`, urgency: 2 })
      }
    })
    // Dedupe by quotation id, keep highest urgency
    const byId: Record<string, typeof items[0]> = {}
    items.forEach(i => {
      if (!byId[i.quotation.id] || i.urgency > byId[i.quotation.id].urgency) byId[i.quotation.id] = i
    })
    return Object.values(byId).sort((a, b) => b.urgency - a.urgency)
  }, [quotations, slaConfigs])

  if (loading) return <Loading />

  // ═══════════════════════════════════════════════════════════════
  // EJECUTOR VIEW
  // ═══════════════════════════════════════════════════════════════

  if (isEjecutor) {
    const myQuots = quotations.filter(q => q.assignee_id === myEmployeeId)
    const myProjects = projects.filter(p =>
      p.area_lead_id === myEmployeeId || p.site_lead_id === myEmployeeId ||
      tasks.some(t => t.assignee_id === myEmployeeId && t.project_id === p.id)
    )
    const myTasks = tasks.filter(t => t.assignee_id === myEmployeeId)
    const myOverdue = myTasks.filter(t => t.due_date && t.due_date < now)
    const myDueWeek = myTasks.filter(t => t.due_date && t.due_date >= now && t.due_date <= thisWeekStr)

    return (
      <div style={{ padding: isMobile ? '16px 12px' : '24px 28px', maxWidth: 1100 }}>
        <SectionHeader
          title={`Hola, ${authUser?.nombre?.split(' ')[0] || 'Ingeniero'}`}
          subtitle="Tu panel de trabajo — cotizaciones, tareas y entregables"
        />

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          <KpiCard label="Tareas pendientes" value={myTasks.length} color={myTasks.length > 8 ? '#F59E0B' : '#57FF9A'} icon={<Target size={16} />} />
          <KpiCard label="Vencidas" value={myOverdue.length} color={myOverdue.length > 0 ? '#EF4444' : '#57FF9A'} icon={<AlertTriangle size={16} />} />
          <KpiCard label="Esta semana" value={myDueWeek.length} color="#3B82F6" icon={<Calendar size={16} />} />
          <KpiCard label="Cotizaciones" value={myQuots.length} icon={<FileText size={16} />} />
        </div>

        {/* Overdue alert */}
        {myOverdue.length > 0 && <OverdueAlert tasks={myOverdue} />}

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20 }}>
          {/* My Tasks */}
          <div>
            <CollapsibleHeader title="Mis Tareas Pendientes" count={myTasks.length} expanded={expandedSections.tasks} onToggle={() => toggle('tasks')} />
            {expandedSections.tasks && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {myTasks.length === 0 && <EmptyState text="Sin tareas pendientes" />}
                {myTasks.slice(0, 15).map(t => (
                  <TaskRow key={t.id} task={t} now={now} onClick={() => navigate(`/proyectos`)} />
                ))}
              </div>
            )}
          </div>

          {/* My Quotations + Projects */}
          <div>
            <CollapsibleHeader title="Mis Cotizaciones" count={myQuots.length} expanded={expandedSections.cotizaciones} onToggle={() => toggle('cotizaciones')} />
            {expandedSections.cotizaciones && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {myQuots.length === 0 && <EmptyState text="Sin cotizaciones asignadas" />}
                {myQuots.map(q => (
                  <QuotRow key={q.id} quot={q} onClick={() => navigate(`/cotizaciones#${q.id}:${q.specialty}`)} />
                ))}
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <CollapsibleHeader title="Mis Proyectos" count={myProjects.length} expanded={expandedSections.projects} onToggle={() => toggle('projects')} />
              {expandedSections.projects && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {myProjects.length === 0 && <EmptyState text="Sin proyectos activos" />}
                  {myProjects.map(p => (
                    <ProjectRow key={p.id} project={p} tasks={tasks.filter(t => t.project_id === p.id)} onClick={() => navigate(`/proyectos`)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════
  // DIRECTOR VIEW
  // ═══════════════════════════════════════════════════════════════

  const totalPipelineMXN = pipeline.reduce((s, p) => s + p.totalMXN, 0)
  const totalPipelineUSD = pipeline.reduce((s, p) => s + p.totalUSD, 0)
  const unassignedCount = quotations.filter(q => !q.assignee_id && q.stage !== 'contrato').length

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px', maxWidth: 1200 }}>
      <SectionHeader
        title="Panel de Ventas e Ingeniería"
        subtitle={`${quotations.length} cotizaciones · ${projects.length} proyectos activos · ${tasks.length} tareas pendientes`}
      />

      {/* ── KPI ROW ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Pipeline MXN" value={F(totalPipelineMXN)} color="#57FF9A" icon={<TrendingUp size={16} />} />
        <KpiCard label="Pipeline USD" value={'$' + Math.round(totalPipelineUSD).toLocaleString()} color="#3B82F6" icon={<TrendingUp size={16} />} />
        <KpiCard label="Alertas SLA" value={slaAlerts.length} color={slaAlerts.length > 0 ? '#EF4444' : '#57FF9A'} icon={<AlertTriangle size={16} />} />
        <KpiCard label="Sin asignar" value={unassignedCount} color={unassignedCount > 0 ? '#F59E0B' : '#57FF9A'} icon={<Users size={16} />} />
        <KpiCard label="Tasks vencidas" value={overdueTasks.length} color={overdueTasks.length > 0 ? '#EF4444' : '#57FF9A'} icon={<Clock size={16} />} />
      </div>

      {/* ── PIPELINE FUNNEL ── */}
      <CollapsibleHeader title="Pipeline de Cotizaciones" icon={<BarChart3 size={15} />} expanded={expandedSections.pipeline} onToggle={() => toggle('pipeline')} />
      {expandedSections.pipeline && (
        <div style={{ marginBottom: 24 }}>
          <PipelineFunnel pipeline={pipeline} />
          {/* Forecast */}
          <div style={{ ...card, marginTop: 12, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Target size={16} color="#57FF9A" />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Forecast ponderado</span>
            </div>
            {forecast.mxn > 0 && (
              <div style={{ fontSize: 13, color: '#ccc' }}>
                MXN <span style={{ color: '#57FF9A', fontWeight: 700 }}>{F(forecast.mxn)}</span>
              </div>
            )}
            {forecast.usd > 0 && (
              <div style={{ fontSize: 13, color: '#ccc' }}>
                USD <span style={{ color: '#3B82F6', fontWeight: 700 }}>{'$' + Math.round(forecast.usd).toLocaleString()}</span>
              </div>
            )}
            <div style={{ fontSize: 11, color: '#555' }}>
              (Oport 10% · Estim 30% · Prop 60% · Contr 90%)
            </div>
          </div>
        </div>
      )}

      {/* ── ALERTS / ACTION ITEMS ── */}
      {(actionItems.length > 0 || overdueTasks.length > 0) && (
        <>
          <CollapsibleHeader title="Requiere Acción" count={actionItems.length + overdueTasks.length} icon={<Zap size={15} />} expanded={expandedSections.alerts} onToggle={() => toggle('alerts')} color="#EF4444" />
          {expandedSections.alerts && (
            <div style={{ marginBottom: 24 }}>
              {overdueTasks.length > 0 && <OverdueAlert tasks={overdueTasks} />}
              {actionItems.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: overdueTasks.length > 0 ? 12 : 0 }}>
                  {actionItems.slice(0, 10).map(item => (
                    <div key={item.quotation.id}
                      onClick={() => navigate(`/cotizaciones#${item.quotation.id}:${item.quotation.specialty}`)}
                      style={{ ...card, padding: '12px 16px', cursor: 'pointer', borderLeft: `3px solid ${item.urgency >= 4 ? '#EF4444' : '#F59E0B'}` }}
                      onMouseEnter={e => cardHover(e, true)} onMouseLeave={e => cardHover(e, false)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>{item.quotation.name}</div>
                          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                            {item.quotation.client_name} · {SPECIALTY_CONFIG[item.quotation.specialty as keyof typeof SPECIALTY_CONFIG]?.label || item.quotation.specialty}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <Badge label={item.reason} color={item.urgency >= 4 ? '#EF4444' : '#F59E0B'} />
                          {item.quotation.assignee_id && (
                            <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>{empMap[item.quotation.assignee_id] || ''}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── TEAM SCORECARD ── */}
      <CollapsibleHeader title="Equipo" count={teamScorecard.length} icon={<Users size={15} />} expanded={expandedSections.team} onToggle={() => toggle('team')} />
      {expandedSections.team && (
        <div style={{ marginBottom: 24 }}>
          {teamScorecard.length === 0 ? (
            <EmptyState text="Asigna cotizaciones y tareas para ver el scorecard del equipo" />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 10 }}>
              {teamScorecard.map(sc => (
                <div key={sc.employee.id} style={{ ...card, borderLeft: `3px solid ${sc.score >= 80 ? '#57FF9A' : sc.score >= 50 ? '#F59E0B' : '#EF4444'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{sc.employee.nombre || sc.employee.name}</div>
                      <div style={{ fontSize: 11, color: '#666' }}>{sc.employee.puesto || sc.employee.area}</div>
                    </div>
                    <div style={{
                      width: 40, height: 40, borderRadius: 20,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 700,
                      background: sc.score >= 80 ? 'rgba(87,255,154,0.15)' : sc.score >= 50 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                      color: sc.score >= 80 ? '#57FF9A' : sc.score >= 50 ? '#F59E0B' : '#EF4444',
                    }}>
                      {sc.score}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                    <div style={{ color: '#888' }}>
                      <FileText size={11} style={{ marginRight: 4, verticalAlign: -1 }} />{sc.quotCount} cots
                    </div>
                    <div style={{ color: '#888' }}>
                      <Target size={11} style={{ marginRight: 4, verticalAlign: -1 }} />{sc.taskCount} tasks
                    </div>
                    {sc.overdueCount > 0 && (
                      <div style={{ color: '#EF4444' }}>
                        <AlertTriangle size={11} style={{ marginRight: 4, verticalAlign: -1 }} />{sc.overdueCount} vencidas
                      </div>
                    )}
                    {sc.stalledCount > 0 && (
                      <div style={{ color: '#F59E0B' }}>
                        <Timer size={11} style={{ marginRight: 4, verticalAlign: -1 }} />{sc.stalledCount} estancadas
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PROJECTS + TASKS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20 }}>
        {/* Active Projects */}
        <div>
          <CollapsibleHeader title="Proyectos Activos" count={projects.length} icon={<FolderOpen size={15} />} expanded={expandedSections.projects} onToggle={() => toggle('projects')} />
          {expandedSections.projects && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {projects.length === 0 && <EmptyState text="Sin proyectos activos" />}
              {projects.map(p => (
                <ProjectRow key={p.id} project={p} tasks={tasks.filter(t => t.project_id === p.id)} onClick={() => navigate(`/proyectos`)} empMap={empMap} />
              ))}
            </div>
          )}
        </div>

        {/* Tasks needing attention */}
        <div>
          <CollapsibleHeader title="Tareas Pendientes" count={tasks.length} icon={<Target size={15} />} expanded={expandedSections.tasks} onToggle={() => toggle('tasks')} />
          {expandedSections.tasks && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tasks.length === 0 && <EmptyState text="Sin tareas pendientes" />}
              {tasks.slice(0, 15).map(t => (
                <TaskRow key={t.id} task={t} now={now} onClick={() => navigate(`/proyectos`)} showAssignee empMap={empMap} />
              ))}
              {tasks.length > 15 && (
                <div style={{ fontSize: 12, color: '#555', padding: '8px 0', textAlign: 'center' }}>
                  +{tasks.length - 15} tareas más
                </div>
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

function CollapsibleHeader({ title, count, icon, expanded, onToggle, color }: {
  title: string; count?: number; icon?: React.ReactNode; expanded: boolean; onToggle: () => void; color?: string
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
    </div>
  )
}

function PipelineFunnel({ pipeline }: { pipeline: { stage: string; label: string; color: string; count: number; totalMXN: number; totalUSD: number }[] }) {
  const maxCount = Math.max(...pipeline.map(p => p.count), 1)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
      {pipeline.map((p, i) => (
        <div key={p.stage} style={{
          ...card, textAlign: 'center', borderTop: `3px solid ${p.color}`,
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Background bar */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: `${Math.max(8, (p.count / maxCount) * 60)}%`,
            background: p.color, opacity: 0.06,
          }} />
          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: p.color, lineHeight: 1.2 }}>{p.count}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ccc', marginBottom: 8 }}>{p.label}</div>
            {p.totalMXN > 0 && (
              <div style={{ fontSize: 11, color: '#888' }}>MXN {F(p.totalMXN)}</div>
            )}
            {p.totalUSD > 0 && (
              <div style={{ fontSize: 11, color: '#888' }}>USD ${Math.round(p.totalUSD).toLocaleString()}</div>
            )}
          </div>
          {i < 3 && (
            <ArrowRight size={14} color="#333" style={{ position: 'absolute', right: -12, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />
          )}
        </div>
      ))}
    </div>
  )
}

function OverdueAlert({ tasks }: { tasks: ProjectTask[] }) {
  return (
    <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '14px 18px', marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#EF4444', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertTriangle size={14} /> {tasks.length} tarea{tasks.length > 1 ? 's' : ''} vencida{tasks.length > 1 ? 's' : ''}
      </div>
      {tasks.slice(0, 5).map(t => (
        <div key={t.id} style={{ fontSize: 12, color: '#ccc', padding: '3px 0', display: 'flex', justifyContent: 'space-between' }}>
          <span><span style={{ fontWeight: 500, color: '#fff' }}>{t.name}</span> — {t.project_name}</span>
          <span style={{ color: '#EF4444', fontSize: 11 }}>{t.due_date ? formatDate(t.due_date) : ''}</span>
        </div>
      ))}
    </div>
  )
}

function TaskRow({ task, now, onClick, showAssignee, empMap }: {
  task: ProjectTask; now: string; onClick: () => void; showAssignee?: boolean; empMap?: Record<string, string>
}) {
  const isOverdue = task.due_date && task.due_date < now
  return (
    <div onClick={onClick} style={{
      ...card, padding: '10px 14px', cursor: 'pointer',
      borderLeft: `3px solid ${isOverdue ? '#EF4444' : task.status === 'en_progreso' ? '#3B82F6' : '#333'}`,
    }}
      onMouseEnter={e => cardHover(e, true)} onMouseLeave={e => cardHover(e, false)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: isOverdue ? '#EF4444' : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {task.name}
          </div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
            {task.project_name}
            {showAssignee && task.assignee_id && empMap && (
              <span style={{ color: '#666' }}> · {empMap[task.assignee_id]}</span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
          {task.due_date && (
            <div style={{ fontSize: 11, color: isOverdue ? '#EF4444' : '#888', fontWeight: isOverdue ? 600 : 400 }}>
              {formatDate(task.due_date)}
            </div>
          )}
          {task.progress > 0 && (
            <div style={{ width: 60, marginTop: 4 }}>
              <ProgressBar pct={task.progress} color={isOverdue ? '#EF4444' : '#57FF9A'} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function QuotRow({ quot, onClick }: { quot: Quotation; onClick: () => void }) {
  const days = daysSince(quot.stage_changed_at || quot.updated_at || quot.created_at)
  const cfg = SPECIALTY_CONFIG[quot.specialty as keyof typeof SPECIALTY_CONFIG]
  return (
    <div onClick={onClick} style={{
      ...card, padding: '10px 14px', cursor: 'pointer',
      borderLeft: cfg ? `3px solid ${cfg.color}` : '3px solid #333',
    }}
      onMouseEnter={e => cardHover(e, true)} onMouseLeave={e => cardHover(e, false)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>{quot.name}</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{quot.client_name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Badge label={STAGE_LABELS[quot.stage] || quot.stage} color={STAGE_COLORS[quot.stage] || '#888'} />
          <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>{days}d en etapa</div>
        </div>
      </div>
    </div>
  )
}

function ProjectRow({ project, tasks, onClick, empMap }: {
  project: Project; tasks: ProjectTask[]; onClick: () => void; empMap?: Record<string, string>
}) {
  const cfg = SPECIALTY_CONFIG[project.specialty as keyof typeof SPECIALTY_CONFIG]
  const doneCount = tasks.filter(t => t.status === 'completada').length
  const totalCount = tasks.length
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : (project.advance_pct || 0)

  return (
    <div onClick={onClick} style={{
      ...card, cursor: 'pointer',
      borderLeft: cfg ? `3px solid ${cfg.color}` : '3px solid #333',
    }}
      onMouseEnter={e => cardHover(e, true)} onMouseLeave={e => cardHover(e, false)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{project.name}</div>
          <div style={{ fontSize: 11, color: '#666' }}>
            {project.client_name}
            {empMap && project.area_lead_id && empMap[project.area_lead_id] && (
              <span> · {empMap[project.area_lead_id]}</span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#888' }}>{totalCount > 0 ? `${doneCount}/${totalCount} tareas` : `${pct}%`}</div>
          {project.end_date_planned && (
            <div style={{ fontSize: 10, color: project.end_date_planned < new Date().toISOString().slice(0, 10) ? '#EF4444' : '#555' }}>
              {formatDate(project.end_date_planned)}
            </div>
          )}
        </div>
      </div>
      <ProgressBar pct={pct} />
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: 20, color: '#444', fontSize: 13, textAlign: 'center' }}>{text}</div>
}
