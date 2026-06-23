import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { F, formatDate } from '../lib/utils'
import { KpiCard, Table, Th, Td, Badge, Btn, EmptyState, Loading } from '../components/layout/UI'
import { Plus, X, Search, FileText, Trash2, DollarSign, Clock, CheckCircle, Loader2, AlertTriangle } from 'lucide-react'

export interface PropOpt { id: string; name: string; client_name: string | null; address: string | null; city: string | null; client_phone: string | null }

const QUOTE_STATUS: Record<string, { label: string; color: string }> = {
  borrador: { label: 'Borrador', color: '#6B7280' },
  enviada: { label: 'Enviada', color: '#2563EB' },
  aceptada: { label: 'Aceptada', color: '#10B981' },
  rechazada: { label: 'Rechazada', color: '#DC2626' },
  vencida: { label: 'Vencida', color: '#D97706' },
}
const money = (n: number, cur = 'MXN') => (cur === 'USD' ? 'US$' : '$') + Math.round(n).toLocaleString('es-MX')

interface QuoteItem {
  id?: string
  catalog_product_id: string | null
  name: string
  marca: string | null
  modelo: string | null
  sku: string | null
  quantity: number
  unit_cost: number | null
  markup: number | null
  unit_price: number
}
interface CatProd { id: string; name: string; marca: string | null; modelo: string | null; sku: string | null; cost: number | null; markup: number | null; precio_venta: number | null; moneda: string | null }

// ── EDITOR ──────────────────────────────────────────────────────────────────
export function QuoteEditorModal({ quoteId, prefill, properties, onClose, onSaved }: {
  quoteId?: string
  prefill?: { property_id?: string; upsell_id?: string; title?: string }
  properties: PropOpt[]
  onClose: () => void
  onSaved: () => void
}) {
  const [loading, setLoading] = useState(!!quoteId)
  const [propertyId, setPropertyId] = useState(prefill?.property_id || '')
  const [upsellId, setUpsellId] = useState<string | null>(prefill?.upsell_id || null)
  const [folio, setFolio] = useState<number | null>(null)
  const [title, setTitle] = useState(prefill?.title ? `Cotización: ${prefill.title}` : 'Cotización de mantenimiento')
  const [currency, setCurrency] = useState('MXN')
  const [status, setStatus] = useState('borrador')
  const [validUntil, setValidUntil] = useState('')
  const [followUpAt, setFollowUpAt] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<QuoteItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // catalog search
  const [catQ, setCatQ] = useState('')
  const [catRes, setCatRes] = useState<CatProd[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!quoteId) return
    (async () => {
      const { data: q } = await supabase.from('maintenance_quotes').select('*').eq('id', quoteId).maybeSingle()
      if (q) {
        setPropertyId(q.property_id); setUpsellId(q.upsell_id); setFolio(q.folio); setTitle(q.title)
        setCurrency(q.currency); setStatus(q.status); setValidUntil(q.valid_until || ''); setFollowUpAt(q.follow_up_at || ''); setNotes(q.notes || '')
      }
      const { data: its } = await supabase.from('maintenance_quote_items').select('*').eq('quote_id', quoteId).order('order_index')
      setItems((its || []).map((i: any) => ({ id: i.id, catalog_product_id: i.catalog_product_id, name: i.name, marca: i.marca, modelo: i.modelo, sku: i.sku, quantity: Number(i.quantity), unit_cost: i.unit_cost, markup: i.markup, unit_price: Number(i.unit_price) })))
      setLoading(false)
    })()
  }, [quoteId])

  useEffect(() => {
    if (!catQ.trim()) { setCatRes([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase.from('catalog_products')
        .select('id, name, marca, modelo, sku, cost, markup, precio_venta, moneda')
        .eq('is_active', true)
        .or(`name.ilike.%${catQ}%,marca.ilike.%${catQ}%,modelo.ilike.%${catQ}%,sku.ilike.%${catQ}%`)
        .limit(15)
      setCatRes((data as CatProd[]) || [])
      setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [catQ])

  function addFromCatalog(p: CatProd) {
    const price = p.precio_venta && p.precio_venta > 0 ? Number(p.precio_venta) : Math.round((Number(p.cost) || 0) * (1 + (Number(p.markup) || 0)))
    setItems(its => [...its, {
      catalog_product_id: p.id, name: p.name, marca: p.marca, modelo: p.modelo, sku: p.sku,
      quantity: 1, unit_cost: p.cost, markup: p.markup, unit_price: price,
    }])
    setCatQ(''); setCatRes([])
  }
  function addBlank() {
    setItems(its => [...its, { catalog_product_id: null, name: '', marca: null, modelo: null, sku: null, quantity: 1, unit_cost: null, markup: null, unit_price: 0 }])
  }
  function updItem(i: number, patch: Partial<QuoteItem>) { setItems(its => its.map((it, idx) => idx === i ? { ...it, ...patch } : it)) }
  function rmItem(i: number) { setItems(its => its.filter((_, idx) => idx !== i)) }

  const subtotal = useMemo(() => items.reduce((s, it) => s + (it.unit_price || 0) * (it.quantity || 0), 0), [items])
  const iva = subtotal * 0.16
  const total = subtotal + iva
  const prop = properties.find(p => p.id === propertyId)

  async function save() {
    if (!propertyId) { setError('Selecciona la propiedad'); return }
    if (items.length === 0) { setError('Agrega al menos un concepto'); return }
    setSaving(true); setError('')
    const now = new Date().toISOString()
    const payload: any = {
      property_id: propertyId, upsell_id: upsellId, title, currency, status,
      subtotal, iva, total, valid_until: validUntil || null, follow_up_at: followUpAt || null, notes: notes || null,
      updated_at: now,
    }
    if (status === 'enviada') payload.sent_at = now
    if (status === 'aceptada') payload.accepted_at = now
    if (status === 'rechazada') payload.rejected_at = now

    let qid = quoteId
    if (qid) {
      const { error: e } = await supabase.from('maintenance_quotes').update(payload).eq('id', qid)
      if (e) { setSaving(false); setError(e.message); return }
      await supabase.from('maintenance_quote_items').delete().eq('quote_id', qid)
    } else {
      const { data, error: e } = await supabase.from('maintenance_quotes').insert(payload).select('id').single()
      if (e || !data) { setSaving(false); setError(e?.message || 'Error'); return }
      qid = data.id
    }
    const rows = items.map((it, idx) => ({
      quote_id: qid, catalog_product_id: it.catalog_product_id, name: it.name || 'Concepto',
      marca: it.marca, modelo: it.modelo, sku: it.sku, quantity: it.quantity,
      unit_cost: it.unit_cost, markup: it.markup, unit_price: it.unit_price,
      total: (it.unit_price || 0) * (it.quantity || 0), order_index: idx,
    }))
    await supabase.from('maintenance_quote_items').insert(rows)

    // Si se acepta y viene de una oportunidad, marcarla como convertida
    if (status === 'aceptada' && upsellId) {
      await supabase.from('maintenance_upsell').update({ status: 'convertida', quotation_id: qid, updated_at: now }).eq('id', upsellId)
    }
    setSaving(false)
    onSaved()
  }

  async function remove() {
    if (!quoteId || !confirm('¿Eliminar esta cotización?')) return
    await supabase.from('maintenance_quotes').delete().eq('id', quoteId)
    onSaved()
  }

  function pdf() {
    const w = window.open('', '_blank')
    if (w) { w.document.write(buildQuoteHtml({ prop, folio, title, currency, items, subtotal, iva, total, validUntil, notes })); w.document.close() }
  }

  if (loading) return <div style={overlay}><div style={panel}><Loading /></div></div>

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={hdr}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{quoteId ? `Cotización #${folio}` : 'Nueva cotización'}</div>
          <button onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={grid2}>
            <L t="Propiedad *"><select value={propertyId} onChange={e => setPropertyId(e.target.value)} style={inp}>
              <option value="">Selecciona...</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}{p.client_name ? ` — ${p.client_name}` : ''}</option>)}
            </select></L>
            <L t="Título"><input value={title} onChange={e => setTitle(e.target.value)} style={inp} /></L>
          </div>

          {/* Buscar en catálogo */}
          <div>
            <div style={lblTxt}>Agregar del catálogo</div>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#555' }} />
              <input value={catQ} onChange={e => setCatQ(e.target.value)} placeholder="Buscar producto, marca, modelo, SKU..." style={{ ...inp, paddingLeft: 30 }} />
              {(catRes.length > 0 || searching) && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: 8, marginTop: 4, maxHeight: 240, overflowY: 'auto' }}>
                  {searching && <div style={{ padding: 10, fontSize: 12, color: '#666' }}>Buscando...</div>}
                  {catRes.map(p => (
                    <button key={p.id} onClick={() => addFromCatalog(p)} style={catRow}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[p.marca, p.modelo].filter(Boolean).join(' ') || p.name}</div>
                        <div style={{ fontSize: 10, color: '#666' }}>{p.name}{p.sku ? ` · ${p.sku}` : ''}</div>
                      </div>
                      <div style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>{money(p.precio_venta && p.precio_venta > 0 ? p.precio_venta : (Number(p.cost) || 0) * (1 + (Number(p.markup) || 0)))}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={addBlank} style={{ marginTop: 8, ...miniBtn }}><Plus size={12} /> Concepto manual</button>
          </div>

          {/* Items */}
          {items.length > 0 && (
            <div style={{ border: '1px solid #222', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 90px 28px', gap: 6, padding: '8px 10px', background: '#1a1a1a', fontSize: 10, color: '#888', textTransform: 'uppercase' }}>
                <span>Concepto</span><span style={{ textAlign: 'center' }}>Cant</span><span style={{ textAlign: 'right' }}>P. unit</span><span style={{ textAlign: 'right' }}>Total</span><span />
              </div>
              {items.map((it, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 90px 28px', gap: 6, padding: '8px 10px', alignItems: 'center', borderTop: '1px solid #1a1a1a' }}>
                  <input value={it.name} onChange={e => updItem(i, { name: e.target.value })} placeholder="Nombre del concepto"
                    style={{ ...cellInp, textAlign: 'left' }} />
                  <input value={it.quantity} onChange={e => updItem(i, { quantity: parseFloat(e.target.value) || 0 })} type="number" style={{ ...cellInp, textAlign: 'center' }} />
                  <input value={it.unit_price} onChange={e => updItem(i, { unit_price: parseFloat(e.target.value) || 0 })} type="number" style={{ ...cellInp, textAlign: 'right' }} />
                  <div style={{ fontSize: 12, color: '#fff', textAlign: 'right', fontWeight: 600 }}>{money((it.unit_price || 0) * (it.quantity || 0), currency)}</div>
                  <button onClick={() => rmItem(i)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={13} /></button>
                </div>
              ))}
              <div style={{ padding: '10px', borderTop: '1px solid #222', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end', fontSize: 13 }}>
                <div style={{ color: '#888' }}>Subtotal: <b style={{ color: '#ccc' }}>{money(subtotal, currency)}</b></div>
                <div style={{ color: '#888' }}>IVA 16%: <b style={{ color: '#ccc' }}>{money(iva, currency)}</b></div>
                <div style={{ color: '#fff', fontSize: 15 }}>Total: <b style={{ color: '#10B981' }}>{money(total, currency)}</b></div>
              </div>
            </div>
          )}

          {/* Seguimiento */}
          <div style={grid4}>
            <L t="Moneda"><select value={currency} onChange={e => setCurrency(e.target.value)} style={inp}><option>MXN</option><option>USD</option></select></L>
            <L t="Estado"><select value={status} onChange={e => setStatus(e.target.value)} style={inp}>
              {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select></L>
            <L t="Vigencia hasta"><input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} style={inp} /></L>
            <L t="Próximo seguimiento"><input type="date" value={followUpAt} onChange={e => setFollowUpAt(e.target.value)} style={inp} /></L>
          </div>
          <L t="Notas"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} placeholder="Condiciones, alcance, exclusiones..." /></L>

          {error && <div style={{ color: '#fca5a5', fontSize: 13 }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '14px 20px', borderTop: '1px solid #222', position: 'sticky', bottom: 0, background: '#0d0d0d' }}>
          <div>{quoteId && <button onClick={remove} style={{ ...btnGhost, color: '#fca5a5', borderColor: '#5a2a2a' }}><Trash2 size={14} /> Eliminar</button>}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={pdf} style={btnGhost}><FileText size={14} /> PDF</button>
            <button onClick={save} disabled={saving} style={btnPrimary}>{saving ? <Loader2 size={14} className="spin" /> : <CheckCircle size={14} />} Guardar</button>
          </div>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
      </div>
    </div>
  )
}

// ── TAB ─────────────────────────────────────────────────────────────────────
interface QuoteRow { id: string; property_id: string; folio: number; title: string; status: string; currency: string; total: number; valid_until: string | null; follow_up_at: string | null; updated_at: string; upsell_id: string | null; visit_id: string | null }

export function TabCotizaciones({ properties, isMobile }: { properties: PropOpt[]; isMobile: boolean }) {
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ quoteId?: string } | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [precioSuelta, setPrecioSuelta] = useState('')
  const [savedPrecio, setSavedPrecio] = useState(true)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('maintenance_quotes').select('id, property_id, folio, title, status, currency, total, valid_until, follow_up_at, updated_at, upsell_id, visit_id').order('updated_at', { ascending: false })
    setQuotes((data as QuoteRow[]) || [])
    const { data: s } = await supabase.from('maintenance_settings').select('value').eq('key', 'precio_visita_suelta').maybeSingle()
    setPrecioSuelta(s?.value != null ? String(s.value) : '3000')
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function savePrecio() {
    const v = parseFloat(precioSuelta) || 0
    await supabase.from('maintenance_settings').upsert({ key: 'precio_visita_suelta', value: v, updated_at: new Date().toISOString() })
    setSavedPrecio(true)
  }

  const propMap = useMemo(() => { const m: Record<string, PropOpt> = {}; properties.forEach(p => m[p.id] = p); return m }, [properties])
  const today = new Date().toISOString().slice(0, 10)
  const filtered = statusFilter ? quotes.filter(q => q.status === statusFilter) : quotes

  const abiertas = quotes.filter(q => q.status === 'borrador' || q.status === 'enviada')
  const pipMXN = abiertas.filter(q => q.currency !== 'USD').reduce((s, q) => s + Number(q.total || 0), 0)
  const ganadasMes = quotes.filter(q => q.status === 'aceptada' && (q.updated_at || '').slice(0, 7) === today.slice(0, 7))
  const ganadasVal = ganadasMes.reduce((s, q) => s + Number(q.total || 0), 0)
  const seguimientos = quotes.filter(q => (q.status === 'borrador' || q.status === 'enviada') && ((q.follow_up_at && q.follow_up_at <= today) || (q.valid_until && q.valid_until < today)))

  if (loading) return <Loading />

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Cotizaciones abiertas" value={String(abiertas.length)} icon={<FileText size={16} />} />
        <KpiCard label="Pipeline MXN" value={money(pipMXN)} color="#2563EB" icon={<DollarSign size={16} />} />
        <KpiCard label="Ganadas (mes)" value={money(ganadasVal)} color="#10B981" icon={<CheckCircle size={16} />} />
        <KpiCard label="Seguimientos hoy" value={String(seguimientos.length)} color={seguimientos.length ? '#D97706' : '#6B7280'} icon={<Clock size={16} />} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '10px 12px', background: '#0f1a14', border: '1px solid #1f3a2a', borderRadius: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>Auto · Visita suelta</span>
        <span style={{ fontSize: 11, color: '#888' }}>Las visitas sin póliza generan una cotización automática a este precio:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#888' }}>$</span>
          <input value={precioSuelta} onChange={e => { setPrecioSuelta(e.target.value); setSavedPrecio(false) }} type="number"
            style={{ ...inp, width: 100, padding: '6px 8px' }} />
          <span style={{ fontSize: 11, color: '#666' }}>MXN + IVA</span>
          {!savedPrecio && <button onClick={savePrecio} style={{ ...miniBtn, marginLeft: 4 }}>Guardar</button>}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inp, maxWidth: 180 }}>
          <option value="">Todos los estados</option>
          {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <Btn variant="primary" onClick={() => setEditing({})}><Plus size={14} /> Nueva cotización</Btn>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No hay cotizaciones. Créalas aquí o desde una oportunidad detectada en sitio." />
      ) : (
        <Table>
          <thead><tr>
            <Th>Folio</Th><Th>Propiedad</Th><Th>Concepto</Th><Th>Total</Th>{!isMobile && <Th>Seguimiento</Th>}<Th>Estado</Th>
          </tr></thead>
          <tbody>
            {filtered.map(q => {
              const cfg = QUOTE_STATUS[q.status] || QUOTE_STATUS.borrador
              const needsFollow = (q.status === 'borrador' || q.status === 'enviada') && ((q.follow_up_at && q.follow_up_at <= today) || (q.valid_until && q.valid_until < today))
              return (
                <tr key={q.id} onClick={() => setEditing({ quoteId: q.id })} style={{ cursor: 'pointer', background: needsFollow ? '#D9770608' : 'transparent' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
                  onMouseLeave={e => e.currentTarget.style.background = needsFollow ? '#D9770608' : 'transparent'}>
                  <Td>#{q.folio}
                    {q.upsell_id && <span title="Desde oportunidad" style={{ color: '#a78bfa' }}> ★</span>}
                    {q.visit_id && <span title="Visita suelta automática" style={{ fontSize: 9, color: '#06b6d4', border: '1px solid #06b6d433', borderRadius: 6, padding: '1px 5px', marginLeft: 6 }}>Suelta</span>}
                  </Td>
                  <Td>{propMap[q.property_id]?.name || '--'}</Td>
                  <Td muted>{q.title}</Td>
                  <Td>{money(Number(q.total || 0), q.currency)}</Td>
                  {!isMobile && <Td muted>{q.follow_up_at ? formatDate(q.follow_up_at) : q.valid_until ? `vence ${formatDate(q.valid_until)}` : '--'}{needsFollow && <AlertTriangle size={12} color="#D97706" style={{ marginLeft: 4, verticalAlign: -1 }} />}</Td>}
                  <Td><Badge label={cfg.label} color={cfg.color} /></Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {editing && (
        <QuoteEditorModal quoteId={editing.quoteId} properties={properties} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
    </>
  )
}

// ── PDF ─────────────────────────────────────────────────────────────────────
function buildQuoteHtml(d: any): string {
  const { prop, folio, title, currency, items, subtotal, iva, total, validUntil, notes } = d
  const m = (n: number) => (currency === 'USD' ? 'US$' : '$') + Math.round(n).toLocaleString('es-MX')
  const hoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
  const rows = items.map((it: QuoteItem) => `<tr><td class="l">${[it.marca, it.modelo].filter(Boolean).join(' ') || it.name}${it.sku ? `<br/><span class="sku">${it.sku}</span>` : ''}</td><td>${it.quantity}</td><td class="r">${m(it.unit_price)}</td><td class="r">${m((it.unit_price || 0) * (it.quantity || 0))}</td></tr>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cotización #${folio || ''}</title>
  <style>*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:32px;font-size:12px}
  h1{font-size:18px;border-bottom:3px solid #10B981;padding-bottom:10px}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 24px;margin:14px 0}.meta b{color:#555}
  table{width:100%;border-collapse:collapse;margin:14px 0}th,td{border:1px solid #ccc;padding:7px 9px;text-align:center}
  th{background:#10B981;color:#fff}td.l{text-align:left}td.r{text-align:right}.sku{color:#888;font-size:10px}
  .totals{width:50%;margin-left:auto}.totals td{text-align:right}.totals td.k{text-align:left;font-weight:600;background:#f5f5f5}
  .notes{margin-top:14px;font-size:11px;color:#444;white-space:pre-line}@media print{button{display:none}}</style></head><body>
  <button onclick="window.print()" style="float:right;padding:8px 14px;background:#10B981;color:#fff;border:none;border-radius:6px;cursor:pointer">Imprimir / PDF</button>
  <h1>COTIZACIÓN DE MANTENIMIENTO ${folio ? '#' + folio : ''}</h1>
  <div class="meta">
    <div><b>PROYECTO:</b> ${prop?.name || '—'}</div><div><b>FECHA:</b> ${hoy}</div>
    <div><b>CLIENTE:</b> ${prop?.client_name || '—'}</div><div><b>DIRECCIÓN:</b> ${prop?.address || '—'}${prop?.city ? ', ' + prop.city : ''}</div>
    <div><b>CONCEPTO:</b> ${title || '—'}</div><div><b>VIGENCIA:</b> ${validUntil ? new Date(validUntil + 'T12:00:00').toLocaleDateString('es-MX') : '—'}</div>
  </div>
  <table><thead><tr><th class="l">Concepto</th><th>Cant</th><th>P. unitario</th><th>Importe</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="totals"><tr><td class="k">Subtotal</td><td>${m(subtotal)}</td></tr><tr><td class="k">IVA 16%</td><td>${m(iva)}</td></tr><tr><td class="k">TOTAL</td><td><b>${m(total)}</b></td></tr></table>
  ${notes ? `<div class="notes"><b>Notas:</b>\n${notes}</div>` : ''}
  <div class="notes" style="margin-top:24px;color:#888">OMM Technologies S.A. de C.V. · Cotización sujeta a disponibilidad. Precios en ${currency}.</div>
  </body></html>`
}

// ── estilos ──
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }
const panel: React.CSSProperties = { background: '#0d0d0d', border: '1px solid #222', borderRadius: 16, width: '100%', maxWidth: 760, marginTop: 20, marginBottom: 40 }
const hdr: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #222', position: 'sticky', top: 0, background: '#0d0d0d', zIndex: 2 }
const iconBtn: React.CSSProperties = { background: 'transparent', border: '1px solid #222', borderRadius: 8, padding: 8, cursor: 'pointer', color: '#888' }
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }
const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', background: '#141414', border: '1px solid #222', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }
const cellInp: React.CSSProperties = { width: '100%', padding: '6px 8px', background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box' }
const lblTxt: React.CSSProperties = { fontSize: 11, color: '#888', marginBottom: 4 }
const catRow: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'none', border: 'none', borderBottom: '1px solid #1a1a1a', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }
const miniBtn: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '6px 10px', color: '#10B981', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }
const btnGhost: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 10, color: '#ccc', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const btnPrimary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: '#10B981', border: 'none', borderRadius: 10, color: '#0a0a0a', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }

function L({ t, children }: { t: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#888' }}>{t}{children}</label>
}
