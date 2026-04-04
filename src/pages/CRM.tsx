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
    name: '', company: '', contact_name: '', contact_phone: '', contact_email: '',
    origin: 'inbound' as LeadOrigin, needs: [] as ProjectLine[], notes: '', estimated_value: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const s = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))
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
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24, width: 560, maxHeight: '90vh', overflowY: 'auto' as const }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Nuevo lead</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4 }}><X size={18} /></button>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          <Field label="Nombre / Proyecto *" value={form.name} onChange={s('name')} placeholder="ej. Torre Reforma 222 — Lobby" />
          <Field label="Empresa / Cliente" value={form.company} onChange={s('company')} placeholder="ej. Grupo Desarrollador XYZ" />
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
  const [form, setForm] = useState({
    name: lead.name, company: lead.company || '',
    contact_name: lead.contact_name || '', contact_phone: lead.contact_phone || '',
    contact_email: lead.contact_email || '', origin: lead.origin, status: lead.status,
    needs: lead.needs || [] as ProjectLine[], notes: lead.notes || '',
    estimated_value: lead.estimated_value?.toString() || '', lost_reason: lead.lost_reason || '',
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
    await supabase.from('leads').update({
      name: form.name, company: form.company || null,
      contact_name: form.contact_name || null, contact_phone: form.contact_phone || null,
      contact_email: form.contact_email || null, origin: form.origin, status: form.status,
      needs: form.needs, notes: form.notes || null,
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
            <Field label="Empresa / Cliente" value={form.company} onChange={s('company')} />
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
function ListView({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  if (leads.length === 0) return <EmptyState message="Sin leads en este filtro" />
  return (
    <Table>
      <thead>
        <tr>
          <Th>Lead / Proyecto</Th><Th>Contacto</Th><Th>Origen</Th>
          <Th>Especialidades</Th><Th>Estatus</Th><Th right>Valor est.</Th>
        </tr>
      </thead>
      <tbody>
        {leads.map(lead => {
          const sCfg = STATUS_CFG[lead.status]
          return (
            <tr key={lead.id} onClick={() => onOpen(lead)} style={{ cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <Td>
                <div style={{ fontWeight: 600, color: '#e8e8e8' }}>{lead.name}</div>
                {lead.company && <div style={{ fontSize: 10, color: '#555' }}>{lead.company}</div>}
              </Td>
              <Td>
                <div style={{ fontSize: 12, color: '#aaa' }}>{lead.contact_name || '—'}</div>
                {lead.contact_phone && <div style={{ fontSize: 10, color: '#555' }}>{lead.contact_phone}</div>}
              </Td>
              <Td muted>{ORIGIN_CFG[lead.origin]?.label}</Td>
              <Td>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                  {lead.needs.map(n => { const sp = SPECIALTY_CONFIG[n]; return sp ? <Badge key={n} label={sp.label} color={sp.color} /> : null })}
                </div>
              </Td>
              <Td><Badge label={sCfg.label} color={sCfg.color} /></Td>
              <Td right>
                {lead.estimated_value
                  ? <span style={{ fontWeight: 700, color: '#57FF9A' }}>{F(lead.estimated_value)}</span>
                  : <span style={{ color: '#333' }}>—</span>}
              </Td>
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
  const [viewMode, setViewMode] = useState<'kanban' | 'lista'>('kanban')
  const [filtroStatus, setFiltroStatus] = useState<LeadStatus | 'todos'>('todos')
  const [search, setSearch] = useState('')
  const [aiQuery, setAiQuery] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiFilter, setAiFilter] = useState<Partial<{ status: LeadStatus; origin: LeadOrigin; minValue: number; text: string }> | null>(null)

  function load() {
    setLoading(true)
    supabase.from('leads').select('*').order('updated_at', { ascending: false })
      .then(({ data }) => { setLeads(data || []); setLoading(false) })
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
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
          : <ListView leads={filtered} onOpen={setSelected} />
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
            <ListView leads={leads.filter(l => ['ganado', 'perdido', 'pausado'].includes(l.status))} onOpen={setSelected} />
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
