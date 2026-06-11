import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Project, PaymentMilestone, WorkReport } from '../types'
import { F, STATUS_CONFIG, STAGE_CONFIG, formatDate } from '../lib/utils'
import { KpiCard, Table, Th, Td, ProgressBar, Badge, Loading, SectionHeader } from '../components/layout/UI'
import { useIsMobile } from '../lib/useIsMobile'
import { useAuth } from '../contexts/AuthContext'
import { FolderOpen, DollarSign, AlertTriangle, Users, FileText, TrendingUp, ChevronRight, ChevronDown } from 'lucide-react'
import DashboardProduccion from './DashboardProduccion'
import DashboardVentasIng from './DashboardVentasIng'
import DashboardAdmin from './DashboardAdmin'

export default function Dashboard() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const area = authUser?.permission_area

  // Ventas/Ingeniería usa su dashboard especializado
  if (area === 'Ventas_Ingenieria') {
    return <DashboardVentasIng />
  }
  // Operaciones sigue con el dashboard de producción
  if (area === 'Operaciones') {
    return <DashboardProduccion />
  }
  // Administración usa su dashboard propio
  if (area === 'Administracion') {
    return <DashboardAdmin />
  }
  // After early returns above, area is DG
  const isFinancial = area === 'DG'

  const [projects, setProjects] = useState<Project[]>([])
  const [milestones, setMilestones] = useState<PaymentMilestone[]>([])
  const [reports, setReports] = useState<WorkReport[]>([])
  const [empCount, setEmpCount] = useState(0)
  const [loading, setLoading] = useState(true)
  // Sales-specific data
  const [cotStats, setCotStats] = useState<{ stage: string; count: number }[]>([])
  const [recentLeads, setRecentLeads] = useState<any[]>([])

  useEffect(() => {
    async function load() {
      const promises: Promise<any>[] = [
        supabase.from('projects').select('*').eq('status', 'activo').order('created_at', { ascending: false }),
        supabase.from('work_reports').select('*, project:projects(name), employee:employees(name)').order('report_date', { ascending: false }).limit(8),
        supabase.from('employees').select('*', { count: 'exact', head: true }).eq('is_active', true),
      ]
      // Only load financial data for DG/Admin
      if (isFinancial) {
        promises.push(supabase.from('payment_milestones').select('*, project:projects(name)').in('status', ['pendiente', 'vencido']).order('due_date'))
      }
      // Load sales data for DG
      if (area === 'DG') {
        promises.push(supabase.from('quotations').select('id, stage, specialty').order('created_at', { ascending: false }))
        promises.push(supabase.from('leads').select('id, name, company, status, created_at').order('created_at', { ascending: false }).limit(10))
      }

      const results = await Promise.all(promises)
      setProjects(results[0].data || [])
      setReports(results[1].data || [])
      setEmpCount(results[2].count || 0)

      let idx = 3
      if (isFinancial) {
        setMilestones(results[idx]?.data || [])
        idx++
      }
      if (area === 'DG') {
        const cots = results[idx]?.data || []
        const stages = ['oportunidad', 'estimacion', 'propuesta', 'contrato']
        setCotStats(stages.map(s => ({ stage: s, count: cots.filter((c: any) => c.stage === s).length })))
        idx++
        setRecentLeads(results[idx]?.data || [])
      }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <Loading />
  const pipeline = projects.reduce((s, p) => s + p.contract_value, 0)
  const vencidos = milestones.filter(m => m.status === 'vencido')

  const subtitle = isFinancial ? 'Vista ejecutiva — OMM Technologies' : 'OMM Technologies'

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px', maxWidth: 1200 }}>
      <SectionHeader title="Dashboard" subtitle={subtitle} />

      {/* ── KPI CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : isFinancial ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Proyectos activos" value={projects.length} icon={<FolderOpen size={16} />} />
        {isFinancial && <KpiCard label="Pipeline total" value={F(pipeline)} color="#3B82F6" icon={<DollarSign size={16} />} />}
        {isFinancial && <KpiCard label="Cobros vencidos" value={vencidos.length} color={vencidos.length > 0 ? '#EF4444' : '#57FF9A'} icon={<AlertTriangle size={16} />} />}
        {area === 'DG' && <KpiCard label="Leads recientes" value={recentLeads.length} color="#3B82F6" icon={<TrendingUp size={16} />} />}
        <KpiCard label="Empleados activos" value={empCount} color="#C084FC" icon={<Users size={16} />} />
      </div>

      {/* ── SALES: Cotizaciones pipeline ── */}
      {(area === 'DG') && (
        <div style={{ marginBottom: 24 }}>
          <SectionHeader title="Pipeline de cotizaciones" />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 10 }}>
            {cotStats.map(s => {
              const cfg = (STAGE_CONFIG as any)[s.stage] || { label: s.stage, color: '#666' }
              return (
                <div key={s.stage} onClick={() => navigate('/cotizaciones')} style={{ background: '#141414', border: '1px solid #222', borderRadius: 10, padding: '14px 16px', borderTop: `2px solid ${cfg.color}`, cursor: 'pointer', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = cfg.color)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#222')}>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{cfg.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{s.count}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* ── Proyectos activos ── */}
        <div>
          <SectionHeader title="Proyectos activos" />
          <div style={{ overflowX: 'auto' }}>
            <Table>
            <thead><tr><Th>Nombre</Th><Th>Cliente</Th><Th>Avance</Th><Th>Estado</Th>{isFinancial && <Th right>Contrato</Th>}</tr></thead>
            <tbody>
              {projects.length===0&&<tr><Td colSpan={isFinancial ? 5 : 4} muted>Sin proyectos activos</Td></tr>}
              {projects.map(p => {
                const cfg=STATUS_CONFIG[p.status]
                return(<tr key={p.id}><Td><span style={{fontWeight:500,color:'#fff'}}>{p.name}</span></Td><Td muted>{p.client_name}</Td><Td><ProgressBar pct={p.advance_pct}/></Td><Td><Badge label={cfg.label} color={cfg.color}/></Td>{isFinancial && <Td right>{F(p.contract_value)}</Td>}</tr>)
              })}
            </tbody>
            </Table>
          </div>
        </div>

        {/* ── Cobranza (DG/Admin) O Leads recientes (Ventas) ── */}
        <div>
          {isFinancial ? (<>
            <SectionHeader title="Cobranza pendiente" />
            <div style={{ overflowX: 'auto' }}>
              <Table>
              <thead><tr><Th>Hito</Th><Th>Proyecto</Th><Th>Vence</Th><Th right>Monto</Th></tr></thead>
              <tbody>
                {milestones.length===0&&<tr><Td colSpan={4} muted>Sin cobros pendientes</Td></tr>}
                {milestones.slice(0,6).map(m => (
                  <tr key={m.id}>
                    <Td><span style={{fontWeight:500,color:m.status==='vencido'?'#EF4444':'#ccc'}}>{m.name}</span></Td>
                    <Td muted>{(m.project as any)?.name||'-'}</Td>
                    <Td muted>{m.due_date?formatDate(m.due_date):'-'}</Td>
                    <Td right style={{color:'#57FF9A',fontWeight:600}}>{F(m.amount)}</Td>
                  </tr>
                ))}
              </tbody>
              </Table>
            </div>
          </>) : (area === 'DG') ? (<>
            <SectionHeader title="Leads recientes" />
            <div style={{ overflowX: 'auto' }}>
              <Table>
              <thead><tr><Th>Lead</Th><Th>Empresa</Th><Th>Estatus</Th><Th>Fecha</Th></tr></thead>
              <tbody>
                {recentLeads.length===0&&<tr><Td colSpan={4} muted>Sin leads</Td></tr>}
                {recentLeads.map((l: any) => (
                  <tr key={l.id} onClick={() => navigate(`/crm/${l.id}`)} style={{ cursor: 'pointer' }}>
                    <Td><span style={{fontWeight:500,color:'#fff'}}>{l.name}</span></Td>
                    <Td muted>{l.company || '-'}</Td>
                    <Td><Badge label={l.status} color={l.status === 'ganado' ? '#57FF9A' : l.status === 'perdido' ? '#EF4444' : '#3B82F6'} /></Td>
                    <Td muted>{l.created_at ? formatDate(l.created_at) : '-'}</Td>
                  </tr>
                ))}
              </tbody>
              </Table>
            </div>
          </>) : (
            <div>
              <SectionHeader title="Empleados activos" />
              <div style={{ padding: 20, color: '#666', fontSize: 13 }}>
                {empCount} empleados activos en el sistema.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Reportes recientes (todos los ven) ── */}
      <div>
        <SectionHeader title="Reportes recientes" />
        <div style={{ overflowX: 'auto' }}>
          <Table>
          <thead><tr><Th>Fecha</Th><Th>Proyecto</Th><Th>Instalador</Th><Th>Reporte</Th></tr></thead>
          <tbody>
            {reports.length===0&&<tr><Td colSpan={4} muted>Sin reportes</Td></tr>}
            {reports.map(r => (
              <tr key={r.id}>
                <Td muted>{formatDate(r.report_date)}</Td>
                <Td><span style={{fontWeight:500,color:'#fff'}}>{(r.project as any)?.name||'-'}</span></Td>
                <Td muted>{(r.employee as any)?.name||'-'}</Td>
                <Td muted>{r.raw_text||'-'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      </div>

      {/* ── COBRANZA POR PROYECTO (solo DG) ── */}
      {area === 'DG' && <CobranzaPorProyecto />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CobranzaPorProyecto — vista por lead del estado financiero de cada proyecto
//   Vendido        = suma de quotations.total (stage=contrato) del lead
//   Cobrado        = suma de bank_movements (categoria=cobro_cliente) del lead
//   Pagado total   = suma de bank_movements (tipo=cargo) del lead
//   Pagado compras = suma de POs (status pedida/recibida/recibida_parcial) del lead
//   Por pagar comp = suma de POs (status borrador/aprobada) del lead
//
//   Click sobre el row → expande mostrando cotizaciones del lead con su monto.
// ═══════════════════════════════════════════════════════════════════════════
function CobranzaPorProyecto() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState<any[]>([])
  const [quotations, setQuotations] = useState<any[]>([])
  const [pos, setPOs] = useState<any[]>([])
  const [bankMovs, setBankMovs] = useState<any[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  // Manejo de moneda: el user elige ver todo en MXN o USD, con TC editable.
  // Cada source tiene su propia moneda original: quotations.notes.currency,
  // purchase_orders.currency, bank_movements.moneda. Se convierte al display.
  const [currencyView, setCurrencyView] = useState<'MXN' | 'USD'>('MXN')
  const [tc, setTc] = useState<number>(20.5)

  useEffect(() => {
    async function load() {
      const [leadsRes, qRes, poRes, bmRes] = await Promise.all([
        supabase.from('leads').select('id, name, company'),
        supabase.from('quotations').select('id, name, notes, specialty, stage, total').order('updated_at', { ascending: false }),
        supabase.from('purchase_orders').select('id, po_number, total, status, lead_id, quotation_id, currency'),
        supabase.from('bank_movements').select('id, monto, tipo, fecha, lead_id, quotation_id, categoria_sugerida, moneda').not('lead_id', 'is', null),
      ])
      // Parsear lead_id Y currency de cotizaciones desde notes JSON
      const qList = (qRes.data || []).map((q: any) => {
        let lead_id = ''
        let currency = 'MXN' // default
        try {
          const m = typeof q.notes === 'string' ? JSON.parse(q.notes || '{}') : q.notes
          if (m?.lead_id) lead_id = m.lead_id
          if (m?.currency) currency = m.currency
        } catch {}
        return { ...q, lead_id, currency }
      })
      setLeads(leadsRes.data || [])
      setQuotations(qList)
      setPOs(poRes.data || [])
      setBankMovs(bmRes.data || [])
      setLoading(false)
    }
    load()
  }, [])

  // Helper: convertir un monto en su moneda original a la moneda de visualización
  // - source MXN, view MXN → mismo
  // - source USD, view MXN → monto * tc
  // - source MXN, view USD → monto / tc
  // - source USD, view USD → mismo
  const convert = (amount: number, fromCurrency: string): number => {
    const from = (fromCurrency || 'MXN').toUpperCase()
    if (from === currencyView) return amount
    if (from === 'USD' && currencyView === 'MXN') return amount * tc
    if (from === 'MXN' && currencyView === 'USD') return amount / tc
    return amount
  }
  // Formateador con prefijo de moneda
  const fmt = (amount: number) => {
    const formatted = F(Math.abs(amount))
    // F() devuelve "$X,XXX.XX" sin distinguir moneda. Agregamos sufijo.
    return currencyView === 'USD' ? formatted + ' USD' : formatted
  }

  // Resolver lead_id de una OC: si no tiene directo, inferirlo desde la cotización vinculada
  const resolvePoLead = (po: any) => {
    if (po.lead_id) return po.lead_id
    if (po.quotation_id) {
      const q = quotations.find(qq => qq.id === po.quotation_id)
      if (q?.lead_id) return q.lead_id
    }
    return null
  }

  // Calcular métricas por lead, ordenadas por monto vendido desc
  const leadRows = useMemo(() => {
    if (loading) return []
    // Solo leads que tienen al menos una cotización contrato
    const contratos = quotations.filter(q => q.stage === 'contrato' && q.lead_id)
    const leadIdsConContrato = new Set(contratos.map(q => q.lead_id))

    const rows = Array.from(leadIdsConContrato).map(leadId => {
      const lead = leads.find(l => l.id === leadId)
      const cotsLead = contratos.filter(q => q.lead_id === leadId)
      // Vendido: convertir cada cotización desde su moneda nativa
      const vendido = cotsLead.reduce((s, q) => s + convert((Number(q.total) || 0) * 1.16, q.currency || 'MXN'), 0)
      // POs de este lead (directo o vía cotización)
      const posLead = pos.filter(p => resolvePoLead(p) === leadId)
      const pagado_compras = posLead
        .filter(p => ['pedida', 'recibida', 'recibida_parcial'].includes(p.status))
        .reduce((s, p) => s + convert(Number(p.total) || 0, p.currency || 'MXN'), 0)
      const por_pagar_compras = posLead
        .filter(p => ['borrador', 'aprobada'].includes(p.status))
        .reduce((s, p) => s + convert(Number(p.total) || 0, p.currency || 'MXN'), 0)
      // Bank movements de este lead
      const movsLead = bankMovs.filter(b => b.lead_id === leadId)
      const cobrado = movsLead
        .filter(b => b.tipo === 'abono' && (b.categoria_sugerida === 'cobro_cliente' || !b.categoria_sugerida))
        .reduce((s, b) => s + convert(Number(b.monto) || 0, b.moneda || 'MXN'), 0)
      const pagado_total = movsLead
        .filter(b => b.tipo === 'cargo')
        .reduce((s, b) => s + convert(Number(b.monto) || 0, b.moneda || 'MXN'), 0)

      // Detectar si el lead tiene mezcla de monedas (para warning visual)
      const monedasMixtas = new Set<string>()
      cotsLead.forEach(q => monedasMixtas.add((q.currency || 'MXN').toUpperCase()))
      posLead.forEach(p => monedasMixtas.add((p.currency || 'MXN').toUpperCase()))
      const hasMixedCurrencies = monedasMixtas.size > 1

      return {
        leadId,
        leadName: lead?.name || '(lead sin nombre)',
        leadCompany: lead?.company || '',
        cotsLead,
        vendido,
        cobrado,
        pagado_total,
        pagado_compras,
        por_pagar_compras,
        balance: cobrado - pagado_total,
        por_cobrar: Math.max(0, vendido - cobrado),
        hasMixedCurrencies,
      }
    })
    rows.sort((a, b) => b.vendido - a.vendido)
    return rows
  }, [loading, leads, quotations, pos, bankMovs, currencyView, tc])

  // Totales generales
  const totals = useMemo(() => leadRows.reduce((acc, r) => ({
    vendido: acc.vendido + r.vendido,
    cobrado: acc.cobrado + r.cobrado,
    pagado_total: acc.pagado_total + r.pagado_total,
    pagado_compras: acc.pagado_compras + r.pagado_compras,
    por_pagar_compras: acc.por_pagar_compras + r.por_pagar_compras,
    por_cobrar: acc.por_cobrar + r.por_cobrar,
  }), { vendido: 0, cobrado: 0, pagado_total: 0, pagado_compras: 0, por_pagar_compras: 0, por_cobrar: 0 }), [leadRows])

  const toggleExpand = (leadId: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId)
      return next
    })
  }

  if (loading) return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeader title="Cobranza por proyecto" />
      <div style={{ padding: 20, color: '#666', fontSize: 12 }}>Cargando...</div>
    </div>
  )

  const visibleRows = showAll ? leadRows : leadRows.slice(0, 10)

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeader
        title="Cobranza por proyecto"
        subtitle={`${leadRows.length} proyectos cerrados · Todo convertido a ${currencyView} con TC ${tc}`}
      />
      {/* Toggle de moneda + TC editable */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, padding: '8px 12px', background: '#141414', border: '1px solid #222', borderRadius: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>Ver en</span>
        <div style={{ display: 'flex', gap: 4, background: '#0a0a0a', borderRadius: 6, padding: 2 }}>
          {(['MXN', 'USD'] as const).map(m => (
            <button key={m} onClick={() => setCurrencyView(m)} style={{
              padding: '5px 14px', fontSize: 11, fontWeight: 600,
              background: currencyView === m ? (m === 'MXN' ? '#F59E0B22' : '#3B82F622') : 'transparent',
              color: currencyView === m ? (m === 'MXN' ? '#F59E0B' : '#3B82F6') : '#666',
              border: currencyView === m ? `1px solid ${m === 'MXN' ? '#F59E0B' : '#3B82F6'}` : '1px solid transparent',
              borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
            }}>{m === 'MXN' ? '🇲🇽 MXN' : '🇺🇸 USD'}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
          <span style={{ fontSize: 10, color: '#666' }}>TC:</span>
          <input
            type="number" step="0.01" value={tc}
            onChange={e => setTc(Math.max(0.01, parseFloat(e.target.value) || 0))}
            style={{ width: 80, padding: '5px 8px', fontSize: 11, background: '#0a0a0a', border: '1px solid #333', borderRadius: 4, color: '#fff', fontFamily: 'inherit', textAlign: 'right' }}
          />
          <span style={{ fontSize: 10, color: '#555' }}>1 USD = {tc} MXN</span>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 10, color: '#666' }}>
          ⓘ Cotizaciones en USD se convierten con el TC. Filas con badge ⚠ tienen mezcla de monedas.
        </div>
      </div>
      <div style={{ overflowX: 'auto', background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 10 }}>
        <Table>
          <thead><tr>
            <Th></Th>
            <Th>Proyecto / Lead</Th>
            <Th right>Vendido</Th>
            <Th right>Cobrado</Th>
            <Th right>Por cobrar</Th>
            <Th right>Pagado total</Th>
            <Th right>Pagado compras</Th>
            <Th right>Por pagar compras</Th>
          </tr></thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr><Td colSpan={8} muted>Sin proyectos con cotización en contrato</Td></tr>
            )}
            {visibleRows.map(r => {
              const isExp = expanded.has(r.leadId)
              return (
                <>
                  <tr key={r.leadId} onClick={() => toggleExpand(r.leadId)} style={{ cursor: 'pointer' }}>
                    <Td style={{ width: 24, padding: '6px 8px' }}>
                      {isExp ? <ChevronDown size={14} color="#666" /> : <ChevronRight size={14} color="#666" />}
                    </Td>
                    <Td>
                      <div style={{ fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {r.leadName}
                        {r.hasMixedCurrencies && (
                          <span title="Este lead tiene cotizaciones en MXN y USD — el TC afecta el cálculo" style={{
                            fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                            background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#F59E0B',
                          }}>⚠ MXN+USD</span>
                        )}
                      </div>
                      {r.leadCompany && <div style={{ fontSize: 10, color: '#666' }}>{r.leadCompany}</div>}
                    </Td>
                    <Td right><span style={{ color: '#ccc', fontWeight: 600 }}>{fmt(r.vendido)}</span></Td>
                    <Td right><span style={{ color: '#57FF9A', fontWeight: 600 }}>{fmt(r.cobrado)}</span></Td>
                    <Td right><span style={{ color: r.por_cobrar > 0 ? '#F59E0B' : '#666', fontWeight: 600 }}>{r.por_cobrar > 0 ? fmt(r.por_cobrar) : '✓'}</span></Td>
                    <Td right><span style={{ color: '#EF4444' }}>{fmt(r.pagado_total)}</span></Td>
                    <Td right><span style={{ color: '#EF4444' }}>{fmt(r.pagado_compras)}</span></Td>
                    <Td right><span style={{ color: r.por_pagar_compras > 0 ? '#F59E0B' : '#666' }}>{r.por_pagar_compras > 0 ? fmt(r.por_pagar_compras) : '—'}</span></Td>
                  </tr>
                  {isExp && (
                    <tr key={r.leadId + '-exp'}>
                      <td colSpan={8} style={{ background: '#080808', padding: 0 }}>
                        <div style={{ padding: '8px 16px 12px 40px' }}>
                          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                            Cotizaciones del lead ({r.cotsLead.length})
                          </div>
                          <table style={{ width: '100%', fontSize: 11 }}>
                            <thead>
                              <tr style={{ color: '#444' }}>
                                <td style={{ padding: '4px 6px' }}>Cotización</td>
                                <td style={{ padding: '4px 6px' }}>Especialidad</td>
                                <td style={{ padding: '4px 6px', textAlign: 'right' }}>Subtotal</td>
                                <td style={{ padding: '4px 6px', textAlign: 'right' }}>c/IVA</td>
                                <td style={{ padding: '4px 6px' }}></td>
                              </tr>
                            </thead>
                            <tbody>
                              {r.cotsLead.map((q: any) => (
                                <tr key={q.id} style={{ borderTop: '1px solid #1a1a1a' }}
                                  onClick={(e) => { e.stopPropagation(); navigate(`/cotizaciones`) }}
                                  onMouseEnter={e => (e.currentTarget.style.background = '#111')}
                                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                >
                                  <td style={{ padding: '6px', color: '#ddd', cursor: 'pointer' }}>{q.name}</td>
                                  <td style={{ padding: '6px', color: '#888' }}>
                                    {q.specialty}
                                    <span style={{ marginLeft: 6, fontSize: 9, color: q.currency === 'USD' ? '#3B82F6' : '#F59E0B' }}>
                                      {q.currency || 'MXN'}
                                    </span>
                                  </td>
                                  <td style={{ padding: '6px', textAlign: 'right', color: '#aaa' }}>{fmt(convert(Number(q.total) || 0, q.currency || 'MXN'))}</td>
                                  <td style={{ padding: '6px', textAlign: 'right', color: '#fff', fontWeight: 600 }}>{fmt(convert((Number(q.total) || 0) * 1.16, q.currency || 'MXN'))}</td>
                                  <td style={{ padding: '6px', textAlign: 'right' }}>
                                    <button onClick={(e) => { e.stopPropagation(); navigate(`/crm/${r.leadId}`) }}
                                      style={{ background: 'transparent', border: '1px solid #333', borderRadius: 4, padding: '2px 8px', color: '#888', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
                                      CRM →
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {/* Fila de totales */}
            {leadRows.length > 0 && (
              <tr style={{ borderTop: '2px solid #333', background: '#0a0a0a' }}>
                <Td></Td>
                <Td><span style={{ fontWeight: 700, color: '#fff' }}>Total ({currencyView})</span></Td>
                <Td right><span style={{ fontWeight: 700, color: '#fff' }}>{fmt(totals.vendido)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: '#57FF9A' }}>{fmt(totals.cobrado)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: totals.por_cobrar > 0 ? '#F59E0B' : '#666' }}>{fmt(totals.por_cobrar)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: '#EF4444' }}>{fmt(totals.pagado_total)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: '#EF4444' }}>{fmt(totals.pagado_compras)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: totals.por_pagar_compras > 0 ? '#F59E0B' : '#666' }}>{fmt(totals.por_pagar_compras)}</span></Td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>
      {leadRows.length > 10 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <button onClick={() => setShowAll(s => !s)} style={{
            background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 6,
            padding: '6px 14px', color: '#888', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {showAll ? `Mostrar solo top 10` : `Ver todos (${leadRows.length})`}
          </button>
        </div>
      )}
    </div>
  )
}
