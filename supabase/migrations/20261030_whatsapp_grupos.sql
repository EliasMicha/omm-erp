-- Grupos de WhatsApp desde el número de OMM (2026-10-30).
-- Elias: "Ya tengo palomita azul, podemos ver de que pueda hacer grupos". Uso: grupos
-- de obra con el cliente y grupos internos de cuadrilla. El bot NO participa: el
-- equipo escribe desde /wa y /whatsapp.
--
-- Meta (Groups API, cuenta oficial): máximo 8 participantes además de OMM, sólo se
-- entra con liga de invitación, ventana de 24 h compartida por todo el grupo.
--
-- Los mensajes de grupo van en su propia tabla y NO en whatsapp_messages: muchas
-- reglas leen whatsapp_messages para saber si la ventana de 24 h de una PERSONA
-- está abierta, y escribir en un grupo no abre la ventana individual.

create table if not exists public.whatsapp_grupos (
  id uuid primary key default gen_random_uuid(),
  group_id text unique,                       -- lo asigna Meta; null mientras se crea
  nombre text not null,
  descripcion text,
  tipo text not null default 'obra' check (tipo in ('obra','interno')),
  obra_id uuid references public.obras(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  invite_link text,
  join_approval_mode text not null default 'auto_approve',
  participantes jsonb not null default '[]'::jsonb,   -- [{wa_id}]
  estado text not null default 'creando' check (estado in ('creando','activo','suspendido','borrado','error')),
  error text,
  created_by uuid,                                    -- auth uid de quien lo creó
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_grupo_mensajes (
  id uuid primary key default gen_random_uuid(),
  group_id text not null,
  direction text not null check (direction in ('in','out')),
  from_phone text,              -- participante que escribió (in)
  from_nombre text,             -- nombre de perfil de WhatsApp (in)
  wa_message_id text,
  kind text not null default 'text',
  body text,
  template_name text,
  media_path text,              -- agent-documents: grupos/<group_id>/…
  status text not null default 'recibido',
  error text,
  sent_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists whatsapp_grupo_mensajes_grupo on public.whatsapp_grupo_mensajes (group_id, created_at desc);
create unique index if not exists whatsapp_grupo_mensajes_wamid on public.whatsapp_grupo_mensajes (wa_message_id) where wa_message_id is not null and direction = 'in';

alter table public.whatsapp_grupos enable row level security;
alter table public.whatsapp_grupo_mensajes enable row level security;
-- Leen Administración y DG (los mismos que ven /whatsapp). Escribe sólo service_role
-- (las Edge Functions whatsapp-grupos y whatsapp-webhook).
create policy whatsapp_grupos_select on public.whatsapp_grupos for select to authenticated
  using ((select es_area(array['Administracion'])));
create policy whatsapp_grupo_mensajes_select on public.whatsapp_grupo_mensajes for select to authenticated
  using ((select es_area(array['Administracion'])));
revoke all on public.whatsapp_grupos, public.whatsapp_grupo_mensajes from anon;

-- Interruptor: crear grupos queda apagado hasta que el webhook que separa los
-- mensajes de grupo esté desplegado (si no, un mensaje en el grupo le llegaría al
-- bot como si fuera privado).
insert into public.whatsapp_ajustes (clave, valor) values ('grupos_listos', 'false'::jsonb)
  on conflict (clave) do nothing;
