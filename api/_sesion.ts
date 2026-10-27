// Candado común de las funciones de /api (2026-10-27).
//
// Por qué: /api corre en Vercel, fuera de Supabase, así que RLS no las cubre. El
// 26-oct alguien usó /api/anthropic —que no pedía nada— para gastar ~$240 USD de
// la llave de Claude en una mañana. Las demás funciones que cuestan dinero
// (Claude, OpenAI) o mandan correo a nombre de OMM estaban igual de abiertas.
//
// Quién pasa:
//   1. Un usuario del ERP con sesión: JWT de Supabase en `Authorization: Bearer`.
//      Lo agrega solo el envoltorio de fetch de src/main.tsx a toda llamada a /api/*.
//   2. Una función nuestra: la llave de servicio en `x-omm-internal`.
//   3. Los crons de Vercel: `Authorization: Bearer <CRON_SECRET>` (Vercel lo manda solo).
//   4. Los Atajos del iPhone: `CAPTURE_TOKEN` en `x-omm-token`, `?token=` o `body.token`.
//
// El guion bajo hace que Vercel NO lo cuente como función (tope de 12 en Hobby).
// Se importa como './_sesion.js' — con la extensión, igual que _avisoPago: Node ESM
// no prueba extensiones y sin ella la función truena con ERR_MODULE_NOT_FOUND.

import { timingSafeEqual } from 'crypto'

const SUPABASE_URL = 'https://ubbumxommqjcpdozpunf.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViYnVteG9tbXFqY3Bkb3pwdW5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwODA3MzAsImV4cCI6MjA5MDY1NjczMH0.GPKeRgjzjZ96Qo6lYMHKF68YK4y6ZmexvORsNT8VGns'

function iguales(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export async function permitido(req: any): Promise<boolean> {
  const h = req.headers || {}
  if (iguales(String(h['x-omm-internal'] || ''), process.env.SUPABASE_SERVICE_ROLE_KEY || '')) return true

  const auth = String(h.authorization || '')
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (bearer && iguales(bearer, process.env.CRON_SECRET || '')) return true

  const cap = process.env.CAPTURE_TOKEN || ''
  let cuerpo: any = req.body
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo) } catch { cuerpo = null } }
  const tok = String(h['x-omm-token'] || req.query?.token || (cuerpo && typeof cuerpo === 'object' ? cuerpo.token : '') || '')
  if (tok && iguales(tok, cap)) return true

  if (!bearer) return false
  try {
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${bearer}`, apikey: SUPABASE_ANON } })
    if (!u.ok) return false
    const j: any = await u.json()
    return !!j?.id
  } catch { return false }
}

/** true = adelante. false = ya contestó 401 y la función debe salir. */
export async function exigirSesion(req: any, res: any): Promise<boolean> {
  if (await permitido(req)) return true
  res.status(401).json({ ok: false, error: 'Necesitas iniciar sesión en el ERP.' })
  return false
}
