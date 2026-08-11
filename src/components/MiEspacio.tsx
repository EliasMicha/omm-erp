// ═══════════════════════════════════════════════════════════════════════════
// MiEspacio — panel personal del Dashboard (DG)
//   A) Mis pendientes  → action_items (area='DG', source_type='dashboard')
//   B) Prospectos por contactar → tabla prospectos (clientes pre-lead)
//      Objetivo: capturar gente a la que hay que hablarle para buscar cita /
//      encontrar forma de contacto, ANTES de que exista un lead real.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Plus, Check, Trash2, Phone, Mail, MapPin, ChevronDown, ChevronRight, UserPlus, Calendar } from 'lucide-react'

// ── estilos base (consistentes con el resto del ERP) ──
const card: React.CSSProperties = { background: '#111', border: '1px solid #222', borderRadius: 12, padding: 16 }
const input: React.CSSProperties = { background: '#0a0a0a', border: '1px solid #333', borderRadius: 8, padding: '7px 10px', color: '#fff', fontSize: 13, width: '100%', outline: 'none' }
const selectStyle: React.CSSProperties = { ...input, cursor: 'pointer' }
const btnGhost: React.CSSProperties = { background: 'transparent', border: '1px solid #333', color: '#aaa', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }

const PRIO_LABEL: Record<number, string> = { 1: 'Baja', 2: 'Media', 3: 'Alta' }
const PRIO_COLOR: Record<number, string> = { 1: '#666', 2: '#2563EB', 3: '#DC2626' }

const EST_CFG: Record<string, { label: string; color: string }> = {
  por_contactar: { label: 'Por contactar', color: '#D97706' },
  en_conversacion: { label: 'En conversación', color: '#2563EB' },
  cita_agendada: { label: 'Cita agendada', color: '#10B981' },
  convertido: { label: 'Convertido', color: '#57FF9A' },
  descartado: { label: 'Descartado', color: '#555' },
}

interface Pendiente {
  id: string
  title: string
  status: string
  priority: number
  due_date: string | null
}
interface Prospecto {
  id: string
  nombre: string
  empresa: string | null
  telefono: string | null
  email: string | null
  canal: string | null
  notas: string | null
  estado: string
  prioridad: number
  proxima_accion: string | null
  lead_id: string | null
}

export default function MiEspacio({ userId, employeeId, isMobile = false }: { userId?: string; employeeId?: string | null; isMobile?: boolean }) {
  const navigate = useNavigate()

  // ══════════════════ PENDIENTES ══════════════════
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [nuevoPend, setNuevoPend] = useState('')
  const [nuevoPendFecha, setNuevoPendFecha] = useState('')
  const [nuevoPendPrio, setNuevoPendPrio] = useState(2)
  const [showDonePend, setShowDonePend] = useState(false)

  async function loadPendientes() {
    const { data } = await supabase
      .from('action_items')
      .select('id, title, status, priority, due_date')
      .eq('area', 'DG')
      .eq('source_type', 'dashboard')
      .order('created_at', { ascending: false })
    setPendientes((data || []) as Pendiente[])
  }

  async function addPendiente() {
    const t = nuevoPend.trim()
    if (!t) return
    setNuevoPend(''); setNuevoPendFecha(''); setNuevoPendPrio(2)
    await supabase.from('action_items').insert({
      title: t, area: 'DG', source_type: 'dashboard', status: 'pendiente',
      priority: nuevoPendPrio, due_date: nuevoPendFecha || null,
      created_by: employeeId || null,
    })
    loadPendientes()
  }

  async function togglePendiente(p: Pendiente) {
    const done = p.status === 'completada'
    await supabase.from('action_items').update({
      status: done ? 'pendiente' : 'completada',
      completed_at: done ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', p.id)
    loadPendientes()
  }

  async function delPendiente(id: string) {
    await supabase.from('action_items').delete().eq('id', id)
    loadPendientes()
  }

  const pendVisibles = useMemo(
    () => pendientes.filter(p => showDonePend ? true : p.status !== 'completada'),
    [pendientes, showDonePend]
  )
  const pendAbiertas = pendientes.filter(p => p.status !== 'completada').length

  // ══════════════════ PROSPECTOS ══════════════════
  const [prospectos, setProspectos] = useState<Prospecto[]>([])
  const [showAddProsp, setShowAddProsp] = useState(false)
  const [showCerrados, setShowCerrados] = useState(false)
  const [expandProsp, setExpandProsp] = useState<string | null>(null)
  const [np, setNp] = useState({ nombre: '', empresa: '', telefono: '', email: '', canal: '', proxima_accion: '', prioridad: 2, notas: '' })

  async function loadProspectos() {
    const { data } = await supabase
      .from('prospectos')
      .select('id, nombre, empresa, telefono, email, canal, notas, estado, prioridad, proxima_accion, lead_id')
      .order('prioridad', { ascending: false })
      .order('created_at', { ascending: false })
    setProspectos((data || []) as Prospecto[])
  }

  async function addProspecto() {
    if (!np.nombre.trim()) return
    await supabase.from('prospectos').insert({
      nombre: np.nombre.trim(),
      empresa: np.empresa.trim() || null,
      telefono: np.telefono.trim() || null,
      email: np.email.trim() || null,
      canal: np.canal.trim() || null,
      notas: np.notas.trim() || null,
      prioridad: np.prioridad,
      proxima_accion: np.proxima_accion || null,
      estado: 'por_contactar',
      created_by: userId || null,
    })
    setNp({ nombre: '', empresa: '', telefono: '', email: '', canal: '', proxima_accion: '', prioridad: 2, notas: '' })
    setShowAddProsp(false)
    loadProspectos()
  }

  async function updateProspecto(id: string, patch: Partial<Prospecto>) {
    await supabase.from('prospectos').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    loadProspectos()
  }

  async function delProspecto(id: string) {
    if (!confirm('¿Borrar este prospecto?')) return
    await supabase.from('prospectos').delete().eq('id', id)
    loadProspectos()
  }

  async function convertirALead(p: Prospecto) {
    if (p.lead_id) { navigate(`/crm/${p.lead_id}`); return }
    if (!confirm(`Convertir "${p.nombre}" en lead real del CRM?`)) return
    const notasLead = [p.notas, p.canal ? `Contacto vía: ${p.canal}` : ''].filter(Boolean).join('\n')
    const { data, error } = await supabase.from('leads').insert({
      name: p.empresa || p.nombre,
      company: p.empresa || null,
      contact_name: p.nombre,
      contact_phone: p.telefono || null,
      contact_email: p.email || null,
      notes: notasLead || null,
      origin: 'prospeccion',
      status: 'nuevo',
    }).select('id').single()
    if (error) { alert('No se pudo crear el lead: ' + error.message); return }
    await supabase.from('prospectos').update({
      estado: 'convertido', lead_id: data!.id, converted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', p.id)
    navigate(`/crm/${data!.id}`)
  }

  const prospVisibles = useMemo(
    () => prospectos.filter(p => showCerrados ? true : (p.estado !== 'convertido' && p.estado !== 'descartado')),
    [prospectos, showCerrados]
  )
  const prospActivos = prospectos.filter(p => p.estado !== 'convertido' && p.estado !== 'descartado').length

  useEffect(() => { loadPendientes(); loadProspectos() }, [])

  const hoy = new Date().toISOString().slice(0, 10)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.2fr', gap: 12, marginBottom: 24 }}>

      {/* ══════════════ PANEL A — MIS PENDIENTES ══════════════ */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Mis pendientes</div>
            <span style={{ fontSize: 11, color: '#666', background: '#1a1a1a', borderRadius: 20, padding: '2px 8px' }}>{pendAbiertas}</span>
          </div>
          <button onClick={() => setShowDonePend(s => !s)} style={{ ...btnGhost, padding: '4px 8px', fontSize: 11 }}>
            {showDonePend ? 'Ocultar hechas' : 'Ver hechas'}
          </button>
        </div>

        {/* quick add */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <input
            value={nuevoPend}
            onChange={e => setNuevoPend(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addPendiente() }}
            placeholder="Agregar pendiente…"
            style={{ ...input, flex: '1 1 160px' }}
          />
          <input type="date" value={nuevoPendFecha} onChange={e => setNuevoPendFecha(e.target.value)} style={{ ...input, width: 140, flex: '0 0 auto' }} />
          <select value={nuevoPendPrio} onChange={e => setNuevoPendPrio(Number(e.target.value))} style={{ ...selectStyle, width: 90, flex: '0 0 auto' }}>
            <option value={1}>Baja</option><option value={2}>Media</option><option value={3}>Alta</option>
          </select>
          <button onClick={addPendiente} style={{ background: '#57FF9A', border: 'none', color: '#000', borderRadius: 8, padding: '0 12px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <Plus size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
          {pendVisibles.length === 0 && <div style={{ color: '#555', fontSize: 12, padding: '12px 4px' }}>Sin pendientes. Agrega uno arriba.</div>}
          {pendVisibles.map(p => {
            const done = p.status === 'completada'
            const vencida = !done && p.due_date && p.due_date < hoy
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8, background: '#0d0d0d', border: '1px solid #1a1a1a' }}>
                <button onClick={() => togglePendiente(p)} title="Marcar" style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${done ? '#57FF9A' : '#444'}`, background: done ? '#57FF9A' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', padding: 0 }}>
                  {done && <Check size={12} color="#000" />}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: done ? '#666' : '#eee', textDecoration: done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                  {p.due_date && <div style={{ fontSize: 10, color: vencida ? '#DC2626' : '#777', marginTop: 1 }}>{vencida ? '⚠ ' : ''}{p.due_date}</div>}
                </div>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIO_COLOR[p.priority] || '#666', flex: '0 0 auto' }} title={PRIO_LABEL[p.priority]} />
                <button onClick={() => delPendiente(p.id)} style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: 2 }}><Trash2 size={13} /></button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ══════════════ PANEL B — PROSPECTOS POR CONTACTAR ══════════════ */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Prospectos por contactar</div>
            <span style={{ fontSize: 11, color: '#666', background: '#1a1a1a', borderRadius: 20, padding: '2px 8px' }}>{prospActivos}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setShowCerrados(s => !s)} style={{ ...btnGhost, padding: '4px 8px', fontSize: 11 }}>
              {showCerrados ? 'Solo activos' : 'Ver todos'}
            </button>
            <button onClick={() => setShowAddProsp(s => !s)} style={{ background: '#57FF9A', border: 'none', color: '#000', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Plus size={14} /> Nuevo
            </button>
          </div>
        </div>

        {/* formulario nuevo prospecto */}
        {showAddProsp && (
          <div style={{ background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 10, padding: 12, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
              <input value={np.nombre} onChange={e => setNp({ ...np, nombre: e.target.value })} placeholder="Nombre / contacto *" style={input} />
              <input value={np.empresa} onChange={e => setNp({ ...np, empresa: e.target.value })} placeholder="Empresa / despacho" style={input} />
              <input value={np.telefono} onChange={e => setNp({ ...np, telefono: e.target.value })} placeholder="Teléfono (si lo tienes)" style={input} />
              <input value={np.email} onChange={e => setNp({ ...np, email: e.target.value })} placeholder="Email (si lo tienes)" style={input} />
            </div>
            <input value={np.canal} onChange={e => setNp({ ...np, canal: e.target.value })} placeholder="¿Cómo lo contacto? (referido por…, Instagram, lo vi en obra, buscar en LinkedIn…)" style={input} />
            <textarea value={np.notas} onChange={e => setNp({ ...np, notas: e.target.value })} placeholder="Notas: por qué me interesa, qué proyecto trae, etc." rows={2} style={{ ...input, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, color: '#888' }}>Seguir el:</label>
              <input type="date" value={np.proxima_accion} onChange={e => setNp({ ...np, proxima_accion: e.target.value })} style={{ ...input, width: 150 }} />
              <select value={np.prioridad} onChange={e => setNp({ ...np, prioridad: Number(e.target.value) })} style={{ ...selectStyle, width: 110 }}>
                <option value={1}>Prio. Baja</option><option value={2}>Prio. Media</option><option value={3}>Prio. Alta</option>
              </select>
              <button onClick={addProspecto} style={{ marginLeft: 'auto', background: '#57FF9A', border: 'none', color: '#000', borderRadius: 8, padding: '7px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Guardar</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflowY: 'auto' }}>
          {prospVisibles.length === 0 && <div style={{ color: '#555', fontSize: 12, padding: '12px 4px' }}>Nadie por contactar. Agrega a quien tengas que buscarle cita.</div>}
          {prospVisibles.map(p => {
            const est = EST_CFG[p.estado] || EST_CFG.por_contactar
            const abierto = expandProsp === p.id
            const vencido = p.proxima_accion && p.proxima_accion < hoy && p.estado !== 'convertido' && p.estado !== 'descartado'
            const cerrado = p.estado === 'convertido' || p.estado === 'descartado'
            return (
              <div key={p.id} style={{ borderRadius: 10, background: '#0d0d0d', border: '1px solid #1a1a1a', opacity: cerrado ? 0.6 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', cursor: 'pointer' }} onClick={() => setExpandProsp(abierto ? null : p.id)}>
                  <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: PRIO_COLOR[p.prioridad], flex: '0 0 auto' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.nombre}{p.empresa ? <span style={{ color: '#888', fontWeight: 400 }}> · {p.empresa}</span> : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: est.color, fontWeight: 600 }}>{est.label}</span>
                      {p.proxima_accion && <span style={{ fontSize: 11, color: vencido ? '#DC2626' : '#777', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Calendar size={10} />{vencido ? '⚠ ' : ''}{p.proxima_accion}</span>}
                      {p.telefono && <span style={{ fontSize: 11, color: '#777', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Phone size={10} />{p.telefono}</span>}
                    </div>
                  </div>
                  {abierto ? <ChevronDown size={16} color="#666" /> : <ChevronRight size={16} color="#666" />}
                </div>

                {abierto && (
                  <div style={{ padding: '4px 12px 12px', borderTop: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(p.email || p.canal) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                        {p.email && <span style={{ fontSize: 12, color: '#aaa', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Mail size={12} />{p.email}</span>}
                        {p.canal && <span style={{ fontSize: 12, color: '#aaa', display: 'inline-flex', alignItems: 'flex-start', gap: 5 }}><MapPin size={12} style={{ marginTop: 2, flex: '0 0 auto' }} />{p.canal}</span>}
                      </div>
                    )}
                    {p.notas && <div style={{ fontSize: 12, color: '#999', whiteSpace: 'pre-wrap', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 8, padding: 8 }}>{p.notas}</div>}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select value={p.estado} onChange={e => updateProspecto(p.id, { estado: e.target.value })} style={{ ...selectStyle, width: 'auto', flex: '0 0 auto' }}>
                        <option value="por_contactar">Por contactar</option>
                        <option value="en_conversacion">En conversación</option>
                        <option value="cita_agendada">Cita agendada</option>
                        <option value="descartado">Descartar</option>
                      </select>
                      <label style={{ fontSize: 11, color: '#777' }}>Seguir:</label>
                      <input type="date" value={p.proxima_accion || ''} onChange={e => updateProspecto(p.id, { proxima_accion: e.target.value || null })} style={{ ...input, width: 140, flex: '0 0 auto' }} />
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                      <button onClick={() => convertirALead(p)} style={{ background: '#57FF9A', border: 'none', color: '#000', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <UserPlus size={13} /> {p.lead_id ? 'Ver lead' : 'Convertir a lead'}
                      </button>
                      <button onClick={() => delProspecto(p.id)} style={{ ...btnGhost, marginLeft: 'auto' }}><Trash2 size={13} /> Borrar</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
