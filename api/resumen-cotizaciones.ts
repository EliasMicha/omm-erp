// Vercel serverless — AI-powered quotation comparison & summary
// Receives quotation data with items, calls Claude to produce a structured comparison
// Returns JSON with sections: resumen_ejecutivo, comparativa, diferencias, recomendacion

import type { VercelRequest, VercelResponse } from '@vercel/node'

const SYSTEM_PROMPT = `Eres un consultor comercial senior de OMM Technologies (CDMX), empresa de instalaciones especiales (audio, redes, CCTV, iluminación, control de acceso, automatización, etc.).

Tu tarea es analizar múltiples cotizaciones de un mismo lead/proyecto y generar un RESUMEN COMPARATIVO EJECUTIVO.

═══════════════════════════════════════════════════
OBJETIVO
═══════════════════════════════════════════════════

El resumen debe ayudar al equipo comercial a:
1. Entender rápidamente qué cubre cada cotización
2. Identificar diferencias clave entre cotizaciones
3. Ver los totales y márgenes de cada una
4. Decidir cuál presentar al cliente o cómo combinarlas

═══════════════════════════════════════════════════
FORMATO DE RESPUESTA
═══════════════════════════════════════════════════

RESPONDE ÚNICAMENTE con JSON válido (sin markdown, sin texto adicional):

{
  "resumen_ejecutivo": "2-3 párrafos describiendo el panorama general: cuántas cotizaciones hay, qué especialidades cubren, el rango de inversión, y observaciones generales.",
  "cotizaciones": [
    {
      "nombre": "nombre de la cotización",
      "especialidad": "ESP|ILUM|PROY",
      "etapa": "oportunidad|contrato|etc",
      "moneda": "USD|MXN",
      "subtotal": 0,
      "total_con_iva": 0,
      "sistemas": ["Audio", "Redes"],
      "areas_count": 0,
      "items_count": 0,
      "productos_principales": ["Lutron RA3 Procesador", "Sonos Amp"],
      "marcas_destacadas": ["Lutron", "Sonos"],
      "observaciones": "Breve nota sobre esta cotización"
    }
  ],
  "comparativa": {
    "sistemas_en_comun": ["sistemas que aparecen en más de una cotización"],
    "sistemas_unicos": { "Cotización A": ["sistemas solo en A"], "Cotización B": ["sistemas solo en B"] },
    "diferencias_clave": [
      "Diferencia importante 1 — ej: 'La cotización ESP incluye CCTV con 8 cámaras Hikvision, mientras que la ILUM no cubre seguridad'",
      "Diferencia importante 2"
    ],
    "productos_diferentes": [
      "Si hay productos similares pero de diferente marca/modelo entre cotizaciones, mencionarlo"
    ]
  },
  "recomendacion": "1-2 párrafos con recomendación: cuál presentar, si combinarlas, qué falta por cotizar, etc. Sé práctico y directo."
}

REGLAS:
- Los totales deben coincidir con los datos proporcionados, no inventes números
- Sé conciso pero completo
- Si solo hay 2 cotizaciones, enfócate en las diferencias
- Si hay más de 2, agrupa por similitudes
- Identifica si alguna cotización tiene áreas/zonas sin equipos (vacías)
- Menciona los márgenes si puedes calcularlos (markup promedio)
- SOLO JSON, sin texto adicional`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { quotations, items, leadName } = req.body || {}
  if (!quotations?.length || !items?.length) {
    return res.status(400).json({ error: 'Se necesitan cotizaciones e items' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })

  try {
    // Build data summary for the AI
    const quotSummaries = quotations.map((q: any) => {
      const qItems = items.filter((i: any) => i.quotation_id === q.id)
      const systems = [...new Set(qItems.map((i: any) => i.system).filter(Boolean))]
      const areas = [...new Set(qItems.map((i: any) => i.area_name || i.area_id).filter(Boolean))]
      const totalCost = qItems.reduce((s: number, i: any) => s + (Number(i.cost) || 0) * (Number(i.quantity) || 1), 0)
      const totalPrice = qItems.reduce((s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0)
      const totalWithInstall = qItems.reduce((s: number, i: any) => s + (Number(i.total) || 0), 0)

      return {
        id: q.id,
        nombre: q.name,
        especialidad: q.specialty,
        etapa: q.stage,
        moneda: (() => {
          try { const n = JSON.parse(q.notes || '{}'); return n.currency || 'MXN' } catch { return 'MXN' }
        })(),
        subtotal: Math.round(totalWithInstall),
        total_iva: Math.round(totalWithInstall * 1.16),
        total_items: qItems.length,
        total_areas: areas.length,
        sistemas: systems,
        items: qItems.map((i: any) => ({
          area: i.area_name || 'Sin área',
          sistema: i.system || 'Sin sistema',
          nombre: i.name || `${i.marca || ''} ${i.modelo || ''}`.trim(),
          marca: i.marca || '',
          modelo: i.modelo || '',
          cantidad: i.quantity || 1,
          precio: Number(i.price) || 0,
          costo: Number(i.cost) || 0,
          total: Number(i.total) || 0,
          markup: Number(i.markup) || 0,
        })),
      }
    })

    const userMessage = `Lead: ${leadName || 'Sin nombre'}
Número de cotizaciones: ${quotSummaries.length}

${quotSummaries.map((q: any, i: number) => `
═══ COTIZACIÓN ${i + 1}: "${q.nombre}" ═══
Especialidad: ${q.especialidad}
Etapa: ${q.etapa}
Moneda: ${q.moneda}
Subtotal (sin IVA): ${q.moneda === 'USD' ? 'US$' : '$'}${q.subtotal.toLocaleString()}
Total (con IVA): ${q.moneda === 'USD' ? 'US$' : '$'}${q.total_iva.toLocaleString()}
Áreas: ${q.total_areas}
Items: ${q.total_items}
Sistemas: ${q.sistemas.join(', ') || 'Ninguno'}

Items detallados:
${q.items.map((it: any) => `  • [${it.sistema}] ${it.area}: ${it.nombre} x${it.cantidad} — ${q.moneda === 'USD' ? 'US$' : '$'}${it.precio}/u (costo: ${it.costo}, markup: ${it.markup}%)`).join('\n')}
`).join('\n')}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Claude API error:', errText)
      return res.status(500).json({ error: 'Error de IA: ' + response.status })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''

    // Extract JSON
    let result
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      result = JSON.parse(jsonMatch?.[0] || text)
    } catch {
      return res.status(500).json({ error: 'Error parseando respuesta de IA', raw: text })
    }

    return res.status(200).json(result)
  } catch (err: any) {
    console.error('resumen-cotizaciones error:', err)
    return res.status(500).json({ error: err.message || 'Error interno' })
  }
}
