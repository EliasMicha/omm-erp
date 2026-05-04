import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SPECIALTY_CONFIG, formatDate } from '../lib/utils'
import { KpiCard, Table, Th, Td, ProgressBar, Badge, Loading, SectionHeader } from '../components/layout/UI'
import { useIsMobile } from '../lib/useIsMobile'
import { useAuth } from '../contexts/AuthContext'
import { ClipboardList, AlertTriangle, CheckCircle, Clock, FolderOpen, FileText } from 'lucide-react'

interface Task {
  id: string
  name: string
  status: string
  priority: number
  due_date: string | null
  progress: number
  project_name: string
  project_id: string
  phase_name?: string
}

interface ActiveProject {
  id: string
  name: string
  client_name: string
  specialty: string
  advance_pct: number
  start_date: string | null
  task_count: number
  done_count: number
}

export default function DashboardProduccion() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const isEjecutor = authUser?.nivel === 'ejecutor'
  const myEmployeeId = authUser?.employee_id
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<ActiveProject[]>([])
  const [cotizaciones, setCotizaciones] = useState<any[]>([])

  useEffect(() => {
    async function load() {
      // Build task query — ejecutores only see their assigned tasks
      let taskQuery = supabase.from('project_tasks').select('id, name, status, priority, due_date, progress, project_id, assignee_id, project:projects(name)').neq('status', 'completada').order('due_date', { ascending: true, nullsFirst: false })
      let allTaskQuery = supabase.from('project_tasks').select('project_id, status, assignee_id')
      if (isEjecutor && myEmployeeId) {
        taskQuery = taskQuery.eq('assignee_id', myEmployeeId)
        allTaskQuery = allTaskQuery.eq('assignee_id', myEmployeeId)
      }

      const [tasksRes, projRes, cotsRes, allTasksRes] = await Promise.all([
        taskQuery,
        // Active projects
        supabase.from('projects').select('id, name, client_name, specialty, advance_pct, start_date').eq('status', 'activo').order('created_at', { ascending: false }),
        // Cotizaciones in production (propuesta + contrato)
        supabase.from('quotations').select('id, client_name, stage, specialty, created_at, notes').in('stage', ['propuesta', 'contrato']).order('created_at', { ascending: false }),
        allTaskQuery,
      ])

      const rawTasks = (tasksRes.data || []).map((t: any) => ({
        ...t,
        project_name: t.project?.name || 'Sin proyecto',
      }))

      // Sort: overdue first, then by due_date, then by priority
      const now = new Date().toISOString().slice(0, 10)
      rawTasks.sort((a: Task, b: Task) => {
        // Overdue items first
        const aOverdue = a.due_date && a.due_date < now ? -1 : 0
        const bOverdue = b.due_date && b.due_date < now ? -1 : 0
        if (aOverdue !== bOverdue) return aOverdue - bOverdue
        // Then items with dates before items without
        if (a.due_date && !b.due_date) return -1
        if (!a.due_date && b.due_date) return 1
        if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
        return (b.priority || 0) - (a.priority || 0)
      })
      setTasks(rawTasks)

      // Build project stats — ejecutores only see projects where they have tasks
      const allTasks = allTasksRes.data || []
      const myProjectIds = isEjecutor ? new Set(allTasks.map((t: any) => t.project_id)) : null
      const projectList = (projRes.data || [])
        .filter((p: any) => !myProjectIds || myProjectIds.has(p.id))
        .map((p: any) => ({
          ...p,
          task_count: allTasks.filter((t: any) => t.project_id === p.id).length,
          done_count: allTasks.filter((t: any) => t.project_id === p.id && t.status === 'completada').length,
        }))
      setProjects(projectList)

      // Ejecutores don't see the cotizaciones list (they don't manage sales pipeline)
      setCotizaciones(isEjecutor ? [] : (cotsRes.data || []))
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <Loading />

  const now = new Date().toISOString().slice(0, 10)
  const overdueTasks = tasks.filter(t => t.due_date && t.due_date < now)
  const thisWeekEnd = new Date()
  thisWeekEnd.setDate(thisWeekEnd.getDate() + 7)
  const thisWeekStr = thisWeekEnd.toISOString().slice(0, 10)
  const dueThisWeek = tasks.filter(t => t.due_date && t.due_date >= now && t.due_date <= thisWeekStr)

  // Group tasks by project
  const tasksByProject: Record<string, Task[]> = {}
  tasks.forEach(t => {
    if (!tasksByProject[t.project_name]) tasksByProject[t.project_name] = []
    tasksByProject[t.project_name].push(t)
  })

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px', maxWidth: 1200 }}>
      <SectionHeader title={isEjecutor ? 'Mis Pendientes' : 'Panel de Producción'} subtitle={isEjecutor ? `Hola ${authUser?.nombre || ''} — tus tareas y proyectos asignados` : 'Pendientes, proyectos y entregables'} />

      {/* ── KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Tareas pendientes" value={tasks.length} color={tasks.length > 10 ? '#F59E0B' : '#57FF9A'} icon={<ClipboardList size={16} />} />
        <KpiCard label="Vencidas" value={overdueTasks.length} color={overdueTasks.length > 0 ? '#EF4444' : '#57FF9A'} icon={<AlertTriangle size={16} />} />
        <KpiCard label="Esta semana" value={dueThisWeek.length} color="#3B82F6" icon={<Clock size={16} />} />
        <KpiCard label="Proyectos activos" value={projects.length} icon={<FolderOpen size={16} />} />
      </div>

      {/* ── OVERDUE ALERT ── */}
      {overdueTasks.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#EF4444', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} /> {overdueTasks.length} tarea{overdueTasks.length > 1 ? 's' : ''} vencida{overdueTasks.length > 1 ? 's' : ''}
          </div>
          {overdueTasks.slice(0, 5).map(t => (
            <div key={t.id} style={{ fontSize: 12, color: '#ccc', padding: '4px 0', display: 'flex', justifyContent: 'space-between' }}>
              <span><span style={{ color: '#fff', fontWeight: 500 }}>{t.name}</span> — {t.project_name}</span>
              <span style={{ color: '#EF4444', fontSize: 11 }}>{t.due_date ? formatDate(t.due_date) : ''}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* ── Proyectos activos con progreso ── */}
        <div>
          <SectionHeader title="Proyectos activos" />
          {projects.length === 0 ? (
            <div style={{ padding: 20, color: '#555', fontSize: 13 }}>Sin proyectos activos</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {projects.map(p => {
                const cfg = SPECIALTY_CONFIG[p.specialty as keyof typeof SPECIALTY_CONFIG]
                const taskPct = p.task_count > 0 ? Math.round((p.done_count / p.task_count) * 100) : 0
                return (
                  <div key={p.id} style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: '14px 16px', borderLeft: cfg ? `3px solid ${cfg.color}` : '3px solid #333' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: '#666' }}>{p.client_name}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: '#888' }}>{p.done_count}/{p.task_count} tareas</div>
                      </div>
                    </div>
                    <ProgressBar pct={p.advance_pct || taskPct} />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Cotizaciones en producción ── */}
        <div>
          <SectionHeader title="Cotizaciones en producción" />
          {cotizaciones.length === 0 ? (
            <div style={{ padding: 20, color: '#555', fontSize: 13 }}>Sin cotizaciones en producción</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cotizaciones.map(c => {
                const cfg = SPECIALTY_CONFIG[c.specialty as keyof typeof SPECIALTY_CONFIG]
                const stageColor = c.stage === 'contrato' ? '#57FF9A' : '#F59E0B'
                return (
                  <div key={c.id} onClick={() => navigate(`/cotizaciones#${c.id}:${c.specialty}`)} style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: '12px 16px', cursor: 'pointer', transition: 'border-color 0.15s', borderLeft: cfg ? `3px solid ${cfg.color}` : '3px solid #333' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#444'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = '#222'}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>{c.client_name}</div>
                        <div style={{ fontSize: 11, color: '#666' }}>{cfg?.label || c.specialty}</div>
                      </div>
                      <Badge label={c.stage} color={stageColor} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── TAREAS POR PROYECTO ── */}
      <SectionHeader title="Todas las tareas pendientes" />
      {Object.keys(tasksByProject).length === 0 ? (
        <div style={{ padding: 20, color: '#555', fontSize: 13 }}>Sin tareas pendientes</div>
      ) : (
        Object.entries(tasksByProject).map(([projName, projTasks]) => (
          <div key={projName} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <FolderOpen size={13} color="#888" /> {projName}
              <span style={{ fontSize: 11, color: '#555', fontWeight: 400 }}>({projTasks.length})</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead>
                  <tr><Th>Tarea</Th><Th>Estado</Th><Th>Fecha límite</Th><Th>Progreso</Th></tr>
                </thead>
                <tbody>
                  {projTasks.map(t => {
                    const isOverdue = t.due_date && t.due_date < now
                    return (
                      <tr key={t.id}>
                        <Td><span style={{ fontWeight: 500, color: isOverdue ? '#EF4444' : '#fff' }}>{t.name}</span></Td>
                        <Td>
                          <Badge label={t.status}
                            color={t.status === 'completada' ? '#57FF9A' : t.status === 'en_progreso' ? '#3B82F6' : '#888'} />
                        </Td>
                        <Td muted style={isOverdue ? { color: '#EF4444', fontWeight: 600 } : undefined}>
                          {t.due_date ? formatDate(t.due_date) : <span style={{ color: '#333' }}>—</span>}
                        </Td>
                        <Td>{t.progress > 0 ? <ProgressBar pct={t.progress} /> : <span style={{ color: '#333' }}>—</span>}</Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
