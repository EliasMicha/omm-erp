-- Bitácora y freno de "¿Olvidaste tu contraseña?" (2026-11-11).
-- La escribe sólo la Edge Function recuperar-acceso (service_role). Sirve para:
--   * frenar abuso: máx. 1 correo por dirección cada 3 min y 5 por hora; 15 por IP por hora;
--   * saber qué pasó con cada solicitud (enviado / no existe / sin acceso / error),
--     porque la pantalla responde SIEMPRE lo mismo para no revelar qué correos existen.
create table if not exists public.recuperacion_acceso (
  id          bigint generated always as identity primary key,
  email       text not null,
  ip          text,
  resultado   text not null,          -- enviado | no_registrado | inactivo | sin_acceso | frenado | error
  detalle     text,
  created_at  timestamptz not null default now()
);
create index if not exists recuperacion_acceso_email_idx on public.recuperacion_acceso (email, created_at desc);
create index if not exists recuperacion_acceso_ip_idx on public.recuperacion_acceso (ip, created_at desc);
alter table public.recuperacion_acceso enable row level security;
revoke all on public.recuperacion_acceso from anon, authenticated;
