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
  /** Días que tiene el revisor para contestar. Es SU compromiso. */
  dias_revision: number
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
  /** Puntos del checklist que el revisor marcó como NO cumplidos. */
  fallas?: string[] | null
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
    .select('id,clave,nombre,specialty,descripcion,formato,checklist,dias_revision,activo,orden')
    .eq('activo', true).order('orden')
  return ((data as any[]) || []).map(t => ({ ...t, dias_revision: Number(t.dias_revision) || 2, checklist: normalizarChecklist(t.checklist) }))
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
  opts: { revisadoPorId?: string | null; correcciones?: string; fallas?: string[] },
): Promise<{ ok: boolean; error?: string }> {
  const fallas = (opts.fallas || []).filter(Boolean)
  // Devolver sin decir qué está mal obliga a otra vuelta y no deja rastro.
  // Basta con marcar puntos del checklist —dos clics— o escribirlo; exigir
  // ambas cosas convertiría la revisión en trámite y dejaría de hacerse.
  if (estado === 'corregir' && fallas.length === 0 && !opts.correcciones?.trim()) {
    return { ok: false, error: 'Marca qué puntos fallaron o escribe qué corregir: sin eso, la vuelta se repite.' }
  }
  const { error } = await supabase.from('entregables').update({
    estado,
    revisado_por_id: opts.revisadoPorId || null,
    revisado_at: new Date().toISOString(),
    correcciones: opts.correcciones?.trim() || null,
    fallas,
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


// ═══════════════════════════════════════════════════════════════════════════
// CALIDAD — medida en lo que falla, no en una opinión.
//
// El checklist de cada tipo de entregable ya es estándar. Cuando el revisor
// marca qué puntos no se cumplieron, esas marcas se vuelven el único
// indicador de calidad que sirve para hacer algo:
//
//   "el 60% de los sembrados regresa por falta de nube de cambios"
//     → se corrige con una plantilla o media hora de capacitación
//
//   "hay que tener más cuidado"
//     → no se corrige nunca
//
// Por eso lo que se reporta no es una calificación por persona sino un
// RANKING DE PUNTOS QUE FALLAN. La lectura por persona existe, pero abajo y
// en segundo plano: si el mismo punto falla en toda la organización, el
// problema es el proceso y señalar personas lo esconde.
// ═══════════════════════════════════════════════════════════════════════════

export interface FallaContada {
  texto: string
  veces: number
  /** De cuántas entregas revisadas de ese tipo. */
  deCuantas: number
  pct: number
}

export interface CalidadTipo {
  tipoId: string | null
  nombre: string
  entregas: number
  revisadas: number
  aceptadasALaPrimera: number
  pctALaPrimera: number | null
  vueltasProm: number | null
  fallas: FallaContada[]
}

/** Cuenta las fallas de un conjunto de entregables ya revisados. */
export function contarFallas(es: Entregable[]): FallaContada[] {
  const revisados = es.filter(e => e.estado !== 'en_revision')
  const m = new Map<string, number>()
  for (const e of revisados) for (const f of (e.fallas || [])) m.set(f, (m.get(f) || 0) + 1)
  return [...m.entries()]
    .map(([texto, veces]) => ({ texto, veces, deCuantas: revisados.length, pct: revisados.length ? veces / revisados.length : 0 }))
    .sort((a, b) => b.veces - a.veces)
}

/**
 * Calidad por tipo de entregable. "A la primera" se calcula por TAREA, no por
 * archivo: si una tarea tuvo v1 devuelta y v2 aceptada, no fue a la primera
 * aunque el segundo archivo se haya aceptado sin peros.
 */
export function calidadPorTipo(es: Entregable[], tipos: TipoEntregable[]): CalidadTipo[] {
  const g = new Map<string, Entregable[]>()
  for (const e of es) {
    const k = e.tipo_id || 'sin_tipo'
    const arr = g.get(k); if (arr) arr.push(e); else g.set(k, [e])
  }
  const out: CalidadTipo[] = []
  for (const [k, lista] of g.entries()) {
    const revisadas = lista.filter(e => e.estado !== 'en_revision')
    // Agrupar por tarea para saber cuántas cadenas llegaron limpias.
    const porTarea = new Map<string, Entregable[]>()
    for (const e of lista) {
      const t = e.task_id || e.id
      const arr = porTarea.get(t); if (arr) arr.push(e); else porTarea.set(t, [e])
    }
    const cadenas = [...porTarea.values()]
    const cerradas = cadenas.filter(c => c.some(e => e.estado === 'aceptado'))
    const limpias = cerradas.filter(c => c.length === 1 && c[0].estado === 'aceptado')
    const vueltas = cerradas.map(c => c.filter(e => e.estado === 'corregir').length)

    out.push({
      tipoId: k === 'sin_tipo' ? null : k,
      nombre: tipos.find(t => t.id === k)?.nombre || 'Sin tipo definido',
      entregas: lista.length,
      revisadas: revisadas.length,
      aceptadasALaPrimera: limpias.length,
      pctALaPrimera: cerradas.length ? limpias.length / cerradas.length : null,
      vueltasProm: vueltas.length ? vueltas.reduce((a, b) => a + b, 0) / vueltas.length : null,
      fallas: contarFallas(lista),
    })
  }
  return out.sort((a, b) => b.entregas - a.entregas)
}

/** Todo lo entregado en el periodo, para los indicadores de calidad. */
export async function cargarEntregablesCalidad(desde?: string): Promise<Entregable[]> {
  let q = supabase.from('entregables')
    .select('id,task_id,tipo_id,nombre,version,estado,fallas,subido_por_id,subido_at,revisado_por_id,revisado_at,specialty')
    .order('subido_at', { ascending: false }).limit(3000)
  if (desde) q = q.gte('subido_at', desde)
  const { data } = await q
  return ((data as any[]) || []) as Entregable[]
}
