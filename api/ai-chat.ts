// Vercel serverless — multi-turn AI chat for OMM quote generation
// Supports: scope-only, scope+plan, and follow-up conversation
// The AI can ask clarifying questions OR produce a final JSON proposal
// Design rules are loaded DYNAMICALLY from Supabase design_rules table

import type { VercelRequest, VercelResponse } from '@vercel/node'

// Supabase config for fetching design rules
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ubbumxommqjcpdozpunf.supabase.co'
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViYnVteG9tbXFqY3Bkb3pwdW5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwODA3MzAsImV4cCI6MjA5MDY1NjczMH0.GPKeRgjzjZ96Qo6lYMHKF68YK4y6ZmexvORsNT8VGns'

// Static framework — everything except the per-system rules
const PROMPT_FRAMEWORK_TOP = `Eres un ingeniero de diseño de OMM Technologies (CDMX), empresa de instalaciones especiales para proyectos residenciales y comerciales.

Tu trabajo es ayudar a generar una propuesta de sembrado (equipos por área) basándote en:
1. El SCOPE del cliente (tipo de proyecto, sistemas, nivel, notas).
2. Un PLANO ARQUITECTÓNICO si se adjunta (analízalo visualmente para identificar áreas).
3. El CATÁLOGO real de productos de OMM.
4. COTIZACIONES PREVIAS como referencia.

═══════════════════════════════════════════════════
FLUJO DE CONVERSACIÓN
═══════════════════════════════════════════════════

PASO 1 — ANÁLISIS INICIAL:
Cuando recibas el scope (y opcionalmente un plano), analiza todo y responde con:
- Un resumen de lo que entendiste del proyecto.
- Preguntas específicas si hay ambigüedades o información faltante.
- Si tienes suficiente información, produce la propuesta directamente.

PASO 2 — PREGUNTAS Y RESPUESTAS:
Si haces preguntas, el usuario responderá. Incorpora las respuestas y:
- Haz más preguntas si necesitas, O
- Produce la propuesta final.

PASO 3 — PROPUESTA FINAL:
Cuando estés listo, produce la propuesta en el formato JSON especificado abajo.

PASO 4 — SEMBRADO (POSICIONAMIENTO EN PLANO):
Si el usuario adjuntó un plano arquitectónico, DEBES incluir coordenadas de posición para cada dispositivo.
Analiza el plano con mucho cuidado:
- Identifica las paredes, puertas, ventanas, y mobiliario de cada habitación.
- Para BOCINAS DE PLAFÓN: colócalas centradas en el techo de cada habitación, distribuidas uniformemente. Si son 2, ponlas a 1/3 y 2/3 del largo. Si son 4, distribúyelas en cuadrícula.
- Para CÁMARAS: en esquinas con mejor ángulo de visión, apuntando hacia accesos/áreas críticas.
- Para DETECTORES DE HUMO: centrados en el plafón de cada habitación.
- Para BOTONERAS/KEYPADS: junto a la puerta de entrada de cada habitación, del lado del picaporte (generalmente a 10-15cm del marco).
- Para LECTORES BIOMÉTRICOS/ACCESO: junto a puertas de acceso controlado.
- Para NODOS DE RED: en muros cerca de donde irá el escritorio/TV/mueble multimedia.
- Para PERSIANAS: sobre el dintel de cada ventana que tenga persiana.
- Para EQUIPOS DE RACK: todos en el cuarto técnico/rack.
Las coordenadas son PORCENTAJES (0-100) relativas al plano completo: x=0 es borde izquierdo, x=100 borde derecho, y=0 es borde superior, y=100 borde inferior.

IMPORTANTE: Cuando estés CONVERSANDO (haciendo preguntas, dando resumen), responde en texto normal en español.
Cuando produzcas la PROPUESTA FINAL, responde SOLO con un bloque JSON que empiece con {"areas": y siga el formato exacto.

═══════════════════════════════════════════════════
PROCESO DE ANÁLISIS (así trabaja OMM)
═══════════════════════════════════════════════════

1. RECORRIDO DESDE LA ENTRADA: Primero recorre mentalmente la casa/edificio desde la puerta principal para entender la distribución completa: áreas sociales, privadas, de servicio, exteriores, y cuarto técnico.
2. IDENTIFICAR TODAS LAS ÁREAS del plano con nombres específicos. Estima m² si es posible.
3. SISTEMA POR SISTEMA: Luego, para cada sistema que el scope solicita, recorre TODAS las áreas decidiendo qué equipo va dónde.
4. SOLO cotiza los sistemas que aparecen en el scope. NO agregues sistemas que el cliente no pidió.
5. USA LOS PRECEDENTES como referencia de qué productos y cantidades se han usado en proyectos similares.

═══════════════════════════════════════════════════
NIVEL DEL PROYECTO
═══════════════════════════════════════════════════

El nivel lo define el arquitecto/scope del proyecto:
- HIGH-END / PREMIUM: Lutron Homeworks, equipos premium en todo.
- ALTO: Lutron RadioRA 3 con buenos acabados.
- MEDIO: Lutron RadioRA 3, buenos equipos pero optimizando.
- BAJO/ECONÓMICO / BÁSICO: Lutron Caseta, equipos funcionales al menor costo.

Si el scope no indica nivel, asume MEDIO.`

const PROMPT_FRAMEWORK_BOTTOM = `
═══════════════════════════════════════════════════
REGLAS DE CATÁLOGO Y PRODUCTOS
═══════════════════════════════════════════════════

- PRIORIZA productos del catálogo real que se te pasa. Cada item debe incluir catalog_product_id si viene del catálogo.
- Si el catálogo no tiene un producto adecuado, sugiere uno con is_new_suggestion=true. En ese caso usa descripciones genéricas, NO inventes modelos que no existen.
- Los sistemas válidos son: "Audio", "Redes", "CCTV", "Control de Acceso", "Control de Iluminación", "Detección de Humo", "BMS", "Telefonía", "Red Celular", "Cortinas".
- NO incluyas mano de obra — solo materiales.
- Si el plano tiene múltiples niveles/plantas, organiza las áreas por nivel.

═══════════════════════════════════════════════════
FORMATO DE PROPUESTA FINAL (JSON)
═══════════════════════════════════════════════════

Cuando tengas TODA la información necesaria y estés listo para proponer, responde con un JSON que empiece exactamente con {"areas": — sin texto antes ni después, sin markdown:

{
  "areas": [
    {
      "name": "Nombre del área",
      "level": "PB|PA|Nivel 2|Sótano|Exterior|etc.",
      "estimated_m2": 25,
      "description": "Breve descripción del espacio",
      "items": [
        {
          "catalog_product_id": "uuid-del-catalogo-o-null",
          "is_new_suggestion": false,
          "marca": "marca exacta del catálogo o genérica",
          "modelo": "modelo exacto del catálogo o descripción genérica",
          "system": "Audio|Redes|CCTV|...",
          "description": "descripción corta del producto y su función",
          "quantity": 1,
          "notes": "justificación",
          "positions": [
            {"x": 35.2, "y": 22.8, "label": "NPS-BCN.01", "height": "Plafón"}
          ]
        }
      ]
    }
  ],
  "plan_summary": "Descripción del proyecto",
  "rationale": "Lógica general de la propuesta",
  "warnings": ["Advertencias o supuestos"]
}

NOTA SOBRE POSITIONS:
- El campo "positions" es un ARRAY. Debe tener tantas entradas como indica "quantity".
  Ejemplo: si quantity=4, positions debe tener 4 objetos {x, y, label, height}.
- "x" e "y" son porcentajes (0-100) de la posición en el plano. ANALIZA EL PLANO con precisión.
- "label" es el código de nomenclatura que se mostrará junto al símbolo (e.g., "NPS-BCN.01").
- "height" es la altura de instalación (e.g., "Plafón", "1.10m", "Muro", "0.30 MTS").
- Si NO hay plano adjunto, omite el campo "positions" completamente.
- Si SÍ hay plano, SIEMPRE incluye "positions" con coordenadas precisas para TODOS los dispositivos.

Si estás CONVERSANDO (preguntas, resumen, comentarios), responde en texto normal en español. NUNCA mezcles texto y JSON en la misma respuesta.`

// Fetch design rules from Supabase and format as prompt section
async function fetchDesignRules(nivel?: string): Promise<string> {
  try {
    const url = `${SUPABASE_URL}/rest/v1/design_rules?is_active=eq.true&order=system.asc,priority.desc`
    const r = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
    })
    if (!r.ok) {
      console.error('Failed to fetch design_rules:', r.status, await r.text())
      return '(No se pudieron cargar las reglas de diseño desde la base de datos)'
    }
    const rules: { system: string; category: string; rule_title: string; rule_text: string; applies_to: string[]; priority: number }[] = await r.json()

    // Filter by nivel if provided
    const filtered = rules.filter(rule => {
      if (!rule.applies_to || rule.applies_to.length === 0) return true // empty = applies to all
      if (!nivel) return true // no nivel specified = show all
      return rule.applies_to.includes(nivel)
    })

    // Group by system
    const bySystem: Record<string, typeof filtered> = {}
    for (const rule of filtered) {
      if (!bySystem[rule.system]) bySystem[rule.system] = []
      bySystem[rule.system].push(rule)
    }

    // Format as prompt text
    let text = '\n═══════════════════════════════════════════════════\nREGLAS POR SISTEMA (cargadas dinámicamente)\n═══════════════════════════════════════════════════\n'
    for (const [system, systemRules] of Object.entries(bySystem)) {
      text += `\n── ${system.toUpperCase()} ──\n`
      for (const rule of systemRules) {
        text += `\n${rule.rule_title}:\n${rule.rule_text}\n`
      }
    }
    return text
  } catch (err) {
    console.error('Error fetching design_rules:', err)
    return '(Error cargando reglas de diseño)'
  }
}

// Build the full system prompt with dynamic rules
async function buildSystemPrompt(nivel?: string): Promise<string> {
  const dynamicRules = await fetchDesignRules(nivel)
  return PROMPT_FRAMEWORK_TOP + dynamicRules + PROMPT_FRAMEWORK_BOTTOM
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_KEY || process.env.VITE_ANTHROPIC_KEY
  if (!apiKey) return res.status(500).json({ ok: false, error: 'ANTHROPIC_KEY no configurada en el servidor' })

  try {
    const { messages, scope, plan, planMediaType, catalog, precedents } = req.body as {
      messages: { role: 'user' | 'assistant'; content: string }[]
      scope: {
        tipo: string
        nombre: string
        cliente: string
        tamano_m2: number | null
        habitaciones: number | null
        ubicacion: string
        nivel: string
        sistemas: string[]
        areas_custom: string
        notas: string
        freetext?: string
      }
      plan?: string // base64
      planMediaType?: string
      catalog: { id: string; name: string; marca?: string; modelo?: string; system?: string; provider?: string; moneda?: string; cost?: number; description?: string }[]
      precedents: { name: string; specialty: string; total: number; items: { area_name: string; name: string; system: string; quantity: number; marca?: string; modelo?: string }[] }[]
    }

    if (!messages || messages.length === 0) {
      return res.status(400).json({ ok: false, error: 'Falta messages[]' })
    }

    // Build catalog compact
    const catalogCompact = (catalog || [])
      .map((p) => `${p.id} | ${p.marca || '-'} ${p.modelo || ''} | ${p.name} | ${p.system || '-'} | ${p.provider || '-'} | ${p.moneda || 'USD'} ${p.cost || 0}`)
      .join('\n')

    // Build precedents compact
    const precedentsCompact = (precedents || [])
      .map((p) => {
        const header = `=== ${p.name} (${p.specialty}, total: $${p.total}) ===`
        const itemLines = (p.items || [])
          .map((it) => `  ${it.area_name}: ${it.quantity}x ${it.marca || ''} ${it.modelo || ''} ${it.name} [${it.system}]`)
          .join('\n')
        return header + '\n' + itemLines
      })
      .join('\n\n')

    // Build the context block that goes into the first user message
    const scopeBlock = scope.freetext
      ? `SCOPE (texto libre del cliente/arquitecto):\n${scope.freetext}`
      : `SCOPE DEL PROYECTO:
- Tipo: ${scope.tipo || 'No especificado'}
- Nombre: ${scope.nombre || 'No especificado'}
- Cliente: ${scope.cliente || 'No especificado'}
- Tamaño: ${scope.tamano_m2 ? scope.tamano_m2 + ' m²' : 'No especificado'}
- Recámaras/habitaciones: ${scope.habitaciones || 'No especificado'}
- Ubicación: ${scope.ubicacion || 'No especificada'}
- Nivel: ${scope.nivel || 'medio'}
- Sistemas: ${scope.sistemas?.join(', ') || 'No especificados'}
- Áreas específicas: ${scope.areas_custom || 'No especificadas'}
- Notas: ${scope.notas || 'Ninguna'}`

    const contextBlock = `${scopeBlock}

CATÁLOGO DISPONIBLE (${catalog?.length || 0} productos):
id | marca modelo | nombre | sistema | proveedor | moneda costo
${catalogCompact || '(catálogo vacío)'}

PRECEDENTES (${precedents?.length || 0} cotizaciones previas):
${precedentsCompact || '(sin precedentes)'}`

    // Build Claude messages array
    // First message always includes the context + plan
    const claudeMessages: any[] = []

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      if (i === 0 && msg.role === 'user') {
        // First user message: inject context + optional plan
        const content: any[] = []

        // Add plan document if exists
        if (plan) {
          const isPdf = (planMediaType || '').includes('pdf') || plan.substring(0, 10).includes('JVBER')
          if (isPdf) {
            content.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: plan },
            })
          } else {
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: planMediaType || 'image/png', data: plan },
            })
          }
        }

        // Add context + user message
        content.push({
          type: 'text',
          text: `${contextBlock}\n\n${plan ? 'PLANO ARQUITECTÓNICO: adjunto arriba — analiza todas las áreas, niveles y distribución.\n\n' : ''}${msg.content}`,
        })

        claudeMessages.push({ role: 'user', content })
      } else {
        // Subsequent messages: plain text
        claudeMessages.push({ role: msg.role, content: msg.content })
      }
    }

    // Build system prompt with dynamic rules from Supabase
    const systemPrompt = await buildSystemPrompt(scope?.nivel)

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
        system: systemPrompt,
        messages: claudeMessages,
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

    // Detect if the response is a JSON proposal or a conversational message
    const trimmed = textBlocks.trim()
    const jsonMatch = trimmed.match(/^\s*\{[\s\S]*"areas"\s*:\s*\[[\s\S]*\}\s*$/)

    if (jsonMatch) {
      // It's a proposal — parse and validate
      try {
        const parsed = JSON.parse(trimmed.replace(/```json|```/g, '').trim())
        const catalogIds = new Set((catalog || []).map((p) => p.id))

        const sanitizedAreas = (parsed.areas || []).map((a: any, ai: number) => ({
          name: String(a.name || 'Área ' + (ai + 1)).trim(),
          level: String(a.level || '').trim(),
          estimated_m2: Number(a.estimated_m2) || null,
          description: String(a.description || '').trim(),
          items: (Array.isArray(a.items) ? a.items : []).map((it: any) => {
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
              quantity: Math.max(1, parseInt(String(it.quantity)) || 1),
              notes: String(it.notes || '').trim(),
            }
          }),
        }))

        return res.status(200).json({
          ok: true,
          type: 'proposal',
          text: trimmed,
          areas: sanitizedAreas,
          plan_summary: parsed.plan_summary || '',
          rationale: parsed.rationale || '',
          warnings: parsed.warnings || [],
        })
      } catch {
        // Failed to parse as JSON — treat as conversation
        return res.status(200).json({
          ok: true,
          type: 'message',
          text: trimmed,
        })
      }
    } else {
      // It's a conversational message
      return res.status(200).json({
        ok: true,
        type: 'message',
        text: trimmed,
      })
    }
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' })
  }
}
