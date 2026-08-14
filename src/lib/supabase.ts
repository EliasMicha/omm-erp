import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ubbumxommqjcpdozpunf.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViYnVteG9tbXFqY3Bkb3pwdW5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwODA3MzAsImV4cCI6MjA5MDY1NjczMH0.GPKeRgjzjZ96Qo6lYMHKF68YK4y6ZmexvORsNT8VGns'

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// ARCHIVADO (soft-delete) de leads y cotizaciones
//
// "Eliminar" en el ERP archiva: la fila se queda en la base (para que los
// pagos y facturas sigan cuadrando) pero NO debe volver a aparecer en ninguna
// lista operativa. Como hay ~35 lugares que consultan `leads` y `quotations`,
// filtrar uno por uno era garantía de olvidar alguno; en su lugar el filtro
// vive AQUÍ, en un solo punto:
//
//   supabase.from('leads').select(...)     → agrega .is('archived_at', null)
//   supabaseAll.from('leads').select(...)  → trae TODO, archivados incluidos
//
// Usa `supabaseAll` SOLO donde el dinero histórico debe seguir contando
// (Contabilidad, Finanzas) o donde el propósito es ver lo archivado
// (página Archivados). Todo lo demás usa `supabase` y queda filtrado solo.
//
// Nota: el wrapper toca únicamente `.select()` del query builder de tabla.
// insert/update/upsert/delete —y el `.select()` que se encadena a ellos—
// pasan intactos, así que archivar y restaurar funcionan con normalidad.
// ═══════════════════════════════════════════════════════════════════════════
const TABLAS_ARCHIVABLES = new Set(['leads', 'quotations'])

function fromFiltrado(table: string) {
  const qb: any = (client as any).from(table)
  if (!TABLAS_ARCHIVABLES.has(table)) return qb
  const selectOriginal = qb.select.bind(qb)
  qb.select = (...args: any[]) => selectOriginal(...args).is('archived_at', null)
  return qb
}

/** Cliente sin filtro: ve también los archivados. Solo para Contabilidad, Finanzas y la página Archivados. */
export const supabaseAll = client

/** Cliente normal de la app: nunca devuelve leads ni cotizaciones archivadas. */
export const supabase: typeof client = new Proxy(client, {
  get(target: any, prop: string | symbol) {
    if (prop === 'from') return fromFiltrado
    const valor = target[prop]
    return typeof valor === 'function' ? valor.bind(target) : valor
  },
}) as any
