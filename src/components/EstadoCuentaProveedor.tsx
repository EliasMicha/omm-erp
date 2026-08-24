// ═══════════════════════════════════════════════════════════════════════════
// EstadoCuentaProveedor — todo lo que pasa con UN proveedor, en una hoja.
//
// La pregunta que contesta: ¿cuánto le he pagado, qué le compré, qué me
// facturó y cuánto le debo. Hoy esa información existe pero repartida en tres
// módulos (Compras, Facturación, Contabilidad) y nadie la ve junta.
//
// Cómo se amarra cada cosa al proveedor:
//   · Órdenes de compra → purchase_orders.supplier_id (liga dura)
//   · Facturas recibidas → emisor_rfc = suppliers.rfc (el SAT es la liga)
//   · Pagos de banco    → bank_movements.beneficiario_id (+ tipo 'proveedor')
//   · Pagos en efectivo → cash_movements.persona (texto: liga floja, se avisa)
//
// El eslabón débil es el pago de banco: si el movimiento no tiene beneficiario
// asignado, no aparece aquí aunque el dinero sí haya salido. Por eso el
// contador de "movimientos sin beneficiario" vive arriba, a la vista.
//
// Las monedas NO se mezclan: MXN y USD se suman por separado. Convertirlas con
// un TC inventado es la forma más rápida de que un estado de cuenta mienta.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { X, Download, Loader2, Building2 } from 'lucide-react'
import { estadoPago } from '../lib/pagoProveedor'

const F = (n: number) => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fDate = (d?: string | null) => {
  if (!d) return '—'
  try { return new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }) } catch { return String(d) }
}

interface Prov { id: string; name: string; rfc?: string | null; payment_terms?: string | null }

const ESTADO_OC: Record<string, { label: string; color: string }> = {
  borrador: { label: 'Borrador', color: '#6B7280' },
  aprobada: { label: 'Aprobada', color: '#2563EB' },
  pedida: { label: 'Pedida', color: '#D9A441' },
  recibida_parcial: { label: 'Recibida parcial', color: '#D97706' },
  recibida: { label: 'Recibida', color: '#10B981' },
  cancelada: { label: 'Cancelada', color: '#DC2626' },
}

export default function EstadoCuentaProveedor({ onClose, proveedorInicial }: {
  onClose: () => void
  proveedorInicial?: string
}) {
  const [provs, setProvs] = useState<Prov[]>([])
  const [sel, setSel] = useState(proveedorInicial || '')
  const [cargando, setCargando] = useState(false)
  const [ocs, setOcs] = useState<any[]>([])
  const [facturas, setFacturas] = useState<any[]>([])
  const [pagos, setPagos] = useState<any[]>([])
  const [efectivo, setEfectivo] = useState<any[]>([])
  const [sinBenef, setSinBenef] = useState<number | null>(null)
  const [exportando, setExportando] = useState(false)
  const [tab, setTab] = useState<'ocs' | 'facturas' | 'pagos'>('ocs')

  useEffect(() => {
    supabase.from('suppliers').select('id,name,rfc,payment_terms').order('name')
      .then(({ data }) => setProvs((data as any[]) || []))
    // Cuántos movimientos de banco siguen sin dueño: es la medida de qué tan
    // confiable es este estado de cuenta.
    supabase.from('bank_movements').select('id', { count: 'exact', head: true })
      .is('beneficiario_id', null).eq('tipo', 'cargo')
      .then(({ count }) => setSinBenef(count ?? null))
  }, [])

  const prov = provs.find(p => p.id === sel)

  useEffect(() => {
    if (!sel || !prov) { setOcs([]); setFacturas([]); setPagos([]); setEfectivo([]); return }
    setCargando(true)
    const rfc = (prov.rfc || '').replace(/[\s-]/g, '')
    Promise.all([
      supabase.from('purchase_orders')
        .select('id,po_number,status,currency,total,created_at,expected_delivery,fecha_maxima_pago,pagada_at,descripcion,delivered_at')
        .eq('supplier_id', sel).order('created_at', { ascending: false }),
      rfc
        ? supabase.from('facturas')
            .select('id,fecha_emision,serie,folio,uuid_fiscal,total,moneda,estado,tipo_comprobante,orden_compra_id,emisor_nombre')
            .eq('direccion', 'recibida').ilike('emisor_rfc', rfc).order('fecha_emision', { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('bank_movements')
        .select('id,fecha,concepto,monto,moneda,banco,tipo,purchase_order_id,lead_id')
        .eq('beneficiario_id', sel).order('fecha', { ascending: false }),
      supabase.from('cash_movements')
        .select('id,fecha,concepto,persona,monto,moneda,direccion,folio_recibo')
        .eq('direccion', 'egreso').ilike('persona', `%${prov.name}%`).order('fecha', { ascending: false }),
    ]).then(([o, f, b, c]: any[]) => {
      setOcs((o.data as any[]) || [])
      setFacturas((f.data as any[]) || [])
      setPagos((b.data as any[]) || [])
      setEfectivo((c.data as any[]) || [])
      setCargando(false)
    })
  }, [sel, provs.length])

  // Totales por moneda. Nunca se cruzan MXN y USD.
  const T = useMemo(() => {
    const z = () => ({ MXN: 0, USD: 0 })
    const facturado = z(); const pagado = z(); const comprado = z()
    // Las canceladas no cuentan: no son compra ni deuda.
    const vivas = facturas.filter(f => String(f.estado || '').toLowerCase() !== 'cancelada')
    for (const f of vivas) facturado[(f.moneda === 'USD' ? 'USD' : 'MXN')] += Number(f.total) || 0
    for (const p of pagos) if (p.tipo === 'cargo') pagado[(p.moneda === 'USD' ? 'USD' : 'MXN')] += Number(p.monto) || 0
    for (const e of efectivo) pagado[(e.moneda === 'USD' ? 'USD' : 'MXN')] += Number(e.monto) || 0
    for (const o of ocs) if (o.status !== 'cancelada') comprado[(o.currency === 'USD' ? 'USD' : 'MXN')] += Number(o.total) || 0
    return { facturado, pagado, comprado, facturasVivas: vivas.length }
  }, [facturas, pagos, efectivo, ocs])

  const hayUSD = T.facturado.USD > 0 || T.pagado.USD > 0 || T.comprado.USD > 0
  const porPagar = ocs.filter(o => o.fecha_maxima_pago && !o.pagada_at && o.status !== 'cancelada')
  const vencidas = porPagar.filter(o => estadoPago(o.fecha_maxima_pago).estado === 'vencido')

  async function exportar() {
    if (!prov) return
    setExportando(true)
    try {
      if (!(window as any).XLSX) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
          s.onload = () => resolve(); s.onerror = () => reject(new Error('No se pudo cargar la librería XLSX'))
          document.head.appendChild(s)
        })
      }
      const XLSX = (window as any).XLSX
      const resumen = [
        { Concepto: 'Proveedor', Valor: prov.name },
        { Concepto: 'RFC', Valor: prov.rfc || '(sin RFC)' },
        { Concepto: 'Comprado MXN (OC)', Valor: T.comprado.MXN },
        { Concepto: 'Facturado MXN', Valor: T.facturado.MXN },
        { Concepto: 'Pagado MXN', Valor: T.pagado.MXN },
        { Concepto: 'Saldo MXN (facturado − pagado)', Valor: T.facturado.MXN - T.pagado.MXN },
        ...(hayUSD ? [
          { Concepto: 'Comprado USD (OC)', Valor: T.comprado.USD },
          { Concepto: 'Facturado USD', Valor: T.facturado.USD },
          { Concepto: 'Pagado USD', Valor: T.pagado.USD },
          { Concepto: 'Saldo USD', Valor: T.facturado.USD - T.pagado.USD },
        ] : []),
      ]
      const hojaOC = ocs.map(o => ({
        OC: o.po_number, Estado: ESTADO_OC[o.status]?.label || o.status, Descripcion: o.descripcion || '',
        Fecha: o.created_at?.slice(0, 10), Total: Number(o.total) || 0, Moneda: o.currency,
        'Entrega esperada': o.expected_delivery || '', 'Fecha maxima de pago': o.fecha_maxima_pago || '',
        Pagada: o.pagada_at ? 'Si' : 'No',
      }))
      const hojaFac = facturas.map(f => ({
        Fecha: f.fecha_emision?.slice(0, 10), Folio: `${f.serie || ''}${f.folio || ''}`, UUID: f.uuid_fiscal,
        Total: Number(f.total) || 0, Moneda: f.moneda || 'MXN', Estado: f.estado || '',
      }))
      const hojaPagos = [
        ...pagos.map(p => ({ Fecha: p.fecha, Origen: 'Banco ' + (p.banco || ''), Concepto: p.concepto, Monto: Number(p.monto) || 0, Moneda: p.moneda || 'MXN' })),
        ...efectivo.map(e => ({ Fecha: e.fecha, Origen: 'Efectivo', Concepto: e.concepto || e.persona, Monto: Number(e.monto) || 0, Moneda: e.moneda || 'MXN' })),
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaOC.length ? hojaOC : [{ info: 'Sin ordenes de compra' }]), 'Ordenes de compra')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaFac.length ? hojaFac : [{ info: 'Sin facturas' }]), 'Facturas recibidas')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaPagos.length ? hojaPagos : [{ info: 'Sin pagos' }]), 'Pagos')
      XLSX.writeFile(wb, `EstadoCuenta_${prov.name.replace(/[^\w]+/g, '_')}.xlsx`)
    } catch (e: any) {
      alert('No se pudo exportar: ' + (e?.message || e))
    } finally { setExportando(false) }
  }

  const th: React.CSSProperties = { padding: '7px 8px', fontSize: 9, fontWeight: 600, color: '#555', textTransform: 'uppercase', textAlign: 'left', borderBottom: '1px solid #222', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '6px 8px', fontSize: 11, color: '#ccc', borderBottom: '1px solid #161616' }

  const Kpi = ({ label, valor, color }: { label: string; valor: string; color: string }) => (
    <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color, marginTop: 3 }}>{valor}</div>
    </div>
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 9998, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f0f0f', border: '1px solid #222', borderRadius: 12, width: '100%', maxWidth: 1180, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid #222', flexWrap: 'wrap' }}>
          <Building2 size={16} style={{ color: '#D9A441' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Estado de cuenta de proveedor</div>
          <select value={sel} onChange={e => setSel(e.target.value)} style={{ padding: '6px 10px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, color: '#ddd', fontSize: 12, fontFamily: 'inherit', minWidth: 260 }}>
            <option value="">Elige un proveedor…</option>
            {provs.map(p => <option key={p.id} value={p.id}>{p.name}{p.rfc ? ` · ${p.rfc}` : ' · sin RFC'}</option>)}
          </select>
          <button disabled={!sel || exportando} onClick={exportar} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 11, fontWeight: 600, background: 'rgba(87,255,154,0.08)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 6, color: sel ? '#10B981' : '#555', cursor: sel ? 'pointer' : 'default', fontFamily: 'inherit' }}>
            {exportando ? <Loader2 size={12} className="spin" /> : <Download size={12} />} Excel
          </button>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {!sel ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
            Elige un proveedor para ver qué le compraste, qué te facturó y cuánto le has pagado.
            {sinBenef ? <div style={{ marginTop: 10, fontSize: 11, color: '#D9A441' }}>Ojo: hay {sinBenef} cargos de banco sin beneficiario asignado. Esos pagos no van a aparecer en ningún estado de cuenta hasta que se les ponga dueño en «Vista general por proyecto».</div> : null}
          </div>
        ) : cargando ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>Cargando…</div>
        ) : (
          <div style={{ padding: '14px 16px', overflow: 'auto', maxHeight: '72vh' }}>
            {!prov?.rfc && (
              <div style={{ marginBottom: 12, padding: '8px 10px', background: '#D9A44111', border: '1px solid #D9A44144', borderRadius: 6, fontSize: 11, color: '#D9A441' }}>
                Este proveedor no tiene RFC en su ficha, así que no se le pueden amarrar facturas recibidas. Captúrale el RFC en Compras → Proveedores.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${hayUSD ? 4 : 4}, 1fr)`, gap: 10, marginBottom: 14 }}>
              <Kpi label="Comprado (OC) MXN" valor={F(T.comprado.MXN)} color="#60A5FA" />
              <Kpi label="Facturado MXN" valor={F(T.facturado.MXN)} color="#C084FC" />
              <Kpi label="Pagado MXN" valor={F(T.pagado.MXN)} color="#10B981" />
              <Kpi label="Saldo MXN" valor={F(T.facturado.MXN - T.pagado.MXN)} color={T.facturado.MXN - T.pagado.MXN > 0 ? '#DC2626' : '#666'} />
              {hayUSD && <>
                <Kpi label="Comprado (OC) USD" valor={F(T.comprado.USD)} color="#60A5FA" />
                <Kpi label="Facturado USD" valor={F(T.facturado.USD)} color="#C084FC" />
                <Kpi label="Pagado USD" valor={F(T.pagado.USD)} color="#10B981" />
                <Kpi label="Saldo USD" valor={F(T.facturado.USD - T.pagado.USD)} color={T.facturado.USD - T.pagado.USD > 0 ? '#DC2626' : '#666'} />
              </>}
            </div>

            {vencidas.length > 0 && (
              <div style={{ marginBottom: 12, padding: '8px 10px', background: '#DC262611', border: '1px solid #DC262644', borderRadius: 6, fontSize: 11, color: '#DC2626', fontWeight: 600 }}>
                {vencidas.length} orden(es) con la fecha máxima de pago vencida: {vencidas.map(o => o.po_number).join(', ')}
              </div>
            )}

            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {([['ocs', `Órdenes de compra (${ocs.length})`], ['facturas', `Facturas recibidas (${facturas.length})`], ['pagos', `Pagos (${pagos.length + efectivo.length})`]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k as any)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 6, border: '1px solid ' + (tab === k ? '#3B82F6' : '#2a2a2a'), background: tab === k ? '#3B82F622' : 'transparent', color: tab === k ? '#60A5FA' : '#888' }}>{label}</button>
              ))}
            </div>

            {tab === 'ocs' && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#161616' }}>{['OC', 'Descripción', 'Estado', 'Fecha', 'Entrega', 'Pago límite', 'Total'].map((h, i) => <th key={i} style={{ ...th, textAlign: h === 'Total' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {ocs.map(o => {
                    const ep = estadoPago(o.fecha_maxima_pago, { pagadaAt: o.pagada_at, cancelada: o.status === 'cancelada' })
                    const cfg = ESTADO_OC[o.status] || { label: o.status, color: '#666' }
                    return (
                      <tr key={o.id}>
                        <td style={{ ...td, fontWeight: 600, color: '#fff' }}>{o.po_number}</td>
                        <td style={{ ...td, color: '#999' }}>{o.descripcion || '—'}</td>
                        <td style={td}><span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: cfg.color + '22', color: cfg.color }}>{cfg.label}</span></td>
                        <td style={{ ...td, color: '#888' }}>{fDate(o.created_at)}</td>
                        <td style={{ ...td, color: '#888' }}>{fDate(o.expected_delivery)}</td>
                        <td style={td}>{o.fecha_maxima_pago
                          ? <span style={{ color: ep.color }}>{fDate(o.fecha_maxima_pago)} · {ep.label}</span>
                          : <span style={{ color: '#444' }}>sin fecha</span>}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{F(o.total)} <span style={{ color: '#666', fontSize: 10 }}>{o.currency}</span></td>
                      </tr>
                    )
                  })}
                  {ocs.length === 0 && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#555', fontSize: 12 }}>Sin órdenes de compra a este proveedor.</td></tr>}
                </tbody>
              </table>
            )}

            {tab === 'facturas' && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#161616' }}>{['Fecha', 'Folio', 'UUID', 'Estado', 'Total'].map((h, i) => <th key={i} style={{ ...th, textAlign: h === 'Total' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {facturas.map(f => {
                    const cancel = String(f.estado || '').toLowerCase() === 'cancelada'
                    return (
                      <tr key={f.id}>
                        <td style={{ ...td, color: '#888' }}>{fDate(f.fecha_emision)}</td>
                        <td style={td}>{`${f.serie || ''}${f.folio || ''}` || '—'}</td>
                        <td style={{ ...td, fontSize: 10, color: '#666' }}>{String(f.uuid_fiscal || '').slice(0, 8)}…</td>
                        <td style={{ ...td, color: cancel ? '#DC2626' : '#10B981', fontSize: 10 }}>{f.estado || 'vigente'}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600, textDecoration: cancel ? 'line-through' : 'none', color: cancel ? '#666' : '#ccc' }}>{F(f.total)} <span style={{ color: '#666', fontSize: 10 }}>{f.moneda || 'MXN'}</span></td>
                      </tr>
                    )
                  })}
                  {facturas.length === 0 && <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#555', fontSize: 12 }}>Sin facturas recibidas de este RFC.</td></tr>}
                </tbody>
              </table>
            )}

            {tab === 'pagos' && (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: '#161616' }}>{['Fecha', 'Origen', 'Concepto', 'Monto'].map((h, i) => <th key={i} style={{ ...th, textAlign: h === 'Monto' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {pagos.map(p => (
                      <tr key={p.id}>
                        <td style={{ ...td, color: '#888', whiteSpace: 'nowrap' }}>{fDate(p.fecha)}</td>
                        <td style={{ ...td, fontSize: 10, color: '#60A5FA' }}>Banco {p.banco || ''}</td>
                        <td style={{ ...td, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.concepto}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: p.tipo === 'cargo' ? '#DC2626' : '#10B981' }}>{p.tipo === 'cargo' ? '−' : '+'}{F(p.monto)} <span style={{ color: '#666', fontSize: 10 }}>{p.moneda || 'MXN'}</span></td>
                      </tr>
                    ))}
                    {efectivo.map(e => (
                      <tr key={e.id}>
                        <td style={{ ...td, color: '#888', whiteSpace: 'nowrap' }}>{fDate(e.fecha)}</td>
                        <td style={{ ...td, fontSize: 10, color: '#D9A441' }} title="Ligado por el nombre capturado en el movimiento de efectivo, no por catálogo">Efectivo ≈</td>
                        <td style={{ ...td, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.concepto || e.persona}{e.folio_recibo ? ` · ${e.folio_recibo}` : ''}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#DC2626' }}>−{F(e.monto)} <span style={{ color: '#666', fontSize: 10 }}>{e.moneda || 'MXN'}</span></td>
                      </tr>
                    ))}
                    {pagos.length === 0 && efectivo.length === 0 && <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#555', fontSize: 12 }}>Sin pagos ligados a este proveedor.</td></tr>}
                  </tbody>
                </table>
                <div style={{ marginTop: 8, fontSize: 10, color: '#555', lineHeight: 1.5 }}>
                  Los pagos de banco aparecen aquí solo si el movimiento tiene a este proveedor como beneficiario.
                  {sinBenef ? ` Hay ${sinBenef} cargos sin beneficiario asignado en toda la contabilidad: revísalos en «Vista general por proyecto» para que ningún pago se quede fuera.` : ''}
                  {efectivo.length > 0 ? ' Los de efectivo se ligan por el nombre capturado (marcados con ≈), así que conviene revisarlos.' : ''}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
