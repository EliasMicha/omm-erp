// ═══════════════════════════════════════════════════════════════════════════
// entregables — el "cómo", y el reloj de los dos lados.
//
// Hasta aquí el sistema sabía QUÉ se pidió, CUÁNDO y a QUIÉN. Lo que faltaba
// es lo que de verdad discute la gente: qué tenía que traer el entregable.
//
//   LA RECETA (entregable_tipos) va donde se sube, no en la cabeza de nadie.
//   Un "sembrado de iluminación" trae su instructivo y su checklist a la
//   vista ANTES de empezar. Deja de ser criterio y pasa a ser requisito.
//
//   SUBIR = ENTREGADO, con fecha. Esa fecha es la que se juzga contra el
//   compromiso; y es la PRIMERA entrega, no la corregida — si no, bastaría
//   con entregar cualquier cosa a tiempo y arreglarla después.
//
//   REVISAR SON DOS BOTONES y también tiene reloj. Cuánto tarda un director
//   en contestar es SU número. Sin eso, "está en revisión" se vuelve el mejor
//   escondite de la organización.
//
// El checklist se copia al entregable en el momento de subir. Si mañana se
// endurece la receta, lo que ya se entregó siguió juzgándose con la receta
// que estaba vigente ese día — que es lo justo.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'

export const BUCKET = 'entregables'
export const LIMITE_BYTES = 50 * 1024 * 1024

export interface ChecklistItem {
  texto: string
  obligatorio?: boolean
  marcado?: boolean
}

export interface TipoEntregable {
  id: string
  clave: string
  nombre: string
  specialty?: string | null
  descripcion?: string | null
  formato?: string | null
  checklist: ChecklistItem[]
  activo: boolean
  orden: number
}

export type EstadoEntregable = 'en_revision' | 'aceptado' | 'corregir'

export interface Entregable {
  id: string
  task_id?: string | null
  tipo_id?: string | null
  nombre: string
  storage_path?: string | null
  drive_url?: string | null
  mime?: string | null
  bytes?: number | null
  version: number
  checklist: ChecklistItem[]
  notas?: string | null
  subido_por_id?: string | null
  subido_at: string
  estado: EstadoEntregable
  revisado_por_id?: string | null
  revisado_at?: string | null
  correcciones?: string | null
  project_id?: string | null
  lead_id?: string | null
  specialty?: string | null
  titulo_cliente?: string | null
}

export const ESTADO_CFG: Record<EstadoEntregable, { label: string; color: string }> = {
  en_revision: { label: 'En revisión', color: '#D9A441' },
  aceptado:    { label: 'Aceptado',    color: '#10B981' },
  corregir:    { label: 'Corregir',    color: '#DC2626' },
}

// ── Recetas ────────────────────────────────────────────────────────────────

export async function cargarTipos(): Promise<TipoEntregable[]> {
  const { data } = await supabase.from('entregable_tipos')
    .select('id,clave,nombre,specialty,descripcion,formato,checklist,activo,orden')
    .eq('activo', true).order('orden')
  return ((data as any[]) || []).map(t => ({ ...t, checklist: normalizarChecklist(t.checklist) }))
}

export async function guardarTipo(id: string, patch: Partial<TipoEntregable>, porId?: string | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('entregable_tipos')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_por_id: porId || null })
    .eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export function normalizarChecklist(x: any): ChecklistItem[] {
  if (!Array.isArray(x)) return []
  return x
    .map(i => typeof i === 'string' ? { texto: i } : i)
    .filter(i => i && typeof i.texto === 'string')
    .map(i => ({ texto: i.texto, obligatorio: !!i.obligatorio, marcado: !!i.marcado }))
}

/** Faltantes obligatorios. Vacío = se puede entregar sin mentir. */
export function faltantesObligatorios(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter(i => i.obligatorio && !i.marcado)
}

// ── Subir ──────────────────────────────────────────────────────────────────

export function validarArchivo(f: File): string | null {
  if (f.size > LIMITE_BYTES) {
    return `El archivo pesa ${(f.size / 1048576).toFixed(0)} MB y el límite es 50 MB. ` +
      'Súbelo a Drive y registra el link — el rastro queda igual.'
  }
  if (f.size === 0) return 'El archivo está vacío.'
  return null
}

const limpiar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')

export async function subirArchivo(taskId: string, f: File): Promise<{ path?: string; error?: string }> {
  const err = validarArchivo(f)
  if (err) return { error: err }
  const path = `${taskId || 'sueltos'}/${Date.now()}_${limpiar(f.name)}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false })
  if (error) return { error: error.message }
  return { path }
}

export interface NuevoEntregable {
  task_id: string
  tipo_id?: string | null
  nombre: string
  storage_path?: string | null
  drive_url?: string | null
  mime?: string | null
  bytes?: number | null
  checklist: ChecklistItem[]
  notas?: string | null
  subido_por_id?: string | null
  project_id?: string | null
  lead_id?: string | null
  specialty?: string | null
  titulo_cliente?: string | null
}

export async function registrar(e: NuevoEntregable): Promise<{ id?: string; error?: string }> {
  if (!e.storage_path && !e.drive_url) return { error: 'Falta el archivo o el link: un entregable sin documento no es una entrega.' }
  if (e.drive_url && !/^https?:\/\//i.test(e.drive_url)) return { error: 'El link debe empezar con http o https.' }
  const { count } = await supabase.from('entregables')
    .select('id', { count: 'exact', head: true }).eq('task_id', e.task_id)
  const { data, error } = await supabase.from('entregables').insert({
    ...e,
    nombre: e.nombre.trim() || 'Entregable',
    version: (count || 0) + 1,
    estado: 'en_revision',
  }).select('id').single()
  if (error) return { error: error.message }
  return { id: (data as any).id }
}

export async function entregablesDe(taskId: string): Promise<Entregable[]> {
  const { data } = await supabase.from('entregables').select('*').eq('task_id', taskId).order('subido_at', { ascending: false })
  return ((data as any[]) || []).map(e => ({ ...e, checklist: normalizarChecklist(e.checklist) }))
}

// ── Revisar: dos botones y un reloj ────────────────────────────────────────

export async function revisar(
  id: string,
  estado: 'aceptado' | 'corregir',
  opts: { revisadoPorId?: string | null; correcciones?: string },
): Promise<{ ok: boolean; error?: string }> {
  // Rechazar sin decir qué corregir es devolver el trabajo sin información:
  // obliga a una vuelta más y no deja rastro de qué estuvo mal.
  if (estado === 'corregir' && !opts.correcciones?.trim()) {
    return { ok: false, error: 'Escribe qué hay que corregir: sin eso, la vuelta se repite.' }
  }
  const { error } = await supabase.from('entregables').update({
    estado,
    revisado_por_id: opts.revisadoPorId || null,
    revisado_at: new Date().toISOString(),
    correcciones: estado === 'corregir' ? opts.correcciones!.trim() : (opts.correcciones?.trim() || null),
  }).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Lo que trae un revisor encima. Ordenado por el que lleva más esperando. */
export async function pendientesDeRevision(specialty?: string): Promise<Entregable[]> {
  let q = supabase.from('entregables').select('*').eq('estado', 'en_revision')
  if (specialty) q = q.eq('specialty', specialty)
  const { data } = await q.order('subido_at', { ascending: true })
  return ((data as any[]) || []).map(e => ({ ...e, checklist: normalizarChecklist(e.checklist) }))
}

export function diasEsperando(e: Entregable, ahora = Date.now()): number {
  return (ahora - new Date(e.subido_at).getTime()) / 86400000
}

/** Semáforo de la espera. Un entregable parado 3 días ya frenó a alguien. */
export function colorEspera(dias: number): string {
  if (dias < 1) return '#10B981'
  if (dias < 3) return '#D9A441'
  return '#DC2626'
}

// ── Acceso al archivo ──────────────────────────────────────────────────────

export function urlDe(e: { storage_path?: string | null; drive_url?: string | null }): string | null {
  if (e.drive_url) return e.drive_url
  if (e.storage_path) return supabase.storage.from(BUCKET).getPublicUrl(e.storage_path).data.publicUrl
  return null
}

export const pesoLegible = (b?: number | null): string => {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

// ── Documentación: el índice central ───────────────────────────────────────
//
// Junta dos orígenes que hoy viven separados: los entregables nuevos y la
// Documentación técnica de proyectos, que son links de Drive. Se ven en la
// misma lista porque el que busca un plano seis meses después no se acuerda
// —ni tiene por qué— de por cuál de los dos caminos entró.

export interface DocIndex {
  id: string
  origen: 'entregable' | 'tecnico'
  nombre: string
  tipo: string
  fecha: string
  project_id?: string | null
  proyecto?: string | null
  specialty?: string | null
  estado?: EstadoEntregable | null
  version?: string | null
  url: string | null
  subido_por_id?: string | null
  task_id?: string | null
  bytes?: number | null
}

export async function cargarDocumentacion(): Promise<DocIndex[]> {
  const [{ data: ents }, { data: tec }, { data: tipos }, { data: proys }] = await Promise.all([
    supabase.from('entregables').select('*').order('subido_at', { ascending: false }).limit(2000),
    supabase.from('obra_documentos').select('*').order('fecha_subida', { ascending: false }).limit(2000),
    supabase.from('entregable_tipos').select('id,nombre'),
    supabase.from('projects').select('id,name'),
  ])
  const nombreTipo = new Map(((tipos as any[]) || []).map(t => [t.id, t.nombre]))
  const nombreProy = new Map(((proys as any[]) || []).map(p => [p.id, p.name]))

  const a: DocIndex[] = ((ents as any[]) || []).map(e => ({
    id: e.id,
    origen: 'entregable',
    nombre: e.nombre,
    tipo: nombreTipo.get(e.tipo_id) || 'Entregable',
    fecha: e.subido_at,
    project_id: e.project_id,
    proyecto: nombreProy.get(e.project_id) || e.titulo_cliente || null,
    specialty: e.specialty,
    estado: e.estado,
    version: `v${e.version}`,
    url: urlDe(e),
    subido_por_id: e.subido_por_id,
    task_id: e.task_id,
    bytes: e.bytes,
  }))

  const b: DocIndex[] = ((tec as any[]) || []).map(d => ({
    id: d.id,
    origen: 'tecnico',
    nombre: d.nombre,
    tipo: d.tipo || 'Documento técnico',
    fecha: d.fecha_subida || d.created_at || new Date(0).toISOString(),
    project_id: d.project_id,
    proyecto: nombreProy.get(d.project_id) || null,
    specialty: d.sistema || null,
    estado: null,
    version: d.version || null,
    url: d.drive_url || null,
    subido_por_id: d.subido_por_id,
    task_id: null,
    bytes: null,
  }))

  return [...a, ...b].sort((x, y) => String(y.fecha).localeCompare(String(x.fecha)))
}
