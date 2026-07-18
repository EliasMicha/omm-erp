// Vercel serverless — Endpoint ÚNICO de Belvo (consolidado por el límite de 12
// funciones del plan Hobby de Vercel). Reemplaza a belvo-link.ts + belvo-sync.ts.
//
//   GET/POST /api/belvo?action=link   → crea un LINK de prueba en SANDBOX y lo
//       registra en bank_connections. Overrideable con
//       ?institution=&username=&password=&banco=&cuenta=&moneda=
//       Solo sandbox: los links reales de producción se crean con el Connect
//       Widget de Belvo (con las credenciales reales del banco), no con este helper.
//
//   GET/POST /api/belvo?action=sync&days=30[&token=CRON_SECRET]  (default) → recorre
//       las conexiones activas de bank_connections, trae las transacciones de cada
//       link (últimos N días) y las inserta en bank_movements deduplicando por
//       belvo_transaction_id. Así los movimientos aparecen solos en la Conciliación.
//
// Env: BELVO_SECRET_ID, BELVO_SECRET_PASSWORD, (BELVO_BASE_URL opcional),
//   SUPABASE_URL/ANON_KEY (o VITE_*). Opcional: CRON_SECRET para proteger el sync.

import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const secretId = process.env.BELVO_SECRET_ID
  const secretPassword = process.env.BELVO_SECRET_PASSWORD
  const baseUrl = (process.env.BELVO_BASE_URL || 'https://sandbox.belvo.com').replace(/\/$/, '')
  if (!secretId || !secretPassword) {
    return res.status(500).json({ ok: false, error: 'Faltan BELVO_SECRET_ID / BELVO_SECRET_PASSWORD en las variables de entorno.' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ ok: false, error: 'Supabase env vars no configuradas' })
  const sbHeaders: Record<string, string> = { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }

  const belvoAuth = 'Basic ' + Buffer.from(`${secretId}:${secretPassword}`).toString('base64')
  const action = String((req.query as any).action || 'sync').toLowerCase()

  try {
    if (action === 'institutions') {
      // Lista las instituciones disponibles (útil para saber qué usar en sandbox)
      const r = await fetch(`${baseUrl}/api/institutions/?page_size=100`, { headers: { Authorization: belvoAuth } })
      const d = await r.json().catch(() => null)
      const list = Array.isArray(d?.results) ? d.results : (Array.isArray(d) ? d : [])
      return res.status(r.status).json({ ok: r.ok, count: list.length, institutions: list.map((i: any) => ({ name: i.name, display_name: i.display_name, country: i.country_code || i.country_codes, type: i.type, status: i.status })) })
    }

    if (action === 'link') {
      // ───────── Crear link de prueba en SANDBOX ─────────
      if (!/sandbox/i.test(baseUrl)) {
        return res.status(400).json({ ok: false, error: 'Este helper solo crea links en SANDBOX. Para producción usa el Connect Widget de Belvo con las credenciales reales del banco.' })
      }
      const q = req.query as any
      const institution = String(q.institution || 'erebor_mx_retail')
      const username = String(q.username || 'bnk1006')
      const password = String(q.password || 'supersecret')
      const banco = String(q.banco || 'BBVA (sandbox)')
      const cuenta = String(q.cuenta || 'erebor-test')
      const moneda = String(q.moneda || 'MXN')

      const linkResp = await fetch(`${baseUrl}/api/links/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: belvoAuth },
        body: JSON.stringify({ institution, username, password, access_mode: 'recurrent' }),
      })
      const linkData = await linkResp.json().catch(() => null)
      if (!linkResp.ok) return res.status(linkResp.status).json({ ok: false, error: 'Belvo no pudo crear el link', detail: linkData })
      const linkId = linkData?.id
      if (!linkId) return res.status(500).json({ ok: false, error: 'Belvo no devolvió un link id', detail: linkData })

      const existResp = await fetch(`${supabaseUrl}/rest/v1/bank_connections?link_id=eq.${linkId}&select=id`, { headers: sbHeaders })
      const exist = await existResp.json().catch(() => [])
      if (!Array.isArray(exist) || exist.length === 0) {
        await fetch(`${supabaseUrl}/rest/v1/bank_connections`, {
          method: 'POST',
          headers: { ...sbHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify({ link_id: linkId, institution, banco, cuenta, moneda, activo: true }),
        })
      }
      return res.status(200).json({ ok: true, action: 'link', link_id: linkId, institution, banco, cuenta, moneda, next: '/api/belvo?action=sync&days=90' })
    }

    // ───────── Sync de movimientos (default) ─────────
    // Protección opcional: si CRON_SECRET está configurado, exigir token
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const auth = req.headers.authorization || ''
      const token = String((req.query as any).token || '')
      if (auth !== `Bearer ${cronSecret}` && token !== cronSecret) {
        return res.status(401).json({ ok: false, error: 'No autorizado' })
      }
    }

    const days = Math.max(1, Math.min(365, Number((req.query as any).days) || 30))
    const dateTo = new Date().toISOString().slice(0, 10)
    const dateFrom = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

    const connResp = await fetch(`${supabaseUrl}/rest/v1/bank_connections?activo=eq.true&select=*`, { headers: sbHeaders })
    const conns = await connResp.json()
    if (!Array.isArray(conns) || conns.length === 0) {
      return res.status(200).json({ ok: true, action: 'sync', message: 'No hay conexiones bancarias activas (bank_connections). Crea una con /api/belvo?action=link', inserted: 0, perLink: [] })
    }

    let totalInserted = 0
    const perLink: any[] = []

    for (const conn of conns) {
      const txResp = await fetch(`${baseUrl}/api/transactions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: belvoAuth },
        body: JSON.stringify({ link: conn.link_id, date_from: dateFrom, date_to: dateTo }),
      })
      const txData = await txResp.json().catch(() => null)
      if (!txResp.ok) { perLink.push({ link: conn.link_id, status: txResp.status, error: txData }); continue }
      const txs: any[] = Array.isArray(txData) ? txData : (txData?.results || [])

      const rows = txs
        .filter(t => (t.status || 'PROCESSED') === 'PROCESSED' && t.id)
        .map(t => ({
          fecha: t.accounting_date || t.value_date || dateTo,
          concepto: t.description || t.merchant?.name || '',
          referencia: t.reference || '',
          monto: Math.abs(Number(t.amount) || 0),
          tipo: t.type === 'OUTFLOW' ? 'cargo' : 'abono',
          moneda: t.currency || conn.moneda || 'MXN',
          banco: conn.banco || null,
          cuenta: conn.cuenta || (t.account?.number ?? null),
          conciliado: false,
          source: 'belvo',
          belvo_transaction_id: t.id,
        }))

      let inserted = 0
      if (rows.length) {
        const insResp = await fetch(`${supabaseUrl}/rest/v1/bank_movements?on_conflict=belvo_transaction_id`, {
          method: 'POST',
          headers: { ...sbHeaders, Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: JSON.stringify(rows),
        })
        const insJson = await insResp.json().catch(() => [])
        if (!insResp.ok) { perLink.push({ link: conn.link_id, fetched: txs.length, error: insJson }); continue }
        inserted = Array.isArray(insJson) ? insJson.length : 0
      }
      totalInserted += inserted
      perLink.push({ link: conn.link_id, banco: conn.banco, fetched: txs.length, inserted })

      await fetch(`${supabaseUrl}/rest/v1/bank_connections?id=eq.${conn.id}`, {
        method: 'PATCH', headers: sbHeaders, body: JSON.stringify({ last_synced_at: new Date().toISOString() }),
      }).catch(() => {})
    }

    return res.status(200).json({ ok: true, action: 'sync', rango: { dateFrom, dateTo }, inserted: totalInserted, perLink })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) })
  }
}
