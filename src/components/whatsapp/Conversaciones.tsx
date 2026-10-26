import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Send, Bot, User, Wrench, HelpCircle, FileText, TriangleAlert, Check, CheckCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// Vista tipo WhatsApp Web sobre la bitácora `whatsapp_messages`.
// Agrupa por los últimos 10 dígitos del teléfono (Meta manda 521…, nosotros
// guardamos +52…: son la misma persona) y le pone nombre a cada chat cruzando
// equipo autorizado, empleados y contactos de mantenimiento.
//
// Responder desde aquí solo se permite dentro de la ventana de 24 h que abre el
// último mensaje de esa persona: fuera de ella Meta exige plantilla.

interface Msg {
  id: string; direction: 'in' | 'out'; phone_e164: string; kind: string | null; body: string | null
  template_name: string | null; sender_type: string | null; status: string | null; error: string | null
  created_at: string; sent_by: string | null; media_path: string | null
  ticket: { ticket_number: number } | null
}
interface Quien { nombre: string; tipo: 'equipo' | 'cliente' | 'desconocido'; detalle?: string }
interface Chat { key: string; telefono: string; quien: Quien; msgs: Msg[]; ultimo: Msg; ultimoEntrante: Msg | null }

const C = {
  fondo: '#0b141a', panel: '#111b21', cabecera: '#202c33', borde: '#222d34', hover: '#202c33', activo: '#2a3942',
  entrante: '#202c33', saliente: '#005c4b', texto: '#e9edef', tenue: '#8696a0', verde: '#25D366', azul: '#53bdeb',
}

const ult10 = (p: string) => (p || '').replace(/\D/g, '').slice(-10)
const VENTANA_MS = 24 * 3600 * 1000

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}
function etiquetaDia(iso: string) {
  const d = new Date(iso); const hoy = new Date()
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1)
  if (d.toDateString() === hoy.toDateString()) return 'Hoy'
  if (d.toDateString() === ayer.toDateString()) return 'Ayer'
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
}
function fechaLista(iso: string) {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? hora(iso) : d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })
}
function telBonito(t10: string) {
  return t10.length === 10 ? `+52 ${t10.slice(0, 2)} ${t10.slice(2, 6)} ${t10.slice(6)}` : t10
}

// *negrita*, **negrita** (lo que escribe el modelo antes de convertirse), _cursiva_
function Formato({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g)
  return <>{partes.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <b key={i}>{p.slice(2, -2)}</b>
    if (/^\*[^*]+\*$/.test(p)) return <b key={i}>{p.slice(1, -1)}</b>
    if (/^_[^_]+_$/.test(p)) return <i key={i}>{p.slice(1, -1)}</i>
    return <span key={i}>{p}</span>
  })}</>
}

function Palomitas({ m }: { m: Msg }) {
  if (m.direction !== 'out') return null
  if (m.status === 'fallido') return <span title={m.error || 'Falló'} style={{ color: '#f87171', display: 'inline-flex' }}><TriangleAlert size={13} /></span>
  if (m.status === 'leido') return <CheckCheck size={15} color={C.azul} />
  if (m.status === 'entregado') return <CheckCheck size={15} color={C.tenue} />
  return <Check size={15} color={C.tenue} />
}

function quienEscribio(m: Msg) {
  if (m.direction === 'in') return null
  if (m.template_name) return `Plantilla ${m.template_name}`
  if (m.sent_by) return 'Desde el ERP'
  return 'Bot'
}

export default function Conversaciones({ enviar }: { enviar: (payload: Record<string, unknown>) => Promise<any> }) {
  const [msgs, setMsgs] = useState([] as Msg[])
  const [nombres, setNombres] = useState({} as Record<string, Quien>)
  const [sel, setSel] = useState('')
  const [buscar, setBuscar] = useState('')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const finRef = useRef(null as HTMLDivElement | null)

  async function cargarMsgs() {
    const { data, error: e } = await supabase.from('whatsapp_messages')
      .select('id, direction, phone_e164, kind, body, template_name, sender_type, status, error, created_at, sent_by, media_path, ticket:maintenance_tickets(ticket_number)')
      .order('created_at', { ascending: false }).limit(1500)
    if (e) setError('No pude leer los mensajes: ' + e.message)
    else setMsgs(((data || []) as unknown as Msg[]).reverse())
    setCargando(false)
  }

  async function cargarNombres() {
    const mapa: Record<string, Quien> = {}
    const [{ data: emps }, { data: mc }, { data: ac }] = await Promise.all([
      supabase.from('employees').select('nombre, name, puesto, telefono_personal, obra_app_phone, phone').eq('activo', true),
      supabase.from('maintenance_contacts').select('name, phone_e164, property:maintenance_properties(name)'),
      supabase.from('agent_contacts').select('display_name, phone_e164, role'),
    ])
    for (const e of (emps || []) as any[]) {
      for (const t of [e.telefono_personal, e.obra_app_phone, e.phone]) {
        const k = ult10(t || ''); if (k.length === 10) mapa[k] = { nombre: e.nombre || e.name, tipo: 'equipo', detalle: e.puesto || undefined }
      }
    }
    for (const c of (mc || []) as any[]) {
      const k = ult10(c.phone_e164 || ''); if (k.length === 10) mapa[k] = { nombre: c.name, tipo: 'cliente', detalle: c.property?.name || undefined }
    }
    for (const a of (ac || []) as any[]) {
      const k = ult10(a.phone_e164 || ''); if (k.length === 10) mapa[k] = { nombre: a.display_name, tipo: 'equipo', detalle: a.role === 'admin' ? 'Asistente · admin' : 'Asistente' }
    }
    setNombres(mapa)
  }

  useEffect(() => {
    cargarMsgs(); cargarNombres()
    const t = setInterval(() => { if (!document.hidden) cargarMsgs() }, 8000)
    return () => clearInterval(t)
  }, [])

  const chats = useMemo(() => {
    const g: Record<string, Msg[]> = {}
    for (const m of msgs) { const k = ult10(m.phone_e164); (g[k] = g[k] || []).push(m) }
    const lista: Chat[] = Object.entries(g).map(([k, ms]) => {
      const entrantes = ms.filter(m => m.direction === 'in')
      const st = ms.find(m => m.sender_type)?.sender_type
      const quien: Quien = nombres[k] || { nombre: telBonito(k), tipo: st === 'cliente' ? 'cliente' : st === 'equipo' ? 'equipo' : 'desconocido' }
      return { key: k, telefono: telBonito(k), quien, msgs: ms, ultimo: ms[ms.length - 1], ultimoEntrante: entrantes[entrantes.length - 1] || null }
    })
    lista.sort((a, b) => b.ultimo.created_at.localeCompare(a.ultimo.created_at))
    const q = buscar.trim().toLowerCase()
    return q ? lista.filter(c => c.quien.nombre.toLowerCase().includes(q) || c.key.includes(q.replace(/\D/g, '') || '§') || c.msgs.some(m => (m.body || '').toLowerCase().includes(q))) : lista
  }, [msgs, nombres, buscar])

  useEffect(() => { if (!sel && chats.length) setSel(chats[0].key) }, [chats, sel])
  const chat = chats.find(c => c.key === sel) || null
  const ultimoId = chat?.ultimo.id
  useEffect(() => { finRef.current?.scrollIntoView({ block: 'end' }) }, [sel, ultimoId])

  const ventanaHasta = chat?.ultimoEntrante ? new Date(chat.ultimoEntrante.created_at).getTime() + VENTANA_MS : 0
  const ventanaAbierta = ventanaHasta > Date.now()

  async function mandar() {
    if (!chat || !texto.trim() || !ventanaAbierta) return
    setEnviando(true); setError('')
    try {
      const r = await enviar({ action: 'send_text', to: '+52' + chat.key, text: texto.trim() })
      if (r?.ok === false) setError('WhatsApp rechazó el mensaje: ' + r.error)
      else setTexto('')
      await cargarMsgs()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setEnviando(false) }
  }

  const Icono = ({ tipo }: { tipo: Quien['tipo'] }) => tipo === 'equipo' ? <User size={20} /> : tipo === 'cliente' ? <Wrench size={19} /> : <HelpCircle size={20} />
  const colorTipo = (t: Quien['tipo']) => t === 'equipo' ? '#6ee7b7' : t === 'cliente' ? '#fbbf24' : C.tenue

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 210px)', minHeight: 480, border: `1px solid ${C.borde}`, borderRadius: 12, overflow: 'hidden', background: C.fondo }}>
      {/* Lista de chats */}
      <div style={{ width: 340, minWidth: 260, borderRight: `1px solid ${C.borde}`, display: 'flex', flexDirection: 'column', background: C.panel }}>
        <div style={{ padding: 10, background: C.panel }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.cabecera, borderRadius: 8, padding: '7px 10px' }}>
            <Search size={15} color={C.tenue} />
            <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar nombre, número o texto"
              style={{ flex: 1, background: 'transparent', border: 0, outline: 'none', color: C.texto, fontSize: 13.5 }} />
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {cargando && <div style={{ color: C.tenue, padding: 16, fontSize: 13 }}>Cargando…</div>}
          {!cargando && chats.length === 0 && <div style={{ color: C.tenue, padding: 16, fontSize: 13 }}>Sin conversaciones.</div>}
          {chats.map(c => {
            const u = c.ultimo
            const prefijo = u.direction === 'out' ? (u.template_name ? 'Plantilla: ' : u.sent_by ? 'Tú: ' : 'Bot: ') : ''
            return (
              <div key={c.key} onClick={() => setSel(c.key)}
                style={{ display: 'flex', gap: 11, padding: '10px 12px', cursor: 'pointer', background: sel === c.key ? C.activo : 'transparent', borderBottom: `1px solid ${C.borde}` }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#2a3942', color: colorTipo(c.quien.tipo), display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <Icono tipo={c.quien.tipo} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: C.texto, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.quien.nombre}</span>
                    <span style={{ color: C.tenue, fontSize: 11.5, flexShrink: 0 }}>{fechaLista(u.created_at)}</span>
                  </div>
                  <div style={{ color: C.tenue, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2, display: 'flex', gap: 4, alignItems: 'center' }}>
                    {u.direction === 'out' && <Palomitas m={u} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{prefijo}{(u.body || `[${u.kind || 'mensaje'}]`).replace(/\*\*/g, '').replace(/\n+/g, ' ')}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Conversación */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!chat ? (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: C.tenue, fontSize: 14 }}>Elige una conversación</div>
        ) : (<>
          <div style={{ background: C.cabecera, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#2a3942', color: colorTipo(chat.quien.tipo), display: 'grid', placeItems: 'center' }}><Icono tipo={chat.quien.tipo} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.texto, fontSize: 15 }}>{chat.quien.nombre}</div>
              <div style={{ color: C.tenue, fontSize: 12.5 }}>
                {chat.telefono}{chat.quien.detalle ? ` · ${chat.quien.detalle}` : ''} · <span style={{ color: colorTipo(chat.quien.tipo) }}>{chat.quien.tipo}</span>
              </div>
            </div>
            <div style={{ color: ventanaAbierta ? '#6ee7b7' : C.tenue, fontSize: 12, textAlign: 'right' }}>
              {ventanaAbierta
                ? `Puedes escribir hasta ${new Date(ventanaHasta).toLocaleString('es-MX', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
                : 'Ventana de 24 h cerrada'}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 6%', background: C.fondo }}>
            {chat.msgs.map((m, i) => {
              const nuevoDia = i === 0 || new Date(chat.msgs[i - 1].created_at).toDateString() !== new Date(m.created_at).toDateString()
              const sale = m.direction === 'out'
              const autor = quienEscribio(m)
              return (
                <div key={m.id}>
                  {nuevoDia && (
                    <div style={{ textAlign: 'center', margin: '12px 0' }}>
                      <span style={{ background: C.cabecera, color: C.tenue, fontSize: 12, padding: '5px 12px', borderRadius: 8, textTransform: 'capitalize' }}>{etiquetaDia(m.created_at)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: sale ? 'flex-end' : 'flex-start', marginBottom: 4 }}>
                    <div style={{ maxWidth: '72%', background: sale ? C.saliente : C.entrante, color: C.texto, borderRadius: 8, padding: '6px 9px 4px', fontSize: 14, lineHeight: 1.4, boxShadow: '0 1px 0.5px rgba(0,0,0,.13)', border: m.status === 'fallido' ? '1px solid #f8717188' : 'none' }}>
                      {autor && (
                        <div style={{ fontSize: 11.5, color: '#9de1cf', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {autor === 'Bot' ? <Bot size={12} /> : null}{autor}
                        </div>
                      )}
                      {m.media_path && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,.18)', padding: '6px 8px', borderRadius: 6, marginBottom: 4, fontSize: 13 }}>
                          <FileText size={16} /> {m.media_path.split('/').pop()}
                        </div>
                      )}
                      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><Formato texto={m.body || `[${m.kind || 'mensaje'}]`} /></div>
                      {m.ticket && <div style={{ fontSize: 11.5, color: '#fbbf24', marginTop: 3 }}>Ticket #{m.ticket.ticket_number}</div>}
                      {m.status === 'fallido' && m.error && <div style={{ fontSize: 11.5, color: '#fca5a5', marginTop: 3 }}>No salió: {m.error.slice(0, 160)}</div>}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, color: C.tenue, fontSize: 11, marginTop: 2 }}>
                        {hora(m.created_at)} <Palomitas m={m} />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={finRef} />
          </div>

          {error && <div style={{ background: '#3b1d1d', color: '#fca5a5', fontSize: 12.5, padding: '6px 16px' }}>{error}</div>}
          <div style={{ background: C.cabecera, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandar() } }}
              disabled={!ventanaAbierta || enviando}
              placeholder={ventanaAbierta ? 'Escribe un mensaje (sale desde el número de OMM)' : 'Han pasado más de 24 h desde su último mensaje: Meta solo permite plantillas'}
              style={{ flex: 1, resize: 'none', background: '#2a3942', border: 0, outline: 'none', borderRadius: 8, padding: '10px 12px', color: C.texto, fontSize: 14, fontFamily: 'inherit', maxHeight: 120, opacity: ventanaAbierta ? 1 : 0.6 }} />
            <button onClick={mandar} disabled={!ventanaAbierta || enviando || !texto.trim()}
              style={{ width: 42, height: 42, borderRadius: '50%', border: 0, background: C.verde, color: '#0b141a', display: 'grid', placeItems: 'center', cursor: 'pointer', opacity: !ventanaAbierta || enviando || !texto.trim() ? 0.4 : 1 }}>
              <Send size={18} />
            </button>
          </div>
        </>)}
      </div>
    </div>
  )
}
