// Análisis IA de un candidato contra la vacante: la parte que necesita el
// navegador (bajar el CV del bucket, llamar al proxy, guardar). El prompt y la
// forma del veredicto viven en analisisPrompt.ts, compartidos con el servidor.
import { supabase } from './supabase'
import { Candidato, Vacante, BUCKET_CV } from './reclutamiento'
import {
  MODELO_ANALISIS, Analisis, Cumple, Severidad, VEREDICTO_CFG, colorCompat,
  promptDeAnalisis, normalizarAnalisis,
} from './analisisPrompt'

export {
  MODELO_ANALISIS, VEREDICTO_CFG, colorCompat, promptDeAnalisis, normalizarAnalisis,
}
export type { Analisis, Cumple, Severidad }

const aBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Baja el CV del bucket y lo devuelve listo para mandárselo al modelo. */
export async function cvParaElModelo(cvPath?: string | null): Promise<{ b64: string; tipo: string } | null> {
  if (!cvPath) return null
  const { data, error } = await supabase.storage.from(BUCKET_CV).download(cvPath)
  if (error || !data) return null
  const tipo = data.type || (/\.pdf$/i.test(cvPath) ? 'application/pdf' : '')
  if (!/pdf/i.test(tipo)) return null   // el modelo solo lee PDF como documento
  return { b64: aBase64(await data.arrayBuffer()), tipo: 'application/pdf' }
}

/**
 * Analiza un candidato y guarda el veredicto. Sin CV en PDF también corre: se
 * analiza con la carta y el correo, y el propio análisis lo dice en
 * "falta_saber" — es peor no tener nada que tener un análisis con asterisco.
 */
export async function analizarCandidato(c: Candidato, v: Vacante | null): Promise<{ ok: boolean; analisis?: Analisis; error?: string }> {
  try {
    const cv = await cvParaElModelo(c.cv_path)
    const contenido: any[] = []
    if (cv) contenido.push({ type: 'document', source: { type: 'base64', media_type: cv.tipo, data: cv.b64 } })
    contenido.push({ type: 'text', text: promptDeAnalisis(c, v) + (cv ? '' : '\n\nNOTA: no se pudo leer el CV. Analiza con lo que hay y sé explícito en "falta_saber".') })

    const r = await fetch('/api/anthropic', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODELO_ANALISIS, max_tokens: 4000, messages: [{ role: 'user', content: contenido }] }),
    })
    const j = await r.json()
    const txt = j?.content?.[0]?.text || ''
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) throw new Error(j?.error?.message || 'El modelo no devolvió JSON')
    const analisis = normalizarAnalisis(JSON.parse(m[0]))
    await guardarAnalisis(c.id, analisis)
    return { ok: true, analisis }
  } catch (e: any) {
    const error = e?.message || String(e)
    await supabase.from('candidatos').update({ analisis_error: error, analisis_at: new Date().toISOString() }).eq('id', c.id)
    return { ok: false, error }
  }
}

export async function guardarAnalisis(candidatoId: string, a: Analisis) {
  // Las referencias que trae el CV se siembran aquí: es el único momento en que
  // se conocen. sincronizarReferencias no pisa lo capturado a mano ni lo ya
  // contestado, así que re-analizar es seguro.
  try {
    const { sincronizarReferencias } = await import('./referencias')
    await sincronizarReferencias(candidatoId, a.referencias || [])
  } catch { /* el veredicto vale aunque las referencias fallen */ }
  await supabase.from('candidatos').update({
    compatibilidad: a.compatibilidad,
    analisis: a,
    analisis_at: new Date().toISOString(),
    analisis_error: null,
    analisis_modelo: MODELO_ANALISIS,
  }).eq('id', candidatoId)
}

/** Los que ya tienen ficha pero nadie ha analizado. */
export const sinAnalizar = (cs: Candidato[]) =>
  cs.filter(c => !(c as any).analisis_at && (c as any).analisis_error == null)

/** Orden de la lista: primero el mejor ajuste; los sin analizar, al final. */
export const porCompatibilidad = <T extends { compatibilidad?: number | null; created_at?: string }>(cs: T[]) =>
  [...cs].sort((a, b) => {
    const x = a.compatibilidad ?? -1, y = b.compatibilidad ?? -1
    if (x !== y) return y - x
    return (b.created_at || '').localeCompare(a.created_at || '')
  })

// ── Motor automático ────────────────────────────────────────────────────────
// Lo que Elias pidió: que al detectar un CV en el correo se cree el candidato
// y se analice solo. Vive aquí (y no en reclutamiento.ts) porque necesita el
// analizador, y al revés sería importación circular.

/** La vacante abierta que mejor corresponde al puesto al que se postuló. */
export function vacanteParaPuesto(puesto: string | null | undefined, vacantes: Vacante[]): Vacante | null {
  const p = (puesto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  if (!p) return null
  const abiertas = vacantes.filter(v => v.estado === 'abierta')
  const pool = abiertas.length ? abiertas : vacantes
  const norm = (s: any) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const exacta = pool.find(v => norm(v.titulo) === p || norm(v.puesto) === p)
  if (exacta) return exacta
  // Por palabras: gana la que comparte más palabras largas con el puesto.
  const palabras = p.split(/\W+/).filter(w => w.length > 3)
  if (!palabras.length) return null
  let mejor: { v: Vacante; n: number } | null = null
  for (const v of pool) {
    const t = norm(v.titulo) + ' ' + norm(v.puesto)
    const n = palabras.filter(w => t.includes(w)).length
    if (n > 0 && (!mejor || n > mejor.n)) mejor = { v, n }
  }
  return mejor?.v || null
}

export interface ResultadoIngesta {
  revisados: number
  importados: number
  analizados: number
  fallos: Array<{ quien: string; error: string }>
  bandeja?: { connected: boolean; reconectar?: boolean; error?: string }
}

/**
 * Correo → candidato → análisis, de corrido.
 *
 * Se llama al abrir Reclutamiento y desde el botón. Es idempotente: importar
 * dos veces el mismo correo no duplica (origen_message_id es único) y solo
 * analiza a quien no tenga veredicto, así que correrlo de más no cuesta nada.
 *
 * Los análisis van de uno en uno a propósito: cada uno manda un PDF completo
 * al modelo, y en paralelo se topa con el límite de tasa justo cuando llegan
 * varios CVs juntos, que es cuando más falta hace que no truene.
 */
export async function ingestaAutomatica(opts: {
  dias?: number
  vacantes: Vacante[]
  buscar: (dias: number) => Promise<{ ok: boolean; connected: boolean; reconectar?: boolean; error?: string; mensajes: any[] }>
  yaImportados: (ids: string[]) => Promise<Set<string>>
  extraer: (correo: any) => Promise<any | null>
  importar: (correo: any, datos: any, vacanteId?: string | null) => Promise<Candidato>
  avance?: (paso: string) => void
}): Promise<ResultadoIngesta> {
  const out: ResultadoIngesta = { revisados: 0, importados: 0, analizados: 0, fallos: [] }
  const di = (s: string) => opts.avance?.(s)

  di('Revisando el correo…')
  const bandeja = await opts.buscar(opts.dias ?? 30)
  out.bandeja = { connected: bandeja.connected, reconectar: bandeja.reconectar, error: bandeja.error }

  if (bandeja.connected && bandeja.mensajes?.length) {
    const ya = await opts.yaImportados(bandeja.mensajes.map((m: any) => m.id))
    const nuevos = bandeja.mensajes.filter((m: any) => !ya.has(m.id))
    out.revisados = nuevos.length
    for (const m of nuevos) {
      try {
        di(`Leyendo la postulación de ${m.asunto?.slice(0, 40) || 'un correo'}…`)
        const datos = await opts.extraer(m)
        if (!datos) { out.fallos.push({ quien: m.asunto || m.id, error: 'No se pudo sacar el nombre del candidato' }); continue }
        const vac = vacanteParaPuesto(datos.puesto, opts.vacantes)
        await opts.importar(m, datos, vac?.id || null)
        out.importados++
      } catch (e: any) {
        out.fallos.push({ quien: m.asunto || m.id, error: e?.message || String(e) })
      }
    }
  }

  // Analizar a todo el que no tenga veredicto, venga de donde venga: los recién
  // importados y los que ya estaban capturados a mano.
  const { data } = await supabase.from('candidatos').select('*').is('analisis_at', null).limit(40)
  const pendientes = ((data as any[]) || []) as Candidato[]
  for (const c of pendientes) {
    di(`Analizando a ${c.nombre}…`)
    const v = opts.vacantes.find(x => x.id === c.vacante_id) || vacanteParaPuesto(c.puesto_solicitado, opts.vacantes)
    const r = await analizarCandidato(c, v || null)
    if (r.ok) out.analizados++
    else out.fallos.push({ quien: c.nombre, error: r.error || 'falló el análisis' })
  }
  di('')
  return out
}
