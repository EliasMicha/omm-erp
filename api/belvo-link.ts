// Vercel serverless — Helper para crear un LINK de prueba en Belvo SANDBOX y
// registrarlo en bank_connections. Solo funciona apuntando a sandbox (seguridad):
// los links reales de producción se crean con el Connect Widget de Belvo (con las
// credenciales reales del banco), no con este helper.
//
// Uso: GET /api/belvo-link  (usa institución/usuario/password de prueba por default;
//   overrideable con ?institution=&username=&password=&banco=&cuenta=&moneda=)

import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const secretId = process.env.BELVO_SECRET_ID
  const secretPassword = process.env.BELVO_SECRET_PASSWORD
  const baseUrl = (process.env.BELVO_BASE_URL || 'https://sandbox.belvo.com').replace(/\/$/, '')
  if (!secretId || !secretPassword) return res.status(500).json({ ok: false, error: 'Faltan BELVO_SECRET_ID / BELVO_SECRET_PASSWORD' })
  if (!/sandbox/i.test(baseUrl)) {
    return res.status(400).json({ ok: false, error: 'Este helper solo crea links en SANDBOX. Para producción usa el Connect Widget de Belvo con las credenciales reales del banco.' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ ok: false, error: 'Supabase env vars no configuradas' })
  const sbHeaders: Record<string, string> = { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }

  const q = req.query as any
  const institution = String(q.institution || 'erebor_mx_retail')
  const username = String(q.username || 'bnk1006')
  const password = String(q.password || 'supersecret')
  const banco = String(q.banco || 'BBVA (sandbox)')
  const cuenta = String(q.cuenta || 'erebor-test')
  const moneda = String(q.moneda || 'MXN')

  const belvoAuth = 'Basic ' + Buffer.from(`${secretId}:${secretPassword}`).toString('base64')

  try {
    // 1. Crear el link en Belvo
    const linkResp = await fetch(`${baseUrl}/api/links/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: belvoAuth },
      body: JSON.stringify({ institution, username, password, access_mode: 'recurrent' }),
    })
    const linkData = await linkResp.json().catch(() => null)
    if (!linkResp.ok) return res.status(linkResp.status).json({ ok: false, error: 'Belvo no pudo crear el link', detail: linkData })
    const linkId = linkData?.id
    if (!linkId) return res.status(500).json({ ok: false, error: 'Belvo no devolvió un link id', detail: linkData })

    // 2. Registrar en bank_connections (evita duplicar si ya existe ese link)
    const existResp = await fetch(`${supabaseUrl}/rest/v1/bank_connections?link_id=eq.${linkId}&select=id`, { headers: sbHeaders })
    const exist = await existResp.json().catch(() => [])
    if (!Array.isArray(exist) || exist.length === 0) {
      await fetch(`${supabaseUrl}/rest/v1/bank_connections`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ link_id: linkId, institution, banco, cuenta, moneda, activo: true }),
      })
    }

    return res.status(200).json({ ok: true, link_id: linkId, institution, banco, cuenta, moneda, next: '/api/belvo-sync?days=90' })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) })
  }
}
