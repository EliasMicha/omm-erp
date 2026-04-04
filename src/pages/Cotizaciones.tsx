import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Quotation, QuotationArea, QuotationItem, CatalogProduct, Project, ProjectLine } from '../types'
import { F, SPECIALTY_CONFIG, STAGE_CONFIG, calcItemPrice, calcItemTotal } from '../lib/utils'
import { Badge, Btn, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { Plus, ChevronLeft, X } from 'lucide-react'

function CotDashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const [cots, setCots] = useState<Quotation[]>([])
  const [filtro, setFiltro] = useState<string>('todas')
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    supabase.from('quotations').select('*,project:projects(name,client_name)').order('updated_at',{ascending:false})
      .then(({ data }) => { setCots(data||[]); setLoading(false) })
  }, [showNew])

  const lista = filtro === 'todas' ? cots : cots.filter(c => c.specialty === filtro)
  const totalPipeline = cots.reduce((s,c) => s+c.total, 0)
  const byStage = (s: string) => cots.filter(c => c.stage === s).reduce((a,c) => a+c.total, 0)

  return (
    <div style={{padding:'24px 28px'}}>
      <SectionHeader title="Cotizaciones"
        subtitle={`${cots.length} cotizaciones | Pipeline: ${F(totalPipeline)}`}
        action={<Btn variant="primary" onClick={() => setShowNew(true)}><Plus size={14}/> Nueva cotizacion</Btn>}/>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:20}}>
        {(['contrato','propuesta','estimacion','oportunidad'] as const).map(s => {
          const cfg = STAGE_CONFIG[s]
          return (
            <div key={s} style={{background:'#141414',border:'1px solid #222',borderRadius:10,padding:'12px 14px',borderTop:`2px solid ${cfg.color}`}}>
              <div style={{fontSize:10,color:'#555',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:4}}>{cfg.label}</div>
              <div style={{fontSize:18,fontWeight:700,color:'#fff'}}>{F(byStage(s))}</div>
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
            <Th>Cotizacion</Th><Th>Proyecto</Th><Th>Especialidad</Th><Th>Etapa</Th><Th right>Total</Th><Th></Th>
          </tr></thead>
          <tbody>
            {lista.length === 0 && (<tr><td colSpan={6}><EmptyState message="Sin cotizaciones - crea la primera"/></td></tr>)}
            {lista.map(c => {
              const esp = SPECIALTY_CONFIG[c.specialty]; const stage = STAGE_CONFIG[c.stage]; const proj = c.project as any
              return (
                <tr key={c.id} style={{cursor:'pointer'}} onClick={() => onOpen(c.id)}>
                  <Td><span style={{fontWeight:500,color:'#fff'}}>{c.name}</span></Td>
                  <Td muted>{proj?.name||'--'}</Td>
                  <Td><Badge label={esp.icon+' '+esp.label} color={esp.color}/></Td>
                  <Td><Badge label={stage.label} color={stage.color}/></Td>
                  <Td right><span style={{fontWeight:600,color:'#57FF9A'}}>{F(c.total)}</span></Td>
                  <Td><Btn size="sm" onClick={e => { e?.stopPropagation(); onOpen(c.id) }}>Abrir</Btn></Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {showNew && <NuevaCoModal onClose={() => setShowNew(false)} onCreated={id => { setShowNew(false); onOpen(id) }}/>}
    </div>
  )
}

function NuevaCoModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [form, setForm] = useState({ project_id:'', name:'', specialty:'esp', client_name:'' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('projects').select('*').eq('status','activo').then(({ data }) => setProjects(data||[]))
  }, [])

  async function crear() {
    setSaving(true)
    const { data } = await supabase.from('quotations').insert({
      project_id: form.project_id||null, name: form.name,
      specialty: form.specialty, client_name: form.client_name, stage: 'oportunidad',
    }).select().single()
    if (data) {
      await supabase.from('quotation_areas').insert({ quotation_id: data.id, name: 'General', order_index: 0 })
      onCreated(data.id)
    }
    setSaving(false)
  }

  const inp = (label: string, value: string, onChange: (v:string)=>void, placeholder='') => (
    <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.06em'}}>
      {label}
      <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{display:'block',width:'100%',marginTop:4,padding:'8px 10px',background:'#1e1e1e',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:13,fontFamily:'inherit'}}/>
    </label>
  )

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
      <div style={{background:'#141414',border:'1px solid #333',borderRadius:16,padding:24,width:480}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <div style={{fontSize:15,fontWeight:600,color:'#fff'}}>Nueva cotizacion</div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'#666',cursor:'pointer'}}><X size={18}/></button>
        </div>
        <div style={{display:'grid',gap:12}}>
          {inp('Nombre', form.name, v=>setForm(f=>({...f,name:v})), 'ej. Cero5cien O-402 - Especiales')}
          {inp('Cliente', form.client_name, v=>setForm(f=>({...f,client_name:v})), 'Nombre del cliente')}
          <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.06em'}}>
            Proyecto (opcional)
            <select value={form.project_id} onChange={e=>setForm(f=>({...f,project_id:e.target.value}))}
              style={{display:'block',width:'100%',marginTop:4,padding:'8px 10px',background:'#1e1e1e',border:'1px solid #333',borderRadius:8,color:'#fff',fontSize:13,fontFamily:'inherit'}}>
              <option value="">-- Sin proyecto --</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name} | {p.client_name}</option>)}
            </select>
          </label>
          <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.06em'}}>
            Especialidad
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
              {Object.entries(SPECIALTY_CONFIG).map(([k,v]) => (
                <button key={k} onClick={()=>setForm(f=>({...f,specialty:k}))}
                  style={{padding:'5px 12px',borderRadius:20,fontSize:11,cursor:'pointer',fontFamily:'inherit',fontWeight:600,
                    border:`1px solid ${form.specialty===k?v.color:'#333'}`,
                    background:form.specialty===k?v.color+'22':'transparent',
                    color:form.specialty===k?v.color:'#666'}}>
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
          </label>
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:20}}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={crear}>{saving?'Creando...':'Crear cotizacion'}</Btn>
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
  const [showCat, setShowCat] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: c },{ data: as_ },{ data: it },{ data: cat }] = await Promise.all([
        supabase.from('quotations').select('*,project:projects(name,client_name)').eq('id',cotId).single(),
        supabase.from('quotation_areas').select('*').eq('quotation_id',cotId).order('order_index'),
        supabase.from('quotation_items').select('*').eq('quotation_id',cotId),
        supabase.from('catalog_products').select('*').eq('is_active',true).order('name'),
      ])
      setCot(c); setAreas(as_||[]); setItems(it||[]); setCatalog(cat||[])
      if (as_ && as_.length > 0) setAreaActiva(as_[0].id)
      setLoading(false)
    }
    load()
  }, [cotId])

  async function setStage(stage: string) {
    await supabase.from('quotations').update({ stage }).eq('id', cotId)
    setCot(c => c ? {...c, stage: stage as any} : c)
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
          <span style={{fontSize:14,fontWeight:700,color:'#57FF9A',marginLeft:8}}>{F(cotTotal)}</span>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'175px 1fr',flex:1,overflow:'hidden'}}>
        <div style={{borderRight:'1px solid #222',overflowY:'auto',background:'#0e0e0e'}}>
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
        </div>

        <div style={{display:'flex',flexDirection:'column',overflow:'hidden'}}>
          <div style={{padding:'6px 14px',borderBottom:'1px solid #222',display:'flex',alignItems:'center',gap:8,flexShrink:0,background:'#111'}}>
            <span style={{fontSize:12,fontWeight:600,color:'#fff'}}>{areaObj?.name}</span>
            <span style={{marginLeft:'auto',fontSize:13,fontWeight:700,color:esp.color}}>{F(areaTotal)}</span>
          </div>

          <div style={{flex:1,overflowY:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#1a1a1a',position:'sticky',top:0,zIndex:1}}>
                  {['Producto','Sistema','Tipo','Proveedor','Cant.','Costo','Markup%','Precio','Total',''].map((h,i) => (
                    <th key={h} style={{padding:'6px 8px',fontSize:10,fontWeight:600,color:'#444',textAlign:i>=4?'right':'left',textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:'1px solid #222',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {areaItems.map(item => (
                  <tr key={item.id}>
                    <td style={{padding:'7px 8px',fontSize:12,fontWeight:500,color:'#ddd',borderBottom:'1px solid #1a1a1a'}}>{item.name}</td>
                    <td style={{padding:'7px 8px',borderBottom:'1px solid #1a1a1a'}}>{item.system&&<Badge label={item.system} color="#555"/>}</td>
                    <td style={{padding:'7px 8px',fontSize:10,color:'#555',borderBottom:'1px solid #1a1a1a'}}>{item.type}</td>
                    <td style={{padding:'7px 8px',fontSize:10,color:'#555',borderBottom:'1px solid #1a1a1a'}}>{item.provider||'--'}</td>
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
                ))}
                <tr>
                  <td colSpan={10} style={{padding:'6px 8px'}}>
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
  const [openId, setOpenId] = useState<string|null>(null)
  if (openId) return <CotEditor cotId={openId} onBack={()=>setOpenId(null)}/>
  return <CotDashboard onOpen={setOpenId}/>
}
