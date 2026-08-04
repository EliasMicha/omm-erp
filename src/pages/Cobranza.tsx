import { useEffect, useState, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useIsMobile } from '../lib/useIsMobile'
import { tcForYear } from '../lib/fx'
import { SectionHeader, Loading, KpiCard } from '../components/layout/UI'
import { ChevronRight, ChevronDown, ExternalLink } from 'lucide-react'

// ── Módulo Cobranza ──────────────────────────────────────────────────────────
// Cada cotización tiene su propia fase, según su ESPECIALIDAD. El % objetivo de la
// obra = Σ(venta × %fase) / venta total. Se compara vs % avance (cobrado/vendido).

interface Fase { k: string; label: string; pct: number }
const FASES_BY_SPEC: Record<string, Fase[]> = {
  esp: [
    { k: 'esp_cableado', label: 'Cableado', pct: 30 },
    { k: 'esp_compra', label: 'Compra de equipo', pct: 60 },
    { k: 'esp_instalacion', label: 'Instalación', pct: 75 },
    { k: 'esp_programacion', label: 'Programación', pct: 90 },
    { k: 'esp_cierre', label: 'Cierre', pct: 100 },
  ],
  ilum: [
    { k: 'ilum_anticipo', label: 'Anticipo', pct: 70 },
    { k: 'ilum_instalacion', label: 'Instalación', pct: 90 },
    { k: 'ilum_finiquito', label: 'Finiquito', pct: 100 },
  ],
  cort: [
    { k: 'cort_anticipo', label: 'Anticipo', pct: 70 },
    { k: 'cort_instalacion', label: 'Instalación', pct: 90 },
    { k: 'cort_finiquito', label: 'Finiquito', pct: 100 },
  ],
  elec: [
    { k: 'elec_tuberia', label: 'Tubería', pct: 20 },
    { k: 'elec_cableado', label: 'Cableado', pct: 50 },
    { k: 'elec_tableros', label: 'Tableros', pct: 70 },
    { k: 'elec_instalacion', label: 'Instalación Lum/Acc', pct: 90 },
    { k: 'elec_cierre', label: 'Cierre', pct: 100 },
  ],
  proy: [
    { k: 'proy_anticipo', label: 'Anticipo', pct: 50 },
    { k: 'proy_finiquito', label: 'Finiquito', pct: 100 },
  ],
  dist: [
    { k: 'dist_directo', label: 'Directo', pct: 100 },
  ],
}
const ALL_FASES: Fase[] = Object.values(FASES_BY_SPEC).flat()
const faseByKey = (k: string | null | undefined) => ALL_FASES.find(f => f.k === k)
const faseColor = (pct: number) => pct >= 100 ? '#EF4444' : pct >= 90 ? '#10B981' : pct >= 60 ? '#D97706' : '#3B82F6'
const money = (n: number) => (n ? '$' + Math.round(n).toLocaleString('es-MX') : '—')
const pctS = (f: number) => (f * 100).toFixed(0) + '%'

interface QRow { id: string; name: string; specialty: string; cur: 'USD' | 'MXN'; vendido: number; cobrado: number; fase: string | null }
interface LeadRow {
  leadId: string; lead: string; cliente: string; nQuotes: number
  vTot: number; cTot: number; porCobrar: number
  avance: number; objetivo: number; gap: number
  fasesSet: number; entrega: boolean; finiquitado: boolean; quotes: QRow[]
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
  const [showFin, setShowFin] = useState(false)

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
      setTracking(tm); setRaw({ leads, quots, pa, cm, bm }); setLoading(false)
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
      if (['esp', 'cort', 'ilum', 'proy', 'dist', 'elec'].includes(q.specialty)) return Number(q.total) || 0
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
      if (!byLead.has(lid)) byLead.set(lid, { leadId: lid, lead: lead.name || '—', cliente: lead.company || '', nQuotes: 0, vTot: 0, cTot: 0, porCobrar: 0, avance: 0, objetivo: 0, gap: 0, fasesSet: 0, entrega: false, finiquitado: false, quotes: [] })
      const L = byLead.get(lid)!
      L.nQuotes++
      L.quotes.push({ id: q.id, name: q.name || 'Cotización', specialty: q.specialty || '', cur, vendido: vendidoDe(q), cobrado: cobradoDe(q.id, cur), fase: tracking[q.id]?.fase || null })
    })
    const arr = Array.from(byLead.values())
    arr.forEach(L => {
      let sumVend = 0, sumWeighted = 0
      L.quotes.forEach(q => {
        const vE = q.cur === 'USD' ? q.vendido * tc : q.vendido
        const cE = q.cur === 'USD' ? q.cobrado * tc : q.cobrado
        L.vTot += vE; L.cTot += cE; sumVend += vE
        sumWeighted += vE * (faseByKey(q.fase)?.pct || 0)
        if (q.fase) L.fasesSet++
        if (faseByKey(q.fase)?.pct === 100) L.entrega = true
      })
      L.porCobrar = Math.max(0, L.vTot - L.cTot)
      L.avance = L.vTot > 0 ? L.cTot / L.vTot : 0
      L.objetivo = sumVend > 0 ? (sumWeighted / sumVend) / 100 : 0
      L.gap = Math.max(0, (L.objetivo - L.avance)) * L.vTot
      L.finiquitado = L.vTot > 0 && (L.avance >= 0.999 || L.porCobrar < Math.max(1, L.vTot * 0.002))
    })
    arr.sort((a, b) => b.porCobrar - a.porCobrar)
    return arr
  }, [raw, tracking, tc])

  const activas = useMemo(() => rows.filter(r => !r.finiquitado), [rows])
  const finiquitadas = useMemo(() => rows.filter(r => r.finiquitado), [rows])
  const tot = useMemo(() => activas.reduce((a, r) => ({ porCobrar: a.porCobrar + r.porCobrar, gap: a.gap + r.gap, finiquito: a.finiquito + (r.entrega ? r.porCobrar : 0), obras: a.obras + 1 }), { porCobrar: 0, gap: 0, finiquito: 0, obras: 0 }), [activas])

  async function setFaseQuote(qId: string, fase: string) {
    await supabase.from('cobranza_tracking').upsert([{ quotation_id: qId, fase, updated_at: new Date().toISOString() }], { onConflict: 'quotation_id' })
    setTracking(prev => ({ ...prev, [qId]: { ...(prev[qId] || {}), quotation_id: qId, fase } }))
  }

  const th: React.CSSProperties = { fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 8px', textAlign: 'right', whiteSpace: 'nowrap' }
  const thL: React.CSSProperties = { ...th, textAlign: 'left' }
  const td: React.CSSProperties = { padding: '9px 8px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }

  const faseSelect = (spec: string, value: string | null, onChange: (v: string) => void) => {
    const opts = FASES_BY_SPEC[spec] || []
    const f = faseByKey(value)
    return (
      <select value={value || ''} onChange={e => onChange(e.target.value)} onClick={e => e.stopPropagation()}
        style={{ background: '#0e0e0e', border: '1px solid ' + (f ? faseColor(f.pct) : '#333'), color: f ? faseColor(f.pct) : '#888', borderRadius: 6, padding: '4px 6px', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer' }}>
        <option value="">— sin fase —</option>
        {opts.map(o => <option key={o.k} value={o.k}>{o.label} ({o.pct}%)</option>)}
        {opts.length === 0 && <option value="" disabled>(especialidad sin fases)</option>}
      </select>
    )
  }

  const TH = (
    <tr style={{ background: '#111' }}>
      <th style={{ ...thL, width: 26 }}></th><th style={thL}>Lead</th><th style={thL}>Cliente</th>
      <th style={th}>Cots</th><th style={th}>Vendido</th><th style={th}>Cobrado</th><th style={th}>Por cobrar</th>
      <th style={th}>% avance</th><th style={th}>% objetivo</th><th style={th}>A cobrar (fase)</th>
      <th style={{ ...th, textAlign: 'center' }}>Fases</th><th style={{ ...thL, width: 26 }}></th>
    </tr>
  )

  const renderRows = (list: LeadRow[]) => list.map(L => {
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
          <td style={{ ...td, color: '#ccc' }}>{pctS(L.avance)}</td>
          <td style={{ ...td, color: '#888' }}>{L.objetivo > 0 ? pctS(L.objetivo) : '—'}</td>
          <td style={{ ...td, color: atras ? '#EF4444' : '#10B981', fontWeight: 600 }}>{atras ? money(L.gap) : '✓ al día'}</td>
          <td style={{ ...td, textAlign: 'center', color: L.fasesSet === L.nQuotes ? '#10B981' : '#D97706' }}>{L.fasesSet}/{L.nQuotes}</td>
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
              <td colSpan={2} style={{ ...td, textAlign: 'left', color: '#bbb', paddingLeft: 22 }}>↳ {q.name} <span style={{ color: '#555', fontSize: 10 }}>({q.specialty} · {q.cur}{q.cur === 'USD' ? ' @' + tc : ''})</span></td>
              <td></td>
              <td style={{ ...td, color: '#999' }}>{money(vE)}<div style={{ fontSize: 9, color: '#555' }}>{q.cur === 'USD' ? 'US$' + Math.round(q.vendido).toLocaleString() : ''}</div></td>
              <td style={{ ...td, color: '#0a9' }}>{money(cE)}<div style={{ fontSize: 9, color: '#555' }}>{q.cur === 'USD' ? 'US$' + Math.round(q.cobrado).toLocaleString() : ''}</div></td>
              <td style={{ ...td, color: '#b5760a' }}>{money(Math.max(0, vE - cE))}</td>
              <td style={{ ...td, color: '#999' }}>{vE > 0 ? pctS(cE / vE) : '—'}</td>
              <td style={{ ...td, color: '#666' }}>{faseByKey(q.fase) ? faseByKey(q.fase)!.pct + '%' : '—'}</td>
              <td></td>
              <td colSpan={2} style={{ padding: '6px 8px', textAlign: 'center' }}>{faseSelect(q.specialty, q.fase, v => setFaseQuote(q.id, v))}</td>
            </tr>
          )
        })}
      </Fragment>
    )
  })

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px' }}>
      <SectionHeader title="Cobranza" subtitle={`${activas.length} obras por cobrar${finiquitadas.length ? ` · ${finiquitadas.length} finiquitadas` : ''}`} />

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
              <thead>{TH}</thead>
              <tbody>
                {renderRows(activas)}
                {activas.length === 0 && <tr><td colSpan={12} style={{ padding: 30, textAlign: 'center', color: '#666' }}>Sin obras activas por cobrar.</td></tr>}
              </tbody>
            </table>
          </div>

          {finiquitadas.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <button onClick={() => setShowFin(s => !s)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid #222', borderRadius: 8, padding: '8px 14px', color: '#888', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>
                {showFin ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Obras finiquitadas ({finiquitadas.length}) — cobradas al ~100%
              </button>
              {showFin && (
                <div style={{ overflowX: 'auto', border: '1px solid #1a1a1a', borderRadius: 12, marginTop: 10, opacity: 0.7 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                    <thead>{TH}</thead>
                    <tbody>{renderRows(finiquitadas)}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 11, color: '#555', marginTop: 10 }}>
            Cada cotización tiene su fase según su especialidad (esp: 5 fases AV · proy: 50/50 · ilum y cort: anticipo/instal/finiquito · elec: 5 por avance · dist: directo). <b>% objetivo</b> = Σ(venta × %fase) ÷ venta total. <b>A cobrar (fase)</b> = lo que falta para alcanzar el objetivo. La columna <b>Fases</b> muestra cuántas cotizaciones ya tienen fase asignada.
          </div>
        </>
      )}
    </div>
  )
}
