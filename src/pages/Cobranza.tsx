import { useEffect, useState, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useIsMobile } from '../lib/useIsMobile'
import { tcForYear } from '../lib/fx'
import { SectionHeader, Loading, KpiCard } from '../components/layout/UI'
import { ChevronRight, ChevronDown, ExternalLink } from 'lucide-react'

// ── Módulo Cobranza — Etapa 1 ────────────────────────────────────────────────
// Lista de leads con ≥1 cotización cerrada (contrato). Vendido/Cobrado/Adeudo por
// moneda NATIVA (MXN de cotizaciones MXN; USD de cotizaciones USD, con pesos→USD
// ya convertidos vía prorrateo). Expand por cotización. Fase editable por obra.
// Reusa la lógica de cobros del CRM (payment_allocations + abonos + efectivo).

export const FASES = [
  { key: 'cableado', label: 'Cableado', pct: 30, color: '#3B82F6' },
  { key: 'compras', label: 'Compras', pct: 60, color: '#8B5CF6' },
  { key: 'instalacion', label: 'Instalación', pct: 75, color: '#D97706' },
  { key: 'programacion', label: 'Programación', pct: 90, color: '#10B981' },
  { key: 'detalles', label: 'Detalles / Entrega', pct: 100, color: '#EF4444' },
]
const faseByKey = (k: string | null | undefined) => FASES.find(f => f.key === k)

const money = (n: number, cur: 'USD' | 'MXN') => (n ? (cur === 'USD' ? 'US$' : '$') + Math.round(n).toLocaleString('es-MX') : '—')

interface QRow {
  id: string; name: string; cur: 'USD' | 'MXN'; vendido: number; cobrado: number; adeudo: number; tc: number; fase: string | null
}
interface LeadRow {
  leadId: string; lead: string; cliente: string; nQuotes: number
  vUSD: number; vMXN: number; cUSD: number; cMXN: number; aUSD: number; aMXN: number
  fase: string | null; quotes: QRow[]
}

async function fetchAll(table: string, cols: string) {
  const PAGE = 1000; let from = 0; const out: any[] = []
  while (true) {
    const { data } = await supabase.from(table).select(cols).range(from, from + PAGE - 1)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return out
}

export default function Cobranza() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<LeadRow[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [tracking, setTracking] = useState<Record<string, any>>({}) // quotation_id → row

  async function load() {
    const [leads, quots, pa, cm, track] = await Promise.all([
      supabase.from('leads').select('id,name,company,tipo_cambio_ref').then(r => r.data || []),
      supabase.from('quotations').select('id,name,client_name,stage,notes,total,total_final,specialty,commercial_year').eq('stage', 'contrato').then(r => r.data || []),
      supabase.from('payment_allocations').select('quotation_id, monto, bank_movement_id').then(r => r.data || []),
      supabase.from('cash_movements').select('quotation_id, tipo, monto, moneda').then(r => r.data || []),
      supabase.from('cobranza_tracking').select('*').then(r => r.data || []),
    ])
    const bm = await fetchAll('bank_movements', 'id, quotation_id, tipo, monto, moneda')

    const trackMap: Record<string, any> = {}; track.forEach((t: any) => { trackMap[t.quotation_id] = t })
    setTracking(trackMap)
    const leadById = new Map<string, any>(); leads.forEach((l: any) => leadById.set(l.id, l))
    const allocMovIds = new Set(pa.map((x: any) => x.bank_movement_id).filter(Boolean))

    const curOf = (q: any): 'USD' | 'MXN' => { try { return JSON.parse(q.notes || '{}').currency === 'MXN' ? 'MXN' : 'USD' } catch { return 'USD' } }
    const leadOf = (q: any): string | null => { try { return JSON.parse(q.notes || '{}').lead_id || null } catch { return null } }
    const vendidoDe = (q: any): number => {
      if (q.total_final != null && q.total_final !== '' && !isNaN(Number(q.total_final))) return Number(q.total_final)
      if (['esp', 'cort', 'ilum', 'proy', 'dist'].includes(q.specialty)) return Number(q.total) || 0
      return (Number(q.total) || 0) * 1.16
    }
    const tcDe = (q: any, lead: any): number => {
      try { const m = JSON.parse(q.notes || '{}'); if (m.tipoCambio && !isNaN(Number(m.tipoCambio))) return Number(m.tipoCambio) } catch {}
      if (lead?.tipo_cambio_ref) return Number(lead.tipo_cambio_ref)
      return tcForYear(q.commercial_year || new Date().getFullYear())
    }
    const cobradoDe = (qId: string, cur: 'USD' | 'MXN'): number => {
      let s = 0
      pa.forEach((x: any) => { if (x.quotation_id === qId) s += Number(x.monto) || 0 })
      bm.forEach((m: any) => { if (m.tipo === 'abono' && m.quotation_id === qId && !allocMovIds.has(m.id) && (m.moneda || 'MXN') === cur) s += Number(m.monto) || 0 })
      cm.forEach((m: any) => { if (m.tipo === 'cobro_cliente' && m.quotation_id === qId && !allocMovIds.has(m.id) && (m.moneda || 'MXN') === cur) s += Number(m.monto) || 0 })
      return s
    }

    const byLead = new Map<string, LeadRow>()
    quots.forEach((q: any) => {
      const lid = leadOf(q); if (!lid) return
      const lead = leadById.get(lid); if (!lead) return
      const cur = curOf(q)
      const vendido = vendidoDe(q)
      const cobrado = cobradoDe(q.id, cur)
      const tc = tcDe(q, lead)
      const fase = trackMap[q.id]?.fase || null
      if (!byLead.has(lid)) byLead.set(lid, { leadId: lid, lead: lead.name || '—', cliente: lead.company || '', nQuotes: 0, vUSD: 0, vMXN: 0, cUSD: 0, cMXN: 0, aUSD: 0, aMXN: 0, fase: null, quotes: [] })
      const L = byLead.get(lid)!
      L.nQuotes++
      L.quotes.push({ id: q.id, name: q.name || 'Cotización', cur, vendido, cobrado, adeudo: Math.max(0, vendido - cobrado), tc, fase })
      if (cur === 'USD') { L.vUSD += vendido; L.cUSD += cobrado } else { L.vMXN += vendido; L.cMXN += cobrado }
    })
    const arr = Array.from(byLead.values())
    arr.forEach(L => {
      L.aUSD = Math.max(0, L.vUSD - L.cUSD)
      L.aMXN = Math.max(0, L.vMXN - L.cMXN)
      // fase de la obra = común entre cotizaciones (si todas igual), si no, 'mixto'
      const fs = new Set(L.quotes.map(q => q.fase || ''))
      L.fase = fs.size === 1 ? (L.quotes[0].fase || null) : 'mixto'
    })
    // ordenar por mayor adeudo (USD*~18 + MXN)
    arr.sort((a, b) => (b.aUSD * 18 + b.aMXN) - (a.aUSD * 18 + a.aMXN))
    setRows(arr)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function setFaseObra(L: LeadRow, fase: string) {
    // Aplica la fase a TODAS las cotizaciones de la obra (upsert por quotation_id)
    const payload = L.quotes.map(q => ({ quotation_id: q.id, fase, updated_at: new Date().toISOString() }))
    await supabase.from('cobranza_tracking').upsert(payload, { onConflict: 'quotation_id' })
    setTracking(prev => { const n = { ...prev }; L.quotes.forEach(q => { n[q.id] = { ...(n[q.id] || {}), quotation_id: q.id, fase } }); return n })
    setRows(prev => prev.map(r => r.leadId === L.leadId ? { ...r, fase, quotes: r.quotes.map(q => ({ ...q, fase })) } : r))
  }

  const tot = useMemo(() => rows.reduce((a, r) => ({ aUSD: a.aUSD + r.aUSD, aMXN: a.aMXN + r.aMXN, obras: a.obras + 1 }), { aUSD: 0, aMXN: 0, obras: 0 }), [rows])

  const th: React.CSSProperties = { fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }
  const thL: React.CSSProperties = { ...th, textAlign: 'left' }
  const td: React.CSSProperties = { padding: '10px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px' }}>
      <SectionHeader title="Cobranza" subtitle={`${rows.length} obras con contrato cerrado · adeudo total ${money(tot.aMXN, 'MXN')} + ${money(tot.aUSD, 'USD')}`} />

      {loading ? <Loading /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
            <KpiCard label="Adeudo MXN" value={money(tot.aMXN, 'MXN')} color="#D97706" />
            <KpiCard label="Adeudo USD" value={money(tot.aUSD, 'USD')} color="#D97706" />
            <KpiCard label="Obras por cobrar" value={String(tot.obras)} color="#3B82F6" />
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #1e1e1e', borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ background: '#111' }}>
                  <th style={{ ...thL, width: 30 }}></th>
                  <th style={thL}>Lead</th>
                  <th style={thL}>Cliente</th>
                  <th style={th}>Cots</th>
                  <th style={th}>Vendido USD</th>
                  <th style={th}>Vendido MXN</th>
                  <th style={th}>Cobrado USD</th>
                  <th style={th}>Cobrado MXN</th>
                  <th style={th}>Adeudo USD</th>
                  <th style={th}>Adeudo MXN</th>
                  <th style={{ ...thL, textAlign: 'center' }}>Fase de obra</th>
                  <th style={{ ...thL, width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(L => {
                  const open = expanded.has(L.leadId)
                  return (
                    <Fragment key={L.leadId}>
                      <tr style={{ borderTop: '1px solid #161616', cursor: 'pointer', background: open ? '#0d0d0d' : 'transparent' }}
                        onClick={() => setExpanded(p => { const n = new Set(p); n.has(L.leadId) ? n.delete(L.leadId) : n.add(L.leadId); return n })}>
                        <td style={{ ...td, textAlign: 'center', color: '#666' }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td style={{ ...td, textAlign: 'left', color: '#fff', fontWeight: 600 }}>{L.lead}</td>
                        <td style={{ ...td, textAlign: 'left', color: '#888' }}>{L.cliente || '—'}</td>
                        <td style={{ ...td, color: '#888' }}>{L.nQuotes}</td>
                        <td style={{ ...td, color: '#ccc' }}>{money(L.vUSD, 'USD')}</td>
                        <td style={{ ...td, color: '#ccc' }}>{money(L.vMXN, 'MXN')}</td>
                        <td style={{ ...td, color: '#10B981' }}>{money(L.cUSD, 'USD')}</td>
                        <td style={{ ...td, color: '#10B981' }}>{money(L.cMXN, 'MXN')}</td>
                        <td style={{ ...td, color: L.aUSD > 0 ? '#D97706' : '#555', fontWeight: 600 }}>{money(L.aUSD, 'USD')}</td>
                        <td style={{ ...td, color: L.aMXN > 0 ? '#D97706' : '#555', fontWeight: 600 }}>{money(L.aMXN, 'MXN')}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <select value={L.fase === 'mixto' ? '' : (L.fase || '')} onChange={e => setFaseObra(L, e.target.value)}
                            style={{ background: '#0e0e0e', border: '1px solid ' + (faseByKey(L.fase)?.color || '#333'), color: faseByKey(L.fase)?.color || '#888', borderRadius: 6, padding: '4px 6px', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer' }}>
                            <option value="">{L.fase === 'mixto' ? '— mixto —' : '— sin fase —'}</option>
                            {FASES.map(f => <option key={f.key} value={f.key}>{f.label} ({f.pct}%)</option>)}
                          </select>
                        </td>
                        <td style={{ ...td, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => navigate('/crm/' + L.leadId)} title="Abrir en CRM" style={{ background: 'none', border: '1px solid #333', borderRadius: 6, padding: '4px 6px', color: '#888', cursor: 'pointer' }}><ExternalLink size={12} /></button>
                        </td>
                      </tr>
                      {open && L.quotes.map(q => (
                        <tr key={q.id} style={{ background: '#0a0a0a', borderTop: '1px solid #141414' }}>
                          <td></td>
                          <td colSpan={2} style={{ ...td, textAlign: 'left', color: '#bbb', paddingLeft: 24 }}>↳ {q.name} <span style={{ color: '#555', fontSize: 10 }}>({q.cur})</span></td>
                          <td></td>
                          <td style={{ ...td, color: '#999' }}>{q.cur === 'USD' ? money(q.vendido, 'USD') : '—'}</td>
                          <td style={{ ...td, color: '#999' }}>{q.cur === 'MXN' ? money(q.vendido, 'MXN') : '—'}</td>
                          <td style={{ ...td, color: '#0a9' }}>{q.cur === 'USD' ? money(q.cobrado, 'USD') : '—'}</td>
                          <td style={{ ...td, color: '#0a9' }}>{q.cur === 'MXN' ? money(q.cobrado, 'MXN') : '—'}</td>
                          <td style={{ ...td, color: '#b5760a' }}>{q.cur === 'USD' ? money(q.adeudo, 'USD') : '—'}</td>
                          <td style={{ ...td, color: '#b5760a' }}>{q.cur === 'MXN' ? money(q.adeudo, 'MXN') : '—'}</td>
                          <td colSpan={2} style={{ ...td, textAlign: 'center', color: '#666', fontSize: 10 }}>
                            {q.cur === 'USD' && <span>≈ {money(q.vendido * q.tc, 'MXN')} MXN @ {q.tc}</span>}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
                {rows.length === 0 && <tr><td colSpan={12} style={{ padding: 30, textAlign: 'center', color: '#666' }}>Sin obras con contrato cerrado.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 10 }}>
            Montos en moneda nativa (Adeudo = Vendido − Cobrado por moneda). Los cobros en pesos aplicados a cotizaciones USD ya vienen convertidos a USD vía prorrateo. En cada cotización USD se muestra su equivalente en MXN al TC.
          </div>
        </>
      )}
    </div>
  )
}
