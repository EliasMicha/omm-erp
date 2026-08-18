// ═══════════════════════════════════════════════════════════════════════════
// MaterialesObra — la pestaña "Materiales" de la ficha de obra.
//
// Tres vistas sobre los mismos datos (motor en src/lib/materialesObra.ts):
//   GENERAL  — un renglón por producto con la suma de TODAS las áreas. Es la
//              vista principal: dice cuánto se cotizó, cuánto se pidió, cuánto
//              pidió la obra y cuánto llegó, con el detalle de quién y cuándo.
//   POR ÁREA — el mismo catálogo desglosado por área, con filtro de área.
//   POR SISTEMA — desglosado por sistema, con filtro de sistema.
//
// El material que llegó a la obra pero no tiene renglón en la cotización sale
// en un bloque aparte ("fuera de catálogo"), no se fusiona por parecido.
// ═══════════════════════════════════════════════════════════════════════════
import { Fragment, useEffect, useState } from 'react'
import { AlertTriangle, Package, Search, ChevronDown, ChevronRight, Truck, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Badge, Btn, EmptyState, KpiCard, Loading } from './layout/UI'
import {
  cargarMaterialesObra, ETAPA_CFG, STATUS_SOLICITUD,
  type MaterialesObra as MatData, type RenglonMaterial, type EtapaMaterial,
} from '../lib/materialesObra'

type Vista = 'general' | 'area' | 'sistema'

const card: React.CSSProperties = {
  background: '#141414', border: '1px solid #222', borderRadius: 10, padding: 16, marginBottom: 12,
}
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 9, color: '#555', fontWeight: 600, padding: '5px 6px',
  textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
}
const thNum: React.CSSProperties = { ...th, textAlign: 'center', width: 76 }
const tdNum: React.CSSProperties = {
  textAlign: 'center', fontSize: 12, fontWeight: 600, padding: '6px', fontVariantNumeric: 'tabular-nums',
}

export interface ObraParaMateriales {
  id: string
  nombre?: string
  cotizacion_id?: string | null
  quotation_ids?: string[] | null
  project_id?: string | null
}

export default function MaterialesObra({ obra, onLinked }: {
  obra: ObraParaMateriales
  onLinked?: (cotId: string) => void
}) {
  const [data, setData] = useState<MatData | null>(null)
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState<Vista>('general')
  const [fArea, setFArea] = useState('')
  const [fSistema, setFSistema] = useState('')
  const [fEtapa, setFEtapa] = useState<'' | EtapaMaterial>('')
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState<Record<string, boolean>>({})
  const [cots, setCots] = useState<Array<{ id: string; name: string; specialty: string }>>([])
  const [ligando, setLigando] = useState(false)
  const [solicitudes, setSolicitudes] = useState<any[]>([])

  const [nonce, setNonce] = useState(0)
  const recargar = () => setNonce(n => n + 1)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    Promise.all([
      cargarMaterialesObra(obra),
      supabase.from('obra_material_solicitudes')
        .select('id,folio,fecha,status,solicitante_nombre,requerido_para,notas,delivery_id,obra_material_solicitud_items(id,descripcion,cantidad,cantidad_surtida,es_extra,unidad,marca,modelo,sistema)')
        .eq('obra_id', obra.id).order('created_at', { ascending: false }),
    ]).then(([d, sols]) => {
      if (cancel) return
      setData(d)
      setSolicitudes(((sols as any).data || []) as any[])
      setLoading(false)
      if (d.sinCotizacion) {
        supabase.from('quotations').select('id,name,specialty').order('updated_at', { ascending: false }).limit(200)
          .then(({ data: q }) => { if (!cancel) setCots((q || []) as any[]) })
      }
    })
    return () => { cancel = true }
  }, [obra.id, obra.cotizacion_id, obra.project_id, nonce])

  if (loading) return <Loading />
  if (!data) return <EmptyState message="No se pudieron cargar los materiales" />

  // ── Sin cotización: ofrecer ligarla ──
  if (data.sinCotizacion) {
    return (
      <div style={{ padding: 20, background: '#2a1414', border: '1px solid #3a2020', borderRadius: 10, fontSize: 13 }}>
        <div style={{ color: '#f87171', marginBottom: 12 }}>
          <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Esta obra no tiene cotización vinculada, así que no hay catálogo de materiales que mostrar.
        </div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Selecciona la cotización de esta obra:</div>
        <select disabled={ligando} onChange={async e => {
          const cotId = e.target.value
          if (!cotId) return
          setLigando(true)
          await supabase.from('obras').update({ quotation_id: cotId }).eq('id', obra.id)
          onLinked?.(cotId)
          setLigando(false)
        }} style={{ width: '100%', padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 12, fontFamily: 'inherit' }}>
          <option value="">— Seleccionar cotización —</option>
          {cots.map(c => <option key={c.id} value={c.id}>{c.name} ({(c.specialty || '').toUpperCase()})</option>)}
        </select>
      </div>
    )
  }

  const { renglones, areas, sistemas } = data
  if (renglones.length === 0) return <EmptyState message="Esta cotización no tiene materiales registrados" />

  // ── Filtros comunes ──
  const q = busqueda.trim().toLowerCase()
  const pasa = (r: RenglonMaterial) => {
    if (fEtapa && r.etapa !== fEtapa) return false
    if (q && !(`${r.descripcion} ${r.marca} ${r.modelo}`.toLowerCase().includes(q))) return false
    if (vista === 'sistema' && fSistema && r.sistema !== fSistema) return false
    if (vista === 'area' && fArea && !(r.porArea[fArea] > 0)) return false
    return true
  }
  const visibles = renglones.filter(pasa)
  const enCatalogo = visibles.filter(r => !r.fueraDeCatalogo)
  const fuera = visibles.filter(r => r.fueraDeCatalogo)

  // ── KPIs sobre todo el catálogo (no sobre el filtro) ──
  const cat = renglones.filter(r => !r.fueraDeCatalogo)
  const kpi = {
    productos: cat.length,
    completos: cat.filter(r => r.etapa === 'completo').length,
    porPedir: cat.filter(r => r.etapa === 'falta_pedir').length,
    enObra: cat.filter(r => r.recibido > 0).length,
    solicitadas: solicitudes.filter(s => ['solicitada', 'aprobada', 'surtida_parcial'].includes(s.status)).length,
  }

  const toggle = (k: string) => setAbierto(a => ({ ...a, [k]: !a[k] }))

  // ── Tabla reutilizable ──
  function Tabla({ filas, cantidadDe }: { filas: RenglonMaterial[]; cantidadDe?: (r: RenglonMaterial) => number }) {
    if (filas.length === 0) return <div style={{ fontSize: 11, color: '#555', padding: '8px 6px' }}>Nada que mostrar con estos filtros.</div>
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Producto</th>
            <th style={{ ...th, width: 110 }}>Sistema</th>
            <th style={{ ...thNum, color: '#aaa' }}>Cotizado</th>
            <th style={{ ...thNum, color: '#FBBF24' }}>Pedido</th>
            <th style={{ ...thNum, color: '#4ADE80' }}>En bodega</th>
            <th style={{ ...thNum, color: '#A78BFA' }}>Solicitado</th>
            <th style={{ ...thNum, color: '#60A5FA' }}>Recibido</th>
            <th style={{ ...th, width: 140 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(r => {
            const cot = cantidadDe ? cantidadDe(r) : r.cotizado
            const cfg = ETAPA_CFG[r.etapa]
            const ab = !!abierto[r.clave]
            return (
              <Fragment key={r.clave}>
                <tr onClick={() => toggle(r.clave)} style={{ borderTop: '1px solid #191919', cursor: 'pointer' }}>
                  <td style={{ fontSize: 12, color: '#ddd', padding: '6px' }}>
                    {/* Marca y modelo primero: es como se identifica el equipo
                        en la caja y en la OC. La descripción va debajo. */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                      {ab ? <ChevronDown size={11} color="#555" /> : <ChevronRight size={11} color="#555" />}
                      <span style={{ fontWeight: 700, color: '#fff' }}>{r.modelo || r.marca || '—'}</span>
                      {r.marca && r.modelo && <span style={{ fontSize: 11, color: '#999' }}>{r.marca}</span>}
                    </div>
                    <div style={{ fontSize: 10, color: '#666', marginLeft: 16, lineHeight: 1.35 }}>
                      {r.descripcion}
                      {r.areas.length > 1 && <span style={{ color: '#555' }}> · en {r.areas.length} áreas</span>}
                    </div>
                    {r.fueraDeCatalogo && r.parecidoA && (
                      <div style={{ fontSize: 10, color: '#D97706', marginLeft: 16, marginTop: 2 }}>
                        ¿Es el mismo que «{r.parecidoA}»? Se recibió con otro nombre.
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: '#888', padding: '6px' }}>{r.sistema}</td>
                  <td style={{ ...tdNum, color: '#fff' }}>{cot || '—'}</td>
                  <td style={{ ...tdNum, color: r.pedido ? '#FBBF24' : '#3a3a3a' }}
                    title={r.enBorrador ? `${r.enBorrador} más en OC de borrador (sin mandar al proveedor)` : undefined}>
                    {r.pedido || '—'}{r.enBorrador ? <span style={{ fontSize: 9, color: '#DC2626' }}> +{r.enBorrador}b</span> : null}
                  </td>
                  <td style={{ ...tdNum, color: r.enBodega ? '#4ADE80' : '#3a3a3a' }}
                    title={r.enBodegaGeneral ? `${r.enBodegaGeneral} más en bodega general (de otra obra)` : undefined}>
                    {r.enBodega || '—'}{r.enBodegaGeneral ? <span style={{ fontSize: 9, color: '#666' }}> ({r.enBodegaGeneral})</span> : null}
                  </td>
                  <td style={{ ...tdNum, color: r.solicitado ? '#A78BFA' : '#3a3a3a' }}>{r.solicitado || '—'}</td>
                  <td style={{ ...tdNum, color: r.recibido ? '#60A5FA' : '#3a3a3a' }}>{r.recibido || '—'}</td>
                  <td style={{ padding: '6px' }}><Badge label={cfg.label} color={cfg.color} /></td>
                </tr>
                {ab && (
                  <tr style={{ background: '#0d0d0d' }}>
                    <td colSpan={8} style={{ padding: '8px 6px 12px 22px' }}>
                      {r.eventos.length === 0
                        ? <div style={{ fontSize: 11, color: '#555' }}>Todavía no se pide ni se recibe nada de este producto.</div>
                        : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {r.eventos.map((e, i) => {
                              const c = e.etapa === 'pedido' ? '#FBBF24' : e.etapa === 'solicitado' ? '#A78BFA' : '#60A5FA'
                              const et = e.etapa === 'pedido' ? 'Pedido a proveedor' : e.etapa === 'solicitado' ? 'Solicitado en obra' : 'Recibido en obra'
                              return (
                                <div key={i} style={{ fontSize: 11, color: '#999', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ color: c, fontWeight: 600, minWidth: 130 }}>{et}</span>
                                  <span style={{ color: '#ddd', fontWeight: 600 }}>{e.cantidad} {r.unidad}</span>
                                  <span>{e.fecha || 'sin fecha'}</span>
                                  <span>· {e.quien}</span>
                                  {e.ref && <span style={{ color: '#666' }}>· {e.ref}</span>}
                                  {e.detalle && <span style={{ color: '#666' }}>· {e.detalle}</span>}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      {Object.keys(r.porArea).length > 0 && (
                        <div style={{ fontSize: 10, color: '#666', marginTop: 8 }}>
                          Cotizado por área: {Object.entries(r.porArea).map(([a, n]) => `${a} (${n})`).join(' · ')}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    )
  }

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard label="Productos" value={kpi.productos} icon={<Package size={15} />} />
        <KpiCard label="Completos en obra" value={kpi.completos} color="#10B981" />
        <KpiCard label="Sin pedir" value={kpi.porPedir} color={kpi.porPedir > 0 ? '#DC2626' : '#10B981'} />
        <KpiCard label="Con material en obra" value={kpi.enObra} color="#2563EB" />
        <KpiCard label="Solicitudes abiertas" value={kpi.solicitadas} color={kpi.solicitadas > 0 ? '#A78BFA' : '#666'} />
      </div>

      {/* Solicitudes de la obra */}
      {solicitudes.length > 0 && (
        <div style={{ ...card, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Truck size={13} color="#A78BFA" /> Solicitudes desde la app de obra
          </div>
          {solicitudes.map(s => (
            <SolicitudRow key={s.id} sol={s} obraId={obra.id} onCambio={recargar} />
          ))}
        </div>
      )}

      {/* Selector de vista */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 2, background: '#141414', borderRadius: 7, padding: 2, border: '1px solid #222' }}>
          {([['general', 'General'], ['area', 'Por área'], ['sistema', 'Por sistema']] as [Vista, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setVista(k)} style={{
              padding: '4px 12px', fontSize: 11, fontWeight: vista === k ? 600 : 400,
              color: vista === k ? '#fff' : '#666', background: vista === k ? '#333' : 'transparent',
              border: 'none', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
            }}>{l}</button>
          ))}
        </div>

        {vista === 'area' && (
          <select value={fArea} onChange={e => setFArea(e.target.value)}
            style={{ padding: '4px 8px', fontSize: 11, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: fArea ? '#fff' : '#666', fontFamily: 'inherit' }}>
            <option value="">Todas las áreas</option>
            {areas.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
        )}
        {vista === 'sistema' && (
          <select value={fSistema} onChange={e => setFSistema(e.target.value)}
            style={{ padding: '4px 8px', fontSize: 11, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: fSistema ? '#fff' : '#666', fontFamily: 'inherit' }}>
            <option value="">Todos los sistemas</option>
            {sistemas.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        <select value={fEtapa} onChange={e => setFEtapa(e.target.value as any)}
          style={{ padding: '4px 8px', fontSize: 11, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: fEtapa ? '#fff' : '#666', fontFamily: 'inherit' }}>
          <option value="">Todos los status</option>
          {Object.entries(ETAPA_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
          <Search size={12} color="#555" style={{ position: 'absolute', left: 8, top: 7 }} />
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar producto, marca o modelo"
            style={{ width: '100%', padding: '4px 8px 4px 26px', fontSize: 11, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit' }} />
        </div>
        <span style={{ fontSize: 10, color: '#555' }}>{visibles.length} de {renglones.length}</span>
      </div>

      {/* ═══ VISTA GENERAL ═══ */}
      {vista === 'general' && (
        <div style={card}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
            Un renglón por producto con la suma de todas las áreas. Haz clic en cualquiera para ver quién pidió, quién recibió y cuándo.
            <br />«Pedido» solo cuenta OC mandadas al proveedor; <span style={{ color: '#DC2626' }}>+Nb</span> son piezas que siguen en una OC de borrador. En «En bodega», el número entre paréntesis es stock general de otra obra.
          </div>
          <Tabla filas={enCatalogo} />
        </div>
      )}

      {/* ═══ VISTA POR ÁREA ═══ */}
      {vista === 'area' && (
        <div>
          {areas.filter(a => !fArea || a.name === fArea).map(a => {
            const filas = enCatalogo.filter(r => (r.porArea[a.name] || 0) > 0)
            if (filas.length === 0) return null
            return (
              <div key={a.id} style={card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#10B981', marginBottom: 8, display: 'flex', gap: 8 }}>
                  {a.name}
                  <span style={{ color: '#555', fontWeight: 400 }}>{filas.length} productos</span>
                </div>
                <Tabla filas={filas} cantidadDe={r => r.porArea[a.name] || 0} />
              </div>
            )
          })}
          {enCatalogo.filter(r => r.areas.includes('Sin área')).length > 0 && !fArea && (
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#D97706', marginBottom: 8 }}>Sin área asignada</div>
              <Tabla filas={enCatalogo.filter(r => r.areas.includes('Sin área'))} cantidadDe={r => r.porArea['Sin área'] || 0} />
            </div>
          )}
        </div>
      )}

      {/* ═══ VISTA POR SISTEMA ═══ */}
      {vista === 'sistema' && (
        <div>
          {sistemas.filter(s => !fSistema || s === fSistema).map(s => {
            const filas = enCatalogo.filter(r => r.sistema === s)
            if (filas.length === 0) return null
            return (
              <div key={s} style={card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#2563EB', marginBottom: 8, display: 'flex', gap: 8 }}>
                  {s}
                  <span style={{ color: '#555', fontWeight: 400 }}>{filas.length} productos</span>
                </div>
                <Tabla filas={filas} />
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ FUERA DE CATÁLOGO ═══ */}
      {fuera.length > 0 && (
        <div style={{ ...card, borderColor: '#D9770655' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#D97706', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={13} /> Llegó a la obra pero no está en la cotización ({fuera.length})
          </div>
          <div style={{ fontSize: 10, color: '#666', marginBottom: 8 }}>
            No los junto con los cotizados porque las recepciones se capturan solo con descripción: dos productos parecidos pueden ser distintos. Revisa si es un extra real o si hay que corregir la recepción.
          </div>
          <Tabla filas={fuera} />
        </div>
      )}
    </div>
  )
}

/** Panel compacto de próximas entregas — se usa también en la ficha de obra. */
export function ProximasEntregas({ obraId }: { obraId: string }) {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => {
    supabase.from('deliveries')
      .select('id,delivery_date,scheduled_time,status,notes,folio,delivery_items(id,description,qty,unit)')
      .eq('obra_id', obraId).in('status', ['pendiente', 'en_ruta'])
      .order('delivery_date').limit(5)
      .then(({ data }) => setRows((data || []) as any[]))
  }, [obraId])
  if (rows.length === 0) return null
  return (
    <div style={{ ...card, padding: 12, borderColor: '#2563EB44' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#93c5fd', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Truck size={13} /> Entregas programadas a esta obra
      </div>
      {rows.map(d => (
        <div key={d.id} style={{ borderTop: '1px solid #1a1a1a', padding: '6px 0', fontSize: 11, color: '#999' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Clock size={11} color="#60A5FA" />
            <span style={{ color: '#ddd', fontWeight: 600 }}>{d.delivery_date}{d.scheduled_time ? ` · ${String(d.scheduled_time).substring(0, 5)}` : ''}</span>
            <Badge label={d.status === 'en_ruta' ? 'En ruta' : 'Programada'} color={d.status === 'en_ruta' ? '#10B981' : '#D97706'} />
            {d.folio && <span style={{ color: '#666' }}>{d.folio}</span>}
          </div>
          <div style={{ marginTop: 3, color: '#888' }}>
            {(d.delivery_items || []).map((i: any) => `${i.qty} ${i.unit || 'pza'} · ${i.description}`).join(' | ') || d.notes || 'Sin detalle'}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   SolicitudRow — una solicitud de la app de obra, con lo que la
   oficina puede hacer con ella: aprobarla, programar la entrega (que
   es lo que el instalador ve en su celular) o darla por surtida.
   ═══════════════════════════════════════════════════════════════════ */
function SolicitudRow({ sol, obraId, onCambio }: { sol: any; obraId: string; onCambio: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [fecha, setFecha] = useState(sol.requerido_para || '')
  const [hora, setHora] = useState('10:00')

  const st = STATUS_SOLICITUD[sol.status] || { label: sol.status, color: '#666' }
  const items: any[] = sol.obra_material_solicitud_items || []
  const pedido = items.reduce((a, i) => a + Number(i.cantidad || 0), 0)
  const surtido = items.reduce((a, i) => a + Number(i.cantidad_surtida || 0), 0)
  const extras = items.filter(i => i.es_extra)

  async function cambiarStatus(status: string) {
    setBusy(status); setErr('')
    const { error } = await supabase.from('obra_material_solicitudes')
      .update({ status, revisado_at: new Date().toISOString() }).eq('id', sol.id)
    setBusy('')
    if (error) setErr(error.message); else onCambio()
  }

  // Programar la entrega: crea el renglón en `deliveries` con su desglose.
  // Es exactamente lo que la app de obra lee para decir "te llega mañana 10:00".
  async function programar() {
    if (!fecha) { setErr('Pon la fecha de entrega.'); return }
    setBusy('prog'); setErr('')
    try {
      const { data: d, error: e1 } = await supabase.from('deliveries').insert({
        obra_id: obraId,
        solicitud_id: sol.id,
        delivery_date: fecha,
        scheduled_time: hora || null,
        type: 'entrega',
        status: 'pendiente',
        origin: 'Bodega OMM',
        destination: 'Obra',
        folio: sol.folio ? `ENT-${sol.folio}` : null,
        material_description: items.map(i => `${i.cantidad} ${i.unidad || 'pza'} ${i.descripcion}`).join(' | ').substring(0, 900),
        notes: sol.notas || null,
      }).select().single()
      if (e1) throw e1
      const filas = items.map(i => ({
        delivery_id: d.id,
        obra_id: obraId,
        description: i.descripcion,
        qty: Number(i.cantidad) || 0,
        unit: i.unidad || 'pza',
        direction: 'out_bodega_to_obra',
      }))
      const { error: e2 } = await supabase.from('delivery_items').insert(filas)
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
        await supabase.from('obra_material_solicitud_items')
          .update({ cantidad_surtida: i.cantidad }).eq('id', i.id)
      }
      await supabase.from('obra_material_solicitudes')
        .update({ status: 'surtida', revisado_at: new Date().toISOString() }).eq('id', sol.id)
      onCambio()
    } catch (e: any) { setErr(e?.message || String(e)) }
    setBusy('')
  }

  const inp: React.CSSProperties = {
    padding: '4px 7px', fontSize: 11, background: '#0a0a0a', border: '1px solid #333',
    borderRadius: 6, color: '#fff', fontFamily: 'inherit',
  }

  return (
    <div style={{ borderTop: '1px solid #1a1a1a', padding: '7px 0' }}>
      <div onClick={() => setAbierto(v => !v)} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: '#999', cursor: 'pointer' }}>
        {abierto ? <ChevronDown size={11} color="#555" /> : <ChevronRight size={11} color="#555" />}
        <span style={{ color: '#ddd', fontWeight: 600, minWidth: 80 }}>{sol.folio || '—'}</span>
        <Badge label={st.label} color={st.color} />
        <span>{sol.fecha}</span>
        <span>· {sol.solicitante_nombre || 'Obra'}</span>
        <span>· {items.length} renglones · {surtido}/{pedido} surtidas</span>
        {extras.length > 0 && <Badge label={`${extras.length} extra${extras.length > 1 ? 's' : ''}`} color="#D97706" />}
        {sol.requerido_para && <span style={{ color: '#D97706' }}>· para el {sol.requerido_para}</span>}
      </div>

      {abierto && (
        <div style={{ paddingLeft: 20, paddingTop: 8 }}>
          {sol.notas && <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontStyle: 'italic' }}>«{sol.notas}»</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
            {items.map(i => (
              <div key={i.id} style={{ fontSize: 11, color: '#bbb', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: '#fff', fontWeight: 700, minWidth: 54 }}>{i.cantidad} {i.unidad || 'pza'}</span>
                <span style={{ flex: 1, minWidth: 180 }}>{i.descripcion}</span>
                {i.sistema && <span style={{ color: '#666' }}>{i.sistema}</span>}
                {i.es_extra && <Badge label="Extra — va a adendum" color="#D97706" />}
                {Number(i.cantidad_surtida) > 0 && <span style={{ color: '#10B981' }}>surtidas {i.cantidad_surtida}</span>}
              </div>
            ))}
          </div>

          {extras.length > 0 && (
            <div style={{ fontSize: 10, color: '#D97706', marginBottom: 8 }}>
              Los extras ya están en la pestaña «Extras / Adendum» de esta obra, listos para cotizar y mandar a Compras.
            </div>
          )}

          {!['surtida', 'rechazada', 'cancelada'].includes(sol.status) && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {!sol.delivery_id && (
                <>
                  <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} title="Fecha de entrega en obra" />
                  <input type="time" value={hora} onChange={e => setHora(e.target.value)} style={inp} title="Hora estimada" />
                  <Btn size="sm" variant="primary" disabled={!!busy} onClick={programar}>
                    <Truck size={11} /> {busy === 'prog' ? 'Programando…' : 'Programar entrega'}
                  </Btn>
                </>
              )}
              {sol.delivery_id && <Badge label="Entrega programada — el instalador ya la ve" color="#2563EB" />}
              <Btn size="sm" variant="default" disabled={!!busy} onClick={marcarSurtida}>
                {busy === 'surt' ? 'Guardando…' : 'Marcar surtida'}
              </Btn>
              <Btn size="sm" variant="default" disabled={!!busy} onClick={() => cambiarStatus('rechazada')}>
                Rechazar
              </Btn>
            </div>
          )}
          {err && <div style={{ fontSize: 10, color: '#f87171', marginTop: 6 }}>⚠ {err}</div>}
        </div>
      )}
    </div>
  )
}
