// Referencias laborales del candidato: de dónde salen, qué se les pregunta y
// qué contestaron.
//
// La regla de la casa: NUNCA se le escribe a nadie sin que Elias vea antes el
// correo. La IA redacta, él lo lee y lo manda. Un correo a un ex-jefe se manda
// a nombre de OMM y no se puede deshacer.
import { supabase } from './supabase'
import { Candidato, Vacante } from './reclutamiento'
import { ReferenciaExtraida } from './analisisPrompt'

export type EstadoReferencia = 'pendiente' | 'sin_datos' | 'enviado' | 'respondido' | 'rebotado'

export interface Referencia {
  id: string
  candidato_id: string
  nombre: string
  puesto: string | null
  empresa: string | null
  relacion: string | null
  telefono: string | null
  email: string | null
  es_empleador_actual: boolean
  origen: 'cv' | 'manual'
  estado: EstadoReferencia
  enviado_at: string | null
  message_id: string | null
  thread_id: string | null
  respondido_at: string | null
  respuesta_texto: string | null
  resumen: ResumenReferencia | null
  created_at?: string
}

/** Lo que la IA saca de la respuesta de la referencia. */
export interface ResumenReferencia {
  confirma_puesto: 'si' | 'no' | 'no_dice'
  confirma_fechas: 'si' | 'no' | 'no_dice'
  desempeno: string
  fortalezas: string[]
  reservas: string[]
  lo_recontrataria: 'si' | 'no' | 'con_reservas' | 'no_dice'
  contradice_el_cv: string[]
  tono: 'muy_positivo' | 'positivo' | 'neutral' | 'tibio' | 'negativo'
}

export const ESTADO_REF_CFG: Record<EstadoReferencia, { label: string; color: string }> = {
  pendiente:  { label: 'Sin contactar',   color: '#6B7280' },
  sin_datos:  { label: 'Sin correo',      color: '#D9A441' },
  enviado:    { label: 'Esperando',       color: '#2563EB' },
  respondido: { label: 'Contestó',        color: '#10B981' },
  rebotado:   { label: 'Rebotó',          color: '#DC2626' },
}

export const TONO_CFG: Record<string, { label: string; color: string }> = {
  muy_positivo: { label: 'Muy positivo', color: '#10B981' },
  positivo:     { label: 'Positivo',     color: '#10B981' },
  neutral:      { label: 'Neutral',      color: '#888888' },
  tibio:        { label: 'Tibio',        color: '#D9A441' },
  negativo:     { label: 'Negativo',     color: '#DC2626' },
}

export async function cargarReferencias(candidatoId: string): Promise<Referencia[]> {
  const { data } = await supabase.from('candidato_referencias').select('*')
    .eq('candidato_id', candidatoId).order('created_at')
  return ((data as any[]) || []) as Referencia[]
}

const clave = (r: { nombre?: string | null; empresa?: string | null }) =>
  `${String(r.nombre || '').trim().toLowerCase()}|${String(r.empresa || '').trim().toLowerCase()}`

/**
 * Guarda las referencias que sacó la IA sin pisar lo capturado a mano ni lo ya
 * contactado. Re-analizar un CV no debe borrar una respuesta que ya llegó.
 */
export async function sincronizarReferencias(candidatoId: string, extraidas: ReferenciaExtraida[]): Promise<number> {
  if (!extraidas?.length) return 0
  const actuales = await cargarReferencias(candidatoId)
  const yaEstan = new Set(actuales.map(clave))
  const nuevas = extraidas
    .filter(r => r.nombre && !yaEstan.has(clave(r)))
    .map(r => ({
      candidato_id: candidatoId,
      nombre: r.nombre,
      puesto: r.puesto || null,
      empresa: r.empresa || null,
      relacion: r.relacion || null,
      telefono: r.telefono || null,
      email: r.email || null,
      es_empleador_actual: !!r.es_empleador_actual,
      origen: 'cv',
      estado: r.email ? 'pendiente' : 'sin_datos',
    }))
  if (!nuevas.length) return 0
  const { error } = await supabase.from('candidato_referencias').insert(nuevas)
  if (error) throw new Error(error.message)
  return nuevas.length
}

export async function guardarReferencia(id: string, campos: Partial<Referencia>) {
  const patch: any = { ...campos, updated_at: new Date().toISOString() }
  // Si le ponen correo a una que no lo tenía, deja de estar "sin datos".
  if (campos.email && (campos as any).estado === undefined) patch.estado = 'pendiente'
  await supabase.from('candidato_referencias').update(patch).eq('id', id)
}

export async function agregarReferencia(candidatoId: string, r: Partial<Referencia>): Promise<Referencia> {
  const { data, error } = await supabase.from('candidato_referencias').insert({
    candidato_id: candidatoId,
    nombre: (r.nombre || '').trim() || 'Sin nombre',
    puesto: r.puesto || null, empresa: r.empresa || null, relacion: r.relacion || null,
    telefono: r.telefono || null, email: r.email || null,
    es_empleador_actual: !!r.es_empleador_actual,
    origen: 'manual',
    estado: r.email ? 'pendiente' : 'sin_datos',
  }).select().single()
  if (error) throw new Error(error.message)
  return data as any
}

export const borrarReferencia = (id: string) =>
  supabase.from('candidato_referencias').delete().eq('id', id)

// ── El correo ───────────────────────────────────────────────────────────────

export interface BorradorCorreo { asunto: string; cuerpo: string }

/**
 * Redacta la petición de referencia. Se pide poco y concreto: una referencia se
 * contesta o no se contesta según lo que cueste responderla.
 */
export async function redactarCorreo(
  c: Candidato, r: Referencia, v: Vacante | null, quienFirma: string,
): Promise<BorradorCorreo> {
  const prompt = `Redacta un correo de OMM Technologies (despacho mexicano de ingeniería eléctrica, instalaciones especiales e iluminación) para pedir una referencia laboral.

A QUIÉN SE LE ESCRIBE
Nombre: ${r.nombre}
${r.puesto ? `Puesto: ${r.puesto}` : ''}
${r.empresa ? `Empresa: ${r.empresa}` : ''}
${r.relacion ? `Relación con el candidato: ${r.relacion}` : ''}

DE QUIÉN SE PREGUNTA
Candidato: ${c.nombre}
Se postuló a: ${v?.titulo || c.puesto_solicitado || 'un puesto en OMM'}

FIRMA: ${quienFirma}

REGLAS
- Español de México, usted, cordial y breve. Máximo 150 palabras.
- Explica en la primera línea quién eres y por qué escribes: ${c.nombre} lo dio como referencia.
- Pide SOLO cuatro cosas, en una lista corta: (1) confirmar puesto y fechas,
  (2) cómo describiría su desempeño, (3) alguna reserva que valga la pena saber,
  (4) si lo volvería a contratar.
- Dile que con contestar este correo es suficiente, que no hace falta llamada.
- Agradece el tiempo. No prometas confidencialidad absoluta ni nada que no podamos cumplir.
- Sin emojis. Sin "Espero que se encuentre bien".

Responde SOLO con este JSON:
{"asunto": "", "cuerpo": "el correo completo con saltos de línea"}`

  const rr = await fetch('/api/anthropic', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await rr.json()
  const txt = j?.content?.[0]?.text || ''
  const m = txt.match(/\{[\s\S]*\}/)
  if (!m) throw new Error(j?.error?.message || 'El modelo no devolvió el borrador')
  const d = JSON.parse(m[0])
  return {
    asunto: String(d.asunto || `Referencia laboral de ${c.nombre}`).trim(),
    cuerpo: String(d.cuerpo || '').trim(),
  }
}

/** Manda el correo y deja el hilo apuntado para poder seguir la respuesta. */
export async function enviarCorreo(r: Referencia, b: BorradorCorreo): Promise<void> {
  if (!r.email) throw new Error('Esa referencia no tiene correo.')
  const res = await fetch('/api/gmail?action=send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: r.email, subject: b.asunto, body: b.cuerpo }),
  })
  const j = await res.json()
  if (!j?.ok) throw new Error(j?.error || 'No se pudo enviar')
  await supabase.from('candidato_referencias').update({
    estado: 'enviado', enviado_at: new Date().toISOString(),
    message_id: j.messageId || null, thread_id: j.threadId || null,
    updated_at: new Date().toISOString(),
  }).eq('id', r.id)
}

/**
 * Revisa si ya contestaron. Lee el hilo y se queda con el primer mensaje que NO
 * salió de nosotros; ese es la respuesta. Luego la IA la resume contra el CV.
 */
export async function revisarRespuesta(r: Referencia, cuentaPropia: string, candidato: Candidato): Promise<boolean> {
  if (!r.thread_id || r.estado === 'respondido') return false
  const res = await fetch(`/api/gmail?action=hilo&threadId=${encodeURIComponent(r.thread_id)}`)
  const j = await res.json()
  if (!j?.ok || !Array.isArray(j.mensajes)) return false

  const propio = (de: string) => cuentaPropia && String(de || '').toLowerCase().includes(cuentaPropia.toLowerCase())
  const respuesta = j.mensajes.find((m: any) => !propio(m.de) && (m.texto || '').trim().length > 20)
  if (!respuesta) return false

  const texto = String(respuesta.texto || '').slice(0, 6000)
  let resumen: ResumenReferencia | null = null
  try {
    const prompt = `Esta es la respuesta de una referencia laboral sobre un candidato. Resúmela para quien va a decidir si lo entrevista.

CANDIDATO: ${candidato.nombre}
LO QUE DICE SU CV: ${JSON.stringify((candidato.analisis as any)?.trayectoria || []).slice(0, 1500)}

RESPUESTA DE ${r.nombre}${r.empresa ? ` (${r.empresa})` : ''}:
${texto}

Reglas:
- No adornes. Si la respuesta es tibia, dilo: un "es buena persona" sin nada más es tibio.
- "contradice_el_cv": SOLO si lo que dice choca con la trayectoria de arriba (fechas, puesto, funciones). Si no hay choque, deja [].
- Si la respuesta no contesta algo, usa "no_dice". No lo inventes.

Responde SOLO con este JSON:
{"confirma_puesto":"si|no|no_dice","confirma_fechas":"si|no|no_dice","desempeno":"2 renglones","fortalezas":[""],"reservas":[""],"lo_recontrataria":"si|no|con_reservas|no_dice","contradice_el_cv":[""],"tono":"muy_positivo|positivo|neutral|tibio|negativo"}`
    const rr = await fetch('/api/anthropic', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
    })
    const jj = await rr.json()
    const m = (jj?.content?.[0]?.text || '').match(/\{[\s\S]*\}/)
    if (m) resumen = JSON.parse(m[0])
  } catch { /* el texto crudo ya vale; el resumen es un extra */ }

  await supabase.from('candidato_referencias').update({
    estado: 'respondido',
    respondido_at: respuesta.fecha || new Date().toISOString(),
    respuesta_texto: texto,
    resumen,
    updated_at: new Date().toISOString(),
  }).eq('id', r.id)
  return true
}

/** Las que llevan esperando y toca volver a revisar. */
export const esperandoRespuesta = (refs: Referencia[]) => refs.filter(r => r.estado === 'enviado' && r.thread_id)

/** Resumen de una línea para la lista de candidatos. */
export function estadoDeReferencias(refs: Referencia[]): { texto: string; color: string } | null {
  if (!refs.length) return null
  const cont = refs.filter(r => r.estado === 'respondido').length
  const env = refs.filter(r => r.estado === 'enviado').length
  if (cont > 0) return { texto: `${cont} de ${refs.length} referencias contestaron`, color: '#10B981' }
  if (env > 0) return { texto: `${env} referencia(s) esperando respuesta`, color: '#2563EB' }
  return { texto: `${refs.length} referencia(s) sin contactar`, color: '#888888' }
}
