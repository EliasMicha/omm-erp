import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { F } from '../lib/utils'
import { Btn, Table, Th, Td, Loading, KpiCard, SectionHeader, EmptyState, Badge } from '../components/layout/UI'
import { Users2, Calendar, Receipt, ClipboardList, BarChart3, Plus, Search } from 'lucide-react'
import TabCajaChica from './nomina/TabCajaChica'
import TabAsistencia from './nomina/TabAsistencia'
import TabReportes from './nomina/TabReportes'
import TabAusencias from './nomina/TabAusencias'

type TipoAlta = 'SEMANAL' | 'QUINCENAL'

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
      {tab === 'periodos' && <PlaceholderTab title="Períodos de pago" />}
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
    const totalNetoMensual = filtered.reduce((sum, e) => sum + (Number(e.neto_mensual) || 0), 0)
    return { total, semanales, quincenales, totalNetoMensual }
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Empleados activos" value={kpis.total.toString()} />
        <KpiCard label="Quincenales" value={kpis.quincenales.toString()} color="#60a5fa" />
        <KpiCard label="Semanales" value={kpis.semanales.toString()} color="#f59e0b" />
        <KpiCard label="Neto mensual total" value={F(kpis.totalNetoMensual)} />
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
                  <Td right muted>{e.neto_mensual ? F(Number(e.neto_mensual)) : '—'}</Td>
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
