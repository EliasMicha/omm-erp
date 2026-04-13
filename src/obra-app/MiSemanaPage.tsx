import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ArrowLeft, Calendar, MapPin, AlertCircle, Loader2 } from 'lucide-react'

interface Obra {
  id: string
  nombre: string
  direccion: string | null
  direccion_completa: string | null
}
interface Assignment {
  id: string
  day_of_week: number
  tareas: string | null
  urgencia: string
  obras: Obra | null
}

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DAYS_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

// Get Monday of current week
function getMondayOfCurrentWeek(): Date {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d.setDate(diff))
  monday.setHours(0, 0, 0, 0)
  return monday
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

export default function MiSemanaPage({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate()
  const [weekStart, setWeekStart] = useState<Date>(getMondayOfCurrentWeek())
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedDay, setExpandedDay] = useState<number | null>(null)

  const loadWeek = async () => {
    setLoading(true)
    const weekStartStr = weekStart.toISOString().slice(0, 10)
    // Find the weekly_plan for this week
    const { data: plan } = await supabase
      .from('weekly_plans')
      .select('id')
      .eq('week_start', weekStartStr)
      .maybeSingle()

    if (!plan) {
      setAssignments([])
      setLoading(false)
      return
    }

    const { data: asns } = await supabase
      .from('weekly_plan_assignments')
      .select('id, day_of_week, tareas, urgencia, obras(id, nombre, direccion, direccion_completa)')
      .eq('plan_id', plan.id)
      .eq('employee_id', employeeId)
      .order('day_of_week')
    setAssignments((asns as any) || [])
    setLoading(false)
  }

  useEffect(() => { loadWeek() }, [employeeId, weekStart.toISOString()])

  const shiftWeek = (delta: number) => {
    const next = new Date(weekStart)
    next.setDate(next.getDate() + delta * 7)
    setWeekStart(next)
    setExpandedDay(null)
  }

  const todayDow = new Date().getDay() // 0=dom, 1=lun, ...
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  // Build array of 7 days (Mon-Sun) with their assignments
  const daysOfWeek = Array.from({ length: 7 }, (_, i) => {
    const dow = i === 6 ? 0 : i + 1 // Mon=1, Tue=2, ..., Sun=0
    const dayDate = new Date(weekStart)
    dayDate.setDate(dayDate.getDate() + i)
    const assignment = assignments.find(a => a.day_of_week === dow)
    return { dow, date: dayDate, assignment }
  })

  const urgenciaColor = (u: string) =>
    u === 'urgente' ? '#ef4444' :
    u === 'alta' ? '#f59e0b' :
    u === 'baja' ? '#666' : '#57FF9A'

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
        <button
          onClick={() => navigate('/obra-app')}
          style={{
            background: 'transparent', border: '1px solid #1f1f1f',
            borderRadius: 10, padding: 10, cursor: 'pointer', color: '#fff',
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Mi semana</div>
          <div style={{ fontSize: 11, color: '#666' }}>
            {formatDate(weekStart)} — {formatDate(weekEnd)}
          </div>
        </div>
      </div>

      {/* Week selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => shiftWeek(-1)}
          style={{
            flex: 1, padding: '10px', background: '#0f0f0f',
            border: '1px solid #1f1f1f', borderRadius: 10,
            color: '#888', fontSize: 12, cursor: 'pointer',
          }}
        >← Anterior</button>
        <button
          onClick={() => { setWeekStart(getMondayOfCurrentWeek()); setExpandedDay(null) }}
          style={{
            flex: 1, padding: '10px', background: '#0f1a12',
            border: '1px solid #1f3a2a', borderRadius: 10,
            color: '#57FF9A', fontSize: 12, cursor: 'pointer', fontWeight: 600,
          }}
        >Hoy</button>
        <button
          onClick={() => shiftWeek(1)}
          style={{
            flex: 1, padding: '10px', background: '#0f0f0f',
            border: '1px solid #1f1f1f', borderRadius: 10,
            color: '#888', fontSize: 12, cursor: 'pointer',
          }}
        >Siguiente →</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Loader2 size={24} className="spin" />
        </div>
      ) : daysOfWeek.filter(d => d.assignment).length === 0 ? (
        <div style={{
          padding: 24, textAlign: 'center',
          background: '#1a1a1a', border: '1px solid #2a2a2a',
          borderRadius: 16, color: '#888', fontSize: 13,
        }}>
          <Calendar size={28} style={{ marginBottom: 8, opacity: 0.3 }} />
          <div>Sin planeación para esta semana</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {daysOfWeek.map(({ dow, date, assignment }) => {
            const isToday = dow === todayDow && date.toDateString() === new Date().toDateString()
            const expanded = expandedDay === dow
            return (
              <div
                key={dow}
                onClick={() => assignment && setExpandedDay(expanded ? null : dow)}
                style={{
                  background: assignment ? '#0f1a12' : '#0f0f0f',
                  border: `1px solid ${isToday ? '#57FF9A' : assignment ? '#1f3a2a' : '#1a1a1a'}`,
                  borderRadius: 14,
                  padding: 14,
                  cursor: assignment ? 'pointer' : 'default',
                  opacity: assignment ? 1 : 0.5,
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    minWidth: 48, textAlign: 'center',
                    borderRight: '1px solid #1f2a1f', paddingRight: 12,
                  }}>
                    <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>
                      {DAYS[dow]}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: isToday ? '#57FF9A' : '#fff' }}>
                      {date.getDate()}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {assignment?.obras ? (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {assignment.obras.nombre}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {assignment.urgencia !== 'normal' && (
                            <span style={{
                              fontSize: 9, padding: '2px 6px', borderRadius: 8,
                              background: urgenciaColor(assignment.urgencia) + '22',
                              color: urgenciaColor(assignment.urgencia),
                              textTransform: 'uppercase', fontWeight: 700,
                            }}>
                              {assignment.urgencia}
                            </span>
                          )}
                          {isToday && (
                            <span style={{
                              fontSize: 9, padding: '2px 6px', borderRadius: 8,
                              background: '#57FF9A22', color: '#57FF9A',
                              fontWeight: 700,
                            }}>HOY</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: '#555' }}>Sin asignación</div>
                    )}
                  </div>
                </div>

                {/* Expanded content */}
                {expanded && assignment && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1f2a1f' }}>
                    {(assignment.obras?.direccion_completa || assignment.obras?.direccion) && (
                      <div style={{ display: 'flex', gap: 6, fontSize: 12, color: '#888', marginBottom: 8 }}>
                        <MapPin size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span>{(assignment.obras?.direccion_completa || assignment.obras?.direccion)}</span>
                      </div>
                    )}
                    {assignment.tareas && (
                      <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>
                        {assignment.tareas}
                      </div>
                    )}
                    {!assignment.tareas && (
                      <div style={{ fontSize: 12, color: '#666', fontStyle: 'italic' }}>
                        Sin tareas específicas
                      </div>
                    )}
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
