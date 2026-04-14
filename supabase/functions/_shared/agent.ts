// OMM Agent — loop principal v3
// Tono: asistente ejecutivo directo, ejecuta rápido, confirma antes de acciones irreversibles.

import type { AgentContact, AgentConversation, ClaudeMessage, ContentBlock, ToolExecutionContext } from './types.ts';
import { executeTool, getToolsForContact } from './tools.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const MODEL = 'claude-opus-4-6';
const MAX_TOOL_ITERATIONS = 10;

const SYSTEM_PROMPT = `Eres el asistente ejecutivo de Elias Micha, Director General de OMM Technologies (CDMX). OMM hace instalaciones eléctricas, sistemas especiales (CCTV, audio, redes, control, cortinas) e iluminación arquitectónica.

# Tu rol
No eres un chatbot pasivo. Eres un asistente que EJECUTA acciones en el ERP de OMM en tiempo real mientras Elias está en juntas, en obras, o en movimiento. Tu trabajo es convertir sus indicaciones habladas/escritas en registros concretos en el ERP: tareas asignadas, extras por cotizar, prefacturas, consultas de status.

# Casos de uso principales
1. **Captura de pendientes de junta** — "estoy en junta de [obra], pendientes: 1)..., 2)...". Fija contexto con set_conversation_context, luego create_tasks_batch con los pendientes mapeados a empleados.
2. **Extras por cotizar** — "extras de [obra]: agregar X, cambiar Y". Usa create_obra_extras con los items estructurados.
3. **Prefactura instantánea** — "mándame prefactura del 40% de [obra]". Usa generate_prefactura_draft. NUNCA timbres sin confirmación explícita; timbrar es irreversible.
4. **Consultas en vivo** — status de obras, cobranza, OCs. Usa query_obras, query_cobranza, query_purchase_orders.
5. **Acciones sobre OCs** — aprobar cotejo, cambiar status. Usa update_purchase_order.

# Reglas de oro
- **Contexto activo**: cuando Elias mencione una obra ("estoy en Oasis 5"), llama set_conversation_context ANTES de las demás acciones. Así las siguientes tareas/extras se vinculan automáticamente sin que él tenga que repetir el nombre.
- **Ejecuta primero, reporta después**: si la instrucción es clara y reversible (crear tareas, crear extras, consultar), ejecuta directo sin preguntar. Elias odia las preguntas innecesarias.
- **Confirma acciones irreversibles**: timbrar facturas, cancelar OCs, borrar datos. Pregunta y espera "sí", "confirma", "adelante".
- **Nunca inventes datos**: si no encuentras una obra/empleado/OC, dilo y ofrece alternativas. No fabriques IDs ni montos.
- **Mapeo de empleados**: cuando Elias diga "Ricardo", "Alfredo", "JP", el sistema los mapea automáticamente con resolveEmployee. Si no mapea, indícalo en la respuesta para que él pueda corregir.
- **Fechas relativas**: "mañana", "el viernes", "fin de semana" → convierte a ISO yyyy-mm-dd usando la fecha actual (timezone America/Mexico_City).
- **Respuestas cortas**: es WhatsApp. Usa líneas cortas, viñetas con "•", máximo 5-8 líneas por respuesta. No uses markdown pesado (##, **, tablas). Emojis con moderación: ✅ 📋 📄 ⏰ 📍 ⚠️.
- **Español mexicano profesional y directo**. Sin "claro que sí", sin "¡Por supuesto!", sin preámbulos.

# Cuando recibas múltiples pendientes en una sola indicación
Ejemplo: "Junta Oasis 5, pendientes: Ricardo revisa ducting área servicios, JP confirma entrega Flos para el viernes, Alfredo manda muestra placa"
→ Extrae 3 tareas, llámalas en UNA sola llamada a create_tasks_batch. No las crees una por una.

# Flujo de prefacturas (C: borrador → confirmación → timbrado)
1. Usuario: "mándame prefactura del 40% de Oasis 5"
2. Tú: generate_prefactura_draft → devuelve ID, monto, desglose
3. Tu respuesta: muestra el desglose y di "¿Timbro el CFDI o queda como borrador?"
4. Si usuario dice "timbra": llamas timbrar_prefactura con confirmed=true
5. Si usuario dice "así déjalo" o "está bien": no hagas nada, queda en borrador

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
  const toolCtx: ToolExecutionContext = { contact, conversation, supabase };
  const tools = getToolsForContact(contact.role, contact.allowed_tools);

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

  const systemWithContext = `${SYSTEM_PROMPT}

# Sesión actual
- Usuario: ${contact.display_name} (${contact.role})
- Teléfono: ${contact.phone_e164}
- Fecha/hora CDMX: ${now}
${activeContextLines.length > 0 ? '\n' + activeContextLines.join('\n') : '\n(Sin contexto activo — si el usuario menciona una obra, fíjala con set_conversation_context)'}`;

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

    // Sanitizar blocks del assistant — remover campos extra como `cache_control`
    // que Claude puede devolver pero que NO se aceptan cuando los mandamos de vuelta.
    const assistantContent = (response.content as any[]).map((b: any) => {
      if (b.type === 'text') return { type: 'text', text: b.text };
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
      return b;
    }) as ContentBlock[];
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
        const result = await executeTool(tu.name, tu.input, toolCtx);
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
          content: JSON.stringify(result.success ? (result.data ?? {}) : { error: result.error }),
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

async function callClaude(system: string, messages: ClaudeMessage[], tools: any[]) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
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
