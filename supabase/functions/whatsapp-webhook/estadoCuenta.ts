// Tool: enviar_estado_de_cuenta — el PDF del estado de cuenta de un cliente,
// mandado como archivo al chat de quien lo pide.
//
// Mismo generador y misma consulta que el botón del ERP y que el MCP
// (_shared/estadoCuentaPdf.ts + _shared/estadoCuenta.ts), corridos con el
// cliente de la PERSONA: solo sale lo que ella podría ver en pantalla.
// Va SOLO a quien escribe; mandárselo al cliente es otro paso, con aprobación.
import type { ToolDefinition, ToolExecutionContext, ToolResult } from './types.ts';
import { generarEstadoCuentaPdf } from '../_shared/estadoCuentaPdf.ts';
import { datosEstadoCuenta, nombreArchivoEstadoCuenta } from '../_shared/estadoCuenta.ts';
import { uploadMedia, sendDocument, toSendPhone } from './whatsapp.ts';
import { logWa, waIdFrom } from './log.ts';

export const enviarEstadoCuentaDef: ToolDefinition = {
  name: 'enviar_estado_de_cuenta',
  description:
    'Manda por WhatsApp, a quien lo pide, el PDF del estado de cuenta de UN cliente (lead): contratos vigentes, ' +
    'pagos y saldo por moneda. Es el mismo documento del botón del ERP. La cobranza va por LEAD y cotización, ' +
    'no por obra. Si el nombre empata con varios leads, devuelve candidatos: pregunta cuál y vuelve a llamar con lead_id.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'string' },
      lead: { type: 'string', description: 'Nombre o parte del nombre del lead, p. ej. "L202" o "Eduardo Tawil".' },
    },
  },
};

const limpiar = (s: string) => s.replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim();

export async function enviarEstadoCuenta(input: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const ses = ctx.sesion;
  if (!ses) return { success: false, error: 'Tu número no está ligado a un usuario del ERP; no puedo sacar documentos a tu nombre.' };
  if (!ses.puedeEstadoCuenta) return { success: false, error: 'Tu usuario no tiene permiso de estados de cuenta (Usuarios → "Puede generar estados de cuenta").' };
  const sb = ses.sb;

  let lead: any = null;
  if (input?.lead_id) {
    const { data } = await sb.from('leads').select('id, name, company').eq('id', input.lead_id).maybeSingle();
    lead = data;
    if (!lead) return { success: false, error: 'No encontré ese lead.' };
  } else {
    const q = limpiar(String(input?.lead || ''));
    if (!q) return { success: false, error: '¿De qué cliente?' };
    // Cada palabra tiene que estar en el nombre: "L202 Tawil" encuentra "Cero5cien L202 - Eduardo Tawil".
    let consulta = sb.from('leads').select('id, name, company').is('archived_at', null).limit(12);
    for (const w of q.split(' ').filter(w => w.length >= 2)) consulta = consulta.ilike('name', `%${w}%`);
    const { data, error } = await consulta;
    if (error) return { success: false, error: error.message };
    const cand = data || [];
    if (!cand.length) return { success: false, error: `Ningún lead se llama como "${q}".` };
    if (cand.length > 1) {
      return { success: true, data: { necesita_elegir: true, candidatos: cand.map((c: any) => ({ lead_id: c.id, nombre: c.name, despacho: c.company })) } };
    }
    lead = cand[0];
  }

  const datos = await datosEstadoCuenta(sb, lead.id, { name: lead.name, company: lead.company });
  if (!datos.quotations.length) {
    return { success: false, error: `"${lead.name}" no tiene contratos vigentes: no hay estado de cuenta (una cotización que no llegó a contrato no es cobranza).` };
  }
  const bytes = new Uint8Array(generarEstadoCuentaPdf(datos).output('arraybuffer') as ArrayBuffer);
  const archivo = nombreArchivoEstadoCuenta(lead.name);

  const to = toSendPhone(ctx.contact.phone_e164);
  const caption = `Estado de cuenta · ${lead.name}`;
  try {
    const mediaId = await uploadMedia(bytes, 'application/pdf', archivo);
    const resp = await sendDocument(to, mediaId, archivo, caption);
    await logWa(ctx.supabase, { direction: 'out', phone_e164: '+' + to, wa_message_id: waIdFrom(resp), kind: 'document', body: caption + ` (${archivo})`, sender_type: 'equipo', agent_contact_id: ctx.contact.id, status: 'enviado' });
  } catch (e) {
    return { success: false, error: `WhatsApp no aceptó el PDF: ${String((e as Error)?.message || e).slice(0, 200)}` };
  }
  return {
    success: true,
    data: { enviado: true, lead: lead.name, contratos: datos.quotations.length },
    affected_entity_type: 'lead', affected_entity_id: lead.id,
    user_facing_message: `📄 Te mandé el estado de cuenta de ${lead.name}.`,
  };
}
