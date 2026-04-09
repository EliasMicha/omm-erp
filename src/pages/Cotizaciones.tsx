import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ANTHROPIC_API_KEY } from '../lib/config'
import { Quotation, QuotationArea, QuotationItem, CatalogProduct, Project, ProjectLine, PurchasePhase } from '../types'
import { F, SPECIALTY_CONFIG, STAGE_CONFIG, PHASE_CONFIG, calcItemPrice, calcItemTotal } from '../lib/utils'
import { Badge, Btn, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { Plus, ChevronLeft, X, Zap, Loader2 } from 'lucide-react'
import CotEditorESP from './CotEditorESP'

interface Supplier { id: string; name: string }

function CotDashboard({ onOpen }: { onOpen: (id: string, specialty?: string) => void }) {
  const [cots, setCots] = useState<Quotation[]>([])
  const [filtro, setFiltro] = useState<string>('todas')
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [showAIGen, setShowAIGen] = useState(false)

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
        action={<div style={{display:'flex',gap:8}}>
          <Btn onClick={() => setShowAIGen(true)} style={{border:'1px solid #57FF9A44', color:'#57FF9A', display:'inline-flex', alignItems:'center', gap:4}}><Zap size={14}/> Cotizar con AI</Btn>
          <Btn variant="primary" onClick={() => setShowNew(true)}><Plus size={14}/> Nueva cotizacion</Btn>
        </div>}/>

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
      {showAIGen && <AIGenerateModal onClose={() => setShowAIGen(false)} onCreated={(id, spec) => { setShowAIGen(false); onOpen(id, spec) }}/>}
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
      supabase.from('clientes').select('id,razon_social,rfc').eq('activo', true).order('razon_social'),
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
  const [catalogSearch, setCatalogSearch] = useState('')
  const [showNewProd, setShowNewProd] = useState(false)
  const [newProd, setNewProd] = useState<any>({ name: '', description: '', marca: '', modelo: '', system: '', cost: 0, markup: 35, moneda: 'USD' })
  const [savingNewProd, setSavingNewProd] = useState(false)
  const [aiSearchingNewProd, setAiSearchingNewProd] = useState(false)
  const [aiErrorNewProd, setAiErrorNewProd] = useState<string | null>(null)
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

  async function aiSearchNewProd() {
    const marca = newProd.marca || ''
    const modelo = newProd.modelo || ''
    const name = newProd.name || ''
    if (!marca && !modelo && !name) {
      setAiErrorNewProd('Llena al menos nombre, marca o modelo antes de buscar')
      return
    }
    setAiSearchingNewProd(true)
    setAiErrorNewProd(null)
    const productQuery = [marca, modelo].filter(Boolean).join(' ') || name
    const cotSpecialty = cot?.specialty || 'esp'
    const specialtyHint = cotSpecialty === 'ilum' ? 'iluminacion arquitectonica' : cotSpecialty === 'elec' ? 'producto electrico' : cotSpecialty === 'esp' ? 'instalacion especial audio video CCTV redes control' : 'servicio profesional'
    const prompt = 'Busca en internet las especificaciones tecnicas oficiales del siguiente producto y devuelve SOLO un JSON valido con los campos que encuentres. NO inventes datos.\n\nProducto: ' + productQuery + '\nCategoria: ' + specialtyHint + '\n\nFormato JSON (omite campos que no encuentres):\n{\n  "name": "nombre completo",\n  "description": "descripcion tecnica corta",\n  "marca": "marca",\n  "modelo": "modelo exacto",\n  "watts": numero,\n  "lumens": numero,\n  "cct": numero,\n  "cri": numero,\n  "ip_rating": "IP20",\n  "mounting_type": "empotrado",\n  "system": "Iluminacion/Audio/CCTV/Redes/Control/Electrico",\n  "unit": "pza/m/kg"\n}\n\nDevuelve SOLO el JSON sin markdown ni backticks. Si no encuentras informacion devuelve {}.'
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }], messages: [{ role: 'user', content: prompt }] })
      })
      const data = await res.json()
      if (data.error) { setAiErrorNewProd(data.error.message || 'Error API'); setAiSearchingNewProd(false); return }
      const textBlocks = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      let parsed: any = null
      try {
        const cleaned = textBlocks.replace(/```json|```/g, '').trim()
        const m = cleaned.match(/\{[\s\S]*\}/)
        if (m) parsed = JSON.parse(m[0])
      } catch (e) { setAiErrorNewProd('No se pudo parsear respuesta'); setAiSearchingNewProd(false); return }
      if (!parsed || Object.keys(parsed).length === 0) { setAiErrorNewProd('No se encontro informacion'); setAiSearchingNewProd(false); return }
      const updates: any = {}
      Object.keys(parsed).forEach(k => { if (parsed[k] && !newProd[k]) updates[k] = parsed[k] })
      setNewProd({ ...newProd, ...updates })
      setAiSearchingNewProd(false)
    } catch (err: any) {
      setAiErrorNewProd('Error: ' + (err.message || 'no se pudo conectar'))
      setAiSearchingNewProd(false)
    }
  }

  async function createAndAddNewProduct() {
    if (!newProd.name) return
    if (!areaActiva) return
    setSavingNewProd(true)
    const cotSpecialty = cot?.specialty || 'esp'
    const productPayload: any = {
      name: newProd.name,
      description: newProd.description || null,
      marca: newProd.marca || null,
      modelo: newProd.modelo || null,
      provider: newProd.marca || null,
      system: newProd.system || null,
      cost: Number(newProd.cost) || 0,
      markup: Number(newProd.markup) || 35,
      moneda: newProd.moneda || 'USD',
      purchase_phase: 'inicio',
      is_active: true,
      type: 'material',
      unit: newProd.unit || 'pza',
      specialty: cotSpecialty,
      watts: newProd.watts || null,
      lumens: newProd.lumens || null,
      cct: newProd.cct || null,
      cri: newProd.cri || null,
      ip_rating: newProd.ip_rating || null,
      mounting_type: newProd.mounting_type || null,
    }
    const { data: created, error: errCreate } = await supabase.from('catalog_products').insert(productPayload).select().single()
    if (errCreate || !created) {
      setSavingNewProd(false)
      alert('Error al crear producto: ' + (errCreate?.message || ''))
      return
    }
    setCatalog(prev => [...prev, created as any])
    await addFromCatalog(created as any)
    setShowNewProd(false)
    setNewProd({ name: '', description: '', marca: '', modelo: '', system: '', cost: 0, markup: 35, moneda: 'USD' })
    setAiErrorNewProd(null)
    setSavingNewProd(false)
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
          <div style={{background:'#141414',border:'1px solid #333',borderRadius:16,padding:20,width:780,maxHeight:'85vh',overflow:'hidden',display:'flex',flexDirection:'column'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{fontSize:15,fontWeight:600,color:'#fff'}}>{showNewProd ? 'Nuevo producto' : 'Catalogo (' + (cot?.specialty === 'ilum' ? 'Iluminacion' : cot?.specialty === 'elec' ? 'Electrico' : cot?.specialty === 'proy' ? 'Proyecto' : 'Especiales') + ')'}</div>
              <button onClick={()=>{setShowCat(false); setShowNewProd(false); setCatalogSearch('')}} style={{background:'none',border:'none',color:'#666',cursor:'pointer'}}><X size={18}/></button>
            </div>
            {!showNewProd && <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center'}}>
              <input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} placeholder="Buscar por nombre, marca o modelo..." autoFocus style={{flex:1,padding:'8px 12px',background:'#0e0e0e',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:13,fontFamily:'inherit',outline:'none'}}/>
              <Btn size="sm" variant="primary" onClick={()=>setShowNewProd(true)}><Plus size={12}/> Nuevo producto</Btn>
            </div>}
            {showNewProd && <div style={{overflowY:'auto',flex:1,padding:'4px 4px 12px'}}>
              {aiErrorNewProd && <div style={{background:'#3a1a1a',border:'1px solid #5a2a2a',borderRadius:8,padding:10,color:'#f87171',fontSize:12,marginBottom:12}}>{aiErrorNewProd}</div>}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:10}}>
                <div style={{gridColumn:'1 / span 3'}}>
                  <div style={{fontSize:11,color:'#666',marginBottom:4}}>Nombre *</div>
                  <input value={newProd.name} onChange={e=>setNewProd({...newProd,name:e.target.value})} placeholder="Hikvision DS-7616NXI" style={{width:'100%',padding:'8px 12px',background:'#0e0e0e',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div style={{gridColumn:'1 / span 3'}}>
                  <div style={{fontSize:11,color:'#666',marginBottom:4}}>Descripcion</div>
                  <input value={newProd.description} onChange={e=>setNewProd({...newProd,description:e.target.value})} placeholder="Descripcion tecnica" style={{width:'100%',padding:'8px 12px',background:'#0e0e0e',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:'#666',marginBottom:4}}>Marca</div>
                  <input value={newProd.marca} onChange={e=>setNewProd({...newProd,marca:e.target.value})} placeholder="Lutron" style={{width:'100%',padding:'8px 12px',background:'#0e0e0e',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:'#666',marginBottom:4}}>Modelo</div>
                  <input value={newProd.modelo} onChange={e=>setNewProd({...newProd,modelo:e.target.value})} placeholder="DS-7616NXI" style={{width:'100%',padding:'8px 12px',background:'#0e0e0e',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:'#666',marginBottom:4}}>Sistema</div>
                  <input value={newProd.system} onChange={e=>setNewProd({...newProd,system:e.target.value})} placeholder="CCTV/Audio" style={{width:'100%',padding:'8px 12px',background:'#0e0e0e',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:'#666',marginBottom:4}}>Costo</div>
                  <input type="number" value={newProd.cost} onChange={e=>setNewProd({...newProd,cost:parseFloat(e.target.value)||0})} style={{width:'100%',padding:'8px 12px',background:'#0e0e0e',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:'#666',marginBottom:4}}>Moneda</div>
                  <select value={newProd.moneda} onChange={e=>setNewProd({...newProd,moneda:e.target.value})} style={{width:'100%',padding:'8px 12px',background:'#0e0e0e',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}>
                    <option value="USD">USD</option>
                    <option value="MXN">MXN</option>
                  </select>
                </div>
                <div>
                  <div style={{fontSize:11,color:'#666',marginBottom:4}}>Markup %</div>
                  <input type="number" value={newProd.markup} onChange={e=>setNewProd({...newProd,markup:parseFloat(e.target.value)||0})} style={{width:'100%',padding:'8px 12px',background:'#0e0e0e',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
                </div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:14}}>
                <Btn size="sm" variant="primary" onClick={aiSearchNewProd} disabled={aiSearchingNewProd}>{aiSearchingNewProd ? 'Buscando...' : 'Buscar con IA'}</Btn>
                <div style={{display:'flex',gap:8}}>
                  <Btn size="sm" onClick={()=>{setShowNewProd(false); setAiErrorNewProd(null)}}>Cancelar</Btn>
                  <Btn size="sm" variant="primary" onClick={createAndAddNewProduct} disabled={!newProd.name || savingNewProd}>{savingNewProd ? 'Guardando...' : 'Crear y agregar'}</Btn>
                </div>
              </div>
            </div>}
            {!showNewProd && <div style={{overflowY:'auto',flex:1}}>
              <Table>
                <thead><tr><Th>Producto</Th><Th>Marca/Modelo</Th><Th>Sistema</Th><Th right>Precio</Th><Th></Th></tr></thead>
                <tbody>
                  {(() => {
                    const cotSp = cot?.specialty || 'esp'
                    const q = catalogSearch.toLowerCase().trim()
                    const filtered = catalog.filter((p: any) => {
                      const matchSp = (p.specialty || 'esp') === cotSp
                      if (!matchSp) return false
                      if (!q) return true
                      return (p.name || '').toLowerCase().includes(q) || (p.marca || '').toLowerCase().includes(q) || (p.modelo || '').toLowerCase().includes(q) || (p.provider || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
                    })
                    if (filtered.length === 0) return <tr><td colSpan={5} style={{padding:'20px',textAlign:'center',color:'#666',fontSize:12}}>{q ? 'Sin resultados. Crea uno nuevo o cambia tu busqueda.' : 'Aun no hay productos en este catalogo.'}</td></tr>
                    return filtered.map((p: any) => (
                      <tr key={p.id}>
                        <Td><span style={{fontWeight:500,color:'#ddd'}}>{p.name}</span><br/><span style={{fontSize:10,color:'#555'}}>{p.description}</span></Td>
                        <Td muted><span style={{color:'#aaa',fontSize:11}}>{(p as any).marca || p.provider || '--'}</span><br/><span style={{fontSize:10,color:'#555'}}>{(p as any).modelo || ''}</span></Td>
                        <Td muted>{p.system||'--'}</Td>
                        <Td right><span style={{fontWeight:600,color:'#57FF9A'}}>{(p as any).moneda === 'USD' ? '$' : ''}{F(calcItemPrice(p.cost,p.markup))}</span></Td>
                        <Td><Btn size="sm" variant="primary" onClick={()=>addFromCatalog(p)}>+ Agregar</Btn></Td>
                      </tr>
                    ))
                  })()}
                </tbody>
              </Table>
            </div>}
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
// ═══════════════════════════════════════════════════════════════════
// AI GENERATE MODAL — Cotizar con AI desde scope
// ═══════════════════════════════════════════════════════════════════

interface AIGenArea {
  name: string
  items: AIGenItem[]
}

interface AIGenItem {
  catalog_product_id: string | null
  is_new_suggestion: boolean
  marca: string
  modelo: string
  system: string
  description: string
  quantity: number
  notes: string
  _rowId: string
}

interface AIGenScope {
  mode: 'questionnaire' | 'freetext'
  freetext: string
  tipo: string // residencial | corporativo | hoteleria | retail | industrial
  nombre: string
  cliente: string
  tamano_m2: number | null
  habitaciones: number | null
  ubicacion: string // cdmx | resto_mx | internacional
  nivel: string // basico | medio | alto | premium
  sistemas: string[]
  areas_custom: string
  notas: string
}

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
  { id: 'deteccion_humo', name: 'Detección de Humo', color: '#EF4444', enumValue: null },
  { id: 'bms', name: 'BMS', color: '#10B981', enumValue: null },
  { id: 'telefonia', name: 'Telefonía', color: '#F97316', enumValue: null },
  { id: 'red_celular', name: 'Red Celular', color: '#EC4899', enumValue: null },
]

function aiGenUid(): string { return Math.random().toString(36).slice(2, 10) }

function AIGenerateModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (quotationId: string, specialty: string) => void
}) {
  const [step, setStep] = useState<'mode' | 'questionnaire' | 'freetext' | 'generating' | 'preview'>('mode')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [rationale, setRationale] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [areas, setAreas] = useState<AIGenArea[]>([])
  const [precedentNames, setPrecedentNames] = useState<string[]>([])
  const [inserting, setInserting] = useState(false)
  const [insertProgress, setInsertProgress] = useState('')

  const [scope, setScope] = useState<AIGenScope>({
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

  function toggleSystem(id: string) {
    setScope(s => ({
      ...s,
      sistemas: s.sistemas.includes(id) ? s.sistemas.filter(x => x !== id) : [...s.sistemas, id],
    }))
  }

  async function analyzeScopeText() {
    // Si el usuario usó modo texto libre, primero le pasamos el texto a Claude
    // para que lo convierta a scope estructurado. Usa /api/extract con un prompt ad-hoc.
    if (!scope.freetext.trim()) {
      setError('Pega el scope del proyecto primero')
      return
    }
    setError(null)
    setProgress('Analizando scope con AI...')
    setStep('generating')
    try {
      const prompt = `Lee el siguiente scope de proyecto de instalaciones especiales (audio/redes/CCTV/iluminación/etc) y extrae un JSON estructurado con estos campos exactos:
{
  "tipo": "residencial|corporativo|hoteleria|retail|industrial",
  "nombre": "nombre del proyecto si se menciona",
  "cliente": "nombre del cliente si se menciona",
  "tamano_m2": número o null,
  "habitaciones": número o null (recámaras/oficinas/habitaciones de hotel),
  "ubicacion": "cdmx|resto_mx|internacional",
  "nivel": "basico|medio|alto|premium",
  "sistemas": ["audio","redes","cctv","control_acceso","control_iluminacion","deteccion_humo","bms","telefonia","red_celular"],
  "areas_detectadas": "lista de áreas que se mencionan explícitamente, separadas por comas",
  "notas": "cualquier otra información relevante"
}

SCOPE:
${scope.freetext}

Devuelve SOLO el JSON, sin markdown.`

      const r = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'text', payload: prompt }),
      })
      const data = await r.json()
      if (!r.ok || !data.ok) {
        throw new Error(data.error || 'No se pudo analizar el scope')
      }
      // /api/extract devuelve { items, confidence, warnings } — pero aquí abusamos del endpoint
      // pidiéndole otro shape. El JSON vendrá en items[0] o en la respuesta cruda.
      // En su lugar, llamamos directamente /api/generate-quote con el texto como scope.
      // Para no complicar v1: saltamos este paso y mandamos el texto libre directo a generate-quote.
      // (En una v2 podemos hacer un paso separado.)
      setScope(s => ({ ...s, freetext: scope.freetext }))
      await generateQuote({ ...scope, freetext: scope.freetext })
    } catch (err: any) {
      setError(err.message || 'Error analizando scope')
      setStep('freetext')
    }
  }

  async function generateQuote(scopeData: AIGenScope) {
    setError(null)
    setStep('generating')
    try {
      // 1. Traer catálogo filtrado por sistemas seleccionados
      // Solo filtramos por los sistemas que tienen enumValue (los que existen en el enum product_system)
      // Los sistemas con enumValue=null no tienen productos en catálogo todavía — Claude los sugerirá genéricos
      setProgress('Leyendo catálogo...')
      const enumValues = scopeData.sistemas
        .map(id => AI_ALL_SYSTEMS.find(s => s.id === id)?.enumValue)
        .filter((v): v is string => !!v)
      let catalogQuery = supabase
        .from('catalog_products')
        .select('id, name, description, system, marca, modelo, provider, cost, moneda')
        .eq('is_active', true)
      if (enumValues.length > 0) {
        catalogQuery = catalogQuery.in('system', enumValues)
      }
      const { data: catalog, error: catErr } = await catalogQuery
      if (catErr) throw new Error('Error leyendo catálogo: ' + catErr.message)

      // Nota: los sistemas sin enumValue no tienen productos en catálogo.
      // Los pasamos al scope para que Claude sepa que debe proponerlos como sugerencias genéricas.
      const systemsWithoutCatalog = scopeData.sistemas
        .map(id => AI_ALL_SYSTEMS.find(s => s.id === id))
        .filter((s): s is typeof AI_ALL_SYSTEMS[0] => !!s && !s.enumValue)
        .map(s => s.name)

      // 2. Buscar cotizaciones previas similares
      setProgress('Buscando cotizaciones similares...')
      const { data: prevQuotes } = await supabase
        .from('quotations')
        .select('id, name, total, specialty, stage, notes')
        .eq('specialty', 'esp')
        .neq('total', 0)
        .order('updated_at', { ascending: false })
        .limit(5)

      // Para cada una, cargar sus items y áreas
      const precedents: any[] = []
      for (const q of (prevQuotes || []).slice(0, 3)) {
        const [areasRes, itemsRes] = await Promise.all([
          supabase.from('quotation_areas').select('id,name').eq('quotation_id', q.id),
          supabase.from('quotation_items').select('area_id,name,quantity,system,type').eq('quotation_id', q.id).neq('type', 'labor'),
        ])
        const areaNameById: Record<string, string> = {}
        ;(areasRes.data || []).forEach((a: any) => { areaNameById[a.id] = a.name })
        precedents.push({
          name: q.name,
          specialty: q.specialty,
          total: q.total,
          items: itemsRes.data || [],
          areaNameById,
        })
      }
      setPrecedentNames(precedents.map(p => p.name))

      // 3. Llamar Edge Function
      setProgress('Proponiendo áreas y productos con AI...')
      const enrichedScope = { ...scopeData, systemsWithoutCatalog }
      const r = await fetch('/api/generate-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: enrichedScope, catalog: catalog || [], precedents }),
      })
      const data = await r.json()
      if (!r.ok || !data.ok) {
        throw new Error(data.error || 'Error en /api/generate-quote (' + r.status + ')')
      }

      // 4. Transformar respuesta a AIGenArea[] con rowIds
      const resultAreas: AIGenArea[] = (data.areas || []).map((a: any) => ({
        name: a.name,
        items: (a.items || []).map((it: any) => ({
          catalog_product_id: it.catalog_product_id || null,
          is_new_suggestion: !!it.is_new_suggestion,
          marca: it.marca || '',
          modelo: it.modelo || '',
          system: it.system || 'Audio',
          description: it.description || '',
          quantity: Math.max(1, parseInt(it.quantity) || 1),
          notes: it.notes || '',
          _rowId: aiGenUid(),
        })),
      }))

      setAreas(resultAreas)
      setRationale(data.rationale || '')
      setWarnings(data.warnings || [])
      setStep('preview')
    } catch (err: any) {
      setError(err.message || 'Error generando cotización')
      setStep(scopeData.mode === 'freetext' ? 'freetext' : 'questionnaire')
    }
  }

  function updateItem(areaIdx: number, rowId: string, field: keyof AIGenItem, value: any) {
    setAreas(prev => prev.map((a, i) => i !== areaIdx ? a : {
      ...a,
      items: a.items.map(it => it._rowId === rowId ? { ...it, [field]: value } : it),
    }))
  }

  function removeItem(areaIdx: number, rowId: string) {
    setAreas(prev => prev.map((a, i) => i !== areaIdx ? a : {
      ...a,
      items: a.items.filter(it => it._rowId !== rowId),
    }))
  }

  function removeArea(areaIdx: number) {
    setAreas(prev => prev.filter((_, i) => i !== areaIdx))
  }

  const totalItems = areas.reduce((s, a) => s + a.items.length, 0)
  const fromCatalog = areas.reduce((s, a) => s + a.items.filter(i => !i.is_new_suggestion).length, 0)
  const suggested = totalItems - fromCatalog

  async function handleConfirm() {
    setError(null)
    setInserting(true)
    setInsertProgress('Creando cotización...')
    try {
      // 1. Crear la cotización
      const quotationName = scope.nombre || (scope.tipo.charAt(0).toUpperCase() + scope.tipo.slice(1) + ' AI ' + new Date().toLocaleDateString('es-MX'))
      const notesMeta = {
        systems: scope.sistemas,
        currency: 'USD',
        tipoCambio: 20.5,
        lead_id: null,
        lead_name: '',
        ai_generated: true,
        ai_scope: scope,
        ai_rationale: rationale,
      }
      const { data: quot, error: qErr } = await supabase.from('quotations').insert({
        name: quotationName,
        specialty: 'esp',
        stage: 'oportunidad',
        client_name: scope.cliente || '',
        notes: JSON.stringify(notesMeta),
      }).select().single()
      if (qErr) throw new Error('Error creando cotización: ' + qErr.message)
      if (!quot) throw new Error('Cotización no creada')

      // 2. Crear áreas
      setInsertProgress('Creando áreas...')
      const areaIdByName: Record<string, string> = {}
      for (let i = 0; i < areas.length; i++) {
        const a = areas[i]
        const { data: newArea, error: aErr } = await supabase
          .from('quotation_areas')
          .insert({ quotation_id: quot.id, name: a.name, order_index: i, subtotal: 0 })
          .select()
          .single()
        if (aErr) throw new Error('Error creando área "' + a.name + '": ' + aErr.message)
        if (newArea) areaIdByName[a.name] = newArea.id
      }

      // 3. Procesar items: algunos son del catálogo, otros son sugerencias nuevas
      setInsertProgress('Procesando productos sugeridos...')

      // Cache de productos nuevos creados (para no duplicar si el mismo modelo se repite)
      const createdProducts: Record<string, string> = {} // key: marca|modelo → id
      // Cache de productos del catálogo (para traer costo/provider/moneda reales)
      const catalogCache: Record<string, any> = {}

      let orderIdx = 0
      for (let ai = 0; ai < areas.length; ai++) {
        const a = areas[ai]
        const areaId = areaIdByName[a.name]
        if (!areaId) continue

        for (const it of a.items) {
          let catalogId = it.catalog_product_id
          let productData: any = null

          if (catalogId) {
            // Traer datos del catálogo
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
            // Crear producto sugerido nuevo con tag "AI Suggested"
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
              const productName = '[AI Suggested] ' + (it.description || (it.marca + ' ' + it.modelo).trim() || 'Producto')
              const { data: newProd, error: pErr } = await supabase
                .from('catalog_products')
                .insert({
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
                })
                .select()
                .single()
              if (pErr || !newProd) {
                console.error('Error creando producto sugerido:', pErr, it)
                continue
              }
              catalogId = newProd.id
              createdProducts[cacheKey] = newProd.id
              productData = newProd
              catalogCache[newProd.id] = newProd
            }
          }

          // Insertar quotation_item
          const cost = Number(productData?.cost) || 0
          const markup = Number(productData?.markup) || 33
          const price = cost > 0 ? Math.round(cost / (1 - markup / 100) * 100) / 100 : 0
          const installationCost = Math.round(price * 0.22 * 100) / 100

          const { error: iErr } = await supabase.from('quotation_items').insert({
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
          })
          if (iErr) {
            console.error('Error insertando item:', iErr, it)
          }
        }
      }

      // 4. Navegar al editor
      onCreated(quot.id, 'esp')
      onClose()
    } catch (err: any) {
      setError(err.message || 'Error al crear la cotización')
      setInserting(false)
    }
  }

  const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1030 }
  const modalStyle: React.CSSProperties = { background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: '92vw', maxWidth: 920, maxHeight: '92vh', display: 'flex', flexDirection: 'column' as const }
  const sectionLabel: React.CSSProperties = { fontSize: 10, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 6, display: 'block' as const }
  const inputS: React.CSSProperties = { width: '100%', padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={15} color="#57FF9A" /> Cotizar con AI
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
              {step === 'mode' && 'Elige cómo quieres darle contexto al sistema'}
              {step === 'questionnaire' && 'Cuestionario rápido — 1-2 minutos'}
              {step === 'freetext' && 'Pega el scope del proyecto'}
              {step === 'generating' && 'Generando propuesta...'}
              {step === 'preview' && 'Revisa y edita antes de crear la cotización'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{ padding: '10px 12px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 8, color: '#f87171', fontSize: 12, display: 'flex', gap: 8, marginBottom: 12 }}>
            <span>⚠</span><span>{error}</span>
          </div>
        )}

        {/* STEP: MODE */}
        {step === 'mode' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
            <button
              onClick={() => { setScope(s => ({ ...s, mode: 'questionnaire' })); setStep('questionnaire') }}
              style={{ padding: '24px 18px', background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 12, cursor: 'pointer', textAlign: 'left' as const, color: '#ddd', fontFamily: 'inherit', transition: 'all 0.1s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#57FF9A'; e.currentTarget.style.background = '#0e1a12' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.background = '#0e0e0e' }}
            >
              <div style={{ fontSize: 20, marginBottom: 8 }}>📋</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>Cuestionario guiado</div>
              <div style={{ fontSize: 11, color: '#888', lineHeight: 1.5 }}>Responde 6-8 preguntas rápidas sobre el proyecto. Recomendado si empiezas de cero.</div>
            </button>
            <button
              onClick={() => { setScope(s => ({ ...s, mode: 'freetext' })); setStep('freetext') }}
              style={{ padding: '24px 18px', background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 12, cursor: 'pointer', textAlign: 'left' as const, color: '#ddd', fontFamily: 'inherit', transition: 'all 0.1s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#57FF9A'; e.currentTarget.style.background = '#0e1a12' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.background = '#0e0e0e' }}
            >
              <div style={{ fontSize: 20, marginBottom: 8 }}>📝</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>Pegar scope libre</div>
              <div style={{ fontSize: 11, color: '#888', lineHeight: 1.5 }}>Pega el brief del cliente o arquitecto. La AI extrae lo importante.</div>
            </button>
          </div>
        )}

        {/* STEP: QUESTIONNAIRE */}
        {step === 'questionnaire' && (
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: 8 }}>
            <div style={{ display: 'grid', gap: 16 }}>

              <div>
                <label style={sectionLabel}>Tipo de proyecto *</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                  {PROJECT_TYPES.map(t => (
                    <button key={t.id} onClick={() => setScope(s => ({ ...s, tipo: t.id }))}
                      style={{
                        padding: '10px 8px', background: scope.tipo === t.id ? '#57FF9A15' : '#0e0e0e',
                        border: '1px solid ' + (scope.tipo === t.id ? '#57FF9A' : '#2a2a2a'),
                        borderRadius: 8, cursor: 'pointer', color: scope.tipo === t.id ? '#57FF9A' : '#888',
                        fontFamily: 'inherit', fontSize: 11, textAlign: 'center' as const,
                      }}>
                      <div style={{ fontWeight: 600 }}>{t.label}</div>
                      <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={sectionLabel}>Nombre del proyecto</label>
                  <input value={scope.nombre} onChange={e => setScope(s => ({ ...s, nombre: e.target.value }))}
                    placeholder="Ej. Casa Roma 142" style={inputS} />
                </div>
                <div>
                  <label style={sectionLabel}>Cliente</label>
                  <input value={scope.cliente} onChange={e => setScope(s => ({ ...s, cliente: e.target.value }))}
                    placeholder="Ej. Artek" style={inputS} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={sectionLabel}>Tamaño (m²)</label>
                  <input type="number" value={scope.tamano_m2 ?? ''}
                    onChange={e => setScope(s => ({ ...s, tamano_m2: e.target.value ? parseInt(e.target.value) : null }))}
                    placeholder="Ej. 350" style={inputS} />
                </div>
                <div>
                  <label style={sectionLabel}>
                    {scope.tipo === 'residencial' ? 'Recámaras' : scope.tipo === 'hoteleria' ? 'Habitaciones' : 'Oficinas / Cuartos'}
                  </label>
                  <input type="number" value={scope.habitaciones ?? ''}
                    onChange={e => setScope(s => ({ ...s, habitaciones: e.target.value ? parseInt(e.target.value) : null }))}
                    placeholder="Ej. 4" style={inputS} />
                </div>
                <div>
                  <label style={sectionLabel}>Ubicación</label>
                  <select value={scope.ubicacion} onChange={e => setScope(s => ({ ...s, ubicacion: e.target.value }))} style={inputS}>
                    {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label style={sectionLabel}>Nivel del proyecto *</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {LEVELS.map(l => (
                    <button key={l.id} onClick={() => setScope(s => ({ ...s, nivel: l.id }))}
                      style={{
                        flex: 1, padding: '8px 10px',
                        background: scope.nivel === l.id ? '#57FF9A15' : '#0e0e0e',
                        border: '1px solid ' + (scope.nivel === l.id ? '#57FF9A' : '#2a2a2a'),
                        borderRadius: 8, cursor: 'pointer',
                        color: scope.nivel === l.id ? '#57FF9A' : '#888',
                        fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                      }}>{l.label}</button>
                  ))}
                </div>
              </div>

              <div>
                <label style={sectionLabel}>Sistemas a incluir *</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {AI_ALL_SYSTEMS.map(sys => {
                    const active = scope.sistemas.includes(sys.id)
                    return (
                      <button key={sys.id} onClick={() => toggleSystem(sys.id)}
                        style={{
                          padding: '6px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                          fontFamily: 'inherit',
                          background: active ? sys.color + '20' : '#0e0e0e',
                          border: '1px solid ' + (active ? sys.color : '#2a2a2a'),
                          color: active ? sys.color : '#666',
                        }}>{sys.name}</button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label style={sectionLabel}>Áreas específicas (opcional)</label>
                <textarea value={scope.areas_custom} onChange={e => setScope(s => ({ ...s, areas_custom: e.target.value }))}
                  placeholder="Si ya tienes una lista de cuartos/áreas, pégala aquí. Ej: Sala, Comedor, Cocina, Recámara Principal, Recámara 2, Oficina, Terraza..."
                  rows={3} style={{ ...inputS, resize: 'vertical' as const, fontFamily: 'inherit' }} />
              </div>

              <div>
                <label style={sectionLabel}>Notas y restricciones</label>
                <textarea value={scope.notas} onChange={e => setScope(s => ({ ...s, notas: e.target.value }))}
                  placeholder="Ej: el cliente prefiere Sonos, hay que evitar cableado visible, presupuesto ~$2M MXN..."
                  rows={2} style={{ ...inputS, resize: 'vertical' as const, fontFamily: 'inherit' }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 20, paddingTop: 14, borderTop: '1px solid #222' }}>
              <Btn onClick={() => setStep('mode')}>← Atrás</Btn>
              <Btn variant="primary" onClick={() => generateQuote(scope)} disabled={scope.sistemas.length === 0}>
                Generar con AI →
              </Btn>
            </div>
          </div>
        )}

        {/* STEP: FREE TEXT */}
        {step === 'freetext' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const }}>
            <label style={sectionLabel}>Pega el scope del proyecto</label>
            <textarea value={scope.freetext} onChange={e => setScope(s => ({ ...s, freetext: e.target.value }))}
              placeholder={`Ejemplo:\n\nProyecto: Casa en Bosques de las Lomas, 450m², 4 recámaras, terraza exterior.\nCliente de alto nivel, quiere Sonos multi-zona, Lutron HomeWorks en toda la casa.\nRed con Ubiquiti, 8 cámaras CCTV perímetro, control de acceso en entrada principal.\nPresupuesto abierto, entrega en 4 meses.`}
              rows={16}
              style={{ ...inputS, flex: 1, resize: 'none' as const, fontFamily: 'inherit', lineHeight: 1.6 }} />

            <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
              💡 La AI va a leer este texto y mandar un scope estructurado al generador. Más texto = mejor contexto.
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid #222' }}>
              <Btn onClick={() => setStep('mode')}>← Atrás</Btn>
              <Btn variant="primary" onClick={() => generateQuote({ ...scope, mode: 'freetext' })} disabled={!scope.freetext.trim()}>
                Generar con AI →
              </Btn>
            </div>
          </div>
        )}

        {/* STEP: GENERATING */}
        {step === 'generating' && (
          <div style={{ padding: '60px 20px', textAlign: 'center' as const, flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 size={36} color="#57FF9A" style={{ animation: 'spin 1s linear infinite', marginBottom: 16 }} />
            <div style={{ fontSize: 14, color: '#ccc', fontWeight: 600 }}>{progress || 'Generando...'}</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>Esto puede tomar 15-30 segundos</div>
          </div>
        )}

        {/* STEP: PREVIEW */}
        {step === 'preview' && !inserting && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' }}>
            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
              <div style={{ padding: '10px 12px', background: '#0e0e0e', border: '1px solid #222', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Áreas</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{areas.length}</div>
              </div>
              <div style={{ padding: '10px 12px', background: '#0e0e0e', border: '1px solid #222', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Items totales</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{totalItems}</div>
              </div>
              <div style={{ padding: '10px 12px', background: '#0e1a12', border: '1px solid #57FF9A33', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#57FF9A', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Del catálogo</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#57FF9A' }}>{fromCatalog}</div>
              </div>
              <div style={{ padding: '10px 12px', background: '#1a1610', border: '1px solid #F59E0B33', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: '#F59E0B', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>AI Suggested</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B' }}>{suggested}</div>
              </div>
            </div>

            {/* Rationale */}
            {rationale && (
              <div style={{ padding: '10px 12px', background: '#0e0e0e', border: '1px solid #222', borderRadius: 8, marginBottom: 10, fontSize: 11, color: '#aaa', lineHeight: 1.5 }}>
                <span style={{ color: '#57FF9A', fontWeight: 600 }}>Razonamiento: </span>{rationale}
              </div>
            )}

            {/* Precedents */}
            {precedentNames.length > 0 && (
              <div style={{ fontSize: 10, color: '#666', marginBottom: 10 }}>
                📚 Basado en {precedentNames.length} cotización(es) previa(s): {precedentNames.join(' · ')}
              </div>
            )}

            {/* Warnings */}
            {warnings.length > 0 && (
              <div style={{ padding: '8px 12px', background: '#1a1610', border: '1px solid #3a2e10', borderRadius: 8, marginBottom: 10 }}>
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
                    <button onClick={() => removeArea(ai)} style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: 6, padding: '4px 8px', color: '#666', cursor: 'pointer', fontSize: 10 }}>Eliminar área</button>
                  </div>

                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
                        <th style={{ padding: '4px 6px', textAlign: 'center' as const, color: '#444', fontSize: 9, textTransform: 'uppercase' as const, fontWeight: 600, width: 28 }}></th>
                        <th style={{ padding: '4px 6px', textAlign: 'center' as const, color: '#444', fontSize: 9, textTransform: 'uppercase' as const, fontWeight: 600, width: 50 }}>Cant</th>
                        <th style={{ padding: '4px 6px', textAlign: 'left' as const, color: '#444', fontSize: 9, textTransform: 'uppercase' as const, fontWeight: 600 }}>Producto</th>
                        <th style={{ padding: '4px 6px', textAlign: 'left' as const, color: '#444', fontSize: 9, textTransform: 'uppercase' as const, fontWeight: 600, width: 130 }}>Sistema</th>
                        <th style={{ padding: '4px 6px', width: 28 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {area.items.map(it => (
                        <tr key={it._rowId}>
                          <td style={{ padding: '4px 6px', textAlign: 'center' as const }}>
                            {it.is_new_suggestion
                              ? <span title="Se creará como [AI Suggested]" style={{ color: '#F59E0B', fontSize: 12 }}>⚡</span>
                              : <span title="Del catálogo" style={{ color: '#57FF9A', fontSize: 12 }}>✓</span>}
                          </td>
                          <td style={{ padding: '4px 6px', textAlign: 'center' as const }}>
                            <input type="number" value={it.quantity}
                              onChange={e => updateItem(ai, it._rowId, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                              style={{ width: 42, padding: '3px 5px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, color: '#fff', fontSize: 11, fontFamily: 'inherit', textAlign: 'center' as const }} />
                          </td>
                          <td style={{ padding: '4px 6px' }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: '#ddd' }}>
                              {it.marca} {it.modelo}
                            </div>
                            {it.description && <div style={{ fontSize: 10, color: '#666' }}>{it.description}</div>}
                            {it.notes && <div style={{ fontSize: 10, color: '#555', fontStyle: 'italic' as const, marginTop: 2 }}>· {it.notes}</div>}
                          </td>
                          <td style={{ padding: '4px 6px', fontSize: 10, color: '#888' }}>{it.system}</td>
                          <td style={{ padding: '4px 6px', textAlign: 'center' as const }}>
                            <button onClick={() => removeItem(ai, it._rowId)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', padding: 2 }}><X size={12} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid #222' }}>
              <Btn onClick={() => setStep(scope.mode === 'freetext' ? 'freetext' : 'questionnaire')}>← Modificar scope</Btn>
              <Btn variant="primary" onClick={handleConfirm} disabled={totalItems === 0}>
                Crear cotización con {totalItems} items →
              </Btn>
            </div>
          </div>
        )}

        {/* INSERTING overlay */}
        {inserting && (
          <div style={{ padding: '60px 20px', textAlign: 'center' as const, flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 size={36} color="#57FF9A" style={{ animation: 'spin 1s linear infinite', marginBottom: 16 }} />
            <div style={{ fontSize: 14, color: '#ccc', fontWeight: 600 }}>{insertProgress || 'Creando cotización...'}</div>
          </div>
        )}
      </div>
    </div>
  )
}
