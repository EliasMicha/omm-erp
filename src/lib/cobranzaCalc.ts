// ═══════════════════════════════════════════════════════════════════════════
// cobranzaCalc — cálculo ligero de "obras por cobrar" por lead.
// Réplica mínima de la lógica del módulo Cobranza (Cobranza.tsx) para poder
// mostrar las obras con saldo como pendientes en el Dashboard sin duplicar toda
// la vista. Devuelve solo lo necesario: leadId, nombre, saldo (MXN), avance.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'
import { DEFAULT_TC } from './fx'

export interface ObraPorCobrar {
  leadId: string
  lead: string
  porCobrar: number   // saldo en MXN (USD convertido con TC)
  avance: number      // 0..1
  vTot: number
  cTot: number
}

async function fetchAllBM(): Promise<any[]> {
  const out: any[] = []
  let from = 0
  const page = 1000
  for (;;) {
    const { data } = await supabase
      .from('bank_movements')
      .select('id, quotation_id, tipo, monto, moneda')
      .range(from, from + page - 1)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < page) break
    from += page
  }
  return out
}

export async function loadObrasPorCobrar(tc: number = DEFAULT_TC): Promise<ObraPorCobrar[]> {
  const [leadsR, quotsR, paR, cmR] = await Promise.all([
    supabase.from('leads').select('id,name').then(r => r.data || []),
    supabase.from('quotations').select('id,notes,total,total_final,specialty').eq('stage', 'contrato').then(r => r.data || []),
    supabase.from('payment_allocations').select('quotation_id, monto, bank_movement_id').then(r => r.data || []),
    supabase.from('cash_movements').select('quotation_id, tipo, monto, moneda').then(r => r.data || []),
  ])
  const bm = await fetchAllBM()

  const leadById = new Map<string, any>()
  ;(leadsR as any[]).forEach(l => leadById.set(l.id, l))
  const allocMovIds = new Set((paR as any[]).map(x => x.bank_movement_id).filter(Boolean))

  const curOf = (q: any): 'USD' | 'MXN' => { try { return JSON.parse(q.notes || '{}').currency === 'MXN' ? 'MXN' : 'USD' } catch { return 'USD' } }
  const leadOf = (q: any): string | null => { try { return JSON.parse(q.notes || '{}').lead_id || null } catch { return null } }
  const vendidoDe = (q: any): number => {
    if (q.total_final != null && q.total_final !== '' && !isNaN(Number(q.total_final))) return Number(q.total_final)
    if (['esp', 'cort', 'ilum', 'proy', 'dist', 'elec'].includes(q.specialty)) return Number(q.total) || 0
    return (Number(q.total) || 0) * 1.16
  }
  const cobradoDe = (qId: string, cur: 'USD' | 'MXN'): number => {
    let s = 0
    ;(paR as any[]).forEach(x => { if (x.quotation_id === qId) s += Number(x.monto) || 0 })
    bm.forEach(m => { if (m.tipo === 'abono' && m.quotation_id === qId && !allocMovIds.has(m.id) && (m.moneda || 'MXN') === cur) s += Number(m.monto) || 0 })
    ;(cmR as any[]).forEach(m => { if (m.tipo === 'cobro_cliente' && m.quotation_id === qId && !allocMovIds.has(m.id) && (m.moneda || 'MXN') === cur) s += Number(m.monto) || 0 })
    return s
  }

  const byLead = new Map<string, ObraPorCobrar>()
  ;(quotsR as any[]).forEach(q => {
    const lid = leadOf(q); if (!lid) return
    const lead = leadById.get(lid); if (!lead) return
    const cur = curOf(q)
    const vE = cur === 'USD' ? vendidoDe(q) * tc : vendidoDe(q)
    const cE = cur === 'USD' ? cobradoDe(q.id, cur) * tc : cobradoDe(q.id, cur)
    if (!byLead.has(lid)) byLead.set(lid, { leadId: lid, lead: lead.name || '—', porCobrar: 0, avance: 0, vTot: 0, cTot: 0 })
    const L = byLead.get(lid)!
    L.vTot += vE
    L.cTot += cE
  })

  const arr = Array.from(byLead.values())
  arr.forEach(L => {
    L.porCobrar = Math.max(0, L.vTot - L.cTot)
    L.avance = L.vTot > 0 ? L.cTot / L.vTot : 0
  })
  // Excluir finiquitadas (mismo criterio que el módulo)
  const activas = arr.filter(L => !(L.vTot > 0 && (L.avance >= 0.999 || L.porCobrar < Math.max(1, L.vTot * 0.002))))
  activas.sort((a, b) => b.porCobrar - a.porCobrar)
  return activas
}
