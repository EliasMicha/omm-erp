// Tool: mensaje_a_equipo
//
// Le escribe por WhatsApp a alguien del equipo DE PARTE de quien usa el bot.
// Es un mensaje a un tercero, a nombre de OMM, y no se puede deshacer, así que va
// en dos pasos: sin `confirmado` solo devuelve la vista previa; el agente la
// enseña y vuelve a llamar con confirmado=true únicamente tras un sí explícito.
//
// Reglas de Meta que mandan aquí:
// - Si la persona le escribió al número en las últimas 24 h, se puede mandar
//   texto libre.
// - Si no, solo con plantilla aprobada (omm_aviso_equipo). Mientras Meta no la
//   apruebe, ese camino falla y se dice por qué en vez de fingir que salió.
import type { ToolDefinition, ToolExecutionContext, ToolResult } from './types.ts';
import { sendText, sendTemplate, toSendPhone, last10 } from './whatsapp.ts';
import { logWa, waIdFrom } from './log.ts';

const PLANTILLA = 'omm_aviso_equipo';

// Meta rechaza parámetros de plantilla con saltos de línea, tabuladores o más
// de 4 espacios seguidos.
const paraPlantilla = (t: string) =>
  t.replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').trim().slice(0, 900);

const primerNombre = (n: string) => {
  const p = (n || '').trim().split(/\s+/)[0] || '';
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
};

export const mensajeAEquipoDef: ToolDefinition = {
  name: 'mensaje_a_equipo',
  description:
    'Manda un mensaje de WhatsApp a una persona del equipo de OMM (empleado activo) de parte de quien escribe. ' +
    'SIEMPRE en dos pasos: primero llámala sin confirmado para obtener la vista previa (a quién, a qué número, texto final), ' +
    'enséñala y pregunta "¿Lo mando?". Solo con un sí explícito vuelve a llamarla con confirmado=true y el mismo texto. ' +
    'Si hay varias personas con ese nombre, devuelve candidatas: pregunta cuál.',
  input_schema: {
    type: 'object',
    properties: {
      persona: { type: 'string', description: 'Nombre de la persona del equipo' },
      empleado_id: { type: 'string', description: 'Id exacto si ya se eligió entre candidatas' },
      mensaje: { type: 'string', description: 'Texto a mandar, redactado como lo diría quien escribe' },
      telefono: { type: 'string', description: 'Solo si el usuario da un número distinto al del ERP' },
      confirmado: { type: 'boolean', description: 'true SOLO después de que el usuario aprobó la vista previa' },
    },
    required: ['mensaje'],
  },
};

export async function mensajeAEquipo(input: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const sb = ctx.supabase;
  const { persona = '', empleado_id, mensaje = '', telefono, confirmado } = input || {};
  const texto = String(mensaje).trim();
  if (!texto) return { success: false, error: 'Falta el texto del mensaje.' };

  // 1 · ¿A quién?
  const campos = 'id, name, nombre, puesto, area, phone, telefono_personal, obra_app_phone';
  let emp: any = null;
  if (empleado_id) {
    const { data } = await sb.from('employees').select(campos).eq('id', empleado_id).eq('activo', true).maybeSingle();
    emp = data;
  } else {
    const n = String(persona).replace(/[,()%*\\]/g, ' ').trim();
    if (!n) return { success: false, error: '¿A quién le escribo?' };
    const { data, error } = await sb.from('employees').select(campos).eq('activo', true)
      .or(`name.ilike.%${n}%,nombre.ilike.%${n}%`).limit(10);
    if (error) return { success: false, error: error.message };
    if ((data ?? []).length > 1) {
      return {
        success: true,
        data: {
          necesita_elegir: true,
          candidatas: data.map((e: any) => ({ empleado_id: e.id, nombre: e.name || e.nombre, puesto: e.puesto, area: e.area })),
        },
      };
    }
    emp = data?.[0];
  }
  if (!emp) return { success: false, error: `No encontré a "${persona}" entre el personal activo.` };

  const nombre = emp.name || emp.nombre || '';
  const tel10 = last10(String(telefono || emp.phone || emp.telefono_personal || emp.obra_app_phone || ''));
  if (tel10.length !== 10) {
    return { success: false, error: `${nombre} no tiene celular en su ficha. Dame su número o captúralo en Empleados.` };
  }
  const to = toSendPhone(tel10);

  // 2 · ¿Ventana de 24 h abierta? (¿nos escribió ella/él en las últimas 24 h?)
  const hace24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: recientes } = await sb.from('whatsapp_messages').select('phone_e164')
    .eq('direction', 'in').gte('created_at', hace24).limit(500);
  const ventanaAbierta = (recientes ?? []).some((r: any) => last10(r.phone_e164) === tel10);

  const remitente = ctx.contact.display_name || 'OMM';
  const textoLibre = `Mensaje de ${remitente} (vía ERP OMM):\n\n${texto}`;
  const paramAviso = paraPlantilla(`de parte de ${remitente}: ${texto}`);

  if (!confirmado) {
    return {
      success: true,
      requires_confirmation: true,
      data: {
        vista_previa: true,
        para: nombre,
        puesto: emp.puesto,
        telefono: '+52 ' + tel10,
        como_sale: ventanaAbierta ? textoLibre : `Hola ${primerNombre(nombre)}, tienes un aviso del ERP de OMM: ${paramAviso}. Responde a este mensaje para atenderlo con el asistente.`,
        via: ventanaAbierta ? 'texto libre (escribió en las últimas 24 h)' : `plantilla ${PLANTILLA}`,
        instruccion: 'Enséñalo y pregunta "¿Lo mando?". Solo con un sí explícito, llama otra vez con confirmado=true.',
      },
    };
  }

  // 3 · Mandar.
  try {
    const resp = ventanaAbierta
      ? await sendText(to, textoLibre)
      : await sendTemplate(to, PLANTILLA, [primerNombre(nombre), paramAviso]);
    await logWa(sb, {
      direction: 'out', phone_e164: '+' + to, wa_message_id: waIdFrom(resp),
      kind: ventanaAbierta ? 'text' : 'template', template_name: ventanaAbierta ? null : PLANTILLA,
      body: ventanaAbierta ? textoLibre : paramAviso, sender_type: 'equipo',
      agent_contact_id: ctx.contact.id, status: 'enviado',
    });
    return {
      success: true,
      data: { enviado: true, para: nombre, telefono: '+52 ' + tel10 },
      affected_entity_type: 'employee',
      affected_entity_id: emp.id,
      user_facing_message: `✅ Le mandé el mensaje a ${nombre}.`,
    };
  } catch (e: any) {
    const err = String(e?.message || e);
    await logWa(sb, {
      direction: 'out', phone_e164: '+' + to, kind: ventanaAbierta ? 'text' : 'template',
      template_name: ventanaAbierta ? null : PLANTILLA, body: ventanaAbierta ? textoLibre : paramAviso,
      sender_type: 'equipo', agent_contact_id: ctx.contact.id, status: 'fallido', error: err.slice(0, 500),
    });
    const plantillaPendiente = !ventanaAbierta && /132001|132000|template|plantilla/i.test(err);
    return {
      success: false,
      error: plantillaPendiente
        ? `No salió: ${nombre} no ha escrito al número en las últimas 24 h, y para eso Meta exige la plantilla ${PLANTILLA}, que sigue en revisión. En cuanto la aprueben, ya se puede.`
        : `WhatsApp rechazó el mensaje: ${err.slice(0, 200)}`,
    };
  }
}
