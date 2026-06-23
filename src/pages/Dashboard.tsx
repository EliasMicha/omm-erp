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
        {isFinancial && <KpiCard label="Pipeline total" value={F(pipeline)} color="#2563EB" icon={<DollarSign size={16} />} />}
        {isFinancial && <KpiCard label="Cobros vencidos" value={vencidos.length} color={vencidos.length > 0 ? '#DC2626' : '#10B981'} icon={<AlertTriangle size={16} />} />}
        {area === 'DG' && <KpiCard label="Leads recientes" value={recentLeads.length} color="#2563EB" icon={<TrendingUp size={16} />} />}
        <KpiCard label="Empleados activos" value={empCount} color="#A78BFA" icon={<Users size={16} />} />
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
                    <Td><span style={{fontWeight:500,color:m.status==='vencido'?'#DC2626':'#ccc'}}>{m.name}</span></Td>
                    <Td muted>{(m.project as any)?.name||'-'}</Td>
                    <Td muted>{m.due_date?formatDate(m.due_date):'-'}</Td>
                    <Td right style={{color:'#10B981',fontWeight:600}}>{F(m.amount)}</Td>
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
                    <Td><Badge label={l.status} color={l.status === 'ganado' ? '#10B981' : l.status === 'perdido' ? '#DC2626' : '#2563EB'} /></Td>
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
      {area === 'DG' && <ProyeccionCobranza />}
      {area === 'DG' && <CobranzaPorProyecto />}

      {/* ── PROYECCIÓN DE CIERRE DE VENTAS (solo DG) ── */}
      {area === 'DG' && <ProyeccionCierreVentas />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ProyeccionCierreVentas — agrupa leads activos por mes de expected_close_date
//   Esperado    = Σ estimated_value
//   Ponderado   = Σ estimated_value × close_probability / 100
//   Solo leads con status NO en ['ganado','perdido'] y con expected_close_date
//   Vista de los próximos 12 meses
// ═══════════════════════════════════════════════════════════════════════════
function ProyeccionCierreVentas() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState<any[]>([])
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('leads')
      .select('id, name, company, status, estimated_value, close_probability, expected_close_date')
      .not('expected_close_date', 'is', null)
      .not('status', 'in', '(ganado,perdido)')
      .order('expected_close_date')
      .then(({ data }) => {
        setLeads(data || [])
        setLoading(false)
      })
  }, [])

  // Generar 12 meses hacia adelante desde mes actual
  const months = useMemo(() => {
    const arr: { key: string; label: string; date: Date }[] = []
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' })
      arr.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1), date: d })
    }
    return arr
  }, [])

  // Agrupar leads por mes de expected_close_date
  const byMonth = useMemo(() => {
    const map: Record<string, { esperado: number; ponderado: number; leads: any[] }> = {}
    months.forEach(m => { map[m.key] = { esperado: 0, ponderado: 0, leads: [] } })
    // Bucket adicional para leads que se pasaron de los 12 meses (futuro lejano)
    map['futuro'] = { esperado: 0, ponderado: 0, leads: [] }
    // Bucket para leads ya vencidos (expected_close_date en el pasado)
    map['vencido'] = { esperado: 0, ponderado: 0, leads: [] }

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const lastMonthKey = months[months.length - 1].key

    leads.forEach(l => {
      const d = new Date(l.expected_close_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const value = Number(l.estimated_value) || 0
      const prob = Number(l.close_probability) || 0
      const target = d < today ? 'vencido' : (key > lastMonthKey ? 'futuro' : key)
      if (!map[target]) return
      map[target].esperado += value
      map[target].ponderado += value * (prob / 100)
      map[target].leads.push(l)
    })
    return map
  }, [leads, months])

  const totales = useMemo(() => {
    const all = Object.values(byMonth)
    return {
      esperado: all.reduce((s, m) => s + m.esperado, 0),
      ponderado: all.reduce((s, m) => s + m.ponderado, 0),
      count: leads.length,
    }
  }, [byMonth, leads])

  if (loading) return null

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeader
        title="Proyección de cierre de ventas"
        subtitle={`${totales.count} leads activos con fecha de cierre · Total esperado ${F(totales.esperado)} · Ponderado ${F(totales.ponderado)}`}
      />
      <div style={{ overflowX: 'auto', background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 10 }}>
        <Table>
          <thead><tr>
            <Th></Th>
            <Th>Mes</Th>
            <Th right>Leads</Th>
            <Th right>Esperado</Th>
            <Th right>Ponderado (× prob.)</Th>
          </tr></thead>
          <tbody>
            {/* Vencidos (rojo, arriba si hay) */}
            {byMonth['vencido'].leads.length > 0 && (
              <MonthRow
                monthKey="vencido"
                label="⚠ Vencidos (sin actualizar)"
                color="#DC2626"
                data={byMonth['vencido']}
                expanded={expandedMonth === 'vencido'}
                onToggle={() => setExpandedMonth(expandedMonth === 'vencido' ? null : 'vencido')}
                navigate={navigate}
              />
            )}
            {/* Próximos 12 meses */}
            {months.map(m => {
              const data = byMonth[m.key]
              if (data.leads.length === 0) return null
              return (
                <MonthRow
                  key={m.key}
                  monthKey={m.key}
                  label={m.label}
                  color="#10B981"
                  data={data}
                  expanded={expandedMonth === m.key}
                  onToggle={() => setExpandedMonth(expandedMonth === m.key ? null : m.key)}
                  navigate={navigate}
                />
              )
            })}
            {/* Futuro lejano */}
            {byMonth['futuro'].leads.length > 0 && (
              <MonthRow
                monthKey="futuro"
                label="Futuro lejano (>12 meses)"
                color="#888"
                data={byMonth['futuro']}
                expanded={expandedMonth === 'futuro'}
                onToggle={() => setExpandedMonth(expandedMonth === 'futuro' ? null : 'futuro')}
                navigate={navigate}
              />
            )}
            {/* Si nada */}
            {totales.count === 0 && (
              <tr><Td colSpan={5} muted>Sin leads con fecha de cierre estimada. Define <strong style={{ color: '#888' }}>Cierre estimado</strong> en cada lead desde el CRM.</Td></tr>
            )}
            {/* Total */}
            {totales.count > 0 && (
              <tr style={{ borderTop: '2px solid #333', background: '#0a0a0a' }}>
                <Td></Td>
                <Td><span style={{ fontWeight: 700, color: '#fff' }}>Total</span></Td>
                <Td right><span style={{ fontWeight: 700, color: '#fff' }}>{totales.count}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: '#fff' }}>{F(totales.esperado)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: '#10B981' }}>{F(totales.ponderado)}</span></Td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>
    </div>
  )
}

function MonthRow({ monthKey, label, color, data, expanded, onToggle, navigate }: {
  monthKey: string; label: string; color: string;
  data: { esperado: number; ponderado: number; leads: any[] };
  expanded: boolean; onToggle: () => void; navigate: (path: string) => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <Td style={{ width: 24, padding: '6px 8px' }}>
          {expanded ? <ChevronDown size={14} color="#666" /> : <ChevronRight size={14} color="#666" />}
        </Td>
        <Td>
          <span style={{ fontWeight: 600, color, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color }} />
            {label}
          </span>
        </Td>
        <Td right><span style={{ color: '#aaa' }}>{data.leads.length}</span></Td>
        <Td right><span style={{ color: '#ccc', fontWeight: 600 }}>{F(data.esperado)}</span></Td>
        <Td right><span style={{ color: '#10B981', fontWeight: 600 }}>{F(data.ponderado)}</span></Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} style={{ background: '#080808', padding: 0 }}>
            <div style={{ padding: '8px 16px 12px 40px' }}>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Leads esperados {monthKey === 'vencido' ? '(fechas vencidas)' : `en ${label}`}
              </div>
              <table style={{ width: '100%', fontSize: 11 }}>
                <thead><tr style={{ color: '#444' }}>
                  <td style={{ padding: '4px 6px' }}>Lead</td>
                  <td style={{ padding: '4px 6px' }}>Arquitecto</td>
                  <td style={{ padding: '4px 6px' }}>Status</td>
                  <td style={{ padding: '4px 6px' }}>Fecha cierre</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>Prob.</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>Valor</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>Ponderado</td>
                </tr></thead>
                <tbody>
                  {data.leads.map(l => {
                    const v = Number(l.estimated_value) || 0
                    const p = Number(l.close_probability) || 0
                    return (
                      <tr key={l.id}
                        onClick={(e) => { e.stopPropagation(); navigate(`/crm/${l.id}`) }}
                        style={{ borderTop: '1px solid #1a1a1a', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#111')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '6px', color: '#fff', fontWeight: 500 }}>{l.name}</td>
                        <td style={{ padding: '6px', color: '#888' }}>{l.company || '—'}</td>
                        <td style={{ padding: '6px', color: '#666' }}>{l.status}</td>
                        <td style={{ padding: '6px', color: '#888' }}>{l.expected_close_date}</td>
                        <td style={{ padding: '6px', textAlign: 'right', color: p >= 70 ? '#10B981' : p >= 40 ? '#D97706' : '#888' }}>{p}%</td>
                        <td style={{ padding: '6px', textAlign: 'right', color: '#ccc' }}>{F(v)}</td>
                        <td style={{ padding: '6px', textAlign: 'right', color: '#10B981', fontWeight: 600 }}>{F(v * p / 100)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ProyeccionCobranza — KPIs próximos 6 meses + cotizaciones sin plan
//   Lee payment_milestones agrupados por mes (YYYY-MM):
//     - pendiente (paid_at IS NULL, due_date >= hoy)
//     - vencido   (paid_at IS NULL, due_date < hoy)
//     - cobrado   (paid_at IS NOT NULL)
//   Click un mes → expande hitos con quotation + lead asociado.
//   También muestra widget "Cotizaciones sin plan" como atajo para capturar
//   las que faltan retroactivamente.
// ═══════════════════════════════════════════════════════════════════════════
function ProyeccionCobranza() {
  const navigate = useNavigate()
  const [milestones, setMilestones] = useState<any[]>([])
  const [quotsContrato, setQuotsContrato] = useState<any[]>([])
  const [leadsMap, setLeadsMap] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)
  // Toggle moneda — heredamos el patrón del componente Cobranza por proyecto.
  // Por simplicidad asumimos MXN como base aquí; los milestones tienen currency.
  const [currencyView, setCurrencyView] = useState<'MXN' | 'USD'>('MXN')
  const [tc, setTc] = useState<number>(18.5)

  useEffect(() => {
    async function load() {
      const [pmRes, qRes, leadsRes] = await Promise.all([
        // Trae milestones con su quotation embebida para mostrar contexto
        supabase.from('payment_milestones').select('*'),
        supabase.from('quotations').select('id, name, notes, stage').eq('stage', 'contrato'),
        supabase.from('leads').select('id, name, company'),
      ])
      const qList = (qRes.data || []).map((q: any) => {
        let lead_id = ''
        try {
          const m = typeof q.notes === 'string' ? JSON.parse(q.notes || '{}') : q.notes
          if (m?.lead_id) lead_id = m.lead_id
        } catch {}
        return { ...q, lead_id }
      })
      const leadsObj: Record<string, any> = {}
      ;(leadsRes.data || []).forEach((l: any) => { leadsObj[l.id] = l })
      setMilestones(pmRes.data || [])
      setQuotsContrato(qList)
      setLeadsMap(leadsObj)
      setLoading(false)
    }
    load()
  }, [])

  // Conversor de moneda
  const convert = (amount: number, fromCurrency: string): number => {
    const from = (fromCurrency || 'MXN').toUpperCase()
    if (from === currencyView) return amount
    if (from === 'USD' && currencyView === 'MXN') return amount * tc
    if (from === 'MXN' && currencyView === 'USD') return amount / tc
    return amount
  }
  const fmt = (n: number) => currencyView === 'USD' ? F(Math.abs(n)) + ' USD' : F(Math.abs(n))

  // Agrupar milestones por mes (YYYY-MM)
  const monthsData = useMemo(() => {
    if (loading) return []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Próximos 6 meses + 1 columna "vencido histórico"
    const months: string[] = []
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return months.map(monthKey => {
      const [yr, mo] = monthKey.split('-').map(Number)
      const monthStart = new Date(yr, mo - 1, 1)
      const monthEnd = new Date(yr, mo, 0, 23, 59, 59)
      const hitosMes = milestones.filter((m: any) => {
        if (!m.due_date) return false
        const dd = new Date(m.due_date + 'T00:00:00')
        return dd >= monthStart && dd <= monthEnd
      })
      const pendiente = hitosMes
        .filter(m => !m.paid_at && new Date(m.due_date + 'T00:00:00') >= today)
        .reduce((s, m) => s + convert(Number(m.amount) || 0, m.currency || 'MXN'), 0)
      const vencido = hitosMes
        .filter(m => !m.paid_at && new Date(m.due_date + 'T00:00:00') < today)
        .reduce((s, m) => s + convert(Number(m.amount) || 0, m.currency || 'MXN'), 0)
      const cobrado = hitosMes
        .filter(m => m.paid_at)
        .reduce((s, m) => s + convert(Number(m.amount_paid_mxn || m.amount) || 0, m.currency || 'MXN'), 0)
      const total = pendiente + vencido + cobrado
      return { monthKey, monthStart, hitosMes, pendiente, vencido, cobrado, total }
    })
  }, [milestones, currencyView, tc, loading])

  // Hitos vencidos históricos (anteriores al primer mes en cards)
  const vencidoHistorico = useMemo(() => {
    if (loading) return { total: 0, hitos: [] as any[] }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const firstMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const overdue = milestones.filter((m: any) => {
      if (!m.due_date || m.paid_at) return false
      const dd = new Date(m.due_date + 'T00:00:00')
      return dd < firstMonth
    })
    const total = overdue.reduce((s, m) => s + convert(Number(m.amount) || 0, m.currency || 'MXN'), 0)
    return { total, hitos: overdue }
  }, [milestones, currencyView, tc, loading])

  // Cotizaciones contrato sin plan
  const cotsSinPlan = useMemo(() => {
    if (loading) return []
    const quotIdsConPlan = new Set(milestones.map((m: any) => m.quotation_id))
    return quotsContrato.filter(q => !quotIdsConPlan.has(q.id))
  }, [milestones, quotsContrato, loading])

  if (loading) return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeader title="Proyección de cobranza" />
      <div style={{ padding: 20, color: '#666', fontSize: 12 }}>Cargando...</div>
    </div>
  )

  // Helper: formatear monthKey "2026-06" a "Junio 2026"
  const fmtMonthLabel = (monthKey: string) => {
    const [yr, mo] = monthKey.split('-').map(Number)
    const d = new Date(yr, mo - 1, 1)
    return d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase())
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeader
        title="Proyección de cobranza"
        subtitle={`${milestones.length} hitos registrados · Próximos 6 meses · Click un mes para ver hitos`}
      />
      {/* Toggle moneda */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, padding: '8px 12px', background: '#141414', border: '1px solid #222', borderRadius: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>Ver en</span>
        <div style={{ display: 'flex', gap: 4, background: '#0a0a0a', borderRadius: 6, padding: 2 }}>
          {(['MXN', 'USD'] as const).map(m => (
            <button key={m} onClick={() => setCurrencyView(m)} style={{
              padding: '5px 14px', fontSize: 11, fontWeight: 600,
              background: currencyView === m ? (m === 'MXN' ? '#D9770622' : '#2563EB22') : 'transparent',
              color: currencyView === m ? (m === 'MXN' ? '#D97706' : '#2563EB') : '#666',
              border: currencyView === m ? `1px solid ${m === 'MXN' ? '#D97706' : '#2563EB'}` : '1px solid transparent',
              borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
            }}>{m === 'MXN' ? '🇲🇽 MXN' : '🇺🇸 USD'}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
          <span style={{ fontSize: 10, color: '#666' }}>TC:</span>
          <input
            type="number" step="0.01" value={tc}
            onChange={e => setTc(Math.max(0.01, parseFloat(e.target.value) || 0))}
            style={{ width: 80, padding: '5px 8px', fontSize: 11, background: '#0a0a0a', border: '1px solid #333', borderRadius: 4, color: '#fff', fontFamily: 'inherit', textAlign: 'right' as const }}
          />
        </div>
      </div>

      {/* Cards de los 6 meses */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, marginBottom: 12 }}>
        {/* Vencido histórico — solo aparece si hay */}
        {vencidoHistorico.total > 0 && (
          <div style={{
            background: '#0d0d0d', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10,
            padding: '12px 14px', borderTop: '3px solid #DC2626', cursor: 'pointer',
          }} onClick={() => setExpandedMonth(expandedMonth === '__overdue' ? null : '__overdue')}>
            <div style={{ fontSize: 9, color: '#DC2626', textTransform: 'uppercase' as const, letterSpacing: 0.5, fontWeight: 700 }}>
              ⚠ Vencido (acumulado)
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#DC2626', marginTop: 4 }}>
              {fmt(vencidoHistorico.total)}
            </div>
            <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{vencidoHistorico.hitos.length} hitos atrasados</div>
          </div>
        )}
        {monthsData.map(m => {
          const isExp = expandedMonth === m.monthKey
          const hasContent = m.total > 0
          return (
            <div key={m.monthKey}
              onClick={() => hasContent && setExpandedMonth(isExp ? null : m.monthKey)}
              style={{
                background: '#0d0d0d', border: '1px solid ' + (isExp ? '#2563EB' : '#1a1a1a'), borderRadius: 10,
                padding: '12px 14px', borderTop: '3px solid ' + (m.vencido > 0 ? '#D97706' : '#2563EB'),
                cursor: hasContent ? 'pointer' : 'default',
                opacity: hasContent ? 1 : 0.4, transition: 'border-color 0.15s',
              }}>
              <div style={{ fontSize: 9, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 0.5, fontWeight: 600 }}>
                {fmtMonthLabel(m.monthKey)}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginTop: 4 }}>
                {fmt(m.total)}
              </div>
              <div style={{ fontSize: 10, marginTop: 4, color: '#666', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {m.pendiente > 0 && <span style={{ color: '#2563EB' }}>📅 {fmt(m.pendiente)}</span>}
                {m.vencido > 0 && <span style={{ color: '#D97706' }}>⚠ {fmt(m.vencido)}</span>}
                {m.cobrado > 0 && <span style={{ color: '#10B981' }}>✓ {fmt(m.cobrado)}</span>}
                {m.total === 0 && <span style={{ color: '#444' }}>sin hitos</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Tabla expandible con hitos del mes seleccionado */}
      {expandedMonth && (() => {
        const hitosToShow = expandedMonth === '__overdue'
          ? vencidoHistorico.hitos
          : monthsData.find(m => m.monthKey === expandedMonth)?.hitosMes || []
        return (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 10, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              Hitos {expandedMonth === '__overdue' ? 'vencidos acumulados' : fmtMonthLabel(expandedMonth)} · {hitosToShow.length}
            </div>
            <table style={{ width: '100%', fontSize: 11 }}>
              <thead><tr style={{ color: '#555' }}>
                <td style={{ padding: '4px 8px' }}>Concepto</td>
                <td style={{ padding: '4px 8px' }}>Cotización / Lead</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' as const }}>Monto</td>
                <td style={{ padding: '4px 8px' }}>Vence</td>
                <td style={{ padding: '4px 8px' }}>Estado</td>
              </tr></thead>
              <tbody>
                {hitosToShow.map((h: any) => {
                  const quot = quotsContrato.find(q => q.id === h.quotation_id)
                  const lead = quot ? leadsMap[quot.lead_id] : null
                  const dueDate = new Date(h.due_date + 'T00:00:00')
                  const today = new Date()
                  today.setHours(0, 0, 0, 0)
                  const isOverdue = !h.paid_at && dueDate < today
                  const isPaid = !!h.paid_at
                  return (
                    <tr key={h.id} style={{ borderTop: '1px solid #1a1a1a' }}>
                      <td style={{ padding: '8px', color: '#ddd' }}>{h.name}</td>
                      <td style={{ padding: '8px', color: '#888' }}>
                        <div style={{ color: '#ccc' }}>{quot?.name || '(cotización borrada)'}</div>
                        {lead && <div style={{ fontSize: 9, color: '#666' }}>{lead.name}{lead.company ? ` — ${lead.company}` : ''}</div>}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' as const, color: '#fff', fontWeight: 600 }}>
                        {fmt(convert(Number(h.amount) || 0, h.currency || 'MXN'))}
                      </td>
                      <td style={{ padding: '8px', color: isOverdue ? '#D97706' : '#888', fontSize: 10 }}>
                        {h.due_date}
                      </td>
                      <td style={{ padding: '8px' }}>
                        {isPaid ? (
                          <span style={{ background: 'rgba(87,255,154,0.15)', color: '#10B981', padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 600 }}>✓ Cobrado</span>
                        ) : isOverdue ? (
                          <span style={{ background: 'rgba(245,158,11,0.15)', color: '#D97706', padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 600 }}>⚠ Vencido</span>
                        ) : (
                          <span style={{ background: 'rgba(59,130,246,0.15)', color: '#2563EB', padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 600 }}>📅 Pendiente</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })()}

      {/* Cotizaciones sin plan — atajo para capturar */}
      {cotsSinPlan.length > 0 && (
        <div style={{ background: '#1a1a0a', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 16 }}>⚠</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#D97706' }}>
                {cotsSinPlan.length} cotizaciones cerradas SIN plan de pagos
              </div>
              <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                Estas no aparecen en la proyección. Captura su plan para tenerlas en el dashboard.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {cotsSinPlan.slice(0, 12).map((q: any) => {
              const lead = leadsMap[q.lead_id]
              return (
                <button key={q.id}
                  onClick={() => navigate('/cotizaciones')}
                  style={{
                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6,
                    padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 10, color: '#D97706', textAlign: 'left' as const,
                  }}>
                  <div style={{ fontWeight: 600 }}>{q.name}</div>
                  {lead && <div style={{ fontSize: 9, color: '#888', marginTop: 1 }}>{lead.name}</div>}
                </button>
              )
            })}
            {cotsSinPlan.length > 12 && (
              <div style={{ padding: '6px 10px', fontSize: 10, color: '#666' }}>+{cotsSinPlan.length - 12} más</div>
            )}
          </div>
        </div>
      )}
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
  const [cashMovs, setCashMovs] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [conciliacionLinks, setConciliacionLinks] = useState<any[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  // Manejo de moneda: el user elige ver todo en MXN o USD, con TC editable.
  // Cada source tiene su propia moneda original: quotations.notes.currency,
  // purchase_orders.currency, bank_movements.moneda. Se convierte al display.
  const [currencyView, setCurrencyView] = useState<'MXN' | 'USD'>('MXN')
  const [tc, setTc] = useState<number>(18.5)

  useEffect(() => {
    async function load() {
      // 1) Traer todo lo que tiene asignación directa (lead_id o quotation_id)
      // 2) Adicionalmente traer TODOS los conciliacion_links + facturas vinculadas
      //    para descubrir movs que solo están vinculados via factura → lead.
      const [leadsRes, qRes, poRes, bmRes, cmRes, invRes, linksRes] = await Promise.all([
        supabase.from('leads').select('id, name, company'),
        supabase.from('quotations').select('id, name, notes, specialty, stage, total').order('updated_at', { ascending: false }),
        supabase.from('purchase_orders').select('id, po_number, total, status, lead_id, quotation_id, currency'),
        // BUG FIX: la columna real es `categoria` (no `categoria_sugerida`).
        // Antes el SELECT fallaba y bankMovs quedaba vacío → Cobrado siempre $0.
        // Traemos TODOS los movs (no solo los que tienen lead_id directo) porque
        // muchos están conciliados a una factura que sí tiene lead/quotation.
        supabase.from('bank_movements').select('id, monto, tipo, fecha, lead_id, quotation_id, categoria, moneda'),
        supabase.from('cash_movements').select('id, tipo, direccion, monto, fecha, lead_id, quotation_id, concepto, moneda'),
        // Facturas con sus lead_id/quotation_id — usadas para resolver lead via factura
        supabase.from('facturas').select('id, lead_id, quotation_id, cotizacion_id'),
        // Links bank_movement ↔ factura (tabla de conciliación)
        supabase.from('conciliacion_links').select('bank_movement_id, invoice_id, monto_aplicado'),
      ])
      // Parsear lead_id, currency, descuento e ivaRate de cotizaciones desde notes JSON.
      // El descuento e ivaRate pueden estar en niveles distintos según especialidad:
      //   esp:    notes.descuento, notes.ivaRate (default 16)
      //   ilum:   notes.ilumConfig.descuento, notes.ilumConfig.ivaRate
      //   cort:   notes.cortConfig.descuento, notes.cortConfig.ivaRate
      //   proy:   notes.proyConfig.descuento, notes.proyConfig.ivaRate
      //   elec:   varía — buscar en todos los lugares
      const qList = (qRes.data || []).map((q: any) => {
        let lead_id = ''
        let currency = 'MXN'
        let descuento = 0  // % (0-100)
        let ivaRate = 16   // % (default IVA México)
        try {
          const m = typeof q.notes === 'string' ? JSON.parse(q.notes || '{}') : q.notes
          if (m?.lead_id) lead_id = m.lead_id
          if (m?.currency) currency = m.currency
          // Buscar descuento e ivaRate en el orden: root → especialidad config
          const configs = [m, m?.proyConfig, m?.ilumConfig, m?.cortConfig, m?.espConfig, m?.elecConfig].filter(Boolean)
          for (const cfg of configs) {
            if (descuento === 0 && typeof cfg.descuento === 'number') descuento = cfg.descuento
            if (ivaRate === 16 && typeof cfg.ivaRate === 'number') ivaRate = cfg.ivaRate
          }
        } catch {}
        return { ...q, lead_id, currency, descuento, ivaRate }
      })
      setLeads(leadsRes.data || [])
      setQuotations(qList)
      setPOs(poRes.data || [])
      setBankMovs(bmRes.data || [])
      setCashMovs(cmRes.data || [])
      setInvoices(invRes.data || [])
      setConciliacionLinks(linksRes.data || [])
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

  // Resolver lead_id en cascada: directo → via quotation → via factura conciliada
  const resolveLead = (record: any) => {
    if (record.lead_id) return record.lead_id
    if (record.quotation_id) {
      const q = quotations.find(qq => qq.id === record.quotation_id)
      if (q?.lead_id) return q.lead_id
    }
    return null
  }
  const resolvePoLead = resolveLead  // alias por compat

  // Para bank_movements: extender resolve a usar conciliacion_links → factura
  const resolveBankMovLead = (mov: any): string | null => {
    // 1. Directo
    const direct = resolveLead(mov)
    if (direct) return direct
    // 2. Via factura conciliada — buscar todos los links de este mov
    const links = conciliacionLinks.filter(l => l.bank_movement_id === mov.id)
    for (const link of links) {
      const inv = invoices.find(i => i.id === link.invoice_id)
      if (!inv) continue
      if (inv.lead_id) return inv.lead_id
      const qid = inv.quotation_id || inv.cotizacion_id
      if (qid) {
        const q = quotations.find(qq => qq.id === qid)
        if (q?.lead_id) return q.lead_id
      }
    }
    return null
  }

  // Calcular métricas por lead, ordenadas por monto vendido desc
  const leadRows = useMemo(() => {
    if (loading) return []
    // Solo leads que tienen al menos una cotización contrato
    const contratos = quotations.filter(q => q.stage === 'contrato' && q.lead_id)
    const leadIdsConContrato = new Set(contratos.map(q => q.lead_id))

    // Helper: monto final de la cotización.
    // IMPORTANTE: quotations.total YA viene con descuento e IVA aplicados desde
    // el editor (CotEditorESP, CotEditorCortinas, etc). Aplicar otra vez los
    // multiplicadores aquí causaba doble IVA / doble descuento. Confiamos
    // directamente en q.total.
    const cotMontoFinal = (q: any): number => Number(q.total) || 0

    const rows = Array.from(leadIdsConContrato).map(leadId => {
      const lead = leads.find(l => l.id === leadId)
      const cotsLead = contratos.filter(q => q.lead_id === leadId)

      // ═══════════════════════════════════════════════════════════════════════
      // Multi-moneda: acumular SIEMPRE en la moneda nativa del source.
      // Convertir solo al final para el "Total" en la moneda del toggle.
      // ═══════════════════════════════════════════════════════════════════════
      // Vendido — separado por moneda nativa de cada cot
      const vendidoMXN = cotsLead
        .filter(q => (q.currency || 'MXN').toUpperCase() === 'MXN')
        .reduce((s, q) => s + cotMontoFinal(q), 0)
      const vendidoUSD = cotsLead
        .filter(q => (q.currency || 'MXN').toUpperCase() === 'USD')
        .reduce((s, q) => s + cotMontoFinal(q), 0)
      const vendido = convert(vendidoMXN, 'MXN') + convert(vendidoUSD, 'USD')

      // POs de este lead — también por moneda nativa
      const posLead = pos.filter(p => resolvePoLead(p) === leadId)
      const pagadoComprasMXN = posLead
        .filter(p => ['pedida', 'recibida', 'recibida_parcial'].includes(p.status) && (p.currency || 'MXN').toUpperCase() === 'MXN')
        .reduce((s, p) => s + (Number(p.total) || 0), 0)
      const pagadoComprasUSD = posLead
        .filter(p => ['pedida', 'recibida', 'recibida_parcial'].includes(p.status) && (p.currency || 'MXN').toUpperCase() === 'USD')
        .reduce((s, p) => s + (Number(p.total) || 0), 0)
      const pagado_compras = convert(pagadoComprasMXN, 'MXN') + convert(pagadoComprasUSD, 'USD')

      const porPagarComprasMXN = posLead
        .filter(p => ['borrador', 'aprobada'].includes(p.status) && (p.currency || 'MXN').toUpperCase() === 'MXN')
        .reduce((s, p) => s + (Number(p.total) || 0), 0)
      const porPagarComprasUSD = posLead
        .filter(p => ['borrador', 'aprobada'].includes(p.status) && (p.currency || 'MXN').toUpperCase() === 'USD')
        .reduce((s, p) => s + (Number(p.total) || 0), 0)
      const por_pagar_compras = convert(porPagarComprasMXN, 'MXN') + convert(porPagarComprasUSD, 'USD')

      // Bank movements — clave del multi-moneda:
      //   1. Si el mov está vinculado via conciliacion_links a una factura, usar
      //      monto_en_moneda_factura si tiene TC aplicado (cross-currency), sino
      //      monto_aplicado en la moneda del mov.
      //   2. Si no tiene link, usar monto del mov en su moneda nativa.
      const movsLead = bankMovs.filter(b => resolveBankMovLead(b) === leadId)
      let cobradoBancoMXN = 0
      let cobradoBancoUSD = 0
      let pagadoBancoMXN = 0
      let pagadoBancoUSD = 0
      for (const m of movsLead) {
        const links = conciliacionLinks.filter(l => l.bank_movement_id === m.id)
        const movMon = (m.moneda || 'MXN').toUpperCase()
        const monto = Number(m.monto) || 0
        const isAbono = m.tipo === 'abono'

        if (links.length === 0) {
          // Sin link: contar el mov en su moneda nativa
          if (isAbono) {
            if (movMon === 'USD') cobradoBancoUSD += monto
            else cobradoBancoMXN += monto
          } else {
            if (movMon === 'USD') pagadoBancoUSD += monto
            else pagadoBancoMXN += monto
          }
          continue
        }
        // Con links: cada link contribuye en su moneda de factura
        for (const link of links) {
          const inv = invoices.find(i => i.id === link.invoice_id)
          const invMon = (inv?.moneda || movMon).toUpperCase()
          // monto_en_moneda_factura si tiene TC, sino monto_aplicado
          const aporta = (link.tc_aplicado && link.monto_en_moneda_factura)
            ? Number(link.monto_en_moneda_factura)
            : Number(link.monto_aplicado)
          if (isAbono) {
            if (invMon === 'USD') cobradoBancoUSD += aporta
            else cobradoBancoMXN += aporta
          } else {
            if (invMon === 'USD') pagadoBancoUSD += aporta
            else pagadoBancoMXN += aporta
          }
        }
      }

      // Cash movements — respetar moneda nativa (USD o MXN)
      const efectivoLead = cashMovs.filter(c => resolveLead(c) === leadId)
      // Aportaciones son capital de socios, NO cobros del cliente — no inflan Cobrado del proyecto
      const isIngreso = (c: any) => (c.direccion === 'ingreso' || c.tipo === 'cobro_cliente') && c.tipo !== 'aportacion'
      const cobradoEfectivoMXN = efectivoLead
        .filter(c => isIngreso(c) && (c.moneda || 'MXN').toUpperCase() === 'MXN')
        .reduce((s, c) => s + (Number(c.monto) || 0), 0)
      const cobradoEfectivoUSD = efectivoLead
        .filter(c => isIngreso(c) && (c.moneda || 'MXN').toUpperCase() === 'USD')
        .reduce((s, c) => s + (Number(c.monto) || 0), 0)
      const pagadoEfectivoMXN = efectivoLead
        .filter(c => c.direccion === 'egreso' && (c.moneda || 'MXN').toUpperCase() === 'MXN')
        .reduce((s, c) => s + (Number(c.monto) || 0), 0)
      const pagadoEfectivoUSD = efectivoLead
        .filter(c => c.direccion === 'egreso' && (c.moneda || 'MXN').toUpperCase() === 'USD')
        .reduce((s, c) => s + (Number(c.monto) || 0), 0)

      // Acumulados por moneda nativa (sin convertir)
      const cobradoMXN = cobradoBancoMXN + cobradoEfectivoMXN
      const cobradoUSD = cobradoBancoUSD + cobradoEfectivoUSD
      const pagadoTotalMXN = pagadoBancoMXN + pagadoEfectivoMXN
      const pagadoTotalUSD = pagadoBancoUSD + pagadoEfectivoUSD

      // Totales convertidos al toggle (solo como referencia visual)
      const cobrado = convert(cobradoMXN, 'MXN') + convert(cobradoUSD, 'USD')
      const pagado_total = convert(pagadoTotalMXN, 'MXN') + convert(pagadoTotalUSD, 'USD')

      // Por cobrar por moneda nativa
      const porCobrarMXN = Math.max(0, vendidoMXN - cobradoMXN)
      const porCobrarUSD = Math.max(0, vendidoUSD - cobradoUSD)

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
        // Totales convertidos a moneda del toggle (referencia)
        vendido,
        cobrado,
        pagado_total,
        pagado_compras,
        por_pagar_compras,
        balance: cobrado - pagado_total,
        por_cobrar: Math.max(0, vendido - cobrado),
        // Por moneda nativa
        vendidoMXN, vendidoUSD,
        cobradoMXN, cobradoUSD,
        pagadoTotalMXN, pagadoTotalUSD,
        pagadoComprasMXN, pagadoComprasUSD,
        porPagarComprasMXN, porPagarComprasUSD,
        porCobrarMXN, porCobrarUSD,
        hasMixedCurrencies,
      }
    })
    rows.sort((a, b) => b.vendido - a.vendido)
    return rows
  }, [loading, leads, quotations, pos, bankMovs, cashMovs, invoices, conciliacionLinks, currencyView, tc])

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

  // Helper: renderizar celda multi-moneda.
  // - Si solo MXN > 0: mostrar solo MXN
  // - Si solo USD > 0: mostrar solo USD
  // - Si ambos > 0: mostrar las 2 líneas (MXN arriba, USD abajo) con el total
  //   convertido a la moneda del toggle como sub-info
  // - Si todo es 0: mostrar zero string ('$0.00') o el zeroLabel (ej '✓', '—')
  function renderDualCurrency(
    mxn: number,
    usd: number,
    convertFn: (a: number, c: string) => number,
    currView: 'MXN' | 'USD',
    color: string,
    zeroLabel?: string,
  ) {
    const hasMXN = mxn > 0.01
    const hasUSD = usd > 0.01
    if (!hasMXN && !hasUSD) {
      return <span style={{ color: '#666' }}>{zeroLabel || fmt(0)}</span>
    }
    if (hasMXN && hasUSD) {
      const totalToggle = convertFn(mxn, 'MXN') + convertFn(usd, 'USD')
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <span style={{ color, fontWeight: 600, fontSize: 11 }}>{F(mxn)} <span style={{ fontSize: 9, color: '#888' }}>MXN</span></span>
          <span style={{ color, fontWeight: 600, fontSize: 11 }}>{F(usd)} <span style={{ fontSize: 9, color: '#888' }}>USD</span></span>
          <span style={{ fontSize: 9, color: '#555', borderTop: '1px solid #2a2a2a', paddingTop: 2, marginTop: 1 }}>
            ≈ {fmt(totalToggle)}
          </span>
        </div>
      )
    }
    // Solo una moneda
    const value = hasMXN ? mxn : usd
    const nativeCur = hasMXN ? 'MXN' : 'USD'
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <span style={{ color, fontWeight: 600 }}>{F(value)} <span style={{ fontSize: 9, color: '#888' }}>{nativeCur}</span></span>
      </div>
    )
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
              background: currencyView === m ? (m === 'MXN' ? '#D9770622' : '#2563EB22') : 'transparent',
              color: currencyView === m ? (m === 'MXN' ? '#D97706' : '#2563EB') : '#666',
              border: currencyView === m ? `1px solid ${m === 'MXN' ? '#D97706' : '#2563EB'}` : '1px solid transparent',
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
                            background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#D97706',
                          }}>⚠ MXN+USD</span>
                        )}
                      </div>
                      {r.leadCompany && <div style={{ fontSize: 10, color: '#666' }}>{r.leadCompany}</div>}
                    </Td>
                    <Td right>{renderDualCurrency(r.vendidoMXN, r.vendidoUSD, convert, currencyView, '#ccc')}</Td>
                    <Td right>{renderDualCurrency(r.cobradoMXN, r.cobradoUSD, convert, currencyView, '#10B981')}</Td>
                    <Td right>{renderDualCurrency(r.porCobrarMXN, r.porCobrarUSD, convert, currencyView, r.porCobrarMXN + r.porCobrarUSD > 0 ? '#D97706' : '#666', '✓')}</Td>
                    <Td right>{renderDualCurrency(r.pagadoTotalMXN, r.pagadoTotalUSD, convert, currencyView, '#DC2626')}</Td>
                    <Td right>{renderDualCurrency(r.pagadoComprasMXN, r.pagadoComprasUSD, convert, currencyView, '#DC2626')}</Td>
                    <Td right>{renderDualCurrency(r.porPagarComprasMXN, r.porPagarComprasUSD, convert, currencyView, r.porPagarComprasMXN + r.porPagarComprasUSD > 0 ? '#D97706' : '#666', '—')}</Td>
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
                                <td style={{ padding: '4px 6px', textAlign: 'right' }}>Total final</td>
                                <td style={{ padding: '4px 6px' }}></td>
                              </tr>
                            </thead>
                            <tbody>
                              {r.cotsLead.map((q: any) => {
                                // q.total ya es el total final con descuento e IVA aplicados.
                                const finalAmount = Number(q.total) || 0
                                return (
                                <tr key={q.id} style={{ borderTop: '1px solid #1a1a1a' }}
                                  onClick={(e) => { e.stopPropagation(); navigate(`/cotizaciones`) }}
                                  onMouseEnter={e => (e.currentTarget.style.background = '#111')}
                                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                >
                                  <td style={{ padding: '6px', color: '#ddd', cursor: 'pointer' }}>{q.name}</td>
                                  <td style={{ padding: '6px', color: '#888' }}>
                                    {q.specialty}
                                    <span style={{ marginLeft: 6, fontSize: 9, color: q.currency === 'USD' ? '#2563EB' : '#D97706' }}>
                                      {q.currency || 'MXN'}
                                    </span>
                                  </td>
                                  <td style={{ padding: '6px', textAlign: 'right', color: '#fff', fontWeight: 600 }}>{fmt(convert(finalAmount, q.currency || 'MXN'))}</td>
                                  <td style={{ padding: '6px', textAlign: 'right' }}>
                                    <button onClick={(e) => { e.stopPropagation(); navigate(`/crm/${r.leadId}`) }}
                                      style={{ background: 'transparent', border: '1px solid #333', borderRadius: 4, padding: '2px 8px', color: '#888', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
                                      CRM →
                                    </button>
                                  </td>
                                </tr>
                                )
                              })}
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
                <Td right><span style={{ fontWeight: 700, color: '#10B981' }}>{fmt(totals.cobrado)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: totals.por_cobrar > 0 ? '#D97706' : '#666' }}>{fmt(totals.por_cobrar)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: '#DC2626' }}>{fmt(totals.pagado_total)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: '#DC2626' }}>{fmt(totals.pagado_compras)}</span></Td>
                <Td right><span style={{ fontWeight: 700, color: totals.por_pagar_compras > 0 ? '#D97706' : '#666' }}>{fmt(totals.por_pagar_compras)}</span></Td>
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
