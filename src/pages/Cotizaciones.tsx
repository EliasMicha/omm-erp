import { useEffect, useState, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { ANTHROPIC_API_KEY } from '../lib/config'
import { Quotation, QuotationArea, QuotationItem, CatalogProduct, Project, ProjectLine, PurchasePhase } from '../types'
import { F, FCUR, SPECIALTY_CONFIG, STAGE_CONFIG, PHASE_CONFIG, calcItemPrice, calcItemTotal } from '../lib/utils'
import { Badge, Btn, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { Plus, ChevronLeft, X, Zap, Loader2, Search, Trash2, Upload, RefreshCw, FileText, GitBranch, BarChart3, Pencil } from 'lucide-react'
import EditCotInfoModal from '../components/EditCotInfoModal'
import CotEditorESP from './CotEditorESP'
import ChangeOrdersTab, { ObraRealTab } from './ChangeOrders'
import ImportCotizaciones from './ImportCotizaciones'
import AIQuoteChat from './AIQuoteChat'
import CotEditorCortinas from './CotEditorCortinas'
import CotEditorProyecto from './CotEditorProyecto'
import { autoCreateProjectFromQuotation } from '../lib/projectUtils'

interface Supplier { id: string; name: string }

interface LeadInfo { id: string; name: string; company: string }

// ─── LEAD CELL: clickable inline lead selector ─────────────────────────
function LeadCell({ cotId, currentLeadId, currentLeadName, leads, notes, onUpdate }: {
  cotId: string
  currentLeadId: string
  currentLeadName: string
  leads: LeadInfo[]
  notes: string
  onUpdate: (leadId: string, leadName: string, company: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = search.length >= 1
    ? leads.filter(l => l.name.toLowerCase().includes(search.toLowerCase()) || (l.company || '').toLowerCase().includes(search.toLowerCase()))
    : leads.slice(0, 10)

  async function selectLead(l: LeadInfo) {
    let meta: any = {}
    try { meta = JSON.parse(notes) } catch {}
    meta.lead_id = l.id
    meta.lead_name = l.name
    await supabase.from('quotations').update({
      notes: JSON.stringify(meta),
      client_name: l.company || l.name,
    }).eq('id', cotId)
    onUpdate(l.id, l.name, l.company || l.name)
    setEditing(false)
    setSearch('')
  }

  async function clearLead() {
    let meta: any = {}
    try { meta = JSON.parse(notes) } catch {}
    meta.lead_id = ''
    meta.lead_name = ''
    await supabase.from('quotations').update({ notes: JSON.stringify(meta) }).eq('id', cotId)
    onUpdate('', '', '')
    setEditing(false)
    setSearch('')
  }

  if (!editing) {
    return (
      <span
        onClick={e => { e.stopPropagation(); setEditing(true) }}
        style={{ color: currentLeadName ? '#C084FC' : '#333', cursor: 'pointer' }}
        title="Click para cambiar lead"
      >
        {currentLeadName || '--'}
      </span>
    )
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{ position: 'relative', minWidth: 160 }}>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar lead..."
        autoFocus
        onBlur={() => setTimeout(() => setEditing(false), 200)}
        style={{ width: '100%', padding: '4px 8px', background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, color: '#fff', fontSize: 11, fontFamily: 'inherit', outline: 'none' }}
      />
      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, marginTop: 2, maxHeight: 160, overflowY: 'auto', zIndex: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
        {currentLeadId && (
          <div onMouseDown={clearLead} style={{ padding: '6px 8px', cursor: 'pointer', fontSize: 11, color: '#ef4444', borderBottom: '1px solid #222' }}>
            × Quitar lead
          </div>
        )}
        {filtered.map(l => (
          <div key={l.id} onMouseDown={() => selectLead(l)}
            style={{ padding: '6px 8px', cursor: 'pointer', fontSize: 11, color: l.id === currentLeadId ? '#C084FC' : '#ccc', borderBottom: '1px solid #222' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#222' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            <div style={{ fontWeight: 500 }}>{l.name}</div>
            {l.company && <div style={{ fontSize: 10, color: '#555' }}>{l.company}</div>}
          </div>
        ))}
        {filtered.length === 0 && <div style={{ padding: '8px', fontSize: 11, color: '#555', textAlign: 'center' }}>Sin resultados</div>}
      </div>
    </div>
  )
}

function CotDashboard({ onOpen }: { onOpen: (id: string, specialty?: string) => void }) {
  const [cots, setCots] = useState<Quotation[]>([])
  const [leadsMap, setLeadsMap] = useState<Record<string, LeadInfo>>({})
  const [filtro, setFiltro] = useState<string>('todas')
  const [filtroYear, setFiltroYear] = useState<string>(String(new Date().getFullYear()))
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [showAIGen, setShowAIGen] = useState(false)
  const [showImport, setShowImport] = useState(false)

  const loadCots = async () => {
    setLoading(true)
    const [{ data: cotsData }, { data: leadsData }] = await Promise.all([
      supabase.from('quotations').select('*,project:projects!quotations_project_id_fkey(name,client_name)').order('updated_at', { ascending: false }),
      supabase.from('leads').select('id,name,company'),
    ])
    setCots(cotsData || [])
    const map: Record<string, LeadInfo> = {}
    ;(leadsData || []).forEach((l: any) => { map[l.id] = l })
    setLeadsMap(map)
    setLoading(false)
  }

  useEffect(() => { loadCots() }, [])

  function getCur(c: any): string {
    try { const m = JSON.parse(c.notes || '{}'); return m.currency || 'USD' } catch { return 'USD' }
  }
  function getIvaRate(c: any): number {
    try { const m = JSON.parse(c.notes || '{}'); return m.proyConfig?.ivaRate || 16 } catch { return 16 }
  }
  function getTotalConIva(c: any): number {
    const iva = getIvaRate(c)
    return c.total * (1 + iva / 100)
  }
  function getLeadId(c: any): string {
    try { const m = JSON.parse(c.notes || '{}'); return m.lead_id || '' } catch { return '' }
  }
  function getLeadName(c: any): string {
    const leadId = getLeadId(c)
    if (leadId && leadsMap[leadId]) return leadsMap[leadId].name
    try { const m = JSON.parse(c.notes || '{}'); return m.lead_name || '' } catch { return '' }
  }
  function getArchitect(c: any): string {
    // Arquitecto = company del lead asociado (despacho/firma)
    const leadId = getLeadId(c)
    if (leadId && leadsMap[leadId]) return leadsMap[leadId].company || ''
    return ''
  }

  async function deleteQuotation(id: string, name: string) {
    if (!confirm(`¿Eliminar la cotización "${name || 'Sin nombre'}"?\n\nEsta acción no se puede deshacer.`)) return
    // Cascade: delete items → areas → quotation
    await supabase.from('quotation_items').delete().eq('quotation_id', id)
    await supabase.from('quotation_areas').delete().eq('quotation_id', id)
    await supabase.from('quotations').delete().eq('id', id)
    setCots(prev => prev.filter(q => q.id !== id))
  }

  // Available years from quotations
  const availableYears = useMemo(() => {
    const yrs = new Set<string>()
    cots.forEach(c => { if (c.created_at) yrs.add(c.created_at.slice(0, 4)) })
    return ['todos', ...Array.from(yrs).sort().reverse()]
  }, [cots])

  function getYear(c: any): string { return (c.created_at || '').slice(0, 4) }

  // Base set filtered by year
  const cotsYear = filtroYear === 'todos' ? cots : cots.filter(c => getYear(c) === filtroYear)

  // Filtro por especialidad + búsqueda de texto
  const lista = cotsYear.filter(c => {
    if (filtro !== 'todas' && c.specialty !== filtro) return false
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      const hay =
        (c.name || '').toLowerCase().includes(q) ||
        (c.client_name || '').toLowerCase().includes(q) ||
        getLeadName(c).toLowerCase().includes(q) ||
        getArchitect(c).toLowerCase().includes(q)
      if (!hay) return false
    }
    return true
  })

  // KPIs por etapa (USD y MXN separados) — con IVA — filtered by year
  const byStageAndCur = (s: string, cur: string) => cotsYear.filter(c => c.stage === s && getCur(c) === cur).reduce((a, c) => a + getTotalConIva(c), 0)
  // KPIs por especialidad (USD y MXN separados) — con IVA
  const bySpecAndCur = (spec: string, cur: string) => cotsYear.filter(c => c.specialty === spec && getCur(c) === cur).reduce((a, c) => a + getTotalConIva(c), 0)
  const totalUSD = cotsYear.filter(c => getCur(c) === 'USD').reduce((s, c) => s + getTotalConIva(c), 0)
  const totalMXN = cotsYear.filter(c => getCur(c) === 'MXN').reduce((s, c) => s + getTotalConIva(c), 0)

  return (
    <div style={{padding:'24px 28px'}}>
      <SectionHeader title="Cotizaciones"
        subtitle={`${cotsYear.length} cotizaciones${filtroYear !== 'todos' ? ' ('+filtroYear+')' : ''} · ${FCUR(totalUSD, 'USD')} · ${FCUR(totalMXN, 'MXN')}`}
        action={<div style={{display:'flex',gap:8}}>
          <Btn onClick={() => setShowImport(true)} style={{border:'1px solid #3b82f644', color:'#3b82f6', display:'inline-flex', alignItems:'center', gap:4}}><Upload size={14}/> Importar</Btn>
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

      {/* KPIs por especialidad — USD y MXN separados */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10,marginBottom:20}}>
        {(['esp','elec','ilum','cort','proy'] as const).map(spec => {
          const cfg = SPECIALTY_CONFIG[spec]
          const usd = bySpecAndCur(spec, 'USD')
          const mxn = bySpecAndCur(spec, 'MXN')
          return (
            <div key={spec} style={{background:'#141414',border:'1px solid #222',borderRadius:10,padding:'12px 14px',borderLeft:`2px solid ${cfg.color}`}}>
              <div style={{fontSize:10,color:'#555',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:4,display:'flex',alignItems:'center',gap:4}}>
                <span style={{color:cfg.color}}>{cfg.icon}</span> {cfg.label}
              </div>
              {usd > 0 && <div style={{fontSize:13,fontWeight:700,color:'#fff'}}>USD {F(usd)}</div>}
              {mxn > 0 && <div style={{fontSize:12,fontWeight:600,color:'#ccc'}}>MXN {F(mxn)}</div>}
              {usd === 0 && mxn === 0 && <div style={{fontSize:13,fontWeight:700,color:'#333'}}>$0</div>}
            </div>
          )
        })}
      </div>

      {/* Barra de búsqueda */}
      <div style={{marginBottom:14,position:'relative'}}>
        <Search size={14} style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'#555',pointerEvents:'none'}}/>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por cotización, cliente, arquitecto o lead..."
          style={{
            width:'100%',padding:'10px 12px 10px 36px',background:'#141414',border:'1px solid #222',
            borderRadius:10,color:'#fff',fontSize:13,fontFamily:'inherit',boxSizing:'border-box',
          }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'#666',cursor:'pointer',padding:4}}>
            <X size={14}/>
          </button>
        )}
      </div>

      <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
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
        <span style={{width:1,height:18,background:'#333',margin:'0 4px'}}/>
        {availableYears.map(y => {
          const on = filtroYear === y
          return (
            <button key={y} onClick={() => setFiltroYear(y)} style={{
              padding:'5px 10px',borderRadius:20,fontSize:11,cursor:'pointer',fontFamily:'inherit',
              border:`1px solid ${on?'#A78BFA':'#333'}`,
              background:on?'#A78BFA22':'transparent',
              color:on?'#A78BFA':'#666',fontWeight:on?600:400,
            }}>
              {y === 'todos' ? 'Todos' : y}
            </button>
          )
        })}
      </div>

      {loading ? <Loading/> : (
        <Table>
          <thead><tr>
            <Th>Cotización</Th><Th>Lead</Th><Th>Arquitecto</Th><Th>Cliente</Th><Th>Especialidad</Th><Th>Etapa</Th><Th>Fecha</Th><Th>Moneda</Th><Th right>Total</Th><Th></Th>
          </tr></thead>
          <tbody>
            {lista.length === 0 && (<tr><td colSpan={10}><EmptyState message={search || filtro !== "todas" ? "No se encontraron cotizaciones con estos filtros" : "Sin cotizaciones - crea la primera"}/></td></tr>)}
            {lista.map(c => {
              const esp = SPECIALTY_CONFIG[c.specialty]; const stage = STAGE_CONFIG[c.stage]
              const cur = getCur(c)
              const leadName = getLeadName(c)
              const architect = getArchitect(c)
              return (
                <tr key={c.id} style={{cursor:'pointer'}} onClick={() => onOpen(c.id, c.specialty)}>
                  <Td><span style={{fontWeight:500,color:'#fff'}}>{c.name || '--'}</span></Td>
                  <Td>
                    <LeadCell
                      cotId={c.id}
                      currentLeadId={getLeadId(c)}
                      currentLeadName={leadName}
                      leads={Object.values(leadsMap)}
                      notes={c.notes || '{}'}
                      onUpdate={(leadId, leadName, company) => {
                        setCots(prev => prev.map(q => {
                          if (q.id !== c.id) return q
                          let meta: any = {}; try { meta = JSON.parse(q.notes || '{}') } catch {}
                          meta.lead_id = leadId; meta.lead_name = leadName
                          return { ...q, client_name: company || q.client_name, notes: JSON.stringify(meta) }
                        }))
                      }}
                    />
                  </Td>
                  <Td><span style={{color: architect ? '#F9A8D4' : '#333', fontSize: 12}}>{architect || '--'}</span></Td>
                  <Td muted>{c.client_name || '--'}</Td>
                  <Td><Badge label={esp.icon+' '+esp.label} color={esp.color}/></Td>
                  <Td>
                    <select
                      value={c.stage}
                      onClick={e => e.stopPropagation()}
                      onChange={async e => {
                        const newStage = e.target.value
                        await supabase.from('quotations').update({ stage: newStage }).eq('id', c.id)
                        setCots(prev => prev.map(q => q.id === c.id ? { ...q, stage: newStage as any } : q))
                        // Auto-create project when proy quotation moves to contrato
                        if (newStage === 'contrato' && c.specialty === 'proy') {
                          const projId = await autoCreateProjectFromQuotation(c.id)
                          if (projId) alert('✅ Proyecto creado automáticamente en la sección de Proyectos.')
                        }
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
                  <Td><span style={{fontSize:11,color:'#888'}}>{c.created_at ? new Date(c.created_at).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '--'}</span></Td>
                  <Td><span style={{fontSize:11,fontWeight:600,color: cur === 'USD' ? '#06B6D4' : '#F59E0B'}}>{cur}</span></Td>
                  <Td right><span style={{fontWeight:600,color:'#57FF9A'}}>{FCUR(getTotalConIva(c), cur)}</span></Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Btn size="sm" onClick={e => { e?.stopPropagation(); onOpen(c.id, c.specialty) }}>Abrir</Btn>
                      {c.stage === 'oportunidad' && (
                        <button
                          onClick={e => { e.stopPropagation(); deleteQuotation(c.id, c.name) }}
                          title="Eliminar cotización (solo en etapa Oportunidad)"
                          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#555')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {showNew && <NuevaCoModal onClose={() => setShowNew(false)} onCreated={(id, spec) => { setShowNew(false); onOpen(id, spec) }}/>}
      {showAIGen && <AIQuoteChat onClose={() => setShowAIGen(false)} onCreated={(id, spec) => { setShowAIGen(false); onOpen(id, spec) }}/>}
      {showImport && <ImportCotizaciones onClose={() => { setShowImport(false); loadCots() }} onImported={(id, spec) => { setShowImport(false); loadCots(); onOpen(id, spec) }}/>}
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
  { id: 'deteccion_humo', name: 'Detección de Incendio', color: '#EF4444' },
  { id: 'bms', name: 'BMS', color: '#10B981' },
  { id: 'telefonia', name: 'Telefonía', color: '#F97316' },
  { id: 'red_celular', name: 'Señal Celular', color: '#EC4899' },
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
    m2Construccion: 0,
    tipoProyecto: 'especiales' as 'especiales' | 'electrica' | 'iluminacion',
  })
  const [saving, setSaving] = useState(false)
  const [customArea, setCustomArea] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDrop, setShowClientDrop] = useState(false)
  const [leadSearch, setLeadSearch] = useState('')
  const [showLeadDrop, setShowLeadDrop] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('*').eq('status', 'activo'),
      supabase.from('clientes').select('id,razon_social,rfc').eq('activo', true).order('razon_social'),
      supabase.from('leads').select('id,name,company,contact_name').order('name'),
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

  const filteredLeads = leadSearch.length >= 1
    ? leads.filter(l => l.name.toLowerCase().includes(leadSearch.toLowerCase()) || (l.company || '').toLowerCase().includes(leadSearch.toLowerCase()))
    : leads.slice(0, 10)

  async function crear() {
    if (!form.name) return
    setSaving(true)
    // For proy specialty, always use 'proy' in DB (ilum is now a tipoProyecto)
    const dbSpecialty = form.specialty
    const isProy = dbSpecialty === 'proy'
    const notesObj: any = {
      systems: isEsp ? form.systems : [],
      currency: form.currency,
      lead_id: form.lead_id || null,
      lead_name: form.lead_id ? (leads.find(l => l.id === form.lead_id)?.name || '') : '',
      ...(isProy ? { m2Construccion: form.m2Construccion, tipoProyecto: form.tipoProyecto } : {}),
    }
    const { data } = await supabase.from('quotations').insert({
      project_id: form.project_id || null, name: form.name,
      specialty: dbSpecialty, client_name: form.client_name, stage: 'oportunidad',
      notes: JSON.stringify(notesObj),
    }).select().single()
    if (data) {
      // Create areas — solo aplica para Especiales (ESP). Proyecto/otros usan General invisible
      const useFormAreas = form.specialty === 'esp'
      const areaInserts = useFormAreas ? form.areas.map((name, i) => ({ quotation_id: data.id, name, order_index: i })) : []
      if (areaInserts.length > 0) {
        await supabase.from('quotation_areas').insert(areaInserts)
      } else {
        await supabase.from('quotation_areas').insert({ quotation_id: data.id, name: 'General', order_index: 0 })
      }
      onCreated(data.id, dbSpecialty)
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
                <button key={k} onClick={() => setForm(f => ({ ...f, specialty: k, ...(k === 'proy' || k === 'cort' ? { currency: 'MXN' as const } : {}) }))}
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

          {/* Tipo de Proyecto (sub-selector cuando es Proyecto) */}
          {form.specialty === 'proy' && (
            <label style={labelStyle}>
              Tipo de Proyecto
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {([
                  { id: 'especiales' as const, label: 'Ingenierías Especiales', icon: '⚡', color: '#F9A8D4' },
                  { id: 'electrica' as const, label: 'Ingeniería Eléctrica', icon: '🔌', color: '#F59E0B' },
                  { id: 'iluminacion' as const, label: 'Diseño de Iluminación', icon: '💡', color: '#C084FC' },
                ]).map(t => (
                  <button key={t.id} onClick={() => setForm(f => ({ ...f, tipoProyecto: t.id }))}
                    style={{
                      padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                      border: '1px solid ' + (form.tipoProyecto === t.id ? t.color : '#333'),
                      background: form.tipoProyecto === t.id ? t.color + '22' : 'transparent',
                      color: form.tipoProyecto === t.id ? t.color : '#666',
                    }}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </label>
          )}

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
          <label style={labelStyle}>
            Lead (opcional)
            <div style={{ position: 'relative' }}>
              <input
                value={leadSearch || (form.lead_id ? (leads.find(l => l.id === form.lead_id)?.name || '') : '')}
                onChange={e => {
                  setLeadSearch(e.target.value)
                  if (!e.target.value) setForm(f => ({ ...f, lead_id: '' }))
                  setShowLeadDrop(true)
                }}
                onFocus={() => setShowLeadDrop(true)}
                placeholder="Buscar lead por nombre o empresa..."
                style={inputStyle}
              />
              {form.lead_id && (
                <button onClick={() => { setForm(f => ({ ...f, lead_id: '' })); setLeadSearch('') }}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14 }}>×</button>
              )}
              {showLeadDrop && filteredLeads.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, marginTop: 2, maxHeight: 180, overflowY: 'auto', zIndex: 10 }}>
                  {filteredLeads.map(l => (
                    <div key={l.id} onClick={() => { selectLead(l); setLeadSearch(l.name); setShowLeadDrop(false) }}
                      style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 12, color: '#ccc', borderBottom: '1px solid #222' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#222' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      <div style={{ fontWeight: 500 }}>{l.name}</div>
                      {l.company && <div style={{ fontSize: 10, color: '#555' }}>{l.company}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </label>

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

          {/* === PROY-SPECIFIC: m² de construcción === */}
          {form.specialty === 'proy' && (
            <label style={labelStyle}>
              m² de construcción
              <div style={{ fontSize: 10, color: '#444', marginTop: 2, marginBottom: 6, fontStyle: 'italic', textTransform: 'none' as const }}>
                Se aplicará como m² global a todos los sistemas. Podrás editar cada uno después.
              </div>
              <input type="number" value={form.m2Construccion || ''} onChange={e => setForm(f => ({ ...f, m2Construccion: parseFloat(e.target.value) || 0 }))}
                placeholder="ej. 4300" min={0} step={100}
                style={{ ...inputStyle, width: 200 }} />
            </label>
          )}

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
  const [aiImporting, setAiImporting] = useState(false)
  const [aiImportResult, setAiImportResult] = useState<Array<{catalog_id: string|null, name: string, quantity: number, cost?: number, provider?: string}> | null>(null)
  const aiImportRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<'cotizacion' | 'cambios' | 'obra_real'>('cotizacion')
  const [changeOrders, setChangeOrders] = useState<any[]>([])
  const [showEditInfo, setShowEditInfo] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data: c },{ data: as_ },{ data: it },{ data: cat },{ data: sups }] = await Promise.all([
        supabase.from('quotations').select('*,project:projects!quotations_project_id_fkey(name,client_name)').eq('id',cotId).single(),
        supabase.from('quotation_areas').select('*').eq('quotation_id',cotId).order('order_index'),
        supabase.from('quotation_items').select('*').eq('quotation_id',cotId),
        supabase.from('catalog_products').select('*').eq('is_active',true).order('name'),
        supabase.from('suppliers').select('id,name').eq('is_active',true).order('name'),
      ])
      setCot(c); setAreas(as_||[]); setItems(it||[]); setCatalog(cat||[]); setSuppliers(sups||[])
      if (as_ && as_.length > 0) setAreaActiva(as_[0].id)
      // Load change orders for Obra Real tab
      const { data: coData } = await supabase
        .from('change_orders')
        .select('*, items:change_order_items(*)')
        .eq('quotation_id', cotId)
        .order('numero')
      setChangeOrders(coData || [])
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
      marca: (prod as any).marca || null,
      modelo: (prod as any).modelo || null,
      sku: (prod as any).sku || null,
      image_url: (prod as any).image_url || null,
    }
    const { data } = await supabase.from('quotation_items').insert(item).select().single()
    if (data) {
      const newItems = [...items, data]
      setItems(newItems)
      syncQuotationTotal(newItems)
    }
    setShowCat(false)
  }

  // Sync quotation total to DB whenever items change
  async function syncQuotationTotal(updatedItems: QuotationItem[]) {
    const newTotal = updatedItems.reduce((s, i) => s + i.total, 0)
    await supabase.from('quotations').update({ total: newTotal }).eq('id', cotId)
    setCot(c => c ? { ...c, total: newTotal } : c)
  }

  async function updateItem(id: string, campo: string, val: number) {
    const item = items.find(i => i.id === id)
    if (!item) return
    const updated = {...item, [campo]: val}
    updated.price = calcItemPrice(updated.cost, updated.markup)
    updated.total = calcItemTotal(updated.cost, updated.markup, updated.quantity)
    await supabase.from('quotation_items').update({ [campo]: val, price: updated.price, total: updated.total }).eq('id', id)
    const newItems = items.map(i => i.id === id ? updated : i)
    setItems(newItems)
    syncQuotationTotal(newItems)
  }

  // ─── SYNC PRICES FROM CATALOG ─────────────────────────────────────────
  const [syncing, setSyncing] = useState(false)
  async function syncPricesFromCatalog() {
    if (!confirm('¿Actualizar costos y precios de todos los productos desde el catálogo?')) return
    setSyncing(true)
    let updated = 0
    for (const item of items) {
      if (!item.catalog_product_id) continue
      const prod = catalog.find(p => p.id === item.catalog_product_id)
      if (!prod) continue
      // Check if anything changed
      if (item.cost === prod.cost && item.markup === prod.markup) continue
      const price = calcItemPrice(prod.cost, prod.markup)
      const total = calcItemTotal(prod.cost, prod.markup, item.quantity)
      await supabase.from('quotation_items').update({
        cost: prod.cost, markup: prod.markup, price, total,
        provider: prod.provider || item.provider,
        supplier_id: prod.supplier_id || item.supplier_id,
        purchase_phase: prod.purchase_phase || item.purchase_phase,
      }).eq('id', item.id)
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, cost: prod.cost, markup: prod.markup, price, total, provider: prod.provider || i.provider, supplier_id: prod.supplier_id || i.supplier_id, purchase_phase: prod.purchase_phase || i.purchase_phase } : i))
      updated++
    }
    // Sync quotation total after price changes
    if (updated > 0) {
      const freshTotal = items.reduce((s, i) => s + i.total, 0)
      await supabase.from('quotations').update({ total: freshTotal }).eq('id', cotId)
      setCot(c => c ? { ...c, total: freshTotal } : c)
    }
    setSyncing(false)
    alert(updated > 0 ? `Se actualizaron ${updated} producto${updated > 1 ? 's' : ''} con precios del catálogo.` : 'Todos los precios ya están al día.')
  }

  // ─── AI IMPORT HELPERS ────────────────────────────────────────────────
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(',')[1] || '')
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function handleAIImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !areaActiva) return
    e.target.value = ''
    setAiImporting(true)

    try {
      const specialty = cot?.specialty || 'esp'
      const relevantCatalog = catalog.filter(p => (p.specialty || 'esp') === specialty)
      // Use short numeric index instead of UUID to save tokens
      const catalogList = relevantCatalog
        .map((p, i) => `${i}: ${p.name}`)
        .join('\n')

      const ext = file.name.split('.').pop()?.toLowerCase()
      let content: any[] = []

      if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext || '')) {
        const b64 = await fileToBase64(file)
        const aiPrompt = `Analiza este documento de cuantificación. Extrae todos los conceptos/partidas con sus cantidades, costos unitarios y proveedor/marca.

Para cada concepto, busca el producto más similar en este catálogo y devuelve su índice:

CATÁLOGO:
${catalogList}

IMPORTANTE:
- Haz match por nombre/descripción similar, no tiene que ser exacto
- Si un concepto no tiene match en el catálogo, usa idx: -1
- Extrae la CANTIDAD de cada partida
- Extrae el COSTO UNITARIO (precio unitario, P.U., costo) si aparece en el documento
- Extrae el PROVEEDOR o MARCA si aparece (ej: Lutron, Honeywell, Leviton, Hubbell, etc.)
- Ignora subtotales, IVA, totales
- Si no encuentras costo o proveedor, usa null

Devuelve SOLO un JSON array sin markdown ni explicacion:
[{"idx":0,"name":"nombre corto","qty":434,"cost":150.50,"provider":"Lutron"},{"idx":-1,"name":"otro","qty":13,"cost":null,"provider":null}]`

        content = [
          { type: 'image', source: { type: 'base64', media_type: file.type, data: b64 } },
          { type: 'text', text: aiPrompt }
        ]
      } else if (['pdf'].includes(ext || '')) {
        const b64 = await fileToBase64(file)
        const aiPrompt = `Analiza este documento de cuantificación. Extrae todos los conceptos/partidas con sus cantidades, costos unitarios y proveedor/marca.

Para cada concepto, busca el producto más similar en este catálogo y devuelve su índice:

CATÁLOGO:
${catalogList}

IMPORTANTE:
- Haz match por nombre/descripción similar, no tiene que ser exacto
- Si un concepto no tiene match en el catálogo, usa idx: -1
- Extrae la CANTIDAD de cada partida
- Extrae el COSTO UNITARIO (precio unitario, P.U., costo) si aparece en el documento
- Extrae el PROVEEDOR o MARCA si aparece (ej: Lutron, Honeywell, Leviton, Hubbell, etc.)
- Ignora subtotales, IVA, totales
- Si no encuentras costo o proveedor, usa null

Devuelve SOLO un JSON array sin markdown ni explicacion:
[{"idx":0,"name":"nombre corto","qty":434,"cost":150.50,"provider":"Lutron"},{"idx":-1,"name":"otro","qty":13,"cost":null,"provider":null}]`

        content = [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
          { type: 'text', text: aiPrompt }
        ]
      } else {
        const text = await file.text()
        const aiPrompt = `Analiza este documento de cuantificación. Extrae todos los conceptos/partidas con sus cantidades, costos unitarios y proveedor/marca.

Para cada concepto, busca el producto más similar en este catálogo y devuelve su índice:

CATÁLOGO:
${catalogList}

IMPORTANTE:
- Haz match por nombre/descripción similar, no tiene que ser exacto
- Si un concepto no tiene match en el catálogo, usa idx: -1
- Extrae la CANTIDAD de cada partida
- Extrae el COSTO UNITARIO (precio unitario, P.U., costo) si aparece en el documento
- Extrae el PROVEEDOR o MARCA si aparece (ej: Lutron, Honeywell, Leviton, Hubbell, etc.)
- Ignora subtotales, IVA, totales
- Si no encuentras costo o proveedor, usa null

Archivo (${file.name}):
${text}

Devuelve SOLO un JSON array sin markdown ni explicacion:
[{"idx":0,"name":"nombre corto","qty":434,"cost":150.50,"provider":"Lutron"},{"idx":-1,"name":"otro","qty":13,"cost":null,"provider":null}]`

        content = [{ type: 'text', text: aiPrompt }]
      }

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2025-01-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8000,
          messages: [{ role: 'user', content }]
        })
      })

      const data = await res.json()
      console.log('[AI Import] stop_reason:', data.stop_reason, 'content blocks:', data.content?.length)
      if (data.error) {
        setAiImporting(false)
        alert('Error API: ' + (data.error.message || JSON.stringify(data.error)))
        return
      }

      const textBlocks = (data.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')

      console.log('[AI Import] raw response length:', textBlocks.length, 'first 500 chars:', textBlocks.substring(0, 500))

      let parsed: any[] = []
      try {
        let cleaned = textBlocks.replace(/```json|```/g, '').trim()
        // Find the JSON array
        const start = cleaned.indexOf('[')
        if (start === -1) throw new Error('No JSON array found in response: ' + cleaned.substring(0, 200))
        let jsonStr = cleaned.slice(start)
        // If truncated (no closing bracket), try to fix it
        if (!jsonStr.trimEnd().endsWith(']')) {
          console.log('[AI Import] JSON truncated, attempting fix...')
          // Find last complete object (ending with })
          const lastBrace = jsonStr.lastIndexOf('}')
          if (lastBrace > 0) {
            jsonStr = jsonStr.slice(0, lastBrace + 1) + ']'
          }
        }
        parsed = JSON.parse(jsonStr)
      } catch (e) {
        console.error('[AI Import] parse error:', e, 'textBlocks:', textBlocks.substring(0, 1000))
        setAiImporting(false)
        alert('No se pudo parsear respuesta: ' + (e instanceof Error ? e.message : 'Error desconocido'))
        return
      }

      if (!Array.isArray(parsed) || parsed.length === 0) {
        setAiImporting(false)
        alert('No se encontraron items en el documento')
        return
      }

      // Map idx back to catalog_id, keep cost and provider
      const mapped = parsed.map((r: any) => ({
        catalog_id: r.idx >= 0 && r.idx < relevantCatalog.length ? relevantCatalog[r.idx].id : null,
        name: r.name || 'Desconocido',
        quantity: r.qty || r.quantity || 1,
        cost: r.cost && r.cost > 0 ? r.cost : undefined,
        provider: r.provider || r.marca || undefined,
      }))

      setAiImportResult(mapped)
      setAiImporting(false)
    } catch (err: any) {
      setAiImporting(false)
      alert('Error: ' + (err.message || 'No se pudo conectar'))
    }
  }

  async function confirmAIImport() {
    if (!aiImportResult || !areaActiva) return
    let insertedCount = 0

    for (const r of aiImportResult) {
      const prod = r.catalog_id ? catalog.find(p => p.id === r.catalog_id) : null

      // Use catalog data when matched, AI-extracted data as fallback
      const itemCost = prod?.cost || r.cost || 0
      const itemMarkup = prod?.markup || 30
      const itemProvider = prod?.provider || r.provider || ''

      const item = {
        area_id: areaActiva,
        quotation_id: cotId,
        catalog_product_id: prod?.id || null,
        name: prod?.name || r.name,
        description: prod?.description || '',
        system: prod?.system || null,
        type: prod?.type || 'material',
        provider: itemProvider,
        quantity: r.quantity,
        cost: itemCost,
        markup: prod ? prod.markup : itemMarkup,
        supplier_id: prod?.supplier_id || null,
        purchase_phase: prod?.purchase_phase || 'inicio',
        price: calcItemPrice(itemCost, prod ? prod.markup : itemMarkup),
        total: calcItemTotal(itemCost, prod ? prod.markup : itemMarkup, r.quantity),
        installation_cost: 0,
        order_index: items.filter(i => i.area_id === areaActiva).length + insertedCount,
        marca: (prod as any)?.marca || r.provider || null,
        modelo: (prod as any)?.modelo || null,
        sku: (prod as any)?.sku || null,
        image_url: (prod as any)?.image_url || null,
      }

      const { data } = await supabase.from('quotation_items').insert(item).select().single()
      if (data) {
        setItems(prev => [...prev, data])
        insertedCount++
      }
    }

    // Sync total after bulk import
    if (insertedCount > 0) {
      const allItems = await supabase.from('quotation_items').select('total').eq('quotation_id', cotId)
      const newTotal = (allItems.data || []).reduce((s: number, i: any) => s + (i.total || 0), 0)
      await supabase.from('quotations').update({ total: newTotal }).eq('id', cotId)
      setCot(c => c ? { ...c, total: newTotal } : c)
    }
    setAiImportResult(null)
  }

  async function removeItem(id: string) {
    await supabase.from('quotation_items').delete().eq('id', id)
    const newItems = items.filter(i => i.id !== id)
    setItems(newItems)
    syncQuotationTotal(newItems)
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
        <button onClick={() => setShowEditInfo(true)} style={{background:'none',border:'none',color:'#555',cursor:'pointer',padding:2,display:'flex',alignItems:'center'}} title="Editar info"><Pencil size={12}/></button>

        {/* Tabs */}
        <div style={{display:'flex',gap:2,marginLeft:16,background:'#0a0a0a',borderRadius:8,padding:2}}>
          {([
            { key: 'cotizacion', label: 'Cotizacion', icon: <FileText size={12}/> },
            { key: 'cambios', label: 'Cambios', icon: <GitBranch size={12}/> },
            { key: 'obra_real', label: 'Obra Real', icon: <BarChart3 size={12}/> },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{
                display:'flex',alignItems:'center',gap:4,padding:'4px 12px',borderRadius:6,fontSize:11,fontWeight:600,
                cursor:'pointer',fontFamily:'inherit',border:'none',
                background: activeTab === tab.key ? '#222' : 'transparent',
                color: activeTab === tab.key ? '#fff' : '#555',
              }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <div style={{marginLeft:'auto',display:'flex',gap:4,alignItems:'center'}}>
          {(Object.entries(STAGE_CONFIG) as any[]).map(([s,cfg]) => (
            <button key={s} onClick={()=>setStage(s)} style={{
              padding:'3px 10px',borderRadius:20,fontSize:10,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              border:`1px solid ${cot.stage===s?cfg.color:'#333'}`,
              background:cot.stage===s?cfg.color+'22':'transparent',
              color:cot.stage===s?cfg.color:'#555',
            }}>{cfg.label}</button>
          ))}
          {activeTab === 'cotizacion' && <>
            <Btn size="sm" variant="primary" onClick={()=>setShowCat(true)} style={{marginLeft:8}}>
              <Plus size={12}/> Producto
            </Btn>
            <input type="file" ref={aiImportRef} accept=".csv,.txt,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.gif" style={{display:'none'}} onChange={handleAIImport} />
            <Btn size="sm" onClick={() => aiImportRef.current?.click()} disabled={aiImporting} style={{marginLeft:4}}>
              {aiImporting ? <><Loader2 size={12} style={{animation:'spin 1s linear infinite'}}/> Importando...</> : <><Upload size={12}/> Importar con IA</>}
            </Btn>
            <Btn size="sm" onClick={syncPricesFromCatalog} disabled={syncing} style={{marginLeft:4}}>
              {syncing ? <><Loader2 size={12} style={{animation:'spin 1s linear infinite'}}/> Actualizando...</> : <><RefreshCw size={12}/> Sync Catálogo</>}
            </Btn>
            {cot.stage === 'contrato' && (
              <Btn size="sm" onClick={generatePurchaseOrders} disabled={generating} style={{marginLeft:4}}>
                <Zap size={12}/> {generating ? 'Generando...' : 'Regenerar OC'}
              </Btn>
            )}
          </>}
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

      {/* Tab: Cambios */}
      {activeTab === 'cambios' && (
        <div style={{flex:1,overflow:'hidden'}}>
          <ChangeOrdersTab cotId={cotId} items={items} areas={areas} catalog={catalog} specialty={cot.specialty} />
        </div>
      )}

      {/* Tab: Obra Real */}
      {activeTab === 'obra_real' && (
        <div style={{flex:1,overflow:'hidden'}}>
          <ObraRealTab items={items} orders={changeOrders} areas={areas} />
        </div>
      )}

      {/* Tab: Cotizacion (original content) */}
      {activeTab === 'cotizacion' && <div style={{display:'grid',gridTemplateColumns: isIlum ? '1fr' : '175px 1fr',flex:1,overflow:'hidden'}}>
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
      </div>}

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

      {aiImportResult && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
          <div style={{background:'#141414',border:'1px solid #333',borderRadius:16,padding:20,width:800,maxHeight:'85vh',overflow:'hidden',display:'flex',flexDirection:'column'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{fontSize:15,fontWeight:600,color:'#fff'}}>Vista previa de importacion ({aiImportResult.length} items)</div>
              <button onClick={()=>setAiImportResult(null)} style={{background:'none',border:'none',color:'#666',cursor:'pointer'}}><X size={18}/></button>
            </div>
            <div style={{overflowY:'auto',flex:1,marginBottom:14}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{background:'#1a1a1a'}}>
                    <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#666',textAlign:'left',textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:'1px solid #222'}}>Producto</th>
                    <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#666',textAlign:'left',textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:'1px solid #222'}}>Proveedor</th>
                    <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#666',textAlign:'right',textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:'1px solid #222'}}>Cant.</th>
                    <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#666',textAlign:'right',textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:'1px solid #222'}}>Costo</th>
                    <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#666',textAlign:'right',textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:'1px solid #222'}}>P. Venta</th>
                    <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#666',textAlign:'center',textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:'1px solid #222'}}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {aiImportResult.map((r, i) => {
                    const prod = r.catalog_id ? catalog.find(p => p.id === r.catalog_id) : null
                    const isMatched = !!prod
                    const itemCost = prod?.cost || r.cost || 0
                    const itemMarkup = prod?.markup || 30
                    const unitPrice = calcItemPrice(itemCost, itemMarkup)
                    const providerDisplay = prod?.provider || r.provider || ''
                    return (
                      <tr key={i} style={{borderBottom:'1px solid #222'}}>
                        <td style={{padding:'8px 10px',fontSize:12,color:'#ddd'}}>
                          <div style={{fontWeight:500}}>{r.name}</div>
                          {isMatched && prod.name !== r.name && <div style={{fontSize:10,color:'#666'}}>→ {prod.name}</div>}
                        </td>
                        <td style={{padding:'8px 10px',fontSize:11,color: providerDisplay ? '#3B82F6' : '#555'}}>
                          {providerDisplay || '—'}
                          {r.provider && prod?.provider && r.provider !== prod.provider && <div style={{fontSize:9,color:'#666'}}>doc: {r.provider}</div>}
                        </td>
                        <td style={{padding:'8px 10px',fontSize:12,color:'#ddd',textAlign:'right'}}>{r.quantity}</td>
                        <td style={{padding:'8px 10px',fontSize:12,textAlign:'right',color: itemCost > 0 ? '#F59E0B' : '#555'}}>
                          {itemCost > 0 ? F(itemCost) : '—'}
                          {r.cost && prod?.cost && r.cost !== prod.cost && <div style={{fontSize:9,color:'#666'}}>doc: {F(r.cost)}</div>}
                        </td>
                        <td style={{padding:'8px 10px',fontSize:12,color:'#ddd',textAlign:'right'}}>{itemCost > 0 ? F(unitPrice) : '—'}</td>
                        <td style={{padding:'8px 10px',fontSize:12,textAlign:'center'}}>
                          <div style={{display:'inline-block',padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:600,
                            background: isMatched ? '#22c55e22' : (r.cost ? '#3b82f622' : '#f59e0b22'),
                            color: isMatched ? '#22c55e' : (r.cost ? '#3b82f6' : '#f59e0b')}}>
                            {isMatched ? 'Catálogo' : (r.cost ? 'Nuevo + costo' : 'Sin match')}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
              <Btn size="sm" onClick={()=>setAiImportResult(null)}>Cancelar</Btn>
              <Btn size="sm" variant="primary" onClick={confirmAIImport} style={{display:'flex',alignItems:'center',gap:4}}>
                <Plus size={12}/> Importar {aiImportResult.length} productos
              </Btn>
            </div>
          </div>
        </div>
      )}

      {showEditInfo && cot && (
        <EditCotInfoModal
          cotId={cotId}
          name={cot.name}
          clientName={cot.client_name || ''}
          projectId={cot.project_id || null}
          onClose={() => setShowEditInfo(false)}
          onSaved={(name, client, projId, projName) => {
            setCot(c => c ? { ...c, name, client_name: client, project_id: projId || '' } : c)
            setShowEditInfo(false)
          }}
        />
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
  if (openId && openSpecialty === 'cort') return <CotEditorCortinas cotId={openId} onBack={close}/>
  if (openId && openSpecialty === 'proy') return <CotEditorProyecto cotId={openId} onBack={close} specialty="proy"/>
  if (openId && openSpecialty === 'ilum') return <CotEditor cotId={openId} onBack={close}/>
  if (openId) return <CotEditor cotId={openId} onBack={close}/>
  return <CotDashboard onOpen={open}/>
}
// AIGenerateModal has been replaced by AIQuoteChat component (unified flow with chat)
