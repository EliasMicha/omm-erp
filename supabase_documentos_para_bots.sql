-- ═══════════════════════════════════════════════════════════════════════════
--  Un bot autorizado puede sacar el estado de cuenta de un cliente
--  (2026-09-30)
--  Migración aplicada: `bot_puede_estado_de_cuenta`
--
--  Elias: "estoy usando Dot de ChatGPT, y tiene acceso a la base de datos del
--  ERP... pero el descargar y mandarme el PDF de un estado de cuenta no lo
--  pueden hacer porque es un botón de frontend. ¿Existe forma de hacer ese
--  tipo de movimientos para que bots autorizados puedan sacar esos PDF desde
--  el backend?"
--
--  ── El problema de fondo no era el PDF ──────────────────────────────────
--
--  El estado de cuenta se armaba DENTRO del navegador. No es que al bot le
--  faltaran permisos: la capacidad no existía fuera del navegador, no había
--  nada que llamar. La regla general, que aplica a todo lo que siga:
--
--    Lo que un bot tenga que poder hacer tiene que existir como código de
--    servidor, y el botón pasa a ser un cliente más de ese código.
--
--  ── Dónde vive ──────────────────────────────────────────────────────────
--
--  En el Edge Function `mcp-contabilidad`, no en /api. Dos razones duras:
--  /api está en el tope de 12 funciones del plan Hobby de Vercel, y una
--  función de ahí NO puede importar de src/ (ya tumbó api/gmail.ts entero).
--  El MCP ya tiene autenticación por token, el límite de tablas de acotar.ts
--  y la idempotencia.
--
--  ── El permiso ──────────────────────────────────────────────────────────
--
--  `app_users.puede_estado_cuenta`, booleano, apagado de fábrica, se prende
--  bot por bot desde Usuarios. Un token abre el MÓDULO; esta bandera abre
--  ESTE documento. Es específica a propósito: cuando se agregue la orden de
--  compra o la estimación, cada una trae su bandera, para que prender una no
--  abra las demás en los bots que ya tenían permiso de otra cosa.
--
--  ── El bucket rompe el patrón de la casa, a propósito ───────────────────
--
--  Los demás buckets del ERP son públicos con cuatro políticas abiertas. Este
--  es PRIVADO y SIN políticas: lo que guarda es el estado de cuenta de un
--  cliente —sus contratos, sus saldos, lo que debe— y una política abierta lo
--  dejaría legible para cualquier sesión, incluida la anónima. Solo lo escribe
--  y lo firma el Edge Function con la llave de servicio, que no pasa por RLS.
--
--  El que copie de aquí para otro bucket: el patrón de las cuatro políticas
--  abiertas es para archivos de la empresa, no para documentos de un cliente.
--
--  ── Cómo sale el PDF ────────────────────────────────────────────────────
--
--  No en base64 dentro de la respuesta —es enorme y los modelos lo maltratan—
--  sino como liga firmada de 15 minutos. El archivo se borra a las 24 horas:
--  un estado de cuenta viviendo ahí para siempre es un pasivo, no un respaldo,
--  porque el ERP lo puede regenerar cuando quiera.
--
--  ── Rastro ──────────────────────────────────────────────────────────────
--
--  Cada generación deja un renglón en activity_log (entity_type 'lead',
--  action 'estado_cuenta_bot') con quién la pidió y de qué cliente. Si ese
--  registro falla NO se tumba la entrega —el PDF ya existe y negarlo no lo
--  borra— pero la respuesta lo dice.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.app_users
  add column if not exists puede_estado_cuenta boolean not null default false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-cliente', 'documentos-cliente', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 20971520,
      allowed_mime_types = array['application/pdf'];

-- ── Lo que FALTA para que funcione ─────────────────────────────────────────
--
--  `GROK_MCP_CONTABILIDAD_TOKEN` NO está puesto en los secretos de Supabase.
--  Verificado el 2026-09-30: la función contesta 500 "Servidor sin configurar"
--  a cualquier llamada. Mientras no exista ese secreto, NINGÚN bot puede usar
--  este MCP —ni esta herramienta ni las cinco que ya tenía—. Lo pone Elias;
--  yo no manejo secretos.
