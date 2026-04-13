import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getWorkDate } from './lib/workDate'
import { formatDistance } from './lib/geolocation'
import {
  ArrowLeft, Clock, TrendingUp, AlertTriangle, Calendar,
  CheckCircle2, XCircle, Loader2, Info
} from 'lucide-react'

interface Attendance {
  id: string
  fecha: string
  tipo: 'entrada' | 'salida'
  hora: string
  status: string
  distancia_obra_metros: number | null
  obras: { id: string; nombre: string } | null
}

interface DaySummary {
  fecha: string
  entrada: Attendance | null
  salida: Attendance | null
  retardo_min: number
  extras_min: number
  obra_nombre: string | null
  sin_salida: boolean
}

// Nomina rules:
// - Tolerance until 9:00 AM (9:01+ = retardo)
// - Extras after 18:00 (x1 normal, x2 weekends)
// - Retardos <=3h/month: x2 discount, >3h/month: x3 discount
// - No salida = no extras counted
function analyzeDay(fecha: string, entrada: Attendance | null, salida: Attendance | null): DaySummary {
  let retardo_min = 0
  let extras_min = 0
  const sin_salida = !!entrada && !salida

  if (entrada) {
    const e = new Date(entrada.hora)
    const nineAm = new Date(e)
    nineAm.setHours(9, 0, 0, 0)
    if (e > nineAm) {
      retardo_min = Math.round((e.getTime() - nineAm.getTime()) / 60000)
    }
  }

  if (entrada && salida) {
    const s = new Date(salida.hora)
    const sixPm = new Date(s)
    sixPm.setHours(18, 0, 0, 0)
    if (s > sixPm) {
      extras_min = Math.round((s.getTime() - sixPm.getTime()) / 60000)
    }
  }

  return {
    fecha,
    entrada,
    salida,
    retardo_min,
    extras_min,
    obra_nombre: entrada?.obras?.nombre || salida?.obras?.nombre || null,
    sin_salida,
  }
}


export default function MiAsistenciaPage({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate()
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'semana' | 'mes'>('mes')

  const load = async () => {
    setLoading(true)
    const now = new Date()
    let startDate: Date
    if (period === 'semana') {
      const day = now.getDay()
      const diff = now.getDate() - day + (day === 0 ? -6 : 1)
      startDate = new Date(now.getFullYear(), now.getMonth(), diff)
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    }
    const startStr = startDate.toISOString().slice(0, 10)

    const { data } = await supabase
      .from('installer_attendance')
      .select('id, fecha, tipo, hora, status, distancia_obra_metros, obras(id, nombre)')
      .eq('employee_id', employeeId)
      .gte('fecha', startStr)
      .order('fecha', { ascending: false })
      .order('hora', { ascending: true })
    setAttendance((data as any) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [employeeId, period])

  // Group by day
  const byDay = new Map<string, DaySummary>()
  for (const a of attendance) {
    if (!byDay.has(a.fecha)) {
      byDay.set(a.fecha, { fecha: a.fecha, entrada: null, salida: null, retardo_min: 0, extras_min: 0, obra_nombre: null, sin_salida: false })
    }
    const day = byDay.get(a.fecha)!
    if (a.tipo === 'entrada') day.entrada = a
    else if (a.tipo === 'salida') day.salida = a
  }
  // Analyze each day
  const days = Array.from(byDay.values()).map(d => analyzeDay(d.fecha, d.entrada, d.salida))

  // KPIs
  const diasTrabajados = days.filter(d => d.entrada).length
  const totalRetardoMin = days.reduce((a, d) => a + d.retardo_min, 0)
  const totalExtrasMin = days.reduce((a, d) => a + d.extras_min, 0)
  const diasConRetardo = days.filter(d => d.retardo_min > 0).length
  const diasSinSalida = days.filter(d => d.sin_salida).length
  const checkinsFueraRango = attendance.filter(a => a.status === 'fuera_de_rango').length

  // Alert level for retardos (max 3h/month = 180 min)
  const retardoAlert = totalRetardoMin === 0 ? 'ok' :
                       totalRetardoMin <= 180 ? 'warn' : 'danger'

  const fmtMin = (m: number) => {
    if (m === 0) return '0'
    const h = Math.floor(m / 60)
    const rem = m % 60
    if (h === 0) return `${rem} min`
    if (rem === 0) return `${h} h`
    return `${h}h ${rem}m`
  }

  const fmtDate = (d: string) => {
    const dt = new Date(d + 'T12:00:00')
    return dt.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  const fmtTime = (t: string) => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })


  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #0a0a0a 0%, #0f1a12 40%, #0a0a0a 100%)',
      color: '#fff',
      paddingTop: 'max(env(safe-area-inset-top), 20px)',
      paddingBottom: 40,
      paddingLeft: 16,
      paddingRight: 16,
      maxWidth: 480,
      margin: '0 auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => navigate('/obra-app')}
          style={{ background: 'transparent', border: '1px solid #1f1f1f', borderRadius: 10, padding: 10, cursor: 'pointer', color: '#fff' }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Mi asistencia</div>
          <div style={{ fontSize: 11, color: '#666' }}>Tus checadas y horas extras</div>
        </div>
      </div>

      {/* Period toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, background: '#0f0f0f', padding: 4, borderRadius: 10, border: '1px solid #1a1a1a' }}>
        <button
          onClick={() => setPeriod('semana')}
          style={{
            flex: 1, padding: '10px',
            background: period === 'semana' ? '#0f2a1a' : 'transparent',
            border: 'none', borderRadius: 8,
            color: period === 'semana' ? '#57FF9A' : '#666',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >Esta semana</button>
        <button
          onClick={() => setPeriod('mes')}
          style={{
            flex: 1, padding: '10px',
            background: period === 'mes' ? '#0f2a1a' : 'transparent',
            border: 'none', borderRadius: 8,
            color: period === 'mes' ? '#57FF9A' : '#666',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >Este mes</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Loader2 size={24} className="spin" />
        </div>
      ) : (
        <>
          {/* KPIs grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div style={{ padding: 14, background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Calendar size={13} color="#57FF9A" />
                <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>Días</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{diasTrabajados}</div>
              <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>trabajados</div>
            </div>

            <div style={{
              padding: 14,
              background: totalExtrasMin > 0 ? '#0f1a2a' : '#0f0f0f',
              border: `1px solid ${totalExtrasMin > 0 ? '#1f3a5a' : '#1a1a1a'}`,
              borderRadius: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <TrendingUp size={13} color="#3b82f6" />
                <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>Extras</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: totalExtrasMin > 0 ? '#3b82f6' : '#fff' }}>
                {fmtMin(totalExtrasMin)}
              </div>
              <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>acumuladas</div>
            </div>

            <div style={{
              padding: 14,
              background: retardoAlert === 'ok' ? '#0f0f0f' : retardoAlert === 'warn' ? '#2a1f0f' : '#3a1a1a',
              border: `1px solid ${retardoAlert === 'ok' ? '#1a1a1a' : retardoAlert === 'warn' ? '#5a3a1f' : '#5a2a2a'}`,
              borderRadius: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <AlertTriangle size={13} color={retardoAlert === 'ok' ? '#666' : retardoAlert === 'warn' ? '#f59e0b' : '#ef4444'} />
                <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>Retardos</span>
              </div>
              <div style={{
                fontSize: 22, fontWeight: 700,
                color: retardoAlert === 'ok' ? '#fff' : retardoAlert === 'warn' ? '#f59e0b' : '#ef4444'
              }}>
                {fmtMin(totalRetardoMin)}
              </div>
              <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                {diasConRetardo} {diasConRetardo === 1 ? 'día' : 'días'}
              </div>
            </div>

            <div style={{
              padding: 14,
              background: diasSinSalida > 0 ? '#2a1a2a' : '#0f0f0f',
              border: `1px solid ${diasSinSalida > 0 ? '#5a2a5a' : '#1a1a1a'}`,
              borderRadius: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <XCircle size={13} color={diasSinSalida > 0 ? '#c026d3' : '#666'} />
                <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>Sin salida</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: diasSinSalida > 0 ? '#c026d3' : '#fff' }}>
                {diasSinSalida}
              </div>
              <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>pierdes extras</div>
            </div>
          </div>

          {/* Alert banner for retardos */}
          {retardoAlert === 'warn' && (
            <div style={{
              padding: 12, marginBottom: 16,
              background: '#2a1f0f', border: '1px solid #5a3a1f',
              borderRadius: 10, display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, color: '#fcd34d', lineHeight: 1.5 }}>
                <strong>Cuidado con los retardos.</strong> Llevas {fmtMin(totalRetardoMin)} este {period === 'semana' ? 'semana' : 'mes'}. Si rebasas 3 horas en el mes, el descuento se triplica.
              </div>
            </div>
          )}
          {retardoAlert === 'danger' && (
            <div style={{
              padding: 12, marginBottom: 16,
              background: '#3a1a1a', border: '1px solid #5a2a2a',
              borderRadius: 10, display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <AlertTriangle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, color: '#fca5a5', lineHeight: 1.5 }}>
                <strong>Retardo excesivo.</strong> Rebasaste las 3 horas del mes ({fmtMin(totalRetardoMin)}). El descuento ya es triple.
              </div>
            </div>
          )}
          {diasSinSalida > 0 && (
            <div style={{
              padding: 12, marginBottom: 16,
              background: '#2a1a2a', border: '1px solid #5a2a5a',
              borderRadius: 10, display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <Info size={16} color="#c026d3" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, color: '#e9a3f5', lineHeight: 1.5 }}>
                <strong>Tienes {diasSinSalida} {diasSinSalida === 1 ? 'día sin salida' : 'días sin salida'}.</strong> Sin checar salida no se cuentan tus horas extras. Recuerda checar al terminar.
              </div>
            </div>
          )}
          {checkinsFueraRango > 0 && (
            <div style={{
              padding: 12, marginBottom: 16,
              background: '#2a1f0f', border: '1px solid #5a3a1f',
              borderRadius: 10, display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, color: '#fcd34d', lineHeight: 1.5 }}>
                {checkinsFueraRango} {checkinsFueraRango === 1 ? 'checada' : 'checadas'} fuera del rango de la obra. Quedan pendientes de aprobación.
              </div>
            </div>
          )}

          {/* Days list */}
          {days.length === 0 ? (
            <div style={{
              padding: 32, textAlign: 'center',
              background: '#1a1a1a', border: '1px solid #2a2a2a',
              borderRadius: 16, color: '#888', fontSize: 13,
            }}>
              <Clock size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
              <div>Sin checadas en este período</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {days.map(d => (
                <div key={d.fecha} style={{
                  background: '#0f0f0f',
                  border: '1px solid #1a1a1a',
                  borderLeft: d.sin_salida ? '3px solid #c026d3' : d.retardo_min > 0 ? '3px solid #f59e0b' : '3px solid #57FF9A',
                  borderRadius: 12,
                  padding: 14,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{fmtDate(d.fecha)}</div>
                    {d.obra_nombre && (
                      <div style={{ fontSize: 10, color: '#57FF9A', background: '#0f2a1a', padding: '2px 8px', borderRadius: 8, fontWeight: 600 }}>
                        {d.obra_nombre}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: d.retardo_min > 0 || d.extras_min > 0 || d.sin_salida ? 10 : 0 }}>
                    <div>
                      <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Entrada</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: d.entrada ? (d.retardo_min > 0 ? '#f59e0b' : '#fff') : '#555' }}>
                        {d.entrada ? fmtTime(d.entrada.hora) : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Salida</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: d.salida ? (d.extras_min > 0 ? '#3b82f6' : '#fff') : '#c026d3' }}>
                        {d.salida ? fmtTime(d.salida.hora) : d.sin_salida ? 'Sin checar' : '—'}
                      </div>
                    </div>
                  </div>
                  {(d.retardo_min > 0 || d.extras_min > 0) && (
                    <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                      {d.retardo_min > 0 && (
                        <span style={{ color: '#f59e0b' }}>
                          <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />
                          Retardo {fmtMin(d.retardo_min)}
                        </span>
                      )}
                      {d.extras_min > 0 && (
                        <span style={{ color: '#3b82f6' }}>
                          <TrendingUp size={11} style={{ display: 'inline', marginRight: 4 }} />
                          Extras {fmtMin(d.extras_min)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
