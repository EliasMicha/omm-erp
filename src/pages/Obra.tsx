import React, { useState, useRef, useEffect } from 'react'
import { SectionHeader, KpiCard, Table, Th, Td, Badge, Btn, EmptyState, ProgressBar, Loading } from '../components/layout/UI'
import { F, formatDate } from '../lib/utils'
import { ANTHROPIC_API_KEY } from '../lib/config'
import { supabase } from '../lib/supabase'
import {
  HardHat, Users, ClipboardList, Calendar, AlertTriangle, CheckCircle, CheckCircle2,
  Clock, ChevronRight, ArrowLeft, Plus, Upload, Camera, X, Eye,
  Wrench, Wifi, Volume2, Shield, Sun, MapPin, FileText, TrendingUp,
  Loader2, MessageSquare, Lock, ChevronDown, Package, Truck, ShoppingCart,
  Flame, Server, Phone, Radio, Blinds
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */

type ObraStatus = 'entrega_pendiente' | 'en_ejecucion' | 'pausada' | 'completada'
type ActividadStatus = 'pendiente' | 'en_progreso' | 'bloqueada' | 'completada'
type Sistema = 'CCTV' | 'Audio' | 'Redes' | 'Control' | 'Acceso' | 'Electrico' | 'Humo' | 'BMS' | 'Telefonia' | 'Celular' | 'Persianas'
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
  project_id?: string
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
  CCTV:       { label: 'CCTV',             color: '#EF4444', icon: Shield },
  Audio:      { label: 'Audio',            color: '#C084FC', icon: Volume2 },
  Redes:      { label: 'Redes',            color: '#3B82F6', icon: Wifi },
  Control:    { label: 'Control (Lutron)', color: '#F59E0B', icon: Sun },
  Acceso:     { label: 'Control Acceso',   color: '#06B6D4', icon: Lock },
  Electrico:  { label: 'Eléctrico',        color: '#FF6B35', icon: Wrench },
  Humo:       { label: 'Detección Humo',   color: '#DC2626', icon: Flame },
  BMS:        { label: 'BMS',              color: '#14B8A6', icon: Server },
  Telefonia:  { label: 'Telefonía',        color: '#8B5CF6', icon: Phone },
  Celular:    { label: 'Red Celular',      color: '#EC4899', icon: Radio },
  Persianas:  { label: 'Cortinas/Persianas', color: '#A855F7', icon: Blinds },
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
    project_id: o.project_id || undefined,
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
          supabase.from('employees').select('id,name,phone,role,level,skills,disponible,foto_url,calificacion,notes,is_active,tipo_trabajo,area').eq('is_active', true).order('name'),
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
        // Instaladores = empleados de campo (OBRA o MIXTO) — excluye oficina
        const insts = empleados.filter((e: any) =>
          e.tipo_trabajo === 'OBRA' || e.tipo_trabajo === 'MIXTO'
        ).map(rowToInstalador)
        // Coordinadores = todos los empleados activos (cualquiera puede coordinar)
        const coords = empleados.map((e: any) => ({ id: e.id, name: e.name || '' }))
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
    cotizacion_ids: string[]; valor_contrato: number; sistemas: Sistema[]; fecha_fin_plan: string;
  }): Promise<{ ok: true; obra: ObraData } | { ok: false; error: string }> {
    try {
      // Resolver project_id desde la primera cotización si hay
      let project_id: string | null = null
      const firstCotId = form.cotizacion_ids[0] || null
      if (firstCotId) {
        const { data: cot } = await supabase.from('quotations').select('project_id').eq('id', firstCotId).single()
        if (cot) project_id = cot.project_id || null
      }
      const payload: any = {
        nombre: form.nombre,
        cliente: form.cliente || null,
        direccion: form.direccion || null,
        status: 'entrega_pendiente',
        quotation_id: firstCotId,
        quotation_ids: form.cotizacion_ids,
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
  const [subTab, setSubTab] = useState<'actividades' | 'reportes' | 'entrega' | 'equipo' | 'documentacion' | 'extras' | 'bloqueos' | 'materiales'>('actividades')
  const [showNewAct, setShowNewAct] = useState(false)
  const [showNewReporte, setShowNewReporte] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  // Hidratación inicial: cargar subtablas reales desde Supabase (Commit 2)
  useEffect(() => {
    let cancelled = false
    async function hydrate() {
      try {
        const [actsRes, repsRes, docsRes] = await Promise.all([
          supabase.from('obra_actividades').select('*').eq('obra_id', obra.id).order('order_index'),
          supabase.from('obra_reportes').select('*').eq('obra_id', obra.id).order('fecha', { ascending: false }),
          supabase.from('obra_entrega_docs').select('*').eq('obra_id', obra.id).order('order_index'),
        ])
        if (cancelled) return
        // Mapear actividades al tipo Actividad
        const acts: Actividad[] = (actsRes.data || []).map((a: any) => ({
          id: a.id, obra_id: a.obra_id, sistema: a.sistema as Sistema, area: a.area || undefined,
          descripcion: a.descripcion, status: a.status as ActividadStatus,
          instalador_id: a.instalador_id || undefined,
          fecha_inicio: a.fecha_inicio || undefined,
          fecha_fin_plan: a.fecha_fin_plan || undefined,
          fecha_fin_real: a.fecha_fin_real || undefined,
          bloqueo: undefined, // bloqueos ahora viven en obra_bloqueos
          notas: a.notas || undefined,
          porcentaje: a.porcentaje || 0,
        }))
        const reps: ReporteObra[] = (repsRes.data || []).map((r: any) => ({
          id: r.id, obra_id: r.obra_id, instalador_id: r.instalador_id || '',
          fecha: r.fecha, texto_raw: r.texto_raw || '',
          fotos: r.fotos || [],
          ai_resumen: r.ai_resumen || undefined,
          ai_avances: r.ai_avances || undefined,
          ai_faltantes: r.ai_faltantes || undefined,
          ai_bloqueos: r.ai_bloqueos || undefined,
          procesado: r.procesado || false,
        }))
        // Si hay docs en DB, úsalos; si no, arranca con la lista default (DOCS_ENTREGA)
        let docs: EntregaDocumento[]
        if (docsRes.data && docsRes.data.length > 0) {
          docs = docsRes.data.map((d: any) => ({ nombre: d.nombre, recibido: d.recibido || false }))
        } else {
          docs = DOCS_ENTREGA.map(d => ({ nombre: d, recibido: false }))
        }
        // También cargar instaladores asignados de la tabla pivote
        const { data: instRes } = await supabase.from('obra_instaladores').select('employee_id').eq('obra_id', obra.id)
        const instaladoresIds = (instRes || []).map((i: any) => i.employee_id)
        if (!cancelled) {
          updateObra(o => ({
            ...o,
            actividades: acts,
            reportes: reps,
            entrega_docs: docs,
            instaladores_ids: instaladoresIds,
          }))
          setHydrated(true)
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('Error hidratando obra:', err)
          setSyncError('Error al cargar datos de la obra: ' + (err?.message || String(err)))
          setHydrated(true)
        }
      }
    }
    hydrate()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obra.id])

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
            <Btn size="sm" variant="primary" onClick={async () => {
              updateObra(o => ({ ...o, status: 'en_ejecucion' }))
              const { error } = await supabase.from('obras').update({ status: 'en_ejecucion' }).eq('id', obra.id)
              if (error) setSyncError('Error al cambiar estado: ' + error.message)
            }}>
              <CheckCircle size={11} /> Marcar entrega completa
            </Btn>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#666' }}>
          {obra.cliente} · <MapPin size={11} style={{ verticalAlign: 'middle' }} /> {obra.direccion} · Coord: {obra.coordinador}
          {obra.cotizacion_ref && <> · Cot: {obra.cotizacion_ref}</>}
        </div>
      </div>

      {syncError && (
        <div style={{ marginBottom: 16, padding: '10px 12px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 8, color: '#f87171', fontSize: 12, display: 'flex', gap: 8 }}>
          <span>⚠</span><span>{syncError}</span>
        </div>
      )}
      {!hydrated && <div style={{ marginBottom: 16 }}><Loading /></div>}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Avance global" value={`${obra.avance_global}%`} icon={<TrendingUp size={16} />} />
        <KpiCard label="Actividades" value={`${completadas}/${obra.actividades.length}`} color="#3B82F6" icon={<ClipboardList size={16} />} />
        <KpiCard label="Bloqueadas" value={bloqueadas} color={bloqueadas > 0 ? '#EF4444' : '#57FF9A'} icon={<AlertTriangle size={16} />} />
        <KpiCard label="Documentos" value={`${docsRecibidos}/${obra.entrega_docs.length}`} color="#F59E0B" icon={<FileText size={16} />} />
        <KpiCard label="Contrato" value={F(obra.valor_contrato)} color="#C084FC" icon={<HardHat size={16} />} />
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #222', marginBottom: 20, flexWrap: 'wrap' }}>
        {([
          { key: 'actividades' as const, label: 'Actividades', icon: ClipboardList },
          { key: 'reportes' as const, label: `Reportes (${obra.reportes.length})`, icon: MessageSquare },
          { key: 'bloqueos' as const, label: 'Bloqueos', icon: AlertTriangle },
          { key: 'extras' as const, label: 'Extras / Adendum', icon: Plus },
          { key: 'documentacion' as const, label: 'Documentación', icon: FileText },
          { key: 'entrega' as const, label: 'Entrega formal', icon: CheckCircle },
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
      {subTab === 'bloqueos' && <SubBloqueos obra={obra} instaladores={instaladores} />}
      {subTab === 'extras' && <SubExtras obra={obra} />}
      {subTab === 'documentacion' && <SubDocumentacion obra={obra} />}
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
  const [showWizard, setShowWizard] = useState(false)

  const addActividad = async () => {
    if (!newAct.descripcion.trim()) return
    const payload: any = {
      obra_id: obra.id,
      sistema: newAct.sistema,
      descripcion: newAct.descripcion.trim(),
      status: 'pendiente',
      instalador_id: newAct.instalador_id || null,
      fecha_fin_plan: newAct.fecha_fin_plan || null,
      area: newAct.area || null,
      porcentaje: 0,
      origen: 'manual',
      order_index: obra.actividades.length,
    }
    const { data, error } = await supabase.from('obra_actividades').insert(payload).select().single()
    if (error) {
      console.error('Error creando actividad:', error)
      alert('Error al crear actividad: ' + error.message)
      return
    }
    if (data) {
      const act: Actividad = {
        id: data.id, obra_id: data.obra_id, sistema: data.sistema as Sistema,
        descripcion: data.descripcion, status: data.status as ActividadStatus,
        instalador_id: data.instalador_id || undefined,
        fecha_fin_plan: data.fecha_fin_plan || undefined,
        area: data.area || undefined,
        porcentaje: data.porcentaje || 0,
      }
      updateObra(o => ({ ...o, actividades: [...o.actividades, act] }))
    }
    setNewAct({ sistema: 'CCTV', descripcion: '', instalador_id: '', fecha_fin_plan: '', area: '' })
    setShowNew(false)
  }

  const updateActividad = async (actId: string, updates: Partial<Actividad>) => {
    // Map to DB columns
    const dbUpdates: any = {}
    if (updates.status !== undefined) dbUpdates.status = updates.status
    if (updates.porcentaje !== undefined) dbUpdates.porcentaje = updates.porcentaje
    if (updates.instalador_id !== undefined) dbUpdates.instalador_id = updates.instalador_id || null
    if (updates.fecha_fin_plan !== undefined) dbUpdates.fecha_fin_plan = updates.fecha_fin_plan || null
    if (updates.fecha_fin_real !== undefined) dbUpdates.fecha_fin_real = updates.fecha_fin_real || null
    if (updates.descripcion !== undefined) dbUpdates.descripcion = updates.descripcion
    if (updates.notas !== undefined) dbUpdates.notas = updates.notas
    // Optimistic update
    updateObra(o => {
      const nuevasActs = o.actividades.map(a => a.id === actId ? { ...a, ...updates } : a)
      const avance = Math.round(nuevasActs.reduce((s, a) => s + a.porcentaje, 0) / (nuevasActs.length || 1))
      return { ...o, actividades: nuevasActs, avance_global: avance }
    })
    const { error } = await supabase.from('obra_actividades').update(dbUpdates).eq('id', actId)
    if (error) {
      console.error('Error actualizando actividad:', error)
      alert('Error al actualizar: ' + error.message)
    }
    // Persist avance_global recalculated
    const nuevasActs = obra.actividades.map(a => a.id === actId ? { ...a, ...updates } : a)
    const avance = Math.round(nuevasActs.reduce((s, a) => s + a.porcentaje, 0) / (nuevasActs.length || 1))
    await supabase.from('obras').update({ avance_global: avance }).eq('id', obra.id)
  }

  /* --- AI Autogenerate: open wizard --- */
  const handleAutogenerar = () => {
    if (!obra.cotizacion_id) {
      setGenStatus('No hay cotización vinculada a esta obra')
      return
    }
    setShowWizard(true)
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
            <Btn size="sm" variant="default" onClick={handleAutogenerar} disabled={generating}>
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
              <Btn size="sm" variant="primary" onClick={handleAutogenerar} disabled={generating}>
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

      {/* Wizard AI modal */}
      {showWizard && (
        <AutogenWizard
          obra={obra}
          instaladores={instaladores}
          onClose={() => setShowWizard(false)}
          onTasksCreated={(newActs) => {
            updateObra(o => ({ ...o, actividades: [...o.actividades, ...newActs] }))
            setGenStatus(`✓ ${newActs.length} tareas generadas`)
            setShowWizard(false)
          }}
        />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   WIZARD: AUTOGENERAR TAREAS CON AI (conversacional)
   ═══════════════════════════════════════════════════════════════════ */

interface WizardMsg { role: 'ai' | 'user'; text: string }

function AutogenWizard({ obra, instaladores, onClose, onTasksCreated }: {
  obra: ObraData
  instaladores: Instalador[]
  onClose: () => void
  onTasksCreated: (acts: Actividad[]) => void
}) {
  const [messages, setMessages] = useState<WizardMsg[]>([])
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<'loading' | 'dates' | 'team' | 'confirm' | 'generating' | 'done'>('loading')
  const [cotContext, setCotContext] = useState('')
  const [phaseDates, setPhaseDates] = useState({ roughin: '', acabados: '', cierre: '' })
  const [selectedInstaladores, setSelectedInstaladores] = useState<string[]>([])
  const [pendingTasks, setPendingTasks] = useState<any[]>([])
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Step 1: Load cotización on mount
  useEffect(() => {
    async function loadCot() {
      if (!obra.cotizacion_id) return
      const [areasRes, itemsRes] = await Promise.all([
        supabase.from('quotation_areas').select('*').eq('quotation_id', obra.cotizacion_id).order('order_index'),
        supabase.from('quotation_items').select('*').eq('quotation_id', obra.cotizacion_id).order('order_index'),
      ])
      const areas = areasRes.data || []
      const items = itemsRes.data || []
      if (items.length === 0) {
        addAI('La cotización no tiene productos. No puedo generar tareas.')
        return
      }
      const ctx = areas.map(area => {
        const areaItems = items.filter((it: any) => it.area_id === area.id)
        return `ÁREA: ${area.name}\n${areaItems.map((it: any) => `  - ${it.quantity}x ${it.name} [${it.system || 'General'}]`).join('\n')}`
      }).join('\n\n')
      setCotContext(ctx)

      // Detect systems in this quote
      const systems = new Set(items.map((it: any) => it.system || '').filter(Boolean))
      const systemsList = Array.from(systems).join(', ')

      addAI(`Leí la cotización: ${items.length} productos en ${areas.length} áreas.\nSistemas detectados: ${systemsList || 'General'}.\n\nPara asignar fechas a cada tarea, necesito saber las fechas aproximadas de las fases de obra:\n\n• **Roughin** (primera fijación, canalización, cableado)\n• **Acabados** (colocación de equipos, montaje)\n• **Cierre** (programación, pruebas, puesta en marcha)\n\nPuedes escribirlas abajo o seleccionar directamente:`)
      setPhase('dates')
    }
    loadCot()
  }, [])

  function addAI(text: string) {
    setMessages(prev => [...prev, { role: 'ai', text }])
  }
  function addUser(text: string) {
    setMessages(prev => [...prev, { role: 'user', text }])
  }

  const handleDatesNext = () => {
    if (!phaseDates.roughin && !phaseDates.acabados && !phaseDates.cierre) {
      addUser('Sin fechas por ahora, generar sin fechas')
    } else {
      const parts: string[] = []
      if (phaseDates.roughin) parts.push(`Roughin: ${phaseDates.roughin}`)
      if (phaseDates.acabados) parts.push(`Acabados: ${phaseDates.acabados}`)
      if (phaseDates.cierre) parts.push(`Cierre: ${phaseDates.cierre}`)
      addUser(parts.join(' · '))
    }

    // Move to team selection
    const availableInst = instaladores.filter(i =>
      i.disponible && obra.sistemas.some(s => i.habilidades.includes(s))
    )
    if (availableInst.length > 0) {
      addAI(`¿Quiénes estarán asignados a esta obra?\n\nTe muestro los instaladores disponibles con habilidades relevantes. Selecciona los que participarán:`)
      setPhase('team')
    } else {
      addAI(`No encontré instaladores disponibles con habilidades en los sistemas de esta obra. Puedes asignarlos después.\n\n¿Genero las tareas?`)
      setPhase('confirm')
    }
  }

  const handleTeamNext = () => {
    const names = selectedInstaladores.map(id => instaladores.find(i => i.id === id)?.nombre || '').filter(Boolean)
    if (names.length > 0) {
      addUser(`Equipo: ${names.join(', ')}`)
    } else {
      addUser('Sin equipo asignado por ahora')
    }
    addAI(`Listo. Voy a generar las tareas de instalación con:\n• Fechas por fase: ${phaseDates.roughin || phaseDates.acabados || phaseDates.cierre ? 'Sí' : 'Sin fechas'}\n• Equipo: ${names.length > 0 ? names.join(', ') : 'Sin asignar'}\n\n¿Confirmas para generar?`)
    setPhase('confirm')
  }

  const handleGenerate = async () => {
    addUser('Generar tareas')
    setPhase('generating')
    addAI('Generando tareas con AI... esto toma unos segundos.')

    try {
      const systemMap = `Mapeo de sistemas de cotización a sistemas de obra:
Audio, Sonos, bocina, speaker, amplificador = "Audio"
Redes, access point, switch, patch panel, Cat6, rack, UPS = "Redes"
CCTV, cámara, NVR, DVR, Hikvision = "CCTV"
Control de Iluminación, Lutron, dimmer, keypad, procesador, Caseta, Pico = "Control"
Control de Acceso, lector, HID, cerradura, chapa = "Acceso"
Eléctrico, canalización, registro, contacto, apagador, centro de carga = "Electrico"`

      // Build date context for AI
      let dateInstruction = ''
      if (phaseDates.roughin || phaseDates.acabados || phaseDates.cierre) {
        dateInstruction = `\n\nFECHAS DE FASE (asigna fecha_fin_plan a cada tarea según su fase):
${phaseDates.roughin ? `- Roughin (canalización, cableado, primera fijación): fecha límite ${phaseDates.roughin}` : ''}
${phaseDates.acabados ? `- Acabados (colocación de equipos, montaje final): fecha límite ${phaseDates.acabados}` : ''}
${phaseDates.cierre ? `- Cierre (programación, pruebas, puesta en marcha): fecha límite ${phaseDates.cierre}` : ''}
Decide a qué fase pertenece cada tarea y asigna la fecha correspondiente como "fecha_fin_plan" en formato YYYY-MM-DD.`
      }

      // Build team context
      let teamInstruction = ''
      if (selectedInstaladores.length > 0) {
        const teamInfo = selectedInstaladores.map(id => {
          const inst = instaladores.find(i => i.id === id)
          if (!inst) return null
          return { id: inst.id, nombre: inst.nombre, habilidades: inst.habilidades, nivel: inst.nivel }
        }).filter(Boolean)
        teamInstruction = `\n\nEQUIPO ASIGNADO (asigna instalador_id a cada tarea según habilidades):
${teamInfo.map((t: any) => `- ${t.nombre} (id: "${t.id}") — Habilidades: ${t.habilidades.join(', ')} — Nivel: ${t.nivel}`).join('\n')}
Asigna cada tarea al instalador más apropiado según el sistema de la tarea y las habilidades del instalador.`
      }

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
2. Si un producto tiene quantity > 1, menciona la cantidad: "Colocación de 4 access points - Recámara Principal"
3. Agrupa cables/canalizaciones del mismo tipo en la misma área en UNA sola tarea
4. Agrega tareas de infraestructura implícitas: canalización, cableado, montaje de rack, pruebas
5. Agrega tarea de programación/configuración por sistema al final (área "General")
6. Agrega tarea de pruebas y puesta en marcha por sistema (área "General")

${systemMap}
${dateInstruction}
${teamInstruction}

Devuelve SOLO un JSON array, sin markdown:
[{"descripcion":"texto","sistema":"Audio|Redes|CCTV|Control|Acceso|Electrico","area":"nombre del área","fase":"roughin|acabados|cierre"${phaseDates.roughin || phaseDates.acabados || phaseDates.cierre ? ',"fecha_fin_plan":"YYYY-MM-DD"' : ''}${selectedInstaladores.length > 0 ? ',"instalador_id":"uuid-del-instalador"' : ''}}]`,
          messages: [{ role: 'user', content: `Cotización de obra: ${obra.nombre}\n\n${cotContext}` }],
        }),
      })

      if (!response.ok) {
        addAI(`Error de API: ${response.status}. Intenta de nuevo.`)
        setPhase('confirm')
        return
      }

      const data = await response.json()
      const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      const jsonMatch = text.match(/\[[\s\S]*\]/)

      if (!jsonMatch) {
        addAI('No pude parsear la respuesta. Intenta de nuevo.')
        setPhase('confirm')
        return
      }

      const parsed = JSON.parse(jsonMatch[0].replace(/```json|```/g, '').trim())
      if (!Array.isArray(parsed) || parsed.length === 0) {
        addAI('No se generaron tareas.')
        setPhase('confirm')
        return
      }

      const validSistemas = ['CCTV', 'Audio', 'Redes', 'Control', 'Acceso', 'Electrico', 'Humo', 'BMS', 'Telefonia', 'Celular', 'Persianas']
      const validInstIds = new Set(instaladores.map(i => i.id))

      const payloads = parsed.map((t: any, i: number) => {
        let sistema = t.sistema || 'Redes'
        if (!validSistemas.includes(sistema)) {
          const lower = sistema.toLowerCase()
          if (lower.includes('audio')) sistema = 'Audio'
          else if (lower.includes('red') || lower.includes('network')) sistema = 'Redes'
          else if (lower.includes('cctv') || lower.includes('cam')) sistema = 'CCTV'
          else if (lower.includes('control') && lower.includes('acc')) sistema = 'Acceso'
          else if (lower.includes('control') || lower.includes('lutron')) sistema = 'Control'
          else if (lower.includes('elec')) sistema = 'Electrico'
          else sistema = 'Redes'
        }
        const instId = t.instalador_id && validInstIds.has(t.instalador_id) ? t.instalador_id : null
        return {
          obra_id: obra.id,
          sistema,
          area: t.area || null,
          descripcion: t.descripcion || '',
          status: 'pendiente',
          porcentaje: 0,
          origen: 'cotizacion',
          order_index: obra.actividades.length + i,
          fecha_fin_plan: t.fecha_fin_plan || null,
          instalador_id: instId,
        }
      })

      const { data: inserted, error: insertErr } = await supabase.from('obra_actividades').insert(payloads).select()
      if (insertErr) {
        addAI('Error al guardar: ' + insertErr.message)
        setPhase('confirm')
        return
      }

      const newActs: Actividad[] = (inserted || []).map((a: any) => ({
        id: a.id, obra_id: a.obra_id, sistema: a.sistema as Sistema,
        descripcion: a.descripcion, status: a.status as ActividadStatus,
        instalador_id: a.instalador_id || undefined,
        fecha_fin_plan: a.fecha_fin_plan || undefined,
        area: a.area || undefined,
        porcentaje: a.porcentaje || 0,
      }))

      // Count by phase
      const byFase = { roughin: 0, acabados: 0, cierre: 0 }
      parsed.forEach((t: any) => { if (t.fase && byFase[t.fase as keyof typeof byFase] !== undefined) byFase[t.fase as keyof typeof byFase]++ })
      const assigned = newActs.filter(a => a.instalador_id).length

      addAI(`✅ ${newActs.length} tareas creadas exitosamente.\n\n• Roughin: ${byFase.roughin} tareas\n• Acabados: ${byFase.acabados} tareas\n• Cierre: ${byFase.cierre} tareas\n• Con instalador asignado: ${assigned}/${newActs.length}\n\nCerrando en 2 segundos...`)
      setPhase('done')
      setTimeout(() => onTasksCreated(newActs), 2000)

    } catch (err) {
      addAI('Error: ' + (err as Error).message)
      setPhase('confirm')
    }
  }

  // Handle free-text input (for chat-like interaction)
  const handleSend = () => {
    if (!input.trim()) return
    addUser(input.trim())

    // Parse dates from free text
    if (phase === 'dates') {
      // Try to extract dates from user message
      const dateRegex = /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/g
      const found: string[] = []
      let match
      while ((match = dateRegex.exec(input)) !== null) {
        const y = match[3] ? (match[3].length === 2 ? '20' + match[3] : match[3]) : new Date().getFullYear().toString()
        found.push(`${y}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`)
      }
      if (found.length >= 3) {
        setPhaseDates({ roughin: found[0], acabados: found[1], cierre: found[2] })
        addAI(`Entendido:\n• Roughin: ${found[0]}\n• Acabados: ${found[1]}\n• Cierre: ${found[2]}\n\nPasemos al equipo.`)
        setTimeout(() => handleDatesNext(), 100)
      } else {
        addAI('Puedo entender fechas como "15/05, 30/06, 15/08" o usa los campos de fecha abajo.')
      }
    }
    setInput('')
  }

  const toggleInst = (id: string) => {
    setSelectedInstaladores(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // Available instaladores for this obra's systems
  const relevantInstaladores = instaladores.filter(i => i.disponible)

  const modalBg: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  const modalBox: React.CSSProperties = {
    background: '#111', border: '1px solid #222', borderRadius: 16, width: 580,
    maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>🤖 Asistente de Tareas</div>
            <div style={{ fontSize: 10, color: '#555' }}>{obra.nombre}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        {/* Chat messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '10px 14px',
              borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
              background: m.role === 'user' ? 'rgba(87,255,154,0.12)' : '#1a1a1a',
              border: m.role === 'user' ? '1px solid rgba(87,255,154,0.2)' : '1px solid #252525',
              fontSize: 12, color: m.role === 'user' ? '#57FF9A' : '#ccc',
              lineHeight: 1.5, whiteSpace: 'pre-wrap',
            }}>
              {m.text}
            </div>
          ))}

          {/* Phase-specific UI */}
          {phase === 'loading' && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} color="#57FF9A" />
              <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>Leyendo cotización...</div>
            </div>
          )}

          {phase === 'dates' && (
            <div style={{ background: '#0a0a0a', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Fechas por fase</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {[
                  { key: 'roughin' as const, label: 'Roughin', desc: 'Canalización, cableado, primera fijación' },
                  { key: 'acabados' as const, label: 'Acabados', desc: 'Colocación de equipos, montaje final' },
                  { key: 'cierre' as const, label: 'Cierre', desc: 'Programación, pruebas, puesta en marcha' },
                ].map(p => (
                  <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{p.label}</div>
                      <div style={{ fontSize: 10, color: '#555' }}>{p.desc}</div>
                    </div>
                    <input type="date" value={phaseDates[p.key]}
                      onChange={e => setPhaseDates(d => ({ ...d, [p.key]: e.target.value }))}
                      style={{ ...inputStyle, width: 150, fontSize: 11 }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <Btn size="sm" variant="default" onClick={() => { addUser('Sin fechas por ahora'); handleDatesNext() }}>Omitir</Btn>
                <Btn size="sm" variant="primary" onClick={handleDatesNext}>Continuar</Btn>
              </div>
            </div>
          )}

          {phase === 'team' && (
            <div style={{ background: '#0a0a0a', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Equipo de obra</div>
              <div style={{ maxHeight: 200, overflowY: 'auto', display: 'grid', gap: 4 }}>
                {relevantInstaladores.map(inst => {
                  const checked = selectedInstaladores.includes(inst.id)
                  const nivelCfg = NIVEL_CONFIG[inst.nivel]
                  return (
                    <label key={inst.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', cursor: 'pointer',
                      background: checked ? 'rgba(87,255,154,0.06)' : 'transparent',
                      borderRadius: 6, border: checked ? '1px solid rgba(87,255,154,0.15)' : '1px solid transparent',
                    }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleInst(inst.id)} style={{ accentColor: '#57FF9A' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: checked ? '#fff' : '#ccc' }}>{inst.nombre}</div>
                        <div style={{ fontSize: 10, color: '#555' }}>{inst.habilidades.join(', ')}</div>
                      </div>
                      <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: `${nivelCfg?.color || '#666'}20`, color: nivelCfg?.color || '#666' }}>
                        {nivelCfg?.label || inst.nivel}
                      </span>
                    </label>
                  )
                })}
                {relevantInstaladores.length === 0 && <div style={{ fontSize: 11, color: '#555', textAlign: 'center', padding: 10 }}>No hay instaladores disponibles</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <Btn size="sm" variant="default" onClick={() => { setSelectedInstaladores([]); handleTeamNext() }}>Omitir</Btn>
                <Btn size="sm" variant="primary" onClick={handleTeamNext}>Continuar ({selectedInstaladores.length})</Btn>
              </div>
            </div>
          )}

          {phase === 'confirm' && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: 8 }}>
              <Btn size="sm" variant="default" onClick={onClose}>Cancelar</Btn>
              <Btn size="sm" variant="primary" onClick={handleGenerate}>🤖 Generar tareas</Btn>
            </div>
          )}

          {phase === 'generating' && (
            <div style={{ textAlign: 'center', padding: 12 }}>
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} color="#57FF9A" />
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input bar (for free-text chat) */}
        {(phase === 'dates' || phase === 'team') && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid #222', display: 'flex', gap: 8 }}>
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
              placeholder="Escribe fechas o instrucciones adicionales..."
              style={{ flex: 1, padding: '8px 12px', background: '#0a0a0a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
            <Btn size="sm" variant="primary" onClick={handleSend}>Enviar</Btn>
          </div>
        )}
      </div>
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
    const newUrls: string[] = []
    for (let i = 0; i < Math.min(files.length, 5); i++) {
      const file = files[i]
      const ext = file.name.split('.').pop() || 'jpg'
      const fileName = `${obra.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error } = await supabase.storage.from('obra-evidencias').upload(fileName, file, { cacheControl: '31536000' })
      if (error) {
        console.error('Error subiendo foto:', error)
        alert('Error al subir foto: ' + error.message)
        continue
      }
      const { data: urlData } = supabase.storage.from('obra-evidencias').getPublicUrl(fileName)
      if (urlData?.publicUrl) newUrls.push(urlData.publicUrl)
    }
    setNewReporte(r => ({ ...r, fotos: [...r.fotos, ...newUrls].slice(0, 5) }))
    if (fileRef.current) fileRef.current.value = ''
  }

  const submitReporte = async () => {
    if (!newReporte.texto.trim() && newReporte.fotos.length === 0) return
    setProcessing(true)

    // 1. Insertar reporte inicial en Supabase (sin procesar)
    const payload: any = {
      obra_id: obra.id,
      instalador_id: newReporte.instalador_id || obra.instaladores_ids[0] || null,
      fecha: new Date().toISOString().substring(0, 10),
      texto_raw: newReporte.texto.trim(),
      fotos: newReporte.fotos,
      procesado: false,
    }
    const { data: inserted, error: insErr } = await supabase.from('obra_reportes').insert(payload).select().single()
    if (insErr) {
      console.error('Error creando reporte:', insErr)
      alert('Error al crear reporte: ' + insErr.message)
      setProcessing(false)
      return
    }
    const reporte: ReporteObra = {
      id: inserted.id, obra_id: inserted.obra_id,
      instalador_id: inserted.instalador_id || '',
      fecha: inserted.fecha,
      texto_raw: inserted.texto_raw || '',
      fotos: inserted.fotos || [],
      procesado: false,
    }

    // 2. Procesar con AI (llama al Edge Function /api/process-obra-report)
    try {
      const procResponse = await fetch('/api/process-obra-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reporte_id: inserted.id,
          obra_id: obra.id,
          obra_nombre: obra.nombre,
          obra_sistemas: obra.sistemas,
          texto: newReporte.texto,
          fotos: newReporte.fotos,
        }),
      })
      if (procResponse.ok) {
        const procData = await procResponse.json()
        if (procData.ok) {
          reporte.ai_resumen = procData.resumen || ''
          reporte.ai_avances = procData.avances || []
          reporte.ai_faltantes = procData.faltantes || []
          reporte.ai_bloqueos = procData.bloqueos || []
          reporte.procesado = true
        }
      }
    } catch (err) {
      console.error('Error procesando reporte con AI:', err)
      // Si falla, el reporte queda con procesado=false — se puede reintentar después
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
  const toggleDoc = async (idx: number) => {
    const current = obra.entrega_docs[idx]
    const newReceived = !current.recibido
    // Optimistic update
    updateObra(o => ({
      ...o,
      entrega_docs: o.entrega_docs.map((d, i) => i === idx ? { ...d, recibido: newReceived } : d),
    }))
    // Persistir: busca el doc por nombre + obra_id. Si no existe lo inserta.
    try {
      const { data: existing } = await supabase.from('obra_entrega_docs').select('id').eq('obra_id', obra.id).eq('nombre', current.nombre).maybeSingle()
      if (existing?.id) {
        await supabase.from('obra_entrega_docs').update({ recibido: newReceived, fecha: newReceived ? new Date().toISOString().substring(0, 10) : null }).eq('id', existing.id)
      } else {
        await supabase.from('obra_entrega_docs').insert({
          obra_id: obra.id,
          nombre: current.nombre,
          recibido: newReceived,
          fecha: newReceived ? new Date().toISOString().substring(0, 10) : null,
          order_index: idx,
        })
      }
    } catch (err) {
      console.error('Error persistiendo entrega doc:', err)
    }
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
          <Btn size="sm" variant="primary" onClick={async () => {
            updateObra(o => ({ ...o, status: 'en_ejecucion' }))
            await supabase.from('obras').update({ status: 'en_ejecucion' }).eq('id', obra.id)
          }}>
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

  const addInstalador = async (id: string) => {
    updateObra(o => ({ ...o, instaladores_ids: [...o.instaladores_ids, id] }))
    const { error } = await supabase.from('obra_instaladores').insert({ obra_id: obra.id, employee_id: id, rol: 'instalador' })
    if (error) console.error('Error asignando instalador:', error)
  }
  const removeInstalador = async (id: string) => {
    updateObra(o => ({ ...o, instaladores_ids: o.instaladores_ids.filter(x => x !== id) }))
    const { error } = await supabase.from('obra_instaladores').delete().eq('obra_id', obra.id).eq('employee_id', id)
    if (error) console.error('Error removiendo instalador:', error)
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
    cotizacion_ids: string[]; valor_contrato: number; sistemas: Sistema[]; fecha_fin_plan: string;
  }) => Promise<{ ok: true; obra: ObraData } | { ok: false; error: string }>
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    nombre: '', cliente: '', direccion: '', coordinador_id: '',
    cotizacion_ids: [] as string[], valor_contrato: '', sistemas: [] as Sistema[],
    fecha_fin_plan: '', lead_id: '',
  })
  const [leads, setLeads] = useState<Array<{ id: string; name: string; company: string; address?: string }>>([])
  const [cotizaciones, setCotizaciones] = useState<Array<{ id: string; name: string; total: number; project_name?: string; client_name?: string; notes?: string; stage?: string }>>([])
  const [loadingCots, setLoadingCots] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [leadSearch, setLeadSearch] = useState('')
  const [leadOpen, setLeadOpen] = useState(false)
  const leadRef = useRef<HTMLDivElement>(null)

  // Close lead dropdown on outside click
  React.useEffect(() => {
    function handleClick(e: MouseEvent) { if (leadRef.current && !leadRef.current.contains(e.target as Node)) setLeadOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Default coordinador: el primero "coordinador" si existe
  React.useEffect(() => {
    if (!form.coordinador_id && coordinadores.length > 0) {
      setForm(f => ({ ...f, coordinador_id: coordinadores[0].id }))
    }
  }, [coordinadores])

  // Load leads + cotizaciones on mount
  React.useEffect(() => {
    setLoadingCots(true)
    Promise.all([
      supabase.from('leads').select('id,name,company').order('name'),
      supabase.from('quotations').select('id, name, total, project_id, client_name, notes, stage, projects:projects!quotations_project_id_fkey(name)')
        .in('stage', ['propuesta', 'contrato']).order('created_at', { ascending: false }),
    ]).then(([lRes, qRes]) => {
      setLeads((lRes.data || []) as any)
      if (qRes.data) {
        setCotizaciones(qRes.data.map((q: any) => ({
          id: q.id, name: q.name, total: q.total || 0,
          project_name: q.projects?.name || '', client_name: q.client_name || '',
          notes: q.notes || '',
        })))
      }
      setLoadingCots(false)
    })
  }, [])

  const filteredLeads = leadSearch
    ? leads.filter(l => `${l.name} ${l.company}`.toLowerCase().includes(leadSearch.toLowerCase()))
    : leads

  // Cotizaciones filtered by selected lead
  const filteredCots = form.lead_id
    ? cotizaciones.filter(c => {
        try { const m = JSON.parse(c.notes || '{}'); if (m.lead_id === form.lead_id) return true } catch {}
        const leadName = leads.find(l => l.id === form.lead_id)?.name?.toLowerCase() || ''
        return leadName && (c.client_name?.toLowerCase().includes(leadName) || c.name?.toLowerCase().includes(leadName))
      })
    : cotizaciones

  const handleLeadSelect = (leadId: string) => {
    const lead = leads.find(l => l.id === leadId)
    setForm(f => ({
      ...f, lead_id: leadId,
      cliente: lead?.company || lead?.name || f.cliente,
      nombre: f.nombre || lead?.name || '',
      cotizacion_ids: [], // Reset cotizaciones when lead changes
      valor_contrato: '',
    }))
    setLeadOpen(false)
    setLeadSearch('')
  }

  const toggleCot = (cotId: string) => {
    setForm(f => {
      const ids = f.cotizacion_ids.includes(cotId)
        ? f.cotizacion_ids.filter(id => id !== cotId)
        : [...f.cotizacion_ids, cotId]
      // Recalculate total from all selected cotizaciones
      const totalVal = ids.reduce((s, id) => {
        const c = cotizaciones.find(x => x.id === id)
        return s + (c?.total || 0)
      }, 0)
      const firstCot = cotizaciones.find(c => c.id === (ids[0] || ''))
      return {
        ...f, cotizacion_ids: ids,
        valor_contrato: totalVal > 0 ? String(totalVal) : f.valor_contrato,
        cliente: f.cliente || firstCot?.client_name || '',
        nombre: f.nombre || firstCot?.project_name || firstCot?.name || '',
      }
    })
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
      cotizacion_ids: form.cotizacion_ids,
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
          {/* Lead selector con búsqueda */}
          <div ref={leadRef} style={{ position: 'relative' }}>
            <div style={labelStyle}>Lead / Proyecto</div>
            <div
              onClick={() => { setLeadOpen(true); setLeadSearch('') }}
              style={{
                ...inputStyle, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderColor: leadOpen ? '#57FF9A' : '#333',
              }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: form.lead_id ? '#fff' : '#666' }}>
                {form.lead_id ? (() => { const l = leads.find(x => x.id === form.lead_id); return l ? `${l.name}${l.company ? ' | ' + l.company : ''}` : 'Seleccionar...' })() : '— Seleccionar lead —'}
              </span>
              {form.lead_id && <button onClick={e => { e.stopPropagation(); setForm(f => ({ ...f, lead_id: '', cotizacion_ids: [], valor_contrato: '' })) }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0 }}><X size={12} /></button>}
            </div>
            {leadOpen && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#1e1e1e', border: '1px solid #444', borderRadius: 8, marginTop: 2, maxHeight: 220, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '6px 8px', borderBottom: '1px solid #333' }}>
                  <input autoFocus value={leadSearch} onChange={e => setLeadSearch(e.target.value)} placeholder="Buscar lead..."
                    style={{ width: '100%', padding: '6px 8px', background: '#141414', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box' as const, outline: 'none' }} />
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {filteredLeads.map(l => (
                    <div key={l.id} onClick={() => handleLeadSelect(l.id)}
                      style={{ padding: '7px 10px', fontSize: 12, color: l.id === form.lead_id ? '#57FF9A' : '#ccc', cursor: 'pointer', background: l.id === form.lead_id ? 'rgba(87,255,154,0.08)' : 'transparent' }}
                      onMouseEnter={e => { if (l.id !== form.lead_id) e.currentTarget.style.background = '#252525' }}
                      onMouseLeave={e => { if (l.id !== form.lead_id) e.currentTarget.style.background = 'transparent' }}>
                      {l.name}{l.company ? <span style={{ color: '#666' }}> | {l.company}</span> : ''}
                    </div>
                  ))}
                  {filteredLeads.length === 0 && <div style={{ padding: 10, fontSize: 11, color: '#555', textAlign: 'center' }}>Sin resultados</div>}
                </div>
              </div>
            )}
          </div>
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
          <div>
            <div style={labelStyle}>Cotizaciones {loadingCots && '(cargando...)'} {form.cotizacion_ids.length > 0 && <span style={{ color: '#57FF9A', fontWeight: 600 }}>({form.cotizacion_ids.length})</span>}</div>
            <div style={{ border: '1px solid #333', borderRadius: 8, maxHeight: 140, overflowY: 'auto', background: '#0a0a0a' }}>
              {filteredCots.length === 0 && <div style={{ padding: 10, fontSize: 11, color: '#555', textAlign: 'center' as const }}>{form.lead_id ? 'Sin cotizaciones para este lead' : 'Selecciona un lead primero'}</div>}
              {filteredCots.map(c => {
                const checked = form.cotizacion_ids.includes(c.id)
                return (
                  <label key={c.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer',
                    background: checked ? 'rgba(87,255,154,0.06)' : 'transparent',
                    borderBottom: '1px solid #1a1a1a', fontSize: 12,
                  }}
                    onMouseEnter={e => { if (!checked) e.currentTarget.style.background = '#151515' }}
                    onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleCot(c.id)}
                      style={{ accentColor: '#57FF9A' }} />
                    <span style={{ color: checked ? '#57FF9A' : '#ccc', flex: 1 }}>{c.name}</span>
                    <span style={{ color: '#666', fontSize: 11 }}>{F(c.total)}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
   SUB: BLOQUEOS — mini sistema de tickets
   ═══════════════════════════════════════════════════════════════════ */

interface BloqueoDB {
  id: string
  obra_id: string
  actividad_id: string | null
  tipo: string
  descripcion: string
  severidad: 'baja' | 'media' | 'alta' | 'critica'
  status: 'abierto' | 'en_atencion' | 'resuelto'
  reportado_por_id: string | null
  asignado_a_id: string | null
  fecha_reporte: string
  fecha_resolucion: string | null
  notificado_residente: boolean
  notas_resolucion: string | null
}

const BLOQUEO_TIPO_LABEL: Record<string, string> = {
  falta_material: 'Falta material',
  falta_acceso: 'Falta acceso',
  cliente: 'Cliente',
  diseno: 'Diseño',
  clima: 'Clima',
  otro: 'Otro',
}
const SEVERIDAD_COLOR: Record<string, string> = {
  baja: '#57FF9A',
  media: '#F59E0B',
  alta: '#EF4444',
  critica: '#C026D3',
}

function SubBloqueos({ obra, instaladores }: { obra: ObraData; instaladores: Instalador[] }) {
  const [bloqueos, setBloqueos] = useState<BloqueoDB[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ tipo: 'falta_material', descripcion: '', severidad: 'media', asignado_a_id: '' })
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('obra_bloqueos').select('*').eq('obra_id', obra.id).order('fecha_reporte', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Error cargando bloqueos:', error)
        setBloqueos((data || []) as BloqueoDB[])
        setLoading(false)
      })
  }, [obra.id])

  async function crear() {
    if (!newForm.descripcion.trim()) { setSaveError('La descripción es obligatoria'); return }
    setSaveError(null)
    setSaving(true)
    const payload: any = {
      obra_id: obra.id,
      tipo: newForm.tipo,
      descripcion: newForm.descripcion.trim(),
      severidad: newForm.severidad,
      status: 'abierto',
      asignado_a_id: newForm.asignado_a_id || null,
    }
    const { data, error } = await supabase.from('obra_bloqueos').insert(payload).select().single()
    setSaving(false)
    if (error) {
      setSaveError('Error al crear bloqueo: ' + error.message)
      return
    }
    if (data) {
      setBloqueos(prev => [data as BloqueoDB, ...prev])
      setNewForm({ tipo: 'falta_material', descripcion: '', severidad: 'media', asignado_a_id: '' })
      setShowNew(false)
    }
  }

  async function resolver(id: string, notas: string) {
    const { error } = await supabase.from('obra_bloqueos').update({
      status: 'resuelto', fecha_resolucion: new Date().toISOString(), notas_resolucion: notas || null,
    }).eq('id', id)
    if (error) { alert('Error al resolver: ' + error.message); return }
    setBloqueos(prev => prev.map(b => b.id === id ? { ...b, status: 'resuelto', fecha_resolucion: new Date().toISOString(), notas_resolucion: notas || null } : b))
  }

  async function toggleNotifResidente(id: string, current: boolean) {
    const { error } = await supabase.from('obra_bloqueos').update({ notificado_residente: !current }).eq('id', id)
    if (error) return
    setBloqueos(prev => prev.map(b => b.id === id ? { ...b, notificado_residente: !current } : b))
  }

  const abiertos = bloqueos.filter(b => b.status !== 'resuelto')
  const resueltos = bloqueos.filter(b => b.status === 'resuelto')

  if (loading) return <Loading />

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Bloqueos de obra</div>
          <div style={{ fontSize: 11, color: '#666' }}>Tickets abiertos: {abiertos.length} · Resueltos: {resueltos.length}</div>
        </div>
        <Btn size="sm" variant="primary" onClick={() => setShowNew(true)}><Plus size={12} /> Nuevo bloqueo</Btn>
      </div>

      {showNew && (
        <div style={{ ...cardStyle, borderColor: '#EF444433', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Nuevo bloqueo</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <div style={labelStyle}>Tipo</div>
              <select value={newForm.tipo} onChange={e => setNewForm(f => ({ ...f, tipo: e.target.value }))} style={inputStyle}>
                {Object.entries(BLOQUEO_TIPO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Severidad</div>
              <select value={newForm.severidad} onChange={e => setNewForm(f => ({ ...f, severidad: e.target.value }))} style={inputStyle}>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="critica">Crítica</option>
              </select>
            </div>
            <div>
              <div style={labelStyle}>Asignar a</div>
              <select value={newForm.asignado_a_id} onChange={e => setNewForm(f => ({ ...f, asignado_a_id: e.target.value }))} style={inputStyle}>
                <option value="">— Sin asignar —</option>
                {instaladores.map(i => <option key={i.id} value={i.id}>{i.nombre}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div style={labelStyle}>Descripción *</div>
            <textarea value={newForm.descripcion} onChange={e => setNewForm(f => ({ ...f, descripcion: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Qué está frenando el avance..." />
          </div>
          {saveError && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 6, color: '#f87171', fontSize: 11 }}>⚠ {saveError}</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <Btn size="sm" variant="default" onClick={() => { setShowNew(false); setSaveError(null) }}>Cancelar</Btn>
            <Btn size="sm" variant="primary" onClick={crear} disabled={saving}>{saving ? 'Guardando...' : 'Crear'}</Btn>
          </div>
        </div>
      )}

      {abiertos.length === 0 && resueltos.length === 0 && <EmptyState message="Sin bloqueos registrados en esta obra" />}

      {abiertos.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Abiertos ({abiertos.length})</div>
          {abiertos.map(b => (
            <div key={b.id} style={{ ...cardStyle, borderLeft: `3px solid ${SEVERIDAD_COLOR[b.severidad]}`, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Badge label={BLOQUEO_TIPO_LABEL[b.tipo] || b.tipo} color={SEVERIDAD_COLOR[b.severidad]} />
                  <Badge label={b.severidad} color={SEVERIDAD_COLOR[b.severidad]} />
                  {b.status === 'en_atencion' && <Badge label="En atención" color="#F59E0B" />}
                </div>
                <div style={{ fontSize: 10, color: '#555' }}>{new Date(b.fecha_reporte).toLocaleDateString('es-MX')}</div>
              </div>
              <div style={{ fontSize: 12, color: '#ccc', marginBottom: 8 }}>{b.descripcion}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 10, color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={b.notificado_residente} onChange={() => toggleNotifResidente(b.id, b.notificado_residente)} />
                  Residente notificado
                </label>
                <button onClick={() => {
                  const notas = prompt('Notas de resolución (opcional):') || ''
                  resolver(b.id, notas)
                }} style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 10, background: 'rgba(87,255,154,0.1)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 4, color: '#57FF9A', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Resolver
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {resueltos.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#57FF9A', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Resueltos ({resueltos.length})</div>
          {resueltos.slice(0, 10).map(b => (
            <div key={b.id} style={{ ...cardStyle, opacity: 0.6, marginBottom: 6, padding: 10 }}>
              <div style={{ fontSize: 11, color: '#888' }}>
                <Badge label={BLOQUEO_TIPO_LABEL[b.tipo] || b.tipo} color="#555" /> {b.descripcion}
              </div>
              {b.notas_resolucion && <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>Resuelto: {b.notas_resolucion}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   SUB: EXTRAS — bandeja de extras detectados por AI
   ═══════════════════════════════════════════════════════════════════ */

interface ExtraDB {
  id: string
  obra_id: string
  reporte_id: string | null
  tipo: 'actividad' | 'material' | 'cambio_scope'
  descripcion: string
  cantidad: number
  unidad: string
  sistema: string | null
  area: string | null
  catalog_product_id: string | null
  match_confianza: number | null
  precio_estimado: number
  moneda: string
  status: 'pendiente_revision' | 'aprobado_interno' | 'pendiente_cotizar' | 'cotizado' | 'rechazado' | 'absorbido_arquitecto'
  actividad_id: string | null
  cotizacion_adendum_id: string | null
  quotation_item_id: string | null
  detectado_at: string
  detectado_por: string
  texto_original: string | null
}

const EXTRA_STATUS_LABEL: Record<string, string> = {
  pendiente_revision: 'Pendiente',
  aprobado_interno: 'Aprobado interno',
  pendiente_cotizar: 'Pendiente cotizar',
  cotizado: 'Cotizado',
  rechazado: 'Rechazado',
  absorbido_arquitecto: 'Absorbido por arquitecto',
}

function SubExtras({ obra }: { obra: ObraData }) {
  const [extras, setExtras] = useState<ExtraDB[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('obra_extras').select('*').eq('obra_id', obra.id).order('detectado_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) console.error('Error cargando extras:', err)
        setExtras((data || []) as ExtraDB[])
        setLoading(false)
      })
  }, [obra.id])

  const toggleSel = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function aprobarInterno(id: string) {
    const { error: err } = await supabase.from('obra_extras').update({ status: 'aprobado_interno', revisado_at: new Date().toISOString() }).eq('id', id)
    if (err) { alert('Error: ' + err.message); return }
    setExtras(prev => prev.map(e => e.id === id ? { ...e, status: 'aprobado_interno' } : e))
  }

  async function rechazar(id: string) {
    const { error: err } = await supabase.from('obra_extras').update({ status: 'rechazado', revisado_at: new Date().toISOString() }).eq('id', id)
    if (err) { alert('Error: ' + err.message); return }
    setExtras(prev => prev.map(e => e.id === id ? { ...e, status: 'rechazado' } : e))
  }

  async function generarAdendum() {
    const selectedExtras = extras.filter(e => selected.has(e.id) && e.status === 'pendiente_revision')
    if (selectedExtras.length === 0) { setError('No hay extras seleccionados'); return }
    setGenerating(true)
    setError(null)

    try {
      // 1. Crear cotización adendum
      const { data: cot, error: cotErr } = await supabase.from('quotations').insert({
        name: `Adendum: ${obra.nombre}`,
        client_name: obra.cliente,
        specialty: 'esp',
        stage: 'oportunidad',
        tipo_cotizacion: 'adendum',
        parent_obra_id: obra.id,
        total: 0,
        notes: JSON.stringify({ currency: 'MXN', systems: obra.sistemas, fromObraExtras: true }),
      }).select().single()
      if (cotErr) throw cotErr
      const cotizacionId = cot.id

      // 2. Crear área default
      const { data: area, error: areaErr } = await supabase.from('quotation_areas').insert({
        quotation_id: cotizacionId, name: 'Extras detectados', order_index: 0, subtotal: 0,
      }).select().single()
      if (areaErr) throw areaErr
      const areaId = area.id

      // 3. Por cada extra: crear quotation_item y actualizar el extra
      let totalAdendum = 0
      for (let i = 0; i < selectedExtras.length; i++) {
        const ex = selectedExtras[i]
        const precio = ex.precio_estimado || 0
        const itemTotal = precio * ex.cantidad
        totalAdendum += itemTotal
        const { data: item, error: itemErr } = await supabase.from('quotation_items').insert({
          quotation_id: cotizacionId,
          area_id: areaId,
          catalog_product_id: ex.catalog_product_id,
          name: ex.descripcion,
          description: ex.texto_original,
          system: ex.sistema,
          type: ex.tipo === 'actividad' ? 'labor' : 'material',
          quantity: ex.cantidad,
          cost: precio,
          markup: 0,
          price: precio,
          total: itemTotal,
          installation_cost: 0,
          order_index: i,
        }).select().single()
        if (itemErr) throw itemErr
        // Update extra
        await supabase.from('obra_extras').update({
          status: 'cotizado',
          cotizacion_adendum_id: cotizacionId,
          quotation_item_id: item.id,
          revisado_at: new Date().toISOString(),
        }).eq('id', ex.id)
      }

      // 4. Update cotizacion total
      await supabase.from('quotations').update({ total: totalAdendum }).eq('id', cotizacionId)

      // 5. Refresh local state
      setExtras(prev => prev.map(e => selected.has(e.id) ? { ...e, status: 'cotizado', cotizacion_adendum_id: cotizacionId } : e))
      setSelected(new Set())
      alert(`Cotización adendum creada con ${selectedExtras.length} items. Total: $${totalAdendum.toFixed(2)}. Puedes editarla desde el módulo de Cotizaciones.`)
    } catch (err: any) {
      console.error('Error generando adendum:', err)
      setError('Error al generar adendum: ' + (err?.message || String(err)))
    }
    setGenerating(false)
  }

  if (loading) return <Loading />

  const pendientes = extras.filter(e => e.status === 'pendiente_revision')
  const revisados = extras.filter(e => e.status !== 'pendiente_revision')

  // Alerta de escalación: pendientes con > 7 días
  const ahora = Date.now()
  const SIETE_DIAS = 7 * 24 * 60 * 60 * 1000
  const escalados = pendientes.filter(e => ahora - new Date(e.detectado_at).getTime() > SIETE_DIAS)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Bandeja de extras</div>
          <div style={{ fontSize: 11, color: '#666' }}>Pendientes: {pendientes.length} · Revisados: {revisados.length} {escalados.length > 0 && <span style={{ color: '#C026D3', fontWeight: 600 }}>· {escalados.length} críticos (&gt; 7 días)</span>}</div>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: '10px 12px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 8, color: '#f87171', fontSize: 12 }}>⚠ {error}</div>
      )}

      {pendientes.length === 0 && revisados.length === 0 && <EmptyState message="No hay extras detectados. Los extras se generan automáticamente al procesar reportes de campo con AI." />}

      {pendientes.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 600, textTransform: 'uppercase' }}>Pendientes de revisión ({pendientes.length})</div>
            {selected.size > 0 && (
              <Btn size="sm" variant="primary" onClick={generarAdendum} disabled={generating}>
                {generating ? 'Generando...' : `✨ Generar cotización adendum (${selected.size})`}
              </Btn>
            )}
          </div>
          {pendientes.map(ex => {
            const diasEspera = Math.floor((ahora - new Date(ex.detectado_at).getTime()) / (24 * 60 * 60 * 1000))
            const critico = diasEspera > 7
            return (
              <div key={ex.id} style={{ ...cardStyle, marginBottom: 8, borderLeft: critico ? '3px solid #C026D3' : '3px solid #F59E0B' }}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input type="checkbox" checked={selected.has(ex.id)} onChange={() => toggleSel(ex.id)} style={{ marginTop: 4 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                      <Badge label={ex.tipo} color={ex.tipo === 'actividad' ? '#8B5CF6' : '#06B6D4'} />
                      {ex.sistema && <Badge label={ex.sistema} color="#3B82F6" />}
                      <Badge label={`${ex.cantidad} ${ex.unidad}`} color="#555" />
                      {critico && <Badge label={`⚠ ${diasEspera}d`} color="#C026D3" />}
                      {ex.catalog_product_id && ex.match_confianza !== null && ex.match_confianza > 0.8 && <Badge label={`Match ${Math.round(ex.match_confianza * 100)}%`} color="#57FF9A" />}
                    </div>
                    <div style={{ fontSize: 12, color: '#ccc', marginBottom: 4 }}>{ex.descripcion}</div>
                    {ex.texto_original && <div style={{ fontSize: 10, color: '#666', fontStyle: 'italic', marginBottom: 6 }}>"{ex.texto_original}"</div>}
                    {ex.precio_estimado > 0 && <div style={{ fontSize: 11, color: '#57FF9A' }}>Precio estimado: ${ex.precio_estimado.toFixed(2)} {ex.moneda}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button onClick={() => aprobarInterno(ex.id)} style={{ padding: '3px 8px', fontSize: 9, background: 'rgba(87,255,154,0.1)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 4, color: '#57FF9A', cursor: 'pointer', fontFamily: 'inherit' }}>Aprobar interno</button>
                    <button onClick={() => rechazar(ex.id)} style={{ padding: '3px 8px', fontSize: 9, background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, color: '#666', cursor: 'pointer', fontFamily: 'inherit' }}>Rechazar</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {revisados.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#666', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Revisados ({revisados.length})</div>
          {revisados.slice(0, 20).map(ex => (
            <div key={ex.id} style={{ ...cardStyle, marginBottom: 6, padding: 10, opacity: 0.65 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <Badge label={ex.tipo} color="#555" />
                <Badge label={EXTRA_STATUS_LABEL[ex.status]} color={ex.status === 'cotizado' ? '#57FF9A' : ex.status === 'rechazado' ? '#EF4444' : '#888'} />
              </div>
              <div style={{ fontSize: 11, color: '#888' }}>{ex.descripcion}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   SUB: DOCUMENTACION — vista de docs técnicos del proyecto ligado
   ═══════════════════════════════════════════════════════════════════ */

interface DocDB {
  id: string
  project_id: string | null
  obra_id: string | null
  nombre: string
  tipo: string
  sistema: string | null
  drive_url: string
  drive_thumbnail_url: string | null
  version: string | null
  fecha_subida: string
  notas: string | null
}

const DOC_TIPO_LABEL: Record<string, string> = {
  plano: 'Plano',
  ficha_tecnica: 'Ficha técnica',
  diagrama: 'Diagrama',
  render: 'Render',
  memoria_calculo: 'Memoria de cálculo',
  manual: 'Manual',
  otro: 'Otro',
}

function SubDocumentacion({ obra }: { obra: ObraData }) {
  const [docs, setDocs] = useState<DocDB[]>([])
  const [loading, setLoading] = useState(true)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [filterTipo, setFilterTipo] = useState<string>('')
  const [filterSistema, setFilterSistema] = useState<string>('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      // Get project_id from the obra's quotation
      let pId: string | null = null
      if (obra.cotizacion_id) {
        const { data: cot } = await supabase.from('quotations').select('project_id').eq('id', obra.cotizacion_id).maybeSingle()
        pId = cot?.project_id || null
      }
      setProjectId(pId)
      // Fetch docs either from project_id or directly obra_id
      const queries: Promise<any>[] = []
      if (pId) {
        queries.push(Promise.resolve(supabase.from('obra_documentos').select('*').eq('project_id', pId)))
      }
      queries.push(Promise.resolve(supabase.from('obra_documentos').select('*').eq('obra_id', obra.id)))
      const results = await Promise.all(queries)
      const allDocs: DocDB[] = []
      const seen = new Set<string>()
      for (const r of results) {
        for (const d of (r.data || [])) {
          if (!seen.has(d.id)) { allDocs.push(d); seen.add(d.id) }
        }
      }
      setDocs(allDocs)
      setLoading(false)
    }
    load()
  }, [obra.id, obra.cotizacion_id])

  const filtered = docs.filter(d =>
    (!filterTipo || d.tipo === filterTipo) &&
    (!filterSistema || d.sistema === filterSistema)
  )

  const sistemasPresentes = Array.from(new Set(docs.map(d => d.sistema).filter(Boolean))) as string[]

  if (loading) return <Loading />

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Documentación técnica</div>
          <div style={{ fontSize: 11, color: '#666' }}>
            {projectId ? 'Ligada al proyecto desde la cotización.' : 'Esta obra no tiene proyecto ligado — muestra solo documentos directos.'}
            {' '}Para agregar documentos, ve al módulo de <strong>Proyectos</strong>.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} style={{ ...inputStyle, width: 130, padding: '5px 8px' }}>
            <option value="">Todo tipo</option>
            {Object.entries(DOC_TIPO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {sistemasPresentes.length > 0 && (
            <select value={filterSistema} onChange={e => setFilterSistema(e.target.value)} style={{ ...inputStyle, width: 130, padding: '5px 8px' }}>
              <option value="">Todo sistema</option>
              {sistemasPresentes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message={docs.length === 0 ? "No hay documentos técnicos para esta obra" : "Sin resultados con los filtros aplicados"} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {filtered.map(d => (
            <a key={d.id} href={d.drive_url} target="_blank" rel="noopener noreferrer" style={{
              ...cardStyle, textDecoration: 'none', display: 'block', transition: 'border-color 0.12s',
            }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#57FF9A44')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#222')}
            >
              {d.drive_thumbnail_url && (
                <img src={d.drive_thumbnail_url} alt={d.nombre} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }} />
              )}
              <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <Badge label={DOC_TIPO_LABEL[d.tipo] || d.tipo} color="#3B82F6" />
                {d.sistema && <Badge label={d.sistema} color="#8B5CF6" />}
                {d.version && <Badge label={d.version} color="#555" />}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{d.nombre}</div>
              {d.notas && <div style={{ fontSize: 10, color: '#666' }}>{d.notas}</div>}
              <div style={{ fontSize: 9, color: '#444', marginTop: 6 }}>↗ Abrir en Drive</div>
            </a>
          ))}
        </div>
      )}
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
  catalog_product_id: string | null
}
interface MatPOItem {
  id: string
  purchase_order_id: string
  catalog_product_id: string | null
  name: string
  quantity: number
  po_status: string | null
  po_project_id: string | null
}
interface MatDelItem {
  id: string
  po_item_id: string | null
  product_id: string | null
  description: string
  qty: number
  direction: 'in_bodega' | 'in_obra' | 'out_bodega_to_obra'
  obra_id: string | null
  po_id: string | null
  po_project_id: string | null
}

// Bucket key for matching quotation_items ↔ po_items ↔ delivery_items.
// Prefer catalog_product_id (strict match); fallback to normalized name.
function matBucket(it: { catalog_product_id?: string | null; product_id?: string | null; name?: string; description?: string }): string {
  const cpId = it.catalog_product_id || it.product_id
  if (cpId) return `cat:${cpId}`
  const label = (it.name || it.description || '').trim().toLowerCase()
  return label ? `name:${label}` : '__unknown__'
}

function SubMateriales({ obra }: { obra: ObraData }) {
  const [loading, setLoading] = useState(true)
  const [areas, setAreas] = useState<MatArea[]>([])
  const [items, setItems] = useState<MatItem[]>([])
  const [poItems, setPoItems] = useState<MatPOItem[]>([])
  const [delItems, setDelItems] = useState<MatDelItem[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [filterSystem, setFilterSystem] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<'' | 'falta_pedir' | 'falta_recibir' | 'falta_entregar' | 'completo'>('')
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

    const projectId = obra.project_id || null
    const obraId = obra.id

    Promise.all([
      supabase.from('quotation_areas').select('id, name, order_index').eq('quotation_id', obra.cotizacion_id).order('order_index'),
      supabase.from('quotation_items').select('id, area_id, name, description, system, provider, purchase_phase, quantity, price, total, type, catalog_product_id').eq('quotation_id', obra.cotizacion_id).order('order_index'),
      // po_items: filtramos por POs del proyecto (si existe). Si no hay project_id, no podemos filtrar — traemos vacío.
      projectId
        ? supabase.from('po_items').select('id, purchase_order_id, catalog_product_id, name, quantity, purchase_orders!inner(id, status, project_id)').eq('purchase_orders.project_id', projectId)
        : Promise.resolve({ data: [], error: null }),
      // delivery_items: los que son para esta obra (entregado) + los cuyo PO sea de este proyecto (recibido en bodega por OMM para este proyecto)
      projectId
        ? supabase.from('delivery_items').select('id, po_item_id, product_id, description, qty, direction, obra_id, po_id, purchase_orders:po_id(id, project_id)').or(`obra_id.eq.${obraId},purchase_orders.project_id.eq.${projectId}`)
        : supabase.from('delivery_items').select('id, po_item_id, product_id, description, qty, direction, obra_id, po_id').eq('obra_id', obraId),
    ]).then(([areasRes, itemsRes, poRes, delRes]: any[]) => {
      if (areasRes.error) setError('Error cargando áreas: ' + areasRes.error.message)
      if (itemsRes.error) setError('Error cargando materiales: ' + itemsRes.error.message)
      if (poRes.error) console.warn('Error cargando po_items:', poRes.error)
      if (delRes.error) console.warn('Error cargando delivery_items:', delRes.error)

      setAreas((areasRes.data || []) as MatArea[])
      // Solo materiales (no mano de obra)
      const materialItems = ((itemsRes.data || []) as MatItem[]).filter(it => it.type !== 'labor')
      setItems(materialItems)

      // Normalizar po_items (aplanamos el embed de purchase_orders)
      const poNorm: MatPOItem[] = ((poRes.data || []) as any[]).map(p => ({
        id: p.id,
        purchase_order_id: p.purchase_order_id,
        catalog_product_id: p.catalog_product_id || null,
        name: p.name || '',
        quantity: Number(p.quantity) || 0,
        po_status: p.purchase_orders?.status || null,
        po_project_id: p.purchase_orders?.project_id || null,
      }))
      setPoItems(poNorm)

      // Normalizar delivery_items
      const delNorm: MatDelItem[] = ((delRes.data || []) as any[]).map(d => ({
        id: d.id,
        po_item_id: d.po_item_id || null,
        product_id: d.product_id || null,
        description: d.description || '',
        qty: Number(d.qty) || 0,
        direction: d.direction,
        obra_id: d.obra_id || null,
        po_id: d.po_id || null,
        po_project_id: d.purchase_orders?.project_id || null,
      }))
      setDelItems(delNorm)

      setLoading(false)
    })
  }, [obra.cotizacion_id, obra.project_id, obra.id])

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

  // ═══════════════ AGREGACIONES POR BUCKET ═══════════════
  // Sumas totales de pedido / recibido / entregado agrupadas por bucket key
  // (catalog_product_id si existe, si no por nombre normalizado).
  const pedidoByBucket: Record<string, number> = {}
  poItems.forEach(p => {
    // Excluir POs canceladas o en borrador — las demás cuentan como "pedido"
    if (p.po_status === 'cancelada') return
    const k = matBucket({ catalog_product_id: p.catalog_product_id, name: p.name })
    pedidoByBucket[k] = (pedidoByBucket[k] || 0) + p.quantity
  })

  // Recibido: llegó al inventario OMM para este proyecto (bodega o directo a obra)
  //   direction IN ('in_bodega', 'in_obra')
  const recibidoByBucket: Record<string, number> = {}
  // Entregado: físicamente está en ESTA obra
  //   direction IN ('in_obra', 'out_bodega_to_obra') AND obra_id = obra.id
  const entregadoByBucket: Record<string, number> = {}

  delItems.forEach(d => {
    const k = matBucket({ product_id: d.product_id, description: d.description })
    if (d.direction === 'in_bodega' || d.direction === 'in_obra') {
      recibidoByBucket[k] = (recibidoByBucket[k] || 0) + d.qty
    }
    if ((d.direction === 'in_obra' || d.direction === 'out_bodega_to_obra') && d.obra_id === obra.id) {
      entregadoByBucket[k] = (entregadoByBucket[k] || 0) + d.qty
    }
  })

  // Helper: estado por item
  function getItemStatus(it: MatItem): 'falta_pedir' | 'falta_recibir' | 'falta_entregar' | 'completo' {
    const k = matBucket({ catalog_product_id: it.catalog_product_id, name: it.name })
    const cot = Number(it.quantity) || 0
    const ped = pedidoByBucket[k] || 0
    const rec = recibidoByBucket[k] || 0
    const ent = entregadoByBucket[k] || 0
    if (ent >= cot && cot > 0) return 'completo'
    if (rec >= cot && cot > 0) return 'falta_entregar'
    if (ped >= cot && cot > 0) return 'falta_recibir'
    return 'falta_pedir'
  }

  // ═══════════════ FILTROS ═══════════════
  const filteredItems = items.filter(it => {
    if (filterSystem && it.system !== filterSystem) return false
    if (filterStatus && getItemStatus(it) !== filterStatus) return false
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

  // ═══════════════ KPIs ═══════════════
  // Conteo por estado (sobre todos los items, no solo filtrados)
  let kpiCompletos = 0
  let kpiFaltaPedir = 0
  let kpiFaltaRecibir = 0
  let kpiFaltaEntregar = 0
  items.forEach(it => {
    const st = getItemStatus(it)
    if (st === 'completo') kpiCompletos++
    else if (st === 'falta_pedir') kpiFaltaPedir++
    else if (st === 'falta_recibir') kpiFaltaRecibir++
    else if (st === 'falta_entregar') kpiFaltaEntregar++
  })

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
      {/* KPIs por estado — matriz 4 estados */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <KpiCard label="Falta pedir"     value={String(kpiFaltaPedir)}     color="#F87171" icon={<AlertTriangle size={16} />} />
        <KpiCard label="Falta recibir"   value={String(kpiFaltaRecibir)}   color="#F59E0B" icon={<ShoppingCart size={16} />} />
        <KpiCard label="Falta entregar"  value={String(kpiFaltaEntregar)}  color="#3B82F6" icon={<Truck size={16} />} />
        <KpiCard label="Completos"       value={String(kpiCompletos)}      color="#57FF9A" icon={<CheckCircle2 size={16} />} />
      </div>

      {/* Controles */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, descripción, proveedor..."
          style={{ ...inputStyle, width: 260 }}
        />
        <select
          value={filterSystem}
          onChange={e => setFilterSystem(e.target.value)}
          style={{ ...inputStyle, width: 150 }}
        >
          <option value="">Todos los sistemas</option>
          {uniqueSystems.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as any)}
          style={{ ...inputStyle, width: 170 }}
        >
          <option value="">Todos los estados</option>
          <option value="falta_pedir">Falta pedir</option>
          <option value="falta_recibir">Falta recibir</option>
          <option value="falta_entregar">Falta entregar</option>
          <option value="completo">Completos</option>
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
        // Resúmenes del área: contador por estado
        let areaFaltaPedir = 0, areaFaltaRecibir = 0, areaFaltaEntregar = 0, areaCompletos = 0
        areaItems.forEach(it => {
          const st = getItemStatus(it)
          if (st === 'falta_pedir') areaFaltaPedir++
          else if (st === 'falta_recibir') areaFaltaRecibir++
          else if (st === 'falta_entregar') areaFaltaEntregar++
          else if (st === 'completo') areaCompletos++
        })
        const areaPiezasCot = areaItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
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
              <span style={{ fontSize: 10, color: '#666' }}>{areaItems.length} items · {areaPiezasCot} pz cot.</span>
              {/* Mini-contadores de estado por área */}
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, fontFamily: 'monospace' }}>
                {areaFaltaPedir > 0    && <span style={{ color: '#F87171' }} title="Falta pedir">●{areaFaltaPedir}</span>}
                {areaFaltaRecibir > 0  && <span style={{ color: '#FBBF24' }} title="Falta recibir">●{areaFaltaRecibir}</span>}
                {areaFaltaEntregar > 0 && <span style={{ color: '#60A5FA' }} title="Falta entregar">●{areaFaltaEntregar}</span>}
                {areaCompletos > 0     && <span style={{ color: '#57FF9A' }} title="Completos">✓{areaCompletos}</span>}
              </span>
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
                            <th style={{ textAlign: 'left',   fontSize: 9, color: '#444', fontWeight: 600, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Producto</th>
                            <th style={{ textAlign: 'left',   fontSize: 9, color: '#444', fontWeight: 600, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', width: 130 }}>Proveedor</th>
                            <th style={{ textAlign: 'center', fontSize: 9, color: '#F87171', fontWeight: 700, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', width: 80 }}>Cotizado</th>
                            <th style={{ textAlign: 'center', fontSize: 9, color: '#FBBF24', fontWeight: 700, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', width: 80 }}>Pedido</th>
                            <th style={{ textAlign: 'center', fontSize: 9, color: '#60A5FA', fontWeight: 700, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', width: 80 }}>Recibido</th>
                            <th style={{ textAlign: 'center', fontSize: 9, color: '#57FF9A', fontWeight: 700, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', width: 80 }}>Entregado</th>
                            <th style={{ textAlign: 'center', fontSize: 9, color: '#444', fontWeight: 600, padding: '4px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', width: 60 }}>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sysItems.map(it => {
                            const k = matBucket({ catalog_product_id: it.catalog_product_id, name: it.name })
                            const cot = Number(it.quantity) || 0
                            const ped = pedidoByBucket[k] || 0
                            const rec = recibidoByBucket[k] || 0
                            const ent = entregadoByBucket[k] || 0
                            const st = getItemStatus(it)
                            const stCfg = {
                              falta_pedir:     { color: '#F87171', label: '●', title: 'Falta pedir' },
                              falta_recibir:   { color: '#FBBF24', label: '●', title: 'Falta recibir' },
                              falta_entregar:  { color: '#60A5FA', label: '●', title: 'Falta entregar' },
                              completo:        { color: '#57FF9A', label: '✓', title: 'Completo' },
                            }[st]
                            // Helpers de color por comparación con cotizado
                            const pedColor = ped >= cot ? '#FBBF24' : (ped > 0 ? '#fbbf2480' : '#3a3a3a')
                            const recColor = rec >= cot ? '#60A5FA' : (rec > 0 ? '#60a5fa80' : '#3a3a3a')
                            const entColor = ent >= cot ? '#57FF9A' : (ent > 0 ? '#57ff9a80' : '#3a3a3a')
                            return (
                              <tr key={it.id} style={{ borderTop: '1px solid #141414' }}>
                                <td style={{ fontSize: 12, color: '#ddd', padding: '6px' }}>
                                  <div style={{ fontWeight: 500 }}>{it.name}</div>
                                  {it.description && <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>{it.description}</div>}
                                </td>
                                <td style={{ fontSize: 11, color: '#888', padding: '6px' }}>{it.provider || '—'}</td>
                                <td style={{ textAlign: 'center', fontSize: 12, color: '#fff', fontWeight: 600, padding: '6px', fontVariantNumeric: 'tabular-nums' as const }}>
                                  {cot}
                                </td>
                                <td style={{ textAlign: 'center', fontSize: 12, color: pedColor, fontWeight: 600, padding: '6px', fontVariantNumeric: 'tabular-nums' as const }}>
                                  {ped}
                                </td>
                                <td style={{ textAlign: 'center', fontSize: 12, color: recColor, fontWeight: 600, padding: '6px', fontVariantNumeric: 'tabular-nums' as const }}>
                                  {rec}
                                </td>
                                <td style={{ textAlign: 'center', fontSize: 12, color: entColor, fontWeight: 600, padding: '6px', fontVariantNumeric: 'tabular-nums' as const }}>
                                  {ent}
                                </td>
                                <td style={{ textAlign: 'center', padding: '6px' }} title={stCfg.title}>
                                  <span style={{ color: stCfg.color, fontSize: 14, fontWeight: 700 }}>{stCfg.label}</span>
                                </td>
                              </tr>
                            )
                          })}
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
