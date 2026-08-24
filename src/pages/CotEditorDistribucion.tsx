import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { F, FUSD } from '../lib/utils'
import { ChevronLeft, Plus, Trash2, Printer, Upload, Search, Loader2, Sparkles } from 'lucide-react'
import VersionManager from '../components/VersionManager'
import { useIsMobile } from '../lib/useIsMobile'
import { fetchAllActiveCatalog } from '../lib/catalog'
import CotizarConIA, { PartidaLista } from '../components/CotizarConIA'

// ─────────────────────────────────────────────────────────────────────────────
// Cotizador de DISTRIBUCIÓN — reventa de equipo (Lutron u otras marcas).
// El cliente ve PRECIO PÚBLICO por partida y un DESCUENTO global al final, más
// FLETES y FACTOR DE IMPORTACIÓN después del subtotal. Internamente se guarda el
// COSTO (lo que nos cuesta) para ver la utilidad. Se puede importar la orden en
// PDF (formato Lutron u otro) y traer productos del catálogo.
// ─────────────────────────────────────────────────────────────────────────────
interface DistItem { id: string; name: string; marca: string; modelo: string; cantidad: number; costo: number; precioPublico: number }
interface DistConfig { currency: 'MXN' | 'USD'; ivaRate: number; descuentoPct: number; fletes: number; factorImport: number; tipoCambio: number }

const uid = () => Math.random().toString(36).slice(2, 10)
const r2 = (n: number) => Math.round(n * 100) / 100
const fileToBase64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file)
})

export default function CotEditorDistribucion({ cotId, onBack, onSwitchVersion }: {
  cotId: string; onBack: () => void; onSwitchVersion?: (id: string) => void
}) {
  const isMobile = useIsMobile()
  const [loading, setLoading] = useState(true)
  const [cotName, setCotName] = useState('')
  const [clientName, setClientName] = useState('')
  const [items, setItems] = useState<DistItem[]>([])
  const [config, setConfig] = useState<DistConfig>({ currency: 'MXN', ivaRate: 16, descuentoPct: 0, fletes: 0, factorImport: 0, tipoCambio: 18 })
  const notesRef = useRef<any>({})
  const saveTimer = useRef<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [catalog, setCatalog] = useState<any[]>([])
  const [catQuery, setCatQuery] = useState('')
  const [showCat, setShowCat] = useState(false)
  const [showIA, setShowIA] = useState(false)

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
        cantidad: Number(i.quantity) || 1, costo: Number(i.cost) || 0, precioPublico: Number(i.price) || 0,
      })))
      setLoading(false)
    })()
  }, [cotId])

  // Catálogo (para traer productos con su precio público / costo)
  useEffect(() => { fetchAllActiveCatalog().then(setCatalog).catch(() => {}) }, [])

  const F2 = (n: number) => config.currency === 'USD' ? FUSD(n) : F(n)
  const subtotalPublico = r2(items.reduce((s, i) => s + i.precioPublico * i.cantidad, 0))
  const descuentoAmt = r2(subtotalPublico * (config.descuentoPct || 0) / 100)
  const subtotalConDesc = r2(subtotalPublico - descuentoAmt)
  const factorImportAmt = r2(subtotalConDesc * (config.factorImport || 0) / 100)  // factor = % sobre el subtotal con descuento
  const cargos = r2((config.fletes || 0) + factorImportAmt)
  const baseIva = r2(subtotalConDesc + cargos)
  const iva = r2(baseIva * config.ivaRate / 100)
  const total = r2(baseIva + iva)
  const costoTotal = r2(items.reduce((s, i) => s + i.costo * i.cantidad, 0))
  const utilidad = r2(subtotalConDesc - costoTotal)  // fletes/import son pass-through
  const margenPct = subtotalConDesc > 0 ? Math.round((utilidad / subtotalConDesc) * 100) : 0

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
      quantity: i.cantidad, cost: i.costo, price: i.precioPublico, total: r2(i.precioPublico * i.cantidad), order_index: idx,
    }))
    if (rows.length) await supabase.from('quotation_items').insert(rows)
    const merged = { ...notesRef.current, distConfig: config, currency: config.currency }
    notesRef.current = merged
    await supabase.from('quotations').update({ notes: JSON.stringify(merged), total, total_final: total }).eq('id', cotId)
  }

  function addRow() { setItems(x => [...x, { id: uid(), name: '', marca: '', modelo: '', cantidad: 1, costo: 0, precioPublico: 0 }]) }
  function upd(id: string, patch: Partial<DistItem>) { setItems(x => x.map(i => i.id === id ? { ...i, ...patch } : i)) }
  function rm(id: string) { setItems(x => x.filter(i => i.id !== id)) }

  // Convertir todos los montos a la otra moneda usando el TC PACTADO de esta cotización.
  // El TC queda guardado en la cotización (no cambia contra ninguna otra tabla del ERP):
  // así el deal se cierra a ese tipo de cambio fijo.
  function convertirMoneda() {
    const tc = Number(config.tipoCambio) || 0
    if (tc <= 0) { alert('Captura primero el tipo de cambio.'); return }
    const aMXN = config.currency === 'USD'         // USD → MXN (× TC) ; MXN → USD (÷ TC)
    const factor = aMXN ? tc : 1 / tc
    const destino = aMXN ? 'MXN' : 'USD'
    if (!confirm(`Convertir todos los montos de ${config.currency} a ${destino} al tipo de cambio ${tc}?\n\nEsto fija los precios en ${destino} y así se cierra el deal.`)) return
    setItems(x => x.map(i => ({ ...i, costo: r2(i.costo * factor), precioPublico: r2(i.precioPublico * factor) })))
    // fletes es monto (se convierte); factor de importación es % (no se convierte)
    setConfig(c => ({ ...c, currency: destino, fletes: r2((c.fletes || 0) * factor) }))
  }

  function addFromCatalog(p: any) {
    setItems(x => [...x, {
      id: uid(), name: p.name || '', marca: p.marca || p.provider || '', modelo: p.modelo || '',
      cantidad: 1, costo: Number(p.cost) || 0, precioPublico: Number(p.precio_venta) || Number(p.cost) || 0,
    }])
    setCatQuery(''); setShowCat(false)
  }

  const catMatches = catQuery.trim().length >= 2
    ? catalog.filter(p => {
        const q = catQuery.toLowerCase()
        return (p.name || '').toLowerCase().includes(q) || (p.marca || '').toLowerCase().includes(q) || (p.modelo || '').toLowerCase().includes(q)
      }).slice(0, 25)
    : []

  // ── Importar orden (PDF Lutron u otro) con IA ──
  async function importarOrden(file: File) {
    setImporting(true)
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase()
      const jsonFormat = `{
  "moneda": "USD|MXN",
  "fletes": 0,               // Shipping and Handling (número, 0 si no hay)
  "factorImportacion": 0,    // Import Fee (número, 0 si no hay)
  "items": [
    { "name": "descripción del producto", "modelo": "modelo/part number ej. LQSE-4A1-D", "marca": "Lutron", "cantidad": 7, "costoUnitario": 509.20 }
  ]
}`
      const systemPrompt = 'Eres un parser de órdenes de distribución de equipo (Lutron u otras marcas). Devuelve SOLO un objeto JSON válido, sin texto adicional.'
      const promptTxt = `Extrae las partidas y los cargos de esta orden/propuesta de distribución.\n- Cada partida: descripción (name), modelo/part number (modelo), marca, cantidad (Qty) y costo unitario (Unit Cost).\n- fletes = Shipping and Handling. factorImportacion = Import Fee. moneda = divisa (USD/MXN).\n- NO incluyas renglones de IVA, Subtotal o Total como partidas.\n\nResponde con este formato exacto:\n${jsonFormat}`

      let content: any
      if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
        const b64 = await fileToBase64(file)
        content = [{ type: 'image', source: { type: 'base64', media_type: file.type, data: b64 } }, { type: 'text', text: promptTxt }]
      } else if (ext === 'pdf') {
        const b64 = await fileToBase64(file)
        content = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }, { type: 'text', text: promptTxt }]
      } else {
        const text = await file.text()
        content = [{ type: 'text', text: `${promptTxt}\n\nArchivo (${file.name}):\n${text.substring(0, 50000)}` }]
      }

      const res = await fetch('/api/anthropic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 16000, system: systemPrompt, messages: [{ role: 'user', content }] }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
      const txt = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      let cleaned = txt.replace(/```json|```/g, '').trim()
      const start = cleaned.indexOf('{')
      if (start === -1) throw new Error('No se encontró JSON en la respuesta')
      const parsed = JSON.parse(cleaned.slice(start, cleaned.lastIndexOf('}') + 1))

      const newItems: DistItem[] = (parsed.items || []).map((it: any) => {
        const costo = Number(it.costoUnitario) || 0
        return {
          id: uid(), name: String(it.name || '').trim(), marca: String(it.marca || '').trim(),
          modelo: String(it.modelo || '').trim(), cantidad: Number(it.cantidad) || 1,
          costo, precioPublico: costo,  // el público lo ajusta el usuario; se precarga con el costo
        }
      }).filter((i: DistItem) => i.name || i.modelo)

      if (newItems.length === 0) throw new Error('No se detectaron partidas en el documento')
      setItems(prev => [...prev, ...newItems])
      const cargosOrigen = (Number(parsed.fletes) || 0) + (Number(parsed.factorImportacion) || 0)
      setConfig(c => ({
        ...c,
        currency: (parsed.moneda === 'USD' || parsed.moneda === 'MXN') ? parsed.moneda : c.currency,
        fletes: cargosOrigen || c.fletes,   // Shipping + Import Fee de la orden (montos) → Fletes
      }))
      alert(`Importadas ${newItems.length} partidas.\nRevisa el precio público (se precargó con el costo), aplica el descuento y el factor de importación (%).`)
    } catch (e: any) {
      alert('No se pudo importar: ' + (e.message || e))
    } finally {
      setImporting(false)
    }
  }

  function exportPdf() {
    const cur = config.currency
    const fmt = (n: number) => (cur === 'USD' ? 'US$' : '$') + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const rows = items.filter(i => i.name.trim()).map(i => `
      <tr>
        <td>${esc(i.name)}${i.modelo ? `<div style="font-size:9px;color:#888">${esc(i.modelo)}</div>` : ''}</td>
        <td>${esc(i.marca)}</td>
        <td style="text-align:center">${i.cantidad}</td>
        <td style="text-align:right">${fmt(i.precioPublico)}</td>
        <td style="text-align:right;font-weight:600">${fmt(i.precioPublico * i.cantidad)}</td>
      </tr>`).join('')
    const totRows = [
      `<div><span>Subtotal (precio público)</span><span>${fmt(subtotalPublico)}</span></div>`,
      (config.descuentoPct || 0) > 0 ? `<div style="color:#c00"><span>Descuento (${config.descuentoPct}%)</span><span>-${fmt(descuentoAmt)}</span></div>` : '',
      (config.descuentoPct || 0) > 0 ? `<div><span>Subtotal con descuento</span><span>${fmt(subtotalConDesc)}</span></div>` : '',
      (config.fletes || 0) > 0 ? `<div><span>Fletes</span><span>${fmt(config.fletes)}</span></div>` : '',
      (config.factorImport || 0) > 0 ? `<div><span>Factor de importación (${config.factorImport}%)</span><span>${fmt(factorImportAmt)}</span></div>` : '',
      `<div><span>IVA (${config.ivaRate}%)</span><span>${fmt(iva)}</span></div>`,
      `<div class="grand"><span>Total</span><span>${fmt(total)} ${cur}</span></div>`,
    ].filter(Boolean).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(cotName)}</title>
      <style>*{font-family:Arial,sans-serif}body{margin:28px;color:#111}h1{font-size:20px;margin:0}
      .sub{color:#666;font-size:12px;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:12px}
      th{background:#f2f2f2;text-align:left;padding:6px 8px;border-bottom:2px solid #ccc}td{padding:6px 8px;border-bottom:1px solid #eee}
      .tot{margin-top:14px;margin-left:auto;width:320px;font-size:13px}.tot div{display:flex;justify-content:space-between;padding:3px 0}
      .grand{border-top:2px solid #000;font-weight:700;font-size:15px;padding-top:6px}</style></head><body>
      <h1>Cotización de Distribución</h1>
      <div class="sub">OMM Technologies SA de CV${clientName ? ' · Cliente: ' + esc(clientName) : ''} · ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })} · Moneda: ${cur}</div>
      <table><thead><tr><th>Producto</th><th>Marca</th><th style="text-align:center">Cant.</th><th style="text-align:right">Precio público U.</th><th style="text-align:right">Importe</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot">${totRows}</div>
      <div style="margin-top:24px;font-size:10px;color:#888">Precios sujetos a disponibilidad. Vigencia 15 días.</div>
      <script>window.onload=()=>window.print()</script></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }
  const esc = (s: string) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])

  const inp: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, color: '#fff', fontSize: 12, padding: '5px 7px', fontFamily: 'inherit', width: '100%' }
  const th: React.CSSProperties = { fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 6px', textAlign: 'left' }
  const cols = isMobile ? '1.4fr 0.8fr 44px 80px 80px 90px 28px' : '1.6fr 1fr 0.8fr 56px 100px 110px 110px 30px'

  if (loading) return <div style={{ padding: 40, color: '#666' }}>Cargando…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {showIA && (
        <CotizarConIA
          catalogo={catalog}
          moneda={config.currency}
          onCerrar={() => setShowIA(false)}
          onAgregar={(partidas: PartidaLista[]) => {
            setItems(prev => [...prev, ...partidas.map(p => ({
              id: uid(), name: p.name, marca: p.marca, modelo: p.modelo,
              cantidad: p.cantidad, costo: p.costo, precioPublico: p.precioPublico,
            }))])
          }}
          onCargos={c => setConfig(cfg => ({
            ...cfg,
            currency: c.moneda || cfg.currency,
            // Los fletes y el fee de importación que trae la orden son montos:
            // se SUMAN a lo que ya hubiera, no lo pisan (pueden venir de varias hojas).
            fletes: c.fletes ? r2((cfg.fletes || 0) + c.fletes) : cfg.fletes,
            descuentoPct: c.descuentoPct ?? cfg.descuentoPct,
          }))}
        />
      )}
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '10px 12px' : '12px 18px', borderBottom: '1px solid #1e1e1e', flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex' }}><ChevronLeft size={20} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cotName || 'Cotización de distribución'}</div>
          <div style={{ fontSize: 11, color: '#F59E0B' }}>⇄ Distribución{clientName ? ' · ' + clientName : ''}</div>
        </div>
        <button onClick={() => setShowIA(true)}
          title="Sube el PDF, las fotos o el Excel que te mandó el proveedor: la IA saca las partidas y las empareja con tu catálogo"
          style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #A78BFA', background: '#A78BFA22', color: '#A78BFA', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Sparkles size={12} /> Cotizar con IA
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={importing}
          style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: importing ? 'wait' : 'pointer', fontFamily: 'inherit', border: '1px solid #2a2a2a', background: 'transparent', color: '#777', display: 'flex', alignItems: 'center', gap: 4 }}>
          {importing ? <Loader2 size={12} className="spin" /> : <Upload size={12} />} {importing ? 'Importando…' : 'Importar (1 archivo)'}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,image/*,.csv,.txt" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) importarOrden(f); e.currentTarget.value = '' }} />
        <label style={{ fontSize: 10, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }} title="Tipo de cambio pactado (fijo para esta cotización)">TC
          <input type="number" step={0.01} value={config.tipoCambio} onChange={e => setConfig(c => ({ ...c, tipoCambio: parseFloat(e.target.value) || 0 }))}
            style={{ ...inp, width: 62, padding: '3px 6px', textAlign: 'right' }} />
        </label>
        <button onClick={convertirMoneda}
          title={`Convertir todos los montos a la otra moneda al TC ${config.tipoCambio}`}
          style={{ fontSize: 11, fontWeight: 700, color: config.currency === 'USD' ? '#06B6D4' : '#F59E0B', background: config.currency === 'USD' ? '#06B6D422' : '#F59E0B22', border: '1px solid ' + (config.currency === 'USD' ? '#06B6D455' : '#F59E0B55'), borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
          {config.currency} → {config.currency === 'USD' ? 'MXN' : 'USD'}
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
        {/* Buscador de catálogo */}
        <div style={{ position: 'relative', marginBottom: 12, maxWidth: 460 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, padding: '5px 10px' }}>
            <Search size={13} color="#666" />
            <input value={catQuery} onChange={e => { setCatQuery(e.target.value); setShowCat(true) }} onFocus={() => setShowCat(true)}
              placeholder="Buscar en catálogo (nombre, marca, modelo)…"
              style={{ ...inp, border: 'none', background: 'transparent', padding: 0 }} />
          </div>
          {showCat && catMatches.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 4, background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, maxHeight: 320, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
              {catMatches.map(p => (
                <div key={p.id} onClick={() => addFromCatalog(p)}
                  style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', gap: 8 }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1e1e1e')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: '#eee', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ fontSize: 9, color: '#777' }}>{[p.marca, p.modelo].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div style={{ fontSize: 11, color: '#F59E0B', whiteSpace: 'nowrap' }}>{F2(Number(p.precio_venta) || 0)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ border: '1px solid #1f1f1f', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 4, padding: '7px 10px', background: '#161616' }}>
            <span style={th}>Producto</span>
            <span style={th}>Marca</span>
            {!isMobile && <span style={th}>Modelo</span>}
            <span style={{ ...th, textAlign: 'center' }}>Cant</span>
            <span style={{ ...th, textAlign: 'right' }}>Costo u.</span>
            <span style={{ ...th, textAlign: 'right' }}>P. público u.</span>
            <span style={{ ...th, textAlign: 'right' }}>Importe</span>
            <span />
          </div>
          {items.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: '#555', fontSize: 12 }}>Agrega productos para revender, búscalos en el catálogo o importa una orden (PDF).</div>}
          {items.map(it => {
            const imp = it.precioPublico * it.cantidad
            const mg = it.precioPublico > 0 ? Math.round(((it.precioPublico - it.costo) / it.precioPublico) * 100) : 0
            return (
              <div key={it.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 4, padding: '6px 10px', alignItems: 'center', borderTop: '1px solid #161616' }}>
                <input value={it.name} onChange={e => upd(it.id, { name: e.target.value })} placeholder="Producto / descripción" style={inp} />
                <input value={it.marca} onChange={e => upd(it.id, { marca: e.target.value })} placeholder="Marca" style={inp} />
                {!isMobile && <input value={it.modelo} onChange={e => upd(it.id, { modelo: e.target.value })} placeholder="Modelo" style={inp} />}
                <input type="number" value={it.cantidad} onChange={e => upd(it.id, { cantidad: parseFloat(e.target.value) || 0 })} style={{ ...inp, textAlign: 'center' }} />
                <input type="number" value={it.costo} onChange={e => upd(it.id, { costo: parseFloat(e.target.value) || 0 })} style={{ ...inp, textAlign: 'right' }} />
                <input type="number" value={it.precioPublico} onChange={e => upd(it.id, { precioPublico: parseFloat(e.target.value) || 0 })} style={{ ...inp, textAlign: 'right', borderColor: '#F59E0B44' }} />
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
        <div style={{ marginTop: 16, marginLeft: 'auto', maxWidth: 360, background: '#0e0e0e', border: '1px solid #1f1f1f', borderRadius: 10, padding: 14 }}>
          <Row label="Subtotal (precio público)" value={F2(subtotalPublico)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
            <span style={{ fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 5 }}>
              Descuento
              <input type="number" value={config.descuentoPct} onChange={e => setConfig(c => ({ ...c, descuentoPct: parseFloat(e.target.value) || 0 }))}
                style={{ ...inp, width: 52, padding: '2px 5px', textAlign: 'right' }} />%
            </span>
            <span style={{ fontSize: 12, color: descuentoAmt > 0 ? '#DC2626' : '#ccc', fontWeight: 500 }}>{descuentoAmt > 0 ? '-' : ''}{F2(descuentoAmt)}</span>
          </div>
          {(config.descuentoPct || 0) > 0 && <Row label="Subtotal con descuento" value={F2(subtotalConDesc)} />}
          <div style={{ borderTop: '1px dashed #2a2a2a', margin: '6px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
            <span style={{ fontSize: 12, color: '#888' }}>Fletes</span>
            <input type="number" value={config.fletes} onChange={e => setConfig(c => ({ ...c, fletes: parseFloat(e.target.value) || 0 }))}
              style={{ ...inp, width: 110, padding: '3px 6px', textAlign: 'right' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
            <span style={{ fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 5 }}>
              Factor de importación
              <input type="number" value={config.factorImport} onChange={e => setConfig(c => ({ ...c, factorImport: parseFloat(e.target.value) || 0 }))}
                style={{ ...inp, width: 52, padding: '2px 5px', textAlign: 'right' }} />%
            </span>
            <span style={{ fontSize: 12, color: '#ccc', fontWeight: 500 }}>{F2(factorImportAmt)}</span>
          </div>
          <div style={{ borderTop: '1px solid #2a2a2a', margin: '6px 0' }} />
          <Row label={`IVA (${config.ivaRate}%)`} value={F2(iva)} />
          <Row label="Total" value={`${F2(total)} ${config.currency}`} big />
          <div style={{ borderTop: '1px dashed #2a2a2a', margin: '8px 0 6px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#666' }}>
            <span>Utilidad estimada (interno)</span>
            <span style={{ color: utilidad >= 0 ? '#10B981' : '#DC2626', fontWeight: 600 }}>{F2(utilidad)} · {margenPct}%</span>
          </div>
        </div>
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
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
