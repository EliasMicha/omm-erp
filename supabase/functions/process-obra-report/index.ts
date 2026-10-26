// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: process-obra-report
// Procesa un obra_reporte: analiza texto + fotos (+ audio si el modelo lo acepta)
// con Claude y extrae resumen + avances + faltantes + bloqueos.
//
// Ademas (ago-2026):
//   - PROPONE que actividades abiertas quedaron terminadas (el coordinador
//     confirma de un clic; no se cierra nada solo).
//   - DA DE ALTA los pendientes nuevos como obra_actividades, para que el
//     trabajo mencionado en el reporte no se quede enterrado en el texto.
//
// Oct-2026: con { solo_proponer: true } NO da de alta los pendientes: quedan en
// ai_pendientes para que el jefe de cuadrilla los apruebe por WhatsApp (con
// fecha). Lo usan los reportes que llegan por WhatsApp (whatsapp-reportes).
//
// La API key de Claude vive en el proxy de Vercel (/api/anthropic), que ya tiene
// la key vigente. Antes esta funcion usaba el secreto ANTHROPIC_API_KEY de Supabase
// (invalido) y el modelo claude-sonnet-4-5 (viejo) → el procesamiento fallaba.
//
// (Este archivo no estaba en el repo: se copió de lo desplegado (v24) el
// 2026-10-25 y sólo se le agregó solo_proponer.)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
// Proxy de Vercel con la API key de Claude del lado servidor.
const ANTHROPIC_PROXY = "https://omm-erp.vercel.app/api/anthropic"
const MODEL = "claude-sonnet-4-6"

const PROMPT = `Analiza este reporte de obra de un instalador mexicano de OMM Technologies (empresa de instalaciones especiales/electrico/iluminacion/CCTV/cableado).

Si hay audio, transcribelo completo primero.
Luego analiza TODO el contexto (audio transcrito + texto + fotos) y extrae informacion estructurada.

Devuelve SOLO JSON valido sin markdown, con esta estructura exacta:
{
  "transcripcion": "string con transcripcion literal del audio (o null si no hubo audio)",
  "resumen": "string de 2-3 oraciones resumiendo lo que se hizo",
  "avances": ["string con cada avance/logro concreto reportado"],
  "faltantes": ["string con cada cosa pendiente, materiales que faltan, o tareas no completadas"],
  "bloqueos": ["string con cada problema, bloqueo, impedimento o riesgo identificado"],
  "actividades_terminadas": [{"actividad_id": "id EXACTO de la lista de actividades abiertas", "porcentaje": 0-100, "evidencia": "fragmento del reporte que lo respalda", "confianza": 0-1}],
  "pendientes_nuevos": [{"descripcion": "la tarea que falta, redactada como actividad ejecutable", "sistema": "CCTV|Audio|Redes|Control|Acceso|Electrico|Humo|BMS|Telefonia|Celular|Persianas", "area": "area o null"}]
}

Reglas:
- Habla en espanol mexicano natural
- Los arrays pueden estar vacios ([]) pero nunca null
- Se especifico y concreto, incluye cantidades y ubicaciones cuando esten mencionadas
- Si no hubo audio, "transcripcion": null
- No inventes datos que no esten en el input

ACTIVIDADES TERMINADAS:
- Solo puedes usar ids de la lista de actividades abiertas que te paso abajo. Si no hay lista, devuelve [].
- No adivines: si el reporte dice "avance en cableado" y hay varias actividades de cableado, no marques ninguna salvo que el area o el sistema lo dejen claro.
- porcentaje 100 = quedo terminada. Si solo avanzo, pon el avance real.
- Es una PROPUESTA que un humano confirma, pero aun asi se conservador.

PENDIENTES NUEVOS:
- Solo trabajo que FALTA hacer. Los materiales faltantes van en "faltantes", no aqui.
- Si el pendiente ya esta en la lista de actividades abiertas, no lo repitas.
- Redactalo como tarea concreta: "Colocar placas en recamara principal", no "faltan placas".`

// Llama directo a Anthropic con la llave de esta función. Antes pasaba por el
// proxy público de Vercel (/api/anthropic), que desde el 2026-10-26 exige sesión;
// si aquí no hubiera llave, se usa el proxy con la llave de servicio.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? ""
async function callClaude(content: any[]): Promise<Response> {
  const directo = !!ANTHROPIC_API_KEY
  return await fetch(directo ? "https://api.anthropic.com/v1/messages" : ANTHROPIC_PROXY, {
    method: "POST",
    headers: directo
      ? { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }
      : { "content-type": "application/json", "x-omm-internal": SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: "user", content }],
    }),
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  try {
    const { reporte_id, solo_proponer } = await req.json()
    if (!reporte_id) return json({ error: "Missing reporte_id" }, 400)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data: reporte, error: fetchErr } = await supabase
      .from("obra_reportes")
      .select("*")
      .eq("id", reporte_id)
      .single()

    if (fetchErr || !reporte) return json({ error: "Report not found" }, 404)

    const content: any[] = []

    // 1. Audio (si existe)
    if (reporte.audio_path) {
      const { data: audioBlob, error: audioErr } = await supabase.storage
        .from("obra-reportes")
        .download(reporte.audio_path)
      if (!audioErr && audioBlob) {
        const buf = await audioBlob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let bin = ""
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        const b64 = btoa(bin)
        const ext = reporte.audio_path.split(".").pop()?.toLowerCase() || "m4a"
        const audioMimeMap: Record<string, string> = {
          m4a: "audio/mp4", mp4: "audio/mp4",
          mp3: "audio/mpeg", mpeg: "audio/mpeg",
          wav: "audio/wav", webm: "audio/webm", ogg: "audio/ogg",
        }
        content.push({
          type: "document",
          source: { type: "base64", media_type: audioMimeMap[ext] || "audio/mpeg", data: b64 },
        })
      }
    }

    // 2. Fotos
    if (Array.isArray(reporte.fotos) && reporte.fotos.length > 0) {
      for (const photoPath of reporte.fotos) {
        try {
          const { data: photoBlob } = await supabase.storage
            .from("obra-reportes")
            .download(photoPath)
          if (photoBlob) {
            const buf = await photoBlob.arrayBuffer()
            const bytes = new Uint8Array(buf)
            let bin = ""
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
            const b64 = btoa(bin)
            const ext = photoPath.split(".").pop()?.toLowerCase() || "jpeg"
            const mmap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" }
            content.push({
              type: "image",
              source: { type: "base64", media_type: mmap[ext] || "image/jpeg", data: b64 },
            })
          }
        } catch (_e) { /* skip bad photos */ }
      }
    }

    // 3. Texto + actividades abiertas (sin la lista, el modelo no puede proponer cierres)
    const { data: abiertasRaw } = await supabase
      .from("obra_actividades")
      .select("id,descripcion,sistema,area,porcentaje")
      .eq("obra_id", reporte.obra_id)
      .neq("status", "completada")
      .limit(250)
    const abiertas: any[] = abiertasRaw || []
    const listaActs = abiertas.length
      ? "Actividades ABIERTAS de esta obra (usa estos ids exactos en actividades_terminadas):\n" +
        abiertas.map((a: any) => `- id=${a.id} | ${a.sistema || "?"} | ${a.area || "sin area"} | ${a.descripcion} (${a.porcentaje || 0}%)`).join("\n") + "\n\n"
      : "Esta obra no tiene actividades abiertas registradas: devuelve actividades_terminadas vacio.\n\n"
    const userText = (reporte.texto_raw
      ? `Texto escrito por el instalador:\n\n${reporte.texto_raw}\n\n`
      : "") + listaActs + PROMPT
    content.push({ type: "text", text: userText })

    // Llamar a Claude via proxy. Si falla y habia audio (Claude puede no aceptarlo),
    // reintentar sin el bloque de audio para no perder el analisis de texto+fotos.
    let claudeRes = await callClaude(content)
    if (!claudeRes.ok) {
      const hadAudio = content.some((c: any) => c.type === "document" && String(c.source?.media_type || "").startsWith("audio"))
      if (hadAudio) {
        const noAudio = content.filter((c: any) => !(c.type === "document" && String(c.source?.media_type || "").startsWith("audio")))
        claudeRes = await callClaude(noAudio)
      }
    }

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      await supabase.from("obra_reportes").update({
        procesado: false,
        procesamiento_error: `Claude ${claudeRes.status}: ${errText.slice(0, 300)}`,
      }).eq("id", reporte_id)
      return json({ error: `Claude API ${claudeRes.status}: ${errText}` }, 502)
    }

    const claudeData = await claudeRes.json()
    const textContent = claudeData.content?.[0]?.text || ""

    let parsed: any = {}
    try {
      const cleaned = textContent.replace(/```json\n?|\n?```/g, "").trim()
      const match = cleaned.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(match ? match[0] : cleaned)
    } catch (_e) {
      await supabase.from("obra_reportes").update({
        procesado: false,
        procesamiento_error: "Failed to parse Claude JSON: " + textContent.slice(0, 200),
      }).eq("id", reporte_id)
      return json({ error: "Failed to parse Claude response", raw: textContent }, 500)
    }

    const finalText = parsed.transcripcion
      ? (reporte.texto_raw ? `${reporte.texto_raw}\n\n[Audio transcrito]: ${parsed.transcripcion}` : `[Audio transcrito]: ${parsed.transcripcion}`)
      : reporte.texto_raw

    // Solo aceptamos ids que de verdad esten abiertos: si el modelo inventa un
    // id, se descarta en vez de escribir sobre una actividad que no existe.
    const idsAbiertos = new Set(abiertas.map((a: any) => a.id))
    const sugeridas = (Array.isArray(parsed.actividades_terminadas) ? parsed.actividades_terminadas : [])
      .filter((x: any) => x && idsAbiertos.has(x.actividad_id))
      .map((x: any) => {
        const a = abiertas.find((y: any) => y.id === x.actividad_id)
        return {
          actividad_id: x.actividad_id,
          descripcion: a?.descripcion || "",
          sistema: a?.sistema || null,
          area: a?.area || null,
          porcentaje: Math.max(0, Math.min(100, Number(x.porcentaje) || 100)),
          evidencia: String(x.evidencia || "").slice(0, 300),
          confianza: typeof x.confianza === "number" ? Math.max(0, Math.min(1, x.confianza)) : null,
        }
      })

    const pendientes = (Array.isArray(parsed.pendientes_nuevos) ? parsed.pendientes_nuevos : [])
      .filter((p: any) => p && p.descripcion)
      .map((p: any) => ({
        descripcion: String(p.descripcion).slice(0, 400),
        sistema: p.sistema || "Redes",
        area: p.area || null,
      }))

    const { error: updErr } = await supabase.from("obra_reportes").update({
      texto_raw: finalText,
      ai_resumen: parsed.resumen || null,
      ai_avances: parsed.avances || [],
      ai_faltantes: parsed.faltantes || [],
      ai_bloqueos: parsed.bloqueos || [],
      ai_actividades_sugeridas: sugeridas,
      ai_pendientes: pendientes,
      procesado: true,
      procesamiento_error: null,
    }).eq("id", reporte_id)

    if (updErr) return json({ error: "DB update failed: " + updErr.message }, 500)

    // Los pendientes nuevos SI se dan de alta solos: es trabajo que antes se
    // perdia dentro del texto del reporte. Nacen sin responsable, con origen
    // 'reporte' para saber de donde salieron. Cerrar actividades NO se
    // automatiza: eso queda como propuesta para el coordinador.
    // Con solo_proponer (reportes de WhatsApp) se quedan en ai_pendientes: los
    // aprueba el jefe de cuadrilla con fecha.
    let pendientesCreados = 0
    if (pendientes.length > 0 && !solo_proponer) {
      const yaExiste = (d: string) => abiertas.some((a: any) =>
        String(a.descripcion || "").toLowerCase().trim() === d.toLowerCase().trim())
      const nuevos = pendientes.filter((p: any) => !yaExiste(p.descripcion))
      if (nuevos.length > 0) {
        const { error: insErr } = await supabase.from("obra_actividades").insert(
          nuevos.map((p: any, i: number) => ({
            obra_id: reporte.obra_id,
            reporte_id,
            sistema: p.sistema,
            area: p.area,
            descripcion: p.descripcion,
            status: "pendiente",
            porcentaje: 0,
            origen: "reporte",
            order_index: 900 + i,
          })))
        // ⚠️ origen 'reporte' NO pasa obra_actividades_origen_check (manual |
        // cotizacion | ai_reporte | adendum): este insert falla desde ago-2026 y
        // ningún pendiente se ha dado de alta por aquí. Se deja así a propósito
        // hasta que Elias decida si los reportes de la app también pasan por el
        // jefe de cuadrilla (como los de WhatsApp) o se dan de alta solos.
        if (insErr) console.error("alta de pendientes:", insErr.message)
        else pendientesCreados = nuevos.length
      }
    }

    return json({
      success: true,
      reporte_id,
      resumen: parsed.resumen,
      avances_count: (parsed.avances || []).length,
      faltantes_count: (parsed.faltantes || []).length,
      bloqueos_count: (parsed.bloqueos || []).length,
      transcripcion: parsed.transcripcion,
      actividades_sugeridas: sugeridas.length,
      pendientes_creados: pendientesCreados,
      pendientes_propuestos: solo_proponer ? pendientes.length : 0,
      usage: claudeData.usage,
    })
  } catch (e: any) {
    return json({ error: e.message || String(e) }, 500)
  }
})

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
