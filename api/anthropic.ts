// ═══════════════════════════════════════════════════════════════════════════
// /api/anthropic — Proxy server-side para la API de Anthropic.
//
// Por qué existe: antes el frontend llamaba directo a api.anthropic.com con la
// key incrustada en el bundle (VITE_ANTHROPIC_KEY), lo que la exponía a
// cualquiera que abriera la página. Este proxy mantiene la key SOLO en el
// servidor (env var ANTHROPIC_API_KEY, sin prefijo VITE_) y reenvía la petición.
//
// Uso desde el cliente: POST /api/anthropic con el MISMO body que antes se
// mandaba a /v1/messages. No mandar headers de auth ni de versión: los pone
// este proxy. Soporta web_search, documentos base64 y texto plano (passthrough).
//
// Env var requerida en Vercel: ANTHROPIC_API_KEY  (rotar la key vieja).
// ═══════════════════════════════════════════════════════════════════════════

export const config = {
  maxDuration: 120,
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed (use POST)' } })
    return
  }

  // Acepta ambos nombres de env var (ANTHROPIC_API_KEY o ANTHROPIC_KEY)
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY
  if (!apiKey) {
    res.status(500).json({
      error: { message: 'ANTHROPIC_API_KEY/ANTHROPIC_KEY no configurada en el servidor' },
    })
    return
  }

  try {
    // El body puede venir ya parseado (objeto) o como string según el runtime.
    const body =
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})

    // Permitir que el cliente pida betas vía header opcional sin exponer la key.
    const betaHeader = req.headers['anthropic-beta']

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'x-api-key': apiKey,
        ...(betaHeader ? { 'anthropic-beta': String(betaHeader) } : {}),
      },
      body,
    })

    const text = await upstream.text()
    res.status(upstream.status)
    res.setHeader('Content-Type', 'application/json')
    res.send(text)
  } catch (err: any) {
    console.error('[/api/anthropic] proxy error:', err?.message || err)
    res
      .status(502)
      .json({ error: { message: 'Error al contactar a Anthropic vía proxy' } })
  }
}
