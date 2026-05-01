// Vercel serverless — AI-powered Memoria Técnica generator
// Receives quotation data, calls Claude to produce structured technical documentation
// Returns JSON with sections: alcance, fichas_tecnicas, topologia, consideraciones

import type { VercelRequest, VercelResponse } from '@vercel/node'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ubbumxommqjcpdozpunf.supabase.co'
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViYnVteG9tbXFqY3Bkb3pwdW5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwODA3MzAsImV4cCI6MjA5MDY1NjczMH0.GPKeRgjzjZ96Qo6lYMHKF68YK4y6ZmexvORsNT8VGns'

const SYSTEM_PROMPT = `Eres un ingeniero senior de OMM Technologies (CDMX), especialista en documentación técnica de proyectos de instalaciones especiales, iluminación y eléctricos.

Tu tarea es generar una MEMORIA TÉCNICA DESCRIPTIVA profesional a partir de los datos de una cotización cerrada.

═══════════════════════════════════════════════════
ESTRUCTURA DEL DOCUMENTO
═══════════════════════════════════════════════════

Debes producir un JSON con esta estructura exacta:

{
  "alcance": {
    "titulo_proyecto": "string",
    "descripcion_general": "Párrafo(s) describiendo el proyecto, su ubicación, y alcance general",
    "cliente": "string",
    "sistemas_incluidos": ["lista de sistemas"],
    "resumen_ejecutivo": "2-3 párrafos resumiendo los sistemas, su propósito y beneficios"
  },
  "fichas_tecnicas": [
    {
      "system": "Audio|Redes|CCTV|etc",
      "system_description": "Párrafo describiendo el propósito del sistema en este proyecto",
      "productos": [
        {
          "nombre": "string",
          "marca": "string",
          "modelo": "string",
          "descripcion_tecnica": "Descripción técnica detallada del equipo (2-4 oraciones). Si conoces el producto, incluye specs reales. Si no, describe funcionalidad general basándote en el nombre/marca/modelo.",
          "specs": {
            "key": "value"
          },
          "funcion_en_proyecto": "Para qué se usa este equipo en el proyecto",
          "cantidad_total": 0,
          "areas": ["lista de áreas donde se instala"],
          "imagen_url": "string|null",
          "notas_instalacion": "Notas específicas de montaje/instalación si aplica"
        }
      ]
    }
  ],
  "topologia": [
    {
      "system": "string",
      "titulo": "Diagrama de [sistema]",
      "descripcion": "Párrafo describiendo la topología general del sistema",
      "mermaid_diagram": "Código Mermaid válido para el diagrama de conexión. Usa graph TD o graph LR. Incluye todos los equipos con sus conexiones lógicas. Usa nombres cortos para los nodos y etiquetas descriptivas en los enlaces.",
      "notas_topologia": ["Notas adicionales sobre la topología"]
    }
  ],
  "consideraciones": [
    {
      "system": "string",
      "titulo": "Consideraciones de instalación — [sistema]",
      "requerimientos_electricos": "Descripción de requerimientos eléctricos (voltaje, circuitos dedicados, protecciones, etc.)",
      "canalizacion": "Tipo de canalización recomendada, rutas, ductos",
      "puntos_datos": "Requerimientos de puntos de datos, cableado estructurado, fibra óptica si aplica",
      "montaje": "Notas específicas de montaje (alturas, soportes, brackets, etc.)",
      "integracion": "Cómo se integra con otros sistemas del proyecto",
      "notas_adicionales": ["Cualquier nota adicional relevante"]
    }
  ],
  "notas_generales": [
    "Notas generales que aplican a todos los sistemas (tierra física, UPS, cuarto técnico, etc.)"
  ]
}

═══════════════════════════════════════════════════
REGLAS DE GENERACIÓN
═══════════════════════════════════════════════════

1. DIAGRAMAS MERMAID:
   - Usa graph TD (top-down) para diagramas de sistemas con jerarquía (redes, audio, CCTV)
   - Usa graph LR (left-right) para sistemas lineales o de cadena
   - Agrupa dispositivos por área/zona cuando tenga sentido
   - Cada nodo debe tener un ID corto y un label descriptivo entre corchetes
   - Incluye la dirección del flujo de datos/señal con flechas etiquetadas
   - Ejemplo para Redes:
     graph TD
       ISP[ISP / WAN] -->|Fibra| FW[Firewall/Router]
       FW -->|1Gbps| SW_CORE[Switch Core 24P]
       SW_CORE -->|PoE| AP1[AP WiFi - Sala]
       SW_CORE -->|PoE| AP2[AP WiFi - Recámara]
       SW_CORE --> NVR[NVR Grabador]
       SW_CORE -->|Trunk| SW2[Switch Secundario]

2. FICHAS TÉCNICAS:
   - Si conoces el producto por marca/modelo, incluye specs reales (voltaje, potencia, protocolos, dimensiones)
   - Si no conoces el producto específico, genera specs genéricas razonables basadas en el tipo de equipo
   - Marca las specs como "consultado" (las conoces) vs "estimado" (inferido) usando un campo "specs_source"
   - Agrupa productos por sistema, no por área

3. CONSIDERACIONES DE INSTALACIÓN:
   - Sé específico: voltajes, calibres de cable, tipos de conector, distancias máximas
   - Incluye normativas mexicanas relevantes (NOM) cuando aplique
   - Menciona integración entre sistemas cuando exista (ej: CCTV necesita puntos de red del sistema de Redes)

4. TOPOLOGÍA:
   - El diagrama debe reflejar los equipos REALES de la cotización, no genéricos
   - Muestra conexiones físicas (cables, PoE) y lógicas (protocolos, señal)
   - Incluye cuarto técnico / rack / concentrador principal como punto central

5. ESPECIALIDADES:
   - Para ILUMINACIÓN: incluye cálculos de iluminación si hay watts/lumens, tipos de driver, protocolos de control (DALI, 0-10V, DMX), zonas de control
   - Para ELÉCTRICO: incluye tableros, circuitos, protecciones, normas NOM
   - Para ESPECIALES: incluye cada subsistema con su topología independiente

RESPONDE SOLO CON EL JSON. Sin texto adicional, sin markdown. El JSON debe empezar con { y terminar con }.`

export const config = { maxDuration: 300 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_KEY || process.env.VITE_ANTHROPIC_KEY
  if (!apiKey) return res.status(500).json({ ok: false, error: 'ANTHROPIC_KEY no configurada' })

  try {
    const { quotationId } = req.body as { quotationId: string }
    if (!quotationId) return res.status(400).json({ ok: false, error: 'Falta quotationId' })

    // ── Load all quotation data from Supabase ──
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    }

    const [cotRes, areasRes, itemsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/quotations?id=eq.${quotationId}&select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/quotation_areas?quotation_id=eq.${quotationId}&order=order_index`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/quotation_items?quotation_id=eq.${quotationId}&order=order_index`, { headers }),
    ])

    const [cotData, areasData, itemsData] = await Promise.all([cotRes.json(), areasRes.json(), itemsRes.json()])

    if (!cotData || cotData.length === 0) return res.status(404).json({ ok: false, error: 'Cotización no encontrada' })

    const cot = cotData[0]
    const areas: { id: string; name: string; order_index: number }[] = areasData || []
    const items: any[] = itemsData || []

    // ── Load catalog products for items that have catalog_product_id ──
    const catalogIds = [...new Set(items.filter(i => i.catalog_product_id).map(i => i.catalog_product_id))]
    let catalogProducts: any[] = []
    if (catalogIds.length > 0) {
      const catRes = await fetch(
        `${SUPABASE_URL}/rest/v1/catalog_products?id=in.(${catalogIds.map(id => `"${id}"`).join(',')})&select=*`,
        { headers }
      )
      catalogProducts = await catRes.json() || []
    }
    const catalogMap: Record<string, any> = {}
    for (const p of catalogProducts) catalogMap[p.id] = p

    // ── Load lead info if available ──
    let leadName = '', leadCompany = ''
    try {
      const notes = JSON.parse(cot.notes || '{}')
      if (notes.lead_id) {
        const leadRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${notes.lead_id}&select=name,company`, { headers })
        const leads = await leadRes.json()
        if (leads && leads[0]) {
          leadName = leads[0].name || ''
          leadCompany = leads[0].company || ''
        }
      }
    } catch (e) { /* ignore */ }

    // ── Build the context for Claude ──
    const areaMap: Record<string, string> = {}
    for (const a of areas) areaMap[a.id] = a.name

    // Group items by system
    const bySystem: Record<string, any[]> = {}
    for (const it of items) {
      if (it.type === 'labor') continue // skip labor items
      const sys = it.system || 'General'
      if (!bySystem[sys]) bySystem[sys] = []
      const cat = it.catalog_product_id ? catalogMap[it.catalog_product_id] : null
      bySystem[sys].push({
        nombre: it.name,
        descripcion: it.description || '',
        marca: it.marca || cat?.marca || '',
        modelo: it.modelo || cat?.modelo || '',
        sku: it.sku || cat?.sku || '',
        area: areaMap[it.area_id] || 'Sin área',
        cantidad: Number(it.quantity) || 1,
        precio: Number(it.price) || 0,
        imagen: it.image_url || cat?.image_url || null,
        // Technical fields from catalog
        watts: cat?.watts || null,
        lumens: cat?.lumens || null,
        cct: cat?.cct || null,
        cri: cat?.cri || null,
        ip_rating: cat?.ip_rating || null,
        mounting_type: cat?.mounting_type || null,
        provider: it.provider || cat?.provider || '',
        cat_description: cat?.description || '',
        cat_subdescripcion: cat?.subdescripcion || '',
      })
    }

    const systemsText = Object.entries(bySystem).map(([sys, sysItems]) => {
      const header = `\n══ SISTEMA: ${sys} (${sysItems.length} productos) ══`
      const lines = sysItems.map(it => {
        let line = `  - ${it.cantidad}x ${it.marca} ${it.modelo} | ${it.nombre}`
        if (it.descripcion) line += ` | ${it.descripcion}`
        line += ` | Área: ${it.area}`
        if (it.watts) line += ` | ${it.watts}W`
        if (it.lumens) line += ` | ${it.lumens}lm`
        if (it.cct) line += ` | ${it.cct}K`
        if (it.cri) line += ` | CRI ${it.cri}`
        if (it.ip_rating) line += ` | IP${it.ip_rating}`
        if (it.mounting_type) line += ` | Montaje: ${it.mounting_type}`
        if (it.imagen) line += ` | IMG: ${it.imagen}`
        if (it.cat_description) line += ` | CatDesc: ${it.cat_description}`
        if (it.provider) line += ` | Proveedor: ${it.provider}`
        return line
      }).join('\n')
      return header + '\n' + lines
    }).join('\n')

    const areasText = areas.map(a => {
      const areaItems = items.filter(i => i.area_id === a.id && i.type !== 'labor')
      return `  ${a.name}: ${areaItems.length} equipos`
    }).join('\n')

    let notes: any = {}
    try { notes = JSON.parse(cot.notes || '{}') } catch (e) { /* ignore */ }

    const userMessage = `GENERA LA MEMORIA TÉCNICA para la siguiente cotización:

PROYECTO: ${cot.name}
CLIENTE: ${cot.client_name || leadName || 'No especificado'}
ARQUITECTO/DESPACHO: ${leadCompany || 'No especificado'}
ESPECIALIDAD: ${cot.specialty === 'esp' ? 'Instalaciones Especiales' : cot.specialty === 'ilum' ? 'Iluminación' : cot.specialty === 'elec' ? 'Eléctrico' : cot.specialty === 'proy' ? 'Proyecto Integral' : cot.specialty}
MONEDA: ${notes.currency || 'USD'}
TOTAL: $${Number(cot.total || 0).toLocaleString()}

ÁREAS DEL PROYECTO (${areas.length}):
${areasText}

EQUIPOS POR SISTEMA:
${systemsText}

Genera la memoria técnica completa con las 4 secciones: alcance, fichas_tecnicas, topologia, y consideraciones.
Para los diagramas Mermaid, usa los equipos REALES listados arriba — no genéricos.
Si conoces las specs de un producto por su marca/modelo, inclúyelas. Si no, genera specs razonables.`

    console.log(`[memoria-tecnica] Generating for ${cot.name} (${Object.keys(bySystem).length} systems, ${items.length} items)`)

    // ── Call Claude API ──
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      console.error('[memoria-tecnica] Claude API error:', claudeRes.status, errText)
      return res.status(500).json({ ok: false, error: `Claude API error: ${claudeRes.status}` })
    }

    const claudeData = await claudeRes.json()
    const responseText = claudeData.content?.[0]?.text || ''

    // Parse the JSON response
    let memoria: any
    try {
      // Try to extract JSON from the response (in case Claude wraps it)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in response')
      memoria = JSON.parse(jsonMatch[0])
    } catch (parseErr: any) {
      console.error('[memoria-tecnica] Failed to parse Claude response:', parseErr.message)
      console.error('[memoria-tecnica] Raw response:', responseText.substring(0, 500))
      return res.status(500).json({ ok: false, error: 'Error parseando respuesta de IA', raw: responseText.substring(0, 1000) })
    }

    // Attach quotation metadata
    memoria._meta = {
      quotation_id: quotationId,
      quotation_name: cot.name,
      client_name: cot.client_name || leadName,
      architect: leadCompany,
      specialty: cot.specialty,
      total: cot.total,
      currency: notes.currency || 'USD',
      generated_at: new Date().toISOString(),
    }

    return res.status(200).json({ ok: true, memoria })

  } catch (err: any) {
    console.error('[memoria-tecnica] Error:', err)
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' })
  }
}
