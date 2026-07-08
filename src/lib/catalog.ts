import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Carga TODO el catálogo activo paginando.
// Supabase/PostgREST corta cada query en 1000 filas por defecto; si el catálogo
// crece por encima de eso, la búsqueda del cotizador (que filtra sobre el set
// cargado en memoria) deja de encontrar productos. Este helper trae TODAS las
// filas en páginas de 1000, así el rango de búsqueda nunca se queda corto por
// más que crezca el catálogo — no hay que volver a subir el límite a mano.
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchAllActiveCatalog(opts?: { specialty?: string }): Promise<any[]> {
  const PAGE = 1000
  let from = 0
  let all: any[] = []
  // Tope de seguridad muy alto (50k) para evitar un loop infinito ante un error inesperado.
  for (let guard = 0; guard < 50; guard++) {
    let q = supabase.from('catalog_products').select('*').eq('is_active', true)
    if (opts?.specialty) q = q.eq('specialty', opts.specialty)
    const { data, error } = await q.order('name').range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}
