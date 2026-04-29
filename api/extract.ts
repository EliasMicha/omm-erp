// Vercel serverless function — extrae items de cotización desde archivos usando Claude API
// Recibe: { kind: 'text'|'pdf'|'image', payload: string, mediaType?: string }
// Devuelve: { ok: boolean, items?: any[], confidence?: string, warnings?: string[], error?: string }

import type { VercelRequest, VercelResponse } from '@vercel/node'

const PROMPT = `Eres un asistente experto en listados de productos para instalaciones especiales (audio, redes, CCTV, control de acceso, control de iluminación, detección de humo, BMS, telefonía, red celular, cortinas/persianas).

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_KEY || process.env.VITE_ANTHROPIC_KEY
  if (!apiKey) return res.status(500).json({ ok: false, error: 'ANTHROPIC_KEY no configurada en el servidor' })

  try {
    const { kind, payload, mediaType } = req.body as { kind: string; payload: string; mediaType?: string }
    if (!kind || !payload) return res.status(400).json({ ok: false, error: 'Faltan parámetros kind/payload' })

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
        'anthropic-version': '2025-04-14',
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
      confidence: parsed.confidence || 'medium',
      warnings: parsed.warnings || [],
    })
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' })
  }
}
