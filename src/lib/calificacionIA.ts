// Calificación asistida de preguntas abiertas.
//
// El examen de Asistente Contable trae 12 preguntas de respuesta corta, un
// ejercicio de conciliación y 5 casos de criterio — todo abierto. El motor solo
// califica solo lo de opción múltiple, así que sin esto el resultado siempre
// saldría en 0% y "pendiente de revisión", y filtrar seguiría siendo trabajo
// manual.
//
// Lo que hace: compara la respuesta del candidato contra LA CLAVE DEL EVALUADOR
// que ya viene en el examen y propone puntos. Es una PROPUESTA. No toca la
// calificación oficial hasta que quien contrata la confirma — de esto depende
// que alguien entre o no a una entrevista.
import { supabase } from './supabase'
import { PreguntaCapacitacion, IntentoCapacitacion, cargarPreguntas } from './capacitaciones'

export type VeredictoIA = 'completa' | 'parcial' | 'nula' | 'sin_responder'

export interface RevisionPregunta {
  pregunta_id: string
  puntos: number
  posibles: number
  veredicto: VeredictoIA
  por_que: string
}

export interface RevisionIA {
  preguntas: RevisionPregunta[]
  puntos: number
  posibles: number
  calificacion: number
}

export const VEREDICTO_IA_CFG: Record<VeredictoIA, { label: string; color: string }> = {
  completa:      { label: 'Correcta',      color: '#10B981' },
  parcial:       { label: 'A medias',      color: '#D9A441' },
  nula:          { label: 'Incorrecta',    color: '#DC2626' },
  sin_responder: { label: 'Sin responder', color: '#666666' },
}

/**
 * Revisa las abiertas de un intento. Las de opción múltiple no se tocan: ésas
 * ya las calificó el motor y son objetivas.
 */
export async function revisarConIA(intento: IntentoCapacitacion): Promise<RevisionIA> {
  const preguntas = await cargarPreguntas(intento.capacitacion_id)
  const abiertas = preguntas.filter(p => p.tipo === 'abierta')
  if (!abiertas.length) throw new Error('Este examen no tiene preguntas abiertas.')

  const resp = (intento.respuestas || {}) as Record<string, string>
  const items = abiertas.map((p, i) => ({
    n: i + 1, id: p.id, puntos: Number(p.puntos) || 1,
    pregunta: p.pregunta,
    clave: p.respuesta_correcta || '',
    criterio: (p as any).criterio || '',
    respuesta: (resp[p.id] || '').trim(),
  }))

  const prompt = `Eres quien califica un examen de contratación para el puesto de Asistente Contable en OMM Technologies (despacho mexicano de ingeniería). Compara cada respuesta del candidato contra la CLAVE DEL EVALUADOR y propón los puntos.

${items.map(it => `── PREGUNTA ${it.n} (vale ${it.puntos} pts) ──
PREGUNTA: ${it.pregunta}
CLAVE DEL EVALUADOR: ${it.clave || '(sin clave; califica por criterio profesional)'}
${it.criterio ? `CÓMO CALIFICAR: ${it.criterio}` : ''}
RESPUESTA DEL CANDIDATO: ${it.respuesta || '(en blanco)'}`).join('\n\n')}

CÓMO CALIFICAR
- No se exige literalidad. Se exige que demuestre entender el CONCEPTO. Otras
  palabras que digan lo mismo valen completo.
- "completa" = puntos completos. "parcial" = la mitad de los puntos, redondeada
  hacia abajo, y solo cuando acierta una parte real del concepto, no cuando
  suena parecido. "nula" = 0. "sin_responder" = 0 y no lo confundas con nula.
- Sé estricto con las preguntas de criterio (casos de "qué harías"): ahí lo que
  se mide es si prioriza la integridad de la información sobre la comodidad de
  entregar. Una respuesta que deja pasar un error o fuerza un cuadre es NULA por
  más bien redactada que esté.
- Si la respuesta contradice la clave, es nula aunque suene técnica.
- "por_que": una sola línea, concreta, en español de México. Di qué le faltó o
  qué acertó, no des un discurso.

Responde SOLO con este JSON, un objeto por pregunta y en el mismo orden:
{"preguntas":[{"n":1,"veredicto":"completa|parcial|nula|sin_responder","puntos":0,"por_que":""}]}`

  const r = await fetch('/api/anthropic', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json()
  const m = (j?.content?.[0]?.text || '').match(/\{[\s\S]*\}/)
  if (!m) throw new Error(j?.error?.message || 'El modelo no devolvió la revisión')
  const d = JSON.parse(m[0])

  const porN: Record<number, any> = {}
  for (const x of (Array.isArray(d.preguntas) ? d.preguntas : [])) porN[Number(x.n)] = x

  const detalle: RevisionPregunta[] = items.map(it => {
    const x = porN[it.n] || {}
    const v: VeredictoIA = ['completa', 'parcial', 'nula', 'sin_responder'].includes(x.veredicto)
      ? x.veredicto : (it.respuesta ? 'nula' : 'sin_responder')
    // Los puntos se recalculan del veredicto y NO se toman del modelo: si dice
    // "parcial" y de puntos pone el total, gana el veredicto.
    const puntos = v === 'completa' ? it.puntos : v === 'parcial' ? Math.floor(it.puntos / 2) : 0
    return {
      pregunta_id: it.id, puntos, posibles: it.puntos, veredicto: v,
      por_que: String(x.por_que || '').trim(),
    }
  })

  const puntos = detalle.reduce((s, x) => s + x.puntos, 0)
  const posibles = detalle.reduce((s, x) => s + x.posibles, 0)
  const rev: RevisionIA = {
    preguntas: detalle, puntos, posibles,
    calificacion: posibles > 0 ? Math.round((puntos / posibles) * 1000) / 10 : 0,
  }

  await supabase.from('capacitacion_intentos').update({
    revision_ia: rev, calificacion_ia: rev.calificacion, revision_ia_at: new Date().toISOString(),
  }).eq('id', intento.id)
  return rev
}

/**
 * Quien contrata confirma la revisión: hasta aquí, la propuesta de la IA no
 * había tocado la calificación oficial ni el aprobado/no aprobado.
 */
export async function confirmarRevision(
  intento: IntentoCapacitacion, rev: RevisionIA, minima: number, quien: string,
): Promise<void> {
  // Se suman las de opción múltiple (ya calificadas) con las abiertas revisadas.
  const preguntas = await cargarPreguntas(intento.capacitacion_id)
  const cerradas = preguntas.filter(p => p.tipo !== 'abierta')
  const resp = (intento.respuestas || {}) as Record<string, string>
  let puntosCerradas = 0, posiblesCerradas = 0
  for (const p of cerradas) {
    const vale = Number(p.puntos) || 1
    posiblesCerradas += vale
    const dada = (resp[p.id] || '').trim().toLowerCase()
    const esperada = (p.respuesta_correcta || '').trim().toLowerCase()
    if (dada && esperada && dada === esperada) puntosCerradas += vale
  }
  const puntos = puntosCerradas + rev.puntos
  const posibles = posiblesCerradas + rev.posibles
  const calificacion = posibles > 0 ? Math.round((puntos / posibles) * 1000) / 10 : 0

  await supabase.from('capacitacion_intentos').update({
    puntos, puntos_posibles: posibles, calificacion,
    aprobado: calificacion >= minima,
    pendiente_revision: false,
    confirmado_por: quien, confirmado_at: new Date().toISOString(),
  }).eq('id', intento.id)
}

/** Ajustar a mano el veredicto de una pregunta antes de confirmar. */
export function ajustar(rev: RevisionIA, preguntaId: string, v: VeredictoIA): RevisionIA {
  const preguntas = rev.preguntas.map(p => {
    if (p.pregunta_id !== preguntaId) return p
    const puntos = v === 'completa' ? p.posibles : v === 'parcial' ? Math.floor(p.posibles / 2) : 0
    return { ...p, veredicto: v, puntos }
  })
  const puntos = preguntas.reduce((s, x) => s + x.puntos, 0)
  const posibles = preguntas.reduce((s, x) => s + x.posibles, 0)
  return { preguntas, puntos, posibles, calificacion: posibles > 0 ? Math.round((puntos / posibles) * 1000) / 10 : 0 }
}
