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
//
//  Precios del catálogo contra Syscom (2026-11-14) — tabla syscom_precios:
//    sincronizar { desde?, catalog_ids? } → revisa los productos de Syscom del
//        catálogo. Con syscom_id ya ligado, en lotes por /productos/{ids}; sin
//        él, buscando por modelo (y sku) y ligando SOLO si el modelo coincide
//        exacto (sin espacios ni guiones; "-US" al final no cuenta). Nunca toca
//        el catálogo: deja 'distinto' para que alguien lo apruebe en Catálogo.
//        Corta a los ~110 s y devuelve cuántos faltan; se vuelve a llamar.
//        Lo que falla (p. ej. 429) queda 'error' SIN fecha de revisión, así que
//        la siguiente vuelta lo vuelve a intentar.
//        La llama el cron (x-cron-key) o un usuario con sesión ("Revisar ahora").
//    ligar { catalog_product_id, syscom_id } → liga a mano y revisa ese producto.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2'

const BASE = 'https://developers.syscom.mx/api/v1'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SYSCOM_SUPPLIER = '41cbd392-d599-44f0-b164-45b5ba1d52ba' // SISTEMAS Y SERVICIOS DE COMUNICACION

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

// Syscom limita las peticiones (HTTP 429 "Demasiadas solicitudes", con
// Retry-After). La primera revisión del catálogo pidió ~600 seguidas y 404
// rebotaron. Por eso todas las llamadas pasan por un turno con separación
// mínima, y un 429 espera lo que diga Retry-After, abre la separación y
// reintenta (hasta 3 veces).
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))
let separacion = 400
let siguienteTurno = 0
async function turno() {
  const ahora = Date.now()
  const espera = Math.max(0, siguienteTurno - ahora)
  siguienteTurno = Math.max(ahora, siguienteTurno) + separacion
  if (espera) await dormir(espera)
}

async function syscomGet(ruta: string, params: Record<string, string | number | undefined>): Promise<any> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const url = BASE + ruta + (qs.toString() ? '?' + qs.toString() : '')
  let tk = await obtenerToken()
  let r: Response | null = null
  for (let intento = 0; intento < 4; intento++) {
    await turno()
    r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk, Accept: 'application/json' } })
    if (r.status === 401 && intento === 0) { tk = await pedirTokenNuevo(); continue }
    if (r.status !== 429 || intento === 3) break
    separacion = Math.min(separacion * 2, 3000)
    const ra = Number(r.headers.get('Retry-After')) || 5
    await r.text().catch(() => '')
    await dormir(Math.min(ra, 20) * 1000)
  }
  if (!r) throw new Error('Syscom no contestó')
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

// ── Precios del catálogo contra Syscom ─────────────────────────────────────
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[\s\-_.\/]/g, '')
// "U7-PRO-OUTDOOR-US" (catálogo) = "U7-PRO-OUTDOOR" (Syscom): el sufijo de
// región no distingue producto. Sólo cuenta si va separado ("-US", " US").
const sinRegion = (s: unknown) => norm(String(s ?? '').trim().replace(/[\s\-_]US$/i, ''))
const claveIgual = (a: unknown, b: unknown) => {
  const na = norm(a), nb = norm(b)
  return !!na && !!nb && (na === nb || sinRegion(a) === sinRegion(b))
}

async function tipoCambio(): Promise<number | null> {
  try {
    const d = await syscomGet('/tipocambio', {})
    return num(d?.normal) ?? num(d?.preferencial) ?? num(d?.un_dia) ?? null
  } catch { return null }
}

const COLS = ['catalog_product_id', 'syscom_id', 'modelo_syscom', 'marca', 'titulo', 'imagen', 'link', 'precio_usd',
  'precio_especial', 'existencia', 'tc_syscom', 'costo_catalogo', 'moneda_catalogo', 'precio_comparable', 'estado',
  'candidatos', 'ignorado_precio', 'decision', 'decision_at', 'decision_por', 'error', 'consultado_at']

interface ProdCat { id: string; name: string; modelo: string | null; sku: string | null; cost: number | null; moneda: string | null }

// Compara y arma la fila de syscom_precios. No escribe el catálogo nunca.
function evaluar(pc: ProdCat, sp: ReturnType<typeof compacto>, tc: number | null, previa: any) {
  const monedaCat = (pc.moneda || 'USD').toUpperCase() === 'MXN' ? 'MXN' : 'USD'
  const precio = sp.precio_descuento
  const base = {
    catalog_product_id: pc.id, syscom_id: sp.id, modelo_syscom: sp.modelo, marca: sp.marca, titulo: sp.titulo,
    imagen: sp.imagen, link: sp.link, precio_usd: precio, precio_especial: sp.precio_especial,
    existencia: sp.existencia, tc_syscom: tc, costo_catalogo: pc.cost, moneda_catalogo: monedaCat,
    candidatos: null, error: null, consultado_at: new Date().toISOString(),
  }
  if (precio == null || sp.sin_precio) return { ...base, precio_comparable: null, estado: 'sin_precio' }
  if (monedaCat === 'MXN' && !tc) return { ...base, precio_comparable: null, estado: 'error', error: 'Sin tipo de cambio de Syscom para comparar contra un costo en pesos' }
  const comparable = Math.round((monedaCat === 'MXN' ? precio * (tc as number) : precio) * 100) / 100
  const costo = Number(pc.cost) || 0
  const igual = costo > 0 && Math.abs(comparable - costo) <= Math.max(0.01, costo * 0.005)
  let estado = igual ? 'igual' : 'distinto'
  if (!igual && previa?.ignorado_precio != null && Math.abs(Number(previa.ignorado_precio) - precio) < 0.005) estado = 'ignorado'
  return { ...base, precio_comparable: comparable, estado }
}

// Busca un producto del catálogo en Syscom por modelo / sku.
async function buscarEnSyscom(pc: ProdCat) {
  const claves = [pc.modelo, pc.sku].filter((v) => norm(v))
  const terminos: string[] = []
  for (const c of claves) {
    const t = String(c).trim()
    if (!terminos.some((x) => norm(x) === norm(t))) terminos.push(t)
    const sr = t.replace(/[\s\-_]US$/i, '')
    if (sr !== t && !terminos.some((x) => norm(x) === norm(sr))) terminos.push(sr)
  }
  let primeros: any[] = []
  for (const t of terminos) {
    const d = await syscomGet('/productos', { busqueda: t, limit: 10, moneda: 'usd', financiero: 1 })
    const lista = (Array.isArray(d?.productos) ? d.productos : []).map((p: any) => compacto(p, 'usd'))
    if (!primeros.length) primeros = lista
    const exactos = lista.filter((sp: any) => claves.some((k) => claveIgual(sp.modelo, k)))
    const ids = [...new Set(exactos.map((x: any) => x.id))]
    if (ids.length === 1) return { tipo: 'ok' as const, sp: exactos[0] }
    if (ids.length > 1) return { tipo: 'ambiguo' as const, candidatos: exactos.slice(0, 6) }
  }
  return { tipo: 'no_encontrado' as const, candidatos: primeros.slice(0, 6) }
}

async function enParalelo<T>(items: T[], n: number, limite: number, fn: (x: T) => Promise<void>): Promise<number> {
  let i = 0, hechos = 0
  const t0 = Date.now()
  const trabajador = async () => {
    while (i < items.length && Date.now() - t0 < limite) {
      const x = items[i++]
      await fn(x)
      hechos++
    }
  }
  await Promise.all(Array.from({ length: n }, trabajador))
  return hechos
}

async function sincronizar(opc: { desde?: string; catalogIds?: string[] }) {
  const t0 = Date.now()
  const LIMITE = 110_000
  let q = admin.from('catalog_products').select('id, name, modelo, sku, cost, moneda, is_active')
    .or(`supplier_id.eq.${SYSCOM_SUPPLIER},provider.ilike."SISTEMAS Y SERVICIOS DE COMUNICACION%"`)
  if (opc.catalogIds?.length) q = q.in('id', opc.catalogIds)
  const { data: prods, error: ep } = await q.limit(5000)
  if (ep) throw new Error('catalog_products: ' + ep.message)
  const activos = (prods || []).filter((p: any) => p.is_active !== false && (norm(p.modelo) || norm(p.sku))) as ProdCat[]
  const ids = activos.map((p) => p.id)
  const previas = new Map<string, any>()
  for (let k = 0; k < ids.length; k += 300) {
    const { data } = await admin.from('syscom_precios').select('*').in('catalog_product_id', ids.slice(k, k + 300))
    for (const r of data || []) previas.set(r.catalog_product_id, r)
  }
  const corte = opc.catalogIds?.length ? Infinity : new Date(opc.desde || Date.now() - 20 * 3600 * 1000).getTime()
  const toca = activos.filter((p) => {
    const r = previas.get(p.id)
    return !r?.consultado_at || new Date(r.consultado_at).getTime() < corte
  })
  const tc = await tipoCambio()
  const filas: any[] = []
  const hechos = new Set<string>()
  const guardar = async (force = false) => {
    if (!filas.length || (!force && filas.length < 40)) return
    // Todas las filas con las MISMAS columnas: en un upsert por lote, una
    // columna que falta en una fila se escribiría NULL (y borraría, p. ej.,
    // el precio ignorado). Lo que la fila no trae se toma de la previa.
    const lote = filas.splice(0, filas.length).map((f) => {
      if (f.estado !== 'error') hechos.add(f.catalog_product_id) // el error se reintenta en la siguiente vuelta
      const prev = previas.get(f.catalog_product_id) || {}
      const o: Record<string, unknown> = {}
      for (const c of COLS) o[c] = f[c] !== undefined ? f[c] : (prev[c] ?? null)
      return o
    })
    const { error } = await admin.from('syscom_precios').upsert(lote, { onConflict: 'catalog_product_id' })
    if (error) throw new Error('syscom_precios: ' + error.message)
  }

  // A) ya ligados: por lotes de 50 ids
  const ligados = toca.filter((p) => previas.get(p.id)?.syscom_id)
  const sinLiga: ProdCat[] = toca.filter((p) => !previas.get(p.id)?.syscom_id)
  for (let k = 0; k < ligados.length && Date.now() - t0 < LIMITE; k += 50) {
    const lote = ligados.slice(k, k + 50)
    const idsSys = lote.map((p) => previas.get(p.id).syscom_id)
    let lista: any[] = []
    try {
      const d = await syscomGet('/productos/' + idsSys.join(','), { moneda: 'usd', financiero: 1 })
      lista = (Array.isArray(d) ? d : [d]).filter(Boolean).map((p: any) => compacto(p, 'usd'))
    } catch (e) {
      for (const p of lote) filas.push({ catalog_product_id: p.id, estado: 'error', error: String((e as Error).message).slice(0, 300) })
      continue
    }
    const porId = new Map(lista.map((x) => [x.id, x]))
    for (const p of lote) {
      const sp = porId.get(String(previas.get(p.id).syscom_id))
      if (sp) filas.push(evaluar(p, sp, tc, previas.get(p.id)))
      else sinLiga.push(p) // Syscom ya no lo tiene con ese id: se vuelve a buscar
    }
    await guardar()
  }

  // B) sin liga: buscar por modelo
  await enParalelo(sinLiga, 4, LIMITE - (Date.now() - t0), async (p) => {
    try {
      const r = await buscarEnSyscom(p)
      if (r.tipo === 'ok') filas.push(evaluar(p, r.sp, tc, previas.get(p.id)))
      else filas.push({
        catalog_product_id: p.id, syscom_id: null, estado: r.tipo, candidatos: r.candidatos,
        costo_catalogo: p.cost, moneda_catalogo: (p.moneda || 'USD').toUpperCase(), tc_syscom: tc,
        precio_usd: null, precio_comparable: null, existencia: null, error: null,
        consultado_at: new Date().toISOString(),
      })
    } catch (e) {
      filas.push({ catalog_product_id: p.id, estado: 'error', error: String((e as Error).message).slice(0, 300) })
    }
    await guardar()
  })
  await guardar(true)

  // Lo que faltó por tiempo se toma en la siguiente llamada.
  return { productos: activos.length, revisar: toca.length, revisados: hechos.size, pendientes: toca.length - hechos.size, tc, segundos: Math.round((Date.now() - t0) / 1000) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Usa POST' }, 405)

  let body: any = {}
  try { body = await req.json() } catch { /* sin cuerpo */ }
  const accion = String(body.accion || 'ping')

  // Solo usuarios con sesión del ERP. 'ping' (estado del token + tipo de
  // cambio, nada sensible) queda abierto para diagnosticar sin sesión.
  // 'sincronizar' también la puede llamar el cron con su llave (x-cron-key).
  let esCron = false
  const llave = req.headers.get('x-cron-key')
  if (llave && accion === 'sincronizar') {
    const { data: ok } = await admin.rpc('reportes_cron_ok', { p_key: llave })
    esCron = ok === true
    if (!esCron) return json({ error: 'Llave inválida' }, 401)
  }
  if (accion !== 'ping' && !esCron) {
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
    if (accion === 'sincronizar') {
      const catalogIds = Array.isArray(body.catalog_ids) ? body.catalog_ids.map(String).slice(0, 300) : undefined
      return json({ ok: true, ...(await sincronizar({ desde: body.desde ? String(body.desde) : undefined, catalogIds })) })
    }
    if (accion === 'ligar') {
      const cid = String(body.catalog_product_id || ''), sid = String(body.syscom_id || '')
      if (!cid || !sid) return json({ error: 'Falta catalog_product_id o syscom_id' }, 400)
      const { data: pc } = await admin.from('catalog_products').select('id, name, modelo, sku, cost, moneda').eq('id', cid).maybeSingle()
      if (!pc) return json({ error: 'Producto del catálogo no encontrado' }, 404)
      const d = await syscomGet('/productos/' + encodeURIComponent(sid), { moneda: 'usd', financiero: 1 })
      const raw = Array.isArray(d) ? d[0] : d
      if (!raw) return json({ error: 'Syscom no tiene ese producto' }, 404)
      const { data: previa } = await admin.from('syscom_precios').select('*').eq('catalog_product_id', cid).maybeSingle()
      const fila = { ...evaluar(pc as ProdCat, compacto(raw, 'usd'), await tipoCambio(), previa), decision: 'ligado', decision_at: new Date().toISOString() }
      const { error } = await admin.from('syscom_precios').upsert(fila, { onConflict: 'catalog_product_id' })
      if (error) throw new Error(error.message)
      return json({ ok: true, fila })
    }
    return json({ error: 'Acción desconocida: ' + accion }, 400)
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 502)
  }
})
