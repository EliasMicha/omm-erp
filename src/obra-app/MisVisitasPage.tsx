import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { todayCDMX } from './lib/workDate'
import {
  ArrowLeft, MapPin, Clock, Loader2, Wrench, ChevronRight,
  CheckCircle2, Navigation, CalendarClock, AlertTriangle
} from 'lucide-react'

interface Property {
  id: string
  name: string
  address: string | null
  city: string | null
  client_name: string | null
}

interface Visit {
  id: string
  property_id: string
  ticket_id: string | null
  contract_id: string | null
  visit_date: string
  scheduled_time: string | null
  route_order: number | null
  status: string
  en_route_at: string | null
  arrived_at: string | null
  completed_at: string | null
  work_performed: string | null
  property?: Property | null
}

// Estado visual derivado (combina status + timestamps de avance)
function derivedState(v: Visit): { label: string; color: string } {
  if (v.status === 'completada') return { label: 'Completada', color: '#10B981' }
  if (v.status === 'cancelada') return { label: 'Cancelada', color: '#888' }
  if (v.arrived_at) return { label: 'En sitio', color: '#3b82f6' }
  if (v.en_route_at) return { label: 'En camino', color: '#f59e0b' }
  return { label: 'Programada', color: '#a78bfa' }
}

function fmtTime(t: string | null): string {
  if (!t) return '--:--'
  // t viene como 'HH:MM:SS'
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'pm' : 'am'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${m} ${ampm}`
}

function sortVisits(a: Visit, b: Visit): number {
  const ra = a.route_order ?? 999
  const rb = b.route_order ?? 999
  if (ra !== rb) return ra - rb
  return (a.scheduled_time ?? '99').localeCompare(b.scheduled_time ?? '99')
}

export default function MisVisitasPage({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate()
  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const today = todayCDMX()
      const { data } = await supabase
        .from('maintenance_visits')
        .select('id, property_id, ticket_id, contract_id, visit_date, scheduled_time, route_order, status, en_route_at, arrived_at, completed_at, work_performed, property:maintenance_properties(id, name, address, city, client_name)')
        .eq('technician_id', employeeId)
        .gte('visit_date', today)
        .neq('status', 'cancelada')
        .order('visit_date', { ascending: true })
      setVisits((data as any) || [])
      setLoading(false)
    })()
  }, [employeeId])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} className="spin" />
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
      </div>
    )
  }

  const today = todayCDMX()
  const todayVisits = visits.filter(v => v.visit_date === today).sort(sortVisits)
  const upcoming = visits.filter(v => v.visit_date > today)

  // Próxima parada pendiente de hoy
  const nextStop = todayVisits.find(v => v.status !== 'completada')

  // Agrupar próximas por fecha
  const upcomingByDate: Record<string, Visit[]> = {}
  upcoming.forEach(v => {
    if (!upcomingByDate[v.visit_date]) upcomingByDate[v.visit_date] = []
    upcomingByDate[v.visit_date].push(v)
  })
  Object.values(upcomingByDate).forEach(arr => arr.sort(sortVisits))

  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' })

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #0a0a0a 0%, #0f1a12 40%, #0a0a0a 100%)',
      color: '#fff',
      paddingTop: 'max(env(safe-area-inset-top), 20px)',
      paddingBottom: 40, paddingLeft: 16, paddingRight: 16,
      maxWidth: 480, margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate('/obra-app')}
          style={{ background: 'transparent', border: '1px solid #1f1f1f', borderRadius: 10, padding: 10, cursor: 'pointer', color: '#fff' }}>
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Mis visitas</div>
          <div style={{ fontSize: 11, color: '#666' }}>Mantenimiento · {todayVisits.length} hoy</div>
        </div>
      </div>

      {/* Siguiente parada */}
      {nextStop && nextStop.property && (
        <div style={{
          background: 'linear-gradient(135deg, #0f1a12 0%, #0a1a15 100%)',
          border: '1px solid #10B98144', borderRadius: 16, padding: 16, marginBottom: 20,
        }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#10B981', fontWeight: 600, marginBottom: 8 }}>
            Siguiente parada
          </div>
          <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 4 }}>{nextStop.property.name}</div>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#888', marginBottom: 12 }}>
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><Clock size={13} /> {fmtTime(nextStop.scheduled_time)}</span>
            {nextStop.property.city && <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><MapPin size={13} /> {nextStop.property.city}</span>}
          </div>
          <button onClick={() => navigate(`/obra-app/visita/${nextStop.id}`)}
            style={{
              width: '100%', padding: '12px', background: '#10B981', color: '#0a0a0a',
              border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit',
            }}>
            <Navigation size={16} /> Abrir visita
          </button>
        </div>
      )}

      {/* Hoy */}
      <div style={{ fontSize: 11, color: '#666', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1, paddingLeft: 4 }}>
        Hoy
      </div>
      {todayVisits.length === 0 ? (
        <div style={{
          padding: 28, textAlign: 'center', background: '#0f0f0f',
          border: '1px solid #1a1a1a', borderRadius: 14, color: '#888', fontSize: 13, marginBottom: 24,
        }}>
          <CalendarClock size={26} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div>No tienes visitas programadas para hoy</div>
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {todayVisits.map((v, i) => <VisitCard key={v.id} v={v} idx={i + 1} onClick={() => navigate(`/obra-app/visita/${v.id}`)} />)}
        </div>
      )}

      {/* Próximas */}
      {Object.keys(upcomingByDate).sort().map(date => (
        <div key={date} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 10, textTransform: 'capitalize', letterSpacing: 0.5, paddingLeft: 4 }}>
            {fmtDate(date)}
          </div>
          {upcomingByDate[date].map((v, i) => <VisitCard key={v.id} v={v} idx={i + 1} onClick={() => navigate(`/obra-app/visita/${v.id}`)} />)}
        </div>
      ))}

      {visits.length === 0 && (
        <div style={{ padding: 28, textAlign: 'center', color: '#666', fontSize: 13 }}>
          <AlertTriangle size={26} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>Sin visitas asignadas. Tu coordinador te asignará desde el ERP.</div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
    </div>
  )
}

function VisitCard({ v, idx, onClick }: { v: Visit; idx: number; onClick: () => void }) {
  const st = derivedState(v)
  const done = v.status === 'completada'
  return (
    <button onClick={onClick} style={{
      width: '100%', textAlign: 'left', fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8,
      background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12,
      cursor: 'pointer', color: '#fff', opacity: done ? 0.6 : 1,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 17, flexShrink: 0,
        background: st.color + '22', color: st.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13,
      }}>
        {done ? <CheckCircle2 size={17} /> : idx}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {v.property?.name || 'Propiedad'}
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#777', marginTop: 2 }}>
          <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}><Clock size={11} /> {fmtTime(v.scheduled_time)}</span>
          {v.property?.city && <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}><MapPin size={11} /> {v.property.city}</span>}
          {v.ticket_id && <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}><Wrench size={11} /> Ticket</span>}
        </div>
      </div>
      <div style={{ fontSize: 10, padding: '3px 8px', borderRadius: 8, background: st.color + '1f', color: st.color, fontWeight: 600, flexShrink: 0 }}>
        {st.label}
      </div>
      <ChevronRight size={16} color="#444" style={{ flexShrink: 0 }} />
    </button>
  )
}
