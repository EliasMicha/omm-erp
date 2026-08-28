/**
 * MONEDAS — la regla única del ERP
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Hay exactamente dos monedas en juego y NO son la misma cosa:
 *
 *   MONEDA DE COSTO   → la dicta el CATÁLOGO (`catalog_products.moneda`).
 *                       Es la moneda en la que el proveedor nos factura. Si
 *                       Illux nos vende en pesos, ese costo es en pesos hoy,
 *                       mañana y en cualquier cotización. NO SE MUEVE NUNCA.
 *
 *   MONEDA DE VENTA   → la dicta la COTIZACIÓN (`notes.currency`). Es en la
 *                       que le cobramos al cliente y cambia de un trato a otro.
 *
 * La conversión ocurre en UN SOLO PUNTO: al calcular el precio de venta de un
 * producto dentro de una cotización, con el tipo de cambio pactado de ESA
 * cotización (`notes.tipoCambio`). Nunca al revés, y nunca sobre el costo.
 *
 * De ahí se desprende la regla de compras: la orden de compra se emite en la
 * moneda del COSTO registrado, no en la de la cotización. Un producto costeado
 * en pesos se compra en pesos aunque se haya vendido en dólares. Y una OC
 * jamás mezcla pesos con dólares: si una cotización trae de las dos, salen dos
 * órdenes.
 *
 * ── Por qué existe este archivo ─────────────────────────────────────────────
 *
 * El mismo algoritmo de conversión estaba copiado seis veces (dos en ESP, dos
 * en Dashboard, una en MaintQuotes, una en Contabilidad), cada una con su
 * propio default cuando faltaba la moneda: unos asumían USD y otros MXN. Una
 * cotización sin moneda se contaba como USD en Cobranza y como MXN en
 * Dashboard AL MISMO TIEMPO. Aquí hay una sola implementación y un solo
 * default, y se dice cuál es y por qué.
 */

export type Moneda = 'MXN' | 'USD'

/**
 * Default cuando el dato no trae moneda: MXN.
 *
 * Es el default del alta de producto en el catálogo (`Catalogo.tsx`) y el de
 * la contabilidad. Asumir USD donde había pesos multiplica el número por ~18;
 * asumir pesos donde había dólares lo divide. De los dos errores, el segundo
 * se nota de inmediato (el precio sale ridículamente bajo) y el primero se
 * cuela hasta la factura. Se prefiere el error ruidoso.
 */
export const MONEDA_DEFAULT: Moneda = 'MXN'

/** Acepta 'usd', 'USD $', 'DLL', 'dolares', 'pesos', 'MX$'… y devuelve una de las dos. */
export function normalizarMoneda(raw: any, porDefecto: Moneda = MONEDA_DEFAULT): Moneda {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!s) return porDefecto
  if (s.includes('USD') || s.includes('DLL') || s.includes('DOLAR') || s.includes('DÓLAR') || s === 'US$' || s === 'U$D') return 'USD'
  if (s.includes('MXN') || s.includes('PESO') || s === 'MX$' || s === '$') return 'MXN'
  return porDefecto
}

/** La moneda en la que el proveedor nos factura este producto. */
export function monedaDeCosto(catProd: any, porDefecto: Moneda = MONEDA_DEFAULT): Moneda {
  return normalizarMoneda(catProd?.moneda ?? catProd?.provider_currency, porDefecto)
}

export class TipoCambioFaltante extends Error {
  constructor(public de: Moneda, public a: Moneda) {
    super(`Este producto está costeado en ${de} y la cotización es en ${a}, pero la cotización no tiene tipo de cambio. Captura el TC arriba antes de agregarlo.`)
    this.name = 'TipoCambioFaltante'
  }
}

/**
 * Convierte un monto entre las dos monedas. `tc` son PESOS POR UN DÓLAR.
 *
 * Si hace falta convertir y no hay TC válido, REVIENTA en vez de devolver el
 * monto sin tocar. Devolverlo tal cual era el comportamiento anterior y es
 * justo lo que producía cotizaciones con precios en pesos etiquetados como
 * dólares: un error silencioso de 18x que nadie veía hasta la factura.
 */
export function convertir(monto: number, de: Moneda, a: Moneda, tc: number): number {
  const m = Number(monto) || 0
  if (de === a) return m
  const t = Number(tc) || 0
  if (t <= 0) throw new TipoCambioFaltante(de, a)
  const r = de === 'USD' ? m * t : m / t
  return Math.round(r * 100) / 100
}

/** Como `convertir`, pero sin reventar: si falta el TC devuelve null. */
export function convertirSiSePuede(monto: number, de: Moneda, a: Moneda, tc: number): number | null {
  try { return convertir(monto, de, a, tc) } catch { return null }
}

/**
 * El precio de lista del producto EN SU MONEDA NATIVA, antes de convertir.
 *
 * Se prefiere `precio_venta` capturado; si no hay, se calcula desde el costo
 * con el margen del catálogo. Ojo con la fórmula: `markup` en este ERP es
 * MARGEN sobre precio (costo / (1 - m/100)), no recargo sobre costo. Estaba
 * implementada de las dos maneras en archivos distintos — en MaintQuotes como
 * `cost * (1 + markup)`, que con markup = 35 multiplicaba el costo por 36.
 */
export function precioNativo(catProd: any): number {
  const pv = Number(catProd?.precio_venta) || 0
  if (pv > 0) return pv
  const costo = Number(catProd?.cost) || 0
  const margen = Number(catProd?.markup) || 0
  if (costo <= 0) return 0
  if (margen <= 0 || margen >= 100) return costo
  return Math.round(costo / (1 - margen / 100) * 100) / 100
}

/**
 * Lo que hay que guardar en `quotation_items` al meter un producto del
 * catálogo a una cotización. Es EL punto donde se cruza la moneda:
 *
 *   precio  → convertido a la moneda de la cotización (lo que ve el cliente)
 *   costo   → intacto, en la moneda del proveedor (lo que va a la OC)
 *   monedaCosto → se guarda en `quotation_items.provider_currency` para que
 *                 Compras sepa en qué moneda emitir la orden
 *
 * Que costo y precio queden en monedas distintas en la misma fila es
 * deliberado. Cualquier cálculo que reste precio − costo tiene que convertir
 * primero: para eso está `margenReal`.
 */
export function renglonDeCatalogo(catProd: any, monedaCotizacion: Moneda, tc: number, opts?: { precioOverride?: number; margenOverride?: number }): {
  precio: number
  costo: number
  monedaCosto: Moneda
  margen: number
  convertido: boolean
} {
  const monedaCosto = monedaDeCosto(catProd)
  const costo = Number(catProd?.cost) || 0
  const base = opts?.precioOverride != null && opts.precioOverride > 0
    ? Number(opts.precioOverride)
    : precioNativo(catProd)
  const precio = convertir(base, monedaCosto, monedaCotizacion, tc)
  const margen = opts?.margenOverride != null
    ? Number(opts.margenOverride)
    : (base > 0 && costo > 0 ? Math.round((1 - costo / base) * 100) : (Number(catProd?.markup) || 0))
  return { precio, costo, monedaCosto, margen, convertido: monedaCosto !== monedaCotizacion }
}

/**
 * Margen real de un renglón cuyo costo y precio están en monedas distintas.
 * Devuelve null si haría falta un TC y no hay: mejor no mostrar margen que
 * mostrar uno inventado.
 */
export function margenReal(precio: number, monedaPrecio: Moneda, costo: number, monedaCosto: Moneda, tc: number): number | null {
  const p = Number(precio) || 0
  if (p <= 0) return null
  const c = convertirSiSePuede(Number(costo) || 0, monedaCosto, monedaPrecio, tc)
  if (c === null) return null
  return Math.round((1 - c / p) * 100)
}

/**
 * Parte una lista de renglones por moneda de costo. Es lo que usa Compras para
 * no emitir nunca una OC con pesos y dólares revueltos.
 */
export function separarPorMonedaDeCosto<T>(renglones: T[], monedaDe: (r: T) => any): Array<{ moneda: Moneda; renglones: T[] }> {
  const grupos = new Map<Moneda, T[]>()
  for (const r of renglones) {
    const m = normalizarMoneda(monedaDe(r))
    const arr = grupos.get(m)
    if (arr) arr.push(r); else grupos.set(m, [r])
  }
  return (['MXN', 'USD'] as Moneda[]).filter(m => grupos.has(m)).map(m => ({ moneda: m, renglones: grupos.get(m)! }))
}

/** Símbolo para textos armados a mano (los formateadores viven en utils.ts). */
export const simbolo = (m: Moneda) => (m === 'USD' ? 'US$' : '$')
