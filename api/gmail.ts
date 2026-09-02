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
// gmail.readonly se agregó para RECLUTAMIENTO: leer los correos de postulación
// de Indeed y bajar el CV adjunto. Es de solo lectura; no permite borrar ni
// modificar nada del buzón. Al agregarlo hay que RECONECTAR Gmail una vez: un
// refresh_token viejo no trae el permiso nuevo y la búsqueda devuelve 403.
const SCOPES = ['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.events', 'openid', 'email']

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

    // ── RECLUTAMIENTO: postulaciones que llegan por correo ──────────────────
    //
    // Indeed manda un correo por cada postulación, con el CV adjunto. El
    // remitente es distinto en cada uno (37e2b74d-…@indeedemail.com,
    // willevargas549qi_g4w@indeedemail.com), así que se filtra por DOMINIO.
    if (action === 'postulaciones') {
      const t = await getStoredToken()
      if (!t) return res.status(200).json({ ok: true, connected: false, mensajes: [] })
      const at = await accessTokenFromRefresh(t.refresh_token)
      const dias = Math.min(Math.max(parseInt(String(q.dias || '30'), 10) || 30, 1), 365)
      const query = `from:indeedemail.com newer_than:${dias}d`
      const lr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Bearer ${at}` } })
      const lj: any = await lr.json()
      if (!lr.ok) {
        const msg = (lj && lj.error && lj.error.message) || JSON.stringify(lj)
        // 403 casi siempre significa que el token es anterior al permiso de lectura.
        const falta = /insufficient|scope|permission/i.test(msg)
        return res.status(200).json({ ok: false, connected: true, reconectar: falta, error: falta ? 'Gmail está conectado pero sin permiso de lectura. Vuelve a conectarlo para autorizarlo.' : msg })
      }
      const ids: string[] = ((lj.messages || []) as any[]).map(m => m.id)
      const mensajes: any[] = []
      for (const id of ids) {
        const mr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers: { Authorization: `Bearer ${at}` } })
        const mj: any = await mr.json()
        if (!mr.ok) continue
        mensajes.push(resumirCorreo(mj))
      }
      return res.status(200).json({ ok: true, connected: true, email: t.email, mensajes })
    }

    // Baja UN adjunto en base64 (el CV). Se pide aparte para no cargar todos
    // los PDFs de la bandeja de un jalón.
    if (action === 'postulacion_adjunto') {
      const t = await getStoredToken()
      if (!t) return res.status(400).json({ ok: false, error: 'Gmail no está conectado' })
      const at = await accessTokenFromRefresh(t.refresh_token)
      const mid = String(q.messageId || ''); const aid = String(q.attachmentId || '')
      if (!mid || !aid) return res.status(400).json({ ok: false, error: 'Faltan messageId / attachmentId' })
      const ar = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${mid}/attachments/${aid}`,
        { headers: { Authorization: `Bearer ${at}` } })
      const aj: any = await ar.json()
      if (!ar.ok) return res.status(500).json({ ok: false, error: (aj && aj.error && aj.error.message) || 'No se pudo bajar el adjunto' })
      // Gmail entrega base64url; se normaliza a base64 estándar.
      const b64 = String(aj.data || '').replace(/-/g, '+').replace(/_/g, '/')
      return res.status(200).json({ ok: true, base64: b64, size: aj.size })
    }

    // ── Ingesta automática de reclutamiento ────────────────────────────────
    // Correo → candidato → análisis, sin nadie enfrente. La dispara el cron de
    // Vercel (ver vercel.json). El mismo trabajo lo hace el navegador al abrir
    // Reclutamiento; esto es para que también corra de madrugada.
    //
    // Es idempotente: `origen_message_id` es único y solo analiza a quien no
    // tiene veredicto, así que dispararlo de más no duplica ni recobra.
    if (action === 'ingesta') {
      const r = await ingestaReclutamiento()
      return res.status(200).json(r)
    }

    return res.status(400).json({ ok: false, error: 'Acción no válida' })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ⚠️  COPIA DE src/lib/analisisPrompt.ts — MANTENER IDÉNTICA
//
//  Se intentó importarla (`import ... from '../src/lib/analisisPrompt'`) y
//  Vercel NO arrastra src/ dentro del bundle de una función de api/: la
//  función arrancó con ERR_MODULE_NOT_FOUND y TODO /api/gmail devolvió 500,
//  no solo la ingesta. Por eso vive copiada aquí.
//
//  Si se toca el prompt de allá, se toca aquí. Si divergen, dos candidatos
//  analizados por caminos distintos dejan de ser comparables y el orden por
//  compatibilidad de la pantalla deja de significar algo. Para cotejarlas:
//    diff <(sed -n '/^function promptDeAnalisis/,/^}/p' api/gmail.ts) \
//         <(sed -n '/^export function promptDeAnalisis/,/^}/p' src/lib/analisisPrompt.ts)
// ═══════════════════════════════════════════════════════════════════════════

function promptDeAnalisis(c: any, v: any): string {
  const vac = v
    ? `PUESTO: ${v.titulo || v.puesto || '—'}
ÁREA: ${v.area || '—'}
UBICACIÓN DEL TRABAJO: ${v.ubicacion || 'no especificada'}
JORNADA: ${v.tipo_jornada || 'no especificada'}
DESCRIPCIÓN:
${v.descripcion || '(sin descripción)'}
REQUISITOS:
${v.requisitos || '(sin requisitos capturados)'}`
    : `No hay vacante ligada. Evalúa contra el puesto al que dice postularse: "${c.puesto_solicitado || 'no especificado'}".`

  return `Eres el reclutador de OMM Technologies, un despacho mexicano de ingeniería eléctrica, instalaciones especiales e iluminación arquitectónica. Analiza a este candidato contra la vacante y devuelve un veredicto que se pueda defender.

── VACANTE ──
${vac}

── CANDIDATO ──
NOMBRE: ${c.nombre}
SE POSTULÓ A: ${c.puesto_solicitado || '—'}
${c.carta ? `CARTA DE PRESENTACIÓN:\n${c.carta.slice(0, 2000)}` : 'Sin carta de presentación.'}

El CV va adjunto a este mensaje. Léelo completo antes de contestar.

── CÓMO CALIFICAR ──
"compatibilidad" (0-100) mide SOLO el ajuste al trabajo:
  · qué tanto de lo que pide la vacante sabe hacer, con evidencia en el CV
  · profundidad y años en ese tipo de trabajo específico
  · señales de que termina lo que empieza (permanencia, crecimiento, responsabilidades)
  · qué tanto de lo que dice saber está respaldado por dónde estuvo y qué hizo

NUNCA metas en "compatibilidad": edad, sexo, estado civil, si tiene hijos,
apariencia, escuela de origen por prestigio, ni dónde vive. Reportas esos datos
en "contexto" porque el director los pidió, pero el número no los toca. Un
número que castiga por edad es discriminación laboral (LFT art. 133) y además
no predice desempeño.

El traslado va aparte, en "contexto.riesgo_traslado": un trayecto muy largo
predice ausentismo y renuncia temprana. Es información de logística que el
director pondera aparte — no la mezcles con el ajuste técnico.

── REGLAS ──
· No inventes. Si el CV no lo dice, usa null o "no_dice" y ponlo en "falta_saber".
· Distingue lo que DICE saber de lo que el CV RESPALDA. Un CV que dice "dominio
  de AutoCAD" sin un solo puesto de dibujante es "mencionada", no "respaldada".
· Calcula los meses reales de cada empleo. Si solo hay años, estima y dilo.
· Un hueco de más de 6 meses sin explicar es una bandera; no lo interpretes tú,
  ponlo como pregunta de entrevista.
· Trabajo de campo (electricistas, instaladores) NO se juzga con la vara de
  gabinete: ahí pesa el oficio, las obras hechas y las certificaciones, no los
  títulos.
· "distancia": estima el trayecto entre donde vive y la ubicación del trabajo en
  palabras ("~1 h en transporte público desde Ecatepec"). Si falta cualquiera de
  las dos, pon null y riesgo_traslado "no_se_sabe". No inventes kilómetros.
· Español de México, directo, sin adornos.

── FORMATO ──
Responde SOLO con este JSON, sin texto antes ni después:
{
  "compatibilidad": 0,
  "veredicto": "recomendado|con_reservas|no_cumple",
  "resumen": "2-3 renglones: quién es y por qué sí o por qué no",
  "puesto_actual": "su puesto más reciente o null",
  "anos_experiencia": 0,
  "dice_saber": [{"habilidad":"", "evidencia":"respaldada|mencionada|sin_respaldo", "nota":""}],
  "trayectoria": [{"empresa":"", "puesto":"", "desde":"AAAA-MM o AAAA", "hasta":"AAAA-MM, AAAA o actual", "meses":0, "nota":""}],
  "permanencia": {"promedio_meses":0, "empleos":0, "patron":"una línea: estable, brinca cada año, etc."},
  "requisitos": [{"requisito":"", "cumple":"si|parcial|no|no_dice", "por_que":""}],
  "fortalezas": [""],
  "riesgos": [""],
  "banderas": [{"senal":"", "severidad":"alta|media|baja", "por_que":""}],
  "preguntas": [""],
  "contexto": {
    "edad": null,
    "ubicacion": "colonia/municipio/estado o null",
    "distancia": "estimación en palabras o null",
    "riesgo_traslado": "bajo|medio|alto|no_se_sabe",
    "nota_traslado": "o null"
  },
  "falta_saber": [""]
}`
}

function promptDeExtraccion(correo: any): string {
  return `Este es un correo de aviso de postulación de una bolsa de trabajo. Saca los datos del CANDIDATO.

ASUNTO: ${correo.asunto || ''}
DE: ${correo.de || ''}
CUERPO:
${String(correo.texto || '').slice(0, 6000)}

Responde SOLO con este JSON, sin texto alrededor:
{
  "nombre": "nombre completo del candidato",
  "puesto": "el puesto al que se postuló",
  "email_real": "su correo personal si aparece, o null",
  "email_relay": "el correo que termina en @indeedemail.com si aparece, o null",
  "telefono": "su teléfono si aparece en el cuerpo, solo dígitos, o null",
  "carta": "el mensaje o carta de presentación que escribió, o null"
}

Reglas:
- El nombre del candidato NO es el de la empresa ni el del puesto.
- Un correo que termina en @indeedemail.com es un alias, va en email_relay, NUNCA en email_real.
- Si un dato no está, pon null. No inventes.`
}

// ═══════════════════════════════════════════════════════════════════════════
//  INGESTA AUTOMÁTICA DE RECLUTAMIENTO
// ═══════════════════════════════════════════════════════════════════════════

const MAX_POR_CORRIDA = 12   // techo por corrida: cada CV es una llamada al modelo

async function anthropic(body: any): Promise<any> {
  const key = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY no configurada')
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  })
  const j: any = await r.json()
  if (!r.ok) throw new Error((j && j.error && j.error.message) || 'Anthropic falló')
  return j
}

const jsonDeLaRespuesta = (j: any): any => {
  const txt = (j && j.content && j.content[0] && j.content[0].text) || ''
  const m = txt.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('El modelo no devolvió JSON')
  return JSON.parse(m[0])
}

async function sbGet(path: string): Promise<any[]> {
  const { url, headers } = sb()
  const r = await fetch(`${url}/rest/v1/${path}`, { headers })
  const j: any = await r.json().catch(() => [])
  return Array.isArray(j) ? j : []
}

async function sbPost(tabla: string, fila: any, prefer = 'return=representation'): Promise<any> {
  const { url, headers } = sb()
  const r = await fetch(`${url}/rest/v1/${tabla}`, {
    method: 'POST', headers: { ...headers, Prefer: prefer }, body: JSON.stringify(fila),
  })
  const j: any = await r.json().catch(() => null)
  if (!r.ok) throw new Error((j && (j.message || j.error)) || `No se pudo insertar en ${tabla}`)
  return Array.isArray(j) ? j[0] : j
}

async function sbPatch(tabla: string, filtro: string, campos: any) {
  const { url, headers } = sb()
  await fetch(`${url}/rest/v1/${tabla}?${filtro}`, {
    method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(campos),
  })
}

/** Sube el CV al bucket con la service key. Devuelve el path o null. */
async function subirCV(nombreArchivo: string, b64: string, tipo: string): Promise<string | null> {
  const { url, key } = sb()
  const limpio = nombreArchivo.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
  const path = `cv/${Date.now()}_${limpio}`
  const bytes = Buffer.from(b64, 'base64')
  const r = await fetch(`${url}/storage/v1/object/reclutamiento/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': tipo || 'application/octet-stream' },
    body: bytes as any,
  })
  return r.ok ? path : null
}

/** El adjunto que más parece un CV. Misma regla que el cliente. */
function adjuntoCV(adjuntos: any[]): any | null {
  const cands = (adjuntos || []).filter((a: any) =>
    /pdf|word|document|msword|officedocument/i.test(a.mimeType) || /\.(pdf|docx?|rtf)$/i.test(a.filename))
  if (!cands.length) return null
  const conCV = cands.filter((a: any) => /cv|curriculum|resume/i.test(a.filename))
  const lista = conCV.length ? conCV : cands
  return lista.sort((a: any, b: any) => (b.size || 0) - (a.size || 0))[0]
}

const sinAcento = (v: any) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** La vacante abierta que corresponde al puesto. Misma regla que el cliente. */
function vacanteDelPuesto(puesto: string, vacantes: any[]): any | null {
  const p = sinAcento(puesto).trim()
  if (!p) return null
  const abiertas = vacantes.filter(v => v.estado === 'abierta')
  const pool = abiertas.length ? abiertas : vacantes
  const exacta = pool.find(v => sinAcento(v.titulo) === p || sinAcento(v.puesto) === p)
  if (exacta) return exacta
  const palabras = p.split(/\W+/).filter(w => w.length > 3)
  let mejor: any = null
  for (const v of pool) {
    const t = sinAcento(v.titulo) + ' ' + sinAcento(v.puesto)
    const n = palabras.filter(w => t.includes(w)).length
    if (n > 0 && (!mejor || n > mejor.n)) mejor = { v, n }
  }
  return mejor ? mejor.v : null
}

async function ingestaReclutamiento() {
  const out: any = { ok: true, importados: 0, analizados: 0, fallos: [] as any[] }

  const vacantes = await sbGet('vacantes?select=*')
  const t = await getStoredToken()

  // ── 1. Correo → candidato ────────────────────────────────────────────────
  if (t) {
    try {
      const at = await accessTokenFromRefresh(t.refresh_token)
      const lr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=30&q=${encodeURIComponent('from:indeedemail.com newer_than:14d')}`,
        { headers: { Authorization: `Bearer ${at}` } })
      const lj: any = await lr.json()
      if (!lr.ok) {
        const msg = (lj && lj.error && lj.error.message) || 'Gmail no respondió'
        // El refresh_token guardado puede ser anterior al permiso de lectura.
        if (/insufficient|scope|permission/i.test(msg)) {
          out.reconectar = true
          throw new Error('Gmail está conectado pero sin permiso de lectura. Hay que reconectarlo una vez desde Reclutamiento → Bandeja para autorizarlo.')
        }
        throw new Error(msg)
      }
      const ids: string[] = ((lj.messages || []) as any[]).map((m: any) => m.id)

      let yaTengo = new Set<string>()
      if (ids.length) {
        const filas = await sbGet(`candidatos?select=origen_message_id&origen_message_id=in.(${ids.join(',')})`)
        yaTengo = new Set(filas.map((c: any) => c.origen_message_id))
      }
      const nuevos = ids.filter(id => !yaTengo.has(id)).slice(0, MAX_POR_CORRIDA)

      for (const id of nuevos) {
        try {
          const mr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
            { headers: { Authorization: `Bearer ${at}` } })
          const mj: any = await mr.json()
          if (!mr.ok) continue
          const correo: any = resumirCorreo(mj)

          const d = jsonDeLaRespuesta(await anthropic({
            model: 'claude-sonnet-4-6', max_tokens: 1200,
            messages: [{ role: 'user', content: promptDeExtraccion(correo) }],
          }))
          const nombre = String(d.nombre || '').trim()
          if (!nombre) { out.fallos.push({ quien: correo.asunto, error: 'sin nombre' }); continue }

          const esRelay = (v: any) => /@indeedemail\.com$/i.test(String(v || ''))
          const digitos = (v: any) => { const x = String(v == null ? '' : v).replace(/\D/g, ''); return x.length >= 10 ? x : null }

          let cv_path: string | null = null, cv_nombre: string | null = null
          const adj = adjuntoCV(correo.adjuntos)
          if (adj) {
            const ar = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/attachments/${adj.attachmentId}`,
              { headers: { Authorization: `Bearer ${at}` } })
            const aj: any = await ar.json()
            if (ar.ok && aj.data) {
              const b64 = String(aj.data).replace(/-/g, '+').replace(/_/g, '/')
              cv_path = await subirCV(adj.filename, b64, adj.mimeType)
              if (cv_path) cv_nombre = adj.filename
            }
          }

          const vac = vacanteDelPuesto(String(d.puesto || ''), vacantes)
          await sbPost('candidatos', {
            vacante_id: vac ? vac.id : null,
            nombre,
            email: d.email_real && !esRelay(d.email_real) ? String(d.email_real).trim() : null,
            email_relay: esRelay(d.email_relay) ? String(d.email_relay).trim() : (esRelay(d.email_real) ? String(d.email_real).trim() : null),
            telefono: digitos(d.telefono),
            fuente: 'indeed',
            puesto_solicitado: String(d.puesto || '').trim() || null,
            carta: d.carta ? String(d.carta).trim() : null,
            cv_path, cv_nombre,
            etapa: 'nuevo',
            origen_message_id: id,
            recibido_at: correo.fecha || new Date().toISOString(),
          }, 'return=minimal,resolution=ignore-duplicates')
          out.importados++
        } catch (e: any) {
          out.fallos.push({ quien: id, error: String((e && e.message) || e) })
        }
      }
    } catch (e: any) {
      out.fallos.push({ quien: 'gmail', error: String((e && e.message) || e) })
    }
  } else {
    out.gmail = 'no conectado'
  }

  // ── 2. Análisis de quien no lo tenga ─────────────────────────────────────
  const pendientes = await sbGet(`candidatos?select=*&analisis_at=is.null&limit=${MAX_POR_CORRIDA}`)
  const { url, key } = sb()
  for (const c of pendientes) {
    try {
      const contenido: any[] = []
      if (c.cv_path && /\.pdf$/i.test(c.cv_path)) {
        const dr = await fetch(`${url}/storage/v1/object/reclutamiento/${c.cv_path}`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } })
        if (dr.ok) {
          const b64 = Buffer.from(await dr.arrayBuffer()).toString('base64')
          contenido.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } })
        }
      }
      const vac = vacantes.find((v: any) => v.id === c.vacante_id) || vacanteDelPuesto(c.puesto_solicitado || '', vacantes)
      contenido.push({ type: 'text', text: promptDeAnalisis(c, vac || null) + (contenido.length ? '' : '\n\nNOTA: no se pudo leer el CV. Analiza con lo que hay y sé explícito en "falta_saber".') })

      const d = jsonDeLaRespuesta(await anthropic({
        model: 'claude-sonnet-4-6', max_tokens: 4000, messages: [{ role: 'user', content: contenido }],
      }))
      const compat = Math.max(0, Math.min(100, Math.round(Number(d.compatibilidad) || 0)))
      await sbPatch('candidatos', `id=eq.${c.id}`, {
        compatibilidad: compat, analisis: d,
        analisis_at: new Date().toISOString(), analisis_error: null, analisis_modelo: 'claude-sonnet-4-6',
      })
      out.analizados++
    } catch (e: any) {
      await sbPatch('candidatos', `id=eq.${c.id}`, {
        analisis_error: String((e && e.message) || e), analisis_at: new Date().toISOString(),
      })
      out.fallos.push({ quien: c.nombre, error: String((e && e.message) || e) })
    }
  }

  return out
}

/**
 * Aplana un correo de Gmail a lo que necesita el ERP: encabezados, texto plano
 * y los adjuntos que parezcan un CV.
 *
 * El cuerpo puede venir en `payload.body` o repartido en `parts` (y en partes
 * anidadas cuando el correo trae texto + HTML + adjunto). Hay que recorrerlo
 * completo o el texto se pierde y el extractor se queda sin nada que leer.
 */
function resumirCorreo(m: any) {
  const H: Record<string, string> = {}
  for (const h of (m.payload?.headers || [])) H[String(h.name || '').toLowerCase()] = h.value || ''
  let texto = ''
  const adjuntos: any[] = []
  const anda = (p: any) => {
    if (!p) return
    const mt = String(p.mimeType || '')
    if (p.filename && p.body?.attachmentId) {
      adjuntos.push({ filename: p.filename, mimeType: mt, size: p.body.size || 0, attachmentId: p.body.attachmentId })
    } else if (mt === 'text/plain' && p.body?.data) {
      texto += Buffer.from(String(p.body.data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8') + '\n'
    }
    for (const c of (p.parts || [])) anda(c)
  }
  anda(m.payload)
  // Si sólo vino HTML, se desviste a texto: mejor eso que quedarse sin cuerpo.
  if (!texto.trim()) {
    const soloHtml = (p: any): string => {
      if (!p) return ''
      if (String(p.mimeType) === 'text/html' && p.body?.data) {
        return Buffer.from(String(p.body.data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
      }
      for (const c of (p.parts || [])) { const r = soloHtml(c); if (r) return r }
      return ''
    }
    texto = soloHtml(m.payload).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ')
  }
  return {
    id: m.id,
    threadId: m.threadId,
    fecha: H['date'] || '',
    internalDate: m.internalDate || null,
    de: H['from'] || '',
    asunto: H['subject'] || '',
    texto: texto.slice(0, 8000),
    adjuntos,
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
