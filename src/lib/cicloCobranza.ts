// Ciclo de cobranza por LEAD: desde el primer cobro hasta el finiquito.
//
// Todo se mide en % del contrato del lead (no en pesos), para que una obra de
// 6 M y una de 300 K pesen igual en la curva.
//
// Curva típica: método "en cadena". En cada mes k se promedia cuánto avanzó
// (en puntos de %) cada lead que YA tiene al menos k meses desde su primer
// cobro, y se acumula. Así un lead de 4 meses aporta a los primeros 4 meses y
// no arrastra la cola hacia abajo (el error de "censura" que tenía la curva
// vieja), y la curva nunca baja por cambios de composición.
import { supabase } from './supabase'
import { tcForYear } from './fx'

export const DIAS_MES = 30.4375
export const FINIQUITO = 0.9   // "finiquito práctico": 90% del contrato cobrado

export interface Cobro { fecha: string; monto: number; k: number }  // k = meses desde el primer cobro

export interface LeadCiclo {
  leadId: string
  lead: string
  clave: string | null
  principal: string          // especialidad con más contrato
  vendido: number            // MXN equivalente
  cobrado: number
  pct: number                // cobrado / vendido, tope 1
  primerContrato: string | null
  primerCobro: string | null
  ultimoCobro: string | null
  edad: number               // meses desde el primer cobro hasta hoy
  cobros: Cobro[]
}

export interface Cobertura { anio: number; total: number; ligado: number }

export interface DatosCiclo {
  hoy: string
  datosDesde: string | null
  tc: number
  leads: LeadCiclo[]          // con al menos un cobro
  sinCobro: LeadCiclo[]       // contrato firmado, sin cobro todavía
  cobertura: Cobertura[]
}

export interface PuntoCurva { k: number; valor: number; n: number }

function num(v: unknown): number {
  const x = Number(v)
  return isFinite(x) ? x : 0
}

export function mesesEntre(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00').getTime()
  const db = new Date(b + 'T12:00:00').getTime()
  return (db - da) / 86400000 / DIAS_MES
}

export function sumarMesesFecha(fecha: string, meses: number): string {
  const d = new Date(fecha + 'T12:00:00')
  d.setTime(d.getTime() + meses * DIAS_MES * 86400000)
  return d.toISOString().slice(0, 10)
}

export async function cargarCiclo(): Promise<DatosCiclo> {
  const { data, error } = await supabase.rpc('finanzas_ciclo_cobranza')
  if (error) throw new Error(error.message)
  const r: any = data || {}
  const hoy: string = String(r.hoy || new Date().toISOString().slice(0, 10)).slice(0, 10)
  // Un solo TC para contrato y cobros: el % no se distorsiona por el tipo de cambio.
  const tc = tcForYear(Number(hoy.slice(0, 4)))

  interface Acum { leadId: string; lead: string; clave: string | null; vendido: number; esp: Record<string, number>; primerContrato: string | null; cobros: { fecha: string; monto: number }[] }
  const porLead: Record<string, Acum> = {}
  ;((r.leads as any[]) || []).forEach(x => {
    const f = x.cur === 'usd' ? tc : 1
    const id = String(x.lead_id)
    if (!porLead[id]) porLead[id] = { leadId: id, lead: String(x.lead || ''), clave: x.clave || null, vendido: 0, esp: {}, primerContrato: null, cobros: [] }
    const a = porLead[id]
    a.vendido += num(x.vendido) * f
    const pe = x.por_especialidad || {}
    Object.keys(pe).forEach(s => { a.esp[s] = (a.esp[s] || 0) + num(pe[s]) * f })
    if (x.primer_contrato && (!a.primerContrato || x.primer_contrato < a.primerContrato)) a.primerContrato = String(x.primer_contrato)
    ;((x.pagos as any[]) || []).forEach(p => { a.cobros.push({ fecha: String(p[0]).slice(0, 10), monto: num(p[1]) * f }) })
  })

  const leads: LeadCiclo[] = []
  const sinCobro: LeadCiclo[] = []
  Object.keys(porLead).forEach(id => {
    const a = porLead[id]
    if (a.vendido <= 0) return
    let principal = 'otro'
    let max = -1
    Object.keys(a.esp).forEach(s => { if (a.esp[s] > max) { max = a.esp[s]; principal = s } })
    // Varios cobros el mismo día ya vienen sumados; aquí se juntan las dos monedas.
    const porFecha: Record<string, number> = {}
    a.cobros.forEach(c => { porFecha[c.fecha] = (porFecha[c.fecha] || 0) + c.monto })
    const fechas = Object.keys(porFecha).sort()
    const primer = fechas.length ? fechas[0] : null
    const cobros: Cobro[] = fechas.map(fe => ({ fecha: fe, monto: porFecha[fe], k: primer ? mesesEntre(primer, fe) : 0 }))
    const cobrado = cobros.reduce((s, c) => s + c.monto, 0)
    const l: LeadCiclo = {
      leadId: a.leadId, lead: a.lead, clave: a.clave, principal, vendido: a.vendido, cobrado,
      pct: Math.min(1, cobrado / a.vendido), primerContrato: a.primerContrato,
      primerCobro: primer, ultimoCobro: fechas.length ? fechas[fechas.length - 1] : null,
      edad: primer ? mesesEntre(primer, hoy) : 0, cobros,
    }
    if (cobros.length) leads.push(l)
    else sinCobro.push(l)
  })

  const cobPorAnio: Record<number, Cobertura> = {}
  ;((r.cobertura as any[]) || []).forEach(c => {
    const anio = Number(c.anio)
    const f = c.cur === 'usd' ? tcForYear(anio) : 1
    if (!cobPorAnio[anio]) cobPorAnio[anio] = { anio, total: 0, ligado: 0 }
    cobPorAnio[anio].total += num(c.total) * f
    cobPorAnio[anio].ligado += num(c.ligado) * f
  })

  return {
    hoy, datosDesde: r.datos_desde ? String(r.datos_desde).slice(0, 10) : null, tc,
    leads, sinCobro, cobertura: Object.keys(cobPorAnio).map(k => cobPorAnio[Number(k)]).sort((x, y) => x.anio - y.anio),
  }
}

// % cobrado del contrato a los k meses de su primer cobro (tope 100%).
export function pctA(l: LeadCiclo, k: number): number {
  let s = 0
  for (let i = 0; i < l.cobros.length; i++) {
    if (l.cobros[i].k <= k + 1e-9) s += l.cobros[i].monto
    else break
  }
  return Math.min(1, s / l.vendido)
}

// Curva típica en cadena. minN: cuántos leads tienen que haber llegado a ese
// mes para seguir dibujando (menos que eso ya no es un promedio).
export function curvaTipica(leads: LeadCiclo[], minN: number): PuntoCurva[] {
  if (leads.length === 0) return []
  const puntos: PuntoCurva[] = []
  let v = leads.reduce((s, l) => s + pctA(l, 0), 0) / leads.length
  puntos.push({ k: 0, valor: v, n: leads.length })
  for (let k = 1; k <= 60; k++) {
    const vivos = leads.filter(l => l.edad >= k)
    if (vivos.length < minN) break
    const avance = vivos.reduce((s, l) => s + (pctA(l, k) - pctA(l, k - 1)), 0) / vivos.length
    v = Math.min(1, v + avance)
    puntos.push({ k, valor: v, n: vivos.length })
  }
  return puntos
}

// Valor de la curva en un mes fraccionario (interpolado; después del último
// punto se queda en el último valor).
export function valorEn(curva: PuntoCurva[], k: number): number {
  if (curva.length === 0) return 0
  if (k <= 0) return curva[0].valor
  const ult = curva[curva.length - 1]
  if (k >= ult.k) return ult.valor
  const i = Math.floor(k)
  const a = curva[i].valor
  const b = curva[i + 1].valor
  return a + (b - a) * (k - i)
}

// Mes (fraccionario) en que la curva llega a un %, o null si no llega.
export function mesesHasta(curva: PuntoCurva[], objetivo: number): number | null {
  for (let i = 0; i < curva.length; i++) {
    if (curva[i].valor >= objetivo) {
      if (i === 0) return 0
      const a = curva[i - 1].valor
      const b = curva[i].valor
      return i - 1 + (b > a ? (objetivo - a) / (b - a) : 0)
    }
  }
  return null
}

// Mes "equivalente" de un lead: en qué punto de la curva típica va según su %.
export function edadEquivalente(curva: PuntoCurva[], pct: number): number {
  const m = mesesHasta(curva, pct)
  if (m !== null) return m
  return curva.length ? curva[curva.length - 1].k : 0
}

// Camino futuro de un lead: desde donde va (pct), avanza al ritmo de la curva
// a partir de su mes equivalente. Si va por debajo del arranque de la curva
// (anticipo chico), los avances se escalan para que no "brinque" a la curva:
// llega al mismo techo, proporcionalmente.
interface Camino { e: number; base: number; esc: number }
function camino(curva: PuntoCurva[], pct: number): Camino {
  const e = edadEquivalente(curva, pct)
  const base = valorEn(curva, e)
  const techo = curva.length ? curva[curva.length - 1].valor : 0
  const esc = techo > base ? Math.max(0, techo - pct) / (techo - base) : 0
  return { e, base, esc }
}
function valorCamino(curva: PuntoCurva[], c: Camino, pct: number, kCurva: number): number {
  return Math.min(1, pct + Math.max(0, valorEn(curva, kCurva) - c.base) * c.esc)
}

// Curva meta: la misma forma, comprimida para que el 90% llegue en metaMeses.
export function curvaMeta(curva: PuntoCurva[], cicloActual: number, metaMeses: number, hasta: number): PuntoCurva[] {
  const f = metaMeses > 0 ? cicloActual / metaMeses : 1
  const out: PuntoCurva[] = []
  for (let k = 0; k <= hasta; k++) out.push({ k, valor: valorEn(curva, k * f), n: 0 })
  return out
}

export interface Pronostico {
  lead: LeadCiclo
  esperado: number            // % que la curva típica tiene a la edad del lead
  desvio: number              // pct - esperado
  estado: 'arrancando' | 'adelantado' | 'al_ritmo' | 'atrasado' | 'en_finiquito'
  mesesRestantes: number | null
  finiquitoEstimado: string | null
  saldo: number
}

export function pronosticar(l: LeadCiclo, curva: PuntoCurva[], ciclo: number | null, hoy: string): Pronostico {
  const esperado = valorEn(curva, l.edad)
  const desvio = l.pct - esperado
  const saldo = Math.max(0, l.vendido - l.cobrado)
  let estado: 'arrancando' | 'adelantado' | 'al_ritmo' | 'atrasado' | 'en_finiquito' = 'al_ritmo'
  if (l.pct >= FINIQUITO) estado = 'en_finiquito'
  else if (l.edad < 2) estado = 'arrancando'
  else if (desvio <= -0.15) estado = 'atrasado'
  else if (desvio >= 0.15) estado = 'adelantado'
  let mesesRestantes: number | null = null
  let finiquitoEstimado: string | null = null
  if (l.pct < FINIQUITO && ciclo !== null) {
    const c = camino(curva, l.pct)
    // Mes de la curva en que su camino llega al 90%.
    const objetivo = c.esc > 0 ? c.base + (FINIQUITO - l.pct) / c.esc : 2
    const t = objetivo <= 1 ? mesesHasta(curva, objetivo) : null
    if (t !== null) {
      mesesRestantes = Math.max(0.5, t - c.e)
      finiquitoEstimado = sumarMesesFecha(hoy, mesesRestantes)
    }
  }
  return { lead: l, esperado, desvio, estado, mesesRestantes, finiquitoEstimado, saldo }
}

// Cobranza esperada por mes calendario de los leads abiertos, si cada uno
// sigue la curva (desde el punto donde va). factor > 1 = curva acelerada.
export function cobranzaEsperada(leads: LeadCiclo[], curva: PuntoCurva[], factor: number, meses: number): number[] {
  const out: number[] = []
  for (let j = 0; j < meses; j++) out.push(0)
  leads.forEach(l => {
    if (l.pct >= 0.999) return
    const c = camino(curva, l.pct)
    let previo = l.pct
    for (let j = 1; j <= meses; j++) {
      // Con factor > 1 el mismo camino se recorre más rápido.
      const v = Math.max(previo, valorCamino(curva, c, l.pct, c.e + j * factor))
      out[j - 1] += (v - previo) * l.vendido
      previo = v
    }
  })
  return out
}

export function mediana(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = xs.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface PatronPagos {
  anticipo: number            // mediana del primer cobro como % del contrato
  pagoTipico: number          // mediana de cada cobro como % del contrato
  diasEntrePagos: number      // mediana de días entre cobros consecutivos
  pagosAlFiniquito: number    // mediana de cobros que necesitaron los que llegaron al 90%
  llegaron: number            // cuántos leads llegaron al 90%
  mesesAlFiniquito: number    // mediana de meses del primer cobro al 90% (de los que llegaron)
}

export function patronPagos(leads: LeadCiclo[]): PatronPagos {
  const anticipos: number[] = []
  const pagos: number[] = []
  const dias: number[] = []
  const nFin: number[] = []
  const mFin: number[] = []
  leads.forEach(l => {
    if (l.cobros.length === 0) return
    anticipos.push(Math.min(1, l.cobros[0].monto / l.vendido))
    let acum = 0
    let llego = false
    l.cobros.forEach((c, i) => {
      pagos.push(Math.min(1, c.monto / l.vendido))
      if (i > 0) dias.push((c.k - l.cobros[i - 1].k) * DIAS_MES)
      acum += c.monto
      if (!llego && acum >= FINIQUITO * l.vendido) { llego = true; nFin.push(i + 1); mFin.push(c.k) }
    })
  })
  return {
    anticipo: mediana(anticipos), pagoTipico: mediana(pagos), diasEntrePagos: mediana(dias),
    pagosAlFiniquito: mediana(nFin), llegaron: nFin.length, mesesAlFiniquito: mediana(mFin),
  }
}

export const NOMBRE_ESPECIALIDAD: Record<string, string> = {
  esp: 'Instalaciones especiales',
  elec: 'Eléctrico',
  ilum: 'Iluminación',
  cort: 'Cortinas y persianas',
  proy: 'Proyecto',
  dist: 'Distribución',
  otro: 'Otro',
}
