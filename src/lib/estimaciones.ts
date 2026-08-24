// ═══════════════════════════════════════════════════════════════════════════
// estimaciones — cobrar obra eléctrica por lo ejecutado, no por hitos.
//
// Una estimación es un cobro parcial de un contrato que ya existe. NO es una
// cotización nueva: si se modela como cotización, el ingreso se cuenta dos
// veces en Cobranza y en Finanzas, y la obra aparece vendida al doble.
//
// La mecánica es un checklist de la cotización: por cada concepto se captura
// cuánto se ejecutó en este periodo. Lo demás se calcula.
//
// Dos reglas que existen para que no se pierda dinero:
//
//   1. Lo ejecutado de MÁS no se esconde. Si estaban cotizados 5 contactos y
//      se hicieron 6, el sexto no se escribe encima del renglón contratado:
//      se abre como renglón de EXTRA con su propio importe. En eléctrico ahí
//      es donde se va el tiempo y el dinero de la obra, y tiene que ser
//      imposible que pase inadvertido.
//
//   2. El neteo suma, no borra. Cuando la obra cambia y hay que compensar,
//      la deductiva es otro renglón con cantidad negativa. Nunca se
//      sobreescribe lo ya cobrado — si no, en tres meses nadie sabe por qué
//      un contrato de $2.1M terminó cobrando $2.4M.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'

export type EstadoEstimacion = 'borrador' | 'revision' | 'aprobada' | 'facturada' | 'pagada' | 'cancelada'
export type OrigenRenglon = 'contrato' | 'extra' | 'deductiva'

/** Estados en los que la estimación ya es un compromiso de cobro. */
export const ESTIMACION_EN_FIRME: EstadoEstimacion[] = ['aprobada', 'facturada', 'pagada']

export const ESTADO_CFG: Record<EstadoEstimacion, { label: string; color: string }> = {
  borrador:  { label: 'Borrador',  color: '#6B7280' },
  revision:  { label: 'En revisión', color: '#D9A441' },
  aprobada:  { label: 'Aprobada',  color: '#2563EB' },
  facturada: { label: 'Facturada', color: '#A78BFA' },
  pagada:    { label: 'Pagada',    color: '#10B981' },
  cancelada: { label: 'Cancelada', color: '#DC2626' },
}

export interface Estimacion {
  id: string
  quotation_id: string
  numero: number
  periodo_inicio?: string | null
  periodo_fin?: string | null
  fecha: string
  estado: EstadoEstimacion
  amortizacion_pct: number
  amortizacion_monto: number
  iva_pct: number
  subtotal_contrato: number
  subtotal_extras: number
  subtotal_deductivas: number
  subtotal: number
  iva: number
  total: number
  moneda: string
  notas?: string | null
  aprobada_por?: string | null
  aprobada_at?: string | null
  factura_id?: string | null
}

export interface EstimacionItem {
  id: string
  estimacion_id: string
  quotation_item_id?: string | null
  origen: OrigenRenglon
  area?: string | null
  concepto: string
  unidad?: string | null
  precio_unitario: number
  cant_contratada: number
  cant_anterior: number
  cant_periodo: number
  importe?: number
  obra_extra_id?: string | null
  notas?: string | null
  order_index: number
}

const num = (v: any) => Number(v) || 0

// ── Totales ────────────────────────────────────────────────────────────────

export interface TotalesEstimacion {
  contrato: number
  extras: number
  deductivas: number
  subtotal: number
  amortizacion: number
  baseIva: number
  iva: number
  total: number
}

/**
 * Los totales de una estimación. La amortización del anticipo se descuenta
 * ANTES del IVA porque es una devolución de dinero ya cobrado (y ya
 * facturado con su IVA); volver a gravarla lo cobraría dos veces.
 */
export function totalesDe(items: EstimacionItem[], opts: { amortizacionPct?: number; ivaPct?: number }): TotalesEstimacion {
  let contrato = 0, extras = 0, deductivas = 0
  for (const it of items) {
    const imp = num(it.cant_periodo) * num(it.precio_unitario)
    if (it.origen === 'extra') extras += imp
    else if (it.origen === 'deductiva') deductivas += imp   // ya viene negativo
    else contrato += imp
  }
  const subtotal = contrato + extras + deductivas
  const amortizacion = -Math.abs(subtotal * (num(opts.amortizacionPct) / 100))
  const baseIva = subtotal + amortizacion
  const iva = baseIva * (num(opts.ivaPct ?? 16) / 100)
  return { contrato, extras, deductivas, subtotal, amortizacion, baseIva, iva, total: baseIva + iva }
}

// ── Armado de una estimación nueva ─────────────────────────────────────────

export interface RenglonBase {
  quotation_item_id: string
  area: string
  concepto: string
  unidad: string
  precio_unitario: number
  cant_contratada: number
  cant_anterior: number
  order_index: number
}

/**
 * Arma los renglones de una estimación nueva a partir de la cotización y de
 * lo que ya se estimó antes. `cant_anterior` sale de la suma de TODAS las
 * estimaciones previas que no estén canceladas — incluidos los borradores,
 * porque un borrador ya reservó ese avance y contarlo dos veces sería cobrar
 * dos veces el mismo trabajo.
 */
export async function armarRenglones(quotationId: string): Promise<{ renglones: RenglonBase[]; error?: string }> {
  const [{ data: items, error: e1 }, { data: previas, error: e2 }] = await Promise.all([
    supabase.from('quotation_items')
      .select('id,name,quantity,price,order_index,area_id,type')
      .eq('quotation_id', quotationId).order('order_index'),
    supabase.from('estimaciones')
      .select('id,estado,estimacion_items(quotation_item_id,cant_periodo,origen)')
      .eq('quotation_id', quotationId).neq('estado', 'cancelada'),
  ])
  if (e1) return { renglones: [], error: e1.message }
  if (e2) return { renglones: [], error: e2.message }

  const { data: areas } = await supabase.from('quotation_areas')
    .select('id,name,order_index').eq('quotation_id', quotationId).order('order_index')
  const areaNombre = new Map((areas || []).map((a: any) => [a.id, a.name]))
  const areaOrden = new Map((areas || []).map((a: any) => [a.id, num(a.order_index)]))

  // Acumulado previo por concepto (solo renglones de contrato: el avance de
  // un extra no descuenta de lo contratado)
  const acumulado = new Map<string, number>()
  for (const est of ((previas as any[]) || [])) {
    for (const it of (est.estimacion_items || [])) {
      if (!it.quotation_item_id || it.origen !== 'contrato') continue
      acumulado.set(it.quotation_item_id, (acumulado.get(it.quotation_item_id) || 0) + num(it.cant_periodo))
    }
  }

  const renglones: RenglonBase[] = ((items as any[]) || []).map((it, i) => ({
    quotation_item_id: it.id,
    area: areaNombre.get(it.area_id) || 'GENERAL',
    concepto: it.name || '',
    unidad: it.type === 'labor' ? 'salida' : 'pza',
    precio_unitario: num(it.price),
    cant_contratada: num(it.quantity),
    cant_anterior: acumulado.get(it.id) || 0,
    order_index: (areaOrden.get(it.area_id) ?? 999) * 1000 + (num(it.order_index) || i),
  }))
  renglones.sort((a, b) => a.order_index - b.order_index)
  return { renglones }
}

/** El siguiente número de estimación de un contrato. */
export async function siguienteNumero(quotationId: string): Promise<number> {
  const { data } = await supabase.from('estimaciones')
    .select('numero').eq('quotation_id', quotationId).order('numero', { ascending: false }).limit(1)
  return (((data as any[]) || [])[0]?.numero || 0) + 1
}

export async function crearEstimacion(quotationId: string, opts: {
  moneda?: string
  amortizacionPct?: number
  ivaPct?: number
  periodoInicio?: string | null
  periodoFin?: string | null
}): Promise<{ id?: string; error?: string }> {
  const { renglones, error } = await armarRenglones(quotationId)
  if (error) return { error }
  if (renglones.length === 0) return { error: 'La cotización no tiene conceptos que estimar.' }

  const numero = await siguienteNumero(quotationId)
  const { data: est, error: e1 } = await supabase.from('estimaciones').insert({
    quotation_id: quotationId,
    numero,
    moneda: opts.moneda || 'MXN',
    amortizacion_pct: num(opts.amortizacionPct),
    iva_pct: opts.ivaPct ?? 16,
    periodo_inicio: opts.periodoInicio || null,
    periodo_fin: opts.periodoFin || null,
  }).select('id').single()
  if (e1 || !est) return { error: e1?.message || 'No se pudo crear la estimación.' }

  const filas = renglones.map(r => ({
    estimacion_id: (est as any).id,
    quotation_item_id: r.quotation_item_id,
    origen: 'contrato',
    area: r.area,
    concepto: r.concepto,
    unidad: r.unidad,
    precio_unitario: r.precio_unitario,
    cant_contratada: r.cant_contratada,
    cant_anterior: r.cant_anterior,
    cant_periodo: 0,
    order_index: r.order_index,
  }))
  // En bloques: una cotización eléctrica puede traer 200 conceptos.
  for (let i = 0; i < filas.length; i += 100) {
    const { error: e2 } = await supabase.from('estimacion_items').insert(filas.slice(i, i + 100))
    if (e2) return { error: e2.message }
  }
  return { id: (est as any).id }
}

// ── La regla del excedente ─────────────────────────────────────────────────

/**
 * Cuánto de lo capturado se sale de lo contratado. Es lo que hay que mover a
 * un renglón de extra en vez de dejarlo escondido dentro del concepto.
 */
export function excedenteDe(it: EstimacionItem): number {
  if (it.origen !== 'contrato') return 0
  const acumulado = num(it.cant_anterior) + num(it.cant_periodo)
  return Math.max(0, acumulado - num(it.cant_contratada))
}

/** Lo que todavía se puede cobrar de un concepto sin salirse del contrato. */
export function disponibleDe(it: EstimacionItem): number {
  return Math.max(0, num(it.cant_contratada) - num(it.cant_anterior))
}

/** % de avance acumulado del concepto (para la barra de la fila). */
export function avanceDe(it: EstimacionItem): number {
  const c = num(it.cant_contratada)
  if (c <= 0) return 0
  return (num(it.cant_anterior) + num(it.cant_periodo)) / c
}

// ── Lectura para tableros ──────────────────────────────────────────────────

export interface ResumenContrato {
  contratado: number
  estimadoEnFirme: number      // aprobada|facturada|pagada
  estimadoBorrador: number
  extrasAcumulados: number
  deductivasAcumuladas: number
  porEstimar: number
  estimaciones: number
}

/**
 * Cómo va un contrato: cuánto se contrató, cuánto se ha estimado en firme y
 * cuánto falta por estimar. `porEstimar` solo mira los renglones de contrato:
 * los extras no reducen el saldo del contrato original, lo aumentan.
 */
export async function resumenDeContrato(quotationId: string): Promise<ResumenContrato> {
  const [{ data: q }, { data: ests }] = await Promise.all([
    supabase.from('quotations').select('total,total_final').eq('id', quotationId).maybeSingle(),
    supabase.from('estimaciones')
      .select('id,estado,estimacion_items(cant_periodo,precio_unitario,origen)')
      .eq('quotation_id', quotationId).neq('estado', 'cancelada'),
  ])
  const contratado = num((q as any)?.total_final ?? (q as any)?.total)
  let enFirme = 0, borrador = 0, extras = 0, deduct = 0, contratoEstimado = 0
  for (const e of ((ests as any[]) || [])) {
    let sub = 0
    for (const it of (e.estimacion_items || [])) {
      const imp = num(it.cant_periodo) * num(it.precio_unitario)
      sub += imp
      if (it.origen === 'extra') extras += imp
      else if (it.origen === 'deductiva') deduct += imp
      else contratoEstimado += imp
    }
    if (ESTIMACION_EN_FIRME.includes(e.estado)) enFirme += sub; else borrador += sub
  }
  return {
    contratado,
    estimadoEnFirme: enFirme,
    estimadoBorrador: borrador,
    extrasAcumulados: extras,
    deductivasAcumuladas: deduct,
    porEstimar: Math.max(0, contratado - contratoEstimado),
    estimaciones: ((ests as any[]) || []).length,
  }
}

/**
 * Cuánto de OBRA CONTRATADA se estimó en las estimaciones anteriores a ésta.
 * Solo cuenta renglones de contrato: los extras no consumen el contrato, y
 * meterlos aquí haría que el "saldo por ejecutar" de la carátula mintiera.
 */
export async function contratoEstimadoAntes(quotationId: string, numero: number): Promise<number> {
  const { data } = await supabase.from('estimaciones')
    .select('numero,estado,estimacion_items(cant_periodo,precio_unitario,origen)')
    .eq('quotation_id', quotationId).neq('estado', 'cancelada').lt('numero', numero)
  let s = 0
  for (const e of ((data as any[]) || [])) {
    for (const it of (e.estimacion_items || [])) {
      if (it.origen !== 'contrato') continue
      s += num(it.cant_periodo) * num(it.precio_unitario)
    }
  }
  return s
}

/** Cliente y obra para la carátula: el lead vive en notes, no como FK. */
export async function contextoDeContrato(quotationId: string): Promise<{ cliente: string; obra: string; nombre: string; total: number }> {
  const { data: q } = await supabase.from('quotations')
    .select('id,name,notes,total,total_final,client_name').eq('id', quotationId).maybeSingle()
  const nombre = (q as any)?.name || 'Contrato'
  const total = num((q as any)?.total_final ?? (q as any)?.total)
  let leadId = ''
  try { leadId = JSON.parse((q as any)?.notes || '{}')?.lead_id || '' } catch { /* notas libres */ }
  let cliente = (q as any)?.client_name || ''
  let obra = nombre
  if (leadId) {
    const { data: l } = await supabase.from('leads').select('name,company').eq('id', leadId).maybeSingle()
    if (l) { cliente = (l as any).company || (l as any).name || cliente; obra = (l as any).name || obra }
  }
  return { cliente: cliente || '—', obra, nombre, total }
}
