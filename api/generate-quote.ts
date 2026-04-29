// Vercel serverless function — genera una cotización ESP completa desde un scope estructurado
// Input: { scope, catalog, precedents }
// Output: { ok, areas: [{name, items:[{...}]}], warnings, confidence }

import type { VercelRequest, VercelResponse } from '@vercel/node'

const SYSTEM_PROMPT = `Eres un ingeniero experto en instalaciones especiales (AV, redes, CCTV, control de acceso, control de iluminación, detección de humo, BMS, telefonía, cortinas motorizadas) que trabaja para OMM Technologies en CDMX. Tu tarea es proponer una cotización completa para un proyecto nuevo.

REGLAS CRÍTICAS:
1. PRIORIZA productos del catálogo real que se te pasa. Cada item debe incluir catalog_product_id si viene del catálogo.
2. Si el catálogo no tiene un producto adecuado, puedes SUGERIR uno nuevo con datos genéricos (sin inventar marca/modelo específicos). En ese caso, marca el item con is_new_suggestion=true y llena marca/modelo con descripciones genéricas tipo "Access Point WiFi 6", "Cámara IP domo 4MP exterior", "Switch PoE 24 puertos". NO inventes marcas específicas como "Ubiquiti U7 Pro" a menos que estén en el catálogo.
3. Usa los PRECEDENTES (cotizaciones previas similares) como guía para elegir qué productos usar, qué cantidades típicas, y qué áreas considerar.
4. Organiza por ÁREAS. Los nombres de áreas deben ser específicos al tipo de proyecto (residencial: "Sala", "Recámara Principal", "Cocina", "Oficina"; hotel: "Lobby", "Habitación Tipo A", "Restaurante"; corporativo: "Sala de Juntas", "Open Office", "Recepción"). Siempre incluye "SITE" para equipos de cuarto técnico (switches, UPS, rack).
5. Sé CONSERVADOR en cantidades. Un access point cubre ~80 m², una cámara por acceso/perímetro, un keypad de iluminación por área.
6. Los nombres de sistemas DEBEN ser uno de: "Audio", "Redes", "CCTV", "Control de Acceso", "Control de Iluminación", "Detección de Humo", "BMS", "Telefonía", "Red Celular".

FORMATO DE RESPUESTA — JSON estricto, sin markdown, sin texto extra:
{
  "areas": [
    {
      "name": "Nombre del área",
      "items": [
        {
          "catalog_product_id": "uuid-del-catalogo-o-null",
          "is_new_suggestion": false,
          "marca": "marca exacta del catálogo o genérica",
          "modelo": "modelo exacto del catálogo o descripción genérica",
          "system": "Audio|Redes|CCTV|...",
          "description": "descripción corta del producto",
          "quantity": 1,
          "notes": "por qué se incluye este producto"
        }
      ]
    }
  ],
  "rationale": "Explicación breve (2-3 frases) de la lógica general: qué proyecto es, qué precedentes influyeron, qué supuestos hiciste.",
  "warnings": ["Advertencias si el catálogo no cubría algo importante"]
}

NO incluyas mano de obra ni items type='labor' — solo materiales. La mano de obra se calcula automáticamente desde el pricing.`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_KEY || process.env.VITE_ANTHROPIC_KEY
  if (!apiKey) return res.status(500).json({ ok: false, error: 'ANTHROPIC_KEY no configurada en el servidor' })

  try {
    const { scope, catalog, precedents } = req.body as {
      scope: any
      catalog: any[]
      precedents: any[]
    }
    if (!scope) return res.status(400).json({ ok: false, error: 'Falta scope' })

    // Construir el mensaje del usuario con todo el contexto
    const catalogCompact = (catalog || []).map((p: any) =>
      `${p.id} | ${p.marca || '-'} ${p.modelo || ''} | ${p.name} | ${p.system || '-'} | ${p.provider || '-'} | ${p.moneda || 'USD'} ${p.cost || 0}`
    ).join('\n')

    const precedentsCompact = (precedents || []).map((p: any) => {
      const header = `=== ${p.name} (${p.specialty}, total: ${p.total})${p.rationale ? ' - ' + p.rationale : ''} ===`
      const itemsByArea: Record<string, string[]> = {}
      ;(p.items || []).forEach((it: any) => {
        const areaName = p.areaNameById?.[it.area_id] || 'Sin área'
        if (!itemsByArea[areaName]) itemsByArea[areaName] = []
        itemsByArea[areaName].push(`  ${it.quantity}x ${it.name} [${it.system || 'General'}]`)
      })
      const areasSummary = Object.entries(itemsByArea).map(([area, items]) =>
        `ÁREA: ${area}\n${items.join('\n')}`
      ).join('\n')
      return header + '\n' + areasSummary
    }).join('\n\n')

    const userMessage = `SCOPE DEL PROYECTO NUEVO:
${JSON.stringify(scope, null, 2)}

CATÁLOGO DISPONIBLE (${catalog?.length || 0} productos):
id | marca modelo | nombre | sistema | proveedor | moneda costo
${catalogCompact || '(catálogo vacío)'}

PRECEDENTES (${precedents?.length || 0} cotizaciones previas similares):
${precedentsCompact || '(sin precedentes)'}

Genera la cotización completa en JSON según el formato especificado.`

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
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
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

    // Validar y sanitizar
    const areas = Array.isArray(parsed.areas) ? parsed.areas : []
    const catalogIds = new Set((catalog || []).map((p: any) => p.id))
    const sanitizedAreas = areas.map((a: any, ai: number) => ({
      name: String(a.name || ('Área ' + (ai + 1))).trim(),
      items: (Array.isArray(a.items) ? a.items : []).map((it: any) => {
        const catId = it.catalog_product_id && catalogIds.has(it.catalog_product_id) ? it.catalog_product_id : null
        return {
          catalog_product_id: catId,
          is_new_suggestion: !!it.is_new_suggestion || !catId,
          marca: String(it.marca || '').trim(),
          modelo: String(it.modelo || '').trim(),
          system: String(it.system || 'Audio').trim(),
          description: String(it.description || '').trim(),
          quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
          notes: String(it.notes || '').trim(),
        }
      }).filter((it: any) => it.marca || it.modelo || it.description),
    })).filter((a: any) => a.items.length > 0)

    return res.status(200).json({
      ok: true,
      areas: sanitizedAreas,
      rationale: String(parsed.rationale || '').trim(),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    })
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' })
  }
}
