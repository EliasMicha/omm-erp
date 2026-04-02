import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Quotation } from '../../types'
import { F, SPECIALTY_CONFIG, STAGE_CONFIG } from '../../lib/utils'
import { Badge, Btn, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../layout/UI'
import { Plus } from 'lucide-react'

export default function Cotizaciones() {
  const [cots, setCots] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState("todas")
  useEffect(() => {
    supabase.from("quotations").select("*,project:projects(name,client_name)").order("updated_at",{ascending:false})
      .then(({data}) => { setCots(data||[]); setLoading(false) })
  }, [])
  const lista = filtro === "todas" ? cots : cots.filter(c => c.specialty === filtro)
  const pipeline = cots.reduce((s,c) => s+c.total, 0)
  return (
    <div style={{padding:"24px 28px"}}>
      <SectionHeader title="Cotizaciones" subtitle={cots.length+" cotizaciones · Pipeline: "+F(pipeline)}
        action={<Btn variant="primary"><Plus size={14}/> Nueva cotización</Btn>} />
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {["todas","esp","elec","ilum","cort","proy"].map(f => {
          const on=filtro===f; const cfg=f!=="todas"?SPECIALTY_CONFIG[f as any]:null
          return <button key={f} onClick={()=>setFiltro(f)} style={{padding:"5px 12px",borderRadius:20,fontSize:11,cursor:"pointer",fontFamily:"inherit",border:"1px solid "+(on?(cfg?.color||"#57FF9A"):"#333"),background:on?(cfg?.color||"#57FF9A")+"22":"transparent",color:on?(cfg?.color||"#57FF9A"):"#666",fontWeight:on?600:400}}>
            {f==="todas"?"Todas":cfg?.icon+" "+cfg?.label}
          </button>
        })}
      </div>
      {loading ? <Loading/> : (
        <Table>
          <thead><tr><Th>Cotización</Th><Th>Proyecto</Th><Th>Especialidad</Th><Th>Etapa</Th><Th right>Total</Th></tr></thead>
          <tbody>
            {lista.length===0 && <tr><td colSpan={5}><EmptyState message="Sin cotizaciones — crea la primera"/></td></tr>}
            {lista.map(c => {
              const esp=SPECIALTY_CONFIG[c.specialty]; const stage=STAGE_CONFIG[c.stage]; const proj=c.project as any
              return <tr key={c.id}>
                <Td><span style={{fontWeight:500,color:"#fff"}}>{c.name}</span></Td>
                <Td muted>{proj?.name||"—"}</Td>
                <Td><Badge label={esp.icon+" "+esp.label} color={esp.color}/></Td>
                <Td><Badge label={stage.label} color={stage.color}/></Td>
                <Td right><span style={{fontWeight:600,color:"#57FF9A"}}>{F(c.total)}</span></Td>
              </tr>
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}
