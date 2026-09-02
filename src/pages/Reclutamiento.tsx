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
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Badge, Btn, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { puestosDeLaNomina, areasDeLaNomina } from '../lib/capacitaciones'
import {
  cargarVacantes, cargarCandidatos, buscarPostulaciones, messageIdsImportados,
  extraerDeCorreo, importarPostulacion, adjuntoDelCV, moverEtapa, urlDelCV, subirCV, esPdf,
  ETAPA_CFG, ESTADO_VACANTE_CFG, FUENTE_CFG,
  type Vacante, type Candidato, type EtapaCandidato, type EstadoVacante,
  type CorreoPostulacion, type EstadoBandeja,
} from '../lib/reclutamiento'
import {
  Analisis, VEREDICTO_CFG, colorCompat, porCompatibilidad, analizarCandidato,
  ingestaAutomatica, vacanteParaPuesto, ResultadoIngesta,
} from '../lib/analisisCandidato'
import {
  Referencia, ESTADO_REF_CFG, TONO_CFG, cargarReferencias, agregarReferencia,
  guardarReferencia, borrarReferencia, redactarCorreo, enviarCorreo, revisarRespuesta,
  BorradorCorreo, estadoDeReferencias,
} from '../lib/referencias'
import {
  ExamenAsignado, BorradorExamen, examenesDisponibles, cargarAsignaciones,
  asignarExamen, quitarAsignacion, redactarInvitacion, enviarInvitacion, ligaDelExamen,
} from '../lib/examenCandidato'
import { Capacitacion } from '../lib/capacitaciones'
import { Plus, X, Inbox, RefreshCw, FileText, ChevronLeft, Trash2, Download, Sparkles, AlertTriangle, Upload, Mail, Send, ClipboardCheck, Copy } from 'lucide-react'

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

  const [motor, setMotor] = useState('')
  const [ultima, setUltima] = useState<ResultadoIngesta | null>(null)

  async function recargar() {
    setCargando(true)
    const [v, c] = await Promise.all([cargarVacantes(), cargarCandidatos()])
    setVacantes(v); setCands(c); setCargando(false)
    return v
  }

  /**
   * Correo → candidato → análisis, sin que nadie apriete nada. Corre al abrir
   * la pantalla y desde el botón. Es idempotente, así que correrlo de más no
   * duplica ni re-analiza.
   */
  async function correrMotor(vacs?: Vacante[]) {
    if (motor) return
    setMotor('Revisando el correo…')
    try {
      const r = await ingestaAutomatica({
        vacantes: vacs || vacantes,
        buscar: buscarPostulaciones,
        yaImportados: messageIdsImportados,
        extraer: extraerDeCorreo,
        importar: importarPostulacion,
        avance: setMotor,
      })
      setUltima(r)
      if (r.importados || r.analizados) await recargar()
    } catch (e: any) {
      setUltima({ revisados: 0, importados: 0, analizados: 0, fallos: [{ quien: 'el proceso', error: e?.message || String(e) }] })
    }
    setMotor('')
  }

  useEffect(() => { recargar().then(v => correrMotor(v)) }, [])

  if (cargando) return <div style={{ padding: 24 }}><Loading /></div>
  if (editVacante) return <EditorVacante v={editVacante} autor={user?.nombre || ''} onSalir={() => { setEditVacante(null); recargar() }} />
  if (verCand) return <FichaCandidato c={verCand} vacantes={vacantes} onSalir={() => { setVerCand(null); recargar() }} />

  const sinAnalisis = cands.filter(c => !c.analisis_at).length
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
        action={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Btn size="sm" onClick={() => correrMotor()} disabled={!!motor}>
              <Sparkles size={13} /> {motor ? 'Trabajando…' : 'Revisar y analizar'}
            </Btn>
            <Btn variant="primary" onClick={() => setEditVacante(nuevaVacante(user?.nombre || ''))}><Plus size={14} /> Nueva vacante</Btn>
          </span>
        }
      />

      {/* El motor: correo → candidato → análisis. Corre solo al abrir. */}
      {(motor || ultima) && (
        <div style={{
          ...card, marginBottom: 12, padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          borderColor: motor ? '#1f3a2a' : (ultima?.fallos.length ? '#3a2a15' : '#222'),
        }}>
          <Sparkles size={14} color={motor ? '#57FF9A' : '#666'} />
          <div style={{ flex: 1, minWidth: 220, fontSize: 11.5, color: motor ? '#57FF9A' : '#888', lineHeight: 1.6 }}>
            {motor || (ultima && (
              ultima.bandeja?.reconectar
                ? <>Gmail está conectado pero <b>sin permiso de lectura</b>, así que no puedo traer las postulaciones. Reconéctalo una vez en la pestaña <b>Bandeja</b> y esto queda automático.{ultima.analizados ? ` Mientras tanto analicé ${ultima.analizados} candidato(s) ya capturados.` : ''}</>
                : ultima.bandeja && !ultima.bandeja.connected
                ? <>El correo no está conectado, así que no puedo traer postulaciones solo. Conéctalo en la pestaña <b>Bandeja</b>.{ultima.analizados ? ` Aun así analicé ${ultima.analizados} candidato(s) que ya estaban capturados.` : ''}</>
                : <>
                    {ultima.importados > 0 ? `${ultima.importados} candidato(s) nuevos del correo. ` : 'Sin postulaciones nuevas en el correo. '}
                    {ultima.analizados > 0 ? `${ultima.analizados} analizado(s) y ordenados por compatibilidad.` : (sinAnalisis === 0 ? 'Todos tienen análisis.' : '')}
                  </>
            ))}
          </div>
          {!motor && !!ultima?.fallos.length && (
            <span style={{ fontSize: 10.5, color: '#D9A441', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={11} /> {ultima.fallos.length} sin procesar: {ultima.fallos[0].error.slice(0, 60)}
            </span>
          )}
        </div>
      )}

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
/** El número de ajuste al puesto, a la izquierda, para poder barrer la lista. */
function ChipCompat({ c }: { c: Candidato }) {
  const n = c.compatibilidad
  const col = colorCompat(n)
  return (
    <div title={c.analisis_error ? `No se pudo analizar: ${c.analisis_error}` : c.analisis?.veredicto ? VEREDICTO_CFG[c.analisis.veredicto as keyof typeof VEREDICTO_CFG]?.label : 'Sin analizar todavía'}
      style={{
        width: 42, height: 42, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
        border: `1px solid ${col}55`, background: col + '14',
      }}>
      <span style={{ fontSize: n == null ? 13 : 15, fontWeight: 700, color: col, lineHeight: 1 }}>
        {n == null ? (c.analisis_error ? '!' : '—') : n}
      </span>
      {n != null && <span style={{ fontSize: 7.5, color: col, opacity: .8, marginTop: 1 }}>AJUSTE</span>}
    </div>
  )
}

function Embudo({ cands, vacantes, onVer }: { cands: Candidato[]; vacantes: Vacante[]; onVer: (c: Candidato) => void }) {
  const [filtro, setFiltro] = useState<EtapaCandidato | 'todos'>('todos')
  const [vac, setVac] = useState('')
  const vacNombre = (id?: string | null) => vacantes.find(v => v.id === id)?.titulo || null

  // El mejor ajuste arriba. Sin analizar se van al final: un candidato sin
  // veredicto no vale 0, es que todavía no se sabe.
  const lista = porCompatibilidad(cands
    .filter(c => filtro === 'todos' ? true : c.etapa === filtro)
    .filter(c => !vac || c.vacante_id === vac))

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
              <ChipCompat c={c} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12.5, color: '#eee', fontWeight: 600 }}>{c.nombre}</div>
                <div style={{ fontSize: 10.5, color: '#666', marginTop: 2 }}>
                  {[c.puesto_solicitado, vacNombre(c.vacante_id), c.telefono].filter(Boolean).join(' · ') || '—'}
                </div>
                {c.analisis?.resumen && (
                  <div style={{ fontSize: 10.5, color: '#8a8a8a', marginTop: 4, lineHeight: 1.5 }}>
                    {String(c.analisis.resumen).slice(0, 150)}{String(c.analisis.resumen).length > 150 ? '…' : ''}
                  </div>
                )}
                {!!c.analisis?.banderas?.filter((b: any) => b.severidad === 'alta').length && (
                  <div style={{ fontSize: 10, color: '#DC2626', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <AlertTriangle size={10} /> {c.analisis.banderas.filter((b: any) => b.severidad === 'alta')[0].senal}
                  </div>
                )}
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

      <CajaCV cand={cand} vacantes={vacantes} onCambio={setCand} />

      <PanelAnalisis cand={cand} vacantes={vacantes} onAnalizado={setCand} />

      <PanelReferencias cand={cand} vacantes={vacantes} />

      <PanelExamenes cand={cand} vacantes={vacantes} />

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
//  EL CV
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Subir el CV a mano.
 *
 * Hace falta de verdad: los correos de Indeed NO traen el CV adjunto. El texto
 * dice "su CV adjunto (si se proporcionó uno)" pero el mensaje llega con cero
 * adjuntos — solo el nombre, el alias de correo y una liga al portal de Indeed.
 * Sin esta caja, ningún candidato de Indeed se puede analizar.
 */
function CajaCV({ cand, vacantes, onCambio }: {
  cand: Candidato; vacantes: Vacante[]; onCambio: (c: Candidato) => void
}) {
  const [subiendo, setSubiendo] = useState(false)
  const [err, setErr] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const cv = urlDelCV(cand.cv_path)

  async function subir(file: File) {
    setSubiendo(true); setErr('')
    try {
      const { cv_path, cv_nombre } = await subirCV(cand.id, file)
      const actualizado = { ...cand, cv_path, cv_nombre, analisis: null, compatibilidad: null, analisis_at: null, analisis_error: null }
      onCambio(actualizado)
      // Con CV nuevo, el veredicto se rehace solo: nadie quiere subir un archivo
      // y luego acordarse de apretar otro botón.
      const v = vacantes.find(x => x.id === cand.vacante_id) || vacanteParaPuesto(cand.puesto_solicitado, vacantes)
      const r = await analizarCandidato(actualizado, v || null)
      if (r.ok && r.analisis) {
        onCambio({ ...actualizado, analisis: r.analisis, compatibilidad: r.analisis.compatibilidad, analisis_at: new Date().toISOString() })
      } else {
        onCambio({ ...actualizado, analisis_error: r.error || 'falló', analisis_at: new Date().toISOString() })
      }
    } catch (e: any) { setErr(e?.message || String(e)) }
    setSubiendo(false)
  }

  const faltaPdf = !!cand.cv_path && !esPdf(cand.cv_path)

  return (
    <div style={{ ...card, marginTop: 12, borderColor: cand.cv_path ? '#222' : '#3a2a15' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <FileText size={14} color={cand.cv_path ? '#57FF9A' : '#D9A441'} />
        <div style={{ flex: 1, minWidth: 240, fontSize: 12, color: '#ccc', lineHeight: 1.6 }}>
          {cand.cv_path ? (
            <>CV: <b>{cand.cv_nombre || 'archivo'}</b>
              {faltaPdf && <span style={{ color: '#D9A441' }}> · no es PDF, el análisis solo lee PDF</span>}</>
          ) : (
            <>Sin CV. <span style={{ color: '#888' }}>
              Los correos de Indeed no traen el CV adjunto: solo mandan el nombre y una liga a su portal.
              Bájalo de Indeed y súbelo aquí — al subirlo se vuelve a analizar solo.</span></>
          )}
        </div>
        {cv && <a href={cv} target="_blank" rel="noreferrer"><Btn size="sm"><Download size={12} /> Ver</Btn></a>}
        <input ref={ref} type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = '' }} />
        <Btn size="sm" variant={cand.cv_path ? 'default' : 'primary'} onClick={() => ref.current?.click()} disabled={subiendo}>
          <Upload size={12} /> {subiendo ? 'Subiendo y analizando…' : cand.cv_path ? 'Reemplazar' : 'Subir CV'}
        </Btn>
      </div>
      {err && <div style={{ fontSize: 11.5, color: '#DC2626', marginTop: 7 }}>{err}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  REFERENCIAS
// ═══════════════════════════════════════════════════════════════════════════
const CONFIRMA_CFG: Record<string, { label: string; color: string }> = {
  si: { label: 'Confirma', color: '#10B981' },
  no: { label: 'NO confirma', color: '#DC2626' },
  no_dice: { label: 'No dice', color: '#666' },
}
const RECONTRATA_CFG: Record<string, { label: string; color: string }> = {
  si: { label: 'Sí lo recontrataría', color: '#10B981' },
  con_reservas: { label: 'Con reservas', color: '#D9A441' },
  no: { label: 'NO lo recontrataría', color: '#DC2626' },
  no_dice: { label: 'No lo dijo', color: '#666' },
}

function PanelReferencias({ cand, vacantes }: { cand: Candidato; vacantes: Vacante[] }) {
  const { user } = useAuth()
  const [refs, setRefs] = useState<Referencia[]>([])
  const [cargando, setCargando] = useState(true)
  const [borrador, setBorrador] = useState<{ ref: Referencia; b: BorradorCorreo } | null>(null)
  const [trabajando, setTrabajando] = useState('')
  const [err, setErr] = useState('')
  const [nueva, setNueva] = useState(false)

  async function recargar() { setRefs(await cargarReferencias(cand.id)); setCargando(false) }
  useEffect(() => { recargar() }, [cand.id])

  const vac = vacantes.find(v => v.id === cand.vacante_id) || null

  async function redactar(r: Referencia) {
    setTrabajando(r.id); setErr('')
    try { setBorrador({ ref: r, b: await redactarCorreo(cand, r, vac, user?.nombre || 'OMM Technologies') }) }
    catch (e: any) { setErr(e?.message || String(e)) }
    setTrabajando('')
  }

  async function mandar() {
    if (!borrador) return
    setTrabajando(borrador.ref.id); setErr('')
    try { await enviarCorreo(borrador.ref, borrador.b); setBorrador(null); await recargar() }
    catch (e: any) { setErr(e?.message || String(e)) }
    setTrabajando('')
  }

  async function revisar() {
    setTrabajando('todas'); setErr('')
    try {
      const cuenta = user?.email || ''
      let hubo = false
      for (const r of refs.filter(x => x.estado === 'enviado' && x.thread_id)) {
        if (await revisarRespuesta(r, cuenta, cand)) hubo = true
      }
      await recargar()
      if (!hubo) setErr('Todavía no contestan.')
    } catch (e: any) { setErr(e?.message || String(e)) }
    setTrabajando('')
  }

  const esperando = refs.filter(r => r.estado === 'enviado').length

  return (
    <div style={{ ...card, marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <Mail size={14} color="#57FF9A" />
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#eee', flex: 1 }}>
          Referencias {refs.length > 0 && <span style={{ color: '#666', fontWeight: 400 }}>· {refs.length}</span>}
        </div>
        {esperando > 0 && (
          <Btn size="sm" onClick={revisar} disabled={!!trabajando}>
            <RefreshCw size={12} /> {trabajando === 'todas' ? 'Revisando…' : `Revisar respuestas (${esperando})`}
          </Btn>
        )}
        <Btn size="sm" onClick={() => setNueva(true)}><Plus size={12} /> Agregar</Btn>
      </div>

      {cargando ? <div style={{ fontSize: 11.5, color: '#666' }}>Cargando…</div> : refs.length === 0 && !nueva ? (
        <div style={{ fontSize: 11.5, color: '#777', lineHeight: 1.7 }}>
          El CV no ofreció referencias, o todavía no se ha analizado. Puedes capturarlas a mano con “Agregar”.
        </div>
      ) : null}

      {nueva && <FormaReferencia onGuardar={async d => { await agregarReferencia(cand.id, d); setNueva(false); recargar() }} onCancelar={() => setNueva(false)} />}

      <div style={{ display: 'grid', gap: 9 }}>
        {refs.map(r => (
          <RenglonReferencia key={r.id} r={r} trabajando={trabajando === r.id}
            onRedactar={() => redactar(r)}
            onGuardar={async campos => { await guardarReferencia(r.id, campos); recargar() }}
            onBorrar={async () => { await borrarReferencia(r.id); recargar() }} />
        ))}
      </div>

      {err && <div style={{ fontSize: 11.5, color: err === 'Todavía no contestan.' ? '#888' : '#DC2626', marginTop: 8 }}>{err}</div>}

      {borrador && (
        <ModalBorrador borrador={borrador} enviando={!!trabajando}
          onCambio={b => setBorrador({ ...borrador, b })}
          onEnviar={mandar} onCerrar={() => setBorrador(null)} />
      )}
    </div>
  )
}

function RenglonReferencia({ r, trabajando, onRedactar, onGuardar, onBorrar }: {
  r: Referencia; trabajando: boolean
  onRedactar: () => void; onGuardar: (c: Partial<Referencia>) => void; onBorrar: () => void
}) {
  const [correo, setCorreo] = useState(r.email || '')
  const cfg = ESTADO_REF_CFG[r.estado]
  const res = r.resumen

  return (
    <div style={{ border: '1px solid #1e1e1e', borderRadius: 9, padding: '10px 12px', background: '#101010' }}>
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 210 }}>
          <div style={{ fontSize: 12.5, color: '#eee', fontWeight: 600 }}>
            {r.nombre}
            {r.es_empleador_actual && <span style={{ fontSize: 10, color: '#DC2626', marginLeft: 7 }}>· empleador ACTUAL</span>}
          </div>
          <div style={{ fontSize: 10.5, color: '#777', marginTop: 2 }}>
            {[r.puesto, r.empresa, r.relacion].filter(Boolean).join(' · ') || 'Sin datos del puesto'}
            {r.telefono ? ` · tel ${r.telefono}` : ''}
          </div>
        </div>
        <Badge label={cfg.label} color={cfg.color} />
        <button onClick={onBorrar} title="Quitar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: 2 }}><Trash2 size={12} /></button>
      </div>

      {r.es_empleador_actual && r.estado === 'pendiente' && (
        <div style={{ fontSize: 10.5, color: '#D9A441', marginTop: 6, lineHeight: 1.6 }}>
          Es su trabajo actual. Escribirle sin que el candidato lo autorice le puede costar el empleo — pregúntale primero.
        </div>
      )}

      {(r.estado === 'pendiente' || r.estado === 'sin_datos') && (
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <input value={correo} onChange={e => setCorreo(e.target.value)}
            onBlur={() => correo !== (r.email || '') && onGuardar({ email: correo.trim() || null })}
            placeholder="correo de la referencia" style={{ ...inp, flex: 1, minWidth: 200, fontSize: 11.5 }} />
          <Btn size="sm" variant="primary" onClick={onRedactar} disabled={!correo.trim() || trabajando}>
            <Sparkles size={12} /> {trabajando ? 'Redactando…' : 'Redactar correo'}
          </Btn>
        </div>
      )}

      {r.estado === 'enviado' && (
        <div style={{ fontSize: 10.5, color: '#666', marginTop: 6 }}>
          Enviado a {r.email} el {r.enviado_at ? new Date(r.enviado_at).toLocaleDateString('es-MX') : '—'}. Sin respuesta todavía.
        </div>
      )}

      {r.estado === 'respondido' && (
        <div style={{ marginTop: 9, borderTop: '1px solid #1c1c1c', paddingTop: 9 }}>
          {res ? (
            <>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 7 }}>
                {res.tono && <Badge label={TONO_CFG[res.tono]?.label || res.tono} color={TONO_CFG[res.tono]?.color || '#888'} />}
                <Badge label={`Puesto: ${CONFIRMA_CFG[res.confirma_puesto]?.label || '—'}`} color={CONFIRMA_CFG[res.confirma_puesto]?.color || '#666'} />
                <Badge label={`Fechas: ${CONFIRMA_CFG[res.confirma_fechas]?.label || '—'}`} color={CONFIRMA_CFG[res.confirma_fechas]?.color || '#666'} />
                <Badge label={RECONTRATA_CFG[res.lo_recontrataria]?.label || '—'} color={RECONTRATA_CFG[res.lo_recontrataria]?.color || '#666'} />
              </div>
              {res.desempeno && <div style={{ fontSize: 11.5, color: '#ccc', lineHeight: 1.7 }}>{res.desempeno}</div>}
              {!!res.contradice_el_cv?.length && (
                <div style={{ marginTop: 7 }}>
                  {res.contradice_el_cv.map((c, i) => (
                    <div key={i} style={{ fontSize: 11.5, color: '#DC2626', display: 'flex', gap: 5, alignItems: 'flex-start' }}>
                      <AlertTriangle size={11} style={{ marginTop: 2, flexShrink: 0 }} /> Contradice el CV: {c}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginTop: 7 }}>
                {!!res.fortalezas?.length && <div>{res.fortalezas.map((f, i) => <div key={i} style={{ fontSize: 11, color: '#10B981' }}>+ {f}</div>)}</div>}
                {!!res.reservas?.length && <div>{res.reservas.map((f, i) => <div key={i} style={{ fontSize: 11, color: '#D9A441' }}>− {f}</div>)}</div>}
              </div>
            </>
          ) : null}
          {r.respuesta_texto && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 10.5, color: '#666', cursor: 'pointer' }}>Ver la respuesta completa</summary>
              <div style={{ fontSize: 11, color: '#999', whiteSpace: 'pre-wrap', lineHeight: 1.7, marginTop: 6 }}>{r.respuesta_texto}</div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function FormaReferencia({ onGuardar, onCancelar }: {
  onGuardar: (d: Partial<Referencia>) => void; onCancelar: () => void
}) {
  const [d, setD] = useState<Partial<Referencia>>({ nombre: '', empresa: '', relacion: '', email: '', telefono: '' })
  const campo = (k: keyof Referencia, ph: string) => (
    <input value={(d[k] as string) || ''} onChange={e => setD({ ...d, [k]: e.target.value })}
      placeholder={ph} style={{ ...inp, fontSize: 11.5 }} />
  )
  return (
    <div style={{ border: '1px solid #242424', borderRadius: 9, padding: 11, marginBottom: 10, display: 'grid', gap: 7 }}>
      <div style={{ display: 'grid', gap: 7, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {campo('nombre', 'Nombre *')}
        {campo('empresa', 'Empresa')}
        {campo('relacion', 'Relación (jefe directo, colega…)')}
        {campo('email', 'Correo')}
        {campo('telefono', 'Teléfono')}
      </div>
      <label style={{ fontSize: 11, color: '#888', display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={!!d.es_empleador_actual} onChange={e => setD({ ...d, es_empleador_actual: e.target.checked })} />
        Es su empleador actual (no escribirle sin permiso del candidato)
      </label>
      <div style={{ display: 'flex', gap: 7 }}>
        <Btn size="sm" variant="primary" onClick={() => d.nombre?.trim() && onGuardar(d)}>Guardar</Btn>
        <Btn size="sm" onClick={onCancelar}>Cancelar</Btn>
      </div>
    </div>
  )
}

/**
 * El correo SIEMPRE se ve antes de mandarse. Va a nombre de OMM, a un tercero,
 * y no se puede deshacer: que la IA lo redacte no significa que lo mande sola.
 */
function ModalBorrador({ borrador, enviando, onCambio, onEnviar, onCerrar }: {
  borrador: { ref: Referencia; b: BorradorCorreo }; enviando: boolean
  onCambio: (b: BorradorCorreo) => void; onEnviar: () => void; onCerrar: () => void
}) {
  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, background: '#000c', display: 'grid', placeItems: 'center', zIndex: 90, padding: 18 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: 'min(680px, 100%)', maxHeight: '86vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
          <Mail size={15} color="#57FF9A" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#eee' }}>Correo a {borrador.ref.nombre}</div>
            <div style={{ fontSize: 11, color: '#777' }}>{borrador.ref.email}</div>
          </div>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}><X size={16} /></button>
        </div>
        <div style={lbl}>Asunto</div>
        <input value={borrador.b.asunto} onChange={e => onCambio({ ...borrador.b, asunto: e.target.value })} style={{ ...inp, marginBottom: 9 }} />
        <div style={lbl}>Mensaje</div>
        <textarea value={borrador.b.cuerpo} onChange={e => onCambio({ ...borrador.b, cuerpo: e.target.value })}
          rows={14} style={{ ...inp, resize: 'vertical', lineHeight: 1.7 }} />
        <div style={{ fontSize: 10.5, color: '#777', margin: '9px 0', lineHeight: 1.6 }}>
          Se manda desde tu Gmail. Léelo antes: sale a nombre de OMM y no se puede deshacer.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="primary" onClick={onEnviar} disabled={enviando || !borrador.b.cuerpo.trim()}>
            <Send size={13} /> {enviando ? 'Enviando…' : 'Enviar'}
          </Btn>
          <Btn onClick={onCerrar}>Cancelar</Btn>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  EXAMEN PREVIO A LA ENTREVISTA
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Lo que pidió Elias: comprobar que saben lo que dicen saber ANTES de sentarse
 * con ellos. El examen se arma en Capacitaciones; aquí solo se asigna, se manda
 * la liga y se ve el resultado.
 */
function PanelExamenes({ cand, vacantes }: { cand: Candidato; vacantes: Vacante[] }) {
  const { user } = useAuth()
  const [disponibles, setDisponibles] = useState<Array<Capacitacion & { preguntas: number }>>([])
  const [asigs, setAsigs] = useState<ExamenAsignado[]>([])
  const [cargando, setCargando] = useState(true)
  const [elegido, setElegido] = useState('')
  const [trabajando, setTrabajando] = useState('')
  const [err, setErr] = useState('')
  const [copiada, setCopiada] = useState('')
  const [borrador, setBorrador] = useState<{ a: ExamenAsignado; cap: Capacitacion; b: BorradorExamen } | null>(null)

  async function recargar() { setAsigs(await cargarAsignaciones(cand.id)); setCargando(false) }
  useEffect(() => {
    examenesDisponibles().then(setDisponibles).catch(() => {})
    recargar()
  }, [cand.id])

  const correo = cand.email || cand.email_relay || ''
  const vac = vacantes.find(v => v.id === cand.vacante_id) || null

  async function asignar() {
    if (!elegido) return
    setTrabajando('nuevo'); setErr('')
    try { await asignarExamen(cand.id, elegido); setElegido(''); await recargar() }
    catch (e: any) { setErr(e?.message || String(e)) }
    setTrabajando('')
  }

  async function redactar(a: ExamenAsignado) {
    const cap = (a.capacitacion || disponibles.find(c => c.id === a.capacitacion_id)) as Capacitacion | undefined
    if (!cap) { setErr('Ese examen ya no existe.'); return }
    setTrabajando(a.id); setErr('')
    try {
      const vence = a.vence_at ? new Date(a.vence_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'long' }) : null
      setBorrador({ a, cap, b: await redactarInvitacion(cand, cap, ligaDelExamen(a.token), vac, user?.nombre || 'OMM Technologies', vence) })
    } catch (e: any) { setErr(e?.message || String(e)) }
    setTrabajando('')
  }

  async function mandar() {
    if (!borrador) return
    setTrabajando(borrador.a.id); setErr('')
    try { await enviarInvitacion(borrador.a, correo, borrador.b); setBorrador(null); await recargar() }
    catch (e: any) { setErr(e?.message || String(e)) }
    setTrabajando('')
  }

  function copiar(a: ExamenAsignado) {
    navigator.clipboard?.writeText(ligaDelExamen(a.token))
      .then(() => { setCopiada(a.id); setTimeout(() => setCopiada(''), 2000) })
      .catch(() => setErr('No se pudo copiar; selecciona la liga a mano.'))
  }

  return (
    <div style={{ ...card, marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <ClipboardCheck size={14} color="#57FF9A" />
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#eee', flex: 1 }}>
          Evaluación antes de la entrevista
          {asigs.length > 0 && <span style={{ color: '#666', fontWeight: 400 }}> · {asigs.length}</span>}
        </div>
      </div>

      {disponibles.length === 0 ? (
        <div style={{ fontSize: 11.5, color: '#777', lineHeight: 1.7 }}>
          No hay evaluaciones publicadas con preguntas. Se arman en <b>Capacitaciones</b>:
          crea una, agrégale preguntas y publícala; aquí aparece sola.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: asigs.length ? 12 : 0 }}>
          <select value={elegido} onChange={e => setElegido(e.target.value)} style={{ ...inp, flex: 1, minWidth: 220, fontSize: 11.5 }}>
            <option value="">Escoge la evaluación…</option>
            {disponibles.map(c => <option key={c.id} value={c.id}>{c.titulo} · {c.preguntas} pregunta(s)</option>)}
          </select>
          <Btn size="sm" variant="primary" onClick={asignar} disabled={!elegido || trabajando === 'nuevo'}>
            <Plus size={12} /> {trabajando === 'nuevo' ? 'Creando…' : 'Asignar'}
          </Btn>
        </div>
      )}

      {cargando ? null : (
        <div style={{ display: 'grid', gap: 9 }}>
          {asigs.map(a => {
            const cap = a.capacitacion
            const it: any = a.intento
            const vencida = !!a.vence_at && new Date(a.vence_at).getTime() < Date.now() && !it
            return (
              <div key={a.id} style={{ border: '1px solid #1e1e1e', borderRadius: 9, padding: '10px 12px', background: '#101010' }}>
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 12.5, color: '#eee', fontWeight: 600 }}>{cap?.titulo || 'Evaluación'}</div>
                    <div style={{ fontSize: 10.5, color: '#777', marginTop: 2 }}>
                      {!a.enviado_at ? 'Sin enviar' : `Enviada el ${new Date(a.enviado_at).toLocaleDateString('es-MX')}`}
                      {a.abierto_at ? ' · la abrió' : ''}
                      {a.vence_at ? ` · vence ${new Date(a.vence_at).toLocaleDateString('es-MX')}` : ''}
                    </div>
                  </div>
                  {it ? (
                    <Badge
                      label={it.pendiente_revision ? `${it.calificacion}% · falta revisar abiertas` : it.aprobado ? `Aprobó · ${it.calificacion}%` : `No aprobó · ${it.calificacion}%`}
                      color={it.pendiente_revision ? '#D9A441' : it.aprobado ? '#10B981' : '#DC2626'} />
                  ) : (
                    <Badge label={vencida ? 'Vencida' : a.enviado_at ? 'Esperando respuesta' : 'Sin enviar'}
                      color={vencida ? '#DC2626' : a.enviado_at ? '#2563EB' : '#6B7280'} />
                  )}
                  {!it && (
                    <button onClick={async () => { await quitarAsignacion(a.id); recargar() }} title="Quitar"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: 2 }}><Trash2 size={12} /></button>
                  )}
                </div>

                {!it && (
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 9, flexWrap: 'wrap' }}>
                    <Btn size="sm" onClick={() => copiar(a)}>
                      <Copy size={12} /> {copiada === a.id ? 'Copiada' : 'Copiar liga'}
                    </Btn>
                    {correo ? (
                      <Btn size="sm" variant="primary" onClick={() => redactar(a)} disabled={trabajando === a.id}>
                        <Sparkles size={12} /> {trabajando === a.id ? 'Redactando…' : a.enviado_at ? 'Volver a enviar' : 'Redactar y enviar'}
                      </Btn>
                    ) : (
                      <span style={{ fontSize: 10.5, color: '#D9A441' }}>Sin correo del candidato — copia la liga y mándasela tú.</span>
                    )}
                    {correo === cand.email_relay && cand.email_relay && (
                      <span style={{ fontSize: 10.5, color: '#777' }}>Se mandará al alias de Indeed; él lo recibe igual.</span>
                    )}
                  </div>
                )}

                {it?.pendiente_revision && (
                  <div style={{ fontSize: 10.5, color: '#D9A441', marginTop: 7, lineHeight: 1.6 }}>
                    Trae preguntas abiertas: el porcentaje solo cuenta las de opción. Revísalas en Capacitaciones antes de decidir.
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {err && <div style={{ fontSize: 11.5, color: '#DC2626', marginTop: 8 }}>{err}</div>}

      {borrador && (
        <ModalBorrador
          borrador={{ ref: { id: borrador.a.id, nombre: cand.nombre, email: correo } as any, b: borrador.b }}
          enviando={!!trabajando}
          onCambio={b => setBorrador({ ...borrador, b })}
          onEnviar={mandar} onCerrar={() => setBorrador(null)} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANÁLISIS IA
// ═══════════════════════════════════════════════════════════════════════════
const CUMPLE_CFG: Record<string, { label: string; color: string }> = {
  si:      { label: 'Cumple',   color: '#10B981' },
  parcial: { label: 'A medias', color: '#D9A441' },
  no:      { label: 'No',       color: '#DC2626' },
  no_dice: { label: 'No dice',  color: '#666' },
}
const EVID_CFG: Record<string, { label: string; color: string }> = {
  respaldada:  { label: 'respaldada en el CV', color: '#10B981' },
  mencionada:  { label: 'solo mencionada',     color: '#D9A441' },
  sin_respaldo:{ label: 'sin respaldo',        color: '#DC2626' },
}
const SEV_COLOR: Record<string, string> = { alta: '#DC2626', media: '#D9A441', baja: '#777' }
const TRASLADO_CFG: Record<string, { label: string; color: string }> = {
  bajo: { label: 'Traslado corto', color: '#10B981' },
  medio: { label: 'Traslado medio', color: '#D9A441' },
  alto: { label: 'Traslado largo', color: '#DC2626' },
  no_se_sabe: { label: 'Traslado desconocido', color: '#666' },
}

const meses = (n?: number | null) =>
  n == null ? '—' : n < 12 ? `${n} m` : `${Math.floor(n / 12)} a ${n % 12 ? `${n % 12} m` : ''}`.trim()

function Titulo({ children }: { children: any }) {
  return <div style={{ fontSize: 11, letterSpacing: .5, textTransform: 'uppercase', color: '#666', margin: '14px 0 7px' }}>{children}</div>
}

function PanelAnalisis({ cand, vacantes, onAnalizado }: {
  cand: Candidato; vacantes: Vacante[]; onAnalizado: (c: Candidato) => void
}) {
  const [corriendo, setCorriendo] = useState(false)
  const a: Analisis | null = (cand.analisis as Analisis) || null

  async function analizar() {
    setCorriendo(true)
    const v = vacantes.find(x => x.id === cand.vacante_id) || vacanteParaPuesto(cand.puesto_solicitado, vacantes)
    const r = await analizarCandidato(cand, v || null)
    setCorriendo(false)
    if (r.ok && r.analisis) onAnalizado({ ...cand, analisis: r.analisis, compatibilidad: r.analisis.compatibilidad, analisis_at: new Date().toISOString(), analisis_error: null })
    else onAnalizado({ ...cand, analisis_error: r.error || 'falló', analisis_at: new Date().toISOString() })
  }

  const vac = vacantes.find(x => x.id === cand.vacante_id)
  const ver = a ? VEREDICTO_CFG[a.veredicto] : null

  return (
    <div style={{ ...card, marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
        <Sparkles size={14} color="#57FF9A" />
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#eee', flex: 1 }}>
          Análisis contra el puesto
          {vac ? <span style={{ color: '#666', fontWeight: 400 }}> · {vac.titulo}</span>
               : <span style={{ color: '#D9A441', fontWeight: 400 }}> · sin vacante ligada, se evaluó contra lo que dijo postularse</span>}
        </div>
        <Btn size="sm" onClick={analizar} disabled={corriendo}>
          <RefreshCw size={12} /> {corriendo ? 'Analizando…' : a ? 'Volver a analizar' : 'Analizar'}
        </Btn>
      </div>

      {!a && !cand.analisis_error && !corriendo && (
        <div style={{ fontSize: 11.5, color: '#777', lineHeight: 1.7 }}>
          Todavía no tiene análisis. Se hace solo al abrir Reclutamiento, o aquí con el botón.
        </div>
      )}
      {cand.analisis_error && !a && (
        <div style={{ fontSize: 11.5, color: '#DC2626', lineHeight: 1.7 }}>
          No se pudo analizar: {cand.analisis_error}
          {!cand.cv_path && ' · Este candidato no trae CV adjunto.'}
        </div>
      )}

      {a && (
        <>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <div style={{ display: 'grid', placeItems: 'center', width: 62, height: 62, borderRadius: 12, border: `1px solid ${colorCompat(a.compatibilidad)}55`, background: colorCompat(a.compatibilidad) + '14' }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: colorCompat(a.compatibilidad), lineHeight: 1 }}>{a.compatibilidad}</span>
              <span style={{ fontSize: 7.5, color: colorCompat(a.compatibilidad), opacity: .8 }}>AJUSTE</span>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              {ver && <Badge label={ver.label} color={ver.color} />}
              <div style={{ fontSize: 12.5, color: '#ccc', lineHeight: 1.7, marginTop: 6 }}>{a.resumen}</div>
              <div style={{ fontSize: 10.5, color: '#666', marginTop: 5 }}>
                {[a.puesto_actual, a.anos_experiencia != null ? `${a.anos_experiencia} año(s) de experiencia` : null,
                  a.permanencia?.promedio_meses != null ? `promedio ${meses(a.permanencia.promedio_meses)} por empleo` : null]
                  .filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>

          {/* Datos de contexto. Van aparte a propósito: no entran en el número. */}
          <Titulo>Contexto — no cuenta para el ajuste</Titulo>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {a.contexto.edad != null && <Badge label={`${a.contexto.edad} años`} color="#6B7280" />}
            {a.contexto.ubicacion && <Badge label={a.contexto.ubicacion} color="#6B7280" />}
            <Badge label={TRASLADO_CFG[a.contexto.riesgo_traslado].label} color={TRASLADO_CFG[a.contexto.riesgo_traslado].color} />
            {a.contexto.distancia && <span style={{ fontSize: 11, color: '#888' }}>{a.contexto.distancia}</span>}
          </div>
          {a.contexto.nota_traslado && <div style={{ fontSize: 10.5, color: '#777', marginTop: 5 }}>{a.contexto.nota_traslado}</div>}
          <div style={{ fontSize: 10, color: '#555', marginTop: 6, lineHeight: 1.6 }}>
            La edad se reporta porque la pediste, pero el número de ajuste no la usa: calificar por edad
            es discriminación laboral (LFT art. 133). El traslado sí predice ausentismo — pondéralo tú.
          </div>

          {a.requisitos.length > 0 && (<>
            <Titulo>Requisito por requisito</Titulo>
            <div style={{ display: 'grid', gap: 6 }}>
              {a.requisitos.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11.5 }}>
                  <span style={{ flexShrink: 0, minWidth: 62, fontSize: 10, fontWeight: 600, color: CUMPLE_CFG[r.cumple].color }}>{CUMPLE_CFG[r.cumple].label}</span>
                  <span style={{ color: '#ccc', flex: 1 }}>
                    <b style={{ color: '#ddd', fontWeight: 500 }}>{r.requisito}</b>
                    {r.por_que && <span style={{ color: '#888' }}> — {r.por_que}</span>}
                  </span>
                </div>
              ))}
            </div>
          </>)}

          {a.trayectoria.length > 0 && (<>
            <Titulo>Dónde ha estado y cuánto duró</Titulo>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                <tbody>
                  {a.trayectoria.map((t, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 11.5, color: '#ddd', padding: '5px 8px 5px 0', borderBottom: '1px solid #1a1a1a' }}>
                        {t.empresa}
                        <div style={{ fontSize: 10.5, color: '#777' }}>{t.puesto}{t.nota ? ` · ${t.nota}` : ''}</div>
                      </td>
                      <td style={{ fontSize: 10.5, color: '#777', padding: '5px 8px', borderBottom: '1px solid #1a1a1a', whiteSpace: 'nowrap' }}>
                        {[t.desde, t.hasta].filter(Boolean).join(' → ') || '—'}
                      </td>
                      <td style={{ fontSize: 11, color: (t.meses != null && t.meses < 12) ? '#D9A441' : '#aaa', padding: '5px 0 5px 8px', borderBottom: '1px solid #1a1a1a', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {meses(t.meses)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {a.permanencia?.patron && <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>{a.permanencia.patron}</div>}
          </>)}

          {a.dice_saber.length > 0 && (<>
            <Titulo>Lo que dice saber, y si el CV lo respalda</Titulo>
            <div style={{ display: 'grid', gap: 5 }}>
              {a.dice_saber.map((h, i) => (
                <div key={i} style={{ fontSize: 11.5, color: '#ccc' }}>
                  {h.habilidad}
                  <span style={{ color: EVID_CFG[h.evidencia].color, fontSize: 10.5 }}> · {EVID_CFG[h.evidencia].label}</span>
                  {h.nota && <span style={{ color: '#777', fontSize: 10.5 }}> — {h.nota}</span>}
                </div>
              ))}
            </div>
          </>)}

          {a.banderas.length > 0 && (<>
            <Titulo>Indicadores a observar</Titulo>
            <div style={{ display: 'grid', gap: 6 }}>
              {a.banderas.map((b, i) => (
                <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5 }}>
                  <AlertTriangle size={12} color={SEV_COLOR[b.severidad]} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span style={{ color: '#ccc' }}><b style={{ fontWeight: 500, color: SEV_COLOR[b.severidad] }}>{b.senal}</b> — {b.por_que}</span>
                </div>
              ))}
            </div>
          </>)}

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {a.fortalezas.length > 0 && (
              <div><Titulo>A favor</Titulo>
                {a.fortalezas.map((f, i) => <div key={i} style={{ fontSize: 11.5, color: '#10B981', marginBottom: 4 }}>+ {f}</div>)}
              </div>
            )}
            {a.riesgos.length > 0 && (
              <div><Titulo>En contra</Titulo>
                {a.riesgos.map((r, i) => <div key={i} style={{ fontSize: 11.5, color: '#D9A441', marginBottom: 4 }}>− {r}</div>)}
              </div>
            )}
          </div>

          {a.preguntas.length > 0 && (<>
            <Titulo>Qué preguntarle en la entrevista</Titulo>
            {a.preguntas.map((q, i) => <div key={i} style={{ fontSize: 11.5, color: '#ccc', marginBottom: 5, lineHeight: 1.6 }}>{i + 1}. {q}</div>)}
          </>)}

          {a.falta_saber.length > 0 && (<>
            <Titulo>Lo que el CV no dice</Titulo>
            {a.falta_saber.map((f, i) => <div key={i} style={{ fontSize: 11.5, color: '#888', marginBottom: 4 }}>· {f}</div>)}
          </>)}

          <div style={{ fontSize: 10, color: '#444', marginTop: 12, borderTop: '1px solid #1a1a1a', paddingTop: 8 }}>
            {cand.analisis_at && `Analizado el ${new Date(cand.analisis_at).toLocaleString('es-MX')}`}
            {cand.analisis_modelo ? ` · ${cand.analisis_modelo}` : ''}
            {' · '}Es una lectura del CV, no un dictamen. Verifica en la entrevista.
          </div>
        </>
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
