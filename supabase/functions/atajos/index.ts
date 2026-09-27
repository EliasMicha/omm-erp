// ═══════════════════════════════════════════════════════════════════════════
//  atajos — el endpoint de los Shortcuts de iPhone de Elias.
//
//  Por que existe: los shortcuts escribian directo en la tabla action_items
//  con la llave ANON. Funcionaba porque la tabla tenia `using (true)`, o sea
//  porque CUALQUIERA en internet podia escribirle. Al cerrar eso, el shortcut
//  se cayo con:
//
//      42501: new row violates row-level security policy for table action_items
//
//  La tentacion es volver a abrir la tabla a anonimo. No: eso le devuelve a
//  medio mundo el permiso de meterle pendientes al DG. Lo correcto es que el
//  shortcut tenga IDENTIDAD PROPIA, igual que los bots: un token secreto suyo,
//  comparado en tiempo constante, y la escritura hecha aqui con la llave de
//  servicio a nombre de una cuenta real del ERP.
//
//  Ventaja secundaria: el shortcut ya no necesita saber como se llaman las
//  columnas. Manda lo que dicto y aqui se traduce.
//
//  Secretos (Dashboard → Edge Functions → Secrets):
//    ATAJOS_TOKEN         secreto largo y aleatorio, el mismo que va en el atajo
//    ATAJOS_ACTOR_EMAIL   opcional, default elias@omniious.com
//
//  El token viaja en el encabezado x-atajo-token, NO en Authorization. Asi el
//  atajo puede seguir mandando la llave anon en Authorization y la function
//  pasa el verify_jwt de Supabase sin tener que apagarlo a mano en el
//  Dashboard. Nunca por query string: los parametros de URL se quedan escritos
//  en logs, historiales y proxies.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-atajo-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

/** Comparacion en tiempo constante: un == normal filtra el token caracter por caracter. */
function tokenValido(recibido: string, esperado: string): boolean {
  if (!esperado || recibido.length !== esperado.length) return false
  let diff = 0
  for (let i = 0; i < esperado.length; i++) diff |= recibido.charCodeAt(i) ^ esperado.charCodeAt(i)
  return diff === 0
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * El atajo dicta texto, no llena formularios. Se acepta lo que mande:
 * fecha en ISO, o "mañana", o nada.
 */
function fechaDe(v: unknown, zona = -6): string | null {
  const t = s(v).toLowerCase()
  if (!t) return null
  const hoy = new Date(Date.now() + zona * 3600_000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  if (t === 'hoy') return iso(hoy)
  if (t === 'manana' || t === 'mañana') return iso(new Date(hoy.getTime() + 86400_000))
  if (t === 'pasado' || t === 'pasado manana' || t === 'pasado mañana') return iso(new Date(hoy.getTime() + 2 * 86400_000))
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const d = new Date(t)
  return isFinite(d.getTime()) ? iso(d) : null
}

/** "12:15", "12:15 pm", "1230" → "12:15:00". Nada reconocible → null, sin inventar. */
function horaDe(v: unknown): string | null {
  let t = s(v).toLowerCase().replace(/\s+/g, '')
  if (!t) return null
  const pm = /p\.?m\.?$/.test(t), am = /a\.?m\.?$/.test(t)
  t = t.replace(/[ap]\.?m\.?$/, '')
  let h: number, m: number
  const c = t.match(/^(\d{1,2}):(\d{2})$/)
  const n = t.match(/^(\d{3,4})$/)
  if (c) { h = +c[1]; m = +c[2] }
  else if (n) { const x = n[1].padStart(4, '0'); h = +x.slice(0, 2); m = +x.slice(2) }
  else if (/^\d{1,2}$/.test(t)) { h = +t; m = 0 }
  else return null
  if (pm && h < 12) h += 12
  if (am && h === 12) h = 0
  if (h > 23 || m > 59) return null
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00'
}

const PRIORIDAD: Record<string, number> = { urgente: 3, alta: 3, normal: 2, media: 2, baja: 1 }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } })

  const esperado = Deno.env.get('ATAJOS_TOKEN') || ''
  if (!esperado) {
    console.error('[atajos] falta el secreto ATAJOS_TOKEN')
    return json({ ok: false, mensaje: 'El servidor todavia no tiene su token configurado.' }, 500)
  }

  // Primero el encabezado propio; si algun dia se apaga verify_jwt, tambien
  // se acepta por Bearer.
  const auth = req.headers.get('authorization') || ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const recibido = (req.headers.get('x-atajo-token') || '').trim() || bearer
  if (!recibido || !tokenValido(recibido, esperado)) {
    return json({ ok: false, mensaje: 'Token del atajo incorrecto.' }, 401)
  }

  let cuerpo: any
  try { cuerpo = await req.json() } catch { return json({ ok: false, mensaje: 'El atajo mando algo que no es JSON.' }, 400) }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const actorEmail = (Deno.env.get('ATAJOS_ACTOR_EMAIL') || 'elias@omniious.com').toLowerCase()
  const { data: cuenta } = await supabase.from('app_users')
    .select('id, nombre, email, employee_id, permission_area, activo')
    .eq('email', actorEmail).maybeSingle()
  if (!cuenta || cuenta.activo === false) {
    return json({ ok: false, mensaje: `La cuenta ${actorEmail} no existe o esta inactiva en el ERP.` }, 500)
  }

  // El texto puede venir con cualquiera de estos nombres: un atajo dictado no
  // siempre manda la misma llave, y fallar por eso seria absurdo.
  const texto = s(cuerpo.texto) || s(cuerpo.title) || s(cuerpo.titulo) || s(cuerpo.pendiente) || s(cuerpo.nota)
  if (!texto) return json({ ok: false, mensaje: 'No entendi que anotar: mandame el texto.' }, 400)

  const tipo = (s(cuerpo.tipo) || 'pendiente').toLowerCase()
  const fecha = fechaDe(cuerpo.fecha ?? cuerpo.due_date ?? cuerpo.dia)
  const hora = horaDe(cuerpo.hora ?? cuerpo.due_time ?? cuerpo.time)

  try {
    if (tipo === 'cita' || tipo === 'evento') {
      if (!fecha) return json({ ok: false, mensaje: 'Una cita necesita fecha. Dime el dia.' }, 400)
      const inicio = new Date(`${fecha}T${hora ?? '09:00:00'}-06:00`)
      const mins = Number(cuerpo.duracion_min ?? cuerpo.duracion ?? 60) || 60
      const fin = new Date(inicio.getTime() + mins * 60_000)
      const { error } = await supabase.from('calendar_events').insert({
        id: 'atajo-' + crypto.randomUUID(),
        summary: texto,
        description: s(cuerpo.nota) || s(cuerpo.description) || null,
        location: s(cuerpo.lugar) || s(cuerpo.location) || null,
        start_time: inicio.toISOString(),
        end_time: fin.toISOString(),
        all_day: !hora,
        organizer: cuenta.email,
        user_email: cuenta.email,
        calendar_id: 'atajo',
      })
      if (error) throw error
      return json({
        ok: true,
        mensaje: `Cita guardada: ${texto} — ${fecha}${hora ? ' a las ' + hora.slice(0, 5) : ' (todo el dia)'}`,
      })
    }

    // Pendiente. Esta fila tiene que caer EXACTAMENTE donde el ERP la va a
    // buscar, y eso no es obvio: la lista que Elias usa es MiEspacio, que filtra
    //     source_type = 'dashboard'  AND  owner_user_id = <su app_user>
    // no por area. Un renglon con cualquier otro source_type se guarda bien y
    // no aparece en ningun lado — el peor resultado posible para un atajo, que
    // te avisa "listo" y no deja rastro.
    //
    // Ademas source_type tiene un CHECK: solo manual | email | meeting |
    // project | dashboard. 'atajo' revienta el insert. El origen se marca con
    // el tag y en source_meta, que es lo que si se puede leer despues.
    //
    // Y el dueño es el USUARIO (app_users.id), no su ficha de empleado:
    // created_by cuelga de employees y no todos tienen una.
    const prio = PRIORIDAD[s(cuerpo.prioridad).toLowerCase()] ?? (Number(cuerpo.priority) || 2)
    const { error } = await supabase.from('action_items').insert({
      title: texto,
      description: s(cuerpo.nota) || s(cuerpo.description) || null,
      status: 'pendiente',
      due_date: fecha,
      due_time: hora,
      priority: Math.min(Math.max(prio, 1), 3),
      area: s(cuerpo.area) || cuenta.permission_area,
      owner_user_id: cuenta.id,
      source_type: 'dashboard',
      tags: ['atajo'],
      source_meta: { origen: 'shortcut', dispositivo: s(cuerpo.dispositivo) || null },
    })
    if (error) throw error
    return json({
      ok: true,
      mensaje: `Pendiente guardado: ${texto}` + (fecha ? ` — para el ${fecha}${hora ? ' ' + hora.slice(0, 5) : ''}` : ' (sin fecha)'),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[atajos]', msg)
    // Mensaje legible: la notificacion del atajo es lo unico que Elias ve.
    return json({ ok: false, mensaje: 'No se pudo guardar: ' + msg }, 500)
  }
})
