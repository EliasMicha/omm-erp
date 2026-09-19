// ═══════════════════════════════════════════════════════════════════════════
// miTrabajo — datos del módulo "Mi trabajo" (beta).
//
// Es la pantalla nueva de Proyectos montada ENCIMA de lo que ya existe, sin
// migrar nada: lee project_tasks, project_task_subtasks, project_phases y
// entregables tal como están hoy. Cuando se archive lo viejo y entren las
// plantillas revisadas, esta misma pantalla se queda y solo cambian los datos.
//
// Dos reglas que no se negocian aquí:
//   · Supabase corta en 1000 filas SIN avisar. Todo lo que puede pasar de mil
//     (tareas de toda la casa, 2,095 pasos) se pagina con `todas()`.
//   · Palomear el último paso NO cierra la tarea. La deja "lista para
//     entregar". Se cierra cuando quien revisa la acepta — si no, el paso de
//     entregar-revisar se vuelve opcional y vuelve a pasar lo de siempre.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'
import { Entregable, normalizarChecklist } from './entregables'
import { AREAS_TRABAJO } from './tareas'
import type { Persona } from './empleados'

export const COLOR_ESP: Record<string, string> = { ilum: '#A78BFA', elec: '#FFB347', esp: '#10B981', admin: '#94A3B8' }
export const LABEL_ESP: Record<string, string> = { ilum: 'ILU', elec: 'ELEC', esp: 'ESP', admin: 'ADM' }

export interface TareaMT {
  id: string
  name: string
  description?: string | null
  instrucciones?: string | null
  status: string
  progress?: number | null
  due_date?: string | null
  assignee_id?: string | null
  solicitada_por_id?: string | null
  delegada_por_id?: string | null
  specialty?: string | null
  rol?: string | null
  project_id?: string | null
  phase_id?: string | null
  tipo_entregable_id?: string | null
  lead_id?: string | null
  titulo_cliente?: string | null
  entregado_at?: string | null
  entregado_ultimo_at?: string | null
  aceptado_at?: string | null
  rondas_revision?: number | null
  asignada_at?: string | null
  created_at?: string | null
  project?: { id: string; name: string; client_name?: string | null; specialty?: string | null } | null
  phase?: { id: string; name: string; order_index: number } | null
}

const COLS = 'id,name,description,instrucciones,status,progress,due_date,assignee_id,solicitada_por_id,delegada_por_id,' +
  'specialty,rol,project_id,phase_id,tipo_entregable_id,lead_id,titulo_cliente,entregado_at,entregado_ultimo_at,' +
  'aceptado_at,rondas_revision,asignada_at,created_at,' +
  'project:projects(id,name,client_name,specialty),phase:project_phases(id,name,order_index)'

/** Pagina de 1000 en 1000 hasta que la página venga incompleta. */
async function todas<T>(armar: (desde: number, hasta: number) => any): Promise<T[]> {
  const out: T[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await armar(desde, desde + 999)
    if (error) { console.error('[miTrabajo]', error.message); break }
    const d = (data as T[]) || []
    out.push(...d)
    if (d.length < 1000) break
  }
  return out
}

const trozos = <T,>(xs: T[], n: number) => {
  const r: T[][] = []
  for (let i = 0; i < xs.length; i += n) r.push(xs.slice(i, i + n))
  return r
}

export const especialidadDe = (t: TareaMT) => t.specialty || t.project?.specialty || 'admin'

// ── Cargas ─────────────────────────────────────────────────────────────────

export async function tareasDePersona(id: string): Promise<TareaMT[]> {
  return todas<TareaMT>((a, b) => supabase.from('project_tasks').select(COLS)
    .eq('assignee_id', id).neq('status', 'completada').order('id').range(a, b))
}

export async function tareasDeProyecto(projectId: string): Promise<TareaMT[]> {
  return todas<TareaMT>((a, b) => supabase.from('project_tasks').select(COLS)
    .eq('project_id', projectId).order('id').range(a, b))
}

export async function tareasAbiertasDeTodos(): Promise<TareaMT[]> {
  return todas<TareaMT>((a, b) => supabase.from('project_tasks')
    .select('id,name,status,due_date,assignee_id,specialty,rol,project_id,entregado_at,aceptado_at,asignada_at,created_at,project:projects(id,name,specialty)')
    .neq('status', 'completada').order('id').range(a, b))
}

export interface ConteoPasos { hechos: number; total: number }

/** Pasos hechos / totales por tarea. Trozos de 100 ids para no reventar la URL. */
export async function conteoDePasos(ids: string[]): Promise<Record<string, ConteoPasos>> {
  const m: Record<string, ConteoPasos> = {}
  for (const grupo of trozos(ids, 100)) {
    const filas = await todas<{ task_id: string; completed: boolean }>((a, b) =>
      supabase.from('project_task_subtasks').select('task_id,completed').in('task_id', grupo).order('id').range(a, b))
    for (const f of filas) {
      const c = m[f.task_id] || (m[f.task_id] = { hechos: 0, total: 0 })
      c.total++
      if (f.completed) c.hechos++
    }
  }
  return m
}

/** El último entregable de cada tarea: dice si está esperando, aceptada o devuelta. */
export async function ultimoEntregable(ids: string[]): Promise<Record<string, Entregable>> {
  const m: Record<string, Entregable> = {}
  for (const grupo of trozos(ids, 100)) {
    const { data } = await supabase.from('entregables').select('*').in('task_id', grupo).order('subido_at', { ascending: false })
    for (const e of (data as any[]) || []) {
      if (!m[e.task_id]) m[e.task_id] = { ...e, checklist: normalizarChecklist(e.checklist) }
    }
  }
  return m
}

export async function entregablesEnRevision(): Promise<Entregable[]> {
  const { data } = await supabase.from('entregables').select('*').eq('estado', 'en_revision').order('subido_at')
  return ((data as any[]) || []).map(e => ({ ...e, checklist: normalizarChecklist(e.checklist) }))
}

export async function entregablesRevisados(): Promise<Entregable[]> {
  const { data } = await supabase.from('entregables').select('*').not('revisado_at', 'is', null)
  return ((data as any[]) || []).map(e => ({ ...e, checklist: normalizarChecklist(e.checklist) }))
}

export async function proyectos(): Promise<{ id: string; name: string; client_name?: string | null; specialty?: string | null; status?: string | null }[]> {
  const { data } = await supabase.from('projects').select('id,name,client_name,specialty,status').order('name')
  return (data as any[]) || []
}

export async function fasesDe(projectId: string): Promise<{ id: string; name: string; order_index: number; is_post_sale?: boolean; status?: string }[]> {
  const { data } = await supabase.from('project_phases').select('id,name,order_index,is_post_sale,status')
    .eq('project_id', projectId).order('order_index')
  return (data as any[]) || []
}

// ── Escrituras ─────────────────────────────────────────────────────────────

/**
 * Palomea un paso y recalcula el avance, SIN cerrar la tarea al 100%.
 * (La versión de lib/tareas la cierra; aquí el cierre lo da la revisión.)
 */
export async function marcarPasoMT(pasoId: string, tareaId: string, hecho: boolean): Promise<number> {
  await supabase.from('project_task_subtasks').update({ completed: hecho }).eq('id', pasoId)
  const { data } = await supabase.from('project_task_subtasks').select('completed').eq('task_id', tareaId)
  const ps = (data as any[]) || []
  if (!ps.length) return 0
  const pct = Math.round(ps.filter(p => p.completed).length / ps.length * 100)
  await supabase.from('project_tasks').update({
    progress: pct,
    status: pct === 0 ? 'pendiente' : 'en_progreso',
    updated_at: new Date().toISOString(),
  }).eq('id', tareaId)
  return pct
}

/** Se registró una entrega: se sellan las fechas que existían y nadie llenaba. */
export async function sellarEntrega(t: TareaMT): Promise<void> {
  const ahora = new Date().toISOString()
  await supabase.from('project_tasks').update({
    entregado_at: t.entregado_at || ahora,
    entregado_ultimo_at: ahora,
    updated_at: ahora,
  }).eq('id', t.id)
}

/** Quien revisa contestó. Aceptar cierra la tarea; devolver suma una ronda. */
export async function sellarRevision(t: TareaMT, estado: 'aceptado' | 'corregir'): Promise<void> {
  const ahora = new Date().toISOString()
  const patch: any = { updated_at: ahora }
  if (estado === 'aceptado') Object.assign(patch, { aceptado_at: ahora, status: 'completada', completed_at: ahora, progress: 100 })
  else Object.assign(patch, { rondas_revision: (t.rondas_revision || 0) + 1, status: 'en_progreso' })
  await supabase.from('project_tasks').update(patch).eq('id', t.id)
}

// ── Quién revisa ───────────────────────────────────────────────────────────

const sinAcentos = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
export const esDG = (p?: Persona | null) => !!p && /DIRECTOR\s+GENERAL|DIRECCION\s+GENERAL/.test(sinAcentos(p.puesto))
export const esDirectorP = (p?: Persona | null) => !!p && /DIRECTOR|DIRECCION/.test(sinAcentos(p.puesto))

/** El director de una especialidad (el de su área, sin contar al DG). */
export function directorDe(specialty: string, gente: Persona[]): Persona | null {
  const area = AREAS_TRABAJO.find(a => a.specialty === specialty)?.area
  if (!area) return null
  return gente.find(p => p.area.toUpperCase() === area && esDirectorP(p) && !esDG(p)) || null
}

/**
 * Quién aprueba una tarea. Por ahora, siempre interno:
 *   · si la encargó alguien (solicitada_por), esa persona;
 *   · si no, el director del área;
 *   · si quien la hace ES el director, la Dirección General.
 * Cuando Elias defina aprobadores por fase (cliente / proveedor), entra aquí.
 */
export function revisorDe(t: TareaMT, gente: Persona[]): Persona | null {
  const porId = (id?: string | null) => gente.find(p => p.id === id) || null
  const pidio = porId(t.solicitada_por_id)
  if (pidio && pidio.id !== t.assignee_id) return pidio
  const dir = directorDe(especialidadDe(t), gente)
  if (dir && dir.id !== t.assignee_id) return dir
  return gente.find(esDG) || null
}

// ── Fechas ─────────────────────────────────────────────────────────────────

export type Cajon = 'vencido' | 'hoy' | 'semana' | 'despues' | 'sin'
export const CAJONES: { k: Cajon; t: string; color?: string }[] = [
  { k: 'vencido', t: 'Vencido', color: '#E5484D' },
  { k: 'hoy', t: 'Hoy', color: '#D9930A' },
  { k: 'semana', t: 'Esta semana' },
  { k: 'despues', t: 'Después' },
  { k: 'sin', t: 'Sin fecha · nadie la ha comprometido' },
]

const hoyISO = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function diasA(fecha?: string | null): number | null {
  if (!fecha) return null
  return Math.round((new Date(fecha.slice(0, 10) + 'T12:00:00').getTime() - new Date(hoyISO() + 'T12:00:00').getTime()) / 86400000)
}

export function cajonDe(t: TareaMT): Cajon {
  const d = diasA(t.due_date)
  if (d === null) return 'sin'
  if (d < 0) return 'vencido'
  if (d === 0) return 'hoy'
  if (d <= 7) return 'semana'
  return 'despues'
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export function fechaCorta(f?: string | null): string {
  if (!f) return ''
  const [, m, d] = f.slice(0, 10).split('-')
  return `${Number(d)} ${MESES[Number(m) - 1]}`
}

export function etiquetaFecha(t: TareaMT): { txt: string; color: string } {
  const d = diasA(t.due_date)
  if (d === null) return { txt: 'Sin fecha', color: '#6E7179' }
  if (d < 0) return { txt: `Venció ${fechaCorta(t.due_date)}`, color: '#E5484D' }
  if (d === 0) return { txt: 'Hoy', color: '#D9930A' }
  if (d <= 3) return { txt: `${fechaCorta(t.due_date)} · en ${d} d`, color: '#D9930A' }
  return { txt: fechaCorta(t.due_date), color: '#A7AAB2' }
}

/** Días hábiles entre dos fechas (lun–vie). Para el reloj de revisión. */
export function diasHabiles(desde: string, hasta = new Date().toISOString()): number {
  const a = new Date(desde), b = new Date(hasta)
  if (b <= a) return 0
  let n = 0
  const d = new Date(a)
  while (d < b) {
    d.setDate(d.getDate() + 1)
    const w = d.getDay()
    if (w !== 0 && w !== 6 && d <= b) n++
  }
  return n
}

export const iniciales = (n?: string | null) =>
  (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
