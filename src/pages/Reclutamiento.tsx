// ═══════════════════════════════════════════════════════════════════════════
//  RECLUTAMIENTO
//
//    Bandeja     → las postulaciones que llegaron por correo, con su CV.
//                  Un clic las convierte en candidato.
//    Candidatos  → el embudo: nuevo → revisión → entrevista → examen →
//                  oferta → contratado (o descartado, con motivo).
//    Vacantes    → qué se está buscando y para qué puesto de la nómina.
//
//  El examen de contratación NO vive aquí: ya existe en Capacitaciones, y
//  desde ahí se aplica a un candidato. Aquí sólo se marca la etapa.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Badge, Btn, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { puestosDeLaNomina, areasDeLaNomina } from '../lib/capacitaciones'
import {
  cargarVacantes, cargarCandidatos, buscarPostulaciones, messageIdsImportados,
  extraerDeCorreo, importarPostulacion, adjuntoDelCV, moverEtapa, urlDelCV,
  ETAPA_CFG, ESTADO_VACANTE_CFG, FUENTE_CFG,
  type Vacante, type Candidato, type EtapaCandidato, type EstadoVacante,
  type CorreoPostulacion, type EstadoBandeja,
} from '../lib/reclutamiento'
import { Plus, X, Inbox, RefreshCw, FileText, ChevronLeft, Trash2, Download } from 'lucide-react'

const card: React.CSSProperties = { background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 12, padding: 14 }
const inp: React.CSSProperties = { width: '100%', background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', borderRadius: 6, padding: '7px 9px', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }
const lbl: React.CSSProperties = { fontSize: 9.5, color: '#666', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }

type Tab = 'bandeja' | 'candidatos' | 'vacantes'

export default function Reclutamiento() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('bandeja')
  const [vacantes, setVacantes] = useState<Vacante[]>([])
  const [cands, setCands] = useState<Candidato[]>([])
  const [cargando, setCargando] = useState(true)
  const [editVacante, setEditVacante] = useState<Vacante | null>(null)
  const [verCand, setVerCand] = useState<Candidato | null>(null)

  async function recargar() {
    setCargando(true)
    const [v, c] = await Promise.all([cargarVacantes(), cargarCandidatos()])
    setVacantes(v); setCands(c); setCargando(false)
  }
  useEffect(() => { recargar() }, [])

  if (cargando) return <div style={{ padding: 24 }}><Loading /></div>
  if (editVacante) return <EditorVacante v={editVacante} autor={user?.nombre || ''} onSalir={() => { setEditVacante(null); recargar() }} />
  if (verCand) return <FichaCandidato c={verCand} vacantes={vacantes} onSalir={() => { setVerCand(null); recargar() }} />

  const nuevos = cands.filter(c => c.etapa === 'nuevo').length
  const abiertas = vacantes.filter(v => v.estado === 'abierta').length
  const tabs: Array<[Tab, string, number]> = [
    ['bandeja', 'Bandeja', 0],
    ['candidatos', 'Candidatos', nuevos],
    ['vacantes', 'Vacantes', abiertas],
  ]

  return (
    <div>
      <SectionHeader
        title="Reclutamiento"
        subtitle="Las postulaciones llegan por correo con su CV; aquí se vuelven candidatos"
        action={<Btn variant="primary" onClick={() => setEditVacante(nuevaVacante(user?.nombre || ''))}><Plus size={14} /> Nueva vacante</Btn>}
      />

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${tab === k ? '#57FF9A' : '#2a2a2a'}`,
              background: tab === k ? '#57FF9A18' : 'transparent',
              color: tab === k ? '#57FF9A' : '#888',
            }}>{label}{n > 0 ? ` · ${n}` : ''}</button>
        ))}
      </div>

      {tab === 'bandeja' && <Bandeja vacantes={vacantes} onImportado={recargar} />}
      {tab === 'candidatos' && <Embudo cands={cands} vacantes={vacantes} onVer={setVerCand} />}
      {tab === 'vacantes' && (
        vacantes.length === 0 ? <EmptyState message="Sin vacantes. Crea la primera." /> : (
          <div style={{ display: 'grid', gap: 10 }}>
            {vacantes.map(v => {
              const n = cands.filter(c => c.vacante_id === v.id).length
              return (
                <div key={v.id} style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#eee' }}>{v.titulo}</div>
                    <div style={{ fontSize: 10.5, color: '#666', marginTop: 3 }}>
                      {[v.puesto, v.area, v.ubicacion].filter(Boolean).join(' · ') || 'Sin puesto ligado'}
                      {v.vacantes_totales > 1 ? ` · ${v.vacantes_totales} plazas` : ''}
                    </div>
                  </div>
                  <Badge label={ESTADO_VACANTE_CFG[v.estado].label} color={ESTADO_VACANTE_CFG[v.estado].color} />
                  <span style={{ fontSize: 11, color: '#777', minWidth: 90, textAlign: 'right' }}>{n} candidato(s)</span>
                  <Btn size="sm" onClick={() => setEditVacante(v)}>Editar</Btn>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}

function nuevaVacante(autor: string): Vacante {
  return {
    id: '', titulo: '', puesto: null, area: null, descripcion: '', requisitos: '', ubicacion: '',
    sueldo_desde: null, sueldo_hasta: null, moneda: 'MXN', tipo_jornada: 'tiempo_completo',
    estado: 'borrador', vacantes_totales: 1, publicada_at: null, cierra_at: null, creada_por: autor,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  BANDEJA — postulaciones que llegaron por correo
// ═══════════════════════════════════════════════════════════════════════════
function Bandeja({ vacantes, onImportado }: { vacantes: Vacante[]; onImportado: () => void }) {
  const [estado, setEstado] = useState<EstadoBandeja | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [yaImportados, setYaImportados] = useState<Set<string>>(new Set())
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [dias, setDias] = useState(30)
  const [asignarA, setAsignarA] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')

  async function buscar() {
    setBuscando(true); setErr('')
    const r = await buscarPostulaciones(dias)
    setEstado(r)
    if (r.mensajes?.length) setYaImportados(await messageIdsImportados(r.mensajes.map(m => m.id)))
    setBuscando(false)
  }

  async function importar(m: CorreoPostulacion) {
    setTrabajando(m.id); setErr('')
    try {
      const datos = await extraerDeCorreo(m)
      if (!datos) { setErr(`No pude sacar el nombre del candidato de "${m.asunto}". Créalo a mano desde Candidatos.`); setTrabajando(null); return }
      await importarPostulacion(m, datos, asignarA[m.id] || null)
      setYaImportados(prev => new Set([...prev, m.id]))
      onImportado()
    } catch (e: any) { setErr(e?.message || String(e)) }
    setTrabajando(null)
  }

  const pendientes = (estado?.mensajes || []).filter(m => !yaImportados.has(m.id))

  return (
    <div>
      <div style={{ ...card, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Inbox size={15} color="#57FF9A" />
        <div style={{ flex: 1, minWidth: 200, fontSize: 11.5, color: '#888', lineHeight: 1.6 }}>
          Busca en tu correo las postulaciones de Indeed de los últimos días y las convierte en candidatos, con su CV.
          {estado?.email && <span style={{ color: '#666' }}> · {estado.email}</span>}
        </div>
        <select value={dias} onChange={e => setDias(Number(e.target.value))} style={{ ...inp, width: 130 }}>
          {[7, 30, 90, 180, 365].map(d => <option key={d} value={d}>Últimos {d} días</option>)}
        </select>
        <Btn variant="primary" onClick={buscar} disabled={buscando}>
          <RefreshCw size={12} /> {buscando ? 'Buscando…' : 'Buscar postulaciones'}
        </Btn>
      </div>

      {estado && !estado.ok && (
        <div style={{ ...card, borderColor: '#D9770655', color: '#FBBF24', fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          {estado.error || 'No se pudo consultar el correo.'}
          {estado.reconectar && (
            <div style={{ marginTop: 8 }}>
              <a href="/api/gmail?action=connect" style={{ color: '#57FF9A', fontSize: 12 }}>Reconectar Gmail</a>
              <span style={{ color: '#666' }}> — se agregó el permiso de <b>lectura</b> para poder ver las postulaciones. Es de solo lectura: no permite borrar ni enviar nada.</span>
            </div>
          )}
        </div>
      )}
      {estado && estado.ok && !estado.connected && (
        <div style={{ ...card, borderColor: '#D9770655', color: '#FBBF24', fontSize: 12, marginBottom: 12 }}>
          Gmail no está conectado. <a href="/api/gmail?action=connect" style={{ color: '#57FF9A' }}>Conectarlo</a>.
        </div>
      )}
      {err && <div style={{ ...card, borderColor: '#DC262655', color: '#DC2626', fontSize: 12, marginBottom: 12 }}>{err}</div>}

      {estado?.ok && estado.mensajes.length === 0 && (
        <EmptyState message={`Sin postulaciones en los últimos ${dias} días.`} />
      )}

      {pendientes.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          {pendientes.map(m => {
            const adj = adjuntoDelCV(m)
            return (
              <div key={m.id} style={card}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ fontSize: 12.5, color: '#eee', fontWeight: 600 }}>{m.asunto}</div>
                    <div style={{ fontSize: 10, color: '#666', marginTop: 3 }}>
                      {m.fecha ? new Date(m.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                      {adj ? <> · <FileText size={9} style={{ display: 'inline' }} /> {adj.filename}</> : ' · sin CV adjunto'}
                    </div>
                    <div style={{ fontSize: 10.5, color: '#777', marginTop: 6, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>
                      {m.texto.slice(0, 260)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select value={asignarA[m.id] || ''} onChange={e => setAsignarA(a => ({ ...a, [m.id]: e.target.value }))}
                      style={{ ...inp, width: 170 }}>
                      <option value="">— Sin vacante —</option>
                      {vacantes.filter(v => v.estado !== 'cerrada').map(v => <option key={v.id} value={v.id}>{v.titulo}</option>)}
                    </select>
                    <Btn size="sm" variant="primary" onClick={() => importar(m)} disabled={trabajando === m.id}>
                      {trabajando === m.id ? 'Leyendo…' : 'Crear candidato'}
                    </Btn>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {estado?.ok && estado.mensajes.length > 0 && pendientes.length === 0 && (
        <EmptyState message="Todas las postulaciones de este periodo ya están capturadas." />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  EMBUDO
// ═══════════════════════════════════════════════════════════════════════════
function Embudo({ cands, vacantes, onVer }: { cands: Candidato[]; vacantes: Vacante[]; onVer: (c: Candidato) => void }) {
  const [filtro, setFiltro] = useState<EtapaCandidato | 'todos'>('todos')
  const [vac, setVac] = useState('')
  const vacNombre = (id?: string | null) => vacantes.find(v => v.id === id)?.titulo || null

  const lista = cands
    .filter(c => filtro === 'todos' ? true : c.etapa === filtro)
    .filter(c => !vac || c.vacante_id === vac)

  const porEtapa = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of cands) m[c.etapa] = (m[c.etapa] || 0) + 1
    return m
  }, [cands])

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setFiltro('todos')}
          style={{ padding: '4px 12px', borderRadius: 16, fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${filtro === 'todos' ? '#57FF9A' : '#2a2a2a'}`, background: filtro === 'todos' ? '#57FF9A18' : 'transparent', color: filtro === 'todos' ? '#57FF9A' : '#888' }}>
          Todos · {cands.length}
        </button>
        {(Object.keys(ETAPA_CFG) as EtapaCandidato[]).sort((a, b) => ETAPA_CFG[a].orden - ETAPA_CFG[b].orden).map(e => (
          <button key={e} onClick={() => setFiltro(e)}
            style={{ padding: '4px 12px', borderRadius: 16, fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${filtro === e ? ETAPA_CFG[e].color : '#2a2a2a'}`, background: filtro === e ? ETAPA_CFG[e].color + '22' : 'transparent', color: filtro === e ? ETAPA_CFG[e].color : '#888' }}>
            {ETAPA_CFG[e].label}{porEtapa[e] ? ` · ${porEtapa[e]}` : ''}
          </button>
        ))}
        {vacantes.length > 0 && (
          <select value={vac} onChange={e => setVac(e.target.value)} style={{ ...inp, width: 190, marginLeft: 'auto' }}>
            <option value="">Todas las vacantes</option>
            {vacantes.map(v => <option key={v.id} value={v.id}>{v.titulo}</option>)}
          </select>
        )}
      </div>

      {lista.length === 0 ? <EmptyState message="Sin candidatos que mostrar." /> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {lista.map(c => (
            <div key={c.id} onClick={() => onVer(c)}
              style={{ ...card, padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12.5, color: '#eee', fontWeight: 600 }}>{c.nombre}</div>
                <div style={{ fontSize: 10.5, color: '#666', marginTop: 2 }}>
                  {[c.puesto_solicitado, vacNombre(c.vacante_id), c.telefono].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              {c.cv_path && <FileText size={13} color="#57FF9A" />}
              <span style={{ fontSize: 10, color: '#555' }}>{FUENTE_CFG[c.fuente]}</span>
              <Badge label={ETAPA_CFG[c.etapa].label} color={ETAPA_CFG[c.etapa].color} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  FICHA DEL CANDIDATO
// ═══════════════════════════════════════════════════════════════════════════
function FichaCandidato({ c, vacantes, onSalir }: { c: Candidato; vacantes: Vacante[]; onSalir: () => void }) {
  const [cand, setCand] = useState<Candidato>(c)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const cv = urlDelCV(cand.cv_path)

  async function guardar(campos: Partial<Candidato>) {
    setGuardando(true)
    const next = { ...cand, ...campos }
    setCand(next)
    await supabase.from('candidatos').update({ ...campos, updated_at: new Date().toISOString() }).eq('id', cand.id)
    setGuardando(false)
  }

  async function cambiarEtapa(e: EtapaCandidato) {
    if (e === 'descartado' && !motivo.trim()) return
    await moverEtapa(cand.id, e, motivo)
    setCand({ ...cand, etapa: e, motivo_descarte: e === 'descartado' ? motivo : null })
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Btn size="sm" onClick={onSalir}><ChevronLeft size={13} /> Volver</Btn>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{cand.nombre}</div>
          <div style={{ fontSize: 11.5, color: '#777', marginTop: 2 }}>
            {cand.puesto_solicitado || 'Sin puesto'} · {FUENTE_CFG[cand.fuente]}
            {cand.recibido_at && ` · ${new Date(cand.recibido_at).toLocaleDateString('es-MX')}`}
          </div>
        </div>
        {cv && <a href={cv} target="_blank" rel="noreferrer"><Btn size="sm"><Download size={12} /> {cand.cv_nombre || 'CV'}</Btn></a>}
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div style={{ ...card, display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#eee' }}>Contacto</div>
          <div>
            <div style={lbl}>Teléfono</div>
            <input value={cand.telefono || ''} onChange={e => setCand({ ...cand, telefono: e.target.value })}
              onBlur={e => guardar({ telefono: e.target.value || null })} style={inp} />
          </div>
          <div>
            <div style={lbl}>Correo personal</div>
            <input value={cand.email || ''} onChange={e => setCand({ ...cand, email: e.target.value })}
              onBlur={e => guardar({ email: e.target.value || null })} style={inp} placeholder="el suyo, no el de Indeed" />
          </div>
          {cand.email_relay && (
            <div>
              <div style={lbl}>Correo de Indeed (alias)</div>
              <div style={{ fontSize: 11, color: '#777', wordBreak: 'break-all' }}>{cand.email_relay}</div>
              <div style={{ fontSize: 10, color: '#555', marginTop: 3 }}>Reenvía al candidato, pero no es su dirección real.</div>
            </div>
          )}
          <div>
            <div style={lbl}>Vacante</div>
            <select value={cand.vacante_id || ''} onChange={e => guardar({ vacante_id: e.target.value || null })} style={inp}>
              <option value="">— Sin vacante —</option>
              {vacantes.map(v => <option key={v.id} value={v.id}>{v.titulo}</option>)}
            </select>
          </div>
        </div>

        <div style={{ ...card, display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#eee' }}>Proceso</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {(Object.keys(ETAPA_CFG) as EtapaCandidato[]).sort((a, b) => ETAPA_CFG[a].orden - ETAPA_CFG[b].orden).map(e => (
              <button key={e} onClick={() => cambiarEtapa(e)}
                style={{ padding: '4px 11px', borderRadius: 16, fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit',
                  border: `1px solid ${cand.etapa === e ? ETAPA_CFG[e].color : '#2a2a2a'}`,
                  background: cand.etapa === e ? ETAPA_CFG[e].color + '22' : 'transparent',
                  color: cand.etapa === e ? ETAPA_CFG[e].color : '#888' }}>
                {ETAPA_CFG[e].label}
              </button>
            ))}
          </div>
          {cand.etapa === 'descartado' ? (
            <div style={{ fontSize: 11, color: '#DC2626' }}>Descartado{cand.motivo_descarte ? `: ${cand.motivo_descarte}` : ''}</div>
          ) : (
            <div>
              <div style={lbl}>Motivo, si lo vas a descartar</div>
              <input value={motivo} onChange={e => setMotivo(e.target.value)} style={inp} placeholder="Se pide antes de marcar Descartado" />
            </div>
          )}
          <div>
            <div style={lbl}>Notas</div>
            <textarea value={cand.notas || ''} onChange={e => setCand({ ...cand, notas: e.target.value })}
              onBlur={e => guardar({ notas: e.target.value || null })} rows={4} style={{ ...inp, resize: 'vertical' }} />
          </div>
          <div style={{ fontSize: 10, color: '#555' }}>
            El examen de contratación se aplica desde Capacitaciones, con la opción "Aplicar a un candidato".
            {guardando ? ' · Guardando…' : ''}
          </div>
        </div>
      </div>

      {cand.carta && (
        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#eee', marginBottom: 6 }}>Lo que escribió</div>
          <div style={{ fontSize: 12, color: '#bbb', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{cand.carta}</div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  EDITOR DE VACANTE
// ═══════════════════════════════════════════════════════════════════════════
function EditorVacante({ v, autor, onSalir }: { v: Vacante; autor: string; onSalir: () => void }) {
  const [x, setX] = useState<Vacante>(v)
  const [puestos, setPuestos] = useState<Array<{ puesto: string; area: string; personas: number }>>([])
  const [areas, setAreas] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    puestosDeLaNomina().then(p => setPuestos(p.map(q => ({ puesto: q.puesto, area: q.area, personas: q.personas }))))
    areasDeLaNomina().then(setAreas)
  }, [])

  async function guardar(estado?: EstadoVacante) {
    if (!x.titulo.trim()) { setError('Ponle un título a la vacante.'); return }
    setGuardando(true); setError('')
    const fila: any = {
      titulo: x.titulo.trim(), puesto: x.puesto, area: x.area,
      descripcion: x.descripcion || null, requisitos: x.requisitos || null,
      ubicacion: x.ubicacion || null,
      sueldo_desde: x.sueldo_desde, sueldo_hasta: x.sueldo_hasta, moneda: x.moneda,
      tipo_jornada: x.tipo_jornada, estado: estado || x.estado,
      vacantes_totales: x.vacantes_totales || 1, cierra_at: x.cierra_at,
      creada_por: x.creada_por || autor, updated_at: new Date().toISOString(),
    }
    if ((estado || x.estado) === 'abierta' && !x.publicada_at) fila.publicada_at = new Date().toISOString()
    const r = x.id
      ? await supabase.from('vacantes').update(fila).eq('id', x.id)
      : await supabase.from('vacantes').insert(fila)
    setGuardando(false)
    if (r.error) { setError(r.error.message); return }
    onSalir()
  }

  async function borrar() {
    if (!x.id) return onSalir()
    if (!confirm('¿Borrar esta vacante? Los candidatos que tenga se quedan, sin vacante asignada.')) return
    await supabase.from('vacantes').delete().eq('id', x.id)
    onSalir()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Btn size="sm" onClick={onSalir}><ChevronLeft size={13} /> Volver</Btn>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', flex: 1 }}>{x.id ? 'Editar vacante' : 'Nueva vacante'}</div>
        {x.id && <Btn size="sm" variant="danger" onClick={borrar}><Trash2 size={12} /> Borrar</Btn>}
        <Btn size="sm" onClick={() => guardar('borrador')} disabled={guardando}>Guardar borrador</Btn>
        <Btn size="sm" variant="primary" onClick={() => guardar('abierta')} disabled={guardando}>{guardando ? 'Guardando…' : 'Abrir vacante'}</Btn>
      </div>

      {error && <div style={{ ...card, borderColor: '#DC262655', color: '#DC2626', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div style={{ ...card, display: 'grid', gap: 12 }}>
        <div>
          <div style={lbl}>Título de la vacante</div>
          <input value={x.titulo} onChange={e => setX({ ...x, titulo: e.target.value })} style={inp} placeholder="Ej. Dibujante de instalaciones" />
        </div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div>
            <div style={lbl}>Puesto de la nómina</div>
            <select value={x.puesto || ''} onChange={e => {
              const p = puestos.find(q => q.puesto === e.target.value)
              setX({ ...x, puesto: e.target.value || null, area: p?.area || x.area })
            }} style={inp}>
              <option value="">— Elegir puesto —</option>
              {puestos.map(p => <option key={p.puesto} value={p.puesto}>{p.puesto} ({p.personas})</option>)}
            </select>
            <div style={{ fontSize: 9.5, color: '#555', marginTop: 3 }}>Liga la vacante al puesto que ya existe, para que las capacitaciones y el examen de ese puesto apliquen solos.</div>
          </div>
          <div>
            <div style={lbl}>Área</div>
            <select value={x.area || ''} onChange={e => setX({ ...x, area: e.target.value || null })} style={inp}>
              <option value="">— Elegir área —</option>
              {areas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <div style={lbl}>Ubicación</div>
            <input value={x.ubicacion || ''} onChange={e => setX({ ...x, ubicacion: e.target.value })} style={inp} placeholder="CDMX / obra / híbrido" />
          </div>
          <div>
            <div style={lbl}>Plazas</div>
            <input type="number" min={1} value={x.vacantes_totales} onChange={e => setX({ ...x, vacantes_totales: Number(e.target.value) || 1 })} style={inp} />
          </div>
          <div>
            <div style={lbl}>Sueldo desde</div>
            <input type="number" value={x.sueldo_desde ?? ''} onChange={e => setX({ ...x, sueldo_desde: e.target.value ? Number(e.target.value) : null })} style={inp} />
          </div>
          <div>
            <div style={lbl}>Sueldo hasta</div>
            <input type="number" value={x.sueldo_hasta ?? ''} onChange={e => setX({ ...x, sueldo_hasta: e.target.value ? Number(e.target.value) : null })} style={inp} />
          </div>
        </div>
        <div>
          <div style={lbl}>Descripción</div>
          <textarea value={x.descripcion || ''} onChange={e => setX({ ...x, descripcion: e.target.value })} rows={4} style={{ ...inp, resize: 'vertical' }} />
        </div>
        <div>
          <div style={lbl}>Requisitos</div>
          <textarea value={x.requisitos || ''} onChange={e => setX({ ...x, requisitos: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical' }} />
        </div>
      </div>
    </div>
  )
}
