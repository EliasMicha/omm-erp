// Vercel serverless function — procesa un reporte de obra con Claude
// Extrae: resumen, avances, faltantes, bloqueos, extras
// Persiste los extras detectados en obra_extras automáticamente (Nivel 2)
// Recibe: { reporte_id, obra_id, obra_nombre, obra_sistemas[], texto, fotos[] }
// Devuelve: { ok, resumen, avances[], faltantes[], bloqueos[], extras_creados: number }

import type { VercelRequest, VercelResponse } from '@vercel/node'

const SYSTEM_PROMPT = `Eres coordinador de obra experto en instalaciones especiales (CCTV, audio, redes, control de iluminación Lutron, control de acceso, detección de humo, BMS, telefonía, red celular, eléctrico).

Analiza el reporte de campo del instalador y extrae información accionable. Identifica cuatro cosas DISTINTAS:

1. AVANCES: qué se completó o progresó hoy
2. FALTANTES: materiales, equipos o información que el equipo necesita pero no tiene
3. BLOQUEOS: factores externos que están frenando el avance (otros contratistas, clima, diseño, falta de acceso, etc.)
4. EXTRAS: actividades nuevas o materiales adicionales solicitados por el cliente/residente que NO estaban en el scope original. Esta es la parte MÁS IMPORTANTE — son oportunidades de cotizar adendum al cliente.

Devuelve SOLO un JSON, sin markdown, sin backticks:

{
  "resumen": "1-2 oraciones resumiendo el día",
  "avances": ["avance concreto 1", "avance 2"],
  "faltantes": ["material faltante 1", ...],
  "bloqueos": ["bloqueo 1", ...],
  "extras": [
    {
      "tipo": "actividad" | "material" | "cambio_scope",
      "descripcion": "descripción corta del extra",
      "cantidad": número (default 1),
      "unidad": "pza" | "m" | "hr" | "lote" | etc,
      "sistema": "CCTV" | "Audio" | "Redes" | "Control" | "Acceso" | "Electrico" | "Humo" | "BMS" | "Telefonia" | "Celular" | null,
      "area": "nombre del área donde aplica, o null",
      "texto_original": "fragmento textual del reporte donde se detectó",
      "precio_estimado": número o 0 si no se puede estimar,
      "match_confianza": número 0-1 (qué tan seguro estás de la detección)
    }
  ]
}

REGLAS PARA EXTRAS:
- Un extra es algo que el cliente/residente pidió que NO estaba en el scope original. Palabras clave: "el residente pidió", "el cliente quiere", "nos solicitaron agregar", "además", "extra", "adicional", "cambiar de lugar", "mover".
- Material adicional por error de cálculo NO es un extra — es un faltante. Si el instalador dice "se acabó el cable, necesito más" ES FALTANTE, no extra.
- Si el cliente pide mover o reubicar algo ya instalado, ES un cambio_scope.
- Si el cliente pide agregar un equipo nuevo, ES actividad (si es instalación) o material (si es equipo físico nuevo).
- Sé conservador: mejor no detectar un extra que inventar uno. match_confianza bajo si tienes dudas.
- NO inventes precios. precio_estimado = 0 si no tienes información del costo.

Si el reporte no tiene ningún extra detectable, devuelve "extras": [].`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_KEY || process.env.VITE_ANTHROPIC_KEY
  if (!apiKey) return res.status(500).json({ ok: false, error: 'ANTHROPIC_KEY no configurada' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ ok: false, error: 'Supabase env vars no configuradas' })

  try {
    const { reporte_id, obra_id, obra_nombre, obra_sistemas, texto, fotos } = req.body as {
      reporte_id: string; obra_id: string; obra_nombre: string; obra_sistemas: string[]; texto: string; fotos?: string[]
    }
    if (!reporte_id || !obra_id || !texto) {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros requeridos' })
    }

    // Build content (text + optional image refs)
    // NOTA: las fotos vienen como URLs de Storage, no base64, así que no las mandamos a Claude en este nivel.
    // Si se quiere análisis visual, se pueden fetchear y convertir a base64 aquí — TODO v2.
    const userContent: any[] = [{
      type: 'text',
      text: `Contexto:\nObra: ${obra_nombre}\nSistemas en scope original: ${(obra_sistemas || []).join(', ')}\n\nReporte del instalador:\n${texto}`,
    }]

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    })

    if (!claudeResp.ok) {
      const errText = await claudeResp.text()
      // Marcar el reporte como fallido en Supabase
      await fetch(`${supabaseUrl}/rest/v1/obra_reportes?id=eq.${reporte_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({ procesamiento_error: 'Claude API error: ' + errText.substring(0, 300) }),
      })
      return res.status(500).json({ ok: false, error: 'Claude API: ' + errText.substring(0, 300) })
    }

    const claudeData = await claudeResp.json()
    const textBlocks = (claudeData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    const cleaned = textBlocks.replace(/```json|```/g, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      await fetch(`${supabaseUrl}/rest/v1/obra_reportes?id=eq.${reporte_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({ procesamiento_error: 'Claude no devolvió JSON parseable' }),
      })
      return res.status(500).json({ ok: false, error: 'Claude no devolvió JSON', raw: cleaned.substring(0, 300) })
    }

    let parsed: any
    try { parsed = JSON.parse(jsonMatch[0]) } catch (e: any) {
      return res.status(500).json({ ok: false, error: 'JSON inválido: ' + e.message })
    }

    const resumen = parsed.resumen || ''
    const avances = Array.isArray(parsed.avances) ? parsed.avances : []
    const faltantes = Array.isArray(parsed.faltantes) ? parsed.faltantes : []
    const bloqueos = Array.isArray(parsed.bloqueos) ? parsed.bloqueos : []
    const extras = Array.isArray(parsed.extras) ? parsed.extras : []

    // 1. Actualizar el reporte con los campos AI
    await fetch(`${supabaseUrl}/rest/v1/obra_reportes?id=eq.${reporte_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
      body: JSON.stringify({
        ai_resumen: resumen,
        ai_avances: avances,
        ai_faltantes: faltantes,
        ai_bloqueos: bloqueos,
        procesado: true,
        procesamiento_error: null,
      }),
    })

    // 2. Persistir cada extra detectado en obra_extras (bandeja del coordinador)
    let extrasCreados = 0
    for (const ex of extras) {
      if (!ex || !ex.descripcion) continue
      const payload = {
        obra_id,
        reporte_id,
        tipo: ['actividad', 'material', 'cambio_scope'].includes(ex.tipo) ? ex.tipo : 'material',
        descripcion: String(ex.descripcion).substring(0, 500),
        cantidad: Number(ex.cantidad) || 1,
        unidad: ex.unidad || 'pza',
        sistema: ex.sistema || null,
        area: ex.area || null,
        match_confianza: typeof ex.match_confianza === 'number' ? Math.max(0, Math.min(1, ex.match_confianza)) : null,
        precio_estimado: Number(ex.precio_estimado) || 0,
        moneda: 'MXN',
        status: 'pendiente_revision',
        detectado_por: 'ai',
        texto_original: ex.texto_original || null,
      }
      const insResp = await fetch(`${supabaseUrl}/rest/v1/obra_extras`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(payload),
      })
      if (insResp.ok) extrasCreados++
    }

    // 3. Por cada bloqueo detectado, crear un obra_bloqueos
    for (const bl of bloqueos) {
      if (!bl || typeof bl !== 'string') continue
      const payload = {
        obra_id,
        tipo: 'otro',
        descripcion: bl.substring(0, 500),
        severidad: 'media',
        status: 'abierto',
      }
      await fetch(`${supabaseUrl}/rest/v1/obra_bloqueos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(payload),
      })
    }

    return res.status(200).json({
      ok: true,
      resumen,
      avances,
      faltantes,
      bloqueos,
      extras_creados: extrasCreados,
      bloqueos_creados: bloqueos.length,
    })
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' })
  }
}
