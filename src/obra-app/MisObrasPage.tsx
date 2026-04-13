import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ArrowLeft, Package2, MapPin, Loader2, ChevronRight } from 'lucide-react'

interface ObraItem {
  id: string
  nombre: string
  direccion: string | null
  status: string | null
  lastActivity: string
}

export default function MisObrasPage({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate()
  const [obras, setObras] = useState<ObraItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const map = new Map<string, ObraItem>()

    // 1. From weekly_plan_assignments.obra_id
    const { data: planned } = await supabase
      .from('weekly_plan_assignments')
      .select('obra_id, obras(id, nombre, direccion, direccion_completa, status)')
      .eq('employee_id', employeeId)
      .not('obra_id', 'is', null)
    for (const a of (planned || [])) {
      const o = (a.obras as any)
      if (!o) continue
      map.set(o.id, {
        id: o.id,
        nombre: o.nombre,
        direccion: o.direccion_completa || o.direccion,
        status: o.status,
        lastActivity: 'Planeación semanal',
      })
    }

    // 2. From installer_attendance.obra_id
    const { data: attendance } = await supabase
      .from('installer_attendance')
      .select('obra_id, fecha, obras(id, nombre, direccion, direccion_completa, status)')
      .eq('employee_id', employeeId)
      .not('obra_id', 'is', null)
      .order('fecha', { ascending: false })
    for (const a of (attendance || [])) {
      const o = (a.obras as any)
      if (!o) continue
      if (!map.has(o.id)) {
        map.set(o.id, {
          id: o.id,
          nombre: o.nombre,
          direccion: o.direccion_completa || o.direccion,
          status: o.status,
          lastActivity: 'Checada ' + new Date(a.fecha).toLocaleDateString('es-MX'),
        })
      }
    }

    // 3. From obra_reportes.obra_id
    const { data: reportes } = await supabase
      .from('obra_reportes')
      .select('obras(id, nombre, direccion, status)')
      .eq('instalador_id', employeeId)
    for (const r of (reportes || [])) {
      const o = (r.obras as any)
      if (!o) continue
      if (!map.has(o.id)) {
        map.set(o.id, {
          id: o.id,
          nombre: o.nombre,
          direccion: o.direccion,
          status: o.status,
          lastActivity: 'Reporte',
        })
      }
    }

    // 4. From installer_daily_assignment
    const { data: daily } = await supabase
      .from('installer_daily_assignment')
      .select('obras(id, nombre, direccion, direccion_completa, status)')
      .eq('employee_id', employeeId)
      .not('obra_id', 'is', null)
    for (const d of (daily || [])) {
      const o = (d.obras as any)
      if (!o) continue
      if (!map.has(o.id)) {
        map.set(o.id, {
          id: o.id,
          nombre: o.nombre,
          direccion: o.direccion_completa || o.direccion,
          status: o.status,
          lastActivity: 'Asignación del día',
        })
      }
    }

    setObras(Array.from(map.values()))
    setLoading(false)
  }

  useEffect(() => { load() }, [employeeId])

  const statusColor = (s: string | null) =>
    s === 'en_ejecucion' ? '#57FF9A' :
    s === 'pausada' ? '#f59e0b' :
    s === 'completada' ? '#3b82f6' :
    s === 'entrega_pendiente' ? '#a78bfa' :
    '#666'

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
          <div style={{ fontSize: 18, fontWeight: 700 }}>Mis obras</div>
          <div style={{ fontSize: 11, color: '#666' }}>{obras.length} obras</div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Loader2 size={24} className="spin" />
        </div>
      ) : obras.length === 0 ? (
        <div style={{
          padding: 32, textAlign: 'center',
          background: '#1a1a1a', border: '1px solid #2a2a2a',
          borderRadius: 16, color: '#888', fontSize: 13,
        }}>
          <Package2 size={32} style={{ marginBottom: 10, opacity: 0.3 }} />
          <div>No tienes obras asignadas todavía</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {obras.map(o => (
            <button
              key={o.id}
              onClick={() => navigate(`/obra-app/mis-obras/${o.id}`)}
              style={{
                background: '#0f0f0f',
                border: '1px solid #1a1a1a',
                borderRadius: 12,
                padding: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                cursor: 'pointer',
                textAlign: 'left',
                color: '#fff',
                fontFamily: 'inherit',
                width: '100%',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 4,
                    background: statusColor(o.status),
                  }} />
                  <span style={{ fontSize: 10, color: statusColor(o.status), textTransform: 'uppercase', fontWeight: 700 }}>
                    {o.status || 'Sin status'}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{o.nombre}</div>
                {o.direccion && (
                  <div style={{ display: 'flex', gap: 4, fontSize: 11, color: '#666' }}>
                    <MapPin size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.direccion}</span>
                  </div>
                )}
                <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>
                  {o.lastActivity}
                </div>
              </div>
              <ChevronRight size={16} color="#666" />
            </button>
          ))}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
