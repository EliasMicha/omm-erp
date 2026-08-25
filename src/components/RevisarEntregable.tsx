// ═══════════════════════════════════════════════════════════════════════════
// RevisarEntregable — dos clics para devolver, y el dato de calidad sale solo.
//
// El revisor ve los puntos del checklist del tipo de entregable y toca los que
// fallaron. Eso hace tres cosas a la vez: le dice al que entregó exactamente
// qué arreglar, ahorra escribir, y produce el único indicador de calidad que
// sirve para actuar — cuál punto falla más en toda la organización.
//
// El comentario libre sigue existiendo, pero es opcional: para devolver basta
// marcar un punto. Exigir las dos cosas convertiría la revisión en trámite, y
// un trámite se deja de hacer.
// ═══════════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import { Check, RotateCcw, ExternalLink, Clock } from 'lucide-react'
import {
  Entregable, TipoEntregable, ChecklistItem,
  revisar, urlDe, diasEsperando, colorEspera,
} from '../lib/entregables'

const inp: React.CSSProperties = { background: '#141414', color: '#ddd', border: '1px solid #242424', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontFamily: 'inherit', outline: 'none' }
const btn: React.CSSProperties = { border: '1px solid #333', background: '#161616', color: '#ccc', borderRadius: 8, padding: '6px 11px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }

export default function RevisarEntregable({ e, tipos, employeeId, nombreDe, onResuelto, compacto }: {
  e: Entregable
  tipos: TipoEntregable[]
  employeeId?: string | null
  nombreDe?: (id?: string | null) => string
  onResuelto: () => void
  compacto?: boolean
}) {
  const [fallas, setFallas] = useState<string[]>([])
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const tipo = tipos.find(t => t.id === e.tipo_id)
  // Los puntos que se muestran son los del entregable (la copia que se hizo al
  // subir), no los de la receta de hoy: si la receta cambió después, juzgar
  // con la nueva sería mover la portería a media jugada.
  const puntos: ChecklistItem[] = (e.checklist && e.checklist.length ? e.checklist : tipo?.checklist || [])
  const url = urlDe(e)
  const dias = diasEsperando(e)

  const alternar = (t: string) => setFallas(f => f.includes(t) ? f.filter(x => x !== t) : [...f, t])

  async function resolver(estado: 'aceptado' | 'corregir') {
    setErr(''); setBusy(true)
    const r = await revisar(e.id, estado, {
      revisadoPorId: employeeId,
      correcciones: texto,
      fallas: estado === 'corregir' ? fallas : [],
    })
    setBusy(false)
    if (!r.ok) return setErr(r.error || 'No se pudo guardar la revisión.')
    setFallas([]); setTexto('')
    onResuelto()
  }

  return (
    <div>
      {!compacto && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 9 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13.5, color: '#eee', fontWeight: 500 }}>
              {e.nombre} <span style={{ color: '#666', fontSize: 10 }}>v{e.version}</span>
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>
              {tipo?.nombre || 'Entregable'}{nombreDe ? ` · ${nombreDe(e.subido_por_id)}` : ''}
              {e.titulo_cliente ? ` · ${e.titulo_cliente}` : ''}
            </div>
            <div style={{ fontSize: 11, color: colorEspera(dias), marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={11} /> {dias < 1 ? 'Subido hoy' : `Esperando ${Math.floor(dias)} día(s)`}
            </div>
          </div>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" style={{ ...btn, alignSelf: 'flex-start', textDecoration: 'none' }}>
              <ExternalLink size={13} /> Abrir
            </a>
          )}
        </div>
      )}

      {puntos.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: .6, marginBottom: 6 }}>
            Toca lo que NO cumple
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 9 }}>
            {puntos.map((p, i) => {
              const malo = fallas.includes(p.texto)
              const noMarcado = p.obligatorio && !p.marcado
              return (
                <button key={i} onClick={() => alternar(p.texto)} title={noMarcado ? 'Se entregó sin marcar este punto obligatorio' : undefined}
                  style={{
                    ...btn, padding: '5px 9px', fontSize: 11.5, textAlign: 'left', maxWidth: '100%',
                    borderColor: malo ? '#DC2626' : noMarcado ? '#7a5c1e' : '#2a2a2a',
                    background: malo ? '#2a1010' : 'transparent',
                    color: malo ? '#f4a5a5' : noMarcado ? '#c9a44a' : '#999',
                  }}>
                  {malo ? '✕' : '·'} {p.texto}
                </button>
              )
            })}
          </div>
        </>
      )}

      <textarea value={texto} onChange={ev => setTexto(ev.target.value)}
        placeholder={puntos.length ? 'Comentario adicional (opcional)' : 'Qué hay que corregir'}
        style={{ ...inp, width: '100%', minHeight: 44, resize: 'vertical' }} />

      {err && <div style={{ fontSize: 11.5, color: '#DC2626', marginTop: 7 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 7, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => resolver('aceptado')} disabled={busy}
          style={{ ...btn, borderColor: '#10B981', color: '#10B981' }}><Check size={13} /> Aceptar</button>
        <button onClick={() => resolver('corregir')} disabled={busy}
          style={{ ...btn, borderColor: '#DC2626', color: '#DC2626' }}><RotateCcw size={13} /> Devolver a corregir</button>
        {fallas.length > 0 && (
          <span style={{ fontSize: 11, color: '#f4a5a5' }}>{fallas.length} punto(s) marcados</span>
        )}
      </div>
    </div>
  )
}
