// Copia del PDF de cotización que se acaba de descargar en el ERP.
//
// El bot de WhatsApp (y después el envío a clientes por WhatsApp o correo) manda
// ESTE archivo, no uno rearmado: el PDF de propuesta se dibuja fotografiando la
// página en el navegador y un servidor no lo puede reproducir igual.
//
// Nunca lanza. La descarga ya ocurrió; si la copia falla, el usuario tiene su PDF
// y solo se pierde que el bot lo pueda mandar. Por eso se devuelve el error en
// vez de tumbar la pantalla.
import { supabase } from './supabase'

export interface ArchivoPdfCot {
  blob: Blob
  quotationId: string
  formato: string
  filename: string
  /** quotations.total_final al momento de generar: así el bot sabe si el PDF quedó viejo. */
  total: number | null
  moneda: string | null
}

export async function archivarPdfCotizacion(a: ArchivoPdfCot): Promise<{ ok: boolean; error?: string }> {
  try {
    const path = `${a.quotationId}/${Date.now()}_${a.formato}.pdf`
    const up = await supabase.storage.from('cotizaciones-pdf')
      .upload(path, a.blob, { contentType: 'application/pdf', upsert: false })
    if (up.error) return { ok: false, error: up.error.message }
    const ins = await supabase.from('cotizacion_pdfs').insert({
      quotation_id: a.quotationId,
      formato: a.formato,
      // El técnico trae costos y márgenes: jamás debe salir a un cliente.
      interno: a.formato === 'tecnico',
      storage_path: path,
      filename: a.filename,
      bytes: a.blob.size,
      total_al_generar: a.total,
      moneda: a.moneda,
    })
    if (ins.error) return { ok: false, error: ins.error.message }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
}
