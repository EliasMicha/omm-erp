// ââ REPORTES DE OBRA âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { WorkReport, PayrollPeriod, PayrollItem, Delivery } from '../types'
import { F, PAYROLL_STATUS_CONFIG, DELIVERY_STATUS_CONFIG, formatDate } from '../lib/utils'
import { Badge, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../components/layout/UI'

export function Reportes() {
  const [reports, setReports] = useState<WorkReport[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('work_reports')
      .select('*, project:projects(name), employee:employees(name)')
      .order('report_date', { ascending: false })
      .then(({ data }) => { setReports(data || []); setLoading(false) })
  }, [])

  return (
    <div style={{ padding: '24px 28px' }}>
      <SectionHeader title="Reportes de obra" subtitle="Reportes diarios de los instaladores" />
      {loading ? <Loading /> : reports.length === 0 ? <EmptyState message="Sin reportes aÃºn" /> : (
        <Table>
          <thead>
            <tr>
              <Th>Fecha</Th><Th>Proyecto</Th><Th>Instalador</Th><Th>Check-in</Th><Th>Check-out</Th><Th>Reporte</Th>
            </tr>
          </thead>
          <tbody>
            {reports.map(r => (
              <>
                <tr key={r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
                  <Td muted>{formatDate(r.report_date)}</Td>
                  <Td><span style={{ fontWeight: 500, color: '#fff' }}>{(r.project as any)?.name || 'â'}</span></Td>
                  <Td muted>{(r.employee as any)?.name || 'â'}</Td>
                  <Td>
                    <span style={{ color: r.check_in_time ? '#57FF9A' : '#444', fontSize: 11 }}>
                      {r.check_in_time ? 'â ' + new Date(r.check_in_time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : 'â'}
                    </span>
                  </Td>
                  <Td>
                    <span style={{ color: r.check_out_time ? '#57FF9A' : '#444', fontSize: 11 }}>
                      {r.check_out_time ? 'â ' + new Date(r.check_out_time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : 'â'}
                    </span>
                  </Td>
                  <Td muted style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded === r.id ? 'normal' : 'nowrap' }}>
                    {r.raw_text || 'â'}
                  </Td>
                </tr>
              </>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

// ââ NÃMINA ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
export function Nomina() {
  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [items, setItems] = useState<PayrollItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('payroll_periods').select('*').order('period_start', { ascending: false })
      .then(({ data }) => { setPeriods(data || []); setLoading(false) })
  }, [])

  useEffect(() => {
    if (!selected) return
    supabase.from('payroll_items').select('*, employee:employees(name, role)')
      .eq('period_id', selected)
      .order('net_total', { ascending: false })
      .then(({ data }) => setItems(data || []))
  }, [selected])

  const period = periods.find(p => p.id === selected)
  const totalFiscal = items.reduce((s, i) => s + i.fiscal_amount, 0)
  const totalCash = items.reduce((s, i) => s + i.cash_amount, 0)
  const totalNet = items.reduce((s, i) => s + i.net_total, 0)

  return (
    <div style={{ padding: '24px 28px', display: 'grid', gridTemplateColumns: selected ? '220px 1fr' : '1fr', gap: 20 }}>
      {/* Lista de periodos */}
      <div>
        <SectionHeader title="NÃ³mina" subtitle="PerÃ­odos de pago" />
        {loading ? <Loading /> : periods.length === 0 ? <EmptyState message="Sin perÃ­odos de nÃ³mina" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {periods.map(p => {
              const cfg = PAYROLL_STATUS_CONFIG[p.status]
              const on = p.id === selected
              return (
                <div key={p.id} onClick={() => setSelected(p.id)} style={{
                  background: on ? '#1e1e1e' : '#141414', border: `1px solid ${on ? '#333' : '#222'}`,
                  borderRadius: 10, padding: '12px 14px', cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>
                      {formatDate(p.period_start)} â {formatDate(p.period_end)}
                    </span>
                    <Badge label={cfg.label} color={cfg.color} />
                  </div>
                  <div style={{ fontSize: 11, color: '#555' }}>{p.frequency === 'quincenal' ? 'Quincenal' : 'Semanal'}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#57FF9A', marginTop: 4 }}>{F(p.total_fiscal + p.total_cash)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Detalle del perÃ­odo */}
      {selected && period && (
        <div>
          <SectionHeader title={`${formatDate(period.period_start)} â ${formatDate(period.period_end)}`} subtitle={`${items.length} empleados`} />
          <Table>
            <thead>
              <tr>
                <Th>Empleado</Th><Th>Puesto</Th><Th right>Fiscal</Th><Th right>Efectivo</Th><Th right>Bono puntualidad</Th><Th right>Deducciones</Th><Th right>Neto total</Th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={7}><EmptyState message="Sin items en este perÃ­odo" /></td></tr>}
              {items.map(i => {
                const emp = i.employee as any
                return (
                  <tr key={i.id}>
                    <Td><span style={{ fontWeight: 500, color: '#fff' }}>{emp?.name || 'â'}</span></Td>
                    <Td muted style={{ textTransform: 'capitalize' }}>{emp?.role || 'â'}</Td>
                    <Td right>{F(i.fiscal_amount)}</Td>
                    <Td right>{F(i.cash_amount)}</Td>
                    <Td right style={{ color: '#57FF9A' }}>{F(i.punctuality_bonus)}</Td>
                    <Td right style={{ color: '#EF4444' }}>-{F(i.deductions)}</Td>
                    <Td right><span style={{ fontWeight: 700, color: '#fff' }}>{F(i.net_total)}</span></Td>
                  </tr>
                )
              })}
              {items.length > 0 && (
                <tr style={{ background: '#1a1a1a' }}>
                  <td colSpan={2} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#666' }}>TOTALES</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#fff' }}>{F(totalFiscal)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#fff' }}>{F(totalCash)}</td>
                  <td colSpan={2}></td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#57FF9A' }}>{F(totalNet)}</td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  )
}

// ââ ENTREGAS âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
export function Entregas() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('deliveries')
      .select('*, project:projects(name), driver:employees(name)')
      .order('delivery_date', { ascending: false })
      .then(({ data }) => { setDeliveries(data || []); setLoading(false) })
  }, [])

  async function toggleSign(id: string, field: 'signed_gabriel' | 'signed_ivan' | 'signed_installer', current: boolean) {
    const now = new Date().toISOString()
    const update: any = { [field]: !current }
    if (!current) {
      if (field === 'signed_gabriel') update.signed_gabriel_at = now
      if (field === 'signed_ivan') update.signed_ivan_at = now
      if (field === 'signed_installer') update.signed_installer_at = now
    }
    await supabase.from('deliveries').update(update).eq('id', id)
    setDeliveries(prev => prev.map(d => d.id === id ? { ...d, ...update } : d))
  }

  const SignBox = ({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) => (
    <button onClick={onClick} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
      border: `1px solid ${active ? '#57FF9A' : '#333'}`,
      background: active ? '#57FF9A22' : 'transparent',
    }}>
      <span style={{ fontSize: 14, color: active ? '#57FF9A' : '#444' }}>{active ? 'â' : 'â'}</span>
      <span style={{ fontSize: 9, color: active ? '#57FF9A' : '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
    </button>
  )

  return (
    <div style={{ padding: '24px 28px' }}>
      <SectionHeader title="Entregas y recolecciones" subtitle="Cadena de custodia con 3 firmas" />
      {loading ? <Loading /> : deliveries.length === 0 ? <EmptyState message="Sin entregas registradas" /> : (
        <Table>
          <thead>
            <tr>
              <Th>Fecha</Th><Th>Tipo</Th><Th>Origen - Destino</Th><Th>Material</Th><Th>Proyecto</Th><Th>Chofer</Th><Th>Estado</Th><Th>Firmas</Th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map(d => {
              const cfg = DELIVERY_STATUS_CONFIG[d.status]
              return (
                <tr key={d.id}>
                  <Td muted>{formatDate(d.delivery_date)}</Td>
                  <Td><Badge label={d.type} color={d.type === 'entrega' ? '#57FF9A' : '#3B82F6'} /></Td>
                  <Td>
                    <span style={{ color: '#fff', fontWeight: 500 }}>{d.origin}</span>
                    <span style={{ color: '#444', margin: '0 4px' }}>-&gt;</span>
                    <span style={{ color: '#aaa' }}>{d.destination}</span>
                  </Td>
                  <Td muted style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.material_description || 'â'}
                  </Td>
                  <Td muted>{(d.project as any)?.name || 'â'}</Td>
                  <Td muted>{(d.driver as any)?.name || 'â'}</Td>
                  <Td><Badge label={cfg.label} color={cfg.color} /></Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <SignBox active={d.signed_gabriel} label="Gabriel" onClick={() => toggleSign(d.id, 'signed_gabriel', d.signed_gabriel)} />
                      <SignBox active={d.signed_ivan} label="IvÃ¡n" onClick={() => toggleSign(d.id, 'signed_ivan', d.signed_ivan)} />
                      <SignBox active={d.signed_installer} label="Inst." onClick={() => toggleSign(d.id, 'signed_installer', d.signed_installer)} />
                    </div>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}
