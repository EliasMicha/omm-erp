-- ═══════════════════════════════════════════════════════════════════
-- MÓDULO PROYECTOS v2 — Modelo unificado con tareas multi-fase
-- REEMPLAZA la migration anterior (8415f02). Ejecutar en SQL Editor.
-- ═══════════════════════════════════════════════════════════════════
--
-- Cambios respecto a v1:
-- 1. Fases homologadas a 5 para las 3 especialidades: Arranque, Conceptual,
--    Diseño, Revisión, Ejecutivo
-- 2. Tareas template tienen start_phase_order y end_phase_order: las tareas
--    transversales se clonan en todas las fases del rango al instanciar
-- 3. Columna expands_by_system en tareas template: si true, al instanciar
--    el proyecto se genera una subtask por cada sistema presente en la
--    cotización ligada (aplica solo a ESP)
-- 4. Columna system en project_task_subtasks: para agrupar subtasks por
--    sistema en la UI de ESP
-- 5. projects.lead_id como columna directa (obligatorio desde UI, opcional
--    en schema)
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. AJUSTES EN projects ───────────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS specialty TEXT
  CHECK (specialty IN ('esp','elec','ilum','cort','proy'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS area_lead_id UUID REFERENCES employees(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cotizacion_id UUID REFERENCES quotations(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id);

UPDATE projects SET specialty = lines[1]
  WHERE specialty IS NULL AND lines IS NOT NULL AND array_length(lines, 1) > 0;

-- ─── 2. TEMPLATES: DROP Y RECREATE CON NUEVO SCHEMA ───────────────
DROP TABLE IF EXISTS project_task_templates CASCADE;
DROP TABLE IF EXISTS project_phase_templates CASCADE;

CREATE TABLE project_phase_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  specialty TEXT NOT NULL
    CHECK (specialty IN ('esp','elec','ilum','cort','proy','postventa')),
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_post_sale BOOLEAN DEFAULT false,
  activation_rule TEXT,
  description TEXT
);

CREATE TABLE project_task_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  specialty TEXT NOT NULL
    CHECK (specialty IN ('esp','elec','ilum','cort','proy','postventa')),
  name TEXT NOT NULL,
  start_phase_order INTEGER NOT NULL,
  end_phase_order INTEGER NOT NULL,
  expands_by_system BOOLEAN DEFAULT false,
  default_subtasks TEXT[] DEFAULT '{}',
  order_index INTEGER NOT NULL DEFAULT 0,
  description TEXT
);

-- ─── 3. TABLAS DE INSTANCIAS ──────────────────────────────────────
-- Estas no se tocan si ya existen (de la migration v1), solo les
-- agregamos columnas nuevas. Si no existen, las creamos.
CREATE TABLE IF NOT EXISTS project_phases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id UUID,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_post_sale BOOLEAN DEFAULT false,
  is_unlocked BOOLEAN DEFAULT true,
  unlocked_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pendiente'
    CHECK (status IN ('pendiente','en_progreso','completada','bloqueada')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id UUID NOT NULL REFERENCES project_phases(id) ON DELETE CASCADE,
  template_id UUID,
  name TEXT NOT NULL,
  description TEXT,
  assignee_id UUID REFERENCES employees(id),
  status TEXT DEFAULT 'pendiente'
    CHECK (status IN ('pendiente','en_progreso','bloqueada','completada')),
  priority INTEGER DEFAULT 0,
  progress INTEGER DEFAULT 0,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  system TEXT,
  area TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS project_task_subtasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  order_index INTEGER NOT NULL DEFAULT 0
);

-- Columna nueva para subtasks agrupadas por sistema (solo ESP las usa)
ALTER TABLE project_task_subtasks ADD COLUMN IF NOT EXISTS system TEXT;

-- ─── 4. LIMPIEZA DE DATOS VIEJOS (proyectos de prueba) ────────────
-- Como el modelo cambió, borramos los proyectos que se hayan creado
-- con la migration anterior. En producción real esto se protegería
-- pero ahora solo hay datos de prueba.
DELETE FROM project_task_subtasks;
DELETE FROM project_tasks;
DELETE FROM project_phases;

-- ═══════════════════════════════════════════════════════════════════
-- ÍNDICES
-- ═══════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_projects_specialty ON projects(specialty);
CREATE INDEX IF NOT EXISTS idx_projects_lead ON projects(lead_id);
CREATE INDEX IF NOT EXISTS idx_proj_phases_project ON project_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_proj_phases_order ON project_phases(project_id, order_index);
CREATE INDEX IF NOT EXISTS idx_proj_tasks_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_proj_tasks_phase ON project_tasks(phase_id);
CREATE INDEX IF NOT EXISTS idx_proj_tasks_template ON project_tasks(template_id);
CREATE INDEX IF NOT EXISTS idx_proj_tasks_status ON project_tasks(status);
CREATE INDEX IF NOT EXISTS idx_proj_subtasks_task ON project_task_subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_phase_templates_spec ON project_phase_templates(specialty, order_index);
CREATE INDEX IF NOT EXISTS idx_task_templates_spec ON project_task_templates(specialty, order_index);

-- ═══════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE project_phase_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_task_subtasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for anon - phase templates" ON project_phase_templates;
DROP POLICY IF EXISTS "Allow all for anon - task templates" ON project_task_templates;
DROP POLICY IF EXISTS "Allow all for anon - project phases" ON project_phases;
DROP POLICY IF EXISTS "Allow all for anon - project tasks" ON project_tasks;
DROP POLICY IF EXISTS "Allow all for anon - project subtasks" ON project_task_subtasks;

CREATE POLICY "Allow all for anon - phase templates" ON project_phase_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon - task templates" ON project_task_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon - project phases" ON project_phases FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon - project tasks" ON project_tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon - project subtasks" ON project_task_subtasks FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════
-- SEED: FASES TEMPLATE (5 pre-venta × 3 especialidades + 3 postventa)
-- ═══════════════════════════════════════════════════════════════════

-- ESP
INSERT INTO project_phase_templates (specialty, name, order_index, is_post_sale, activation_rule) VALUES
  ('esp', 'Arranque',   1, false, 'always'),
  ('esp', 'Conceptual', 2, false, 'always'),
  ('esp', 'Diseño',     3, false, 'always'),
  ('esp', 'Revisión',   4, false, 'always'),
  ('esp', 'Ejecutivo',  5, false, 'always');

-- ILU
INSERT INTO project_phase_templates (specialty, name, order_index, is_post_sale, activation_rule) VALUES
  ('ilum', 'Arranque',   1, false, 'always'),
  ('ilum', 'Conceptual', 2, false, 'always'),
  ('ilum', 'Diseño',     3, false, 'always'),
  ('ilum', 'Revisión',   4, false, 'always'),
  ('ilum', 'Ejecutivo',  5, false, 'always');

-- ELEC
INSERT INTO project_phase_templates (specialty, name, order_index, is_post_sale, activation_rule) VALUES
  ('elec', 'Arranque',   1, false, 'always'),
  ('elec', 'Conceptual', 2, false, 'always'),
  ('elec', 'Diseño',     3, false, 'always'),
  ('elec', 'Revisión',   4, false, 'always'),
  ('elec', 'Ejecutivo',  5, false, 'always');

-- POSTVENTA universal (se agrega a todos los proyectos con is_unlocked=false)
INSERT INTO project_phase_templates (specialty, name, order_index, is_post_sale, activation_rule) VALUES
  ('postventa', 'Suministro',          100, true, 'on_contract'),
  ('postventa', 'Seguimiento de Obra', 101, true, 'on_contract'),
  ('postventa', 'Cierre',              102, true, 'on_contract');

-- ═══════════════════════════════════════════════════════════════════
-- SEED: TAREAS TEMPLATE
-- (name, specialty, start_phase_order, end_phase_order, expands_by_system, default_subtasks)
-- ═══════════════════════════════════════════════════════════════════

-- ─── ESP (10 tareas, 4 multi-fase + Carpeta de Fichas expande por sistema) ─
INSERT INTO project_task_templates (specialty, name, start_phase_order, end_phase_order, expands_by_system, default_subtasks, order_index) VALUES
  ('esp', 'Definición de Sistemas y Alcances', 1, 1, false,
    ARRAY['Revisar planos arquitectónicos','Identificar necesidades del cliente','Definir alcance por sistema','Documentar restricciones técnicas'], 1),
  ('esp', 'Recopilación de Planos', 1, 1, false,
    ARRAY['Solicitar planos al arquitecto','Verificar versión vigente','Descargar y organizar archivos'], 2),
  ('esp', 'Sembrado', 2, 5, true,
    ARRAY['Ubicación de equipos en plano','Validar cobertura','Ajustar según restricciones físicas'], 3),
  ('esp', 'Diseños (diagramas unifilares, topología, bloques)', 2, 5, true,
    ARRAY['Diagrama unifilar','Topología','Layout de equipos','Esquema de canalización'], 4),
  ('esp', 'Entrega Conceptual al Cliente', 4, 4, false,
    ARRAY['Preparar presentación','Agendar reunión con cliente','Documentar comentarios','Minutas de revisión'], 5),
  ('esp', 'Cotización', 3, 3, false,
    ARRAY['Cuantificación de materiales','Costos de equipos','Mano de obra','Revisión de márgenes'], 6),
  ('esp', 'Especificación de Equipos', 3, 5, true,
    ARRAY['Fichas técnicas completas','Validar disponibilidad','Confirmar compatibilidad'], 7),
  ('esp', 'Memoria Técnica', 3, 5, true,
    ARRAY['Descripción del sistema','Normatividad aplicable','Cálculos','Especificaciones'], 8),
  ('esp', 'Carpeta de Fichas Técnicas', 5, 5, true,
    ARRAY['Compilar fichas técnicas','Organizar por sistema','Validar versiones vigentes'], 9),
  ('esp', 'Entrega Ejecutiva', 5, 5, false,
    ARRAY['Compilar paquete ejecutivo','Revisión final interna','Presentación al cliente','Aprobación formal'], 10);

-- ─── ILU (11 tareas, 2 multi-fase — Sembrado iluminación y Sembrado de control) ─
INSERT INTO project_task_templates (specialty, name, start_phase_order, end_phase_order, expands_by_system, default_subtasks, order_index) VALUES
  ('ilum', 'Presentación', 1, 1, false,
    ARRAY['Preparar slides','Imágenes de referencia','Conceptos de iluminación'], 1),
  ('ilum', 'Sembrado de iluminación', 2, 5, false,
    ARRAY['Layout luminarias','Tipos de luz','Niveles de iluminación'], 2),
  ('ilum', 'Entrega conceptual', 4, 4, false,
    ARRAY['Reunión con cliente','Documentar feedback'], 3),
  ('ilum', 'Sembrado de control', 3, 5, false,
    ARRAY['Ubicación de keypads','Definición de escenas'], 4),
  ('ilum', 'Sembrado de Bajo Voltaje', 5, 5, false,
    ARRAY['Ruteo de cableado BV'], 5),
  ('ilum', 'Plano de colocación', 5, 5, false,
    ARRAY['Plano definitivo con coordenadas'], 6),
  ('ilum', 'Carpeta de Fichas técnicas', 5, 5, false,
    ARRAY[]::TEXT[], 7),
  ('ilum', 'Propuesta de Decorativas', 5, 5, false,
    ARRAY['Selección de luminarias decorativas','Presentación al cliente'], 8),
  ('ilum', 'Cotización de luminarias', 5, 5, false,
    ARRAY['Cuantificación','Costos de proveedores'], 9),
  ('ilum', 'Entrega Ejecutiva', 5, 5, false,
    ARRAY['Paquete completo','Revisión interna','Aprobación cliente'], 10),
  ('ilum', 'Entrega física', 5, 5, false,
    ARRAY['Impresión de planos','Entrega formal en obra'], 11);

-- ─── ELEC (10 tareas, 6 multi-fase — los diseños de instalaciones) ─
INSERT INTO project_task_templates (specialty, name, start_phase_order, end_phase_order, expands_by_system, default_subtasks, order_index) VALUES
  ('elec', 'Recopilación de Planos de Proyecto', 1, 1, false,
    ARRAY['Solicitar planos al arquitecto','Verificar versión vigente'], 1),
  ('elec', 'Plano de Referencia, Plano Base y Tabla de Cálculos', 1, 1, false,
    ARRAY['Plano de referencia','Plano base','Tabla de cálculos preliminar'], 2),
  ('elec', 'Diseño Instalación Eléctrica de Iluminación', 3, 5, false,
    ARRAY['Cuadro de cargas iluminación','Diagrama de circuitos'], 3),
  ('elec', 'Diseño Instalación Eléctrica de Contactos', 3, 5, false,
    ARRAY['Distribución de contactos','Cuadro de cargas'], 4),
  ('elec', 'Diseño Instalación Eléctrica de HVAC', 3, 5, false,
    ARRAY['Cargas HVAC','Coordinación con mecánico'], 5),
  ('elec', 'Diseño de Subestación Eléctrica en Media / Baja Tensión', 3, 5, false,
    ARRAY['Memoria de cálculo SE','Diagrama unifilar SE','Especificación de equipos'], 6),
  ('elec', 'Diseño de Sistema Fotovoltaico', 3, 5, false,
    ARRAY['Cálculo de generación','Diagrama unifilar FV','Especificación inversores y paneles'], 7),
  ('elec', 'Diseño de Sistema de Emergencia', 3, 5, false,
    ARRAY['UPS / Planta','Circuitos de emergencia'], 8),
  ('elec', 'Revisión de Planos con Cliente', 4, 4, false,
    ARRAY['Reunión','Documentar comentarios','Minutas'], 9),
  ('elec', 'Entrega de Planos', 5, 5, false,
    ARRAY['Compilar paquete','Aprobación interna','Entrega formal al cliente'], 10);

-- ─── POSTVENTA (9 tareas, universales) ─
-- Las postventa viven en su propia fase específica (no son multi-fase)
INSERT INTO project_task_templates (specialty, name, start_phase_order, end_phase_order, expands_by_system, default_subtasks, order_index) VALUES
  ('postventa', 'Órdenes de Compra', 100, 100, false,
    ARRAY['Generar OCs por proveedor','Aprobación interna','Envío a proveedores'], 1),
  ('postventa', 'Entregas a Obra', 100, 100, false,
    ARRAY['Coordinar entregas','Confirmar recepción','Verificar cantidades y calidad','Almacén temporal si aplica'], 2),
  ('postventa', 'Visitas de Obra', 101, 101, false,
    ARRAY['Calendarizar visitas','Bitácora por visita','Reportes fotográficos'], 3),
  ('postventa', 'Seguimiento de Cambios y Adendums', 101, 101, false,
    ARRAY['Registrar cambios solicitados','Revisar impacto en costo y tiempo','Generar adendums'], 4),
  ('postventa', 'Reporte de Avance de Obra', 101, 101, false,
    ARRAY['Avance por sistema','Bloqueos','Reportar al cliente'], 5),
  ('postventa', 'Entrega Formal', 102, 102, false,
    ARRAY['Acta de entrega','Firma del cliente','Liberación de garantía'], 6),
  ('postventa', 'As-Built', 102, 102, false,
    ARRAY['Actualizar planos con cambios reales','Carpeta as-built','Entrega digital al cliente'], 7),
  ('postventa', 'Pruebas y Certificación', 102, 102, false,
    ARRAY['Pruebas funcionales','Certificados','Capacitación al cliente'], 8),
  ('postventa', 'Liberación de Pagos Finales', 102, 102, false,
    ARRAY['Conciliar facturación','Cobranza final','Cierre contable'], 9);

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ═══════════════════════════════════════════════════════════════════
SELECT 'phase_templates' AS tabla, count(*) AS rows FROM project_phase_templates
UNION ALL SELECT 'phase_templates_esp', count(*) FROM project_phase_templates WHERE specialty='esp'
UNION ALL SELECT 'phase_templates_ilum', count(*) FROM project_phase_templates WHERE specialty='ilum'
UNION ALL SELECT 'phase_templates_elec', count(*) FROM project_phase_templates WHERE specialty='elec'
UNION ALL SELECT 'phase_templates_postventa', count(*) FROM project_phase_templates WHERE specialty='postventa'
UNION ALL SELECT 'task_templates', count(*) FROM project_task_templates
UNION ALL SELECT 'task_templates_esp', count(*) FROM project_task_templates WHERE specialty='esp'
UNION ALL SELECT 'task_templates_ilum', count(*) FROM project_task_templates WHERE specialty='ilum'
UNION ALL SELECT 'task_templates_elec', count(*) FROM project_task_templates WHERE specialty='elec'
UNION ALL SELECT 'task_templates_postventa', count(*) FROM project_task_templates WHERE specialty='postventa'
UNION ALL SELECT 'task_templates_multi_fase', count(*) FROM project_task_templates WHERE start_phase_order < end_phase_order
UNION ALL SELECT 'task_templates_expand_by_system', count(*) FROM project_task_templates WHERE expands_by_system = true
UNION ALL SELECT 'project_phases (instancias)', count(*) FROM project_phases
UNION ALL SELECT 'project_tasks (instancias)', count(*) FROM project_tasks
UNION ALL SELECT 'projects', count(*) FROM projects
UNION ALL SELECT 'projects con specialty', count(*) FROM projects WHERE specialty IS NOT NULL;
