import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/utils'
import { Badge, ProgressBar } from './layout/UI'
import {
  Plus, Check, X, Calendar, AlertTriangle, Clock, ChevronDown, ChevronRight,
  Circle, CheckCircle2, Trash2, Edit3, Send, User, Tag, FolderOpen, Mail
} from 'lucide-react'
import EmailImport from './EmailImport'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ActionItem {
  id: string
  created_at: string
  updated_at: string
  title: string
  description: string | null
  status: string
  priority: number
  due_date: string | null
  due_time: string | null
  created_by: string | null
  assignee_id: string | null
  area: string | null
  source_type: string
  source_id: string | null
  source_meta: any
  completed_at: string | null
  tags: string[]
  is_recurring: boolean
  recurrence_rule: string | null
  project_id: string | null
}

interface Employee {
  id: string
  name: string
  nombre: string | null
}

interface SimpleProject {
  id: string
  name: string
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const card: React.CSSProperties = {
  background: '#111', border: '1px solid #222', borderRadius: 10, padding: '12px 16px',
}
const input: React.CSSProperties = {
  background: '#0a0a0a', border: '1px solid #333', borderRadius: 8, padding: '8px 12px',
  color: '#fff', fontSize: 13, width: '100%', outline: 'none',
}
const select: React.CSSProperties = {
  ...input, cursor: 'pointer', appearance: 'none' as any,
}

const PRIORITY_LABELS: Record<number, string> = { 1: 'Baja', 2: 'Media', 3: 'Alta' }
const PRIORITY_COLORS: Record<number, string> = { 1: '#888', 2: '#2563EB', 3: '#DC2626' }

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function ActionItems({
  myEmployeeId,
  myArea,
  teamEmployees,
  projects = [],
  userEmail = '',
  isMobile = false,
}: {
  myEmployeeId: string
  myArea: string
  teamEmployees: Employee[]
  projects?: SimpleProject[]
  userEmail?: string
  isMobile?: boolean
}) {
  const [items, setItems] = useState<ActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showEmailImport, setShowEmailImport] = useState(false)
  const [filter, setFilter] = useState<'all' | 'mine' | 'assigned'>('all')
  const [showCompleted, setShowCompleted] = useState(false)

  // Quick-add state
  const [quickTitle, setQuickTitle] = useState('')

  // Create form state
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 2,
    due_date: '',
    assignee_id: '',
    project_id: '',
    tags: '' as string,
  })

  // Project tasks shown as pendientes
  const [projectTaskItems, setProjectTaskItems] = useState<ActionItem[]>([])

  // ── LOAD ──
  async function loadItems() {
    const { data } = await supabase
      .from('action_items')
      .select('*')
      .eq('area', myArea)
      .order('created_at', { ascending: false })
    setItems((data || []) as ActionItem[])
    setLoading(false)
  }

  async function loadProjectTasks() {
    // Load project_tasks assigned to anyone in this area that are not completed
    const { data } = await supabase
      .from('project_tasks')
      .select('id, name, status, priority, due_date, assignee_id, project_id, created_at, completed_at, project:projects(name)')
      .neq('status', 'completada')
      .order('created_at', { ascending: false })

    if (!data) { setProjectTaskItems([]); return }

    // Filter: tasks assigned to employees in this area
    const teamIds = new Set(teamEmployees.map(e => e.id))
    const areaTasks = data.filter((t: any) => t.assignee_id && teamIds.has(t.assignee_id))

    // Convert to ActionItem-like shape with a prefix to distinguish them
    const virtual: ActionItem[] = areaTasks.map((t: any) => ({
      id: `pt_${t.id}`,
      created_at: t.created_at,
      updated_at: t.created_at,
      title: t.name,
      description: null,
      status: t.status === 'completada' ? 'completada' : 'pendiente',
      priority: t.priority || 2,
      due_date: t.due_date || null,
      due_time: null,
      created_by: null,
      assignee_id: t.assignee_id,
      area: myArea,
      source_type: 'proyecto',
      source_id: t.id,
      source_meta: { project_name: t.project?.name || '' },
      completed_at: t.completed_at || null,
      tags: [],
      is_recurring: false,
      recurrence_rule: null,
      project_id: t.project_id,
    }))
    setProjectTaskItems(virtual)
  }

  useEffect(() => { loadItems(); loadProjectTasks() }, [myArea, teamEmployees])

  // ── FILTERED ITEMS (action_items + project_tasks merged) ──
  const filtered = useMemo(() => {
    // Merge action_items and project task virtual items
    const allItems = [...items, ...projectTaskItems]
    let list = allItems.filter(i => showCompleted ? true : i.status !== 'completada' && i.status !== 'cancelada')
    if (filter === 'mine') list = list.filter(i => i.assignee_id === myEmployeeId)
    if (filter === 'assigned') list = list.filter(i => i.created_by === myEmployeeId && i.assignee_id !== myEmployeeId)
    // Sort: overdue first, then by due_date, then by priority
    const now = new Date().toISOString().slice(0, 10)
    list.sort((a, b) => {
      const aOverdue = a.due_date && a.due_date < now ? -1 : 0
      const bOverdue = b.due_date && b.due_date < now ? -1 : 0
      if (aOverdue !== bOverdue) return aOverdue - bOverdue
      // Priority (high first)
      if (b.priority !== a.priority) return b.priority - a.priority
      // Due date
      if (a.due_date && !b.due_date) return -1
      if (!a.due_date && b.due_date) return 1
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      return 0
    })
    return list
  }, [items, projectTaskItems, filter, showCompleted, myEmployeeId])

  const overdueCount = useMemo(() => {
    const now = new Date().toISOString().slice(0, 10)
    const allItems = [...items, ...projectTaskItems]
    return allItems.filter(i => i.due_date && i.due_date < now && i.status !== 'completada' && i.status !== 'cancelada').length
  }, [items, projectTaskItems])

  const empMap = useMemo(() => {
    const m: Record<string, string> = {}
    teamEmployees.forEach(e => { m[e.id] = e.nombre || e.name })
    return m
  }, [teamEmployees])

  const projMap = useMemo(() => {
    const m: Record<string, string> = {}
    projects.forEach(p => { m[p.id] = p.name })
    return m
  }, [projects])

  // ── ACTIONS ──
  async function quickAdd() {
    if (!quickTitle.trim()) return
    const { error } = await supabase.from('action_items').insert({
      title: quickTitle.trim(),
      assignee_id: myEmployeeId,
      created_by: myEmployeeId,
      area: myArea,
      priority: 2,
    })
    if (!error) {
      setQuickTitle('')
      loadItems()
    }
  }

  async function createItem() {
    if (!form.title.trim()) return
    const { error } = await supabase.from('action_items').insert({
      title: form.title.trim(),
      description: form.description || null,
      priority: form.priority,
      due_date: form.due_date || null,
      assignee_id: form.assignee_id || myEmployeeId,
      created_by: myEmployeeId,
      area: myArea,
      project_id: form.project_id || null,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    })
    if (!error) {
      setForm({ title: '', description: '', priority: 2, due_date: '', assignee_id: '', project_id: '', tags: '' })
      setShowCreate(false)
      loadItems()
    }
  }

  const isProjectTask = (item: ActionItem) => item.id.startsWith('pt_')
  const realProjectTaskId = (item: ActionItem) => item.id.replace('pt_', '')

  async function toggleComplete(item: ActionItem) {
    if (isProjectTask(item)) {
      // Toggle project task status
      const realId = realProjectTaskId(item)
      const newStatus = item.status === 'completada' ? 'pendiente' : 'completada'
      await supabase.from('project_tasks').update({
        status: newStatus,
        progress: newStatus === 'completada' ? 100 : 0,
        completed_at: newStatus === 'completada' ? new Date().toISOString() : null,
      }).eq('id', realId)
      loadProjectTasks()
      return
    }
    const newStatus = item.status === 'completada' ? 'pendiente' : 'completada'
    await supabase.from('action_items').update({
      status: newStatus,
      completed_at: newStatus === 'completada' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', item.id)
    loadItems()
  }

  async function deleteItem(id: string) {
    if (id.startsWith('pt_')) return // Don't delete project tasks from here
    await supabase.from('action_items').delete().eq('id', id)
    loadItems()
  }

  async function updatePriority(id: string, priority: number) {
    await supabase.from('action_items').update({ priority, updated_at: new Date().toISOString() }).eq('id', id)
    loadItems()
  }

  const now = new Date().toISOString().slice(0, 10)
  const allMerged = [...items, ...projectTaskItems]
  const pendingCount = allMerged.filter(i => i.status !== 'completada' && i.status !== 'cancelada').length

  return (
    <div>
      {/* ── HEADER + FILTERS ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Pendientes</span>
          <span style={{ fontSize: 12, color: '#555' }}>({pendingCount})</span>
          {overdueCount > 0 && (
            <span style={{ fontSize: 11, color: '#DC2626', display: 'flex', alignItems: 'center', gap: 3 }}>
              <AlertTriangle size={11} /> {overdueCount} vencido{overdueCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Filter chips */}
          {(['all', 'mine', 'assigned'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              background: filter === f ? '#222' : 'transparent',
              border: `1px solid ${filter === f ? '#444' : '#222'}`,
              borderRadius: 6, padding: '4px 10px', fontSize: 11, color: filter === f ? '#fff' : '#666',
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
              {f === 'all' ? 'Todos' : f === 'mine' ? 'Míos' : 'Asignados'}
            </button>
          ))}
          <button onClick={() => setShowCompleted(!showCompleted)} style={{
            background: 'transparent', border: '1px solid #222', borderRadius: 6,
            padding: '4px 8px', fontSize: 11, color: showCompleted ? '#10B981' : '#555',
            cursor: 'pointer',
          }}>
            <CheckCircle2 size={11} />
          </button>
        </div>
      </div>

      {/* ── QUICK ADD ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={quickTitle}
          onChange={e => setQuickTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && quickAdd()}
          placeholder="+ Agregar pendiente rápido..."
          style={{ ...input, flex: 1 }}
        />
        <button onClick={() => setShowCreate(true)} style={{
          background: '#222', border: '1px solid #333', borderRadius: 8, padding: '8px 12px',
          color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
          whiteSpace: 'nowrap',
        }}>
          <Plus size={14} /> Detallado
        </button>
        {userEmail && (
          <button onClick={() => setShowEmailImport(true)} style={{
            background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, padding: '8px 12px',
            color: '#2563EB', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
            whiteSpace: 'nowrap',
          }}>
            <Mail size={14} /> Email
          </button>
        )}
      </div>

      {/* ── CREATE FORM (expanded) ── */}
      {showCreate && (
        <div style={{ ...card, marginBottom: 12, border: '1px solid #333' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Nuevo Pendiente</span>
            <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="¿Qué hay que hacer?"
              style={input}
              autoFocus
            />
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Descripción o notas (opcional)"
              style={{ ...input, minHeight: 60, resize: 'vertical' as any }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)', gap: 8 }}>
              {/* Priority */}
              <div>
                <label style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prioridad</label>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {[1, 2, 3].map(p => (
                    <button key={p} onClick={() => setForm(f => ({ ...f, priority: p }))} style={{
                      flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      background: form.priority === p ? PRIORITY_COLORS[p] + '22' : '#0a0a0a',
                      border: `1px solid ${form.priority === p ? PRIORITY_COLORS[p] : '#333'}`,
                      color: form.priority === p ? PRIORITY_COLORS[p] : '#666',
                    }}>
                      {PRIORITY_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Due date */}
              <div>
                <label style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fecha límite</label>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                  style={{ ...input, marginTop: 4 }}
                />
              </div>

              {/* Assignee */}
              <div>
                <label style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Asignar a</label>
                <select
                  value={form.assignee_id}
                  onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}
                  style={{ ...select, marginTop: 4 }}
                >
                  <option value="">Yo mismo</option>
                  {teamEmployees.map(e => (
                    <option key={e.id} value={e.id}>{e.nombre || e.name}</option>
                  ))}
                </select>
              </div>

              {/* Project */}
              <div>
                <label style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Proyecto</label>
                <select
                  value={form.project_id}
                  onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}
                  style={{ ...select, marginTop: 4 }}
                >
                  <option value="">Sin proyecto</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Tags */}
              <div>
                <label style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tags</label>
                <input
                  value={form.tags}
                  onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="junta, seguimiento..."
                  style={{ ...input, marginTop: 4 }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button onClick={() => setShowCreate(false)} style={{
                background: 'none', border: '1px solid #333', borderRadius: 8, padding: '8px 16px',
                color: '#888', cursor: 'pointer', fontSize: 12,
              }}>Cancelar</button>
              <button onClick={createItem} style={{
                background: '#10B981', border: 'none', borderRadius: 8, padding: '8px 20px',
                color: '#000', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>Crear</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ITEMS LIST ── */}
      {loading ? (
        <div style={{ padding: 20, color: '#555', fontSize: 13, textAlign: 'center' }}>Cargando...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 20, color: '#444', fontSize: 13, textAlign: 'center' }}>
          {filter === 'mine' ? 'No tienes pendientes' : filter === 'assigned' ? 'No has asignado pendientes' : 'Sin pendientes — ¡excelente!'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.map(item => {
            const isOverdue = item.due_date && item.due_date < now && item.status !== 'completada'
            const isDone = item.status === 'completada'
            return (
              <div key={item.id} style={{
                ...card,
                padding: '10px 14px',
                borderLeft: `3px solid ${isDone ? '#333' : isOverdue ? '#DC2626' : PRIORITY_COLORS[item.priority] || '#333'}`,
                opacity: isDone ? 0.5 : 1,
                transition: 'all 0.15s',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  {/* Checkbox */}
                  <button onClick={() => toggleComplete(item)} style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 2, marginTop: 1, flexShrink: 0,
                    color: isDone ? '#10B981' : '#444',
                  }}>
                    {isDone ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                  </button>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 500,
                      color: isDone ? '#555' : isOverdue ? '#DC2626' : '#fff',
                      textDecoration: isDone ? 'line-through' : 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#555', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {/* Project */}
                      {item.project_id && (projMap[item.project_id] || item.source_meta?.project_name) && (
                        <span style={{ color: '#10B981', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <FolderOpen size={9} /> {projMap[item.project_id] || item.source_meta?.project_name}
                        </span>
                      )}
                      {/* Assignee */}
                      {item.assignee_id && item.assignee_id !== myEmployeeId && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <User size={9} /> {empMap[item.assignee_id] || ''}
                        </span>
                      )}
                      {/* Due date */}
                      {item.due_date && (
                        <span style={{ color: isOverdue ? '#DC2626' : '#666', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Calendar size={9} /> {formatDate(item.due_date)}
                        </span>
                      )}
                      {/* Source */}
                      {item.source_type === 'proyecto' && (
                        <span style={{ color: '#A78BFA', display: 'flex', alignItems: 'center', gap: 3, fontSize: 10 }}>
                          <Tag size={9} /> Tarea de proyecto
                        </span>
                      )}
                      {item.source_type !== 'manual' && item.source_type !== 'proyecto' && (
                        <span style={{ color: '#555' }}>
                          {item.source_type === 'email' ? '✉' : item.source_type === 'meeting' ? '📅' : '📋'} {item.source_type}
                        </span>
                      )}
                      {/* Tags */}
                      {item.tags && item.tags.length > 0 && item.tags.map(tag => (
                        <span key={tag} style={{
                          background: '#1a1a2e', color: '#8888cc', fontSize: 10, padding: '1px 6px',
                          borderRadius: 4,
                        }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Priority + actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {!isDone && !isProjectTask(item) && (
                      <button onClick={() => updatePriority(item.id, item.priority === 3 ? 1 : item.priority + 1)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                      }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: 4,
                          background: PRIORITY_COLORS[item.priority],
                        }} title={`Prioridad: ${PRIORITY_LABELS[item.priority]}`} />
                      </button>
                    )}
                    {!isProjectTask(item) && (
                      <button onClick={() => deleteItem(item.id)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                        color: '#333', transition: 'color 0.15s',
                      }}
                        onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                        onMouseLeave={e => e.currentTarget.style.color = '#333'}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── EMAIL IMPORT MODAL ── */}
      {showEmailImport && userEmail && (
        <EmailImport
          userEmail={userEmail}
          myEmployeeId={myEmployeeId}
          myArea={myArea}
          teamEmployees={teamEmployees}
          projects={projects}
          onClose={() => setShowEmailImport(false)}
          onCreated={() => { setShowEmailImport(false); loadItems() }}
        />
      )}
    </div>
  )
}
