// ═══════════════════════════════════════════════════════════════════════════
// kpis — medir cumplimiento sin construir una máquina de mentir.
//
// El riesgo de medir "% entregado a tiempo" es conocido y llega solo: en
// cuanto se califica, la gente pone fechas holgadas. No por deshonestidad —
// por supervivencia. A los dos meses tienes 95% de cumplimiento y proyectos
// igual de lentos, con datos verdaderos.
//
// Por eso aquí NADA se reporta solo. Tres pares, y cada uno delata al otro:
//
//   CUMPLIMIENTO contra la fecha ORIGINAL, no contra la última.
//     Si se juzgara contra la última, recorrer la fecha borraría el
//     incumplimiento. La diferencia entre ambos números ES la trampa, medida.
//
//   TIEMPO DE CICLO junto al cumplimiento.
//     Si alguien infla fechas, el cumplimiento sube pero el ciclo también.
//     No hay forma de mejorar los dos haciendo trampa; solo trabajando.
//
//   ESTABILIDAD junto a la higiene.
//     Poner una fecha cualquiera para no aparecer "sin fecha" y recorrerla
//     cuatro veces se ve como 4 cambios.
//
// El reloj de cada quien corre desde que la tarea TIENE DUEÑO, no desde que
// se creó: las semanas que pasó huérfana son culpa de quien no la repartió.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'

export interface TareaKPI {
  id: string
  name: string
  assignee_id?: string | null
  specialty?: string | null
  tipo?: string | null
  status: string
  due_date?: string | null
  due_date_original?: string | null
  due_date_cambios?: number | null
  asignada_at?: string | null
  fechada_at?: string | null
  completed_at?: string | null
  created_at?: string | null
  solicitada_por_id?: string | null
  urgencia?: string | null
}

const dias = (a?: string | null, b?: string | null): number | null => {
  if (!a || !b) return null
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 86400000
  return isFinite(d) ? d : null
}

const mediana = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface Desempeno {
  /** Entregadas en el periodo. Es la base de todo lo demás. */
  entregadas: number
  /** % que llegó en o antes de la PRIMERA fecha comprometida. */
  cumplimiento: number | null
  /** % contra la ÚLTIMA fecha. Si es mucho mayor, las fechas se movieron. */
  cumplimientoUltima: number | null
  /** Días de mediana desde que tuvo dueño hasta que se entregó. */
  ciclo: number | null
  /** Días de retraso promedio de las que llegaron tarde. */
  retrasoProm: number | null
  /** Veces que se movió la fecha, en promedio. */
  cambiosProm: number | null
  /** % de tareas a las que se les movió la fecha al menos una vez. */
  pctMovidas: number | null
  // ── Higiene: foto de hoy, no promedio del mes ──
  abiertas: number
  sinDueno: number
  sinFecha: number
  vencidas: number
}

export function calcular(tareas: TareaKPI[], hoy = new Date().toISOString().slice(0, 10)): Desempeno {
  const entregadas = tareas.filter(t => t.status === 'completada' && t.completed_at)
  const conMeta = entregadas.filter(t => t.due_date_original || t.due_date)

  const aTiempo = conMeta.filter(t => {
    const meta = t.due_date_original || t.due_date!
    return String(t.completed_at).slice(0, 10) <= meta
  }).length
  const aTiempoUltima = conMeta.filter(t => {
    const meta = t.due_date || t.due_date_original!
    return String(t.completed_at).slice(0, 10) <= meta
  }).length

  const ciclos = entregadas
    .map(t => dias(t.asignada_at || t.created_at, t.completed_at))
    .filter((x): x is number => x != null && x >= 0)

  const retrasos = conMeta
    .map(t => {
      const meta = t.due_date_original || t.due_date!
      const d = dias(meta + 'T12:00:00', t.completed_at)
      return d != null && d > 0 ? d : null
    })
    .filter((x): x is number => x != null)

  const cambios = tareas.map(t => Number(t.due_date_cambios) || 0)
  const abiertas = tareas.filter(t => t.status !== 'completada' && t.status !== 'cancelada')

  return {
    entregadas: entregadas.length,
    cumplimiento: conMeta.length ? aTiempo / conMeta.length : null,
    cumplimientoUltima: conMeta.length ? aTiempoUltima / conMeta.length : null,
    ciclo: mediana(ciclos),
    retrasoProm: retrasos.length ? retrasos.reduce((a, b) => a + b, 0) / retrasos.length : null,
    cambiosProm: cambios.length ? cambios.reduce((a, b) => a + b, 0) / cambios.length : null,
    pctMovidas: tareas.length ? cambios.filter(c => c > 0).length / tareas.length : null,
    abiertas: abiertas.length,
    sinDueno: abiertas.filter(t => !t.assignee_id).length,
    sinFecha: abiertas.filter(t => !t.due_date).length,
    vencidas: abiertas.filter(t => t.due_date && t.due_date < hoy).length,
  }
}

/**
 * La brecha entre juzgar contra la primera fecha y contra la última. Es el
 * número que dice cuánto se movieron los compromisos — y no acusa a nadie:
 * mover una fecha con motivo es legítimo, moverlas todas no.
 */
export function brechaDeFechas(d: Desempeno): number | null {
  if (d.cumplimiento == null || d.cumplimientoUltima == null) return null
  return d.cumplimientoUltima - d.cumplimiento
}

export async function cargarTareasKPI(desde?: string): Promise<TareaKPI[]> {
  const cols = 'id,name,assignee_id,specialty,tipo,urgencia,status,due_date,due_date_original,due_date_cambios,' +
    'asignada_at,fechada_at,completed_at,created_at,solicitada_por_id,project_id'
  const todas: TareaKPI[] = []
  for (let off = 0; off < 20000; off += 1000) {
    let q = supabase.from('project_tasks').select(cols).order('id').range(off, off + 999)
    const { data } = await q
    if (!data || data.length === 0) break
    todas.push(...(data as any[]))
    if (data.length < 1000) break
  }
  if (!desde) return todas
  // El corte solo aplica a lo ENTREGADO: la higiene siempre es de hoy.
  return todas.filter(t => t.status !== 'completada' || (t.completed_at || '') >= desde)
}

export const PERIODOS = [
  { key: '30', label: 'Últimos 30 días', dias: 30 },
  { key: '90', label: 'Últimos 90 días', dias: 90 },
  { key: '365', label: 'Este año', dias: 365 },
  { key: 'todo', label: 'Todo', dias: 0 },
] as const

export function desdeDe(periodo: string): string | undefined {
  const p = PERIODOS.find(x => x.key === periodo)
  if (!p || p.dias === 0) return undefined
  const d = new Date()
  d.setDate(d.getDate() - p.dias)
  return d.toISOString()
}

/** Semáforo honesto: sin datos NO es verde, es "sin datos". */
export function colorCumplimiento(v: number | null): string {
  if (v == null) return '#555'
  if (v >= 0.85) return '#10B981'
  if (v >= 0.6) return '#D9A441'
  return '#DC2626'
}


// ═══════════════════════════════════════════════════════════════════════════
// CLARIDAD AL ORIGEN — el indicador de quien reparte el trabajo.
//
// Las tres preguntas que arrancan la cadena de responsabilidad son: qué,
// cuándo y quién. Las tres las contesta quien encarga, no quien ejecuta. Si
// el encargo nace sin fecha y sin dueño, no hay nada que medir después: no se
// puede reprochar un incumplimiento contra una fecha que nunca existió.
//
// Por eso este indicador va PRIMERO y aplica a quien manda — empezando por la
// dirección general. Es el único que, si está mal, invalida a los demás.
// ═══════════════════════════════════════════════════════════════════════════

/** Un encargo "nace claro" si el mismo día ya traía dueño y fecha. */
const VENTANA_ORIGEN_MS = 24 * 3600 * 1000

const dentroDeVentana = (creada?: string | null, sello?: string | null): boolean => {
  if (!creada || !sello) return false
  const d = new Date(sello).getTime() - new Date(creada).getTime()
  return d >= -60000 && d <= VENTANA_ORIGEN_MS
}

export interface Claridad {
  /** Encargos que esta persona repartió en el periodo. */
  encargos: number
  /** Nacieron con dueño el mismo día. */
  conDueno: number
  /** Nacieron con fecha el mismo día. */
  conFecha: number
  /** Con las tres respuestas: qué, cuándo y quién. */
  completos: number
  pctCompletos: number | null
  /** Mediana de días que tardó en tener dueño. 0 = nació con dueño. */
  diasHastaDueno: number | null
  /** Mediana de días que tardó en tener fecha. */
  diasHastaFecha: number | null
  /** Foto de hoy: encargos suyos todavía abiertos y sin repartir o sin fecha. */
  huerfanas: number
  sinFechaHoy: number
}

export function claridad(tareas: TareaKPI[]): Claridad {
  const conDueno = tareas.filter(t => dentroDeVentana(t.created_at, t.asignada_at))
  const conFecha = tareas.filter(t => dentroDeVentana(t.created_at, t.fechada_at))
  const completos = tareas.filter(t =>
    dentroDeVentana(t.created_at, t.asignada_at) && dentroDeVentana(t.created_at, t.fechada_at))

  const hastaDueno = tareas.map(t => dias(t.created_at, t.asignada_at)).filter((x): x is number => x != null && x >= 0)
  const hastaFecha = tareas.map(t => dias(t.created_at, t.fechada_at)).filter((x): x is number => x != null && x >= 0)

  const abiertas = tareas.filter(t => t.status !== 'completada' && t.status !== 'cancelada')

  return {
    encargos: tareas.length,
    conDueno: conDueno.length,
    conFecha: conFecha.length,
    completos: completos.length,
    pctCompletos: tareas.length ? completos.length / tareas.length : null,
    diasHastaDueno: mediana(hastaDueno),
    diasHastaFecha: mediana(hastaFecha),
    huerfanas: abiertas.filter(t => !t.assignee_id).length,
    sinFechaHoy: abiertas.filter(t => !t.due_date).length,
  }
}

/**
 * Quién repartió cada encargo. `solicitada_por_id` es el campo explícito; si
 * no está, se atribuye a quien delegó. Lo que no tiene ninguno de los dos se
 * agrupa aparte: encargos sin remitente, que también son un hallazgo.
 */
export function agrupar<T>(items: T[], clave: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const k = clave(it)
    const arr = m.get(k)
    if (arr) arr.push(it); else m.set(k, [it])
  }
  return m
}

/** Solo lo creado dentro del periodo — la claridad se juzga al momento de encargar. */
export function creadasDesde(tareas: TareaKPI[], desde?: string): TareaKPI[] {
  if (!desde) return tareas
  return tareas.filter(t => (t.created_at || '') >= desde)
}

/** Semáforo del ciclo: sin referencia previa, no hay verde ni rojo — hay dato. */
export function colorCiclo(dias: number | null): string {
  if (dias == null) return '#555'
  if (dias <= 7) return '#10B981'
  if (dias <= 21) return '#D9A441'
  return '#DC2626'
}

export const fmtPct = (v: number | null): string => v == null ? '—' : `${Math.round(v * 100)}%`
export const fmtDias = (v: number | null): string => v == null ? '—' : `${v.toFixed(v < 10 ? 1 : 0)} d`
