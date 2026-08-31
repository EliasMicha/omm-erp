/**
 * CAPACITACIONES — estandarizar el conocimiento por área y por puesto
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Cada director arma las capacitaciones de su área y decide a qué PUESTOS les
 * tocan. La idea es que el skillset deje de vivir en la cabeza de quien lleva
 * más tiempo: un dibujante necesita saber ciertas cosas y un ingeniero otras,
 * y eso tiene que estar escrito.
 *
 * ── De lo general a lo particular ───────────────────────────────────────────
 *   general  → toda la empresa (seguridad, cómo se usa el ERP, la forma OMM)
 *   area     → todos los de un área, sin importar su puesto
 *   puesto   → sólo los puestos que se listen
 *
 * A una persona le toca una capacitación si aplica cualquiera de los tres
 * niveles. Se acumulan: lo general no exenta de lo particular.
 *
 * ── El mismo examen sirve para contratar ────────────────────────────────────
 * Un intento puede ser de un EMPLEADO (motivo 'capacitacion') o de un
 * CANDIDATO que todavía no existe en la nómina (motivo 'contratacion'). Por
 * eso el intento admite un nombre libre en vez de employee_id: sirve para
 * medir a quien se está entrevistando con la misma vara con la que se mide a
 * quien ya está adentro.
 */

import { supabase } from './supabase'
import { rolDe, type Rol } from './roles'

export const BUCKET_CAPACITACIONES = 'capacitaciones'
/** Tope de subida. Un video largo va a YouTube o Drive, no aquí. */
export const LIMITE_BYTES = 50 * 1024 * 1024

export type AlcanceCapacitacion = 'general' | 'area' | 'puesto'
export type EstadoCapacitacion = 'borrador' | 'publicada' | 'archivada'
export type TipoBloque = 'texto' | 'video' | 'youtube' | 'documento' | 'diagrama' | 'imagen' | 'liga'
export type TipoPregunta = 'opcion_multiple' | 'verdadero_falso' | 'abierta'
export type MotivoIntento = 'capacitacion' | 'contratacion'

export interface Capacitacion {
  id: string
  titulo: string
  descripcion: string | null
  alcance: AlcanceCapacitacion
  area: string | null
  puestos: string[]
  roles: string[]
  estado: EstadoCapacitacion
  obligatoria: boolean
  minutos_estimados: number | null
  calificacion_minima: number
  autor_id: string | null
  autor_nombre: string | null
  orden: number
  created_at?: string
  updated_at?: string
}

export interface BloqueCapacitacion {
  id: string
  capacitacion_id: string
  tipo: TipoBloque
  titulo: string | null
  contenido: string | null
  url: string | null
  storage_path: string | null
  order_index: number
}

export interface PreguntaCapacitacion {
  id: string
  capacitacion_id: string
  pregunta: string
  tipo: TipoPregunta
  opciones: string[]
  respuesta_correcta: string | null
  explicacion: string | null
  puntos: number
  order_index: number
}

export interface IntentoCapacitacion {
  id: string
  capacitacion_id: string
  employee_id: string | null
  candidato_nombre: string | null
  candidato_puesto: string | null
  motivo: MotivoIntento
  respuestas: Record<string, string>
  puntos: number | null
  puntos_posibles: number | null
  calificacion: number | null
  aprobado: boolean | null
  pendiente_revision: boolean
  iniciado_at: string
  terminado_at: string | null
}

export const TIPO_BLOQUE_CFG: Record<TipoBloque, { label: string; icono: string; ayuda: string }> = {
  texto:      { label: 'Texto',      icono: '¶',  ayuda: 'Explicación escrita. Acepta saltos de línea y listas.' },
  diagrama:   { label: 'Diagrama',   icono: '◇',  ayuda: 'Un diagrama en texto (Mermaid) o la descripción de un flujo.' },
  imagen:     { label: 'Imagen',     icono: '▣',  ayuda: 'Una foto o captura. Se sube al ERP.' },
  documento:  { label: 'Documento',  icono: '▤',  ayuda: 'PDF, plano, hoja de cálculo. Se sube al ERP.' },
  video:      { label: 'Video',      icono: '▶',  ayuda: 'Un video propio. Se sube al ERP (máx. 50 MB).' },
  youtube:    { label: 'YouTube',    icono: '▶',  ayuda: 'Pega la liga del video. Se ve dentro de la capacitación.' },
  liga:       { label: 'Liga',       icono: '↗',  ayuda: 'Drive, un manual del fabricante, cualquier URL.' },
}

export const ALCANCE_CFG: Record<AlcanceCapacitacion, { label: string; ayuda: string; color: string }> = {
  general: { label: 'Toda la empresa', ayuda: 'Le toca a todos, sin importar área ni puesto.', color: '#D9A441' },
  area:    { label: 'Un área',          ayuda: 'Le toca a todos los de esa área.',              color: '#2563EB' },
  puesto:  { label: 'Puestos concretos', ayuda: 'Sólo a los puestos que elijas.',               color: '#10B981' },
}

const sinAcentos = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()

/**
 * ¿A esta persona le toca esta capacitación?
 *
 * Los puestos están capturados a mano y traen acentos, mayúsculas y espacios
 * de más ("DIBUJANTE INSTALACIONES " con espacio al final aparece dos veces en
 * la nómina). Se comparan normalizados o nadie coincidiría con nadie.
 */
export function leToca(c: Capacitacion, persona: { area?: string | null; puesto?: string | null }): boolean {
  if (c.estado !== 'publicada') return false
  if (c.alcance === 'general') return true
  if (c.alcance === 'area') return !!c.area && sinAcentos(c.area) === sinAcentos(persona.area || '')
  const p = sinAcentos(persona.puesto || '')
  if (c.puestos.some(x => sinAcentos(x) === p)) return true
  // Los roles son la red de seguridad: si el director marcó "dibujantes" en
  // vez de listar cada variante del puesto, igual cae.
  return c.roles.includes(rolDe(persona.puesto))
}

/** Puestos reales de la nómina activa, para que el director elija de una lista y no los teclee. */
export async function puestosDeLaNomina(): Promise<Array<{ puesto: string; area: string; rol: Rol; personas: number }>> {
  const { data } = await supabase.from('employees').select('puesto,area,is_active')
  const vivos = ((data as any[]) || []).filter(e => e.is_active !== false && (e.puesto || '').trim())
  const mapa = new Map<string, { puesto: string; area: string; rol: Rol; personas: number }>()
  for (const e of vivos) {
    const puesto = String(e.puesto).trim()
    const k = sinAcentos(puesto)
    const prev = mapa.get(k)
    if (prev) { prev.personas++; continue }
    mapa.set(k, { puesto, area: (e.area || '').trim(), rol: rolDe(puesto), personas: 1 })
  }
  return Array.from(mapa.values()).sort((a, b) => a.area.localeCompare(b.area) || a.puesto.localeCompare(b.puesto))
}

export async function areasDeLaNomina(): Promise<string[]> {
  const { data } = await supabase.from('employees').select('area,is_active')
  const s = new Set<string>()
  for (const e of ((data as any[]) || [])) {
    if (e.is_active === false) continue
    const a = (e.area || '').trim()
    if (a) s.add(a)
  }
  return Array.from(s).sort()
}

// ── Carga ───────────────────────────────────────────────────────────────────

export async function cargarCapacitaciones(incluirBorradores = true): Promise<Capacitacion[]> {
  let q = supabase.from('capacitaciones').select('*').order('orden').order('created_at', { ascending: false })
  if (!incluirBorradores) q = q.eq('estado', 'publicada')
  const { data } = await q
  return ((data as any[]) || []).map(normalizarCap)
}

const normalizarCap = (r: any): Capacitacion => ({
  ...r,
  puestos: Array.isArray(r.puestos) ? r.puestos : [],
  roles: Array.isArray(r.roles) ? r.roles : [],
  calificacion_minima: Number(r.calificacion_minima) || 80,
})

export async function cargarBloques(capacitacionId: string): Promise<BloqueCapacitacion[]> {
  const { data } = await supabase.from('capacitacion_bloques').select('*')
    .eq('capacitacion_id', capacitacionId).order('order_index')
  return (data as any[]) || []
}

export async function cargarPreguntas(capacitacionId: string): Promise<PreguntaCapacitacion[]> {
  const { data } = await supabase.from('capacitacion_preguntas').select('*')
    .eq('capacitacion_id', capacitacionId).order('order_index')
  return ((data as any[]) || []).map(p => ({ ...p, opciones: Array.isArray(p.opciones) ? p.opciones : [], puntos: Number(p.puntos) || 1 }))
}

export async function cargarIntentos(filtro: { capacitacionId?: string; employeeId?: string } = {}): Promise<IntentoCapacitacion[]> {
  let q = supabase.from('capacitacion_intentos').select('*').order('terminado_at', { ascending: false, nullsFirst: false })
  if (filtro.capacitacionId) q = q.eq('capacitacion_id', filtro.capacitacionId)
  if (filtro.employeeId) q = q.eq('employee_id', filtro.employeeId)
  const { data } = await q
  return ((data as any[]) || []).map(i => ({ ...i, respuestas: i.respuestas || {} }))
}

// ── Calificar ───────────────────────────────────────────────────────────────

/**
 * Califica un examen.
 *
 * Las preguntas ABIERTAS no se califican solas: se cuentan en los puntos
 * posibles y el intento queda marcado como pendiente de revisión. Inventar una
 * calificación sobre preguntas que nadie leyó sería peor que no dar ninguna.
 */
export function calificar(preguntas: PreguntaCapacitacion[], respuestas: Record<string, string>, minima: number) {
  let puntos = 0
  let posibles = 0
  let abiertas = 0
  const detalle: Array<{ pregunta_id: string; correcta: boolean | null; puntos: number }> = []

  for (const p of preguntas) {
    const vale = Number(p.puntos) || 1
    posibles += vale
    const dada = (respuestas[p.id] ?? '').toString().trim()
    if (p.tipo === 'abierta') {
      abiertas++
      detalle.push({ pregunta_id: p.id, correcta: null, puntos: 0 })
      continue
    }
    const esperada = (p.respuesta_correcta ?? '').toString().trim()
    const ok = dada !== '' && esperada !== '' && dada.toLowerCase() === esperada.toLowerCase()
    if (ok) puntos += vale
    detalle.push({ pregunta_id: p.id, correcta: ok, puntos: ok ? vale : 0 })
  }

  // El porcentaje se calcula sobre lo que SÍ se pudo calificar. Si el examen
  // es mitad abiertas, decir "50%" antes de revisarlas sería mentir.
  const calificables = preguntas.filter(p => p.tipo !== 'abierta').reduce((s, p) => s + (Number(p.puntos) || 1), 0)
  const calificacion = calificables > 0 ? Math.round((puntos / calificables) * 1000) / 10 : 0
  return {
    puntos,
    posibles,
    calificables,
    calificacion,
    abiertas,
    pendienteRevision: abiertas > 0,
    aprobado: abiertas > 0 ? null : calificacion >= minima,
    detalle,
  }
}

export async function guardarIntento(args: {
  capacitacion: Capacitacion
  preguntas: PreguntaCapacitacion[]
  respuestas: Record<string, string>
  employeeId?: string | null
  candidatoNombre?: string | null
  candidatoPuesto?: string | null
  motivo: MotivoIntento
}) {
  const r = calificar(args.preguntas, args.respuestas, args.capacitacion.calificacion_minima)
  const { data, error } = await supabase.from('capacitacion_intentos').insert({
    capacitacion_id: args.capacitacion.id,
    employee_id: args.employeeId || null,
    candidato_nombre: args.candidatoNombre || null,
    candidato_puesto: args.candidatoPuesto || null,
    motivo: args.motivo,
    respuestas: args.respuestas,
    puntos: r.puntos,
    puntos_posibles: r.posibles,
    calificacion: r.calificacion,
    aprobado: r.aprobado,
    pendiente_revision: r.pendienteRevision,
    terminado_at: new Date().toISOString(),
  }).select().single()
  if (error) throw new Error(error.message)
  return { intento: data as any as IntentoCapacitacion, resultado: r }
}

// ── Archivos ────────────────────────────────────────────────────────────────

export async function subirArchivo(capacitacionId: string, file: File): Promise<{ path: string; url: string }> {
  if (file.size > LIMITE_BYTES) {
    throw new Error(`"${file.name}" pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el tope es 50 MB. Si es un video largo, súbelo a YouTube y pega la liga.`)
  }
  const limpio = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${capacitacionId}/${Date.now()}_${limpio}`
  const { error } = await supabase.storage.from(BUCKET_CAPACITACIONES).upload(path, file, { upsert: false })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from(BUCKET_CAPACITACIONES).getPublicUrl(path)
  return { path, url: data.publicUrl }
}

/** Saca el id de un video de YouTube de cualquiera de las formas en que se pega la liga. */
export function idDeYouTube(url: string): string | null {
  const s = String(url || '').trim()
  if (!s) return null
  const patrones = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/,
    /^([\w-]{11})$/,
  ]
  for (const re of patrones) { const m = s.match(re); if (m) return m[1] }
  return null
}

// ── Avance de una persona ───────────────────────────────────────────────────

export interface AvancePersona {
  capacitacion: Capacitacion
  intentos: IntentoCapacitacion[]
  mejor: IntentoCapacitacion | null
  aprobada: boolean
  pendienteRevision: boolean
}

export function avanceDe(caps: Capacitacion[], intentos: IntentoCapacitacion[], persona: { area?: string | null; puesto?: string | null }): AvancePersona[] {
  const suyas = caps.filter(c => leToca(c, persona))
  return suyas.map(c => {
    const mios = intentos.filter(i => i.capacitacion_id === c.id)
    const mejor = mios.reduce<IntentoCapacitacion | null>((best, i) => {
      if (i.calificacion == null) return best
      if (!best || (best.calificacion ?? -1) < i.calificacion) return i
      return best
    }, null)
    return {
      capacitacion: c,
      intentos: mios,
      mejor,
      aprobada: mios.some(i => i.aprobado === true),
      pendienteRevision: mios.some(i => i.pendiente_revision && i.aprobado == null),
    }
  })
}
