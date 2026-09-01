/**
 * IVA de las órdenes de compra — al centavo, no a pesos enteros
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Estaba escrito `Math.round(subtotal * 0.16)` en seis lugares. `Math.round`
 * sin dividir redondea a PESOS ENTEROS: un subtotal de $35,171.00 daba
 * $5,627.00 de IVA en vez de $5,627.36, y el total de la orden salía 36
 * centavos abajo de lo que factura el proveedor. En una orden grande la
 * diferencia llega a medio peso, y cuando se concilia contra la factura no
 * cuadra por un importe que nadie encuentra.
 *
 * Aquí se redondea a dos decimales, que es como se factura.
 */

/** Tasa de IVA de compras nacionales. Las órdenes de SERVICIO no llevan. */
export const TASA_IVA_COMPRA = 0.16

export const redondearCentavos = (n: any) => Math.round((Number(n) || 0) * 100) / 100

/**
 * IVA de una orden de compra.
 * `tipo === 'servicio'` (destajo, mano de obra) no causa IVA.
 */
export function ivaDeOrden(subtotal: any, tipo?: string | null): number {
  if (tipo === 'servicio') return 0
  return redondearCentavos((Number(subtotal) || 0) * TASA_IVA_COMPRA)
}
