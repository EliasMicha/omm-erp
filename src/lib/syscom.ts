// Syscom en el ERP (2026-11-14).
//
// La API vive detrás de la Edge Function `syscom` (las credenciales nunca
// llegan al navegador). Aquí sólo hay llamadas y tipos.
//
//   buscarSyscom(q)            → productos con precio OMM (descuento + financiero, USD sin IVA) y existencia
//   sincronizarSyscom(desde)   → revisa los productos de Syscom del catálogo contra la API (tabla syscom_precios)
//   ligarSyscom(catId, sysId)  → liga a mano un producto del catálogo con uno de Syscom
//
// Proveedor en el catálogo: "SISTEMAS Y SERVICIOS DE COMUNICACION" (razón social de Syscom).
import { supabase } from './supabase'

export const SYSCOM_SUPPLIER_ID = '41cbd392-d599-44f0-b164-45b5ba1d52ba'
export const SYSCOM_PROVIDER = 'SISTEMAS Y SERVICIOS DE COMUNICACION'

export interface ProductoSyscom {
  id: string
  modelo: string
  marca: string
  titulo: string
  imagen: string | null
  link: string | null
  existencia: number | null
  moneda: string
  precio_descuento: number | null
  precio_especial: number | null
  sin_precio: string | null
}

export interface FilaPrecioSyscom {
  catalog_product_id: string
  syscom_id: string | null
  modelo_syscom: string | null
  marca: string | null
  titulo: string | null
  imagen: string | null
  link: string | null
  precio_usd: number | null
  existencia: number | null
  tc_syscom: number | null
  costo_catalogo: number | null
  moneda_catalogo: string | null
  precio_comparable: number | null
  estado: string
  candidatos: ProductoSyscom[] | null
  decision: string | null
  decision_at: string | null
  decision_por: string | null
  error: string | null
  consultado_at: string | null
}

async function llamar(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('syscom', { body })
  if (error) {
    let msg = error.message
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error } catch (_) { /* sin cuerpo */ }
    throw new Error(msg)
  }
  if (data && data.ok === false) throw new Error(data.error || 'Syscom no contestó')
  return data
}

export async function buscarSyscom(q: string, pagina = 1): Promise<{ total: number; paginas: number; productos: ProductoSyscom[] }> {
  const d = await llamar({ accion: 'buscar', q, pagina, limite: 30 })
  return { total: Number(d.total) || 0, paginas: Number(d.paginas) || 1, productos: d.productos || [] }
}

export interface ResultadoSync { productos: number; revisar: number; revisados: number; pendientes: number; tc: number | null; segundos: number }

export async function sincronizarSyscom(desde?: string, catalogIds?: string[]): Promise<ResultadoSync> {
  return await llamar({ accion: 'sincronizar', desde, catalog_ids: catalogIds })
}

export async function ligarSyscom(catalogProductId: string, syscomId: string): Promise<FilaPrecioSyscom> {
  const d = await llamar({ accion: 'ligar', catalog_product_id: catalogProductId, syscom_id: syscomId })
  return d.fila
}

// Modelo comparable: sin espacios, guiones ni puntos; el "-US" final no cuenta.
// Es la misma regla que usa la Edge Function para ligar.
export function claveModelo(s: string | null | undefined): string {
  return String(s || '').trim().replace(/[\s\-_]US$/i, '').toUpperCase().replace(/[\s\-_./]/g, '')
}

export function textoExistencia(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n <= 0) return 'Sin existencia'
  // Syscom topa lo que enseña: más de 200 sale como 200 y 3000+ como 500.
  if (n >= 500) return '500+ pzas'
  if (n >= 200) return '200+ pzas'
  return n + ' pzas'
}

export function colorExistencia(n: number | null | undefined): string {
  if (n == null) return '#666'
  if (n <= 0) return '#EF4444'
  if (n < 10) return '#F59E0B'
  return '#10B981'
}
