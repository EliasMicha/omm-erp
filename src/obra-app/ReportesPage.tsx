import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  ArrowLeft, Plus, FileText, Loader2, Sparkles,
  CheckCircle2, AlertCircle, Clock
} from 'lucide-react'

interface Reporte {
  id: string
  fecha: string
  texto_raw: string | null
  fotos: string[] | null
  tipo_reporte: string | null
  procesado: boolean
  procesamiento_error: string | null
  ai_resumen: string | null
  ai_avances: string[] | null
  ai_faltantes: string[] | null
  ai_bloqueos: string[] | null
  created_at: string
  obras: { id: string; nombre: string } | null
}

const TIPO_LABELS: Record<string, string> = {
  avance: 'Avance',
  problema: 'Problema',
  terminacion_tarea: 'Tarea terminada',
  material_faltante: 'Falta material',
  general: 'General',
}

const TIPO_COLORS: Record<string, string> = {
  avance: '#57FF9A',
  problema: '#ef4444',
  terminacion_tarea: '#3b82f6',
  material_faltante: '#f59e0b',
  general: '#888',
}

export default function ReportesPage({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate()
  const [reportes, setReportes] = useState<Reporte[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('obra_reportes')
      .select('id, fecha, texto_raw, fotos, tipo_reporte, procesado, procesamiento_error, ai_resumen, ai_avances, ai_faltantes, ai_bloqueos, created_at, obras(id, nombre)')
      .eq('instalador_id', employeeId)
      .order('created_at', { ascending: false })
      .limit(50)
    setReportes((data as any) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [employeeId])

  // Poll for unprocessed reports every 4s
  useEffect(() => {
    const hasUnprocessed = reportes.some(r => !r.procesado && !r.procesamiento_error)
    if (!hasUnprocessed) return
    const interval = setInterval(() => load(), 4000)
    return () => clearInterval(interval)
  }, [reportes])

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
          style={{
            background: 'transparent', border: '1px solid #1f1f1f',
            borderRadius: 10, padding: 10, cursor: 'pointer', color: '#fff',
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Reportes</div>
          <div style={{ fontSize: 11, color: '#666' }}>{reportes.length} reportes</div>
        </div>
        <button
          onClick={() => navigate('/obra-app/reportes/nuevo')}
          style={{
            background: '#57FF9A', border: 'none',
            borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
            color: '#0a0a0a', fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Plus size={16} /> Nuevo
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Loader2 size={24} className="spin" />
        </div>
      ) : reportes.length === 0 ? (
        <div style={{
          padding: 32, textAlign: 'center',
          background: '#1a1a1a', border: '1px solid #2a2a2a',
          borderRadius: 16, color: '#888', fontSize: 13,
        }}>
          <FileText size={32} style={{ marginBottom: 10, opacity: 0.3 }} />
          <div style={{ marginBottom: 16 }}>No has subido reportes todavía</div>
          <button
            onClick={() => navigate('/obra-app/reportes/nuevo')}
            style={{
              background: '#57FF9A', border: 'none',
              borderRadius: 10, padding: '12px 18px', cursor: 'pointer',
              color: '#0a0a0a', fontSize: 13, fontWeight: 700,
            }}
          >
            Subir mi primer reporte
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reportes.map(r => {
            const isExpanded = expanded === r.id
            const tipoColor = TIPO_COLORS[r.tipo_reporte || 'general'] || '#888'
            return (
              <div
                key={r.id}
                onClick={() => setExpanded(isExpanded ? null : r.id)}
                style={{
                  background: '#0f0f0f',
                  border: '1px solid #1a1a1a',
                  borderLeft: `3px solid ${tipoColor}`,
                  borderRadius: 12,
                  padding: 14,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: tipoColor, textTransform: 'uppercase', fontWeight: 700 }}>
                    {TIPO_LABELS[r.tipo_reporte || 'general']}
                  </span>
                  <span style={{ fontSize: 11, color: '#666' }}>·</span>
                  <span style={{ fontSize: 11, color: '#666' }}>
                    {new Date(r.created_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {r.procesado ? (
                    <Sparkles size={11} color="#a78bfa" style={{ marginLeft: 'auto' }} />
                  ) : r.procesamiento_error ? (
                    <AlertCircle size={11} color="#ef4444" style={{ marginLeft: 'auto' }} />
                  ) : (
                    <Loader2 size={11} color="#666" className="spin" style={{ marginLeft: 'auto' }} />
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  {r.obras?.nombre || 'Sin obra'}
                </div>
                {r.ai_resumen ? (
                  <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>
                    {r.ai_resumen}
                  </div>
                ) : r.texto_raw ? (
                  <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5, fontStyle: r.procesado ? 'normal' : 'italic' }}>
                    {r.procesado ? r.texto_raw : 'Procesando con IA...'}
                  </div>
                ) : !r.procesado ? (
                  <div style={{ fontSize: 12, color: '#666', fontStyle: 'italic' }}>
                    Procesando con IA...
                  </div>
                ) : null}

                {isExpanded && r.procesado && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1f1f1f' }}>
                    {r.ai_avances && r.ai_avances.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 10, color: '#57FF9A', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
                          ✓ Avances
                        </div>
                        {r.ai_avances.map((a, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#ccc', marginLeft: 8, marginBottom: 3 }}>• {a}</div>
                        ))}
                      </div>
                    )}
                    {r.ai_faltantes && r.ai_faltantes.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 10, color: '#f59e0b', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
                          ⚠ Faltantes
                        </div>
                        {r.ai_faltantes.map((a, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#ccc', marginLeft: 8, marginBottom: 3 }}>• {a}</div>
                        ))}
                      </div>
                    )}
                    {r.ai_bloqueos && r.ai_bloqueos.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 10, color: '#ef4444', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
                          ⛔ Bloqueos
                        </div>
                        {r.ai_bloqueos.map((a, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#ccc', marginLeft: 8, marginBottom: 3 }}>• {a}</div>
                        ))}
                      </div>
                    )}
                    {r.fotos && r.fotos.length > 0 && (
                      <div style={{ fontSize: 10, color: '#666', marginTop: 6 }}>
                        {r.fotos.length} foto{r.fotos.length > 1 ? 's' : ''}
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
