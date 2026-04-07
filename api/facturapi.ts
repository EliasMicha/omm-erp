// Vercel Serverless Function: proxy seguro a FacturAPI
// El FACTURAPI_KEY vive solo en variables de entorno de Vercel, nunca en el frontend.
// Endpoint: /api/facturapi?action=...

const FACTURAPI_BASE = 'https://www.facturapi.io/v2'

function authHeader() {
  const key = process.env.FACTURAPI_KEY
  if (!key) throw new Error('FACTURAPI_KEY env var not set')
  return 'Basic ' + Buffer.from(key + ':').toString('base64')
}

async function facturapi(method: string, path: string, body?: any) {
  const headers: Record<string, string> = {
    'Authorization': authHeader(),
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

    // ============================================================
    // PING: verificar que la key funciona
    // ============================================================
    if (action === 'ping') {
      const r = await facturapi('GET', '/customers?limit=1')
      res.status(200).json({ ok: r.ok, status: r.status, sandbox: true, message: r.ok ? 'FacturAPI conectado' : 'Error de conexion' })
      return
    }

    // ============================================================
    // CUSTOMERS: listar / crear / obtener
    // ============================================================
    if (action === 'list_customers') {
      const limit = req.query.limit || 50
      const r = await facturapi('GET', `/customers?limit=${limit}`)
      res.status(r.status).json(r.data)
      return
    }

    if (action === 'create_customer' && req.method === 'POST') {
      const r = await facturapi('POST', '/customers', req.body.payload)
      res.status(r.status).json(r.data)
      return
    }

    if (action === 'get_customer') {
      const id = req.query.id
      if (!id) { res.status(400).json({ error: 'id required' }); return }
      const r = await facturapi('GET', `/customers/${id}`)
      res.status(r.status).json(r.data)
      return
    }

    // ============================================================
    // INVOICES: emitir / listar / obtener / cancelar / descargar
    // ============================================================
    if (action === 'list_invoices') {
      const limit = req.query.limit || 50
      const page = req.query.page || 1
      let path = `/invoices?limit=${limit}&page=${page}`
      if (req.query.q) path += `&q=${encodeURIComponent(req.query.q)}`
      if (req.query.customer) path += `&customer=${req.query.customer}`
      const r = await facturapi('GET', path)
      res.status(r.status).json(r.data)
      return
    }

    if (action === 'create_invoice' && req.method === 'POST') {
      const r = await facturapi('POST', '/invoices', req.body.payload)
      res.status(r.status).json(r.data)
      return
    }

    if (action === 'get_invoice') {
      const id = req.query.id
      if (!id) { res.status(400).json({ error: 'id required' }); return }
      const r = await facturapi('GET', `/invoices/${id}`)
      res.status(r.status).json(r.data)
      return
    }

    if (action === 'cancel_invoice' && req.method === 'POST') {
      const id = req.body.id
      const motive = req.body.motive || '02' // 02 = comprobante emitido con errores sin relacion
      const substitution = req.body.substitution
      let path = `/invoices/${id}?motive=${motive}`
      if (substitution) path += `&substitution=${substitution}`
      const r = await facturapi('DELETE', path)
      res.status(r.status).json(r.data)
      return
    }

    // Descargar XML o PDF (proxy binario)
    if (action === 'download_xml' || action === 'download_pdf') {
      const id = req.query.id
      if (!id) { res.status(400).json({ error: 'id required' }); return }
      const ext = action === 'download_xml' ? 'xml' : 'pdf'
      const r = await fetch(`${FACTURAPI_BASE}/invoices/${id}/${ext}`, {
        headers: { 'Authorization': authHeader() }
      })
      if (!r.ok) {
        res.status(r.status).json({ error: 'Failed to download' })
        return
      }
      const buf = Buffer.from(await r.arrayBuffer())
      res.setHeader('Content-Type', ext === 'xml' ? 'application/xml' : 'application/pdf')
      res.setHeader('Content-Disposition', `inline; filename=${id}.${ext}`)
      res.status(200).send(buf)
      return
    }

    // ============================================================
    // CATALOGS SAT: regimenes, usos cfdi, claves prod serv
    // ============================================================
    if (action === 'sat_keys') {
      const type = req.query.type || 'product_keys'
      const q = req.query.q || ''
      const r = await facturapi('GET', `/catalogs/${type}?q=${encodeURIComponent(q)}&limit=20`)
      res.status(r.status).json(r.data)
      return
    }

    res.status(400).json({ error: 'Unknown action: ' + action })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Server error' })
  }
}
