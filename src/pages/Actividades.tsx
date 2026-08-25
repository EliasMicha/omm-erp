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
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Badge } from '../components/layout/UI'
import {
  Tarea, TIPO_CFG, URGENCIA_TAREA_CFG, AREAS_TRABAJO,
  tareasDe, tareasDeArea, delegar, actualizarTarea, estadoFecha, ordenarTareas,
} from '../lib/tareas'
import {
  Entregable, ESTADO_CFG, entregablesDe, pendientesDeRevision, revisar,
  diasEsperando, colorEspera, urlDe, cargarTipos, TipoEntregable,
} from '../lib/entregables'
import { Rol, ROL_CFG, ROLES_GABINETE, EmpleadoRol, conRol } from '../lib/roles'
import {
  PlantillaEncargo, ActividadPlantilla, cargarPlantillas, actividadesDe,
  guardarPlantilla, borrarPlantilla, aplicarPlantilla, crearActividades, fechaDe,
} from '../lib/plantillas'
import { sugerirPlan, PlanPropuesto, sinDuenoDe } from '../lib/actividadesIA'
import EntregablesTarea from '../components/EntregablesTarea'
import RevisarEntregable from '../components/RevisarEntregable'
import {
  ListChecks, Users, Sparkles, LayoutTemplate, AlertTriangle, Clock, RotateCcw,
  Check, ExternalLink, Upload, Trash2, Plus, Play, Save, ChevronRight,
} from 'lucide-react'

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
  const miSpecialty = useMemo(
    () => AREAS_TRABAJO.find(a => a.area === yo?.area)?.specialty || '', [yo])
  const nombreDe = (id?: string | null) => emps.find(e => e.id === id)?.name || '—'

  async function cargar() {
    setCargando(true)
    const [{ data: e }, ts] = await Promise.all([
      supabase.from('employees').select('id,name,area,puesto').eq('is_active', true).order('name'),
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
    if (miSpecialty) tareasDeArea(miSpecialty).then(setArea)
    pendientesDeRevision(esDG ? undefined : miSpecialty || undefined).then(setPorRevisar)
  }, [mando, miSpecialty, esDG])

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
              area={area} emps={emps} miSpecialty={miSpecialty} esDG={esDG}
              porRevisar={porRevisar} employeeId={employeeId} nombreDe={nombreDe} tipos={tipos}
              onCambio={() => {
                if (miSpecialty) tareasDeArea(miSpecialty).then(setArea)
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
  const hoy = hoyISO()
  const lista = ordenarTareas(tareas)
  const vencidas = lista.filter(t => t.due_date && t.due_date < hoy).length
  const semana = lista.filter(t => t.due_date && t.due_date >= hoy && t.due_date <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).length
  const sinFecha = lista.filter(t => !t.due_date).length

  const proyectos = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of lista) {
      const k = (t as any).project?.name || t.titulo_cliente || 'Sin proyecto'
      m.set(k, (m.get(k) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [lista])

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
      <h2 style={h2}>Mis próximas entregas</h2>
      <p style={sub}>Ordenadas por lo que se está perdiendo: primero lo vencido, después lo que no tiene fecha.</p>
      <div style={{ ...card, padding: 0, marginBottom: 22 }}>
        {lista.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: '#666', fontSize: 12.5 }}>No tienes actividades abiertas.</div>}
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

function MiEquipo({ area, emps, miSpecialty, esDG, porRevisar, employeeId, nombreDe, tipos, onCambio }: {
  area: Tarea[]; emps: EmpleadoRol[]; miSpecialty: string; esDG: boolean
  porRevisar: Entregable[]; employeeId: string; nombreDe: (id?: string | null) => string
  tipos: TipoEntregable[]; onCambio: () => void
}) {
  const hoy = hoyISO()

  const areaNombre = AREAS_TRABAJO.find(a => a.specialty === miSpecialty)?.area
  const equipo = emps.filter(e => (!areaNombre || e.area === areaNombre) && ROLES_GABINETE.includes(e.rol))
  const huerfanas = area.filter(t => !t.assignee_id)

  const porPersona = useMemo(() => equipo.map(p => {
    const suyas = area.filter(t => t.assignee_id === p.id)
    return {
      p,
      total: suyas.length,
      vencidas: suyas.filter(t => t.due_date && t.due_date < hoy).length,
      sinFecha: suyas.filter(t => !t.due_date).length,
      enRevision: suyas.filter(t => t.status === 'entregada').length,
    }
  }).sort((a, b) => (ROL_CFG[a.p.rol].orden - ROL_CFG[b.p.rol].orden) || b.total - a.total), [equipo, area])

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

      {huerfanas.length > 0 && (
        <>
          <h2 style={h2}>Sin repartir ({huerfanas.length})</h2>
          <p style={sub}>Actividades de tu área que no tienen nombre y apellido. Nadie reclama lo que no tiene dueño.</p>
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
                <select defaultValue="" onChange={e => e.target.value && repartir(t, e.target.value)} style={{ ...inp, width: 190, fontSize: 11 }}>
                  <option value="">Asignar a…</option>
                  {equipo.filter(x => !t.rol || x.rol === t.rol).map(x => <option key={x.id} value={x.id}>{x.name} · {ROL_CFG[x.rol].label}</option>)}
                  <optgroup label="Otros roles">
                    {equipo.filter(x => t.rol && x.rol !== t.rol).map(x => <option key={x.id} value={x.id}>{x.name} · {ROL_CFG[x.rol].label}</option>)}
                  </optgroup>
                </select>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 style={h2}>Carga por persona</h2>
      <p style={sub}>Quién trae qué. Si alguien tiene cero, o no le has repartido o no lo estás midiendo.</p>
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <thead><tr>
            {['Persona', 'Rol', 'Abiertas', 'Vencidas', 'Sin fecha', 'En revisión'].map((h, i) => (
              <th key={i} style={{ textAlign: i > 1 ? 'right' : 'left', fontSize: 10, letterSpacing: .6, textTransform: 'uppercase', color: '#666', padding: '8px 10px', borderBottom: '1px solid #222' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {porPersona.length === 0 && <tr><td colSpan={6} style={{ padding: 26, textAlign: 'center', color: '#666', fontSize: 12.5 }}>Tu área no tiene gente de gabinete registrada.</td></tr>}
            {porPersona.map(r => (
              <tr key={r.p.id}>
                <td style={{ fontSize: 12.5, color: '#ddd', padding: '9px 10px', borderBottom: '1px solid #1a1a1a' }}>{r.p.name}</td>
                <td style={{ fontSize: 11.5, color: ROL_CFG[r.p.rol].color, padding: '9px 10px', borderBottom: '1px solid #1a1a1a' }}>{ROL_CFG[r.p.rol].label}</td>
                <td style={{ fontSize: 12.5, color: '#aaa', padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid #1a1a1a' }}>{r.total}</td>
                <td style={{ fontSize: 12.5, color: r.vencidas > 0 ? '#DC2626' : '#555', padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid #1a1a1a' }}>{r.vencidas}</td>
                <td style={{ fontSize: 12.5, color: r.sinFecha > 0 ? '#D9A441' : '#555', padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid #1a1a1a' }}>{r.sinFecha}</td>
                <td style={{ fontSize: 12.5, color: r.enRevision > 0 ? '#A78BFA' : '#555', padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid #1a1a1a' }}>{r.enRevision}</td>
              </tr>
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
          <select value={tipo} onChange={e => setTipo(e.target.value)} style={inp}>
            <option value="proyecto">Proyecto</option>
            <option value="cotizacion">Cotización</option>
            <option value="levantamiento">Levantamiento</option>
            <option value="licitacion">Licitación</option>
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
        <textarea value={texto} onChange={e => setTexto(e.target.value)}
          placeholder="Ej: Casa en Valle de Bravo, 620 m2. Necesitan sembrado eléctrico e iluminación para arrancar obra. El arquitecto manda planos el lunes. Quieren presupuesto también."
          style={{ ...inp, width: '100%', minHeight: 110, resize: 'vertical', lineHeight: 1.6 }} />
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

function PlanEditable({ plan, tipos, sp, objetivo, sinDueno, onEditar, onQuitar, onNombre, acciones }: {
  plan: PlanPropuesto; tipos: TipoEntregable[]; sp: string; objetivo: string
  sinDueno: number; busy: boolean
  onEditar: (i: number, c: keyof ActividadPlantilla, v: any) => void
  onQuitar: (i: number) => void
  onNombre: (v: string) => void
  acciones: React.ReactNode
}) {
  const inicio = hoyISO()
  return (
    <div style={card}>
      <input value={plan.nombre} onChange={e => onNombre(e.target.value)}
        style={{ ...inp, fontSize: 15, fontWeight: 600, width: '100%', marginBottom: 6 }} />
      {plan.resumen && <p style={{ fontSize: 12, color: '#999', margin: '0 0 10px', lineHeight: 1.6 }}>{plan.resumen}</p>}

      {(plan.advertencias.length > 0 || plan.descartadas.length > 0) && (
        <div style={{ background: '#141109', border: '1px solid #2a2416', borderRadius: 8, padding: '9px 11px', marginBottom: 11 }}>
          {plan.advertencias.map((a, i) => (
            <div key={i} style={{ fontSize: 11.5, color: '#c9b78a', lineHeight: 1.6, display: 'flex', gap: 6 }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} /> {a}
            </div>
          ))}
          {plan.descartadas.map((a, i) => (
            <div key={'d' + i} style={{ fontSize: 11.5, color: '#a08c5e', lineHeight: 1.6, marginTop: 3 }}>Descartado: {a}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {plan.actividades.map((a, i) => {
          const { fecha, enElPasado } = fechaDe(a, inicio, objetivo || null)
          const opciones = tipos.filter(t => !t.specialty || t.specialty === (a.specialty || sp))
          return (
            <div key={i} style={{ background: '#0e0e0e', border: `1px solid ${enElPasado ? '#3a2a15' : '#1f1f1f'}`, borderRadius: 9, padding: 11 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: '#555', width: 16 }}>{i + 1}</span>
                <input value={a.nombre} onChange={e => onEditar(i, 'nombre', e.target.value)} style={{ ...inp, flex: 1, minWidth: 200 }} />
                <select value={a.rol} onChange={e => onEditar(i, 'rol', e.target.value)}
                  style={{ ...inp, width: 130, color: ROL_CFG[a.rol]?.color }}>
                  {ROLES_GABINETE.map(r => <option key={r} value={r}>{ROL_CFG[r].label}</option>)}
                </select>
                <button onClick={() => onQuitar(i)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', display: 'flex' }}><Trash2 size={13} /></button>
              </div>
              {a.descripcion && <div style={{ fontSize: 11.5, color: '#888', margin: '0 0 7px 24px', lineHeight: 1.55 }}>{a.descripcion}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginLeft: 24 }}>
                <select value={a.tipo_entregable_id || ''} onChange={e => onEditar(i, 'tipo_entregable_id', e.target.value || null)} style={{ ...inp, minWidth: 190, fontSize: 11 }}>
                  <option value="">Sin entregable formal</option>
                  {opciones.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
                {objetivo ? (
                  <label style={{ fontSize: 10.5, color: '#888', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input type="number" value={a.dias_antes_entrega ?? 0} min={0}
                      onChange={e => onEditar(i, 'dias_antes_entrega', Number(e.target.value))}
                      style={{ ...inp, width: 58, fontSize: 11 }} />
                    días antes de la entrega
                  </label>
                ) : (
                  <label style={{ fontSize: 10.5, color: '#888', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input type="number" value={a.dias_desde_inicio ?? 0} min={0}
                      onChange={e => onEditar(i, 'dias_desde_inicio', Number(e.target.value))}
                      style={{ ...inp, width: 58, fontSize: 11 }} />
                    días desde hoy
                  </label>
                )}
                <span style={{ fontSize: 11, color: enElPasado ? '#D9A441' : '#777' }}>
                  {fecha ? `→ ${fFecha(fecha)}` : 'sin fecha'}{enElPasado ? ' (ya pasó)' : ''}
                </span>
                {a.depende_de != null && (
                  <span style={{ fontSize: 10.5, color: '#A78BFA', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <ChevronRight size={11} /> después de la {a.depende_de + 1}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {sinDueno > 0 && (
        <div style={{ fontSize: 11.5, color: '#997', marginTop: 11, lineHeight: 1.6 }}>
          {sinDueno} actividad(es) van a nacer sin dueño porque hay más de una persona con ese rol en el área.
          Es a propósito: adivinar a quién le toca es lo que rompe la cadena de responsabilidad. Se reparten en «Mi equipo».
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, marginTop: 13, flexWrap: 'wrap' }}>{acciones}</div>
    </div>
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
