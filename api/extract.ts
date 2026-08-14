// Vercel serverless function — extrae items de cotización desde archivos usando Claude API
// Recibe: { kind: 'text'|'pdf'|'image', payload: string, mediaType?: string }
// Devuelve: { ok: boolean, items?: any[], confidence?: string, warnings?: string[], error?: string }

import type { VercelRequest, VercelResponse } from '@vercel/node'

const PROMPT_GENERIC = `Eres un asistente experto en listados de productos para instalaciones especiales (audio, redes, CCTV, control de acceso, control de iluminación, detección de humo, BMS, telefonía, red celular, cortinas/persianas).

Tu tarea es extraer TODOS los productos del documento adjunto y devolver un JSON ESTRICTO con esta estructura exacta (sin markdown, sin backticks, sin texto antes ni después):

{
  "items": [
    {
      "area": "nombre del área/zona/recámara/cuarto si aparece, o '' si no aparece",
      "systemId": "uno de: audio, redes, cctv, control_acceso, control_iluminacion, deteccion_humo, bms, telefonia, red_celular",
      "marca": "marca/fabricante",
      "modelo": "número de modelo o SKU exacto",
      "descripcion": "descripción corta",
      "cantidad": número,
      "precio_unitario": número o null,
      "moneda": "USD" o "MXN" o null,
      "provider": "proveedor/distribuidor (Syscom, Ubiquiti, Lutron, Sonos, Somfy, Dealershop, Tecso, etc.) o ''",
      "notas": "string o ''"
    }
  ],
  "confidence": "high|medium|low",
  "warnings": ["string"]
}

REGLAS:
- Si una fila contiene varios productos, sepáralos en items distintos.
- Si no logras identificar el sistema, usa "audio" y agrega advertencia.
- El campo "modelo" es OBLIGATORIO. Si no hay modelo, omite el item y agrégalo a warnings.
- Respeta cantidades exactas, no inventes.
- Si el documento tiene secciones por área (Recámara, Sala, Cocina, etc.), asocia los items siguientes a esa área.
- Si detectas precios, identifica la moneda por símbolos ($, USD, MXN, dlls, pesos).
- NO inventes precios. Si no hay precio, usa null.
- Devuelve SOLO el JSON.`

const PROMPT_CORTINAS = `Eres un asistente experto en cotizaciones de cortinas y persianas para el ERP de OMM Technologies.

Tu tarea es extraer TODOS los productos del PDF adjunto (cortinas, persianas, controles, interfaces) y devolver un JSON ESTRICTO con esta estructura exacta (sin markdown, sin backticks, sin texto antes ni después):

{
  "items": [
    {
      "area": "ej. RECAMARA PRINCIPAL, SALA, COCINA, GENERAL",
      "itemKind": "PERSIANA" o "CORTINA",
      "persianaTipo": "ROLLER" o "VENECIANA" o "ROMANA" o null,
      "persianaMaterial": "ej. BLACKOUT, TRASLUCIDA, SCREEN 5%, MADERA 50MM",
      "ancho": número en metros (o 0 si no aplica),
      "alto": número en metros (o 0 si no aplica),
      "cantidad": número entero (default 1),
      "tipoCierre": "MANUAL" o "MOTORIZADO",
      "motorBrand": "SOMFY" o "LUTRON" o "NINGUNO",
      "motorSystem": "ej. LSN50, MOVELITE 35KG, GLYDEA60WT, SIVOIA QS, ACOPLAMIENTO",
      "tipoTela": "ej. TRASLUCIDA, BLACKOUT, SHEER (solo si es CORTINA)",
      "tipoPliegue": "ej. ONDA PERFECTA, TABLEADO (solo si es CORTINA)",
      "totalVenta": número en MXN (el TOTAL de la fila tal como aparece en el PDF, con margen ya aplicado),
      "notas": "ej. TELA INCLUIDA CON CANALETAS LATERALES NEGRAS"
    }
  ],
  "extras": [
    {
      "nombre": "ej. CONTROLES SITUO 5, INTERFACE INTERTEC 16 RTS",
      "cantidad": número,
      "precioUnitario": número en MXN,
      "total": número en MXN
    }
  ],
  "meta": {
    "cliente": "nombre del cliente si aparece",
    "proyecto": "nombre del proyecto si aparece",
    "ubicacion": "ciudad o ubicación",
    "instPct": número (% de instalación si aparece, ej. 14),
    "ivaRate": número (16 por default)
  },
  "confidence": "high|medium|low",
  "warnings": ["string"]
}

REGLAS:
- "PERSIANA MOTORIZADA" → itemKind=PERSIANA, tipoCierre=MOTORIZADO. "CORTINA MOTORIZADA" → itemKind=CORTINA. "MANUAL" → tipoCierre=MANUAL.
- motorBrand inferido de motorSystem: LSN50/MOVELITE/GLYDEA/IRISMO/SONESSE → SOMFY. SIVOIA/ALENA → LUTRON. Vacío o "ACOPLAMIENTO" sin marca clara → SOMFY (asumiendo). Si tipoCierre=MANUAL → motorBrand=NINGUNO.
- persianaTipo: para persianas roller (LSN50, SONESSE) usa "ROLLER". Para persianas de madera/aluminio usa "VENECIANA". Para tela plisada con bandas horizontales usa "ROMANA". Si no es persiana, usa null.
- persianaMaterial: lo que aparezca en "TIPO DE TELA" (BLACKOUT, TRASLUCIDA, etc.) para persianas. Para cortinas déjalo vacío.
- totalVenta: el número de la columna TOTAL ($58,902.77 MXN → 58902.77). Es el PRECIO DE VENTA con margen, no el costo.
- notas: contenido de las celdas "PRECIO CONFECCION TELA" cuando dicen "TELA INCLUIDA…", o cualquier observación de la fila (ej "ACOPLAMIENTO").
- Si el documento tiene secciones por área (RECAMARA PRINCIPAL, RECAMARA 2, SALA), asocia los items siguientes a esa área. Si no hay áreas explícitas, usa "GENERAL".
- Filas al final del PDF que NO son cortinas/persianas (CONTROLES, INTERFACES, accesorios sueltos) van en "extras", NO en items.
- ancho/alto en metros (no centímetros). 4.7 = 4.7m de ancho.
- Si el PDF no tiene ancho/alto (ej. en "extras"), no los pongas en items.
- No inventes precios ni medidas.
- Devuelve SOLO el JSON.`

// ═══════════════════════════════════════════════════════════════════════════
// RUTINAS — pendientes recurrentes (semanal / quincenal / mensual)
//   Definiciones en tabla `rutinas`. Cada día que "toca", se materializa un
//   action_item (Mis pendientes + correo 7am) y al crearse la rutina se genera
//   UN evento recurrente (RRULE) en Google Calendar.
// ═══════════════════════════════════════════════════════════════════════════
function cdmxHoy(): string { return new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10) }

function rutinaTocaEl(r: any, fecha: string): boolean {
  const d = new Date(fecha + 'T00:00:00Z')
  const dow = d.getUTCDay()
  const dom = d.getUTCDate()
  const lastDom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  if (r.frecuencia === 'semanal') return r.dia_semana === dow
  if (r.frecuencia === 'quincenal') {
    if (!r.fecha_ancla) return false
    const a = new Date(String(r.fecha_ancla).slice(0, 10) + 'T00:00:00Z')
    const diff = Math.round((d.getTime() - a.getTime()) / 86400000)
    return diff >= 0 && diff % 14 === 0
  }
  if (r.frecuencia === 'mensual') {
    const dias: number[] = Array.isArray(r.dias_mes) ? r.dias_mes : []
    return dias.indexOf(dom) >= 0 || (dias.indexOf(-1) >= 0 && dom === lastDom)
  }
  return false
}

function rutinaProxima(r: any, desde: string): string {
  const base = new Date(desde + 'T00:00:00Z').getTime()
  for (let i = 0; i < 62; i++) {
    const f = new Date(base + i * 86400000).toISOString().slice(0, 10)
    if (rutinaTocaEl(r, f)) return f
  }
  return desde
}

function rutinaRRule(r: any): string {
  const BY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  if (r.frecuencia === 'semanal') return `RRULE:FREQ=WEEKLY;BYDAY=${BY[r.dia_semana != null ? r.dia_semana : 1]}`
  if (r.frecuencia === 'quincenal') return 'RRULE:FREQ=WEEKLY;INTERVAL=2'
  const dias: number[] = Array.isArray(r.dias_mes) && r.dias_mes.length ? r.dias_mes : [1]
  return `RRULE:FREQ=MONTHLY;BYMONTHDAY=${dias.join(',')}`
}

async function syncRutinas(sUrl: string, svcKey: string, gcid?: string, gsec?: string) {
  const H: any = { apikey: svcKey, Authorization: `Bearer ${svcKey}` }
  const JH: any = { ...H, 'Content-Type': 'application/json' }
  const hoy = cdmxHoy()
  const rutinas: any[] = await fetch(`${sUrl}/rest/v1/rutinas?select=*`, { headers: H }).then(r => r.json())
  if (!Array.isArray(rutinas)) return { materializadas: 0, eventos_creados: 0, eventos_borrados: 0 }
  let mat = 0, evC = 0, evB = 0
  // 1) Materializar el pendiente de HOY para rutinas activas que tocan hoy (idempotente por last_materialized)
  for (const r of rutinas) {
    if (r.estado !== 'activa' || r.last_materialized === hoy || !rutinaTocaEl(r, hoy)) continue
    const row = { title: r.titulo, area: 'DG', source_type: 'dashboard', status: 'pendiente', priority: r.prioridad || 2, due_date: hoy, due_time: r.hora || null, description: r.descripcion || null, tags: ['rutina'] }
    const ins = await fetch(`${sUrl}/rest/v1/action_items`, { method: 'POST', headers: JH, body: JSON.stringify(row) })
    if (ins.ok) { mat++; await fetch(`${sUrl}/rest/v1/rutinas?id=eq.${r.id}`, { method: 'PATCH', headers: JH, body: JSON.stringify({ last_materialized: hoy }) }) }
    else console.error('[rutinas/materializar]', (await ins.text()).substring(0, 200))
  }
  // 2) Google Calendar: crear evento recurrente para rutinas activas sin evento; borrar el de pausadas/borradas
  const pendCrear = rutinas.filter(r => r.estado === 'activa' && !r.gcal_event_id)
  const pendBorrar = rutinas.filter(r => r.estado !== 'activa' && r.gcal_event_id)
  if ((pendCrear.length || pendBorrar.length) && gcid && gsec) {
    const tr = await fetch(`${sUrl}/rest/v1/gmail_tokens?id=eq.default&select=refresh_token`, { headers: H })
    const trows: any = await tr.json()
    const refresh = Array.isArray(trows) && trows[0] && trows[0].refresh_token
    if (refresh) {
      const atr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: gcid, client_secret: gsec, refresh_token: refresh, grant_type: 'refresh_token' }) })
      const atj: any = await atr.json()
      if (atj.access_token) {
        const gH: any = { 'Content-Type': 'application/json', Authorization: `Bearer ${atj.access_token}` }
        const tz = 'America/Mexico_City'
        for (const r of pendCrear) {
          const f0 = rutinaProxima(r, hoy)
          const ev: any = { summary: r.titulo, description: r.descripcion || undefined, recurrence: [rutinaRRule(r)], reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 10 }] } }
          if (r.hora) {
            const t = String(r.hora).length === 5 ? String(r.hora) + ':00' : String(r.hora)
            const parts = t.split(':')
            const hh = parseInt(parts[0], 10), mm = parseInt(parts[1], 10)
            let eh = hh + 1, em = mm
            if (eh > 23) { eh = 23; em = 59 }
            ev.start = { dateTime: `${f0}T${t}`, timeZone: tz }
            ev.end = { dateTime: `${f0}T${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`, timeZone: tz }
          } else {
            const next = new Date(new Date(f0 + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)
            ev.start = { date: f0 }
            ev.end = { date: next }
          }
          const evr = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: gH, body: JSON.stringify(ev) })
          if (evr.ok) { const evj: any = await evr.json(); evC++; await fetch(`${sUrl}/rest/v1/rutinas?id=eq.${r.id}`, { method: 'PATCH', headers: JH, body: JSON.stringify({ gcal_event_id: evj.id }) }) }
          else console.error('[rutinas/gcal crear]', (await evr.text()).substring(0, 200))
        }
        for (const r of pendBorrar) {
          const dr = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(r.gcal_event_id)}`, { method: 'DELETE', headers: gH })
          if (dr.ok || dr.status === 404 || dr.status === 410) { evB++; await fetch(`${sUrl}/rest/v1/rutinas?id=eq.${r.id}`, { method: 'PATCH', headers: JH, body: JSON.stringify({ gcal_event_id: null }) }) }
          else console.error('[rutinas/gcal borrar]', (await dr.text()).substring(0, 200))
        }
      }
    }
  }
  // 3) Limpieza: rutinas borradas que ya no tienen evento en Calendar → fuera de la tabla
  for (const r of rutinas) {
    if (r.estado === 'borrada' && !r.gcal_event_id) await fetch(`${sUrl}/rest/v1/rutinas?id=eq.${r.id}`, { method: 'DELETE', headers: H })
  }
  return { materializadas: mat, eventos_creados: evC, eventos_borrados: evB }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-omm-token')
  // ── Brief diario (cron 7am CDMX) — GET /api/extract?action=daily_brief ──
  if (req.query && (req.query as any).action === 'daily_brief') {
    const auth = String(req.headers.authorization || '')
    const okCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
    const okTok = (req.query as any).token && (req.query as any).token === process.env.CAPTURE_TOKEN
    if (!okCron && !okTok) { res.status(401).json({ ok: false, error: 'No autorizado' }); return }
    try {
      const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      const sUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
      const gcid = process.env.GMAIL_CLIENT_ID, gsec = process.env.GMAIL_CLIENT_SECRET
      if (!svcKey || !sUrl || !gcid || !gsec) { res.status(500).json({ ok: false, error: 'Faltan envs (service role / gmail)' }); return }
      // Rutinas: materializar los pendientes de hoy ANTES de armar el correo (así salen en "Hoy")
      try { await syncRutinas(sUrl, svcKey, gcid, gsec) } catch (e: any) { console.error('[daily_brief/rutinas]', e && e.message) }
      const H: any = { apikey: svcKey, Authorization: `Bearer ${svcKey}` }
      const listR = await fetch(`${sUrl}/rest/v1/action_items?area=eq.DG&source_type=eq.dashboard&status=neq.completada&select=title,due_date,due_time,tags,priority&order=due_date.asc.nullslast`, { headers: H })
      const items: any[] = await listR.json()
      const cdmx = new Date(Date.now() - 6 * 3600 * 1000)
      const hoy = cdmx.toISOString().slice(0, 10)
      const finSem = new Date(cdmx.getTime() + 7 * 86400000).toISOString().slice(0, 10)
      const esCita = (it: any) => (Array.isArray(it.tags) && it.tags.indexOf('cita') >= 0) || (!!it.due_time && !(Array.isArray(it.tags) && it.tags.indexOf('rutina') >= 0))
      const fmt = (it: any) => {
        const hora = it.due_time ? ' ' + String(it.due_time).slice(0, 5) : ''
        const tag = esCita(it) ? '<span style="background:#10B98122;color:#0a7d4f;font-size:11px;font-weight:700;border-radius:5px;padding:1px 6px;margin-right:6px">CITA</span>' : ''
        const fecha = it.due_date ? `<span style="color:#888;font-size:12px">${it.due_date}${hora}</span>` : ''
        const t = String(it.title || '').split('<').join('&lt;')
        return `<li style="margin:7px 0;list-style:none;border-left:3px solid #eee;padding-left:10px">${tag}<b>${t}</b> ${fecha}</li>`
      }
      const vencidos = items.filter(it => it.due_date && it.due_date < hoy)
      const deHoy = items.filter(it => it.due_date === hoy)
      const semana = items.filter(it => it.due_date && it.due_date > hoy && it.due_date <= finSem)
      const sinFecha = items.filter(it => !it.due_date)
      const sec = (titulo: string, arr: any[], color: string) => arr.length ? `<h3 style="color:${color};font-size:15px;margin:18px 0 6px">${titulo} (${arr.length})</h3><ul style="padding-left:0;margin:0">${arr.map(fmt).join('')}</ul>` : ''
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
        <h2 style="margin:0 0 2px">Tu dia en OMM</h2>
        <div style="color:#888;font-size:13px;margin-bottom:8px">${hoy}</div>
        ${sec('Vencidos', vencidos, '#DC2626')}
        ${sec('Hoy', deHoy, '#0a7d4f')}
        ${sec('Esta semana', semana, '#2563EB')}
        ${sec('Sin fecha', sinFecha, '#999')}
        ${items.length === 0 ? '<p style="color:#888">Sin pendientes abiertos por hoy.</p>' : ''}
        <p style="color:#bbb;font-size:11px;margin-top:26px">Enviado automaticamente por tu ERP OMM</p>
      </div>`
      const tR = await fetch(`${sUrl}/rest/v1/gmail_tokens?id=eq.default&select=email,refresh_token`, { headers: H })
      const tRows: any[] = await tR.json()
      const tk: any = Array.isArray(tRows) && tRows[0]
      if (!tk || !tk.refresh_token) { res.status(500).json({ ok: false, error: 'Google no conectado' }); return }
      const atR = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: gcid, client_secret: gsec, refresh_token: tk.refresh_token, grant_type: 'refresh_token' }) })
      const atJ: any = await atR.json()
      if (!atJ.access_token) { res.status(500).json({ ok: false, error: 'No se pudo renovar Google (reconecta con permiso de enviar correo)' }); return }
      const to = tk.email
      const subject = 'Tus pendientes y citas de hoy - OMM'
      const mime = [`To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8'].join('\r\n') + '\r\n\r\n' + html
      const raw = Buffer.from(mime, 'utf-8').toString('base64').split('+').join('-').split('/').join('_').split('=').join('')
      const sR = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${atJ.access_token}` }, body: JSON.stringify({ raw }) })
      if (!sR.ok) { const et = await sR.text(); console.error('[daily_brief] gmail send:', et.substring(0, 300)); res.status(sR.status).json({ ok: false, error: 'Gmail send: ' + et.substring(0, 200) }); return }
      res.status(200).json({ ok: true, enviado_a: to, total: items.length, vencidos: vencidos.length, hoy: deHoy.length, semana: semana.length })
      return
    } catch (e: any) { console.error('[daily_brief]', e && e.message); res.status(500).json({ ok: false, error: e.message }); return }
  }
  if (req.method === 'OPTIONS') return res.status(200).end()

  // ── Rutinas: sincronizar (la UI lo llama al crear/pausar/borrar una rutina; el cron 7am también corre esto) ──
  //   GET/POST /api/extract?action=rutinas_sync
  if (req.query && (req.query as any).action === 'rutinas_sync') {
    try {
      const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      const sUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
      if (!svcKey || !sUrl) return res.status(500).json({ ok: false, error: 'Faltan envs' })
      const out = await syncRutinas(sUrl, svcKey, process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET)
      return res.status(200).json({ ok: true, ...out })
    } catch (e: any) { return res.status(500).json({ ok: false, error: e.message }) }
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_KEY || process.env.VITE_ANTHROPIC_KEY
  if (!apiKey) return res.status(500).json({ ok: false, error: 'ANTHROPIC_KEY no configurada en el servidor' })

  // ═══════════════════════════════════════════════════════════════════════════
  // Captura de PROSPECTO desde screenshot (Atajo de iOS "Enviar a OMM").
  //   POST /api/extract?action=prospecto
  //   headers: { x-omm-token: <CAPTURE_TOKEN> }
  //   body: { image: base64, mediaType?: 'image/jpeg', text?: string }
  // Lee los datos de contacto con visión y crea la fila en `prospectos`.
  // ═══════════════════════════════════════════════════════════════════════════
  const isProspecto = (req.query?.action === 'prospecto') || (req.body && (req.body as any).action === 'prospecto')
  if (isProspecto) {
    let pbody: any = req.body
    if (typeof pbody === 'string') { try { pbody = JSON.parse(pbody) } catch { pbody = {} } }
    const token = (req.headers['x-omm-token'] as string) || pbody?.token || (req.query?.token as string)
    const expected = process.env.CAPTURE_TOKEN
    if (!expected || token !== expected) return res.status(401).json({ ok: false, error: 'Token invalido' })

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ ok: false, error: 'Supabase env vars no configuradas' })

    const { image, mediaType: mt, text } = (pbody || {}) as { image?: string; mediaType?: string; text?: string }
    if (!image && !text) { console.error('[prospecto] sin image/text; typeof req.body=', typeof req.body); return res.status(400).json({ ok: false, error: 'Falta image o text' }) }

    const shape = `{"nombre":"persona o despacho/estudio ('' si no hay)","empresa":"","telefono":"con lada si aparece, si no ''","email":"","instagram":"@handle o URL si aparece","web":"sitio si aparece","canal":"como/donde contactarlo (ej. 'Instagram @estudio','DM Instagram','pagina web','referido')","notas":"resumen: a que se dedican, ciudad, tipo de proyecto, # seguidores, etc."}`
    const instr = `Eres asistente comercial de OMM (integracion/automatizacion, iluminacion, audio, CCTV, cortinas para arquitectura de alto nivel). Del screenshot y/o texto de un posible cliente (arquitecto, despacho, interiorista), extrae sus datos de contacto. Devuelve EXCLUSIVAMENTE un objeto JSON (sin markdown) con esta forma:\n${shape}\n\nContexto:\n${text || '(sin texto, usa la imagen)'}`
    // Limpiar el base64: el Atajo de iOS mete saltos de línea y a veces prefijo data URL.
    let cleanImage = (image || '').replace(/\s/g, '')
    if (cleanImage.startsWith('data:')) { const c = cleanImage.indexOf(','); if (c > -1) cleanImage = cleanImage.slice(c + 1) }
    // Detectar el media_type real por los primeros bytes (evita mismatch png/jpeg).
    let realMedia = mt || 'image/jpeg'
    if (cleanImage.startsWith('iVBOR')) realMedia = 'image/png'
    else if (cleanImage.startsWith('/9j/')) realMedia = 'image/jpeg'
    else if (cleanImage.startsWith('UklGR')) realMedia = 'image/webp'
    else if (cleanImage.startsWith('R0lGOD')) realMedia = 'image/gif'
    const cnt: any[] = []
    if (cleanImage) cnt.push({ type: 'image', source: { type: 'base64', media_type: realMedia, data: cleanImage } })
    cnt.push({ type: 'text', text: instr })

    const cr = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: cnt }] }),
    })
    if (!cr.ok) return res.status(cr.status).json({ ok: false, error: 'Claude API: ' + (await cr.text()).substring(0, 300) })
    const cd = await cr.json()
    const tb = (cd.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    const m = tb.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)
    if (!m) return res.status(422).json({ ok: false, error: 'No se pudieron leer datos del screenshot' })
    let j: any
    try { j = JSON.parse(m[0]) } catch { return res.status(422).json({ ok: false, error: 'JSON invalido de la IA' }) }

    const canal = j.canal || [j.instagram, j.web].filter(Boolean).join(' · ') || null
    const row = {
      nombre: (j.nombre || '').trim() || (j.empresa || '').trim() || 'Prospecto sin nombre',
      empresa: (j.empresa || '').trim() || null,
      telefono: (j.telefono || '').trim() || null,
      email: (j.email || '').trim() || null,
      canal,
      notas: (j.notas || '').trim() || null,
      estado: 'por_contactar',
      prioridad: 2,
    }
    const ins = await fetch(`${supabaseUrl}/rest/v1/prospectos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=representation' },
      body: JSON.stringify(row),
    })
    if (!ins.ok) return res.status(ins.status).json({ ok: false, error: 'Supabase insert: ' + (await ins.text()).substring(0, 300) })
    const created = await ins.json()
    return res.status(200).json({ ok: true, prospecto: Array.isArray(created) ? created[0] : created })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Captura de PENDIENTE / CITA desde screenshot (Atajo iOS, típico WhatsApp).
  //   POST /api/extract?action=pendiente  → inserta en action_items (Mis pendientes)
  // ═══════════════════════════════════════════════════════════════════════════
  const isPendiente = (req.query?.action === 'pendiente') || (req.body && (req.body as any).action === 'pendiente')
  if (isPendiente) {
    let pb: any = req.body
    if (typeof pb === 'string') { try { pb = JSON.parse(pb) } catch { pb = {} } }
    const token = (req.headers['x-omm-token'] as string) || pb?.token || (req.query?.token as string)
    if (!process.env.CAPTURE_TOKEN || token !== process.env.CAPTURE_TOKEN) return res.status(401).json({ ok: false, error: 'Token invalido' })
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ ok: false, error: 'Supabase env vars no configuradas' })
    const { image, mediaType: mt, text } = (pb || {}) as { image?: string; mediaType?: string; text?: string }
    if (!image && !text) return res.status(400).json({ ok: false, error: 'Falta image o text' })
    let clean = (image || '').replace(/\s/g, '')
    if (clean.startsWith('data:')) { const c = clean.indexOf(','); if (c > -1) clean = clean.slice(c + 1) }
    let rm = mt || 'image/jpeg'
    if (clean.startsWith('iVBOR')) rm = 'image/png'
    else if (clean.startsWith('/9j/')) rm = 'image/jpeg'
    else if (clean.startsWith('UklGR')) rm = 'image/webp'
    else if (clean.startsWith('R0lGOD')) rm = 'image/gif'
    const hoy = new Date().toISOString().slice(0, 10)
    const shape = `{"tipo":"cita|pendiente","titulo":"resumen corto y accionable","fecha":"YYYY-MM-DD si aplica o ''","hora":"HH:MM en 24h si aplica o ''","persona":"con quien","lugar":"lugar si es cita o ''","notas":"detalle relevante"}`
    const instr = `Eres asistente de la Direccion General de OMM. Del screenshot (usualmente una conversacion de WhatsApp), identifica un PENDIENTE o una CITA que se deba registrar. Si hay fecha/hora concreta o se habla de reunirse, verse, visita o junta => tipo "cita". Si es una tarea por hacer => "pendiente". Hoy es ${hoy}; resuelve fechas relativas ("manana", "el jueves") a fecha absoluta. Devuelve EXCLUSIVAMENTE un JSON (sin markdown):\n${shape}\n\nContexto:\n${text || '(sin texto, usa la imagen)'}`
    const cnt: any[] = []
    if (clean) cnt.push({ type: 'image', source: { type: 'base64', media_type: rm, data: clean } })
    cnt.push({ type: 'text', text: instr })
    const cr = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 800, messages: [{ role: 'user', content: cnt }] }),
    })
    if (!cr.ok) return res.status(cr.status).json({ ok: false, error: 'Claude API: ' + (await cr.text()).substring(0, 300) })
    const cd = await cr.json()
    const tb = (cd.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    const m = tb.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)
    if (!m) return res.status(422).json({ ok: false, error: 'No se pudo leer el pendiente' })
    let j: any
    try { j = JSON.parse(m[0]) } catch { return res.status(422).json({ ok: false, error: 'JSON invalido' }) }
    const esCita = (j.tipo || '').toLowerCase() === 'cita'
    const desc = [esCita ? 'Cita' : '', j.persona ? `Con: ${j.persona}` : '', j.lugar ? `Lugar: ${j.lugar}` : '', j.notas || ''].filter(Boolean).join(' · ') || null
    const row: any = { title: (j.titulo || '').trim() || 'Pendiente', area: 'DG', source_type: 'dashboard', status: 'pendiente', priority: esCita ? 3 : 2, due_date: (j.fecha || '').trim() || null, due_time: (j.hora || '').trim() || null, description: desc, tags: esCita ? ['cita'] : ['pendiente'] }
    const ins = await fetch(`${supabaseUrl}/rest/v1/action_items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=representation' },
      body: JSON.stringify(row),
    })
    if (!ins.ok) return res.status(ins.status).json({ ok: false, error: 'Supabase insert: ' + (await ins.text()).substring(0, 300) })
    const created = await ins.json()
    const it = Array.isArray(created) ? created[0] : created

    // Si es cita con fecha → crear evento en Google Calendar (usa el mismo Google conectado para Gmail).
    let calendar: any = { creado: false }
    if (esCita && row.due_date) {
      try {
        const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        const gcid = process.env.GMAIL_CLIENT_ID, gsec = process.env.GMAIL_CLIENT_SECRET
        if (!svcKey || !gcid || !gsec) { calendar = { creado: false, error: 'Faltan credenciales de Google en el servidor' } }
        else {
          const tr = await fetch(`${supabaseUrl}/rest/v1/gmail_tokens?id=eq.default&select=refresh_token`, { headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` } })
          const trows: any = await tr.json()
          const refresh = Array.isArray(trows) && trows[0] && trows[0].refresh_token
          if (!refresh) { calendar = { creado: false, error: 'Google no conectado' } }
          else {
            const atr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: gcid, client_secret: gsec, refresh_token: refresh, grant_type: 'refresh_token' }) })
            const atj: any = await atr.json()
            if (!atj.access_token) { calendar = { creado: false, error: 'No se pudo renovar acceso de Google' } }
            else {
              const tz = 'America/Mexico_City'
              const ev: any = {
                summary: row.title,
                description: desc || undefined,
                location: (j.lugar || '') || undefined,
                reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 10 }] },
              }
              if (row.due_time) {
                const t = row.due_time.length === 5 ? row.due_time + ':00' : row.due_time
                const [hh, mm] = t.split(':').map((x: string) => parseInt(x, 10))
                let eh = hh + 1, em = mm
                if (eh > 23) { eh = 23; em = 59 }
                ev.start = { dateTime: `${row.due_date}T${t}`, timeZone: tz }
                ev.end = { dateTime: `${row.due_date}T${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`, timeZone: tz }
              } else {
                const next = new Date(new Date(row.due_date + 'T00:00:00').getTime() + 86400000).toISOString().slice(0, 10)
                ev.start = { date: row.due_date }
                ev.end = { date: next }
              }
              const evr = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${atj.access_token}` }, body: JSON.stringify(ev) })
              if (evr.ok) { const evj: any = await evr.json(); calendar = { creado: true, htmlLink: evj.htmlLink } }
              else { calendar = { creado: false, error: 'Calendar: ' + (await evr.text()).substring(0, 160) } }
            }
          }
        }
      } catch (e: any) { calendar = { creado: false, error: e.message } }
    }

    if (esCita && row.due_date && !calendar.creado) console.error('[cita/calendar] NO creado:', JSON.stringify(calendar))
    return res.status(200).json({ ok: true, tipo: esCita ? 'cita' : 'pendiente', titulo: row.title, fecha: row.due_date, hora: row.due_time, persona: j.persona || '', lugar: j.lugar || '', calendar, item: it })
  }

  // ── Cobranza: respuesta del cliente desde screenshot (Atajo iOS) ──
  //   POST /api/extract?action=cobranza  → clasifica + liga a obra + guarda seguimiento
  const isCobranza = (req.query?.action === 'cobranza') || (req.body && (req.body as any).action === 'cobranza')
  if (isCobranza) {
    let pb: any = req.body
    if (typeof pb === 'string') { try { pb = JSON.parse(pb) } catch { pb = {} } }
    const token = (req.headers['x-omm-token'] as string) || pb?.token || (req.query?.token as string)
    if (!process.env.CAPTURE_TOKEN || token !== process.env.CAPTURE_TOKEN) return res.status(401).json({ ok: false, error: 'Token invalido' })
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const sUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    if (!svcKey || !sUrl) return res.status(500).json({ ok: false, error: 'Supabase env vars no configuradas' })
    const { image, mediaType: mt, text } = (pb || {}) as { image?: string; mediaType?: string; text?: string }
    if (!image && !text) return res.status(400).json({ ok: false, error: 'Falta image o text' })
    let clean = (image || '').replace(/\s/g, '')
    if (clean.startsWith('data:')) { const c = clean.indexOf(','); if (c > -1) clean = clean.slice(c + 1) }
    let rm = mt || 'image/jpeg'
    if (clean.startsWith('iVBOR')) rm = 'image/png'
    else if (clean.startsWith('/9j/')) rm = 'image/jpeg'
    else if (clean.startsWith('UklGR')) rm = 'image/webp'
    else if (clean.startsWith('R0lGOD')) rm = 'image/gif'
    const hoyC = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10)
    const shapeC = `{"cliente":"nombre de la persona/contacto del chat","estado":"promesa_pago|pidio_info|objecion|sin_respuesta|pagado|otro","resumen":"que dijo el cliente en 1 linea","fecha_promesa":"YYYY-MM-DD si prometio pagar en fecha, si no ''","monto_prometido":"numero si menciona monto, si no ''","proximo_paso":"que deberia hacer OMM ahora","proxima_fecha":"YYYY-MM-DD para el siguiente seguimiento si aplica o ''"}`
    const instrC = `Eres asistente de cobranza de OMM. Del screenshot de una conversacion (usualmente WhatsApp) con un cliente sobre un pago/cobro, extrae el estado y el siguiente paso. Hoy es ${hoyC}; resuelve fechas relativas. Devuelve EXCLUSIVAMENTE un JSON:\n${shapeC}\n\nContexto:\n${text || '(sin texto, usa la imagen)'}`
    const cntC: any[] = []
    if (clean) cntC.push({ type: 'image', source: { type: 'base64', media_type: rm, data: clean } })
    cntC.push({ type: 'text', text: instrC })
    const crC = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 700, messages: [{ role: 'user', content: cntC }] }) })
    if (!crC.ok) return res.status(crC.status).json({ ok: false, error: 'Claude API: ' + (await crC.text()).substring(0, 300) })
    const cdC = await crC.json()
    const tbC = (cdC.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    const mC = tbC.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)
    if (!mC) return res.status(422).json({ ok: false, error: 'No se pudo leer la conversacion' })
    let jc: any
    try { jc = JSON.parse(mC[0]) } catch { return res.status(422).json({ ok: false, error: 'JSON invalido' }) }
    const norm = (x: any) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    const HC: any = { apikey: svcKey, Authorization: `Bearer ${svcKey}` }
    const [lr, ob] = await Promise.all([
      fetch(`${sUrl}/rest/v1/leads?select=id,name,contact_name`, { headers: HC }).then(r => r.json()),
      fetch(`${sUrl}/rest/v1/cobranza_obra?select=lead_id,contactos`, { headers: HC }).then(r => r.json()),
    ])
    const aliasByLead: Record<string, string> = {}
    if (Array.isArray(ob)) ob.forEach((o: any) => { if (o.lead_id) aliasByLead[o.lead_id] = o.contactos || '' })
    const cli = norm(jc.cliente)
    let leadId: string | null = null, leadName: string | null = null
    if (cli && Array.isArray(lr)) {
      // Scoring: alias explicito (contactos) > match completo de nombre > 2+ palabras compartidas.
      // Una sola palabra compartida (ej. "jose") NO basta — mejor "Sin asignar" que obra equivocada.
      const cliWords = cli.split(' ').filter((w: string) => w.length > 3)
      let best: { id: string; name: string; score: number } | null = null
      for (const l of lr) {
        const alias = norm(aliasByLead[l.id])
        let score = 0
        if (alias && (alias.includes(cli) || cli.includes(alias) || alias.split(' ').some((w: string) => w.length > 3 && cliWords.includes(w)))) score = 100
        else {
          for (const h of [norm(l.name), norm(l.contact_name)]) {
            if (!h) continue
            if (h.includes(cli) || (cli.length > 7 && cli.includes(h))) { score = Math.max(score, 50); continue }
            const hw = h.split(' ')
            const shared = cliWords.filter((w: string) => hw.includes(w)).length
            if (shared >= 2) score = Math.max(score, 20)
          }
        }
        if (score > 0 && l.id in aliasByLead) score += 10 // obra activa en cobranza
        if (score > (best ? best.score : 0)) best = { id: l.id, name: l.name, score }
      }
      if (best && best.score >= 20) { leadId = best.id; leadName = best.name }
    }
    const rowC: any = {
      lead_id: leadId,
      cliente_nombre: jc.cliente || null,
      tipo: 'whatsapp',
      contenido: jc.resumen || null,
      estado: jc.estado || 'otro',
      fecha_promesa_pago: (jc.fecha_promesa || '').trim() || null,
      monto_prometido: jc.monto_prometido && !isNaN(Number(jc.monto_prometido)) ? Number(jc.monto_prometido) : null,
      proximo_paso: jc.proximo_paso || null,
      proxima_fecha: (jc.proxima_fecha || '').trim() || null,
    }
    const insC = await fetch(`${sUrl}/rest/v1/cobranza_seguimiento`, { method: 'POST', headers: { ...HC, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(rowC) })
    if (!insC.ok) return res.status(insC.status).json({ ok: false, error: 'Supabase insert: ' + (await insC.text()).substring(0, 300) })
    const createdC = await insC.json()
    return res.status(200).json({ ok: true, matched: !!leadId, obra: leadName, cliente: jc.cliente || '', estado: rowC.estado, proximo_paso: rowC.proximo_paso, proxima_fecha: rowC.proxima_fecha, seguimiento: Array.isArray(createdC) ? createdC[0] : createdC })
  }

  try {
    const { kind, payload, mediaType, context } = req.body as { kind: string; payload: string; mediaType?: string; context?: string }
    if (!kind || !payload) return res.status(400).json({ ok: false, error: 'Faltan parámetros kind/payload' })

    // Pick prompt by context — 'cortinas' uses CortItem schema, anything else uses generic
    const PROMPT = context === 'cortinas' ? PROMPT_CORTINAS : PROMPT_GENERIC

    let content: any[]
    if (kind === 'text') {
      content = [{ type: 'text', text: PROMPT + '\n\nContenido del archivo:\n' + payload.substring(0, 30000) }]
    } else if (kind === 'pdf') {
      content = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: payload } },
        { type: 'text', text: PROMPT },
      ]
    } else if (kind === 'image') {
      content = [
        { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/png', data: payload } },
        { type: 'text', text: PROMPT },
      ]
    } else {
      return res.status(400).json({ ok: false, error: 'kind inválido (text|pdf|image)' })
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content }],
      }),
    })

    if (!r.ok) {
      const errText = await r.text()
      return res.status(r.status).json({ ok: false, error: 'Claude API: ' + errText.substring(0, 500) })
    }

    const data = await r.json()
    const textBlocks = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    const cleaned = textBlocks.replace(/```json|```/g, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(500).json({ ok: false, error: 'Claude no devolvió JSON parseable', raw: cleaned.substring(0, 500) })

    let parsed: any
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: 'JSON inválido: ' + e.message, raw: jsonMatch[0].substring(0, 500) })
    }

    return res.status(200).json({
      ok: true,
      items: parsed.items || [],
      extras: parsed.extras || [],
      meta: parsed.meta || {},
      confidence: parsed.confidence || 'medium',
      warnings: parsed.warnings || [],
    })
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' })
  }
}

// redeploy: activar CAPTURE_TOKEN (2026-08-11T14:45:49Z)

// redeploy: activar CRON_SECRET (2026-08-11T17:28:27Z)
