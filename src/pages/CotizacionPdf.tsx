import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { FCUR } from '../lib/utils'
import { OMNIIOUS_LOGO } from '../assets/logo'
import { Printer, Loader2, Settings } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════════════
// DATOS OMM — EDITABLES POR EL USUARIO (pueden ajustarse desde el panel)
// Los valores default son placeholders. Elias los sustituye en producción.
// ═══════════════════════════════════════════════════════════════════════════

const OMM_DEFAULTS = {
  razonSocial: 'OMM Technologies SA de CV',
  rfc: '[RFC PENDIENTE]',
  domicilio: '[Dirección fiscal pendiente]',
  codigoPostal: '[CP]',
  ciudad: 'Ciudad de México, México',
  regimenFiscal: '601 — General de Ley Personas Morales',
  telefono: '[Teléfono pendiente]',
  email: '[email pendiente]',
  web: 'www.ommtechnologies.mx',
  responsableNombre: 'Elias Gabriel Micha Cohen',
  responsablePuesto: 'Director General',
}

const TERMINOS_DEFAULTS = {
  vigenciaDias: 30,
  anticipo: 60,
  avance: 30,
  entregaFinal: 10,
  garantia: 'Todos los equipos cuentan con la garantía directa del fabricante (típicamente 1 a 2 años). OMM Technologies garantiza la mano de obra de instalación por un período de 6 meses a partir de la entrega formal.',
  exclusiones: 'No incluye obra civil, suministro eléctrico hasta los puntos finales, trámites con autoridades, ni gestiones ante condominio. Los trabajos fuera del alcance descrito se cotizan por separado.',
  observaciones: 'Los precios están sujetos a cambio sin previo aviso. La vigencia de esta cotización aplica únicamente durante el período indicado.',
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

interface AreaRow { id: string; name: string; order_index: number }
interface ItemRow {
  id: string
  area_id: string | null
  name: string
  description: string | null
  system: string | null
  type: string
  provider: string | null
  purchase_phase: string | null
  quantity: number
  cost: number
  markup: number
  price: number
  total: number
  installation_cost: number
  marca?: string | null
  modelo?: string | null
  sku?: string | null
  image_url?: string | null
}

interface QuotationFull {
  id: string
  name: string
  client_name: string
  stage: string
  total: number
  notes: string
  created_at: string
  specialty: string
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch { return iso }
}

function getCurrency(cot: QuotationFull): 'USD' | 'MXN' {
  try { const m = JSON.parse(cot.notes || '{}'); return (m.currency || 'USD') as 'USD' | 'MXN' } catch { return 'USD' }
}

function getTipoCambio(cot: QuotationFull): number | null {
  try {
    const m = JSON.parse(cot.notes || '{}')
    const tc = Number(m.tipoCambio)
    return tc > 0 ? tc : null
  } catch { return null }
}

function shortId(id: string): string { return id.substring(0, 8).toUpperCase() }

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

export default function CotizacionPdf() {
  const { id, format } = useParams<{ id: string; format: string }>()
  const formato = (format || 'ejecutivo') as 'ejecutivo' | 'tecnico' | 'lista'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cot, setCot] = useState<QuotationFull | null>(null)
  const [areas, setAreas] = useState<AreaRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [leadName, setLeadName] = useState('')
  const [architect, setArchitect] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  // Configuración editable (se guarda en localStorage para que Elias no tenga que retocar cada vez)
  const [omm, setOmm] = useState(OMM_DEFAULTS)
  const [terminos, setTerminos] = useState(TERMINOS_DEFAULTS)

  useEffect(() => {
    try {
      const savedOmm = localStorage.getItem('omm_pdf_header')
      if (savedOmm) setOmm({ ...OMM_DEFAULTS, ...JSON.parse(savedOmm) })
      const savedTerm = localStorage.getItem('omm_pdf_terminos')
      if (savedTerm) setTerminos({ ...TERMINOS_DEFAULTS, ...JSON.parse(savedTerm) })
    } catch (e) { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const [{ data: cotData, error: cotErr }, { data: areasData }, { data: itemsData }] = await Promise.all([
          supabase.from('quotations').select('*').eq('id', id!).single(),
          supabase.from('quotation_areas').select('*').eq('quotation_id', id!).order('order_index'),
          supabase.from('quotation_items').select('*').eq('quotation_id', id!).order('order_index'),
        ])
        if (cotErr || !cotData) throw new Error('No se encontró la cotización')
        setCot(cotData as QuotationFull)
        setAreas((areasData || []) as AreaRow[])
        setItems((itemsData || []) as ItemRow[])

        // Cargar lead + arquitecto
        try {
          const meta = JSON.parse(cotData.notes || '{}')
          if (meta.lead_id) {
            const { data: lead } = await supabase.from('leads').select('name,company').eq('id', meta.lead_id).single()
            if (lead) {
              setLeadName(lead.name || '')
              setArchitect(lead.company || '')
            }
          } else if (meta.lead_name) {
            setLeadName(meta.lead_name)
          }
        } catch (e) { /* ignore */ }

        setLoading(false)
      } catch (err: any) {
        setError(err.message || 'Error cargando cotización')
        setLoading(false)
      }
    }
    load()
  }, [id])

  function saveConfig() {
    try {
      localStorage.setItem('omm_pdf_header', JSON.stringify(omm))
      localStorage.setItem('omm_pdf_terminos', JSON.stringify(terminos))
      setShowSettings(false)
    } catch (e) { /* ignore */ }
  }

  function resetConfig() {
    if (!confirm('¿Restaurar todos los valores por defecto?')) return
    setOmm(OMM_DEFAULTS)
    setTerminos(TERMINOS_DEFAULTS)
    try {
      localStorage.removeItem('omm_pdf_header')
      localStorage.removeItem('omm_pdf_terminos')
    } catch (e) { /* ignore */ }
  }

  if (loading) return (
    <div style={{ padding: 60, textAlign: 'center', color: '#666', fontFamily: 'Inter, sans-serif' }}>
      <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
      <div style={{ marginTop: 12 }}>Cargando cotización...</div>
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  if (error || !cot) return (
    <div style={{ padding: 60, textAlign: 'center', color: '#c00', fontFamily: 'Inter, sans-serif' }}>
      Error: {error || 'Cotización no encontrada'}
    </div>
  )

  // ── Cálculos derivados ──────────────────────────────────────────────────
  const currency = getCurrency(cot)
  const tipoCambio = getTipoCambio(cot)
  const materialItems = items.filter(i => i.type !== 'labor')
  const laborItems = items.filter(i => i.type === 'labor')

  // Subtotal de items (precio unitario × cantidad, sin mano de obra)
  const subtotalItems = materialItems.reduce((s, i) => s + (i.price * i.quantity), 0)
  // Mano de obra instalación (installation_cost × cantidad del item)
  const subtotalInstalacion = materialItems.reduce((s, i) => s + ((i.installation_cost || 0) * i.quantity), 0)
  // Mano de obra explícita (items type='labor')
  const subtotalManoObra = laborItems.reduce((s, i) => s + (i.total || (i.price * i.quantity)), 0)
  const subtotal = subtotalItems + subtotalInstalacion + subtotalManoObra
  const iva = subtotal * 0.16
  const totalCon = subtotal + iva

  // Agrupar por sistema (resumen + alcance)
  const bySystem: Record<string, { items: ItemRow[]; subtotal: number; count: number }> = {}
  for (const it of materialItems) {
    const sys = it.system || 'General'
    if (!bySystem[sys]) bySystem[sys] = { items: [], subtotal: 0, count: 0 }
    bySystem[sys].items.push(it)
    bySystem[sys].subtotal += (it.price * it.quantity) + ((it.installation_cost || 0) * it.quantity)
    bySystem[sys].count += it.quantity
  }
  const systemsOrdered = Object.entries(bySystem).sort((a, b) => b[1].subtotal - a[1].subtotal)

  // Agrupar por área + sistema (desglose)
  const byAreaSystem: Record<string, Record<string, ItemRow[]>> = {}
  for (const it of materialItems) {
    const areaName = areas.find(a => a.id === it.area_id)?.name || 'Sin área'
    const sys = it.system || 'General'
    if (!byAreaSystem[areaName]) byAreaSystem[areaName] = {}
    if (!byAreaSystem[areaName][sys]) byAreaSystem[areaName][sys] = []
    byAreaSystem[areaName][sys].push(it)
  }
  const areasOrdered = areas
    .filter(a => byAreaSystem[a.name])
    .map(a => ({ name: a.name, systems: byAreaSystem[a.name] }))
  // Área "Sin área" por si hay items huérfanos
  if (byAreaSystem['Sin área']) {
    areasOrdered.push({ name: 'Sin área', systems: byAreaSystem['Sin área'] })
  }

  // Vigencia calculada
  const vigenciaHasta = new Date(Date.now() + terminos.vigenciaDias * 24 * 60 * 60 * 1000)
    .toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })

  // Texto del tipo de cambio — solo se muestra si es USD y hay TC registrado
  const monedaLabel = currency === 'USD' && tipoCambio
    ? `USD · TC $${tipoCambio.toFixed(2)} MXN`
    : currency

  // Texto de alcance por sistema (automático, corto)
  function alcanceTextoPorSistema(sys: string, data: { items: ItemRow[]; count: number }): string {
    const marcasSet = new Set<string>()
    data.items.forEach(i => { if (i.marca) marcasSet.add(i.marca) })
    const marcas = Array.from(marcasSet).slice(0, 3)
    const marcasStr = marcas.length > 0 ? ` Marcas principales: ${marcas.join(', ')}.` : ''
    return `Incluye ${data.count} equipos/componentes del sistema de ${sys}.${marcasStr}`
  }

  const tituloFormato = {
    ejecutivo: 'Propuesta Ejecutiva',
    tecnico: 'Propuesta Técnica Detallada',
    lista: 'Lista de Precios',
  }[formato]

  const mostrarCostosInternos = formato === 'tecnico'
  const mostrarTablaPlana = formato === 'lista'

  // ─── Estilos print-optimized ─────────────────────────────────────────────
  const pageStyle: React.CSSProperties = {
    background: '#fff', color: '#111',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    minHeight: '100vh',
    padding: '32px 48px',
    maxWidth: 860, margin: '0 auto',
    fontSize: 11, lineHeight: 1.5,
  }

  return (
    <>
      <style>{`
        @page { size: A4; margin: 15mm 12mm; }
        @media print {
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
          body { background: #fff !important; }
        }
        body { background: #eee; }
        table.pdf-table { width: 100%; border-collapse: collapse; }
        table.pdf-table th { background: #f5f5f5; padding: 6px 8px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; font-weight: 600; border-bottom: 1px solid #ddd; }
        table.pdf-table td { padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 10px; vertical-align: top; }
        table.pdf-table tr:last-child td { border-bottom: none; }
        h1, h2, h3 { margin: 0; font-weight: 600; }
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>

      {/* Barra flotante de acciones (oculta al imprimir) */}
      <div className="no-print" style={{
        position: 'sticky', top: 0, zIndex: 100, background: '#141414', borderBottom: '1px solid #333',
        padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ color: '#888', fontSize: 12, fontFamily: 'Inter, sans-serif' }}>
          {tituloFormato} · {cot.name || 'Sin nombre'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowSettings(true)} style={{
            padding: '8px 14px', background: '#1e1e1e', border: '1px solid #333', color: '#ccc',
            borderRadius: 8, cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}><Settings size={14} /> Editar datos y términos</button>
          <button onClick={() => window.print()} style={{
            padding: '8px 16px', background: '#57FF9A', border: 'none', color: '#000',
            borderRadius: 8, cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}><Printer size={14} /> Imprimir / Guardar PDF</button>
        </div>
      </div>

      {/* Modal de configuración editable */}
      {showSettings && (
        <div className="no-print" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{
            background: '#141414', border: '1px solid #333', borderRadius: 12,
            width: '100%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto',
            padding: 24, color: '#ddd', fontFamily: 'Inter, sans-serif',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 15, color: '#fff' }}>Editar datos y términos</h2>
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>

            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, fontWeight: 600 }}>Datos OMM</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
              {(Object.keys(OMM_DEFAULTS) as Array<keyof typeof OMM_DEFAULTS>).map(key => (
                <div key={key}>
                  <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>{key}</label>
                  <input value={omm[key]} onChange={e => setOmm(o => ({ ...o, [key]: e.target.value }))}
                    style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 11, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
              ))}
            </div>

            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, fontWeight: 600 }}>Términos comerciales</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>Vigencia (días)</label>
                <input type="number" value={terminos.vigenciaDias} onChange={e => setTerminos(t => ({ ...t, vigenciaDias: parseInt(e.target.value) || 30 }))}
                  style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 11, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>% Anticipo</label>
                <input type="number" value={terminos.anticipo} onChange={e => setTerminos(t => ({ ...t, anticipo: parseInt(e.target.value) || 0 }))}
                  style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 11, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>% Avance</label>
                <input type="number" value={terminos.avance} onChange={e => setTerminos(t => ({ ...t, avance: parseInt(e.target.value) || 0 }))}
                  style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 11, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>% Entrega</label>
                <input type="number" value={terminos.entregaFinal} onChange={e => setTerminos(t => ({ ...t, entregaFinal: parseInt(e.target.value) || 0 }))}
                  style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 11, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>Garantía</label>
              <textarea value={terminos.garantia} onChange={e => setTerminos(t => ({ ...t, garantia: e.target.value }))} rows={3}
                style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 11, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>Exclusiones</label>
              <textarea value={terminos.exclusiones} onChange={e => setTerminos(t => ({ ...t, exclusiones: e.target.value }))} rows={3}
                style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 11, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 3 }}>Observaciones</label>
              <textarea value={terminos.observaciones} onChange={e => setTerminos(t => ({ ...t, observaciones: e.target.value }))} rows={2}
                style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 11, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 14, borderTop: '1px solid #222' }}>
              <button onClick={resetConfig} style={{ padding: '8px 14px', background: 'none', border: '1px solid #444', borderRadius: 6, color: '#888', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>Restaurar defaults</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowSettings(false)} style={{ padding: '8px 14px', background: 'none', border: '1px solid #333', borderRadius: 6, color: '#888', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>Cancelar</button>
                <button onClick={saveConfig} style={{ padding: '8px 14px', background: '#57FF9A', border: 'none', borderRadius: 6, color: '#000', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ DOCUMENTO PDF ═══════════ */}
      <div style={pageStyle}>

        {/* HEADER */}
        <div style={{ borderBottom: '2px solid #111', paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <img src={OMNIIOUS_LOGO} alt="OMNIIOUS" style={{ height: 72, width: 'auto', objectFit: 'contain' }} />
            </div>
            <div style={{ textAlign: 'right', fontSize: 9, color: '#555', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: '#111', fontSize: 11 }}>{omm.razonSocial}</div>
              <div>RFC: {omm.rfc}</div>
              <div>{omm.domicilio}</div>
              <div>{omm.codigoPostal} · {omm.ciudad}</div>
              <div>{omm.telefono} · {omm.email}</div>
              <div>{omm.web}</div>
            </div>
          </div>
        </div>

        {/* TÍTULO + DATOS PROYECTO */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{tituloFormato}</div>
          <h1 style={{ fontSize: 18, color: '#111', marginBottom: 10 }}>{cot.name || 'Cotización sin nombre'}</h1>
          <table style={{ width: '100%', fontSize: 10 }}>
            <tbody>
              <tr>
                <td style={{ padding: '3px 12px 3px 0', color: '#888', width: 120 }}>Folio</td>
                <td style={{ padding: '3px 0', fontWeight: 600 }}>OMM-{shortId(cot.id)}</td>
                <td style={{ padding: '3px 12px 3px 0', color: '#888', width: 120 }}>Fecha</td>
                <td style={{ padding: '3px 0' }}>{formatDate(cot.created_at)}</td>
              </tr>
              <tr>
                <td style={{ padding: '3px 12px 3px 0', color: '#888' }}>Cliente</td>
                <td style={{ padding: '3px 0', fontWeight: 600 }}>{cot.client_name || '—'}</td>
                <td style={{ padding: '3px 12px 3px 0', color: '#888' }}>Vigencia</td>
                <td style={{ padding: '3px 0' }}>Hasta {vigenciaHasta}</td>
              </tr>
              {architect && (
                <tr>
                  <td style={{ padding: '3px 12px 3px 0', color: '#888' }}>Arquitecto</td>
                  <td style={{ padding: '3px 0' }}>{architect}</td>
                  <td style={{ padding: '3px 12px 3px 0', color: '#888' }}>Moneda</td>
                  <td style={{ padding: '3px 0' }}>{monedaLabel}</td>
                </tr>
              )}
              {!architect && (
                <tr>
                  <td style={{ padding: '3px 12px 3px 0', color: '#888' }}>Moneda</td>
                  <td colSpan={3} style={{ padding: '3px 0' }}>{monedaLabel}</td>
                </tr>
              )}
              {leadName && (
                <tr>
                  <td style={{ padding: '3px 12px 3px 0', color: '#888' }}>Proyecto</td>
                  <td colSpan={3} style={{ padding: '3px 0' }}>{leadName}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* SECCIÓN 1: RESUMEN POR SISTEMA */}
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 13, color: '#111', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #ddd' }}>
            Resumen por sistema
          </h2>
          <table className="pdf-table">
            <thead>
              <tr>
                <th>Sistema</th>
                <th style={{ textAlign: 'center', width: 90 }}>Componentes</th>
                <th style={{ textAlign: 'right', width: 140 }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {systemsOrdered.map(([sys, data]) => (
                <tr key={sys}>
                  <td style={{ fontWeight: 500 }}>{sys}</td>
                  <td style={{ textAlign: 'center' }}>{data.count}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{FCUR(data.subtotal, currency)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid #111' }}>
                <td style={{ fontWeight: 700, paddingTop: 8 }}>Total materiales e instalación</td>
                <td></td>
                <td style={{ textAlign: 'right', fontWeight: 700, paddingTop: 8 }}>{FCUR(subtotal, currency)}</td>
              </tr>
              <tr>
                <td style={{ color: '#888' }}>IVA 16%</td>
                <td></td>
                <td style={{ textAlign: 'right', color: '#888' }}>{FCUR(iva, currency)}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700, fontSize: 12, color: '#111' }}>Total con IVA</td>
                <td></td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 12, color: '#111' }}>{FCUR(totalCon, currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* SECCIÓN 2: ALCANCE BREVE */}
        <div style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 13, color: '#111', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #ddd' }}>
            Alcance del proyecto
          </h2>
          {systemsOrdered.map(([sys, data]) => (
            <div key={sys} style={{ marginBottom: 8, fontSize: 10, lineHeight: 1.6 }}>
              <span style={{ fontWeight: 600, color: '#111' }}>{sys}: </span>
              <span style={{ color: '#555' }}>{alcanceTextoPorSistema(sys, data)}</span>
            </div>
          ))}
        </div>

        {/* SECCIÓN 3: DESGLOSE */}
        <div className="page-break" />
        <h2 style={{ fontSize: 13, color: '#111', marginBottom: 12, paddingBottom: 4, borderBottom: '1px solid #ddd' }}>
          {mostrarTablaPlana ? 'Lista detallada de precios' : 'Desglose por área y sistema'}
        </h2>

        {mostrarTablaPlana ? (
          // ── Formato LISTA: tabla plana ─────────────────────────────────
          <table className="pdf-table">
            <thead>
              <tr>
                <th style={{ width: 52 }}></th>
                <th style={{ width: 90 }}>Marca</th>
                <th style={{ width: 110 }}>Modelo</th>
                <th>Descripción</th>
                <th style={{ width: 72 }}>Sistema</th>
                <th style={{ textAlign: 'center', width: 42 }}>Cant</th>
                <th style={{ textAlign: 'right', width: 90 }}>P. unit.</th>
              </tr>
            </thead>
            <tbody>
              {materialItems.map(it => (
                <tr key={it.id}>
                  <td style={{ textAlign: 'center' }}>
                    {it.image_url ? (
                      <img src={it.image_url} alt="" style={{ width: 42, height: 42, objectFit: 'contain', border: '1px solid #eee', borderRadius: 3, background: '#fff' }} />
                    ) : (
                      <div style={{ width: 42, height: 42, border: '1px dashed #ddd', borderRadius: 3, background: '#fafafa' }}></div>
                    )}
                  </td>
                  <td style={{ fontSize: 10, fontWeight: 500 }}>{it.marca || '—'}</td>
                  <td style={{ fontSize: 10 }}>{it.modelo || '—'}</td>
                  <td>
                    <div style={{ fontWeight: 500, fontSize: 10 }}>{it.name}</div>
                    {it.description && <div style={{ fontSize: 9, color: '#888', marginTop: 2, lineHeight: 1.4 }}>{it.description}</div>}
                  </td>
                  <td style={{ fontSize: 9, color: '#666' }}>{it.system || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{it.quantity}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{FCUR(it.price, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          // ── Formato EJECUTIVO/TÉCNICO: agrupado por área → sistema ────
          areasOrdered.map((area, idx) => {
            const areaTotal = Object.values(area.systems).flat().reduce((s, i) => s + (i.price * i.quantity), 0)
            return (
              <div key={area.name} style={{ marginBottom: 18, breakInside: 'avoid' as any }}>
                <div style={{ background: '#f5f5f5', padding: '8px 12px', marginBottom: 6, borderLeft: '3px solid #111', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: 12, color: '#111' }}>{idx + 1}. {area.name}</h3>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{FCUR(areaTotal, currency)}</div>
                </div>
                {Object.entries(area.systems).map(([sys, sysItems]) => {
                  const sysTotal = sysItems.reduce((s, i) => s + (i.price * i.quantity), 0)
                  return (
                    <div key={sys} style={{ marginLeft: 10, marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '4px 0', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{sys}</span>
                        <span>{FCUR(sysTotal, currency)}</span>
                      </div>
                      <table className="pdf-table">
                        <thead>
                          <tr>
                            {mostrarCostosInternos && <th style={{ width: 52 }}></th>}
                            {!mostrarCostosInternos && <th style={{ width: 52 }}></th>}
                            <th style={{ width: 90 }}>Marca</th>
                            <th style={{ width: 110 }}>Modelo</th>
                            <th>Descripción</th>
                            {mostrarCostosInternos && <th style={{ width: 90 }}>SKU / Proveedor</th>}
                            {mostrarCostosInternos && <th style={{ textAlign: 'right', width: 70 }}>Costo</th>}
                            {mostrarCostosInternos && <th style={{ textAlign: 'center', width: 42 }}>MUp</th>}
                            <th style={{ textAlign: 'center', width: 42 }}>Cant</th>
                            <th style={{ textAlign: 'right', width: 90 }}>P. unit.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sysItems.map(it => (
                            <tr key={it.id}>
                              <td style={{ textAlign: 'center' }}>
                                {it.image_url ? (
                                  <img src={it.image_url} alt="" style={{ width: 42, height: 42, objectFit: 'contain', border: '1px solid #eee', borderRadius: 3, background: '#fff' }} />
                                ) : (
                                  <div style={{ width: 42, height: 42, border: '1px dashed #ddd', borderRadius: 3, background: '#fafafa' }}></div>
                                )}
                              </td>
                              <td style={{ fontSize: 10, fontWeight: 500 }}>{it.marca || '—'}</td>
                              <td style={{ fontSize: 10 }}>{it.modelo || '—'}</td>
                              <td>
                                <div style={{ fontWeight: 500, fontSize: 10 }}>{it.name}</div>
                                {it.description && <div style={{ fontSize: 9, color: '#888', marginTop: 2, lineHeight: 1.4 }}>{it.description}</div>}
                              </td>
                              {mostrarCostosInternos && (
                                <td style={{ fontSize: 9, color: '#666' }}>
                                  {it.sku || '—'}
                                  {it.provider && <div>{it.provider}</div>}
                                  {it.purchase_phase && <div style={{ fontSize: 8, color: '#999' }}>Fase: {it.purchase_phase}</div>}
                                </td>
                              )}
                              {mostrarCostosInternos && <td style={{ textAlign: 'right', color: '#888' }}>{FCUR(it.cost || 0, currency)}</td>}
                              {mostrarCostosInternos && <td style={{ textAlign: 'center', color: '#888', fontSize: 9 }}>{it.markup || 0}%</td>}
                              <td style={{ textAlign: 'center' }}>{it.quantity}</td>
                              <td style={{ textAlign: 'right', fontWeight: 500 }}>{FCUR(it.price, currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>
            )
          })
        )}

        {/* SECCIÓN 4: TOTALES FINALES (se repite al final del desglose) */}
        <div style={{ marginTop: 20, marginBottom: 22, padding: '14px 0', borderTop: '2px solid #111' }}>
          <table style={{ width: '100%', fontSize: 11 }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 0', color: '#666' }}>Subtotal materiales</td>
                <td style={{ padding: '4px 0', textAlign: 'right' }}>{FCUR(subtotalItems, currency)}</td>
              </tr>
              {subtotalInstalacion > 0 && (
                <tr>
                  <td style={{ padding: '4px 0', color: '#666' }}>Mano de obra de instalación</td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>{FCUR(subtotalInstalacion, currency)}</td>
                </tr>
              )}
              {subtotalManoObra > 0 && (
                <tr>
                  <td style={{ padding: '4px 0', color: '#666' }}>Servicios adicionales</td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>{FCUR(subtotalManoObra, currency)}</td>
                </tr>
              )}
              <tr style={{ borderTop: '1px solid #ddd' }}>
                <td style={{ padding: '6px 0 4px 0', fontWeight: 600 }}>Subtotal</td>
                <td style={{ padding: '6px 0 4px 0', textAlign: 'right', fontWeight: 600 }}>{FCUR(subtotal, currency)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', color: '#888' }}>IVA 16%</td>
                <td style={{ padding: '4px 0', textAlign: 'right', color: '#888' }}>{FCUR(iva, currency)}</td>
              </tr>
              <tr>
                <td style={{ padding: '8px 0 4px 0', fontWeight: 700, fontSize: 14, color: '#111', borderTop: '1px solid #111' }}>TOTAL</td>
                <td style={{ padding: '8px 0 4px 0', textAlign: 'right', fontWeight: 700, fontSize: 14, color: '#111', borderTop: '1px solid #111' }}>{FCUR(totalCon, currency)}</td>
              </tr>
              {currency === 'USD' && tipoCambio && (
                <tr>
                  <td style={{ padding: '2px 0', fontSize: 10, color: '#888', fontStyle: 'italic' }}>Equivalente en MXN (TC ${tipoCambio.toFixed(2)})</td>
                  <td style={{ padding: '2px 0', textAlign: 'right', fontSize: 10, color: '#888', fontStyle: 'italic' }}>{FCUR(totalCon * tipoCambio, 'MXN')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* SECCIÓN 5: TÉRMINOS COMERCIALES */}
        <div className="page-break" />
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 13, color: '#111', marginBottom: 10, paddingBottom: 4, borderBottom: '1px solid #ddd' }}>
            Términos y condiciones
          </h2>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#111', marginBottom: 4 }}>Condiciones de pago</div>
            <div style={{ fontSize: 10, color: '#555', lineHeight: 1.6 }}>
              {terminos.anticipo}% de anticipo al confirmar el proyecto, {terminos.avance}% contra avance de obra, {terminos.entregaFinal}% contra entrega final y puesta en marcha.
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#111', marginBottom: 4 }}>Vigencia</div>
            <div style={{ fontSize: 10, color: '#555', lineHeight: 1.6 }}>
              Esta propuesta tiene una vigencia de {terminos.vigenciaDias} días naturales a partir de la fecha de emisión ({formatDate(cot.created_at)}), válida hasta el {vigenciaHasta}.
            </div>
          </div>

          {currency === 'USD' && tipoCambio && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#111', marginBottom: 4 }}>Tipo de cambio</div>
              <div style={{ fontSize: 10, color: '#555', lineHeight: 1.6 }}>
                Los montos en esta cotización están expresados en Dólares Americanos (USD). Para referencia de facturación en Pesos Mexicanos (MXN), se utiliza un tipo de cambio de <strong>${tipoCambio.toFixed(2)} MXN por USD</strong>, calculado a la fecha de emisión. El tipo de cambio aplicable al momento del pago será el publicado por el Banco de México (DOF) en la fecha efectiva de cada abono.
              </div>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#111', marginBottom: 4 }}>Garantía</div>
            <div style={{ fontSize: 10, color: '#555', lineHeight: 1.6 }}>{terminos.garantia}</div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#111', marginBottom: 4 }}>Exclusiones</div>
            <div style={{ fontSize: 10, color: '#555', lineHeight: 1.6 }}>{terminos.exclusiones}</div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#111', marginBottom: 4 }}>Observaciones</div>
            <div style={{ fontSize: 10, color: '#555', lineHeight: 1.6 }}>{terminos.observaciones}</div>
          </div>
        </div>

        {/* FIRMA */}
        <div style={{ marginTop: 40, marginBottom: 20 }}>
          <div style={{ borderTop: '1px solid #111', paddingTop: 6, width: 260, fontSize: 10 }}>
            <div style={{ fontWeight: 700, color: '#111' }}>{omm.responsableNombre}</div>
            <div style={{ color: '#666' }}>{omm.responsablePuesto}</div>
            <div style={{ color: '#666' }}>{omm.razonSocial}</div>
          </div>
        </div>

        {/* FOOTER */}
        <div style={{ marginTop: 24, paddingTop: 10, borderTop: '1px solid #ddd', fontSize: 8, color: '#999', textAlign: 'center' }}>
          {omm.razonSocial} · {omm.rfc} · {omm.web} · Cotización {shortId(cot.id)}
        </div>
      </div>
    </>
  )
}
