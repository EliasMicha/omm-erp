-- Bitácora de WhatsApp Cloud API (número dedicado de OMM).
-- Entrantes y salientes, de equipo y de clientes. Solo el backend (service_role) escribe;
-- cualquier usuario real del ERP puede leer.
create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('in','out')),
  phone_e164 text not null,
  wa_message_id text unique,
  kind text not null default 'text',              -- text | image | document | audio | template | ...
  body text,
  template_name text,
  media_path text,                                -- bucket agent-documents
  sender_type text not null default 'desconocido' -- equipo | cliente | desconocido
    check (sender_type in ('equipo','cliente','desconocido')),
  agent_contact_id uuid references public.agent_contacts(id) on delete set null,
  maintenance_contact_id uuid references public.maintenance_contacts(id) on delete set null,
  property_id uuid references public.maintenance_properties(id) on delete set null,
  ticket_id uuid references public.maintenance_tickets(id) on delete set null,
  visit_id uuid references public.maintenance_visits(id) on delete set null,
  status text not null default 'recibido',        -- recibido | enviado | entregado | leido | fallido
  error text,
  sent_by uuid,                                   -- auth.uid() de quien disparó un saliente
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists whatsapp_messages_created_idx on public.whatsapp_messages (created_at desc);
create index if not exists whatsapp_messages_phone_idx on public.whatsapp_messages (phone_e164, created_at desc);

alter table public.whatsapp_messages enable row level security;
drop policy if exists whatsapp_messages_lectura on public.whatsapp_messages;
create policy whatsapp_messages_lectura on public.whatsapp_messages for select using (public.usuario_real());
revoke insert, update, delete on public.whatsapp_messages from anon, authenticated;
grant all on public.whatsapp_messages to service_role;
