-- Coordinacion del equipo: ver obra y oficina como una sola lista.
-- Aplicado el 2026-10-07. Lo consume supabase/functions/mcp-erp/equipo.ts.
--
-- Las tareas viven en DOS tablas que no se parecen:
--   project_tasks     oficina  · responsable assignee_id   · fecha due_date
--   obra_actividades  campo    · responsable instalador_id · fecha fecha_fin_plan
-- y hasta el nombre de la obra cambia (projects.name vs obras.nombre).
--
-- Por que una vista y no dos consultas desde la app: obra_actividades ya tiene
-- 1217 renglones y PostgREST corta en 1000 SIN avisar. Contar en el servidor es
-- lo unico que da un numero que no miente.
--
-- security_invoker = true a proposito: sin eso la vista correria con los
-- permisos del dueno y se saltaria RLS. Comprobado con la llave anon: devuelve
-- cero filas, como debe.
create or replace view public.v_tareas_unificadas
with (security_invoker = true) as
select
  'oficina'::text as donde, t.id, t.name as titulo, p.name as obra, p.client_name as cliente,
  t.lead_id, t.area, t.specialty, t.assignee_id as responsable_id, e.name as responsable,
  t.status::text as estado, t.due_date as fecha_plan, t.priority::text as prioridad, t.created_at,
  (t.assignee_id is null) as sin_dueno,
  (t.due_date is null) as sin_fecha,
  (t.due_date < current_date and coalesce(t.status,'') not in ('completada','cancelada')) as vencida,
  (coalesce(t.status,'') not in ('completada','cancelada')) as abierta
from public.project_tasks t
left join public.projects  p on p.id = t.project_id
left join public.employees e on e.id = t.assignee_id
union all
select
  'obra'::text, a.id, a.descripcion, o.nombre, o.cliente,
  null::uuid, a.area, a.sistema, a.instalador_id, e.name,
  a.status::text, a.fecha_fin_plan, null::text, a.created_at,
  (a.instalador_id is null),
  (a.fecha_fin_plan is null),
  (a.fecha_fin_plan < current_date and a.status <> 'completada'),
  (a.status <> 'completada')
from public.obra_actividades a
left join public.obras     o on o.id = a.obra_id
left join public.employees e on e.id = a.instalador_id;

comment on view public.v_tareas_unificadas is
  'Tareas de oficina (project_tasks) y de campo (obra_actividades) normalizadas. security_invoker: RLS aplica al que consulta.';

-- Resumen de carga, contado en el servidor por la misma razon del tope de 1000.
-- SECURITY INVOKER: un resumen que ve mas de lo que la persona puede ver es una
-- fuga, no un reporte.
create or replace function public.panorama_tareas(p_agrupar text default 'donde')
returns table (grupo text, abiertas bigint, sin_dueno bigint, sin_fecha bigint, vencidas bigint)
language sql stable security invoker set search_path to 'public'
as $$
  select
    coalesce(
      case lower(coalesce(p_agrupar,'donde'))
        when 'persona' then responsable when 'area' then area
        when 'obra' then obra else donde end,
      -- Un nulo aqui NO es un grupo vacio que se pueda tirar: es justamente
      -- "sin responsable" o "sin obra", que es lo que se esta buscando.
      case lower(coalesce(p_agrupar,'donde'))
        when 'persona' then '— sin responsable —' when 'area' then '— sin area —'
        when 'obra' then '— sin obra —' else '—' end) as grupo,
    count(*) filter (where abierta)               as abiertas,
    count(*) filter (where abierta and sin_dueno) as sin_dueno,
    count(*) filter (where abierta and sin_fecha) as sin_fecha,
    count(*) filter (where vencida)               as vencidas
  from public.v_tareas_unificadas
  group by 1
  having count(*) filter (where abierta) > 0
  order by count(*) filter (where vencida) desc, count(*) filter (where abierta) desc;
$$;

comment on function public.panorama_tareas(text) is
  'Carga del equipo agrupada por donde|persona|area|obra. Cuenta en el servidor porque PostgREST corta en 1000.';
