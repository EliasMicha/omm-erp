// ═══════════════════════════════════════════════════════════════════════════
// tareas — el átomo del trabajo en OMM.
//
// PARTE 1 de la estructura de encargos. La idea que la sostiene: no todo lo
// que entra es un proyecto. Puede ser "cotiza esto", "ve a levantar", una
// licitación, o el proyecto completo. Antes `project_tasks` exigía proyecto y
// fase, así que una cotización suelta no cabía y acababa en otra tabla — dos
// bandejas de pendientes que nadie concilia.
//
// Ahora la TAREA es el átomo:
//   · un proyecto es un conjunto de tareas con fases
//   · una cotización es UNA tarea
//   · los dos viven en el mismo lugar, con la misma bandeja y los mismos
//     números de cumplimiento
//
// Y cuando lleguen documentos, revisión y calificación, se cuelgan de aquí —
// de un solo sitio, no de dos.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'

export type TipoTarea = 'proyecto' | 'cotizacion' | 'levantamiento' | 'licitacion' | 'revision' | 'otro'
export type UrgenciaTarea = 'urgente' | 'alta' | 'normal' | 'baja'

export const TIPO_CFG: Record<TipoTarea, { label: string; color: string; icono: string }> = {
  proyecto:      { label: 'Proyecto',      color: '#2563EB', icono: '▣' },
  cotizacion:    { label: 'Cotización',    color: '#10B981', icono: '$' },
  levantamiento: { label: 'Levantamiento', color: '#67E8F9', icono: '⌕' },
  licitacion:    { label: 'Licitación',    color: '#A78BFA', icono: '⚖' },
  revision:      { label: 'Revisión',      color: '#D9A441', icono: '✓' },
  otro:          { label: 'Otro',          color: '#6B7280', icono: '•' },
}

export const URGENCIA_TAREA_CFG: Record<UrgenciaTarea, { label: string; color: string; prioridad: number }> = {
  urgente: { label: 'Urgente', color: '#DC2626', prioridad: 3 },
  alta:    { label: 'Alta',    color: '#D97706', prioridad: 2 },
  normal:  { label: 'Normal',  color: '#2563EB', prioridad: 1 },
  baja:    { label: 'Baja',    color: '#6B7280', prioridad: 0 },
}

/** Las áreas que reciben trabajo. `area` es el valor en employees.area. */
export const AREAS_TRABAJO = [
  { specialty: 'elec', label: 'Ingeniería Eléctrica',   area: 'INGENIERIAS ELECTRICAS', color: '#D97706' },
  { specialty: 'esp',  label: 'Ingenierías Especiales', area: 'INGENIERIAS ESPECIALES', color: '#2563EB' },
  { specialty: 'ilum', label: 'Diseño de Iluminación',  area: 'ILUMINACION',            color: '#A78BFA' },
  { specialty: 'admin', label: 'Administración',        area: 'ADMINISTRACION',         color: '#10B981' },
] as const

export interface Tarea {
  id: string
  name: string
  description?: string | null
  tipo: TipoTarea
  specialty?: string | null
  urgencia: UrgenciaTarea
  status: string
  progress?: number | null
  due_date?: string | null
  assignee_id?: string | null
  delegada_por_id?: string | null
  solicitada_por?: string | null
  solicitada_por_id?: string | null
  lead_id?: string | null
  project_id?: string | null
  phase_id?: string | null
  levantamiento_id?: string | null
  titulo_cliente?: string | null
  notes?: string | null
  created_at?: string
  completed_at?: string | null
}

export interface NuevaTarea {
  name: string
  tipo: TipoTarea
  specialty: string
  urgencia?: UrgenciaTarea
  due_date?: string | null
  assignee_id?: string | null
  description?: string | null
  lead_id?: string | null
  levantamiento_id?: string | null
  titulo_cliente?: string | null
  solicitada_por?: string | null
  solicitada_por_id?: string | null
}

/**
 * Crea una tarea SUELTA — sin proyecto y sin fase.
 *
 * La base tiene un check que exige que proyecto y fase vayan juntos o no
 * vayan: no existe la tarea "de un proyecto pero sin fase", que sería el
 * estado que rompe la vista de Proyectos.
 */
export async function crearTarea(t: NuevaTarea): Promise<{ id?: string; error?: string }> {
  if (!t.name?.trim()) return { error: 'La tarea necesita un nombre: sin nombre nadie sabe qué hacer.' }
  if (!t.specialty) return { error: 'Falta el área: sin área no hay a quién encargarle.' }
  const { data, error } = await supabase.from('project_tasks').insert({
    name: t.name.trim(),
    description: t.description || null,
    tipo: t.tipo,
    specialty: t.specialty,
    urgencia: t.urgencia || 'normal',
    // priority es el campo viejo que ya usan los tableros; se mantiene en
    // sincronía con la urgencia para no tener dos verdades.
    priority: URGENCIA_TAREA_CFG[t.urgencia || 'normal'].prioridad,
    due_date: t.due_date || null,
    assignee_id: t.assignee_id || null,
    lead_id: t.lead_id || null,
    levantamiento_id: t.levantamiento_id || null,
    titulo_cliente: t.titulo_cliente || null,
    solicitada_por: t.solicitada_por || null,
    solicitada_por_id: t.solicitada_por_id || null,
    status: 'pendiente',
    progress: 0,
    order_index: 0,
  }).select('id').single()
  if (error) return { error: error.message }
  return { id: (data as any).id }
}

const COLS = 'id,name,description,tipo,specialty,urgencia,status,progress,due_date,assignee_id,' +
  'delegada_por_id,solicitada_por,solicitada_por_id,lead_id,project_id,phase_id,titulo_cliente,notes,created_at,completed_at'

/** Todo lo que trae una persona en la mano: de proyecto y suelto, junto. */
export async function tareasDe(employeeId: string, opts?: { incluirCompletadas?: boolean }): Promise<Tarea[]> {
  let q = supabase.from('project_tasks').select(COLS + ',project:projects(name)').eq('assignee_id', employeeId)
  if (!opts?.incluirCompletadas) q = q.neq('status', 'completada')
  const { data } = await q.order('due_date', { ascending: true, nullsFirst: false })
  return ((data as any[]) || []) as Tarea[]
}

/** Lo que trae un área — lo que el director tiene que repartir y vigilar. */
export async function tareasDeArea(specialty: string, opts?: { incluirCompletadas?: boolean }): Promise<Tarea[]> {
  let q = supabase.from('project_tasks').select(COLS + ',project:projects(name,specialty)').eq('specialty', specialty)
  if (!opts?.incluirCompletadas) q = q.neq('status', 'completada')
  const { data } = await q.order('due_date', { ascending: true, nullsFirst: false })
  return ((data as any[]) || []) as Tarea[]
}

/** Delegar: el director la pasa a alguien de su equipo y queda el rastro. */
export async function delegar(tareaId: string, aQuien: string, directorId?: string | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('project_tasks').update({
    assignee_id: aQuien,
    delegada_por_id: directorId || null,
    updated_at: new Date().toISOString(),
  }).eq('id', tareaId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function actualizarTarea(tareaId: string, patch: Partial<Tarea>): Promise<{ ok: boolean; error?: string }> {
  const p: any = { ...patch, updated_at: new Date().toISOString() }
  if (patch.urgencia) p.priority = URGENCIA_TAREA_CFG[patch.urgencia].prioridad
  if (patch.status === 'completada' && !patch.completed_at) p.completed_at = new Date().toISOString()
  const { error } = await supabase.from('project_tasks').update(p).eq('id', tareaId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Semáforo ───────────────────────────────────────────────────────────────

export type EstadoFecha = 'sin_fecha' | 'vencida' | 'hoy' | 'proxima' | 'lejana' | 'lista'

export function estadoFecha(t: Tarea, hoy = new Date().toISOString().slice(0, 10)): { estado: EstadoFecha; dias: number | null; color: string; label: string } {
  if (t.status === 'completada') return { estado: 'lista', dias: null, color: '#10B981', label: 'Lista' }
  if (!t.due_date) return { estado: 'sin_fecha', dias: null, color: '#DC2626', label: 'Sin fecha' }
  const dias = Math.round((new Date(t.due_date + 'T12:00:00').getTime() - new Date(hoy + 'T12:00:00').getTime()) / 86400000)
  if (dias < 0) return { estado: 'vencida', dias, color: '#DC2626', label: `Vencida ${Math.abs(dias)}d` }
  if (dias === 0) return { estado: 'hoy', dias, color: '#D97706', label: 'Hoy' }
  if (dias <= 3) return { estado: 'proxima', dias, color: '#D9A441', label: `En ${dias}d` }
  return { estado: 'lejana', dias, color: '#666', label: `En ${dias}d` }
}

/**
 * Orden en el que hay que verlas: lo vencido primero, después lo que no tiene
 * fecha —que es lo que de verdad se pierde— y luego por urgencia.
 */
export function ordenarTareas(ts: Tarea[]): Tarea[] {
  const rango = (t: Tarea) => {
    const e = estadoFecha(t).estado
    if (e === 'vencida') return 0
    if (e === 'sin_fecha') return 1
    if (e === 'hoy') return 2
    if (e === 'proxima') return 3
    return 4
  }
  return [...ts].sort((a, b) =>
    rango(a) - rango(b) ||
    (URGENCIA_TAREA_CFG[b.urgencia]?.prioridad ?? 1) - (URGENCIA_TAREA_CFG[a.urgencia]?.prioridad ?? 1) ||
    String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
}

export interface ResumenTareas {
  total: number
  vencidas: number
  sinFecha: number
  hoy: number
  aTiempo: number
}

export function resumir(ts: Tarea[]): ResumenTareas {
  const e = (t: Tarea) => estadoFecha(t).estado
  return {
    total: ts.length,
    vencidas: ts.filter(t => e(t) === 'vencida').length,
    sinFecha: ts.filter(t => e(t) === 'sin_fecha').length,
    hoy: ts.filter(t => e(t) === 'hoy').length,
    aTiempo: ts.filter(t => ['proxima', 'lejana'].includes(e(t))).length,
  }
}
