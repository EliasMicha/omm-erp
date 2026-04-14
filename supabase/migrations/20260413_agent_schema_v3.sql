-- ============================================================
-- OMM Agent Schema v3 — Asistente ejecutivo en vivo
-- Usa tablas existentes: project_tasks, obra_extras, facturas, etc.
-- Solo crea 5 tablas agent_* para el hilo de conversación.
-- ============================================================

-- 1. Contactos autorizados
create table if not exists agent_contacts (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text unique not null,
  display_name text not null,
  role text not null check (role in ('admin','interno','cliente','arquitecto')),
  employee_id uuid references employees(id) on delete set null,
  obra_id uuid references obras(id) on delete set null,
  allowed_tools text[] default '{}',
  metadata jsonb default '{}',
  is_active boolean default true,
  created_at timestamptz default now()
);

create index on agent_contacts(phone_e164) where is_active = true;

-- 2. Conversaciones
create table if not exists agent_conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references agent_contacts(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused','closed')),
  active_obra_id uuid references obras(id) on delete set null,  -- contexto activo ("estoy en Oasis 5")
  active_lead_id uuid references leads(id) on delete set null,
  last_message_at timestamptz default now(),
  summary text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index on agent_conversations(contact_id, last_message_at desc);

-- 3. Mensajes
create table if not exists agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references agent_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content jsonb not null,
  wa_message_id text,
  tokens_input int,
  tokens_output int,
  created_at timestamptz default now()
);

create index on agent_messages(conversation_id, created_at);
create index on agent_messages(wa_message_id) where wa_message_id is not null;

-- 4. Log de acciones (auditoría — importante para un agente que ejecuta)
create table if not exists agent_actions_log (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references agent_conversations(id) on delete set null,
  contact_id uuid references agent_contacts(id) on delete set null,
  tool_name text not null,
  tool_input jsonb not null,
  tool_output jsonb,
  status text not null check (status in ('success','error','denied','pending_confirmation')),
  error_message text,
  duration_ms int,
  -- Referencias a entidades afectadas (para poder revertir o rastrear)
  affected_entity_type text,
  affected_entity_id uuid,
  created_at timestamptz default now()
);

create index on agent_actions_log(contact_id, created_at desc);
create index on agent_actions_log(tool_name, created_at desc);
create index on agent_actions_log(affected_entity_type, affected_entity_id);

-- 5. Documentos del agente (generados o recibidos)
create table if not exists agent_documents (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references agent_conversations(id) on delete set null,
  direction text not null check (direction in ('inbound','outbound')),
  kind text,                                         -- 'prefactura_pdf','cotizacion_extras_pdf','xml_factura','voice_note', etc.
  storage_path text not null,
  mime_type text,
  size_bytes int,
  extracted_data jsonb,
  linked_entity_type text,
  linked_entity_id uuid,
  created_at timestamptz default now()
);

create index on agent_documents(conversation_id);
create index on agent_documents(linked_entity_type, linked_entity_id);

-- ============================================================
-- RLS
-- ============================================================
alter table agent_contacts enable row level security;
alter table agent_conversations enable row level security;
alter table agent_messages enable row level security;
alter table agent_actions_log enable row level security;
alter table agent_documents enable row level security;

create policy "erp_read_contacts" on agent_contacts for select using (auth.role() = 'authenticated');
create policy "erp_read_conversations" on agent_conversations for select using (auth.role() = 'authenticated');
create policy "erp_read_messages" on agent_messages for select using (auth.role() = 'authenticated');
create policy "erp_read_actions" on agent_actions_log for select using (auth.role() = 'authenticated');
create policy "erp_read_documents" on agent_documents for select using (auth.role() = 'authenticated');

-- ============================================================
-- Storage bucket
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agent-documents',
  'agent-documents',
  false,
  26214400,
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf','text/xml','application/xml','text/plain','audio/ogg','audio/mpeg','audio/mp4']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
