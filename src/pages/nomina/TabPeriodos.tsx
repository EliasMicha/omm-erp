import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { F } from '../../lib/utils'
import { Btn, Table, Th, Td, Loading, KpiCard, EmptyState, Badge } from '../../components/layout/UI'
import {
  Calendar, DollarSign, Banknote, Clock, Plus, ChevronLeft, ChevronRight,
  Save, RefreshCw, Lock, AlertCircle, CheckCircle2, Gift, Upload, FileText
} from 'lucide-react'
import { parseSFacilNominaPDF, matchEmployeeByName, parseComprobantePagos } from '../../lib/nominaPdfParser'

/* ─────────────── Types ─────────────── */

interface Employee {
  id: string
  nombre: string
  tipo_alta: 'SEMANAL' | 'QUINCENAL' | null
  sueldo_neto_semanal: number | null
  sueldo_neto_quincenal: number | null
  puesto: string | null
  area: string | null
  rfc: string | null
  banco: string | null
  cuenta: string | null
  clabe: string | null
}

interface PayrollPeriod {
  id: string
  frequency: 'semanal' | 'quincenal'
  period_start: string
  period_end: string
  estatus: string | null
  numero_periodo: number | null
  semana_del_mes: number | null
  quincena_del_mes: number | null
  mes: number | null
  anio: number | null
  total_transferencia: number | null
  total_efectivo: number | null
  total_horas_extras: number | null
  total_bonos: number | null
  total_caja_chica: number | null
  notas: string | null
  comprobante_transferencia_url: string | null
  comprobante_transferencia_path: string | null
  transferencia_pagada: boolean | null
  transferencia_pagada_at: string | null
  created_at: string
}

interface PayrollItem {
  id: string
  period_id: string
  employee_id: string
  sueldo_neto_pactado: number | null
  neto_a_pagar_cfdi: number | null
  diferencia_neto_imss: number | null
  horas_extras_monto: number | null
  bono_puntualidad: number | null
  caja_chica: number | null
  descuento_infonavit_efectivo: number | null
  descuento_faltas: number | null
  otros_conceptos: any | null
  total_efectivo_calculado: number | null
  redondeo: number | null
  total_efectivo_final: number | null
  efectivo_pagado: boolean | null
  conciliado_transferencia: boolean | null
  notes: string | null
}

type ViewMode = 'semanal' | 'quincenal'

/* ─────────────── Helpers ─────────────── */

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function getWeekRange(date: Date): { start: Date; end: Date } {
  const d = new Date(date)
  const day = d.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const start = new Date(d)
  start.setDate(d.getDate() + diffToMon)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start, end }
}

function getQuincenaRange(date: Date): { start: Date; end: Date } {
  const y = date.getFullYear()
  const m = date.getMonth()
  if (date.getDate() <= 15) {
    return { start: new Date(y, m, 1), end: new Date(y, m, 15) }
  } else {
    const lastDay = new Date(y, m + 1, 0).getDate()
    return { start: new Date(y, m, 16), end: new Date(y, m, lastDay) }
  }
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtDateLabel(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

function periodLabel(mode: ViewMode, start: Date, end: Date): string {
  if (mode === 'semanal') {
    return `Semana ${fmtDateLabel(start)} – ${fmtDateLabel(end)}`
  }
  const q = start.getDate() <= 15 ? 1 : 2
  return `Quincena ${q} – ${MONTHS[start.getMonth()]} ${start.getFullYear()}`
}

/* ─────────────── Component ─────────────── */

export default function TabPeriodos() {
  const [viewMode, setViewMode] = useState<ViewMode>('semanal')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [employees, setEmployees] = useState<Employee[]>([])
  const [period, setPeriod] = useState<PayrollPeriod | null>(null)
  const [items, setItems] = useState<PayrollItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState<Record<string, Partial<PayrollItem>>>({})
  const [subiendoComp, setSubiendoComp] = useState(false)

  // Computed date range
  const range = useMemo(() => {
    return viewMode === 'semanal'
      ? getWeekRange(currentDate)
      : getQuincenaRange(currentDate)
  }, [viewMode, currentDate])

  // Navigate periods
  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate)
    if (viewMode === 'semanal') {
      d.setDate(d.getDate() + dir * 7)
    } else {
      if (dir === 1) {
        d.setDate(d.getDate() <= 15 ? 16 : 1)
        if (d.getDate() === 1) d.setMonth(d.getMonth() + 1)
      } else {
        if (d.getDate() > 15) d.setDate(1)
        else { d.setMonth(d.getMonth() - 1); d.setDate(16) }
      }
    }
    setCurrentDate(d)
  }

  const goToToday = () => setCurrentDate(new Date())

  // Load employees
  useEffect(() => {
    (async () => {
      const freq = viewMode === 'semanal' ? 'SEMANAL' : 'QUINCENAL'
      const { data } = await supabase
        .from('employees')
        .select('id,nombre,tipo_alta,sueldo_neto_semanal,sueldo_neto_quincenal,puesto,area,rfc,banco,cuenta,clabe')
        .eq('activo', true)
        .eq('tipo_alta', freq)
        .order('nombre')
      setEmployees((data as Employee[]) || [])
    })()
  }, [viewMode])

  // Load period + items for current range
  const loadPeriod = useCallback(async () => {
    setLoading(true)
    setDirty({})

    const freq = viewMode === 'semanal' ? 'semanal' : 'quincenal'
    const startStr = fmtDate(range.start)

    // Find existing period
    const { data: periods } = await supabase
      .from('payroll_periods')
      .select('*')
      .eq('frequency', freq)
      .eq('period_start', startStr)
      .limit(1)

    const existing = periods && periods.length > 0 ? periods[0] as PayrollPeriod : null
    setPeriod(existing)

    if (existing) {
      const { data: itemData } = await supabase
        .from('payroll_items')
        .select('*')
        .eq('period_id', existing.id)
      setItems((itemData as PayrollItem[]) || [])
    } else {
      setItems([])
    }

    setLoading(false)
  }, [viewMode, range])

  useEffect(() => { loadPeriod() }, [loadPeriod])

  // Días de falta (sin goce) por empleado dentro del rango del periodo, desde Ausencias.
  const fetchFaltasDias = async (startStr: string, endStr: string): Promise<Record<string, number>> => {
    const { data } = await supabase
      .from('ausencias')
      .select('employee_id, tipo, fecha_inicio, fecha_fin, dias_solicitados, status')
    const map: Record<string, number> = {}
    ;(data || []).forEach((a: any) => {
      const tipo = String(a.tipo || '').toLowerCase()
      const esFalta = tipo.includes('falta') || tipo.includes('sin goce') || tipo.includes('injustific')
      if (!esFalta) return
      const st = String(a.status || '').toLowerCase()
      if (['rechazado', 'rechazada', 'cancelado', 'cancelada'].includes(st)) return
      const ini: string = a.fecha_inicio
      const fin: string = a.fecha_fin || a.fecha_inicio
      if (!ini) return
      // Traslape con el rango del periodo
      const s = ini > startStr ? ini : startStr
      const e = fin < endStr ? fin : endStr
      if (s > e) return
      const days = Math.floor((Date.parse(e) - Date.parse(s)) / 86400000) + 1
      if (days > 0) map[a.employee_id] = (map[a.employee_id] || 0) + days
    })
    return map
  }

  // Descuento por faltas en efectivo = días de falta × sueldo diario del periodo.
  const descFaltasMonto = (sueldoNeto: number, dias: number): number => {
    if (!dias) return 0
    const diasPeriodo = viewMode === 'semanal' ? 7 : 15
    return Math.round((sueldoNeto / diasPeriodo) * dias * 100) / 100
  }

  // Create period + auto-populate items
  const createPeriod = async () => {
    setLoading(true)
    const freq = viewMode === 'semanal' ? 'semanal' : 'quincenal'
    const startStr = fmtDate(range.start)
    const endStr = fmtDate(range.end)
    const m = range.start.getMonth() + 1
    const y = range.start.getFullYear()

    const { data: newPeriod, error: pErr } = await supabase
      .from('payroll_periods')
      .insert({
        frequency: freq,
        period_start: startStr,
        period_end: endStr,
        mes: m,
        anio: y,
        semana_del_mes: freq === 'semanal' ? Math.ceil(range.start.getDate() / 7) : null,
        quincena_del_mes: freq === 'quincenal' ? (range.start.getDate() <= 15 ? 1 : 2) : null,
        estatus: 'borrador',
      })
      .select()
      .single()

    if (pErr || !newPeriod) {
      alert('Error creando periodo: ' + (pErr?.message || 'unknown'))
      setLoading(false)
      return
    }

    // Auto-pull cajas chicas per employee in this date range
    const { data: cajaData } = await supabase
      .from('caja_chica_tickets')
      .select('employee_id, monto')
      .in('estatus', ['aprobado', 'pagado'])
      .gte('fecha', startStr)
      .lte('fecha', endStr)

    const cajaMap: Record<string, number> = {}
    ;(cajaData || []).forEach((t: any) => {
      cajaMap[t.employee_id] = (cajaMap[t.employee_id] || 0) + Number(t.monto || 0)
    })

    // Auto-pull faltas (descuento en efectivo)
    const faltasMap = await fetchFaltasDias(startStr, endStr)

    // Auto-pull overtime from attendance
    const { data: attendanceData } = await supabase
      .from('installer_attendance')
      .select('employee_id, hora, tipo, fecha')
      .gte('fecha', startStr)
      .lte('fecha', endStr)

    // Calculate overtime minutes per employee (exit after 18:00)
    const overtimeMap: Record<string, number> = {}
    ;(attendanceData || []).forEach((a: any) => {
      if (a.tipo === 'salida' && a.hora) {
        const exitTime = new Date(a.hora)
        const exitHour = exitTime.getHours()
        const exitMin = exitTime.getMinutes()
        const totalMinutes = exitHour * 60 + exitMin
        const threshold = 18 * 60 // 6 PM
        if (totalMinutes > threshold) {
          const extraMin = totalMinutes - threshold
          overtimeMap[a.employee_id] = (overtimeMap[a.employee_id] || 0) + extraMin
        }
      }
    })

    // Create payroll items for each employee
    const itemsToInsert = employees.map(emp => {
      const sueldoNeto = Number(
        viewMode === 'semanal' ? emp.sueldo_neto_semanal : emp.sueldo_neto_quincenal
      ) || 0
      const cajaChica = cajaMap[emp.id] || 0
      const descFaltas = descFaltasMonto(sueldoNeto, faltasMap[emp.id] || 0)
      const horasExtraMin = overtimeMap[emp.id] || 0
      // Overtime rate: sueldo_neto / hours_in_period * 2 (doble)
      const hoursInPeriod = viewMode === 'semanal' ? 48 : 96
      const hourlyRate = sueldoNeto / hoursInPeriod
      const horasExtraMonto = Math.round((horasExtraMin / 60) * hourlyRate * 2 * 100) / 100
      const totalEf = sueldoNeto + cajaChica + horasExtraMonto - descFaltas

      return {
        period_id: newPeriod.id,
        employee_id: emp.id,
        sueldo_neto_pactado: sueldoNeto,
        neto_a_pagar_cfdi: 0, // To be filled from accountant data
        diferencia_neto_imss: sueldoNeto, // Initially all goes to cash
        horas_extras_monto: horasExtraMonto,
        bono_puntualidad: 0,
        caja_chica: cajaChica,
        descuento_infonavit_efectivo: 0,
        descuento_faltas: descFaltas,
        total_efectivo_calculado: totalEf,
        total_efectivo_final: totalEf,
        efectivo_pagado: false,
        conciliado_transferencia: false,
      }
    })

    if (itemsToInsert.length > 0) {
      await supabase.from('payroll_items').insert(itemsToInsert)
    }

    await loadPeriod()
  }

  // Update a single field on a payroll item (local state)
  const updateItemField = (itemId: string, field: string, value: number) => {
    setDirty(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: value },
    }))
  }

  // Save all dirty changes
  const saveChanges = async () => {
    setSaving(true)
    const entries = Object.entries(dirty)

    for (const [itemId, changes] of entries) {
      const item = items.find(i => i.id === itemId)
      if (!item) continue

      // Merge changes into item to recalculate
      const merged = { ...item, ...changes }
      const sueldoNeto = Number(merged.sueldo_neto_pactado) || 0
      const netoTransferido = Number(merged.neto_a_pagar_cfdi) || 0
      const efectivoBase = sueldoNeto - netoTransferido
      const cajaChica = Number(merged.caja_chica) || 0
      const horasExtra = Number(merged.horas_extras_monto) || 0
      const bonos = Number(merged.bono_puntualidad) || 0
      const descInfonavit = Number(merged.descuento_infonavit_efectivo) || 0
      const descFaltas = Number(merged.descuento_faltas) || 0
      const totalEfectivo = efectivoBase + cajaChica + horasExtra + bonos - descInfonavit - descFaltas
      const redondeo = Number(merged.redondeo) || 0

      await supabase.from('payroll_items').update({
        ...changes,
        diferencia_neto_imss: efectivoBase,
        total_efectivo_calculado: totalEfectivo,
        total_efectivo_final: totalEfectivo + redondeo,
      }).eq('id', itemId)
    }

    // Update period totals
    if (period) {
      const { data: freshItems } = await supabase
        .from('payroll_items')
        .select('*')
        .eq('period_id', period.id)

      const allItems = (freshItems || []) as PayrollItem[]
      const totals = {
        total_transferencia: allItems.reduce((s, i) => s + (Number(i.neto_a_pagar_cfdi) || 0), 0),
        total_efectivo: allItems.reduce((s, i) => s + (Number(i.total_efectivo_final) || 0), 0),
        total_horas_extras: allItems.reduce((s, i) => s + (Number(i.horas_extras_monto) || 0), 0),
        total_bonos: allItems.reduce((s, i) => s + (Number(i.bono_puntualidad) || 0), 0),
        total_caja_chica: allItems.reduce((s, i) => s + (Number(i.caja_chica) || 0), 0),
      }
      await supabase.from('payroll_periods').update(totals).eq('id', period.id)
    }

    setDirty({})
    await loadPeriod()
    setSaving(false)
  }

  // Recalcular: re-jala las cajas chicas aprobadas del rango del periodo por empleado
  // y actualiza cada item (aunque el periodo ya exista y los tickets se hayan
  // aprobado después de crearlo). Sobrescribe caja_chica con la suma vigente.
  const recalcularPeriodo = async () => {
    if (!period) { await loadPeriod(); return }
    setSaving(true)
    const startStr = period.period_start
    const endStr = period.period_end

    // Cajas chicas aprobadas/pagadas dentro del rango
    const { data: cajaData } = await supabase
      .from('caja_chica_tickets')
      .select('employee_id, monto')
      .in('estatus', ['aprobado', 'pagado'])
      .gte('fecha', startStr)
      .lte('fecha', endStr)
    const cajaMap: Record<string, number> = {}
    ;(cajaData || []).forEach((t: any) => {
      cajaMap[t.employee_id] = (cajaMap[t.employee_id] || 0) + Number(t.monto || 0)
    })

    // Faltas (descuento en efectivo)
    const faltasMap = await fetchFaltasDias(startStr, endStr)

    // Actualizar cada item cuya caja chica o descuento por faltas haya cambiado
    const { data: itemData } = await supabase.from('payroll_items').select('*').eq('period_id', period.id)
    const its = (itemData as PayrollItem[]) || []
    for (const it of its) {
      const cajaChica = cajaMap[it.employee_id] || 0
      const sueldoNeto = Number(it.sueldo_neto_pactado) || 0
      const descFaltas = descFaltasMonto(sueldoNeto, faltasMap[it.employee_id] || 0)
      if (Number(it.caja_chica || 0) === cajaChica && Number(it.descuento_faltas || 0) === descFaltas) continue
      const netoTransferido = Number(it.neto_a_pagar_cfdi) || 0
      const efectivoBase = sueldoNeto - netoTransferido
      const horasExtra = Number(it.horas_extras_monto) || 0
      const bonos = Number(it.bono_puntualidad) || 0
      const descInfonavit = Number(it.descuento_infonavit_efectivo) || 0
      const redondeo = Number(it.redondeo) || 0
      const totalEfectivo = efectivoBase + cajaChica + horasExtra + bonos - descInfonavit - descFaltas
      await supabase.from('payroll_items').update({
        caja_chica: cajaChica,
        descuento_faltas: descFaltas,
        total_efectivo_calculado: totalEfectivo,
        total_efectivo_final: totalEfectivo + redondeo,
      }).eq('id', it.id)
    }

    // Recalcular totales del periodo
    const { data: fresh } = await supabase.from('payroll_items').select('*').eq('period_id', period.id)
    const allItems = (fresh as PayrollItem[]) || []
    await supabase.from('payroll_periods').update({
      total_transferencia: allItems.reduce((s, i) => s + (Number(i.neto_a_pagar_cfdi) || 0), 0),
      total_efectivo: allItems.reduce((s, i) => s + (Number(i.total_efectivo_final) || 0), 0),
      total_horas_extras: allItems.reduce((s, i) => s + (Number(i.horas_extras_monto) || 0), 0),
      total_bonos: allItems.reduce((s, i) => s + (Number(i.bono_puntualidad) || 0), 0),
      total_caja_chica: allItems.reduce((s, i) => s + (Number(i.caja_chica) || 0), 0),
    }).eq('id', period.id)

    await loadPeriod()
    setSaving(false)
  }

  // ── Descargar layout BBVA (.txt) para transferencias de nómina ──
  // Formato de ancho fijo, 108 chars/línea, CRLF. Campos:
  //   consecutivo(9) + 16 espacios + cuenta(12) + 10 espacios + importe centavos(15) + nombre(40) + '001001'
  // La cuenta BBVA guardada es de 10 dígitos; el layout la usa a 12 con prefijo '99'.
  const descargarLayoutBBVA = () => {
    const toAscii = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Ñ/g, 'N').replace(/ñ/g, 'n').toUpperCase()
    const rows = mergedItems
      .map(it => ({ emp: (it as any)._emp as Employee | undefined, amount: Number(it.neto_a_pagar_cfdi) || 0 }))
      .filter(r => !!r.emp && r.amount > 0)
      .filter(r => {
        const banco = r.emp!.banco || ''
        const clabeDig = (r.emp!.clabe || '').replace(/\D/g, '')
        return /bbva/i.test(banco) || clabeDig.startsWith('012')
      })

    if (rows.length === 0) {
      alert('No hay transferencias BBVA con monto en "Neto transferido". Captura los montos a transferir primero.')
      return
    }

    // Validar cuentas: se leen los dígitos (quitando espacios/texto). Válidas = 10 o 12 dígitos.
    const included: { emp: Employee; amount: number; acct: string }[] = []
    const invalidos: string[] = []
    rows.forEach(r => {
      const digRaw = (r.emp!.cuenta || '').replace(/\s+/g, '')
      const dig = (digRaw.match(/\d+/) || [''])[0]
      if (dig.length !== 10 && dig.length !== 12) { invalidos.push(`${r.emp!.nombre} (${r.emp!.cuenta || 'sin cuenta'})`); return }
      included.push({ emp: r.emp!, amount: r.amount, acct: dig.length === 10 ? '99' + dig : dig })
    })

    if (included.length === 0) {
      alert('Ninguna cuenta BBVA es válida.\nCorrige estas cuentas (deben ser 10 dígitos):\n\n' + invalidos.join('\n'))
      return
    }

    const lines = included.map((r, i) => {
      const seq = String(i + 1).padStart(9, '0')
      const imp = String(Math.round(r.amount * 100)).padStart(15, '0').slice(-15)
      const name = toAscii(r.emp.nombre || '').padEnd(40, ' ').slice(0, 40)
      return seq + ' '.repeat(16) + r.acct + ' '.repeat(10) + imp + name + '001001'
    })
    const content = lines.join('\r\n') + '\r\n'
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `PAGO_NOMINA_BBVA_${period?.period_start || ''}.txt`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)

    const total = included.reduce((s, r) => s + r.amount, 0)
    let msg = `Layout BBVA generado: ${included.length} transferencias por ${F(total)}.`
    if (invalidos.length) msg += `\n\n⚠️ ${invalidos.length} con cuenta inválida — NO incluidos (corrige su cuenta a 10 dígitos):\n` + invalidos.join('\n')
    alert(msg)
  }

  // ── Descargar layout SPEI (.txt) para transferencias a NO BBVA ──
  // Formato "Transferencias en Tiempo Real" SPEI, 128 caracteres/línea, CRLF. Campos:
  //   CLABE destino(18) + cuenta origen(18) + divisa(3) + importe(16 con punto) +
  //   titular(30) + tipo cuenta(2='40' CLABE) + clave banco(3) + concepto(30) + referencia(7) + 'H'(1)
  const descargarLayoutSPEI = () => {
    const toAscii = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Ñ/g, 'N').replace(/ñ/g, 'n').toUpperCase()
    const ORIGEN_BBVA = '0118270236' // cuenta BBVA MXN de OMM (10 dígitos)
    const origen18 = ('00000000' + ORIGEN_BBVA).slice(-18) // 8 ceros + 10 dígitos

    const rows = mergedItems
      .map(it => ({ emp: (it as any)._emp as Employee | undefined, amount: Number(it.neto_a_pagar_cfdi) || 0 }))
      .filter(r => !!r.emp && r.amount > 0)
      .filter(r => {
        const clabe = (r.emp!.clabe || '').replace(/\D/g, '')
        const esBBVA = /bbva/i.test(r.emp!.banco || '') || clabe.startsWith('012')
        return !esBBVA // solo NO BBVA
      })

    if (rows.length === 0) {
      alert('No hay transferencias a bancos distintos de BBVA con monto en "Neto transferido".')
      return
    }

    const included: { emp: Employee; amount: number; clabe: string }[] = []
    const invalidos: string[] = []
    rows.forEach(r => {
      const clabe = (r.emp!.clabe || '').replace(/\D/g, '')
      if (clabe.length !== 18) { invalidos.push(`${r.emp!.nombre} (CLABE: ${r.emp!.clabe || 'falta'})`); return }
      included.push({ emp: r.emp!, amount: r.amount, clabe })
    })

    if (included.length === 0) {
      alert('Ninguna CLABE es válida (deben ser 18 dígitos).\nCorrige estas:\n\n' + invalidos.join('\n'))
      return
    }

    const concepto30 = toAscii('NOMINA').padEnd(30, ' ').slice(0, 30)
    const lines = included.map((r, i) => {
      const destino18 = r.clabe.slice(0, 18)                                   // CLABE interbancaria (18)
      const divisa = 'MXN'                                                     // valor fijo
      const importe16 = r.amount.toFixed(2).padStart(16, '0').slice(-16)       // con punto y 2 decimales
      const titular30 = toAscii(r.emp.nombre || '').padEnd(30, ' ').slice(0, 30)
      const tipoCuenta = '40'                                                  // 40 = Cuenta CLABE Interbancaria
      const claveBanco = r.clabe.slice(0, 3)                                   // primeros 3 dígitos de la CLABE
      const referencia7 = String(i + 1).padStart(7, '0').slice(-7)
      const disp = 'H'                                                         // mismo día
      return destino18 + origen18 + divisa + importe16 + titular30 + tipoCuenta + claveBanco + concepto30 + referencia7 + disp
    })
    const content = lines.join('\r\n') + '\r\n'
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `PAGO_SPEI_${period?.period_start || ''}.txt`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)

    const total = included.reduce((s, r) => s + r.amount, 0)
    let msg = `Layout SPEI generado: ${included.length} transferencias por ${F(total)}.`
    if (invalidos.length) msg += `\n\n⚠️ ${invalidos.length} sin CLABE válida — NO incluidos:\n` + invalidos.join('\n')
    alert(msg)
  }

  // ── Comprobante de transferencia (a nivel periodo) ──
  // Al subirlo, marca la transferencia como pagada y concilia todos los items.
  const subirComprobanteTransferencia = async (file: File) => {
    if (!period) return
    setSubiendoComp(true)
    try {
      // 1. Guardar el archivo
      const ext = (file.name.split('.').pop() || 'dat').toLowerCase()
      const path = `${period.id}/comprobante_${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('nomina-comprobantes').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('nomina-comprobantes').getPublicUrl(path)
      await supabase.from('payroll_periods').update({
        comprobante_transferencia_url: pub.publicUrl,
        comprobante_transferencia_path: path,
        transferencia_pagada_at: new Date().toISOString(),
      }).eq('id', period.id)

      const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)
      if (!isPdf) {
        await loadPeriod()
        alert('Comprobante (imagen) guardado.\nComo es imagen no puedo detectar automáticamente quién se pagó — marca cada transferencia con el icono de billete en la columna Estado, o sube el PDF del comprobante para marcarlas solas.')
        return
      }

      // 2. Leer el comprobante y marcar SOLO las cuentas que aparecen en él
      const { accounts } = await parseComprobantePagos(file)
      const { data: itemData } = await supabase.from('payroll_items').select('*').eq('period_id', period.id)
      const its = (itemData as PayrollItem[]) || []
      const empById = new Map(employees.map(e => [e.id, e]))
      const toMark: string[] = []
      for (const it of its) {
        const emp = empById.get(it.employee_id)
        if (!emp) continue
        const cuentaDig = ((emp.cuenta || '').replace(/\s/g, '').match(/\d+/) || [''])[0]
        const clabeDig = (emp.clabe || '').replace(/\D/g, '')
        if ((cuentaDig && accounts.has(cuentaDig)) || (clabeDig && accounts.has(clabeDig))) toMark.push(it.id)
      }
      if (toMark.length) {
        await supabase.from('payroll_items').update({ conciliado_transferencia: true }).in('id', toMark)
      }

      // 3. transferencia_pagada del periodo = true solo si TODOS los que transfieren ya están cubiertos
      const { data: fresh } = await supabase.from('payroll_items').select('neto_a_pagar_cfdi, conciliado_transferencia').eq('period_id', period.id)
      const transfiriendo = (fresh || []).filter((i: any) => Number(i.neto_a_pagar_cfdi) > 0)
      const todosPagados = transfiriendo.length > 0 && transfiriendo.every((i: any) => i.conciliado_transferencia)
      await supabase.from('payroll_periods').update({ transferencia_pagada: todosPagados }).eq('id', period.id)

      await loadPeriod()
      const noEncontradas = accounts.size - toMark.length
      let msg = `Comprobante procesado: ${toMark.length} transferencia(s) marcadas como pagadas.`
      if (noEncontradas > 0) msg += `\n${noEncontradas} cuenta(s) del comprobante no coinciden con empleados de este periodo.`
      if (!todosPagados) msg += `\n\nAún faltan transferencias por comprobar (p. ej. las de otros bancos por SPEI). Sube su comprobante para marcarlas.`
      alert(msg)
    } catch (e: any) {
      alert('No se pudo subir el comprobante: ' + (e.message || e))
    } finally {
      setSubiendoComp(false)
    }
  }

  const quitarComprobanteTransferencia = async () => {
    if (!period) return
    if (!confirm('¿Quitar el comprobante y marcar la transferencia como NO pagada?')) return
    if (period.comprobante_transferencia_path) {
      await supabase.storage.from('nomina-comprobantes').remove([period.comprobante_transferencia_path])
    }
    await supabase.from('payroll_periods').update({
      comprobante_transferencia_url: null,
      comprobante_transferencia_path: null,
      transferencia_pagada: false,
      transferencia_pagada_at: null,
    }).eq('id', period.id)
    await supabase.from('payroll_items').update({ conciliado_transferencia: false }).eq('period_id', period.id)
    await loadPeriod()
  }

  // Close/lock period
  const closePeriod = async () => {
    if (!period) return
    if (!confirm('¿Cerrar este periodo? Ya no se podrán editar los montos.')) return
    await supabase.from('payroll_periods').update({ estatus: 'cerrado' }).eq('id', period.id)
    await loadPeriod()
  }

  // PDF Import
  const [importStatus, setImportStatus] = useState<{
    show: boolean
    parsing: boolean
    results: { pdfName: string; dbName: string | null; neto: number; matched: boolean }[]
    applied: boolean
  }>({ show: false, parsing: false, results: [], applied: false })

  const handlePdfImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset input

    setImportStatus({ show: true, parsing: true, results: [], applied: false })

    try {
      const parsed = await parseSFacilNominaPDF(file)

      console.log('[NominaPDF] Parsed result:', parsed.empleados.map(e => e.nombre))

      // Match PDF employees to DB employees (pass RFC too)
      const dbEmps = employees.map(e => ({ id: e.id, nombre: e.nombre, rfc: e.rfc }))
      const results = parsed.empleados.map(pdfEmp => {
        const match = matchEmployeeByName(
          { nombre: pdfEmp.nombre, rfc: pdfEmp.rfc },
          dbEmps
        )
        return {
          pdfName: pdfEmp.nombre,
          pdfRfc: pdfEmp.rfc,
          dbName: match?.nombre || null,
          dbId: match?.id || null,
          neto: pdfEmp.netoAPagar,
          matched: !!match,
          score: match?.score || 0,
        }
      })

      console.log('[NominaPDF] Match results:', results.map(r =>
        `${r.pdfName} → ${r.matched ? r.dbName : 'NO MATCH'} (${(r.score * 100).toFixed(0)}%)`
      ))

      setImportStatus({ show: true, parsing: false, results, applied: false })
    } catch (err: any) {
      console.error('[NominaPDF] Parse error:', err)
      alert('Error al parsear PDF: ' + (err.message || err))
      setImportStatus({ show: false, parsing: false, results: [], applied: false })
    }
  }

  const applyPdfImport = () => {
    const results = importStatus.results as any[]
    const newDirty = { ...dirty }

    for (const r of results) {
      if (!r.matched || !r.dbId) continue
      const item = items.find(i => i.employee_id === r.dbId)
      if (!item) continue
      newDirty[item.id] = {
        ...newDirty[item.id],
        neto_a_pagar_cfdi: r.neto,
      }
    }

    setDirty(newDirty)
    setImportStatus(prev => ({ ...prev, applied: true }))
  }

  // Merged items (item + dirty overrides)
  const mergedItems = useMemo(() => {
    return items.map(item => {
      const overrides = dirty[item.id] || {}
      const m = { ...item, ...overrides }
      const sueldoNeto = Number(m.sueldo_neto_pactado) || 0
      const netoTransferido = Number(m.neto_a_pagar_cfdi) || 0
      const efectivoBase = sueldoNeto - netoTransferido
      const cajaChica = Number(m.caja_chica) || 0
      const horasExtra = Number(m.horas_extras_monto) || 0
      const bonos = Number(m.bono_puntualidad) || 0
      const descInfonavit = Number(m.descuento_infonavit_efectivo) || 0
      const descFaltas = Number(m.descuento_faltas) || 0
      const totalEfectivo = efectivoBase + cajaChica + horasExtra + bonos - descInfonavit - descFaltas
      return {
        ...m,
        _efectivoBase: efectivoBase,
        _totalEfectivo: totalEfectivo,
        _emp: employees.find(e => e.id === m.employee_id),
      }
    })
  }, [items, dirty, employees])

  // KPIs
  const kpis = useMemo(() => {
    const totalSueldo = mergedItems.reduce((s, i) => s + (Number(i.sueldo_neto_pactado) || 0), 0)
    const totalTransf = mergedItems.reduce((s, i) => s + (Number(i.neto_a_pagar_cfdi) || 0), 0)
    const totalEfectivo = mergedItems.reduce((s, i) => s + i._totalEfectivo, 0)
    const totalCaja = mergedItems.reduce((s, i) => s + (Number(i.caja_chica) || 0), 0)
    const totalHE = mergedItems.reduce((s, i) => s + (Number(i.horas_extras_monto) || 0), 0)
    const totalBonos = mergedItems.reduce((s, i) => s + (Number(i.bono_puntualidad) || 0), 0)
    const totalDesc = mergedItems.reduce((s, i) => s + (Number(i.descuento_faltas) || 0), 0)
    return { totalSueldo, totalTransf, totalEfectivo, totalCaja, totalHE, totalBonos, totalDesc }
  }, [mergedItems])

  /* ── Toggle efectivo pagado → auto-insert/delete cash_movement ── */
  async function toggleEfectivoPagado(item: any) {
    const newVal = !item.efectivo_pagado
    const empName = item._emp?.nombre || 'Empleado'
    const periodLabel = period ? `${viewMode === 'semanal' ? 'Semana' : 'Quincena'} ${fmtDateLabel(range.start)}` : 'Nómina'

    // Update payroll_items
    await supabase.from('payroll_items').update({ efectivo_pagado: newVal }).eq('id', item.id)

    if (newVal) {
      // Insert cash_movement
      await supabase.from('cash_movements').insert({
        tipo: 'nomina_efectivo',
        direccion: 'egreso',
        persona: empName,
        concepto: `${periodLabel} - efectivo`,
        monto: item._totalEfectivo,
        fecha: new Date().toISOString().slice(0, 10),
        payroll_item_id: item.id,
      })
    } else {
      // Remove cash_movement
      await supabase.from('cash_movements').delete().eq('payroll_item_id', item.id)
    }

    // Refresh local state
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, efectivo_pagado: newVal } : i))
  }

  async function toggleTransferencia(item: any) {
    const newVal = !item.conciliado_transferencia
    await supabase.from('payroll_items').update({ conciliado_transferencia: newVal }).eq('id', item.id)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, conciliado_transferencia: newVal } : i))
  }

  const isClosed = period?.estatus === 'cerrado'
  const hasDirty = Object.keys(dirty).length > 0
  const isCurrentPeriod = fmtDate(range.start) <= fmtDate(new Date()) && fmtDate(new Date()) <= fmtDate(range.end)

  return (
    <div>
      {/* View mode selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: '#111', borderRadius: 8, overflow: 'hidden', border: '1px solid #222' }}>
          <button
            onClick={() => setViewMode('semanal')}
            style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer',
              background: viewMode === 'semanal' ? '#f59e0b' : 'transparent',
              color: viewMode === 'semanal' ? '#000' : '#888',
            }}
          >
            Semanal
          </button>
          <button
            onClick={() => setViewMode('quincenal')}
            style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer',
              background: viewMode === 'quincenal' ? '#60a5fa' : 'transparent',
              color: viewMode === 'quincenal' ? '#000' : '#888',
            }}
          >
            Quincenal
          </button>
        </div>

        {/* Period navigator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12 }}>
          <button onClick={() => navigate(-1)} style={navBtnStyle}><ChevronLeft size={16} /></button>
          <div style={{
            padding: '8px 16px', background: '#111', borderRadius: 8, border: '1px solid #222',
            fontSize: 13, color: '#eee', fontWeight: 500, minWidth: 260, textAlign: 'center',
          }}>
            {periodLabel(viewMode, range.start, range.end)}
          </div>
          <button onClick={() => navigate(1)} style={navBtnStyle}><ChevronRight size={16} /></button>
        </div>

        {!isCurrentPeriod && (
          <button onClick={goToToday} style={{ ...navBtnStyle, fontSize: 12, padding: '6px 12px', gap: 4, display: 'flex', alignItems: 'center' }}>
            <Calendar size={13} /> Hoy
          </button>
        )}

        <div style={{ flex: 1 }} />

        {period && isClosed && (
          <Badge label="CERRADO" color="#ef4444" />
        )}
        {period && !isClosed && (
          <Badge label="BORRADOR" color="#f59e0b" />
        )}
        {isCurrentPeriod && (
          <Badge label={viewMode === 'semanal' ? 'SEMANA ACTUAL' : 'QUINCENA ACTUAL'} color="#10B981" />
        )}
      </div>

      {/* KPI Cards */}
      {period && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 20 }}>
          <KpiCard label="Sueldo neto total" value={F(kpis.totalSueldo)} />
          <KpiCard label="Total transferencia" value={F(kpis.totalTransf)} color="#60a5fa" />
          <KpiCard label="Total efectivo" value={F(kpis.totalEfectivo)} color="#f59e0b" />
          <KpiCard label="Cajas chicas" value={F(kpis.totalCaja)} color="#a78bfa" />
          <KpiCard label="Horas extra" value={F(kpis.totalHE)} color="#fb923c" />
          <KpiCard label="Bonos" value={F(kpis.totalBonos)} color="#10B981" />
        </div>
      )}

      {loading ? (
        <Loading />
      ) : !period ? (
        /* No period exists yet */
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Calendar size={48} style={{ color: '#333', marginBottom: 16 }} />
          <div style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
            No hay periodo {viewMode} creado para estas fechas
          </div>
          <div style={{ color: '#666', fontSize: 12, marginBottom: 24 }}>
            {periodLabel(viewMode, range.start, range.end)}
          </div>
          <Btn onClick={createPeriod} variant="primary">
            <Plus size={14} /> Crear periodo y cargar empleados
          </Btn>
          <div style={{ color: '#555', fontSize: 11, marginTop: 12 }}>
            Se cargarán {employees.length} empleados {viewMode === 'semanal' ? 'semanales' : 'quincenales'} con sus cajas chicas y horas extra automáticamente
          </div>
        </div>
      ) : (
        /* Period exists — show table */
        <>
          {/* Action bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#666' }}>
              {mergedItems.length} empleados · {viewMode === 'semanal' ? 'Semana' : 'Quincena'}
            </span>
            <div style={{ flex: 1 }} />

            {!isClosed && (
              <>
                {/* PDF Import */}
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', fontSize: 12, fontWeight: 500,
                  background: '#1a1a2e', border: '1px solid #60a5fa40', borderRadius: 6,
                  color: '#60a5fa', cursor: 'pointer', transition: 'background 0.15s',
                }}>
                  <Upload size={13} /> Importar PDF nómina
                  <input type="file" accept=".pdf" onChange={handlePdfImport} style={{ display: 'none' }} />
                </label>

                <Btn onClick={recalcularPeriodo} variant="ghost" style={{ fontSize: 12 }} disabled={saving}>
                  <RefreshCw size={13} /> {saving ? 'Recalculando...' : 'Recalcular'}
                </Btn>
                <Btn onClick={descargarLayoutBBVA} variant="ghost" style={{ fontSize: 12, color: '#60a5fa' }} title="TXT de transferencias mismo banco (BBVA). Usa el Neto transferido.">
                  <Banknote size={13} /> Layout BBVA
                </Btn>
                <Btn onClick={descargarLayoutSPEI} variant="ghost" style={{ fontSize: 12, color: '#a78bfa' }} title="TXT SPEI para transferencias a otros bancos (NO BBVA), usando la CLABE de cada empleado.">
                  <Banknote size={13} /> Layout SPEI
                </Btn>
                {hasDirty && (
                  <Btn onClick={saveChanges} variant="primary" style={{ fontSize: 12 }} disabled={saving}>
                    <Save size={13} /> {saving ? 'Guardando...' : `Guardar cambios (${Object.keys(dirty).length})`}
                  </Btn>
                )}
                <Btn onClick={closePeriod} variant="ghost" style={{ fontSize: 12, color: '#ef4444' }}>
                  <Lock size={13} /> Cerrar periodo
                </Btn>
              </>
            )}
          </div>

          {/* Comprobante de transferencia (nivel periodo) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
            padding: '10px 14px', borderRadius: 8,
            background: period.transferencia_pagada ? 'rgba(16,185,129,0.08)' : '#0f0f0f',
            border: '1px solid ' + (period.transferencia_pagada ? 'rgba(16,185,129,0.3)' : '#1a1a1a'),
          }}>
            <Banknote size={15} style={{ color: period.transferencia_pagada ? '#10B981' : '#60a5fa' }} />
            {period.transferencia_pagada ? (
              <>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#10B981' }}>
                  Transferencia pagada{period.transferencia_pagada_at ? ` · ${new Date(period.transferencia_pagada_at).toLocaleDateString('es-MX')}` : ''}
                </span>
                {period.comprobante_transferencia_url && (
                  <a href={period.comprobante_transferencia_url} target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, color: '#60a5fa', textDecoration: 'underline' }}>
                    Ver comprobante
                  </a>
                )}
                <div style={{ flex: 1 }} />
                {!isClosed && (
                  <button onClick={quitarComprobanteTransferencia}
                    style={{ fontSize: 11, color: '#888', background: 'none', border: '1px solid #333', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Quitar
                  </button>
                )}
              </>
            ) : (
              <>
                {(() => {
                  const transf = mergedItems.filter(i => Number(i.neto_a_pagar_cfdi) > 0)
                  const pagados = transf.filter(i => (i as any).conciliado_transferencia).length
                  return (
                    <span style={{ fontSize: 12, color: '#888' }}>
                      {pagados > 0
                        ? <>Transferencias comprobadas: <b style={{ color: '#ccc' }}>{pagados}/{transf.length}</b>. Sube el comprobante del resto (p. ej. SPEI de otros bancos).</>
                        : <>Sube el comprobante (PDF) de la transferencia para marcar como pagados solo a los que aparecen en él.</>}
                    </span>
                  )
                })()}
                {period.comprobante_transferencia_url && (
                  <a href={period.comprobante_transferencia_url} target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, color: '#60a5fa', textDecoration: 'underline' }}>
                    Ver último comprobante
                  </a>
                )}
                <div style={{ flex: 1 }} />
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', fontSize: 12, fontWeight: 500,
                  background: '#1a2e1a', border: '1px solid #10B98140', borderRadius: 6,
                  color: '#10B981', cursor: subiendoComp ? 'wait' : 'pointer',
                }}>
                  <Upload size={13} /> {subiendoComp ? 'Procesando...' : 'Subir comprobante'}
                  <input type="file" accept="image/*,application/pdf" disabled={subiendoComp}
                    onChange={e => { const f = e.target.files?.[0]; if (f) subirComprobanteTransferencia(f); e.currentTarget.value = '' }}
                    style={{ display: 'none' }} />
                </label>
              </>
            )}
          </div>

          {mergedItems.length === 0 ? (
            <EmptyState message="No hay empleados en este periodo." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead>
                  <tr>
                    <Th>Empleado</Th>
                    <Th>Puesto</Th>
                    <Th right>Sueldo neto</Th>
                    <Th right>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        <Banknote size={12} /> Neto transferido
                      </span>
                    </Th>
                    <Th right>Efectivo base</Th>
                    <Th right>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        <DollarSign size={12} /> Cajas chicas
                      </span>
                    </Th>
                    <Th right>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        <Clock size={12} /> Hrs extra
                      </span>
                    </Th>
                    <Th right>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        <Gift size={12} /> Bonos
                      </span>
                    </Th>
                    <Th right>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }} title="Descuento en efectivo por faltas (auto desde Ausencias, editable)">
                        Descuento
                      </span>
                    </Th>
                    <Th right>Total efectivo</Th>
                    <Th>Estado</Th>
                  </tr>
                </thead>
                <tbody>
                  {mergedItems.map(item => {
                    const emp = item._emp
                    return (
                      <tr key={item.id} style={{ borderBottom: '1px solid #161616' }}>
                        <Td>
                          <span style={{ fontWeight: 500, color: '#eee', fontSize: 13 }}>
                            {emp?.nombre || '—'}
                          </span>
                        </Td>
                        <Td muted>{emp?.puesto || '—'}</Td>
                        <Td right>
                          <span style={{ color: '#eee' }}>{F(Number(item.sueldo_neto_pactado) || 0)}</span>
                        </Td>
                        <Td right>
                          {isClosed ? (
                            <span style={{ color: '#60a5fa' }}>{F(Number(item.neto_a_pagar_cfdi) || 0)}</span>
                          ) : (
                            <EditableCell
                              value={Number(item.neto_a_pagar_cfdi) || 0}
                              onChange={v => updateItemField(item.id, 'neto_a_pagar_cfdi', v)}
                              color="#60a5fa"
                            />
                          )}
                        </Td>
                        <Td right>
                          <span style={{ color: item._efectivoBase < 0 ? '#ef4444' : '#f59e0b' }}>
                            {F(item._efectivoBase)}
                          </span>
                        </Td>
                        <Td right>
                          {isClosed ? (
                            <span style={{ color: '#a78bfa' }}>{F(Number(item.caja_chica) || 0)}</span>
                          ) : (
                            <EditableCell
                              value={Number(item.caja_chica) || 0}
                              onChange={v => updateItemField(item.id, 'caja_chica', v)}
                              color="#a78bfa"
                            />
                          )}
                        </Td>
                        <Td right>
                          {isClosed ? (
                            <span style={{ color: '#fb923c' }}>{F(Number(item.horas_extras_monto) || 0)}</span>
                          ) : (
                            <EditableCell
                              value={Number(item.horas_extras_monto) || 0}
                              onChange={v => updateItemField(item.id, 'horas_extras_monto', v)}
                              color="#fb923c"
                            />
                          )}
                        </Td>
                        <Td right>
                          {isClosed ? (
                            <span style={{ color: '#10B981' }}>{F(Number(item.bono_puntualidad) || 0)}</span>
                          ) : (
                            <EditableCell
                              value={Number(item.bono_puntualidad) || 0}
                              onChange={v => updateItemField(item.id, 'bono_puntualidad', v)}
                              color="#10B981"
                            />
                          )}
                        </Td>
                        <Td right>
                          {isClosed ? (
                            <span style={{ color: '#ef4444' }}>{Number(item.descuento_faltas) ? '-' + F(Number(item.descuento_faltas)) : F(0)}</span>
                          ) : (
                            <EditableCell
                              value={Number(item.descuento_faltas) || 0}
                              onChange={v => updateItemField(item.id, 'descuento_faltas', v)}
                              color="#ef4444"
                            />
                          )}
                        </Td>
                        <Td right>
                          <span style={{
                            fontWeight: 600,
                            color: '#fff',
                            background: 'rgba(245, 158, 11, 0.15)',
                            padding: '4px 10px',
                            borderRadius: 6,
                            fontSize: 13,
                          }}>
                            {F(item._totalEfectivo)}
                          </span>
                        </Td>
                        <Td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {item.neto_a_pagar_cfdi > 0 && (
                              <span title="Transferencia conciliada" style={{ color: item.conciliado_transferencia ? '#60a5fa' : '#444', cursor: 'pointer' }}
                                onClick={() => toggleTransferencia(item)}>
                                <Banknote size={14} />
                              </span>
                            )}
                            {item._totalEfectivo > 0 && (
                              <span title={item.efectivo_pagado ? 'Efectivo pagado ✓' : 'Marcar efectivo como pagado'}
                                style={{ color: item.efectivo_pagado ? '#10B981' : '#444', cursor: 'pointer' }}
                                onClick={() => toggleEfectivoPagado(item)}>
                                <DollarSign size={14} />
                              </span>
                            )}
                            {!item.conciliado_transferencia && !item.efectivo_pagado && item.neto_a_pagar_cfdi === 0 && item._totalEfectivo === 0 && (
                              <span title="Sin montos" style={{ color: '#333' }}>
                                <AlertCircle size={14} />
                              </span>
                            )}
                          </div>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
                {/* Totals row */}
                <tfoot>
                  <tr style={{ borderTop: '2px solid #333', background: '#0a0a0a' }}>
                    <Td><span style={{ fontWeight: 600, color: '#eee' }}>TOTALES</span></Td>
                    <Td>{' '}</Td>
                    <Td right><span style={{ fontWeight: 600, color: '#eee' }}>{F(kpis.totalSueldo)}</span></Td>
                    <Td right><span style={{ fontWeight: 600, color: '#60a5fa' }}>{F(kpis.totalTransf)}</span></Td>
                    <Td right><span style={{ fontWeight: 600, color: '#f59e0b' }}>{F(kpis.totalSueldo - kpis.totalTransf)}</span></Td>
                    <Td right><span style={{ fontWeight: 600, color: '#a78bfa' }}>{F(kpis.totalCaja)}</span></Td>
                    <Td right><span style={{ fontWeight: 600, color: '#fb923c' }}>{F(kpis.totalHE)}</span></Td>
                    <Td right><span style={{ fontWeight: 600, color: '#10B981' }}>{F(kpis.totalBonos)}</span></Td>
                    <Td right><span style={{ fontWeight: 600, color: '#ef4444' }}>{kpis.totalDesc ? '-' + F(kpis.totalDesc) : F(0)}</span></Td>
                    <Td right>
                      <span style={{
                        fontWeight: 700, color: '#fff', fontSize: 14,
                        background: 'rgba(245, 158, 11, 0.2)', padding: '6px 14px', borderRadius: 8,
                      }}>
                        {F(kpis.totalEfectivo)}
                      </span>
                    </Td>
                    <Td>{' '}</Td>
                  </tr>
                </tfoot>
              </Table>
            </div>
          )}

          {/* Formula legend */}
          <div style={{
            marginTop: 20, padding: 16, background: '#0f0f0f', borderRadius: 10,
            border: '1px solid #1a1a1a', fontSize: 12, color: '#666',
          }}>
            <span style={{ color: '#888', fontWeight: 500 }}>Fórmula: </span>
            <span style={{ color: '#f59e0b' }}>Efectivo base</span> = Sueldo neto − Neto transferido &nbsp;|&nbsp;
            <span style={{ color: '#fff' }}>Total efectivo</span> = Efectivo base + Cajas chicas + Hrs extra + Bonos − Descuento (faltas)
          </div>
        </>
      )}

      {/* PDF Import Results Modal */}
      {importStatus.show && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setImportStatus(prev => ({ ...prev, show: false }))}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#111', border: '1px solid #222', borderRadius: 12,
              padding: 24, width: 680, maxHeight: '80vh', overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <FileText size={20} style={{ color: '#60a5fa' }} />
              <span style={{ fontSize: 16, fontWeight: 600, color: '#eee' }}>
                Importar PDF de Nómina
              </span>
            </div>

            {importStatus.parsing ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                <Loading />
                <div style={{ marginTop: 12 }}>Analizando PDF...</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
                  {importStatus.results.filter((r: any) => r.matched).length} de {importStatus.results.length} empleados identificados.
                  Los montos de "Neto a Pagar" se cargarán en la columna "Neto transferido".
                </div>

                <Table>
                  <thead>
                    <tr>
                      <Th>{'Empleado (PDF)'}</Th>
                      <Th>{'Empleado (Sistema)'}</Th>
                      <Th right>{'Neto a Pagar'}</Th>
                      <Th>{'Match'}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {importStatus.results.map((r: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                        <Td><span style={{ fontSize: 12 }}>{r.pdfName}</span></Td>
                        <Td>
                          {r.matched ? (
                            <span style={{ color: '#10B981', fontSize: 12 }}>{r.dbName}</span>
                          ) : (
                            <span style={{ color: '#ef4444', fontSize: 12 }}>No encontrado</span>
                          )}
                        </Td>
                        <Td right><span style={{ color: '#60a5fa', fontWeight: 500 }}>{F(r.neto)}</span></Td>
                        <Td>
                          {r.matched ? (
                            <CheckCircle2 size={14} style={{ color: '#10B981' }} />
                          ) : (
                            <AlertCircle size={14} style={{ color: '#ef4444' }} />
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>

                <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                  <Btn variant="ghost" onClick={() => setImportStatus(prev => ({ ...prev, show: false }))}>
                    Cancelar
                  </Btn>
                  {!importStatus.applied ? (
                    <Btn variant="primary" onClick={applyPdfImport}>
                      <CheckCircle2 size={14} /> Aplicar {importStatus.results.filter((r: any) => r.matched).length} montos
                    </Btn>
                  ) : (
                    <Btn variant="primary" onClick={() => setImportStatus(prev => ({ ...prev, show: false }))}>
                      <CheckCircle2 size={14} /> Listo — Guardar cambios para confirmar
                    </Btn>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────── EditableCell ─────────────── */

function EditableCell({ value, onChange, color }: { value: number; onChange: (v: number) => void; color: string }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value.toString())

  const commit = () => {
    setEditing(false)
    const n = parseFloat(text) || 0
    if (n !== value) onChange(n)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setText(value.toString()); setEditing(false) } }}
        style={{
          width: 90, background: '#111', border: `1px solid ${color}40`,
          borderRadius: 4, padding: '4px 8px', color, fontSize: 13,
          textAlign: 'right', outline: 'none',
        }}
      />
    )
  }

  return (
    <span
      onClick={() => { setText(value.toString()); setEditing(true) }}
      style={{
        color, cursor: 'pointer', padding: '4px 8px',
        borderRadius: 4, border: '1px solid transparent',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = `${color}30`)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
      title="Clic para editar"
    >
      {F(value)}
    </span>
  )
}

/* ─────────────── Styles ─────────────── */

const navBtnStyle: React.CSSProperties = {
  background: '#111', border: '1px solid #222', borderRadius: 6,
  padding: '6px 8px', cursor: 'pointer', color: '#999',
  display: 'flex', alignItems: 'center',
}
