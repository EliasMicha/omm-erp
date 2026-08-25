// ═══════════════════════════════════════════════════════════════════════════
// Desempeño — los indicadores de orden, no un ranking.
//
// Tres decisiones de diseño que conviene no deshacer:
//
//  1. NO HAY CALIFICACIÓN ÚNICA. Cada indicador se ve por separado, con su
//     contrapeso al lado. Un promedio ponderado se optimiza; un tablero de
//     números que se contradicen entre sí, no.
//
//  2. CLARIDAD AL ORIGEN VA PRIMERO y mide a quien encarga. Si el encargo
//     nació sin fecha y sin dueño, no hay incumplimiento que reprochar: no se
//     puede fallar contra una fecha que nunca existió. Ese número empieza en
//     la dirección general, a la vista de todos.
//
//  3. SIN DATOS NO ES VERDE, ES GRIS. Un tablero que arranca en 100% porque
//     nadie ha entregado nada es peor que no tener tablero.
//
// El tablero arranca vacío a propósito. La instrumentación (asignada_at,
// fechada_at, due_date_original, due_date_cambios) se instaló ahora porque
// esos sellos no se pueden reconstruir hacia atrás: lo que no se selle hoy,
// mañana ya no existe.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { AREAS_TRABAJO } from '../lib/tareas'
import {
  TareaKPI, EntregableKPI, Desempeno as Desemp,
  calcular, brechaDeFechas, claridad, agrupar, creadasDesde,
  cargarTareasKPI, cargarEntregablesKPI, revisionDe, PERIODOS, desdeDe,
  colorCumplimiento, colorCiclo, colorRespuesta, fmtPct, fmtDias,
} from '../lib/kpis'
import { Target, Clock, Shuffle, Activity, Info, AlertTriangle, RotateCcw, Inbox } from 'lucide-react'

const card: React.CSSProperties = { background: '#111', border: '1px solid #222', borderRadius: 12, padding: 16 }
const th: React.CSSProperties = { textAlign: 'left', fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: '#666', padding: '8px 10px', borderBottom: '1px solid #222', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: 13, padding: '9px 10px', borderBottom: '1px solid #1a1a1a', whiteSpace: 'nowrap' }

interface Emp { id: string; name: string; area?: string | null; puesto?: string | null }

/** Un indicador y su contrapeso, siempre juntos. Nunca uno solo. */
function Indicador({ icono, titulo, valor, color, contrapeso, explica }: {
  icono: any
  titulo: string
  valor: string
  color: string
  contrapeso: { label: string; valor: string }
  explica: string
}) {
  const Icono = icono
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        <Icono size={13} /> {titulo}
      </div>
      <div style={{ fontSize: 30, fontWeight: 600, color, lineHeight: 1.1 }}>{valor}</div>
      <div style={{ fontSize: 12, color: '#999', borderTop: '1px solid #1f1f1f', paddingTop: 6 }}>
        {contrapeso.label}: <span style={{ color: '#ddd', fontWeight: 500 }}>{contrapeso.valor}</span>
      </div>
      <div style={{ fontSize: 11, color: '#666', lineHeight: 1.5 }}>{explica}</div>
    </div>
  )
}

export default function Desempeno() {
  const { user } = useAuth()
  const [tareas, setTareas] = useState<TareaKPI[]>([])
  const [ents, setEnts] = useState<EntregableKPI[]>([])
  const [empleados, setEmpleados] = useState<Emp[]>([])
  const [periodo, setPeriodo] = useState('90')
  const [cargando, setCargando] = useState(true)
  const [nota, setNota] = useState(true)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCargando(true)
      const desde = desdeDe(periodo)
      const [ts, es, { data: emps }] = await Promise.all([
        cargarTareasKPI(desde),
        cargarEntregablesKPI(desde),
        supabase.from('employees').select('id,name,area,puesto').eq('is_active', true).order('name'),
      ])
      if (!vivo) return
      setTareas(ts)
      setEnts(es)
      setEmpleados((emps as any[]) || [])
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [periodo])

  const desde = desdeDe(periodo)
  const nombreDe = (id?: string | null) => empleados.find(e => e.id === id)?.name || 'Sin asignar'
  const global = useMemo(() => calcular(tareas), [tareas])
  const brecha = brechaDeFechas(global)

  // ── Claridad al origen: por quien reparte ──
  const porQuienEncarga = useMemo(() => {
    const creadas = creadasDesde(tareas, desde)
    const g = agrupar(creadas, t => t.solicitada_por_id || '—')
    return [...g.entries()]
      .map(([id, ts]) => ({ id, nombre: id === '—' ? 'Sin remitente' : nombreDe(id), c: claridad(ts) }))
      .sort((a, b) => b.c.encargos - a.c.encargos)
  }, [tareas, empleados, periodo])

  const claridadGlobal = useMemo(() => claridad(creadasDesde(tareas, desde)), [tareas, periodo])

  // ── Cumplimiento y ciclo: por área y por persona ──
  const porArea = useMemo(() => AREAS_TRABAJO.map(a => ({
    key: a.specialty,
    label: a.label,
    color: a.color,
    d: calcular(tareas.filter(t => t.specialty === a.specialty)),
  })), [tareas])

  const porPersona = useMemo(() => {
    const g = agrupar(tareas.filter(t => t.assignee_id), t => t.assignee_id!)
    return [...g.entries()]
      .map(([id, ts]) => ({ id, nombre: nombreDe(id), d: calcular(ts) }))
      .sort((a, b) => (b.d.entregadas - a.d.entregadas) || (b.d.abiertas - a.d.abiertas))
  }, [tareas, empleados])

  const revGlobal = useMemo(() => revisionDe(ents), [ents])
  const porRevisor = useMemo(() => {
    const g = agrupar(ents.filter(e => e.revisado_por_id), e => e.revisado_por_id!)
    return [...g.entries()]
      .map(([id, es]) => ({ id, nombre: nombreDe(id), r: revisionDe(es) }))
      .sort((a, b) => b.r.revisados - a.r.revisados)
  }, [ents, empleados])

  const vacio = global.entregadas === 0

  return (
    <div style={{ padding: 24, maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: '#eee', margin: 0 }}>Desempeño</h1>
          <p style={{ fontSize: 12, color: '#777', margin: '4px 0 0', maxWidth: 620, lineHeight: 1.6 }}>
            Qué se entregó, contra qué fecha se había prometido y cuánto tardó. Cada indicador
            va con su contrapeso al lado — ninguno se puede subir a solas sin que el otro lo delate.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {PERIODOS.map(p => (
            <button key={p.key} onClick={() => setPeriodo(p.key)} style={{
              background: periodo === p.key ? '#1e293b' : 'transparent',
              border: `1px solid ${periodo === p.key ? '#3b82f6' : '#333'}`,
              color: periodo === p.key ? '#93c5fd' : '#888',
              borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            }}>{p.label}</button>
          ))}
        </div>
      </div>

      {nota && (
        <div style={{ ...card, borderColor: '#2a2416', background: '#141109', marginBottom: 18, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Info size={16} color="#D9A441" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, color: '#c9b78a', lineHeight: 1.7, flex: 1 }}>
            <b style={{ color: '#e8d5a3' }}>Esto arranca vacío y así debe ser.</b> Los sellos que alimentan
            estos números (cuándo se asignó, cuándo se fechó, cuál fue la <i>primera</i> fecha, cuántas veces se movió)
            se empezaron a grabar hoy: no se pueden reconstruir hacia atrás. El tablero se llena solo,
            conforme el trabajo se reparte con dueño y con fecha.
            <br />
            <span style={{ color: '#a08c5e' }}>
              Antes de calificar a nadie: corre 3–4 semanas en espejo (mirando los números sin consecuencias)
              y da de alta a las 6 personas de oficina que todavía no tienen usuario — quien no puede entrar,
              no puede aparecer.
            </span>
            <button onClick={() => setNota(false)} style={{ background: 'none', border: 'none', color: '#7a6a45', fontSize: 11, cursor: 'pointer', padding: 0, marginLeft: 8, textDecoration: 'underline' }}>ocultar</button>
          </div>
        </div>
      )}

      {cargando ? (
        <div style={{ ...card, textAlign: 'center', color: '#666', padding: 40 }}>Cargando…</div>
      ) : (
        <>
          {/* ═══ 1. CLARIDAD AL ORIGEN ═══ */}
          <h2 style={{ fontSize: 14, color: '#ddd', fontWeight: 600, margin: '0 0 4px' }}>1 · Claridad al origen</h2>
          <p style={{ fontSize: 12, color: '#777', margin: '0 0 12px', maxWidth: 760, lineHeight: 1.6 }}>
            Este indicador no mide a quien ejecuta: mide a quien encarga, empezando por la dirección.
            Un encargo nace claro cuando el mismo día ya trae <b style={{ color: '#aaa' }}>qué</b> (nombre),
            <b style={{ color: '#aaa' }}> cuándo</b> (fecha) y <b style={{ color: '#aaa' }}>quién</b> (dueño).
            Si nació ciego, el incumplimiento de después no es reprochable.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginBottom: 14 }}>
            <Indicador
              icono={Target}
              titulo="Encargos que nacen claros"
              valor={fmtPct(claridadGlobal.pctCompletos)}
              color={colorCumplimiento(claridadGlobal.pctCompletos)}
              contrapeso={{ label: 'Encargos repartidos', valor: String(claridadGlobal.encargos) }}
              explica="Con dueño y fecha desde el día que se pidieron. El 100% con 2 encargos no dice nada; el volumen va al lado por eso."
            />
            <Indicador
              icono={Clock}
              titulo="Tardanza en poner dueño"
              valor={fmtDias(claridadGlobal.diasHastaDueno)}
              color={colorCiclo(claridadGlobal.diasHastaDueno)}
              contrapeso={{ label: 'Tardanza en poner fecha', valor: fmtDias(claridadGlobal.diasHastaFecha) }}
              explica="Días que un encargo pasa sin nombre y apellido. Ese tiempo no es culpa de quien ejecuta y por eso no cuenta en su ciclo."
            />
            <Indicador
              icono={AlertTriangle}
              titulo="Abiertos sin dueño hoy"
              valor={String(claridadGlobal.huerfanas)}
              color={claridadGlobal.huerfanas > 0 ? '#DC2626' : '#10B981'}
              contrapeso={{ label: 'Abiertos sin fecha hoy', valor: String(claridadGlobal.sinFechaHoy) }}
              explica="Foto de este momento, no promedio del mes. Es lo que de verdad se pierde: nadie reclama lo que no tiene dueño."
            />
          </div>

          <div style={{ ...card, padding: 0, marginBottom: 26, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead><tr>
                <th style={th}>Quien encarga</th>
                <th style={{ ...th, textAlign: 'right' }}>Encargos</th>
                <th style={{ ...th, textAlign: 'right' }}>Nacen claros</th>
                <th style={{ ...th, textAlign: 'right' }}>Con dueño</th>
                <th style={{ ...th, textAlign: 'right' }}>Con fecha</th>
                <th style={{ ...th, textAlign: 'right' }}>Días a dueño</th>
                <th style={{ ...th, textAlign: 'right' }}>Sin dueño hoy</th>
              </tr></thead>
              <tbody>
                {porQuienEncarga.length === 0 && (
                  <tr><td style={{ ...td, color: '#666', textAlign: 'center' }} colSpan={7}>Ningún encargo creado en el periodo.</td></tr>
                )}
                {porQuienEncarga.map(f => (
                  <tr key={f.id} style={f.id === user?.employee_id ? { background: '#0f1620' } : undefined}>
                    <td style={{ ...td, color: '#ddd' }}>{f.nombre}{f.id === user?.employee_id && <span style={{ color: '#3b82f6', fontSize: 10, marginLeft: 6 }}>tú</span>}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{f.c.encargos}</td>
                    <td style={{ ...td, textAlign: 'right', color: colorCumplimiento(f.c.pctCompletos), fontWeight: 600 }}>{fmtPct(f.c.pctCompletos)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#888' }}>{f.c.conDueno}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#888' }}>{f.c.conFecha}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#888' }}>{fmtDias(f.c.diasHastaDueno)}</td>
                    <td style={{ ...td, textAlign: 'right', color: f.c.huerfanas > 0 ? '#DC2626' : '#555' }}>{f.c.huerfanas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ═══ 2. CUMPLIMIENTO Y CICLO ═══ */}
          <h2 style={{ fontSize: 14, color: '#ddd', fontWeight: 600, margin: '0 0 4px' }}>2 · Cumplimiento y tiempo de ciclo</h2>
          <p style={{ fontSize: 12, color: '#777', margin: '0 0 12px', maxWidth: 760, lineHeight: 1.6 }}>
            El cumplimiento se juzga contra la <b style={{ color: '#aaa' }}>primera</b> fecha comprometida, no contra la
            última: si se juzgara contra la última, recorrer la fecha borraría el incumplimiento.
            La diferencia entre los dos números es, literalmente, cuánto se movieron los compromisos.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginBottom: 14 }}>
            <Indicador
              icono={Target}
              titulo="Cumplimiento (1ª fecha)"
              valor={fmtPct(global.cumplimiento)}
              color={colorCumplimiento(global.cumplimiento)}
              contrapeso={{ label: 'Contra la última fecha', valor: fmtPct(global.cumplimientoUltima) }}
              explica={brecha != null && brecha > 0.1
                ? `La brecha de ${fmtPct(brecha)} es fecha recorrida: sin ese movimiento el cumplimiento sería el número grande.`
                : 'Si el segundo número se despega del primero, las fechas se están moviendo para no fallar.'}
            />
            <Indicador
              icono={Clock}
              titulo="Tiempo de ciclo"
              valor={fmtDias(global.ciclo)}
              color={colorCiclo(global.ciclo)}
              contrapeso={{ label: 'Retraso promedio del que llega tarde', valor: fmtDias(global.retrasoProm) }}
              explica="Mediana de días con dueño hasta la entrega. Es el contrapeso del cumplimiento: inflar fechas lo sube, pero también sube esto."
            />
            <Indicador
              icono={Shuffle}
              titulo="Fechas movidas"
              valor={fmtPct(global.pctMovidas)}
              color={global.pctMovidas == null ? '#555' : global.pctMovidas > 0.4 ? '#DC2626' : global.pctMovidas > 0.2 ? '#D9A441' : '#10B981'}
              contrapeso={{ label: 'Movimientos por tarea', valor: global.cambiosProm == null ? '—' : global.cambiosProm.toFixed(1) }}
              explica="Mover una fecha con motivo es legítimo; moverlas todas es otra cosa. Aquí se ve la diferencia sin tener que acusar a nadie."
            />
            <Indicador
              icono={Activity}
              titulo="Vencidas hoy"
              valor={String(global.vencidas)}
              color={global.vencidas > 0 ? '#DC2626' : '#10B981'}
              contrapeso={{ label: 'Abiertas en total', valor: String(global.abiertas) }}
              explica="Higiene del tablero, medida hoy. Sin este par, un área puede verse impecable simplemente por no tener nada registrado."
            />
          </div>

          <div style={{ ...card, padding: 0, marginBottom: 16, overflowX: 'auto' }}>
            <div style={{ padding: '12px 14px 0', fontSize: 12, color: '#888', fontWeight: 500 }}>Por área</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860, marginTop: 8 }}>
              <thead><tr>
                <th style={th}>Área</th>
                <th style={{ ...th, textAlign: 'right' }}>Entregadas</th>
                <th style={{ ...th, textAlign: 'right' }}>Cumpl. 1ª</th>
                <th style={{ ...th, textAlign: 'right' }}>Cumpl. última</th>
                <th style={{ ...th, textAlign: 'right' }}>Brecha</th>
                <th style={{ ...th, textAlign: 'right' }}>Ciclo</th>
                <th style={{ ...th, textAlign: 'right' }}>Fechas movidas</th>
                <th style={{ ...th, textAlign: 'right' }}>A la 1ª</th>
                <th style={{ ...th, textAlign: 'right' }}>Abiertas</th>
                <th style={{ ...th, textAlign: 'right' }}>Sin fecha</th>
                <th style={{ ...th, textAlign: 'right' }}>Vencidas</th>
              </tr></thead>
              <tbody>
                {porArea.map(a => <FilaDesempeno key={a.key} etiqueta={a.label} color={a.color} d={a.d} />)}
              </tbody>
            </table>
          </div>

          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <div style={{ padding: '12px 14px 0', fontSize: 12, color: '#888', fontWeight: 500 }}>Por persona</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860, marginTop: 8 }}>
              <thead><tr>
                <th style={th}>Persona</th>
                <th style={{ ...th, textAlign: 'right' }}>Entregadas</th>
                <th style={{ ...th, textAlign: 'right' }}>Cumpl. 1ª</th>
                <th style={{ ...th, textAlign: 'right' }}>Cumpl. última</th>
                <th style={{ ...th, textAlign: 'right' }}>Brecha</th>
                <th style={{ ...th, textAlign: 'right' }}>Ciclo</th>
                <th style={{ ...th, textAlign: 'right' }}>Fechas movidas</th>
                <th style={{ ...th, textAlign: 'right' }}>A la 1ª</th>
                <th style={{ ...th, textAlign: 'right' }}>Abiertas</th>
                <th style={{ ...th, textAlign: 'right' }}>Sin fecha</th>
                <th style={{ ...th, textAlign: 'right' }}>Vencidas</th>
              </tr></thead>
              <tbody>
                {porPersona.length === 0 && (
                  <tr><td style={{ ...td, color: '#666', textAlign: 'center' }} colSpan={11}>Nadie tiene tareas asignadas todavía.</td></tr>
                )}
                {porPersona.map(p => (
                  <FilaDesempeno key={p.id} etiqueta={p.nombre} color="#555" d={p.d} resaltar={p.id === user?.employee_id} />
                ))}
              </tbody>
            </table>
          </div>

          {/* ═══ 3. REVISIÓN Y CALIDAD ═══ */}
          <h2 style={{ fontSize: 14, color: '#ddd', fontWeight: 600, margin: '26px 0 4px' }}>3 · Revisión y calidad</h2>
          <p style={{ fontSize: 12, color: '#777', margin: '0 0 12px', maxWidth: 760, lineHeight: 1.6 }}>
            El otro lado del trato. Si al que entrega se le mide la fecha, al que revisa se le mide la
            respuesta: mientras un entregable está "en revisión", el trabajo está detenido y hasta ahora
            eso no aparecía en ningún lado. La calidad se mide en <b style={{ color: '#aaa' }}>vueltas de corrección</b>,
            no en una calificación del 1 al 5 — el número de veces que algo regresó es un hecho; una estrella es una opinión.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginBottom: 14 }}>
            <Indicador
              icono={Clock}
              titulo="Tiempo de respuesta"
              valor={fmtDias(revGlobal.respuesta)}
              color={colorRespuesta(revGlobal.respuesta)}
              contrapeso={{ label: 'Peor caso del periodo', valor: fmtDias(revGlobal.peorRespuesta) }}
              explica="Mediana de días entre subir un entregable y recibir respuesta. La mediana se olvida; el peor caso es el que la gente recuerda."
            />
            <Indicador
              icono={Inbox}
              titulo="Esperando respuesta hoy"
              valor={String(revGlobal.esperando)}
              color={revGlobal.masViejo != null && revGlobal.masViejo >= 3 ? '#DC2626' : revGlobal.esperando > 0 ? '#D9A441' : '#10B981'}
              contrapeso={{ label: 'El más viejo lleva', valor: fmtDias(revGlobal.masViejo) }}
              explica="Trabajo terminado que nadie ha abierto. Cada día aquí es un día que el que entregó no puede avanzar ni cerrar."
            />
            <Indicador
              icono={Target}
              titulo="Aceptado a la primera"
              valor={fmtPct(global.aLaPrimera)}
              color={colorCumplimiento(global.aLaPrimera)}
              contrapeso={{ label: 'Vueltas por entrega', valor: global.rondasProm == null ? '—' : global.rondasProm.toFixed(1) }}
              explica="Esta es la calidad, medida en reprocesos. Si sube demasiado rápido, revisa que no sea que nadie esté revisando en serio."
            />
            <Indicador
              icono={RotateCcw}
              titulo="Devueltos a corregir"
              valor={fmtPct(revGlobal.pctDevueltos)}
              color={revGlobal.pctDevueltos == null ? '#555' : revGlobal.pctDevueltos > 0.5 ? '#DC2626' : revGlobal.pctDevueltos > 0.25 ? '#D9A441' : '#10B981'}
              contrapeso={{ label: 'Contestados en 24 h', valor: fmtPct(revGlobal.pctEn24h) }}
              explica="Devolver mucho puede ser rigor o puede ser un encargo mal explicado. Míralo junto a la claridad al origen del que lo pidió."
            />
          </div>

          <div style={{ ...card, padding: 0, marginBottom: 16, overflowX: 'auto' }}>
            <div style={{ padding: '12px 14px 0', fontSize: 12, color: '#888', fontWeight: 500 }}>Por quien revisa</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720, marginTop: 8 }}>
              <thead><tr>
                <th style={th}>Revisor</th>
                <th style={{ ...th, textAlign: 'right' }}>Revisados</th>
                <th style={{ ...th, textAlign: 'right' }}>Respuesta</th>
                <th style={{ ...th, textAlign: 'right' }}>Peor caso</th>
                <th style={{ ...th, textAlign: 'right' }}>En 24 h</th>
                <th style={{ ...th, textAlign: 'right' }}>Devueltos</th>
                <th style={{ ...th, textAlign: 'right' }}>Esperando hoy</th>
              </tr></thead>
              <tbody>
                {porRevisor.length === 0 && (
                  <tr><td style={{ ...td, color: '#666', textAlign: 'center' }} colSpan={7}>Nadie ha revisado un entregable todavía.</td></tr>
                )}
                {porRevisor.map(f => (
                  <tr key={f.id} style={f.id === user?.employee_id ? { background: '#0f1620' } : undefined}>
                    <td style={{ ...td, color: '#ddd' }}>{f.nombre}{f.id === user?.employee_id && <span style={{ color: '#3b82f6', fontSize: 10, marginLeft: 6 }}>tú</span>}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{f.r.revisados}</td>
                    <td style={{ ...td, textAlign: 'right', color: colorRespuesta(f.r.respuesta), fontWeight: 600 }}>{fmtDias(f.r.respuesta)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#777' }}>{fmtDias(f.r.peorRespuesta)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#777' }}>{fmtPct(f.r.pctEn24h)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#777' }}>{fmtPct(f.r.pctDevueltos)}</td>
                    <td style={{ ...td, textAlign: 'right', color: f.r.esperando > 0 ? '#D9A441' : '#555' }}>{f.r.esperando}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {vacio && (
            <p style={{ fontSize: 11, color: '#555', marginTop: 14, lineHeight: 1.7, maxWidth: 760 }}>
              Todavía no hay una sola entrega con fecha comprometida, así que las columnas de cumplimiento
              y ciclo están en gris — no en verde. Un tablero que se estrena en 100% porque nadie ha entregado
              nada enseña a la organización exactamente lo contrario de lo que se busca.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function FilaDesempeno({ etiqueta, color, d, resaltar }: { etiqueta: string; color: string; d: Desemp; resaltar?: boolean }) {
  const brecha = brechaDeFechas(d)
  return (
    <tr style={resaltar ? { background: '#0f1620' } : undefined}>
      <td style={{ ...td, color: '#ddd' }}>
        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: color, marginRight: 8 }} />
        {etiqueta}{resaltar && <span style={{ color: '#3b82f6', fontSize: 10, marginLeft: 6 }}>tú</span>}
      </td>
      <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{d.entregadas}</td>
      <td style={{ ...td, textAlign: 'right', color: colorCumplimiento(d.cumplimiento), fontWeight: 600 }}>{fmtPct(d.cumplimiento)}</td>
      <td style={{ ...td, textAlign: 'right', color: '#777' }}>{fmtPct(d.cumplimientoUltima)}</td>
      <td style={{ ...td, textAlign: 'right', color: brecha == null ? '#555' : brecha > 0.1 ? '#D9A441' : '#555' }}>{brecha == null ? '—' : brecha === 0 ? '—' : `+${fmtPct(brecha)}`}</td>
      <td style={{ ...td, textAlign: 'right', color: colorCiclo(d.ciclo) }}>{fmtDias(d.ciclo)}</td>
      <td style={{ ...td, textAlign: 'right', color: '#777' }}>{fmtPct(d.pctMovidas)}</td>
      <td style={{ ...td, textAlign: 'right', color: colorCumplimiento(d.aLaPrimera) }}>{fmtPct(d.aLaPrimera)}</td>
      <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{d.abiertas}</td>
      <td style={{ ...td, textAlign: 'right', color: d.sinFecha > 0 ? '#D9A441' : '#555' }}>{d.sinFecha}</td>
      <td style={{ ...td, textAlign: 'right', color: d.vencidas > 0 ? '#DC2626' : '#555' }}>{d.vencidas}</td>
    </tr>
  )
}
