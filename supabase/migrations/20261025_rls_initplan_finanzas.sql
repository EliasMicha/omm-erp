-- Rendimiento de RLS: envolver las funciones de permiso en (select ...) hace
-- que Postgres las evalúe UNA vez por consulta (InitPlan) en lugar de una vez
-- por renglón. Mismo permiso, mismo resultado; solo cambia la velocidad.
-- Motivo: Finanzas a 12 meses pasaba del statement_timeout de 8 s
-- (3.6 s -> 0.45 s en la prueba, mismo md5 del resultado).
alter policy bank_movements_con_sesion on bank_movements using ((select usuario_real()));
alter policy cash_movements_con_sesion on cash_movements using ((select usuario_real()));
alter policy payment_allocations_con_sesion on payment_allocations using ((select usuario_real()));
alter policy quotations_con_sesion on quotations using ((select usuario_real()));
alter policy quotations_app_obra on quotations using ((select soy_instalador()));
alter policy purchase_orders_con_sesion on purchase_orders using ((select usuario_real()));
alter policy purchase_orders_app_obra on purchase_orders using ((select soy_instalador()));
alter policy leads_con_sesion on leads using ((select usuario_real()));
alter policy leads_app_obra on leads using ((select soy_instalador()));
alter policy nomina_historica_solo_admin on nomina_historica using ((select es_area(array['Administracion'])));
alter policy payroll_items_solo_admin on payroll_items using ((select es_area(array['Administracion'])));
alter policy payroll_periods_solo_admin on payroll_periods using ((select es_area(array['Administracion'])));
