// ═══════════════════════════════════════════════════════════════════════════
// MiEspacio — panel personal del Dashboard (DG)
//   A) Mis pendientes            → action_items (area='DG', source_type='dashboard')
//   B) Prospectos por contactar  → tabla prospectos (clientes pre-lead)
//   C) Radar de seguimiento      → interacciones vencidas / conversaciones frías
//                                   (prospectos + leads/arquitectos)
//   Bitácora por contacto (tabla interacciones): fecha, canal, resumen,
//   próximo paso y próxima fecha de seguimiento. Respeta privacidad: tú
//   decides qué se registra (no lee tu WhatsApp).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Plus, Check, Trash2, Phone, Mail, MapPin, ChevronDown, ChevronRight, UserPlus, Calendar, MessageCircle, Clock, ExternalLink, Sparkles, Upload } from 'lucide-react'

// ── estilos base ──
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
const CANAL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', llamada: 'Llamada', correo: 'Correo', reunion: 'Reunión', mensaje: 'Mensaje', otro: 'Otro' }

interface Pendiente { id: string; title: string; status: string; priority: number; due_date: string | null }
interface Prospecto {
  id: string; nombre: string; empresa: string | null; telefono: string | null; email: string | null
  canal: string | null; notas: string | null; estado: string; prioridad: number; proxima_accion: string | null; lead_id: string | null
}
interface Interaccion {
  id: string; entity_type: string; entity_id: string; fecha: string; canal: string
  resumen: string | null; proximo_paso: string | null; proxima_fecha: string | null; created_at: string
}
interface LeadLite { id: string; name: string; company: string | null; contact_name: string | null; status: string }

const HOY = () => new Date().toISOString().slice(0, 10)
function diasDesde(fecha: string): number {
  const d = new Date(fecha + 'T00:00:00'); const now = new Date(HOY() + 'T00:00:00')
  return Math.round((now.getTime() - d.getTime()) / 86400000)
}

export default function MiEspacio({ userId, employeeId, isMobile = false }: { userId?: string; employeeId?: string | null; isMobile?: boolean }) {
  const navigate = useNavigate()
  const hoy = HOY()

  // ══════════════════ PENDIENTES ══════════════════
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [nuevoPend, setNuevoPend] = useState('')
  const [nuevoPendFecha, setNuevoPendFecha] = useState('')
  const [nuevoPendPrio, setNuevoPendPrio] = useState(2)
  const [showDonePend, setShowDonePend] = useState(false)

  async function loadPendientes() {
    const { data } = await supabase.from('action_items').select('id, title, status, priority, due_date')
      .eq('area', 'DG').eq('source_type', 'dashboard').order('created_at', { ascending: false })
    setPendientes((data || []) as Pendiente[])
  }
  async function addPendiente() {
    const t = nuevoPend.trim(); if (!t) return
    setNuevoPend(''); setNuevoPendFecha(''); setNuevoPendPrio(2)
    await supabase.from('action_items').insert({ title: t, area: 'DG', source_type: 'dashboard', status: 'pendiente', priority: nuevoPendPrio, due_date: nuevoPendFecha || null, created_by: employeeId || null })
    loadPendientes()
  }
  async function togglePendiente(p: Pendiente) {
    const done = p.status === 'completada'
    await supabase.from('action_items').update({ status: done ? 'pendiente' : 'completada', completed_at: done ? null : new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', p.id)
    loadPendientes()
  }
  async function delPendiente(id: string) { await supabase.from('action_items').delete().eq('id', id); loadPendientes() }
  const pendVisibles = useMemo(() => pendientes.filter(p => showDonePend ? true : p.status !== 'completada'), [pendientes, showDonePend])
  const pendAbiertas = pendientes.filter(p => p.status !== 'completada').length

  // ══════════════════ PROSPECTOS + INTERACCIONES + LEADS ══════════════════
  const [prospectos, setProspectos] = useState<Prospecto[]>([])
  const [interacciones, setInteracciones] = useState<Interaccion[]>([])
  const [leads, setLeads] = useState<LeadLite[]>([])
  const [showAddProsp, setShowAddProsp] = useState(false)
  const [showCerrados, setShowCerrados] = useState(false)
  const [expandProsp, setExpandProsp] = useState<string | null>(null)
  const [np, setNp] = useState({ nombre: '', empresa: '', telefono: '', email: '', canal: '', proxima_accion: '', prioridad: 2, notas: '' })

  // ── Captura con IA (screenshot / texto / URL) ──
  const [showCapture, setShowCapture] = useState(false)
  const [capImg, setCapImg] = useState<{ data: string; media: string; preview: string } | null>(null)
  const [capText, setCapText] = useState('')
  const [capWeb, setCapWeb] = useState(false)
  const [capLoading, setCapLoading] = useState(false)
  const [capError, setCapError] = useState('')

  function fileToImg(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      setCapImg({ data: dataUrl.split(',')[1] || '', media: file.type || 'image/png', preview: dataUrl })
    }
    reader.readAsDataURL(file)
  }
  function onPasteCap(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items || [])
    for (const it of items) {
      if (it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { fileToImg(f); e.preventDefault(); return } }
    }
  }
  async function extraerConIA() {
    if (!capImg && !capText.trim()) { setCapError('Pega un screenshot o algo de texto/URL primero.'); return }
    setCapLoading(true); setCapError('')
    const jsonShape = `{
  "nombre": "nombre de la persona o del despacho/estudio ('' si no hay)",
  "empresa": "despacho/estudio/empresa si aplica",
  "telefono": "con lada si aparece, si no ''",
  "email": "",
  "instagram": "@handle o URL de instagram si aparece",
  "web": "sitio web si aparece",
  "canal": "cómo contactarlo / dónde se encontró (ej. 'Instagram @estudio', 'DM de Instagram', 'página web', 'referido')",
  "notas": "resumen útil: a qué se dedican, ciudad, tipo de proyecto que podrían traer, # de seguidores, etc."
}`
    const instruccion = `Eres asistente comercial de OMM (integración/automatización, iluminación, audio, CCTV, cortinas para arquitectura de alto nivel). Del screenshot y/o texto de un posible cliente (arquitecto, despacho, interiorista), extrae sus datos de contacto para darle seguimiento.${capWeb ? ' Si falta teléfono, correo o sitio web, búscalo en internet a partir del nombre/handle.' : ''} Devuelve EXCLUSIVAMENTE un objeto JSON con esta forma (sin texto adicional ni markdown):\n${jsonShape}\n\nContexto/texto del usuario:\n${capText || '(sin texto, usa solo la imagen)'}`
    const content: any[] = []
    if (capImg) content.push({ type: 'image', source: { type: 'base64', media_type: capImg.media, data: capImg.data } })
    content.push({ type: 'text', text: instruccion })
    const payload: any = { model: 'claude-sonnet-4-6', max_tokens: 1200, messages: [{ role: 'user', content }] }
    if (capWeb) payload.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
    const call = async (p: any) => (await fetch('/api/anthropic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })).json()
    try {
      let data = await call(payload)
      if (data.error && capWeb) { const p2 = { ...payload }; delete p2.tools; data = await call(p2) } // fallback si web_search no está disponible
      if (data.error) throw new Error(data.error.message || 'Error de IA')
      const txt = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      const s = txt.indexOf('{'), e = txt.lastIndexOf('}')
      if (s === -1 || e === -1) throw new Error('La IA no devolvió datos claros. Prueba con un screenshot más nítido.')
      const j = JSON.parse(txt.slice(s, e + 1))
      const canal = j.canal || [j.instagram, j.web].filter(Boolean).join(' · ')
      setNp({ nombre: j.nombre || '', empresa: j.empresa || '', telefono: j.telefono || '', email: j.email || '', canal: canal || '', notas: j.notas || '', prioridad: 2, proxima_accion: '' })
      setShowCapture(false); setShowAddProsp(true); setCapImg(null); setCapText(''); setCapWeb(false)
    } catch (err: any) {
      setCapError(err.message || 'No se pudo extraer. Puedes capturarlo manual.')
    } finally { setCapLoading(false) }
  }

  async function loadProspectos() {
    const { data } = await supabase.from('prospectos')
      .select('id, nombre, empresa, telefono, email, canal, notas, estado, prioridad, proxima_accion, lead_id')
      .order('prioridad', { ascending: false }).order('created_at', { ascending: false })
    setProspectos((data || []) as Prospecto[])
  }
  async function loadInteracciones() {
    const { data } = await supabase.from('interacciones')
      .select('id, entity_type, entity_id, fecha, canal, resumen, proximo_paso, proxima_fecha, created_at')
      .order('fecha', { ascending: false }).order('created_at', { ascending: false })
    setInteracciones((data || []) as Interaccion[])
  }
  async function loadLeads() {
    const { data } = await supabase.from('leads').select('id, name, company, contact_name, status')
    setLeads((data || []) as LeadLite[])
  }

  // mapa entidad -> interacciones (ya ordenadas por fecha desc)
  const interByEntity = useMemo(() => {
    const m: Record<string, Interaccion[]> = {}
    for (const it of interacciones) { const k = `${it.entity_type}:${it.entity_id}`; (m[k] ||= []).push(it) }
    return m
  }, [interacciones])

  async function addProspecto() {
    // Muchos prospectos son despachos: si no hay nombre de persona, se guarda con la empresa.
    const nombre = np.nombre.trim() || np.empresa.trim()
    if (!nombre) { alert('Pon al menos un nombre o una empresa.'); return }
    await supabase.from('prospectos').insert({
      nombre, empresa: np.empresa.trim() || null, telefono: np.telefono.trim() || null,
      email: np.email.trim() || null, canal: np.canal.trim() || null, notas: np.notas.trim() || null,
      prioridad: np.prioridad, proxima_accion: np.proxima_accion || null, estado: 'por_contactar', created_by: userId || null,
    })
    setNp({ nombre: '', empresa: '', telefono: '', email: '', canal: '', proxima_accion: '', prioridad: 2, notas: '' })
    setShowAddProsp(false); loadProspectos()
  }
  async function updateProspecto(id: string, patch: Partial<Prospecto>) {
    await supabase.from('prospectos').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id); loadProspectos()
  }
  async function delProspecto(id: string) {
    if (!confirm('¿Borrar este prospecto?')) return
    await supabase.from('prospectos').delete().eq('id', id); loadProspectos()
  }
  async function convertirALead(p: Prospecto) {
    if (p.lead_id) { navigate(`/crm/${p.lead_id}`); return }
    if (!confirm(`Convertir "${p.nombre}" en lead real del CRM?`)) return
    const notasLead = [p.notas, p.canal ? `Contacto vía: ${p.canal}` : ''].filter(Boolean).join('\n')
    const { data, error } = await supabase.from('leads').insert({
      name: p.empresa || p.nombre, company: p.empresa || null, contact_name: p.nombre,
      contact_phone: p.telefono || null, contact_email: p.email || null, notes: notasLead || null,
      origin: 'prospeccion', status: 'nuevo',
    }).select('id').single()
    if (error) { alert('No se pudo crear el lead: ' + error.message); return }
    // migrar las interacciones del prospecto al lead para no perder el historial
    await supabase.from('interacciones').update({ entity_type: 'lead', entity_id: data!.id }).eq('entity_type', 'prospecto').eq('entity_id', p.id)
    await supabase.from('prospectos').update({ estado: 'convertido', lead_id: data!.id, converted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', p.id)
    navigate(`/crm/${data!.id}`)
  }

  // registrar una interacción (prospecto o lead). Si es prospecto, refresca su próxima acción / estado.
  async function registrarInteraccion(entityType: 'prospecto' | 'lead', entityId: string, vals: { canal: string; resumen: string; proximo_paso: string; proxima_fecha: string }) {
    await supabase.from('interacciones').insert({
      entity_type: entityType, entity_id: entityId, fecha: hoy, canal: vals.canal,
      resumen: vals.resumen.trim() || null, proximo_paso: vals.proximo_paso.trim() || null,
      proxima_fecha: vals.proxima_fecha || null, created_by: userId || null,
    })
    if (entityType === 'prospecto') {
      const prev = prospectos.find(p => p.id === entityId)
      const patch: Partial<Prospecto> = {}
      if (vals.proxima_fecha) patch.proxima_accion = vals.proxima_fecha
      if (prev && prev.estado === 'por_contactar') patch.estado = 'en_conversacion'
      if (Object.keys(patch).length) await supabase.from('prospectos').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', entityId)
    }
    await Promise.all([loadInteracciones(), loadProspectos()])
  }

  const prospVisibles = useMemo(() => prospectos.filter(p => showCerrados ? true : (p.estado !== 'convertido' && p.estado !== 'descartado')), [prospectos, showCerrados])
  const prospActivos = prospectos.filter(p => p.estado !== 'convertido' && p.estado !== 'descartado').length

  // ── RADAR: qué retomar (prospectos activos + leads con historial) ──
  const radar = useMemo(() => {
    type Row = { type: 'prospecto' | 'lead'; id: string; nombre: string; sub: string; lastContact: string | null; nextFollow: string | null; canalUltimo: string | null; motivo: 'vencido' | 'frio' }
    const rows: Row[] = []

    const proxFutura = (its: Interaccion[]) => its.map(i => i.proxima_fecha).filter(Boolean).sort() as string[]

    for (const p of prospectos) {
      if (p.estado === 'convertido' || p.estado === 'descartado') continue
      const its = interByEntity[`prospecto:${p.id}`] || []
      const last = its[0]?.fecha || null
      const futuras = proxFutura(its)
      const nextFollow = futuras.find(f => f >= hoy) || (p.proxima_accion && p.proxima_accion >= hoy ? p.proxima_accion : null)
      const dueDate = (p.proxima_accion && p.proxima_accion <= hoy ? p.proxima_accion : null) || futuras.find(f => f <= hoy) || null
      let motivo: 'vencido' | 'frio' | null = null
      if (dueDate) motivo = 'vencido'
      else if (!nextFollow && last && diasDesde(last) >= 14) motivo = 'frio'
      else if (!nextFollow && !last && p.estado === 'por_contactar') motivo = 'vencido' // nunca contactado
      if (!motivo) continue
      rows.push({ type: 'prospecto', id: p.id, nombre: p.nombre, sub: p.empresa || 'Prospecto', lastContact: last, nextFollow: dueDate || nextFollow, canalUltimo: its[0]?.canal || null, motivo })
    }

    const leadMap = new Map(leads.map(l => [l.id, l]))
    // solo leads con historial de interacciones (evita inundar con todo el CRM)
    const leadIdsConHist = new Set(interacciones.filter(i => i.entity_type === 'lead').map(i => i.entity_id))
    for (const lid of leadIdsConHist) {
      const l = leadMap.get(lid); if (!l) continue
      if (['ganado', 'perdido', 'descartado'].includes((l.status || '').toLowerCase())) continue
      const its = interByEntity[`lead:${lid}`] || []
      const last = its[0]?.fecha || null
      const futuras = proxFutura(its)
      const nextFollow = futuras.find(f => f >= hoy) || null
      const dueDate = futuras.find(f => f <= hoy) || null
      let motivo: 'vencido' | 'frio' | null = null
      if (dueDate) motivo = 'vencido'
      else if (!nextFollow && last && diasDesde(last) >= 14) motivo = 'frio'
      if (!motivo) continue
      rows.push({ type: 'lead', id: lid, nombre: l.contact_name || l.name, sub: l.company || l.name, lastContact: last, nextFollow: dueDate || nextFollow, canalUltimo: its[0]?.canal || null, motivo })
    }

    // orden: vencidos primero (por fecha asc), luego fríos (por último contacto más viejo)
    rows.sort((a, b) => {
      if (a.motivo !== b.motivo) return a.motivo === 'vencido' ? -1 : 1
      if (a.motivo === 'vencido') return (a.nextFollow || '') < (b.nextFollow || '') ? -1 : 1
      return (a.lastContact || '') < (b.lastContact || '') ? -1 : 1
    })
    return rows
  }, [prospectos, leads, interacciones, interByEntity, hoy])

  useEffect(() => { loadPendientes(); loadProspectos(); loadInteracciones(); loadLeads() }, [])

  // ── mini-form de interacción reutilizable ──
  const [logOpen, setLogOpen] = useState<string | null>(null) // key `${type}:${id}`
  const [logVals, setLogVals] = useState({ canal: 'whatsapp', resumen: '', proximo_paso: '', proxima_fecha: '' })
  function abrirLog(key: string) { setLogOpen(key); setLogVals({ canal: 'whatsapp', resumen: '', proximo_paso: '', proxima_fecha: '' }) }
  async function guardarLog(type: 'prospecto' | 'lead', id: string) {
    await registrarInteraccion(type, id, logVals)
    setLogOpen(null)
  }

  function LogForm({ type, id }: { type: 'prospecto' | 'lead'; id: string }) {
    return (
      <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select value={logVals.canal} onChange={e => setLogVals({ ...logVals, canal: e.target.value })} style={{ ...selectStyle, width: 130, flex: '0 0 auto' }}>
            {Object.entries(CANAL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={logVals.resumen} onChange={e => setLogVals({ ...logVals, resumen: e.target.value })} placeholder="¿Qué se habló?" style={{ ...input, flex: '1 1 160px' }} />
        </div>
        <input value={logVals.proximo_paso} onChange={e => setLogVals({ ...logVals, proximo_paso: e.target.value })} placeholder="Próximo paso (ej. mandar propuesta, llamar el jueves)" style={input} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: '#888' }}>Seguir el:</label>
          <input type="date" value={logVals.proxima_fecha} onChange={e => setLogVals({ ...logVals, proxima_fecha: e.target.value })} style={{ ...input, width: 150, flex: '0 0 auto' }} />
          <button onClick={() => guardarLog(type, id)} style={{ marginLeft: 'auto', background: '#57FF9A', border: 'none', color: '#000', borderRadius: 8, padding: '7px 14px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Registrar</button>
          <button onClick={() => setLogOpen(null)} style={btnGhost}>Cancelar</button>
        </div>
      </div>
    )
  }

  function Timeline({ its }: { its: Interaccion[] }) {
    if (!its.length) return null
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
        {its.slice(0, 4).map(it => (
          <div key={it.id} style={{ display: 'flex', gap: 7, fontSize: 11, color: '#999' }}>
            <MessageCircle size={12} style={{ marginTop: 1, flex: '0 0 auto', color: '#57FF9A' }} />
            <div>
              <span style={{ color: '#ccc' }}>{it.fecha}</span> · <span style={{ color: '#888' }}>{CANAL_LABEL[it.canal] || it.canal}</span>
              {it.resumen ? <span> — {it.resumen}</span> : ''}
              {it.proximo_paso ? <div style={{ color: '#777' }}>↳ {it.proximo_paso}{it.proxima_fecha ? ` (${it.proxima_fecha})` : ''}</div> : ''}
            </div>
          </div>
        ))}
        {its.length > 4 && <div style={{ fontSize: 10, color: '#555', paddingLeft: 19 }}>+{its.length - 4} más</div>}
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ══════════ FILA 1: pendientes + prospectos ══════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,1.2fr)', gap: 12 }}>

        {/* PANEL A — MIS PENDIENTES */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Mis pendientes</div>
              <span style={{ fontSize: 11, color: '#666', background: '#1a1a1a', borderRadius: 20, padding: '2px 8px' }}>{pendAbiertas}</span>
            </div>
            <button onClick={() => setShowDonePend(s => !s)} style={{ ...btnGhost, padding: '4px 8px', fontSize: 11 }}>{showDonePend ? 'Ocultar hechas' : 'Ver hechas'}</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <input value={nuevoPend} onChange={e => setNuevoPend(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPendiente() }} placeholder="Agregar pendiente…" style={{ ...input, flex: '1 1 160px' }} />
            <input type="date" value={nuevoPendFecha} onChange={e => setNuevoPendFecha(e.target.value)} style={{ ...input, width: 140, flex: '0 0 auto' }} />
            <select value={nuevoPendPrio} onChange={e => setNuevoPendPrio(Number(e.target.value))} style={{ ...selectStyle, width: 90, flex: '0 0 auto' }}>
              <option value={1}>Baja</option><option value={2}>Media</option><option value={3}>Alta</option>
            </select>
            <button onClick={addPendiente} style={{ background: '#57FF9A', border: 'none', color: '#000', borderRadius: 8, padding: '0 12px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><Plus size={16} /></button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
            {pendVisibles.length === 0 && <div style={{ color: '#555', fontSize: 12, padding: '12px 4px' }}>Sin pendientes. Agrega uno arriba.</div>}
            {pendVisibles.map(p => {
              const done = p.status === 'completada'; const vencida = !done && p.due_date && p.due_date < hoy
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8, background: '#0d0d0d', border: '1px solid #1a1a1a' }}>
                  <button onClick={() => togglePendiente(p)} title="Marcar" style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${done ? '#57FF9A' : '#444'}`, background: done ? '#57FF9A' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', padding: 0 }}>{done && <Check size={12} color="#000" />}</button>
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

        {/* PANEL B — PROSPECTOS POR CONTACTAR */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Prospectos por contactar</div>
              <span style={{ fontSize: 11, color: '#666', background: '#1a1a1a', borderRadius: 20, padding: '2px 8px' }}>{prospActivos}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => setShowCerrados(s => !s)} style={{ ...btnGhost, padding: '4px 8px', fontSize: 11 }}>{showCerrados ? 'Solo activos' : 'Ver todos'}</button>
              <button onClick={() => { setShowCapture(s => !s); setShowAddProsp(false); setCapError('') }} style={{ background: 'transparent', border: '1px solid #2a5a3f', color: '#57FF9A', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><Sparkles size={14} /> Capturar con IA</button>
              <button onClick={() => { setShowAddProsp(s => !s); setShowCapture(false) }} style={{ background: '#57FF9A', border: 'none', color: '#000', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nuevo</button>
            </div>
          </div>

          {showCapture && (
            <div style={{ background: '#0d0d0d', border: '1px solid #1e3a2a', borderRadius: 10, padding: 12, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#57FF9A', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={14} /> Capturar con IA</div>
              <div style={{ fontSize: 11, color: '#888' }}>Pega un screenshot (perfil de Instagram, DM, tarjeta, página web) o pega el link/texto. La IA llena los datos y tú los revisas antes de guardar.</div>
              {capImg && (
                <div style={{ position: 'relative', alignSelf: 'flex-start' }}>
                  <img src={capImg.preview} alt="captura" style={{ maxHeight: 120, borderRadius: 8, border: '1px solid #333' }} />
                  <button onClick={() => setCapImg(null)} style={{ position: 'absolute', top: -8, right: -8, background: '#222', border: '1px solid #444', color: '#fff', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', lineHeight: '18px', padding: 0 }}>×</button>
                </div>
              )}
              <textarea value={capText} onChange={e => setCapText(e.target.value)} onPaste={onPasteCap} placeholder="Pega aquí un screenshot (Ctrl+V) o escribe/pega: link de Instagram, nombre del despacho, notas…" rows={3} style={{ ...input, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ ...btnGhost, cursor: 'pointer' }}><Upload size={13} /> Subir imagen<input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) fileToImg(f) }} style={{ display: 'none' }} /></label>
                <label style={{ fontSize: 12, color: '#aaa', display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}><input type="checkbox" checked={capWeb} onChange={e => setCapWeb(e.target.checked)} /> Buscar también en internet</label>
                <button onClick={extraerConIA} disabled={capLoading} style={{ marginLeft: 'auto', background: '#57FF9A', border: 'none', color: '#000', borderRadius: 8, padding: '7px 16px', fontWeight: 600, fontSize: 13, cursor: capLoading ? 'default' : 'pointer', opacity: capLoading ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{capLoading ? 'Extrayendo…' : 'Extraer datos'}</button>
              </div>
              {capError && <div style={{ fontSize: 11, color: '#DC2626' }}>{capError}</div>}
            </div>
          )}

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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 440, overflowY: 'auto' }}>
            {prospVisibles.length === 0 && <div style={{ color: '#555', fontSize: 12, padding: '12px 4px' }}>Nadie por contactar. Agrega a quien tengas que buscarle cita.</div>}
            {prospVisibles.map(p => {
              const est = EST_CFG[p.estado] || EST_CFG.por_contactar
              const abierto = expandProsp === p.id
              const vencido = p.proxima_accion && p.proxima_accion < hoy && p.estado !== 'convertido' && p.estado !== 'descartado'
              const cerrado = p.estado === 'convertido' || p.estado === 'descartado'
              const its = interByEntity[`prospecto:${p.id}`] || []
              const logKey = `prospecto:${p.id}`
              return (
                <div key={p.id} style={{ borderRadius: 10, background: '#0d0d0d', border: '1px solid #1a1a1a', opacity: cerrado ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', cursor: 'pointer' }} onClick={() => setExpandProsp(abierto ? null : p.id)}>
                    <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: PRIO_COLOR[p.prioridad], flex: '0 0 auto' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.nombre}{p.empresa && p.empresa !== p.nombre ? <span style={{ color: '#888', fontWeight: 400 }}> · {p.empresa}</span> : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, color: est.color, fontWeight: 600 }}>{est.label}</span>
                        {its[0] && <span style={{ fontSize: 11, color: '#777', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={10} />últ. {its[0].fecha}</span>}
                        {p.proxima_accion && <span style={{ fontSize: 11, color: vencido ? '#DC2626' : '#777', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Calendar size={10} />{vencido ? '⚠ ' : ''}{p.proxima_accion}</span>}
                      </div>
                    </div>
                    {abierto ? <ChevronDown size={16} color="#666" /> : <ChevronRight size={16} color="#666" />}
                  </div>

                  {abierto && (
                    <div style={{ padding: '4px 12px 12px', borderTop: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {(p.telefono || p.email || p.canal) && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                          {p.telefono && <span style={{ fontSize: 12, color: '#aaa', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Phone size={12} />{p.telefono}</span>}
                          {p.email && <span style={{ fontSize: 12, color: '#aaa', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Mail size={12} />{p.email}</span>}
                          {p.canal && <span style={{ fontSize: 12, color: '#aaa', display: 'inline-flex', alignItems: 'flex-start', gap: 5 }}><MapPin size={12} style={{ marginTop: 2, flex: '0 0 auto' }} />{p.canal}</span>}
                        </div>
                      )}
                      {p.notas && <div style={{ fontSize: 12, color: '#999', whiteSpace: 'pre-wrap', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 8, padding: 8 }}>{p.notas}</div>}

                      {/* bitácora */}
                      <Timeline its={its} />
                      {logOpen === logKey
                        ? <LogForm type="prospecto" id={p.id} />
                        : <button onClick={() => abrirLog(logKey)} style={{ ...btnGhost, alignSelf: 'flex-start', borderColor: '#2a4', color: '#57FF9A' }}><MessageCircle size={13} /> Registrar interacción</button>}

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid #1a1a1a', paddingTop: 8 }}>
                        <select value={p.estado} onChange={e => updateProspecto(p.id, { estado: e.target.value })} style={{ ...selectStyle, width: 'auto', flex: '0 0 auto' }}>
                          <option value="por_contactar">Por contactar</option>
                          <option value="en_conversacion">En conversación</option>
                          <option value="cita_agendada">Cita agendada</option>
                          <option value="descartado">Descartar</option>
                        </select>
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

      {/* ══════════ FILA 2: RADAR DE SEGUIMIENTO ══════════ */}
      <div style={{ ...card, borderTop: '2px solid #57FF9A' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Radar de seguimiento</div>
          <span style={{ fontSize: 11, color: '#666', background: '#1a1a1a', borderRadius: 20, padding: '2px 8px' }}>{radar.length}</span>
        </div>
        <div style={{ fontSize: 11, color: '#777', marginBottom: 12 }}>Conversaciones a retomar — seguimiento vencido o sin contacto en 14+ días (prospectos y arquitectos del CRM).</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
          {radar.length === 0 && <div style={{ color: '#555', fontSize: 12, padding: '8px 4px' }}>Todo al día. No hay conversaciones frías ni seguimientos vencidos. 🎯</div>}
          {radar.map(r => {
            const logKey = `${r.type}:${r.id}`
            const vencido = r.motivo === 'vencido'
            return (
              <div key={logKey} style={{ borderRadius: 10, background: '#0d0d0d', border: `1px solid ${vencido ? '#3a1f1f' : '#1a1a1a'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: vencido ? '#DC2626' : '#D97706', background: vencido ? '#2a1414' : '#241c10', borderRadius: 6, padding: '3px 7px', flex: '0 0 auto' }}>{vencido ? 'VENCIDO' : 'FRÍO'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.nombre} <span style={{ color: '#888', fontWeight: 400 }}>· {r.sub}</span>
                      <span style={{ fontSize: 10, color: '#555', marginLeft: 6 }}>{r.type === 'lead' ? 'CRM' : 'prospecto'}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
                      {r.lastContact && <span style={{ fontSize: 11, color: '#777', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={10} />últ. {r.lastContact} ({diasDesde(r.lastContact)}d){r.canalUltimo ? ` · ${CANAL_LABEL[r.canalUltimo] || r.canalUltimo}` : ''}</span>}
                      {!r.lastContact && <span style={{ fontSize: 11, color: '#999' }}>sin contacto registrado</span>}
                      {r.nextFollow && <span style={{ fontSize: 11, color: vencido ? '#DC2626' : '#777', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Calendar size={10} />seguir {r.nextFollow}</span>}
                    </div>
                  </div>
                  <button onClick={() => abrirLog(logKey)} style={{ ...btnGhost, borderColor: '#2a4', color: '#57FF9A', flex: '0 0 auto' }}><MessageCircle size={13} /> Registrar</button>
                  {r.type === 'lead' && <button onClick={() => navigate(`/crm/${r.id}`)} style={{ ...btnGhost, flex: '0 0 auto' }} title="Abrir en CRM"><ExternalLink size={13} /></button>}
                </div>
                {logOpen === logKey && <div style={{ padding: '0 10px 10px' }}><LogForm type={r.type} id={r.id} /></div>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
