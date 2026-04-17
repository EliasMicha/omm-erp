// Vercel serverless — multi-turn AI chat for OMM quote generation
// Supports: scope-only, scope+plan, and follow-up conversation
// The AI can ask clarifying questions OR produce a final JSON proposal

import type { VercelRequest, VercelResponse } from '@vercel/node'

const SYSTEM_PROMPT = `Eres un ingeniero de diseño de OMM Technologies (CDMX), empresa de instalaciones especiales para proyectos residenciales y comerciales.

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

Si el scope no indica nivel, asume MEDIO.

═══════════════════════════════════════════════════
REGLAS POR SISTEMA
═══════════════════════════════════════════════════

── REDES (Ubiquiti UniFi, proveedor Syscom) ──

ACCESS POINTS — REGLA CLAVE: OMM es generoso con APs porque se instalan escondidos detrás de TVs o muebles, lo cual baja su rendimiento. Por eso se pone más de lo que un cálculo teórico sugeriría.
- 1 AP por CADA recámara (detrás de la TV de esa recámara).
- 1 AP por área social grande (sala/comedor comparten 1, family/estudio si existe otro).
- Áreas exteriores (terraza, jardín): 1 AP outdoor solo si es área grande; en terraza de depto chico puede cubrirla el AP de sala.
- Los APs van escondidos detrás de TVs o muebles — NUNCA visibles en techo/pared en residencial.
- Ejemplo depto 3 recámaras + sala: 4 APs indoor (sala, rec1, rec2, rec ppal).

CABLEADO POR UBICACIÓN DE TV — esto es fundamental, OMM cablea todo:
- Cada ubicación de TV lleva: 3-4 cables UTP Cat6 + 1 cable coaxial RG6.
  • UTP 1: TV
  • UTP 2: dispositivo de streaming (Apple TV, Roku, etc.)
  • UTP 3: Access Point (el AP se esconde aquí)
  • UTP 4: reserva/spare
  • Coaxial: por si requieren TV por cable coaxial
- En ÁREAS DE SERVICIO (cuarto de lavado, baño de servicio): solo 2 UTP + 1 coaxial.
- Ubicaciones de TV típicas: sala/family, CADA recámara. La cocina normalmente NO lleva TV.
- CADA cable UTP termina en el SITE con un jack en patch panel, y en el destino con una placa de jacks (faceplate) con jacks keystone modulares.

ACCESORIOS DE RED (incluir SIEMPRE):
- Patch panel(s) en SITE: dimensionado al total de cables UTP (ej: 4 TVs × 4 UTP = 16 puertos mínimo).
- Patch cords (cables cortos) en SITE: 1 por cada puerto activo del patch panel al switch.
- Placas de jacks (faceplates) en cada ubicación de TV: placa de 4 puertos con jacks keystone + 1 coax.
- Jacks keystone Cat6: cantidad = total de terminaciones UTP × 2 (un jack en cada extremo del cable).
- Patch cords de usuario: 1-2 por ubicación de TV (para conectar TV y streaming device).

SWITCH PoE:
- Dimensionar al TOTAL de puertos necesarios: todos los UTP del patch panel + APs + cámaras si hay CCTV + margen.
- Ejemplo: 4 TVs × 4 UTP = 16 puertos + 4 APs PoE = switch de 24 puertos mínimo.
- Para proyectos grandes: preferir 2× switches de 24 en vez de 1× de 48 (redundancia).
- Switch va en el SITE/rack.

GATEWAY:
- UDM (UniFi Dream Machine) o USG en SITE. El UDM puede ser el router + controller.
- 1 por proyecto.

── AUDIO (Sonos cuando NO hay sistema de integración) ──
- Marca principal: Sonos (Amp + bocinas de plafón). Si el scope indica un sistema de integración diferente, la amplificación cambia.
- Bocinas SIEMPRE en pares: 2 o 4 por área.

ZONAS DE AUDIO y cómo agrupar en Amps:
- 1 Sonos Amp alimenta hasta 4 bocinas y es 1 ZONA de audio.
- Áreas contiguas pueden compartir Amp si están en la misma zona lógica. Ejemplo: sala + comedor = 4 bocinas (2+2) en 1 Amp = 1 zona.
- Terraza = Amp separado (zona independiente, bocinas outdoor).
- Baño principal = Amp separado si el scope lo pide (zona independiente).
- Calcular: número de Amps = número de zonas de audio.

ÁREAS QUE SIEMPRE LLEVAN AUDIO (si el scope incluye audio):
- Sala, comedor, terraza, jardín (áreas sociales).
- La cocina lleva audio si está abierta/integrada con sala-comedor.

ÁREAS QUE LLEVAN AUDIO SOLO SI EL SCOPE LO PIDE:
- Recámaras, baños, vestidores. El baño de la recámara principal es común si el scope lo sugiere.
- Vestidores: 1 bocina por vestidor (no par). 2 vestidores + baño principal = 4 bocinas en 1 Amp (1 zona compartida).

FAMILY ROOM / MEDIA ROOM — regla especial:
- Cuando hay un family room, media room o sala de TV dedicada, el default es Sonos Arc (soundbar) + Sonos Sub.
- NO bocinas de plafón en family/media — el Arc + Sub reemplaza el audio de esa zona.
- Si el proyecto es high-end, considerar agregar surrounds (Sonos Era 300 o similar).
- El Arc se monta debajo de la TV del family. El Sub va en piso junto al mueble de TV.

ÁREAS DE SERVICIO: NUNCA llevan audio (cuarto de lavado, baño de servicio, vestíbulo de servicios).

── CCTV ──
- Departamentos: Cámaras WiFi (Ring, Nest) — pocas, solo entrada y balcón.
- Casas: Hikvision — cámaras IP cableadas + NVR.
- UBICACIONES TÍPICAS en casa: entrada principal, cochera/garage, jardín trasero, acceso de servicio. Solo perímetro y accesos.
- Interior SOLO si el cliente lo pide explícitamente.
- NVR dimensionado al número de cámaras, en el SITE.
- Incluir disco duro para el NVR (calcular 1TB por cada 4 cámaras para ~30 días de grabación).

── CONTROL DE ILUMINACIÓN (siempre Lutron) ──

LÍNEA SEGÚN NIVEL DEL PROYECTO:

  ▸ HIGH-END / PREMIUM: Lutron Homeworks QS
    Procesador: HQP7-2
    Botoneras: Palladiom HQWT-U-P4W-SN (4 botones) en cada punto de transición
    Módulos dimmer/switch (serie LQSE, 4 zonas por módulo):
      • LQSE-4A1-D — cargas BAJAS atenuables (LEDs de baja potencia, tiras LED 12V/24V) — el más común
      • LQSE-4A5-120 — cargas ALTAS atenuables (circuitos de mayor potencia, 120V)
      • LQSE-4S8-120 — cargas switch ON/OFF (no dimeables)
      • LQSE-2DAL-120 — cargas DALI (2 zonas por módulo, para drivers DALI)
    Paneles para resguardar módulos:
      • PD8-59F-120 — panel de 8 módulos CON espacio para cerebro HQP7-2 y fuente. SIEMPRE se necesita 1.
      • PD9-59F-120 — panel de 9 módulos (expansión).
      • PD4-16F — panel de 4 módulos (expansión pequeña).
    SIZING DE PANELES:
      1. Contar zonas totales del plano de iluminación (etiquetas Z-XXX = 1 zona = 1 circuito).
      2. Zonas ÷ 4 = módulos LQSE necesarios (redondear arriba).
      3. Siempre 1× PD8 (para cerebro + fuente + 8 módulos). El resto en PD9 y/o PD4 según cantidad.
      4. Dejar 2-3 slots de reserva.
      Ejemplo: 90 zonas → ~23 módulos → 1× PD8 (8) + 2× PD9 (18) = 26 slots, sobran 3 de reserva.
    DISTRIBUCIÓN DE MÓDULOS POR TIPO (regla fija):
      - 45% LQSE-4A5-120 (cargas altas atenuables)
      - 45% LQSE-4A1-D (cargas bajas atenuables)
      - 10% LQSE-4S8-120 (cargas switch ON/OFF)
      - LQSE-2DAL-120 solo si el plano indica explícitamente cargas DALI (ojo: 2 zonas por módulo, no 4)
      Ejemplo 23 módulos: 10× LQSE-4A5-120 + 10× LQSE-4A1-D + 3× LQSE-4S8-120

  ▸ MEDIO / ALTO: Lutron RadioRA 3
    Procesador: RA3 (procesador RadioRA 3)
    Keypads: Sunnata y/o Pico remotes
    Dimmers: in-wall RadioRA 3 dimmers/switches (1 por circuito, instalados en caja de pared)
    No usa paneles centralizados — cada dimmer va distribuido en la pared de su área.

  ▸ BAJO/ECONÓMICO / BÁSICO: Lutron Caseta
    Bridge: Smart Bridge Pro
    Dimmers: Caseta in-wall dimmers (1 por circuito)
    Remotes: Pico (controles inalámbricos pequeños para puntos secundarios)
    No usa paneles centralizados — todo distribuido.

REGLA CLAVE DE COLOCACIÓN DE BOTONERAS/KEYPADS:
- Van en los PUNTOS DE TRANSICIÓN — donde sales de una zona y entras a otra. Piensa dónde pondrías la mano al caminar.
- Ejemplo recámara principal high-end: 1 Palladiom en la entrada, 1 a cada lado de la cama (2), 1 en la entrada del baño, 1 en la entrada del vestidor Sr, 1 en la entrada del vestidor Sra = 6 puntos.
- Ejemplo sala: 1 Palladiom/keypad en cada acceso (desde pasillo, desde comedor, desde terraza).
- Cada área habitable necesita al menos 1 punto de control.

CÓMO CONTAR ZONAS DESDE EL PLANO DE ILUMINACIÓN:
- Buscar etiquetas Z-XXX en el plano. Cada Z = 1 zona = 1 salida de dimmer/switch.
- Z-000 generalmente es reserva.
- Si no hay plano de iluminación con zonas, estimar ~3-5 zonas por área habitable, ~8-12 en áreas sociales grandes.

ÁREAS DE SERVICIO NUNCA LLEVAN CONTROL DE ILUMINACIÓN:
- Cuarto de lavado, baño de servicio, vestíbulo de servicios, bodega = NO se incluyen en el sistema Lutron. Usan apagadores convencionales.
- Solo áreas habitables/sociales/privadas llevan control.

── CONTROL DE ACCESO (Hikvision) ──
- Panel de control de acceso dimensionado al número de puertas a controlar.
- Ubicaciones típicas: puerta principal, puerta de servicio, acceso de garage.
- Pernos electromagnéticos en vestidores (walk-in closets) es común.
- Lectores (tarjeta/huella/teclado) en cada punto de acceso.
- Botón de salida del lado interior de cada puerta controlada.
- Fuente de alimentación para chapas/pernos en SITE.

── CORTINAS MOTORIZADAS ──
- Línea según presupuesto/nivel:
  • High-end: Lutron Sivoia QS (integrada con Homeworks/RadioRA3)
  • Medio: Somfy (motores Somfy, controlados independiente o por integración)
  • Bajo: Rollease o similar

DOBLE CORTINERO — regla para recámaras y zonas sociales:
- Recámaras SIEMPRE llevan doble cortinero: 1 translúcida (sheer) + 1 blackout = 2 motores por ventana.
- Zonas sociales (sala, comedor, family) también llevan doble cortinero normalmente.
- Cada motor es 1 unidad de cortina Sivoia/Somfy.
- Si una recámara tiene 2 ventanas: 2 ventanas × 2 cortineros = 4 motores.
- Terraza generalmente NO lleva cortinas motorizadas (es exterior).

SIZING:
- Contar ventanas por área que llevan cortina.
- Recámaras y sociales: × 2 motores por ventana (translúcida + blackout).
- Otras áreas (cocina, baños): solo si el scope lo indica, generalmente 1 cortinero.
- En Homeworks QS, las cortinas Sivoia se controlan desde el mismo procesador HQP7 — los motores se conectan al QS link.

── DETECCIÓN DE HUMO / INCENDIO ──
- SOLO se incluye cuando el scope lo pide explícitamente.
- NO es estándar en residencial mexicano.
- Si se incluye: detectores de humo en áreas comunes, detector de calor en cocina.

── BMS ──
- SOLO para edificios residenciales completos (no departamentos individuales ni casas).
- Nunca proponerlo si el scope no lo menciona.

── TELEFONÍA ──
- SOLO si el scope lo solicita. Ya es muy poco común en residencial.

── RED CELULAR (DAS) ──
- SOLO si el scope lo solicita. Relevante en sótanos, edificios con mala recepción.

═══════════════════════════════════════════════════
SITE / CUARTO TÉCNICO
═══════════════════════════════════════════════════

SIEMPRE incluir un área "SITE / Cuarto Técnico" con:
- Rack: 16U (depto/casa chica), 24U (casa mediana), 42U (casa grande/edificio).
- Siempre incluir: ruedas para rack, charola(s), organizadores de cables.
- UPS dimensionado a la carga (mínimo 1 siempre).
- El rack resguarda TODOS los equipos centrales: switches, NVR, procesador Lutron, panel de acceso, amplificadores si aplica.

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
          "notes": "justificación"
        }
      ]
    }
  ],
  "plan_summary": "Descripción del proyecto",
  "rationale": "Lógica general de la propuesta",
  "warnings": ["Advertencias o supuestos"]
}

Si estás CONVERSANDO (preguntas, resumen, comentarios), responde en texto normal en español. NUNCA mezcles texto y JSON en la misma respuesta.`

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
