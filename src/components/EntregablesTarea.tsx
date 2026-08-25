// ═══════════════════════════════════════════════════════════════════════════
// EntregablesTarea — el espacio donde se sube el trabajo, con el instructivo
// a un lado.
//
// El orden de la pantalla no es decorativo: primero QUÉ SE ESPERA (la receta
// y lo que pidió quien encargó), después el checklist, y hasta abajo el botón
// de subir. Quien llega aquí lee el requisito antes de poder entregar.
//
// El checklist no bloquea —bloquear enseña a mentir—: deja subir con
// faltantes, pero los deja escritos en el entregable, a la vista del que
// revisa. Marcar en falso es más caro que no marcar.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { Upload, Link2, FileText, Check, Clock, AlertTriangle, ExternalLink } from 'lucide-react'
import {
  Entregable, TipoEntregable, ChecklistItem, ESTADO_CFG,
  cargarTipos, entregablesDe, subirArchivo, registrar,
  faltantesObligatorios, urlDe, pesoLegible, diasEsperando, colorEspera,
} from '../lib/entregables'
import RevisarEntregable from './RevisarEntregable'

const box: React.CSSProperties = { background: '#0e0e0e', border: '1px solid #222', borderRadius: 10, padding: 12 }
const btn: React.CSSProperties = { border: '1px solid #333', background: '#161616', color: '#ccc', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const input: React.CSSProperties = { background: '#111', border: '1px solid #2a2a2a', color: '#ddd', borderRadius: 8, padding: '7px 10px', fontSize: 12, width: '100%' }

export interface ContextoTarea {
  id: string
  name: string
  tipo_entregable_id?: string | null
  instrucciones?: string | null
  specialty?: string | null
  project_id?: string | null
  lead_id?: string | null
  titulo_cliente?: string | null
}

export default function EntregablesTarea({ tarea, employeeId, puedeRevisar, nombreDe, onCambio }: {
  tarea: ContextoTarea
  employeeId?: string | null
  puedeRevisar?: boolean
  nombreDe?: (id?: string | null) => string
  onCambio?: () => void
}) {
  const [tipos, setTipos] = useState<TipoEntregable[]>([])
  const [lista, setLista] = useState<Entregable[]>([])
  const [tipoId, setTipoId] = useState(tarea.tipo_entregable_id || '')
  const [check, setCheck] = useState<ChecklistItem[]>([])
  const [nombre, setNombre] = useState('')
  const [link, setLink] = useState('')
  const [notas, setNotas] = useState('')
  const [modo, setModo] = useState<'archivo' | 'link'>('archivo')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [abriendo, setAbriendo] = useState('')

  const tipo = useMemo(() => tipos.find(t => t.id === tipoId), [tipos, tipoId])

  useEffect(() => { cargarTipos().then(setTipos) }, [])
  useEffect(() => { entregablesDe(tarea.id).then(setLista) }, [tarea.id])
  useEffect(() => {
    setCheck(tipo ? tipo.checklist.map(i => ({ ...i, marcado: false })) : [])
  }, [tipo])

  // Recetas del área primero; las transversales siempre disponibles.
  const tiposOrdenados = useMemo(() => {
    const mias = tipos.filter(t => t.specialty === tarea.specialty)
    const trans = tipos.filter(t => !t.specialty)
    const otras = tipos.filter(t => t.specialty && t.specialty !== tarea.specialty)
    return [...mias, ...trans, ...otras]
  }, [tipos, tarea.specialty])

  const pendientes = faltantesObligatorios(check)

  async function entregar() {
    setErr('')
    if (modo === 'archivo' && !archivo) return setErr('Elige el archivo.')
    if (modo === 'link' && !link.trim()) return setErr('Pega el link.')
    setBusy(true)
    let path: string | null = null
    if (modo === 'archivo' && archivo) {
      const r = await subirArchivo(tarea.id, archivo)
      if (r.error) { setBusy(false); return setErr(r.error) }
      path = r.path!
    }
    const r = await registrar({
      task_id: tarea.id,
      tipo_id: tipoId || null,
      nombre: (nombre.trim() || archivo?.name || tipo?.nombre || tarea.name).slice(0, 200),
      storage_path: path,
      drive_url: modo === 'link' ? link.trim() : null,
      mime: archivo?.type || null,
      bytes: archivo?.size || null,
      checklist: check,
      notas: notas.trim() || null,
      subido_por_id: employeeId || null,
      project_id: tarea.project_id || null,
      lead_id: tarea.lead_id || null,
      specialty: tarea.specialty || null,
      titulo_cliente: tarea.titulo_cliente || null,
    })
    setBusy(false)
    if (r.error) return setErr(r.error)
    setArchivo(null); setLink(''); setNombre(''); setNotas('')
    setCheck(c => c.map(i => ({ ...i, marcado: false })))
    entregablesDe(tarea.id).then(setLista)
    onCambio?.()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── 1. QUÉ SE ESPERA ── */}
      <div style={box}>
        <div style={{ fontSize: 10, letterSpacing: 0.7, textTransform: 'uppercase', color: '#666', marginBottom: 8 }}>Qué se espera</div>
        <select value={tipoId} onChange={e => setTipoId(e.target.value)} style={{ ...input, marginBottom: 8 }}>
          <option value="">Tipo de entregable…</option>
          {tiposOrdenados.map(t => (
            <option key={t.id} value={t.id}>{t.nombre}{t.specialty && t.specialty !== tarea.specialty ? ' (otra área)' : ''}</option>
          ))}
        </select>

        {tipo?.descripcion && (
          <p style={{ fontSize: 12, color: '#bbb', lineHeight: 1.7, margin: '0 0 8px' }}>{tipo.descripcion}</p>
        )}
        {tipo?.formato && (
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Formato: <span style={{ color: '#ccc' }}>{tipo.formato}</span></div>
        )}
        {!tipo && (
          <p style={{ fontSize: 11, color: '#666', margin: 0, lineHeight: 1.6 }}>
            Sin tipo de entregable no hay instructivo ni checklist. Elígelo arriba — es el "cómo" de esta tarea.
          </p>
        )}

        {tarea.instrucciones && (
          <div style={{ borderLeft: '2px solid #2563EB', paddingLeft: 10, marginTop: 8 }}>
            <div style={{ fontSize: 10, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>Indicaciones de quien lo pidió</div>
            <p style={{ fontSize: 12, color: '#ccc', margin: 0, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{tarea.instrucciones}</p>
          </div>
        )}
      </div>

      {/* ── 2. CHECKLIST ── */}
      {check.length > 0 && (
        <div style={box}>
          <div style={{ fontSize: 10, letterSpacing: 0.7, textTransform: 'uppercase', color: '#666', marginBottom: 8 }}>
            Antes de entregar
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {check.map((it, i) => (
              <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 12, color: it.marcado ? '#888' : '#ccc', lineHeight: 1.5 }}>
                <input type="checkbox" checked={!!it.marcado}
                  onChange={ev => setCheck(c => c.map((x, j) => j === i ? { ...x, marcado: ev.target.checked } : x))}
                  style={{ marginTop: 2, accentColor: '#10B981' }} />
                <span style={{ textDecoration: it.marcado ? 'line-through' : 'none' }}>
                  {it.texto}
                  {it.obligatorio && <span style={{ color: '#DC2626', marginLeft: 4 }}>*</span>}
                </span>
              </label>
            ))}
          </div>
          {pendientes.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#D9A441', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Faltan {pendientes.length} obligatorio(s). Puedes entregar igual — quedará escrito en el entregable y lo verá quien revise.</span>
            </div>
          )}
        </div>
      )}

      {/* ── 3. ENTREGAR ── */}
      <div style={box}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button onClick={() => setModo('archivo')} style={{ ...btn, borderColor: modo === 'archivo' ? '#3b82f6' : '#333', color: modo === 'archivo' ? '#93c5fd' : '#888' }}>
            <Upload size={13} /> Subir archivo
          </button>
          <button onClick={() => setModo('link')} style={{ ...btn, borderColor: modo === 'link' ? '#3b82f6' : '#333', color: modo === 'link' ? '#93c5fd' : '#888' }}>
            <Link2 size={13} /> Link de Drive
          </button>
        </div>

        {modo === 'archivo' ? (
          <>
            <input type="file" onChange={e => { setArchivo(e.target.files?.[0] || null); setErr('') }}
              style={{ ...input, padding: 7 }} />
            <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
              Hasta 50 MB. Lo más pesado (DWG grandes, renders) va por link — el rastro queda igual.
            </div>
          </>
        ) : (
          <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://drive.google.com/…" style={input} />
        )}

        <input value={nombre} onChange={e => setNombre(e.target.value)}
          placeholder={tipo ? `Nombre (por defecto: ${tipo.nombre})` : 'Nombre del entregable'}
          style={{ ...input, marginTop: 8 }} />
        <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Nota para quien revisa (opcional)" style={{ ...input, marginTop: 8 }} />

        {err && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 8 }}>{err}</div>}

        <button onClick={entregar} disabled={busy}
          style={{ ...btn, marginTop: 10, background: '#10B981', borderColor: '#10B981', color: '#04120c', fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
          <Check size={14} /> {busy ? 'Subiendo…' : 'Entregar'}
        </button>
        <div style={{ fontSize: 10, color: '#666', marginTop: 6 }}>
          Al entregar se sella la fecha y la tarea pasa a revisión.
        </div>
      </div>

      {/* ── 4. HISTORIAL ── */}
      {lista.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 10, letterSpacing: 0.7, textTransform: 'uppercase', color: '#666' }}>
            Entregas ({lista.length})
          </div>
          {lista.map(e => {
            const cfg = ESTADO_CFG[e.estado]
            const url = urlDe(e)
            const dias = diasEsperando(e)
            const faltaron = e.checklist.filter(i => i.obligatorio && !i.marcado)
            return (
              <div key={e.id} style={{ ...box, borderColor: e.estado === 'corregir' ? '#3a1a1a' : '#222' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <FileText size={13} color="#777" />
                      <span style={{ fontSize: 13, color: '#ddd', fontWeight: 500 }}>{e.nombre}</span>
                      <span style={{ fontSize: 10, color: '#666' }}>v{e.version}</span>
                      <span style={{ fontSize: 10, color: cfg.color, border: `1px solid ${cfg.color}44`, borderRadius: 5, padding: '1px 6px' }}>{cfg.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#777', marginTop: 3 }}>
                      {nombreDe?.(e.subido_por_id) || 'Alguien'} · {new Date(e.subido_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {e.bytes ? ` · ${pesoLegible(e.bytes)}` : ''}{e.drive_url ? ' · Drive' : ''}
                    </div>
                    {e.notas && <div style={{ fontSize: 11, color: '#999', marginTop: 4, fontStyle: 'italic' }}>{e.notas}</div>}
                    {faltaron.length > 0 && (
                      <div style={{ fontSize: 11, color: '#D9A441', marginTop: 5 }}>
                        Entregado con {faltaron.length} punto(s) obligatorio(s) sin marcar: {faltaron.map(f => f.texto).join('; ')}
                      </div>
                    )}
                  </div>
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer" onClick={() => setAbriendo(e.id)}
                      style={{ ...btn, textDecoration: 'none', color: abriendo === e.id ? '#93c5fd' : '#ccc' }}>
                      <ExternalLink size={13} /> Abrir
                    </a>
                  )}
                </div>

                {/* Revisión */}
                {e.estado === 'en_revision' ? (
                  <div style={{ marginTop: 10, borderTop: '1px solid #1c1c1c', paddingTop: 10 }}>
                    <div style={{ fontSize: 11, color: colorEspera(dias), display: 'flex', alignItems: 'center', gap: 5, marginBottom: puedeRevisar ? 8 : 0 }}>
                      <Clock size={12} />
                      {dias < 1 ? 'Esperando revisión desde hoy' : `Esperando revisión desde hace ${Math.floor(dias)} día(s)`}
                    </div>
                    {puedeRevisar && (
                      <RevisarEntregable e={e} tipos={tipos} employeeId={employeeId} nombreDe={nombreDe}
                        onResuelto={() => { entregablesDe(tarea.id).then(setLista); onCambio?.() }} compacto />
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: 8, borderTop: '1px solid #1c1c1c', paddingTop: 8, fontSize: 11, color: '#888' }}>
                    {cfg.label} por {nombreDe?.(e.revisado_por_id) || 'alguien'}
                    {e.revisado_at && ` · ${new Date(e.revisado_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`}
                    {e.revisado_at && ` · respondido en ${Math.max(0, Math.round(diasEsperando(e, new Date(e.revisado_at).getTime()) * 10) / 10)} d`}
                    {(e.fallas && e.fallas.length > 0) && (
                      <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {e.fallas.map((f, i) => (
                          <span key={i} style={{ fontSize: 10.5, color: '#f4a5a5', border: '1px solid #DC262655', background: '#2a1010', borderRadius: 6, padding: '1px 6px' }}>✕ {f}</span>
                        ))}
                      </div>
                    )}
                    {e.correcciones && (
                      <div style={{ color: e.estado === 'corregir' ? '#f4a5a5' : '#999', marginTop: 4, whiteSpace: 'pre-wrap' }}>{e.correcciones}</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
