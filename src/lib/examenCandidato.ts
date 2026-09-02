// Examen previo a la entrevista.
//
// La idea de Elias: antes de sentarse con alguien, comprobar que sabe lo que
// dice saber. El examen se arma en Capacitaciones (ya existe todo: bloques,
// preguntas, calificación automática); esto solo lo asigna a un candidato, le
// manda una liga y guarda el resultado en su ficha.
//
// La liga es PÚBLICA a propósito: el candidato no tiene usuario del ERP y
// pedirle que se registre para contestar un examen mata la respuesta. Lo único
// que lo identifica es el token, por eso es largo y de un solo uso.
import { supabase } from './supabase'
import { Candidato, Vacante } from './reclutamiento'
import {
  Capacitacion, PreguntaCapacitacion, IntentoCapacitacion,
  cargarPreguntas, calificar,
} from './capacitaciones'

export interface ExamenAsignado {
  id: string
  candidato_id: string
  capacitacion_id: string
  token: string
  enviado_at: string | null
  abierto_at: string | null
  vence_at: string | null
  intento_id: string | null
  created_at?: string
  /** Se rellenan al cargar, para pintar la ficha sin otra consulta. */
  capacitacion?: Capacitacion | null
  intento?: IntentoCapacitacion | null
}

/** Token largo y aleatorio: es la única credencial de la liga pública. */
function nuevoToken(): string {
  const a = new Uint8Array(24)
  crypto.getRandomValues(a)
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('')
}

export const ligaDelExamen = (token: string) =>
  `${typeof location !== 'undefined' ? location.origin : 'https://omm-erp.vercel.app'}/examen/${token}`

/** Los exámenes que se pueden mandar: publicados y con al menos una pregunta. */
export async function examenesDisponibles(): Promise<Array<Capacitacion & { preguntas: number }>> {
  const { data: caps } = await supabase.from('capacitaciones').select('*')
    .eq('estado', 'publicada').order('titulo')
  const lista = ((caps as any[]) || []) as Capacitacion[]
  if (!lista.length) return []
  const { data: pgs } = await supabase.from('capacitacion_preguntas')
    .select('capacitacion_id').in('capacitacion_id', lista.map(c => c.id))
  const cuenta: Record<string, number> = {}
  for (const p of ((pgs as any[]) || [])) cuenta[p.capacitacion_id] = (cuenta[p.capacitacion_id] || 0) + 1
  return lista.map(c => ({ ...c, preguntas: cuenta[c.id] || 0 })).filter(c => c.preguntas > 0)
}

export async function cargarAsignaciones(candidatoId: string): Promise<ExamenAsignado[]> {
  const { data } = await supabase.from('examen_asignaciones')
    .select('*, capacitacion:capacitaciones(*), intento:capacitacion_intentos(*)')
    .eq('candidato_id', candidatoId).order('created_at', { ascending: false })
  return ((data as any[]) || []) as ExamenAsignado[]
}

export async function asignarExamen(candidatoId: string, capacitacionId: string, diasVigencia = 7): Promise<ExamenAsignado> {
  const vence = new Date(); vence.setDate(vence.getDate() + diasVigencia)
  const { data, error } = await supabase.from('examen_asignaciones').insert({
    candidato_id: candidatoId, capacitacion_id: capacitacionId,
    token: nuevoToken(), vence_at: vence.toISOString(),
  }).select().single()
  if (error) throw new Error(error.message)
  return data as any
}

export const quitarAsignacion = (id: string) =>
  supabase.from('examen_asignaciones').delete().eq('id', id)

// ── El correo con la liga ───────────────────────────────────────────────────

export interface BorradorExamen { asunto: string; cuerpo: string }

export async function redactarInvitacion(
  c: Candidato, cap: Capacitacion, liga: string, v: Vacante | null, quienFirma: string, vence: string | null,
): Promise<BorradorExamen> {
  const prompt = `Redacta el correo con el que OMM Technologies (despacho mexicano de ingeniería eléctrica, instalaciones especiales e iluminación) le manda a un candidato una evaluación en línea, ANTES de la entrevista.

CANDIDATO: ${c.nombre}
PUESTO: ${v?.titulo || c.puesto_solicitado || 'el puesto al que se postuló'}
EVALUACIÓN: ${cap.titulo}
${cap.minutos_estimados ? `DURACIÓN APROXIMADA: ${cap.minutos_estimados} minutos` : ''}
${vence ? `FECHA LÍMITE: ${vence}` : ''}
LIGA: ${liga}
FIRMA: ${quienFirma}

REGLAS
- Español de México, usted, cordial y breve. Máximo 130 palabras.
- Dile que su postulación avanzó y que el siguiente paso es esta evaluación.
- Que es en línea, que no necesita registrarse y que se contesta de una sentada.
- Pega la liga EXACTAMENTE como viene arriba, en su propio renglón. No la acortes
  ni la cambies: es su única forma de entrar.
- No prometas entrevista ni empleo. Di que si el resultado es favorable, se le
  contacta para agendar entrevista.
- Sin emojis. Sin "Espero que se encuentre bien".

Responde SOLO con este JSON:
{"asunto": "", "cuerpo": "el correo completo con saltos de línea"}`

  const r = await fetch('/api/anthropic', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json()
  const m = (j?.content?.[0]?.text || '').match(/\{[\s\S]*\}/)
  if (!m) throw new Error(j?.error?.message || 'El modelo no devolvió el borrador')
  const d = JSON.parse(m[0])
  let cuerpo = String(d.cuerpo || '').trim()
  // Red de seguridad: si el modelo se comió la liga, el correo es inútil.
  if (!cuerpo.includes(liga)) cuerpo += `\n\n${liga}`
  return { asunto: String(d.asunto || `Evaluación para ${cap.titulo}`).trim(), cuerpo }
}

export async function enviarInvitacion(a: ExamenAsignado, correo: string, b: BorradorExamen): Promise<void> {
  const res = await fetch('/api/gmail?action=send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: correo, subject: b.asunto, body: b.cuerpo }),
  })
  const j = await res.json()
  if (!j?.ok) throw new Error(j?.error || 'No se pudo enviar')
  await supabase.from('examen_asignaciones')
    .update({ enviado_at: new Date().toISOString() }).eq('id', a.id)
}

// ── Lo que ve y hace el candidato en la liga pública ────────────────────────

export interface ExamenPublico {
  asignacion: { id: string; token: string; vence_at: string | null; intento_id: string | null }
  capacitacion: Capacitacion
  preguntas: PreguntaCapacitacion[]
  candidato: { nombre: string }
  yaContestado: boolean
  vencido: boolean
}

/**
 * Trae el examen por token. Nunca devuelve la respuesta correcta: el candidato
 * ve la página con las herramientas del navegador abiertas si quiere.
 */
export async function examenPorToken(token: string): Promise<ExamenPublico | null> {
  if (!token || token.length < 20) return null
  const { data: asig } = await supabase.from('examen_asignaciones')
    .select('id, token, vence_at, intento_id, capacitacion_id, candidato_id')
    .eq('token', token).maybeSingle()
  if (!asig) return null

  const [{ data: cap }, { data: cand }] = await Promise.all([
    supabase.from('capacitaciones').select('*').eq('id', (asig as any).capacitacion_id).maybeSingle(),
    supabase.from('candidatos').select('nombre').eq('id', (asig as any).candidato_id).maybeSingle(),
  ])
  if (!cap) return null

  // ⚠️ NUNCA usar cargarPreguntas() aquí. Esa trae select('*'), o sea que la
  // respuesta correcta VIAJA al navegador del candidato y se ve en la pestaña
  // de red aunque después se borre en JavaScript. Se piden solo las columnas
  // que puede ver: la clave se queda en el servidor.
  const { data: pgs } = await supabase.from('capacitacion_preguntas')
    .select('id, capacitacion_id, pregunta, tipo, opciones, puntos, order_index')
    .eq('capacitacion_id', (asig as any).capacitacion_id)
    .order('order_index')
  const preguntas = (((pgs as any[]) || []).map(p => ({
    ...p, respuesta_correcta: null, explicacion: null,
  }))) as PreguntaCapacitacion[]

  const vence = (asig as any).vence_at ? new Date((asig as any).vence_at) : null
  if (!(asig as any).abierto_at) {
    supabase.from('examen_asignaciones').update({ abierto_at: new Date().toISOString() }).eq('id', (asig as any).id).then(() => {})
  }
  return {
    asignacion: asig as any,
    capacitacion: cap as any,
    preguntas,
    candidato: { nombre: (cand as any)?.nombre || '' },
    yaContestado: !!(asig as any).intento_id,
    vencido: !!vence && vence.getTime() < Date.now(),
  }
}

/**
 * Guarda lo que contestó. La calificación se hace aquí y no en el navegador del
 * candidato: se vuelven a leer las preguntas CON su respuesta correcta, que la
 * página pública nunca vio.
 */
export async function entregarExamen(token: string, respuestas: Record<string, string>): Promise<{ enviado: true }> {
  const { data: asig } = await supabase.from('examen_asignaciones')
    .select('id, capacitacion_id, candidato_id, intento_id').eq('token', token).maybeSingle()
  if (!asig) throw new Error('Esta liga ya no es válida.')
  if ((asig as any).intento_id) throw new Error('Este examen ya fue contestado.')

  const { data: cap } = await supabase.from('capacitaciones').select('*').eq('id', (asig as any).capacitacion_id).maybeSingle()
  if (!cap) throw new Error('El examen ya no está disponible.')
  const preguntas = await cargarPreguntas((asig as any).capacitacion_id)
  const r = calificar(preguntas, respuestas, (cap as any).calificacion_minima)

  const { data: cand } = await supabase.from('candidatos').select('nombre, puesto_solicitado').eq('id', (asig as any).candidato_id).maybeSingle()
  const { data: intento, error } = await supabase.from('capacitacion_intentos').insert({
    capacitacion_id: (asig as any).capacitacion_id,
    candidato_id: (asig as any).candidato_id,
    candidato_nombre: (cand as any)?.nombre || null,
    candidato_puesto: (cand as any)?.puesto_solicitado || null,
    motivo: 'contratacion',
    respuestas,
    puntos: r.puntos, puntos_posibles: r.posibles, calificacion: r.calificacion,
    aprobado: r.aprobado, pendiente_revision: r.pendienteRevision,
    terminado_at: new Date().toISOString(),
  }).select().single()
  if (error) throw new Error(error.message)

  await supabase.from('examen_asignaciones').update({ intento_id: (intento as any).id }).eq('id', (asig as any).id)
  // Al candidato NO se le devuelve su calificación: la revisa quien contrata.
  return { enviado: true }
}
