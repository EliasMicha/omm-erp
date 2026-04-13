import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  ArrowLeft, MapPin, Info, Package2, FileText, ClipboardList,
  Loader2, Calendar, ExternalLink, CheckCircle2, Clock,
  FileImage, FileCog, Scroll, BookOpen, File, AlertTriangle
} from 'lucide-react'

interface Obra {
  id: string
  nombre: string
  cliente: string | null
  direccion: string | null
  direccion_completa: string | null
  status: string | null
  sistemas: string[] | null
  fecha_inicio: string | null
  fecha_fin_plan: string | null
  avance_global: number | null
  valor_contrato: string | null
  moneda: string | null
  notas: string | null
}

interface Actividad {
  id: string
  sistema: string | null
  area: string | null
  descripcion: string
  status: string
  porcentaje: number
}

interface Documento {
  id: string
  nombre: string
  tipo: string
  sistema: string | null
  drive_url: string | null
  drive_thumbnail_url: string | null
  version: string | null
  fecha_subida: string | null
}

interface Reporte {
  id: string
  fecha: string
  tipo_reporte: string | null
  ai_resumen: string | null
  texto_raw: string | null
  procesado: boolean
  created_at: string
}

type Tab = 'info' | 'materiales' | 'documentos' | 'reportes'

const DOC_TIPO_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  plano: { label: 'Planos', icon: FileImage, color: '#3b82f6' },
  ficha_tecnica: { label: 'Fichas técnicas', icon: FileText, color: '#57FF9A' },
  diagrama: { label: 'Diagramas', icon: FileCog, color: '#a78bfa' },
  render: { label: 'Renders', icon: FileImage, color: '#f59e0b' },
  memoria_calculo: { label: 'Memorias de cálculo', icon: Scroll, color: '#ec4899' },
  manual: { label: 'Manuales', icon: BookOpen, color: '#14b8a6' },
  otro: { label: 'Otros', icon: File, color: '#666' },
}

const SISTEMA_EMOJI: Record<string, string> = {
  'CCTV': '📹', 'Audio': '🔊', 'Redes': '🌐', 'Control': '🎛️',
  'Iluminación': '💡', 'Eléctrico': '⚡', 'Cortinas': '🪟', 'Especiales': '🔌',
}

export default function DetalleObraPage() {
  const { obraId } = useParams<{ obraId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab) || 'info'
  const [tab, setTab] = useState<Tab>(
    ['info', 'materiales', 'documentos', 'reportes'].includes(initialTab) ? initialTab : 'info'
  )
  const [obra, setObra] = useState<Obra | null>(null)
  const [actividades, setActividades] = useState<Actividad[]>([])
  const [documentos, setDocumentos] = useState<Documento[]>([])
  const [reportes, setReportes] = useState<Reporte[]>([])
  const [loading, setLoading] = useState(true)
  const [sistemaFiltro, setSistemaFiltro] = useState<string>('todos')

  useEffect(() => {
    if (!obraId) return
    ;(async () => {
      setLoading(true)
      const [oRes, aRes, dRes, rRes] = await Promise.all([
        supabase.from('obras').select('*').eq('id', obraId).single(),
        supabase.from('obra_actividades')
          .select('id, sistema, area, descripcion, status, porcentaje')
          .eq('obra_id', obraId)
          .order('order_index', { ascending: true }),
        supabase.from('obra_documentos')
          .select('id, nombre, tipo, sistema, drive_url, drive_thumbnail_url, version, fecha_subida')
          .eq('obra_id', obraId)
          .order('fecha_subida', { ascending: false }),
        supabase.from('obra_reportes')
          .select('id, fecha, tipo_reporte, ai_resumen, texto_raw, procesado, created_at')
          .eq('obra_id', obraId)
          .order('created_at', { ascending: false })
          .limit(50),
      ])
      setObra((oRes.data as Obra) || null)
      setActividades((aRes.data as Actividad[]) || [])
      setDocumentos((dRes.data as Documento[]) || [])
      setReportes((rRes.data as Reporte[]) || [])
      setLoading(false)
    })()
  }, [obraId])

  // Group activities by area
  const actividadesByArea = useMemo(() => {
    const filtered = sistemaFiltro === 'todos'
      ? actividades
      : actividades.filter(a => a.sistema === sistemaFiltro)
    const grouped: Record<string, Actividad[]> = {}
    for (const act of filtered) {
      const key = act.area || 'Sin área'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(act)
    }
    return grouped
  }, [actividades, sistemaFiltro])

  const sistemasUnicos = useMemo(() => {
    const set = new Set<string>()
    for (const a of actividades) if (a.sistema) set.add(a.sistema)
    return Array.from(set)
  }, [actividades])

  const docsByTipo = useMemo(() => {
    const grouped: Record<string, Documento[]> = {}
    for (const d of documentos) {
      const key = d.tipo || 'otro'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(d)
    }
    return grouped
  }, [documentos])

  const statusColor = (s: string | null) =>
    s === 'en_ejecucion' ? '#57FF9A' :
    s === 'pausada' ? '#f59e0b' :
    s === 'completada' ? '#3b82f6' :
    s === 'entrega_pendiente' ? '#a78bfa' :
    '#666'

  const actStatusColor = (s: string) =>
    s === 'completada' ? '#57FF9A' :
    s === 'en_proceso' ? '#3b82f6' :
    s === 'bloqueada' ? '#ef4444' :
    '#666'

  const fmtMoney = (n: string | null, moneda: string | null) => {
    if (!n) return '—'
    return (moneda === 'USD' ? '$' : '$') + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 }) + ' ' + (moneda || 'MXN')
  }

  const fmtDate = (d: string | null) => {
    if (!d) return '—'
    return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a0a', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Loader2 size={32} className="spin" />
        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          .spin { animation: spin 1s linear infinite; }
        `}</style>
      </div>
    )
  }

  if (!obra) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a0a', color: '#fff',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}>
        <AlertTriangle size={32} color="#ef4444" style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 14, color: '#888', marginBottom: 16 }}>Obra no encontrada</div>
        <button
          onClick={() => navigate('/obra-app/mis-obras')}
          style={{
            padding: '10px 18px', background: '#57FF9A', color: '#0a0a0a',
            border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >Volver</button>
      </div>
    )
  }


  const tabs: { key: Tab; label: string; icon: any; count?: number }[] = [
    { key: 'info', label: 'Info', icon: Info },
    { key: 'materiales', label: 'Materiales', icon: Package2, count: actividades.length },
    { key: 'documentos', label: 'Documentos', icon: FileText, count: documentos.length },
    { key: 'reportes', label: 'Reportes', icon: ClipboardList, count: reportes.length },
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
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        <button
          onClick={() => navigate('/obra-app/mis-obras')}
          style={{
            background: 'transparent', border: '1px solid #1f1f1f',
            borderRadius: 10, padding: 10, cursor: 'pointer', color: '#fff',
            flexShrink: 0,
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>{obra.nombre}</div>
          {obra.cliente && <div style={{ fontSize: 11, color: '#666' }}>{obra.cliente}</div>}
        </div>
      </div>

      {/* Status banner */}
      <div style={{
        padding: 12, marginBottom: 16,
        background: `${statusColor(obra.status)}11`,
        border: `1px solid ${statusColor(obra.status)}33`,
        borderRadius: 10,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: 4, background: statusColor(obra.status) }} />
        <div style={{ flex: 1, fontSize: 12, color: statusColor(obra.status), textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1 }}>
          {obra.status || 'Sin status'}
        </div>
        {obra.avance_global !== null && (
          <div style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>
            {obra.avance_global}%
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 16,
        background: '#0f0f0f', padding: 4, borderRadius: 12, border: '1px solid #1a1a1a',
        overflowX: 'auto',
      }}>
        {tabs.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1, minWidth: 0, padding: '10px 6px',
                background: active ? '#0f2a1a' : 'transparent',
                border: 'none', borderRadius: 8,
                color: active ? '#57FF9A' : '#666',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              }}
            >
              <Icon size={15} />
              <span>{t.label}{t.count !== undefined && t.count > 0 ? ` · ${t.count}` : ''}</span>
            </button>
          )
        })}
      </div>

      {/* INFO TAB */}
      {tab === 'info' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {obra.direccion_completa || obra.direccion ? (
            <div style={{ padding: 14, background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12 }}>
              <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Dirección</div>
              <div style={{ display: 'flex', gap: 8, fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>
                <MapPin size={14} style={{ flexShrink: 0, marginTop: 2, color: '#57FF9A' }} />
                <span>{obra.direccion_completa || obra.direccion}</span>
              </div>
            </div>
          ) : null}

          {obra.sistemas && obra.sistemas.length > 0 && (
            <div style={{ padding: 14, background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12 }}>
              <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Sistemas</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {obra.sistemas.map(s => (
                  <div key={s} style={{
                    padding: '6px 10px', background: '#0f2a1a', border: '1px solid #1f3a2a',
                    borderRadius: 8, fontSize: 12, color: '#57FF9A', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <span>{SISTEMA_EMOJI[s] || '📦'}</span>
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ padding: 14, background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12 }}>
              <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Inicio</div>
              <div style={{ fontSize: 13, color: '#ccc', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={12} color="#57FF9A" />
                {fmtDate(obra.fecha_inicio)}
              </div>
            </div>
            <div style={{ padding: 14, background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12 }}>
              <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Fin plan</div>
              <div style={{ fontSize: 13, color: '#ccc', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={12} color="#f59e0b" />
                {fmtDate(obra.fecha_fin_plan)}
              </div>
            </div>
          </div>

          {obra.notas && (
            <div style={{ padding: 14, background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12 }}>
              <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Notas</div>
              <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>{obra.notas}</div>
            </div>
          )}
        </div>
      )}


      {/* MATERIALES TAB (actividades agrupadas por área) */}
      {tab === 'materiales' && (
        <div>
          {/* Filtro por sistema */}
          {sistemasUnicos.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 }}>
              <button
                onClick={() => setSistemaFiltro('todos')}
                style={{
                  flexShrink: 0, padding: '8px 12px',
                  background: sistemaFiltro === 'todos' ? '#0f2a1a' : '#0f0f0f',
                  border: `1px solid ${sistemaFiltro === 'todos' ? '#57FF9A' : '#1f1f1f'}`,
                  borderRadius: 20,
                  color: sistemaFiltro === 'todos' ? '#57FF9A' : '#888',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Todos
              </button>
              {sistemasUnicos.map(s => (
                <button
                  key={s}
                  onClick={() => setSistemaFiltro(s)}
                  style={{
                    flexShrink: 0, padding: '8px 12px',
                    background: sistemaFiltro === s ? '#0f2a1a' : '#0f0f0f',
                    border: `1px solid ${sistemaFiltro === s ? '#57FF9A' : '#1f1f1f'}`,
                    borderRadius: 20,
                    color: sistemaFiltro === s ? '#57FF9A' : '#888',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <span>{SISTEMA_EMOJI[s] || '📦'}</span>
                  <span>{s}</span>
                </button>
              ))}
            </div>
          )}

          {/* Banner entregas */}
          <div style={{
            padding: 12, marginBottom: 16,
            background: '#1a1530', border: '1px solid #3a2a5a',
            borderRadius: 10, display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <Info size={14} color="#a78bfa" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 11, color: '#c4b5fd', lineHeight: 1.5 }}>
              Pronto verás aquí el estado de entrega (bodega / camino / obra) de cada material.
            </div>
          </div>

          {actividades.length === 0 ? (
            <div style={{
              padding: 32, textAlign: 'center',
              background: '#1a1a1a', border: '1px solid #2a2a2a',
              borderRadius: 16, color: '#888', fontSize: 13,
            }}>
              <Package2 size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
              <div>Sin actividades registradas</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {Object.entries(actividadesByArea).map(([area, acts]) => (
                <div key={area}>
                  <div style={{
                    fontSize: 11, color: '#57FF9A',
                    textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
                    marginBottom: 6, paddingLeft: 4,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <MapPin size={11} />
                    {area}
                    <span style={{ color: '#666', fontWeight: 400 }}>· {acts.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {acts.map(a => (
                      <div key={a.id} style={{
                        padding: 12,
                        background: '#0f0f0f',
                        border: '1px solid #1a1a1a',
                        borderLeft: `3px solid ${actStatusColor(a.status)}`,
                        borderRadius: 10,
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <div style={{ fontSize: 18, flexShrink: 0 }}>
                          {SISTEMA_EMOJI[a.sistema || ''] || '📦'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.4 }}>
                            {a.descripcion}
                          </div>
                          {a.sistema && (
                            <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>
                              {a.sistema}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{
                            fontSize: 9,
                            color: actStatusColor(a.status),
                            textTransform: 'uppercase', fontWeight: 700,
                          }}>
                            {a.status}
                          </div>
                          {a.porcentaje > 0 && (
                            <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                              {a.porcentaje}%
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {/* DOCUMENTOS TAB */}
      {tab === 'documentos' && (
        <div>
          {documentos.length === 0 ? (
            <div style={{
              padding: 32, textAlign: 'center',
              background: '#1a1a1a', border: '1px solid #2a2a2a',
              borderRadius: 16, color: '#888', fontSize: 13,
            }}>
              <FileText size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
              <div>Sin documentos para esta obra</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {Object.entries(docsByTipo).map(([tipo, docs]) => {
                const cfg = DOC_TIPO_CONFIG[tipo] || DOC_TIPO_CONFIG.otro
                const Icon = cfg.icon
                return (
                  <div key={tipo}>
                    <div style={{
                      fontSize: 11, color: cfg.color,
                      textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
                      marginBottom: 6, paddingLeft: 4,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <Icon size={12} />
                      {cfg.label}
                      <span style={{ color: '#666', fontWeight: 400 }}>· {docs.length}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {docs.map(d => (
                        <a
                          key={d.id}
                          href={d.drive_url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: 12,
                            background: '#0f0f0f',
                            border: '1px solid #1a1a1a',
                            borderLeft: `3px solid ${cfg.color}`,
                            borderRadius: 10,
                            display: 'flex', alignItems: 'center', gap: 10,
                            textDecoration: 'none', color: '#fff',
                          }}
                        >
                          {d.drive_thumbnail_url ? (
                            <img
                              src={d.drive_thumbnail_url}
                              style={{
                                width: 44, height: 44, borderRadius: 8,
                                objectFit: 'cover', flexShrink: 0,
                                background: '#1a1a1a',
                              }}
                              alt=""
                            />
                          ) : (
                            <div style={{
                              width: 44, height: 44, borderRadius: 8,
                              background: cfg.color + '22',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0,
                            }}>
                              <Icon size={20} color={cfg.color} />
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 13, fontWeight: 600,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {d.nombre}
                            </div>
                            <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                              {[d.sistema, d.version && 'v' + d.version, d.fecha_subida && new Date(d.fecha_subida).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <ExternalLink size={14} color="#666" />
                        </a>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* REPORTES TAB */}
      {tab === 'reportes' && (
        <div>
          {reportes.length === 0 ? (
            <div style={{
              padding: 32, textAlign: 'center',
              background: '#1a1a1a', border: '1px solid #2a2a2a',
              borderRadius: 16, color: '#888', fontSize: 13,
            }}>
              <ClipboardList size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
              <div>Sin reportes para esta obra</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {reportes.map(r => (
                <div key={r.id} style={{
                  padding: 12,
                  background: '#0f0f0f',
                  border: '1px solid #1a1a1a',
                  borderRadius: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: '#a78bfa', textTransform: 'uppercase', fontWeight: 700 }}>
                      {r.tipo_reporte || 'general'}
                    </span>
                    <span style={{ fontSize: 10, color: '#666' }}>·</span>
                    <span style={{ fontSize: 10, color: '#666' }}>
                      {new Date(r.created_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>
                    {r.ai_resumen || r.texto_raw || (r.procesado ? 'Sin contenido' : 'Procesando con IA...')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
