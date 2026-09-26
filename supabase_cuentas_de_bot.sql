-- Aplicada en Supabase el 2026-09-26. Copia para el repo.
-- Cuentas de servicio: una por bot, y ninguna puede entrar por la pantalla.
alter table public.app_users
  add column if not exists es_bot boolean not null default false,
  add column if not exists modulo text;

comment on column public.app_users.es_bot is
  'Cuenta de servicio de un bot. No puede iniciar sesion; existe para firmar lo que el bot escribe.';
comment on column public.app_users.modulo is
  'Solo para cuentas de bot: que modulo opera. Decide cual MCP y cual token le corresponde.';

update public.app_users
   set email = 'grok_crm@omniious.com', nombre = 'Grok CRM',
       permission_area = 'Ventas_Ingenieria', nivel = 'director',
       es_bot = true, modulo = 'crm'
 where email = 'grok@omniious.com';

insert into public.app_users (email, nombre, password_hash, permission_area, nivel, activo, es_bot, modulo)
values
  ('grok_contabilidad@omniious.com', 'Grok Contabilidad', 'BOT-SIN-ACCESO', 'Administracion',    'director', true, true, 'contabilidad'),
  ('grok_proyecto@omniious.com',     'Grok Proyecto',     'BOT-SIN-ACCESO', 'Ventas_Ingenieria', 'director', true, true, 'proyecto'),
  ('grok_obra@omniious.com',         'Grok Obra',         'BOT-SIN-ACCESO', 'Coordinador_Obra',  'director', true, true, 'obra')
on conflict (email) do nothing;

-- Camino viejo (verify_login) cerrado para bots.
create or replace function public.verify_login(p_email text, p_password text)
returns table(id uuid, email text, nombre text, permission_area text, nivel text, employee_id uuid, activo boolean)
language plpgsql security definer set search_path to 'public','extensions','auth'
as $function$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email, u.nombre, u.permission_area, u.nivel, u.employee_id, u.activo
  FROM app_users u
  WHERE u.email = p_email
    AND coalesce(u.es_bot, false) = false
    AND u.password_hash = crypt(p_password, u.password_hash);
END;
$function$;

-- Camino real (Supabase Auth): se banea, no se borra.
update auth.users a set banned_until = timestamptz '2999-01-01'
  from public.app_users u where u.auth_user_id = a.id and u.es_bot = true;

-- El "primer ingreso" ya no aplica a cuentas de servicio.
create or replace function public.check_email_status(p_email text)
returns table(in_app_users boolean, in_auth boolean, needs_signup boolean)
language plpgsql security definer set search_path to 'public','auth'
as $function$
BEGIN
  RETURN QUERY
  SELECT
    EXISTS (SELECT 1 FROM public.app_users WHERE lower(email)=lower(p_email) AND activo AND coalesce(es_bot,false)=false),
    EXISTS (SELECT 1 FROM auth.users WHERE lower(email)=lower(p_email)),
    (EXISTS (SELECT 1 FROM public.app_users WHERE lower(email)=lower(p_email) AND activo AND coalesce(es_bot,false)=false)
     AND NOT EXISTS (SELECT 1 FROM auth.users WHERE lower(email)=lower(p_email)));
END;
$function$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path to 'public','auth'
as $function$
DECLARE existing_app_user_id uuid;
BEGIN
  SELECT id INTO existing_app_user_id FROM public.app_users
   WHERE lower(email)=lower(NEW.email) AND auth_user_id IS NULL
     AND coalesce(es_bot,false)=false
   LIMIT 1;
  IF existing_app_user_id IS NOT NULL THEN
    UPDATE public.app_users SET auth_user_id = NEW.id WHERE id = existing_app_user_id;
    UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

drop function if exists public.get_my_app_user();
create function public.get_my_app_user()
returns table(id uuid, email text, nombre text, permission_area text, nivel text,
              employee_id uuid, activo boolean, auth_user_id uuid, es_bot boolean, modulo text)
language plpgsql security definer set search_path to 'public','auth'
as $function$
DECLARE uid uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT au.id, au.email, au.nombre, au.permission_area::text, au.nivel::text,
         au.employee_id, au.activo, au.auth_user_id, coalesce(au.es_bot,false), au.modulo
  FROM public.app_users au WHERE au.auth_user_id = uid LIMIT 1;
END;
$function$;
grant execute on function public.get_my_app_user() to anon, authenticated;
