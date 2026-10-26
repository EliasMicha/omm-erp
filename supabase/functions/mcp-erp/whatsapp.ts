// Bloque WhatsApp — leer las conversaciones del número de OMM y contestar.
//
// Elias: "que el MCP pueda mandar mensajes por WhatsApp, leerlos, contestar con
// aprobación si son cosas importantes y no cosas sencillas o básicas".
//
// LEER: la bitácora `whatsapp_messages` (entrantes y salientes), con RLS: la ve
// cualquier usuario real del ERP.
//
// MANDAR: NO se habla con Meta desde aquí. Se llama a la Edge Function
// `whatsapp-send` con el JWT de la persona, así el envío queda a su nombre
// (sent_by) y en la misma bitácora que la pantalla. Una sola implementación.
//
// LA APROBACIÓN NO LA DECIDE SOLO EL MODELO. El servidor exige vista previa +
// confirmar=true cuando:
//   - el modelo la marca importante, o
//   - el destinatario no es del equipo (cliente o número desconocido), o
//   - el texto trae dinero, fechas/compromisos o es largo, o
//   - la ventana de 24 h está cerrada (sale como plantilla).
// Lo demás —un "recibido", "gracias", "ahorita lo veo" a alguien del equipo
// dentro de la ventana— sale directo.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Quien } from './tools.ts'

const PROJECT = Deno.env.get('SUPABASE_URL') || 'https://ubbumxommqjcpdozpunf.supabase.co'
const ANON = Deno.env.get('SUPABASE_ANON_KEY') || ''
const VENTANA_MS = 24 * 3600 * 1000
const texto = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] })
const ult10 = (p: string) => (p || '').replace(/\D/g, '').slice(-10)
const telBonito = (t: string) => t.length === 10 ? `+52 ${t.slice(0, 2)} ${t.slice(2, 6)} ${t.slice(6)}` : t

export const DEFINICIONES_WA = [
  {
    name: 'whatsapp_conversaciones',
    annotations: { readOnlyHint: true },
    description:
      'Lista los chats del número de WhatsApp de OMM: con quién (equipo, cliente o desconocido), último mensaje, ' +
      'si hay mensajes sin contestar y si la ventana de 24 h sigue abierta para responder con texto libre. ' +
      'Empiece por aquí cuando pregunten "quién escribió", "qué hay en WhatsApp" o "a quién le debo respuesta".',
    inputSchema: {
      type: 'object',
      properties: {
        buscar: { type: 'string', description: 'Nombre, número o texto a buscar.' },
        solo_sin_respuesta: { type: 'boolean', description: 'Solo chats cuyo último mensaje es de la otra persona.' },
        limite: { type: 'integer', description: 'Por defecto 25.' },
      },
    },
  },
  {
    name: 'whatsapp_leer',
    annotations: { readOnlyHint: true },
    description: 'Lee la conversación con una persona (por teléfono o nombre), en orden cronológico, con quién mandó cada mensaje y su estado.',
    inputSchema: {
      type: 'object',
      properties: {
        telefono: { type: 'string', description: '10 dígitos o con lada.' },
        persona: { type: 'string', description: 'Nombre, si no se tiene el teléfono.' },
        limite: { type: 'integer', description: 'Últimos N mensajes. Por defecto 40.' },
      },
    },
  },
  {
    name: 'whatsapp_enviar',
    description:
      'Manda un WhatsApp desde el número de OMM a nombre de quien usa el ERP. ' +
      'Marque importante=true si el mensaje compromete algo (precios, montos, fechas, entregas, condiciones), ' +
      'va a un cliente, o puede molestar a alguien; en ese caso, y siempre que la respuesta traiga requiere_aprobacion, ' +
      'ENSEÑE la vista previa y pida el sí antes de volver a llamar con confirmar=true. ' +
      'Respuestas sencillas a alguien del equipo ("recibido", "gracias", "ahorita lo veo") pueden ir directo.',
    inputSchema: {
      type: 'object',
      properties: {
        telefono: { type: 'string' },
        persona: { type: 'string', description: 'Nombre (empleado o contacto de mantenimiento), si no se tiene el teléfono.' },
        mensaje: { type: 'string' },
        importante: { type: 'boolean', description: 'true si compromete algo o va a un cliente.' },
        confirmar: { type: 'boolean', description: 'true SOLO después de que la persona aprobó la vista previa.' },
      },
      required: ['mensaje'],
    },
  },
]

interface Quien2 { nombre: string; tipo: 'equipo' | 'cliente' | 'desconocido'; detalle?: string }

async function directorio(sb: SupabaseClient): Promise<Record<string, Quien2>> {
  const mapa: Record<string, Quien2> = {}
  const [{ data: emps }, { data: mc }, { data: ac }] = await Promise.all([
    sb.from('employees').select('nombre, name, puesto, telefono_personal, obra_app_phone, phone').eq('activo', true),
    sb.from('maintenance_contacts').select('name, phone_e164, property:maintenance_properties(name)'),
    sb.from('agent_contacts').select('display_name, phone_e164'),
  ])
  for (const e of (emps || []) as any[]) for (const t of [e.telefono_personal, e.obra_app_phone, e.phone]) {
    const k = ult10(t || ''); if (k.length === 10) mapa[k] = { nombre: e.nombre || e.name, tipo: 'equipo', detalle: e.puesto || undefined }
  }
  for (const c of (mc || []) as any[]) {
    const k = ult10(c.phone_e164 || ''); if (k.length === 10) mapa[k] = { nombre: c.name, tipo: 'cliente', detalle: c.property?.name || undefined }
  }
  for (const a of (ac || []) as any[]) {
    const k = ult10(a.phone_e164 || ''); if (k.length === 10 && !mapa[k]) mapa[k] = { nombre: a.display_name, tipo: 'equipo' }
  }
  return mapa
}

function quienMando(m: any) {
  if (m.direction === 'in') return 'ellos'
  if (m.template_name) return `plantilla ${m.template_name}`
  return m.sent_by ? 'persona desde el ERP' : 'bot'
}

// Resuelve teléfono a partir de teléfono o nombre. Devuelve candidatas si hay varias.
async function resolver(sb: SupabaseClient, args: any, dir: Record<string, Quien2>) {
  const t = ult10(String(args?.telefono || ''))
  if (t.length === 10) return { tel: t }
  const n = String(args?.persona || '').trim().toLowerCase()
  if (!n) return { error: 'Dígame el teléfono o el nombre.' }
  const hits = Object.entries(dir).filter(([, q]) => q.nombre?.toLowerCase().includes(n))
  if (hits.length === 1) return { tel: hits[0][0] }
  if (hits.length > 1) return { candidatas: hits.slice(0, 10).map(([k, q]) => ({ telefono: telBonito(k), nombre: q.nombre, tipo: q.tipo, detalle: q.detalle })) }
  return { error: `No encontré a "${args?.persona}" con teléfono en empleados ni en contactos de mantenimiento.` }
}

async function mensajesDe(sb: SupabaseClient, tel10: string, limite: number) {
  const { data, error } = await sb.from('whatsapp_messages')
    .select('direction, phone_e164, kind, body, template_name, status, error, created_at, sent_by, ticket_id')
    .like('phone_e164', `%${tel10}`)
    .order('created_at', { ascending: false }).limit(limite)
  if (error) throw new Error(error.message)
  return (data || []).reverse()
}

// ¿Merece aprobación? Regla del servidor; el modelo no la puede saltar.
export function motivosDeAprobacion(msg: string, tipo: Quien2['tipo'], importante: boolean, ventana: boolean): string[] {
  const m: string[] = []
  if (importante) m.push('lo marcaste como importante')
  if (tipo !== 'equipo') m.push(tipo === 'cliente' ? 'va a un cliente' : 'el número no está registrado')
  if (/\$\s?\d|\d[\d,.]*\s?(mxn|usd|pesos|d[oó]lares|mil\b)|\b\d{1,3}(,\d{3})+\b/i.test(msg)) m.push('menciona dinero')
  if (/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|mañana|pasado mañana|semana|fecha|entreg|instal|program|cotiz|precio|anticipo|factur|pag[oa])/i.test(msg)) m.push('menciona fechas, entregas, precios o pagos')
  if (msg.length > 280) m.push('es largo')
  if (!ventana) m.push('la ventana de 24 h está cerrada: sale como plantilla')
  return m
}

async function llamarSend(token: string, payload: Record<string, unknown>) {
  const r = await fetch(`${PROJECT}/functions/v1/whatsapp-send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const b = await r.json().catch(() => ({}))
  if (!r.ok || b?.ok === false) throw new Error(b?.error || `whatsapp-send respondió ${r.status}`)
  return b
}

export async function ejecutarWa(nombre: string, args: any, sb: SupabaseClient, quien: Quien & { area?: string | null; token?: string }) {
  switch (nombre) {
    case 'whatsapp_conversaciones': {
      const lim = Math.min(Math.max(Number(args?.limite) || 25, 1), 100)
      const [{ data, error }, dir] = await Promise.all([
        sb.from('whatsapp_messages').select('direction, phone_e164, body, template_name, status, created_at, sent_by')
          .order('created_at', { ascending: false }).limit(1500),
        directorio(sb),
      ])
      if (error) return texto({ error: error.message })
      const chats: Record<string, any> = {}
      for (const m of (data || []) as any[]) {
        const k = ult10(m.phone_e164)
        const c = chats[k] || (chats[k] = { telefono: telBonito(k), ...(dir[k] || { nombre: telBonito(k), tipo: 'desconocido' }), ultimo: m, ultimo_entrante: null, mensajes: 0 })
        c.mensajes++
        if (m.direction === 'in' && !c.ultimo_entrante) c.ultimo_entrante = m.created_at
      }
      const q = String(args?.buscar || '').trim().toLowerCase()
      let lista = Object.values(chats)
      if (q) lista = lista.filter((c: any) => c.nombre?.toLowerCase().includes(q) || c.telefono.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§') || (c.ultimo.body || '').toLowerCase().includes(q))
      if (args?.solo_sin_respuesta) lista = lista.filter((c: any) => c.ultimo.direction === 'in')
      return texto({
        chats: lista.slice(0, lim).map((c: any) => ({
          nombre: c.nombre, tipo: c.tipo, detalle: c.detalle, telefono: c.telefono,
          ultimo_mensaje: { de: quienMando(c.ultimo), texto: (c.ultimo.body || '').slice(0, 200), fecha: c.ultimo.created_at, estado: c.ultimo.status },
          esperando_respuesta: c.ultimo.direction === 'in',
          ventana_abierta: !!c.ultimo_entrante && Date.now() - new Date(c.ultimo_entrante).getTime() < VENTANA_MS,
          mensajes: c.mensajes,
        })),
        total: lista.length,
      })
    }

    case 'whatsapp_leer': {
      const dir = await directorio(sb)
      const r = await resolver(sb, args, dir)
      if ('error' in r) return texto({ error: r.error })
      if ('candidatas' in r) return texto({ necesita_elegir: true, candidatas: r.candidatas })
      const msgs = await mensajesDe(sb, r.tel!, Math.min(Math.max(Number(args?.limite) || 40, 1), 200))
      const ultimoIn = [...msgs].reverse().find((m: any) => m.direction === 'in')
      return texto({
        con: { telefono: telBonito(r.tel!), ...(dir[r.tel!] || { nombre: telBonito(r.tel!), tipo: 'desconocido' }) },
        ventana_abierta_hasta: ultimoIn ? new Date(new Date(ultimoIn.created_at).getTime() + VENTANA_MS).toISOString() : null,
        mensajes: msgs.map((m: any) => ({
          fecha: m.created_at, de: quienMando(m), texto: m.body, estado: m.status, error: m.error || undefined,
        })),
      })
    }

    case 'whatsapp_enviar': {
      const area = quien.area || ''
      if (!['DG', 'Administracion'].includes(area)) return texto({ error: 'Mandar WhatsApp desde el ERP es solo para Dirección y Administración.' })
      if (!quien.token) return texto({ error: 'Sin token de la sesión; no puedo mandar a tu nombre.' })
      const msg = String(args?.mensaje || '').trim()
      if (!msg) return texto({ error: 'Falta el mensaje.' })
      const dir = await directorio(sb)
      const r = await resolver(sb, args, dir)
      if ('error' in r) return texto({ error: r.error })
      if ('candidatas' in r) return texto({ necesita_elegir: true, candidatas: r.candidatas })
      const tel = r.tel!
      const q = dir[tel] || { nombre: telBonito(tel), tipo: 'desconocido' as const }

      const hace24 = new Date(Date.now() - VENTANA_MS).toISOString()
      const { data: rec } = await sb.from('whatsapp_messages').select('id').eq('direction', 'in')
        .like('phone_e164', `%${tel}`).gte('created_at', hace24).limit(1)
      const ventana = (rec || []).length > 0
      if (!ventana && q.tipo !== 'equipo') {
        return texto({ error: `${q.nombre} no ha escrito en las últimas 24 h y no es del equipo: Meta solo permite plantillas, y no hay plantilla genérica para clientes. Pídele que escriba al número o usa los avisos de visita/ticket.` })
      }

      const primer = (q.nombre || '').split(/\s+/)[0] || 'equipo'
      const param = `de parte de ${quien.nombre || 'OMM'}: ${msg}`.replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').slice(0, 900)
      const comoSale = ventana ? msg : `Hola ${primer}, tienes un aviso del ERP de OMM: ${param}. Responde a este mensaje para atenderlo con el asistente.`
      const motivos = motivosDeAprobacion(msg, q.tipo, !!args?.importante, ventana)

      if (motivos.length && !args?.confirmar) {
        return texto({
          requiere_aprobacion: true,
          por_que: motivos,
          para: { nombre: q.nombre, tipo: q.tipo, telefono: telBonito(tel) },
          como_sale: comoSale,
          instruccion: 'Enseña esto y pregunta "¿Lo mando?". Solo con un sí, vuelve a llamar con confirmar=true y el mismo mensaje.',
        })
      }

      try {
        if (ventana) await llamarSend(quien.token, { action: 'send_text', to: '+52' + tel, text: msg })
        else await llamarSend(quien.token, { action: 'send_template', to: '+52' + tel, template: 'omm_aviso_equipo', params: [primer, param], sender_type: 'equipo' })
      } catch (e) {
        const err = (e as Error).message
        return texto({ enviado: false, error: /131042|payment/i.test(err) ? 'Meta rechazó el envío por pago: falta la tarjeta en WhatsApp Manager.' : err })
      }
      return texto({ enviado: true, para: q.nombre, telefono: telBonito(tel), como: ventana ? 'texto libre' : 'plantilla omm_aviso_equipo', aprobado: motivos.length ? 'sí, con confirmación' : 'no requería',
        nota: 'Meta confirma la entrega unos segundos después; si la rechaza (p. ej. por pago), whatsapp_leer lo muestra como fallido.' })
    }
  }
  return texto({ error: `Herramienta desconocida: ${nombre}` })
}
