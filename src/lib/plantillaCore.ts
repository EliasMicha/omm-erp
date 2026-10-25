// ═══════════════════════════════════════════════════════════════════════════
// plantillaCore — el motor de plantillas SIN cliente propio.
//
// Recibe el cliente de Supabase como parámetro para que lo usen, idéntico,
// el ERP (navegador, `src/lib/supabase`) y el MCP (Deno, cliente de servicio).
// Antes el MCP tenía su propia copia que expandía las plantillas VIEJAS
// (project_*_templates): un proyecto creado desde Claude nacía con tareas sin
// dueño, sin fecha y sin etapa, mientras que uno creado desde el ERP nacía
// completo. Dos motores = dos versiones de la verdad.
//
// REGLA: este archivo no importa nada que toque el navegador ni `./supabase`.
// Solo `./roles` (funciones puras). Si agregas un import, que sea puro.
// ═══════════════════════════════════════════════════════════════════════════
import { Rol, EmpleadoRol, resolverResponsable, tieneRol, conRol } from './roles'

export interface ActividadCore {
  orden: number
  nombre: string
  descripcion?: string | null
  rol: Rol
  specialty?: string | null
  tipo_entregable_id?: string | null
  urgencia?: string | null
  dias_desde_inicio?: number | null
  dias_antes_entrega?: number | null
  depende_de?: number | null
  etapa?: string | null
}

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

/** employees.area de cada especialidad (igual que AREAS_TRABAJO en tareas.ts). */
export const AREA_DE_ESPECIALIDAD: Record<string, string> = {
  elec: 'INGENIERIAS ELECTRICAS',
  esp: 'INGENIERIAS ESPECIALES',
  ilum: 'ILUMINACION',
  admin: 'ADMINISTRACION',
}

/** Prioridad numérica por urgencia (igual que URGENCIA_TAREA_CFG en tareas.ts). */
const PRIORIDAD: Record<string, number> = { urgente: 3, alta: 2, normal: 1, baja: 0 }

/** La plantilla de PROYECTO de cada área: se aplica al firmar el contrato. */
export const PLANTILLA_PROYECTO_DE_AREA: Record<string, string> = {
  esp: 'esp_proyecto_2026',
  elec: 'elec_ejecutivo_2026',
  ilum: 'ilum_proyecto_2026',
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
export function fechaDe(a: ActividadCore, inicio: string, objetivo?: string | null): { fecha: string | null; enElPasado: boolean } {
  const hoy = iso(new Date())
  let f: string | null = null
  if (a.dias_antes_entrega != null && objetivo) f = sumar(objetivo, -Math.abs(a.dias_antes_entrega))
  else if (a.dias_desde_inicio != null) f = sumar(inicio, Math.abs(a.dias_desde_inicio))
  return { fecha: f, enElPasado: !!f && f < hoy }
}

export const numEtapa = (e: string): number => {
  const m = String(e || '').match(/^\s*(\d+)/)
  return m ? Number(m[1]) : 999
}

// ── Gente ──────────────────────────────────────────────────────────────────

/**
 * La plantilla de gente con sus roles, con el mismo criterio de "activo" que
 * `cargarPlantilla()` (las DOS columnas). `db` es un cliente de Supabase; va
 * como `any` porque el del navegador y el de Deno son tipos de paquetes
 * distintos y aquí solo se usa `.from().select()`.
 */
export async function empleadosConRol(db: any): Promise<EmpleadoRol[]> {
  const { data, error } = await db.from('employees')
    .select('id,nombre,name,puesto,area,roles_extra,activo,is_active')
  if (error) throw new Error('No se pudo leer la plantilla de gente: ' + error.message)
  return ((data as any[]) || [])
    .filter(r => r.activo !== false && r.is_active !== false)
    .map(r => conRol({
      id: r.id,
      name: String(r.nombre || r.name || '').trim() || 'Sin nombre',
      area: String(r.area || '').trim(),
      puesto: String(r.puesto || '').trim(),
      roles_extra: Array.isArray(r.roles_extra) ? r.roles_extra : [],
    }))
}

// ── Crear actividades ──────────────────────────────────────────────────────

/**
 * Crea las actividades de verdad. Se usa igual para una plantilla guardada y
 * para un plan que acaba de proponer la IA y una persona ya revisó.
 */
export async function crearActividadesCon(
  db: any,
  acts: ActividadCore[],
  ctx: ContextoEncargo,
  empleados: EmpleadoRol[],
  plantillaId?: string,
): Promise<ResultadoAplicar> {
  const inicio = ctx.inicio || iso(new Date())
  const areaDe = (sp?: string | null) => AREA_DE_ESPECIALIDAD[sp || ctx.specialty] || null

  let sinDueno = 0, enElPasado = 0
  // Se crean en orden para poder ligar la dependencia con el id real de la
  // actividad anterior — sin eso, "esto no arranca hasta que aquello esté" es
  // una frase en una junta y no un dato.
  const idsPorOrden = new Map<number, string>()

  // UNA persona por rol en todo el encargo: el proyecto de Iluminación lo lleva
  // una diseñadora, no se alterna tarea por tarea. Si hay varias con el rol,
  // se elige la de menos tareas abiertas al momento de aplicar.
  const elegido = new Map<string, string | null>()
  const responsableDe = async (rol: Rol, area: string | null): Promise<string | null> => {
    const k = `${rol}|${area || ''}`
    if (elegido.has(k)) return elegido.get(k) || null
    const cands = empleados.filter(e => tieneRol(e, rol) && (!area || e.area === area))
    let carga: Map<string, number> | undefined
    if (cands.length > 1 && rol !== 'director') {
      carga = new Map()
      for (const c of cands) {
        const { count } = await db.from('project_tasks')
          .select('id', { count: 'exact', head: true })
          .eq('assignee_id', c.id).in('status', ['pendiente', 'en_progreso'])
        carga.set(c.id, count || 0)
      }
    }
    const r = resolverResponsable(empleados, rol, area, carga)
    elegido.set(k, r)
    return r
  }

  for (const a of acts) {
    const sp = a.specialty || ctx.specialty
    const responsable = await responsableDe(a.rol, areaDe(sp))
    if (!responsable) sinDueno++
    const { fecha, enElPasado: tarde } = fechaDe(a, inicio, ctx.fechaObjetivo)
    if (tarde) enElPasado++

    const urg = a.urgencia || 'normal'
    const nombre = ctx.prefijo ? `${ctx.prefijo} — ${a.nombre}` : a.nombre
    const { data, error } = await db.from('project_tasks').insert({
      name: nombre.slice(0, 200),
      description: a.descripcion || null,
      tipo: 'proyecto',
      specialty: sp,
      rol: a.rol,
      urgencia: urg,
      priority: PRIORIDAD[urg] ?? 1,
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
      etapa: a.etapa || null,
      depende_de_id: a.depende_de != null ? (idsPorOrden.get(a.depende_de) || null) : null,
    }).select('id').single()

    if (error) return { creadas: idsPorOrden.size, sinDueno, enElPasado, error: error.message }
    idsPorOrden.set(a.orden, (data as any).id)
  }

  if (plantillaId) {
    const { data: p } = await db.from('plantillas_encargo').select('veces_usada').eq('id', plantillaId).maybeSingle()
    await db.from('plantillas_encargo')
      .update({ veces_usada: (Number((p as any)?.veces_usada) || 0) + 1 }).eq('id', plantillaId)
  }

  return { creadas: idsPorOrden.size, sinDueno, enElPasado }
}

// ── La plantilla de proyecto de un área ────────────────────────────────────

export interface PlantillaDeArea {
  plantillaId: string
  clave: string
  actividades: ActividadCore[]
  /** Etapas en orden (el número al frente manda). */
  etapas: string[]
}

/** Lee la plantilla de proyecto del área. null si el área no tiene. */
export async function plantillaDeArea(db: any, specialty: string): Promise<PlantillaDeArea | null> {
  const clave = PLANTILLA_PROYECTO_DE_AREA[specialty]
  if (!clave) return null
  const { data: plantilla } = await db.from('plantillas_encargo')
    .select('id').eq('clave', clave).eq('activo', true).maybeSingle()
  if (!plantilla) return null
  const { data: acts } = await db.from('plantilla_actividades').select('*')
    .eq('plantilla_id', (plantilla as any).id).order('orden')
  const actividades = ((acts as any[]) || []) as ActividadCore[]
  if (actividades.length === 0) return null
  const etapas: string[] = []
  for (const a of actividades) { const e = a.etapa || 'Sin etapa'; if (!etapas.includes(e)) etapas.push(e) }
  etapas.sort((x, y) => numEtapa(x) - numEtapa(y))
  return { plantillaId: (plantilla as any).id, clave, actividades, etapas }
}

export interface ResultadoProyecto extends ResultadoAplicar {
  aplicada: boolean
  fases: number
}

/**
 * Le pone a un proyecto ya creado las fases y tareas de la plantilla de su
 * área: cada etapa es una `project_phase` y cada actividad una tarea con
 * responsable por rol y fecha. `aplicada=false` si el área no tiene plantilla
 * o si no se pudieron crear las fases (entonces no se escribió nada).
 */
export async function aplicarPlantillaDeAreaCon(
  db: any,
  projectId: string,
  specialty: string,
  leadId: string | null,
  inicio?: string,
): Promise<ResultadoProyecto> {
  const nada: ResultadoProyecto = { aplicada: false, fases: 0, creadas: 0, sinDueno: 0, enElPasado: 0 }
  const pl = await plantillaDeArea(db, specialty)
  if (!pl) return nada

  const { data: fases, error: eFases } = await db.from('project_phases').insert(
    pl.etapas.map((e, i) => ({
      project_id: projectId, name: e, order_index: i + 1,
      is_post_sale: false, is_unlocked: true, status: 'pendiente',
    })),
  ).select('id,name')
  if (eFases || !fases) return { ...nada, error: eFases?.message || 'No se crearon las fases.' }

  const emps = await empleadosConRol(db)
  const res = await crearActividadesCon(db, pl.actividades,
    { specialty, projectId, leadId, inicio: inicio || iso(new Date()) }, emps, pl.plantillaId)

  // Cada tarea a la fase de su etapa.
  for (const f of fases as { id: string; name: string }[]) {
    const etapa = f.name === 'Sin etapa' ? null : f.name
    let q = db.from('project_tasks').update({ phase_id: f.id }).eq('project_id', projectId)
    q = etapa ? q.eq('etapa', etapa) : q.is('etapa', null)
    const { error } = await q
    if (error && !res.error) res.error = 'Fase ' + f.name + ': ' + error.message
  }
  return { ...res, aplicada: true, fases: (fases as any[]).length }
}
