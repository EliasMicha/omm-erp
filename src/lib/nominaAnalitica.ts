// Analíticos de nómina: carga el RPC nomina_analitica() (un renglón por
// persona y mes) y arma las series mensuales. Fuente por mes: módulo de
// nómina si el mes tiene un periodo cerrado; si no, el historial del Excel.
import { supabase } from './supabase'
import { etiquetaMes, mesActual } from './finanzasTablero'

export interface FilaNomina {
  mes: string          // 'YYYY-MM'
  quien: string
  nombre: string
  linea: string
  area: string
  transferencia: number
  efectivo: number
  fuente: string       // 'modulo' | 'historial'
  esPersona: boolean   // false para los renglones de bonos/aguinaldos sin persona
}

export interface MesNomina {
  mes: string
  etiqueta: string
  enCurso: boolean
  fuente: string
  total: number
  transferencia: number
  efectivo: number
  personas: number
  porLinea: Record<string, number>
  personasPorLinea: Record<string, number>
  altas: string[]      // quienes cobran por primera vez este mes
  bajas: string[]      // quienes cobraron por última vez el mes anterior y no han vuelto
}

export interface AnaliticaNomina {
  meses: MesNomina[]
  ultimoCompleto: number   // índice del último mes cerrado (no en curso), -1 si no hay
}

export const ORDEN_LINEAS_NOMINA = ['elec', 'esp', 'ilum', 'proy_elec', 'proy_esp', 'estructura', 'otras_empresas', 'bonos']

export const NOMBRE_LINEA_NOMINA: Record<string, string> = {
  elec: 'Eléctrico',
  esp: 'Instalaciones especiales',
  ilum: 'Iluminación',
  proy_elec: 'Ingenierías eléctricas',
  proy_esp: 'Ingenierías especiales',
  estructura: 'Administración',
  otras_empresas: 'NULED / Casa Luce',
  bonos: 'Bonos y aguinaldos sin desglose',
}

export const COLOR_LINEA_NOMINA: Record<string, string> = {
  elec: '#3987e5',
  esp: '#199e70',
  ilum: '#c98500',
  proy_elec: '#d55181',
  proy_esp: '#9085e9',
  estructura: '#d95926',
  otras_empresas: '#6f6e69',
  bonos: '#b5b3ab',
}

function num(v: unknown): number {
  const x = Number(v)
  return isFinite(x) ? x : 0
}

function siguienteMes(mes: string): string {
  const y = Number(mes.slice(0, 4))
  const m = Number(mes.slice(5, 7))
  return m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0')
}

export async function cargarAnaliticaNomina(): Promise<AnaliticaNomina> {
  const { data, error } = await supabase.rpc('nomina_analitica')
  if (error) throw new Error(error.message)
  const filas: FilaNomina[] = ((data as any[]) || []).map(r => ({
    mes: String(r.mes).slice(0, 7),
    quien: String(r.quien || ''),
    nombre: String(r.nombre || ''),
    // Los bonos que el Excel no reparte por persona van en su propia serie
    // para no inflar un área.
    linea: r.es_persona === false ? 'bonos' : String(r.linea || 'estructura'),
    area: String(r.area || ''),
    transferencia: num(r.transferencia),
    efectivo: num(r.efectivo),
    fuente: String(r.fuente || ''),
    esPersona: r.es_persona !== false,
  }))
  if (filas.length === 0) return { meses: [], ultimoCompleto: -1 }

  const hoy = mesActual()
  let primero = filas[0].mes
  let ultimo = filas[0].mes
  filas.forEach(f => {
    if (f.mes < primero) primero = f.mes
    if (f.mes > ultimo) ultimo = f.mes
  })
  const claves: string[] = []
  for (let m = primero; m <= ultimo; m = siguienteMes(m)) claves.push(m)

  const porMes: Record<string, FilaNomina[]> = {}
  filas.forEach(f => {
    if (!porMes[f.mes]) porMes[f.mes] = []
    porMes[f.mes].push(f)
  })

  // Alta = primer mes en que la persona cobra; baja = el mes siguiente al
  // último que cobró (si no vuelve). Quien falta un mes y regresa no cuenta.
  const primero_: Record<string, number> = {}
  const ultimo_: Record<string, number> = {}
  const nombreDe: Record<string, string> = {}
  claves.forEach((mes, i) => {
    (porMes[mes] || []).forEach(f => {
      if (!f.esPersona || f.transferencia + f.efectivo <= 0) return
      if (primero_[f.quien] === undefined) primero_[f.quien] = i
      ultimo_[f.quien] = i
      nombreDe[f.quien] = f.nombre
    })
  })
  const altasEn: Record<number, string[]> = {}
  const bajasEn: Record<number, string[]> = {}
  Object.keys(primero_).forEach(q => {
    const a = primero_[q]
    const b = ultimo_[q] + 1
    if (a > 0) { if (!altasEn[a]) altasEn[a] = []; altasEn[a].push(nombreDe[q]) }
    if (b < claves.length) { if (!bajasEn[b]) bajasEn[b] = []; bajasEn[b].push(nombreDe[q]) }
  })

  const meses: MesNomina[] = []
  claves.forEach((mes, i) => {
    const fs = porMes[mes] || []
    const porLinea: Record<string, number> = {}
    const genteLinea: Record<string, Record<string, boolean>> = {}
    const gente: Record<string, string> = {}
    let transferencia = 0
    let efectivo = 0
    let fuente = ''
    fs.forEach(f => {
      const monto = f.transferencia + f.efectivo
      transferencia += f.transferencia
      efectivo += f.efectivo
      porLinea[f.linea] = (porLinea[f.linea] || 0) + monto
      if (!fuente) fuente = f.fuente
      if (f.esPersona && monto > 0) {
        gente[f.quien] = f.nombre
        if (!genteLinea[f.linea]) genteLinea[f.linea] = {}
        genteLinea[f.linea][f.quien] = true
      }
    })
    const personasPorLinea: Record<string, number> = {}
    Object.keys(genteLinea).forEach(l => { personasPorLinea[l] = Object.keys(genteLinea[l]).length })
    const altas = (altasEn[i] || []).slice()
    const bajas = (bajasEn[i] || []).slice()
    meses.push({
      mes, etiqueta: etiquetaMes(mes), enCurso: mes >= hoy, fuente,
      total: transferencia + efectivo, transferencia, efectivo,
      personas: Object.keys(gente).length, porLinea, personasPorLinea,
      altas: altas.sort(), bajas: bajas.sort(),
    })
  })

  let ultimoCompleto = -1
  meses.forEach((m, i) => { if (!m.enCurso && m.total > 0) ultimoCompleto = i })
  return { meses, ultimoCompleto }
}
