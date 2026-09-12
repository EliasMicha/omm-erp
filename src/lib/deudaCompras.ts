import { ivaDeOrden, redondearCentavos } from './ivaCompra'

// ─────────────────────────────────────────────────────────────────────────────
//  Cuanto se le debe a los proveedores.
//
//  El tablero de Compras mostraba "Pendiente" = suma de `total` de las ordenes
//  que no estaban recibidas ni canceladas. Eso no era la deuda por tres
//  razones, y las tres empujaban el numero hacia arriba:
//
//    1. Ignoraba los pagos. La mayoria de las OC ya estan pagadas: en MXN,
//       "pedida" suma 648,416 ordenados contra 630,769 pagados — la deuda real
//       de ese grupo son 17,648, no 648,416.
//    2. Usaba `purchase_orders.total`, el total de catalogo, en vez del
//       cotejado + extras, que es lo que de verdad se va a pagar.
//    3. EXCLUIA las recibidas. Al reves: recibir el material no borra la
//       deuda, la confirma. Una OC recibida y no pagada es la deuda mas
//       exigible que hay.
//
//  Aqui vive la aritmetica, una sola vez, para que la lista y el tablero no
//  puedan decir dos numeros distintos.
// ─────────────────────────────────────────────────────────────────────────────

export interface OCParaDeuda {
  id: string
  status: string
  currency: 'MXN' | 'USD' | string
  total: number
  tipo?: string | null
  extras?: any
}

/** Resumen de cotejo por OC: subtotal de partidas con lo cotejado ya aplicado. */
export interface CotejoOC { sumCotejo: number }

/**
 * Total real de una orden: subtotal cotejado + extras (flete, importacion) y
 * luego IVA — salvo servicios, que no causan IVA. Sin el resumen de cotejo se
 * cae al total guardado, que es lo unico que se sabe.
 */
export function totalDeOC(o: OCParaDeuda, cotejo?: CotejoOC | null): number {
  const s = cotejo?.sumCotejo
  if (s == null) return Number(o.total) || 0
  const extras: Array<{ tipo?: string; valor?: any }> = Array.isArray(o.extras) ? o.extras : []
  const extrasTotal = extras.reduce((acc, e) => (
    e?.tipo === 'porcentaje' ? acc + s * ((Number(e.valor) || 0) / 100) : acc + (Number(e?.valor) || 0)
  ), 0)
  const subtotal = s + extrasTotal
  const esServ = o.tipo === 'servicio'
  return redondearCentavos(subtotal + ivaDeOrden(subtotal, esServ ? 'servicio' : 'material'))
}

/**
 * Estados que ya son un compromiso de pago: el material se pidio o ya llego.
 * 'aprobada' NO entra: esta autorizada pero no colocada con el proveedor, asi
 * que todavia se puede no gastar. Se reporta aparte para que se vea venir.
 */
export const ESTADOS_DEUDA = ['pedida', 'recibida_parcial', 'recibida']
export const ESTADOS_POR_COMPROMETER = ['aprobada']
export const ESTADOS_BORRADOR = ['borrador']

export interface DeudaOC {
  id: string
  moneda: 'MXN' | 'USD'
  total: number
  pagado: number
  saldo: number
  status: string
}

export function deudaDeOC(o: OCParaDeuda, cotejo: CotejoOC | null | undefined, pagado: number): DeudaOC {
  const total = totalDeOC(o, cotejo)
  const p = Number(pagado) || 0
  return {
    id: o.id,
    moneda: o.currency === 'USD' ? 'USD' : 'MXN',
    total, pagado: p,
    // Un sobrepago no es deuda negativa: se topa en cero aqui y el excedente
    // se reporta aparte, porque restarlo de otra orden esconderia el problema.
    saldo: Math.max(0, redondearCentavos(total - p)),
    status: o.status,
  }
}

export interface Totales { mxn: number; usd: number; n: number }
const vacio = (): Totales => ({ mxn: 0, usd: 0, n: 0 })
const sumar = (t: Totales, d: DeudaOC, monto: number) => {
  if (d.moneda === 'USD') t.usd += monto; else t.mxn += monto
  t.n++
}

export interface ResumenDeuda {
  debo: Totales               // pedida + parcial + recibida, sin pagar
  porComprometer: Totales     // aprobadas, sin pagar
  borrador: Totales           // ni siquiera aprobadas
  ordenado: Totales           // valor total de lo comprometido
  pagado: Totales             // ya pagado de lo comprometido
  porRecibir: number
  /** Dinero pagado sobre ordenes canceladas: salio y no hay orden viva detras. */
  pagadoEnCanceladas: Totales
  /** Ordenes donde lo pagado excede el total. */
  sobrepagos: Totales
}

export function resumirDeuda(deudas: DeudaOC[]): ResumenDeuda {
  const r: ResumenDeuda = {
    debo: vacio(), porComprometer: vacio(), borrador: vacio(),
    ordenado: vacio(), pagado: vacio(), porRecibir: 0,
    pagadoEnCanceladas: vacio(), sobrepagos: vacio(),
  }
  for (const d of deudas) {
    if (d.status === 'cancelada') {
      if (d.pagado > 0) sumar(r.pagadoEnCanceladas, d, d.pagado)
      continue
    }
    if (d.pagado > d.total + 0.5) sumar(r.sobrepagos, d, redondearCentavos(d.pagado - d.total))
    if (ESTADOS_DEUDA.includes(d.status)) {
      if (d.saldo > 0.005) sumar(r.debo, d, d.saldo)
      sumar(r.ordenado, d, d.total)
      sumar(r.pagado, d, Math.min(d.pagado, d.total))
      if (d.status === 'pedida' || d.status === 'recibida_parcial') r.porRecibir++
    } else if (ESTADOS_POR_COMPROMETER.includes(d.status)) {
      if (d.saldo > 0.005) sumar(r.porComprometer, d, d.saldo)
    } else if (ESTADOS_BORRADOR.includes(d.status)) {
      if (d.saldo > 0.005) sumar(r.borrador, d, d.saldo)
    }
  }
  return r
}

export interface DeudaProyecto {
  proyecto: string
  mxn: number
  usd: number
  ordenes: number
  ordenado_mxn: number
  ordenado_usd: number
}

/** Deuda agrupada por proyecto, de mayor a menor. */
export function deudaPorProyecto(
  filas: Array<{ deuda: DeudaOC; proyecto: string }>, tcOrden = 18,
): DeudaProyecto[] {
  const m = new Map<string, DeudaProyecto>()
  for (const { deuda: d, proyecto } of filas) {
    if (!ESTADOS_DEUDA.includes(d.status)) continue
    const k = proyecto || 'Sin proyecto'
    const g = m.get(k) || { proyecto: k, mxn: 0, usd: 0, ordenes: 0, ordenado_mxn: 0, ordenado_usd: 0 }
    if (d.moneda === 'USD') { g.usd += d.saldo; g.ordenado_usd += d.total }
    else { g.mxn += d.saldo; g.ordenado_mxn += d.total }
    g.ordenes++
    m.set(k, g)
  }
  return [...m.values()]
    .filter(g => g.mxn > 0.005 || g.usd > 0.005)
    // El orden mezcla monedas solo para decidir cual va arriba; los montos se
    // siguen mostrando separados, sin convertir nada.
    .sort((a, b) => (b.mxn + b.usd * tcOrden) - (a.mxn + a.usd * tcOrden))
}

// ─────────────────────────────────────────────────────────────────────────────
//  Resumen por proyecto: lo presupuestado contra lo realmente comprado.
//
//  OJO CON LA MONEDA DEL COSTO. `quotation_items.provider_currency` no es
//  confiable: de 3,215 partidas de contratos vigentes, 491 se contradicen con
//  el catalogo. Un caso real — la cotizacion "Cero5Cien O402 - Instalaciones
//  Electricas" trae sus 192 partidas marcadas USD con costo de 667,397, en una
//  cotizacion vendida en PESOS por 2,137,637: ese costo es en pesos mal
//  etiquetado, y creerle convertiria el teorico en 18 veces lo real.
//
//  La moneda del costo la dicta el CATALOGO (lib/moneda.ts es la regla unica
//  del ERP). Aqui se respeta eso, y las partidas donde catalogo y renglon no
//  coinciden se cuentan para poder decirlo en pantalla.
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaProyecto {
  proyecto: string
  /** Costo presupuestado en la(s) cotizacion(es) vendida(s). */
  teoricoMXN: number
  teoricoUSD: number
  /** Suma de las OC no canceladas, al total cotejado + extras + IVA. */
  ocMXN: number
  ocUSD: number
  ordenes: number
  /** Cuantas OC traen saldo. */
  ocPorPagar: number
  pagadoMXN: number
  pagadoUSD: number
  pendienteMXN: number
  pendienteUSD: number
  /** Partidas cuya moneda de costo no coincide entre renglon y catalogo. */
  monedasDudosas: number
  ids: string[]
}

export interface EntradaTeorico {
  proyecto: string
  costo: number
  monedaCatalogo: 'MXN' | 'USD'
  monedaRenglon: 'MXN' | 'USD'
}

export function resumenPorProyecto(
  ocs: Array<{ deuda: DeudaOC; proyecto: string }>,
  teorico: EntradaTeorico[],
): FilaProyecto[] {
  const m = new Map<string, FilaProyecto>()
  const get = (k: string): FilaProyecto => {
    let g = m.get(k)
    if (!g) {
      g = { proyecto: k, teoricoMXN: 0, teoricoUSD: 0, ocMXN: 0, ocUSD: 0, ordenes: 0,
            ocPorPagar: 0, pagadoMXN: 0, pagadoUSD: 0, pendienteMXN: 0, pendienteUSD: 0,
            monedasDudosas: 0, ids: [] }
      m.set(k, g)
    }
    return g
  }

  for (const t of teorico) {
    const g = get(t.proyecto || 'Sin proyecto')
    if (t.monedaCatalogo === 'USD') g.teoricoUSD += t.costo; else g.teoricoMXN += t.costo
    if (t.monedaCatalogo !== t.monedaRenglon) g.monedasDudosas++
  }

  for (const { deuda: d, proyecto } of ocs) {
    // Las canceladas no son ni costo ni deuda del proyecto.
    if (d.status === 'cancelada') continue
    const g = get(proyecto || 'Sin proyecto')
    const pagado = Math.min(d.pagado, d.total)
    if (d.moneda === 'USD') { g.ocUSD += d.total; g.pagadoUSD += pagado; g.pendienteUSD += d.saldo }
    else { g.ocMXN += d.total; g.pagadoMXN += pagado; g.pendienteMXN += d.saldo }
    g.ordenes++
    if (d.saldo > 0.005) g.ocPorPagar++
    g.ids.push(d.id)
  }

  const r2n = (n: number) => Math.round(n * 100) / 100
  return [...m.values()]
    .map(g => ({
      ...g,
      teoricoMXN: r2n(g.teoricoMXN), teoricoUSD: r2n(g.teoricoUSD),
      ocMXN: r2n(g.ocMXN), ocUSD: r2n(g.ocUSD),
      pagadoMXN: r2n(g.pagadoMXN), pagadoUSD: r2n(g.pagadoUSD),
      pendienteMXN: r2n(g.pendienteMXN), pendienteUSD: r2n(g.pendienteUSD),
    }))
    .filter(g => g.ordenes > 0 || g.teoricoMXN > 0.5 || g.teoricoUSD > 0.5)
    .sort((a, b) => (b.pendienteMXN + b.pendienteUSD * 18) - (a.pendienteMXN + a.pendienteUSD * 18))
}
