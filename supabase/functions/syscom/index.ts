// ═══════════════════════════════════════════════════════════════════════════
//  syscom — puente del ERP a la API de Syscom (developers.syscom.mx)
//
//  Secrets (Supabase → Edge Functions → Secrets): SYSCOM_API_KEY (= client_id)
//  y SYSCOM_API_SECRET (= client_secret). Nunca van al navegador.
//
//  Token: OAuth2 client_credentials, dura 365 días. Se guarda en
//  public.syscom_token (RLS sin políticas: solo esta función con service_role)
//  y se renueva solo si vence o si Syscom contesta 401.
//
//  Quién puede llamar: solo usuarios con sesión del ERP (se valida el JWT del
//  usuario; la anon key sola no basta). Excepción: 'ping', que no expone nada.
//
//  POST { accion, ... }
//    ping                         → prueba token + tipo de cambio
//    buscar  { q, pagina?, moneda?, limite?, stock?, financiero? } → productos
//    producto { ids: "id1,id2" , moneda?, financiero? }            → detalle
//
//  financiero (default true): aplica el descuento financiero de la cuenta OMM
//  (pago de contado/transferencia). Con él, precio_descuento = lo que muestra
//  syscom.mx con sesión (UDM-PRO: 490.70 USD + IVA; sin él, 511.14). Precios
//  siempre SIN IVA.
//    tipocambio                                        → TC de Syscom
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2'

const BASE = 'https://developers.syscom.mx/api/v1'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

let tokenMemoria: { valor: string; vence: number } | null = null

// Así quedaron guardados en Supabase: SYSCOM_API_KEY = client_id de Syscom,
// SYSCOM_API_SECRET = client_secret. Se aceptan también los nombres CLIENT_*.
function credenciales(): { id: string | undefined; secret: string | undefined } {
  return {
    id: Deno.env.get('SYSCOM_API_KEY') || Deno.env.get('SYSCOM_CLIENT_ID'),
    secret: Deno.env.get('SYSCOM_API_SECRET') || Deno.env.get('SYSCOM_CLIENT_SECRET'),
  }
}

async function pedirTokenNuevo(): Promise<string> {
  const { id, secret } = credenciales()
  if (!id || !secret) throw new Error('Faltan los secrets SYSCOM_API_KEY / SYSCOM_API_SECRET en Supabase')
  const r = await fetch(BASE + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error('Syscom rechazó las credenciales (HTTP ' + r.status + '): ' + t.slice(0, 200))
  const d = JSON.parse(t)
  const vence = Date.now() + (Number(d.expires_in) || 86400) * 1000
  tokenMemoria = { valor: d.access_token, vence }
  await admin.from('syscom_token').upsert({ id: 1, access_token: d.access_token, expires_at: new Date(vence).toISOString(), updated_at: new Date().toISOString() })
  return d.access_token
}

async function obtenerToken(): Promise<string> {
  const margen = 24 * 3600 * 1000 // se renueva un día antes de vencer
  if (tokenMemoria && tokenMemoria.vence - margen > Date.now()) return tokenMemoria.valor
  const { data } = await admin.from('syscom_token').select('access_token, expires_at').eq('id', 1).maybeSingle()
  if (data && new Date(data.expires_at).getTime() - margen > Date.now()) {
    tokenMemoria = { valor: data.access_token, vence: new Date(data.expires_at).getTime() }
    return data.access_token
  }
  return await pedirTokenNuevo()
}

async function syscomGet(ruta: string, params: Record<string, string | number | undefined>): Promise<any> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const url = BASE + ruta + (qs.toString() ? '?' + qs.toString() : '')
  let tk = await obtenerToken()
  let r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk, Accept: 'application/json' } })
  if (r.status === 401) { tk = await pedirTokenNuevo(); r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk, Accept: 'application/json' } }) }
  const t = await r.text()
  if (!r.ok) throw new Error('Syscom ' + ruta + ' → HTTP ' + r.status + ': ' + t.slice(0, 300))
  try { return JSON.parse(t) } catch { return t }
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

// Producto en formato compacto para el ERP.
function compacto(p: any, moneda: string) {
  const pr = p && typeof p.precios === 'object' && !Array.isArray(p.precios) ? p.precios : {}
  return {
    id: String(p.producto_id ?? p.id ?? ''),
    modelo: p.modelo || '',
    marca: p.marca || '',
    titulo: p.titulo || '',
    imagen: p.img_portada || null,
    link: p.link ? 'https://www.syscom.mx' + (String(p.link).startsWith('/') ? '' : '/') + p.link : null,
    existencia: num(p.total_existencia),
    moneda: moneda.toUpperCase(),
    precio_lista: num(pr.precio_lista),
    precio_especial: num(pr.precio_especial),
    precio_map: num(pr.precio_map),             // precio mínimo anunciado
    precio_descuento: num(pr.precio_descuento), // COSTO OMM: precio con descuento de la cuenta (+ financiero), sin IVA
    precio_1: num(pr.precio_1),
    sin_precio: Array.isArray(p.precios) && p.precios.length === 0 ? (p.nota || 'Sin precio para esta cuenta') : null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Usa POST' }, 405)

  let body: any = {}
  try { body = await req.json() } catch { /* sin cuerpo */ }
  const accion = String(body.accion || 'ping')

  // Solo usuarios con sesión del ERP. 'ping' (estado del token + tipo de
  // cambio, nada sensible) queda abierto para diagnosticar sin sesión.
  if (accion !== 'ping') {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: u, error: eu } = await admin.auth.getUser(jwt)
    if (eu || !u?.user) return json({ error: 'Sesión requerida' }, 401)
  }
  const moneda = body.moneda === 'mxn' ? 'mxn' : 'usd'
  const financiero = body.financiero === false ? undefined : 1

  try {
    if (accion === 'ping') {
      await obtenerToken()
      let tc: unknown = null
      try { tc = await syscomGet('/tipocambio', {}) } catch (e) { tc = { error: String((e as Error).message) } }
      return json({ ok: true, token: 'vigente', tipocambio: tc })
    }
    if (accion === 'tipocambio') {
      return json({ ok: true, tipocambio: await syscomGet('/tipocambio', {}) })
    }
    if (accion === 'buscar') {
      const q = String(body.q || '').trim().slice(0, 120)
      if (q.length < 2) return json({ error: 'Escribe al menos 2 letras para buscar' }, 400)
      const d = await syscomGet('/productos', {
        busqueda: q, pagina: Number(body.pagina) || 1, limit: Math.min(Number(body.limite) || 30, 60),
        moneda, stock: body.stock ? 1 : undefined, financiero,
      })
      const lista = Array.isArray(d?.productos) ? d.productos : []
      return json({ ok: true, total: d?.cantidad ?? lista.length, paginas: d?.paginas ?? 1, productos: lista.map((p: any) => compacto(p, moneda)) })
    }
    if (accion === 'producto') {
      const ids = String(body.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 300).join(',')
      if (!ids) return json({ error: 'Falta ids' }, 400)
      const d = await syscomGet('/productos/' + ids, { moneda, financiero })
      const lista = Array.isArray(d) ? d : [d]
      return json({ ok: true, productos: lista.filter(Boolean).map((p: any) => compacto(p, moneda)) })
    }
    return json({ error: 'Acción desconocida: ' + accion }, 400)
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 502)
  }
})
