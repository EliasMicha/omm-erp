import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Btn } from '../components/layout/UI'
import { useIsMobile } from '../lib/useIsMobile'
import {
  X, Zap, Loader2, AlertTriangle, CheckCircle2, Trash2, Plus, Minus,
  ChevronRight, ChevronLeft, GripVertical, Search, Package,
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════ */

interface AIQuoteLiveProps {
  scope: {
    mode: string
    freetext: string
    tipo: string
    nombre: string
    cliente: string
    tamano_m2: number | null
    habitaciones: number | null
    ubicacion: string
    nivel: string
    sistemas: string[]
    areas_custom: string
    notas: string
  }
  planFiles: Array<{ file: File; url: string; mediaType: string; preview: string; uploading: boolean }>
  catalog: Array<{
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
  }>
  precedents: Array<{
    name: string
    specialty: string
    total: number
    items: Array<{ area_name: string; name: string; system: string; quantity: number; marca: string; modelo: string }>
  }>
  onClose: () => void
  onCreated: (quotationId: string, specialty: string) => void
  clientId?: string
  selectedLeadId?: string
  selectedLead?: { id: string; name: string; company: string } | null
}

interface Zone {
  name: string
  level: string
  estimated_m2: number
  description: string
}

interface ConfirmedItem {
  zone: string
  marca: string
  modelo: string
  description: string
  quantity: number
  notes: string
  catalog_product_id?: string
}

/* ═══════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════ */

const SYSTEM_STEPS: Record<string, { name: string; color: string }> = {
  'control_iluminacion': { name: 'Iluminación', color: '#C084FC' },
  'audio': { name: 'Audio', color: '#8B5CF6' },
  'redes': { name: 'Redes', color: '#06B6D4' },
  'cctv': { name: 'CCTV', color: '#3B82F6' },
  'control_acceso': { name: 'Acceso', color: '#F59E0B' },
  'deteccion_humo': { name: 'Humo', color: '#EF4444' },
  'cortinas': { name: 'Cortinas', color: '#67E8F9' },
  'bms': { name: 'BMS', color: '#10B981' },
  'telefonia': { name: 'Telefonía', color: '#F97316' },
  'red_celular': { name: 'Celular', color: '#EC4899' },
}

const SYSTEM_ENUM: Record<string, string> = {
  'audio': 'Audio',
  'redes': 'Redes',
  'cctv': 'CCTV',
  'control_acceso': 'Control de Acceso',
  'control_iluminacion': 'Control de Iluminación',
  'deteccion_humo': 'Detección de Humo',
  'bms': 'BMS',
  'telefonia': 'Telefonía',
  'red_celular': 'Red Celular',
  'cortinas': 'Cortinas',
}

// Order of systems in the flow
const SYSTEM_ORDER = [
  'control_iluminacion',
  'audio',
  'redes',
  'cctv',
  'control_acceso',
  'deteccion_humo',
  'cortinas',
  'bms',
  'telefonia',
  'red_celular',
]

/* ═══════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════ */

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.85)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1030,
}

const modalStyle: React.CSSProperties = {
  background: '#141414',
  border: '1px solid #333',
  borderRadius: 16,
  width: '96vw',
  maxWidth: 1400,
  height: '94vh',
  display: 'flex',
  flexDirection: 'column',
}

const sLabel: React.CSSProperties = {
  fontSize: 10,
  color: '#555',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
  marginBottom: 6,
  display: 'block',
}

const inputS: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#1e1e1e',
  border: '1px solid #333',
  borderRadius: 8,
  color: '#fff',
  fontSize: 13,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

/* ═══════════════════════════════════════════════════════════
   HELPER FUNCTIONS
   ═══════════════════════════════════════════════════════════ */

function parseJSON(text: string): any {
  const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) return JSON.parse(match[0])
  throw new Error('No JSON found in response')
}

async function callAI(
  messages: { role: string; content: string }[],
  scope: any,
  planUrls: any[],
  catalog: any[],
  precedents: any[]
): Promise<{ ok: boolean; text: string; type: string; zones?: Zone[]; items?: any[] }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180000) // 3 min — system calls need time

  try {
    const r = await fetch('/api/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, scope, planUrls, catalog, precedents }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const data = await r.json()

    if (!r.ok || !data.ok) {
      throw new Error(data.error || `Error ${r.status}`)
    }

    return data
  } catch (err: any) {
    clearTimeout(timeout)
    throw err
  }
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function AIQuoteLive({
  scope,
  planFiles,
  catalog,
  precedents,
  onClose,
  onCreated,
  clientId,
  selectedLeadId,
  selectedLead,
}: AIQuoteLiveProps) {
  const isMobile = useIsMobile()

  // Step tracking: 'zones', 'audio', 'redes', ..., 'rack', 'review', 'done'
  const [currentStep, setCurrentStep] = useState<string>('zones')
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set())

  // Zones
  const [zones, setZones] = useState<Zone[]>([])
  const [loadingZones, setLoadingZones] = useState(false)
  const [zonesError, setZonesError] = useState<string | null>(null)

  // Confirmed items by system
  const [confirmedItems, setConfirmedItems] = useState<Record<string, ConfirmedItem[]>>({})

  // Current step's proposed items (from AI)
  const [proposedItems, setProposedItems] = useState<ConfirmedItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)

  // Editing current items
  const [editingItems, setEditingItems] = useState<ConfirmedItem[]>([])

  // Catalog search
  const [showCatalogSearch, setShowCatalogSearch] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')

  // Create quotation
  const [inserting, setInserting] = useState(false)
  const [insertProgress, setInsertProgress] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Get the full list of steps
  const allSteps = ['zones', ...SYSTEM_ORDER.filter(s => scope.sistemas.includes(s)), 'rack', 'review']

  // Initialize editing items when proposed items change
  useEffect(() => {
    setEditingItems(proposedItems.map(item => ({ ...item })))
  }, [proposedItems])

  /* ─── Load zones on mount ─── */
  useEffect(() => {
    if (currentStep === 'zones' && zones.length === 0) {
      loadZones()
    }
  }, [currentStep])

  /* ─── Load items when moving to a system step ─── */
  useEffect(() => {
    if (currentStep !== 'zones' && currentStep !== 'review' && !currentStep.startsWith('rack') && zones.length > 0 && !completedSteps.has(currentStep)) {
      loadItems(currentStep)
    }
  }, [currentStep, zones, completedSteps])

  const loadZones = async () => {
    setLoadingZones(true)
    setZonesError(null)

    try {
      const readyPlans = planFiles.filter(p => p.url && !p.uploading)
      const planUrls = readyPlans.map(p => ({ url: p.url, mediaType: p.mediaType }))

      const msg = `Analiza los planos arquitectónicos y areas custom si existen. SOLO devuelve JSON con las zonas identificadas. Formato: {"zones": [{"name": "Sala", "level": "PB", "estimated_m2": 35, "description": "Área social principal"}]}`

      const result = await callAI(
        [{ role: 'user', content: msg }],
        scope,
        planUrls,
        catalog,
        precedents
      )

      const parsed = parseJSON(result.text)
      const loadedZones = (parsed.zones || []).map((z: any) => ({
        name: z.name || 'Zona',
        level: z.level || 'PB',
        estimated_m2: z.estimated_m2 || 0,
        description: z.description || '',
      }))

      if (loadedZones.length === 0) {
        // Fallback if no zones detected
        setZones([
          {
            name: 'Área Principal',
            level: 'PB',
            estimated_m2: scope.tamano_m2 || 100,
            description: 'Área principal del proyecto',
          },
        ])
      } else {
        setZones(loadedZones)
      }
    } catch (err: any) {
      setZonesError(err.message || 'Error al cargar zonas')
      // Provide default zone on error
      setZones([{ name: 'Área Principal', level: 'PB', estimated_m2: scope.tamano_m2 || 100, description: '' }])
    } finally {
      setLoadingZones(false)
    }
  }

  const loadItems = async (systemId: string) => {
    setLoadingItems(true)
    setItemsError(null)
    setProposedItems([])

    try {
      const systemEnum = SYSTEM_ENUM[systemId]
      const systemName = SYSTEM_STEPS[systemId]?.name || systemId
      const filteredCatalog = catalog.filter(p => p.system === systemEnum)

      const zoneList = zones.map(z => `- ${z.name} (${z.level}, ${z.estimated_m2}m²)`).join('\n')
      const msg = `Proyecto: ${scope.tipo}, ${scope.tamano_m2 || '?'}m², nivel ${scope.nivel}.
Zonas confirmadas:
${zoneList}

Para el sistema "${systemName}", propón los equipos necesarios por zona. Prioriza productos del catálogo.
RESPONDE ÚNICAMENTE con JSON válido, sin texto adicional:
{"items": [{"zone": "NombreZona", "marca": "...", "modelo": "...", "description": "breve", "quantity": 1, "notes": ""}]}`

      const result = await callAI(
        [{ role: 'user', content: msg }],
        scope,
        [],
        filteredCatalog,
        precedents
      )

      const parsed = parseJSON(result.text)
      const items: ConfirmedItem[] = (parsed.items || []).map((it: any) => ({
        zone: it.zone || 'Indefinida',
        marca: it.marca || 'AI',
        modelo: it.modelo || 'Sugerido',
        description: it.description || '',
        quantity: Math.max(1, parseInt(it.quantity) || 1),
        notes: it.notes || '',
      }))

      setProposedItems(items)
    } catch (err: any) {
      setItemsError(err.message || 'Error al cargar items')
      setProposedItems([])
    } finally {
      setLoadingItems(false)
    }
  }

  const confirmZones = () => {
    setCompletedSteps(prev => new Set([...prev, 'zones']))
    const nextSystemIdx = SYSTEM_ORDER.findIndex(s => scope.sistemas.includes(s))
    if (nextSystemIdx >= 0) {
      setCurrentStep(SYSTEM_ORDER[nextSystemIdx])
    } else {
      setCurrentStep('rack')
    }
  }

  const confirmItems = () => {
    const systemEnum = SYSTEM_ENUM[currentStep]
    if (!systemEnum) return

    setConfirmedItems(prev => ({
      ...prev,
      [systemEnum]: editingItems,
    }))

    setCompletedSteps(prev => new Set([...prev, currentStep]))

    // Find next system
    const currentIdx = SYSTEM_ORDER.findIndex(s => s === currentStep)
    const nextIdx = SYSTEM_ORDER.slice(currentIdx + 1).findIndex(s => scope.sistemas.includes(s))

    if (nextIdx >= 0) {
      setCurrentStep(SYSTEM_ORDER[currentIdx + 1 + nextIdx])
    } else {
      setCurrentStep('rack')
    }
  }

  const handleConfirm = async () => {
    setError(null)
    setInserting(true)
    setInsertProgress('Creando cotización...')

    try {
      const quotName =
        scope.nombre ||
        (scope.tipo.charAt(0).toUpperCase() + scope.tipo.slice(1) + ' AI Live ' + new Date().toLocaleDateString('es-MX'))

      const notesMeta = {
        systems: scope.sistemas,
        currency: 'USD',
        tipoCambio: 20.5,
        ai_generated: true,
        ai_scope: scope,
        ai_live: true,
        zones: zones.map(z => z.name),
        has_plan: planFiles.length > 0,
        plan_count: planFiles.length,
      }

      const { data: quot, error: qErr } = await supabase
        .from('quotations')
        .insert({
          name: quotName,
          specialty: 'esp',
          stage: 'oportunidad',
          client_name: scope.cliente || selectedLead?.company || selectedLead?.name || '',
          notes: JSON.stringify({
            ...notesMeta,
            client_id: clientId || '',
            lead_id: selectedLeadId || '',
            lead_name: selectedLead?.name || '',
          }),
        })
        .select()
        .single()

      if (qErr) throw new Error('Error creando cotización: ' + qErr.message)
      if (!quot) throw new Error('Cotización no creada')

      // Create areas
      setInsertProgress('Creando áreas...')
      const areaIdByName: Record<string, string> = {}
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i]
        const { data: newArea, error: aErr } = await supabase
          .from('quotation_areas')
          .insert({ quotation_id: quot.id, name: z.name, order_index: i, subtotal: 0 })
          .select()
          .single()
        if (aErr) throw new Error('Error creando área "' + z.name + '": ' + aErr.message)
        if (newArea) areaIdByName[z.name] = newArea.id
      }

      // Process items
      setInsertProgress('Procesando productos...')
      const createdProducts: Record<string, string> = {}
      const catalogCache: Record<string, any> = {}
      let orderIdx = 0

      // Iterate through all confirmed items
      for (const [systemEnum, items] of Object.entries(confirmedItems)) {
        for (const it of items) {
          if (it.quantity <= 0) continue

          const zoneId = areaIdByName[it.zone]
          if (!zoneId) continue

          let catalogId = it.catalog_product_id
          let productData: any = null

          if (catalogId) {
            if (!catalogCache[catalogId]) {
              const { data: cp } = await supabase
                .from('catalog_products')
                .select('id,name,description,cost,markup,provider,moneda,system')
                .eq('id', catalogId)
                .single()
              if (cp) catalogCache[catalogId] = cp
            }
            productData = catalogCache[catalogId]
          }

          if (!catalogId || !productData) {
            const cacheKey = (it.marca + '|' + it.modelo).toLowerCase()
            if (createdProducts[cacheKey]) {
              catalogId = createdProducts[cacheKey]
              if (!catalogCache[catalogId!]) {
                const { data: cp } = await supabase
                  .from('catalog_products')
                  .select('id,name,description,cost,markup,provider,moneda,system')
                  .eq('id', catalogId!)
                  .single()
                if (cp) catalogCache[catalogId!] = cp
              }
              productData = catalogCache[catalogId!]
            } else {
              const productName =
                '[AI Suggested] ' + (it.description || ((it.marca + ' ' + it.modelo).trim() || 'Producto'))
              const { data: newProd, error: pErr } = await supabase
                .from('catalog_products')
                .insert({
                  name: productName,
                  description: it.description || null,
                  system: systemEnum,
                  type: 'material',
                  unit: 'pza',
                  cost: 0,
                  markup: 33,
                  precio_venta: 0,
                  provider: 'AI Suggested',
                  marca: it.marca || 'AI Suggested',
                  modelo: it.modelo || 'AI Suggested',
                  moneda: 'USD',
                  clave_unidad: 'H87',
                  iva_rate: 0.16,
                  is_active: true,
                  purchase_phase: 'inicio',
                })
                .select()
                .single()
              if (pErr || !newProd) {
                console.error('Error creando producto:', pErr)
                continue
              }
              catalogId = newProd.id
              createdProducts[cacheKey] = newProd.id
              productData = newProd
              catalogCache[newProd.id] = newProd
            }
          }

          const cost = Number(productData?.cost) || 0
          const markup = Number(productData?.markup) || 33
          const price = cost > 0 ? Math.round((cost / (1 - markup / 100)) * 100) / 100 : 0
          const installationCost = Math.round(price * 0.22 * 100) / 100

          await supabase.from('quotation_items').insert({
            quotation_id: quot.id,
            area_id: zoneId,
            catalog_product_id: catalogId,
            name: productData?.name || ((it.marca + ' ' + it.modelo).trim() || 'Item'),
            description: it.description || productData?.description || null,
            system: systemEnum,
            type: 'material',
            provider: productData?.provider || null,
            purchase_phase: 'inicio',
            quantity: it.quantity,
            cost,
            markup,
            price,
            total: (price + installationCost) * it.quantity,
            installation_cost: installationCost,
            order_index: orderIdx++,
            marca: it.marca || productData?.marca || null,
            modelo: it.modelo || productData?.modelo || null,
          })
        }
      }

      onCreated(quot.id, 'esp')
      onClose()
    } catch (err: any) {
      setError(err.message || 'Error al crear la cotización')
      setInserting(false)
    }
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER HELPERS
     ═══════════════════════════════════════════════════════════ */

  const isStepCompleted = (step: string) => completedSteps.has(step)
  const isStepCurrent = (step: string) => currentStep === step
  const stepColor = (step: string) => {
    if (isStepCompleted(step)) return '#57FF9A'
    if (isStepCurrent(step)) return '#57FF9A'
    return '#444'
  }

  const getTotalItems = () => {
    let count = 0
    for (const items of Object.values(confirmedItems)) {
      count += items.reduce((s, it) => s + it.quantity, 0)
    }
    return count
  }

  const getTotalZones = () => zones.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', position: 'relative' }}>

        {/* ─── Error banner ─── */}
        {error && (
          <div
            style={{
              padding: '10px 16px',
              background: '#2a1414',
              borderBottom: '1px solid #5a2828',
              color: '#f87171',
              fontSize: 12,
              display: 'flex',
              gap: 8,
              flexShrink: 0,
            }}
          >
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* ─── Stepper ─── */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #222',
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            alignItems: 'center',
            flexShrink: 0,
            fontSize: 11,
          }}
        >
          {allSteps.map((step, idx) => {
            const stepLabel =
              step === 'zones'
                ? 'Zonas'
                : step === 'rack'
                  ? 'Rack'
                  : step === 'review'
                    ? 'Crear'
                    : SYSTEM_STEPS[step]?.name || step

            const isCompleted = isStepCompleted(step)
            const isCurrent = isStepCurrent(step)
            const color = stepColor(step)

            return (
              <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <button
                  onClick={() => setCurrentStep(step)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid ' + (isCurrent ? color : '#333'),
                    background: isCurrent ? color + '15' : '#0e0e0e',
                    color: color,
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  disabled={!isCompleted && !isCurrent}
                >
                  {isCompleted ? <CheckCircle2 size={12} /> : <span>{idx + 1}</span>}
                  {stepLabel}
                </button>
                {idx < allSteps.length - 1 && <ChevronRight size={14} color="#444" />}
              </div>
            )
          })}
        </div>

        {/* ─── Content Area ─── */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            overflow: 'hidden',
            flexDirection: isMobile ? 'column' : 'row',
          }}
        >
          {/* ─── Main Panel (60% on desktop) ─── */}
          <div
            style={{
              flex: isMobile ? '0 0 auto' : '0 0 60%',
              display: 'flex',
              flexDirection: 'column',
              borderRight: isMobile ? 'none' : '1px solid #222',
              padding: 20,
              overflowY: 'auto',
            }}
          >
            {/* ─── ZONES STEP ─── */}
            {currentStep === 'zones' && (
              <div>
                <h3 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Reconocimiento de Zonas</h3>

                {loadingZones && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#666', fontSize: 12 }}>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    Analizando planos...
                  </div>
                )}

                {zonesError && (
                  <div
                    style={{
                      padding: '10px 12px',
                      background: '#2a1410',
                      border: '1px solid #5a3a28',
                      borderRadius: 8,
                      color: '#f87171',
                      fontSize: 12,
                      marginBottom: 12,
                    }}
                  >
                    {zonesError}
                  </div>
                )}

                {zones.length > 0 && (
                  <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
                    {zones.map((z, i) => (
                      <div
                        key={i}
                        style={{
                          padding: 12,
                          background: '#0e0e0e',
                          border: '1px solid #222',
                          borderRadius: 8,
                          display: 'flex',
                          gap: 12,
                          alignItems: 'flex-start',
                        }}
                      >
                        <div style={{ color: '#666', marginTop: 2 }}>
                          <GripVertical size={14} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <input
                            value={z.name}
                            onChange={e => setZones(prev => prev.map((zz, ii) => (ii === i ? { ...zz, name: e.target.value } : zz)))}
                            style={{ ...inputS, marginBottom: 6 }}
                          />
                          <textarea
                            value={z.description}
                            onChange={e =>
                              setZones(prev => prev.map((zz, ii) => (ii === i ? { ...zz, description: e.target.value } : zz)))
                            }
                            placeholder="Descripción (opcional)"
                            rows={2}
                            style={{ ...inputS, resize: 'vertical' }}
                          />
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                            <div>
                              <label style={sLabel}>Nivel</label>
                              <input
                                value={z.level}
                                onChange={e => setZones(prev => prev.map((zz, ii) => (ii === i ? { ...zz, level: e.target.value } : zz)))}
                                style={inputS}
                              />
                            </div>
                            <div>
                              <label style={sLabel}>m²</label>
                              <input
                                type="number"
                                value={z.estimated_m2}
                                onChange={e =>
                                  setZones(prev => prev.map((zz, ii) => (ii === i ? { ...zz, estimated_m2: parseInt(e.target.value) || 0 } : zz)))
                                }
                                style={inputS}
                              />
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => setZones(prev => prev.filter((_, ii) => ii !== i))}
                          style={{
                            background: 'none',
                            border: '1px solid #333',
                            borderRadius: 6,
                            padding: '6px 8px',
                            color: '#666',
                            cursor: 'pointer',
                            marginTop: 2,
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => {
                    const newZone: Zone = {
                      name: `Zona ${zones.length + 1}`,
                      level: 'PB',
                      estimated_m2: 50,
                      description: '',
                    }
                    setZones(prev => [...prev, newZone])
                  }}
                  style={{
                    padding: '10px 12px',
                    background: '#0e1a0e',
                    border: '1px solid #57FF9A44',
                    borderRadius: 8,
                    color: '#57FF9A',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Plus size={14} /> Agregar zona
                </button>
              </div>
            )}

            {/* ─── SYSTEM STEPS ─── */}
            {currentStep !== 'zones' && currentStep !== 'review' && !currentStep.startsWith('rack') && (
              <div>
                <h3 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                  {SYSTEM_STEPS[currentStep]?.name || currentStep}
                </h3>

                {loadingItems && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#666', fontSize: 12 }}>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    Generando propuesta...
                  </div>
                )}

                {itemsError && (
                  <div
                    style={{
                      padding: '10px 12px',
                      background: '#2a1410',
                      border: '1px solid #5a3a28',
                      borderRadius: 8,
                      color: '#f87171',
                      fontSize: 12,
                      marginBottom: 12,
                    }}
                  >
                    {itemsError}
                  </div>
                )}

                {editingItems.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                    {editingItems.map((it, i) => (
                      <div
                        key={i}
                        style={{
                          padding: 12,
                          background: '#0e0e0e',
                          border: '1px solid #222',
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <div style={{ flex: 1 }}>
                            <label style={sLabel}>Zona</label>
                            <select
                              value={it.zone}
                              onChange={e =>
                                setEditingItems(prev => prev.map((ii, idx) => (idx === i ? { ...ii, zone: e.target.value } : ii)))
                              }
                              style={inputS}
                            >
                              {zones.map(z => (
                                <option key={z.name} value={z.name}>
                                  {z.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div style={{ flex: 1 }}>
                            <label style={sLabel}>Marca</label>
                            <input
                              value={it.marca}
                              onChange={e =>
                                setEditingItems(prev => prev.map((ii, idx) => (idx === i ? { ...ii, marca: e.target.value } : ii)))
                              }
                              style={inputS}
                            />
                          </div>
                          <div style={{ flex: 1 }}>
                            <label style={sLabel}>Modelo</label>
                            <input
                              value={it.modelo}
                              onChange={e =>
                                setEditingItems(prev => prev.map((ii, idx) => (idx === i ? { ...ii, modelo: e.target.value } : ii)))
                              }
                              style={inputS}
                            />
                          </div>
                        </div>

                        <div>
                          <label style={sLabel}>Descripción</label>
                          <input
                            value={it.description}
                            onChange={e =>
                              setEditingItems(prev => prev.map((ii, idx) => (idx === i ? { ...ii, description: e.target.value } : ii)))
                            }
                            style={inputS}
                          />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                          <div>
                            <label style={sLabel}>Cantidad</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button
                                onClick={() =>
                                  setEditingItems(prev =>
                                    prev.map((ii, idx) =>
                                      idx === i ? { ...ii, quantity: Math.max(1, ii.quantity - 1) } : ii
                                    )
                                  )
                                }
                                style={{
                                  background: 'none',
                                  border: '1px solid #333',
                                  borderRadius: 4,
                                  padding: '4px 6px',
                                  color: '#666',
                                  cursor: 'pointer',
                                }}
                              >
                                <Minus size={12} />
                              </button>
                              <input
                                type="number"
                                value={it.quantity}
                                onChange={e =>
                                  setEditingItems(prev =>
                                    prev.map((ii, idx) =>
                                      idx === i ? { ...ii, quantity: Math.max(1, parseInt(e.target.value) || 1) } : ii
                                    )
                                  )
                                }
                                style={{ ...inputS, textAlign: 'center', flex: 1 }}
                              />
                              <button
                                onClick={() =>
                                  setEditingItems(prev =>
                                    prev.map((ii, idx) => (idx === i ? { ...ii, quantity: ii.quantity + 1 } : ii))
                                  )
                                }
                                style={{
                                  background: 'none',
                                  border: '1px solid #333',
                                  borderRadius: 4,
                                  padding: '4px 6px',
                                  color: '#666',
                                  cursor: 'pointer',
                                }}
                              >
                                <Plus size={12} />
                              </button>
                            </div>
                          </div>
                          <div>
                            <label style={sLabel}>Notas</label>
                            <input
                              value={it.notes}
                              onChange={e =>
                                setEditingItems(prev => prev.map((ii, idx) => (idx === i ? { ...ii, notes: e.target.value } : ii)))
                              }
                              placeholder="Opcional"
                              style={inputS}
                            />
                          </div>
                        </div>

                        <button
                          onClick={() => setEditingItems(prev => prev.filter((_, idx) => idx !== i))}
                          style={{
                            marginTop: 8,
                            padding: '6px 10px',
                            background: 'none',
                            border: '1px solid #5a2828',
                            borderRadius: 6,
                            color: '#f87171',
                            cursor: 'pointer',
                            fontSize: 11,
                            fontFamily: 'inherit',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Trash2 size={12} /> Eliminar
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => {
                      const newItem: ConfirmedItem = {
                        zone: zones[0]?.name || 'Indefinida',
                        marca: '',
                        modelo: '',
                        description: '',
                        quantity: 1,
                        notes: '',
                      }
                      setEditingItems(prev => [...prev, newItem])
                    }}
                    style={{
                      padding: '10px 12px',
                      background: '#0e1a0e',
                      border: '1px solid #57FF9A44',
                      borderRadius: 8,
                      color: '#57FF9A',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'inherit',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Plus size={14} /> Manual
                  </button>
                  <button
                    onClick={() => { setShowCatalogSearch(true); setCatalogSearch('') }}
                    style={{
                      padding: '10px 12px',
                      background: '#0e0e1a',
                      border: '1px solid #3B82F644',
                      borderRadius: 8,
                      color: '#3B82F6',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'inherit',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Package size={14} /> Desde catálogo
                  </button>
                </div>

                {/* Catalog search panel */}
                {showCatalogSearch && (() => {
                  const systemEnum = SYSTEM_ENUM[currentStep]
                  const filteredCat = catalog.filter(p => {
                    if (systemEnum && p.system !== systemEnum) return false
                    if (!catalogSearch.trim()) return true
                    const q = catalogSearch.toLowerCase()
                    return (p.name || '').toLowerCase().includes(q)
                      || (p.marca || '').toLowerCase().includes(q)
                      || (p.modelo || '').toLowerCase().includes(q)
                      || (p.description || '').toLowerCase().includes(q)
                  }).slice(0, 20)

                  return (
                    <div style={{
                      marginTop: 10,
                      padding: 12,
                      background: '#0a0a14',
                      border: '1px solid #3B82F644',
                      borderRadius: 10,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#3B82F6', textTransform: 'uppercase' }}>
                          Buscar en catálogo {systemEnum ? `(${systemEnum})` : ''}
                        </span>
                        <button onClick={() => setShowCatalogSearch(false)}
                          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14 }}>✕</button>
                      </div>
                      <div style={{ position: 'relative', marginBottom: 8 }}>
                        <Search size={13} style={{ position: 'absolute', left: 10, top: 9, color: '#555' }} />
                        <input
                          value={catalogSearch}
                          onChange={e => setCatalogSearch(e.target.value)}
                          placeholder="Buscar por nombre, marca, modelo..."
                          autoFocus
                          style={{ ...inputS, paddingLeft: 30 }}
                        />
                      </div>
                      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                        {filteredCat.length === 0 ? (
                          <div style={{ fontSize: 11, color: '#555', padding: 8, textAlign: 'center' }}>Sin resultados</div>
                        ) : filteredCat.map(p => (
                          <button
                            key={p.id}
                            onClick={() => {
                              setEditingItems(prev => [...prev, {
                                zone: zones[0]?.name || 'Indefinida',
                                marca: p.marca || '',
                                modelo: p.modelo || '',
                                description: p.description || p.name || '',
                                quantity: 1,
                                notes: '',
                                catalog_product_id: p.id,
                              }])
                              setShowCatalogSearch(false)
                            }}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              background: 'transparent',
                              border: 'none',
                              borderBottom: '1px solid #1a1a2a',
                              cursor: 'pointer',
                              textAlign: 'left',
                              color: '#ccc',
                              fontFamily: 'inherit',
                              fontSize: 11,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 2,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#3B82F610' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                          >
                            <div style={{ fontWeight: 600, color: '#ddd' }}>{p.marca} {p.modelo}</div>
                            <div style={{ fontSize: 10, color: '#888' }}>
                              {p.name}{p.cost > 0 ? ` · $${p.cost} ${p.moneda}` : ''}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ─── RACK STEP ─── */}
            {currentStep === 'rack' && (
              <div>
                <h3 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Rack e Infraestructura</h3>
                <div style={{ color: '#888', fontSize: 12 }}>Esta sección se configuraría basada en los equipos confirmados.</div>
                <div style={{ color: '#666', fontSize: 11, marginTop: 8 }}>Próxima fase: auto-generación de propuesta rack.</div>
              </div>
            )}

            {/* ─── REVIEW STEP ─── */}
            {currentStep === 'review' && (
              <div>
                <h3 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Resumen Final</h3>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  <div style={{ padding: '10px 12px', background: '#0e0e0e', border: '1px solid #222', borderRadius: 8 }}>
                    <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase' }}>Zonas</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{getTotalZones()}</div>
                  </div>
                  <div style={{ padding: '10px 12px', background: '#0e0e0e', border: '1px solid #222', borderRadius: 8 }}>
                    <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase' }}>Items</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{getTotalItems()}</div>
                  </div>
                  <div
                    style={{
                      padding: '10px 12px',
                      background: '#0e1a0e',
                      border: '1px solid #57FF9A33',
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ fontSize: 9, color: '#57FF9A', textTransform: 'uppercase' }}>Sistemas</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#57FF9A' }}>{scope.sistemas.length}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ─── Right Panel (40% on desktop) ─── */}
          {!isMobile && (
            <div
              style={{
                flex: '0 0 40%',
                display: 'flex',
                flexDirection: 'column',
                padding: 20,
                overflowY: 'auto',
                background: '#0a0a0a',
              }}
            >
              <h3 style={{ color: '#fff', fontSize: 12, fontWeight: 600, marginBottom: 12, textTransform: 'uppercase' }}>
                Acumulador en Vivo
              </h3>

              {getTotalZones() === 0 ? (
                <div style={{ color: '#555', fontSize: 11 }}>Confirma zonas para ver el acumulador</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflowY: 'auto' }}>
                  {zones.map(z => {
                    const zoneItems = Object.entries(confirmedItems).flatMap(([system, items]) =>
                      items.filter(it => it.zone === z.name).map(it => ({ ...it, system }))
                    )

                    return (
                      <div key={z.name} style={{ padding: 10, background: '#141414', border: '1px solid #222', borderRadius: 8 }}>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#fff',
                            marginBottom: 8,
                            paddingBottom: 6,
                            borderBottom: '1px solid #222',
                          }}
                        >
                          {z.name}
                          {z.estimated_m2 > 0 && <span style={{ color: '#666', fontSize: 9, marginLeft: 6 }}>({z.estimated_m2} m²)</span>}
                        </div>

                        {zoneItems.length === 0 ? (
                          <div style={{ fontSize: 10, color: '#555' }}>Sin items</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {zoneItems.map((it, i) => (
                              <div
                                key={i}
                                style={{
                                  fontSize: 10,
                                  color: '#aaa',
                                  padding: '6px',
                                  background: '#0e0e0e',
                                  borderRadius: 4,
                                  border: '1px solid #1a1a1a',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontWeight: 600, color: '#ddd' }}>
                                    {it.marca} {it.modelo}
                                  </span>
                                  <span style={{ color: SYSTEM_STEPS[Object.keys(SYSTEM_ENUM).find(k => SYSTEM_ENUM[k] === it.system) || '']?.color || '#888' }}>
                                    ×{it.quantity}
                                  </span>
                                </div>
                                {it.description && <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>{it.description}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── Footer ─── */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #222',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            {currentStep !== 'zones' && (
              <Btn
                onClick={() => {
                  const currentIdx = allSteps.indexOf(currentStep)
                  if (currentIdx > 0) {
                    setCurrentStep(allSteps[currentIdx - 1])
                  }
                }}
              >
                <ChevronLeft size={14} /> Atrás
              </Btn>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            {currentStep === 'zones' && (
              <Btn variant="primary" onClick={confirmZones} disabled={zones.length === 0}>
                Confirmar Zonas →
              </Btn>
            )}

            {currentStep !== 'zones' && currentStep !== 'review' && !currentStep.startsWith('rack') && (
              <Btn variant="primary" onClick={confirmItems} disabled={editingItems.length === 0 || loadingItems}>
                {loadingItems ? (
                  <>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Cargando...
                  </>
                ) : (
                  <>
                    Confirmar {SYSTEM_STEPS[currentStep]?.name || currentStep} →
                  </>
                )}
              </Btn>
            )}

            {currentStep === 'rack' && (
              <Btn
                variant="primary"
                onClick={() => {
                  setCompletedSteps(prev => new Set([...prev, 'rack']))
                  setCurrentStep('review')
                }}
              >
                Continuar →
              </Btn>
            )}

            {currentStep === 'review' && !inserting && (
              <Btn variant="primary" onClick={handleConfirm}>
                <CheckCircle2 size={14} /> Crear Cotización
              </Btn>
            )}
          </div>
        </div>

        {/* ─── Inserting state ─── */}
        {inserting && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <Loader2 size={36} color="#57FF9A" style={{ animation: 'spin 1s linear infinite', marginBottom: 16 }} />
              <div style={{ fontSize: 14, color: '#ccc', fontWeight: 600 }}>{insertProgress}</div>
            </div>
          </div>
        )}
    </div>
  )
}
