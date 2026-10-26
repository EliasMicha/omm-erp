import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Send, Bot, User, Wrench, HelpCircle, FileText, TriangleAlert, Check, CheckCheck, Paperclip, X, ArrowLeft, MoreVertical, Home, Briefcase, HardHat, MessageSquarePlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useIsMobile } from '../../lib/useIsMobile'
import { useAuth } from '../../contexts/AuthContext'

// Vista tipo WhatsApp sobre la bitácora `whatsapp_messages`.
// Agrupa por los últimos 10 dígitos del teléfono (Meta manda 521…, nosotros
// guardamos +52…: son la misma persona) y le pone nombre a cada chat cruzando
// equipo autorizado, empleados, contactos de mantenimiento y contactos de leads.
//
// En el celular es UN panel a la vez, como la app: la lista, y al tocar un chat
// la conversación a pantalla completa con flecha para regresar. El chat abierto
// vive en la URL (?c=…) para que el "atrás" del teléfono regrese a la lista en
// vez de salirse de la app.
//
// Grupos: se calculan solos (ver grupoAuto) y se pueden mover a mano; lo movido
// a mano se guarda en `whatsapp_chat_grupos` para que valga igual en el celular
// y en la computadora.
//
// Responder desde aquí solo se permite dentro de la ventana de 24 h que abre el
// último mensaje de esa persona: fuera de ella Meta exige plantilla.

interface Msg {
  id: string; direction: 'in' | 'out'; phone_e164: string; kind: string | null; body: string | null
  template_name: string | null; sender_type: string | null; status: string | null; error: string | null
  created_at: string; sent_by: string | null; media_path: string | null
  ticket: { ticket_number: number } | null
}
type Fuente = 'empleado' | 'asistente' | 'mantenimiento' | 'contacto' | 'ninguna'
interface Quien { nombre: string; tipo: 'equipo' | 'cliente' | 'desconocido'; detalle?: string; fuente: Fuente; rol?: string }
type Grupo = 'clientes' | 'coordinacion' | 'servicios' | 'general'
interface Chat {
  key: string; telefono: string; quien: Quien; msgs: Msg[]; ultimo: Msg | null; ultimoEntrante: Msg | null
  grupo: Grupo; grupoAuto: Grupo; sinLeer: number
}
// Lo que va pegado al mensaje: un archivo, una cotización (su último PDF del ERP)
// o el estado de cuenta de un lead. Lo arma y lo manda whatsapp-send (send_document).
interface Adjunto { etiqueta: string; documento: Record<string, unknown> }
interface Opcion { id: string; titulo: string; detalle: string; deshabilitado?: string }

const C = {
  fondo: '#0b141a', panel: '#111b21', cabecera: '#202c33', borde: '#222d34', hover: '#202c33', activo: '#2a3942',
  entrante: '#202c33', saliente: '#005c4b', texto: '#e9edef', tenue: '#8696a0', verde: '#25D366', azul: '#53bdeb',
}

const GRUPOS: { k: Grupo | 'todos'; t: string; corto: string }[] = [
  { k: 'todos', t: 'Todos', corto: 'Todos' },
  { k: 'clientes', t: 'Clientes / Ventas', corto: 'Clientes' },
  { k: 'coordinacion', t: 'Coordinación / Equipo', corto: 'Coordinación' },
  { k: 'servicios', t: 'Servicios', corto: 'Servicios' },
  { k: 'general', t: 'General', corto: 'General' },
]
const NOMBRE_GRUPO: Record<Grupo, string> = { clientes: 'Clientes / Ventas', coordinacion: 'Coordinación / Equipo', servicios: 'Servicios', general: 'General' }

// Equipo → coordinación. Contacto de mantenimiento o chat con ticket → servicios.
// Contacto de un lead → clientes, salvo residente/segurista, que son de obra.
// Nadie conocido → general.
function grupoAuto(q: Quien, msgs: Msg[]): Grupo {
  if (q.fuente === 'mantenimiento' || msgs.some(m => m.ticket)) return 'servicios'
  if (q.tipo === 'equipo') return 'coordinacion'
  if (q.fuente === 'contacto') return q.rol === 'residente' || q.rol === 'segurista' ? 'coordinacion' : 'clientes'
  return 'general'
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

// "Visto" por chat: vive en este dispositivo (localStorage). Solo sirve para
// pintar el globito de no leídos; nadie depende de él.
const VISTO_KEY = 'wa_visto_v1'
function leerVisto(): { base: string; chats: Record<string, string> } {
  try {
    const v = JSON.parse(localStorage.getItem(VISTO_KEY) || 'null')
    if (v && v.base) return v
  } catch (_) { /* nada */ }
  const nuevo = { base: new Date().toISOString(), chats: {} as Record<string, string> }
  try { localStorage.setItem(VISTO_KEY, JSON.stringify(nuevo)) } catch (_) { /* nada */ }
  return nuevo
}

export default function Conversaciones({ enviar, modo = 'erp' }: { enviar: (payload: Record<string, unknown>) => Promise<any>; modo?: 'erp' | 'app' }) {
  const movil = useIsMobile()
  const app = modo === 'app'
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const sel = params.get('c') || ''

  const [msgs, setMsgs] = useState([] as Msg[])
  const [nombres, setNombres] = useState({} as Record<string, Quien>)
  const [manual, setManual] = useState({} as Record<string, Grupo>)
  const [visto, setVisto] = useState(leerVisto)
  const [grupoSel, setGrupoSel] = useState(() => { try { return (localStorage.getItem('wa_grupo') || 'todos') as Grupo | 'todos' } catch { return 'todos' as const } })
  const [buscar, setBuscar] = useState('')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const finRef = useRef(null as HTMLDivElement | null)
  const archivoRef = useRef(null as HTMLInputElement | null)
  const [adjunto, setAdjunto] = useState(null as Adjunto | null)
  const [buscador, setBuscador] = useState(null as null | 'cotizacion' | 'estado_cuenta')
  const [qDoc, setQDoc] = useState('')
  const [opciones, setOpciones] = useState([] as Opcion[])
  const [menuAdj, setMenuAdj] = useState(false)
  const [menuChat, setMenuChat] = useState(false)
  // Nuevo chat: elegir a alguien del directorio o teclear un número.
  const [nuevo, setNuevo] = useState(false)
  const [qNuevo, setQNuevo] = useState('')
  const { user } = useAuth()
  const miNombre = String((user as any)?.nombre || 'OMM').split(/\s+/)[0]

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
    const [{ data: emps }, { data: mc }, { data: ac }, { data: ce }, { data: gr }] = await Promise.all([
      supabase.from('employees').select('nombre, name, puesto, telefono_personal, obra_app_phone, phone').eq('activo', true),
      supabase.from('maintenance_contacts').select('name, phone_e164, property:maintenance_properties(name)'),
      supabase.from('agent_contacts').select('display_name, phone_e164, role'),
      supabase.from('contactos_externos').select('nombre, telefono, rol, leads(name), obras(nombre)').eq('activo', true),
      supabase.from('whatsapp_chat_grupos').select('telefono10, grupo'),
    ])
    for (const e of (emps || []) as any[]) {
      for (const t of [e.telefono_personal, e.obra_app_phone, e.phone]) {
        const k = ult10(t || ''); if (k.length === 10) mapa[k] = { nombre: e.nombre || e.name, tipo: 'equipo', detalle: e.puesto || undefined, fuente: 'empleado' }
      }
    }
    for (const c of (mc || []) as any[]) {
      const k = ult10(c.phone_e164 || ''); if (k.length === 10) mapa[k] = { nombre: c.name, tipo: 'cliente', detalle: c.property?.name || undefined, fuente: 'mantenimiento' }
    }
    for (const c of (ce || []) as any[]) {
      const k = ult10(c.telefono || ''); if (k.length === 10) mapa[k] = { nombre: c.nombre, tipo: 'cliente', detalle: [c.rol, c.leads?.name || c.obras?.nombre].filter(Boolean).join(' · '), fuente: 'contacto', rol: c.rol }
    }
    for (const a of (ac || []) as any[]) {
      const k = ult10(a.phone_e164 || ''); if (k.length === 10) mapa[k] = { nombre: a.display_name, tipo: 'equipo', detalle: a.role === 'admin' ? 'Asistente · admin' : 'Asistente', fuente: 'asistente' }
    }
    setNombres(mapa)
    const m: Record<string, Grupo> = {}
    for (const g of (gr || []) as any[]) m[g.telefono10] = g.grupo
    setManual(m)
  }

  useEffect(() => {
    cargarMsgs(); cargarNombres()
    const t = setInterval(() => { if (!document.hidden) cargarMsgs() }, 8000)
    const alVolver = () => { if (!document.hidden) cargarMsgs() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [])

  const todos = useMemo(() => {
    const g: Record<string, Msg[]> = {}
    for (const m of msgs) { const k = ult10(m.phone_e164); (g[k] = g[k] || []).push(m) }
    const lista: Chat[] = Object.entries(g).map(([k, ms]) => {
      const entrantes = ms.filter(m => m.direction === 'in')
      const st = ms.find(m => m.sender_type)?.sender_type
      const quien: Quien = nombres[k] || { nombre: telBonito(k), tipo: st === 'cliente' ? 'cliente' : st === 'equipo' ? 'equipo' : 'desconocido', fuente: 'ninguna' }
      const auto = grupoAuto(quien, ms)
      const desde = visto.chats[k] || visto.base
      return {
        key: k, telefono: telBonito(k), quien, msgs: ms, ultimo: ms[ms.length - 1], ultimoEntrante: entrantes[entrantes.length - 1] || null,
        grupoAuto: auto, grupo: manual[k] || auto,
        sinLeer: k === sel ? 0 : entrantes.filter(m => m.created_at > desde).length,
      }
    })
    lista.sort((a, b) => b.ultimo!.created_at.localeCompare(a.ultimo!.created_at))
    return lista
  }, [msgs, nombres, manual, visto, sel])

  const chats = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    let l = grupoSel === 'todos' ? todos : todos.filter(c => c.grupo === grupoSel)
    if (q) l = l.filter(c => c.quien.nombre.toLowerCase().includes(q) || c.key.includes(q.replace(/\D/g, '') || '§') || c.msgs.some(m => (m.body || '').toLowerCase().includes(q)))
    return l
  }, [todos, grupoSel, buscar])

  const conChat = useMemo(() => new Set(todos.map(c => c.key)), [todos])
  const candidatos = useMemo(() => {
    const q = qNuevo.trim().toLowerCase()
    const dig = q.replace(/\D/g, '')
    const l = Object.entries(nombres)
      .filter(([k, v]) => !q || v.nombre.toLowerCase().includes(q) || (v.detalle || '').toLowerCase().includes(q) || (dig.length >= 3 && k.includes(dig)))
      .sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es'))
    return l.slice(0, 80)
  }, [nombres, qNuevo])
  const numeroTecleado = qNuevo.replace(/\D/g, '').slice(-10)

  function empezarChat(key: string) {
    setNuevo(false); setQNuevo('')
    abrir(key)
  }

  const porGrupo = useMemo(() => {
    const r: Record<string, { n: number; sinLeer: number }> = { todos: { n: 0, sinLeer: 0 } }
    for (const c of todos) {
      for (const k of ['todos', c.grupo]) {
        r[k] = r[k] || { n: 0, sinLeer: 0 }
        r[k].n++; if (c.sinLeer) r[k].sinLeer++
      }
    }
    return r
  }, [todos])

  function abrir(key: string) {
    setMenuChat(false); setMenuAdj(false); setBuscador(null); setAdjunto(null); setTexto(''); setError('')
    const p = new URLSearchParams(params); p.set('c', key)
    // En el celular cada chat abierto es un paso del historial: el "atrás" del
    // teléfono regresa a la lista. En la computadora se reemplaza.
    setParams(p, { replace: !movil && !!sel })
  }
  function regresar() {
    setMenuChat(false)
    if (location.key !== 'default') navigate(-1)
    else { const p = new URLSearchParams(params); p.delete('c'); setParams(p, { replace: true }) }
  }

  // En la computadora siempre hay un chat abierto; en el celular arranca en la lista.
  useEffect(() => {
    if (!movil && !sel && chats.length) { const p = new URLSearchParams(params); p.set('c', chats[0].key); setParams(p, { replace: true }) }
  }, [movil, chats, sel])

  // Un chat abierto puede no tener mensajes todavía: es un "nuevo chat".
  const chat: Chat | null = todos.find(c => c.key === sel) || (sel.length === 10 ? (() => {
    const q: Quien = nombres[sel] || { nombre: telBonito(sel), tipo: 'desconocido', fuente: 'ninguna' }
    const auto = grupoAuto(q, [])
    return { key: sel, telefono: telBonito(sel), quien: q, msgs: [], ultimo: null, ultimoEntrante: null, grupoAuto: auto, grupo: manual[sel] || auto, sinLeer: 0 }
  })() : null)
  const ultimoId = chat?.ultimo?.id
  useEffect(() => { finRef.current?.scrollIntoView({ block: 'end' }) }, [sel, ultimoId])

  // Marca como visto lo que está en pantalla.
  useEffect(() => {
    if (!chat || !chat.ultimo) return
    const ult = chat.ultimo.created_at
    if ((visto.chats[chat.key] || '') >= ult) return
    const nuevo = { ...visto, chats: { ...visto.chats, [chat.key]: ult } }
    setVisto(nuevo)
    try { localStorage.setItem(VISTO_KEY, JSON.stringify(nuevo)) } catch (_) { /* nada */ }
  }, [chat?.key, ultimoId])

  function elegirGrupo(g: Grupo | 'todos') {
    setGrupoSel(g)
    try { localStorage.setItem('wa_grupo', g) } catch (_) { /* nada */ }
  }

  async function moverA(c: Chat, g: Grupo) {
    setMenuChat(false)
    const antes = manual[c.key]
    const sig = { ...manual }
    if (g === c.grupoAuto) delete sig[c.key]; else sig[c.key] = g
    setManual(sig)
    const r = g === c.grupoAuto
      ? await supabase.from('whatsapp_chat_grupos').delete().eq('telefono10', c.key)
      : await supabase.from('whatsapp_chat_grupos').upsert({ telefono10: c.key, grupo: g, updated_at: new Date().toISOString() }, { onConflict: 'telefono10' })
    if (r.error) {
      const back = { ...sig }; if (antes) back[c.key] = antes; else delete back[c.key]
      setManual(back)
      setError('No pude mover el chat: ' + r.error.message)
    }
  }

  const ventanaHasta = chat?.ultimoEntrante ? new Date(chat.ultimoEntrante.created_at).getTime() + VENTANA_MS : 0
  const ventanaAbierta = ventanaHasta > Date.now()

  // Con la ventana cerrada el archivo no sale directo: le llega un mensaje de
  // plantilla y el archivo se le entrega en cuanto conteste (equipo o cliente).
  const puedeAdjuntar = !!chat

  // Cómo llega un mensaje con la ventana cerrada (espejo de send_message en whatsapp-send).
  function comoSalePlantilla(t: string) {
    if (!chat) return t
    const plano = t.replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').trim()
    const primer = (chat.quien.tipo !== 'desconocido' && chat.quien.nombre.split(/\s+/)[0]) || (chat.quien.tipo === 'equipo' ? 'equipo' : 'buen día')
    return chat.quien.tipo === 'equipo'
      ? `Hola ${primer}, tienes un aviso del ERP de OMM: de parte de ${miNombre}: ${plano}. Responde a este mensaje para atenderlo con el asistente.`
      : `Hola ${primer}, ${miNombre} de OMM Technologies te escribe:\n\n${plano}\n\nPuedes responder a este mensaje para continuar la conversación.`
  }

  async function mandar() {
    if (!chat) return
    if (adjunto) {
      if (!puedeAdjuntar) return
      if (!confirm(`¿Mandar ${adjunto.etiqueta} a ${chat.quien.nombre}?`)) return
      setEnviando(true); setError('')
      try {
        const r = await enviar({ action: 'send_document', to: '+52' + chat.key, documento: adjunto.documento, caption: texto.trim() || undefined, nombre: chat.quien.tipo !== 'desconocido' ? chat.quien.nombre : undefined })
        if (r?.ok === false) setError('No salió: ' + r.error)
        else { setTexto(''); setAdjunto(null); if (r?.diferido) setError(r.nota || 'Le llegó el aviso; el archivo se le entrega cuando conteste.') }
        await cargarMsgs()
      } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
      finally { setEnviando(false) }
      return
    }
    if (!texto.trim()) return
    // Fuera de la ventana de 24 h el mensaje va dentro de una plantilla. A
    // alguien que no es del equipo se le enseña cómo le va a llegar antes de mandar.
    if (!ventanaAbierta && chat.quien.tipo !== 'equipo' && !confirm(`Le va a llegar así:\n\n${comoSalePlantilla(texto.trim())}\n\n¿Lo mando?`)) return
    setEnviando(true); setError('')
    try {
      const r = await enviar({ action: 'send_message', to: '+52' + chat.key, text: texto.trim(), nombre: chat.quien.tipo !== 'desconocido' ? chat.quien.nombre : undefined })
      if (r?.ok === false) setError('WhatsApp rechazó el mensaje: ' + r.error)
      else setTexto('')
      await cargarMsgs()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setEnviando(false) }
  }

  function elegirArchivo(f: File | undefined) {
    if (!f) return
    if (f.size > 6 * 1024 * 1024) { setError('El archivo pasa de 6 MB.'); return }
    const lector = new FileReader()
    lector.onload = () => {
      const b64 = String(lector.result || '').split(',')[1] || ''
      setAdjunto({ etiqueta: f.name, documento: { tipo: 'archivo', base64: b64, filename: f.name, mime: f.type || 'application/octet-stream' } })
    }
    lector.readAsDataURL(f)
  }

  useEffect(() => {
    if (!buscador) return
    const q = qDoc.trim().replace(/[,()*%]/g, ' ')
    const t = setTimeout(async () => {
      if (buscador === 'cotizacion') {
        let c = supabase.from('quotations').select('id, folio, name, stage').is('archived_at', null).order('updated_at', { ascending: false }).limit(12)
        if (q) c = c.or(`folio.ilike.%${q}%,name.ilike.%${q}%`)
        const { data } = await c
        const ids = ((data || []) as any[]).map(x => x.id)
        const { data: pdfs } = ids.length ? await supabase.from('cotizacion_pdfs').select('quotation_id, interno').in('quotation_id', ids) : { data: [] as any[] }
        const conPdf = new Set(((pdfs || []) as any[]).filter(p => !p.interno).map(p => p.quotation_id))
        setOpciones(((data || []) as any[]).map(x => ({ id: x.id, titulo: `${x.folio || ''} ${x.name}`.trim(), detalle: x.stage, deshabilitado: conPdf.has(x.id) ? undefined : 'Sin PDF guardado: descárgala una vez en el ERP' })))
      } else {
        let c = supabase.from('leads').select('id, name, company').is('archived_at', null).order('updated_at', { ascending: false }).limit(12)
        for (const w of q.split(/\s+/).filter(w => w.length >= 2)) c = c.ilike('name', `%${w}%`)
        const { data } = await c
        setOpciones(((data || []) as any[]).map(x => ({ id: x.id, titulo: x.name, detalle: x.company || '' })))
      }
    }, 250)
    return () => clearTimeout(t)
  }, [buscador, qDoc])

  const Icono = ({ c, size }: { c: Chat; size: number }) => {
    if (c.grupo === 'servicios') return <Wrench size={size - 1} />
    if (c.grupo === 'clientes') return <Briefcase size={size - 1} />
    if (c.grupo === 'coordinacion') return c.quien.tipo === 'equipo' ? <User size={size} /> : <HardHat size={size - 1} />
    return <HelpCircle size={size} />
  }
  const COLOR_GRUPO: Record<Grupo, string> = { clientes: '#fbbf24', coordinacion: '#6ee7b7', servicios: '#60a5fa', general: C.tenue }

  // ---- Panel de la lista ----
  const unPanel = movil
  const verLista = !unPanel || !chat
  const verChat = !unPanel || !!chat
  const tamTexto = movil ? 16 : 14

  const panelNuevo = (
    <div style={{ width: unPanel ? '100%' : 360, minWidth: unPanel ? 0 : 280, borderRight: unPanel ? 'none' : `1px solid ${C.borde}`, display: 'flex', flexDirection: 'column', background: C.panel, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `calc(${app ? 'env(safe-area-inset-top)' : '0px'} + 10px) 10px 6px 4px`, background: C.cabecera }}>
        <button onClick={() => setNuevo(false)} aria-label="Cerrar" style={{ background: 'none', border: 0, color: C.texto, padding: 6, cursor: 'pointer', display: 'grid', placeItems: 'center' }}><ArrowLeft size={22} /></button>
        <div style={{ color: C.texto, fontSize: 17, fontWeight: 600 }}>Nuevo chat</div>
      </div>
      <div style={{ padding: '10px 10px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.cabecera, borderRadius: 20, padding: '8px 14px' }}>
          <Search size={16} color={C.tenue} />
          <input autoFocus value={qNuevo} onChange={e => setQNuevo(e.target.value)} placeholder="Nombre, obra o número de 10 dígitos" inputMode="text"
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none', color: C.texto, fontSize: tamTexto }} />
        </div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {numeroTecleado.length === 10 && (
          <div onClick={() => empezarChat(numeroTecleado)} style={{ display: 'flex', gap: 12, padding: '10px 14px', cursor: 'pointer', alignItems: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: C.verde, color: '#0b141a', display: 'grid', placeItems: 'center', flexShrink: 0 }}><MessageSquarePlus size={20} /></div>
            <div>
              <div style={{ color: C.texto, fontSize: 15.5 }}>Escribir a {telBonito(numeroTecleado)}</div>
              <div style={{ color: C.tenue, fontSize: 12.5 }}>{nombres[numeroTecleado]?.nombre || 'Número que no está en el directorio'}</div>
            </div>
          </div>
        )}
        <div style={{ color: C.tenue, fontSize: 12, padding: '8px 16px 4px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Contactos con celular</div>
        {candidatos.length === 0 && <div style={{ color: C.tenue, padding: '6px 16px', fontSize: 13 }}>Nadie coincide. Teclea el número completo de 10 dígitos.</div>}
        {candidatos.map(([k, q]) => {
          const g = manual[k] || grupoAuto(q, [])
          return (
            <div key={k} onClick={() => empezarChat(k)} style={{ display: 'flex', gap: 12, padding: '9px 14px', cursor: 'pointer', alignItems: 'center' }}
              onMouseEnter={e => { e.currentTarget.style.background = C.hover }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#2a3942', color: COLOR_GRUPO[g], display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                {g === 'servicios' ? <Wrench size={19} /> : g === 'clientes' ? <Briefcase size={19} /> : q.tipo === 'equipo' ? <User size={20} /> : <HardHat size={19} />}
              </div>
              <div style={{ flex: 1, minWidth: 0, borderBottom: `1px solid ${C.borde}`, paddingBottom: 9 }}>
                <div style={{ color: C.texto, fontSize: 15.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.nombre}</div>
                <div style={{ color: C.tenue, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {telBonito(k)}{q.detalle ? ` · ${q.detalle}` : ''}{conChat.has(k) ? ' · ya hay conversación' : ''}
                </div>
              </div>
            </div>
          )
        })}
        <div style={{ height: 'env(safe-area-inset-bottom)' }} />
      </div>
    </div>
  )

  const lista = (
    <div style={{ width: unPanel ? '100%' : 360, minWidth: unPanel ? 0 : 280, borderRight: unPanel ? 'none' : `1px solid ${C.borde}`, display: 'flex', flexDirection: 'column', background: C.panel, minHeight: 0 }}>
      {app && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(env(safe-area-inset-top) + 12px) 16px 6px' }}>
          <div style={{ flex: 1, color: C.texto, fontSize: 22, fontWeight: 700 }}>WhatsApp OMM</div>
          <button onClick={() => { setNuevo(true); setQNuevo('') }} title="Nuevo chat" aria-label="Nuevo chat" style={{ background: 'none', border: 0, color: C.texto, padding: 6, cursor: 'pointer' }}><MessageSquarePlus size={21} /></button>
          <button onClick={() => navigate('/')} title="Ir al ERP" style={{ background: 'none', border: 0, color: C.tenue, padding: 6, cursor: 'pointer' }}><Home size={20} /></button>
        </div>
      )}
      <div style={{ padding: '8px 10px 6px', display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, background: C.cabecera, borderRadius: 20, padding: '8px 14px' }}>
          <Search size={16} color={C.tenue} />
          <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar nombre, número o texto"
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none', color: C.texto, fontSize: tamTexto }} />
          {buscar && <button onClick={() => setBuscar('')} style={{ background: 'none', border: 0, color: C.tenue, padding: 0, cursor: 'pointer' }}><X size={15} /></button>}
        </div>
        {!app && (
          <button onClick={() => { setNuevo(true); setQNuevo('') }} title="Nuevo chat" aria-label="Nuevo chat"
            style={{ marginLeft: 6, background: C.verde, border: 0, color: '#0b141a', borderRadius: '50%', width: 36, height: 36, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}><MessageSquarePlus size={18} /></button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '4px 10px 8px', overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0 }}>
        {GRUPOS.map(g => {
          const st = porGrupo[g.k] || { n: 0, sinLeer: 0 }
          const on = grupoSel === g.k
          return (
            <button key={g.k} onClick={() => elegirGrupo(g.k)} title={g.t}
              style={{ flexShrink: 0, border: 0, borderRadius: 16, padding: '6px 12px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                background: on ? '#103529' : C.cabecera, color: on ? '#25D366' : C.tenue, fontWeight: on ? 600 : 400, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {g.corto}
              {st.sinLeer > 0
                ? <span style={{ background: C.verde, color: '#0b141a', borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '0 6px', lineHeight: '17px' }}>{st.sinLeer}</span>
                : <span style={{ opacity: 0.7, fontSize: 11.5 }}>{st.n}</span>}
            </button>
          )
        })}
      </div>
      <div style={{ overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch' as any }}>
        {cargando && <div style={{ color: C.tenue, padding: 16, fontSize: 13 }}>Cargando…</div>}
        {!cargando && chats.length === 0 && <div style={{ color: C.tenue, padding: 16, fontSize: 13 }}>{buscar ? 'Nada coincide con la búsqueda.' : 'Sin conversaciones en este grupo.'}</div>}
        {chats.map(c => {
          const u = c.ultimo!
          const prefijo = u.direction === 'out' ? (u.template_name ? 'Plantilla: ' : u.sent_by ? 'Tú: ' : 'Bot: ') : ''
          return (
            <div key={c.key} onClick={() => abrir(c.key)}
              style={{ display: 'flex', gap: 12, padding: '10px 14px', cursor: 'pointer', background: !unPanel && sel === c.key ? C.activo : 'transparent' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#2a3942', color: COLOR_GRUPO[c.grupo], display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icono c={c} size={22} />
              </div>
              <div style={{ flex: 1, minWidth: 0, borderBottom: `1px solid ${C.borde}`, paddingBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ color: C.texto, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: c.sinLeer ? 600 : 400 }}>{c.quien.nombre}</span>
                  <span style={{ color: c.sinLeer ? C.verde : C.tenue, fontSize: 12, flexShrink: 0 }}>{fechaLista(u.created_at)}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                  <div style={{ flex: 1, minWidth: 0, color: C.tenue, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', gap: 4, alignItems: 'center' }}>
                    {u.direction === 'out' && <span style={{ flexShrink: 0, display: 'inline-flex' }}><Palomitas m={u} /></span>}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{prefijo}{(u.body || `[${u.kind || 'mensaje'}]`).replace(/\*+/g, '').replace(/\n+/g, ' ')}</span>
                  </div>
                  {c.sinLeer > 0 && <span style={{ background: C.verde, color: '#0b141a', borderRadius: 11, minWidth: 21, height: 21, fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 6px', flexShrink: 0 }}>{c.sinLeer}</span>}
                </div>
              </div>
            </div>
          )
        })}
        <div style={{ height: 'env(safe-area-inset-bottom)' }} />
      </div>
    </div>
  )

  // ---- Panel de la conversación ----
  const conversacion = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      {!chat ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: C.tenue, fontSize: 14 }}>Elige una conversación</div>
      ) : (<>
        <div style={{ background: C.cabecera, padding: unPanel ? `calc(${app ? 'env(safe-area-inset-top)' : '0px'} + 8px) 6px 8px 4px` : '10px 16px', display: 'flex', alignItems: 'center', gap: unPanel ? 6 : 12, position: 'relative', flexShrink: 0 }}>
          {unPanel && <button onClick={regresar} aria-label="Regresar" style={{ background: 'none', border: 0, color: C.texto, padding: 6, cursor: 'pointer', display: 'grid', placeItems: 'center' }}><ArrowLeft size={22} /></button>}
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#2a3942', color: COLOR_GRUPO[chat.grupo], display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icono c={chat} size={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: C.texto, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.quien.nombre}</div>
            <div style={{ color: C.tenue, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {unPanel
                ? (ventanaAbierta ? <span style={{ color: '#6ee7b7' }}>Puedes escribir · {NOMBRE_GRUPO[chat.grupo]}</span> : `${chat.msgs.length ? 'Ventana cerrada' : 'Chat nuevo'}: sale como plantilla · ${NOMBRE_GRUPO[chat.grupo]}`)
                : <>{chat.telefono}{chat.quien.detalle ? ` · ${chat.quien.detalle}` : ''} · <span style={{ color: COLOR_GRUPO[chat.grupo] }}>{NOMBRE_GRUPO[chat.grupo]}</span></>}
            </div>
          </div>
          {!unPanel && (
            <div style={{ color: ventanaAbierta ? '#6ee7b7' : C.tenue, fontSize: 12, textAlign: 'right' }}>
              {ventanaAbierta
                ? `Puedes escribir hasta ${new Date(ventanaHasta).toLocaleString('es-MX', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
                : chat.msgs.length ? 'Ventana de 24 h cerrada: sale como plantilla' : 'Chat nuevo: el primer mensaje sale como plantilla'}
            </div>
          )}
          <button onClick={() => setMenuChat(v => !v)} aria-label="Opciones" style={{ background: 'none', border: 0, color: C.tenue, padding: 6, cursor: 'pointer', display: 'grid', placeItems: 'center' }}><MoreVertical size={20} /></button>
          {menuChat && (
            <div style={{ position: 'absolute', top: '100%', right: 8, background: C.panel, border: `1px solid ${C.borde}`, borderRadius: 10, padding: 6, zIndex: 20, minWidth: 250, boxShadow: '0 6px 20px rgba(0,0,0,.5)' }}>
              <div style={{ color: C.tenue, fontSize: 12, padding: '6px 10px 4px' }}>{chat.telefono}{chat.quien.detalle ? ` · ${chat.quien.detalle}` : ''}</div>
              <div style={{ color: C.tenue, fontSize: 11.5, padding: '6px 10px 2px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Mover a</div>
              {(Object.keys(NOMBRE_GRUPO) as Grupo[]).map(g => (
                <div key={g} onClick={() => moverA(chat, g)}
                  style={{ padding: '9px 10px', borderRadius: 6, cursor: 'pointer', color: C.texto, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.hover }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  <span style={{ width: 16, color: C.verde }}>{chat.grupo === g ? <Check size={15} /> : null}</span>
                  <span style={{ flex: 1 }}>{NOMBRE_GRUPO[g]}</span>
                  {chat.grupoAuto === g && <span style={{ color: C.tenue, fontSize: 11 }}>automático</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div onClick={() => { setMenuChat(false); setMenuAdj(false) }} style={{ flex: 1, overflowY: 'auto', padding: unPanel ? '10px 10px' : '14px 6%', background: C.fondo, minHeight: 0, WebkitOverflowScrolling: 'touch' as any }}>
          {chat.msgs.length === 0 && (
            <div style={{ textAlign: 'center', margin: '28px 12px', color: C.tenue, fontSize: 13.5 }}>
              <span style={{ background: C.cabecera, padding: '8px 14px', borderRadius: 8, display: 'inline-block' }}>Sin mensajes con {chat.quien.nombre}. Escribe abajo para empezar.</span>
            </div>
          )}
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
                  <div style={{ maxWidth: unPanel ? '86%' : '72%', background: sale ? C.saliente : C.entrante, color: C.texto, borderRadius: 8, padding: '6px 9px 4px', fontSize: unPanel ? 15 : 14, lineHeight: 1.4, boxShadow: '0 1px 0.5px rgba(0,0,0,.13)', border: m.status === 'fallido' ? '1px solid #f8717188' : 'none' }}>
                    {autor && (
                      <div style={{ fontSize: 11.5, color: '#9de1cf', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {autor === 'Bot' ? <Bot size={12} /> : null}{autor}
                      </div>
                    )}
                    {m.media_path && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,.18)', padding: '6px 8px', borderRadius: 6, marginBottom: 4, fontSize: 13, overflowWrap: 'anywhere' }}>
                        <FileText size={16} style={{ flexShrink: 0 }} /> {m.media_path.split('/').pop()}
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

        {error && <div style={{ background: '#3b1d1d', color: '#fca5a5', fontSize: 12.5, padding: '6px 16px', flexShrink: 0 }} onClick={() => setError('')}>{error}</div>}
        {buscador && (
          <div style={{ background: C.panel, borderTop: `1px solid ${C.borde}`, padding: '10px 14px', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input autoFocus value={qDoc} onChange={e => setQDoc(e.target.value)} placeholder={buscador === 'cotizacion' ? 'Folio o nombre de la cotización' : 'Nombre del lead (ej. L202 Tawil)'}
                style={{ flex: 1, minWidth: 0, background: '#2a3942', border: 0, outline: 'none', borderRadius: 8, padding: '8px 10px', color: C.texto, fontSize: tamTexto }} />
              <button onClick={() => { setBuscador(null); setQDoc('') }} style={{ background: 'none', border: 0, color: C.tenue, cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <div style={{ maxHeight: 190, overflowY: 'auto' }}>
              {opciones.length === 0 && <div style={{ color: C.tenue, fontSize: 12.5 }}>Sin resultados.</div>}
              {opciones.map(o => (
                <div key={o.id} onClick={() => {
                  if (o.deshabilitado) return
                  setAdjunto(buscador === 'cotizacion'
                    ? { etiqueta: `la cotización ${o.titulo}`, documento: { tipo: 'cotizacion', cotizacion_id: o.id } }
                    : { etiqueta: `el estado de cuenta de ${o.titulo}`, documento: { tipo: 'estado_cuenta', lead_id: o.id } })
                  setBuscador(null); setQDoc('')
                }} style={{ padding: '8px 8px', borderRadius: 6, cursor: o.deshabilitado ? 'not-allowed' : 'pointer', color: o.deshabilitado ? C.tenue : C.texto, fontSize: 13.5 }}
                  onMouseEnter={e => { if (!o.deshabilitado) e.currentTarget.style.background = C.hover }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  {o.titulo} <span style={{ color: C.tenue, fontSize: 11.5 }}>· {o.deshabilitado || o.detalle}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {adjunto && (
          <div style={{ background: C.panel, borderTop: `1px solid ${C.borde}`, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, color: C.texto, fontSize: 13, flexShrink: 0 }}>
            <FileText size={16} color={C.verde} style={{ flexShrink: 0 }} /> <span style={{ flex: 1, minWidth: 0 }}>Adjunto: {adjunto.etiqueta}{texto.trim() ? '' : ' · el texto que escribas va como pie'}</span>
            <button onClick={() => setAdjunto(null)} style={{ background: 'none', border: 0, color: C.tenue, cursor: 'pointer' }}><X size={15} /></button>
          </div>
        )}
        {!ventanaAbierta && !adjunto && (
          <div style={{ background: C.panel, color: C.tenue, fontSize: 12.5, padding: '7px 14px', textAlign: 'center', flexShrink: 0 }}>
            {chat.msgs.length ? 'Pasaron más de 24 h desde su último mensaje' : 'No hay conversación todavía'}: tu mensaje le llega dentro de una plantilla de WhatsApp («Hola…, {chat.quien.tipo === 'equipo' ? 'tienes un aviso del ERP de OMM' : `${miNombre} de OMM Technologies te escribe`}: …»). Cuando conteste, ya escribes libre.{' Si le mandas un archivo, se le entrega en cuanto conteste.'}
          </div>
        )}
        <div style={{ background: unPanel ? C.fondo : C.cabecera, padding: unPanel ? '6px 6px calc(env(safe-area-inset-bottom) + 6px)' : '10px 14px', display: 'flex', gap: unPanel ? 6 : 10, alignItems: 'flex-end', position: 'relative', flexShrink: 0 }}>
          <input ref={archivoRef} type="file" style={{ display: 'none' }} onChange={e => { elegirArchivo(e.target.files?.[0]); e.target.value = '' }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end', background: unPanel ? C.cabecera : 'transparent', borderRadius: 22, gap: 2 }}>
            <button onClick={() => setMenuAdj(v => !v)} disabled={!puedeAdjuntar || enviando} title={puedeAdjuntar ? 'Adjuntar' : 'Ventana cerrada: a un cliente no se le pueden mandar archivos'}
              style={{ width: 40, height: 44, border: 0, background: 'transparent', color: C.tenue, cursor: puedeAdjuntar ? 'pointer' : 'not-allowed', opacity: puedeAdjuntar ? 1 : 0.4, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
              <Paperclip size={20} />
            </button>
            <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={Math.min(5, Math.max(1, texto.split('\n').length))}
              onKeyDown={e => { if (!movil && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandar() } }}
              disabled={enviando || (!!adjunto && !puedeAdjuntar)}
              placeholder={adjunto ? 'Pie del documento (opcional)' : ventanaAbierta ? 'Mensaje' : 'Mensaje (sale como plantilla)'}
              style={{ flex: 1, minWidth: 0, resize: 'none', background: unPanel ? 'transparent' : '#2a3942', border: 0, outline: 'none', borderRadius: 8, padding: '11px 10px', color: C.texto, fontSize: tamTexto, fontFamily: 'inherit', maxHeight: 130, lineHeight: 1.35 }} />
          </div>
          {menuAdj && (
            <div style={{ position: 'absolute', bottom: '100%', left: 8, marginBottom: 6, background: C.panel, border: `1px solid ${C.borde}`, borderRadius: 10, padding: 6, zIndex: 20, minWidth: 240, boxShadow: '0 6px 20px rgba(0,0,0,.5)' }}>
              {[
                { k: 'archivo', t: movil ? 'Archivo o foto' : 'Archivo de tu computadora' },
                { k: 'cotizacion', t: 'Cotización (PDF del ERP)' },
                { k: 'estado_cuenta', t: 'Estado de cuenta de un lead' },
              ].map(o => (
                <div key={o.k} onClick={() => { setMenuAdj(false); if (o.k === 'archivo') archivoRef.current?.click(); else { setBuscador(o.k as any); setQDoc('') } }}
                  style={{ padding: '10px 10px', borderRadius: 6, cursor: 'pointer', color: C.texto, fontSize: 14 }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.hover }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>{o.t}</div>
              ))}
            </div>
          )}
          <button onClick={mandar} disabled={enviando || (adjunto ? !puedeAdjuntar : !texto.trim())} aria-label="Enviar"
            style={{ width: 46, height: 46, borderRadius: '50%', border: 0, background: C.verde, color: '#0b141a', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0, opacity: enviando || (adjunto ? !puedeAdjuntar : !texto.trim()) ? 0.4 : 1 }}>
            <Send size={19} />
          </button>
        </div>
      </>)}
    </div>
  )

  const contenedor: React.CSSProperties = app
    ? { position: 'fixed', inset: 0, height: '100dvh', display: 'flex', background: C.fondo, overflow: 'hidden' }
    : { display: 'flex', height: movil ? 'calc(100dvh - 150px)' : 'calc(100vh - 210px)', minHeight: 420, border: `1px solid ${C.borde}`, borderRadius: movil ? 10 : 12, overflow: 'hidden', background: C.fondo }

  return (
    <div style={contenedor}>
      {nuevo ? (unPanel ? panelNuevo : <>{panelNuevo}{conversacion}</>) : <>{verLista && lista}{verChat && conversacion}</>}
    </div>
  )
}
