import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
//  Complementos de pago (CFDI tipo P) contra facturas PPD.
//
//  Una factura con MetodoPago = PPD no se paga con la factura: se paga con uno
//  o varios CFDI de tipo P. Cada P trae, por cada pago, uno o varios
//  DoctoRelacionado, y CADA UNO dice a que factura corresponde en su atributo
//  IdDocumento — que es el folio fiscal (UUID) de la factura pagada.
//
//  Ese IdDocumento es la llave, y es la unica llave: ni la serie ni el folio ni
//  el monto sirven para amarrar sin ambiguedad (dos facturas pueden traer el
//  mismo importe y el folio se repite entre emisores).
//
//  El detalle vive en `factura_pagos`, un renglon por DoctoRelacionado. La
//  tabla ya existia con la estructura exacta del SAT, pero estaba vacia: el
//  importador de XML nunca leyo el nodo de Pagos, asi que de los complementos
//  solo se guardaba el encabezado.
// ─────────────────────────────────────────────────────────────────────────────

const NS_CFDI4 = 'http://www.sat.gob.mx/cfd/4'
const NS_CFDI3 = 'http://www.sat.gob.mx/cfd/3'
const NS_TFD = 'http://www.sat.gob.mx/TimbreFiscalDigital'
const NS_PAGO20 = 'http://www.sat.gob.mx/Pagos20'
const NS_PAGO10 = 'http://www.sat.gob.mx/Pagos'

const num = (v: string | null) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const txt = (v: string | null) => (v == null || v === '' ? null : v)

/** Un DoctoRelacionado: un pago aplicado a UNA factura. */
export interface DocRelacionado {
  uuid_doc_relacionado: string
  serie_doc: string | null
  folio_doc: string | null
  parcialidad: number
  saldo_anterior: number
  importe_pagado: number
  saldo_insoluto: number
  objeto_imp_dr: string | null
  moneda_dr: string | null
  equivalencia_dr: number | null
}

/** Un nodo Pago del complemento (una transferencia). */
export interface PagoParseado {
  fecha_pago: string | null
  forma_pago: string | null
  moneda: string | null
  tipo_cambio: number | null
  monto: number
  num_operacion: string | null
  rfc_emisor_cta: string | null
  cuenta_emisor: string | null
  rfc_receptor_cta: string | null
  cuenta_receptor: string | null
  docs: DocRelacionado[]
}

export interface ComplementoParseado {
  uuid: string
  serie: string | null
  folio: string | null
  fecha_emision: string | null
  emisor_rfc: string | null
  emisor_nombre: string | null
  receptor_rfc: string | null
  receptor_nombre: string | null
  pagos: PagoParseado[]
  /** Suma de los ImpPagado de todos los DoctoRelacionado. */
  totalPagado: number
  advertencias: string[]
}

/**
 * Lee un XML de CFDI y, si es tipo P, devuelve el complemento con su detalle.
 * Devuelve null si el XML no es un complemento de pago.
 */
export function parsearComplemento(xmlText: string): ComplementoParseado | null {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un XML válido.')

  const comp = doc.getElementsByTagNameNS(NS_CFDI4, 'Comprobante')[0]
    || doc.getElementsByTagNameNS(NS_CFDI3, 'Comprobante')[0]
    || doc.documentElement
  if (!comp) throw new Error('No se encontró el nodo Comprobante.')

  const tipo = comp.getAttribute('TipoDeComprobante')
  if (tipo !== 'P') return null

  const tfd = doc.getElementsByTagNameNS(NS_TFD, 'TimbreFiscalDigital')[0]
  const uuid = (tfd?.getAttribute('UUID') || '').toLowerCase()
  const advertencias: string[] = []
  if (!uuid) advertencias.push('El complemento no trae UUID timbrado.')

  const emisor = doc.getElementsByTagNameNS(NS_CFDI4, 'Emisor')[0] || doc.getElementsByTagNameNS(NS_CFDI3, 'Emisor')[0]
  const receptor = doc.getElementsByTagNameNS(NS_CFDI4, 'Receptor')[0] || doc.getElementsByTagNameNS(NS_CFDI3, 'Receptor')[0]

  // Pagos20 (CFDI 4.0) y Pagos10 (3.3) tienen los mismos atributos con otro
  // namespace; se aceptan los dos para no rechazar archivos viejos.
  let pagoNodes = doc.getElementsByTagNameNS(NS_PAGO20, 'Pago')
  let ns = NS_PAGO20
  if (!pagoNodes.length) { pagoNodes = doc.getElementsByTagNameNS(NS_PAGO10, 'Pago'); ns = NS_PAGO10 }
  if (!pagoNodes.length) advertencias.push('Es un CFDI tipo P pero no trae nodos de Pago.')

  const pagos: PagoParseado[] = []
  for (let i = 0; i < pagoNodes.length; i++) {
    const p = pagoNodes[i]
    const drNodes = p.getElementsByTagNameNS(ns, 'DoctoRelacionado')
    const docs: DocRelacionado[] = []
    for (let j = 0; j < drNodes.length; j++) {
      const d = drNodes[j]
      const id = (d.getAttribute('IdDocumento') || '').toLowerCase()
      if (!id) { advertencias.push('Un DoctoRelacionado viene sin IdDocumento; se omitió.'); continue }
      docs.push({
        uuid_doc_relacionado: id,
        serie_doc: txt(d.getAttribute('Serie')),
        folio_doc: txt(d.getAttribute('Folio')),
        parcialidad: num(d.getAttribute('NumParcialidad')) || 1,
        saldo_anterior: num(d.getAttribute('ImpSaldoAnt')),
        importe_pagado: num(d.getAttribute('ImpPagado')),
        saldo_insoluto: num(d.getAttribute('ImpSaldoInsoluto')),
        objeto_imp_dr: txt(d.getAttribute('ObjetoImpDR')),
        moneda_dr: txt(d.getAttribute('MonedaDR')),
        equivalencia_dr: d.getAttribute('EquivalenciaDR') ? num(d.getAttribute('EquivalenciaDR')) : null,
      })
    }
    if (!docs.length) advertencias.push('Un nodo Pago no relaciona ninguna factura.')
    pagos.push({
      fecha_pago: txt(p.getAttribute('FechaPago')),
      forma_pago: txt(p.getAttribute('FormaDePagoP')),
      moneda: txt(p.getAttribute('MonedaP')),
      tipo_cambio: p.getAttribute('TipoCambioP') ? num(p.getAttribute('TipoCambioP')) : null,
      monto: num(p.getAttribute('Monto')),
      num_operacion: txt(p.getAttribute('NumOperacion')),
      rfc_emisor_cta: txt(p.getAttribute('RfcEmisorCtaOrd')),
      cuenta_emisor: txt(p.getAttribute('CtaOrdenante')),
      rfc_receptor_cta: txt(p.getAttribute('RfcEmisorCtaBen')),
      cuenta_receptor: txt(p.getAttribute('CtaBeneficiario')),
      docs,
    })
  }

  // El Monto del Pago debe cuadrar con la suma de sus DoctoRelacionado cuando
  // la moneda del pago y la del documento son la misma. Si no cuadra, el
  // complemento viene mal y hay que decirlo, no sumarlo callado.
  for (const p of pagos) {
    const mismaMoneda = p.docs.every(d => !d.moneda_dr || d.moneda_dr === p.moneda)
    if (mismaMoneda && p.docs.length) {
      const suma = p.docs.reduce((s, d) => s + d.importe_pagado, 0)
      if (Math.abs(suma - p.monto) > 0.02) {
        advertencias.push(`Un pago de ${p.monto.toFixed(2)} no cuadra con la suma de sus documentos (${suma.toFixed(2)}).`)
      }
    }
  }

  return {
    uuid,
    serie: txt(comp.getAttribute('Serie')),
    folio: txt(comp.getAttribute('Folio')),
    fecha_emision: txt(comp.getAttribute('Fecha')),
    emisor_rfc: txt(emisor?.getAttribute('Rfc') || null),
    emisor_nombre: txt(emisor?.getAttribute('Nombre') || null),
    receptor_rfc: txt(receptor?.getAttribute('Rfc') || null),
    receptor_nombre: txt(receptor?.getAttribute('Nombre') || null),
    pagos,
    totalPagado: pagos.reduce((s, p) => s + p.docs.reduce((a, d) => a + d.importe_pagado, 0), 0),
    advertencias,
  }
}

// ── Estatus por factura ──────────────────────────────────────────────────────

export type EstatusPPD = 'pendiente' | 'parcial' | 'conciliada' | 'revision'

export const ESTATUS_CFG: Record<EstatusPPD, { label: string; color: string; desc: string }> = {
  pendiente:  { label: 'Pendiente de pago',   color: '#6B7280', desc: 'Sin ningún complemento de pago aplicado.' },
  parcial:    { label: 'Parcialmente pagada', color: '#D97706', desc: 'Tiene pagos, pero no cubren el total.' },
  conciliada: { label: 'Conciliada',          color: '#10B981', desc: 'Los pagos cubren el total de la factura.' },
  revision:   { label: 'Requiere revisión',   color: '#DC2626', desc: 'Algo no cuadra: sobrepago, parcialidad repetida o factura cancelada con pagos.' },
}

/** Centavos de tolerancia. Bajo a proposito: en CFDI los centavos importan. */
export const TOLERANCIA = 0.05

export interface PagoAplicado {
  id: string
  complemento_id: string
  complemento_uuid: string | null
  complemento_serie: string | null
  complemento_folio: string | null
  fecha_pago: string | null
  forma_pago: string | null
  parcialidad: number
  saldo_anterior: number
  importe_pagado: number
  saldo_insoluto: number
  num_operacion: string | null
  /** true si lo ligo una persona y no el IdDocumento del XML. */
  manual: boolean
  nota_manual: string | null
}

export interface FacturaPPD {
  id: string
  uuid_fiscal: string | null
  serie: string | null
  folio: string | null
  direccion: string | null
  fecha_emision: string | null
  contraparte: string | null
  total: number
  moneda: string | null
  estado: string | null
  pagos: PagoAplicado[]
  pagado: number
  saldo: number
  estatus: EstatusPPD
  motivos: string[]
}

/**
 * Estatus de una factura segun sus pagos.
 *
 * "Requiere revision" no es un cajon de sastre: se levanta solo por motivos
 * concretos, y cada motivo se nombra. Un estatus rojo sin explicacion no le
 * sirve a nadie.
 */
export function calcularEstatus(
  total: number, pagos: PagoAplicado[], cancelada: boolean,
): { pagado: number; saldo: number; estatus: EstatusPPD; motivos: string[] } {
  const pagado = Math.round(pagos.reduce((s, p) => s + (Number(p.importe_pagado) || 0), 0) * 100) / 100
  const saldo = Math.round((total - pagado) * 100) / 100
  const motivos: string[] = []

  if (cancelada && pagos.length) motivos.push('La factura está cancelada pero tiene pagos aplicados.')
  if (pagado > total + TOLERANCIA) {
    motivos.push(`Los pagos exceden el total de la factura por ${(pagado - total).toFixed(2)}.`)
  }
  const vistas = new Map<number, number>()
  for (const p of pagos) vistas.set(p.parcialidad, (vistas.get(p.parcialidad) || 0) + 1)
  for (const [parc, n] of vistas) if (n > 1) motivos.push(`La parcialidad ${parc} aparece ${n} veces.`)
  if (total <= 0) motivos.push('La factura tiene total en cero.')

  if (motivos.length) return { pagado, saldo, estatus: 'revision', motivos }
  if (pagos.length === 0) return { pagado, saldo, estatus: 'pendiente', motivos }
  if (pagado >= total - TOLERANCIA) return { pagado, saldo, estatus: 'conciliada', motivos }
  return { pagado, saldo, estatus: 'parcial', motivos }
}

// ── Carga desde la base ──────────────────────────────────────────────────────

/**
 * Trae las facturas PPD con sus pagos ya ligados.
 *
 * El amarre es uuid_doc_relacionado (IdDocumento del XML) contra
 * facturas.uuid_fiscal. `uuid_doc_manual`, cuando existe, MANDA sobre el del
 * XML: es la correccion que hizo una persona. El valor del XML no se borra
 * nunca, para poder ver de donde venia y revertir.
 */
export async function cargarPPD(direccion: 'emitida' | 'recibida'): Promise<{
  facturas: FacturaPPD[]
  huerfanos: PagoHuerfano[]
}> {
  const { data: facts, error: e1 } = await supabase.from('facturas')
    .select('id, uuid_fiscal, serie, folio, direccion, fecha_emision, emisor_nombre, receptor_nombre, total, moneda, estado')
    .eq('tipo_comprobante', 'I').eq('metodo_pago', 'PPD').eq('direccion', direccion)
    .order('fecha_emision', { ascending: false })
  if (e1) throw e1

  const { data: pagos, error: e2 } = await supabase.from('factura_pagos')
    .select('id, factura_id, fecha_pago, forma_pago, parcialidad, saldo_anterior, importe_pagado, saldo_insoluto, num_operacion, uuid_doc_relacionado, uuid_doc_manual, vinculo_manual_nota')
  if (e2) throw e2

  // Encabezados de los complementos, para poder nombrarlos en la pantalla.
  const compIds = [...new Set(((pagos as any[]) || []).map(p => p.factura_id).filter(Boolean))]
  const comps: Record<string, any> = {}
  for (let i = 0; i < compIds.length; i += 200) {
    const { data } = await supabase.from('facturas')
      .select('id, uuid_fiscal, serie, folio').in('id', compIds.slice(i, i + 200))
    for (const c of (data as any[]) || []) comps[c.id] = c
  }

  const porUuid = new Map<string, any>()
  for (const f of (facts as any[]) || []) if (f.uuid_fiscal) porUuid.set(String(f.uuid_fiscal).toLowerCase(), f)

  const pagosPorFactura = new Map<string, PagoAplicado[]>()
  const huerfanos: PagoHuerfano[] = []
  for (const p of (pagos as any[]) || []) {
    const manual = !!p.uuid_doc_manual
    const objetivo = String(p.uuid_doc_manual || p.uuid_doc_relacionado || '').toLowerCase()
    const f = objetivo ? porUuid.get(objetivo) : null
    const c = comps[p.factura_id]
    const aplicado: PagoAplicado = {
      id: p.id, complemento_id: p.factura_id,
      complemento_uuid: c?.uuid_fiscal || null, complemento_serie: c?.serie || null, complemento_folio: c?.folio || null,
      fecha_pago: p.fecha_pago, forma_pago: p.forma_pago,
      parcialidad: Number(p.parcialidad) || 1,
      saldo_anterior: Number(p.saldo_anterior) || 0,
      importe_pagado: Number(p.importe_pagado) || 0,
      saldo_insoluto: Number(p.saldo_insoluto) || 0,
      num_operacion: p.num_operacion, manual, nota_manual: p.vinculo_manual_nota || null,
    }
    if (f) {
      const arr = pagosPorFactura.get(f.id) || []
      arr.push(aplicado); pagosPorFactura.set(f.id, arr)
    } else if (objetivo) {
      // El IdDocumento apunta a una factura que no esta en el sistema, o que no
      // es PPD de esta direccion. No se pierde: se muestra aparte para ligarlo
      // a mano. Un pago que no aparece en ningun lado es como se pierde dinero.
      huerfanos.push({ ...aplicado, uuid_buscado: objetivo })
    }
  }

  const facturas: FacturaPPD[] = ((facts as any[]) || []).map(f => {
    const ps = (pagosPorFactura.get(f.id) || []).sort((a, b) => a.parcialidad - b.parcialidad)
    const total = Number(f.total) || 0
    const calc = calcularEstatus(total, ps, f.estado === 'cancelada')
    return {
      id: f.id, uuid_fiscal: f.uuid_fiscal, serie: f.serie, folio: f.folio,
      direccion: f.direccion, fecha_emision: f.fecha_emision,
      contraparte: f.direccion === 'emitida' ? f.receptor_nombre : f.emisor_nombre,
      total, moneda: f.moneda, estado: f.estado,
      pagos: ps, ...calc,
    }
  })
  return { facturas, huerfanos }
}

export interface PagoHuerfano extends PagoAplicado { uuid_buscado: string }

// ── Importar los XML de los complementos ─────────────────────────────────────

export interface ResultadoImport {
  archivo: string
  ok: boolean
  mensaje: string
  renglones?: number
}

/**
 * Guarda un complemento ya parseado: el encabezado en `facturas` (si no
 * estaba) y un renglon por DoctoRelacionado en `factura_pagos`.
 *
 * Es idempotente: reimportar el mismo XML actualiza en vez de duplicar,
 * gracias al unique (factura_id, uuid_doc_relacionado, parcialidad).
 */
export async function guardarComplemento(c: ComplementoParseado, rfcPropio: string): Promise<number> {
  if (!c.uuid) throw new Error('El complemento no trae UUID; no se puede guardar sin folio fiscal.')

  const direccion = (c.emisor_rfc || '').toUpperCase() === rfcPropio.toUpperCase() ? 'emitida' : 'recibida'

  const { data: ya } = await supabase.from('facturas')
    .select('id').eq('uuid_fiscal', c.uuid).maybeSingle()

  let compId = (ya as any)?.id as string | undefined
  if (!compId) {
    const { data, error } = await supabase.from('facturas').insert({
      direccion, uuid_fiscal: c.uuid, serie: c.serie, folio: c.folio,
      tipo_comprobante: 'P', fecha_emision: c.fecha_emision,
      emisor_rfc: c.emisor_rfc, emisor_nombre: c.emisor_nombre,
      receptor_rfc: c.receptor_rfc, receptor_nombre: c.receptor_nombre,
      total: c.totalPagado, moneda: 'XXX', estado: 'timbrada',
    }).select('id').single()
    if (error) throw error
    compId = (data as any).id
  }

  const filas: any[] = []
  for (const p of c.pagos) {
    for (const d of p.docs) {
      filas.push({
        factura_id: compId,
        fecha_pago: p.fecha_pago, forma_pago: p.forma_pago,
        moneda: p.moneda, tipo_cambio: p.tipo_cambio, monto: p.monto,
        num_operacion: p.num_operacion,
        rfc_emisor_cta: p.rfc_emisor_cta, cuenta_emisor: p.cuenta_emisor,
        rfc_receptor_cta: p.rfc_receptor_cta, cuenta_receptor: p.cuenta_receptor,
        uuid_doc_relacionado: d.uuid_doc_relacionado,
        serie_doc: d.serie_doc, folio_doc: d.folio_doc,
        parcialidad: d.parcialidad,
        saldo_anterior: d.saldo_anterior,
        importe_pagado: d.importe_pagado,
        saldo_insoluto: d.saldo_insoluto,
        objeto_imp_dr: d.objeto_imp_dr,
      })
    }
  }
  if (!filas.length) return 0
  const { error } = await supabase.from('factura_pagos')
    .upsert(filas, { onConflict: 'factura_id,uuid_doc_relacionado,parcialidad' })
  if (error) throw error
  return filas.length
}

// ── Vinculo manual ───────────────────────────────────────────────────────────

/** Liga un pago a una factura a mano. No toca lo que dice el XML. */
export async function vincularManual(pagoId: string, uuidFactura: string, quien: string, nota?: string) {
  const { error } = await supabase.from('factura_pagos').update({
    uuid_doc_manual: uuidFactura.toLowerCase(),
    vinculo_manual_por: quien || null,
    vinculo_manual_at: new Date().toISOString(),
    vinculo_manual_nota: nota || null,
  }).eq('id', pagoId)
  if (error) throw error
}

/** Quita el vinculo manual: el pago vuelve a donde lo mande el XML. */
export async function desvincularManual(pagoId: string) {
  const { error } = await supabase.from('factura_pagos').update({
    uuid_doc_manual: null, vinculo_manual_por: null,
    vinculo_manual_at: null, vinculo_manual_nota: null,
  }).eq('id', pagoId)
  if (error) throw error
}
