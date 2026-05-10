import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Calendar, Clock, MapPin, Users, ChevronRight } from 'lucide-react'

interface CalendarEvent {
  id: string
  summary: string
  location: string | null
  start_time: string
  end_time: string
  attendees: any[]
  organizer: string
  html_link: string
}

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function formatDayHeader(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)

  if (d.toDateString() === today.toDateString()) return 'Hoy'
  if (d.toDateString() === tomorrow.toDateString()) return 'Mañana'

  return `${DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`
}

export default function CalendarWidget({ userEmail, isMobile }: { userEmail: string; isMobile?: boolean }) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const now = new Date().toISOString()
      const twoWeeks = new Date()
      twoWeeks.setDate(twoWeeks.getDate() + 14)

      const { data } = await supabase
        .from('calendar_events')
        .select('id, summary, location, start_time, end_time, attendees, organizer, html_link')
        .eq('user_email', userEmail)
        .gte('start_time', now)
        .lte('start_time', twoWeeks.toISOString())
        .order('start_time', { ascending: true })

      setEvents((data || []) as CalendarEvent[])
      setLoading(false)
    }
    load()
  }, [userEmail])

  // Group by day
  const grouped = useMemo(() => {
    const days: Record<string, CalendarEvent[]> = {}
    events.forEach(e => {
      const dayKey = new Date(e.start_time).toDateString()
      if (!days[dayKey]) days[dayKey] = []
      days[dayKey].push(e)
    })
    return Object.entries(days)
  }, [events])

  if (loading) return <div style={{ padding: 16, color: '#555', fontSize: 12 }}>Cargando calendario...</div>
  if (events.length === 0) return <div style={{ padding: 16, color: '#444', fontSize: 12, textAlign: 'center' }}>Sin eventos próximos</div>

  return (
    <div>
      {grouped.map(([dayKey, dayEvents]) => (
        <div key={dayKey} style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase',
            letterSpacing: '0.05em', padding: '4px 0', marginBottom: 4,
            borderBottom: '1px solid #1a1a1a',
          }}>
            {formatDayHeader(dayEvents[0].start_time)}
          </div>
          {dayEvents.map(event => {
            const attendeeCount = Array.isArray(event.attendees) ? event.attendees.length : 0
            return (
              <div key={event.id} style={{
                display: 'flex', gap: 10, padding: '8px 4px',
                borderLeft: '3px solid #3B82F6', paddingLeft: 12, marginBottom: 4,
                borderRadius: 2,
              }}>
                <div style={{ flexShrink: 0, minWidth: 54, textAlign: 'right' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>
                    {formatTime(event.start_time)}
                  </div>
                  <div style={{ fontSize: 10, color: '#555' }}>
                    {formatTime(event.end_time)}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 500, color: '#fff',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {event.summary}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 10, color: '#555' }}>
                    {event.location && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <MapPin size={9} /> {event.location}
                      </span>
                    )}
                    {attendeeCount > 1 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Users size={9} /> {attendeeCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
