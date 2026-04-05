import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { SectionHeader, KpiCard, Table, Th, Td, Badge, Btn, EmptyState } from '../components/layout/UI'
import { F } from '../lib/utils'
import { Package, Plus, Search, Edit, X, Tag, Layers, Upload, Loader2 } from 'lucide-react'

interface Product {
  id: string
  name: string
  description: string
  system: string
  type: string
  specialty: string
  provider: string
  unit: string
  cost: number
  markup: number
  precio_venta: number
  clave_prod_serv: string
  clave_unidad: string
  iva_rate: number
  category: string
  sku: string
  is_active: boolean
  moneda: string
  costo_usd: number
  tipo_cambio: number
  marca: string
  modelo: string
}

const SYSTEMS = ['Electrico', 'CCTV', 'Audio', 'Control de acceso', 'Redes', 'Iluminacion', 'Control de iluminacion', 'Cortinas', 'General']
const TYPES = ['material', 'mano_de_obra', 'servicio', 'equipo']
const UNITS = [
  { clave: 'E48', label: 'Servicio (E48)' },
  { clave: 'H87', label: 'Pieza (H87)' },
  { clave: 'MTR', label: 'Metro (MTR)' },
  { clave: 'KGM', label: 'Kilogramo (KGM)' },
  { clave: 'LTR', label: 'Litro (LTR)' },
  { clave: 'SET', label: 'Conjunto (SET)' },
  { clave: 'HUR', label: 'Hora (HUR)' },
  { clave: 'DAY', label: 'Dia (DAY)' },
  { clave: 'ACT', label: 'Actividad (ACT)' },
]

const iS: React.CSSProperties = { width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }

function Fld({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (<div style={{ marginBottom: 12, gridColumn: span ? '1 / -1' : undefined }}><div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 500 }}>{label}</div>{children}</div>)
}

export default function Catalogo() {
  const [products, setProducts] = useState<Product[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterSystem, setFilterSystem] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<Partial<Product>>({
    type: 'material', unit: 'pza', clave_unidad: 'H87', markup: 35, iva_rate: 0.16, is_active: true, system: 'Electrico', moneda: 'MXN',
  })

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('catalog_products').select('*').order('name')
      if (data) setProducts(data.map((p: any) => ({...p, cost: Number(p.cost)||0, markup: Number(p.markup)||35, precio_venta: Number(p.precio_venta)||0, iva_rate: Number(p.iva_rate)||0.16})))
    }
    load()
  }, [])

  const filtered = products.filter(p => {
    const matchSearch = !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.description?.toLowerCase().includes(search.toLowerCase()) || p.clave_prod_serv?.includes(search) || p.sku?.toLowerCase().includes(search.toLowerCase())
    const matchSystem = !filterSystem || p.system === filterSystem
    return matchSearch && matchSystem
  })

  const openNew = () => {
    setEditId(null)
    setForm({ type: 'material', unit: 'pza', clave_unidad: 'H87', markup: 35, iva_rate: 0.16, is_active: true, system: 'Electrico' })
    setShowForm(true)
  }

  const openEdit = (p: Product) => {
    setEditId(p.id)
    setForm({ ...p })
    setShowForm(true)
  }

  const calcPrecioVenta = (cost: number, markup: number) => Math.round(cost * (1 + markup / 100) * 100) / 100

  const save = async () => {
    if (!form.name) return
    const pv = form.precio_venta || calcPrecioVenta(form.cost || 0, form.markup || 35)
    const row = {
      name: form.name, description: form.description || null, system: form.system || null,
      type: form.type || 'material', specialty: form.specialty || null, provider: form.provider || null,
      unit: form.unit || 'pza', cost: form.cost || 0, markup: form.markup || 35,
      precio_venta: pv, clave_prod_serv: form.clave_prod_serv || null,
      clave_unidad: form.clave_unidad || 'H87', iva_rate: form.iva_rate ?? 0.16,
      category: form.category || 'general', sku: form.sku || null, is_active: form.is_active !== false,
      moneda: form.moneda || 'MXN', costo_usd: form.costo_usd || 0, tipo_cambio: form.tipo_cambio || 0, marca: form.marca || null, modelo: form.modelo || null,
    }
    if (editId) {
      await supabase.from('catalog_products').update(row).eq('id', editId)
      setProducts(products.map(p => p.id === editId ? {...p, ...row, id: editId, precio_venta: pv} as Product : p))
    } else {
      const { data } = await supabase.from('catalog_products').insert(row).select().single()
      if (data) setProducts([{...data, cost: Number(data.cost), markup: Number(data.markup), precio_venta: Number(data.precio_venta), iva_rate: Number(data.iva_rate)} as Product, ...products])
    }
    setShowForm(false)
  }


  const handleAIImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const prompt = 'Eres un asistente de OMM Technologies (instalaciones electricas y sistemas especiales). Analiza este archivo de productos/SKUs y devuelve SOLO un JSON array. Para cada producto extrae: name, description, clave_prod_serv (codigo SAT mas probable segun el tipo de producto), clave_unidad (H87 para piezas, E48 para servicios, MTR para metros), unit, cost (numero), precio_venta (numero), moneda (MXN o USD), marca, modelo, system (Electrico/CCTV/Audio/Control de acceso/Redes/Iluminacion/Control de iluminacion/General), type (material/mano_de_obra/servicio/equipo), sku, markup (porcentaje). Si hay duplicados, consolidalos. Estandariza nombres. Responde SOLO con el JSON array, sin markdown ni backticks.\n\nArchivo:\n' + text.substring(0, 15000)
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
      })
      const data = await r.json()
      const aiText = data.content?.[0]?.text || ''
      const cleaned = aiText.replace(/```json\n?/g, '').replace(/```/g, '').trim()
      const parsed = JSON.parse(cleaned)
      if (Array.isArray(parsed) && parsed.length > 0) {
        let added = 0
        for (const p of parsed) {
          const existing = products.find(ep => ep.sku === p.sku || ep.name?.toLowerCase() === p.name?.toLowerCase())
          if (!existing) {
            const { data: saved } = await supabase.from('catalog_products').insert({
              name: p.name, description: p.description || null, clave_prod_serv: p.clave_prod_serv || null,
              clave_unidad: p.clave_unidad || 'H87', unit: p.unit || 'pza', cost: p.cost || 0,
              precio_venta: p.precio_venta || 0, markup: p.markup || 35, moneda: p.moneda || 'MXN',
              marca: p.marca || null, modelo: p.modelo || null, system: p.system || null,
              type: p.type || 'material', sku: p.sku || null, iva_rate: 0.16, is_active: true,
            }).select().single()
            if (saved) { setProducts(prev => [{...saved, cost:Number(saved.cost), markup:Number(saved.markup), precio_venta:Number(saved.precio_venta), iva_rate:Number(saved.iva_rate), costo_usd:Number(saved.costo_usd)||0, tipo_cambio:Number(saved.tipo_cambio)||0} as Product, ...prev]); added++ }
          }
        }
        setImportResult(added + ' productos importados de ' + parsed.length + ' procesados (' + (parsed.length - added) + ' duplicados omitidos)')
      } else {
        setImportResult('No se encontraron productos en el archivo')
      }
    } catch (err) {
      setImportResult('Error: ' + (err as Error).message)
    }
    setImporting(false)
    if (importRef.current) importRef.current.value = ''
  }
  const totalProducts = products.length
  const activeProducts = products.filter(p => p.is_active).length

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200 }}>
      <SectionHeader title="Catalogo de Productos" subtitle="Productos, servicios y materiales con claves SAT" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Total productos" value={totalProducts} icon={<Package size={16} />} />
        <KpiCard label="Activos" value={activeProducts} color="#57FF9A" icon={<Layers size={16} />} />
        <KpiCard label="Sistemas" value={new Set(products.map(p => p.system).filter(Boolean)).size} color="#3B82F6" icon={<Tag size={16} />} />
      </div>

      {importResult && (
        <div style={{ background: '#141414', border: '1px solid #57FF9A33', borderRadius: 10, padding: '10px 16px', marginBottom: 12, fontSize: 12, color: '#57FF9A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{importResult}</span>
          <button onClick={() => setImportResult(null)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={14} /></button>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#555' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, SKU, clave SAT..." style={{ ...iS, width: 280, paddingLeft: 32 }} />
          </div>
          <select value={filterSystem} onChange={e => setFilterSystem(e.target.value)} style={{ ...iS, width: 160 }}>
            <option value="">Todos los sistemas</option>
            {SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <input type="file" ref={importRef} accept=".csv,.txt,.xlsx,.tsv" style={{ display: 'none' }} onChange={handleAIImport} />
        <Btn size="sm" variant="default" onClick={() => importRef.current?.click()}>{importing ? <><Loader2 size={12} style={{animation:'spin 1s linear infinite'}} /> Procesando con IA...</> : <><Upload size={12} /> Importar con IA</>}</Btn>
        <Btn size="sm" variant="primary" onClick={openNew}><Plus size={12} /> Nuevo producto</Btn>
      </div>

      <Table>
        <thead><tr><Th>Producto</Th><Th>Clave SAT</Th><Th>Sistema</Th><Th>Unidad</Th><Th right>Costo</Th><Th right>Precio Venta</Th><Th>Tipo</Th><Th>{' '}</Th></tr></thead>
        <tbody>
          {filtered.length === 0 && <tr><Td colSpan={8} muted>Sin productos. Agrega tu primer producto al catalogo.</Td></tr>}
          {filtered.map(p => (
            <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedProduct(p)}>
              <Td><div style={{fontWeight: 600, color:'#fff'}}>{p.name}</div>{p.description && <div style={{fontSize:10, color:'#555', marginTop:2}}>{p.description.substring(0,50)}</div>}</Td>
              <Td><span style={{fontFamily:'monospace', fontSize: 11, color:'#888'}}>{p.clave_prod_serv || '--'}</span></Td>
              <Td muted style={{fontSize:11}}>{p.system || '--'}</Td>
              <Td muted style={{fontSize:11}}>{p.clave_unidad} ({p.unit})</Td>
              <Td right muted><span style={{fontSize:9,color:'#555'}}>{p.moneda||'MXN'}</span> {F(p.cost)}</Td>
              <Td right style={{fontWeight: 600, color:'#57FF9A'}}>{F(p.precio_venta || calcPrecioVenta(p.cost, p.markup))}</Td>
              <Td><Badge label={p.type === 'material' ? 'Material' : p.type === 'mano_de_obra' ? 'MO' : p.type === 'servicio' ? 'Servicio' : 'Equipo'} color={p.type === 'material' ? '#3B82F6' : p.type === 'mano_de_obra' ? '#C084FC' : p.type === 'servicio' ? '#57FF9A' : '#F59E0B'} /></Td>
              <Td><Edit size={12} style={{ color: '#555' }} onClick={(e: React.MouseEvent) => { e.stopPropagation(); openEdit(p) }} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setSelectedProduct(null)}>
          <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 16, padding: 24, width: 600, maxHeight: '80vh', overflowY: 'auto' as const }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{selectedProduct.name}</div>
              <button onClick={() => setSelectedProduct(null)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            {selectedProduct.description && <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>{selectedProduct.description}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 16px', fontSize: 12 }}>
              <div><span style={{color:'#555'}}>Clave SAT:</span> <span style={{color:'#fff', fontFamily:'monospace'}}>{selectedProduct.clave_prod_serv || '--'}</span></div>
              <div><span style={{color:'#555'}}>SKU:</span> <span style={{color:'#ccc'}}>{selectedProduct.sku || '--'}</span></div>
              <div><span style={{color:'#555'}}>Sistema:</span> <span style={{color:'#ccc'}}>{selectedProduct.system || '--'}</span></div>
              <div><span style={{color:'#555'}}>Tipo:</span> <Badge label={selectedProduct.type} color="#3B82F6" /></div>
              <div><span style={{color:'#555'}}>Unidad:</span> <span style={{color:'#ccc'}}>{selectedProduct.clave_unidad} ({selectedProduct.unit})</span></div>
              <div><span style={{color:'#555'}}>Proveedor:</span> <span style={{color:'#ccc'}}>{selectedProduct.provider || '--'}</span></div>
              <div><span style={{color:'#555'}}>Marca:</span> <span style={{color:'#ccc'}}>{selectedProduct.marca || '--'}</span></div>
              <div><span style={{color:'#555'}}>Modelo:</span> <span style={{color:'#ccc'}}>{selectedProduct.modelo || '--'}</span></div>
              <div><span style={{color:'#555'}}>Moneda:</span> <span style={{color: selectedProduct.moneda === 'USD' ? '#3B82F6' : '#57FF9A'}}>{selectedProduct.moneda || 'MXN'}</span></div>
              <div><span style={{color:'#555'}}>Costo:</span> <span style={{color:'#F59E0B', fontWeight:600}}>{F(selectedProduct.cost)}</span></div>
              <div><span style={{color:'#555'}}>Markup:</span> <span style={{color:'#ccc'}}>{selectedProduct.markup}%</span></div>
              <div><span style={{color:'#555'}}>Precio Venta:</span> <span style={{color:'#57FF9A', fontWeight:700}}>{F(selectedProduct.precio_venta || calcPrecioVenta(selectedProduct.cost, selectedProduct.markup))}</span></div>
              <div><span style={{color:'#555'}}>IVA:</span> <span style={{color:'#ccc'}}>{(selectedProduct.iva_rate * 100)}%</span></div>
              <div><span style={{color:'#555'}}>Categoria:</span> <span style={{color:'#ccc'}}>{selectedProduct.category || '--'}</span></div>
              <div><span style={{color:'#555'}}>Activo:</span> <span style={{color: selectedProduct.is_active ? '#57FF9A' : '#EF4444'}}>{selectedProduct.is_active ? 'Si' : 'No'}</span></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Btn size="sm" variant="default" onClick={() => { openEdit(selectedProduct); setSelectedProduct(null) }}>Editar</Btn>
              <Btn size="sm" variant="default" onClick={() => setSelectedProduct(null)}>Cerrar</Btn>
            </div>
          </div>
        </div>
      )}

      {/* New/Edit Product Form */}
      {showForm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowForm(false)}>
          <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 16, padding: 24, width: 700, maxHeight: '85vh', overflowY: 'auto' as const }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{editId ? 'Editar Producto' : 'Nuevo Producto'}</div>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Fld label="Nombre *" span><input style={iS} value={form.name || ''} onChange={e => setForm({...form, name: e.target.value})} placeholder="Cable THW calibre 12" /></Fld>
              <Fld label="Descripcion" span><input style={iS} value={form.description || ''} onChange={e => setForm({...form, description: e.target.value})} placeholder="Descripcion detallada del producto" /></Fld>
              <Fld label="Clave SAT (ClaveProdServ)"><input style={iS} value={form.clave_prod_serv || ''} onChange={e => setForm({...form, clave_prod_serv: e.target.value})} placeholder="26121600" /></Fld>
              <Fld label="SKU"><input style={iS} value={form.sku || ''} onChange={e => setForm({...form, sku: e.target.value})} placeholder="CAB-THW-12" /></Fld>
              <Fld label="Sistema"><select style={iS} value={form.system || ''} onChange={e => setForm({...form, system: e.target.value})}><option value="">--</option>{SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}</select></Fld>
              <Fld label="Tipo"><select style={iS} value={form.type || 'material'} onChange={e => setForm({...form, type: e.target.value})}>{TYPES.map(t => <option key={t} value={t}>{t === 'mano_de_obra' ? 'Mano de obra' : t.charAt(0).toUpperCase() + t.slice(1)}</option>)}</select></Fld>
              <Fld label="Unidad SAT"><select style={iS} value={form.clave_unidad || 'H87'} onChange={e => { const u = UNITS.find(u => u.clave === e.target.value); setForm({...form, clave_unidad: e.target.value, unit: u?.label.split(' (')[0] || ''}) }}>{UNITS.map(u => <option key={u.clave} value={u.clave}>{u.label}</option>)}</select></Fld>
              <Fld label="Proveedor"><input style={iS} value={form.provider || ''} onChange={e => setForm({...form, provider: e.target.value})} placeholder="Nombre del proveedor" /></Fld>
              <Fld label="Marca"><input style={iS} value={form.marca || ''} onChange={e => setForm({...form, marca: e.target.value})} placeholder="Lutron, Hikvision..." /></Fld>
              <Fld label="Modelo"><input style={iS} value={form.modelo || ''} onChange={e => setForm({...form, modelo: e.target.value})} placeholder="Modelo del producto" /></Fld>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginTop: 12, marginBottom: 10 }}>Precios</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
              <Fld label="Moneda"><select style={iS} value={form.moneda || 'MXN'} onChange={e => setForm({...form, moneda: e.target.value})}><option value="MXN">MXN (Pesos)</option><option value="USD">USD (Dolares)</option></select></Fld>
              <Fld label="Costo"><input style={iS} type="number" value={form.cost || ''} onChange={e => { const c = parseFloat(e.target.value)||0; setForm({...form, cost: c, precio_venta: calcPrecioVenta(c, form.markup||35)}) }} placeholder="0.00" /></Fld>
              <Fld label="Markup %"><input style={iS} type="number" value={form.markup || ''} onChange={e => { const m = parseFloat(e.target.value)||0; setForm({...form, markup: m, precio_venta: calcPrecioVenta(form.cost||0, m)}) }} placeholder="35" /></Fld>
              <Fld label="Precio Venta"><input style={iS} type="number" value={form.precio_venta || ''} onChange={e => setForm({...form, precio_venta: parseFloat(e.target.value)||0})} placeholder="0.00" /></Fld>
              <Fld label="Tipo Cambio"><input style={iS} type="number" value={form.tipo_cambio || ''} onChange={e => setForm({...form, tipo_cambio: parseFloat(e.target.value)||0})} placeholder="20.50" /></Fld>
              <Fld label="IVA %"><select style={iS} value={String(form.iva_rate ?? 0.16)} onChange={e => setForm({...form, iva_rate: parseFloat(e.target.value)})}><option value="0.16">16%</option><option value="0.08">8% (frontera)</option><option value="0">0% (exento)</option></select></Fld>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <Btn size="sm" variant="default" onClick={() => setShowForm(false)}>Cancelar</Btn>
              <Btn size="sm" variant="primary" onClick={save}>{editId ? 'Guardar' : 'Crear producto'}</Btn>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
