import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { Btn, Loading, KpiCard, SectionHeader, EmptyState, Badge } from '../../components/layout/UI'
import {
  FileText, Camera, Mic, CheckCircle2, AlertTriangle, XOctagon,
  Filter, X, User, MapPin, Calendar, Play, Pause, Sparkles,
  TrendingUp, AlertCircle
} from 'lucide-react'

interface Reporte {
  id: string
  fecha: string
  tipo_reporte: string | null
  texto_raw: string | null
  fotos: string[] | null
  audio_url: string | null
  ai_resumen: string | null
  ai_avances: string[] | null
  ai_faltantes: string[] | null
  ai_bloqueos: string[] | null
  procesado: boolean
  procesamiento_error: string | null
  latitude: number | null
  longitude: number | null
  created_at: string
  instalador_id: string
  obra_id: string | null
  empleado?: { id: string; nombre: string; puesto: string | null }
  obra?: { id: string; nombre: string } | null
}

const TIPO_CONFIG: Record<string, { label: string; color: string; emoji: string }> = {
  avance: { label: 'AVANCE', color: '#57FF9A', emoji: '📈' },
  problema: { label: 'PROBLEMA', color: '#f59e0b', emoji: '⚠️' },
  terminacion_tarea: { label: 'TAREA TERMINADA', color: '#3b82f6', emoji: '✅' },
  material_faltante: { label: 'FALTA MATERIAL', color: '#ec4899', emoji: '📦' },
  general: { label: 'GENERAL', color: '#a78bfa', emoji: '📝' },
}

export default function TabReportes() {
  const [reportes, setReportes] = useState<Reporte[]>([])
  const [loading, setLoading] = useState(true)
  const [filterRange, setFilterRange] = useState<'hoy' | 'semana' | 'mes'>('semana')
  const [filterEmpleado, setFilterEmpleado] = useState<string>('todos')
  const [filterObra, setFilterObra] = useState<string>('todos')
  const [filterTipo, setFilterTipo] = useState<string>('todos')
  const [selected, setSelected] = useState<Reporte | null>(null)

  const load = async () => {
    setLoading(true)
    const now = new Date()
    let startDate: Date
    if (filterRange === 'hoy') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    } else if (filterRange === 'semana') {
      const day = now.getDay()
      const diff = now.getDate() - day + (day === 0 ? -6 : 1)
      startDate = new Date(now.getFullYear(), now.getMonth(), diff)
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    }
    const startStr = startDate.toISOString().slice(0, 10)

    const { data } = await supabase
      .from('obra_reportes')
      .select(`
        id, fecha, tipo_reporte, texto_raw, fotos, audio_url,
        ai_resumen, ai_avances, ai_faltantes, ai_bloqueos,
        procesado, procesamiento_error, latitude, longitude,
        created_at, instalador_id, obra_id,
        empleado:employees!obra_reportes_instalador_id_fkey(id, nombre, puesto),
        obra:obras(id, nombre)
      `)
      .gte('fecha', startStr)
      .order('created_at', { ascending: false })
      .limit(200)
    setReportes((data as any) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filterRange])

  const empleadosList = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of reportes) if (r.empleado) map.set(r.empleado.id, r.empleado.nombre)
    return Array.from(map.entries()).map(([id, nombre]) => ({ id, nombre }))
  }, [reportes])

  const obrasList = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of reportes) if (r.obra) map.set(r.obra.id, r.obra.nombre)
    return Array.from(map.entries()).map(([id, nombre]) => ({ id, nombre }))
  }, [reportes])

  const filtered = useMemo(() => reportes.filter(r => {
    if (filterEmpleado !== 'todos' && r.instalador_id !== filterEmpleado) return false
    if (filterObra !== 'todos' && r.obra_id !== filterObra) return false
    if (filterTipo !== 'todos' && r.tipo_reporte !== filterTipo) return false
    return true
  }), [reportes, filterEmpleado, filterObra, filterTipo])

  // KPIs
  const kpis = useMemo(() => {
    const totalAvances = reportes.reduce((a, r) => a + (r.ai_avances?.length || 0), 0)
    const totalFaltantes = reportes.reduce((a, r) => a + (r.ai_faltantes?.length || 0), 0)
    const totalBloqueos = reportes.reduce((a, r) => a + (r.ai_bloqueos?.length || 0), 0)
    const noProcesados = reportes.filter(r => !r.procesado).length
    return {
      total: reportes.length,
      totalAvances,
      totalFaltantes,
      totalBloqueos,
      noProcesados,
    }
  }, [reportes])


  const fotoUrl = (path: string): string => {
    if (path.startsWith('http')) return path
    const { data } = supabase.storage.from('obra-reportes').getPublicUrl(path)
    return data.publicUrl
  }

  const fmtDateTime = (d: string) =>
    new Date(d).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  if (loading) return <Loading />

  return (
    <div>
      <SectionHeader
        title="Reportes de campo"
        subtitle="Reportes diarios de los instaladores con análisis automático por Claude — avances, faltantes y bloqueos"
      />

      {/* Range selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, background: '#0a0a0a', padding: 4, borderRadius: 10, border: '1px solid #1a1a1a', width: 'fit-content' }}>
        {(['hoy', 'semana', 'mes'] as const).map(r => (
          <button
            key={r}
            onClick={() => setFilterRange(r)}
            style={{
              padding: '8px 16px',
              background: filterRange === r ? '#0f2a1a' : 'transparent',
              border: 'none', borderRadius: 8,
              color: filterRange === r ? '#57FF9A' : '#666',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {r === 'hoy' ? 'Hoy' : r === 'semana' ? 'Esta semana' : 'Este mes'}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard
          label="Reportes"
          value={kpis.total}
          icon={<FileText size={16} />}
        />
        <KpiCard
          label="Avances reportados"
          value={kpis.totalAvances}
          color="#57FF9A"
          icon={<CheckCircle2 size={16} />}
        />
        <KpiCard
          label="Materiales faltantes"
          value={kpis.totalFaltantes}
          color={kpis.totalFaltantes > 0 ? '#ec4899' : undefined}
          icon={<TrendingUp size={16} />}
        />
        <KpiCard
          label="Bloqueos activos"
          value={kpis.totalBloqueos}
          color={kpis.totalBloqueos > 0 ? '#ef4444' : undefined}
          icon={<XOctagon size={16} />}
        />
        <KpiCard
          label="Sin procesar"
          value={kpis.noProcesados}
          color={kpis.noProcesados > 0 ? '#f59e0b' : undefined}
          icon={<AlertCircle size={16} />}
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
          value={filterObra}
          onChange={e => setFilterObra(e.target.value)}
          style={{
            padding: '8px 12px', background: '#0f0f0f', border: '1px solid #1f1f1f',
            borderRadius: 8, color: '#eee', fontSize: 12, cursor: 'pointer',
          }}
        >
          <option value="todos">Todas las obras</option>
          {obrasList.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
        <select
          value={filterTipo}
          onChange={e => setFilterTipo(e.target.value)}
          style={{
            padding: '8px 12px', background: '#0f0f0f', border: '1px solid #1f1f1f',
            borderRadius: 8, color: '#eee', fontSize: 12, cursor: 'pointer',
          }}
        >
          <option value="todos">Todos los tipos</option>
          {Object.entries(TIPO_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.emoji} {v.label}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: '#888' }}>
          Mostrando {filtered.length} de {reportes.length}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No hay reportes en el rango seleccionado." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(r => {
            const cfg = TIPO_CONFIG[r.tipo_reporte || 'general'] || TIPO_CONFIG.general
            return (
              <div
                key={r.id}
                onClick={() => setSelected(r)}
                style={{
                  padding: 16,
                  background: '#0f0f0f',
                  border: '1px solid #1a1a1a',
                  borderLeft: `3px solid ${cfg.color}`,
                  borderRadius: 12,
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#131313'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#0f0f0f'}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <Badge label={cfg.label} color={cfg.color} />
                      {!r.procesado && (
                        <Badge label="PROCESANDO" color="#f59e0b" />
                      )}
                      <span style={{ fontSize: 11, color: '#666' }}>
                        {fmtDateTime(r.created_at)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#888', marginBottom: 8 }}>
                      <User size={11} />
                      <span style={{ color: '#ccc', fontWeight: 500 }}>{r.empleado?.nombre || '—'}</span>
                      {r.obra && (
                        <>
                          <span>·</span>
                          <MapPin size={11} />
                          <span>{r.obra.nombre}</span>
                        </>
                      )}
                    </div>
                    {r.ai_resumen ? (
                      <div style={{ fontSize: 13, color: '#eee', lineHeight: 1.5, marginBottom: 8 }}>
                        {r.ai_resumen}
                      </div>
                    ) : r.texto_raw ? (
                      <div style={{ fontSize: 13, color: '#888', lineHeight: 1.5, marginBottom: 8, fontStyle: 'italic' }}>
                        {r.texto_raw}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#666', fontStyle: 'italic', marginBottom: 8 }}>
                        (sin contenido de texto)
                      </div>
                    )}
                  </div>
                  {r.fotos && r.fotos.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {r.fotos.slice(0, 3).map((f, i) => (
                        <img
                          key={i}
                          src={fotoUrl(f)}
                          alt=""
                          style={{
                            width: 60, height: 60, borderRadius: 6,
                            objectFit: 'cover', border: '1px solid #2a2a2a',
                          }}
                        />
                      ))}
                      {r.fotos.length > 3 && (
                        <div style={{
                          width: 60, height: 60, borderRadius: 6,
                          background: '#1a1a1a', border: '1px solid #2a2a2a',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, color: '#888', fontWeight: 600,
                        }}>
                          +{r.fotos.length - 3}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* AI extractions as chips */}
                {(r.ai_avances?.length || r.ai_faltantes?.length || r.ai_bloqueos?.length) ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {r.ai_avances?.map((a, i) => (
                      <span key={'a'+i} style={{
                        fontSize: 10, padding: '3px 8px', borderRadius: 6,
                        background: '#0f2a1a', color: '#57FF9A', fontWeight: 500,
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}>
                        <CheckCircle2 size={10} /> {a}
                      </span>
                    ))}
                    {r.ai_faltantes?.map((a, i) => (
                      <span key={'f'+i} style={{
                        fontSize: 10, padding: '3px 8px', borderRadius: 6,
                        background: '#2a1530', color: '#ec4899', fontWeight: 500,
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}>
                        <TrendingUp size={10} /> {a}
                      </span>
                    ))}
                    {r.ai_bloqueos?.map((a, i) => (
                      <span key={'b'+i} style={{
                        fontSize: 10, padding: '3px 8px', borderRadius: 6,
                        background: '#3a1a1a', color: '#ef4444', fontWeight: 500,
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}>
                        <XOctagon size={10} /> {a}
                      </span>
                    ))}
                  </div>
                ) : null}

                {r.audio_url && (
                  <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#a78bfa' }}>
                    <Mic size={10} /> Nota de voz
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}


      {/* Modal detalle */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Badge
                    label={(TIPO_CONFIG[selected.tipo_reporte || 'general'] || TIPO_CONFIG.general).label}
                    color={(TIPO_CONFIG[selected.tipo_reporte || 'general'] || TIPO_CONFIG.general).color}
                  />
                  <span style={{ fontSize: 11, color: '#666' }}>{fmtDateTime(selected.created_at)}</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#eee' }}>
                  {selected.empleado?.nombre}
                </div>
                {selected.obra && (
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{selected.obra.nombre}</div>
                )}
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

            {selected.ai_resumen && (
              <div style={{ marginBottom: 20, padding: 14, background: '#0f1f15', border: '1px solid #1f3a2a', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Sparkles size={12} color="#57FF9A" />
                  <span style={{ fontSize: 10, color: '#57FF9A', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>Resumen IA</span>
                </div>
                <div style={{ fontSize: 13, color: '#eee', lineHeight: 1.6 }}>{selected.ai_resumen}</div>
              </div>
            )}

            {selected.texto_raw && selected.texto_raw !== selected.ai_resumen && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Texto original</div>
                <div style={{ fontSize: 12, color: '#ccc', fontStyle: 'italic', lineHeight: 1.5 }}>"{selected.texto_raw}"</div>
              </div>
            )}

            {selected.audio_url && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Nota de voz</div>
                <audio controls src={selected.audio_url} style={{ width: '100%' }} />
              </div>
            )}

            {selected.fotos && selected.fotos.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                  <Camera size={10} style={{ display: 'inline', marginRight: 4 }} />
                  Fotos ({selected.fotos.length})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                  {selected.fotos.map((f, i) => (
                    <a key={i} href={fotoUrl(f)} target="_blank" rel="noopener noreferrer">
                      <img src={fotoUrl(f)} alt="" style={{
                        width: '100%', aspectRatio: '1',
                        objectFit: 'cover', borderRadius: 8,
                        border: '1px solid #2a2a2a', cursor: 'pointer',
                      }} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* AI extractions */}
            {(selected.ai_avances?.length || selected.ai_faltantes?.length || selected.ai_bloqueos?.length) ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
                {selected.ai_avances && selected.ai_avances.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <CheckCircle2 size={14} color="#57FF9A" />
                      <span style={{ fontSize: 11, color: '#57FF9A', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
                        Avances ({selected.ai_avances.length})
                      </span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#ccc', lineHeight: 1.6 }}>
                      {selected.ai_avances.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}
                {selected.ai_faltantes && selected.ai_faltantes.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <TrendingUp size={14} color="#ec4899" />
                      <span style={{ fontSize: 11, color: '#ec4899', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
                        Materiales faltantes ({selected.ai_faltantes.length})
                      </span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#ccc', lineHeight: 1.6 }}>
                      {selected.ai_faltantes.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}
                {selected.ai_bloqueos && selected.ai_bloqueos.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <XOctagon size={14} color="#ef4444" />
                      <span style={{ fontSize: 11, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
                        Bloqueos ({selected.ai_bloqueos.length})
                      </span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#ccc', lineHeight: 1.6 }}>
                      {selected.ai_bloqueos.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            {selected.procesamiento_error && (
              <div style={{ marginBottom: 16, padding: 12, background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 10 }}>
                <div style={{ fontSize: 10, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Error de procesamiento</div>
                <div style={{ fontSize: 12, color: '#fca5a5' }}>{selected.procesamiento_error}</div>
              </div>
            )}

            {selected.latitude && selected.longitude && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888' }}>
                <MapPin size={11} />
                <a
                  href={`https://maps.google.com/?q=${selected.latitude},${selected.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#57FF9A', textDecoration: 'none' }}
                >
                  {Number(selected.latitude).toFixed(6)}, {Number(selected.longitude).toFixed(6)}
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
