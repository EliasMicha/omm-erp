// ═══════════════════════════════════════════════════════════════════════════
//  El generador del estado de cuenta YA NO VIVE AQUÍ.
//
//  Se mudó a `supabase/functions/_shared/` porque ahora lo usan dos mundos: el
//  botón del ERP (este archivo) y el Edge Function `mcp-contabilidad`, desde el
//  que un bot autorizado puede pedir el PDF sin pasar por el navegador.
//
//  ⚠️ Tiene que ser UN SOLO archivo, no una copia por lado. Dos copias del
//  mismo documento se separan solas en cuestión de semanas, y el día que se
//  separan nadie lo nota: lo nota el cliente, comparando dos estados de cuenta
//  de OMM que no dicen lo mismo. Ya pasó con el prompt de reclutamiento
//  duplicado entre `api/gmail.ts` y `src/lib/analisisPrompt.ts`.
//
//  Este archivo queda como puente para que los 3 lugares que ya lo importaban
//  (Cobranza, LeadDashboard, cobranzaDocs) no se enteren del cambio.
//
//  El import va SIN la extensión .ts a propósito: así lo resuelve Vite. Deno lo
//  importa con extensión desde el Edge Function. El mismo archivo, leído por
//  los dos. Lo único que tenían que ponerse de acuerdo era de dónde sale jsPDF,
//  y eso lo resuelve `supabase/functions/mcp-contabilidad/deno.json`.
// ═══════════════════════════════════════════════════════════════════════════
export { generarEstadoCuentaPdf } from '../../supabase/functions/_shared/estadoCuentaPdf'
export type { EstadoCuentaInput } from '../../supabase/functions/_shared/estadoCuentaPdf'
