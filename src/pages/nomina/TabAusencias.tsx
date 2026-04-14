import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Btn, Table, Th, Td, Loading, KpiCard, SectionHeader, EmptyState, Badge } from '../../components/layout/UI'
import {
  Calendar, CheckCircle2, XCircle, Clock, AlertCircle,
  Filter, X, Eye, ThumbsUp, ThumbsDown, User, FileText
} from 'lucide-react'

interface Ausencia {
  id: string
  employee_id: string
  tipo: string
  fecha_inicio: string
  fecha_fin: string
  dias_solicitados: number
  motivo: string
  quien_cubre: string | null
  quien_cubre_nombre: string | null
  status: string
  aprobado_por: string | null
  aprobado_por_nombre: string | null
  aprobado_at: string | null
  rechazo_motivo: string | null
  solicitado_at: string | null
  created_at: string
}

interface Employee {
  id: string
  nombre_completo: string
  puesto: string | null
}

type TipoAusencia = 'all' | 'vacaciones' | 'permiso_con_goce' | 'permiso_sin_goce' | 'incapacidad'
type StatusFilter = 'all' | 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada'

const TIPO_LABELS: Record<string, string> = {
  vacaciones: 'Vacaciones',
  permiso_con_goce: 'Permiso con goce',
  permiso_sin_goce: 'Permiso sin goce',
  incapacidad: 'Incapacidad',
}

const TIPO_COLORS: Record<string, string> = {
  vacaciones: 'bg-blue-100 text-blue-800 border-blue-200',
  permiso_con_goce: 'bg-green-100 text-green-800 border-green-200',
  permiso_sin_goce: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  incapacidad: 'bg-red-100 text-red-800 border-red-200',
}

const STATUS_COLORS: Record<string, string> = {
  pendiente: 'bg-amber-100 text-amber-800 border-amber-200',
  aprobada: 'bg-green-100 text-green-800 border-green-200',
  rechazada: 'bg-red-100 text-red-800 border-red-200',
  cancelada: 'bg-gray-100 text-gray-800 border-gray-200',
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function dateRange(inicio: string, fin: string): string {
  if (inicio === fin) return fmtDate(inicio)
  return fmtDate(inicio) + ' → ' + fmtDate(fin)
}

export default function TabAusencias() {
  const [ausencias, setAusencias] = useState<Ausencia[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [tipoFilter, setTipoFilter] = useState<TipoAusencia>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pendiente')
  const [selected, setSelected] = useState<Ausencia | null>(null)
  const [showRejectModal, setShowRejectModal] = useState<Ausencia | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  async function loadData() {
    setLoading(true)
    const [ausR, empR] = await Promise.all([
      supabase.from('ausencias').select('*').order('solicitado_at', { ascending: false }),
      supabase.from('employees').select('id, nombre_completo, puesto'),
    ])
    if (ausR.data) setAusencias(ausR.data as Ausencia[])
    if (empR.data) setEmployees(empR.data as Employee[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const empMap = useMemo(() => {
    const m: Record<string, Employee> = {}
    for (const e of employees) m[e.id] = e
    return m
  }, [employees])

  const filtered = useMemo(() => {
    return ausencias.filter(a => {
      if (tipoFilter !== 'all' && a.tipo !== tipoFilter) return false
      if (statusFilter !== 'all' && a.status !== statusFilter) return false
      return true
    })
  }, [ausencias, tipoFilter, statusFilter])

  const kpis = useMemo(() => {
    const pend = ausencias.filter(a => a.status === 'pendiente')
    const apr = ausencias.filter(a => a.status === 'aprobada')
    const rech = ausencias.filter(a => a.status === 'rechazada')
    const diasPendientes = pend.reduce((s, a) => s + (a.dias_solicitados || 0), 0)
    const diasAprobados = apr.reduce((s, a) => s + (a.dias_solicitados || 0), 0)
    // count vacaciones approved this year
    const year = new Date().getFullYear()
    const vacThisYear = apr.filter(a => a.tipo === 'vacaciones' && new Date(a.fecha_inicio).getFullYear() === year).length
    return {
      total: ausencias.length,
      pendientes: pend.length,
      aprobadas: apr.length,
      rechazadas: rech.length,
      diasPendientes,
      diasAprobados,
      vacThisYear,
    }
  }, [ausencias])

  async function handleApprove(a: Ausencia) {
    setActionLoading(true)
    const { error } = await supabase
      .from('ausencias')
      .update({
        status: 'aprobada',
        aprobado_at: new Date().toISOString(),
        aprobado_por_nombre: 'Admin',
      })
      .eq('id', a.id)
    setActionLoading(false)
    if (error) {
      alert('Error al aprobar: ' + error.message)
      return
    }
    setSelected(null)
    await loadData()
  }

  async function handleReject(a: Ausencia, motivo: string) {
    if (!motivo.trim()) {
      alert('Debes indicar un motivo de rechazo')
      return
    }
    setActionLoading(true)
    const { error } = await supabase
      .from('ausencias')
      .update({
        status: 'rechazada',
        rechazo_motivo: motivo,
        aprobado_at: new Date().toISOString(),
        aprobado_por_nombre: 'Admin',
      })
      .eq('id', a.id)
    setActionLoading(false)
    if (error) {
      alert('Error al rechazar: ' + error.message)
      return
    }
    setShowRejectModal(null)
    setSelected(null)
    setRejectReason('')
    await loadData()
  }

  if (loading) return <Loading />

  return (
    <div className="space-y-6">
      <SectionHeader title="Ausencias" subtitle="Gestión de solicitudes de vacaciones, permisos e incapacidades" />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="PENDIENTES"
          value={String(kpis.pendientes)}
          hint={kpis.diasPendientes + ' días solicitados'}
        />
        <KpiCard
          label="APROBADAS"
          value={String(kpis.aprobadas)}
          hint={kpis.diasAprobados + ' días aprobados'}
        />
        <KpiCard
          label="RECHAZADAS"
          value={String(kpis.rechazadas)}
        />
        <KpiCard
          label={"VACACIONES " + new Date().getFullYear()}
          value={String(kpis.vacThisYear)}
          hint="aprobadas este año"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-white border border-gray-200 rounded-lg">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filtros:</span>
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
        >
          <option value="all">Todos los estados</option>
          <option value="pendiente">Pendientes</option>
          <option value="aprobada">Aprobadas</option>
          <option value="rechazada">Rechazadas</option>
          <option value="cancelada">Canceladas</option>
        </select>
        <select
          value={tipoFilter}
          onChange={e => setTipoFilter(e.target.value as TipoAusencia)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
        >
          <option value="all">Todos los tipos</option>
          <option value="vacaciones">Vacaciones</option>
          <option value="permiso_con_goce">Permiso con goce</option>
          <option value="permiso_sin_goce">Permiso sin goce</option>
          <option value="incapacidad">Incapacidad</option>
        </select>
        {(tipoFilter !== 'all' || statusFilter !== 'pendiente') && (
          <button
            onClick={() => { setTipoFilter('all'); setStatusFilter('pendiente') }}
            className="text-xs text-blue-600 hover:underline"
          >
            Limpiar
          </button>
        )}
        <div className="ml-auto text-sm text-gray-500">
          {filtered.length} de {ausencias.length}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          title="Sin solicitudes"
          description="No hay ausencias que coincidan con los filtros seleccionados"
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Empleado</Th>
                <Th>Tipo</Th>
                <Th>Fechas</Th>
                <Th>Días</Th>
                <Th>Motivo</Th>
                <Th>Cubre</Th>
                <Th>Estado</Th>
                <Th>Solicitado</Th>
                <Th>Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const emp = empMap[a.employee_id]
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <Td>
                      <div className="flex items-center gap-2">
                        <User size={14} className="text-gray-400" />
                        <div>
                          <div className="font-medium text-sm">{emp ? emp.nombre_completo : '—'}</div>
                          {emp && emp.puesto && <div className="text-xs text-gray-500">{emp.puesto}</div>}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <span className={'inline-flex px-2 py-0.5 text-xs font-medium rounded border ' + (TIPO_COLORS[a.tipo] || '')}>
                        {TIPO_LABELS[a.tipo] || a.tipo}
                      </span>
                    </Td>
                    <Td><span className="text-sm">{dateRange(a.fecha_inicio, a.fecha_fin)}</span></Td>
                    <Td><span className="font-semibold">{a.dias_solicitados}</span></Td>
                    <Td>
                      <div className="max-w-xs text-sm text-gray-700 truncate" title={a.motivo}>{a.motivo}</div>
                    </Td>
                    <Td>
                      <span className="text-sm text-gray-600">{a.quien_cubre_nombre || '—'}</span>
                    </Td>
                    <Td>
                      <span className={'inline-flex px-2 py-0.5 text-xs font-medium rounded border ' + (STATUS_COLORS[a.status] || '')}>
                        {a.status.toUpperCase()}
                      </span>
                    </Td>
                    <Td><span className="text-xs text-gray-500">{fmtDateTime(a.solicitado_at)}</span></Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setSelected(a)}
                          className="p-1.5 hover:bg-gray-100 rounded"
                          title="Ver detalle"
                        >
                          <Eye size={14} />
                        </button>
                        {a.status === 'pendiente' && (
                          <>
                            <button
                              onClick={() => handleApprove(a)}
                              disabled={actionLoading}
                              className="p-1.5 hover:bg-green-50 text-green-600 rounded disabled:opacity-50"
                              title="Aprobar"
                            >
                              <ThumbsUp size={14} />
                            </button>
                            <button
                              onClick={() => { setShowRejectModal(a); setRejectReason('') }}
                              disabled={actionLoading}
                              className="p-1.5 hover:bg-red-50 text-red-600 rounded disabled:opacity-50"
                              title="Rechazar"
                            >
                              <ThumbsDown size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Calendar size={18} />
                Detalle de ausencia
              </h3>
              <button onClick={() => setSelected(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Empleado</div>
                <div className="text-sm font-medium">
                  {empMap[selected.employee_id] ? empMap[selected.employee_id].nombre_completo : '—'}
                </div>
                {empMap[selected.employee_id] && empMap[selected.employee_id].puesto && (
                  <div className="text-xs text-gray-500">{empMap[selected.employee_id].puesto}</div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tipo</div>
                  <span className={'inline-flex px-2 py-0.5 text-xs font-medium rounded border ' + (TIPO_COLORS[selected.tipo] || '')}>
                    {TIPO_LABELS[selected.tipo] || selected.tipo}
                  </span>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Estado</div>
                  <span className={'inline-flex px-2 py-0.5 text-xs font-medium rounded border ' + (STATUS_COLORS[selected.status] || '')}>
                    {selected.status.toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Inicio</div>
                  <div className="text-sm">{fmtDate(selected.fecha_inicio)}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Fin</div>
                  <div className="text-sm">{fmtDate(selected.fecha_fin)}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Días</div>
                  <div className="text-lg font-semibold">{selected.dias_solicitados}</div>
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1 flex items-center gap-1">
                  <FileText size={12} />
                  Motivo
                </div>
                <div className="text-sm text-gray-800 bg-gray-50 p-3 rounded border border-gray-200">{selected.motivo}</div>
              </div>

              {selected.quien_cubre_nombre && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Quien cubre</div>
                  <div className="text-sm">{selected.quien_cubre_nombre}</div>
                </div>
              )}

              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Solicitado</div>
                <div className="text-sm text-gray-600">{fmtDateTime(selected.solicitado_at)}</div>
              </div>

              {selected.aprobado_at && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">
                    {selected.status === 'aprobada' ? 'Aprobado' : 'Rechazado'}
                  </div>
                  <div className="text-sm text-gray-600">
                    {fmtDateTime(selected.aprobado_at)}
                    {selected.aprobado_por_nombre && ' · ' + selected.aprobado_por_nombre}
                  </div>
                </div>
              )}

              {selected.rechazo_motivo && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1 flex items-center gap-1">
                    <AlertCircle size={12} className="text-red-500" />
                    Motivo de rechazo
                  </div>
                  <div className="text-sm text-red-800 bg-red-50 p-3 rounded border border-red-200">{selected.rechazo_motivo}</div>
                </div>
              )}

              {selected.status === 'pendiente' && (
                <div className="flex gap-2 pt-4 border-t border-gray-200">
                  <Btn variant="primary" onClick={() => handleApprove(selected)} disabled={actionLoading}>
                    <CheckCircle2 size={14} className="mr-1" />
                    Aprobar
                  </Btn>
                  <Btn variant="danger" onClick={() => { setShowRejectModal(selected); setRejectReason('') }} disabled={actionLoading}>
                    <XCircle size={14} className="mr-1" />
                    Rechazar
                  </Btn>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowRejectModal(null)}>
          <div className="bg-white rounded-lg max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold flex items-center gap-2 text-red-700">
                <XCircle size={18} />
                Rechazar solicitud
              </h3>
              <button onClick={() => setShowRejectModal(null)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-sm text-gray-700">
                Vas a rechazar la solicitud de <strong>{empMap[showRejectModal.employee_id] ? empMap[showRejectModal.employee_id].nombre_completo : '—'}</strong> por <strong>{showRejectModal.dias_solicitados} día(s)</strong> de {TIPO_LABELS[showRejectModal.tipo] || showRejectModal.tipo}.
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase block mb-1">Motivo de rechazo *</label>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  rows={4}
                  placeholder="Explica por qué se rechaza la solicitud..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Btn variant="secondary" onClick={() => setShowRejectModal(null)} disabled={actionLoading}>
                  Cancelar
                </Btn>
                <Btn variant="danger" onClick={() => handleReject(showRejectModal, rejectReason)} disabled={actionLoading || !rejectReason.trim()}>
                  Confirmar rechazo
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
