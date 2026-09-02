// ═══════════════════════════════════════════════════════════════════════════
// Actividades — el lugar donde cada quien ve QUÉ le toca.
//
// Está armado por rol porque la responsabilidad es distinta: un dibujante
// necesita saber qué dibuja y para cuándo; un director necesita saber qué
// tiene su área sin repartir y qué está esperando SU respuesta. Meterlos en
// la misma lista hace que ninguno de los dos la use.
//
// El orden de las secciones de "Lo mío" no es estético, es de bloqueo:
//   1. Lo que me devolvieron a corregir — es trabajo ya hecho que no cuenta.
//   2. Lo que debo entregar — ordenado por lo que se está perdiendo.
//   3. Lo que entregué y está esperando respuesta — para que sepa que no es suyo.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Badge } from '../components/layout/UI'
import {
  Tarea, TIPO_CFG, URGENCIA_TAREA_CFG, AREAS_TRABAJO,
  tareasDe, tareasDeArea, tareasDeAreas, delegar, actualizarTarea, estadoFecha, ordenarTareas,
} from '../lib/tareas'
import {
  AreaDeMando, cadenaDeMando, esDirectorGeneral, aQuienPuedoPasarla, areaDePersona, areasSinCabeza,
} from '../lib/cadenaDeMando'
import {
  Entregable, ESTADO_CFG, entregablesDe, pendientesDeRevision, revisar,
  diasEsperando, colorEspera, urlDe, cargarTipos, TipoEntregable,
} from '../lib/entregables'
import { Rol, ROL_CFG, ROLES_GABINETE, EmpleadoRol, conRol, tieneRol, ALCANCE_ROL, TIPOS_ENCARGO } from '../lib/roles'
import {
  PlantillaEncargo, ActividadPlantilla, cargarPlantillas, actividadesDe,
  guardarPlantilla, borrarPlantilla, aplicarPlantilla, crearActividades, fechaDe,
} from '../lib/plantillas'
import { sugerirPlan, PlanPropuesto, sinDuenoDe } from '../lib/actividadesIA'
import EntregablesTarea from '../components/EntregablesTarea'
import RevisarEntregable from '../components/RevisarEntregable'
import PlanEditable from '../components/PlanEditable'
import {
  ListChecks, Users, Sparkles, LayoutTemplate, AlertTriangle, Clock, RotateCcw,
  Check, ExternalLink, Upload, Trash2, Plus, Play, Save, ChevronRight,
} from 'lucide-react'
import { cargarPlantilla } from '../lib/empleados'

const card: React.CSSProperties = { background: '#111', border: '1px solid #222', borderRadius: 12, padding: 16 }
const inp: React.CSSProperties = { background: '#141414', color: '#ddd', border: '1px solid #242424', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontFamily: 'inherit', outline: 'none' }
const btn: React.CSSProperties = { border: '1px solid #333', background: '#161616', color: '#ccc', borderRadius: 8, padding: '6px 11px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }
const h2: React.CSSProperties = { fontSize: 13, color: '#ddd', fontWeight: 600, margin: '0 0 8px' }
const sub: React.CSSProperties = { fontSize: 11.5, color: '#777', margin: '0 0 10px', lineHeight: 1.6 }

const hoyISO = () => new Date().toISOString().slice(0, 10)
const fFecha = (s?: string | null) => s ? new Date(s + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—'

export default function Actividades() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [emps, setEmps] = useState<EmpleadoRol[]>([])
  const [mias, setMias] = useState<Tarea[]>([])
  const [area, setArea] = useState<Tarea[]>([])
  const [misEnt, setMisEnt] = useState<Entregable[]>([])
  const [porRevisar, setPorRevisar] = useState<Entregable[]>([])
  const [tipos, setTipos] = useState<TipoEntregable[]>([])
  const [tab, setTab] = useState<'mio' | 'equipo' | 'nuevo' | 'plantillas'>('mio')
  const [cargando, setCargando] = useState(true)

  const employeeId = user?.employee_id || null
  const yo = useMemo(() => emps.find(e => e.id === employeeId), [emps, employeeId])
  const miRol: Rol = yo?.rol || 'admin'
  const esDG = user?.permission_area === 'DG'
  const mando = esDG || miRol === 'director'
  // Manda sobre TODAS las areas: por permiso o porque el puesto dice Director
  // General. Antes solo se miraba el permiso, y con el permiso de area
  // ADMINISTRACION el DG quedaba encerrado en su propia area.
  const mandoTotal = esDG || esDirectorGeneral(yo)
  const miSpecialty = useMemo(
    () => AREAS_TRABAJO.find(a => a.area === yo?.area)?.specialty || '', [yo])
  const nombreDe = (id?: string | null) => emps.find(e => e.id === id)?.name || '—'

  async function cargar() {
    setCargando(true)
    const [e, ts] = await Promise.all([
      cargarPlantilla(),
      employeeId ? tareasDe(employeeId) : Promise.resolve([] as Tarea[]),
    ])
    setEmps(((e as any[]) || []).map(conRol))
    setMias(ts)
    cargarTipos().then(setTipos)
    if (employeeId) {
      // Lo que YO subí: para saber qué está esperando respuesta y qué me devolvieron.
      const { data: mine } = await supabase.from('entregables').select('*')
        .eq('subido_por_id', employeeId).order('subido_at', { ascending: false }).limit(300)
      setMisEnt(((mine as any[]) || []) as Entregable[])
    }
    setCargando(false)
  }
  useEffect(() => { cargar() }, [employeeId])

  useEffect(() => {
    if (!mando) return
    // El DG manda sobre todas las areas; un director, sobre la suya.
    if (mandoTotal) tareasDeAreas(AREAS_TRABAJO.map(a => a.specialty)).then(setArea)
    else if (miSpecialty) tareasDeArea(miSpecialty).then(setArea)
    pendientesDeRevision(mandoTotal ? undefined : miSpecialty || undefined).then(setPorRevisar)
  }, [mando, mandoTotal, miSpecialty])

  const corregir = misEnt.filter(x => x.estado === 'corregir')
  const esperando = misEnt.filter(x => x.estado === 'en_revision')

  if (!employeeId) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ ...card, color: '#D9A441', fontSize: 12.5, lineHeight: 1.7 }}>
          Tu usuario no está ligado a una ficha de empleado, así que el sistema no sabe qué actividades son tuyas.
          Se liga en <b>Usuarios</b>, escogiendo el empleado que te corresponde.
        </div>
      </div>
    )
  }

  const TABS = [
    { key: 'mio' as const, label: 'Lo mío', icono: ListChecks, n: mias.length, ver: true },
    { key: 'equipo' as const, label: 'Mi equipo', icono: Users, n: area.length, ver: mando },
    { key: 'nuevo' as const, label: 'Nuevo encargo', icono: Sparkles, n: null, ver: mando },
    { key: 'plantillas' as const, label: 'Plantillas', icono: LayoutTemplate, n: null, ver: mando },
  ].filter(t => t.ver)

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#eee', margin: 0 }}>Actividades</h1>
        <p style={{ fontSize: 12, color: '#777', margin: '4px 0 0' }}>
          {yo ? <>{yo.name} · <span style={{ color: ROL_CFG[miRol].color }}>{ROL_CFG[miRol].label}</span>{yo.area ? ` · ${yo.area}` : ''}</> : 'Tu trabajo, en un solo lugar.'}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => {
          const I = t.icono, activo = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              ...btn,
              borderColor: activo ? '#3b82f6' : '#333',
              background: activo ? '#111a26' : 'transparent',
              color: activo ? '#93c5fd' : '#888',
            }}>
              <I size={13} /> {t.label}
              {t.n != null && <span style={{ color: '#666', fontWeight: 600 }}>{t.n}</span>}
            </button>
          )
        })}
      </div>

      {cargando ? <div style={{ ...card, textAlign: 'center', color: '#666', padding: 40 }}>Cargando…</div> : (
        <>
          {tab === 'mio' && (
            <LoMio
              tareas={mias} corregir={corregir} esperando={esperando} tipos={tipos}
              employeeId={employeeId} nombreDe={nombreDe} onCambio={cargar} nav={nav}
              puedeRevisar={mando} emps={emps}
            />
          )}
          {tab === 'equipo' && (
            <MiEquipo
              area={area} emps={emps} miSpecialty={miSpecialty} esDG={esDG} mandoTotal={mandoTotal}
              porRevisar={porRevisar} employeeId={employeeId} nombreDe={nombreDe} tipos={tipos}
              onCambio={() => {
                if (mandoTotal) tareasDeAreas(AREAS_TRABAJO.map(a => a.specialty)).then(setArea)
                else if (miSpecialty) tareasDeArea(miSpecialty).then(setArea)
                pendientesDeRevision(esDG ? undefined : miSpecialty || undefined).then(setPorRevisar)
                cargar()
              }}
            />
          )}
          {tab === 'nuevo' && (
            <NuevoEncargo emps={emps} tipos={tipos} miSpecialty={miSpecialty}
              employeeId={employeeId} nombre={yo?.name} onCreado={cargar} />
          )}
          {tab === 'plantillas' && (
            <Plantillas emps={emps} tipos={tipos} miSpecialty={miSpecialty}
              employeeId={employeeId} nombre={yo?.name} onAplicada={cargar} />
          )}
        </>
      )}
    </div>
  )
}

// ═══ LO MÍO ════════════════════════════════════════════════════════════════

function LoMio({ tareas, corregir, esperando, tipos, employeeId, nombreDe, onCambio, puedeRevisar, emps }: {
  tareas: Tarea[]; corregir: Entregable[]; esperando: Entregable[]; tipos: TipoEntregable[]
  employeeId: string; nombreDe: (id?: string | null) => string; onCambio: () => void
  puedeRevisar: boolean; emps: EmpleadoRol[]; nav: any
}) {
  const [abierta, setAbierta] = useState('')
  // El punto de esta pantalla NO es ver todo: es ver lo de hoy. Con 29
  // actividades por proyecto y varios proyectos encima, una lista completa
  // es tan inútil como no tener lista — se cierra y se sigue trabajando de
  // memoria. Por eso el horizonte arranca en la semana.
  const [horizonte, setHorizonte] = useState<'hoy' | 'semana' | 'todo'>('semana')
  const hoy = hoyISO()
  const finSemana = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
  const todas = ordenarTareas(tareas)

  const enHorizonte = (t: Tarea) => {
    if (horizonte === 'todo') return true
    // Lo vencido y lo que no tiene fecha SIEMPRE se ve: es justo lo que se
    // pierde, y esconderlo detrás de un filtro sería el peor de los favores.
    if (!t.due_date || t.due_date < hoy) return true
    if (t.status === 'entregada') return true
    return horizonte === 'hoy' ? t.due_date === hoy : t.due_date <= finSemana
  }
  const lista = todas.filter(enHorizonte)
  const vencidas = todas.filter(t => t.due_date && t.due_date < hoy).length
  const semana = todas.filter(t => t.due_date && t.due_date >= hoy && t.due_date <= finSemana).length
  const sinFecha = todas.filter(t => !t.due_date).length

  const proyectos = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of todas) {
      const k = (t as any).project?.name || t.titulo_cliente || 'Sin proyecto'
      m.set(k, (m.get(k) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [todas])

  const nombreTipo = (id?: string | null) => tipos.find(t => t.id === id)?.nombre || null

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 18 }}>
        {([
          ['Vencidas', vencidas, vencidas > 0 ? '#DC2626' : '#10B981'],
          ['Esta semana', semana, '#D9A441'],
          ['Sin fecha', sinFecha, sinFecha > 0 ? '#D97706' : '#555'],
          ['Esperando revisión', esperando.length, esperando.length > 0 ? '#A78BFA' : '#555'],
          ['A corregir', corregir.length, corregir.length > 0 ? '#DC2626' : '#10B981'],
        ] as const).map(([l, v, c], i) => (
          <div key={i} style={card}>
            <div style={{ fontSize: 9.5, color: '#666', textTransform: 'uppercase', letterSpacing: '.06em' }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c as string, marginTop: 3 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* 1. Lo que me devolvieron: trabajo hecho que todavía no cuenta */}
      {corregir.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <h2 style={h2}>Te devolvieron a corregir</h2>
          <p style={sub}>Trabajo que ya hiciste y todavía no cuenta como entregado. Va primero por eso.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {corregir.map(e => (
              <div key={e.id} style={{ ...card, borderColor: '#3a1a1a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, color: '#eee', fontWeight: 500 }}>{e.nombre} <span style={{ color: '#666', fontSize: 10 }}>v{e.version}</span></div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>
                      {nombreDe(e.revisado_por_id)} · {e.revisado_at ? new Date(e.revisado_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : ''}
                    </div>
                    {(e.fallas && e.fallas.length > 0) && (
                      <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {e.fallas.map((f, i) => (
                          <span key={i} style={{ fontSize: 11, color: '#f4a5a5', border: '1px solid #DC262655', background: '#2a1010', borderRadius: 6, padding: '2px 7px' }}>✕ {f}</span>
                        ))}
                      </div>
                    )}
                    {e.correcciones && (
                      <div style={{ fontSize: 12.5, color: '#f4a5a5', marginTop: 7, lineHeight: 1.6, whiteSpace: 'pre-wrap', borderLeft: '2px solid #DC2626', paddingLeft: 10 }}>
                        {e.correcciones}
                      </div>
                    )}
                  </div>
                  <button onClick={() => setAbierta(v => v === e.task_id ? '' : (e.task_id || ''))} style={{ ...btn, alignSelf: 'flex-start' }}>
                    <Upload size={13} /> Volver a entregar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. Lo que debo entregar */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ ...h2, margin: 0 }}>Qué necesito entregar</h2>
        <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
          {([['hoy', 'Hoy'], ['semana', 'Esta semana'], ['todo', `Todo (${todas.length})`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setHorizonte(k)} style={{
              ...btn, padding: '4px 11px', fontSize: 11,
              borderColor: horizonte === k ? '#3b82f6' : '#333',
              background: horizonte === k ? '#111a26' : 'transparent',
              color: horizonte === k ? '#93c5fd' : '#888',
            }}>{l}</button>
          ))}
        </div>
      </div>
      <p style={sub}>
        Ordenadas por lo que se está perdiendo: primero lo vencido, después lo que no tiene fecha.
        {horizonte !== 'todo' && ' Lo vencido y lo que no tiene fecha se ve siempre, aunque cambies el horizonte.'}
      </p>
      <div style={{ ...card, padding: 0, marginBottom: 22 }}>
        {lista.length === 0 && (
          <div style={{ padding: 28, textAlign: 'center', color: '#666', fontSize: 12.5, lineHeight: 1.7 }}>
            {todas.length === 0
              ? 'No tienes actividades abiertas.'
              : horizonte === 'hoy'
                ? `Nada vence hoy. Tienes ${todas.length} actividad(es) más adelante.`
                : `Nada vence esta semana. Tienes ${todas.length} actividad(es) más adelante.`}
          </div>
        )}
        {lista.map(t => {
          const ef = estadoFecha(t)
          const tcfg = TIPO_CFG[t.tipo] || TIPO_CFG.otro
          const bloqueada = !!t.depende_de_id
          const ent = nombreTipo(t.tipo_entregable_id)
          return (
            <div key={t.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 14px',
                background: ef.estado === 'vencida' ? '#1c1212' : ef.estado === 'sin_fecha' ? '#1a1710' : 'transparent' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#eee' }}>{t.name}</div>
                  <div style={{ fontSize: 10.5, color: '#777', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ color: tcfg.color }}>{tcfg.icono} {tcfg.label}</span>
                    {(t as any).project?.name && <span>· {(t as any).project.name}</span>}
                    {t.titulo_cliente && <span>· {t.titulo_cliente}</span>}
                    {ent && <span style={{ color: '#67E8F9' }}>· espera: {ent}</span>}
                    {t.status === 'entregada' && <span style={{ color: '#D9A441', fontWeight: 700 }}>· en revisión</span>}
                    {(t.rondas_revision || 0) > 0 && <span style={{ color: '#DC2626' }}>· {t.rondas_revision} corrección(es)</span>}
                    {bloqueada && <span style={{ color: '#A78BFA' }}>· depende de otra actividad</span>}
                    {t.solicitada_por && <span style={{ color: '#555' }}>· pidió {t.solicitada_por}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <Badge label={ef.label} color={ef.color} />
                  <button onClick={() => setAbierta(v => v === t.id ? '' : t.id)} style={{ ...btn, borderColor: '#10B98155', color: '#10B981' }}>
                    <Upload size={12} /> Entregar
                  </button>
                </div>
              </div>
              {abierta === t.id && (
                <div style={{ padding: '4px 14px 16px 14px', background: '#0c0c0c' }}>
                  <EntregablesTarea
                    tarea={{
                      id: t.id, name: t.name, tipo_entregable_id: t.tipo_entregable_id,
                      instrucciones: t.instrucciones, specialty: t.specialty,
                      project_id: t.project_id, lead_id: t.lead_id, titulo_cliente: t.titulo_cliente,
                    }}
                    employeeId={employeeId}
                    puedeRevisar={puedeRevisar && t.solicitada_por_id === employeeId}
                    nombreDe={nombreDe}
                    onCambio={onCambio}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 3. Lo que ya no es mío */}
      {esperando.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <h2 style={h2}>Entregado, esperando respuesta</h2>
          <p style={sub}>Ya no está en tu cancha. Si lleva días parado, el número lo dice y es del que revisa.</p>
          <div style={{ ...card, padding: 0 }}>
            {esperando.map(e => {
              const d = diasEsperando(e)
              const url = urlDe(e)
              return (
                <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #1a1a1a', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontSize: 12.5, color: '#ddd' }}>{e.nombre} <span style={{ color: '#666', fontSize: 10 }}>v{e.version}</span></div>
                    <div style={{ fontSize: 10.5, color: colorEspera(d), marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={11} /> {d < 1 ? 'Subido hoy' : `Esperando ${Math.floor(d)} día(s)`}
                    </div>
                  </div>
                  {url && <a href={url} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none' }}><ExternalLink size={12} /> Abrir</a>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {proyectos.length > 0 && (
        <>
          <h2 style={h2}>Mis proyectos</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {proyectos.map(([p, n]) => (
              <div key={p} style={{ ...card, padding: '9px 13px' }}>
                <span style={{ fontSize: 12.5, color: '#ddd' }}>{p}</span>
                <span style={{ fontSize: 11, color: '#666', marginLeft: 8 }}>{n} actividad(es)</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

// ═══ MI EQUIPO ═════════════════════════════════════════════════════════════

function MiEquipo({ area, emps, miSpecialty, esDG, mandoTotal, porRevisar, employeeId, nombreDe, tipos, onCambio }: {
  area: Tarea[]; emps: EmpleadoRol[]; miSpecialty: string; esDG: boolean; mandoTotal: boolean
  porRevisar: Entregable[]; employeeId: string; nombreDe: (id?: string | null) => string
  tipos: TipoEntregable[]; onCambio: () => void
}) {
  const hoy = hoyISO()

  // El DG ve las cuatro areas con su cabeza; un director, solo la suya.
  const cadena = useMemo(
    () => cadenaDeMando(emps, mandoTotal ? undefined : [miSpecialty]),
    [emps, mandoTotal, miSpecialty])
  const sinCabeza = areasSinCabeza(cadena)
  const huerfanas = area.filter(t => !t.assignee_id)

  const conteos = (suyas: Tarea[]) => ({
    total: suyas.length,
    vencidas: suyas.filter(t => t.due_date && t.due_date < hoy).length,
    sinFecha: suyas.filter(t => !t.due_date).length,
    enRevision: suyas.filter(t => t.status === 'entregada').length,
  })
  // La carga se lee por area: primero la cabeza, debajo su gente. Una lista
  // plana de 15 nombres no dice de quien depende quien.
  const porArea = useMemo(() => cadena.map(a => {
    const fila = (p: EmpleadoRol) => {
      const suyas = area.filter(t => t.assignee_id === p.id)
      return { p, suyas, ...conteos(suyas) }
    }
    const equipo = a.equipo
      .map(fila)
      .sort((x, y) => (ROL_CFG[x.p.rol].orden - ROL_CFG[y.p.rol].orden) || y.total - x.total)
    return { a, director: a.director ? fila(a.director) : null, equipo }
  }), [cadena, area])

  async function repartir(t: Tarea, aQuien: string) {
    await delegar(t.id, aQuien, employeeId)
    onCambio()
  }
  async function ponerFecha(t: Tarea, f: string) {
    await actualizarTarea(t.id, { due_date: f })
    onCambio()
  }

  return (
    <>
      <h2 style={h2}>Tu respuesta pendiente ({porRevisar.length})</h2>
      <p style={sub}>
        Trabajo terminado que espera tu palabra. Cada día aquí es un día que alguien no puede avanzar ni cerrar —
        y ese reloj es tuyo, no suyo.
      </p>
      {porRevisar.length === 0 ? (
        <div style={{ ...card, color: '#666', fontSize: 12.5, marginBottom: 22 }}>Nada esperando tu revisión.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 22 }}>
          {porRevisar.map(e => {
            const d = diasEsperando(e), url = urlDe(e)
            return (
              <div key={e.id} style={{ ...card, borderColor: d >= 3 ? '#3a2a15' : '#222' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 13.5, color: '#eee', fontWeight: 500 }}>{e.nombre} <span style={{ color: '#666', fontSize: 10 }}>v{e.version}</span></div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>{nombreDe(e.subido_por_id)}{e.titulo_cliente ? ` · ${e.titulo_cliente}` : ''}</div>
                    <div style={{ fontSize: 11, color: colorEspera(d), marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={11} /> {d < 1 ? 'Subido hoy' : `Esperando ${Math.floor(d)} día(s)`}
                    </div>
                  </div>
                  {url && <a href={url} target="_blank" rel="noreferrer" style={{ ...btn, alignSelf: 'flex-start', textDecoration: 'none' }}><ExternalLink size={13} /> Abrir</a>}
                </div>
                <div style={{ marginTop: 9, borderTop: '1px solid #1c1c1c', paddingTop: 9 }}>
                  <RevisarEntregable e={e} tipos={tipos} employeeId={employeeId} nombreDe={nombreDe} onResuelto={onCambio} compacto />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Proyectos del área: el proceso ya corre, lo que falta es fecharlo.
          Sin fecha, una actividad no aparece en la semana de nadie — y hoy
          hay proyectos activos con las 29 actividades sin un solo día. */}
      <ProyectosDelArea area={area} onCambio={onCambio} todasLasAreas={mandoTotal} />

      {huerfanas.length > 0 && (
        <>
          <h2 style={h2}>Sin repartir ({huerfanas.length})</h2>
          <p style={sub}>
            {mandoTotal
              ? 'Actividades sin nombre y apellido. Se encargan al director del área; él las reparte adentro. Nadie reclama lo que no tiene dueño.'
              : 'Actividades de tu área que no tienen nombre y apellido. Nadie reclama lo que no tiene dueño.'}
          </p>
          <div style={{ ...card, padding: 0, marginBottom: 22 }}>
            {huerfanas.map(t => (
              <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 13px', borderBottom: '1px solid #1a1a1a', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 12.5, color: '#ddd' }}>{t.name}</div>
                  <div style={{ fontSize: 10.5, color: '#777', marginTop: 2 }}>
                    {t.rol && <span style={{ color: ROL_CFG[t.rol as Rol]?.color }}>Toca a: {ROL_CFG[t.rol as Rol]?.label || t.rol}</span>}
                    {t.titulo_cliente ? ` · ${t.titulo_cliente}` : ''}
                  </div>
                </div>
                <input type="date" value={t.due_date || ''} onChange={e => ponerFecha(t, e.target.value)}
                  style={{ ...inp, width: 128, fontSize: 11, borderColor: t.due_date ? '#242424' : '#DC262666' }} />
                <PasarLaEstafeta t={t} cadena={cadena} onPasar={repartir} />
              </div>
            ))}
          </div>
        </>
      )}

      <h2 style={h2}>Carga por área</h2>
      <p style={sub}>
        Cada área con su cabeza y su gente debajo. Abre a una persona para ver sus actividades
        y pasar una en concreto — de ahí solo bajas dentro de su propia área, para no perder el hilo.
      </p>
      {sinCabeza.length > 0 && (
        <div style={{ ...card, borderColor: '#3a2a15', color: '#D9A441', fontSize: 12, marginBottom: 10 }}>
          Sin director nombrado: {sinCabeza.map(a => a.label).join(', ')}. Hasta que alguien de esa
          área tenga puesto de director en Nómina, no hay a quién encargarle su trabajo.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {porArea.filter(g => g.director || g.equipo.length > 0).map(g => (
          <div key={g.a.specialty} style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', borderBottom: '1px solid #1c1c1c', background: '#141414' }}>
              <span style={{ width: 3, height: 14, background: g.a.color, borderRadius: 2 }} />
              <span style={{ fontSize: 12.5, color: '#ddd', fontWeight: 600 }}>{g.a.label}</span>
              <span style={{ fontSize: 11, color: '#666' }}>
                {g.director ? `Responde ${g.director.p.name}` : 'Sin director'}
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                <thead><tr>
                  {['Persona', 'Rol', 'Abiertas', 'Vencidas', 'Sin fecha', 'En revisión'].map((h, i) => (
                    <th key={i} style={{ textAlign: i > 1 ? 'right' : 'left', fontSize: 10, letterSpacing: .6, textTransform: 'uppercase', color: '#666', padding: '8px 10px', borderBottom: '1px solid #222' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {g.director && <FilaPersona key={g.director.p.id} r={g.director} cabeza cadena={cadena} onPasar={repartir} nombreDe={nombreDe} />}
                  {g.equipo.map(r => <FilaPersona key={r.p.id} r={r} cadena={cadena} onPasar={repartir} nombreDe={nombreDe} />)}
                  {!g.director && g.equipo.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#666', fontSize: 12 }}>Sin gente de gabinete registrada.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * Un renglon de la carga. Al abrirlo salen sus actividades, y cada una se puede
 * pasar por la cadena: nunca a media empresa de golpe, solo dentro de su area
 * o de vuelta a un director.
 */
function FilaPersona({ r, cabeza, cadena, onPasar, nombreDe }: {
  r: { p: EmpleadoRol; suyas: Tarea[]; total: number; vencidas: number; sinFecha: number; enRevision: number }
  cabeza?: boolean; cadena: AreaDeMando[]; onPasar: (t: Tarea, aQuien: string) => void
  nombreDe: (id?: string | null) => string
}) {
  const [abierta, setAbierta] = useState(false)
  const td: React.CSSProperties = { padding: '9px 10px', borderBottom: '1px solid #1a1a1a', fontSize: 12.5 }
  return (
    <>
      <tr onClick={() => r.total > 0 && setAbierta(v => !v)} style={{ cursor: r.total > 0 ? 'pointer' : 'default' }}>
        <td style={{ ...td, color: '#ddd', paddingLeft: cabeza ? 10 : 26 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {r.total > 0 && <ChevronRight size={11} style={{ color: '#666', transform: abierta ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }} />}
            {cabeza && <span style={{ fontSize: 9, color: '#2563EB', letterSpacing: .5 }}>▸</span>}
            {r.p.name}
          </span>
        </td>
        <td style={{ ...td, fontSize: 11.5, color: ROL_CFG[r.p.rol].color }}>
          {(r.p.roles || [r.p.rol]).map(x => ROL_CFG[x].label).join(' + ')}
        </td>
        <td style={{ ...td, color: '#aaa', textAlign: 'right' }}>{r.total}</td>
        <td style={{ ...td, color: r.vencidas > 0 ? '#DC2626' : '#555', textAlign: 'right' }}>{r.vencidas}</td>
        <td style={{ ...td, color: r.sinFecha > 0 ? '#D9A441' : '#555', textAlign: 'right' }}>{r.sinFecha}</td>
        <td style={{ ...td, color: r.enRevision > 0 ? '#A78BFA' : '#555', textAlign: 'right' }}>{r.enRevision}</td>
      </tr>
      {abierta && r.suyas.map(t => (
        <tr key={t.id}>
          <td colSpan={6} style={{ padding: '7px 10px 7px 34px', borderBottom: '1px solid #1a1a1a', background: '#0e0e0e' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, color: '#ccc' }}>{t.name}</div>
                <div style={{ fontSize: 10.5, color: '#777', marginTop: 2 }}>
                  {t.due_date ? t.due_date : 'Sin fecha'}
                  {t.titulo_cliente ? ` · ${t.titulo_cliente}` : ''}
                  {t.delegada_por_id ? ` · la bajó ${nombreDe(t.delegada_por_id)}` : ''}
                </div>
              </div>
              <PasarLaEstafeta t={t} cadena={cadena} onPasar={onPasar} />
            </div>
          </td>
        </tr>
      ))}
    </>
  )
}

/**
 * El control de mando. Sin dueño solo ofrece directores: el trabajo se encarga
 * al área. Ya con dueño, deja bajar un nivel DENTRO de esa misma área, o
 * devolverla a otro director — nunca brincar de un área a la gente de otra.
 */
function PasarLaEstafeta({ t, cadena, onPasar }: {
  t: Tarea; cadena: AreaDeMando[]; onPasar: (t: Tarea, aQuien: string) => void
}) {
  const [bajando, setBajando] = useState(false)
  const { directores, equipo, areaActual } = aQuienPuedoPasarla(cadena, t.assignee_id)
  const puedeBajar = equipo.length > 0

  if (bajando && puedeBajar) {
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <select defaultValue="" onChange={e => e.target.value && onPasar(t, e.target.value)}
          style={{ ...inp, width: 210, fontSize: 11 }}>
          <option value="">Bajar dentro de {areaActual?.label}…</option>
          {equipo.filter(x => !t.rol || x.rol === t.rol).map(x => (
            <option key={x.id} value={x.id}>{x.nombre} · {x.rolLabel}</option>
          ))}
          <optgroup label="Otros roles del área">
            {equipo.filter(x => t.rol && x.rol !== t.rol).map(x => (
              <option key={x.id} value={x.id}>{x.nombre} · {x.rolLabel}</option>
            ))}
          </optgroup>
        </select>
        <button onClick={() => setBajando(false)} style={{ ...btn, padding: '5px 8px', fontSize: 10.5 }}>Cancelar</button>
      </span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <select defaultValue="" onChange={e => e.target.value && onPasar(t, e.target.value)}
        style={{ ...inp, width: 200, fontSize: 11 }}>
        <option value="">{t.assignee_id ? 'Pasar a otro director…' : 'Encargar al director…'}</option>
        {directores.map(x => (
          <option key={x.id} value={x.id}>{x.areaLabel} · {x.nombre}</option>
        ))}
      </select>
      {puedeBajar && (
        <button onClick={() => setBajando(true)} title={`Asignar a alguien del equipo de ${areaActual?.label}`}
          style={{ ...btn, padding: '5px 8px', fontSize: 10.5 }}>Bajar un nivel</button>
      )}
    </span>
  )
}

function ProyectosDelArea({ area, onCambio, todasLasAreas }: { area: Tarea[]; onCambio: () => void; todasLasAreas?: boolean }) {
  const [abierto, setAbierto] = useState('')
  const [fecha, setFecha] = useState('')
  const [busy, setBusy] = useState(false)
  const hoy = hoyISO()

  const porProyecto = useMemo(() => {
    const m = new Map<string, { nombre: string; tareas: Tarea[] }>()
    for (const t of area) {
      if (!t.project_id) continue
      const k = t.project_id
      const g = m.get(k)
      if (g) g.tareas.push(t)
      else m.set(k, { nombre: (t as any).project?.name || 'Proyecto', tareas: [t] })
    }
    return [...m.entries()]
      .map(([id, v]) => ({
        id, nombre: v.nombre, total: v.tareas.length,
        sinFecha: v.tareas.filter(t => !t.due_date).length,
        sinDueno: v.tareas.filter(t => !t.assignee_id).length,
        vencidas: v.tareas.filter(t => t.due_date && t.due_date < hoy).length,
        tareas: v.tareas,
      }))
      .sort((a, b) => b.sinFecha - a.sinFecha)
  }, [area])

  if (porProyecto.length === 0) return null

  /**
   * Fechar de golpe lo que no tiene día. No inventa un cronograma: pone la
   * misma fecha límite a todo lo que está en blanco, para sacarlo del limbo
   * en un movimiento. Afinar cada fecha después es barato; que 29 actividades
   * sigan sin día no lo es.
   */
  async function fecharTodo(p: { tareas: Tarea[] }) {
    if (!fecha) return
    setBusy(true)
    const sinFecha = p.tareas.filter(t => !t.due_date)
    for (let i = 0; i < sinFecha.length; i += 25) {
      await Promise.all(sinFecha.slice(i, i + 25).map(t => actualizarTarea(t.id, { due_date: fecha })))
    }
    setBusy(false); setAbierto(''); setFecha('')
    onCambio()
  }

  return (
    <>
      <h2 style={h2}>{todasLasAreas ? 'Proyectos de la casa' : 'Proyectos de tu área'}</h2>
      <p style={sub}>
        El proceso ya viene armado con sus fases y revisiones. Lo único que hace falta para que aparezca en la
        semana de alguien es que tenga <b style={{ color: '#aaa' }}>fecha</b> — sin día, una actividad no existe
        para nadie.
      </p>
      <div style={{ ...card, padding: 0, marginBottom: 22, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 660 }}>
          <thead><tr>
            {['Proyecto', 'Actividades', 'Sin fecha', 'Sin dueño', 'Vencidas', ''].map((h, i) => (
              <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', fontSize: 10, letterSpacing: .6, textTransform: 'uppercase', color: '#666', padding: '8px 10px', borderBottom: '1px solid #222' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {porProyecto.map(p => (
              <React.Fragment key={p.id}>
                <tr>
                  <td style={{ fontSize: 12.5, color: '#ddd', padding: '9px 10px', borderBottom: '1px solid #1a1a1a' }}>{p.nombre}</td>
                  <td style={{ fontSize: 12.5, color: '#aaa', padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid #1a1a1a' }}>{p.total}</td>
                  <td style={{ fontSize: 12.5, color: p.sinFecha > 0 ? '#DC2626' : '#10B981', fontWeight: 600, padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid #1a1a1a' }}>{p.sinFecha}</td>
                  <td style={{ fontSize: 12.5, color: p.sinDueno > 0 ? '#D9A441' : '#555', padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid #1a1a1a' }}>{p.sinDueno}</td>
                  <td style={{ fontSize: 12.5, color: p.vencidas > 0 ? '#DC2626' : '#555', padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid #1a1a1a' }}>{p.vencidas}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid #1a1a1a' }}>
                    {p.sinFecha > 0 && (
                      <button onClick={() => setAbierto(abierto === p.id ? '' : p.id)} style={{ ...btn, padding: '4px 9px', fontSize: 11 }}>
                        Poner fecha a las {p.sinFecha}
                      </button>
                    )}
                  </td>
                </tr>
                {abierto === p.id && (
                  <tr>
                    <td colSpan={6} style={{ padding: '10px 12px', background: '#0c0c0c', borderBottom: '1px solid #1a1a1a' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11.5, color: '#999' }}>Fecha límite para las {p.sinFecha} sin día:</span>
                        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ ...inp, width: 140 }} />
                        <button onClick={() => fecharTodo(p)} disabled={!fecha || busy}
                          style={{ ...btn, borderColor: '#10B981', color: '#10B981', opacity: !fecha || busy ? .5 : 1 }}>
                          {busy ? 'Guardando…' : 'Aplicar'}
                        </button>
                        <span style={{ fontSize: 10.5, color: '#666', flex: 1, minWidth: 220 }}>
                          Pone la misma fecha a todo lo que está en blanco. Sirve para sacarlas del limbo hoy;
                          afinar cada una después es barato — dejarlas sin día no.
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ═══ NUEVO ENCARGO (IA) ════════════════════════════════════════════════════

function NuevoEncargo({ emps, tipos, miSpecialty, employeeId, nombre, onCreado }: {
  emps: EmpleadoRol[]; tipos: TipoEntregable[]; miSpecialty: string
  employeeId: string; nombre?: string; onCreado: () => void
}) {
  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState('proyecto')
  const [sp, setSp] = useState(miSpecialty || 'elec')
  const [titulo, setTitulo] = useState('')
  const [objetivo, setObjetivo] = useState('')
  const [pensando, setPensando] = useState(false)
  const [plan, setPlan] = useState<PlanPropuesto | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (miSpecialty) setSp(miSpecialty) }, [miSpecialty])

  async function pensar() {
    setErr(''); setMsg(''); setPensando(true)
    const r = await sugerirPlan({ texto, tipo, specialty: sp, fechaObjetivo: objetivo || null, titulo: titulo || null })
    setPensando(false)
    if (r.error) return setErr(r.error)
    setPlan(r.plan!)
  }

  function editar(i: number, campo: keyof ActividadPlantilla, valor: any) {
    setPlan(p => p ? { ...p, actividades: p.actividades.map((a, j) => j === i ? { ...a, [campo]: valor } : a) } : p)
  }
  function quitar(i: number) {
    setPlan(p => p ? { ...p, actividades: p.actividades.filter((_, j) => j !== i).map((a, k) => ({ ...a, orden: k, depende_de: null })) } : p)
  }

  async function crear(tambienPlantilla: boolean) {
    if (!plan) return
    setBusy(true); setErr(''); setMsg('')
    let plantillaId: string | undefined
    if (tambienPlantilla) {
      const g = await guardarPlantilla(
        { nombre: plan.nombre, tipo, specialty: sp, descripcion: plan.resumen, origen: 'ia' },
        plan.actividades, employeeId)
      if (g.error) { setBusy(false); return setErr(g.error) }
      plantillaId = g.id
    }
    const r = await crearActividades(plan.actividades, {
      specialty: sp,
      fechaObjetivo: objetivo || null,
      tituloCliente: titulo || null,
      prefijo: titulo || null,
      solicitadaPor: nombre || null,
      solicitadaPorId: employeeId,
      instrucciones: texto.slice(0, 2000) || null,
    }, emps, plantillaId)
    setBusy(false)
    if (r.error) return setErr(r.error)
    setMsg(`Listo: ${r.creadas} actividad(es) creadas.` +
      (r.sinDueno ? ` ${r.sinDueno} quedaron sin dueño porque hay más de una persona con ese rol — repártelas en "Mi equipo".` : '') +
      (r.enElPasado ? ` ${r.enElPasado} nacieron con fecha en el pasado: el encargo llegó tarde para ese compromiso.` : '') +
      (tambienPlantilla ? ' La plantilla quedó guardada.' : ''))
    setPlan(null); setTexto('')
    onCreado()
  }

  const sinDueno = plan ? sinDuenoDe(plan.actividades, emps, sp) : 0

  return (
    <>
      <h2 style={h2}>Nuevo encargo</h2>
      <p style={sub}>
        Pega el levantamiento, el scope o lo que te llegó por WhatsApp. La IA lo convierte en una cadena de
        actividades con rol, orden y fechas contadas hacia atrás desde el compromiso. <b style={{ color: '#aaa' }}>Propone;
        no crea nada hasta que tú lo apruebes</b>, y no asigna personas — eso lo decides tú, que sabes quién está saturado.
      </p>

      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 9, marginBottom: 9 }}>
          <select value={tipo} onChange={e => setTipo(e.target.value)} style={inp}
            title={TIPOS_ENCARGO.find(t => t.key === tipo)?.descripcion}>
            {TIPOS_ENCARGO.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            <option value="mejora">Mejora interna</option>
            <option value="repetida">Actividad repetida</option>
          </select>
          <select value={sp} onChange={e => setSp(e.target.value)} style={inp}>
            {AREAS_TRABAJO.map(a => <option key={a.specialty} value={a.specialty}>{a.label}</option>)}
          </select>
          <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Proyecto o cliente" style={inp} />
          <div>
            <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }}>Fecha comprometida</div>
            <input type="date" value={objetivo} onChange={e => setObjetivo(e.target.value)} style={{ ...inp, width: '100%' }} />
          </div>
        </div>
        {(() => {
          const t = TIPOS_ENCARGO.find(x => x.key === tipo)
          if (!t) return null
          return (
            <div style={{ fontSize: 11.5, color: '#888', marginBottom: 9, lineHeight: 1.6 }}>
              <b style={{ color: '#aaa' }}>{t.label}:</b> {t.descripcion} Termina en {t.termina_en}.
            </div>
          )
        })()}
        <textarea value={texto} onChange={e => setTexto(e.target.value)}
          placeholder="Ej: Casa en Valle de Bravo, 620 m2. Necesitan sembrado eléctrico para arrancar obra. El arquitecto manda planos el lunes."
          style={{ ...inp, width: '100%', minHeight: 110, resize: 'vertical', lineHeight: 1.6 }} />
        <div style={{ fontSize: 11, color: '#777', marginTop: 6, lineHeight: 1.6 }}>
          El plan es <b style={{ color: '#aaa' }}>de una sola área</b>. Si el encargo toca varias, corre la sugerencia
          una vez por cada una: cada director recibe su cadena y nadie hereda trabajo de otro.
        </div>
        <button onClick={pensar} disabled={pensando || !texto.trim()}
          style={{ ...btn, marginTop: 10, borderColor: '#3b82f6', color: '#93c5fd', opacity: pensando || !texto.trim() ? .5 : 1 }}>
          <Sparkles size={13} /> {pensando ? 'Pensando el plan…' : 'Sugerir actividades'}
        </button>
        {err && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 9 }}>{err}</div>}
        {msg && <div style={{ fontSize: 12, color: '#10B981', marginTop: 9, lineHeight: 1.6 }}>{msg}</div>}
      </div>

      {plan && (
        <PlanEditable
          plan={plan} tipos={tipos} sp={sp} objetivo={objetivo} sinDueno={sinDueno} busy={busy}
          onEditar={editar} onQuitar={quitar}
          onNombre={v => setPlan(p => p ? { ...p, nombre: v } : p)}
          acciones={
            <>
              <button onClick={() => crear(false)} disabled={busy} style={{ ...btn, borderColor: '#10B981', color: '#10B981' }}>
                <Play size={13} /> {busy ? 'Creando…' : 'Crear actividades'}
              </button>
              <button onClick={() => crear(true)} disabled={busy} style={{ ...btn, borderColor: '#A78BFA', color: '#A78BFA' }}>
                <Save size={13} /> Crear y guardar como plantilla
              </button>
              <button onClick={() => setPlan(null)} style={btn}>Descartar</button>
            </>
          }
        />
      )}
    </>
  )
}

// ═══ PLANTILLAS ════════════════════════════════════════════════════════════

function Plantillas({ emps, tipos, miSpecialty, employeeId, nombre, onAplicada }: {
  emps: EmpleadoRol[]; tipos: TipoEntregable[]; miSpecialty: string
  employeeId: string; nombre?: string; onAplicada: () => void
}) {
  const [lista, setLista] = useState<PlantillaEncargo[]>([])
  const [abierta, setAbierta] = useState('')
  const [acts, setActs] = useState<Record<string, ActividadPlantilla[]>>({})
  const [aplicar, setAplicar] = useState('')
  const [form, setForm] = useState({ titulo: '', objetivo: '' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function cargar() { setLista(await cargarPlantillas()) }
  useEffect(() => { cargar() }, [])

  async function abrir(p: PlantillaEncargo) {
    if (abierta === p.id) { setAbierta(''); return }
    setAbierta(p.id)
    if (!acts[p.id]) setActs(a => ({ ...a, [p.id]: [] }))
    const list = await actividadesDe(p.id)
    setActs(a => ({ ...a, [p.id]: list }))
  }

  async function correr(p: PlantillaEncargo) {
    setBusy(true); setMsg('')
    const r = await aplicarPlantilla(p.id, {
      specialty: p.specialty || miSpecialty || 'elec',
      fechaObjetivo: form.objetivo || null,
      tituloCliente: form.titulo || null,
      prefijo: form.titulo || null,
      solicitadaPor: nombre || null,
      solicitadaPorId: employeeId,
    }, emps)
    setBusy(false)
    if (r.error) return setMsg('Error: ' + r.error)
    setMsg(`${r.creadas} actividad(es) creadas.` +
      (r.sinDueno ? ` ${r.sinDueno} sin dueño, repártelas en "Mi equipo".` : '') +
      (r.enElPasado ? ` ${r.enElPasado} con fecha ya vencida: el encargo llegó tarde.` : ''))
    setAplicar(''); setForm({ titulo: '', objetivo: '' })
    cargar(); onAplicada()
  }

  return (
    <>
      <h2 style={h2}>Plantillas de encargo</h2>
      <p style={sub}>
        El cascadeo escrito una vez. La IA propone la primera versión; ustedes la corrigen y a partir de ahí manda
        el estándar de la casa, no el criterio del modelo. Dos proyectos iguales deben llevar el mismo plan —
        si cada uno se improvisa, no hay nada que comparar.
      </p>
      {msg && <div style={{ ...card, marginBottom: 12, fontSize: 12, color: msg.startsWith('Error') ? '#DC2626' : '#10B981' }}>{msg}</div>}

      {/* Quién responde de qué. Es la frontera que usa el sistema para
          repartir y la que lee la IA antes de proponer un plan. Lo que dice
          "no hace" pesa tanto como lo de arriba: un rol definido solo por lo
          que hace se expande hasta comerse el de al lado. */}
      <details style={{ ...card, marginBottom: 14 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12.5, color: '#93c5fd', fontWeight: 500 }}>
          Quién es responsable de qué
        </summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12, marginTop: 12 }}>
          {ROLES_GABINETE.map(r => {
            const al = ALCANCE_ROL[r]
            return (
              <div key={r} style={{ background: '#0e0e0e', border: '1px solid #1f1f1f', borderRadius: 9, padding: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: ROL_CFG[r].color }}>{ROL_CFG[r].label}</div>
                <div style={{ fontSize: 11.5, color: '#999', margin: '4px 0 8px', lineHeight: 1.55 }}>{al.resumen}</div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: '#bbb', lineHeight: 1.6 }}>
                  {al.hace.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
                <div style={{ fontSize: 10.5, color: '#a06a6a', marginTop: 7, lineHeight: 1.6 }}>
                  <b>No hace:</b> {al.noHace.join(' · ')}
                </div>
              </div>
            )
          })}
        </div>
      </details>

      {lista.length === 0 && (
        <div style={{ ...card, color: '#666', fontSize: 12.5, lineHeight: 1.7 }}>
          Todavía no hay plantillas. Ve a <b style={{ color: '#93c5fd' }}>Nuevo encargo</b>, pega un scope real,
          deja que la IA proponga el plan, corrígelo y guárdalo. La segunda vez que llegue un encargo así, ya no
          necesitas la IA.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {lista.map(p => (
          <div key={p.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200, cursor: 'pointer' }} onClick={() => abrir(p)}>
                <div style={{ fontSize: 14, color: '#eee', fontWeight: 500 }}>
                  {p.nombre}
                  {p.origen === 'ia' && <span style={{ fontSize: 9.5, color: '#A78BFA', border: '1px solid #A78BFA44', borderRadius: 5, padding: '1px 5px', marginLeft: 7 }}>propuesta por IA</span>}
                </div>
                {p.descripcion && <p style={{ fontSize: 12, color: '#888', margin: '4px 0 0', lineHeight: 1.55 }}>{p.descripcion}</p>}
                <div style={{ fontSize: 10.5, color: '#666', marginTop: 5 }}>
                  {p.tipo}{p.specialty ? ` · ${AREAS_TRABAJO.find(a => a.specialty === p.specialty)?.label || p.specialty}` : ''}
                  {p.recurrencia ? ` · se repite ${p.recurrencia}` : ''} · usada {p.veces_usada} vez(ces)
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setAplicar(v => v === p.id ? '' : p.id)} style={{ ...btn, borderColor: '#10B98155', color: '#10B981' }}>
                  <Play size={12} /> Aplicar
                </button>
                <button onClick={async () => { if (confirm(`¿Archivar la plantilla "${p.nombre}"? Las actividades ya creadas no se tocan.`)) { await borrarPlantilla(p.id); cargar() } }}
                  style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', display: 'flex', alignSelf: 'center' }}><Trash2 size={13} /></button>
              </div>
            </div>

            {aplicar === p.id && (
              <div style={{ marginTop: 11, borderTop: '1px solid #1c1c1c', paddingTop: 11, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }}>Proyecto o cliente</div>
                  <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Casa Cúspide" style={{ ...inp, width: 190 }} />
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }}>Fecha comprometida</div>
                  <input type="date" value={form.objetivo} onChange={e => setForm(f => ({ ...f, objetivo: e.target.value }))} style={{ ...inp, width: 150 }} />
                </div>
                <button onClick={() => correr(p)} disabled={busy} style={{ ...btn, borderColor: '#10B981', color: '#10B981' }}>
                  {busy ? 'Creando…' : 'Crear las actividades'}
                </button>
              </div>
            )}

            {abierta === p.id && (
              <div style={{ marginTop: 11, borderTop: '1px solid #1c1c1c', paddingTop: 11 }}>
                {(acts[p.id] || []).map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '5px 0', fontSize: 12 }}>
                    <span style={{ color: '#555', width: 16, flexShrink: 0 }}>{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ color: '#ddd' }}>{a.nombre}</span>
                      <span style={{ color: ROL_CFG[a.rol]?.color, fontSize: 11, marginLeft: 8 }}>{ROL_CFG[a.rol]?.label}</span>
                      {a.tipo_entregable_id && <span style={{ color: '#67E8F9', fontSize: 11, marginLeft: 8 }}>· {tipos.find(t => t.id === a.tipo_entregable_id)?.nombre}</span>}
                      <span style={{ color: '#666', fontSize: 11, marginLeft: 8 }}>
                        {a.dias_antes_entrega != null ? `· ${a.dias_antes_entrega}d antes de entregar` : a.dias_desde_inicio != null ? `· día ${a.dias_desde_inicio}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
                {(acts[p.id] || []).length === 0 && <div style={{ fontSize: 11.5, color: '#666' }}>Cargando actividades…</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
