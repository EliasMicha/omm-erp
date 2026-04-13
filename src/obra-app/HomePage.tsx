import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCurrentPosition, haversineDistance, formatDistance } from './lib/geolocation'
import { getWorkDate } from './lib/workDate'
import {
  LogOut, MapPin, AlertCircle, CheckCircle2, Clock,
  FileText, Calendar, Package2, Receipt, Loader2,
  TrendingUp, Plane
} from 'lucide-react'

interface Employee {
  id: string
  nombre: string
  puesto: string | null
  area: string | null
  foto_url: string | null
}

interface Obra {
  id: string
  nombre: string
  latitude: number | null
  longitude: number | null
  direccion_completa: string | null
  direccion: string | null
  radio_checada_metros: number | null
}

interface TodayAssignment {
  id: string
  fecha: string
  tareas: string | null
  urgencia: string
  obras: Obra | null
}

interface AttendanceRecord {
  id: string
  tipo: 'entrada' | 'salida'
  hora: string
  status: string
  distancia_obra_metros: number | null
}

export default function HomePage({ employee, onLogout }: { employee: Employee; onLogout: () => void }) {
  const navigate = useNavigate()
  const [assignment, setAssignment] = useState<TodayAssignment | null>(null)
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [checkInState, setCheckInState] = useState<'idle' | 'locating' | 'uploading' | 'success' | 'error'>('idle')
  const [checkInMsg, setCheckInMsg] = useState('')

  const loadData = async () => {
    setLoading(true)
    const today = getWorkDate()

    const { data: asn } = await supabase
      .from('installer_daily_assignment')
      .select('id, fecha, tareas, urgencia, obras(id, nombre, latitude, longitude, direccion_completa, direccion, radio_checada_metros)')
      .eq('employee_id', employee.id)
      .eq('fecha', today)
      .maybeSingle()
    setAssignment(asn as any)

    const { data: att } = await supabase
      .from('installer_attendance')
      .select('id, tipo, hora, status, distancia_obra_metros')
      .eq('employee_id', employee.id)
      .eq('fecha', today)
      .order('hora', { ascending: true })
    setTodayAttendance((att as AttendanceRecord[]) || [])

    setLoading(false)
  }

  useEffect(() => { loadData() }, [employee.id])

  const hasEntrada = todayAttendance.some(a => a.tipo === 'entrada')
  const hasSalida = todayAttendance.some(a => a.tipo === 'salida')
  const nextAction: 'entrada' | 'salida' | 'done' = !hasEntrada ? 'entrada' : !hasSalida ? 'salida' : 'done'

  const handleCheckIn = async () => {
    if (nextAction === 'done') return
    setCheckInState('locating')
    setCheckInMsg('Obteniendo tu ubicación...')

    try {
      const coords = await getCurrentPosition()
      const obra = assignment?.obras
      let distancia: number | null = null
      let status = 'en_sitio'

      if (obra?.latitude && obra?.longitude) {
        distancia = haversineDistance(coords, {
          latitude: Number(obra.latitude),
          longitude: Number(obra.longitude),
        })
        const radio = obra.radio_checada_metros || 500
        if (distancia > radio) {
          const proceed = confirm(
            `Estás a ${formatDistance(distancia)} de ${obra.nombre} (radio: ${radio}m).\n\n¿Registrar checada fuera de sitio?`
          )
          if (!proceed) {
            setCheckInState('idle')
            setCheckInMsg('')
            return
          }
          status = 'fuera_de_rango'
        }
      } else if (!obra) {
        status = 'sin_obra'
      }

      setCheckInState('uploading')
      setCheckInMsg(`Registrando ${nextAction}...`)

      const today = getWorkDate()
      const { data: { session } } = await supabase.auth.getSession()

      const { error: insErr } = await supabase.from('installer_attendance').insert({
        employee_id: employee.id,
        auth_user_id: session?.user.id,
        fecha: today,
        tipo: nextAction,
        hora: new Date().toISOString(),
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy_meters: coords.accuracy,
        obra_id: obra?.id || null,
        distancia_obra_metros: distancia,
        status,
        device_info: {
          userAgent: navigator.userAgent,
          timestamp: coords.timestamp,
        },
      })

      if (insErr) throw new Error(insErr.message)

      setCheckInState('success')
      setCheckInMsg(`${nextAction === 'entrada' ? 'Entrada' : 'Salida'} registrada ${status === 'en_sitio' ? 'en sitio' : status === 'fuera_de_rango' ? 'fuera de rango' : 'sin obra asignada'}`)
      setTimeout(() => { setCheckInState('idle'); setCheckInMsg(''); loadData() }, 2000)
    } catch (e: any) {
      setCheckInState('error')
      setCheckInMsg(e.message || 'Error desconocido')
      setTimeout(() => { setCheckInState('idle'); setCheckInMsg('') }, 4000)
    }
  }


  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a0a', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <Loader2 size={32} className="spin" />
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
      </div>
    )
  }

  const obra = assignment?.obras
  const urgenciaColor =
    assignment?.urgencia === 'urgente' ? '#ef4444' :
    assignment?.urgencia === 'alta' ? '#f59e0b' :
    '#57FF9A'

  const btnColor =
    nextAction === 'done' ? '#333' :
    nextAction === 'salida' ? '#f59e0b' :
    '#57FF9A'
  const btnTextColor = nextAction === 'done' ? '#666' : '#0a0a0a'
  const btnLabel =
    nextAction === 'done' ? 'JORNADA COMPLETADA' :
    nextAction === 'salida' ? 'CHECAR SALIDA' :
    'CHECAR ENTRADA'

  const tiles = [
    { icon: FileText, label: 'Reportes', hint: 'Subir nuevo', path: '/obra-app/reportes', color: '#57FF9A' },
    { icon: Calendar, label: 'Mi semana', hint: 'Planeación', path: '/obra-app/mi-semana', color: '#3b82f6' },
    { icon: Package2, label: 'Mis obras', hint: 'Materiales y docs', path: '/obra-app/mis-obras', color: '#a78bfa' },
    { icon: TrendingUp, label: 'Mi asistencia', hint: 'Retardos y extras', path: '/obra-app/mi-asistencia', color: '#ec4899' },
    { icon: Receipt, label: 'Caja chica', hint: 'Tickets', path: '/obra-app/caja-chica', color: '#f59e0b' },
    { icon: Plane, label: 'Ausencias', hint: 'Vacaciones', path: '/obra-app/ausencias', color: '#14b8a6' },
  ]

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
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 22,
          background: '#1a1a1a', border: '2px solid #57FF9A',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700,
          overflow: 'hidden',
        }}>
          {employee.foto_url
            ? <img src={employee.foto_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
            : employee.nombre.split(' ').slice(0, 2).map(w => w[0]).join('')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {employee.nombre}
          </div>
          <div style={{ fontSize: 11, color: '#666' }}>
            {employee.puesto || 'Instalador'}
          </div>
        </div>
        <button
          onClick={onLogout}
          style={{
            background: 'transparent', border: '1px solid #1f1f1f',
            borderRadius: 10, padding: 10, cursor: 'pointer', color: '#888',
          }}
          aria-label="Cerrar sesión"
        >
          <LogOut size={16} />
        </button>
      </div>

      {/* Today's assignment */}
      {assignment && obra ? (
        <div style={{
          background: 'linear-gradient(135deg, #0f1a12 0%, #0a1a15 100%)',
          border: `1px solid ${urgenciaColor}33`,
          borderRadius: 16,
          padding: 16,
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{
              fontSize: 10, textTransform: 'uppercase', letterSpacing: 1,
              color: urgenciaColor, fontWeight: 600,
            }}>
              Hoy estás en
            </div>
            {assignment.urgencia !== 'normal' && assignment.urgencia !== 'baja' && (
              <div style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 10,
                background: urgenciaColor + '22', color: urgenciaColor,
                textTransform: 'uppercase', fontWeight: 700,
              }}>
                {assignment.urgencia}
              </div>
            )}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
            {obra.nombre}
          </div>
          {(obra.direccion_completa || obra.direccion) && (
            <div style={{ display: 'flex', gap: 6, fontSize: 12, color: '#888', marginBottom: 10 }}>
              <MapPin size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{obra.direccion_completa || obra.direccion}</span>
            </div>
          )}
          {assignment.tareas && (
            <div style={{
              fontSize: 13, color: '#ccc', lineHeight: 1.5,
              paddingTop: 10, borderTop: '1px solid #1f2a1f',
            }}>
              {assignment.tareas}
            </div>
          )}
          <button
            onClick={() => navigate(`/obra-app/mis-obras/${obra.id}?tab=materiales`)}
            style={{
              marginTop: 12, width: '100%',
              padding: '10px 12px',
              background: 'transparent',
              border: `1px solid ${urgenciaColor}55`,
              borderRadius: 10,
              color: urgenciaColor,
              fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              fontFamily: 'inherit',
            }}
          >
            <Package2 size={13} /> Ver pendientes de esta obra
          </button>
        </div>
      ) : (
        <div style={{
          background: '#1a1a1a', border: '1px solid #2a2a2a',
          borderRadius: 16, padding: 16, marginBottom: 20, textAlign: 'center',
          fontSize: 13, color: '#888',
        }}>
          No tienes obra asignada para hoy
        </div>
      )}

      {/* Giant check-in button */}
      <button
        onClick={handleCheckIn}
        disabled={nextAction === 'done' || checkInState === 'locating' || checkInState === 'uploading'}
        style={{
          width: '100%',
          minHeight: 160,
          background: btnColor,
          color: btnTextColor,
          border: 'none',
          borderRadius: 24,
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: 1,
          cursor: nextAction === 'done' ? 'not-allowed' : 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          marginBottom: 16,
          boxShadow: nextAction === 'done' ? 'none' : `0 8px 32px ${btnColor}44`,
          transition: 'all 0.2s',
        }}
      >
        {checkInState === 'locating' || checkInState === 'uploading'
          ? <Loader2 size={36} className="spin" />
          : nextAction === 'done'
          ? <CheckCircle2 size={36} />
          : <MapPin size={36} />}
        <div>{btnLabel}</div>
      </button>

      {checkInMsg && (
        <div style={{
          padding: 12, marginBottom: 16, borderRadius: 10,
          background: checkInState === 'error' ? '#3a1a1a' : checkInState === 'success' ? '#0f2a1a' : '#1a1a1a',
          border: `1px solid ${checkInState === 'error' ? '#5a2a2a' : checkInState === 'success' ? '#2a5a3a' : '#2a2a2a'}`,
          color: checkInState === 'error' ? '#fca5a5' : checkInState === 'success' ? '#57FF9A' : '#888',
          fontSize: 13, display: 'flex', gap: 8, alignItems: 'center',
        }}>
          {checkInState === 'error' ? <AlertCircle size={16} /> :
           checkInState === 'success' ? <CheckCircle2 size={16} /> :
           <Loader2 size={16} className="spin" />}
          {checkInMsg}
        </div>
      )}

      {todayAttendance.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1, paddingLeft: 4 }}>
            Checadas de hoy
          </div>
          {todayAttendance.map(a => (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: 12, marginBottom: 6,
              background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 10,
            }}>
              <Clock size={16} color="#57FF9A" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {a.tipo === 'entrada' ? 'Entrada' : 'Salida'} · {new Date(a.hora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ fontSize: 11, color: '#666' }}>
                  {a.status === 'en_sitio' ? '✓ En sitio' :
                   a.status === 'fuera_de_rango' ? `⚠ Fuera de rango (${a.distancia_obra_metros ? formatDistance(a.distancia_obra_metros) : '?'})` :
                   a.status === 'sin_obra' ? 'Sin obra asignada' :
                   a.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tiles grid 2x3 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {tiles.map((t, i) => {
          const Icon = t.icon
          return (
            <button key={i}
              onClick={() => navigate(t.path)}
              style={{
                padding: 16, background: '#0f0f0f', border: '1px solid #1a1a1a',
                borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
                cursor: 'pointer',
                textAlign: 'left',
                color: '#fff',
                fontFamily: 'inherit',
              }}>
              <Icon size={22} color={t.color} />
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
              <div style={{ fontSize: 10, color: '#666' }}>{t.hint}</div>
            </button>
          )
        })}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
