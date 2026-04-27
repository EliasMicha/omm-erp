import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { F, STAGE_CONFIG } from '../lib/utils'
import { Btn, Loading } from '../components/layout/UI'
import { Plus, ChevronDown, ChevronRight, X, Trash2, Image as ImageIcon, Search } from 'lucide-react'

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
function ProductRow({ p, onUpdate, onRemove, selected, onToggleSelect }: {
  p: IlumProduct; onUpdate: (id: string, f: string, v: number | string) => void; onRemove: (id: string) => void
  selected?: boolean; onToggleSelect?: (id: string) => void
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
function SubsectionBlock({ subsection, products, onToggle, onUpdate, onRemove, onAdd, allProducts, selectedIds, onToggleSelect }: {
  subsection: IlumSubsection; products: IlumProduct[]; onToggle: () => void
  onUpdate: (id: string, f: string, v: number | string) => void; onRemove: (id: string) => void
  onAdd: () => void; allProducts: IlumProduct[]
  selectedIds?: Set<string>; onToggleSelect?: (id: string) => void
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
            <th style={S.th}></th>
          </tr></thead>
          <tbody>
            {products.map(p => (
              <ProductRow key={p.id} p={p} onUpdate={onUpdate} onRemove={onRemove} selected={selectedIds?.has(p.id)} onToggleSelect={onToggleSelect} />
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
    </div>
  )
}
