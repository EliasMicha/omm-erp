import { supabase } from './supabase'

// Llama a la Edge Function whatsapp-send con la sesión de quien está en el ERP
// (el mensaje queda a su nombre). La usan /whatsapp y la app /wa.
export async function enviarWhatsApp(payload: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('whatsapp-send', { body: payload })
  if (error) {
    let msg = error.message
    try { const ctx = (error as any).context; if (ctx?.json) { const b = await ctx.json(); msg = b.error || msg } } catch (_) { /* nada */ }
    throw new Error(msg)
  }
  return data
}

// Grupos de WhatsApp (crear, invitar, escribir). Edge Function whatsapp-grupos.
export async function llamarGrupos(payload: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('whatsapp-grupos', { body: payload })
  if (error) {
    let msg = error.message
    try { const ctx = (error as any).context; if (ctx?.json) { const b = await ctx.json(); msg = b.error || msg } } catch (_) { /* nada */ }
    throw new Error(msg)
  }
  return data
}
