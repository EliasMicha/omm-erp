import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { SectionHeader, Badge, Loading, EmptyState } from '../components/layout/UI'
import { Search, X, Users, ChevronDown, ChevronRight } from 'lucide-react'
import { useIsMobile } from '../lib/useIsMobile'

// ═══════════════════════════════════════════════════════════════════
// TYPES & CONFIG
// ═══════════════════════════════════════════════════════════════════

interface Emp {
  id: string
  nombre: string
  puesto: string | null
  area: string | null
  nivel: string | null
  email: string | null
  phone: string | null
  foto_url: string | null
  reporta_a_id: string | null
  activo: boolean
  estado_empleado: string | null
}

type Nivel = 'direccion' | 'coordinacion' | 'operativo'

const NIVEL_CONFIG: Record<Nivel, { label: string; color: string; icon: string }> = {
  direccion:    { label: 'Dirección',    color: '#D97706', icon: '👑' },
  coordinacion: { label: 'Coordinación', color: '#8B5CF6', icon: '📋' },
  operativo:    { label: 'Operativo',    color: '#06B6D4', icon: '🔧' },
}

const AREAS = [
  { id: 'DIRECCION GENERAL', label: 'Dirección General', color: '#F9A8D4' },
  { id: 'ADMINISTRACION', label: 'Administración', color: '#6B7280' },
  { id: 'INGENIERIAS ESPECIALES', label: 'Ing. Especiales (Proyecto)', color: '#10B981' },
  { id: 'INGENIERIAS ELECTRICAS', label: 'Ing. Eléctrica (Proyecto)', color: '#34D399' },
  { id: 'ILUMINACION', label: 'Iluminación', color: '#A78BFA' },
  { id: 'INSTALACIONES ESPECIALES', label: 'Obra — Especiales', color: '#2563EB' },
  { id: 'ELECTRICO', label: 'Obra — Eléctrico', color: '#FFB347' },
  { id: 'LOGISTICA', label: 'Logística', color: '#10B981' },
  { id: 'CASA LUCE', label: 'Casa Luce', color: '#EC4899' },
  { id: 'NULED', label: 'Nuled', color: '#F97316' },
]

function areaColor(area: string | null): string {
  return AREAS.find(a => a.id === area)?.color || '#444'
}
function areaLabel(area: string | null): string {
  return AREAS.find(a => a.id === area)?.label || area || 'Sin área'
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════

export default function Empleados() {
  const isMobile = useIsMobile()
  const [emps, setEmps] = useState<Emp[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filtroArea, setFiltroArea] = useState('todas')
  const [filtroNivel, setFiltroNivel] = useState('todos')
  const [view, setView] = useState<'tabla' | 'organigrama'>('tabla')
  const [editingId, setEditingId] = useState<string | null>(null)
  // Las bajas NO salen en ningún listado operativo del ERP. Aquí sí se pueden
  // ver, a propósito y en su propia vista: es el único lugar donde tiene
  // sentido consultar a quien ya no está —o reactivarlo si fue un error.
  const [verBajas, setVerBajas] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('employees')
      .select('id,nombre,puesto,area,nivel,email,phone,foto_url,reporta_a_id,activo,is_active,estado_empleado')
      .eq('is_active', !verBajas)
      .order('nombre')
    setEmps(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [verBajas])

  /**
   * Dar de baja apaga TODO de una vez: deja de aparecer en los listados, se
   * le quita el acceso a las apps y se desactiva su usuario del ERP. Antes la
   * baja se marcaba en una pantalla y el acceso vivía en otra columna que
   * nadie volvía a tocar.
   */
  async function cambiarAlta(id: string, alta: boolean) {
    const emp = emps.find(e => e.id === id)
    if (!alta && !confirm(`¿Dar de baja a ${emp?.nombre}?\n\nDeja de aparecer en todos los listados, pierde el acceso a la app de obra y su usuario del ERP se desactiva. Su historial (tareas, entregas, nómina) se conserva.`)) return
    if (alta && !confirm(`¿Reactivar a ${emp?.nombre}?\n\nVuelve a los listados, pero el acceso a las apps NO se le devuelve solo: eso se habilita aparte.`)) return
    const { error } = await supabase.from('employees')
      .update({ is_active: alta, estado_empleado: alta ? 'activo' : 'baja' }).eq('id', id)
    if (error) { alert('No se pudo guardar: ' + error.message); return }
    load()
  }

  async function updateField(id: string, field: string, value: any) {
    setEmps(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e))
    await supabase.from('employees').update({ [field]: value }).eq('id', id)
  }

  // Filtered list
  const filtered = useMemo(() => {
    return emps.filter(e => {
      if (filtroArea !== 'todas' && e.area !== filtroArea) return false
      if (filtroNivel !== 'todos' && e.nivel !== filtroNivel) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const hay =
          (e.nombre || '').toLowerCase().includes(q) ||
          (e.puesto || '').toLowerCase().includes(q) ||
          (e.area || '').toLowerCase().includes(q)
        if (!hay) return false
      }
      return true
    })
  }, [emps, search, filtroArea, filtroNivel])

  // Stats
  const totalActivos = emps.length
  const directores = emps.filter(e => e.nivel === 'direccion').length
  const coordinadores = emps.filter(e => e.nivel === 'coordinacion').length
  const operativos = emps.filter(e => e.nivel === 'operativo').length
  const areasUnicas = [...new Set(emps.map(e => e.area).filter(Boolean))].length

  const inputS: React.CSSProperties = {
    background: '#1e1e1e', border: '1px solid #333', borderRadius: 6,
    color: '#ccc', fontSize: 11, fontFamily: 'inherit', padding: '4px 6px',
  }

  return (
    <div style={{ padding: isMobile ? '12px 16px' : '24px 28px' }}>
      <SectionHeader
        title="Empleados"
        subtitle={`${totalActivos} empleados activos · ${areasUnicas} áreas`}
        action={
          <div style={{ display: 'flex', gap: 6 }}>
            {(['tabla', 'organigrama'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: 600,
                  border: `1px solid ${view === v ? '#10B981' : '#333'}`,
                  background: view === v ? '#10B98122' : 'transparent',
                  color: view === v ? '#10B981' : '#666',
                }}
              >
                {v === 'tabla' ? '📋 Tabla' : '🏗️ Organigrama'}
              </button>
            ))}
          </div>
        }
      />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Dirección', value: directores, color: NIVEL_CONFIG.direccion.color },
          { label: 'Coordinación', value: coordinadores, color: NIVEL_CONFIG.coordinacion.color },
          { label: 'Operativos', value: operativos, color: NIVEL_CONFIG.operativo.color },
          { label: 'Total Activos', value: totalActivos, color: '#10B981' },
        ].map(kpi => (
          <div key={kpi.label} style={{
            background: '#141414', border: '1px solid #222', borderRadius: 10,
            padding: '12px 14px', borderTop: `2px solid ${kpi.color}`,
          }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{kpi.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#555', pointerEvents: 'none' }} />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, puesto o área..."
            style={{
              width: '100%', padding: '10px 12px 10px 36px', background: '#141414',
              border: '1px solid #222', borderRadius: 10, color: '#fff', fontSize: 13,
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 4,
            }}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Area filter pills */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={() => setFiltroArea('todas')} style={{
          padding: '4px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
          border: `1px solid ${filtroArea === 'todas' ? '#10B981' : '#333'}`,
          background: filtroArea === 'todas' ? '#10B98122' : 'transparent',
          color: filtroArea === 'todas' ? '#10B981' : '#555', fontWeight: 600,
        }}>Todas</button>
        {AREAS.map(a => (
          <button key={a.id} onClick={() => setFiltroArea(a.id)} style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${filtroArea === a.id ? a.color : '#333'}`,
            background: filtroArea === a.id ? a.color + '22' : 'transparent',
            color: filtroArea === a.id ? a.color : '#555', fontWeight: 600,
          }}>{a.label}</button>
        ))}
      </div>

      {/* Nivel filter pills */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setFiltroNivel('todos')} style={{
          padding: '4px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
          border: `1px solid ${filtroNivel === 'todos' ? '#fff' : '#333'}`,
          background: filtroNivel === 'todos' ? '#fff11' : 'transparent',
          color: filtroNivel === 'todos' ? '#fff' : '#555', fontWeight: 600,
        }}>Todos</button>
        {(Object.entries(NIVEL_CONFIG) as [Nivel, typeof NIVEL_CONFIG.direccion][]).map(([k, v]) => (
          <button key={k} onClick={() => setFiltroNivel(k)} style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${filtroNivel === k ? v.color : '#333'}`,
            background: filtroNivel === k ? v.color + '22' : 'transparent',
            color: filtroNivel === k ? v.color : '#555', fontWeight: 600,
          }}>{v.icon} {v.label}</button>
        ))}
        <button onClick={() => { setVerBajas(v => !v); setEditingId(null) }} style={{
          padding: '4px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto',
          border: `1px solid ${verBajas ? '#DC2626' : '#333'}`,
          background: verBajas ? '#DC262622' : 'transparent',
          color: verBajas ? '#DC2626' : '#555', fontWeight: 600,
        }}>{verBajas ? '← Volver a los activos' : 'Ver bajas'}</button>
      </div>

      {verBajas && (
        <div style={{ background: '#1a1210', border: '1px solid #3a1a1a', borderRadius: 8, padding: '9px 13px', fontSize: 11.5, color: '#e0a0a0', marginBottom: 14, lineHeight: 1.6 }}>
          Estás viendo personal <b>dado de baja</b>. No aparece en ningún listado operativo del ERP —ni para asignar
          actividades, ni en entregas, ni en obra— y no puede entrar a las apps. Su historial se conserva completo.
        </div>
      )}

      {loading ? <Loading /> : view === 'tabla' ? (
        <EmpTable emps={filtered} allEmps={emps} onUpdate={updateField} editingId={editingId} setEditingId={setEditingId} inputS={inputS}
          verBajas={verBajas} onAlta={cambiarAlta} />
      ) : (
        <OrgChart emps={emps} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TABLE VIEW
// ═══════════════════════════════════════════════════════════════════

function EmpTable({
  emps, allEmps, onUpdate, editingId, setEditingId, inputS, verBajas, onAlta,
}: {
  emps: Emp[]
  allEmps: Emp[]
  onUpdate: (id: string, field: string, value: any) => void
  editingId: string | null
  setEditingId: (id: string | null) => void
  inputS: React.CSSProperties
  verBajas: boolean
  onAlta: (id: string, alta: boolean) => void
}) {
  const thS: React.CSSProperties = {
    padding: '8px 8px', fontSize: 9, fontWeight: 600, color: '#444',
    textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #222',
    textAlign: 'left', whiteSpace: 'nowrap',
  }
  const tdS: React.CSSProperties = {
    padding: '6px 8px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a',
  }

  // Possible managers (directors + coordinators)
  const managers = allEmps.filter(e => e.nivel === 'direccion' || e.nivel === 'coordinacion')

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
        <thead>
          <tr style={{ background: '#0e0e0e' }}>
            <th style={thS}>Nombre</th>
            <th style={thS}>Puesto</th>
            <th style={thS}>Área</th>
            <th style={thS}>Nivel</th>
            <th style={thS}>Reporta a</th>
            <th style={thS}>Contacto</th>
            <th style={{ ...thS, width: 90 }}>Alta</th>
            <th style={{ ...thS, width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {emps.length === 0 && (
            <tr><td colSpan={8}><EmptyState message={verBajas ? 'No hay personal dado de baja.' : 'No se encontraron empleados con estos filtros'} /></td></tr>
          )}
          {emps.map(e => {
            const isEditing = editingId === e.id
            const nivelCfg = NIVEL_CONFIG[(e.nivel || 'operativo') as Nivel] || NIVEL_CONFIG.operativo
            const manager = allEmps.find(m => m.id === e.reporta_a_id)

            return (
              <tr key={e.id} style={{ background: isEditing ? '#141414' : 'transparent' }}>
                {/* Nombre */}
                <td style={tdS}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: areaColor(e.area) + '33',
                      border: `1px solid ${areaColor(e.area)}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: areaColor(e.area), flexShrink: 0,
                    }}>
                      {(e.nombre || '?')[0]}
                    </div>
                    <span style={{ fontWeight: 500, color: '#fff', fontSize: 12 }}>{e.nombre}</span>
                  </div>
                </td>

                {/* Puesto */}
                <td style={tdS}>
                  {isEditing ? (
                    <input value={e.puesto || ''} onChange={ev => onUpdate(e.id, 'puesto', ev.target.value)}
                      style={{ ...inputS, width: 200 }} />
                  ) : (
                    <span style={{ fontSize: 11, color: '#aaa' }}>{e.puesto || '—'}</span>
                  )}
                </td>

                {/* Área */}
                <td style={tdS}>
                  {isEditing ? (
                    <select value={e.area || ''} onChange={ev => onUpdate(e.id, 'area', ev.target.value)} style={inputS}>
                      <option value="">— Sin área —</option>
                      {AREAS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                  ) : (
                    <Badge label={areaLabel(e.area)} color={areaColor(e.area)} />
                  )}
                </td>

                {/* Nivel */}
                <td style={tdS}>
                  {isEditing ? (
                    <select value={e.nivel || 'operativo'} onChange={ev => onUpdate(e.id, 'nivel', ev.target.value)} style={inputS}>
                      {(Object.entries(NIVEL_CONFIG) as [Nivel, typeof NIVEL_CONFIG.direccion][]).map(([k, v]) => (
                        <option key={k} value={k}>{v.icon} {v.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 600, color: nivelCfg.color }}>
                      {nivelCfg.icon} {nivelCfg.label}
                    </span>
                  )}
                </td>

                {/* Reporta a */}
                <td style={tdS}>
                  {isEditing ? (
                    <select value={e.reporta_a_id || ''} onChange={ev => onUpdate(e.id, 'reporta_a_id', ev.target.value || null)} style={inputS}>
                      <option value="">— Nadie —</option>
                      {managers.filter(m => m.id !== e.id).map(m => (
                        <option key={m.id} value={m.id}>{m.nombre} ({m.puesto})</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ fontSize: 11, color: manager ? '#A78BFA' : '#333' }}>
                      {manager ? manager.nombre : '—'}
                    </span>
                  )}
                </td>

                {/* Contacto */}
                <td style={tdS}>
                  <span style={{ fontSize: 10, color: '#555' }}>
                    {e.email || e.phone || '—'}
                  </span>
                </td>

                {/* Alta / baja */}
                <td style={tdS}>
                  <button
                    onClick={() => onAlta(e.id, verBajas)}
                    style={{
                      background: 'none', border: `1px solid ${verBajas ? '#10B98155' : '#DC262655'}`,
                      borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer',
                      color: verBajas ? '#10B981' : '#DC2626', fontFamily: 'inherit', fontWeight: 600,
                    }}
                  >
                    {verBajas ? 'Reactivar' : 'Dar de baja'}
                  </button>
                </td>

                {/* Edit toggle */}
                <td style={tdS}>
                  <button
                    onClick={() => setEditingId(isEditing ? null : e.id)}
                    style={{
                      background: 'none', border: `1px solid ${isEditing ? '#10B981' : '#333'}`,
                      borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer',
                      color: isEditing ? '#10B981' : '#555', fontFamily: 'inherit', fontWeight: 600,
                    }}
                  >
                    {isEditing ? '✓ Listo' : 'Editar'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ORG CHART VIEW
// ═══════════════════════════════════════════════════════════════════

function OrgChart({ emps }: { emps: Emp[] }) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['root']))

  // Build tree: find root (DG), then their direct reports, then their reports
  const roots = emps.filter(e => e.nivel === 'direccion' && (e.puesto || '').toUpperCase().includes('GENERAL'))
  const getReports = (managerId: string) => emps.filter(e => e.reporta_a_id === managerId)

  // Directors without a reporta_a_id (not yet assigned)
  const unassignedDirectors = emps.filter(e =>
    e.nivel === 'direccion' && !e.reporta_a_id && !(e.puesto || '').toUpperCase().includes('GENERAL')
  )

  // Group unassigned by area
  const unassignedByArea = new Map<string, Emp[]>()
  emps.filter(e => !e.reporta_a_id && e.nivel !== 'direccion').forEach(e => {
    const area = e.area || 'SIN AREA'
    if (!unassignedByArea.has(area)) unassignedByArea.set(area, [])
    unassignedByArea.get(area)!.push(e)
  })

  function toggleNode(id: string) {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function renderNode(emp: Emp, depth: number) {
    const reports = getReports(emp.id)
    const hasReports = reports.length > 0
    const isExpanded = expandedNodes.has(emp.id)
    const nivelCfg = NIVEL_CONFIG[(emp.nivel || 'operativo') as Nivel]

    return (
      <div key={emp.id} style={{ marginLeft: depth * 28 }}>
        <div
          onClick={() => hasReports && toggleNode(emp.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
            borderRadius: 8, marginBottom: 2, cursor: hasReports ? 'pointer' : 'default',
            background: depth === 0 ? '#1a1a1a' : 'transparent',
            border: depth === 0 ? '1px solid #333' : '1px solid transparent',
          }}
        >
          {hasReports ? (
            isExpanded ? <ChevronDown size={12} color="#555" /> : <ChevronRight size={12} color="#555" />
          ) : (
            <span style={{ width: 12 }} />
          )}
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: nivelCfg.color + '22', border: `1px solid ${nivelCfg.color}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: nivelCfg.color, flexShrink: 0,
          }}>
            {(emp.nombre || '?')[0]}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#fff' }}>{emp.nombre}</div>
            <div style={{ fontSize: 10, color: '#888' }}>{emp.puesto || 'Sin puesto'}</div>
          </div>
          <Badge label={areaLabel(emp.area)} color={areaColor(emp.area)} />
          <span style={{ fontSize: 9, color: nivelCfg.color, fontWeight: 600, marginLeft: 4 }}>
            {nivelCfg.icon} {nivelCfg.label.toUpperCase()}
          </span>
          {hasReports && (
            <span style={{ fontSize: 9, color: '#555', marginLeft: 'auto' }}>
              {reports.length} reportes
            </span>
          )}
        </div>
        {isExpanded && reports.map(r => renderNode(r, depth + 1))}
      </div>
    )
  }

  return (
    <div>
      {/* Note about configuration */}
      <div style={{
        padding: '10px 14px', background: '#D9770611', border: '1px solid #D9770633',
        borderRadius: 8, marginBottom: 16, fontSize: 11, color: '#D97706',
      }}>
        💡 El organigrama se construye con el campo "Reporta a" de cada empleado. Usa la vista de Tabla para asignar la cadena de mando.
      </div>

      {/* Roots (DG) */}
      {roots.map(r => renderNode(r, 0))}

      {/* Unassigned directors */}
      {unassignedDirectors.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, color: '#D97706', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>
            ⚠ Directores sin "Reporta a" asignado
          </div>
          {unassignedDirectors.map(d => renderNode(d, 0))}
        </div>
      )}

      {/* Unassigned by area */}
      {unassignedByArea.size > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, color: '#666', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>
            Empleados sin "Reporta a" (agrupados por área)
          </div>
          {[...unassignedByArea.entries()].map(([area, members]) => {
            const isExpanded = expandedNodes.has('area-' + area)
            return (
              <div key={area} style={{ marginBottom: 4 }}>
                <div
                  onClick={() => toggleNode('area-' + area)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                    cursor: 'pointer', borderRadius: 6,
                    background: '#0e0e0e', border: '1px solid #1e1e1e',
                  }}
                >
                  {isExpanded ? <ChevronDown size={12} color="#555" /> : <ChevronRight size={12} color="#555" />}
                  <Badge label={areaLabel(area)} color={areaColor(area)} />
                  <span style={{ fontSize: 10, color: '#555' }}>{members.length} personas</span>
                </div>
                {isExpanded && (
                  <div style={{ marginLeft: 28 }}>
                    {members.map(m => {
                      const nivelCfg = NIVEL_CONFIG[(m.nivel || 'operativo') as Nivel]
                      return (
                        <div key={m.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 10px', fontSize: 12,
                        }}>
                          <span style={{ width: 12 }} />
                          <span style={{ color: '#ccc' }}>{m.nombre}</span>
                          <span style={{ fontSize: 10, color: '#555' }}>{m.puesto || '—'}</span>
                          <span style={{ fontSize: 9, color: nivelCfg.color }}>{nivelCfg.icon}</span>
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
    </div>
  )
}
