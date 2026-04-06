import React, { useState, useRef } from 'react'
import { SectionHeader, KpiCard, Table, Th, Td, Badge, Btn, EmptyState, ProgressBar } from '../components/layout/UI'
import { F, formatDate } from '../lib/utils'
import { ANTHROPIC_API_KEY } from '../lib/config'
import {
  HardHat, Users, ClipboardList, Calendar, AlertTriangle, CheckCircle,
  Clock, ChevronRight, ArrowLeft, Plus, Upload, Camera, X, Eye,
  Wrench, Wifi, Volume2, Shield, Sun, MapPin, FileText, TrendingUp,
  Loader2, MessageSquare, Lock, ChevronDown
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */

type ObraStatus = 'entrega_pendiente' | 'en_ejecucion' | 'pausada' | 'completada'
type ActividadStatus = 'pendiente' | 'en_progreso' | 'bloqueada' | 'completada'
type Sistema = 'CCTV' | 'Audio' | 'Redes' | 'Control' | 'Acceso' | 'Electrico'
type Tab = 'obras' | 'instaladores' | 'planeacion'

interface Instalador {
  id: string
  nombre: string
  telefono: string
  habilidades: Sistema[]
  nivel: 'senior' | 'medio' | 'junior'
  obras_activas: string[]
  disponible: boolean
  foto_url?: string
  notas?: string
  calificacion: number // 1-5
}

interface Actividad {
  id: string
  obra_id: string
  sistema: Sistema
  descripcion: string
  status: ActividadStatus
  instalador_id?: string
  fecha_inicio?: string
  fecha_fin_plan?: string
  fecha_fin_real?: string
  bloqueo?: string // descripcion de qué lo frena
  notas?: string
  porcentaje: number
}

interface ReporteObra {
  id: string
  obra_id: string
  instalador_id: string
  fecha: string
  texto_raw: string
  fotos: string[] // base64 thumbnails
  ai_resumen?: string
  ai_avances?: string[]
  ai_faltantes?: string[]
  ai_bloqueos?: string[]
  procesado: boolean
}

interface EntregaDocumento {
  nombre: string
  recibido: boolean
}

interface ObraData {
  id: string
  nombre: string
  cliente: string
  direccion: string
  status: ObraStatus
  cotizacion_ref?: string
  coordinador: string
  sistemas: Sistema[]
  instaladores_ids: string[]
  fecha_inicio?: string
  fecha_fin_plan?: string
  avance_global: number
  actividades: Actividad[]
  reportes: ReporteObra[]
  entrega_docs: EntregaDocumento[]
  notas?: string
  valor_contrato: number
}

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */

const SISTEMAS_CONFIG: Record<Sistema, { label: string; color: string; icon: typeof Wifi }> = {
  CCTV:      { label: 'CCTV',          color: '#EF4444', icon: Shield },
  Audio:     { label: 'Audio',         color: '#C084FC', icon: Volume2 },
  Redes:     { label: 'Redes',         color: '#3B82F6', icon: Wifi },
  Control:   { label: 'Control (Lutron)', color: '#F59E0B', icon: Sun },
  Acceso:    { label: 'Control Acceso', color: '#06B6D4', icon: Lock },
  Electrico: { label: 'Eléctrico',     color: '#FF6B35', icon: Wrench },
}

const STATUS_CONFIG: Record<ObraStatus, { label: string; color: string }> = {
  entrega_pendiente: { label: 'Entrega pendiente', color: '#F59E0B' },
  en_ejecucion:      { label: 'En ejecución',      color: '#57FF9A' },
  pausada:           { label: 'Pausada',            color: '#6B7280' },
  completada:        { label: 'Completada',         color: '#3B82F6' },
}

const ACT_STATUS_CONFIG: Record<ActividadStatus, { label: string; color: string }> = {
  pendiente:   { label: 'Pendiente',   color: '#6B7280' },
  en_progreso: { label: 'En progreso', color: '#3B82F6' },
  bloqueada:   { label: 'Bloqueada',   color: '#EF4444' },
  completada:  { label: 'Completada',  color: '#57FF9A' },
}

const NIVEL_CONFIG: Record<string, { label: string; color: string }> = {
  senior: { label: 'Senior', color: '#F59E0B' },
  medio:  { label: 'Medio',  color: '#3B82F6' },
  junior: { label: 'Junior', color: '#6B7280' },
}

const DOCS_ENTREGA: string[] = [
  'Planos aprobados', 'Cotización firmada', 'Contrato', 'Lista de equipos',
  'Diagrama de conexiones', 'Especificaciones técnicas', 'Accesos / permisos obra',
  'Contacto residente de obra',
]

/* ═══════════════════════════════════════════════════════════════════
   MOCK DATA
   ═══════════════════════════════════════════════════════════════════ */

const MOCK_INSTALADORES: Instalador[] = [
  { id: 'i1', nombre: 'Carlos Méndez', telefono: '5512340001', habilidades: ['CCTV', 'Redes', 'Acceso'], nivel: 'senior', obras_activas: ['o1', 'o2'], disponible: true, calificacion: 4.8, notas: '10 años de experiencia, certificado Hikvision' },
  { id: 'i2', nombre: 'Miguel Ángel Torres', telefono: '5512340002', habilidades: ['Audio', 'Control', 'Redes'], nivel: 'senior', obras_activas: ['o1'], disponible: true, calificacion: 4.5, notas: 'Especialista Lutron, certificado Sonos' },
  { id: 'i3', nombre: 'Roberto Sánchez', telefono: '5512340003', habilidades: ['Electrico', 'Redes'], nivel: 'medio', obras_activas: ['o2'], disponible: true, calificacion: 4.0 },
  { id: 'i4', nombre: 'José Luis Ramírez', telefono: '5512340004', habilidades: ['CCTV', 'Acceso', 'Electrico'], nivel: 'medio', obras_activas: [], disponible: true, calificacion: 3.8 },
  { id: 'i5', nombre: 'Fernando García', telefono: '5512340005', habilidades: ['Audio', 'Control'], nivel: 'junior', obras_activas: ['o1'], disponible: false, calificacion: 3.5, notas: 'En capacitación Lutron' },
]

const MOCK_OBRAS: ObraData[] = [
  {
    id: 'o1', nombre: 'Oasis 6 - Torre B', cliente: 'Alex Niz', direccion: 'Av. Oasis 600, Interlomas',
    status: 'en_ejecucion', cotizacion_ref: 'COT-ESP-2026-012', coordinador: 'Alfredo Rosas',
    sistemas: ['CCTV', 'Audio', 'Redes', 'Control', 'Acceso'], instaladores_ids: ['i1', 'i2', 'i5'],
    fecha_inicio: '2026-02-15', fecha_fin_plan: '2026-06-30', avance_global: 42, valor_contrato: 1850000,
    entrega_docs: DOCS_ENTREGA.map((d, i) => ({ nombre: d, recibido: i < 6 })),
    actividades: [
      { id: 'a1', obra_id: 'o1', sistema: 'Redes', descripcion: 'Cableado estructurado pisos 1-5', status: 'completada', instalador_id: 'i1', fecha_inicio: '2026-02-20', fecha_fin_plan: '2026-03-15', fecha_fin_real: '2026-03-12', porcentaje: 100 },
      { id: 'a2', obra_id: 'o1', sistema: 'CCTV', descripcion: 'Instalación cámaras perímetro', status: 'en_progreso', instalador_id: 'i1', fecha_inicio: '2026-03-15', fecha_fin_plan: '2026-04-15', porcentaje: 60 },
      { id: 'a3', obra_id: 'o1', sistema: 'Audio', descripcion: 'Pre-cableado audio zonas comunes', status: 'en_progreso', instalador_id: 'i2', fecha_inicio: '2026-03-10', fecha_fin_plan: '2026-04-20', porcentaje: 35 },
      { id: 'a4', obra_id: 'o1', sistema: 'Control', descripcion: 'Instalación procesadores Lutron', status: 'pendiente', instalador_id: 'i2', fecha_fin_plan: '2026-05-01', porcentaje: 0 },
      { id: 'a5', obra_id: 'o1', sistema: 'Acceso', descripcion: 'Lectores acceso lobby + estacionamiento', status: 'bloqueada', instalador_id: 'i1', fecha_fin_plan: '2026-04-30', porcentaje: 10, bloqueo: 'Esperando entrega de lectores HID (proveedor con retraso 2 semanas)' },
      { id: 'a6', obra_id: 'o1', sistema: 'Control', descripcion: 'Programación escenas Lutron', status: 'pendiente', instalador_id: 'i5', fecha_fin_plan: '2026-06-01', porcentaje: 0 },
    ],
    reportes: [
      {
        id: 'r1', obra_id: 'o1', instalador_id: 'i1', fecha: '2026-04-04',
        texto_raw: 'Hoy avanzamos con las cámaras del estacionamiento nivel -2. Instalamos 4 domo Hikvision DS-2CD2147G2 en las esquinas. Falta canalizar el último tramo de 15m porque el plafón aún no está terminado por el contratista general. Los lectores HID siguen sin llegar, hablé con el proveedor y dice que la próxima semana.',
        fotos: [], procesado: true,
        ai_resumen: 'Avance en CCTV estacionamiento N-2: 4 cámaras domo Hikvision instaladas. Pendiente canalización 15m por plafón incompleto (dep. contratista general). Lectores HID sin entregar, ETA próxima semana.',
        ai_avances: ['4 cámaras domo Hikvision DS-2CD2147G2 instaladas en estacionamiento N-2'],
        ai_faltantes: ['Canalización 15m pendiente (plafón sin terminar)', 'Lectores HID pendientes de entrega'],
        ai_bloqueos: ['Plafón estacionamiento N-2 no terminado por contratista general', 'Retraso proveedor lectores HID (~1 semana)'],
      },
      {
        id: 'r2', obra_id: 'o1', instalador_id: 'i2', fecha: '2026-04-04',
        texto_raw: 'Terminé el tendido de cable de audio en zona de alberca y terraza. 6 bocinas Sonos Outdoor ya están montadas. Mañana empiezo con el vestíbulo. Necesito que me manden 3 cajas más de cable Genesis 1602 porque se me acabó.',
        fotos: [], procesado: true,
        ai_resumen: 'Audio: completado tendido cable + montaje 6 bocinas Sonos Outdoor en alberca/terraza. Siguiente: vestíbulo. Solicita 3 cajas cable Genesis 1602.',
        ai_avances: ['Tendido cable audio alberca y terraza completado', '6 bocinas Sonos Outdoor montadas'],
        ai_faltantes: ['3 cajas cable Genesis 1602 requeridas'],
        ai_bloqueos: [],
      },
    ],
    notas: 'Obra de alta prioridad. Cliente visita cada viernes.',
  },
  {
    id: 'o2', nombre: 'Reforma 222 - PH', cliente: 'Grupo Inmobiliario', direccion: 'Reforma 222, Juárez, CDMX',
    status: 'en_ejecucion', cotizacion_ref: 'COT-ESP-2025-038', coordinador: 'Alfredo Rosas',
    sistemas: ['CCTV', 'Redes', 'Electrico'], instaladores_ids: ['i1', 'i3'],
    fecha_inicio: '2026-03-01', fecha_fin_plan: '2026-05-15', avance_global: 25, valor_contrato: 650000,
    entrega_docs: DOCS_ENTREGA.map((d, i) => ({ nombre: d, recibido: i < 4 })),
    actividades: [
      { id: 'a7', obra_id: 'o2', sistema: 'Redes', descripcion: 'Cableado Cat6A departamento completo', status: 'en_progreso', instalador_id: 'i3', fecha_inicio: '2026-03-05', fecha_fin_plan: '2026-04-10', porcentaje: 70 },
      { id: 'a8', obra_id: 'o2', sistema: 'CCTV', descripcion: 'Instalación NVR + 8 cámaras', status: 'pendiente', instalador_id: 'i1', fecha_fin_plan: '2026-04-25', porcentaje: 0 },
      { id: 'a9', obra_id: 'o2', sistema: 'Electrico', descripcion: 'Canalizaciones y registros eléctricos', status: 'en_progreso', instalador_id: 'i3', fecha_inicio: '2026-03-01', fecha_fin_plan: '2026-04-15', porcentaje: 45 },
    ],
    reportes: [],
    notas: '',
  },
  {
    id: 'o3', nombre: 'Pachuca - Residencial Los Arcos', cliente: 'Desarrollos Pachuca', direccion: 'Blvd. Colosio 500, Pachuca',
    status: 'entrega_pendiente', cotizacion_ref: 'COT-ESP-2026-020', coordinador: 'Ricardo Flores',
    sistemas: ['CCTV', 'Redes', 'Audio', 'Acceso'], instaladores_ids: [],
    fecha_fin_plan: '2026-08-30', avance_global: 0, valor_contrato: 420000,
    entrega_docs: DOCS_ENTREGA.map((d, i) => ({ nombre: d, recibido: i < 2 })),
    actividades: [],
    reportes: [],
    notas: 'Contrato recién firmado. Pendiente entrega formal y asignación de instaladores.',
  },
]

/* ═══════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════ */

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 12, background: '#0a0a0a',
  border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit',
}
const labelStyle: React.CSSProperties = { fontSize: 10, color: '#666', marginBottom: 4 }
const cardStyle: React.CSSProperties = {
  background: '#141414', border: '1px solid #222', borderRadius: 10, padding: 16, marginBottom: 12,
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════ */

export default function Obra() {
  const [tab, setTab] = useState<Tab>('obras')
  const [obras, setObras] = useState<ObraData[]>(MOCK_OBRAS)
  const [instaladores, setInstaladores] = useState<Instalador[]>(MOCK_INSTALADORES)
  const [selectedObra, setSelectedObra] = useState<string | null>(null)
  const [showNewObra, setShowNewObra] = useState(false)
  const [showNewInstalador, setShowNewInstalador] = useState(false)

  const obra = selectedObra ? obras.find(o => o.id === selectedObra) : null

  const updateObra = (id: string, updater: (o: ObraData) => ObraData) => {
    setObras(prev => prev.map(o => o.id === id ? updater(o) : o))
  }

  // KPIs
  const activas = obras.filter(o => o.status === 'en_ejecucion').length
  const pendientesEntrega = obras.filter(o => o.status === 'entrega_pendiente').length
  const bloqueadas = obras.flatMap(o => o.actividades).filter(a => a.status === 'bloqueada').length
  const avgAvance = obras.filter(o => o.status === 'en_ejecucion').reduce((s, o) => s + o.avance_global, 0) / (activas || 1)

  if (obra) {
    return <ObraDetail
      obra={obra}
      instaladores={instaladores}
      onBack={() => setSelectedObra(null)}
      updateObra={(updater) => updateObra(obra.id, updater)}
    />
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200 }}>
      <SectionHeader title="Obra" subtitle="Coordinación de instalaciones en campo" action={
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'obras' && <Btn size="sm" variant="primary" onClick={() => setShowNewObra(true)}><Plus size={12} /> Nueva obra</Btn>}
          {tab === 'instaladores' && <Btn size="sm" variant="primary" onClick={() => setShowNewInstalador(true)}><Plus size={12} /> Nuevo instalador</Btn>}
        </div>
      } />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Obras activas" value={activas} icon={<HardHat size={16} />} />
        <KpiCard label="Entrega pendiente" value={pendientesEntrega} color="#F59E0B" icon={<FileText size={16} />} />
        <KpiCard label="Actividades bloqueadas" value={bloqueadas} color="#EF4444" icon={<AlertTriangle size={16} />} />
        <KpiCard label="Avance promedio" value={`${Math.round(avgAvance)}%`} color="#3B82F6" icon={<TrendingUp size={16} />} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #222', marginBottom: 20 }}>
        {([
          { key: 'obras' as Tab, label: 'Obras', icon: HardHat },
          { key: 'planeacion' as Tab, label: 'Planeación semanal', icon: Calendar },
          { key: 'instaladores' as Tab, label: 'Equipo de instalación', icon: Users },
        ]).map(({ key, label, icon: Icon }) => {
          const active = tab === key
          return (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '8px 14px', fontSize: 12, fontWeight: active ? 600 : 400,
              color: active ? '#57FF9A' : '#666',
              background: active ? 'rgba(87,255,154,0.08)' : 'transparent',
              border: 'none', borderBottom: active ? '2px solid #57FF9A' : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'inherit', borderRadius: '8px 8px 0 0',
            }}>
              <Icon size={13} style={{ marginRight: 6 }} />{label}
            </button>
          )
        })}
      </div>

      {tab === 'obras' && (
        <div>
          {obras.length === 0 ? <EmptyState message="No hay obras registradas" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {obras.map(o => {
                const st = STATUS_CONFIG[o.status]
                const bloq = o.actividades.filter(a => a.status === 'bloqueada').length
                return (
                  <div key={o.id} onClick={() => setSelectedObra(o.id)} style={{
                    ...cardStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16,
                    transition: 'border-color 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#57FF9A33')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#222')}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{o.nombre}</span>
                        <Badge label={st.label} color={st.color} />
                        {bloq > 0 && <Badge label={`${bloq} bloqueada${bloq > 1 ? 's' : ''}`} color="#EF4444" />}
                      </div>
                      <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                        {o.cliente} · {o.coordinador} · {o.direccion}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {o.sistemas.map(s => {
                          const cfg = SISTEMAS_CONFIG[s]
                          return <Badge key={s} label={cfg.label} color={cfg.color} />
                        })}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 120 }}>
                      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Avance</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{o.avance_global}%</div>
                      <ProgressBar pct={o.avance_global} />
                      <div style={{ fontSize: 10, color: '#555', marginTop: 6 }}>{F(o.valor_contrato)}</div>
                    </div>
                    <ChevronRight size={16} color="#444" />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'instaladores' && <TabInstaladores instaladores={instaladores} setInstaladores={setInstaladores} showNew={showNewInstalador} setShowNew={setShowNewInstalador} />}

      {tab === 'planeacion' && <TabPlaneacion obras={obras} instaladores={instaladores} />}

      {/* Modal nueva obra */}
      {showNewObra && <NuevaObraModal onClose={() => setShowNewObra(false)} onCreate={(o) => { setObras([o, ...obras]); setShowNewObra(false) }} />}

      {/* Modal nuevo instalador */}
      {showNewInstalador && <NuevoInstaladorModal onClose={() => setShowNewInstalador(false)} onCreate={(inst) => { setInstaladores([inst, ...instaladores]); setShowNewInstalador(false) }} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   OBRA DETAIL VIEW
   ═══════════════════════════════════════════════════════════════════ */

function ObraDetail({ obra, instaladores, onBack, updateObra }: {
  obra: ObraData
  instaladores: Instalador[]
  onBack: () => void
  updateObra: (updater: (o: ObraData) => ObraData) => void
}) {
  const [subTab, setSubTab] = useState<'actividades' | 'reportes' | 'entrega' | 'equipo'>('actividades')
  const [showNewAct, setShowNewAct] = useState(false)
  const [showNewReporte, setShowNewReporte] = useState(false)

  const st = STATUS_CONFIG[obra.status]
  const completadas = obra.actividades.filter(a => a.status === 'completada').length
  const bloqueadas = obra.actividades.filter(a => a.status === 'bloqueada').length
  const docsRecibidos = obra.entrega_docs.filter(d => d.recibido).length

  const obraInstaladores = instaladores.filter(i => obra.instaladores_ids.includes(i.id))

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ArrowLeft size={14} /> Volver a obras
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>{obra.nombre}</h2>
          <Badge label={st.label} color={st.color} />
          {obra.status === 'entrega_pendiente' && (
            <Btn size="sm" variant="primary" onClick={() => updateObra(o => ({ ...o, status: 'en_ejecucion' }))}>
              <CheckCircle size={11} /> Marcar entrega completa
            </Btn>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#666' }}>
          {obra.cliente} · <MapPin size={11} style={{ verticalAlign: 'middle' }} /> {obra.direccion} · Coord: {obra.coordinador}
          {obra.cotizacion_ref && <> · Cot: {obra.cotizacion_ref}</>}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Avance global" value={`${obra.avance_global}%`} icon={<TrendingUp size={16} />} />
        <KpiCard label="Actividades" value={`${completadas}/${obra.actividades.length}`} color="#3B82F6" icon={<ClipboardList size={16} />} />
        <KpiCard label="Bloqueadas" value={bloqueadas} color={bloqueadas > 0 ? '#EF4444' : '#57FF9A'} icon={<AlertTriangle size={16} />} />
        <KpiCard label="Documentos" value={`${docsRecibidos}/${obra.entrega_docs.length}`} color="#F59E0B" icon={<FileText size={16} />} />
        <KpiCard label="Contrato" value={F(obra.valor_contrato)} color="#C084FC" icon={<HardHat size={16} />} />
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #222', marginBottom: 20 }}>
        {([
          { key: 'actividades' as const, label: 'Actividades', icon: ClipboardList },
          { key: 'reportes' as const, label: `Reportes (${obra.reportes.length})`, icon: MessageSquare },
          { key: 'entrega' as const, label: 'Entrega formal', icon: FileText },
          { key: 'equipo' as const, label: `Equipo (${obraInstaladores.length})`, icon: Users },
        ]).map(({ key, label, icon: Icon }) => {
          const active = subTab === key
          return (
            <button key={key} onClick={() => setSubTab(key)} style={{
              padding: '8px 14px', fontSize: 12, fontWeight: active ? 600 : 400,
              color: active ? '#57FF9A' : '#666',
              background: active ? 'rgba(87,255,154,0.08)' : 'transparent',
              border: 'none', borderBottom: active ? '2px solid #57FF9A' : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'inherit', borderRadius: '8px 8px 0 0',
            }}>
              <Icon size={13} style={{ marginRight: 6 }} />{label}
            </button>
          )
        })}
      </div>

      {/* Sub-tab content */}
      {subTab === 'actividades' && (
        <SubActividades
          obra={obra}
          instaladores={instaladores}
          updateObra={updateObra}
          showNew={showNewAct}
          setShowNew={setShowNewAct}
        />
      )}
      {subTab === 'reportes' && (
        <SubReportes
          obra={obra}
          instaladores={instaladores}
          updateObra={updateObra}
          showNew={showNewReporte}
          setShowNew={setShowNewReporte}
        />
      )}
      {subTab === 'entrega' && <SubEntrega obra={obra} updateObra={updateObra} />}
      {subTab === 'equipo' && <SubEquipo obra={obra} instaladores={instaladores} obraInstaladores={obraInstaladores} updateObra={updateObra} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   SUB: ACTIVIDADES
   ═══════════════════════════════════════════════════════════════════ */

function SubActividades({ obra, instaladores, updateObra, showNew, setShowNew }: {
  obra: ObraData; instaladores: Instalador[]; updateObra: (fn: (o: ObraData) => ObraData) => void
  showNew: boolean; setShowNew: (v: boolean) => void
}) {
  const [newAct, setNewAct] = useState({ sistema: 'CCTV' as Sistema, descripcion: '', instalador_id: '', fecha_fin_plan: '', bloqueo: '' })

  const addActividad = () => {
    if (!newAct.descripcion.trim()) return
    const act: Actividad = {
      id: 'a' + Date.now(), obra_id: obra.id, sistema: newAct.sistema,
      descripcion: newAct.descripcion.trim(), status: 'pendiente',
      instalador_id: newAct.instalador_id || undefined,
      fecha_fin_plan: newAct.fecha_fin_plan || undefined,
      porcentaje: 0,
    }
    updateObra(o => ({ ...o, actividades: [...o.actividades, act] }))
    setNewAct({ sistema: 'CCTV', descripcion: '', instalador_id: '', fecha_fin_plan: '', bloqueo: '' })
    setShowNew(false)
  }

  const updateActividad = (actId: string, updates: Partial<Actividad>) => {
    updateObra(o => ({
      ...o,
      actividades: o.actividades.map(a => a.id === actId ? { ...a, ...updates } : a),
      avance_global: Math.round(
        o.actividades.map(a => a.id === actId ? { ...a, ...updates } : a)
          .reduce((s, a) => s + a.porcentaje, 0) / (o.actividades.length || 1)
      ),
    }))
  }

  // Group by sistema
  const bySistema = new Map<Sistema, Actividad[]>()
  obra.actividades.forEach(a => {
    const arr = bySistema.get(a.sistema) || []
    arr.push(a)
    bySistema.set(a.sistema, arr)
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Actividades por sistema</div>
        <Btn size="sm" variant="primary" onClick={() => setShowNew(true)}><Plus size={12} /> Nueva actividad</Btn>
      </div>

      {/* New activity form */}
      {showNew && (
        <div style={{ ...cardStyle, borderColor: '#57FF9A33' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Nueva actividad</div>
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 180px 140px', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={labelStyle}>Sistema</div>
              <select value={newAct.sistema} onChange={e => setNewAct(n => ({ ...n, sistema: e.target.value as Sistema }))} style={inputStyle}>
                {Object.entries(SISTEMAS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Descripción</div>
              <input value={newAct.descripcion} onChange={e => setNewAct(n => ({ ...n, descripcion: e.target.value }))} placeholder="Qué se va a hacer" style={inputStyle} />
            </div>
            <div>
              <div style={labelStyle}>Instalador</div>
              <select value={newAct.instalador_id} onChange={e => setNewAct(n => ({ ...n, instalador_id: e.target.value }))} style={inputStyle}>
                <option value="">Sin asignar</option>
                {instaladores.filter(i => i.habilidades.includes(newAct.sistema)).map(i => <option key={i.id} value={i.id}>{i.nombre}</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Fecha límite</div>
              <input type="date" value={newAct.fecha_fin_plan} onChange={e => setNewAct(n => ({ ...n, fecha_fin_plan: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn size="sm" variant="primary" onClick={addActividad}>Agregar</Btn>
            <Btn size="sm" variant="default" onClick={() => setShowNew(false)}>Cancelar</Btn>
          </div>
        </div>
      )}

      {obra.actividades.length === 0 ? (
        <EmptyState message="No hay actividades registradas. Agrega la primera actividad para iniciar el seguimiento." />
      ) : (
        Array.from(bySistema.entries()).map(([sistema, acts]) => {
          const cfg = SISTEMAS_CONFIG[sistema]
          const Icon = cfg.icon
          const avgPct = Math.round(acts.reduce((s, a) => s + a.porcentaje, 0) / acts.length)
          return (
            <div key={sistema} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Icon size={14} color={cfg.color} />
                <span style={{ fontSize: 13, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
                <span style={{ fontSize: 11, color: '#555' }}>{avgPct}% promedio</span>
              </div>
              {acts.map(a => {
                const actSt = ACT_STATUS_CONFIG[a.status]
                const inst = instaladores.find(i => i.id === a.instalador_id)
                return (
                  <div key={a.id} style={{ ...cardStyle, padding: 12, marginBottom: 6, borderLeft: `3px solid ${actSt.color}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: '#ccc', marginBottom: 2 }}>{a.descripcion}</div>
                        <div style={{ fontSize: 10, color: '#555', display: 'flex', gap: 12 }}>
                          {inst && <span><Users size={10} style={{ verticalAlign: 'middle' }} /> {inst.nombre}</span>}
                          {a.fecha_fin_plan && <span><Calendar size={10} style={{ verticalAlign: 'middle' }} /> {formatDate(a.fecha_fin_plan)}</span>}
                        </div>
                        {a.bloqueo && (
                          <div style={{ fontSize: 10, color: '#EF4444', marginTop: 4, padding: '3px 8px', background: 'rgba(239,68,68,0.06)', borderRadius: 4 }}>
                            <AlertTriangle size={10} style={{ verticalAlign: 'middle' }} /> {a.bloqueo}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 220 }}>
                        <div style={{ width: 60 }}>
                          <ProgressBar pct={a.porcentaje} color={actSt.color} />
                          <div style={{ fontSize: 10, color: '#666', textAlign: 'center', marginTop: 2 }}>{a.porcentaje}%</div>
                        </div>
                        <input type="range" min={0} max={100} step={5} value={a.porcentaje}
                          onChange={e => updateActividad(a.id, {
                            porcentaje: Number(e.target.value),
                            status: Number(e.target.value) >= 100 ? 'completada' : Number(e.target.value) > 0 ? 'en_progreso' : 'pendiente',
                            fecha_fin_real: Number(e.target.value) >= 100 ? new Date().toISOString().substring(0, 10) : undefined,
                          })}
                          style={{ width: 80, accentColor: actSt.color }}
                        />
                        <select value={a.status}
                          onChange={e => updateActividad(a.id, { status: e.target.value as ActividadStatus })}
                          style={{ padding: '3px 6px', fontSize: 10, background: '#0a0a0a', border: '1px solid #333', borderRadius: 4, color: actSt.color, fontFamily: 'inherit' }}
                        >
                          {Object.entries(ACT_STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      </div>
                    </div>
                    {/* Bloqueo input when status is bloqueada */}
                    {a.status === 'bloqueada' && !a.bloqueo && (
                      <div style={{ marginTop: 6 }}>
                        <input placeholder="¿Qué lo está frenando?"
                          onKeyDown={e => { if (e.key === 'Enter') updateActividad(a.id, { bloqueo: (e.target as HTMLInputElement).value }) }}
                          style={{ ...inputStyle, fontSize: 11, padding: '4px 8px' }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   SUB: REPORTES DE OBRA (con AI)
   ═══════════════════════════════════════════════════════════════════ */

function SubReportes({ obra, instaladores, updateObra, showNew, setShowNew }: {
  obra: ObraData; instaladores: Instalador[]; updateObra: (fn: (o: ObraData) => ObraData) => void
  showNew: boolean; setShowNew: (v: boolean) => void
}) {
  const [newReporte, setNewReporte] = useState({ instalador_id: '', texto: '', fotos: [] as string[] })
  const [processing, setProcessing] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const newFotos: string[] = []
    for (let i = 0; i < Math.min(files.length, 5); i++) {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result as string)
        r.onerror = () => rej(new Error('Error'))
        r.readAsDataURL(files[i])
      })
      newFotos.push(b64)
    }
    setNewReporte(r => ({ ...r, fotos: [...r.fotos, ...newFotos].slice(0, 5) }))
    if (fileRef.current) fileRef.current.value = ''
  }

  const submitReporte = async () => {
    if (!newReporte.texto.trim() && newReporte.fotos.length === 0) return
    setProcessing(true)

    const reporte: ReporteObra = {
      id: 'r' + Date.now(), obra_id: obra.id,
      instalador_id: newReporte.instalador_id || obra.instaladores_ids[0] || '',
      fecha: new Date().toISOString().substring(0, 10),
      texto_raw: newReporte.texto.trim(),
      fotos: newReporte.fotos,
      procesado: false,
    }

    // Process with AI
    try {
      const systemPrompt = `Eres coordinador de obra experto en instalaciones especiales (CCTV, audio, redes, control de iluminación, control de acceso, eléctrico).

Analiza el reporte de campo del instalador y devuelve SOLO un JSON, sin markdown:
{
  "resumen": "resumen ejecutivo en 1-2 oraciones",
  "avances": ["lista de avances concretos realizados"],
  "faltantes": ["materiales o equipos que se necesitan"],
  "bloqueos": ["factores externos que están frenando el avance"]
}

Contexto de la obra: ${obra.nombre}
Sistemas: ${obra.sistemas.join(', ')}
El instalador reporta desde campo. Extrae información accionable.`

      const userContent: any[] = []
      // Add photos if any
      for (const foto of newReporte.fotos.slice(0, 3)) {
        const parts = foto.split(',')
        const mediaMatch = foto.match(/data:([^;]+);/)
        if (parts[1] && mediaMatch) {
          userContent.push({ type: 'image', source: { type: 'base64', media_type: mediaMatch[1], data: parts[1] } })
        }
      }
      userContent.push({ type: 'text', text: `Reporte del instalador:\n${newReporte.texto}` })

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-version': '2023-06-01', 'x-api-key': ANTHROPIC_API_KEY },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, system: systemPrompt, messages: [{ role: 'user', content: userContent }] }),
      })

      if (response.ok) {
        const data = await response.json()
        const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0].replace(/```json|```/g, '').trim())
          reporte.ai_resumen = parsed.resumen || ''
          reporte.ai_avances = parsed.avances || []
          reporte.ai_faltantes = parsed.faltantes || []
          reporte.ai_bloqueos = parsed.bloqueos || []
          reporte.procesado = true
        }
      }
    } catch (err) {
      console.error('AI processing error:', err)
    }

    updateObra(o => ({ ...o, reportes: [reporte, ...o.reportes] }))
    setNewReporte({ instalador_id: '', texto: '', fotos: [] })
    setShowNew(false)
    setProcessing(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Reportes de campo</div>
        <Btn size="sm" variant="primary" onClick={() => setShowNew(true)}><Plus size={12} /> Nuevo reporte</Btn>
      </div>

      {/* New report form */}
      {showNew && (
        <div style={{ ...cardStyle, borderColor: '#57FF9A33' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Nuevo reporte de campo</div>
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={labelStyle}>Instalador</div>
              <select value={newReporte.instalador_id} onChange={e => setNewReporte(r => ({ ...r, instalador_id: e.target.value }))} style={inputStyle}>
                <option value="">Seleccionar...</option>
                {instaladores.filter(i => obra.instaladores_ids.includes(i.id)).map(i => <option key={i.id} value={i.id}>{i.nombre}</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Fotos (máx 5)</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="file" ref={fileRef} accept="image/*" multiple style={{ display: 'none' }} onChange={handlePhotoUpload} />
                <Btn size="sm" variant="default" onClick={() => fileRef.current?.click()}><Camera size={12} /> Subir fotos</Btn>
                {newReporte.fotos.length > 0 && <span style={{ fontSize: 11, color: '#57FF9A' }}>{newReporte.fotos.length} foto{newReporte.fotos.length > 1 ? 's' : ''}</span>}
              </div>
            </div>
          </div>
          {/* Photo previews */}
          {newReporte.fotos.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {newReporte.fotos.map((f, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={f} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid #333' }} />
                  <button onClick={() => setNewReporte(r => ({ ...r, fotos: r.fotos.filter((_, j) => j !== i) }))}
                    style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#EF4444', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={8} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <div style={labelStyle}>Reporte de campo (texto del instalador)</div>
            <textarea value={newReporte.texto} onChange={e => setNewReporte(r => ({ ...r, texto: e.target.value }))}
              placeholder="Describe el avance del día, materiales usados, pendientes, problemas encontrados..."
              rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn size="sm" variant="primary" onClick={submitReporte} disabled={processing}>
              {processing ? <><Loader2 size={12} className="spin" /> Procesando con AI...</> : <><Upload size={12} /> Enviar reporte</>}
            </Btn>
            <Btn size="sm" variant="default" onClick={() => { setShowNew(false); setNewReporte({ instalador_id: '', texto: '', fotos: [] }) }}>Cancelar</Btn>
          </div>
        </div>
      )}

      {/* Reportes list */}
      {obra.reportes.length === 0 ? (
        <EmptyState message="No hay reportes de campo. Los instaladores envían reportes diarios con fotos y texto que se procesan con AI." />
      ) : (
        obra.reportes.map(r => {
          const inst = instaladores.find(i => i.id === r.instalador_id)
          const expanded = expandedId === r.id
          return (
            <div key={r.id} style={{ ...cardStyle, marginBottom: 8, cursor: 'pointer' }} onClick={() => setExpandedId(expanded ? null : r.id)}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{inst?.nombre || 'Instalador'}</span>
                    <span style={{ fontSize: 10, color: '#555' }}>{formatDate(r.fecha)}</span>
                    {r.procesado && <Badge label="AI procesado" color="#3B82F6" />}
                    {r.fotos.length > 0 && <span style={{ fontSize: 10, color: '#666' }}><Camera size={10} /> {r.fotos.length}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#888' }}>
                    {r.ai_resumen || (r.texto_raw.length > 100 ? r.texto_raw.substring(0, 100) + '...' : r.texto_raw)}
                  </div>
                </div>
                {r.ai_bloqueos && r.ai_bloqueos.length > 0 && <Badge label={`${r.ai_bloqueos.length} bloqueo${r.ai_bloqueos.length > 1 ? 's' : ''}`} color="#EF4444" />}
                <ChevronDown size={14} color="#444" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
              </div>

              {/* Expanded detail */}
              {expanded && (
                <div style={{ marginTop: 12, borderTop: '1px solid #222', paddingTop: 12 }} onClick={e => e.stopPropagation()}>
                  {/* Photos */}
                  {r.fotos.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      {r.fotos.map((f, i) => <img key={i} src={f} style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid #333' }} />)}
                    </div>
                  )}

                  {/* Raw text */}
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 12, padding: '8px 10px', background: '#0d0d0d', borderRadius: 6 }}>
                    <strong style={{ color: '#aaa' }}>Texto original:</strong><br />{r.texto_raw}
                  </div>

                  {/* AI analysis */}
                  {r.procesado && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      {r.ai_avances && r.ai_avances.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(87,255,154,0.04)', borderRadius: 6, border: '1px solid rgba(87,255,154,0.1)' }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#57FF9A', marginBottom: 6 }}>✓ Avances</div>
                          {r.ai_avances.map((a, i) => <div key={i} style={{ fontSize: 11, color: '#aaa', marginBottom: 3 }}>• {a}</div>)}
                        </div>
                      )}
                      {r.ai_faltantes && r.ai_faltantes.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(245,158,11,0.04)', borderRadius: 6, border: '1px solid rgba(245,158,11,0.1)' }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#F59E0B', marginBottom: 6 }}>⚠ Faltantes</div>
                          {r.ai_faltantes.map((f, i) => <div key={i} style={{ fontSize: 11, color: '#aaa', marginBottom: 3 }}>• {f}</div>)}
                        </div>
                      )}
                      {r.ai_bloqueos && r.ai_bloqueos.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(239,68,68,0.04)', borderRadius: 6, border: '1px solid rgba(239,68,68,0.1)' }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#EF4444', marginBottom: 6 }}>🚫 Bloqueos</div>
                          {r.ai_bloqueos.map((b, i) => <div key={i} style={{ fontSize: 11, color: '#aaa', marginBottom: 3 }}>• {b}</div>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   SUB: ENTREGA FORMAL
   ═══════════════════════════════════════════════════════════════════ */

function SubEntrega({ obra, updateObra }: { obra: ObraData; updateObra: (fn: (o: ObraData) => ObraData) => void }) {
  const toggleDoc = (idx: number) => {
    updateObra(o => ({
      ...o,
      entrega_docs: o.entrega_docs.map((d, i) => i === idx ? { ...d, recibido: !d.recibido } : d),
    }))
  }

  const allReceived = obra.entrega_docs.every(d => d.recibido)
  const received = obra.entrega_docs.filter(d => d.recibido).length

  return (
    <div>
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Checklist de entrega formal</div>
            <div style={{ fontSize: 11, color: '#666' }}>Documentación que oficina entrega al coordinador de obra al iniciar</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: allReceived ? '#57FF9A' : '#F59E0B' }}>{received}/{obra.entrega_docs.length}</div>
            <ProgressBar pct={Math.round(received / obra.entrega_docs.length * 100)} color={allReceived ? '#57FF9A' : '#F59E0B'} />
          </div>
        </div>

        {obra.entrega_docs.map((d, i) => (
          <div key={i} onClick={() => toggleDoc(i)} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
            background: d.recibido ? 'rgba(87,255,154,0.03)' : 'transparent',
            borderRadius: 6, cursor: 'pointer', marginBottom: 2,
            transition: 'background 0.12s',
          }}>
            <div style={{
              width: 20, height: 20, borderRadius: 4,
              border: d.recibido ? '2px solid #57FF9A' : '2px solid #333',
              background: d.recibido ? 'rgba(87,255,154,0.15)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {d.recibido && <CheckCircle size={12} color="#57FF9A" />}
            </div>
            <span style={{ fontSize: 12, color: d.recibido ? '#aaa' : '#666', textDecoration: d.recibido ? 'line-through' : 'none' }}>{d.nombre}</span>
          </div>
        ))}
      </div>

      {allReceived && obra.status === 'entrega_pendiente' && (
        <div style={{ padding: 16, background: 'rgba(87,255,154,0.05)', border: '1px solid rgba(87,255,154,0.15)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#57FF9A', fontWeight: 600, marginBottom: 8 }}>Todos los documentos recibidos</div>
          <Btn size="sm" variant="primary" onClick={() => updateObra(o => ({ ...o, status: 'en_ejecucion' }))}>
            <CheckCircle size={12} /> Iniciar ejecución de obra
          </Btn>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   SUB: EQUIPO DE INSTALACION
   ═══════════════════════════════════════════════════════════════════ */

function SubEquipo({ obra, instaladores, obraInstaladores, updateObra }: {
  obra: ObraData; instaladores: Instalador[]; obraInstaladores: Instalador[]; updateObra: (fn: (o: ObraData) => ObraData) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const disponibles = instaladores.filter(i => !obra.instaladores_ids.includes(i.id) && i.disponible)

  const addInstalador = (id: string) => {
    updateObra(o => ({ ...o, instaladores_ids: [...o.instaladores_ids, id] }))
  }
  const removeInstalador = (id: string) => {
    updateObra(o => ({ ...o, instaladores_ids: o.instaladores_ids.filter(x => x !== id) }))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Instaladores asignados</div>
        <Btn size="sm" variant="primary" onClick={() => setShowAdd(!showAdd)}><Plus size={12} /> Asignar instalador</Btn>
      </div>

      {/* Add picker */}
      {showAdd && disponibles.length > 0 && (
        <div style={{ ...cardStyle, borderColor: '#57FF9A33', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>Instaladores disponibles — click para asignar</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {disponibles.map(i => {
              const matchSistemas = i.habilidades.filter(h => obra.sistemas.includes(h))
              return (
                <button key={i.id} onClick={() => { addInstalador(i.id); setShowAdd(false) }} style={{
                  padding: '6px 12px', fontSize: 11, background: '#0a0a0a', border: '1px solid #333',
                  borderRadius: 8, color: '#ccc', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                }}>
                  <strong>{i.nombre}</strong>
                  <span style={{ color: '#555', marginLeft: 6 }}>{NIVEL_CONFIG[i.nivel].label}</span>
                  <span style={{ color: '#57FF9A', marginLeft: 6 }}>{matchSistemas.length}/{obra.sistemas.length} sistemas</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {obraInstaladores.length === 0 ? (
        <EmptyState message="No hay instaladores asignados a esta obra" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {obraInstaladores.map(i => {
            const niv = NIVEL_CONFIG[i.nivel]
            const matchSistemas = i.habilidades.filter(h => obra.sistemas.includes(h))
            const actividadesAsignadas = obra.actividades.filter(a => a.instalador_id === i.id)
            return (
              <div key={i.id} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{i.nombre}</div>
                    <div style={{ fontSize: 10, color: '#666' }}>{i.telefono}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'start' }}>
                    <Badge label={niv.label} color={niv.color} />
                    <button onClick={() => removeInstalador(i.id)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 10 }}><X size={12} /></button>
                  </div>
                </div>
                {/* Skills match */}
                <div style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>Habilidades en esta obra:</div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>
                  {i.habilidades.map(h => {
                    const match = obra.sistemas.includes(h)
                    const cfg = SISTEMAS_CONFIG[h]
                    return <Badge key={h} label={cfg?.label || h} color={match ? cfg?.color || '#555' : '#333'} />
                  })}
                </div>
                {/* Actividades asignadas */}
                {actividadesAsignadas.length > 0 && (
                  <div style={{ fontSize: 10, color: '#888' }}>
                    {actividadesAsignadas.length} actividad{actividadesAsignadas.length > 1 ? 'es' : ''} asignada{actividadesAsignadas.length > 1 ? 's' : ''}
                    {' · '}{actividadesAsignadas.filter(a => a.status === 'completada').length} completada{actividadesAsignadas.filter(a => a.status === 'completada').length !== 1 ? 's' : ''}
                  </div>
                )}
                {/* Rating */}
                <div style={{ marginTop: 6, fontSize: 11 }}>
                  {'★'.repeat(Math.round(i.calificacion))}{'☆'.repeat(5 - Math.round(i.calificacion))}
                  <span style={{ color: '#666', marginLeft: 4 }}>{i.calificacion}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   TAB: INSTALADORES (profiles)
   ═══════════════════════════════════════════════════════════════════ */

function TabInstaladores({ instaladores, setInstaladores, showNew, setShowNew }: {
  instaladores: Instalador[]; setInstaladores: (i: Instalador[]) => void
  showNew: boolean; setShowNew: (v: boolean) => void
}) {
  return (
    <div>
      {instaladores.length === 0 ? <EmptyState message="No hay instaladores registrados" /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {instaladores.map(i => {
            const niv = NIVEL_CONFIG[i.nivel]
            return (
              <div key={i.id} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{i.nombre}</div>
                    <div style={{ fontSize: 11, color: '#666' }}>{i.telefono}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'start' }}>
                    <Badge label={niv.label} color={niv.color} />
                    <Badge label={i.disponible ? 'Disponible' : 'Ocupado'} color={i.disponible ? '#57FF9A' : '#6B7280'} />
                  </div>
                </div>
                {/* Skills */}
                <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Habilidades:</div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>
                  {i.habilidades.map(h => {
                    const cfg = SISTEMAS_CONFIG[h]
                    return <Badge key={h} label={cfg?.label || h} color={cfg?.color || '#555'} />
                  })}
                </div>
                {/* Stats */}
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#888' }}>
                  <span>Obras activas: {i.obras_activas.length}</span>
                  <span>{'★'.repeat(Math.round(i.calificacion))}{'☆'.repeat(5 - Math.round(i.calificacion))} {i.calificacion}</span>
                </div>
                {i.notas && <div style={{ fontSize: 10, color: '#555', marginTop: 6, fontStyle: 'italic' }}>{i.notas}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   TAB: PLANEACION SEMANAL
   ═══════════════════════════════════════════════════════════════════ */

function TabPlaneacion({ obras, instaladores }: { obras: ObraData[]; instaladores: Instalador[] }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [processing, setProcessing] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<Map<string, Map<number, { obra: string; tarea: string; obraColor: string }[]>>>(new Map())
  const [selectedCell, setSelectedCell] = useState<{ instId: string; dayIdx: number } | null>(null)
  const [newTask, setNewTask] = useState({ obra_id: '', tarea: '' })

  // Week calculation
  const today = new Date()
  const mondayBase = new Date(today)
  mondayBase.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const weekDays = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(mondayBase)
    d.setDate(mondayBase.getDate() + i)
    return d
  })
  const dayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const weekLabel = `${weekDays[0].toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} — ${weekDays[5].toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`

  const obrasActivas = obras.filter(o => o.status === 'en_ejecucion')
  const obraColors = ['#57FF9A', '#3B82F6', '#F59E0B', '#C084FC', '#EF4444', '#06B6D4', '#EC4899', '#FF6B35']

  // Get assignments for an installer on a day
  const getCell = (instId: string, dayIdx: number) => {
    return assignments.get(instId)?.get(dayIdx) || []
  }

  // Add manual assignment
  const addAssignment = () => {
    if (!selectedCell || !newTask.obra_id || !newTask.tarea.trim()) return
    const { instId, dayIdx } = selectedCell
    const obra = obras.find(o => o.id === newTask.obra_id)
    if (!obra) return
    const obraIdx = obrasActivas.findIndex(o => o.id === newTask.obra_id)
    const color = obraColors[obraIdx % obraColors.length]

    setAssignments(prev => {
      const next = new Map(prev)
      const instMap = new Map(next.get(instId) || new Map())
      const dayArr = [...(instMap.get(dayIdx) || [])]
      dayArr.push({ obra: obra.nombre, tarea: newTask.tarea.trim(), obraColor: color })
      instMap.set(dayIdx, dayArr)
      next.set(instId, instMap)
      return next
    })
    setNewTask({ obra_id: '', tarea: '' })
    setSelectedCell(null)
  }

  // Remove assignment
  const removeAssignment = (instId: string, dayIdx: number, taskIdx: number) => {
    setAssignments(prev => {
      const next = new Map(prev)
      const instMap = new Map(next.get(instId) || new Map())
      const dayArr = [...(instMap.get(dayIdx) || [])]
      dayArr.splice(taskIdx, 1)
      if (dayArr.length === 0) instMap.delete(dayIdx)
      else instMap.set(dayIdx, dayArr)
      next.set(instId, instMap)
      return next
    })
  }

  // AI suggestion
  const sugerirConAI = async () => {
    setProcessing(true)
    setAiSuggestion(null)

    const context = obrasActivas.map((o, i) => {
      const pending = o.actividades.filter(a => a.status !== 'completada')
      const blocked = o.actividades.filter(a => a.status === 'bloqueada')
      const assignedInst = instaladores.filter(inst => o.instaladores_ids.includes(inst.id))
      return `OBRA ${i + 1}: ${o.nombre} (${o.avance_global}% avance, cliente: ${o.cliente})
  Pendientes: ${pending.map(a => `${a.descripcion} [${a.sistema}, ${a.porcentaje}%, ${ACT_STATUS_CONFIG[a.status].label}]`).join('; ') || 'ninguna'}
  Bloqueadas: ${blocked.map(a => `${a.descripcion}: ${a.bloqueo || 'sin detalle'}`).join('; ') || 'ninguna'}
  Instaladores asignados: ${assignedInst.map(inst => `${inst.nombre} (${inst.nivel}, ${inst.habilidades.join('/')})`).join('; ') || 'ninguno'}`
    }).join('\n\n')

    const instContext = instaladores.map(i =>
      `${i.nombre}: nivel ${i.nivel}, habilidades [${i.habilidades.join(', ')}], ${i.disponible ? 'disponible' : 'NO disponible'}, obras activas: ${i.obras_activas.length}`
    ).join('\n')

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-version': '2023-06-01', 'x-api-key': ANTHROPIC_API_KEY },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 4000,
          system: `Eres el coordinador de obra de OMM Technologies, empresa de instalaciones especiales (CCTV, audio, redes, control de iluminación Lutron, control de acceso, eléctrico).

Tu trabajo es planear la semana de los instaladores considerando:
1. Prioridad de actividades bloqueadas vs pendientes
2. Habilidades de cada instalador vs sistemas requeridos
3. No saturar a un instalador (máx 1 obra por día idealmente)
4. Ubicación de obras (minimizar traslados)
5. Actividades que están más retrasadas tienen prioridad
6. La planeación es de lunes a sábado

Responde con un JSON y luego una explicación. El JSON debe ser:
{"plan": [{"instalador": "nombre", "dia": "Lun|Mar|Mié|Jue|Vie|Sáb", "obra": "nombre obra", "tarea": "qué hacer"}]}

Después del JSON, escribe un párrafo con el razonamiento y recomendaciones.`,
          messages: [{ role: 'user', content: `Semana: ${weekLabel}\n\nOBRAS ACTIVAS:\n${context}\n\nINSTALADORES:\n${instContext}\n\nGenera la planeación semanal óptima.` }],
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')

        // Parse JSON plan
        const jsonMatch = text.match(/\{[\s\S]*?"plan"[\s\S]*?\}/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0].replace(/```json|```/g, '').trim())
            if (parsed.plan && Array.isArray(parsed.plan)) {
              const newAssignments = new Map<string, Map<number, { obra: string; tarea: string; obraColor: string }[]>>()
              const dayMap: Record<string, number> = { 'Lun': 0, 'Mar': 1, 'Mié': 2, 'Jue': 3, 'Vie': 4, 'Sáb': 5 }

              parsed.plan.forEach((item: any) => {
                const inst = instaladores.find(i => i.nombre.toLowerCase().includes((item.instalador || '').toLowerCase().split(' ')[0]))
                if (!inst) return
                const dayIdx = dayMap[item.dia]
                if (dayIdx === undefined) return

                const obraMatch = obrasActivas.find(o => o.nombre.toLowerCase().includes((item.obra || '').toLowerCase().split(' ')[0]))
                const obraIdx = obraMatch ? obrasActivas.indexOf(obraMatch) : 0
                const color = obraColors[obraIdx % obraColors.length]

                const instMap = newAssignments.get(inst.id) || new Map()
                const dayArr = instMap.get(dayIdx) || []
                dayArr.push({ obra: item.obra || '', tarea: item.tarea || '', obraColor: color })
                instMap.set(dayIdx, dayArr)
                newAssignments.set(inst.id, instMap)
              })

              setAssignments(newAssignments)
            }
          } catch (_e) { /* parse error, still show text */ }
        }

        // Extract explanation (everything after JSON)
        const explanation = text.replace(/\{[\s\S]*?"plan"[\s\S]*?\}/, '').replace(/```json|```/g, '').trim()
        if (explanation) setAiSuggestion(explanation)
      }
    } catch (err) {
      console.error('AI planning error:', err)
      setAiSuggestion('Error al generar sugerencia. Intenta de nuevo.')
    }
    setProcessing(false)
  }

  return (
    <div>
      {/* Week navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: '#141414', border: '1px solid #333', borderRadius: 6, padding: '4px 10px', color: '#ccc', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>← Anterior</button>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', flex: 1, textAlign: 'center' }}>
          <Calendar size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {weekLabel}
          {weekOffset === 0 && <span style={{ fontSize: 10, color: '#57FF9A', marginLeft: 8 }}>Esta semana</span>}
        </div>
        <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: '#141414', border: '1px solid #333', borderRadius: 6, padding: '4px 10px', color: '#ccc', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>Siguiente →</button>
        <Btn size="sm" variant="primary" onClick={sugerirConAI} disabled={processing || obrasActivas.length === 0}>
          {processing ? <><Loader2 size={12} /> Generando...</> : <>🤖 Sugerir con AI</>}
        </Btn>
      </div>

      {/* AI suggestion */}
      {aiSuggestion && (
        <div style={{ ...cardStyle, borderColor: 'rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.03)', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#3B82F6' }}>🤖 Razonamiento AI</div>
            <button onClick={() => setAiSuggestion(null)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={14} /></button>
          </div>
          <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.6 }}>{aiSuggestion}</div>
        </div>
      )}

      {/* Obra legend */}
      {obrasActivas.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {obrasActivas.map((o, i) => (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: obraColors[i % obraColors.length] }} />
              <span style={{ color: '#888' }}>{o.nombre}</span>
            </div>
          ))}
        </div>
      )}

      {/* Calendar grid */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontSize: 11, fontWeight: 600, borderBottom: '1px solid #222', minWidth: 140, background: '#111' }}>Instalador</th>
              {weekDays.map((d, i) => {
                const isToday = d.toDateString() === today.toDateString()
                return (
                  <th key={i} style={{
                    padding: '8px 6px', textAlign: 'center', fontSize: 11, fontWeight: 600,
                    borderBottom: '1px solid #222', minWidth: 130,
                    color: isToday ? '#57FF9A' : '#666',
                    background: isToday ? 'rgba(87,255,154,0.04)' : '#111',
                  }}>
                    <div>{dayLabels[i]}</div>
                    <div style={{ fontSize: 10, fontWeight: 400 }}>{d.getDate()}/{d.getMonth() + 1}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {instaladores.filter(i => i.disponible).map(inst => {
              const niv = NIVEL_CONFIG[inst.nivel]
              return (
                <tr key={inst.id}>
                  <td style={{ padding: '8px 12px', borderBottom: '1px solid #1a1a1a', verticalAlign: 'top' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#ccc' }}>{inst.nombre}</div>
                    <div style={{ fontSize: 9, color: niv.color }}>{niv.label}</div>
                    <div style={{ fontSize: 9, color: '#444', marginTop: 2 }}>{inst.habilidades.map(h => SISTEMAS_CONFIG[h]?.label?.substring(0, 4)).join(' · ')}</div>
                  </td>
                  {weekDays.map((_, dayIdx) => {
                    const tasks = getCell(inst.id, dayIdx)
                    const isSelected = selectedCell?.instId === inst.id && selectedCell?.dayIdx === dayIdx
                    const isToday = weekDays[dayIdx].toDateString() === today.toDateString()
                    return (
                      <td key={dayIdx}
                        onClick={() => setSelectedCell(isSelected ? null : { instId: inst.id, dayIdx })}
                        style={{
                          padding: 4, borderBottom: '1px solid #1a1a1a', verticalAlign: 'top',
                          cursor: 'pointer', minHeight: 60,
                          background: isSelected ? 'rgba(87,255,154,0.06)' : isToday ? 'rgba(87,255,154,0.02)' : 'transparent',
                          border: isSelected ? '1px solid rgba(87,255,154,0.2)' : '1px solid transparent',
                          transition: 'all 0.1s',
                        }}
                      >
                        {tasks.map((t, ti) => (
                          <div key={ti} style={{
                            padding: '3px 6px', marginBottom: 3, borderRadius: 4, fontSize: 10,
                            background: `${t.obraColor}10`, borderLeft: `2px solid ${t.obraColor}`,
                            position: 'relative',
                          }}>
                            <div style={{ fontWeight: 600, color: t.obraColor, fontSize: 9 }}>{t.obra}</div>
                            <div style={{ color: '#aaa' }}>{t.tarea}</div>
                            <button onClick={e => { e.stopPropagation(); removeAssignment(inst.id, dayIdx, ti) }}
                              style={{ position: 'absolute', top: 2, right: 2, background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 8, padding: 0 }}>
                              <X size={8} />
                            </button>
                          </div>
                        ))}
                        {tasks.length === 0 && (
                          <div style={{ fontSize: 10, color: '#2a2a2a', textAlign: 'center', padding: '8px 0' }}>+</div>
                        )}

                        {/* Inline add form */}
                        {isSelected && (
                          <div style={{ marginTop: 4, padding: 4, background: '#0d0d0d', borderRadius: 6, border: '1px solid #333' }}
                            onClick={e => e.stopPropagation()}>
                            <select value={newTask.obra_id} onChange={e => setNewTask(t => ({ ...t, obra_id: e.target.value }))}
                              style={{ ...inputStyle, fontSize: 10, padding: '3px 4px', marginBottom: 3 }}>
                              <option value="">Obra...</option>
                              {obrasActivas.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                            </select>
                            <input value={newTask.tarea} onChange={e => setNewTask(t => ({ ...t, tarea: e.target.value }))}
                              placeholder="Tarea..."
                              onKeyDown={e => { if (e.key === 'Enter') addAssignment() }}
                              style={{ ...inputStyle, fontSize: 10, padding: '3px 4px', marginBottom: 3 }} />
                            <div style={{ display: 'flex', gap: 3 }}>
                              <button onClick={addAssignment} style={{ flex: 1, padding: '2px 4px', fontSize: 9, background: 'rgba(87,255,154,0.1)', border: '1px solid rgba(87,255,154,0.2)', borderRadius: 4, color: '#57FF9A', cursor: 'pointer', fontFamily: 'inherit' }}>Agregar</button>
                              <button onClick={() => setSelectedCell(null)} style={{ padding: '2px 4px', fontSize: 9, background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, color: '#666', cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
                            </div>
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {obrasActivas.length === 0 && (
        <div style={{ marginTop: 20 }}>
          <EmptyState message="No hay obras en ejecución. La planeación semanal se genera a partir de obras activas con actividades pendientes." />
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   MODAL: NUEVA OBRA
   ═══════════════════════════════════════════════════════════════════ */

function NuevaObraModal({ onClose, onCreate }: { onClose: () => void; onCreate: (o: ObraData) => void }) {
  const [form, setForm] = useState({
    nombre: '', cliente: '', direccion: '', coordinador: 'Alfredo Rosas',
    cotizacion_ref: '', valor_contrato: '', sistemas: [] as Sistema[],
    fecha_fin_plan: '',
  })

  const toggleSistema = (s: Sistema) => {
    setForm(f => ({ ...f, sistemas: f.sistemas.includes(s) ? f.sistemas.filter(x => x !== s) : [...f.sistemas, s] }))
  }

  const crear = () => {
    if (!form.nombre.trim()) return
    const obra: ObraData = {
      id: 'o' + Date.now(), nombre: form.nombre.trim(), cliente: form.cliente.trim(),
      direccion: form.direccion.trim(), status: 'entrega_pendiente',
      cotizacion_ref: form.cotizacion_ref.trim(), coordinador: form.coordinador.trim(),
      sistemas: form.sistemas, instaladores_ids: [],
      fecha_fin_plan: form.fecha_fin_plan || undefined,
      avance_global: 0, actividades: [], reportes: [],
      entrega_docs: DOCS_ENTREGA.map(d => ({ nombre: d, recibido: false })),
      valor_contrato: parseFloat(form.valor_contrato) || 0,
    }
    onCreate(obra)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 24, width: 520, maxHeight: '80vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>Nueva obra</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <div style={labelStyle}>Nombre de obra *</div>
            <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Oasis 6 - Torre B" style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={labelStyle}>Cliente</div>
              <input value={form.cliente} onChange={e => setForm(f => ({ ...f, cliente: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <div style={labelStyle}>Coordinador</div>
              <input value={form.coordinador} onChange={e => setForm(f => ({ ...f, coordinador: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <div>
            <div style={labelStyle}>Dirección</div>
            <input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <div style={labelStyle}>Ref. cotización</div>
              <input value={form.cotizacion_ref} onChange={e => setForm(f => ({ ...f, cotizacion_ref: e.target.value }))} placeholder="COT-ESP-..." style={inputStyle} />
            </div>
            <div>
              <div style={labelStyle}>Valor contrato</div>
              <input type="number" value={form.valor_contrato} onChange={e => setForm(f => ({ ...f, valor_contrato: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <div style={labelStyle}>Fecha fin planeada</div>
              <input type="date" value={form.fecha_fin_plan} onChange={e => setForm(f => ({ ...f, fecha_fin_plan: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <div>
            <div style={labelStyle}>Sistemas</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(SISTEMAS_CONFIG).map(([k, v]) => {
                const selected = form.sistemas.includes(k as Sistema)
                return (
                  <button key={k} onClick={() => toggleSistema(k as Sistema)} style={{
                    padding: '5px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                    background: selected ? `${v.color}15` : '#0a0a0a',
                    border: `1px solid ${selected ? v.color : '#333'}`,
                    color: selected ? v.color : '#666',
                  }}>{v.label}</button>
                )
              })}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Btn size="sm" variant="default" onClick={onClose}>Cancelar</Btn>
          <Btn size="sm" variant="primary" onClick={crear}>Crear obra</Btn>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   MODAL: NUEVO INSTALADOR
   ═══════════════════════════════════════════════════════════════════ */

function NuevoInstaladorModal({ onClose, onCreate }: { onClose: () => void; onCreate: (i: Instalador) => void }) {
  const [form, setForm] = useState({
    nombre: '', telefono: '', nivel: 'medio' as 'senior' | 'medio' | 'junior',
    habilidades: [] as Sistema[], notas: '',
  })

  const toggleHab = (s: Sistema) => {
    setForm(f => ({ ...f, habilidades: f.habilidades.includes(s) ? f.habilidades.filter(x => x !== s) : [...f.habilidades, s] }))
  }

  const crear = () => {
    if (!form.nombre.trim()) return
    const inst: Instalador = {
      id: 'i' + Date.now(), nombre: form.nombre.trim(), telefono: form.telefono.trim(),
      habilidades: form.habilidades, nivel: form.nivel,
      obras_activas: [], disponible: true, calificacion: 3.0, notas: form.notas.trim() || undefined,
    }
    onCreate(inst)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 24, width: 460 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>Nuevo instalador</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={labelStyle}>Nombre *</div>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <div style={labelStyle}>Teléfono</div>
              <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <div>
            <div style={labelStyle}>Nivel</div>
            <select value={form.nivel} onChange={e => setForm(f => ({ ...f, nivel: e.target.value as any }))} style={inputStyle}>
              {Object.entries(NIVEL_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <div style={labelStyle}>Habilidades</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(SISTEMAS_CONFIG).map(([k, v]) => {
                const selected = form.habilidades.includes(k as Sistema)
                return (
                  <button key={k} onClick={() => toggleHab(k as Sistema)} style={{
                    padding: '5px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                    background: selected ? `${v.color}15` : '#0a0a0a',
                    border: `1px solid ${selected ? v.color : '#333'}`,
                    color: selected ? v.color : '#666',
                  }}>{v.label}</button>
                )
              })}
            </div>
          </div>
          <div>
            <div style={labelStyle}>Notas (certificaciones, experiencia)</div>
            <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Btn size="sm" variant="default" onClick={onClose}>Cancelar</Btn>
          <Btn size="sm" variant="primary" onClick={crear}>Crear instalador</Btn>
        </div>
      </div>
    </div>
  )
}
