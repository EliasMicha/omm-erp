import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Project } from '../../types'
import { F, STATUS_CONFIG, SPECIALTY_CONFIG } from '../../lib/utils'
import { Badge, ProgressBar, Btn, Loading, SectionHeader, EmptyState } from '../layout/UI'
import { Plus } from 'lucide-react'

export default function Proyectos() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<string>('activo')

  useEffect(() => {
    supabase.from('projects').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setProjects(data || []); setLoading(false) })
  }, [])

  const lista = filtro === 'todos' ? projects : projects.filter(p => p.status === filtro)

  return (
    <div style={{ padding: '24px 28px' }}>
      <SectionHeader title="Proyectos" subtitle={`${projects.length} proyectos totales`} action={<Btn variant="primary"><Plus size={14} /> Nuevo proyecto</Btn>} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {['todos', 'activo', 'pausado', 'completado', 'cancelado'].map(f => {
          const on = filtro === f
          const cfg = f !== 'todos' ? STATUS_CONFIG[f as any] : null
          return (<button key={f} onClick={() => setFiltro(f)} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${on ? (cfg?.color || '#57FF9A') : '#333'}`, background: on ? (cfg?.color || '#57FF9A') + '22' : 'transparent', color: on ? (cfg?.color || '#57FF9A') : '#666', fontWeight: on ? 600 : 400 }}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>)
        })}
      </div>
      {loading ? <Loading /> : lista.length === 0 ? (<EmptyState message="Sin proyectos" />) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {lista.map(p => {
            const cfg = STATUS_CONFIG[p.status]
            return (
              <div key={p.id} style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '16px 18px', borderTop: `2px solid ${cfg.color}33` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: '#555' }}>{p.client_name}</div>
                  </div>
                  <Badge label={cfg.label} color={cfg.color} />
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                  {p.lines.map(l => { const e = SPECIALTY_CONFIG[l]; return <Badge key={l} label={e.icon + ' ' + e.label} color={e.color} /> })}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 4 }}>Avance de obra</div>
                  <ProgressBar pct={p.advance_pct} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid #1e1e1e' }}>
                  <span style={{ fontSize: 10, color: '#555' }}>Valor contrato</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#57FF9A' }}>{F(p.contract_value)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
