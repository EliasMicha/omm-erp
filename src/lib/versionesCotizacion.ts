// ═══════════════════════════════════════════════════════════════════════════
// versionesCotizacion — cuál de las versiones de una cotización es LA buena.
//
// El problema que resuelve: una cotización puede tener varias versiones (A, B,
// V2, 2.0…) que comparten `version_group_id`. Son la MISMA venta, no ventas
// distintas. Pero cada módulo decidía por su cuenta cuál mirar:
//
//   · Cotizaciones mostraba "la última que tocaste en esta sesión" — una
//     heurística de pantalla, distinta para cada usuario y cada refresh.
//   · Cobranza, Finanzas y los tableros sumaban TODAS las que estuvieran en
//     contrato: Casa Cúspide tiene dos versiones en contrato, así que ese
//     ingreso se contaba dos veces.
//   · Obra y Entregas listaban las cinco versiones de Reserva Santa Fe como si
//     fueran cinco cotizaciones que se pueden ligar a una obra.
//
// La respuesta ahora es un dato, no una corazonada: `quotations.vigente`. Hay
// exactamente una vigente por grupo (índice único en la base) y es la versión
// en la que se quedó el proyecto. Todo el ERP lee de ahí.
//
// Este archivo existe para que nadie vuelva a inventar su propia regla.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'

/** Avance en el embudo. Sirve para proponer una vigente, no para imponerla. */
export const ORDEN_ETAPA: Record<string, number> = {
  contrato: 4,
  propuesta: 3,
  estimacion: 2,
  oportunidad: 1,
  perdida: 0,
}

export interface CotVersionable {
  id: string
  version_group_id?: string | null
  version_label?: string | null
  stage?: string | null
  vigente?: boolean | null
  updated_at?: string | null
  created_at?: string | null
  archived_at?: string | null
}

/**
 * Filtra una lista de cotizaciones dejando solo la versión vigente de cada
 * grupo. Úsalo en TODA lista, conteo o suma: tableros, cobranza, finanzas,
 * selectores de cotización, reportes.
 *
 * Las que no pertenecen a ningún grupo pasan tal cual: son su propia versión.
 *
 * Si por lo que sea un grupo no trae ninguna marcada (datos viejos, una
 * importación), se elige la más avanzada del embudo para no perder la fila.
 */
export function soloVigentes<T extends CotVersionable>(cots: T[]): T[] {
  const porGrupo = new Map<string, T[]>()
  const sueltas: T[] = []
  for (const c of cots) {
    const g = c.version_group_id
    if (!g) { sueltas.push(c); continue }
    const arr = porGrupo.get(g)
    if (arr) arr.push(c); else porGrupo.set(g, [c])
  }
  const elegidas: T[] = []
  porGrupo.forEach(grupo => {
    const marcada = grupo.find(c => c.vigente === true)
    elegidas.push(marcada || proponerVigente(grupo))
  })
  return [...sueltas, ...elegidas]
}

/**
 * Cuál DEBERÍA ser la vigente de un grupo si nadie la ha marcado: la más
 * avanzada del embudo y, a igual etapa, la última que se movió. Las archivadas
 * y las perdidas solo ganan si no hay nada más.
 */
export function proponerVigente<T extends CotVersionable>(grupo: T[]): T {
  return [...grupo].sort((a, b) => {
    const ra = a.archived_at ? -1 : (ORDEN_ETAPA[String(a.stage || '')] ?? 0)
    const rb = b.archived_at ? -1 : (ORDEN_ETAPA[String(b.stage || '')] ?? 0)
    if (ra !== rb) return rb - ra
    const ua = String(a.updated_at || a.created_at || '')
    const ub = String(b.updated_at || b.created_at || '')
    return ub.localeCompare(ua)
  })[0]
}

/** ¿Esta cotización es la que manda? */
export function esVigente(c: CotVersionable): boolean {
  if (!c.version_group_id) return true
  return c.vigente === true
}

/** Las columnas mínimas que hay que traer para poder filtrar por vigencia. */
export const COLS_VERSION = 'version_group_id,version_label,vigente'

/**
 * Marca una versión como la vigente de su grupo y baja a las demás.
 * El índice único de la base no permite dos vigentes, así que primero se
 * apagan las hermanas y luego se prende ésta.
 */
export async function marcarVigente(cotId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: cot, error: e0 } = await supabase
    .from('quotations').select('id,version_group_id').eq('id', cotId).maybeSingle()
  if (e0) return { ok: false, error: e0.message }
  if (!cot) return { ok: false, error: 'No encontré esa cotización.' }

  const gid = (cot as any).version_group_id
  if (!gid) return { ok: true } // sin versiones: ya es la única

  const { error: e1 } = await supabase.from('quotations')
    .update({ vigente: false }).eq('version_group_id', gid).neq('id', cotId)
  if (e1) return { ok: false, error: e1.message }

  const { error: e2 } = await supabase.from('quotations')
    .update({ vigente: true }).eq('id', cotId)
  if (e2) return { ok: false, error: e2.message }
  return { ok: true }
}

/**
 * Trae los ids de las versiones NO vigentes. Sirve para las consultas que
 * filtran del lado del servidor y no pueden traerse el grupo completo.
 */
export async function idsNoVigentes(): Promise<string[]> {
  const { data } = await supabase.from('quotations')
    .select('id').eq('vigente', false)
  return ((data as any[]) || []).map(r => r.id)
}

/** Etiqueta corta para la UI: «V2 · vigente» o «A · histórica». */
export function etiquetaVersion(c: CotVersionable): { texto: string; vigente: boolean } | null {
  if (!c.version_group_id) return null
  const v = c.vigente === true
  return { texto: `${c.version_label || '?'} · ${v ? 'vigente' : 'histórica'}`, vigente: v }
}

// ═══════════════════════════════════════════════════════════════════════════
// Qué cotizaciones se pueden ELEGIR (no es lo mismo que cuáles existen)
//
// En conciliación se amarra dinero real a una cotización. Ahí no cabe todo:
//   · Una cotización archivada ("borrada") no debe volver a aparecer en una
//     lista. Contabilidad lee con `supabaseAll` a propósito —para que el dinero
//     histórico siga cuadrando— y por eso las archivadas se le colaban a los
//     selectores. El filtro tiene que ser explícito aquí.
//   · Una estimación o una propuesta perdida no es una venta: amarrarle un
//     pago ensucia el estado de cuenta del proyecto. Solo el CONTRATO manda.
//
// La única excepción es la cotización a la que el movimiento YA está amarrado:
// esa se deja en la lista aunque no cumpla, porque si desaparece el usuario ve
// un campo vacío y no entiende a qué estaba ligado su movimiento.
// ═══════════════════════════════════════════════════════════════════════════

export interface CotElegible extends CotVersionable {
  name?: string | null
}

/** Un contrato vivo: en etapa contrato, no archivado y versión vigente. */
export function esContratoVivo(c: CotElegible): boolean {
  if (c.archived_at) return false
  if (String(c.stage || '') !== 'contrato') return false
  return esVigente(c)
}

/** No archivada. El mínimo que debe cumplir cualquier lista operativa. */
export function noArchivada<T extends { archived_at?: string | null }>(cots: T[]): T[] {
  return cots.filter(c => !c.archived_at)
}

/**
 * Las opciones válidas para amarrar dinero. `actualId` es la cotización a la
 * que el movimiento ya está ligado: se conserva siempre para no dejar al
 * usuario mirando un campo en blanco.
 */
export function paraConciliar<T extends CotElegible>(cots: T[], actualId?: string | null): T[] {
  return cots.filter(c => esContratoVivo(c) || (!!actualId && c.id === actualId))
}

/** Marca las que están en la lista solo por ser el vínculo actual. */
export function etiquetaElegible(c: CotElegible): string {
  if (esContratoVivo(c)) return ''
  if (c.archived_at) return ' · ARCHIVADA'
  return ` · ${String(c.stage || 'sin etapa')}`
}
