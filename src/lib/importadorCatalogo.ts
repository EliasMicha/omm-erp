// ═══════════════════════════════════════════════════════════════════════════
// importadorCatalogo — subir una lista de precios completa sin romper nada.
//
// Por qué no sirve el importador viejo para esto: le mandaba a la IA los
// primeros 15,000 caracteres del archivo y le pedía que devolviera los
// productos. Con una lista de Lutron de miles de renglones eso trunca el
// archivo, se topa con el límite de salida del modelo, y encima solo inserta:
// volver a subir la lista del año siguiente no actualizaba un solo precio.
//
// Aquí el archivo se parsea LOCALMENTE. La IA no interviene en leer renglones
// —eso es determinista y tiene que serlo— a lo mucho ayudaría a adivinar
// columnas, y para eso bastan los encabezados.
//
// Las tres decisiones que hacen que esto sea seguro:
//
//   1. La identidad es el número de parte normalizado. "HQWT-U-P4W-BL",
//      "hqwt u p4w bl" y "HQWTUP4WBL" son el mismo producto; si no se
//      normaliza, cada lista crea duplicados y el catálogo se vuelve basura.
//
//   2. Nada se escribe sin vista previa. Antes de aplicar se dice cuántos
//      entran nuevos, a cuántos les sube el precio, a cuántos les baja y en
//      cuánto. Un archivo con la columna equivocada se ve al instante porque
//      "todos bajan 99%".
//
//   3. Los renglones sin número de parte NO se importan a ciegas. Sin parte no
//      hay forma de saber si ya existe, y el siguiente archivo los volvería a
//      crear.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizarModelo } from './cotizadorIA'

export interface FilaCruda { [col: string]: any }

export interface Mapeo {
  modelo: string
  name: string
  costo: string
  precioVenta: string
  precioLista: string
  marca: string
  descripcion: string
  unidad: string
}

export const MAPEO_VACIO: Mapeo = {
  modelo: '', name: '', costo: '', precioVenta: '', precioLista: '', marca: '', descripcion: '', unidad: '',
}

/** Encabezados que suele traer una lista de precios, en español e inglés. */
const PISTAS: Record<keyof Mapeo, string[]> = {
  modelo: ['model', 'modelo', 'part', 'partnumber', 'part number', 'parte', 'numerodeparte', 'sku', 'clave', 'codigo', 'código', 'item', 'catalog', 'catalogo'],
  name: ['name', 'nombre', 'descripcion corta', 'product', 'producto', 'description', 'descripcion', 'descripción'],
  costo: ['costo', 'cost', 'net', 'neto', 'dealer', 'distributor', 'compra', 'unitcost', 'unit cost', 'precio neto'],
  precioVenta: ['venta', 'precio venta', 'preciodeventa', 'publico', 'público', 'sale', 'selling', 'pvp', 'precio publico'],
  precioLista: ['lista', 'list', 'msrp', 'listprice', 'list price', 'precio lista'],
  marca: ['marca', 'brand', 'fabricante', 'manufacturer'],
  descripcion: ['descripcion larga', 'especificacion', 'especificación', 'detalle', 'long description'],
  unidad: ['unidad', 'unit', 'uom', 'um'],
}

const norm = (s: any) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ')

/**
 * Adivina qué columna es cuál a partir de los encabezados. Se prefiere la
 * coincidencia exacta sobre la parcial: en una lista con "Cost" y "Unit Cost"
 * las dos son costo, pero "Cost" gana por ser exacta.
 */
export function detectarColumnas(columnas: string[]): Mapeo {
  const m = { ...MAPEO_VACIO }
  const usadas = new Set<string>()
  for (const campo of Object.keys(PISTAS) as (keyof Mapeo)[]) {
    let exacta = ''
    let parcial = ''
    for (const col of columnas) {
      if (usadas.has(col)) continue
      const c = norm(col)
      for (const pista of PISTAS[campo]) {
        if (c === pista) { exacta = col; break }
        if (!parcial && c.includes(pista)) parcial = col
      }
      if (exacta) break
    }
    const elegida = exacta || parcial
    if (elegida) { m[campo] = elegida; usadas.add(elegida) }
  }
  return m
}

const numDe = (v: any): number => {
  if (typeof v === 'number') return isFinite(v) ? v : 0
  // "$1,234.50", "1.234,50", "USD 1234.50"
  const limpio = String(v ?? '').replace(/[^0-9.,-]/g, '')
  if (!limpio) return 0
  const comas = (limpio.match(/,/g) || []).length
  const puntos = (limpio.match(/\./g) || []).length
  let s = limpio
  if (comas && puntos) {
    // El separador decimal es el que aparece más a la derecha
    s = limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
      ? limpio.replace(/\./g, '').replace(',', '.')
      : limpio.replace(/,/g, '')
  } else if (comas === 1 && limpio.length - limpio.indexOf(',') <= 3) {
    s = limpio.replace(',', '.')
  } else {
    s = limpio.replace(/,/g, '')
  }
  const n = parseFloat(s)
  return isFinite(n) ? n : 0
}

export type Accion = 'nuevo' | 'sube' | 'baja' | 'igual' | 'sin_parte' | 'sin_precio'

export interface FilaImport {
  fila: number
  modelo: string
  clave: string
  name: string
  marca: string
  descripcion: string
  unidad: string
  costo: number
  precioVenta: number
  precioLista: number
  accion: Accion
  existenteId?: string | null
  costoAnterior?: number | null
  ventaAnterior?: number | null
  variacion?: number | null   // cambio del costo, 0..1
}

export interface ProductoExistente {
  id: string
  modelo?: string | null
  sku?: string | null
  cost?: any
  precio_venta?: any
}

export interface OpcionesImport {
  /** Margen para calcular el precio de venta cuando la lista no lo trae. */
  margenDefault: number
  /** % de descuento de compra: costo = lista × (1 − desc). Solo si no hay costo. */
  descuentoCompraPct?: number
  marcaDefault?: string
}

/**
 * Convierte las filas crudas del archivo en filas listas para aplicar, ya
 * comparadas contra lo que hay en el catálogo.
 */
export function prepararFilas(
  crudas: FilaCruda[],
  mapeo: Mapeo,
  existentes: ProductoExistente[],
  opts: OpcionesImport,
): FilaImport[] {
  // Índice por número de parte normalizado (modelo y sku alimentan el mismo).
  const porClave = new Map<string, ProductoExistente>()
  for (const p of existentes) {
    for (const k of [normalizarModelo(p.modelo), normalizarModelo(p.sku)]) {
      if (k.length >= 4 && !porClave.has(k)) porClave.set(k, p)
    }
  }

  const vistas = new Set<string>()
  const salida: FilaImport[] = []

  crudas.forEach((c, i) => {
    const modelo = String(c[mapeo.modelo] ?? '').trim()
    const clave = normalizarModelo(modelo)
    const name = String(c[mapeo.name] ?? '').trim() || modelo

    const lista = mapeo.precioLista ? numDe(c[mapeo.precioLista]) : 0
    let costo = mapeo.costo ? numDe(c[mapeo.costo]) : 0
    let venta = mapeo.precioVenta ? numDe(c[mapeo.precioVenta]) : 0

    // Sin costo pero con lista y descuento de compra: el costo se deduce.
    if (costo === 0 && lista > 0 && opts.descuentoCompraPct) {
      costo = Math.round(lista * (1 - opts.descuentoCompraPct / 100) * 10000) / 10000
    }
    // Sin precio de venta: se propone con el margen, o la lista si existe.
    if (venta === 0) venta = lista > 0 ? lista : Math.round(costo * opts.margenDefault * 100) / 100

    const base: FilaImport = {
      fila: i + 2,   // +2: fila 1 son los encabezados en la hoja
      modelo, clave, name,
      marca: String(c[mapeo.marca] ?? '').trim() || opts.marcaDefault || '',
      descripcion: String(c[mapeo.descripcion] ?? '').trim(),
      unidad: String(c[mapeo.unidad] ?? '').trim() || 'pza',
      costo, precioVenta: venta, precioLista: lista,
      accion: 'nuevo',
    }

    if (!clave || clave.length < 3) { salida.push({ ...base, accion: 'sin_parte' }); return }
    if (costo <= 0 && venta <= 0) { salida.push({ ...base, accion: 'sin_precio' }); return }

    // Duplicado DENTRO del mismo archivo: se queda el primero. Importar los dos
    // crearía dos productos con el mismo número de parte.
    if (vistas.has(clave)) { salida.push({ ...base, accion: 'igual' }); return }
    vistas.add(clave)

    const ex = porClave.get(clave)
    if (!ex) { salida.push({ ...base, accion: 'nuevo' }); return }

    const costoAnt = Number(ex.cost) || 0
    const ventaAnt = Number(ex.precio_venta) || 0
    const cambioCosto = costo > 0 && costoAnt > 0 ? (costo - costoAnt) / costoAnt : null
    const igual = Math.abs(costo - costoAnt) < 0.01 && Math.abs(venta - ventaAnt) < 0.01
    salida.push({
      ...base,
      accion: igual ? 'igual' : (costo >= costoAnt ? 'sube' : 'baja'),
      existenteId: ex.id,
      costoAnterior: costoAnt,
      ventaAnterior: ventaAnt,
      variacion: cambioCosto,
    })
  })

  return salida
}

export interface Resumen {
  nuevos: number
  suben: number
  bajan: number
  iguales: number
  sinParte: number
  sinPrecio: number
  subeProm: number | null
  bajaProm: number | null
}

export function resumir(filas: FilaImport[]): Resumen {
  const suben = filas.filter(f => f.accion === 'sube')
  const bajan = filas.filter(f => f.accion === 'baja')
  const prom = (arr: FilaImport[]) => {
    const v = arr.map(f => f.variacion).filter((x): x is number => x != null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  return {
    nuevos: filas.filter(f => f.accion === 'nuevo').length,
    suben: suben.length,
    bajan: bajan.length,
    iguales: filas.filter(f => f.accion === 'igual').length,
    sinParte: filas.filter(f => f.accion === 'sin_parte').length,
    sinPrecio: filas.filter(f => f.accion === 'sin_precio').length,
    subeProm: prom(suben),
    bajaProm: prom(bajan),
  }
}

export const ACCION_CFG: Record<Accion, { label: string; color: string }> = {
  nuevo:      { label: 'Nuevo',        color: '#10B981' },
  sube:       { label: 'Sube',         color: '#D9A441' },
  baja:       { label: 'Baja',         color: '#2563EB' },
  igual:      { label: 'Sin cambio',   color: '#555' },
  sin_parte:  { label: 'Sin parte',    color: '#DC2626' },
  sin_precio: { label: 'Sin precio',   color: '#DC2626' },
}

/** Carga SheetJS desde CDN (mismo patrón que los exports del ERP). */
export async function cargarXLSX(): Promise<any> {
  const w = window as any
  if (w.XLSX) return w.XLSX
  await new Promise<void>((res, rej) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    s.onload = () => res(); s.onerror = () => rej(new Error('No se pudo cargar la librería de Excel'))
    document.head.appendChild(s)
  })
  return (window as any).XLSX
}

/** Lee la primera hoja con datos y devuelve filas como objetos. */
export async function leerArchivo(file: File): Promise<{ columnas: string[]; filas: FilaCruda[]; hoja: string }> {
  const XLSX = await cargarXLSX()
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  // Se toma la primera hoja que tenga más de un renglón: muchas listas traen
  // una portada vacía antes de los datos.
  for (const nombre of wb.SheetNames) {
    const filas: FilaCruda[] = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { defval: '' })
    if (filas.length > 0) {
      const columnas = Object.keys(filas[0]).filter(c => String(c).trim() !== '')
      return { columnas, filas, hoja: nombre }
    }
  }
  throw new Error('El archivo no tiene filas de datos.')
}
