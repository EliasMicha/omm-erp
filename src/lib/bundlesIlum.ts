// Bundles en el cotizador de Iluminacion.
//
// Un bundle aqui es un TIPO DE ESPACIO: "Habitacion A - Marriott Ixtapa" son
// las 10 luminarias, tiras, perfiles y fuentes que lleva una habitacion. Se
// arma una vez y se aplica a las 120 habitaciones del hotel.
//
// ── La decision de fondo ──────────────────────────────────────────────────
// Se guarda EXPLOTADO y se pinta AGRUPADO.
//
// Cada producto del bundle es su propio `quotation_items`, etiquetado con
// bundle_instance_id. En pantalla los renglones de una instancia se dibujan
// como una sola linea desplegable, pero en la base siguen siendo 10 renglones.
// Esto importa porque Compras, Seguimiento y Entregas trabajan por producto:
// para comprar hay que saber que son 840 bases GU10 (7 x 120), no "120
// habitaciones". Si se guardara como un renglon opaco, la compra se rompe.
//
// Invariante que sostiene todo:  quantity = bundle_unit_qty * bundle_qty
import { supabase } from './supabase'
import { convertir, monedaDeCosto, type Moneda } from './moneda'

export interface BundleCatItem {
  id: string
  product_id: string
  quantity: number
  product: any | null
}

export interface BundleCat {
  id: string
  name: string
  description: string | null
  system: string | null
  items: BundleCatItem[]
}

/** Un renglon del cotizador, visto por la logica de bundles. */
export interface FilaBundle {
  id: string
  bundleInstanceId?: string | null
  bundleId?: string | null
  bundleName?: string | null
  bundleQty?: number | null
  bundleUnitQty?: number | null
  quantity: number
  price: number
  cost: number
  monedaCosto?: Moneda
  subsectionId: string
}

/** Un grupo listo para pintar: o un bundle con sus hijos, o un producto suelto. */
export type Agrupado<T extends FilaBundle> =
  | { tipo: 'bundle'; instanceId: string; bundleId: string | null; nombre: string; qty: number; hijos: T[] }
  | { tipo: 'suelto'; fila: T }

/**
 * Agrupa los renglones de una subseccion respetando el orden en que aparecen:
 * el bundle se dibuja donde cae su PRIMER renglon, no al final.
 */
export function agruparPorBundle<T extends FilaBundle>(filas: T[]): Array<Agrupado<T>> {
  const out: Array<Agrupado<T>> = []
  const indice = new Map<string, number>()
  for (const f of filas) {
    const inst = f.bundleInstanceId
    if (!inst) { out.push({ tipo: 'suelto', fila: f }); continue }
    const yaEsta = indice.get(inst)
    if (yaEsta != null) {
      const g = out[yaEsta]
      if (g.tipo === 'bundle') g.hijos.push(f)
      continue
    }
    indice.set(inst, out.length)
    out.push({
      tipo: 'bundle', instanceId: inst,
      bundleId: f.bundleId || null,
      nombre: f.bundleName || 'Bundle',
      qty: Number(f.bundleQty) || 1,
      hijos: [f],
    })
  }
  return out
}

/** Precio y costo de UNA unidad del bundle, y el total por su multiplicador. */
export function totalesDeBundle<T extends FilaBundle>(
  hijos: T[], qty: number, costoEnMonedaCot: (p: T) => number,
) {
  let precioUnit = 0, costoUnit = 0
  for (const h of hijos) {
    // La cantidad por unidad es el dato guardado; si falta (renglon viejo) se
    // deduce de la cantidad final. Nunca se divide entre cero.
    const uq = Number(h.bundleUnitQty) || (qty > 0 ? Number(h.quantity) / qty : Number(h.quantity))
    precioUnit += Number(h.price) * uq
    costoUnit += costoEnMonedaCot(h) * uq
  }
  const total = precioUnit * qty
  const costoTotal = costoUnit * qty
  const margen = precioUnit > 0 ? ((precioUnit - costoUnit) / precioUnit) * 100 : 0
  return { precioUnit, costoUnit, total, costoTotal, margen }
}

/** Carga los bundles del catalogo; `specialty` filtra por los productos que traen. */
export async function cargarBundles(specialty?: string): Promise<BundleCat[]> {
  const { data: bs, error } = await supabase.from('catalog_bundles')
    .select('*').eq('is_active', true).order('name')
  if (error) throw error
  if (!bs?.length) return []
  const { data: items } = await supabase.from('catalog_bundle_items')
    .select('*, product:catalog_products(*)').in('bundle_id', bs.map((b: any) => b.id))
  const out: BundleCat[] = bs.map((b: any) => ({
    id: b.id, name: b.name, description: b.description, system: b.system,
    items: (items || [])
      .filter((i: any) => i.bundle_id === b.id && i.product)
      .map((i: any) => ({ id: i.id, product_id: i.product_id, quantity: Number(i.quantity) || 1, product: i.product })),
  }))
  if (!specialty) return out.filter(b => b.items.length > 0)
  // Solo los que traen al menos un producto de esta especialidad; si no, el
  // picker de iluminacion se llena de kits de rack y de redes.
  return out.filter(b => b.items.some(i => i.product?.specialty === specialty))
}

export interface FilaNueva {
  id: string
  catalogId: string
  name: string
  description: string
  imageUrl: string | null
  quantity: number
  cost: number
  markup: number
  price: number
  monedaCosto: Moneda
  marca: string | null
  modelo: string | null
  sku: string | null
  watts: number | null
  lumens: number | null
  cct: string | null
  bundleId: string
  bundleInstanceId: string
  bundleName: string
  bundleQty: number
  bundleUnitQty: number
  order: number
}

const nuevoInstanceId = () =>
  Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)

/**
 * Mete un bundle a una subseccion. Devuelve los renglones creados.
 * Si algun producto no se puede convertir de moneda, se aborta ANTES de
 * escribir: meter medio bundle es peor que no meterlo.
 */
export async function insertarBundle(opts: {
  cotId: string
  subsectionId: string
  bundle: BundleCat
  qty: number
  monedaCot: Moneda
  tc: number
  ordenInicial: number
}): Promise<FilaNueva[]> {
  const { cotId, subsectionId, bundle, monedaCot, tc, ordenInicial } = opts
  const qty = Math.max(1, Number(opts.qty) || 1)

  // 1. Calcular todo primero. Si algo truena, no se escribio nada.
  const preparados = bundle.items.map((item, i) => {
    const p = item.product
    if (!p) throw new Error(`El bundle "${bundle.name}" tiene un producto que ya no existe en el catalogo.`)
    const markup = Number(p.markup) || 35
    const mCosto = monedaDeCosto(p)
    const precioNat = Number(p.precio_venta) > 0
      ? Number(p.precio_venta)
      : (Number(p.cost) > 0 && markup < 100 ? Math.round(Number(p.cost) / (1 - markup / 100) * 100) / 100 : 0)
    const price = convertir(precioNat, mCosto, monedaCot, tc)
    const unitQty = Number(item.quantity) || 1
    return { p, markup, mCosto, price, unitQty, i }
  })

  const instanceId = nuevoInstanceId()
  const payload = preparados.map(x => ({
    quotation_id: cotId, area_id: subsectionId, catalog_product_id: x.p.id,
    name: x.p.name, description: x.p.description || null, image_url: x.p.image_url || null,
    quantity: x.unitQty * qty,
    cost: Number(x.p.cost) || 0, markup: x.markup, price: x.price,
    provider_currency: x.mCosto,
    total: x.price * x.unitQty * qty,
    order_index: ordenInicial + x.i,
    system: 'Iluminacion', type: 'material',
    marca: x.p.marca || null, modelo: x.p.modelo || null, sku: x.p.sku || null,
    bundle_id: bundle.id, bundle_instance_id: instanceId,
    bundle_qty: qty, bundle_unit_qty: x.unitQty,
    notes: JSON.stringify({ watts: x.p.watts, lumens: x.p.lumens, cct: x.p.cct }),
  }))

  const { data, error } = await supabase.from('quotation_items').insert(payload).select()
  if (error) throw error

  return (data || []).map((d: any, k: number) => {
    const x = preparados[k]
    return {
      id: d.id, catalogId: x.p.id, name: x.p.name, description: x.p.description || '',
      imageUrl: x.p.image_url || null, quantity: x.unitQty * qty,
      cost: Number(x.p.cost) || 0, markup: x.markup, price: x.price, monedaCosto: x.mCosto,
      marca: x.p.marca || null, modelo: x.p.modelo || null, sku: x.p.sku || null,
      watts: x.p.watts ?? null, lumens: x.p.lumens ?? null, cct: x.p.cct ?? null,
      bundleId: bundle.id, bundleInstanceId: instanceId, bundleName: bundle.name,
      bundleQty: qty, bundleUnitQty: x.unitQty,
      order: ordenInicial + k,
    }
  })
}

/**
 * Cambia el multiplicador de una instancia. Recalcula cantidad y total de cada
 * hijo desde bundle_unit_qty, que es el dato que no se pierde.
 */
export async function cambiarQtyBundle<T extends FilaBundle>(
  hijos: T[], nuevaQty: number,
): Promise<Array<{ id: string; quantity: number; total: number; bundleQty: number }>> {
  const qty = Math.max(1, Number(nuevaQty) || 1)
  const cambios = hijos.map(h => {
    const prev = Number(h.bundleQty) || 1
    const uq = Number(h.bundleUnitQty) || (prev > 0 ? Number(h.quantity) / prev : Number(h.quantity))
    const quantity = uq * qty
    return { id: h.id, quantity, total: Number(h.price) * quantity, bundleQty: qty, uq }
  })
  for (const c of cambios) {
    const { error } = await supabase.from('quotation_items')
      .update({ quantity: c.quantity, total: c.total, bundle_qty: qty, bundle_unit_qty: c.uq })
      .eq('id', c.id)
    if (error) throw error
  }
  return cambios.map(({ id, quantity, total, bundleQty }) => ({ id, quantity, total, bundleQty }))
}

/** Rompe el grupo: los renglones se quedan, sueltos. No borra nada. */
export async function desagruparBundle(ids: string[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase.from('quotation_items')
    .update({ bundle_id: null, bundle_instance_id: null, bundle_qty: null, bundle_unit_qty: null })
    .in('id', ids)
  if (error) throw error
}

/**
 * Guarda una subseccion como bundle nuevo del catalogo.
 *
 * Solo entran renglones con catalogId: un producto que no existe en el
 * catalogo no se puede volver a insertar despues, asi que se reporta en vez
 * de guardarlo a medias.
 */
export async function guardarComoBundle(opts: {
  nombre: string
  descripcion?: string | null
  filas: Array<{ catalogId: string | null; name: string; quantity: number; bundleQty?: number | null; bundleUnitQty?: number | null }>
}): Promise<{ bundleId: string; guardados: number; omitidos: string[] }> {
  const nombre = opts.nombre.trim()
  if (!nombre) throw new Error('El bundle necesita un nombre.')

  const omitidos: string[] = []
  // Se agrupa por producto: si el area trae el mismo downlight en dos
  // renglones, el bundle debe llevarlo una vez con la cantidad sumada.
  const porProducto = new Map<string, number>()
  for (const f of opts.filas) {
    if (!f.catalogId) { omitidos.push(f.name); continue }
    // Si el renglon ya venia de un bundle, se guarda su cantidad POR UNIDAD,
    // no la multiplicada: si no, meter "Habitacion A" x120 y guardarla de
    // nuevo generaria un bundle de 840 bases GU10.
    const uq = f.bundleUnitQty != null ? Number(f.bundleUnitQty) : Number(f.quantity)
    porProducto.set(f.catalogId, (porProducto.get(f.catalogId) || 0) + uq)
  }
  if (porProducto.size === 0) {
    throw new Error(omitidos.length
      ? 'Ningun producto de esta seccion esta en el catalogo, no hay que guardar.'
      : 'La seccion esta vacia.')
  }

  const { data: b, error } = await supabase.from('catalog_bundles')
    .insert({ name: nombre, description: opts.descripcion || null, system: 'Iluminacion', is_active: true })
    .select('id').single()
  if (error) throw error

  const filas = Array.from(porProducto.entries()).map(([product_id, quantity]) => ({
    bundle_id: b.id, product_id, quantity,
  }))
  const { error: e2 } = await supabase.from('catalog_bundle_items').insert(filas)
  if (e2) {
    // No dejar un bundle vacio colgado en el catalogo.
    await supabase.from('catalog_bundles').delete().eq('id', b.id)
    throw e2
  }
  return { bundleId: b.id, guardados: filas.length, omitidos }
}
