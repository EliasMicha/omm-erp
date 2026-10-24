// Tipos compartidos del agente OMM — versión asistente ejecutivo

export interface AgentContact {
  id: string;
  phone_e164: string;
  display_name: string;
  role: 'admin' | 'interno' | 'cliente' | 'arquitecto';
  employee_id: string | null;
  obra_id: string | null;
  allowed_tools: string[];
  is_active: boolean;
}

export interface AgentConversation {
  id: string;
  contact_id: string;
  status: 'active' | 'paused' | 'closed';
  active_obra_id: string | null;    // contexto activo
  active_lead_id: string | null;
  last_message_at: string;
  summary: string | null;
}

// Bloques de contenido Anthropic Messages API
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean };

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolExecutionContext {
  contact: AgentContact;
  conversation: AgentConversation;
  supabase: any;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  user_facing_message?: string;
  // Para auditoría
  affected_entity_type?: string;
  affected_entity_id?: string;
  // Para acciones que requieren confirmación del usuario
  requires_confirmation?: boolean;
  confirmation_prompt?: string;
}
