// "¿Olvidaste tu contraseña?" del ERP (2026-11-11).
//
// Por qué no usamos resetPasswordForEmail de Supabase: el proyecto no tiene SMTP
// propio y el correo integrado de Supabase sólo entrega a los miembros del
// equipo de Supabase, no a los empleados. Así que:
//   1. generamos la liga de recuperación con la llave de servicio
//      (auth.admin.generateLink type 'recovery' → hashed_token);
//   2. armamos NUESTRA liga: /restablecer?token_hash=…&type=recovery
//      (la pantalla hace verifyOtp y luego updateUser);
//   3. la mandamos por el Gmail conectado al ERP (elias@omniious.com) vía
//      /api/gmail?action=send.
//
// ⚠️ /api pide sesión y la llave de servicio de AQUÍ no es la que Vercel tiene
// en SUPABASE_SERVICE_ROLE_KEY: x-omm-internal contesta 401 (comprobado
// 2026-11-11). Así que la llamada va con un JWT de la MISMA persona que pidió
// la recuperación (magiclink + verifyOtp, igual que whatsapp-webhook/sesion.ts),
// y esa sesión se cierra (scope local) en cuanto sale el correo. Va ANTES de
// generar la liga de recuperación: en GoTrue el magiclink de un usuario ya
// confirmado reusa recovery_token, y al revés pisaría la liga que mandamos.
//
// verify_jwt = false: quien olvidó su contraseña no tiene sesión. Por eso:
//   * la respuesta es SIEMPRE la misma (no revela qué correos existen);
//   * freno: 1 correo por dirección cada 3 min, 5 por hora; 15 solicitudes por IP por hora;
//   * todo queda en public.recuperacion_acceso con el motivo real.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SITE = 'https://omm-erp.vercel.app'
const URL_SB = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const MENSAJE = 'Si el correo está dado de alta en el ERP, en unos minutos te llega una liga para crear una contraseña nueva. Revisa también la carpeta de spam.'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405)

  let body: any = {}
  try { body = await req.json() } catch { /* vacío */ }
  const email = String(body?.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return json({ ok: false, error: 'Escribe un correo válido.' }, 400)
  }
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null

  const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  const anotar = (resultado: string, detalle?: string) =>
    admin.from('recuperacion_acceso').insert({ email, ip, resultado, detalle: detalle || null })

  try {
    // ── Freno ───────────────────────────────────────────────────────────────
    const hace3 = new Date(Date.now() - 3 * 60_000).toISOString()
    const hace60 = new Date(Date.now() - 60 * 60_000).toISOString()
    const [{ count: c3 }, { count: c60 }, { count: cIp }] = await Promise.all([
      admin.from('recuperacion_acceso').select('id', { count: 'exact', head: true }).eq('email', email).eq('resultado', 'enviado').gte('created_at', hace3),
      admin.from('recuperacion_acceso').select('id', { count: 'exact', head: true }).eq('email', email).eq('resultado', 'enviado').gte('created_at', hace60),
      ip ? admin.from('recuperacion_acceso').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', hace60) : Promise.resolve({ count: 0 } as any),
    ])
    if ((c3 || 0) >= 1 || (c60 || 0) >= 5 || (cIp || 0) >= 15) {
      await anotar('frenado', `3min=${c3} 1h=${c60} ip1h=${cIp}`)
      return json({ ok: true, mensaje: MENSAJE })
    }

    // ── ¿Es usuario del ERP? ────────────────────────────────────────────────
    const { data: au } = await admin.from('app_users')
      .select('id, nombre, activo, auth_user_id, es_bot, acceso_ui')
      .eq('email', email).maybeSingle()   // app_users guarda los correos en minúsculas (verificado); eq evita que _ o % actúen de comodín
    if (!au) { await anotar('no_registrado'); return json({ ok: true, mensaje: MENSAJE }) }
    if (!au.activo || (au.es_bot && !au.acceso_ui)) { await anotar('inactivo'); return json({ ok: true, mensaje: MENSAJE }) }
    if (!au.auth_user_id) {
      // Nunca ha entrado: no hay contraseña que recuperar. Su primer ingreso la crea.
      await anotar('sin_acceso', 'primer ingreso pendiente')
      return json({ ok: true, mensaje: MENSAJE })   // misma respuesta: no se revela si existe
    }

    // ── Sesión de la persona, sólo para poder llamar a /api/gmail ──────────
    const { data: ml, error: eMl } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (eMl || !ml?.properties?.hashed_token) {
      await anotar('error', 'magiclink: ' + (eMl?.message || 'sin token'))
      return json({ ok: true, mensaje: MENSAJE })
    }
    const anonClient = createClient(URL_SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: ses, error: eSes } = await anonClient.auth.verifyOtp({ type: 'magiclink', token_hash: ml.properties.hashed_token })
    const jwt = ses?.session?.access_token
    if (eSes || !jwt) {
      await anotar('error', 'verifyOtp: ' + (eSes?.message || 'sin sesión'))
      return json({ ok: true, mensaje: MENSAJE })
    }
    const cerrar = () => anonClient.auth.signOut({ scope: 'local' }).catch(() => {})

    // ── Liga de recuperación ────────────────────────────────────────────────
    const { data: link, error: eLink } = await admin.auth.admin.generateLink({ type: 'recovery', email })
    const hashed = link?.properties?.hashed_token
    if (eLink || !hashed) {
      await cerrar()
      await anotar('error', 'generateLink: ' + (eLink?.message || 'sin token'))
      return json({ ok: true, mensaje: MENSAJE })
    }
    const liga = `${SITE}/restablecer?token_hash=${encodeURIComponent(hashed)}&type=recovery`
    const nombre = String(au.nombre || '').trim().split(/\s+/)[0] || ''

    const texto = [
      `Hola${nombre ? ' ' + nombre : ''}:`,
      '',
      'Alguien (ojalá tú) pidió crear una contraseña nueva para tu cuenta del ERP de OMM.',
      '',
      'Abre esta liga para elegirla:',
      liga,
      '',
      'La liga sirve una sola vez y vence en una hora.',
      'Si no lo pediste tú, ignora este correo: tu contraseña actual sigue igual.',
      '',
      'OMM Technologies',
    ].join('\n')

    const r = await fetch(`${SITE}/api/gmail?action=send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ to: email, subject: 'Tu contraseña del ERP de OMM', body: texto }),
    })
    const j: any = await r.json().catch(() => ({}))
    await cerrar()
    if (!r.ok || !j?.ok) {
      await anotar('error', `gmail ${r.status}: ${String(j?.error || '').slice(0, 300)}`)
      return json({ ok: true, mensaje: MENSAJE })
    }
    await anotar('enviado', j.messageId || null)
    return json({ ok: true, mensaje: MENSAJE })
  } catch (e) {
    await anotar('error', String((e as Error)?.message || e).slice(0, 300))
    return json({ ok: true, mensaje: MENSAJE })
  }
})
