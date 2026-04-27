import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { F } from '../lib/utils'
import { Btn, Table, Th, Td, Loading, KpiCard, SectionHeader, EmptyState, Badge } from '../components/layout/UI'
import { Users2, Calendar, Receipt, ClipboardList, BarChart3, Plus, Search } from 'lucide-react'
import TabCajaChica from './nomina/TabCajaChica'
import TabAsistencia from './nomina/TabAsistencia'
import TabReportes from './nomina/TabReportes'
import TabAusencias from './nomina/TabAusencias'
import TabPeriodos from './nomina/TabPeriodos'

type TipoAlta = 'SEMANAL' | 'QUINCENAL'

/** Count how many Fridays (payday) fall in a given month */
function fridaysInMonth(year: number, month: number): number {
  let count = 0
  const d = new Date(year, month, 1)
  while (d.getMonth() === month) {
    if (d.getDay() === 5) count++ // 5 = Friday
    d.setDate(d.getDate() + 1)
  }
  return count
}

/** Calculate real monthly net based on tipo_alta and current month */
function calcNetoMensual(e: { tipo_alta?: string | null; sueldo_neto_semanal?: number | null; sueldo_neto_quincenal?: number | null }): number {
  const now = new Date()
  if (e.tipo_alta === 'SEMANAL') {
    const weeks = fridaysInMonth(now.getFullYear(), now.getMonth())
    return (Number(e.sueldo_neto_semanal) || 0) * weeks
  }
  // Quincenal: always 2 payments per month
  return (Number(e.sueldo_neto_quincenal) || 0) * 2
}

interface Employee {
  id: string
  numero_excel?: number | null
  nombre: string
  rfc?: string | null
  puesto?: string | null
  area?: string | null
  tipo_alta?: TipoAlta | null
  tipo_trabajo?: 'OFICINA' | 'OBRA' | 'MIXTO' | null
  banco?: string | null
  sueldo_neto_semanal?: number | null
  sueldo_neto_quincenal?: number | null
  neto_mensual?: number | null
  estado_empleado?: string | null
  activo?: boolean | null
  foto_url?: string | null
}

type Tab = 'empleados' | 'periodos' | 'caja_chica' | 'asistencia' | 'reportes' | 'ausencias'

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'empleados', label: 'Empleados', icon: Users2 },
  { id: 'periodos', label: 'Períodos', icon: Calendar },
  { id: 'caja_chica', label: 'Caja Chica', icon: Receipt },
  { id: 'asistencia', label: 'Asistencia', icon: ClipboardList },
  { id: 'reportes', label: 'Reportes', icon: BarChart3 },
  { id: 'ausencias', label: 'Ausencias', icon: Calendar },
]

export default function Nomina() {
  const [tab, setTab] = useState<Tab>('empleados')
  return (
    <div style={{ padding: '24px 32px', maxWidth: 1600, margin: '0 auto' }}>
      <SectionHeader title="Nómina" subtitle="Gestión de empleados, periodos de pago, caja chica y asistencia" />
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #1f1f1f', marginBottom: 24 }}>
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: 'none', border: 'none',
                color: active ? '#fff' : '#888',
                padding: '12px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                borderBottom: active ? '2px solid #57FF9A' : '2px solid transparent',
                display: 'flex', alignItems: 'center', gap: 8, transition: 'color 0.15s',
              }}
            >
              <Icon size={15} />
              {t.label}
            </button>
          )
        })}
      </div>
      {tab === 'empleados' && <TabEmpleados />}
      {tab === 'periodos' && <TabPeriodos />}
      {tab === 'caja_chica' && <TabCajaChica />}
      {tab === 'asistencia' && <TabAsistencia />}
      {tab === 'reportes' && <TabReportes />}
      {tab === 'ausencias' && <TabAusencias />}
    </div>
  )
}

function PlaceholderTab({ title }: { title: string }) {
  return (
    <div style={{ padding: 60, textAlign: 'center', color: '#666' }}>
      <div style={{ fontSize: 14 }}>{title} — pendiente de implementar</div>
    </div>
  )
}

function TabEmpleados() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState<TipoAlta | 'TODOS'>('TODOS')
  const [filterTrabajo, setFilterTrabajo] = useState<'OFICINA' | 'OBRA' | 'MIXTO' | 'TODOS'>('TODOS')
  const [filterArea, setFilterArea] = useState<string>('TODAS')

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('employees')
      .select('id,numero_excel,nombre,rfc,puesto,area,tipo_alta,tipo_trabajo,banco,sueldo_neto_semanal,sueldo_neto_quincenal,neto_mensual,estado_empleado,activo,foto_url')
      .eq('activo', true)
      .order('numero_excel', { ascending: true })
    if (error) console.error(error)
    setEmployees((data as Employee[]) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const areas = useMemo(() => {
    const s = new Set<string>()
    employees.forEach(e => { if (e.area) s.add(e.area) })
    return ['TODAS', ...Array.from(s).sort()]
  }, [employees])

  const filtered = useMemo(() => {
    return employees.filter(e => {
      if (filterTipo !== 'TODOS' && e.tipo_alta !== filterTipo) return false
      if (filterTrabajo !== 'TODOS' && e.tipo_trabajo !== filterTrabajo) return false
      if (filterArea !== 'TODAS' && e.area !== filterArea) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = (e.nombre || '').toLowerCase().includes(q)
          || (e.puesto || '').toLowerCase().includes(q)
          || (e.rfc || '').toLowerCase().includes(q)
        if (!hay) return false
      }
      return true
    })
  }, [employees, search, filterTipo, filterTrabajo, filterArea])

  const kpis = useMemo(() => {
    const total = filtered.length
    const semanales = filtered.filter(e => e.tipo_alta === 'SEMANAL').length
    const quincenales = filtered.filter(e => e.tipo_alta === 'QUINCENAL').length
    const totalNetoMensual = filtered.reduce((sum, e) => sum + calcNetoMensual(e), 0)
    // By area
    const byArea: Record<string, { count: number; neto: number }> = {}
    filtered.forEach(e => {
      const a = e.area || 'Sin área'
      if (!byArea[a]) byArea[a] = { count: 0, neto: 0 }
      byArea[a].count++
      byArea[a].neto += calcNetoMensual(e)
    })
    // By tipo_trabajo
    const costoOficina = filtered.filter(e => e.tipo_trabajo === 'OFICINA').reduce((s, e) => s + calcNetoMensual(e), 0)
    const costoObra = filtered.filter(e => e.tipo_trabajo === 'OBRA').reduce((s, e) => s + calcNetoMensual(e), 0)
    const costoMixto = filtered.filter(e => e.tipo_trabajo === 'MIXTO').reduce((s, e) => s + calcNetoMensual(e), 0)
    const promedioMensual = total > 0 ? totalNetoMensual / total : 0
    return { total, semanales, quincenales, totalNetoMensual, byArea, costoOficina, costoObra, costoMixto, promedioMensual }
  }, [filtered])

  const handleCreate = async () => {
    const nombre = prompt('Nombre completo del nuevo empleado:')
    if (!nombre || !nombre.trim()) return
    const { data, error } = await supabase
      .from('employees')
      .insert({ nombre: nombre.trim(), name: nombre.trim(), tipo_alta: 'QUINCENAL', activo: true, estado_empleado: 'activo' })
      .select()
      .single()
    if (error) { alert('Error: ' + error.message); return }
    if (data?.id) window.location.href = `/nomina/empleado/${data.id}`
  }

  return (
    <div>
      {/* Row 1: Main KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 12 }}>
        <KpiCard label="Empleados activos" value={kpis.total.toString()} />
        <KpiCard label="Quincenales" value={kpis.quincenales.toString()} color="#60a5fa" />
        <KpiCard label="Semanales" value={kpis.semanales.toString()} color="#f59e0b" />
        <KpiCard label={`Neto mensual (${new Date().toLocaleString('es-MX',{month:'short'})} · ${fridaysInMonth(new Date().getFullYear(), new Date().getMonth())} viernes)`} value={F(kpis.totalNetoMensual)} />
        <KpiCard label="Promedio mensual / emp" value={F(kpis.promedioMensual)} color="#a78bfa" />
      </div>

      {/* Row 2: Cost by tipo_trabajo + breakdown by area */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 20 }}>
        {/* Oficina / Obra / Mixto split */}
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Costo por tipo de trabajo</div>
          {([
            { label: 'Oficina', value: kpis.costoOficina, color: '#60a5fa' },
            { label: 'Obra', value: kpis.costoObra, color: '#f59e0b' },
            { label: 'Mixto', value: kpis.costoMixto, color: '#a78bfa' },
          ] as const).map(t => (
            <div key={t.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, display: 'inline-block' }} />
                <span style={{ fontSize: 12, color: '#ccc' }}>{t.label}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{F(t.value)}</span>
            </div>
          ))}
          {/* Bar */}
          {kpis.totalNetoMensual > 0 && (
            <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 8, background: '#222' }}>
              <div style={{ width: `${(kpis.costoOficina / kpis.totalNetoMensual) * 100}%`, background: '#60a5fa' }} />
              <div style={{ width: `${(kpis.costoObra / kpis.totalNetoMensual) * 100}%`, background: '#f59e0b' }} />
              <div style={{ width: `${(kpis.costoMixto / kpis.totalNetoMensual) * 100}%`, background: '#a78bfa' }} />
            </div>
          )}
        </div>

        {/* By area */}
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Costo mensual por área</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
            {Object.entries(kpis.byArea)
              .sort((a, b) => b[1].neto - a[1].neto)
              .map(([area, d]) => {
                const pct = kpis.totalNetoMensual > 0 ? (d.neto / kpis.totalNetoMensual) * 100 : 0
                return (
                  <div key={area} style={{ position: 'relative', padding: '8px 10px', borderRadius: 6, overflow: 'hidden', border: '1px solid #1e1e1e' }}>
                    <div style={{ position: 'absolute', inset: 0, background: '#57FF9A', opacity: 0.06, width: `${pct}%` }} />
                    <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div>
                        <span style={{ fontSize: 12, color: '#ccc', fontWeight: 500 }}>{area}</span>
                        <span style={{ fontSize: 10, color: '#555', marginLeft: 6 }}>{d.count} emp</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#57FF9A' }}>{F(d.neto)}</span>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240, maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#666' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar nombre, puesto, RFC..."
            style={{
              width: '100%', background: '#0f0f0f',
              border: '1px solid #1f1f1f', borderRadius: 6,
              padding: '8px 12px 8px 34px', color: '#ccc', fontSize: 13,
            }}
          />
        </div>

        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value as any)} style={selectStyle}>
          <option value="TODOS">Todos los tipos</option>
          <option value="SEMANAL">Semanal</option>
          <option value="QUINCENAL">Quincenal</option>
        </select>

        <select value={filterTrabajo} onChange={e => setFilterTrabajo(e.target.value as any)} style={selectStyle}>
          <option value="TODOS">Oficina y obra</option>
          <option value="OFICINA">Solo oficina</option>
          <option value="OBRA">Solo obra</option>
          <option value="MIXTO">Mixto</option>
        </select>

        <select value={filterArea} onChange={e => setFilterArea(e.target.value)} style={selectStyle}>
          {areas.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <div style={{ flex: 1 }} />

        <Btn onClick={handleCreate} variant="primary">
          <Plus size={14} /> Nuevo empleado
        </Btn>
      </div>

      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState message="No hay empleados que coincidan con los filtros." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Nombre</Th>
              <Th>Puesto</Th>
              <Th>Área</Th>
              <Th>Tipo</Th>
              <Th>Trabajo</Th>
              <Th>Banco</Th>
              <Th right>Sueldo neto</Th>
              <Th right>Neto mensual</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => {
              const sueldoBase = e.tipo_alta === 'SEMANAL' ? e.sueldo_neto_semanal : e.sueldo_neto_quincenal
              return (
                <tr
                  key={e.id}
                  onClick={() => window.location.href = `/nomina/empleado/${e.id}`}
                  style={{ borderBottom: '1px solid #161616', cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={ev => ev.currentTarget.style.background = '#0f0f0f'}
                  onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}
                >
                  <Td muted>{e.numero_excel ?? '—'}</Td>
                  <Td><span style={{ fontWeight: 500, color: '#eee' }}>{e.nombre}</span></Td>
                  <Td muted>{e.puesto || '—'}</Td>
                  <Td muted>{e.area || '—'}</Td>
                  <Td>
                    <Badge
                      label={e.tipo_alta || '—'}
                      color={e.tipo_alta === 'SEMANAL' ? '#f59e0b' : '#60a5fa'}
                    />
                  </Td>
                  <Td>
                    {e.tipo_trabajo ? (
                      <Badge
                        label={e.tipo_trabajo}
                        color={e.tipo_trabajo === 'OBRA' ? '#f59e0b' : e.tipo_trabajo === 'OFICINA' ? '#60a5fa' : '#a78bfa'}
                      />
                    ) : <span style={{ color: '#666', fontSize: 11 }}>—</span>}
                  </Td>
                  <Td muted>{e.banco || '—'}</Td>
                  <Td right>{sueldoBase ? F(Number(sueldoBase)) : '—'}</Td>
                  <Td right muted>{F(calcNetoMensual(e))}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  background: '#0f0f0f',
  border: '1px solid #1f1f1f',
  borderRadius: 6,
  padding: '8px 12px',
  color: '#ccc',
  fontSize: 13,
  cursor: 'pointer',
}
