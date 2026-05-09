import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Project, PaymentMilestone, WorkReport } from '../types'
import { F, STATUS_CONFIG, STAGE_CONFIG, formatDate } from '../lib/utils'
import { KpiCard, Table, Th, Td, ProgressBar, Badge, Loading, SectionHeader } from '../components/layout/UI'
import { useIsMobile } from '../lib/useIsMobile'
import { useAuth } from '../contexts/AuthContext'
import { FolderOpen, DollarSign, AlertTriangle, Users, FileText, TrendingUp } from 'lucide-react'
import DashboardProduccion from './DashboardProduccion'
import DashboardVentasIng from './DashboardVentasIng'

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
  // After early returns above, area is DG or Administracion
  const isFinancial = area === 'DG' || area === 'Administracion'

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
    </div>
  )
}
