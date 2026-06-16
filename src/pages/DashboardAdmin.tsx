import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { F, formatDate } from '../lib/utils'
import { KpiCard, ProgressBar, Badge, Loading, SectionHeader } from '../components/layout/UI'
import { useIsMobile } from '../lib/useIsMobile'
import { useAuth } from '../contexts/AuthContext'
import {
  AlertTriangle, Calendar, DollarSign, Users, FolderOpen, FileText, Clock,
  Target, ChevronDown, ChevronRight, TrendingUp, CreditCard, Briefcase,
  CheckCircle2, Receipt, ArrowDownCircle, ArrowUpCircle, BarChart3, Bell
} from 'lucide-react'
import ActionItems from '../components/ActionItems'
import CalendarWidget from '../components/CalendarWidget'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface Factura {
  id: string
  direccion: string   // emitida | recibida
  emisor_nombre: string | null
  emisor_rfc: string | null
  receptor_nombre: string | null
  receptor_rfc: string | null
  total: number
  moneda: string
  fecha_emision: string | null
  status: string
  estado: string | null
  conciliada: boolean
  project_id: string | null
  created_at: string
  folio: string | null
  serie: string | null
}

interface PaymentMilestone {
  id: string
  name: string
  amount: number
  due_date: string | null
  status: string
  project_name: string
  client_name: string
}

interface Project {
  id: string
  name: string
  client_name: string
  contract_value: number
  advance_pct: number
  specialty: string
}

interface Employee {
  id: string
  name: string
  nombre: string | null
  area: string | null
  puesto: string | null
}

interface Conciliacion {
  id: string
  mes: string
  ingresos_banco: number
  ingresos_sistema: number
  egresos_banco: number
  egresos_sistema: number
  diferencia: number
  status: string
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const card: React.CSSProperties = {
  background: '#111', border: '1px solid #222', borderRadius: 10, padding: '10px 14px',
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function DashboardAdmin() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const myEmployeeId = authUser?.employee_id

  const [loading, setLoading] = useState(true)
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [milestones, setMilestones] = useState<PaymentMilestone[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [adminTeam, setAdminTeam] = useState<Employee[]>([])
  const [conciliaciones, setConciliaciones] = useState<Conciliacion[]>([])
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    facturacion: true, pendientes: true, calendario: true,
    cobranza: true, recibidas: true, conciliacion: true,
    proyectos: true, equipo: false,
  })

  const toggle = (key: string) => setExpandedSections(p => ({ ...p, [key]: !p[key] }))

  // ── LOAD DATA ──
  useEffect(() => {
    async function load() {
      const [facRes, milRes, projRes, empRes, concRes] = await Promise.all([
        supabase.from('facturas')
          .select('id, direccion, emisor_nombre, emisor_rfc, receptor_nombre, receptor_rfc, total, moneda, fecha_emision, status, estado, conciliada, project_id, created_at, folio, serie')
          .in('status', ['timbrada', 'borrador', 'pendiente'])
          .order('fecha_emision', { ascending: false }),
        supabase.from('payment_milestones')
          .select('id, name, amount, due_date, status, project:projects(name, client_name)')
          .in('status', ['pendiente', 'vencido'])
          .order('due_date', { ascending: true, nullsFirst: false }),
        supabase.from('projects')
          .select('id, name, client_name, contract_value, advance_pct, specialty')
          .eq('status', 'activo')
          .order('contract_value', { ascending: false }),
        supabase.from('employees')
          .select('id, name, nombre, area, puesto')
          .eq('is_active', true)
          .order('area'),
        supabase.from('conciliacion_mensual')
          .select('*')
          .order('mes', { ascending: false })
          .limit(6),
      ])

      setFacturas((facRes.data || []) as Factura[])
      setMilestones((milRes.data || []).map((m: any) => ({
        ...m,
        project_name: m.project?.name || '',
        client_name: m.project?.client_name || '',
      })) as PaymentMilestone[])
      setProjects((projRes.data || []) as Project[])
      const allEmp = (empRes.data || []) as Employee[]
      setEmployees(allEmp)
      setAdminTeam(allEmp.filter(e => e.area === 'ADMINISTRACION'))
      setConciliaciones((concRes.data || []) as Conciliacion[])
      setLoading(false)
    }
    load()
  }, [])

  // ── COMPUTED ──
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7)
  const nowStr = now.toISOString().slice(0, 10)

  // Facturas emitidas
  const emitidas = useMemo(() => facturas.filter(f => f.direccion === 'emitida'), [facturas])
  const emitidasMes = useMemo(() => emitidas.filter(f => f.fecha_emision && f.fecha_emision >= monthStart), [emitidas, monthStart])
  const totalEmitidoMes = useMemo(() => emitidasMes.reduce((s, f) => s + f.total, 0), [emitidasMes])

  // Facturas recibidas
  const recibidas = useMemo(() => facturas.filter(f => f.direccion === 'recibida'), [facturas])
  const recibidasMes = useMemo(() => recibidas.filter(f => f.created_at >= monthStart), [recibidas, monthStart])
  const totalRecibidoMes = useMemo(() => recibidasMes.reduce((s, f) => s + f.total, 0), [recibidasMes])
  const recibidasRecientes = useMemo(() => recibidas.slice(0, 15), [recibidas])

  // Conciliación
  const sinConciliar = useMemo(() => recibidas.filter(f => !f.conciliada).length, [recibidas])
  const conciliadasCount = useMemo(() => recibidas.filter(f => f.conciliada).length, [recibidas])
  const conciliacionPct = useMemo(() => {
    const total = recibidas.length
    return total > 0 ? Math.round((conciliadasCount / total) * 100) : 100
  }, [recibidas, conciliadasCount])

  // Cobranza
  const cobranzaVencida = useMemo(() => milestones.filter(m => m.status === 'vencido'), [milestones])
  const totalPorCobrar = useMemo(() => milestones.reduce((s, m) => s + m.amount, 0), [milestones])
  const totalVencido = useMemo(() => cobranzaVencida.reduce((s, m) => s + m.amount, 0), [cobranzaVencida])

  // Project billing
  const projectBilling = useMemo(() => {
    return projects.map(p => {
      const pFacturas = emitidas.filter(f => f.project_id === p.id)
      const facturado = pFacturas.reduce((s, f) => s + f.total, 0)
      const pctFacturado = p.contract_value > 0 ? Math.round((facturado / p.contract_value) * 100) : 0
      const pMilestones = milestones.filter(m => m.project_name === p.name)
      const pendienteCobro = pMilestones.reduce((s, m) => s + m.amount, 0)
      return { project: p, facturado, pctFacturado, pendienteCobro, facturaCount: pFacturas.length }
    })
  }, [projects, emitidas, milestones])

  // Area counts
  const areaCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    employees.forEach(e => { counts[e.area || 'Sin área'] = (counts[e.area || 'Sin área'] || 0) + 1 })
    return Object.entries(counts).map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count)
  }, [employees])

  if (loading) return <Loading />

  const mesLabel = now.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px', maxWidth: 1350 }}>
      <SectionHeader
        title="Panel Administrativo"
        subtitle={`${mesLabel} · ${employees.length} empleados · ${projects.length} proyectos activos`}
      />

      {/* ── KPI ROW ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(6,1fr)', gap: 10, marginBottom: 20 }}>
        <KpiCard label="Emitido este mes" value={F(totalEmitidoMes)} color="#2563EB" icon={<ArrowUpCircle size={16} />} />
        <KpiCard label={`Recibidas (${recibidasMes.length})`} value={F(totalRecibidoMes)} color="#D97706" icon={<ArrowDownCircle size={16} />} />
        <KpiCard label="Conciliación" value={`${conciliacionPct}%`} color={conciliacionPct < 50 ? '#DC2626' : conciliacionPct < 80 ? '#D97706' : '#10B981'} icon={<BarChart3 size={16} />} />
        <KpiCard label="Sin conciliar" value={sinConciliar} color={sinConciliar > 50 ? '#DC2626' : '#D97706'} icon={<AlertTriangle size={16} />} />
        <KpiCard label="Por cobrar" value={F(totalPorCobrar)} color="#A78BFA" icon={<DollarSign size={16} />} />
        <KpiCard label="Cobros vencidos" value={F(totalVencido)} color={totalVencido > 0 ? '#DC2626' : '#10B981'} icon={<Clock size={16} />} />
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 1: Facturación + Cobranza (60%) | Pendientes + Cal (40%)
         ══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 20, marginBottom: 20 }}>
        {/* LEFT — Facturación + Cobranza stacked */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Facturas Recibidas Recientes */}
          <div>
            <CollapsibleHeader
              title="Facturas Recibidas"
              count={recibidasMes.length}
              icon={<Receipt size={15} />}
              expanded={expandedSections.recibidas}
              onToggle={() => toggle('recibidas')}
              extra={
                recibidasMes.length > 0
                  ? <span style={{ fontSize: 11, color: '#D97706', display: 'flex', alignItems: 'center', gap: 4 }}><Bell size={11} /> {recibidasMes.length} nuevas este mes</span>
                  : undefined
              }
            />
            {expandedSections.recibidas && (
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {recibidasRecientes.length === 0 ? (
                  <EmptyState text="Sin facturas recibidas" />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {recibidasRecientes.map(f => {
                      const isNew = f.created_at >= monthStart
                      return (
                        <div key={f.id} style={{
                          ...card, padding: '8px 12px',
                          borderLeft: `3px solid ${f.conciliada ? '#10B981' : isNew ? '#D97706' : '#333'}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {shortenName(f.emisor_nombre || 'Sin emisor')}
                              </div>
                              <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>
                                {f.emisor_rfc}
                                {f.folio && <span> · Folio {f.folio}</span>}
                                {f.fecha_emision && <span> · {formatDate(f.fecha_emision)}</span>}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>
                                {F(f.total)} <span style={{ fontSize: 9, color: '#555' }}>{f.moneda}</span>
                              </div>
                              <div style={{ marginTop: 2 }}>
                                {f.conciliada
                                  ? <Badge label="Conciliada" color="#10B981" />
                                  : <Badge label="Pendiente" color="#D97706" />
                                }
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cobranza */}
          <div>
            <CollapsibleHeader
              title="Cobranza Pendiente"
              count={milestones.length}
              icon={<CreditCard size={15} />}
              expanded={expandedSections.cobranza}
              onToggle={() => toggle('cobranza')}
              extra={cobranzaVencida.length > 0 ? <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>{cobranzaVencida.length} vencido{cobranzaVencida.length > 1 ? 's' : ''}</span> : undefined}
            />
            {expandedSections.cobranza && (
              <div style={{ maxHeight: 250, overflowY: 'auto' }}>
                {milestones.length === 0 ? (
                  <EmptyState text="Sin cobros pendientes" />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {milestones.map(m => {
                      const isOverdue = m.status === 'vencido'
                      return (
                        <div key={m.id} style={{
                          ...card, padding: '8px 12px',
                          borderLeft: `3px solid ${isOverdue ? '#DC2626' : '#333'}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, color: isOverdue ? '#DC2626' : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {m.name}
                              </div>
                              <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>
                                {m.project_name} · {m.client_name}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#10B981' }}>{F(m.amount)}</div>
                              <div style={{ fontSize: 10, color: isOverdue ? '#DC2626' : '#666', marginTop: 1 }}>
                                {m.due_date ? formatDate(m.due_date) : 'Sin fecha'}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Pendientes + Calendario */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <ActionItems
              myEmployeeId={myEmployeeId!}
              myArea="ADMINISTRACION"
              teamEmployees={adminTeam}
              projects={projects.map(p => ({ id: p.id, name: p.name }))}
              userEmail={authUser?.email || ''}
              isMobile={isMobile}
            />
          </div>
          <div>
            <CollapsibleHeader title="Calendario" icon={<Calendar size={15} />} expanded={expandedSections.calendario !== false} onToggle={() => toggle('calendario')} />
            {expandedSections.calendario !== false && (
              <div style={{ background: '#111', border: '1px solid #222', borderRadius: 12, padding: '12px 16px', maxHeight: 250, overflowY: 'auto' }}>
                <CalendarWidget userEmail={authUser?.email || ''} isMobile={isMobile} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 2: Facturación por proyecto | Conciliación | Equipo
         ══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr', gap: 20 }}>
        {/* COL 1 — Proyectos facturación */}
        <div>
          <CollapsibleHeader title="Proyectos — Facturación" count={projects.length} icon={<FolderOpen size={15} />} expanded={expandedSections.proyectos} onToggle={() => toggle('proyectos')} />
          {expandedSections.proyectos && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 350, overflowY: 'auto' }}>
              {projectBilling.length === 0 && <EmptyState text="Sin proyectos activos" />}
              {projectBilling.map(pb => (
                <div key={pb.project.id} onClick={() => navigate('/proyectos')} style={{
                  ...card, cursor: 'pointer', transition: 'border-color 0.15s',
                }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#444'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#222'}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {pb.project.name}
                      </div>
                      <div style={{ fontSize: 10, color: '#666' }}>{pb.project.client_name}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{F(pb.project.contract_value)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <div style={{ flex: 1 }}><ProgressBar pct={pb.pctFacturado} /></div>
                    <span style={{ fontSize: 10, color: '#888', flexShrink: 0 }}>{pb.pctFacturado}%</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
                    <span style={{ color: '#10B981' }}>Fact: {F(pb.facturado)}</span>
                    {pb.pendienteCobro > 0 && <span style={{ color: '#D97706' }}>Cobro: {F(pb.pendienteCobro)}</span>}
                    {pb.facturaCount === 0 && <span style={{ color: '#444' }}>Sin facturas</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* COL 2 — Conciliación Bancaria */}
        <div>
          <CollapsibleHeader title="Conciliación" icon={<BarChart3 size={15} />} expanded={expandedSections.conciliacion} onToggle={() => toggle('conciliacion')} />
          {expandedSections.conciliacion && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Summary card */}
              <div style={{ ...card, borderLeft: `3px solid ${conciliacionPct >= 80 ? '#10B981' : conciliacionPct >= 50 ? '#D97706' : '#DC2626'}` }}>
                <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Facturas recibidas</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 8, background: '#222', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        width: `${conciliacionPct}%`, height: '100%', borderRadius: 4,
                        background: conciliacionPct >= 80 ? '#10B981' : conciliacionPct >= 50 ? '#D97706' : '#DC2626',
                        transition: 'width 0.3s',
                      }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: conciliacionPct >= 80 ? '#10B981' : conciliacionPct >= 50 ? '#D97706' : '#DC2626' }}>
                    {conciliacionPct}%
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: '#10B981' }}><CheckCircle2 size={10} style={{ marginRight: 3, verticalAlign: -1 }} />{conciliadasCount} conciliadas</span>
                  <span style={{ color: '#D97706' }}><AlertTriangle size={10} style={{ marginRight: 3, verticalAlign: -1 }} />{sinConciliar} pendientes</span>
                </div>
              </div>

              {/* Monthly conciliations */}
              {conciliaciones.length > 0 ? (
                conciliaciones.map(c => {
                  const mesDate = new Date(c.mes)
                  const mesName = mesDate.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' })
                  const statusColor = c.status === 'conciliado' ? '#10B981' : c.status === 'en_proceso' ? '#D97706' : '#DC2626'
                  return (
                    <div key={c.id} style={{ ...card, borderLeft: `3px solid ${statusColor}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', textTransform: 'capitalize' }}>{mesName}</span>
                        <Badge label={c.status === 'conciliado' ? 'OK' : c.status === 'en_proceso' ? 'En proceso' : 'Pendiente'} color={statusColor} />
                      </div>
                      {c.diferencia !== 0 && (
                        <div style={{ fontSize: 11, color: '#DC2626' }}>Diferencia: {F(c.diferencia)}</div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div style={{ ...card, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#444', padding: 12 }}>
                    Sin registros de conciliación mensual.
                    La conciliación de facturas individuales está al {conciliacionPct}%.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* COL 3 — Equipo por área */}
        <div>
          <CollapsibleHeader title="Equipo" count={employees.length} icon={<Users size={15} />} expanded={expandedSections.equipo} onToggle={() => toggle('equipo')} />
          {expandedSections.equipo && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 350, overflowY: 'auto' }}>
              {areaCounts.map(ac => {
                const pct = employees.length > 0 ? Math.round((ac.count / employees.length) * 100) : 0
                const areaColors: Record<string, string> = {
                  'ELECTRICO': '#2563EB', 'INSTALACIONES ESPECIALES': '#8B5CF6',
                  'INGENIERIAS ESPECIALES': '#A78BFA', 'ADMINISTRACION': '#10B981',
                  'ILUMINACION': '#D97706', 'INGENIERIAS ELECTRICAS': '#06B6D4',
                }
                const color = areaColors[ac.area] || '#888'
                return (
                  <div key={ac.area} onClick={() => navigate('/empleados')} style={{
                    ...card, cursor: 'pointer', borderLeft: `3px solid ${color}`, transition: 'border-color 0.15s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#444'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = '#222'}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#fff' }}>
                        {ac.area.charAt(0) + ac.area.slice(1).toLowerCase()}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color }}>{ac.count}</span>
                    </div>
                    <div style={{ height: 4, background: '#222', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
                    </div>
                  </div>
                )
              })}
              <div style={{ ...card, background: '#0d0d0d', borderTop: '1px solid #333', marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#888' }}>Total</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{employees.length}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/** Shorten long fiscal names like "BBVA MEXICO, S.A., INSTITUCION DE BANCA..." */
function shortenName(name: string): string {
  if (name.length <= 40) return name
  // Try to cut at first comma or S.A.
  const commaIdx = name.indexOf(',')
  if (commaIdx > 10 && commaIdx < 45) return name.slice(0, commaIdx)
  return name.slice(0, 38) + '…'
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

function CollapsibleHeader({ title, count, icon, expanded, onToggle, extra, color }: {
  title: string; count?: number; icon?: React.ReactNode; expanded: boolean; onToggle: () => void; extra?: React.ReactNode; color?: string
}) {
  return (
    <div onClick={onToggle} style={{
      display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 0', marginBottom: 8,
      userSelect: 'none',
    }}>
      {expanded ? <ChevronDown size={14} color="#666" /> : <ChevronRight size={14} color="#666" />}
      {icon}
      <span style={{ fontSize: 15, fontWeight: 700, color: color || '#fff' }}>{title}</span>
      {count !== undefined && <span style={{ fontSize: 12, color: '#555', fontWeight: 400 }}>({count})</span>}
      {extra && <span style={{ marginLeft: 'auto' }}>{extra}</span>}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: 20, color: '#444', fontSize: 13, textAlign: 'center' }}>{text}</div>
}
