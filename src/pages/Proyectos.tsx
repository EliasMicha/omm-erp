import { useState, useMemo } from 'react'
import { Badge, ProgressBar, Btn, SectionHeader, EmptyState, Table, Th, Td } from '../components/layout/UI'
import { X, ChevronRight, ChevronDown, Check, Clock, Lock, Users, Calendar, Settings, ArrowLeft } from 'lucide-react'
import { formatDate } from '../lib/utils'

// ═══════════════════════════════════════════════════════════════════
// TYPES (local — no generics to avoid Vite build issues)
// ═══════════════════════════════════════════════════════════════════

type EngPhaseId = 'conceptual' | 'revision_interna' | 'revision_cliente' | 'diseno_ejecutivo' | 'revision_final'
type EngProjectStatus = 'activo' | 'pausado' | 'completado'
type EngAreaId = 'ESP' | 'ILU' | 'ELEC'

interface ChecklistItem {
  text: string
  checked: boolean
}

interface SpecialtySubtask {
  specialtyId: string
  name: string
  icon: string
  completed: boolean
  checklist: ChecklistItem[]
}

interface EngDeliverable {
  id: string
  name: string
  assignee: string | null
  dueDate: string | null
  subtasks: SpecialtySubtask[]
}

interface EngPhase {
  id: EngPhaseId
  name: string
  order: number
  deliverables: EngDeliverable[]
}

interface EngProject {
  id: string
  name: string
  client: string
  area: EngAreaId
  cotizacionId: string
  specialties: string[]
  status: EngProjectStatus
  createdAt: string
  phases: EngPhase[]
}

// ═══════════════════════════════════════════════════════════════════
// CATALOGS & TEMPLATES
// ═══════════════════════════════════════════════════════════════════

const SPECIALTIES_CATALOG: Array<{ id: string; name: string; icon: string; color: string }> = [
  { id: 'cctv', name: 'CCTV', icon: '📹', color: '#3B82F6' },
  { id: 'audio', name: 'Audio', icon: '🔊', color: '#8B5CF6' },
  { id: 'redes', name: 'Redes / Datos', icon: '🌐', color: '#06B6D4' },
  { id: 'control_acceso', name: 'Control de Acceso', icon: '🔐', color: '#F59E0B' },
  { id: 'cortinas', name: 'Cortinas y Persianas', icon: '🪟', color: '#67E8F9' },
  { id: 'control_iluminacion', name: 'Control de Iluminación', icon: '💡', color: '#C084FC' },
  { id: 'deteccion_humo', name: 'Detección de Humo', icon: '🔥', color: '#EF4444' },
  { id: 'bms', name: 'BMS', icon: '🏢', color: '#10B981' },
  { id: 'telefonia', name: 'Telefonía', icon: '📞', color: '#F97316' },
  { id: 'red_celular', name: 'Red Celular', icon: '📶', color: '#EC4899' },
]

const AREA_CONFIG: Array<{ id: EngAreaId; label: string; color: string; icon: string; leader: string }> = [
  { id: 'ESP', label: 'Especiales', color: '#57FF9A', icon: '◈', leader: 'Alfredo Rosas' },
  { id: 'ILU', label: 'Iluminación', color: '#C084FC', icon: '◇', leader: 'Juan Pablo' },
  { id: 'ELEC', label: 'Eléctrico', color: '#FFB347', icon: '◉', leader: 'Ricardo Flores' },
]

const DELIVERABLES_TEMPLATE: Array<{ id: string; name: string; phaseId: EngPhaseId; defaultChecklist: string[] }> = [
  // Conceptual
  { id: 'def_sistemas', name: 'Definición de Sistemas y Alcances', phaseId: 'conceptual', defaultChecklist: ['Revisar planos arquitectónicos', 'Identificar necesidades del cliente', 'Definir alcance por sistema', 'Documentar restricciones técnicas'] },
  { id: 'sembrado_conceptual', name: 'Sembrado Conceptual', phaseId: 'conceptual', defaultChecklist: ['Ubicar equipos en plano'] },
  { id: 'disenos_conceptuales', name: 'Diseños Conceptuales', phaseId: 'conceptual', defaultChecklist: ['Diagrama unifilar', 'Topología de red', 'Layout de equipos', 'Esquema de canalización', 'Cuadro de cargas', 'Diagrama de bloques', 'Planta de distribución', 'Ruta de cableado', 'Especificación preliminar'] },
  // Revisión Interna
  { id: 'cotizacion', name: 'Cotización', phaseId: 'revision_interna', defaultChecklist: ['Cuantificación de materiales', 'Costos de equipos', 'Mano de obra', 'Revisión de márgenes'] },
  // Revisión con Cliente
  { id: 'entrega_conceptual', name: 'Entrega Conceptual', phaseId: 'revision_cliente', defaultChecklist: ['Preparar presentación', 'Agendar reunión con cliente', 'Documentar comentarios', 'Minutas de revisión'] },
  // Diseño Ejecutivo
  { id: 'especificacion_equipos', name: 'Especificación de Equipos', phaseId: 'diseno_ejecutivo', defaultChecklist: ['Fichas técnicas completas', 'Validar disponibilidad', 'Confirmar compatibilidad'] },
  { id: 'sembrado_ejecutivo', name: 'Sembrado Ejecutivo', phaseId: 'diseno_ejecutivo', defaultChecklist: ['Plano de planta definitivo', 'Detalle de montaje', 'Rutas de cableado definitivas', 'Canalizaciones', 'Soportería', 'Tableros y gabinetes', 'Conexionado'] },
  { id: 'memoria_tecnica', name: 'Memoria Técnica', phaseId: 'diseno_ejecutivo', defaultChecklist: ['Descripción del sistema', 'Normatividad aplicable', 'Cálculos', 'Especificaciones'] },
  { id: 'carpeta_fichas', name: 'Carpeta de Fichas', phaseId: 'diseno_ejecutivo', defaultChecklist: ['Compilar fichas técnicas', 'Organizar por sistema', 'Validar versiones vigentes'] },
  // Revisión Final
  { id: 'entrega_ejecutivo', name: 'Entrega Ejecutivo', phaseId: 'revision_final', defaultChecklist: ['Compilar paquete ejecutivo', 'Revisión final interna', 'Presentación al cliente', 'Aprobación formal'] },
]

const PHASES_TEMPLATE: Array<{ id: EngPhaseId; name: string; order: number }> = [
  { id: 'conceptual', name: 'Conceptual', order: 1 },
  { id: 'revision_interna', name: 'Revisión Interna', order: 2 },
  { id: 'revision_cliente', name: 'Revisión con Cliente', order: 3 },
  { id: 'diseno_ejecutivo', name: 'Diseño Ejecutivo', order: 4 },
  { id: 'revision_final', name: 'Revisión Final (Con Cliente)', order: 5 },
]

const TEAM_MEMBERS = [
  { id: 'alfredo', name: 'Alfredo Rosas', avatar: 'AR' },
  { id: 'ricardo', name: 'Ricardo Flores', avatar: 'RF' },
  { id: 'juanpablo', name: 'Juan Pablo', avatar: 'JP' },
  { id: 'elias', name: 'Elias Cohen', avatar: 'EC' },
]

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function buildProjectPhases(specialtyIds: string[], progressOverrides: Record<string, number>): EngPhase[] {
  return PHASES_TEMPLATE.map(pt => {
    const phaseDeliverables = DELIVERABLES_TEMPLATE.filter(d => d.phaseId === pt.id)
    const baseProg = progressOverrides[pt.id] || 0
    return {
      ...pt,
      deliverables: phaseDeliverables.map(dt => ({
        id: dt.id,
        name: dt.name,
        assignee: baseProg > 0 ? 'alfredo' : null,
        dueDate: null,
        subtasks: specialtyIds.map(specId => {
          const spec = SPECIALTIES_CATALOG.find(s => s.id === specId)
          return {
            specialtyId: specId,
            name: spec ? spec.name : specId,
            icon: spec ? spec.icon : '📦',
            completed: baseProg >= 100,
            checklist: dt.defaultChecklist.map(text => ({
              text,
              checked: baseProg >= 100 ? true : (baseProg > 0 ? Math.random() > 0.5 : false),
            })),
          }
        }),
      })),
    }
  })
}

function calcDeliverableProgress(del: EngDeliverable): number {
  const total = del.subtasks.reduce((a, s) => a + s.checklist.length, 0)
  const done = del.subtasks.reduce((a, s) => a + s.checklist.filter(c => c.checked).length, 0)
  return total > 0 ? Math.round((done / total) * 100) : 0
}

function calcPhaseProgress(phase: EngPhase): number {
  if (phase.deliverables.length === 0) return 0
  const sum = phase.deliverables.reduce((a, d) => a + calcDeliverableProgress(d), 0)
  return Math.round(sum / phase.deliverables.length)
}

function calcProjectProgress(project: EngProject): number {
  if (project.phases.length === 0) return 0
  const sum = project.phases.reduce((a, p) => a + calcPhaseProgress(p), 0)
  return Math.round(sum / project.phases.length)
}

function getActivePhase(project: EngProject): EngPhase {
  for (const p of project.phases) {
    if (calcPhaseProgress(p) < 100) return p
  }
  return project.phases[project.phases.length - 1]
}

function isPhaseUnlocked(project: EngProject, phaseId: EngPhaseId): boolean {
  const idx = project.phases.findIndex(p => p.id === phaseId)
  if (idx <= 0) return true
  return calcPhaseProgress(project.phases[idx - 1]) >= 100
}

// ═══════════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════════

const INITIAL_PROJECTS: EngProject[] = [
  {
    id: 'ep1', name: 'Oasis 6', client: 'Grupo Oasis', area: 'ESP', cotizacionId: 'COT-2026-0041',
    specialties: ['cctv', 'audio', 'control_acceso', 'redes', 'deteccion_humo'],
    status: 'activo', createdAt: '2026-03-15',
    phases: buildProjectPhases(['cctv', 'audio', 'control_acceso', 'redes', 'deteccion_humo'], { conceptual: 85, revision_interna: 40 }),
  },
  {
    id: 'ep2', name: 'Reforma 222', client: 'Inmobiliaria Reforma', area: 'ESP', cotizacionId: 'COT-2026-0038',
    specialties: ['cctv', 'audio', 'control_acceso', 'redes', 'control_iluminacion', 'bms', 'telefonia', 'deteccion_humo'],
    status: 'activo', createdAt: '2026-02-20',
    phases: buildProjectPhases(['cctv', 'audio', 'control_acceso', 'redes', 'control_iluminacion', 'bms', 'telefonia', 'deteccion_humo'], { conceptual: 100, revision_interna: 100, revision_cliente: 100, diseno_ejecutivo: 60 }),
  },
  {
    id: 'ep3', name: 'Chapultepec Uno', client: 'Desarrolladora Chapultepec', area: 'ESP', cotizacionId: 'COT-2026-0045',
    specialties: ['cctv', 'audio', 'redes', 'cortinas', 'control_iluminacion'],
    status: 'activo', createdAt: '2026-04-01',
    phases: buildProjectPhases(['cctv', 'audio', 'redes', 'cortinas', 'control_iluminacion'], { conceptual: 20 }),
  },
  {
    id: 'ep4', name: 'Oasis 6 - Iluminación', client: 'Grupo Oasis', area: 'ILU', cotizacionId: 'COT-2026-0042',
    specialties: [],
    status: 'activo', createdAt: '2026-03-18',
    phases: buildProjectPhases([], { conceptual: 50 }),
  },
  {
    id: 'ep5', name: 'Reforma 222 - Eléctrico', client: 'Inmobiliaria Reforma', area: 'ELEC', cotizacionId: 'COT-2026-0039',
    specialties: [],
    status: 'activo', createdAt: '2026-02-22',
    phases: buildProjectPhases([], { conceptual: 100, revision_interna: 70 }),
  },
]

// ═══════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function PhaseTimeline({ phases, activePhaseId, onPhaseClick, project }: {
  phases: EngPhase[]; activePhaseId: EngPhaseId; onPhaseClick: (id: EngPhaseId) => void; project: EngProject
}) {
  return (
    <div style={{ display: 'flex', gap: 0, marginBottom: 24, position: 'relative' }}>
      {phases.map((phase, i) => {
        const progress = calcPhaseProgress(phase)
        const isCompleted = progress >= 100
        const isActive = phase.id === activePhaseId
        const unlocked = isPhaseUnlocked(project, phase.id)
        return (
          <div key={phase.id} style={{ flex: 1, textAlign: 'center', position: 'relative', cursor: unlocked ? 'pointer' : 'not-allowed', opacity: unlocked ? 1 : 0.35 }} onClick={() => unlocked && onPhaseClick(phase.id)}>
            {i < phases.length - 1 && (
              <div style={{ position: 'absolute', top: 17, left: 'calc(50% + 20px)', right: 'calc(-50% + 20px)', height: 2, background: isCompleted ? '#57FF9A' : '#222' }} />
            )}
            <div style={{
              width: 36, height: 36, borderRadius: '50%', margin: '0 auto 8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isCompleted ? '#57FF9A' : isActive ? '#57FF9A22' : '#1a1a1a',
              border: isCompleted ? '2px solid #57FF9A' : isActive ? '2px solid #57FF9A' : '2px solid #333',
              color: isCompleted ? '#000' : isActive ? '#57FF9A' : '#666',
              fontSize: 13, fontWeight: 700, transition: 'all 0.2s',
            }}>
              {isCompleted ? <Check size={16} /> : !unlocked ? <Lock size={12} /> : phase.order}
            </div>
            <div style={{ fontSize: 10, fontWeight: isActive ? 600 : 400, color: isActive ? '#57FF9A' : '#666', lineHeight: 1.3 }}>
              {phase.name}
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: isCompleted ? '#57FF9A' : '#555', marginTop: 2 }}>
              {progress}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AssignModal({ onClose, onSelect }: { onClose: () => void; onSelect: (id: string) => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 360 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Asignar responsable</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
          {TEAM_MEMBERS.map(m => (
            <button key={m.id} onClick={() => onSelect(m.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#1a1a1a', border: '1px solid #222', borderRadius: 10, cursor: 'pointer', color: '#ccc', fontSize: 13, fontFamily: 'inherit', textAlign: 'left' as const,
            }}>
              <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#57FF9A22', border: '1px solid #57FF9A44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#57FF9A' }}>{m.avatar}</span>
              {m.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function DeliverableRow({ deliverable, onToggleCheck, onAssign }: {
  deliverable: EngDeliverable; onToggleCheck: (delId: string, specId: string, idx: number) => void; onAssign: (delId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [expandedSpec, setExpandedSpec] = useState<string | null>(null)

  const progress = calcDeliverableProgress(deliverable)
  const totalChecks = deliverable.subtasks.reduce((a, s) => a + s.checklist.length, 0)
  const doneChecks = deliverable.subtasks.reduce((a, s) => a + s.checklist.filter(c => c.checked).length, 0)
  const assignee = TEAM_MEMBERS.find(m => m.id === deliverable.assignee)

  return (
    <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '14px 16px', marginBottom: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => setExpanded(!expanded)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 0, display: 'flex' }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{deliverable.name}</div>
          <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{deliverable.subtasks.length} especialidades · {doneChecks}/{totalChecks} checks</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {assignee ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#57FF9A11', border: '1px solid #57FF9A22', borderRadius: 8, padding: '3px 10px' }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#57FF9A22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#57FF9A' }}>{assignee.avatar}</span>
              <span style={{ fontSize: 11, color: '#57FF9A', fontWeight: 500 }}>{assignee.name.split(' ')[0]}</span>
            </div>
          ) : (
            <Btn size="sm" onClick={() => onAssign(deliverable.id)}>
              <Users size={10} /> Asignar
            </Btn>
          )}
          <span style={{ fontSize: 13, fontWeight: 700, color: progress >= 100 ? '#57FF9A' : progress > 50 ? '#3B82F6' : '#666', minWidth: 35, textAlign: 'right' as const }}>{progress}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 10 }}>
        <ProgressBar pct={progress} color={progress >= 100 ? '#57FF9A' : '#3B82F6'} />
      </div>

      {/* Expanded: specialty subtasks */}
      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1e1e1e' }}>
          {deliverable.subtasks.map(st => {
            const stDone = st.checklist.filter(c => c.checked).length
            const stTotal = st.checklist.length
            const isStExpanded = expandedSpec === st.specialtyId
            return (
              <div key={st.specialtyId}>
                <div
                  onClick={() => setExpandedSpec(isStExpanded ? null : st.specialtyId)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: isStExpanded ? '#1a1a1a' : 'transparent', cursor: 'pointer', marginBottom: 2, transition: 'background 0.15s' }}
                >
                  <span style={{ fontSize: 15 }}>{st.icon}</span>
                  <span style={{ flex: 1, fontSize: 12, color: '#ccc', fontWeight: 500 }}>{st.name}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: stDone === stTotal && stTotal > 0 ? '#57FF9A' : '#555' }}>{stDone}/{stTotal}</span>
                  <span style={{ fontSize: 8, color: '#555', transform: isStExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▶</span>
                </div>
                {isStExpanded && (
                  <div style={{ paddingLeft: 36, paddingBottom: 8 }}>
                    {st.checklist.map((item, idx) => (
                      <div key={idx}
                        onClick={() => onToggleCheck(deliverable.id, st.specialtyId, idx)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer' }}
                      >
                        <div style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                          background: item.checked ? '#57FF9A' : 'transparent',
                          border: item.checked ? '1.5px solid #57FF9A' : '1.5px solid #333',
                        }}>
                          {item.checked && <Check size={10} color="#000" strokeWidth={3} />}
                        </div>
                        <span style={{ fontSize: 12, color: item.checked ? '#555' : '#999', textDecoration: item.checked ? 'line-through' : 'none' }}>
                          {item.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PROJECT DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════

function ProjectDetail({ project, onBack, onUpdate }: {
  project: EngProject; onBack: () => void; onUpdate: (p: EngProject) => void
}) {
  const [activePhaseId, setActivePhaseId] = useState<EngPhaseId>(getActivePhase(project).id)
  const [assigningDel, setAssigningDel] = useState<string | null>(null)

  const currentPhase = project.phases.find(p => p.id === activePhaseId)
  const totalProgress = calcProjectProgress(project)

  function handleToggleCheck(delId: string, specId: string, checkIdx: number) {
    const updated: EngProject = {
      ...project,
      phases: project.phases.map(phase => ({
        ...phase,
        deliverables: phase.deliverables.map(del => {
          if (del.id !== delId) return del
          return {
            ...del,
            subtasks: del.subtasks.map(st => {
              if (st.specialtyId !== specId) return st
              const newChecklist = st.checklist.map((c, i) => i === checkIdx ? { ...c, checked: !c.checked } : c)
              return { ...st, checklist: newChecklist, completed: newChecklist.every(c => c.checked) }
            }),
          }
        }),
      })),
    }
    onUpdate(updated)
  }

  function handleAssign(memberId: string) {
    if (!assigningDel) return
    const updated: EngProject = {
      ...project,
      phases: project.phases.map(phase => ({
        ...phase,
        deliverables: phase.deliverables.map(del =>
          del.id === assigningDel ? { ...del, assignee: memberId } : del
        ),
      })),
    }
    onUpdate(updated)
    setAssigningDel(null)
  }

  const detailAreaCfg = AREA_CONFIG.find(a => a.id === project.area) || AREA_CONFIG[0]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Btn onClick={onBack}><ArrowLeft size={14} /> Atrás</Btn>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: detailAreaCfg.color + '22', color: detailAreaCfg.color, border: '1px solid ' + detailAreaCfg.color + '44', letterSpacing: '0.05em' }}>{project.area}</span>
            <span style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>{project.name}</span>
          </div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{project.client} · {project.cotizacionId} · Creado {formatDate(project.createdAt)}</div>
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: totalProgress >= 100 ? '#57FF9A' : '#3B82F6' }}>{totalProgress}%</span>
        <Badge label="Activo" color="#57FF9A" />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {project.specialties.map(specId => {
          const spec = SPECIALTIES_CATALOG.find(s => s.id === specId)
          if (!spec) return null
          return <Badge key={specId} label={spec.icon + ' ' + spec.name} color={spec.color} />
        })}
      </div>

      <PhaseTimeline phases={project.phases} activePhaseId={activePhaseId} onPhaseClick={setActivePhaseId} project={project} />

      {currentPhase && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Fase {currentPhase.order}: {currentPhase.name} — {currentPhase.deliverables.length} entregable{currentPhase.deliverables.length > 1 ? 's' : ''}
            </div>
            {calcPhaseProgress(currentPhase) >= 100 && <Badge label="Completada" color="#57FF9A" />}
            {!isPhaseUnlocked(project, currentPhase.id) && <Badge label="Bloqueada" color="#EF4444" />}
          </div>

          {currentPhase.deliverables.map(del => (
            <DeliverableRow
              key={del.id}
              deliverable={del}
              onToggleCheck={handleToggleCheck}
              onAssign={setAssigningDel}
            />
          ))}
        </div>
      )}

      {assigningDel && (
        <AssignModal onClose={() => setAssigningDel(null)} onSelect={handleAssign} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PROJECT LIST (card view)
// ═══════════════════════════════════════════════════════════════════

function ProjectCard({ project, onClick }: { project: EngProject; onClick: () => void }) {
  const progress = calcProjectProgress(project)
  const active = getActivePhase(project)
  const colors: Record<string, string> = { activo: '#57FF9A', pausado: '#F59E0B', completado: '#6B7280' }
  const labels: Record<string, string> = { activo: 'Activo', pausado: 'Pausado', completado: 'Completado' }
  const c = colors[project.status] || '#57FF9A'
  const areaCfg = AREA_CONFIG.find(a => a.id === project.area) || AREA_CONFIG[0]

  return (
    <div onClick={onClick} style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', borderTop: '2px solid ' + c + '33', transition: 'border-color 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = c + '66' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#222' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: areaCfg.color + '22', color: areaCfg.color, border: '1px solid ' + areaCfg.color + '44', letterSpacing: '0.05em' }}>{project.area}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{project.name}</span>
          </div>
          <div style={{ fontSize: 11, color: '#555' }}>{project.client} · {project.cotizacionId}</div>
        </div>
        <Badge label={labels[project.status] || 'Activo'} color={c} />
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
        {project.specialties.map(specId => {
          const spec = SPECIALTIES_CATALOG.find(s => s.id === specId)
          if (!spec) return null
          return <Badge key={specId} label={spec.icon + ' ' + spec.name} color={spec.color} />
        })}
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: '#555', marginBottom: 4 }}>Avance de ingeniería</div>
        <ProgressBar pct={progress} color={progress >= 100 ? '#57FF9A' : '#3B82F6'} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid #1e1e1e' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#555' }}>
          <Clock size={10} /> Fase: {active.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#555' }}>
          <Calendar size={10} /> {formatDate(project.createdAt)}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN MODULE
// ═══════════════════════════════════════════════════════════════════

export default function Proyectos() {
  const [projects, setProjects] = useState(INITIAL_PROJECTS)
  const [view, setView] = useState('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('todos')
  const [areaTab, setAreaTab] = useState('TODAS' as string)
  const [viewMode, setViewMode] = useState<'cards' | 'lista'>('cards')

  const selected = projects.find(p => p.id === selectedId) || null

  const stats = useMemo(() => {
    const scoped = areaTab === 'TODAS' ? projects : projects.filter(p => p.area === areaTab)
    const active = scoped.filter(p => p.status === 'activo').length
    const avg = scoped.length > 0 ? Math.round(scoped.reduce((a, p) => a + calcProjectProgress(p), 0) / scoped.length) : 0
    const specs = scoped.reduce((a, p) => a + p.specialties.length, 0)
    let overdue = 0
    const now = new Date()
    scoped.forEach(p => {
      p.phases.forEach(ph => {
        ph.deliverables.forEach(d => {
          if (d.dueDate && new Date(d.dueDate) < now && calcDeliverableProgress(d) < 100) overdue++
        })
      })
    })
    return { active, avg, specs, overdue, total: scoped.length }
  }, [projects, areaTab])

  const lista = useMemo(() => {
    let filtered = areaTab === 'TODAS' ? [...projects] : projects.filter(p => p.area === areaTab)
    if (filtro !== 'todos') filtered = filtered.filter(p => p.status === filtro)
    return filtered
  }, [projects, areaTab, filtro])

  function handleProjectUpdate(updated: EngProject) {
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
  }

  return (
    <div style={{ padding: '24px 28px' }}>
      {view === 'list' && (
        <>
          <SectionHeader
            title="Proyectos — Ingeniería y Diseño"
            subtitle={stats.total + ' proyectos' + (areaTab !== 'TODAS' ? ' · ' + (AREA_CONFIG.find(a => a.id === areaTab)?.label || '') : '')}
            action={
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn><Settings size={12} /> Templates</Btn>
              </div>
            }
          />

          {/* Area Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#111', borderRadius: 10, padding: 4, border: '1px solid #1e1e1e' }}>
            {(['TODAS', 'ESP', 'ILU', 'ELEC'] as const).map(tabId => {
              const on = areaTab === tabId
              const cfg = AREA_CONFIG.find(a => a.id === tabId)
              const tabColor = cfg ? cfg.color : '#888'
              const tabLabel = cfg ? cfg.label : 'Todas'
              const tabIcon = cfg ? cfg.icon : ''
              return (
                <button key={tabId} onClick={() => setAreaTab(tabId)} style={{
                  padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', border: 'none', transition: 'all 0.15s',
                  background: on ? tabColor + '18' : 'transparent',
                  color: on ? tabColor : '#555',
                  fontWeight: on ? 700 : 400,
                }}>
                  {tabIcon ? tabIcon + ' ' : ''}{tabLabel}
                  {tabId !== 'TODAS' && (
                    <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: on ? tabColor + '22' : '#1a1a1a', color: on ? tabColor : '#444' }}>
                      {projects.filter(p => p.area === tabId).length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '14px 16px', borderTop: '2px solid #57FF9A' }}>
              <div style={{ fontSize: 10, color: '#555', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 6 }}>Proyectos Activos</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{stats.active}</div>
            </div>
            <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '14px 16px', borderTop: '2px solid #3B82F6' }}>
              <div style={{ fontSize: 10, color: '#555', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 6 }}>Avance Promedio</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: stats.avg > 60 ? '#57FF9A' : '#3B82F6' }}>{stats.avg}%</div>
            </div>
            <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '14px 16px', borderTop: '2px solid #C084FC' }}>
              <div style={{ fontSize: 10, color: '#555', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 6 }}>Especialidades Activas</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{stats.specs}</div>
            </div>
            <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '14px 16px', borderTop: '2px solid #EF4444' }}>
              <div style={{ fontSize: 10, color: '#555', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 6 }}>Entregables Vencidos</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: stats.overdue > 0 ? '#EF4444' : '#fff' }}>{stats.overdue}</div>
            </div>
          </div>

          {/* Filters + View toggle */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, alignItems: 'center' }}>
            {['todos', 'activo', 'pausado', 'completado'].map(f => {
              const on = filtro === f
              const fcolors: Record<string, string> = { todos: '#57FF9A', activo: '#57FF9A', pausado: '#F59E0B', completado: '#6B7280' }
              const fc = fcolors[f] || '#57FF9A'
              return (
                <button key={f} onClick={() => setFiltro(f)} style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                  border: '1px solid ' + (on ? fc : '#333'), background: on ? fc + '22' : 'transparent',
                  color: on ? fc : '#666', fontWeight: on ? 600 : 400,
                }}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              )
            })}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
              {(['cards', 'lista'] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)} style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                  border: '1px solid ' + (viewMode === m ? '#57FF9A' : '#333'), background: viewMode === m ? '#57FF9A22' : 'transparent',
                  color: viewMode === m ? '#57FF9A' : '#555', fontWeight: viewMode === m ? 600 : 400,
                }}>{m === 'cards' ? 'Cards' : 'Lista'}</button>
              ))}
            </div>
          </div>

          {lista.length === 0 ? (
            <EmptyState message="Sin proyectos en esta vista" />
          ) : viewMode === 'cards' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
              {lista.map(p => (
                <ProjectCard key={p.id} project={p} onClick={() => { setSelectedId(p.id); setView('detail') }} />
              ))}
            </div>
          ) : (
            <Table>
              <thead><tr>
                <Th>Proyecto</Th><Th>Cliente</Th><Th>Área</Th><Th>Especialidades</Th><Th>Fase</Th><Th>Avance</Th><Th>Estatus</Th><Th></Th>
              </tr></thead>
              <tbody>
                {lista.map(p => {
                  const progress = calcProjectProgress(p)
                  const currentPhase = p.phases.find(ph => ph.deliverables.some(d => calcDeliverableProgress(d) < 100))
                  const areaCfg = AREA_CONFIG.find(a => a.id === p.area)
                  const statusColors: Record<string, string> = { activo: '#57FF9A', pausado: '#F59E0B', completado: '#6B7280', cancelado: '#EF4444' }
                  return (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => { setSelectedId(p.id); setView('detail') }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#1a1a1a' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      <Td><span style={{ fontWeight: 600, color: '#e8e8e8' }}>{p.name}</span></Td>
                      <Td muted>{p.client}</Td>
                      <Td>{areaCfg && <Badge label={areaCfg.icon + ' ' + areaCfg.label} color={areaCfg.color} />}</Td>
                      <Td><div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' as const }}>{p.specialties.map(s => <Badge key={s} label={s} color="#555" />)}</div></Td>
                      <Td muted>{currentPhase?.name || 'Completado'}</Td>
                      <Td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 60, height: 4, background: '#222', borderRadius: 2 }}><div style={{ width: `${progress}%`, height: 4, background: progress > 60 ? '#57FF9A' : '#3B82F6', borderRadius: 2 }} /></div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: progress > 60 ? '#57FF9A' : '#3B82F6' }}>{progress}%</span>
                        </div>
                      </Td>
                      <Td><Badge label={p.status.charAt(0).toUpperCase() + p.status.slice(1)} color={statusColors[p.status] || '#666'} /></Td>
                      <Td><Btn size="sm" onClick={e => { e?.stopPropagation(); setSelectedId(p.id); setView('detail') }}>Abrir</Btn></Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}

          <div style={{ padding: '32px 20px', textAlign: 'center' as const, color: '#333', fontSize: 11, marginTop: 16 }}>
            Los proyectos se generan automáticamente al aprobar una cotización
          </div>
        </>
      )}

      {view === 'detail' && selected && (
        <ProjectDetail
          project={selected}
          onBack={() => setView('list')}
          onUpdate={handleProjectUpdate}
        />
      )}
    </div>
  )
}
