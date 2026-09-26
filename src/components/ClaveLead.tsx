// ─────────────────────────────────────────────────────────────────────────────
//  ClaveLead — la clave de 4 letras del lead, propuesta por el sistema y
//  editable por una persona.
//
//  El automatico acierta casi siempre (Pico Love -> PILO), pero no siempre:
//  "Cero5cien L202 - Eduardo Tawil" da CEL3 y el equipo lo conoce como TAWI.
//  Quien da de alta el lead es quien sabe como le van a decir, asi que la
//  propone el sistema y la confirma la persona.
//
//  De esta clave cuelgan los folios de cotizaciones y compras, y esos folios
//  se escriben en el concepto de las transferencias. Por eso cambiarla no es
//  editar un texto: hay que arrastrar todo lo que ya se emitio.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Check, AlertCircle, Loader2 } from 'lucide-react'

// Hasta 8: las claves que usa el equipo son mas largas que las 4 letras del
// automatico — L202T, RDA101, F2BA101 — y con 8 el folio sigue cabiendo de
// sobra en el concepto de una transferencia (F2BA101-ES01-C03 son 16 de 40).
export function limpiaClave(txt: string): string {
  return (txt || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

export function claveValida(c: string): string | null {
  if (c.length < 2) return 'Mínimo 2 caracteres'
  if (c.length > 8) return 'Máximo 8 caracteres'
  if (/^[0-9]/.test(c)) return 'Tiene que empezar con letra'
  return null
}

/** Campo de clave para el alta de un lead: se propone sola mientras escribes
 *  el nombre, hasta que la tocas. */
export default function ClaveLead({ nombre, valor, onChange, leadId, ancho = 130 }: {
  nombre: string
  valor: string
  onChange: (v: string) => void
  /** Al editar un lead existente, para no chocar consigo mismo. */
  leadId?: string
  ancho?: number
}) {
  const [tocada, setTocada] = useState(false)
  const [estado, setEstado] = useState<'idle' | 'buscando' | 'libre' | 'ocupada'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Propuesta automatica mientras el usuario no haya escrito la suya.
  useEffect(() => {
    if (tocada) return
    const n = (nombre || '').trim()
    if (n.length < 3) { onChange(''); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('omm_sugerir_codigo', { p_nombre: n })
      if (typeof data === 'string' && !tocada) onChange(data)
    }, 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nombre, tocada])

  // Disponibilidad de la clave escrita a mano.
  useEffect(() => {
    if (!valor) { setEstado('idle'); return }
    if (claveValida(valor)) { setEstado('idle'); return }
    setEstado('buscando')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const { data } = await supabase.rpc('omm_codigo_disponible', { p_codigo: valor, p_lead: leadId || null })
      setEstado(data === false ? 'ocupada' : 'libre')
    }, 350)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [valor, leadId])

  const error = valor ? claveValida(valor) : null

  return (
    <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      Clave
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <input value={valor}
          onChange={e => { setTocada(true); onChange(limpiaClave(e.target.value)) }}
          placeholder="PILO"
          style={{
            width: ancho, padding: '8px 10px', background: '#1e1e1e',
            border: '1px solid ' + (error || estado === 'ocupada' ? '#DC2626' : estado === 'libre' ? '#10B981' : '#333'),
            borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', boxSizing: 'border-box',
          }} />
        {estado === 'buscando' && <Loader2 size={13} className="spin" style={{ color: '#555' }} />}
        {!error && estado === 'libre' && <Check size={13} style={{ color: '#10B981' }} />}
        {(error || estado === 'ocupada') && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#DC2626', textTransform: 'none' }}>
            <AlertCircle size={12} /> {error || 'Ya es de otro lead'}
          </span>
        )}
        {!error && estado !== 'ocupada' && valor && (
          <span style={{ fontSize: 10, color: '#444', textTransform: 'none', fontFamily: 'ui-monospace, monospace' }}>
            {valor}-ES01 · {valor}-IE01 · {valor}-ES01-C01
          </span>
        )}
      </div>
    </label>
  )
}

/**
 * Cambiar la clave de un lead que ya existe.
 *
 * No es un update: es una funcion en la base que arrastra los folios de las
 * cotizaciones y de las compras. Si algun folio ya se escribio en el concepto
 * de una transferencia, avisa antes y pide confirmar.
 */
export function CambiarClaveLead({ leadId, claveActual, onChanged }: {
  leadId: string
  claveActual?: string | null
  onChanged?: (nueva: string) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [valor, setValor] = useState(claveActual || '')
  const [msg, setMsg] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar(forzar = false) {
    const c = limpiaClave(valor)
    const err = claveValida(c)
    if (err) { setMsg(err); return }
    setGuardando(true); setMsg('')
    const { data, error } = await supabase.rpc('omm_cambiar_codigo_lead', { p_lead: leadId, p_nuevo: c, p_forzar: forzar })
    setGuardando(false)
    if (error) {
      // El unico error que se puede reintentar es el de los folios ya usados
      // en el banco; los demas son de validacion y hay que corregirlos.
      if (!forzar && /movimiento/i.test(error.message)) {
        if (confirm(error.message.replace('Confirma el cambio para reescribirlos.', '') + '\n\n¿Cambiar la clave de todas formas? Los folios de esos movimientos se reescriben.')) {
          return guardar(true)
        }
        setMsg('Cambio cancelado.')
        return
      }
      setMsg(error.message)
      return
    }
    const r: any = data || {}
    setMsg(r.sin_cambios ? 'Es la misma clave.' : `Listo: ${r.cotizaciones || 0} cotización(es) y ${r.compras || 0} compra(s) refoliadas.`)
    setAbierto(false)
    onChanged?.(c)
  }

  if (!abierto) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Clave</span>
        <span style={{
          fontSize: 13, fontWeight: 700, color: '#bbb', letterSpacing: '0.08em',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}>{claveActual || '—'}</span>
        <button onClick={() => { setValor(claveActual || ''); setAbierto(true); setMsg('') }}
          style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#888', fontSize: 10, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>
          Cambiar
        </button>
        {msg && <span style={{ fontSize: 10, color: '#10B981' }}>{msg}</span>}
      </div>
    )
  }

  return (
    <div style={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: 10, padding: 12 }}>
      <ClaveLead nombre="" valor={valor} onChange={setValor} leadId={leadId} />
      <div style={{ fontSize: 10, color: '#666', marginTop: 8, lineHeight: 1.5 }}>
        Cambiar la clave refolía las cotizaciones y las compras de este lead. Los folios que ya hayas
        escrito en transferencias o mandado por correo dejan de coincidir.
      </div>
      {msg && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 6 }}>{msg}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={() => guardar(false)} disabled={guardando}
          style={{ background: '#10B981', border: 'none', borderRadius: 7, color: '#06231a', fontSize: 12, fontWeight: 600, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
          {guardando ? 'Guardando...' : 'Cambiar clave'}
        </button>
        <button onClick={() => { setAbierto(false); setMsg('') }}
          style={{ background: 'none', border: '1px solid #333', borderRadius: 7, color: '#888', fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
