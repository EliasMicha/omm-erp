// Vercel Serverless Function: proxy a FacturAPI
// Las keys viven solo en variables de entorno de Vercel (FACTURAPI_KEY = live, FACTURAPI_KEY_TEST = test)
// Endpoint: /api/facturapi?action=...&mode=test|live
//
// ─── QUIEN PUEDE LLAMAR ──────────────────────────────────────────────────────
//
// Esto corre en Vercel, fuera de Supabase: ninguna politica de RLS lo cubre.
// Durante un tiempo no autentico a NADIE y respondia a internet con
// Access-Control-Allow-Origin:*, asi que cualquiera que conociera la URL podia
// timbrar o cancelar un CFDI contra el RFC de OMM. Las llaves nunca se filtran
// —ese es el punto del proxy— pero tampoco hacen falta: el proxy las pone.
//
// Ahora toda accion exige la sesion real del ERP (ver api/_sesion.ts), y las que
// mueven documentos fiscales exigen ademas DG o Administracion, que es la misma
// regla que RLS ya aplica sobre la tabla `facturas`.
//
// ⚠️ PENDIENTE declarado: download_pdf y download_xml siguen sin exigir sesion.
// No es un olvido — hoy se usan desde <a href> y window.open, que no pueden
// mandar un header, y hay URLs de descarga guardadas en la base
// (facturas.pdf_url / xml_url). Cerrarlas sin romper esos enlaces necesita un
// ticket de descarga firmado y de vida corta. Mientras tanto: quien adivine un
// facturapi_id puede BAJAR ese documento, pero nadie puede emitir ni cancelar.
// Esa era la parte que de verdad quemaba.

import { sesionDelErp, puedeOperarFiscal } from './_sesion'

const FACTURAPI_BASE = 'https://www.facturapi.io/v2'

/** Acciones que comprometen el RFC de OMM ante el SAT o tocan la identidad
 *  fiscal del cliente. Exigen persona (no bot) de DG o Administracion. */
const ACCIONES_FISCALES = new Set([
  'create_invoice',
  'cancel_invoice',
  'create_customer',
  'update_customer',
])

/** Lo unico que sigue abierto, y por que, esta explicado arriba. */
const ACCIONES_SIN_SESION = new Set(['download_pdf', 'download_xml'])

/** El ERP se sirve desde estos origenes. El front llama en el mismo origen, asi
 *  que esto casi nunca aplica; aun asi no hay razon para contestarle a todos.
 *  Ojo: CORS no protege contra un curl, solo contra otra pagina web. Lo que
 *  protege de verdad es la sesion. */
const ORIGENES = [
  'https://omm-erp.vercel.app',
  'https://omm-erp-eliasmichas-projects.vercel.app',
  'https://omm-erp-git-main-eliasmichas-projects.vercel.app',
  'http://localhost:5173',
]

function getKey(mode: string): string {
  const envName = mode === 'live' ? 'FACTURAPI_KEY' : 'FACTURAPI_KEY_TEST'
  const key = (process.env as any)[envName]
  if (!key) throw new Error(envName + ' no esta configurada en Vercel env vars')
  return key
}

function authHeader(mode: string): string {
  const key = getKey(mode)
  return 'Basic ' + Buffer.from(key + ':').toString('base64')
}

function detectLiveMode(mode: string): boolean {
  // Detectar por prefijo de la key, no por lo que diga el caller
  try {
    const key = getKey(mode)
    return key.startsWith('sk_live_')
  } catch {
    return false
  }
}

async function facturapi(method: string, path: string, mode: string, body?: any) {
  const headers: Record<string, string> = {
    'Authorization': authHeader(mode),
    'Content-Type': 'application/json',
  }
  const res = await fetch(`${FACTURAPI_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, data }
}

export default async function handler(req: any, res: any) {
  const origen = String(req.headers?.origin || '')
  if (ORIGENES.includes(origen)) {
    res.setHeader('Access-Control-Allow-Origin', origen)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  try {
    const action = (req.query.action || req.body?.action || '').toString()
    // Mode: test (default, mas seguro) o live
    const mode = (req.query.mode || req.body?.mode || 'test').toString()
    if (mode !== 'test' && mode !== 'live') {
      res.status(400).json({ error: 'mode must be test or live' })
      return
    }

    // ── Quien llama ──────────────────────────────────────────────────────────
    // Antes del switch: una accion nueva nace cerrada, no abierta. Si manana
    // alguien agrega 'borrar_todo' y olvida protegerlo, ya esta protegido.
    if (!ACCIONES_SIN_SESION.has(action)) {
      const sesion = await sesionDelErp(req)
      if (!sesion) {
        res.status(401).json({ error: 'Sesion del ERP requerida' })
        return
      }
      if (ACCIONES_FISCALES.has(action) && !puedeOperarFiscal(sesion)) {
        // No se dice que area tiene ni cual se necesita: eso le ensena a quien
        // toca la puerta por donde seguir tocando.
        res.status(403).json({ error: 'No tienes permiso para esta operacion fiscal' })
        return
      }
      // Queda en el log de Vercel quien timbro o cancelo, con que modo. No es
      // una auditoria de verdad —esa va en la base— pero hoy no habia ninguna.
      if (ACCIONES_FISCALES.has(action)) {
        console.log(`[facturapi] ${action} mode=${mode} por ${sesion.email} (${sesion.permissionArea})`)
      }
    }

    // ============================================================
    // GET_CONFIG: devuelve que keys estan disponibles
    // ============================================================
    if (action === 'get_config') {
      const hasLive = !!(process.env as any).FACTURAPI_KEY
      const hasTest = !!(process.env as any).FACTURAPI_KEY_TEST
      res.status(200).json({
        hasLive,
        hasTest,
        defaultMode: hasTest ? 'test' : (hasLive ? 'live' : null),
      })
      return
    }

    // ============================================================
    // PING: verificar que la key funciona
    // ============================================================
    if (action === 'ping') {
      const r = await facturapi('GET', '/customers?limit=1', mode)
      const livemode = detectLiveMode(mode)
      res.status(200).json({
        ok: r.ok,
        status: r.status,
        mode,
        livemode,
        message: r.ok ? ('FacturAPI conectado en modo ' + (livemode ? 'LIVE' : 'TEST')) : 'Error de conexion',
      })
      return
    }

    // ============================================================
    // CUSTOMERS: listar / crear / obtener
    // ============================================================
    if (action === 'list_customers') {
      const limit = req.query.limit || 50
      const r = await facturapi('GET', `/customers?limit=${limit}`, mode)
      res.status(r.status).json(r.data)
      return
    }

    if (action === 'create_customer') {
      const r = await facturapi('POST', '/customers', mode, req.body.payload)
      res.status(r.status).json(r.data)
      return
    }

    // Actualiza los datos fiscales del cliente en FacturAPI.
    // Crítico: al timbrar se manda solo el ID del customer, así que FacturAPI
    // sella con SU copia. Si el ERP cambia el régimen y no se sincroniza aquí,
    // el CFDI sale con el régimen viejo.
    if (action === 'update_customer') {
      const id = req.query.id || req.body?.id
      if (!id) { res.status(400).json({ error: 'id required' }); return }
      const r = await facturapi('PUT', `/customers/${id}`, mode, req.body.payload)
      res.status(r.status).json(r.data)
      return
    }

    if (action === 'get_customer') {
      const id = req.query.id
      if (!id) { res.status(400).json({ error: 'id required' }); return }
      const r = await facturapi('GET', `/customers/${id}`, mode)
      res.status(r.status).json(r.data)
      return
    }

    // ============================================================
    // INVOICES: emitir / listar / obtener / cancelar / descargar
    // ============================================================
    if (action === 'list_invoices') {
      const limit = req.query.limit || 50
      const page = req.query.page || 1
      const q = req.query.q || ''
      const issuer_type = req.query.issuer_type || ''
      const date_gte = req.query.date_gte || ''
      const date_lte = req.query.date_lte || ''
      let path = `/invoices?limit=${limit}&page=${page}`
      if (q) path += `&q=${encodeURIComponent(q.toString())}`
      if (issuer_type) path += `&issuer_type=${issuer_type}`
      if (date_gte) path += `&date%5Bgte%5D=${encodeURIComponent(date_gte.toString())}`
      if (date_lte) path += `&date%5Blte%5D=${encodeURIComponent(date_lte.toString())}`
      const r = await facturapi('GET', path, mode)
      res.status(r.status).json(r.data)
      return
    }

    if (action === 'create_invoice') {
      const r = await facturapi('POST', '/invoices', mode, req.body.payload)
      const livemode = detectLiveMode(mode)
      // Agregar livemode al response para que el UI sepa que paso
      res.status(r.status).json({ ...r.data, _livemode: livemode, _mode: mode })
      return
    }

    if (action === 'get_invoice') {
      const id = req.query.id
      if (!id) { res.status(400).json({ error: 'id required' }); return }
      const r = await facturapi('GET', `/invoices/${id}`, mode)
      res.status(r.status).json(r.data)
      return
    }

    if (action === 'cancel_invoice') {
      const id = req.body.id
      const motive = req.body.motive || '02' // 02 = comprobante emitido con errores sin relacion
      const substitution = req.body.substitution
      let path = `/invoices/${id}?motive=${motive}`
      if (substitution) path += `&substitution=${substitution}`
      const r = await facturapi('DELETE', path, mode)
      res.status(r.status).json(r.data)
      return
    }

    // Descargar XML o PDF (proxy binario)
    if (action === 'download_xml' || action === 'download_pdf') {
      const id = req.query.id
      if (!id) { res.status(400).json({ error: 'id required' }); return }
      const ext = action === 'download_xml' ? 'xml' : 'pdf'
      const r = await fetch(`${FACTURAPI_BASE}/invoices/${id}/${ext}`, {
        headers: { 'Authorization': authHeader(mode) },
      })
      if (!r.ok) {
        res.status(r.status).json({ error: 'Failed to download' })
        return
      }
      const buf = Buffer.from(await r.arrayBuffer())
      res.setHeader('Content-Type', ext === 'xml' ? 'application/xml' : 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="factura-${id}.${ext}"`)
      res.status(200).send(buf)
      return
    }

    // ============================================================
    // CATALOGS SAT: regimenes, usos cfdi, claves prod serv
    // ============================================================
    if (action === 'sat_keys') {
      const type = req.query.type || 'product_keys'
      const q = req.query.q || ''
      const r = await facturapi('GET', `/catalogs/${type}?q=${encodeURIComponent(q.toString())}`, mode)
      res.status(r.status).json(r.data)
      return
    }

    res.status(400).json({ error: 'Unknown action: ' + action })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Server error' })
  }
}
