// Formato de pedido para NULED (2026-11-27).
//
// NULED pide a su proveedor con un Excel fijo ("Orden Nuled"): quién factura,
// los datos fiscales de OMM, uso de la factura y la tabla con clave SAT,
// cantidad, descripción, unidad, clave de unidad, precio y subtotal.
//
// Por instrucción de Elias:
//  - La empresa que factura por omisión es CONSTRUCTORA KANSO (constancia de
//    situación fiscal del 2-sep-2026).
//  - El uso de la factura siempre es G03 Gastos en general.
//
// Los renglones salen como quedaron después del cotejo (comoQuedo), igual que
// el PDF de la orden, para que el pedido y la orden digan lo mismo.
import { supabase } from './supabase'
import { comoQuedo } from './cotejo'
import { xlsxBlob, type Fila, type HojaXlsx } from './xlsxExport'
import { guardarBlob } from './guardarArchivo'

export const NULED_EMPRESA_FACTURA = { nombre: 'CONSTRUCTORA KANSO', rfc: 'CKA251209963' }
const OMM = {
  nombre: 'OMM TECHNOLOGIES SA DE CV',
  rfc: 'OTE210910PW5',
  domicilio: 'Bosques de Duraznos 69, PB int B',
}
const USO_CFDI = 'G03 - GASTOS EN GENERAL'

export function esProveedorNuled(nombre: string | null | undefined): boolean {
  return /nuled/i.test(String(nombre || ''))
}

// Clave SAT cuando el catálogo no la trae (157 de 177 productos de NULED no la
// tienen). Sale de las claves que usa el formato original.
function claveSatSugerida(texto: string): string {
  const t = texto.toLowerCase()
  if (/tira|manguera|strip|cob/.test(t)) return '39112102'
  if (/driver|fuente|transformador/.test(t)) return '39112403'
  if (/perfil/.test(t)) return '39112505'
  if (/downlight|luminaria|spot|proyector|uplight|lampara|lámpara|empotr|trimless/.test(t)) return '39111505'
  return '39111800'
}

function unidadTexto(u: string | null | undefined): string {
  const x = String(u || '').toLowerCase()
  if (!x || /^(pza|pz|pieza|piezas|pzas?)\.?$/.test(x)) return 'PIEZA'
  if (/^(m|ml|mts?|metro|metros)\.?$/.test(x)) return 'METRO'
  if (/rollo/.test(x)) return 'ROLLO'
  return x.toUpperCase()
}

function claveUnidadDe(u: string | null | undefined): string {
  const x = unidadTexto(u)
  if (x === 'METRO') return 'MTR'
  return 'H87'
}

export interface POParaNuled { id: string; folio?: string | null; po_number?: string | null; currency?: string | null }

export async function descargarOrdenNuled(po: POParaNuled, items: any[]): Promise<void> {
  const catIds = [...new Set(items.map(i => i.catalog_product_id).filter(Boolean))]
  const cat = new Map<string, any>()
  if (catIds.length) {
    const { data } = await supabase.from('catalog_products')
      .select('id,modelo,marca,unit,clave_prod_serv,clave_unidad').in('id', catIds)
    ;(data || []).forEach((c: any) => cat.set(c.id, c))
  }

  const folio = po.folio || po.po_number || ''
  const lineas = items.map(raw => {
    const c = raw.catalog_product_id ? cat.get(raw.catalog_product_id) : null
    const it: any = comoQuedo({ ...raw, marca: raw.marca || c?.marca || '', modelo: raw.modelo || c?.modelo || '' })
    const modelo = String(it.modelo || '').trim()
    const nombre = String(it.name || '').trim()
    const descripcion = modelo && !nombre.toUpperCase().includes(modelo.toUpperCase()) ? `${modelo} — ${nombre}` : nombre
    const unidad = it.unit || c?.unit
    return {
      clave: (it.sustituido ? '' : c?.clave_prod_serv) || claveSatSugerida(descripcion),
      cantidad: Number(it.quantity) || 0,
      descripcion,
      unidad: unidadTexto(unidad),
      claveUnidad: (it.sustituido ? '' : c?.clave_unidad) || claveUnidadDe(unidad),
      precio: Number(it.unit_cost) || 0,
      subtotal: Number(it.total) || 0,
    }
  })

  const pre: Fila[] = [
    [],
    { celdas: ['', 'EMPRESA QUE FACTURA / PROVEEDOR'], estilo: 'etiqueta' },
    { celdas: ['', NULED_EMPRESA_FACTURA.nombre], estilo: 'titulo' },
    ['', 'RFC ' + NULED_EMPRESA_FACTURA.rfc],
    { celdas: ['Nombre o Razón Social', OMM.nombre], estilo: 'normal' },
    { celdas: ['RFC:', OMM.rfc], estilo: 'normal' },
    { celdas: ['Domicilio Fiscal', OMM.domicilio], estilo: 'normal' },
    { celdas: ['Uso de la Factura', USO_CFDI], estilo: 'normal' },
    { celdas: ['Forma de Pago', 'PUE'], estilo: 'normal' },
    { celdas: ['Método de pago', 'TRANSFERENCIA'], estilo: 'normal' },
    [],
    [],
    { celdas: ['Factura Relacionada'], estilo: 'etiqueta' },
    [' anotar Folio Fiscal'],
    [],
    { celdas: ['PEDIDO ' + folio], estilo: 'etiqueta' },
  ]
  // Fila del encabezado = pre.length + 1; los renglones empiezan una abajo.
  const primera = pre.length + 2
  const ultima = primera + Math.max(lineas.length, 1) - 1
  const suma = lineas.reduce((s, l) => s + l.subtotal, 0)
  const filaSuma = ultima + 2
  const iva = Math.round(suma * 0.16 * 100) / 100

  const hoja: HojaXlsx = {
    nombre: 'ORDEN',
    columnas: [
      { titulo: 'Clave SAT de Producto o Servicio', ancho: 27 },
      { titulo: 'CANTIDAD', ancho: 40 },
      { titulo: 'DESCRIPCION', ancho: 55 },
      { titulo: 'Unidad', ancho: 16 },
      { titulo: 'Clave de Unidad', ancho: 16 },
      { titulo: 'Precio  Unitario', ancho: 21, moneda: true },
      { titulo: 'Subtotal', ancho: 15, moneda: true },
    ],
    preFilas: pre,
    filas: lineas.map((l, i) => ({
      celdas: [l.clave, l.cantidad, l.descripcion, l.unidad, l.claveUnidad, l.precio,
        { f: `B${primera + i}*F${primera + i}`, v: l.subtotal }],
      estilo: 'dato' as const,
    })),
    notas: [
      [],
      { celdas: ['', '', '', '', '', 'SUMA', { f: `SUM(G${primera}:G${ultima})`, v: suma }], estilo: 'normal' },
      { celdas: ['', '', '', '', '', 'IVA', { f: `G${filaSuma}*0.16`, v: iva }], estilo: 'normal' },
      { celdas: ['', '', '', '', '', 'Impuestos Retenidos', 0], estilo: 'normal' },
      { celdas: ['', '', '', '', '', 'Total', { f: `G${filaSuma}+G${filaSuma + 1}-G${filaSuma + 2}`, v: suma + iva }], estilo: 'negrita' },
    ],
  }
  await guardarBlob(xlsxBlob([hoja]), `Orden NULED ${folio}.xlsx`)
}
