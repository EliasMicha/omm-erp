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

import { timingSafeEqual } from 'crypto'

export const config = {
  maxDuration: 120,
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

// ── Candado (2026-10-26) ────────────────────────────────────────────────────
// Este proxy respondía a CUALQUIERA que conociera la URL y con CUALQUIER modelo.
// El 26-oct alguien gastó ~160 M tokens de Opus 5.5 con la llave del ERP en una
// hora (el ERP solo usa Sonnet 4.6). Desde hoy:
//   1. Solo atiende a un usuario del ERP con sesión (JWT de Supabase en
//      Authorization) o a una función nuestra (llave de servicio en x-omm-internal).
//   2. Solo deja pasar los modelos que el ERP usa, y con tope de max_tokens.
// Mismo patrón que api/chatbot.ts?action=transcribir. El JWT lo agrega solo el
// envoltorio de fetch de src/main.tsx a toda llamada a /api/*.
// Una función de /api no puede importar de src/: estas constantes son copia.
const SUPABASE_URL = 'https://ubbumxommqjcpdozpunf.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViYnVteG9tbXFqY3Bkb3pwdW5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwODA3MzAsImV4cCI6MjA5MDY1NjczMH0.GPKeRgjzjZ96Qo6lYMHKF68YK4y6ZmexvORsNT8VGns'
const MODELOS_PERMITIDOS = new Set(['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'])
const MAX_TOKENS_TOPE = 16000

async function autorizado(req: any): Promise<boolean> {
  const interna = String(req.headers['x-omm-internal'] || '')
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (interna && svc && interna.length === svc.length && timingSafeEqual(Buffer.from(interna), Buffer.from(svc))) return true
  const auth = String(req.headers.authorization || '')
  if (!auth.toLowerCase().startsWith('bearer ')) return false
  try {
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: SUPABASE_ANON } })
    if (!u.ok) return false
    const j = await u.json()
    return !!j?.id
  } catch { return false }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed (use POST)' } })
    return
  }
  if (!(await autorizado(req))) {
    res.status(401).json({ error: { message: 'Necesitas iniciar sesión en el ERP.' } })
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
    const datos = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
    if (!MODELOS_PERMITIDOS.has(String(datos.model || ''))) {
      res.status(400).json({ error: { message: `Modelo no permitido en el ERP: ${datos.model}` } })
      return
    }
    if (!(Number(datos.max_tokens) > 0) || Number(datos.max_tokens) > MAX_TOKENS_TOPE) datos.max_tokens = Math.min(Number(datos.max_tokens) || 4000, MAX_TOKENS_TOPE)
    const body = JSON.stringify(datos)

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
