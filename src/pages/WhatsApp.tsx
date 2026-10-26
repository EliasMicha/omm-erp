import { useEffect, useState } from 'react'
import { MessageCircle, RefreshCw, Send, Trash2, Copy, CheckCircle2, TriangleAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Conversaciones from '../components/whatsapp/Conversaciones'

// WhatsApp Cloud API — número dedicado de OMM.
// Entrantes: Edge Function whatsapp-webhook (equipo → agente; clientes → tickets de mantenimiento).
// Salientes: Edge Function whatsapp-send (plantillas, avisos de visita).

const WEBHOOK_URL = 'https://ubbumxommqjcpdozpunf.supabase.co/functions/v1/whatsapp-webhook'

interface AgentContact { id: string; phone_e164: string; display_name: string; role: string; employee_id: string | null; is_active: boolean }
interface Employee { id: string; name: string | null; nombre: string | null; phone: string | null; telefono_personal: string | null; area: string | null }
interface Template { name: string; status: string; language: string; rejected_reason?: string }
interface StatusResp {
  ok: boolean; configured: boolean; waba_id: string | null; error: string | null; expected: string[]
  phone: { id: string; display_phone_number: string; verified_name: string; quality_rating: string; code_verification_status: string; name_status: string } | null
  templates: Template[]
}

const card: React.CSSProperties = { background: '#141414', border: '1px solid #252525', borderRadius: 12, padding: 18, marginBottom: 16 }
const input: React.CSSProperties = { background: '#0d0d0d', border: '1px solid #2b2b2b', borderRadius: 8, padding: '8px 10px', color: '#ddd', fontSize: 13, fontFamily: 'inherit' }
const btn: React.CSSProperties = { border: 0, borderRadius: 8, padding: '8px 14px', background: '#25D366', color: '#071b0e', fontWeight: 700, cursor: 'pointer', fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }
const btnGhost: React.CSSProperties = { ...btn, background: '#1d1d1d', color: '#bbb', border: '1px solid #333', fontWeight: 500 }
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', color: '#666', fontSize: 11, fontWeight: 500, borderBottom: '1px solid #222' }
const td: React.CSSProperties = { padding: '7px 8px', color: '#ccc', fontSize: 12.5, borderBottom: '1px solid #1c1c1c', verticalAlign: 'top' }

const STATUS_COLOR: Record<string, string> = { APPROVED: '#57FF9A', PENDING: '#fbbf24', REJECTED: '#f87171', recibido: '#60a5fa', enviado: '#bbb', entregado: '#57FF9A', leido: '#57FF9A', fallido: '#f87171' }

function normPhone(p: string): string {
  const d = (p || '').replace(/\D/g, '')
  const ten = d.slice(-10)
  if (ten.length < 10) return ''
  return '+52' + ten
}
function empName(e: Employee | undefined) { return e ? (e.nombre || e.name || '') : '' }

async function callSend(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('whatsapp-send', { body: payload })
  if (error) {
    let msg = error.message
    try { const ctx = (error as any).context; if (ctx?.json) { const b = await ctx.json(); msg = b.error || msg } } catch (_) { /* nada */ }
    throw new Error(msg)
  }
  return data
}

export default function WhatsApp() {
  const [status, setStatus] = useState(null as StatusResp | null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [contacts, setContacts] = useState([] as AgentContact[])
  const [employees, setEmployees] = useState([] as Employee[])
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('wa_tab') || 'chats' } catch { return 'chats' } })
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [form, setForm] = useState({ employee_id: '', display_name: '', phone: '', role: 'interno' })
  const [test, setTest] = useState({ to: '', text: 'prueba de conexión del ERP' })

  async function loadStatus() {
    setStatusLoading(true)
    try { setStatus(await callSend({ action: 'status' })) }
    catch (e) { setStatus({ ok: false, configured: false, waba_id: null, error: e instanceof Error ? e.message : String(e), expected: [], phone: null, templates: [] }) }
    finally { setStatusLoading(false) }
  }
  async function loadContacts() {
    const { data, error: err } = await supabase.from('agent_contacts').select('id, phone_e164, display_name, role, employee_id, is_active').order('display_name')
    if (err) setError('Equipo: ' + err.message); else setContacts((data || []) as AgentContact[])
  }
  async function loadEmployees() {
    const { data } = await supabase.from('employees').select('id, name, nombre, phone, telefono_personal, area').eq('activo', true).order('nombre')
    setEmployees((data || []) as Employee[])
  }
  useEffect(() => { loadStatus(); loadContacts(); loadEmployees() }, [])
  function cambiarTab(t: string) { setTab(t); try { localStorage.setItem('wa_tab', t) } catch { /* nada */ } }

  async function setupTemplates() {
    setBusy('tpl'); setError(''); setNotice('')
    try {
      const r = await callSend({ action: 'setup_templates' })
      const bad = (r.results || []).filter((x: any) => x.ok === false)
      if (bad.length) setError(bad.map((x: any) => `${x.name}: ${x.error}`).join(' · '))
      else setNotice('Plantillas enviadas a Meta. La aprobación suele tardar de minutos a unas horas.')
      loadStatus()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy('') }
  }

  async function addContact() {
    setError(''); setNotice('')
    const phone = normPhone(form.phone)
    if (!phone) { setError('Teléfono inválido: necesito 10 dígitos'); return }
    if (!form.display_name.trim()) { setError('Pon el nombre'); return }
    if (contacts.some(c => c.phone_e164.replace(/\D/g, '').slice(-10) === phone.slice(-10))) { setError('Ese teléfono ya está autorizado'); return }
    setBusy('add')
    const { error: err } = await supabase.from('agent_contacts').insert({
      phone_e164: phone, display_name: form.display_name.trim(), role: form.role,
      employee_id: form.employee_id || null, is_active: true,
    })
    setBusy('')
    if (err) { setError(err.message); return }
    setForm({ employee_id: '', display_name: '', phone: '', role: 'interno' })
    setNotice('Autorizado. Ya puede escribirle al número de OMM.')
    loadContacts()
  }

  async function toggleContact(c: AgentContact) {
    const { error: err } = await supabase.from('agent_contacts').update({ is_active: !c.is_active }).eq('id', c.id)
    if (err) setError(err.message); else loadContacts()
  }
  async function removeContact(c: AgentContact) {
    if (c.role === 'admin') { setError('Al admin no se le quita desde aquí; desactívalo si hace falta.'); return }
    const { error: err } = await supabase.from('agent_contacts').delete().eq('id', c.id)
    if (err) setError(err.message); else loadContacts()
  }

  async function sendTest() {
    setError(''); setNotice('')
    const phone = normPhone(test.to)
    if (!phone) { setError('Teléfono de prueba inválido'); return }
    setBusy('test')
    try {
      const r = await callSend({ action: 'send_template', to: phone, template: 'omm_aviso_equipo', params: ['equipo', test.text], sender_type: 'equipo' })
      if (r.ok) setNotice('Enviado a ' + r.to + '. Revisa el teléfono.')
      else setError('Meta rechazó el envío: ' + r.error)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy('') }
  }

  function pickEmployee(id: string) {
    const e = employees.find(x => x.id === id)
    setForm(f => ({ ...f, employee_id: id, display_name: e ? empName(e) : f.display_name, phone: e?.phone || e?.telefono_personal || f.phone }))
  }

  const tplByName: Record<string, Template> = {}
  ;(status?.templates || []).forEach(t => { tplByName[t.name] = t })
  const missingTpl = (status?.expected || []).filter(n => !tplByName[n])

  return (
    <div style={{ padding: '28px 36px', maxWidth: tab === 'chats' ? 1400 : 1150 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, display: 'grid', placeItems: 'center', background: '#25D36620', color: '#25D366' }}><MessageCircle size={24} /></div>
        <div>
          <h1 style={{ margin: 0, color: '#fff', fontSize: 22 }}>WhatsApp</h1>
          <div style={{ color: '#777', fontSize: 12.5, marginTop: 3 }}>Cloud API · número dedicado de OMM · agente del equipo, tickets de clientes y avisos</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['chats', 'Conversaciones'], ['config', 'Configuración']].map(([k, l]) => (
          <button key={k} onClick={() => cambiarTab(k)} style={{ ...btnGhost, borderColor: tab === k ? '#25D366' : '#333', color: tab === k ? '#25D366' : '#999' }}>{l}</button>
        ))}
      </div>

      {error && <div style={{ padding: '10px 14px', borderRadius: 9, background: '#ef444416', border: '1px solid #ef444444', color: '#f87171', fontSize: 13, marginBottom: 14 }}>{error}</div>}
      {notice && <div style={{ padding: '10px 14px', borderRadius: 9, background: '#10B98116', border: '1px solid #10B98144', color: '#6ee7b7', fontSize: 13, marginBottom: 14 }}>{notice}</div>}

      {tab === 'chats' && <Conversaciones enviar={callSend} />}

      {tab === 'config' && <>
      {/* Conexión */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Conexión</div>
          <button style={btnGhost} onClick={loadStatus}><RefreshCw size={14} /> Revisar</button>
        </div>
        {statusLoading ? <div style={{ color: '#777', fontSize: 13 }}>Consultando a Meta…</div> : status?.configured && status.phone ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Detail label="Número" value={status.phone.display_phone_number} ok />
            <Detail label="Nombre verificado" value={`${status.phone.verified_name} (${status.phone.name_status || '—'})`} />
            <Detail label="Calidad" value={status.phone.quality_rating || '—'} />
            <Detail label="Verificación" value={status.phone.code_verification_status || '—'} />
            <Detail label="Phone number ID" value={status.phone.id} mono />
            <Detail label="WABA ID" value={status.waba_id || 'falta WHATSAPP_WABA_ID'} mono />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, color: '#fbbf24', fontSize: 13 }}>
            <TriangleAlert size={16} /> <span>Sin conexión con Meta todavía. {status?.error ? <code style={{ color: '#999' }}>{status.error}</code> : null}</span>
          </div>
        )}
        <div style={{ marginTop: 14, color: '#777', fontSize: 12 }}>Webhook (Meta → App → WhatsApp → Configuración)</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 5 }}>
          <code style={{ flex: 1, padding: '8px 10px', border: '1px solid #2b2b2b', background: '#0d0d0d', color: '#bbb', borderRadius: 8, fontSize: 12, overflowWrap: 'anywhere' }}>{WEBHOOK_URL}</code>
          <button style={btnGhost} onClick={() => { navigator.clipboard.writeText(WEBHOOK_URL); setNotice('URL copiada') }}><Copy size={14} /></button>
        </div>
      </div>

      {/* Plantillas */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Plantillas</div>
            <div style={{ color: '#777', fontSize: 12, marginTop: 3 }}>Meta exige plantilla aprobada para escribirle a alguien que no te ha escrito en 24 h.</div>
          </div>
          <button style={{ ...btn, opacity: busy === 'tpl' || !status?.configured ? 0.5 : 1 }} disabled={busy === 'tpl' || !status?.configured} onClick={setupTemplates}>
            {missingTpl.length ? `Crear ${missingTpl.length} en Meta` : 'Revisar en Meta'}
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Plantilla</th><th style={th}>Uso</th><th style={th}>Estado</th></tr></thead>
          <tbody>
            {[
              ['omm_visita_programada', 'Al programar visita de mantenimiento (cliente)'],
              ['omm_tecnico_en_camino', 'Cuando el técnico marca "Voy en camino" (cliente)'],
              ['omm_ticket_actualizado', 'Cambio de estado de un ticket (cliente)'],
              ['omm_aviso_equipo', 'Avisos del ERP al equipo / prueba'],
            ].map(([name, uso]) => {
              const t = tplByName[name]
              return (
                <tr key={name}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{name}</td>
                  <td style={td}>{uso}</td>
                  <td style={{ ...td, color: t ? (STATUS_COLOR[t.status] || '#bbb') : '#666' }}>{t ? t.status + (t.rejected_reason && t.rejected_reason !== 'NONE' ? ` (${t.rejected_reason})` : '') : 'no creada'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Equipo autorizado */}
      <div style={card}>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Equipo autorizado para el asistente</div>
        <div style={{ color: '#777', fontSize: 12, margin: '3px 0 12px' }}>Solo estos números hablan con el agente del ERP. Cualquier otro número se trata como cliente (ticket de mantenimiento si está en un Expediente).</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <select style={{ ...input, minWidth: 200 }} value={form.employee_id} onChange={e => pickEmployee(e.target.value)}>
            <option value="">Empleado (opcional)…</option>
            {employees.map(e => <option key={e.id} value={e.id}>{empName(e)}{e.area ? ` · ${e.area}` : ''}</option>)}
          </select>
          <input style={{ ...input, width: 180 }} placeholder="Nombre" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
          <input style={{ ...input, width: 150 }} placeholder="Celular 10 dígitos" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          <select style={input} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="interno">Interno (consultas y tareas)</option>
            <option value="admin">Admin (todo, incl. prefacturas)</option>
          </select>
          <button style={{ ...btn, opacity: busy === 'add' ? 0.5 : 1 }} disabled={busy === 'add'} onClick={addContact}>Autorizar</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Nombre</th><th style={th}>Teléfono</th><th style={th}>Rol</th><th style={th}>Activo</th><th style={th}></th></tr></thead>
          <tbody>
            {contacts.map(c => (
              <tr key={c.id}>
                <td style={td}>{c.display_name}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{c.phone_e164}</td>
                <td style={td}>{c.role}</td>
                <td style={td}><input type="checkbox" checked={c.is_active} onChange={() => toggleContact(c)} /></td>
                <td style={td}>{c.role !== 'admin' && <button style={{ ...btnGhost, padding: '4px 8px' }} onClick={() => removeContact(c)}><Trash2 size={13} /></button>}</td>
              </tr>
            ))}
            {contacts.length === 0 && <tr><td style={td} colSpan={5}>Nadie autorizado.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Prueba */}
      <div style={card}>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Enviar prueba</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...input, width: 160 }} placeholder="Celular 10 dígitos" value={test.to} onChange={e => setTest(t => ({ ...t, to: e.target.value }))} />
          <input style={{ ...input, flex: 1, minWidth: 220 }} value={test.text} onChange={e => setTest(t => ({ ...t, text: e.target.value }))} />
          <button style={{ ...btn, opacity: busy === 'test' ? 0.5 : 1 }} disabled={busy === 'test'} onClick={sendTest}><Send size={14} /> Enviar (plantilla omm_aviso_equipo)</button>
        </div>
      </div>

      </>}
    </div>
  )
}

function Detail({ label, value, mono = false, ok = false }: { label: string; value: string; mono?: boolean; ok?: boolean }) {
  return (
    <div>
      <div style={{ color: '#666', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ color: ok ? '#57FF9A' : '#ccc', fontSize: 13, fontFamily: mono ? 'ui-monospace, Menlo, monospace' : 'inherit', overflowWrap: 'anywhere', display: 'flex', gap: 6, alignItems: 'center' }}>
        {ok && <CheckCircle2 size={14} />}{value}
      </div>
    </div>
  )
}
