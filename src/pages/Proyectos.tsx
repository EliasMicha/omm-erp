import { useState, useMemo, useEffect } from 'react'
import { Badge, ProgressBar, Btn, SectionHeader, EmptyState, Loading } from '../components/layout/UI'
import { X, ChevronDown, Check, Clock, Lock, Calendar, ArrowLeft, FileText, Plus, ExternalLink, Trash2, Star, AlertCircle, Filter } from 'lucide-react'
import { formatDate } from '../lib/utils'
import { supabase } from '../lib/supabase'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

type Specialty = 'esp' | 'elec' | 'ilum' | 'cort' | 'proy'
type ProjectStatus = 'activo' | 'pausado' | 'completado' | 'cancelado'
type TaskStatus = 'pendiente' | 'en_progreso' | 'bloqueada' | 'completada'
type PhaseStatus = 'pendiente' | 'en_progreso' | 'completada' | 'bloqueada'

interface ProjectRow {
  id: string
  name: string
  client_name: string
  specialty: Specialty | null
  status: ProjectStatus
  contract_value: number
  start_date: string | null
  end_date_planned: string | null
  advance_pct: number
  area_lead_id: string | null
  cotizacion_id: string | null
  created_at: string
  notes: string | null
}

interface PhaseRow {
  id: string
  project_id: string
  name: string
  order_index: number
  is_post_sale: boolean
  is_unlocked: boolean
  status: PhaseStatus
  template_id: string | null
}

interface TaskRow {
  id: string
  project_id: string
  phase_id: string
  template_id: string | null
  name: string
  description: string | null
  assignee_id: string | null
  status: TaskStatus
  priority: number
  progress: number
  due_date: string | null
  system: string | null
  area: string | null
  order_index: number
  notes: string | null
}

interface SubtaskRow {
  id: string
  task_id: string
  text: string
  completed: boolean
  order_index: number
}

interface EmployeeRow {
  id: string
  name: string
  role: string
}

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

const SPECIALTY_CONFIG: Record<Specialty, { label: string; short: string; color: string; icon: string; leader: string }> = {
  esp:  { label: 'Especialidades', short: 'ESP',  color: '#57FF9A', icon: '◈', leader: 'Alfredo Rosas' },
  ilum: { label: 'Iluminación',    short: 'ILU',  color: '#C084FC', icon: '◇', leader: 'Juan Pablo' },
  elec: { label: 'Eléctrico',      short: 'ELEC', color: '#FFB347', icon: '◉', leader: 'Ricardo Flores' },
  cort: { label: 'Cortinas',       short: 'CORT', color: '#67E8F9', icon: '◐', leader: '' },
  proy: { label: 'Proyecto',       short: 'PROY', color: '#F472B6', icon: '◓', leader: '' },
}

const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string }> = {
  activo:     { label: 'Activo',     color: '#57FF9A' },
  pausado:    { label: 'Pausado',    color: '#F59E0B' },
  completado: { label: 'Completado', color: '#3B82F6' },
  cancelado:  { label: 'Cancelado',  color: '#6B7280' },
}

const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  pendiente:    { label: 'Pendiente',    color: '#6B7280' },
  en_progreso:  { label: 'En progreso',  color: '#3B82F6' },
  bloqueada:    { label: 'Bloqueada',    color: '#EF4444' },
  completada:   { label: 'Completada',   color: '#57FF9A' },
}

const ESP_SYSTEMS = ['CCTV', 'Audio', 'Redes', 'Acceso', 'Iluminacion', 'Humo', 'BMS', 'Telefonia', 'Celular', 'Cortinas']

const SYSTEM_COLORS: Record<string, string> = {
  CCTV:        '#3B82F6',
  Audio:       '#8B5CF6',
  Redes:       '#06B6D4',
  Acceso:      '#F59E0B',
  Iluminacion: '#C084FC',
  Humo:        '#EF4444',
  BMS:         '#10B981',
  Telefonia:   '#F97316',
  Celular:     '#EC4899',
  Cortinas:    '#67E8F9',
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function calcPhaseProgress(tasks: TaskRow[]): number {
  if (tasks.length === 0) return 0
  return Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length)
}

function calcProjectProgress(phases: PhaseRow[], tasks: TaskRow[]): number {
  const visiblePhases = phases.filter(p => p.is_unlocked && !p.is_post_sale)
  if (visiblePhases.length === 0) return 0
  const phaseAvgs = visiblePhases.map(p => calcPhaseProgress(tasks.filter(t => t.phase_id === p.id)))
  return Math.round(phaseAvgs.reduce((a, b) => a + b, 0) / phaseAvgs.length)
}

function getActivePhase(phases: PhaseRow[], tasks: TaskRow[]): PhaseRow | null {
  const visible = phases.filter(p => p.is_unlocked).sort((a, b) => a.order_index - b.order_index)
  for (const p of visible) {
    if (calcPhaseProgress(tasks.filter(t => t.phase_id === p.id)) < 100) return p
  }
  return visible[visible.length - 1] || null
}

// ═══════════════════════════════════════════════════════════════════
// MAIN MODULE
// ═══════════════════════════════════════════════════════════════════

export default function Proyectos() {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<'todos' | ProjectStatus>('todos')
  const [areaTab, setAreaTab] = useState<'TODAS' | Specialty>('TODAS')
  const [showNewModal, setShowNewModal] = useState(false)

  const [allPhases, setAllPhases] = useState<PhaseRow[]>([])
  const [allTasks, setAllTasks] = useState<TaskRow[]>([])

  async function loadAll() {
    setLoading(true)
    setLoadError(null)
    try {
      const [projRes, empRes, phasesRes, tasksRes] = await Promise.all([
        supabase.from('projects').select('*').order('created_at', { ascending: false }),
        supabase.from('employees').select('id,name,role').eq('is_active', true),
        supabase.from('project_phases').select('*'),
        supabase.from('project_tasks').select('id,project_id,phase_id,template_id,name,description,assignee_id,status,priority,progress,due_date,system,area,order_index,notes'),
      ])
      if (projRes.error) throw new Error('projects: ' + projRes.error.message)
      if (empRes.error) throw new Error('employees: ' + empRes.error.message)
      if (phasesRes.error) throw new Error('project_phases: ' + phasesRes.error.message + ' — ¿ya ejecutaste la migration SQL?')
      if (tasksRes.error) throw new Error('project_tasks: ' + tasksRes.error.message)
      setProjects((projRes.data || []) as ProjectRow[])
      setEmployees((empRes.data || []) as EmployeeRow[])
      setAllPhases((phasesRes.data || []) as PhaseRow[])
      setAllTasks((tasksRes.data || []) as TaskRow[])
    } catch (err: any) {
      setLoadError(err?.message || String(err))
    }
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  const selected = projects.find(p => p.id === selectedId) || null

  const stats = useMemo(() => {
    const scoped = areaTab === 'TODAS' ? projects : projects.filter(p => p.specialty === areaTab)
    const active = scoped.filter(p => p.status === 'activo').length
    let totalProgress = 0
    let projectsWithProgress = 0
    scoped.forEach(p => {
      const phases = allPhases.filter(ph => ph.project_id === p.id)
      const tasks = allTasks.filter(t => t.project_id === p.id)
      if (phases.length > 0) {
        totalProgress += calcProjectProgress(phases, tasks)
        projectsWithProgress++
      }
    })
    const avg = projectsWithProgress > 0 ? Math.round(totalProgress / projectsWithProgress) : 0
    let overdueTasks = 0
    const now = new Date()
    scoped.forEach(p => {
      allTasks.filter(t => t.project_id === p.id && t.status !== 'completada').forEach(t => {
        if (t.due_date && new Date(t.due_date) < now) overdueTasks++
      })
    })
    return { active, avg, total: scoped.length, overdueTasks }
  }, [projects, areaTab, allPhases, allTasks])

  const lista = useMemo(() => {
    let filtered = areaTab === 'TODAS' ? [...projects] : projects.filter(p => p.specialty === areaTab)
    if (filtroStatus !== 'todos') filtered = filtered.filter(p => p.status === filtroStatus)
    return filtered
  }, [projects, areaTab, filtroStatus])

  function handleProjectCreated() {
    loadAll()
    setShowNewModal(false)
  }

  if (loading) return <div style={{ padding: 32 }}><Loading /></div>

  return (
    <div style={{ padding: '24px 28px' }}>
      {loadError && (
        <div style={{ marginBottom: 16, padding: '12px 14px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 8, color: '#f87171', fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠ Error al cargar proyectos</div>
          <div>{loadError}</div>
        </div>
      )}

      {view === 'list' && (
        <>
          <SectionHeader
            title="Proyectos — Ingeniería y Diseño"
            subtitle={`${stats.total} proyectos${areaTab !== 'TODAS' ? ' · ' + (SPECIALTY_CONFIG[areaTab]?.label || '') : ''}`}
            action={
              <Btn variant="primary" onClick={() => setShowNewModal(true)}><Plus size={12} /> Nuevo proyecto</Btn>
            }
          />

          <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#111', borderRadius: 10, padding: 4, border: '1px solid #1e1e1e', flexWrap: 'wrap' }}>
            {(['TODAS', 'esp', 'ilum', 'elec'] as const).map(tabId => {
              const on = areaTab === tabId
              const cfg = tabId !== 'TODAS' ? SPECIALTY_CONFIG[tabId] : null
              const tabColor = cfg ? cfg.color : '#888'
              const tabLabel = cfg ? cfg.label : 'Todas'
              const tabIcon = cfg ? cfg.icon : ''
              const count = tabId === 'TODAS' ? projects.length : projects.filter(p => p.specialty === tabId).length
              return (
                <button key={tabId} onClick={() => setAreaTab(tabId as any)} style={{
                  padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', border: 'none',
                  background: on ? tabColor + '18' : 'transparent',
                  color: on ? tabColor : '#555',
                  fontWeight: on ? 700 : 400,
                }}>
                  {tabIcon ? tabIcon + ' ' : ''}{tabLabel}
                  <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: on ? tabColor + '22' : '#1a1a1a', color: on ? tabColor : '#444' }}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <KpiBox label="Proyectos activos" value={stats.active} color="#57FF9A" />
            <KpiBox label="Avance promedio" value={`${stats.avg}%`} color="#3B82F6" />
            <KpiBox label="Total proyectos" value={stats.total} color="#C084FC" />
            <KpiBox label="Tareas vencidas" value={stats.overdueTasks} color={stats.overdueTasks > 0 ? '#EF4444' : '#6B7280'} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#666' }}><Filter size={11} style={{ verticalAlign: 'middle' }} /> Estado:</span>
            {(['todos', 'activo', 'pausado', 'completado'] as const).map(s => (
              <button key={s} onClick={() => setFiltroStatus(s)} style={{
                padding: '5px 12px', fontSize: 11, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                background: filtroStatus === s ? '#57FF9A18' : '#0a0a0a',
                border: filtroStatus === s ? '1px solid #57FF9A66' : '1px solid #222',
                color: filtroStatus === s ? '#57FF9A' : '#666',
              }}>
                {s === 'todos' ? 'Todos' : STATUS_CONFIG[s as ProjectStatus]?.label}
              </button>
            ))}
          </div>

          {lista.length === 0 ? (
            <EmptyState message={projects.length === 0 ? "No hay proyectos. Click en 'Nuevo proyecto' para crear el primero." : "Sin proyectos con los filtros aplicados"} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
              {lista.map(p => {
                const phases = allPhases.filter(ph => ph.project_id === p.id)
                const tasks = allTasks.filter(t => t.project_id === p.id)
                return (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    phases={phases}
                    tasks={tasks}
                    onClick={() => { setSelectedId(p.id); setView('detail') }}
                  />
                )
              })}
            </div>
          )}
        </>
      )}

      {view === 'detail' && selected && (
        <ProjectDetail
          project={selected}
          employees={employees}
          onBack={() => { setView('list'); loadAll() }}
        />
      )}

      {showNewModal && (
        <NewProjectModal
          employees={employees}
          onClose={() => setShowNewModal(false)}
          onCreated={handleProjectCreated}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// KPI BOX
// ═══════════════════════════════════════════════════════════════════

function KpiBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '14px 18px', borderTop: `2px solid ${color}55` }}>
      <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PROJECT CARD
// ═══════════════════════════════════════════════════════════════════

function ProjectCard({ project, phases, tasks, onClick }: {
  project: ProjectRow; phases: PhaseRow[]; tasks: TaskRow[]; onClick: () => void
}) {
  const progress = calcProjectProgress(phases, tasks)
  const active = getActivePhase(phases, tasks)
  const stCfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.activo
  const specCfg = project.specialty ? SPECIALTY_CONFIG[project.specialty] : null
  const tienePostventa = phases.some(p => p.is_post_sale && p.is_unlocked)

  return (
    <div onClick={onClick} style={{
      background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '16px 18px', cursor: 'pointer',
      borderTop: '2px solid ' + (specCfg?.color || stCfg.color) + '55', transition: 'border-color 0.15s'
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = (specCfg?.color || stCfg.color) + '88' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#222' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            {specCfg && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: specCfg.color + '22', color: specCfg.color, border: '1px solid ' + specCfg.color + '44', letterSpacing: '0.05em' }}>{specCfg.short}</span>
            )}
            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{project.name}</span>
          </div>
          <div style={{ fontSize: 11, color: '#555' }}>{project.client_name}</div>
        </div>
        <Badge label={stCfg.label} color={stCfg.color} />
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555', marginBottom: 4 }}>
          <span>Avance de ingeniería</span>
          <span style={{ fontWeight: 700, color: progress >= 100 ? '#57FF9A' : '#3B82F6' }}>{progress}%</span>
        </div>
        <ProgressBar pct={progress} color={progress >= 100 ? '#57FF9A' : '#3B82F6'} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid #1e1e1e', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#555' }}>
          <Clock size={10} /> {active ? `Fase: ${active.name}` : 'Sin fases'}
        </div>
        {tienePostventa && (
          <span style={{ fontSize: 9, color: '#57FF9A', padding: '2px 6px', borderRadius: 4, background: '#57FF9A11', border: '1px solid #57FF9A33' }}>● Postventa</span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#555' }}>
          <Calendar size={10} /> {formatDate(project.created_at)}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PROJECT DETAIL
// ═══════════════════════════════════════════════════════════════════

function ProjectDetail({ project, employees, onBack }: {
  project: ProjectRow; employees: EmployeeRow[]; onBack: () => void
}) {
  const [phases, setPhases] = useState<PhaseRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [subtasks, setSubtasks] = useState<SubtaskRow[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [hydrateError, setHydrateError] = useState<string | null>(null)
  const [tab, setTab] = useState<'tareas' | 'documentos'>('tareas')
  const [hasContractedQuote, setHasContractedQuote] = useState(false)

  async function hydrate() {
    setHydrated(false)
    setHydrateError(null)
    try {
      const [phaseRes, taskRes] = await Promise.all([
        supabase.from('project_phases').select('*').eq('project_id', project.id).order('order_index'),
        supabase.from('project_tasks').select('*').eq('project_id', project.id).order('order_index'),
      ])
      if (phaseRes.error) throw new Error(phaseRes.error.message)
      if (taskRes.error) throw new Error(taskRes.error.message)
      const loadedPhases = (phaseRes.data || []) as PhaseRow[]
      const loadedTasks = (taskRes.data || []) as TaskRow[]
      setPhases(loadedPhases)
      setTasks(loadedTasks)

      // Cargar subtasks solo para tareas de este proyecto
      if (loadedTasks.length > 0) {
        const taskIds = loadedTasks.map(t => t.id)
        const { data: subsData, error: subsErr } = await supabase
          .from('project_task_subtasks').select('*').in('task_id', taskIds).order('order_index')
        if (subsErr) throw new Error(subsErr.message)
        setSubtasks((subsData || []) as SubtaskRow[])
      } else {
        setSubtasks([])
      }

      // Verificar si hay cotización ligada en estado contrato
      if (project.cotizacion_id) {
        const { data: cot } = await supabase.from('quotations').select('stage').eq('id', project.cotizacion_id).maybeSingle()
        setHasContractedQuote(cot?.stage === 'contrato')
      } else {
        const { data: cots } = await supabase.from('quotations').select('id,stage').eq('project_id', project.id)
        setHasContractedQuote((cots || []).some((c: any) => c.stage === 'contrato'))
      }
      setHydrated(true)
    } catch (err: any) {
      setHydrateError(err?.message || String(err))
      setHydrated(true)
    }
  }

  useEffect(() => { hydrate() /* eslint-disable-next-line */ }, [project.id])

  const specCfg = project.specialty ? SPECIALTY_CONFIG[project.specialty] : null
  const totalProgress = calcProjectProgress(phases, tasks)

  async function unlockPostSale() {
    const lockedPostSale = phases.filter(p => p.is_post_sale && !p.is_unlocked)
    if (lockedPostSale.length === 0) return
    const updates = lockedPostSale.map(p => p.id)
    await supabase.from('project_phases').update({ is_unlocked: true, unlocked_at: new Date().toISOString() }).in('id', updates)
    hydrate()
  }

  useEffect(() => {
    if (hydrated && hasContractedQuote) {
      const lockedPost = phases.filter(p => p.is_post_sale && !p.is_unlocked)
      if (lockedPost.length > 0) unlockPostSale()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContractedQuote, hydrated])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Btn onClick={onBack}><ArrowLeft size={14} /> Atrás</Btn>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {specCfg && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: specCfg.color + '22', color: specCfg.color, border: '1px solid ' + specCfg.color + '44', letterSpacing: '0.05em' }}>{specCfg.short}</span>
            )}
            <span style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>{project.name}</span>
          </div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
            {project.client_name} · Creado {formatDate(project.created_at)}
            {specCfg?.leader && <> · Líder: {specCfg.leader}</>}
          </div>
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: totalProgress >= 100 ? '#57FF9A' : '#3B82F6' }}>{totalProgress}%</span>
        <Badge label={STATUS_CONFIG[project.status]?.label || 'Activo'} color={STATUS_CONFIG[project.status]?.color || '#57FF9A'} />
      </div>

      {hydrateError && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 8, color: '#f87171', fontSize: 12 }}>
          ⚠ {hydrateError}
        </div>
      )}

      {!hydrated && <Loading />}

      {hydrated && (
        <>
          <PhaseTimeline phases={phases} tasks={tasks} hasContract={hasContractedQuote} />

          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #222', marginBottom: 16, marginTop: 20 }}>
            {[
              { key: 'tareas' as const, label: 'Tareas por fase', icon: Check },
              { key: 'documentos' as const, label: 'Documentación técnica', icon: FileText },
            ].map(({ key, label, icon: Icon }) => {
              const active = tab === key
              return (
                <button key={key} onClick={() => setTab(key)} style={{
                  padding: '8px 14px', fontSize: 12, fontWeight: active ? 600 : 400,
                  color: active ? '#57FF9A' : '#666',
                  background: active ? 'rgba(87,255,154,0.08)' : 'transparent',
                  border: 'none', borderBottom: active ? '2px solid #57FF9A' : '2px solid transparent',
                  cursor: 'pointer', fontFamily: 'inherit', borderRadius: '8px 8px 0 0',
                }}>
                  <Icon size={13} style={{ marginRight: 6 }} />{label}
                </button>
              )
            })}
          </div>

          {tab === 'tareas' && (
            <TaskTable
              project={project}
              phases={phases}
              tasks={tasks}
              subtasks={subtasks}
              employees={employees}
              onChange={hydrate}
            />
          )}

          {tab === 'documentos' && <ProjectDocumentosTab projectId={project.id} projectName={project.name} />}
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PHASE TIMELINE
// ═══════════════════════════════════════════════════════════════════

function PhaseTimeline({ phases, tasks, hasContract }: { phases: PhaseRow[]; tasks: TaskRow[]; hasContract: boolean }) {
  const sorted = [...phases].sort((a, b) => a.order_index - b.order_index)
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {sorted.map(p => {
          const ptasks = tasks.filter(t => t.phase_id === p.id)
          const prog = calcPhaseProgress(ptasks)
          const locked = !p.is_unlocked
          const color = locked ? '#333' : prog >= 100 ? '#57FF9A' : prog > 0 ? '#3B82F6' : '#6B7280'
          return (
            <div key={p.id} style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 11, fontFamily: 'inherit',
              background: locked ? '#0a0a0a' : color + '15',
              border: `1px solid ${locked ? '#222' : color + '55'}`,
              color: locked ? '#444' : color,
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: locked ? 0.6 : 1,
            }}>
              {locked && <Lock size={10} />}
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              {!locked && (
                <span style={{ fontSize: 9, padding: '1px 5px', background: color + '22', borderRadius: 4 }}>{prog}%</span>
              )}
              {p.is_post_sale && !locked && <span style={{ fontSize: 8 }}>●</span>}
            </div>
          )
        })}
      </div>
      {!hasContract && phases.some(p => p.is_post_sale && !p.is_unlocked) && (
        <div style={{ fontSize: 10, color: '#555', marginBottom: 6, padding: '6px 10px', background: '#0a0a0a', border: '1px solid #222', borderRadius: 6, display: 'inline-block' }}>
          <Lock size={9} style={{ verticalAlign: 'middle' }} /> Las fases de postventa se activan automáticamente cuando una cotización ligada al proyecto pasa a "contrato"
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TASK TABLE — vista plana agrupada por fase
// ═══════════════════════════════════════════════════════════════════

function TaskTable({ project, phases, tasks, subtasks, employees, onChange }: {
  project: ProjectRow
  phases: PhaseRow[]
  tasks: TaskRow[]
  subtasks: SubtaskRow[]
  employees: EmployeeRow[]
  onChange: () => void
}) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [showNewTaskInPhase, setShowNewTaskInPhase] = useState<string | null>(null)
  const [newTask, setNewTask] = useState({ name: '', assignee_id: '', priority: 0, due_date: '' })
  const isESP = project.specialty === 'esp'

  const sortedPhases = [...phases].sort((a, b) => a.order_index - b.order_index)

  async function toggleSubtask(sub: SubtaskRow) {
    const newCompleted = !sub.completed
    await supabase.from('project_task_subtasks').update({ completed: newCompleted }).eq('id', sub.id)
    const taskSubs = subtasks.filter(s => s.task_id === sub.task_id)
    const newSubs = taskSubs.map(s => s.id === sub.id ? { ...s, completed: newCompleted } : s)
    const total = newSubs.length
    const done = newSubs.filter(s => s.completed).length
    const newProgress = total > 0 ? Math.round((done / total) * 100) : 0
    const newStatus: TaskStatus = newProgress === 100 ? 'completada' : newProgress > 0 ? 'en_progreso' : 'pendiente'
    await supabase.from('project_tasks').update({ progress: newProgress, status: newStatus, completed_at: newProgress === 100 ? new Date().toISOString() : null }).eq('id', sub.task_id)
    onChange()
  }

  async function changeTaskStatus(task: TaskRow, status: TaskStatus) {
    const progress = status === 'completada' ? 100 : status === 'pendiente' ? 0 : task.progress
    await supabase.from('project_tasks').update({ status, progress, completed_at: status === 'completada' ? new Date().toISOString() : null }).eq('id', task.id)
    onChange()
  }

  async function changeTaskAssignee(task: TaskRow, assigneeId: string) {
    await supabase.from('project_tasks').update({ assignee_id: assigneeId || null }).eq('id', task.id)
    onChange()
  }

  async function changeTaskPriority(task: TaskRow, priority: number) {
    await supabase.from('project_tasks').update({ priority }).eq('id', task.id)
    onChange()
  }

  async function changeTaskDueDate(task: TaskRow, dueDate: string) {
    await supabase.from('project_tasks').update({ due_date: dueDate || null }).eq('id', task.id)
    onChange()
  }

  async function changeTaskSystem(task: TaskRow, system: string) {
    await supabase.from('project_tasks').update({ system: system || null }).eq('id', task.id)
    onChange()
  }

  async function addNewTask(phaseId: string) {
    if (!newTask.name.trim()) return
    const phaseTasks = tasks.filter(t => t.phase_id === phaseId)
    const orderIndex = phaseTasks.length
    await supabase.from('project_tasks').insert({
      project_id: project.id,
      phase_id: phaseId,
      name: newTask.name.trim(),
      assignee_id: newTask.assignee_id || null,
      priority: newTask.priority,
      due_date: newTask.due_date || null,
      status: 'pendiente',
      progress: 0,
      order_index: orderIndex,
    })
    setNewTask({ name: '', assignee_id: '', priority: 0, due_date: '' })
    setShowNewTaskInPhase(null)
    onChange()
  }

  async function deleteTask(task: TaskRow) {
    if (!confirm(`¿Eliminar la tarea "${task.name}"? También se borrarán sus subtareas.`)) return
    await supabase.from('project_tasks').delete().eq('id', task.id)
    onChange()
  }

  async function addSubtask(taskId: string, text: string) {
    if (!text.trim()) return
    const taskSubs = subtasks.filter(s => s.task_id === taskId)
    await supabase.from('project_task_subtasks').insert({
      task_id: taskId,
      text: text.trim(),
      completed: false,
      order_index: taskSubs.length,
    })
    onChange()
  }

  async function deleteSubtask(subId: string) {
    await supabase.from('project_task_subtasks').delete().eq('id', subId)
    onChange()
  }

  return (
    <div>
      {sortedPhases.length === 0 && (
        <EmptyState message="Este proyecto no tiene fases. Crea un proyecto nuevo desde el botón 'Nuevo proyecto' que asigna fases automáticamente." />
      )}

      {sortedPhases.map(phase => {
        const phaseTasks = tasks.filter(t => t.phase_id === phase.id).sort((a, b) => a.order_index - b.order_index)
        const phaseProgress = calcPhaseProgress(phaseTasks)
        const locked = !phase.is_unlocked

        return (
          <div key={phase.id} style={{ marginBottom: 20, opacity: locked ? 0.5 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '10px 14px', background: locked ? '#0a0a0a' : '#141414', border: '1px solid #222', borderRadius: 8 }}>
              {locked && <Lock size={12} color="#555" />}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: locked ? '#555' : '#fff' }}>
                  {phase.name}
                  {phase.is_post_sale && <span style={{ fontSize: 9, marginLeft: 8, color: '#57FF9A' }}>● POSTVENTA</span>}
                </div>
                <div style={{ fontSize: 10, color: '#555' }}>{phaseTasks.length} tarea{phaseTasks.length !== 1 ? 's' : ''} · {phaseProgress}% avance</div>
              </div>
              {!locked && (
                <Btn size="sm" variant="default" onClick={() => setShowNewTaskInPhase(phase.id)}><Plus size={11} /> Tarea</Btn>
              )}
            </div>

            {showNewTaskInPhase === phase.id && (
              <div style={{ padding: 12, background: '#141414', border: '1px solid #57FF9A33', borderRadius: 8, marginBottom: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Nombre de la tarea</div>
                    <input value={newTask.name} onChange={e => setNewTask(t => ({ ...t, name: e.target.value }))}
                      placeholder="Ej: Plano de planta definitivo"
                      style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit' }}
                      autoFocus
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Asignar a</div>
                    <select value={newTask.assignee_id} onChange={e => setNewTask(t => ({ ...t, assignee_id: e.target.value }))}
                      style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit' }}
                    >
                      <option value="">— Sin asignar —</option>
                      {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Prioridad</div>
                    <select value={newTask.priority} onChange={e => setNewTask(t => ({ ...t, priority: Number(e.target.value) }))}
                      style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit' }}
                    >
                      <option value={0}>—</option>
                      <option value={1}>Baja</option>
                      <option value={2}>Media</option>
                      <option value={3}>Alta</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Fecha límite</div>
                    <input type="date" value={newTask.due_date} onChange={e => setNewTask(t => ({ ...t, due_date: e.target.value }))}
                      style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Btn size="sm" variant="default" onClick={() => { setShowNewTaskInPhase(null); setNewTask({ name: '', assignee_id: '', priority: 0, due_date: '' }) }}>Cancelar</Btn>
                    <Btn size="sm" variant="primary" onClick={() => addNewTask(phase.id)}>Crear</Btn>
                  </div>
                </div>
              </div>
            )}

            {phaseTasks.length === 0 && !locked && (
              <div style={{ padding: '12px 14px', fontSize: 11, color: '#555', textAlign: 'center' }}>
                Sin tareas. Click en "+ Tarea" para agregar la primera.
              </div>
            )}

            {phaseTasks.map(task => {
              const taskSubs = subtasks.filter(s => s.task_id === task.id).sort((a, b) => a.order_index - b.order_index)
              const expanded = expandedTaskId === task.id
              const assignee = employees.find(e => e.id === task.assignee_id)
              const stCfg = TASK_STATUS_CONFIG[task.status]
              const overdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completada'

              return (
                <div key={task.id} style={{
                  background: '#141414', border: '1px solid ' + (overdue ? '#EF444455' : '#222'), borderRadius: 10,
                  padding: '10px 14px', marginBottom: 6,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button onClick={() => setExpandedTaskId(expanded ? null : task.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#555' }}>
                      <ChevronDown size={14} style={{ transform: expanded ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
                    </button>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {task.name}
                        {overdue && <AlertCircle size={11} color="#EF4444" />}
                      </div>
                      <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
                        {taskSubs.length > 0 && <span>{taskSubs.filter(s => s.completed).length}/{taskSubs.length} subtareas</span>}
                        {task.due_date && <span style={{ marginLeft: 8, color: overdue ? '#EF4444' : '#555' }}>● {formatDate(task.due_date)}</span>}
                      </div>
                    </div>

                    {isESP && (
                      <select value={task.system || ''} onChange={e => changeTaskSystem(task, e.target.value)}
                        style={{ padding: '4px 8px', fontSize: 10, background: task.system ? (SYSTEM_COLORS[task.system] || '#333') + '22' : '#0a0a0a', border: `1px solid ${task.system ? (SYSTEM_COLORS[task.system] || '#333') + '66' : '#333'}`, borderRadius: 5, color: task.system ? (SYSTEM_COLORS[task.system] || '#999') : '#666', fontFamily: 'inherit' }}
                      >
                        <option value="">Sistema</option>
                        {ESP_SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}

                    <select value={task.assignee_id || ''} onChange={e => changeTaskAssignee(task, e.target.value)}
                      style={{ padding: '4px 8px', fontSize: 10, background: '#0a0a0a', border: '1px solid #333', borderRadius: 5, color: assignee ? '#57FF9A' : '#666', fontFamily: 'inherit', minWidth: 100 }}
                    >
                      <option value="">— Sin —</option>
                      {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>

                    <div style={{ display: 'flex', gap: 1 }}>
                      {[1, 2, 3].map(n => (
                        <button key={n} onClick={() => changeTaskPriority(task, task.priority === n ? 0 : n)} style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: 1,
                          color: task.priority >= n ? '#F59E0B' : '#333',
                        }}><Star size={11} fill={task.priority >= n ? '#F59E0B' : 'none'} /></button>
                      ))}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 100 }}>
                      <div style={{ width: 50 }}>
                        <ProgressBar pct={task.progress} color={stCfg.color} />
                      </div>
                      <span style={{ fontSize: 10, color: stCfg.color, fontWeight: 600, minWidth: 28 }}>{task.progress}%</span>
                    </div>

                    <select value={task.status} onChange={e => changeTaskStatus(task, e.target.value as TaskStatus)}
                      style={{ padding: '4px 8px', fontSize: 10, background: stCfg.color + '15', border: `1px solid ${stCfg.color}55`, borderRadius: 5, color: stCfg.color, fontFamily: 'inherit' }}
                    >
                      {(Object.entries(TASK_STATUS_CONFIG) as Array<[TaskStatus, typeof stCfg]>).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>

                    <button onClick={() => deleteTask(task)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#444' }} title="Eliminar tarea">
                      <Trash2 size={11} />
                    </button>
                  </div>

                  {expanded && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e1e1e' }}>
                      <div style={{ display: 'flex', gap: 16, marginBottom: 12, alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 9, color: '#666', marginBottom: 3 }}>Fecha límite</div>
                          <input type="date" value={task.due_date || ''} onChange={e => changeTaskDueDate(task, e.target.value)}
                            style={{ padding: '4px 8px', fontSize: 11, background: '#0a0a0a', border: '1px solid #333', borderRadius: 5, color: '#fff', fontFamily: 'inherit' }}
                          />
                        </div>
                      </div>

                      <div style={{ fontSize: 10, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subtareas / Checklist</div>
                      {taskSubs.map(sub => (
                        <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                          <button onClick={() => toggleSubtask(sub)} style={{
                            background: sub.completed ? '#57FF9A' : 'transparent', border: '1.5px solid ' + (sub.completed ? '#57FF9A' : '#444'),
                            borderRadius: 3, width: 14, height: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                          }}>
                            {sub.completed && <Check size={9} color="#000" strokeWidth={3} />}
                          </button>
                          <span style={{ fontSize: 11, color: sub.completed ? '#555' : '#bbb', textDecoration: sub.completed ? 'line-through' : 'none', flex: 1 }}>
                            {sub.text}
                          </span>
                          <button onClick={() => deleteSubtask(sub.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#444' }}>
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      <input
                        placeholder="+ Agregar subtarea (Enter)"
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value
                            if (val.trim()) {
                              addSubtask(task.id, val)
                              ;(e.target as HTMLInputElement).value = ''
                            }
                          }
                        }}
                        style={{ width: '100%', padding: '5px 10px', fontSize: 11, background: '#0a0a0a', border: '1px solid #222', borderRadius: 5, color: '#888', fontFamily: 'inherit', marginTop: 4 }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// NEW PROJECT MODAL
// ═══════════════════════════════════════════════════════════════════

function NewProjectModal({ employees, onClose, onCreated }: {
  employees: EmployeeRow[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    name: '', client_name: '', specialty: 'esp' as Specialty, area_lead_id: '', cotizacion_id: '',
  })
  const [cotizaciones, setCotizaciones] = useState<Array<{ id: string; name: string }>>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('quotations').select('id,name').eq('specialty', form.specialty).order('created_at', { ascending: false })
      .then(({ data }) => setCotizaciones(data || []))
  }, [form.specialty])

  async function crear() {
    if (!form.name.trim() || !form.client_name.trim()) {
      setError('Nombre y cliente son obligatorios')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const { data: proj, error: projErr } = await supabase.from('projects').insert({
        name: form.name.trim(),
        client_name: form.client_name.trim(),
        specialty: form.specialty,
        lines: [form.specialty],
        status: 'activo',
        contract_value: 0,
        advance_pct: 0,
        area_lead_id: form.area_lead_id || null,
        cotizacion_id: form.cotizacion_id || null,
      }).select().single()
      if (projErr) throw projErr

      const { data: phaseTemplates, error: ptErr } = await supabase.from('project_phase_templates')
        .select('*').in('specialty', [form.specialty, 'postventa']).order('order_index')
      if (ptErr) throw ptErr

      const phaseInserts = (phaseTemplates || []).map((pt: any) => ({
        project_id: proj.id,
        template_id: pt.id,
        name: pt.name,
        order_index: pt.order_index,
        is_post_sale: pt.is_post_sale,
        is_unlocked: !pt.is_post_sale,
        status: 'pendiente' as const,
      }))
      const { data: insertedPhases, error: phErr } = await supabase.from('project_phases').insert(phaseInserts).select()
      if (phErr) throw phErr

      const phaseTemplateIds = (phaseTemplates || []).map((pt: any) => pt.id)
      const { data: taskTemplates, error: ttErr } = await supabase.from('project_task_templates')
        .select('*').in('phase_template_id', phaseTemplateIds).order('order_index')
      if (ttErr) throw ttErr

      const taskInserts: any[] = []
      for (const tt of (taskTemplates || [])) {
        const phase = (insertedPhases || []).find((p: any) => p.template_id === tt.phase_template_id)
        if (!phase) continue
        taskInserts.push({
          project_id: proj.id,
          phase_id: phase.id,
          template_id: tt.id,
          name: tt.name,
          order_index: tt.order_index,
          status: 'pendiente',
          progress: 0,
          priority: 0,
        })
      }
      let insertedTasks: any[] = []
      if (taskInserts.length > 0) {
        const { data: tdata, error: tErr } = await supabase.from('project_tasks').insert(taskInserts).select()
        if (tErr) throw tErr
        insertedTasks = tdata || []
      }

      const subInserts: any[] = []
      for (const tt of (taskTemplates || [])) {
        if (!tt.default_subtasks || tt.default_subtasks.length === 0) continue
        const insertedTask = insertedTasks.find(it => it.template_id === tt.id)
        if (!insertedTask) continue
        tt.default_subtasks.forEach((text: string, idx: number) => {
          subInserts.push({
            task_id: insertedTask.id,
            text,
            completed: false,
            order_index: idx,
          })
        })
      }
      if (subInserts.length > 0) {
        const { error: sErr } = await supabase.from('project_task_subtasks').insert(subInserts)
        if (sErr) throw sErr
      }

      onCreated()
    } catch (err: any) {
      setError(err?.message || String(err))
    }
    setSaving(false)
  }

  const inputS: React.CSSProperties = {
    width: '100%', padding: '7px 10px', fontSize: 12, background: '#0a0a0a',
    border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit',
  }
  const labelS: React.CSSProperties = { fontSize: 10, color: '#666', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ width: 560, maxWidth: '90vw', background: '#0d0d0d', border: '1px solid #333', borderRadius: 14, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Nuevo proyecto</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={labelS}>Nombre del proyecto *</div>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Reforma 222 - Iluminación" style={inputS} autoFocus />
          </div>

          <div>
            <div style={labelS}>Cliente *</div>
            <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} placeholder="Ej: Inmobiliaria Reforma" style={inputS} />
          </div>

          <div>
            <div style={labelS}>Especialidad</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['esp', 'ilum', 'elec'] as const).map(s => {
                const cfg = SPECIALTY_CONFIG[s]
                const on = form.specialty === s
                return (
                  <button key={s} onClick={() => setForm(f => ({ ...f, specialty: s }))} style={{
                    padding: '8px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                    background: on ? cfg.color + '22' : '#0a0a0a',
                    border: `1px solid ${on ? cfg.color + '88' : '#333'}`,
                    color: on ? cfg.color : '#666',
                    fontWeight: on ? 600 : 400,
                  }}>
                    {cfg.icon} {cfg.label}
                    {cfg.leader && <span style={{ fontSize: 9, marginLeft: 6, color: on ? cfg.color : '#444' }}>({cfg.leader})</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div style={labelS}>Líder del proyecto (opcional)</div>
            <select value={form.area_lead_id} onChange={e => setForm(f => ({ ...f, area_lead_id: e.target.value }))} style={inputS}>
              <option value="">— Sin asignar —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          <div>
            <div style={labelS}>Cotización ligada (opcional)</div>
            <select value={form.cotizacion_id} onChange={e => setForm(f => ({ ...f, cotizacion_id: e.target.value }))} style={inputS}>
              <option value="">— Sin cotización —</option>
              {cotizaciones.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>
              Cuando esta cotización pase a estado "contrato", las fases de postventa se activarán automáticamente.
            </div>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 14, padding: '10px 12px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 6, color: '#f87171', fontSize: 11 }}>⚠ {error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={crear} disabled={saving}>{saving ? 'Creando...' : 'Crear proyecto'}</Btn>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PROJECT DOCUMENTOS TAB
// ═══════════════════════════════════════════════════════════════════

interface ProyectoDocDB {
  id: string
  project_id: string | null
  nombre: string
  tipo: string
  sistema: string | null
  drive_url: string
  drive_thumbnail_url: string | null
  version: string | null
  fecha_subida: string
  notas: string | null
}

const DOC_TIPO_LABEL: Record<string, string> = {
  plano: 'Plano',
  ficha_tecnica: 'Ficha técnica',
  diagrama: 'Diagrama',
  render: 'Render',
  memoria_calculo: 'Memoria de cálculo',
  manual: 'Manual',
  otro: 'Otro',
}

const SISTEMAS_PROYECTO = ['CCTV', 'Audio', 'Redes', 'Control', 'Acceso', 'Electrico', 'Humo', 'BMS', 'Telefonia', 'Celular']

function ProjectDocumentosTab({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [docs, setDocs] = useState<ProyectoDocDB[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({
    nombre: '', tipo: 'plano', sistema: '', drive_url: '', drive_thumbnail_url: '', version: '', notas: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    supabase.from('obra_documentos').select('*').eq('project_id', projectId).order('fecha_subida', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Error cargando documentos:', error)
        setDocs((data || []) as ProyectoDocDB[])
        setLoading(false)
      })
  }, [projectId])

  async function crear() {
    if (!form.nombre.trim() || !form.drive_url.trim()) {
      setSaveError('Nombre y URL de Drive son obligatorios')
      return
    }
    if (!form.drive_url.startsWith('http')) {
      setSaveError('La URL debe empezar con http o https')
      return
    }
    setSaveError(null)
    setSaving(true)
    const payload: any = {
      project_id: projectId,
      nombre: form.nombre.trim(),
      tipo: form.tipo,
      sistema: form.sistema || null,
      drive_url: form.drive_url.trim(),
      drive_thumbnail_url: form.drive_thumbnail_url.trim() || null,
      version: form.version.trim() || null,
      notas: form.notas.trim() || null,
    }
    const { data, error } = await supabase.from('obra_documentos').insert(payload).select().single()
    setSaving(false)
    if (error) {
      setSaveError('Error al crear: ' + error.message)
      return
    }
    if (data) {
      setDocs(prev => [data as ProyectoDocDB, ...prev])
      setForm({ nombre: '', tipo: 'plano', sistema: '', drive_url: '', drive_thumbnail_url: '', version: '', notas: '' })
      setShowNew(false)
    }
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este documento? Solo se borra el link en el ERP, el archivo en Drive permanece.')) return
    const { error } = await supabase.from('obra_documentos').delete().eq('id', id)
    if (error) {
      alert('Error al eliminar: ' + error.message)
      return
    }
    setDocs(prev => prev.filter(d => d.id !== id))
  }

  if (loading) return <Loading />

  const inputS: React.CSSProperties = {
    width: '100%', padding: '7px 10px', fontSize: 12, background: '#0a0a0a',
    border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit',
  }
  const labelS: React.CSSProperties = { fontSize: 10, color: '#666', marginBottom: 4 }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Documentación técnica del proyecto</div>
          <div style={{ fontSize: 11, color: '#666' }}>Planos, fichas técnicas y diagramas. Los archivos viven en Drive — aquí guardas los links.</div>
        </div>
        <Btn size="sm" variant="primary" onClick={() => setShowNew(true)}><Plus size={12} /> Agregar documento</Btn>
      </div>

      {showNew && (
        <div style={{ background: '#141414', border: '1px solid #57FF9A33', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Nuevo documento — {projectName}</div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <div style={labelS}>Nombre *</div>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Plano CCTV Planta Baja Rev 3" style={inputS} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div>
                <div style={labelS}>Tipo</div>
                <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))} style={inputS}>
                  {Object.entries(DOC_TIPO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <div style={labelS}>Sistema</div>
                <select value={form.sistema} onChange={e => setForm(f => ({ ...f, sistema: e.target.value }))} style={inputS}>
                  <option value="">— Sin sistema —</option>
                  {SISTEMAS_PROYECTO.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <div style={labelS}>Versión / Rev</div>
                <input value={form.version} onChange={e => setForm(f => ({ ...f, version: e.target.value }))} placeholder="Rev 3" style={inputS} />
              </div>
            </div>
            <div>
              <div style={labelS}>URL de Drive *</div>
              <input value={form.drive_url} onChange={e => setForm(f => ({ ...f, drive_url: e.target.value }))} placeholder="https://drive.google.com/file/d/..." style={inputS} />
            </div>
            <div>
              <div style={labelS}>URL de thumbnail (opcional)</div>
              <input value={form.drive_thumbnail_url} onChange={e => setForm(f => ({ ...f, drive_thumbnail_url: e.target.value }))} placeholder="URL de la imagen preview" style={inputS} />
            </div>
            <div>
              <div style={labelS}>Notas (opcional)</div>
              <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} rows={2} style={{ ...inputS, resize: 'vertical' }} />
            </div>
          </div>
          {saveError && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 6, color: '#f87171', fontSize: 11 }}>⚠ {saveError}</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <Btn size="sm" variant="default" onClick={() => { setShowNew(false); setSaveError(null) }}>Cancelar</Btn>
            <Btn size="sm" variant="primary" onClick={crear} disabled={saving}>{saving ? 'Guardando...' : 'Agregar'}</Btn>
          </div>
        </div>
      )}

      {docs.length === 0 ? (
        <EmptyState message="No hay documentos técnicos registrados. Click en 'Agregar documento' para vincular un link de Drive." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {docs.map(d => (
            <div key={d.id} style={{
              background: '#141414', border: '1px solid #222', borderRadius: 10, padding: 14, position: 'relative',
            }}>
              <button onClick={() => eliminar(d.id)} style={{
                position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4,
              }} title="Eliminar link"><Trash2 size={12} /></button>
              {d.drive_thumbnail_url && (
                <img src={d.drive_thumbnail_url} alt={d.nombre} style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }} />
              )}
              <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <Badge label={DOC_TIPO_LABEL[d.tipo] || d.tipo} color="#3B82F6" />
                {d.sistema && <Badge label={d.sistema} color="#8B5CF6" />}
                {d.version && <Badge label={d.version} color="#555" />}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 4, paddingRight: 20 }}>{d.nombre}</div>
              {d.notas && <div style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>{d.notas}</div>}
              <a href={d.drive_url} target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#57FF9A', textDecoration: 'none',
              }}>
                <ExternalLink size={10} /> Abrir en Drive
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
