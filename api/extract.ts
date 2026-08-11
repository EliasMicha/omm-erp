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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-omm-token')
  if (req.method === 'OPTIONS') return res.status(200).end()
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
    const token = (req.headers['x-omm-token'] as string) || (req.body as any)?.token || (req.query?.token as string)
    const expected = process.env.CAPTURE_TOKEN
    if (!expected || token !== expected) return res.status(401).json({ ok: false, error: 'Token invalido' })

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ ok: false, error: 'Supabase env vars no configuradas' })

    const { image, mediaType: mt, text } = (req.body || {}) as { image?: string; mediaType?: string; text?: string }
    if (!image && !text) return res.status(400).json({ ok: false, error: 'Falta image o text' })

    const shape = `{"nombre":"persona o despacho/estudio ('' si no hay)","empresa":"","telefono":"con lada si aparece, si no ''","email":"","instagram":"@handle o URL si aparece","web":"sitio si aparece","canal":"como/donde contactarlo (ej. 'Instagram @estudio','DM Instagram','pagina web','referido')","notas":"resumen: a que se dedican, ciudad, tipo de proyecto, # seguidores, etc."}`
    const instr = `Eres asistente comercial de OMM (integracion/automatizacion, iluminacion, audio, CCTV, cortinas para arquitectura de alto nivel). Del screenshot y/o texto de un posible cliente (arquitecto, despacho, interiorista), extrae sus datos de contacto. Devuelve EXCLUSIVAMENTE un objeto JSON (sin markdown) con esta forma:\n${shape}\n\nContexto:\n${text || '(sin texto, usa la imagen)'}`
    const cnt: any[] = []
    if (image) cnt.push({ type: 'image', source: { type: 'base64', media_type: mt || 'image/jpeg', data: image } })
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
      nombre: (j.nombre || '').trim() || 'Prospecto sin nombre',
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
