// Fechas por fase.
//
// La idea de Elias: una obra tiene 4 fases (cableado, instalacion,
// programacion, detallado) y las fechas se ponen POR FASE, no tarea por tarea.
// Las fases corren globales, pero un area puede llevar su propio rango encima
// — la recamara se instala cuando SU plafon quedo, no cuando quedo el de la
// cocina.
//
// Nada se escribe sin ensenar antes cuantas tareas cambian de fecha: aplicar a
// ciegas sobre 176 renglones es como no tener el boton.
import React, { useState, useMemo, useEffect } from 'react'
import { Btn, Loading } from './layout/UI'
import {
  FASES, FASE_CFG, FaseKey, RangoFase, esFase,
  cargarRangos, guardarRango, calcularFechas, aplicarFechas,
  clasificarPendientes,
} from '../lib/fases'
import { Sparkles, X, Plus, Trash2, Calendar, AlertTriangle } from 'lucide-react'

const card: React.CSSProperties = { background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14 }
const inp: React.CSSProperties = {
  background: '#0a0a0a', color: '#ddd', border: '1px solid #2a2a2a', borderRadius: 6,
  padding: '4px 7px', fontSize: 11, fontFamily: 'inherit', outline: 'none', colorScheme: 'dark',
}

interface ActLike {
  id: string; descripcion: string; area?: string; fase?: FaseKey | null
  fecha_inicio?: string; fecha_fin_plan?: string
}

export default function FasesObra({ obra, onCerrar, onCambio }: {
  obra: { id: string; nombre: string; actividades: ActLike[] }
  onCerrar: () => void
  onCambio: () => void | Promise<void>
}) {
  const [rangos, setRangos] = useState<RangoFase[]>([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState('')
  // Por defecto el rango de la fase MANDA. Antes venia protegido y como
  // todas las tareas ya traian fecha compromiso, no cambiaba nada nunca.
  const [respetar, setRespetar] = useState(false)
  const [nuevaArea, setNuevaArea] = useState<Record<string, string>>({})

  const cargar = async () => {
    try { setRangos(await cargarRangos(obra.id)) } catch (e: any) { setMsg(e?.message || String(e)) }
    setCargando(false)
  }
  useEffect(() => { cargar() }, [obra.id])

  const acts = obra.actividades || []
  const areas = useMemo(
    () => Array.from(new Set(acts.map(a => a.area).filter(Boolean))).sort() as string[],
    [acts])

  const porFase = useMemo(() => {
    const m: Record<string, ActLike[]> = { cableado: [], instalacion: [], programacion: [], detallado: [], _sin: [] }
    for (const a of acts) m[a.fase && esFase(a.fase) ? a.fase : '_sin'].push(a)
    return m
  }, [acts])

  const sinFase = porFase._sin.length

  // Cuantas tareas cambiarian de fecha con los rangos de ahorita.
  const resumen = useMemo(
    () => calcularFechas(acts as any, rangos, respetar),
    [acts, rangos, respetar])
  const cambios = resumen.cambios

  const get = (fase: FaseKey, area: string | null): RangoFase =>
    rangos.find(r => r.fase === fase && (r.area || null) === area)
    || { fase, area, fecha_inicio: null, fecha_fin: null }

  const setCampo = (fase: FaseKey, area: string | null, campo: 'fecha_inicio' | 'fecha_fin', v: string) => {
    setRangos(prev => {
      const i = prev.findIndex(r => r.fase === fase && (r.area || null) === area)
      const base = i >= 0 ? prev[i] : { fase, area, fecha_inicio: null, fecha_fin: null }
      const upd = { ...base, [campo]: v || null }
      const out = i >= 0 ? prev.map((r, k) => k === i ? upd : r) : [...prev, upd]
      return out
    })
  }

  const guardarTodo = async () => {
    setGuardando(true); setMsg('')
    try {
      for (const r of rangos) await guardarRango(obra.id, r)
      const n = await aplicarFechas(cambios)
      await onCambio()
      await cargar()
      setMsg(n > 0
        ? `Listo: ${n} tarea(s) tomaron las fechas de su fase.`
        : respetar && resumen.respetadas > 0
          ? `Los rangos quedaron guardados, pero ninguna tarea cambió: ${resumen.respetadas} tienen fecha propia y la casilla "no pisar" las protegió. Desmárcala y vuelve a aplicar.`
          : 'Los rangos quedaron guardados. Ninguna tarea necesitaba cambio de fecha.')
    } catch (e: any) { setMsg('Error: ' + (e?.message || String(e))) }
    setGuardando(false)
  }

  const clasificar = async () => {
    setGuardando(true); setMsg('')
    try {
      const asignadas = await clasificarPendientes(
        acts.map(a => ({ id: a.id, descripcion: a.descripcion, fase: a.fase })))
      const n = Object.keys(asignadas).length
      await onCambio()
      setMsg(n > 0
        ? `${n} tarea(s) quedaron clasificadas. Revisa que la fase sea la correcta antes de poner fechas.`
        : 'No pude deducir la fase de ninguna tarea pendiente. Asignalas a mano en la lista.')
    } catch (e: any) { setMsg('Error: ' + (e?.message || String(e))) }
    setGuardando(false)
  }

  const quitarExcepcion = async (fase: FaseKey, area: string) => {
    setRangos(prev => prev.filter(r => !(r.fase === fase && r.area === area)))
    try { await guardarRango(obra.id, { fase, area, fecha_inicio: null, fecha_fin: null }) } catch { /* ya no estaba */ }
  }

  if (cargando) return <div style={{ padding: 24 }}><Loading /></div>

  const filaFechas = (fase: FaseKey, area: string | null) => {
    const r = get(fase, area)
    const mal = !!(r.fecha_inicio && r.fecha_fin && r.fecha_fin < r.fecha_inicio)
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <input type="date" value={r.fecha_inicio || ''} style={inp}
          onChange={e => setCampo(fase, area, 'fecha_inicio', e.target.value)} />
        <span style={{ color: '#444' }}>→</span>
        <input type="date" value={r.fecha_fin || ''}
          style={{ ...inp, borderColor: mal ? '#DC2626' : '#2a2a2a' }}
          onChange={e => setCampo(fase, area, 'fecha_fin', e.target.value)} />
        {mal && <span style={{ fontSize: 10, color: '#DC2626' }}>fin antes del inicio</span>}
      </span>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Fechas por fase</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {sinFase > 0 && (
            <Btn size="sm" onClick={clasificar} disabled={guardando}>
              <Sparkles size={12} /> Clasificar {sinFase} sin fase
            </Btn>
          )}
          <Btn size="sm" variant="primary" onClick={guardarTodo} disabled={guardando}>
            <Calendar size={12} /> {guardando ? 'Aplicando…' : `Guardar y aplicar (${cambios.length})`}
          </Btn>
          <Btn size="sm" onClick={onCerrar}><X size={12} /> Cerrar</Btn>
        </div>
      </div>

      {msg && <div style={{ ...card, marginBottom: 10, fontSize: 11.5, color: '#aaa', padding: '8px 12px' }}>{msg}</div>}

      <div style={{ ...card, marginBottom: 12, borderColor: '#1d2a1f', background: '#0c110d' }}>
        <div style={{ fontSize: 11.5, color: '#8FBF9F', lineHeight: 1.7 }}>
          Las fechas se ponen por fase y todas las tareas de esa fase las toman.
          Si un area va en otro tiempo, agregale una excepcion abajo de su fase:
          esa gana sobre la global. Nada se escribe hasta que le des Guardar y aplicar.
        </div>
      </div>

      {sinFase > 0 && (
        <div style={{ ...card, marginBottom: 12, borderColor: '#3a2f15', background: '#161208' }}>
          <div style={{ fontSize: 11.5, color: '#D9A441', display: 'flex', gap: 6, alignItems: 'center' }}>
            <AlertTriangle size={13} />
            {sinFase} tarea(s) no tienen fase, asi que ningun rango las va a alcanzar.
          </div>
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#888', marginBottom: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={respetar} onChange={e => setRespetar(e.target.checked)}
          style={{ accentColor: '#10B981' }} />
        No pisar fechas capturadas a mano — solo rellenar las que faltan
      </label>

      {/* El desglose evita el caso de "le di aplicar y no paso nada". */}
      <div style={{ ...card, marginBottom: 12, padding: '9px 12px', fontSize: 11.5, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ color: cambios.length ? '#10B981' : '#666', fontWeight: cambios.length ? 600 : 400 }}>
          {cambios.length} cambian de fecha
        </span>
        {resumen.yaIguales > 0 && <span style={{ color: '#666' }}>{resumen.yaIguales} ya tienen esa fecha</span>}
        {resumen.respetadas > 0 && (
          <span style={{ color: '#D9A441' }}>
            {resumen.respetadas} protegidas por la casilla de arriba
          </span>
        )}
        {resumen.sinRango > 0 && <span style={{ color: '#666' }}>{resumen.sinRango} sin rango en su fase</span>}
        {resumen.sinFase > 0 && <span style={{ color: '#D97706' }}>{resumen.sinFase} sin fase</span>}
      </div>

      {cambios.length === 0 && (resumen.respetadas > 0 || resumen.sinRango > 0 || sinFase > 0) && (
        <div style={{ ...card, marginBottom: 12, borderColor: '#3a2f15', background: '#161208' }}>
          <div style={{ fontSize: 11.5, color: '#D9A441', lineHeight: 1.7 }}>
            <b>Nada va a cambiar.</b>{' '}
            {resumen.respetadas > 0 && <>Hay {resumen.respetadas} tarea(s) con fecha propia y la casilla de arriba las está protegiendo: desmárcala para que el rango de la fase mande. </>}
            {resumen.sinRango > 0 && <>Hay {resumen.sinRango} tarea(s) cuya fase todavía no tiene rango. </>}
            {sinFase > 0 && <>Hay {sinFase} sin fase. </>}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {FASES.map(f => {
          const tareas = porFase[f.key] || []
          const excepciones = rangos.filter(r => r.fase === f.key && r.area)
          const areasDeLaFase = Array.from(new Set(tareas.map(t => t.area).filter(Boolean))).sort() as string[]
          const libres = areasDeLaFase.filter(a => !excepciones.some(e => e.area === a))
          const afectadas = cambios.filter(c => tareas.some(t => t.id === c.id)).length
          return (
            <div key={f.key} style={{ ...card, borderLeft: `3px solid ${f.color}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: f.color }}>{f.label}</span>
                <span style={{ fontSize: 11, color: '#666' }}>{tareas.length} tarea(s)</span>
                {afectadas > 0 && <span style={{ fontSize: 10.5, color: '#10B981' }}>{afectadas} cambian de fecha</span>}
                <span style={{ marginLeft: 'auto' }}>{filaFechas(f.key, null)}</span>
              </div>
              <div style={{ fontSize: 10.5, color: '#555', marginBottom: excepciones.length || libres.length ? 8 : 0 }}>{f.ayuda}</div>

              {excepciones.map(e => {
                const n = tareas.filter(t => t.area === e.area).length
                return (
                  <div key={e.area} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0 5px 12px', borderTop: '1px solid #1a1a1a', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#bbb' }}>📍 {e.area}</span>
                    <span style={{ fontSize: 10, color: '#555' }}>{n} tarea(s)</span>
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {filaFechas(f.key, e.area as string)}
                      <button title="Quitar excepcion" onClick={() => quitarExcepcion(f.key, e.area as string)}
                        style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 2 }}>
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                )
              })}

              {libres.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 8, borderTop: excepciones.length ? '1px solid #1a1a1a' : 'none' }}>
                  <Plus size={11} color="#555" />
                  <select value={nuevaArea[f.key] || ''} style={{ ...inp, maxWidth: 220 }}
                    onChange={e => {
                      const a = e.target.value
                      setNuevaArea(p => ({ ...p, [f.key]: '' }))
                      if (a) setCampo(f.key, a, 'fecha_inicio', '')
                      if (a) setRangos(prev => prev.some(r => r.fase === f.key && r.area === a)
                        ? prev : [...prev, { fase: f.key, area: a, fecha_inicio: null, fecha_fin: null }])
                    }}>
                    <option value="">Agregar excepcion por area…</option>
                    {libres.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {porFase._sin.length > 0 && (
        <div style={{ ...card, marginTop: 10, borderLeft: '3px solid #444' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#888', marginBottom: 4 }}>Sin fase</div>
          <div style={{ fontSize: 10.5, color: '#555' }}>
            {porFase._sin.length} tarea(s). Usa "Clasificar sin fase" o asignalas en la lista de actividades.
          </div>
        </div>
      )}
    </div>
  )
}
