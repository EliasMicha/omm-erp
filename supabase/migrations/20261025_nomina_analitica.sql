-- Analíticos de nómina: un renglón por persona y mes, de ene-2025 a hoy.
-- Regla (la misma que Finanzas): si el mes tiene un periodo CERRADO en el
-- módulo de nómina, se usa el módulo; si no, el historial cargado del Excel
-- (nomina_historica). No modifica nada: solo lee. SECURITY INVOKER, así que
-- respeta el RLS de payroll_* y nomina_historica.
create or replace function public.nomina_analitica()
returns table(mes date, quien text, nombre text, linea text, area text,
              transferencia numeric, efectivo numeric, fuente text, es_persona boolean)
language sql stable security invoker set search_path = public as $$
  with cerr as (
    select make_date(anio, mes, 1) m from payroll_periods
     group by 1 having bool_or(coalesce(estatus, status::text) = 'cerrado'))
  select make_date(pp.anio, pp.mes, 1), pi.employee_id::text, max(e.nombre),
         max(omm_linea_de_area(e.area)), max(e.area),
         sum(coalesce(pi.neto_a_pagar_cfdi, 0)), sum(coalesce(pi.total_efectivo_final, 0)),
         'modulo', true
    from payroll_items pi
    join payroll_periods pp on pp.id = pi.period_id
    join employees e on e.id = pi.employee_id
   where make_date(pp.anio, pp.mes, 1) in (select m from cerr)
   group by 1, 2
  union all
  select h.mes, coalesce(h.employee_id::text, 'h:' || h.nombre), max(coalesce(e.nombre, h.nombre)),
         max(h.linea), max(coalesce(h.area_excel, e.area)),
         sum(h.transferencia), sum(h.efectivo),
         'historial', not (h.employee_id is null and h.nombre like 'Bonos y aguinaldos%')
    from nomina_historica h
    left join employees e on e.id = h.employee_id
   where h.mes not in (select m from cerr)
   group by 1, 2, h.employee_id, h.nombre
$$;

revoke execute on function public.nomina_analitica() from public, anon;
grant execute on function public.nomina_analitica() to authenticated;
