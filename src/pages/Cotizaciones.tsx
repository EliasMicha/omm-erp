import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Quotation, QuotationArea, QuotationItem, CatalogProduct, Project, ProjectLine, PurchasePhase } from '../types'
import { F, SPECIALTY_CONFIG, STAGE_CONFIG, PHASE_CONFIG, calcItemPrice, calcItemTotal } from '../lib/utils'
import { Badge, Btn, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { Plus, ChevronLeft, X, Zap } from 'lucide-react'
import CotEditorESP from './CotEditorESP'

interface Supplier { id: string; name: string }

function CotDashboard({ onOpen }: { onOpen: (id: string, specialty?: string) => void }) {
  const [cots, setCots] = useState<Quotation[]>([])
  const [filtro, setFiltro] = useState<string>('todas')
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  const loadCots = () => {
    setLoading(true)
    supabase.from('quotations').select('*,project:projects(name,client_name)').order('updated_at',{ascending:false})
      .then(({ data }) => { setCots(data||[]); setLoading(false) })
  }

  useEffect(() => { loadCots() }, [])

  const lista = filtro === 'todas' ? cots : cots.filter(c => c.specialty === filtro)

  function getCur(c: any): string {
    try { const m = JSON.parse(c.notes || '{}'); return m.currency || 'USD' } catch { return 'USD' }
  }
  function getLeadName(c: any): string {
    try { const m = JSON.parse(c.notes || '{}'); return m.lead_name || '' } catch { return '' }
  }

  const byStageAndCur = (s: string, cur: string) => cots.filter(c => c.stage === s && getCur(c) === cur).reduce((a,c) => a+c.total, 0)
  const totalUSD = cots.filter(c => getCur(c) === 'USD').reduce((s,c) => s+c.total, 0)
  const totalMXN = cots.filter(c => getCur(c) === 'MXN').reduce((s,c) => s+c.total, 0)

  return (
    <div style={{padding:'24px 28px'}}>
      <SectionHeader title="Cotizaciones"
        subtitle={`${cots.length} cotizaciones | USD: ${F(totalUSD)} | MXN: ${F(totalMXN)}`}
        action={<Btn variant="primary" onClick={() => setShowNew(true)}><Plus size={14}/> Nueva cotizacion</Btn>}/>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:20}}>
        {(['contrato','propuesta','estimacion','oportunidad'] as const).map(s => {
          const cfg = STAGE_CONFIG[s]
          const usd = byStageAndCur(s, 'USD')
          const mxn = byStageAndCur(s, 'MXN')
          return (
            <div key={s} style={{background:'#141414',border:'1px solid #222',borderRadius:10,padding:'12px 14px',borderTop:`2px solid ${cfg.color}`}}>
              <div style={{fontSize:10,color:'#555',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:4}}>{cfg.label}</div>
              {usd > 0 && <div style={{fontSize:16,fontWeight:700,color:'#fff'}}>USD {F(usd)}</div>}
              {mxn > 0 && <div style={{fontSize:14,fontWeight:600,color:'#ccc'}}>MXN {F(mxn)}</div>}
              {usd === 0 && mxn === 0 && <div style={{fontSize:16,fontWeight:700,color:'#333'}}>$0</div>}
            </div>
          )
        })}
      </div>

      <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
        {['todas','esp','elec','ilum','cort','proy'].map(f => {
          const on = filtro === f
          const cfg = f !== 'todas' ? SPECIALTY_CONFIG[f as ProjectLine] : null
          return (
            <button key={f} onClick={() => setFiltro(f)} style={{
              padding:'5px 12px',borderRadius:20,fontSize:11,cursor:'pointer',fontFamily:'inherit',
              border:`1px solid ${on?(cfg?.color||'#57FF9A'):'#333'}`,
              background:on?(cfg?.color||'#57FF9A')+'22':'transparent',
              color:on?(cfg?.color||'#57FF9A'):'#666',fontWeight:on?600:400,
            }}>
              {f === 'todas' ? 'Todas' : cfg?.icon+' '+cfg?.label}
            </button>
          )
        })}
      </div>

      {loading ? <Loading/> : (
        <Table>
          <thead><tr>
            <Th>Cotizacion</Th><Th>Lead</Th><Th>Cliente</Th><Th>Especialidad</Th><Th>Etapa</Th><Th>Moneda</Th><Th right>Total</Th><Th></Th>
          </tr></thead>
          <tbody>
            {lista.length === 0 && (<tr><td colSpan={8}><EmptyState message="Sin cotizaciones - crea la primera"/></td></tr>)}
            {lista.map(c => {
              const esp = SPECIALTY_CONFIG[c.specialty]; const stage = STAGE_CONFIG[c.stage]
              const cur = getCur(c)
              const leadName = getLeadName(c)
              return (
                <tr key={c.id} style={{cursor:'pointer'}} onClick={() => onOpen(c.id, c.specialty)}>
                  <Td><span style={{fontWeight:500,color:'#fff'}}>{c.name}</span></Td>
                  <Td><span style={{color: leadName ? '#C084FC' : '#333'}}>{leadName || '--'}</span></Td>
                  <Td muted>{c.client_name || '--'}</Td>
                  <Td><Badge label={esp.icon+' '+esp.label} color={esp.color}/></Td>
                  <Td>
                    <select
                      value={c.stage}
                      onClick={e => e.stopPropagation()}
                      onChange={e => {
                        const newStage = e.target.value
                        supabase.from('quotations').update({ stage: newStage }).eq('id', c.id).then(() => {})
                        setCots(prev => prev.map(q => q.id === c.id ? { ...q, stage: newStage as any } : q))
                      }}
                      style={{
                        padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 6,
                        background: stage.color + '18', border: `1px solid ${stage.color}44`,
                        color: stage.color, cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {(Object.entries(STAGE_CONFIG) as [string, { label: string; color: string }][]).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                  </Td>
                  <Td><span style={{fontSize:11,fontWeight:600,color: cur === 'USD' ? '#06B6D4' : '#F59E0B'}}>{cur}</span></Td>
                  <Td right><span style={{fontWeight:600,color:'#57FF9A'}}>{cur === 'MXN' ? '$' : 'US$'}{c.total.toLocaleString()}</span></Td>
                  <Td><Btn size="sm" onClick={e => { e?.stopPropagation(); onOpen(c.id, c.specialty) }}>Abrir</Btn></Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {showNew && <NuevaCoModal onClose={() => setShowNew(false)} onCreated={(id, spec) => { setShowNew(false); onOpen(id, spec) }}/>}
    </div>
  )
}

// ─── CATALOGS FOR NEW QUOTE MODAL ─────────────────────────────────────────
const AREA_PRESETS = [
  'Recámara Principal', 'Sala/Comedor', 'Cocina', 'Cocina Abierta', 'Family', 'Site',
  'Gym', 'Vestidor/Baño', 'Lavado', 'Rec. 1', 'Rec. 2', 'Rec. 3', 'Rec. 4',
  'Estudio', 'Terraza', 'Jardín', 'Alberca', 'Lobby', 'Estacionamiento',
  'Cuarto de Servicio', 'Roof Garden', 'Sala de Juntas', 'Oficina',
]

const SYSTEM_PRESETS = [
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

interface ClienteSimple { id: string; razon_social: string; rfc: string }
interface LeadSimple { id: string; name: string; company: string; contact_name: string }

function NuevaCoModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string, specialty: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [clientes, setClientes] = useState<ClienteSimple[]>([])
  const [leads, setLeads] = useState<LeadSimple[]>([])
  const [form, setForm] = useState({
    project_id: '', name: '', specialty: 'esp', client_name: '', client_id: '', lead_id: '', currency: 'USD' as 'USD' | 'MXN',
    systems: ['audio', 'redes'] as string[],
    areas: ['Recámara Principal', 'Sala/Comedor', 'Cocina', 'Site'] as string[],
  })
  const [saving, setSaving] = useState(false)
  const [customArea, setCustomArea] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDrop, setShowClientDrop] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('*').eq('status', 'activo'),
      supabase.from('clientes_fiscales').select('id,razon_social,rfc').eq('activo', true).order('razon_social'),
      supabase.from('leads').select('id,name,company,contact_name').order('created_at', { ascending: false }).limit(50),
    ]).then(([{ data: p }, { data: c }, { data: l }]) => {
      setProjects(p || [])
      setClientes(c || [])
      setLeads(l || [])
    })
  }, [])

  const toggleSystem = (sysId: string) =>
    setForm(f => ({ ...f, systems: f.systems.includes(sysId) ? f.systems.filter(s => s !== sysId) : [...f.systems, sysId] }))

  const toggleArea = (area: string) =>
    setForm(f => ({ ...f, areas: f.areas.includes(area) ? f.areas.filter(a => a !== area) : [...f.areas, area] }))

  const addCustomArea = () => {
    if (!customArea.trim() || form.areas.includes(customArea.trim())) return
    setForm(f => ({ ...f, areas: [...f.areas, customArea.trim()] }))
    setCustomArea('')
  }

  const selectClient = (c: ClienteSimple) => {
    setForm(f => ({ ...f, client_name: c.razon_social, client_id: c.id }))
    setClientSearch(c.razon_social)
    setShowClientDrop(false)
  }

  const selectLead = (l: LeadSimple) => {
    setForm(f => ({
      ...f,
      lead_id: l.id,
      client_name: l.company || l.name,
      name: f.name || (l.name + ' - Especiales'),
    }))
  }

  const filteredClientes = clientSearch.length >= 2
    ? clientes.filter(c => c.razon_social.toLowerCase().includes(clientSearch.toLowerCase()) || c.rfc.toLowerCase().includes(clientSearch.toLowerCase()))
    : clientes.slice(0, 8)

  async function crear() {
    if (!form.name) return
    setSaving(true)
    const { data } = await supabase.from('quotations').insert({
      project_id: form.project_id || null, name: form.name,
      specialty: form.specialty, client_name: form.client_name, stage: 'oportunidad',
      notes: JSON.stringify({ systems: isEsp ? form.systems : [], currency: form.currency, lead_id: form.lead_id || null, lead_name: form.lead_id ? (leads.find(l => l.id === form.lead_id)?.name || '') : '' }),
    }).select().single()
    if (data) {
      // Create areas — solo aplica para Especiales. Iluminación/otros usan General invisible
      const useFormAreas = form.specialty === 'esp'
      const areaInserts = useFormAreas ? form.areas.map((name, i) => ({ quotation_id: data.id, name, order_index: i })) : []
      if (areaInserts.length > 0) {
        await supabase.from('quotation_areas').insert(areaInserts)
      } else {
        await supabase.from('quotation_areas').insert({ quotation_id: data.id, name: 'General', order_index: 0 })
      }
      onCreated(data.id, form.specialty)
    }
    setSaving(false)
  }

  const isEsp = form.specialty === 'esp'
  const inputStyle = { display: 'block' as const, width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit' }
  const labelStyle = { fontSize: 11, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block' as const }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Nueva cotización</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>

          {/* Especialidad */}
          <label style={labelStyle}>
            Especialidad
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {Object.entries(SPECIALTY_CONFIG).map(([k, v]) => (
                <button key={k} onClick={() => setForm(f => ({ ...f, specialty: k }))}
                  style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                    border: '1px solid ' + (form.specialty === k ? v.color : '#333'),
                    background: form.specialty === k ? v.color + '22' : 'transparent',
                    color: form.specialty === k ? v.color : '#666',
                  }}>
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
          </label>

          {/* Nombre + Moneda */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
            <label style={labelStyle}>
              Nombre de la cotización
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ej. Mizrahi - Miralta" style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Moneda
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                {(['USD', 'MXN'] as const).map(cur => (
                  <button key={cur} onClick={() => setForm(f => ({ ...f, currency: cur }))} style={{
                    padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                    border: '1px solid ' + (form.currency === cur ? '#57FF9A' : '#333'),
                    background: form.currency === cur ? '#57FF9A22' : 'transparent',
                    color: form.currency === cur ? '#57FF9A' : '#555',
                  }}>{cur === 'USD' ? '🇺🇸 USD' : '🇲🇽 MXN'}</button>
                ))}
              </div>
            </label>
          </div>

          {/* Lead */}
          {leads.length > 0 && (
            <label style={labelStyle}>
              Lead (opcional)
              <select value={form.lead_id} onChange={e => {
                const lead = leads.find(l => l.id === e.target.value)
                if (lead) selectLead(lead)
                else setForm(f => ({ ...f, lead_id: '' }))
              }} style={inputStyle}>
                <option value="">-- Seleccionar lead --</option>
                {leads.map(l => <option key={l.id} value={l.id}>{l.name}{l.company ? ' | ' + l.company : ''}</option>)}
              </select>
            </label>
          )}

          {/* Cliente */}
          <label style={labelStyle}>
            Cliente
            <div style={{ position: 'relative' }}>
              <input value={clientSearch || form.client_name}
                onChange={e => { setClientSearch(e.target.value); setForm(f => ({ ...f, client_name: e.target.value, client_id: '' })); setShowClientDrop(true) }}
                onFocus={() => setShowClientDrop(true)}
                placeholder="Buscar cliente o escribir nombre..."
                style={inputStyle} />
              {showClientDrop && filteredClientes.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, marginTop: 2, maxHeight: 180, overflowY: 'auto', zIndex: 10 }}>
                  {filteredClientes.map(c => (
                    <div key={c.id} onClick={() => selectClient(c)}
                      style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 12, color: '#ccc', borderBottom: '1px solid #222' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#222' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      <div style={{ fontWeight: 500 }}>{c.razon_social}</div>
                      <div style={{ fontSize: 10, color: '#555' }}>{c.rfc}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </label>

          {/* Proyecto */}
          <label style={labelStyle}>
            Proyecto (opcional)
            <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} style={inputStyle}>
              <option value="">-- Sin proyecto --</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name} | {p.client_name}</option>)}
            </select>
          </label>

          {/* === ESP-SPECIFIC: Sistemas === */}
          {isEsp && (
            <label style={labelStyle}>
              Sistemas
              <div style={{ fontSize: 10, color: '#444', marginTop: 2, marginBottom: 6, fontStyle: 'italic', textTransform: 'none' }}>
                Selecciona los sistemas que aplican. Estarán disponibles en todas las áreas.
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {SYSTEM_PRESETS.map(sys => {
                  const on = form.systems.includes(sys.id)
                  return (
                    <button key={sys.id} onClick={() => toggleSystem(sys.id)} style={{
                      padding: '5px 10px', borderRadius: 8, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                      border: '1px solid ' + (on ? sys.color : '#333'),
                      background: on ? sys.color + '22' : 'transparent',
                      color: on ? sys.color : '#555',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? sys.color : '#444' }} />
                      {sys.name}
                    </button>
                  )
                })}
              </div>
            </label>
          )}

          {/* === ESP-SPECIFIC: Áreas === */}
          {isEsp && (
            <label style={labelStyle}>
              Áreas / Zonas
              <div style={{ fontSize: 10, color: '#444', marginTop: 2, marginBottom: 6, fontStyle: 'italic', textTransform: 'none' }}>
                Selecciona las zonas del proyecto. Puedes agregar áreas custom.
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {AREA_PRESETS.map(area => {
                  const on = form.areas.includes(area)
                  return (
                    <button key={area} onClick={() => toggleArea(area)} style={{
                      padding: '4px 10px', borderRadius: 8, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
                      border: '1px solid ' + (on ? '#57FF9A' : '#333'),
                      background: on ? '#57FF9A18' : 'transparent',
                      color: on ? '#57FF9A' : '#555', fontWeight: on ? 600 : 400,
                    }}>
                      {on ? '✓ ' : ''}{area}
                    </button>
                  )
                })}
                {/* Custom areas added */}
                {form.areas.filter(a => !AREA_PRESETS.includes(a)).map(area => (
                  <button key={area} onClick={() => toggleArea(area)} style={{
                    padding: '4px 10px', borderRadius: 8, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
                    border: '1px solid #57FF9A', background: '#57FF9A18', color: '#57FF9A', fontWeight: 600,
                  }}>✓ {area}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={customArea} onChange={e => setCustomArea(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustomArea()}
                  placeholder="Área personalizada..."
                  style={{ ...inputStyle, flex: 1, marginTop: 0 }} />
                <Btn size="sm" onClick={addCustomArea}>+ Agregar</Btn>
              </div>
            </label>
          )}

          {/* Selected summary */}
          {isEsp && (form.systems.length > 0 || form.areas.length > 0) && (
            <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, padding: '10px 12px', fontSize: 10, color: '#555' }}>
              <span style={{ color: '#888' }}>{form.systems.length} sistemas</span> × <span style={{ color: '#888' }}>{form.areas.length} áreas</span>
              <span style={{ color: '#444' }}> = {form.systems.length * form.areas.length} combinaciones posibles</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={crear} disabled={!form.name || saving}>{saving ? 'Creando...' : 'Crear cotización'}</Btn>
        </div>
      </div>
    </div>
  )
}

function CotEditor({ cotId, onBack }: { cotId: string; onBack: () => void }) {
  const [cot, setCot] = useState<Quotation|null>(null)
  const [areas, setAreas] = useState<QuotationArea[]>([])
  const [items, setItems] = useState<QuotationItem[]>([])
  const [areaActiva, setAreaActiva] = useState<string|null>(null)
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [showCat, setShowCat] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<string|null>(null)

  useEffect(() => {
    async function load() {
      const [{ data: c },{ data: as_ },{ data: it },{ data: cat },{ data: sups }] = await Promise.all([
        supabase.from('quotations').select('*,project:projects(name,client_name)').eq('id',cotId).single(),
        supabase.from('quotation_areas').select('*').eq('quotation_id',cotId).order('order_index'),
        supabase.from('quotation_items').select('*').eq('quotation_id',cotId),
        supabase.from('catalog_products').select('*').eq('is_active',true).order('name'),
        supabase.from('suppliers').select('id,name').eq('is_active',true).order('name'),
      ])
      setCot(c); setAreas(as_||[]); setItems(it||[]); setCatalog(cat||[]); setSuppliers(sups||[])
      if (as_ && as_.length > 0) setAreaActiva(as_[0].id)
      setLoading(false)
    }
    load()
  }, [cotId])

  async function setStage(stage: string) {
    const prevStage = cot?.stage
    await supabase.from('quotations').update({ stage }).eq('id', cotId)
    setCot(c => c ? {...c, stage: stage as any} : c)

    // Auto-generate POs when moving to "contrato"
    if (stage === 'contrato' && prevStage !== 'contrato') {
      await generatePurchaseOrders()
    }
  }

  // ─── AUTO-GENERATE PURCHASE ORDERS ──────────────────────────────────────
  async function generatePurchaseOrders() {
    if (!cot) return
    setGenerating(true); setGenResult(null)

    // Get all material items with supplier_id
    const materialItems = items.filter(it => it.type === 'material' && it.supplier_id)

    if (materialItems.length === 0) {
      setGenResult('No hay materiales con distribuidor asignado. Asigna distribuidores desde el catálogo.')
      setGenerating(false)
      return
    }

    // Group by supplier_id × purchase_phase
    const groups: Record<string, QuotationItem[]> = {}
    materialItems.forEach(it => {
      const key = `${it.supplier_id}__${it.purchase_phase || 'inicio'}`
      if (!groups[key]) groups[key] = []
      groups[key].push(it)
    })

    // Check if POs already exist for this quotation
    const { data: existing } = await supabase.from('purchase_orders')
      .select('id').eq('quotation_id', cotId)
    if (existing && existing.length > 0) {
      setGenResult(`Ya existen ${existing.length} OC generadas para esta cotización. Revísalas en el módulo de Compras.`)
      setGenerating(false)
      return
    }

    let created = 0
    const now = new Date()
    const prefix = `OC-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`

    // Get current count for numbering
    const { count: baseCount } = await supabase.from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .like('po_number', `${prefix}%`)
    let seq = (baseCount || 0)

    for (const [key, groupItems] of Object.entries(groups)) {
      const [supplierId, phase] = key.split('__')
      seq++
      const po_number = `${prefix}-${String(seq).padStart(3, '0')}`

      const subtotal = groupItems.reduce((s, it) => s + (it.cost * it.quantity), 0)
      const iva = Math.round(subtotal * 0.16)

      const phaseCfg = PHASE_CONFIG[phase as PurchasePhase]
      const supplierName = suppliers.find(s => s.id === supplierId)?.name || ''

      const { data: po, error: poErr } = await supabase.from('purchase_orders').insert({
        po_number,
        project_id: cot.project_id || null,
        supplier_id: supplierId,
        quotation_id: cotId,
        specialty: cot.specialty,
        status: 'borrador',
        purchase_phase: phase,
        subtotal, iva, total: subtotal + iva,
        notes: `Auto-generada | ${cot.name} | ${phaseCfg?.label || phase} | ${supplierName}`,
      }).select().single()

      if (poErr || !po) continue

      // Insert PO items
      const poItems = groupItems.map((it, i) => ({
        purchase_order_id: po.id,
        catalog_product_id: it.catalog_product_id || null,
        name: it.name,
        description: it.description || null,
        system: it.system || null,
        unit: 'pza',
        quantity: it.quantity,
        unit_cost: it.cost,
        total: it.cost * it.quantity,
        quantity_received: 0,
        order_index: i,
      }))
      await supabase.from('po_items').insert(poItems)
      created++
    }

    setGenResult(`Se generaron ${created} órdenes de compra agrupadas por distribuidor y fase.`)
    setGenerating(false)
  }

  async function addArea() {
    const nombre = prompt('Nombre del area:')
    if (!nombre) return
    const { data } = await supabase.from('quotation_areas').insert({ quotation_id: cotId, name: nombre, order_index: areas.length }).select().single()
    if (data) { setAreas(a => [...a, data]); setAreaActiva(data.id) }
  }

  async function addFromCatalog(prod: CatalogProduct) {
    if (!areaActiva) return
    const item = {
      area_id: areaActiva, quotation_id: cotId, catalog_product_id: prod.id,
      name: prod.name, description: prod.description, system: prod.system,
      type: prod.type, provider: prod.provider, quantity: 1,
      cost: prod.cost, markup: prod.markup,
      supplier_id: prod.supplier_id || null,
      purchase_phase: prod.purchase_phase || 'inicio',
      price: calcItemPrice(prod.cost, prod.markup),
      total: calcItemTotal(prod.cost, prod.markup, 1),
      installation_cost: 0, order_index: items.filter(i => i.area_id === areaActiva).length,
    }
    const { data } = await supabase.from('quotation_items').insert(item).select().single()
    if (data) setItems(prev => [...prev, data])
    setShowCat(false)
  }

  async function updateItem(id: string, campo: string, val: number) {
    const item = items.find(i => i.id === id)
    if (!item) return
    const updated = {...item, [campo]: val}
    updated.price = calcItemPrice(updated.cost, updated.markup)
    updated.total = calcItemTotal(updated.cost, updated.markup, updated.quantity)
    await supabase.from('quotation_items').update({ [campo]: val, price: updated.price, total: updated.total }).eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? updated : i))
  }

  async function removeItem(id: string) {
    await supabase.from('quotation_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  if (loading||!cot) return <Loading/>

  const areaItems = items.filter(i => i.area_id === areaActiva)
  const areaTotal = areaItems.reduce((s,i) => s+i.total, 0)
  const cotTotal = items.reduce((s,i) => s+i.total, 0)
  const areaObj = areas.find(a => a.id === areaActiva)
  const esp = SPECIALTY_CONFIG[cot.specialty]
  const isIlum = cot.specialty === 'ilum'
  const displayItems = isIlum ? items : areaItems
  const displayTotal = isIlum ? cotTotal : areaTotal
  const proj = cot.project as any

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden'}}>
      <div style={{padding:'8px 16px',borderBottom:'1px solid #222',display:'flex',alignItems:'center',gap:10,flexShrink:0,background:'#111'}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'#666',cursor:'pointer',display:'flex',alignItems:'center',gap:4,fontSize:12}}>
          <ChevronLeft size={14}/> Cotizaciones
        </button>
        <span style={{color:'#333'}}>/</span>
        <span style={{fontSize:12,fontWeight:500,color:esp.color}}>{esp.icon} {cot.name}</span>
        {proj && <span style={{fontSize:11,color:'#555'}}> {proj.client_name}</span>}
        <div style={{marginLeft:'auto',display:'flex',gap:4,alignItems:'center'}}>
          {(Object.entries(STAGE_CONFIG) as any[]).map(([s,cfg]) => (
            <button key={s} onClick={()=>setStage(s)} style={{
              padding:'3px 10px',borderRadius:20,fontSize:10,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              border:`1px solid ${cot.stage===s?cfg.color:'#333'}`,
              background:cot.stage===s?cfg.color+'22':'transparent',
              color:cot.stage===s?cfg.color:'#555',
            }}>{cfg.label}</button>
          ))}
          <Btn size="sm" variant="primary" onClick={()=>setShowCat(true)} style={{marginLeft:8}}>
            <Plus size={12}/> Producto
          </Btn>
          {cot.stage === 'contrato' && (
            <Btn size="sm" onClick={generatePurchaseOrders} disabled={generating} style={{marginLeft:4}}>
              <Zap size={12}/> {generating ? 'Generando...' : 'Regenerar OC'}
            </Btn>
          )}
          <span style={{fontSize:14,fontWeight:700,color:'#57FF9A',marginLeft:8}}>{F(cotTotal)}</span>
        </div>
      </div>

      {/* Auto-generation result banner */}
      {genResult && (
        <div style={{padding:'8px 16px',background:'#1a2a1a',borderBottom:'1px solid #333',display:'flex',alignItems:'center',gap:8,fontSize:12}}>
          <Zap size={14} style={{color:'#57FF9A'}}/>
          <span style={{color:'#ccc',flex:1}}>{genResult}</span>
          <button onClick={()=>setGenResult(null)} style={{background:'none',border:'none',color:'#555',cursor:'pointer',fontSize:14}}>x</button>
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns: isIlum ? '1fr' : '175px 1fr',flex:1,overflow:'hidden'}}>
        {!isIlum && <div style={{borderRight:'1px solid #222',overflowY:'auto',background:'#0e0e0e'}}>
          <div style={{padding:'8px 8px 4px',fontSize:9,fontWeight:600,color:'#444',textTransform:'uppercase',letterSpacing:'0.1em'}}>Areas</div>
          {areas.map(a => {
            const tot = items.filter(i=>i.area_id===a.id).reduce((s,i)=>s+i.total,0)
            const active = a.id === areaActiva
            return (
              <div key={a.id} onClick={()=>setAreaActiva(a.id)} style={{
                display:'flex',justifyContent:'space-between',padding:'7px 10px',cursor:'pointer',
                borderLeft:`2px solid ${active?esp.color:'transparent'}`,
                background:active?esp.color+'11':'transparent',
                fontSize:11,color:active?'#fff':'#666',fontWeight:active?600:400,
              }}>
                <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.name}</span>
                <span style={{fontSize:10,color:'#444',flexShrink:0}}>{F(tot)}</span>
              </div>
            )
          })}
          <div onClick={addArea} style={{margin:'4px 8px',padding:'4px',border:'1px dashed #333',borderRadius:6,textAlign:'center',cursor:'pointer',fontSize:10,color:'#444'}}>+ Area</div>
        </div>}

        <div style={{display:'flex',flexDirection:'column',overflow:'hidden'}}>
          <div style={{padding:'6px 14px',borderBottom:'1px solid #222',display:'flex',alignItems:'center',gap:8,flexShrink:0,background:'#111'}}>
            <span style={{fontSize:12,fontWeight:600,color:'#fff'}}>{isIlum ? 'Luminarias' : areaObj?.name}</span>
            <span style={{marginLeft:'auto',fontSize:13,fontWeight:700,color:esp.color}}>{F(displayTotal)}</span>
          </div>

          <div style={{flex:1,overflowY:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#1a1a1a',position:'sticky',top:0,zIndex:1}}>
                  {(isIlum ? ['Producto','Marca','Modelo','W','Cant.','Costo','Markup%','Precio','Total',''] : ['Producto','Sistema','Fase','Distrib.','Tipo','Cant.','Costo','Markup%','Precio','Total','']).map((h,i) => (
                    <th key={h} style={{padding:'6px 8px',fontSize:10,fontWeight:600,color:'#444',textAlign:(isIlum ? i>=4 : i>=5)?'right':'left',textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:'1px solid #222',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayItems.map(item => {
                  const phaseCfg = item.purchase_phase ? PHASE_CONFIG[item.purchase_phase as PurchasePhase] : null
                  const supplierName = item.supplier_id ? suppliers.find(s => s.id === item.supplier_id)?.name : null
                  const catProd = catalog.find(c => c.id === item.catalog_product_id) as any
                  return (
                  <tr key={item.id}>
                    <td style={{padding:'7px 8px',fontSize:12,fontWeight:500,color:'#ddd',borderBottom:'1px solid #1a1a1a'}}>{item.name}</td>
                    {!isIlum && <td style={{padding:'7px 8px',borderBottom:'1px solid #1a1a1a'}}>{item.system&&<Badge label={item.system} color="#555"/>}</td>}
                    {!isIlum && <td style={{padding:'7px 8px',borderBottom:'1px solid #1a1a1a'}}>{phaseCfg ? <Badge label={phaseCfg.label} color={phaseCfg.color}/> : <span style={{color:'#444',fontSize:10}}>--</span>}</td>}
                    {!isIlum && <td style={{padding:'7px 8px',fontSize:10,color: supplierName ? '#ccc' : '#444',borderBottom:'1px solid #1a1a1a'}}>{supplierName || '--'}</td>}
                    {!isIlum && <td style={{padding:'7px 8px',fontSize:10,color:'#555',borderBottom:'1px solid #1a1a1a'}}>{item.type}</td>}
                    {isIlum && <td style={{padding:'7px 8px',fontSize:11,color:'#aaa',borderBottom:'1px solid #1a1a1a'}}>{(catProd && catProd.marca) || item.provider || '--'}</td>}
                    {isIlum && <td style={{padding:'7px 8px',fontSize:11,color:'#aaa',borderBottom:'1px solid #1a1a1a'}}>{(catProd && catProd.modelo) || '--'}</td>}
                    {isIlum && <td style={{padding:'7px 8px',fontSize:11,color:'#888',textAlign:'right',borderBottom:'1px solid #1a1a1a'}}>{(catProd && catProd.watts) ? catProd.watts + 'W' : '--'}</td>}
                    {['quantity','cost','markup'].map(campo => (
                      <td key={campo} style={{padding:'4px 8px',borderBottom:'1px solid #1a1a1a'}}>
                        <input type="number" defaultValue={item[campo as keyof QuotationItem] as number}
                          onBlur={e=>updateItem(item.id,campo,parseFloat(e.target.value)||0)}
                          style={{width:campo==='cost'?70:50,textAlign:'right',background:'transparent',border:'none',color:'#aaa',fontSize:12,fontFamily:'inherit'}}/>
                      </td>
                    ))}
                    <td style={{padding:'7px 8px',fontSize:11,textAlign:'right',color:'#888',borderBottom:'1px solid #1a1a1a'}}>{F(item.price)}</td>
                    <td style={{padding:'7px 8px',fontSize:12,textAlign:'right',fontWeight:600,color:'#fff',borderBottom:'1px solid #1a1a1a'}}>{F(item.total)}</td>
                    <td style={{padding:'7px 8px',borderBottom:'1px solid #1a1a1a'}}>
                      <button onClick={()=>removeItem(item.id)} style={{background:'none',border:'none',color:'#444',cursor:'pointer',fontSize:16}}>x</button>
                    </td>
                  </tr>
                  )
                })}
                <tr>
                  <td colSpan={isIlum ? 10 : 11} style={{padding:'6px 8px'}}>
                    <Btn size="sm" onClick={()=>setShowCat(true)}><Plus size={12}/> Agregar producto</Btn>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{borderTop:'1px solid #222',padding:'10px 14px',display:'flex',gap:24,flexShrink:0,background:'#0e0e0e',fontSize:11}}>
            {(['material','labor'] as const).map(tipo => {
              const its = areaItems.filter(i=>i.type===tipo)
              const venta = its.reduce((s,i)=>s+i.total,0)
              const costo = its.reduce((s,i)=>s+i.quantity*i.cost,0)
              const mg = venta>0?Math.round((venta-costo)/venta*100):0
              return (
                <div key={tipo}>
                  <span style={{color:'#555',fontWeight:600}}>{tipo==='material'?'Equipo':'Labor'}: </span>
                  <span style={{color:mg>=30?'#57FF9A':mg>=15?'#F59E0B':'#EF4444',fontWeight:600}}>{mg}% | {F(venta)}</span>
                </div>
              )
            })}
            <div style={{marginLeft:'auto'}}>
              <span style={{color:'#555'}}>Total cotizacion: </span>
              <span style={{color:'#57FF9A',fontWeight:700,fontSize:14}}>{F(cotTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {showCat && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
          <div style={{background:'#141414',border:'1px solid #333',borderRadius:16,padding:20,width:700,maxHeight:'80vh',overflow:'hidden',display:'flex',flexDirection:'column'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:14}}>
              <div style={{fontSize:15,fontWeight:600,color:'#fff'}}>Catalogo de productos</div>
              <button onClick={()=>setShowCat(false)} style={{background:'none',border:'none',color:'#666',cursor:'pointer'}}><X size={18}/></button>
            </div>
            <div style={{overflowY:'auto',flex:1}}>
              <Table>
                <thead><tr><Th>Producto</Th><Th>Sistema</Th><Th>Tipo</Th><Th>Proveedor</Th><Th right>Precio</Th><Th></Th></tr></thead>
                <tbody>
                  {catalog.length===0&&<tr><td colSpan={6}><EmptyState message="Catalogo vacio - agrega productos en Supabase"/></td></tr>}
                  {catalog.map(p => (
                    <tr key={p.id}>
                      <Td><span style={{fontWeight:500,color:'#ddd'}}>{p.name}</span><br/><span style={{fontSize:10,color:'#555'}}>{p.description}</span></Td>
                      <Td muted>{p.system||'--'}</Td>
                      <Td muted>{p.type}</Td>
                      <Td muted>{p.provider||'--'}</Td>
                      <Td right><span style={{fontWeight:600,color:'#57FF9A'}}>{F(calcItemPrice(p.cost,p.markup))}</span></Td>
                      <Td><Btn size="sm" variant="primary" onClick={()=>addFromCatalog(p)}>+ Agregar</Btn></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Cotizaciones() {
  // Read initial state from URL hash: #cotId:specialty
  const parseHash = () => {
    const h = window.location.hash.slice(1)
    if (!h) return { id: null, spec: null }
    const [id, spec] = h.split(':')
    return { id: id || null, spec: spec || null }
  }
  const initial = parseHash()
  const [openId, setOpenId] = useState<string|null>(initial.id)
  const [openSpecialty, setOpenSpecialty] = useState<string|null>(initial.spec)

  const open = (id: string, specialty?: string) => {
    setOpenId(id); setOpenSpecialty(specialty || null)
    window.location.hash = id + (specialty ? ':' + specialty : '')
  }
  const close = () => {
    setOpenId(null); setOpenSpecialty(null)
    window.location.hash = ''
  }

  if (openId && openSpecialty === 'esp') return <CotEditorESP cotId={openId} onBack={close}/>
  if (openId) return <CotEditor cotId={openId} onBack={close}/>
  return <CotDashboard onOpen={open}/>
}
