// ═══════════════════════════════════════════════════════════════════════════
// Documentación — dónde queda todo, y el reloj del que revisa.
//
// Tres pestañas, en el orden en que se usan:
//
//   ARCHIVO      Todo junto: los entregables nuevos y la documentación
//                técnica que ya vivía en Proyectos como links de Drive.
//                Quien busca un plano seis meses después no se acuerda —ni
//                tiene por qué— de por cuál de los dos caminos entró.
//
//   POR REVISAR  La bandeja del que revisa, ordenada por el que lleva más
//                esperando. Aquí se ve el número que faltaba: cuánto tarda un
//                director en contestar. "Está en revisión" deja de ser el
//                mejor escondite de la organización.
//
//   QUÉ SE ESPERA  Las recetas. El instructivo y el checklist de cada tipo de
//                entregable, editables. Son de OMM, no míos: las que están
//                cargadas son un borrador para corregir.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { AREAS_TRABAJO } from '../lib/tareas'
import {
  DocIndex, Entregable, TipoEntregable, ChecklistItem, ESTADO_CFG,
  cargarDocumentacion, cargarTipos, guardarTipo, pendientesDeRevision,
  diasEsperando, colorEspera, urlDe, pesoLegible,
} from '../lib/entregables'
import RevisarEntregable from '../components/RevisarEntregable'
import { FileText, Search, ExternalLink, Check, RotateCcw, Clock, BookOpen, Inbox, Archive, Plus, X } from 'lucide-react'

const card: React.CSSProperties = { background: '#111', border: '1px solid #222', borderRadius: 12, padding: 16 }
const inp: React.CSSProperties = { background: '#141414', color: '#ddd', border: '1px solid #242424', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontFamily: 'inherit', outline: 'none' }
const btn: React.CSSProperties = { border: '1px solid #333', background: '#161616', color: '#ccc', borderRadius: 8, padding: '6px 11px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const th: React.CSSProperties = { textAlign: 'left', fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: '#666', padding: '8px 10px', borderBottom: '1px solid #222', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: 12.5, padding: '9px 10px', borderBottom: '1px solid #1a1a1a' }

interface Emp { id: string; name: string; area?: string | null; puesto?: string | null }

export default function Documentacion() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'archivo' | 'revisar' | 'recetas'>('archivo')
  const [docs, setDocs] = useState<DocIndex[]>([])
  const [pend, setPend] = useState<Entregable[]>([])
  const [tipos, setTipos] = useState<TipoEntregable[]>([])
  const [emps, setEmps] = useState<Emp[]>([])
  const [cargando, setCargando] = useState(true)

  async function cargar() {
    setCargando(true)
    const [d, p, t, { data: e }] = await Promise.all([
      cargarDocumentacion(), pendientesDeRevision(), cargarTipos(),
      supabase.from('employees').select('id,name,area,puesto').eq('is_active', true).order('name'),
    ])
    setDocs(d); setPend(p); setTipos(t); setEmps((e as any[]) || [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const nombreDe = (id?: string | null) => emps.find(x => x.id === id)?.name || '—'

  const TABS = [
    { key: 'archivo' as const, label: 'Archivo', icono: Archive, n: docs.length },
    { key: 'revisar' as const, label: 'Por revisar', icono: Inbox, n: pend.length },
    { key: 'recetas' as const, label: 'Qué se espera', icono: BookOpen, n: tipos.length },
  ]

  return (
    <div style={{ padding: 24, maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#eee', margin: 0 }}>Documentación</h1>
        <p style={{ fontSize: 12, color: '#777', margin: '4px 0 0', maxWidth: 700, lineHeight: 1.6 }}>
          Todo lo que se ha entregado, en un solo lugar y con su historia: quién lo subió, cuándo,
          contra qué checklist, quién lo revisó y qué se corrigió.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => {
          const I = t.icono
          const activo = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              ...btn,
              borderColor: activo ? '#3b82f6' : '#333',
              background: activo ? '#111a26' : 'transparent',
              color: activo ? '#93c5fd' : '#888',
            }}>
              <I size={13} /> {t.label}
              <span style={{ color: t.key === 'revisar' && t.n > 0 ? '#D9A441' : '#666', fontWeight: 600 }}>{t.n}</span>
            </button>
          )
        })}
      </div>

      {cargando ? <div style={{ ...card, textAlign: 'center', color: '#666', padding: 40 }}>Cargando…</div> : (
        <>
          {tab === 'archivo' && <Archivo docs={docs} nombreDe={nombreDe} />}
          {tab === 'revisar' && (
            <PorRevisar pend={pend} nombreDe={nombreDe} employeeId={user?.employee_id}
              tipos={tipos} onCambio={cargar} />
          )}
          {tab === 'recetas' && <Recetas tipos={tipos} employeeId={user?.employee_id} onCambio={cargar} />}
        </>
      )}
    </div>
  )
}

// ── ARCHIVO ────────────────────────────────────────────────────────────────

function Archivo({ docs, nombreDe }: { docs: DocIndex[]; nombreDe: (id?: string | null) => string }) {
  const [q, setQ] = useState('')
  const [fTipo, setFTipo] = useState('')
  const [fArea, setFArea] = useState('')
  const [fProy, setFProy] = useState('')

  const tipos = useMemo(() => [...new Set(docs.map(d => d.tipo))].sort(), [docs])
  const proyectos = useMemo(() => [...new Set(docs.map(d => d.proyecto).filter(Boolean))].sort() as string[], [docs])

  const lista = useMemo(() => docs.filter(d => {
    if (fTipo && d.tipo !== fTipo) return false
    if (fArea && d.specialty !== fArea) return false
    if (fProy && d.proyecto !== fProy) return false
    if (!q.trim()) return true
    const t = q.toLowerCase()
    return [d.nombre, d.tipo, d.proyecto].filter(Boolean).some(x => String(x).toLowerCase().includes(t))
  }), [docs, q, fTipo, fArea, fProy])

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={13} color="#555" style={{ position: 'absolute', left: 10, top: 9 }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre, tipo o proyecto…"
            style={{ ...inp, width: '100%', paddingLeft: 30 }} />
        </div>
        <select value={fTipo} onChange={e => setFTipo(e.target.value)} style={{ ...inp, minWidth: 150 }}>
          <option value="">Todo tipo</option>
          {tipos.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={fArea} onChange={e => setFArea(e.target.value)} style={{ ...inp, minWidth: 150 }}>
          <option value="">Toda área</option>
          {AREAS_TRABAJO.map(a => <option key={a.specialty} value={a.specialty}>{a.label}</option>)}
        </select>
        <select value={fProy} onChange={e => setFProy(e.target.value)} style={{ ...inp, minWidth: 170 }}>
          <option value="">Todo proyecto</option>
          {proyectos.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <thead><tr>
            <th style={th}>Documento</th>
            <th style={th}>Tipo</th>
            <th style={th}>Proyecto / cliente</th>
            <th style={th}>Subió</th>
            <th style={th}>Fecha</th>
            <th style={th}>Estado</th>
            <th style={th}></th>
          </tr></thead>
          <tbody>
            {lista.length === 0 && (
              <tr><td style={{ ...td, color: '#666', textAlign: 'center', padding: 30 }} colSpan={7}>
                {docs.length === 0
                  ? 'Todavía no hay nada. Los entregables aparecen aquí en cuanto alguien sube el primero desde su tarea.'
                  : 'Nada coincide con el filtro.'}
              </td></tr>
            )}
            {lista.slice(0, 400).map(d => (
              <tr key={d.origen + d.id}>
                <td style={{ ...td, color: '#ddd' }}>
                  <FileText size={12} color="#666" style={{ verticalAlign: -1, marginRight: 7 }} />
                  {d.nombre}
                  {d.version && <span style={{ color: '#666', fontSize: 10, marginLeft: 6 }}>{d.version}</span>}
                  {d.bytes ? <span style={{ color: '#555', fontSize: 10, marginLeft: 6 }}>{pesoLegible(d.bytes)}</span> : null}
                </td>
                <td style={{ ...td, color: '#999' }}>{d.tipo}</td>
                <td style={{ ...td, color: '#999' }}>{d.proyecto || '—'}</td>
                <td style={{ ...td, color: '#888' }}>{nombreDe(d.subido_por_id)}</td>
                <td style={{ ...td, color: '#888', whiteSpace: 'nowrap' }}>{new Date(d.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                <td style={td}>
                  {d.estado
                    ? <span style={{ fontSize: 10, color: ESTADO_CFG[d.estado].color, border: `1px solid ${ESTADO_CFG[d.estado].color}44`, borderRadius: 5, padding: '1px 6px' }}>{ESTADO_CFG[d.estado].label}</span>
                    : <span style={{ fontSize: 10, color: '#555' }}>Técnico</span>}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {d.url && <a href={d.url} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none' }}><ExternalLink size={12} /> Abrir</a>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lista.length > 400 && (
        <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>Mostrando 400 de {lista.length}. Filtra para acotar.</div>
      )}
    </>
  )
}

// ── POR REVISAR ────────────────────────────────────────────────────────────

function PorRevisar({ pend, nombreDe, employeeId, tipos, onCambio }: {
  pend: Entregable[]
  nombreDe: (id?: string | null) => string
  employeeId?: string | null
  tipos: TipoEntregable[]
  onCambio: () => void
}) {
  const viejo = pend.filter(e => diasEsperando(e) >= 3).length

  return (
    <>
      <div style={{ ...card, marginBottom: 12, background: '#0d1117', borderColor: '#1c2531' }}>
        <p style={{ fontSize: 12, color: '#9fb3c8', margin: 0, lineHeight: 1.7 }}>
          Dos botones y se acabó: <b style={{ color: '#cfe0ee' }}>Aceptar</b> cierra la tarea,
          <b style={{ color: '#cfe0ee' }}> Corregir</b> la devuelve y cuenta una vuelta.
          Devolver exige escribir qué corregir — devolver sin decir qué está mal garantiza otra vuelta.
          {viejo > 0 && <span style={{ color: '#DC2626' }}> {viejo} llevan 3 días o más esperando respuesta.</span>}
        </p>
      </div>

      {pend.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: '#666', padding: 34, fontSize: 13 }}>
          Nada esperando revisión.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pend.map(e => {
          const dias = diasEsperando(e)
          const url = urlDe(e)
          const tipo = tipos.find(t => t.id === e.tipo_id)
          const faltaron = (e.checklist || []).filter((i: ChecklistItem) => i.obligatorio && !i.marcado)
          return (
            <div key={e.id} style={{ ...card, borderColor: dias >= 3 ? '#3a2a15' : '#222' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 14, color: '#eee', fontWeight: 500 }}>{e.nombre}</div>
                  <div style={{ fontSize: 11.5, color: '#888', marginTop: 3 }}>
                    {tipo?.nombre || 'Entregable'} · v{e.version} · {nombreDe(e.subido_por_id)} ·{' '}
                    {new Date(e.subido_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {e.titulo_cliente ? ` · ${e.titulo_cliente}` : ''}
                  </div>
                  <div style={{ fontSize: 11.5, color: colorEspera(dias), marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Clock size={12} /> {dias < 1 ? 'Subido hoy' : `Esperando ${Math.floor(dias)} día(s)`}
                  </div>
                  {e.notas && <div style={{ fontSize: 11.5, color: '#999', marginTop: 5, fontStyle: 'italic' }}>{e.notas}</div>}
                  {faltaron.length > 0 && (
                    <div style={{ fontSize: 11.5, color: '#D9A441', marginTop: 5 }}>
                      Sin marcar: {faltaron.map(f => f.texto).join('; ')}
                    </div>
                  )}
                </div>
                {url && <a href={url} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none', alignSelf: 'flex-start' }}><ExternalLink size={13} /> Abrir</a>}
              </div>

              <div style={{ marginTop: 10, borderTop: '1px solid #1c1c1c', paddingTop: 10 }}>
                <RevisarEntregable e={e} tipos={tipos} employeeId={employeeId} nombreDe={nombreDe} onResuelto={onCambio} compacto />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── RECETAS ────────────────────────────────────────────────────────────────

function Recetas({ tipos, employeeId, onCambio }: {
  tipos: TipoEntregable[]
  employeeId?: string | null
  onCambio: () => void
}) {
  const [edit, setEdit] = useState('')
  const [desc, setDesc] = useState('')
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [dias, setDias] = useState(2)
  const [nuevo, setNuevo] = useState('')
  const [busy, setBusy] = useState(false)

  function abrir(t: TipoEntregable) {
    if (edit === t.id) { setEdit(''); return }
    setEdit(t.id); setDesc(t.descripcion || ''); setItems(t.checklist.map(i => ({ ...i }))); setDias(t.dias_revision ?? 2)
  }

  async function guardar(t: TipoEntregable) {
    setBusy(true)
    await guardarTipo(t.id, { descripcion: desc, dias_revision: dias, checklist: items.map(i => ({ texto: i.texto, obligatorio: !!i.obligatorio })) as any }, employeeId)
    setBusy(false); setEdit(''); onCambio()
  }

  const porArea = useMemo(() => {
    const g: { label: string; lista: TipoEntregable[] }[] = AREAS_TRABAJO.map(a => ({
      label: a.label, lista: tipos.filter(t => t.specialty === a.specialty),
    }))
    g.push({ label: 'Transversales', lista: tipos.filter(t => !t.specialty) })
    return g.filter(x => x.lista.length > 0)
  }, [tipos])

  return (
    <>
      <div style={{ ...card, marginBottom: 12, background: '#141109', borderColor: '#2a2416' }}>
        <p style={{ fontSize: 12, color: '#c9b78a', margin: 0, lineHeight: 1.7 }}>
          <b style={{ color: '#e8d5a3' }}>Estas recetas son un borrador y hay que corregirlas.</b> Las escribí a partir de la
          práctica común de ingeniería eléctrica, iluminación y sistemas especiales — no del estándar real de OMM,
          que no está escrito en ningún lado del sistema. Ábrelas con cada director y ajústenlas: en el momento en que
          digan lo que ustedes de verdad exigen, dejan de ser criterio de cada quien y pasan a ser requisito.
        </p>
      </div>

      {porArea.map(g => (
        <div key={g.label} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: '#777', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 }}>{g.label}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.lista.map(t => (
              <div key={t.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => abrir(t)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: '#eee', fontWeight: 500 }}>{t.nombre}</div>
                    {edit !== t.id && (
                      <p style={{ fontSize: 12, color: '#888', margin: '4px 0 0', lineHeight: 1.6 }}>{t.descripcion}</p>
                    )}
                    <div style={{ fontSize: 11, color: '#666', marginTop: 5 }}>
                      {t.checklist.length} punto(s) · {t.checklist.filter(i => i.obligatorio).length} obligatorio(s)
                      {t.formato ? ` · ${t.formato}` : ''} · revisión en {t.dias_revision ?? 2} día(s)
                    </div>
                  </div>
                  <span style={{ ...btn, pointerEvents: 'none' }}>{edit === t.id ? 'Cerrar' : 'Editar'}</span>
                </div>

                {edit === t.id && (
                  <div style={{ marginTop: 12, borderTop: '1px solid #1c1c1c', paddingTop: 12 }}>
                    <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 }}>Instructivo</div>
                    <textarea value={desc} onChange={e => setDesc(e.target.value)}
                      style={{ ...inp, width: '100%', minHeight: 70, resize: 'vertical' }} />

                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
                      <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.6 }}>Días para revisarlo</span>
                      <input type="number" min={0} value={dias} onChange={e => setDias(Number(e.target.value))}
                        style={{ ...inp, width: 62 }} />
                      <span style={{ fontSize: 10.5, color: '#666' }}>
                        Es el compromiso del que REVISA. La actividad de revisión nace con esa fecha.
                      </span>
                    </div>

                    <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.6, margin: '12px 0 6px' }}>Checklist</div>
                    {items.map((it, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                        <input type="checkbox" checked={!!it.obligatorio} title="Obligatorio"
                          onChange={ev => setItems(x => x.map((y, j) => j === i ? { ...y, obligatorio: ev.target.checked } : y))}
                          style={{ accentColor: '#DC2626' }} />
                        <input value={it.texto} onChange={ev => setItems(x => x.map((y, j) => j === i ? { ...y, texto: ev.target.value } : y))}
                          style={{ ...inp, flex: 1 }} />
                        <button onClick={() => setItems(x => x.filter((_, j) => j !== i))}
                          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', display: 'flex' }}><X size={13} /></button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <input value={nuevo} placeholder="Agregar punto y Enter" onChange={e => setNuevo(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && nuevo.trim()) {
                            e.preventDefault()
                            setItems(x => [...x, { texto: nuevo.trim(), obligatorio: true }])
                            setNuevo('')
                          }
                        }}
                        style={{ ...inp, flex: 1, maxWidth: 460 }} />
                      <button onClick={() => { if (nuevo.trim()) { setItems(x => [...x, { texto: nuevo.trim(), obligatorio: true }]); setNuevo('') } }}
                        style={btn}><Plus size={12} /> Agregar</button>
                    </div>
                    <div style={{ fontSize: 10, color: '#666', marginTop: 6 }}>
                      La casilla roja marca el punto como obligatorio: no bloquea la entrega, pero queda escrito
                      en el entregable si se sube sin marcarlo.
                    </div>

                    <button onClick={() => guardar(t)} disabled={busy}
                      style={{ ...btn, marginTop: 12, borderColor: '#10B981', color: '#10B981' }}>
                      <Check size={13} /> {busy ? 'Guardando…' : 'Guardar receta'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
