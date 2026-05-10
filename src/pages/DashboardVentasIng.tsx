import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SPECIALTY_CONFIG, formatDate } from '../lib/utils'
import { KpiCard, ProgressBar, Badge, Loading, SectionHeader } from '../components/layout/UI'
import { useIsMobile } from '../lib/useIsMobile'
import { useAuth } from '../contexts/AuthContext'
import {
  AlertTriangle, Clock, FolderOpen, FileText,
  Users, ChevronDown, ChevronRight, Target, Zap, Calendar,
  BarChart3, CheckCircle2, Timer, UserCheck, Briefcase, ClipboardList
} from 'lucide-react'
import ActionItems from '../components/ActionItems'
import CalendarWidget from '../components/CalendarWidget'

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
// AREA → SPECIALTY MAPPING
// ═══════════════════════════════════════════════════════════════

// Maps employee area to quotation/project specialty codes
const AREA_TO_SPECIALTY: Record<string, string[]> = {
  'INGENIERIAS ESPECIALES': ['esp'],
  'INSTALACIONES ESPECIALES': ['esp'],
  'ILUMINACION': ['ilum'],
  'INGENIERIAS ELECTRICAS': ['elec'],
  'ELECTRICO': ['elec'],
}

// Which employee areas a director sees as "their team"
const AREA_TEAM: Record<string, string[]> = {
  'INGENIERIAS ESPECIALES': ['INGENIERIAS ESPECIALES', 'INSTALACIONES ESPECIALES'],
  'ILUMINACION': ['ILUMINACION'],
  'INGENIERIAS ELECTRICAS': ['INGENIERIAS ELECTRICAS', 'ELECTRICO'],
  'ELECTRICO': ['INGENIERIAS ELECTRICAS', 'ELECTRICO'],
}

// Pretty names for areas
const AREA_LABELS: Record<string, string> = {
  'INGENIERIAS ESPECIALES': 'Ingenierías Especiales',
  'ILUMINACION': 'Iluminación',
  'INGENIERIAS ELECTRICAS': 'Ingenierías Eléctricas',
  'ELECTRICO': 'Eléctrico',
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

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
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
  const [myArea, setMyArea] = useState<string>('')
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    workload: true, alerts: true, projects: true, cotizaciones: true, tasks: true
  })

  const toggle = (key: string) => setExpandedSections(p => ({ ...p, [key]: !p[key] }))

  // ── LOAD DATA ──
  useEffect(() => {
    async function load() {
      // First get the director's employee area
      let directorArea = ''
      if (myEmployeeId) {
        const { data: empData } = await supabase
          .from('employees').select('area').eq('id', myEmployeeId).single()
        directorArea = empData?.area || ''
        setMyArea(directorArea)
      }

      // Determine specialties to filter by
      const mySpecialties = AREA_TO_SPECIALTY[directorArea] || []
      const myTeamAreas = AREA_TEAM[directorArea] || [directorArea]

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
          .eq('is_active', true)
          .order('name'),
        supabase.from('sla_config').select('entity_type, stage, max_days, alert_days'),
      ])

      // For directors: filter by their specialty
      const allQuotations = (quotRes.data || []) as Quotation[]
      const allTasks = (taskRes.data || []).map((t: any) => ({
        ...t,
        project_name: t.project?.name || 'Sin proyecto',
        project_specialty: t.project?.specialty || '',
      })) as ProjectTask[]
      const allProjects = (projRes.data || []) as Project[]
      const allEmployees = (empRes.data || []) as Employee[]

      if (!isEjecutor && mySpecialties.length > 0) {
        // Director: filter to their specialty
        setQuotations(allQuotations.filter(q => mySpecialties.includes(q.specialty)))
        setProjects(allProjects.filter(p => mySpecialties.includes(p.specialty)))
        // Tasks: only from their specialty's projects
        const filteredProjectIds = new Set(allProjects.filter(p => mySpecialties.includes(p.specialty)).map(p => p.id))
        setTasks(allTasks.filter(t => filteredProjectIds.has(t.project_id)))
        // Employees: only from their team areas
        setEmployees(allEmployees.filter(e => e.area && myTeamAreas.includes(e.area)))
      } else if (isEjecutor && myTeamAreas.length > 0) {
        // Ejecutor: tasks already filtered by assignee in query, but scope employees to area
        setQuotations(allQuotations)
        setTasks(allTasks)
        setProjects(allProjects)
        setEmployees(allEmployees.filter(e => e.area && myTeamAreas.includes(e.area)))
      } else {
        // Fallback: show all
        setQuotations(allQuotations)
        setTasks(allTasks)
        setProjects(allProjects)
        setEmployees(allEmployees)
      }

      setSlaConfigs((slaRes.data || []) as SlaConfig[])
      setLoading(false)
    }
    load()
  }, [])

  // ── COMPUTED DATA ──

  const now = new Date().toISOString().slice(0, 10)

  // Overdue tasks
  const overdueTasks = useMemo(() => tasks.filter(t => t.due_date && t.due_date < now), [tasks, now])

  // This week tasks
  const thisWeekEnd = new Date()
  thisWeekEnd.setDate(thisWeekEnd.getDate() + 7)
  const thisWeekStr = thisWeekEnd.toISOString().slice(0, 10)
  const dueThisWeek = useMemo(() => tasks.filter(t => t.due_date && t.due_date >= now && t.due_date <= thisWeekStr), [tasks, now, thisWeekStr])

  // SLA alerts — cotizaciones stalled
  const slaAlerts = useMemo(() => {
    const alerts: { quotation: Quotation; days: number; maxDays: number; severity: 'warning' | 'danger' }[] = []
    quotations.forEach(q => {
      if (q.stage === 'contrato') return
      const sla = slaConfigs.find(s => s.entity_type === 'quotation' && s.stage === q.stage)
      if (!sla) return
      const days = daysSince(q.stage_changed_at || q.updated_at || q.created_at)
      if (days >= sla.alert_days) {
        alerts.push({ quotation: q, days, maxDays: sla.max_days, severity: days >= sla.max_days ? 'danger' : 'warning' })
      }
    })
    return alerts.sort((a, b) => b.days - a.days)
  }, [quotations, slaConfigs])

  // Employee name map
  const empMap = useMemo(() => {
    const m: Record<string, string> = {}
    employees.forEach(e => { m[e.id] = e.nombre || e.name })
    return m
  }, [employees])

  // Work distribution — per employee in the team
  const workDistribution = useMemo(() => {
    return employees.map(emp => {
      const empTasks = tasks.filter(t => t.assignee_id === emp.id)
      const empOverdue = empTasks.filter(t => t.due_date && t.due_date < now)
      const empDueWeek = empTasks.filter(t => t.due_date && t.due_date >= now && t.due_date <= thisWeekStr)
      const empQuots = quotations.filter(q => q.assignee_id === emp.id)
      const stalledQuots = empQuots.filter(q => {
        if (q.stage === 'contrato') return false
        const sla = slaConfigs.find(s => s.entity_type === 'quotation' && s.stage === q.stage)
        return sla && daysSince(q.stage_changed_at || q.updated_at || q.created_at) >= sla.max_days
      })
      const score = Math.max(0, 100 - (empOverdue.length * 15) - (stalledQuots.length * 10))
      return {
        employee: emp,
        taskCount: empTasks.length,
        overdueCount: empOverdue.length,
        dueWeekCount: empDueWeek.length,
        quotCount: empQuots.length,
        stalledCount: stalledQuots.length,
        score,
      }
    }).filter(w => w.taskCount > 0 || w.quotCount > 0)
      .sort((a, b) => a.score - b.score) // worst first so director sees problems
  }, [employees, tasks, quotations, slaConfigs, now, thisWeekStr])

  // Unassigned cotizaciones
  const unassignedQuots = useMemo(
    () => quotations.filter(q => !q.assignee_id && q.stage !== 'contrato'),
    [quotations]
  )

  // Active cotizaciones (not contrato, not old)
  const activeCotizaciones = useMemo(
    () => quotations.filter(q => q.stage !== 'contrato'),
    [quotations]
  )

  // Action items (unassigned + SLA violations)
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
    const byId: Record<string, typeof items[0]> = {}
    items.forEach(i => {
      if (!byId[i.quotation.id] || i.urgency > byId[i.quotation.id].urgency) byId[i.quotation.id] = i
    })
    return Object.values(byId).sort((a, b) => b.urgency - a.urgency)
  }, [quotations, slaConfigs])

  // Tasks grouped by project
  const tasksByProject = useMemo(() => {
    const grouped: Record<string, { projectName: string; tasks: ProjectTask[] }> = {}
    tasks.forEach(t => {
      if (!grouped[t.project_id]) grouped[t.project_id] = { projectName: t.project_name, tasks: [] }
      grouped[t.project_id].tasks.push(t)
    })
    return Object.values(grouped).sort((a, b) => {
      // Projects with overdue tasks first
      const aOverdue = a.tasks.some(t => t.due_date && t.due_date < now) ? 0 : 1
      const bOverdue = b.tasks.some(t => t.due_date && t.due_date < now) ? 0 : 1
      return aOverdue - bOverdue
    })
  }, [tasks, now])

  // Cotizaciones by stage (counts only, no money)
  const cotsByStage = useMemo(() => {
    return STAGES.map(s => ({
      stage: s,
      label: STAGE_LABELS[s],
      color: STAGE_COLORS[s],
      count: quotations.filter(q => q.stage === s).length,
    }))
  }, [quotations])

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
      <div style={{ padding: isMobile ? '16px 12px' : '24px 28px', maxWidth: 1200 }}>
        <SectionHeader
          title={`Hola, ${authUser?.nombre?.split(' ')[0] || 'Ingeniero'}`}
          subtitle="Tu panel de trabajo — cotizaciones, tareas y entregables"
        />
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
          <KpiCard label="Tareas pendientes" value={myTasks.length} color={myTasks.length > 8 ? '#F59E0B' : '#57FF9A'} icon={<Target size={16} />} />
          <KpiCard label="Vencidas" value={myOverdue.length} color={myOverdue.length > 0 ? '#EF4444' : '#57FF9A'} icon={<AlertTriangle size={16} />} />
          <KpiCard label="Esta semana" value={myDueWeek.length} color="#3B82F6" icon={<Calendar size={16} />} />
          <KpiCard label="Cotizaciones" value={myQuots.length} icon={<FileText size={16} />} />
        </div>
        {myOverdue.length > 0 && <OverdueAlert tasks={myOverdue} />}

        {/* ── ROW 1: Pendientes (left) | Calendario (right) ── */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 20, marginBottom: 20 }}>
          <div>
            <ActionItems myEmployeeId={myEmployeeId!} myArea={myArea} teamEmployees={employees} projects={projects.map(p => ({ id: p.id, name: p.name }))} userEmail={authUser?.email || ''} isMobile={isMobile} />
          </div>
          <div>
            <CollapsibleHeader title="Mi Calendario" icon={<Calendar size={15} />} expanded={expandedSections.calendario !== false} onToggle={() => toggle('calendario')} />
            {expandedSections.calendario !== false && (
              <div style={{ background: '#111', border: '1px solid #222', borderRadius: 12, padding: '12px 16px', maxHeight: 350, overflowY: 'auto' }}>
                <CalendarWidget userEmail={authUser?.email || ''} isMobile={isMobile} />
              </div>
            )}
          </div>
        </div>

        {/* ── ROW 2: Tareas | Cotizaciones | Proyectos ── */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 20 }}>
          <div>
            <CollapsibleHeader title="Mis Tareas" count={myTasks.length} icon={<Target size={15} />} expanded={expandedSections.tasks} onToggle={() => toggle('tasks')} />
            {expandedSections.tasks && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
                {myTasks.length === 0 && <EmptyState text="Sin tareas pendientes" />}
                {myTasks.slice(0, 15).map(t => (
                  <TaskRow key={t.id} task={t} now={now} onClick={() => navigate(`/proyectos`)} compact />
                ))}
              </div>
            )}
          </div>
          <div>
            <CollapsibleHeader title="Mis Cotizaciones" count={myQuots.length} icon={<Briefcase size={15} />} expanded={expandedSections.cotizaciones} onToggle={() => toggle('cotizaciones')} />
            {expandedSections.cotizaciones && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
                {myQuots.length === 0 && <EmptyState text="Sin cotizaciones asignadas" />}
                {myQuots.map(q => (
                  <QuotRow key={q.id} quot={q} onClick={() => navigate(`/cotizaciones#${q.id}:${q.specialty}`)} />
                ))}
              </div>
            )}
          </div>
          <div>
            <CollapsibleHeader title="Mis Proyectos" count={myProjects.length} icon={<FolderOpen size={15} />} expanded={expandedSections.projects} onToggle={() => toggle('projects')} />
            {expandedSections.projects && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
                {myProjects.length === 0 && <EmptyState text="Sin proyectos activos" />}
                {myProjects.map(p => (
                  <ProjectRow key={p.id} project={p} tasks={tasks.filter(t => t.project_id === p.id)} onClick={() => navigate(`/proyectos`)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════
  // DIRECTOR VIEW — Eficiencia, urgencias, distribución de trabajo
  // ═══════════════════════════════════════════════════════════════

  const areaLabel = AREA_LABELS[myArea] || myArea || 'Ingeniería'
  const totalTeam = employees.length

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px', maxWidth: 1300 }}>
      <SectionHeader
        title={`Panel de ${areaLabel}`}
        subtitle={`${totalTeam} personas · ${projects.length} proyecto${projects.length !== 1 ? 's' : ''} · ${tasks.length} tareas pendientes · ${activeCotizaciones.length} cotizaciones activas`}
      />

      {/* ── KPI ROW ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Tareas pendientes" value={tasks.length} color={tasks.length > 20 ? '#F59E0B' : '#57FF9A'} icon={<Target size={16} />} />
        <KpiCard label="Vencidas" value={overdueTasks.length} color={overdueTasks.length > 0 ? '#EF4444' : '#57FF9A'} icon={<AlertTriangle size={16} />} />
        <KpiCard label="Esta semana" value={dueThisWeek.length} color="#3B82F6" icon={<Calendar size={16} />} />
        <KpiCard label="Sin asignar" value={unassignedQuots.length} color={unassignedQuots.length > 0 ? '#F59E0B' : '#57FF9A'} icon={<UserCheck size={16} />} />
        <KpiCard label="Alertas SLA" value={slaAlerts.length} color={slaAlerts.length > 0 ? '#EF4444' : '#57FF9A'} icon={<Clock size={16} />} />
      </div>

      {/* ── OVERDUE ALERT (compact) ── */}
      {overdueTasks.length > 0 && <OverdueAlert tasks={overdueTasks} empMap={empMap} />}

      {/* ══════════════════════════════════════════════════════════
          ROW 1: Pendientes (left ~60%) | Calendario + Alertas (right ~40%)
         ══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 20, marginBottom: 20 }}>
        {/* LEFT — Pendientes */}
        <div>
          <ActionItems myEmployeeId={myEmployeeId!} myArea={myArea} teamEmployees={employees} projects={projects.map(p => ({ id: p.id, name: p.name }))} userEmail={authUser?.email || ''} isMobile={isMobile} />
        </div>

        {/* RIGHT — Calendario + Requiere Acción */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Calendario */}
          <div>
            <CollapsibleHeader title="Calendario" icon={<Calendar size={15} />} expanded={expandedSections.calendario !== false} onToggle={() => toggle('calendario')} />
            {expandedSections.calendario !== false && (
              <div style={{ background: '#111', border: '1px solid #222', borderRadius: 12, padding: '12px 16px', maxHeight: 300, overflowY: 'auto' }}>
                <CalendarWidget userEmail={authUser?.email || ''} isMobile={isMobile} />
              </div>
            )}
          </div>

          {/* Requiere Acción — compact inline */}
          {actionItems.length > 0 && (
            <div>
              <CollapsibleHeader title="Requiere Acción" count={actionItems.length} icon={<Zap size={15} />} expanded={expandedSections.alerts} onToggle={() => toggle('alerts')} color="#EF4444" />
              {expandedSections.alerts && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 250, overflowY: 'auto' }}>
                  {actionItems.slice(0, 8).map(item => (
                    <div key={item.quotation.id}
                      onClick={() => navigate(`/cotizaciones#${item.quotation.id}:${item.quotation.specialty}`)}
                      style={{
                        background: '#111', border: '1px solid #222', borderRadius: 8,
                        padding: '8px 12px', cursor: 'pointer',
                        borderLeft: `3px solid ${item.urgency >= 4 ? '#EF4444' : '#F59E0B'}`,
                        transition: 'border-color 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = '#444'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = '#222'}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.quotation.name || item.quotation.client_name}
                          </div>
                          <div style={{ fontSize: 10, color: '#666', marginTop: 1 }}>
                            {item.quotation.assignee_id && empMap[item.quotation.assignee_id] ? empMap[item.quotation.assignee_id] : 'Sin asignar'}
                          </div>
                        </div>
                        <Badge label={item.reason} color={item.urgency >= 4 ? '#EF4444' : '#F59E0B'} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 2: Equipo | Proyectos + Tareas | Cotizaciones
         ══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* COL 1 — Distribución de Trabajo (compact table) */}
        <div>
          <CollapsibleHeader title="Equipo" count={workDistribution.length} icon={<Users size={15} />} expanded={expandedSections.workload} onToggle={() => toggle('workload')} />
          {expandedSections.workload && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {workDistribution.length === 0 ? (
                <EmptyState text="Sin datos de equipo" />
              ) : (
                workDistribution.map(w => (
                  <div key={w.employee.id} style={{
                    background: '#111', border: '1px solid #222', borderRadius: 10, padding: '10px 14px',
                    borderLeft: `3px solid ${w.score >= 80 ? '#57FF9A' : w.score >= 50 ? '#F59E0B' : '#EF4444'}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
                          {(w.employee.nombre || w.employee.name).split(' ').slice(0, 2).join(' ')}
                        </div>
                        <div style={{ fontSize: 10, color: '#666' }}>{w.employee.puesto || ''}</div>
                      </div>
                      <div style={{
                        width: 32, height: 32, borderRadius: 16,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700,
                        background: w.score >= 80 ? 'rgba(87,255,154,0.12)' : w.score >= 50 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)',
                        color: w.score >= 80 ? '#57FF9A' : w.score >= 50 ? '#F59E0B' : '#EF4444',
                      }}>
                        {w.score}
                      </div>
                    </div>
                    {/* Compact stats row */}
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                      {w.taskCount > 0 && <div style={{ flex: w.taskCount, height: 4, borderRadius: 2, background: w.overdueCount > 0 ? '#EF4444' : '#3B82F6' }} />}
                      {w.quotCount > 0 && <div style={{ flex: w.quotCount, height: 4, borderRadius: 2, background: w.stalledCount > 0 ? '#F59E0B' : '#57FF9A' }} />}
                      {w.taskCount === 0 && w.quotCount === 0 && <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#222' }} />}
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 11, flexWrap: 'wrap' }}>
                      <span style={{ color: '#888' }}>{w.taskCount}T</span>
                      <span style={{ color: '#888' }}>{w.quotCount}C</span>
                      {w.overdueCount > 0 && <span style={{ color: '#EF4444', fontWeight: 600 }}>{w.overdueCount} venc</span>}
                      {w.stalledCount > 0 && <span style={{ color: '#F59E0B', fontWeight: 600 }}>{w.stalledCount} estanc</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* COL 2 — Proyectos + Tareas */}
        <div>
          <CollapsibleHeader title="Proyectos" count={projects.length} icon={<FolderOpen size={15} />} expanded={expandedSections.projects} onToggle={() => toggle('projects')} />
          {expandedSections.projects && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 450, overflowY: 'auto' }}>
              {projects.length === 0 && <EmptyState text="Sin proyectos activos" />}
              {projects.map(p => {
                const pTasks = tasks.filter(t => t.project_id === p.id)
                const pOverdue = pTasks.filter(t => t.due_date && t.due_date < now)
                return (
                  <div key={p.id} onClick={() => navigate(`/proyectos`)} style={{
                    background: '#111', border: '1px solid #222', borderRadius: 10, padding: '10px 14px',
                    cursor: 'pointer', transition: 'border-color 0.15s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#444'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = '#222'}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                        {p.name}
                      </div>
                      <span style={{ fontSize: 11, color: '#555', flexShrink: 0, marginLeft: 8 }}>{pTasks.length}T</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                      {p.client_name}
                      {empMap[p.area_lead_id || ''] && <span> · {empMap[p.area_lead_id!]}</span>}
                    </div>
                    <ProgressBar pct={p.advance_pct || 0} />
                    {pOverdue.length > 0 && (
                      <div style={{ fontSize: 10, color: '#EF4444', marginTop: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                        <AlertTriangle size={9} /> {pOverdue.length} tarea{pOverdue.length > 1 ? 's' : ''} vencida{pOverdue.length > 1 ? 's' : ''}
                      </div>
                    )}
                    {/* Inline tasks (compact, max 3) */}
                    {pTasks.length > 0 && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #1a1a1a' }}>
                        {pTasks.slice(0, 3).map(t => (
                          <div key={t.id} style={{ fontSize: 11, color: t.due_date && t.due_date < now ? '#EF4444' : '#888', padding: '2px 0', display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.name}</span>
                            {t.due_date && <span style={{ flexShrink: 0, marginLeft: 8, fontSize: 10 }}>{formatDate(t.due_date)}</span>}
                          </div>
                        ))}
                        {pTasks.length > 3 && <div style={{ fontSize: 10, color: '#444', paddingTop: 2 }}>+{pTasks.length - 3} más</div>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* COL 3 — Cotizaciones */}
        <div>
          <CollapsibleHeader title="Cotizaciones" count={activeCotizaciones.length} icon={<Briefcase size={15} />} expanded={expandedSections.cotizaciones} onToggle={() => toggle('cotizaciones')} />
          {expandedSections.cotizaciones && (
            <div style={{ maxHeight: 450, overflowY: 'auto' }}>
              {activeCotizaciones.length === 0 && <EmptyState text="Sin cotizaciones activas" />}
              {/* Stage summary mini-bar */}
              {activeCotizaciones.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  {cotsByStage.filter(s => s.count > 0).map(s => (
                    <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: s.color }}>
                      <div style={{ width: 6, height: 6, borderRadius: 3, background: s.color }} />
                      {s.count} {s.label}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {activeCotizaciones.map(q => (
                  <QuotRow key={q.id} quot={q} empMap={empMap} onClick={() => navigate(`/cotizaciones#${q.id}:${q.specialty}`)} />
                ))}
              </div>
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

function OverdueAlert({ tasks, empMap }: { tasks: ProjectTask[]; empMap?: Record<string, string> }) {
  return (
    <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#EF4444', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertTriangle size={14} /> {tasks.length} tarea{tasks.length > 1 ? 's' : ''} vencida{tasks.length > 1 ? 's' : ''}
      </div>
      {tasks.slice(0, 6).map(t => (
        <div key={t.id} style={{ fontSize: 12, color: '#ccc', padding: '3px 0', display: 'flex', justifyContent: 'space-between' }}>
          <span>
            <span style={{ fontWeight: 500, color: '#fff' }}>{t.name}</span>
            <span style={{ color: '#666' }}> — {t.project_name}</span>
            {empMap && t.assignee_id && empMap[t.assignee_id] && (
              <span style={{ color: '#888' }}> · {empMap[t.assignee_id]}</span>
            )}
          </span>
          <span style={{ color: '#EF4444', fontSize: 11 }}>{t.due_date ? formatDate(t.due_date) : ''}</span>
        </div>
      ))}
    </div>
  )
}

function TaskRow({ task, now, onClick, showAssignee, empMap, compact }: {
  task: ProjectTask; now: string; onClick: () => void; showAssignee?: boolean; empMap?: Record<string, string>; compact?: boolean
}) {
  const isOverdue = task.due_date && task.due_date < now
  return (
    <div onClick={onClick} style={{
      ...card,
      padding: compact ? '8px 14px' : '10px 14px',
      cursor: 'pointer',
      borderLeft: `3px solid ${isOverdue ? '#EF4444' : task.status === 'en_progreso' ? '#3B82F6' : '#333'}`,
    }}
      onMouseEnter={e => cardHover(e, true)} onMouseLeave={e => cardHover(e, false)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: compact ? 12 : 13, fontWeight: 500, color: isOverdue ? '#EF4444' : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {task.name}
          </div>
          {!compact && (
            <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
              {task.project_name}
              {showAssignee && task.assignee_id && empMap && (
                <span style={{ color: '#666' }}> · {empMap[task.assignee_id]}</span>
              )}
            </div>
          )}
          {compact && showAssignee && task.assignee_id && empMap && (
            <span style={{ fontSize: 10, color: '#666' }}>{empMap[task.assignee_id]}</span>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
          {task.due_date && (
            <div style={{ fontSize: 11, color: isOverdue ? '#EF4444' : '#888', fontWeight: isOverdue ? 600 : 400 }}>
              {formatDate(task.due_date)}
            </div>
          )}
          {task.progress > 0 && !compact && (
            <div style={{ width: 60, marginTop: 4 }}>
              <ProgressBar pct={task.progress} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function QuotRow({ quot, empMap, onClick }: { quot: Quotation; empMap?: Record<string, string>; onClick: () => void }) {
  const days = daysSince(quot.stage_changed_at || quot.updated_at || quot.created_at)
  return (
    <div onClick={onClick} style={{
      ...card, padding: '10px 14px', cursor: 'pointer',
      borderLeft: `3px solid ${STAGE_COLORS[quot.stage] || '#333'}`,
    }}
      onMouseEnter={e => cardHover(e, true)} onMouseLeave={e => cardHover(e, false)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>{quot.name || quot.client_name}</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
            {quot.client_name}
            {empMap && quot.assignee_id && empMap[quot.assignee_id] && (
              <span> · {empMap[quot.assignee_id]}</span>
            )}
            {!quot.assignee_id && <span style={{ color: '#F59E0B' }}> · Sin asignar</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Badge label={STAGE_LABELS[quot.stage] || quot.stage} color={STAGE_COLORS[quot.stage] || '#888'} />
          <div style={{ fontSize: 10, color: days > 7 ? '#F59E0B' : '#555', marginTop: 4 }}>{days}d en etapa</div>
        </div>
      </div>
    </div>
  )
}

function ProjectRow({ project, tasks, onClick, empMap }: {
  project: Project; tasks: ProjectTask[]; onClick: () => void; empMap?: Record<string, string>
}) {
  const cfg = SPECIALTY_CONFIG[project.specialty as keyof typeof SPECIALTY_CONFIG]
  const pendingCount = tasks.filter(t => t.status !== 'completada').length
  const totalCount = tasks.length
  const pct = totalCount > 0 ? Math.round(((totalCount - pendingCount) / totalCount) * 100) : (project.advance_pct || 0)

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
          <div style={{ fontSize: 11, color: '#888' }}>{pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}</div>
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
