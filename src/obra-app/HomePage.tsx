import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCurrentPosition, haversineDistance, formatDistance } from './lib/geolocation'
import { getWorkDate } from './lib/workDate'
import { confirmarEntrega } from '../lib/entregaFlow'
import {
  LogOut, MapPin, AlertCircle, CheckCircle2, Clock,
  FileText, Calendar, Package2, Receipt, Loader2,
  TrendingUp, Plane, Wrench, Truck
} from 'lucide-react'

interface Employee {
  id: string
  nombre: string
  puesto: string | null
  area: string | null
  foto_url: string | null
  mantenimiento_app?: boolean | null
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

interface EntregaHoy {
  id: string
  obra_id: string
  obra_nombre: string
  delivery_date: string
  scheduled_time: string | null
  status: string
  folio: string | null
  notes: string | null
  items: { id: string; description: string; qty: number; unit: string | null }[]
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
  // El plan del día puede traer VARIAS obras (Alfredo tiene 4 el mismo lunes),
  // así que ya no es una sola asignación.
  const [plan, setPlan] = useState<TodayAssignment[]>([])
  const [obraSel, setObraSel] = useState<string>('')
  const [entregas, setEntregas] = useState<EntregaHoy[]>([])
  const [recibiendo, setRecibiendo] = useState<string>('')
  // Plan del siguiente día con trabajo — se muestra al checar salida.
  const [planSig, setPlanSig] = useState<{ fecha: string; asignaciones: TodayAssignment[] } | null>(null)
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [checkInState, setCheckInState] = useState<'idle' | 'locating' | 'uploading' | 'success' | 'error'>('idle')
  const [checkInMsg, setCheckInMsg] = useState('')
  const [visitasPendientes, setVisitasPendientes] = useState(0)

  const loadData = async () => {
    setLoading(true)
    const today = getWorkDate()

    // ── Plan del día y del siguiente día con trabajo ────────────────────
    // `installer_daily_assignment` está VACÍA (0 filas): nadie la usa, por eso
    // la app siempre decía "no tienes obra asignada". La planeación real vive
    // en weekly_plan_assignments (week_start = lunes, day_of_week = getDay()).
    // Se leen las dos: si algún día se llena la diaria, manda esa.
    const OBRA_SEL = 'id, nombre, latitude, longitude, direccion_completa, direccion, radio_checada_metros'
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const hoyD = new Date(today + 'T12:00:00')
    const dowHoy = hoyD.getDay()                        // 0=dom … 6=sáb
    const lunes = new Date(hoyD)
    lunes.setDate(hoyD.getDate() - (dowHoy === 0 ? 6 : dowHoy - 1))
    const lunesSig = new Date(lunes)
    lunesSig.setDate(lunes.getDate() + 7)

    // Traemos ESTA semana y la SIGUIENTE: el "mañana" del domingo cae en el
    // plan de la otra semana, y sin eso el instalador no vería nada al salir.
    const { data: planes } = await supabase.from('weekly_plans')
      .select('id, week_start').in('week_start', [iso(lunes), iso(lunesSig)])

    const porFecha = new Map<string, TodayAssignment[]>()
    if (planes && planes.length) {
      const { data: wpa } = await supabase.from('weekly_plan_assignments')
        .select(`id, tareas, urgencia, day_of_week, plan_id, obras(${OBRA_SEL})`)
        .eq('employee_id', employee.id)
        .in('plan_id', planes.map((x: any) => x.id))
      const inicioDe = new Map<string, string>(planes.map((x: any) => [x.id, x.week_start]))
      ;((wpa || []) as any[]).forEach(a => {
        const ws = inicioDe.get(a.plan_id)
        if (!ws) return
        // day_of_week usa getDay(): lunes=1 … domingo=0 (que es el 7º día)
        const off = a.day_of_week === 0 ? 6 : a.day_of_week - 1
        const d = new Date(ws + 'T12:00:00')
        d.setDate(d.getDate() + off)
        const f = iso(d)
        const arr = porFecha.get(f) || []
        arr.push({ id: a.id, fecha: f, tareas: a.tareas, urgencia: a.urgencia, obras: a.obras })
        porFecha.set(f, arr)
      })
    }

    // La asignación diaria, si algún día se empieza a usar, manda sobre el plan
    const { data: diarias } = await supabase
      .from('installer_daily_assignment')
      .select(`id, fecha, tareas, urgencia, obras(${OBRA_SEL})`)
      .eq('employee_id', employee.id)
      .gte('fecha', today)
    ;((diarias || []) as any[]).forEach(d => {
      porFecha.set(d.fecha, [d as any, ...(porFecha.get(d.fecha) || [])])
    })

    const dedupe = (arr: TodayAssignment[]) => {
      const vistas = new Set<string>()
      return arr.filter(a => {
        const k = a.obras?.id || a.id
        if (vistas.has(k)) return false
        vistas.add(k); return true
      })
    }

    const asignaciones = dedupe(porFecha.get(today) || [])
    setPlan(asignaciones)
    setObraSel(prev => (prev && asignaciones.some(a => a.obras?.id === prev))
      ? prev
      : (asignaciones[0]?.obras?.id || ''))

    // El siguiente día CON TRABAJO (se salta domingos y días vacíos)
    const siguiente = Array.from(porFecha.keys())
      .filter(f => f > today && (porFecha.get(f) || []).length > 0)
      .sort()[0] || null
    setPlanSig(siguiente ? { fecha: siguiente, asignaciones: dedupe(porFecha.get(siguiente) || []) } : null)

    // ── Entregas que logística ya programó (hoy y las que vienen) ──
    const obraIds = Array.from(new Set(
      [...asignaciones, ...(siguiente ? porFecha.get(siguiente) || [] : [])]
        .map(a => a.obras?.id).filter(Boolean) as string[]
    ))
    if (obraIds.length) {
      const { data: dels } = await supabase.from('deliveries')
        .select('id, obra_id, delivery_date, scheduled_time, status, folio, notes, obras(nombre), delivery_items(id, description, qty, unit)')
        .in('obra_id', obraIds)
        .in('status', ['pendiente', 'en_ruta'])
        .gte('delivery_date', today)
        .order('delivery_date')
        .limit(10)
      setEntregas(((dels || []) as any[]).map(d => ({
        id: d.id, obra_id: d.obra_id, obra_nombre: d.obras?.nombre || '',
        delivery_date: d.delivery_date, scheduled_time: d.scheduled_time,
        status: d.status, folio: d.folio, notes: d.notes,
        items: d.delivery_items || [],
      })))
    } else setEntregas([])

    const { data: att } = await supabase
      .from('installer_attendance')
      .select('id, tipo, hora, status, distancia_obra_metros')
      .eq('employee_id', employee.id)
      .eq('fecha', today)
      .order('hora', { ascending: true })
    setTodayAttendance((att as AttendanceRecord[]) || [])

    // Visitas de mantenimiento pendientes (solo si tiene acceso a la sección)
    if (employee.mantenimiento_app) {
      const { count: vCount } = await supabase
        .from('maintenance_visits')
        .select('id', { count: 'exact', head: true })
        .eq('technician_id', employee.id)
        .gte('visit_date', today)
        .not('status', 'in', '("completada","cancelada")')
      setVisitasPendientes(vCount || 0)
    }

    setLoading(false)
  }

  useEffect(() => { loadData() }, [employee.id])

  // Confirmar desde la obra: es el momento real en que el material dejó la
  // bodega y quedó en el proyecto. Cierra la entrega, la parada de la ruta y
  // la solicitud que la originó, todo con el mismo movimiento de inventario.
  async function recibirEntrega(e: EntregaHoy) {
    if (!confirm(`¿Confirmas que ya recibiste este material en ${e.obra_nombre}?`)) return
    setRecibiendo(e.id)
    try {
      const r = await confirmarEntrega(e.id, {
        recibido_por: employee.nombre,
        movido_por_nombre: employee.nombre,
      })
      alert(r.yaEstaba
        ? 'Esta entrega ya estaba registrada como recibida.'
        : `Listo, quedó registrado. ${r.piezas} pza(s) ya cuentan como material en obra.`)
      await loadData()
    } catch (err: any) {
      alert('No se pudo registrar: ' + (err?.message || err))
    }
    setRecibiendo('')
  }

  const hasEntrada = todayAttendance.some(a => a.tipo === 'entrada')
  const hasSalida = todayAttendance.some(a => a.tipo === 'salida')
  const nextAction: 'entrada' | 'salida' | 'done' = !hasEntrada ? 'entrada' : !hasSalida ? 'salida' : 'done'

  const handleCheckIn = async () => {
    if (nextAction === 'done') return
    setCheckInState('locating')
    setCheckInMsg('Obteniendo tu ubicación...')

    try {
      const coords = await getCurrentPosition()
      const obra = plan.find(a => a.obras?.id === obraSel)?.obras || plan[0]?.obras || null
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

  const asigSel = plan.find(a => a.obras?.id === obraSel) || plan[0] || null
  const obra = asigSel?.obras || null
  const colorUrg = (u?: string | null) =>
    u === 'urgente' ? '#ef4444' : u === 'alta' ? '#f59e0b' : u === 'baja' ? '#666' : '#10B981'
  const urgenciaColor = colorUrg(asigSel?.urgencia)

  const hoyStr = getWorkDate()
  const entregasHoy = entregas.filter(e => e.delivery_date === hoyStr)
  const entregasProximas = entregas.filter(e => e.delivery_date > hoyStr)
  const horaCorta = (t: string | null) => (t ? String(t).substring(0, 5) : null)
  const esManana = (f: string) => {
    const d = new Date(hoyStr + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10) === f
  }
  const fechaCorta = (f: string) => {
    try {
      return new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
    } catch { return f }
  }

  const btnColor =
    nextAction === 'done' ? '#333' :
    nextAction === 'salida' ? '#f59e0b' :
    '#10B981'
  const btnTextColor = nextAction === 'done' ? '#666' : '#0a0a0a'
  const btnLabel =
    nextAction === 'done' ? 'JORNADA COMPLETADA' :
    nextAction === 'salida' ? 'CHECAR SALIDA' :
    'CHECAR ENTRADA'

  const tiles = [
    ...(employee.mantenimiento_app ? [{ icon: Wrench, label: 'Mis visitas', hint: 'Mantenimiento', path: '/obra-app/visitas', color: '#06b6d4', badge: visitasPendientes }] : []),
    { icon: FileText, label: 'Reportes', hint: 'Subir nuevo', path: '/obra-app/reportes', color: '#10B981' },
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
          background: '#1a1a1a', border: '2px solid #10B981',
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

      {/* ═══ MAÑANA (aparece al terminar la jornada) ═══ */}
      {nextAction === 'done' && planSig && planSig.asignaciones.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #101a2e 0%, #0a1424 100%)',
          border: '1px solid #3b82f655', borderRadius: 16, padding: 16, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <Calendar size={15} color="#60A5FA" />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {esManana(planSig.fecha) ? 'Mañana te toca' : 'Tu próximo día de trabajo'}
            </span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 12, textTransform: 'capitalize' }}>
            {fechaCorta(planSig.fecha)}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {planSig.asignaciones.map(a => {
              const o = a.obras
              if (!o) return null
              const dels = entregas.filter(e => e.obra_id === o.id && e.delivery_date === planSig.fecha)
              return (
                <div key={a.id} style={{ paddingTop: 10, borderTop: '1px solid #1a2432' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{o.nombre}</div>
                  {(o.direccion_completa || o.direccion) && (
                    <div style={{ display: 'flex', gap: 6, fontSize: 11, color: '#7a8ba0', marginTop: 3 }}>
                      <MapPin size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{o.direccion_completa || o.direccion}</span>
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: a.tareas ? '#cbd5e1' : '#556', lineHeight: 1.45, marginTop: 6, fontStyle: a.tareas ? 'normal' : 'italic' }}>
                    {a.tareas || 'Sin instrucciones específicas todavía.'}
                  </div>
                  {dels.length > 0 && (
                    <div style={{ fontSize: 11, color: '#60A5FA', marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Truck size={12} />
                      Ese día te llega material{horaCorta(dels[0].scheduled_time) ? ` a las ${horaCorta(dels[0].scheduled_time)}` : ''}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                    <button onClick={() => navigate(`/obra-app/mis-obras/${o.id}`)}
                      style={{
                        flex: 1, padding: '9px 8px', background: 'transparent',
                        border: '1px solid #24344a', borderRadius: 9, color: '#93c5fd',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      }}>Ver obra</button>
                    <button onClick={() => navigate(`/obra-app/mis-obras/${o.id}/material`)}
                      style={{
                        flex: 1, padding: '9px 8px', background: '#10B98118',
                        border: '1px solid #10B98155', borderRadius: 9, color: '#4ADE80',
                        fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      }}><Package2 size={12} /> Revisar material</button>
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ fontSize: 10, color: '#5a6b80', marginTop: 12, lineHeight: 1.4 }}>
            Revisa hoy qué material te falta: si lo pides ahora, logística alcanza a programarlo.
          </div>
        </div>
      )}

      {nextAction === 'done' && !planSig && (
        <div style={{
          background: '#0f1420', border: '1px solid #24344a', borderRadius: 16,
          padding: 16, marginBottom: 16, textAlign: 'center', fontSize: 13, color: '#7a8ba0',
        }}>
          Todavía no hay plan cargado para tu siguiente día.
        </div>
      )}

      {/* ═══ PLAN DEL DÍA ═══ */}
      {plan.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 10, textTransform: 'uppercase', letterSpacing: 1,
            color: '#10B981', fontWeight: 700, marginBottom: 8,
          }}>
            {nextAction === 'done' ? 'Lo que hiciste hoy' : 'Tu plan de hoy'} · {plan.length} {plan.length === 1 ? 'obra' : 'obras'}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plan.map(a => {
              const o = a.obras
              if (!o) return null
              const sel = o.id === obraSel
              const c = colorUrg(a.urgencia)
              const dels = entregas.filter(e => e.obra_id === o.id && e.delivery_date === hoyStr)
              return (
                <div key={a.id} onClick={() => setObraSel(o.id)} style={{
                  background: sel ? 'linear-gradient(135deg, #0f1a12 0%, #0a1a15 100%)' : '#0f0f0f',
                  border: `1px solid ${sel ? c + '55' : '#1a1a1a'}`,
                  borderRadius: 14, padding: 14, cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {/* Marca cuál es la obra donde vas a checar */}
                    <div style={{
                      width: 16, height: 16, borderRadius: 8, flexShrink: 0,
                      border: `2px solid ${sel ? '#10B981' : '#333'}`,
                      background: sel ? '#10B981' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {sel && <CheckCircle2 size={10} color="#04120a" />}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, flex: 1, minWidth: 0 }}>{o.nombre}</div>
                    {a.urgencia && a.urgencia !== 'normal' && a.urgencia !== 'baja' && (
                      <span style={{
                        fontSize: 9, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
                        background: c + '22', color: c, textTransform: 'uppercase',
                      }}>{a.urgencia}</span>
                    )}
                  </div>

                  {(o.direccion_completa || o.direccion) && (
                    <div style={{ display: 'flex', gap: 6, fontSize: 11, color: '#777', marginLeft: 24, marginBottom: 6 }}>
                      <MapPin size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{o.direccion_completa || o.direccion}</span>
                    </div>
                  )}

                  {a.tareas ? (
                    <div style={{
                      fontSize: 13, color: '#ccc', lineHeight: 1.45, marginLeft: 24,
                      paddingTop: 8, borderTop: '1px solid #1f1f1f',
                    }}>{a.tareas}</div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#555', marginLeft: 24, paddingTop: 8, borderTop: '1px solid #1f1f1f' }}>
                      Sin instrucciones específicas para hoy.
                    </div>
                  )}

                  {dels.length > 0 && (
                    <div style={{ marginLeft: 24, marginTop: 8, fontSize: 11, color: '#60A5FA', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Truck size={12} />
                      Te llega material hoy{horaCorta(dels[0].scheduled_time) ? ` a las ${horaCorta(dels[0].scheduled_time)}` : ''}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6, marginLeft: 24, marginTop: 10 }}>
                    <button onClick={e => { e.stopPropagation(); navigate(`/obra-app/mis-obras/${o.id}`) }}
                      style={{
                        flex: 1, padding: '9px 8px', background: 'transparent',
                        border: '1px solid #2a2a2a', borderRadius: 9, color: '#aaa',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      }}>Ver obra</button>
                    <button onClick={e => { e.stopPropagation(); navigate(`/obra-app/mis-obras/${o.id}/material`) }}
                      style={{
                        flex: 1, padding: '9px 8px', background: '#10B98118',
                        border: '1px solid #10B98155', borderRadius: 9, color: '#4ADE80',
                        fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      }}><Package2 size={12} /> Pedir material</button>
                  </div>
                </div>
              )
            })}
          </div>

          {plan.length > 1 && (
            <div style={{ fontSize: 10, color: '#666', marginTop: 8, textAlign: 'center' }}>
              Toca la obra donde estás para que la checada se registre ahí.
            </div>
          )}
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

      {/* ═══ MATERIAL EN CAMINO (lo que programó logística) ═══ */}
      {(entregasHoy.length > 0 || entregasProximas.length > 0) && (
        <div style={{
          background: '#0d1420', border: '1px solid #2563EB55',
          borderRadius: 16, padding: 14, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
            <Truck size={15} color="#60A5FA" />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Material en camino
            </span>
          </div>
          {[...entregasHoy, ...entregasProximas].map((e, idx) => {
            const hoy = e.delivery_date === hoyStr
            return (
              <div key={e.id} style={{ paddingTop: idx ? 10 : 0, marginTop: idx ? 10 : 0, borderTop: idx ? '1px solid #1a2432' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <Clock size={13} color={hoy ? '#4ADE80' : '#60A5FA'} />
                  <span style={{ fontSize: 15, fontWeight: 800, color: hoy ? '#4ADE80' : '#fff' }}>
                    {hoy ? 'HOY' : fechaCorta(e.delivery_date)}
                    {horaCorta(e.scheduled_time) && ` · ${horaCorta(e.scheduled_time)}`}
                  </span>
                  {e.status === 'en_ruta' && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: '#4ADE80', background: '#10B98122',
                      padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase',
                    }}>Ya viene en camino</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#7a8ba0', marginTop: 2 }}>
                  {e.obra_nombre}{e.folio ? ` · ${e.folio}` : ''}
                </div>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {e.items.length === 0
                    ? <div style={{ fontSize: 12, color: '#aaa' }}>{e.notes || 'Sin desglose todavía'}</div>
                    : e.items.slice(0, 6).map(i => (
                      <div key={i.id} style={{ fontSize: 12, color: '#ddd', lineHeight: 1.35 }}>
                        <span style={{ color: '#60A5FA', fontWeight: 800 }}>{i.qty} {i.unit || 'pza'}</span> · {i.description}
                      </div>
                    ))}
                  {e.items.length > 6 && (
                    <div style={{ fontSize: 11, color: '#666' }}>+{e.items.length - 6} artículos más</div>
                  )}
                </div>
                <button
                  onClick={() => recibirEntrega(e)}
                  disabled={recibiendo === e.id}
                  style={{
                    marginTop: 9, width: '100%', padding: '11px 12px', borderRadius: 12,
                    border: '1px solid #10B98166', background: '#10B98118', color: '#4ADE80',
                    fontSize: 13, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
                  }}>
                  {recibiendo === e.id ? 'Registrando…' : '✓ Ya lo recibí en obra'}
                </button>
              </div>
            )
          })}
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
          color: checkInState === 'error' ? '#fca5a5' : checkInState === 'success' ? '#10B981' : '#888',
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
              <Clock size={16} color="#10B981" />
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
                position: 'relative',
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
              {'badge' in t && (t as any).badge > 0 && (
                <div style={{
                  position: 'absolute', top: 12, right: 12, minWidth: 20, height: 20, padding: '0 6px',
                  borderRadius: 10, background: t.color, color: '#0a0a0a',
                  fontSize: 11, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {(t as any).badge}
                </div>
              )}
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
