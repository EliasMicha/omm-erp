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
      'Respuestas sencillas a alguien del equipo ("recibido", "gracias", "ahorita lo veo") pueden ir directo. ' +
      'Con `documento` manda el PDF de una cotización o el estado de cuenta de un lead (siempre con vista previa y sí). ' +
      'Sirve también para INICIAR una conversación con alguien que nunca ha escrito (por teléfono o por nombre de empleado/contacto): ' +
      'si no hay ventana de 24 h sale como plantilla (al equipo, aviso del ERP; a cualquier otro, omm_mensaje_cliente con tu nombre). ' +
      'A un cliente sólo se le pueden mandar archivos si escribió en las últimas 24 h.',
    inputSchema: {
      type: 'object',
      properties: {
        telefono: { type: 'string' },
        persona: { type: 'string', description: 'Nombre (empleado o contacto de mantenimiento), si no se tiene el teléfono.' },
        mensaje: { type: 'string', description: 'El texto. Si va con documento, es el pie del archivo (opcional).' },
        documento: {
          type: 'object',
          description: 'Para mandar un archivo: la cotización (PDF tal como se descargó en el ERP) o el estado de cuenta de un lead. Siempre pide aprobación.',
          properties: {
            tipo: { type: 'string', enum: ['cotizacion', 'estado_cuenta'] },
            cotizacion: { type: 'string', description: 'Folio (DLAN-ES01), nombre o id de la cotización.' },
            formato: { type: 'string', enum: ['ejecutivo', 'lista', 'resumen'], description: 'Opcional. El técnico NO sale a clientes.' },
            lead: { type: 'string', description: 'Para estado de cuenta: nombre o id del lead.' },
            cotizaciones: { type: 'array', items: { type: 'string' }, description: 'Opcional: folios para un estado de cuenta PARCIAL.' },
          },
          required: ['tipo'],
        },
        importante: { type: 'boolean', description: 'true si compromete algo o va a un cliente.' },
        confirmar: { type: 'boolean', description: 'true SOLO después de que la persona aprobó la vista previa.' },
      },
    },
  },
]

interface Quien2 { nombre: string; tipo: 'equipo' | 'cliente' | 'desconocido'; detalle?: string }

async function directorio(sb: SupabaseClient): Promise<Record<string, Quien2>> {
  const mapa: Record<string, Quien2> = {}
  const { data: ce } = await sb.from('contactos_externos').select('nombre, telefono, rol, leads(name), obras(nombre)').eq('activo', true)
  for (const c of (ce || []) as any[]) {
    const k = ult10(c.telefono || ''); if (k.length === 10) mapa[k] = { nombre: c.nombre, tipo: 'cliente', detalle: [c.rol, c.leads?.name || c.obras?.nombre].filter(Boolean).join(' · ') }
  }
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
      const conDoc = !!args?.documento?.tipo
      if (!['DG', 'Administracion', ...(conDoc ? ['Ventas_Ingenieria'] : [])].includes(area)) return texto({ error: conDoc ? 'Mandar documentos es para Dirección, Administración y Ventas/Ingeniería.' : 'Mandar WhatsApp desde el ERP es solo para Dirección y Administración.' })
      if (!quien.token) return texto({ error: 'Sin token de la sesión; no puedo mandar a tu nombre.' })
      const msg = String(args?.mensaje || '').trim()
      if (!msg && !conDoc) return texto({ error: 'Falta el mensaje.' })
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
      if (conDoc) return await enviarDocumento(sb, quien.token, args, tel, q, ventana, msg)

      // Ventana cerrada (o primera vez): sale como plantilla. Al equipo, el aviso
      // del ERP; a cualquier otro, omm_mensaje_cliente. La regla vive en
      // whatsapp-send (send_message); aquí sólo se arma la vista previa.
      const primer = (q.tipo !== 'desconocido' && (q.nombre || '').split(/\s+/)[0]) || (q.tipo === 'equipo' ? 'equipo' : 'buen día')
      const firma = String(quien.nombre || 'OMM').split(/\s+/)[0]
      const plano = msg.replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').slice(0, 900).trim()
      const comoSale = ventana ? msg
        : q.tipo === 'equipo'
          ? `Hola ${primer}, tienes un aviso del ERP de OMM: de parte de ${firma}: ${plano}. Responde a este mensaje para atenderlo con el asistente.`
          : `Hola ${primer}, ${firma} de OMM Technologies te escribe:\n\n${plano}\n\nPuedes responder a este mensaje para continuar la conversación.`
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
        await llamarSend(quien.token, { action: 'send_message', to: '+52' + tel, text: msg, nombre: q.tipo !== 'desconocido' ? q.nombre : undefined })
      } catch (e) {
        const err = (e as Error).message
        return texto({ enviado: false, error: /131042|payment/i.test(err) ? 'Meta rechazó el envío por pago: falta la tarjeta en WhatsApp Manager.' : err })
      }
      return texto({ enviado: true, para: q.nombre, telefono: telBonito(tel), como: ventana ? 'texto libre' : q.tipo === 'equipo' ? 'plantilla omm_aviso_equipo' : 'plantilla omm_mensaje_cliente', aprobado: motivos.length ? 'sí, con confirmación' : 'no requería',
        nota: 'Meta confirma la entrega unos segundos después; si la rechaza (p. ej. por pago), whatsapp_leer lo muestra como fallido.' })
    }
  }
  return texto({ error: `Herramienta desconocida: ${nombre}` })
}

// ── Documentos: cotización o estado de cuenta ──────────────────────────────
const limpiar = (t: string) => t.replace(/[,()*%\\]/g, ' ').replace(/\s+/g, ' ').trim()

async function resolverCotizacion(sb: SupabaseClient, t: string) {
  const q = limpiar(t)
  if (/^[0-9a-f-]{36}$/i.test(q)) {
    const { data } = await sb.from('quotations').select('id, folio, name, stage, total_final, total').eq('id', q).maybeSingle()
    return data ? { cot: data } : { error: 'No encontré esa cotización.' }
  }
  const { data: exacto } = await sb.from('quotations').select('id, folio, name, stage, total_final, total').ilike('folio', q).is('archived_at', null).limit(2)
  if (exacto?.length === 1) return { cot: exacto[0] }
  const { data } = await sb.from('quotations').select('id, folio, name, stage, total_final, total').is('archived_at', null)
    .or(`folio.ilike.%${q}%,name.ilike.%${q}%`).order('updated_at', { ascending: false }).limit(8)
  if (!data?.length) return { error: `No encontré cotizaciones con "${t}".` }
  if (data.length === 1) return { cot: data[0] }
  return { candidatas: data.map((c: any) => ({ folio: c.folio, nombre: c.name, etapa: c.stage })) }
}

async function resolverLead(sb: SupabaseClient, t: string) {
  const q = limpiar(t)
  if (/^[0-9a-f-]{36}$/i.test(q)) {
    const { data } = await sb.from('leads').select('id, name').eq('id', q).maybeSingle()
    return data ? { lead: data } : { error: 'No encontré ese lead.' }
  }
  let c = sb.from('leads').select('id, name, company').is('archived_at', null).limit(10)
  for (const w of q.split(' ').filter(w => w.length >= 2)) c = c.ilike('name', `%${w}%`)
  const { data } = await c
  if (!data?.length) return { error: `Ningún lead se llama como "${t}".` }
  if (data.length === 1) return { lead: data[0] }
  return { candidatas: data.map((l: any) => ({ lead: l.name, despacho: l.company })) }
}

async function enviarDocumento(sb: SupabaseClient, token: string, args: any, tel: string, q: Quien2, ventana: boolean, msg: string) {
  const d = args.documento || {}
  if (!ventana && q.tipo !== 'equipo') {
    return texto({ error: `${q.nombre} no ha escrito en las últimas 24 h: WhatsApp no deja mandarle archivos. Pídele que escriba al número de OMM y vuelve a intentarlo.` })
  }
  let documento: Record<string, unknown>
  let descripcion: string
  if (d.tipo === 'cotizacion') {
    const r: any = await resolverCotizacion(sb, String(d.cotizacion || ''))
    if (r.error) return texto({ error: r.error })
    if (r.candidatas) return texto({ necesita_elegir: true, candidatas: r.candidatas })
    if (d.formato === 'tecnico' && q.tipo !== 'equipo') return texto({ error: 'El formato técnico trae costos internos: no sale a un cliente.' })
    const { data: pdfs } = await sb.from('cotizacion_pdfs').select('formato, interno, generado_at, total_al_generar').eq('quotation_id', r.cot.id).order('generado_at', { ascending: false })
    const pdf = d.formato ? (pdfs || []).find((x: any) => x.formato === d.formato) : (pdfs || []).find((x: any) => !x.interno)
    if (!pdf) return texto({ error: `${r.cot.folio || r.cot.name} no tiene PDF guardado${d.formato ? ' en formato ' + d.formato : ''}: hay que abrirla y darle "Descargar PDF" una vez en el ERP.` })
    const hoy = Number(r.cot.total_final ?? r.cot.total)
    const viejo = pdf.total_al_generar != null && Math.abs(hoy - Number(pdf.total_al_generar)) > 0.01
    if (viejo) return texto({ error: `El PDF guardado de ${r.cot.folio} es anterior al último cambio (era ${pdf.total_al_generar}, hoy ${hoy}). Descárgalo otra vez en el ERP antes de mandarlo.` })
    documento = { tipo: 'cotizacion', cotizacion_id: r.cot.id, formato: pdf.formato }
    descripcion = `Cotización ${r.cot.folio || ''} ${r.cot.name} (PDF ${pdf.formato} del ${new Date(pdf.generado_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' })})`
  } else if (d.tipo === 'estado_cuenta') {
    const r: any = await resolverLead(sb, String(d.lead || ''))
    if (r.error) return texto({ error: r.error })
    if (r.candidatas) return texto({ necesita_elegir: true, candidatas: r.candidatas })
    let ids: string[] | undefined
    if (Array.isArray(d.cotizaciones) && d.cotizaciones.length) {
      const { data } = await sb.from('quotations').select('id, folio').in('folio', d.cotizaciones.map(String))
      ids = (data || []).map((x: any) => x.id)
      if (!ids.length) return texto({ error: 'Ninguno de esos folios existe.' })
    }
    documento = { tipo: 'estado_cuenta', lead_id: r.lead.id, ...(ids ? { cotizaciones: ids } : {}) }
    descripcion = `Estado de cuenta${ids ? ' parcial (' + ids.length + ' cotizaciones)' : ''} de ${r.lead.name}`
  } else return texto({ error: 'documento.tipo es cotizacion o estado_cuenta.' })

  if (!args?.confirmar) {
    return texto({
      requiere_aprobacion: true,
      por_que: ['manda un documento' + (q.tipo !== 'equipo' ? ' a alguien fuera del equipo' : '')],
      para: { nombre: q.nombre, tipo: q.tipo, telefono: telBonito(tel) },
      documento: descripcion,
      pie: msg || '(el nombre del documento)',
      como_sale: ventana ? 'el archivo, directo al chat' : 'aviso con plantilla; el archivo le llega cuando conteste',
      instruccion: 'Enseña esto y pregunta "¿Lo mando?". Solo con un sí, vuelve a llamar con confirmar=true y lo mismo.',
    })
  }
  try {
    const r = await llamarSend(token, { action: 'send_document', to: '+52' + tel, documento, caption: msg || undefined })
    return texto({ enviado: true, para: q.nombre, documento: descripcion, ...(r?.diferido ? { nota: r.nota } : {}) })
  } catch (e) {
    return texto({ enviado: false, error: (e as Error).message })
  }
}
