import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { SectionHeader, KpiCard, Table, Th, Td, Badge, Btn, EmptyState } from '../components/layout/UI'
import { F, PHASE_CONFIG } from '../lib/utils'
import { ANTHROPIC_API_KEY } from '../lib/config'
import { Package, Plus, Search, Edit, X, Tag, Layers, Upload, Loader2, Sparkles } from 'lucide-react'
import { PurchasePhase } from '../types'
import ImageUpload from '../components/ImageUpload'

interface Supplier { id: string; name: string }

interface Product {
  id: string
  name: string
  description: string
  system: string
  type: string
  specialty: string
  provider: string
  supplier_id: string
  purchase_phase: string
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
  image_url: string | null
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
  const [tab, setTab] = useState<'productos' | 'proveedores'>('productos')
  const [products, setProducts] = useState<Product[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterSystem, setFilterSystem] = useState('')
  const [filterSpecialty, setFilterSpecialty] = useState<'esp' | 'ilum' | 'elec' | 'proy'>('esp')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [aiSearching, setAiSearching] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<Partial<Product>>({
    type: 'material', unit: 'pza', clave_unidad: 'H87', markup: 35, iva_rate: 0.16, is_active: true, system: 'Electrico', moneda: 'MXN', purchase_phase: 'inicio', supplier_id: '',
  })
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  async function searchProductWithAI() {
    const marca = (form as any).marca || form.provider || ''
    const modelo = (form as any).modelo || ''
    const name = form.name || ''
    const queryParts = [marca, modelo, name].filter(Boolean)
    if (queryParts.length === 0) {
      setAiError('Llena al menos nombre, marca o modelo antes de buscar')
      return
    }
    setAiSearching(true)
    setAiError(null)

    const productQuery = [marca, modelo].filter(Boolean).join(' ') || name
    const specialty = filterSpecialty
    const specialtyHint = specialty === 'ilum' ? 'iluminación arquitectónica (luminaria, foco, driver)' :
      specialty === 'elec' ? 'producto eléctrico (cable, interruptor, breaker, conduit)' :
      specialty === 'esp' ? 'instalación especial (audio, video, CCTV, redes, control)' :
      'servicio profesional o producto'

    const prompt = `Busca en internet las especificaciones técnicas oficiales del siguiente producto y devuelve SOLO un JSON válido con los campos que encuentres. NO inventes datos, solo incluye lo que confirmes en datasheets oficiales del fabricante.\n\nProducto: ${productQuery}\nCategoría: ${specialtyHint}\n\nDevuelve un JSON con este formato exacto (omite campos que no encuentres con certeza):\n{\n  "description": "descripción técnica corta del producto en español",\n  "marca": "marca/fabricante",\n  "modelo": "código de modelo exacto del fabricante",\n  "watts": número de watts (solo número, sin unidad),\n  "lumens": número de lúmenes (solo número),\n  "cct": temperatura de color en Kelvin (solo número, ej. 3000),\n  "cri": índice de reproducción cromática (solo número, ej. 90),\n  "ip_rating": "IP20, IP65, etc.",\n  "mounting_type": "empotrado, suspendido, sobreponer, riel, etc.",\n  "system": "Iluminacion / Audio / Video / CCTV / Redes / Control / Electrico",\n  "unit": "pza / m / kg / rollo / etc.",\n  "clave_prod_serv": "clave SAT mexicana de 8 dígitos si la sabes"\n}\n\nIMPORTANTE: Devuelve SOLO el JSON, sin texto antes ni después, sin markdown, sin backticks. Si no encuentras información confiable del producto, devuelve {} (objeto vacío).`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const data = await res.json()
      if (data.error) {
        setAiError(data.error.message || 'Error de la API')
        setAiSearching(false)
        return
      }
      // Extraer texto de la respuesta (puede venir en varios bloques de tipo 'text')
      const textBlocks = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      // Intentar parsear el JSON del texto
      let parsed: any = null
      try {
        const cleaned = textBlocks.replace(/```json|```/g, '').trim()
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
      } catch (e) {
        setAiError('No se pudo parsear la respuesta. Intenta con marca y modelo más específicos.')
        setAiSearching(false)
        return
      }
      if (!parsed || Object.keys(parsed).length === 0) {
        setAiError('No se encontró información del producto. Verifica marca y modelo.')
        setAiSearching(false)
        return
      }
      // Auto-llenar SOLO campos vacíos (no sobreescribir lo que ya pusiste)
      const updates: any = {}
      const f: any = form
      if (parsed.description && !f.description) updates.description = parsed.description
      if (parsed.marca && !f.marca) updates.marca = parsed.marca
      if (parsed.modelo && !f.modelo) updates.modelo = parsed.modelo
      if (parsed.watts && !f.watts) updates.watts = parsed.watts
      if (parsed.lumens && !f.lumens) updates.lumens = parsed.lumens
      if (parsed.cct && !f.cct) updates.cct = parsed.cct
      if (parsed.cri && !f.cri) updates.cri = parsed.cri
      if (parsed.ip_rating && !f.ip_rating) updates.ip_rating = parsed.ip_rating
      if (parsed.mounting_type && !f.mounting_type) updates.mounting_type = parsed.mounting_type
      if (parsed.system && !f.system) updates.system = parsed.system
      if (parsed.unit && !f.unit) updates.unit = parsed.unit
      if (parsed.clave_prod_serv && !f.clave_prod_serv) updates.clave_prod_serv = parsed.clave_prod_serv
      setForm({ ...form, ...updates })
      setAiSearching(false)
    } catch (err: any) {
      setAiError('Error: ' + (err.message || 'no se pudo conectar'))
      setAiSearching(false)
    }
  }

  useEffect(() => {
    const load = async () => {
      const [{ data }, { data: sups }] = await Promise.all([
        supabase.from('catalog_products').select('*').order('name'),
        supabase.from('suppliers').select('id,name').eq('is_active', true).order('name'),
      ])
      if (data) setProducts(data.map((p: any) => ({...p, cost: Number(p.cost)||0, markup: Number(p.markup)||35, precio_venta: Number(p.precio_venta)||0, iva_rate: Number(p.iva_rate)||0.16})))
      if (sups) setSuppliers(sups)
    }
    load()
  }, [])

  const filtered = products.filter(p => {
    const matchSearch = !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.description?.toLowerCase().includes(search.toLowerCase()) || p.clave_prod_serv?.includes(search) || p.sku?.toLowerCase().includes(search.toLowerCase())
    const matchSystem = !filterSystem || p.system === filterSystem
    const matchSpecialty = (p.specialty || 'esp') === filterSpecialty
    return matchSearch && matchSystem && matchSpecialty
  })

  // Conteos por especialidad para los tabs
  const specialtyCounts = {
    esp: products.filter(p => p.is_active !== false && (p.specialty || 'esp') === 'esp').length,
    ilum: products.filter(p => p.is_active !== false && p.specialty === 'ilum').length,
    elec: products.filter(p => p.is_active !== false && p.specialty === 'elec').length,
    proy: products.filter(p => p.is_active !== false && p.specialty === 'proy').length,
  }
  const SPECIALTY_TABS: Array<{ key: 'esp' | 'ilum' | 'elec' | 'proy'; label: string; icon: string }> = [
    { key: 'esp',  label: 'Especiales',   icon: '◈' },
    { key: 'ilum', label: 'Iluminación',  icon: '◇' },
    { key: 'elec', label: 'Eléctrico',    icon: '◉' },
    { key: 'proy', label: 'Proyecto',     icon: '▲' },
  ]

  const openNew = () => {
    setEditId(null)
    setForm({ type: 'material', unit: 'pza', clave_unidad: 'H87', markup: 35, iva_rate: 0.16, is_active: true, system: 'Electrico', purchase_phase: 'inicio', supplier_id: '' })
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
      supplier_id: form.supplier_id || null, purchase_phase: form.purchase_phase || 'inicio',
      image_url: form.image_url || null,
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
        <KpiCard label="Proveedores" value={suppliers.length} color="#3B82F6" icon={<Tag size={16} />} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #222', marginBottom: 20 }}>
        {([
          { key: 'productos' as const, label: 'Productos' },
          { key: 'proveedores' as const, label: 'Proveedores' },
        ]).map(({ key, label }) => {
          const active = tab === key
          return (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '8px 14px', fontSize: 12, fontWeight: active ? 600 : 400,
              color: active ? '#57FF9A' : '#666',
              background: active ? 'rgba(87,255,154,0.08)' : 'transparent',
              border: 'none', borderBottom: active ? '2px solid #57FF9A' : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'inherit', borderRadius: '8px 8px 0 0',
            }}>{label}</button>
          )
        })}
      </div>

      {tab === 'proveedores' && <TabProveedores suppliers={suppliers} setSuppliers={setSuppliers} />}

      {tab === 'productos' && (<>

      {importResult && (
        <div style={{ background: '#141414', border: '1px solid #57FF9A33', borderRadius: 10, padding: '10px 16px', marginBottom: 12, fontSize: 12, color: '#57FF9A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{importResult}</span>
          <button onClick={() => setImportResult(null)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={14} /></button>
        </div>
      )}
      {/* Tabs por especialidad */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #1e1e1e', paddingBottom: 12 }}>
        {SPECIALTY_TABS.map(t => {
          const active = filterSpecialty === t.key
          return (
            <button key={t.key} onClick={() => setFilterSpecialty(t.key)} style={{ padding: '8px 18px', borderRadius: 20, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, border: `1px solid ${active ? '#57FF9A' : '#333'}`, background: active ? '#57FF9A18' : 'transparent', color: active ? '#57FF9A' : '#888' }}>
              {t.icon} {t.label} ({specialtyCounts[t.key]})
            </button>
          )
        })}
      </div>

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
        <thead><tr>
          <Th>{' '}</Th>
          <Th>Producto</Th>
          {filterSpecialty === 'esp' && <><Th>Sistema</Th><Th>Marca</Th><Th>Modelo</Th></>}
          {filterSpecialty === 'ilum' && <><Th>Marca</Th><Th>Modelo</Th><Th right>W</Th><Th right>Lúmenes</Th><Th right>CCT</Th><Th right>CRI</Th><Th>IP</Th><Th>Montaje</Th></>}
          {filterSpecialty === 'elec' && <><Th>Categoría</Th><Th>Unidad</Th></>}
          {filterSpecialty === 'proy' && <><Th>Unidad</Th></>}
          <Th>Proveedor</Th>
          <Th>Fase</Th>
          <Th right>Costo</Th>
          <Th right>Precio Venta</Th>
          <Th>{' '}</Th>
        </tr></thead>
        <tbody>
          {filtered.length === 0 && <tr><Td colSpan={10} muted>Sin productos. Agrega tu primer producto al catalogo.</Td></tr>}
          {filtered.map(p => (
            <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedProduct(p)}>
              <Td>
                {p.image_url ? (
                  <img src={p.image_url} alt="" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 4, background: '#fff', border: '1px solid #2a2a2a' }} />
                ) : (
                  <div style={{ width: 32, height: 32, borderRadius: 4, border: '1px dashed #2a2a2a', background: '#0e0e0e' }} />
                )}
              </Td>
              <Td><div style={{fontWeight: 600, color:'#fff'}}>{p.name}</div>{p.description && <div style={{fontSize:10, color:'#555', marginTop:2}}>{p.description.substring(0,50)}</div>}</Td>
              {filterSpecialty === 'esp' && <>
                <Td muted style={{fontSize:11}}>{p.system || '--'}</Td>
                <Td muted style={{fontSize:11}}>{(p as any).marca || p.provider || '--'}</Td>
                <Td muted style={{fontSize:11}}>{(p as any).modelo || '--'}</Td>
              </>}
              {filterSpecialty === 'ilum' && <>
                <Td muted style={{fontSize:11}}>{(p as any).marca || p.provider || '--'}</Td>
                <Td muted style={{fontSize:11}}>{(p as any).modelo || '--'}</Td>
                <Td right muted style={{fontSize:11}}>{(p as any).watts || '--'}</Td>
                <Td right muted style={{fontSize:11}}>{(p as any).lumens || '--'}</Td>
                <Td right muted style={{fontSize:11}}>{(p as any).cct ? (p as any).cct + 'K' : '--'}</Td>
                <Td right muted style={{fontSize:11}}>{(p as any).cri || '--'}</Td>
                <Td muted style={{fontSize:11}}>{(p as any).ip_rating || '--'}</Td>
                <Td muted style={{fontSize:11}}>{(p as any).mounting_type || '--'}</Td>
              </>}
              {filterSpecialty === 'elec' && <>
                <Td muted style={{fontSize:11}}>{p.category || p.system || '--'}</Td>
                <Td muted style={{fontSize:11}}>{p.clave_unidad} ({p.unit})</Td>
              </>}
              {filterSpecialty === 'proy' && <>
                <Td muted style={{fontSize:11}}>{p.unit || 'pza'}</Td>
              </>}
              <Td muted style={{fontSize:11}}>{suppliers.find(s => s.id === p.supplier_id)?.name || p.provider || '--'}</Td>
              <Td>{p.purchase_phase ? <Badge label={PHASE_CONFIG[p.purchase_phase as PurchasePhase]?.label || p.purchase_phase} color={PHASE_CONFIG[p.purchase_phase as PurchasePhase]?.color || '#555'} /> : <span style={{color:'#555',fontSize:11}}>--</span>}</Td>
              <Td right muted><span style={{fontSize:9,color:'#555'}}>{p.moneda||'MXN'}</span> {F(p.cost)}</Td>
              <Td right style={{fontWeight: 600, color:'#57FF9A'}}>{F(p.precio_venta || calcPrecioVenta(p.cost, p.markup))}</Td>
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
              <div><span style={{color:'#555'}}>Distribuidor:</span> <span style={{color:'#ccc'}}>{suppliers.find(s => s.id === selectedProduct.supplier_id)?.name || '--'}</span></div>
              <div><span style={{color:'#555'}}>Fase compra:</span> {selectedProduct.purchase_phase ? <Badge label={PHASE_CONFIG[selectedProduct.purchase_phase as PurchasePhase]?.label || selectedProduct.purchase_phase} color={PHASE_CONFIG[selectedProduct.purchase_phase as PurchasePhase]?.color || '#555'} /> : <span style={{color:'#555'}}>--</span>}</div>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Btn size="sm" variant="primary" onClick={searchProductWithAI} disabled={aiSearching}>
                  {aiSearching ? <><Loader2 size={12} style={{animation:'spin 1s linear infinite'}} /> Buscando...</> : <><Sparkles size={12} /> Buscar con IA</>}
                </Btn>
                <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
              </div>
            </div>
            {aiError && <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: 10, color: '#f87171', fontSize: 12, marginBottom: 12 }}>{aiError} <button onClick={() => setAiError(null)} style={{float:'right',background:'none',border:'none',color:'#f87171',cursor:'pointer'}}>×</button></div>}
            <div style={{ display: 'flex', gap: 16, marginBottom: 14, alignItems: 'flex-start' }}>
              <div style={{ flexShrink: 0 }}>
                <div style={{ fontSize: 10, color: '#666', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Foto</div>
                <ImageUpload
                  value={form.image_url || null}
                  onChange={url => setForm({ ...form, image_url: url })}
                  size="md"
                  label="Subir foto"
                  folder="products"
                />
              </div>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Fld label="Nombre *" span><input style={iS} value={form.name || ''} onChange={e => setForm({...form, name: e.target.value})} placeholder="Cable THW calibre 12" /></Fld>
                <Fld label="Marca"><input style={iS} value={form.marca || ''} onChange={e => setForm({...form, marca: e.target.value})} placeholder="Lutron, Hikvision..." /></Fld>
                <Fld label="Modelo"><input style={iS} value={form.modelo || ''} onChange={e => setForm({...form, modelo: e.target.value})} placeholder="Modelo del producto" /></Fld>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Fld label="Descripcion" span><input style={iS} value={form.description || ''} onChange={e => setForm({...form, description: e.target.value})} placeholder="Descripcion detallada del producto" /></Fld>
              <Fld label="Clave SAT (ClaveProdServ)"><input style={iS} value={form.clave_prod_serv || ''} onChange={e => setForm({...form, clave_prod_serv: e.target.value})} placeholder="26121600" /></Fld>
              <Fld label="SKU"><input style={iS} value={form.sku || ''} onChange={e => setForm({...form, sku: e.target.value})} placeholder="CAB-THW-12" /></Fld>
              <Fld label="Sistema"><select style={iS} value={form.system || ''} onChange={e => setForm({...form, system: e.target.value})}><option value="">--</option>{SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}</select></Fld>
              <Fld label="Tipo"><select style={iS} value={form.type || 'material'} onChange={e => setForm({...form, type: e.target.value})}>{TYPES.map(t => <option key={t} value={t}>{t === 'mano_de_obra' ? 'Mano de obra' : t.charAt(0).toUpperCase() + t.slice(1)}</option>)}</select></Fld>
              <Fld label="Unidad SAT"><select style={iS} value={form.clave_unidad || 'H87'} onChange={e => { const u = UNITS.find(u => u.clave === e.target.value); setForm({...form, clave_unidad: e.target.value, unit: u?.label.split(' (')[0] || ''}) }}>{UNITS.map(u => <option key={u.clave} value={u.clave}>{u.label}</option>)}</select></Fld>
              <Fld label="Proveedor (marca)"><input style={iS} value={form.provider || ''} onChange={e => setForm({...form, provider: e.target.value})} placeholder="Lutron, Hikvision..." /></Fld>
              <Fld label="Distribuidor"><select style={iS} value={form.supplier_id || ''} onChange={e => setForm({...form, supplier_id: e.target.value})}><option value="">-- Sin distribuidor --</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>
              <Fld label="Fase de compra"><select style={iS} value={form.purchase_phase || 'inicio'} onChange={e => setForm({...form, purchase_phase: e.target.value})}>{Object.entries(PHASE_CONFIG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}</select></Fld>
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

            {/* Especificaciones técnicas (Iluminación arquitectónica) */}
            <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginTop: 12, marginBottom: 10 }}>Especificaciones técnicas (Iluminación)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Fld label="Watts (W)"><input style={iS} type="number" value={(form as any).watts || ''} onChange={e => setForm({...form, watts: parseFloat(e.target.value) || null} as any)} placeholder="9" /></Fld>
              <Fld label="Lúmenes"><input style={iS} type="number" value={(form as any).lumens || ''} onChange={e => setForm({...form, lumens: parseInt(e.target.value) || null} as any)} placeholder="800" /></Fld>
              <Fld label="CCT (K)"><input style={iS} type="number" value={(form as any).cct || ''} onChange={e => setForm({...form, cct: parseInt(e.target.value) || null} as any)} placeholder="3000" /></Fld>
              <Fld label="CRI"><input style={iS} type="number" value={(form as any).cri || ''} onChange={e => setForm({...form, cri: parseInt(e.target.value) || null} as any)} placeholder="90" /></Fld>
              <Fld label="IP Rating"><input style={iS} value={(form as any).ip_rating || ''} onChange={e => setForm({...form, ip_rating: e.target.value} as any)} placeholder="IP65" /></Fld>
              <Fld label="Tipo de montaje"><input style={iS} value={(form as any).mounting_type || ''} onChange={e => setForm({...form, mounting_type: e.target.value} as any)} placeholder="Empotrado, suspendido..." /></Fld>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <Btn size="sm" variant="default" onClick={() => setShowForm(false)}>Cancelar</Btn>
              <Btn size="sm" variant="primary" onClick={save}>{editId ? 'Guardar' : 'Crear producto'}</Btn>
            </div>
          </div>
        </div>
      )}
      </>)}
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   TAB PROVEEDORES
   ═══════════════════════════════════════════════════════════════════ */

interface SupplierFull {
  id: string; name: string; rfc?: string; contacto?: string; telefono?: string; email?: string
  direccion?: string; notas?: string; is_active: boolean; sistemas?: string[]
}

function TabProveedores({ suppliers, setSuppliers }: { suppliers: Supplier[]; setSuppliers: (s: Supplier[]) => void }) {
  const [proveedores, setProveedores] = useState<SupplierFull[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<Partial<SupplierFull>>({ name: '', is_active: true, sistemas: [] })
  const [extracting, setExtracting] = useState(false)
  const [extractStatus, setExtractStatus] = useState('')
  const pdfRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.from('suppliers').select('*').order('name').then(({ data }) => {
      if (data) setProveedores(data.map((s: any) => ({
        id: s.id, name: s.name || '', rfc: s.rfc || '', contacto: s.contacto || '',
        telefono: s.telefono || '', email: s.email || '', direccion: s.direccion || '',
        notas: s.notas || '', is_active: s.is_active !== false,
        sistemas: s.sistemas || [],
      })))
    })
  }, [])

  const handlePdfExtract = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setExtracting(true); setExtractStatus('Leyendo PDF...')
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res((r.result as string).split(',')[1])
        r.onerror = () => rej(new Error('Error leyendo PDF'))
        r.readAsDataURL(file)
      })
      setExtractStatus('Extrayendo datos con AI...')
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-version': '2023-06-01', 'x-api-key': ANTHROPIC_API_KEY },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 2000,
          messages: [{ role: 'user', content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: `Extrae los datos del proveedor de este documento (puede ser una Constancia de Situación Fiscal CSF, una factura CFDI, o cualquier documento fiscal mexicano).

Devuelve SOLO un JSON sin markdown:
{"nombre":"razón social completa","rfc":"RFC del proveedor","contacto":"nombre de contacto si aparece","telefono":"teléfono si aparece","email":"email si aparece","direccion":"dirección fiscal completa","sistemas":["sistemas que podría proveer basándote en los productos/servicios mencionados: CCTV, Audio, Redes, Control de iluminacion, Control de acceso, Electrico, Iluminacion, Cortinas, General"]}

Si un campo no aparece, déjalo como string vacío. Para sistemas, infiere del giro o productos mencionados.` }
          ] }],
        }),
      })
      if (response.ok) {
        const data = await response.json()
        const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0].replace(/```json|```/g, '').trim())
          setForm(f => ({
            ...f,
            name: parsed.nombre || f.name,
            rfc: parsed.rfc || f.rfc,
            contacto: parsed.contacto || f.contacto,
            telefono: parsed.telefono || f.telefono,
            email: parsed.email || f.email,
            direccion: parsed.direccion || f.direccion,
            sistemas: parsed.sistemas?.length > 0 ? parsed.sistemas : f.sistemas,
          }))
          setExtractStatus('✓ Datos extraídos')
        } else { setExtractStatus('No se pudieron extraer datos') }
      } else { setExtractStatus('Error API') }
    } catch (err) { setExtractStatus('Error: ' + (err as Error).message) }
    setExtracting(false)
    if (pdfRef.current) pdfRef.current.value = ''
  }

  const filtered = proveedores.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.rfc || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.contacto || '').toLowerCase().includes(search.toLowerCase())
  )

  const openNew = () => {
    setEditId(null)
    setForm({ name: '', rfc: '', contacto: '', telefono: '', email: '', direccion: '', notas: '', is_active: true, sistemas: [] })
    setShowForm(true)
  }
  const openEdit = (p: SupplierFull) => { setEditId(p.id); setForm({ ...p }); setShowForm(true) }

  const toggleSistema = (s: string) => {
    const cur = form.sistemas || []
    setForm({ ...form, sistemas: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s] })
  }

  const save = async () => {
    if (!form.name?.trim()) return
    const dbRow = {
      name: form.name!.trim(), rfc: form.rfc || null, contacto: form.contacto || null,
      telefono: form.telefono || null, email: form.email || null, direccion: form.direccion || null,
      notas: form.notas || null, is_active: form.is_active !== false, sistemas: form.sistemas || [],
    }
    const stateRow: SupplierFull = {
      id: editId || '', name: dbRow.name, rfc: form.rfc || '', contacto: form.contacto || '',
      telefono: form.telefono || '', email: form.email || '', direccion: form.direccion || '',
      notas: form.notas || '', is_active: dbRow.is_active, sistemas: dbRow.sistemas,
    }
    if (editId) {
      await supabase.from('suppliers').update(dbRow).eq('id', editId)
      setProveedores(prev => prev.map(p => p.id === editId ? { ...stateRow, id: editId } : p))
    } else {
      const { data } = await supabase.from('suppliers').insert(dbRow).select().single()
      if (data) {
        setProveedores(prev => [{ ...stateRow, id: data.id }, ...prev])
        setSuppliers([...suppliers, { id: data.id, name: dbRow.name }])
      }
    }
    setShowForm(false)
  }

  const SYSTEMS = ['CCTV', 'Audio', 'Redes', 'Control de iluminacion', 'Control de acceso', 'Electrico', 'Iluminacion', 'Cortinas', 'General']
  const fS: React.CSSProperties = { width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#555' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar proveedor..." style={{ ...fS, width: 280, paddingLeft: 32 }} />
        </div>
        <Btn size="sm" variant="primary" onClick={openNew}><Plus size={12} /> Nuevo proveedor</Btn>
      </div>

      {filtered.length === 0 ? <EmptyState message="No hay proveedores registrados" /> : (
        <Table>
          <thead><tr>
            <Th>Proveedor</Th><Th>RFC</Th><Th>Contacto</Th><Th>Teléfono</Th><Th>Email</Th><Th>Sistemas</Th><Th>Estado</Th><Th></Th>
          </tr></thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id}>
                <Td><span style={{ fontWeight: 600, color: '#fff' }}>{p.name}</span></Td>
                <Td muted>{p.rfc || '—'}</Td>
                <Td muted>{p.contacto || '—'}</Td>
                <Td muted>{p.telefono || '—'}</Td>
                <Td muted>{p.email || '—'}</Td>
                <Td>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {(p.sistemas || []).map(s => <Badge key={s} label={s.length > 10 ? s.substring(0, 8) + '..' : s} color="#3B82F6" />)}
                  </div>
                </Td>
                <Td><Badge label={p.is_active ? 'Activo' : 'Inactivo'} color={p.is_active ? '#57FF9A' : '#6B7280'} /></Td>
                <Td><button onClick={() => openEdit(p)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><Edit size={14} /></button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* Form modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowForm(false)}>
          <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 24, width: 520, maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>{editId ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            {/* PDF extraction */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, padding: '10px 12px', background: '#0d0d0d', borderRadius: 8, border: '1px solid #222' }}>
              <input type="file" ref={pdfRef} accept=".pdf" style={{ display: 'none' }} onChange={handlePdfExtract} />
              <Btn size="sm" variant="default" onClick={() => pdfRef.current?.click()} disabled={extracting}>
                {extracting ? <><Loader2 size={12} /> Extrayendo...</> : <><Upload size={12} /> Subir CSF o factura PDF</>}
              </Btn>
              <span style={{ fontSize: 10, color: '#555' }}>Extrae datos automáticamente con AI</span>
              {extractStatus && <span style={{ fontSize: 10, color: extractStatus.startsWith('✓') ? '#57FF9A' : '#888', marginLeft: 'auto' }}>{extractStatus}</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Fld label="Nombre *"><input style={fS} value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} /></Fld>
              <Fld label="RFC"><input style={fS} value={form.rfc || ''} onChange={e => setForm({ ...form, rfc: e.target.value.toUpperCase() })} placeholder="XAXX010101000" /></Fld>
              <Fld label="Contacto"><input style={fS} value={form.contacto || ''} onChange={e => setForm({ ...form, contacto: e.target.value })} /></Fld>
              <Fld label="Teléfono"><input style={fS} value={form.telefono || ''} onChange={e => setForm({ ...form, telefono: e.target.value })} /></Fld>
              <Fld label="Email" span><input type="email" style={fS} value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} /></Fld>
              <Fld label="Dirección" span><input style={fS} value={form.direccion || ''} onChange={e => setForm({ ...form, direccion: e.target.value })} /></Fld>
              <Fld label="Sistemas que provee" span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {SYSTEMS.map(s => {
                    const sel = (form.sistemas || []).includes(s)
                    return (
                      <button key={s} onClick={() => toggleSistema(s)} style={{
                        padding: '4px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                        background: sel ? 'rgba(59,130,246,0.15)' : '#0a0a0a',
                        border: `1px solid ${sel ? '#3B82F6' : '#333'}`, color: sel ? '#3B82F6' : '#666',
                      }}>{s}</button>
                    )
                  })}
                </div>
              </Fld>
              <Fld label="Notas" span><textarea style={{ ...fS, resize: 'vertical' }} rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} /></Fld>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <Btn size="sm" variant="default" onClick={() => setShowForm(false)}>Cancelar</Btn>
              <Btn size="sm" variant="primary" onClick={save}>{editId ? 'Guardar' : 'Crear proveedor'}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
