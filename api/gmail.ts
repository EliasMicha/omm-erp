// Vercel serverless — Integración Gmail para Cobranza.
// Una sola función con router por ?action= (respeta el límite de funciones de Vercel).
//
// Acciones:
//   GET  /api/gmail?action=connect     → redirige al consentimiento de Google (OAuth)
//   GET  /api/gmail?code=...           → callback de Google: guarda el refresh_token
//   GET  /api/gmail?action=status      → { connected, email }
//   POST /api/gmail?action=create_draft  body {to, subject, body} → crea un borrador en Gmail
//   GET  /api/gmail?action=disconnect  → borra el token guardado
//
// Env requeridas: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY,
//   (VITE_SUPABASE_URL o SUPABASE_URL).
// El refresh_token vive en la tabla gmail_tokens (RLS sin políticas → solo service_role).

import type { VercelRequest, VercelResponse } from '@vercel/node'

const REDIRECT_URI = 'https://omm-erp.vercel.app/api/gmail'
const APP_URL = 'https://omm-erp.vercel.app'
// gmail.compose = solo crear/editar borradores (no leer ni enviar). openid+email = para saber la cuenta.
const SCOPES = ['https://www.googleapis.com/auth/gmail.compose', 'openid', 'email']

function sb() {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` }
  return { url, key, headers }
}

async function getStoredToken(): Promise<{ email: string; refresh_token: string } | null> {
  const { url, headers } = sb()
  const r = await fetch(`${url}/rest/v1/gmail_tokens?id=eq.default&select=email,refresh_token`, { headers })
  const rows: any = await r.json().catch(() => [])
  if (Array.isArray(rows) && rows[0] && rows[0].refresh_token) return rows[0]
  return null
}

async function saveToken(email: string, refresh_token: string) {
  const { url, headers } = sb()
  await fetch(`${url}/rest/v1/gmail_tokens`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: 'default', email, refresh_token, updated_at: new Date().toISOString() }),
  })
}

async function accessTokenFromRefresh(refresh_token: string): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID || '',
      client_secret: process.env.GMAIL_CLIENT_SECRET || '',
      refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const j: any = await r.json()
  if (!j.access_token) throw new Error('No se pudo renovar el acceso a Gmail: ' + JSON.stringify(j))
  return j.access_token
}

function b64url(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
// Codifica el asunto en MIME (para acentos) — RFC 2047
function encHeader(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s
  return '=?UTF-8?B?' + Buffer.from(s, 'utf-8').toString('base64') + '?='
}
// Arma el MIME del correo. Si hay adjuntos → multipart/mixed; si no → texto plano.
function buildMime(to: string, subject: string, text: string, attachments: any[]): string {
  const head = [to ? `To: ${to}` : '', `Subject: ${encHeader(subject)}`, 'MIME-Version: 1.0'].filter(Boolean)
  if (!attachments || attachments.length === 0) {
    return head.concat(['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', text]).join('\r\n')
  }
  const boundary = 'omm_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  const parts: string[] = []
  parts.push(head.concat([`Content-Type: multipart/mixed; boundary="${boundary}"`, '']).join('\r\n'))
  parts.push([`--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', text].join('\r\n'))
  for (const a of attachments) {
    const b64 = String((a && a.dataB64) || '').replace(/\s+/g, '')
    if (!b64) continue
    const wrapped = b64.replace(/(.{76})/g, '$1\r\n')
    const fname = (a && a.filename) || 'adjunto.pdf'
    const mime = (a && a.mime) || 'application/pdf'
    parts.push([`--${boundary}`, `Content-Type: ${mime}; name="${fname}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${fname}"`, '', wrapped].join('\r\n'))
  }
  parts.push(`--${boundary}--`)
  return parts.join('\r\n')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  if (!clientId || !clientSecret) return res.status(500).json({ ok: false, error: 'Faltan GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET' })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ ok: false, error: 'Falta SUPABASE_SERVICE_ROLE_KEY' })

  const q: any = req.query || {}
  const action = String(q.action || '')
  const code = q.code

  try {
    // ── Callback de Google (llega con ?code=) ──
    if (code) {
      const tr = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      })
      const tok: any = await tr.json()
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      if (!tok.refresh_token) {
        return res.status(200).send(pageHtml('⚠️ No se recibió refresh_token', 'Ve a myaccount.google.com → Seguridad → Accesos de terceros, quita "OMM ERP", y vuelve a conectar desde el ERP.'))
      }
      let email = ''
      try {
        const payload = String(tok.id_token || '').split('.')[1]
        if (payload) email = (JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')).email) || ''
      } catch { /* ignore */ }
      await saveToken(email, tok.refresh_token)
      return res.status(200).send(pageHtml('✅ Gmail conectado', `${email || 'Tu cuenta'} quedó vinculada. Regresando al ERP…`, true))
    }

    // ── Iniciar conexión ──
    if (action === 'connect') {
      const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      u.searchParams.set('client_id', clientId)
      u.searchParams.set('redirect_uri', REDIRECT_URI)
      u.searchParams.set('response_type', 'code')
      u.searchParams.set('scope', SCOPES.join(' '))
      u.searchParams.set('access_type', 'offline')
      u.searchParams.set('prompt', 'consent')
      res.writeHead(302, { Location: u.toString() })
      return res.end()
    }

    // ── Estado ──
    if (action === 'status') {
      const t = await getStoredToken()
      return res.status(200).json({ ok: true, connected: !!t, email: t ? t.email : null })
    }

    // ── Desconectar ──
    if (action === 'disconnect') {
      const { url, headers } = sb()
      await fetch(`${url}/rest/v1/gmail_tokens?id=eq.default`, { method: 'DELETE', headers })
      return res.status(200).json({ ok: true })
    }

    // ── Crear borrador ──
    if (action === 'create_draft') {
      const body: any = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const to = String(body.to || '').trim()
      const subject = String(body.subject || '').trim()
      const text = String(body.body || '')
      const t = await getStoredToken()
      if (!t) return res.status(400).json({ ok: false, error: 'Gmail no está conectado. Da clic en "Conectar Gmail" primero.' })
      const at = await accessTokenFromRefresh(t.refresh_token)
      const attachments = Array.isArray(body.attachments) ? body.attachments : []
      const mime = buildMime(to, subject, text, attachments)
      const dr = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { raw: b64url(mime) } }),
      })
      const dj: any = await dr.json()
      if (!dr.ok) return res.status(500).json({ ok: false, error: (dj && dj.error && dj.error.message) || JSON.stringify(dj) })
      const openUrl = 'https://mail.google.com/mail/u/0/#drafts'
      return res.status(200).json({ ok: true, draftId: dj.id, url: openUrl, email: t.email })
    }

    return res.status(400).json({ ok: false, error: 'Acción no válida' })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) })
  }
}

function pageHtml(title: string, msg: string, redirect = false): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#0a0a0a;color:#eaeaea;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center;max-width:460px;padding:24px">
<h2 style="color:#10B981;margin-bottom:8px">${title}</h2>
<p style="color:#aaa;line-height:1.5">${msg}</p>
${redirect ? `<script>setTimeout(function(){window.location.href='${APP_URL}/cobranza'},2200)</script>` : `<p style="margin-top:18px"><a href="${APP_URL}/cobranza" style="color:#10B981">Volver al ERP</a></p>`}
</div></body></html>`
}
