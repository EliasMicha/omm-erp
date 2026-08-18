// ═══════════════════════════════════════════════════════════════════════════
// SolicitudesObra — la bandeja del almacén dentro de Entregas e Inventario.
//
// Junta TODAS las solicitudes que llegan de la app de obra y, renglón por
// renglón, dice si se puede surtir: cuánto hay apartado en bodega para esa
// obra, cuánto hay en bodega general (de otra obra) y cuánto ya está en la
// obra. Sin ese cruce, la solicitud llegaba pero había que ir a buscar a mano
// si el equipo existía.
//
// Desde aquí se programa la entrega (que es lo que el instalador ve en su
// celular) y se marca como surtida.
// ═══════════════════════════════════════════════════════════════════════════
import { Fragment, useEffect, useState } from 'react'
import {
  Truck, ChevronDown, ChevronRight, AlertTriangle, PackageCheck, Package, Loader2, RefreshCw,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { cargarMaterialesObra, STATUS_SOLICITUD, type RenglonMaterial } from '../lib/materialesObra'

const card: React.CSSProperties = {
  background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 12, padding: 14, marginBottom: 12,
}
const inp: React.CSSProperties = {
  padding: '6px 9px', fontSize: 12, background: '#0a0a0a', border: '1px solid #333',
  borderRadius: 7, color: '#fff', fontFamily: 'inherit',
}
const btn = (color: string): React.CSSProperties => ({
  padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
  borderRadius: 8, border: `1px solid ${color}55`, background: `${color}18`, color,
})

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color, background: color + '18',
      border: `1px solid ${color}44`, padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

interface Solicitud {
  id: string; folio: string | null; fecha: string; status: string
  solicitante_nombre: string | null; requerido_para: string | null; notas: string | null
  delivery_id: string | null; obra_id: string
  obra?: { id: string; nombre: string; quotation_id: string | null; quotation_ids: string[] | null; project_id: string | null }
  obra_material_solicitud_items: any[]
}

export default function SolicitudesObra({ isMobile }: { isMobile?: boolean }) {
  const [sols, setSols] = useState<Solicitud[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState<'abiertas' | 'todas'>('abiertas')
  const [error, setError] = useState('')

  async function cargar() {
    setCargando(true); setError('')
    const { data, error: e } = await supabase.from('obra_material_solicitudes')
      .select('id,folio,fecha,status,solicitante_nombre,requerido_para,notas,delivery_id,obra_id,obras(id,nombre,quotation_id,quotation_ids,project_id),obra_material_solicitud_items(id,clave,descripcion,marca,modelo,unidad,sistema,cantidad,cantidad_surtida,es_extra)')
      .order('created_at', { ascending: false }).limit(200)
    if (e) setError(e.message)
    setSols(((data || []) as any[]).map(s => ({ ...s, obra: s.obras })) as Solicitud[])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const visibles = filtro === 'abiertas'
    ? sols.filter(s => ['solicitada', 'aprobada', 'surtida_parcial'].includes(s.status))
    : sols

  const abiertas = sols.filter(s => ['solicitada', 'aprobada', 'surtida_parcial'].includes(s.status)).length
  const sinProgramar = sols.filter(s => s.status === 'solicitada' && !s.delivery_id).length
  const conExtras = sols.filter(s => (s.obra_material_solicitud_items || []).some((i: any) => i.es_extra)).length

  if (cargando) return <div style={{ padding: 30, textAlign: 'center' }}><Loader2 size={22} /></div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          {[
            { n: abiertas, t: 'Solicitudes abiertas', c: '#A78BFA' },
            { n: sinProgramar, t: 'Sin programar entrega', c: sinProgramar > 0 ? '#DC2626' : '#10B981' },
            { n: conExtras, t: 'Con extras por cotizar', c: conExtras > 0 ? '#D97706' : '#666' },
          ].map(k => (
            <div key={k.t} style={{ ...card, marginBottom: 0, minWidth: 150, flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: k.c }}>{k.n}</div>
              <div style={{ fontSize: 11, color: '#777' }}>{k.t}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={filtro} onChange={e => setFiltro(e.target.value as any)} style={inp}>
            <option value="abiertas">Solo abiertas</option>
            <option value="todas">Todas</option>
          </select>
          <button onClick={cargar} style={btn('#888')}><RefreshCw size={12} /> Actualizar</button>
        </div>
      </div>

      {error && (
        <div style={{ ...card, borderColor: '#5a2828', color: '#f87171', fontSize: 12 }}>⚠ {error}</div>
      )}

      {visibles.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: '#666', fontSize: 13 }}>
          <Package size={30} style={{ opacity: 0.3, marginBottom: 10 }} />
          <div>{filtro === 'abiertas' ? 'No hay solicitudes abiertas de obra.' : 'Todavía no llega ninguna solicitud desde la app de obra.'}</div>
        </div>
      ) : visibles.map(s => (
        <SolicitudCard key={s.id} sol={s} isMobile={isMobile} onCambio={cargar} />
      ))}
    </div>
  )
}

/* ── Una solicitud, con el cruce contra inventario de su obra ── */
function SolicitudCard({ sol, isMobile, onCambio }: { sol: Solicitud; isMobile?: boolean; onCambio: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [mat, setMat] = useState<Map<string, RenglonMaterial> | null>(null)
  const [cargandoMat, setCargandoMat] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [fecha, setFecha] = useState(sol.requerido_para || '')
  const [hora, setHora] = useState('10:00')

  const st = STATUS_SOLICITUD[sol.status] || { label: sol.status, color: '#666' }
  const items: any[] = sol.obra_material_solicitud_items || []
  const pedido = items.reduce((a, i) => a + Number(i.cantidad || 0), 0)
  const surtido = items.reduce((a, i) => a + Number(i.cantidad_surtida || 0), 0)
  const extras = items.filter(i => i.es_extra)

  // El inventario se carga solo al abrir: son varias queries por obra y no
  // vale la pena pagarlas por cada solicitud de la lista.
  useEffect(() => {
    if (!abierto || mat || !sol.obra) return
    setCargandoMat(true)
    cargarMaterialesObra({
      id: sol.obra.id,
      cotizacion_id: sol.obra.quotation_id,
      quotation_ids: sol.obra.quotation_ids,
      project_id: sol.obra.project_id,
    }).then(d => {
      const m = new Map<string, RenglonMaterial>()
      d.renglones.forEach(r => m.set(r.clave, r))
      setMat(m)
      setCargandoMat(false)
    }).catch(() => setCargandoMat(false))
  }, [abierto, mat, sol.obra])

  // Semáforo de surtido por renglón.
  function disponibilidad(i: any) {
    const r = mat?.get(i.clave)
    const falta = Number(i.cantidad || 0) - Number(i.cantidad_surtida || 0)
    if (i.es_extra) return { label: 'Extra — no está cotizado', color: '#D97706', detalle: 'Va al adendum de Compras' }
    if (!r) return { label: 'Sin dato de inventario', color: '#6B7280', detalle: '' }
    if (r.enBodega >= falta && falta > 0) return { label: `Sí hay — ${r.enBodega} en bodega`, color: '#10B981', detalle: 'Apartado para esta obra' }
    if (r.enBodega > 0) return { label: `Alcanza para ${r.enBodega} de ${falta}`, color: '#D97706', detalle: 'Surtido parcial' }
    if (r.enBodegaGeneral > 0) return { label: `${r.enBodegaGeneral} en bodega general`, color: '#2563EB', detalle: 'Es de otra obra' }
    if (r.pedido > r.recibido) return { label: 'Comprado, no ha llegado', color: '#A78BFA', detalle: `Pedido ${r.pedido}, recibido ${r.recibido}` }
    if (r.enBorrador > 0) return { label: 'OC en borrador', color: '#DC2626', detalle: `Hay ${r.enBorrador} en una orden sin mandar al proveedor` }
    return { label: 'No hay — falta comprarlo', color: '#DC2626', detalle: '' }
  }

  const surtibles = mat ? items.filter(i => {
    const d = disponibilidad(i)
    return d.color === '#10B981'
  }).length : null

  async function programar() {
    if (!fecha) { setErr('Pon la fecha de entrega.'); return }
    setBusy('prog'); setErr('')
    try {
      const { data: d, error: e1 } = await supabase.from('deliveries').insert({
        obra_id: sol.obra_id,
        solicitud_id: sol.id,
        delivery_date: fecha,
        scheduled_time: hora || null,
        type: 'entrega',
        status: 'pendiente',
        origin: 'Bodega OMM',
        destination: sol.obra?.nombre || 'Obra',
        folio: sol.folio ? `ENT-${sol.folio}` : null,
        material_description: items.map(i => `${i.cantidad} ${i.unidad || 'pza'} ${i.descripcion}`).join(' | ').substring(0, 900),
        notes: sol.notas || null,
      }).select().single()
      if (e1) throw e1
      const { error: e2 } = await supabase.from('delivery_items').insert(items.map(i => ({
        delivery_id: d.id, obra_id: sol.obra_id, description: i.descripcion,
        qty: Number(i.cantidad) || 0, unit: i.unidad || 'pza', direction: 'out_bodega_to_obra',
      })))
      if (e2) throw e2
      await supabase.from('obra_material_solicitudes')
        .update({ status: 'aprobada', delivery_id: d.id, revisado_at: new Date().toISOString() }).eq('id', sol.id)
      onCambio()
    } catch (e: any) { setErr(e?.message || String(e)) }
    setBusy('')
  }

  async function marcarSurtida() {
    setBusy('surt'); setErr('')
    try {
      for (const i of items) {
        await supabase.from('obra_material_solicitud_items').update({ cantidad_surtida: i.cantidad }).eq('id', i.id)
      }
      await supabase.from('obra_material_solicitudes')
        .update({ status: 'surtida', revisado_at: new Date().toISOString() }).eq('id', sol.id)
      onCambio()
    } catch (e: any) { setErr(e?.message || String(e)) }
    setBusy('')
  }

  async function cambiar(status: string) {
    setBusy(status); setErr('')
    const { error } = await supabase.from('obra_material_solicitudes')
      .update({ status, revisado_at: new Date().toISOString() }).eq('id', sol.id)
    setBusy('')
    if (error) setErr(error.message); else onCambio()
  }

  return (
    <div style={card}>
      <div onClick={() => setAbierto(v => !v)} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }}>
        {abierto ? <ChevronDown size={14} color="#666" /> : <ChevronRight size={14} color="#666" />}
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{sol.folio || 'Sin folio'}</span>
        <Pill label={st.label} color={st.color} />
        <span style={{ fontSize: 12, color: '#aaa', flex: 1, minWidth: 140 }}>{sol.obra?.nombre || 'Obra sin nombre'}</span>
        <span style={{ fontSize: 11, color: '#666' }}>{sol.fecha} · {sol.solicitante_nombre || 'Obra'}</span>
        <span style={{ fontSize: 11, color: '#888' }}>{items.length} renglones · {surtido}/{pedido}</span>
        {extras.length > 0 && <Pill label={`${extras.length} extra${extras.length > 1 ? 's' : ''}`} color="#D97706" />}
        {sol.requerido_para && <Pill label={`para ${sol.requerido_para}`} color="#D97706" />}
        {sol.delivery_id && <Pill label="Entrega programada" color="#2563EB" />}
      </div>

      {abierto && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1f1f1f' }}>
          {sol.notas && <div style={{ fontSize: 12, color: '#999', fontStyle: 'italic', marginBottom: 10 }}>«{sol.notas}»</div>}

          {cargandoMat && <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}><Loader2 size={11} /> Revisando inventario de la obra…</div>}
          {mat && (
            <div style={{ fontSize: 11, color: surtibles === items.length ? '#4ADE80' : '#D97706', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <PackageCheck size={13} />
              {surtibles === items.length
                ? 'Todo lo que piden está en bodega: se puede surtir completo.'
                : `${surtibles} de ${items.length} renglones se pueden surtir hoy con lo que hay en bodega.`}
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? 520 : undefined }}>
              <thead>
                <tr>
                  {['Producto', 'Piden', 'En bodega', 'Ya en obra', '¿Se puede surtir?'].map((h, i) => (
                    <th key={h} style={{
                      textAlign: i === 0 || i === 4 ? 'left' : 'center', fontSize: 9, color: '#555',
                      fontWeight: 600, padding: '5px 6px', textTransform: 'uppercase', letterSpacing: '.06em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(i => {
                  const r = mat?.get(i.clave)
                  const d = disponibilidad(i)
                  return (
                    <Fragment key={i.id}>
                      <tr style={{ borderTop: '1px solid #191919' }}>
                        <td style={{ fontSize: 12, color: '#ddd', padding: '7px 6px' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, color: '#fff' }}>{i.modelo || i.marca || '—'}</span>
                            {i.marca && i.modelo && <span style={{ fontSize: 11, color: '#999' }}>{i.marca}</span>}
                            {i.sistema && <Pill label={i.sistema} color="#4ADE80" />}
                          </div>
                          <div style={{ fontSize: 10, color: '#666', lineHeight: 1.35 }}>{i.descripcion}</div>
                        </td>
                        <td style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#fff', padding: '7px 6px' }}>
                          {i.cantidad} <span style={{ fontSize: 10, color: '#666' }}>{i.unidad}</span>
                        </td>
                        <td style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: (r?.enBodega || 0) > 0 ? '#4ADE80' : '#444', padding: '7px 6px' }}>
                          {r ? r.enBodega : '—'}
                        </td>
                        <td style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: (r?.recibido || 0) > 0 ? '#60A5FA' : '#444', padding: '7px 6px' }}>
                          {r ? r.recibido : '—'}
                        </td>
                        <td style={{ padding: '7px 6px' }}>
                          <Pill label={d.label} color={d.color} />
                          {d.detalle && <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{d.detalle}</div>}
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {extras.length > 0 && (
            <div style={{ fontSize: 11, color: '#D97706', marginTop: 10 }}>
              Los {extras.length} extras ya están en la bandeja de «Extras / Adendum» de la obra, listos para cotizar y mandar a Compras.
            </div>
          )}

          {!['surtida', 'rechazada', 'cancelada'].includes(sol.status) && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
              {!sol.delivery_id && (
                <>
                  <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} title="Fecha de entrega en obra" />
                  <input type="time" value={hora} onChange={e => setHora(e.target.value)} style={inp} title="Hora estimada" />
                  <button disabled={!!busy} onClick={programar} style={btn('#10B981')}>
                    <Truck size={12} /> {busy === 'prog' ? 'Programando…' : 'Programar entrega'}
                  </button>
                </>
              )}
              {sol.delivery_id && <Pill label="El instalador ya ve la fecha en su celular" color="#2563EB" />}
              <button disabled={!!busy} onClick={marcarSurtida} style={btn('#2563EB')}>
                {busy === 'surt' ? 'Guardando…' : 'Marcar surtida'}
              </button>
              <button disabled={!!busy} onClick={() => cambiar('rechazada')} style={btn('#888')}>Rechazar</button>
            </div>
          )}
          {err && <div style={{ fontSize: 11, color: '#f87171', marginTop: 8 }}><AlertTriangle size={11} /> {err}</div>}
        </div>
      )}
    </div>
  )
}
