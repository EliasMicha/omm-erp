import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { F } from '../lib/utils'
import { SectionHeader, Btn, Loading, Badge } from '../components/layout/UI'
import { Upload, ChevronRight, ChevronLeft, Zap, Loader2, Trash2, Plus, Minus, CheckCircle, AlertTriangle, FileText, MapPin, Eye } from 'lucide-react'

/* ─── Types ─── */
interface AreaItem {
  catalog_product_id: string | null
  is_new_suggestion: boolean
  marca: string
  modelo: string
  system: string
  description: string
  quantity: number
  notes: string
}

interface PlanArea {
  name: string
  level: string
  estimated_m2: number | null
  description: string
  items: AreaItem[]
}

interface AnalysisResult {
  areas: PlanArea[]
  plan_summary: string
  rationale: string
  warnings: string[]
}

interface CatalogProduct {
  id: string
  name: string
  marca: string
  modelo: string
  system: string
  provider: string
  moneda: string
  cost: number
  description: string
  markup: number
}

interface Precedent {
  name: string
  specialty: string
  total: number
  items: { area_name: string; name: string; system: string; quantity: number; marca: string; modelo: string }[]
}

const SYSTEMS = [
  { id: 'Audio', label: 'Audio', color: '#57FF9A' },
  { id: 'Redes', label: 'Redes', color: '#3B82F6' },
  { id: 'CCTV', label: 'CCTV', color: '#EF4444' },
  { id: 'Control de Acceso', label: 'Control de Acceso', color: '#F59E0B' },
  { id: 'Control de Iluminación', label: 'Control de Iluminación', color: '#A855F7' },
  { id: 'Detección de Humo', label: 'Detección de Humo', color: '#EF4444' },
  { id: 'BMS', label: 'BMS', color: '#06B6D4' },
  { id: 'Telefonía', label: 'Telefonía', color: '#06B6D4' },
  { id: 'Red Celular', label: 'Red Celular', color: '#8B5CF6' },
  { id: 'Cortinas', label: 'Cortinas', color: '#67E8F9' },
]

const PROJECT_TYPES = [
  'Residencial',
  'Departamento',
  'Corporativo / Oficinas',
  'Hotel / Hospitalidad',
  'Restaurante / Comercial',
  'Hospital / Salud',
  'Educativo',
  'Industrial',
]

/* ─── Styles ─── */
const card = { background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '16px 20px' }
const input: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, width: '100%', outline: 'none' }
const label: React.CSSProperties = { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block' }

/* ─── Main Component ─── */
export default function PlanAnalyzer({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(0) // 0=upload, 1=scope, 2=analyzing, 3=review
  const [planFile, setPlanFile] = useState<File | null>(null)
  const [planPreview, setPlanPreview] = useState<string>('')
  const [planBase64, setPlanBase64] = useState<string>('')
  const [planMediaType, setPlanMediaType] = useState<string>('')

  // Scope
  const [projectType, setProjectType] = useState('Residencial')
  const [selectedSystems, setSelectedSystems] = useState<string[]>(['Audio', 'Redes', 'CCTV', 'Control de Acceso'])
  const [scopeNotes, setScopeNotes] = useState('')
  const [clientName, setClientName] = useState('')

  // Data from DB
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [precedents, setPrecedents] = useState<Precedent[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // Analysis
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')

  // Review edits
  const [editedAreas, setEditedAreas] = useState<PlanArea[]>([])
  const [expandedArea, setExpandedArea] = useState<number | null>(null)

  // Creating quotation
  const [creating, setCreating] = useState(false)

  // Load catalog and precedents on mount
  useEffect(() => {
    const load = async () => {
      try {
        const [catRes, precRes] = await Promise.all([
          supabase.from('catalog_products').select('id,name,description,marca,modelo,system,provider,moneda,cost,markup').eq('is_active', true),
          supabase.from('quotations').select('id,name,specialty,total,notes').eq('specialty', 'esp').order('updated_at', { ascending: false }).limit(10),
        ])

        setCatalog((catRes.data || []) as CatalogProduct[])

        // Cargar items de precedentes
        const precIds = (precRes.data || []).map((p: { id: string }) => p.id)
        if (precIds.length > 0) {
          const { data: allItems } = await supabase
            .from('quotation_items')
            .select('quotation_id,name,system,quantity,marca,modelo,area_id')
            .in('quotation_id', precIds)

          const { data: allAreas } = await supabase
            .from('quotation_areas')
            .select('id,name,quotation_id')
            .in('quotation_id', precIds)

          const areaNameMap: Record<string, string> = {}
          ;(allAreas || []).forEach((a: { id: string; name: string }) => { areaNameMap[a.id] = a.name })

          const precFormatted: Precedent[] = (precRes.data || []).map((q: { id: string; name: string; specialty: string; total: number }) => ({
            name: q.name,
            specialty: q.specialty,
            total: q.total,
            items: (allItems || [])
              .filter((it: { quotation_id: string }) => it.quotation_id === q.id)
              .map((it: { area_id: string; name: string; system: string; quantity: number; marca: string; modelo: string }) => ({
                area_name: areaNameMap[it.area_id] || 'Sin área',
                name: it.name,
                system: it.system || '',
                quantity: it.quantity,
                marca: it.marca || '',
                modelo: it.modelo || '',
              })),
          }))
          setPrecedents(precFormatted)
        }
      } catch (e) {
        console.error('Error loading data:', e)
      }
      setLoadingData(false)
    }
    load()
  }, [])

  // File upload handler
  const handleFile = useCallback((file: File) => {
    const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    if (!validTypes.includes(file.type)) {
      setError('Formato no soportado. Usa PDF, PNG, JPG o WebP.')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Archivo demasiado grande. Máximo 20MB.')
      return
    }
    setPlanFile(file)
    setPlanMediaType(file.type)
    setError('')

    // Preview para imágenes
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setPlanPreview(url)
    } else {
      setPlanPreview('')
    }

    // Base64
    const reader = new FileReader()
    reader.onload = () => {
      const b64 = (reader.result as string).split(',')[1] || ''
      setPlanBase64(b64)
    }
    reader.readAsDataURL(file)
  }, [])

  // Drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  // Toggle system
  const toggleSystem = (id: string) => {
    setSelectedSystems(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    )
  }

  // Run analysis
  const analyze = async () => {
    if (!planBase64) return
    setStep(2)
    setAnalyzing(true)
    setError('')

    try {
      const catalogForApi = catalog.map(p => ({
        id: p.id, name: p.name, marca: p.marca, modelo: p.modelo,
        system: p.system, provider: p.provider, moneda: p.moneda,
        cost: p.cost, description: p.description,
      }))

      const resp = await fetch('/api/analyze-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: planBase64,
          mediaType: planMediaType,
          scope: {
            projectType,
            systems: selectedSystems,
            notes: scopeNotes,
            clientName,
          },
          catalog: catalogForApi,
          precedents,
        }),
      })

      const data = await resp.json()
      if (!data.ok) {
        setError(data.error || 'Error al analizar el plano')
        setStep(1)
      } else {
        setResult(data)
        setEditedAreas(JSON.parse(JSON.stringify(data.areas)))
        setExpandedArea(0)
        setStep(3)
      }
    } catch (e) {
      setError('Error de conexión con el servidor')
      setStep(1)
    }
    setAnalyzing(false)
  }

  // Edit handlers
  const updateItemQty = (areaIdx: number, itemIdx: number, delta: number) => {
    setEditedAreas(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      const item = next[areaIdx].items[itemIdx]
      item.quantity = Math.max(0, item.quantity + delta)
      return next
    })
  }

  const removeItem = (areaIdx: number, itemIdx: number) => {
    setEditedAreas(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      next[areaIdx].items.splice(itemIdx, 1)
      return next
    })
  }

  const removeArea = (areaIdx: number) => {
    setEditedAreas(prev => prev.filter((_, i) => i !== areaIdx))
  }

  // Create quotation from result
  const createQuotation = async () => {
    if (!editedAreas.length) return
    setCreating(true)
    setError('')

    try {
      // 1. Create project
      const projName = clientName ? `${clientName} - Plan AI` : `Proyecto Plan AI ${new Date().toLocaleDateString('es-MX')}`
      const { data: proj, error: projErr } = await supabase
        .from('projects')
        .insert({ name: projName, client_name: clientName || 'Sin cliente', status: 'activo', lines: ['esp'], advance_pct: 0, contract_value: 0 })
        .select('id')
        .single()
      if (projErr) throw projErr

      // 2. Create quotation
      const notesJson = JSON.stringify({
        systems: selectedSystems.map(s => s.toLowerCase().replace(/ /g, '_')),
        currency: 'USD',
        plan_analysis: true,
        project_type: projectType,
        plan_summary: result?.plan_summary || '',
      })

      const { data: quot, error: quotErr } = await supabase
        .from('quotations')
        .insert({
          project_id: proj.id,
          name: projName,
          specialty: 'esp',
          stage: 'estimacion',
          client_name: clientName || '',
          total: 0,
          notes: notesJson,
        })
        .select('id')
        .single()
      if (quotErr) throw quotErr

      // 3. Create areas and items
      let totalGeneral = 0
      for (let ai = 0; ai < editedAreas.length; ai++) {
        const area = editedAreas[ai]
        const validItems = area.items.filter(it => it.quantity > 0)
        if (validItems.length === 0) continue

        const { data: areaRow, error: areaErr } = await supabase
          .from('quotation_areas')
          .insert({ quotation_id: quot.id, name: area.name, order_index: ai, subtotal: 0 })
          .select('id')
          .single()
        if (areaErr) throw areaErr

        let areaSubtotal = 0
        const itemInserts = validItems.map((it, ii) => {
          // Look up catalog product for pricing
          const catProd = it.catalog_product_id
            ? catalog.find(c => c.id === it.catalog_product_id)
            : null
          const cost = catProd ? catProd.cost : 0
          const markup = catProd ? catProd.markup : 40
          const price = Math.round(cost * (1 + markup / 100))
          const total = price * it.quantity
          areaSubtotal += total

          return {
            quotation_id: quot.id,
            area_id: areaRow.id,
            catalog_product_id: it.catalog_product_id,
            name: [it.marca, it.modelo].filter(Boolean).join(' ') || it.description,
            description: it.description,
            system: it.system,
            type: 'material' as const,
            quantity: it.quantity,
            cost,
            markup,
            price,
            total,
            installation_cost: 0,
            order_index: ii,
            purchase_phase: 'inicio' as const,
            marca: it.marca,
            modelo: it.modelo,
          }
        })

        if (itemInserts.length > 0) {
          const { error: itemsErr } = await supabase.from('quotation_items').insert(itemInserts)
          if (itemsErr) throw itemsErr
        }

        // Update area subtotal
        await supabase.from('quotation_areas').update({ subtotal: areaSubtotal }).eq('id', areaRow.id)
        totalGeneral += areaSubtotal
      }

      // 4. Update quotation total
      await supabase.from('quotations').update({ total: totalGeneral }).eq('id', quot.id)

      // Done — go back to cotizaciones
      onBack()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error creando la cotización'
      setError(msg)
    }
    setCreating(false)
  }

  // Count totals
  const totalItems = editedAreas.reduce((s, a) => s + a.items.filter(it => it.quantity > 0).length, 0)
  const totalAreas = editedAreas.filter(a => a.items.some(it => it.quantity > 0)).length
  const catalogMatches = editedAreas.reduce((s, a) => s + a.items.filter(it => it.catalog_product_id).length, 0)
  const suggestions = editedAreas.reduce((s, a) => s + a.items.filter(it => it.is_new_suggestion).length, 0)

  const systemColor = (sys: string) => SYSTEMS.find(s => s.id === sys)?.color || '#888'

  /* ─── STEP 0: Upload ─── */
  if (step === 0) {
    return (
      <div style={{ padding: '24px 28px', maxWidth: 800 }}>
        <SectionHeader title="Analizar Plano con AI" subtitle="Sube un plano arquitectónico para generar una propuesta de sembrado automática"
          action={<Btn onClick={onBack}><ChevronLeft size={14} /> Volver</Btn>} />

        <div style={{ ...card, marginTop: 20 }}>
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => document.getElementById('plan-input')?.click()}
            style={{
              border: '2px dashed #333', borderRadius: 12, padding: '48px 24px', textAlign: 'center',
              cursor: 'pointer', transition: 'border-color 0.2s',
              background: planFile ? 'rgba(87,255,154,0.03)' : 'transparent',
              borderColor: planFile ? '#57FF9A44' : '#333',
            }}
          >
            <input id="plan-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />

            {planFile ? (
              <div>
                <CheckCircle size={32} color="#57FF9A" style={{ marginBottom: 12 }} />
                <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{planFile.name}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{(planFile.size / 1024 / 1024).toFixed(1)} MB · {planMediaType}</div>
                {planPreview && (
                  <img src={planPreview} alt="Preview" style={{ maxWidth: 400, maxHeight: 300, borderRadius: 8, marginTop: 16, border: '1px solid #333' }} />
                )}
                <div style={{ marginTop: 12, fontSize: 12, color: '#57FF9A', cursor: 'pointer' }}
                  onClick={e => { e.stopPropagation(); setPlanFile(null); setPlanBase64(''); setPlanPreview('') }}>
                  Cambiar archivo
                </div>
              </div>
            ) : (
              <div>
                <Upload size={32} color="#555" style={{ marginBottom: 12 }} />
                <div style={{ fontSize: 15, fontWeight: 600, color: '#ccc', marginBottom: 4 }}>Arrastra tu plano aqui o haz click para seleccionar</div>
                <div style={{ fontSize: 12, color: '#666' }}>PDF, PNG, JPG o WebP · Maximo 20MB</div>
              </div>
            )}
          </div>

          {error && <div style={{ color: '#EF4444', fontSize: 13, marginTop: 12 }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <Btn variant="primary" onClick={() => setStep(1)} style={{ opacity: planBase64 ? 1 : 0.4, pointerEvents: planBase64 ? 'auto' : 'none' }}>
            Siguiente: Definir Scope <ChevronRight size={14} />
          </Btn>
        </div>
      </div>
    )
  }

  /* ─── STEP 1: Scope ─── */
  if (step === 1) {
    return (
      <div style={{ padding: '24px 28px', maxWidth: 800 }}>
        <SectionHeader title="Definir Scope del Proyecto" subtitle="Indica que sistemas necesita el cliente y el tipo de proyecto"
          action={<Btn onClick={() => setStep(0)}><ChevronLeft size={14} /> Atras</Btn>} />

        <div style={{ ...card, marginTop: 20 }}>
          {/* Tipo de proyecto */}
          <div style={{ marginBottom: 20 }}>
            <label style={label}>Tipo de proyecto</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PROJECT_TYPES.map(pt => (
                <div key={pt} onClick={() => setProjectType(pt)}
                  style={{
                    padding: '6px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                    background: projectType === pt ? 'rgba(87,255,154,0.15)' : '#1a1a1a',
                    border: projectType === pt ? '1px solid #57FF9A66' : '1px solid #333',
                    color: projectType === pt ? '#57FF9A' : '#aaa',
                    fontWeight: projectType === pt ? 600 : 400,
                  }}>
                  {pt}
                </div>
              ))}
            </div>
          </div>

          {/* Cliente */}
          <div style={{ marginBottom: 20 }}>
            <label style={label}>Cliente (opcional)</label>
            <input style={input} placeholder="Nombre del cliente o proyecto" value={clientName} onChange={e => setClientName(e.target.value)} />
          </div>

          {/* Sistemas */}
          <div style={{ marginBottom: 20 }}>
            <label style={label}>Sistemas solicitados</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SYSTEMS.map(sys => {
                const active = selectedSystems.includes(sys.id)
                return (
                  <div key={sys.id} onClick={() => toggleSystem(sys.id)}
                    style={{
                      padding: '6px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                      background: active ? `${sys.color}18` : '#1a1a1a',
                      border: active ? `1px solid ${sys.color}66` : '1px solid #333',
                      color: active ? sys.color : '#666',
                      fontWeight: active ? 600 : 400,
                    }}>
                    {sys.label}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Notas */}
          <div>
            <label style={label}>Notas adicionales del scope</label>
            <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }}
              placeholder="Ej: El cliente quiere audio Sonos en toda la casa, iluminacion Lutron RadioRA3, 8 camaras exterior..."
              value={scopeNotes} onChange={e => setScopeNotes(e.target.value)} />
          </div>
        </div>

        {/* Info de datos cargados */}
        <div style={{ ...card, marginTop: 12, display: 'flex', gap: 20, fontSize: 12, color: '#888' }}>
          {loadingData ? (
            <span><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Cargando catalogo y precedentes...</span>
          ) : (
            <>
              <span style={{ color: '#57FF9A' }}>{catalog.length} productos en catalogo</span>
              <span style={{ color: '#3B82F6' }}>{precedents.length} cotizaciones de referencia</span>
            </>
          )}
        </div>

        {error && <div style={{ color: '#EF4444', fontSize: 13, marginTop: 12, ...card }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
          <Btn onClick={() => setStep(0)}><ChevronLeft size={14} /> Atras</Btn>
          <Btn variant="primary" onClick={analyze}
            style={{ opacity: selectedSystems.length > 0 && !loadingData ? 1 : 0.4, pointerEvents: selectedSystems.length > 0 && !loadingData ? 'auto' : 'none' }}>
            <Zap size={14} /> Analizar con AI
          </Btn>
        </div>
      </div>
    )
  }

  /* ─── STEP 2: Analyzing ─── */
  if (step === 2) {
    return (
      <div style={{ padding: '24px 28px', maxWidth: 800, textAlign: 'center' }}>
        <div style={{ ...card, marginTop: 60, padding: '48px 24px' }}>
          <Loader2 size={40} color="#57FF9A" style={{ animation: 'spin 1s linear infinite', marginBottom: 16 }} />
          <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 8 }}>Analizando plano con AI...</div>
          <div style={{ fontSize: 13, color: '#888', maxWidth: 400, margin: '0 auto' }}>
            Claude esta leyendo el plano, identificando areas y proponiendo equipos de tu catalogo. Esto puede tomar 15-30 segundos.
          </div>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            {selectedSystems.map(s => (
              <Badge key={s} style={{ background: `${systemColor(s)}18`, color: systemColor(s), border: `1px solid ${systemColor(s)}44` }}>{s}</Badge>
            ))}
          </div>
        </div>
      </div>
    )
  }

  /* ─── STEP 3: Review ─── */
  return (
    <div style={{ padding: '24px 28px' }}>
      <SectionHeader title="Propuesta de Sembrado AI" subtitle={`${totalAreas} areas · ${totalItems} equipos · ${catalogMatches} del catalogo · ${suggestions} sugerencias nuevas`}
        action={<div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={() => setStep(1)}><ChevronLeft size={14} /> Modificar scope</Btn>
          <Btn variant="primary" onClick={createQuotation} style={{ opacity: creating ? 0.5 : 1 }}>
            {creating ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Creando...</> : <><CheckCircle size={14} /> Crear cotizacion</>}
          </Btn>
        </div>} />

      {error && <div style={{ ...card, color: '#EF4444', fontSize: 13, marginTop: 12 }}>{error}</div>}

      {/* Summary cards */}
      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
          <div style={{ ...card, borderLeft: '2px solid #57FF9A' }}>
            <div style={{ ...label, marginBottom: 8 }}>Resumen del plano</div>
            <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.6 }}>{result.plan_summary}</div>
          </div>
          <div style={{ ...card, borderLeft: '2px solid #3B82F6' }}>
            <div style={{ ...label, marginBottom: 8 }}>Logica de la propuesta</div>
            <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.6 }}>{result.rationale}</div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {result && result.warnings.length > 0 && (
        <div style={{ ...card, marginTop: 12, borderLeft: '2px solid #F59E0B' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <AlertTriangle size={14} color="#F59E0B" />
            <span style={{ ...label, marginBottom: 0 }}>Advertencias</span>
          </div>
          {result.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: '#F59E0B', marginBottom: 4 }}>- {w}</div>
          ))}
        </div>
      )}

      {/* Areas */}
      <div style={{ marginTop: 20 }}>
        {editedAreas.map((area, ai) => {
          const expanded = expandedArea === ai
          const areaItemCount = area.items.filter(it => it.quantity > 0).length
          const areaSystems = [...new Set(area.items.map(it => it.system))]

          return (
            <div key={ai} style={{ ...card, marginBottom: 8, borderLeft: `2px solid ${expanded ? '#57FF9A' : '#333'}` }}>
              {/* Area header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onClick={() => setExpandedArea(expanded ? null : ai)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <MapPin size={14} color={expanded ? '#57FF9A' : '#666'} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{area.name}</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                      {area.level && `${area.level} · `}{area.estimated_m2 && `~${area.estimated_m2} m² · `}{areaItemCount} equipos
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {areaSystems.map(s => (
                    <span key={s} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: `${systemColor(s)}18`, color: systemColor(s) }}>{s}</span>
                  ))}
                  <Btn onClick={(e: React.MouseEvent) => { e.stopPropagation(); removeArea(ai) }} style={{ padding: '4px 6px', color: '#EF4444' }}>
                    <Trash2 size={12} />
                  </Btn>
                  <Eye size={14} color={expanded ? '#57FF9A' : '#555'} />
                </div>
              </div>

              {/* Area description */}
              {expanded && area.description && (
                <div style={{ fontSize: 12, color: '#888', marginTop: 8, paddingLeft: 24 }}>{area.description}</div>
              )}

              {/* Items table */}
              {expanded && (
                <div style={{ marginTop: 12 }}>
                  {area.items.map((item, ii) => (
                    <div key={ii} style={{
                      display: 'grid', gridTemplateColumns: '1fr 90px 80px 28px', gap: 8, alignItems: 'center',
                      padding: '8px 0', borderTop: ii > 0 ? '1px solid #1a1a1a' : 'none',
                      opacity: item.quantity === 0 ? 0.3 : 1,
                    }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: `${systemColor(item.system)}18`, color: systemColor(item.system) }}>
                            {item.system}
                          </span>
                          {item.is_new_suggestion && (
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: '#F59E0B18', color: '#F59E0B' }}>Sugerencia</span>
                          )}
                          {item.catalog_product_id && (
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: '#57FF9A18', color: '#57FF9A' }}>Catalogo</span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: '#fff', fontWeight: 500, marginTop: 4 }}>
                          {item.marca} {item.modelo}
                        </div>
                        <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{item.description}</div>
                        {item.notes && <div style={{ fontSize: 10, color: '#555', marginTop: 2, fontStyle: 'italic' }}>{item.notes}</div>}
                      </div>

                      {/* Price info */}
                      <div style={{ textAlign: 'right' }}>
                        {item.catalog_product_id && (() => {
                          const cat = catalog.find(c => c.id === item.catalog_product_id)
                          if (!cat) return null
                          return (
                            <div style={{ fontSize: 11, color: '#888' }}>
                              {cat.moneda} {F(cat.cost)}/u
                            </div>
                          )
                        })()}
                      </div>

                      {/* Quantity controls */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                        <div onClick={() => updateItemQty(ai, ii, -1)}
                          style={{ cursor: 'pointer', padding: '2px 4px', borderRadius: 4, background: '#1a1a1a' }}>
                          <Minus size={10} color="#888" />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', minWidth: 20, textAlign: 'center' }}>
                          {item.quantity}
                        </span>
                        <div onClick={() => updateItemQty(ai, ii, 1)}
                          style={{ cursor: 'pointer', padding: '2px 4px', borderRadius: 4, background: '#1a1a1a' }}>
                          <Plus size={10} color="#888" />
                        </div>
                      </div>

                      {/* Remove */}
                      <div onClick={() => removeItem(ai, ii)} style={{ cursor: 'pointer', textAlign: 'center' }}>
                        <Trash2 size={12} color="#EF4444" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Bottom action bar */}
      <div style={{ ...card, marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', bottom: 16 }}>
        <div style={{ fontSize: 13, color: '#888' }}>
          {totalAreas} areas · {totalItems} equipos · {catalogMatches} del catalogo
        </div>
        <Btn variant="primary" onClick={createQuotation} style={{ opacity: creating || totalItems === 0 ? 0.5 : 1 }}>
          {creating ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Creando...</> : <><CheckCircle size={14} /> Crear cotizacion</>}
        </Btn>
      </div>

      {/* Spin animation */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
