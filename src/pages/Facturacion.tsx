import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, X, FileText, RefreshCw, Download, Trash2, Search, Loader2, CheckCircle2, AlertCircle, Ban } from 'lucide-react'

// ============================================================
// Tipos
// ============================================================
interface Factura {
  id: string
  direccion: 'emitida' | 'recibida'
  status: string
  uuid_fiscal: string | null
  serie: string | null
  folio: string | null
  fecha_emision: string | null
  fecha_timbrado: string | null
  receptor_rfc: string | null
  receptor_nombre: string | null
  emisor_rfc: string | null
  emisor_nombre: string | null
  subtotal: number | null
  total: number | null
  iva: number | null
  moneda: string
  facturapi_id: string | null
  xml_url: string | null
  pdf_url: string | null
  quotation_id: string | null
  lead_id: string | null
  notas: string | null
  sandbox: boolean
  created_at: string
}

interface ClienteFiscal {
  id: string
  razon_social: string
  rfc: string
  uso_cfdi?: string
  uso_cfdi_clave?: string
  regimen_fiscal?: string
  regimen_fiscal_clave?: string
  codigo_postal?: string
  email?: string
  telefono?: string
  calle?: string
  num_exterior?: string
  num_interior?: string
  colonia?: string
  municipio?: string
  estado?: string
  facturapi_customer_id?: string
}

interface Concepto {
  descripcion: string
  clave_prod_serv: string
  clave_unidad: string
  unidad: string
  cantidad: number
  valor_unitario: number
  iva_tasa: number
}

interface QuotationLite {
  id: string
  name: string
  client_name: string
  specialty?: string
}

interface QuotationItemLite {
  id: string
  name: string
  description?: string
  quantity: number
  cost: number
  markup: number
  price: number
  unit?: string
  catalog_product_id?: string
}

// REP: Documento relacionado dentro del complemento de pagos 2.0
interface DocRelacionadoPago {
  factura_local_id: string        // id de la factura en nuestra tabla facturas
  uuid: string                    // UUID fiscal de la factura pagada
  serie: string | null
  folio: string | null
  moneda_doc: string              // moneda de la factura original (DR)
  total_doc: number               // total original de la factura (para referencia visual)
  equivalencia_dr: number         // tipo cambio DR vs moneda del pago (1 si iguales)
  num_parcialidad: number         // 1, 2, 3...
  imp_saldo_anterior: number      // saldo antes de este pago
  imp_pagado: number              // monto que este REP liquida sobre esta factura
  imp_saldo_insoluto: number      // anterior - pagado (auto)
  objeto_imp: string              // '01' no objeto / '02' si objeto / '03' si objeto y no obligado
  iva_tasa: number                // tasa aplicable (0.16 default) - solo si objeto '02'
  iva_trasladado: number          // monto IVA del pago sobre esta factura (auto o editable)
}

// ============================================================
// API Helper + FacturAPI mode (Sesion B - dual test/live)
// ============================================================
// Variable de modulo: el modo actual de FacturAPI (test o live)
// Default 'live' porque esta pagina trabaja con datos reales de produccion.
// Se cambia con setCurrentFacturapiMode() desde el toggle del UI.
let currentFacturapiMode: 'test' | 'live' = 'live'
export function setCurrentFacturapiMode(m: 'test' | 'live') { currentFacturapiMode = m }
export function getCurrentFacturapiMode(): 'test' | 'live' { return currentFacturapiMode }

// Helper: calcular subtotal/iva/total desde inv.items + manejo de tipo_comprobante
// Casos especiales:
//  - Tipo N (Nomina): total del header viene 0, el monto real es la suma de percepciones (subtotal)
//  - Tipo P (Pago/REP): legitimamente viene 0/0/XXX porque el monto va en el complemento
//  - Tipo I (Ingreso): caso normal, usar subtotal y total directamente
function computeAmounts(inv: any): { subtotal: number; iva: number; total: number } {
  const tipoComprobante = inv.type || 'I'
  const headerTotal = Number(inv.total) || 0
  const headerSubtotal = Number(inv.subtotal) || 0

  // Caso especial: Complemento de Pago (REP)
  if (tipoComprobante === 'P') {
    // FacturAPI v2: total_payment_amount esta en el header
    const headerPayment = Number(inv.total_payment_amount) || Number(inv.total_payment_amount_converted) || 0
    if (headerPayment > 0) {
      return { subtotal: headerPayment, iva: 0, total: headerPayment }
    }
    // Fallback: sumar de complements (estructura array indexada con type=pago)
    let pagoTotal = 0
    if (Array.isArray(inv.complements)) {
      for (const c of inv.complements) {
        if (c?.type === 'pago' && Array.isArray(c.data)) {
          for (const p of c.data) pagoTotal += Number(p.amount) || Number(p.imp_pagado) || 0
        } else if (Array.isArray(c?.payments)) {
          for (const p of c.payments) pagoTotal += Number(p.amount) || 0
        }
      }
    }
    return { subtotal: pagoTotal, iva: 0, total: pagoTotal }
  }

  // Calcular subtotal/iva desde items (igual que antes)
  let subtotalItems = 0
  let ivaItems = 0
  if (Array.isArray(inv.items)) {
    for (const it of inv.items) {
      const qty = Number(it.quantity) || 1
      const price = Number(it.product?.price) || 0
      const discount = Number(it.discount) || 0
      const lineSubtotal = (qty * price) - discount
      subtotalItems += lineSubtotal
      const taxes = it.product?.taxes || []
      for (const tax of taxes) {
        if (tax.type === 'IVA' && !tax.withholding) {
          const base = Number(tax.base) || lineSubtotal
          const rate = Number(tax.rate) || 0
          ivaItems += base * rate
        }
      }
    }
  }

  // Caso especial: Nomina (tipo N) - el header SAT viene con total=0
  // pero las percepciones brutas estan en items[]. Usar el subtotal calculado como total.
  if (tipoComprobante === 'N') {
    // Tambien intentar leer del complemento payroll si existe
    // FacturAPI devuelve complements como array indexado [{ payroll: {...} }] o objeto { payroll: {...} }
    let payroll: any = null
    if (Array.isArray(inv.complements)) {
      for (const c of inv.complements) {
        if (c?.payroll) { payroll = c.payroll; break }
      }
    } else if (inv.complements?.payroll) {
      payroll = inv.complements.payroll
    } else if (inv.complement?.payroll) {
      payroll = inv.complement.payroll
    }
    const payrollTotal = Number(payroll?.total_payment) || Number(payroll?.total_perceptions) || 0
    const finalTotal = payrollTotal || subtotalItems || headerSubtotal
    return {
      subtotal: Math.round((subtotalItems || headerSubtotal) * 100) / 100,
      iva: 0,
      total: Math.round(finalTotal * 100) / 100,
    }
  }

  // Caso normal (tipo I = Ingreso, E = Egreso, T = Traslado)
  // Si subtotal viene en raiz, usarlo
  if (headerSubtotal > 0) {
    return { subtotal: headerSubtotal, iva: headerTotal - headerSubtotal, total: headerTotal }
  }
  // Si no hay subtotal pero hay items con calculo
  if (subtotalItems > 0) {
    return {
      subtotal: Math.round(subtotalItems * 100) / 100,
      iva: Math.round(ivaItems * 100) / 100,
      total: headerTotal || Math.round((subtotalItems + ivaItems) * 100) / 100,
    }
  }
  // Fallback: si total existe pero no se pudo calcular subtotal, asumir IVA 16%
  if (headerTotal > 0) {
    const sub = headerTotal / 1.16
    return {
      subtotal: Math.round(sub * 100) / 100,
      iva: Math.round((headerTotal - sub) * 100) / 100,
      total: headerTotal,
    }
  }
  return { subtotal: 0, iva: 0, total: 0 }
}

// Helper: guardar items de FacturAPI a tabla factura_conceptos
async function saveInvoiceItems(facturaId: string, items: any[]) {
  if (!Array.isArray(items) || items.length === 0) return
  await supabase.from('factura_conceptos').delete().eq('factura_id', facturaId)
  const conceptos = items.map((it: any, idx: number) => {
    const qty = Number(it.quantity) || 1
    const price = Number(it.product?.price) || 0
    const discount = Number(it.discount) || 0
    const importe = qty * price
    let ivaTasa = 0, ivaImporte = 0, isrTasa = 0, isrImporte = 0
    const taxes = it.product?.taxes || []
    for (const tax of taxes) {
      const base = Number(tax.base) || importe
      const rate = Number(tax.rate) || 0
      if (tax.type === 'IVA' && !tax.withholding) { ivaTasa = rate; ivaImporte = base * rate }
      else if (tax.type === 'ISR' && tax.withholding) { isrTasa = rate; isrImporte = base * rate }
    }
    return {
      factura_id: facturaId,
      clave_prod_serv: it.product?.product_key || '01010101',
      no_identificacion: it.product?.sku || null,
      descripcion: it.product?.description || 'Sin descripcion',
      clave_unidad: it.product?.unit_key || 'ACT',
      unidad: it.product?.unit_name || null,
      cantidad: qty,
      valor_unitario: price,
      importe: Math.round(importe * 100) / 100,
      descuento: discount > 0 ? Math.round(discount * 100) / 100 : null,
      objeto_imp: it.product?.taxability || null,
      iva_tasa: ivaTasa || null,
      iva_importe: ivaImporte > 0 ? Math.round(ivaImporte * 100) / 100 : null,
      isr_retencion_tasa: isrTasa || null,
      isr_retencion_importe: isrImporte > 0 ? Math.round(isrImporte * 100) / 100 : null,
      order_index: idx,
    }
  })
  if (conceptos.length > 0) await supabase.from('factura_conceptos').insert(conceptos)
}

async function callFacturapi(action: string, opts: { method?: string; query?: Record<string, string>; body?: any } = {}) {
  const method = opts.method || 'GET'
  const params = new URLSearchParams({ action, mode: currentFacturapiMode, ...(opts.query || {}) })
  const url = '/api/facturapi?' + params.toString()
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (opts.body) init.body = JSON.stringify(opts.body)
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// ============================================================
// Componente principal
// ============================================================
export default function Facturacion() {
  const [view, setView] = useState<'todas' | 'lista' | 'nueva' | 'recibidas'>('todas')
  const [pingStatus, setPingStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  // FacturAPI mode (Sesion B)
  const [facturapiMode, setFacturapiMode] = useState<'test' | 'live'>('live')
  const [facturapiConfig, setFacturapiConfig] = useState<{ hasLive: boolean; hasTest: boolean; defaultMode: 'test' | 'live' | null } | null>(null)
  const [facturapiPing, setFacturapiPing] = useState<{ ok: boolean; livemode: boolean; message: string } | null>(null)

  // Carga config y modo inicial
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/facturapi?action=get_config')
        const cfg = await r.json()
        if (cancelled) return
        setFacturapiConfig(cfg)
        // Default LIVE para esta pagina (datos reales de produccion)
        const initialMode: 'test' | 'live' = cfg.hasLive ? 'live' : (cfg.hasTest ? 'test' : 'live')
        setFacturapiMode(initialMode)
        setCurrentFacturapiMode(initialMode)
        // Hacer el ping inicial
        const pr = await fetch('/api/facturapi?action=ping&mode=' + initialMode)
        const pd = await pr.json()
        if (!cancelled) {
          setFacturapiPing({ ok: !!pd.ok, livemode: !!pd.livemode, message: pd.message || '' })
          setPingStatus(pd.ok ? 'ok' : 'error')
        }
      } catch (e) {
        if (!cancelled) { setFacturapiConfig({ hasLive: false, hasTest: false, defaultMode: null }); setPingStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Handler para cambiar de modo (test/live)
  const switchMode = async (newMode: 'test' | 'live') => {
    setFacturapiMode(newMode)
    setCurrentFacturapiMode(newMode)
    setFacturapiPing(null)
    setPingStatus('idle')
    try {
      const pr = await fetch('/api/facturapi?action=ping&mode=' + newMode)
      const pd = await pr.json()
      setFacturapiPing({ ok: !!pd.ok, livemode: !!pd.livemode, message: pd.message || '' })
      setPingStatus(pd.ok ? 'ok' : 'error')
    } catch {
      setPingStatus('error')
    }
  }

  return (
    <div style={{ padding: '24px 28px', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 }}>Facturacion</h1>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            FacturAPI {facturapiMode === 'live' ? 'LIVE' : 'TEST'}
            {pingStatus === 'ok' && <CheckCircle2 size={12} style={{ color: '#57FF9A' }} />}
            {pingStatus === 'error' && <AlertCircle size={12} style={{ color: '#EF4444' }} />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setView('nueva')} style={{
            padding: '8px 16px', background: '#57FF9A', color: '#000', border: 'none', borderRadius: 8,
            fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
          }}>
            <Plus size={14} /> Nueva factura
          </button>
        </div>
      </div>

      {/* Banner FacturAPI mode (Sesion B) */}
      {facturapiConfig && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: facturapiMode === 'live' ? 'rgba(239,68,68,0.1)' : 'rgba(251,191,36,0.08)', border: '1px solid ' + (facturapiMode === 'live' ? 'rgba(239,68,68,0.4)' : 'rgba(251,191,36,0.3)') }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>{facturapiMode === 'live' ? '⚠️' : 'ð§ª'}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: facturapiMode === 'live' ? '#fca5a5' : '#fcd34d', letterSpacing: '0.5px' }}>
                FacturAPI: {facturapiMode === 'live' ? 'MODO LIVE (timbra y lee CFDIs reales)' : 'MODO TEST (no timbra)'}
              </span>
            </div>
            {facturapiPing && (
              <span style={{ fontSize: 11, color: facturapiPing.ok ? '#86efac' : '#fca5a5' }}>
                {facturapiPing.ok ? '✓ ' + facturapiPing.message : '✗ ' + facturapiPing.message}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4, background: '#0a0a0a', borderRadius: 6, padding: 3, border: '1px solid #2a2a2a' }}>
            <button
              onClick={() => switchMode('test')}
              disabled={!facturapiConfig.hasTest}
              style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, background: facturapiMode === 'test' ? 'rgba(251,191,36,0.2)' : 'transparent', border: 'none', borderRadius: 4, color: facturapiMode === 'test' ? '#fcd34d' : '#666', cursor: facturapiConfig.hasTest ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
            >TEST</button>
            <button
              onClick={() => {
                if (window.confirm('Cambiar a modo LIVE? Se leeran y crearan facturas reales con efectos fiscales.')) {
                  switchMode('live')
                }
              }}
              disabled={!facturapiConfig.hasLive}
              style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, background: facturapiMode === 'live' ? 'rgba(239,68,68,0.2)' : 'transparent', border: 'none', borderRadius: 4, color: facturapiMode === 'live' ? '#fca5a5' : '#666', cursor: facturapiConfig.hasLive ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
            >LIVE</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid #1e1e1e' }}>
        {(['todas', 'lista', 'recibidas'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: '10px 18px', background: 'transparent',
            border: 'none', borderBottom: `2px solid ${view === v ? '#57FF9A' : 'transparent'}`,
            color: view === v ? '#fff' : '#666', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>
            {v === 'todas' ? 'Todas' : v === 'lista' ? 'Emitidas' : 'Recibidas'}
          </button>
        ))}
      </div>

      {view === 'todas' && <ListaTodas />}
      {view === 'lista' && <ListaEmitidas onNueva={() => setView('nueva')} />}
      {view === 'nueva' && <NuevaFactura onCancel={() => setView('lista')} onCreated={() => setView('lista')} />}
      {view === 'recibidas' && <ListaRecibidas />}
    </div>
  )
}

// ============================================================
// Lista de TODAS las facturas (emitidas + recibidas) con sync unificado
// ============================================================
function ListaTodas() {
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<string>('')
  const [search, setSearch] = useState('')
  const [detalleFactura, setDetalleFactura] = useState<Factura | null>(null)
  const [detalleConceptos, setDetalleConceptos] = useState<any[]>([])
  const [loadingDetalle, setLoadingDetalle] = useState(false)
  // Navegacion mensual
  const [monthOffset, setMonthOffset] = useState(0)
  const now = new Date()
  const monthDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999)
  const monthLabel = monthDate.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
  const monthLabelCapitalized = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)
  const inSelectedMonth = (fechaStr: string | null | undefined) => {
    if (!fechaStr) return false
    const d = new Date(fechaStr)
    if (isNaN(d.getTime())) return false
    return d >= monthStart && d <= monthEnd
  }

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('facturas').select('*').order('fecha_emision', { ascending: false }).limit(2000)
    setFacturas((data as Factura[]) || [])
    setLoading(false)
  }

  async function abrirDetalle(f: Factura) {
    setDetalleFactura(f)
    setLoadingDetalle(true)
    setDetalleConceptos([])
    const { data } = await supabase.from('factura_conceptos').select('*').eq('factura_id', f.id).order('order_index', { ascending: true })
    setDetalleConceptos((data as any[]) || [])
    setLoadingDetalle(false)
  }

  function descargarPdf(f: Factura) {
    if (!f.facturapi_id) { alert('Sin ID FacturAPI'); return }
    const m = (f as any).sandbox ? 'test' : 'live'
    window.open('/api/facturapi?action=download_pdf&mode=' + m + '&id=' + encodeURIComponent(f.facturapi_id), '_blank')
  }

  function descargarXml(f: Factura) {
    if (!f.facturapi_id) { alert('Sin ID FacturAPI'); return }
    const m = (f as any).sandbox ? 'test' : 'live'
    window.open('/api/facturapi?action=download_xml&mode=' + m + '&id=' + encodeURIComponent(f.facturapi_id), '_blank')
  }

  useEffect(() => { load() }, [])

  // SYNC UNIFICADO: emitidas + recibidas en serie, con paginacion completa
  async function sincronizarMes() {
    setSyncing(true)
    let totalEmit = 0, errEmit = 0, totalRec = 0, errRec = 0
    let recheckedCount = 0, statusChangedCount = 0
    const maxPages = 60
    // Calcular fechas del mes activo en formato ISO (YYYY-MM-DD)
    const dateGte = monthStart.toISOString().slice(0, 10)
    const dateLte = monthEnd.toISOString().slice(0, 10)

    // PASO 1: Emitidas del mes seleccionado (con filtro de fecha)
    setSyncProgress('Sincronizando emitidas de ' + monthLabelCapitalized + '... pagina 1')
    let page = 1
    while (page <= maxPages) {
      setSyncProgress('Sincronizando emitidas de ' + monthLabelCapitalized + '... pagina ' + page)
      const r = await callFacturapi('list_invoices', { query: { limit: '50', page: String(page), date_gte: dateGte, date_lte: dateLte } })
      if (!r.ok || !r.data?.data || r.data.data.length === 0) break
      for (const inv of r.data.data) {
        const amounts = computeAmounts(inv)
        const payload: any = {
          direccion: 'emitida',
          facturapi_id: inv.id,
          uuid_fiscal: inv.uuid || null,
          serie: inv.series || null,
          folio: inv.folio_number ? String(inv.folio_number) : null,
          status: inv.status === 'valid' ? 'timbrada' : inv.status === 'canceled' ? 'cancelada' : 'borrador',
          fecha_emision: inv.date || null,
          fecha_timbrado: inv.stamp?.date || null,
          emisor_rfc: 'OTE210910PW5',
          emisor_nombre: 'OMM Technologies SA de CV',
          emisor_regimen_fiscal: '601',
          receptor_rfc: inv.customer?.tax_id || null,
          receptor_nombre: inv.customer?.legal_name || null,
          receptor_regimen_fiscal: inv.customer?.tax_system || null,
          receptor_codigo_postal: inv.customer?.address?.zip || null,
          receptor_uso_cfdi: inv.use || null,
          subtotal: amounts.subtotal,
          iva: amounts.iva,
          total: amounts.total,
          moneda: inv.currency || 'MXN',
          forma_pago: inv.payment_form || null,
          metodo_pago: inv.payment_method || null,
          tipo_comprobante: inv.type || 'I',
          tipo_relacion: Array.isArray(inv.related_documents) && inv.related_documents.length > 0
            ? (inv.related_documents[0].relationship || null) : null,
          uuids_relacionados: Array.isArray(inv.related_documents) && inv.related_documents.length > 0
            ? inv.related_documents.flatMap((rd) => Array.isArray(rd.documents) ? rd.documents : [])
            : null,
          sandbox: getCurrentFacturapiMode() === 'test',
        }
        try {
          const { data: existing } = await supabase.from('facturas').select('id').eq('facturapi_id', inv.id).maybeSingle()
          let facturaId: string | null = null
          if (existing) {
            const { error } = await supabase.from('facturas').update(payload).eq('id', (existing as any).id)
            if (error) errEmit++
            else { facturaId = (existing as any).id; totalEmit++ }
          } else {
            const { data: ins, error } = await supabase.from('facturas').insert(payload).select('id').single()
            if (error) errEmit++
            else { facturaId = (ins as any)?.id; totalEmit++ }
          }
          if (facturaId && Array.isArray(inv.items) && inv.items.length > 0) {
            await saveInvoiceItems(facturaId, inv.items)
          }
        } catch { errEmit++ }
      }
      // Use total_pages from API response for reliable pagination
      const totalPages = r.data.total_pages || 1
      if (page >= totalPages) break
      page++
    }

    // PASO 2: Recibidas del mes (issuer_type=receiving + filtro de fecha)
    setSyncProgress('Sincronizando recibidas de ' + monthLabelCapitalized + '... pagina 1')
    page = 1
    while (page <= maxPages) {
      setSyncProgress('Sincronizando recibidas de ' + monthLabelCapitalized + '... pagina ' + page)
      const r = await callFacturapi('list_invoices', { query: { limit: '50', page: String(page), issuer_type: 'receiving', date_gte: dateGte, date_lte: dateLte } })
      if (!r.ok || !r.data?.data || r.data.data.length === 0) break
      for (const inv of r.data.data) {
        const amounts = computeAmounts(inv)
        const payload: any = {
          direccion: 'recibida',
          facturapi_id: inv.id,
          uuid_fiscal: inv.uuid || null,
          serie: inv.series || null,
          folio: inv.folio_number ? String(inv.folio_number) : null,
          status: inv.status === 'valid' ? 'timbrada' : inv.status === 'canceled' ? 'cancelada' : 'borrador',
          fecha_emision: inv.date || null,
          fecha_timbrado: inv.stamp?.date || null,
          emisor_rfc: inv.issuer_info?.tax_id || 'XAXX010101000',
          emisor_nombre: inv.issuer_info?.legal_name || 'Sin nombre',
          emisor_regimen_fiscal: inv.issuer_info?.tax_system || null,
          receptor_rfc: inv.customer?.tax_id || 'OTE210910PW5',
          receptor_nombre: inv.customer?.legal_name || 'OMM Technologies SA de CV',
          receptor_regimen_fiscal: inv.customer?.tax_system || null,
          receptor_uso_cfdi: inv.use || null,
          receptor_codigo_postal: inv.customer?.address?.zip || inv.address?.zip || null,
          subtotal: amounts.subtotal,
          iva: amounts.iva,
          total: amounts.total,
          moneda: inv.currency || 'MXN',
          forma_pago: inv.payment_form || null,
          metodo_pago: inv.payment_method || null,
          tipo_comprobante: inv.type || 'I',
          tipo_relacion: Array.isArray(inv.related_documents) && inv.related_documents.length > 0
            ? (inv.related_documents[0].relationship || null) : null,
          uuids_relacionados: Array.isArray(inv.related_documents) && inv.related_documents.length > 0
            ? inv.related_documents.flatMap((rd) => Array.isArray(rd.documents) ? rd.documents : [])
            : null,
          sandbox: getCurrentFacturapiMode() === 'test',
        }
        try {
          const { data: existing } = await supabase.from('facturas').select('id').eq('facturapi_id', inv.id).maybeSingle()
          let facturaId: string | null = null
          if (existing) {
            const { error } = await supabase.from('facturas').update(payload).eq('id', (existing as any).id)
            if (error) errRec++
            else { facturaId = (existing as any).id; totalRec++ }
          } else {
            const { data: ins, error } = await supabase.from('facturas').insert(payload).select('id').single()
            if (error) errRec++
            else { facturaId = (ins as any)?.id; totalRec++ }
          }
          if (facturaId && Array.isArray(inv.items) && inv.items.length > 0) {
            await saveInvoiceItems(facturaId, inv.items)
          }
        } catch { errRec++ }
      }
      const totalPagesRec = r.data.total_pages || 1
      if (page >= totalPagesRec) break
      page++
    }

    // PASO 3: Re-check de status de TODAS las facturas locales del mes
    // (para detectar cancelaciones/cambios de estado en facturas existentes)
    const facturasMesLocal = facturas.filter(f => f.facturapi_id && inSelectedMonth(f.fecha_emision))
    setSyncProgress('Verificando status de ' + facturasMesLocal.length + ' facturas locales...')
    for (let i = 0; i < facturasMesLocal.length; i++) {
      const f = facturasMesLocal[i]
      setSyncProgress('Verificando status... ' + (i + 1) + '/' + facturasMesLocal.length)
      try {
        const r = await callFacturapi('get_invoice', { query: { id: f.facturapi_id } })
        if (!r.ok || !r.data) continue
        recheckedCount++
        const remoteStatus = r.data.status === 'valid' ? 'timbrada' : r.data.status === 'canceled' ? 'cancelada' : 'borrador'
        if (remoteStatus !== f.status) {
          await supabase.from('facturas').update({ status: remoteStatus }).eq('id', f.id)
          statusChangedCount++
        }
      } catch { /* skip */ }
    }

    setSyncProgress('')
    await load()
    setSyncing(false)
    const errMsg = (errEmit + errRec) > 0 ? ' (' + (errEmit + errRec) + ' errores)' : ''
    const changesMsg = statusChangedCount > 0 ? '\n' + statusChangedCount + ' cambios de status detectados' : ''
    alert('Sincronizacion de ' + monthLabelCapitalized + ' completa:\n' + totalEmit + ' emitidas + ' + totalRec + ' recibidas = ' + (totalEmit + totalRec) + ' facturas\n' + recheckedCount + ' verificadas' + changesMsg + errMsg)
  }

  // Filtrar por mes y luego por busqueda
  const facturasMes = facturas.filter(f => inSelectedMonth(f.fecha_emision))
  const cntEmit = facturasMes.filter(f => f.direccion === 'emitida').length
  const cntRec = facturasMes.filter(f => f.direccion === 'recibida').length
  const filtered = facturasMes.filter(f => {
    if (!search) return true
    const q = search.toLowerCase()
    const contraparte = f.direccion === 'emitida' ? f.receptor_nombre : f.emisor_nombre
    const contraparteRfc = f.direccion === 'emitida' ? f.receptor_rfc : f.emisor_rfc
    return (contraparte || '').toLowerCase().includes(q) ||
      (contraparteRfc || '').toLowerCase().includes(q) ||
      (f.uuid_fiscal || '').toLowerCase().includes(q) ||
      (f.folio || '').toLowerCase().includes(q)
  })

  return (
    <div>
      {/* Navegador mensual con contador desglosado */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '10px 14px', background: '#141414', border: '1px solid #222', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setMonthOffset(monthOffset - 1)} style={{ padding: '6px 10px', fontSize: 12, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', cursor: 'pointer', fontFamily: 'inherit' }}>◀ Mes anterior</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', minWidth: 160, textAlign: 'center' as const }}>{monthLabelCapitalized}</span>
          <button onClick={() => setMonthOffset(monthOffset + 1)} style={{ padding: '6px 10px', fontSize: 12, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', cursor: 'pointer', fontFamily: 'inherit' }}>Mes siguiente ▶</button>
          {monthOffset !== 0 && (
            <button onClick={() => setMonthOffset(0)} style={{ padding: '6px 10px', fontSize: 11, background: 'rgba(87,255,154,0.08)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 6, color: '#57FF9A', cursor: 'pointer', fontFamily: 'inherit' }}>Hoy</button>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#888' }}>
          <span style={{ color: '#ccc', fontWeight: 600 }}>{facturasMes.length}</span> factura{facturasMes.length !== 1 ? 's' : ''} en {monthLabelCapitalized}
          <span style={{ color: '#666' }}> ({cntEmit} emit + {cntRec} rec)</span>
        </div>
      </div>

      {/* Search bar + boton sync unificado */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#555' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por contraparte, RFC, UUID o folio..." style={{ width: '100%', padding: '8px 12px 8px 32px', background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }} />
        </div>
        <button onClick={sincronizarMes} disabled={syncing} style={{ padding: '10px 16px', background: syncing ? '#1e1e1e' : '#57FF9A', color: syncing ? '#888' : '#000', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: syncing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
          {syncing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
          {syncing ? (syncProgress || 'Sincronizando...') : 'Sincronizar ' + monthLabelCapitalized}
        </button>
      </div>

      {/* Barra de progreso del sync */}
      {syncing && syncProgress && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(87,255,154,0.06)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 8, fontSize: 12, color: '#57FF9A', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
          {syncProgress}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' as const, color: '#555' }}>Cargando...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center' as const, color: '#555', background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 12 }}>
          <FileText size={32} style={{ color: '#333', marginBottom: 12 }} />
          <div style={{ fontSize: 14, marginBottom: 6 }}>{search ? 'Sin resultados' : 'No hay facturas en ' + monthLabelCapitalized}</div>
          <div style={{ fontSize: 12, color: '#444' }}>Da click en "Sincronizar TODO con FacturAPI" para traer las facturas del SAT</div>
        </div>
      ) : (
        <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
            <thead>
              <tr style={{ background: '#141414', borderBottom: '1px solid #1e1e1e' }}>
                {['Dir', 'Folio', 'Fecha', 'Contraparte', 'RFC', 'Total', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: 10, fontWeight: 600, color: '#666', textTransform: 'uppercase' as const, letterSpacing: '0.06em', textAlign: 'left' as const }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => {
                const isEmit = f.direccion === 'emitida'
                const contraparte = isEmit ? f.receptor_nombre : f.emisor_nombre
                const contraparteRfc = isEmit ? f.receptor_rfc : f.emisor_rfc
                return (
                  <tr key={f.id} onClick={() => abrirDetalle(f)} style={{ borderBottom: '1px solid #1a1a1a', cursor: 'pointer' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', background: isEmit ? 'rgba(87,255,154,0.15)' : 'rgba(251,191,36,0.12)', color: isEmit ? '#57FF9A' : '#fcd34d' }}>{isEmit ? 'EMI' : 'REC'}</span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: '#ccc', fontFamily: 'monospace' }}>{f.serie || ''}{f.folio || '--'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 11, color: '#888' }}>{f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString() : '--'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: '#ddd' }}>{contraparte || '--'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{contraparteRfc || '--'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: isEmit ? '#57FF9A' : '#fcd34d', fontWeight: 600, textAlign: 'right' as const }}>${(f.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} {f.moneda}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: f.status === 'timbrada' ? '#57FF9A22' : f.status === 'cancelada' ? '#EF444422' : '#F59E0B22', color: f.status === 'timbrada' ? '#57FF9A' : f.status === 'cancelada' ? '#EF4444' : '#F59E0B' }}>{f.status}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {detalleFactura ? (
        <DetalleModal
          factura={detalleFactura}
          conceptos={detalleConceptos}
          loading={loadingDetalle}
          onClose={() => setDetalleFactura(null)}
          onPdf={() => descargarPdf(detalleFactura)}
          onXml={() => descargarXml(detalleFactura)}
        />
      ) : null}
    </div>
  )
}

function DetalleModal(props: { factura: Factura; conceptos: any[]; loading: boolean; onClose: () => void; onPdf: () => void; onXml: () => void }) {
  const f = props.factura
  const fAny = f as any
  const isEmit = f.direccion === 'emitida'
  const dirLabel = isEmit ? 'EMITIDA' : 'RECIBIDA'
  const dirColor = isEmit ? '#57FF9A' : '#fcd34d'
  const subtotalNum = Number(f.subtotal) || 0
  const totalNum = Number(f.total) || 0
  const ivaNum = Number(fAny.iva) || 0
  const hasFacturapiId = !!f.facturapi_id
  return (
    <div onClick={props.onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 40, zIndex: 100, overflowY: 'auto' as const }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 12, maxWidth: 900, width: '100%', padding: 24, color: '#ddd' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <span style={{ padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: '#1e1e1e', color: dirColor }}>{dirLabel}</span>
            <span style={{ marginLeft: 8, fontSize: 14, color: '#fff' }}>{f.serie || ''}{f.folio || '--'}</span>
          </div>
          <button onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 20 }}>X</button>
        </div>
        <div style={{ marginBottom: 16, fontSize: 12 }}>
          <div style={{ color: '#888' }}>UUID: <span style={{ fontFamily: 'monospace', color: '#ccc' }}>{f.uuid_fiscal || '--'}</span></div>
          <div style={{ marginTop: 6, color: '#888' }}>Emisor: <span style={{ color: '#fff' }}>{f.emisor_nombre}</span> ({f.emisor_rfc})</div>
          <div style={{ color: '#888' }}>Receptor: <span style={{ color: '#fff' }}>{f.receptor_nombre}</span> ({f.receptor_rfc})</div>
        </div>
        <div style={{ background: '#0e0e0e', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888' }}>
            <span>Subtotal:</span>
            <span>${subtotalNum.toLocaleString('es-MX', { minimumFractionDigits: 2 })} {f.moneda}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888' }}>
            <span>IVA:</span>
            <span>${ivaNum.toLocaleString('es-MX', { minimumFractionDigits: 2 })} {f.moneda}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', fontWeight: 700, marginTop: 6, paddingTop: 6, borderTop: '1px solid #1e1e1e' }}>
            <span>Total:</span>
            <span style={{ color: dirColor }}>${totalNum.toLocaleString('es-MX', { minimumFractionDigits: 2 })} {f.moneda}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {hasFacturapiId ? (
            <button onClick={props.onPdf} style={{ padding: '8px 14px', background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8, color: '#a78bfa', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Descargar PDF</button>
          ) : null}
          {hasFacturapiId ? (
            <button onClick={props.onXml} style={{ padding: '8px 14px', background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8, color: '#60a5fa', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Descargar XML</button>
          ) : null}
          <button onClick={props.onClose} style={{ padding: '8px 14px', background: '#57FF9A', border: 'none', borderRadius: 8, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Lista de Facturas Emitidas
// ============================================================
function ListaEmitidas({ onNueva }: { onNueva: () => void }) {
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState('')
  const [cancelando, setCancelando] = useState<string | null>(null)
  const [showCancelModal, setShowCancelModal] = useState<Factura | null>(null)
  // Navegacion mensual (Sesion B)
  const [monthOffset, setMonthOffset] = useState(0)
  const now = new Date()
  const monthDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999)
  const monthLabel = monthDate.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
  const monthLabelCapitalized = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)
  const inSelectedMonth = (fechaStr: string | null | undefined) => {
    if (!fechaStr) return false
    const d = new Date(fechaStr)
    if (isNaN(d.getTime())) return false
    return d >= monthStart && d <= monthEnd
  }

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('facturas')
      .select('*')
      .eq('direccion', 'emitida')
      .order('created_at', { ascending: false })
      .limit(100)
    setFacturas((data as Factura[]) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function sincronizar() {
    setSyncing(true)
    let totalImported = 0, totalErrors = 0
    let page = 1
    const maxPages = 60
    while (page <= maxPages) {
      const r = await callFacturapi('list_invoices', { query: { limit: '50', page: String(page) } })
      if (!r.ok || !r.data?.data || r.data.data.length === 0) break
      for (const inv of r.data.data) {
        const amounts = computeAmounts(inv)
        const payload: any = {
          direccion: 'emitida',
          facturapi_id: inv.id,
          uuid_fiscal: inv.uuid || null,
          serie: inv.series || null,
          folio: inv.folio_number ? String(inv.folio_number) : null,
          status: inv.status === 'valid' ? 'timbrada' : inv.status === 'canceled' ? 'cancelada' : 'borrador',
          fecha_emision: inv.date || null,
          fecha_timbrado: inv.stamp?.date || null,
          // Emisor: SOMOS NOSOTROS para emitidas. NOT NULL en facturas.
          emisor_rfc: 'OTE210910PW5',
          emisor_nombre: 'OMM Technologies SA de CV',
          emisor_regimen_fiscal: '601',
          // Receptor (cliente al que le facturamos)
          receptor_rfc: inv.customer?.tax_id || null,
          receptor_nombre: inv.customer?.legal_name || null,
          receptor_regimen_fiscal: inv.customer?.tax_system || null,
          receptor_codigo_postal: inv.customer?.address?.zip || null,
          receptor_uso_cfdi: inv.use || null,
          subtotal: amounts.subtotal,
          iva: amounts.iva,
          total: amounts.total,
          moneda: inv.currency || 'MXN',
          forma_pago: inv.payment_form || null,
          metodo_pago: inv.payment_method || null,
          tipo_comprobante: inv.type || 'I',
          tipo_relacion: Array.isArray(inv.related_documents) && inv.related_documents.length > 0
            ? (inv.related_documents[0].relationship || null) : null,
          uuids_relacionados: Array.isArray(inv.related_documents) && inv.related_documents.length > 0
            ? inv.related_documents.flatMap((rd) => Array.isArray(rd.documents) ? rd.documents : [])
            : null,
          sandbox: getCurrentFacturapiMode() === 'test',
        }
        try {
          const { data: existing } = await supabase.from('facturas').select('id').eq('facturapi_id', inv.id).maybeSingle()
          let facturaId: string | null = null
          if (existing) {
            const { error } = await supabase.from('facturas').update(payload).eq('id', (existing as any).id)
            if (error) totalErrors++
            else { facturaId = (existing as any).id; totalImported++ }
          } else {
            const { data: ins, error } = await supabase.from('facturas').insert(payload).select('id').single()
            if (error) totalErrors++
            else { facturaId = (ins as any)?.id; totalImported++ }
          }
          if (facturaId && Array.isArray(inv.items) && inv.items.length > 0) {
            await saveInvoiceItems(facturaId, inv.items)
          }
        } catch { totalErrors++ }
      }
      const tp = r.data.total_pages || 1
      if (page >= tp) break
      page++
    }
    await load()
    setSyncing(false)
    if (totalErrors > 0) {
      alert('Sincronizacion completada: ' + totalImported + ' facturas, ' + totalErrors + ' errores')
    } else if (totalImported > 0) {
      alert('Sincronizacion completada: ' + totalImported + ' facturas emitidas importadas')
    }
  }

  async function eliminarLocal(f: Factura) {
    if (!confirm(`Eliminar la factura del listado local? Esta accion no se puede deshacer.\n\nFolio: ${f.serie || ''}${f.folio || '--'}\nCliente: ${f.receptor_nombre}\n\nNota: Si la factura ya fue timbrada en SAT, NO se puede eliminar — solo cancelar.`)) return
    // Borrar conceptos primero (FK CASCADE deberia hacerlo pero por seguridad)
    await supabase.from('factura_conceptos').delete().eq('factura_id', f.id)
    const { error } = await supabase.from('facturas').delete().eq('id', f.id)
    if (error) { alert('Error al eliminar: ' + error.message); return }
    await load()
  }

  async function cancelarCfdi(motivo: string, sustitucion: string) {
    if (!showCancelModal) return
    const f = showCancelModal
    if (!f.facturapi_id) { alert('Esta factura no tiene ID de FacturAPI'); return }
    setCancelando(f.id)
    const body: any = { id: f.facturapi_id, motive: motivo }
    if (sustitucion) body.substitution = sustitucion
    const r = await callFacturapi('cancel_invoice', { method: 'POST', body })
    if (r.ok) {
      await supabase.from('facturas').update({ status: 'cancelada', fecha_cancelacion: new Date().toISOString() }).eq('id', f.id)
      await load()
      setShowCancelModal(null)
    } else {
      alert('Error al cancelar: ' + (r.data?.message || JSON.stringify(r.data).slice(0, 300)))
    }
    setCancelando(null)
  }

  // Filtrar por mes seleccionado primero, luego por busqueda
  const facturasMes = facturas.filter(f => inSelectedMonth(f.fecha_emision))
  const filtered = facturasMes.filter(f => {
    if (!search) return true
    const q = search.toLowerCase()
    return (f.receptor_nombre || '').toLowerCase().includes(q) ||
      (f.receptor_rfc || '').toLowerCase().includes(q) ||
      (f.uuid_fiscal || '').toLowerCase().includes(q) ||
      (f.folio || '').toLowerCase().includes(q)
  })

  return (
    <div>
      {/* Navegador mensual (Sesion B) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '10px 14px', background: '#141414', border: '1px solid #222', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setMonthOffset(monthOffset - 1)} style={{ padding: '6px 10px', fontSize: 12, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', cursor: 'pointer', fontFamily: 'inherit' }}>◀ Mes anterior</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', minWidth: 160, textAlign: 'center' as const }}>{monthLabelCapitalized}</span>
          <button onClick={() => setMonthOffset(monthOffset + 1)} style={{ padding: '6px 10px', fontSize: 12, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', cursor: 'pointer', fontFamily: 'inherit' }}>Mes siguiente ▶</button>
          {monthOffset !== 0 && (
            <button onClick={() => setMonthOffset(0)} style={{ padding: '6px 10px', fontSize: 11, background: 'rgba(87,255,154,0.08)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 6, color: '#57FF9A', cursor: 'pointer', fontFamily: 'inherit' }}>Hoy</button>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#666' }}>
          {facturasMes.length} factura{facturasMes.length !== 1 ? 's' : ''} en {monthLabelCapitalized}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#555' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por cliente, RFC, UUID o folio..." style={{
            width: '100%', padding: '8px 12px 8px 32px', background: '#0e0e0e', border: '1px solid #1e1e1e',
            borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box'
          }} />
        </div>
        <button onClick={sincronizar} disabled={syncing} style={{
          padding: '8px 14px', background: '#1e1e1e', color: '#ccc', border: '1px solid #2a2a2a', borderRadius: 8,
          fontSize: 12, fontWeight: 600, cursor: syncing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6
        }}>
          {syncing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
          {syncing ? 'Sincronizando...' : 'Sincronizar con FacturAPI'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#555' }}>Cargando...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#555', background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 12 }}>
          <FileText size={32} style={{ color: '#333', marginBottom: 12 }} />
          <div style={{ fontSize: 14, marginBottom: 6 }}>{search ? 'Sin resultados' : 'Aun no has emitido facturas'}</div>
          <div style={{ fontSize: 12, color: '#444', marginBottom: 16 }}>{search ? 'Cambia tu busqueda' : 'Crea tu primera factura desde el boton de arriba'}</div>
          {!search && (
            <button onClick={onNueva} style={{
              padding: '8px 16px', background: '#57FF9A', color: '#000', border: 'none', borderRadius: 8,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6
            }}>
              <Plus size={12} /> Nueva factura
            </button>
          )}
        </div>
      ) : (
        <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#141414', borderBottom: '1px solid #1e1e1e' }}>
                {['Folio', 'Fecha', 'Cliente', 'RFC', 'Total', 'Status', 'Acciones'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: 10, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => {
                const canDelete = f.status === 'borrador' || f.status === 'cancelada' || f.status === 'error'
                const canCancel = f.status === 'timbrada' && f.facturapi_id
                return (
                <tr key={f.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#ccc', fontFamily: 'monospace' }}>{f.serie || ''}{f.folio || '--'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 11, color: '#888' }}>{f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString() : '--'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#ddd' }}>{f.receptor_nombre || '--'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{f.receptor_rfc || '--'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#57FF9A', fontWeight: 600, textAlign: 'right' }}>${(f.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} {f.moneda}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                      background: f.status === 'timbrada' ? '#57FF9A22' : f.status === 'cancelada' ? '#EF444422' : '#F59E0B22',
                      color: f.status === 'timbrada' ? '#57FF9A' : f.status === 'cancelada' ? '#EF4444' : '#F59E0B',
                    }}>{f.status}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {f.facturapi_id && <a href={`/api/facturapi?action=download_pdf&id=${f.facturapi_id}`} target="_blank" rel="noopener noreferrer" style={{ color: '#A78BFA', fontSize: 10, textDecoration: 'none' }}>PDF</a>}
                      {f.facturapi_id && <a href={`/api/facturapi?action=download_xml&id=${f.facturapi_id}`} target="_blank" rel="noopener noreferrer" style={{ color: '#A78BFA', fontSize: 10, textDecoration: 'none' }}>XML</a>}
                      {canCancel && (
                        <button onClick={() => setShowCancelModal(f)} disabled={cancelando === f.id} title="Cancelar CFDI en SAT" style={{ background: 'none', border: 'none', color: '#F59E0B', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}>
                          <Ban size={13} />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => eliminarLocal(f)} title="Eliminar del listado local" style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCancelModal && <CancelarModal factura={showCancelModal} onClose={() => setShowCancelModal(null)} onConfirm={cancelarCfdi} loading={cancelando === showCancelModal.id} />}
    </div>
  )
}

// ============================================================
// Modal de cancelacion
// ============================================================
function CancelarModal({ factura, onClose, onConfirm, loading }: { factura: Factura; onClose: () => void; onConfirm: (motivo: string, sustitucion: string) => void; loading: boolean }) {
  const [motivo, setMotivo] = useState('02')
  const [sustitucion, setSustitucion] = useState('')

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24, width: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Cancelar CFDI</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ background: '#3a2a1a', border: '1px solid #5a4a2a', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 11, color: '#fbbf24' }}>
          Esta accion cancelara la factura <strong>{factura.serie || ''}{factura.folio}</strong> en el SAT. Una vez cancelada, no se puede revertir.
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4, display: 'block' }}>Motivo SAT</label>
          <select value={motivo} onChange={e => setMotivo(e.target.value)} style={{ width: '100%', padding: '8px 12px', background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}>
            <option value="01">01 - Comprobante con errores con relacion (requiere sustitucion)</option>
            <option value="02">02 - Comprobante con errores sin relacion</option>
            <option value="03">03 - No se llevo a cabo la operacion</option>
            <option value="04">04 - Operacion nominativa relacionada en factura global</option>
          </select>
        </div>

        {motivo === '01' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4, display: 'block' }}>UUID que sustituye a esta factura</label>
            <input value={sustitucion} onChange={e => setSustitucion(e.target.value)} placeholder="Pega el UUID de la factura que sustituye" style={{ width: '100%', padding: '8px 12px', background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '10px 20px', background: '#1e1e1e', color: '#ccc', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>No cancelar</button>
          <button onClick={() => onConfirm(motivo, sustitucion)} disabled={loading || (motivo === '01' && !sustitucion)} style={{ padding: '10px 20px', background: loading ? '#444' : '#EF4444', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            {loading ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Cancelando...</> : 'Cancelar CFDI'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// SAT: Tipos de relacion (Anexo 20, Apendice 6)
// ============================================================
const TIPOS_RELACION_SAT: { value: string; label: string; hint?: string }[] = [
  { value: '01', label: '01 - Nota de credito de los documentos relacionados' },
  { value: '02', label: '02 - Nota de debito de los documentos relacionados' },
  { value: '03', label: '03 - Devolucion de mercancia sobre facturas o traslados previos' },
  { value: '04', label: '04 - Sustitucion de los CFDI previos' },
  { value: '05', label: '05 - Traslados de mercancias facturados previamente' },
  { value: '06', label: '06 - Factura generada por los traslados previos' },
  { value: '07', label: '07 - CFDI por aplicacion de anticipo', hint: 'Usado para facturas que aplican un anticipo previo' },
]

// Factura ligera para el selector de relaciones (subset de la tabla facturas)
interface FacturaLite {
  id: string
  facturapi_id: string | null
  uuid_fiscal: string
  serie: string | null
  folio: string | null
  fecha_emision: string | null
  total: number | null
  moneda: string
  tipo_comprobante: string | null
  metodo_pago: string | null
  receptor_rfc: string | null
  receptor_nombre: string | null
}

// ============================================================
// Selector de facturas relacionadas (compartido entre Feature A y REP)
// ============================================================
function SelectorFacturasRelacionadas(props: {
  rfcCliente: string | null
  tipoRelacion: string
  onTipoRelacionChange: (t: string) => void
  uuidsSeleccionados: string[]
  onUuidsChange: (uuids: string[]) => void
  filtroExtra?: 'ppd' | 'any'
  titulo?: string
  ocultarTipoRelacion?: boolean
}) {
  const { rfcCliente, tipoRelacion, onTipoRelacionChange, uuidsSeleccionados, onUuidsChange } = props
  const filtroExtra = props.filtroExtra || 'any'
  const titulo = props.titulo || 'Facturas relacionadas'
  const ocultarTipoRelacion = !!props.ocultarTipoRelacion

  const [facturas, setFacturas] = useState<FacturaLite[]>([])
  const [loading, setLoading] = useState(false)
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    if (!rfcCliente) { setFacturas([]); return }
    setLoading(true)
    let q = supabase
      .from('facturas')
      .select('id,facturapi_id,uuid_fiscal,serie,folio,fecha_emision,total,moneda,tipo_comprobante,metodo_pago,receptor_rfc,receptor_nombre')
      .eq('direccion', 'emitida')
      .eq('receptor_rfc', rfcCliente)
      .not('uuid_fiscal', 'is', null)
      .order('fecha_emision', { ascending: false })
      .limit(200)
    if (filtroExtra === 'ppd') {
      q = q.eq('tipo_comprobante', 'I').eq('metodo_pago', 'PPD')
    }
    q.then(({ data }) => {
      setFacturas((data as FacturaLite[]) || [])
      setLoading(false)
    })
  }, [rfcCliente, filtroExtra])

  function toggleUuid(uuid: string) {
    if (uuidsSeleccionados.includes(uuid)) {
      onUuidsChange(uuidsSeleccionados.filter(u => u !== uuid))
    } else {
      onUuidsChange([...uuidsSeleccionados, uuid])
    }
  }

  const facturasFiltradas = facturas.filter(f => {
    if (!busqueda) return true
    const b = busqueda.toLowerCase()
    return (
      (f.uuid_fiscal || '').toLowerCase().includes(b) ||
      (f.folio || '').toLowerCase().includes(b) ||
      (f.serie || '').toLowerCase().includes(b)
    )
  })

  const inpStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const lblStyle: React.CSSProperties = { fontSize: 11, color: '#666', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4, display: 'block' }

  const mostrarListado = ocultarTipoRelacion || !!tipoRelacion

  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 10 }}>{titulo}</div>

      {!ocultarTipoRelacion && (
        <div style={{ marginBottom: 10 }}>
          <label style={lblStyle}>Tipo de relacion SAT</label>
          <select value={tipoRelacion} onChange={e => onTipoRelacionChange(e.target.value)} style={inpStyle}>
            <option value="">-- Sin relacion --</option>
            {TIPOS_RELACION_SAT.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {tipoRelacion && (() => {
            const t = TIPOS_RELACION_SAT.find(x => x.value === tipoRelacion)
            return t?.hint ? <div style={{ fontSize: 10, color: '#666', marginTop: 4, fontStyle: 'italic' }}>{t.hint}</div> : null
          })()}
        </div>
      )}

      {mostrarListado && !rfcCliente && (
        <div style={{ fontSize: 11, color: '#f87171', fontStyle: 'italic', padding: 8 }}>
          Selecciona primero un cliente para poder listar sus facturas previas.
        </div>
      )}

      {mostrarListado && rfcCliente && (
        <>
          {uuidsSeleccionados.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <label style={lblStyle}>UUIDs seleccionados ({uuidsSeleccionados.length})</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {uuidsSeleccionados.map(uuid => {
                  const f = facturas.find(x => x.uuid_fiscal === uuid)
                  const label = f ? `${f.serie || ''}${f.folio || ''} - ${uuid.slice(0, 8)}...` : `${uuid.slice(0, 8)}...`
                  return (
                    <div key={uuid} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#A78BFA22', border: '1px solid #A78BFA44', borderRadius: 6, fontSize: 11, color: '#C084FC', fontFamily: 'monospace' }}>
                      <span>{label}</span>
                      <button onClick={() => toggleUuid(uuid)} style={{ background: 'none', border: 'none', color: '#C084FC', cursor: 'pointer', padding: 0, display: 'flex' }}><X size={11} /></button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 8 }}>
            <label style={lblStyle}>Buscar factura por UUID, folio o serie</label>
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Filtrar..." style={inpStyle} />
          </div>

          <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #1a1a1a', borderRadius: 6, background: '#050505' }}>
            {loading && <div style={{ padding: 12, fontSize: 11, color: '#666', textAlign: 'center' }}>Cargando facturas...</div>}
            {!loading && facturasFiltradas.length === 0 && (
              <div style={{ padding: 12, fontSize: 11, color: '#666', textAlign: 'center', fontStyle: 'italic' }}>
                {facturas.length === 0 ? 'No hay facturas emitidas previas a este cliente.' : 'Sin resultados para la busqueda.'}
              </div>
            )}
            {!loading && facturasFiltradas.map(f => {
              const seleccionada = uuidsSeleccionados.includes(f.uuid_fiscal)
              const fecha = f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString('es-MX') : '-'
              return (
                <div
                  key={f.id}
                  onClick={() => toggleUuid(f.uuid_fiscal)}
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid #151515',
                    cursor: 'pointer',
                    background: seleccionada ? '#A78BFA18' : 'transparent',
                    display: 'grid',
                    gridTemplateColumns: '20px 1fr 100px 110px 70px',
                    gap: 8,
                    alignItems: 'center',
                    fontSize: 11,
                  }}
                >
                  <div style={{ color: seleccionada ? '#C084FC' : '#333' }}>
                    {seleccionada ? <CheckCircle2 size={14} /> : <div style={{ width: 14, height: 14, border: '1px solid #333', borderRadius: 3 }} />}
                  </div>
                  <div style={{ fontFamily: 'monospace', color: seleccionada ? '#C084FC' : '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.uuid_fiscal}
                  </div>
                  <div style={{ color: '#888' }}>{f.serie || ''}{f.folio || '-'}</div>
                  <div style={{ color: '#ccc', textAlign: 'right' }}>{(f.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} {f.moneda}</div>
                  <div style={{ color: '#666', fontSize: 10, textAlign: 'right' }}>{fecha}</div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================
// Nueva Factura — form
// ============================================================
function NuevaFactura({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [clientes, setClientes] = useState<ClienteFiscal[]>([])
  const [cotizaciones, setCotizaciones] = useState<QuotationLite[]>([])
  const [clienteId, setClienteId] = useState('')
  const [cotizacionId, setCotizacionId] = useState('')
  const [modoConceptos, setModoConceptos] = useState<'manual' | 'desde_cotizacion'>('manual')
  const [importingItems, setImportingItems] = useState(false)
  const [conceptos, setConceptos] = useState<Concepto[]>([
    { descripcion: '', clave_prod_serv: '81111500', clave_unidad: 'E48', unidad: 'Unidad de servicio', cantidad: 1, valor_unitario: 0, iva_tasa: 0.16 }
  ])
  const [usoCfdi, setUsoCfdi] = useState('G03')
  const [formaPago, setFormaPago] = useState('99')
  const [metodoPago, setMetodoPago] = useState('PUE')
  const [moneda, setMoneda] = useState('MXN')
  const [tipoCambio, setTipoCambio] = useState('1')
  const [notas, setNotas] = useState('')
  const [emitting, setEmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<any>(null)

  // Feature A: Relacionar facturas (CFDI Relacionado)
  const [tipoRelacion, setTipoRelacion] = useState('')
  const [uuidsRelacionados, setUuidsRelacionados] = useState<string[]>([])

  // Feature B: REP (Comprobante de Pago, tipo P)
  const [tipoComprobante, setTipoComprobante] = useState<'I' | 'P'>('I')
  const [fechaPago, setFechaPago] = useState(() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [formaPagoREP, setFormaPagoREP] = useState('03')
  const [monedaPago, setMonedaPago] = useState('MXN')
  const [tipoCambioPago, setTipoCambioPago] = useState('1')
  const [montoPago, setMontoPago] = useState('0')
  const [numOperacion, setNumOperacion] = useState('')
  const [docsPago, setDocsPago] = useState<DocRelacionadoPago[]>([])
  const [mostrarSelectorPPD, setMostrarSelectorPPD] = useState(false)
  const [uuidsPPDTemporales, setUuidsPPDTemporales] = useState<string[]>([])

  // Pre-llenar uso CFDI cuando se selecciona un cliente con preferencia
  useEffect(() => {
    if (!clienteId) return
    const c = clientes.find(x => x.id === clienteId)
    if (c?.uso_cfdi_clave) setUsoCfdi(c.uso_cfdi_clave)
  }, [clienteId, clientes])

  // Al cambiar de cliente, limpiar los UUIDs relacionados (son per-cliente)
  useEffect(() => {
    setUuidsRelacionados([])
  }, [clienteId])

  useEffect(() => {
    Promise.all([
      supabase.from('clientes').select('id,razon_social,rfc,uso_cfdi,uso_cfdi_clave,regimen_fiscal,regimen_fiscal_clave,codigo_postal,email,telefono,calle,num_exterior,num_interior,colonia,municipio,estado,facturapi_customer_id').eq('activo', true).order('razon_social'),
      supabase.from('quotations').select('id,name,client_name,specialty').order('created_at', { ascending: false }).limit(200)
    ]).then(([cli, cot]) => {
      setClientes((cli.data as ClienteFiscal[]) || [])
      setCotizaciones((cot.data as QuotationLite[]) || [])
    })
  }, [])

  // Importar items de cotizacion como conceptos facturables
  async function importarItemsDeCotizacion() {
    if (!cotizacionId) { setError('Selecciona primero una cotizacion'); return }
    setImportingItems(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('quotation_items')
      .select('id,name,description,quantity,cost,markup,price,catalog_product_id,catalog_product:catalog_products(clave_prod_serv,clave_unidad,unit,iva_rate)')
      .eq('quotation_id', cotizacionId)
      .order('order_index')
    if (err) {
      setError('Error al cargar items: ' + err.message)
      setImportingItems(false)
      return
    }
    const items = (data as any[]) || []
    if (items.length === 0) {
      setError('Esta cotizacion no tiene items')
      setImportingItems(false)
      return
    }
    const nuevosConceptos: Concepto[] = items.map(it => {
      const cat = it.catalog_product || {}
      const valorUnit = it.price || (it.cost * (1 + (it.markup || 0) / 100)) || 0
      return {
        descripcion: it.name + (it.description ? ' - ' + it.description : ''),
        clave_prod_serv: cat.clave_prod_serv || '81111500',
        clave_unidad: cat.clave_unidad || 'E48',
        unidad: cat.unit || 'Unidad de servicio',
        cantidad: it.quantity || 1,
        valor_unitario: Math.round(valorUnit * 100) / 100,
        iva_tasa: cat.iva_rate ? Number(cat.iva_rate) : 0.16,
      }
    })
    setConceptos(nuevosConceptos)
    setImportingItems(false)
  }

  function addConcepto() {
    setConceptos([...conceptos, { descripcion: '', clave_prod_serv: '81111500', clave_unidad: 'E48', unidad: 'Unidad de servicio', cantidad: 1, valor_unitario: 0, iva_tasa: 0.16 }])
  }

  function updateConcepto(i: number, field: keyof Concepto, value: any) {
    const next = [...conceptos]
    ;(next[i] as any)[field] = value
    setConceptos(next)
  }

  function removeConcepto(i: number) {
    setConceptos(conceptos.filter((_, idx) => idx !== i))
  }

  const subtotal = conceptos.reduce((s, c) => s + (c.cantidad * c.valor_unitario), 0)
  const iva = conceptos.reduce((s, c) => s + (c.cantidad * c.valor_unitario * c.iva_tasa), 0)
  const total = subtotal + iva

  // REP: helpers para manejar documentos relacionados en el complemento de pagos
  async function agregarDocsPago() {
    // Cargar datos completos de las facturas PPD seleccionadas desde Supabase
    if (uuidsPPDTemporales.length === 0) return
    const { data, error: err } = await supabase
      .from('facturas')
      .select('id,uuid_fiscal,serie,folio,moneda,total')
      .in('uuid_fiscal', uuidsPPDTemporales)
    if (err || !data) {
      setError('Error al cargar facturas PPD: ' + (err?.message || 'desconocido'))
      return
    }
    // Agregar solo las que no estan ya en docsPago
    const uuidsYa = new Set(docsPago.map(d => d.uuid))
    const nuevos: DocRelacionadoPago[] = (data as any[])
      .filter(f => !uuidsYa.has(f.uuid_fiscal))
      .map(f => ({
        factura_local_id: f.id,
        uuid: f.uuid_fiscal,
        serie: f.serie,
        folio: f.folio,
        moneda_doc: f.moneda || 'MXN',
        total_doc: Number(f.total) || 0,
        equivalencia_dr: f.moneda === monedaPago ? 1 : 1, // default 1 — usuario edita
        num_parcialidad: 1,
        imp_saldo_anterior: Number(f.total) || 0, // default = total — usuario edita si ya hay pagos previos
        imp_pagado: 0,
        imp_saldo_insoluto: Number(f.total) || 0,
        objeto_imp: '02',
        iva_tasa: 0.16,
        iva_trasladado: 0,
      }))
    setDocsPago([...docsPago, ...nuevos])
    setUuidsPPDTemporales([])
    setMostrarSelectorPPD(false)
  }

  function updateDocPago(idx: number, field: keyof DocRelacionadoPago, value: any) {
    const next = [...docsPago]
    ;(next[idx] as any)[field] = value
    // Recalcular saldo insoluto y IVA trasladado cuando cambia imp_pagado o saldo_anterior
    if (field === 'imp_pagado' || field === 'imp_saldo_anterior') {
      next[idx].imp_saldo_insoluto = Math.round((next[idx].imp_saldo_anterior - next[idx].imp_pagado) * 100) / 100
    }
    if (field === 'imp_pagado' || field === 'iva_tasa' || field === 'objeto_imp') {
      if (next[idx].objeto_imp === '02') {
        // base para IVA del pago: imp_pagado / (1 + iva_tasa), IVA = base * iva_tasa
        const base = next[idx].imp_pagado / (1 + next[idx].iva_tasa)
        next[idx].iva_trasladado = Math.round((next[idx].imp_pagado - base) * 100) / 100
      } else {
        next[idx].iva_trasladado = 0
      }
    }
    setDocsPago(next)
  }

  function removeDocPago(idx: number) {
    setDocsPago(docsPago.filter((_, i) => i !== idx))
  }

  // Suma de imp_pagado × equivalencia_dr (debe matchear monto pago)
  const sumaDocsEnMonedaPago = docsPago.reduce((s, d) => s + (d.imp_pagado * d.equivalencia_dr), 0)
  const montoPagoNum = parseFloat(montoPago) || 0
  const diferenciaPago = Math.round((montoPagoNum - sumaDocsEnMonedaPago) * 100) / 100

  async function emitir() {
    setError(null)
    if (!clienteId) { setError('Selecciona un cliente'); return }

    // Validaciones segun tipo de comprobante
    if (tipoComprobante === 'I') {
      if (conceptos.length === 0) { setError('Agrega al menos un concepto'); return }
      if (conceptos.some(c => !c.descripcion || c.cantidad <= 0 || c.valor_unitario <= 0)) {
        setError('Completa todos los conceptos: descripcion, cantidad y valor unitario')
        return
      }
    } else {
      // tipoComprobante === 'P' — REP
      if (docsPago.length === 0) { setError('Agrega al menos una factura PPD al pago'); return }
      if (montoPagoNum <= 0) { setError('El monto del pago debe ser mayor a 0'); return }
      if (Math.abs(diferenciaPago) > 0.01) {
        setError(`La suma de imp_pagado × equivalencia (${sumaDocsEnMonedaPago.toFixed(2)}) no coincide con el monto del pago (${montoPagoNum.toFixed(2)}). Diferencia: ${diferenciaPago.toFixed(2)}`)
        return
      }
      if (docsPago.some(d => d.imp_pagado <= 0)) {
        setError('Todos los documentos relacionados deben tener imp_pagado > 0')
        return
      }
      if (docsPago.some(d => d.imp_pagado > d.imp_saldo_anterior + 0.01)) {
        setError('Imp. pagado no puede ser mayor al saldo anterior en ninguna factura')
        return
      }
    }

    const cliente = clientes.find(c => c.id === clienteId)
    if (!cliente) { setError('Cliente no encontrado'); return }

    setEmitting(true)

    try {
      let facturapiCustomerId = cliente.facturapi_customer_id

      if (!facturapiCustomerId) {
        const customerPayload = {
          legal_name: cliente.razon_social,
          tax_id: cliente.rfc,
          tax_system: cliente.regimen_fiscal_clave || cliente.regimen_fiscal || '601',
          email: '',
          address: { zip: cliente.codigo_postal || '01000' }
        }
        const cr = await callFacturapi('create_customer', { method: 'POST', body: { payload: customerPayload } })
        if (!cr.ok) {
          setError('Error al crear cliente en FacturAPI: ' + (cr.data?.message || 'desconocido'))
          setEmitting(false)
          return
        }
        facturapiCustomerId = cr.data.id
        await supabase.from('clientes').update({ facturapi_customer_id: facturapiCustomerId }).eq('id', clienteId)
      }

      // Construir payload segun tipo de comprobante
      let invoicePayload: any
      if (tipoComprobante === 'I') {
        invoicePayload = {
          customer: facturapiCustomerId,
          items: conceptos.map(c => ({
            quantity: c.cantidad,
            product: {
              description: c.descripcion,
              product_key: c.clave_prod_serv,
              price: c.valor_unitario,
              unit_key: c.clave_unidad,
              unit_name: c.unidad,
              tax_included: false,
              taxes: [{ type: 'IVA', rate: c.iva_tasa }]
            }
          })),
          use: usoCfdi,
          payment_form: formaPago,
          payment_method: metodoPago,
          currency: moneda,
        }
        if (moneda !== 'MXN') invoicePayload.exchange = parseFloat(tipoCambio) || 1

        // Feature A: CFDIs relacionados (con validaciones cruzadas) — solo para tipo I
        if (tipoRelacion && uuidsRelacionados.length === 0) {
          setError('Seleccionaste un tipo de relacion pero no agregaste facturas a relacionar')
          setEmitting(false)
          return
        }
        if (!tipoRelacion && uuidsRelacionados.length > 0) {
          setError('Agregaste facturas a relacionar pero no seleccionaste un tipo de relacion SAT')
          setEmitting(false)
          return
        }
        if (tipoRelacion && uuidsRelacionados.length > 0) {
          invoicePayload.related_documents = [{
            relationship: tipoRelacion,
            documents: uuidsRelacionados,
          }]
        }
      } else {
        // REP (tipo P) — Complemento de Pagos 2.0
        // Header: 1 item generico con clave SAT 84111506, price=0, sin impuestos
        // Uso CFDI obligatorio: CP01 (Pagos)
        // Forma pago header: 99 (por definir), Metodo: PUE
        invoicePayload = {
          customer: facturapiCustomerId,
          type: 'P',
          items: [{
            quantity: 1,
            product: {
              description: 'Pago',
              product_key: '84111506',
              price: 0,
              unit_key: 'ACT',
              unit_name: 'Actividad',
              tax_included: false,
              taxes: [],
            }
          }],
          use: 'CP01',
          payment_form: '99',
          payment_method: 'PUE',
          currency: 'XXX',
          complements: [{
            type: 'pago',
            data: [{
              payment_form: formaPagoREP,
              date: fechaPago,
              currency: monedaPago,
              exchange: monedaPago !== 'MXN' ? (parseFloat(tipoCambioPago) || 1) : undefined,
              amount: montoPagoNum,
              ...(numOperacion ? { num_operation: numOperacion } : {}),
              related_documents: docsPago.map(d => ({
                uuid: d.uuid,
                folio: d.folio || undefined,
                series: d.serie || undefined,
                currency: d.moneda_doc,
                exchange: d.equivalencia_dr,
                payment_number: d.num_parcialidad,
                previous_balance: d.imp_saldo_anterior,
                amount_paid: d.imp_pagado,
                balance: d.imp_saldo_insoluto,
                taxability: d.objeto_imp,
                ...(d.objeto_imp === '02' && d.iva_trasladado > 0 ? {
                  taxes: [{ type: 'IVA', rate: d.iva_tasa, base: d.imp_pagado - d.iva_trasladado, amount: d.iva_trasladado, withholding: false }]
                } : {}),
              })),
            }]
          }],
        }
      }

      const ir = await callFacturapi('create_invoice', { method: 'POST', body: { payload: invoicePayload } })
      if (!ir.ok) {
        setError('Error al emitir: ' + (ir.data?.message || JSON.stringify(ir.data).slice(0, 300)))
        setEmitting(false)
        return
      }

      const invoice = ir.data

      const facturaSupabase: any = tipoComprobante === 'I' ? {
        direccion: 'emitida',
        cliente_id: clienteId,
        facturapi_id: invoice.id,
        facturapi_customer_id: facturapiCustomerId,
        uuid_fiscal: invoice.uuid || null,
        serie: invoice.series || null,
        folio: invoice.folio_number ? String(invoice.folio_number) : null,
        tipo_comprobante: invoice.type || 'I',
        fecha_emision: invoice.date || new Date().toISOString(),
        fecha_timbrado: invoice.stamp?.date || null,
        status: invoice.status === 'valid' ? 'timbrada' : 'borrador',
        receptor_rfc: cliente.rfc,
        receptor_nombre: cliente.razon_social,
        receptor_uso_cfdi: usoCfdi,
        receptor_regimen_fiscal: cliente.regimen_fiscal_clave || cliente.regimen_fiscal,
        receptor_codigo_postal: cliente.codigo_postal,
        subtotal,
        iva,
        total,
        moneda,
        tipo_cambio: moneda !== 'MXN' ? parseFloat(tipoCambio) : null,
        forma_pago: formaPago,
        metodo_pago: metodoPago,
        quotation_id: cotizacionId || null,
        notas: notas || null,
        tipo_relacion: tipoRelacion || null,
        uuids_relacionados: uuidsRelacionados.length > 0 ? uuidsRelacionados : null,
        sandbox: getCurrentFacturapiMode() === 'test',
      } : {
        // REP (tipo P) — Comprobante de Pago
        direccion: 'emitida',
        cliente_id: clienteId,
        facturapi_id: invoice.id,
        facturapi_customer_id: facturapiCustomerId,
        uuid_fiscal: invoice.uuid || null,
        serie: invoice.series || null,
        folio: invoice.folio_number ? String(invoice.folio_number) : null,
        tipo_comprobante: 'P',
        fecha_emision: invoice.date || new Date().toISOString(),
        fecha_timbrado: invoice.stamp?.date || null,
        status: invoice.status === 'valid' ? 'timbrada' : 'borrador',
        receptor_rfc: cliente.rfc,
        receptor_nombre: cliente.razon_social,
        receptor_uso_cfdi: 'CP01',
        receptor_regimen_fiscal: cliente.regimen_fiscal_clave || cliente.regimen_fiscal,
        receptor_codigo_postal: cliente.codigo_postal,
        // En REP el header SAT va en 0; el monto real es el del complemento de pago.
        // Guardamos el monto en `total` para que computeAmounts() y los KPIs lo usen.
        subtotal: montoPagoNum,
        iva: 0,
        total: montoPagoNum,
        moneda: monedaPago,
        tipo_cambio: monedaPago !== 'MXN' ? (parseFloat(tipoCambioPago) || 1) : null,
        forma_pago: formaPagoREP,
        metodo_pago: 'PUE',
        notas: notas || null,
        // uuids_relacionados = union de todos los UUIDs de documentos pagados
        // (util para el Monitor de Anticipos y queries de cobranza)
        uuids_relacionados: docsPago.map(d => d.uuid),
        sandbox: getCurrentFacturapiMode() === 'test',
      }

      const { data: created, error: insErr } = await supabase.from('facturas').insert(facturaSupabase).select().single()
      if (insErr) {
        setError('Factura emitida en FacturAPI pero error al guardar local: ' + insErr.message + '. UUID: ' + invoice.uuid)
        setEmitting(false)
        return
      }

      if (created && tipoComprobante === 'I') {
        const conceptoInserts = conceptos.map((c, i) => ({
          factura_id: (created as any).id,
          descripcion: c.descripcion,
          clave_prod_serv: c.clave_prod_serv,
          clave_unidad: c.clave_unidad,
          unidad: c.unidad,
          cantidad: c.cantidad,
          valor_unitario: c.valor_unitario,
          importe: c.cantidad * c.valor_unitario,
          iva_tasa: c.iva_tasa,
          iva_importe: c.cantidad * c.valor_unitario * c.iva_tasa,
          order_index: i
        }))
        await supabase.from('factura_conceptos').insert(conceptoInserts)
      }

      setResultado(invoice)
      setEmitting(false)
    } catch (err: any) {
      setError('Error: ' + (err.message || 'desconocido'))
      setEmitting(false)
    }
  }

  if (resultado) {
    return (
      <div style={{ background: '#0e1f12', border: '1px solid #57FF9A33', borderRadius: 12, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <CheckCircle2 size={20} style={{ color: '#57FF9A' }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Factura emitida exitosamente</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, fontSize: 12 }}>
          <div><span style={{ color: '#666' }}>UUID:</span> <span style={{ color: '#ccc', fontFamily: 'monospace' }}>{resultado.uuid}</span></div>
          <div><span style={{ color: '#666' }}>Folio:</span> <span style={{ color: '#ccc' }}>{resultado.series}{resultado.folio_number}</span></div>
          <div><span style={{ color: '#666' }}>Total:</span> <span style={{ color: '#57FF9A', fontWeight: 600 }}>{(resultado.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} {resultado.currency}</span></div>
          <div><span style={{ color: '#666' }}>Status:</span> <span style={{ color: '#57FF9A' }}>{resultado.status}</span></div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={`/api/facturapi?action=download_pdf&id=${resultado.id}`} target="_blank" rel="noopener noreferrer" style={{ padding: '8px 14px', background: '#1e1e1e', color: '#A78BFA', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download size={12} /> Descargar PDF
          </a>
          <a href={`/api/facturapi?action=download_xml&id=${resultado.id}`} target="_blank" rel="noopener noreferrer" style={{ padding: '8px 14px', background: '#1e1e1e', color: '#A78BFA', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download size={12} /> Descargar XML
          </a>
          <button onClick={onCreated} style={{ padding: '8px 14px', background: '#57FF9A', color: '#000', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Volver al listado
          </button>
        </div>
      </div>
    )
  }

  const inpStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const lblStyle: React.CSSProperties = { fontSize: 11, color: '#666', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4, display: 'block' }

  return (
    <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 12, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
          {tipoComprobante === 'I' ? 'Nueva factura' : 'Nuevo comprobante de pago (REP)'}
        </div>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
      </div>

      {error && <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: 12, color: '#f87171', fontSize: 12, marginBottom: 16 }}>{error}</div>}

      {/* Toggle tipo de comprobante */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 10 }}>Tipo de comprobante</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setTipoComprobante('I')} style={{
            padding: '10px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${tipoComprobante === 'I' ? '#57FF9A' : '#2a2a2a'}`,
            background: tipoComprobante === 'I' ? '#57FF9A18' : 'transparent',
            color: tipoComprobante === 'I' ? '#57FF9A' : '#888',
          }}>Factura (tipo I — Ingreso)</button>
          <button onClick={() => setTipoComprobante('P')} style={{
            padding: '10px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${tipoComprobante === 'P' ? '#A78BFA' : '#2a2a2a'}`,
            background: tipoComprobante === 'P' ? '#A78BFA18' : 'transparent',
            color: tipoComprobante === 'P' ? '#C084FC' : '#888',
          }}>Comprobante de Pago (tipo P — REP)</button>
        </div>
        {tipoComprobante === 'P' && (
          <div style={{ marginTop: 8, fontSize: 10, color: '#666', fontStyle: 'italic' }}>
            Complemento de Pagos 2.0 — para registrar pagos recibidos sobre facturas PPD previamente emitidas.
            Los totales fiscales del header van en 0; el monto real va en el complemento.
          </div>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 10 }}>Cliente y vinculacion</div>
        <div style={{ display: 'grid', gridTemplateColumns: tipoComprobante === 'I' ? '1fr 1fr' : '1fr', gap: 12 }}>
          <div>
            <label style={lblStyle}>Cliente *</label>
            <select value={clienteId} onChange={e => setClienteId(e.target.value)} style={inpStyle}>
              <option value="">-- Selecciona un cliente --</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.razon_social} ({c.rfc})</option>)}
            </select>
          </div>
          {tipoComprobante === 'I' && (
            <div>
              <label style={lblStyle}>Cotizacion (opcional)</label>
              <select value={cotizacionId} onChange={e => setCotizacionId(e.target.value)} style={inpStyle}>
                <option value="">-- Sin vinculacion --</option>
                {cotizaciones.map(c => <option key={c.id} value={c.id}>{c.name} - {c.client_name}</option>)}
              </select>
            </div>
          )}
        </div>
        {clienteId && (() => {
          const c = clientes.find(x => x.id === clienteId)
          if (!c) return null
          const checks = [
            { label: 'RFC', value: c.rfc, ok: !!c.rfc && c.rfc.length >= 12 },
            { label: 'Razon social', value: c.razon_social, ok: !!c.razon_social },
            { label: 'Regimen fiscal', value: c.regimen_fiscal_clave ? c.regimen_fiscal_clave + ' - ' + (c.regimen_fiscal || '') : (c.regimen_fiscal || ''), ok: !!c.regimen_fiscal_clave },
            { label: 'Codigo postal', value: c.codigo_postal, ok: !!c.codigo_postal && c.codigo_postal.length === 5 },
            { label: 'Uso CFDI default', value: c.uso_cfdi_clave ? c.uso_cfdi_clave + ' - ' + (c.uso_cfdi || '') : (c.uso_cfdi || 'no definido'), ok: !!c.uso_cfdi_clave, optional: true },
            { label: 'Email', value: c.email, ok: !!c.email, optional: true },
          ]
          const direccion = [c.calle, c.num_exterior, c.num_interior, c.colonia, c.municipio, c.estado].filter(Boolean).join(' ')
          const faltanCriticos = checks.filter(ck => !ck.ok && !ck.optional).length > 0
          return (
            <div style={{ marginTop: 12, background: faltanCriticos ? '#3a1a1a' : '#0a1f0e', border: '1px solid ' + (faltanCriticos ? '#5a2a2a' : '#1a3a1f'), borderRadius: 8, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: faltanCriticos ? '#f87171' : '#57FF9A', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{faltanCriticos ? 'Datos fiscales incompletos' : 'Datos fiscales del cliente'}</div>
                {c.facturapi_customer_id && <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>FacturAPI: {c.facturapi_customer_id.slice(0, 12)}...</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
                {checks.map(ck => (
                  <div key={ck.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {ck.ok ? <CheckCircle2 size={11} style={{ color: '#57FF9A', flexShrink: 0 }} /> : <AlertCircle size={11} style={{ color: ck.optional ? '#666' : '#EF4444', flexShrink: 0 }} />}
                    <span style={{ color: '#888', minWidth: 90 }}>{ck.label}:</span>
                    <span style={{ color: ck.ok ? '#ddd' : (ck.optional ? '#666' : '#f87171'), fontFamily: ck.label === 'RFC' ? 'monospace' : 'inherit' }}>{ck.value || '-- falta --'}</span>
                  </div>
                ))}
              </div>
              {direccion && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + (faltanCriticos ? '#5a2a2a' : '#1a3a1f'), fontSize: 10, color: '#888' }}>
                  <span style={{ color: '#666' }}>Direccion: </span>{direccion}
                </div>
              )}
              {faltanCriticos && (
                <div style={{ marginTop: 10, fontSize: 10, color: '#f87171', fontStyle: 'italic' }}>
                  Faltan datos fiscales criticos. Completalos en el modulo Clientes antes de emitir o FacturAPI rechazara el timbrado.
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {tipoComprobante === 'I' && <>
      {/* Feature A: Relacionar facturas (CFDI Relacionado) */}
      <div style={{ marginBottom: 20 }}>
        <SelectorFacturasRelacionadas
          rfcCliente={clienteId ? (clientes.find(c => c.id === clienteId)?.rfc || null) : null}
          tipoRelacion={tipoRelacion}
          onTipoRelacionChange={setTipoRelacion}
          uuidsSeleccionados={uuidsRelacionados}
          onUuidsChange={setUuidsRelacionados}
          titulo="Relacionar con facturas previas (opcional)"
        />
      </div>

      {/* Toggle modo conceptos */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 10 }}>Modo de captura de conceptos</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setModoConceptos('manual')} style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${modoConceptos === 'manual' ? '#57FF9A' : '#2a2a2a'}`,
            background: modoConceptos === 'manual' ? '#57FF9A18' : 'transparent',
            color: modoConceptos === 'manual' ? '#57FF9A' : '#888',
          }}>Manual (concepto agrupado)</button>
          <button onClick={() => setModoConceptos('desde_cotizacion')} style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${modoConceptos === 'desde_cotizacion' ? '#A78BFA' : '#2a2a2a'}`,
            background: modoConceptos === 'desde_cotizacion' ? '#A78BFA18' : 'transparent',
            color: modoConceptos === 'desde_cotizacion' ? '#C084FC' : '#888',
          }}>Desde cotizacion (items del catalogo)</button>
        </div>
        {modoConceptos === 'desde_cotizacion' && (
          <div style={{ marginTop: 10, padding: 12, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
              Selecciona la cotizacion arriba e importa sus items. Cada producto del catalogo se convertira en un concepto facturable editable.
            </div>
            <button onClick={importarItemsDeCotizacion} disabled={!cotizacionId || importingItems} style={{
              padding: '8px 14px', background: '#1e1e1e', color: cotizacionId ? '#A78BFA' : '#444', border: `1px solid ${cotizacionId ? '#A78BFA44' : '#2a2a2a'}`, borderRadius: 8,
              fontSize: 12, fontWeight: 600, cursor: cotizacionId && !importingItems ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', gap: 6
            }}>
              {importingItems ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Importando...</> : <>Importar items de la cotizacion seleccionada</>}
            </button>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#888' }}>Conceptos a facturar ({conceptos.length})</div>
          <button onClick={addConcepto} style={{ padding: '4px 10px', background: '#1e1e1e', color: '#ccc', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={10} /> Agregar concepto
          </button>
        </div>
        {conceptos.map((c, i) => (
          <div key={i} style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 24px', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={lblStyle}>Descripcion *</label>
                <input value={c.descripcion} onChange={e => updateConcepto(i, 'descripcion', e.target.value)} placeholder="Servicio integral de red de oficinas" style={inpStyle} />
              </div>
              <div>
                <label style={lblStyle}>Clave SAT prod/serv</label>
                <input value={c.clave_prod_serv} onChange={e => updateConcepto(i, 'clave_prod_serv', e.target.value)} placeholder="81111500" style={inpStyle} />
              </div>
              <div>
                <label style={lblStyle}>Clave unidad</label>
                <input value={c.clave_unidad} onChange={e => updateConcepto(i, 'clave_unidad', e.target.value)} placeholder="E48" style={inpStyle} />
              </div>
              <button onClick={() => removeConcepto(i)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0, alignSelf: 'end', height: 32 }}><Trash2 size={14} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
              <div>
                <label style={lblStyle}>Unidad</label>
                <input value={c.unidad} onChange={e => updateConcepto(i, 'unidad', e.target.value)} placeholder="Unidad de servicio" style={inpStyle} />
              </div>
              <div>
                <label style={lblStyle}>Cantidad *</label>
                <input type="number" value={c.cantidad} onChange={e => updateConcepto(i, 'cantidad', parseFloat(e.target.value) || 0)} style={inpStyle} />
              </div>
              <div>
                <label style={lblStyle}>Valor unitario *</label>
                <input type="number" value={c.valor_unitario} onChange={e => updateConcepto(i, 'valor_unitario', parseFloat(e.target.value) || 0)} style={inpStyle} />
              </div>
              <div>
                <label style={lblStyle}>IVA</label>
                <select value={c.iva_tasa} onChange={e => updateConcepto(i, 'iva_tasa', parseFloat(e.target.value))} style={inpStyle}>
                  <option value="0.16">16%</option>
                  <option value="0.08">8% frontera</option>
                  <option value="0">0% exento</option>
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 10 }}>Configuracion fiscal</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={lblStyle}>Uso CFDI</label>
            <select value={usoCfdi} onChange={e => setUsoCfdi(e.target.value)} style={inpStyle}>
              <option value="G01">G01 - Adquisicion de mercancias</option>
              <option value="G03">G03 - Gastos en general</option>
              <option value="P01">P01 - Por definir</option>
              <option value="I04">I04 - Equipo de computo</option>
              <option value="I06">I06 - Comunicaciones telefonicas</option>
              <option value="I08">I08 - Otra maquinaria</option>
            </select>
          </div>
          <div>
            <label style={lblStyle}>Forma de pago</label>
            <select value={formaPago} onChange={e => setFormaPago(e.target.value)} style={inpStyle}>
              <option value="01">01 - Efectivo</option>
              <option value="02">02 - Cheque nominativo</option>
              <option value="03">03 - Transferencia</option>
              <option value="04">04 - Tarjeta de credito</option>
              <option value="28">28 - Tarjeta de debito</option>
              <option value="99">99 - Por definir</option>
            </select>
          </div>
          <div>
            <label style={lblStyle}>Metodo de pago</label>
            <select value={metodoPago} onChange={e => setMetodoPago(e.target.value)} style={inpStyle}>
              <option value="PUE">PUE - Pago en una sola exhibicion</option>
              <option value="PPD">PPD - Pago en parcialidades</option>
            </select>
          </div>
          <div>
            <label style={lblStyle}>Moneda</label>
            <select value={moneda} onChange={e => setMoneda(e.target.value)} style={inpStyle}>
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>
        {moneda !== 'MXN' && (
          <div style={{ marginTop: 8 }}>
            <label style={lblStyle}>Tipo de cambio</label>
            <input type="number" value={tipoCambio} onChange={e => setTipoCambio(e.target.value)} style={{ ...inpStyle, maxWidth: 200 }} />
          </div>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={lblStyle}>Notas internas</label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)} style={{ ...inpStyle, minHeight: 50, fontFamily: 'inherit', resize: 'vertical' }} />
      </div>

      <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 8, padding: 14, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888', marginBottom: 4 }}>
          <span>Subtotal</span><span>{subtotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })} {moneda}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888', marginBottom: 4 }}>
          <span>IVA</span><span>{iva.toLocaleString('es-MX', { minimumFractionDigits: 2 })} {moneda}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#57FF9A', fontWeight: 700, marginTop: 8 }}>
          <span>Total</span><span>{total.toLocaleString('es-MX', { minimumFractionDigits: 2 })} {moneda}</span>
        </div>
      </div>
      </>}

      {tipoComprobante === 'P' && <>
        {/* Datos del pago (cabecera del complemento) */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 10 }}>Datos del pago</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lblStyle}>Fecha y hora del pago *</label>
              <input type="datetime-local" value={fechaPago} onChange={e => setFechaPago(e.target.value)} style={inpStyle} />
            </div>
            <div>
              <label style={lblStyle}>Forma de pago *</label>
              <select value={formaPagoREP} onChange={e => setFormaPagoREP(e.target.value)} style={inpStyle}>
                <option value="01">01 - Efectivo</option>
                <option value="02">02 - Cheque nominativo</option>
                <option value="03">03 - Transferencia</option>
                <option value="04">04 - Tarjeta de credito</option>
                <option value="28">28 - Tarjeta de debito</option>
                <option value="99">99 - Por definir</option>
              </select>
            </div>
            <div>
              <label style={lblStyle}>Num operacion (opcional)</label>
              <input value={numOperacion} onChange={e => setNumOperacion(e.target.value)} placeholder="Ref, cheque..." style={inpStyle} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={lblStyle}>Moneda del pago *</label>
              <select value={monedaPago} onChange={e => setMonedaPago(e.target.value)} style={inpStyle}>
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label style={lblStyle}>Tipo de cambio del pago</label>
              <input type="number" value={tipoCambioPago} onChange={e => setTipoCambioPago(e.target.value)} disabled={monedaPago === 'MXN'} style={{ ...inpStyle, opacity: monedaPago === 'MXN' ? 0.4 : 1 }} />
            </div>
            <div>
              <label style={lblStyle}>Monto del pago * ({monedaPago})</label>
              <input type="number" value={montoPago} onChange={e => setMontoPago(e.target.value)} style={inpStyle} />
            </div>
          </div>
        </div>

        {/* Facturas PPD relacionadas */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#888' }}>Facturas PPD pagadas ({docsPago.length})</div>
            {clienteId && (
              <button onClick={() => setMostrarSelectorPPD(!mostrarSelectorPPD)} style={{
                padding: '6px 12px', background: '#1e1e1e', color: '#A78BFA', border: '1px solid #A78BFA44', borderRadius: 6,
                fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
              }}>
                <Plus size={12} /> {mostrarSelectorPPD ? 'Cerrar selector' : 'Agregar factura PPD'}
              </button>
            )}
          </div>

          {!clienteId && (
            <div style={{ padding: 14, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 8, fontSize: 11, color: '#666', fontStyle: 'italic' }}>
              Selecciona primero un cliente para poder agregar sus facturas PPD.
            </div>
          )}

          {mostrarSelectorPPD && clienteId && (
            <div style={{ marginBottom: 12 }}>
              <SelectorFacturasRelacionadas
                rfcCliente={clientes.find(c => c.id === clienteId)?.rfc || null}
                tipoRelacion=""
                onTipoRelacionChange={() => {}}
                uuidsSeleccionados={uuidsPPDTemporales}
                onUuidsChange={setUuidsPPDTemporales}
                filtroExtra="ppd"
                titulo="Seleccionar facturas PPD a pagar"
                ocultarTipoRelacion={true}
              />
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button onClick={() => { setUuidsPPDTemporales([]); setMostrarSelectorPPD(false) }} style={{ padding: '6px 12px', background: '#1e1e1e', color: '#888', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
                <button onClick={agregarDocsPago} disabled={uuidsPPDTemporales.length === 0} style={{ padding: '6px 12px', background: uuidsPPDTemporales.length > 0 ? '#A78BFA' : '#333', color: uuidsPPDTemporales.length > 0 ? '#000' : '#666', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: uuidsPPDTemporales.length > 0 ? 'pointer' : 'not-allowed' }}>Agregar {uuidsPPDTemporales.length} factura(s)</button>
              </div>
            </div>
          )}

          {docsPago.length === 0 && !mostrarSelectorPPD && clienteId && (
            <div style={{ padding: 14, background: '#0a0a0a', border: '1px dashed #2a2a2a', borderRadius: 8, fontSize: 11, color: '#666', fontStyle: 'italic', textAlign: 'center' }}>
              No hay facturas PPD agregadas. Haz clic en "Agregar factura PPD" para seleccionarlas del listado.
            </div>
          )}

          {docsPago.map((d, idx) => (
            <div key={d.uuid} style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 8, padding: 14, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#C084FC', fontFamily: 'monospace' }}>
                  {d.serie || ''}{d.folio || '-'} — {d.uuid.slice(0, 8)}... <span style={{ color: '#666' }}>({d.total_doc.toLocaleString('es-MX', { minimumFractionDigits: 2 })} {d.moneda_doc})</span>
                </div>
                <button onClick={() => removeDocPago(idx)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0 }}><Trash2 size={12} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={lblStyle}>Equiv. DR</label>
                  <input type="number" step="0.0001" value={d.equivalencia_dr} onChange={e => updateDocPago(idx, 'equivalencia_dr', parseFloat(e.target.value) || 1)} style={inpStyle} />
                </div>
                <div>
                  <label style={lblStyle}>Parcialidad #</label>
                  <input type="number" value={d.num_parcialidad} onChange={e => updateDocPago(idx, 'num_parcialidad', parseInt(e.target.value) || 1)} style={inpStyle} />
                </div>
                <div>
                  <label style={lblStyle}>Saldo anterior</label>
                  <input type="number" step="0.01" value={d.imp_saldo_anterior} onChange={e => updateDocPago(idx, 'imp_saldo_anterior', parseFloat(e.target.value) || 0)} style={inpStyle} />
                </div>
                <div>
                  <label style={lblStyle}>Imp. pagado *</label>
                  <input type="number" step="0.01" value={d.imp_pagado} onChange={e => updateDocPago(idx, 'imp_pagado', parseFloat(e.target.value) || 0)} style={{ ...inpStyle, borderColor: '#A78BFA44' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <label style={lblStyle}>Saldo insoluto</label>
                  <input type="number" value={d.imp_saldo_insoluto.toFixed(2)} disabled style={{ ...inpStyle, opacity: 0.6 }} />
                </div>
                <div>
                  <label style={lblStyle}>Objeto imp.</label>
                  <select value={d.objeto_imp} onChange={e => updateDocPago(idx, 'objeto_imp', e.target.value)} style={inpStyle}>
                    <option value="01">01 - No objeto</option>
                    <option value="02">02 - Si objeto</option>
                    <option value="03">03 - Si objeto y no obligado</option>
                  </select>
                </div>
                <div>
                  <label style={lblStyle}>IVA tasa</label>
                  <select value={d.iva_tasa} onChange={e => updateDocPago(idx, 'iva_tasa', parseFloat(e.target.value))} disabled={d.objeto_imp !== '02'} style={{ ...inpStyle, opacity: d.objeto_imp !== '02' ? 0.4 : 1 }}>
                    <option value="0.16">16%</option>
                    <option value="0.08">8%</option>
                    <option value="0">0%</option>
                  </select>
                </div>
                <div>
                  <label style={lblStyle}>IVA trasladado</label>
                  <input type="number" value={d.iva_trasladado.toFixed(2)} disabled style={{ ...inpStyle, opacity: 0.6 }} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Notas REP */}
        <div style={{ marginBottom: 20 }}>
          <label style={lblStyle}>Notas internas</label>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} style={{ ...inpStyle, minHeight: 50, fontFamily: 'inherit', resize: 'vertical' }} />
        </div>

        {/* Validacion visual: suma docs vs monto pago */}
        <div style={{ background: Math.abs(diferenciaPago) < 0.01 ? '#0a1f0e' : '#3a1a1a', border: '1px solid ' + (Math.abs(diferenciaPago) < 0.01 ? '#1a3a1f' : '#5a2a2a'), borderRadius: 8, padding: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Validacion del complemento</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888', marginBottom: 4 }}>
            <span>Σ (Imp. pagado × Equiv. DR)</span>
            <span style={{ fontFamily: 'monospace' }}>{sumaDocsEnMonedaPago.toLocaleString('es-MX', { minimumFractionDigits: 2 })} {monedaPago}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888', marginBottom: 4 }}>
            <span>Monto del pago declarado</span>
            <span style={{ fontFamily: 'monospace' }}>{montoPagoNum.toLocaleString('es-MX', { minimumFractionDigits: 2 })} {monedaPago}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginTop: 8, color: Math.abs(diferenciaPago) < 0.01 ? '#57FF9A' : '#f87171' }}>
            <span>Diferencia</span>
            <span style={{ fontFamily: 'monospace' }}>{diferenciaPago.toLocaleString('es-MX', { minimumFractionDigits: 2 })} {monedaPago}</span>
          </div>
          {Math.abs(diferenciaPago) >= 0.01 && (
            <div style={{ fontSize: 10, color: '#f87171', fontStyle: 'italic', marginTop: 6 }}>
              La suma de imp_pagado × equivalencia debe ser igual al monto del pago (tolerancia ±0.01).
            </div>
          )}
        </div>
      </>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={{ padding: '10px 20px', background: '#1e1e1e', color: '#ccc', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
        <button onClick={emitir} disabled={emitting} style={{ padding: '10px 20px', background: emitting ? '#444' : (tipoComprobante === 'P' ? '#A78BFA' : '#57FF9A'), color: '#000', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: emitting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          {emitting ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Emitiendo...</> : (tipoComprobante === 'P' ? 'Emitir REP' : 'Emitir factura')}
        </button>
      </div>
    </div>
  )
}

// ============================================================
// Lista Recibidas
// ============================================================
function ListaRecibidas() {
  const [recibidas, setRecibidas] = useState<Factura[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState('')
  // Navegacion mensual
  const [monthOffset, setMonthOffset] = useState(0)
  const now = new Date()
  const monthDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999)
  const monthLabel = monthDate.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
  const monthLabelCapitalized = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)
  const inSelectedMonth = (fechaStr: string | null | undefined) => {
    if (!fechaStr) return false
    const d = new Date(fechaStr)
    if (isNaN(d.getTime())) return false
    return d >= monthStart && d <= monthEnd
  }

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('facturas').select('*').eq('direccion', 'recibida').order('fecha_emision', { ascending: false }).limit(500)
    setRecibidas((data as Factura[]) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Sincronizar facturas RECIBIDAS desde FacturAPI con issuer_type=received
  async function sincronizar() {
    setSyncing(true)
    let totalImported = 0
    let totalErrors = 0
    let page = 1
    const maxPages = 60 // tope de seguridad (3000 facturas)
    while (page <= maxPages) {
      const r = await callFacturapi('list_invoices', { query: { limit: '50', page: String(page), issuer_type: 'receiving' } })
      if (!r.ok || !r.data?.data || r.data.data.length === 0) break
      for (const inv of r.data.data) {
        const amounts = computeAmounts(inv)
        const payload: any = {
          direccion: 'recibida',
          facturapi_id: inv.id,
          uuid_fiscal: inv.uuid || null,
          serie: inv.series || null,
          folio: inv.folio_number ? String(inv.folio_number) : null,
          status: inv.status === 'valid' ? 'timbrada' : inv.status === 'canceled' ? 'cancelada' : 'borrador',
          fecha_emision: inv.date || null,
          fecha_timbrado: inv.stamp?.date || null,
          // Emisor (proveedor que nos facturo) - usa issuer_info de FacturAPI v2
          emisor_rfc: inv.issuer_info?.tax_id || 'XAXX010101000',
          emisor_nombre: inv.issuer_info?.legal_name || 'Sin nombre',
          emisor_regimen_fiscal: inv.issuer_info?.tax_system || null,
          // Receptor (somos nosotros - OMM)
          receptor_rfc: inv.customer?.tax_id || 'OTE210910PW5',
          receptor_nombre: inv.customer?.legal_name || 'OMM Technologies SA de CV',
          receptor_regimen_fiscal: inv.customer?.tax_system || null,
          receptor_uso_cfdi: inv.use || null,
          receptor_codigo_postal: inv.customer?.address?.zip || inv.address?.zip || null,
          subtotal: amounts.subtotal,
          iva: amounts.iva,
          total: amounts.total,
          moneda: inv.currency || 'MXN',
          forma_pago: inv.payment_form || null,
          metodo_pago: inv.payment_method || null,
          tipo_comprobante: inv.type || 'I',
          tipo_relacion: Array.isArray(inv.related_documents) && inv.related_documents.length > 0
            ? (inv.related_documents[0].relationship || null) : null,
          uuids_relacionados: Array.isArray(inv.related_documents) && inv.related_documents.length > 0
            ? inv.related_documents.flatMap((rd) => Array.isArray(rd.documents) ? rd.documents : [])
            : null,
          sandbox: getCurrentFacturapiMode() === 'test',
        }
        try {
          const { data: existing } = await supabase.from('facturas').select('id').eq('facturapi_id', inv.id).maybeSingle()
          let facturaId: string | null = null
          if (existing) {
            const { error } = await supabase.from('facturas').update(payload).eq('id', (existing as any).id)
            if (error) totalErrors++
            else { facturaId = (existing as any).id; totalImported++ }
          } else {
            const { data: ins, error } = await supabase.from('facturas').insert(payload).select('id').single()
            if (error) totalErrors++
            else { facturaId = (ins as any)?.id; totalImported++ }
          }
          if (facturaId && Array.isArray(inv.items) && inv.items.length > 0) {
            await saveInvoiceItems(facturaId, inv.items)
          }
        } catch {
          totalErrors++
        }
      }
      // Use total_pages for reliable pagination
      const tpR = r.data.total_pages || 1
      if (page >= tpR) break
      page++
    }
    await load()
    setSyncing(false)
    if (totalErrors > 0) {
      alert('Sincronizacion completada: ' + totalImported + ' facturas, ' + totalErrors + ' errores')
    } else {
      alert('Sincronizacion completada: ' + totalImported + ' facturas recibidas importadas')
    }
  }

  // Filtrar por mes y luego por busqueda
  const recibidasMes = recibidas.filter(f => inSelectedMonth(f.fecha_emision))
  const filtered = recibidasMes.filter(f => {
    if (!search) return true
    const q = search.toLowerCase()
    return (f.emisor_nombre || '').toLowerCase().includes(q) ||
      (f.emisor_rfc || '').toLowerCase().includes(q) ||
      (f.uuid_fiscal || '').toLowerCase().includes(q) ||
      (f.folio || '').toLowerCase().includes(q)
  })

  return (
    <div>
      {/* Navegador mensual */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '10px 14px', background: '#141414', border: '1px solid #222', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setMonthOffset(monthOffset - 1)} style={{ padding: '6px 10px', fontSize: 12, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', cursor: 'pointer', fontFamily: 'inherit' }}>◀ Mes anterior</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', minWidth: 160, textAlign: 'center' as const }}>{monthLabelCapitalized}</span>
          <button onClick={() => setMonthOffset(monthOffset + 1)} style={{ padding: '6px 10px', fontSize: 12, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', cursor: 'pointer', fontFamily: 'inherit' }}>Mes siguiente ▶</button>
          {monthOffset !== 0 && (
            <button onClick={() => setMonthOffset(0)} style={{ padding: '6px 10px', fontSize: 11, background: 'rgba(87,255,154,0.08)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 6, color: '#57FF9A', cursor: 'pointer', fontFamily: 'inherit' }}>Hoy</button>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#666' }}>
          {recibidasMes.length} factura{recibidasMes.length !== 1 ? 's' : ''} en {monthLabelCapitalized}
        </div>
      </div>

      {/* Search bar + sync */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#555' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por proveedor, RFC, UUID o folio..." style={{ width: '100%', padding: '8px 12px 8px 32px', background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }} />
        </div>
        <button onClick={sincronizar} disabled={syncing} style={{ padding: '8px 14px', background: '#1e1e1e', color: '#ccc', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: syncing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
          {syncing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
          {syncing ? 'Sincronizando...' : 'Sincronizar con FacturAPI'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' as const, color: '#555' }}>Cargando...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center' as const, color: '#555', background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 12 }}>
          <FileText size={32} style={{ color: '#333', marginBottom: 12 }} />
          <div style={{ fontSize: 14, marginBottom: 6 }}>{search ? 'Sin resultados' : 'No hay facturas recibidas en ' + monthLabelCapitalized}</div>
          <div style={{ fontSize: 12, color: '#444' }}>Da click en "Sincronizar con FacturAPI" para traer las facturas del SAT</div>
        </div>
      ) : (
        <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
            <thead>
              <tr style={{ background: '#141414', borderBottom: '1px solid #1e1e1e' }}>
                {['Folio', 'Fecha', 'Proveedor', 'RFC', 'Total', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: 10, fontWeight: 600, color: '#666', textTransform: 'uppercase' as const, letterSpacing: '0.06em', textAlign: 'left' as const }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <tr key={f.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#ccc', fontFamily: 'monospace' }}>{f.serie || ''}{f.folio || '--'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 11, color: '#888' }}>{f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString() : '--'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#ddd' }}>{f.emisor_nombre || '--'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{f.emisor_rfc || '--'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#F59E0B', fontWeight: 600, textAlign: 'right' as const }}>${(f.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} {f.moneda}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: f.status === 'timbrada' ? '#57FF9A22' : f.status === 'cancelada' ? '#EF444422' : '#F59E0B22', color: f.status === 'timbrada' ? '#57FF9A' : f.status === 'cancelada' ? '#EF4444' : '#F59E0B' }}>{f.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
