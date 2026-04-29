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
  direccion:    { label: 'Dirección',    color: '#F59E0B', icon: '👑' },
  coordinacion: { label: 'Coordinación', color: '#8B5CF6', icon: '📋' },
  operativo:    { label: 'Operativo',    color: '#06B6D4', icon: '🔧' },
}

const AREAS = [
  { id: 'DIRECCION GENERAL', label: 'Dirección General', color: '#F9A8D4' },
  { id: 'ADMINISTRACION', label: 'Administración', color: '#6B7280' },
  { id: 'INGENIERIAS ESPECIALES', label: 'Ing. Especiales (Proyecto)', color: '#57FF9A' },
  { id: 'INGENIERIAS ELECTRICAS', label: 'Ing. Eléctrica (Proyecto)', color: '#34D399' },
  { id: 'ILUMINACION', label: 'Iluminación', color: '#C084FC' },
  { id: 'INSTALACIONES ESPECIALES', label: 'Obra — Especiales', color: '#3B82F6' },
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

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('employees')
      .select('id,nombre,puesto,area,nivel,email,phone,foto_url,reporta_a_id,activo,estado_empleado')
      .eq('activo', true)
      .order('nombre')
    setEmps(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

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
                  border: `1px solid ${view === v ? '#57FF9A' : '#333'}`,
                  background: view === v ? '#57FF9A22' : 'transparent',
                  color: view === v ? '#57FF9A' : '#666',
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
          { label: 'Total Activos', value: totalActivos, color: '#57FF9A' },
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
          border: `1px solid ${filtroArea === 'todas' ? '#57FF9A' : '#333'}`,
          background: filtroArea === 'todas' ? '#57FF9A22' : 'transparent',
          color: filtroArea === 'todas' ? '#57FF9A' : '#555', fontWeight: 600,
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
      </div>

      {loading ? <Loading /> : view === 'tabla' ? (
        <EmpTable emps={filtered} allEmps={emps} onUpdate={updateField} editingId={editingId} setEditingId={setEditingId} inputS={inputS} />
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
  emps, allEmps, onUpdate, editingId, setEditingId, inputS,
}: {
  emps: Emp[]
  allEmps: Emp[]
  onUpdate: (id: string, field: string, value: any) => void
  editingId: string | null
  setEditingId: (id: string | null) => void
  inputS: React.CSSProperties
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
            <th style={{ ...thS, width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {emps.length === 0 && (
            <tr><td colSpan={7}><EmptyState message="No se encontraron empleados con estos filtros" /></td></tr>
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
                    <span style={{ fontSize: 11, color: manager ? '#C084FC' : '#333' }}>
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

                {/* Edit toggle */}
                <td style={tdS}>
                  <button
                    onClick={() => setEditingId(isEditing ? null : e.id)}
                    style={{
                      background: 'none', border: `1px solid ${isEditing ? '#57FF9A' : '#333'}`,
                      borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer',
                      color: isEditing ? '#57FF9A' : '#555', fontFamily: 'inherit', fontWeight: 600,
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
        padding: '10px 14px', background: '#F59E0B11', border: '1px solid #F59E0B33',
        borderRadius: 8, marginBottom: 16, fontSize: 11, color: '#F59E0B',
      }}>
        💡 El organigrama se construye con el campo "Reporta a" de cada empleado. Usa la vista de Tabla para asignar la cadena de mando.
      </div>

      {/* Roots (DG) */}
      {roots.map(r => renderNode(r, 0))}

      {/* Unassigned directors */}
      {unassignedDirectors.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>
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
