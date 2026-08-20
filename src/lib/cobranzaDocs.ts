// ═══════════════════════════════════════════════════════════════════════════
// cobranzaDocs — "resolver el pendiente con lo que YA existe en el ERP".
//
// Dos acciones para una obra por cobrar, ambas terminan en un BORRADOR de
// Gmail (nunca auto-envío — el envío siempre lo decide Elias):
//   1. Estado de cuenta  → arma el PDF del estado de cuenta del lead (el mismo
//      del CRM/Cobranza) y lo adjunta al borrador.
//   2. Factura ya emitida → baja el PDF (y XML) de una factura que YA se timbró
//      en FacturAPI y lo adjunta al borrador.
//
// No agrega funciones a /api: usa las que ya existen (/api/gmail?action=create_draft
// y /api/facturapi?action=download_pdf|download_xml).
//
// Nota sobre el match factura↔obra: la tabla `facturas` tiene la columna
// `lead_id` pero está vacía en TODAS las filas, y el nombre fiscal del receptor
// ("ARQUICONCEPTOS E INSTALACIONES") casi nunca se parece al nombre de la obra
// ("Cero5cien A102 - Jose Tawil"). Por eso NO adivinamos: sugerimos por
// similitud, dejamos buscar a mano, y cuando Elias liga una factura a la obra
// se guarda en `facturas.lead_id` → la próxima vez ya sale sola.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'
import { generarEstadoCuentaPdf } from './estadoCuentaPdf'

const OMM_RFC = 'OTE210910PW5'
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export interface FacturaRow {
  id: string
  folio: string | null
  serie: string | null
  fecha_emision: string | null
  receptor_nombre: string | null
  total: number | null
  moneda: string | null
  estado: string | null
  facturapi_id: string | null
  lead_id: string | null
  sandbox: boolean | null
  uuid_fiscal: string | null
}

export interface Adjunto { filename: string; dataB64: string; mime: string }

// ── Facturas de INGRESO emitidas por OMM (no nómina, no pagos, no canceladas) ──
export async function loadFacturasEmitidas(): Promise<FacturaRow[]> {
  const { data } = await supabase
    .from('facturas')
    .select('id,folio,serie,fecha_emision,receptor_nombre,total,moneda,estado,facturapi_id,lead_id,sandbox,uuid_fiscal')
    .eq('emisor_rfc', OMM_RFC)
    .eq('tipo_comprobante', 'I')
    .order('fecha_emision', { ascending: false })
    .limit(1000)
  return ((data || []) as any[]).filter(f => String(f.estado || '').toLowerCase() !== 'cancelada') as FacturaRow[]
}

export const norm = (s: string | null | undefined): string =>
  (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'sa', 'cv', 'srl', 'depto', 'casa', 'torre', 'obra', 'arq', 'sr', 'sra'])

// Sugerencias: comparte al menos una palabra "fuerte" (>3 letras, no genérica)
// entre el nombre de la obra / alias de contacto y el nombre fiscal del receptor.
export function sugerirFacturas(facturas: FacturaRow[], leadName: string, contactos?: string | null): FacturaRow[] {
  const toks = new Set(
    [...norm(leadName).split(' '), ...norm(contactos || '').split(' ')]
      .filter(t => t.length > 3 && !STOP.has(t))
  )
  if (toks.size === 0) return []
  const scored = facturas
    .map(f => {
      const rt = norm(f.receptor_nombre).split(' ')
      let s = 0
      for (const t of toks) if (rt.includes(t)) s++
      return { f, s }
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || String(b.f.fecha_emision || '').localeCompare(String(a.f.fecha_emision || '')))
  return scored.slice(0, 8).map(x => x.f)
}

export function buscarFacturas(facturas: FacturaRow[], q: string): FacturaRow[] {
  const n = norm(q)
  if (!n) return []
  return facturas
    .filter(f =>
      norm(f.receptor_nombre).includes(n) ||
      String(f.folio || '').includes(q.trim()) ||
      String(f.uuid_fiscal || '').toLowerCase().includes(q.trim().toLowerCase()) ||
      String(Math.round(Number(f.total) || 0)).includes(q.replace(/[^0-9]/g, '')))
    .slice(0, 12)
}

export async function ligarFacturaAObra(facturaId: string, leadId: string | null): Promise<void> {
  await supabase.from('facturas').update({ lead_id: leadId }).eq('id', facturaId)
}

// ── Adjunto: PDF de una factura ya timbrada (vía el proxy de FacturAPI) ──
function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + CH)))
  return btoa(bin)
}

export async function adjuntoFactura(f: FacturaRow, conXml = false): Promise<Adjunto[]> {
  if (!f.facturapi_id) throw new Error('Esa factura no tiene folio de FacturAPI, no se puede bajar el PDF.')
  const mode = f.sandbox ? 'test' : 'live'
  const nombre = `Factura_${f.serie || ''}${f.folio || f.facturapi_id}`.replace(/\s+/g, '_')
  const out: Adjunto[] = []
  const rp = await fetch(`/api/facturapi?action=download_pdf&mode=${mode}&id=${encodeURIComponent(f.facturapi_id)}`)
  if (!rp.ok) throw new Error('No se pudo bajar el PDF de la factura (FacturAPI respondió ' + rp.status + ')')
  out.push({ filename: nombre + '.pdf', dataB64: bufToB64(await rp.arrayBuffer()), mime: 'application/pdf' })
  if (conXml) {
    try {
      const rx = await fetch(`/api/facturapi?action=download_xml&mode=${mode}&id=${encodeURIComponent(f.facturapi_id)}`)
      if (rx.ok) out.push({ filename: nombre + '.xml', dataB64: bufToB64(await rx.arrayBuffer()), mime: 'application/xml' })
    } catch { /* el XML es opcional */ }
  }
  return out
}

// ── Adjunto: estado de cuenta del lead (mismo PDF del CRM) ──
export async function adjuntoEstadoCuenta(leadId: string, leadName: string): Promise<Adjunto> {
  const { data: quotsAll } = await supabase
    .from('quotations')
    .select('id,name,stage,notes,total,total_final,specialty,commercial_year')
    .eq('stage', 'contrato')
    .eq('vigente', true)
  const leadOf = (q: any): string | null => { try { return JSON.parse(q.notes || '{}').lead_id || null } catch { return null } }
  const quots = ((quotsAll || []) as any[]).filter(q => leadOf(q) === leadId)
  const qids = quots.map(q => q.id)
  const inList = '(' + (qids.length ? qids.join(',') : NIL_UUID) + ')'

  const BM = 'id, quotation_id, tipo, monto, moneda, fecha, concepto, lead_id'
  const CM = 'quotation_id, tipo, monto, moneda, fecha, concepto, persona, lead_id, tc_aplicado, monto_cotizacion, moneda_cotizacion'
  const [bmA, bmB, cmA, cmB, paR] = await Promise.all([
    supabase.from('bank_movements').select(BM).eq('lead_id', leadId).then(r => r.data || []),
    supabase.from('bank_movements').select(BM).filter('quotation_id', 'in', inList).then(r => r.data || []),
    supabase.from('cash_movements').select(CM).eq('lead_id', leadId).then(r => r.data || []),
    supabase.from('cash_movements').select(CM).filter('quotation_id', 'in', inList).then(r => r.data || []),
    supabase.from('payment_allocations').select('quotation_id, monto, bank_movement_id, tc_aplicado, monto_origen, moneda_origen').filter('quotation_id', 'in', inList).then(r => r.data || []),
  ])
  const dedupe = (rows: any[], key: (r: any) => string) => {
    const m = new Map<string, any>()
    rows.forEach(r => m.set(key(r), r))
    return Array.from(m.values())
  }
  const bm = dedupe([...(bmA as any[]), ...(bmB as any[])], r => String(r.id))
  const cm = dedupe([...(cmA as any[]), ...(cmB as any[])], r => [r.quotation_id, r.lead_id, r.fecha, r.monto, r.concepto].join('|'))

  const doc = generarEstadoCuentaPdf({
    lead: { name: leadName, company: '' },
    quotations: quots,
    bankMovements: bm,
    cashMovements: cm,
    paymentAllocations: paR as any[],
  })
  const uri = doc.output('datauristring')
  return {
    filename: `Estado_de_Cuenta_${(leadName || 'Obra').replace(/\s+/g, '_')}.pdf`,
    dataB64: uri.substring(uri.indexOf('base64,') + 7),
    mime: 'application/pdf',
  }
}

// ── Borrador en Gmail ──
export async function crearBorrador(p: { to: string; subject: string; body: string; attachments: Adjunto[] }): Promise<{ ok: boolean; url?: string; email?: string; error?: string }> {
  const r = await fetch('/api/gmail?action=create_draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  })
  return await r.json()
}

// ── Textos ──
const money = (n: number) => '$' + Math.round(n).toLocaleString('es-MX')

export function textoEstadoCuenta(obra: { lead: string; vTot: number; cTot: number; porCobrar: number; avance: number }) {
  return {
    subject: `Estado de cuenta — ${obra.lead}`,
    body: [
      `Hola,`,
      ``,
      `Espero que te encuentres muy bien. Te comparto el estado de cuenta de ${obra.lead} a la fecha.`,
      ``,
      `• Contratado: ${money(obra.vTot)}`,
      `• Pagado a la fecha: ${money(obra.cTot)} (${Math.round(obra.avance * 100)}%)`,
      `• Saldo pendiente: ${money(obra.porCobrar)}`,
      ``,
      `Adjunto el detalle. Si tienes cualquier duda, con gusto lo revisamos juntos.`,
      ``,
      `Gracias como siempre por la confianza. Quedo al pendiente.`,
      ``,
      `Un saludo,`,
    ].join('\n'),
  }
}

export function textoFactura(f: FacturaRow, obra: { lead: string; porCobrar: number }) {
  const folio = [f.serie, f.folio].filter(Boolean).join('') || (f.facturapi_id || '')
  const fecha = String(f.fecha_emision || '').slice(0, 10)
  return {
    subject: `Factura ${folio} — ${obra.lead}`,
    body: [
      `Hola,`,
      ``,
      `Te comparto la factura ${folio}${fecha ? ` del ${fecha}` : ''} por ${money(Number(f.total) || 0)}${f.moneda && f.moneda !== 'MXN' ? ' ' + f.moneda : ''}, correspondiente a ${obra.lead}.`,
      ``,
      `Va el PDF adjunto (y el XML si lo necesitan para su contabilidad).`,
      ``,
      `Cualquier cosa quedo al pendiente. Gracias.`,
      ``,
      `Un saludo,`,
    ].join('\n'),
  }
}
