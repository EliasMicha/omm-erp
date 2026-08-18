import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { cargarMaterialesObra, type RenglonMaterial } from '../lib/materialesObra'
import MaterialCard from './MaterialCard'
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

// OJO: la pestaña 'materiales' SIEMPRE mostró actividades (obra_actividades).
// Se conserva la clave para no romper los links que ya circulan, pero de cara
// al instalador se llama "Actividades" — el material real vive en la pantalla
// de "Pedir material".
type Tab = 'info' | 'materiales' | 'equipo' | 'documentos' | 'reportes'

const DOC_TIPO_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  plano: { label: 'Planos', icon: FileImage, color: '#3b82f6' },
  ficha_tecnica: { label: 'Fichas técnicas', icon: FileText, color: '#10B981' },
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
    ['info', 'materiales', 'equipo', 'documentos', 'reportes'].includes(initialTab) ? initialTab : 'info'
  )
  const [obra, setObra] = useState<Obra | null>(null)
  const [actividades, setActividades] = useState<Actividad[]>([])
  // Materiales reales de la obra (equipo), separados de las actividades.
  const [materiales, setMateriales] = useState<RenglonMaterial[]>([])
  const [matCargando, setMatCargando] = useState(true)
  const [matSistema, setMatSistema] = useState('todos')
  const [matModo, setMatModo] = useState<'faltantes' | 'todo'>('todo')
  const [matBusca, setMatBusca] = useState('')
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
      const o = (oRes.data as any) || null
      setObra(o)
      setActividades((aRes.data as Actividad[]) || [])
      setDocumentos((dRes.data as Documento[]) || [])
      setReportes((rRes.data as Reporte[]) || [])
      setLoading(false)

      // El catálogo de materiales va aparte: son varias queries y no debe
      // frenar el resto de la ficha.
      if (o) {
        setMatCargando(true)
        cargarMaterialesObra({
          id: o.id, cotizacion_id: o.quotation_id,
          quotation_ids: o.quotation_ids, project_id: o.project_id,
        })
          .then(d => setMateriales(d.renglones.filter(r => !r.fueraDeCatalogo)))
          .catch(() => setMateriales([]))
          .finally(() => setMatCargando(false))
      } else setMatCargando(false)
    })()
  }, [obraId])

  const matSistemas = useMemo(
    () => Array.from(new Set(materiales.map(r => r.sistema).filter(Boolean))).sort(),
    [materiales])

  const matFiltrados = useMemo(() => {
    const q = matBusca.trim().toLowerCase()
    return materiales
      .filter(r => matSistema === 'todos' || r.sistema === matSistema)
      .filter(r => matModo === 'todo' || r.cotizado - r.recibido > 0)
      .filter(r => !q || `${r.descripcion} ${r.marca} ${r.modelo} ${r.sistema}`.toLowerCase().includes(q))
  }, [materiales, matSistema, matModo, matBusca])

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
    s === 'en_ejecucion' ? '#10B981' :
    s === 'pausada' ? '#f59e0b' :
    s === 'completada' ? '#3b82f6' :
    s === 'entrega_pendiente' ? '#a78bfa' :
    '#666'

  const actStatusColor = (s: string) =>
    s === 'completada' ? '#10B981' :
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
            padding: '10px 18px', background: '#10B981', color: '#0a0a0a',
            border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >Volver</button>
      </div>
    )
  }


  const tabs: { key: Tab; label: string; icon: any; count?: number }[] = [
    { key: 'info', label: 'Info', icon: Info },
    { key: 'materiales', label: 'Actividades', icon: ClipboardList, count: actividades.length },
    { key: 'equipo', label: 'Materiales', icon: Package2, count: materiales.length },
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

      {/* Pedir material — la acción que más va a usar el instalador */}
      <button onClick={() => navigate(`/obra-app/mis-obras/${obra.id}/material`)}
        style={{
          width: '100%', padding: 14, marginBottom: 16, borderRadius: 12,
          border: '1px solid #10B98155', background: '#0d1a12', color: '#4ADE80',
          fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
        <Package2 size={17} /> Pedir material para esta obra
      </button>

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
                color: active ? '#10B981' : '#666',
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
                <MapPin size={14} style={{ flexShrink: 0, marginTop: 2, color: '#10B981' }} />
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
                    borderRadius: 8, fontSize: 12, color: '#10B981', fontWeight: 600,
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
                <Calendar size={12} color="#10B981" />
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


      {/* ═══ MATERIALES (equipo real de la obra) ═══ */}
      {tab === 'equipo' && (
        <div>
          <button onClick={() => navigate(`/obra-app/mis-obras/${obra.id}/material`)}
            style={{
              width: '100%', padding: 14, marginBottom: 14, borderRadius: 12,
              border: '1px solid #10B98155', background: '#0d1a12', color: '#4ADE80',
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            <Package2 size={17} /> Pedir material para esta obra
          </button>

          {matCargando ? (
            <div style={{ textAlign: 'center', padding: 30, color: '#666', fontSize: 12 }}>Cargando materiales…</div>
          ) : materiales.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 16, color: '#888', fontSize: 13 }}>
              <Package2 size={30} style={{ marginBottom: 10, opacity: 0.3 }} />
              <div>Esta obra todavía no tiene catálogo de materiales.</div>
            </div>
          ) : (
            <>
              {/* Faltantes vs todo */}
              <div style={{ display: 'flex', gap: 3, marginBottom: 10, background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12, padding: 3 }}>
                {([['faltantes', 'Solo faltantes'], ['todo', 'Todo el proyecto']] as const).map(([k, l]) => {
                  const act = matModo === k
                  const n = k === 'faltantes'
                    ? materiales.filter(r => (matSistema === 'todos' || r.sistema === matSistema) && r.cotizado - r.recibido > 0).length
                    : materiales.filter(r => matSistema === 'todos' || r.sistema === matSistema).length
                  return (
                    <button key={k} onClick={() => setMatModo(k)} style={{
                      flex: 1, padding: '11px 8px', borderRadius: 9, border: 'none',
                      background: act ? '#10B981' : 'transparent', color: act ? '#04120a' : '#888',
                      fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                    }}>{l} <span style={{ opacity: 0.7 }}>{n}</span></button>
                  )
                })}
              </div>

              {/* Filtro por sistema */}
              {matSistemas.length > 1 && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto', paddingBottom: 4 }}>
                  {['todos', ...matSistemas].map(sis => {
                    const act = matSistema === sis
                    const n = sis === 'todos' ? materiales.length : materiales.filter(r => r.sistema === sis).length
                    return (
                      <button key={sis} onClick={() => setMatSistema(sis)} style={{
                        flexShrink: 0, padding: '8px 13px', borderRadius: 20,
                        background: act ? '#0f2a1a' : '#0f0f0f',
                        border: `1px solid ${act ? '#10B981' : '#1f1f1f'}`,
                        color: act ? '#10B981' : '#888',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        {sis !== 'todos' && <span>{SISTEMA_EMOJI[sis] || '📦'}</span>}
                        <span>{sis === 'todos' ? 'Todos' : sis}</span>
                        <span style={{ opacity: 0.6, fontWeight: 500 }}>{n}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              <input value={matBusca} onChange={e => setMatBusca(e.target.value)}
                placeholder="Buscar por modelo, marca o descripción"
                style={{
                  width: '100%', padding: '10px 12px', marginBottom: 12, boxSizing: 'border-box',
                  background: '#0a0a0a', border: '1px solid #262626', borderRadius: 10,
                  color: '#fff', fontSize: 14, fontFamily: 'inherit',
                }} />

              <div style={{ fontSize: 11, color: '#666', marginBottom: 10 }}>
                Toca cualquier equipo para ver quién lo recibió y cuándo.
              </div>

              {matFiltrados.length === 0 ? (
                <div style={{ padding: 26, textAlign: 'center', color: '#666', fontSize: 12 }}>
                  {matModo === 'faltantes' ? 'No falta nada con este filtro: ya está todo en obra.' : 'Nada que mostrar con este filtro.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 20 }}>
                  {matFiltrados.map(r => <MaterialCard key={r.clave} r={r} />)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ACTIVIDADES, agrupadas por área (la clave del tab sigue siendo 'materiales') */}
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
                  border: `1px solid ${sistemaFiltro === 'todos' ? '#10B981' : '#1f1f1f'}`,
                  borderRadius: 20,
                  color: sistemaFiltro === 'todos' ? '#10B981' : '#888',
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
                    border: `1px solid ${sistemaFiltro === s ? '#10B981' : '#1f1f1f'}`,
                    borderRadius: 20,
                    color: sistemaFiltro === s ? '#10B981' : '#888',
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

          {/* Estas son tareas. El material está en su propia pantalla. */}
          <button onClick={() => navigate(`/obra-app/mis-obras/${obra.id}/material`)}
            style={{
              width: '100%', padding: 12, marginBottom: 16, textAlign: 'left',
              background: '#1a1530', border: '1px solid #3a2a5a', borderRadius: 10,
              display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontFamily: 'inherit',
            }}>
            <Info size={14} color="#a78bfa" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 11, color: '#c4b5fd', lineHeight: 1.5 }}>
              Aquí van las <b>tareas</b> de la obra. Para ver el equipo (qué hay en bodega, qué ya llegó)
              y pedirlo, entra a <b>Pedir material</b>. →
            </div>
          </button>

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
                    fontSize: 11, color: '#10B981',
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
