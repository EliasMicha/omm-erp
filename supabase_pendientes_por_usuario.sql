-- ═══════════════════════════════════════════════════════════════════════════
--  Pendientes del panel personal: de cada usuario, no del area.
--  Aplicado en produccion el 2026-09-26 (migracion action_items_owner_user).
--
--  Antes "Mis pendientes" cargaba todos los action_items con area='DG', asi que
--  cualquier usuario con permisos de DG veia —y podia borrar— los pendientes
--  del director. No se puede usar created_by para separarlos: esa columna
--  cuelga de employees, y hay usuarios sin ficha de empleado.
-- ═══════════════════════════════════════════════════════════════════════════

alter table action_items
  add column if not exists owner_user_id uuid references app_users(id) on delete set null;

create index if not exists ix_action_items_owner
  on action_items (owner_user_id) where owner_user_id is not null;

-- Lo que ya existia en el panel era del director.
-- update action_items set owner_user_id = '<app_user del director>'
--  where source_type = 'dashboard' and owner_user_id is null;
-- update rutinas set created_by = '<app_user del director>' where created_by is null;
