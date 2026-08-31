/**
 * CONDICIONES COMERCIALES DE UNA COTIZACIÓN — dónde vive el descuento
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El descuento pactado con el cliente es UN solo hecho, pero cada cotizador lo
 * guardó en un lugar distinto dentro de `quotations.notes`:
 *
 *   esp, elec →  notes.descuento              (raíz)
 *   ilum      →  notes.ilumConfig.descuento
 *   proy      →  notes.proyConfig.descuento
 *   cort      →  notes.cortConfig.descuento
 *   dist      →  notes.distConfig.descuentoPct   ← y encima con otro nombre
 *
 * Quien leía sólo `notes.descuento` veía "esta cotización no tiene descuento"
 * en una orden de distribución con 37% pactado. Fue exactamente el caso de
 * "Manuel Casas - Lutron - Orden Julio": $825,890.94 de lista contra
 * $617,931.88 cobrados, y el sistema decía que no había descuento.
 *
 * Aquí se lee de los cinco lugares. Cualquier módulo que necesite el descuento
 * de una cotización debe usar esto y no volver a leer `notes` a mano.
 *
 * ── Cargos que SÍ suman (sólo Distribución) ─────────────────────────────────
 * Distribución agrega fletes y un factor de importación DESPUÉS del descuento.
 * Son parte de lo que paga el cliente, así que quien quiera reconstruir el
 * total de la cotización tiene que sumarlos.
 */

export interface CondicionesCotizacion {
  descuentoPct: number
  ivaPct: number
  currency: string
  /** Monto fijo de fletes (Distribución). */
  fletes: number
  /** % de factor de importación sobre el subtotal YA con descuento (Distribución). */
  factorImportPct: number
}

const nz = (v: any, def: number) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? def : Number(v))

/** Acepta el JSON de `quotations.notes` en texto o ya parseado. */
export function condicionesDeCotizacion(notes: any): CondicionesCotizacion {
  let m: any = {}
  if (typeof notes === 'string') { try { m = JSON.parse(notes || '{}') } catch { m = {} } }
  else if (notes && typeof notes === 'object') m = notes

  const dist = m.distConfig || {}
  const ilum = m.ilumConfig || {}
  const proy = m.proyConfig || {}
  const cort = m.cortConfig || {}

  // El primero que exista gana. El orden importa poco porque una cotización
  // sólo trae la config de su propio cotizador, pero se deja explícito.
  const primero = (...vals: any[]) => {
    for (const v of vals) if (v !== null && v !== undefined && v !== '' && !isNaN(Number(v))) return Number(v)
    return 0
  }

  return {
    descuentoPct: Math.abs(primero(m.descuento, dist.descuentoPct, ilum.descuento, proy.descuento, cort.descuento)),
    ivaPct: primero(m.ivaRate, dist.ivaRate, ilum.ivaRate, proy.ivaRate, cort.ivaRate) || 16,
    currency: String(m.currency || dist.currency || proy.currency || cort.currency || 'MXN').toUpperCase() === 'USD' ? 'USD' : 'MXN',
    fletes: nz(dist.fletes, 0),
    factorImportPct: nz(dist.factorImport, 0),
  }
}

/**
 * Reconstruye lo que se le cobra al cliente, partiendo de la suma de los
 * precios de LISTA de los renglones.
 *
 * `sumaLista` es Σ(precio × cantidad) tal como están guardados los renglones:
 * en todos los cotizadores `quotation_items.price` es el precio ANTES del
 * descuento (en Distribución es literalmente el "precio público").
 */
export function reconstruirCobro(sumaLista: number, c: CondicionesCotizacion) {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const descuento = r2(sumaLista * (c.descuentoPct / 100))
  const subtotalConDesc = r2(sumaLista - descuento)
  const factorImportMonto = r2(subtotalConDesc * (c.factorImportPct / 100))
  const cargos = r2(c.fletes + factorImportMonto)
  const baseGravable = r2(subtotalConDesc + cargos)
  const iva = r2(baseGravable * (c.ivaPct / 100))
  return { descuento, subtotalConDesc, factorImportMonto, cargos, baseGravable, iva, total: r2(baseGravable + iva) }
}

/**
 * El factor que hay que aplicarle a cada precio de lista para que la suma de
 * los renglones dé exactamente la base gravable de la cotización.
 *
 * Mete el descuento Y los cargos en el mismo número a propósito: así la
 * factura sale con un solo renglón por producto, sin línea de descuento ni de
 * fletes, y aun así cuadra al centavo con lo pactado.
 */
export function factorNetoDeCobro(sumaLista: number, c: CondicionesCotizacion): number {
  if (!(sumaLista > 0)) return 1
  return reconstruirCobro(sumaLista, c).baseGravable / sumaLista
}
