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
5. ACTIVIDADES TERMINADAS: de la lista de actividades abiertas que te paso, cuáles quedaron terminadas (o avanzaron) según el reporte.
6. PENDIENTES NUEVOS: trabajo que el reporte menciona que FALTA hacer y que NO corresponde a ninguna actividad abierta de la lista. Se van a dar de alta como tareas para que no se pierdan.

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
  ],
  "actividades_terminadas": [
    {
      "actividad_id": "el id EXACTO de la lista de actividades abiertas",
      "porcentaje": número 0-100 (100 si quedó terminada, el avance real si solo progresó),
      "evidencia": "el fragmento del reporte que lo respalda",
      "confianza": número 0-1
    }
  ],
  "pendientes_nuevos": [
    {
      "descripcion": "la tarea que falta, redactada como actividad ejecutable",
      "sistema": "CCTV|Audio|Redes|Control|Acceso|Electrico|Humo|BMS|Telefonia|Celular|Persianas",
      "area": "área donde aplica, o null"
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

REGLAS PARA ACTIVIDADES TERMINADAS:
- SOLO puedes usar ids que estén en la lista de actividades abiertas que te paso. Si no hay lista, devuelve [].
- No adivines: si el reporte dice "avancé en cableado" y hay ocho actividades de cableado distintas, no marques ninguna salvo que el área o el sistema lo dejen claro.
- confianza alta solo cuando el reporte nombra el trabajo de forma inequívoca.
- Esto es una PROPUESTA: un humano la confirma. Aun así, sé conservador.

REGLAS PARA PENDIENTES NUEVOS:
- Solo trabajo que falta hacer (una tarea), no materiales faltantes (eso ya va en "faltantes") ni bloqueos.
- Si el pendiente ya está en la lista de actividades abiertas, NO lo repitas aquí.
- Redáctalo como una tarea concreta: "Colocar placas en recámara principal", no "faltan placas".

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
    const H0: any = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
    // Actividades abiertas de la obra: sin ellas la IA no puede proponer cierres.
    let abiertas: any[] = []
    try {
      const ar = await fetch(
        `${supabaseUrl}/rest/v1/obra_actividades?obra_id=eq.${obra_id}&status=neq.completada&select=id,descripcion,sistema,area,porcentaje&limit=250`,
        { headers: H0 })
      if (ar.ok) abiertas = await ar.json()
    } catch (e: any) { console.error('[process-obra-report] actividades:', e && e.message) }
    if (!reporte_id || !obra_id || !texto) {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros requeridos' })
    }

    // Build content (text + optional image refs)
    // NOTA: las fotos vienen como URLs de Storage, no base64, así que no las mandamos a Claude en este nivel.
    // Si se quiere análisis visual, se pueden fetchear y convertir a base64 aquí — TODO v2.
    const userContent: any[] = [{
      type: 'text',
      text: `Contexto:\nObra: ${obra_nombre}\nSistemas en scope original: ${(obra_sistemas || []).join(', ')}\n\n` +
        (abiertas.length
          ? `Actividades ABIERTAS de esta obra (usa estos ids exactos en actividades_terminadas):\n` +
            abiertas.map((a: any) => `- id=${a.id} | ${a.sistema || '?'} | ${a.area || 'sin área'} | ${a.descripcion} (${a.porcentaje || 0}%)`).join('\n') + `\n\n`
          : `Esta obra no tiene actividades abiertas registradas: devuelve actividades_terminadas vacío.\n\n`) +
        `Reporte del instalador:\n${texto}`,
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

    // Solo aceptamos ids que de verdad estén abiertos: si la IA inventa un id,
    // se descarta en vez de escribir sobre una actividad que no existe.
    const idsAbiertos = new Set(abiertas.map((a: any) => a.id))
    const sugeridas = (Array.isArray(parsed.actividades_terminadas) ? parsed.actividades_terminadas : [])
      .filter((x: any) => x && idsAbiertos.has(x.actividad_id))
      .map((x: any) => {
        const a = abiertas.find((y: any) => y.id === x.actividad_id)
        return {
          actividad_id: x.actividad_id,
          descripcion: a?.descripcion || '',
          sistema: a?.sistema || null,
          area: a?.area || null,
          porcentaje: Math.max(0, Math.min(100, Number(x.porcentaje) || 100)),
          evidencia: String(x.evidencia || '').substring(0, 300),
          confianza: typeof x.confianza === 'number' ? Math.max(0, Math.min(1, x.confianza)) : null,
        }
      })

    const pendientesNuevos = (Array.isArray(parsed.pendientes_nuevos) ? parsed.pendientes_nuevos : [])
      .filter((p: any) => p && p.descripcion)
      .map((p: any) => ({
        descripcion: String(p.descripcion).substring(0, 400),
        sistema: p.sistema || (obra_sistemas || [])[0] || 'Redes',
        area: p.area || null,
      }))

    // 1. Actualizar el reporte con los campos AI
    await fetch(`${supabaseUrl}/rest/v1/obra_reportes?id=eq.${reporte_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
      body: JSON.stringify({
        ai_resumen: resumen,
        ai_avances: avances,
        ai_faltantes: faltantes,
        ai_bloqueos: bloqueos,
        ai_actividades_sugeridas: sugeridas,
        ai_pendientes: pendientesNuevos,
        procesado: true,
        procesamiento_error: null,
      }),
    })

    // 1b. Los pendientes nuevos SÍ se dan de alta solos: son trabajo que se
    // perdía en el texto del reporte. Nacen en estado pendiente, sin
    // responsable, marcados con origen 'reporte' para saber de dónde salieron.
    // (Cerrar actividades NO se automatiza: eso queda como propuesta.)
    let pendientesCreados = 0
    if (pendientesNuevos.length > 0) {
      const yaExiste = (d: string) => abiertas.some((a: any) =>
        String(a.descripcion || '').toLowerCase().trim() === d.toLowerCase().trim())
      const nuevos = pendientesNuevos.filter((p: any) => !yaExiste(p.descripcion))
      if (nuevos.length > 0) {
        const payload = nuevos.map((p: any, i: number) => ({
          obra_id,
          reporte_id,
          sistema: p.sistema,
          area: p.area,
          descripcion: p.descripcion,
          status: 'pendiente',
          porcentaje: 0,
          origen: 'reporte',
          order_index: 900 + i,
        }))
        const r = await fetch(`${supabaseUrl}/rest/v1/obra_actividades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
        })
        if (r.ok) pendientesCreados = payload.length
        else console.error('[process-obra-report] pendientes:', (await r.text()).substring(0, 200))
      }
    }

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
      actividades_sugeridas: sugeridas,
      pendientes: pendientesNuevos,
      pendientes_creados: pendientesCreados,
    })
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' })
  }
}
