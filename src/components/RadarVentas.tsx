import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useIsMobile } from '../lib/useIsMobile'
import { MessageCircle, Mail, ExternalLink, Flame, Clock, CalendarClock, Radar } from 'lucide-react'

// ── Radar de Ventas ──────────────────────────────────────────────────────────
// Detecta lo que se te está escapando en ventas SIN duplicar el CRM:
//  - Cotizaciones activas estancadas (sin movimiento hace días)
//  - Leads activos fríos (sin cotización y sin toque hace días)
//  - Cierres vencidos o próximos (expected_close_date)
// Señal base: updated_at (no hay activity_log poblado). Acciones directas: WhatsApp / email / abrir.

type Kind = 'cotizacion' | 'lead' | 'cierre'
interface Nudge {
  key: string
  kind: Kind
  urgency: 'alta' | 'media'
  title: string
  company: string
  reason: string
  score: number
  leadId: string | null
  phone: string | null
  email: string | null
}

const DAY = 86400000
function daysSince(iso?: string | null): number {
  if (!iso) return 9999
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY)
}
function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  return Math.floor((d.getTime() - Date.now()) / DAY)
}
function waLink(phone?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 10) return null
  const full = digits.length === 10 ? '52' + digits : digits
  return `https://wa.me/${full}`
}

export default function RadarVentas() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [loading, setLoading] = useState(true)
  const [nudges, setNudges] = useState<Nudge[]>([])
  const [filter, setFilter] = useState<'todos' | Kind>('todos')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data: leads }, { data: quots }] = await Promise.all([
        supabase.from('leads').select('id,name,company,status,close_probability,expected_close_date,contact_phone,contact_email,updated_at'),
        supabase.from('quotations').select('id,name,client_name,stage,notes,updated_at'),
      ])
      const leadById = new Map<string, any>(); (leads || []).forEach(l => leadById.set(l.id, l))
      const leadIdOfQuot = (q: any): string | null => { try { return JSON.parse(q.notes || '{}').lead_id || null } catch { return null } }

      const CERRADO_LEAD = new Set(['ganado', 'perdido', 'pausado'])
      const CERRADO_COT = new Set(['contrato', 'perdida'])
      const out: Nudge[] = []
      const leadsConCotActiva = new Set<string>()

      // 1) Cotizaciones activas estancadas
      ;(quots || []).forEach(q => {
        if (CERRADO_COT.has(q.stage)) return
        const lid = leadIdOfQuot(q)
        if (lid) leadsConCotActiva.add(lid)
        const d = daysSince(q.updated_at)
        if (d < 10) return
        const lead = lid ? leadById.get(lid) : null
        const urgency = d >= 21 ? 'alta' : 'media'
        out.push({
          key: 'cot-' + q.id, kind: 'cotizacion', urgency,
          title: q.name || 'Cotización', company: q.client_name || lead?.company || '',
          reason: `${d} días sin movimiento · etapa ${q.stage}`,
          score: (urgency === 'alta' ? 1000 : 500) + d,
          leadId: lid, phone: lead?.contact_phone || null, email: lead?.contact_email || null,
        })
      })

      // 2) Leads activos: cierres + fríos sin cotización
      ;(leads || []).forEach(l => {
        if (CERRADO_LEAD.has((l.status || '').toLowerCase())) return
        // Cierre vencido / próximo
        const du = daysUntil(l.expected_close_date)
        if (du !== null && du <= 7) {
          const vencido = du < 0
          out.push({
            key: 'cierre-' + l.id, kind: 'cierre', urgency: 'alta',
            title: l.name || 'Lead', company: l.company || '',
            reason: vencido ? `cierre vencido hace ${Math.abs(du)} días` : (du === 0 ? 'cierre HOY' : `cierre en ${du} días`),
            score: 2000 + (vencido ? Math.abs(du) : 0),
            leadId: l.id, phone: l.contact_phone || null, email: l.contact_email || null,
          })
        }
        // Lead frío SIN cotización activa (los que sí tienen cot ya salen arriba)
        if (!leadsConCotActiva.has(l.id)) {
          const d = daysSince(l.updated_at)
          if (d >= 15) {
            const urgency = d >= 30 ? 'alta' : 'media'
            out.push({
              key: 'lead-' + l.id, kind: 'lead', urgency,
              title: l.name || 'Lead', company: l.company || '',
              reason: `sin cotización · ${d} días sin movimiento`,
              score: (urgency === 'alta' ? 900 : 400) + d,
              leadId: l.id, phone: l.contact_phone || null, email: l.contact_email || null,
            })
          }
        }
      })

      out.sort((a, b) => b.score - a.score)
      setNudges(out)
      setLoading(false)
    }
    load()
  }, [])

  const counts = useMemo(() => ({
    cotizacion: nudges.filter(n => n.kind === 'cotizacion').length,
    lead: nudges.filter(n => n.kind === 'lead').length,
    cierre: nudges.filter(n => n.kind === 'cierre').length,
    alta: nudges.filter(n => n.urgency === 'alta').length,
  }), [nudges])

  const shown = useMemo(() => {
    const f = filter === 'todos' ? nudges : nudges.filter(n => n.kind === filter)
    return expanded ? f : f.slice(0, 12)
  }, [nudges, filter, expanded])

  const KIND_META: Record<Kind, { label: string; icon: any; color: string }> = {
    cotizacion: { label: 'Cotizaciones estancadas', icon: Clock, color: '#D97706' },
    lead: { label: 'Leads fríos', icon: Flame, color: '#3B82F6' },
    cierre: { label: 'Cierres', icon: CalendarClock, color: '#EF4444' },
  }

  const card: React.CSSProperties = { background: '#141414', border: '1px solid #1e1e1e', borderRadius: 12, padding: isMobile ? 14 : 18, marginBottom: 20 }
  const chip = (active: boolean, color: string): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    border: '1px solid ' + (active ? color : '#2a2a2a'), background: active ? color + '22' : 'transparent', color: active ? color : '#888',
  })

  return (
    <div style={{ ...card, borderTop: '2px solid #10B981' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <Radar size={18} style={{ color: '#10B981' }} />
        <span style={{ fontSize: isMobile ? 15 : 17, fontWeight: 700, color: '#fff' }}>Radar de Ventas</span>
        {!loading && (
          <span style={{ fontSize: 12, color: '#888' }}>
            {nudges.length} por atender{counts.alta > 0 && <> · <b style={{ color: '#EF4444' }}>{counts.alta} urgentes</b></>}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 12 }}>Lo que se te está enfriando o se te olvidó dar seguimiento.</div>

      {loading ? (
        <div style={{ color: '#666', fontSize: 13, padding: 10 }}>Cargando radar…</div>
      ) : nudges.length === 0 ? (
        <div style={{ color: '#10B981', fontSize: 13, padding: 10 }}>✓ Todo al día, nada pendiente de seguimiento.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button onClick={() => setFilter('todos')} style={chip(filter === 'todos', '#10B981')}>Todos ({nudges.length})</button>
            <button onClick={() => setFilter('cotizacion')} style={chip(filter === 'cotizacion', '#D97706')}>Cotizaciones ({counts.cotizacion})</button>
            <button onClick={() => setFilter('lead')} style={chip(filter === 'lead', '#3B82F6')}>Leads fríos ({counts.lead})</button>
            <button onClick={() => setFilter('cierre')} style={chip(filter === 'cierre', '#EF4444')}>Cierres ({counts.cierre})</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shown.map(n => {
              const meta = KIND_META[n.kind]
              const Icon = meta.icon
              const wa = waLink(n.phone)
              return (
                <div key={n.key} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 8, flexWrap: 'wrap',
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, background: n.urgency === 'alta' ? '#EF4444' : '#D97706', flexShrink: 0 }} />
                  <Icon size={14} style={{ color: meta.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: isMobile ? '100%' : 180 }}>
                    <div style={{ fontSize: 13, color: '#eee', fontWeight: 500 }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: '#777' }}>
                      {n.company && <span>{n.company} · </span>}
                      <span style={{ color: n.urgency === 'alta' ? '#f87171' : '#d97706' }}>{n.reason}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {wa && <a href={wa} target="_blank" rel="noreferrer" title="WhatsApp" onClick={e => e.stopPropagation()}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#10B981', textDecoration: 'none', border: '1px solid #10B98140', borderRadius: 6, padding: '4px 8px' }}>
                      <MessageCircle size={12} /> WA</a>}
                    {n.email && <a href={`mailto:${n.email}`} title="Email" onClick={e => e.stopPropagation()}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#60a5fa', textDecoration: 'none', border: '1px solid #60a5fa40', borderRadius: 6, padding: '4px 8px' }}>
                      <Mail size={12} /></a>}
                    {n.leadId && <button onClick={() => navigate('/crm/' + n.leadId)} title="Abrir en CRM"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888', background: 'none', border: '1px solid #333', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>
                      <ExternalLink size={12} /></button>}
                  </div>
                </div>
              )
            })}
          </div>

          {(() => {
            const total = filter === 'todos' ? nudges.length : nudges.filter(n => n.kind === filter).length
            return total > 12 && (
              <button onClick={() => setExpanded(e => !e)} style={{ marginTop: 12, fontSize: 12, color: '#10B981', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                {expanded ? 'Ver menos' : `Ver ${total - 12} más`}
              </button>
            )
          })()}
        </>
      )}
    </div>
  )
}
