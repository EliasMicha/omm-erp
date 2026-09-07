// Las 4 fases de una obra, en el orden en que ocurren.
//
// Elias: "existen 4 fases a un proyecto. Cableado, instalacion, programacion y
// detallado. Entonces los pendientes que tienen que ver con cableado son el
// inicio y podriamos categorizar tambien por fases para que podamos poner
// fechas por fase."
//
// El modelo es GLOBAL CON EXCEPCIONES POR AREA: la fase corre parejo en toda
// la obra, pero una area concreta puede llevar su propio rango encima (la
// recamara se instala cuando su plafon quedo, no cuando quedo el de la cocina).
import { supabase } from './supabase'

export type FaseKey = 'cableado' | 'instalacion' | 'programacion' | 'detallado'

export const FASES: Array<{ key: FaseKey; label: string; color: string; ayuda: string }> = [
  { key: 'cableado', label: 'Cableado', color: '#3B82F6',
    ayuda: 'Tendido, canalizacion, ponchado. Corre con la obra gris, antes de plafones y pintura.' },
  { key: 'instalacion', label: 'Instalacion', color: '#10B981',
    ayuda: 'Montaje y colocacion de equipo. Depende de que el area este terminada.' },
  { key: 'programacion', label: 'Programacion', color: '#A78BFA',
    ayuda: 'Configuracion, pruebas y puesta en marcha. Requiere el equipo ya montado.' },
  { key: 'detallado', label: 'Detallado', color: '#D9A441',
    ayuda: 'Ajuste fino, limpieza, capacitacion y entrega. Lo ultimo.' },
]

export const FASE_CFG: Record<FaseKey, { label: string; color: string }> =
  FASES.reduce((acc, f) => { acc[f.key] = { label: f.label, color: f.color }; return acc },
    {} as Record<FaseKey, { label: string; color: string }>)

export const esFase = (v: any): v is FaseKey =>
  v === 'cableado' || v === 'instalacion' || v === 'programacion' || v === 'detallado'

const sinAcentos = (s: string) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// El verbo con el que ARRANCA la descripcion manda. "Tendido de cable Cat6 y
// pruebas" es cableado aunque diga pruebas: lo que describe el trabajo es el
// primer verbo, no todo lo que se menciona de pasada.
const VERBO_INICIAL: Array<[FaseKey, string[]]> = [
  ['cableado', ['tendido', 'ponchado', 'ponchar', 'canalizacion', 'cableado', 'patcheo', 'parcheo']],
  ['programacion', ['programacion', 'configuracion', 'config', 'pruebas', 'prueba', 'certificacion',
    'direccionamiento', 'reseteo', 'puesta']],
  ['detallado', ['limpieza', 'detallado', 'retoque', 'afinacion']],
  ['instalacion', ['instalacion', 'instalar', 'colocacion', 'colocar', 'montaje', 'montar', 'armado',
    'armar', 'fijacion', 'suministro', 'reubicacion', 'conexion', 'terminacion']],
]

// Piezas de rack que traen la palabra "cable" pero se montan: un organizador
// de cable es instalacion, no cableado. Sin esta lista caian en cableado.
const NO_ES_CABLEADO = ['organizador de cable', 'organizadores de cable', 'charola', 'pasacable',
  'canaleta de rack', 'peine', 'gabinete', 'patch panel', 'patch-panel']

const REGLAS: Array<[FaseKey, string[]]> = [
  ['detallado', ['ajuste fino', 'retoque', 'limpieza', 'entrega de obra', 'entrega final',
    'walkthrough', 'walk through', 'capacitacion al cliente', 'manuales', 'memoria tecnica',
    'as built', 'asbuilt', 'punch list', 'pendientes finales', 'material sobrante']],
  ['programacion', ['programacion', 'configuracion', 'config ', 'config y', 'parametrizacion',
    'puesta en marcha', 'pruebas', 'prueba ', 'certificacion', 'direccionamiento', 'reseteo',
    'alta de usuarios', 'integracion', 'calibracion', 'enrolamiento', 'licencia', 'firmware']],
  ['cableado', ['tendido', 'canalizacion', 'cableado', 'cable ', 'cables', 'ponchado', 'ponchar',
    'patcheo', 'parcheo', 'tuberia', 'manguera', 'ranurado', 'rough', 'primera fijacion',
    'bobina', 'carrete', 'conduit', 'corridas']],
  ['instalacion', ['instalacion', 'instalar', 'colocacion', 'colocar', 'montaje', 'montar',
    'armado', 'armar', 'fijacion', 'reubicacion', 'soporte', 'anclaje', 'empotrado',
    'conexion', 'terminacion']],
]

/** Deduce la fase a partir de la descripcion. null = no se pudo. */
export function clasificarFase(descripcion: string): FaseKey | null {
  const t = sinAcentos(descripcion)
  if (!t.trim()) return null
  const bloqueaCableado = NO_ES_CABLEADO.some(x => t.includes(x))
  const primera = t.split(/\s+/)[0].replace(/[.,;:]/g, '')
  for (const [fase, verbos] of VERBO_INICIAL) {
    if (verbos.includes(primera)) {
      return fase === 'cableado' && bloqueaCableado ? 'instalacion' : fase
    }
  }
  for (const [fase, claves] of REGLAS) {
    if (fase === 'cableado' && bloqueaCableado) continue
    if (claves.some(k => t.includes(k))) return fase
  }
  return null
}

// ── Rangos por fase ────────────────────────────────────────────────────────

export interface RangoFase {
  id?: string
  fase: FaseKey
  /** null = rango global de la obra. Con valor = excepcion para esa area. */
  area: string | null
  fecha_inicio: string | null
  fecha_fin: string | null
}

export const claveRango = (fase: FaseKey, area: string | null) => `${fase}|${area || ''}`

export async function cargarRangos(obraId: string): Promise<RangoFase[]> {
  const { data, error } = await supabase.from('obra_fases')
    .select('id, fase, area, fecha_inicio, fecha_fin').eq('obra_id', obraId)
  if (error) throw error
  return (data || [])
    .filter(r => esFase(r.fase))
    .map(r => ({ ...r, area: r.area || null })) as RangoFase[]
}

export async function guardarRango(obraId: string, r: RangoFase): Promise<void> {
  const area = r.area || ''
  if (!r.fecha_inicio && !r.fecha_fin) {
    await supabase.from('obra_fases').delete()
      .eq('obra_id', obraId).eq('fase', r.fase).eq('area', area)
    return
  }
  const { error } = await supabase.from('obra_fases')
    .upsert({
      obra_id: obraId, fase: r.fase, area,
      fecha_inicio: r.fecha_inicio || null, fecha_fin: r.fecha_fin || null,
    }, { onConflict: 'obra_id,fase,area' })
  if (error) throw error
}

/** El rango que le toca a una tarea: primero su area, si no el global. */
export function rangoAplicable(
  rangos: RangoFase[], fase: FaseKey, area: string | null,
): RangoFase | null {
  if (area) {
    const porArea = rangos.find(r => r.fase === fase && r.area === area)
    if (porArea) return porArea
  }
  return rangos.find(r => r.fase === fase && !r.area) || null
}

export interface TareaFechable {
  id: string
  fase?: FaseKey | null
  area?: string | null
  fecha_inicio?: string | null
  fecha_fin_plan?: string | null
}

export interface CambioFecha {
  id: string
  fecha_inicio: string | null
  fecha_fin_plan: string | null
}

/**
 * Calcula que tareas cambiarian de fecha al aplicar los rangos. No escribe:
 * devuelve la lista para poder enseniarla antes de tocar 176 renglones.
 */
export function calcularFechas(
  tareas: TareaFechable[], rangos: RangoFase[], soloVacias: boolean,
): CambioFecha[] {
  const out: CambioFecha[] = []
  for (const t of tareas) {
    if (!t.fase || !esFase(t.fase)) continue
    const r = rangoAplicable(rangos, t.fase, t.area || null)
    if (!r) continue
    const ini = r.fecha_inicio || null
    const fin = r.fecha_fin || null
    if (!ini && !fin) continue
    // "Solo las que no tienen fecha" respeta lo que ya capturaste a mano.
    if (soloVacias && (t.fecha_inicio || t.fecha_fin_plan)) continue
    const nuevoIni = ini ?? t.fecha_inicio ?? null
    const nuevoFin = fin ?? t.fecha_fin_plan ?? null
    if (nuevoIni === (t.fecha_inicio || null) && nuevoFin === (t.fecha_fin_plan || null)) continue
    out.push({ id: t.id, fecha_inicio: nuevoIni, fecha_fin_plan: nuevoFin })
  }
  return out
}

/** Escribe los cambios en bloque, de 200 en 200 para no reventar la peticion. */
export async function aplicarFechas(cambios: CambioFecha[]): Promise<number> {
  let n = 0
  // Las tareas que comparten fechas se actualizan juntas: 176 renglones se
  // vuelven 4 peticiones en vez de 176.
  const grupos = new Map<string, string[]>()
  for (const c of cambios) {
    const k = `${c.fecha_inicio || ''}|${c.fecha_fin_plan || ''}`
    const arr = grupos.get(k) || []
    arr.push(c.id)
    grupos.set(k, arr)
  }
  for (const [k, ids] of grupos) {
    const [ini, fin] = k.split('|')
    for (let i = 0; i < ids.length; i += 200) {
      const lote = ids.slice(i, i + 200)
      const { error } = await supabase.from('obra_actividades')
        .update({ fecha_inicio: ini || null, fecha_fin_plan: fin || null })
        .in('id', lote)
      if (error) throw error
      n += lote.length
    }
  }
  return n
}

/** Clasifica en bloque las tareas que aun no tienen fase. */
export async function clasificarPendientes(
  tareas: Array<{ id: string; descripcion: string; fase?: FaseKey | null }>,
): Promise<Record<string, FaseKey>> {
  const asignadas: Record<string, FaseKey> = {}
  const porFase = new Map<FaseKey, string[]>()
  for (const t of tareas) {
    if (t.fase && esFase(t.fase)) continue
    const f = clasificarFase(t.descripcion)
    if (!f) continue
    asignadas[t.id] = f
    const arr = porFase.get(f) || []
    arr.push(t.id)
    porFase.set(f, arr)
  }
  for (const [fase, ids] of porFase) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('obra_actividades')
        .update({ fase }).in('id', ids.slice(i, i + 200))
      if (error) throw error
    }
  }
  return asignadas
}
