import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useIsMobile } from '../lib/useIsMobile'
import { MessageCircle, Mail, ExternalLink, Flame, Clock, CalendarClock, Radar, ChevronLeft, ChevronRight } from 'lucide-react'

// ── Radar de Ventas ──────────────────────────────────────────────────────────
// mode='card'   → tarjeta compacta (resumen) para el dashboard. Clic → /radar-ventas
// mode='detail' → vista completa con la lista priorizada y acciones.
// Detecta lo que se te escapa SIN duplicar el CRM: cotizaciones estancadas,
// leads fríos (sin cotización), cierres vencidos/próximos. Señal: updated_at.

type Kind = 'cotizacion' | 'lead' | 'cierre'
interface Nudge {
  key: string; kind: Kind; urgency: 'alta' | 'media'
  title: string; company: string; reason: string; score: number
  leadId: string | null; phone: string | null; email: string | null
}

const DAY = 86400000
const daysSince = (iso?: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : 9999
const daysUntil = (d?: string | null) => d ? Math.floor((new Date(d + 'T00:00:00').getTime() - Date.now()) / DAY) : null
function waLink(phone?: string | null): string | null {
  if (!phone) return null
  const g = phone.replace(/\D/g, '')
  if (g.length < 10) return null
  return `https://wa.me/${g.length === 10 ? '52' + g : g}`
}

function buildNudges(leads: any[], quots: any[]): Nudge[] {
  const leadById = new Map<string, any>(); leads.forEach(l => leadById.set(l.id, l))
  const leadOf = (q: any): string | null => { try { return JSON.parse(q.notes || '{}').lead_id || null } catch { return null } }
  const CL = new Set(['ganado', 'perdido', 'pausado']); const CQ = new Set(['contrato', 'perdida'])
  const out: Nudge[] = []; const conCot = new Set<string>()
  quots.forEach(q => {
    if (CQ.has(q.stage)) return
    const lid = leadOf(q); if (lid) conCot.add(lid)
    const d = daysSince(q.updated_at); if (d < 10) return
    const lead = lid ? leadById.get(lid) : null
    const urgency = d >= 21 ? 'alta' : 'media'
    out.push({ key: 'cot-' + q.id, kind: 'cotizacion', urgency, title: q.name || 'Cotización', company: q.client_name || lead?.company || '', reason: `${d} días sin movimiento · etapa ${q.stage}`, score: (urgency === 'alta' ? 1000 : 500) + d, leadId: lid, phone: lead?.contact_phone || null, email: lead?.contact_email || null })
  })
  leads.forEach(l => {
    if (CL.has((l.status || '').toLowerCase())) return
    const du = daysUntil(l.expected_close_date)
    if (du !== null && du <= 7) {
      const v = du < 0
      out.push({ key: 'cierre-' + l.id, kind: 'cierre', urgency: 'alta', title: l.name || 'Lead', company: l.company || '', reason: v ? `cierre vencido hace ${Math.abs(du)} días` : (du === 0 ? 'cierre HOY' : `cierre en ${du} días`), score: 2000 + (v ? Math.abs(du) : 0), leadId: l.id, phone: l.contact_phone || null, email: l.contact_email || null })
    }
    if (!conCot.has(l.id)) {
      const d = daysSince(l.updated_at)
      if (d >= 15) { const urgency = d >= 30 ? 'alta' : 'media'; out.push({ key: 'lead-' + l.id, kind: 'lead', urgency, title: l.name || 'Lead', company: l.company || '', reason: `sin cotización · ${d} días sin movimiento`, score: (urgency === 'alta' ? 900 : 400) + d, leadId: l.id, phone: l.contact_phone || null, email: l.contact_email || null }) }
    }
  })
  return out.sort((a, b) => b.score - a.score)
}

function useNudges() {
  const [loading, setLoading] = useState(true)
  const [nudges, setNudges] = useState<Nudge[]>([])
  useEffect(() => {
    (async () => {
      const [{ data: leads }, { data: quots }] = await Promise.all([
        supabase.from('leads').select('id,name,company,status,close_probability,expected_close_date,contact_phone,contact_email,updated_at'),
        supabase.from('quotations').select('id,name,client_name,stage,notes,updated_at'),
      ])
      setNudges(buildNudges(leads || [], quots || [])); setLoading(false)
    })()
  }, [])
  return { loading, nudges }
}

const KIND_META: Record<Kind, { label: string; icon: any; color: string }> = {
  cotizacion: { label: 'Cotizaciones estancadas', icon: Clock, color: '#D97706' },
  lead: { label: 'Leads fríos', icon: Flame, color: '#3B82F6' },
  cierre: { label: 'Cierres', icon: CalendarClock, color: '#EF4444' },
}

// ── Tarjeta compacta (dashboard) ─────────────────────────────────────────────
export default function RadarVentas({ mode = 'card' }: { mode?: 'card' | 'detail' }) {
  if (mode === 'detail') return <RadarDetail />
  return <RadarCard />
}

function RadarCard() {
  const navigate = useNavigate()
  const { loading, nudges } = useNudges()
  const c = useMemo(() => ({
    cotizacion: nudges.filter(n => n.kind === 'cotizacion').length,
    lead: nudges.filter(n => n.kind === 'lead').length,
    cierre: nudges.filter(n => n.kind === 'cierre').length,
    alta: nudges.filter(n => n.urgency === 'alta').length,
  }), [nudges])
  return (
    <div onClick={() => navigate('/radar-ventas')} style={{
      background: '#141414', border: '1px solid #1e1e1e', borderTop: '2px solid #10B981', borderRadius: 12,
      padding: 16, cursor: 'pointer', transition: 'border-color .15s', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 130,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Radar size={16} style={{ color: '#10B981' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', flex: 1 }}>Radar de Ventas</span>
        <ChevronRight size={16} style={{ color: '#555' }} />
      </div>
      {loading ? <div style={{ color: '#666', fontSize: 12 }}>Cargando…</div> : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 30, fontWeight: 700, color: '#fff' }}>{nudges.length}</span>
            <span style={{ fontSize: 11, color: '#888' }}>por atender</span>
            {c.alta > 0 && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#EF4444', background: '#EF444418', border: '1px solid #EF444440', borderRadius: 10, padding: '2px 8px' }}>{c.alta} urgentes</span>}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#888', flexWrap: 'wrap' }}>
            <span><b style={{ color: '#D97706' }}>{c.cotizacion}</b> cotizaciones</span>
            <span><b style={{ color: '#3B82F6' }}>{c.lead}</b> leads fríos</span>
            <span><b style={{ color: '#EF4444' }}>{c.cierre}</b> cierres</span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Vista de detalle (/radar-ventas) ─────────────────────────────────────────
function RadarDetail() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { loading, nudges } = useNudges()
  const [filter, setFilter] = useState<'todos' | Kind>('todos')

  const counts = useMemo(() => ({
    cotizacion: nudges.filter(n => n.kind === 'cotizacion').length,
    lead: nudges.filter(n => n.kind === 'lead').length,
    cierre: nudges.filter(n => n.kind === 'cierre').length,
    alta: nudges.filter(n => n.urgency === 'alta').length,
  }), [nudges])
  const shown = useMemo(() => filter === 'todos' ? nudges : nudges.filter(n => n.kind === filter), [nudges, filter])
  const chip = (active: boolean, color: string): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    border: '1px solid ' + (active ? color : '#2a2a2a'), background: active ? color + '22' : 'transparent', color: active ? color : '#888',
  })

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px', maxWidth: 1000 }}>
      <button onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: '1px solid #333', borderRadius: 8, padding: '6px 12px', color: '#888', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, marginBottom: 16 }}>
        <ChevronLeft size={14} /> Dashboard
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <Radar size={20} style={{ color: '#10B981' }} />
        <span style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>Radar de Ventas</span>
        {!loading && <span style={{ fontSize: 13, color: '#888' }}>{nudges.length} por atender{counts.alta > 0 && <> · <b style={{ color: '#EF4444' }}>{counts.alta} urgentes</b></>}</span>}
      </div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 16 }}>Lo que se te está enfriando o se te olvidó dar seguimiento.</div>

      {loading ? <div style={{ color: '#666', padding: 10 }}>Cargando radar…</div>
        : nudges.length === 0 ? <div style={{ color: '#10B981', padding: 10 }}>✓ Todo al día.</div>
        : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <button onClick={() => setFilter('todos')} style={chip(filter === 'todos', '#10B981')}>Todos ({nudges.length})</button>
              <button onClick={() => setFilter('cotizacion')} style={chip(filter === 'cotizacion', '#D97706')}>Cotizaciones ({counts.cotizacion})</button>
              <button onClick={() => setFilter('lead')} style={chip(filter === 'lead', '#3B82F6')}>Leads fríos ({counts.lead})</button>
              <button onClick={() => setFilter('cierre')} style={chip(filter === 'cierre', '#EF4444')}>Cierres ({counts.cierre})</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {shown.map(n => {
                const meta = KIND_META[n.kind]; const Icon = meta.icon; const wa = waLink(n.phone)
                return (
                  <div key={n.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 8, flexWrap: 'wrap' }}>
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: n.urgency === 'alta' ? '#EF4444' : '#D97706', flexShrink: 0 }} />
                    <Icon size={14} style={{ color: meta.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: isMobile ? '100%' : 180 }}>
                      <div style={{ fontSize: 13, color: '#eee', fontWeight: 500 }}>{n.title}</div>
                      <div style={{ fontSize: 11, color: '#777' }}>{n.company && <span>{n.company} · </span>}<span style={{ color: n.urgency === 'alta' ? '#f87171' : '#d97706' }}>{n.reason}</span></div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {wa && <a href={wa} target="_blank" rel="noreferrer" title="WhatsApp" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#10B981', textDecoration: 'none', border: '1px solid #10B98140', borderRadius: 6, padding: '4px 8px' }}><MessageCircle size={12} /> WA</a>}
                      {n.email && <a href={`mailto:${n.email}`} title="Email" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#60a5fa', textDecoration: 'none', border: '1px solid #60a5fa40', borderRadius: 6, padding: '4px 8px' }}><Mail size={12} /></a>}
                      {n.leadId && <button onClick={() => navigate('/crm/' + n.leadId)} title="Abrir en CRM" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888', background: 'none', border: '1px solid #333', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit' }}><ExternalLink size={12} /></button>}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
    </div>
  )
}
