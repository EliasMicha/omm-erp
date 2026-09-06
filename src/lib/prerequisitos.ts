// Prerequisitos de obra: lo que el SITIO debe cumplir antes de que podamos entrar.
//
// El problema que resuelve, en palabras de Elias: "que no venga el típico, tú
// dijiste este día, y ese día tiene que quedar, aunque no sea posible todavía".
//
// Nuestro tiempo de tarea corre SOLO cuando el espacio está en condiciones. Las
// bocinas de plafón van después de las luminarias porque se alinean contra
// ellas; los módulos Lutron necesitan los circuitos probados por los
// eléctricos; los pernos necesitan el marco de la puerta terminado. Escribirlo
// y enseñárselo al cliente ANTES es lo que convierte un reclamo en una
// coordinación.
import { supabase } from './supabase'

export type EstadoPrereq = 'pendiente' | 'cumplido' | 'no_aplica'
export type ACargoDe = 'cliente' | 'arquitecto' | 'electrico' | 'carpinteria' | 'pintura' | 'otro' | 'omm'

/**
 * De obra o de actividad.
 *
 * Sobre 176 actividades reales el catálogo proponía 598 prerequisitos. El
 * problema no era que sobraran: los generales ("acceso al inmueble", "equipo
 * entregado") aplican a todo, y repetirlos 176 veces entierra los que de verdad
 * destraban algo — que son justo los que hay que enseñarle al cliente. Los de
 * obra van UNA vez al inicio del documento.
 */
export type AlcancePrereq = 'obra' | 'actividad'

export interface Prerequisito {
  id: string
  tarea_id: string
  descripcion: string
  a_cargo_de: ACargoDe
  estado: EstadoPrereq
  critico: boolean
  cumplido_at: string | null
  verificado_por: string | null
  notas: string | null
  order_index: number
  alcance: AlcancePrereq
}

export interface PrereqCatalogo {
  id: string
  descripcion: string
  a_cargo_de: ACargoDe
  critico: boolean
  palabras_clave: string[]
  specialty: string | null
  alcance: AlcancePrereq
}

export const A_CARGO_CFG: Record<ACargoDe, { label: string; color: string }> = {
  cliente:     { label: 'Cliente',            color: '#2563EB' },
  arquitecto:  { label: 'Arquitecto',         color: '#A78BFA' },
  electrico:   { label: 'Contratista eléctrico', color: '#D97706' },
  carpinteria: { label: 'Carpintería',        color: '#B45309' },
  pintura:     { label: 'Pintura / acabados', color: '#0891B2' },
  otro:        { label: 'Otro contratista',   color: '#6B7280' },
  omm:         { label: 'OMM',                color: '#10B981' },
}

export const ESTADO_PREREQ_CFG: Record<EstadoPrereq, { label: string; color: string }> = {
  pendiente:  { label: 'Pendiente',  color: '#D9A441' },
  cumplido:   { label: 'Cumplido',   color: '#10B981' },
  no_aplica:  { label: 'No aplica',  color: '#555555' },
}

// ── Carga y edición ─────────────────────────────────────────────────────────

export async function cargarPrerequisitos(tareaIds: string[]): Promise<Record<string, Prerequisito[]>> {
  if (!tareaIds.length) return {}
  const out: Record<string, Prerequisito[]> = {}
  // De 200 en 200: una obra grande trae cientos de tareas y el `in` tiene tope.
  for (let i = 0; i < tareaIds.length; i += 200) {
    const { data } = await supabase.from('tarea_prerequisitos').select('*')
      .in('tarea_id', tareaIds.slice(i, i + 200)).order('order_index')
    for (const p of ((data as any[]) || [])) (out[p.tarea_id] ||= []).push(p as Prerequisito)
  }
  return out
}

export const cargarCatalogo = async (): Promise<PrereqCatalogo[]> => {
  const { data } = await supabase.from('prerequisitos_catalogo').select('*').eq('activo', true).order('descripcion')
  return ((data as any[]) || []) as PrereqCatalogo[]
}

export async function agregarPrerequisito(tareaId: string, p: Partial<Prerequisito>): Promise<Prerequisito> {
  const { data, error } = await supabase.from('tarea_prerequisitos').insert({
    tarea_id: tareaId,
    descripcion: (p.descripcion || '').trim(),
    a_cargo_de: p.a_cargo_de || 'otro',
    critico: p.critico !== false,
    order_index: p.order_index ?? 0,
    notas: p.notas || null,
  }).select().single()
  if (error) throw new Error(error.message)
  return data as any
}

export async function actualizarPrerequisito(id: string, campos: Partial<Prerequisito>, quien?: string) {
  const patch: any = { ...campos, updated_at: new Date().toISOString() }
  if (campos.estado === 'cumplido') { patch.cumplido_at = new Date().toISOString(); patch.verificado_por = quien || null }
  if (campos.estado === 'pendiente') { patch.cumplido_at = null; patch.verificado_por = null }
  await supabase.from('tarea_prerequisitos').update(patch).eq('id', id)
}

export const borrarPrerequisito = (id: string) =>
  supabase.from('tarea_prerequisitos').delete().eq('id', id)

// ── Sugerencia automática ───────────────────────────────────────────────────

const sinAcentos = (s: string) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/**
 * Qué prerequisitos del catálogo aplican a esta tarea, por palabras clave del
 * nombre. No los guarda: los propone para que alguien los apruebe. Proponer de
 * más es barato; guardar de más ensucia el documento que ve el cliente.
 */
export function sugerirDelCatalogo(
  tarea: { name: string; description?: string | null; specialty?: string | null },
  catalogo: PrereqCatalogo[],
): PrereqCatalogo[] {
  const texto = sinAcentos(`${tarea.name} ${tarea.description || ''}`)
  return catalogo.filter(c => {
    // Los de obra NO se pegan a cada tarea: van una sola vez en el documento.
    if (c.alcance === 'obra') return false
    if (c.specialty && tarea.specialty && c.specialty !== tarea.specialty) return false
    return (c.palabras_clave || []).some(k => texto.includes(sinAcentos(k)))
  })
}

/** Los generales de la obra: se listan una vez, no por tarea. */
export const condicionesGenerales = (catalogo: PrereqCatalogo[]) =>
  catalogo.filter(c => c.alcance === 'obra')

/** Aplica en bloque lo sugerido, sin repetir lo que ya tiene la tarea. */
export async function sembrarSugeridos(
  tareas: Array<{ id: string; name: string; description?: string | null; specialty?: string | null }>,
  catalogo: PrereqCatalogo[],
  yaTiene: Record<string, Prerequisito[]>,
): Promise<number> {
  const filas: any[] = []
  for (const t of tareas) {
    const actuales = new Set((yaTiene[t.id] || []).map(p => sinAcentos(p.descripcion)))
    sugerirDelCatalogo(t, catalogo).forEach((c, i) => {
      if (actuales.has(sinAcentos(c.descripcion))) return
      filas.push({
        tarea_id: t.id, descripcion: c.descripcion, a_cargo_de: c.a_cargo_de,
        critico: c.critico, order_index: i, alcance: 'actividad',
      })
    })
  }
  if (!filas.length) return 0
  for (let i = 0; i < filas.length; i += 200) {
    const { error } = await supabase.from('tarea_prerequisitos').insert(filas.slice(i, i + 200))
    if (error) throw new Error(error.message)
  }
  return filas.length
}

// ── Lectura para el Gantt ───────────────────────────────────────────────────

export interface EstadoDeSitio {
  total: number
  pendientes: number
  criticosPendientes: number
  /** true = no podemos entrar todavía; la fecha no depende de nosotros. */
  bloqueada: boolean
  /** Quiénes tienen la pelota. */
  aCargo: ACargoDe[]
}

export function estadoDeSitio(prereqs: Prerequisito[] = []): EstadoDeSitio {
  const vivos = prereqs.filter(p => p.estado !== 'no_aplica')
  const pend = vivos.filter(p => p.estado === 'pendiente')
  const crit = pend.filter(p => p.critico)
  return {
    total: vivos.length,
    pendientes: pend.length,
    criticosPendientes: crit.length,
    bloqueada: crit.length > 0,
    aCargo: Array.from(new Set(pend.map(p => p.a_cargo_de))),
  }
}
