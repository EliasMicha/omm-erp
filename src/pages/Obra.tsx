import React, { useState, useRef, useEffect } from 'react'
import { SectionHeader, KpiCard, Table, Th, Td, Badge, Btn, EmptyState, ProgressBar, Loading } from '../components/layout/UI'
import { F, formatDate } from '../lib/utils'
import { ANTHROPIC_API_KEY } from '../lib/config'
import { supabase } from '../lib/supabase'
import {
  HardHat, Users, ClipboardList, Calendar, AlertTriangle, CheckCircle,
  Clock, ChevronRight, ArrowLeft, Plus, Upload, Camera, X, Eye,
  Wrench, Wifi, Volume2, Shield, Sun, MapPin, FileText, TrendingUp,
  Loader2, MessageSquare, Lock, ChevronDown, Package
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
  area?: string
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
  cotizacion_id?: string
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
   DATA LOADERS — Supabase (commit 1)
   Las subtablas (actividades, reportes, entrega_docs) siguen en memoria
   por compatibilidad con los Sub* — se persisten en Commit 2.
   ═══════════════════════════════════════════════════════════════════ */

// Mapea un row de employees al tipo Instalador (compat layer hasta refactor de Sub*)
function rowToInstalador(e: any): Instalador {
  const nivelMap: Record<string, 'senior' | 'medio' | 'junior'> = {
    oro: 'senior', plata: 'medio', bronce: 'junior', sin_nivel: 'junior',
  }
  return {
    id: e.id,
    nombre: e.name || '',
    telefono: e.phone || '',
    habilidades: (e.skills || []) as Sistema[],
    nivel: nivelMap[e.level] || 'medio',
    obras_activas: [], // se llena en cliente con un join post-load si hace falta
    disponible: e.disponible !== false,
    foto_url: e.foto_url || undefined,
    notas: e.notes || undefined,
    calificacion: e.calificacion || 0,
  }
}

// Mapea un row de obras (con joins) al tipo ObraData
function rowToObra(o: any, coordinadorName: string): ObraData {
  return {
    id: o.id,
    nombre: o.nombre || '',
    cliente: o.cliente || '',
    direccion: o.direccion || '',
    status: (o.status || 'entrega_pendiente') as ObraStatus,
    cotizacion_id: o.quotation_id || undefined,
    cotizacion_ref: o.quotation_id ? '' : undefined, // se hidrata si hace falta
    coordinador: coordinadorName,
    sistemas: (o.sistemas || []) as Sistema[],
    instaladores_ids: (o.instaladores_ids || []) as string[],
    fecha_inicio: o.fecha_inicio || undefined,
    fecha_fin_plan: o.fecha_fin_plan || undefined,
    avance_global: o.avance_global || 0,
    actividades: [], // mock por ahora — Commit 2 carga de obra_actividades
    reportes: [],    // mock por ahora — Commit 2 carga de obra_reportes
    entrega_docs: DOCS_ENTREGA.map(d => ({ nombre: d, recibido: false })), // mock — Commit 2
    notas: o.notas || undefined,
    valor_contrato: o.valor_contrato || 0,
  }
}

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
  const [obras, setObras] = useState<ObraData[]>([])
  const [instaladores, setInstaladores] = useState<Instalador[]>([])
  const [coordinadores, setCoordinadores] = useState<Array<{ id: string; name: string }>>([])
  const [selectedObra, setSelectedObra] = useState<string | null>(null)
  const [showNewObra, setShowNewObra] = useState(false)
  const [showNewInstalador, setShowNewInstalador] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Carga inicial: obras + employees (instaladores + coordinadores)
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const [obrasRes, empRes] = await Promise.all([
          supabase.from('obras').select('*').order('created_at', { ascending: false }),
          supabase.from('employees').select('id,name,phone,role,level,skills,disponible,foto_url,calificacion,notes,is_active').eq('is_active', true).order('name'),
        ])
        if (cancelled) return
        if (obrasRes.error) {
          console.error('Error cargando obras:', obrasRes.error)
          setLoadError('Error al cargar obras: ' + obrasRes.error.message)
          setLoading(false)
          return
        }
        if (empRes.error) {
          console.error('Error cargando employees:', empRes.error)
          setLoadError('Error al cargar empleados: ' + empRes.error.message)
          setLoading(false)
          return
        }
        const empleados = empRes.data || []
        // Instaladores = role 'instalador'
        const insts = empleados.filter((e: any) => e.role === 'instalador').map(rowToInstalador)
        // Coordinadores = role 'coordinador' o 'dg'
        const coords = empleados.filter((e: any) => e.role === 'coordinador' || e.role === 'dg').map((e: any) => ({ id: e.id, name: e.name || '' }))
        // Mapa id -> name para resolver coordinador_id en obras
        const coordMap = new Map<string, string>()
        empleados.forEach((e: any) => coordMap.set(e.id, e.name || ''))
        const obrasMapped = (obrasRes.data || []).map((o: any) => rowToObra(o, coordMap.get(o.coordinador_id || '') || ''))
        setInstaladores(insts)
        setCoordinadores(coords)
        setObras(obrasMapped)
        setLoading(false)
      } catch (err: any) {
        if (cancelled) return
        console.error('Excepción cargando obras:', err)
        setLoadError('Error inesperado: ' + (err?.message || String(err)))
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const obra = selectedObra ? obras.find(o => o.id === selectedObra) : null

  const updateObra = (id: string, updater: (o: ObraData) => ObraData) => {
    setObras(prev => prev.map(o => o.id === id ? updater(o) : o))
  }

  // Persiste una obra nueva en Supabase + agrega al state
  async function crearObraEnDB(form: {
    nombre: string; cliente: string; direccion: string; coordinador_id: string;
    cotizacion_id: string; valor_contrato: number; sistemas: Sistema[]; fecha_fin_plan: string;
  }): Promise<{ ok: true; obra: ObraData } | { ok: false; error: string }> {
    try {
      // Resolver project_id desde la cotización si hay
      let project_id: string | null = null
      if (form.cotizacion_id) {
        const { data: cot } = await supabase.from('quotations').select('project_id').eq('id', form.cotizacion_id).single()
        if (cot) project_id = cot.project_id || null
      }
      const payload: any = {
        nombre: form.nombre,
        cliente: form.cliente || null,
        direccion: form.direccion || null,
        status: 'entrega_pendiente',
        quotation_id: form.cotizacion_id || null,
        project_id,
        coordinador_id: form.coordinador_id || null,
        sistemas: form.sistemas,
        fecha_fin_plan: form.fecha_fin_plan || null,
        avance_global: 0,
        valor_contrato: form.valor_contrato || 0,
        moneda: 'MXN',
      }
      const { data, error } = await supabase.from('obras').insert(payload).select().single()
      if (error) {
        console.error('Error creando obra:', error)
        return { ok: false, error: error.message }
      }
      const coordName = coordinadores.find(c => c.id === form.coordinador_id)?.name || ''
      const nuevaObra = rowToObra(data, coordName)
      setObras(prev => [nuevaObra, ...prev])
      return { ok: true, obra: nuevaObra }
    } catch (err: any) {
      console.error('Excepción creando obra:', err)
      return { ok: false, error: err?.message || String(err) }
    }
  }

  // Persiste un nuevo instalador (employee con role='instalador')
  async function crearInstaladorEnDB(form: {
    nombre: string; telefono: string; nivel: 'senior' | 'medio' | 'junior';
    habilidades: Sistema[]; notas: string;
  }): Promise<{ ok: true; instalador: Instalador } | { ok: false; error: string }> {
    try {
      const nivelToLevel: Record<'senior' | 'medio' | 'junior', string> = {
        senior: 'oro', medio: 'plata', junior: 'bronce',
      }
      const payload: any = {
        name: form.nombre,
        phone: form.telefono || null,
        role: 'instalador',
        level: nivelToLevel[form.nivel],
        skills: form.habilidades,
        notes: form.notas || null,
        is_active: true,
        disponible: true,
      }
      const { data, error } = await supabase.from('employees').insert(payload).select().single()
      if (error) {
        console.error('Error creando instalador:', error)
        return { ok: false, error: error.message }
      }
      const inst = rowToInstalador(data)
      setInstaladores(prev => [inst, ...prev])
      return { ok: true, instalador: inst }
    } catch (err: any) {
      console.error('Excepción creando instalador:', err)
      return { ok: false, error: err?.message || String(err) }
    }
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

      {loadError && (
        <div style={{ marginBottom: 16, padding: '10px 12px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 8, color: '#f87171', fontSize: 12, display: 'flex', gap: 8 }}>
          <span>⚠</span><span>{loadError}</span>
        </div>
      )}

      {loading && <div style={{ marginBottom: 16 }}><Loading /></div>}

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
          {obras.length === 0 && !loading ? <EmptyState message="No hay obras registradas" /> : (
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

      {/* Modal nueva obra — usa crearObraEnDB */}
      {showNewObra && <NuevaObraModal
        coordinadores={coordinadores}
        onClose={() => setShowNewObra(false)}
        onSubmit={crearObraEnDB}
        onCreated={() => setShowNewObra(false)}
      />}

      {/* Modal nuevo instalador — usa crearInstaladorEnDB */}
      {showNewInstalador && <NuevoInstaladorModal
        onClose={() => setShowNewInstalador(false)}
        onSubmit={crearInstaladorEnDB}
        onCreated={() => setShowNewInstalador(false)}
      />}
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
  const [subTab, setSubTab] = useState<'actividades' | 'reportes' | 'entrega' | 'equipo' | 'materiales'>('actividades')
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
          { key: 'materiales' as const, label: 'Materiales', icon: Package },
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
      {subTab === 'materiales' && <SubMateriales obra={obra} />}
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
  const [newAct, setNewAct] = useState({ sistema: 'CCTV' as Sistema, descripcion: '', instalador_id: '', fecha_fin_plan: '', area: '' })
  const [groupBy, setGroupBy] = useState<'sistema' | 'area'>('sistema')
  const [generating, setGenerating] = useState(false)
  const [genStatus, setGenStatus] = useState('')

  const addActividad = () => {
    if (!newAct.descripcion.trim()) return
    const act: Actividad = {
      id: 'a' + Date.now(), obra_id: obra.id, sistema: newAct.sistema,
      descripcion: newAct.descripcion.trim(), status: 'pendiente',
      instalador_id: newAct.instalador_id || undefined,
      fecha_fin_plan: newAct.fecha_fin_plan || undefined,
      area: newAct.area || undefined,
      porcentaje: 0,
    }
    updateObra(o => ({ ...o, actividades: [...o.actividades, act] }))
    setNewAct({ sistema: 'CCTV', descripcion: '', instalador_id: '', fecha_fin_plan: '', area: '' })
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

  /* --- AI Autogenerate from quotation --- */
  const autogenerarConAI = async () => {
    if (!obra.cotizacion_id) {
      setGenStatus('No hay cotización vinculada a esta obra')
      return
    }
    setGenerating(true)
    setGenStatus('Leyendo cotización de Supabase...')

    try {
      // Fetch quotation areas and items
      const [areasRes, itemsRes] = await Promise.all([
        supabase.from('quotation_areas').select('*').eq('quotation_id', obra.cotizacion_id).order('order_index'),
        supabase.from('quotation_items').select('*').eq('quotation_id', obra.cotizacion_id).order('order_index'),
      ])

      const areas = areasRes.data || []
      const items = itemsRes.data || []

      if (items.length === 0) {
        setGenStatus('La cotización no tiene productos')
        setGenerating(false)
        return
      }

      setGenStatus(`${items.length} productos en ${areas.length} áreas. Generando tareas con AI...`)

      // Build context for AI
      const cotContext = areas.map(area => {
        const areaItems = items.filter((it: any) => it.area_id === area.id)
        return `ÁREA: ${area.name}\n${areaItems.map((it: any) => `  - ${it.quantity}x ${it.name} [${it.system || 'General'}]`).join('\n')}`
      }).join('\n\n')

      const systemMap = `Mapeo de sistemas de cotización a sistemas de obra:
Audio, Sonos, bocina, speaker, amplificador = "Audio"
Redes, access point, switch, patch panel, Cat6, rack, UPS = "Redes"
CCTV, cámara, NVR, DVR, Hikvision = "CCTV"
Control de Iluminación, Lutron, dimmer, keypad, procesador, Caseta, Pico = "Control"
Control de Acceso, lector, HID, cerradura, chapa = "Acceso"
Eléctrico, canalización, registro, contacto, apagador, centro de carga = "Electrico"`

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-version': '2023-06-01', 'x-api-key': ANTHROPIC_API_KEY },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 8000,
          system: `Eres coordinador de obra de instalaciones especiales. A partir de la cotización, genera las TAREAS DE INSTALACIÓN en campo.

REGLAS:
1. Cada producto en cada área genera una tarea. El formato es: "[Acción] de [producto] - [área]"
   Ejemplo: "Colocación de access point - Recámara Principal"
   Ejemplo: "Instalación de cámara domo Hikvision - Estacionamiento N-2"
   Ejemplo: "Tendido de cable Cat6 (3 corridas) - Sala"
   Ejemplo: "Montaje de bocina Sonos Outdoor - Terraza"
   Ejemplo: "Programación de procesador Lutron - General"
2. Si un producto tiene quantity > 1, menciona la cantidad: "Colocación de 4 access points - Recámara Principal"
3. Agrupa cables/canalizaciones del mismo tipo en la misma área en UNA sola tarea
4. Agrega tareas de infraestructura implícitas: canalización, cableado, montaje de rack, pruebas
5. Agrega tarea de programación/configuración por sistema al final (área "General")
6. Agrega tarea de pruebas y puesta en marcha por sistema (área "General")

${systemMap}

Devuelve SOLO un JSON array, sin markdown:
[{"descripcion":"texto de la tarea","sistema":"Audio|Redes|CCTV|Control|Acceso|Electrico","area":"nombre del área"}]`,
          messages: [{ role: 'user', content: `Cotización de obra: ${obra.nombre}\n\n${cotContext}` }],
        }),
      })

      if (!response.ok) {
        setGenStatus('Error API: ' + response.status)
        setGenerating(false)
        return
      }

      const data = await response.json()
      const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      const jsonMatch = text.match(/\[[\s\S]*\]/)

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0].replace(/```json|```/g, '').trim())
        if (Array.isArray(parsed) && parsed.length > 0) {
          const validSistemas = ['CCTV', 'Audio', 'Redes', 'Control', 'Acceso', 'Electrico']
          const newActs: Actividad[] = parsed.map((t: any, i: number) => {
            let sistema = t.sistema || 'Redes'
            if (!validSistemas.includes(sistema)) {
              // Try to match
              const lower = sistema.toLowerCase()
              if (lower.includes('audio')) sistema = 'Audio'
              else if (lower.includes('red') || lower.includes('network')) sistema = 'Redes'
              else if (lower.includes('cctv') || lower.includes('cam')) sistema = 'CCTV'
              else if (lower.includes('control') && lower.includes('acc')) sistema = 'Acceso'
              else if (lower.includes('control') || lower.includes('lutron')) sistema = 'Control'
              else if (lower.includes('elec')) sistema = 'Electrico'
              else sistema = 'Redes'
            }
            return {
              id: 'a' + Date.now() + i,
              obra_id: obra.id,
              sistema: sistema as Sistema,
              area: t.area || '',
              descripcion: t.descripcion || '',
              status: 'pendiente' as ActividadStatus,
              porcentaje: 0,
            }
          })
          updateObra(o => ({ ...o, actividades: [...o.actividades, ...newActs] }))
          setGenStatus(`✓ ${newActs.length} tareas generadas desde cotización`)
        } else {
          setGenStatus('No se generaron tareas')
        }
      } else {
        setGenStatus('Error al parsear respuesta AI')
      }
    } catch (err) {
      setGenStatus('Error: ' + (err as Error).message)
    }
    setGenerating(false)
  }

  // Group activities
  const grouped = new Map<string, Actividad[]>()
  obra.actividades.forEach(a => {
    const key = groupBy === 'sistema' ? a.sistema : (a.area || 'Sin área')
    const arr = grouped.get(key) || []
    arr.push(a)
    grouped.set(key, arr)
  })

  // Get unique areas for the new activity form
  const uniqueAreas = Array.from(new Set(obra.actividades.map(a => a.area).filter(Boolean))) as string[]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Actividades</div>
          {/* Group toggle */}
          <div style={{ display: 'flex', gap: 2, background: '#141414', borderRadius: 6, padding: 2, border: '1px solid #222' }}>
            {(['sistema', 'area'] as const).map(g => (
              <button key={g} onClick={() => setGroupBy(g)} style={{
                padding: '3px 8px', fontSize: 10, fontWeight: groupBy === g ? 600 : 400,
                color: groupBy === g ? '#fff' : '#555',
                background: groupBy === g ? '#333' : 'transparent',
                border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
              }}>Por {g}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {genStatus && <span style={{ fontSize: 10, color: genStatus.startsWith('✓') ? '#57FF9A' : genStatus.startsWith('Error') ? '#EF4444' : '#888' }}>{genStatus}</span>}
          {obra.cotizacion_id && (
            <Btn size="sm" variant="default" onClick={autogenerarConAI} disabled={generating}>
              {generating ? <><Loader2 size={12} /> Generando...</> : <>🤖 Autogenerar desde cotización</>}
            </Btn>
          )}
          <Btn size="sm" variant="primary" onClick={() => setShowNew(true)}><Plus size={12} /> Nueva actividad</Btn>
        </div>
      </div>

      {/* New activity form */}
      {showNew && (
        <div style={{ ...cardStyle, borderColor: '#57FF9A33' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Nueva actividad</div>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 150px 150px 130px', gap: 8, marginBottom: 10 }}>
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
              <div style={labelStyle}>Área</div>
              <input value={newAct.area} onChange={e => setNewAct(n => ({ ...n, area: e.target.value }))} placeholder="Ej: Recámara Principal" list="areas-list" style={inputStyle} />
              <datalist id="areas-list">{uniqueAreas.map(a => <option key={a} value={a} />)}</datalist>
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
        <div>
          <EmptyState message="No hay actividades registradas." />
          {obra.cotizacion_id && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Btn size="sm" variant="primary" onClick={autogenerarConAI} disabled={generating}>
                {generating ? <><Loader2 size={12} /> Generando...</> : <>🤖 Autogenerar tareas desde cotización</>}
              </Btn>
              <div style={{ fontSize: 10, color: '#555', marginTop: 6 }}>Lee la cotización y genera las tareas de instalación por área y sistema</div>
            </div>
          )}
          {!obra.cotizacion_id && (
            <div style={{ textAlign: 'center', fontSize: 11, color: '#555', marginTop: 8 }}>
              Vincula una cotización a esta obra para poder autogenerar tareas
            </div>
          )}
        </div>
      ) : (
        Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([groupKey, acts]) => {
          const isSystemGroup = groupBy === 'sistema'
          const cfg = isSystemGroup ? SISTEMAS_CONFIG[groupKey as Sistema] : null
          const Icon = cfg?.icon || ClipboardList
          const groupColor = cfg?.color || '#888'
          const avgPct = Math.round(acts.reduce((s, a) => s + a.porcentaje, 0) / acts.length)
          return (
            <div key={groupKey} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Icon size={14} color={groupColor} />
                <span style={{ fontSize: 13, fontWeight: 600, color: groupColor }}>{isSystemGroup ? cfg?.label || groupKey : groupKey}</span>
                <span style={{ fontSize: 11, color: '#555' }}>{acts.length} tarea{acts.length > 1 ? 's' : ''} · {avgPct}%</span>
              </div>
              {acts.map(a => {
                const actSt = ACT_STATUS_CONFIG[a.status]
                const inst = instaladores.find(i => i.id === a.instalador_id)
                const aSistCfg = SISTEMAS_CONFIG[a.sistema]
                return (
                  <div key={a.id} style={{ ...cardStyle, padding: 12, marginBottom: 6, borderLeft: `3px solid ${actSt.color}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: '#ccc', marginBottom: 2 }}>{a.descripcion}</div>
                        <div style={{ fontSize: 10, color: '#555', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          {!isSystemGroup && aSistCfg && <span style={{ color: aSistCfg.color }}>{aSistCfg.label}</span>}
                          {isSystemGroup && a.area && <span style={{ color: '#888' }}>📍 {a.area}</span>}
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

Responde SOLO con un JSON, sin markdown, sin explicación:
{"plan": [{"instalador": "nombre", "dia": "Lun|Mar|Mié|Jue|Vie|Sáb", "obra": "nombre obra", "tarea": "qué hacer"}]}`,
          messages: [{ role: 'user', content: `Semana: ${weekLabel}\n\nOBRAS ACTIVAS:\n${context}\n\nINSTALADORES:\n${instContext}\n\nGenera la planeación semanal óptima.` }],
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')

        // Parse JSON plan — use brace counting to extract full JSON object
        const cleanText = text.replace(/```json|```/g, '').trim()
        let jsonStr = ''
        const planIdx = cleanText.indexOf('"plan"')
        if (planIdx !== -1) {
          let braceStart = cleanText.lastIndexOf('{', planIdx)
          if (braceStart !== -1) {
            let depth = 0
            for (let ci = braceStart; ci < cleanText.length; ci++) {
              if (cleanText[ci] === '{') depth++
              else if (cleanText[ci] === '}') { depth--; if (depth === 0) { jsonStr = cleanText.substring(braceStart, ci + 1); break } }
            }
          }
        }
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr)
            if (parsed.plan && Array.isArray(parsed.plan)) {
              const newAssignments = new Map<string, Map<number, { obra: string; tarea: string; obraColor: string }[]>>()
              const dayMap: Record<string, number> = { 'Lun': 0, 'Mar': 1, 'Mié': 2, 'Mir': 2, 'Mie': 2, 'Jue': 3, 'Vie': 4, 'Sáb': 5, 'Sab': 5 }

              parsed.plan.forEach((item: any) => {
                // Match installer by first name
                const firstName = (item.instalador || '').toLowerCase().split(' ')[0]
                const inst = instaladores.find(i => i.nombre.toLowerCase().split(' ')[0] === firstName) ||
                             instaladores.find(i => i.nombre.toLowerCase().includes(firstName))
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
          } catch (_e) { console.error('JSON parse error in plan:', _e) }
        }
      }
    } catch (err) {
      console.error('AI planning error:', err)
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

function NuevaObraModal({ coordinadores, onClose, onSubmit, onCreated }: {
  coordinadores: Array<{ id: string; name: string }>
  onClose: () => void
  onSubmit: (form: {
    nombre: string; cliente: string; direccion: string; coordinador_id: string;
    cotizacion_id: string; valor_contrato: number; sistemas: Sistema[]; fecha_fin_plan: string;
  }) => Promise<{ ok: true; obra: ObraData } | { ok: false; error: string }>
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    nombre: '', cliente: '', direccion: '', coordinador_id: '',
    cotizacion_id: '', valor_contrato: '', sistemas: [] as Sistema[],
    fecha_fin_plan: '',
  })
  const [cotizaciones, setCotizaciones] = useState<Array<{ id: string; name: string; total: number; project_name?: string; client_name?: string }>>([])
  const [loadingCots, setLoadingCots] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Default coordinador: el primero "coordinador" si existe
  React.useEffect(() => {
    if (!form.coordinador_id && coordinadores.length > 0) {
      setForm(f => ({ ...f, coordinador_id: coordinadores[0].id }))
    }
  }, [coordinadores])

  // Load cotizaciones on mount
  React.useEffect(() => {
    setLoadingCots(true)
    supabase.from('quotations').select('id, name, total, project_id, client_name, projects(name)')
      .eq('specialty', 'esp').order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) {
          setCotizaciones(data.map((q: any) => ({
            id: q.id, name: q.name, total: q.total || 0,
            project_name: q.projects?.name || '', client_name: q.client_name || '',
          })))
        }
        setLoadingCots(false)
      })
  }, [])

  const handleCotSelect = (cotId: string) => {
    const cot = cotizaciones.find(c => c.id === cotId)
    if (cot) {
      setForm(f => ({
        ...f, cotizacion_id: cotId,
        valor_contrato: String(cot.total || f.valor_contrato),
        cliente: f.cliente || cot.client_name || '',
        nombre: f.nombre || cot.project_name || cot.name || '',
      }))
    } else {
      setForm(f => ({ ...f, cotizacion_id: '' }))
    }
  }

  const toggleSistema = (s: Sistema) => {
    setForm(f => ({ ...f, sistemas: f.sistemas.includes(s) ? f.sistemas.filter(x => x !== s) : [...f.sistemas, s] }))
  }

  async function crear() {
    if (!form.nombre.trim()) {
      setSaveError('El nombre es obligatorio')
      return
    }
    setSaveError(null)
    setSaving(true)
    const result = await onSubmit({
      nombre: form.nombre.trim(),
      cliente: form.cliente.trim(),
      direccion: form.direccion.trim(),
      coordinador_id: form.coordinador_id,
      cotizacion_id: form.cotizacion_id,
      valor_contrato: parseFloat(form.valor_contrato) || 0,
      sistemas: form.sistemas,
      fecha_fin_plan: form.fecha_fin_plan,
    })
    setSaving(false)
    if (result.ok) {
      onCreated()
    } else {
      setSaveError('Error al crear obra: ' + result.error)
    }
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
              <select value={form.coordinador_id} onChange={e => setForm(f => ({ ...f, coordinador_id: e.target.value }))} style={inputStyle}>
                <option value="">— Sin asignar —</option>
                {coordinadores.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div style={labelStyle}>Dirección</div>
            <input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <div style={labelStyle}>Cotización ESP {loadingCots && '(cargando...)'}</div>
              <select value={form.cotizacion_id} onChange={e => handleCotSelect(e.target.value)} style={inputStyle}>
                <option value="">Sin cotización</option>
                {cotizaciones.map(c => <option key={c.id} value={c.id}>{c.name} — {F(c.total)}</option>)}
              </select>
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
        {saveError && (
          <div style={{ marginTop: 16, padding: '10px 12px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 8, color: '#f87171', fontSize: 12, display: 'flex', gap: 8 }}>
            <span>⚠</span><span>{saveError}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Btn size="sm" variant="default" onClick={onClose}>Cancelar</Btn>
          <Btn size="sm" variant="primary" onClick={crear} disabled={saving}>{saving ? 'Guardando...' : 'Crear obra'}</Btn>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   MODAL: NUEVO INSTALADOR
   ═══════════════════════════════════════════════════════════════════ */

function NuevoInstaladorModal({ onClose, onSubmit, onCreated }: {
  onClose: () => void
  onSubmit: (form: {
    nombre: string; telefono: string; nivel: 'senior' | 'medio' | 'junior';
    habilidades: Sistema[]; notas: string;
  }) => Promise<{ ok: true; instalador: Instalador } | { ok: false; error: string }>
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    nombre: '', telefono: '', nivel: 'medio' as 'senior' | 'medio' | 'junior',
    habilidades: [] as Sistema[], notas: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const toggleHab = (s: Sistema) => {
    setForm(f => ({ ...f, habilidades: f.habilidades.includes(s) ? f.habilidades.filter(x => x !== s) : [...f.habilidades, s] }))
  }

  async function crear() {
    if (!form.nombre.trim()) {
      setSaveError('El nombre es obligatorio')
      return
    }
    setSaveError(null)
    setSaving(true)
    const result = await onSubmit({
      nombre: form.nombre.trim(),
      telefono: form.telefono.trim(),
      nivel: form.nivel,
      habilidades: form.habilidades,
      notas: form.notas.trim(),
    })
    setSaving(false)
    if (result.ok) {
      onCreated()
    } else {
      setSaveError('Error al crear instalador: ' + result.error)
    }
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
        {saveError && (
          <div style={{ marginTop: 16, padding: '10px 12px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 8, color: '#f87171', fontSize: 12, display: 'flex', gap: 8 }}>
            <span>⚠</span><span>{saveError}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Btn size="sm" variant="default" onClick={onClose}>Cancelar</Btn>
          <Btn size="sm" variant="primary" onClick={crear} disabled={saving}>{saving ? 'Guardando...' : 'Crear instalador'}</Btn>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   SUB: MATERIALES — Resumen de materiales de la obra agrupado por área
   ═══════════════════════════════════════════════════════════════════ */

interface MatArea { id: string; name: string; order_index: number }
interface MatItem {
  id: string
  area_id: string
  name: string
  description: string | null
  system: string | null
  provider: string | null
  purchase_phase: string | null
  quantity: number
  price: number
  total: number
  type: string
}

function SubMateriales({ obra }: { obra: ObraData }) {
  const [loading, setLoading] = useState(true)
  const [areas, setAreas] = useState<MatArea[]>([])
  const [items, setItems] = useState<MatItem[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [filterSystem, setFilterSystem] = useState<string>('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!obra.cotizacion_id) {
      setError('Esta obra no tiene cotización vinculada')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    Promise.all([
      supabase.from('quotation_areas').select('id, name, order_index').eq('quotation_id', obra.cotizacion_id).order('order_index'),
      supabase.from('quotation_items').select('id, area_id, name, description, system, provider, purchase_phase, quantity, price, total, type').eq('quotation_id', obra.cotizacion_id).order('order_index'),
    ]).then(([areasRes, itemsRes]) => {
      if (areasRes.error) setError('Error cargando áreas: ' + areasRes.error.message)
      if (itemsRes.error) setError('Error cargando materiales: ' + itemsRes.error.message)
      setAreas((areasRes.data || []) as MatArea[])
      // Solo materiales (no mano de obra)
      const materialItems = ((itemsRes.data || []) as MatItem[]).filter(it => it.type !== 'labor')
      setItems(materialItems)
      setLoading(false)
    })
  }, [obra.cotizacion_id])

  if (loading) return <Loading />

  if (error) {
    return (
      <div style={{ padding: 20, background: '#2a1414', border: '1px solid #3a2020', borderRadius: 10, color: '#f87171', fontSize: 13 }}>
        <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        {error}
      </div>
    )
  }

  if (items.length === 0) {
    return <EmptyState message="Esta cotización no tiene materiales registrados" />
  }

  // Filtrar
  const filteredItems = items.filter(it => {
    if (filterSystem && it.system !== filterSystem) return false
    if (search) {
      const q = search.toLowerCase()
      if (!it.name.toLowerCase().includes(q) &&
          !(it.description || '').toLowerCase().includes(q) &&
          !(it.provider || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  // Sistemas únicos para el filtro
  const uniqueSystems: string[] = Array.from(new Set(items.map(it => it.system || '').filter(Boolean))).sort()

  // KPIs
  const totalItems = filteredItems.length
  const totalPiezas = filteredItems.reduce((s, it) => s + (it.quantity || 0), 0)
  const totalValor = filteredItems.reduce((s, it) => s + (Number(it.total) || (Number(it.price) || 0) * (Number(it.quantity) || 0)), 0)
  const totalAreas = new Set(filteredItems.map(it => it.area_id)).size

  // Agrupar por área
  const areasWithItems = areas
    .map(a => ({ area: a, items: filteredItems.filter(it => it.area_id === a.id) }))
    .filter(g => g.items.length > 0)

  // Items sin área (huérfanos)
  const orphanItems = filteredItems.filter(it => !areas.some(a => a.id === it.area_id))
  if (orphanItems.length > 0) {
    areasWithItems.push({
      area: { id: '__orphan__', name: 'Sin área asignada', order_index: 9999 },
      items: orphanItems,
    })
  }

  function toggleArea(id: string) {
    setCollapsed(p => ({ ...p, [id]: !p[id] }))
  }

  function expandAll() { setCollapsed({}) }
  function collapseAll() {
    const all: Record<string, boolean> = {}
    areasWithItems.forEach(g => { all[g.area.id] = true })
    setCollapsed(all)
  }

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px', background: '#0e0e0e', border: '1px solid #2a2a2a',
    borderRadius: 6, color: '#ccc', fontSize: 12, fontFamily: 'inherit', outline: 'none',
  }

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <KpiCard label="Áreas" value={String(totalAreas)} icon={<MapPin size={16} />} />
        <KpiCard label="Items distintos" value={String(totalItems)} color="#3B82F6" icon={<Package size={16} />} />
        <KpiCard label="Piezas totales" value={String(totalPiezas)} color="#C084FC" icon={<ClipboardList size={16} />} />
        <KpiCard label="Valor materiales" value={F(totalValor)} color="#57FF9A" icon={<TrendingUp size={16} />} />
      </div>

      {/* Controles */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, descripción, proveedor..."
          style={{ ...inputStyle, width: 280 }}
        />
        <select
          value={filterSystem}
          onChange={e => setFilterSystem(e.target.value)}
          style={{ ...inputStyle, width: 180 }}
        >
          <option value="">Todos los sistemas</option>
          {uniqueSystems.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Btn size="sm" variant="default" onClick={expandAll}>Expandir todo</Btn>
          <Btn size="sm" variant="default" onClick={collapseAll}>Colapsar todo</Btn>
        </div>
      </div>

      {/* Áreas */}
      {areasWithItems.length === 0 && (
        <EmptyState message="Sin resultados con los filtros aplicados" />
      )}

      {areasWithItems.map(({ area, items: areaItems }) => {
        const areaTotal = areaItems.reduce((s, it) => s + (Number(it.total) || (Number(it.price) || 0) * (Number(it.quantity) || 0)), 0)
        const areaPiezas = areaItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
        const isCollapsed = collapsed[area.id] || false

        // Agrupar items por sistema dentro del área
        const bySystem: Record<string, MatItem[]> = {}
        areaItems.forEach(it => {
          const sys = it.system || 'Sin sistema'
          if (!bySystem[sys]) bySystem[sys] = []
          bySystem[sys].push(it)
        })
        const systemOrder = Object.keys(bySystem).sort()

        return (
          <div key={area.id} style={{ marginBottom: 12, background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 10, overflow: 'hidden' }}>
            {/* Header del área */}
            <div
              onClick={() => toggleArea(area.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                cursor: 'pointer', background: '#141414', borderLeft: '3px solid #57FF9A',
              }}
            >
              {isCollapsed ? <ChevronRight size={14} color="#57FF9A" /> : <ChevronDown size={14} color="#57FF9A" />}
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', flex: 1, textTransform: 'uppercase' as const }}>
                {area.name}
              </span>
              <span style={{ fontSize: 10, color: '#666' }}>{areaItems.length} items · {areaPiezas} pz</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#57FF9A' }}>{F(areaTotal)}</span>
            </div>

            {/* Items agrupados por sistema */}
            {!isCollapsed && (
              <div style={{ padding: '8px 14px 14px' }}>
                {systemOrder.map(sysName => {
                  const sysItems = bySystem[sysName]
                  const sysColor = SISTEMAS_CONFIG[sysName as Sistema]?.color || '#888'
                  return (
                    <div key={sysName} style={{ marginTop: 10 }}>
                      <div style={{
                        fontSize: 10, fontWeight: 700, color: sysColor, textTransform: 'uppercase' as const,
                        letterSpacing: '0.06em', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid #1a1a1a',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: sysColor }} />
                        {sysName}
                        <span style={{ color: '#555', marginLeft: 'auto', fontWeight: 400 }}>
                          {sysItems.length} items
                        </span>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'center', fontSize: 9, color: '#444', fontWeight: 600, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', width: 50 }}>Cant</th>
                            <th style={{ textAlign: 'left', fontSize: 9, color: '#444', fontWeight: 600, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Producto</th>
                            <th style={{ textAlign: 'left', fontSize: 9, color: '#444', fontWeight: 600, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', width: 150 }}>Proveedor</th>
                            <th style={{ textAlign: 'left', fontSize: 9, color: '#444', fontWeight: 600, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', width: 100 }}>Fase</th>
                            <th style={{ textAlign: 'right', fontSize: 9, color: '#444', fontWeight: 600, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', width: 100 }}>P. Unit</th>
                            <th style={{ textAlign: 'right', fontSize: 9, color: '#444', fontWeight: 600, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', width: 110 }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sysItems.map(it => (
                            <tr key={it.id} style={{ borderTop: '1px solid #141414' }}>
                              <td style={{ textAlign: 'center', fontSize: 12, color: '#fff', fontWeight: 600, padding: '6px' }}>{it.quantity}</td>
                              <td style={{ fontSize: 12, color: '#ddd', padding: '6px' }}>
                                <div style={{ fontWeight: 500 }}>{it.name}</div>
                                {it.description && <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>{it.description}</div>}
                              </td>
                              <td style={{ fontSize: 11, color: '#888', padding: '6px' }}>{it.provider || '—'}</td>
                              <td style={{ fontSize: 11, color: '#888', padding: '6px' }}>{it.purchase_phase || '—'}</td>
                              <td style={{ textAlign: 'right', fontSize: 11, color: '#888', padding: '6px', fontVariantNumeric: 'tabular-nums' as const }}>
                                {F(Number(it.price) || 0)}
                              </td>
                              <td style={{ textAlign: 'right', fontSize: 12, color: '#57FF9A', fontWeight: 600, padding: '6px', fontVariantNumeric: 'tabular-nums' as const }}>
                                {F(Number(it.total) || (Number(it.price) || 0) * (Number(it.quantity) || 0))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
