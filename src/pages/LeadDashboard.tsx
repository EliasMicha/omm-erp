import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Loading, Badge, SectionHeader } from '../components/layout/UI'
import {
  ArrowLeft, FileText, DollarSign, ShoppingCart, Briefcase,
  HardHat, AlertTriangle, ChevronDown, ChevronRight, ExternalLink,
  CheckCircle2, Clock, XCircle, TrendingUp, Package, BarChart3, Plus, X, Download
} from 'lucide-react'
import jsPDF from 'jspdf'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════
const F = (n: number) => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const FUSD = (n: number) => 'US$' + n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const FCUR = (n: number, cur: string) => cur === 'USD' ? FUSD(n) : F(n)
const PCT = (n: number) => (n * 100).toFixed(1) + '%'

const STAGE_COLORS: Record<string, string> = {
  oportunidad: '#F59E0B', cotizando: '#3B82F6', negociacion: '#C084FC',
  contrato: '#57FF9A', perdido: '#EF4444', pausado: '#6B7280',
}
const STAGE_LABELS: Record<string, string> = {
  oportunidad: 'Oportunidad', cotizando: 'Cotizando', negociacion: 'Negociación',
  contrato: 'Contrato', perdido: 'Perdido', pausado: 'Pausado',
}
const PO_STATUS_COLOR: Record<string, string> = {
  borrador: '#6B7280', enviada: '#3B82F6', confirmada: '#57FF9A',
  entregada: '#34D399', cancelada: '#EF4444',
}
const MILESTONE_COLOR: Record<string, string> = {
  pendiente: '#F59E0B', vigente: '#3B82F6', cobrado: '#57FF9A', vencido: '#EF4444',
}
const TASK_STATUS_ICON: Record<string, React.ReactNode> = {
  pendiente: <Clock size={12} color="#F59E0B" />,
  en_progreso: <BarChart3 size={12} color="#3B82F6" />,
  completada: <CheckCircle2 size={12} color="#57FF9A" />,
  bloqueada: <XCircle size={12} color="#EF4444" />,
}
const BLOQUEO_SEV_COLOR: Record<string, string> = {
  baja: '#F59E0B', media: '#F97316', alta: '#EF4444', critica: '#DC2626',
}

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function LeadDashboard() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [lead, setLead] = useState<any>(null)
  const [quotations, setQuotations] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [pos, setPos] = useState<any[]>([])
  const [milestones, setMilestones] = useState<any[]>([])
  const [obras, setObras] = useState<any[]>([])
  const [obraActividades, setObraActividades] = useState<any[]>([])
  const [obraBloqueos, setObraBloqueos] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [phases, setPhases] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [quotItems, setQuotItems] = useState<any[]>([])
  const [bankMovements, setBankMovements] = useState<any[]>([])
  const [tipoCambio, setTipoCambio] = useState(20.50)
  const [showNewMilestone, setShowNewMilestone] = useState(false)
  const [cobrarModal, setCobrarModal] = useState<any>(null) // milestone being marked as cobrado

  // Collapsible sections
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    cotizaciones: true, estado: true, compras: true, proyectos: true, obra: true, bloqueos: true,
  })
  const toggle = (k: string) => setExpanded(p => ({ ...p, [k]: !p[k] }))

  useEffect(() => { if (id) load() }, [id])

  async function load() {
    setLoading(true)
    // 1. Lead
    const { data: leadData } = await supabase.from('leads').select('*').eq('id', id!).single()
    setLead(leadData)
    if (!leadData) { setLoading(false); return }

    // 2. All quotations — filter by lead_id in notes JSON
    const { data: allQuots } = await supabase.from('quotations').select('*')
    const leadQuots = (allQuots || []).filter(q => {
      try {
        const n = typeof q.notes === 'string' ? JSON.parse(q.notes) : q.notes
        return n?.lead_id === id
      } catch { return false }
    })
    setQuotations(leadQuots)
    const quotIds = new Set(leadQuots.map(q => q.id))

    // 3. Projects linked via lead_id OR cotizacion_id
    const { data: allProjects } = await supabase.from('projects').select('*')
    const leadProjects = (allProjects || []).filter(p =>
      p.lead_id === id || (p.cotizacion_id && quotIds.has(p.cotizacion_id))
    )
    setProjects(leadProjects)
    const projIds = new Set(leadProjects.map(p => p.id))

    // 4. Parallel: POs, milestones, obras, tasks, phases, employees, quotation items, bank movements
    const [posRes, msRes, obrasRes, tasksRes, phasesRes, empRes, qiRes, bmRes] = await Promise.all([
      supabase.from('purchase_orders').select('*').in('project_id', [...projIds]),
      supabase.from('payment_milestones').select('*,currency,amount_paid_mxn,tipo_cambio_pago').in('project_id', [...projIds]),
      supabase.from('obras').select('*').in('project_id', [...projIds]),
      supabase.from('project_tasks').select('*').in('project_id', [...projIds]),
      supabase.from('project_phases').select('*').in('project_id', [...projIds]),
      supabase.from('employees').select('id,nombre,area').eq('activo', true),
      supabase.from('quotation_items').select('*').in('quotation_id', [...quotIds]),
      supabase.from('bank_movements').select('*').eq('lead_id', id!).order('fecha', { ascending: false }),
    ])
    setPos(posRes.data || [])
    setMilestones(msRes.data || [])
    setEmployees(empRes.data || [])
    setQuotItems(qiRes.data || [])
    setTasks(tasksRes.data || [])
    setPhases(phasesRes.data || [])
    setBankMovements(bmRes.data || [])

    const obrasList = obrasRes.data || []
    setObras(obrasList)

    // 5. Obra actividades & bloqueos
    if (obrasList.length > 0) {
      const obraIds = obrasList.map(o => o.id)
      const [actRes, bloqRes] = await Promise.all([
        supabase.from('obra_actividades').select('*').in('obra_id', obraIds),
        supabase.from('obra_bloqueos').select('*').in('obra_id', obraIds),
      ])
      setObraActividades(actRes.data || [])
      setObraBloqueos(bloqRes.data || [])
    }

    setLoading(false)
  }

  // ── EXPORT ESTADO DE CUENTA PDF ──────────────────────────────
  function exportEstadoCuenta() {
    if (!lead) return
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
    const W = doc.internal.pageSize.getWidth()
    let y = 20

    const addPage = () => { doc.addPage(); y = 20 }
    const checkPage = (need: number) => { if (y + need > 260) addPage() }

    // ── Header ──
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text('Estado de Cuenta', 15, y)
    y += 8
    doc.setFontSize(11)
    doc.setFont('helvetica', 'normal')
    doc.text(lead.name || 'Sin nombre', 15, y)
    y += 5
    if (lead.company) { doc.text(lead.company, 15, y); y += 5 }
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text(`Generado: ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}`, 15, y)
    doc.setTextColor(0)
    y += 10

    // ── Resumen financiero ──
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('Resumen Financiero', 15, y); y += 7

    const fmtPDF = (n: number, cur: string) => cur === 'USD' ? `US$${n.toLocaleString('es-MX')}` : `$${n.toLocaleString('es-MX')}`
    const byCur = financials.byCur

    const summaryRows: [string, string, string][] = []
    if (byCur.USD.vendido > 0 || byCur.USD.cobrado > 0) {
      summaryRows.push(['Total Vendido USD', fmtPDF(byCur.USD.vendido, 'USD'), ''])
      summaryRows.push(['Cobrado USD', fmtPDF(byCur.USD.cobrado, 'USD'), ''])
      summaryRows.push(['Por Cobrar USD', fmtPDF(Math.max(0, byCur.USD.vendido - byCur.USD.cobrado), 'USD'), ''])
    }
    if (byCur.MXN.vendido > 0 || byCur.MXN.cobrado > 0) {
      summaryRows.push(['Total Vendido MXN', fmtPDF(byCur.MXN.vendido, 'MXN'), ''])
      summaryRows.push(['Cobrado MXN', fmtPDF(byCur.MXN.cobrado, 'MXN'), ''])
      summaryRows.push(['Por Cobrar MXN', fmtPDF(Math.max(0, byCur.MXN.vendido - byCur.MXN.cobrado), 'MXN'), ''])
    }

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    summaryRows.forEach(([label, val]) => {
      checkPage(5)
      doc.text(label, 18, y)
      doc.text(val, W - 18, y, { align: 'right' })
      y += 5
    })
    y += 6

    // ── Separator ──
    doc.setDrawColor(200); doc.line(15, y, W - 15, y); y += 8

    // ── Cotizaciones Cerradas (Contratos) ──
    const contratos = quotations.filter(q => q.stage === 'contrato')
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('Cotizaciones Cerradas', 15, y); y += 7

    if (contratos.length === 0) {
      doc.setFontSize(9); doc.setFont('helvetica', 'italic'); doc.setTextColor(120)
      doc.text('Sin cotizaciones cerradas', 18, y); doc.setTextColor(0); y += 8
    } else {
      // Table header
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(80)
      doc.text('Nombre', 18, y)
      doc.text('Especialidad', 90, y)
      doc.text('Moneda', 135, y)
      doc.text('Total', W - 18, y, { align: 'right' })
      doc.setTextColor(0)
      y += 2; doc.setDrawColor(180); doc.line(15, y, W - 15, y); y += 4

      doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
      contratos.forEach(q => {
        checkPage(6)
        const cur = getQuotCurrency(q)
        const proj = projects.find(p => p.cotizacion_id === q.id)
        const amount = proj ? (proj.contract_value || 0) : (q.total || 0)
        doc.text((q.name || '—').substring(0, 40), 18, y)
        doc.text((q.specialty || '—').toUpperCase(), 90, y)
        doc.text(cur, 135, y)
        doc.text(fmtPDF(amount, cur), W - 18, y, { align: 'right' })
        y += 5.5
      })
      y += 4
    }

    // ── Separator ──
    doc.setDrawColor(200); doc.line(15, y, W - 15, y); y += 8

    // ── Ingresos Registrados (bank_movements abonos) ──
    const ingresos = bankMovements.filter(m => m.tipo === 'abono')
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('Ingresos Registrados', 15, y); y += 7

    if (ingresos.length === 0) {
      doc.setFontSize(9); doc.setFont('helvetica', 'italic'); doc.setTextColor(120)
      doc.text('Sin ingresos registrados', 18, y); doc.setTextColor(0); y += 8
    } else {
      // Table header
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(80)
      doc.text('Fecha', 18, y)
      doc.text('Concepto', 48, y)
      doc.text('Moneda', 118, y)
      doc.text('Monto', 148, y, { align: 'right' })
      doc.text('T.C.', 162, y, { align: 'right' })
      doc.text('Equiv. USD', W - 18, y, { align: 'right' })
      doc.setTextColor(0)
      y += 2; doc.setDrawColor(180); doc.line(15, y, W - 15, y); y += 4

      doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
      let totalEquivUSD = 0
      ingresos.forEach(m => {
        checkPage(6)
        const cur = m.moneda || 'MXN'
        const isMxn = cur !== 'USD'
        const equivUsd = isMxn && m.tipo_cambio > 0 ? (m.monto || 0) / m.tipo_cambio : (isMxn ? 0 : (m.monto || 0))
        totalEquivUSD += equivUsd
        doc.text(m.fecha || '—', 18, y)
        doc.text((m.concepto || '—').substring(0, 35), 48, y)
        doc.text(cur, 118, y)
        doc.text(fmtPDF(m.monto || 0, cur), 148, y, { align: 'right' })
        doc.text(isMxn && m.tipo_cambio ? String(m.tipo_cambio) : '—', 162, y, { align: 'right' })
        doc.text(equivUsd > 0 ? fmtPDF(Math.round(equivUsd), 'USD') : '—', W - 18, y, { align: 'right' })
        y += 5.5
      })

      // Total equiv USD
      y += 3; checkPage(10)
      doc.setDrawColor(180); doc.line(120, y, W - 15, y); y += 4
      doc.setFont('helvetica', 'bold')
      doc.text('Total cobrado equiv.', 120, y)
      doc.text(fmtPDF(Math.round(totalEquivUSD), 'USD'), W - 18, y, { align: 'right' })
      y += 5
    }

    // ── Footer ──
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(7); doc.setTextColor(150)
      doc.text(`OMM ERP — Estado de Cuenta — ${lead.name}`, 15, 272)
      doc.text(`Pág. ${i}/${pageCount}`, W - 15, 272, { align: 'right' })
    }

    doc.save(`Estado_de_Cuenta_${(lead.name || 'Lead').replace(/\s+/g, '_')}.pdf`)
  }

  // ── COMPUTED ──────────────────────────────────────────────────
  const getQuotCurrency = (q: any): 'USD' | 'MXN' => {
    try {
      const n = typeof q.notes === 'string' ? JSON.parse(q.notes) : q.notes
      return n?.currency === 'MXN' ? 'MXN' : 'USD'
    } catch { return 'USD' }
  }

  const toMXN = (amount: number, currency: string) =>
    currency === 'USD' ? amount * tipoCambio : amount

  // Financial summary — track USD and MXN separately
  const financials = useMemo(() => {
    const byCur = { USD: { vendido: 0, cobrado: 0, comprado: 0, presupuesto: 0 }, MXN: { vendido: 0, cobrado: 0, comprado: 0, presupuesto: 0 } }

    // Vendido: contratos
    quotations.filter(q => q.stage === 'contrato').forEach(q => {
      const cur = getQuotCurrency(q)
      const proj = projects.find(p => p.cotizacion_id === q.id)
      const amount = proj ? (proj.contract_value || 0) : (q.total || 0)
      byCur[cur].vendido += amount
    })

    // Cobrado: bank_movements (abonos) asignados al lead en contabilidad
    // Si un pago MXN tiene tipo_cambio, se convierte a USD equivalente
    bankMovements.filter(m => m.tipo === 'abono').forEach(m => {
      const cur: 'USD' | 'MXN' = m.moneda === 'USD' ? 'USD' : 'MXN'
      if (cur === 'MXN' && m.tipo_cambio && m.tipo_cambio > 0) {
        // Pago en MXN con TC → contar como cobro USD equivalente
        byCur.USD.cobrado += (m.monto || 0) / m.tipo_cambio
      } else {
        byCur[cur].cobrado += (m.monto || 0)
      }
    })

    // Comprado: POs
    pos.filter(po => po.status !== 'cancelada').forEach(po => {
      const cur: 'USD' | 'MXN' = po.currency === 'USD' ? 'USD' : 'MXN'
      byCur[cur].comprado += (po.total || 0)
    })

    // Presupuesto compras: quotation items cost — group by quotation currency
    quotItems.forEach(qi => {
      const quot = quotations.find(q => q.id === qi.quotation_id)
      const cur = quot ? getQuotCurrency(quot) : 'MXN'
      byCur[cur].presupuesto += (qi.cost || 0) * (qi.quantity || 0)
    })

    // Totals converted to MXN for backward compat (bloqueos, etc.)
    const totalVendido = byCur.MXN.vendido + byCur.USD.vendido * tipoCambio
    const totalCobrado = byCur.MXN.cobrado + byCur.USD.cobrado * tipoCambio
    const totalComprado = byCur.MXN.comprado + byCur.USD.comprado * tipoCambio
    const totalCompras = byCur.MXN.presupuesto + byCur.USD.presupuesto * tipoCambio
    const porCobrar = Math.max(0, totalVendido - totalCobrado)
    const porComprar = Math.max(0, totalCompras - totalComprado)

    return { byCur, totalVendido, totalCobrado, totalComprado, totalCompras, porCobrar, porComprar }
  }, [quotations, projects, bankMovements, pos, quotItems, tipoCambio])

  // Bloqueos automáticos
  const autoBloqueos = useMemo(() => {
    const list: { tipo: string; descripcion: string; severidad: string; fuente: string }[] = []

    // Cobranza: cobrado < gastado = alerta
    if (financials.totalCobrado < financials.totalComprado && financials.totalComprado > 0) {
      list.push({
        tipo: 'Cobranza', severidad: 'alta',
        descripcion: `Cobrado (${F(financials.totalCobrado)}) es menor a lo comprado (${F(financials.totalComprado)})`,
        fuente: 'Estado de cuenta',
      })
    }

    // Milestones vencidos
    const vencidos = milestones.filter(m => m.status === 'vencido')
    if (vencidos.length > 0) {
      const montoVencido = vencidos.reduce((s, m) => s + (m.amount || 0), 0)
      list.push({
        tipo: 'Cobranza', severidad: 'alta',
        descripcion: `${vencidos.length} cobro(s) vencido(s) por ${F(montoVencido)}`,
        fuente: 'Milestones',
      })
    }

    // Cotizaciones pendientes sin decisión (más de 15 días en oportunidad/cotizando)
    const now = new Date()
    quotations.filter(q => q.stage === 'oportunidad' || q.stage === 'cotizando').forEach(q => {
      const created = new Date(q.created_at)
      const days = Math.floor((now.getTime() - created.getTime()) / 86400000)
      if (days > 15) {
        list.push({
          tipo: 'Decisión cliente', severidad: 'media',
          descripcion: `"${q.name}" lleva ${days} días sin aprobación`,
          fuente: 'Cotizaciones',
        })
      }
    })

    // POs sin confirmar por más de 7 días
    pos.filter(po => po.status === 'enviada').forEach(po => {
      const created = new Date(po.created_at)
      const days = Math.floor((now.getTime() - created.getTime()) / 86400000)
      if (days > 7) {
        list.push({
          tipo: 'Compras', severidad: 'baja',
          descripcion: `PO ${po.po_number} enviada hace ${days} días sin confirmar`,
          fuente: 'Compras',
        })
      }
    })

    // Tareas bloqueadas en proyecto
    tasks.filter(t => t.status === 'bloqueada').forEach(t => {
      list.push({
        tipo: 'Proyecto', severidad: 'media',
        descripcion: `Tarea bloqueada: "${t.name}"${t.notes ? ' — ' + t.notes : ''}`,
        fuente: 'Proyecto',
      })
    })

    return list
  }, [financials, milestones, quotations, pos, tasks])

  // All bloqueos: obra_bloqueos (manual from obra) + auto-detected
  const allBloqueos = useMemo(() => {
    const manual = obraBloqueos.map(b => ({
      tipo: b.tipo || 'Obra',
      descripcion: b.descripcion,
      severidad: b.severidad || 'media',
      fuente: 'Obra',
      status: b.status,
      fecha: b.fecha_reporte,
    }))
    const auto = autoBloqueos.map(b => ({ ...b, status: 'activo', fecha: null }))
    return [...auto, ...manual.filter(b => b.status !== 'resuelto')]
  }, [obraBloqueos, autoBloqueos])

  // ── RENDER ────────────────────────────────────────────────────
  if (loading) return <Loading />
  if (!lead) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#555' }}>
      <div style={{ fontSize: 18, marginBottom: 12 }}>Lead no encontrado</div>
      <button onClick={() => navigate('/crm')} style={linkBtnS}>← Volver a CRM</button>
    </div>
  )

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate('/crm')} style={{ ...linkBtnS, padding: '6px 10px' }}>
          <ArrowLeft size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{lead.name}</div>
          <div style={{ fontSize: 13, color: '#666' }}>
            {lead.company && <span>{lead.company} · </span>}
            {lead.contact_name && <span>{lead.contact_name} · </span>}
            <Badge label={lead.status} color={lead.status === 'ganado' ? '#57FF9A' : lead.status === 'perdido' ? '#EF4444' : '#3B82F6'} />
          </div>
        </div>
      </div>

      {/* T.C. referencia + equivalente MXN */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#111', border: '1px solid #333', borderRadius: 8, padding: '6px 12px' }}>
          <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>T.C. referencia</span>
          <input
            type="number" step="0.01" min="1"
            value={tipoCambio}
            onChange={e => { const v = parseFloat(e.target.value); if (v > 0) setTipoCambio(v) }}
            style={{ width: 65, background: '#0a0a0a', border: '1px solid #444', borderRadius: 4, padding: '4px 6px', fontSize: 13, fontWeight: 700, color: '#fff', textAlign: 'center', fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
          <span style={{ color: '#57FF9A', fontWeight: 600 }}>Vendido {F(financials.totalVendido)}</span>
          <span style={{ color: '#34D399', fontWeight: 600 }}>Cobrado {F(financials.totalCobrado)}</span>
          <span style={{ color: '#F59E0B', fontWeight: 600 }}>Por cobrar {F(financials.porCobrar)}</span>
          <span style={{ color: '#3B82F6', fontWeight: 600 }}>{financials.totalVendido > 0 ? PCT(financials.totalCobrado / financials.totalVendido) : '—'}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 24 }}>
        <KpiDual label="Total Vendido" usd={financials.byCur.USD.vendido} mxn={financials.byCur.MXN.vendido} color="#57FF9A" />
        <KpiDual label="Cobrado" usd={financials.byCur.USD.cobrado} mxn={financials.byCur.MXN.cobrado} color="#34D399" />
        <KpiDual label="Por Cobrar" usd={Math.max(0, financials.byCur.USD.vendido - financials.byCur.USD.cobrado)} mxn={Math.max(0, financials.byCur.MXN.vendido - financials.byCur.MXN.cobrado)} color="#F59E0B" />
        <KpiDual label="Comprado" usd={financials.byCur.USD.comprado} mxn={financials.byCur.MXN.comprado} color="#3B82F6" />
        <KpiDual label="Por Comprar" usd={Math.max(0, financials.byCur.USD.presupuesto - financials.byCur.USD.comprado)} mxn={Math.max(0, financials.byCur.MXN.presupuesto - financials.byCur.MXN.comprado)} color="#F59E0B" />
        <KpiMini label="Bloqueos" value={String(allBloqueos.length)} color={allBloqueos.length > 0 ? '#EF4444' : '#57FF9A'} />
      </div>

      {/* ══════════ 1. COTIZACIONES ══════════ */}
      <Section title="Cotizaciones" icon={<FileText size={14} />} count={quotations.length} expanded={expanded.cotizaciones} onToggle={() => toggle('cotizaciones')}>
        {quotations.length === 0 ? (
          <Empty text="Sin cotizaciones vinculadas" />
        ) : (
          <table style={tblS}>
            <thead>
              <tr style={trHeadS}>
                <th style={thS}>Nombre</th>
                <th style={thS}>Especialidad</th>
                <th style={thS}>Etapa</th>
                <th style={{ ...thS, textAlign: 'right' }}>Total</th>
                <th style={thS}>Moneda</th>
                <th style={thS}>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {quotations.map(q => {
                const curr = getQuotCurrency(q)
                const sym = curr === 'USD' ? 'US$' : '$'
                return (
                  <tr key={q.id} style={trS}>
                    <td style={tdS}><span style={{ color: '#fff', fontWeight: 500 }}>{q.name}</span></td>
                    <td style={tdS}><Badge label={q.specialty?.toUpperCase() || '—'} color="#555" /></td>
                    <td style={tdS}><Badge label={STAGE_LABELS[q.stage] || q.stage} color={STAGE_COLORS[q.stage] || '#555'} /></td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: q.stage === 'contrato' ? '#57FF9A' : '#888' }}>
                      {sym}{(q.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 0 })}
                    </td>
                    <td style={tdS}>
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: curr === 'USD' ? '#3B82F620' : '#57FF9A20', color: curr === 'USD' ? '#3B82F6' : '#57FF9A' }}>{curr}</span>
                    </td>
                    <td style={{ ...tdS, color: '#555' }}>{q.created_at?.slice(0, 10)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* ══════════ 2. ESTADO DE CUENTA ══════════ */}
      <Section title="Estado de Cuenta" icon={<DollarSign size={14} />} count={bankMovements.filter(m => m.tipo === 'abono').length} expanded={expanded.estado} onToggle={() => toggle('estado')}>
        {/* Summary bar — dual currency */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          <MiniStatDual label="Total vendido" usd={financials.byCur.USD.vendido} mxn={financials.byCur.MXN.vendido} accent="#57FF9A" />
          <MiniStatDual label="Cobrado" usd={financials.byCur.USD.cobrado} mxn={financials.byCur.MXN.cobrado} accent="#34D399" />
          <MiniStatDual label="Por cobrar" usd={Math.max(0, financials.byCur.USD.vendido - financials.byCur.USD.cobrado)} mxn={Math.max(0, financials.byCur.MXN.vendido - financials.byCur.MXN.cobrado)} accent="#F59E0B" />
          <MiniStat label="% Cobro" value={financials.totalVendido > 0 ? PCT(financials.totalCobrado / financials.totalVendido) : '—'} accent="#3B82F6" />
        </div>
        {/* Progress bar */}
        {financials.totalVendido > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: '#1a1a1a' }}>
              <div style={{ width: `${Math.min((financials.totalCobrado / financials.totalVendido) * 100, 100)}%`, background: '#57FF9A', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {/* ── Ingresos registrados (bank movements — real cobrado) ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingresos Registrados</span>
          <button onClick={exportEstadoCuenta} style={{ ...linkBtnS, padding: '4px 10px', fontSize: 11, gap: 4, color: '#3B82F6', borderColor: '#3B82F644' }}>
            <Download size={12} /> Exportar PDF
          </button>
        </div>
        {(() => {
          const ingresos = bankMovements.filter(m => m.tipo === 'abono')
          if (ingresos.length === 0) return <Empty text="Sin ingresos registrados — asigna movimientos bancarios a este lead en Contabilidad" />

          const saveTc = async (movId: string, tc: number | null) => {
            setBankMovements(prev => prev.map(m => m.id === movId ? { ...m, tipo_cambio: tc } : m))
            await supabase.from('bank_movements').update({ tipo_cambio: tc }).eq('id', movId)
          }

          return (
            <table style={tblS}>
              <thead>
                <tr style={trHeadS}>
                  <th style={thS}>Fecha</th>
                  <th style={thS}>Concepto</th>
                  <th style={thS}>Moneda</th>
                  <th style={{ ...thS, textAlign: 'right' }}>Monto</th>
                  <th style={{ ...thS, textAlign: 'center' }}>T.C.</th>
                  <th style={{ ...thS, textAlign: 'right' }}>Equiv. USD</th>
                </tr>
              </thead>
              <tbody>
                {ingresos.map(m => {
                  const cur = m.moneda || 'MXN'
                  const isMxn = cur !== 'USD'
                  const equivUsd = isMxn && m.tipo_cambio > 0 ? (m.monto || 0) / m.tipo_cambio : null
                  return (
                    <tr key={m.id} style={trS}>
                      <td style={{ ...tdS, color: '#888' }}>{m.fecha || '—'}</td>
                      <td style={tdS}>
                        <span style={{ color: '#fff', fontWeight: 500 }}>{(m.concepto || '—').substring(0, 45)}</span>
                        {m.referencia && <span style={{ color: '#555', fontSize: 10, marginLeft: 6 }}>{m.referencia}</span>}
                      </td>
                      <td style={tdS}><Badge label={cur} color={cur === 'USD' ? '#06B6D4' : '#A78BFA'} /></td>
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: '#57FF9A' }}>{FCUR(m.monto || 0, cur)}</td>
                      <td style={{ ...tdS, textAlign: 'center' }}>
                        {isMxn ? (
                          <input
                            type="number" step="0.01" min="1"
                            placeholder="T.C."
                            defaultValue={m.tipo_cambio || ''}
                            onBlur={e => {
                              const v = parseFloat(e.target.value)
                              saveTc(m.id, v > 0 ? v : null)
                            }}
                            style={{ width: 65, background: '#0a0a0a', border: '1px solid #333', borderRadius: 4, padding: '3px 5px', fontSize: 11, color: '#fff', textAlign: 'center', fontFamily: 'inherit' }}
                          />
                        ) : <span style={{ color: '#555', fontSize: 10 }}>—</span>}
                      </td>
                      <td style={{ ...tdS, textAlign: 'right', fontSize: 11, color: equivUsd ? '#06B6D4' : '#555' }}>
                        {equivUsd ? FUSD(Math.round(equivUsd)) : isMxn ? 'sin T.C.' : FUSD(m.monto || 0)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        })()}

        {/* ── Hitos de cobro (planning) ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hitos de Cobro</span>
          <button onClick={() => setShowNewMilestone(true)} style={{ ...linkBtnS, padding: '4px 10px', fontSize: 11, gap: 4, color: '#57FF9A', borderColor: '#57FF9A44' }}>
            <Plus size={12} /> Nuevo hito
          </button>
        </div>
        {milestones.length === 0 ? (
          <Empty text="Sin hitos de cobro registrados" />
        ) : (
          <table style={tblS}>
            <thead>
              <tr style={trHeadS}>
                <th style={thS}>Hito</th>
                <th style={thS}>Proyecto</th>
                <th style={thS}>Vencimiento</th>
                <th style={thS}>Estado</th>
                <th style={{ ...thS, textAlign: 'right' }}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {milestones.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).map(m => {
                const proj = projects.find(p => p.id === m.project_id)
                const quot = proj ? quotations.find(q => q.id === proj.cotizacion_id) : null
                const mCur = m.currency || (quot ? getQuotCurrency(quot) : 'MXN')
                return (
                  <tr key={m.id} style={trS}>
                    <td style={tdS}><span style={{ color: '#fff', fontWeight: 500 }}>{m.name}</span></td>
                    <td style={{ ...tdS, color: '#666', fontSize: 11 }}>{proj?.name || '—'}</td>
                    <td style={{ ...tdS, color: m.status === 'vencido' ? '#EF4444' : '#888' }}>{m.due_date || '—'}</td>
                    <td style={tdS}><Badge label={m.status} color={MILESTONE_COLOR[m.status] || '#555'} /></td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: m.status === 'cobrado' ? '#57FF9A' : '#fff' }}>{FCUR(m.amount || 0, mCur)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* ── New milestone form ── */}
        {showNewMilestone && <NewMilestoneForm
          projects={projects}
          quotations={quotations}
          getQuotCurrency={getQuotCurrency}
          onClose={() => setShowNewMilestone(false)}
          onCreated={(m: any) => { setMilestones(prev => [...prev, m]); setShowNewMilestone(false) }}
        />}
        {/* Alerta: cobrado < comprado */}
        {financials.totalCobrado < financials.totalComprado && financials.totalComprado > 0 && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#EF444410', border: '1px solid #EF444440', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={14} color="#EF4444" />
            <span style={{ fontSize: 12, color: '#EF4444' }}>Lo cobrado es menor a lo comprado. Diferencia: {F(financials.totalComprado - financials.totalCobrado)}</span>
          </div>
        )}
      </Section>

      {/* ══════════ 3. COMPRAS FALTANTES ══════════ */}
      <Section title="Compras" icon={<ShoppingCart size={14} />} count={pos.length} expanded={expanded.compras} onToggle={() => toggle('compras')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          <MiniStatDual label="Presupuesto compras" usd={financials.byCur.USD.presupuesto} mxn={financials.byCur.MXN.presupuesto} accent="#3B82F6" />
          <MiniStatDual label="Comprado" usd={financials.byCur.USD.comprado} mxn={financials.byCur.MXN.comprado} accent="#F59E0B" />
          <MiniStatDual label="Por comprar" usd={Math.max(0, financials.byCur.USD.presupuesto - financials.byCur.USD.comprado)} mxn={Math.max(0, financials.byCur.MXN.presupuesto - financials.byCur.MXN.comprado)} accent={financials.porComprar > 0 ? '#EF4444' : '#57FF9A'} />
          <MiniStat label="% Avance" value={financials.totalCompras > 0 ? PCT(financials.totalComprado / financials.totalCompras) : '—'} accent="#3B82F6" />
        </div>
        {pos.length === 0 ? (
          <Empty text="Sin órdenes de compra" />
        ) : (
          <table style={tblS}>
            <thead>
              <tr style={trHeadS}>
                <th style={thS}>OC #</th>
                <th style={thS}>Proyecto</th>
                <th style={thS}>Estado</th>
                <th style={thS}>Moneda</th>
                <th style={{ ...thS, textAlign: 'right' }}>Total</th>
                <th style={thS}>Entrega</th>
              </tr>
            </thead>
            <tbody>
              {pos.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map(po => {
                const proj = projects.find(p => p.id === po.project_id)
                const sym = po.currency === 'USD' ? 'US$' : '$'
                return (
                  <tr key={po.id} style={{ ...trS, opacity: po.status === 'cancelada' ? 0.4 : 1 }}>
                    <td style={tdS}><span style={{ color: '#fff', fontWeight: 500 }}>{po.po_number || '—'}</span></td>
                    <td style={{ ...tdS, color: '#666', fontSize: 11 }}>{proj?.name || '—'}</td>
                    <td style={tdS}><Badge label={po.status} color={PO_STATUS_COLOR[po.status] || '#555'} /></td>
                    <td style={tdS}>
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: po.currency === 'USD' ? '#3B82F620' : '#57FF9A20', color: po.currency === 'USD' ? '#3B82F6' : '#57FF9A' }}>{po.currency || 'MXN'}</span>
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: '#fff' }}>{sym}{(po.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 0 })}</td>
                    <td style={{ ...tdS, color: '#888' }}>{po.expected_delivery || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* ══════════ 4. PROYECTOS (DISEÑO) ══════════ */}
      <Section title="Proyectos (Diseño)" icon={<Briefcase size={14} />} count={projects.length} expanded={expanded.proyectos} onToggle={() => toggle('proyectos')}>
        {projects.length === 0 ? (
          <Empty text="Sin proyectos de diseño vinculados" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {projects.map(proj => {
              const projPhases = phases.filter(ph => ph.project_id === proj.id).sort((a, b) => a.order_index - b.order_index)
              const projTasks = tasks.filter(t => t.project_id === proj.id)
              const totalTasks = projTasks.length
              const completedTasks = projTasks.filter(t => t.status === 'completada').length
              const pctAvance = totalTasks > 0 ? completedTasks / totalTasks : 0

              return (
                <div key={proj.id} style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 8, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{proj.name}</div>
                      <div style={{ fontSize: 11, color: '#555' }}>
                        {proj.specialty?.toUpperCase()} · {proj.status} · {(() => { const q = quotations.find(x => x.id === proj.cotizacion_id); return FCUR(proj.contract_value || 0, q ? getQuotCurrency(q) : 'MXN') })()}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#57FF9A' }}>{PCT(pctAvance)}</div>
                      <div style={{ fontSize: 10, color: '#555' }}>{completedTasks}/{totalTasks} tareas</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 6, borderRadius: 3, background: '#1a1a1a', marginBottom: 10 }}>
                    <div style={{ width: `${pctAvance * 100}%`, height: '100%', borderRadius: 3, background: '#57FF9A', transition: 'width 0.3s' }} />
                  </div>
                  {/* Phases & tasks */}
                  {projPhases.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {projPhases.map(ph => {
                        const phaseTasks = projTasks.filter(t => t.phase_id === ph.id)
                        const phDone = phaseTasks.filter(t => t.status === 'completada').length
                        return (
                          <div key={ph.id} style={{ padding: '6px 10px', background: '#0a0a0a', borderRadius: 6, border: '1px solid #1a1a1a' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 12, color: '#aaa', fontWeight: 500 }}>{ph.name}</span>
                              <span style={{ fontSize: 10, color: '#555' }}>{phDone}/{phaseTasks.length}</span>
                            </div>
                            {phaseTasks.length > 0 && (
                              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {phaseTasks.map(t => (
                                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#888', padding: '2px 6px', background: '#111', borderRadius: 4 }}>
                                    {TASK_STATUS_ICON[t.status] || <Clock size={10} />}
                                    {t.name}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* ══════════ 5. OBRA (IMPLEMENTACIÓN) ══════════ */}
      <Section title="Obra (Implementación)" icon={<HardHat size={14} />} count={obras.length} expanded={expanded.obra} onToggle={() => toggle('obra')}>
        {obras.length === 0 ? (
          <Empty text="Sin obras de implementación vinculadas" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {obras.map(obra => {
              const acts = obraActividades.filter(a => a.obra_id === obra.id)
              const avgPct = acts.length > 0 ? acts.reduce((s, a) => s + (a.porcentaje || 0), 0) / acts.length : (obra.avance_global || 0)
              return (
                <div key={obra.id} style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 8, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{obra.nombre}</div>
                      <div style={{ fontSize: 11, color: '#555' }}>
                        {obra.status} · {obra.direccion || ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#3B82F6' }}>{Math.round(avgPct)}%</div>
                      <div style={{ fontSize: 10, color: '#555' }}>{acts.length} actividades</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 6, borderRadius: 3, background: '#1a1a1a', marginBottom: 10 }}>
                    <div style={{ width: `${avgPct}%`, height: '100%', borderRadius: 3, background: '#3B82F6', transition: 'width 0.3s' }} />
                  </div>
                  {/* Actividades */}
                  {acts.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {acts.sort((a, b) => (a.order_index || 0) - (b.order_index || 0)).map(a => (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: '#0a0a0a', borderRadius: 4, border: '1px solid #1a1a1a' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: '#aaa' }}>{a.descripcion || a.sistema}</span>
                            {a.area && <span style={{ fontSize: 9, color: '#555' }}>({a.area})</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 40, height: 4, borderRadius: 2, background: '#1a1a1a' }}>
                              <div style={{ width: `${a.porcentaje || 0}%`, height: '100%', borderRadius: 2, background: (a.porcentaje || 0) >= 100 ? '#57FF9A' : '#3B82F6' }} />
                            </div>
                            <span style={{ fontSize: 10, color: '#888', minWidth: 28, textAlign: 'right' }}>{a.porcentaje || 0}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* ══════════ 6. BLOQUEOS ══════════ */}
      <Section title="Bloqueos / Temas a revisar" icon={<AlertTriangle size={14} />} count={allBloqueos.length} expanded={expanded.bloqueos} onToggle={() => toggle('bloqueos')}>
        {allBloqueos.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#57FF9A', fontSize: 13 }}>
            <CheckCircle2 size={20} style={{ verticalAlign: -4, marginRight: 6 }} />
            Sin bloqueos detectados
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {allBloqueos.sort((a, b) => {
              const sev = { critica: 0, alta: 1, media: 2, baja: 3 }
              return (sev[a.severidad as keyof typeof sev] ?? 4) - (sev[b.severidad as keyof typeof sev] ?? 4)
            }).map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: '#111', border: `1px solid ${BLOQUEO_SEV_COLOR[b.severidad] || '#333'}30`, borderRadius: 8, borderLeft: `3px solid ${BLOQUEO_SEV_COLOR[b.severidad] || '#555'}` }}>
                <AlertTriangle size={14} color={BLOQUEO_SEV_COLOR[b.severidad] || '#F59E0B'} style={{ marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: '#fff', fontWeight: 500 }}>{b.descripcion}</div>
                  <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
                    <Badge label={b.tipo} color={BLOQUEO_SEV_COLOR[b.severidad] || '#555'} />
                    <span style={{ marginLeft: 8 }}>Fuente: {b.fuente}</span>
                    <span style={{ marginLeft: 8 }}>Severidad: {b.severidad}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MILESTONE FORMS
// ═══════════════════════════════════════════════════════════════════

const formInputS: React.CSSProperties = { width: '100%', padding: '7px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box' }
const formLabelS: React.CSSProperties = { fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3, display: 'block' }

function NewMilestoneForm({ projects, quotations, getQuotCurrency, onClose, onCreated }: {
  projects: any[]; quotations: any[]; getQuotCurrency: (q: any) => 'USD' | 'MXN'
  onClose: () => void; onCreated: (m: any) => void
}) {
  const [form, setForm] = useState({ name: '', project_id: '', amount: '', due_date: '', currency: 'MXN' })
  const [saving, setSaving] = useState(false)

  // Auto-detect currency from project's quotation
  const handleProjectChange = (projId: string) => {
    const proj = projects.find(p => p.id === projId)
    const quot = proj ? quotations.find(q => q.id === proj.cotizacion_id) : null
    const cur = quot ? getQuotCurrency(quot) : 'MXN'
    setForm(f => ({ ...f, project_id: projId, currency: cur }))
  }

  const save = async () => {
    if (!form.name || !form.amount || !form.project_id) return
    setSaving(true)
    const { data, error } = await supabase.from('payment_milestones').insert({
      name: form.name, project_id: form.project_id,
      amount: parseFloat(form.amount), due_date: form.due_date || null,
      currency: form.currency, status: 'pendiente',
    }).select().single()
    setSaving(false)
    if (error) { alert('Error: ' + error.message); return }
    onCreated(data)
  }

  return (
    <div style={{ marginTop: 12, padding: 16, background: '#111', border: '1px solid #57FF9A33', borderRadius: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Nuevo hito de cobro</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 120px 130px 90px', gap: 8, alignItems: 'end' }}>
        <div>
          <label style={formLabelS}>Nombre</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Anticipo 50%" style={formInputS} />
        </div>
        <div>
          <label style={formLabelS}>Proyecto</label>
          <select value={form.project_id} onChange={e => handleProjectChange(e.target.value)} style={formInputS}>
            <option value="">Seleccionar...</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label style={formLabelS}>Monto ({form.currency})</label>
          <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={formInputS} />
        </div>
        <div>
          <label style={formLabelS}>Vencimiento</label>
          <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} style={formInputS} />
        </div>
        <div>
          <label style={formLabelS}>Moneda</label>
          <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} style={formInputS}>
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button onClick={save} disabled={saving || !form.name || !form.amount || !form.project_id}
          style={{ ...linkBtnS, padding: '5px 12px', fontSize: 11, color: '#57FF9A', borderColor: '#57FF9A44', opacity: (!form.name || !form.amount || !form.project_id) ? 0.4 : 1 }}>
          {saving ? 'Guardando...' : 'Crear hito'}
        </button>
        <button onClick={onClose} style={{ ...linkBtnS, padding: '5px 12px', fontSize: 11 }}>Cancelar</button>
      </div>
    </div>
  )
}

function CobrarModal({ milestone, tipoCambioDefault, onClose, onCobrado }: {
  milestone: any; tipoCambioDefault: number; onClose: () => void; onCobrado: (m: any) => void
}) {
  const isUSD = milestone._cur === 'USD' || milestone.currency === 'USD'
  const [pagoEn, setPagoEn] = useState<'USD' | 'MXN'>(isUSD ? 'MXN' : 'MXN') // default: pagado en MXN
  const [tc, setTc] = useState(String(tipoCambioDefault))
  const [montoMxn, setMontoMxn] = useState(String(Math.round((milestone.amount || 0) * tipoCambioDefault)))
  const [saving, setSaving] = useState(false)

  // When TC changes, recalculate MXN
  const handleTcChange = (val: string) => {
    setTc(val)
    const rate = parseFloat(val) || 0
    if (rate > 0) setMontoMxn(String(Math.round((milestone.amount || 0) * rate)))
  }

  const save = async () => {
    setSaving(true)
    const update: any = { status: 'cobrado', paid_at: new Date().toISOString() }
    if (isUSD && pagoEn === 'MXN') {
      update.amount_paid_mxn = parseFloat(montoMxn) || 0
      update.tipo_cambio_pago = parseFloat(tc) || 0
    }
    const { data, error } = await supabase.from('payment_milestones').update(update).eq('id', milestone.id).select().single()
    setSaving(false)
    if (error) { alert('Error: ' + error.message); return }
    onCobrado(data)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1020, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 12, padding: 24, width: 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Registrar cobro</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        <div style={{ padding: 12, background: '#0a0a0a', borderRadius: 8, marginBottom: 16, border: '1px solid #222' }}>
          <div style={{ fontSize: 12, color: '#ccc', fontWeight: 500 }}>{milestone.name}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: isUSD ? '#06B6D4' : '#57FF9A', marginTop: 4 }}>
            {FCUR(milestone.amount || 0, milestone._cur || milestone.currency || 'MXN')}
          </div>
        </div>

        {isUSD && (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={formLabelS}>¿En qué moneda te pagaron?</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['MXN', 'USD'] as const).map(c => (
                  <button key={c} onClick={() => setPagoEn(c)} style={{
                    flex: 1, padding: '8px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'inherit',
                    background: pagoEn === c ? (c === 'USD' ? '#06B6D420' : '#57FF9A20') : '#1a1a1a',
                    border: `1px solid ${pagoEn === c ? (c === 'USD' ? '#06B6D4' : '#57FF9A') : '#333'}`,
                    color: pagoEn === c ? (c === 'USD' ? '#06B6D4' : '#57FF9A') : '#666',
                  }}>{c === 'MXN' ? 'Pesos (MXN)' : 'Dólares (USD)'}</button>
                ))}
              </div>
            </div>

            {pagoEn === 'MXN' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={formLabelS}>Tipo de cambio</label>
                  <input type="number" step="0.01" value={tc} onChange={e => handleTcChange(e.target.value)} style={formInputS} />
                </div>
                <div>
                  <label style={formLabelS}>Monto recibido (MXN)</label>
                  <input type="number" value={montoMxn} onChange={e => setMontoMxn(e.target.value)} style={formInputS} />
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ ...linkBtnS, padding: '6px 14px', fontSize: 12 }}>Cancelar</button>
          <button onClick={save} disabled={saving} style={{
            ...linkBtnS, padding: '6px 14px', fontSize: 12, fontWeight: 600,
            color: '#57FF9A', borderColor: '#57FF9A44', background: '#57FF9A10',
          }}>
            {saving ? 'Guardando...' : '✓ Marcar como cobrado'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// UI helpers
// ═══════════════════════════════════════════════════════════════════

function Section({ title, icon, count, expanded, onToggle, children }: {
  title: string; icon: React.ReactNode; count: number; expanded: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px',
        background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 13, fontWeight: 600, textAlign: 'left',
      }}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        {title}
        <span style={{ fontSize: 11, color: '#444', fontWeight: 400, marginLeft: 4 }}>({count})</span>
      </button>
      {expanded && <div style={{ padding: '0 18px 16px' }}>{children}</div>}
    </div>
  )
}

function KpiMini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

/** KPI that shows USD and MXN on separate lines */
function KpiDual({ label, usd, mxn, color }: { label: string; usd: number; mxn: number; color: string }) {
  return (
    <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      {usd > 0 && <div style={{ fontSize: 15, fontWeight: 700, color: '#06B6D4', fontVariantNumeric: 'tabular-nums' }}>{FUSD(usd)}</div>}
      {mxn > 0 && <div style={{ fontSize: usd > 0 ? 13 : 15, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{F(mxn)}</div>}
      {usd === 0 && mxn === 0 && <div style={{ fontSize: 16, fontWeight: 700, color: '#333' }}>$0</div>}
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

function MiniStatDual({ label, usd, mxn, accent }: { label: string; usd: number; mxn: number; accent: string }) {
  return (
    <div style={{ padding: '8px 10px', background: '#111', borderRadius: 8, border: '1px solid #1a1a1a' }}>
      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>{label}</div>
      {usd > 0 && <div style={{ fontSize: 14, fontWeight: 600, color: '#06B6D4', fontVariantNumeric: 'tabular-nums' }}>{FUSD(usd)}</div>}
      {mxn > 0 && <div style={{ fontSize: usd > 0 ? 12 : 14, fontWeight: 600, color: accent, fontVariantNumeric: 'tabular-nums' }}>{F(mxn)}</div>}
      {usd === 0 && mxn === 0 && <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>$0</div>}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 16, textAlign: 'center', color: '#444', fontSize: 12 }}>{text}</div>
}

// Styles
const linkBtnS: React.CSSProperties = {
  background: '#111', border: '1px solid #222', borderRadius: 6, color: '#888', cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
}
const tblS: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 }
const trHeadS: React.CSSProperties = { borderBottom: '1px solid #333' }
const trS: React.CSSProperties = { borderBottom: '1px solid #1a1a1a' }
const thS: React.CSSProperties = { padding: '8px 10px', fontSize: 10, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left', whiteSpace: 'nowrap' }
const tdS: React.CSSProperties = { padding: '10px 10px', fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
