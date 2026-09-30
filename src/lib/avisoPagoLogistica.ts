// ═══════════════════════════════════════════════════════════════════════════
//  Aviso a Logística cuando se registra un pago de una orden de compra.
//
//  Elias: "Cuando se suba un pago aquí en compras, podemos hacer que
//  automáticamente notifique a Logística... por correo, Logistica@omniious.com"
//
//  ── Por qué en CADA pago y no solo al saldar ────────────────────────────
//
//  Decisión de Elias. Varios proveedores sueltan material contra el anticipo,
//  así que esperar a la liquidación le avisa a Gabriel días después de que ya
//  se podía recoger. Por eso cada pago manda correo y el correo dice cuánto
//  falta: el dato que decide si ya se puede ir por el material o todavía no.
//
//  ── Por qué el correo sale a nombre de Elias ────────────────────────────
//
//  La cuenta conectada al ERP es elias@omniious.com y es la única que puede
//  mandar. Gabriel lo va a ver como correo de Elias, que además va en copia
//  por decisión suya.
//
//  ── Este aviso NO puede tumbar el registro del pago ─────────────────────
//
//  Un pago que no se guarda porque Gmail estaba caído es un daño real; un
//  correo que no sale es un aviso que se da por WhatsApp. Por eso la función
//  NUNCA lanza: devuelve { ok:false, error } y quien llama decide qué enseñar.
//
//  Pero tampoco falla en silencio. Si el correo no sale, la pantalla tiene que
//  decirlo: dar por avisado a Logística cuando nadie le avisó es peor que no
//  tener el aviso, porque el material se queda en el proveedor y todos creen
//  que ya se agendó.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'
// El TEXTO del correo vive en api/_avisoPago.ts, no aquí: lo comparte con el
// atajo del celular (api/extract.ts?action=comprobante_pago). Tiene que estar
// de ese lado porque una función de Vercel no puede importar de src/, y al
// revés sí. Un solo generador = un solo correo.
import { construirAvisoPago, CORREO_LOGISTICA, CORREO_COPIA } from '../../api/_avisoPago'

export { CORREO_LOGISTICA, CORREO_COPIA }

export interface PagoRegistrado {
  poId: string
  monto: number
  moneda: 'MXN' | 'USD'
  fecha: string
  metodo: string
  referencia?: string | null
  conComprobante: boolean
  /** Total de la orden, como lo muestra Compras. */
  totalOC: number
  /** Suma de los pagos ANTERIORES a éste. */
  pagadoAntes: number
}

export interface ResultadoAviso {
  ok: boolean
  error?: string
  /** El correo que se armó, para poder enseñarlo o reenviarlo a mano. */
  asunto?: string
  cuerpo?: string
}

/**
 * Arma y manda el aviso. No lanza nunca.
 *
 * Las consultas van por separado y NO con embeds de PostgREST: `purchase_orders`
 * tiene varias rutas hacia `leads` y un embed ambiguo devuelve 300 (PGRST201),
 * que es el error que ya dejó pantallas vacías en este ERP. Tres consultas
 * chicas son más baratas que ese bug.
 */
export async function avisarPagoALogistica(p: PagoRegistrado): Promise<ResultadoAviso> {
  try {
    const { data: po, error: errPo } = await supabase
      .from('purchase_orders')
      .select('id, po_number, folio, descripcion, specialty, tipo, currency, logistics_mode, logistics_target_obra_id, expected_delivery, supplier_id, lead_id')
      .eq('id', p.poId).maybeSingle()
    if (errPo || !po) return { ok: false, error: 'No se pudo leer la orden: ' + (errPo?.message || 'no existe') }

    const [{ data: prov }, { data: lead }, { data: items }] = await Promise.all([
      po.supplier_id
        ? supabase.from('suppliers').select('name').eq('id', po.supplier_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      po.lead_id
        ? supabase.from('leads').select('name, codigo').eq('id', po.lead_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      supabase.from('po_items').select('name, quantity, unit').eq('purchase_order_id', p.poId).limit(60),
    ])

    const { asunto, cuerpo } = construirAvisoPago({
      folio: po.folio || po.po_number || 'sin folio',
      proveedor: prov?.name || 'proveedor sin nombre',
      obra: lead?.name || 'sin obra asignada',
      claveLead: lead?.codigo || null,
      concepto: po.descripcion,
      esServicio: po.tipo === 'servicio',
      especialidad: po.specialty,
      monto: p.monto,
      moneda: p.moneda,
      fecha: p.fecha,
      metodo: p.metodo,
      referencia: p.referencia,
      conComprobante: p.conComprobante,
      totalOC: p.totalOC,
      pagadoAntes: p.pagadoAntes,
      modoLogistica: po.logistics_mode,
      entregaEsperada: po.expected_delivery ? String(po.expected_delivery) : null,
      partidas: ((items as any[] | null) || []),
      origen: 'erp',
    })

    const r = await fetch('/api/gmail?action=send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: CORREO_LOGISTICA, cc: CORREO_COPIA, subject: asunto, body: cuerpo }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j?.ok) {
      return { ok: false, error: j?.error || `El servidor de correo respondió ${r.status}`, asunto, cuerpo }
    }
    return { ok: true, asunto, cuerpo }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
