// ─────────────────────────────────────────────────────────────────────────────
//  Cargos adicionales de una cotizacion — envio, viaticos, maniobras, etc.
//
//  Cada cargo trae DOS numeros: lo que se le cobra al cliente y lo que nos
//  cuesta a nosotros. Un envio de $5,000 que cuesta $5,000 no es utilidad, y
//  registrar solo el cobro hacia subir el MG Real como si lo fuera.
//
//  Viven en la raiz de `quotations.notes` (junto a currency y tipoCambio),
//  que es donde el PDF ya busca la configuracion. Este archivo es el UNICO
//  lugar donde se suman: el editor y el PDF llaman a las mismas funciones,
//  para que el total de pantalla y el del PDF no puedan discrepar.
//
//  Posicion en la suma: DESPUES del descuento y ANTES del IVA. El descuento se
//  negocia sobre el material; el envio se cobra completo y causa IVA.
// ─────────────────────────────────────────────────────────────────────────────

export interface Cargo {
  id: string
  concepto: string
  /** Lo que se le cobra al cliente, en la moneda de venta de la cotizacion. */
  monto: number
  /** Lo que nos cuesta. 0 = es utilidad pura (una comision, por ejemplo). */
  costo: number
}

/** Sugerencias del campo concepto. No limitan: el campo es libre. */
export const CONCEPTOS_SUGERIDOS = [
  'Envío / flete',
  'Viáticos',
  'Maniobras de descarga',
  'Instalación en sitio',
  'Puesta en marcha',
  'Almacenaje',
  'Seguro de traslado',
]

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** Lee los cargos de `notes`. Acepta el objeto ya parseado o el string crudo. */
export function leerCargos(notes: any): Cargo[] {
  let m: any = notes
  if (typeof notes === 'string') { try { m = JSON.parse(notes || '{}') } catch { return [] } }
  const raw = m?.cargos
  if (!Array.isArray(raw)) return []
  return raw
    .map((c: any, i: number) => ({
      id: String(c?.id || 'c' + i),
      concepto: String(c?.concepto || '').trim(),
      monto: Number(c?.monto) || 0,
      costo: Number(c?.costo) || 0,
    }))
    // Un cargo sin concepto y sin monto es basura de captura; no debe salir en
    // el PDF del cliente.
    .filter(c => c.concepto !== '' || c.monto !== 0)
}

export function sumaCargos(cargos: Cargo[]): { monto: number; costo: number } {
  return {
    monto: r2(cargos.reduce((s, c) => s + (Number(c.monto) || 0), 0)),
    costo: r2(cargos.reduce((s, c) => s + (Number(c.costo) || 0), 0)),
  }
}

export interface Totales {
  subtotal: number
  descuentoAmt: number
  subtotalConDescuento: number
  cargos: number
  baseGravable: number
  iva: number
  total: number
}

/**
 * La cadena de totales, en un solo lugar.
 *   subtotal − descuento + cargos = base gravable → + IVA = total
 */
export function calcularTotales(
  subtotal: number,
  descuentoPct: number,
  ivaPct: number,
  cargosMonto: number,
): Totales {
  const sub = r2(subtotal)
  const descuentoAmt = r2(sub * (Number(descuentoPct) || 0) / 100)
  const subtotalConDescuento = r2(sub - descuentoAmt)
  const cargos = r2(cargosMonto)
  const baseGravable = r2(subtotalConDescuento + cargos)
  const iva = r2(baseGravable * (Number(ivaPct) || 0) / 100)
  return {
    subtotal: sub, descuentoAmt, subtotalConDescuento, cargos, baseGravable, iva,
    total: r2(baseGravable + iva),
  }
}

/**
 * MG Real incluyendo los cargos.
 *
 * La nomina se calcula SOLO sobre la venta de productos, no sobre los cargos:
 * cargarle 20% de nomina a un flete que se traslada al costo lo convertiria en
 * una perdida inventada. Un cargo aporta al margen exactamente la diferencia
 * entre lo que se cobra y lo que cuesta, ni mas ni menos.
 */
export function margenReal(opts: {
  ventaProductos: number
  costoProductos: number
  descuentoPct: number
  nominaPct: number
  cargosMonto: number
  cargosCosto: number
}): { revenue: number; costo: number; nomina: number; utilidad: number; pct: number } {
  const descFactor = 1 - (Number(opts.descuentoPct) || 0) / 100
  const ventaBilled = opts.ventaProductos * descFactor
  const nomina = ventaBilled * (Number(opts.nominaPct) || 0) / 100
  const revenue = ventaBilled + opts.cargosMonto
  const costo = opts.costoProductos + opts.cargosCosto
  const utilidad = revenue - costo - nomina
  return {
    revenue: r2(revenue), costo: r2(costo), nomina: r2(nomina), utilidad: r2(utilidad),
    pct: revenue > 0 ? Math.round((utilidad / revenue) * 1000) / 10 : 0,
  }
}

/**
 * Cuanto hay que escalar el precio de los productos para que el MG Real llegue
 * a `target`, con los cargos ya dentro.
 *
 *   (R + Cm − K − Cc − nR) = t(R + Cm)   →   R = (K + Cc − Cm(1−t)) / (1 − n − t)
 *
 * R es la venta de productos YA con descuento; de ahi se regresa a listprice.
 * Con cargos en cero se reduce a R = K/(1−n−t), la formula de siempre.
 *
 * Devuelve null cuando no hay solucion: los cargos ya dan de sobra para el
 * target y la respuesta seria bajar los productos a un precio negativo.
 */
export function escalaParaMargen(opts: {
  ventaProductos: number
  costoProductos: number
  descuentoPct: number
  nominaPct: number
  cargosMonto: number
  cargosCosto: number
  targetPct: number
}): { escala: number; motivo?: string } | null {
  const t = (Number(opts.targetPct) || 0) / 100
  const n = (Number(opts.nominaPct) || 0) / 100
  const denom = 1 - n - t
  if (denom <= 0) return null
  const descFactor = 1 - (Number(opts.descuentoPct) || 0) / 100
  if (descFactor <= 0) return null
  const R = (opts.costoProductos + opts.cargosCosto - opts.cargosMonto * (1 - t)) / denom
  if (R <= 0) return { escala: 0, motivo: 'cargos_cubren_target' }
  const nuevaVentaListprice = R / descFactor
  if (opts.ventaProductos <= 0) return null
  return { escala: nuevaVentaListprice / opts.ventaProductos }
}
