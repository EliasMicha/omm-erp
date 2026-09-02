// La página que abre el candidato con la liga del examen. SIN login: no tiene
// usuario del ERP y pedirle registrarse para contestar mata la respuesta.
//
// Dos cosas que no hace a propósito:
//  · No muestra la respuesta correcta (las preguntas llegan sin ella).
//  · No le dice su calificación al terminar. Eso lo revisa quien contrata.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ExamenPublico as Datos, examenPorToken, entregarExamen,
} from '../lib/examenCandidato'

const fondo: React.CSSProperties = { minHeight: '100vh', background: '#0a0a0a', color: '#eee', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '28px 18px' }
const caja: React.CSSProperties = { maxWidth: 760, margin: '0 auto' }
const card: React.CSSProperties = { background: '#111', border: '1px solid #222', borderRadius: 12, padding: 18, marginBottom: 14 }
const btn: React.CSSProperties = { border: '1px solid #10B981', background: '#10B98122', color: '#10B981', borderRadius: 9, padding: '11px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }

export default function ExamenPublicoPage() {
  const { token } = useParams()
  const [d, setD] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [resp, setResp] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState(false)
  const [listo, setListo] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    examenPorToken(token || '')
      .then(x => { setD(x); setCargando(false) })
      .catch(() => { setCargando(false) })
  }, [token])

  async function entregar() {
    if (!d) return
    setEnviando(true); setErr('')
    try { await entregarExamen(d.asignacion.token, resp); setListo(true) }
    catch (e: any) { setErr(e?.message || String(e)) }
    setEnviando(false)
  }

  if (cargando) return <div style={fondo}><div style={caja}>Cargando…</div></div>

  if (!d) return (
    <div style={fondo}><div style={caja}><div style={card}>
      <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Esta liga no es válida</h1>
      <p style={{ color: '#888', fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
        Puede que se haya copiado incompleta. Cópiala otra vez del correo, completa, o responde ese correo para que te manden una nueva.
      </p>
    </div></div></div>
  )

  if (listo || d.yaContestado) return (
    <div style={fondo}><div style={caja}><div style={{ ...card, borderColor: '#1f3a2a' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 8px', color: '#10B981' }}>Listo, quedó registrado</h1>
      <p style={{ color: '#aaa', fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
        Gracias por tu tiempo{d.candidato.nombre ? `, ${d.candidato.nombre.split(' ')[0]}` : ''}.
        Ya lo tenemos. Si el resultado es favorable te contactamos para agendar la entrevista.
      </p>
    </div></div></div>
  )

  if (d.vencido) return (
    <div style={fondo}><div style={caja}><div style={{ ...card, borderColor: '#3a2a15' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 8px', color: '#D9A441' }}>Esta evaluación ya venció</h1>
      <p style={{ color: '#888', fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
        Responde el correo que te la mandó y con gusto te enviamos una liga nueva.
      </p>
    </div></div></div>
  )

  const contestadas = d.preguntas.filter(p => (resp[p.id] || '').trim()).length
  const faltan = d.preguntas.length - contestadas

  return (
    <div style={fondo}>
      <div style={caja}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: '#666', letterSpacing: '.08em', textTransform: 'uppercase' }}>OMM Technologies</div>
          <h1 style={{ fontSize: 22, margin: '6px 0 4px' }}>{d.capacitacion.titulo}</h1>
          <div style={{ fontSize: 13, color: '#888' }}>
            {d.candidato.nombre ? `${d.candidato.nombre} · ` : ''}{d.preguntas.length} pregunta(s)
            {d.capacitacion.minutos_estimados ? ` · ~${d.capacitacion.minutos_estimados} min` : ''}
          </div>
        </div>

        {d.capacitacion.descripcion && (
          <div style={{ ...card, color: '#bbb', fontSize: 13.5, lineHeight: 1.7 }}>{d.capacitacion.descripcion}</div>
        )}

        {d.preguntas.map((p, i) => (
          <div key={p.id} style={card}>
            <div style={{ fontSize: 14.5, marginBottom: 11, lineHeight: 1.6 }}>
              <span style={{ color: '#555', marginRight: 8 }}>{i + 1}.</span>{p.pregunta}
            </div>
            {p.tipo === 'abierta' ? (
              <textarea value={resp[p.id] || ''} onChange={e => setResp({ ...resp, [p.id]: e.target.value })}
                rows={5} placeholder="Tu respuesta"
                style={{ width: '100%', background: '#161616', color: '#eee', border: '1px solid #262626', borderRadius: 8, padding: 11, fontSize: 14, fontFamily: 'inherit', lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box' }} />
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {(p.tipo === 'verdadero_falso' ? ['Verdadero', 'Falso'] : (p.opciones || [])).map(op => {
                  const puesta = resp[p.id] === op
                  return (
                    <button key={op} onClick={() => setResp({ ...resp, [p.id]: op })}
                      style={{
                        textAlign: 'left', padding: '11px 14px', borderRadius: 9, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit',
                        border: `1px solid ${puesta ? '#10B981' : '#262626'}`,
                        background: puesta ? '#10B98118' : '#161616',
                        color: puesta ? '#10B981' : '#ccc',
                      }}>{op}</button>
                  )
                })}
              </div>
            )}
          </div>
        ))}

        <div style={{ ...card, position: 'sticky', bottom: 12, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 190, fontSize: 13, color: faltan > 0 ? '#D9A441' : '#10B981' }}>
            {faltan > 0 ? `Te faltan ${faltan} de ${d.preguntas.length}` : 'Contestaste todas'}
          </div>
          <button onClick={entregar} disabled={enviando || contestadas === 0} style={{ ...btn, opacity: enviando || contestadas === 0 ? .5 : 1 }}>
            {enviando ? 'Enviando…' : 'Entregar'}
          </button>
        </div>
        {faltan > 0 && (
          <div style={{ fontSize: 12, color: '#666', textAlign: 'center', marginBottom: 20 }}>
            Puedes entregar aunque falten, pero lo que dejes en blanco cuenta como no contestado.
          </div>
        )}
        {err && <div style={{ ...card, borderColor: '#3a1515', color: '#DC2626', fontSize: 13 }}>{err}</div>}
      </div>
    </div>
  )
}
