import { supabase } from './supabase'
import { monedaDeCosto, type Moneda } from './moneda'

// ─────────────────────────────────────────────────────────────────────────────
//  Bodega general — el material que ya es nuestro y no pertenece a ninguna obra.
//
//  No hay tabla nueva ni columna nueva: el libro `stock_movements` ya acepta
//  `ajuste_entrada` / `ajuste_salida`, y `v_stock_bodega` ya los suma porque
//  cuenta por destino_tipo/origen_tipo. Lo unico que faltaba era una puerta de
//  entrada que no fuera una orden de compra.
//
//  El VALOR se toma del costo del catalogo (costo de reposicion de hoy), que es
//  el mismo numero con el que se cotiza. Un producto sin costo capturado NO se
//  valua en cero: se cuenta aparte, porque un cero silencioso hace que la
//  bodega parezca mas barata de lo que es.
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaBodega {
  catalog_product_id: string | null
  marca: string
  modelo: string
  descripcion: string
  unit: string
  en_bodega: number
  /** Costo unitario de reposicion (catalogo). null = el catalogo no lo tiene. */
  costo: number | null
  /** Moneda del costo del catalogo. */
  moneda: Moneda
  /** en_bodega * costo. null cuando no hay costo: no se inventa un cero. */
  valor: number | null
  specialty: string | null
}

export interface ResumenBodega {
  productos: number
  piezas: number
  valorMXN: number
  valorUSD: number
  /** Productos con existencia pero sin costo en el catalogo. */
  sinCosto: number
  piezasSinCosto: number
}

/** Un renglon del conteo fisico que el usuario esta capturando. */
export interface LineaConteo {
  key: string
  catalog_product_id: string | null
  descripcion: string
  marca: string | null
  modelo: string | null
  unit: string
  /** Cantidad CONTADA en el estante (no es un delta). */
  contado: number
  /** Lo que el sistema cree que hay, al momento de cargar la pantalla. */
  sistema: number
}

/**
 * El costo vive SIEMPRE en `catalog_products.cost`, y la moneda de ese costo
 * la dicta `catalog_products.moneda` (ver lib/moneda.ts, que es la regla unica
 * del ERP). `costo_usd` esta en cero en los 2,229 productos del catalogo: es
 * una columna muerta y leerla haria ver todo como pesos. Un Sonos Amp de USD
 * 579 valuado en pesos encoge la bodega ~20 veces.
 *
 * No se convierte a una sola moneda: el total se reporta separado por moneda,
 * porque meterle un tipo de cambio del momento inventa diferencias.
 */
function costoDe(cp: any): { costo: number | null; moneda: Moneda } {
  const moneda = monedaDeCosto(cp)
  const c = Number(cp?.cost) || 0
  return { costo: c > 0 ? c : null, moneda }
}

export async function cargarBodega(): Promise<{ filas: FilaBodega[]; resumen: ResumenBodega }> {
  const { data: stock, error } = await supabase.from('v_stock_bodega').select('*')
  if (error) throw error

  const ids = [...new Set(((stock as any[]) || []).map(s => s.catalog_product_id).filter(Boolean))]
  const catMap: Record<string, any> = {}
  // .in() con muchos ids revienta la URL: se pide por lotes.
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('catalog_products')
      .select('id,name,description,marca,modelo,unit,cost,moneda,specialty')
      .in('id', ids.slice(i, i + 200))
    for (const c of (data as any[]) || []) catMap[c.id] = c
  }

  const filas: FilaBodega[] = ((stock as any[]) || [])
    .filter(s => Number(s.en_bodega) > 0)
    .map(s => {
      const cp = s.catalog_product_id ? catMap[s.catalog_product_id] : null
      const { costo, moneda } = costoDe(cp)
      const qty = Number(s.en_bodega) || 0
      return {
        catalog_product_id: s.catalog_product_id || null,
        marca: s.marca || cp?.marca || '',
        modelo: s.modelo || cp?.modelo || '',
        descripcion: s.descripcion || cp?.description || cp?.name || '',
        unit: cp?.unit || 'pza',
        en_bodega: qty,
        costo,
        moneda,
        valor: costo != null ? qty * costo : null,
        specialty: cp?.specialty || null,
      }
    })
    .sort((a, b) => (b.valor || 0) - (a.valor || 0) || b.en_bodega - a.en_bodega)

  const resumen: ResumenBodega = {
    productos: filas.length,
    piezas: filas.reduce((s, f) => s + f.en_bodega, 0),
    valorMXN: filas.filter(f => f.moneda === 'MXN').reduce((s, f) => s + (f.valor || 0), 0),
    valorUSD: filas.filter(f => f.moneda === 'USD').reduce((s, f) => s + (f.valor || 0), 0),
    sinCosto: filas.filter(f => f.costo == null).length,
    piezasSinCosto: filas.filter(f => f.costo == null).reduce((s, f) => s + f.en_bodega, 0),
  }
  return { filas, resumen }
}

export interface ResultadoConteo {
  entradas: number
  salidas: number
  sinCambio: number
  folio: string
}

/**
 * Guarda un conteo fisico. Cada renglon dice CUANTO HAY en el estante; aqui se
 * calcula el delta contra lo que el sistema creia y se escribe UN movimiento
 * por diferencia. Los renglones que ya cuadran no generan movimiento: un libro
 * lleno de asientos de cero no se puede leer.
 */
export async function guardarConteo(
  lineas: LineaConteo[],
  opts: { motivo?: string; movidoPor?: string | null; movidoPorNombre?: string | null },
): Promise<ResultadoConteo> {
  const folio = 'CONTEO-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase()

  const rows: any[] = []
  let sinCambio = 0
  for (const l of lineas) {
    const delta = Number(l.contado) - Number(l.sistema)
    if (!delta) { sinCambio++; continue }
    const base = {
      catalog_product_id: l.catalog_product_id,
      descripcion: l.descripcion || null,
      marca: l.marca || null,
      modelo: l.modelo || null,
      qty: Math.abs(delta),           // qty > 0 es obligatorio en el libro
      unit: l.unit || 'pza',
      bucket_destino: null as string | null,
      motivo: opts.motivo || 'Conteo fisico de bodega',
      folio,
      movido_por: opts.movidoPor || null,
      movido_por_nombre: opts.movidoPorNombre || null,
    }
    if (delta > 0) {
      // Entra a bodega sin proveedor detras: origen_tipo se queda nulo.
      rows.push({ ...base, tipo: 'ajuste_entrada', origen_tipo: null, destino_tipo: 'bodega', bucket_destino: 'general' })
    } else {
      rows.push({ ...base, tipo: 'ajuste_salida', origen_tipo: 'bodega', destino_tipo: null })
    }
  }

  if (rows.length) {
    const { error } = await supabase.from('stock_movements').insert(rows)
    if (error) throw error
  }

  return {
    entradas: rows.filter(r => r.tipo === 'ajuste_entrada').length,
    salidas: rows.filter(r => r.tipo === 'ajuste_salida').length,
    sinCambio,
    folio,
  }
}
