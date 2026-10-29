-- Velocidad: las funciones de permiso (usuario_real, es_area, soy_instalador,
-- soy_dg, mi_app_user, auth.uid, auth.role) no dependen del renglón. Envueltas
-- en (SELECT ...) Postgres las evalúa UNA vez por consulta (InitPlan) y no una
-- vez por renglón. Misma regla de acceso.
--   facturas (4,427 renglones, usuario DG): 900 ms → 38 ms.
-- 232 de 256 políticas de public ajustadas. Respaldo de las originales en
-- public._rls_politicas_respaldo_20261029. Verificado con
-- public._rls_tomar_huella('antes'|'despues'): 7 perfiles (anon + un usuario
-- por área) × 157 tablas = 1,099 conteos, 0 diferencias.
-- Idempotente: el lookbehind (?<!SELECT ) no vuelve a envolver lo ya envuelto.
-- Toda política NUEVA debe escribirse ya envuelta: ( select usuario_real() ).
create or replace function pg_temp.envolver(t text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(t,
    '(?<!SELECT )\m(usuario_real|soy_instalador|soy_dg|mi_app_user)\(\)', '( SELECT \1() )', 'g'),
    '(?<!SELECT )\mauth\.(uid|role)\(\)', '( SELECT auth.\1() )', 'g'),
    '(?<!SELECT )\mes_area\(([^()]*)\)', '( SELECT es_area(\1) )', 'g')
$$;

do $$
declare p record; nq text; nc text; sql text; k int := 0;
begin
  for p in select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    nq := pg_temp.envolver(p.qual);
    nc := pg_temp.envolver(p.with_check);
    if nq is distinct from p.qual or nc is distinct from p.with_check then
      sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
      if p.qual is not null then sql := sql || format(' using (%s)', nq); end if;
      if p.with_check is not null then sql := sql || format(' with check (%s)', nc); end if;
      execute sql;
      k := k + 1;
    end if;
  end loop;
  raise notice 'politicas ajustadas: %', k;
end $$;
