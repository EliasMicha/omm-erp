// Tablero de Finanzas — capa de datos.
//
// Todo sale de UNA función SQL: finanzas_tablero(p_desde, p_hasta). Ella
// entrega cada serie en su moneda nativa (mxn / usd por separado). Aquí se
// convierte a "MXN equivalente" con el TC del AÑO de cada mes (src/lib/fx.ts),
// que es el costo real del dólar para OMM, y la pantalla lo dice siempre.
//
// Fuentes (las vivas, no las viejas):
//   · Venta       = cotizaciones en etapa contrato y vigentes, por fecha_contrato
//   · Cobranza    = banco (cobro_cliente) + efectivo (cobro_cliente)
//   · Nómina      = módulo de nómina (transferencia + efectivo); si el mes no
//                   tiene periodos cerrados, lo que salió por banco + efectivo
//   · Proveedores = banco + efectivo, neto de devoluciones
//   · CxP         = órdenes de compra emitidas y no pagadas
//   · Cartera     = vendido − cobrado por cliente (lead) y moneda
import { supabase } from './supabase'
import { tcForYear } from './fx'

export interface MesRaw {
  mes: string
  cobranza_banco_mxn: number; cobranza_banco_usd: number
  cobranza_efvo_mxn: number; cobranza_efvo_usd: number
  vendido_mxn: number; vendido_usd: number; contratos: number
  proveedores_mxn: number; proveedores_usd: number
  nomina_banco: number; nomina_efvo: number; nomina_modulo: number; nomina_cerrada: boolean
  nomina_historica: number
  impuestos: number
  gastos_mxn: number; gastos_usd: number
  sin_clasificar_mxn: number; sin_clasificar_usd: number
  otros_ingresos_mxn: number; otros_ingresos_usd: number
  revolvente_dispuesto: number; revolvente_pagado: number; disposiciones: number
  aportaciones: number
}

export interface CarteraResumen { cur: string; estado: string; saldo: number; leads: number }
export interface CarteraLead {
  lead_id: string; lead: string; clave: string | null; cur: string
  vendido: number; cobrado: number; saldo: number; contratos: number
  primer_contrato: string | null; ultimo_cobro: string | null; estado: string
}
export interface CxpResumen { cur: string; bucket: string; saldo: number; n: number }
export interface CxpOc {
  id: string; folio: string | null; status: string; cur: string
  total: number; pagado: number; saldo: number; fecha_maxima_pago: string | null
  proveedor: string | null; lead: string | null; bucket: string
}
export interface LineaRaw {
  linea: string
  vendido_mxn: number; vendido_usd: number
  cobrado_mxn: number; cobrado_usd: number
  proveedores_mxn: number; proveedores_usd: number
  nomina: number; personas: number
}
export interface CuentaFrescura { cuenta: string; moneda: string; ultimo: string }
export interface PorConfirmar {
  id: string; folio: string | null; name: string; lead: string | null
  fecha_contrato: string | null; moneda: string; vendido: number
}

export interface TableroRaw {
  meses: MesRaw[]
  cartera: { resumen: CarteraResumen[]; leads: CarteraLead[] }
  cxp: { resumen: CxpResumen[]; ocs: CxpOc[] }
  lineas: LineaRaw[]
  frescura: { cuentas: CuentaFrescura[]; efectivo: string | null; nomina: string | null }
  por_confirmar: PorConfirmar[]
  generado: string
}

// Un mes ya convertido a MXN equivalente.
export interface Mes {
  mes: string            // 'YYYY-MM'
  etiqueta: string       // 'Oct 26'
  tc: number
  enCurso: boolean
  vendido: number
  contratos: number
  cobrado: number
  cobradoEfectivo: number
  proveedores: number
  nomina: number         // la mejor serie disponible
  nominaCaja: number     // lo que salió por banco + efectivo (para el flujo)
  nominaModulo: number   // lo capturado en el módulo de nómina
  nominaCerrada: boolean // el mes tiene periodos cerrados en el módulo
  nominaHistorica: number // historial cargado del Excel (Ene-2025 a Jun-2026)
  nominaCompleta: boolean
  impuestos: number
  gastos: number
  sinClasificar: number
  otrosIngresos: number
  egresosOperativos: number
  flujoOperativo: number
  revolventeDispuesto: number
  revolventePagado: number
  disposiciones: number
  aportaciones: number
  flujoTotal: number
}

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function n(v: unknown): number {
  const x = Number(v)
  return isFinite(x) ? x : 0
}

export function etiquetaMes(mes: string): string {
  const [y, m] = mes.split('-')
  return MESES_CORTOS[Number(m) - 1] + ' ' + y.slice(2)
}

export function mesActual(): string {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

export function convertirMes(r: MesRaw): Mes {
  const tc = tcForYear(Number(r.mes.slice(0, 4)))
  const cobrado = n(r.cobranza_banco_mxn) + n(r.cobranza_efvo_mxn) + (n(r.cobranza_banco_usd) + n(r.cobranza_efvo_usd)) * tc
  const cobradoEfectivo = n(r.cobranza_efvo_mxn) + n(r.cobranza_efvo_usd) * tc
  const proveedores = n(r.proveedores_mxn) + n(r.proveedores_usd) * tc
  const nominaCaja = n(r.nomina_banco) + n(r.nomina_efvo)
  const nominaModulo = n(r.nomina_modulo)
  const nominaHistorica = n(r.nomina_historica)
  const cerradaModulo = !!r.nomina_cerrada && nominaModulo > 0
  // Prioridad: 1) módulo con periodos cerrados, 2) historial del Excel
  // (meses antes de que el módulo estuviera completo), 3) lo mejor que haya.
  // El historial no toca los periodos del módulo: solo se lee en otra tabla.
  const nomina = cerradaModulo ? nominaModulo : (nominaHistorica > 0 ? nominaHistorica : Math.max(nominaModulo, nominaCaja))
  const nominaCompleta = cerradaModulo || nominaHistorica > 0 || n(r.nomina_efvo) > 0
  const impuestos = n(r.impuestos)
  const gastos = n(r.gastos_mxn) + n(r.gastos_usd) * tc
  const sinClasificar = n(r.sin_clasificar_mxn) + n(r.sin_clasificar_usd) * tc
  const otrosIngresos = n(r.otros_ingresos_mxn) + n(r.otros_ingresos_usd) * tc
  // El flujo usa lo que REALMENTE salió (banco + efectivo), no el módulo:
  // si parte de la nómina se fue como "otro", ya está en sinClasificar.
  const egresosOperativos = proveedores + nominaCaja + impuestos + gastos + sinClasificar
  const flujoOperativo = cobrado + otrosIngresos - egresosOperativos
  const revolventeDispuesto = n(r.revolvente_dispuesto)
  const revolventePagado = n(r.revolvente_pagado)
  const aportaciones = n(r.aportaciones)
  return {
    mes: r.mes,
    etiqueta: etiquetaMes(r.mes),
    tc,
    enCurso: r.mes === mesActual(),
    vendido: n(r.vendido_mxn) + n(r.vendido_usd) * tc,
    contratos: n(r.contratos),
    cobrado,
    cobradoEfectivo,
    proveedores,
    nomina,
    nominaCaja,
    nominaModulo,
    nominaCerrada: cerradaModulo,
    nominaHistorica,
    nominaCompleta,
    impuestos,
    gastos,
    sinClasificar,
    otrosIngresos,
    egresosOperativos,
    flujoOperativo,
    revolventeDispuesto,
    revolventePagado,
    disposiciones: n(r.disposiciones),
    aportaciones,
    flujoTotal: flujoOperativo + revolventeDispuesto - revolventePagado + aportaciones,
  }
}

export interface Totales {
  meses: number
  vendido: number
  cobrado: number
  proveedores: number
  nomina: number
  nominaCompleta: boolean
  impuestos: number
  gastos: number
  sinClasificar: number
  egresosOperativos: number
  flujoOperativo: number
  disposiciones: number
  revolventeNeto: number
  aportaciones: number
  contratos: number
}

export function sumar(meses: Mes[]): Totales {
  const t: Totales = {
    meses: meses.length, vendido: 0, cobrado: 0, proveedores: 0, nomina: 0, nominaCompleta: true,
    impuestos: 0, gastos: 0, sinClasificar: 0, egresosOperativos: 0, flujoOperativo: 0,
    disposiciones: 0, revolventeNeto: 0, aportaciones: 0, contratos: 0,
  }
  for (const m of meses) {
    t.vendido += m.vendido
    t.cobrado += m.cobrado
    t.proveedores += m.proveedores
    t.nomina += m.nomina
    if (!m.nominaCompleta) t.nominaCompleta = false
    t.impuestos += m.impuestos
    t.gastos += m.gastos
    t.sinClasificar += m.sinClasificar
    t.egresosOperativos += m.egresosOperativos
    t.flujoOperativo += m.flujoOperativo
    t.disposiciones += m.disposiciones
    t.revolventeNeto += m.revolventeDispuesto - m.revolventePagado
    t.aportaciones += m.aportaciones
    t.contratos += m.contratos
  }
  return t
}

export async function cargarTablero(desde: string, hasta: string): Promise<TableroRaw> {
  const { data, error } = await supabase.rpc('finanzas_tablero', { p_desde: desde, p_hasta: hasta })
  if (error) throw new Error(error.message)
  const r = (data || {}) as TableroRaw
  // El "último cobro" viene por cliente, sin distinguir moneda: un cliente con
  // contratos en MXN y USD que solo ha pagado los pesos no está "al corriente"
  // en dólares. Si en esa moneda no hay nada cobrado, es "sin cobro aún".
  const leads: CarteraLead[] = ((r.cartera && r.cartera.leads) || []).map(l => {
    if (Number(l.cobrado) < 1) return { ...l, estado: 'sin_cobro', ultimo_cobro: null }
    return l
  })
  const acum: Record<string, CarteraResumen> = {}
  leads.forEach(l => {
    const k = l.cur + '|' + l.estado
    if (!acum[k]) acum[k] = { cur: l.cur, estado: l.estado, saldo: 0, leads: 0 }
    acum[k].saldo += Number(l.saldo) || 0
    acum[k].leads += 1
  })
  return {
    meses: r.meses || [],
    cartera: { resumen: Object.keys(acum).map(k => acum[k]), leads },
    cxp: r.cxp || { resumen: [], ocs: [] },
    lineas: r.lineas || [],
    frescura: r.frescura || { cuentas: [], efectivo: null, nomina: null },
    por_confirmar: r.por_confirmar || [],
    generado: r.generado || '',
  }
}

// ── Formatos ──────────────────────────────────────────────────────────────
export function fmtM(v: number): string {
  const a = Math.abs(v)
  const s = v < 0 ? '−' : ''
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + ' M'
  if (a >= 1e3) return s + '$' + Math.round(a / 1e3).toLocaleString('es-MX') + ' K'
  return s + '$' + Math.round(a).toLocaleString('es-MX')
}

export function fmt$(v: number, cur?: string): string {
  const s = (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('es-MX')
  return cur ? s + ' ' + cur.toUpperCase() : s
}

export function fmtPct(v: number, dec?: number): string {
  if (!isFinite(v)) return '—'
  return (v * 100).toFixed(dec === undefined ? 1 : dec) + '%'
}

// ── Nombres de las líneas de negocio ──────────────────────────────────────
export const NOMBRE_LINEA: Record<string, string> = {
  esp: 'Instalaciones especiales',
  elec: 'Eléctrico',
  ilum: 'Iluminación (suministro y diseño)',
  cort: 'Cortinas y persianas',
  dist: 'Distribución',
  proy_esp: 'Proyecto · ing. especiales',
  proy_elec: 'Proyecto · ing. eléctrica',
  estructura: 'Dirección y administración',
  otras_empresas: 'Nómina de NULED / Casa Luce',
  sin_liga: 'Sin liga a cotización',
}
