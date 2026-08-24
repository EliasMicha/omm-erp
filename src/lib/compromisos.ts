// ═══════════════════════════════════════════════════════════════════════════
// compromisos — el plan semanal de la oficina.
//
// Qué problema resuelve, con números: el módulo de Proyectos tiene 646 tareas,
// dos con responsable y ninguna con fecha. Nadie puede saber qué le toca. En
// cambio el plan semanal de obra lleva seis semanas seguidas con ~95
// asignaciones cada una, porque alguien lo llena antes de que empiece la
// semana. La diferencia no es el software: es el ritual.
//
// Aquí el ritual está en el código:
//   · Un entregable exige responsable, fecha y criterio de calidad. Sin las
//     tres cosas no existe.
//   · No se puede comprometer una semana nueva sin haber cerrado la anterior.
//     Rendir cuentas es la puerta de entrada, no un reporte opcional.
//   · Lo no entregado se mueve dejando rastro (`movido_de_id`), así el
//     cumplimiento no se puede maquillar arrastrando pendientes.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'

/** Las cuatro áreas de oficina. Los instaladores ya tienen su plan semanal en Obra. */
export const AREAS = [
  { key: 'INGENIERIAS ELECTRICAS', label: 'Ingenierías Eléctricas', color: '#F59E0B' },
  { key: 'INGENIERIAS ESPECIALES', label: 'Ingenierías Especiales', color: '#2563EB' },
  { key: 'ILUMINACION', label: 'Iluminación', color: '#A78BFA' },
  { key: 'ADMINISTRACION', label: 'Administración', color: '#10B981' },
] as const

export type AreaKey = typeof AREAS[number]['key']

export type EstadoSemana = 'borrador' | 'comprometido' | 'cerrado'
export type EstadoEntregable = 'comprometido' | 'entregado' | 'no_entregado' | 'movido'

export const ESTADO_SEMANA_CFG: Record<EstadoSemana, { label: string; color: string }> = {
  borrador:     { label: 'Sin comprometer', color: '#DC2626' },
  comprometido: { label: 'Comprometida',    color: '#2563EB' },
  cerrado:      { label: 'Cerrada',         color: '#10B981' },
}

export const ESTADO_ENTREGABLE_CFG: Record<EstadoEntregable, { label: string; color: string }> = {
  comprometido: { label: 'Comprometido', color: '#888' },
  entregado:    { label: 'Entregado',    color: '#10B981' },
  no_entregado: { label: 'No entregado', color: '#DC2626' },
  movido:       { label: 'Movido',       color: '#D9A441' },
}

export interface Entregable {
  id: string
  compromiso_id: string
  titulo: string
  responsable_id: string
  fecha_compromiso: string
  criterio_calidad: string
  proyecto_ref?: string | null
  estado: EstadoEntregable
  entregado_at?: string | null
  evidencia?: string | null
  motivo?: string | null
  movido_de_id?: string | null
  order_index: number
}

export interface CompromisoSemana {
  id: string
  area: string
  week_start: string
  director_id?: string | null
  estado: EstadoSemana
  comprometido_at?: string | null
  cerrado_at?: string | null
  notas_cierre?: string | null
  entregables?: Entregable[]
}

// ── Semanas ────────────────────────────────────────────────────────────────

/** El lunes de la semana de una fecha. Todo el módulo gira sobre lunes. */
export function lunesDe(fecha: Date | string = new Date()): string {
  const d = typeof fecha === 'string' ? new Date(fecha + 'T12:00:00') : new Date(fecha)
  const dia = d.getDay()                    // 0 domingo … 6 sábado
  const diff = dia === 0 ? -6 : 1 - dia
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

export function sumarSemanas(weekStart: string, n: number): string {
  const d = new Date(weekStart + 'T12:00:00')
  d.setDate(d.getDate() + n * 7)
  return d.toISOString().slice(0, 10)
}

/** «25 – 29 de agosto» para encabezar la semana. */
export function rangoSemana(weekStart: string): string {
  const a = new Date(weekStart + 'T12:00:00')
  const b = new Date(weekStart + 'T12:00:00')
  b.setDate(b.getDate() + 4)   // viernes
  const mesA = a.toLocaleDateString('es-MX', { month: 'long' })
  const mesB = b.toLocaleDateString('es-MX', { month: 'long' })
  return mesA === mesB
    ? `${a.getDate()} – ${b.getDate()} de ${mesB}`
    : `${a.getDate()} de ${mesA} – ${b.getDate()} de ${mesB}`
}

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'] as const

/** Días hábiles de una semana, para elegir la fecha de un entregable. */
export function diasDeSemana(weekStart: string): Array<{ fecha: string; label: string }> {
  return DIAS.map((d, i) => {
    const f = new Date(weekStart + 'T12:00:00')
    f.setDate(f.getDate() + i)
    return { fecha: f.toISOString().slice(0, 10), label: `${d} ${f.getDate()}` }
  })
}

// ── Cumplimiento ───────────────────────────────────────────────────────────

export interface Cumplimiento {
  total: number
  entregados: number
  noEntregados: number
  movidos: number
  pendientes: number
  vencidos: number
  pct: number | null       // null cuando la semana aún no cierra nada
}

/**
 * Cómo va un área. `pct` mide contra lo COMPROMETIDO, no contra lo que quedó
 * al final: si algo se movió a otra semana sigue contando como no cumplido en
 * ésta. Es la única forma de que el número signifique algo.
 */
export function cumplimientoDe(entregables: Entregable[], hoy = new Date().toISOString().slice(0, 10)): Cumplimiento {
  const total = entregables.length
  const entregados = entregables.filter(e => e.estado === 'entregado').length
  const noEntregados = entregables.filter(e => e.estado === 'no_entregado').length
  const movidos = entregables.filter(e => e.estado === 'movido').length
  const pendientes = entregables.filter(e => e.estado === 'comprometido').length
  const vencidos = entregables.filter(e => e.estado === 'comprometido' && e.fecha_compromiso < hoy).length
  const juzgados = entregados + noEntregados + movidos
  return {
    total, entregados, noEntregados, movidos, pendientes, vencidos,
    pct: juzgados > 0 ? entregados / total : null,
  }
}

// ── Operaciones ────────────────────────────────────────────────────────────

/** Trae la semana de un área con sus entregables. */
export async function cargarSemana(area: string, weekStart: string): Promise<CompromisoSemana | null> {
  const { data } = await supabase.from('compromisos_semana')
    .select('*, entregables:compromiso_entregables(*)')
    .eq('area', area).eq('week_start', weekStart).maybeSingle()
  if (!data) return null
  const c = data as any
  c.entregables = (c.entregables || []).sort((a: any, b: any) =>
    String(a.fecha_compromiso).localeCompare(String(b.fecha_compromiso)) || a.order_index - b.order_index)
  return c
}

export async function cargarTodasLasAreas(weekStart: string): Promise<CompromisoSemana[]> {
  const { data } = await supabase.from('compromisos_semana')
    .select('*, entregables:compromiso_entregables(*)')
    .eq('week_start', weekStart)
  return ((data as any[]) || []).map(c => ({
    ...c,
    entregables: (c.entregables || []).sort((a: any, b: any) =>
      String(a.fecha_compromiso).localeCompare(String(b.fecha_compromiso)) || a.order_index - b.order_index),
  }))
}

export async function abrirSemana(area: string, weekStart: string, directorId?: string | null): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.from('compromisos_semana')
    .insert({ area, week_start: weekStart, director_id: directorId || null })
    .select('id').single()
  if (error) return { error: error.message }
  return { id: (data as any).id }
}

/**
 * ¿Se puede comprometer esta semana? Solo si la anterior ya se cerró. Es el
 * candado del ritual: rendir cuentas antes de volver a prometer.
 *
 * La primera semana de un área no tiene anterior que cerrar, así que pasa.
 */
export async function puedeComprometer(area: string, weekStart: string): Promise<{ ok: boolean; motivo?: string; anterior?: CompromisoSemana }> {
  const anteriorInicio = sumarSemanas(weekStart, -1)
  const { data } = await supabase.from('compromisos_semana')
    .select('id,week_start,estado').eq('area', area).eq('week_start', anteriorInicio).maybeSingle()
  if (!data) return { ok: true }                       // no hay semana previa
  const a = data as any
  if (a.estado === 'cerrado') return { ok: true }
  if (a.estado === 'borrador') return { ok: true }     // nunca se comprometió: no hay nada que rendir
  return {
    ok: false,
    motivo: `Falta cerrar la semana del ${anteriorInicio}: hay que marcar qué se entregó y qué no antes de comprometer una nueva.`,
    anterior: a,
  }
}

export async function comprometer(compromisoId: string, quien: string): Promise<{ ok: boolean; error?: string }> {
  const { data: c } = await supabase.from('compromisos_semana').select('area,week_start').eq('id', compromisoId).maybeSingle()
  if (!c) return { ok: false, error: 'No encontré esa semana.' }
  const permiso = await puedeComprometer((c as any).area, (c as any).week_start)
  if (!permiso.ok) return { ok: false, error: permiso.motivo }

  const { count } = await supabase.from('compromiso_entregables')
    .select('id', { count: 'exact', head: true }).eq('compromiso_id', compromisoId)
  if (!count) return { ok: false, error: 'Agrega al menos un entregable antes de comprometer la semana.' }

  const { error } = await supabase.from('compromisos_semana')
    .update({ estado: 'comprometido', comprometido_at: new Date().toISOString(), comprometido_por: quien, updated_at: new Date().toISOString() })
    .eq('id', compromisoId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function cerrarSemana(compromisoId: string, quien: string, notas?: string): Promise<{ ok: boolean; error?: string }> {
  const { data: pend } = await supabase.from('compromiso_entregables')
    .select('id').eq('compromiso_id', compromisoId).eq('estado', 'comprometido')
  if ((pend || []).length > 0) {
    return { ok: false, error: `Quedan ${(pend || []).length} entregable(s) sin resolver. Marca cada uno como entregado, no entregado o muévelo a la semana siguiente.` }
  }
  const { error } = await supabase.from('compromisos_semana')
    .update({ estado: 'cerrado', cerrado_at: new Date().toISOString(), cerrado_por: quien, notas_cierre: notas || null, updated_at: new Date().toISOString() })
    .eq('id', compromisoId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/**
 * Mueve un entregable a la semana siguiente. En la semana que termina queda
 * marcado como MOVIDO —no desaparece— y en la nueva nace con `movido_de_id`
 * apuntando al original. Así se puede ver qué lleva tres semanas rodando.
 */
export async function moverASiguiente(
  entregable: Entregable, area: string, weekStart: string, motivo: string, directorId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const siguiente = sumarSemanas(weekStart, 1)
  let destino = await cargarSemana(area, siguiente)
  if (!destino) {
    const r = await abrirSemana(area, siguiente, directorId)
    if (r.error) return { ok: false, error: r.error }
    destino = await cargarSemana(area, siguiente)
  }
  if (!destino) return { ok: false, error: 'No pude abrir la semana siguiente.' }

  // La fecha se recorre una semana para que caiga en día hábil equivalente.
  const nuevaFecha = sumarSemanas(entregable.fecha_compromiso, 1)
  const { error: e1 } = await supabase.from('compromiso_entregables').insert({
    compromiso_id: destino.id,
    titulo: entregable.titulo,
    responsable_id: entregable.responsable_id,
    fecha_compromiso: nuevaFecha,
    criterio_calidad: entregable.criterio_calidad,
    proyecto_ref: entregable.proyecto_ref || null,
    movido_de_id: entregable.id,
    order_index: entregable.order_index,
  })
  if (e1) return { ok: false, error: e1.message }

  const { error: e2 } = await supabase.from('compromiso_entregables')
    .update({ estado: 'movido', motivo, updated_at: new Date().toISOString() }).eq('id', entregable.id)
  return e2 ? { ok: false, error: e2.message } : { ok: true }
}

/** Cuántas veces se ha movido este entregable. Un 3 aquí es una conversación. */
export async function vecesMovido(entregableId: string): Promise<number> {
  let n = 0
  let actual: string | null = entregableId
  for (let guard = 0; guard < 12 && actual; guard++) {
    const { data }: any = await supabase.from('compromiso_entregables')
      .select('movido_de_id').eq('id', actual).maybeSingle()
    actual = data?.movido_de_id || null
    if (actual) n++
  }
  return n
}

// ═══════════════════════════════════════════════════════════════════════════
// Solicitudes de dirección
//
// El plan semanal no se escribe en el vacío: se escribe contra lo que se le
// pidió al área. Esta es la mitad que faltaba — sin ella, un director puede
// entregar una semana impecable de cosas que nadie le pidió, y el encargo que
// sí importaba lleva tres semanas sin que nadie lo note.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoSolicitud = 'abierta' | 'en_plan' | 'entregada' | 'cancelada'
export type Prioridad = 'alta' | 'normal' | 'baja'

export const ESTADO_SOLICITUD_CFG: Record<EstadoSolicitud, { label: string; color: string }> = {
  abierta:   { label: 'Sin planear', color: '#DC2626' },
  en_plan:   { label: 'En el plan',  color: '#2563EB' },
  entregada: { label: 'Entregada',   color: '#10B981' },
  cancelada: { label: 'Cancelada',   color: '#555' },
}

export const PRIORIDAD_CFG: Record<Prioridad, { label: string; color: string }> = {
  alta:   { label: 'Alta',   color: '#DC2626' },
  normal: { label: 'Normal', color: '#888' },
  baja:   { label: 'Baja',   color: '#555' },
}

export interface Solicitud {
  id: string
  area: string
  titulo: string
  detalle?: string | null
  criterio_calidad?: string | null
  proyecto_ref?: string | null
  prioridad: Prioridad
  fecha_requerida?: string | null
  estado: EstadoSolicitud
  solicitado_por?: string | null
  created_at?: string
}

export async function cargarSolicitudes(opts?: { area?: string; incluirCerradas?: boolean }): Promise<Solicitud[]> {
  let q = supabase.from('solicitudes_direccion').select('*')
  if (opts?.area) q = q.eq('area', opts.area)
  if (!opts?.incluirCerradas) q = q.in('estado', ['abierta', 'en_plan'])
  const { data } = await q.order('prioridad').order('fecha_requerida', { ascending: true, nullsFirst: false })
  return ((data as any[]) || []) as Solicitud[]
}

export async function crearSolicitud(s: Partial<Solicitud> & { area: string; titulo: string }): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.from('solicitudes_direccion').insert({
    area: s.area,
    titulo: s.titulo,
    detalle: s.detalle || null,
    criterio_calidad: s.criterio_calidad || null,
    proyecto_ref: s.proyecto_ref || null,
    prioridad: s.prioridad || 'normal',
    fecha_requerida: s.fecha_requerida || null,
    solicitado_por: s.solicitado_por || null,
  }).select('id').single()
  if (error) return { error: error.message }
  return { id: (data as any).id }
}

/**
 * Cuántas semanas lleva una solicitud sin que nadie la planee. Es el número
 * que convierte "siento que no avanzan" en un hecho conversable.
 */
export function semanasSinPlanear(s: Solicitud, hoy = new Date()): number {
  if (s.estado !== 'abierta' || !s.created_at) return 0
  const dias = (hoy.getTime() - new Date(s.created_at).getTime()) / 86400000
  return Math.max(0, Math.floor(dias / 7))
}

/** ¿Ya se pasó la fecha en que se necesitaba? */
export function solicitudVencida(s: Solicitud, hoy = new Date().toISOString().slice(0, 10)): boolean {
  return !!s.fecha_requerida && s.fecha_requerida < hoy && (s.estado === 'abierta' || s.estado === 'en_plan')
}

/**
 * Convierte una solicitud en un entregable de la semana. El director elige
 * quién y qué día; el criterio de calidad viene de quien la pidió, que es
 * quien sabe cómo se ve bien.
 */
export async function planearSolicitud(
  solicitud: Solicitud,
  compromisoId: string,
  responsableId: string,
  fecha: string,
  criterioCalidad: string,
  orden = 0,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('compromiso_entregables').insert({
    compromiso_id: compromisoId,
    titulo: solicitud.titulo,
    responsable_id: responsableId,
    fecha_compromiso: fecha,
    criterio_calidad: criterioCalidad || solicitud.criterio_calidad || 'Según lo solicitado',
    proyecto_ref: solicitud.proyecto_ref || null,
    solicitud_id: solicitud.id,
    order_index: orden,
  })
  if (error) return { ok: false, error: error.message }
  await supabase.from('solicitudes_direccion')
    .update({ estado: 'en_plan', updated_at: new Date().toISOString() }).eq('id', solicitud.id)
  return { ok: true }
}

/**
 * Al marcar entregado un entregable ligado a una solicitud, la solicitud se
 * cierra sola. Si no se entregó, regresa a 'abierta' para que vuelva a
 * aparecer en la lista de lo que falta — que es donde tiene que estar.
 */
export async function sincronizarSolicitud(solicitudId: string | null | undefined, estadoEntregable: EstadoEntregable): Promise<void> {
  if (!solicitudId) return
  if (estadoEntregable === 'entregado') {
    await supabase.from('solicitudes_direccion')
      .update({ estado: 'entregada', cerrada_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', solicitudId)
  } else if (estadoEntregable === 'no_entregado') {
    await supabase.from('solicitudes_direccion')
      .update({ estado: 'abierta', updated_at: new Date().toISOString() })
      .eq('id', solicitudId)
  }
  // 'movido' se queda en_plan: sigue planeada, solo que en otra semana.
}
