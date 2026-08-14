// ═══════════════════════════════════════════════════════════════════════════
// Archivar / restaurar leads y cotizaciones
//
// Regla de negocio (decidida con Elias, 2026-08): "si borro es porque ya no
// quiero que aparezca en ningún lado". Pero borrar de verdad un contrato con
// pagos aplicados o facturas emitidas descuadra la contabilidad contra el
// banco y el SAT. Entonces "Eliminar" archiva:
//   · desaparece de TODAS las listas operativas (filtro en lib/supabase.ts)
//   · el dinero ya cobrado y las facturas siguen contando en Contabilidad/Finanzas
//   · es reversible desde la página /archivados
//
// Ojo con la liga cotización→lead: NO es una llave foránea, vive como JSON
// dentro de `quotations.notes` ({"lead_id": "..."}). Por eso al archivar un
// lead hay que archivar sus cotizaciones a mano, o quedarían en la lista de
// Cotizaciones sin cliente que las explique.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAll } from './supabase'

export interface Dependencias {
  cotizaciones: number
  proyectos: number
  facturas: number
  pagos: number
  ordenesCompra: number
}

export function leadIdDeNotes(notes: any): string | null {
  try {
    const meta = JSON.parse(notes || '{}')
    return meta && meta.lead_id ? String(meta.lead_id) : null
  } catch { return null }
}

/** Cotizaciones ligadas a un lead (la liga es JSON en notes, no FK). */
async function cotizacionesDeLead(leadId: string, incluirArchivadas = false): Promise<any[]> {
  let q = supabaseAll.from('quotations').select('id, name, stage, notes, archived_at, archived_reason').ilike('notes', `%${leadId}%`)
  if (!incluirArchivadas) q = q.is('archived_at', null)
  const { data } = await q
  // ilike es solo un pre-filtro barato: confirmamos leyendo el JSON de verdad
  return (data || []).filter((c: any) => leadIdDeNotes(c.notes) === leadId)
}

async function contar(tabla: string, columna: string, valor: string): Promise<number> {
  const { count } = await supabaseAll.from(tabla).select('*', { count: 'exact', head: true }).eq(columna, valor)
  return count || 0
}

export async function dependenciasDeLead(leadId: string): Promise<Dependencias> {
  const [cots, proyectos, facturas] = await Promise.all([
    cotizacionesDeLead(leadId),
    contar('projects', 'lead_id', leadId),
    contar('facturas', 'lead_id', leadId),
  ])
  return { cotizaciones: cots.length, proyectos, facturas, pagos: 0, ordenesCompra: 0 }
}

export async function dependenciasDeCotizacion(quotationId: string): Promise<Dependencias> {
  const [proyectos, facturas, pagos, ordenesCompra] = await Promise.all([
    contar('projects', 'cotizacion_id', quotationId),
    contar('facturas', 'quotation_id', quotationId),
    contar('payment_allocations', 'quotation_id', quotationId),
    contar('purchase_orders', 'quotation_id', quotationId),
  ])
  return { cotizaciones: 0, proyectos, facturas, pagos, ordenesCompra }
}

export function resumenDependencias(d: Dependencias): string {
  const partes: string[] = []
  if (d.cotizaciones) partes.push(`${d.cotizaciones} cotización${d.cotizaciones === 1 ? '' : 'es'}`)
  if (d.proyectos) partes.push(`${d.proyectos} proyecto${d.proyectos === 1 ? '' : 's'}`)
  if (d.pagos) partes.push(`${d.pagos} pago${d.pagos === 1 ? '' : 's'} aplicado${d.pagos === 1 ? '' : 's'}`)
  if (d.facturas) partes.push(`${d.facturas} factura${d.facturas === 1 ? '' : 's'}`)
  if (d.ordenesCompra) partes.push(`${d.ordenesCompra} orden${d.ordenesCompra === 1 ? '' : 'es'} de compra`)
  return partes.join(', ')
}

const ahora = () => new Date().toISOString()

export async function archivarLead(leadId: string, userId?: string | null): Promise<{ ok: boolean; error?: string; cotizaciones: number }> {
  const cots = await cotizacionesDeLead(leadId)
  if (cots.length) {
    const { error } = await supabaseAll.from('quotations')
      .update({ archived_at: ahora(), archived_by: userId || null, archived_reason: 'lead' })
      .in('id', cots.map(c => c.id))
    if (error) return { ok: false, error: `No se pudieron archivar sus cotizaciones: ${error.message}`, cotizaciones: 0 }
  }
  const { error } = await supabaseAll.from('leads')
    .update({ archived_at: ahora(), archived_by: userId || null, archived_reason: 'manual' })
    .eq('id', leadId)
  if (error) return { ok: false, error: error.message, cotizaciones: cots.length }
  return { ok: true, cotizaciones: cots.length }
}

export async function restaurarLead(leadId: string): Promise<{ ok: boolean; error?: string }> {
  const cots = await cotizacionesDeLead(leadId, true)
  // solo las que se archivaron EN CASCADA con el lead; las archivadas a mano siguen archivadas
  const enCascada = cots.filter(c => c.archived_at && c.archived_reason === 'lead').map(c => c.id)
  if (enCascada.length) {
    await supabaseAll.from('quotations').update({ archived_at: null, archived_by: null, archived_reason: null }).in('id', enCascada)
  }
  const { error } = await supabaseAll.from('leads').update({ archived_at: null, archived_by: null, archived_reason: null }).eq('id', leadId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function archivarCotizacion(quotationId: string, userId?: string | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAll.from('quotations')
    .update({ archived_at: ahora(), archived_by: userId || null, archived_reason: 'manual' })
    .eq('id', quotationId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function restaurarCotizacion(quotationId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAll.from('quotations').update({ archived_at: null, archived_by: null, archived_reason: null }).eq('id', quotationId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Borrado físico (solo desde /archivados, para limpieza real) ──
// Las tablas hijas con ON DELETE CASCADE (quotation_items, quotation_areas,
// quotation_versions, change_orders, payment_allocations, quote_requests) se
// van solas: NO hay que borrarlas antes. Lo que sí bloquea son las NO ACTION
// (projects, purchase_orders, payment_milestones, facturas) — y ahí el error
// se traduce a español en vez de fingir que se borró.
function traducirErrorFK(msg: string): string {
  const m = /on table "([a-z_]+)"/.exec(msg || '')
  const tabla = m ? m[1] : ''
  const nombres: Record<string, string> = {
    projects: 'tiene un proyecto ligado',
    purchase_orders: 'tiene órdenes de compra',
    payment_milestones: 'tiene un plan de pagos',
    facturas: 'tiene facturas emitidas',
    maintenance_properties: 'está ligada a una propiedad de mantenimiento',
    maintenance_upsell: 'está ligada a mantenimiento',
    obras: 'tiene una obra ligada',
  }
  const razon = nombres[tabla] || (tabla ? `tiene registros en ${tabla}` : 'tiene información ligada')
  return `No se puede borrar definitivamente porque ${razon}. Se queda archivada (que para efectos prácticos es lo mismo: no aparece en ninguna lista).`
}

export async function borrarCotizacionDefinitivo(quotationId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAll.from('quotations').delete().eq('id', quotationId)
  if (!error) return { ok: true }
  if (error.code === '23503') return { ok: false, error: traducirErrorFK(error.message) }
  return { ok: false, error: error.message }
}

export async function borrarLeadDefinitivo(leadId: string): Promise<{ ok: boolean; error?: string }> {
  // PRIMERO averiguar si el borrado es posible. Si hay un proyecto o facturas,
  // Postgres va a rechazar el DELETE final; limpiar antes las tablas hijas
  // destruiría datos para nada (justo el bug que tenía Cotizaciones.tsx).
  const [proyectos, facturas] = await Promise.all([
    contar('projects', 'lead_id', leadId),
    contar('facturas', 'lead_id', leadId),
  ])
  if (proyectos || facturas) {
    const razon = proyectos ? 'tiene un proyecto ligado' : 'tiene facturas emitidas'
    return { ok: false, error: `No se puede borrar definitivamente porque ${razon}. Se queda archivado (que para efectos prácticos es lo mismo: no aparece en ninguna lista).` }
  }
  // Ya sabemos que se puede: limpiar las tablas que apuntan al lead SIN llave
  // foránea (Postgres no las limpia solo y quedarían huérfanas para siempre).
  await Promise.all([
    supabaseAll.from('interacciones').delete().eq('entity_type', 'lead').eq('entity_id', leadId),
    supabaseAll.from('cobranza_obra').delete().eq('lead_id', leadId),
    supabaseAll.from('cobranza_seguimiento').update({ lead_id: null }).eq('lead_id', leadId),
    supabaseAll.from('prospectos').update({ lead_id: null, estado: 'por_contactar', converted_at: null }).eq('lead_id', leadId),
  ])
  const { error } = await supabaseAll.from('leads').delete().eq('id', leadId)
  if (!error) return { ok: true }
  if (error.code === '23503') return { ok: false, error: traducirErrorFK(error.message).replace('la cotización', 'el lead').replace('borrar definitivamente', 'borrar definitivamente el lead') }
  return { ok: false, error: error.message }
}
