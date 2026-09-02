/**
 * RECLUTAMIENTO — vacantes, candidatos y las postulaciones que llegan por correo
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Indeed manda un correo por cada postulación, con el CV adjunto. Ese correo
 * es la integración: no hace falta su API, que está reservada a socios ATS y
 * cuya política de visibilidad gratuita ya cambió una vez este año.
 *
 * ── Por qué la extracción la hace la IA y no una expresión regular ──────────
 *
 * En el buzón conviven CUATRO formatos distintos del mismo aviso, de 2022 a
 * 2025. Unos traen campos limpios:
 *
 *     Name: Jessy Flores
 *     Email: jessyfloresmorland…@indeedemail.com
 *     Message: <carta de presentación>
 *
 * y otros son prosa suelta:
 *
 *     Nuevo mensaje de PABLO ALBERTO ROBLES MARTINEZ
 *     Coordinador de Proyectos en 11700, Ciudad de México, CDMX
 *     numero de contacto 5547723766
 *
 * Un parser rígido se rompe en el siguiente cambio de formato. Se le entrega
 * el correo a la IA y que saque los campos.
 *
 * ── El correo del candidato NO es su correo ─────────────────────────────────
 *
 * Indeed entrega un alias (…@indeedemail.com) que reenvía al candidato. Sirve
 * para contestarle, pero no es su dirección real: se guarda en `email_relay`
 * para no confundirlo con el de verdad, que suele venir escrito en el cuerpo
 * o dentro del CV.
 */

import { supabase } from './supabase'
import { promptDeExtraccion } from './analisisPrompt'

export const BUCKET_CV = 'reclutamiento'

export type EstadoVacante = 'borrador' | 'abierta' | 'pausada' | 'cerrada'
export type EtapaCandidato = 'nuevo' | 'revision' | 'entrevista' | 'examen' | 'oferta' | 'contratado' | 'descartado'
export type FuenteCandidato = 'indeed' | 'occ' | 'computrabajo' | 'referido' | 'directo' | 'otro'

export interface Vacante {
  id: string
  titulo: string
  puesto: string | null
  area: string | null
  descripcion: string | null
  requisitos: string | null
  ubicacion: string | null
  sueldo_desde: number | null
  sueldo_hasta: number | null
  moneda: string
  tipo_jornada: string | null
  estado: EstadoVacante
  vacantes_totales: number
  publicada_at: string | null
  cierra_at: string | null
  creada_por: string | null
  created_at?: string
}

export interface Candidato {
  id: string
  vacante_id: string | null
  nombre: string
  email: string | null
  telefono: string | null
  email_relay: string | null
  fuente: FuenteCandidato
  puesto_solicitado: string | null
  carta: string | null
  cv_path: string | null
  cv_nombre: string | null
  etapa: EtapaCandidato
  motivo_descarte: string | null
  calificacion: number | null
  notas: string | null
  employee_id: string | null
  origen_message_id: string | null
  recibido_at: string | null
  created_at?: string
  // Veredicto de la IA. La forma vive en analisisCandidato.ts; aquí se declara
  // suelto para no cruzar los dos módulos (ese importa de éste).
  compatibilidad?: number | null
  analisis?: any | null
  analisis_at?: string | null
  analisis_error?: string | null
  analisis_modelo?: string | null
}

export const ETAPA_CFG: Record<EtapaCandidato, { label: string; color: string; orden: number }> = {
  nuevo:      { label: 'Nuevo',       color: '#6B7280', orden: 0 },
  revision:   { label: 'En revisión', color: '#2563EB', orden: 1 },
  entrevista: { label: 'Entrevista',  color: '#A78BFA', orden: 2 },
  examen:     { label: 'Examen',      color: '#D9A441', orden: 3 },
  oferta:     { label: 'Oferta',      color: '#D97706', orden: 4 },
  contratado: { label: 'Contratado',  color: '#10B981', orden: 5 },
  descartado: { label: 'Descartado',  color: '#DC2626', orden: 6 },
}

export const ESTADO_VACANTE_CFG: Record<EstadoVacante, { label: string; color: string }> = {
  borrador: { label: 'Borrador', color: '#6B7280' },
  abierta:  { label: 'Abierta',  color: '#10B981' },
  pausada:  { label: 'Pausada',  color: '#D97706' },
  cerrada:  { label: 'Cerrada',  color: '#444' },
}

export const FUENTE_CFG: Record<FuenteCandidato, string> = {
  indeed: 'Indeed', occ: 'OCC', computrabajo: 'Computrabajo',
  referido: 'Referido', directo: 'Directo', otro: 'Otro',
}

// ── Carga ───────────────────────────────────────────────────────────────────

export async function cargarVacantes(): Promise<Vacante[]> {
  const { data } = await supabase.from('vacantes').select('*').order('created_at', { ascending: false })
  return (data as any[]) || []
}

export async function cargarCandidatos(vacanteId?: string | null): Promise<Candidato[]> {
  let q = supabase.from('candidatos').select('*').order('recibido_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
  if (vacanteId) q = q.eq('vacante_id', vacanteId)
  const { data } = await q
  return (data as any[]) || []
}

export const urlDelCV = (path?: string | null) =>
  path ? supabase.storage.from(BUCKET_CV).getPublicUrl(path).data.publicUrl : null

// ── Postulaciones por correo ────────────────────────────────────────────────

export interface CorreoPostulacion {
  id: string
  fecha: string
  de: string
  asunto: string
  texto: string
  adjuntos: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }>
}

export interface EstadoBandeja {
  ok: boolean
  connected: boolean
  reconectar?: boolean
  error?: string
  email?: string
  mensajes: CorreoPostulacion[]
}

export async function buscarPostulaciones(dias = 30): Promise<EstadoBandeja> {
  try {
    const r = await fetch(`/api/gmail?action=postulaciones&dias=${dias}`)
    const j = await r.json()
    return { mensajes: [], connected: false, ok: false, ...j }
  } catch (e: any) {
    return { ok: false, connected: false, error: e?.message || String(e), mensajes: [] }
  }
}

/** Los que ya se importaron, para no volver a crearlos. */
export async function messageIdsImportados(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { data } = await supabase.from('candidatos').select('origen_message_id').in('origen_message_id', ids)
  return new Set(((data as any[]) || []).map(c => c.origen_message_id))
}

export interface DatosExtraidos {
  nombre: string
  puesto: string
  email_real: string | null
  email_relay: string | null
  telefono: string | null
  carta: string | null
}

/**
 * Saca los datos del candidato del correo, con la IA.
 *
 * Devuelve null si no logra sacar al menos un nombre: más vale que el usuario
 * lo capture a mano que meter a la base un candidato llamado "undefined".
 */
export async function extraerDeCorreo(correo: CorreoPostulacion): Promise<DatosExtraidos | null> {
  const prompt = promptDeExtraccion(correo)

  try {
    const r = await fetch('/api/anthropic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
    })
    const j = await r.json()
    const txt = j?.content?.[0]?.text || ''
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return null
    const d = JSON.parse(m[0])
    const nombre = String(d.nombre || '').trim()
    if (!nombre) return null
    const soloDigitos = (v: any) => { const s = String(v ?? '').replace(/\D/g, ''); return s.length >= 10 ? s : null }
    const esRelay = (v: any) => /@indeedemail\.com$/i.test(String(v || ''))
    return {
      nombre,
      puesto: String(d.puesto || '').trim(),
      // Red de seguridad: si la IA metió el alias en email_real, se corrige.
      email_real: d.email_real && !esRelay(d.email_real) ? String(d.email_real).trim() : null,
      email_relay: esRelay(d.email_relay) ? String(d.email_relay).trim() : (esRelay(d.email_real) ? String(d.email_real).trim() : null),
      telefono: soloDigitos(d.telefono),
      carta: d.carta ? String(d.carta).trim() : null,
    }
  } catch { return null }
}

const b64aBlob = (b64: string, tipo: string) => {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: tipo || 'application/octet-stream' })
}

/** El adjunto que más parece un CV. Si hay varios, el PDF más pesado. */
export function adjuntoDelCV(correo: CorreoPostulacion) {
  const candidatos = (correo.adjuntos || []).filter(a => /pdf|word|document|msword|officedocument/i.test(a.mimeType) || /\.(pdf|docx?|rtf)$/i.test(a.filename))
  if (!candidatos.length) return null
  const conCV = candidatos.filter(a => /cv|curriculum|currículum|resume/i.test(a.filename))
  const lista = conCV.length ? conCV : candidatos
  return lista.sort((a, b) => (b.size || 0) - (a.size || 0))[0]
}

/**
 * Crea el candidato a partir del correo: sube el CV al ERP y guarda la ficha.
 * `origen_message_id` tiene índice único, así que importar dos veces el mismo
 * correo no duplica al candidato.
 */
export async function importarPostulacion(correo: CorreoPostulacion, datos: DatosExtraidos, vacanteId?: string | null): Promise<Candidato> {
  let cv_path: string | null = null
  let cv_nombre: string | null = null
  const adj = adjuntoDelCV(correo)
  if (adj) {
    try {
      const r = await fetch(`/api/gmail?action=postulacion_adjunto&messageId=${encodeURIComponent(correo.id)}&attachmentId=${encodeURIComponent(adj.attachmentId)}`)
      const j = await r.json()
      if (j?.ok && j.base64) {
        const limpio = adj.filename.trim().replace(/[^\w.\-]+/g, '_')
        const path = `${correo.id}/${Date.now()}_${limpio}`
        const { error } = await supabase.storage.from(BUCKET_CV).upload(path, b64aBlob(j.base64, adj.mimeType), { upsert: false })
        if (!error) { cv_path = path; cv_nombre = adj.filename.trim() }
      }
    } catch { /* si el CV falla, el candidato igual se crea: el dato vale más que el archivo */ }
  }

  const fecha = correo.fecha ? new Date(correo.fecha) : null
  const { data, error } = await supabase.from('candidatos').insert({
    vacante_id: vacanteId || null,
    nombre: datos.nombre,
    email: datos.email_real,
    email_relay: datos.email_relay,
    telefono: datos.telefono,
    fuente: 'indeed',
    puesto_solicitado: datos.puesto || null,
    carta: datos.carta,
    cv_path, cv_nombre,
    etapa: 'nuevo',
    origen_message_id: correo.id,
    recibido_at: fecha && !isNaN(fecha.getTime()) ? fecha.toISOString() : new Date().toISOString(),
  }).select().single()
  if (error) throw new Error(error.message)
  return data as any
}

export async function moverEtapa(id: string, etapa: EtapaCandidato, motivo?: string) {
  await supabase.from('candidatos').update({
    etapa,
    motivo_descarte: etapa === 'descartado' ? (motivo || null) : null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
}

/**
 * Sube el CV a mano.
 *
 * Hace falta porque los correos de Indeed NO traen el CV adjunto: solo el
 * nombre, el alias de correo y una liga al portal. El texto dice "su CV adjunto
 * (si se proporcionó uno)" pero el mensaje llega con cero adjuntos —
 * verificado contra la bandeja real. Así que el CV se baja de Indeed y se sube
 * aquí; sin esto, ningún candidato de Indeed se puede analizar.
 */
export async function subirCV(candidatoId: string, file: File): Promise<{ cv_path: string; cv_nombre: string }> {
  const MAX = 20 * 1024 * 1024
  if (file.size > MAX) throw new Error(`"${file.name}" pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el tope es 20 MB.`)
  const limpio = file.name.trim().replace(/[^\w.\-]+/g, '_')
  const path = `manual/${candidatoId}/${Date.now()}_${limpio}`
  const { error } = await supabase.storage.from(BUCKET_CV).upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw new Error(error.message)
  // Se limpia el veredicto anterior: decía "no se pudo leer el CV" y con el CV
  // nuevo esa conclusión ya no vale. Dejarlo confundiría más que ayudar.
  const { error: e2 } = await supabase.from('candidatos').update({
    cv_path: path, cv_nombre: file.name.trim(),
    analisis: null, compatibilidad: null, analisis_at: null, analisis_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', candidatoId)
  if (e2) throw new Error(e2.message)
  return { cv_path: path, cv_nombre: file.name.trim() }
}

/** El CV es PDF? El modelo solo lee PDF como documento. */
export const esPdf = (nombreOPath?: string | null) => /\.pdf$/i.test(String(nombreOPath || ''))
