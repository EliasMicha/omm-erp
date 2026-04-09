import { useState, useMemo, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { F, STAGE_CONFIG } from '../lib/utils'
import { Badge, Btn, Loading } from '../components/layout/UI'
import { ANTHROPIC_API_KEY } from '../lib/config'
import { Plus, ChevronLeft, ChevronRight, ChevronDown, X, Trash2, Image as ImageIcon, Search, RefreshCw, Sparkles, Upload, Loader2 } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════
interface EspProduct {
  id: string; areaId: string; systemId: string; catalogId: string | null
  name: string; description: string; imageUrl: string | null
  quantity: number; price: number; laborCost: number; margin: number; order: number
  monedaOrigen: string // USD or MXN — the currency of the catalog product
}
interface EspArea { id: string; name: string; collapsed: boolean; order: number }
interface EspSystemDef { id: string; name: string; color: string }
interface CatProduct { id: string; name: string; description: string; system: string; cost: number; markup: number; provider: string; unit: string; moneda?: string }
interface EspQuoteConfig { currency: string; ivaRate: number; programacion: number; tipoCambio: number; paymentSchedule: Array<{ label: string; percentage: number }>; version: string }

const ALL_SYSTEMS: EspSystemDef[] = [
  { id: 'audio', name: 'Audio', color: '#8B5CF6' },
  { id: 'redes', name: 'Redes', color: '#06B6D4' },
  { id: 'cctv', name: 'CCTV', color: '#3B82F6' },
  { id: 'control_acceso', name: 'Control de Acceso', color: '#F59E0B' },
  { id: 'control_iluminacion', name: 'Control de Iluminación', color: '#C084FC' },
  { id: 'deteccion_humo', name: 'Detección de Humo', color: '#EF4444' },
  { id: 'bms', name: 'BMS', color: '#10B981' },
  { id: 'telefonia', name: 'Telefonía', color: '#F97316' },
  { id: 'red_celular', name: 'Red Celular', color: '#EC4899' },
  { id: 'cortinas_ctrl', name: 'Cortinas y Persianas', color: '#67E8F9' },
]

function uid(): string { return Math.random().toString(36).slice(2, 10) }

function calcLine(p: EspProduct) {
  const precioAmp = p.price * p.quantity
  const moAmp = p.laborCost * p.quantity
  const total = precioAmp + moAmp
  const costReal = p.price * (1 - p.margin / 100)
  const utilidad = p.price - costReal
  return { precioAmp, moAmp, total, costReal, utilidad }
}

const S = {
  input: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 12, fontFamily: 'inherit', padding: '5px 8px', textAlign: 'right' as const, width: 70 },
  th: { padding: '6px 8px', fontSize: 9, fontWeight: 600, color: '#444', textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '1px solid #222', whiteSpace: 'nowrap' as const },
  td: { padding: '6px 8px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a' },
  tdR: { padding: '6px 8px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a', textAlign: 'right' as const },
  tdM: { padding: '6px 8px', fontSize: 12, fontWeight: 600, color: '#fff', borderBottom: '1px solid #1a1a1a', textAlign: 'right' as const },
}

// ═══════════════════════════════════════════════════════════════════
// TABULADOR DE PRECIOS POR PROVEEDOR
// costoMult: multiplicador sobre costo de lista (1.05 = +5% overhead)
// margen: % de margen sobre precio de venta
// instPct: % de instalación y programación sobre precio de venta
// descMax: descuento máximo permitido
// precioPublico: true = usar precio público directo, no calcular
// ═══════════════════════════════════════════════════════════════════
interface PricingRule {
  costoMult: number
  margen: number
  instPct: number
  descMax: number
  precioPublico: boolean
}

const PRICING_RULES: Record<string, PricingRule> = {
  'SYSCOM':                    { costoMult: 1.05, margen: 38, instPct: 22, descMax: 10, precioPublico: false },
  'UBIQUITI':                  { costoMult: 1.05, margen: 30, instPct: 22, descMax: 10, precioPublico: false },
  'DEALERSHOP':                { costoMult: 1.05, margen: 38, instPct: 22, descMax: 10, precioPublico: false },
  'LUTRON':                    { costoMult: 1.05, margen: 0,  instPct: 22, descMax: 10, precioPublico: true },
  'DEXTRA ELECTRONICS':        { costoMult: 1.05, margen: 33, instPct: 22, descMax: 10, precioPublico: false },
  'REPRESENTACIONES DE AUDIO': { costoMult: 1.05, margen: 33, instPct: 22, descMax: 10, precioPublico: false },
  'TECSO':                     { costoMult: 1.05, margen: 33, instPct: 22, descMax: 10, precioPublico: false },
  'SONOS':                     { costoMult: 1.00, margen: 0,  instPct: 22, descMax: 10, precioPublico: true },
  'SOMFY':                     { costoMult: 1.00, margen: 45, instPct: 14, descMax: 10, precioPublico: false },
}
const DEFAULT_RULE: PricingRule = { costoMult: 1.05, margen: 33, instPct: 22, descMax: 10, precioPublico: false }

function getPricingRule(providerName: string): PricingRule {
  const upper = (providerName || '').toUpperCase()
  for (const [key, rule] of Object.entries(PRICING_RULES)) {
    if (upper.includes(key) || key.includes(upper)) return rule
  }
  return DEFAULT_RULE
}

function calcPriceFromCost(cost: number, rule: PricingRule): number {
  if (rule.precioPublico) return 0 // must be entered manually
  const costoReal = cost * rule.costoMult
  return Math.round(costoReal / (1 - rule.margen / 100) * 100) / 100
}

function calcLaborFromPrice(price: number, rule: PricingRule): number {
  return Math.round(price * (rule.instPct / 100) * 100) / 100
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCT ROW
// ═══════════════════════════════════════════════════════════════════
function ProductRow({ p, onUpdate, onRemove, onUpdateAll, showInt, duplicateCount }: {
  p: EspProduct; onUpdate: (id: string, f: string, v: number | string) => void; onRemove: (id: string) => void
  onUpdateAll: (catalogId: string, field: string, value: number) => void; showInt: boolean; duplicateCount: number
}) {
  const { precioAmp, moAmp, total, costReal, utilidad } = calcLine(p)
  const handleBlur = (field: string, value: number) => {
    onUpdate(p.id, field, value)
    if (duplicateCount > 1 && p.catalogId && (field === 'price' || field === 'laborCost' || field === 'margin')) {
      if (confirm('Este producto aparece ' + duplicateCount + ' veces. ¿Actualizar ' + field + ' en todos?')) {
        onUpdateAll(p.catalogId, field, value)
      }
    }
  }
  return (
    <tr>
      <td style={{ ...S.td, width: 44, textAlign: 'center' }}>
        {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 4 }} />
          : <div style={{ width: 36, height: 36, background: '#1a1a1a', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}><ImageIcon size={12} color="#333" /></div>}
      </td>
      <td style={{ ...S.td, width: 45 }}>
        <input type="number" defaultValue={p.quantity} min={1} onBlur={e => onUpdate(p.id, 'quantity', parseInt(e.target.value) || 1)} style={{ ...S.input, width: 40 }} />
      </td>
      <td style={{ ...S.td, minWidth: 180 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#ddd' }}>{p.name}</div>
        {p.description && <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>{p.description}</div>}
        {duplicateCount > 1 && <span style={{ fontSize: 9, color: '#F59E0B', background: '#F59E0B18', padding: '1px 5px', borderRadius: 4 }}>×{duplicateCount}</span>}
      </td>
      <td style={S.tdR}><input type="number" defaultValue={p.price} step={0.01} onBlur={e => handleBlur('price', parseFloat(e.target.value) || 0)} style={S.input} /></td>
      <td style={S.tdM}>${precioAmp.toFixed(2)}</td>
      <td style={S.tdR}><input type="number" defaultValue={p.laborCost} step={0.01} onBlur={e => handleBlur('laborCost', parseFloat(e.target.value) || 0)} style={S.input} /></td>
      <td style={{ ...S.tdM, color: '#57FF9A' }}>${total.toFixed(2)}</td>
      {showInt && (<>
        <td style={{ ...S.tdR, color: '#555', fontSize: 10 }}>${costReal.toFixed(2)}</td>
        <td style={S.tdR}><input type="number" defaultValue={p.margin} step={1} onBlur={e => handleBlur('margin', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: 40, color: p.margin >= 25 ? '#57FF9A' : p.margin >= 15 ? '#F59E0B' : '#EF4444' }} /></td>
        <td style={{ ...S.tdR, fontSize: 10, color: utilidad >= 0 ? '#57FF9A' : '#EF4444' }}>${utilidad.toFixed(2)}</td>
      </>)}
      <td style={{ ...S.td, width: 28 }}><button onClick={() => onRemove(p.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Trash2 size={12} /></button></td>
    </tr>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SYSTEM BLOCK
// ═══════════════════════════════════════════════════════════════════
function SystemBlock({ sysDef, products, collapsed, onToggle, onUpdate, onRemove, onUpdateAll, onAdd, showInt, allProducts }: {
  sysDef: EspSystemDef; products: EspProduct[]; collapsed: boolean; onToggle: () => void
  onUpdate: (id: string, f: string, v: number | string) => void; onRemove: (id: string) => void
  onUpdateAll: (catalogId: string, field: string, value: number) => void; onAdd: () => void; showInt: boolean; allProducts: EspProduct[]
}) {
  const sysTotal = products.reduce((s, p) => s + calcLine(p).total, 0)
  return (
    <div style={{ marginBottom: 10 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: 'pointer', background: '#111', borderRadius: 6, marginBottom: 2 }}>
        {collapsed ? <ChevronRight size={12} color="#555" /> : <ChevronDown size={12} color="#555" />}
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: sysDef.color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: sysDef.color, textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>{sysDef.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#666' }}>{products.length}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>${sysTotal.toFixed(2)}</span>
      </div>
      {!collapsed && (<>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#0e0e0e' }}>
            <th style={{ ...S.th, textAlign: 'center' }}>IMG</th><th style={{ ...S.th, textAlign: 'center' }}>CANT.</th>
            <th style={S.th}>DESCRIPCIÓN</th><th style={{ ...S.th, textAlign: 'right' }}>PRECIO</th>
            <th style={{ ...S.th, textAlign: 'right' }}>P. AMP.</th><th style={{ ...S.th, textAlign: 'right' }}>M.O.</th>
            <th style={{ ...S.th, textAlign: 'right' }}>TOTAL</th>
            {showInt && (<><th style={{ ...S.th, textAlign: 'right', color: '#555' }}>COSTO</th><th style={{ ...S.th, textAlign: 'right', color: '#555' }}>MG%</th><th style={{ ...S.th, textAlign: 'right', color: '#555' }}>UTIL.</th></>)}
            <th style={S.th}></th>
          </tr></thead>
          <tbody>
            {products.map(p => {
              const dupCount = p.catalogId ? allProducts.filter(ap => ap.catalogId === p.catalogId).length : 0
              return <ProductRow key={p.id} p={p} onUpdate={onUpdate} onRemove={onRemove} onUpdateAll={onUpdateAll} showInt={showInt} duplicateCount={dupCount} />
            })}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px' }}>
          <Btn size="sm" onClick={onAdd}><Plus size={12} /> Producto</Btn>
          <span style={{ fontSize: 10, color: '#555' }}>{sysDef.name.toUpperCase()} TOTAL <span style={{ fontWeight: 700, color: '#fff', marginLeft: 6 }}>${sysTotal.toFixed(2)}</span></span>
        </div>
      </>)}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AREA BLOCK
// ═══════════════════════════════════════════════════════════════════
function AreaBlock({ area, activeSystems, products, allProducts, collapsedSys, onToggleArea, onToggleSys, onUpdateProd, onRemoveProd, onUpdateAll, onAddProd, showInt }: {
  area: EspArea; activeSystems: EspSystemDef[]; products: EspProduct[]; allProducts: EspProduct[]
  collapsedSys: Record<string, boolean>; onToggleArea: () => void; onToggleSys: (k: string) => void
  onUpdateProd: (id: string, f: string, v: number | string) => void; onRemoveProd: (id: string) => void
  onUpdateAll: (catalogId: string, field: string, value: number) => void
  onAddProd: (sysId: string) => void; showInt: boolean
}) {
  const areaProds = products.filter(p => p.areaId === area.id)
  const areaTotal = areaProds.reduce((s, p) => s + calcLine(p).total, 0)
  const sysWithProds = activeSystems.filter(sys => areaProds.some(p => p.systemId === sys.id))
  const sysEmpty = activeSystems.filter(sys => !areaProds.some(p => p.systemId === sys.id))

  return (
    <div style={{ marginBottom: 14 }}>
      <div onClick={onToggleArea} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', background: '#1a1a1a', borderRadius: 10, borderLeft: '3px solid #57FF9A' }}>
        {area.collapsed ? <ChevronRight size={16} color="#57FF9A" /> : <ChevronDown size={16} color="#57FF9A" />}
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', flex: 1, textTransform: 'uppercase' as const }}>{area.name}</span>
        <span style={{ fontSize: 10, color: '#555' }}>{sysWithProds.length} sistemas</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#57FF9A' }}>${areaTotal.toFixed(2)}</span>
      </div>
      {!area.collapsed && (
        <div style={{ paddingLeft: 14, paddingTop: 6 }}>
          {sysWithProds.map(sys => (
            <SystemBlock key={sys.id} sysDef={sys} products={areaProds.filter(p => p.systemId === sys.id)}
              collapsed={collapsedSys[area.id + '_' + sys.id] || false} onToggle={() => onToggleSys(area.id + '_' + sys.id)}
              onUpdate={onUpdateProd} onRemove={onRemoveProd} onUpdateAll={onUpdateAll}
              onAdd={() => onAddProd(sys.id)} showInt={showInt} allProducts={allProducts} />
          ))}
          {sysEmpty.length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', padding: '4px 0' }}>
              {sysEmpty.map(sys => (
                <button key={sys.id} onClick={() => onAddProd(sys.id)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', border: '1px dashed ' + sys.color + '44', background: 'transparent', color: sys.color + '88' }}>+ {sys.name}</button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 12px', borderTop: '1px solid #1e1e1e', marginTop: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#555', marginRight: 12 }}>{area.name.toUpperCase()} TOTAL</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>${areaTotal.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AI IMPORT MODAL — Importar listado de productos con AI
// ═══════════════════════════════════════════════════════════════════
interface AIExtractedItem {
  _rowId: string
  area: string
  systemId: string
  marca: string
  modelo: string
  descripcion: string
  cantidad: number
  precio_unitario: number | null
  moneda: 'USD' | 'MXN' | null
  provider: string
  notas: string
  match_status: 'exact' | 'partial' | 'none'
  catalog_product_id: string | null
}

function AIImportModal({ cotId, areas, activeSysIds, currency, tipoCambio, onClose, onImported }: {
  cotId: string
  areas: EspArea[]
  activeSysIds: string[]
  currency: string
  tipoCambio: number
  onClose: () => void
  onImported: () => void
}) {
  const [step, setStep] = useState<'upload' | 'processing' | 'review' | 'inserting'>('upload')
  const [items, setItems] = useState<AIExtractedItem[]>([])
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
      body: JSON.stringify(body),
    })
    const data = await r.json()
    if (!r.ok || !data.ok) {
      throw new Error(data.error || 'Error en /api/extract (' + r.status + ')')
    }
    return { items: data.items || [], confidence: data.confidence || 'medium', warnings: data.warnings || [] }
  }

  // Carga SheetJS dinámicamente desde CDN si no está cargado ya
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

  // Mapeo de sistemas del archivo (D-Tools usa nombres en español) al systemId interno
  function mapSystemToId(systemName: string): string {
    const s = (systemName || '').toLowerCase().trim()
    if (!s) return 'audio'
    if (s.includes('audio')) return 'audio'
    if (s.includes('red')) return 'redes'
    if (s.includes('cctv') || s.includes('camara') || s.includes('video vigilancia')) return 'cctv'
    if (s.includes('acceso')) return 'control_acceso'
    if (s.includes('ilumin')) return 'control_iluminacion'
    if (s.includes('humo') || s.includes('fire') || s.includes('incendio')) return 'deteccion_humo'
    if (s.includes('bms') || s.includes('automatiz')) return 'bms'
    if (s.includes('telefon')) return 'telefonia'
    if (s.includes('celular') || s.includes('das')) return 'red_celular'
    if (s.includes('cortina') || s.includes('persiana') || s.includes('shade')) return 'cortinas_ctrl'
    return 'audio'
  }

  // Busca una columna por posibles nombres (case-insensitive, primer match gana)
  function findCol(row: any, candidates: string[]): any {
    const keys = Object.keys(row)
    for (const cand of candidates) {
      const hit = keys.find(k => k.toLowerCase().trim() === cand.toLowerCase().trim())
      if (hit && row[hit] != null && String(row[hit]).trim() !== '') return row[hit]
    }
    return null
  }

  // Intenta parsear filas estructuradas (formato D-Tools o similar) sin llamar a AI
  function tryParseStructuredRows(rows: any[]): { items: any[]; confidence: string; warnings: string[] } | null {
    if (!rows || rows.length === 0) return null
    // Verificar que tenga las columnas clave
    const firstRow = rows[0]
    if (!firstRow || typeof firstRow !== 'object') return null
    const keys = Object.keys(firstRow).map(k => k.toLowerCase())
    const hasModel = keys.some(k => k === 'model' || k === 'modelo' || k === 'part number' || k === 'sku')
    const hasSystem = keys.some(k => k === 'system' || k === 'sistema')
    const hasRoom = keys.some(k => k === 'room' || k === 'area' || k === 'área' || k === 'zona')
    if (!hasModel || !hasSystem) return null // no es formato estructurado reconocible

    const items: any[] = []
    const warnings: string[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const model = findCol(row, ['Model', 'Modelo', 'Part Number', 'SKU'])
      if (!model) {
        // fila sin modelo, skip
        continue
      }
      const manufacturer = findCol(row, ['Manufacturer', 'Marca', 'Brand', 'Fabricante']) || ''
      const vendor = findCol(row, ['Vendor', 'Proveedor', 'Supplier', 'Distribuidor']) || ''
      const room = findCol(row, ['Room', 'Area', 'Área', 'Zona', 'Ubicación', 'Location']) || ''
      const system = findCol(row, ['System', 'Sistema']) || ''
      const description = findCol(row, ['Short Description', 'Description', 'Descripción', 'Descripcion', 'Product Description']) || ''
      const qtyRaw = findCol(row, ['Item Ext Qty', 'Item Unit Qty', 'Qty', 'Quantity', 'Cantidad', 'Cant'])
      const qty = qtyRaw != null ? parseFloat(String(qtyRaw)) : 1
      const priceRaw = findCol(row, ['Unit Price', 'Precio Unitario', 'Price', 'Precio', 'Unit Cost', 'Cost'])
      const price = priceRaw != null ? parseFloat(String(priceRaw).replace(/[$,]/g, '')) : null
      const currency = findCol(row, ['Selling Currency', 'Cost Currency', 'Currency', 'Moneda'])
      let moneda: 'USD' | 'MXN' | null = null
      if (currency) {
        const c = String(currency).toUpperCase()
        if (c.includes('USD') || c.includes('DLL') || c === 'US$') moneda = 'USD'
        else if (c.includes('MXN') || c.includes('PESO') || c === 'MX$') moneda = 'MXN'
      }

      items.push({
        area: String(room).trim(),
        systemId: mapSystemToId(String(system)),
        marca: String(manufacturer).trim(),
        modelo: String(model).trim(),
        descripcion: String(description).trim(),
        cantidad: isNaN(qty) ? 1 : Math.max(1, Math.round(qty)),
        precio_unitario: price != null && !isNaN(price) ? price : null,
        moneda,
        provider: String(vendor).trim() || String(manufacturer).trim(),
        notas: '',
      })
    }
    if (items.length === 0) return null
    const skipped = rows.length - items.length
    if (skipped > 0) warnings.push(skipped + ' fila(s) sin modelo fueron omitidas')
    warnings.push('Parseado directamente del Excel (' + items.length + ' items) — sin usar AI')
    return { items, confidence: 'high', warnings }
  }

  // Mismo parser pero partiendo de texto CSV/TSV
  function tryParseStructured(text: string): { items: any[]; confidence: string; warnings: string[] } | null {
    if (!text || text.length < 50) return null
    // Detectar separador: coma o tab
    const firstLine = text.split('\n')[0]
    const sep = firstLine.includes('\t') ? '\t' : ','
    const lines = text.split('\n').filter(l => l.trim().length > 0)
    if (lines.length < 2) return null
    // Parse simple CSV (sin soporte de quotes multiline, suficiente para casos comunes)
    function splitCSV(line: string): string[] {
      const out: string[] = []
      let cur = ''
      let inQuotes = false
      for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (c === '"' && (i === 0 || line[i-1] !== '\\')) {
          inQuotes = !inQuotes
        } else if (c === sep && !inQuotes) {
          out.push(cur)
          cur = ''
        } else {
          cur += c
        }
      }
      out.push(cur)
      return out.map(s => s.trim().replace(/^"|"$/g, ''))
    }
    const headers = splitCSV(lines[0])
    const rows: any[] = []
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCSV(lines[i])
      const row: any = {}
      headers.forEach((h, idx) => { row[h] = cells[idx] || null })
      rows.push(row)
    }
    return tryParseStructuredRows(rows)
  }

  async function handleFile(file: File) {
    setError(null)
    setStep('processing')
    setProgress('Leyendo archivo...')
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase()
      let extracted: { items: any[]; confidence: string; warnings: string[] }

      if (['csv', 'tsv', 'txt'].includes(ext)) {
        const text = await file.text()
        // Intentar detectar formato D-Tools en CSV también
        const dtResult = tryParseStructured(text)
        if (dtResult) {
          extracted = dtResult
        } else {
          setProgress('Analizando con AI...')
          extracted = await callExtractAPI({ kind: 'text', payload: text })
        }
      } else if (['xlsx', 'xls'].includes(ext)) {
        setProgress('Cargando parser de Excel...')
        const XLSX = await loadXLSX()
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        // Tomar la primera hoja con datos — detectando automáticamente la fila de headers
        let rows: any[] = []
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName]
          // Obtener datos como matriz 2D para detectar dónde están los headers
          const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false })
          if (matrix.length === 0) continue
          // Buscar la primera fila que tenga al menos 3 celdas con headers típicos
          const headerKeywords = ['model', 'modelo', 'system', 'sistema', 'room', 'area', 'manufacturer', 'marca', 'part number', 'quantity', 'cantidad', 'description', 'descripcion', 'price', 'precio']
          let headerRowIdx = 0
          for (let i = 0; i < Math.min(matrix.length, 10); i++) {
            const cells = (matrix[i] || []).map((c: any) => String(c || '').toLowerCase().trim())
            const matches = cells.filter((c: string) => headerKeywords.some(kw => c === kw || c.includes(kw))).length
            if (matches >= 3) { headerRowIdx = i; break }
          }
          const headers = (matrix[headerRowIdx] || []).map((h: any, idx: number) => String(h || '').trim() || ('col_' + idx))
          const dataRows: any[] = []
          for (let i = headerRowIdx + 1; i < matrix.length; i++) {
            const row: any = {}
            const cells = matrix[i] || []
            let hasData = false
            headers.forEach((h: string, idx: number) => {
              const v = cells[idx]
              row[h] = v != null && v !== '' ? v : null
              if (v != null && String(v).trim() !== '') hasData = true
            })
            if (hasData) dataRows.push(row)
          }
          if (dataRows.length > rows.length) rows = dataRows
        }
        setProgress('Detectando formato...')
        // Intentar parseo directo primero (D-Tools o similar)
        const structured = tryParseStructuredRows(rows)
        if (structured) {
          extracted = structured
        } else {
          // Fallback a AI con CSV
          setProgress('Analizando con AI...')
          let text = ''
          for (const name of wb.SheetNames) {
            text += '\n=== Hoja: ' + name + ' ===\n'
            text += XLSX.utils.sheet_to_csv(wb.Sheets[name])
          }
          extracted = await callExtractAPI({ kind: 'text', payload: text })
        }
      } else if (ext === 'pdf') {
        setProgress('Codificando PDF...')
        const base64 = await fileToBase64(file)
        setProgress('Analizando PDF con AI...')
        extracted = await callExtractAPI({ kind: 'pdf', payload: base64 })
      } else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        setProgress('Codificando imagen...')
        const base64 = await fileToBase64(file)
        const mediaType = 'image/' + (ext === 'jpg' ? 'jpeg' : ext)
        setProgress('Analizando imagen con AI...')
        extracted = await callExtractAPI({ kind: 'image', payload: base64, mediaType })
      } else {
        throw new Error('Formato no soportado: .' + ext + ' (usa Excel, CSV, PDF o imagen)')
      }

      setProgress('Verificando catálogo...')
      const matched = await matchCatalog(extracted.items)
      setItems(matched)
      setWarnings(extracted.warnings || [])
      setConfidence(extracted.confidence || 'medium')
      setStep('review')
    } catch (err: any) {
      setError(err.message || 'Error procesando archivo')
      setStep('upload')
    }
  }

  async function matchCatalog(rawItems: any[]): Promise<AIExtractedItem[]> {
    const result: AIExtractedItem[] = []
    for (const it of rawItems) {
      const row: AIExtractedItem = {
        _rowId: uid(),
        area: it.area || '',
        systemId: it.systemId || 'audio',
        marca: it.marca || '',
        modelo: it.modelo || '',
        descripcion: it.descripcion || '',
        cantidad: parseInt(it.cantidad) || 1,
        precio_unitario: it.precio_unitario != null ? Number(it.precio_unitario) : null,
        moneda: it.moneda === 'USD' || it.moneda === 'MXN' ? it.moneda : null,
        provider: it.provider || it.marca || '',
        notas: it.notas || '',
        match_status: 'none',
        catalog_product_id: null,
      }
      if (!row.modelo) {
        result.push(row)
        continue
      }
      const { data: exact } = await supabase
        .from('catalog_products')
        .select('id, name, modelo')
        .eq('modelo', row.modelo)
        .limit(5)
      if (exact && exact.length === 1) {
        row.match_status = 'exact'
        row.catalog_product_id = exact[0].id
      } else if (exact && exact.length > 1) {
        row.match_status = 'partial'
        row.catalog_product_id = exact[0].id
      } else {
        const { data: fuzzy } = await supabase
          .from('catalog_products')
          .select('id, name, modelo')
          .ilike('modelo', '%' + row.modelo + '%')
          .limit(5)
        if (fuzzy && fuzzy.length > 0) {
          row.match_status = 'partial'
          row.catalog_product_id = fuzzy[0].id
        }
      }
      result.push(row)
    }
    return result
  }

  function updateRow(rowId: string, field: keyof AIExtractedItem, value: any) {
    setItems(prev => prev.map(it => it._rowId === rowId ? { ...it, [field]: value } : it))
  }

  function removeRow(rowId: string) {
    setItems(prev => prev.filter(it => it._rowId !== rowId))
  }

  function convertToQuoteCurrency(amount: number, productCurrency: string): number {
    if (productCurrency === currency) return amount
    if (productCurrency === 'USD' && currency === 'MXN') return Math.round(amount * tipoCambio * 100) / 100
    if (productCurrency === 'MXN' && currency === 'USD') return Math.round(amount / tipoCambio * 100) / 100
    return amount
  }

  async function handleConfirm() {
    setStep('inserting')
    setError(null)
    setInsertedCount(0)
    try {
      // 1) Sincronizar áreas — crear las que falten
      setProgress('Sincronizando áreas...')
      const areaCache: Record<string, string> = {}
      areas.forEach(a => { areaCache[a.name.toLowerCase().trim()] = a.id })
      const uniqueAreaNames = Array.from(new Set(items.map(it => (it.area || 'General').trim()).filter(Boolean)))
      let nextOrder = areas.length
      for (const name of uniqueAreaNames) {
        const key = name.toLowerCase()
        if (areaCache[key]) continue
        const { data: newArea, error: areaErr } = await supabase
          .from('quotation_areas')
          .insert({ quotation_id: cotId, name, order_index: nextOrder++, subtotal: 0 })
          .select()
          .single()
        if (areaErr) throw new Error('Error creando área "' + name + '": ' + areaErr.message)
        if (newArea) areaCache[key] = newArea.id
      }

      // 2) Procesar cada item
      setProgress('Procesando productos...')
      let inserted = 0
      for (const it of items) {
        if (!it.modelo) continue
        let catalogProductId = it.catalog_product_id
        let prodCost = 0
        let prodMoneda: string = it.moneda || 'USD'
        let prodProvider = it.provider || it.marca || ''

        if (!catalogProductId) {
          // Crear producto en catálogo
          const sysName = ALL_SYSTEMS.find(s => s.id === it.systemId)?.name || 'Audio'
          const newProductCost = it.precio_unitario || 0
          const newProductMoneda = it.moneda || 'USD'
          const ruleNew = getPricingRule(prodProvider)
          const precioVenta = ruleNew.precioPublico ? newProductCost : calcPriceFromCost(newProductCost, ruleNew)
          const productName = it.descripcion || ((it.marca + ' ' + it.modelo).trim())
          const { data: newProd, error: prodErr } = await supabase
            .from('catalog_products')
            .insert({
              name: productName,
              description: it.descripcion || null,
              system: sysName,
              type: 'material',
              unit: 'pza',
              cost: newProductCost,
              markup: ruleNew.precioPublico ? 0 : ruleNew.margen,
              precio_venta: precioVenta,
              provider: prodProvider || null,
              marca: it.marca || null,
              modelo: it.modelo,
              moneda: newProductMoneda,
              clave_unidad: 'H87',
              iva_rate: 0.16,
              is_active: true,
              purchase_phase: 'inicio',
            })
            .select()
            .single()
          if (prodErr) {
            console.error('Error creando producto:', prodErr, it)
            continue
          }
          if (newProd) {
            catalogProductId = newProd.id
            prodCost = newProductCost
            prodMoneda = newProductMoneda
          }
        } else {
          const { data: existing } = await supabase
            .from('catalog_products')
            .select('cost, moneda, provider, markup')
            .eq('id', catalogProductId)
            .single()
          if (existing) {
            prodCost = Number(existing.cost) || 0
            prodMoneda = existing.moneda || 'USD'
            if (existing.provider) prodProvider = existing.provider
          }
        }

        // Calcular precio aplicando pricing rule
        const rule = getPricingRule(prodProvider)
        let precioOrigen: number
        if (rule.precioPublico) {
          precioOrigen = it.precio_unitario || (prodCost > 0 ? Math.round(prodCost * 1.30) : 0)
        } else {
          precioOrigen = calcPriceFromCost(prodCost || it.precio_unitario || 0, rule)
        }
        const precio = convertToQuoteCurrency(precioOrigen, prodMoneda)
        const margin = rule.precioPublico ? 30 : rule.margen
        const laborCost = calcLaborFromPrice(precio, rule)
        const sysName = ALL_SYSTEMS.find(s => s.id === it.systemId)?.name || 'Audio'
        const areaId = areaCache[(it.area || 'General').toLowerCase().trim()]
        if (!areaId) {
          console.warn('Sin área para item', it)
          continue
        }
        const itemName = it.descripcion || ((it.marca + ' ' + it.modelo).trim())

        const { error: itemErr } = await supabase.from('quotation_items').insert({
          quotation_id: cotId,
          area_id: areaId,
          catalog_product_id: catalogProductId,
          name: itemName,
          description: it.descripcion || null,
          system: sysName,
          type: 'material',
          quantity: it.cantidad,
          cost: prodCost,
          markup: margin,
          price: precio,
          total: (precio + laborCost) * it.cantidad,
          installation_cost: laborCost,
          order_index: inserted,
        })
        if (itemErr) {
          console.error('Error insertando item:', itemErr, it)
          continue
        }
        inserted++
        setInsertedCount(inserted)
      }

      // 3) Activar sistemas que no estaban activos
      const usedSystems = Array.from(new Set(items.map(it => it.systemId).filter(Boolean)))
      const newActiveSystems = Array.from(new Set([...activeSysIds, ...usedSystems]))
      if (newActiveSystems.length !== activeSysIds.length) {
        const { data: cot } = await supabase.from('quotations').select('notes').eq('id', cotId).single()
        let meta: any = {}
        try { meta = JSON.parse(cot?.notes || '{}') } catch {}
        meta.systems = newActiveSystems
        await supabase.from('quotations').update({ notes: JSON.stringify(meta) }).eq('id', cotId)
      }

      onImported()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Error en la importación')
      setStep('review')
    }
  }

  const exactCount = items.filter(i => i.match_status === 'exact').length
  const partialCount = items.filter(i => i.match_status === 'partial').length
  const noneCount = items.filter(i => i.match_status === 'none').length

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1030 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 20, width: '92vw', maxWidth: 1200, maxHeight: '92vh', display: 'flex', flexDirection: 'column' as const }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={14} color="#57FF9A" /> Importar con AI
            </div>
            <div style={{ fontSize: 11, color: '#555' }}>Sube un listado en Excel, CSV, PDF o imagen — la AI extrae los productos</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {error && (
          <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: 10, color: '#f87171', fontSize: 12, marginBottom: 12 }}>{error}</div>
        )}

        {step === 'upload' && (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            onDragOver={e => e.preventDefault()}
            style={{ border: '2px dashed #333', borderRadius: 12, padding: '60px 20px', textAlign: 'center', cursor: 'pointer', color: '#666' }}
          >
            <Upload size={36} color="#444" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: '#ccc', marginBottom: 6 }}>Arrastra un archivo o haz clic</div>
            <div style={{ fontSize: 11, color: '#555' }}>Excel (.xlsx, .csv, .tsv), PDF, imagen (JPG, PNG, WEBP)</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.txt,.pdf,.jpg,.jpeg,.png,.webp,.gif"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
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

        {step === 'review' && (
          <>
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
                    <th style={{ ...S.th, textAlign: 'left' }}>Área</th>
                    <th style={{ ...S.th, textAlign: 'left' }}>Sistema</th>
                    <th style={{ ...S.th, textAlign: 'left' }}>Marca</th>
                    <th style={{ ...S.th, textAlign: 'left' }}>Modelo</th>
                    <th style={{ ...S.th, textAlign: 'left' }}>Descripción</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Cant</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Precio</th>
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
                        <input value={it.area} onChange={e => updateRow(it._rowId, 'area', e.target.value)}
                          style={{ width: 110, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }} />
                      </td>
                      <td style={S.td}>
                        <select value={it.systemId} onChange={e => updateRow(it._rowId, 'systemId', e.target.value)}
                          style={{ padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }}>
                          {ALL_SYSTEMS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </td>
                      <td style={S.td}>
                        <input value={it.marca} onChange={e => updateRow(it._rowId, 'marca', e.target.value)}
                          style={{ width: 90, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }} />
                      </td>
                      <td style={S.td}>
                        <input value={it.modelo} onChange={e => updateRow(it._rowId, 'modelo', e.target.value)}
                          style={{ width: 110, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }} />
                      </td>
                      <td style={S.td}>
                        <input value={it.descripcion} onChange={e => updateRow(it._rowId, 'descripcion', e.target.value)}
                          style={{ width: 180, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }} />
                      </td>
                      <td style={S.tdR}>
                        <input type="number" value={it.cantidad} onChange={e => updateRow(it._rowId, 'cantidad', parseInt(e.target.value) || 1)}
                          style={{ width: 50, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} />
                      </td>
                      <td style={S.tdR}>
                        <input type="number" step={0.01} value={it.precio_unitario ?? ''} onChange={e => updateRow(it._rowId, 'precio_unitario', e.target.value ? parseFloat(e.target.value) : null)}
                          style={{ width: 75, padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} />
                      </td>
                      <td style={S.td}>
                        <select value={it.moneda || ''} onChange={e => updateRow(it._rowId, 'moneda', (e.target.value || null) as any)}
                          style={{ padding: '4px 6px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit' }}>
                          <option value="">—</option>
                          <option value="USD">USD</option>
                          <option value="MXN">MXN</option>
                        </select>
                      </td>
                      <td style={{ ...S.td, width: 28 }}>
                        <button onClick={() => removeRow(it._rowId)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><X size={12} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <Btn onClick={onClose}>Cancelar</Btn>
              <Btn variant="primary" onClick={handleConfirm} disabled={items.length === 0}>
                Importar {items.length} items a la cotización
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CATALOG SEARCH + CREATE PRODUCT MODAL
// ═══════════════════════════════════════════════════════════════════
function CatalogModal({ onClose, onSelect, onCreateNew, systemName }: {
  onClose: () => void; onSelect: (p: CatProduct) => void; onCreateNew: () => void; systemName: string
}) {
  const [catalog, setCatalog] = useState<CatProduct[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('catalog_products').select('*').eq('is_active', true).order('name')
      .then(({ data }) => { setCatalog(data || []); setLoading(false) })
  }, [])

  const filtered = search.length >= 2
    ? catalog.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.description || '').toLowerCase().includes(search.toLowerCase()))
    : catalog

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 20, width: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column' as const }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Agregar producto — {systemName}</div>
            <div style={{ fontSize: 11, color: '#555' }}>Busca en el catálogo o crea uno nuevo</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#444' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto..."
              style={{ width: '100%', padding: '8px 10px 8px 30px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit' }} autoFocus />
          </div>
          <Btn variant="primary" onClick={onCreateNew}><Plus size={14} /> Crear nuevo</Btn>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? <Loading /> : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 20px', color: '#444', fontSize: 13 }}>
              {search ? 'Sin resultados — ' : 'Catálogo vacío — '}
              <button onClick={onCreateNew} style={{ background: 'none', border: 'none', color: '#57FF9A', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, textDecoration: 'underline' }}>Crear producto nuevo</button>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#1a1a1a' }}>
                <th style={{ ...S.th, textAlign: 'left' }}>Producto</th>
                <th style={{ ...S.th }}>Sistema</th>
                <th style={{ ...S.th }}>Proveedor</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Costo</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Precio</th>
                <th style={S.th}></th>
              </tr></thead>
              <tbody>
                {filtered.slice(0, 50).map(p => {
                  const precio = Math.round(p.cost * (1 + p.markup / 100))
                  return (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(p)}
                      onMouseEnter={e => { e.currentTarget.style.background = '#1a1a1a' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      <td style={{ ...S.td }}><div style={{ fontWeight: 500, color: '#ddd' }}>{p.name}</div>{p.description && <div style={{ fontSize: 10, color: '#555' }}>{p.description}</div>}</td>
                      <td style={{ ...S.td, fontSize: 10, color: '#666' }}>{p.system || '--'}</td>
                      <td style={{ ...S.td, fontSize: 10, color: '#666' }}>{p.provider || '--'}</td>
                      <td style={{ ...S.tdR, fontSize: 10, color: '#555' }}>${p.cost.toFixed(2)}</td>
                      <td style={{ ...S.tdR, fontWeight: 600, color: '#57FF9A' }}>${precio}</td>
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
// CREATE NEW PRODUCT WITH AI SEARCH
// ═══════════════════════════════════════════════════════════════════
function CreateProductModal({ onClose, onCreate, systemName }: {
  onClose: () => void; onCreate: (p: CatProduct) => void; systemName: string
}) {
  const [form, setForm] = useState({
    name: '', description: '', system: systemName, cost: 0, markup: 30, provider: '', unit: 'pza',
    marca: '', modelo: '', sku: '', clave_prod_serv: '', clave_unidad: 'H87', moneda: 'USD', purchase_phase: 'inicio',
  })
  const [saving, setSaving] = useState(false)
  const [aiQuery, setAiQuery] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiStatus, setAiStatus] = useState('')
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    supabase.from('suppliers').select('id,name').eq('is_active', true).order('name')
      .then(({ data }) => setSuppliers(data || []))
  }, [])

  async function searchWithAI() {
    const query = aiQuery || form.name
    if (!query.trim()) return
    setAiLoading(true)
    setAiStatus('Buscando información del producto...')

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
          'anthropic-version': '2023-06-01',
          'x-api-key': ANTHROPIC_API_KEY,
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{
            role: 'user',
            content: `Search for this product and return ONLY a JSON object with no other text:
"${query}"

Return this exact JSON format:
{
  "name": "Full official product name",
  "description": "Brief technical description in Spanish, max 100 chars",
  "provider": "Brand/Manufacturer name",
  "marca": "Brand name (e.g. Ubiquiti, Sonos, Lutron, Hikvision)",
  "modelo": "Model number/name",
  "sku": "SKU or part number if found",
  "clave_prod_serv": "Mexican SAT product code (6-8 digits). Use these common ones: 43222600 for networking/WiFi, 46171600 for CCTV/cameras, 52161500 for audio/speakers, 39121700 for lighting control, 46171500 for access control, 43222500 for switches/routers",
  "system": "One of: Audio, Redes, CCTV, Control de Acceso, Control de Iluminación"
}

IMPORTANT: Do NOT include cost or price. Return ONLY valid JSON, no markdown.`
          }],
        }),
      })

      if (!response.ok) {
        setAiStatus('Error API (' + response.status + ')')
        setAiLoading(false)
        return
      }

      const data = await response.json()
      setAiStatus('Procesando resultados...')

      const textBlocks = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text)
      const fullText = textBlocks.join('\n')
      const jsonMatch = fullText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const clean = jsonMatch[0].replace(/```json|```/g, '').trim()
        const parsed = JSON.parse(clean)
        const aiProvider = parsed.provider || parsed.marca || ''
        const matchedSupplier = suppliers.find(s => s.name.toLowerCase().includes(aiProvider.toLowerCase()) || aiProvider.toLowerCase().includes(s.name.toLowerCase()))
        const aiSystem = parsed.system || ''
        const matchedSystem = ALL_SYSTEMS.find(s => s.name.toLowerCase().includes(aiSystem.toLowerCase()) || aiSystem.toLowerCase().includes(s.name.toLowerCase()))
        setForm(f => ({
          ...f,
          name: parsed.name || f.name,
          description: parsed.description || f.description,
          provider: matchedSupplier ? matchedSupplier.name : f.provider,
          system: matchedSystem ? matchedSystem.name : f.system,
          marca: parsed.marca || f.marca,
          modelo: parsed.modelo || f.modelo,
          sku: parsed.sku || f.sku,
          clave_prod_serv: parsed.clave_prod_serv || f.clave_prod_serv,
        }))
        setAiStatus('✓ Producto encontrado')
      } else {
        setAiStatus('No se encontró información estructurada')
      }
    } catch (err) {
      setAiStatus('Error en la búsqueda — llena manualmente')
    }
    setAiLoading(false)
  }

  async function save() {
    if (!form.name) return
    setSaving(true)
    const rule = getPricingRule(form.provider)
    const precioVenta = rule.precioPublico ? form.cost : calcPriceFromCost(form.cost, rule)
    const { data, error } = await supabase.from('catalog_products').insert({
      name: form.name,
      description: form.description || null,
      system: form.system || null,
      type: 'material',
      unit: form.unit || 'pza',
      cost: form.cost,
      markup: form.markup,
      precio_venta: precioVenta,
      provider: form.provider || null,
      marca: form.marca || null,
      modelo: form.modelo || null,
      sku: form.sku || null,
      clave_prod_serv: form.clave_prod_serv || null,
      clave_unidad: form.clave_unidad || 'H87',
      moneda: form.moneda || 'USD',
      iva_rate: 0.16,
      is_active: true,
      purchase_phase: form.purchase_phase || 'inicio',
    }).select().single()
    if (error) {
      console.error('Error creating product:', error)
      onCreate({ id: '', name: form.name, description: form.description, system: form.system, cost: form.cost, markup: form.markup, provider: form.provider, unit: form.unit })
    } else if (data) {
      onCreate(data)
    }
    setSaving(false)
  }

  const inp = (label: string, value: string | number, key: string, type = 'text') => (
    <label style={{ fontSize: 10, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block' }}>
      {label}
      <input type={type} value={value} onChange={e => setForm(f => ({ ...f, [key]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))}
        style={{ display: 'block', width: '100%', marginTop: 3, padding: '7px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit' }} />
    </label>
  )

  const selStyle = { display: 'block' as const, width: '100%', marginTop: 3, padding: '7px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1010 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 600, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Nuevo producto — {systemName}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        {/* AI Search bar */}
        <div style={{ background: '#0e0e0e', border: '1px solid #222', borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>🔍 Búsqueda con AI</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={aiQuery} onChange={e => setAiQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchWithAI()}
              placeholder="Escribe modelo o nombre del producto..."
              style={{ flex: 1, padding: '8px 10px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit' }} />
            <Btn variant="primary" onClick={searchWithAI} disabled={aiLoading}>{aiLoading ? '⏳ Buscando...' : '🔍 Buscar'}</Btn>
          </div>
          {aiStatus && <div style={{ marginTop: 6, fontSize: 11, color: aiStatus.startsWith('✓') ? '#57FF9A' : aiStatus.startsWith('Error') ? '#EF4444' : '#888' }}>{aiStatus}</div>}
        </div>

        {/* Form fields */}
        <div style={{ display: 'grid', gap: 10 }}>
          {inp('Nombre', form.name, 'name')}
          {inp('Descripción', form.description, 'description')}

          {/* Marca, Modelo, SKU */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {inp('Marca', form.marca, 'marca')}
            {inp('Modelo', form.modelo, 'modelo')}
            {inp('SKU', form.sku, 'sku')}
          </div>

          {/* Clave SAT, Unidad SAT, Fase */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {inp('Clave SAT (ClaveProdServ)', form.clave_prod_serv, 'clave_prod_serv')}
            <label style={{ fontSize: 10, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block' }}>
              Unidad SAT
              <select value={form.clave_unidad} onChange={e => setForm(f => ({ ...f, clave_unidad: e.target.value }))} style={selStyle}>
                <option value="H87">Pieza (H87)</option>
                <option value="E48">Servicio (E48)</option>
                <option value="MTR">Metro (MTR)</option>
                <option value="KGM">Kilogramo (KGM)</option>
              </select>
            </label>
            <label style={{ fontSize: 10, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block' }}>
              Fase de compra
              <select value={form.purchase_phase} onChange={e => setForm(f => ({ ...f, purchase_phase: e.target.value }))} style={selStyle}>
                <option value="inicio">Inicio</option>
                <option value="roughin">Rough-in</option>
                <option value="acabados">Acabados</option>
                <option value="cierre">Cierre</option>
              </select>
            </label>
          </div>

          {/* Proveedor y Sistema */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ fontSize: 10, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block' }}>
              Proveedor
              <select value={form.provider} onChange={e => {
                const prov = e.target.value
                const rule = getPricingRule(prov)
                setForm(f => ({ ...f, provider: prov, markup: rule.precioPublico ? f.markup : rule.margen }))
              }} style={selStyle}>
                <option value="">-- Seleccionar --</option>
                {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 10, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block' }}>
              Sistema
              <select value={form.system} onChange={e => setForm(f => ({ ...f, system: e.target.value }))} style={selStyle}>
                {ALL_SYSTEMS.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </label>
          </div>

          {/* Pricing rule */}
          {form.provider && (() => {
            const rule = getPricingRule(form.provider)
            return (
              <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 16, fontSize: 10, color: '#666' }}>
                <span>Costo: ×{rule.costoMult}</span>
                <span>Margen: {rule.precioPublico ? 'Precio público' : rule.margen + '%'}</span>
                <span>Inst: {rule.instPct}%</span>
                <span>Desc máx: {rule.descMax}%</span>
              </div>
            )
          })()}

          {/* Pricing */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {inp('Costo de lista USD', form.cost, 'cost', 'number')}
            {inp('Margen %', form.markup, 'markup', 'number')}
          </div>

          {/* Preview */}
          {form.cost > 0 && form.provider && (() => {
            const rule = getPricingRule(form.provider)
            const costoReal = form.cost * rule.costoMult
            const precioVenta = rule.precioPublico ? form.cost : calcPriceFromCost(form.cost, rule)
            const labor = calcLaborFromPrice(precioVenta, rule)
            return (
              <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 11 }}>
                  <div><span style={{ color: '#555' }}>Costo real</span><br /><span style={{ color: '#ccc', fontWeight: 600 }}>${costoReal.toFixed(2)}</span></div>
                  <div><span style={{ color: '#555' }}>Precio venta</span><br /><span style={{ color: '#57FF9A', fontWeight: 700, fontSize: 14 }}>{rule.precioPublico ? 'Precio público' : '$' + precioVenta.toFixed(2)}</span></div>
                  <div><span style={{ color: '#555' }}>Inst + Prog ({rule.instPct}%)</span><br /><span style={{ color: '#ccc', fontWeight: 600 }}>${labor.toFixed(2)}</span></div>
                </div>
              </div>
            )
          })()}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={save} disabled={!form.name || saving}>{saving ? 'Guardando...' : 'Crear y agregar'}</Btn>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY PANEL
// ═══════════════════════════════════════════════════════════════════
function SummaryPanel({ products, areas, config, activeSystems, showInt, onConfigChange }: {
  products: EspProduct[]; areas: EspArea[]; config: EspQuoteConfig; activeSystems: EspSystemDef[]; showInt: boolean
  onConfigChange: (f: string, v: number) => void
}) {
  let eqTotal = 0, inst = 0
  products.forEach(p => { eqTotal += p.price * p.quantity; inst += p.laborCost * p.quantity })
  const moTotal = inst + config.programacion
  const sub = eqTotal + moTotal
  const iva = sub * (config.ivaRate / 100)
  const total = sub + iva

  const rows = [
    { l: 'EQUIPO TOTAL', v: eqTotal, b: true }, { l: 'INSTALACIÓN', v: inst },
    { l: 'PROGRAMACIÓN', v: config.programacion, ed: true }, { l: 'MANO DE OBRA TOTAL', v: moTotal, b: true },
    { l: 'SUBTOTAL', v: sub, b: true }, { l: 'TOTAL IVA', v: iva },
    { l: 'TOTAL DEL PROYECTO', v: total, b: true, h: true },
  ]
  return (
    <div>
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Resumen</div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderTop: r.b ? '1px solid #222' : 'none' }}>
            <span style={{ fontSize: 10, color: r.h ? '#57FF9A' : r.b ? '#ccc' : '#555', fontWeight: r.b ? 700 : 400 }}>{r.l}</span>
            {r.ed ? <input type="number" value={r.v} step={10} onChange={e => onConfigChange('programacion', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: 70, fontSize: 11, fontWeight: 600 }} />
              : <span style={{ fontSize: r.h ? 15 : 11, fontWeight: r.b ? 700 : 400, color: r.h ? '#57FF9A' : '#fff' }}>${r.v.toFixed(2)}</span>}
          </div>
        ))}
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #222' }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: '#444', textTransform: 'uppercase', marginBottom: 4 }}>Multivencimiento</div>
          {config.paymentSchedule.map((ps, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}>
              <span style={{ color: '#666' }}>{ps.percentage}% {ps.label}</span>
              <span style={{ color: '#aaa' }}>${(total * ps.percentage / 100).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Por Área</div>
        {areas.map(a => {
          const t = products.filter(p => p.areaId === a.id).reduce((s, p) => s + calcLine(p).total, 0)
          return <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>{a.name}</span><span style={{ color: '#ccc', fontWeight: 500 }}>${t.toFixed(2)}</span></div>
        })}
      </div>
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Por Sistema</div>
        {activeSystems.map(sys => {
          const t = products.filter(p => p.systemId === sys.id).reduce((s, p) => s + calcLine(p).total, 0)
          return <div key={sys.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: sys.color }}>{sys.name}</span><span style={{ color: '#ccc', fontWeight: 500 }}>${t.toFixed(2)}</span></div>
        })}
      </div>
      {showInt && (
        <div style={{ background: '#1a1414', border: '1px solid #332222', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Análisis Interno</div>
          {(() => {
            let vt = 0, ct = 0; products.forEach(p => { vt += p.price * p.quantity; ct += p.price * (1 - p.margin / 100) * p.quantity })
            const mg = vt > 0 ? Math.round((vt - ct) / vt * 100) : 0
            return (<>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>Venta</span><span style={{ color: '#fff', fontWeight: 600 }}>${vt.toFixed(2)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>Costo</span><span style={{ color: '#ccc' }}>${ct.toFixed(2)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10, borderTop: '1px solid #332222', marginTop: 3, paddingTop: 5 }}>
                <span style={{ color: '#F59E0B', fontWeight: 600 }}>Margen</span>
                <span style={{ color: mg >= 25 ? '#57FF9A' : mg >= 15 ? '#F59E0B' : '#EF4444', fontWeight: 700, fontSize: 13 }}>{mg}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>Utilidad</span><span style={{ color: '#57FF9A', fontWeight: 600 }}>${(vt - ct).toFixed(2)}</span></div>
            </>)
          })()}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function CotEditorESP({ cotId, onBack }: { cotId: string; onBack: () => void }) {
  const [areas, setAreas] = useState<EspArea[]>([])
  const [activeSysIds, setActiveSysIds] = useState<string[]>([])
  const [products, setProducts] = useState<EspProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<EspQuoteConfig>({ currency: 'USD', ivaRate: 16, programacion: 0, tipoCambio: 20.5, paymentSchedule: [{ label: 'Anticipo', percentage: 80 }, { label: 'Entrega de equipos', percentage: 10 }, { label: 'Finalización de Obra', percentage: 10 }], version: '1.0' })
  const [showInt, setShowInt] = useState(true)
  const [stage, setStage] = useState('oportunidad')
  const [collapsedSys, setCollapsedSys] = useState<Record<string, boolean>>({})
  const [showSystemPicker, setShowSystemPicker] = useState(false)
  const [cotName, setCotName] = useState('')
  const [clientName, setClientName] = useState('')
  const [addingTo, setAddingTo] = useState<{ areaId: string; systemId: string } | null>(null)
  const [creatingProduct, setCreatingProduct] = useState(false)
  const [showEditCot, setShowEditCot] = useState(false)
  const [showAIImport, setShowAIImport] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')

  async function load() {
    const [{ data: cot }, { data: qAreas }, { data: qItems }] = await Promise.all([
      supabase.from('quotations').select('*,project:projects(name,client_name)').eq('id', cotId).single(),
      supabase.from('quotation_areas').select('*').eq('quotation_id', cotId).order('order_index'),
      supabase.from('quotation_items').select('*').eq('quotation_id', cotId).order('order_index'),
    ])
    if (cot) {
      setCotName(cot.name || ''); setClientName(cot.client_name || ''); setStage(cot.stage || 'oportunidad')
      setProjectId(cot.project_id || null)
      const proj = cot.project as any
      setProjectName(proj?.name || '')
      try {
        const meta = JSON.parse(cot.notes || '{}')
        if (meta.systems) setActiveSysIds(meta.systems)
        if (meta.currency || meta.tipoCambio) {
          setConfig(c => ({ ...c, currency: meta.currency || c.currency, tipoCambio: meta.tipoCambio || c.tipoCambio }))
        }
      } catch (e) { /* ignore */ }
    }
    if (qAreas && qAreas.length > 0) setAreas(qAreas.map((a: any, i: number) => ({ id: a.id, name: a.name, collapsed: false, order: i })))
    else setAreas([])
    if (qItems && qItems.length > 0) {
      setProducts(qItems.map((it: any) => ({
        id: it.id, areaId: it.area_id, systemId: (it.system || '').toLowerCase().replace(/ /g, '_'),
        catalogId: it.catalog_product_id || null, name: it.name, description: it.description || '',
        imageUrl: null, quantity: it.quantity, price: it.price || 0,
        laborCost: it.installation_cost || 0, margin: it.markup || 30, order: it.order_index || 0,
        monedaOrigen: it.provider_currency || 'USD',
      })))
    } else {
      setProducts([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [cotId])

  const activeSystems = useMemo(() => ALL_SYSTEMS.filter(s => activeSysIds.includes(s.id)), [activeSysIds])
  const total = useMemo(() => {
    let eq = 0, mo = 0; products.forEach(p => { eq += p.price * p.quantity; mo += p.laborCost * p.quantity })
    const sub = eq + mo + config.programacion; return sub + sub * config.ivaRate / 100
  }, [products, config])

  // Sync total to quotations table whenever it changes
  useEffect(() => {
    if (!loading && cotId) {
      supabase.from('quotations').update({ total: Math.round(total * 100) / 100 }).eq('id', cotId)
    }
  }, [total, loading])

  function toggleArea(id: string) { setAreas(p => p.map(a => a.id === id ? { ...a, collapsed: !a.collapsed } : a)) }
  function toggleSys(k: string) { setCollapsedSys(p => ({ ...p, [k]: !p[k] })) }
  function addArea() { const n = prompt('Nombre del área:'); if (n) setAreas(p => [...p, { id: uid(), name: n, collapsed: false, order: p.length }]) }

  function saveNotes(overrides?: Partial<{ systems: string[]; currency: string; tipoCambio: number }>) {
    const data = { systems: overrides?.systems ?? activeSysIds, currency: overrides?.currency ?? config.currency, tipoCambio: overrides?.tipoCambio ?? config.tipoCambio }
    supabase.from('quotations').update({ notes: JSON.stringify(data) }).eq('id', cotId)
  }

  function toggleGlobalSystem(sysId: string) {
    const next = activeSysIds.includes(sysId) ? activeSysIds.filter(s => s !== sysId) : [...activeSysIds, sysId]
    setActiveSysIds(next)
    saveNotes({ systems: next })
  }

  function updateConfig(field: string, value: number) {
    setConfig(prev => ({ ...prev, [field]: value }))
    if (field === 'tipoCambio') saveNotes({ tipoCambio: value })
  }

  // Map EspProduct field to quotation_items column
  function fieldToColumn(field: string): string {
    if (field === 'laborCost') return 'installation_cost'
    if (field === 'margin') return 'markup'
    return field
  }

  function updateProduct(id: string, field: string, value: number | string) {
    setProducts(p => p.map(pr => {
      if (pr.id !== id) return pr
      return { ...pr, [field]: value }
    }))
    const col = fieldToColumn(field)
    const updateData: any = { [col]: value }
    if (field === 'price' || field === 'quantity' || field === 'laborCost') {
      // Recalculate total
      const prod = products.find(pr => pr.id === id)
      if (prod) {
        const p = field === 'price' ? (value as number) : prod.price
        const q = field === 'quantity' ? (value as number) : prod.quantity
        const l = field === 'laborCost' ? (value as number) : prod.laborCost
        updateData.total = (p + l) * q
      }
    }
    supabase.from('quotation_items').update(updateData).eq('id', id).then(() => {})
  }

  function updateAllByCatalogId(catalogId: string, field: string, value: number) {
    const ids: string[] = []
    setProducts(p => p.map(pr => {
      if (pr.catalogId !== catalogId) return pr
      ids.push(pr.id)
      return { ...pr, [field]: value }
    }))
    const col = fieldToColumn(field)
    ids.forEach(id => supabase.from('quotation_items').update({ [col]: value }).eq('id', id).then(() => {}))
  }

  function removeProduct(id: string) {
    setProducts(p => p.filter(pr => pr.id !== id))
    supabase.from('quotation_items').delete().eq('id', id).then(() => {})
  }

  // Convert price from product currency to quotation currency
  function convertToQuoteCurrency(amount: number, productCurrency: string): number {
    if (productCurrency === config.currency) return amount
    if (productCurrency === 'USD' && config.currency === 'MXN') return Math.round(amount * config.tipoCambio * 100) / 100
    if (productCurrency === 'MXN' && config.currency === 'USD') return Math.round(amount / config.tipoCambio * 100) / 100
    return amount
  }

  async function handleAddFromCatalog(catProd: CatProduct) {
    if (!addingTo) return
    const rule = getPricingRule(catProd.provider || '')
    const prodMoneda = catProd.moneda || 'USD'
    let precioOrigen = rule.precioPublico
      ? Math.round(catProd.cost * (1 + catProd.markup / 100))
      : calcPriceFromCost(catProd.cost, rule)
    // Convert to quote currency
    const precio = convertToQuoteCurrency(precioOrigen, prodMoneda)
    const margin = rule.precioPublico ? (catProd.markup > 0 ? Math.round(catProd.markup / (100 + catProd.markup) * 100) : 30) : rule.margen
    const laborCost = calcLaborFromPrice(precio, rule)
    const sysName = ALL_SYSTEMS.find(s => s.id === addingTo.systemId)?.name || addingTo.systemId
    const { data } = await supabase.from('quotation_items').insert({
      quotation_id: cotId, area_id: addingTo.areaId, catalog_product_id: catProd.id || null,
      name: catProd.name, description: catProd.description || null, system: sysName,
      type: 'material', quantity: 1, cost: catProd.cost, markup: margin, price: precio,
      total: precio + laborCost, installation_cost: laborCost,
      order_index: products.filter(p => p.areaId === addingTo.areaId && p.systemId === addingTo.systemId).length,
    }).select().single()
    if (data) {
      setProducts(p => [...p, {
        id: data.id, areaId: addingTo.areaId, systemId: addingTo.systemId, catalogId: catProd.id || null,
        name: catProd.name, description: catProd.description || '', imageUrl: null,
        quantity: 1, price: precio, laborCost, margin, order: products.length,
        monedaOrigen: prodMoneda,
      }])
    }
    setAddingTo(null)
  }

  async function handleCreateAndAdd(catProd: CatProduct) {
    if (!addingTo) return
    const rule = getPricingRule(catProd.provider || '')
    const prodMoneda = catProd.moneda || 'USD'
    let precioOrigen = rule.precioPublico
      ? (catProd.cost > 0 ? Math.round(catProd.cost * (1 + catProd.markup / 100)) : 0)
      : calcPriceFromCost(catProd.cost, rule)
    const precio = convertToQuoteCurrency(precioOrigen, prodMoneda)
    const margin = rule.precioPublico ? (catProd.markup > 0 ? Math.round(catProd.markup / (100 + catProd.markup) * 100) : 30) : rule.margen
    const laborCost = calcLaborFromPrice(precio, rule)
    const sysName = ALL_SYSTEMS.find(s => s.id === addingTo.systemId)?.name || addingTo.systemId
    const { data } = await supabase.from('quotation_items').insert({
      quotation_id: cotId, area_id: addingTo.areaId, catalog_product_id: catProd.id || null,
      name: catProd.name, description: catProd.description || null, system: sysName,
      type: 'material', quantity: 1, cost: catProd.cost, markup: margin, price: precio,
      total: precio + laborCost, installation_cost: laborCost,
      order_index: products.filter(p => p.areaId === addingTo.areaId && p.systemId === addingTo.systemId).length,
    }).select().single()
    if (data) {
      setProducts(p => [...p, {
        id: data.id, areaId: addingTo.areaId, systemId: addingTo.systemId, catalogId: catProd.id || null,
        name: catProd.name, description: catProd.description || '', imageUrl: null,
        quantity: 1, price: precio, laborCost, margin, order: products.length,
        monedaOrigen: prodMoneda,
      }])
    }
    setCreatingProduct(false)
    setAddingTo(null)
  }

  function openAddProduct(areaId: string, systemId: string) { setAddingTo({ areaId, systemId }) }

  if (loading) return <Loading />

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ padding: '7px 16px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: '#111' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><ChevronLeft size={14} /> Cotizaciones</button>
        <span style={{ color: '#333' }}>/</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#57FF9A', cursor: 'pointer' }} onClick={() => setShowEditCot(true)}>◈ {cotName || 'Cotización ESP'}</span>
        <Badge label="ESP" color="#57FF9A" />
        {clientName && <span style={{ fontSize: 11, color: '#888' }}>{clientName}</span>}
        {projectName && <span style={{ fontSize: 10, color: '#555' }}>| {projectName}</span>}
        <button onClick={() => setShowEditCot(true)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 10 }}>✏️</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {(Object.entries(STAGE_CONFIG) as Array<[string, { label: string; color: string }]>).map(([s, cfg]) => (
            <button key={s} onClick={() => { setStage(s); supabase.from('quotations').update({ stage: s }).eq('id', cotId) }} style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid ' + (stage === s ? cfg.color : '#333'), background: stage === s ? cfg.color + '22' : 'transparent', color: stage === s ? cfg.color : '#555',
            }}>{cfg.label}</button>
          ))}
          <button onClick={() => setShowAIImport(true)} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #57FF9A44', background: 'transparent', color: '#57FF9A', marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Sparkles size={11} /> Importar con AI</button>
          <button onClick={() => setShowSystemPicker(true)} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #57FF9A44', background: 'transparent', color: '#57FF9A' }}>⚙ Sistemas ({activeSysIds.length})</button>
          <button onClick={() => setShowInt(!showInt)} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid ' + (showInt ? '#F59E0B' : '#333'), background: showInt ? '#F59E0B22' : 'transparent', color: showInt ? '#F59E0B' : '#555' }}>{showInt ? '👁 Interno' : '👁 Cliente'}</button>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#57FF9A', marginLeft: 10 }}>{config.currency === 'MXN' ? '$' : 'US$'}{total.toFixed(2)}</span>
        </div>
      </div>

      {/* Systems bar + Currency */}
      <div style={{ padding: '5px 16px', borderBottom: '1px solid #1e1e1e', display: 'flex', gap: 5, alignItems: 'center', background: '#0e0e0e', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: '#444', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 6 }}>Sistemas:</span>
        {activeSystems.length === 0 && <span style={{ fontSize: 10, color: '#444' }}>Ninguno — usa ⚙ para agregar</span>}
        {activeSystems.map(sys => {
          const st = products.filter(p => p.systemId === sys.id).reduce((s, p) => s + calcLine(p).total, 0)
          return <span key={sys.id} style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, background: sys.color + '18', color: sys.color, border: '1px solid ' + sys.color + '33' }}>{sys.name} {config.currency === 'MXN' ? '$' : 'US$'}{st.toFixed(0)}</span>
        })}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: config.currency === 'USD' ? '#06B6D4' : '#F59E0B', background: config.currency === 'USD' ? '#06B6D422' : '#F59E0B22', padding: '2px 8px', borderRadius: 5 }}>{config.currency}</span>
          <span style={{ fontSize: 9, color: '#555' }}>TC:</span>
          <input type="number" value={config.tipoCambio} step={0.1}
            onChange={e => updateConfig('tipoCambio', parseFloat(e.target.value) || 20)}
            style={{ width: 55, padding: '2px 6px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} />
        </span>
      </div>

      {/* Content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', flex: 1, overflow: 'hidden' }}>
        <div style={{ overflowY: 'auto', padding: '14px 18px' }}>
          {areas.map(area => (
            <AreaBlock key={area.id} area={area} activeSystems={activeSystems} products={products} allProducts={products}
              collapsedSys={collapsedSys} onToggleArea={() => toggleArea(area.id)} onToggleSys={toggleSys}
              onUpdateProd={updateProduct} onRemoveProd={removeProduct} onUpdateAll={updateAllByCatalogId}
              onAddProd={(sysId) => openAddProduct(area.id, sysId)} showInt={showInt} />
          ))}
          <div onClick={addArea} style={{ padding: '12px', border: '1px dashed #333', borderRadius: 10, textAlign: 'center', cursor: 'pointer', color: '#444', fontSize: 12 }}>+ Agregar área</div>
        </div>
        <div style={{ borderLeft: '1px solid #222', overflowY: 'auto', padding: '14px 10px', background: '#0e0e0e' }}>
          <SummaryPanel products={products} areas={areas} config={config} activeSystems={activeSystems} showInt={showInt} onConfigChange={updateConfig} />
        </div>
      </div>

      {/* Catalog modal */}
      {addingTo && !creatingProduct && (
        <CatalogModal
          systemName={ALL_SYSTEMS.find(s => s.id === addingTo.systemId)?.name || addingTo.systemId}
          onClose={() => setAddingTo(null)}
          onSelect={handleAddFromCatalog}
          onCreateNew={() => setCreatingProduct(true)} />
      )}

      {/* Create product modal */}
      {creatingProduct && addingTo && (
        <CreateProductModal
          systemName={ALL_SYSTEMS.find(s => s.id === addingTo.systemId)?.name || addingTo.systemId}
          onClose={() => setCreatingProduct(false)}
          onCreate={handleCreateAndAdd} />
      )}

      {/* AI Import modal */}
      {showAIImport && (
        <AIImportModal
          cotId={cotId}
          areas={areas}
          activeSysIds={activeSysIds}
          currency={config.currency}
          tipoCambio={config.tipoCambio}
          onClose={() => setShowAIImport(false)}
          onImported={() => { load() }}
        />
      )}

      {/* System picker */}
      {showSystemPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 380 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Sistemas de la cotización</div>
              <button onClick={() => setShowSystemPicker(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 10 }}>Aplican para todas las áreas.</div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 5 }}>
              {ALL_SYSTEMS.map(sys => {
                const on = activeSysIds.includes(sys.id)
                const cnt = products.filter(p => p.systemId === sys.id).length
                return (
                  <button key={sys.id} onClick={() => toggleGlobalSystem(sys.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: on ? sys.color + '11' : '#1a1a1a',
                    border: '1px solid ' + (on ? sys.color + '44' : '#222'), borderRadius: 10, cursor: 'pointer', color: on ? '#fff' : '#666', fontSize: 13, fontFamily: 'inherit', textAlign: 'left' as const,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? sys.color : '#333' }} />
                    <span style={{ flex: 1 }}>{sys.name}</span>
                    {cnt > 0 && <span style={{ fontSize: 10, color: '#555' }}>{cnt}</span>}
                    <span style={{ fontSize: 14, color: on ? sys.color : '#333' }}>{on ? '✓' : '○'}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Edit cotización modal */}
      {showEditCot && <EditCotModal cotId={cotId} name={cotName} clientName={clientName} projectId={projectId}
        onClose={() => setShowEditCot(false)}
        onSaved={(n, cl, pId, pName) => { setCotName(n); setClientName(cl); setProjectId(pId); setProjectName(pName); setShowEditCot(false) }} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// EDIT COTIZACIÓN MODAL
// ═══════════════════════════════════════════════════════════════════
function EditCotModal({ cotId, name, clientName, projectId, onClose, onSaved }: {
  cotId: string; name: string; clientName: string; projectId: string | null
  onClose: () => void; onSaved: (name: string, client: string, projId: string | null, projName: string) => void
}) {
  const [form, setForm] = useState({ name, client_name: clientName, project_id: projectId || '', lead_id: '' })
  const [projects, setProjects] = useState<Array<{ id: string; name: string; client_name: string }>>([])
  const [leads, setLeads] = useState<Array<{ id: string; name: string; company: string }>>([])
  const [clientes, setClientes] = useState<Array<{ id: string; razon_social: string; rfc: string }>>([])
  const [clientSearch, setClientSearch] = useState(clientName)
  const [showDrop, setShowDrop] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('id,name,client_name').eq('status', 'activo'),
      supabase.from('leads').select('id,name,company').order('name'),
      supabase.from('clientes').select('id,razon_social,rfc').eq('activo', true).order('razon_social'),
      supabase.from('quotations').select('notes').eq('id', cotId).single(),
    ]).then(([{ data: p }, { data: l }, { data: c }, { data: q }]) => {
      setProjects(p || []); setLeads(l || []); setClientes(c || [])
      try { const meta = JSON.parse(q?.notes || '{}'); if (meta.lead_id) setForm(f => ({ ...f, lead_id: meta.lead_id })) } catch {}
    })
  }, [])

  async function save() {
    setSaving(true)
    // Update quotation fields
    await supabase.from('quotations').update({
      name: form.name, client_name: form.client_name, project_id: form.project_id || null,
    }).eq('id', cotId)
    // Update lead_id in notes (merge with existing notes)
    const { data: current } = await supabase.from('quotations').select('notes').eq('id', cotId).single()
    let meta: any = {}
    try { meta = JSON.parse(current?.notes || '{}') } catch {}
    const selectedLead = leads.find(l => l.id === form.lead_id)
    meta.lead_id = form.lead_id || null
    meta.lead_name = selectedLead?.name || ''
    await supabase.from('quotations').update({ notes: JSON.stringify(meta) }).eq('id', cotId)

    const proj = projects.find(p => p.id === form.project_id)
    onSaved(form.name, form.client_name, form.project_id || null, proj?.name || '')
    setSaving(false)
  }

  const inputStyle = { display: 'block' as const, width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit' }
  const labelStyle = { fontSize: 10, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block' as const }
  const filtered = clientSearch.length >= 2
    ? clientes.filter(c => c.razon_social.toLowerCase().includes(clientSearch.toLowerCase()))
    : clientes.slice(0, 8)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1020 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Editar cotización</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={labelStyle}>Nombre<input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} /></label>

          {/* Lead — the master entity */}
          <label style={labelStyle}>
            Lead
            <select value={form.lead_id} onChange={e => {
              const lead = leads.find(l => l.id === e.target.value)
              setForm(f => ({ ...f, lead_id: e.target.value, client_name: lead?.name || f.client_name }))
            }} style={inputStyle}>
              <option value="">-- Seleccionar lead --</option>
              {leads.map(l => <option key={l.id} value={l.id}>{l.name}{l.company ? ' | ' + l.company : ''}</option>)}
            </select>
          </label>

          {/* Cliente fiscal */}
          <label style={labelStyle}>
            Cliente (fiscal)
            <div style={{ position: 'relative' }}>
              <input value={clientSearch} onChange={e => { setClientSearch(e.target.value); setForm(f => ({ ...f, client_name: e.target.value })); setShowDrop(true) }}
                onFocus={() => setShowDrop(true)} style={inputStyle} />
              {showDrop && filtered.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, marginTop: 2, maxHeight: 150, overflowY: 'auto', zIndex: 10 }}>
                  {filtered.map(c => (
                    <div key={c.id} onClick={() => { setForm(f => ({ ...f, client_name: c.razon_social })); setClientSearch(c.razon_social); setShowDrop(false) }}
                      style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 12, color: '#ccc', borderBottom: '1px solid #222' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#222' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      {c.razon_social} <span style={{ fontSize: 10, color: '#555' }}>{c.rfc}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </label>

          {/* Proyecto */}
          <label style={labelStyle}>
            Proyecto (opcional — se asigna después)
            <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} style={inputStyle}>
              <option value="">-- Sin proyecto --</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name} | {p.client_name}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Btn>
        </div>
      </div>
    </div>
  )
}
