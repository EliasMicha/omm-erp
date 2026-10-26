// Tool: enviar_cotizacion
//
// Manda por WhatsApp el PDF de una cotización TAL COMO SE DESCARGÓ DEL ERP.
// No se rearma aquí: el PDF de propuesta se dibuja fotografiando la página en el
// navegador. Cada descarga en el ERP deja una copia en el bucket privado
// `cotizaciones-pdf` (tabla `cotizacion_pdfs`) y esto manda la última.
//
// Por ahora va SOLO a quien lo pide (Elias está probando). Mandarlo al cliente
// —por WhatsApp o correo— es el siguiente paso y llevará confirmación explícita.
import type { ToolDefinition, ToolExecutionContext, ToolResult } from './types.ts';
import { uploadMedia, sendDocument, toSendPhone } from './whatsapp.ts';
import { logWa, waIdFrom } from './log.ts';

const ERP = 'https://omm-erp.vercel.app';

const fmtMonto = (n: number | null | undefined, mon?: string | null) =>
  n == null ? '—' : `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${mon || ''}`.trim();

// Los caracteres que rompen el filtro .or() de PostgREST.
const limpiarBusqueda = (q: string) => q.replace(/[,()*%\\]/g, ' ').replace(/\s+/g, ' ').trim();

function leadNombre(notes: string | null): string {
  try { return JSON.parse(notes || '{}').lead_name || ''; } catch { return ''; }
}

async function buscarCotizaciones(sb: any, busqueda: string, leadId: string | null) {
  const campos = 'id, folio, name, client_name, notes, total_final, total, stage, specialty, version_label, updated_at';
  let q = sb.from('quotations').select(campos).is('archived_at', null).order('updated_at', { ascending: false }).limit(25);
  const b = limpiarBusqueda(busqueda);
  if (b) {
    q = q.or(`folio.ilike.%${b}%,name.ilike.%${b}%,client_name.ilike.%${b}%,notes.ilike.%${b}%`);
  } else if (leadId) {
    q = q.ilike('notes', `%${leadId}%`);
  } else {
    return [];
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export const enviarCotizacionDef: ToolDefinition = {
  name: 'enviar_cotizacion',
  description:
    'Manda por WhatsApp, a quien lo pide, el PDF de una cotización tal como se descargó del ERP (la última copia guardada). ' +
    'Busca por folio (ej. DLAN-ES01), nombre de la cotización, cliente o lead; sin búsqueda usa el lead del contexto activo. ' +
    'Si devuelve candidatas, pregunta cuál (muestra folio y nombre) y vuelve a llamar con cotizacion_id. ' +
    'Si no hay PDF guardado, explícalo: hay que abrirla y descargarla una vez en el ERP. ' +
    'NO la manda al cliente: solo a quien escribe.',
  input_schema: {
    type: 'object',
    properties: {
      busqueda: { type: 'string', description: 'Folio, nombre, cliente o lead' },
      cotizacion_id: { type: 'string', description: 'Id exacto, cuando ya se eligió entre candidatas' },
      formato: {
        type: 'string', enum: ['ejecutivo', 'tecnico', 'lista', 'resumen'],
        description: 'Opcional. Por omisión, el último que NO sea técnico (el técnico trae costos internos).',
      },
    },
  },
};

export async function enviarCotizacion(input: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const sb = ctx.supabase;
  const { busqueda = '', cotizacion_id, formato } = input || {};

  // 1 · ¿Cuál cotización?
  let cot: any = null;
  if (cotizacion_id) {
    const { data } = await sb.from('quotations')
      .select('id, folio, name, client_name, notes, total_final, total, stage, specialty, version_label, updated_at')
      .eq('id', cotizacion_id).maybeSingle();
    cot = data;
    if (!cot) return { success: false, error: 'No encontré esa cotización.' };
  } else {
    const encontradas = await buscarCotizaciones(sb, String(busqueda), ctx.conversation.active_lead_id);
    if (!encontradas.length) {
      return { success: false, error: busqueda ? `No encontré cotizaciones que coincidan con "${busqueda}".` : 'Dime el folio, el nombre o el cliente de la cotización.' };
    }
    const b = limpiarBusqueda(String(busqueda)).toLowerCase();
    const porFolio = encontradas.filter((c: any) => (c.folio || '').toLowerCase() === b);
    if (porFolio.length === 1) cot = porFolio[0];
    else if (encontradas.length === 1) cot = encontradas[0];
    else {
      const ids = encontradas.map((c: any) => c.id);
      const { data: pdfs } = await sb.from('cotizacion_pdfs').select('quotation_id').in('quotation_id', ids);
      const conPdf = new Set((pdfs ?? []).map((p: any) => p.quotation_id));
      return {
        success: true,
        data: {
          necesita_elegir: true,
          candidatas: encontradas.slice(0, 8).map((c: any) => ({
            cotizacion_id: c.id,
            folio: c.folio,
            nombre: c.name + (c.version_label ? ` (${c.version_label})` : ''),
            lead: leadNombre(c.notes) || c.client_name || '',
            etapa: c.stage,
            total: fmtMonto(c.total_final ?? c.total),
            tiene_pdf: conPdf.has(c.id),
          })),
        },
      };
    }
  }

  // 2 · ¿Qué PDF?
  const { data: pdfs, error: ePdf } = await sb.from('cotizacion_pdfs')
    .select('id, formato, interno, storage_path, filename, total_al_generar, moneda, generado_at')
    .eq('quotation_id', cot.id).order('generado_at', { ascending: false });
  if (ePdf) return { success: false, error: ePdf.message };
  const lista = pdfs ?? [];
  const pdf = formato
    ? lista.find((p: any) => p.formato === formato)
    : (lista.find((p: any) => !p.interno) || lista[0]);

  const liga = `${ERP}/cotizacion/${cot.id}/pdf/${formato || 'ejecutivo'}`;
  if (!pdf) {
    return {
      success: false,
      error: `La cotización ${cot.folio || cot.name} no tiene PDF${formato ? ` en formato ${formato}` : ''} guardado. ` +
        `Hay que abrirla y darle "Descargar PDF" una vez en el ERP: ${liga}`,
    };
  }

  // 3 · ¿Sigue al día? Se compara el total de cuando se generó contra el de hoy.
  const totalHoy = Number(cot.total_final ?? cot.total);
  const totalPdf = pdf.total_al_generar == null ? null : Number(pdf.total_al_generar);
  const desactualizado = totalPdf != null && Number.isFinite(totalHoy) && Math.abs(totalHoy - totalPdf) > 0.01;

  // 4 · Bajar del bucket, subir a WhatsApp y mandar.
  const { data: blob, error: eDl } = await sb.storage.from('cotizaciones-pdf').download(pdf.storage_path);
  if (eDl || !blob) return { success: false, error: `No pude leer el PDF guardado: ${eDl?.message || 'vacío'}` };
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const fecha = new Date(pdf.generado_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Mexico_City' });
  const caption = [
    `${cot.folio || ''} · ${cot.name}`.replace(/^ · /, ''),
    `PDF ${pdf.formato} del ${fecha}`,
    pdf.interno ? '⚠️ Formato técnico: trae costos internos, no es para el cliente.' : null,
    desactualizado ? `⚠️ La cotización cambió después de este PDF (era ${fmtMonto(totalPdf, pdf.moneda)}, hoy ${fmtMonto(totalHoy, pdf.moneda)}).` : null,
  ].filter(Boolean).join('\n');

  const to = toSendPhone(ctx.contact.phone_e164);
  let waId: string | null = null;
  try {
    const mediaId = await uploadMedia(bytes, 'application/pdf', pdf.filename);
    const resp = await sendDocument(to, mediaId, pdf.filename, caption);
    waId = waIdFrom(resp);
  } catch (e: any) {
    await logWa(sb, {
      direction: 'out', phone_e164: '+' + to, kind: 'document', body: caption, media_path: pdf.storage_path,
      sender_type: 'equipo', agent_contact_id: ctx.contact.id, status: 'fallido', error: String(e?.message || e),
    });
    return { success: false, error: `WhatsApp no aceptó el PDF: ${String(e?.message || e).slice(0, 200)}` };
  }
  await logWa(sb, {
    direction: 'out', phone_e164: '+' + to, wa_message_id: waId, kind: 'document', body: caption,
    media_path: pdf.storage_path, sender_type: 'equipo', agent_contact_id: ctx.contact.id, status: 'enviado',
  });

  return {
    success: true,
    data: {
      enviado: true,
      folio: cot.folio,
      nombre: cot.name,
      formato: pdf.formato,
      generado: fecha,
      desactualizado,
      liga_para_actualizar: desactualizado ? liga : undefined,
    },
    affected_entity_type: 'quotation',
    affected_entity_id: cot.id,
    user_facing_message: `📄 Te mandé ${cot.folio || cot.name}.` + (desactualizado ? ' Ojo: el PDF es anterior al último cambio.' : ''),
  };
}
