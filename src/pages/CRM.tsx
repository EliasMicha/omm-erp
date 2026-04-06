import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Badge, Btn, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { Plus, X, Search, Trash2, Save, Sparkles } from 'lucide-react'
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
}

const STATUS_CFG: Record<LeadStatus, { label: string; color: string; order: number }> = {
  nuevo:       { label: 'Nuevo',       color: '#6B7280', order: 0 },
  contactado:  { label: 'Contactado',  color: '#3B82F6', order: 1 },
  diagnostico: { label: 'Diagnostico', color: '#F59E0B', order: 2 },
  cotizando:   { label: 'Cotizando',   color: '#C084FC', order: 3 },
  ganado:      { label: 'Ganado',      color: '#57FF9A', order: 4 },
  perdido:     { label: 'Perdido',     color: '#EF4444', order: 5 },
  pausado:     { label: 'Pausado',     color: '#78716C', order: 6 },
}

const ORIGIN_CFG: Record<LeadOrigin, { label: string }> = {
  inbound:        { label: 'Inbound'        },
  outbound:       { label: 'Outbound'       },
  referido:       { label: 'Referido'       },
  arquitecto:     { label: 'Arquitecto'     },
  desarrolladora: { label: 'Desarrolladora' },
}

const F = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n)
const PIPELINE_STAGES: LeadStatus[] = ['nuevo', 'contactado', 'diagnostico', 'cotizando']

// ─── Input reutilizable ────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder = '', type = 'text', disabled = false }: {
  label: string; value: string; onChange?: (v: string) => void
  placeholder?: string; type?: string; disabled?: boolean
}) {
  return (
    <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block' }}>
      {label}
      <input type={type} value={value} onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px',
          background: disabled ? '#111' : '#1e1e1e', border: '1px solid #333',
          borderRadius: 8, color: disabled ? '#555' : '#fff', fontSize: 13,
          fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
    </label>
  )
}

// ─── Chips de seleccion ────────────────────────────────────────────────────
function Chips({ label, options, value, onChange, colorMap }: {
  label: string
  options: { key: string; label: string; color?: string }[]
  value: string | string[]
  onChange: (v: string) => void
  colorMap?: Record<string, string>
}) {
  const isMulti = Array.isArray(value)
  const isActive = (k: string) => isMulti ? (value as string[]).includes(k) : value === k
  return (
    <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {label}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginTop: 6 }}>
        {options.map(({ key, label: lbl, color }) => {
          const c = colorMap?.[key] || color || '#57FF9A'
          const active = isActive(key)
          return (
            <button key={key} onClick={() => onChange(key)} style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
              fontFamily: 'inherit', fontWeight: active ? 600 : 400,
              border: `1px solid ${active ? c : '#333'}`,
              background: active ? c + '22' : 'transparent',
              color: active ? c : '#666'
            }}>{lbl}</button>
          )
        })}
      </div>
    </label>
  )
}

// ─── Modal Nuevo Lead ──────────────────────────────────────────────────────
function NuevoLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', company: '', client_final: '', contact_name: '', contact_phone: '', contact_email: '',
    origin: 'inbound' as LeadOrigin, needs: [] as ProjectLine[], notes: '', estimated_value: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [clientes, setClientes] = useState<Array<{ id: string; razon_social: string; rfc: string }>>([])
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDrop, setShowClientDrop] = useState(false)
  const [showNewClient, setShowNewClient] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientRfc, setNewClientRfc] = useState('')

  useEffect(() => {
    supabase.from('clientes_fiscales').select('id,razon_social,rfc').neq('activo', false).order('razon_social')
      .then(({ data }) => setClientes(data || []))
  }, [])

  const s = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))
  const toggleNeed = (n: ProjectLine) =>
    setForm(f => ({ ...f, needs: f.needs.includes(n) ? f.needs.filter(x => x !== n) : [...f.needs, n] }))

  const filteredClientes = clientSearch.length >= 1
    ? clientes.filter(c => c.razon_social.toLowerCase().includes(clientSearch.toLowerCase()) || c.rfc.toLowerCase().includes(clientSearch.toLowerCase())).slice(0, 10)
    : clientes.slice(0, 10)

  async function crearClienteInline() {
    if (!newClientName.trim()) return
    const { data } = await supabase.from('clientes_fiscales').insert({
      razon_social: newClientName.trim(), rfc: newClientRfc.trim() || 'XAXX010101000',
      regimen_fiscal: '601', regimen_fiscal_clave: '601', codigo_postal: '00000',
      uso_cfdi: 'G03', uso_cfdi_clave: 'G03', tipo_persona: 'moral', activo: true,
    }).select().single()
    if (data) {
      setClientes(prev => [...prev, data])
      setForm(f => ({ ...f, company: data.razon_social }))
      setClientSearch(data.razon_social)
    }
    setShowNewClient(false); setNewClientName(''); setNewClientRfc('')
  }

  async function crear() {
    if (!form.name.trim()) { setError('El nombre es requerido'); return }
    setSaving(true); setError('')
    const notesData = form.notes || ''
    const notesWithClient = form.client_final ? JSON.stringify({ client_final: form.client_final, text: notesData }) : notesData
    const { error: err } = await supabase.from('leads').insert({
      name: form.name.trim(), company: form.company || null,
      contact_name: form.contact_name || null, contact_phone: form.contact_phone || null,
      contact_email: form.contact_email || null, origin: form.origin, status: 'nuevo',
      needs: form.needs, notes: notesWithClient || null,
      estimated_value: parseFloat(form.estimated_value) || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24, width: 560, maxHeight: '90vh', overflowY: 'auto' as const }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Nuevo lead</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4 }}><X size={18} /></button>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          <Field label="Nombre / Proyecto *" value={form.name} onChange={s('name')} placeholder="ej. Casa Salame" />

          {/* Arquitecto / Despacho */}
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
            Arquitecto / Despacho
            <input value={form.company} onChange={e => { s('company')(e.target.value) }}
              placeholder="ej. Niz+Chauvet Arquitectos"
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
          </label>

          {/* Cliente Final (quien paga/factura) with dropdown */}
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
            Cliente Final (quien paga / factura)
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <div style={{ position: 'relative' as const, flex: 1 }}>
                <input value={clientSearch} onChange={e => { setClientSearch(e.target.value); setForm(f => ({ ...f, client_final: e.target.value })) }}
                  onFocus={() => setShowClientDrop(true)}
                  onBlur={() => setTimeout(() => setShowClientDrop(false), 200)}
                  placeholder="Buscar cliente fiscal..."
                  style={{ width: '100%', padding: '8px 10px', background: '#1e1e1e', border: '1px solid ' + (showClientDrop ? '#57FF9A' : '#333'), borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
                {showClientDrop && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, marginTop: 2, maxHeight: 180, overflowY: 'auto', zIndex: 10 }}>
                    {filteredClientes.length === 0 ? (
                      <div style={{ padding: '10px', fontSize: 11, color: '#555', textAlign: 'center' }}>Sin resultados — usa "+ Nuevo" para crear</div>
                    ) : filteredClientes.map(c => (
                      <div key={c.id} onMouseDown={e => e.preventDefault()}
                        onClick={() => { setForm(f => ({ ...f, company: c.razon_social })); setClientSearch(c.razon_social); setShowClientDrop(false) }}
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
              <Btn size="sm" onClick={() => setShowNewClient(true)}>+ Nuevo</Btn>
            </div>
            {/* Inline new client mini form */}
            {showNewClient && (
              <div style={{ marginTop: 8, padding: 10, background: '#0e0e0e', border: '1px solid #222', borderRadius: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                  <input value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="Razón social"
                    style={{ padding: '6px 8px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit' }} />
                  <input value={newClientRfc} onChange={e => setNewClientRfc(e.target.value)} placeholder="RFC"
                    style={{ padding: '6px 8px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit' }} />
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                  <Btn size="sm" onClick={() => setShowNewClient(false)}>Cancelar</Btn>
                  <Btn size="sm" variant="primary" onClick={crearClienteInline}>Crear cliente</Btn>
                </div>
              </div>
            )}
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Contacto" value={form.contact_name} onChange={s('contact_name')} />
            <Field label="Telefono" value={form.contact_phone} onChange={s('contact_phone')} placeholder="+52 55..." />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Email" value={form.contact_email} onChange={s('contact_email')} placeholder="correo@ejemplo.com" />
            <Field label="Valor estimado (MXN)" value={form.estimated_value} onChange={s('estimated_value')} type="number" placeholder="0" />
          </div>
          <Chips label="Origen" value={form.origin}
            onChange={(k) => setForm(f => ({ ...f, origin: k as LeadOrigin }))}
            options={Object.entries(ORIGIN_CFG).map(([k, v]) => ({ key: k as LeadOrigin, label: v.label }))} />
          <Chips label="Especialidades de interes" value={form.needs}
            onChange={toggleNeed as (v: string) => void}
            options={Object.entries(SPECIALTY_CONFIG).map(([k, v]) => ({ key: k as ProjectLine, label: v.label, color: v.color }))} />
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Notas
            <textarea value={form.notes} onChange={e => s('notes')(e.target.value)} rows={3} placeholder="Contexto del lead, quien refirio, detalles del proyecto..."
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' as const, boxSizing: 'border-box' as const }} />
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

// ─── Modal Detalle / Editar Lead ───────────────────────────────────────────
function LeadModal({ lead, onClose, onUpdated, onDeleted }: {
  lead: Lead; onClose: () => void; onUpdated: () => void; onDeleted: () => void
}) {
  const [form, setForm] = useState(() => {
    let client_final = ''
    try { const m = JSON.parse(lead.notes || '{}'); client_final = m.client_final || '' } catch {}
    return {
      name: lead.name, company: lead.company || '', client_final,
      contact_name: lead.contact_name || '', contact_phone: lead.contact_phone || '',
      contact_email: lead.contact_email || '', origin: lead.origin, status: lead.status,
      needs: lead.needs || [] as ProjectLine[], notes: lead.notes || '',
      estimated_value: lead.estimated_value?.toString() || '', lost_reason: lead.lost_reason || '',
    }
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dirty, setDirty] = useState(false)

  const s = (k: string) => (v: string) => { setForm(f => ({ ...f, [k]: v })); setDirty(true) }
  const toggleNeed = (n: ProjectLine) => {
    setForm(f => ({ ...f, needs: f.needs.includes(n) ? f.needs.filter(x => x !== n) : [...f.needs, n] }))
    setDirty(true)
  }
  const setStatus = (st: LeadStatus) => { setForm(f => ({ ...f, status: st })); setDirty(true) }

  async function guardar() {
    setSaving(true)
    // Merge client_final into notes
    let notesValue = form.notes || ''
    if (form.client_final) {
      try {
        const existing = JSON.parse(notesValue || '{}')
        existing.client_final = form.client_final
        notesValue = JSON.stringify(existing)
      } catch {
        notesValue = JSON.stringify({ client_final: form.client_final, text: notesValue })
      }
    }
    await supabase.from('leads').update({
      name: form.name, company: form.company || null,
      contact_name: form.contact_name || null, contact_phone: form.contact_phone || null,
      contact_email: form.contact_email || null, origin: form.origin, status: form.status,
      needs: form.needs, notes: notesValue || null,
      estimated_value: parseFloat(form.estimated_value) || null,
      lost_reason: form.lost_reason || null, updated_at: new Date().toISOString(),
    }).eq('id', lead.id)
    setSaving(false)
    setDirty(false)
    onUpdated()
  }

  async function eliminar() {
    setDeleting(true)
    await supabase.from('leads').delete().eq('id', lead.id)
    setDeleting(false)
    onDeleted()
  }

  const statusCfg = STATUS_CFG[form.status]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, width: 640, maxHeight: '92vh', display: 'flex', flexDirection: 'column' as const }}>

        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{lead.name}</div>
            {lead.company && <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>{lead.company}</div>}
            <div style={{ fontSize: 10, color: '#3a3a3a', marginTop: 4 }}>
              Creado {new Date(lead.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
              {lead.updated_at !== lead.created_at && ` · Editado ${new Date(lead.updated_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`}
            </div>
          </div>
          <Badge label={statusCfg.label} color={statusCfg.color} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4, marginLeft: 4 }}><X size={18} /></button>
        </div>

        {/* Estatus rapido */}
        <div style={{ padding: '10px 22px', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
          {(Object.entries(STATUS_CFG) as [LeadStatus, typeof STATUS_CFG[LeadStatus]][]).map(([k, v]) => (
            <button key={k} onClick={() => setStatus(k)} style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              fontWeight: form.status === k ? 700 : 400,
              border: `1px solid ${form.status === k ? v.color : '#2a2a2a'}`,
              background: form.status === k ? v.color + '25' : 'transparent',
              color: form.status === k ? v.color : '#555'
            }}>{v.label}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto' as const, padding: '18px 22px' }}>
          <div style={{ display: 'grid', gap: 14 }}>
            <Field label="Nombre / Proyecto" value={form.name} onChange={s('name')} />
            <Field label="Arquitecto / Despacho" value={form.company} onChange={s('company')} placeholder="ej. Niz+Chauvet Arquitectos" />
            <Field label="Cliente Final (quien paga)" value={form.client_final || ''} onChange={s('client_final')} placeholder="ej. Grupo Desarrollador XYZ" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Contacto" value={form.contact_name} onChange={s('contact_name')} />
              <Field label="Telefono" value={form.contact_phone} onChange={s('contact_phone')} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Email" value={form.contact_email} onChange={s('contact_email')} />
              <Field label="Valor estimado (MXN)" value={form.estimated_value} onChange={s('estimated_value')} type="number" />
            </div>
            {form.status === 'perdido' && (
              <Field label="Razon de perdida" value={form.lost_reason} onChange={s('lost_reason')} placeholder="ej. Precio, competencia, proyecto cancelado..." />
            )}
            <Chips label="Origen" value={form.origin}
              onChange={(k) => { setForm(f => ({ ...f, origin: k as LeadOrigin })); setDirty(true) }}
              options={Object.entries(ORIGIN_CFG).map(([k, v]) => ({ key: k as LeadOrigin, label: v.label }))} />
            <Chips label="Especialidades de interes" value={form.needs}
              onChange={toggleNeed as (v: string) => void}
              options={Object.entries(SPECIALTY_CONFIG).map(([k, v]) => ({ key: k as ProjectLine, label: v.label, color: v.color }))} />
            <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Notas
              <textarea value={form.notes} onChange={e => s('notes')(e.target.value)} rows={4}
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' as const, boxSizing: 'border-box' as const }} />
            </label>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 22px', borderTop: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {confirmDelete ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#EF4444' }}>Eliminar este lead?</span>
              <Btn size="sm" onClick={() => setConfirmDelete(false)}>No</Btn>
              <Btn size="sm" variant="danger" onClick={eliminar}>{deleting ? 'Eliminando...' : 'Si, eliminar'}</Btn>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 0' }}>
              <Trash2 size={14} /> Eliminar
            </button>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardar} disabled={!dirty}>
              <Save size={13} /> {saving ? 'Guardando...' : 'Guardar cambios'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Kanban ────────────────────────────────────────────────────────────────
function KanbanView({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      {PIPELINE_STAGES.map(stage => {
        const cfg = STATUS_CFG[stage]
        const cols = leads.filter(l => l.status === stage)
        const total = cols.reduce((s, l) => s + (l.estimated_value || 0), 0)
        return (
          <div key={stage} style={{ background: '#0e0e0e', border: '1px solid #1a1a1a', borderRadius: 10, padding: '10px 10px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid ${cfg.color}33` }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: cfg.color, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>{cfg.label}</div>
                <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{cols.length} lead{cols.length !== 1 ? 's' : ''}{total > 0 ? ` · ${F(total)}` : ''}</div>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {cols.length === 0 && <div style={{ fontSize: 11, color: '#2a2a2a', textAlign: 'center' as const, padding: '20px 0' }}>Sin leads</div>}
              {cols.map(lead => (
                <div key={lead.id} onClick={() => onOpen(lead)}
                  style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', transition: 'border-color 0.1s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#444')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#222')}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e8e8e8', marginBottom: 3, lineHeight: 1.3 }}>{lead.name}</div>
                  {lead.company && <div style={{ fontSize: 10, color: '#555', marginBottom: 6 }}>{lead.company}</div>}
                  {lead.needs.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const, marginBottom: 8 }}>
                      {lead.needs.map(n => {
                        const sp = SPECIALTY_CONFIG[n]
                        return sp ? <Badge key={n} label={sp.label} color={sp.color} /> : null
                      })}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: '#444' }}>{ORIGIN_CFG[lead.origin]?.label}</div>
                    {lead.estimated_value ? <div style={{ fontSize: 11, fontWeight: 700, color: '#57FF9A' }}>{F(lead.estimated_value)}</div> : null}
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

// ─── Lista ─────────────────────────────────────────────────────────────────
function ListView({ leads, onOpen, quoteTotals, displayCur, tc }: { leads: Lead[]; onOpen: (l: Lead) => void; quoteTotals: Record<string, { cotizado: number; vendido: number; cotCurrency: string }>; displayCur: string; tc: number }) {
  if (leads.length === 0) return <EmptyState message="Sin leads en este filtro" />

  // Convert value to display currency
  // estimated_value is always MXN, cotizado/vendido are in USD (from quotes)
  function toDisplay(amount: number, fromCur: string): string {
    if (!amount) return '—'
    let converted = amount
    if (fromCur !== displayCur) {
      converted = fromCur === 'USD' ? amount * tc : amount / tc
    }
    const prefix = displayCur === 'USD' ? 'US$' : '$'
    return prefix + Math.round(converted).toLocaleString()
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>Lead / Proyecto</Th><Th>Arquitecto</Th><Th>Cliente Final</Th>
          <Th>Especialidades</Th><Th>Estatus</Th><Th right>Estimado</Th><Th right>Cotizado</Th><Th right>Vendido</Th>
        </tr>
      </thead>
      <tbody>
        {leads.map(lead => {
          const sCfg = STATUS_CFG[lead.status]
          const qt = quoteTotals[lead.id]
          // Extract client_final from notes JSON
          let clientFinal = ''
          try { const m = JSON.parse(lead.notes || '{}'); clientFinal = m.client_final || '' } catch {}
          return (
            <tr key={lead.id} onClick={() => onOpen(lead)} style={{ cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <Td>
                <div style={{ fontWeight: 600, color: '#e8e8e8' }}>{lead.name}</div>
              </Td>
              <Td muted>{lead.company || '—'}</Td>
              <Td><span style={{ color: clientFinal ? '#ccc' : '#333' }}>{clientFinal || '—'}</span></Td>
              <Td>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                  {lead.needs.map(n => { const sp = SPECIALTY_CONFIG[n]; return sp ? <Badge key={n} label={sp.label} color={sp.color} /> : null })}
                </div>
              </Td>
              <Td><Badge label={sCfg.label} color={sCfg.color} /></Td>
              <Td right><span style={{ fontWeight: 500, color: '#888' }}>{toDisplay(lead.estimated_value || 0, 'MXN')}</span></Td>
              <Td right><span style={{ fontWeight: 600, color: '#C084FC' }}>{qt?.cotizado ? toDisplay(qt.cotizado, qt.cotCurrency || 'USD') : '—'}</span></Td>
              <Td right><span style={{ fontWeight: 700, color: '#57FF9A' }}>{qt?.vendido ? toDisplay(qt.vendido, qt.cotCurrency || 'USD') : '—'}</span></Td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

// ─── CRM Principal ─────────────────────────────────────────────────────────
export default function CRM() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<Lead | null>(null)
  const [viewMode, setViewMode] = useState<'kanban' | 'lista'>('lista')
  const [filtroStatus, setFiltroStatus] = useState<LeadStatus | 'todos'>('todos')
  const [search, setSearch] = useState('')
  const [aiQuery, setAiQuery] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiFilter, setAiFilter] = useState<Partial<{ status: LeadStatus; origin: LeadOrigin; minValue: number; text: string }> | null>(null)
  const [quoteTotals, setQuoteTotals] = useState<Record<string, { cotizado: number; vendido: number; cotCurrency: string }>>({})
  const [displayCur, setDisplayCur] = useState<'USD' | 'MXN'>('MXN')
  const [tc, setTc] = useState(20.5)
  function load() {
    setLoading(true)
    Promise.all([
      supabase.from('leads').select('*').order('updated_at', { ascending: false }),
      supabase.from('quotations').select('id,client_name,stage,total,notes'),
    ]).then(([{ data: ld }, { data: qt }]) => {
      setLeads(ld || [])
      // Build totals per lead — match by lead_id in notes or by name
      const totals: Record<string, { cotizado: number; vendido: number; cotCurrency: string }> = {}
      if (ld && qt) {
        for (const lead of ld) {
          const leadQuotes = qt.filter(q => {
            try {
              const meta = JSON.parse(q.notes || '{}')
              if (meta.lead_id === lead.id) return true
            } catch {}
            return q.client_name && lead.name && q.client_name.toLowerCase().includes(lead.name.toLowerCase())
          })
          let cotizado = 0, vendido = 0
          leadQuotes.forEach(q => {
            cotizado += q.total || 0
            if (q.stage === 'contrato') vendido += q.total || 0
          })
          if (cotizado > 0 || vendido > 0) totals[lead.id] = { cotizado, vendido, cotCurrency: 'USD' }
        }
      }
      setQuoteTotals(totals)
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [])

  // Busqueda con AI
  async function buscarConAI() {
    if (!aiQuery.trim()) return
    setAiLoading(true)
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          system: `Eres un asistente de CRM para una empresa de instalaciones electricas y especiales (CCTV, audio, iluminacion, redes, acceso).
Analiza la consulta del usuario y devuelve SOLO un JSON con los filtros para buscar leads.
Campos disponibles: status (nuevo|contactado|diagnostico|cotizando|ganado|perdido|pausado), origin (inbound|outbound|referido|arquitecto|desarrolladora), minValue (numero), text (texto libre para buscar en nombre/empresa/notas).
Devuelve solo el JSON, sin explicaciones. Si no hay filtro para un campo, omitelo.`,
          messages: [{ role: 'user', content: aiQuery }]
        })
      })
      const data = await res.json()
      const txt = data.content?.[0]?.text || '{}'
      const clean = txt.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      setAiFilter(parsed)
    } catch (e) {
      console.error(e)
    }
    setAiLoading(false)
  }

  function clearAI() { setAiFilter(null); setAiQuery('') }

  // Filtros aplicados
  const filtered = leads.filter(l => {
    if (filtroStatus !== 'todos' && l.status !== filtroStatus) return false
    if (search) {
      const q = search.toLowerCase()
      if (!l.name.toLowerCase().includes(q) && !(l.company || '').toLowerCase().includes(q) && !(l.contact_name || '').toLowerCase().includes(q)) return false
    }
    if (aiFilter) {
      if (aiFilter.status && l.status !== aiFilter.status) return false
      if (aiFilter.origin && l.origin !== aiFilter.origin) return false
      if (aiFilter.minValue && (l.estimated_value || 0) < aiFilter.minValue) return false
      if (aiFilter.text) {
        const q = aiFilter.text.toLowerCase()
        if (!l.name.toLowerCase().includes(q) && !(l.company || '').toLowerCase().includes(q) && !(l.notes || '').toLowerCase().includes(q)) return false
      }
    }
    return true
  })

  const activePipeline = leads.filter(l => !['ganado', 'perdido', 'pausado'].includes(l.status))
  const pipelineValue = activePipeline.reduce((s, l) => s + (l.estimated_value || 0), 0)
  const ganados = leads.filter(l => l.status === 'ganado').length
  const perdidos = leads.filter(l => l.status === 'perdido').length
  const tasaCierre = (ganados + perdidos) > 0 ? Math.round(ganados / (ganados + perdidos) * 100) : 0

  return (
    <div style={{ padding: '24px 28px' }}>
      <SectionHeader
        title="CRM y Ventas"
        subtitle={`${leads.length} leads · ${activePipeline.length} en pipeline activo`}
        action={<Btn variant="primary" onClick={() => setShowNew(true)}><Plus size={14} /> Nuevo lead</Btn>}
      />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        {[
          { label: 'Pipeline activo', value: activePipeline.length.toString(), sub: F(pipelineValue), color: '#3B82F6' },
          { label: 'Ganados', value: ganados.toString(), sub: 'total historico', color: '#57FF9A' },
          { label: 'Perdidos', value: perdidos.toString(), sub: 'total historico', color: '#EF4444' },
          { label: 'Tasa de cierre', value: `${tasaCierre}%`, sub: `${ganados} de ${ganados + perdidos}`, color: '#C084FC' },
        ].map(k => (
          <div key={k.label} style={{ background: '#141414', border: '1px solid #1e1e1e', borderRadius: 10, padding: '12px 14px', borderTop: `2px solid ${k.color}` }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{k.value}</div>
            <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Currency toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', background: '#0e0e0e', borderRadius: 8, border: '1px solid #1e1e1e' }}>
        <span style={{ fontSize: 10, color: '#555', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Ver en:</span>
        {(['MXN', 'USD'] as const).map(cur => (
          <button key={cur} onClick={() => setDisplayCur(cur)} style={{
            padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            border: '1px solid ' + (displayCur === cur ? (cur === 'USD' ? '#06B6D4' : '#F59E0B') : '#333'),
            background: displayCur === cur ? (cur === 'USD' ? '#06B6D422' : '#F59E0B22') : 'transparent',
            color: displayCur === cur ? (cur === 'USD' ? '#06B6D4' : '#F59E0B') : '#555',
          }}>{cur === 'USD' ? '🇺🇸 USD' : '🇲🇽 MXN'}</button>
        ))}
        <span style={{ fontSize: 10, color: '#555', marginLeft: 8 }}>TC:</span>
        <input type="number" value={tc} step={0.1} onChange={e => setTc(parseFloat(e.target.value) || 20)}
          style={{ width: 55, padding: '3px 6px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} />
        <span style={{ fontSize: 10, color: '#444' }}>Estimados en MXN · Cotizados en USD</span>
      </div>

      {/* Busqueda normal + AI */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ position: 'relative' as const, flex: 1 }}>
          <Search size={14} style={{ position: 'absolute' as const, left: 10, top: '50%', transform: 'translateY(-50%)', color: '#555', pointerEvents: 'none' as const }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, empresa, contacto..."
            style={{ width: '100%', padding: '8px 10px 8px 32px', background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, color: '#ccc', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
        </div>
        <div style={{ display: 'flex', gap: 6, flex: 2 }}>
          <div style={{ position: 'relative' as const, flex: 1 }}>
            <Sparkles size={14} style={{ position: 'absolute' as const, left: 10, top: '50%', transform: 'translateY(-50%)', color: aiFilter ? '#57FF9A' : '#555', pointerEvents: 'none' as const }} />
            <input value={aiQuery} onChange={e => setAiQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && buscarConAI()}
              placeholder="Busqueda con AI: ej. 'leads de arquitectos con valor alto'"
              style={{ width: '100%', padding: '8px 10px 8px 32px', background: aiFilter ? '#0d1f14' : '#141414', border: `1px solid ${aiFilter ? '#57FF9A44' : '#2a2a2a'}`, borderRadius: 8, color: '#ccc', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
          </div>
          <Btn onClick={buscarConAI} disabled={aiLoading}>{aiLoading ? '...' : 'Buscar'}</Btn>
          {aiFilter && <Btn onClick={clearAI}>Limpiar AI</Btn>}
        </div>
      </div>

      {/* Filtros estatus + toggle vista */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' as const }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
          {(['todos', ...Object.keys(STATUS_CFG)] as (LeadStatus | 'todos')[]).map(k => {
            const v = k === 'todos' ? { label: 'Todos', color: '#57FF9A' } : STATUS_CFG[k as LeadStatus]
            const active = filtroStatus === k
            return (
              <button key={k} onClick={() => setFiltroStatus(k)} style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                fontWeight: active ? 600 : 400, border: `1px solid ${active ? v.color : '#2a2a2a'}`,
                background: active ? v.color + '18' : 'transparent', color: active ? v.color : '#555'
              }}>{v.label}</button>
            )
          })}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', border: '1px solid #2a2a2a', borderRadius: 8, overflow: 'hidden' }}>
          {(['kanban', 'lista'] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)} style={{
              padding: '5px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              background: viewMode === m ? '#57FF9A18' : 'transparent',
              color: viewMode === m ? '#57FF9A' : '#555', fontWeight: viewMode === m ? 600 : 400,
              border: 'none', borderRight: m === 'kanban' ? '1px solid #2a2a2a' : 'none'
            }}>{m === 'kanban' ? 'Kanban' : 'Lista'}</button>
          ))}
        </div>
        {(search || aiFilter) && (
          <div style={{ fontSize: 11, color: '#555' }}>{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</div>
        )}
      </div>

      {/* Contenido */}
      {loading ? <Loading /> : (
        viewMode === 'kanban'
          ? <KanbanView leads={filtered} onOpen={setSelected} />
          : <ListView leads={filtered} onOpen={setSelected} quoteTotals={quoteTotals} displayCur={displayCur} tc={tc} />
      )}

      {/* Seccion ganados/perdidos/pausados en kanban */}
      {viewMode === 'kanban' && filtroStatus === 'todos' && !loading && !search && !aiFilter && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 10, color: '#3a3a3a', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 10, display: 'flex', gap: 16 }}>
            {(['ganado', 'perdido', 'pausado'] as LeadStatus[]).map(s => {
              const c = STATUS_CFG[s]; const count = leads.filter(l => l.status === s).length
              return count > 0 ? <span key={s} style={{ color: c.color }}>{c.label}: {count}</span> : null
            })}
          </div>
          {leads.filter(l => ['ganado', 'perdido', 'pausado'].includes(l.status)).length > 0 && (
            <ListView leads={leads.filter(l => ['ganado', 'perdido', 'pausado'].includes(l.status))} onOpen={setSelected} quoteTotals={quoteTotals} displayCur={displayCur} tc={tc} />
          )}
        </div>
      )}

      {/* Modales */}
      {showNew && <NuevoLeadModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} />}
      {selected && (
        <LeadModal
          lead={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => { load(); setSelected(null) }}
          onDeleted={() => { load(); setSelected(null) }}
        />
      )}
    </div>
  )
                }
