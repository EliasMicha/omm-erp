import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Badge, Btn, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { Plus, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { SPECIALTY_CONFIG } from '../lib/utils'
import { ProjectLine } from '../types'

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Config ──────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<LeadStatus, { label: string; color: string; order: number }> = {
    nuevo:       { label: 'Nuevo',        color: '#6B7280', order: 0 },
    contactado:  { label: 'Contactado',   color: '#3B82F6', order: 1 },
    diagnostico: { label: 'Diagnóstico',  color: '#F59E0B', order: 2 },
    cotizando:   { label: 'Cotizando',    color: '#C084FC', order: 3 },
    ganado:      { label: 'Ganado',       color: '#57FF9A', order: 4 },
    perdido:     { label: 'Perdido',      color: '#EF4444', order: 5 },
    pausado:     { label: 'Pausado',      color: '#78716C', order: 6 },
}

const ORIGIN_CFG: Record<LeadOrigin, { label: string; icon: string }> = {
    inbound:      { label: 'Inbound',      icon: '↙' },
    outbound:     { label: 'Outbound',     icon: '↗' },
    referido:     { label: 'Referido',     icon: '◎' },
    arquitecto:   { label: 'Arquitecto',   icon: '◈' },
    desarrolladora:{ label: 'Desarrolladora', icon: '▦' },
}

const F = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n)

const PIPELINE_STAGES: LeadStatus[] = ['nuevo', 'contactado', 'diagnostico', 'cotizando']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function InputField({ label, value, onChange, placeholder = '', type = 'text' }: {
    label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
    return (
          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block' }}>
            {label}
                  <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
                            style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </label>label>
        )
}

// ─── Modal: Nuevo Lead ────────────────────────────────────────────────────────

function NuevoLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
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
        const { data, error: err } = await supabase.from('leads').insert({
                name: form.name.trim(),
                company: form.company || null,
                contact_name: form.contact_name || null,
                contact_phone: form.contact_phone || null,
                contact_email: form.contact_email || null,
                origin: form.origin,
                status: 'nuevo',
                needs: form.needs,
                notes: form.notes || null,
                estimated_value: parseFloat(form.estimated_value) || null,
        }).select().single()
        setSaving(false)
        if (err) { setError(err.message); return }
        onCreated(data.id)
  }

  return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 540, maxHeight: '90vh', overflowY: 'auto' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                      <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Nuevo lead</div>div>
                                      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>button>
                          </div>div>

                          <div style={{ display: 'grid', gap: 12 }}>
                                      <InputField label="Nombre / Proyecto" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="ej. Torre Reforma 222 - Lobby" />
                                      <InputField label="Empresa / Cliente" value={form.company} onChange={v => setForm(f => ({ ...f, company: v }))} placeholder="ej. Grupo Desarrollador XYZ" />

                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                                    <InputField label="Contacto" value={form.contact_name} onChange={v => setForm(f => ({ ...f, contact_name: v }))} placeholder="Nombre del contacto" />
                                                    <InputField label="Teléfono" value={form.contact_phone} onChange={v => setForm(f => ({ ...f, contact_phone: v }))} placeholder="+52 55..." />
                                      </div>div>

                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                                    <InputField label="Email" value={form.contact_email} onChange={v => setForm(f => ({ ...f, contact_email: v }))} placeholder="correo@ejemplo.com" />
                                                    <InputField label="Valor estimado (MXN)" value={form.estimated_value} onChange={v => setForm(f => ({ ...f, estimated_value: v }))} type="number" placeholder="0" />
                                      </div>div>

                                      <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                    Origen
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                                      {(Object.entries(ORIGIN_CFG) as [LeadOrigin, typeof ORIGIN_CFG[LeadOrigin]][]).map(([k, v]) => (
                          <button key={k} onClick={() => setForm(f => ({ ...f, origin: k }))}
                                              style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                                                                          border: `1px solid ${form.origin === k ? '#57FF9A' : '#333'}`,
                                                                          background: form.origin === k ? '#57FF9A22' : 'transparent',
                                                                          color: form.origin === k ? '#57FF9A' : '#666', fontWeight: form.origin === k ? 600 : 400 }}>
                            {v.icon} {v.label}
                          </button>button>
                        ))}
                                                    </div>div>
                                      </label>label>

                                      <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                    Especialidades de interés
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                                      {(Object.entries(SPECIALTY_CONFIG) as [ProjectLine, typeof SPECIALTY_CONFIG[ProjectLine]][]).map(([k, v]) => (
                          <button key={k} onClick={() => toggleNeed(k)}
                                              style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                                                                          border: `1px solid ${form.needs.includes(k) ? v.color : '#333'}`,
                                                                          background: form.needs.includes(k) ? v.color + '22' : 'transparent',
                                                                          color: form.needs.includes(k) ? v.color : '#666' }}>
                            {v.icon} {v.label}
                          </button>button>
                        ))}
                                                    </div>div>
                                      </label>label>

                                      <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                    Notas
                                                    <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Contexto del lead, quién refirió, detalles del proyecto..."
                                                                    style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
                                      </label>label>
                          </div>div>

                  {error && <div style={{ color: '#EF4444', fontSize: 12, marginTop: 10 }}>{error}</div>div>}

                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                                      <Btn onClick={onClose}>Cancelar</Btn>Btn>
                                      <Btn variant="primary" onClick={crear}>{saving ? 'Guardando...' : 'Crear lead'}</Btn>Btn>
                          </div>div>
                </div>div>
        </div>div>
      )
}

// ─── Modal: Detalle / Editar Lead ─────────────────────────────────────────────

function LeadDetailModal({ lead, onClose, onUpdated }: { lead: Lead; onClose: () => void; onUpdated: () => void }) {
    const [form, setForm] = useState({
          name: lead.name,
          company: lead.company || '',
          contact_name: lead.contact_name || '',
          contact_phone: lead.contact_phone || '',
          contact_email: lead.contact_email || '',
          origin: lead.origin,
          status: lead.status,
          needs: lead.needs || [] as ProjectLine[],
          notes: lead.notes || '',
          estimated_value: lead.estimated_value?.toString() || '',
          lost_reason: lead.lost_reason || '',
    })
    const [saving, setSaving] = useState(false)
    const [tab, setTab] = useState<'info' | 'actividad'>('info')

  const toggleNeed = (n: ProjectLine) =>
        setForm(f => ({ ...f, needs: f.needs.includes(n) ? f.needs.filter(x => x !== n) : [...f.needs, n] }))

  async function guardar() {
        setSaving(true)
        await supabase.from('leads').update({
                name: form.name,
                company: form.company || null,
                contact_name: form.contact_name || null,
                contact_phone: form.contact_phone || null,
                contact_email: form.contact_email || null,
                origin: form.origin,
                status: form.status,
                needs: form.needs,
                notes: form.notes || null,
                estimated_value: parseFloat(form.estimated_value) || null,
                lost_reason: form.lost_reason || null,
                updated_at: new Date().toISOString(),
        }).eq('id', lead.id)
        setSaving(false)
        onUpdated()
  }

  const statusCfg = STATUS_CFG[form.status]

  return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, width: 620, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>

                  {/* Header */}
                          <div style={{ padding: '16px 20px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 10 }}>
                                      <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{lead.name}</div>div>
                                        {lead.company && <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{lead.company}</div>div>}
                                      </div>div>
                                      <Badge label={statusCfg.label} color={statusCfg.color} />
                                      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', marginLeft: 8 }}><X size={18} /></button>button>
                          </div>div>

                  {/* Tabs */}
                          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #222', paddingLeft: 20 }}>
                            {(['info', 'actividad'] as const).map(t => (
                      <button key={t} onClick={() => setTab(t)}
                                      style={{ padding: '10px 16px', fontSize: 12, cursor: 'pointer', background: 'none', border: 'none', fontFamily: 'inherit',
                                                              color: tab === t ? '#57FF9A' : '#555', fontWeight: tab === t ? 600 : 400,
                                                              borderBottom: `2px solid ${tab === t ? '#57FF9A' : 'transparent'}` }}>
                        {t === 'info' ? 'Información' : 'Actividad'}
                      </button>button>
                    ))}
                          </div>div>

                  {/* Body */}
                          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                            {tab === 'info' && (
                      <div style={{ display: 'grid', gap: 12 }}>
                                      <InputField label="Nombre / Proyecto" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
                                      <InputField label="Empresa / Cliente" value={form.company} onChange={v => setForm(f => ({ ...f, company: v }))} />
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                                        <InputField label="Contacto" value={form.contact_name} onChange={v => setForm(f => ({ ...f, contact_name: v }))} />
                                                        <InputField label="Teléfono" value={form.contact_phone} onChange={v => setForm(f => ({ ...f, contact_phone: v }))} />
                                      </div>div>
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                                        <InputField label="Email" value={form.contact_email} onChange={v => setForm(f => ({ ...f, contact_email: v }))} />
                                                        <InputField label="Valor estimado (MXN)" value={form.estimated_value} onChange={v => setForm(f => ({ ...f, estimated_value: v }))} type="number" />
                                      </div>div>

                        {/* Status */}
                                      <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                        Estatus
                                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                                          {(Object.entries(STATUS_CFG) as [LeadStatus, typeof STATUS_CFG[LeadStatus]][]).map(([k, v]) => (
                                            <button key={k} onClick={() => setForm(f => ({ ...f, status: k }))}
                                                                    style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                                                                                                    border: `1px solid ${form.status === k ? v.color : '#333'}`,
                                                                                                    background: form.status === k ? v.color + '22' : 'transparent',
                                                                                                    color: form.status === k ? v.color : '#666', fontWeight: form.status === k ? 600 : 400 }}>
                                              {v.label}
                                            </button>button>
                                          ))}
                                                        </div>div>
                                      </label>label>

                        {form.status === 'perdido' && (
                                        <InputField label="Razón de pérdida" value={form.lost_reason} onChange={v => setForm(f => ({ ...f, lost_reason: v }))} placeholder="ej. Precio, competencia, proyecto cancelado..." />
                                      )}

                        {/* Origin */}
                                      <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                        Origen
                                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                                          {(Object.entries(ORIGIN_CFG) as [LeadOrigin, typeof ORIGIN_CFG[LeadOrigin]][]).map(([k, v]) => (
                                            <button key={k} onClick={() => setForm(f => ({ ...f, origin: k }))}
                                                                    style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                                                                                                    border: `1px solid ${form.origin === k ? '#57FF9A' : '#333'}`,
                                                                                                    background: form.origin === k ? '#57FF9A22' : 'transparent',
                                                                                                    color: form.origin === k ? '#57FF9A' : '#666', fontWeight: form.origin === k ? 600 : 400 }}>
                                              {v.icon} {v.label}
                                            </button>button>
                                          ))}
                                                        </div>div>
                                      </label>label>

                        {/* Needs */}
                                      <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                        Especialidades de interés
                                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                                          {(Object.entries(SPECIALTY_CONFIG) as [ProjectLine, typeof SPECIALTY_CONFIG[ProjectLine]][]).map(([k, v]) => (
                                            <button key={k} onClick={() => toggleNeed(k)}
                                                                    style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                                                                                                    border: `1px solid ${form.needs.includes(k) ? v.color : '#333'}`,
                                                                                                    background: form.needs.includes(k) ? v.color + '22' : 'transparent',
                                                                                                    color: form.needs.includes(k) ? v.color : '#666' }}>
                                              {v.icon} {v.label}
                                            </button>button>
                                          ))}
                                                        </div>div>
                                      </label>label>

                                      <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                        Notas
                                                        <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={4}
                                                                            style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
                                      </label>label>
                      </div>div>
                    )}

                            {tab === 'actividad' && (
                      <div style={{ color: '#555', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
                                      Historial de actividad — próximamente
                      </div>div>
                    )}
                          </div>div>

                  {/* Footer */}
                          <div style={{ padding: '12px 20px', borderTop: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <div style={{ fontSize: 11, color: '#444' }}>
                                                    Creado: {new Date(lead.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                                      </div>div>
                                      <div style={{ display: 'flex', gap: 8 }}>
                                                    <Btn onClick={onClose}>Cancelar</Btn>Btn>
                                                    <Btn variant="primary" onClick={guardar}>{saving ? 'Guardando...' : 'Guardar cambios'}</Btn>Btn>
                                      </div>div>
                          </div>div>
                </div>div>
        </div>div>
      )
}

// ─── Vista Kanban ─────────────────────────────────────────────────────────────

function KanbanView({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
    return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, overflowX: 'auto' }}>
            {PIPELINE_STAGES.map(stage => {
                    const cfg = STATUS_CFG[stage]
                    const cols = leads.filter(l => l.status === stage)
                    const total = cols.reduce((s, l) => s + (l.estimated_value || 0), 0)
                    return (
                                <div key={stage} style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 10, padding: '10px 10px 14px' }}>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid ${cfg.color}33` }}>
                                                              <div>
                                                                              <div style={{ fontSize: 11, fontWeight: 600, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{cfg.label}</div>div>
                                                                              <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{cols.length} lead{cols.length !== 1 ? 's' : ''} · {total > 0 ? F(total) : '—'}</div>div>
                                                              </div>div>
                                                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color }} />
                                              </div>div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                              {cols.length === 0 && (
                                                  <div style={{ fontSize: 11, color: '#333', textAlign: 'center', padding: '16px 0' }}>Sin leads</div>div>
                                                          )}
                                              {cols.map(lead => (
                                                  <div key={lead.id} onClick={() => onOpen(lead)}
                                                                      style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, padding: '10px 12px', cursor: 'pointer' }}
                                                                      onMouseEnter={e => (e.currentTarget.style.borderColor = '#333')}
                                                                      onMouseLeave={e => (e.currentTarget.style.borderColor = '#222')}>
                                                                    <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 3, lineHeight: 1.3 }}>{lead.name}</div>div>
                                                    {lead.company && <div style={{ fontSize: 10, color: '#555', marginBottom: 6 }}>{lead.company}</div>div>}
                                                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: lead.needs.length > 0 ? 8 : 0 }}>
                                                                      {lead.needs.map(n => {
                                                                                              const s = SPECIALTY_CONFIG[n]
                                                                                                                      return s ? <Badge key={n} label={s.icon} color={s.color} /> : null
                                                                        })}
                                                                    </div>div>
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                                        <div style={{ fontSize: 10, color: '#444' }}>{ORIGIN_CFG[lead.origin].icon} {ORIGIN_CFG[lead.origin].label}</div>div>
                                                                      {lead.estimated_value ? <div style={{ fontSize: 11, fontWeight: 600, color: '#57FF9A' }}>{F(lead.estimated_value)}</div>div> : null}
                                                                    </div>div>
                                                  </div>div>
                                                ))}
                                            </div>div>
                                </div>div>
                              )
            })}
          </div>div>
        )
}

// ─── Vista Lista ──────────────────────────────────────────────────────────────

function ListView({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
    if (leads.length === 0) return <EmptyState message="Sin leads — crea el primero" />
        return (
              <Table>
                    <thead>
                            <tr>
                                      <Th>Lead / Proyecto</Th>Th>
                                      <Th>Contacto</Th>Th>
                                      <Th>Origen</Th>Th>
                                      <Th>Especialidades</Th>Th>
                                      <Th>Estatus</Th>Th>
                                      <Th right>Valor est.</Th>Th>
                                      <Th></Th>Th>
                            </tr>tr>
                    </thead>thead>
                    <tbody>
                      {leads.map(lead => {
                          const sCfg = STATUS_CFG[lead.status]
                                      return (
                                                    <tr key={lead.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(lead)}>
                                                                  <Td>
                                                                                  <div style={{ fontWeight: 500, color: '#fff' }}>{lead.name}</div>div>
                                                                    {lead.company && <div style={{ fontSize: 10, color: '#555' }}>{lead.company}</div>div>}
                                                                  </Td>Td>
                                                                  <Td>
                                                                                  <div style={{ fontSize: 12, color: '#ccc' }}>{lead.contact_name || '—'}</div>div>
                                                                    {lead.contact_phone && <div style={{ fontSize: 10, color: '#555' }}>{lead.contact_phone}</div>div>}
                                                                  </Td>Td>
                                                                  <Td muted>{ORIGIN_CFG[lead.origin].icon} {ORIGIN_CFG[lead.origin].label}</Td>Td>
                                                                  <Td>
                                                                                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                                                    {lead.needs.map(n => {
                                                                          const s = SPECIALTY_CONFIG[n]
                                                                                                return s ? <Badge key={n} label={s.icon + ' ' + s.label} color={s.color} /> : null
                                                      })}
                                                                                  </div>div>
                                                                  </Td>Td>
                                                                  <Td><Badge label={sCfg.label} color={sCfg.color} /></Td>Td>
                                                                  <Td right>
                                                                    {lead.estimated_value ? <span style={{ fontWeight: 600, color: '#57FF9A' }}>{F(lead.estimated_value)}</span>span> : <span style={{ color: '#444' }}>—</span>span>}
                                                                  </Td>Td>
                                                                  <Td><Btn size="sm" onClick={e => { e.stopPropagation(); onOpen(lead) }}>Abrir</Btn>Btn></Td>Td>
                                                    </tr>tr>
                                                  )
                      })}
                    </tbody>tbody>
              </Table>Table>
            )
}

// ─── Main CRM ────────────────────────────────────────────────────────────────

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
                                const listaKanban = viewMode === 'kanban'
                                      ? (filtroStatus === 'todos' ? leads : leads.filter(l => l.status === filtroStatus))
                                      : lista
                                  
                                    return (
                                          <div style={{ padding: '24px 28px' }}>
                                                <SectionHeader
                                                          title="CRM y Ventas"
                                                          subtitle={`${leads.length} leads totales · ${activePipeline.length} en pipeline activo`}
                                                          action={<Btn variant="primary" onClick={() => setShowNew(true)}><Plus size={14} /> Nuevo lead</Btn>Btn>}
                                                      />
                                                
                                                  {/* KPIs */}
                                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
                                                        {[
                                                            { label: 'Pipeline activo', value: activePipeline.length.toString(), sub: F(pipelineValue), color: '#3B82F6' },
                                                            { label: 'Ganados', value: ganados.toString(), sub: 'total histórico', color: '#57FF9A' },
                                                            { label: 'Perdidos', value: perdidos.toString(), sub: 'total histórico', color: '#EF4444' },
                                                            { label: 'Tasa de cierre', value: `${tasaCierre}%`, sub: `${ganados} de ${ganados + perdidos}`, color: '#C084FC' },
                                                                    ].map(k => (
                                                                                <div key={k.label} style={{ background: '#141414', border: '1px solid #222', borderRadius: 10, padding: '12px 14px', borderTop: `2px solid ${k.color}` }}>
                                                                                            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{k.label}</div>div>
                                                                                            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{k.value}</div>div>
                                                                                            <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{k.sub}</div>div>
                                                                                </div>div>
                                                                              ))}
                                                      </div>div>
                                                
                                                  {/* Toolbar */}
                                                      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                                                        {/* Filtro status */}
                                                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                                        <button onClick={() => setFiltroStatus('todos')}
                                                                                      style={{ padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: filtroStatus === 'todos' ? 600 : 400,
                                                                                                            border: `1px solid ${filtroStatus === 'todos' ? '#57FF9A' : '#333'}`,
                                                                                                            background: filtroStatus === 'todos' ? '#57FF9A22' : 'transparent',
                                                                                                            color: filtroStatus === 'todos' ? '#57FF9A' : '#666' }}>
                                                                                    Todos
                                                                        </button>button>
                                                                {(Object.entries(STATUS_CFG) as [LeadStatus, typeof STATUS_CFG[LeadStatus]][]).map(([k, v]) => (
                                                                        <button key={k} onClick={() => setFiltroStatus(k)}
                                                                                        style={{ padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: filtroStatus === k ? 600 : 400,
                                                                                                                border: `1px solid ${filtroStatus === k ? v.color : '#333'}`,
                                                                                                                background: filtroStatus === k ? v.color + '22' : 'transparent',
                                                                                                                color: filtroStatus === k ? v.color : '#666' }}>
                                                                          {v.label}
                                                                        </button>button>
                                                                      ))}
                                                              </div>div>
                                                      
                                                        {/* Toggle vista */}
                                                              <div style={{ marginLeft: 'auto', display: 'flex', border: '1px solid #333', borderRadius: 8, overflow: 'hidden' }}>
                                                                {(['kanban', 'lista'] as const).map(m => (
                                                                        <button key={m} onClick={() => setViewMode(m)}
                                                                                        style={{ padding: '5px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                                                                                                                background: viewMode === m ? '#57FF9A22' : 'transparent',
                                                                                                                color: viewMode === m ? '#57FF9A' : '#555', fontWeight: viewMode === m ? 600 : 400,
                                                                                                                border: 'none', borderRight: m === 'kanban' ? '1px solid #333' : 'none' }}>
                                                                          {m === 'kanban' ? 'Kanban' : 'Lista'}
                                                                        </button>button>
                                                                      ))}
                                                              </div>div>
                                                      </div>div>
                                                
                                                  {/* Contenido */}
                                                  {loading ? <Loading /> : (
                                                                    viewMode === 'kanban'
                                                                      ? <KanbanView leads={listaKanban} onOpen={setSelected} />
                                                                      : <ListView leads={lista} onOpen={setSelected} />
                                                                  )}
                                                
                                                  {/* Sección ganados/perdidos/pausados (siempre lista) */}
                                                  {viewMode === 'kanban' && filtroStatus === 'todos' && !loading && (
                                                                    <div style={{ marginTop: 24 }}>
                                                                              <div style={{ fontSize: 11, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, display: 'flex', gap: 16 }}>
                                                                                {(['ganado', 'perdido', 'pausado'] as LeadStatus[]).map(s => {
                                                                                    const c = STATUS_CFG[s]; const count = leads.filter(l => l.status === s).length
                                                                                                    return count > 0 ? (
                                                                                                                      <span key={s} style={{ color: c.color }}>{c.label}: {count}</span>span>
                                                                                                                    ) : null
                                                                      })}
                                                                              </div>div>
                                                                      {leads.filter(l => ['ganado', 'perdido', 'pausado'].includes(l.status)).length > 0 && (
                                                                                  <ListView
                                                                                                  leads={leads.filter(l => ['ganado', 'perdido', 'pausado'].includes(l.status))}
                                                                                                  onOpen={setSelected}
                                                                                                />
                                                                                )}
                                                                    </div>div>
                                                      )}
                                                
                                                  {/* Modales */}
                                                  {showNew && (
                                                                    <NuevoLeadModal
                                                                                onClose={() => setShowNew(false)}
                                                                                onCreated={_id => { setShowNew(false); load() }}
                                                                              />
                                                                  )}
                                                  {selected && (
                                                                    <LeadDetailModal
                                                                                lead={selected}
                                                                                onClose={() => setSelected(null)}
                                                                                onUpdated={() => { setSelected(null); load() }}
                                                                              />
                                                                  )}
                                                </SectionHeader>div>
                                            )
                                            }</div>
