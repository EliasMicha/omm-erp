// ─────────────────────────────────────────────────────────────────────────────
//  Viaticos de obra foranea — dias, gente, hospedaje y transporte.
//
//  Se captura SIEMPRE en pesos, porque asi se gasta: el hotel, la comida y las
//  casetas se pagan en MXN aunque la cotizacion vaya en dolares. Si la
//  cotizacion es en USD se convierte al TC de la propia cotizacion, al momento
//  de mostrarla. Guardar el numero ya convertido seria un error: al cambiar el
//  TC el gasto real dejaria de coincidir con lo cobrado.
//
//  Al cliente se le desglosa: dias a laborar, cuanta gente, viatico por dia,
//  hospedaje y transporte. Es un gasto que se cobra al costo, sin utilidad.
//
//  Posicion en la suma: DESPUES del descuento y ANTES del IVA, igual que los
//  cargos adicionales. El descuento se negocia sobre el material y la mano de
//  obra; el viatico se cobra completo, porque es dinero que ya salio.
// ─────────────────────────────────────────────────────────────────────────────

export interface Viaticos {
  activo: boolean
  /** Dias que la cuadrilla va a trabajar en obra. */
  dias: number
  /** Cuanta gente viaja. */
  personas: number
  /** Viatico diario por persona (comida y gastos), en MXN. */
  viaticoDia: number
  /** Noches de hospedaje. Normalmente = dias, pero no siempre. */
  noches: number
  /** Hospedaje por noche por persona, en MXN. */
  hospedajeNoche: number
  /** Transporte del viaje completo (vuelos, casetas, gasolina), en MXN. */
  transporte: number
  /** Nota libre que sale en el PDF debajo del desglose. */
  nota: string
}

export const VIATICOS_VACIOS: Viaticos = {
  activo: false, dias: 0, personas: 0, viaticoDia: 0,
  noches: 0, hospedajeNoche: 0, transporte: 0, nota: '',
}

const n = (v: any) => Number(v) || 0
const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100

/** Lee los viaticos de `notes`. Acepta el objeto ya parseado o el string crudo. */
export function leerViaticos(notes: any): Viaticos {
  let m: any = notes
  if (typeof notes === 'string') { try { m = JSON.parse(notes || '{}') } catch { return { ...VIATICOS_VACIOS } } }
  const v = m?.viaticos
  if (!v || typeof v !== 'object') return { ...VIATICOS_VACIOS }
  const dias = n(v.dias)
  return {
    activo: v.activo !== false,
    dias,
    personas: n(v.personas),
    viaticoDia: n(v.viaticoDia),
    // Sin noches capturadas se asume una noche por dia trabajado.
    noches: v.noches === undefined || v.noches === null || v.noches === '' ? dias : n(v.noches),
    hospedajeNoche: n(v.hospedajeNoche),
    transporte: n(v.transporte),
    nota: String(v.nota || ''),
  }
}

export interface RenglonViatico {
  concepto: string
  /** El calculo en palabras, para que el cliente vea de donde sale el numero. */
  detalle: string
  /** Importe en MXN (la moneda de captura). */
  importeMXN: number
}

/** El desglose que ve el cliente. Solo renglones con importe. */
export function desgloseViaticos(v: Viaticos): RenglonViatico[] {
  if (!v.activo) return []
  const filas: RenglonViatico[] = []
  const viat = r2(v.dias * v.personas * v.viaticoDia)
  if (viat !== 0) filas.push({
    concepto: 'Viáticos de personal',
    detalle: `${v.dias} día(s) × ${v.personas} persona(s) × $${v.viaticoDia.toLocaleString('es-MX')} por día`,
    importeMXN: viat,
  })
  const hosp = r2(v.noches * v.personas * v.hospedajeNoche)
  if (hosp !== 0) filas.push({
    concepto: 'Hospedaje',
    detalle: `${v.noches} noche(s) × ${v.personas} persona(s) × $${v.hospedajeNoche.toLocaleString('es-MX')} por noche`,
    importeMXN: hosp,
  })
  const transp = r2(v.transporte)
  if (transp !== 0) filas.push({
    concepto: 'Transporte',
    detalle: 'Traslado de la cuadrilla y herramienta',
    importeMXN: transp,
  })
  return filas
}

/** Total de viaticos en MXN, que es como se capturan. */
export function totalViaticosMXN(v: Viaticos): number {
  return r2(desgloseViaticos(v).reduce((s, f) => s + f.importeMXN, 0))
}

/**
 * Total de viaticos en la moneda de la cotizacion. Si la cotizacion va en USD
 * y no hay TC capturado devuelve 0: es preferible que el renglon no aparezca a
 * que aparezca con un numero inventado.
 */
export function totalViaticos(v: Viaticos, moneda: string, tipoCambio: number): number {
  const mxn = totalViaticosMXN(v)
  if (mxn === 0) return 0
  if ((moneda || 'MXN').toUpperCase() !== 'USD') return mxn
  const tc = Number(tipoCambio) || 0
  return tc > 0 ? r2(mxn / tc) : 0
}

/** Convierte un renglon del desglose a la moneda de la cotizacion. */
export function importeEnMoneda(importeMXN: number, moneda: string, tipoCambio: number): number {
  if ((moneda || 'MXN').toUpperCase() !== 'USD') return r2(importeMXN)
  const tc = Number(tipoCambio) || 0
  return tc > 0 ? r2(importeMXN / tc) : 0
}

/** true cuando hay viaticos capturados pero falta el TC para poder cobrarlos. */
export function faltaTCViaticos(v: Viaticos, moneda: string, tipoCambio: number): boolean {
  return totalViaticosMXN(v) > 0 && (moneda || 'MXN').toUpperCase() === 'USD' && !(Number(tipoCambio) > 0)
}
