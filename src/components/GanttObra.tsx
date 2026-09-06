// El programa de obra en Gantt, con las CONDICIONES DEL SITIO al frente.
//
// Lo que resuelve, en palabras de Elias: "que no venga el típico, tú dijiste
// este día, y ese día tiene que quedar, aunque no sea posible todavía".
//
// Una barra ámbar no significa que vamos tarde: significa que la fecha no
// depende de nosotros todavía. Esa distinción es todo el punto del documento.
import { useEffect, useMemo, useState } from 'react'
import { Btn, Badge, Loading } from './layout/UI'
import {
  TareaGantt, BarraGantt, deObraActividad, construirBarras, escalaDe, agrupar,
  fechaCorta, fechaLarga, diasEntre,
} from '../lib/gantt'
import {
  Prerequisito, PrereqCatalogo, A_CARGO_CFG, ESTADO_PREREQ_CFG, ACargoDe,
  cargarPrerequisitos, cargarCatalogo, sugerirDelCatalogo, sembrarSugeridos,
  agregarPrerequisito, actualizarPrerequisito, borrarPrerequisito,
  condicionesGenerales, estadoDeSitio,
} from '../lib/prerequisitos'
import { generarGanttPdf } from '../lib/ganttPdf'
import { Download, Sparkles, Plus, Trash2, X, AlertTriangle, Check } from 'lucide-react'

const card: React.CSSProperties = { background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14 }
const inp: React.CSSProperties = { background: '#1a1a1a', color: '#ddd', border: '1px solid #2a2a2a', borderRadius: 6, padding: '5px 8px', fontSize: 11.5, fontFamily: 'inherit', outline: 'none' }

export default function GanttObra({ obra, onCerrar }: {
  obra: { id: string; nombre: string; cliente?: string | null; actividades: any[] }
  onCerrar: () => void
}) {
  const [prereqs, setPrereqs] = useState<Record<string, Prerequisito[]>>({})
  const [catalogo, setCatalogo] = useState<PrereqCatalogo[]>([])
  const [cargando, setCargando] = useState(true)
  const [paraCliente, setParaCliente] = useState(false)
  const [porArea, setPorArea] = useState(false)
  const [sembrando, setSembrando] = useState(false)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const tareas: TareaGantt[] = useMemo(
    () => (obra.actividades || []).map(deObraActividad), [obra.actividades])

  async function recargar() {
    setPrereqs(await cargarPrerequisitos(tareas.map(t => t.id)))
    setCargando(false)
  }
  useEffect(() => { cargarCatalogo().then(setCatalogo).catch(() => {}); recargar() }, [obra.id])

  const { barras, sinFecha } = useMemo(() => construirBarras(tareas, prereqs), [tareas, prereqs])
  const esc = useMemo(() => escalaDe(barras), [barras])
  const grupos = useMemo(() => agrupar(barras, porArea ? 'area' : 'sistema'), [barras, porArea])
  const generales = useMemo(() => condicionesGenerales(catalogo), [catalogo])

  const bloqueadas = barras.filter(b => b.sitio.bloqueada).length

  async function proponer() {
    setSembrando(true); setMsg('')
    try {
      const n = await sembrarSugeridos(
        tareas.map(t => ({ id: t.id, name: t.name, description: t.description, specialty: t.specialty })),
        catalogo, prereqs)
      await recargar()
      setMsg(n > 0 ? `Se agregaron ${n} condición(es). Revísalas y quita las que no apliquen.` : 'No hay condiciones nuevas que proponer.')
    } catch (e: any) { setMsg(e?.message || String(e)) }
    setSembrando(false)
  }

  function exportar() {
    const doc = generarGanttPdf({
      obra: obra.nombre, cliente: obra.cliente || null,
      barras, prereqs, agruparPor: porArea ? 'area' : 'sistema', paraCliente,
      generales,
    })
    doc.save(`${obra.nombre.replace(/[^\w\s-]/g, '').trim()} - Programa${paraCliente ? '' : ' interno'}.pdf`)
  }

  if (cargando) return <div style={{ padding: 24 }}><Loading /></div>

  const px = (dias: number) => esc ? `${(dias / esc.dias) * 100}%` : '0%'
  const hoyOff = esc ? diasEntre(esc.inicio, new Date()) : -1

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Programa de obra</div>
        <div style={{ display: 'flex', gap: 2, background: '#141414', borderRadius: 6, padding: 2, border: '1px solid #222' }}>
          {[[false, 'Interno'], [true, 'Para cliente']].map(([v, l]) => (
            <button key={String(l)} onClick={() => setParaCliente(v as boolean)} style={{
              padding: '3px 10px', fontSize: 10, fontWeight: paraCliente === v ? 600 : 400,
              color: paraCliente === v ? '#fff' : '#555', background: paraCliente === v ? '#333' : 'transparent',
              border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
            }}>{l as string}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 2, background: '#141414', borderRadius: 6, padding: 2, border: '1px solid #222' }}>
          {[[false, 'Por sistema'], [true, 'Por área']].map(([v, l]) => (
            <button key={String(l)} onClick={() => setPorArea(v as boolean)} style={{
              padding: '3px 8px', fontSize: 10, fontWeight: porArea === v ? 600 : 400,
              color: porArea === v ? '#fff' : '#555', background: porArea === v ? '#333' : 'transparent',
              border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
            }}>{l as string}</button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Btn size="sm" onClick={proponer} disabled={sembrando}>
            <Sparkles size={12} /> {sembrando ? 'Proponiendo…' : 'Proponer condiciones'}
          </Btn>
          <Btn size="sm" variant="primary" onClick={exportar}><Download size={12} /> PDF</Btn>
          <Btn size="sm" onClick={onCerrar}><X size={12} /> Cerrar</Btn>
        </div>
      </div>

      {msg && <div style={{ ...card, marginBottom: 10, fontSize: 11.5, color: '#888', padding: '8px 12px' }}>{msg}</div>}

      {/* La nota que sostiene todo el documento */}
      {paraCliente && (
        <div style={{ ...card, marginBottom: 12, borderColor: '#3a2f15', background: '#161208' }}>
          <div style={{ fontSize: 11.5, color: '#D9A441', lineHeight: 1.7 }}>
            <b>Así se lee este programa.</b> Las fechas suponen que el sitio cumple las condiciones
            listadas para cada trabajo. El tiempo de cada actividad empieza a correr a partir de que
            esa condición está cumplida y verificada en obra. Una barra en ámbar no es un retraso
            nuestro: es un trabajo que todavía no se puede hacer.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', fontSize: 11.5 }}>
        <span style={{ color: '#888' }}>{barras.length} actividades con fecha</span>
        {bloqueadas > 0 && (
          <span style={{ color: '#D9A441', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle size={12} /> {bloqueadas} sujetas a condición del sitio
          </span>
        )}
        {sinFecha.length > 0 && <span style={{ color: '#DC2626' }}>{sinFecha.length} sin fecha (no salen en el programa)</span>}
        {esc && <span style={{ color: '#666' }}>{fechaCorta(esc.inicio)} → {fechaCorta(esc.fin)}</span>}
      </div>

      {!esc ? (
        <div style={{ ...card, color: '#888', fontSize: 12 }}>
          Ninguna actividad tiene fecha. Ponles fecha compromiso y aquí sale el programa.
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {/* Escala */}
          <div style={{ display: 'flex', borderBottom: '1px solid #1e1e1e', background: '#0e0e0e' }}>
            <div style={{ width: 260, flexShrink: 0, padding: '6px 10px', fontSize: 9.5, color: '#555', textTransform: 'uppercase', letterSpacing: '.06em' }}>Actividad</div>
            <div style={{ flex: 1, position: 'relative', height: 24 }}>
              {esc.meses.map((m, i) => (
                <div key={i} style={{
                  position: 'absolute', left: px(m.offset), width: px(m.dias), top: 0, bottom: 0,
                  borderLeft: '1px solid #1e1e1e', fontSize: 9, color: '#555', padding: '6px 0 0 4px',
                  overflow: 'hidden', whiteSpace: 'nowrap',
                }}>{m.label}</div>
              ))}
            </div>
          </div>

          <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
            {grupos.map(g => (
              <div key={g.titulo}>
                <div style={{ display: 'flex', background: '#141414', borderBottom: '1px solid #1e1e1e' }}>
                  <div style={{ width: 260, flexShrink: 0, padding: '6px 10px', fontSize: 11, fontWeight: 600, color: '#ddd' }}>
                    {g.titulo} <span style={{ color: '#555', fontWeight: 400 }}>({g.barras.length})</span>
                  </div>
                  <div style={{ flex: 1 }} />
                </div>
                {g.barras.map(b => (
                  <RenglonGantt key={b.tarea.id} b={b} esc={esc} px={px} hoyOff={hoyOff}
                    paraCliente={paraCliente} prereqs={prereqs[b.tarea.id] || []}
                    abierta={abierta === b.tarea.id}
                    onAbrir={() => setAbierta(abierta === b.tarea.id ? null : b.tarea.id)}
                    catalogo={catalogo} onCambio={recargar} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Condiciones generales de la obra */}
      {generales.length > 0 && (
        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#eee', marginBottom: 8 }}>Condiciones generales de la obra</div>
          <div style={{ fontSize: 10.5, color: '#666', marginBottom: 8, lineHeight: 1.6 }}>
            Aplican a todos los trabajos, no se repiten por actividad.
          </div>
          {generales.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, color: '#bbb', marginBottom: 5 }}>
              <Badge label={A_CARGO_CFG[c.a_cargo_de as ACargoDe]?.label || c.a_cargo_de} color={A_CARGO_CFG[c.a_cargo_de as ACargoDe]?.color || '#666'} />
              <span>{c.descripcion}</span>
            </div>
          ))}
        </div>
      )}

      {sinFecha.length > 0 && !paraCliente && (
        <div style={{ ...card, marginTop: 12, borderColor: '#3a1515' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', marginBottom: 6 }}>
            {sinFecha.length} actividad(es) sin fecha
          </div>
          <div style={{ fontSize: 10.5, color: '#888', lineHeight: 1.6 }}>
            No aparecen en el programa. Sin fecha, una actividad no está en la semana de nadie.
          </div>
        </div>
      )}
    </div>
  )
}

function RenglonGantt({ b, esc, px, hoyOff, paraCliente, prereqs, abierta, onAbrir, catalogo, onCambio }: {
  b: BarraGantt; esc: any; px: (d: number) => string; hoyOff: number
  paraCliente: boolean; prereqs: Prerequisito[]; abierta: boolean; onAbrir: () => void
  catalogo: PrereqCatalogo[]; onCambio: () => void
}) {
  const [nueva, setNueva] = useState('')
  const [cargo, setCargo] = useState<ACargoDe>('otro')
  // Ámbar = no depende de nosotros. Rojo = vencida. Verde = en programa.
  const color = b.sitio.bloqueada ? '#D9A441' : b.vencida ? '#DC2626' : '#10B981'
  // Sin fecha de arranque no inventamos duracion: se muestra solo el compromiso.
  const cuando = b.soloFin ? fechaCorta(b.fin) : `${fechaCorta(b.inicio)} – ${fechaCorta(b.fin)}`

  return (
    <>
      <div onClick={onAbrir} style={{ display: 'flex', borderBottom: '1px solid #161616', cursor: 'pointer', background: abierta ? '#0d0d0d' : 'transparent' }}>
        <div style={{ width: 260, flexShrink: 0, padding: '5px 10px', minWidth: 0 }}>
          <div style={{ fontSize: 11, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {b.tarea.titulo_cliente || b.tarea.name}
          </div>
          {b.sitio.bloqueada && (
            <div style={{ fontSize: 9, color: '#D9A441', marginTop: 1 }}>
              espera a {b.sitio.aCargo.map(c => A_CARGO_CFG[c]?.label || c).join(', ')}
            </div>
          )}
        </div>
        <div style={{ flex: 1, position: 'relative', height: 26 }}>
          {hoyOff >= 0 && hoyOff <= esc.dias && (
            <div style={{ position: 'absolute', left: px(hoyOff), top: 0, bottom: 0, width: 1, background: '#DC262666' }} />
          )}
          <div title={`${fechaLarga(b.inicio)} → ${fechaLarga(b.fin)}`}
            style={{
              position: 'absolute', left: px(b.offset), width: px(b.dias), minWidth: 6,
              top: 6, height: 13, borderRadius: 3, background: color,
              backgroundImage: b.sitio.bloqueada ? 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,.28) 3px, rgba(0,0,0,.28) 6px)' : undefined,
            }}>
            {!paraCliente && b.tarea.progress > 0 && (
              <div style={{ height: '100%', width: `${Math.min(100, b.tarea.progress)}%`, background: 'rgba(255,255,255,.35)', borderRadius: 3 }} />
            )}
          </div>
          {/* La fecha al costado: con barras de un dia el tooltip no basta. */}
          <div style={{
            position: 'absolute', left: `calc(${px(b.offset)} + 10px)`, top: 8,
            fontSize: 9, whiteSpace: 'nowrap', pointerEvents: 'none',
            color: b.sitio.bloqueada ? '#D9A441' : '#666',
          }}>{cuando}</div>
        </div>
      </div>

      {abierta && (
        <div style={{ padding: '10px 12px 12px 20px', background: '#0b0b0b', borderBottom: '1px solid #161616' }}>
          <div style={{ fontSize: 10, color: '#666', marginBottom: 7 }}>
            {b.soloFin
              ? <>Compromiso: {fechaLarga(b.fin)} <span style={{ color: '#555' }}>· sin fecha de arranque capturada</span></>
              : <>{fechaLarga(b.inicio)} → {fechaLarga(b.fin)} · {b.dias} día(s)</>}
          </div>
          <div style={{ fontSize: 10.5, color: '#888', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Condiciones del sitio para esta actividad
          </div>
          {prereqs.length === 0 && <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>Ninguna capturada.</div>}
          <div style={{ display: 'grid', gap: 5, marginBottom: 9 }}>
            {prereqs.map(p => {
              const cfg = ESTADO_PREREQ_CFG[p.estado]
              return (
                <div key={p.id} style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={async () => { await actualizarPrerequisito(p.id, { estado: p.estado === 'cumplido' ? 'pendiente' : 'cumplido' }); onCambio() }}
                    title={p.estado === 'cumplido' ? 'Marcar pendiente' : 'Marcar cumplido'}
                    style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
                      border: `1px solid ${cfg.color}`, background: p.estado === 'cumplido' ? cfg.color + '33' : 'transparent',
                      display: 'grid', placeItems: 'center', padding: 0 }}>
                    {p.estado === 'cumplido' && <Check size={9} color={cfg.color} />}
                  </button>
                  <Badge label={A_CARGO_CFG[p.a_cargo_de]?.label || p.a_cargo_de} color={A_CARGO_CFG[p.a_cargo_de]?.color || '#666'} />
                  <span style={{ fontSize: 11.5, color: p.estado === 'cumplido' ? '#666' : '#ccc', flex: 1, minWidth: 180, textDecoration: p.estado === 'cumplido' ? 'line-through' : 'none' }}>
                    {p.descripcion}
                  </span>
                  {!p.critico && <span style={{ fontSize: 9.5, color: '#555' }}>no crítica</span>}
                  <button onClick={async () => { await borrarPrerequisito(p.id); onCambio() }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#444', padding: 2 }}><Trash2 size={11} /></button>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select value={cargo} onChange={e => setCargo(e.target.value as ACargoDe)} style={{ ...inp, width: 150 }}>
              {(Object.keys(A_CARGO_CFG) as ACargoDe[]).map(k => <option key={k} value={k}>{A_CARGO_CFG[k].label}</option>)}
            </select>
            <input value={nueva} onChange={e => setNueva(e.target.value)}
              placeholder="Qué tiene que estar listo antes" style={{ ...inp, flex: 1, minWidth: 200 }} />
            <Btn size="sm" onClick={async () => {
              if (!nueva.trim()) return
              await agregarPrerequisito(b.tarea.id, { descripcion: nueva.trim(), a_cargo_de: cargo })
              setNueva(''); onCambio()
            }}><Plus size={11} /> Agregar</Btn>
          </div>
        </div>
      )}
    </>
  )
}
