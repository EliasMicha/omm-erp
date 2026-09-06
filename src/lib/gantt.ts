// El Gantt de obra, en dos versiones.
//
// INTERNO: todo — responsable, avance, holgura, lo que va tarde.
// CLIENTE: sin nombres internos, y con la lista de CONDICIONES DEL SITIO que
// deben cumplirse para que cada fecha sea real. Esa lista es el punto: sin ella
// el cliente lee "11 de septiembre" como una promesa incondicional, y ese es
// justo el pleito que hay que evitar.
import { Prerequisito, EstadoDeSitio, estadoDeSitio } from './prerequisitos'

/**
 * Lo que el Gantt necesita de una actividad. Se llena desde obra_actividades
 * (que ya trae fecha_inicio y fecha_fin_plan) o desde project_tasks; por eso
 * los nombres son propios y no los de ninguna tabla.
 */
export interface TareaGantt {
  id: string
  name: string
  area: string | null
  system: string | null
  status: string
  progress: number
  fecha_inicio: string | null
  due_date: string | null
  duracion_dias?: number | null
  responsable?: string | null
  titulo_cliente?: string | null
  specialty?: string | null
  description?: string | null
}

/** Traduce una actividad de obra a lo que entiende el Gantt. */
export const deObraActividad = (a: any): TareaGantt => ({
  id: a.id,
  name: a.descripcion || 'Actividad',
  area: a.area || null,
  system: a.sistema || null,
  status: a.status || 'pendiente',
  progress: Number(a.porcentaje) || 0,
  fecha_inicio: a.fecha_inicio || null,
  due_date: a.fecha_fin_plan || null,
  duracion_dias: null,
  responsable: a.instalador_id || null,
  description: a.notas || null,
})

export interface BarraGantt {
  tarea: TareaGantt
  inicio: Date
  fin: Date
  dias: number
  /** Días desde el arranque del proyecto, para posicionar la barra. */
  offset: number
  sitio: EstadoDeSitio
  vencida: boolean
  /** Sin fechas no hay barra: se listan aparte para que no se escondan. */
  sinFecha: boolean
  /** La actividad solo tiene fecha compromiso, no arranque. No inventamos
   *  una duracion: se dibuja como marca de fecha y se etiqueta con un solo dia. */
  soloFin: boolean
}

export interface Escala {
  inicio: Date
  fin: Date
  dias: number
  /** Marcas de mes para el encabezado. */
  meses: Array<{ label: string; offset: number; dias: number }>
}

const D = 86400000
export const aFecha = (s?: string | null): Date | null => {
  if (!s) return null
  const d = new Date(String(s).slice(0, 10) + 'T12:00:00')
  return isNaN(d.getTime()) ? null : d
}
export const diasEntre = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / D)
export const masDias = (d: Date, n: number) => new Date(d.getTime() + n * D)

export const fechaCorta = (d: Date) =>
  d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
export const fechaLarga = (d: Date) =>
  d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })

/**
 * Arma las barras. Si una tarea no trae inicio, se deduce restando la duración
 * al vencimiento (y si tampoco hay duración, se asume 1 día). Deducir es mejor
 * que esconder: una tarea sin barra desaparece del plan y nadie la reclama.
 */
export function construirBarras(
  tareas: TareaGantt[],
  prereqs: Record<string, Prerequisito[]>,
  hoy = new Date(),
): { barras: BarraGantt[]; sinFecha: TareaGantt[] } {
  const barras: BarraGantt[] = []
  const sinFecha: TareaGantt[] = []

  for (const t of tareas) {
    const fin = aFecha(t.due_date)
    const ini = aFecha(t.fecha_inicio)
    if (!fin && !ini) { sinFecha.push(t); continue }
    const dur = Math.max(1, Number(t.duracion_dias) || 1)
    const inicio = ini || masDias(fin as Date, -(dur - 1))
    const final = fin || masDias(inicio, dur - 1)
    const sitio = estadoDeSitio(prereqs[t.id] || [])
    barras.push({
      tarea: t, inicio, fin: final,
      dias: Math.max(1, diasEntre(inicio, final) + 1),
      offset: 0,
      sitio,
      vencida: t.status !== 'completada' && final.getTime() < hoy.getTime(),
      sinFecha: false,
      soloFin: !ini && !!fin && !Number(t.duracion_dias),
    })
  }

  if (barras.length) {
    const arranque = new Date(Math.min(...barras.map(b => b.inicio.getTime())))
    for (const b of barras) b.offset = diasEntre(arranque, b.inicio)
  }
  barras.sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || a.tarea.name.localeCompare(b.tarea.name))
  return { barras, sinFecha }
}

/** El rango del plan y sus marcas de mes. */
export function escalaDe(barras: BarraGantt[]): Escala | null {
  if (!barras.length) return null
  const inicio = new Date(Math.min(...barras.map(b => b.inicio.getTime())))
  const fin = new Date(Math.max(...barras.map(b => b.fin.getTime())))
  const dias = Math.max(1, diasEntre(inicio, fin) + 1)

  const meses: Escala['meses'] = []
  let cur = new Date(inicio.getFullYear(), inicio.getMonth(), 1)
  while (cur.getTime() <= fin.getTime()) {
    const sig = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    const desde = Math.max(0, diasEntre(inicio, cur))
    const hasta = Math.min(dias, diasEntre(inicio, sig))
    if (hasta > desde) {
      meses.push({
        label: cur.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
        offset: desde, dias: hasta - desde,
      })
    }
    cur = sig
  }
  return { inicio, fin, dias, meses }
}

/** Agrupa por sistema o por área, como ya se ve la pantalla de actividades. */
export function agrupar(barras: BarraGantt[], por: 'sistema' | 'area'): Array<{ titulo: string; barras: BarraGantt[] }> {
  const m = new Map<string, BarraGantt[]>()
  for (const b of barras) {
    const k = (por === 'area' ? b.tarea.area : b.tarea.system) || 'Sin clasificar'
    ;(m.get(k) || m.set(k, []).get(k)!).push(b)
  }
  return Array.from(m.entries())
    .map(([titulo, bs]) => ({ titulo, barras: bs }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo))
}

/**
 * Todas las condiciones del proyecto, juntas y sin repetir, agrupadas por quién
 * las tiene que destrabar. Es la hoja que se le entrega al cliente.
 */
export function condicionesDelProyecto(
  barras: BarraGantt[],
  prereqs: Record<string, Prerequisito[]>,
): Array<{ aCargo: string; items: Array<{ descripcion: string; tareas: string[]; pendiente: boolean }> }> {
  const porCargo = new Map<string, Map<string, { tareas: string[]; pendiente: boolean }>>()
  for (const b of barras) {
    for (const p of (prereqs[b.tarea.id] || [])) {
      if (p.estado === 'no_aplica') continue
      const m = porCargo.get(p.a_cargo_de) || porCargo.set(p.a_cargo_de, new Map()).get(p.a_cargo_de)!
      const e = m.get(p.descripcion) || { tareas: [], pendiente: false }
      const nombre = b.tarea.titulo_cliente || b.tarea.name
      if (!e.tareas.includes(nombre)) e.tareas.push(nombre)
      if (p.estado === 'pendiente') e.pendiente = true
      m.set(p.descripcion, e)
    }
  }
  return Array.from(porCargo.entries()).map(([aCargo, m]) => ({
    aCargo,
    items: Array.from(m.entries())
      .map(([descripcion, v]) => ({ descripcion, ...v }))
      .sort((a, b) => Number(b.pendiente) - Number(a.pendiente) || a.descripcion.localeCompare(b.descripcion)),
  }))
}
