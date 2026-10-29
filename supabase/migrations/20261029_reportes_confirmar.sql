-- Reporte diario en tres pasos (2026-10-29). Elias: "la planeación no se cumple al
-- 100%… el primer mensaje será que te confirmen en qué obra estaban. Después, que
-- te den la retro, y que les mandes de regreso lo que captes —avances, bloqueos y
-- avisos— para que confirmen que está bien el reporte."
--
--   1. pedido + obra_confirmada=false  → se le preguntó en qué obra estuvo.
--   2. obra_confirmada=true            → manda su reporte (recibiendo).
--   3. por_confirmar                   → se le mandó lo que se entendió; contesta
--                                        "sí" (confirmado) o corrige.

alter table public.reporte_solicitudes
  add column if not exists obra_confirmada boolean not null default false,
  add column if not exists lectura_enviada_at timestamptz,
  add column if not exists confirmado_at timestamptz;

-- Lo que ya existía se trata como obra confirmada (es de antes de este flujo).
update public.reporte_solicitudes set obra_confirmada = true where not obra_confirmada;

alter table public.reporte_solicitudes drop constraint if exists reporte_solicitudes_estado_check;
alter table public.reporte_solicitudes add constraint reporte_solicitudes_estado_check
  check (estado in ('pedido','insistido','recibiendo','aclarando','por_confirmar','confirmado',
                    'no_fue','sin_respuesta','cerrado','cancelado'));

-- La lectura ("esto entendí, ¿está bien?") sale cuando el instalador deja de
-- mandar cosas 3 minutos y ya escribió (o dictó) algo: fotos solas no son reporte.
-- El cron sólo llama a la función si hay alguna lista.
select cron.schedule('wa-reportes-lecturas', '*/2 * * * *', $$
  select public.reportes_cron_llamar('lecturas')
  where exists (select 1 from public.reporte_solicitudes s
                join public.obra_reportes r on r.id = s.reporte_id
                where s.estado = 'recibiendo' and s.obra_confirmada
                  and coalesce(btrim(r.texto_raw), '') <> ''
                  and s.fecha >= current_date - 1
                  and s.ultimo_mensaje_at < now() - interval '3 minutes'
                  and (s.lectura_enviada_at is null or s.lectura_enviada_at < s.ultimo_mensaje_at))
$$);
