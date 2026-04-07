import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, X, FileText, RefreshCw, Download, Trash2, Search, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

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
  regimen_fiscal?: string
  codigo_postal?: string
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
}

// ============================================================
// API Helper
// ============================================================
async function callFacturapi(action: string, opts: { method?: string; query?: Record<string, string>; body?: any } = {}) {
  const method = opts.method || 'GET'
  const params = new URLSearchParams({ action, ...(opts.query || {}) })
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
  const [view, setView] = useState<'lista' | 'nueva' | 'recibidas'>('lista')
  const [pingStatus, setPingStatus] = useState<'idle' | 'ok' | 'error'>('idle')

  useEffect(() => {
    callFacturapi('ping').then(r => {
      setPingStatus(r.ok && r.data?.ok ? 'ok' : 'error')
    })
  }, [])

  return (
    <div style={{ padding: '24px 28px', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 }}>Facturacion</h1>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            FacturAPI Sandbox
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid #1e1e1e' }}>
        {(['lista', 'recibidas'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: '10px 18px', background: 'transparent',
            border: 'none', borderBottom: `2px solid ${view === v ? '#57FF9A' : 'transparent'}`,
            color: view === v ? '#fff' : '#666', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>
            {v === 'lista' ? 'Emitidas' : 'Recibidas'}
          </button>
        ))}
      </div>

      {view === 'lista' && <ListaEmitidas onNueva={() => setView('nueva')} />}
      {view === 'nueva' && <NuevaFactura onCancel={() => setView('lista')} onCreated={() => setView('lista')} />}
      {view === 'recibidas' && <ListaRecibidas />}
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
    const r = await callFacturapi('list_invoices', { query: { limit: '50' } })
    if (r.ok && r.data?.data) {
      // Sincronizar cada factura a Supabase (upsert por facturapi_id)
      for (const inv of r.data.data) {
        const payload: any = {
          direccion: 'emitida',
          facturapi_id: inv.id,
          uuid_fiscal: inv.uuid || null,
          serie: inv.series || null,
          folio: inv.folio_number ? String(inv.folio_number) : null,
          status: inv.status === 'valid' ? 'timbrada' : inv.status === 'canceled' ? 'cancelada' : 'borrador',
          fecha_emision: inv.date || null,
          fecha_timbrado: inv.stamp?.date || null,
          receptor_rfc: inv.customer?.tax_id || null,
          receptor_nombre: inv.customer?.legal_name || null,
          subtotal: inv.subtotal || 0,
          total: inv.total || 0,
          moneda: inv.currency || 'MXN',
          forma_pago: inv.payment_form || null,
          metodo_pago: inv.payment_method || null,
          tipo_comprobante: inv.type || 'I',
          sandbox: true,
          xml_url: `/api/facturapi?action=download_xml&id=${inv.id}`,
          pdf_url: `/api/facturapi?action=download_pdf&id=${inv.id}`,
        }
        // Upsert: buscar si ya existe por facturapi_id, si si update; si no, insert
        const { data: existing } = await supabase.from('facturas').select('id').eq('facturapi_id', inv.id).maybeSingle()
        if (existing) {
          await supabase.from('facturas').update(payload).eq('id', (existing as any).id)
        } else {
          await supabase.from('facturas').insert(payload)
        }
      }
      await load()
    } else {
      alert('Error al sincronizar: ' + (r.data?.message || 'desconocido'))
    }
    setSyncing(false)
  }

  const filtered = facturas.filter(f => {
    if (!search) return true
    const q = search.toLowerCase()
    return (f.receptor_nombre || '').toLowerCase().includes(q) ||
      (f.receptor_rfc || '').toLowerCase().includes(q) ||
      (f.uuid_fiscal || '').toLowerCase().includes(q) ||
      (f.folio || '').toLowerCase().includes(q)
  })

  return (
    <div>
      {/* Toolbar */}
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
              {filtered.map(f => (
                <tr key={f.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#ccc', fontFamily: 'monospace' }}>{f.serie || ''}{f.folio || '--'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 11, color: '#888' }}>{f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString() : '--'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#ddd' }}>{f.receptor_nombre || '--'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{f.receptor_rfc || '--'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#57FF9A', fontWeight: 600, textAlign: 'right' }}>{(f.moneda === 'USD' ? '$' : '$')}{(f.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} {f.moneda}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                      background: f.status === 'timbrada' ? '#57FF9A22' : f.status === 'cancelada' ? '#EF444422' : '#F59E0B22',
                      color: f.status === 'timbrada' ? '#57FF9A' : f.status === 'cancelada' ? '#EF4444' : '#F59E0B',
                    }}>{f.status}</span>
                  </td>
                  <td style={{ padding: '10px 14px', display: 'flex', gap: 6 }}>
                    {f.facturapi_id && <a href={`/api/facturapi?action=download_pdf&id=${f.facturapi_id}`} target="_blank" rel="noopener noreferrer" style={{ color: '#A78BFA', fontSize: 10, textDecoration: 'none' }}>PDF</a>}
                    {f.facturapi_id && <a href={`/api/facturapi?action=download_xml&id=${f.facturapi_id}`} target="_blank" rel="noopener noreferrer" style={{ color: '#A78BFA', fontSize: 10, textDecoration: 'none' }}>XML</a>}
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

// ============================================================
// Nueva Factura — form
// ============================================================
function NuevaFactura({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [clientes, setClientes] = useState<ClienteFiscal[]>([])
  const [cotizaciones, setCotizaciones] = useState<QuotationLite[]>([])
  const [clienteId, setClienteId] = useState('')
  const [cotizacionId, setCotizacionId] = useState('')
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

  useEffect(() => {
    Promise.all([
      supabase.from('clientes_fiscales').select('id,razon_social,rfc,uso_cfdi,regimen_fiscal,codigo_postal,facturapi_customer_id').eq('activo', true).order('razon_social'),
      supabase.from('quotations').select('id,name,client_name').order('created_at', { ascending: false }).limit(200)
    ]).then(([cli, cot]) => {
      setClientes((cli.data as ClienteFiscal[]) || [])
      setCotizaciones((cot.data as QuotationLite[]) || [])
    })
  }, [])

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

  async function emitir() {
    setError(null)
    if (!clienteId) { setError('Selecciona un cliente'); return }
    if (conceptos.some(c => !c.descripcion || c.cantidad <= 0 || c.valor_unitario <= 0)) {
      setError('Completa todos los conceptos: descripcion, cantidad y valor unitario')
      return
    }
    const cliente = clientes.find(c => c.id === clienteId)
    if (!cliente) { setError('Cliente no encontrado'); return }

    setEmitting(true)

    try {
      // 1) Asegurar customer en FacturAPI (crear si no existe)
      let facturapiCustomerId = cliente.facturapi_customer_id

      if (!facturapiCustomerId) {
        const customerPayload = {
          legal_name: cliente.razon_social,
          tax_id: cliente.rfc,
          tax_system: cliente.regimen_fiscal || '601',
          email: '',
          address: {
            zip: cliente.codigo_postal || '01000'
          }
        }
        const cr = await callFacturapi('create_customer', { method: 'POST', body: { payload: customerPayload } })
        if (!cr.ok) {
          setError('Error al crear cliente en FacturAPI: ' + (cr.data?.message || 'desconocido'))
          setEmitting(false)
          return
        }
        facturapiCustomerId = cr.data.id
        // Guardar en clientes_fiscales para futuras facturas
        await supabase.from('clientes_fiscales').update({ facturapi_customer_id: facturapiCustomerId }).eq('id', clienteId)
      }

      // 2) Construir payload de invoice
      const invoicePayload: any = {
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

      // 3) Emitir factura
      const ir = await callFacturapi('create_invoice', { method: 'POST', body: { payload: invoicePayload } })
      if (!ir.ok) {
        setError('Error al emitir: ' + (ir.data?.message || JSON.stringify(ir.data).slice(0, 300)))
        setEmitting(false)
        return
      }

      const invoice = ir.data

      // 4) Guardar en Supabase
      const facturaSupabase: any = {
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
        receptor_regimen_fiscal: cliente.regimen_fiscal,
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
        sandbox: true,
      }

      const { data: created, error: insErr } = await supabase.from('facturas').insert(facturaSupabase).select().single()
      if (insErr) {
        setError('Factura emitida en FacturAPI pero error al guardar local: ' + insErr.message + '. UUID: ' + invoice.uuid)
        setEmitting(false)
        return
      }

      // 5) Insertar conceptos
      if (created) {
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
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Nueva factura</div>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
      </div>

      {error && <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: 12, color: '#f87171', fontSize: 12, marginBottom: 16 }}>{error}</div>}

      {/* Cliente y vinculacion */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 10 }}>Cliente y vinculacion</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={lblStyle}>Cliente *</label>
            <select value={clienteId} onChange={e => setClienteId(e.target.value)} style={inpStyle}>
              <option value="">-- Selecciona un cliente --</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.razon_social} ({c.rfc})</option>)}
            </select>
          </div>
          <div>
            <label style={lblStyle}>Cotizacion (opcional)</label>
            <select value={cotizacionId} onChange={e => setCotizacionId(e.target.value)} style={inpStyle}>
              <option value="">-- Sin vinculacion --</option>
              {cotizaciones.map(c => <option key={c.id} value={c.id}>{c.name} - {c.client_name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Conceptos */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#888' }}>Conceptos a facturar</div>
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
              <button onClick={() => removeConcepto(i)} disabled={conceptos.length === 1} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0, alignSelf: 'end', height: 32 }}><Trash2 size={14} /></button>
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

      {/* Configuracion fiscal */}
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

      {/* Totales */}
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

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={{ padding: '10px 20px', background: '#1e1e1e', color: '#ccc', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
        <button onClick={emitir} disabled={emitting} style={{ padding: '10px 20px', background: emitting ? '#444' : '#57FF9A', color: '#000', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: emitting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          {emitting ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Emitiendo...</> : 'Emitir factura'}
        </button>
      </div>
    </div>
  )
}

// ============================================================
// Lista Recibidas (placeholder por ahora — Fase 4)
// ============================================================
function ListaRecibidas() {
  const [recibidas, setRecibidas] = useState<Factura[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('facturas').select('*').eq('direccion', 'recibida').order('created_at', { ascending: false }).limit(100).then(({ data }) => {
      setRecibidas((data as Factura[]) || [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#555' }}>Cargando...</div>

  return (
    <div>
      <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 12, padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#aaa', marginBottom: 6, fontWeight: 600 }}>Buzon de facturas recibidas</div>
        <div style={{ fontSize: 11, color: '#666', lineHeight: 1.6 }}>
          Aqui apareceran las facturas que tus proveedores te emitan. Por ahora puedes subirlas manualmente desde el modulo Contabilidad.
          La sincronizacion automatica via email forwarding y webhook se implementara en una siguiente fase.
        </div>
      </div>
      {recibidas.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#555', background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 12 }}>
          <FileText size={32} style={{ color: '#333', marginBottom: 12 }} />
          <div style={{ fontSize: 13 }}>No hay facturas recibidas</div>
        </div>
      ) : (
        <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 12, padding: 16 }}>
          {recibidas.map(f => (
            <div key={f.id} style={{ padding: '8px 0', borderBottom: '1px solid #1a1a1a', fontSize: 12, color: '#ccc' }}>
              {f.emisor_nombre} - {f.uuid_fiscal} - {(f.total || 0).toLocaleString('es-MX')} {f.moneda}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
