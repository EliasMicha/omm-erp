import { useEffect, useState } from 'react'
import { RefreshCw, Send, Trash2, Link2, ClipboardList } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// Reportes diarios de obra por WhatsApp.
// 18:00 el bot pide el reporte a cada persona de la lista según su planeación
// del día; 19:30 insiste; 21:00 manda el resumen de cada obra a su lista y a
// Elias el cierre del día. Esto es el tablero para administrarlo.

interface Emp { id: string; nombre: string | null; area: string | null; puesto: string | null }
interface Persona { employee_id: string; activo: boolean; alias: string | null }
interface Obra { id: string; nombre: string; status: string }
interface Sol { id: string; fecha: string; employee_id: string; obra_id: string | null; obra_texto: string | null; estado: string; ultimo_mensaje_at: string | null; reporte_id: string | null }
interface Rep { id: string; fecha: string; obra_id: string | null; obra_texto: string | null; instalador_id: string | null; texto_raw: string | null; fotos: string[] | null; ai_resumen: string | null; origen: string }
interface Dest { id: string; obra_id: string; employee_id: string | null; telefono: string | null; nombre: string | null }

const card: React.CSSProperties = { background: '#141414', border: '1px solid #252525', borderRadius: 12, padding: 18, marginBottom: 16 }
const input: React.CSSProperties = { background: '#0d0d0d', border: '1px solid #2b2b2b', borderRadius: 8, padding: '7px 9px', color: '#ddd', fontSize: 13, fontFamily: 'inherit' }
const btn: React.CSSProperties = { border: 0, borderRadius: 8, padding: '7px 12px', background: '#25D366', color: '#071b0e', fontWeight: 700, cursor: 'pointer', fontSize: 12.5, display: 'inline-flex', gap: 6, alignItems: 'center' }
const btnGhost: React.CSSProperties = { ...btn, background: '#1d1d1d', color: '#bbb', border: '1px solid #333', fontWeight: 500 }
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', color: '#666', fontSize: 11, fontWeight: 500, borderBottom: '1px solid #222' }
const td: React.CSSProperties = { padding: '7px 8px', color: '#ccc', fontSize: 12.5, borderBottom: '1px solid #1c1c1c', verticalAlign: 'top' }
const h2: React.CSSProperties = { margin: '0 0 4px', color: '#fff', fontSize: 15 }
const sub: React.CSSProperties = { color: '#777', fontSize: 12, marginBottom: 12 }

const ESTADO: Record<string, [string, string]> = {
  pedido: ['Pedido', '#bbb'], insistido: ['Le insistió', '#fbbf24'], recibiendo: ['Reportando', '#60a5fa'],
  aclarando: ['Aclarando obra', '#fbbf24'], no_fue: ['No fue', '#999'], sin_respuesta: ['Sin respuesta', '#f87171'],
  cerrado: ['Reportó', '#57FF9A'], cancelado: ['Cancelado', '#555'],
}

function hoyCDMX() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()) }

async function llamar(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('whatsapp-reportes', { body })
  if (error) {
    let msg = error.message
    try { const ctx = (error as any).context; if (ctx?.json) { const b = await ctx.json(); msg = b.error || msg } } catch (_) { /* nada */ }
    throw new Error(msg)
  }
  return data
}

export default function ReportesObra() {
  const [emps, setEmps] = useState([] as Emp[])
  const [personas, setPersonas] = useState([] as Persona[])
  const [obras, setObras] = useState([] as Obra[])
  const [sols, setSols] = useState([] as Sol[])
  const [reps, setReps] = useState([] as Rep[])
  const [sinObra, setSinObra] = useState([] as Rep[])
  const [dests, setDests] = useState([] as Dest[])
  const [asignadosHoy, setAsignadosHoy] = useState({} as Record<string, string[]>)
  const [nuevo, setNuevo] = useState({ employee_id: '', alias: '' })
  const [obraDest, setObraDest] = useState('')
  const [nuevoDest, setNuevoDest] = useState('')
  const [obraPrueba, setObraPrueba] = useState('')
  const [ligar, setLigar] = useState({} as Record<string, string>)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function cargar() {
    setErr('')
    const hoy = hoyCDMX()
    const desde = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10)
    const [e, p, o, s, r, so, d, a] = await Promise.all([
      supabase.from('employees').select('id, nombre, area, puesto').eq('activo', true).order('nombre'),
      supabase.from('reporte_diario_personas').select('employee_id, activo, alias'),
      supabase.from('obras').select('id, nombre, status').order('nombre'),
      supabase.from('reporte_solicitudes').select('id, fecha, employee_id, obra_id, obra_texto, estado, ultimo_mensaje_at, reporte_id').eq('fecha', hoy).neq('estado', 'cancelado'),
      supabase.from('obra_reportes').select('id, fecha, obra_id, obra_texto, instalador_id, texto_raw, fotos, ai_resumen, origen').eq('fecha', hoy),
      supabase.from('obra_reportes').select('id, fecha, obra_id, obra_texto, instalador_id, texto_raw, fotos, ai_resumen, origen').is('obra_id', null).gte('fecha', desde).order('fecha', { ascending: false }),
      supabase.from('reporte_obra_destinatarios').select('id, obra_id, employee_id, telefono, nombre'),
      supabase.from('installer_daily_assignment').select('employee_id, obras(nombre)').eq('fecha', hoy).not('obra_id', 'is', null),
    ])
    const fallo = [e, p, o, s, r, so, d, a].find((x: any) => x.error)
    if (fallo) setErr((fallo as any).error.message)
    setEmps((e.data || []) as Emp[]); setPersonas((p.data || []) as Persona[]); setObras((o.data || []) as Obra[])
    setSols((s.data || []) as Sol[]); setReps((r.data || []) as Rep[]); setSinObra((so.data || []) as Rep[]); setDests((d.data || []) as Dest[])
    const m: Record<string, string[]> = {}
    for (const x of (a.data || []) as any[]) m[x.employee_id] = [...(m[x.employee_id] || []), x.obras?.nombre || 'obra']
    setAsignadosHoy(m)
  }
  useEffect(() => { cargar() }, [])

  const nombreEmp = (id: string | null) => emps.find(x => x.id === id)?.nombre || '—'
  const nombreObra = (id: string | null) => obras.find(x => x.id === id)?.nombre || ''

  async function agregarPersona() {
    if (!nuevo.employee_id) return
    setErr(''); setMsg('')
    const { error } = await supabase.from('reporte_diario_personas').upsert({ employee_id: nuevo.employee_id, alias: nuevo.alias.trim() || null, activo: true })
    if (error) { setErr(error.message); return }
    setNuevo({ employee_id: '', alias: '' }); cargar()
  }
  async function cambiarPersona(p: Persona, cambios: Partial<Persona>) {
    const { error } = await supabase.from('reporte_diario_personas').update(cambios).eq('employee_id', p.employee_id)
    if (error) setErr(error.message); else cargar()
  }
  async function quitarPersona(p: Persona) {
    const { error } = await supabase.from('reporte_diario_personas').delete().eq('employee_id', p.employee_id)
    if (error) setErr(error.message); else cargar()
  }

  async function agregarDest() {
    if (!obraDest || !nuevoDest) return
    const { error } = await supabase.from('reporte_obra_destinatarios').insert({ obra_id: obraDest, employee_id: nuevoDest })
    if (error) setErr(error.message); else { setNuevoDest(''); cargar() }
  }
  async function quitarDest(d: Dest) {
    const { error } = await supabase.from('reporte_obra_destinatarios').delete().eq('id', d.id)
    if (error) setErr(error.message); else cargar()
  }

  async function ligarReporte(r: Rep) {
    const obraId = ligar[r.id]
    if (!obraId) return
    setErr(''); setMsg('')
    const { error } = await supabase.from('obra_reportes').update({ obra_id: obraId, procesado: false }).eq('id', r.id)
    if (error) { setErr(error.message); return }
    // Que la IA lo lea ya con su obra (resumen, avances, pendientes).
    try { await supabase.functions.invoke('process-obra-report', { body: { reporte_id: r.id } }) } catch (_) { /* se procesa en el resumen */ }
    setMsg(`Reporte ligado a ${nombreObra(obraId)}.`); cargar()
  }

  async function prueba(accion: 'prueba_pedir' | 'prueba_resumen') {
    setErr(''); setMsg(''); setBusy(accion)
    try {
      const r = await llamar({ accion, obra_id: obraPrueba || undefined })
      setMsg(accion === 'prueba_pedir'
        ? (r.pedidos ? 'Te mandé la petición de reporte a tu WhatsApp. Contéstala como si fueras el instalador.' : `No se mandó: ${JSON.stringify(r.detalle?.[0] || r.nota)}`)
        : `Resumen enviado a tu WhatsApp (${r.obras} obra${r.obras === 1 ? '' : 's'}).`)
      cargar()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusy('') }
  }

  const activas = obras.filter(o => o.status !== 'cancelada')
  const enLista = new Set(personas.map(p => p.employee_id))
  const candidatos = [...emps].sort((a, b) => Number(!!asignadosHoy[b.id]) - Number(!!asignadosHoy[a.id]) || String(a.nombre).localeCompare(String(b.nombre)))
    .filter(e => !enLista.has(e.id))
  const destObra = dests.filter(d => d.obra_id === obraDest)
  const repDe = (s: Sol) => reps.find(r => r.id === s.reporte_id)

  return (
    <div>
      {err && <div style={{ padding: '10px 14px', borderRadius: 9, background: '#ef444416', border: '1px solid #ef444444', color: '#f87171', fontSize: 13, marginBottom: 14 }}>{err}</div>}
      {msg && <div style={{ padding: '10px 14px', borderRadius: 9, background: '#10B98116', border: '1px solid #10B98144', color: '#6ee7b7', fontSize: 13, marginBottom: 14 }}>{msg}</div>}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={h2}><ClipboardList size={15} style={{ verticalAlign: -2 }} /> Hoy</h2>
            <div style={sub}>6:00 pm pide · 7:30 pm insiste a quien no contestó · 9:00 pm manda el resumen. Se pide según la planeación diaria.</div>
          </div>
          <button style={btnGhost} onClick={cargar}><RefreshCw size={13} /> Actualizar</button>
        </div>
        {sols.length === 0 ? <div style={{ color: '#666', fontSize: 13 }}>Hoy todavía no se ha pedido ningún reporte.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Persona</th><th style={th}>Obra</th><th style={th}>Estado</th><th style={th}>Lo que mandó</th></tr></thead>
            <tbody>{sols.map(s => {
              const r = repDe(s); const [et, col] = ESTADO[s.estado] || [s.estado, '#bbb']
              return (
                <tr key={s.id}>
                  <td style={td}>{nombreEmp(s.employee_id)}</td>
                  <td style={td}>{nombreObra(s.obra_id) || <span style={{ color: '#fbbf24' }}>{s.obra_texto || 'por aclarar'}</span>}</td>
                  <td style={{ ...td, color: col }}>{et}</td>
                  <td style={{ ...td, color: '#999', maxWidth: 420 }}>
                    {r ? <>{(r.ai_resumen || r.texto_raw || '').slice(0, 220)}{r.fotos?.length ? <span style={{ color: '#60a5fa' }}> · {r.fotos.length} foto{r.fotos.length > 1 ? 's' : ''}</span> : null}</> : '—'}
                  </td>
                </tr>)
            })}</tbody>
          </table>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap', borderTop: '1px solid #222', paddingTop: 12 }}>
          <span style={{ color: '#777', fontSize: 12 }}>Probar en mi número:</span>
          <select style={input} value={obraPrueba} onChange={e => setObraPrueba(e.target.value)}>
            <option value="">— obra —</option>
            {activas.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
          <button style={btnGhost} disabled={!obraPrueba || !!busy} onClick={() => prueba('prueba_pedir')}><Send size={13} /> {busy === 'prueba_pedir' ? 'Mandando…' : 'Pedirme el reporte'}</button>
          <button style={btnGhost} disabled={!!busy} onClick={() => prueba('prueba_resumen')}><Send size={13} /> {busy === 'prueba_resumen' ? 'Armando…' : 'Mandarme el resumen de hoy'}</button>
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>Quién reporta diario</h2>
        <div style={sub}>A estas personas el bot les pide el reporte de la obra donde estén asignadas ese día. Si un día no tienen planeación, no se les pide. "Cómo lo saluda" es el nombre que usa el bot.</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead><tr><th style={th}>Persona</th><th style={th}>Cómo lo saluda</th><th style={th}>Hoy está en</th><th style={th}>Activo</th><th style={th}></th></tr></thead>
          <tbody>
            {personas.length === 0 && <tr><td style={{ ...td, color: '#666' }} colSpan={5}>Nadie todavía.</td></tr>}
            {personas.map(p => (
              <tr key={p.employee_id}>
                <td style={td}>{nombreEmp(p.employee_id)}</td>
                <td style={td}><input style={{ ...input, width: 140 }} defaultValue={p.alias || ''} onBlur={e => { const v = e.target.value.trim(); if (v !== (p.alias || '')) cambiarPersona(p, { alias: v || null }) }} /></td>
                <td style={{ ...td, color: asignadosHoy[p.employee_id] ? '#ccc' : '#666' }}>{asignadosHoy[p.employee_id]?.join(', ') || 'sin planeación'}</td>
                <td style={td}><input type="checkbox" checked={p.activo} onChange={() => cambiarPersona(p, { activo: !p.activo })} /></td>
                <td style={td}><button style={{ ...btnGhost, padding: '4px 8px' }} onClick={() => quitarPersona(p)}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select style={{ ...input, minWidth: 280 }} value={nuevo.employee_id} onChange={e => setNuevo({ ...nuevo, employee_id: e.target.value })}>
            <option value="">— agregar persona —</option>
            {candidatos.map(e => <option key={e.id} value={e.id}>{e.nombre}{asignadosHoy[e.id] ? ' · en obra hoy' : ''}</option>)}
          </select>
          <input style={{ ...input, width: 160 }} placeholder="Cómo lo saluda (Isaac)" value={nuevo.alias} onChange={e => setNuevo({ ...nuevo, alias: e.target.value })} />
          <button style={btn} disabled={!nuevo.employee_id} onClick={agregarPersona}>Agregar</button>
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>A quién le llega el resumen de cada obra</h2>
        <div style={sub}>Si una obra no tiene lista, le llega al coordinador de la obra. Tú recibes siempre un solo "cierre del día" con todas las obras.</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <select style={{ ...input, minWidth: 280 }} value={obraDest} onChange={e => setObraDest(e.target.value)}>
            <option value="">— obra —</option>
            {activas.map(o => <option key={o.id} value={o.id}>{o.nombre}{dests.some(d => d.obra_id === o.id) ? ` (${dests.filter(d => d.obra_id === o.id).length})` : ''}</option>)}
          </select>
        </div>
        {obraDest && <>
          <div style={{ marginBottom: 10 }}>
            {destObra.length === 0 && <span style={{ color: '#666', fontSize: 12.5 }}>Sin lista: le llega al coordinador.</span>}
            {destObra.map(d => (
              <span key={d.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', background: '#1d1d1d', border: '1px solid #333', borderRadius: 999, padding: '3px 6px 3px 10px', marginRight: 6, marginBottom: 6, fontSize: 12, color: '#ccc' }}>
                {d.nombre || nombreEmp(d.employee_id)}
                <button onClick={() => quitarDest(d)} style={{ background: 'none', border: 0, color: '#888', cursor: 'pointer', padding: 0 }}><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select style={{ ...input, minWidth: 280 }} value={nuevoDest} onChange={e => setNuevoDest(e.target.value)}>
              <option value="">— agregar persona —</option>
              {emps.filter(e => !destObra.some(d => d.employee_id === e.id)).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
            <button style={btn} disabled={!nuevoDest} onClick={agregarDest}>Agregar</button>
          </div>
        </>}
      </div>

      <div style={card}>
        <h2 style={h2}>Reportes sin obra</h2>
        <div style={sub}>Reportes de obras que no están en el ERP (o días en bodega, proveedor, etc.). Ligarlos a una obra los manda a su historial y los procesa con la IA.</div>
        {sinObra.length === 0 ? <div style={{ color: '#666', fontSize: 13 }}>Nada pendiente.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Fecha</th><th style={th}>Persona</th><th style={th}>Dijo</th><th style={th}>Reporte</th><th style={th}>Ligar a</th></tr></thead>
            <tbody>{sinObra.map(r => (
              <tr key={r.id}>
                <td style={td}>{r.fecha}</td>
                <td style={td}>{nombreEmp(r.instalador_id)}</td>
                <td style={{ ...td, color: '#fbbf24' }}>{r.obra_texto || '—'}</td>
                <td style={{ ...td, color: '#999', maxWidth: 360 }}>{(r.texto_raw || '').slice(0, 200)}{r.fotos?.length ? ` · ${r.fotos.length} foto(s)` : ''}</td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select style={{ ...input, maxWidth: 220 }} value={ligar[r.id] || ''} onChange={e => setLigar({ ...ligar, [r.id]: e.target.value })}>
                      <option value="">— obra —</option>
                      {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                    </select>
                    <button style={btnGhost} disabled={!ligar[r.id]} onClick={() => ligarReporte(r)}><Link2 size={12} /> Ligar</button>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}
