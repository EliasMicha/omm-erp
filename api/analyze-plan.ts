// Vercel serverless function — analiza plano PDF con AI para generar propuesta de sembrado
// Input: { plan (base64 PDF/image), mediaType, scope, catalog, precedents }
// Output: { ok, areas: [{name, description, items:[...]}], rationale, warnings }

import type { VercelRequest, VercelResponse } from '@vercel/node'

const SYSTEM_PROMPT = `Eres un ingeniero senior de OMM Technologies (CDMX), experto en instalaciones especiales: audio/video, redes/telecomunicaciones, CCTV/seguridad, control de acceso, control de iluminación (Lutron, KNX), detección de incendio, BMS, telefonía IP, red celular (DAS), y cortinas motorizadas (Somfy).

Tu tarea es analizar un PLANO ARQUITECTÓNICO y, combinado con el SCOPE del cliente y el CATÁLOGO de productos disponibles, generar una propuesta completa de sembrado (equipos por área).

PROCESO DE ANÁLISIS:
1. EXTRAER ÁREAS: Identifica todas las áreas/espacios del plano (recámaras, salas, cocina, baños, pasillos, cuarto técnico, exterior, etc.). Estima m² aproximados si es posible.
2. ENTENDER EL SCOPE: El cliente especifica qué sistemas quiere. Solo propón equipos de los sistemas solicitados.
3. ASIGNAR EQUIPOS: Para cada área, propón los equipos necesarios de cada sistema solicitado, priorizando productos del catálogo real.
4. USAR PRECEDENTES: Las cotizaciones previas te muestran qué productos y cantidades se han usado en proyectos similares. Úsalas como referencia.

REGLAS CRÍTICAS:
- PRIORIZA productos del catálogo real. Cada item debe incluir catalog_product_id si viene del catálogo.
- Si el catálogo no tiene un producto adecuado, sugiere uno con is_new_suggestion=true. NO inventes marcas/modelos específicos — usa descripciones genéricas ("Access Point WiFi 6", "Cámara domo 4MP exterior").
- Sé CONSERVADOR en cantidades: 1 AP WiFi por ~80m², 1 cámara por acceso/perímetro, 1 bocina por área de audio, 1 keypad de iluminación por área.
- Siempre incluye un área "SITE / Cuarto Técnico" para equipos centrales (switches, NVR, rack, UPS, controladores).
- Los sistemas válidos son: "Audio", "Redes", "CCTV", "Control de Acceso", "Control de Iluminación", "Detección de Humo", "BMS", "Telefonía", "Red Celular", "Cortinas".
- NO incluyas mano de obra — solo materiales.
- Si el plano tiene múltiples niveles/plantas, organiza las áreas por nivel.

FORMATO DE RESPUESTA — JSON estricto, sin markdown, sin texto extra:
{
  "areas": [
    {
      "name": "Nombre del área",
      "level": "PB|PA|Nivel 2|Sótano|Exterior|etc.",
      "estimated_m2": 25,
      "description": "Breve descripción del espacio según el plano",
      "items": [
        {
          "catalog_product_id": "uuid-del-catalogo-o-null",
          "is_new_suggestion": false,
          "marca": "marca exacta del catálogo o genérica",
          "modelo": "modelo exacto del catálogo o descripción genérica",
          "system": "Audio|Redes|CCTV|...",
          "description": "descripción corta del producto y su función en esta área",
          "quantity": 1,
          "notes": "justificación de por qué se incluye y la cantidad elegida"
        }
      ]
    }
  ],
  "plan_summary": "Descripción del proyecto según el plano: tipo de inmueble, niveles, m² totales estimados, distribución general.",
  "rationale": "Lógica general de la propuesta: qué precedentes influyeron, qué supuestos se hicieron, qué sistemas se priorizaron.",
  "warnings": ["Advertencias: áreas del plano difíciles de leer, productos no encontrados en catálogo, etc."]
}`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_KEY || process.env.VITE_ANTHROPIC_KEY
  if (!apiKey) return res.status(500).json({ ok: false, error: 'ANTHROPIC_KEY no configurada en el servidor' })

  try {
    const { plan, mediaType, scope, catalog, precedents } = req.body as {
      plan: string
      mediaType?: string
      scope: { projectType: string; systems: string[]; notes: string; clientName?: string }
      catalog: { id: string; name: string; marca?: string; modelo?: string; system?: string; provider?: string; moneda?: string; cost?: number; description?: string }[]
      precedents: { name: string; specialty: string; total: number; items: { area_name: string; name: string; system: string; quantity: number; marca?: string; modelo?: string }[] }[]
    }

    if (!plan) return res.status(400).json({ ok: false, error: 'Falta el plano (plan)' })
    if (!scope) return res.status(400).json({ ok: false, error: 'Falta el scope' })

    // Detectar si es PDF o imagen por el mediaType o por el contenido base64
    const isPdf = (mediaType || '').includes('pdf') || plan.substring(0, 10).includes('JVBER')
    const isImage = (mediaType || '').startsWith('image/')

    // Construir el documento visual para Claude
    let planContent: Record<string, unknown>
    if (isPdf) {
      planContent = {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: plan },
      }
    } else if (isImage) {
      planContent = {
        type: 'image',
        source: { type: 'base64', media_type: mediaType || 'image/png', data: plan },
      }
    } else {
      // Intentar como PDF por defecto
      planContent = {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: plan },
      }
    }

    // Compactar catálogo para no exceder tokens
    const catalogCompact = (catalog || [])
      .map((p) => `${p.id} | ${p.marca || '-'} ${p.modelo || ''} | ${p.name} | ${p.system || '-'} | ${p.provider || '-'} | ${p.moneda || 'USD'} ${p.cost || 0}`)
      .join('\n')

    // Compactar precedentes
    const precedentsCompact = (precedents || [])
      .map((p) => {
        const header = `=== ${p.name} (${p.specialty}, total: $${p.total}) ===`
        const itemLines = (p.items || [])
          .map((it) => `  ${it.area_name}: ${it.quantity}x ${it.marca || ''} ${it.modelo || ''} ${it.name} [${it.system}]`)
          .join('\n')
        return header + '\n' + itemLines
      })
      .join('\n\n')

    const userMessage = `PLANO ARQUITECTÓNICO: (adjunto como documento visual — analiza todas las áreas, niveles y distribución)

SCOPE DEL CLIENTE:
- Tipo de proyecto: ${scope.projectType}
- Sistemas solicitados: ${scope.systems.join(', ')}
- Cliente: ${scope.clientName || 'No especificado'}
- Notas adicionales: ${scope.notes || 'Ninguna'}

CATÁLOGO DISPONIBLE (${catalog?.length || 0} productos):
id | marca modelo | nombre | sistema | proveedor | moneda costo
${catalogCompact || '(catálogo vacío)'}

PRECEDENTES (${precedents?.length || 0} cotizaciones previas similares):
${precedentsCompact || '(sin precedentes)'}

Analiza el plano, identifica todas las áreas, y genera la propuesta completa de sembrado en JSON según el formato especificado.`

    const messages = [
      {
        role: 'user',
        content: [
          planContent,
          { type: 'text', text: userMessage },
        ],
      },
    ]

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 12000,
        system: SYSTEM_PROMPT,
        messages,
      }),
    })

    if (!r.ok) {
      const errText = await r.text()
      return res.status(r.status).json({ ok: false, error: 'Claude API: ' + errText.substring(0, 500) })
    }

    const data = await r.json()
    const textBlocks = (data.content || [])
      .filter((b: Record<string, unknown>) => b.type === 'text')
      .map((b: Record<string, unknown>) => b.text)
      .join('\n')
    const cleaned = textBlocks.replace(/```json|```/g, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return res.status(500).json({ ok: false, error: 'Claude no devolvió JSON parseable', raw: cleaned.substring(0, 500) })
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'parse error'
      return res.status(500).json({ ok: false, error: 'JSON inválido: ' + msg, raw: jsonMatch[0].substring(0, 500) })
    }

    // Validar y sanitizar áreas
    const areas = Array.isArray(parsed.areas) ? parsed.areas : []
    const catalogIds = new Set((catalog || []).map((p) => p.id))

    const sanitizedAreas = areas.map((a: Record<string, unknown>, ai: number) => ({
      name: String(a.name || 'Área ' + (ai + 1)).trim(),
      level: String(a.level || '').trim(),
      estimated_m2: Number(a.estimated_m2) || null,
      description: String(a.description || '').trim(),
      items: (Array.isArray(a.items) ? a.items : [])
        .map((it: Record<string, unknown>) => {
          const catId = it.catalog_product_id && catalogIds.has(String(it.catalog_product_id))
            ? String(it.catalog_product_id)
            : null
          return {
            catalog_product_id: catId,
            is_new_suggestion: !!it.is_new_suggestion || !catId,
            marca: String(it.marca || '').trim(),
            modelo: String(it.modelo || '').trim(),
            system: String(it.system || '').trim(),
            description: String(it.description || '').trim(),
            quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
            notes: String(it.notes || '').trim(),
          }
        })
        .filter((it: Record<string, unknown>) => it.marca || it.modelo || it.description),
    })).filter((a: Record<string, unknown>) => Array.isArray(a.items) && (a.items as unknown[]).length > 0)

    return res.status(200).json({
      ok: true,
      areas: sanitizedAreas,
      plan_summary: String(parsed.plan_summary || '').trim(),
      rationale: String(parsed.rationale || '').trim(),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno'
    return res.status(500).json({ ok: false, error: msg })
  }
}
