// ═══════════════════════════════════════════════════════════════════════════
// levantamiento — formalizar el reenvío al grupo.
//
// Cómo funciona hoy en OMM: llega un proyecto por WhatsApp o correo, el DG lo
// reenvía a un grupo con indicaciones básicas, y el grupo procesa y canaliza.
// Se va lo que se va porque un mensaje reenviado no tiene fecha de entrega, no
// tiene nivel de urgencia, y nadie está obligado a contestar.
//
// Este módulo es ese mismo reenvío, con las tres cosas que le faltan:
//
//   1. QUÉ LLEGÓ queda guardado tal cual (`origen_texto`), no resumido.
//   2. A QUÉ ÁREAS se canaliza, con urgencia e indicaciones por área.
//   3. HASTA CUÁNDO tiene cada director para devolver su plan fechado.
//
// Y el punto que cierra la cadena: derivar NO genera actividades sin dueño.
// Las plantillas ya producen 25–31 actividades por proyecto — el ERP lleva 646
// de esas, con dos responsables y cero fechas. Aquí una área no queda
// "fechada" hasta que TODAS sus actividades tienen responsable y día.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'

export type Urgencia = 'urgente' | 'alta' | 'normal' | 'baja'
export type EstadoLev = 'borrador' | 'listo' | 'derivado'
export type EstadoArea = 'canalizada' | 'fechada' | 'en_curso' | 'entregada'

export const URGENCIA_CFG: Record<Urgencia, { label: string; color: string; dias: number }> = {
  // `dias` = cuánto tiene el director para contestar con su plan fechado.
  urgente: { label: 'Urgente', color: '#DC2626', dias: 1 },
  alta:    { label: 'Alta',    color: '#D97706', dias: 2 },
  normal:  { label: 'Normal',  color: '#2563EB', dias: 4 },
  baja:    { label: 'Baja',    color: '#6B7280', dias: 7 },
}

export const ESTADO_AREA_CFG: Record<EstadoArea, { label: string; color: string }> = {
  canalizada: { label: 'Sin fechar',  color: '#DC2626' },
  fechada:    { label: 'Fechada',     color: '#2563EB' },
  en_curso:   { label: 'En curso',    color: '#D9A441' },
  entregada:  { label: 'Entregada',   color: '#10B981' },
}

export const ESPECIALIDADES = [
  { key: 'elec', label: 'Ingeniería Eléctrica', area: 'INGENIERIAS ELECTRICAS', color: '#D97706' },
  { key: 'esp',  label: 'Ingenierías Especiales', area: 'INGENIERIAS ESPECIALES', color: '#2563EB' },
  { key: 'ilum', label: 'Diseño de Iluminación', area: 'ILUMINACION', color: '#A78BFA' },
] as const

export interface Levantamiento {
  id: string
  lead_id: string
  folio?: string | null
  inmueble?: string | null
  direccion?: string | null
  superficie_m2?: number | null
  niveles?: string | null
  tipo_inmueble?: string | null
  solicita?: string | null
  contacto_cliente?: string | null
  fecha_visita?: string | null
  fecha_compromiso_cliente?: string | null
  capturado_por?: string | null
  origen?: string
  origen_canal?: string | null
  origen_texto?: string | null
  urgencia: Urgencia
  indicaciones?: string | null
  estado: EstadoLev
  derivado_at?: string | null
  notas?: string | null
  created_at?: string
  areas?: LevantamientoArea[]
}

export interface LevantamientoArea {
  id: string
  levantamiento_id: string
  specialty: string
  director_id?: string | null
  alcance?: string | null
  fecha_compromiso?: string | null
  fecha_respuesta_limite?: string | null
  urgencia?: Urgencia | null
  estado: EstadoArea
  project_id?: string | null
  derivado_at?: string | null
  respondido_at?: string | null
  notas?: string | null
}

const hoyISO = () => new Date().toISOString().slice(0, 10)

export function sumarDias(fechaISO: string, dias: number): string {
  const d = new Date(fechaISO + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** RQ-260825-04. Corto, legible y ordenable — se dicta por teléfono sin pena. */
export function folioLevantamiento(fecha?: string): string {
  const f = (fecha || hoyISO()).slice(2).replace(/-/g, '')
  return `RQ-${f}-${String(Math.floor(Math.random() * 90 + 10))}`
}

/** Hasta cuándo tiene el área para contestar, según qué tan urgente es. */
export function limiteRespuesta(urgencia: Urgencia, desde?: string): string {
  return sumarDias(desde || hoyISO(), URGENCIA_CFG[urgencia]?.dias ?? 4)
}

export async function cargarLevantamientos(leadId: string): Promise<Levantamiento[]> {
  const { data } = await supabase.from('levantamientos')
    .select('*, areas:levantamiento_areas(*)')
    .eq('lead_id', leadId).order('created_at', { ascending: false })
  return ((data as any[]) || []) as Levantamiento[]
}

export async function crearLevantamiento(leadId: string, quien: string): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.from('levantamientos').insert({
    lead_id: leadId,
    folio: folioLevantamiento(),
    capturado_por: quien,
  }).select('id').single()
  if (error) return { error: error.message }
  return { id: (data as any).id }
}

/**
 * Canalizar = lo que hoy es reenviar al grupo. Cada área queda asignada a su
 * director con su urgencia y su fecha límite para contestar.
 */
export async function canalizar(lev: Levantamiento): Promise<{ ok: boolean; error?: string }> {
  const areas = lev.areas || []
  if (areas.length === 0) return { ok: false, error: 'Marca al menos un área: sin área no hay a quién canalizarle.' }
  for (const a of areas) {
    const urg = (a.urgencia || lev.urgencia) as Urgencia
    await supabase.from('levantamiento_areas').update({
      urgencia: urg,
      fecha_respuesta_limite: a.fecha_respuesta_limite || limiteRespuesta(urg),
      estado: 'canalizada',
    }).eq('id', a.id)
  }
  const { error } = await supabase.from('levantamientos')
    .update({ estado: 'listo', updated_at: new Date().toISOString() }).eq('id', lev.id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Derivar actividades ────────────────────────────────────────────────────

export interface ResultadoDerivar {
  ok: boolean
  error?: string
  projectId?: string
  actividades?: number
}

/**
 * Crea el proyecto del área y expande sus plantillas en actividades.
 *
 * Las actividades nacen SIN responsable y SIN fecha a propósito: el director
 * las fecha. Lo que cambia respecto de hoy es que el área no cuenta como
 * atendida hasta que estén todas fechadas, y eso se ve.
 */
export async function derivarArea(
  lev: Levantamiento,
  area: LevantamientoArea,
  leadNombre: string,
): Promise<ResultadoDerivar> {
  if (area.project_id) return { ok: true, projectId: area.project_id, actividades: 0 }

  const esp = ESPECIALIDADES.find(e => e.key === area.specialty)
  const nombre = `${lev.inmueble || leadNombre} — ${esp?.label || area.specialty}`

  const { data: proj, error: e1 } = await supabase.from('projects').insert({
    name: nombre,
    specialty: area.specialty,
    lead_id: lev.lead_id,
    levantamiento_id: lev.id,
    status: 'activo',
    client_name: leadNombre,
  }).select('id').single()
  if (e1 || !proj) return { ok: false, error: e1?.message || 'No pude crear el proyecto.' }
  const projectId = (proj as any).id

  // Fases desde plantilla (incluye postventa, igual que el flujo existente)
  const { data: fasesTpl } = await supabase.from('project_phase_templates')
    .select('*').in('specialty', [area.specialty, 'postventa']).order('order_index')
  const fases = ((fasesTpl as any[]) || []).map(pt => ({
    project_id: projectId, template_id: pt.id, name: pt.name,
    order_index: pt.order_index, is_post_sale: pt.is_post_sale,
    is_unlocked: !pt.is_post_sale, status: 'pendiente',
  }))
  const { data: fasesIns } = fases.length
    ? await supabase.from('project_phases').insert(fases).select()
    : { data: [] as any[] }

  const porOrden = new Map(((fasesIns as any[]) || []).map(f => [f.order_index, f.id]))

  const { data: tareasTpl } = await supabase.from('project_task_templates')
    .select('*').in('specialty', [area.specialty, 'postventa']).order('order_index')

  const tareas: any[] = []
  for (const tt of ((tareasTpl as any[]) || [])) {
    for (let ord = tt.start_phase_order; ord <= tt.end_phase_order; ord++) {
      const faseId = porOrden.get(ord)
      if (!faseId) continue
      tareas.push({
        project_id: projectId, phase_id: faseId, template_id: tt.id,
        name: tt.name, order_index: tt.order_index,
        status: 'pendiente', progress: 0, priority: 0,
      })
    }
  }
  if (tareas.length) {
    const { error: e2 } = await supabase.from('project_tasks').insert(tareas)
    if (e2) return { ok: false, error: e2.message }
  }

  await supabase.from('levantamiento_areas').update({
    project_id: projectId, derivado_at: new Date().toISOString(), estado: 'canalizada',
  }).eq('id', area.id)

  await supabase.from('levantamientos').update({
    estado: 'derivado', derivado_at: new Date().toISOString(),
  }).eq('id', lev.id)

  return { ok: true, projectId, actividades: tareas.length }
}

// ── El candado: un área no está atendida si le faltan fechas ──────────────

export interface AvanceFechado {
  total: number
  conFecha: number
  conResponsable: number
  completo: boolean
}

export async function avanceFechado(projectId: string): Promise<AvanceFechado> {
  const { data } = await supabase.from('project_tasks')
    .select('id,due_date,assignee_id,status').eq('project_id', projectId).neq('status', 'cancelada')
  const t = ((data as any[]) || [])
  const conFecha = t.filter(x => !!x.due_date).length
  const conResponsable = t.filter(x => !!x.assignee_id).length
  return {
    total: t.length,
    conFecha,
    conResponsable,
    completo: t.length > 0 && conFecha === t.length && conResponsable === t.length,
  }
}

/** Marca el área como fechada. Solo pasa si de verdad no falta nada. */
export async function marcarFechada(area: LevantamientoArea): Promise<{ ok: boolean; error?: string }> {
  if (!area.project_id) return { ok: false, error: 'Esta área todavía no tiene proyecto derivado.' }
  const av = await avanceFechado(area.project_id)
  if (!av.completo) {
    return {
      ok: false,
      error: `Faltan ${av.total - av.conFecha} actividad(es) sin fecha y ${av.total - av.conResponsable} sin responsable. ` +
             `Una actividad sin dueño y sin día es exactamente lo que hoy se pierde.`,
    }
  }
  const { error } = await supabase.from('levantamiento_areas')
    .update({ estado: 'fechada', respondido_at: new Date().toISOString() }).eq('id', area.id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** ¿Se le pasó al área la fecha de contestar? Es el pendiente que se va. */
export function respuestaVencida(a: LevantamientoArea, hoy = hoyISO()): boolean {
  return a.estado === 'canalizada' && !!a.fecha_respuesta_limite && a.fecha_respuesta_limite < hoy
}

export function diasSinResponder(a: LevantamientoArea, hoy = new Date()): number {
  if (a.estado !== 'canalizada' || !a.fecha_respuesta_limite) return 0
  const d = (hoy.getTime() - new Date(a.fecha_respuesta_limite + 'T12:00:00').getTime()) / 86400000
  return Math.max(0, Math.floor(d))
}
