import { useEffect, useState, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useIsMobile } from '../lib/useIsMobile'
import { tcForYear } from '../lib/fx'
import { SectionHeader, Loading, KpiCard } from '../components/layout/UI'
import { ChevronRight, ChevronDown, ExternalLink } from 'lucide-react'

// ── Módulo Cobranza ──────────────────────────────────────────────────────────
// Leads con ≥1 cotización cerrada (contrato). Totales en MXN (USD×TC general + MXN
// nativo). Fase de obra: desde afuera se aplica a todas las cotizaciones; adentro
// (expand) cada cotización puede tener su propia fase. % avance (cobrado/vendido)
// vs % objetivo (ponderado por venta según la fase de cada cotización).

export const FASES = [
  { key: 'cableado', label: 'Cableado', pct: 30, color: '#3B82F6' },
  { key: 'compras', label: 'Compras', pct: 60, color: '#8B5CF6' },
  { key: 'instalacion', label: 'Instalación', pct: 75, color: '#D97706' },
  { key: 'programacion', label: 'Programación', pct: 90, color: '#10B981' },
  { key: 'detalles', label: 'Detalles / Entrega', pct: 100, color: '#EF4444' },
]
const faseByKey = (k: string | null | undefined) => FASES.find(f => f.key === k)
const money = (n: number) => (n ? '$' + Math.round(n).toLocaleString('es-MX') : '—')
const pct = (f: number) => (f * 100).toFixed(0) + '%'

interface QRow { id: string; name: string; cur: 'USD' | 'MXN'; vendido: number; cobrado: number; fase: string | null }
interface LeadRow {
  leadId: string; lead: string; cliente: string; nQuotes: number
  vTot: number; cTot: number; porCobrar: number
  avance: number; objetivo: number; gap: number
  fase: string | null; entrega: boolean; quotes: QRow[]
}

async function fetchAll(table: string, cols: string) {
  const PAGE = 1000; let from = 0; const out: any[] = []
  while (true) {
    const { data } = await supabase.from(table).select(cols).range(from, from + PAGE - 1)
    if (!data || data.length === 0) break
    out.push(...data); if (data.length < PAGE) break; from += PAGE
  }
  return out
}

export default function Cobranza() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [loading, setLoading] = useState(true)
  const [raw, setRaw] = useState<any>(null)
  const [tracking, setTracking] = useState<Record<string, any>>({})
  const [tc, setTc] = useState(tcForYear(new Date().getFullYear()))
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    (async () => {
      const [leads, quots, pa, cm, track] = await Promise.all([
        supabase.from('leads').select('id,name,company,tipo_cambio_ref').then(r => r.data || []),
        supabase.from('quotations').select('id,name,stage,notes,total,total_final,specialty,commercial_year').eq('stage', 'contrato').then(r => r.data || []),
        supabase.from('payment_allocations').select('quotation_id, monto, bank_movement_id').then(r => r.data || []),
        supabase.from('cash_movements').select('quotation_id, tipo, monto, moneda').then(r => r.data || []),
        supabase.from('cobranza_tracking').select('*').then(r => r.data || []),
      ])
      const bm = await fetchAll('bank_movements', 'id, quotation_id, tipo, monto, moneda')
      const tm: Record<string, any> = {}; track.forEach((t: any) => { tm[t.quotation_id] = t })
      setTracking(tm)
      setRaw({ leads, quots, pa, cm, bm })
      setLoading(false)
    })()
  }, [])

  const rows: LeadRow[] = useMemo(() => {
    if (!raw) return []
    const { leads, quots, pa, cm, bm } = raw
    const leadById = new Map<string, any>(); leads.forEach((l: any) => leadById.set(l.id, l))
    const allocMovIds = new Set(pa.map((x: any) => x.bank_movement_id).filter(Boolean))
    const curOf = (q: any): 'USD' | 'MXN' => { try { return JSON.parse(q.notes || '{}').currency === 'MXN' ? 'MXN' : 'USD' } catch { return 'USD' } }
    const leadOf = (q: any): string | null => { try { return JSON.parse(q.notes || '{}').lead_id || null } catch { return null } }
    const vendidoDe = (q: any): number => {
      if (q.total_final != null && q.total_final !== '' && !isNaN(Number(q.total_final))) return Number(q.total_final)
      if (['esp', 'cort', 'ilum', 'proy', 'dist'].includes(q.specialty)) return Number(q.total) || 0
      return (Number(q.total) || 0) * 1.16
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
      const vendido = vendidoDe(q), cobrado = cobradoDe(q.id, cur)
      const fase = tracking[q.id]?.fase || null
      if (!byLead.has(lid)) byLead.set(lid, { leadId: lid, lead: lead.name || '—', cliente: lead.company || '', nQuotes: 0, vTot: 0, cTot: 0, porCobrar: 0, avance: 0, objetivo: 0, gap: 0, fase: null, entrega: false, quotes: [] })
      const L = byLead.get(lid)!
      L.nQuotes++
      L.quotes.push({ id: q.id, name: q.name || 'Cotización', cur, vendido, cobrado, fase })
    })
    const arr = Array.from(byLead.values())
    arr.forEach(L => {
      let sumVend = 0, sumWeighted = 0
      L.quotes.forEach(q => {
        const vE = q.cur === 'USD' ? q.vendido * tc : q.vendido
        const cE = q.cur === 'USD' ? q.cobrado * tc : q.cobrado
        L.vTot += vE; L.cTot += cE
        sumVend += vE
        sumWeighted += vE * (faseByKey(q.fase)?.pct || 0)
      })
      L.porCobrar = Math.max(0, L.vTot - L.cTot)
      L.avance = L.vTot > 0 ? L.cTot / L.vTot : 0
      L.objetivo = sumVend > 0 ? (sumWeighted / sumVend) / 100 : 0
      L.gap = Math.max(0, (L.objetivo - L.avance)) * L.vTot
      const fs = new Set(L.quotes.map(q => q.fase || ''))
      L.fase = fs.size === 1 ? (L.quotes[0].fase || null) : 'mixto'
      L.entrega = L.quotes.some(q => q.fase === 'detalles')
    })
    arr.sort((a, b) => b.porCobrar - a.porCobrar)
    return arr
  }, [raw, tracking, tc])

  async function setFase(qIds: string[], fase: string) {
    const payload = qIds.map(id => ({ quotation_id: id, fase, updated_at: new Date().toISOString() }))
    await supabase.from('cobranza_tracking').upsert(payload, { onConflict: 'quotation_id' })
    setTracking(prev => { const n = { ...prev }; qIds.forEach(id => { n[id] = { ...(n[id] || {}), quotation_id: id, fase } }); return n })
  }

  const tot = useMemo(() => rows.reduce((a, r) => ({ porCobrar: a.porCobrar + r.porCobrar, gap: a.gap + r.gap, finiquito: a.finiquito + (r.entrega ? r.porCobrar : 0), obras: a.obras + 1 }), { porCobrar: 0, gap: 0, finiquito: 0, obras: 0 }), [rows])

  const th: React.CSSProperties = { fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 8px', textAlign: 'right', whiteSpace: 'nowrap' }
  const thL: React.CSSProperties = { ...th, textAlign: 'left' }
  const td: React.CSSProperties = { padding: '9px 8px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }

  const faseSelect = (value: string, onChange: (v: string) => void, mixto = false) => (
    <select value={mixto ? '' : value} onChange={e => onChange(e.target.value)} onClick={e => e.stopPropagation()}
      style={{ background: '#0e0e0e', border: '1px solid ' + (faseByKey(value)?.color || '#333'), color: faseByKey(value)?.color || '#888', borderRadius: 6, padding: '4px 6px', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer' }}>
      <option value="">{mixto ? '— mixto —' : '— sin fase —'}</option>
      {FASES.map(f => <option key={f.key} value={f.key}>{f.label} ({f.pct}%)</option>)}
    </select>
  )

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px' }}>
      <SectionHeader title="Cobranza" subtitle={`${rows.length} obras con contrato cerrado`} />

      {loading ? <Loading /> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 11, color: '#666' }}>TC general USD→MXN:</span>
            <input type="number" step="0.1" value={tc} onChange={e => setTc(parseFloat(e.target.value) || tc)}
              style={{ width: 70, background: '#0e0e0e', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, padding: '4px 8px', fontFamily: 'inherit' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
            <KpiCard label="Por cobrar total" value={money(tot.porCobrar)} color="#D97706" />
            <KpiCard label="Deberías cobrar (por fase)" value={money(tot.gap)} color="#EF4444" />
            <KpiCard label="Finiquitos (entregadas)" value={money(tot.finiquito)} color="#8B5CF6" />
            <KpiCard label="Obras por cobrar" value={String(tot.obras)} color="#3B82F6" />
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #1e1e1e', borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr style={{ background: '#111' }}>
                  <th style={{ ...thL, width: 26 }}></th>
                  <th style={thL}>Lead</th>
                  <th style={thL}>Cliente</th>
                  <th style={th}>Cots</th>
                  <th style={th}>Vendido</th>
                  <th style={th}>Cobrado</th>
                  <th style={th}>Por cobrar</th>
                  <th style={th}>% avance</th>
                  <th style={th}>% objetivo</th>
                  <th style={th}>A cobrar (fase)</th>
                  <th style={{ ...thL, textAlign: 'center' }}>Fase de obra</th>
                  <th style={{ ...thL, width: 26 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(L => {
                  const open = expanded.has(L.leadId)
                  const atras = L.gap > 0
                  return (
                    <Fragment key={L.leadId}>
                      <tr style={{ borderTop: '1px solid #161616', cursor: 'pointer', background: open ? '#0d0d0d' : 'transparent' }}
                        onClick={() => setExpanded(p => { const n = new Set(p); n.has(L.leadId) ? n.delete(L.leadId) : n.add(L.leadId); return n })}>
                        <td style={{ ...td, textAlign: 'center', color: '#666' }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td style={{ ...td, textAlign: 'left', color: '#fff', fontWeight: 600 }}>{L.lead}{L.entrega && <span style={{ marginLeft: 6, fontSize: 9, color: '#8B5CF6', border: '1px solid #8B5CF640', borderRadius: 8, padding: '1px 6px' }}>ENTREGA</span>}</td>
                        <td style={{ ...td, textAlign: 'left', color: '#888' }}>{L.cliente || '—'}</td>
                        <td style={{ ...td, color: '#888' }}>{L.nQuotes}</td>
                        <td style={{ ...td, color: '#ccc' }}>{money(L.vTot)}</td>
                        <td style={{ ...td, color: '#10B981' }}>{money(L.cTot)}</td>
                        <td style={{ ...td, color: L.porCobrar > 0 ? '#D97706' : '#555', fontWeight: 600 }}>{money(L.porCobrar)}</td>
                        <td style={{ ...td, color: '#ccc' }}>{pct(L.avance)}</td>
                        <td style={{ ...td, color: '#888' }}>{L.objetivo > 0 ? pct(L.objetivo) : '—'}</td>
                        <td style={{ ...td, color: atras ? '#EF4444' : '#10B981', fontWeight: 600 }}>{atras ? money(L.gap) : '✓ al día'}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          {faseSelect(L.fase === 'mixto' ? '' : (L.fase || ''), v => setFase(L.quotes.map(q => q.id), v), L.fase === 'mixto')}
                        </td>
                        <td style={{ ...td, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => navigate('/crm/' + L.leadId)} title="Abrir en CRM" style={{ background: 'none', border: '1px solid #333', borderRadius: 6, padding: '4px 6px', color: '#888', cursor: 'pointer' }}><ExternalLink size={12} /></button>
                        </td>
                      </tr>
                      {open && L.quotes.map(q => {
                        const vE = q.cur === 'USD' ? q.vendido * tc : q.vendido
                        const cE = q.cur === 'USD' ? q.cobrado * tc : q.cobrado
                        return (
                          <tr key={q.id} style={{ background: '#0a0a0a', borderTop: '1px solid #141414' }}>
                            <td></td>
                            <td colSpan={2} style={{ ...td, textAlign: 'left', color: '#bbb', paddingLeft: 22 }}>↳ {q.name} <span style={{ color: '#555', fontSize: 10 }}>({q.cur}{q.cur === 'USD' ? ' @' + tc : ''})</span></td>
                            <td></td>
                            <td style={{ ...td, color: '#999' }}>{money(vE)}<div style={{ fontSize: 9, color: '#555' }}>{q.cur === 'USD' ? 'US$' + Math.round(q.vendido).toLocaleString() : ''}</div></td>
                            <td style={{ ...td, color: '#0a9' }}>{money(cE)}<div style={{ fontSize: 9, color: '#555' }}>{q.cur === 'USD' ? 'US$' + Math.round(q.cobrado).toLocaleString() : ''}</div></td>
                            <td style={{ ...td, color: '#b5760a' }}>{money(Math.max(0, vE - cE))}</td>
                            <td style={{ ...td, color: '#999' }}>{vE > 0 ? pct(cE / vE) : '—'}</td>
                            <td style={{ ...td, color: '#666' }}>{faseByKey(q.fase) ? faseByKey(q.fase)!.pct + '%' : '—'}</td>
                            <td></td>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>{faseSelect(q.fase || '', v => setFase([q.id], v))}</td>
                            <td></td>
                          </tr>
                        )
                      })}
                    </Fragment>
                  )
                })}
                {rows.length === 0 && <tr><td colSpan={12} style={{ padding: 30, textAlign: 'center', color: '#666' }}>Sin obras con contrato cerrado.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 10 }}>
            Totales en MXN = pesos nativos + (USD × TC general). <b>% objetivo</b> = promedio de la fase de cada cotización ponderado por su venta. <b>A cobrar (fase)</b> = lo que falta cobrar para alcanzar el % objetivo. Cobros en pesos aplicados a cotizaciones USD se convierten vía prorrateo del CRM.
          </div>
        </>
      )}
    </div>
  )
}
