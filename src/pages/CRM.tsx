import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Badge, Btn, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { useIsMobile } from '../lib/useIsMobile'
import { Plus, X, Search, Trash2, Save, Sparkles, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { SPECIALTY_CONFIG } from '../lib/utils'
import { ProjectLine } from '../types'
import { useAuth } from '../contexts/AuthContext'

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
  close_probability?: number  // 0-100, opcional; default por status si null
  commercial_year?: number    // año comercial editable; si null, se usa created_at
  expected_close_date?: string // fecha estimada de cierre — usada en Proyección de ventas
  lost_reason?: string
  priority: Priority
}

type Priority = 'alta' | 'media' | 'baja' | 'fria'

const STATUS_CFG: Record<LeadStatus, { label: string; color: string; order: number }> = {
  nuevo:       { label: 'Nuevo',       color: '#6B7280', order: 0 },
  contactado:  { label: 'Contactado',  color: '#2563EB', order: 1 },
  diagnostico: { label: 'Diagnostico', color: '#D97706', order: 2 },
  cotizando:   { label: 'Cotizando',   color: '#A78BFA', order: 3 },
  ganado:      { label: 'Ganado',      color: '#10B981', order: 4 },
  perdido:     { label: 'Perdido',     color: '#DC2626', order: 5 },
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
          const c = colorMap?.[key] || color || '#10B981'
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
  const isMobile = useIsMobile()
  const [form, setForm] = useState({
    name: '', company: '', client_final: '', client_id: '', contact_name: '', contact_phone: '', contact_email: '',
    origin: 'inbound' as LeadOrigin, needs: [] as ProjectLine[], notes: '', estimated_value: '',
    commercial_year: String(new Date().getFullYear()),
    expected_close_date: '', close_probability: '50',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [clientes, setClientes] = useState<Array<{ id: string; nombre_comercial: string; razon_social: string; rfc: string; regimen_fiscal: string; codigo_postal: string; uso_cfdi_clave: string; email: string }>>([])
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDrop, setShowClientDrop] = useState(false)
  const [showNewClient, setShowNewClient] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientRazon, setNewClientRazon] = useState('')
  const [newClientRfc, setNewClientRfc] = useState('')
  // Lista de arquitectos ya registrados (dedup por company de leads existentes).
  // Permite autocomplete para evitar duplicados tipo "Braverman" vs "Braverman Arq."
  const [architects, setArchitects] = useState<string[]>([])
  const [showArchitectDrop, setShowArchitectDrop] = useState(false)

  useEffect(() => {
    supabase.from('clientes').select('id,nombre_comercial,razon_social,rfc,regimen_fiscal,codigo_postal,uso_cfdi_clave,email').neq('activo', false).order('razon_social')
      .then(({ data }) => setClientes(data || []))
    // Cargar arquitectos únicos de leads existentes
    supabase.from('leads').select('company').not('company', 'is', null).then(({ data }) => {
      const unique = Array.from(new Set((data || []).map((l: any) => (l.company || '').trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
      setArchitects(unique)
    })
  }, [])

  const s = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))
  const toggleNeed = (n: ProjectLine) =>
    setForm(f => ({ ...f, needs: f.needs.includes(n) ? f.needs.filter(x => x !== n) : [...f.needs, n] }))

  const filteredClientes = clientSearch.length >= 1
    ? clientes.filter(c => (c.nombre_comercial || '').toLowerCase().includes(clientSearch.toLowerCase()) || c.razon_social.toLowerCase().includes(clientSearch.toLowerCase()) || c.rfc.toLowerCase().includes(clientSearch.toLowerCase())).slice(0, 10)
    : clientes.slice(0, 10)

  const selectedClient = form.client_id ? clientes.find(c => c.id === form.client_id) : null

  async function crearClienteInline() {
    if (!newClientName.trim()) return
    const { data } = await supabase.from('clientes').insert({
      nombre_comercial: newClientName.trim(), razon_social: newClientRazon.trim() || newClientName.trim(),
      rfc: newClientRfc.trim() || 'XAXX010101000',
      regimen_fiscal: '601', regimen_fiscal_clave: '601', codigo_postal: '00000',
      uso_cfdi: 'G03', uso_cfdi_clave: 'G03', tipo_persona: 'moral', activo: true,
    }).select().single()
    if (data) {
      setClientes(prev => [...prev, data])
      setForm(f => ({ ...f, client_final: data.nombre_comercial || data.razon_social, client_id: data.id }))
      setClientSearch(data.nombre_comercial || data.razon_social)
    }
    setShowNewClient(false); setNewClientName(''); setNewClientRazon(''); setNewClientRfc('')
  }

  async function crear() {
    if (!form.name.trim()) { setError('El nombre es requerido'); return }
    setSaving(true); setError('')
    const notesData = form.notes || ''
    const notesWithClient = (form.client_final || form.client_id) ? JSON.stringify({ client_final: form.client_final, client_id: form.client_id || '', text: notesData }) : notesData
    const { error: err } = await supabase.from('leads').insert({
      name: form.name.trim(), company: form.company || null,
      contact_name: form.contact_name || null, contact_phone: form.contact_phone || null,
      contact_email: form.contact_email || null, origin: form.origin, status: 'nuevo',
      needs: form.needs, notes: notesWithClient || null,
      estimated_value: parseFloat(form.estimated_value) || null,
      commercial_year: form.commercial_year ? parseInt(form.commercial_year, 10) || null : null,
      expected_close_date: form.expected_close_date || null,
      close_probability: form.close_probability ? Math.max(0, Math.min(100, parseInt(form.close_probability, 10))) : null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: isMobile ? 0 : 16, padding: isMobile ? 16 : 24, width: isMobile ? '100vw' : 560, maxHeight: isMobile ? '100vh' : '90vh', overflowY: 'auto' as const }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Nuevo lead</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4 }}><X size={18} /></button>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          <Field label="Nombre / Proyecto *" value={form.name} onChange={s('name')} placeholder="ej. Casa Salame" />

          {/* Arquitecto / Despacho — autocompletado para evitar duplicados */}
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
            Arquitecto / Despacho
            <div style={{ position: 'relative' as const, marginTop: 4 }}>
              <input value={form.company}
                onChange={e => s('company')(e.target.value)}
                onFocus={() => setShowArchitectDrop(true)}
                onBlur={() => setTimeout(() => setShowArchitectDrop(false), 200)}
                placeholder="Empieza a escribir... (se autocompleta con arquitectos existentes)"
                style={{ width: '100%', padding: '8px 10px', background: '#1e1e1e', border: '1px solid ' + (showArchitectDrop ? '#10B981' : '#333'), borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
              {showArchitectDrop && (() => {
                const q = (form.company || '').toLowerCase().trim()
                const filtered = q
                  ? architects.filter(a => a.toLowerCase().includes(q)).slice(0, 12)
                  : architects.slice(0, 12)
                const hasExactMatch = q && architects.some(a => a.toLowerCase() === q)
                return (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, marginTop: 2, maxHeight: 240, overflowY: 'auto', zIndex: 10 }}>
                    {filtered.map(a => (
                      <div key={a}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { s('company')(a); setShowArchitectDrop(false) }}
                        style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 12, color: '#ccc', borderBottom: '1px solid #222' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#222' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                        {a}
                      </div>
                    ))}
                    {q && !hasExactMatch && (
                      <div style={{ padding: '8px 10px', fontSize: 11, color: '#10B981', borderTop: '1px solid #222', background: 'rgba(87,255,154,0.05)' }}>
                        ⏎ Se va a crear "<strong style={{ color: '#fff' }}>{form.company}</strong>" como arquitecto nuevo
                      </div>
                    )}
                    {filtered.length === 0 && !q && (
                      <div style={{ padding: 10, fontSize: 11, color: '#555', textAlign: 'center' }}>No hay arquitectos registrados todavía</div>
                    )}
                  </div>
                )
              })()}
            </div>
          </label>

          {/* Cliente Final (quien paga/factura) with dropdown */}
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
            Cliente Final (quien paga / factura)
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <div style={{ position: 'relative' as const, flex: 1 }}>
                <input value={clientSearch} onChange={e => { setClientSearch(e.target.value); setForm(f => ({ ...f, client_final: e.target.value, client_id: '' })) }}
                  onFocus={() => setShowClientDrop(true)}
                  onBlur={() => setTimeout(() => setShowClientDrop(false), 200)}
                  placeholder="Buscar por nombre comercial..."
                  style={{ width: '100%', padding: '8px 10px', background: '#1e1e1e', border: '1px solid ' + (showClientDrop ? '#10B981' : '#333'), borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
                {showClientDrop && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, marginTop: 2, maxHeight: 220, overflowY: 'auto', zIndex: 10 }}>
                    {filteredClientes.length === 0 ? (
                      <div style={{ padding: '10px', fontSize: 11, color: '#555', textAlign: 'center' }}>Sin resultados — usa "+ Nuevo" para crear</div>
                    ) : filteredClientes.map(c => (
                      <div key={c.id} onMouseDown={e => e.preventDefault()}
                        onClick={() => { setForm(f => ({ ...f, client_final: c.nombre_comercial || c.razon_social, client_id: c.id })); setClientSearch(c.nombre_comercial || c.razon_social); setShowClientDrop(false) }}
                        style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 12, color: '#ccc', borderBottom: '1px solid #222' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#222' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                        <div style={{ fontWeight: 600, color: '#10B981' }}>{c.nombre_comercial || c.razon_social}</div>
                        <div style={{ fontSize: 10, color: '#777' }}>{c.razon_social} · {c.rfc}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Btn size="sm" onClick={() => setShowNewClient(true)}>+ Nuevo</Btn>
            </div>
            {showNewClient && (
              <div style={{ marginTop: 8, padding: 10, background: '#0e0e0e', border: '1px solid #222', borderRadius: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 8 }}>
                  <input value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="Nombre comercial"
                    style={{ padding: '6px 8px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit' }} />
                  <input value={newClientRazon} onChange={e => setNewClientRazon(e.target.value)} placeholder="Razón social"
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
            {selectedClient && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#0e1a0e', border: '1px solid #1a3a1a', borderRadius: 8, fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ color: '#10B981', fontWeight: 600 }}>Datos de facturación</span>
                  <button onClick={() => { setForm(f => ({ ...f, client_final: '', client_id: '' })); setClientSearch('') }}
                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 10 }}>✕ Desvincular</button>
                </div>
                <div style={{ color: '#aaa', lineHeight: 1.6 }}>
                  <div><span style={{ color: '#555' }}>Razón Social:</span> {selectedClient.razon_social}</div>
                  <div><span style={{ color: '#555' }}>RFC:</span> <span style={{ fontFamily: 'monospace' }}>{selectedClient.rfc}</span></div>
                  <div><span style={{ color: '#555' }}>Régimen:</span> {selectedClient.regimen_fiscal || '—'}</div>
                  <div><span style={{ color: '#555' }}>C.P.:</span> {selectedClient.codigo_postal || '—'} &nbsp; <span style={{ color: '#555' }}>CFDI:</span> {selectedClient.uso_cfdi_clave || '—'} &nbsp; <span style={{ color: '#555' }}>Email:</span> {selectedClient.email || '—'}</div>
                </div>
              </div>
            )}
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Field label="Contacto" value={form.contact_name} onChange={s('contact_name')} />
            <Field label="Telefono" value={form.contact_phone} onChange={s('contact_phone')} placeholder="+52 55..." />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Field label="Email" value={form.contact_email} onChange={s('contact_email')} placeholder="correo@ejemplo.com" />
            <Field label="Valor estimado (MXN)" value={form.estimated_value} onChange={s('estimated_value')} type="number" placeholder="0" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Field label="Año comercial" value={form.commercial_year} onChange={s('commercial_year')} type="number" placeholder={`${new Date().getFullYear()}`} />
            <Field label="Probabilidad cierre (%)" value={form.close_probability} onChange={s('close_probability')} type="number" placeholder="50" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Field label="Cierre estimado" value={form.expected_close_date} onChange={s('expected_close_date')} type="date" />
            <div />
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
        {error && <div style={{ color: '#DC2626', fontSize: 12, marginTop: 10 }}>{error}</div>}
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
  const isMobile = useIsMobile()
  const [form, setForm] = useState(() => {
    let client_final = '', client_id = ''
    try { const m = JSON.parse(lead.notes || '{}'); client_final = m.client_final || ''; client_id = m.client_id || '' } catch {}
    return {
      name: lead.name, company: lead.company || '', client_final, client_id,
      contact_name: lead.contact_name || '', contact_phone: lead.contact_phone || '',
      contact_email: lead.contact_email || '', origin: lead.origin, status: lead.status,
      needs: lead.needs || [] as ProjectLine[], notes: lead.notes || '',
      estimated_value: lead.estimated_value?.toString() || '', lost_reason: lead.lost_reason || '',
      commercial_year: lead.commercial_year?.toString() || '',
      expected_close_date: lead.expected_close_date || '',
      close_probability: lead.close_probability?.toString() || '',
      priority: lead.priority || 'media' as Priority,
    }
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [clientes, setClientes] = useState<Array<{ id: string; nombre_comercial: string; razon_social: string; rfc: string; regimen_fiscal: string; codigo_postal: string; uso_cfdi_clave: string; email: string }>>([])
  const [clientSearch, setClientSearch] = useState(form.client_final || '')
  const [showClientDrop, setShowClientDrop] = useState(false)
  const [showNewClient, setShowNewClient] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientRazon, setNewClientRazon] = useState('')
  const [newClientRfc, setNewClientRfc] = useState('')
  // Autocomplete de arquitectos (mismo patrón que NuevoLeadModal)
  const [architects, setArchitects] = useState<string[]>([])
  const [showArchitectDrop, setShowArchitectDrop] = useState(false)

  useEffect(() => {
    supabase.from('clientes').select('id,nombre_comercial,razon_social,rfc,regimen_fiscal,codigo_postal,uso_cfdi_clave,email').neq('activo', false).order('razon_social')
      .then(({ data }) => setClientes(data || []))
    supabase.from('leads').select('company').not('company', 'is', null).then(({ data }) => {
      const unique = Array.from(new Set((data || []).map((l: any) => (l.company || '').trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
      setArchitects(unique)
    })
  }, [])

  const filteredClientes = clientSearch.length >= 1
    ? clientes.filter(c => (c.nombre_comercial || '').toLowerCase().includes(clientSearch.toLowerCase()) || c.razon_social.toLowerCase().includes(clientSearch.toLowerCase()) || c.rfc.toLowerCase().includes(clientSearch.toLowerCase())).slice(0, 10)
    : clientes.slice(0, 10)

  const selectedClient = form.client_id ? clientes.find(c => c.id === form.client_id) : null

  async function crearClienteInline() {
    if (!newClientName.trim()) return
    const { data } = await supabase.from('clientes').insert({
      nombre_comercial: newClientName.trim(), razon_social: newClientRazon.trim() || newClientName.trim(),
      rfc: newClientRfc.trim() || 'XAXX010101000',
      regimen_fiscal: '601', regimen_fiscal_clave: '601', codigo_postal: '00000',
      uso_cfdi: 'G03', uso_cfdi_clave: 'G03', tipo_persona: 'moral', activo: true,
    }).select().single()
    if (data) {
      setClientes(prev => [...prev, data])
      setForm(f => ({ ...f, client_final: data.nombre_comercial || data.razon_social, client_id: data.id }))
      setClientSearch(data.nombre_comercial || data.razon_social)
      setDirty(true)
    }
    setShowNewClient(false); setNewClientName(''); setNewClientRazon(''); setNewClientRfc('')
  }

  const s = (k: string) => (v: string) => { setForm(f => ({ ...f, [k]: v })); setDirty(true) }
  const toggleNeed = (n: ProjectLine) => {
    setForm(f => ({ ...f, needs: f.needs.includes(n) ? f.needs.filter(x => x !== n) : [...f.needs, n] }))
    setDirty(true)
  }
  const setStatus = (st: LeadStatus) => { setForm(f => ({ ...f, status: st })); setDirty(true) }

  async function guardar() {
    setSaving(true)
    // Merge client_final + client_id into notes
    let notesValue = form.notes || ''
    try {
      const existing = JSON.parse(notesValue || '{}')
      if (form.client_final) existing.client_final = form.client_final
      if (form.client_id) existing.client_id = form.client_id
      notesValue = JSON.stringify(existing)
    } catch {
      notesValue = JSON.stringify({ client_final: form.client_final || '', client_id: form.client_id || '', text: notesValue })
    }
    await supabase.from('leads').update({
      name: form.name, company: form.company || null,
      contact_name: form.contact_name || null, contact_phone: form.contact_phone || null,
      contact_email: form.contact_email || null, origin: form.origin, status: form.status,
      needs: form.needs, notes: notesValue || null,
      estimated_value: parseFloat(form.estimated_value) || null,
      commercial_year: form.commercial_year ? parseInt(form.commercial_year, 10) || null : null,
      expected_close_date: form.expected_close_date || null,
      close_probability: form.close_probability !== '' ? Math.max(0, Math.min(100, parseInt(form.close_probability, 10) || 0)) : null,
      lost_reason: form.lost_reason || null, priority: form.priority,
      updated_at: new Date().toISOString(),
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
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: isMobile ? 0 : 16, width: isMobile ? '100vw' : 640, height: isMobile ? '100vh' : 'auto', maxHeight: isMobile ? '100vh' : '92vh', display: 'flex', flexDirection: 'column' as const }}>

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

        {/* Estatus + Prioridad rapido */}
        <div style={{ padding: '10px 22px', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: 16, flexWrap: 'wrap' as const, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#444', textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 600 }}>Estatus</span>
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
          <div style={{ width: 1, height: 20, background: '#222' }} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#444', textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 600 }}>Prioridad</span>
            {(Object.entries(PRIORITY_CFG) as [Priority, typeof PRIORITY_CFG[Priority]][]).map(([k, v]) => (
              <button key={k} onClick={() => { setForm(f => ({ ...f, priority: k })); setDirty(true) }} style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                fontWeight: form.priority === k ? 700 : 400,
                border: `1px solid ${form.priority === k ? v.color : '#2a2a2a'}`,
                background: form.priority === k ? v.color + '25' : 'transparent',
                color: form.priority === k ? v.color : '#555',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: form.priority === k ? v.color : '#333' }} />
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto' as const, padding: '18px 22px' }}>
          <div style={{ display: 'grid', gap: 14 }}>
            <Field label="Nombre / Proyecto" value={form.name} onChange={s('name')} />
            {/* Arquitecto / Despacho — autocompletado contra arquitectos existentes */}
            <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
              Arquitecto / Despacho
              <div style={{ position: 'relative' as const, marginTop: 4 }}>
                <input value={form.company}
                  onChange={e => s('company')(e.target.value)}
                  onFocus={() => setShowArchitectDrop(true)}
                  onBlur={() => setTimeout(() => setShowArchitectDrop(false), 200)}
                  placeholder="Empieza a escribir... (autocomplete contra arquitectos existentes)"
                  style={{ width: '100%', padding: '8px 10px', background: '#1e1e1e', border: '1px solid ' + (showArchitectDrop ? '#10B981' : '#333'), borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
                {showArchitectDrop && (() => {
                  const q = (form.company || '').toLowerCase().trim()
                  const filtered = q
                    ? architects.filter(a => a.toLowerCase().includes(q)).slice(0, 12)
                    : architects.slice(0, 12)
                  const hasExactMatch = q && architects.some(a => a.toLowerCase() === q)
                  return (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, marginTop: 2, maxHeight: 240, overflowY: 'auto', zIndex: 10 }}>
                      {filtered.map(a => (
                        <div key={a}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { s('company')(a); setShowArchitectDrop(false) }}
                          style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 12, color: '#ccc', borderBottom: '1px solid #222' }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#222' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                          {a}
                        </div>
                      ))}
                      {q && !hasExactMatch && (
                        <div style={{ padding: '8px 10px', fontSize: 11, color: '#10B981', borderTop: '1px solid #222', background: 'rgba(87,255,154,0.05)' }}>
                          ⏎ Se va a guardar como arquitecto nuevo: "<strong style={{ color: '#fff' }}>{form.company}</strong>"
                        </div>
                      )}
                      {filtered.length === 0 && !q && (
                        <div style={{ padding: 10, fontSize: 11, color: '#555', textAlign: 'center' }}>No hay arquitectos registrados</div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </label>
            {/* Cliente Final (quien paga/factura) with dropdown */}
            <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
              Cliente Final (quien paga / factura)
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <div style={{ position: 'relative' as const, flex: 1 }}>
                  <input value={clientSearch} onChange={e => { setClientSearch(e.target.value); setForm(f => ({ ...f, client_final: e.target.value, client_id: '' })); setDirty(true) }}
                    onFocus={() => setShowClientDrop(true)}
                    onBlur={() => setTimeout(() => setShowClientDrop(false), 200)}
                    placeholder="Buscar por nombre comercial..."
                    style={{ width: '100%', padding: '8px 10px', background: '#1e1e1e', border: '1px solid ' + (showClientDrop ? '#10B981' : '#333'), borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
                  {showClientDrop && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, marginTop: 2, maxHeight: 220, overflowY: 'auto', zIndex: 10 }}>
                      {filteredClientes.length === 0 ? (
                        <div style={{ padding: '10px', fontSize: 11, color: '#555', textAlign: 'center' }}>Sin resultados — usa "+ Nuevo" para crear</div>
                      ) : filteredClientes.map(c => (
                        <div key={c.id} onMouseDown={e => e.preventDefault()}
                          onClick={() => { setForm(f => ({ ...f, client_final: c.nombre_comercial || c.razon_social, client_id: c.id })); setClientSearch(c.nombre_comercial || c.razon_social); setShowClientDrop(false); setDirty(true) }}
                          style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 12, color: '#ccc', borderBottom: '1px solid #222' }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#222' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                          <div style={{ fontWeight: 600, color: '#10B981' }}>{c.nombre_comercial || c.razon_social}</div>
                          <div style={{ fontSize: 10, color: '#777' }}>{c.razon_social} · {c.rfc}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <Btn size="sm" onClick={() => setShowNewClient(true)}>+ Nuevo</Btn>
              </div>
              {showNewClient && (
                <div style={{ marginTop: 8, padding: 10, background: '#0e0e0e', border: '1px solid #222', borderRadius: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 8 }}>
                    <input value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="Nombre comercial"
                      style={{ padding: '6px 8px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit' }} />
                    <input value={newClientRazon} onChange={e => setNewClientRazon(e.target.value)} placeholder="Razón social"
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
              {selectedClient && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: '#0e1a0e', border: '1px solid #1a3a1a', borderRadius: 8, fontSize: 11 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ color: '#10B981', fontWeight: 600 }}>Datos de facturación</span>
                    <button onClick={() => { setForm(f => ({ ...f, client_final: '', client_id: '' })); setClientSearch(''); setDirty(true) }}
                      style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 10 }}>✕ Desvincular</button>
                  </div>
                  <div style={{ color: '#aaa', lineHeight: 1.6 }}>
                    <div><span style={{ color: '#555' }}>Razón Social:</span> {selectedClient.razon_social}</div>
                    <div><span style={{ color: '#555' }}>RFC:</span> <span style={{ fontFamily: 'monospace' }}>{selectedClient.rfc}</span></div>
                    <div><span style={{ color: '#555' }}>Régimen:</span> {selectedClient.regimen_fiscal || '—'}</div>
                    <div><span style={{ color: '#555' }}>C.P.:</span> {selectedClient.codigo_postal || '—'} &nbsp; <span style={{ color: '#555' }}>CFDI:</span> {selectedClient.uso_cfdi_clave || '—'} &nbsp; <span style={{ color: '#555' }}>Email:</span> {selectedClient.email || '—'}</div>
                  </div>
                </div>
              )}
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
              <Field label="Contacto" value={form.contact_name} onChange={s('contact_name')} />
              <Field label="Telefono" value={form.contact_phone} onChange={s('contact_phone')} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
              <Field label="Email" value={form.contact_email} onChange={s('contact_email')} />
              <Field label="Valor estimado (MXN)" value={form.estimated_value} onChange={s('estimated_value')} type="number" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
              <Field label="Año comercial" value={form.commercial_year} onChange={s('commercial_year')} type="number" placeholder={`${new Date().getFullYear()} (default: año de creación)`} />
              <Field label="Probabilidad de cierre (%)" value={form.close_probability} onChange={s('close_probability')} type="number" placeholder="0-100" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
              <Field label="Cierre estimado" value={form.expected_close_date} onChange={s('expected_close_date')} type="date" />
              <div />
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
              <span style={{ fontSize: 12, color: '#DC2626' }}>Eliminar este lead?</span>
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
  const isMobile = useIsMobile()
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap: 12 }}>
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
                    {lead.estimated_value ? <div style={{ fontSize: 11, fontWeight: 700, color: '#10B981' }}>{F(lead.estimated_value)}</div> : null}
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

// ─── Prioridad manual ─────────────────────────────────────────────────────
const PRIORITY_CFG: Record<Priority, { label: string; color: string; order: number }> = {
  alta:  { label: 'Alta',  color: '#DC2626', order: 0 },
  media: { label: 'Media', color: '#D97706', order: 1 },
  baja:  { label: 'Baja',  color: '#2563EB', order: 2 },
  fria:  { label: 'Fría',  color: '#4B5563', order: 3 },
}
const PRIORITY_CYCLE: Priority[] = ['alta', 'media', 'baja', 'fria']

// ─── Sortable header ──────────────────────────────────────────────────────
type SortKey = 'name' | 'company' | 'status' | 'estimated' | 'cotizado' | 'vendido' | 'cobrado' | 'por_cobrar' | 'priority'
type SortDir = 'asc' | 'desc'

function SortTh({ label, sortKey, currentKey, currentDir, onSort, right: isRight }: {
  label: string; sortKey: SortKey; currentKey: SortKey | null; currentDir: SortDir; onSort: (k: SortKey) => void; right?: boolean
}) {
  const active = currentKey === sortKey
  return (
    <Th right={isRight}>
      <button onClick={() => onSort(sortKey)} style={{
        background: 'none', border: 'none', color: active ? '#10B981' : '#666',
        cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 600,
        textTransform: 'uppercase' as const, letterSpacing: '0.06em', padding: 0,
        display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' as const,
      }}>
        {label}
        {active ? (currentDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} style={{ opacity: 0.3 }} />}
      </button>
    </Th>
  )
}

// ─── Lista ─────────────────────────────────────────────────────────────────
function ListView({ leads, onOpen, onEdit, onPriorityChange, onProbabilityChange, quoteTotals, cobrosByLead, displayCur, tc }: {
  leads: Lead[]; onOpen: (l: Lead) => void; onEdit: (l: Lead) => void; onPriorityChange: (id: string, p: Priority) => void
  onProbabilityChange: (id: string, prob: number | null) => void
  quoteTotals: Record<string, { cotizadoUSD: number; cotizadoMXN: number; vendidoUSD: number; vendidoMXN: number }>
  cobrosByLead: Record<string, number>  // suma de cobros por lead (en MXN)
  displayCur: string; tc: number
}) {
  const isMobile = useIsMobile()
  const [sortKey, setSortKey] = useState<SortKey | null>('priority')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  if (leads.length === 0) return <EmptyState message="Sin leads en este filtro" />

  function toDisplay(amount: number, fromCur: string): string {
    if (!amount) return '—'
    let converted = amount
    if (fromCur !== displayCur) {
      converted = fromCur === 'USD' ? amount * tc : amount / tc
    }
    const prefix = displayCur === 'USD' ? 'US$' : '$'
    return prefix + Math.round(converted).toLocaleString()
  }
  // Convierte un total mixto (suma USD + suma MXN) a la moneda de display.
  // Solo el monto en moneda distinta se multiplica/divide por tc.
  function mixedToDisplay(usd: number, mxn: number): string {
    const total = displayCur === 'USD' ? (usd + mxn / tc) : (usd * tc + mxn)
    if (!total) return '—'
    const prefix = displayCur === 'USD' ? 'US$' : '$'
    return prefix + Math.round(total).toLocaleString()
  }
  // Mismo conversion pero devuelve el numero (para sorting)
  function mixedToNumber(usd: number, mxn: number): number {
    return displayCur === 'USD' ? (usd + mxn / tc) : (usd * tc + mxn)
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'estimated' || key === 'cotizado' || key === 'vendido' || key === 'cobrado' || key === 'por_cobrar' ? 'desc' : 'asc') }
  }

  const sorted = [...leads].sort((a, b) => {
    if (!sortKey) return 0
    const dir = sortDir === 'asc' ? 1 : -1
    switch (sortKey) {
      case 'name': return dir * a.name.localeCompare(b.name)
      case 'company': return dir * (a.company || '').localeCompare(b.company || '')
      case 'status': return dir * ((STATUS_CFG[a.status]?.order || 0) - (STATUS_CFG[b.status]?.order || 0))
      case 'estimated': return dir * ((a.estimated_value || 0) - (b.estimated_value || 0))
      case 'cotizado': {
        const aQt = quoteTotals[a.id], bQt = quoteTotals[b.id]
        const aTot = aQt ? mixedToNumber(aQt.cotizadoUSD, aQt.cotizadoMXN) : 0
        const bTot = bQt ? mixedToNumber(bQt.cotizadoUSD, bQt.cotizadoMXN) : 0
        return dir * (aTot - bTot)
      }
      case 'vendido': {
        const aQt = quoteTotals[a.id], bQt = quoteTotals[b.id]
        const aTot = aQt ? mixedToNumber(aQt.vendidoUSD, aQt.vendidoMXN) : 0
        const bTot = bQt ? mixedToNumber(bQt.vendidoUSD, bQt.vendidoMXN) : 0
        return dir * (aTot - bTot)
      }
      case 'cobrado': {
        const aC = cobrosByLead[a.id] || 0
        const bC = cobrosByLead[b.id] || 0
        return dir * (aC - bC)
      }
      case 'por_cobrar': {
        // Por cobrar = Vendido (en MXN) - Cobrado (MXN). Si vendido es 0, por_cobrar = 0.
        const aQt = quoteTotals[a.id], bQt = quoteTotals[b.id]
        const aVendidoMXN = aQt ? mixedToNumber(aQt.vendidoUSD, aQt.vendidoMXN) : 0
        const bVendidoMXN = bQt ? mixedToNumber(bQt.vendidoUSD, bQt.vendidoMXN) : 0
        const aPC = Math.max(0, aVendidoMXN - (cobrosByLead[a.id] || 0))
        const bPC = Math.max(0, bVendidoMXN - (cobrosByLead[b.id] || 0))
        return dir * (aPC - bPC)
      }
      case 'priority': {
        const pa = PRIORITY_CFG[a.priority || 'media'].order
        const pb = PRIORITY_CFG[b.priority || 'media'].order
        return dir * (pa - pb)
      }
      default: return 0
    }
  })

  return (
    <div style={{ overflowX: 'auto' }}>
      <Table>
        <thead>
          <tr>
          <SortTh label="Prioridad" sortKey="priority" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
          <SortTh label="Lead / Proyecto" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
          <SortTh label="Arquitecto" sortKey="company" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
          <Th>Cliente Final</Th>
          <Th>Especialidades</Th>
          <SortTh label="Estatus" sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
          <SortTh label="Estimado" sortKey="estimated" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} right />
          <Th right>Prob. Cierre</Th>
          <SortTh label="Cotizado" sortKey="cotizado" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} right />
          <SortTh label="Vendido" sortKey="vendido" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} right />
          <SortTh label="Cobrado" sortKey="cobrado" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} right />
          <SortTh label="Por cobrar" sortKey="por_cobrar" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} right />
          <Th>{' '}</Th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(lead => {
          const sCfg = STATUS_CFG[lead.status]
          const qt = quoteTotals[lead.id]
          const pCfg = PRIORITY_CFG[lead.priority || 'media']
          let clientFinal = ''
          try { const m = JSON.parse(lead.notes || '{}'); clientFinal = m.client_final || '' } catch {}
          return (
            <tr key={lead.id} onClick={() => onOpen(lead)} style={{ cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <Td>
                <button
                  onClick={e => { e.stopPropagation(); const cur = lead.priority || 'media'; const idx = PRIORITY_CYCLE.indexOf(cur); const next = PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length]; onPriorityChange(lead.id, next) }}
                  title="Click para cambiar prioridad"
                  style={{ background: pCfg.color + '18', border: `1px solid ${pCfg.color}55`, borderRadius: 12, padding: '3px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: pCfg.color }} />
                  <span style={{ fontSize: 10, color: pCfg.color, fontWeight: 600 }}>{pCfg.label}</span>
                </button>
              </Td>
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
              <Td right>
                <input
                  key={`prob-${lead.id}-${lead.close_probability ?? ''}`}
                  type="number"
                  min={0} max={100} step={5}
                  defaultValue={lead.close_probability ?? ''}
                  placeholder="—"
                  onClick={e => e.stopPropagation()}
                  onBlur={e => {
                    const raw = e.target.value.trim()
                    const val = raw === '' ? null : Math.max(0, Math.min(100, parseInt(raw) || 0))
                    if (val !== (lead.close_probability ?? null)) onProbabilityChange(lead.id, val)
                  }}
                  style={{
                    width: 50, padding: '3px 6px', textAlign: 'right',
                    background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4,
                    color: (lead.close_probability ?? 0) >= 70 ? '#10B981' : (lead.close_probability ?? 0) >= 40 ? '#D97706' : (lead.close_probability != null ? '#DC2626' : '#666'),
                    fontWeight: 700, fontSize: 11, fontFamily: 'inherit',
                  }}
                />
                <span style={{ fontSize: 10, color: '#555', marginLeft: 2 }}>%</span>
              </Td>
              <Td right><span style={{ fontWeight: 600, color: '#A78BFA' }}>{qt ? mixedToDisplay(qt.cotizadoUSD, qt.cotizadoMXN) : '—'}</span></Td>
              <Td right><span style={{ fontWeight: 700, color: '#10B981' }}>{qt ? mixedToDisplay(qt.vendidoUSD, qt.vendidoMXN) : '—'}</span></Td>
              <Td right><span style={{ fontWeight: 700, color: '#22c55e' }}>{cobrosByLead[lead.id] ? toDisplay(cobrosByLead[lead.id], 'MXN') : '—'}</span></Td>
              <Td right>{(() => {
                const vendidoMXN = qt ? mixedToNumber(qt.vendidoUSD, qt.vendidoMXN) : 0
                const porCobrar = Math.max(0, vendidoMXN - (cobrosByLead[lead.id] || 0))
                if (vendidoMXN <= 0) return <span style={{ color: '#444' }}>—</span>
                if (porCobrar <= 0.01) return <span style={{ color: '#10B981', fontWeight: 700 }}>✓</span>
                return <span style={{ fontWeight: 700, color: '#D97706' }}>{toDisplay(porCobrar, 'MXN')}</span>
              })()}</Td>
              <Td>
                <button onClick={e => { e.stopPropagation(); onEdit(lead) }} title="Editar lead"
                  style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: '#555', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10 }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#10B981'; e.currentTarget.style.color = '#10B981' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#555' }}>
                  <Save size={10} /> Editar
                </button>
              </Td>
            </tr>
          )
        })}
        </tbody>
      </Table>
    </div>
  )
}

// ─── CRM Principal ─────────────────────────────────────────────────────────
export default function CRM() {
  const isMobile = useIsMobile()
  const nav = useNavigate()
  const { user } = useAuth()
  // Solo los usuarios DG (Dirección General) ven los KPIs financieros agregados
  const showFinancialKPIs = user?.permission_area === 'DG'
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
  // Totales separados por moneda — cada cotización puede estar en USD o MXN,
  // sumarlas requiere conocer la moneda nativa de cada una. La conversión a la
  // moneda de display se hace al render con el tipo de cambio actual.
  const [quoteTotals, setQuoteTotals] = useState<Record<string, { cotizadoUSD: number; cotizadoMXN: number; vendidoUSD: number; vendidoMXN: number }>>({})
  const [displayCur, setDisplayCur] = useState<'USD' | 'MXN'>('MXN')
  const [tc, setTc] = useState(18)
  const [filterYear, setFilterYear] = useState<number | 'todos'>(new Date().getFullYear())
  // Mapeo de cobros por lead (suma de cash_movements tipo cobro_cliente)
  const [cobrosByLead, setCobrosByLead] = useState<Record<string, number>>({})
  // Cobros globales por año (para cuando no podemos linkear a un lead específico)
  const [cobrosTotalByYear, setCobrosTotalByYear] = useState<Record<number, number>>({})
  // Vendido/Cotizado por AÑO DE CIERRE de cada cotización (eje independiente de la fecha de cobro)
  const [vendidoByYear, setVendidoByYear] = useState<Record<number, { usd: number; mxn: number }>>({})
  const [cotizadoByYear, setCotizadoByYear] = useState<Record<number, { usd: number; mxn: number }>>({})
  // Cobrado del año partido en cierres de este año (nuevo) vs años anteriores (arrastre/finiquitos)
  const [cobradoVintage, setCobradoVintage] = useState<Record<number, { nuevo: number; arrastre: number }>>({})
  // Paginado: Supabase corta a 1000 filas por request. bank_movements ya pasa de 1000,
  // así que hay que traer todas las páginas o se pierden cobros (abonos) y bajan los KPIs.
  async function fetchAllRows(table: string, sel: string): Promise<any[]> {
    const PAGE = 1000; let from = 0; let all: any[] = []
    while (true) {
      const { data, error } = await supabase.from(table).select(sel).range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      all = all.concat(data)
      if (data.length < PAGE) break
      from += PAGE
    }
    return all
  }
  async function load() {
    setLoading(true)
    // Estas 3 tablas pueden exceder 1000 filas → paginar (bank_movements + facturas + links)
    const [bm, fc, cl] = await Promise.all([
      fetchAllRows('bank_movements', 'id, lead_id, quotation_id, monto, fecha, tipo, moneda, categoria'),
      fetchAllRows('facturas', 'id, lead_id, quotation_id, cotizacion_id'),
      fetchAllRows('conciliacion_links', 'bank_movement_id, invoice_id, monto_aplicado'),
    ])
    Promise.all([
      supabase.from('leads').select('*').order('updated_at', { ascending: false }),
      supabase.from('quotations').select('id,client_name,stage,total,notes,specialty,version_group_id,version_label,updated_at,created_at,commercial_year'),
      supabase.from('cash_movements').select('lead_id, quotation_id, monto, fecha, tipo, direccion'),
      supabase.from('payment_allocations').select('quotation_id, monto, monto_origen, moneda_origen, bank_movement_id'),
    ]).then(([{ data: ld }, { data: qt }, { data: cm }, { data: pa }]) => {
      // Map quotation_id → lead_id (desde notes JSON) para resolver cascada
      const quotToLead = new Map<string, string>()
      ;(qt || []).forEach((q: any) => {
        try {
          const meta = JSON.parse(q.notes || '{}')
          if (meta.lead_id) quotToLead.set(q.id, meta.lead_id)
        } catch {}
      })
      // Resolver lead via factura → quotation → lead, o factura.lead_id directo
      const resolveLeadForInvoice = (invId: string): string | null => {
        const inv = (fc || []).find((f: any) => f.id === invId)
        if (!inv) return null
        if (inv.lead_id) return inv.lead_id
        const qid = inv.quotation_id || inv.cotizacion_id
        if (qid) return quotToLead.get(qid) || null
        return null
      }
      const resolveLeadForBankMov = (mov: any): string | null => {
        if (mov.lead_id) return mov.lead_id
        if (mov.quotation_id) return quotToLead.get(mov.quotation_id) || null
        // Via factura conciliada
        const links = (cl || []).filter((l: any) => l.bank_movement_id === mov.id)
        for (const link of links) {
          const lid = resolveLeadForInvoice(link.invoice_id)
          if (lid) return lid
        }
        return null
      }

      // ── Año de cierre por cotización (para atribuir vendido y la añada de los cobros) ──
      const leadById = new Map<string, any>(); (ld || []).forEach((l: any) => leadById.set(l.id, l))
      const yearOf = (s: string | undefined): number => { const y = parseInt((s || '').slice(0, 4), 10); return y > 2000 ? y : 0 }
      const quotYearOf = (q: any): number => {
        if (q.commercial_year) return q.commercial_year
        const lead = leadById.get(quotToLead.get(q.id) || '')
        if (lead?.commercial_year) return lead.commercial_year
        return yearOf(q.updated_at) || yearOf(q.created_at) || 0
      }
      const quotYear = new Map<string, number>(); (qt || []).forEach((q: any) => quotYear.set(q.id, quotYearOf(q)))
      // Añada de venta por lead = menor año entre sus cotizaciones en contrato
      const leadSaleYear = new Map<string, number>()
      ;(qt || []).forEach((q: any) => {
        if (q.stage !== 'contrato') return
        const lid = quotToLead.get(q.id); if (!lid) return
        const y = quotYear.get(q.id) || 0; if (!y) return
        const cur = leadSaleYear.get(lid); if (cur == null || y < cur) leadSaleYear.set(lid, y)
      })

      // Build cobros breakdown — banco + efectivo, con clasificación nuevo vs arrastre
      const cobrosLead: Record<string, number> = {}
      const cobrosYear: Record<number, number> = {}
      const vintage: Record<number, { nuevo: number; arrastre: number }> = {}
      const addCobro = (leadId: string | null | undefined, quotationId: string | null | undefined, monto: number, fecha: string | null) => {
        const payYear = fecha ? parseInt(fecha.slice(0, 4)) : 0
        cobrosYear[payYear] = (cobrosYear[payYear] || 0) + monto
        if (leadId) cobrosLead[leadId] = (cobrosLead[leadId] || 0) + monto
        // añada: año de la cotización ligada, o del lead
        let saleY = 0
        if (quotationId && quotYear.get(quotationId)) saleY = quotYear.get(quotationId)!
        else if (leadId && leadSaleYear.get(leadId)) saleY = leadSaleYear.get(leadId)!
        if (payYear) {
          if (!vintage[payYear]) vintage[payYear] = { nuevo: 0, arrastre: 0 }
          if (saleY && saleY < payYear) vintage[payYear].arrastre += monto
          else vintage[payYear].nuevo += monto
        }
      }
      // Movimientos de banco con PRORRATEO: se cuentan vía payment_allocations, no por su propio id
      const bankById = new Map<string, any>(); (bm || []).forEach((m: any) => bankById.set(m.id, m))
      const allocMovIds = new Set<string>((pa || []).map((x: any) => x.bank_movement_id).filter(Boolean))
      // cash_movements: tipo cobro_cliente o direccion ingreso
      ;(cm || [])
        .filter((m: any) => m.tipo === 'cobro_cliente' || m.direccion === 'ingreso')
        .forEach((m: any) => {
          const leadId = m.lead_id || (m.quotation_id ? quotToLead.get(m.quotation_id) : null)
          addCobro(leadId, m.quotation_id, Number(m.monto || 0), m.fecha)
        })
      // bank_movements: abonos NO prorrateados (los prorrateados se cuentan abajo, evita doble conteo).
      // SOLO categoria='cobro_cliente': excluye traspasos internos, compra de dólares, préstamos,
      // devoluciones/cheques devueltos y reembolsos de proveedor — NO son ingreso real y antes inflaban el Cobrado.
      ;(bm || [])
        .filter((m: any) => m.tipo === 'abono' && m.categoria === 'cobro_cliente' && !allocMovIds.has(m.id))
        .forEach((m: any) => {
          const leadId = resolveLeadForBankMov(m)
          const montoMXN = (m.moneda || 'MXN').toUpperCase() === 'USD'
            ? Number(m.monto || 0) * 18
            : Number(m.monto || 0)
          addCobro(leadId, m.quotation_id, montoMXN, m.fecha)
        })
      // Prorrateo (payment_allocations): cada slice se atribuye a la cotización → lead, en MXN por su monto original
      ;(pa || []).forEach((x: any) => {
        const leadId = x.quotation_id ? quotToLead.get(x.quotation_id) : null
        const mov = x.bank_movement_id ? bankById.get(x.bank_movement_id) : null
        const fecha = mov?.fecha || null
        // MXN real que entró: monto_origen en su moneda de origen (fallback: monto de la cotización)
        const mxn = x.monto_origen != null
          ? ((x.moneda_origen || 'MXN').toUpperCase() === 'USD' ? Number(x.monto_origen) * 18 : Number(x.monto_origen))
          : Number(x.monto || 0)
        addCobro(leadId, x.quotation_id, mxn, fecha)
      })
      setCobrosByLead(cobrosLead)
      setCobrosTotalByYear(cobrosYear)
      setCobradoVintage(vintage)
      setLeads(ld || [])
      const totals: Record<string, { cotizadoUSD: number; cotizadoMXN: number; vendidoUSD: number; vendidoMXN: number }> = {}
      const vByYear: Record<number, { usd: number; mxn: number }> = {}
      const cByYear: Record<number, { usd: number; mxn: number }> = {}
      if (ld && qt) {
        const quotTotalIva = (q: any) => {
          // esp/cort/ilum/proy/dist guardan total CON IVA; elec guarda subtotal crudo.
          // Fuente canónica: total_final (con descuento + IVA) cuando existe.
          if (typeof q.total_final === 'number' && !isNaN(q.total_final)) return Number(q.total_final)
          if (q.specialty === 'esp' || q.specialty === 'cort' || q.specialty === 'ilum' || q.specialty === 'proy' || q.specialty === 'dist') return q.total || 0
          return (q.total || 0) * 1.16
        }
        const getCurrency = (q: any): 'USD' | 'MXN' => {
          try { const m = JSON.parse(q.notes || '{}'); return m.currency === 'MXN' ? 'MXN' : 'USD' } catch { return 'USD' }
        }
        // Dedupe versiones: si varias quotations comparten version_group_id,
        // solo cuenta la mas reciente (por updated_at). Las que no tienen
        // version_group_id se consideran unicas.
        const dedupeVersions = (quotes: any[]): any[] => {
          const byGroup = new Map<string, any>()
          const noGroup: any[] = []
          for (const q of quotes) {
            if (!q.version_group_id) { noGroup.push(q); continue }
            const existing = byGroup.get(q.version_group_id)
            if (!existing || (q.updated_at || '') > (existing.updated_at || '')) {
              byGroup.set(q.version_group_id, q)
            }
          }
          return [...byGroup.values(), ...noGroup]
        }
        for (const lead of ld) {
          const leadQuotesAll = qt.filter(q => {
            let meta: any = {}
            try { meta = JSON.parse(q.notes || '{}') } catch {}
            // Si la cotización tiene lead_id explícito, empatar SOLO por lead_id (estricto).
            // Evita que una cotización de otro lead se cuele por coincidencia de nombre
            // (p.ej. "Villa 1" capturaba "Villa 14" porque es substring).
            if (meta.lead_id) return meta.lead_id === lead.id
            // Legacy sin lead_id: fallback por nombre.
            return q.client_name && lead.name && q.client_name.toLowerCase().includes(lead.name.toLowerCase())
          })
          // ⚠️ Dedupe versiones para no inflar Cotizado/Vendido cuando un lead
          // tiene multiples versiones de la misma cotizacion
          const leadQuotes = dedupeVersions(leadQuotesAll)
          let cotizadoUSD = 0, cotizadoMXN = 0, vendidoUSD = 0, vendidoMXN = 0
          leadQuotes.forEach(q => {
            const total = quotTotalIva(q)
            const cur = getCurrency(q)
            // Año de cierre de ESTA cotización (propio → del lead → updated/created)
            const y = q.commercial_year || lead.commercial_year || quotYear.get(q.id) || 0
            if (y) { if (!cByYear[y]) cByYear[y] = { usd: 0, mxn: 0 } }
            if (cur === 'USD') {
              cotizadoUSD += total
              if (y) cByYear[y].usd += total
              if (q.stage === 'contrato') { vendidoUSD += total; if (y) { if (!vByYear[y]) vByYear[y] = { usd: 0, mxn: 0 }; vByYear[y].usd += total } }
            } else {
              cotizadoMXN += total
              if (y) cByYear[y].mxn += total
              if (q.stage === 'contrato') { vendidoMXN += total; if (y) { if (!vByYear[y]) vByYear[y] = { usd: 0, mxn: 0 }; vByYear[y].mxn += total } }
            }
          })
          if (cotizadoUSD || cotizadoMXN || vendidoUSD || vendidoMXN) {
            totals[lead.id] = { cotizadoUSD, cotizadoMXN, vendidoUSD, vendidoMXN }
          }
        }
      }
      setQuoteTotals(totals)
      setVendidoByYear(vByYear)
      setCotizadoByYear(cByYear)
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [])

  async function changeProbability(id: string, prob: number | null) {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, close_probability: prob ?? undefined } : l))
    await supabase.from('leads').update({ close_probability: prob, updated_at: new Date().toISOString() }).eq('id', id)
  }

  async function changePriority(id: string, p: Priority) {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, priority: p } : l))
    await supabase.from('leads').update({ priority: p, updated_at: new Date().toISOString() }).eq('id', id)
  }

  // Busqueda con AI
  async function buscarConAI() {
    if (!aiQuery.trim()) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/anthropic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
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

  // ── KPIs financieros filtrados por año ───────────────────────────────────
  // Cada lead se filtra por commercial_year (si lo tiene) o por created_at;
  // los cobros por fecha del movimiento.
  const getLeadYear = (l: Lead): number => l.commercial_year || parseInt((l.created_at || '').slice(0, 4), 10) || 0
  const leadsByYear = filterYear === 'todos'
    ? leads
    : leads.filter(l => getLeadYear(l) === filterYear)
  // Años disponibles para el selector — de leads, cotizaciones (año de cierre) y cobros (fecha de pago)
  const availableYears = [...new Set([
    ...leads.map(getLeadYear),
    ...Object.keys(vendidoByYear).map(Number),
    ...Object.keys(cotizadoByYear).map(Number),
    ...Object.keys(cobrosTotalByYear).map(Number),
  ].filter(y => y > 2000))].sort((a, b) => b - a)
  // 1. Valor de leads (suma de estimated_value, asumido MXN). Solo considera
  // leads en pipeline activo para forecasting (excluye ganado/perdido/pausado).
  const leadsActivosYear = leadsByYear.filter(l => !['ganado', 'perdido', 'pausado'].includes(l.status))
  const valorLeadsMXN = leadsActivosYear.reduce((s, l) => s + (l.estimated_value || 0), 0)
  // 2. Cierre estimado = sum(estimated_value × close_probability/100) por lead activo.
  // Si el lead no tiene probabilidad, se asume 0 (no contribuye al forecast).
  // Asi cada lead aporta segun su probabilidad real, no un promedio global.
  const cierreEstimadoMXN = leadsActivosYear.reduce((s, l) => {
    const prob = l.close_probability ?? 0
    return s + (l.estimated_value || 0) * (prob / 100)
  }, 0)
  // Cantidad de leads con probabilidad asignada (para info en sub-label)
  const leadsConProbabilidad = leadsActivosYear.filter(l => l.close_probability != null).length
  // 3-4. Cotizado y Vendido por AÑO DE CIERRE de cada cotización (no por año del lead).
  // Así una obra que cerró en 2025 aporta a 2025 aunque el lead siga vivo o cobre en 2026.
  let cotizadoUSD = 0, cotizadoMXN = 0, vendidoUSD = 0, vendidoMXN = 0
  if (filterYear === 'todos') {
    Object.values(vendidoByYear).forEach(v => { vendidoUSD += v.usd; vendidoMXN += v.mxn })
    Object.values(cotizadoByYear).forEach(c => { cotizadoUSD += c.usd; cotizadoMXN += c.mxn })
  } else {
    const v = vendidoByYear[filterYear as number]; if (v) { vendidoUSD = v.usd; vendidoMXN = v.mxn }
    const c = cotizadoByYear[filterYear as number]; if (c) { cotizadoUSD = c.usd; cotizadoMXN = c.mxn }
  }
  // 5. Cobrado en MXN — por fecha de pago (eje independiente de la venta)
  const cobradoMXN = filterYear === 'todos'
    ? Object.values(cobrosTotalByYear).reduce((s, v) => s + v, 0)
    : (cobrosTotalByYear[filterYear as number] || 0)
  // 5b. Desglose del cobrado: cierres de este año (nuevo) vs años anteriores (arrastre/finiquitos)
  const vint = filterYear === 'todos'
    ? Object.values(cobradoVintage).reduce((a, v) => ({ nuevo: a.nuevo + v.nuevo, arrastre: a.arrastre + v.arrastre }), { nuevo: 0, arrastre: 0 })
    : (cobradoVintage[filterYear as number] || { nuevo: 0, arrastre: 0 })
  // 6. Cartera (backlog) — vendido histórico menos cobrado histórico (todos los años, en MXN).
  // Es el flujo futuro comprometido: finiquitos y saldos por cobrar de contratos ya cerrados.
  const vendidoTotalMXNall = Object.values(vendidoByYear).reduce((s, v) => s + v.usd * tc + v.mxn, 0)
  const cobradoTotalAll = Object.values(cobrosTotalByYear).reduce((s, v) => s + v, 0)
  const carteraMXN = Math.max(0, vendidoTotalMXNall - cobradoTotalAll)

  // Helper para mostrar monto MXN en displayCur
  function mxnToDisplay(amount: number): string {
    if (!amount) return '—'
    const converted = displayCur === 'MXN' ? amount : amount / tc
    return (displayCur === 'USD' ? 'US$' : '$') + Math.round(converted).toLocaleString()
  }
  // Helper para mostrar total mixto USD+MXN convertido a displayCur (mismo que en ListView,
  // duplicado aquí porque CotDashboard también lo usa para los KPIs financieros)
  function mixedToDisplay(usd: number, mxn: number): string {
    const total = displayCur === 'USD' ? (usd + mxn / tc) : (usd * tc + mxn)
    if (!total) return '—'
    return (displayCur === 'USD' ? 'US$' : '$') + Math.round(total).toLocaleString()
  }

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 28px' }}>
      <SectionHeader
        title="CRM y Ventas"
        subtitle={`${leads.length} leads · ${activePipeline.length} en pipeline activo`}
        action={<Btn variant="primary" onClick={() => setShowNew(true)}><Plus size={14} /> Nuevo lead</Btn>}
      />

      {/* Selector de año + status KPIs (chips compactos) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' as const }}>
        <span style={{ fontSize: 10, color: '#555', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Año:</span>
        {(['todos', ...availableYears] as Array<number | 'todos'>).map(y => {
          const active = filterYear === y
          return (
            <button key={y} onClick={() => setFilterYear(y)} style={{
              padding: '3px 10px', borderRadius: 14, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid ' + (active ? '#A78BFA' : '#2a2a2a'),
              background: active ? '#A78BFA22' : 'transparent',
              color: active ? '#A78BFA' : '#888',
            }}>{y === 'todos' ? 'Todos' : y}</button>
          )
        })}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#666' }}>
          📊 {leadsByYear.length} leads · {ganados} ganados · {perdidos} perdidos · <b style={{ color: '#A78BFA' }}>{tasaCierre}%</b> tasa cierre
        </span>
      </div>

      {/* KPIs financieros (5 cards) - solo visibles para DG */}
      {showFinancialKPIs && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6, 1fr)', gap: 10, marginBottom: 12 }}>
          {[
            { label: 'Valor de leads', value: mxnToDisplay(valorLeadsMXN), sub: `${leadsActivosYear.length} en pipeline · estimado`, color: '#2563EB' },
            { label: 'Cierre estimado', value: mxnToDisplay(cierreEstimadoMXN), sub: `Σ(estimado × prob) — ${leadsConProbabilidad}/${leadsActivosYear.length} c/ prob`, color: '#A78BFA' },
            { label: 'Cotizado', value: mixedToDisplay(cotizadoUSD, cotizadoMXN), sub: filterYear === 'todos' ? 'todas etapas · histórico' : `por año de cierre · ${filterYear}`, color: '#D97706' },
            { label: 'Vendido', value: mixedToDisplay(vendidoUSD, vendidoMXN), sub: filterYear === 'todos' ? 'contratos cerrados · histórico' : `cerrado en ${filterYear}`, color: '#10B981' },
            { label: 'Cobrado', value: mxnToDisplay(cobradoMXN), sub: `${mxnToDisplay(vint.nuevo)} nuevo · ${mxnToDisplay(vint.arrastre)} arrastre`, color: '#10B981' },
            { label: 'Cartera (por cobrar)', value: mxnToDisplay(carteraMXN), sub: 'vendido − cobrado · histórico', color: '#06B6D4' },
          ].map(k => (
            <div key={k.label} style={{ background: '#141414', border: '1px solid #1e1e1e', borderRadius: 10, padding: '12px 14px', borderTop: `2px solid ${k.color}` }}>
              <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: isMobile ? 16 : 19, fontWeight: 700, color: '#fff', wordBreak: 'break-word' as const }}>{k.value}</div>
              <div style={{ fontSize: 9, color: '#444', marginTop: 2 }}>{k.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Currency toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', background: '#0e0e0e', borderRadius: 8, border: '1px solid #1e1e1e', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: '#555', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Ver en:</span>
        {(['MXN', 'USD'] as const).map(cur => (
          <button key={cur} onClick={() => setDisplayCur(cur)} style={{
            padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            border: '1px solid ' + (displayCur === cur ? (cur === 'USD' ? '#06B6D4' : '#D97706') : '#333'),
            background: displayCur === cur ? (cur === 'USD' ? '#06B6D422' : '#D9770622') : 'transparent',
            color: displayCur === cur ? (cur === 'USD' ? '#06B6D4' : '#D97706') : '#555',
          }}>{cur === 'USD' ? '🇺🇸 USD' : '🇲🇽 MXN'}</button>
        ))}
        <span style={{ fontSize: 10, color: '#555', marginLeft: 8 }}>TC:</span>
        <input type="number" value={tc} step={0.1} onChange={e => setTc(parseFloat(e.target.value) || 18)}
          style={{ width: 55, padding: '3px 6px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} />
        <span style={{ fontSize: 10, color: '#444' }}>Estimados en MXN · Cotizados en USD</span>
      </div>

      {/* Busqueda normal + AI */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <div style={{ position: 'relative' as const, flex: isMobile ? '1 1 100%' : 1 }}>
          <Search size={14} style={{ position: 'absolute' as const, left: 10, top: '50%', transform: 'translateY(-50%)', color: '#555', pointerEvents: 'none' as const }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, empresa, contacto..."
            style={{ width: '100%', padding: '8px 10px 8px 32px', background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8, color: '#ccc', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
        </div>
        <div style={{ display: 'flex', gap: 6, flex: isMobile ? '1 1 100%' : 2 }}>
          <div style={{ position: 'relative' as const, flex: 1 }}>
            <Sparkles size={14} style={{ position: 'absolute' as const, left: 10, top: '50%', transform: 'translateY(-50%)', color: aiFilter ? '#10B981' : '#555', pointerEvents: 'none' as const }} />
            <input value={aiQuery} onChange={e => setAiQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && buscarConAI()}
              placeholder="Busqueda con AI: ej. 'leads de arquitectos con valor alto'"
              style={{ width: '100%', padding: '8px 10px 8px 32px', background: aiFilter ? '#0d1f14' : '#141414', border: `1px solid ${aiFilter ? '#10B98144' : '#2a2a2a'}`, borderRadius: 8, color: '#ccc', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
          </div>
          <Btn onClick={buscarConAI} disabled={aiLoading}>{aiLoading ? '...' : 'Buscar'}</Btn>
          {aiFilter && <Btn onClick={clearAI}>Limpiar AI</Btn>}
        </div>
      </div>

      {/* Filtros estatus + toggle vista */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' as const, justifyContent: isMobile ? 'space-between' : 'flex-start' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
          {(['todos', ...Object.keys(STATUS_CFG)] as (LeadStatus | 'todos')[]).map(k => {
            const v = k === 'todos' ? { label: 'Todos', color: '#10B981' } : STATUS_CFG[k as LeadStatus]
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
        <div style={{ marginLeft: isMobile ? 0 : 'auto', display: 'flex', border: '1px solid #2a2a2a', borderRadius: 8, overflow: 'hidden', order: isMobile ? -1 : 0 }}>
          {(['kanban', 'lista'] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)} style={{
              padding: '5px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              background: viewMode === m ? '#10B98118' : 'transparent',
              color: viewMode === m ? '#10B981' : '#555', fontWeight: viewMode === m ? 600 : 400,
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
          ? <KanbanView leads={filtered} onOpen={(l) => nav(`/crm/${l.id}`)} />
          : <ListView leads={filtered} onOpen={(l) => nav(`/crm/${l.id}`)} onEdit={setSelected} onPriorityChange={changePriority} onProbabilityChange={changeProbability} quoteTotals={quoteTotals} cobrosByLead={cobrosByLead} displayCur={displayCur} tc={tc} />
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
            <ListView leads={leads.filter(l => ['ganado', 'perdido', 'pausado'].includes(l.status))} onOpen={(l) => nav(`/crm/${l.id}`)} onEdit={setSelected} onPriorityChange={changePriority} onProbabilityChange={changeProbability} quoteTotals={quoteTotals} cobrosByLead={cobrosByLead} displayCur={displayCur} tc={tc} />
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
