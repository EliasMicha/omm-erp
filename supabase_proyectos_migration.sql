-- ═══════════════════════════════════════════════════════════════════
-- MÓDULO PROYECTOS — Refactor con templates por especialidad
-- Ejecutar en Supabase SQL Editor EN ORDEN
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. CAMPOS NUEVOS EN projects ──────────────────────────────────
-- specialty (singular, derivado de lines[0]) — facilita queries por especialidad
-- area_lead_id — empleado líder del área (Alfredo/Juan Pablo/Ricardo)
-- cotizacion_id — primera cotización vinculada (denormalizado para acceso rápido)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS specialty TEXT
  CHECK (specialty IN ('esp','elec','ilum','cort','proy'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS area_lead_id UUID REFERENCES employees(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cotizacion_id UUID REFERENCES quotations(id);

-- Backfill: si tiene lines[] y no specialty, copiar el primer elemento
UPDATE projects SET specialty = lines[1] WHERE specialty IS NULL AND lines IS NOT NULL AND array_length(lines, 1) > 0;

-- ─── 2. TEMPLATES DE FASES POR ESPECIALIDAD ───────────────────────
CREATE TABLE IF NOT EXISTS project_phase_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  specialty TEXT NOT NULL
    CHECK (specialty IN ('esp','elec','ilum','cort','proy','postventa')),
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_post_sale BOOLEAN DEFAULT false,
  activation_rule TEXT,
  -- 'always' | 'on_contract' (cuando hay cotización en stage='contrato')
  description TEXT
);

-- ─── 3. TEMPLATES DE TAREAS POR FASE ───────────────────────────────
CREATE TABLE IF NOT EXISTS project_task_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phase_template_id UUID NOT NULL REFERENCES project_phase_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  default_subtasks TEXT[] DEFAULT '{}',
  description TEXT
);

-- ─── 4. INSTANCIAS DE FASES (por proyecto) ─────────────────────────
CREATE TABLE IF NOT EXISTS project_phases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id UUID REFERENCES project_phase_templates(id),
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_post_sale BOOLEAN DEFAULT false,
  is_unlocked BOOLEAN DEFAULT true,
  -- false para post-venta hasta que la cotización pase a contrato
  unlocked_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pendiente'
    CHECK (status IN ('pendiente','en_progreso','completada','bloqueada')),
  notes TEXT
);

-- ─── 5. INSTANCIAS DE TAREAS (por proyecto) ────────────────────────
CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id UUID NOT NULL REFERENCES project_phases(id) ON DELETE CASCADE,
  template_id UUID REFERENCES project_task_templates(id),
  name TEXT NOT NULL,
  description TEXT,
  assignee_id UUID REFERENCES employees(id),
  status TEXT DEFAULT 'pendiente'
    CHECK (status IN ('pendiente','en_progreso','bloqueada','completada')),
  priority INTEGER DEFAULT 0,
  -- 0=sin, 1=baja, 2=media, 3=alta
  progress INTEGER DEFAULT 0,
  -- 0..100, derivado de subtasks pero también editable manualmente
  due_date DATE,
  completed_at TIMESTAMPTZ,
  -- Para ESP: tag de sistema (opcional)
  system TEXT,
  -- Sub-área del proyecto (opcional, ej "Recámara Principal")
  area TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

-- ─── 6. SUBTAREAS / CHECKLIST POR TAREA ────────────────────────────
CREATE TABLE IF NOT EXISTS project_task_subtasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  order_index INTEGER NOT NULL DEFAULT 0
);

-- ═══════════════════════════════════════════════════════════════════
-- ÍNDICES
-- ═══════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_projects_specialty ON projects(specialty);
CREATE INDEX IF NOT EXISTS idx_proj_phases_project ON project_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_proj_phases_order ON project_phases(project_id, order_index);
CREATE INDEX IF NOT EXISTS idx_proj_tasks_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_proj_tasks_phase ON project_tasks(phase_id);
CREATE INDEX IF NOT EXISTS idx_proj_tasks_assignee ON project_tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_proj_tasks_status ON project_tasks(status);
CREATE INDEX IF NOT EXISTS idx_proj_tasks_due ON project_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_proj_subtasks_task ON project_task_subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_phase_templates_spec ON project_phase_templates(specialty, order_index);
CREATE INDEX IF NOT EXISTS idx_task_templates_phase ON project_task_templates(phase_template_id, order_index);

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
-- SEED: TEMPLATES DE LAS 3 ESPECIALIDADES
-- ═══════════════════════════════════════════════════════════════════

-- Limpiar templates existentes para reseed limpio
DELETE FROM project_task_templates WHERE phase_template_id IN (SELECT id FROM project_phase_templates);
DELETE FROM project_phase_templates;

-- ─── ESP (Especialidades — Alfredo Rosas) — 5 fases pre-venta ──────
INSERT INTO project_phase_templates (specialty, name, order_index, is_post_sale, activation_rule) VALUES
  ('esp', 'Conceptual', 1, false, 'always'),
  ('esp', 'Revisión Interna', 2, false, 'always'),
  ('esp', 'Revisión con Cliente', 3, false, 'always'),
  ('esp', 'Diseño Ejecutivo', 4, false, 'always'),
  ('esp', 'Revisión Final', 5, false, 'always');

-- ─── ILU (Iluminación — Juan Pablo) — 6 fases pre-venta ────────────
INSERT INTO project_phase_templates (specialty, name, order_index, is_post_sale, activation_rule) VALUES
  ('ilum', 'Conceptual', 1, false, 'always'),
  ('ilum', 'Revisión', 2, false, 'always'),
  ('ilum', 'Diseño', 3, false, 'always'),
  ('ilum', 'Revisión 2', 4, false, 'always'),
  ('ilum', 'Ejecutivo', 5, false, 'always'),
  ('ilum', 'Revisión 3', 6, false, 'always');

-- ─── ELEC (Eléctrico — Ricardo Flores) — 4 fases pre-venta ─────────
INSERT INTO project_phase_templates (specialty, name, order_index, is_post_sale, activation_rule) VALUES
  ('elec', 'Arranque de Proyecto', 1, false, 'always'),
  ('elec', 'Diseño de Instalaciones', 2, false, 'always'),
  ('elec', 'Revisión con Cliente', 3, false, 'always'),
  ('elec', 'Entrega de Proyecto Ejecutivo', 4, false, 'always');

-- ─── POSTVENTA (universal — se inserta a TODOS los proyectos) ──────
-- Se filtra al instanciar: cuando se crea un proyecto, además de las fases
-- de su especialidad se agregan estas 3 con is_unlocked=false
INSERT INTO project_phase_templates (specialty, name, order_index, is_post_sale, activation_rule) VALUES
  ('postventa', 'Suministro', 100, true, 'on_contract'),
  ('postventa', 'Seguimiento de Obra', 101, true, 'on_contract'),
  ('postventa', 'Cierre', 102, true, 'on_contract');

-- ═══════════════════════════════════════════════════════════════════
-- SEED: TAREAS DE CADA FASE
-- ═══════════════════════════════════════════════════════════════════

-- ─── ESP: Tareas ───────────────────────────────────────────────────
INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Definición de Sistemas y Alcances', 1,
  ARRAY['Revisar planos arquitectónicos','Identificar necesidades del cliente','Definir alcance por sistema','Documentar restricciones técnicas']
FROM project_phase_templates WHERE specialty='esp' AND name='Conceptual';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Sembrado Conceptual', 2, ARRAY['Ubicar equipos en plano']
FROM project_phase_templates WHERE specialty='esp' AND name='Conceptual';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Diseños Conceptuales', 3,
  ARRAY['Diagrama unifilar','Topología de red','Layout de equipos','Esquema de canalización','Cuadro de cargas','Diagrama de bloques','Planta de distribución','Ruta de cableado','Especificación preliminar']
FROM project_phase_templates WHERE specialty='esp' AND name='Conceptual';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Cotización', 1,
  ARRAY['Cuantificación de materiales','Costos de equipos','Mano de obra','Revisión de márgenes']
FROM project_phase_templates WHERE specialty='esp' AND name='Revisión Interna';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Entrega Conceptual', 1,
  ARRAY['Preparar presentación','Agendar reunión con cliente','Documentar comentarios','Minutas de revisión']
FROM project_phase_templates WHERE specialty='esp' AND name='Revisión con Cliente';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Especificación de Equipos', 1,
  ARRAY['Fichas técnicas completas','Validar disponibilidad','Confirmar compatibilidad']
FROM project_phase_templates WHERE specialty='esp' AND name='Diseño Ejecutivo';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Sembrado Ejecutivo', 2,
  ARRAY['Plano de planta definitivo','Detalle de montaje','Rutas de cableado definitivas','Canalizaciones','Soportería','Tableros y gabinetes','Conexionado']
FROM project_phase_templates WHERE specialty='esp' AND name='Diseño Ejecutivo';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Memoria Técnica', 3,
  ARRAY['Descripción del sistema','Normatividad aplicable','Cálculos','Especificaciones']
FROM project_phase_templates WHERE specialty='esp' AND name='Diseño Ejecutivo';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Carpeta de Fichas', 4,
  ARRAY['Compilar fichas técnicas','Organizar por sistema','Validar versiones vigentes']
FROM project_phase_templates WHERE specialty='esp' AND name='Diseño Ejecutivo';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Entrega Ejecutivo', 1,
  ARRAY['Compilar paquete ejecutivo','Revisión final interna','Presentación al cliente','Aprobación formal']
FROM project_phase_templates WHERE specialty='esp' AND name='Revisión Final';

-- ─── ILU: Tareas (de los screenshots de Juan Pablo) ────────────────
INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Presentación', 1, ARRAY['Preparar slides','Imágenes de referencia','Conceptos de iluminación']
FROM project_phase_templates WHERE specialty='ilum' AND name='Conceptual';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Sembrado de iluminación', 2, ARRAY['Layout luminarias','Tipos de luz','Niveles de iluminación']
FROM project_phase_templates WHERE specialty='ilum' AND name='Conceptual';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Entrega conceptual', 1, ARRAY['Reunión con cliente','Documentar feedback']
FROM project_phase_templates WHERE specialty='ilum' AND name='Revisión';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Sembrado de control', 1, ARRAY['Ubicación de keypads','Definición de escenas']
FROM project_phase_templates WHERE specialty='ilum' AND name='Diseño';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Entrega de diseño', 1, ARRAY['Presentación final del diseño']
FROM project_phase_templates WHERE specialty='ilum' AND name='Revisión 2';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Sembrado de Bajo Voltaje', 1, ARRAY['Ruteo de cableado BV']
FROM project_phase_templates WHERE specialty='ilum' AND name='Ejecutivo';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Plano de colocación', 2, ARRAY['Plano definitivo con coordenadas']
FROM project_phase_templates WHERE specialty='ilum' AND name='Ejecutivo';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Carpeta de Fichas técnicas', 3, ARRAY[]::TEXT[]
FROM project_phase_templates WHERE specialty='ilum' AND name='Ejecutivo';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Propuesta de Decorativas', 4, ARRAY['Selección de luminarias decorativas','Presentación al cliente']
FROM project_phase_templates WHERE specialty='ilum' AND name='Ejecutivo';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Cotización de luminarias', 5, ARRAY['Cuantificación','Costos de proveedores']
FROM project_phase_templates WHERE specialty='ilum' AND name='Ejecutivo';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Entrega Ejecutiva', 1, ARRAY['Paquete completo','Revisión interna','Aprobación cliente']
FROM project_phase_templates WHERE specialty='ilum' AND name='Revisión 3';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Entrega física', 2, ARRAY['Impresión de planos','Entrega formal en obra']
FROM project_phase_templates WHERE specialty='ilum' AND name='Revisión 3';

-- ─── ELEC: Tareas (de los screenshots de Ricardo) ──────────────────
INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Recopilación de Planos de Proyecto', 1, ARRAY['Solicitar planos al arquitecto','Verificar versión vigente']
FROM project_phase_templates WHERE specialty='elec' AND name='Arranque de Proyecto';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Plano de Referencia, Plano Base y Tabla de Cálculos', 2, ARRAY['Plano de referencia','Plano base','Tabla de cálculos preliminar']
FROM project_phase_templates WHERE specialty='elec' AND name='Arranque de Proyecto';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Diseño Instalación Eléctrica de Iluminación', 1, ARRAY['Cuadro de cargas iluminación','Diagrama de circuitos']
FROM project_phase_templates WHERE specialty='elec' AND name='Diseño de Instalaciones';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Diseño Instalación Eléctrica de Contactos', 2, ARRAY['Distribución de contactos','Cuadro de cargas']
FROM project_phase_templates WHERE specialty='elec' AND name='Diseño de Instalaciones';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Diseño Instalación Eléctrica de HVAC', 3, ARRAY['Cargas HVAC','Coordinación con mecánico']
FROM project_phase_templates WHERE specialty='elec' AND name='Diseño de Instalaciones';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Diseño de Subestación Eléctrica en Media / Baja Tensión', 4, ARRAY['Memoria de cálculo SE','Diagrama unifilar SE','Especificación de equipos']
FROM project_phase_templates WHERE specialty='elec' AND name='Diseño de Instalaciones';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Diseño de Sistema Fotovoltaico', 5, ARRAY['Cálculo de generación','Diagrama unifilar FV','Especificación inversores y paneles']
FROM project_phase_templates WHERE specialty='elec' AND name='Diseño de Instalaciones';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Diseño de Sistema de Emergencia', 6, ARRAY['UPS / Planta','Circuitos de emergencia']
FROM project_phase_templates WHERE specialty='elec' AND name='Diseño de Instalaciones';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Revisión de Planos con Cliente', 1, ARRAY['Reunión','Documentar comentarios','Minutas']
FROM project_phase_templates WHERE specialty='elec' AND name='Revisión con Cliente';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Entrega de Planos', 1, ARRAY['Compilar paquete','Aprobación interna','Entrega formal al cliente']
FROM project_phase_templates WHERE specialty='elec' AND name='Entrega de Proyecto Ejecutivo';

-- ─── POSTVENTA: Tareas (universales para los 3) ────────────────────
INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Órdenes de Compra', 1, ARRAY['Generar OCs por proveedor','Aprobación interna','Envío a proveedores']
FROM project_phase_templates WHERE specialty='postventa' AND name='Suministro';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Entregas a Obra', 2, ARRAY['Coordinar entregas','Confirmar recepción','Verificar cantidades y calidad','Almacén temporal si aplica']
FROM project_phase_templates WHERE specialty='postventa' AND name='Suministro';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Visitas de Obra', 1, ARRAY['Calendarizar visitas','Bitácora por visita','Reportes fotográficos']
FROM project_phase_templates WHERE specialty='postventa' AND name='Seguimiento de Obra';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Seguimiento de Cambios y Adendums', 2, ARRAY['Registrar cambios solicitados','Revisar impacto en costo y tiempo','Generar adendums']
FROM project_phase_templates WHERE specialty='postventa' AND name='Seguimiento de Obra';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Reporte de Avance de Obra', 3, ARRAY['Avance por sistema','Bloqueos','Reportar al cliente']
FROM project_phase_templates WHERE specialty='postventa' AND name='Seguimiento de Obra';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Entrega Formal', 1, ARRAY['Acta de entrega','Firma del cliente','Liberación de garantía']
FROM project_phase_templates WHERE specialty='postventa' AND name='Cierre';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'As-Built', 2, ARRAY['Actualizar planos con cambios reales','Carpeta as-built','Entrega digital al cliente']
FROM project_phase_templates WHERE specialty='postventa' AND name='Cierre';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Pruebas y Certificación', 3, ARRAY['Pruebas funcionales','Certificados','Capacitación al cliente']
FROM project_phase_templates WHERE specialty='postventa' AND name='Cierre';

INSERT INTO project_task_templates (phase_template_id, name, order_index, default_subtasks)
SELECT id, 'Liberación de Pagos Finales', 4, ARRAY['Conciliar facturación','Cobranza final','Cierre contable']
FROM project_phase_templates WHERE specialty='postventa' AND name='Cierre';

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ═══════════════════════════════════════════════════════════════════
SELECT 'phase_templates' AS tabla, count(*) AS rows FROM project_phase_templates
UNION ALL SELECT 'task_templates', count(*) FROM project_task_templates
UNION ALL SELECT 'project_phases', count(*) FROM project_phases
UNION ALL SELECT 'project_tasks', count(*) FROM project_tasks
UNION ALL SELECT 'project_task_subtasks', count(*) FROM project_task_subtasks
UNION ALL SELECT 'projects (con specialty)', count(*) FROM projects WHERE specialty IS NOT NULL;
