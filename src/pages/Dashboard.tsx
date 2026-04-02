import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Project, PaymentMilestone, WorkReport } from '../types'
import { F, STATUS_CONFIG, formatDate } from '../lib/utils'
import { KpiCard, Table, Th, Td, ProgressBar, Badge, Loading, SectionHeader } from '../layout/UI'
import { FolderOpen, DollarSign, AlertTriangle, Users } from 'lucide-react'

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [milestones, setMilestones] = useState<PaymentMilestone[]>([])
  const [reports, setReports] = useState<WorkReport[]>([])
  const [empCount, setEmpCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: ps }, { data: ms }, { data: rs }, { count }] = await Promise.all([
        supabase.from('projects').select('*').eq('status', 'activo').order('created_at', { ascending: false }),
        supabase.from('payment_milestones').select('*, project:projects(name)').in('status', ['pendiente', 'vencido']).order('due_date'),
        supabase.from('work_reports').select('*, project:projects(name), employee:employees(name)').order('report_date', { ascending: false }).limit(8),
        supabase.from('employees').select('*', { count: 'exact', head: true }).eq('is_active', true),
      ])
      setProjects(ps || [])
      setMilestones(ms || [])
      setReports(rs || [])
      setEmpCount(count || 0)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <Loading />

  const pipeline = projects.reduce((s, p) => s + p.contract_value, 0)
  const vencidos = milestones.filter(m => m.status === 'vencido')
  const pendientes = milestones.filter(m => m.status === 'pendiente')

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200 }}>
      <SectionHeader title="Dashboard" subtitle="Vista ejecutiva — OMM Technologies" />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Proyectos activos" value={projects.length} icon={<FolderOpen size={16} />} />
        <KpiCard label="Pipeline total" value={F(pipeline)} color="#3B82F6" icon={<DollarSign size={16} />} />
        <KpiCard label="Cobros vencidos" value={vencidos.length} color={vencidos.length > 0 ? '#EF4444' : '#57FF9A'} icon={<AlertTriangle size={16} />} />
        <KpiCard label="Empleados activos" value={empCount} color="#C084FC" icon={<Users size={16} />} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Proyectos activos */}
        <div>
          <SectionHeader title="Proyectos activos" />
          <Table>
            <thead>
              <tr>
                <Th>Proyecto</Th>
                <Th>Cliente</Th>
                <Th>Avance</Th>
                <Th>Estado</Th>
                <Th right>Contrato</Th>
              </tr>
            </thead>
            <tbody>
              {projects.length === 0 && (
                <tr><Td colSpan={5} muted style={{ textAlign: 'center' }}>Sin proyectos activos</Td></tr>
              )}
              {projects.map(p => {
                const cfg = STATUS_CONFIG[p.status]
                return (
                  <tr key={p.id}>
                    <Td><span style={{ fontWeight: 500, color: '#fff' }}>{p.name}</span></Td>
                    <Td muted>{p.client_name}</Td>
                    <Td><ProgressBar pct={p.advance_pct} /></Td>
                    <Td><Badge label={cfg.label} color={cfg.color} /></Td>
                    <Td right>{F(p.contract_value)}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </div>

        {/* Cobranza pendiente */}
        <div>
          <SectionHeader title="Cobranza pendiente" />
          <Table>
            <thead>
              <tr>
                <Th>Hito</Th>
                <Th>Proyecto</Th>
                <Th>Vence</Th>
                <Th right>Monto</Th>
              </tr>
            </thead>
            <tbody>
              {milestones.length === 0 && (
                <tr><Td colSpan={4} muted style={{ textAlign: 'center' }}>Sin cobros pendientes</Td></tr>
              )}
              {milestones.slice(0, 6).map(m => (
                <tr key={m.id}>
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {m.status === 'vencido' && <span style={{ color: '#EF4444', fontSize: 14 }}>⚠</span>}
                      <span style={{ fontWeight: 500, color: m.status === 'vencido' ? '#EF4444' : '#ccc' }}>
                        {m.name}
                      </span>
                    </div>
                  </Td>
                  <Td muted>{(m.project as any)?.name || '—'}</Td>
                  <Td muted>{m.due_date ? formatDate(m.due_date) : '—'}</Td>
                  <Td right style={{ color: '#57FF9A', fontWeight: 600 }}>{F(m.amount)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>

      {/* Reportes recientes */}
      <div>
        <SectionHeader title="Reportes de obra recientes" />
        <Table>
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Proyecto</Th>
              <Th>Instalador</Th>
              <Th>Check-in</Th>
              <Th>Reporte</Th>
            </tr>
          </thead>
          <tbody>
            {reports.length === 0 && (
              <tr><Td colSpan={5} muted style={{ textAlign: 'center' }}>Sin reportes</Td></tr>
            )}
            {reports.map(r => (
              <tr key={r.id}>
                <Td muted>{formatDate(r.report_date)}</Td>
                <Td><span style={{ fontWeight: 500, color: '#fff' }}>{(r.project as any)?.name || '—'}</span></Td>
                <Td muted>{(r.employee as any)?.name || '—'}</Td>
                <Td>
                  <span style={{ color: r.check_in_time ? '#57FF9A' : '#555', fontSize: 11 }}>
                    {r.check_in_time ? '✓ ' + new Date(r.check_in_time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                </Td>
                <Td muted style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.raw_text || '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  )
}
