import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Btn } from './layout/UI'
import { X } from 'lucide-react'

interface Props {
  cotId: string
  name: string
  clientName: string
  projectId: string | null
  onClose: () => void
  onSaved: (name: string, client: string, projId: string | null, projName: string) => void
}

export default function EditCotInfoModal({ cotId, name, clientName, projectId, onClose, onSaved }: Props) {
  const [form, setForm] = useState({ name, client_name: clientName, project_id: projectId || '', lead_id: '' })
  const [projects, setProjects] = useState<Array<{ id: string; name: string; client_name: string }>>([])
  const [leads, setLeads] = useState<Array<{ id: string; name: string; company: string }>>([])
  const [clientes, setClientes] = useState<Array<{ id: string; razon_social: string; rfc: string }>>([])
  const [clientSearch, setClientSearch] = useState(clientName)
  const [showDrop, setShowDrop] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('id,name,client_name').eq('status', 'activo'),
      supabase.from('leads').select('id,name,company').order('name'),
      supabase.from('clientes').select('id,razon_social,rfc').eq('activo', true).order('razon_social'),
      supabase.from('quotations').select('notes').eq('id', cotId).single(),
    ]).then(([{ data: p }, { data: l }, { data: c }, { data: q }]) => {
      setProjects(p || []); setLeads(l || []); setClientes(c || [])
      try { const meta = JSON.parse(q?.notes || '{}'); if (meta.lead_id) setForm(f => ({ ...f, lead_id: meta.lead_id })) } catch {}
    })
  }, [])

  async function save() {
    setSaving(true)
    await supabase.from('quotations').update({
      name: form.name, client_name: form.client_name, project_id: form.project_id || null,
    }).eq('id', cotId)
    // Update lead in notes
    const { data: current } = await supabase.from('quotations').select('notes').eq('id', cotId).single()
    let meta: any = {}
    try { meta = JSON.parse(current?.notes || '{}') } catch {}
    const selectedLead = leads.find(l => l.id === form.lead_id)
    meta.lead_id = form.lead_id || null
    meta.lead_name = selectedLead?.name || ''
    await supabase.from('quotations').update({ notes: JSON.stringify(meta) }).eq('id', cotId)

    const proj = projects.find(p => p.id === form.project_id)
    onSaved(form.name, form.client_name, form.project_id || null, proj?.name || '')
    setSaving(false)
  }

  const inputStyle = { display: 'block' as const, width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }
  const labelStyle = { fontSize: 10, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block' as const }
  const filtered = clientSearch.length >= 2
    ? clientes.filter(c => c.razon_social.toLowerCase().includes(clientSearch.toLowerCase()))
    : clientes.slice(0, 8)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1020 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Editar cotización</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={labelStyle}>Nombre<input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} /></label>

          <label style={labelStyle}>
            Lead
            <select value={form.lead_id} onChange={e => {
              const lead = leads.find(l => l.id === e.target.value)
              setForm(f => ({ ...f, lead_id: e.target.value, client_name: lead?.company || lead?.name || f.client_name }))
              if (lead) setClientSearch(lead.company || lead.name)
            }} style={inputStyle}>
              <option value="">-- Seleccionar lead --</option>
              {leads.map(l => <option key={l.id} value={l.id}>{l.name}{l.company ? ' | ' + l.company : ''}</option>)}
            </select>
          </label>

          <label style={labelStyle}>
            Cliente (fiscal)
            <div style={{ position: 'relative' }}>
              <input value={clientSearch} onChange={e => { setClientSearch(e.target.value); setForm(f => ({ ...f, client_name: e.target.value })); setShowDrop(true) }}
                onFocus={() => setShowDrop(true)} style={inputStyle} />
              {showDrop && filtered.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, marginTop: 2, maxHeight: 150, overflowY: 'auto', zIndex: 10 }}>
                  {filtered.map(c => (
                    <div key={c.id} onClick={() => { setForm(f => ({ ...f, client_name: c.razon_social })); setClientSearch(c.razon_social); setShowDrop(false) }}
                      style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 12, color: '#ccc', borderBottom: '1px solid #222' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#222' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      {c.razon_social} <span style={{ fontSize: 10, color: '#555' }}>{c.rfc}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </label>

          <label style={labelStyle}>
            Proyecto (opcional)
            <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} style={inputStyle}>
              <option value="">-- Sin proyecto --</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name} | {p.client_name}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Btn>
        </div>
      </div>
    </div>
  )
}
