// ═══════════════════════════════════════════════════════════════════════════
// Compromisos — el tablero semanal de la oficina.
//
// Una sola pantalla con las cuatro áreas y lo que cada una se comprometió a
// entregar esta semana. Todos ven todo: la claridad viene de la visibilidad,
// no de reportarle al jefe. El dibujante ve sus tres cosas sin preguntarle a
// nadie, y el director de al lado ve de qué depende.
//
// El ritual está en los botones: no se puede comprometer una semana nueva sin
// haber cerrado la anterior, y no se puede cerrar dejando entregables sin
// resolver. Es a propósito incómodo.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Loading, Badge } from '../components/layout/UI'
import {
  ChevronLeft, ChevronRight, Plus, Check, X, AlertTriangle, ArrowRight, Trash2, Lock, Users,
} from 'lucide-react'
import {
  AREAS, CompromisoSemana, Entregable, ESTADO_ENTREGABLE_CFG, ESTADO_SEMANA_CFG,
  lunesDe, sumarSemanas, rangoSemana, diasDeSemana, cumplimientoDe,
  cargarTodasLasAreas, abrirSemana, comprometer, cerrarSemana, moverASiguiente, puedeComprometer,
} from '../lib/compromisos'

interface Emp { id: string; name: string; area?: string | null; puesto?: string | null }

const hoyISO = () => new Date().toISOString().slice(0, 10)

export default function Compromisos() {
  const { user } = useAuth()
  const [semana, setSemana] = useState(lunesDe())
  const [areas, setAreas] = useState<CompromisoSemana[]>([])
  const [empleados, setEmpleados] = useState<Emp[]>([])
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState<'tablero' | 'mio'>('tablero')
  const [nuevo, setNuevo] = useState<Record<string, { titulo: string; responsable_id: string; fecha: string; calidad: string; proyecto: string }>>({})

  const esDG = user?.permission_area === 'DG'
  const miEmpleado = user?.employee_id || ''

  async function cargar() {
    setCargando(true)
    const [as, { data: emps }] = await Promise.all([
      cargarTodasLasAreas(semana),
      supabase.from('employees').select('id,name,area,puesto').eq('is_active', true).order('name'),
    ])
    setAreas(as)
    setEmpleados((emps as any[]) || [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [semana])

  const porArea = useMemo(() => {
    const m = new Map<string, CompromisoSemana>()
    for (const a of areas) m.set(a.area, a)
    return m
  }, [areas])

  const empById = useMemo(() => new Map(empleados.map(e => [e.id, e])), [empleados])
  const nombre = (id?: string | null) => (id && empById.get(id)?.name) || '—'

  /** Un director manda en su área; el DG en todas. */
  const puedeEditar = (area: string) => {
    if (esDG) return true
    const emp = miEmpleado ? empById.get(miEmpleado) : null
    return !!emp && emp.area === area && user?.nivel === 'director'
  }

  const equipoDe = (area: string) => empleados.filter(e => e.area === area)

  async function crearSemana(area: string) {
    const emp = miEmpleado ? empById.get(miEmpleado) : null
    const dir = emp && emp.area === area ? emp.id : (equipoDe(area).find(e => /DIRECTOR|DIRECCION/i.test(e.puesto || ''))?.id || null)
    const r = await abrirSemana(area, semana, dir)
    if (r.error) { alert(r.error); return }
    cargar()
  }

  async function agregarEntregable(c: CompromisoSemana) {
    const n = nuevo[c.id]
    if (!n?.titulo?.trim()) { alert('Escribe qué se va a entregar.'); return }
    if (!n.responsable_id) { alert('Falta el responsable: un entregable sin dueño no se entrega.'); return }
    if (!n.fecha) { alert('Falta el día de entrega.'); return }
    if (!n.calidad?.trim()) { alert('Falta el criterio de calidad: en una línea, cómo se ve bien.'); return }
    const { error } = await supabase.from('compromiso_entregables').insert({
      compromiso_id: c.id, titulo: n.titulo.trim(), responsable_id: n.responsable_id,
      fecha_compromiso: n.fecha, criterio_calidad: n.calidad.trim(),
      proyecto_ref: n.proyecto?.trim() || null,
      order_index: (c.entregables || []).length,
    })
    if (error) { alert(error.message); return }
    setNuevo(p => ({ ...p, [c.id]: { titulo: '', responsable_id: n.responsable_id, fecha: n.fecha, calidad: '', proyecto: n.proyecto } }))
    cargar()
  }

  async function marcar(e: Entregable, estado: 'entregado' | 'no_entregado') {
    const upd: any = { estado, updated_at: new Date().toISOString() }
    if (estado === 'entregado') {
      upd.entregado_at = new Date().toISOString()
      upd.entregado_por = user?.nombre || null
      const ev = prompt('¿Dónde quedó? (link, carpeta, correo — opcional)') || ''
      if (ev) upd.evidencia = ev
    } else {
      const m = prompt('¿Por qué no se entregó?')
      if (m === null) return
      upd.motivo = m
    }
    await supabase.from('compromiso_entregables').update(upd).eq('id', e.id)
    cargar()
  }

  async function mover(e: Entregable, area: string) {
    const m = prompt('¿Por qué se mueve a la semana siguiente?')
    if (m === null) return
    const r = await moverASiguiente(e, area, semana, m, porArea.get(area)?.director_id || null)
    if (!r.ok) { alert(r.error); return }
    cargar()
  }

  async function borrar(e: Entregable) {
    if (!confirm('¿Quitar este entregable? Si ya se comprometió la semana, mejor márcalo como no entregado con su motivo — así queda el registro.')) return
    await supabase.from('compromiso_entregables').delete().eq('id', e.id)
    cargar()
  }

  async function comprometerSemana(c: CompromisoSemana) {
    const permiso = await puedeComprometer(c.area, c.week_start)
    if (!permiso.ok) { alert(permiso.motivo); return }
    if (!confirm(`Comprometer la semana de ${c.area} con ${(c.entregables || []).length} entregables?\n\nA partir de aquí el equipo lo ve como el plan de la semana.`)) return
    const r = await comprometer(c.id, user?.nombre || 'sistema')
    if (!r.ok) { alert(r.error); return }
    cargar()
  }

  async function cerrar(c: CompromisoSemana) {
    const notas = prompt('Cierre de la semana: ¿algo que anotar? (opcional)') ?? ''
    const r = await cerrarSemana(c.id, user?.nombre || 'sistema', notas)
    if (!r.ok) { alert(r.error); return }
    cargar()
  }

  // ── Mis entregables (cualquier persona) ──
  const mios = useMemo(() => {
    const out: Array<{ e: Entregable; area: string }> = []
    for (const c of areas) for (const e of (c.entregables || [])) {
      if (e.responsable_id === miEmpleado) out.push({ e, area: c.area })
    }
    return out.sort((a, b) => a.e.fecha_compromiso.localeCompare(b.e.fecha_compromiso))
  }, [areas, miEmpleado])

  const esSemanaActual = semana === lunesDe()
  const dias = diasDeSemana(semana)

  const inp: React.CSSProperties = { background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', borderRadius: 5, padding: '5px 8px', fontSize: 11, fontFamily: 'inherit', outline: 'none', width: '100%' }

  if (cargando) return <div style={{ padding: 24 }}><Loading /></div>

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Encabezado + navegación de semana */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700, color: '#fff' }}>Compromiso semanal</div>
          <div style={{ fontSize: 11, color: '#888' }}>Qué se entrega, quién lo entrega, qué día y en qué calidad.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16 }}>
          <button onClick={() => setSemana(s => sumarSemanas(s, -1))} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, color: '#ccc', cursor: 'pointer', padding: '5px 7px', display: 'flex' }}><ChevronLeft size={14} /></button>
          <div style={{ textAlign: 'center', minWidth: 190 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{rangoSemana(semana)}</div>
            <div style={{ fontSize: 10, color: esSemanaActual ? '#10B981' : '#666' }}>{esSemanaActual ? 'Semana en curso' : semana}</div>
          </div>
          <button onClick={() => setSemana(s => sumarSemanas(s, 1))} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, color: '#ccc', cursor: 'pointer', padding: '5px 7px', display: 'flex' }}><ChevronRight size={14} /></button>
          {!esSemanaActual && <button onClick={() => setSemana(lunesDe())} style={{ background: 'rgba(87,255,154,0.08)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 6, color: '#10B981', cursor: 'pointer', padding: '5px 10px', fontSize: 11, fontFamily: 'inherit' }}>Hoy</button>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {([['tablero', 'Tablero de áreas'], ['mio', `Lo mío (${mios.length})`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setVista(k as any)} style={{
              padding: '6px 14px', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 6,
              border: '1px solid ' + (vista === k ? '#3B82F6' : '#2a2a2a'),
              background: vista === k ? '#3B82F622' : 'transparent', color: vista === k ? '#60A5FA' : '#888',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* ── Lo mío ── */}
      {vista === 'mio' && (
        <div>
          {!miEmpleado && (
            <div style={{ padding: 16, background: '#D9A44111', border: '1px solid #D9A44144', borderRadius: 8, fontSize: 12, color: '#D9A441' }}>
              Tu usuario no está ligado a un empleado, así que no puedo saber qué entregables son tuyos. Se liga en Usuarios.
            </div>
          )}
          {miEmpleado && mios.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#666', fontSize: 12 }}>No tienes entregables comprometidos esta semana.</div>
          )}
          {mios.map(({ e, area }) => {
            const cfg = ESTADO_ENTREGABLE_CFG[e.estado]
            const vencido = e.estado === 'comprometido' && e.fecha_compromiso < hoyISO()
            return (
              <div key={e.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', background: '#0f0f0f', border: '1px solid ' + (vencido ? '#DC262655' : '#1f1f1f'), borderRadius: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{e.titulo}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>Cómo se ve bien: {e.criterio_calidad}</div>
                  <div style={{ fontSize: 10, color: '#666', marginTop: 3 }}>
                    {area}{e.proyecto_ref ? ` · ${e.proyecto_ref}` : ''} · entrega {e.fecha_compromiso}
                    {vencido && <span style={{ color: '#DC2626', fontWeight: 700 }}> · vencido</span>}
                  </div>
                </div>
                <Badge label={cfg.label} color={cfg.color} />
                {e.estado === 'comprometido' && (
                  <button onClick={() => marcar(e, 'entregado')} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer', border: '1px solid #10B98155', background: '#10B98122', color: '#10B981' }}>
                    <Check size={11} style={{ verticalAlign: -1 }} /> Entregado
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Tablero ── */}
      {vista === 'tablero' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 12, alignItems: 'start' }}>
          {AREAS.map(a => {
            const c = porArea.get(a.key)
            const ents = c?.entregables || []
            const cum = cumplimientoDe(ents)
            const editable = puedeEditar(a.key)
            const abierta = c && c.estado !== 'cerrado'
            const cfgSem = c ? ESTADO_SEMANA_CFG[c.estado] : null
            const n = c ? (nuevo[c.id] || { titulo: '', responsable_id: '', fecha: dias[0].fecha, calidad: '', proyecto: '' }) : null

            return (
              <div key={a.key} style={{ background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '10px 12px', borderBottom: '1px solid #1a1a1a', background: a.color + '11' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: a.color }} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{a.label}</div>
                    {cfgSem && <Badge label={cfgSem.label} color={cfgSem.color} />}
                    <div style={{ marginLeft: 'auto', fontSize: 11, color: '#888' }}>
                      {cum.total > 0 && (
                        <span>
                          <b style={{ color: '#10B981' }}>{cum.entregados}</b>
                          <span style={{ color: '#555' }}> / {cum.total}</span>
                          {cum.pct != null && <span style={{ color: cum.pct >= 0.8 ? '#10B981' : cum.pct >= 0.5 ? '#D9A441' : '#DC2626', marginLeft: 6, fontWeight: 700 }}>{Math.round(cum.pct * 100)}%</span>}
                        </span>
                      )}
                    </div>
                  </div>
                  {c?.director_id && <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>Responde: {nombre(c.director_id)}</div>}
                  {cum.vencidos > 0 && (
                    <div style={{ fontSize: 10, color: '#DC2626', marginTop: 3, fontWeight: 600 }}>
                      <AlertTriangle size={10} style={{ verticalAlign: -1 }} /> {cum.vencidos} pasaron su día y siguen abiertos
                    </div>
                  )}
                </div>

                {!c ? (
                  <div style={{ padding: 20, textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>Esta área todavía no escribe su plan de la semana.</div>
                    {editable
                      ? <button onClick={() => crearSemana(a.key)} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer', border: '1px solid ' + a.color + '55', background: a.color + '22', color: a.color }}>Escribir el plan</button>
                      : <div style={{ fontSize: 10, color: '#444' }}>Lo escribe el director del área.</div>}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '4px 0' }}>
                      {ents.length === 0 && <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: '#555' }}>Sin entregables todavía.</div>}
                      {ents.map(e => {
                        const cfg = ESTADO_ENTREGABLE_CFG[e.estado]
                        const vencido = e.estado === 'comprometido' && e.fecha_compromiso < hoyISO()
                        const dia = dias.find(d => d.fecha === e.fecha_compromiso)?.label || e.fecha_compromiso
                        return (
                          <div key={e.id} style={{ padding: '8px 12px', borderBottom: '1px solid #151515', background: vencido ? '#1c1212' : 'transparent' }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, color: e.estado === 'entregado' ? '#666' : '#fff', textDecoration: e.estado === 'entregado' ? 'line-through' : 'none' }}>
                                  {e.titulo}
                                  {e.movido_de_id && <span title="Viene arrastrado de la semana pasada" style={{ color: '#D9A441', marginLeft: 5 }}>↻</span>}
                                </div>
                                <div style={{ fontSize: 10, color: '#777', marginTop: 2 }}>{nombre(e.responsable_id)} · {dia}{e.proyecto_ref ? ` · ${e.proyecto_ref}` : ''}</div>
                                <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>✓ {e.criterio_calidad}</div>
                                {e.motivo && <div style={{ fontSize: 10, color: '#DC2626', marginTop: 2 }}>Motivo: {e.motivo}</div>}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: cfg.color + '22', color: cfg.color, whiteSpace: 'nowrap' }}>{cfg.label}</span>
                                {e.estado === 'comprometido' && (editable || e.responsable_id === miEmpleado) && (
                                  <div style={{ display: 'flex', gap: 3 }}>
                                    <button onClick={() => marcar(e, 'entregado')} title="Entregado" style={{ background: 'none', border: 'none', color: '#10B981', cursor: 'pointer', padding: 1 }}><Check size={13} /></button>
                                    {editable && <>
                                      <button onClick={() => marcar(e, 'no_entregado')} title="No se entregó" style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', padding: 1 }}><X size={13} /></button>
                                      <button onClick={() => mover(e, a.key)} title="Mover a la semana siguiente" style={{ background: 'none', border: 'none', color: '#D9A441', cursor: 'pointer', padding: 1 }}><ArrowRight size={13} /></button>
                                    </>}
                                    {editable && c.estado === 'borrador' && (
                                      <button onClick={() => borrar(e)} title="Quitar" style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 1 }}><Trash2 size={12} /></button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Alta de entregable */}
                    {editable && abierta && n && (
                      <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a', background: '#111', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <input value={n.titulo} placeholder="Qué se entrega (ej. Plano eléctrico Cúspide N2 en PDF al cliente)"
                          onChange={ev => setNuevo(p => ({ ...p, [c.id]: { ...n, titulo: ev.target.value } }))} style={inp} />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <select value={n.responsable_id} onChange={ev => setNuevo(p => ({ ...p, [c.id]: { ...n, responsable_id: ev.target.value } }))} style={{ ...inp, flex: 1 }}>
                            <option value="">Quién lo entrega…</option>
                            {equipoDe(a.key).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                          <select value={n.fecha} onChange={ev => setNuevo(p => ({ ...p, [c.id]: { ...n, fecha: ev.target.value } }))} style={{ ...inp, width: 120 }}>
                            {dias.map(d => <option key={d.fecha} value={d.fecha}>{d.label}</option>)}
                          </select>
                        </div>
                        <input value={n.calidad} placeholder="En qué calidad — cómo se ve bien"
                          onChange={ev => setNuevo(p => ({ ...p, [c.id]: { ...n, calidad: ev.target.value } }))} style={inp} />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input value={n.proyecto} placeholder="Obra / cliente (opcional)"
                            onChange={ev => setNuevo(p => ({ ...p, [c.id]: { ...n, proyecto: ev.target.value } }))} style={{ ...inp, flex: 1 }} />
                          <button onClick={() => agregarEntregable(c)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer', border: '1px solid ' + a.color + '55', background: a.color + '22', color: a.color, whiteSpace: 'nowrap' }}>
                            <Plus size={11} style={{ verticalAlign: -1 }} /> Agregar
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Acciones de la semana */}
                    {editable && (
                      <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a', display: 'flex', gap: 6, alignItems: 'center' }}>
                        {c.estado === 'borrador' && (
                          <button onClick={() => comprometerSemana(c)} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer', border: '1px solid #2563EB55', background: '#2563EB22', color: '#60A5FA' }}>
                            Comprometer la semana
                          </button>
                        )}
                        {c.estado === 'comprometido' && (
                          <button onClick={() => cerrar(c)} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer', border: '1px solid #10B98155', background: '#10B98122', color: '#10B981' }}>
                            <Lock size={11} style={{ verticalAlign: -1 }} /> Cerrar la semana
                          </button>
                        )}
                        {c.estado === 'cerrado' && (
                          <span style={{ fontSize: 10, color: '#10B981' }}>
                            Cerrada{c.cerrado_at ? ' el ' + String(c.cerrado_at).slice(0, 10) : ''}
                            {c.notas_cierre ? ` · ${c.notas_cierre}` : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Nota del ritual */}
      {vista === 'tablero' && (
        <div style={{ marginTop: 18, padding: '10px 14px', background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 8, fontSize: 11, color: '#777', lineHeight: 1.6 }}>
          <Users size={12} style={{ verticalAlign: -2, marginRight: 5, color: '#666' }} />
          <b style={{ color: '#aaa' }}>El ritual:</b> el viernes cada director cierra la semana —marca qué se entregó, qué no y por qué— y escribe la siguiente.
          El lunes el equipo lo ve aquí. No se puede comprometer una semana nueva sin cerrar la anterior, y no se puede cerrar dejando entregables sin resolver.
          Lo que se mueve queda marcado con ↻ y sigue contando como no cumplido en la semana en que se prometió.
        </div>
      )}
    </div>
  )
}
