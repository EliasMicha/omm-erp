import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
//  Expedientes de anticipo (metodo del SAT para anticipos, Anexo 20)
//
//  Un anticipo bien documentado son TRES comprobantes encadenados:
//
//    1. FACTURA DE ANTICIPO   tipo I, con un concepto de clave 84111506.
//    2. FACTURA DE PRODUCTO   tipo I, relacionada al anticipo con TipoRelacion
//                             07 ("CFDI por aplicacion de anticipo").
//    3. EGRESO DE APLICACION  tipo E, relacionado a la factura de producto,
//                             tambien con TipoRelacion 07, por el monto del
//                             anticipo. Es el que "descuenta" el anticipo.
//
//  La cadena se lee AL REVES de como se emite: el hijo apunta al padre. La
//  factura de producto guarda el UUID del anticipo; el egreso guarda el UUID
//  de la factura de producto.
//
//  OJO CON LAS MAYUSCULAS: `uuids_relacionados` guarda los UUID en mayusculas
//  y `uuid_fiscal` en minusculas. Comparados tal cual, NINGUNA cadena amarra.
//  Todo se normaliza a minusculas antes de comparar.
// ─────────────────────────────────────────────────────────────────────────────

/** Clave del SAT para "Anticipo" en el catalogo de productos y servicios. */
export const CLAVE_ANTICIPO = '84111506'
/** TipoRelacion 07 = CFDI por aplicacion de anticipo. */
export const REL_ANTICIPO = '07'
/** Centavos de tolerancia al comparar montos. */
export const TOLERANCIA = 0.05

const low = (v: any) => String(v ?? '').toLowerCase()
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export type EstatusExpediente = 'abierto' | 'en_aplicacion' | 'completo' | 'inconsistente'

export const ESTATUS_EXP: Record<EstatusExpediente, { label: string; color: string; desc: string }> = {
  abierto:       { label: 'Anticipo abierto',  color: '#2563EB', desc: 'Se cobró el anticipo y todavía no se factura producto contra él.' },
  en_aplicacion: { label: 'En aplicación',     color: '#D97706', desc: 'Ya hay factura de producto, pero falta el egreso que aplica el anticipo.' },
  completo:      { label: 'Aplicado — completo', color: '#10B981', desc: 'Anticipo, producto y egreso presentes, y el egreso cuadra con el anticipo.' },
  inconsistente: { label: 'Inconsistente',     color: '#DC2626', desc: 'La cadena existe pero algo no cuadra: montos, contraparte o duplicados.' },
}

export interface DocExp {
  id: string
  uuid: string
  serie: string | null
  folio: string | null
  fecha: string | null
  total: number
  moneda: string | null
  estado: string | null
  tipo_comprobante: string | null
  contraparte: string | null
  /** true si lo puso una persona y no la relacion del CFDI. */
  manual: boolean
  nota_manual?: string | null
}

export interface Expediente {
  anticipo: DocExp
  productos: DocExp[]
  egresos: DocExp[]
  totalProductos: number
  totalEgresos: number
  /** anticipo − egresado. Lo que falta por aplicar. */
  porAplicar: number
  estatus: EstatusExpediente
  motivos: string[]
}

interface FilaFactura {
  id: string; uuid_fiscal: string | null; serie: string | null; folio: string | null
  fecha_emision: string | null; total: any; moneda: string | null; estado: string | null
  tipo_comprobante: string | null; direccion: string | null; tipo_relacion: string | null
  uuids_relacionados: any; emisor_nombre: string | null; receptor_nombre: string | null
  emisor_rfc: string | null; receptor_rfc: string | null
}

const aDoc = (f: FilaFactura, manual = false, nota?: string | null): DocExp => ({
  id: f.id, uuid: low(f.uuid_fiscal), serie: f.serie, folio: f.folio,
  fecha: f.fecha_emision, total: Number(f.total) || 0, moneda: f.moneda, estado: f.estado,
  tipo_comprobante: f.tipo_comprobante,
  contraparte: f.direccion === 'emitida' ? f.receptor_nombre : f.emisor_nombre,
  manual, nota_manual: nota ?? null,
})

const rfcContraparte = (f: FilaFactura) => low(f.direccion === 'emitida' ? f.receptor_rfc : f.emisor_rfc)

/**
 * Estatus del expediente.
 *
 * "Inconsistente" gana sobre cualquier otro: si algo no cuadra, no sirve de
 * nada decir "completo". Y cada motivo se escribe, porque un semaforo rojo sin
 * explicacion no le sirve a nadie para actuar.
 */
export function estatusDe(
  anticipo: number, productos: DocExp[], egresos: DocExp[],
  rfcAnticipo: string, rfcPorDoc: Map<string, string>,
  canceladas: Set<string>,
): { estatus: EstatusExpediente; motivos: string[]; porAplicar: number } {
  const totalEgresos = r2(egresos.reduce((s, e) => s + e.total, 0))
  const totalProductos = r2(productos.reduce((s, p) => s + p.total, 0))
  const porAplicar = r2(anticipo - totalEgresos)
  const motivos: string[] = []

  for (const d of [...productos, ...egresos]) {
    if (canceladas.has(d.id)) motivos.push(`${d.tipo_comprobante === 'E' ? 'El egreso' : 'La factura'} ${[d.serie, d.folio].filter(Boolean).join('-') || d.uuid.slice(0, 8)} está cancelada.`)
    const rfc = rfcPorDoc.get(d.id)
    if (rfc && rfcAnticipo && rfc !== rfcAnticipo) {
      motivos.push(`${[d.serie, d.folio].filter(Boolean).join('-') || 'Un documento'} es de otra contraparte que el anticipo.`)
    }
  }
  if (egresos.length && totalEgresos > anticipo + TOLERANCIA) {
    motivos.push(`Los egresos aplican ${r2(totalEgresos - anticipo).toFixed(2)} más de lo que se anticipó.`)
  }
  if (productos.length && totalProductos + TOLERANCIA < anticipo && egresos.length) {
    motivos.push(`El producto facturado (${totalProductos.toFixed(2)}) es menor que el anticipo (${anticipo.toFixed(2)}).`)
  }
  if (anticipo <= 0) motivos.push('El anticipo tiene total en cero.')
  if (!productos.length && egresos.length) motivos.push('Hay egreso de aplicación pero ninguna factura de producto en medio.')

  if (motivos.length) return { estatus: 'inconsistente', motivos, porAplicar }
  if (!productos.length) return { estatus: 'abierto', motivos, porAplicar }
  if (!egresos.length) return { estatus: 'en_aplicacion', motivos, porAplicar }
  if (Math.abs(totalEgresos - anticipo) <= TOLERANCIA) return { estatus: 'completo', motivos, porAplicar }
  return { estatus: 'en_aplicacion', motivos, porAplicar }
}

export interface AjusteManual {
  id: string; anticipo_id: string; factura_id: string
  rol: 'producto' | 'egreso'; accion: 'agregar' | 'excluir'
  nota: string | null; hecho_por: string | null
}

/** Arma todos los expedientes de una dirección leyendo las relaciones CFDI. */
export async function cargarExpedientes(direccion: 'emitida' | 'recibida'): Promise<{
  expedientes: Expediente[]
  candidatas: DocExp[]
}> {
  // Todas las facturas de la direccion, paginadas: pasan de mil.
  const cols = 'id,uuid_fiscal,serie,folio,fecha_emision,total,moneda,estado,tipo_comprobante,direccion,tipo_relacion,uuids_relacionados,emisor_nombre,receptor_nombre,emisor_rfc,receptor_rfc'
  const todas: FilaFactura[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('facturas').select(cols)
      .eq('direccion', direccion).range(from, from + 999)
    if (error) throw error
    const d = (data as any[]) || []
    todas.push(...(d as FilaFactura[]))
    if (d.length < 1000) break
  }

  // Los conceptos dicen cual factura es de anticipo (clave 84111506).
  const ids = todas.map(f => f.id)
  const anticipoIds = new Set<string>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from('factura_conceptos')
      .select('factura_id').eq('clave_prod_serv', CLAVE_ANTICIPO).in('factura_id', ids.slice(i, i + 300))
    for (const c of (data as any[]) || []) anticipoIds.add(c.factura_id)
  }

  const { data: ajustesRaw } = await supabase.from('anticipo_expediente_manual').select('*')
  const ajustes = ((ajustesRaw as any[]) || []) as AjusteManual[]

  const porUuid = new Map<string, FilaFactura>()
  for (const f of todas) if (f.uuid_fiscal) porUuid.set(low(f.uuid_fiscal), f)
  const porId = new Map(todas.map(f => [f.id, f]))
  const canceladas = new Set(todas.filter(f => f.estado === 'cancelada').map(f => f.id))
  const rfcPorDoc = new Map(todas.map(f => [f.id, rfcContraparte(f)]))

  // hijos[uuidPadre] = facturas que lo relacionan con TipoRelacion 07
  const hijos = new Map<string, FilaFactura[]>()
  for (const f of todas) {
    if (f.tipo_relacion !== REL_ANTICIPO || !Array.isArray(f.uuids_relacionados)) continue
    for (const u of f.uuids_relacionados) {
      const k = low(u)
      if (!k) continue
      const arr = hijos.get(k) || []
      arr.push(f); hijos.set(k, arr)
    }
  }

  const expedientes: Expediente[] = []
  for (const f of todas) {
    if (!anticipoIds.has(f.id) || f.tipo_comprobante !== 'I') continue
    const misAjustes = ajustes.filter(a => a.anticipo_id === f.id)
    const excluidos = new Set(misAjustes.filter(a => a.accion === 'excluir').map(a => a.factura_id))

    // Productos: los que relacionan al anticipo, mas los agregados a mano.
    const prodAuto = (hijos.get(low(f.uuid_fiscal)) || []).filter(h => h.tipo_comprobante === 'I' && !excluidos.has(h.id))
    const productos: DocExp[] = prodAuto.map(p => aDoc(p))
    for (const a of misAjustes.filter(a => a.accion === 'agregar' && a.rol === 'producto')) {
      const p = porId.get(a.factura_id)
      if (p && !productos.some(x => x.id === p.id)) productos.push(aDoc(p, true, a.nota))
    }

    // Egresos: los que relacionan a cualquiera de las facturas de producto.
    const egresos: DocExp[] = []
    for (const p of productos) {
      for (const e of hijos.get(p.uuid) || []) {
        if (e.tipo_comprobante !== 'E' || excluidos.has(e.id)) continue
        if (!egresos.some(x => x.id === e.id)) egresos.push(aDoc(e))
      }
    }
    for (const a of misAjustes.filter(a => a.accion === 'agregar' && a.rol === 'egreso')) {
      const e = porId.get(a.factura_id)
      if (e && !egresos.some(x => x.id === e.id)) egresos.push(aDoc(e, true, a.nota))
    }

    const totalAnt = Number(f.total) || 0
    const calc = estatusDe(totalAnt, productos, egresos, rfcContraparte(f), rfcPorDoc, canceladas)
    expedientes.push({
      anticipo: aDoc(f), productos, egresos,
      totalProductos: r2(productos.reduce((s, p) => s + p.total, 0)),
      totalEgresos: r2(egresos.reduce((s, e) => s + e.total, 0)),
      ...calc,
    })
  }

  expedientes.sort((a, b) => String(b.anticipo.fecha || '').localeCompare(String(a.anticipo.fecha || '')))

  // Para el asignador manual: facturas que NO son anticipo, ordenadas por fecha.
  const candidatas: DocExp[] = todas
    .filter(f => !anticipoIds.has(f.id) && (f.tipo_comprobante === 'I' || f.tipo_comprobante === 'E'))
    .sort((a, b) => String(b.fecha_emision || '').localeCompare(String(a.fecha_emision || '')))
    .slice(0, 600).map(f => aDoc(f))

  return { expedientes, candidatas }
}

export async function agregarAlExpediente(
  anticipoId: string, facturaId: string, rol: 'producto' | 'egreso', quien: string, nota?: string,
) {
  const { error } = await supabase.from('anticipo_expediente_manual')
    .upsert({ anticipo_id: anticipoId, factura_id: facturaId, rol, accion: 'agregar', hecho_por: quien || null, nota: nota || null },
            { onConflict: 'anticipo_id,factura_id,rol' })
  if (error) throw error
}

export async function excluirDelExpediente(
  anticipoId: string, facturaId: string, rol: 'producto' | 'egreso', quien: string, nota?: string,
) {
  const { error } = await supabase.from('anticipo_expediente_manual')
    .upsert({ anticipo_id: anticipoId, factura_id: facturaId, rol, accion: 'excluir', hecho_por: quien || null, nota: nota || null },
            { onConflict: 'anticipo_id,factura_id,rol' })
  if (error) throw error
}

/** Quita el ajuste: el expediente vuelve a lo que digan las relaciones del CFDI. */
export async function quitarAjuste(anticipoId: string, facturaId: string, rol: 'producto' | 'egreso') {
  const { error } = await supabase.from('anticipo_expediente_manual').delete()
    .eq('anticipo_id', anticipoId).eq('factura_id', facturaId).eq('rol', rol)
  if (error) throw error
}
