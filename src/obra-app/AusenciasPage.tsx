import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  ArrowLeft, Plus, Plane, Heart, Loader2, CheckCircle2, AlertCircle,
  Calendar, Clock, XCircle, Send, ChevronRight, AlertTriangle
} from 'lucide-react'

interface Ausencia {
  id: string
  tipo: string
  fecha_inicio: string
  fecha_fin: string
  dias_solicitados: number
  motivo: string
  quien_cubre_nombre: string | null
  status: string
  aprobado_por_nombre: string | null
  rechazo_motivo: string | null
  solicitado_at: string
}

interface Empleado {
  id: string
  nombre: string
}

// Calculate vacation days per LFT (Mexico)
// Year 1: 12, Year 2: 14, Year 3: 16, Year 4: 18, Year 5: 20, +2 every 5 years
function calcDiasVacaciones(fechaIngreso: string | null): { dias: number; antiguedad_anios: number } {
  if (!fechaIngreso) return { dias: 12, antiguedad_anios: 0 }
  const ingreso = new Date(fechaIngreso)
  const hoy = new Date()
  const anios = Math.floor((hoy.getTime() - ingreso.getTime()) / (1000 * 60 * 60 * 24 * 365.25))
  if (anios < 1) return { dias: 12, antiguedad_anios: anios }
  if (anios === 1) return { dias: 14, antiguedad_anios: anios }
  if (anios === 2) return { dias: 16, antiguedad_anios: anios }
  if (anios === 3) return { dias: 18, antiguedad_anios: anios }
  if (anios === 4) return { dias: 20, antiguedad_anios: anios }
  // 5+: 20 + 2 per every 5 completed years
  const extra = Math.floor((anios - 5) / 5) * 2 + 2
  return { dias: 20 + extra, antiguedad_anios: anios }
}

const TIPOS = [
  { value: 'vacaciones', label: 'Vacaciones', icon: Plane, color: '#57FF9A', anticipoDias: 10 },
  { value: 'permiso_con_goce', label: 'Permiso con goce', icon: Calendar, color: '#3b82f6', anticipoDias: 0 },
  { value: 'permiso_sin_goce', label: 'Permiso sin goce', icon: Calendar, color: '#f59e0b', anticipoDias: 0 },
  { value: 'incapacidad', label: 'Incapacidad', icon: Heart, color: '#ef4444', anticipoDias: 0 },
]

export default function AusenciasPage({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate()
  const [ausencias, setAusencias] = useState<Ausencia[]>([])
  const [fechaIngreso, setFechaIngreso] = useState<string | null>(null)
  const [otrosEmpleados, setOtrosEmpleados] = useState<Empleado[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Form
  const [tipo, setTipo] = useState('vacaciones')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [motivo, setMotivo] = useState('')
  const [quienCubre, setQuienCubre] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const load = async () => {
    setLoading(true)
    const { data: emp } = await supabase
      .from('employees')
      .select('fecha_ingreso')
      .eq('id', employeeId)
      .single()
    setFechaIngreso(emp?.fecha_ingreso || null)

    const { data: aus } = await supabase
      .from('ausencias')
      .select('*')
      .eq('employee_id', employeeId)
      .order('solicitado_at', { ascending: false })
      .limit(30)
    setAusencias((aus as any) || [])

    // Load other employees for "quien cubre"
    const { data: others } = await supabase
      .from('employees')
      .select('id, nombre')
      .eq('activo', true)
      .neq('id', employeeId)
      .order('nombre')
    setOtrosEmpleados((others as any) || [])

    setLoading(false)
  }

  useEffect(() => { load() }, [employeeId])


  const vacInfo = calcDiasVacaciones(fechaIngreso)
  // Count vacation days used this year
  const thisYear = new Date().getFullYear()
  const diasUsados = ausencias
    .filter(a => a.tipo === 'vacaciones' && a.status === 'aprobada')
    .filter(a => new Date(a.fecha_inicio).getFullYear() === thisYear)
    .reduce((sum, a) => sum + a.dias_solicitados, 0)
  const diasDisponibles = Math.max(0, vacInfo.dias - diasUsados)

  const calcularDias = (inicio: string, fin: string): number => {
    if (!inicio || !fin) return 0
    const d1 = new Date(inicio)
    const d2 = new Date(fin)
    if (d2 < d1) return 0
    return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1
  }

  const diasCalculados = calcularDias(fechaInicio, fechaFin)
  const tipoConfig = TIPOS.find(t => t.value === tipo)!

  // Validate anticipation
  const diasAnticipacion = fechaInicio ?
    Math.floor((new Date(fechaInicio).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : 0
  const anticipacionInvalida = tipo === 'vacaciones' && diasAnticipacion < 10

  const handleSubmit = async () => {
    if (!fechaInicio || !fechaFin) {
      alert('Ingresa fechas de inicio y fin')
      return
    }
    if (!motivo.trim()) {
      alert('Ingresa el motivo')
      return
    }
    if (diasCalculados <= 0) {
      alert('Las fechas no son válidas')
      return
    }
    if (tipo === 'vacaciones' && diasCalculados > diasDisponibles) {
      alert(`Solo tienes ${diasDisponibles} días disponibles de vacaciones`)
      return
    }
    if (anticipacionInvalida) {
      if (!confirm('Las vacaciones se piden con 10 días de anticipación mínimo. ¿Enviar de todos modos?')) return
    }

    setSubmitting(true)
    setResult(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const quienCubreEmp = otrosEmpleados.find(e => e.id === quienCubre)
      const { error } = await supabase.from('ausencias').insert({
        employee_id: employeeId,
        auth_user_id: session?.user.id,
        tipo,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        dias_solicitados: diasCalculados,
        motivo: motivo.trim(),
        quien_cubre: quienCubre || null,
        quien_cubre_nombre: quienCubreEmp?.nombre || null,
        status: 'pendiente',
      })
      if (error) throw new Error(error.message)
      setResult({ ok: true, msg: 'Solicitud enviada. Espera la aprobación.' })
      setTimeout(() => {
        setShowForm(false)
        setTipo('vacaciones')
        setFechaInicio('')
        setFechaFin('')
        setMotivo('')
        setQuienCubre('')
        setResult(null)
        load()
      }, 1800)
    } catch (e: any) {
      setResult({ ok: false, msg: e.message })
      setSubmitting(false)
    }
  }

  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })


  if (showForm) {
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
            onClick={() => setShowForm(false)}
            style={{ background: 'transparent', border: '1px solid #1f1f1f', borderRadius: 10, padding: 10, cursor: 'pointer', color: '#fff' }}
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Nueva solicitud</div>
            <div style={{ fontSize: 11, color: '#666' }}>Vacaciones, permisos, incapacidad</div>
          </div>
        </div>

        {/* Tipo */}
        <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Tipo</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
          {TIPOS.map(t => {
            const Icon = t.icon
            const active = tipo === t.value
            return (
              <button
                key={t.value}
                onClick={() => setTipo(t.value)}
                style={{
                  padding: '12px 8px',
                  background: active ? '#0f2a1a' : '#0f0f0f',
                  border: `1px solid ${active ? t.color : '#1f1f1f'}`,
                  borderRadius: 10,
                  color: active ? t.color : '#888',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                }}
              >
                <Icon size={18} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Fechas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Desde</label>
            <input
              type="date"
              value={fechaInicio}
              onChange={e => setFechaInicio(e.target.value)}
              style={{
                width: '100%', padding: '14px 12px',
                background: '#0f0f0f', border: '1px solid #1f1f1f',
                borderRadius: 10, color: '#fff', fontSize: 14,
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Hasta</label>
            <input
              type="date"
              value={fechaFin}
              onChange={e => setFechaFin(e.target.value)}
              style={{
                width: '100%', padding: '14px 12px',
                background: '#0f0f0f', border: '1px solid #1f1f1f',
                borderRadius: 10, color: '#fff', fontSize: 14,
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {diasCalculados > 0 && (
          <div style={{
            padding: 10, marginBottom: 16,
            background: '#0f2a1a', border: '1px solid #1f3a2a',
            borderRadius: 10, fontSize: 13, color: '#57FF9A', textAlign: 'center',
          }}>
            {diasCalculados} {diasCalculados === 1 ? 'día solicitado' : 'días solicitados'}
            {tipo === 'vacaciones' && ` · quedarían ${diasDisponibles - diasCalculados} de ${vacInfo.dias}`}
          </div>
        )}

        {anticipacionInvalida && (
          <div style={{
            padding: 12, marginBottom: 16,
            background: '#2a1f0f', border: '1px solid #5a3a1f',
            borderRadius: 10, display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: '#fcd34d', lineHeight: 1.5 }}>
              Las vacaciones se piden con 10 días de anticipación mínimo. Estás pidiendo con {diasAnticipacion} días.
            </div>
          </div>
        )}

        {/* Motivo */}
        <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Motivo</label>
        <textarea
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          placeholder={tipo === 'vacaciones' ? 'Ej: descanso familiar' : tipo === 'incapacidad' ? 'Motivo médico' : 'Razón del permiso'}
          rows={3}
          style={{
            width: '100%', padding: '14px 16px', marginBottom: 16,
            background: '#0f0f0f', border: '1px solid #1f1f1f',
            borderRadius: 10, color: '#fff', fontSize: 14,
            boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit',
          }}
        />

        {/* Quien cubre */}
        <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          ¿Quién te cubre? (opcional)
        </label>
        <select
          value={quienCubre}
          onChange={e => setQuienCubre(e.target.value)}
          style={{
            width: '100%', padding: '14px 16px', marginBottom: 20,
            background: '#0f0f0f', border: '1px solid #1f1f1f',
            borderRadius: 10, color: '#fff', fontSize: 14,
            boxSizing: 'border-box',
          }}
        >
          <option value="">Nadie / no aplica</option>
          {otrosEmpleados.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>

        {result && (
          <div style={{
            padding: 12, marginBottom: 16, borderRadius: 10,
            background: result.ok ? '#0f2a1a' : '#3a1a1a',
            border: `1px solid ${result.ok ? '#2a5a3a' : '#5a2a2a'}`,
            color: result.ok ? '#57FF9A' : '#fca5a5',
            fontSize: 13, display: 'flex', gap: 8, alignItems: 'center',
          }}>
            {result.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {result.msg}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            width: '100%', padding: '18px',
            background: submitting ? '#3a5f48' : '#57FF9A',
            color: '#0a0a0a', border: 'none',
            borderRadius: 14, fontSize: 16, fontWeight: 700,
            cursor: submitting ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}
        >
          {submitting ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
          {submitting ? 'Enviando...' : 'Enviar solicitud'}
        </button>

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          .spin { animation: spin 1s linear infinite; }
        `}</style>
      </div>
    )
  }

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
          <div style={{ fontSize: 18, fontWeight: 700 }}>Ausencias</div>
          <div style={{ fontSize: 11, color: '#666' }}>Vacaciones, permisos, incapacidad</div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          style={{
            background: '#57FF9A', border: 'none',
            borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
            color: '#0a0a0a', fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Plus size={16} /> Nueva
        </button>
      </div>

      {/* Vacaciones KPI */}
      <div style={{
        padding: 16, marginBottom: 16,
        background: 'linear-gradient(135deg, #0f1a12 0%, #0a1a15 100%)',
        border: '1px solid #1f3a2a', borderRadius: 14,
      }}>
        <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          Vacaciones disponibles {thisYear}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#57FF9A' }}>
            {diasDisponibles}
          </div>
          <div style={{ fontSize: 14, color: '#888' }}>de {vacInfo.dias} días</div>
        </div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
          {diasUsados} días usados · {vacInfo.antiguedad_anios} {vacInfo.antiguedad_anios === 1 ? 'año' : 'años'} de antigüedad
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Loader2 size={24} className="spin" />
        </div>
      ) : ausencias.length === 0 ? (
        <div style={{
          padding: 32, textAlign: 'center',
          background: '#1a1a1a', border: '1px solid #2a2a2a',
          borderRadius: 16, color: '#888', fontSize: 13,
        }}>
          <Plane size={32} style={{ marginBottom: 10, opacity: 0.3 }} />
          <div style={{ marginBottom: 16 }}>No has solicitado ausencias</div>
          <button
            onClick={() => setShowForm(true)}
            style={{
              background: '#57FF9A', border: 'none',
              borderRadius: 10, padding: '12px 18px', cursor: 'pointer',
              color: '#0a0a0a', fontSize: 13, fontWeight: 700,
            }}
          >
            Nueva solicitud
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ausencias.map(a => {
            const cfg = TIPOS.find(t => t.value === a.tipo) || TIPOS[0]
            const Icon = cfg.icon
            const statusColor = a.status === 'aprobada' ? '#57FF9A' :
                                a.status === 'rechazada' ? '#ef4444' :
                                a.status === 'cancelada' ? '#666' : '#f59e0b'
            return (
              <div key={a.id} style={{
                background: '#0f0f0f',
                border: '1px solid #1a1a1a',
                borderLeft: `3px solid ${cfg.color}`,
                borderRadius: 12,
                padding: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <Icon size={16} color={cfg.color} />
                  <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{cfg.label}</div>
                  <div style={{
                    fontSize: 9, color: statusColor, textTransform: 'uppercase', fontWeight: 700,
                    padding: '2px 8px', borderRadius: 8,
                    background: statusColor + '22',
                  }}>
                    {a.status}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#ccc', marginBottom: 4 }}>
                  {fmtDate(a.fecha_inicio)} — {fmtDate(a.fecha_fin)} · {a.dias_solicitados} {a.dias_solicitados === 1 ? 'día' : 'días'}
                </div>
                <div style={{ fontSize: 11, color: '#888', lineHeight: 1.4 }}>{a.motivo}</div>
                {a.quien_cubre_nombre && (
                  <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>
                    Cubre: {a.quien_cubre_nombre}
                  </div>
                )}
                {a.rechazo_motivo && (
                  <div style={{ fontSize: 10, color: '#ef4444', marginTop: 4, fontStyle: 'italic' }}>
                    Motivo rechazo: {a.rechazo_motivo}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
