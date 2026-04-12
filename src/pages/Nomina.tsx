import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { F } from '../lib/utils'
import { Btn, Table, Th, Td, Loading, KpiCard, SectionHeader, EmptyState, Badge } from '../components/layout/UI'
import { Users2, Calendar, Receipt, ClipboardList, BarChart3, Plus, X, Save, Search, Trash2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
type TipoAlta = 'SEMANAL' | 'QUINCENAL'

interface Employee {
  id: string
  numero_excel?: number | null
  numero_interno?: string | null
  nombre: string
  name?: string
  rfc?: string | null
  curp?: string | null
  imss_numero?: string | null
  puesto?: string | null
  area?: string | null
  tipo_alta?: TipoAlta | null
  banco?: string | null
  cuenta?: string | null
  clabe?: string | null
  comentarios?: string | null
  sueldo_neto_semanal?: number | null
  sueldo_neto_quincenal?: number | null
  neto_mensual?: number | null
  salario_diario_imss?: number | null
  sdi?: number | null
  fecha_ultimo_ingreso?: string | null
  jornada_horas?: number | null
  descuento_infonavit_quincenal?: number | null
  tiene_infonavit?: boolean | null
  activo?: boolean | null
  fecha_alta?: string | null
  fecha_baja?: string | null
  notas?: string | null
}

type Tab = 'empleados' | 'periodos' | 'caja_chica' | 'asistencia' | 'reportes'

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'empleados', label: 'Empleados', icon: Users2 },
  { id: 'periodos', label: 'Períodos', icon: Calendar },
  { id: 'caja_chica', label: 'Caja Chica', icon: Receipt },
  { id: 'asistencia', label: 'Asistencia', icon: ClipboardList },
  { id: 'reportes', label: 'Reportes', icon: BarChart3 },
]

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Nomina() {
  const [tab, setTab] = useState<Tab>('empleados')

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1600, margin: '0 auto' }}>
      <SectionHeader title="Nómina" subtitle="Gestión de empleados, periodos de pago, caja chica y asistencia" />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #1f1f1f', marginBottom: 24 }}>
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: 'none',
                border: 'none',
                color: active ? '#fff' : '#888',
                padding: '12px 18px',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                borderBottom: active ? '2px solid #57FF9A' : '2px solid transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'color 0.15s',
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
      {tab === 'caja_chica' && <PlaceholderTab title="Caja Chica" />}
      {tab === 'asistencia' && <PlaceholderTab title="Asistencia" />}
      {tab === 'reportes' && <PlaceholderTab title="Reportes" />}
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

// ─── Tab Empleados ────────────────────────────────────────────────────────────
function TabEmpleados() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState<TipoAlta | 'TODOS'>('TODOS')
  const [filterArea, setFilterArea] = useState<string>('TODAS')
  const [editing, setEditing] = useState<Employee | null>(null)
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('employees')
      .select('*')
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
  }, [employees, search, filterTipo, filterArea])

  const kpis = useMemo(() => {
    const total = filtered.length
    const semanales = filtered.filter(e => e.tipo_alta === 'SEMANAL').length
    const quincenales = filtered.filter(e => e.tipo_alta === 'QUINCENAL').length
    const totalNetoMensual = filtered.reduce((sum, e) => sum + (Number(e.neto_mensual) || 0), 0)
    return { total, semanales, quincenales, totalNetoMensual }
  }, [filtered])

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Empleados activos" value={kpis.total.toString()} />
        <KpiCard label="Quincenales" value={kpis.quincenales.toString()} color="#60a5fa" />
        <KpiCard label="Semanales" value={kpis.semanales.toString()} color="#f59e0b" />
        <KpiCard label="Neto mensual total" value={F(kpis.totalNetoMensual)} />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240, maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#666' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar nombre, puesto, RFC..."
            style={{
              width: '100%',
              background: '#0f0f0f',
              border: '1px solid #1f1f1f',
              borderRadius: 6,
              padding: '8px 12px 8px 34px',
              color: '#ccc',
              fontSize: 13,
            }}
          />
        </div>

        <select
          value={filterTipo}
          onChange={e => setFilterTipo(e.target.value as any)}
          style={selectStyle}
        >
          <option value="TODOS">Todos los tipos</option>
          <option value="SEMANAL">Semanal</option>
          <option value="QUINCENAL">Quincenal</option>
        </select>

        <select
          value={filterArea}
          onChange={e => setFilterArea(e.target.value)}
          style={selectStyle}
        >
          {areas.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <div style={{ flex: 1 }} />

        <Btn onClick={() => setCreating(true)} variant="primary">
          <Plus size={14} /> Nuevo empleado
        </Btn>
      </div>

      {/* Table */}
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
              <Th>Banco</Th>
              <Th right>Sueldo neto</Th>
              <Th right>Neto mensual</Th>
              <Th>{''}</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => {
              const sueldoBase = e.tipo_alta === 'SEMANAL' ? e.sueldo_neto_semanal : e.sueldo_neto_quincenal
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid #161616' }}>
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
                  <Td muted>{e.banco || '—'}</Td>
                  <Td right>{sueldoBase ? F(Number(sueldoBase)) : '—'}</Td>
                  <Td right muted>{e.neto_mensual ? F(Number(e.neto_mensual)) : '—'}</Td>
                  <Td>
                    <button
                      onClick={() => setEditing(e)}
                      style={{
                        background: 'none',
                        border: '1px solid #1f1f1f',
                        borderRadius: 4,
                        color: '#888',
                        padding: '4px 10px',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Editar
                    </button>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {(editing || creating) && (
        <EmployeeModal
          employee={editing}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={() => { setEditing(null); setCreating(false); load() }}
        />
      )}
    </div>
  )
}

// ─── Employee Modal ───────────────────────────────────────────────────────────
function EmployeeModal({
  employee,
  onClose,
  onSaved,
}: {
  employee: Employee | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Partial<Employee>>(
    employee || {
      nombre: '',
      tipo_alta: 'QUINCENAL',
      activo: true,
      jornada_horas: 8,
    }
  )
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof Employee>(k: K, v: Employee[K]) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.nombre || !form.nombre.trim()) {
      alert('Nombre requerido')
      return
    }
    setSaving(true)
    const payload: any = {
      ...form,
      name: form.nombre,
    }
    for (const k of [
      'sueldo_neto_semanal', 'sueldo_neto_quincenal', 'neto_mensual',
      'salario_diario_imss', 'sdi', 'descuento_infonavit_quincenal', 'jornada_horas',
    ]) {
      if (payload[k] === '' || payload[k] == null) payload[k] = null
      else payload[k] = Number(payload[k])
    }

    if (employee?.id) {
      const { error } = await supabase.from('employees').update(payload).eq('id', employee.id)
      if (error) { alert('Error: ' + error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('employees').insert(payload)
      if (error) { alert('Error: ' + error.message); setSaving(false); return }
    }
    setSaving(false)
    onSaved()
  }

  const handleDeactivate = async () => {
    if (!employee?.id) return
    if (!confirm(`¿Dar de baja a ${employee.nombre}?`)) return
    const { error } = await supabase
      .from('employees')
      .update({ activo: false, fecha_baja: new Date().toISOString().slice(0, 10) })
      .eq('id', employee.id)
    if (error) { alert('Error: ' + error.message); return }
    onSaved()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0a0a0a',
          border: '1px solid #1f1f1f',
          borderRadius: 10,
          width: 720,
          maxWidth: '92vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#eee' }}>
            {employee ? 'Editar empleado' : 'Nuevo empleado'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Nombre completo" full>
            <input value={form.nombre || ''} onChange={e => set('nombre', e.target.value)} style={inputStyle} />
          </Field>

          <Field label="Puesto">
            <input value={form.puesto || ''} onChange={e => set('puesto', e.target.value)} style={inputStyle} />
          </Field>

          <Field label="Área">
            <input value={form.area || ''} onChange={e => set('area', e.target.value)} style={inputStyle} />
          </Field>

          <Field label="Tipo de alta">
            <select value={form.tipo_alta || 'QUINCENAL'} onChange={e => set('tipo_alta', e.target.value as TipoAlta)} style={inputStyle}>
              <option value="QUINCENAL">Quincenal</option>
              <option value="SEMANAL">Semanal</option>
            </select>
          </Field>

          <Field label="Número (Excel)">
            <input type="number" value={form.numero_excel ?? ''} onChange={e => set('numero_excel', e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
          </Field>

          <SectionDivider label="Sueldos (neto pactado X)" />

          <Field label="Sueldo neto semanal">
            <input type="number" step="0.01" value={form.sueldo_neto_semanal ?? ''} onChange={e => set('sueldo_neto_semanal', e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
          </Field>

          <Field label="Sueldo neto quincenal">
            <input type="number" step="0.01" value={form.sueldo_neto_quincenal ?? ''} onChange={e => set('sueldo_neto_quincenal', e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
          </Field>

          <Field label="Neto mensual">
            <input type="number" step="0.01" value={form.neto_mensual ?? ''} onChange={e => set('neto_mensual', e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
          </Field>

          <Field label="Descuento INFONAVIT (qna)">
            <input type="number" step="0.01" value={form.descuento_infonavit_quincenal ?? ''} onChange={e => set('descuento_infonavit_quincenal', e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
          </Field>

          <SectionDivider label="Datos fiscales (Y) — se llenan al importar CFDI" />

          <Field label="RFC">
            <input value={form.rfc || ''} onChange={e => set('rfc', e.target.value.toUpperCase())} style={inputStyle} />
          </Field>

          <Field label="CURP">
            <input value={form.curp || ''} onChange={e => set('curp', e.target.value.toUpperCase())} style={inputStyle} />
          </Field>

          <Field label="No. IMSS">
            <input value={form.imss_numero || ''} onChange={e => set('imss_numero', e.target.value)} style={inputStyle} />
          </Field>

          <Field label="No. interno (CFDI)">
            <input value={form.numero_interno || ''} onChange={e => set('numero_interno', e.target.value)} style={inputStyle} />
          </Field>

          <Field label="Salario diario IMSS">
            <input type="number" step="0.01" value={form.salario_diario_imss ?? ''} onChange={e => set('salario_diario_imss', e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
          </Field>

          <Field label="SDI">
            <input type="number" step="0.01" value={form.sdi ?? ''} onChange={e => set('sdi', e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
          </Field>

          <SectionDivider label="Datos bancarios" />

          <Field label="Banco">
            <input value={form.banco || ''} onChange={e => set('banco', e.target.value)} style={inputStyle} />
          </Field>

          <Field label="Cuenta">
            <input value={form.cuenta || ''} onChange={e => set('cuenta', e.target.value)} style={inputStyle} />
          </Field>

          <Field label="CLABE" full>
            <input value={form.clabe || ''} onChange={e => set('clabe', e.target.value)} style={inputStyle} />
          </Field>

          <Field label="Comentarios" full>
            <textarea value={form.comentarios || ''} onChange={e => set('comentarios', e.target.value)} style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} />
          </Field>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 12 }}>
          <div>
            {employee?.id && (
              <Btn onClick={handleDeactivate} variant="danger">
                <Trash2 size={13} /> Dar de baja
              </Btn>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={onClose} variant="ghost">Cancelar</Btn>
            <Btn onClick={handleSave} disabled={saving} variant="primary">
              <Save size={13} /> {saving ? 'Guardando...' : 'Guardar'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f0f0f',
  border: '1px solid #1f1f1f',
  borderRadius: 6,
  padding: '8px 12px',
  color: '#ccc',
  fontSize: 13,
  fontFamily: 'inherit',
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

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #1f1f1f', margin: '8px 0', paddingTop: 12 }}>
      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  )
}
