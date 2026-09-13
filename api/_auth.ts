import type { VercelRequest, VercelResponse } from '@vercel/node'

type AuthMode = 'off' | 'observe' | 'enforce'

interface AuthOptions {
  endpoint: string
  allowCron?: boolean
}

function authMode(endpoint: string): AuthMode {
  const endpointKey = `API_AUTH_MODE_${endpoint.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`
  const configured = String(process.env[endpointKey] || process.env.API_AUTH_MODE || 'observe').toLowerCase()
  return configured === 'off' || configured === 'enforce' ? configured : 'observe'
}

function bearerToken(req: VercelRequest): string | null {
  const header = String(req.headers.authorization || '')
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function isValidCron(req: VercelRequest): boolean {
  const expected = process.env.CRON_SECRET
  return !!expected && bearerToken(req) === expected
}

/**
 * Transitional API guard.
 *
 * API_AUTH_MODE=observe (default): records missing/invalid authentication but
 * preserves the current behaviour. This makes the first rollout non-breaking.
 * API_AUTH_MODE=enforce: rejects unauthenticated requests with 401.
 * API_AUTH_MODE=off: bypasses the guard for emergency rollback.
 *
 * Never logs JWTs, request bodies, email addresses, or other business data.
 */
export async function requireSupabaseUser(
  req: VercelRequest,
  res: VercelResponse,
  options: AuthOptions,
): Promise<boolean> {
  const mode = authMode(options.endpoint)
  res.setHeader('X-OMM-Auth-Mode', mode)

  if (mode === 'off') return true
  if (options.allowCron && isValidCron(req)) return true

  const token = bearerToken(req)
  if (!token) {
    console.warn('[api-auth]', JSON.stringify({ endpoint: options.endpoint, result: 'missing', mode }))
    if (mode === 'enforce') {
      res.status(401).json({ ok: false, error: 'Autenticación requerida' })
      return false
    }
    return true
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl || !anonKey) {
    console.error('[api-auth]', JSON.stringify({ endpoint: options.endpoint, result: 'config_error', mode }))
    if (mode === 'enforce') {
      res.status(503).json({ ok: false, error: 'Servicio de autenticación no disponible' })
      return false
    }
    return true
  }

  try {
    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    })
    if (authResponse.ok) return true

    console.warn('[api-auth]', JSON.stringify({ endpoint: options.endpoint, result: 'invalid', mode }))
    if (mode === 'enforce') {
      res.status(401).json({ ok: false, error: 'Sesión inválida o vencida' })
      return false
    }
    return true
  } catch {
    console.error('[api-auth]', JSON.stringify({ endpoint: options.endpoint, result: 'unavailable', mode }))
    if (mode === 'enforce') {
      res.status(503).json({ ok: false, error: 'No se pudo validar la sesión' })
      return false
    }
    return true
  }
}
