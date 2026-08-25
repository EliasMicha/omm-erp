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
  descuento_pct: number
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
  /** Descuento de contrato, negativo. Aplica a lo contratado, no a los extras. */
  descuento: number
  subtotal: number
  amortizacion: number
  baseIva: number
  iva: number
  total: number
}

/**
 * Los totales de una estimación.
 *
 * ORDEN DE OPERACIONES, que es donde se pierde el dinero:
 *
 *   contrato ejecutado (a P.U. de la cotización firmada)
 *   + deductivas
 *   − DESCUENTO DE CONTRATO        ← el % que se pactó al cerrar
 *   + extras                        ← precio nuevo: el descuento no los toca
 *   = subtotal
 *   − amortización de anticipo      ← antes del IVA: es devolución de dinero
 *                                     ya cobrado y ya facturado con su IVA;
 *                                     volver a gravarla lo cobraría dos veces
 *   = base gravable
 *   + IVA del contrato              ← 8% en frontera, 16% en el resto. NO se
 *                                     asume: sale de la cotización de cierre
 *
 * El descuento va como RENGLÓN y no prorrateado en cada P.U. a propósito: el
 * precio unitario de la estimación tiene que ser idéntico al del contrato que
 * el cliente firmó. Prorratearlo lo esconde, descuadra por centavos contra el
 * contrato y obliga a explicar en obra por qué una salida vale distinto aquí
 * que allá.
 */
export function totalesDe(items: EstimacionItem[], opts: { amortizacionPct?: number; ivaPct?: number; descuentoPct?: number }): TotalesEstimacion {
  let contrato = 0, extras = 0, deductivas = 0
  for (const it of items) {
    const imp = num(it.cant_periodo) * num(it.precio_unitario)
    if (it.origen === 'extra') extras += imp
    else if (it.origen === 'deductiva') deductivas += imp   // ya viene negativo
    else contrato += imp
  }
  const descuento = -Math.abs((contrato + deductivas) * (num(opts.descuentoPct) / 100))
  const subtotal = contrato + deductivas + descuento + extras
  const amortizacion = -Math.abs(subtotal * (num(opts.amortizacionPct) / 100))
  const baseIva = subtotal + amortizacion
  const iva = baseIva * (num(opts.ivaPct ?? 16) / 100)
  return { contrato, extras, deductivas, descuento, subtotal, amortizacion, baseIva, iva, total: baseIva + iva }
}

/**
 * Las condiciones comerciales del contrato: moneda, IVA y descuento. Viven en
 * `quotations.notes` como JSON — no como columnas— así que hay que leerlas de
 * ahí. Si no se puede parsear, se devuelve lo neutro y se dice: inventar un
 * 16% donde había 8% factura de más.
 */
export async function condicionesDelContrato(quotationId: string): Promise<{ ivaPct: number; descuentoPct: number; moneda: string }> {
  const { data } = await supabase.from('quotations').select('notes').eq('id', quotationId).maybeSingle()
  let cfg: any = {}
  try { cfg = JSON.parse((data as any)?.notes || '{}') } catch { cfg = {} }
  const nz = (v: any, def: number) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? def : Number(v))
  return {
    ivaPct: nz(cfg.ivaRate, 16),
    descuentoPct: nz(cfg.descuento, 0),
    moneda: cfg.currency || 'MXN',
  }
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
  descuentoPct?: number
  periodoInicio?: string | null
  periodoFin?: string | null
}): Promise<{ id?: string; error?: string }> {
  const { renglones, error } = await armarRenglones(quotationId)
  if (error) return { error }
  if (renglones.length === 0) return { error: 'La cotización no tiene conceptos que estimar.' }

  // Las condiciones se heredan del contrato: IVA, descuento y moneda. Antes
  // toda estimación nacía con 16% y sin descuento, cobrara lo que cobrara el
  // contrato — y una obra de frontera al 8% salía facturada al doble de IVA.
  const cond = await condicionesDelContrato(quotationId)

  const numero = await siguienteNumero(quotationId)
  const { data: est, error: e1 } = await supabase.from('estimaciones').insert({
    quotation_id: quotationId,
    numero,
    moneda: opts.moneda || cond.moneda,
    amortizacion_pct: num(opts.amortizacionPct),
    iva_pct: opts.ivaPct ?? cond.ivaPct,
    descuento_pct: opts.descuentoPct ?? cond.descuentoPct,
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
  /** Subtotal contratado a precio de lista, sin descuento ni IVA. */
  contratado: number
  /** Lo mismo, ya con el descuento del contrato aplicado. */
  contratadoNeto: number
  descuentoPct: number
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
  const [{ data: q }, { data: ests }, cond] = await Promise.all([
    supabase.from('quotations').select('total,total_final').eq('id', quotationId).maybeSingle(),
    supabase.from('estimaciones')
      .select('id,estado,estimacion_items(cant_periodo,precio_unitario,origen)')
      .eq('quotation_id', quotationId).neq('estado', 'cancelada'),
    condicionesDelContrato(quotationId),
  ])
  // OJO: `total_final` trae IVA y descuento; los renglones de estimación son
  // subtotales a precio de lista. Comparar uno contra otro daba un saldo por
  // estimar que no significaba nada. Aquí se compara lista contra lista.
  const contratado = num((q as any)?.total)
  const contratadoNeto = contratado * (1 - num(cond.descuentoPct) / 100)
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
    contratadoNeto,
    descuentoPct: num(cond.descuentoPct),
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

/**
 * Cliente y obra para la carátula: el lead vive en notes, no como FK.
 *
 * `total` es el SUBTOTAL contratado a precio de lista —la misma base en la que
 * están los renglones de la estimación—. Antes devolvía `total_final`, que
 * trae IVA y descuento, y el "avance del contrato" salía siempre bajo porque
 * comparaba subtotales contra un total con impuestos.
 */
export async function contextoDeContrato(quotationId: string): Promise<{ cliente: string; obra: string; nombre: string; total: number }> {
  const { data: q } = await supabase.from('quotations')
    .select('id,name,notes,total,total_final,client_name').eq('id', quotationId).maybeSingle()
  const nombre = (q as any)?.name || 'Contrato'
  const total = num((q as any)?.total ?? (q as any)?.total_final)
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


// ── Borrar una estimación ──────────────────────────────────────────────────
//
// Se puede borrar de verdad mientras sea BORRADOR o esté EN REVISIÓN. Una vez
// aprobada, facturada o pagada ya salió del edificio: ahí se cancela, no se
// borra, para que no desaparezca un documento que alguien tiene en la mano.
//
// El folio es lo delicado. Si se borra la #2 de 3, la #3 tiene que bajar a #2
// o el cliente pregunta dónde quedó la que falta. Pero renumerar una
// estimación ya facturada rompe la correspondencia con su factura — así que
// si alguna posterior está en firme, no se borra y se dice por qué.

export async function puedeBorrarse(est: Pick<Estimacion, 'id' | 'numero' | 'estado' | 'quotation_id'>): Promise<{ ok: boolean; motivo?: string }> {
  if (ESTIMACION_EN_FIRME.includes(est.estado)) {
    return { ok: false, motivo: `Esta estimación está ${ESTADO_CFG[est.estado].label.toLowerCase()}. Una estimación que ya salió no se borra: se cancela, para que quede el rastro de que existió.` }
  }
  const { data } = await supabase.from('estimaciones')
    .select('numero,estado').eq('quotation_id', est.quotation_id).gt('numero', est.numero)
  const enFirme = ((data as any[]) || []).filter(e => ESTIMACION_EN_FIRME.includes(e.estado))
  if (enFirme.length > 0) {
    return {
      ok: false,
      motivo: `Hay ${enFirme.length} estimación(es) posterior(es) ya en firme (#${enFirme.map(e => e.numero).join(', #')}). ` +
        'Borrar ésta obligaría a recorrer sus folios, y un folio que cambia deja de cuadrar con la factura que ya se emitió.',
    }
  }
  return { ok: true }
}

export async function borrarEstimacion(est: Pick<Estimacion, 'id' | 'numero' | 'estado' | 'quotation_id'>): Promise<{ ok: boolean; error?: string; renumeradas?: number }> {
  const permiso = await puedeBorrarse(est)
  if (!permiso.ok) return { ok: false, error: permiso.motivo }

  // Los renglones se van solos (ON DELETE CASCADE en estimacion_items).
  const { error } = await supabase.from('estimaciones').delete().eq('id', est.id)
  if (error) return { ok: false, error: error.message }

  // Recorrer los folios posteriores para no dejar hueco.
  const { data: posteriores } = await supabase.from('estimaciones')
    .select('id,numero').eq('quotation_id', est.quotation_id).gt('numero', est.numero).order('numero')
  const lista = ((posteriores as any[]) || [])
  for (const e of lista) {
    await supabase.from('estimaciones').update({ numero: e.numero - 1, updated_at: new Date().toISOString() }).eq('id', e.id)
  }
  return { ok: true, renumeradas: lista.length }
}
