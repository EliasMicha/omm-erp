// Vercel serverless — Sincroniza movimientos bancarios desde Belvo hacia bank_movements.
// Recorre las conexiones activas en bank_connections, trae las transacciones de cada link
// (últimos N días) y las inserta en bank_movements deduplicando por belvo_transaction_id.
// Así los movimientos aparecen solos en la Conciliación, sin importar TXT a mano.
//
// Env requeridas: BELVO_SECRET_ID, BELVO_SECRET_PASSWORD, (BELVO_BASE_URL opcional),
//   SUPABASE_URL/ANON_KEY (o VITE_*). Opcional: CRON_SECRET para proteger el endpoint.
//
// Uso: GET/POST /api/belvo-sync?days=30[&token=CRON_SECRET]

import type { VercelRequest, VercelResponse } from '@vercel/node'

// deploy trigger: belvo endpoints
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

  // Protección opcional: si CRON_SECRET está configurado, exigir token (header o query)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.authorization || ''
    const token = String((req.query as any).token || '')
    if (auth !== `Bearer ${cronSecret}` && token !== cronSecret) {
      return res.status(401).json({ ok: false, error: 'No autorizado' })
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ ok: false, error: 'Supabase env vars no configuradas' })
  const sbHeaders: Record<string, string> = { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }

  const belvoAuth = 'Basic ' + Buffer.from(`${secretId}:${secretPassword}`).toString('base64')

  try {
    const days = Math.max(1, Math.min(365, Number((req.query as any).days) || 30))
    const dateTo = new Date().toISOString().slice(0, 10)
    const dateFrom = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

    // 1. Conexiones activas
    const connResp = await fetch(`${supabaseUrl}/rest/v1/bank_connections?activo=eq.true&select=*`, { headers: sbHeaders })
    const conns = await connResp.json()
    if (!Array.isArray(conns) || conns.length === 0) {
      return res.status(200).json({ ok: true, message: 'No hay conexiones bancarias activas (bank_connections).', inserted: 0, perLink: [] })
    }

    let totalInserted = 0
    const perLink: any[] = []

    for (const conn of conns) {
      // 2. Traer transacciones del link desde Belvo
      const txResp = await fetch(`${baseUrl}/api/transactions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: belvoAuth },
        body: JSON.stringify({ link: conn.link_id, date_from: dateFrom, date_to: dateTo }),
      })
      const txData = await txResp.json().catch(() => null)
      if (!txResp.ok) { perLink.push({ link: conn.link_id, status: txResp.status, error: txData }); continue }
      const txs: any[] = Array.isArray(txData) ? txData : (txData?.results || [])

      // 3. Mapear a bank_movements
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
        // Upsert deduplicando por belvo_transaction_id (ignora los ya existentes)
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

      // 4. Marcar última sincronización
      await fetch(`${supabaseUrl}/rest/v1/bank_connections?id=eq.${conn.id}`, {
        method: 'PATCH', headers: sbHeaders, body: JSON.stringify({ last_synced_at: new Date().toISOString() }),
      }).catch(() => {})
    }

    return res.status(200).json({ ok: true, rango: { dateFrom, dateTo }, inserted: totalInserted, perLink })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) })
  }
}
