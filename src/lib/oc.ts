// ═══════════════════════════════════════════════════════════════════════════
// Folio de orden de compra — UNA sola implementación.
//
// El folio se calculaba con COUNT(*) de las OC del mes en CUATRO lugares
// distintos (importar de PDF, OC manual, OC desde cotización y "Regenerar OC"
// del cotizador). En cuanto se borra una OC el conteo queda POR DEBAJO del
// último folio usado y el insert choca contra el UNIQUE de po_number:
//   duplicate key value violates unique constraint "purchase_orders_po_number_key"
// Caso real 2026-08: 16 OCs en el mes pero el máximo era OC-2608-017.
//
// Aquí se deriva del MÁXIMO existente y, si aun así choca (dos personas
// guardando al mismo tiempo), reintenta con el siguiente folio libre.
// Cualquier lugar nuevo que cree OCs debe usar esta función, no armar el folio.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'

/**
 * Prefijo del folio. Las órdenes de SERVICIO llevan su propia serie (OS-) para
 * que no se confundan con las de material en la lista, en el PDF ni cuando el
 * proveedor pregunta por "la orden 041": son documentos distintos, con formato
 * distinto y sin IVA.
 */
export function prefijoOC(fecha = new Date(), tipo: 'material' | 'servicio' = 'material'): string {
  const serie = tipo === 'servicio' ? 'OS' : 'OC'
  return `${serie}-${String(fecha.getFullYear()).slice(2)}${String(fecha.getMonth() + 1).padStart(2, '0')}`
}

export async function insertarOC(payload: Record<string, any>, intentos = 15): Promise<any> {
  const prefix = prefijoOC(new Date(), payload.tipo === 'servicio' ? 'servicio' : 'material')
  const { data } = await supabase.from('purchase_orders').select('po_number')
    .like('po_number', `${prefix}%`).order('po_number', { ascending: false }).limit(1)
  const ultimo = (data && (data as any[])[0]?.po_number) || ''
  let n = (parseInt(String(ultimo).split('-')[2] || '0', 10) || 0) + 1
  let ultimoRes: any = null
  for (let i = 0; i < intentos; i++, n++) {
    const res = await supabase.from('purchase_orders')
      .insert({ ...payload, po_number: `${prefix}-${String(n).padStart(3, '0')}` })
      .select().single()
    if (!res.error) return res
    ultimoRes = res
    if ((res.error as any).code !== '23505') return res   // otro error: no insistir
  }
  return ultimoRes
}
