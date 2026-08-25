// ═══════════════════════════════════════════════════════════════════════════
// plantillas — el cascadeo, escrito una vez y reusado.
//
// Un encargo no es una tarea: es una cadena. Llega un levantamiento y de ahí
// salen seis actividades con dueños distintos, en orden, con fechas que se
// calculan hacia atrás desde el compromiso con el cliente.
//
// Dos decisiones que sostienen esto:
//
//   1. Las actividades se asignan por ROL, no por persona. La misma plantilla
//      sirve para Eléctricas y para Especiales aunque la gente sea otra.
//
//   2. Las fechas se cuentan HACIA ATRÁS desde la entrega comprometida. Es la
//      única forma de que el plan diga la verdad: si el cliente quiere el
//      sembrado el viernes, la revisión del director no puede ser el viernes.
//      Cuando el cálculo hacia atrás cae en el pasado, no se esconde — se
//      marca, porque significa que el encargo ya nació tarde.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'
import { Rol, EmpleadoRol, resolverResponsable } from './roles'
import { AREAS_TRABAJO, URGENCIA_TAREA_CFG, UrgenciaTarea, TipoTarea } from './tareas'

export interface PlantillaEncargo {
  id: string
  clave: string
  nombre: string
  tipo: TipoTarea | string
  specialty?: string | null
  descripcion?: string | null
  recurrencia?: string | null
  activo: boolean
  origen: 'manual' | 'ia'
  veces_usada: number
}

export interface ActividadPlantilla {
  id?: string
  plantilla_id?: string
  orden: number
  nombre: string
  descripcion?: string | null
  rol: Rol
  specialty?: string | null
  tipo_entregable_id?: string | null
  urgencia: UrgenciaTarea
  dias_desde_inicio?: number | null
  dias_antes_entrega?: number | null
  depende_de?: number | null
  obligatoria: boolean
}

export const RECURRENCIAS = [
  { key: '', label: 'No se repite' },
  { key: 'semanal', label: 'Cada semana' },
  { key: 'quincenal', label: 'Cada quincena' },
  { key: 'mensual', label: 'Cada mes' },
] as const

// ── Lectura ────────────────────────────────────────────────────────────────

export async function cargarPlantillas(): Promise<PlantillaEncargo[]> {
  const { data } = await supabase.from('plantillas_encargo').select('*').eq('activo', true).order('nombre')
  return ((data as any[]) || []) as PlantillaEncargo[]
}

export async function actividadesDe(plantillaId: string): Promise<ActividadPlantilla[]> {
  const { data } = await supabase.from('plantilla_actividades').select('*').eq('plantilla_id', plantillaId).order('orden')
  return ((data as any[]) || []) as ActividadPlantilla[]
}

// ── Escritura ──────────────────────────────────────────────────────────────

const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50)

export async function guardarPlantilla(
  p: Partial<PlantillaEncargo> & { nombre: string },
  actividades: ActividadPlantilla[],
  porId?: string | null,
): Promise<{ id?: string; error?: string }> {
  if (!p.nombre.trim()) return { error: 'La plantilla necesita nombre.' }
  if (actividades.length === 0) return { error: 'Una plantilla sin actividades no sirve para nada.' }

  let id = p.id
  const fila: any = {
    nombre: p.nombre.trim(),
    tipo: p.tipo || 'proyecto',
    specialty: p.specialty || null,
    descripcion: p.descripcion || null,
    recurrencia: p.recurrencia || null,
    origen: p.origen || 'manual',
    activo: true,
    updated_at: new Date().toISOString(),
    updated_por_id: porId || null,
  }

  if (id) {
    const { error } = await supabase.from('plantillas_encargo').update(fila).eq('id', id)
    if (error) return { error: error.message }
    await supabase.from('plantilla_actividades').delete().eq('plantilla_id', id)
  } else {
    fila.clave = `${slug(p.nombre)}_${Math.random().toString(36).slice(2, 6)}`
    const { data, error } = await supabase.from('plantillas_encargo').insert(fila).select('id').single()
    if (error) return { error: error.message }
    id = (data as any).id
  }

  const filas = actividades.map((a, i) => ({
    plantilla_id: id,
    orden: i,
    nombre: a.nombre.trim(),
    descripcion: a.descripcion || null,
    rol: a.rol,
    specialty: a.specialty || null,
    tipo_entregable_id: a.tipo_entregable_id || null,
    urgencia: a.urgencia || 'normal',
    dias_desde_inicio: a.dias_desde_inicio ?? null,
    dias_antes_entrega: a.dias_antes_entrega ?? null,
    depende_de: a.depende_de ?? null,
    obligatoria: a.obligatoria !== false,
  }))
  const { error: e2 } = await supabase.from('plantilla_actividades').insert(filas)
  if (e2) return { error: e2.message }
  return { id }
}

export async function borrarPlantilla(id: string): Promise<void> {
  await supabase.from('plantillas_encargo').update({ activo: false }).eq('id', id)
}

// ── Fechas ─────────────────────────────────────────────────────────────────

const iso = (d: Date) => d.toISOString().slice(0, 10)
const sumar = (fecha: string, dias: number) => {
  const d = new Date(fecha + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return iso(d)
}

/**
 * La fecha que le toca a una actividad. Si tiene `dias_antes_entrega` y hay
 * fecha objetivo, se cuenta hacia atrás desde el compromiso; si no, hacia
 * adelante desde el arranque. Devuelve también si quedó en el pasado.
 */
export function fechaDe(a: ActividadPlantilla, inicio: string, objetivo?: string | null): { fecha: string | null; enElPasado: boolean } {
  const hoy = iso(new Date())
  let f: string | null = null
  if (a.dias_antes_entrega != null && objetivo) f = sumar(objetivo, -Math.abs(a.dias_antes_entrega))
  else if (a.dias_desde_inicio != null) f = sumar(inicio, Math.abs(a.dias_desde_inicio))
  return { fecha: f, enElPasado: !!f && f < hoy }
}

// ── Aplicar ────────────────────────────────────────────────────────────────

export interface ContextoEncargo {
  specialty: string
  /** Fecha comprometida con el cliente. Es la que manda. */
  fechaObjetivo?: string | null
  inicio?: string
  leadId?: string | null
  projectId?: string | null
  phaseId?: string | null
  levantamientoId?: string | null
  tituloCliente?: string | null
  /** Prefijo para el nombre de cada actividad: "Cúspide — Sembrado". */
  prefijo?: string | null
  solicitadaPor?: string | null
  solicitadaPorId?: string | null
  instrucciones?: string | null
}

export interface ResultadoAplicar {
  creadas: number
  sinDueno: number
  enElPasado: number
  error?: string
}

export async function aplicarPlantilla(
  plantillaId: string,
  ctx: ContextoEncargo,
  empleados: EmpleadoRol[],
): Promise<ResultadoAplicar> {
  const acts = await actividadesDe(plantillaId)
  if (acts.length === 0) return { creadas: 0, sinDueno: 0, enElPasado: 0, error: 'Esa plantilla no tiene actividades.' }
  return crearActividades(acts, ctx, empleados, plantillaId)
}

/**
 * Crea las actividades de verdad. Se usa igual para una plantilla guardada y
 * para un plan que acaba de proponer la IA y una persona ya revisó.
 */
export async function crearActividades(
  acts: ActividadPlantilla[],
  ctx: ContextoEncargo,
  empleados: EmpleadoRol[],
  plantillaId?: string,
): Promise<ResultadoAplicar> {
  const inicio = ctx.inicio || iso(new Date())
  const areaDe = (sp?: string | null) => AREAS_TRABAJO.find(a => a.specialty === (sp || ctx.specialty))?.area || null

  let sinDueno = 0, enElPasado = 0
  // Se crean en orden para poder ligar la dependencia con el id real de la
  // actividad anterior — sin eso, "esto no arranca hasta que aquello esté" es
  // una frase en una junta y no un dato.
  const idsPorOrden = new Map<number, string>()

  for (const a of acts) {
    const sp = a.specialty || ctx.specialty
    const responsable = resolverResponsable(empleados, a.rol, areaDe(sp))
    if (!responsable) sinDueno++
    const { fecha, enElPasado: tarde } = fechaDe(a, inicio, ctx.fechaObjetivo)
    if (tarde) enElPasado++

    const nombre = ctx.prefijo ? `${ctx.prefijo} — ${a.nombre}` : a.nombre
    const { data, error } = await supabase.from('project_tasks').insert({
      name: nombre.slice(0, 200),
      description: a.descripcion || null,
      tipo: 'proyecto',
      specialty: sp,
      rol: a.rol,
      urgencia: a.urgencia || 'normal',
      priority: URGENCIA_TAREA_CFG[a.urgencia || 'normal']?.prioridad ?? 1,
      status: 'pendiente',
      progress: 0,
      order_index: a.orden,
      due_date: fecha,
      assignee_id: responsable,
      lead_id: ctx.leadId || null,
      project_id: ctx.projectId || null,
      phase_id: ctx.phaseId || null,
      levantamiento_id: ctx.levantamientoId || null,
      titulo_cliente: ctx.tituloCliente || null,
      tipo_entregable_id: a.tipo_entregable_id || null,
      instrucciones: ctx.instrucciones || null,
      solicitada_por: ctx.solicitadaPor || null,
      solicitada_por_id: ctx.solicitadaPorId || null,
      plantilla_id: plantillaId || null,
      depende_de_id: a.depende_de != null ? (idsPorOrden.get(a.depende_de) || null) : null,
    }).select('id').single()

    if (error) return { creadas: idsPorOrden.size, sinDueno, enElPasado, error: error.message }
    idsPorOrden.set(a.orden, (data as any).id)
  }

  if (plantillaId) {
    const { data: p } = await supabase.from('plantillas_encargo').select('veces_usada').eq('id', plantillaId).maybeSingle()
    await supabase.from('plantillas_encargo')
      .update({ veces_usada: (Number((p as any)?.veces_usada) || 0) + 1 }).eq('id', plantillaId)
  }

  return { creadas: idsPorOrden.size, sinDueno, enElPasado }
}
