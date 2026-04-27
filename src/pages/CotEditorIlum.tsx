import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { F, STAGE_CONFIG } from '../lib/utils'
import { Btn, Loading } from '../components/layout/UI'
import { Plus, ChevronDown, ChevronRight, X, Trash2, Image as ImageIcon, Search, ArrowLeftRight, Sparkles, Upload, Loader2, FileText } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════
interface IlumProduct {
  id: string; subsectionId: string; catalogId: string | null
  name: string; description: string; imageUrl: string | null
  quantity: number; cost: number; markup: number; price: number; order: number
  marca?: string | null; modelo?: string | null; sku?: string | null
  watts?: number | null; lumens?: number | null; cct?: string | null
}

interface IlumSubsection {
  id: string; name: string; collapsed: boolean; order: number
}

interface IlumQuote {
  id: string; name: string; stage: string; notes: any
}

interface CatProduct {
  id: string; name: string; description: string; cost: number; markup: number; precio_venta: number
  provider: string; unit: string; marca?: string | null; modelo?: string | null; sku?: string | null
  image_url?: string | null; watts?: number | null; lumens?: number | null; cct?: string | null
}

const SUBSECTION_PRESETS = ['Luminarias', 'Fuentes de Poder', 'Perfiles', 'Drivers', 'Accesorios', 'Control']

function uid(): string { return Math.random().toString(36).slice(2, 10) }
function fmt(n: number): string { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function calcLine(p: IlumProduct) {
  const costReal = p.cost > 0 ? p.cost : p.price * (1 - p.markup / 100)
  const total = p.price * p.quantity
  const utilidad = p.price - costReal
  return { costReal, total, utilidad }
}

const S = {
  input: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 12, fontFamily: 'inherit', padding: '5px 8px', textAlign: 'right' as const, width: 70 },
  th: { padding: '6px 8px', fontSize: 9, fontWeight: 600, color: '#444', textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '1px solid #222', whiteSpace: 'nowrap' as const },
  td: { padding: '6px 8px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a' },
  tdR: { padding: '6px 8px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a', textAlign: 'right' as const },
  tdM: { padding: '6px 8px', fontSize: 12, fontWeight: 600, color: '#fff', borderBottom: '1px solid #1a1a1a', textAlign: 'right' as const },
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCT ROW
// ═══════════════════════════════════════════════════════════════════
function ProductRow({ p, onUpdate, onRemove, selected, onToggleSelect, onSubstitute }: {
  p: IlumProduct; onUpdate: (id: string, f: string, v: number | string) => void; onRemove: (id: string) => void
  selected?: boolean; onToggleSelect?: (id: string) => void; onSubstitute?: (p: IlumProduct) => void
}) {
  const { total, costReal, utilidad } = calcLine(p)
  return (
    <tr style={{ background: selected ? '#57FF9A0D' : undefined }}>
      {onToggleSelect && (
        <td style={{ ...S.td, width: 28, textAlign: 'center', padding: '6px 4px' }}>
          <input type="checkbox" checked={!!selected} onChange={() => onToggleSelect(p.id)} style={{ accentColor: '#57FF9A', cursor: 'pointer' }} />
        </td>
      )}
      <td style={{ ...S.td, width: 44, textAlign: 'center' }}>
        {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 4 }} />
          : <div style={{ width: 36, height: 36, background: '#1a1a1a', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}><ImageIcon size={12} color="#333" /></div>}
      </td>
      <td style={{ ...S.td, minWidth: 180 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#ddd' }}>{p.name}</div>
        {p.description && <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>{p.description}</div>}
      </td>
      <td style={{ ...S.td, fontSize: 11, color: '#666' }}>{p.marca || '—'}</td>
      <td style={{ ...S.td, fontSize: 11, color: '#666' }}>{p.modelo || '—'}</td>
      <td style={{ ...S.tdR, fontSize: 11, color: '#666' }}>{p.watts ? p.watts + 'W' : '—'}</td>
      <td style={{ ...S.td, width: 45 }}>
        <input type="number" defaultValue={p.quantity} min={1} onBlur={e => onUpdate(p.id, 'quantity', parseInt(e.target.value) || 1)} style={{ ...S.input, width: 40 }} />
      </td>
      <td style={S.tdR}><input type="number" defaultValue={p.cost} step={0.01} onBlur={e => onUpdate(p.id, 'cost', parseFloat(e.target.value) || 0)} style={S.input} /></td>
      <td style={S.tdR}><input type="number" defaultValue={p.markup} step={1} onBlur={e => onUpdate(p.id, 'markup', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: 45, color: p.markup >= 25 ? '#57FF9A' : p.markup >= 15 ? '#F59E0B' : '#EF4444' }} /></td>
      <td style={S.tdR}><input type="number" defaultValue={p.price} step={0.01} onBlur={e => onUpdate(p.id, 'price', parseFloat(e.target.value) || 0)} style={S.input} /></td>
      <td style={{ ...S.tdM, color: '#57FF9A' }}>${fmt(total)}</td>
      <td style={{ ...S.td, width: 28 }}>{onSubstitute && p.catalogId && <button onClick={() => onSubstitute(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: 0.5 }} title="Sustituir en todo el proyecto"><ArrowLeftRight size={12} color="#3B82F6" /></button>}</td>
      <td style={{ ...S.td, width: 28 }}><button onClick={() => onRemove(p.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Trash2 size={12} /></button></td>
    </tr>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CATALOG MODAL FOR ILUM PRODUCTS
// ═══════════════════════════════════════════════════════════════════
function IlumCatalogModal({ onClose, onSelect, subsectionName }: {
  onClose: () => void; onSelect: (p: CatProduct) => void; subsectionName: string
}) {
  const [catalog, setCatalog] = useState<CatProduct[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase.from('catalog_products').select('*').eq('is_active', true).eq('specialty', 'ilum').order('name')
      .then(({ data }: any) => { setCatalog(data || []); setLoading(false) })
  }, [])

  const filtered = search.length >= 2
    ? catalog.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.description || '').toLowerCase().includes(search.toLowerCase()))
    : catalog

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 20, width: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column' as const }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Agregar producto — {subsectionName}</div>
            <div style={{ fontSize: 11, color: '#555' }}>Busca en el catálogo de iluminación</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#444' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto..."
              style={{ width: '100%', padding: '8px 10px 8px 30px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit' }} autoFocus />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? <Loading /> : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 20px', color: '#444', fontSize: 13 }}>
              {search ? 'Sin resultados' : 'Catálogo vacío'}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#1a1a1a' }}>
                <th style={{ ...S.th, textAlign: 'left' }}>Producto</th>
                <th style={S.th}>Marca</th>
                <th style={S.th}>Modelo</th>
                <th style={S.th}>W</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Costo</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Precio</th>
                <th style={S.th}></th>
              </tr></thead>
              <tbody>
                {filtered.slice(0, 50).map(p => {
                  const precio = p.precio_venta > 0 ? p.precio_venta : Math.round(p.cost / (1 - p.markup / 100) * 100) / 100
                  return (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(p)}
                      onMouseEnter={e => { e.currentTarget.style.background = '#1a1a1a' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      <td style={{ ...S.td }}><div style={{ fontWeight: 500, color: '#ddd' }}>{p.name}</div>{p.description && <div style={{ fontSize: 10, color: '#555' }}>{p.description}</div>}</td>
                      <td style={{ ...S.td, fontSize: 10, color: '#666' }}>{p.marca || '—'}</td>
                      <td style={{ ...S.td, fontSize: 10, color: '#666' }}>{p.modelo || '—'}</td>
                      <td style={{ ...S.tdR, fontSize: 10, color: '#666' }}>{p.watts ? p.watts + 'W' : '—'}</td>
                      <td style={{ ...S.tdR, fontSize: 10, color: '#555' }}>${fmt(p.cost)}</td>
                      <td style={{ ...S.tdR, fontWeight: 600, color: '#57FF9A' }}>${fmt(precio)}</td>
                      <td style={S.td}><Btn size="sm" variant="primary">+ Agregar</Btn></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SUBSECTION BLOCK
// ═══════════════════════════════════════════════════════════════════
function SubsectionBlock({ subsection, products, onToggle, onUpdate, onRemove, onAdd, allProducts, selectedIds, onToggleSelect, onSubstitute }: {
  subsection: IlumSubsection; products: IlumProduct[]; onToggle: () => void
  onUpdate: (id: string, f: string, v: number | string) => void; onRemove: (id: string) => void
  onAdd: () => void; allProducts: IlumProduct[]
  selectedIds?: Set<string>; onToggleSelect?: (id: string) => void; onSubstitute?: (p: IlumProduct) => void
}) {
  const subTotal = products.reduce((s, p) => s + calcLine(p).total, 0)
  return (
    <div style={{ marginBottom: 10 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: 'pointer', background: '#111', borderRadius: 6, marginBottom: 2 }}>
        {subsection.collapsed ? <ChevronRight size={12} color="#555" /> : <ChevronDown size={12} color="#555" />}
        <span style={{ fontSize: 12, fontWeight: 700, color: '#57FF9A', textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>{subsection.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#666' }}>{products.length}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>${fmt(subTotal)}</span>
      </div>
      {!subsection.collapsed && (<>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#0e0e0e' }}>
            {onToggleSelect && (
              <th style={{ ...S.th, width: 28, textAlign: 'center', padding: '6px 4px' }}>
                <input type="checkbox"
                  checked={products.length > 0 && products.every(p => selectedIds?.has(p.id))}
                  onChange={() => {
                    const allSelected = products.every(p => selectedIds?.has(p.id))
                    products.forEach(p => {
                      const isSelected = selectedIds?.has(p.id)
                      if (allSelected && isSelected) onToggleSelect(p.id)
                      else if (!allSelected && !isSelected) onToggleSelect(p.id)
                    })
                  }}
                  style={{ accentColor: '#57FF9A', cursor: 'pointer' }} />
              </th>
            )}
            <th style={{ ...S.th, textAlign: 'center' }}>IMG</th>
            <th style={S.th}>PRODUCTO</th>
            <th style={S.th}>MARCA</th>
            <th style={S.th}>MODELO</th>
            <th style={{ ...S.th, textAlign: 'right' }}>W</th>
            <th style={{ ...S.th, textAlign: 'center' }}>CANT.</th>
            <th style={{ ...S.th, textAlign: 'right' }}>COSTO</th>
            <th style={{ ...S.th, textAlign: 'right' }}>MG%</th>
            <th style={{ ...S.th, textAlign: 'right' }}>PRECIO</th>
            <th style={{ ...S.th, textAlign: 'right' }}>TOTAL</th>
            <th style={S.th}></th><th style={S.th}></th>
          </tr></thead>
          <tbody>
            {products.map(p => (
              <ProductRow key={p.id} p={p} onUpdate={onUpdate} onRemove={onRemove} selected={selectedIds?.has(p.id)} onToggleSelect={onToggleSelect} onSubstitute={onSubstitute} />
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px' }}>
          <Btn size="sm" onClick={onAdd}><Plus size={12} /> Producto</Btn>
          <span style={{ fontSize: 10, color: '#555' }}>{subsection.name.toUpperCase()} TOTAL <span style={{ fontWeight: 700, color: '#fff', marginLeft: 6 }}>${fmt(subTotal)}</span></span>
        </div>
      </>)}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AI IMPORT MODAL — Importar listado de productos con AI (Iluminación)
// ═══════════════════════════════════════════════════════════════════
interface AIExtractedItemIlum {
  _rowId: string
  subsection: string
  marca: string
  modelo: string
  descripcion: string
  cantidad: number
  precio_unitario: number | null
  costo: number | null
  moneda: 'USD' | 'MXN' | null
  provider: string
  watts: number | null
  lumens: number | null
  cct: string | null
  notas: string
  match_status: 'exact' | 'partial' | 'none'
  catalog_product_id: string | null
  sku?: string | null
}

function AIImportModalIlum({ cotId, subsections, onClose, onImported }: {
  cotId: string
  subsections: IlumSubsection[]
  onClose: () => void
  onImported: () => void
}) {
  const [step, setStep] = useState<'upload' | 'processing' | 'review' | 'inserting'>('upload')
  const [items, setItems] = useState<AIExtractedItemIlum[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [confidence, setConfidence] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')
  const [insertedCount, setInsertedCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function fileToBase64(file: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res((r.result as string).split(',')[1])
      r.onerror = () => rej(new Error('Error leyendo archivo'))
      r.readAsDataURL(file)
    })
  }

  async function callExtractAPI(body: any): Promise<{ items: any[]; confidence: string; warnings: string[] }> {
    const r = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, context: 'iluminacion', subsections: subsections.map(s => s.name) }),
    })
    const data = await r.json()
    if (!r.ok || !data.ok) throw new Error(data.error || 'Error en /api/extract (' + r.status + ')')
    return { items: data.items || [], confidence: data.confidence || 'medium', warnings: data.warnings || [] }
  }

  async function loadXLSX(): Promise<any> {
    if ((window as any).XLSX) return (window as any).XLSX
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('No se pudo cargar SheetJS desde CDN'))
      document.head.appendChild(script)
    })
    if (!(window as any).XLSX) throw new Error('SheetJS cargado pero no disponible en window')
    return (window as any).XLSX
  }

  function mapSubsection(name: string): string {
    const s = (name || '').toLowerCase().trim()
    if (!s) return subsections[0]?.name || 'Luminarias'
    if (s.includes('luminaria') || s.includes('lamp') || s.includes('light') || s.includes('downlight') || s.includes('spot')) return 'Luminarias'
    if (s.includes('fuente') || s.includes('power') || s.includes('supply')) return 'Fuentes de Poder'
    if (s.includes('perfil') || s.includes('profile') || s.includes('channel')) return 'Perfiles'
    if (s.includes('driver') || s.includes('ballast') || s.includes('transformador')) return 'Drivers'
    if (s.includes('accesorio') || s.includes('accessor') || s.includes('mounting') || s.includes('bracket')) return 'Accesorios'
    if (s.includes('control') || s.includes('dimmer') || s.includes('switch') || s.includes('sensor')) return 'Control'
    return subsections[0]?.name || 'Luminarias'
  }

  function findCol(row: any, candidates: string[]): any {
    const keys = Object.keys(row)
    for (const cand of candidates) {
      const hit = keys.find(k => k.toLowerCase().trim() === cand.toLowerCase().trim())
      if (hit && row[hit] != null && String(row[hit]).trim() !== '') return row[hit]
    }
    return null
  }

  function tryParseStructuredRows(rows: any[]): { items: any[]; confidence: string; warnings: string[] } | null {
    if (!rows || rows.length === 0) return null
    const firstRow = rows[0]
    if (!firstRow || typeof firstRow !== 'object') return null
    const keys = Object.keys(firstRow).map(k => k.toLowerCase())
    const hasModel = keys.some(k => k === 'model' || k === 'modelo' || k === 'part number' || k === 'sku')
    if (!hasModel) return null

    const items: any[] = []
    const warnings: string[] = []
    for (const row of rows) {
      const model = findCol(row, ['Model', 'Modelo', 'Part Number', 'SKU'])
      if (!model) continue
      const manufacturer = findCol(row, ['Manufacturer', 'Marca', 'Brand', 'Fabricante']) || ''
      const category = findCol(row, ['Category', 'Categoría', 'Categoria', 'Subsección', 'Subseccion', 'System', 'Sistema', 'Type', 'Tipo']) || ''
      const description = findCol(row, ['Short Description', 'Description', 'Descripción', 'Descripcion', 'Product Description']) || ''
      const qtyRaw = findCol(row, ['Item Ext Qty', 'Item Unit Qty', 'Qty', 'Quantity', 'Cantidad', 'Cant'])
      const qty = qtyRaw != null ? parseFloat(String(qtyRaw)) : 1
      const priceRaw = findCol(row, ['Unit Price', 'Precio Unitario', 'Price', 'Precio', 'Item Unit Price', 'Sell Price', 'MSRP', 'P.U.', 'PU'])
      const price = priceRaw != null ? parseFloat(String(priceRaw).replace(/[$,]/g, '')) : null
      const costRaw = findCol(row, ['costo', 'Costo', 'Costo Unitario', 'Unit Cost', 'Cost', 'Dealer Cost', 'Net Cost'])
      const costVal = costRaw != null ? parseFloat(String(costRaw).replace(/[$,]/g, '')) : null
      const wattsRaw = findCol(row, ['Watts', 'W', 'Potencia', 'Wattage'])
      const lumensRaw = findCol(row, ['Lumens', 'Lm', 'Lúmenes', 'Lumenes', 'Flujo'])
      const cctRaw = findCol(row, ['CCT', 'Color Temp', 'Temperatura', 'Kelvin', 'K'])
      const currency = findCol(row, ['Selling Currency', 'Cost Currency', 'Currency', 'Moneda'])
      let moneda: 'USD' | 'MXN' | null = null
      if (currency) {
        const c = String(currency).toUpperCase()
        if (c.includes('USD') || c.includes('DLL') || c === 'US$') moneda = 'USD'
        else if (c.includes('MXN') || c.includes('PESO') || c === 'MX$') moneda = 'MXN'
      }

      items.push({
        subsection: mapSubsection(String(category)),
        marca: String(manufacturer).trim(),
        modelo: String(model).trim(),
        descripcion: String(description).trim(),
        cantidad: isNaN(qty) ? 1 : Math.max(1, Math.round(qty)),
        precio_unitario: price != null && !isNaN(price) ? price : null,
        costo: costVal != null && !isNaN(costVal) ? costVal : null,
        watts: wattsRaw ? parseFloat(String(wattsRaw)) || null : null,
        lumens: lumensRaw ? parseFloat(String(lumensRaw)) || null : null,
        cct: cctRaw ? String(cctRaw).trim() : null,
        moneda,
        provider: findCol(row, ['Vendor', 'Proveedor', 'Supplier', 'Distribuidor']) || String(manufacturer).trim(),
        notas: '',
      })
    }
    if (items.length === 0) return null
    const skipped = rows.length - items.length
    if (skipped > 0) warnings.push(skipped + ' fila(s) sin modelo fueron omitidas')
    warnings.push('Parseado directamente del Excel (' + items.length + ' items) — sin usar AI')
    return { items, confidence: 'high', warnings }
  }

  function tryParseStructured(text: string): { items: any[]; confidence: string; warnings: string[] } | null {
    if (!text || text.length < 50) return null
    const firstLine = text.split('\n')[0]
    const sep = firstLine.includes('\t') ? '\t' : ','
    const lines = text.split('\n').filter(l => l.trim().length > 0)
    if (lines.length < 2) return null
    function splitCSV(line: string): string[] {
      const out: string[] = []; let cur = ''; let inQ = false
      for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (c === '"' && (i === 0 || line[i-1] !== '\\')) { inQ = !inQ } else if (c === sep && !inQ) { out.push(cur); cur = '' } else { cur += c }
      }
      out.push(cur)
      return out.map(s => s.trim().replace(/^"|"$/g, ''))
    }
    const headers = splitCSV(lines[0])
    const rows: any[] = []
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCSV(lines[i]); const row: any = {}
      headers.forEach((h, idx) => { row[h] = cells[idx] || null })
      rows.push(row)
    }
    return tryParseStructuredRows(rows)
  }

  async function handleFile(file: File) {
    setError(null); setStep('processing'); setProgress('Leyendo archivo...')
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase()
      let extracted: { items: any[]; confidence: string; warnings: string[] }

      if (['csv', 'tsv', 'txt'].includes(ext)) {
        const text = await file.text()
        const dtResult = tryParseStructured(text)
        if (dtResult) { extracted = dtResult } else {
          setProgress('Analizando con AI...'); extracted = await callExtractAPI({ kind: 'text', payload: text })
        }
      } else if (['xlsx', 'xls'].includes(ext)) {
        setProgress('Cargando parser de Excel...')
        const XLSX = await loadXLSX()
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        let rows: any[] = []
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName]
          const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false })
          if (matrix.length === 0) continue
          const headerKeywords = ['model', 'modelo', 'part number', 'marca', 'quantity', 'cantidad', 'description', 'descripcion', 'price', 'precio', 'watts', 'costo', 'sku']
          let headerRowIdx = 0
          for (let i = 0; i < Math.min(matrix.length, 10); i++) {
            const cells = (matrix[i] || []).map((c: any) => String(c || '').toLowerCase().trim())
            const matches = cells.filter((c: string) => headerKeywords.some(kw => c === kw || c.includes(kw))).length
            if (matches >= 2) { headerRowIdx = i; break }
          }
          const headers = (matrix[headerRowIdx] || []).map((h: any, idx: number) => String(h || '').trim() || ('col_' + idx))
          const dataRows: any[] = []
          for (let i = headerRowIdx + 1; i < matrix.length; i++) {
            const row: any = {}; const cells = matrix[i] || []; let hasData = false
            headers.forEach((h: string, idx: number) => { const v = cells[idx]; row[h] = v != null && v !== '' ? v : null; if (v != null && String(v).trim() !== '') hasData = true })
            if (hasData) dataRows.push(row)
          }
          if (dataRows.length > rows.length) rows = dataRows
        }
        setProgress('Detectando formato...')
        const structured = tryParseStructuredRows(rows)
        if (structured) { extracted = structured } else {
          setProgress('Analizando con AI...')
          let text = ''; for (const name of wb.SheetNames) { text += '\n=== Hoja: ' + name + ' ===\n'; text += XLSX.utils.sheet_to_csv(wb.Sheets[name]) }
          extracted = await callExtractAPI({ kind: 'text', payload: text })
        }
      } else if (ext === 'pdf') {
        setProgress('Codificando PDF...'); const base64 = await fileToBase64(file)
        setProgress('Analizando PDF con AI...'); extracted = await callExtractAPI({ kind: 'pdf', payload: base64 })
      } else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        setProgress('Codificando imagen...'); const base64 = await fileToBase64(file)
        const mediaType = 'image/' + (ext === 'jpg' ? 'jpeg' : ext)
        setProgress('Analizando imagen con AI...'); extracted = await callExtractAPI({ kind: 'image', payload: base64, mediaType })
      } else {
        throw new Error('Formato no soportado: .' + ext + ' (usa Excel, CSV, PDF o imagen)')
      }

      setProgress('Verificando catálogo...')
      const matched = await matchCatalog(extracted.items)
      setItems(matched); setWarnings(extracted.warnings || []); setConfidence(extracted.confidence || 'medium'); setStep('review')
    } catch (err: any) { setError(err.message || 'Error procesando archivo'); setStep('upload') }
  }

  async function matchCatalog(rawItems: any[]): Promise<AIExtractedItemIlum[]> {
    const result: AIExtractedItemIlum[] = []
    for (const it of rawItems) {
      const row: AIExtractedItemIlum = {
        _rowId: uid(), subsection: it.subsection || subsections[0]?.name || 'Luminarias',
        marca: it.marca || '', modelo: it.modelo || '', descripcion: it.descripcion || '',
        cantidad: parseInt(it.cantidad) || 1, precio_unitario: it.precio_unitario != null ? Number(it.precio_unitario) : null,
        costo: it.costo != null ? Number(it.costo) : null, moneda: it.moneda === 'USD' || it.moneda === 'MXN' ? it.moneda : null,
        provider: it.provider || it.marca || '', watts: it.watts || null, lumens: it.lumens || null, cct: it.cct || null,
        notas: it.notas || '', match_status: 'none', catalog_product_id: null,
      }
      if (!row.modelo) { result.push(row); continue }
      const { data: exact } = await supabase.from('catalog_products').select('id, name, modelo').eq('modelo', row.modelo).eq('specialty', 'ilum').limit(5)
      if (exact && exact.length === 1) { row.match_status = 'exact'; row.catalog_product_id = exact[0].id }
      else if (exact && exact.length > 1) { row.match_status = 'partial'; row.catalog_product_id = exact[0].id }
      else {
        const { data: fuzzy } = await supabase.from('catalog_products').select('id, name, modelo').ilike('modelo', '%' + row.modelo + '%').eq('specialty', 'ilum').limit(5)
        if (fuzzy && fuzzy.length > 0) { row.match_status = 'partial'; row.catalog_product_id = fuzzy[0].id }
      }
      result.push(row)
    }
    return result
  }

  function updateRow(rowId: string, field: keyof AIExtractedItemIlum, value: any) {
    setItems(prev => prev.map(it => it._rowId === rowId ? { ...it, [field]: value } : it))
  }

  function removeRow(rowId: string) { setItems(prev => prev.filter(it => it._rowId !== rowId)) }

  async function handleConfirm() {
    setStep('inserting'); setError(null); setInsertedCount(0)
    try {
      // 1) Ensure subsections exist
      setProgress('Sincronizando subsecciones...')
      const subCache: Record<string, string> = {}
      subsections.forEach(s => { subCache[s.name.toLowerCase().trim()] = s.id })
      const uniqueSubNames = Array.from(new Set(items.map(it => (it.subsection || 'Luminarias').trim()).filter(Boolean)))
      for (const name of uniqueSubNames) {
        const key = name.toLowerCase()
        if (subCache[key]) continue
        const { data: newSub, error: subErr } = await supabase.from('quotation_areas').insert({
          quotation_id: cotId, name: name.trim(), order_index: Object.keys(subCache).length,
        }).select().single()
        if (subErr) throw new Error('Error creando subsección "' + name + '": ' + subErr.message)
        if (newSub) subCache[key] = newSub.id
      }

      // 2) Process each item
      setProgress('Procesando productos...')
      let inserted = 0
      const createdProducts: Record<string, { id: string; cost: number; moneda: string }> = {}
      for (const it of items) {
        if (!it.modelo) continue
        let catalogProductId = it.catalog_product_id
        let prodCost = it.costo || 0
        let prodMoneda: string = it.moneda || 'USD'

        if (!catalogProductId) {
          const cacheKey = it.modelo.toLowerCase().trim()
          if (createdProducts[cacheKey]) {
            catalogProductId = createdProducts[cacheKey].id
            prodCost = it.costo || createdProducts[cacheKey].cost
            prodMoneda = it.moneda || createdProducts[cacheKey].moneda
          } else {
            const { data: existingByModelo } = await supabase.from('catalog_products').select('id, cost, moneda, provider, marca, modelo, sku, image_url, markup').eq('modelo', it.modelo).limit(1).single()
            if (existingByModelo) {
              catalogProductId = existingByModelo.id
              prodCost = it.costo || Number(existingByModelo.cost) || 0
              prodMoneda = it.moneda || existingByModelo.moneda || 'USD'
              createdProducts[cacheKey] = { id: existingByModelo.id, cost: prodCost, moneda: prodMoneda }
            }
          }
        }

        if (!catalogProductId) {
          const newProductCost = it.costo || it.precio_unitario || 0
          const newProductMoneda = it.moneda || 'USD'
          const defaultMarkup = 35
          const precioVenta = it.precio_unitario || (newProductCost > 0 ? Math.round(newProductCost / (1 - defaultMarkup / 100) * 100) / 100 : 0)
          const productName = it.descripcion || ((it.marca + ' ' + it.modelo).trim())
          const computedMarkup = newProductCost > 0 && precioVenta > 0 ? Math.round((1 - newProductCost / precioVenta) * 100) : defaultMarkup
          const { data: newProd, error: prodErr } = await supabase.from('catalog_products').insert({
            name: productName, description: it.descripcion || null, system: 'Iluminacion', specialty: 'ilum',
            type: 'material', unit: 'pza', cost: newProductCost, markup: computedMarkup, precio_venta: precioVenta,
            provider: it.provider || null, marca: it.marca || null, modelo: it.modelo, moneda: newProductMoneda,
            watts: it.watts || null, lumens: it.lumens || null, cct: it.cct || null,
            clave_unidad: 'H87', iva_rate: 0.16, is_active: true,
          }).select().single()
          if (prodErr) {
            if (prodErr.code === '23505') {
              const { data: dup } = await supabase.from('catalog_products').select('id').eq('modelo', it.modelo).single()
              if (dup) { catalogProductId = dup.id; prodCost = newProductCost; prodMoneda = newProductMoneda; createdProducts[it.modelo.toLowerCase().trim()] = { id: dup.id, cost: newProductCost, moneda: newProductMoneda } }
              else { console.error('Error creando producto:', prodErr, it); continue }
            } else { console.error('Error creando producto:', prodErr, it); continue }
          }
          if (newProd) { catalogProductId = newProd.id; prodCost = newProductCost; prodMoneda = newProductMoneda; createdProducts[it.modelo.toLowerCase().trim()] = { id: newProd.id, cost: newProductCost, moneda: newProductMoneda } }
        } else {
          const { data: existing } = await supabase.from('catalog_products').select('cost, moneda, provider, markup, marca, modelo, sku, image_url, watts, lumens, cct').eq('id', catalogProductId).single()
          if (existing) {
            prodCost = it.costo || Number(existing.cost) || 0
            prodMoneda = it.moneda || existing.moneda || 'USD'
            if (!it.marca && existing.marca) it.marca = existing.marca
            if (!it.modelo && existing.modelo) it.modelo = existing.modelo
            if (!it.sku && (existing as any).sku) it.sku = (existing as any).sku
            if (!it.watts && existing.watts) it.watts = existing.watts
            if (!it.lumens && existing.lumens) it.lumens = existing.lumens
            if (!it.cct && existing.cct) it.cct = existing.cct
          }
        }

        const defaultMarkup = 35
        let precio: number
        if (it.precio_unitario && it.precio_unitario > 0) { precio = it.precio_unitario }
        else if (prodCost > 0) { precio = Math.round(prodCost / (1 - defaultMarkup / 100) * 100) / 100 }
        else { precio = 0 }
        const margin = prodCost > 0 && precio > 0 ? Math.round((1 - prodCost / precio) * 100) : defaultMarkup

        const subId = subCache[(it.subsection || 'Luminarias').toLowerCase().trim()]
        if (!subId) { console.warn('Sin subsección para item', it); continue }
        const itemName = it.descripcion || ((it.marca + ' ' + it.modelo).trim())

        const { error: itemErr } = await supabase.from('quotation_items').insert({
          quotation_id: cotId, area_id: subId, catalog_product_id: catalogProductId,
          name: itemName, description: it.descripcion || null, system: 'Iluminacion', type: 'material',
          quantity: it.cantidad, cost: prodCost, markup: margin, price: precio, total: precio * it.cantidad,
          installation_cost: 0, order_index: inserted,
          marca: it.marca || null, modelo: it.modelo || null, sku: it.sku || null,
          notes: JSON.stringify({ watts: it.watts, lumens: it.lumens, cct: it.cct }),
        })
        if (itemErr) { console.error('Error insertando item:', itemErr, it); continue }
        inserted++; setInsertedCount(inserted)
      }

      onImported(); onClose()
    } catch (err: any) { setError(err.message || 'Error en la importación'); setStep('review') }
  }

  const exactCount = items.filter(i => i.match_status === 'exact').length
  const partialCount = items.filter(i => i.match_status === 'partial').length
  const noneCount = items.filter(i => i.match_status === 'none').length
  const allSubNames = Array.from(new Set([...subsections.map(s => s.name), ...SUBSECTION_PRESETS]))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1030 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 20, width: '92vw', maxWidth: 1200, maxHeight: '92vh', display: 'flex', flexDirection: 'column' as const }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={14} color="#57FF9A" /> Importar con AI — Iluminación
            </div>
            <div style={{ fontSize: 11, color: '#555' }}>Sube un listado en Excel, CSV, PDF o imagen — la AI extrae los productos de iluminación</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {error && <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: 10, color: '#f87171', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        {step === 'upload' && (
          <div onClick={() => fileInputRef.current?.click()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }} onDragOver={e => e.preventDefault()}
            style={{ border: '2px dashed #333', borderRadius: 12, padding: '60px 20px', textAlign: 'center', cursor: 'pointer', color: '#666' }}>
            <Upload size={36} color="#444" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: '#ccc', marginBottom: 6 }}>Arrastra un archivo o haz clic</div>
            <div style={{ fontSize: 11, color: '#555' }}>Excel (.xlsx, .csv, .tsv), PDF, imagen (JPG, PNG, WEBP)</div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt,.pdf,.jpg,.jpeg,.png,.webp,.gif" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </div>
        )}

        {step === 'processing' && (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <Loader2 size={32} color="#57FF9A" style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
            <div style={{ fontSize: 13, color: '#ccc' }}>{progress}</div>
          </div>
        )}

        {step === 'inserting' && (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <Loader2 size={32} color="#57FF9A" style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
            <div style={{ fontSize: 13, color: '#ccc' }}>{progress}</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>Insertados: {insertedCount} / {items.length}</div>
          </div>
        )}

        {step === 'review' && (<>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10, fontSize: 11 }}>
            <span style={{ color: '#888' }}>Confianza: <span style={{ color: confidence === 'high' ? '#57FF9A' : confidence === 'medium' ? '#F59E0B' : '#EF4444', fontWeight: 600 }}>{confidence}</span></span>
            <span style={{ color: '#888' }}>{items.length} items detectados</span>
            <span style={{ color: '#57FF9A' }}>✓ {exactCount} en catálogo</span>
            <span style={{ color: '#F59E0B' }}>~ {partialCount} parciales</span>
            <span style={{ color: '#06B6D4' }}>+ {noneCount} nuevos</span>
          </div>

          {warnings.length > 0 && (
            <div style={{ background: '#2a200a', border: '1px solid #3a2e10', borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 600, marginBottom: 4 }}>Advertencias:</div>
              {warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#aaa' }}>• {w}</div>)}
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #222', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#1a1a1a' }}>
                <tr>
                  <th style={S.th}></th>
                  <th style={{ ...S.th, textAlign: 'left' }}>Subsección</th>
                  <th style={{ ...S.th, textAlign: 'left' }}>Marca</th>
                  <th style={{ ...S.th, textAlign: 'left' }}>Modelo</th>
                  <th style={{ ...S.th, textAlign: 'left' }}>Descripción</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>W</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Cant</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Costo</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>P. Venta</th>
                  <th style={S.th}>Mon</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it._rowId}>
                    <td style={{ ...S.td, textAlign: 'center', width: 28 }}>
                      {it.match_status === 'exact' && <span title="En catálogo" style={{ color: '#57FF9A' }}>✓</span>}
                      {it.match_status === 'partial' && <span title="Match parcial" style={{ color: '#F59E0B' }}>~</span>}
                      {it.match_status === 'none' && <span title="Se creará nuevo" style={{ color: '#06B6D4' }}>+</span>}
                    </td>
                    <td style={S.td}>
                      <select value={it.subsection} onChange={e => updateRow(it._rowId, 'subsection', e.target.value)}
                        style={{ padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }}>
                        {allSubNames.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={S.td}><input value={it.marca} onChange={e => updateRow(it._rowId, 'marca', e.target.value)} style={{ width: 90, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }} /></td>
                    <td style={S.td}><input value={it.modelo} onChange={e => updateRow(it._rowId, 'modelo', e.target.value)} style={{ width: 110, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }} /></td>
                    <td style={S.td}><input value={it.descripcion} onChange={e => updateRow(it._rowId, 'descripcion', e.target.value)} style={{ width: 180, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }} /></td>
                    <td style={S.tdR}><input type="number" value={it.watts ?? ''} onChange={e => updateRow(it._rowId, 'watts', e.target.value ? parseFloat(e.target.value) : null)} style={{ width: 50, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} /></td>
                    <td style={S.tdR}><input type="number" value={it.cantidad} onChange={e => updateRow(it._rowId, 'cantidad', parseInt(e.target.value) || 1)} style={{ width: 50, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} /></td>
                    <td style={S.tdR}><input type="number" step={0.01} value={it.costo ?? ''} onChange={e => updateRow(it._rowId, 'costo', e.target.value ? parseFloat(e.target.value) : null)} style={{ width: 70, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#F59E0B', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} /></td>
                    <td style={S.tdR}><input type="number" step={0.01} value={it.precio_unitario ?? ''} onChange={e => updateRow(it._rowId, 'precio_unitario', e.target.value ? parseFloat(e.target.value) : null)} style={{ width: 70, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} /></td>
                    <td style={S.td}>
                      <select value={it.moneda || ''} onChange={e => updateRow(it._rowId, 'moneda', (e.target.value || null) as any)}
                        style={{ padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }}>
                        <option value="">—</option><option value="USD">USD</option><option value="MXN">MXN</option>
                      </select>
                    </td>
                    <td style={{ ...S.td, width: 28 }}><button onClick={() => removeRow(it._rowId)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><X size={12} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" onClick={handleConfirm} disabled={items.length === 0}>Importar {items.length} items a la cotización</Btn>
          </div>
        </>)}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function CotEditorIlum({ cotId, onBack }: { cotId: string; onBack: () => void }) {
  const [quote, setQuote] = useState<IlumQuote | null>(null)
  const [subsections, setSubsections] = useState<IlumSubsection[]>([])
  const [products, setProducts] = useState<IlumProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [customSubInput, setCustomSubInput] = useState('')
  const [catalogModal, setCatalogModal] = useState<{ open: boolean; subsectionId: string } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [substitutingProduct, setSubstitutingProduct] = useState<IlumProduct | null>(null)
  const [showAIImport, setShowAIImport] = useState(false)
  const [showPdfPicker, setShowPdfPicker] = useState(false)

  // Load quotation, subsections, and products
  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: quoteData } = await supabase.from('quotations').select('*').eq('id', cotId).single()
      if (quoteData) setQuote(quoteData)

      const { data: subsData } = await supabase.from('quotation_areas').select('*').eq('quotation_id', cotId).order('order_index')
      if (subsData) setSubsections(subsData.map(s => ({ ...s, collapsed: false })))

      const { data: prodData } = await supabase.from('quotation_items').select('*').eq('quotation_id', cotId).order('order_index')
      if (prodData) {
        const prods = prodData.map((p: any) => {
          let notes: any = {}
          try { notes = JSON.parse(p.notes || '{}') } catch {}
          return {
            id: p.id, subsectionId: p.area_id, catalogId: p.catalog_product_id,
            name: p.name, description: p.description || '', imageUrl: p.image_url,
            quantity: p.quantity || 1, cost: p.cost || 0, markup: p.markup || 0, price: p.price || 0, order: p.order_index || 0,
            marca: p.marca, modelo: p.modelo, sku: p.sku,
            watts: notes.watts || null, lumens: notes.lumens || null, cct: notes.cct || null,
          }
        })
        // Enrich with catalog data for watts/lumens/cct if missing
        const catalogIds = [...new Set(prods.filter((p: any) => p.catalogId && !p.watts).map((p: any) => p.catalogId))]
        if (catalogIds.length > 0) {
          const { data: catData } = await supabase.from('catalog_products').select('id,watts,lumens,cct').in('id', catalogIds)
          if (catData) {
            const catMap = new Map(catData.map((c: any) => [c.id, c]))
            prods.forEach((p: any) => {
              if (p.catalogId && !p.watts) {
                const cat = catMap.get(p.catalogId)
                if (cat) { p.watts = cat.watts; p.lumens = cat.lumens; p.cct = cat.cct }
              }
            })
          }
        }
        setProducts(prods)
      }

      setLoading(false)
    }
    load()
  }, [cotId])

  // Add subsection (preset or custom)
  async function addSubsection(name: string) {
    if (!name.trim() || subsections.some(s => s.name === name)) return
    const { data } = await supabase.from('quotation_areas').insert({
      quotation_id: cotId, name: name.trim(), order_index: subsections.length,
    }).select().single()
    if (data) setSubsections([...subsections, { id: data.id, name: data.name, collapsed: false, order: data.order_index }])
    setCustomSubInput('')
  }

  // Remove subsection (only if no products)
  async function removeSubsection(id: string) {
    const hasProducts = products.some(p => p.subsectionId === id)
    if (hasProducts) { alert('No puedes eliminar una subsección con productos'); return }
    await supabase.from('quotation_areas').delete().eq('id', id)
    setSubsections(subsections.filter(s => s.id !== id))
  }

  // Toggle subsection collapse
  function toggleSubsection(id: string) {
    setSubsections(subsections.map(s => s.id === id ? { ...s, collapsed: !s.collapsed } : s))
  }

  // Update product field
  async function updateProduct(id: string, field: string, value: number | string) {
    const p = products.find(x => x.id === id)
    if (!p) return
    const updated = { ...p, [field]: value }
    setProducts(products.map(x => x.id === id ? updated : x))
    const dbField = field === 'quantity' ? 'quantity' : field === 'cost' ? 'cost' : field === 'markup' ? 'markup' : field === 'price' ? 'price' : field
    const payload: any = { [dbField]: value }
    // Always recalculate total
    const { total } = calcLine(updated)
    payload.total = total
    await supabase.from('quotation_items').update(payload).eq('id', id)
  }

  // Remove product
  async function removeProduct(id: string) {
    setProducts(products.filter(p => p.id !== id))
    await supabase.from('quotation_items').delete().eq('id', id)
    setSelectedIds(new Set([...selectedIds].filter(x => x !== id)))
  }

  // Add product from catalog
  async function addProductFromCatalog(subsectionId: string, catProduct: CatProduct) {
    const markup = catProduct.markup || 35
    const price = catProduct.precio_venta > 0 ? catProduct.precio_venta : (catProduct.cost > 0 && markup < 100 ? Math.round(catProduct.cost / (1 - markup / 100) * 100) / 100 : 0)
    const total = price * 1
    const { data, error } = await supabase.from('quotation_items').insert({
      quotation_id: cotId, area_id: subsectionId, catalog_product_id: catProduct.id,
      name: catProduct.name, description: catProduct.description || null, image_url: catProduct.image_url || null,
      quantity: 1, cost: catProduct.cost || 0, markup, price,
      total, order_index: products.filter(p => p.subsectionId === subsectionId).length,
      system: 'Iluminacion', type: 'material',
      marca: catProduct.marca || null, modelo: catProduct.modelo || null, sku: catProduct.sku || null,
      notes: JSON.stringify({ watts: catProduct.watts, lumens: catProduct.lumens, cct: catProduct.cct }),
    }).select().single()
    if (error) { alert('Error: ' + error.message); return }
    if (data) {
      setProducts(prev => [...prev, {
        id: data.id, subsectionId, catalogId: catProduct.id,
        name: catProduct.name, description: catProduct.description || '',
        imageUrl: catProduct.image_url || null,
        quantity: 1, cost: catProduct.cost || 0, markup, price,
        order: products.filter(p => p.subsectionId === subsectionId).length,
        marca: catProduct.marca, modelo: catProduct.modelo, sku: catProduct.sku,
        watts: catProduct.watts, lumens: catProduct.lumens, cct: catProduct.cct,
      }])
    }
    setCatalogModal(null)
  }

  // Substitute product globally
  async function substituteProduct(oldProduct: IlumProduct, newCatProd: CatProduct) {
    if (!oldProduct.catalogId) return
    const oldCatalogId = oldProduct.catalogId
    const affected = products.filter(p => p.catalogId === oldCatalogId)
    const count = affected.length
    if (!confirm(`¿Sustituir "${oldProduct.name}" por "${newCatProd.name}" en ${count} ubicación(es)?`)) return

    const markup = newCatProd.markup || 35
    const price = newCatProd.precio_venta > 0 ? newCatProd.precio_venta : (newCatProd.cost > 0 && markup < 100 ? Math.round(newCatProd.cost / (1 - markup / 100) * 100) / 100 : 0)

    setProducts(prev => prev.map(p => {
      if (p.catalogId !== oldCatalogId) return p
      return { ...p, catalogId: newCatProd.id, name: newCatProd.name, description: newCatProd.description || '', imageUrl: newCatProd.image_url || null, cost: newCatProd.cost || 0, markup, price, marca: newCatProd.marca || null, modelo: newCatProd.modelo || null, sku: newCatProd.sku || null, watts: newCatProd.watts, lumens: newCatProd.lumens, cct: newCatProd.cct }
    }))

    for (const p of affected) {
      await supabase.from('quotation_items').update({
        catalog_product_id: newCatProd.id, name: newCatProd.name, description: newCatProd.description || null,
        image_url: newCatProd.image_url || null, cost: newCatProd.cost || 0, markup, price,
        total: price * p.quantity, marca: newCatProd.marca || null, modelo: newCatProd.modelo || null, sku: newCatProd.sku || null,
        notes: JSON.stringify({ watts: newCatProd.watts, lumens: newCatProd.lumens, cct: newCatProd.cct }),
      }).eq('id', p.id)
    }
    setSubstitutingProduct(null)
    alert(`${count} producto(s) sustituido(s).`)
  }

  // Update quotation name
  async function updateQuoteName(name: string) {
    if (!quote) return
    setQuote({ ...quote, name })
    await supabase.from('quotations').update({ name }).eq('id', cotId)
  }

  // Toggle product selection
  function toggleProductSelect(id: string) {
    const newIds = new Set(selectedIds)
    if (newIds.has(id)) newIds.delete(id)
    else newIds.add(id)
    setSelectedIds(newIds)
  }

  // Calculate totals
  const grandTotal = useMemo(() => products.reduce((s, p) => s + calcLine(p).total, 0), [products])
  const subsectionTotals = useMemo(() => {
    const map: Record<string, number> = {}
    subsections.forEach(s => {
      map[s.id] = products.filter(p => p.subsectionId === s.id).reduce((s, p) => s + calcLine(p).total, 0)
    })
    return map
  }, [subsections, products])

  if (loading) return <Loading />

  return (
    <div style={{ background: '#0e0e0e', minHeight: '100vh', padding: '20px', color: '#ccc' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #222' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#57FF9A', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
            {'<'} Cotizaciones
          </button>
          <div style={{ flex: 1 }}>
            <input
              type="text" value={quote?.name || ''} onChange={e => updateQuoteName(e.target.value)}
              placeholder="Nombre de cotización"
              style={{ background: 'transparent', border: 'none', fontSize: 20, fontWeight: 700, color: '#fff', width: '100%', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {Object.entries(STAGE_CONFIG).map(([id, s]) => (
              <button
                key={id}
                onClick={() => quote && supabase.from('quotations').update({ stage: id }).eq('id', cotId).then(() => setQuote({ ...quote, stage: id }))}
                style={{
                  padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                  background: quote?.stage === id ? s.color + '33' : 'transparent',
                  border: quote?.stage === id ? '1px solid ' + s.color : '1px solid #333',
                  color: quote?.stage === id ? s.color : '#666', cursor: 'pointer',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowAIImport(true)} style={{ padding: '6px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #57FF9A44', background: 'transparent', color: '#57FF9A', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Sparkles size={12} /> Importar con AI</button>
          <button onClick={() => setShowPdfPicker(true)} style={{ padding: '6px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #06B6D444', background: 'transparent', color: '#06B6D4', display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileText size={12} /> Exportar PDF</button>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#57FF9A' }}>${fmt(grandTotal)}</div>
        </div>

        {/* Subsection Presets */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {SUBSECTION_PRESETS.map(preset => {
              const exists = subsections.some(s => s.name === preset)
              return (
                <button
                  key={preset}
                  onClick={() => !exists && addSubsection(preset)}
                  disabled={exists}
                  style={{
                    padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                    background: exists ? '#57FF9A33' : '#1a1a1a', border: exists ? '1px solid #57FF9A' : '1px solid #333',
                    color: exists ? '#57FF9A' : '#666', cursor: exists ? 'default' : 'pointer', opacity: exists ? 1 : 0.6,
                  }}
                >
                  {preset}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text" value={customSubInput} onChange={e => setCustomSubInput(e.target.value)} placeholder="Nombre personalizado..."
              onKeyDown={e => e.key === 'Enter' && addSubsection(customSubInput)}
              style={{ flex: 1, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', color: '#ccc', fontSize: 12, fontFamily: 'inherit' }}
            />
            <Btn size="sm" onClick={() => addSubsection(customSubInput)}>Agregar</Btn>
          </div>
        </div>

        {/* Subsections */}
        {subsections.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#555' }}>Agrega una subsección para comenzar</div>
        ) : (
          subsections.map(sub => (
            <div key={sub.id} style={{ marginBottom: 16 }}>
              <SubsectionBlock
                subsection={sub}
                products={products.filter(p => p.subsectionId === sub.id)}
                onToggle={() => toggleSubsection(sub.id)}
                onUpdate={updateProduct}
                onRemove={removeProduct}
                onAdd={() => setCatalogModal({ open: true, subsectionId: sub.id })}
                allProducts={products}
                selectedIds={selectedIds}
                onToggleSelect={toggleProductSelect}
                onSubstitute={(p) => setSubstitutingProduct(p)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px', gap: 20 }}>
                <button
                  onClick={() => removeSubsection(sub.id)}
                  style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}
                >
                  Eliminar
                </button>
                <span style={{ fontSize: 11, color: '#555' }}>SUBTOTAL <span style={{ fontWeight: 700, color: '#fff', marginLeft: 8 }}>${fmt(subsectionTotals[sub.id] || 0)}</span></span>
              </div>
            </div>
          ))
        )}

        {/* Summary Footer */}
        <div style={{ marginTop: 30, padding: '20px', background: '#111', borderRadius: 10, borderTop: '2px solid #57FF9A' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 40 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>TOTAL</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#57FF9A' }}>${fmt(grandTotal)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Catalog Modal */}
      {catalogModal?.open && (
        <IlumCatalogModal
          onClose={() => setCatalogModal(null)}
          onSelect={p => addProductFromCatalog(catalogModal.subsectionId, p)}
          subsectionName={subsections.find(s => s.id === catalogModal.subsectionId)?.name || ''}
        />
      )}

      {/* Substitute Modal */}
      {substitutingProduct && (
        <IlumCatalogModal
          onClose={() => setSubstitutingProduct(null)}
          onSelect={p => substituteProduct(substitutingProduct, p)}
          subsectionName={`Sustituir: ${substitutingProduct.name} (${products.filter(p => p.catalogId === substitutingProduct.catalogId).length} ubicaciones)`}
        />
      )}

      {/* AI Import Modal */}
      {showAIImport && (
        <AIImportModalIlum
          cotId={cotId}
          subsections={subsections}
          onClose={() => setShowAIImport(false)}
          onImported={() => {
            // Reload data
            async function reload() {
              const { data: subsData } = await supabase.from('quotation_areas').select('*').eq('quotation_id', cotId).order('order_index')
              if (subsData) setSubsections(subsData.map((s: any) => ({ ...s, collapsed: false })))
              const { data: prodData } = await supabase.from('quotation_items').select('*').eq('quotation_id', cotId).order('order_index')
              if (prodData) {
                const prods = prodData.map((p: any) => {
                  let notes: any = {}; try { notes = JSON.parse(p.notes || '{}') } catch {}
                  return { id: p.id, subsectionId: p.area_id, catalogId: p.catalog_product_id, name: p.name, description: p.description || '', imageUrl: p.image_url, quantity: p.quantity || 1, cost: p.cost || 0, markup: p.markup || 0, price: p.price || 0, order: p.order_index || 0, marca: p.marca, modelo: p.modelo, sku: p.sku, watts: notes.watts || null, lumens: notes.lumens || null, cct: notes.cct || null }
                })
                setProducts(prods)
              }
            }
            reload()
          }}
        />
      )}

      {/* PDF format picker */}
      {showPdfPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1030, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 620, maxWidth: '92vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={16} color="#06B6D4" /> Exportar a PDF — Iluminación
              </div>
              <button onClick={() => setShowPdfPicker(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 18 }}>Elige el formato. Cada uno abre en una pestaña nueva con vista previa imprimible.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              {([
                { id: 'ejecutivo', icon: '📄', title: 'Ejecutivo', desc: 'Para cliente final. Diseño formal, sin costos internos ni markups. La versión que mandas por email.' },
                { id: 'tecnico', icon: '🔧', title: 'Técnico detallado', desc: 'Para ingeniería. Incluye SKUs, proveedores, costos internos y markups. Uso interno o cliente técnico.' },
                { id: 'lista', icon: '📋', title: 'Lista de precios', desc: 'Tabla simple sin agrupar. Ideal para comparar precios rápido.' },
              ] as const).map(opt => (
                <button key={opt.id} onClick={() => { window.open('/cotizacion/' + cotId + '/pdf/' + opt.id, '_blank'); setShowPdfPicker(false) }}
                  style={{ padding: '14px 16px', background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 10, cursor: 'pointer', textAlign: 'left', color: '#ddd', fontFamily: 'inherit', display: 'flex', gap: 12, alignItems: 'center' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#06B6D4'; e.currentTarget.style.background = '#0e1419' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.background = '#0e0e0e' }}>
                  <div style={{ fontSize: 24 }}>{opt.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{opt.title}</div>
                    <div style={{ fontSize: 11, color: '#888', lineHeight: 1.4 }}>{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
