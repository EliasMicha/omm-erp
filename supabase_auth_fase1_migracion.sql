-- ════════════════════════════════════════════════════════════════════════════
-- FASE 1 — Migración de los usuarios de oficina (app_users) a Supabase Auth
-- VALIDADO en branch auth-migration-test (2026-06-09): los usuarios conservan su
-- contraseña actual (se reusa el hash bcrypt tal cual), el login funciona y el
-- permission_area viaja en el JWT (app_metadata).
--
-- SEGURO de correr en producción ANTES del cambio de frontend (Fase 2): las
-- identidades nuevas quedan creadas pero sin usarse hasta que el login del ERP
-- cambie a supabase.auth. Mientras tanto el login casero (verify_login) sigue
-- funcionando porque app_users no se altera (solo se le agrega auth_user_id).
--
-- Idempotente: solo migra filas con auth_user_id NULL. Re-ejecutar no duplica.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Columna de enlace app_users → auth.users (si no existe)
alter table public.app_users
  add column if not exists auth_user_id uuid references auth.users(id);

-- 2) Crear identidad de Auth por cada usuario de oficina, reusando su hash bcrypt
with to_migrate as (
  select id, lower(email) as email, password_hash, nombre, permission_area,
         coalesce(nivel,'ejecutor') as nivel
  from public.app_users
  where auth_user_id is null and activo and email is not null and password_hash is not null
),
new_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  )
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    m.email, m.password_hash, now(), now(), now(),
    jsonb_build_object('provider','email','providers',array['email'],
                       'permission_area', m.permission_area, 'nivel', m.nivel),
    jsonb_build_object('nombre', m.nombre), false,
    '', '', '', '', '', '', '', ''      -- GoTrue exige estos campos NO NULL
  from to_migrate m
  returning id, email
),
ins_ident as (
  insert into auth.identities (provider_id, user_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  select nu.email, nu.id,
         jsonb_build_object('sub', nu.id::text, 'email', nu.email, 'email_verified', true),
         'email', now(), now(), now()
  from new_users nu
  returning user_id
)
update public.app_users a
set auth_user_id = nu.id
from new_users nu
where lower(a.email) = nu.email;

-- 3) Helper para las políticas RLS de la Fase 3 (lee el área del JWT, con
--    respaldo a la tabla). STABLE para que el planner la cachee por query.
create or replace function public.auth_area()
returns text language sql stable as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'permission_area', ''),
    (select permission_area from public.app_users where auth_user_id = auth.uid())
  );
$$;

-- 4) Verificación
select a.email, a.permission_area, (a.auth_user_id is not null) as linked,
       (u.raw_app_meta_data->>'permission_area') as jwt_area
from public.app_users a
left join auth.users u on u.id = a.auth_user_id
order by a.email;
