// ═══════════════════════════════════════════════════════════════════════════
// sistemasVendidos — qué partidas de una cotización SÍ se vendieron.
//
// En el cotizador de especiales se puede apagar un sistema completo para que
// NO sume al total. Eso no es un detalle de presentación: significa que ese
// sistema no se vendió. Puede venderse después — se vuelve a prender y ya —
// pero mientras esté apagado no hay que comprarle nada.
//
// El módulo de Compras no lo sabía: al levantar una OC desde la cotización
// ofrecía los 27 productos, incluidos los de los sistemas apagados. Comprar de
// más es dinero parado en bodega de algo que el cliente nunca pidió.
//
// La lista de sistemas apagados vive en `quotations.notes.systems_no_suma`
// como IDs internos ('cctv', 'control_iluminacion', 'custom_video'), mientras
// que `quotation_items.system` guarda la etiqueta del enum de la base
// ('CCTV', 'Control de iluminacion', 'General'). Aquí se traduce entre las dos.
// ═══════════════════════════════════════════════════════════════════════════

/** id de sistema → etiqueta del enum `product_system` en la base. */
const SYSTEM_DB_NAME: Record<string, string> = {
  audio: 'Audio',
  redes: 'Redes',
  cctv: 'CCTV',
  control_acceso: 'Control de acceso',
  control_iluminacion: 'Control de iluminacion',
  deteccion_humo: 'Humo',
  bms: 'BMS',
  telefonia: 'Telefonia',
  red_celular: 'Celular',
  lutron_hwqs: 'Lutron',
  lutron: 'Lutron',
  somfy: 'Somfy',
  electrico: 'Electrico',
  cortinas: 'Cortinas',
  general: 'General',
}

/** Los sistemas que el usuario creó a mano se guardan como 'General' en el
 *  enum; su id real viaja en las notas del renglón. */
function customSysIdDeItem(notes: string | null | undefined): string | null {
  try {
    const m = JSON.parse(notes || '{}')
    return typeof m?.customSystemId === 'string' ? m.customSystemId : null
  } catch { return null }
}

export function sistemasApagados(notasCotizacion: string | null | undefined): string[] {
  try {
    const m = JSON.parse(notasCotizacion || '{}')
    return Array.isArray(m?.systems_no_suma) ? m.systems_no_suma.filter((x: any) => typeof x === 'string') : []
  } catch { return [] }
}

/**
 * Quita de una lista de `quotation_items` los que pertenecen a un sistema
 * apagado (no suma = no vendido). Si la cotización no tiene sistemas apagados
 * devuelve la lista intacta.
 *
 * Prudencia deliberada con las etiquetas repetidas: 'lutron' y 'lutron_hwqs'
 * comparten la etiqueta 'Lutron' en la base, así que solo se excluye por
 * etiqueta cuando TODOS los ids que la comparten están apagados. Ante la duda
 * se deja pasar el renglón: es preferible ofrecer de más en la OC — que se
 * puede desmarcar — que esconder algo que sí había que comprar.
 */
export function soloSistemasVendidos<T extends { system?: string | null; notes?: string | null }>(
  items: T[],
  notasCotizacion: string | null | undefined,
): T[] {
  const apagados = sistemasApagados(notasCotizacion)
  if (apagados.length === 0) return items

  const apagadosSet = new Set(apagados)
  const customApagados = new Set(apagados.filter(id => id.startsWith('custom_')))

  // Etiquetas del enum que quedan totalmente apagadas
  const etiquetasApagadas = new Set<string>()
  for (const [id, etiqueta] of Object.entries(SYSTEM_DB_NAME)) {
    if (!apagadosSet.has(id)) continue
    const hermanos = Object.entries(SYSTEM_DB_NAME).filter(([, e]) => e === etiqueta).map(([i]) => i)
    if (hermanos.every(h => apagadosSet.has(h))) etiquetasApagadas.add(etiqueta)
  }

  return items.filter(it => {
    const customId = customSysIdDeItem(it.notes)
    // Renglón de un sistema hecho a la medida: manda su propio id.
    if (customId) return !customApagados.has(customId)
    return !etiquetasApagadas.has(String(it.system || ''))
  })
}

/** Cuántos renglones se dejaron fuera — para poder decírselo al usuario. */
export function contarApagados<T extends { system?: string | null; notes?: string | null }>(
  items: T[],
  notasCotizacion: string | null | undefined,
): number {
  return items.length - soloSistemasVendidos(items, notasCotizacion).length
}
