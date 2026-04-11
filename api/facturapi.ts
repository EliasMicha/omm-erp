// Vercel Serverless Function: proxy seguro a FacturAPI
// Las keys viven solo en variables de entorno de Vercel (FACTURAPI_KEY = live, FACTURAPI_KEY_TEST = test)
// Endpoint: /api/facturapi?action=...&mode=test|live

const FACTURAPI_BASE = 'https://www.facturapi.io/v2'

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
  // CORS para llamadas desde el frontend
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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
      let path = `/invoices?limit=${limit}&page=${page}`
      if (q) path += `&q=${encodeURIComponent(q.toString())}`
      if (issuer_type) path += `&issuer_type=${issuer_type}`
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
