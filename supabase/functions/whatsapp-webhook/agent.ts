// OMM Agent — loop principal v3
// Tono: asistente ejecutivo directo, ejecuta rápido, confirma antes de acciones irreversibles.

import type { AgentContact, AgentConversation, ClaudeMessage, ContentBlock, ToolExecutionContext } from './types.ts';
import { executeTool, getToolsForContact, REEMPLAZADAS_POR_MCP } from './tools.ts';
import { sesionDe } from './sesion.ts';
import { definicionesMcp, esMcp, ejecutarMcp } from './mcp.ts';
import { DELEGATION_PROMPT, delegationTools, executeDelegationTool, isDelegationCoach } from './delegation.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
// El más nuevo; si la API no lo acepta, se cae al anterior (MODELO_RESPALDO).
const MODEL = 'claude-opus-5-5';
const MODELO_RESPALDO = 'claude-opus-4-6';
const MAX_TOOL_ITERATIONS = 10;

const SYSTEM_PROMPT = `Eres el asistente ejecutivo de Elias Micha, Director General de OMM Technologies (CDMX). OMM hace instalaciones eléctricas, sistemas especiales (CCTV, audio, redes, control, cortinas) e iluminación arquitectónica.

# Tu rol
No eres un chatbot pasivo. Eres un asistente que EJECUTA acciones en el ERP de OMM en tiempo real mientras Elias está en juntas, en obras, o en movimiento. Tu trabajo es convertir sus indicaciones habladas/escritas en registros concretos en el ERP: tareas asignadas, extras por cotizar, prefacturas, consultas de status.

# Cómo está armado el ERP (léelo antes de buscar)
- **El LEAD es la entidad maestra.** Cotizaciones, compras, cobros y estado de cuenta cuelgan del lead. Busca primero el lead (buscar_leads / ver_lead) y desde ahí todo lo demás.
- Los leads se llaman como el sitio + la unidad + el cliente: "Cero5cien L202 - Eduardo Tawil". Cero5cien es un EDIFICIO con muchos clientes distintos; la unidad (L202, O402, A101…) y el nombre son lo que identifica al cliente. Si te dicen "Tawil" o "L202", busca por esa palabra.
- **Proyecto** = trabajo de oficina (planos, ingeniería). **Obra** = ejecución en sitio. No los confundas.
- **La cobranza va por lead y cotización, NO por obra.** Una obra sin proyecto ligado NO impide sacar la cobranza: usa cobranza (MCP) o enviar_estado_de_cuenta con el lead.
- Las cotizaciones tienen folio tipo "DLAN-ES01" (lead-especialidad-número). Vendido = cotizaciones en etapa contrato.
- Montos en MXN y USD van SEPARADOS. No los sumes sin tipo de cambio.

# Casos de uso principales
1. **Captura de pendientes de junta** — fija contexto con set_conversation_context y usa create_tasks_batch con los pendientes mapeados a empleados.
2. **Extras por cotizar** — create_obra_extras.
3. **Prefactura** — generate_prefactura_draft. Tú SOLO generas el borrador: no puedes timbrar; el timbrado se hace en el ERP → Facturación.
4. **Consultas** — leads, cotizaciones, obras, cobranza, facturas, compras, tareas del equipo, contabilidad: usa las herramientas del ERP (buscar_leads, ver_lead, buscar_cotizaciones, ver_cotizacion, ver_obra, cobranza, buscar_facturas, buscar_ordenes_compra, panorama_equipo, buscar_tareas, conta_*…).
5. **Documentos al chat** — enviar_cotizacion (PDF de cotización) y enviar_estado_de_cuenta (PDF del estado de cuenta de un lead). Se mandan a quien los pide.
6. **WhatsApp** — whatsapp_conversaciones y whatsapp_leer para ver quién escribió; whatsapp_enviar para mandar un mensaje. Si la respuesta trae requiere_aprobacion, ENSEÑA la vista previa y pregunta "¿Lo mando?"; solo con un sí vuelve a llamar con confirmar=true.
7. **Compras** — ver, cotejar, aprobar o generar órdenes de compra con las herramientas de compras.

# Si algo no aparece
- Antes de decir que no se puede, prueba otra ruta: por lead, por folio, por una sola palabra del nombre. No culpes a un dato faltante (como "no tiene project_id") si existe otra herramienta que lo resuelva.
- Si una búsqueda da varios resultados, enséñalos y pregunta cuál. Nunca escojas el primero a ciegas.

# Reglas de oro
- **Contexto activo**: cuando Elias mencione una obra ("estoy en Oasis 5"), llama set_conversation_context ANTES de las demás acciones. Así las siguientes tareas/extras se vinculan automáticamente sin que él tenga que repetir el nombre.
- **Ejecuta primero, reporta después**: si la instrucción es clara y reversible (crear tareas, crear extras, consultar), ejecuta directo sin preguntar. Elias odia las preguntas innecesarias.
- **Confirma acciones irreversibles**: cancelar OCs, mandar mensajes a terceros, borrar datos. Pregunta y espera "sí", "confirma", "adelante".
- **Nunca inventes datos**: si no encuentras una obra/empleado/OC, dilo y ofrece alternativas. No fabriques IDs ni montos.
- **Mapeo de empleados**: cuando Elias diga "Ricardo", "Alfredo", "JP", el sistema los mapea automáticamente con resolveEmployee. Si no mapea, indícalo en la respuesta para que él pueda corregir.
- **Fechas relativas**: "mañana", "el viernes", "fin de semana" → convierte a ISO yyyy-mm-dd usando la fecha actual (timezone America/Mexico_City).
- **Respuestas cortas**: es WhatsApp. Usa líneas cortas, viñetas con "•", máximo 5-8 líneas por respuesta. No uses markdown pesado (##, **, tablas). Emojis con moderación: ✅ 📋 📄 ⏰ 📍 ⚠️.
- **Español mexicano profesional y directo**. Sin "claro que sí", sin "¡Por supuesto!", sin preámbulos.

# Cuando recibas múltiples pendientes en una sola indicación
Ejemplo: "Junta Oasis 5, pendientes: Ricardo revisa ducting área servicios, JP confirma entrega Flos para el viernes, Alfredo manda muestra placa"
→ Extrae 3 tareas, llámalas en UNA sola llamada a create_tasks_batch. No las crees una por una.

# Flujo de prefacturas (solo borrador)
1. Usuario: "mándame prefactura del 40% de Oasis 5"
2. Tú: generate_prefactura_draft → devuelve ID, monto, desglose
3. Tu respuesta: muestra el desglose y aclara que quedó como BORRADOR.
4. Si piden timbrar: di que el bot no timbra; se revisa y timbra en el ERP → Facturación.

# Lo que NO haces
- No procesas reportes de obra (eso lo hace la app de instaladores)
- No respondes preguntas que requieran inventar datos
- No ejecutas acciones fuera del scope del ERP sin razón
- No usas las tools para cosas que puedes contestar directo (ej. aritmética simple, explicaciones conceptuales)`;

interface RunAgentArgs {
  contact: AgentContact;
  conversation: AgentConversation;
  history: ClaudeMessage[];
  newUserMessage: ContentBlock[];
  supabase: any;
}

interface RunAgentResult {
  finalText: string;
  allNewMessages: ClaudeMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
}

export async function runAgent(args: RunAgentArgs): Promise<RunAgentResult> {
  const { contact, conversation, history, newUserMessage, supabase } = args;
  // El bot actúa como la persona: con su JWT corren las herramientas del MCP.
  const sesion = await sesionDe(supabase, contact);
  const toolCtx: ToolExecutionContext = { contact, conversation, supabase, sesion };
  // El modo delegación SUMA herramientas al asistente; ya no lo reemplaza.
  // (Antes lo dejaba en solo-lectura: no podía crear tareas, mandar mensajes ni cotizaciones.)
  const coach = isDelegationCoach(contact);
  const propias = getToolsForContact(contact.role, contact.allowed_tools)
    .filter((t) => !(sesion && REEMPLAZADAS_POR_MCP.has(t.name)));
  const tools = [
    ...propias,
    ...(sesion ? definicionesMcp() : []),
    ...(coach ? delegationTools : []),
  ];
  const nombresDelegacion = new Set(delegationTools.map((t) => t.name));

  // Contexto dinámico que Claude ve
  const activeContextLines: string[] = [];
  if (conversation.active_obra_id) {
    const { data: obra } = await supabase
      .from('obras')
      .select('nombre, cliente, status, avance_global')
      .eq('id', conversation.active_obra_id)
      .maybeSingle();
    if (obra) {
      activeContextLines.push(`Obra activa: ${obra.nombre} (${obra.cliente}) — status ${obra.status}, avance ${obra.avance_global ?? 0}%`);
    }
  }
  if (conversation.active_lead_id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('name, company, status')
      .eq('id', conversation.active_lead_id)
      .maybeSingle();
    if (lead) activeContextLines.push(`Lead activo: ${lead.name} (${lead.company}) — ${lead.status}`);
  }

  const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'full', timeStyle: 'short' });

  const systemWithContext = `${SYSTEM_PROMPT}${coach ? '\n\n# Modo delegación (además de todo lo anterior)\n' + DELEGATION_PROMPT : ''}

# Importante
Si en mensajes anteriores de esta conversación dijiste que solo podías leer o preparar borradores, eso ya no aplica: hoy puedes ejecutar con las herramientas que tienes.

# Sesión actual
- Usuario: ${contact.display_name} (${contact.role})
- Teléfono: ${contact.phone_e164}
- Fecha/hora CDMX: ${now}
${activeContextLines.length > 0 ? '\n' + activeContextLines.join('\n') : coach ? '\n(Sin contexto activo; consulta el ERP para identificar el encargo.)' : '\n(Sin contexto activo — si el usuario menciona una obra, fíjala con set_conversation_context)'}`;

  const messages: ClaudeMessage[] = [
    ...history,
    { role: 'user', content: newUserMessage },
  ];
  const allNewMessages: ClaudeMessage[] = [{ role: 'user', content: newUserMessage }];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalText = '';

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await callClaude(systemWithContext, messages, tools);
    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // DEBUG: log what Claude returned
    console.log('Claude raw content:', JSON.stringify(response.content));

    // Sanitizar blocks del assistant — remover campos extra como `cache_control`
    // que Claude puede devolver pero que NO se aceptan cuando los mandamos de vuelta.
    const assistantContent = (response.content as any[]).map((b: any) => {
      if (b.type === 'text') return { type: 'text', text: b.text };
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
      return b;
    }) as ContentBlock[];
    console.log('Sanitized assistant content:', JSON.stringify(assistantContent));
    messages.push({ role: 'assistant', content: assistantContent });
    allNewMessages.push({ role: 'assistant', content: assistantContent });

    const toolUses = assistantContent.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use'
    );

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      finalText = assistantContent
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
      break;
    }

    // Ejecutar tools en paralelo
    const toolResultBlocks: ContentBlock[] = await Promise.all(
      toolUses.map(async (tu) => {
        const started = Date.now();
        const result = nombresDelegacion.has(tu.name)
          ? await executeDelegationTool(tu.name, tu.input, toolCtx)
          : sesion && esMcp(tu.name)
          ? await ejecutarMcp(tu.name, tu.input, sesion)
          : await executeTool(tu.name, tu.input, toolCtx);
        const duration = Date.now() - started;

        // Log de auditoría
        await supabase.from('agent_actions_log').insert({
          conversation_id: conversation.id,
          contact_id: contact.id,
          tool_name: tu.name,
          tool_input: tu.input,
          tool_output: result.data ?? null,
          status: result.success ? 'success' : (result.requires_confirmation ? 'pending_confirmation' : 'error'),
          error_message: result.error ?? null,
          duration_ms: duration,
          affected_entity_type: result.affected_entity_type ?? null,
          affected_entity_id: result.affected_entity_id ?? null,
        });

        // Refrescar contexto si la tool lo modificó
        if (tu.name === 'set_conversation_context' && result.success) {
          const { data: refreshed } = await supabase
            .from('agent_conversations')
            .select('active_obra_id, active_lead_id')
            .eq('id', conversation.id)
            .maybeSingle();
          if (refreshed) {
            conversation.active_obra_id = refreshed.active_obra_id;
            conversation.active_lead_id = refreshed.active_lead_id;
          }
        }

        const resultBlock: any = {
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result.success ? (result.data ?? {}) : { error: result.error, ...(result.data ? { detalle: result.data } : {}) }).slice(0, 60000),
        };
        if (!result.success) {
          resultBlock.is_error = true;
        }
        return resultBlock;
      }),
    );

    const userToolMsg: ClaudeMessage = { role: 'user', content: toolResultBlocks };
    messages.push(userToolMsg);
    allNewMessages.push(userToolMsg);
  }

  if (!finalText) {
    finalText = 'Procesé tu solicitud pero no generé respuesta final. Revisa el log del ERP.';
  }

  return { finalText, allNewMessages, totalInputTokens, totalOutputTokens };
}

let modeloEnUso = MODEL;
async function callClaude(system: string, messages: ClaudeMessage[], tools: any[]): Promise<any> {
  try {
    return await callClaudeCon(modeloEnUso, system, messages, tools);
  } catch (e) {
    // Si el modelo nuevo no existe para esta llave, se usa el anterior el resto de la vida del proceso.
    if (modeloEnUso !== MODELO_RESPALDO && /model|not_found|404/i.test(String(e))) {
      console.error('Modelo', modeloEnUso, 'no disponible; uso', MODELO_RESPALDO, String(e).slice(0, 200));
      modeloEnUso = MODELO_RESPALDO;
      return await callClaudeCon(modeloEnUso, system, messages, tools);
    }
    throw e;
  }
}

async function callClaudeCon(model: string, system: string, messages: ClaudeMessage[], tools: any[]) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages,
      tools,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  return res.json();
}
