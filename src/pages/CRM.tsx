import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Badge, Btn, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { Plus, X } from 'lucide-react'
import { SPECIALTY_CONFIG } from '../lib/utils'
import { ProjectLine } from '../types'

type LeadStatus = 'nuevo' | 'contactado' | 'diagnostico' | 'cotizando' | 'ganado' | 'perdido' | 'pausado'
type LeadOrigin = 'inbound' | 'outbound' | 'referido' | 'arquitecto' | 'desarrolladora'

interface Lead {
  id: string
  created_at: string
  updated_at: string
  name: string
  company?: string
  contact_name?: string
  contact_phone?: string
  contact_email?: string
  origin: LeadOrigin
  status: LeadStatus
  needs: ProjectLine[]
  notes?: string
  estimated_value?: number
  lost_reason?: string
  project_id?: string
}

const STATUS_CFG: Record<LeadStatus, { label: string; color: string; order: number }> = {
  nuevo:       { label: 'Nuevo',        color: '#6B7280', order: 0 },
  contactado:  { label: 'Contactado',   color: '#3B82F6', order: 1 },
  diagnostico: { label: 'Diagnostico',  color: '#F59E0B', order: 2 },
  cotizando:   { label: 'Cotizando',    color: '#C084FC', order: 3 },
  ganado:      { label: 'Ganado',       color: '#57FF9A', order: 4 },
  perdido:     { label: 'Perdido',      color: '#EF4444', order: 5 },
  pausado:     { label: 'Pausado',      color: '#78716C', order: 6 },
}

const ORIGIN_CFG: Record<LeadOrigin, { label: string; icon: string }> = {
  inbound:       { label: 'Inbound',       icon: 'IN' },
  outbound:      { label: 'Outbound',      icon: 'OUT' },
  referido:      { label: 'Referido',      icon: 'REF' },
  arquitecto:    { label: 'Arquitecto',    icon: 'ARQ' },
  desarrolladora:{ label: 'Desarrolladora',icon: 'DEV' },
}

const F = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n)
const PIPELINE_STAGES: LeadStatus[] = ['nuevo', 'contactado', 'diagnostico', 'cotizando']

function InputField({ label, value, onChange, placeholder = '', type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block' }}>
      {label}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
    </label>
  )
}

function NuevoLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', company: '', contact_name: '', contact_phone: '', contact_email: '',
    origin: 'inbound' as LeadOrigin, needs: [] as ProjectLine[], notes: '', estimated_value: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggleNeed = (n: ProjectLine) =>
    setForm(f => ({ ...f, needs: f.needs.includes(n) ? f.needs.filter(x => x !== n) : [...f.needs, n] }))

  async function crear() {
    if (!form.name.trim()) { setError('El nombre es requerido'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('leads').insert({
      name: form.name.trim(), company: form.company || null,
      contact_name: form.contact_name || null, contact_phone: form.contact_phone || null,
      contact_email: form.contact_email || null, origin: form.origin, status: 'nuevo',
      needs: form.needs, notes: form.notes || null,
      estimated_value: parseFloat(form.estimated_value) || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 540, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Nuevo lead</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>X</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <InputField label="Nombre / Proyecto" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="ej. Torre Reforma 222" />
          <InputField label="Empresa / Cliente" value={form.company} onChange={v => setForm(f => ({ ...f, company: v }))} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <InputField label="Contacto" value={form.contact_name} onChange={v => setForm(f => ({ ...f, contact_name: v }))} />
            <InputField label="Telefono" value={form.contact_phone} onChange={v => setForm(f => ({ ...f, contact_phone: v }))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <InputField label="Email" value={form.contact_email} onChange={v => setForm(f => ({ ...f, contact_email: v }))} />
            <InputField label="Valor estimado (MXN)" value={form.estimated_value} onChange={v => setForm(f => ({ ...f, estimated_value: v }))} type="number" />
          </div>
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Origen
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {(Object.entries(ORIGIN_CFG) as [LeadOrigin, typeof ORIGIN_CFG[LeadOrigin]][]).map(([k, v]) => (
                <button key={k} onClick={() => setForm(f => ({ ...f, origin: k }))}
                  style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px solid ${form.origin === k ? '#57FF9A' : '#333'}`,
                    background: form.origin === k ? '#57FF9A22' : 'transparent',
                    color: form.origin === k ? '#57FF9A' : '#666', fontWeight: form.origin === k ? 600 : 400 }}>
                  {v.label}
                </button>
              ))}
            </div>
          </label>
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Especialidades
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {(Object.entries(SPECIALTY_CONFIG) as [ProjectLine, typeof SPECIALTY_CONFIG[ProjectLine]][]).map(([k, v]) => (
                <button key={k} onClick={() => toggleNeed(k)}
                  style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                    border: `1px solid ${form.needs.includes(k) ? v.color : '#333'}`,
                    background: form.needs.includes(k) ? v.color + '22' : 'transparent',
                    color: form.needs.includes(k) ? v.color : '#666' }}>
                  {v.label}
                </button>
              ))}
            </div>
          </label>
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Notas
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
          </label>
        </div>
        {error && <div style={{ color: '#EF4444', fontSize: 12, marginTop: 10 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={crear}>{saving ? 'Guardando...' : 'Crear lead'}</Btn>
        </div>
      </div>
    </div>
  )
}

function KanbanView({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      {PIPELINE_STAGES.map(stage => {
        const cfg = STATUS_CFG[stage]
        const cols = leads.filter(l => l.status === stage)
        const total = cols.reduce((s, l) => s + (l.estimated_value || 0), 0)
        return (
          <div key={stage} style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 10, padding: '10px 10px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid ${cfg.color}33` }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{cfg.label}</div>
                <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{cols.length} lead{cols.length !== 1 ? 's' : ''} {total > 0 ? F(total) : ''}</div>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cols.length === 0 && <div style={{ fontSize: 11, color: '#333', textAlign: 'center', padding: '16px 0' }}>Sin leads</div>}
              {cols.map(lead => (
                <div key={lead.id} onClick={() => onOpen(lead)}
                  style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, padding: '10px 12px', cursor: 'pointer' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 3 }}>{lead.name}</div>
                  {lead.company && <div style={{ fontSize: 10, color: '#555', marginBottom: 6 }}>{lead.company}</div>}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {lead.needs.map(n => {
                      const s = SPECIALTY_CONFIG[n]
                      return s ? <Badge key={n} label={s.label} color={s.color} /> : null
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 10, color: '#444' }}>{ORIGIN_CFG[lead.origin]?.label}</div>
                    {lead.estimated_value ? <div style={{ fontSize: 11, fontWeight: 600, color: '#57FF9A' }}>{F(lead.estimated_value)}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ListView({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  if (leads.length === 0) return <EmptyState message="Sin leads" />
  return (
    <Table>
      <thead>
        <tr>
          <Th>Lead</Th><Th>Contacto</Th><Th>Origen</Th><Th>Estatus</Th><Th right>Valor</Th><Th></Th>
        </tr>
      </thead>
      <tbody>
        {leads.map(lead => {
          const sCfg = STATUS_CFG[lead.status]
          return (
            <tr key={lead.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(lead)}>
              <Td>
                <div style={{ fontWeight: 500, color: '#fff' }}>{lead.name}</div>
                {lead.company && <div style={{ fontSize: 10, color: '#555' }}>{lead.company}</div>}
              </Td>
              <Td><div style={{ fontSize: 12, color: '#ccc' }}>{lead.contact_name || '-'}</div></Td>
              <Td muted>{ORIGIN_CFG[lead.origin]?.label}</Td>
              <Td><Badge label={sCfg.label} color={sCfg.color} /></Td>
              <Td right>{lead.estimated_value ? <span style={{ fontWeight: 600, color: '#57FF9A' }}>{F(lead.estimated_value)}</span> : <span style={{ color: '#444' }}>-</span>}</Td>
              <Td><Btn size="sm" onClick={e => { e.stopPropagation(); onOpen(lead) }}>Abrir</Btn></Td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

export default function CRM() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<Lead | null>(null)
  const [viewMode, setViewMode] = useState<'kanban' | 'lista'>('kanban')
  const [filtroStatus, setFiltroStatus] = useState<LeadStatus | 'todos'>('todos')

  function load() {
    setLoading(true)
    supabase.from('leads').select('*').order('updated_at', { ascending: false })
      .then(({ data }) => { setLeads(data || []); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  const activePipeline = leads.filter(l => !['ganado', 'perdido', 'pausado'].includes(l.status))
  const pipelineValue = activePipeline.reduce((s, l) => s + (l.estimated_value || 0), 0)
  const ganados = leads.filter(l => l.status === 'ganado').length
  const perdidos = leads.filter(l => l.status === 'perdido').length
  const tasaCierre = (ganados + perdidos) > 0 ? Math.round(ganados / (ganados + perdidos) * 100) : 0
  const lista = filtroStatus === 'todos' ? leads : leads.filter(l => l.status === filtroStatus)

  return (
    <div style={{ padding: '24px 28px' }}>
      <SectionHeader
        title="CRM y Ventas"
        subtitle={`${leads.length} leads totales`}
        action={<Btn variant="primary" onClick={() => setShowNew(true)}><Plus size={14} /> Nuevo lead</Btn>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Pipeline activo', value: activePipeline.length.toString(), sub: F(pipelineValue), color: '#3B82F6' },
          { label: 'Ganados', value: ganados.toString(), sub: 'historico', color: '#57FF9A' },
          { label: 'Perdidos', value: perdidos.toString(), sub: 'historico', color: '#EF4444' },
          { label: 'Tasa de cierre', value: `${tasaCierre}%`, sub: `${ganados} de ${ganados + perdidos}`, color: '#C084FC' },
        ].map(k => (
          <div key={k.label} style={{ background: '#141414', border: '1px solid #222', borderRadius: 10, padding: '12px 14px', borderTop: `2px solid ${k.color}` }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{k.value}</div>
            <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(['todos', ...Object.keys(STATUS_CFG)] as (LeadStatus | 'todos')[]).map(k => {
            const v = k === 'todos' ? { label: 'Todos', color: '#57FF9A' } : STATUS_CFG[k as LeadStatus]
            const active = filtroStatus === k
            return (
              <button key={k} onClick={() => setFiltroStatus(k)}
                style={{ padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                  fontWeight: active ? 600 : 400, border: `1px solid ${active ? v.color : '#333'}`,
                  background: active ? v.color + '22' : 'transparent', color: active ? v.color : '#666' }}>
                {v.label}
              </button>
            )
          })}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', border: '1px solid #333', borderRadius: 8, overflow: 'hidden' }}>
          {(['kanban', 'lista'] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              style={{ padding: '5px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                background: viewMode === m ? '#57FF9A22' : 'transparent',
                color: viewMode === m ? '#57FF9A' : '#555', fontWeight: viewMode === m ? 600 : 400,
                border: 'none', borderRight: m === 'kanban' ? '1px solid #333' : 'none' }}>
              {m === 'kanban' ? 'Kanban' : 'Lista'}
            </button>
          ))}
        </div>
      </div>
      {loading ? <Loading /> : (
        viewMode === 'kanban'
          ? <KanbanView leads={lista} onOpen={setSelected} />
          : <ListView leads={lista} onOpen={setSelected} />
      )}
      {showNew && <NuevoLeadModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} />}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 500, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{selected.name}</div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>X</button>
            </div>
            {selected.company && <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>{selected.company}</div>}
            <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
              {selected.contact_name && <div><span style={{ color: '#555' }}>Contacto: </span><span style={{ color: '#ccc' }}>{selected.contact_name}</span></div>}
              {selected.contact_phone && <div><span style={{ color: '#555' }}>Tel: </span><span style={{ color: '#ccc' }}>{selected.contact_phone}</span></div>}
              {selected.contact_email && <div><span style={{ color: '#555' }}>Email: </span><span style={{ color: '#ccc' }}>{selected.contact_email}</span></div>}
              {selected.estimated_value && <div><span style={{ color: '#555' }}>Valor: </span><span style={{ color: '#57FF9A', fontWeight: 600 }}>{F(selected.estimated_value)}</span></div>}
              {selected.notes && <div style={{ marginTop: 8, padding: 10, background: '#1a1a1a', borderRadius: 8, color: '#888', lineHeight: 1.5 }}>{selected.notes}</div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <Btn onClick={() => setSelected(null)}>Cerrar</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
              }
