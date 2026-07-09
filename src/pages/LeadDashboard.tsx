import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SPECIALTY_CONFIG } from '../lib/utils'
import { Loading, Badge, SectionHeader } from '../components/layout/UI'
import { useIsMobile } from '../lib/useIsMobile'
import { useAuth } from '../contexts/AuthContext'
import {
  ArrowLeft, FileText, DollarSign, ShoppingCart, Briefcase,
  HardHat, AlertTriangle, ChevronDown, ChevronRight, ExternalLink,
  CheckCircle2, Clock, XCircle, TrendingUp, Package, BarChart3, Plus, X, Download,
} from 'lucide-react'
import jsPDF from 'jspdf'
import PaymentPlanModal from '../components/PaymentPlanModal'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════
const F = (n: number) => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const FUSD = (n: number) => 'US$' + n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const FCUR = (n: number, cur: string) => cur === 'USD' ? FUSD(n) : F(n)
const PCT = (n: number) => (n * 100).toFixed(1) + '%'

const STAGE_COLORS: Record<string, string> = {
  oportunidad: '#D97706', cotizando: '#2563EB', negociacion: '#A78BFA',
  contrato: '#10B981', perdido: '#DC2626', pausado: '#6B7280',
}
const STAGE_LABELS: Record<string, string> = {
  oportunidad: 'Oportunidad', cotizando: 'Cotizando', negociacion: 'Negociación',
  contrato: 'Contrato', perdido: 'Perdido', pausado: 'Pausado',
}
const PO_STATUS_COLOR: Record<string, string> = {
  borrador: '#6B7280', enviada: '#2563EB', confirmada: '#10B981',
  entregada: '#34D399', cancelada: '#DC2626',
}
const MILESTONE_COLOR: Record<string, string> = {
  pendiente: '#D97706', vigente: '#2563EB', cobrado: '#10B981', vencido: '#DC2626',
}
const TASK_STATUS_ICON: Record<string, React.ReactNode> = {
  pendiente: <Clock size={12} color="#D97706" />,
  en_progreso: <BarChart3 size={12} color="#2563EB" />,
  completada: <CheckCircle2 size={12} color="#10B981" />,
  bloqueada: <XCircle size={12} color="#DC2626" />,
}
const BLOQUEO_SEV_COLOR: Record<string, string> = {
  baja: '#D97706', media: '#F97316', alta: '#DC2626', critica: '#DC2626',
}

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function LeadDashboard() {
  const isMobile = useIsMobile()
  const { user: authUser } = useAuth()
  const showFinancials = authUser?.permission_area === 'DG' || authUser?.permission_area === 'Administracion'
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
  // Movimientos de efectivo ligados al lead (cash_movements.lead_id)
  const [cashMovements, setCashMovements] = useState<any[]>([])
  const [paymentAllocations, setPaymentAllocations] = useState<any[]>([])
  const [tipoCambio, setTipoCambio] = useState(20.50)
  const saveTipoCambioRef = async (tc: number) => {
    setTipoCambio(tc)
    if (id) await supabase.from('leads').update({ tipo_cambio_ref: tc }).eq('id', id)
  }
  const [showNewMilestone, setShowNewMilestone] = useState(false)
  // Modal de plan de pagos con templates (reemplaza al widget de un hito a la vez).
  // selectedQuotForPlan: id de la cotización elegida cuando hay varias contratos.
  const [selectedQuotForPlan, setSelectedQuotForPlan] = useState<string | null>(null)
  // Si el user da click en "Plan de pagos" y hay > 1 cot contrato, abrir el selector.
  const [showQuotPicker, setShowQuotPicker] = useState(false)
  const [cobrarModal, setCobrarModal] = useState<any>(null) // milestone being marked as cobrado

  // (AI summary removed — replaced with computed consolidation)

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
    if (leadData.tipo_cambio_ref) setTipoCambio(leadData.tipo_cambio_ref)

    // 2. All quotations — filter by lead_id in notes JSON
    const { data: allQuots } = await supabase.from('quotations').select('*')
    const leadQuotsAll = (allQuots || []).filter(q => {
      try {
        const n = typeof q.notes === 'string' ? JSON.parse(q.notes) : q.notes
        return n?.lead_id === id
      } catch { return false }
    })
    // Deduplicate versions: keep only the most recently updated per version_group_id
    const bestInGroup = new Map<string, any>()
    leadQuotsAll.forEach(q => {
      const gid = q.version_group_id
      if (!gid) return
      const prev = bestInGroup.get(gid)
      if (!prev || q.updated_at > prev.updated_at) bestInGroup.set(gid, q)
    })
    const leadQuots = leadQuotsAll.filter(q => {
      const gid = q.version_group_id
      if (!gid) return true // no version group → always show
      return q.id === bestInGroup.get(gid)?.id
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

    // 4. Parallel: POs, milestones, obras, tasks, phases, employees, quotation items, bank movements, cash movements
    const [posRes, msRes, obrasRes, tasksRes, phasesRes, empRes, qiRes, bmRes, areasRes, paRes, cmRes] = await Promise.all([
      supabase.from('purchase_orders').select('*').in('project_id', [...projIds]),
      supabase.from('payment_milestones').select('*,currency,amount_paid_mxn,tipo_cambio_pago').in('project_id', [...projIds]),
      supabase.from('obras').select('*').in('project_id', [...projIds]),
      supabase.from('project_tasks').select('*').in('project_id', [...projIds]),
      supabase.from('project_phases').select('*').in('project_id', [...projIds]),
      supabase.from('employees').select('id,nombre,area').eq('activo', true),
      supabase.from('quotation_items').select('*').in('quotation_id', [...quotIds]),
      supabase.from('bank_movements').select('*').eq('lead_id', id!).order('fecha', { ascending: false }),
      supabase.from('quotation_areas').select('id,name,quotation_id').in('quotation_id', [...quotIds]),
      supabase.from('payment_allocations').select('*').in('quotation_id', [...quotIds]),
      supabase.from('cash_movements').select('*').eq('lead_id', id!).order('fecha', { ascending: false }),
    ])
    setPos(posRes.data || [])
    setMilestones(msRes.data || [])
    setEmployees(empRes.data || [])
    // Enrich quotation items with area names
    const areaMap: Record<string, string> = {}
    ;(areasRes.data || []).forEach((a: any) => { areaMap[a.id] = a.name })
    setQuotItems((qiRes.data || []).map((qi: any) => ({ ...qi, area_name: areaMap[qi.area_id] || 'Sin área' })))
    setTasks(tasksRes.data || [])
    setPhases(phasesRes.data || [])
    setBankMovements(bmRes.data || [])
    setPaymentAllocations(paRes.data || [])
    setCashMovements(cmRes.data || [])

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
  function exportConsolidado() {
    if (!lead) return
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
    const W = doc.internal.pageSize.getWidth()
    let y = 20

    const addPage = () => { doc.addPage(); y = 20 }
    const checkPage = (need: number) => { if (y + need > 260) addPage() }

    // ── Header ──
    doc.setFontSize(18); doc.setFont('helvetica', 'bold')
    doc.text('Resumen de Inversión', 15, y); y += 8
    doc.setFontSize(12); doc.setFont('helvetica', 'normal')
    doc.text(lead.name || 'Proyecto', 15, y); y += 5
    if (lead.company) { doc.text(lead.company, 15, y); y += 5 }
    doc.setFontSize(9); doc.setTextColor(120)
    doc.text(`Generado: ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}`, 15, y)
    doc.setTextColor(0); y += 10

    // ── Per currency sections ──
    ;(['USD', 'MXN'] as const).forEach(cur => {
      const summary = quotSummaryByCur[cur]
      if (summary.perQuot.length === 0) return
      const sym = cur === 'USD' ? 'US$' : '$'
      const fmtPDF = (n: number) => sym + n.toLocaleString('es-MX', { maximumFractionDigits: 0 })

      checkPage(30)
      // Grand Total box
      doc.setFillColor(245, 250, 245); doc.roundedRect(15, y, W - 30, 22, 3, 3, 'F')
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(60)
      doc.text(`INVERSIÓN ${cur}`, 20, y + 7)
      doc.setFontSize(16); doc.setTextColor(34, 139, 34)
      doc.text(`${fmtPDF(Math.round(summary.grandTotal))}`, 20, y + 16)
      doc.setFontSize(8); doc.setTextColor(120)
      doc.text(`c/IVA 16%  |  ${summary.perQuot.length} cotizacion${summary.perQuot.length > 1 ? 'es' : ''}`, 80, y + 16)
      doc.setTextColor(0); y += 28

      // Per-quotation breakdown
      doc.setFontSize(11); doc.setFont('helvetica', 'bold')
      doc.text(`Cotizaciones ${cur}`, 15, y); y += 6

      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(80)
      doc.text('Nombre', 18, y)
      doc.text('Especialidad', 110, y)
      doc.text('Items', 140, y, { align: 'right' })
      doc.text('Total c/IVA', W - 18, y, { align: 'right' })
      doc.setTextColor(0)
      y += 2; doc.setDrawColor(180); doc.line(15, y, W - 15, y); y += 4

      doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
      summary.perQuot.forEach((pq: any) => {
        checkPage(6)
        doc.text((pq.name || '—').substring(0, 50), 18, y)
        doc.text((pq.specialty || '—').toUpperCase(), 110, y)
        doc.text(String(pq.items), 140, y, { align: 'right' })
        doc.text(fmtPDF(Math.round(pq.subtotalIva)), W - 18, y, { align: 'right' })
        y += 5.5
      })
      y += 6

      // System breakdown
      if (summary.systems.length > 0) {
        doc.setDrawColor(200); doc.line(15, y, W - 15, y); y += 8
        doc.setFontSize(11); doc.setFont('helvetica', 'bold')
        doc.text(`Desglose por Sistema (${cur})`, 15, y); y += 6

        doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(80)
        doc.text('Sistema', 18, y)
        doc.text('% del total', 120, y, { align: 'right' })
        doc.text('Subtotal', W - 18, y, { align: 'right' })
        doc.setTextColor(0)
        y += 2; doc.setDrawColor(180); doc.line(15, y, W - 15, y); y += 4

        doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
        summary.systems.forEach(([sys, data]: [string, any]) => {
          checkPage(6)
          const pct = summary.grandTotal > 0 ? (data.subtotal / summary.grandTotal) * 100 : 0
          doc.text(sys, 18, y)
          doc.text(`${pct.toFixed(0)}%`, 120, y, { align: 'right' })
          doc.text(fmtPDF(Math.round(data.subtotal)), W - 18, y, { align: 'right' })
          const barX = 125; const barW = 40; const barH = 3
          doc.setFillColor(230, 230, 230); doc.rect(barX, y - 3, barW, barH, 'F')
          doc.setFillColor(87, 255, 154); doc.rect(barX, y - 3, barW * Math.min(pct, 100) / 100, barH, 'F')
          y += 5.5
        })
      }
      y += 10
    })

    // ── Footer ──
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(7); doc.setTextColor(150)
      doc.text(`OMM ERP — Resumen de Inversión — ${lead.name}`, 15, 272)
      doc.text(`Pág. ${i}/${pageCount}`, W - 15, 272, { align: 'right' })
    }

    doc.save(`Resumen_Inversion_${(lead.name || 'Lead').replace(/\s+/g, '_')}.pdf`)
  }

  // Cobros atribuidos a una cotización: prorrateo (payment_allocations) + movimientos
  // asignados directo por quotation_id (banco 'abono' y efectivo 'cobro_cliente').
  // Se evita doble conteo: un movimiento con prorrateo ya no se cuenta por su quotation_id.
  function getPagosDeCotizacion(qId: string, cur: string) {
    const allocMovIds = new Set(paymentAllocations.map((pa: any) => pa.bank_movement_id))
    const items: { date: string; concepto: string; monto: number; cur: string; tc?: number; source: 'prorrateo' | 'banco' | 'efectivo' }[] = []
    paymentAllocations.filter((pa: any) => pa.quotation_id === qId).forEach((pa: any) => {
      const mov = bankMovements.find((m: any) => m.id === pa.bank_movement_id)
      // Si el cobro fue en otra moneda, mostrar el origen y el TC acordado
      const extra = (pa.tc_aplicado && pa.monto_origen)
        ? ` · ${Math.round(Number(pa.monto_origen)).toLocaleString('es-MX')} ${pa.moneda_origen || ''} @ TC ${pa.tc_aplicado}`
        : ''
      items.push({ date: mov?.fecha || '', concepto: (mov?.concepto || 'Pago (prorrateo)') + extra, monto: Number(pa.monto) || 0, cur, tc: pa.tc_aplicado || mov?.tipo_cambio, source: 'prorrateo' })
    })
    bankMovements.filter((m: any) => m.tipo === 'abono' && m.quotation_id === qId && !allocMovIds.has(m.id) && (m.moneda || 'MXN') === cur)
      .forEach((m: any) => items.push({ date: m.fecha || '', concepto: m.concepto || 'Transferencia', monto: Number(m.monto) || 0, cur, tc: m.tipo_cambio, source: 'banco' }))
    cashMovements.filter((m: any) => m.tipo === 'cobro_cliente' && m.quotation_id === qId && !allocMovIds.has(m.id) && (m.moneda || 'MXN') === cur)
      .forEach((m: any) => items.push({ date: m.fecha || '', concepto: '💵 ' + (m.concepto || m.persona || 'Efectivo'), monto: Number(m.monto) || 0, cur, source: 'efectivo' }))
    return items.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }

  function exportEstadoCuenta() {
    if (!lead) return
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
    const W = doc.internal.pageSize.getWidth()
    const M = 15                       // margen
    const RIGHT = W - M
    let y = 16

    // ── Paleta ──
    const GREEN: [number, number, number] = [16, 185, 129]
    const DARK: [number, number, number] = [26, 26, 26]
    const GRAY: [number, number, number] = [120, 120, 120]
    const HEADFILL: [number, number, number] = [238, 241, 240]
    const ZEBRA: [number, number, number] = [248, 249, 249]
    const setTxt = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
    const setFill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])

    const money = (n: number, cur: string) => (cur === 'USD' ? 'US$' : '$') + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const addPage = () => { doc.addPage(); y = 18 }
    const checkPage = (need: number) => { if (y + need > 258) addPage() }
    const sectionTitle = (t: string) => {
      checkPage(16)
      setFill(DARK); doc.rect(M, y, RIGHT - M, 7, 'F')
      setFill(GREEN); doc.rect(M, y, 2, 7, 'F')
      setTxt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
      doc.text(t.toUpperCase(), M + 5, y + 4.8)
      setTxt(DARK); y += 11
    }

    // ── Encabezado ──
    setFill(GREEN); doc.rect(M, y, 5, 5, 'F')
    setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text('OMM TECHNOLOGIES', M + 7.5, y + 4)
    setTxt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.text(new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }), RIGHT, y + 4, { align: 'right' })
    y += 10
    setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
    doc.text('Estado de Cuenta', M, y + 2); y += 8
    setTxt([60, 60, 60]); doc.setFont('helvetica', 'normal'); doc.setFontSize(12)
    doc.text(lead.name || 'Sin nombre', M, y + 2); y += 6
    if (lead.company) { setTxt(GRAY); doc.setFontSize(9.5); doc.text(lead.company, M, y + 1); y += 5 }
    setFill(GREEN); doc.rect(M, y + 1, RIGHT - M, 0.8, 'F'); y += 8

    // ── Datos consolidados (consistentes con "cobros por cotización") ──
    const contratos = quotations.filter(q => q.stage === 'contrato')
    const resumen = { USD: { vendido: 0, cobrado: 0 }, MXN: { vendido: 0, cobrado: 0 } }
    const quoteData = contratos.map(q => {
      const cur = getQuotCurrency(q)
      const proj = projects.find(p => p.cotizacion_id === q.id)
      const total = (proj && proj.contract_value) ? Number(proj.contract_value) : quoteFinalConIva(q)
      const pagos = getPagosDeCotizacion(q.id, cur)
      const cobrado = pagos.reduce((s, p) => s + p.monto, 0)
      resumen[cur].vendido += total
      resumen[cur].cobrado += cobrado
      return { q, cur, total, cobrado, pagos }
    })

    // ── Resumen: tarjetas por moneda ──
    const curs = (['USD', 'MXN'] as const).filter(c => resumen[c].vendido > 0 || resumen[c].cobrado > 0)
    if (curs.length > 0) {
      const gap = 6
      const cardW = (RIGHT - M - gap * (curs.length - 1)) / curs.length
      const cardH = 30
      checkPage(cardH + 4)
      curs.forEach((c, i) => {
        const x = M + i * (cardW + gap)
        const pend = Math.max(0, resumen[c].vendido - resumen[c].cobrado)
        const pct = resumen[c].vendido > 0 ? resumen[c].cobrado / resumen[c].vendido : 0
        setFill([250, 250, 250]); doc.setDrawColor(225, 228, 227); doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD')
        // badge moneda
        setFill(c === 'USD' ? [6, 182, 212] : [167, 139, 250]); doc.roundedRect(x + 4, y + 4, 14, 5, 1, 1, 'F')
        setTxt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text(c, x + 11, y + 7.6, { align: 'center' })
        setTxt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
        doc.text('GENERAL', x + 21, y + 7.6)
        const line = (label: string, val: string, cc: [number, number, number], yy: number) => {
          setTxt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(label, x + 4, yy)
          setTxt(cc); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(val, x + cardW - 4, yy, { align: 'right' })
        }
        line('Total vendido', money(resumen[c].vendido, c), DARK, y + 15)
        line('Cobrado', money(resumen[c].cobrado, c), GREEN, y + 20.5)
        line('Pendiente', money(pend, c), [217, 119, 6], y + 26)
        // barra de avance
        setFill([230, 230, 230]); doc.rect(x + 4, y + cardH - 2.5, cardW - 8, 1.4, 'F')
        setFill(GREEN); doc.rect(x + 4, y + cardH - 2.5, (cardW - 8) * Math.min(pct, 1), 1.4, 'F')
      })
      y += cardH + 8
    }

    // ── Cotizaciones cerradas ──
    sectionTitle('Cotizaciones cerradas')
    if (quoteData.length === 0) {
      setTxt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.text('Sin cotizaciones cerradas', M + 3, y); y += 8
    } else {
      const cX = { nom: M + 3, esp: 108, mon: 140 }
      setFill(HEADFILL); doc.rect(M, y, RIGHT - M, 6, 'F')
      setTxt(GRAY); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
      doc.text('COTIZACIÓN', cX.nom, y + 4); doc.text('ESP.', cX.esp, y + 4); doc.text('MON.', cX.mon, y + 4); doc.text('TOTAL', RIGHT - 3, y + 4, { align: 'right' })
      y += 6
      quoteData.forEach(({ q, cur, total }, i) => {
        checkPage(7)
        if (i % 2 === 1) { setFill(ZEBRA); doc.rect(M, y, RIGHT - M, 6, 'F') }
        setTxt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
        doc.text((q.name || '—').substring(0, 46), cX.nom, y + 4)
        setTxt(GRAY); doc.setFontSize(7.5); doc.text((q.specialty || '—').toUpperCase(), cX.esp, y + 4); doc.text(cur, cX.mon, y + 4)
        setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(money(total, cur), RIGHT - 3, y + 4, { align: 'right' })
        y += 6
      })
      y += 6
    }

    // ── Movimientos de cobro recibidos ──
    const ingresos = [
      ...bankMovements.filter(m => m.tipo === 'abono').map(m => ({ fecha: m.fecha, concepto: m.concepto || 'Transferencia', moneda: (m.moneda === 'USD' ? 'USD' : 'MXN'), monto: Number(m.monto) || 0, metodo: 'Transf.' })),
      ...cashMovements.filter(m => m.tipo === 'cobro_cliente').map(m => ({ fecha: m.fecha, concepto: m.concepto || m.persona || 'Efectivo', moneda: (m.moneda === 'USD' ? 'USD' : 'MXN'), monto: Number(m.monto) || 0, metodo: 'Efectivo' })),
    ].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
    sectionTitle('Movimientos de cobro recibidos')
    if (ingresos.length === 0) {
      setTxt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.text('Sin cobros registrados', M + 3, y); y += 8
    } else {
      const cX = { fec: M + 3, con: 40, met: 112, mon: 138 }
      setFill(HEADFILL); doc.rect(M, y, RIGHT - M, 6, 'F')
      setTxt(GRAY); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
      doc.text('FECHA', cX.fec, y + 4); doc.text('CONCEPTO', cX.con, y + 4); doc.text('MÉTODO', cX.met, y + 4); doc.text('MON.', cX.mon, y + 4); doc.text('MONTO', RIGHT - 3, y + 4, { align: 'right' })
      y += 6
      const totCobros = { USD: 0, MXN: 0 }
      ingresos.forEach((m, i) => {
        checkPage(7)
        const cur = m.moneda as 'USD' | 'MXN'
        totCobros[cur] += m.monto
        if (i % 2 === 1) { setFill(ZEBRA); doc.rect(M, y, RIGHT - M, 6, 'F') }
        setTxt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
        doc.text(m.fecha || '—', cX.fec, y + 4)
        doc.text((m.concepto || '—').substring(0, 40), cX.con, y + 4)
        setTxt(GRAY); doc.setFontSize(7.5); doc.text(m.metodo, cX.met, y + 4); doc.text(cur, cX.mon, y + 4)
        setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(money(m.monto, cur), RIGHT - 3, y + 4, { align: 'right' })
        y += 6
      })
      // Totales por moneda
      checkPage(6 * (Object.values(totCobros).filter(v => v > 0).length) + 4)
      ;(['USD', 'MXN'] as const).filter(c => totCobros[c] > 0).forEach(c => {
        setFill([242, 245, 244]); doc.rect(M, y, RIGHT - M, 6, 'F')
        setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
        doc.text(`Total recibido ${c}`, M + 3, y + 4)
        doc.text(money(totCobros[c], c), RIGHT - 3, y + 4, { align: 'right' })
        y += 6
      })
      y += 6
    }

    // ── Cobros por cotización (mini estado de cuenta) ──
    sectionTitle('Cobros por cotización')
    const conCobros = quoteData.filter(d => d.pagos.length > 0)
    if (conCobros.length === 0) {
      setTxt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.text('Aún no hay cobros adjudicados a cotizaciones', M + 3, y); y += 8
    } else {
      conCobros.forEach(({ q, cur, total, cobrado, pagos }) => {
        const pend = Math.max(0, total - cobrado)
        const pct = total > 0 ? Math.min(cobrado / total, 1) : 0
        // Cada cotización es un mini estado de cuenta: encabezado + cobros + pie con avance
        checkPage(10 + pagos.length * 5.4 + 22)
        // Encabezado: nombre + badge de moneda
        setFill([243, 245, 244]); doc.rect(M, y, RIGHT - M, 8.5, 'F')
        setFill(GREEN); doc.rect(M, y, 1.6, 8.5, 'F')
        setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
        doc.text((q.name || '—').substring(0, 52), M + 4, y + 5.6)
        setFill(cur === 'USD' ? [6, 182, 212] : [167, 139, 250]); doc.roundedRect(RIGHT - 18, y + 2.4, 14, 4.6, 1, 1, 'F')
        setTxt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text(cur, RIGHT - 11, y + 5.6, { align: 'center' })
        y += 10
        // Mini encabezado de columnas
        setTxt([150, 150, 150]); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
        doc.text('FECHA', M + 6, y + 2); doc.text('CONCEPTO', M + 28, y + 2); doc.text('ORIGEN', RIGHT - 34, y + 2, { align: 'right' }); doc.text('MONTO', RIGHT - 3, y + 2, { align: 'right' })
        y += 4
        pagos.forEach((p, i) => {
          checkPage(5.4)
          if (i % 2 === 1) { setFill(ZEBRA); doc.rect(M + 3, y, RIGHT - M - 3, 5.2, 'F') }
          setTxt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
          doc.text(p.date || '—', M + 6, y + 3.6)
          setTxt([70, 70, 70]); doc.text((p.concepto || '').replace(/💵 /, '').substring(0, 46), M + 28, y + 3.6)
          setTxt([160, 160, 160]); doc.setFontSize(6.5); doc.text(p.source.toUpperCase(), RIGHT - 34, y + 3.6, { align: 'right' })
          setTxt(GREEN); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(money(p.monto, p.cur), RIGHT - 3, y + 3.6, { align: 'right' })
          y += 5.2
        })
        // ── Pie: avance de cobro + por cobrar ──
        y += 2
        const barX = M + 4, barW = RIGHT - M - 8
        setFill([228, 228, 228]); doc.rect(barX, y, barW, 4, 'F')
        setFill(pct >= 1 ? GREEN : [37, 99, 235]); doc.rect(barX, y, barW * pct, 4, 'F')
        y += 8
        setTxt([90, 90, 90]); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
        doc.text(`${Math.round(pct * 100)}% cobrado  ·  ${money(cobrado, cur)} de ${money(total, cur)}`, M + 4, y)
        setTxt([217, 119, 6]); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
        doc.text(`Por cobrar  ${money(pend, cur)}`, RIGHT - 3, y + 0.3, { align: 'right' })
        y += 11
      })
    }

    // ── Footer ──
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      setFill(GREEN); doc.rect(M, 270, RIGHT - M, 0.5, 'F')
      doc.setFontSize(7); setTxt(GRAY)
      doc.text(`OMM ERP · Estado de Cuenta · ${lead.name}`, M, 274)
      doc.text(`Página ${i} de ${pageCount}`, RIGHT, 274, { align: 'right' })
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

  // ESP editor now stores total WITH IVA+descuento already applied — use directly
  const getEspTotal = (q: any): number => Number(q.total) || 0

  // Monto final con descuento + IVA. Fuente canónica: total_final (lo escriben TODOS los editores).
  // Fallback por especialidad para cotizaciones aún no re-guardadas.
  const quoteFinalConIva = (q: any): number => {
    // total_final = monto final con descuento + IVA (lo escriben todos los editores). Fuente única.
    if (typeof q.total_final === 'number' && !isNaN(q.total_final)) return Number(q.total_final)
    if (q.specialty === 'esp' || q.specialty === 'cort' || q.specialty === 'ilum' || q.specialty === 'proy') return Number(q.total) || 0
    return (Number(q.total) || 0) * 1.16
  }

  const toMXN = (amount: number, currency: string) =>
    currency === 'USD' ? amount * tipoCambio : amount

  // Financial summary — track USD and MXN separately
  const financials = useMemo(() => {
    const byCur = { USD: { vendido: 0, cobrado: 0, comprado: 0, presupuesto: 0 }, MXN: { vendido: 0, cobrado: 0, comprado: 0, presupuesto: 0 } }

    // Vendido: contratos (con IVA 16%)
    quotations.filter(q => q.stage === 'contrato').forEach(q => {
      const cur = getQuotCurrency(q)
      const proj = projects.find(p => p.cotizacion_id === q.id)
      let amount: number
      if (proj && proj.contract_value) {
        // Project contract value — use directly (already final)
        amount = proj.contract_value
      } else {
        amount = quoteFinalConIva(q)
      }
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
  }, [quotations, projects, bankMovements, paymentAllocations, pos, quotItems, tipoCambio])

  // Helper: compute quotation total with IVA for display
  const getQuotTotalIva = (q: any): number => quoteFinalConIva(q)

  // Consolidated quotation summary — separated by currency
  const quotSummaryByCur = useMemo(() => {
    const result: Record<'USD' | 'MXN', {
      grandTotal: number; grandSubtotal: number; ivaRate: number;
      systems: [string, { subtotal: number; items: number }][];
      perQuot: { name: string; specialty: string; subtotalIva: number; items: number }[];
      quotations: any[];
    }> = {
      USD: { grandTotal: 0, grandSubtotal: 0, ivaRate: 16, systems: [], perQuot: [], quotations: [] },
      MXN: { grandTotal: 0, grandSubtotal: 0, ivaRate: 16, systems: [], perQuot: [], quotations: [] },
    }

    ;(['USD', 'MXN'] as const).forEach(cur => {
      const curQuots = quotations.filter(q => getQuotCurrency(q) === cur)
      if (curQuots.length === 0) return

      result[cur].quotations = curQuots
      const systemTotals: Record<string, { subtotal: number; items: number }> = {}
      let grandTotal = 0

      curQuots.forEach(q => {
        const totalAlreadyHasIva = q.specialty === 'cort' || q.specialty === 'ilum' || q.specialty === 'proy'

        if (q.specialty === 'esp') {
          // ESP: break down by system, applying descuento + IVA proportionally
          const espItems = quotItems.filter(i => i.quotation_id === q.id)
          let espMeta: any = {}
          try { espMeta = typeof q.notes === 'string' ? JSON.parse(q.notes) : (q.notes || {}) } catch {}
          const desc = espMeta.descuento || 0
          const prog = espMeta.programacion || 0
          const rawTotal = espItems.reduce((s, i) => s + (Number(i.total) || 0), 0)
          const multiplier = (1 - desc / 100) * 1.16

          const sysTotals: Record<string, { raw: number; count: number }> = {}
          espItems.forEach(item => {
            const sys = item.system || 'Sin sistema'
            if (!sysTotals[sys]) sysTotals[sys] = { raw: 0, count: 0 }
            sysTotals[sys].raw += Number(item.total) || 0
            sysTotals[sys].count += 1
          })

          Object.entries(sysTotals).forEach(([sys, data]) => {
            const proportion = rawTotal > 0 ? data.raw / rawTotal : 0
            const sysFinal = (data.raw + prog * proportion) * multiplier
            if (!systemTotals[sys]) systemTotals[sys] = { subtotal: 0, items: 0 }
            systemTotals[sys].subtotal += sysFinal
            systemTotals[sys].items += data.count
            grandTotal += sysFinal
          })
        } else if (totalAlreadyHasIva) {
          // Fuente canónica: total_final (monto final con descuento + IVA), igual que las tarjetas.
          // Antes usaba q.total (subtotal sin el cálculo final) → el total no cuadraba con las tarjetas.
          const qTotal = quoteFinalConIva(q)
          const sys = q.name || q.specialty
          if (!systemTotals[sys]) systemTotals[sys] = { subtotal: 0, items: 0 }
          systemTotals[sys].subtotal += qTotal
          systemTotals[sys].items += quotItems.filter(i => i.quotation_id === q.id).length
          grandTotal += qTotal
        } else {
          const qItems = quotItems.filter(i => i.quotation_id === q.id)
          qItems.forEach(item => {
            const sys = item.system || 'Sin sistema'
            if (!systemTotals[sys]) systemTotals[sys] = { subtotal: 0, items: 0 }
            const itemTotal = (Number(item.total) || 0) * 1.16
            systemTotals[sys].subtotal += itemTotal
            systemTotals[sys].items += (item.quantity || 1)
            grandTotal += itemTotal
          })
        }
      })

      // Per-quotation subtotals
      const perQuot = curQuots.map(q => ({
        name: q.name,
        specialty: q.specialty,
        subtotalIva: getQuotTotalIva(q),
        items: quotItems.filter(i => i.quotation_id === q.id).length,
      }))

      result[cur].grandTotal = grandTotal
      result[cur].grandSubtotal = grandTotal // Already includes IVA in all paths
      result[cur].systems = Object.entries(systemTotals).sort((a, b) => b[1].subtotal - a[1].subtotal)
      result[cur].perQuot = perQuot
    })

    return result
  }, [quotations, quotItems])

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
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px', maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <button onClick={() => navigate('/crm')} style={{ ...linkBtnS, padding: '6px 10px' }}>
          <ArrowLeft size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{lead.name}</div>
          <div style={{ fontSize: 13, color: '#666' }}>
            {lead.company && <span>{lead.company} · </span>}
            {lead.contact_name && <span>{lead.contact_name} · </span>}
            <Badge label={lead.status} color={lead.status === 'ganado' ? '#10B981' : lead.status === 'perdido' ? '#DC2626' : '#2563EB'} />
          </div>
        </div>
      </div>

      {/* T.C. referencia + equivalente MXN — solo DG/Admin */}
      {showFinancials && (<>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: isMobile ? 'wrap' : 'nowrap', fontSize: isMobile ? 11 : 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#111', border: '1px solid #333', borderRadius: 8, padding: '6px 12px' }}>
          <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>T.C. referencia</span>
          <input
            type="number" step="0.01" min="1"
            defaultValue={tipoCambio}
            onBlur={e => { const v = parseFloat(e.target.value); if (v > 0) saveTipoCambioRef(v) }}
            style={{ width: 65, background: '#0a0a0a', border: '1px solid #444', borderRadius: 4, padding: '4px 6px', fontSize: 13, fontWeight: 700, color: '#fff', textAlign: 'center', fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
          <span style={{ color: '#10B981', fontWeight: 600 }}>Vendido {F(financials.totalVendido)}</span>
          <span style={{ color: '#34D399', fontWeight: 600 }}>Cobrado {F(financials.totalCobrado)}</span>
          <span style={{ color: '#D97706', fontWeight: 600 }}>Por cobrar {F(financials.porCobrar)}</span>
          <span style={{ color: '#2563EB', fontWeight: 600 }}>{financials.totalVendido > 0 ? PCT(financials.totalCobrado / financials.totalVendido) : '—'}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6, 1fr)', gap: 10, marginBottom: 24 }}>
        <KpiDual label="Total Vendido" usd={financials.byCur.USD.vendido} mxn={financials.byCur.MXN.vendido} color="#10B981" />
        <KpiDual label="Cobrado" usd={financials.byCur.USD.cobrado} mxn={financials.byCur.MXN.cobrado} color="#34D399" />
        <KpiDual label="Por Cobrar" usd={Math.max(0, financials.byCur.USD.vendido - financials.byCur.USD.cobrado)} mxn={Math.max(0, financials.byCur.MXN.vendido - financials.byCur.MXN.cobrado)} color="#D97706" />
        <KpiDual label="Comprado" usd={financials.byCur.USD.comprado} mxn={financials.byCur.MXN.comprado} color="#2563EB" />
        <KpiDual label="Por Comprar" usd={Math.max(0, financials.byCur.USD.presupuesto - financials.byCur.USD.comprado)} mxn={Math.max(0, financials.byCur.MXN.presupuesto - financials.byCur.MXN.comprado)} color="#D97706" />
        <KpiMini label="Bloqueos" value={String(allBloqueos.length)} color={allBloqueos.length > 0 ? '#DC2626' : '#10B981'} />
      </div>
      </>)}

      {/* ══════════ 1. COTIZACIONES ══════════ */}
      <Section title="Cotizaciones" icon={<FileText size={14} />} count={quotations.length} expanded={expanded.cotizaciones} onToggle={() => toggle('cotizaciones')}>
        {quotations.length === 0 ? (
          <Empty text="Sin cotizaciones vinculadas" />
        ) : (<>
          {/* Render separate table + summary per currency */}
          {(['USD', 'MXN'] as const).map(cur => {
            const curQuots = quotations.filter(q => getQuotCurrency(q) === cur)
            if (curQuots.length === 0) return null
            const sym = cur === 'USD' ? 'US$' : '$'
            const summary = quotSummaryByCur[cur]
            const accentColor = cur === 'USD' ? '#2563EB' : '#10B981'

            return (
              <div key={cur} style={{ marginBottom: 20 }}>
                {/* Currency header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: accentColor, padding: '2px 10px', borderRadius: 4, background: accentColor + '18', border: '1px solid ' + accentColor + '33' }}>{cur}</span>
                  <span style={{ fontSize: 11, color: '#555' }}>{curQuots.length} cotizacion{curQuots.length > 1 ? 'es' : ''}</span>
                </div>

                {/* Quotation table */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={tblS}>
                  <thead>
                    <tr style={trHeadS}>
                      <th style={thS}>Nombre</th>
                      <th style={thS}>Especialidad</th>
                      <th style={thS}>Etapa</th>
                      <th style={{ ...thS, textAlign: 'right' }}>Total c/IVA</th>
                      <th style={thS}>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {curQuots.map(q => (
                      <tr key={q.id} style={trS}>
                        <td style={tdS}><span style={{ color: '#fff', fontWeight: 500 }}>{q.name}</span></td>
                        <td style={tdS}><Badge label={q.specialty?.toUpperCase() || '—'} color="#555" /></td>
                        <td style={tdS}><Badge label={STAGE_LABELS[q.stage] || q.stage} color={STAGE_COLORS[q.stage] || '#555'} /></td>
                        <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: q.stage === 'contrato' ? '#10B981' : '#888' }}>
                          {sym}{getQuotTotalIva(q).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </td>
                        <td style={{ ...tdS, color: '#555' }}>{q.created_at?.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>

                {/* Consolidated summary for this currency */}
                {summary.perQuot.length > 0 && summary.grandTotal > 0 && (
                  <div style={{ marginTop: 10, background: cur === 'USD' ? '#0a0a1a' : '#0a1a0a', border: '1px solid ' + accentColor + '22', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ padding: '14px 18px', background: accentColor + '08', borderBottom: '1px solid ' + accentColor + '15', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 2 }}>Inversión {cur}</div>
                        <div style={{ fontSize: 26, fontWeight: 700, color: accentColor }}>
                          {sym}{summary.grandTotal.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                          <span style={{ fontSize: 11, color: accentColor + '88', marginLeft: 6, fontWeight: 400 }}>c/IVA 16%</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{summary.perQuot.length} cotizacion{summary.perQuot.length > 1 ? 'es' : ''}</div>
                      </div>
                      {cur === 'USD' && <button onClick={exportConsolidado} style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', fontSize: 11, fontWeight: 600, color: accentColor, background: accentColor + '12', border: '1px solid ' + accentColor + '33', borderRadius: 6, cursor: 'pointer' }}>
                        <Download size={12} /> Exportar PDF
                      </button>}
                    </div>

                    <div style={{ padding: 16 }}>
                      {/* Per-quotation breakdown */}
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${Math.min(summary.perQuot.length, 3)}, 1fr)`, gap: 10, marginBottom: 16 }}>
                        {summary.perQuot.map((pq: any, i: number) => (
                          <div key={i} style={{ padding: 12, background: '#141414', border: '1px solid #222', borderRadius: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', flex: 1 }}>{pq.name}</div>
                              <Badge label={pq.specialty?.toUpperCase()} color="#555" />
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#ccc' }}>
                              {sym}{pq.subtotalIva.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                              <span style={{ fontSize: 9, color: '#555', marginLeft: 4, fontWeight: 400 }}>c/IVA</span>
                            </div>
                            <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>{pq.items} items</div>
                          </div>
                        ))}
                      </div>

                      {/* System breakdown */}
                      {summary.systems.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Desglose por Sistema</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {summary.systems.map(([sys, data]: [string, any]) => {
                              const pct = summary.grandTotal > 0 ? (data.subtotal / summary.grandTotal) * 100 : 0
                              return (
                                <div key={sys} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: '#0e0e0e', borderRadius: 6 }}>
                                  <div style={{ flex: 1, fontSize: 12, color: '#ccc', fontWeight: 500 }}>{sys}</div>
                                  <div style={{ width: isMobile ? 80 : 140, height: 6, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
                                    <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: accentColor, borderRadius: 3, transition: 'width 0.3s' }} />
                                  </div>
                                  <div style={{ fontSize: 11, color: '#888', minWidth: 50, textAlign: 'right' }}>{pct.toFixed(0)}%</div>
                                  <div style={{ fontSize: 12, color: '#fff', fontWeight: 600, minWidth: 90, textAlign: 'right' }}>
                                    {sym}{data.subtotal.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </>)}
        </Section>

      {/* ══════════ 2. ESTADO DE CUENTA (solo DG/Admin) ══════════ */}
      {showFinancials && <Section title="Estado de Cuenta" icon={<DollarSign size={14} />} count={bankMovements.filter(m => m.tipo === 'abono').length} expanded={expanded.estado} onToggle={() => toggle('estado')}>
        {/* Summary bar — dual currency */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          <MiniStatDual label="Total vendido" usd={financials.byCur.USD.vendido} mxn={financials.byCur.MXN.vendido} accent="#10B981" />
          <MiniStatDual label="Cobrado" usd={financials.byCur.USD.cobrado} mxn={financials.byCur.MXN.cobrado} accent="#34D399" />
          <MiniStatDual label="Por cobrar" usd={Math.max(0, financials.byCur.USD.vendido - financials.byCur.USD.cobrado)} mxn={Math.max(0, financials.byCur.MXN.vendido - financials.byCur.MXN.cobrado)} accent="#D97706" />
          <MiniStat label="% Cobro" value={financials.totalVendido > 0 ? PCT(financials.totalCobrado / financials.totalVendido) : '—'} accent="#2563EB" />
        </div>
        {/* Progress bar */}
        {financials.totalVendido > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: '#1a1a1a' }}>
              <div style={{ width: `${Math.min((financials.totalCobrado / financials.totalVendido) * 100, 100)}%`, background: '#10B981', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {/* ── SALDO POR COTIZACIÓN ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Saldo por Cotización</span>
          <button onClick={exportEstadoCuenta} style={{ ...linkBtnS, padding: '4px 10px', fontSize: 11, gap: 4, color: '#2563EB', borderColor: '#2563EB44' }}>
            <Download size={12} /> Exportar PDF
          </button>
        </div>
        {(() => {
          const contratos = quotations.filter(q => q.stage === 'contrato')
          if (contratos.length === 0) return <Empty text="Sin cotizaciones en etapa contrato" />

          // Build per-quotation balances: pagado = prorrateo + cobros asignados por quotation_id
          const quotBalances = contratos.map(q => {
            const cur = getQuotCurrency(q)
            const total = getQuotTotalIva(q)
            const pagos = getPagosDeCotizacion(q.id, cur)
            const pagado = pagos.reduce((s, p) => s + p.monto, 0)
            const pendiente = Math.max(0, total - pagado)
            const pctPagado = total > 0 ? pagado / total : 0
            return { q, cur, total, pagado, pendiente, pctPagado, pagos }
          })
          // Resumen general por moneda (para el bloque de arriba)
          const resumen = { USD: { totalVendido: 0, cobros: 0 }, MXN: { totalVendido: 0, cobros: 0 } }
          quotBalances.forEach(({ cur, total, pagado }) => { resumen[cur].totalVendido += total; resumen[cur].cobros += pagado })

          return (
            <div style={{ overflowX: 'auto' }}>
              {/* ── Resumen general arriba ── */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <div style={{ background: '#111', border: '1px solid #1f1f1f', borderRadius: 8, padding: '10px 14px', minWidth: 150 }}>
                  <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cotizaciones cerradas</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 2 }}>{contratos.length}</div>
                </div>
                {(['USD', 'MXN'] as const).filter(c => resumen[c].totalVendido > 0 || resumen[c].cobros > 0).map(c => (
                  <div key={c} style={{ background: '#111', border: '1px solid #1f1f1f', borderRadius: 8, padding: '10px 14px', minWidth: 190 }}>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Badge label={c} color={c === 'USD' ? '#06B6D4' : '#A78BFA'} /> General
                    </div>
                    <div style={{ fontSize: 12, color: '#aaa' }}>Total vendido: <b style={{ color: '#fff' }}>{FCUR(resumen[c].totalVendido, c)}</b></div>
                    <div style={{ fontSize: 12, color: '#aaa' }}>Total cobros: <b style={{ color: '#10B981' }}>{FCUR(resumen[c].cobros, c)}</b></div>
                    <div style={{ fontSize: 12, color: '#aaa' }}>Pendiente: <b style={{ color: '#D97706' }}>{FCUR(Math.max(0, resumen[c].totalVendido - resumen[c].cobros), c)}</b></div>
                  </div>
                ))}
              </div>
              <table style={tblS}>
                <thead>
                  <tr style={trHeadS}>
                    <th style={thS}>Cotización</th>
                    <th style={thS}>Especialidad</th>
                    <th style={thS}>Moneda</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Total</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Pagado</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Pendiente</th>
                    <th style={{ ...thS, textAlign: 'center', width: 80 }}>Avance</th>
                  </tr>
                </thead>
                <tbody>
                  {quotBalances.map(({ q, cur, total, pagado, pendiente, pctPagado }) => (
                    <tr key={q.id} style={trS}>
                      <td style={tdS}><span style={{ color: '#fff', fontWeight: 500 }}>{q.name || 'Sin nombre'}</span></td>
                      <td style={tdS}><Badge label={SPECIALTY_CONFIG[q.specialty as keyof typeof SPECIALTY_CONFIG]?.label || q.specialty} color={SPECIALTY_CONFIG[q.specialty as keyof typeof SPECIALTY_CONFIG]?.color || '#555'} /></td>
                      <td style={tdS}><Badge label={cur} color={cur === 'USD' ? '#06B6D4' : '#A78BFA'} /></td>
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: '#fff' }}>{FCUR(total, cur)}</td>
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: '#10B981' }}>{FCUR(pagado, cur)}</td>
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: pendiente > 0 ? '#D97706' : '#10B981' }}>{FCUR(pendiente, cur)}</td>
                      <td style={{ ...tdS, textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#1a1a1a', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(pctPagado * 100, 100)}%`, height: '100%', background: pctPagado >= 1 ? '#10B981' : '#2563EB', transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize: 10, color: '#888', minWidth: 28 }}>{Math.round(pctPagado * 100)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Totals row */}
              {quotBalances.length > 1 && (() => {
                const byC = { USD: { total: 0, pagado: 0 }, MXN: { total: 0, pagado: 0 } }
                quotBalances.forEach(({ cur, total, pagado }) => { byC[cur].total += total; byC[cur].pagado += pagado })
                return (
                  <div style={{ display: 'flex', gap: 16, marginTop: 8, padding: '8px 12px', background: '#111', borderRadius: 6, fontSize: 11, flexWrap: 'wrap' }}>
                    {(['USD', 'MXN'] as const).filter(c => byC[c].total > 0).map(c => (
                      <span key={c} style={{ color: '#aaa' }}>
                        <Badge label={c} color={c === 'USD' ? '#06B6D4' : '#A78BFA'} />
                        {' '}Total: <b style={{ color: '#fff' }}>{FCUR(byC[c].total, c)}</b>
                        {' '}| Pagado: <b style={{ color: '#10B981' }}>{FCUR(byC[c].pagado, c)}</b>
                        {' '}| Pendiente: <b style={{ color: '#D97706' }}>{FCUR(Math.max(0, byC[c].total - byC[c].pagado), c)}</b>
                      </span>
                    ))}
                  </div>
                )
              })()}

              {/* ── Desglose de cobros por cotización (mini estado de cuenta) ── */}
              {quotBalances.some(qb => qb.pagos.length > 0) && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Cobros por cotización</div>
                  {quotBalances.filter(qb => qb.pagos.length > 0).map(({ q, cur, total, pagado, pendiente, pagos }) => (
                    <div key={q.id} style={{ background: '#0e0e0e', border: '1px solid #1c1c1c', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{q.name}</span>
                        <span style={{ fontSize: 11, color: '#888' }}>
                          Total <b style={{ color: '#fff' }}>{FCUR(total, cur)}</b> · Cobrado <b style={{ color: '#10B981' }}>{FCUR(pagado, cur)}</b> · Pendiente <b style={{ color: pendiente > 0 ? '#D97706' : '#10B981' }}>{FCUR(pendiente, cur)}</b>
                        </span>
                      </div>
                      {pagos.map((p, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: '#aaa', padding: '3px 0', borderTop: i === 0 ? '1px solid #1c1c1c' : 'none' }}>
                          <span style={{ color: '#777', fontFamily: 'monospace', minWidth: 82 }}>{p.date || '—'}</span>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.concepto}</span>
                          <span style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', alignSelf: 'center' }}>{p.source}</span>
                          <span style={{ color: '#10B981', fontWeight: 600, minWidth: 90, textAlign: 'right' }}>{FCUR(p.monto, p.cur)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        {/* ── TIMELINE CRONOLÓGICO ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timeline</span>
        </div>
        {(() => {
          // Build timeline entries: contratos (cargos) + pagos (abonos)
          type TEntry = { date: string; tipo: 'cargo' | 'abono'; desc: string; monto: number; cur: string; ref?: string }
          const entries: TEntry[] = []

          // Contratos as "cargos" (lo que se debe)
          quotations.filter(q => q.stage === 'contrato').forEach(q => {
            const cur = getQuotCurrency(q)
            const total = getQuotTotalIva(q)
            const contractDate = (() => { try { const n = typeof q.notes === 'string' ? JSON.parse(q.notes) : q.notes; return n?.fecha_contrato || q.created_at?.substring(0, 10) || '' } catch { return q.created_at?.substring(0, 10) || '' } })()
            entries.push({ date: contractDate, tipo: 'cargo', desc: `Contrato: ${q.name || 'Sin nombre'}`, monto: total, cur })
          })

          // Abonos from bank_movements
          bankMovements.filter(m => m.tipo === 'abono').forEach(m => {
            entries.push({ date: m.fecha || '', tipo: 'abono', desc: m.concepto || 'Pago', monto: m.monto || 0, cur: m.moneda || 'MXN', ref: m.referencia })
          })
          // Abonos from cash_movements (cobros de efectivo ligados a este lead)
          cashMovements.filter(m => m.tipo === 'cobro_cliente').forEach(m => {
            entries.push({ date: m.fecha || '', tipo: 'abono', desc: `💵 Efectivo: ${m.concepto || m.persona || 'Cobro'}`, monto: Number(m.monto) || 0, cur: 'MXN', ref: 'CASH' })
          })

          entries.sort((a, b) => a.date.localeCompare(b.date))

          if (entries.length === 0) return <Empty text="Sin movimientos" />

          // Running balances per currency
          const saldos: Record<string, number> = {}
          const withSaldo = entries.map(e => {
            if (!saldos[e.cur]) saldos[e.cur] = 0
            if (e.tipo === 'cargo') saldos[e.cur] += e.monto
            else saldos[e.cur] -= e.monto
            return { ...e, saldo: saldos[e.cur] }
          })

          return (
            <div style={{ overflowX: 'auto' }}>
              <table style={tblS}>
                <thead>
                  <tr style={trHeadS}>
                    <th style={thS}>Fecha</th>
                    <th style={thS}>Concepto</th>
                    <th style={thS}>Moneda</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Cargo</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Abono</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {withSaldo.map((e, i) => (
                    <tr key={i} style={trS}>
                      <td style={{ ...tdS, color: '#888', fontSize: 11 }}>{e.date || '—'}</td>
                      <td style={tdS}>
                        <span style={{ color: '#fff', fontWeight: 500 }}>{e.desc.substring(0, 50)}</span>
                        {e.ref && <span style={{ color: '#555', fontSize: 10, marginLeft: 6 }}>{e.ref}</span>}
                      </td>
                      <td style={tdS}><Badge label={e.cur} color={e.cur === 'USD' ? '#06B6D4' : '#A78BFA'} /></td>
                      <td style={{ ...tdS, textAlign: 'right', color: e.tipo === 'cargo' ? '#fff' : '#333' }}>
                        {e.tipo === 'cargo' ? FCUR(e.monto, e.cur) : ''}
                      </td>
                      <td style={{ ...tdS, textAlign: 'right', color: e.tipo === 'abono' ? '#10B981' : '#333' }}>
                        {e.tipo === 'abono' ? FCUR(e.monto, e.cur) : ''}
                      </td>
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: e.saldo > 0 ? '#D97706' : '#10B981' }}>
                        {FCUR(e.saldo, e.cur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}

        {/* ── Egresos registrados (cargos bancarios + pagos efectivo del lead) ── */}
        {(() => {
          // Unifica cargos bancarios + pagos a proveedor en efectivo + nominas
          const bankEgresos = bankMovements.filter(m => m.tipo === 'cargo').map(m => ({
            id: 'bank-' + m.id, fecha: m.fecha, concepto: m.concepto, beneficiario: m.beneficiario || m.proveedor,
            moneda: m.moneda || 'MXN', monto: m.monto || 0, source: 'banco' as const,
          }))
          const cashEgresos = cashMovements.filter(m => m.tipo === 'pago_proveedor' || m.tipo === 'nomina_efectivo').map(m => ({
            id: 'cash-' + m.id, fecha: m.fecha, concepto: m.concepto || (m.tipo === 'nomina_efectivo' ? 'Nómina en efectivo' : 'Pago a proveedor'),
            beneficiario: m.persona, moneda: 'MXN', monto: Number(m.monto) || 0,
            source: (m.tipo === 'nomina_efectivo' ? 'nomina' : 'efectivo') as 'efectivo' | 'nomina',
          }))
          const egresos = [...bankEgresos, ...cashEgresos].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
          if (egresos.length === 0) return null
          const totalEgr = egresos.reduce((s, m) => s + (m.monto || 0), 0)
          return (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Egresos Registrados</span>
                <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>{F(totalEgr)}</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={tblS}>
                <thead>
                  <tr style={trHeadS}>
                    <th style={thS}>Fecha</th>
                    <th style={thS}>Concepto</th>
                    <th style={thS}>Beneficiario</th>
                    <th style={thS}>Moneda</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {egresos.map(m => (
                    <tr key={m.id} style={trS}>
                      <td style={{ ...tdS, color: '#888' }}>{m.fecha || '—'}</td>
                      <td style={tdS}>
                        <span style={{ color: '#fff', fontWeight: 500 }}>{(m.concepto || '—').substring(0, 45)}</span>
                        {m.source === 'efectivo' && <span style={{ marginLeft: 6, fontSize: 9, color: '#10B981', background: '#10B98122', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>💵 EFECTIVO</span>}
                        {m.source === 'nomina' && <span style={{ marginLeft: 6, fontSize: 9, color: '#A78BFA', background: '#A78BFA22', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>NÓMINA</span>}
                      </td>
                      <td style={{ ...tdS, color: '#666', fontSize: 11 }}>{m.beneficiario || '—'}</td>
                      <td style={tdS}><Badge label={m.moneda || 'MXN'} color={m.moneda === 'USD' ? '#06B6D4' : '#A78BFA'} /></td>
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: '#DC2626' }}>-{FCUR(m.monto || 0, m.moneda || 'MXN')}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </>
          )
        })()}

        {/* ── Flujo neto (banco + efectivo) ── */}
        {(bankMovements.length + cashMovements.length) > 0 && (() => {
          const ingresosBanco = bankMovements.filter(m => m.tipo === 'abono').reduce((s, m) => s + (m.monto || 0), 0)
          const egresosBanco = bankMovements.filter(m => m.tipo === 'cargo').reduce((s, m) => s + (m.monto || 0), 0)
          const ingresosEfectivo = cashMovements.filter(m => m.tipo === 'cobro_cliente').reduce((s, m) => s + (Number(m.monto) || 0), 0)
          const egresosEfectivo = cashMovements.filter(m => m.tipo === 'pago_proveedor' || m.tipo === 'nomina_efectivo').reduce((s, m) => s + (Number(m.monto) || 0), 0)
          const ingresos = ingresosBanco + ingresosEfectivo
          const egresos = egresosBanco + egresosEfectivo
          const neto = ingresos - egresos
          return (
            <div style={{ display: 'flex', gap: 16, marginTop: 16, padding: '10px 14px', background: '#111', borderRadius: 8, border: '1px solid #222', fontSize: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: '#888' }}>Flujo neto:</span>
              <span style={{ color: '#10B981', fontWeight: 600 }}>
                Ingresos {F(ingresos)}
                {ingresosEfectivo > 0 && <span style={{ marginLeft: 4, fontSize: 10, color: '#10B981' }}>(💵 {F(ingresosEfectivo)} efectivo)</span>}
              </span>
              <span style={{ color: '#666' }}>—</span>
              <span style={{ color: '#DC2626', fontWeight: 600 }}>
                Egresos {F(egresos)}
                {egresosEfectivo > 0 && <span style={{ marginLeft: 4, fontSize: 10, color: '#10B981' }}>(💵 {F(egresosEfectivo)} efectivo)</span>}
              </span>
              <span style={{ color: '#666' }}>=</span>
              <span style={{ color: neto >= 0 ? '#10B981' : '#DC2626', fontWeight: 700 }}>{F(neto)}</span>
            </div>
          )
        })()}

        {/* ── Hitos de cobro (planning) ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hitos de Cobro</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Botón principal: Plan de pagos con templates */}
            <button
              onClick={() => {
                const contratos = quotations.filter(q => q.stage === 'contrato')
                if (contratos.length === 0) {
                  alert('Necesitas al menos una cotización en stage "contrato" para definir el plan de pagos.')
                  return
                }
                if (contratos.length === 1) {
                  setSelectedQuotForPlan(contratos[0].id)
                } else {
                  setShowQuotPicker(true)
                }
              }}
              style={{ ...linkBtnS, padding: '4px 10px', fontSize: 11, gap: 4, color: '#A78BFA', borderColor: '#7C3AED44', background: 'rgba(168,85,247,0.08)' }}>
              💰 Plan de pagos
            </button>
            {/* Fallback: capturar un hito a la vez (manual) */}
            <button onClick={() => setShowNewMilestone(true)} style={{ ...linkBtnS, padding: '4px 10px', fontSize: 11, gap: 4, color: '#666', borderColor: '#333' }}>
              <Plus size={12} /> Hito suelto
            </button>
          </div>
        </div>
        {milestones.length === 0 ? (
          <Empty text="Sin hitos de cobro registrados" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
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
                    <td style={{ ...tdS, color: m.status === 'vencido' ? '#DC2626' : '#888' }}>{m.due_date || '—'}</td>
                    <td style={tdS}><Badge label={m.status} color={MILESTONE_COLOR[m.status] || '#555'} /></td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: m.status === 'cobrado' ? '#10B981' : '#fff' }}>{FCUR(m.amount || 0, mCur)}</td>
                  </tr>
                )
              })}
            </tbody>
            </table>
          </div>
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
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#DC262610', border: '1px solid #DC262640', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={14} color="#DC2626" />
            <span style={{ fontSize: 12, color: '#DC2626' }}>Lo cobrado es menor a lo comprado. Diferencia: {F(financials.totalComprado - financials.totalCobrado)}</span>
          </div>
        )}
      </Section>}

      {/* ══════════ 3. COMPRAS FALTANTES ══════════ */}
      <Section title="Compras" icon={<ShoppingCart size={14} />} count={pos.length} expanded={expanded.compras} onToggle={() => toggle('compras')}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          <MiniStatDual label="Presupuesto compras" usd={financials.byCur.USD.presupuesto} mxn={financials.byCur.MXN.presupuesto} accent="#2563EB" />
          <MiniStatDual label="Comprado" usd={financials.byCur.USD.comprado} mxn={financials.byCur.MXN.comprado} accent="#D97706" />
          <MiniStatDual label="Por comprar" usd={Math.max(0, financials.byCur.USD.presupuesto - financials.byCur.USD.comprado)} mxn={Math.max(0, financials.byCur.MXN.presupuesto - financials.byCur.MXN.comprado)} accent={financials.porComprar > 0 ? '#DC2626' : '#10B981'} />
          <MiniStat label="% Avance" value={financials.totalCompras > 0 ? PCT(financials.totalComprado / financials.totalCompras) : '—'} accent="#2563EB" />
        </div>
        {pos.length === 0 ? (
          <Empty text="Sin órdenes de compra" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
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
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: po.currency === 'USD' ? '#2563EB20' : '#10B98120', color: po.currency === 'USD' ? '#2563EB' : '#10B981' }}>{po.currency || 'MXN'}</span>
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: '#fff' }}>{sym}{(po.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 0 })}</td>
                    <td style={{ ...tdS, color: '#888' }}>{po.expected_delivery || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
            </table>
          </div>
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
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#10B981' }}>{PCT(pctAvance)}</div>
                      <div style={{ fontSize: 10, color: '#555' }}>{completedTasks}/{totalTasks} tareas</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 6, borderRadius: 3, background: '#1a1a1a', marginBottom: 10 }}>
                    <div style={{ width: `${pctAvance * 100}%`, height: '100%', borderRadius: 3, background: '#10B981', transition: 'width 0.3s' }} />
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
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#2563EB' }}>{Math.round(avgPct)}%</div>
                      <div style={{ fontSize: 10, color: '#555' }}>{acts.length} actividades</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 6, borderRadius: 3, background: '#1a1a1a', marginBottom: 10 }}>
                    <div style={{ width: `${avgPct}%`, height: '100%', borderRadius: 3, background: '#2563EB', transition: 'width 0.3s' }} />
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
                              <div style={{ width: `${a.porcentaje || 0}%`, height: '100%', borderRadius: 2, background: (a.porcentaje || 0) >= 100 ? '#10B981' : '#2563EB' }} />
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
          <div style={{ padding: 20, textAlign: 'center', color: '#10B981', fontSize: 13 }}>
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
                <AlertTriangle size={14} color={BLOQUEO_SEV_COLOR[b.severidad] || '#D97706'} style={{ marginTop: 2, flexShrink: 0 }} />
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

      {/* Selector de cotización cuando el lead tiene varias contrato */}
      {showQuotPicker && (() => {
        const contratos = quotations.filter(q => q.stage === 'contrato')
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12, padding: 20, width: '100%', maxWidth: 500 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>¿Para qué cotización?</div>
                <button onClick={() => setShowQuotPicker(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
              </div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
                Este lead tiene varias cotizaciones cerradas. Elige una para definir su plan de pagos.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {contratos.map(q => {
                  const cur = getQuotCurrency(q)
                  const total = quoteFinalConIva(q)
                  return (
                    <button key={q.id}
                      onClick={() => { setSelectedQuotForPlan(q.id); setShowQuotPicker(false) }}
                      style={{
                        background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 8,
                        padding: '10px 14px', cursor: 'pointer', fontFamily: 'inherit',
                        textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = '#7C3AED')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2a2a')}
                    >
                      <div>
                        <div style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>{q.name}</div>
                        <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{q.specialty} · {cur}</div>
                      </div>
                      <div style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>{FCUR(total, cur)}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal Plan de pagos */}
      {selectedQuotForPlan && (() => {
        const q = quotations.find(qq => qq.id === selectedQuotForPlan)
        if (!q) return null
        const cur = getQuotCurrency(q)
        const total = quoteFinalConIva(q)
        // Buscar el proyecto vinculado a esta cotización (si hay)
        const linkedProj = projects.find(p => p.cotizacion_id === q.id)
        return (
          <PaymentPlanModal
            quotationId={q.id}
            quotationName={q.name}
            totalFinal={total}
            currency={cur}
            projectId={linkedProj?.id || null}
            onClose={() => setSelectedQuotForPlan(null)}
            onSaved={() => {
              setSelectedQuotForPlan(null)
              // Recargar milestones después de guardar
              if (id) load()
            }}
          />
        )
      })()}
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
    <div style={{ marginTop: 12, padding: 16, background: '#111', border: '1px solid #10B98133', borderRadius: 10 }}>
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
          style={{ ...linkBtnS, padding: '5px 12px', fontSize: 11, color: '#10B981', borderColor: '#10B98144', opacity: (!form.name || !form.amount || !form.project_id) ? 0.4 : 1 }}>
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
          <div style={{ fontSize: 18, fontWeight: 700, color: isUSD ? '#06B6D4' : '#10B981', marginTop: 4 }}>
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
                    background: pagoEn === c ? (c === 'USD' ? '#06B6D420' : '#10B98120') : '#1a1a1a',
                    border: `1px solid ${pagoEn === c ? (c === 'USD' ? '#06B6D4' : '#10B981') : '#333'}`,
                    color: pagoEn === c ? (c === 'USD' ? '#06B6D4' : '#10B981') : '#666',
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
            color: '#10B981', borderColor: '#10B98144', background: '#10B98110',
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
