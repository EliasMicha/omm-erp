import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { KpiCard, Table, Th, Td, Badge, Loading, SectionHeader, ProgressBar } from '../components/layout/UI'
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, Receipt, Users, ShoppingCart, PieChart, ArrowUpRight, ArrowDownRight, Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

const F = (n: number) => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const F2 = (n: number) => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PCT = (n: number) => (n * 100).toFixed(1) + '%'

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

// ═══════════════════════════════════════════════════════════════════
// Categorías de gasto para facturas recibidas (por nombre de emisor)
// ═══════════════════════════════════════════════════════════════════
type GastoCategoria = 'material_obra' | 'nomina_fiscal' | 'impuestos_gobierno' | 'servicios' | 'gastos_generales'

const GASTO_LABELS: Record<GastoCategoria, string> = {
  material_obra: 'Material / Obra',
  nomina_fiscal: 'Nómina fiscal',
  impuestos_gobierno: 'Impuestos y Gobierno',
  servicios: 'Servicios',
  gastos_generales: 'Gastos generales',
}
const GASTO_COLORS: Record<GastoCategoria, string> = {
  material_obra: '#3B82F6',
  nomina_fiscal: '#F59E0B',
  impuestos_gobierno: '#EF4444',
  servicios: '#8B5CF6',
  gastos_generales: '#6B7280',
}

function categorizeByEmisor(emisor: string): GastoCategoria {
  const e = (emisor || '').toUpperCase()
  if (e.includes('SEGURO SOCIAL') || e.includes('IMSS')) return 'impuestos_gobierno'
  if (e.includes('INFONAVIT') || e.includes('FONDO NACIONAL')) return 'impuestos_gobierno'
  if (e.includes('GOBIERNO') || e.includes('SAT ') || e.includes('TESORERIA')) return 'impuestos_gobierno'
  if (e.includes('TELMEX') || e.includes('TELCEL') || e.includes('CFE ') || e.includes('COMISION FEDERAL')) return 'servicios'
  if (e.includes('CONTAD') || e.includes('AUDIT') || e.includes('NOTARI')) return 'servicios'
  // Material/proveedores de obra — los más comunes
  if (e.includes('PROCABLES') || e.includes('LUTRON') || e.includes('SOMFY') || e.includes('ILLUX') || e.includes('DEXTRA') || e.includes('TECNO BLIND') || e.includes('PINPOINT') || e.includes('REPRESENTACIONES DE AUDIO') || e.includes('SISTEMAS Y SERVICIO') || e.includes('CONSTRUCCIONES')) return 'material_obra'
  return 'gastos_generales'
}

// ═══════════════════════════════════════════════════════════════════
// Bank movement categories → display categories
// ═══════════════════════════════════════════════════════════════════
function bankCatLabel(cat: string): string {
  const map: Record<string, string> = {
    cobro_cliente: 'Cobro de cliente',
    proveedor_obra: 'Pago a proveedor',
    gasto_operativo: 'Gasto operativo',
    impuestos: 'Impuestos',
    nomina: 'Nómina',
    servicio: 'Servicios',
    comision_bancaria: 'Comisión bancaria',
  }
  return map[cat] || cat || 'Sin categoría'
}
function bankCatColor(cat: string): string {
  const map: Record<string, string> = {
    cobro_cliente: '#57FF9A',
    proveedor_obra: '#3B82F6',
    gasto_operativo: '#F59E0B',
    impuestos: '#EF4444',
    nomina: '#C084FC',
    servicio: '#8B5CF6',
    comision_bancaria: '#6B7280',
  }
  return map[cat] || '#444'
}

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function Finanzas() {
  const [loading, setLoading] = useState(true)
  const [mes, setMes] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() } // 0-indexed
  })

  // Raw data
  const [facturasEmitidas, setFacturasEmitidas] = useState<any[]>([])
  const [facturasRecibidas, setFacturasRecibidas] = useState<any[]>([])
  const [bankMovements, setBankMovements] = useState<any[]>([])
  const [payrollPeriods, setPayrollPeriods] = useState<any[]>([])
  const [payrollItems, setPayrollItems] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([])
  const [cajaChica, setCajaChica] = useState<any[]>([])
  const [milestones, setMilestones] = useState<any[]>([])

  // Detail view
  const [detailView, setDetailView] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [mes])

  async function load() {
    setLoading(true)
    const startDate = `${mes.year}-${String(mes.month + 1).padStart(2, '0')}-01`
    const endDate = mes.month === 11
      ? `${mes.year + 1}-01-01`
      : `${mes.year}-${String(mes.month + 2).padStart(2, '0')}-01`

    const [femRes, frecRes, bankRes, ppRes, piRes, empRes, projRes, poRes, ccRes, msRes] = await Promise.all([
      // Facturas emitidas del mes
      supabase.from('facturas').select('id,receptor_nombre,subtotal,iva,total,fecha_emision,status')
        .eq('direccion', 'emitida').gte('fecha_emision', startDate).lt('fecha_emision', endDate),
      // Facturas recibidas del mes
      supabase.from('facturas').select('id,emisor_nombre,subtotal,iva,isr_retenido,total,fecha_emision,status,proveedor_id,orden_compra_id,project_id')
        .eq('direccion', 'recibida').gte('fecha_emision', startDate).lt('fecha_emision', endDate),
      // Bank movements del mes
      supabase.from('bank_movements').select('*').gte('fecha', startDate).lt('fecha', endDate).order('fecha', { ascending: false }),
      // Payroll periods del mes
      supabase.from('payroll_periods').select('*').eq('anio', mes.year).eq('mes', mes.month + 1),
      // Payroll items (all, for the periods in this month)
      supabase.from('payroll_items').select('id,period_id,employee_id,sueldo_neto_pactado,neto_a_pagar_cfdi,total_efectivo_final,isr,cuotas_imss_obrero,horas_extras_monto,bono_puntualidad,caja_chica,descuento_infonavit_efectivo'),
      // Employees (active)
      supabase.from('employees').select('id,nombre,area,tipo_trabajo,sueldo_neto_semanal,sueldo_neto_quincenal,neto_mensual,tipo_alta,activo').eq('activo', true),
      // Projects
      supabase.from('projects').select('id,name,client_name,contract_value,status,specialty,advance_pct'),
      // Purchase orders del mes
      supabase.from('purchase_orders').select('id,po_number,total,iva,subtotal,status,currency,project_id,supplier_id,created_at')
        .gte('created_at', startDate).lt('created_at', endDate),
      // Caja chica del mes
      supabase.from('caja_chica_tickets').select('id,monto,concepto,categoria,estatus,employee_id,fecha')
        .gte('fecha', startDate).lt('fecha', endDate),
      // Payment milestones (all pending/vencido)
      supabase.from('payment_milestones').select('id,name,amount,due_date,status,project_id,paid_at'),
    ])

    setFacturasEmitidas(femRes.data || [])
    setFacturasRecibidas(frecRes.data || [])
    setBankMovements(bankRes.data || [])
    setPayrollPeriods(ppRes.data || [])
    setPayrollItems(piRes.data || [])
    setEmployees(empRes.data || [])
    setProjects(projRes.data || [])
    setPurchaseOrders(poRes.data || [])
    setCajaChica(ccRes.data || [])
    setMilestones(msRes.data || [])
    setLoading(false)
  }

  // ── COMPUTED ──────────────────────────────────────────────────────

  // Filter payroll items to this month's periods
  const monthPeriodIds = useMemo(() => new Set(payrollPeriods.map((p: any) => p.id)), [payrollPeriods])
  const monthPayrollItems = useMemo(() => payrollItems.filter((pi: any) => monthPeriodIds.has(pi.period_id)), [payrollItems, monthPeriodIds])

  // INGRESOS
  const ingresosFacturados = useMemo(() =>
    facturasEmitidas.filter(f => f.status !== 'cancelada').reduce((s, f) => s + (f.total || 0), 0), [facturasEmitidas])
  const ivaEmitido = useMemo(() =>
    facturasEmitidas.filter(f => f.status !== 'cancelada').reduce((s, f) => s + (f.iva || 0), 0), [facturasEmitidas])

  // EGRESOS — Facturas recibidas
  const egresosFacturados = useMemo(() =>
    facturasRecibidas.filter(f => f.status !== 'cancelada').reduce((s, f) => s + (f.total || 0), 0), [facturasRecibidas])
  const ivaRecibido = useMemo(() =>
    facturasRecibidas.filter(f => f.status !== 'cancelada').reduce((s, f) => s + (f.iva || 0), 0), [facturasRecibidas])

  // NÓMINA — costo bruto real (neto pactado a todos)
  const nominaBruta = useMemo(() =>
    monthPayrollItems.reduce((s, pi) => s + (pi.sueldo_neto_pactado || 0), 0), [monthPayrollItems])
  const nominaFiscal = useMemo(() =>
    monthPayrollItems.reduce((s, pi) => s + (pi.neto_a_pagar_cfdi || 0), 0), [monthPayrollItems])
  const nominaEfectivo = useMemo(() =>
    monthPayrollItems.reduce((s, pi) => s + (pi.total_efectivo_final || 0), 0), [monthPayrollItems])

  // NÓMINA MENSUAL ESTIMADA (desde employees, para meses sin payroll data)
  const nominaMensualEstimada = useMemo(() =>
    employees.reduce((s, e) => s + (e.neto_mensual || 0), 0), [employees])

  // CAJA CHICA
  const cajaChicaTotal = useMemo(() =>
    cajaChica.reduce((s, t) => s + (t.monto || 0), 0), [cajaChica])

  // COMPRAS del mes
  const comprasTotal = useMemo(() =>
    purchaseOrders.filter(po => po.status !== 'cancelada').reduce((s, po) => s + (po.total || 0), 0), [purchaseOrders])

  // CATEGORIZACIÓN DE GASTOS (facturas recibidas)
  const gastosPorCategoria = useMemo(() => {
    const cats: Record<GastoCategoria, number> = {
      material_obra: 0, nomina_fiscal: 0, impuestos_gobierno: 0, servicios: 0, gastos_generales: 0,
    }
    facturasRecibidas.filter(f => f.status !== 'cancelada').forEach(f => {
      cats[categorizeByEmisor(f.emisor_nombre)] += (f.total || 0)
    })
    // Add payroll fiscal if not in facturas
    if (nominaFiscal > 0 && cats.nomina_fiscal === 0) {
      cats.nomina_fiscal = nominaFiscal
    }
    return cats
  }, [facturasRecibidas, nominaFiscal])

  const totalGastos = Object.values(gastosPorCategoria).reduce((s, v) => s + v, 0)

  // BANK MOVEMENTS — flujo
  const bankIngresos = useMemo(() =>
    bankMovements.filter(m => m.tipo === 'abono').reduce((s, m) => s + (m.monto || 0), 0), [bankMovements])
  const bankEgresos = useMemo(() =>
    bankMovements.filter(m => m.tipo === 'cargo').reduce((s, m) => s + (m.monto || 0), 0), [bankMovements])
  const bankSaldo = useMemo(() => {
    if (bankMovements.length === 0) return 0
    return bankMovements[0]?.saldo || 0
  }, [bankMovements])

  // Bank categories breakdown
  const bankPorCategoria = useMemo(() => {
    const cats: Record<string, { monto: number; count: number }> = {}
    bankMovements.filter(m => m.tipo === 'cargo').forEach(m => {
      const c = m.categoria || 'sin_categoria'
      if (!cats[c]) cats[c] = { monto: 0, count: 0 }
      cats[c].monto += m.monto || 0
      cats[c].count++
    })
    return Object.entries(cats).sort((a, b) => b[1].monto - a[1].monto)
  }, [bankMovements])

  // COBRANZA
  const cobranzaPendiente = useMemo(() =>
    milestones.filter(m => m.status === 'pendiente' || m.status === 'vigente').reduce((s, m) => s + (m.amount || 0), 0), [milestones])
  const cobranzaVencida = useMemo(() =>
    milestones.filter(m => m.status === 'vencido').reduce((s, m) => s + (m.amount || 0), 0), [milestones])

  // MARGEN
  const margenBruto = ingresosFacturados > 0 ? (ingresosFacturados - egresosFacturados) / ingresosFacturados : 0

  // Costo nómina real — usar payroll si hay, si no usar estimado
  const costoNominaReal = nominaBruta > 0 ? nominaBruta : nominaMensualEstimada

  // Top clientes por facturación del mes
  const topClientes = useMemo(() => {
    const map: Record<string, number> = {}
    facturasEmitidas.filter(f => f.status !== 'cancelada').forEach(f => {
      map[f.receptor_nombre] = (map[f.receptor_nombre] || 0) + (f.total || 0)
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [facturasEmitidas])

  // Top proveedores por gasto del mes
  const topProveedores = useMemo(() => {
    const map: Record<string, number> = {}
    facturasRecibidas.filter(f => f.status !== 'cancelada').forEach(f => {
      map[f.emisor_nombre] = (map[f.emisor_nombre] || 0) + (f.total || 0)
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [facturasRecibidas])

  // Proyectos activos con contract value
  const projectsActivos = useMemo(() =>
    projects.filter(p => p.status === 'activo').sort((a, b) => (b.contract_value || 0) - (a.contract_value || 0)), [projects])

  // ── NAV ───────────────────────────────────────────────────────────
  const prevMonth = () => setMes(m => m.month === 0 ? { year: m.year - 1, month: 11 } : { year: m.year, month: m.month - 1 })
  const nextMonth = () => setMes(m => m.month === 11 ? { year: m.year + 1, month: 0 } : { year: m.year, month: m.month + 1 })

  // ── RENDER ────────────────────────────────────────────────────────
  if (loading) return <Loading />

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <SectionHeader title="Finanzas" subtitle="Salud financiera del negocio" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={prevMonth} style={navBtnS}><ChevronLeft size={16} /></button>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', minWidth: 120, textAlign: 'center' }}>
            <Calendar size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            {MONTHS[mes.month]} {mes.year}
          </div>
          <button onClick={nextMonth} style={navBtnS}><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* ── KPI ROW ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard
          label="Ingresos facturados"
          value={F(ingresosFacturados)}
          color="#57FF9A"
          icon={<ArrowUpRight size={16} />}
        />
        <KpiCard
          label="Egresos facturados"
          value={F(egresosFacturados)}
          color="#EF4444"
          icon={<ArrowDownRight size={16} />}
        />
        <KpiCard
          label="Margen bruto"
          value={PCT(margenBruto)}
          color={margenBruto >= 0.3 ? '#57FF9A' : margenBruto >= 0.15 ? '#F59E0B' : '#EF4444'}
          icon={<TrendingUp size={16} />}
        />
        <KpiCard
          label="Nómina bruta mensual"
          value={F(costoNominaReal)}
          color="#C084FC"
          icon={<Users size={16} />}
        />
        <KpiCard
          label="Cuentas vencidas"
          value={F(cobranzaVencida)}
          color={cobranzaVencida > 0 ? '#EF4444' : '#57FF9A'}
          icon={<AlertTriangle size={16} />}
        />
      </div>

      {/* ── SECOND ROW: IVA + Saldo bancario + Cobranza pendiente ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        <SmallKpi label="IVA cobrado" value={F(ivaEmitido)} color="#57FF9A" />
        <SmallKpi label="IVA pagado" value={F(ivaRecibido)} color="#EF4444" />
        <SmallKpi label="Saldo bancario" value={F2(bankSaldo)} color="#3B82F6" />
        <SmallKpi label="Cobranza pendiente" value={F(cobranzaPendiente)} color="#F59E0B" />
      </div>

      {/* ── MAIN GRID ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>

        {/* LEFT: Categorización de gastos */}
        <Card title="Categorización de gastos" icon={<PieChart size={14} />}>
          {totalGastos === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 13 }}>Sin gastos registrados este mes</div>
          ) : (
            <>
              {/* Bar chart */}
              <div style={{ display: 'flex', height: 24, borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
                {(Object.keys(gastosPorCategoria) as GastoCategoria[]).filter(k => gastosPorCategoria[k] > 0).map(k => (
                  <div key={k} style={{
                    width: PCT(gastosPorCategoria[k] / totalGastos),
                    background: GASTO_COLORS[k],
                    transition: 'width 0.3s',
                  }} title={`${GASTO_LABELS[k]}: ${F(gastosPorCategoria[k])}`} />
                ))}
              </div>
              {/* Legend + amounts */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(Object.keys(gastosPorCategoria) as GastoCategoria[]).filter(k => gastosPorCategoria[k] > 0).map(k => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: GASTO_COLORS[k] }} />
                      <span style={{ fontSize: 12, color: '#aaa' }}>{GASTO_LABELS[k]}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: '#666' }}>{PCT(gastosPorCategoria[k] / totalGastos)}</span>
                      <span style={{ fontSize: 13, color: '#fff', fontWeight: 500, fontVariantNumeric: 'tabular-nums', minWidth: 90, textAlign: 'right' }}>{F(gastosPorCategoria[k])}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #222', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#888', fontWeight: 600 }}>Total gastos</span>
                <span style={{ fontSize: 14, color: '#fff', fontWeight: 600 }}>{F(totalGastos)}</span>
              </div>
            </>
          )}
        </Card>

        {/* RIGHT: Desglose de nómina */}
        <Card title="Costo de nómina" icon={<Users size={14} />}>
          {costoNominaReal === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 13 }}>Sin datos de nómina este mes</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <MiniStat label="Neto pactado total" value={F(nominaBruta > 0 ? nominaBruta : nominaMensualEstimada)} accent="#fff" />
                <MiniStat label="Transferencia (fiscal)" value={F(nominaFiscal)} accent="#57FF9A" />
                <MiniStat label="Efectivo" value={F(nominaEfectivo)} accent="#F59E0B" />
                <MiniStat label="Caja chica del mes" value={F(cajaChicaTotal)} accent="#C084FC" />
              </div>
              <div style={{ borderTop: '1px solid #222', paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: '#888' }}>Empleados activos</span>
                  <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{employees.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: '#888' }}>Períodos de nómina este mes</span>
                  <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{payrollPeriods.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#888' }}>Nómina estimada mensual</span>
                  <span style={{ fontSize: 13, color: '#C084FC', fontWeight: 500 }}>{F(nominaMensualEstimada)}</span>
                </div>
              </div>
              {/* Nómina como % de ingresos */}
              {ingresosFacturados > 0 && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#111', borderRadius: 8, border: '1px solid #1a1a1a' }}>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Nómina como % de ingresos</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#1a1a1a' }}>
                      <div style={{
                        width: `${Math.min((costoNominaReal / ingresosFacturados) * 100, 100)}%`,
                        height: '100%', borderRadius: 3,
                        background: (costoNominaReal / ingresosFacturados) > 0.4 ? '#EF4444' : (costoNominaReal / ingresosFacturados) > 0.25 ? '#F59E0B' : '#57FF9A',
                      }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{PCT(costoNominaReal / ingresosFacturados)}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* ── SECOND GRID ROW ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>

        {/* TOP CLIENTES (ingresos) */}
        <Card title="Ingresos por cliente" icon={<ArrowUpRight size={14} />}>
          {topClientes.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 13 }}>Sin facturación este mes</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {topClientes.map(([name, total], i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#444', minWidth: 14 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                    <div style={{ height: 3, borderRadius: 2, background: '#1a1a1a', marginTop: 3 }}>
                      <div style={{ height: '100%', borderRadius: 2, background: '#57FF9A', width: `${(total / topClientes[0][1]) * 100}%`, opacity: 1 - (i * 0.08) }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: '#fff', fontWeight: 500, fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }}>{F(total)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* TOP PROVEEDORES (egresos) */}
        <Card title="Egresos por proveedor" icon={<ArrowDownRight size={14} />}>
          {topProveedores.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 13 }}>Sin gastos registrados este mes</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {topProveedores.map(([name, total], i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#444', minWidth: 14 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                    <div style={{ height: 3, borderRadius: 2, background: '#1a1a1a', marginTop: 3 }}>
                      <div style={{ height: '100%', borderRadius: 2, background: '#EF4444', width: `${(total / topProveedores[0][1]) * 100}%`, opacity: 1 - (i * 0.08) }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: '#fff', fontWeight: 500, fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }}>{F(total)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── THIRD ROW: Flujo bancario + Cobranza ────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>

        {/* Flujo bancario */}
        <Card title="Flujo de efectivo (banco)" icon={<DollarSign size={14} />}>
          {bankMovements.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 13 }}>Sin movimientos bancarios este mes</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <MiniStat label="Entradas" value={F2(bankIngresos)} accent="#57FF9A" />
                <MiniStat label="Salidas" value={F2(bankEgresos)} accent="#EF4444" />
                <MiniStat label="Flujo neto" value={F2(bankIngresos - bankEgresos)} accent={bankIngresos >= bankEgresos ? '#57FF9A' : '#EF4444'} />
              </div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>Salidas por categoría</div>
              {bankPorCategoria.map(([cat, data]) => (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: bankCatColor(cat) }} />
                    <span style={{ fontSize: 12, color: '#aaa' }}>{bankCatLabel(cat)}</span>
                    <span style={{ fontSize: 10, color: '#555' }}>({data.count})</span>
                  </div>
                  <span style={{ fontSize: 12, color: '#fff', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{F2(data.monto)}</span>
                </div>
              ))}
              {/* Recent movements */}
              <div style={{ marginTop: 12, borderTop: '1px solid #222', paddingTop: 12 }}>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>Últimos movimientos</div>
                {bankMovements.slice(0, 5).map((m: any) => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
                    <span style={{ color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{m.concepto || m.beneficiario || '—'}</span>
                    <span style={{ color: m.tipo === 'abono' ? '#57FF9A' : '#EF4444', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                      {m.tipo === 'abono' ? '+' : '-'}{F2(m.monto)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Cobranza */}
        <Card title="Cobranza" icon={<Receipt size={14} />}>
          {milestones.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 13 }}>
              Sin hitos de cobro registrados
              <div style={{ marginTop: 8, fontSize: 11, color: '#444' }}>Los hitos se crean desde cada proyecto</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <MiniStat label="Pendiente" value={F(cobranzaPendiente)} accent="#F59E0B" />
                <MiniStat label="Vencida" value={F(cobranzaVencida)} accent="#EF4444" />
                <MiniStat label="Hitos totales" value={String(milestones.length)} accent="#888" />
              </div>
              <Table>
                <thead>
                  <tr><Th>Hito</Th><Th>Vence</Th><Th>Estado</Th><Th right>Monto</Th></tr>
                </thead>
                <tbody>
                  {milestones.filter(m => m.status !== 'cobrado').slice(0, 8).map((m: any) => {
                    const proj = projects.find(p => p.id === m.project_id)
                    return (
                      <tr key={m.id}>
                        <Td><div style={{ fontSize: 12 }}>{m.name}</div><div style={{ fontSize: 10, color: '#555' }}>{proj?.name || ''}</div></Td>
                        <Td muted>{m.due_date || '—'}</Td>
                        <Td><Badge label={m.status} color={m.status === 'vencido' ? '#EF4444' : m.status === 'vigente' ? '#57FF9A' : '#F59E0B'} /></Td>
                        <Td right>{F(m.amount || 0)}</Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </>
          )}
        </Card>
      </div>

      {/* ── PROJECTS ROW: Margen por proyecto ───────────────────── */}
      <Card title="Proyectos activos — valor de contrato" icon={<TrendingUp size={14} />}>
        {projectsActivos.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 13 }}>Sin proyectos activos</div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Proyecto</Th>
                <Th>Cliente</Th>
                <Th>Especialidad</Th>
                <Th>Avance</Th>
                <Th right>Valor contrato</Th>
              </tr>
            </thead>
            <tbody>
              {projectsActivos.map((p: any) => (
                <tr key={p.id}>
                  <Td><span style={{ fontWeight: 500, color: '#fff' }}>{p.name}</span></Td>
                  <Td muted>{p.client_name}</Td>
                  <Td><Badge label={(p.specialty || '—').toUpperCase()} color={p.specialty === 'esp' ? '#3B82F6' : p.specialty === 'elec' ? '#FFB347' : p.specialty === 'ilum' ? '#C084FC' : '#57FF9A'} /></Td>
                  <Td><ProgressBar pct={p.advance_pct || 0} /></Td>
                  <Td right>{F(p.contract_value || 0)}</Td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid #333' }}>
                <Td><span style={{ fontWeight: 600, color: '#888' }}>Total pipeline</span></Td>
                <Td>{' '}</Td>
                <Td>{' '}</Td>
                <Td>{' '}</Td>
                <Td right><span style={{ fontWeight: 600, color: '#57FF9A' }}>{F(projectsActivos.reduce((s, p) => s + (p.contract_value || 0), 0))}</span></Td>
              </tr>
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Small UI helpers
// ═══════════════════════════════════════════════════════════════════

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, color: '#888', fontSize: 13, fontWeight: 600 }}>
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

function SmallKpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ padding: '8px 10px', background: '#111', borderRadius: 8, border: '1px solid #1a1a1a' }}>
      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: accent, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

const navBtnS: React.CSSProperties = {
  background: '#111', border: '1px solid #222', borderRadius: 6, padding: '6px 8px',
  color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center',
}
