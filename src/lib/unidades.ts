/**
 * UNIDADES DE MEDIDA — normalización y totales
 * ────────────────────────────────────────────────────────────────────────────
 *
 * El mismo material está capturado con la unidad escrita de cinco maneras
 * distintas, según quién la tecleó y desde dónde: en `po_items` conviven
 * "pza", "PIEZA", "pieza"; "MTS" con "m", "ml" y "Metro"; "ROLLO" con "rollo".
 * Mientras eso se sume como si fuera lo mismo, un recibo de obra dice
 * "Total de piezas: 682" cuando en realidad iban 400 metros de cable, 260
 * piezas y 6 rollos de cinta. Ese número no le sirve a nadie: ni al chofer
 * para contar la camioneta, ni a quien firma en obra.
 *
 * Aquí se normaliza la escritura (no la unidad física: un metro nunca se
 * convierte a piezas) y se totaliza POR UNIDAD.
 *
 * Sobre "ml": en obra en México significa METRO LINEAL, no mililitro. En este
 * catálogo son cables, tubería y charola, así que se colapsa con "m". Si
 * alguna vez entra un producto que de verdad se mida en mililitros, hay que
 * capturarlo como "mililitro" y agregarlo abajo como unidad propia.
 */

/** Escrituras conocidas → unidad canónica. Todo en minúsculas y sin acentos. */
const SINONIMOS: Record<string, string> = {
  pza: 'pza', pz: 'pza', pzs: 'pza', pzas: 'pza', pieza: 'pza', piezas: 'pza', pieza_s: 'pza', unidad: 'pza', unidades: 'pza', und: 'pza', u: 'pza',
  m: 'm', mt: 'm', mts: 'm', ml: 'm', mls: 'm', metro: 'm', metros: 'm', 'metro lineal': 'm', 'metros lineales': 'm',
  rollo: 'rollo', rollos: 'rollo',
  caja: 'caja', cajas: 'caja', cja: 'caja',
  bolsa: 'bolsa', bolsas: 'bolsa',
  lote: 'lote', lotes: 'lote',
  servicio: 'servicio', servicios: 'servicio', serv: 'servicio',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg',
  lt: 'lt', lts: 'lt', l: 'lt', litro: 'lt', litros: 'lt',
  tramo: 'tramo', tramos: 'tramo',
  juego: 'juego', juegos: 'juego', jgo: 'juego', jgos: 'juego',
  par: 'par', pares: 'par',
  m2: 'm2', 'm²': 'm2',
  m3: 'm3', 'm³': 'm3',
}

/** Plural para el renglón de totales. Las abreviaturas métricas no se pluralizan. */
const PLURAL: Record<string, string> = {
  pza: 'pzas', m: 'm', rollo: 'rollos', caja: 'cajas', bolsa: 'bolsas', lote: 'lotes',
  servicio: 'servicios', kg: 'kg', lt: 'lt', tramo: 'tramos', juego: 'juegos', par: 'pares',
  m2: 'm2', m3: 'm3',
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Deja la unidad en una sola escritura. Lo que no reconoce se respeta tal cual
 * (en minúsculas): más vale un recibo que diga "3 charolas" que uno que las
 * convierta en piezas por no tenerlas en la lista.
 */
export function unidadCanonica(raw: any): string {
  const s = sinAcentos(String(raw ?? '').trim().toLowerCase()).replace(/\.+$/, '').replace(/\s+/g, ' ')
  if (!s) return 'pza'
  return SINONIMOS[s] || s
}

export function etiquetaUnidad(u: string, cantidad: number): string {
  const c = unidadCanonica(u)
  if (Math.abs(cantidad) === 1) return c
  return PLURAL[c] || (c.endsWith('s') ? c : c + 's')
}

const fmt = (n: number) => Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })

/**
 * Suma las cantidades agrupadas por unidad. Devuelve el orden en que van a
 * leerse: primero la unidad con más renglones distintos, que es la que domina
 * la entrega.
 */
export function totalesPorUnidad(items: Array<{ qty?: any; unidad?: any; unit?: any }>): Array<{ unidad: string; cantidad: number; renglones: number }> {
  const map = new Map<string, { unidad: string; cantidad: number; renglones: number }>()
  for (const it of items || []) {
    const u = unidadCanonica(it?.unidad ?? it?.unit)
    const q = Number(it?.qty) || 0
    const cur = map.get(u)
    if (cur) { cur.cantidad += q; cur.renglones += 1 }
    else map.set(u, { unidad: u, cantidad: q, renglones: 1 })
  }
  return Array.from(map.values()).sort((a, b) => b.renglones - a.renglones || a.unidad.localeCompare(b.unidad))
}

/** "400 m · 260 pzas · 6 rollos" — para el pie del recibo. */
export function resumenUnidades(items: Array<{ qty?: any; unidad?: any; unit?: any }>): string {
  return totalesPorUnidad(items).map(t => `${fmt(t.cantidad)} ${etiquetaUnidad(t.unidad, t.cantidad)}`).join('  ·  ')
}
