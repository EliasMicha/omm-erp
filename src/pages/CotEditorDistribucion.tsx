import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { F, FUSD } from '../lib/utils'
import { ChevronLeft, Plus, Trash2, Printer } from 'lucide-react'
import VersionManager from '../components/VersionManager'
import { useIsMobile } from '../lib/useIsMobile'

// ─────────────────────────────────────────────────────────────────────────────
// Cotizador de DISTRIBUCIÓN — muy simple.
// Reventa de equipo (Lutron u otras marcas) a integradores. Se captura costo
// (lo que nos cuesta con descuento) y precio (lo que le cobramos al integrador).
// La utilidad se ve solo internamente; el cliente ve precio y total.
// ─────────────────────────────────────────────────────────────────────────────
interface DistItem { id: string; name: string; marca: string; modelo: string; cantidad: number; costo: number; precio: number }
interface DistConfig { currency: 'MXN' | 'USD'; ivaRate: number }

const uid = () => Math.random().toString(36).slice(2, 10)
const r2 = (n: number) => Math.round(n * 100) / 100

export default function CotEditorDistribucion({ cotId, onBack, onSwitchVersion }: {
  cotId: string; onBack: () => void; onSwitchVersion?: (id: string) => void
}) {
  const isMobile = useIsMobile()
  const [loading, setLoading] = useState(true)
  const [cotName, setCotName] = useState('')
  const [clientName, setClientName] = useState('')
  const [items, setItems] = useState<DistItem[]>([])
  const [config, setConfig] = useState<DistConfig>({ currency: 'MXN', ivaRate: 16 })
  const notesRef = useRef<any>({})
  const saveTimer = useRef<any>(null)

  useEffect(() => {
    (async () => {
      const { data: cot } = await supabase.from('quotations').select('*').eq('id', cotId).single()
      if (cot) {
        setCotName(cot.name || '')
        let meta: any = {}
        try { meta = typeof cot.notes === 'string' ? JSON.parse(cot.notes) : (cot.notes || {}) } catch {}
        notesRef.current = meta
        if (meta.distConfig) setConfig(c => ({ ...c, ...meta.distConfig }))
        if (meta.currency) setConfig(c => ({ ...c, currency: meta.currency }))
        setClientName(meta.client_name || meta.lead_name || cot.client_name || '')
      }
      const { data: its } = await supabase.from('quotation_items').select('*').eq('quotation_id', cotId).order('order_index')
      setItems((its || []).map((i: any) => ({
        id: i.id, name: i.name || '', marca: i.marca || '', modelo: i.modelo || '',
        cantidad: Number(i.quantity) || 1, costo: Number(i.cost) || 0, precio: Number(i.price) || 0,
      })))
      setLoading(false)
    })()
  }, [cotId])

  const F2 = (n: number) => config.currency === 'USD' ? FUSD(n) : F(n)
  const subtotal = r2(items.reduce((s, i) => s + i.precio * i.cantidad, 0))
  const iva = r2(subtotal * config.ivaRate / 100)
  const total = r2(subtotal + iva)
  const utilidad = r2(items.reduce((s, i) => s + (i.precio - i.costo) * i.cantidad, 0))
  const margenPct = subtotal > 0 ? Math.round((utilidad / subtotal) * 100) : 0

  // Autoguardado (debounce)
  useEffect(() => {
    if (loading) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 800)
    return () => clearTimeout(saveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, config])

  async function save() {
    await supabase.from('quotation_items').delete().eq('quotation_id', cotId)
    const rows = items.filter(i => i.name.trim()).map((i, idx) => ({
      quotation_id: cotId, name: i.name.trim(), marca: i.marca || null, modelo: i.modelo || null,
      quantity: i.cantidad, cost: i.costo, price: i.precio, total: r2(i.precio * i.cantidad), order_index: idx,
    }))
    if (rows.length) await supabase.from('quotation_items').insert(rows)
    const merged = { ...notesRef.current, distConfig: config, currency: config.currency }
    notesRef.current = merged
    await supabase.from('quotations').update({ notes: JSON.stringify(merged), total, total_final: total }).eq('id', cotId)
  }

  function addRow() { setItems(x => [...x, { id: uid(), name: '', marca: '', modelo: '', cantidad: 1, costo: 0, precio: 0 }]) }
  function upd(id: string, patch: Partial<DistItem>) { setItems(x => x.map(i => i.id === id ? { ...i, ...patch } : i)) }
  function rm(id: string) { setItems(x => x.filter(i => i.id !== id)) }

  function exportPdf() {
    const cur = config.currency
    const fmt = (n: number) => (cur === 'USD' ? 'US$' : '$') + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const rows = items.filter(i => i.name.trim()).map(i => `
      <tr>
        <td>${esc(i.name)}${i.modelo ? `<div style="font-size:9px;color:#888">${esc(i.modelo)}</div>` : ''}</td>
        <td>${esc(i.marca)}</td>
        <td style="text-align:center">${i.cantidad}</td>
        <td style="text-align:right">${fmt(i.precio)}</td>
        <td style="text-align:right;font-weight:600">${fmt(i.precio * i.cantidad)}</td>
      </tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(cotName)}</title>
      <style>*{font-family:Arial,sans-serif}body{margin:28px;color:#111}h1{font-size:20px;margin:0}
      .sub{color:#666;font-size:12px;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:12px}
      th{background:#f2f2f2;text-align:left;padding:6px 8px;border-bottom:2px solid #ccc}td{padding:6px 8px;border-bottom:1px solid #eee}
      .tot{margin-top:14px;margin-left:auto;width:280px;font-size:13px}.tot div{display:flex;justify-content:space-between;padding:3px 0}
      .grand{border-top:2px solid #000;font-weight:700;font-size:15px;padding-top:6px}</style></head><body>
      <h1>Cotización de Distribución</h1>
      <div class="sub">OMM Technologies SA de CV${clientName ? ' · Cliente: ' + esc(clientName) : ''} · ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })} · Moneda: ${cur}</div>
      <table><thead><tr><th>Producto</th><th>Marca</th><th style="text-align:center">Cant.</th><th style="text-align:right">P. Unit.</th><th style="text-align:right">Importe</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot">
        <div><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
        <div><span>IVA (${config.ivaRate}%)</span><span>${fmt(iva)}</span></div>
        <div class="grand"><span>Total</span><span>${fmt(total)} ${cur}</span></div>
      </div>
      <div style="margin-top:24px;font-size:10px;color:#888">Precios sujetos a disponibilidad. Vigencia 15 días.</div>
      <script>window.onload=()=>window.print()</script></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }
  const esc = (s: string) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])

  const inp: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, color: '#fff', fontSize: 12, padding: '5px 7px', fontFamily: 'inherit', width: '100%' }
  const th: React.CSSProperties = { fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 6px', textAlign: 'left' }

  if (loading) return <div style={{ padding: 40, color: '#666' }}>Cargando…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isMobile ? '10px 12px' : '12px 18px', borderBottom: '1px solid #1e1e1e', flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex' }}><ChevronLeft size={20} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cotName || 'Cotización de distribución'}</div>
          <div style={{ fontSize: 11, color: '#F59E0B' }}>⇄ Distribución{clientName ? ' · ' + clientName : ''}</div>
        </div>
        <button onClick={() => setConfig(c => ({ ...c, currency: c.currency === 'USD' ? 'MXN' : 'USD' }))}
          title="Cambiar moneda"
          style={{ fontSize: 11, fontWeight: 700, color: config.currency === 'USD' ? '#06B6D4' : '#F59E0B', background: config.currency === 'USD' ? '#06B6D422' : '#F59E0B22', border: '1px solid ' + (config.currency === 'USD' ? '#06B6D455' : '#F59E0B55'), borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
          {config.currency} ⇄
        </button>
        <label style={{ fontSize: 10, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}>IVA%
          <input type="number" value={config.ivaRate} onChange={e => setConfig(c => ({ ...c, ivaRate: parseFloat(e.target.value) || 0 }))}
            style={{ ...inp, width: 52, padding: '3px 6px', textAlign: 'right' }} />
        </label>
        <button onClick={exportPdf} style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #67E8F9', background: '#67E8F922', color: '#67E8F9', display: 'flex', alignItems: 'center', gap: 4 }}><Printer size={12} /> PDF</button>
        <VersionManager cotId={cotId} getCurrentSnapshot={() => JSON.stringify({ items, config })} onSwitchVersion={onSwitchVersion || (() => {})} accentColor="#F59E0B" compact={isMobile} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '10px 8px' : '16px 20px' }}>
        <div style={{ border: '1px solid #1f1f1f', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1.4fr 0.8fr 44px 80px 80px 90px 28px' : '1.6fr 1fr 0.8fr 56px 100px 100px 110px 30px', gap: 4, padding: '7px 10px', background: '#161616' }}>
            <span style={th}>Producto</span>
            <span style={th}>Marca</span>
            {!isMobile && <span style={th}>Modelo</span>}
            <span style={{ ...th, textAlign: 'center' }}>Cant</span>
            <span style={{ ...th, textAlign: 'right' }}>Costo u.</span>
            <span style={{ ...th, textAlign: 'right' }}>Precio u.</span>
            <span style={{ ...th, textAlign: 'right' }}>Importe</span>
            <span />
          </div>
          {items.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: '#555', fontSize: 12 }}>Agrega productos para revender.</div>}
          {items.map(it => {
            const imp = it.precio * it.cantidad
            const mg = it.precio > 0 ? Math.round(((it.precio - it.costo) / it.precio) * 100) : 0
            return (
              <div key={it.id} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1.4fr 0.8fr 44px 80px 80px 90px 28px' : '1.6fr 1fr 0.8fr 56px 100px 100px 110px 30px', gap: 4, padding: '6px 10px', alignItems: 'center', borderTop: '1px solid #161616' }}>
                <input value={it.name} onChange={e => upd(it.id, { name: e.target.value })} placeholder="Producto / descripción" style={inp} />
                <input value={it.marca} onChange={e => upd(it.id, { marca: e.target.value })} placeholder="Marca" style={inp} />
                {!isMobile && <input value={it.modelo} onChange={e => upd(it.id, { modelo: e.target.value })} placeholder="Modelo" style={inp} />}
                <input type="number" value={it.cantidad} onChange={e => upd(it.id, { cantidad: parseFloat(e.target.value) || 0 })} style={{ ...inp, textAlign: 'center' }} />
                <input type="number" value={it.costo} onChange={e => upd(it.id, { costo: parseFloat(e.target.value) || 0 })} style={{ ...inp, textAlign: 'right' }} />
                <input type="number" value={it.precio} onChange={e => upd(it.id, { precio: parseFloat(e.target.value) || 0 })} style={{ ...inp, textAlign: 'right', borderColor: '#F59E0B44' }} />
                <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#fff' }}>
                  {F2(imp)}
                  <div style={{ fontSize: 8, color: mg >= 0 ? '#10B981' : '#DC2626' }}>margen {mg}%</div>
                </div>
                <button onClick={() => rm(it.id)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0 }}><Trash2 size={13} /></button>
              </div>
            )
          })}
          <div style={{ padding: 8 }}>
            <button onClick={addRow} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, color: '#F59E0B', fontSize: 11, fontWeight: 600, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={12} /> Producto</button>
          </div>
        </div>

        {/* Totales */}
        <div style={{ marginTop: 16, marginLeft: 'auto', maxWidth: 340, background: '#0e0e0e', border: '1px solid #1f1f1f', borderRadius: 10, padding: 14 }}>
          <Row label="Subtotal" value={F2(subtotal)} />
          <Row label={`IVA (${config.ivaRate}%)`} value={F2(iva)} />
          <div style={{ borderTop: '1px solid #2a2a2a', margin: '6px 0' }} />
          <Row label="Total" value={`${F2(total)} ${config.currency}`} big />
          <div style={{ borderTop: '1px dashed #2a2a2a', margin: '8px 0 6px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#666' }}>
            <span>Utilidad estimada (interno)</span>
            <span style={{ color: utilidad >= 0 ? '#10B981' : '#DC2626', fontWeight: 600 }}>{F2(utilidad)} · {margenPct}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
      <span style={{ fontSize: big ? 13 : 12, color: big ? '#fff' : '#888', fontWeight: big ? 700 : 400 }}>{label}</span>
      <span style={{ fontSize: big ? 16 : 12, color: big ? '#F59E0B' : '#ccc', fontWeight: big ? 800 : 500 }}>{value}</span>
    </div>
  )
}
