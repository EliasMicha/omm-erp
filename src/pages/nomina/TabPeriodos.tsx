import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { F } from '../../lib/utils'
import { Btn, Table, Th, Td, Loading, KpiCard, EmptyState, Badge } from '../../components/layout/UI'
import {
  Calendar, DollarSign, Banknote, Clock, Plus, ChevronLeft, ChevronRight,
  Save, RefreshCw, Lock, AlertCircle, CheckCircle2, Gift, Upload, FileText
} from 'lucide-react'
import { parseSFacilNominaPDF, matchEmployeeByName } from '../../lib/nominaPdfParser'

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
        .select('id,nombre,tipo_alta,sueldo_neto_semanal,sueldo_neto_quincenal,puesto,area,rfc')
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
      const horasExtraMin = overtimeMap[emp.id] || 0
      // Overtime rate: sueldo_neto / hours_in_period * 2 (doble)
      const hoursInPeriod = viewMode === 'semanal' ? 48 : 96
      const hourlyRate = sueldoNeto / hoursInPeriod
      const horasExtraMonto = Math.round((horasExtraMin / 60) * hourlyRate * 2 * 100) / 100

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
        total_efectivo_calculado: sueldoNeto + cajaChica + horasExtraMonto,
        total_efectivo_final: sueldoNeto + cajaChica + horasExtraMonto,
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
      const totalEfectivo = efectivoBase + cajaChica + horasExtra + bonos - descInfonavit
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
      const totalEfectivo = efectivoBase + cajaChica + horasExtra + bonos - descInfonavit
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
    return { totalSueldo, totalTransf, totalEfectivo, totalCaja, totalHE, totalBonos }
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
          <Badge label={viewMode === 'semanal' ? 'SEMANA ACTUAL' : 'QUINCENA ACTUAL'} color="#57FF9A" />
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
          <KpiCard label="Bonos" value={F(kpis.totalBonos)} color="#57FF9A" />
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

                <Btn onClick={() => loadPeriod()} variant="ghost" style={{ fontSize: 12 }}>
                  <RefreshCw size={13} /> Recalcular
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
                            <span style={{ color: '#57FF9A' }}>{F(Number(item.bono_puntualidad) || 0)}</span>
                          ) : (
                            <EditableCell
                              value={Number(item.bono_puntualidad) || 0}
                              onChange={v => updateItemField(item.id, 'bono_puntualidad', v)}
                              color="#57FF9A"
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
                                style={{ color: item.efectivo_pagado ? '#57FF9A' : '#444', cursor: 'pointer' }}
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
                    <Td right><span style={{ fontWeight: 600, color: '#57FF9A' }}>{F(kpis.totalBonos)}</span></Td>
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
            <span style={{ color: '#fff' }}>Total efectivo</span> = Efectivo base + Cajas chicas + Hrs extra + Bonos
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
                            <span style={{ color: '#57FF9A', fontSize: 12 }}>{r.dbName}</span>
                          ) : (
                            <span style={{ color: '#ef4444', fontSize: 12 }}>No encontrado</span>
                          )}
                        </Td>
                        <Td right><span style={{ color: '#60a5fa', fontWeight: 500 }}>{F(r.neto)}</span></Td>
                        <Td>
                          {r.matched ? (
                            <CheckCircle2 size={14} style={{ color: '#57FF9A' }} />
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
