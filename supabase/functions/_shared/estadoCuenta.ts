// ═══════════════════════════════════════════════════════════════════════════
//  Los DATOS del estado de cuenta — la consulta, separada del dibujo.
//
//  Estaba metida dentro de `adjuntoEstadoCuenta` en src/lib/cobranzaDocs.ts, o
//  sea disponible solo para quien corriera en el navegador. Se sacó aquí para
//  que el Edge Function `mcp-contabilidad` arme EL MISMO documento sin
//  reescribir la consulta: si el bot y el ERP juntaran los pagos por caminos
//  distintos, dos estados de cuenta del mismo cliente podrían no cuadrar y no
//  habría forma de saber cuál está bien.
//
//  El cliente de Supabase se INYECTA, no se importa. Así el mismo archivo
//  sirve al navegador (cliente con la sesión del usuario) y al servidor
//  (cliente de servicio, acotado a las tablas de Contabilidad por acotar.ts).
//  Importarlo aquí ataría este archivo a uno de los dos mundos.
// ═══════════════════════════════════════════════════════════════════════════
import type { EstadoCuentaInput } from './estadoCuentaPdf.ts'

/**
 * PostgREST necesita una lista con algo adentro. Con `in.()` vacío contesta un
 * error de sintaxis, así que va un uuid que no existe: la consulta corre y
 * devuelve cero filas, que es justo lo que significa "este lead no tiene
 * contratos".
 */
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

const BM = 'id, quotation_id, tipo, monto, moneda, fecha, concepto, lead_id'
const CM = 'quotation_id, tipo, monto, moneda, fecha, concepto, persona, lead_id, tc_aplicado, monto_cotizacion, moneda_cotizacion'

/**
 * Junta todo lo que el estado de cuenta necesita de un lead.
 *
 * Solo entran contratos VIGENTES: una cotización que no es contrato no es
 * cobranza, y de las versiones hermanas solo cuenta la vigente — si contaran
 * todas, el vendido del cliente saldría multiplicado por el número de opciones
 * que le mandamos.
 *
 * Los pagos se buscan por DOS caminos —por lead y por cotización— porque
 * ninguno de los dos está completo: hay movimientos que se clasificaron al
 * cliente y otros directo al contrato. Por eso al final se deduplica.
 */
export async function datosEstadoCuenta(
  sb: any,
  leadId: string,
  lead: { name?: string; company?: string },
): Promise<EstadoCuentaInput> {
  const { data: quotsAll } = await sb
    .from('quotations')
    .select('id,name,stage,notes,total,total_final,specialty,commercial_year')
    .eq('stage', 'contrato')
    .eq('vigente', true)

  // El lead vive dentro del JSON de `notes`, así que el filtro no se puede
  // hacer en la consulta.
  const leadOf = (q: any): string | null => {
    try { return JSON.parse(q.notes || '{}').lead_id || null } catch { return null }
  }
  const quotations = ((quotsAll || []) as any[]).filter(q => leadOf(q) === leadId)
  const qids = quotations.map(q => q.id)
  const inList = '(' + (qids.length ? qids.join(',') : NIL_UUID) + ')'

  const [bmA, bmB, cmA, cmB, paR] = await Promise.all([
    sb.from('bank_movements').select(BM).eq('lead_id', leadId).then((r: any) => r.data || []),
    sb.from('bank_movements').select(BM).filter('quotation_id', 'in', inList).then((r: any) => r.data || []),
    sb.from('cash_movements').select(CM).eq('lead_id', leadId).then((r: any) => r.data || []),
    sb.from('cash_movements').select(CM).filter('quotation_id', 'in', inList).then((r: any) => r.data || []),
    sb.from('payment_allocations')
      .select('quotation_id, monto, bank_movement_id, tc_aplicado, monto_origen, moneda_origen')
      .filter('quotation_id', 'in', inList).then((r: any) => r.data || []),
  ])

  const dedupe = (rows: any[], key: (r: any) => string) => {
    const m = new Map<string, any>()
    rows.forEach(r => m.set(key(r), r))
    return Array.from(m.values())
  }

  return {
    lead,
    quotations,
    bankMovements: dedupe([...(bmA as any[]), ...(bmB as any[])], r => String(r.id)),
    // El efectivo no trae id en el select, así que la llave se arma con lo que
    // identifica el movimiento. Cambiar este select sin cambiar la llave
    // reintroduce duplicados en silencio.
    cashMovements: dedupe([...(cmA as any[]), ...(cmB as any[])],
      r => [r.quotation_id, r.lead_id, r.fecha, r.monto, r.concepto].join('|')),
    paymentAllocations: paR as any[],
  }
}

/** El nombre del archivo, igual desde el ERP y desde el bot. */
export const nombreArchivoEstadoCuenta = (leadName: string) =>
  `Estado_de_Cuenta_${(leadName || 'Obra').replace(/\s+/g, '_')}.pdf`
