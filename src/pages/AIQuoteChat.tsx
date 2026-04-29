import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { downloadSembradoPdf, type SembradoData, type DevicePosition as SembradoDevicePosition } from '../lib/sembradoPdf'
import { Btn } from '../components/layout/UI'
import { X, Zap, Loader2, Upload, Send, ChevronLeft, CheckCircle, Plus, Minus, Trash2, AlertTriangle, FileText, MessageSquare, Download } from 'lucide-react'

/* ═══════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════ */

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface DevicePosition {
  x: number
  y: number
  label: string
  height: string
}

interface AreaItem {
  catalog_product_id: string | null
  is_new_suggestion: boolean
  marca: string
  modelo: string
  system: string
  description: string
  quantity: number
  notes: string
  positions?: DevicePosition[]
  _rowId: string
}

interface ProposalArea {
  name: string
  level: string
  estimated_m2: number | null
  description: string
  items: AreaItem[]
}

interface Scope {
  mode: 'questionnaire' | 'freetext'
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

interface CatalogProduct {
  id: string; name: string; marca: string; modelo: string; system: string
  provider: string; moneda: string; cost: number; description: string; markup: number
}

interface Precedent {
  name: string; specialty: string; total: number
  items: { area_name: string; name: string; system: string; quantity: number; marca: string; modelo: string }[]
}

/* ═══════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════ */

const PROJECT_TYPES = [
  { id: 'residencial', label: 'Residencial', desc: 'Casa, depto, PH' },
  { id: 'corporativo', label: 'Corporativo', desc: 'Oficinas, edificio' },
  { id: 'hoteleria', label: 'Hotelería', desc: 'Hotel, resort' },
  { id: 'retail', label: 'Retail', desc: 'Tienda, showroom' },
  { id: 'industrial', label: 'Industrial', desc: 'Bodega, planta' },
]

const LEVELS = [
  { id: 'basico', label: 'Básico' },
  { id: 'medio', label: 'Medio' },
  { id: 'alto', label: 'Alto' },
  { id: 'premium', label: 'Premium' },
]

const LOCATIONS = [
  { id: 'cdmx', label: 'CDMX' },
  { id: 'resto_mx', label: 'Resto de México' },
  { id: 'internacional', label: 'Internacional' },
]

const AI_ALL_SYSTEMS = [
  { id: 'audio', name: 'Audio', color: '#8B5CF6', enumValue: 'Audio' },
  { id: 'redes', name: 'Redes', color: '#06B6D4', enumValue: 'Redes' },
  { id: 'cctv', name: 'CCTV', color: '#3B82F6', enumValue: 'CCTV' },
  { id: 'control_acceso', name: 'Control de Acceso', color: '#F59E0B', enumValue: 'Acceso' },
  { id: 'control_iluminacion', name: 'Control de Iluminación', color: '#C084FC', enumValue: 'Iluminacion' },
  { id: 'deteccion_humo', name: 'Detección de Humo', color: '#EF4444', enumValue: 'Humo' },
  { id: 'bms', name: 'BMS', color: '#10B981', enumValue: 'BMS' },
  { id: 'telefonia', name: 'Telefonía', color: '#F97316', enumValue: 'Telefonia' },
  { id: 'red_celular', name: 'Red Celular', color: '#EC4899', enumValue: 'Celular' },
  { id: 'cortinas', name: 'Cortinas', color: '#67E8F9', enumValue: 'Cortinas' },
]

function uid(): string { return Math.random().toString(36).slice(2, 10) }

/* ═══════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════ */

const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1030 }
const modalStyle: React.CSSProperties = { background: '#141414', border: '1px solid #333', borderRadius: 16, width: '96vw', maxWidth: 1100, height: '94vh', display: 'flex', flexDirection: 'column' }
const sLabel: React.CSSProperties = { fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 6, display: 'block' }
const inputS: React.CSSProperties = { width: '100%', padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function AIQuoteChat({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (quotationId: string, specialty: string) => void
}) {
  // Steps: 'mode' | 'questionnaire' | 'freetext' | 'chat' | 'proposal'
  const [step, setStep] = useState<'mode' | 'questionnaire' | 'freetext' | 'chat' | 'proposal'>('mode')

  // Scope
  const [scope, setScope] = useState<Scope>({
    mode: 'questionnaire',
    freetext: '',
    tipo: 'residencial',
    nombre: '',
    cliente: '',
    tamano_m2: null,
    habitaciones: null,
    ubicacion: 'cdmx',
    nivel: 'medio',
    sistemas: ['audio', 'redes', 'cctv', 'control_iluminacion'],
    areas_custom: '',
    notas: '',
  })

  // Client selector
  const [clientes, setClientes] = useState<Array<{ id: string; nombre_comercial: string; razon_social: string; rfc: string; regimen_fiscal: string; codigo_postal: string; uso_cfdi_clave: string; email: string }>>([])
  const [clientSearch, setClientSearch] = useState(scope.cliente || '')
  const [showClientDrop, setShowClientDrop] = useState(false)
  const [clientId, setClientId] = useState('')
  const [showNewClient, setShowNewClient] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientRazon, setNewClientRazon] = useState('')
  const [newClientRfc, setNewClientRfc] = useState('')

  // Lead selector
  const [leads, setLeads] = useState<Array<{ id: string; name: string; company: string }>>([])
  const [leadSearch, setLeadSearch] = useState('')
  const [showLeadDrop, setShowLeadDrop] = useState(false)
  const [selectedLeadId, setSelectedLeadId] = useState('')

  useEffect(() => {
    supabase.from('clientes').select('id,nombre_comercial,razon_social,rfc,regimen_fiscal,codigo_postal,uso_cfdi_clave,email').neq('activo', false).order('razon_social')
      .then(({ data }) => setClientes(data || []))
    supabase.from('leads').select('id,name,company').order('name')
      .then(({ data }) => setLeads((data || []).map((l: any) => ({ id: l.id, name: l.name || '', company: l.company || '' }))))
  }, [])

  const filteredClientes = clientSearch.length >= 1
    ? clientes.filter(c => (c.nombre_comercial || '').toLowerCase().includes(clientSearch.toLowerCase()) || c.razon_social.toLowerCase().includes(clientSearch.toLowerCase()) || c.rfc.toLowerCase().includes(clientSearch.toLowerCase())).slice(0, 10)
    : clientes.slice(0, 10)

  const selectedClient = clientId ? clientes.find(c => c.id === clientId) : null

  const filteredLeads = leadSearch.length >= 1
    ? leads.filter(l => l.name.toLowerCase().includes(leadSearch.toLowerCase()) || (l.company || '').toLowerCase().includes(leadSearch.toLowerCase())).slice(0, 10)
    : leads.slice(0, 10)

  const selectedLead = selectedLeadId ? leads.find(l => l.id === selectedLeadId) : null

  async function crearClienteInline() {
    if (!newClientName.trim()) return
    const { data } = await supabase.from('clientes').insert({
      nombre_comercial: newClientName.trim(), razon_social: newClientRazon.trim() || newClientName.trim(),
      rfc: newClientRfc.trim() || 'XAXX010101000',
      regimen_fiscal: '601', regimen_fiscal_clave: '601', codigo_postal: '00000',
      uso_cfdi: 'G03', uso_cfdi_clave: 'G03', tipo_persona: 'moral', activo: true,
    }).select().single()
    if (data) {
      setClientes(prev => [...prev, data])
      setScope(s => ({ ...s, cliente: data.nombre_comercial || data.razon_social }))
      setClientSearch(data.nombre_comercial || data.razon_social)
      setClientId(data.id)
    }
    setShowNewClient(false); setNewClientName(''); setNewClientRazon(''); setNewClientRfc('')
  }

  // Plan upload (multiple) — files are uploaded to Supabase Storage
  const [planFiles, setPlanFiles] = useState<Array<{ file: File; url: string; mediaType: string; preview: string; uploading: boolean }>>([])
  // Compat aliases for first plan
  const planFile = planFiles[0]?.file || null

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Proposal
  const [areas, setAreas] = useState<ProposalArea[]>([])
  const [rationale, setRationale] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [planSummary, setPlanSummary] = useState('')

  // DB data
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [precedents, setPrecedents] = useState<Precedent[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // Create quotation
  const [inserting, setInserting] = useState(false)
  const [insertProgress, setInsertProgress] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Load catalog + precedents
  useEffect(() => {
    const load = async () => {
      try {
        const enumValues = scope.sistemas
          .map(id => AI_ALL_SYSTEMS.find(s => s.id === id)?.enumValue)
          .filter((v): v is string => !!v)

        let catQ = supabase.from('catalog_products')
          .select('id,name,description,system,marca,modelo,provider,cost,moneda,markup')
          .eq('is_active', true)
        if (enumValues.length > 0) catQ = catQ.in('system', enumValues)

        const [catRes, precRes] = await Promise.all([
          catQ,
          supabase.from('quotations').select('id,name,specialty,total,notes')
            .eq('specialty', 'esp').neq('total', 0)
            .order('updated_at', { ascending: false }).limit(5),
        ])

        setCatalog((catRes.data || []) as CatalogProduct[])

        // Load precedent items
        const precs: Precedent[] = []
        for (const q of (precRes.data || []).slice(0, 3)) {
          const [areasRes, itemsRes] = await Promise.all([
            supabase.from('quotation_areas').select('id,name').eq('quotation_id', q.id),
            supabase.from('quotation_items').select('area_id,name,quantity,system,marca,modelo').eq('quotation_id', q.id).neq('type', 'labor'),
          ])
          const areaMap: Record<string, string> = {}
          ;(areasRes.data || []).forEach((a: any) => { areaMap[a.id] = a.name })
          precs.push({
            name: q.name, specialty: q.specialty, total: q.total,
            items: (itemsRes.data || []).map((it: any) => ({
              area_name: areaMap[it.area_id] || 'Sin área',
              name: it.name, system: it.system || '', quantity: it.quantity,
              marca: it.marca || '', modelo: it.modelo || '',
            })),
          })
        }
        setPrecedents(precs)
      } catch (e) { console.error('Error loading data:', e) }
      setLoadingData(false)
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // File upload handler — uploads to Supabase Storage for URL-based access
  const handleFile = useCallback(async (file: File) => {
    const valid = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    if (!valid.includes(file.type)) { setError('Formato no soportado. Usa PDF, PNG, JPG o WebP.'); return }
    if (file.size > 25 * 1024 * 1024) { setError('Archivo demasiado grande. Max 25MB.'); return }
    setError(null)
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
    // Add a placeholder while uploading
    const tempId = Math.random().toString(36).slice(2, 10)
    const ext = file.name.split('.').pop() || 'pdf'
    const storagePath = `ai-quotes/${Date.now()}-${tempId}.${ext}`
    setPlanFiles(prev => [...prev, { file, url: '', mediaType: file.type, preview, uploading: true }])
    try {
      const { error: uploadErr } = await supabase.storage.from('plan-uploads').upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      })
      if (uploadErr) throw uploadErr
      const { data: urlData } = supabase.storage.from('plan-uploads').getPublicUrl(storagePath)
      const publicUrl = urlData?.publicUrl || ''
      if (!publicUrl) throw new Error('No se pudo obtener URL pública')
      // Update the placeholder with the real URL
      setPlanFiles(prev => prev.map(p => p.file === file && p.uploading ? { ...p, url: publicUrl, uploading: false } : p))
    } catch (err: any) {
      console.error('Upload error:', err)
      setError('Error subiendo archivo: ' + (err.message || 'Error desconocido'))
      // Remove the failed placeholder
      setPlanFiles(prev => prev.filter(p => !(p.file === file && p.uploading)))
    }
  }, [])

  const handleFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(f => { handleFile(f) })
  }, [handleFile])

  const removePlan = useCallback((idx: number) => {
    setPlanFiles(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const toggleSystem = (id: string) => {
    setScope(s => ({ ...s, sistemas: s.sistemas.includes(id) ? s.sistemas.filter(x => x !== id) : [...s.sistemas, id] }))
  }

  /* ─── Send message to AI ─── */
  const sendToAI = async (userText: string, isInitial = false) => {
    setSending(true)
    setError(null)

    const newUserMsg: ChatMessage = { role: 'user', content: userText, timestamp: new Date() }
    const updatedMessages = [...messages, newUserMsg]
    setMessages(updatedMessages)
    setChatInput('')

    try {
      // Build messages for API (just role + content)
      const apiMessages = updatedMessages.map(m => ({ role: m.role, content: m.content }))

      // Prepare catalog compact for API
      const catalogForApi = catalog.map(p => ({
        id: p.id, name: p.name, marca: p.marca, modelo: p.modelo,
        system: p.system, provider: p.provider, moneda: p.moneda,
        cost: p.cost, description: p.description,
      }))

      const body: any = {
        messages: apiMessages,
        scope,
        catalog: catalogForApi,
        precedents,
      }

      // Only send plan URLs on first message (files are already in Supabase Storage)
      if (isInitial && planFiles.length > 0) {
        const readyPlans = planFiles.filter(p => p.url && !p.uploading)
        if (readyPlans.length > 0) {
          body.planUrls = readyPlans.map(p => ({ url: p.url, mediaType: p.mediaType }))
        }
      }

      // DEBUG: log body size and plan info
      let bodyStr: string
      try {
        bodyStr = JSON.stringify(body)
        console.log(`[AIQuoteChat] Body size: ${(bodyStr.length / 1024).toFixed(1)} KB, plans: ${body.planUrls?.length || 0}, planUrls:`, body.planUrls?.map((p: any) => p.url))
      } catch (strErr: any) {
        throw new Error(`[STRINGIFY] ${strErr.message}`)
      }

      let r: Response
      try {
        r = await fetch('/api/ai-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
        })
      } catch (fetchErr: any) {
        throw new Error(`[FETCH] ${fetchErr.message}`)
      }

      let data: any
      try {
        const responseText = await r.text()
        console.log(`[AIQuoteChat] Response status: ${r.status}, body preview: ${responseText.substring(0, 200)}`)
        data = JSON.parse(responseText)
      } catch (parseErr: any) {
        throw new Error(`[PARSE] Status ${r.status} — ${parseErr.message}`)
      }

      if (!r.ok || !data.ok) {
        throw new Error(data.error || 'Error de comunicación con AI')
      }

      const assistantMsg: ChatMessage = { role: 'assistant', content: data.text, timestamp: new Date() }
      setMessages([...updatedMessages, assistantMsg])

      if (data.type === 'proposal') {
        // AI produced a final proposal
        const areasWithIds = (data.areas || []).map((a: any) => ({
          ...a,
          items: (a.items || []).map((it: any) => ({ ...it, _rowId: uid() })),
        }))
        setAreas(areasWithIds)
        setRationale(data.rationale || '')
        setWarnings(data.warnings || [])
        setPlanSummary(data.plan_summary || '')
        setStep('proposal')
      }
    } catch (err: any) {
      setError(err.message || 'Error')
      // Remove the user message on failure
      setMessages(messages)
    }
    setSending(false)
  }

  /* ─── Start chat from scope ─── */
  const startChat = () => {
    setStep('chat')
    const initial = scope.mode === 'freetext'
      ? `Analiza este scope y propón el sembrado de equipos:\n\n${scope.freetext}`
      : `Analiza este proyecto y propón el sembrado de equipos.${planFiles.length > 0 ? ` Te adjunto ${planFiles.length} plano${planFiles.length > 1 ? 's' : ''} arquitectónico${planFiles.length > 1 ? 's' : ''}.` : ''} Revisa el scope, haz preguntas si necesitas aclarar algo, y cuando estés listo genera la propuesta.`
    sendToAI(initial, true)
  }

  /* ─── Request proposal explicitly ─── */
  const requestProposal = () => {
    sendToAI('Ya tengo toda la información que necesitas. Por favor genera la propuesta final en JSON con todas las áreas y equipos.')
  }

  /* ─── Edit proposal ─── */
  const updateItemQty = (areaIdx: number, rowId: string, delta: number) => {
    setAreas(prev => prev.map((a, i) => i !== areaIdx ? a : {
      ...a, items: a.items.map(it => it._rowId === rowId ? { ...it, quantity: Math.max(0, it.quantity + delta) } : it),
    }))
  }
  const removeItem = (areaIdx: number, rowId: string) => {
    setAreas(prev => prev.map((a, i) => i !== areaIdx ? a : { ...a, items: a.items.filter(it => it._rowId !== rowId) }))
  }
  const removeArea = (idx: number) => { setAreas(prev => prev.filter((_, i) => i !== idx)) }

  /* ─── Back to chat from proposal ─── */
  const backToChat = () => {
    setStep('chat')
    setAreas([])
  }

  /* ─── Download Sembrado PDF ─── */
  const [downloadingSembrado, setDownloadingSembrado] = useState(false)

  const downloadSembrado = async () => {
    setDownloadingSembrado(true)
    try {
      // Fetch plan image base64 from URL if available
      let planImageBase64: string | undefined
      if (planFiles[0]?.url) {
        try {
          const resp = await fetch(planFiles[0].url)
          const blob = await resp.blob()
          const reader = new FileReader()
          planImageBase64 = await new Promise<string>((resolve) => {
            reader.onload = () => resolve((reader.result as string).split(',')[1] || '')
            reader.readAsDataURL(blob)
          })
        } catch { /* skip plan overlay if fetch fails */ }
      }
      // Symbol type inference from system + description keywords
      const inferSymbol = (system: string, desc: string): string => {
        const d = desc.toLowerCase()
        if (d.includes('bocina') && d.includes('plafón')) return 'speaker_ceiling'
        if (d.includes('bocina') && (d.includes('pared') || d.includes('empotar'))) return 'speaker_wall'
        if (d.includes('subwoofer') || d.includes('sub')) return 'subwoofer'
        if (d.includes('amplificador') || d.includes('amp')) return 'amplifier'
        if (d.includes('proyector') || d.includes('elevador')) return 'projector'
        if (d.includes('pantalla de proyección')) return 'projection_screen'
        if (d.includes('cámara') || d.includes('camera') || d.includes('cam')) return 'camera_wifi'
        if (d.includes('biométrico') || d.includes('lector')) return 'biometric_reader'
        if (d.includes('chapa') || d.includes('magnética') || d.includes('cerradura')) return 'magnetic_lock'
        if (d.includes('botón') || d.includes('liberador')) return 'release_button'
        if (d.includes('botonera') && d.includes('inalámbrica')) return 'keypad_wireless'
        if (d.includes('botonera') || d.includes('keypad') || d.includes('teclado')) return 'keypad'
        if (d.includes('detector') && d.includes('humo')) return 'smoke_detector'
        if (d.includes('detector') && d.includes('gas')) return 'gas_detector'
        if (d.includes('detector') && d.includes('temperatura')) return 'temperature_detector'
        if (d.includes('base sonora') || d.includes('sirena')) return 'horn_strobe'
        if (d.includes('panel') && (d.includes('detección') || d.includes('incendio'))) return 'fire_panel'
        if (d.includes('estación manual')) return 'manual_station'
        if (d.includes('nodo') && (d.includes('red') || d.includes('datos'))) return 'network_node'
        if (d.includes('teléfono')) return 'phone'
        if (d.includes('tablero') && d.includes('acceso')) return 'access_panel'
        if (d.includes('persiana') || d.includes('cortina')) return 'blind_node'
        if (d.includes('módulo') || d.includes('repetidor')) return 'control_module'
        if (d.includes('rack') || d.includes('nvr') || d.includes('switch')) return 'rack'
        const sysMap: Record<string, string> = {
          'Audio': 'speaker_ceiling', 'CCTV': 'camera_wifi', 'Redes': 'network_node',
          'Control de acceso': 'biometric_reader', 'Acceso': 'biometric_reader',
          'Iluminacion': 'keypad', 'Cortinas': 'blind_node', 'Humo': 'smoke_detector',
        }
        return sysMap[system] || 'network_node'
      }

      // Build systems grouped from proposal areas
      const systemsMap: Record<string, { devices: SembradoData['systems'][string]['devices'], conduit_schedule: SembradoData['systems'][string]['conduit_schedule'] }> = {}

      for (const area of areas) {
        for (const item of area.items) {
          const sysName = item.system || 'General'
          if (!systemsMap[sysName]) systemsMap[sysName] = { devices: [], conduit_schedule: [] }
          // Map positions from AI response if available
          const positions: SembradoDevicePosition[] | undefined = item.positions?.map(p => ({
            x: p.x,
            y: p.y,
            label: p.label || `${sysName.substring(0, 3).toUpperCase()}-${String(systemsMap[sysName].devices.length + 1).padStart(2, '0')}`,
            height: p.height || '',
          }))

          systemsMap[sysName].devices.push({
            nomenclature: `${sysName.substring(0, 3).toUpperCase()}-${String(systemsMap[sysName].devices.length + 1).padStart(2, '0')}`,
            name: item.description || `${item.marca} ${item.modelo}`,
            brand: item.marca,
            model: item.modelo,
            area: area.name,
            quantity: item.quantity,
            install_height: '',
            requirements: item.notes || '',
            symbol_type: inferSymbol(item.system, `${item.description} ${item.marca} ${item.modelo}`),
            positions,
          })
        }
      }

      const sembradoData: SembradoData = {
        project: {
          name: scope.nombre || 'Proyecto OMM',
          prefix: (scope.nombre || 'OMM').substring(0, 4).toUpperCase(),
          location: scope.ubicacion === 'cdmx' ? 'CDMX' : scope.ubicacion,
          date: new Date().toLocaleDateString('es-MX'),
          drawn_by: 'AI OMM Agent',
          reviewed_by: 'Elias Graneroinchu Cohen',
          scale: planFiles.length > 0 ? '1:60' : 'S/E',
        },
        systems: systemsMap,
        // Include the uploaded plan image for overlay
        planImageBase64: planImageBase64,
        planImageType: planFiles[0]?.mediaType || undefined,
      }

      downloadSembradoPdf(sembradoData, `Sembrado_${scope.nombre || 'OMM'}.pdf`)
    } catch (err) {
      console.error('Sembrado error:', err)
      alert('Error al generar el sembrado: ' + (err instanceof Error ? err.message : 'Error'))
    } finally {
      setDownloadingSembrado(false)
    }
  }

  /* ─── Create quotation ─── */
  const handleConfirm = async () => {
    setError(null)
    setInserting(true)
    setInsertProgress('Creando cotización...')
    try {
      const quotName = scope.nombre || (scope.tipo.charAt(0).toUpperCase() + scope.tipo.slice(1) + ' AI ' + new Date().toLocaleDateString('es-MX'))
      const notesMeta = {
        systems: scope.sistemas,
        currency: 'USD',
        tipoCambio: 20.5,
        ai_generated: true,
        ai_scope: scope,
        ai_rationale: rationale,
        plan_summary: planSummary,
        has_plan: planFiles.length > 0,
        plan_count: planFiles.length,
      }

      const { data: quot, error: qErr } = await supabase.from('quotations').insert({
        name: quotName,
        specialty: 'esp',
        stage: 'oportunidad',
        client_name: scope.cliente || selectedLead?.company || selectedLead?.name || '',
        notes: JSON.stringify({ ...notesMeta, client_id: clientId || '', lead_id: selectedLeadId || '', lead_name: selectedLead?.name || '' }),
      }).select().single()
      if (qErr) throw new Error('Error creando cotización: ' + qErr.message)
      if (!quot) throw new Error('Cotización no creada')

      // Create areas
      setInsertProgress('Creando áreas...')
      const areaIdByName: Record<string, string> = {}
      for (let i = 0; i < areas.length; i++) {
        const a = areas[i]
        const { data: newArea, error: aErr } = await supabase
          .from('quotation_areas')
          .insert({ quotation_id: quot.id, name: a.name, order_index: i, subtotal: 0 })
          .select().single()
        if (aErr) throw new Error('Error creando área "' + a.name + '": ' + aErr.message)
        if (newArea) areaIdByName[a.name] = newArea.id
      }

      // Process items
      setInsertProgress('Procesando productos...')
      const createdProducts: Record<string, string> = {}
      const catalogCache: Record<string, any> = {}
      let orderIdx = 0

      for (let ai = 0; ai < areas.length; ai++) {
        const a = areas[ai]
        const areaId = areaIdByName[a.name]
        if (!areaId) continue

        for (const it of a.items) {
          if (it.quantity <= 0) continue
          let catalogId = it.catalog_product_id
          let productData: any = null

          if (catalogId) {
            if (!catalogCache[catalogId]) {
              const { data: cp } = await supabase.from('catalog_products')
                .select('id,name,description,cost,markup,provider,moneda,system')
                .eq('id', catalogId).single()
              if (cp) catalogCache[catalogId] = cp
            }
            productData = catalogCache[catalogId]
          }

          if (!catalogId || !productData) {
            const cacheKey = (it.marca + '|' + it.modelo).toLowerCase()
            if (createdProducts[cacheKey]) {
              catalogId = createdProducts[cacheKey]
              if (!catalogCache[catalogId!]) {
                const { data: cp } = await supabase.from('catalog_products')
                  .select('id,name,description,cost,markup,provider,moneda,system')
                  .eq('id', catalogId!).single()
                if (cp) catalogCache[catalogId!] = cp
              }
              productData = catalogCache[catalogId!]
            } else {
              const productName = '[AI Suggested] ' + (it.description || (it.marca + ' ' + it.modelo).trim() || 'Producto')
              const { data: newProd, error: pErr } = await supabase.from('catalog_products').insert({
                name: productName,
                description: it.description || null,
                system: it.system,
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
              }).select().single()
              if (pErr || !newProd) { console.error('Error creando producto:', pErr); continue }
              catalogId = newProd.id
              createdProducts[cacheKey] = newProd.id
              productData = newProd
              catalogCache[newProd.id] = newProd
            }
          }

          const cost = Number(productData?.cost) || 0
          const markup = Number(productData?.markup) || 33
          const price = cost > 0 ? Math.round(cost / (1 - markup / 100) * 100) / 100 : 0
          const installationCost = Math.round(price * 0.22 * 100) / 100

          await supabase.from('quotation_items').insert({
            quotation_id: quot.id,
            area_id: areaId,
            catalog_product_id: catalogId,
            name: productData?.name || (it.marca + ' ' + it.modelo).trim() || 'Item',
            description: it.description || productData?.description || null,
            system: it.system,
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
     RENDER
     ═══════════════════════════════════════════════════════════ */

  const totalItems = areas.reduce((s, a) => s + a.items.length, 0)
  const fromCatalog = areas.reduce((s, a) => s + a.items.filter(i => !i.is_new_suggestion).length, 0)
  const suggested = totalItems - fromCatalog

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>

        {/* ─── Header ─── */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={15} color="#57FF9A" /> Cotizar con AI
              {planFiles.length > 0 && <span style={{ background: '#3B82F620', color: '#3B82F6', border: '1px solid #3B82F644', fontSize: 9, padding: '2px 6px', borderRadius: 4 }}>+ {planFiles.length} plano{planFiles.length > 1 ? 's' : ''}</span>}
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
              {step === 'mode' && 'Elige cómo darle contexto al sistema'}
              {step === 'questionnaire' && 'Cuestionario rápido + plano opcional'}
              {step === 'freetext' && 'Pega el scope del proyecto'}
              {step === 'chat' && 'Conversación con AI — refina la propuesta'}
              {step === 'proposal' && 'Revisa y edita antes de crear la cotización'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {/* ─── Error banner ─── */}
        {error && (
          <div style={{ padding: '10px 16px', background: '#2a1414', borderBottom: '1px solid #5a2828', color: '#f87171', fontSize: 12, display: 'flex', gap: 8, flexShrink: 0 }}>
            <AlertTriangle size={14} /><span>{error}</span>
          </div>
        )}

        {/* ─── STEP: MODE ─── */}
        {step === 'mode' && (
          <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
              <button
                onClick={() => { setScope(s => ({ ...s, mode: 'questionnaire' })); setStep('questionnaire') }}
                style={{ padding: '24px 18px', background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 12, cursor: 'pointer', textAlign: 'left', color: '#ddd', fontFamily: 'inherit', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#57FF9A'; e.currentTarget.style.background = '#0e1a12' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.background = '#0e0e0e' }}
              >
                <div style={{ fontSize: 20, marginBottom: 8 }}>📋</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>Cuestionario guiado</div>
                <div style={{ fontSize: 11, color: '#888', lineHeight: 1.5 }}>Responde preguntas rápidas sobre el proyecto. Puedes subir un plano. La AI analiza y propone.</div>
              </button>
              <button
                onClick={() => { setScope(s => ({ ...s, mode: 'freetext' })); setStep('freetext') }}
                style={{ padding: '24px 18px', background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 12, cursor: 'pointer', textAlign: 'left', color: '#ddd', fontFamily: 'inherit', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#57FF9A'; e.currentTarget.style.background = '#0e1a12' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.background = '#0e0e0e' }}
              >
                <div style={{ fontSize: 20, marginBottom: 8 }}>📝</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>Pegar scope libre</div>
                <div style={{ fontSize: 11, color: '#888', lineHeight: 1.5 }}>Pega el brief del cliente o arquitecto. La AI extrae lo importante y genera propuesta.</div>
              </button>
            </div>
          </div>
        )}

        {/* ─── STEP: QUESTIONNAIRE ─── */}
        {step === 'questionnaire' && (
          <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
            <div style={{ display: 'grid', gap: 16 }}>
              {/* Tipo de proyecto */}
              <div>
                <label style={sLabel}>Tipo de proyecto *</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                  {PROJECT_TYPES.map(t => (
                    <button key={t.id} onClick={() => setScope(s => ({ ...s, tipo: t.id }))}
                      style={{ padding: '10px 8px', background: scope.tipo === t.id ? '#57FF9A15' : '#0e0e0e', border: '1px solid ' + (scope.tipo === t.id ? '#57FF9A' : '#2a2a2a'), borderRadius: 8, cursor: 'pointer', color: scope.tipo === t.id ? '#57FF9A' : '#888', fontFamily: 'inherit', fontSize: 11, textAlign: 'center' }}>
                      <div style={{ fontWeight: 600 }}>{t.label}</div>
                      <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Nombre + Lead + Cliente */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={sLabel}>Nombre del proyecto</label>
                  <input value={scope.nombre} onChange={e => setScope(s => ({ ...s, nombre: e.target.value }))} placeholder="Ej. Casa Roma 142" style={inputS} />
                </div>
                <div>
                  <label style={sLabel}>Lead</label>
                  <div style={{ position: 'relative' as const }}>
                    <input value={leadSearch} onChange={e => { setLeadSearch(e.target.value); setSelectedLeadId('') }}
                      onFocus={() => setShowLeadDrop(true)}
                      onBlur={() => setTimeout(() => setShowLeadDrop(false), 200)}
                      placeholder="Buscar lead..." style={inputS} />
                    {showLeadDrop && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, marginTop: 2, maxHeight: 200, overflowY: 'auto', zIndex: 20 }}>
                        {filteredLeads.length === 0 ? (
                          <div style={{ padding: '10px', fontSize: 11, color: '#555', textAlign: 'center' }}>Sin resultados</div>
                        ) : filteredLeads.map(l => (
                          <div key={l.id} onMouseDown={e => e.preventDefault()}
                            onClick={() => { setLeadSearch(l.name); setSelectedLeadId(l.id); setShowLeadDrop(false) }}
                            style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 12, color: '#ccc', borderBottom: '1px solid #222' }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#222' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                            <div style={{ fontWeight: 600, color: '#C084FC' }}>{l.name}</div>
                            {l.company && <div style={{ fontSize: 10, color: '#777' }}>{l.company}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedLead && (
                    <div style={{ marginTop: 6, padding: '6px 10px', background: '#120e1a', border: '1px solid #2a1a3a', borderRadius: 6, fontSize: 10, color: '#aaa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span><span style={{ color: '#C084FC', fontWeight: 600, fontSize: 11 }}>{selectedLead.name}</span>{selectedLead.company ? ' · ' + selectedLead.company : ''}</span>
                      <button onClick={() => { setLeadSearch(''); setSelectedLeadId('') }} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 10 }}>✕</button>
                    </div>
                  )}
                </div>
                <div>
                  <label style={sLabel}>Cliente</label>
                  <div style={{ position: 'relative' as const }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input value={clientSearch} onChange={e => { setClientSearch(e.target.value); setScope(s => ({ ...s, cliente: e.target.value })); setClientId('') }}
                        onFocus={() => setShowClientDrop(true)}
                        onBlur={() => setTimeout(() => setShowClientDrop(false), 200)}
                        placeholder="Buscar por nombre comercial..." style={inputS} />
                      <button onClick={() => setShowNewClient(v => !v)}
                        style={{ padding: '6px 10px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#888', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>+ Nuevo</button>
                    </div>
                    {showClientDrop && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, marginTop: 2, maxHeight: 200, overflowY: 'auto', zIndex: 20 }}>
                        {filteredClientes.length === 0 ? (
                          <div style={{ padding: '10px', fontSize: 11, color: '#555', textAlign: 'center' }}>Sin resultados</div>
                        ) : filteredClientes.map(c => (
                          <div key={c.id} onMouseDown={e => e.preventDefault()}
                            onClick={() => { setScope(s => ({ ...s, cliente: c.nombre_comercial || c.razon_social })); setClientSearch(c.nombre_comercial || c.razon_social); setClientId(c.id); setShowClientDrop(false) }}
                            style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 12, color: '#ccc', borderBottom: '1px solid #222' }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#222' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                            <div style={{ fontWeight: 600, color: '#57FF9A' }}>{c.nombre_comercial || c.razon_social}</div>
                            <div style={{ fontSize: 10, color: '#777' }}>{c.razon_social} · {c.rfc}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {showNewClient && (
                    <div style={{ marginTop: 8, padding: 10, background: '#0e0e0e', border: '1px solid #222', borderRadius: 8 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        <input value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="Nombre comercial"
                          style={{ padding: '6px 8px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit' }} />
                        <input value={newClientRazon} onChange={e => setNewClientRazon(e.target.value)} placeholder="Razón social"
                          style={{ padding: '6px 8px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit' }} />
                        <input value={newClientRfc} onChange={e => setNewClientRfc(e.target.value)} placeholder="RFC"
                          style={{ padding: '6px 8px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                        <Btn size="sm" onClick={() => setShowNewClient(false)}>Cancelar</Btn>
                        <Btn size="sm" variant="primary" onClick={crearClienteInline}>Crear</Btn>
                      </div>
                    </div>
                  )}
                  {selectedClient && (
                    <div style={{ marginTop: 6, padding: '6px 10px', background: '#0e1a0e', border: '1px solid #1a3a1a', borderRadius: 6, fontSize: 10, color: '#aaa', lineHeight: 1.6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#57FF9A', fontWeight: 600, fontSize: 11 }}>Datos de facturación</span>
                        <button onClick={() => { setScope(s => ({ ...s, cliente: '' })); setClientSearch(''); setClientId('') }}
                          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 10 }}>✕</button>
                      </div>
                      <div>{selectedClient.razon_social} · <span style={{ fontFamily: 'monospace' }}>{selectedClient.rfc}</span> · {selectedClient.regimen_fiscal || '—'} · CP {selectedClient.codigo_postal || '—'}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Tamaño, habitaciones, ubicación */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={sLabel}>Tamaño (m²)</label>
                  <input type="number" value={scope.tamano_m2 ?? ''} onChange={e => setScope(s => ({ ...s, tamano_m2: e.target.value ? parseInt(e.target.value) : null }))} placeholder="350" style={inputS} />
                </div>
                <div>
                  <label style={sLabel}>{scope.tipo === 'residencial' ? 'Recámaras' : scope.tipo === 'hoteleria' ? 'Habitaciones' : 'Oficinas / Cuartos'}</label>
                  <input type="number" value={scope.habitaciones ?? ''} onChange={e => setScope(s => ({ ...s, habitaciones: e.target.value ? parseInt(e.target.value) : null }))} placeholder="4" style={inputS} />
                </div>
                <div>
                  <label style={sLabel}>Ubicación</label>
                  <select value={scope.ubicacion} onChange={e => setScope(s => ({ ...s, ubicacion: e.target.value }))} style={inputS}>
                    {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Nivel */}
              <div>
                <label style={sLabel}>Nivel del proyecto *</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {LEVELS.map(l => (
                    <button key={l.id} onClick={() => setScope(s => ({ ...s, nivel: l.id }))}
                      style={{ flex: 1, padding: '8px 10px', background: scope.nivel === l.id ? '#57FF9A15' : '#0e0e0e', border: '1px solid ' + (scope.nivel === l.id ? '#57FF9A' : '#2a2a2a'), borderRadius: 8, cursor: 'pointer', color: scope.nivel === l.id ? '#57FF9A' : '#888', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sistemas */}
              <div>
                <label style={sLabel}>Sistemas a incluir *</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {AI_ALL_SYSTEMS.map(sys => {
                    const active = scope.sistemas.includes(sys.id)
                    return (
                      <button key={sys.id} onClick={() => toggleSystem(sys.id)}
                        style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', background: active ? sys.color + '20' : '#0e0e0e', border: '1px solid ' + (active ? sys.color : '#2a2a2a'), color: active ? sys.color : '#666' }}>
                        {sys.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Plan upload (multiple) */}
              <div>
                <label style={sLabel}>Planos arquitectónicos (opcional)</label>
                {planFiles.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    {planFiles.map((p, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(87,255,154,0.03)', border: '1px solid #57FF9A44', borderRadius: 8 }}>
                        <FileText size={16} color="#57FF9A" />
                        <div style={{ flex: 1, textAlign: 'left' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{p.file.name}</div>
                          <div style={{ fontSize: 10, color: p.uploading ? '#F59E0B' : '#888' }}>
                            {p.uploading ? 'Subiendo...' : `${(p.file.size / 1024 / 1024).toFixed(1)} MB`}
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); removePlan(i) }}
                          style={{ background: 'none', border: '1px solid #333', borderRadius: 6, padding: '3px 7px', color: '#666', cursor: 'pointer', fontSize: 10 }}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div
                  onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files) }}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => document.getElementById('plan-input-unified')?.click()}
                  style={{ border: '2px dashed #333', borderRadius: 10, padding: '18px 16px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  <input id="plan-input-unified" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple style={{ display: 'none' }}
                    onChange={e => { if (e.target.files?.length) { handleFiles(e.target.files); e.target.value = '' } }} />
                  <Upload size={18} color="#555" style={{ marginBottom: 4 }} />
                  <div style={{ fontSize: 12, color: '#888' }}>{planFiles.length > 0 ? 'Agregar más planos' : 'Arrastra planos o haz click'} · PDF, PNG, JPG</div>
                </div>
              </div>

              {/* Areas + Notas */}
              <div>
                <label style={sLabel}>Áreas específicas (opcional)</label>
                <textarea value={scope.areas_custom} onChange={e => setScope(s => ({ ...s, areas_custom: e.target.value }))}
                  placeholder="Ej: Sala, Comedor, Cocina, Recámara Principal, Terraza..."
                  rows={2} style={{ ...inputS, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div>
                <label style={sLabel}>Notas y restricciones</label>
                <textarea value={scope.notas} onChange={e => setScope(s => ({ ...s, notas: e.target.value }))}
                  placeholder="Ej: Sonos en sociales, Lutron RadioRA3, presupuesto ~$2M MXN..."
                  rows={2} style={{ ...inputS, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>

            {/* Data info */}
            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#666', marginTop: 16, padding: '10px 12px', background: '#0e0e0e', borderRadius: 8, border: '1px solid #1e1e1e' }}>
              {loadingData ? <span><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Cargando...</span>
                : <><span style={{ color: '#57FF9A' }}>{catalog.length} productos</span><span style={{ color: '#3B82F6' }}>{precedents.length} precedentes</span></>}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16, paddingTop: 14, borderTop: '1px solid #222' }}>
              <Btn onClick={() => setStep('mode')}>← Atrás</Btn>
              <Btn variant="primary" onClick={startChat} disabled={scope.sistemas.length === 0 || loadingData || planFiles.some(p => p.uploading)}>
                <MessageSquare size={14} /> {planFiles.some(p => p.uploading) ? 'Subiendo planos...' : 'Iniciar con AI →'}
              </Btn>
            </div>
          </div>
        )}

        {/* ─── STEP: FREETEXT ─── */}
        {step === 'freetext' && (
          <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column' }}>
            <label style={sLabel}>Pega el scope del proyecto</label>
            <textarea value={scope.freetext} onChange={e => setScope(s => ({ ...s, freetext: e.target.value }))}
              placeholder={`Ejemplo:\n\nProyecto: Casa en Bosques, 450m², 4 recámaras.\nCliente alto nivel, Sonos multi-zona, Lutron HomeWorks.\nRed Ubiquiti, 8 cámaras CCTV perímetro, acceso en entrada principal.`}
              rows={10}
              style={{ ...inputS, flex: 1, resize: 'none', fontFamily: 'inherit', lineHeight: 1.6 }} />

            {/* Optional plan upload in freetext mode too */}
            <div style={{ marginTop: 12 }}>
              <label style={sLabel}>Planos arquitectónicos (opcional)</label>
              {planFiles.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {planFiles.map((p, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#0e1a0e', border: '1px solid #1a3a1a', borderRadius: 6, padding: '3px 8px', fontSize: 11, color: '#57FF9A' }}>
                      <FileText size={10} /> {p.file.name}
                      <button onClick={() => removePlan(i)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 10, padding: 0 }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div
                onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files) }}
                onDragOver={e => e.preventDefault()}
                onClick={() => document.getElementById('plan-input-ft')?.click()}
                style={{ border: '1px dashed #333', borderRadius: 8, padding: '10px 16px', textAlign: 'center', cursor: 'pointer', fontSize: 12, color: '#666' }}
              >
                <input id="plan-input-ft" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple style={{ display: 'none' }}
                  onChange={e => { if (e.target.files?.length) { handleFiles(e.target.files); e.target.value = '' } }} />
                <span><Upload size={12} /> {planFiles.length > 0 ? 'Agregar más planos' : 'Subir planos'}</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid #222' }}>
              <Btn onClick={() => setStep('mode')}>← Atrás</Btn>
              <Btn variant="primary" onClick={startChat} disabled={!scope.freetext.trim() || loadingData || planFiles.some(p => p.uploading)}>
                <MessageSquare size={14} /> {planFiles.some(p => p.uploading) ? 'Subiendo planos...' : 'Iniciar con AI →'}
              </Btn>
            </div>
          </div>
        )}

        {/* ─── STEP: CHAT ─── */}
        {step === 'chat' && (
          <>
            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {messages.map((msg, i) => (
                <div key={i} style={{ marginBottom: 16, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '80%',
                    padding: '12px 16px',
                    borderRadius: 12,
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    background: msg.role === 'user' ? '#1a3a2a' : '#1a1a1a',
                    border: msg.role === 'user' ? '1px solid #57FF9A33' : '1px solid #2a2a2a',
                    color: msg.role === 'user' ? '#ccc' : '#ddd',
                  }}>
                    {msg.role === 'assistant' && <div style={{ fontSize: 9, color: '#57FF9A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>OMM AI</div>}
                    {msg.content}
                  </div>
                </div>
              ))}

              {sending && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 16 }}>
                  <div style={{ padding: '12px 16px', borderRadius: 12, background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                    <div style={{ fontSize: 9, color: '#57FF9A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>OMM AI</div>
                    <Loader2 size={16} color="#57FF9A" style={{ animation: 'spin 1s linear infinite' }} />
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Input bar */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #222', display: 'flex', gap: 8, flexShrink: 0 }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && chatInput.trim() && !sending) { e.preventDefault(); sendToAI(chatInput) } }}
                placeholder="Escribe tu mensaje o correcciones..."
                style={{ ...inputS, flex: 1 }}
                disabled={sending}
              />
              <Btn onClick={() => sendToAI(chatInput)} disabled={!chatInput.trim() || sending} style={{ padding: '8px 12px' }}>
                <Send size={14} />
              </Btn>
              <Btn variant="primary" onClick={requestProposal} disabled={sending || messages.length < 2}>
                <Zap size={14} /> Generar propuesta
              </Btn>
            </div>
          </>
        )}

        {/* ─── STEP: PROPOSAL ─── */}
        {step === 'proposal' && !inserting && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, overflow: 'hidden' }}>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12, flexShrink: 0 }}>
              <div style={{ padding: '10px 12px', background: '#0e0e0e', border: '1px solid #222', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Áreas</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{areas.length}</div>
              </div>
              <div style={{ padding: '10px 12px', background: '#0e0e0e', border: '1px solid #222', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Items</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{totalItems}</div>
              </div>
              <div style={{ padding: '10px 12px', background: '#0e1a12', border: '1px solid #57FF9A33', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#57FF9A', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Del catálogo</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#57FF9A' }}>{fromCatalog}</div>
              </div>
              <div style={{ padding: '10px 12px', background: '#1a1610', border: '1px solid #F59E0B33', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sugeridos</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B' }}>{suggested}</div>
              </div>
            </div>

            {/* Rationale */}
            {rationale && (
              <div style={{ padding: '10px 12px', background: '#0e0e0e', border: '1px solid #222', borderRadius: 8, marginBottom: 10, fontSize: 11, color: '#aaa', lineHeight: 1.5, flexShrink: 0 }}>
                <span style={{ color: '#57FF9A', fontWeight: 600 }}>Razonamiento: </span>{rationale}
              </div>
            )}

            {/* Warnings */}
            {warnings.length > 0 && (
              <div style={{ padding: '8px 12px', background: '#1a1610', border: '1px solid #3a2e10', borderRadius: 8, marginBottom: 10, flexShrink: 0 }}>
                <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 600, marginBottom: 4 }}>Advertencias:</div>
                {warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#aaa' }}>• {w}</div>)}
              </div>
            )}

            {/* Areas list */}
            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #222', borderRadius: 8, padding: 10 }}>
              {areas.map((area, ai) => (
                <div key={ai} style={{ marginBottom: 14, background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <input value={area.name}
                      onChange={e => setAreas(prev => prev.map((a, i) => i === ai ? { ...a, name: e.target.value } : a))}
                      style={{ flex: 1, padding: '6px 8px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }} />
                    {area.level && <span style={{ background: '#1a1a1a', color: '#888', border: '1px solid #333', fontSize: 9, padding: '2px 6px', borderRadius: 4 }}>{area.level}</span>}
                    <button onClick={() => removeArea(ai)} style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: 6, padding: '4px 8px', color: '#666', cursor: 'pointer', fontSize: 10 }}>
                      <Trash2 size={10} />
                    </button>
                  </div>

                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
                        <th style={{ padding: '4px 6px', textAlign: 'center', color: '#444', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, width: 50 }}>Cant</th>
                        <th style={{ padding: '4px 6px', textAlign: 'left', color: '#444', fontSize: 9, textTransform: 'uppercase', fontWeight: 600 }}>Producto</th>
                        <th style={{ padding: '4px 6px', textAlign: 'left', color: '#444', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, width: 120 }}>Sistema</th>
                        <th style={{ padding: '4px 6px', width: 80 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {area.items.map(it => (
                        <tr key={it._rowId} style={{ borderBottom: '1px solid #111' }}>
                          <td style={{ padding: '6px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                              <button onClick={() => updateItemQty(ai, it._rowId, -1)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 2 }}><Minus size={10} /></button>
                              <span style={{ color: '#fff', fontWeight: 600, minWidth: 16, textAlign: 'center' }}>{it.quantity}</span>
                              <button onClick={() => updateItemQty(ai, it._rowId, 1)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 2 }}><Plus size={10} /></button>
                            </div>
                          </td>
                          <td style={{ padding: '6px' }}>
                            <div style={{ color: '#ddd', fontWeight: 500 }}>{it.marca} {it.modelo}</div>
                            <div style={{ color: '#666', fontSize: 10 }}>{it.description}</div>
                            {it.is_new_suggestion && <span style={{ background: '#F59E0B20', color: '#F59E0B', border: '1px solid #F59E0B44', fontSize: 8, marginTop: 2, padding: '1px 5px', borderRadius: 3, display: 'inline-block' }}>Sugerido</span>}
                          </td>
                          <td style={{ padding: '6px' }}>
                            <span style={{ background: (AI_ALL_SYSTEMS.find(s => s.name === it.system)?.color || '#888') + '20', color: AI_ALL_SYSTEMS.find(s => s.name === it.system)?.color || '#888', border: '1px solid ' + (AI_ALL_SYSTEMS.find(s => s.name === it.system)?.color || '#888') + '44', fontSize: 9, padding: '2px 6px', borderRadius: 4 }}>
                              {it.system}
                            </span>
                          </td>
                          <td style={{ padding: '6px', textAlign: 'center' }}>
                            <button onClick={() => removeItem(ai, it._rowId)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><Trash2 size={12} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid #222', flexShrink: 0 }}>
              <Btn onClick={backToChat}><ChevronLeft size={14} /> Volver al chat</Btn>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn onClick={downloadSembrado} disabled={downloadingSembrado} style={{ background: '#0e1a12', color: '#57FF9A', border: '1px solid #57FF9A44' }}>
                  {downloadingSembrado ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
                  {downloadingSembrado ? 'Generando...' : 'Sembrado PDF'}
                </Btn>
                <Btn variant="primary" onClick={handleConfirm}>
                  <CheckCircle size={14} /> Crear cotización
                </Btn>
              </div>
            </div>
          </div>
        )}

        {/* ─── INSERTING ─── */}
        {inserting && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
            <div style={{ textAlign: 'center' }}>
              <Loader2 size={36} color="#57FF9A" style={{ animation: 'spin 1s linear infinite', marginBottom: 16 }} />
              <div style={{ fontSize: 14, color: '#ccc', fontWeight: 600 }}>{insertProgress}</div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
