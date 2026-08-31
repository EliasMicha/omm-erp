// ═══════════════════════════════════════════════════════════════════════════
//  CAPACITACIONES
//
//  Tres pestañas, tres personas distintas:
//
//    Lo mío       → lo que a mí me toca aprender según mi puesto, y su examen
//    Catálogo     → el director arma y publica las capacitaciones de su área
//    Resultados   → quién pasó qué, y los exámenes de contratación
//
//  El alcance va de lo general a lo particular: toda la empresa → un área →
//  puestos concretos. Se acumulan; lo general no exenta de lo particular.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Badge, Btn, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { ROL_CFG, type Rol } from '../lib/roles'
import {
  cargarCapacitaciones, cargarBloques, cargarPreguntas, cargarIntentos,
  puestosDeLaNomina, areasDeLaNomina, guardarIntento, calificar, avanceDe,
  subirArchivo, idDeYouTube,
  TIPO_BLOQUE_CFG, ALCANCE_CFG,
  type Capacitacion, type BloqueCapacitacion, type PreguntaCapacitacion,
  type IntentoCapacitacion, type TipoBloque, type TipoPregunta, type AlcanceCapacitacion,
} from '../lib/capacitaciones'
import {
  GraduationCap, Plus, X, Trash2, ChevronLeft, CheckCircle2, Clock, Upload, Eye,
} from 'lucide-react'

const card: React.CSSProperties = { background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 12, padding: 14 }
const inp: React.CSSProperties = { width: '100%', background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', borderRadius: 6, padding: '7px 9px', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }
const lbl: React.CSSProperties = { fontSize: 9.5, color: '#666', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }

type Tab = 'mio' | 'catalogo' | 'resultados'

export default function Capacitaciones() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('mio')
  const [caps, setCaps] = useState<Capacitacion[]>([])
  const [intentos, setIntentos] = useState<IntentoCapacitacion[]>([])
  const [yo, setYo] = useState<{ id: string; area: string | null; puesto: string | null; name: string } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState<Capacitacion | null>(null)
  const [tomando, setTomando] = useState<Capacitacion | null>(null)

  const esDG = user?.permission_area === 'DG'

  async function recargar() {
    setCargando(true)
    const [cs, is] = await Promise.all([cargarCapacitaciones(true), cargarIntentos()])
    setCaps(cs); setIntentos(is)
    if (user?.employee_id) {
      const { data } = await supabase.from('employees').select('id,name,area,puesto').eq('id', user.employee_id).maybeSingle()
      if (data) setYo(data as any)
    }
    setCargando(false)
  }
  useEffect(() => { recargar() /* eslint-disable-next-line */ }, [user?.employee_id])

  const mias = useMemo(
    () => yo ? avanceDe(caps, intentos.filter(i => i.employee_id === yo.id), yo) : [],
    [caps, intentos, yo])

  if (cargando) return <div style={{ padding: 24 }}><Loading /></div>

  if (tomando) {
    return <TomarCapacitacion cap={tomando} yo={yo} onSalir={() => { setTomando(null); recargar() }} />
  }
  if (editando) {
    return <EditorCapacitacion cap={editando} autor={user?.nombre || ''} onSalir={() => { setEditando(null); recargar() }} />
  }

  const tabs: Array<[Tab, string, number]> = [
    ['mio', 'Lo mío', mias.filter(m => !m.aprobada).length],
    ['catalogo', 'Catálogo', caps.length],
    ['resultados', 'Resultados', intentos.filter(i => i.pendiente_revision && i.aprobado == null).length],
  ]

  return (
    <div>
      <SectionHeader
        title="Capacitaciones"
        subtitle="El conocimiento de cada área y cada puesto, escrito y evaluado"
        action={<Btn variant="primary" onClick={() => setEditando(nuevaCap(user?.nombre || ''))}><Plus size={14} /> Nueva capacitación</Btn>}
      />

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${tab === k ? '#57FF9A' : '#2a2a2a'}`,
              background: tab === k ? '#57FF9A18' : 'transparent',
              color: tab === k ? '#57FF9A' : '#888',
            }}>
            {label}{n > 0 ? ` · ${n}` : ''}
          </button>
        ))}
      </div>

      {tab === 'mio' && (
        !yo ? (
          <div style={{ ...card, color: '#FBBF24', fontSize: 12, lineHeight: 1.6 }}>
            Tu usuario no está ligado a un empleado, así que el sistema no sabe qué puesto tienes ni qué capacitaciones te tocan.
            Se liga en Usuarios, eligiendo el empleado que te corresponde.
          </div>
        ) : mias.length === 0 ? (
          <EmptyState message={`Todavía no hay capacitaciones publicadas para ${yo.puesto || 'tu puesto'}.`} />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {mias.map(m => (
              <div key={m.capacitacion.id} style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#eee' }}>{m.capacitacion.titulo}</div>
                  {m.capacitacion.descripcion && <div style={{ fontSize: 11, color: '#777', marginTop: 3 }}>{m.capacitacion.descripcion}</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <Badge label={ALCANCE_CFG[m.capacitacion.alcance].label} color={ALCANCE_CFG[m.capacitacion.alcance].color} />
                    {m.capacitacion.obligatoria && <Badge label="Obligatoria" color="#DC2626" />}
                    {m.capacitacion.minutos_estimados ? <Badge label={`~${m.capacitacion.minutos_estimados} min`} color="#6B7280" /> : null}
                  </div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 130 }}>
                  {m.aprobada ? (
                    <div style={{ color: '#10B981', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                      <CheckCircle2 size={13} /> Aprobada {m.mejor?.calificacion != null ? `· ${m.mejor.calificacion}%` : ''}
                    </div>
                  ) : m.pendienteRevision ? (
                    <div style={{ color: '#D97706', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                      <Clock size={13} /> Esperando revisión del director
                    </div>
                  ) : m.intentos.length > 0 ? (
                    <div style={{ color: '#DC2626', fontSize: 11.5 }}>
                      {m.intentos.length} intento(s) · mejor {m.mejor?.calificacion ?? 0}%
                    </div>
                  ) : (
                    <div style={{ color: '#666', fontSize: 11.5 }}>Sin empezar</div>
                  )}
                </div>
                <Btn size="sm" variant={m.aprobada ? 'default' : 'primary'} onClick={() => setTomando(m.capacitacion)}>
                  {m.aprobada ? 'Repasar' : m.intentos.length > 0 ? 'Reintentar' : 'Empezar'}
                </Btn>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'catalogo' && (
        caps.length === 0 ? <EmptyState message="Todavía no hay capacitaciones. Crea la primera." /> : (
          <div style={{ display: 'grid', gap: 10 }}>
            {caps.map(c => {
              const n = intentos.filter(i => i.capacitacion_id === c.id).length
              return (
                <div key={c.id} style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#eee' }}>{c.titulo}</div>
                    <div style={{ fontSize: 10.5, color: '#666', marginTop: 3 }}>
                      {c.alcance === 'general' ? 'Toda la empresa'
                        : c.alcance === 'area' ? `Área: ${c.area || '—'}`
                        : c.puestos.length ? c.puestos.join(' · ')
                        : c.roles.map(r => ROL_CFG[r as Rol]?.plural || r).join(' · ') || 'Sin puestos asignados'}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <Badge label={c.estado === 'publicada' ? 'Publicada' : c.estado === 'borrador' ? 'Borrador' : 'Archivada'}
                        color={c.estado === 'publicada' ? '#10B981' : c.estado === 'borrador' ? '#6B7280' : '#444'} />
                      {c.autor_nombre && <span style={{ fontSize: 10, color: '#555' }}>por {c.autor_nombre}</span>}
                      {n > 0 && <span style={{ fontSize: 10, color: '#555' }}>{n} intento(s)</span>}
                    </div>
                  </div>
                  <Btn size="sm" onClick={() => setTomando(c)}><Eye size={12} /> Ver</Btn>
                  <Btn size="sm" variant="primary" onClick={() => setEditando(c)}>Editar</Btn>
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'resultados' && <Resultados caps={caps} intentos={intentos} esDG={esDG} onCambio={recargar} />}
    </div>
  )
}

function nuevaCap(autor: string): Capacitacion {
  return {
    id: '', titulo: '', descripcion: '', alcance: 'puesto', area: null, puestos: [], roles: [],
    estado: 'borrador', obligatoria: true, minutos_estimados: null, calificacion_minima: 80,
    autor_id: null, autor_nombre: autor, orden: 0,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  EDITOR — el director arma la capacitación
// ═══════════════════════════════════════════════════════════════════════════
function EditorCapacitacion({ cap, autor, onSalir }: { cap: Capacitacion; autor: string; onSalir: () => void }) {
  const [c, setC] = useState<Capacitacion>(cap)
  const [bloques, setBloques] = useState<BloqueCapacitacion[]>([])
  const [preguntas, setPreguntas] = useState<PreguntaCapacitacion[]>([])
  const [puestos, setPuestos] = useState<Array<{ puesto: string; area: string; rol: Rol; personas: number }>>([])
  const [areas, setAreas] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [subiendo, setSubiendo] = useState(false)

  useEffect(() => {
    puestosDeLaNomina().then(setPuestos)
    areasDeLaNomina().then(setAreas)
    if (cap.id) {
      cargarBloques(cap.id).then(setBloques)
      cargarPreguntas(cap.id).then(setPreguntas)
    }
  }, [cap.id])

  async function guardar(nuevoEstado?: Capacitacion['estado']) {
    if (!c.titulo.trim()) { setError('Ponle un título.'); return }
    const estado = nuevoEstado || c.estado
    if (estado === 'publicada') {
      if (c.alcance === 'area' && !c.area) { setError('Elige el área a la que le toca antes de publicar.'); return }
      if (c.alcance === 'puesto' && c.puestos.length === 0 && c.roles.length === 0) {
        setError('Elige al menos un puesto (o un rol) antes de publicar. Si no, no le llega a nadie.'); return
      }
      if (preguntas.length === 0) { setError('Una capacitación publicada necesita su examen. Agrega al menos una pregunta.'); return }
      const sinRespuesta = preguntas.filter(p => p.tipo !== 'abierta' && !p.respuesta_correcta)
      if (sinRespuesta.length) { setError(`${sinRespuesta.length} pregunta(s) no tienen marcada la respuesta correcta.`); return }
    }
    setGuardando(true); setError('')
    try {
      const fila = {
        titulo: c.titulo.trim(), descripcion: c.descripcion || null, alcance: c.alcance,
        area: c.alcance === 'area' ? c.area : null,
        puestos: c.alcance === 'puesto' ? c.puestos : [],
        roles: c.alcance === 'puesto' ? c.roles : [],
        estado, obligatoria: c.obligatoria, minutos_estimados: c.minutos_estimados,
        calificacion_minima: c.calificacion_minima, autor_nombre: c.autor_nombre || autor,
        updated_at: new Date().toISOString(),
      }
      let id = c.id
      if (id) {
        const { error: e } = await supabase.from('capacitaciones').update(fila).eq('id', id)
        if (e) throw new Error(e.message)
      } else {
        const { data, error: e } = await supabase.from('capacitaciones').insert(fila).select().single()
        if (e) throw new Error(e.message)
        id = (data as any).id
        setC(x => ({ ...x, id }))
      }
      // Los bloques y preguntas se reescriben completos: son pocos y así el
      // orden queda exactamente como se ve en pantalla.
      await supabase.from('capacitacion_bloques').delete().eq('capacitacion_id', id)
      if (bloques.length) {
        await supabase.from('capacitacion_bloques').insert(bloques.map((b, i) => ({
          capacitacion_id: id, tipo: b.tipo, titulo: b.titulo || null,
          contenido: b.contenido || null, url: b.url || null, storage_path: b.storage_path || null,
          order_index: i,
        })))
      }
      await supabase.from('capacitacion_preguntas').delete().eq('capacitacion_id', id)
      if (preguntas.length) {
        await supabase.from('capacitacion_preguntas').insert(preguntas.map((p, i) => ({
          capacitacion_id: id, pregunta: p.pregunta, tipo: p.tipo,
          opciones: p.opciones || [], respuesta_correcta: p.respuesta_correcta || null,
          explicacion: p.explicacion || null, puntos: p.puntos || 1, order_index: i,
        })))
      }
      onSalir()
    } catch (e: any) { setError(e?.message || String(e)) }
    setGuardando(false)
  }

  async function subir(idx: number, file: File) {
    if (!c.id) { setError('Guarda la capacitación una vez antes de subir archivos: necesita un id para acomodarlos.'); return }
    setSubiendo(true); setError('')
    try {
      const { path, url } = await subirArchivo(c.id, file)
      setBloques(bs => bs.map((b, i) => i === idx ? { ...b, storage_path: path, url, titulo: b.titulo || file.name } : b))
    } catch (e: any) { setError(e?.message || String(e)) }
    setSubiendo(false)
  }

  const addBloque = (tipo: TipoBloque) => setBloques(bs => [...bs, {
    id: 'tmp' + Date.now(), capacitacion_id: c.id, tipo, titulo: '', contenido: '', url: '', storage_path: null, order_index: bs.length,
  }])
  const addPregunta = (tipo: TipoPregunta) => setPreguntas(ps => [...ps, {
    id: 'tmp' + Date.now(), capacitacion_id: c.id, pregunta: '', tipo,
    opciones: tipo === 'opcion_multiple' ? ['', ''] : [], respuesta_correcta: tipo === 'verdadero_falso' ? 'true' : null,
    explicacion: '', puntos: 1, order_index: ps.length,
  }])

  const puestosFiltrados = puestos

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Btn size="sm" onClick={onSalir}><ChevronLeft size={13} /> Volver</Btn>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', flex: 1 }}>{c.id ? 'Editar capacitación' : 'Nueva capacitación'}</div>
        <Btn size="sm" onClick={() => guardar('borrador')} disabled={guardando}>Guardar borrador</Btn>
        <Btn size="sm" variant="primary" onClick={() => guardar('publicada')} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Publicar'}
        </Btn>
      </div>

      {error && <div style={{ ...card, borderColor: '#DC262655', color: '#DC2626', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div style={{ ...card, marginBottom: 12, display: 'grid', gap: 12 }}>
        <div>
          <div style={lbl}>Título</div>
          <input value={c.titulo} onChange={e => setC({ ...c, titulo: e.target.value })} style={inp} placeholder="Ej. Sembrado de iluminación: qué debe contener" />
        </div>
        <div>
          <div style={lbl}>De qué trata</div>
          <textarea value={c.descripcion || ''} onChange={e => setC({ ...c, descripcion: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical' }} />
        </div>

        <div>
          <div style={lbl}>A quién le toca</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(Object.keys(ALCANCE_CFG) as AlcanceCapacitacion[]).map(a => (
              <button key={a} onClick={() => setC({ ...c, alcance: a })}
                style={{
                  padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', flex: '1 1 180px',
                  border: `1px solid ${c.alcance === a ? ALCANCE_CFG[a].color : '#2a2a2a'}`,
                  background: c.alcance === a ? ALCANCE_CFG[a].color + '18' : 'transparent',
                }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: c.alcance === a ? ALCANCE_CFG[a].color : '#888' }}>{ALCANCE_CFG[a].label}</div>
                <div style={{ fontSize: 9.5, color: '#666', marginTop: 2 }}>{ALCANCE_CFG[a].ayuda}</div>
              </button>
            ))}
          </div>
        </div>

        {c.alcance === 'area' && (
          <div>
            <div style={lbl}>Área</div>
            <select value={c.area || ''} onChange={e => setC({ ...c, area: e.target.value || null })} style={inp}>
              <option value="">-- Elegir área --</option>
              {areas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}

        {c.alcance === 'puesto' && (
          <div>
            <div style={lbl}>Puestos ({c.puestos.length} elegidos)</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
              {puestosFiltrados.map(p => {
                const on = c.puestos.includes(p.puesto)
                return (
                  <button key={p.puesto} onClick={() => setC(x => ({ ...x, puestos: on ? x.puestos.filter(q => q !== p.puesto) : [...x.puestos, p.puesto] }))}
                    title={`${p.area} · ${p.personas} persona(s)`}
                    style={{
                      padding: '4px 10px', borderRadius: 16, fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${on ? '#10B981' : '#2a2a2a'}`,
                      background: on ? '#10B98118' : 'transparent', color: on ? '#10B981' : '#888',
                    }}>{p.puesto} <span style={{ opacity: .6 }}>· {p.personas}</span></button>
                )
              })}
            </div>
            <div style={{ ...lbl, marginTop: 4 }}>O por rol, si prefieres no listar cada variante del puesto</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {(Object.keys(ROL_CFG) as Rol[]).map(r => {
                const on = c.roles.includes(r)
                return (
                  <button key={r} onClick={() => setC(x => ({ ...x, roles: on ? x.roles.filter(q => q !== r) : [...x.roles, r] }))}
                    style={{
                      padding: '4px 10px', borderRadius: 16, fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${on ? ROL_CFG[r].color : '#2a2a2a'}`,
                      background: on ? ROL_CFG[r].color + '18' : 'transparent', color: on ? ROL_CFG[r].color : '#888',
                    }}>{ROL_CFG[r].plural}</button>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ width: 150 }}>
            <div style={lbl}>Minutos estimados</div>
            <input type="number" value={c.minutos_estimados ?? ''} onChange={e => setC({ ...c, minutos_estimados: e.target.value ? Number(e.target.value) : null })} style={inp} placeholder="30" />
          </div>
          <div style={{ width: 170 }}>
            <div style={lbl}>Mínimo para aprobar (%)</div>
            <input type="number" value={c.calificacion_minima} onChange={e => setC({ ...c, calificacion_minima: Number(e.target.value) || 0 })} style={inp} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#aaa', cursor: 'pointer', paddingBottom: 7 }}>
            <input type="checkbox" checked={c.obligatoria} onChange={e => setC({ ...c, obligatoria: e.target.checked })} />
            Obligatoria
          </label>
        </div>
      </div>

      {/* ── Contenido ── */}
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#eee' }}>Contenido ({bloques.length})</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {(Object.keys(TIPO_BLOQUE_CFG) as TipoBloque[]).map(t => (
              <button key={t} onClick={() => addBloque(t)} title={TIPO_BLOQUE_CFG[t].ayuda}
                style={{ padding: '4px 10px', borderRadius: 16, fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #2a2a2a', background: 'transparent', color: '#888' }}>
                <Plus size={9} /> {TIPO_BLOQUE_CFG[t].icono} {TIPO_BLOQUE_CFG[t].label}
              </button>
            ))}
          </div>
        </div>
        {bloques.length === 0 && <div style={{ fontSize: 11.5, color: '#666' }}>Sin contenido todavía. Agrega texto, un video, un documento…</div>}
        <div style={{ display: 'grid', gap: 8 }}>
          {bloques.map((b, i) => (
            <div key={b.id} style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: '#57FF9A', fontWeight: 700 }}>{TIPO_BLOQUE_CFG[b.tipo].icono} {TIPO_BLOQUE_CFG[b.tipo].label}</span>
                <input value={b.titulo || ''} onChange={e => setBloques(bs => bs.map((x, j) => j === i ? { ...x, titulo: e.target.value } : x))}
                  placeholder="Título del bloque (opcional)" style={{ ...inp, flex: 1, padding: '4px 8px' }} />
                <button onClick={() => setBloques(bs => bs.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><Trash2 size={13} /></button>
              </div>
              {(b.tipo === 'texto' || b.tipo === 'diagrama') && (
                <textarea value={b.contenido || ''} onChange={e => setBloques(bs => bs.map((x, j) => j === i ? { ...x, contenido: e.target.value } : x))}
                  rows={b.tipo === 'diagrama' ? 6 : 4} style={{ ...inp, resize: 'vertical', fontFamily: b.tipo === 'diagrama' ? 'monospace' : 'inherit' }}
                  placeholder={TIPO_BLOQUE_CFG[b.tipo].ayuda} />
              )}
              {(b.tipo === 'youtube' || b.tipo === 'liga') && (
                <>
                  <input value={b.url || ''} onChange={e => setBloques(bs => bs.map((x, j) => j === i ? { ...x, url: e.target.value } : x))}
                    placeholder={b.tipo === 'youtube' ? 'https://www.youtube.com/watch?v=…' : 'https://…'} style={inp} />
                  {b.tipo === 'youtube' && b.url && !idDeYouTube(b.url) && (
                    <div style={{ fontSize: 10.5, color: '#FBBF24', marginTop: 4 }}>No reconozco esa liga de YouTube. Pega la del navegador o la de "Compartir".</div>
                  )}
                </>
              )}
              {(b.tipo === 'video' || b.tipo === 'documento' || b.tipo === 'imagen') && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 6, border: '1px solid #2a2a2a', color: '#888', fontSize: 11, cursor: 'pointer' }}>
                    <Upload size={11} /> {subiendo ? 'Subiendo…' : 'Subir archivo'}
                    <input type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) subir(i, f) }} />
                  </label>
                  {b.url && <a href={b.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#57FF9A' }}>Ver archivo</a>}
                  <span style={{ fontSize: 10, color: '#555' }}>{TIPO_BLOQUE_CFG[b.tipo].ayuda}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Examen ── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#eee' }}>Examen ({preguntas.length})</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <button onClick={() => addPregunta('opcion_multiple')} style={{ padding: '4px 10px', borderRadius: 16, fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #2a2a2a', background: 'transparent', color: '#888' }}><Plus size={9} /> Opción múltiple</button>
            <button onClick={() => addPregunta('verdadero_falso')} style={{ padding: '4px 10px', borderRadius: 16, fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #2a2a2a', background: 'transparent', color: '#888' }}><Plus size={9} /> Verdadero / Falso</button>
            <button onClick={() => addPregunta('abierta')} style={{ padding: '4px 10px', borderRadius: 16, fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #2a2a2a', background: 'transparent', color: '#888' }}><Plus size={9} /> Abierta</button>
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: '#666', marginBottom: 10 }}>
          Las preguntas abiertas no se califican solas: el intento queda esperando que tú lo revises.
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {preguntas.map((p, i) => (
            <div key={p.id} style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: '#888', fontWeight: 700, minWidth: 18 }}>{i + 1}.</span>
                <input value={p.pregunta} onChange={e => setPreguntas(ps => ps.map((x, j) => j === i ? { ...x, pregunta: e.target.value } : x))}
                  placeholder="La pregunta" style={{ ...inp, flex: 1, padding: '5px 8px' }} />
                <input type="number" value={p.puntos} onChange={e => setPreguntas(ps => ps.map((x, j) => j === i ? { ...x, puntos: Number(e.target.value) || 1 } : x))}
                  title="Puntos" style={{ ...inp, width: 58, padding: '5px 6px', textAlign: 'center' }} />
                <button onClick={() => setPreguntas(ps => ps.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><Trash2 size={13} /></button>
              </div>

              {p.tipo === 'opcion_multiple' && (
                <div style={{ display: 'grid', gap: 5, paddingLeft: 26 }}>
                  {p.opciones.map((o, oi) => (
                    <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <input type="radio" checked={p.respuesta_correcta === String(oi)} onChange={() => setPreguntas(ps => ps.map((x, j) => j === i ? { ...x, respuesta_correcta: String(oi) } : x))} title="Marcar como correcta" />
                      <input value={o} onChange={e => setPreguntas(ps => ps.map((x, j) => j === i ? { ...x, opciones: x.opciones.map((y, k) => k === oi ? e.target.value : y) } : x))}
                        placeholder={`Opción ${oi + 1}`} style={{ ...inp, padding: '4px 8px' }} />
                      <button onClick={() => setPreguntas(ps => ps.map((x, j) => j === i ? { ...x, opciones: x.opciones.filter((_, k) => k !== oi) } : x))}
                        style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><X size={11} /></button>
                    </div>
                  ))}
                  <button onClick={() => setPreguntas(ps => ps.map((x, j) => j === i ? { ...x, opciones: [...x.opciones, ''] } : x))}
                    style={{ justifySelf: 'start', padding: '2px 9px', borderRadius: 14, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #2a2a2a', background: 'transparent', color: '#777' }}>+ Opción</button>
                </div>
              )}

              {p.tipo === 'verdadero_falso' && (
                <div style={{ display: 'flex', gap: 12, paddingLeft: 26, fontSize: 11.5, color: '#aaa' }}>
                  {['true', 'false'].map(v => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <input type="radio" checked={p.respuesta_correcta === v} onChange={() => setPreguntas(ps => ps.map((x, j) => j === i ? { ...x, respuesta_correcta: v } : x))} />
                      {v === 'true' ? 'Verdadero' : 'Falso'}
                    </label>
                  ))}
                </div>
              )}

              {p.tipo === 'abierta' && (
                <div style={{ paddingLeft: 26, fontSize: 10.5, color: '#666' }}>Respuesta libre. La calificas tú al revisar el intento.</div>
              )}

              <div style={{ paddingLeft: 26, marginTop: 6 }}>
                <input value={p.explicacion || ''} onChange={e => setPreguntas(ps => ps.map((x, j) => j === i ? { ...x, explicacion: e.target.value } : x))}
                  placeholder="Por qué esa es la respuesta (se muestra al terminar)" style={{ ...inp, padding: '4px 8px', fontSize: 11 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOMAR — leer el contenido y contestar el examen
// ═══════════════════════════════════════════════════════════════════════════
function TomarCapacitacion({ cap, yo, onSalir }: {
  cap: Capacitacion
  yo: { id: string; area: string | null; puesto: string | null; name: string } | null
  onSalir: () => void
}) {
  const [bloques, setBloques] = useState<BloqueCapacitacion[]>([])
  const [preguntas, setPreguntas] = useState<PreguntaCapacitacion[]>([])
  const [respuestas, setRespuestas] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<ReturnType<typeof calificar> | null>(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  // Modo contratación: el examen se le aplica a alguien que todavía no es empleado
  const [candidato, setCandidato] = useState('')
  const [candidatoPuesto, setCandidatoPuesto] = useState('')
  const [modoContratacion, setModoContratacion] = useState(false)

  useEffect(() => {
    Promise.all([cargarBloques(cap.id), cargarPreguntas(cap.id)]).then(([b, p]) => {
      setBloques(b); setPreguntas(p); setCargando(false)
    })
  }, [cap.id])

  async function enviar() {
    const faltan = preguntas.filter(p => !(respuestas[p.id] ?? '').toString().trim())
    if (faltan.length) { setError(`Faltan ${faltan.length} pregunta(s) por contestar.`); return }
    if (modoContratacion && !candidato.trim()) { setError('Pon el nombre del candidato.'); return }
    setEnviando(true); setError('')
    try {
      const { resultado: r } = await guardarIntento({
        capacitacion: cap, preguntas, respuestas,
        employeeId: modoContratacion ? null : (yo?.id || null),
        candidatoNombre: modoContratacion ? candidato.trim() : null,
        candidatoPuesto: modoContratacion ? candidatoPuesto.trim() : null,
        motivo: modoContratacion ? 'contratacion' : 'capacitacion',
      })
      setResultado(r)
    } catch (e: any) { setError(e?.message || String(e)) }
    setEnviando(false)
  }

  if (cargando) return <div style={{ padding: 24 }}><Loading /></div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Btn size="sm" onClick={onSalir}><ChevronLeft size={13} /> Volver</Btn>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{cap.titulo}</div>
          {cap.descripcion && <div style={{ fontSize: 11.5, color: '#777', marginTop: 2 }}>{cap.descripcion}</div>}
        </div>
        {!resultado && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888', cursor: 'pointer' }}>
            <input type="checkbox" checked={modoContratacion} onChange={e => setModoContratacion(e.target.checked)} />
            Aplicar a un candidato
          </label>
        )}
      </div>

      {modoContratacion && !resultado && (
        <div style={{ ...card, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <div style={lbl}>Nombre del candidato</div>
            <input value={candidato} onChange={e => setCandidato(e.target.value)} style={inp} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <div style={lbl}>Puesto al que aplica</div>
            <input value={candidatoPuesto} onChange={e => setCandidatoPuesto(e.target.value)} style={inp} placeholder="Ej. DIBUJANTE INSTALACIONES" />
          </div>
        </div>
      )}

      {/* Contenido */}
      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        {bloques.length === 0 && <div style={{ ...card, fontSize: 11.5, color: '#666' }}>Esta capacitación todavía no tiene contenido cargado.</div>}
        {bloques.map(b => (
          <div key={b.id} style={card}>
            {b.titulo && <div style={{ fontSize: 12.5, fontWeight: 600, color: '#eee', marginBottom: 6 }}>{b.titulo}</div>}
            {b.tipo === 'texto' && <div style={{ fontSize: 12.5, color: '#bbb', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{b.contenido}</div>}
            {b.tipo === 'diagrama' && <pre style={{ fontSize: 11.5, color: '#bbb', background: '#141414', border: '1px solid #222', borderRadius: 6, padding: 10, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{b.contenido}</pre>}
            {b.tipo === 'youtube' && (() => {
              const id = idDeYouTube(b.url || '')
              return id ? (
                <div style={{ position: 'relative', paddingTop: '56.25%', borderRadius: 8, overflow: 'hidden' }}>
                  <iframe src={`https://www.youtube.com/embed/${id}`} title={b.titulo || 'Video'} allowFullScreen
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
                </div>
              ) : <a href={b.url || '#'} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#57FF9A' }}>{b.url}</a>
            })()}
            {b.tipo === 'video' && b.url && <video src={b.url} controls style={{ width: '100%', borderRadius: 8, background: '#000' }} />}
            {b.tipo === 'imagen' && b.url && <img src={b.url} alt={b.titulo || ''} style={{ maxWidth: '100%', borderRadius: 8 }} />}
            {(b.tipo === 'documento' || b.tipo === 'liga') && b.url && (
              <a href={b.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#57FF9A' }}>{b.tipo === 'documento' ? 'Abrir documento' : b.url}</a>
            )}
          </div>
        ))}
      </div>

      {/* Examen */}
      {preguntas.length > 0 && !resultado && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#eee', marginBottom: 4 }}>Examen</div>
          <div style={{ fontSize: 10.5, color: '#666', marginBottom: 12 }}>
            Se aprueba con {cap.calificacion_minima}% o más. {preguntas.some(p => p.tipo === 'abierta') ? 'Trae preguntas abiertas: el resultado final lo da el director al revisarlas.' : ''}
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {preguntas.map((p, i) => (
              <div key={p.id} style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, padding: 11 }}>
                <div style={{ fontSize: 12.5, color: '#ddd', marginBottom: 8 }}>
                  <b style={{ color: '#888' }}>{i + 1}.</b> {p.pregunta}
                  <span style={{ fontSize: 10, color: '#555', marginLeft: 6 }}>({p.puntos} pt)</span>
                </div>
                {p.tipo === 'opcion_multiple' && (
                  <div style={{ display: 'grid', gap: 5 }}>
                    {p.opciones.map((o, oi) => (
                      <label key={oi} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#bbb', cursor: 'pointer' }}>
                        <input type="radio" name={p.id} checked={respuestas[p.id] === String(oi)} onChange={() => setRespuestas(r => ({ ...r, [p.id]: String(oi) }))} />
                        {o}
                      </label>
                    ))}
                  </div>
                )}
                {p.tipo === 'verdadero_falso' && (
                  <div style={{ display: 'flex', gap: 14 }}>
                    {['true', 'false'].map(v => (
                      <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#bbb', cursor: 'pointer' }}>
                        <input type="radio" name={p.id} checked={respuestas[p.id] === v} onChange={() => setRespuestas(r => ({ ...r, [p.id]: v }))} />
                        {v === 'true' ? 'Verdadero' : 'Falso'}
                      </label>
                    ))}
                  </div>
                )}
                {p.tipo === 'abierta' && (
                  <textarea value={respuestas[p.id] || ''} onChange={e => setRespuestas(r => ({ ...r, [p.id]: e.target.value }))}
                    rows={3} style={{ ...inp, resize: 'vertical' }} placeholder="Tu respuesta" />
                )}
              </div>
            ))}
          </div>
          {error && <div style={{ color: '#DC2626', fontSize: 12, marginTop: 10 }}>{error}</div>}
          <div style={{ marginTop: 12 }}>
            <Btn variant="primary" onClick={enviar} disabled={enviando}>{enviando ? 'Enviando…' : 'Entregar examen'}</Btn>
          </div>
        </div>
      )}

      {resultado && (
        <div style={{ ...card, borderColor: resultado.aprobado === true ? '#10B98155' : resultado.aprobado === false ? '#DC262655' : '#D9770655' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: resultado.aprobado === true ? '#10B981' : resultado.aprobado === false ? '#DC2626' : '#D97706' }}>
            {resultado.calificacion}%
          </div>
          <div style={{ fontSize: 12.5, color: '#ccc', marginTop: 4 }}>
            {resultado.aprobado === true && `Aprobado. El mínimo era ${cap.calificacion_minima}%.`}
            {resultado.aprobado === false && `No alcanzó el mínimo de ${cap.calificacion_minima}%. Se puede repetir.`}
            {resultado.aprobado === null && `Faltan ${resultado.abiertas} pregunta(s) abiertas por revisar. El resultado final lo da el director.`}
          </div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
            {resultado.puntos} de {resultado.calificables} puntos calificables automáticamente{resultado.abiertas > 0 ? ` · ${resultado.posibles} puntos en total contando las abiertas` : ''}.
          </div>
          <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            {preguntas.map((p, i) => {
              const d = resultado.detalle.find(x => x.pregunta_id === p.id)
              return (
                <div key={p.id} style={{ fontSize: 11.5, color: '#999', borderTop: '1px solid #1a1a1a', paddingTop: 6 }}>
                  <span style={{ color: d?.correcta === true ? '#10B981' : d?.correcta === false ? '#DC2626' : '#D97706', fontWeight: 700 }}>
                    {d?.correcta === true ? '✓' : d?.correcta === false ? '✕' : '…'}
                  </span>{' '}
                  {i + 1}. {p.pregunta}
                  {p.explicacion && <div style={{ fontSize: 10.5, color: '#666', marginTop: 2, paddingLeft: 14 }}>{p.explicacion}</div>}
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 14 }}><Btn onClick={onSalir}>Volver</Btn></div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  RESULTADOS
// ═══════════════════════════════════════════════════════════════════════════
function Resultados({ caps, intentos, esDG, onCambio }: { caps: Capacitacion[]; intentos: IntentoCapacitacion[]; esDG: boolean; onCambio: () => void }) {
  const [empleados, setEmpleados] = useState<Record<string, string>>({})
  const [filtro, setFiltro] = useState<'todos' | 'capacitacion' | 'contratacion' | 'pendientes'>('todos')

  useEffect(() => {
    supabase.from('employees').select('id,name').then(({ data }) => {
      const m: Record<string, string> = {}
      for (const e of ((data as any[]) || [])) m[e.id] = e.name
      setEmpleados(m)
    })
  }, [])

  const capNombre = (id: string) => caps.find(c => c.id === id)?.titulo || '—'
  const lista = intentos.filter(i =>
    filtro === 'todos' ? true
      : filtro === 'pendientes' ? (i.pendiente_revision && i.aprobado == null)
      : i.motivo === filtro)

  async function calificarAbierta(i: IntentoCapacitacion, aprobado: boolean) {
    await supabase.from('capacitacion_intentos')
      .update({ aprobado, pendiente_revision: false })
      .eq('id', i.id)
    onCambio()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {([['todos', 'Todos'], ['capacitacion', 'Empleados'], ['contratacion', 'Candidatos'], ['pendientes', 'Por revisar']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFiltro(k)}
            style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${filtro === k ? '#57FF9A' : '#2a2a2a'}`,
              background: filtro === k ? '#57FF9A18' : 'transparent', color: filtro === k ? '#57FF9A' : '#888',
            }}>{l}</button>
        ))}
      </div>
      {lista.length === 0 ? <EmptyState message="Sin intentos que mostrar." /> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {lista.map(i => (
            <div key={i.id} style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12.5, color: '#eee', fontWeight: 600 }}>
                  {i.employee_id ? (empleados[i.employee_id] || 'Empleado') : (i.candidato_nombre || 'Candidato')}
                  {i.motivo === 'contratacion' && <span style={{ fontSize: 10, color: '#A78BFA', marginLeft: 6 }}>· candidato{i.candidato_puesto ? ` a ${i.candidato_puesto}` : ''}</span>}
                </div>
                <div style={{ fontSize: 10.5, color: '#666', marginTop: 2 }}>{capNombre(i.capacitacion_id)}</div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, minWidth: 60, textAlign: 'right', color: i.aprobado === true ? '#10B981' : i.aprobado === false ? '#DC2626' : '#D97706' }}>
                {i.calificacion != null ? `${i.calificacion}%` : '—'}
              </div>
              <div style={{ minWidth: 130, textAlign: 'right' }}>
                {i.pendiente_revision && i.aprobado == null ? (
                  esDG ? (
                    <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                      <Btn size="sm" onClick={() => calificarAbierta(i, false)}>No pasa</Btn>
                      <Btn size="sm" variant="primary" onClick={() => calificarAbierta(i, true)}>Aprobar</Btn>
                    </div>
                  ) : <Badge label="Por revisar" color="#D97706" />
                ) : (
                  <Badge label={i.aprobado ? 'Aprobado' : 'No aprobado'} color={i.aprobado ? '#10B981' : '#DC2626'} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
