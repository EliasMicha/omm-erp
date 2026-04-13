import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { Btn, Table, Th, Td, Loading, KpiCard, SectionHeader, EmptyState, Badge } from '../../components/layout/UI'
import {
  Receipt, DollarSign, Clock, CheckCircle2, XCircle, AlertCircle,
  Filter, X, Eye, ThumbsUp, ThumbsDown, MapPin, Calendar, User
} from 'lucide-react'

interface Ticket {
  id: string
  fecha: string
  monto: number
  concepto: string | null
  categoria: string | null
  estatus: string
  foto_storage_path: string | null
  comprobante_url: string | null
  rechazo_motivo: string | null
  aprobado_por: string | null
  aprobado_at: string | null
  created_at: string
  latitude: number | null
  longitude: number | null
  employee_id: string
  obra_id: string | null
  empleado?: { id: string; nombre: string; puesto: string | null }
  obra?: { id: string; nombre: string } | null
}

const CATEGORIAS: Record<string, { label: string; emoji: string }> = {
  gasolina: { label: 'Gasolina', emoji: '⛽' },
  comida: { label: 'Comida', emoji: '🍽️' },
  material: { label: 'Material', emoji: '🔧' },
  peaje: { label: 'Peaje', emoji: '🛣️' },
  transporte: { label: 'Transporte', emoji: '🚕' },
  herramienta: { label: 'Herramienta', emoji: '🔨' },
  otro: { label: 'Otro', emoji: '📝' },
}

const STATUS_COLORS: Record<string, string> = {
  pendiente: '#f59e0b',
  aprobado: '#3b82f6',
  pagado: '#57FF9A',
  rechazado: '#ef4444',
}

export default function TabCajaChica() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [filterEstatus, setFilterEstatus] = useState<string>('pendiente')
  const [filterEmpleado, setFilterEmpleado] = useState<string>('todos')
  const [filterCategoria, setFilterCategoria] = useState<string>('todos')
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('caja_chica_tickets')
      .select(`
        id, fecha, monto, concepto, categoria, estatus,
        foto_storage_path, comprobante_url, rechazo_motivo,
        aprobado_por, aprobado_at, created_at, latitude, longitude,
        employee_id, obra_id,
        empleado:employees!caja_chica_tickets_employee_id_fkey(id, nombre, puesto),
        obra:obras(id, nombre)
      `)
      .order('created_at', { ascending: false })
      .limit(200)
    setTickets((data as any) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const empleadosList = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of tickets) if (t.empleado) map.set(t.empleado.id, t.empleado.nombre)
    return Array.from(map.entries()).map(([id, nombre]) => ({ id, nombre }))
  }, [tickets])

  const filtered = useMemo(() => tickets.filter(t => {
    if (filterEstatus !== 'todos' && t.estatus !== filterEstatus) return false
    if (filterEmpleado !== 'todos' && t.employee_id !== filterEmpleado) return false
    if (filterCategoria !== 'todos' && t.categoria !== filterCategoria) return false
    return true
  }), [tickets, filterEstatus, filterEmpleado, filterCategoria])

  // KPIs computed over ALL tickets (not filtered) for meaningful totals
  const kpis = useMemo(() => {
    const pendientes = tickets.filter(t => t.estatus === 'pendiente')
    const aprobados = tickets.filter(t => t.estatus === 'aprobado')
    const pagadosMes = tickets.filter(t => {
      if (t.estatus !== 'pagado') return false
      const d = new Date(t.created_at)
      const now = new Date()
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    })
    return {
      pendiente_monto: pendientes.reduce((a, t) => a + Number(t.monto), 0),
      pendiente_count: pendientes.length,
      aprobado_monto: aprobados.reduce((a, t) => a + Number(t.monto), 0),
      aprobado_count: aprobados.length,
      pagado_mes_monto: pagadosMes.reduce((a, t) => a + Number(t.monto), 0),
      pagado_mes_count: pagadosMes.length,
      total_monto: tickets.reduce((a, t) => a + Number(t.monto), 0),
      total_count: tickets.length,
    }
  }, [tickets])

  const fmtMoney = (n: number) =>
    '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const fmtDate = (d: string) =>
    new Date(d + (d.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: '2-digit' })


  const fotoUrl = (path: string | null): string | null => {
    if (!path) return null
    const { data } = supabase.storage.from('caja-chica').getPublicUrl(path)
    return data.publicUrl
  }

  const handleAprobar = async (ticket: Ticket) => {
    if (!confirm(`¿Aprobar ticket de ${fmtMoney(Number(ticket.monto))}?`)) return
    setActionLoading(true)
    const { error } = await supabase
      .from('caja_chica_tickets')
      .update({
        estatus: 'aprobado',
        aprobado_por: 'admin',
        aprobado_at: new Date().toISOString(),
        rechazo_motivo: null,
      })
      .eq('id', ticket.id)
    if (error) alert('Error: ' + error.message)
    else {
      setSelected(null)
      await load()
    }
    setActionLoading(false)
  }

  const handleRechazar = async (ticket: Ticket) => {
    const motivo = prompt('Motivo del rechazo:')
    if (!motivo || !motivo.trim()) return
    setActionLoading(true)
    const { error } = await supabase
      .from('caja_chica_tickets')
      .update({
        estatus: 'rechazado',
        rechazo_motivo: motivo.trim(),
        aprobado_por: 'admin',
        aprobado_at: new Date().toISOString(),
      })
      .eq('id', ticket.id)
    if (error) alert('Error: ' + error.message)
    else {
      setSelected(null)
      await load()
    }
    setActionLoading(false)
  }

  const handleMarcarPagado = async (ticket: Ticket) => {
    if (!confirm(`Marcar como pagado el ticket de ${fmtMoney(Number(ticket.monto))}?`)) return
    setActionLoading(true)
    const { error } = await supabase
      .from('caja_chica_tickets')
      .update({ estatus: 'pagado' })
      .eq('id', ticket.id)
    if (error) alert('Error: ' + error.message)
    else {
      setSelected(null)
      await load()
    }
    setActionLoading(false)
  }

  if (loading) return <Loading />


  return (
    <div>
      <SectionHeader
        title="Caja Chica"
        subtitle="Tickets de gastos subidos por los instaladores — aprobación y vinculación a nómina"
      />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard
          label="Pendiente por aprobar"
          value={fmtMoney(kpis.pendiente_monto)}
          color="#f59e0b"
          icon={<Clock size={16} />}
        />
        <KpiCard
          label="Aprobado por pagar"
          value={fmtMoney(kpis.aprobado_monto)}
          color="#3b82f6"
          icon={<CheckCircle2 size={16} />}
        />
        <KpiCard
          label="Pagado este mes"
          value={fmtMoney(kpis.pagado_mes_monto)}
          color="#57FF9A"
          icon={<DollarSign size={16} />}
        />
        <KpiCard
          label="Total tickets"
          value={kpis.total_count}
          icon={<Receipt size={16} />}
        />
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', gap: 4, marginRight: 4 }}>
          <Filter size={12} /> Filtros
        </div>
        <select
          value={filterEstatus}
          onChange={e => setFilterEstatus(e.target.value)}
          style={{
            padding: '8px 12px', background: '#0f0f0f', border: '1px solid #1f1f1f',
            borderRadius: 8, color: '#eee', fontSize: 12, cursor: 'pointer',
          }}
        >
          <option value="todos">Todos los estatus</option>
          <option value="pendiente">Pendiente</option>
          <option value="aprobado">Aprobado</option>
          <option value="pagado">Pagado</option>
          <option value="rechazado">Rechazado</option>
        </select>
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
          value={filterCategoria}
          onChange={e => setFilterCategoria(e.target.value)}
          style={{
            padding: '8px 12px', background: '#0f0f0f', border: '1px solid #1f1f1f',
            borderRadius: 8, color: '#eee', fontSize: 12, cursor: 'pointer',
          }}
        >
          <option value="todos">Todas las categorías</option>
          {Object.entries(CATEGORIAS).map(([k, v]) => (
            <option key={k} value={k}>{v.emoji} {v.label}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: '#888' }}>
          Mostrando {filtered.length} de {tickets.length}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No hay tickets que coincidan con los filtros." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Empleado</Th>
              <Th>Obra</Th>
              <Th>Categoría</Th>
              <Th>Concepto</Th>
              <Th right>Monto</Th>
              <Th>Foto</Th>
              <Th>Estatus</Th>
              <Th>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => {
              const cat = CATEGORIAS[t.categoria || 'otro'] || CATEGORIAS.otro
              const foto = fotoUrl(t.foto_storage_path) || t.comprobante_url
              return (
                <tr
                  key={t.id}
                  style={{ borderBottom: '1px solid #161616', cursor: 'pointer' }}
                  onClick={() => setSelected(t)}
                  onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = '#0f0f0f'}
                  onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  <Td muted>{fmtDate(t.fecha)}</Td>
                  <Td><span style={{ color: '#eee', fontWeight: 500 }}>{t.empleado?.nombre || '—'}</span></Td>
                  <Td muted>{t.obra?.nombre || '—'}</Td>
                  <Td>
                    <span style={{ fontSize: 13 }}>{cat.emoji}</span>
                    <span style={{ marginLeft: 6, color: '#ccc' }}>{cat.label}</span>
                  </Td>
                  <Td muted style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.concepto || '—'}
                  </Td>
                  <Td right>
                    <span style={{ color: '#eee', fontWeight: 600 }}>{fmtMoney(Number(t.monto))}</span>
                  </Td>
                  <Td>
                    {foto ? (
                      <img src={foto} alt="" style={{
                        width: 36, height: 36, borderRadius: 6, objectFit: 'cover',
                        border: '1px solid #2a2a2a',
                      }} />
                    ) : (
                      <span style={{ color: '#555', fontSize: 11 }}>sin foto</span>
                    )}
                  </Td>
                  <Td>
                    <Badge
                      label={t.estatus.toUpperCase()}
                      color={STATUS_COLORS[t.estatus] || '#666'}
                    />
                  </Td>
                  <Td>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={(e?: any) => { e?.stopPropagation?.(); setSelected(t) }}
                    >
                      <Eye size={13} /> Ver
                    </Btn>
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
              borderRadius: 16, maxWidth: 720, width: '100%',
              maxHeight: '90vh', overflow: 'auto',
              padding: 24,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  Ticket de caja chica
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#eee' }}>
                  {fmtMoney(Number(selected.monto))}
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

            <div style={{ display: 'grid', gridTemplateColumns: selected.foto_storage_path ? '1fr 1fr' : '1fr', gap: 20, marginBottom: 20 }}>
              {selected.foto_storage_path && (
                <div>
                  <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Foto del ticket</div>
                  {(() => {
                    const url = fotoUrl(selected.foto_storage_path) || selected.comprobante_url
                    return url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        <img src={url} alt="" style={{
                          width: '100%', borderRadius: 10,
                          border: '1px solid #2a2a2a',
                          maxHeight: 400, objectFit: 'contain', background: '#1a1a1a',
                        }} />
                      </a>
                    ) : <span style={{ color: '#555', fontSize: 12 }}>sin foto</span>
                  })()}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                    <User size={10} style={{ display: 'inline', marginRight: 4 }} />
                    Empleado
                  </div>
                  <div style={{ fontSize: 14, color: '#eee' }}>{selected.empleado?.nombre || '—'}</div>
                  {selected.empleado?.puesto && (
                    <div style={{ fontSize: 11, color: '#888' }}>{selected.empleado.puesto}</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                    <Calendar size={10} style={{ display: 'inline', marginRight: 4 }} />
                    Fecha
                  </div>
                  <div style={{ fontSize: 14, color: '#eee' }}>{fmtDate(selected.fecha)}</div>
                </div>
                {selected.obra && (
                  <div>
                    <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                      <MapPin size={10} style={{ display: 'inline', marginRight: 4 }} />
                      Obra
                    </div>
                    <div style={{ fontSize: 14, color: '#eee' }}>{selected.obra.nombre}</div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Categoría</div>
                  <div style={{ fontSize: 14, color: '#eee' }}>
                    {CATEGORIAS[selected.categoria || 'otro']?.emoji} {CATEGORIAS[selected.categoria || 'otro']?.label || 'Otro'}
                  </div>
                </div>
                {selected.concepto && (
                  <div>
                    <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Concepto</div>
                    <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{selected.concepto}</div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Estatus</div>
                  <Badge label={selected.estatus.toUpperCase()} color={STATUS_COLORS[selected.estatus] || '#666'} />
                </div>
                {selected.rechazo_motivo && (
                  <div>
                    <div style={{ fontSize: 10, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Motivo rechazo</div>
                    <div style={{ fontSize: 12, color: '#fca5a5', fontStyle: 'italic' }}>{selected.rechazo_motivo}</div>
                  </div>
                )}
                {selected.aprobado_at && (
                  <div>
                    <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Procesado</div>
                    <div style={{ fontSize: 11, color: '#888' }}>
                      {selected.aprobado_por} · {new Date(selected.aprobado_at).toLocaleString('es-MX')}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #1a1a1a', paddingTop: 16 }}>
              {selected.estatus === 'pendiente' && (
                <>
                  <Btn variant="danger" onClick={() => handleRechazar(selected)} disabled={actionLoading}>
                    <ThumbsDown size={13} /> Rechazar
                  </Btn>
                  <Btn variant="primary" onClick={() => handleAprobar(selected)} disabled={actionLoading}>
                    <ThumbsUp size={13} /> Aprobar
                  </Btn>
                </>
              )}
              {selected.estatus === 'aprobado' && (
                <Btn variant="primary" onClick={() => handleMarcarPagado(selected)} disabled={actionLoading}>
                  <DollarSign size={13} /> Marcar como pagado
                </Btn>
              )}
              {(selected.estatus === 'pagado' || selected.estatus === 'rechazado') && (
                <Btn variant="ghost" onClick={() => setSelected(null)}>Cerrar</Btn>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
