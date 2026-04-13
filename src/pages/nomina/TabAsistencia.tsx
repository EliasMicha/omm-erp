import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { Btn, Table, Th, Td, Loading, KpiCard, SectionHeader, EmptyState, Badge } from '../../components/layout/UI'
import {
  Clock, MapPin, AlertTriangle, CheckCircle2, TrendingUp, Users,
  Filter, X, ThumbsUp, XCircle, Calendar, Map as MapIcon
} from 'lucide-react'

interface Attendance {
  id: string
  employee_id: string
  fecha: string
  tipo: 'entrada' | 'salida'
  hora: string
  latitude: number | null
  longitude: number | null
  accuracy_meters: number | null
  obra_id: string | null
  distancia_obra_metros: number | null
  status: string
  aprobado_por: string | null
  aprobado_at: string | null
  notas: string | null
  empleado?: { id: string; nombre: string; puesto: string | null }
  obra?: { id: string; nombre: string; radio_checada_metros: number | null } | null
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  en_sitio: { label: 'EN SITIO', color: '#57FF9A' },
  fuera_de_rango: { label: 'FUERA DE RANGO', color: '#f59e0b' },
  sin_obra: { label: 'SIN OBRA', color: '#a78bfa' },
  aprobado_admin: { label: 'APROBADO', color: '#3b82f6' },
  rechazado: { label: 'RECHAZADO', color: '#ef4444' },
}

function isLateEntrada(hora: string): number {
  // Returns retardo in minutes (0 if not late). 9:00 AM tolerance.
  const d = new Date(hora)
  const nineAm = new Date(d)
  nineAm.setHours(9, 0, 0, 0)
  if (d <= nineAm) return 0
  return Math.round((d.getTime() - nineAm.getTime()) / 60000)
}

function extrasFromSalida(hora: string): number {
  // Extras after 18:00 in minutes
  const d = new Date(hora)
  const sixPm = new Date(d)
  sixPm.setHours(18, 0, 0, 0)
  if (d <= sixPm) return 0
  return Math.round((d.getTime() - sixPm.getTime()) / 60000)
}

function fmtMin(m: number): string {
  if (m === 0) return '0'
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h === 0) return `${rem}m`
  if (rem === 0) return `${h}h`
  return `${h}h ${rem}m`
}

export default function TabAsistencia() {
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [loading, setLoading] = useState(true)
  const [filterRange, setFilterRange] = useState<'hoy' | 'semana' | 'mes'>('semana')
  const [filterEmpleado, setFilterEmpleado] = useState<string>('todos')
  const [filterStatus, setFilterStatus] = useState<string>('todos')
  const [selected, setSelected] = useState<Attendance | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    const now = new Date()
    let startDate: Date
    if (filterRange === 'hoy') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    } else if (filterRange === 'semana') {
      const day = now.getDay()
      const diff = now.getDate() - day + (day === 0 ? -6 : 1)
      startDate = new Date(now.getFullYear(), now.getMonth(), diff)
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    }
    const startStr = startDate.toISOString().slice(0, 10)

    const { data } = await supabase
      .from('installer_attendance')
      .select(`
        id, employee_id, fecha, tipo, hora, latitude, longitude,
        accuracy_meters, obra_id, distancia_obra_metros, status,
        aprobado_por, aprobado_at, notas,
        empleado:employees!installer_attendance_employee_id_fkey(id, nombre, puesto),
        obra:obras(id, nombre, radio_checada_metros)
      `)
      .gte('fecha', startStr)
      .order('fecha', { ascending: false })
      .order('hora', { ascending: false })
      .limit(500)
    setAttendance((data as any) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filterRange])


  const empleadosList = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of attendance) if (a.empleado) map.set(a.empleado.id, a.empleado.nombre)
    return Array.from(map.entries()).map(([id, nombre]) => ({ id, nombre }))
  }, [attendance])

  const filtered = useMemo(() => attendance.filter(a => {
    if (filterEmpleado !== 'todos' && a.employee_id !== filterEmpleado) return false
    if (filterStatus !== 'todos' && a.status !== filterStatus) return false
    return true
  }), [attendance, filterEmpleado, filterStatus])

  // KPIs: group by day+empleado to detect: trabajados, retardos total, extras total, sin_salida, fuera_rango pendientes
  const kpis = useMemo(() => {
    // Group by employee+day
    const days: Map<string, { entrada: Attendance | null; salida: Attendance | null }> = new Map()
    for (const a of attendance) {
      const key = `${a.employee_id}|${a.fecha}`
      if (!days.has(key)) days.set(key, { entrada: null, salida: null })
      const d = days.get(key)!
      if (a.tipo === 'entrada') d.entrada = a
      else if (a.tipo === 'salida') d.salida = a
    }
    let totalRetardoMin = 0
    let totalExtrasMin = 0
    let sinSalidaCount = 0
    for (const d of days.values()) {
      if (d.entrada) totalRetardoMin += isLateEntrada(d.entrada.hora)
      if (d.salida) totalExtrasMin += extrasFromSalida(d.salida.hora)
      if (d.entrada && !d.salida) sinSalidaCount++
    }
    const fueraRangoPendientes = attendance.filter(a => a.status === 'fuera_de_rango').length
    const diasActivos = new Set(attendance.map(a => `${a.employee_id}|${a.fecha}`)).size
    const empleadosActivos = new Set(attendance.map(a => a.employee_id)).size

    return {
      diasActivos,
      empleadosActivos,
      totalRetardoMin,
      totalExtrasMin,
      sinSalidaCount,
      fueraRangoPendientes,
    }
  }, [attendance])

  const handleAprobar = async (att: Attendance) => {
    if (!confirm(`¿Aprobar checada fuera de rango de ${att.empleado?.nombre}?`)) return
    setActionLoading(true)
    const { error } = await supabase
      .from('installer_attendance')
      .update({
        status: 'aprobado_admin',
        aprobado_at: new Date().toISOString(),
      })
      .eq('id', att.id)
    if (error) alert('Error: ' + error.message)
    else {
      setSelected(null)
      await load()
    }
    setActionLoading(false)
  }

  const handleRechazar = async (att: Attendance) => {
    const motivo = prompt('Motivo del rechazo:')
    if (!motivo || !motivo.trim()) return
    setActionLoading(true)
    const { error } = await supabase
      .from('installer_attendance')
      .update({
        status: 'rechazado',
        notas: motivo.trim(),
        aprobado_at: new Date().toISOString(),
      })
      .eq('id', att.id)
    if (error) alert('Error: ' + error.message)
    else {
      setSelected(null)
      await load()
    }
    setActionLoading(false)
  }

  const fmtDate = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })

  const fmtTime = (h: string) =>
    new Date(h).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  const fmtDist = (m: number | null) => {
    if (m === null) return '—'
    if (m < 1000) return `${Math.round(m)}m`
    return `${(m / 1000).toFixed(2)}km`
  }

  if (loading) return <Loading />


  return (
    <div>
      <SectionHeader
        title="Asistencia"
        subtitle="Checadas GPS de los instaladores — aprobación de fuera de rango y monitoreo de retardos y horas extras"
      />

      {/* Range selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, background: '#0a0a0a', padding: 4, borderRadius: 10, border: '1px solid #1a1a1a', width: 'fit-content' }}>
        {(['hoy', 'semana', 'mes'] as const).map(r => (
          <button
            key={r}
            onClick={() => setFilterRange(r)}
            style={{
              padding: '8px 16px',
              background: filterRange === r ? '#0f2a1a' : 'transparent',
              border: 'none', borderRadius: 8,
              color: filterRange === r ? '#57FF9A' : '#666',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {r === 'hoy' ? 'Hoy' : r === 'semana' ? 'Esta semana' : 'Este mes'}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <KpiCard
          label="Empleados activos"
          value={kpis.empleadosActivos}
          color="#57FF9A"
          icon={<Users size={16} />}
        />
        <KpiCard
          label="Retardos acumulados"
          value={fmtMin(kpis.totalRetardoMin)}
          color={kpis.totalRetardoMin > 0 ? '#f59e0b' : undefined}
          icon={<AlertTriangle size={16} />}
        />
        <KpiCard
          label="Horas extras"
          value={fmtMin(kpis.totalExtrasMin)}
          color="#3b82f6"
          icon={<TrendingUp size={16} />}
        />
        <KpiCard
          label="Fuera de rango pendientes"
          value={kpis.fueraRangoPendientes}
          color={kpis.fueraRangoPendientes > 0 ? '#f59e0b' : undefined}
          icon={<MapPin size={16} />}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard
          label="Días con asistencia"
          value={kpis.diasActivos}
          icon={<Calendar size={16} />}
        />
        <KpiCard
          label="Sin salida (pierden extras)"
          value={kpis.sinSalidaCount}
          color={kpis.sinSalidaCount > 0 ? '#c026d3' : undefined}
          icon={<XCircle size={16} />}
        />
      </div>

      {/* Filters row */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', gap: 4, marginRight: 4 }}>
          <Filter size={12} /> Filtros
        </div>
        <select
          value={filterEmpleado}
          onChange={e => setFilterEmpleado(e.target.value)}
          style={{
            padding: '8px 12px', background: '#0f0f0f', border: '1px solid #1f1f1f',
            borderRadius: 8, color: '#eee', fontSize: 12, cursor: 'pointer',
          }}
        >
          <option value="todos">Todos los empleados</option>
          {empleadosList.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{
            padding: '8px 12px', background: '#0f0f0f', border: '1px solid #1f1f1f',
            borderRadius: 8, color: '#eee', fontSize: 12, cursor: 'pointer',
          }}
        >
          <option value="todos">Todos los estatus</option>
          <option value="en_sitio">En sitio</option>
          <option value="fuera_de_rango">Fuera de rango</option>
          <option value="sin_obra">Sin obra</option>
          <option value="aprobado_admin">Aprobado admin</option>
          <option value="rechazado">Rechazado</option>
        </select>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: '#888' }}>
          Mostrando {filtered.length} de {attendance.length}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No hay checadas en el rango seleccionado." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Empleado</Th>
              <Th>Tipo</Th>
              <Th>Hora</Th>
              <Th>Obra</Th>
              <Th right>Distancia</Th>
              <Th>Estatus</Th>
              <Th>Alertas</Th>
              <Th>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => {
              const cfg = STATUS_CONFIG[a.status] || { label: a.status.toUpperCase(), color: '#666' }
              const retardo = a.tipo === 'entrada' ? isLateEntrada(a.hora) : 0
              const extras = a.tipo === 'salida' ? extrasFromSalida(a.hora) : 0
              return (
                <tr
                  key={a.id}
                  style={{ borderBottom: '1px solid #161616', cursor: 'pointer' }}
                  onClick={() => setSelected(a)}
                  onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = '#0f0f0f'}
                  onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  <Td muted>{fmtDate(a.fecha)}</Td>
                  <Td><span style={{ color: '#eee', fontWeight: 500 }}>{a.empleado?.nombre || '—'}</span></Td>
                  <Td>
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 8,
                      background: a.tipo === 'entrada' ? '#0f2a1a' : '#1a1f2f',
                      color: a.tipo === 'entrada' ? '#57FF9A' : '#3b82f6',
                      fontWeight: 700, textTransform: 'uppercase',
                    }}>
                      {a.tipo}
                    </span>
                  </Td>
                  <Td muted>{fmtTime(a.hora)}</Td>
                  <Td muted>{a.obra?.nombre || '—'}</Td>
                  <Td right>
                    <span style={{
                      color: a.status === 'fuera_de_rango' ? '#f59e0b' : '#ccc',
                      fontWeight: a.status === 'fuera_de_rango' ? 600 : 400,
                    }}>
                      {fmtDist(a.distancia_obra_metros)}
                    </span>
                  </Td>
                  <Td>
                    <Badge label={cfg.label} color={cfg.color} />
                  </Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {retardo > 0 && (
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: '#2a1f0f', color: '#f59e0b', fontWeight: 600 }}>
                          ⏰ {fmtMin(retardo)}
                        </span>
                      )}
                      {extras > 0 && (
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: '#1a1f2f', color: '#3b82f6', fontWeight: 600 }}>
                          ⚡ {fmtMin(extras)}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    {a.status === 'fuera_de_rango' && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Btn
                          size="sm"
                          variant="primary"
                          onClick={(e?: any) => { e?.stopPropagation?.(); handleAprobar(a) }}
                          disabled={actionLoading}
                        >
                          <ThumbsUp size={11} />
                        </Btn>
                        <Btn
                          size="sm"
                          variant="danger"
                          onClick={(e?: any) => { e?.stopPropagation?.(); handleRechazar(a) }}
                          disabled={actionLoading}
                        >
                          <XCircle size={11} />
                        </Btn>
                      </div>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}


      {/* Modal detalle */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#0a0a0a', border: '1px solid #1f1f1f',
              borderRadius: 16, maxWidth: 560, width: '100%',
              maxHeight: '90vh', overflow: 'auto',
              padding: 24,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  Checada de {selected.tipo}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#eee' }}>
                  {selected.empleado?.nombre}
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  {fmtDate(selected.fecha)} · {fmtTime(selected.hora)}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                style={{
                  background: 'transparent', border: '1px solid #1f1f1f',
                  borderRadius: 8, padding: 8, cursor: 'pointer', color: '#888',
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Estatus</div>
                <Badge
                  label={(STATUS_CONFIG[selected.status] || { label: selected.status.toUpperCase(), color: '#666' }).label}
                  color={(STATUS_CONFIG[selected.status] || { color: '#666' }).color}
                />
              </div>
              {selected.obra && (
                <div>
                  <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Obra asignada</div>
                  <div style={{ fontSize: 13, color: '#eee' }}>{selected.obra.nombre}</div>
                  {selected.obra.radio_checada_metros && (
                    <div style={{ fontSize: 11, color: '#666' }}>Radio configurado: {selected.obra.radio_checada_metros}m</div>
                  )}
                </div>
              )}
              {selected.latitude && selected.longitude && (
                <div>
                  <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                    <MapPin size={10} style={{ display: 'inline', marginRight: 4 }} />
                    Ubicación
                  </div>
                  <div style={{ fontSize: 12, color: '#ccc' }}>
                    {Number(selected.latitude).toFixed(6)}, {Number(selected.longitude).toFixed(6)}
                  </div>
                  <a
                    href={`https://maps.google.com/?q=${selected.latitude},${selected.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 11, color: '#57FF9A', textDecoration: 'none',
                      marginTop: 4,
                    }}
                  >
                    <MapIcon size={11} /> Ver en Google Maps
                  </a>
                </div>
              )}
              {selected.distancia_obra_metros !== null && (
                <div>
                  <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Distancia a obra</div>
                  <div style={{
                    fontSize: 14,
                    color: selected.status === 'fuera_de_rango' ? '#f59e0b' : '#57FF9A',
                    fontWeight: 600,
                  }}>
                    {fmtDist(selected.distancia_obra_metros)}
                  </div>
                </div>
              )}
              {selected.accuracy_meters !== null && (
                <div>
                  <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Precisión GPS</div>
                  <div style={{ fontSize: 12, color: '#888' }}>±{Math.round(Number(selected.accuracy_meters))}m</div>
                </div>
              )}
              {selected.notas && (
                <div>
                  <div style={{ fontSize: 10, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Motivo rechazo</div>
                  <div style={{ fontSize: 12, color: '#fca5a5', fontStyle: 'italic' }}>{selected.notas}</div>
                </div>
              )}
              {selected.aprobado_at && (
                <div>
                  <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Procesado</div>
                  <div style={{ fontSize: 11, color: '#888' }}>
                    {new Date(selected.aprobado_at).toLocaleString('es-MX')}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            {selected.status === 'fuera_de_rango' && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #1a1a1a', paddingTop: 16 }}>
                <Btn variant="danger" onClick={() => handleRechazar(selected)} disabled={actionLoading}>
                  <XCircle size={13} /> Rechazar
                </Btn>
                <Btn variant="primary" onClick={() => handleAprobar(selected)} disabled={actionLoading}>
                  <ThumbsUp size={13} /> Aprobar checada
                </Btn>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
