-- Estado privado de la conexión de OMM con WhatsApp Cloud API.
-- El navegador nunca accede a estas tablas: únicamente la función server-side
-- con service_role puede leer/escribir los identificadores y el token cifrado.

create table if not exists public.whatsapp_connections (
  id text primary key default 'omm' check (id = 'omm'),
  waba_id text not null,
  phone_number_id text not null unique,
  business_id text,
  display_phone_number text,
  verified_name text,
  platform_type text,
  is_on_biz_app boolean,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  access_token_tag text not null,
  token_expires_at timestamptz,
  subscribed_at timestamptz,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_webhook_events (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  object_type text,
  waba_id text,
  phone_number_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create index if not exists whatsapp_webhook_events_received_idx
  on public.whatsapp_webhook_events (received_at desc);

alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_webhook_events enable row level security;

revoke all on table public.whatsapp_connections from anon, authenticated;
revoke all on table public.whatsapp_webhook_events from anon, authenticated;
revoke all on sequence public.whatsapp_webhook_events_id_seq from anon, authenticated;

grant all on table public.whatsapp_connections to service_role;
grant all on table public.whatsapp_webhook_events to service_role;
grant all on sequence public.whatsapp_webhook_events_id_seq to service_role;

comment on table public.whatsapp_connections is
  'Conexión singleton de OMM a WhatsApp Cloud API; el access token se cifra con AES-256-GCM.';
comment on table public.whatsapp_webhook_events is
  'Buzón idempotente de eventos firmados recibidos desde Meta.';
