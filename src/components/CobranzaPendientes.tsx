// ═══════════════════════════════════════════════════════════════════════════
// CobranzaPendientes — widget del Dashboard (DG).
// Muestra las obras por cobrar como pendientes accionables:
//   "[Proyecto] — Hablar al cliente y enviar estado de cuenta"
// con el saldo, el último seguimiento y el próximo paso. El detalle y el envío
// del estado de cuenta viven en el módulo /cobranza.
// El seguimiento (respuesta del cliente) se registra por screenshot (fase 2).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadObrasPorCobrar, ObraPorCobrar } from '../lib/cobranzaCalc'
import { DollarSign, ChevronRight, MessageCircle, Clock } from 'lucide-react'

const card: React.CSSProperties = { background: '#111', border: '1px solid #222', borderRadius: 12, padding: 16 }
const money = (n: number) => '$' + Math.round(n).toLocaleString('es-MX')

const EST_CFG: Record<string, { label: string; color: string }> = {
  promesa_pago: { label: 'Prometió pagar', color: '#10B981' },
  pidio_info: { label: 'Pidió info', color: '#2563EB' },
  sin_respuesta: { label: 'Sin respuesta', color: '#D97706' },
  objecion: { label: 'Objeción', color: '#DC2626' },
  pagado: { label: 'Pagado', color: '#57FF9A' },
}

interface Seg {
  lead_id: string; estado: string | null; contenido: string | null
  proximo_paso: string | null; proxima_fecha: string | null
  fecha_promesa_pago: string | null; monto_prometido: number | null; created_at: string
}

export default function CobranzaPendientes({ isMobile = false }: { isMobile?: boolean }) {
  const navigate = useNavigate()
  const [obras, setObras] = useState<ObraPorCobrar[]>([])
  const [segByLead, setSegByLead] = useState<Record<string, Seg>>({})
  const [loading, setLoading] = useState(true)
  const [verTodas, setVerTodas] = useState(false)

  async function load() {
    setLoading(true)
    const [ob, segRes] = await Promise.all([
      loadObrasPorCobrar(18),
      supabase.from('cobranza_seguimiento')
        .select('lead_id, estado, contenido, proximo_paso, proxima_fecha, fecha_promesa_pago, monto_prometido, created_at')
        .not('lead_id', 'is', null)
        .order('created_at', { ascending: false }),
    ])
    const map: Record<string, Seg> = {}
    for (const s of (segRes.data || []) as Seg[]) { if (!map[s.lead_id]) map[s.lead_id] = s } // primero = más reciente
    setObras(ob)
    setSegByLead(map)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const totalPorCobrar = useMemo(() => obras.reduce((a, o) => a + o.porCobrar, 0), [obras])
  const visibles = verTodas ? obras : obras.slice(0, 12)
  const hoy = new Date().toISOString().slice(0, 10)

  return (
    <div style={{ ...card, borderTop: '2px solid #D97706', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <DollarSign size={16} color="#D97706" />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Cobranza — por cobrar</div>
          <span style={{ fontSize: 11, color: '#666', background: '#1a1a1a', borderRadius: 20, padding: '2px 8px' }}>{obras.length}</span>
        </div>
        <div style={{ fontSize: 13, color: '#D97706', fontWeight: 700 }}>{money(totalPorCobrar)}</div>
      </div>
      <div style={{ fontSize: 11, color: '#777', marginBottom: 12 }}>Hablar al cliente y enviar estado de cuenta. El detalle y el envío están en el módulo de Cobranza.</div>

      {loading && <div style={{ color: '#666', fontSize: 12, padding: '10px 4px' }}>Cargando obras por cobrar…</div>}
      {!loading && obras.length === 0 && <div style={{ color: '#555', fontSize: 12, padding: '10px 4px' }}>No hay obras con saldo por cobrar. 🎉</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visibles.map(o => {
          const seg = segByLead[o.leadId]
          const est = seg && seg.estado ? EST_CFG[seg.estado] : null
          const prox = seg && (seg.proxima_fecha || seg.fecha_promesa_pago)
          const proxVencida = prox && prox < hoy
          return (
            <div key={o.leadId} onClick={() => navigate('/cobranza')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, background: '#0d0d0d', border: '1px solid #1a1a1a', cursor: 'pointer' }}>
              <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: '#D97706', flex: '0 0 auto' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {o.lead} <span style={{ color: '#888', fontWeight: 400 }}>— Hablar al cliente y enviar estado de cuenta</span>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#D97706', fontWeight: 700 }}>{money(o.porCobrar)}</span>
                  <span style={{ fontSize: 11, color: '#666' }}>{Math.round(o.avance * 100)}% cobrado</span>
                  {est && <span style={{ fontSize: 11, color: est.color, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}><MessageCircle size={10} />{est.label}</span>}
                  {prox && <span style={{ fontSize: 11, color: proxVencida ? '#DC2626' : '#777', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={10} />{proxVencida ? '⚠ ' : ''}seguir {prox}</span>}
                </div>
                {seg && seg.proximo_paso && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>↳ {seg.proximo_paso}</div>}
                {!seg && <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>Sin seguimiento aún</div>}
              </div>
              <ChevronRight size={16} color="#666" style={{ flex: '0 0 auto' }} />
            </div>
          )
        })}
      </div>

      {!loading && obras.length > 12 && (
        <button onClick={() => setVerTodas(v => !v)} style={{ marginTop: 10, background: 'transparent', border: '1px solid #333', color: '#aaa', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
          {verTodas ? 'Ver menos' : `Ver todas (${obras.length})`}
        </button>
      )}
    </div>
  )
}
