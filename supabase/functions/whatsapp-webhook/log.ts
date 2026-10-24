// Bitácora whatsapp_messages (solo service_role escribe).
export interface WaLogRow {
  direction: 'in' | 'out';
  phone_e164: string;
  wa_message_id?: string | null;
  kind?: string;
  body?: string | null;
  template_name?: string | null;
  media_path?: string | null;
  sender_type?: 'equipo' | 'cliente' | 'desconocido';
  agent_contact_id?: string | null;
  maintenance_contact_id?: string | null;
  property_id?: string | null;
  ticket_id?: string | null;
  visit_id?: string | null;
  status?: string;
  error?: string | null;
  sent_by?: string | null;
}

export async function logWa(supabase: any, row: WaLogRow) {
  try {
    const { error } = await supabase.from('whatsapp_messages').insert(row);
    if (error) console.error('whatsapp_messages insert:', error.message);
  } catch (e) { console.error('whatsapp_messages insert exc:', e); }
}

const STATUS_MAP: Record<string, string> = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' };

export async function applyStatuses(supabase: any, statuses: any[]) {
  for (const st of statuses || []) {
    const status = STATUS_MAP[st.status];
    if (!status || !st.id) continue;
    const err = st.errors?.[0] ? `${st.errors[0].code}: ${st.errors[0].title || st.errors[0].message || ''}` : null;
    try {
      await supabase.from('whatsapp_messages')
        .update({ status, error: err, updated_at: new Date().toISOString() })
        .eq('wa_message_id', st.id);
    } catch (_) { /* no crítico */ }
  }
}

export function waIdFrom(resp: any): string | null {
  return resp?.messages?.[0]?.id ?? null;
}
