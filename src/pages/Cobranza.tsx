import { useEffect, useState, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useIsMobile } from '../lib/useIsMobile'
import { tcForYear } from '../lib/fx'
import { SectionHeader, Loading, KpiCard } from '../components/layout/UI'
import { ChevronRight, ChevronDown, ExternalLink } from 'lucide-react'
import { generarEstadoCuentaPdf } from '../lib/estadoCuentaPdf'

// ── Módulo Cobranza ──────────────────────────────────────────────────────────
// Cada cotización tiene su propia fase según su ESPECIALIDAD. Totales en MXN
// (USD×TC + MXN) y columnas USD nativas por separado. % objetivo = Σ(venta×%fase)/venta.

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
const moneyU = (n: number) => (n ? 'US$' + Math.round(n).toLocaleString('es-MX') : '—')
const pctS = (f: number) => (f * 100).toFixed(0) + '%'

interface QRow { id: string; name: string; specialty: string; cur: 'USD' | 'MXN'; vendido: number; cobrado: number; fase: string | null }
interface LeadRow {
  leadId: string; lead: string; tipos: string; nQuotes: number
  vTot: number; cTot: number; porCobrar: number
  vUSD: number; cUSD: number; pcUSD: number
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
  const [obraTrack, setObraTrack] = useState<Record<string, any>>({})
  const [view, setView] = useState<'detalle' | 'programacion'>('detalle')
  const [tc, setTc] = useState(tcForYear(new Date().getFullYear()))
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showFin, setShowFin] = useState(false)
  const [draft, setDraft] = useState<{ L: LeadRow; subject: string; text: string } | null>(null)
  const [copied, setCopied] = useState<'' | 'subject' | 'text'>('')
  const [para, setPara] = useState('')
  const [gmailBusy, setGmailBusy] = useState(false)
  const [gmailMsg, setGmailMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null)
  const [gmailConn, setGmailConn] = useState<boolean | null>(null)  // null = aún no se sabe

  useEffect(() => {
    fetch('/api/gmail?action=status').then(r => r.json()).then(j => setGmailConn(!!j.connected)).catch(() => setGmailConn(false))
  }, [])

  useEffect(() => {
    (async () => {
      const [leads, quots, pa, cm, track, obra] = await Promise.all([
        supabase.from('leads').select('id,name,company,tipo_cambio_ref').then(r => r.data || []),
        supabase.from('quotations').select('id,name,stage,notes,total,total_final,specialty,commercial_year').eq('stage', 'contrato').then(r => r.data || []),
        supabase.from('payment_allocations').select('quotation_id, monto, bank_movement_id, tc_aplicado, monto_origen, moneda_origen').then(r => r.data || []),
        supabase.from('cash_movements').select('quotation_id, tipo, monto, moneda, fecha, concepto, persona, lead_id, tc_aplicado, monto_cotizacion, moneda_cotizacion').then(r => r.data || []),
        supabase.from('cobranza_tracking').select('*').then(r => r.data || []),
        supabase.from('cobranza_obra').select('*').then(r => r.data || []),
      ])
      const bm = await fetchAll('bank_movements', 'id, quotation_id, tipo, monto, moneda, fecha, concepto, lead_id')
      const tm: Record<string, any> = {}; track.forEach((t: any) => { tm[t.quotation_id] = t })
      const om: Record<string, any> = {}; obra.forEach((t: any) => { om[t.lead_id] = t })
      setTracking(tm); setObraTrack(om); setRaw({ leads, quots, pa, cm, bm }); setLoading(false)
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
      if (!byLead.has(lid)) byLead.set(lid, { leadId: lid, lead: lead.name || '—', tipos: '', nQuotes: 0, vTot: 0, cTot: 0, porCobrar: 0, vUSD: 0, cUSD: 0, pcUSD: 0, avance: 0, objetivo: 0, gap: 0, fasesSet: 0, entrega: false, finiquitado: false, quotes: [] })
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
        if (q.cur === 'USD') { L.vUSD += q.vendido; L.cUSD += q.cobrado }
        sumWeighted += vE * (faseByKey(q.fase)?.pct || 0)
        if (q.fase) L.fasesSet++
        if (faseByKey(q.fase)?.pct === 100) L.entrega = true
      })
      L.tipos = [...new Set(L.quotes.map(q => q.specialty).filter(Boolean))].join(' · ')
      L.porCobrar = Math.max(0, L.vTot - L.cTot)
      L.pcUSD = Math.max(0, L.vUSD - L.cUSD)
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

  // Esperado del mes: override manual si existe, si no el gap de fase autocalculado.
  const esperadoDe = (L: LeadRow) => { const o = obraTrack[L.leadId]; return o && o.monto_esperado != null ? Number(o.monto_esperado) : Math.round(L.gap) }
  const totEsperado = useMemo(() => activas.reduce((s, L) => s + esperadoDe(L), 0), [activas, obraTrack])
  // KPIs de cobranza mensual: objetivo teórico (Σ venta×%fase) vs real cobrado vs brecha.
  const mensual = useMemo(() => {
    const teorico = activas.reduce((s, L) => s + L.objetivo * L.vTot, 0)
    const cobrado = activas.reduce((s, L) => s + L.cTot, 0)
    return { teorico, cobrado, brecha: tot.gap, esperado: totEsperado, pctAlDia: teorico > 0 ? cobrado / teorico : 0 }
  }, [activas, tot, totEsperado])
  async function saveObra(leadId: string, patch: any) {
    const cur = obraTrack[leadId] || {}
    const next = { lead_id: leadId, monto_esperado: cur.monto_esperado ?? null, fecha_pronosticada: cur.fecha_pronosticada ?? null, ...patch, updated_at: new Date().toISOString() }
    await supabase.from('cobranza_obra').upsert([next], { onConflict: 'lead_id' })
    setObraTrack(prev => ({ ...prev, [leadId]: { ...(prev[leadId] || {}), lead_id: leadId, ...patch } }))
  }

  // ── Generador de borrador de cobro (tono cálido, personalizado, editable) ──
  function buildDraft(L: LeadRow): { subject: string; text: string } {
    const esperado = esperadoDe(L)
    // ¿El proyecto es esencialmente en dólares? Entonces expresamos en USD nativo.
    const soloUSD = L.vUSD > 0 && (L.vTot - L.vUSD * tc) < Math.max(1, L.vTot * 0.02)
    const fM = (mxnVal: number, usdNative?: number) =>
      soloUSD ? ('US$' + Math.round(usdNative ?? mxnVal / tc).toLocaleString('es-MX')) : money(mxnVal)
    const lineasFase = L.quotes.map(q => {
      const f = faseByKey(q.fase)
      return `• ${q.name}: ${f ? `${f.label} (${f.pct}% del proyecto)` : 'etapa por definir'}`
    }).join('\n')
    const saldoTxt = (!soloUSD && L.pcUSD > 0)
      ? `${money(L.porCobrar)} (incluye US$${Math.round(L.pcUSD).toLocaleString('es-MX')} en dólares)`
      : fM(L.porCobrar, L.pcUSD)
    const ask = esperado > 0 ? fM(esperado, esperado / tc) : fM(L.porCobrar, L.pcUSD)
    const subject = `Avance y estado de cuenta — ${L.lead}`
    const text = [
      `Hola ${L.lead},`,
      ``,
      `Espero que te encuentres muy bien. Te comparto un breve avance de tu proyecto y el estado de cuenta a la fecha.`,
      ``,
      `Avance actual:`,
      lineasFase || '• (etapas por definir)',
      ``,
      `De acuerdo con la etapa en que vamos, en este momento correspondería un pago de ${ask}.`,
      ``,
      `Resumen de cuenta:`,
      `• Contratado: ${fM(L.vTot, L.vUSD)}`,
      `• Pagado a la fecha: ${fM(L.cTot, L.cUSD)}`,
      `• Saldo pendiente: ${saldoTxt}`,
      ``,
      `Te adjunto el estado de cuenta con el detalle. Si tienes cualquier duda, con gusto lo revisamos juntos.`,
      ``,
      `Gracias como siempre por la confianza. Quedo al pendiente.`,
      ``,
      `Un saludo,`,
    ].join('\n')
    return { subject, text }
  }
  async function copy(kind: 'subject' | 'text', value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(kind); setTimeout(() => setCopied(''), 1500) } catch {}
  }
  function conectarGmail() { window.open('/api/gmail?action=connect', '_blank') }
  // Genera el estado de cuenta detallado (mismo del CRM) para el lead y lo devuelve en base64.
  function estadoCuentaAdjunto(L: LeadRow): { filename: string; dataB64: string; mime: string } | null {
    if (!raw) return null
    const { quots, pa, bm, cm } = raw
    const leadOf = (q: any): string | null => { try { return JSON.parse(q.notes || '{}').lead_id || null } catch { return null } }
    const quotsLead = quots.filter((q: any) => leadOf(q) === L.leadId)
    const qids = new Set(quotsLead.map((q: any) => q.id))
    const bmLead = bm.filter((m: any) => m.lead_id === L.leadId || qids.has(m.quotation_id))
    const cmLead = cm.filter((m: any) => m.lead_id === L.leadId || qids.has(m.quotation_id))
    const paLead = pa.filter((x: any) => qids.has(x.quotation_id))
    const doc = generarEstadoCuentaPdf({ lead: { name: L.lead, company: '' }, quotations: quotsLead, bankMovements: bmLead, cashMovements: cmLead, paymentAllocations: paLead })
    const uri = doc.output('datauristring')
    return { filename: `Estado_de_Cuenta_${(L.lead || 'Lead').replace(/\s+/g, '_')}.pdf`, dataB64: uri.substring(uri.indexOf('base64,') + 7), mime: 'application/pdf' }
  }
  async function crearBorradorGmail() {
    if (!draft) return
    setGmailBusy(true); setGmailMsg(null)
    try {
      let attachments: any[] = []
      try { const a = estadoCuentaAdjunto(draft.L); if (a) attachments = [a] } catch { attachments = [] }
      const r = await fetch('/api/gmail?action=create_draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: para.trim(), subject: draft.subject, body: draft.text, attachments }),
      })
      const j = await r.json()
      if (j.ok) { setGmailMsg({ ok: true, text: 'Borrador creado en tu Gmail con el estado de cuenta adjunto' + (j.email ? ` (${j.email})` : ''), url: j.url }); setGmailConn(true) }
      else { setGmailMsg({ ok: false, text: j.error || 'No se pudo crear el borrador' }); if (String(j.error || '').toLowerCase().includes('conect')) setGmailConn(false) }
    } catch (e: any) { setGmailMsg({ ok: false, text: String((e && e.message) || e) }) }
    finally { setGmailBusy(false) }
  }

  const th: React.CSSProperties = { fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 7px', textAlign: 'right', whiteSpace: 'nowrap' }
  const thL: React.CSSProperties = { ...th, textAlign: 'left' }
  const td: React.CSSProperties = { padding: '9px 7px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }
  const tdU: React.CSSProperties = { ...td, fontSize: 11 }
  const tabBtn = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid ' + (active ? '#10B981' : '#2a2a2a'), background: active ? '#10B98122' : 'transparent', color: active ? '#10B981' : '#888' })

  const faseSelect = (spec: string, value: string | null, onChange: (v: string) => void) => {
    const opts = FASES_BY_SPEC[spec] || []
    const f = faseByKey(value)
    return (
      <select value={value || ''} onChange={e => onChange(e.target.value)} onClick={e => e.stopPropagation()}
        style={{ background: '#0e0e0e', border: '1px solid ' + (f ? faseColor(f.pct) : '#333'), color: f ? faseColor(f.pct) : '#888', borderRadius: 6, padding: '4px 6px', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer' }}>
        <option value="">— sin fase —</option>
        {opts.map(o => <option key={o.k} value={o.k}>{o.label} ({o.pct}%)</option>)}
      </select>
    )
  }

  const TH = (
    <tr style={{ background: '#111' }}>
      <th style={{ ...thL, width: 24 }}></th><th style={thL}>Lead</th><th style={{ ...thL, textAlign: 'center' }}>Tipo</th>
      <th style={th}>Cots</th>
      <th style={th}>Vendido</th><th style={th}>Vend USD</th>
      <th style={th}>Cobrado</th><th style={th}>Cob USD</th>
      <th style={th}>Por cobrar</th><th style={th}>P/C USD</th>
      <th style={th}>% av</th><th style={th}>% obj</th><th style={th}>A cobrar</th>
      <th style={{ ...th, textAlign: 'center' }}>Fases</th><th style={{ ...thL, width: 24 }}></th>
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
          <td style={{ ...td, textAlign: 'center', color: '#888', fontSize: 10 }}>{L.tipos || '—'}</td>
          <td style={{ ...td, color: '#888' }}>{L.nQuotes}</td>
          <td style={{ ...td, color: '#ccc' }}>{money(L.vTot)}</td>
          <td style={{ ...tdU, color: L.vUSD ? '#9ca3af' : '#333' }}>{moneyU(L.vUSD)}</td>
          <td style={{ ...td, color: '#10B981' }}>{money(L.cTot)}</td>
          <td style={{ ...tdU, color: L.cUSD ? '#0a9' : '#333' }}>{moneyU(L.cUSD)}</td>
          <td style={{ ...td, color: L.porCobrar > 0 ? '#D97706' : '#555', fontWeight: 600 }}>{money(L.porCobrar)}</td>
          <td style={{ ...tdU, color: L.pcUSD ? '#b5760a' : '#333' }}>{moneyU(L.pcUSD)}</td>
          <td style={{ ...td, color: '#ccc' }}>{pctS(L.avance)}</td>
          <td style={{ ...td, color: '#888' }}>{L.objetivo > 0 ? pctS(L.objetivo) : '—'}</td>
          <td style={{ ...td, color: atras ? '#EF4444' : '#10B981', fontWeight: 600 }}>{atras ? money(L.gap) : '✓'}</td>
          <td style={{ ...td, textAlign: 'center', color: L.fasesSet === L.nQuotes ? '#10B981' : '#D97706' }}>{L.fasesSet}/{L.nQuotes}</td>
          <td style={{ ...td, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
              <button onClick={() => { const d = buildDraft(L); setDraft({ L, subject: d.subject, text: d.text }); setPara(''); setGmailMsg(null) }} title="Redactar cobro (borrador)" style={{ background: 'none', border: '1px solid #10B98155', borderRadius: 6, padding: '4px 7px', color: '#10B981', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>✉︎</button>
              <button onClick={() => navigate('/crm/' + L.leadId)} title="Abrir en CRM" style={{ background: 'none', border: '1px solid #333', borderRadius: 6, padding: '4px 6px', color: '#888', cursor: 'pointer' }}><ExternalLink size={12} /></button>
            </div>
          </td>
        </tr>
        {open && L.quotes.map(q => {
          const vE = q.cur === 'USD' ? q.vendido * tc : q.vendido
          const cE = q.cur === 'USD' ? q.cobrado * tc : q.cobrado
          const isU = q.cur === 'USD'
          return (
            <tr key={q.id} style={{ background: '#0a0a0a', borderTop: '1px solid #141414' }}>
              <td></td>
              <td colSpan={2} style={{ ...td, textAlign: 'left', color: '#bbb', paddingLeft: 20 }}>↳ {q.name} <span style={{ color: '#555', fontSize: 10 }}>({q.specialty} · {q.cur}{isU ? ' @' + tc : ''})</span></td>
              <td></td>
              <td style={{ ...td, color: '#999' }}>{money(vE)}</td>
              <td style={{ ...tdU, color: isU ? '#9ca3af' : '#333' }}>{isU ? moneyU(q.vendido) : '—'}</td>
              <td style={{ ...td, color: '#0a9' }}>{money(cE)}</td>
              <td style={{ ...tdU, color: isU ? '#0a9' : '#333' }}>{isU ? moneyU(q.cobrado) : '—'}</td>
              <td style={{ ...td, color: '#b5760a' }}>{money(Math.max(0, vE - cE))}</td>
              <td style={{ ...tdU, color: isU ? '#b5760a' : '#333' }}>{isU ? moneyU(Math.max(0, q.vendido - q.cobrado)) : '—'}</td>
              <td style={{ ...td, color: '#999' }}>{vE > 0 ? pctS(cE / vE) : '—'}</td>
              <td style={{ ...td, color: '#666' }}>{faseByKey(q.fase) ? faseByKey(q.fase)!.pct + '%' : '—'}</td>
              <td></td>
              <td colSpan={2} style={{ padding: '6px 7px', textAlign: 'center' }}>{faseSelect(q.specialty, q.fase, v => setFaseQuote(q.id, v))}</td>
            </tr>
          )
        })}
      </Fragment>
    )
  })

  const renderProg = () => (
    <div style={{ overflowX: 'auto', border: '1px solid #1e1e1e', borderRadius: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
        <thead>
          <tr style={{ background: '#111' }}>
            <th style={thL}>Lead</th><th style={{ ...thL, textAlign: 'center' }}>Tipo</th>
            <th style={th}>Vendido</th><th style={th}>Cobrado</th><th style={th}>Por cobrar</th>
            <th style={th}>% av</th><th style={th}>% obj</th>
            <th style={{ ...th, textAlign: 'center' }}>Esperado este mes</th>
            <th style={{ ...thL, textAlign: 'center' }}>Fecha pronosticada</th>
          </tr>
        </thead>
        <tbody>
          {activas.map(L => (
            <tr key={L.leadId} style={{ borderTop: '1px solid #161616' }}>
              <td style={{ ...td, textAlign: 'left', color: '#fff', fontWeight: 600 }}>{L.lead}</td>
              <td style={{ ...td, textAlign: 'center', color: '#888', fontSize: 10 }}>{L.tipos || '—'}</td>
              <td style={{ ...td, color: '#ccc' }}>{money(L.vTot)}</td>
              <td style={{ ...td, color: '#10B981' }}>{money(L.cTot)}</td>
              <td style={{ ...td, color: '#D97706', fontWeight: 600 }}>{money(L.porCobrar)}</td>
              <td style={{ ...td, color: '#ccc' }}>{pctS(L.avance)}</td>
              <td style={{ ...td, color: '#888' }}>{L.objetivo > 0 ? pctS(L.objetivo) : '—'}</td>
              <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                <input type="number" defaultValue={esperadoDe(L)} key={L.leadId + '-' + Math.round(L.gap) + '-' + (obraTrack[L.leadId]?.monto_esperado ?? 'x')}
                  onBlur={e => { const v = e.target.value.trim(); saveObra(L.leadId, { monto_esperado: v === '' ? null : Number(v) }) }}
                  title="Auto = lo que falta para el % objetivo de fase. Editable si acordaste otro monto."
                  style={{ width: 120, background: '#0e0e0e', border: '1px solid #333', borderRadius: 6, color: '#EF4444', fontSize: 12, padding: '5px 8px', textAlign: 'right', fontFamily: 'inherit', fontWeight: 600 }} />
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                <input type="date" defaultValue={obraTrack[L.leadId]?.fecha_pronosticada || ''}
                  onChange={e => saveObra(L.leadId, { fecha_pronosticada: e.target.value || null })}
                  style={{ background: '#0e0e0e', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 12, padding: '5px 8px', fontFamily: 'inherit' }} />
              </td>
            </tr>
          ))}
          {activas.length === 0 && <tr><td colSpan={9} style={{ padding: 30, textAlign: 'center', color: '#666' }}>Sin obras activas.</td></tr>}
          <tr style={{ borderTop: '2px solid #333', background: '#0a0a0a' }}>
            <td colSpan={4} style={{ ...td, textAlign: 'left', fontWeight: 700, color: '#fff' }}>Total esperado este mes</td>
            <td style={{ ...td, color: '#666' }}>{money(tot.porCobrar)}</td>
            <td></td><td></td>
            <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: '#EF4444' }}>{money(totEsperado)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  )

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px' }}>
      <SectionHeader title="Cobranza" subtitle={`${activas.length} obras por cobrar${finiquitadas.length ? ` · ${finiquitadas.length} finiquitadas` : ''}`} />

      {loading ? <Loading /> : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button onClick={() => setView('detalle')} style={tabBtn(view === 'detalle')}>Detalle</button>
            <button onClick={() => setView('programacion')} style={tabBtn(view === 'programacion')}>Programación mensual</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 11, color: '#666' }}>TC general USD→MXN:</span>
            <input type="number" step="0.1" value={tc} onChange={e => setTc(parseFloat(e.target.value) || tc)}
              style={{ width: 70, background: '#0e0e0e', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, padding: '4px 8px', fontFamily: 'inherit' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
            {view === 'programacion' ? (<>
              <KpiCard label={`Objetivo teórico (deberías tener cobrado · ${pctS(mensual.pctAlDia)} al día)`} value={money(mensual.teorico)} color="#3B82F6" />
              <KpiCard label="Real cobrado" value={money(mensual.cobrado)} color="#10B981" />
              <KpiCard label="Brecha vs objetivo (a cobrar)" value={money(mensual.brecha)} color="#EF4444" />
              <KpiCard label="Esperado este mes (programado)" value={money(mensual.esperado)} color="#D97706" />
            </>) : (<>
              <KpiCard label="Por cobrar total" value={money(tot.porCobrar)} color="#D97706" />
              <KpiCard label="Deberías cobrar (por fase)" value={money(tot.gap)} color="#EF4444" />
              <KpiCard label="Finiquitos (entregadas)" value={money(tot.finiquito)} color="#8B5CF6" />
              <KpiCard label="Obras por cobrar" value={String(tot.obras)} color="#3B82F6" />
            </>)}
          </div>

          {view === 'detalle' ? (<>
          <div style={{ overflowX: 'auto', border: '1px solid #1e1e1e', borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1120 }}>
              <thead>{TH}</thead>
              <tbody>
                {renderRows(activas)}
                {activas.length === 0 && <tr><td colSpan={15} style={{ padding: 30, textAlign: 'center', color: '#666' }}>Sin obras activas por cobrar.</td></tr>}
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
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1120 }}>
                    <thead>{TH}</thead>
                    <tbody>{renderRows(finiquitadas)}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 11, color: '#555', marginTop: 10 }}>
            <b>Vendido/Cobrado/Por cobrar</b> = total en MXN (USD×TC + MXN); las columnas <b>USD</b> muestran la parte nativa en dólares. <b>% obj</b> = Σ(venta × %fase) ÷ venta total. <b>A cobrar</b> = lo que falta para el objetivo. <b>Fases</b> = cotizaciones con fase asignada. La fase se pone por cotización (expande la obra) según su especialidad.
          </div>
          </>) : (
            <>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 10 }}>El <b>esperado este mes</b> se autocalcula del gap de fase (lo que falta para el % objetivo). Es editable si acordaste otro monto con el cliente. Total esperado del mes: <b style={{ color: '#EF4444' }}>{money(totEsperado)}</b>.</div>
              {renderProg()}
            </>
          )}
        </>
      )}

      {/* Modal: borrador de cobro */}
      {draft && (
        <div onClick={() => setDraft(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 9998, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: isMobile ? 0 : '24px', overflow: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f0f0f', border: '1px solid #222', borderRadius: isMobile ? 0 : 12, width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid #222' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Borrador de cobro</span>
              <span style={{ fontSize: 11, color: '#666' }}>{draft.L.lead}</span>
              <button onClick={() => setDraft(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Asunto</span>
                  <button onClick={() => copy('subject', draft.subject)} style={{ marginLeft: 'auto', fontSize: 10, color: copied === 'subject' ? '#10B981' : '#888', background: 'none', border: '1px solid #333', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'subject' ? '✓ copiado' : 'Copiar'}</button>
                </div>
                <input value={draft.subject} onChange={e => setDraft(d => d ? { ...d, subject: e.target.value } : d)} style={{ width: '100%', padding: '8px 10px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#ddd', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Mensaje (editable)</span>
                  <button onClick={() => copy('text', draft.text)} style={{ marginLeft: 'auto', fontSize: 10, color: copied === 'text' ? '#10B981' : '#888', background: 'none', border: '1px solid #333', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'text' ? '✓ copiado' : 'Copiar mensaje'}</button>
                </div>
                <textarea value={draft.text} onChange={e => setDraft(d => d ? { ...d, text: e.target.value } : d)} rows={16} style={{ width: '100%', padding: '10px 12px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#ddd', fontSize: 12.5, lineHeight: 1.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4 }}>Para (correo del cliente) — opcional</div>
                <input value={para} onChange={e => setPara(e.target.value)} placeholder="cliente@correo.com (puedes dejarlo vacío y ponerlo en Gmail)" style={{ width: '100%', padding: '8px 10px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#ddd', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={() => navigate('/crm/' + draft.L.leadId)} style={{ fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 8, border: '1px solid #333', background: 'transparent', color: '#ccc', padding: '8px 12px' }}>Ver / exportar estado de cuenta (CRM)</button>
                {gmailConn === false ? (
                  <button onClick={conectarGmail} style={{ fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 8, border: '1px solid #3B82F655', background: '#3B82F622', color: '#60A5FA', padding: '8px 12px' }}>Conectar Gmail</button>
                ) : (
                  <button onClick={crearBorradorGmail} disabled={gmailBusy} style={{ fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: gmailBusy ? 'default' : 'pointer', borderRadius: 8, border: '1px solid #10B98155', background: '#10B98122', color: '#10B981', padding: '8px 12px' }}>{gmailBusy ? 'Creando…' : '✉︎ Crear borrador en Gmail'}</button>
                )}
                {gmailConn === false && <span style={{ fontSize: 10, color: '#888' }}>Un solo clic; autorizas una vez y listo.</span>}
                <span style={{ fontSize: 10, color: '#555', marginLeft: 'auto' }}>El estado de cuenta (PDF) se adjunta automáticamente al borrador.</span>
              </div>
              {gmailMsg && (
                <div style={{ fontSize: 12, color: gmailMsg.ok ? '#10B981' : '#EF4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{gmailMsg.ok ? '✓' : '⚠'} {gmailMsg.text}</span>
                  {gmailMsg.ok && gmailMsg.url && <a href={gmailMsg.url} target="_blank" rel="noreferrer" style={{ color: '#60A5FA' }}>Abrir borradores de Gmail</a>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
