import React, { useState, useRef, useEffect } from 'react'
import { SectionHeader, KpiCard, Table, Th, Td, Badge, Btn, EmptyState, ProgressBar, Loading } from '../components/layout/UI'
import { F, formatDate } from '../lib/utils'
import { ANTHROPIC_API_KEY } from '../lib/config'
import { supabase } from '../lib/supabase'
import { useIsMobile } from '../lib/useIsMobile'
import jsPDF from 'jspdf'
import { useAuth } from '../contexts/AuthContext'
import MaterialesObra, { ProximasEntregas } from '../components/MaterialesObra'
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
type Tab = 'dashboard' | 'obras' | 'instaladores' | 'planeacion'

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
  ai_actividades_sugeridas?: ActividadSugerida[]
  ai_pendientes?: { descripcion: string; sistema?: string; area?: string | null }[]
  sugerencias_aplicadas?: boolean
  procesado: boolean
}

// Lo que la IA PROPONE cerrar a partir de un reporte. No se aplica solo:
// el coordinador confirma. Cerrar actividades mueve el avance de la obra y
// eso no puede depender de cómo estaba redactado un reporte de campo.
export interface ActividadSugerida {
  actividad_id: string
  descripcion: string
  sistema?: string | null
  area?: string | null
  porcentaje: number
  evidencia?: string
  confianza?: number | null
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
  quotation_ids?: string[]
  project_id?: string
  coordinador: string
  sistemas: Sistema[]
  instaladores_ids: string[]
  fecha_inicio?: string
  fecha_fin_plan?: string
  fecha_fin_real?: string
  latitude?: number
  longitude?: number
  radio_checada_metros?: number
  direccion_completa?: string
  google_maps_url?: string
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
  CCTV:       { label: 'CCTV',             color: '#DC2626', icon: Shield },
  Audio:      { label: 'Audio',            color: '#A78BFA', icon: Volume2 },
  Redes:      { label: 'Redes',            color: '#2563EB', icon: Wifi },
  Control:    { label: 'Control (Lutron)', color: '#D97706', icon: Sun },
  Acceso:     { label: 'Control Acceso',   color: '#06B6D4', icon: Lock },
  Electrico:  { label: 'Eléctrico',        color: '#FF6B35', icon: Wrench },
  Humo:       { label: 'Detección Humo',   color: '#DC2626', icon: Flame },
  BMS:        { label: 'BMS',              color: '#14B8A6', icon: Server },
  Telefonia:  { label: 'Telefonía',        color: '#8B5CF6', icon: Phone },
  Celular:    { label: 'Red Celular',      color: '#EC4899', icon: Radio },
  Persianas:  { label: 'Cortinas/Persianas', color: '#7C3AED', icon: Blinds },
}

const STATUS_CONFIG: Record<ObraStatus, { label: string; color: string }> = {
  entrega_pendiente: { label: 'Entrega pendiente', color: '#D97706' },
  en_ejecucion:      { label: 'En ejecución',      color: '#10B981' },
  pausada:           { label: 'Pausada',            color: '#6B7280' },
  completada:        { label: 'Completada',         color: '#2563EB' },
}

const ACT_STATUS_CONFIG: Record<ActividadStatus, { label: string; color: string }> = {
  pendiente:   { label: 'Pendiente',   color: '#6B7280' },
  en_progreso: { label: 'En progreso', color: '#2563EB' },
  bloqueada:   { label: 'Bloqueada',   color: '#DC2626' },
  completada:  { label: 'Completada',  color: '#10B981' },
}

const NIVEL_CONFIG: Record<string, { label: string; color: string }> = {
  senior: { label: 'Senior', color: '#D97706' },
  medio:  { label: 'Medio',  color: '#2563EB' },
  junior: { label: 'Junior', color: '#6B7280' },
}

const DOCS_ENTREGA: string[] = [
  'Planos aprobados', 'Cotización firmada', 'Contrato', 'Lista de equipos',
  'Diagrama de conexiones', 'Especificaciones técnicas', 'Accesos / permisos obra',
  'Contacto residente de obra',
]

/* ── Avance / fechas ────────────────────────────────────────────────
   El avance NUNCA se lee de la columna guardada: se calcula del
   promedio del % de las actividades (una actividad "completada"
   cuenta 100 aunque su % haya quedado en otro valor). La columna
   obras.avance_global se conserva solo como cache para otros módulos
   y se repara sola cuando difiere. */
export function avanceDe(acts: { porcentaje?: number | null; status?: string | null }[]): number {
  if (!acts.length) return 0
  const suma = acts.reduce((s, a) => s + (a.status === 'completada' ? 100 : (Number(a.porcentaje) || 0)), 0)
  return Math.round(suma / acts.length)
}

const hoyISO = () => new Date().toISOString().substring(0, 10)

const diasEntre = (desde: string, hasta: string): number =>
  Math.round((new Date(hasta + 'T00:00:00').getTime() - new Date(desde + 'T00:00:00').getTime()) / 86400000)

// Semáforo de la fecha compromiso de la obra.
function semaforoObra(o: { fecha_fin_plan?: string; status?: string; avance?: number }):
  { label: string; color: string } | null {
  if (!o.fecha_fin_plan) return null
  if (o.status === 'completada') return { label: 'Entregada', color: '#2563EB' }
  const d = diasEntre(hoyISO(), o.fecha_fin_plan)
  if (d < 0) return { label: `${Math.abs(d)} d de atraso`, color: '#DC2626' }
  if (d === 0) return { label: 'Vence hoy', color: '#DC2626' }
  if (d <= 7) return { label: `Vence en ${d} d`, color: '#D97706' }
  return { label: `${d} d restantes`, color: '#10B981' }
}

// Saca lat/lng de un link de Google Maps pegado por el usuario.
export function coordsDeUrl(url: string): { lat: number; lng: number } | null {
  const t = String(url || '')
  const pats = [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/]
  for (const re of pats) {
    const m = t.match(re)
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2])
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }
    }
  }
  return null
}

export interface StatsObra {
  total: number; hechas: number; bloq: number; sinResp: number; avance: number; vencidas: number
}

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
    quotation_ids: (o.quotation_ids || []) as string[],
    cotizacion_ref: o.quotation_id ? '' : undefined, // se hidrata si hace falta
    project_id: o.project_id || undefined,
    coordinador: coordinadorName,
    sistemas: (o.sistemas || []) as Sistema[],
    instaladores_ids: (o.instaladores_ids || []) as string[],
    fecha_inicio: o.fecha_inicio || undefined,
    fecha_fin_plan: o.fecha_fin_plan || undefined,
    fecha_fin_real: o.fecha_fin_real || undefined,
    latitude: o.latitude != null ? Number(o.latitude) : undefined,
    longitude: o.longitude != null ? Number(o.longitude) : undefined,
    radio_checada_metros: o.radio_checada_metros != null ? Number(o.radio_checada_metros) : undefined,
    direccion_completa: o.direccion_completa || undefined,
    google_maps_url: o.google_maps_url || undefined,
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
  const isMobile = useIsMobile()
  const { user } = useAuth()
  // El Coordinador de Obra (y roles de campo) no deben ver montos de dinero.
  const hideMoney = user?.permission_area === 'Coordinador_Obra'
  const [tab, setTab] = useState<Tab>('dashboard')
  const [obras, setObras] = useState<ObraData[]>([])
  const [instaladores, setInstaladores] = useState<Instalador[]>([])
  const [coordinadores, setCoordinadores] = useState<Array<{ id: string; name: string }>>([])
  const [selectedObra, setSelectedObra] = useState<string | null>(null)
  const [showNewObra, setShowNewObra] = useState(false)
  const [showNewInstalador, setShowNewInstalador] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Estadísticas reales por obra, calculadas de obra_actividades (no de la
  // columna guardada). Se cargan de una sola query para las 18 obras.
  const [stats, setStats] = useState<Record<string, StatsObra>>({})

  // Carga inicial: obras + employees (instaladores + coordinadores)
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const [obrasRes, empRes, actsRes] = await Promise.all([
          supabase.from('obras').select('*').order('created_at', { ascending: false }),
          // Excluye bajas: RRHH marca la baja en activo/estado_empleado; obra usa is_active.
          // Filtramos por ambos para que un dado de baja no reaparezca aunque un flag quede desincronizado.
          supabase.from('employees').select('id,name,phone,role,level,skills,disponible,foto_url,calificacion,notes,is_active,activo,estado_empleado,tipo_trabajo,area').eq('is_active', true).or('activo.is.null,activo.eq.true').order('name'),
          supabase.from('obra_actividades').select('obra_id,status,porcentaje,instalador_id,fecha_fin_plan').limit(20000),
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
        // Excluir cualquier empleado dado de baja (por si algún flag quedó desincronizado)
        const empleados = (empRes.data || []).filter((e: any) =>
          e.activo !== false && String(e.estado_empleado || '').toLowerCase() !== 'baja'
        )
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

        // Agregados reales por obra
        const porObra = new Map<string, any[]>()
        ;((actsRes as any)?.data || []).forEach((a: any) => {
          const arr = porObra.get(a.obra_id) || []
          arr.push(a)
          porObra.set(a.obra_id, arr)
        })
        const hoy = hoyISO()
        const st: Record<string, StatsObra> = {}
        obrasMapped.forEach((o: ObraData) => {
          const acts = porObra.get(o.id) || []
          st[o.id] = {
            total: acts.length,
            hechas: acts.filter(a => a.status === 'completada').length,
            bloq: acts.filter(a => a.status === 'bloqueada').length,
            sinResp: acts.filter(a => !a.instalador_id).length,
            avance: avanceDe(acts),
            vencidas: acts.filter(a => a.status !== 'completada' && a.fecha_fin_plan && a.fecha_fin_plan < hoy).length,
          }
        })
        // Sobrescribimos el avance guardado con el real para que TODO lo que
        // consume `obras` (panel, PDF, resumen con IA) hable del mismo número.
        obrasMapped.forEach((o: ObraData) => { o.avance_global = st[o.id]?.avance ?? 0 })
        setInstaladores(insts)
        setCoordinadores(coords)
        setObras(obrasMapped)
        setStats(st)
        setLoading(false)

        // Repara en silencio la columna cache que quedó desfasada
        ;(obrasRes.data || []).forEach((row: any) => {
          const real = st[row.id]?.avance ?? 0
          if (real !== (row.avance_global || 0)) {
            supabase.from('obras').update({ avance_global: real }).eq('id', row.id).then(() => {}, () => {})
          }
        })
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
  // Si la obra ya está hidratada (se abrió su ficha) usamos sus actividades en
  // memoria, que están más frescas que el agregado inicial.
  const statsDe = (o: ObraData): StatsObra => {
    if (o.actividades.length) {
      const hoy = hoyISO()
      return {
        total: o.actividades.length,
        hechas: o.actividades.filter(a => a.status === 'completada').length,
        bloq: o.actividades.filter(a => a.status === 'bloqueada').length,
        sinResp: o.actividades.filter(a => !a.instalador_id).length,
        avance: avanceDe(o.actividades),
        vencidas: o.actividades.filter(a => a.status !== 'completada' && a.fecha_fin_plan && a.fecha_fin_plan < hoy).length,
      }
    }
    return stats[o.id] || { total: 0, hechas: 0, bloq: 0, sinResp: 0, avance: o.avance_global || 0, vencidas: 0 }
  }
  const avanceDeObra = (o: ObraData) => statsDe(o).avance
  const activas = obras.filter(o => o.status === 'en_ejecucion').length
  const pendientesEntrega = obras.filter(o => o.status === 'entrega_pendiente').length
  const bloqueadas = obras.reduce((s, o) => s + statsDe(o).bloq, 0)
  const enCurso = obras.filter(o => o.status === 'en_ejecucion')
  const avgAvance = enCurso.length ? enCurso.reduce((s, o) => s + avanceDeObra(o), 0) / enCurso.length : 0
  const sinResponsable = obras.reduce((s, o) => s + statsDe(o).sinResp, 0)
  const atrasadas = obras.filter(o => o.status !== 'completada' && o.fecha_fin_plan && o.fecha_fin_plan < hoyISO()).length

  if (obra) {
    return <ObraDetail
      obra={obra}
      instaladores={instaladores}
      hideMoney={hideMoney}
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
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Obras activas" value={activas} icon={<HardHat size={16} />} />
        <KpiCard label="Entrega pendiente" value={pendientesEntrega} color="#D97706" icon={<FileText size={16} />} />
        <KpiCard label="Obras atrasadas" value={atrasadas} color={atrasadas > 0 ? '#DC2626' : '#10B981'} icon={<Clock size={16} />} />
        <KpiCard label="Actividades bloqueadas" value={bloqueadas} color="#DC2626" icon={<AlertTriangle size={16} />} />
        <KpiCard label="Tareas sin responsable" value={sinResponsable} color={sinResponsable > 0 ? '#D97706' : '#10B981'} icon={<Users size={16} />} />
        <KpiCard label="Avance promedio (activas)" value={`${Math.round(avgAvance)}%`} color="#2563EB" icon={<TrendingUp size={16} />} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #222', marginBottom: 20 }}>
        {([
          { key: 'dashboard' as Tab, label: 'Panel', icon: TrendingUp },
          { key: 'obras' as Tab, label: 'Obras', icon: HardHat },
          { key: 'planeacion' as Tab, label: 'Planeación semanal', icon: Calendar },
          { key: 'instaladores' as Tab, label: 'Equipo de instalación', icon: Users },
        ]).map(({ key, label, icon: Icon }) => {
          const active = tab === key
          return (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '8px 14px', fontSize: 12, fontWeight: active ? 600 : 400,
              color: active ? '#10B981' : '#666',
              background: active ? 'rgba(87,255,154,0.08)' : 'transparent',
              border: 'none', borderBottom: active ? '2px solid #10B981' : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'inherit', borderRadius: '8px 8px 0 0',
            }}>
              <Icon size={13} style={{ marginRight: 6 }} />{label}
            </button>
          )
        })}
      </div>

      {tab === 'dashboard' && <TabCoordinacion obras={obras} onOpenObra={(id) => setSelectedObra(id)} />}

      {tab === 'obras' && (
        <div>
          {obras.length === 0 && !loading ? <EmptyState message="No hay obras registradas" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {obras.map(o => {
                const st = STATUS_CONFIG[o.status]
                const es = statsDe(o)
                const bloq = es.bloq
                const pct = avanceDeObra(o)
                const sem = semaforoObra({ fecha_fin_plan: o.fecha_fin_plan, status: o.status })
                return (
                  <div key={o.id} onClick={() => setSelectedObra(o.id)} style={{
                    ...cardStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16,
                    transition: 'border-color 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#10B98133')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#222')}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{o.nombre}</span>
                        <Badge label={st.label} color={st.color} />
                        {bloq > 0 && <Badge label={`${bloq} bloqueada${bloq > 1 ? 's' : ''}`} color="#DC2626" />}
                        {sem && <Badge label={sem.label} color={sem.color} />}
                        {!o.latitude && <Badge label="Sin ubicación" color="#6B7280" />}
                      </div>
                      <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                        {o.cliente} · {o.coordinador} · {o.direccion}
                      </div>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <span>{es.hechas}/{es.total} tareas</span>
                        {!!es.sinResp && <span style={{ color: '#D97706' }}>{es.sinResp} sin responsable</span>}
                        {!!es.vencidas && <span style={{ color: '#DC2626' }}>{es.vencidas} tareas vencidas</span>}
                        {o.fecha_inicio
                          ? <span>Inició {formatDate(o.fecha_inicio)} · {diasEntre(o.fecha_inicio, hoyISO())} d en obra</span>
                          : <span style={{ color: '#D97706' }}>Sin fecha de inicio</span>}
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
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{pct}%</div>
                      <ProgressBar pct={pct} />
                      {!hideMoney && <div style={{ fontSize: 10, color: '#555', marginTop: 6 }}>{F(o.valor_contrato)}</div>}
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

      {tab === 'planeacion' && <TabPlaneacion obras={obras} instaladores={instaladores} hideMoney={hideMoney} />}

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

function ObraDetail({ obra, instaladores, hideMoney, onBack, updateObra }: {
  obra: ObraData
  instaladores: Instalador[]
  hideMoney?: boolean
  onBack: () => void
  updateObra: (updater: (o: ObraData) => ObraData) => void
}) {
  const isMobile = useIsMobile()
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
          ai_actividades_sugeridas: (r.ai_actividades_sugeridas || undefined) as any,
          ai_pendientes: (r.ai_pendientes || undefined) as any,
          sugerencias_aplicadas: r.sugerencias_aplicadas || false,
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
  const sinResponsable = obra.actividades.filter(a => !a.instalador_id).length
  const docsRecibidos = obra.entrega_docs.filter(d => d.recibido).length
  // Avance calculado, no el guardado
  const avanceReal = hydrated ? avanceDe(obra.actividades) : (obra.avance_global || 0)
  const sem = semaforoObra({ fecha_fin_plan: obra.fecha_fin_plan, status: obra.status })

  // Cambio de estado con las fechas que le corresponden a cada transición.
  async function cambiarStatus(nuevo: ObraStatus) {
    if (nuevo === obra.status) return
    const patch: any = { status: nuevo }
    if (nuevo === 'en_ejecucion' && !obra.fecha_inicio) patch.fecha_inicio = hoyISO()
    if (nuevo === 'completada' && !obra.fecha_fin_real) patch.fecha_fin_real = hoyISO()
    if (nuevo !== 'completada' && obra.fecha_fin_real) patch.fecha_fin_real = null
    updateObra(o => ({
      ...o, status: nuevo,
      fecha_inicio: patch.fecha_inicio || o.fecha_inicio,
      fecha_fin_real: patch.fecha_fin_real === null ? undefined : (patch.fecha_fin_real || o.fecha_fin_real),
    }))
    const { error } = await supabase.from('obras').update(patch).eq('id', obra.id)
    if (error) setSyncError('Error al cambiar estado: ' + error.message)
    else setSyncError(null)
  }

  // Guarda campos sueltos de la ficha (fechas, ubicación)
  async function guardarFicha(patch: Record<string, any>) {
    updateObra(o => ({ ...o, ...patch }))
    const { error } = await supabase.from('obras').update(patch).eq('id', obra.id)
    if (error) setSyncError('Error al guardar: ' + error.message)
    else setSyncError(null)
  }

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
            <Btn size="sm" variant="primary" onClick={() => cambiarStatus('en_ejecucion')}>
              <CheckCircle size={11} /> Arrancar obra
            </Btn>
          )}
          {/* Ciclo completo: la obra ya puede pausarse y cerrarse, no solo arrancar */}
          <select value={obra.status} onChange={e => cambiarStatus(e.target.value as ObraStatus)}
            title="Estado de la obra"
            style={{ padding: '4px 8px', fontSize: 11, background: '#0a0a0a', border: `1px solid ${st.color}55`, borderRadius: 6, color: st.color, fontFamily: 'inherit', cursor: 'pointer' }}>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{obra.cliente} · <MapPin size={11} style={{ verticalAlign: 'middle' }} /> {obra.direccion} · Coord: {obra.coordinador}</span>
          {obra.cotizacion_ref && <span>· Cot: {obra.cotizacion_ref}</span>}
          {obra.fecha_inicio && <span style={{ color: '#888' }}>· <Clock size={11} style={{ verticalAlign: 'middle' }} /> {diasEntre(obra.fecha_inicio, hoyISO())} d en obra</span>}
          {sem && <Badge label={sem.label} color={sem.color} />}
        </div>
      </div>

      <FichaObra obra={obra} onGuardar={guardarFicha} />

      <ProximasEntregas obraId={obra.id} />

      {/* La obra nunca llegaba a "completada": aquí es donde se cierra. */}
      {hydrated && obra.actividades.length > 0 && avanceReal === 100 && obra.status !== 'completada' && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.25)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <CheckCircle2 size={15} color="#2563EB" />
          <span style={{ fontSize: 12, color: '#93c5fd', flex: 1 }}>
            Las {obra.actividades.length} actividades están al 100%. Si ya se entregó, ciérrala para que salga del tablero de obras activas.
          </span>
          <Btn size="sm" variant="primary" onClick={() => cambiarStatus('completada')}>
            <CheckCircle size={11} /> Cerrar obra
          </Btn>
        </div>
      )}

      {syncError && (
        <div style={{ marginBottom: 16, padding: '10px 12px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 8, color: '#f87171', fontSize: 12, display: 'flex', gap: 8 }}>
          <span>⚠</span><span>{syncError}</span>
        </div>
      )}
      {!hydrated && <div style={{ marginBottom: 16 }}><Loading /></div>}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : `repeat(${hideMoney ? 4 : 5}, 1fr)`, gap: 12, marginBottom: 20 }}>
        <KpiCard label="Avance global" value={`${avanceReal}%`} icon={<TrendingUp size={16} />} />
        <KpiCard label="Actividades" value={`${completadas}/${obra.actividades.length}`} color="#2563EB" icon={<ClipboardList size={16} />} />
        <KpiCard label={bloqueadas > 0 ? 'Bloqueadas' : 'Sin responsable'} value={bloqueadas > 0 ? bloqueadas : sinResponsable}
          color={bloqueadas > 0 ? '#DC2626' : sinResponsable > 0 ? '#D97706' : '#10B981'} icon={<AlertTriangle size={16} />} />
        <KpiCard label="Documentos" value={`${docsRecibidos}/${obra.entrega_docs.length}`} color="#D97706" icon={<FileText size={16} />} />
        {!hideMoney && <KpiCard label="Contrato" value={F(obra.valor_contrato)} color="#A78BFA" icon={<HardHat size={16} />} />}
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
              color: active ? '#10B981' : '#666',
              background: active ? 'rgba(87,255,154,0.08)' : 'transparent',
              border: 'none', borderBottom: active ? '2px solid #10B981' : '2px solid transparent',
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
      {subTab === 'materiales' && <MaterialesObra obra={obra as any} onLinked={(cotId) => updateObra(o => ({ ...o, cotizacion_id: cotId }))} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   SugerenciasCierre — "según este reporte, estas actividades ya están
   terminadas". Se confirman de un clic (todas o una por una). Nunca se
   aplican solas: el avance de la obra no puede moverse por cómo quedó
   redactado un reporte de campo.
   ═══════════════════════════════════════════════════════════════════ */

function SugerenciasCierre({ reporte, obra, updateObra }: {
  reporte: ReporteObra
  obra: ObraData
  updateObra: (fn: (o: ObraData) => ObraData) => void
}) {
  const [aplicando, setAplicando] = useState(false)
  const [hechas, setHechas] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [oculto, setOculto] = useState(!!reporte.sugerencias_aplicadas)

  const sugeridas = (reporte.ai_actividades_sugeridas || [])
    // Si la actividad ya se cerró por otro lado, la propuesta sobra.
    .filter(sg => {
      const a = obra.actividades.find(x => x.id === sg.actividad_id)
      return a ? a.status !== 'completada' : false
    })
    .filter(sg => !hechas.has(sg.actividad_id))

  if (oculto || sugeridas.length === 0) return null

  async function aplicar(lista: ActividadSugerida[]) {
    if (lista.length === 0) return
    setAplicando(true); setError('')
    const hoy = hoyISO()
    try {
      for (const sg of lista) {
        const completa = sg.porcentaje >= 100
        const patch: any = { porcentaje: sg.porcentaje, status: completa ? 'completada' : 'en_progreso' }
        if (completa) patch.fecha_fin_real = hoy
        const { error: e } = await supabase.from('obra_actividades').update(patch).eq('id', sg.actividad_id)
        if (e) throw e
      }
      const ids = new Set(lista.map(l => l.actividad_id))
      updateObra(o => {
        const nuevas = o.actividades.map(a => {
          const sg = lista.find(l => l.actividad_id === a.id)
          if (!sg) return a
          return {
            ...a,
            porcentaje: sg.porcentaje,
            status: (sg.porcentaje >= 100 ? 'completada' : 'en_progreso') as ActividadStatus,
            fecha_fin_real: sg.porcentaje >= 100 ? hoy : a.fecha_fin_real,
          }
        })
        return { ...o, actividades: nuevas, avance_global: avanceDe(nuevas) }
      })
      const nuevas = obra.actividades.map(a => {
        const sg = lista.find(l => l.actividad_id === a.id)
        return sg ? { ...a, porcentaje: sg.porcentaje, status: (sg.porcentaje >= 100 ? 'completada' : 'en_progreso') as ActividadStatus } : a
      })
      await supabase.from('obras').update({ avance_global: avanceDe(nuevas) }).eq('id', obra.id)
      setHechas(prev => { const n = new Set(prev); ids.forEach(i => n.add(i)); return n })
      if (lista.length === sugeridas.length) {
        await supabase.from('obra_reportes').update({ sugerencias_aplicadas: true }).eq('id', reporte.id)
        setOculto(true)
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    }
    setAplicando(false)
  }

  return (
    <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(16,185,129,0.05)', borderRadius: 8, border: '1px solid rgba(16,185,129,0.22)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <CheckCircle2 size={13} color="#10B981" />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#4ADE80' }}>
          Según este reporte, {sugeridas.length} actividad{sugeridas.length === 1 ? '' : 'es'} ya {sugeridas.length === 1 ? 'está lista' : 'están listas'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Btn size="sm" variant="primary" disabled={aplicando} onClick={() => aplicar(sugeridas)}>
            {aplicando ? <Loader2 size={10} /> : <CheckCircle size={10} />} Confirmar todas
          </Btn>
          <Btn size="sm" variant="default" disabled={aplicando} onClick={async () => {
            setOculto(true)
            await supabase.from('obra_reportes').update({ sugerencias_aplicadas: true }).eq('id', reporte.id)
          }}>Descartar</Btn>
        </div>
      </div>
      {sugeridas.map(sg => (
        <div key={sg.actividad_id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', borderTop: '1px solid rgba(16,185,129,0.12)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#ddd' }}>
              {sg.descripcion}
              {sg.area && <span style={{ color: '#666' }}> — {sg.area}</span>}
            </div>
            {sg.evidencia && <div style={{ fontSize: 10, color: '#777', fontStyle: 'italic', marginTop: 2 }}>«{sg.evidencia}»</div>}
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: sg.porcentaje >= 100 ? '#10B981' : '#D97706', minWidth: 34, textAlign: 'right' }}>
            {sg.porcentaje}%
          </span>
          {typeof sg.confianza === 'number' && (
            <span title="Qué tan segura está la IA" style={{ fontSize: 9, color: sg.confianza >= 0.75 ? '#10B981' : '#D97706', minWidth: 28 }}>
              {Math.round(sg.confianza * 100)}%
            </span>
          )}
          <Btn size="sm" variant="default" disabled={aplicando} onClick={() => aplicar([sg])}>Confirmar</Btn>
        </div>
      ))}
      {error && <div style={{ fontSize: 10, color: '#f87171', marginTop: 6 }}>⚠ {error}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   FICHA DE OBRA — fechas, atraso y ubicación para la checada en campo
   ═══════════════════════════════════════════════════════════════════ */

function FichaObra({ obra, onGuardar }: {
  obra: ObraData
  onGuardar: (patch: Record<string, any>) => Promise<void> | void
}) {
  const isMobile = useIsMobile()
  const [abierto, setAbierto] = useState(false)
  const [urlMaps, setUrlMaps] = useState(obra.google_maps_url || '')
  const [avisoMaps, setAvisoMaps] = useState('')
  const [localizando, setLocalizando] = useState(false)

  const faltantes: string[] = []
  if (!obra.fecha_inicio) faltantes.push('fecha de inicio')
  if (!obra.fecha_fin_plan) faltantes.push('fecha compromiso')
  if (obra.latitude == null || obra.longitude == null) faltantes.push('ubicación')

  const dias = obra.fecha_inicio ? diasEntre(obra.fecha_inicio, obra.fecha_fin_real || hoyISO()) : null
  const sem = semaforoObra({ fecha_fin_plan: obra.fecha_fin_plan, status: obra.status })

  function aplicarUrl(v: string) {
    setUrlMaps(v)
    const c = coordsDeUrl(v)
    if (!v.trim()) { setAvisoMaps(''); return }
    if (c) {
      setAvisoMaps(`Coordenadas detectadas: ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`)
      onGuardar({ google_maps_url: v.trim(), latitude: c.lat, longitude: c.lng, ...(obra.radio_checada_metros == null ? { radio_checada_metros: 500 } : {}) })
    } else {
      setAvisoMaps('No pude leer coordenadas de ese texto. Pega el link de Google Maps o escribe "19.4326, -99.1332".')
    }
  }

  function usarMiUbicacion() {
    if (!navigator.geolocation) { setAvisoMaps('Este navegador no da ubicación.'); return }
    setLocalizando(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocalizando(false)
        const lat = Number(pos.coords.latitude.toFixed(6)), lng = Number(pos.coords.longitude.toFixed(6))
        setAvisoMaps(`Coordenadas tomadas de tu dispositivo: ${lat}, ${lng}`)
        onGuardar({ latitude: lat, longitude: lng, ...(obra.radio_checada_metros == null ? { radio_checada_metros: 500 } : {}) })
      },
      err => { setLocalizando(false); setAvisoMaps('No se pudo obtener la ubicación: ' + err.message) },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const campo: React.CSSProperties = { ...inputStyle, padding: '5px 8px', fontSize: 11 }

  return (
    <div style={{ ...cardStyle, padding: 0, marginBottom: 16, overflow: 'hidden' }}>
      <button onClick={() => setAbierto(v => !v)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
      }}>
        <ChevronDown size={14} color="#666" style={{ transform: abierto ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>Ficha de la obra</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {obra.fecha_inicio
            ? <span style={{ fontSize: 10, color: '#888' }}>Inicio {formatDate(obra.fecha_inicio)}{dias != null ? ` · ${dias} d` : ''}</span>
            : <Badge label="Sin fecha de inicio" color="#D97706" />}
          {obra.fecha_fin_plan
            ? sem && <Badge label={sem.label} color={sem.color} />
            : <Badge label="Sin fecha compromiso" color="#D97706" />}
          {obra.latitude == null && <Badge label="Sin ubicación (no hay checada)" color="#6B7280" />}
          {obra.fecha_fin_real && <Badge label={`Entregada ${formatDate(obra.fecha_fin_real)}`} color="#2563EB" />}
        </div>
        {!abierto && faltantes.length > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#D97706' }}>Falta capturar: {faltantes.join(', ')}</span>
        )}
      </button>

      {abierto && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid #222' }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap: 10, marginTop: 12 }}>
            <div>
              <div style={labelStyle}>Fecha de inicio en obra</div>
              <input type="date" value={obra.fecha_inicio || ''} style={campo}
                onChange={e => onGuardar({ fecha_inicio: e.target.value || null })} />
            </div>
            <div>
              <div style={labelStyle}>Fecha compromiso de entrega</div>
              <input type="date" value={obra.fecha_fin_plan || ''} style={campo}
                onChange={e => onGuardar({ fecha_fin_plan: e.target.value || null })} />
            </div>
            <div>
              <div style={labelStyle}>Fecha real de entrega</div>
              <input type="date" value={obra.fecha_fin_real || ''} style={campo}
                onChange={e => onGuardar({ fecha_fin_real: e.target.value || null })} />
            </div>
            <div>
              <div style={labelStyle}>Días en obra</div>
              <div style={{ ...campo, color: dias == null ? '#555' : '#fff', display: 'flex', alignItems: 'center' }}>
                {dias == null ? 'Captura la fecha de inicio' : `${dias} día${dias === 1 ? '' : 's'}`}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: '#ccc', margin: '16px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <MapPin size={12} color="#10B981" /> Ubicación para la checada de la app de obra
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr 1fr', gap: 10 }}>
            <div>
              <div style={labelStyle}>Dirección completa</div>
              {/* No controlado a propósito: se guarda al salir del campo, no en cada tecla */}
              <input defaultValue={obra.direccion_completa || ''} placeholder="Calle, número, colonia, CP" style={campo}
                key={'dir-' + obra.id}
                onBlur={e => { if (e.target.value !== (obra.direccion_completa || '')) onGuardar({ direccion_completa: e.target.value || null }) }} />
            </div>
            <div>
              <div style={labelStyle}>Latitud</div>
              <input type="number" step="0.000001" defaultValue={obra.latitude ?? ''} style={campo} key={'lat-' + obra.id + '-' + String(obra.latitude)}
                onBlur={e => onGuardar({ latitude: e.target.value === '' ? null : Number(e.target.value) })} />
            </div>
            <div>
              <div style={labelStyle}>Longitud</div>
              <input type="number" step="0.000001" defaultValue={obra.longitude ?? ''} style={campo} key={'lng-' + obra.id + '-' + String(obra.longitude)}
                onBlur={e => onGuardar({ longitude: e.target.value === '' ? null : Number(e.target.value) })} />
            </div>
            <div>
              <div style={labelStyle}>Radio de checada (m)</div>
              {/* La app de obra usa 500 m cuando este campo está vacío */}
              <input type="number" step="10" min={20} placeholder="500" defaultValue={obra.radio_checada_metros ?? ''} style={campo} key={'rad-' + obra.id + '-' + String(obra.radio_checada_metros)}
                onBlur={e => onGuardar({ radio_checada_metros: e.target.value === '' ? null : Number(e.target.value) })} />
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={labelStyle}>Pega el link de Google Maps (o "lat, lng") y lleno las coordenadas solo</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={urlMaps} onChange={e => setUrlMaps(e.target.value)}
                onBlur={e => aplicarUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') aplicarUrl((e.target as HTMLInputElement).value) }}
                placeholder="https://maps.google.com/... o 19.4326, -99.1332"
                style={{ ...campo, flex: 1, minWidth: 240 }} />
              <Btn size="sm" variant="default" onClick={usarMiUbicacion} disabled={localizando}>
                {localizando ? <Loader2 size={11} /> : <MapPin size={11} />} Usar mi ubicación
              </Btn>
              {obra.latitude != null && obra.longitude != null && (
                <a href={`https://www.google.com/maps?q=${obra.latitude},${obra.longitude}`} target="_blank" rel="noreferrer"
                  style={{ fontSize: 11, color: '#10B981', alignSelf: 'center', textDecoration: 'none' }}>Ver en el mapa ↗</a>
              )}
            </div>
            {avisoMaps && <div style={{ fontSize: 10, color: avisoMaps.startsWith('Coordenadas') ? '#10B981' : '#D97706', marginTop: 6 }}>{avisoMaps}</div>}
            <div style={{ fontSize: 10, color: '#555', marginTop: 6 }}>
              Sin latitud y longitud la app de obra no puede validar que el instalador esté en el sitio: la checada se queda sin geocerca.
            </div>
          </div>
        </div>
      )}
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
  const [statusFilter, setStatusFilter] = useState<'all' | ActividadStatus | 'sin_resp' | 'vencidas'>('all')
  const [generating, setGenerating] = useState(false)
  const [genStatus, setGenStatus] = useState('')
  const [showWizard, setShowWizard] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [bulkInst, setBulkInst] = useState('')
  const [bulkFecha, setBulkFecha] = useState('')
  const [asignando, setAsignando] = useState(false)

  // Asigna responsable y/o fecha compromiso a todas las tareas seleccionadas
  // de un solo golpe: repartir 100+ tareas una por una no era viable.
  const asignarMasivo = async () => {
    const ids = Array.from(selected)
    if (!ids.length) return
    const patch: any = {}
    if (bulkInst) patch.instalador_id = bulkInst === '__none__' ? null : bulkInst
    if (bulkFecha) patch.fecha_fin_plan = bulkFecha
    if (!Object.keys(patch).length) { alert('Elige un responsable o una fecha para aplicar.'); return }
    setAsignando(true)
    const { error } = await supabase.from('obra_actividades').update(patch).in('id', ids)
    setAsignando(false)
    if (error) { alert('Error al asignar: ' + error.message); return }
    updateObra(o => ({
      ...o,
      actividades: o.actividades.map(a => ids.includes(a.id) ? {
        ...a,
        instalador_id: bulkInst ? (bulkInst === '__none__' ? undefined : bulkInst) : a.instalador_id,
        fecha_fin_plan: bulkFecha || a.fecha_fin_plan,
      } : a),
    }))
    setSelected(new Set())
    setBulkInst(''); setBulkFecha('')
  }

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
    // El status y el porcentaje tienen que contar la misma historia: si marcas
    // una tarea como completada desde el selector, su avance es 100 (antes se
    // quedaba en 0 y el avance de la obra salía mal).
    if (updates.status !== undefined && updates.porcentaje === undefined) {
      if (updates.status === 'completada') {
        updates = { ...updates, porcentaje: 100, fecha_fin_real: updates.fecha_fin_real || hoyISO() }
      } else if (updates.status === 'pendiente') {
        updates = { ...updates, porcentaje: 0, fecha_fin_real: undefined }
      }
    }
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
    const nuevasActs = obra.actividades.map(a => a.id === actId ? { ...a, ...updates } : a)
    const avance = avanceDe(nuevasActs)
    updateObra(o => ({
      ...o,
      actividades: o.actividades.map(a => a.id === actId ? { ...a, ...updates } : a),
      avance_global: avanceDe(o.actividades.map(a => a.id === actId ? { ...a, ...updates } : a)),
    }))
    const { error } = await supabase.from('obra_actividades').update(dbUpdates).eq('id', actId)
    if (error) {
      console.error('Error actualizando actividad:', error)
      alert('Error al actualizar: ' + error.message)
    }
    // La columna es solo cache para otros módulos; la vista ya usa el calculado.
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

  // Filter + Group activities
  const hoy = hoyISO()
  const filteredActs =
    statusFilter === 'all' ? obra.actividades
    : statusFilter === 'sin_resp' ? obra.actividades.filter(a => !a.instalador_id)
    : statusFilter === 'vencidas' ? obra.actividades.filter(a => a.status !== 'completada' && a.fecha_fin_plan && a.fecha_fin_plan < hoy)
    : obra.actividades.filter(a => a.status === statusFilter)
  const grouped = new Map<string, Actividad[]>()
  filteredActs.forEach(a => {
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
          {genStatus && <span style={{ fontSize: 10, color: genStatus.startsWith('✓') ? '#10B981' : genStatus.startsWith('Error') ? '#DC2626' : '#888' }}>{genStatus}</span>}
          {obra.cotizacion_id && (
            <Btn size="sm" variant="default" onClick={handleAutogenerar} disabled={generating}>
              {generating ? <><Loader2 size={12} /> Generando...</> : <>🤖 Autogenerar desde cotización</>}
            </Btn>
          )}
          <Btn size="sm" variant="primary" onClick={() => setShowNew(true)}><Plus size={12} /> Nueva actividad</Btn>
        </div>
      </div>

      {/* Status filter */}
      {obra.actividades.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {([
            { key: 'all' as const, label: 'Todas', color: '#888', count: obra.actividades.length },
            { key: 'pendiente' as const, label: 'Pendientes', color: ACT_STATUS_CONFIG.pendiente.color, count: obra.actividades.filter(a => a.status === 'pendiente').length },
            { key: 'en_progreso' as const, label: 'En progreso', color: ACT_STATUS_CONFIG.en_progreso.color, count: obra.actividades.filter(a => a.status === 'en_progreso').length },
            { key: 'bloqueada' as const, label: 'Bloqueadas', color: ACT_STATUS_CONFIG.bloqueada.color, count: obra.actividades.filter(a => a.status === 'bloqueada').length },
            { key: 'completada' as const, label: 'Completadas', color: ACT_STATUS_CONFIG.completada.color, count: obra.actividades.filter(a => a.status === 'completada').length },
            { key: 'sin_resp' as const, label: 'Sin responsable', color: '#D97706', count: obra.actividades.filter(a => !a.instalador_id).length },
            { key: 'vencidas' as const, label: 'Vencidas', color: '#DC2626', count: obra.actividades.filter(a => a.status !== 'completada' && a.fecha_fin_plan && a.fecha_fin_plan < hoy).length },
          ]).map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              style={{
                padding: '4px 10px', fontSize: 10, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                background: statusFilter === f.key ? `${f.color}18` : 'transparent',
                border: statusFilter === f.key ? `1px solid ${f.color}40` : '1px solid #222',
                color: statusFilter === f.key ? f.color : '#555',
                fontWeight: statusFilter === f.key ? 600 : 400,
              }}>
              {f.label} ({f.count})
            </button>
          ))}
          {/* Select all / bulk actions */}
          {filteredActs.length > 0 && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: '#666' }}>
                <input type="checkbox"
                  checked={selected.size === filteredActs.length && filteredActs.length > 0}
                  onChange={() => {
                    if (selected.size === filteredActs.length) setSelected(new Set())
                    else setSelected(new Set(filteredActs.map(a => a.id)))
                  }}
                  style={{ accentColor: '#10B981' }} />
                Sel. todo ({filteredActs.length})
              </label>
              {selected.size > 0 && (
                <>
                  <select value={bulkInst} onChange={e => setBulkInst(e.target.value)} title="Responsable para las tareas seleccionadas"
                    style={{ padding: '3px 6px', fontSize: 10, background: '#0a0a0a', border: '1px solid #333', borderRadius: 4, color: bulkInst ? '#10B981' : '#666', fontFamily: 'inherit', maxWidth: 140 }}>
                    <option value="">Responsable…</option>
                    {instaladores.map(i => <option key={i.id} value={i.id}>{i.nombre}</option>)}
                    <option value="__none__">— Quitar responsable —</option>
                  </select>
                  <input type="date" value={bulkFecha} onChange={e => setBulkFecha(e.target.value)} title="Fecha compromiso para las tareas seleccionadas"
                    style={{ padding: '3px 6px', fontSize: 10, background: '#0a0a0a', border: '1px solid #333', borderRadius: 4, color: bulkFecha ? '#fff' : '#666', fontFamily: 'inherit' }} />
                  <Btn size="sm" variant="primary" disabled={asignando} onClick={asignarMasivo}>
                    {asignando ? <Loader2 size={10} /> : <Users size={10} />} Asignar ({selected.size})
                  </Btn>
                </>
              )}
              {selected.size > 0 && (
                <Btn size="sm" variant="default" disabled={deleting} onClick={async () => {
                  if (!confirm(`¿Eliminar ${selected.size} tarea${selected.size > 1 ? 's' : ''}?`)) return
                  setDeleting(true)
                  const ids = Array.from(selected)
                  const { error } = await supabase.from('obra_actividades').delete().in('id', ids)
                  if (error) { alert('Error: ' + error.message); setDeleting(false); return }
                  updateObra(o => ({ ...o, actividades: o.actividades.filter(a => !ids.includes(a.id)), avance_global: avanceDe(o.actividades.filter(a => !ids.includes(a.id))) }))
                  supabase.from('obras').update({ avance_global: avanceDe(obra.actividades.filter(a => !ids.includes(a.id))) }).eq('id', obra.id)
                  setSelected(new Set())
                  setDeleting(false)
                }}>
                  {deleting ? <Loader2 size={10} /> : <X size={10} />} Eliminar ({selected.size})
                </Btn>
              )}
            </div>
          )}
        </div>
      )}

      {/* New activity form */}
      {showNew && (
        <div style={{ ...cardStyle, borderColor: '#10B98133' }}>
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
          const avgPct = avanceDe(acts)
          const sinResp = acts.filter(a => !a.instalador_id).length
          return (
            <div key={groupKey} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Icon size={14} color={groupColor} />
                <span style={{ fontSize: 13, fontWeight: 600, color: groupColor }}>{isSystemGroup ? cfg?.label || groupKey : groupKey}</span>
                <span style={{ fontSize: 11, color: '#555' }}>{acts.length} tarea{acts.length > 1 ? 's' : ''} · {avgPct}%</span>
                {sinResp > 0 && <span style={{ fontSize: 10, color: '#D97706' }}>{sinResp} sin responsable</span>}
              </div>
              {acts.map(a => {
                const actSt = ACT_STATUS_CONFIG[a.status]
                const inst = instaladores.find(i => i.id === a.instalador_id)
                const aSistCfg = SISTEMAS_CONFIG[a.sistema]
                return (
                  <div key={a.id} style={{ ...cardStyle, padding: 12, marginBottom: 6, borderLeft: `3px solid ${actSt.color}`, background: selected.has(a.id) ? 'rgba(87,255,154,0.04)' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="checkbox" checked={selected.has(a.id)}
                        onChange={() => setSelected(prev => { const n = new Set(prev); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n })}
                        style={{ accentColor: '#10B981', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: '#ccc', marginBottom: 2 }}>{a.descripcion}</div>
                        <div style={{ fontSize: 10, color: '#555', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          {!isSystemGroup && aSistCfg && <span style={{ color: aSistCfg.color }}>{aSistCfg.label}</span>}
                          {isSystemGroup && a.area && <span style={{ color: '#888' }}>📍 {a.area}</span>}
                          {inst && <span><Users size={10} style={{ verticalAlign: 'middle' }} /> {inst.nombre}</span>}
                          {!inst && <span style={{ color: '#D97706' }}><Users size={10} style={{ verticalAlign: 'middle' }} /> Sin responsable</span>}
                          {a.fecha_fin_plan && (() => {
                            const vencida = a.status !== 'completada' && a.fecha_fin_plan < hoy
                            return <span style={{ color: vencida ? '#DC2626' : undefined }}><Calendar size={10} style={{ verticalAlign: 'middle' }} /> {formatDate(a.fecha_fin_plan)}{vencida ? ' · vencida' : ''}</span>
                          })()}
                        </div>
                        {a.bloqueo && (
                          <div style={{ fontSize: 10, color: '#DC2626', marginTop: 4, padding: '3px 8px', background: 'rgba(239,68,68,0.06)', borderRadius: 4 }}>
                            <AlertTriangle size={10} style={{ verticalAlign: 'middle' }} /> {a.bloqueo}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 320, flexWrap: 'wrap' }}>
                        <select value={a.instalador_id || ''}
                          onChange={e => updateActividad(a.id, { instalador_id: e.target.value || undefined } as any)}
                          title="Asignar instalador"
                          style={{ padding: '3px 6px', fontSize: 10, background: '#0a0a0a', border: '1px solid #333', borderRadius: 4, color: a.instalador_id ? '#10B981' : '#555', fontFamily: 'inherit', maxWidth: 110 }}
                        >
                          <option value="">Sin asignar</option>
                          {instaladores.map(i => <option key={i.id} value={i.id}>{i.nombre}</option>)}
                        </select>
                        <div style={{ width: 50 }}>
                          <ProgressBar pct={a.porcentaje} color={actSt.color} />
                          <div style={{ fontSize: 9, color: '#666', textAlign: 'center', marginTop: 1 }}>{a.porcentaje}%</div>
                        </div>
                        <input type="range" min={0} max={100} step={5} value={a.porcentaje}
                          onChange={e => updateActividad(a.id, {
                            porcentaje: Number(e.target.value),
                            status: Number(e.target.value) >= 100 ? 'completada' : Number(e.target.value) > 0 ? 'en_progreso' : 'pendiente',
                            fecha_fin_real: Number(e.target.value) >= 100 ? new Date().toISOString().substring(0, 10) : undefined,
                          })}
                          style={{ width: 70, accentColor: actSt.color }}
                        />
                        <select value={a.status}
                          onChange={e => updateActividad(a.id, { status: e.target.value as ActividadStatus })}
                          style={{ padding: '3px 6px', fontSize: 10, background: '#0a0a0a', border: '1px solid #333', borderRadius: 4, color: actSt.color, fontFamily: 'inherit' }}
                        >
                          {Object.entries(ACT_STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        <button title="Eliminar tarea" onClick={async () => {
                          if (!confirm('¿Eliminar esta tarea?')) return
                          const { error } = await supabase.from('obra_actividades').delete().eq('id', a.id)
                          if (error) { alert('Error: ' + error.message); return }
                          updateObra(o => ({ ...o, actividades: o.actividades.filter(x => x.id !== a.id), avance_global: avanceDe(o.actividades.filter(x => x.id !== a.id)) }))
                          supabase.from('obras').update({ avance_global: avanceDe(obra.actividades.filter(x => x.id !== a.id)) }).eq('id', obra.id)
                        }} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', padding: 2 }}>
                          <X size={12} />
                        </button>
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
  const isMobile = useIsMobile()
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

      const response = await fetch('/api/anthropic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 16000,
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
      const parsed = extractJsonArray(text)

      if (!parsed) {
        const stop = data?.stop_reason ? ` [stop: ${data.stop_reason}]` : ''
        console.error('Autogen tareas — respuesta sin JSON parseable:', JSON.stringify(data).slice(0, 1500))
        addAI('No pude parsear la respuesta.' + stop + '\n\nLo que devolvió el modelo:\n' + (text ? text.slice(0, 500) : '(vacío — ' + JSON.stringify(data).slice(0, 300) + ')'))
        setPhase('confirm')
        return
      }
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
    background: '#111', border: '1px solid #222', borderRadius: isMobile ? 0 : 16, width: isMobile ? '100vw' : 580,
    height: isMobile ? '100vh' : 'auto', maxHeight: isMobile ? '100vh' : '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
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
              fontSize: 12, color: m.role === 'user' ? '#10B981' : '#ccc',
              lineHeight: 1.5, whiteSpace: 'pre-wrap',
            }}>
              {m.text}
            </div>
          ))}

          {/* Phase-specific UI */}
          {phase === 'loading' && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} color="#10B981" />
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
                      <input type="checkbox" checked={checked} onChange={() => toggleInst(inst.id)} style={{ accentColor: '#10B981' }} />
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
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} color="#10B981" />
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
   MODAL: REPORTE PARA CLIENTE / RESIDENTE / ARQUITECTO
   ═══════════════════════════════════════════════════════════════════ */

function ReporteClienteModal({ obra, instaladores, onClose }: {
  obra: ObraData; instaladores: Instalador[]; onClose: () => void
}) {
  const today = new Date().toISOString().substring(0, 10)
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString().substring(0, 10)
  const [dateFrom, setDateFrom] = useState(oneWeekAgo)
  const [dateTo, setDateTo] = useState(today)
  const [generating, setGenerating] = useState(false)

  // Sections toggle
  const [sections, setSections] = useState({
    avanceGlobal: true,
    avancePorSistema: true,
    actividadesCompletadas: true,
    actividadesEnProgreso: true,
    bloqueos: true,
    faltantes: true,
    inventario: true,
    reportesCampo: true,
    evidenciaFotos: true,
  })
  const toggleSection = (key: keyof typeof sections) => setSections(s => ({ ...s, [key]: !s[key] }))

  // Exclude specific items
  const [excludedReportes, setExcludedReportes] = useState<Set<string>>(new Set())
  const [excludedActs, setExcludedActs] = useState<Set<string>>(new Set())

  // Inventory data
  const [invItems, setInvItems] = useState<Array<{ name: string; system: string; qty_cotizado: number; qty_pedido: number; qty_entregado: number; qty_colocado: number }>>([])
  const [invLoading, setInvLoading] = useState(false)

  useEffect(() => {
    if (!obra.cotizacion_id) return
    setInvLoading(true)
    const projectId = obra.project_id || null
    Promise.all([
      supabase.from('quotation_items').select('id, name, system, quantity, type, catalog_product_id').eq('quotation_id', obra.cotizacion_id),
      projectId
        ? supabase.from('po_items').select('id, catalog_product_id, name, quantity, purchase_orders!inner(id, status, project_id)').eq('purchase_orders.project_id', projectId)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('delivery_items').select('id, product_id, description, qty, direction, obra_id').eq('obra_id', obra.id),
    ]).then(([qRes, poRes, delRes]: any[]) => {
      const cotItems = ((qRes.data || []) as any[]).filter((it: any) => it.type !== 'labor')
      const poItems = (poRes.data || []) as any[]
      const delItemsData = (delRes.data || []) as any[]

      const result = cotItems.map((ci: any) => {
        const pedido = poItems.filter((p: any) => p.catalog_product_id === ci.catalog_product_id).reduce((s: number, p: any) => s + (Number(p.quantity) || 0), 0)
        const entregado = delItemsData.filter((d: any) => d.product_id === ci.catalog_product_id && (d.direction === 'in_obra' || d.direction === 'out_bodega_to_obra')).reduce((s: number, d: any) => s + (Number(d.qty) || 0), 0)
        // "Colocado" = actividades completadas que mencionan este producto (approximate)
        const colocado = 0 // Will be estimated by AI from reportes
        return { name: ci.name, system: ci.system || 'General', qty_cotizado: ci.quantity, qty_pedido: pedido, qty_entregado: entregado, qty_colocado: colocado }
      })
      setInvItems(result)
      setInvLoading(false)
    })
  }, [obra.cotizacion_id, obra.project_id, obra.id])

  // Filter data by date range
  const reportesInRange = obra.reportes.filter(r => r.fecha >= dateFrom && r.fecha <= dateTo)
  const fotosInRange = reportesInRange.flatMap(r => r.fotos.map(f => ({ url: f, fecha: r.fecha, instalador: instaladores.find(i => i.id === r.instalador_id)?.nombre || '' })))

  // Activities completed in period (by fecha_fin_real)
  const completadasInRange = obra.actividades.filter(a => a.status === 'completada' && a.fecha_fin_real && a.fecha_fin_real >= dateFrom && a.fecha_fin_real <= dateTo)
  const enProgreso = obra.actividades.filter(a => a.status === 'en_progreso')
  const bloqueadas = obra.actividades.filter(a => a.status === 'bloqueada')

  // All AI data from reportes in range
  const allAvances = reportesInRange.flatMap(r => r.ai_avances || [])
  const allFaltantes = reportesInRange.flatMap(r => r.ai_faltantes || [])
  const allBloqueos = reportesInRange.flatMap(r => r.ai_bloqueos || [])

  const toggleReporte = (id: string) => {
    setExcludedReportes(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const toggleAct = (id: string) => {
    setExcludedActs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // Helper: format date for display
  const fd = (d: string) => { try { return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return d } }

  const generateReport = async () => {
    setGenerating(true)

    // ── Compute all data upfront ──
    const bySystem = new Map<string, { total: number; done: number; pct: number }>()
    obra.actividades.forEach(a => {
      const s = bySystem.get(a.sistema) || { total: 0, done: 0, pct: 0 }
      s.total++
      if (a.status === 'completada') s.done++
      s.pct = Math.round(obra.actividades.filter(x => x.sistema === a.sistema).reduce((sum, x) => sum + x.porcentaje, 0) / obra.actividades.filter(x => x.sistema === a.sistema).length)
      bySystem.set(a.sistema, s)
    })
    const completadas = completadasInRange.filter(a => !excludedActs.has(a.id))
    const progreso = enProgreso.filter(a => !excludedActs.has(a.id))
    const bloqueosList = [...bloqueadas.map(a => a.bloqueo || a.descripcion), ...allBloqueos]
    const reportesFiltered = reportesInRange.filter(r => !excludedReportes.has(r.id))
    const fotos = sections.evidenciaFotos ? fotosInRange.slice(0, 20) : []

    // ── Call AI only for summary text + next steps ──
    let aiResumen = ''
    let aiProximosPasos = ''
    try {
      const ctx = {
        obra: obra.nombre, cliente: obra.cliente, avance: obra.avance_global,
        completadas: completadas.length, enProgreso: progreso.length, bloqueadas: bloqueadas.length,
        bloqueos: bloqueosList.slice(0, 5),
        faltantes: allFaltantes.slice(0, 5),
        sistemas: Array.from(bySystem.entries()).map(([k, v]) => `${k}: ${v.pct}%`),
      }
      const response = await fetch('/api/anthropic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 2000,
          system: `Eres redactor de reportes de avance de obra para OMM Technologies (instalaciones especiales).
Genera DOS textos en español, profesional, orientado al cliente/residente/arquitecto:
1. "resumen": 2-3 oraciones resumiendo el avance del periodo. Tono positivo y proactivo.
2. "proximos_pasos": 3-5 bullet points de lo que viene a continuación.
Para bloqueos usa "Se requiere coordinación para..." o "Punto de atención:..."
NO incluyas costos ni nombres internos.
Devuelve SOLO un JSON: {"resumen":"...","proximos_pasos":["...","..."]}`,
          messages: [{ role: 'user', content: JSON.stringify(ctx) }],
        }),
      })
      if (response.ok) {
        const data = await response.json()
        const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        try {
          const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
          aiResumen = parsed.resumen || ''
          aiProximosPasos = (parsed.proximos_pasos || []).map((p: string) => `<li>${p}</li>`).join('')
        } catch { aiResumen = 'Reporte de avance de obra.' }
      }
    } catch { aiResumen = 'Reporte de avance de obra del periodo.' }

    // ── Build fixed HTML template ──
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    // System progress rows
    // ── Build HTML rows ──
    const systemRows = Array.from(bySystem.entries()).map(([sys, d]) => {
      const cfg = SISTEMAS_CONFIG[sys as Sistema]
      const barW = Math.max(d.pct, 2)
      return `<tr>
        <td class="tc">${cfg?.label || sys}</td>
        <td class="tc" style="text-align:center">${d.done}/${d.total}</td>
        <td class="tc" style="width:180px"><div class="bar-bg"><div class="bar-fill" style="width:${barW}%"></div><span class="bar-label">${d.pct}%</span></div></td>
      </tr>`
    }).join('')

    const completadasHTML = completadas.map(a => `<tr><td class="tc">${esc(a.descripcion)}</td><td class="tc">${a.sistema}</td><td class="tc">${a.area || ''}</td></tr>`).join('')
    const progresoHTML = progreso.map(a => `<tr><td class="tc">${esc(a.descripcion)}</td><td class="tc">${a.sistema}</td><td class="tc">${a.porcentaje}%</td></tr>`).join('')
    const bloqueosHTML = bloqueosList.map(b => `<li>${esc(b)}</li>`).join('')
    const faltantesHTML = allFaltantes.map(f => `<li>${esc(f)}</li>`).join('')

    const invBySystem = new Map<string, typeof invItems>()
    invItems.forEach(i => { const arr = invBySystem.get(i.system) || []; arr.push(i); invBySystem.set(i.system, arr) })
    const inventarioHTML = Array.from(invBySystem.entries()).map(([sys, items]) => {
      const rows = items.map(i => {
        const pending = i.qty_cotizado - i.qty_entregado
        return `<tr>
          <td class="tc">${esc(i.name)}</td>
          <td class="tc" style="text-align:center">${i.qty_cotizado}</td>
          <td class="tc" style="text-align:center">${i.qty_pedido}</td>
          <td class="tc" style="text-align:center">${i.qty_entregado}</td>
          <td class="tc" style="text-align:center;${pending > 0 ? 'color:#b91c1c;font-weight:600' : 'color:#15803d'}">${pending > 0 ? pending + ' pend.' : 'Completo'}</td>
        </tr>`
      }).join('')
      return `<tr><td colspan="5" class="group-header">${sys}</td></tr>${rows}`
    }).join('')

    const reportesHTML = reportesFiltered.map(r => {
      const resumen = r.ai_resumen || r.texto_raw
      const avances = (r.ai_avances || []).map(a => `<li>${esc(a)}</li>`).join('')
      return `<div class="report-card">
        <div class="report-date">${fd(r.fecha)}</div>
        <div class="report-text">${esc(resumen)}</div>
        ${avances ? `<ul class="report-list">${avances}</ul>` : ''}
      </div>`
    }).join('')

    const fotosHTML = fotos.map(f => `<img src="${f.url}" class="photo" />`).join('')

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reporte — ${esc(obra.nombre)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1f2937; background: #fff; max-width: 760px; margin: 0 auto; padding: 32px 28px; font-size: 10px; line-height: 1.45; }
  h2 { font-size: 10px; font-weight: 700; color: #1e293b; margin: 20px 0 8px; padding: 5px 10px; background: #1e293b; color: #fff; text-transform: uppercase; letter-spacing: 0.08em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { padding: 5px 8px; background: #f1f5f9; border-bottom: 1px solid #cbd5e1; font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; text-align: left; font-weight: 600; }
  .tc { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; font-size: 9px; color: #374151; }
  .group-header { padding: 5px 8px; background: #f8fafc; font-weight: 700; font-size: 9px; color: #1e293b; border-bottom: 1px solid #e2e8f0; }
  .bar-bg { background: #e5e7eb; border-radius: 3px; height: 14px; position: relative; overflow: hidden; }
  .bar-fill { background: #1e293b; height: 100%; border-radius: 3px; }
  .bar-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 700; color: #fff; mix-blend-mode: difference; }
  .info-table td { padding: 3px 0; font-size: 9px; }
  .info-label { color: #94a3b8; width: 90px; }
  .info-value { color: #1e293b; font-weight: 600; }
  .summary-box { padding: 10px 14px; background: #f8fafc; border-left: 3px solid #1e293b; margin-bottom: 18px; font-size: 10px; color: #334155; line-height: 1.5; }
  .kpi-row { display: flex; gap: 12px; margin-bottom: 16px; }
  .kpi { flex: 1; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; text-align: center; }
  .kpi-val { font-size: 20px; font-weight: 800; color: #1e293b; }
  .kpi-label { font-size: 8px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
  .report-card { margin-bottom: 8px; padding: 8px 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; }
  .report-date { font-size: 8px; color: #94a3b8; margin-bottom: 3px; }
  .report-text { font-size: 9px; color: #334155; margin-bottom: 4px; }
  .report-list { margin: 0; padding-left: 14px; font-size: 9px; color: #64748b; }
  .report-list li { margin-bottom: 2px; }
  ul.items { padding-left: 16px; font-size: 9px; color: #334155; margin-bottom: 14px; }
  ul.items li { margin-bottom: 4px; }
  .photo { width: 150px; height: 112px; object-fit: cover; border-radius: 4px; border: 1px solid #e2e8f0; margin: 3px; }
  .print-btn { position: fixed; bottom: 16px; right: 16px; padding: 8px 16px; background: #1e293b; color: #fff; border: none; border-radius: 6px; font-size: 10px; cursor: pointer; font-family: inherit; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  .print-btn:hover { background: #334155; }
  @media print {
    .print-btn { display: none !important; }
    body { padding: 16px; font-size: 9px; }
    h2 { break-after: avoid; }
    tr { break-inside: avoid; }
    .photo { width: 120px; height: 90px; }
  }
</style>
</head>
<body contenteditable="true">
<button class="print-btn" contenteditable="false" onclick="window.print()">Imprimir / Guardar PDF</button>

<!-- HEADER -->
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #1e293b">
  <div>
    <div style="font-size:16px;font-weight:800;letter-spacing:-0.02em;color:#1e293b">OMM Technologies</div>
    <div style="font-size:7px;color:#94a3b8;letter-spacing:0.12em;text-transform:uppercase;margin-top:1px">Instalaciones Especiales</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:11px;font-weight:700;color:#1e293b">Reporte de Avance</div>
    <div style="font-size:8px;color:#64748b">${fd(today)}</div>
  </div>
</div>

<!-- INFO -->
<table class="info-table" style="margin-bottom:16px">
  <tr><td class="info-label">Obra</td><td class="info-value">${esc(obra.nombre)}</td><td class="info-label">Cliente</td><td class="info-value">${esc(obra.cliente)}</td></tr>
  <tr><td class="info-label">Dirección</td><td style="font-size:9px;color:#475569">${esc(obra.direccion || '—')}</td><td class="info-label">Periodo</td><td class="info-value">${fd(dateFrom)} — ${fd(dateTo)}</td></tr>
</table>

<!-- RESUMEN -->
<div class="summary-box">${aiResumen || 'Reporte de avance de obra del periodo.'}</div>

${sections.avanceGlobal ? `
<!-- KPIs -->
<div class="kpi-row">
  <div class="kpi">
    <div class="kpi-val">${obra.avance_global}%</div>
    <div class="kpi-label">Avance global</div>
  </div>
  <div class="kpi">
    <div class="kpi-val">${obra.actividades.filter(a => a.status === 'completada').length}/${obra.actividades.length}</div>
    <div class="kpi-label">Completadas</div>
  </div>
  <div class="kpi">
    <div class="kpi-val">${progreso.length}</div>
    <div class="kpi-label">En progreso</div>
  </div>
  <div class="kpi">
    <div class="kpi-val" ${bloqueadas.length > 0 ? 'style="color:#b91c1c"' : ''}>${bloqueadas.length}</div>
    <div class="kpi-label">Bloqueadas</div>
  </div>
</div>
` : ''}

${sections.avancePorSistema && bySystem.size > 0 ? `
<h2>Avance por Sistema</h2>
<table><thead><tr><th>Sistema</th><th style="text-align:center">Completadas</th><th>Avance</th></tr></thead><tbody>${systemRows}</tbody></table>
` : ''}

${sections.actividadesCompletadas && completadas.length > 0 ? `
<h2>Actividades Completadas en Periodo</h2>
<table><thead><tr><th>Actividad</th><th>Sistema</th><th>Área</th></tr></thead><tbody>${completadasHTML}</tbody></table>
` : ''}

${sections.actividadesEnProgreso && progreso.length > 0 ? `
<h2>Actividades en Progreso</h2>
<table><thead><tr><th>Actividad</th><th>Sistema</th><th>Avance</th></tr></thead><tbody>${progresoHTML}</tbody></table>
` : ''}

${sections.bloqueos && bloqueosList.length > 0 ? `
<h2>Puntos que Requieren Atención</h2>
<ul class="items">${bloqueosHTML}</ul>
` : ''}

${sections.faltantes && allFaltantes.length > 0 ? `
<h2>Elementos Pendientes</h2>
<ul class="items">${faltantesHTML}</ul>
` : ''}

${sections.inventario && invItems.length > 0 ? `
<h2>Estado de Equipos</h2>
<table><thead><tr><th>Equipo</th><th style="text-align:center">Cotizado</th><th style="text-align:center">Pedido</th><th style="text-align:center">En obra</th><th style="text-align:center">Estado</th></tr></thead><tbody>${inventarioHTML}</tbody></table>
` : ''}

${sections.reportesCampo && reportesFiltered.length > 0 ? `
<h2>Reportes de Campo</h2>
${reportesHTML}
` : ''}

${sections.evidenciaFotos && fotos.length > 0 ? `
<h2>Evidencia Fotográfica</h2>
<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${fotosHTML}</div>
` : ''}

<h2>Próximos Pasos</h2>
<ul class="items" style="line-height:1.6">
  ${aiProximosPasos || '<li>Continuar con las actividades programadas del siguiente periodo.</li><li>Dar seguimiento a los puntos de atención señalados.</li>'}
</ul>

<div style="margin-top:30px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:7px;color:#94a3b8">
  <span>OMM Technologies SA de CV</span>
  <span>Documento confidencial — Uso exclusivo del proyecto</span>
</div>

</body>
</html>`

    // Open in new window
    const w = window.open('', '_blank', 'width=900,height=700')
    if (w) {
      w.document.write(html)
      w.document.close()
    }

    setGenerating(false)
    onClose()
  }

  const sectionItems: Array<{ key: keyof typeof sections; label: string; count?: number }> = [
    { key: 'avanceGlobal', label: 'Avance global de obra' },
    { key: 'avancePorSistema', label: 'Avance por sistema' },
    { key: 'actividadesCompletadas', label: 'Actividades completadas en periodo', count: completadasInRange.length },
    { key: 'actividadesEnProgreso', label: 'Actividades en progreso', count: enProgreso.length },
    { key: 'bloqueos', label: 'Bloqueos / Puntos de atención', count: bloqueadas.length + allBloqueos.length },
    { key: 'faltantes', label: 'Faltantes reportados', count: allFaltantes.length },
    { key: 'inventario', label: 'Inventario de equipos', count: invItems.length },
    { key: 'reportesCampo', label: 'Resúmenes de reportes de campo', count: reportesInRange.length },
    { key: 'evidenciaFotos', label: 'Evidencia fotográfica', count: fotosInRange.length },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 16, width: 620, maxHeight: '85vh', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Reporte para cliente / residente</div>
            <div style={{ fontSize: 10, color: '#555' }}>{obra.nombre} · {obra.cliente}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {/* Date range */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Periodo del reporte</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div>
                <div style={labelStyle}>Desde</div>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inputStyle, width: 150 }} />
              </div>
              <div>
                <div style={labelStyle}>Hasta</div>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inputStyle, width: 150 }} />
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 4 }}>
                {[
                  { label: '1 sem', days: 7 },
                  { label: '2 sem', days: 14 },
                  { label: '1 mes', days: 30 },
                ].map(p => (
                  <button key={p.days} onClick={() => setDateFrom(new Date(Date.now() - p.days * 86400000).toISOString().substring(0, 10))}
                    style={{ padding: '3px 8px', fontSize: 9, background: '#0a0a0a', border: '1px solid #333', borderRadius: 4, color: '#888', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sections toggle */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Secciones a incluir</div>
            <div style={{ display: 'grid', gap: 4 }}>
              {sectionItems.map(s => (
                <label key={s.key} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer',
                  background: sections[s.key] ? 'rgba(87,255,154,0.04)' : 'transparent',
                  borderRadius: 6, border: sections[s.key] ? '1px solid rgba(87,255,154,0.12)' : '1px solid #1a1a1a',
                }}>
                  <input type="checkbox" checked={sections[s.key]} onChange={() => toggleSection(s.key)} style={{ accentColor: '#10B981' }} />
                  <span style={{ fontSize: 12, color: sections[s.key] ? '#ccc' : '#555', flex: 1 }}>{s.label}</span>
                  {s.count !== undefined && <span style={{ fontSize: 10, color: '#555' }}>{s.count}</span>}
                </label>
              ))}
            </div>
          </div>

          {/* Exclude specific reportes */}
          {sections.reportesCampo && reportesInRange.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                Reportes incluidos <span style={{ color: '#555', fontWeight: 400 }}>(desmarca los que quieras omitir)</span>
              </div>
              <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid #1a1a1a', borderRadius: 8, background: '#0a0a0a' }}>
                {reportesInRange.map(r => {
                  const inst = instaladores.find(i => i.id === r.instalador_id)
                  const excluded = excludedReportes.has(r.id)
                  return (
                    <label key={r.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: 'pointer',
                      borderBottom: '1px solid #151515', opacity: excluded ? 0.4 : 1,
                    }}>
                      <input type="checkbox" checked={!excluded} onChange={() => toggleReporte(r.id)} style={{ accentColor: '#10B981' }} />
                      <span style={{ fontSize: 11, color: '#ccc', flex: 1 }}>{formatDate(r.fecha)} — {inst?.nombre || 'Instalador'}</span>
                      <span style={{ fontSize: 10, color: '#555' }}>{r.fotos.length > 0 ? `${r.fotos.length} fotos` : ''}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* Preview summary */}
          <div style={{ padding: 12, background: '#0a0a0a', border: '1px solid #222', borderRadius: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 6 }}>Resumen del reporte</div>
            <div style={{ fontSize: 11, color: '#666', lineHeight: 1.6 }}>
              Periodo: {dateFrom} → {dateTo}<br />
              Avance global: {obra.avance_global}%<br />
              Actividades completadas en periodo: {completadasInRange.filter(a => !excludedActs.has(a.id)).length}<br />
              En progreso: {enProgreso.length} · Bloqueadas: {bloqueadas.length}<br />
              Reportes de campo: {reportesInRange.filter(r => !excludedReportes.has(r.id)).length}<br />
              Fotos: {fotosInRange.length}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #222', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn size="sm" variant="default" onClick={onClose}>Cancelar</Btn>
          <Btn size="sm" variant="primary" onClick={generateReport} disabled={generating}>
            {generating ? <><Loader2 size={12} /> Generando...</> : <><FileText size={12} /> Generar reporte</>}
          </Btn>
        </div>
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
  const [showClientReport, setShowClientReport] = useState(false)
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
          reporte.ai_actividades_sugeridas = procData.actividades_sugeridas || []
          reporte.ai_pendientes = procData.pendientes || []
          reporte.procesado = true
          // Los pendientes nuevos se dieron de alta en el server: volvemos a
          // leer las actividades para que aparezcan sin recargar la página.
          if (procData.pendientes_creados > 0) {
            const { data: acts } = await supabase.from('obra_actividades').select('*').eq('obra_id', obra.id).order('order_index')
            if (acts) {
              updateObra(o => ({
                ...o,
                actividades: (acts as any[]).map(a => ({
                  id: a.id, obra_id: a.obra_id, sistema: a.sistema as Sistema, area: a.area || undefined,
                  descripcion: a.descripcion, status: a.status as ActividadStatus,
                  instalador_id: a.instalador_id || undefined,
                  fecha_inicio: a.fecha_inicio || undefined,
                  fecha_fin_plan: a.fecha_fin_plan || undefined,
                  fecha_fin_real: a.fecha_fin_real || undefined,
                  notas: a.notas || undefined,
                  porcentaje: a.porcentaje || 0,
                })),
              }))
            }
          }
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
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn size="sm" variant="default" onClick={() => setShowClientReport(true)}>
            <FileText size={12} /> Reporte para cliente
          </Btn>
          <Btn size="sm" variant="primary" onClick={() => setShowNew(true)}><Plus size={12} /> Nuevo reporte</Btn>
        </div>
      </div>

      {/* Modal reporte para cliente */}
      {showClientReport && (
        <ReporteClienteModal
          obra={obra}
          instaladores={instaladores}
          onClose={() => setShowClientReport(false)}
        />
      )}

      {/* New report form */}
      {showNew && (
        <div style={{ ...cardStyle, borderColor: '#10B98133' }}>
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
                {newReporte.fotos.length > 0 && <span style={{ fontSize: 11, color: '#10B981' }}>{newReporte.fotos.length} foto{newReporte.fotos.length > 1 ? 's' : ''}</span>}
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
                    style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#DC2626', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                    {r.procesado && <Badge label="AI procesado" color="#2563EB" />}
                    {r.fotos.length > 0 && <span style={{ fontSize: 10, color: '#666' }}><Camera size={10} /> {r.fotos.length}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#888' }}>
                    {r.ai_resumen || (r.texto_raw.length > 100 ? r.texto_raw.substring(0, 100) + '...' : r.texto_raw)}
                  </div>
                </div>
                {r.ai_bloqueos && r.ai_bloqueos.length > 0 && <Badge label={`${r.ai_bloqueos.length} bloqueo${r.ai_bloqueos.length > 1 ? 's' : ''}`} color="#DC2626" />}
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
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#10B981', marginBottom: 6 }}>✓ Avances</div>
                          {r.ai_avances.map((a, i) => <div key={i} style={{ fontSize: 11, color: '#aaa', marginBottom: 3 }}>• {a}</div>)}
                        </div>
                      )}
                      {r.ai_faltantes && r.ai_faltantes.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(245,158,11,0.04)', borderRadius: 6, border: '1px solid rgba(245,158,11,0.1)' }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#D97706', marginBottom: 6 }}>⚠ Faltantes</div>
                          {r.ai_faltantes.map((f, i) => <div key={i} style={{ fontSize: 11, color: '#aaa', marginBottom: 3 }}>• {f}</div>)}
                        </div>
                      )}
                      {r.ai_bloqueos && r.ai_bloqueos.length > 0 && (
                        <div style={{ padding: '8px 10px', background: 'rgba(239,68,68,0.04)', borderRadius: 6, border: '1px solid rgba(239,68,68,0.1)' }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#DC2626', marginBottom: 6 }}>🚫 Bloqueos</div>
                          {r.ai_bloqueos.map((b, i) => <div key={i} style={{ fontSize: 11, color: '#aaa', marginBottom: 3 }}>• {b}</div>)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Pendientes que el reporte destapó y ya quedaron como tareas */}
                  {r.procesado && r.ai_pendientes && r.ai_pendientes.length > 0 && (
                    <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(167,139,250,0.05)', borderRadius: 6, border: '1px solid rgba(167,139,250,0.18)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#A78BFA', marginBottom: 6 }}>
                        + Pendientes nuevos — ya quedaron dados de alta como actividades
                      </div>
                      {r.ai_pendientes.map((p, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#aaa', marginBottom: 3 }}>
                          • {p.descripcion}{p.area ? ` — ${p.area}` : ''}{p.sistema ? ` (${p.sistema})` : ''}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Propuesta de cierre de actividades */}
                  {r.procesado && r.ai_actividades_sugeridas && r.ai_actividades_sugeridas.length > 0 && (
                    <SugerenciasCierre
                      reporte={r}
                      obra={obra}
                      updateObra={updateObra}
                    />
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
            <div style={{ fontSize: 18, fontWeight: 700, color: allReceived ? '#10B981' : '#D97706' }}>{received}/{obra.entrega_docs.length}</div>
            <ProgressBar pct={Math.round(received / obra.entrega_docs.length * 100)} color={allReceived ? '#10B981' : '#D97706'} />
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
              border: d.recibido ? '2px solid #10B981' : '2px solid #333',
              background: d.recibido ? 'rgba(87,255,154,0.15)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {d.recibido && <CheckCircle size={12} color="#10B981" />}
            </div>
            <span style={{ fontSize: 12, color: d.recibido ? '#aaa' : '#666', textDecoration: d.recibido ? 'line-through' : 'none' }}>{d.nombre}</span>
          </div>
        ))}
      </div>

      {allReceived && obra.status === 'entrega_pendiente' && (
        <div style={{ padding: 16, background: 'rgba(87,255,154,0.05)', border: '1px solid rgba(87,255,154,0.15)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#10B981', fontWeight: 600, marginBottom: 8 }}>Todos los documentos recibidos</div>
          <Btn size="sm" variant="primary" onClick={async () => {
            const patch: any = { status: 'en_ejecucion' }
            if (!obra.fecha_inicio) patch.fecha_inicio = hoyISO()
            updateObra(o => ({ ...o, status: 'en_ejecucion', fecha_inicio: o.fecha_inicio || patch.fecha_inicio }))
            await supabase.from('obras').update(patch).eq('id', obra.id)
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
        <div style={{ ...cardStyle, borderColor: '#10B98133', marginBottom: 12 }}>
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
                  <span style={{ color: '#10B981', marginLeft: 6 }}>{matchSistemas.length}/{obra.sistemas.length} sistemas</span>
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
                    <Badge label={i.disponible ? 'Disponible' : 'Ocupado'} color={i.disponible ? '#10B981' : '#6B7280'} />
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

// Extrae un array JSON de la respuesta del modelo de forma robusta:
// limpia fences markdown, escanea corchetes balanceados (ignorando los de strings)
// y repara truncación quedándose con el último objeto completo.
function extractJsonArray(raw: string): any[] | null {
  if (!raw) return null
  const t = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = t.indexOf('[')
  if (start === -1) return null
  let depth = 0, end = -1, inStr = false, esc = false
  for (let i = start; i < t.length; i++) {
    const c = t[i]
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
    if (c === '"') inStr = true
    else if (c === '[') depth++
    else if (c === ']') { depth--; if (depth === 0) { end = i; break } }
  }
  let arrStr = end !== -1 ? t.slice(start, end + 1) : t.slice(start)
  try { const p = JSON.parse(arrStr); if (Array.isArray(p)) return p } catch {}
  // Reparar truncación: cerrar el array tras el último objeto completo
  const lastBrace = arrStr.lastIndexOf('}')
  if (lastBrace !== -1) {
    try { const p = JSON.parse(arrStr.slice(0, lastBrace + 1) + ']'); if (Array.isArray(p)) return p } catch {}
  }
  return null
}

type AsgItem = { id?: string; obra: string; obra_id: string; project_id: string | null; tarea: string; obraColor: string }
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ═══════════════════════════════════════════════════════════════════
// PANEL DE COORDINACIÓN — vista rápida por obra
// ═══════════════════════════════════════════════════════════════════
function TabCoordinacion({ obras, onOpenObra }: { obras: ObraData[]; onOpenObra: (id: string) => void }) {
  const [reportes, setReportes] = useState<any[]>([])
  const [bloqueos, setBloqueos] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const activas = obras.filter(o => o.status !== 'completada')

  useEffect(() => {
    if (activas.length === 0) { setLoading(false); return }
    const ids = activas.map(o => o.id)
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [rep, blo] = await Promise.all([
        supabase.from('obra_reportes').select('id,obra_id,fecha,ai_resumen,ai_avances,ai_faltantes,ai_bloqueos,procesado,tipo_reporte,texto_raw').in('obra_id', ids).order('fecha', { ascending: false }),
        supabase.from('obra_bloqueos').select('id,obra_id,descripcion,tipo,severidad,status,notificado_residente').in('obra_id', ids).eq('status', 'abierto'),
      ])
      if (cancelled) return
      setReportes(rep.data || [])
      setBloqueos(blo.data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [obras.map(o => o.id).join(',')])

  const hace7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const uniq = (arr: any[]) => Array.from(new Set((arr || []).map((s: any) => String(s || '').trim()).filter(Boolean)))

  const data = activas.map(o => {
    const reps = reportes.filter(r => r.obra_id === o.id)
    const ultimo = reps[0] || null
    const recientes = reps.slice(0, 3)
    const faltantes = uniq(recientes.flatMap(r => r.ai_faltantes || []))
    const avances = uniq(ultimo?.ai_avances || [])
    const aiBloqueos = uniq(recientes.flatMap(r => r.ai_bloqueos || []))
    const blo = bloqueos.filter(b => b.obra_id === o.id)
    const porCliente = uniq([...aiBloqueos, ...blo.map(b => b.descripcion)])
    const reportesNuevos = reps.filter(r => r.fecha && new Date(r.fecha + 'T00:00:00') >= hace7).length
    const sinProcesar = reps.filter(r => !r.procesado).length
    const actPend = o.actividades.filter(a => a.status !== 'completada').length
    return { o, ultimo, faltantes, avances, porCliente, reportesNuevos, sinProcesar, totalReportes: reps.length, actPend }
  }).sort((a, b) => (b.porCliente.length + b.faltantes.length) - (a.porCliente.length + a.faltantes.length))

  const kMateriales = data.reduce((s, d) => s + d.faltantes.length, 0)
  const kCliente = data.reduce((s, d) => s + d.porCliente.length, 0)
  const kSemana = data.reduce((s, d) => s + d.reportesNuevos, 0)
  const kSinProc = data.reduce((s, d) => s + d.sinProcesar, 0)

  const Kpi = ({ label, value, color, hint }: { label: string; value: number | string; color: string; hint?: string }) => (
    <div style={{ background: '#111', border: '1px solid #1f1f1f', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{hint}</div>}
    </div>
  )

  const ListBlock = ({ title, items, color, empty }: { title: string; items: string[]; color: string; empty: string }) => (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        {title} <span style={{ background: color + '22', color, borderRadius: 8, padding: '0 6px', fontSize: 9 }}>{items.length}</span>
      </div>
      {items.length === 0
        ? <div style={{ fontSize: 11, color: '#444', fontStyle: 'italic' }}>{empty}</div>
        : <ul style={{ margin: 0, paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {items.slice(0, 6).map((t, i) => <li key={i} style={{ fontSize: 11.5, color: '#cbd5d5', lineHeight: 1.35 }}>{t}</li>)}
            {items.length > 6 && <li style={{ fontSize: 10, color: '#666', listStyle: 'none' }}>+{items.length - 6} más…</li>}
          </ul>}
    </div>
  )

  if (loading) return <Loading />

  return (
    <div>
      {/* KPIs rápidos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Kpi label="Obras activas" value={activas.length} color="#10B981" />
        <Kpi label="Pendientes de material" value={kMateriales} color="#D97706" hint="de reportes recientes" />
        <Kpi label="Por reportar a cliente" value={kCliente} color="#DC2626" hint="bloqueos e incidencias" />
        <Kpi label="Reportes (7 días)" value={kSemana} color="#2563EB" />
        <Kpi label="Reportes sin procesar" value={kSinProc} color="#A78BFA" />
      </div>

      {activas.length === 0 && <EmptyState message="No hay obras activas" />}

      {/* Tarjeta por obra */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.map(({ o, ultimo, faltantes, avances, porCliente, reportesNuevos, sinProcesar, totalReportes, actPend }) => {
          const st = STATUS_CONFIG[o.status]
          return (
            <div key={o.id} style={{ background: '#0e0e0e', border: '1px solid #1f1f1f', borderRadius: 12, padding: 14 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <span onClick={() => onOpenObra(o.id)} style={{ fontSize: 15, fontWeight: 700, color: '#fff', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#10B981')} onMouseLeave={e => (e.currentTarget.style.color = '#fff')}>
                  {o.nombre}
                </span>
                <Badge label={st.label} color={st.color} />
                <span style={{ fontSize: 11, color: '#666' }}>{o.cliente}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {reportesNuevos > 0 && <Badge label={`${reportesNuevos} reporte(s) nuevos`} color="#2563EB" />}
                  {sinProcesar > 0 && <Badge label={`${sinProcesar} sin procesar`} color="#A78BFA" />}
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{o.avance_global}%</div>
                    <div style={{ width: 90 }}><ProgressBar pct={o.avance_global} /></div>
                  </div>
                  <button onClick={() => onOpenObra(o.id)} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, color: '#aaa', fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>Abrir →</button>
                </div>
              </div>

              {/* Último reporte */}
              <div style={{ fontSize: 11.5, color: '#aaa', marginBottom: 10, background: '#141414', borderRadius: 8, padding: '8px 10px' }}>
                <span style={{ color: '#777', fontWeight: 600 }}>Último reporte {ultimo?.fecha ? `(${ultimo.fecha})` : ''}: </span>
                {ultimo?.ai_resumen || ultimo?.texto_raw || <span style={{ color: '#555', fontStyle: 'italic' }}>Sin reportes de campo aún.</span>}
              </div>

              {/* Columnas de pendientes */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <ListBlock title="🧱 Pendientes de material" items={faltantes} color="#D97706" empty="Sin faltantes reportados" />
                <ListBlock title="⚠ Por reportar a cliente" items={porCliente} color="#DC2626" empty="Sin incidencias abiertas" />
                <ListBlock title="✓ Avances recientes" items={avances} color="#10B981" empty="Sin avances en el último reporte" />
              </div>

              <div style={{ fontSize: 10, color: '#555', marginTop: 8 }}>{totalReportes} reporte(s) de campo · {actPend} actividad(es) pendiente(s)</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TabPlaneacion({ obras, instaladores, hideMoney }: { obras: ObraData[]; instaladores: Instalador[]; hideMoney?: boolean }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [processing, setProcessing] = useState(false)
  const [assignments, setAssignments] = useState<Map<string, Map<number, AsgItem[]>>>(new Map())
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

  // Planeable = obras que aún se pueden trabajar (no completadas).
  // Incluye entrega_pendiente (preparación previa) + en_ejecucion + pausada
  // (pausadas pueden reanudarse). Solo completadas se excluyen.
  const obrasActivas = obras.filter(o => o.status !== 'completada')
  const obraColors = ['#10B981', '#2563EB', '#D97706', '#A78BFA', '#DC2626', '#06B6D4', '#EC4899', '#FF6B35']

  const weekStartStr = ymdLocal(mondayBase)
  const colorForObra = (obraId: string) => {
    const idx = obrasActivas.findIndex(o => o.id === obraId)
    return obraColors[(idx >= 0 ? idx : 0) % obraColors.length]
  }

  // ── Persistencia ──────────────────────────────────────────────────────────
  async function ensureWeeklyPlan(): Promise<string | null> {
    const { data: plan } = await supabase.from('weekly_plans').select('id').eq('week_start', weekStartStr).maybeSingle()
    if (plan) return plan.id
    const { data: created, error } = await supabase.from('weekly_plans').insert({ week_start: weekStartStr }).select('id').single()
    if (error) { console.error('weekly_plans insert', error); return null }
    return created.id
  }

  async function loadWeek() {
    const { data: plan } = await supabase.from('weekly_plans').select('id').eq('week_start', weekStartStr).maybeSingle()
    if (!plan) { setAssignments(new Map()); return }
    const { data: asns } = await supabase.from('weekly_plan_assignments')
      .select('id, employee_id, obra_id, project_id, day_of_week, tareas, obras(id, nombre)')
      .eq('plan_id', plan.id)
    const map = new Map<string, Map<number, AsgItem[]>>()
    for (const a of (asns as any[]) || []) {
      const dayIdx = (a.day_of_week ?? 1) - 1
      if (dayIdx < 0 || dayIdx > 5 || !a.employee_id) continue
      const instMap = map.get(a.employee_id) || new Map<number, AsgItem[]>()
      const arr = instMap.get(dayIdx) || []
      arr.push({ id: a.id, obra: a.obras?.nombre || obras.find(o => o.id === a.obra_id)?.nombre || '', obra_id: a.obra_id, project_id: a.project_id, tarea: a.tareas || '', obraColor: colorForObra(a.obra_id) })
      instMap.set(dayIdx, arr)
      map.set(a.employee_id, instMap)
    }
    setAssignments(map)
  }

  useEffect(() => { loadWeek() }, [weekOffset, obras.length])

  // Reescribe en BD todas las asignaciones de la semana (usado por AI)
  async function persistAll(map: Map<string, Map<number, AsgItem[]>>) {
    const planId = await ensureWeeklyPlan()
    if (!planId) return
    const weekDates = weekDays.map(ymdLocal)
    await supabase.from('weekly_plan_assignments').delete().eq('plan_id', planId)
    await supabase.from('installer_daily_assignment').delete().in('fecha', weekDates)
    const wpa: any[] = []; const ida: any[] = []
    for (const [instId, instMap] of map) {
      for (const [dayIdx, arr] of instMap) {
        arr.forEach((it, i) => {
          wpa.push({ plan_id: planId, employee_id: instId, obra_id: it.obra_id || null, project_id: it.project_id || null, day_of_week: dayIdx + 1, tareas: it.tarea, urgencia: 'normal' })
          if (i === 0) ida.push({ employee_id: instId, fecha: weekDates[dayIdx], obra_id: it.obra_id || null, project_id: it.project_id || null, tareas: it.tarea, urgencia: 'normal' })
        })
      }
    }
    if (wpa.length) await supabase.from('weekly_plan_assignments').insert(wpa)
    if (ida.length) await supabase.from('installer_daily_assignment').insert(ida)
    await loadWeek()
  }

  // Get assignments for an installer on a day
  const getCell = (instId: string, dayIdx: number) => {
    return assignments.get(instId)?.get(dayIdx) || []
  }

  // ── Exportar la tabla de planeación a PDF (horizontal) ──
  function exportarPlaneacionPDF() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
    const W = doc.internal.pageSize.getWidth()
    const H = doc.internal.pageSize.getHeight()
    const M = 10
    const hexToRgb = (hex: string): [number, number, number] => {
      const h = (hex || '#888').replace('#', '')
      const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }
    const filas = instaladores.filter(i => i.disponible)
    const instColW = 42
    const dayColW = (W - 2 * M - instColW) / 6
    const lineH = 3.4

    // Encabezado del documento
    let y = M
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(20, 20, 20)
    doc.text('Planeación Semanal', M, y + 5)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90, 90, 90)
    doc.text(weekLabel, W - M, y + 3, { align: 'right' })
    doc.setFontSize(8); doc.setTextColor(140, 140, 140)
    doc.text(`Generado: ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}`, W - M, y + 8, { align: 'right' })
    y += 12
    doc.setFillColor(16, 185, 129); doc.rect(M, y, W - 2 * M, 0.6, 'F'); y += 3

    // Construye las líneas por celda para calcular alturas
    const cellLines = (instId: string, dayIdx: number): { text: string; color: [number, number, number] }[] => {
      const arr = getCell(instId, dayIdx)
      const out: { text: string; color: [number, number, number] }[] = []
      arr.forEach(a => {
        const label = a.tarea ? `${a.obra}: ${a.tarea}` : a.obra
        const wrapped: string[] = doc.splitTextToSize(`• ${label}`, dayColW - 3)
        wrapped.forEach(w => out.push({ text: w, color: hexToRgb(a.obraColor) }))
      })
      return out
    }

    const drawHeader = () => {
      doc.setFillColor(26, 26, 26); doc.rect(M, y, W - 2 * M, 8, 'F')
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
      doc.text('INSTALADOR', M + 2, y + 5.3)
      dayLabels.forEach((lbl, i) => {
        const x = M + instColW + i * dayColW
        const d = weekDays[i]
        doc.text(`${lbl} ${d.getDate()}/${d.getMonth() + 1}`, x + 2, y + 5.3)
      })
      y += 8
    }
    drawHeader()

    doc.setFont('helvetica', 'normal')
    filas.forEach((inst, ri) => {
      // Altura de la fila = máximo de líneas entre los 6 días (mínimo 2)
      const perDay = [0, 1, 2, 3, 4, 5].map(d => cellLines(inst.id, d))
      const maxLines = Math.max(2, ...perDay.map(l => l.length))
      const rowH = maxLines * lineH + 3

      if (y + rowH > H - M) { doc.addPage(); y = M; drawHeader(); doc.setFont('helvetica', 'normal') }

      if (ri % 2 === 1) { doc.setFillColor(247, 248, 248); doc.rect(M, y, W - 2 * M, rowH, 'F') }
      // Nombre del instalador
      doc.setTextColor(30, 30, 30); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
      doc.splitTextToSize(inst.nombre, instColW - 3).slice(0, 3).forEach((ln: string, k: number) => doc.text(ln, M + 2, y + 4 + k * lineH))
      // Celdas por día
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      perDay.forEach((lines, di) => {
        const x = M + instColW + di * dayColW
        lines.forEach((ln, k) => {
          doc.setTextColor(ln.color[0], ln.color[1], ln.color[2])
          doc.text(ln.text, x + 2, y + 4 + k * lineH)
        })
      })
      // Bordes verticales de columnas
      doc.setDrawColor(225, 225, 225)
      for (let c = 0; c <= 6; c++) { const x = M + instColW + c * dayColW - (c === 0 ? 0 : 0); doc.line(x, y, x, y + rowH) }
      doc.line(M, y, M, y + rowH)
      doc.line(W - M, y, W - M, y + rowH)
      doc.line(M, y + rowH, W - M, y + rowH)
      y += rowH
    })

    // Pie
    const pages = doc.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFontSize(7); doc.setTextColor(150, 150, 150)
      doc.text('OMM ERP · Planeación semanal', M, H - 5)
      doc.text(`Página ${i} de ${pages}`, W - M, H - 5, { align: 'right' })
    }
    doc.save(`Planeacion_Semanal_${weekStartStr}.pdf`)
  }

  // Add manual assignment (persiste en BD)
  const addAssignment = async () => {
    if (!selectedCell || !newTask.obra_id || !newTask.tarea.trim()) return
    const { instId, dayIdx } = selectedCell
    const obra = obras.find(o => o.id === newTask.obra_id)
    if (!obra) return
    const color = colorForObra(obra.id)
    const tarea = newTask.tarea.trim()
    const project_id = obra.project_id || null
    const fecha = ymdLocal(weekDays[dayIdx])

    const planId = await ensureWeeklyPlan()
    if (!planId) { alert('No se pudo crear/encontrar el plan semanal.'); return }

    const { data: ins, error } = await supabase.from('weekly_plan_assignments').insert({
      plan_id: planId, employee_id: instId, obra_id: obra.id, project_id, day_of_week: dayIdx + 1, tareas: tarea, urgencia: 'normal',
    }).select('id').single()
    if (error) { alert('Error al guardar la asignación: ' + error.message); return }

    // Espejo diario (lo que ve "Hoy estás en" / Mi semana) — 1 por instalador/día
    await supabase.from('installer_daily_assignment').delete().eq('employee_id', instId).eq('fecha', fecha)
    await supabase.from('installer_daily_assignment').insert({ employee_id: instId, fecha, obra_id: obra.id, project_id, tareas: tarea, urgencia: 'normal' })

    setAssignments(prev => {
      const next = new Map(prev)
      const instMap = new Map(next.get(instId) || new Map<number, AsgItem[]>())
      const dayArr = [...(instMap.get(dayIdx) || [])]
      dayArr.push({ id: ins.id, obra: obra.nombre, obra_id: obra.id, project_id, tarea, obraColor: color })
      instMap.set(dayIdx, dayArr)
      next.set(instId, instMap)
      return next
    })
    setNewTask({ obra_id: '', tarea: '' })
    setSelectedCell(null)
  }

  // Asigna la misma obra a TODA la semana (6 días) del instalador seleccionado.
  // Salta los días que ya tengan esa obra para no duplicar.
  const [fillingWeek, setFillingWeek] = useState(false)
  const addAssignmentWholeWeek = async () => {
    if (!selectedCell || !newTask.obra_id) return
    const { instId } = selectedCell
    const obra = obras.find(o => o.id === newTask.obra_id)
    if (!obra) return
    const color = colorForObra(obra.id)
    const tarea = newTask.tarea.trim()
    const project_id = obra.project_id || null
    setFillingWeek(true)
    try {
      const planId = await ensureWeeklyPlan()
      if (!planId) { alert('No se pudo crear/encontrar el plan semanal.'); return }
      // Solo Lun–Vie (0–4). El sábado (5) se deja vacío: solo se trabaja en casos especiales.
      const dias = [0, 1, 2, 3, 4].filter(d => !getCell(instId, d).some(t => t.obra_id === obra.id))
      if (dias.length === 0) { setNewTask({ obra_id: '', tarea: '' }); setSelectedCell(null); return }
      const rows = dias.map(d => ({ plan_id: planId, employee_id: instId, obra_id: obra.id, project_id, day_of_week: d + 1, tareas: tarea, urgencia: 'normal' }))
      const { data: ins, error } = await supabase.from('weekly_plan_assignments').insert(rows).select('id, day_of_week')
      if (error) { alert('Error al guardar la semana: ' + error.message); return }
      // Espejo diario: 1 por día (reemplaza el existente)
      for (const d of dias) {
        const fecha = ymdLocal(weekDays[d])
        await supabase.from('installer_daily_assignment').delete().eq('employee_id', instId).eq('fecha', fecha)
        await supabase.from('installer_daily_assignment').insert({ employee_id: instId, fecha, obra_id: obra.id, project_id, tareas: tarea, urgencia: 'normal' })
      }
      setAssignments(prev => {
        const next = new Map(prev)
        const instMap = new Map(next.get(instId) || new Map<number, AsgItem[]>())
        ;(ins as any[] || []).forEach(row => {
          const dIdx = (row.day_of_week || 1) - 1
          const dayArr = [...(instMap.get(dIdx) || [])]
          dayArr.push({ id: row.id, obra: obra.nombre, obra_id: obra.id, project_id, tarea, obraColor: color })
          instMap.set(dIdx, dayArr)
        })
        next.set(instId, instMap)
        return next
      })
      setNewTask({ obra_id: '', tarea: '' })
      setSelectedCell(null)
    } finally {
      setFillingWeek(false)
    }
  }

  // Remove assignment (persiste en BD)
  const removeAssignment = async (instId: string, dayIdx: number, taskIdx: number) => {
    const item = assignments.get(instId)?.get(dayIdx)?.[taskIdx]
    const fecha = ymdLocal(weekDays[dayIdx])
    if (item?.id) await supabase.from('weekly_plan_assignments').delete().eq('id', item.id)

    // Recalcular el espejo diario: queda el primero restante de ese día (o se borra)
    const remaining = (assignments.get(instId)?.get(dayIdx) || []).filter((_, i) => i !== taskIdx)
    await supabase.from('installer_daily_assignment').delete().eq('employee_id', instId).eq('fecha', fecha)
    if (remaining[0]) {
      await supabase.from('installer_daily_assignment').insert({ employee_id: instId, fecha, obra_id: remaining[0].obra_id || null, project_id: remaining[0].project_id || null, tareas: remaining[0].tarea, urgencia: 'normal' })
    }

    setAssignments(prev => {
      const next = new Map(prev)
      const instMap = new Map(next.get(instId) || new Map<number, AsgItem[]>())
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
      const response = await fetch('/api/anthropic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 4000,
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
                dayArr.push({ obra: obraMatch?.nombre || item.obra || '', obra_id: obraMatch?.id || '', project_id: obraMatch?.project_id || null, tarea: item.tarea || '', obraColor: color })
                instMap.set(dayIdx, dayArr)
                newAssignments.set(inst.id, instMap)
              })

              setAssignments(newAssignments)
              await persistAll(newAssignments)
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
          {weekOffset === 0 && <span style={{ fontSize: 10, color: '#10B981', marginLeft: 8 }}>Esta semana</span>}
        </div>
        <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: '#141414', border: '1px solid #333', borderRadius: 6, padding: '4px 10px', color: '#ccc', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>Siguiente →</button>
        <Btn size="sm" variant="secondary" onClick={exportarPlaneacionPDF} title="Descargar la planeación de esta semana en PDF">
          <FileText size={12} /> PDF
        </Btn>
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
                    color: isToday ? '#10B981' : '#666',
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
                              {(() => {
                                const instId = selectedCell?.instId
                                const asignadas = obrasActivas.filter(o => instId && (o.instaladores_ids || []).includes(instId))
                                const otras = obrasActivas.filter(o => !instId || !(o.instaladores_ids || []).includes(instId))
                                return (
                                  <>
                                    {asignadas.length > 0 && (
                                      <optgroup label="✓ Asignadas a este instalador">
                                        {asignadas.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                                      </optgroup>
                                    )}
                                    {otras.length > 0 && (
                                      <optgroup label={asignadas.length > 0 ? 'Otras obras' : 'Todas las obras'}>
                                        {otras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                                      </optgroup>
                                    )}
                                  </>
                                )
                              })()}
                            </select>
                            {(() => {
                              const selObra = obras.find(o => o.id === newTask.obra_id)
                              const pend = (selObra?.actividades || []).filter(a => a.status !== 'completada')
                              if (!newTask.obra_id || pend.length === 0) return null
                              return (
                                <select value="" onChange={e => { if (e.target.value) setNewTask(t => ({ ...t, tarea: e.target.value })) }}
                                  style={{ ...inputStyle, fontSize: 10, padding: '3px 4px', marginBottom: 3 }}>
                                  <option value="">↳ Actividad pendiente de la obra...</option>
                                  {pend.map(a => (
                                    <option key={a.id} value={a.descripcion}>
                                      {`[${(SISTEMAS_CONFIG[a.sistema]?.label || a.sistema).substring(0, 4)}] ${a.descripcion}${a.status === 'bloqueada' ? ' ⚠' : ''}`}
                                    </option>
                                  ))}
                                </select>
                              )
                            })()}
                            <input value={newTask.tarea} onChange={e => setNewTask(t => ({ ...t, tarea: e.target.value }))}
                              placeholder="Tarea (elige arriba o escribe)..."
                              onKeyDown={e => { if (e.key === 'Enter') addAssignment() }}
                              style={{ ...inputStyle, fontSize: 10, padding: '3px 4px', marginBottom: 3 }} />
                            <div style={{ display: 'flex', gap: 3 }}>
                              <button onClick={addAssignment} style={{ flex: 1, padding: '2px 4px', fontSize: 9, background: 'rgba(87,255,154,0.1)', border: '1px solid rgba(87,255,154,0.2)', borderRadius: 4, color: '#10B981', cursor: 'pointer', fontFamily: 'inherit' }}>Agregar</button>
                              <button onClick={() => setSelectedCell(null)} style={{ padding: '2px 4px', fontSize: 9, background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, color: '#666', cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
                            </div>
                            <button onClick={addAssignmentWholeWeek} disabled={!newTask.obra_id || fillingWeek}
                              title="Asigna esta obra de Lunes a Viernes (el sábado se deja vacío)"
                              style={{ width: '100%', marginTop: 3, padding: '3px 4px', fontSize: 9, fontWeight: 600, background: newTask.obra_id ? 'rgba(37,99,235,0.15)' : '#141414', border: '1px solid ' + (newTask.obra_id ? 'rgba(37,99,235,0.4)' : '#2a2a2a'), borderRadius: 4, color: newTask.obra_id ? '#60A5FA' : '#555', cursor: newTask.obra_id ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                              {fillingWeek ? 'Asignando…' : '📅 Toda la semana'}
                            </button>
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
          <EmptyState message="No hay obras planeables. Crea una obra desde la pestaña Obras para empezar a planearla (incluye obras en entrega pendiente, en ejecución y pausadas)." />
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
  const isMobile = useIsMobile()
  const [form, setForm] = useState({
    nombre: '', cliente: '', direccion: '', coordinador_id: '',
    cotizacion_ids: [] as string[], valor_contrato: '', sistemas: [] as Sistema[],
    fecha_fin_plan: '', lead_id: '',
  })
  const [leads, setLeads] = useState<Array<{ id: string; name: string; company: string; address?: string }>>([])
  const [cotizaciones, setCotizaciones] = useState<Array<{ id: string; name: string; total: number; project_name?: string; client_name?: string; notes?: string; stage?: string; specialty?: string }>>([])
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
      supabase.from('quotations').select('id, name, total, project_id, client_name, notes, stage, specialty, projects:projects!quotations_project_id_fkey(name)')
        .order('created_at', { ascending: false }),
    ]).then(([lRes, qRes]) => {
      setLeads((lRes.data || []) as any)
      if (qRes.data) {
        setCotizaciones(qRes.data.map((q: any) => ({
          id: q.id, name: q.name, total: q.total || 0,
          project_name: q.projects?.name || '', client_name: q.client_name || '',
          notes: q.notes || '', stage: q.stage || '', specialty: q.specialty || '',
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
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: isMobile ? 0 : 12, padding: isMobile ? 16 : 24, width: isMobile ? '100vw' : 520, height: isMobile ? '100vh' : 'auto', maxHeight: isMobile ? '100vh' : '80vh', overflowY: 'auto' }}
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
                borderColor: leadOpen ? '#10B981' : '#333',
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
                      style={{ padding: '7px 10px', fontSize: 12, color: l.id === form.lead_id ? '#10B981' : '#ccc', cursor: 'pointer', background: l.id === form.lead_id ? 'rgba(87,255,154,0.08)' : 'transparent' }}
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
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
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
            <div style={labelStyle}>Cotizaciones {loadingCots && '(cargando...)'} {form.cotizacion_ids.length > 0 && <span style={{ color: '#10B981', fontWeight: 600 }}>({form.cotizacion_ids.length})</span>}</div>
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
                      style={{ accentColor: '#10B981' }} />
                    <span style={{ color: checked ? '#10B981' : '#ccc', flex: 1 }}>{c.name}</span>
                    {c.specialty && <span style={{ fontSize: 9, color: '#888', background: '#222', padding: '1px 5px', borderRadius: 4, textTransform: 'uppercase' }}>{c.specialty}</span>}
                    {c.stage && <span style={{ fontSize: 9, color: c.stage === 'contrato' ? '#10B981' : c.stage === 'propuesta' ? '#D97706' : '#666', background: '#1a1a1a', padding: '1px 5px', borderRadius: 4 }}>{c.stage}</span>}
                    <span style={{ color: '#666', fontSize: 11 }}>{F(c.specialty === 'elec' ? c.total * 1.16 : c.total)}</span>
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
  const isMobile = useIsMobile()
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
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: isMobile ? 0 : 12, padding: isMobile ? 16 : 24, width: isMobile ? '100vw' : 460, height: isMobile ? '100vh' : 'auto', maxHeight: isMobile ? '100vh' : '85vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>Nuevo instalador</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
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
  baja: '#10B981',
  media: '#D97706',
  alta: '#DC2626',
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
        <div style={{ ...cardStyle, borderColor: '#DC262633', marginBottom: 12 }}>
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
          <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Abiertos ({abiertos.length})</div>
          {abiertos.map(b => (
            <div key={b.id} style={{ ...cardStyle, borderLeft: `3px solid ${SEVERIDAD_COLOR[b.severidad]}`, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Badge label={BLOQUEO_TIPO_LABEL[b.tipo] || b.tipo} color={SEVERIDAD_COLOR[b.severidad]} />
                  <Badge label={b.severidad} color={SEVERIDAD_COLOR[b.severidad]} />
                  {b.status === 'en_atencion' && <Badge label="En atención" color="#D97706" />}
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
                }} style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 10, background: 'rgba(87,255,154,0.1)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 4, color: '#10B981', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Resolver
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {resueltos.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#10B981', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Resueltos ({resueltos.length})</div>
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

      // 4. Update cotizacion total with IVA applied (adendums are ESP cotizaciones;
      // dashboard expects ESP totals to include IVA — commits 3bc54d3 / 7a7e3e3).
      const totalAdendumConIva = Math.round(totalAdendum * 1.16 * 100) / 100
      await supabase.from('quotations').update({ total: totalAdendumConIva, total_final: totalAdendumConIva }).eq('id', cotizacionId)

      // 5. Refresh local state
      setExtras(prev => prev.map(e => selected.has(e.id) ? { ...e, status: 'cotizado', cotizacion_adendum_id: cotizacionId } : e))
      setSelected(new Set())
      alert(`Cotización adendum creada con ${selectedExtras.length} items. Total: $${totalAdendumConIva.toFixed(2)} (con IVA 16%). Puedes editarla desde el módulo de Cotizaciones.`)
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
            <div style={{ fontSize: 11, color: '#D97706', fontWeight: 600, textTransform: 'uppercase' }}>Pendientes de revisión ({pendientes.length})</div>
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
              <div key={ex.id} style={{ ...cardStyle, marginBottom: 8, borderLeft: critico ? '3px solid #C026D3' : '3px solid #D97706' }}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input type="checkbox" checked={selected.has(ex.id)} onChange={() => toggleSel(ex.id)} style={{ marginTop: 4 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                      <Badge label={ex.tipo} color={ex.tipo === 'actividad' ? '#8B5CF6' : '#06B6D4'} />
                      {ex.sistema && <Badge label={ex.sistema} color="#2563EB" />}
                      <Badge label={`${ex.cantidad} ${ex.unidad}`} color="#555" />
                      {critico && <Badge label={`⚠ ${diasEspera}d`} color="#C026D3" />}
                      {ex.catalog_product_id && ex.match_confianza !== null && ex.match_confianza > 0.8 && <Badge label={`Match ${Math.round(ex.match_confianza * 100)}%`} color="#10B981" />}
                    </div>
                    <div style={{ fontSize: 12, color: '#ccc', marginBottom: 4 }}>{ex.descripcion}</div>
                    {ex.texto_original && <div style={{ fontSize: 10, color: '#666', fontStyle: 'italic', marginBottom: 6 }}>"{ex.texto_original}"</div>}
                    {ex.precio_estimado > 0 && <div style={{ fontSize: 11, color: '#10B981' }}>Precio estimado: ${ex.precio_estimado.toFixed(2)} {ex.moneda}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button onClick={() => aprobarInterno(ex.id)} style={{ padding: '3px 8px', fontSize: 9, background: 'rgba(87,255,154,0.1)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 4, color: '#10B981', cursor: 'pointer', fontFamily: 'inherit' }}>Aprobar interno</button>
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
                <Badge label={EXTRA_STATUS_LABEL[ex.status]} color={ex.status === 'cotizado' ? '#10B981' : ex.status === 'rechazado' ? '#DC2626' : '#888'} />
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

// Adivina el tipo del documento por el nombre del archivo. Es solo el valor
// inicial: el enum doc_tipo se puede corregir después desde Proyectos.
function tipoPorNombre(nombre: string): string {
  const n = nombre.toLowerCase()
  if (/\.(dwg|dxf|rvt|skp)$/.test(n) || /plano|planta|arquitect|corte|alzado|isometric/.test(n)) return 'plano'
  if (/ficha|datasheet|spec|hoja[_ -]?tecnica/.test(n)) return 'ficha_tecnica'
  if (/diagrama|unifilar|topolog|cableado/.test(n)) return 'diagrama'
  if (/render|vista3d|3d/.test(n)) return 'render'
  if (/memoria|calculo|cálculo/.test(n)) return 'memoria_calculo'
  if (/manual|instructivo|guia|guía/.test(n)) return 'manual'
  return 'otro'
}

function SubDocumentacion({ obra }: { obra: ObraData }) {
  const [docs, setDocs] = useState<DocDB[]>([])
  const [loading, setLoading] = useState(true)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [filterTipo, setFilterTipo] = useState<string>('')
  // ── subida por drag & drop ──
  const [dragOver, setDragOver] = useState(false)
  const [subiendo, setSubiendo] = useState('')
  const [errUp, setErrUp] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
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

  // Sube al bucket `obra-documentos` y registra el renglón en obra_documentos.
  // Se guarda la URL pública en drive_url para reusar la misma tarjeta que los
  // documentos que vienen de Drive desde el módulo de Proyectos.
  async function subirArchivos(files: File[]) {
    if (!files.length || subiendo) return
    setErrUp('')
    const nuevos: DocDB[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      setSubiendo(`Subiendo ${i + 1} de ${files.length} — ${f.name}`)
      try {
        if (f.size > 50 * 1024 * 1024) throw new Error('pesa más de 50 MB')
        const limpio = f.name.replace(/[^\w.\-]+/g, '_')
        const ruta = `${obra.id}/${Date.now()}-${limpio}`
        const { error: upErr } = await supabase.storage.from('obra-documentos').upload(ruta, f, { cacheControl: '31536000' })
        if (upErr) throw upErr
        const { data: pub } = supabase.storage.from('obra-documentos').getPublicUrl(ruta)
        const esImagen = (f.type || '').startsWith('image/')
        const { data: row, error: insErr } = await supabase.from('obra_documentos').insert({
          obra_id: obra.id,
          project_id: projectId,
          nombre: f.name,
          tipo: tipoPorNombre(f.name),
          drive_url: pub.publicUrl,
          drive_thumbnail_url: esImagen ? pub.publicUrl : null,
        }).select().single()
        if (insErr) throw insErr
        nuevos.push(row as DocDB)
      } catch (e: any) {
        setErrUp(`No se pudo subir "${f.name}": ${e?.message || e}`)
      }
    }
    if (nuevos.length) setDocs(d => [...nuevos, ...d])
    setSubiendo('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function borrarDoc(d: DocDB) {
    if (!confirm(`¿Quitar "${d.nombre}" de la documentación de esta obra?`)) return
    const marca = '/obra-documentos/'
    const i = d.drive_url.indexOf(marca)
    if (i >= 0) {
      const ruta = decodeURIComponent(d.drive_url.slice(i + marca.length).split('?')[0])
      await supabase.storage.from('obra-documentos').remove([ruta])
    }
    const { error } = await supabase.from('obra_documentos').delete().eq('id', d.id)
    if (error) { alert('No se pudo quitar: ' + error.message); return }
    setDocs(x => x.filter(y => y.id !== d.id))
  }

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
            {' '}Arrastra archivos aquí para subirlos, o agrégalos desde el módulo de <strong>Proyectos</strong>.
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

      {/* ── Zona de arrastre ── */}
      <div
        onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
        onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
        onDrop={e => {
          e.preventDefault(); setDragOver(false)
          const fs = Array.from(e.dataTransfer.files || [])
          if (fs.length) subirArchivos(fs)
        }}
        onClick={() => !subiendo && fileRef.current?.click()}
        style={{
          border: `1.5px dashed ${dragOver ? '#10B981' : '#2a2a2a'}`,
          background: dragOver ? '#10B98114' : 'transparent',
          borderRadius: 12, padding: subiendo ? '14px 16px' : '20px 16px', marginBottom: 16,
          textAlign: 'center', cursor: subiendo ? 'progress' : 'pointer', transition: 'all 0.12s',
        }}
      >
        <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
          onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) subirArchivos(fs) }} />
        {subiendo ? (
          <div style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>{subiendo}</div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: dragOver ? '#10B981' : '#888', fontWeight: 600 }}>
              {dragOver ? 'Suelta los archivos aquí' : 'Arrastra planos, fichas o manuales aquí'}
            </div>
            <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>
              o da clic para elegirlos · PDF, DWG, imágenes, Excel… hasta 50 MB c/u · puedes soltar varios a la vez
            </div>
          </>
        )}
      </div>
      {errUp && <div style={{ fontSize: 11, color: '#EF4444', marginBottom: 12 }}>⚠ {errUp}</div>}

      {filtered.length === 0 ? (
        <EmptyState message={docs.length === 0 ? "No hay documentos técnicos para esta obra" : "Sin resultados con los filtros aplicados"} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {filtered.map(d => {
            const propio = d.drive_url.includes('/obra-documentos/')
            return (
            <div key={d.id} style={{ position: 'relative' }}>
            {propio && (
              <button onClick={e => { e.preventDefault(); e.stopPropagation(); borrarDoc(d) }}
                title="Quitar este documento"
                style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, width: 22, height: 22, lineHeight: '20px',
                  borderRadius: 6, border: '1px solid #3a1a1a', background: '#1a0d0d', color: '#EF4444',
                  cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: 0 }}>×</button>
            )}
            <a href={d.drive_url} target="_blank" rel="noopener noreferrer" style={{
              ...cardStyle, textDecoration: 'none', display: 'block', transition: 'border-color 0.12s',
            }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#10B98144')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#222')}
            >
              {d.drive_thumbnail_url && (
                <img src={d.drive_thumbnail_url} alt={d.nombre} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }} />
              )}
              <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <Badge label={DOC_TIPO_LABEL[d.tipo] || d.tipo} color="#2563EB" />
                {d.sistema && <Badge label={d.sistema} color="#8B5CF6" />}
                {d.version && <Badge label={d.version} color="#555" />}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{d.nombre}</div>
              {d.notas && <div style={{ fontSize: 10, color: '#666' }}>{d.notas}</div>}
              <div style={{ fontSize: 9, color: '#444', marginTop: 6 }}>{propio ? '↗ Abrir archivo' : '↗ Abrir en Drive'}</div>
            </a>
            </div>
          )})}
        </div>
      )}
    </div>
  )
}
