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

export const CORREO_LOGISTICA = 'logistica@omniious.com'
export const CORREO_COPIA = 'elias@omniious.com'

/** Los mismos textos que se ven en la pantalla de Compras (LOGISTICS_CFG). */
const MODO_LOGISTICA: Record<string, string> = {
  pending:            'todavía no se decide cómo llega',
  pickup_to_bodega:   'OMM la recolecta y la lleva a bodega',
  pickup_to_obra:     'OMM la recolecta y la lleva directo a la obra',
  supplier_to_bodega: 'el proveedor la envía a bodega OMM',
  supplier_to_obra:   'el proveedor la envía directo a la obra',
}

const ESPECIALIDAD: Record<string, string> = {
  esp: 'Especiales', elec: 'Eléctrico', ilum: 'Iluminación',
  cort: 'Cortinas', dist: 'Distribución', proy: 'Proyecto',
}

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

const dinero = (n: number, moneda: string) =>
  new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ' + moneda

const fechaLarga = (iso: string) => {
  // Una fecha 'yyyy-mm-dd' con new Date() se interpreta en UTC y en México se
  // ve un día antes. Se parte a mano.
  const [a, m, d] = (iso || '').split('-').map(Number)
  if (!a || !m || !d) return iso
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  return `${d} de ${meses[m - 1]} de ${a}`
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

    const folio = po.folio || po.po_number || 'sin folio'
    const proveedor = prov?.name || 'proveedor sin nombre'
    const obra = lead?.name || 'sin obra asignada'
    const pagadoAhora = p.pagadoAntes + p.monto
    const falta = Math.max(0, p.totalOC - pagadoAhora)
    const saldada = falta < 0.01
    const esServicio = po.tipo === 'servicio'

    const partidas = (items as any[] | null) || []
    const listado = partidas.slice(0, 12)
      .map(i => `  · ${i.name}${i.quantity ? ` — ${i.quantity} ${i.unit || 'pza'}` : ''}`)
      .join('\n')
    const sobran = partidas.length - 12

    const asunto =
      (saldada ? 'OC saldada' : 'Pago registrado') +
      ` · ${folio} · ${proveedor} · ${dinero(p.monto, p.moneda)}`

    const cuerpo = [
      saldada
        ? `La orden ${folio} quedó SALDADA. Ya está pagada completa.`
        : `Se registró un pago de la orden ${folio}.`,
      '',
      `Proveedor:  ${proveedor}`,
      `Obra:       ${obra}${lead?.codigo ? ` (${lead.codigo})` : ''}`,
      `Concepto:   ${po.descripcion || 'sin descripción'}`,
      `Tipo:       ${esServicio ? 'Servicio / destajo' : 'Material'}${po.specialty ? ` · ${ESPECIALIDAD[po.specialty] || po.specialty}` : ''}`,
      '',
      `Pago:       ${dinero(p.monto, p.moneda)} el ${fechaLarga(p.fecha)}`,
      `            ${p.metodo}${p.referencia ? ' · ref. ' + p.referencia : ''}`,
      `Comprobante: ${p.conComprobante ? 'sí, está cargado en el ERP' : 'todavía no se carga'}`,
      '',
      `Total de la orden: ${dinero(p.totalOC, p.moneda)}`,
      `Pagado:            ${dinero(pagadoAhora, p.moneda)}`,
      saldada ? 'Saldo:             0.00 — queda saldada' : `FALTA:             ${dinero(falta, p.moneda)}`,
      '',
      esServicio
        ? 'Es una orden de servicio (mano de obra), no lleva material que recolectar.'
        : `Cómo llega: ${MODO_LOGISTICA[po.logistics_mode || 'pending'] || 'sin definir'}.`,
      !esServicio && po.expected_delivery ? `Entrega esperada: ${fechaLarga(String(po.expected_delivery).slice(0, 10))}` : null,
      !esServicio && partidas.length
        ? `\nQué trae (${partidas.length} ${partidas.length === 1 ? 'partida' : 'partidas'}):\n${listado}${sobran > 0 ? `\n  · … y ${sobran} más` : ''}`
        : null,
      '',
      !esServicio && !saldada
        ? 'Ojo: la orden todavía trae saldo. Antes de ir por el material, confirma con el proveedor si suelta contra este pago.'
        : null,
      '',
      'La orden completa está en el ERP: https://omm-erp.vercel.app/compras',
      '',
      '— Aviso automático del ERP de OMM. No hace falta contestarlo.',
    // OJO: se filtra por null, NO por cadena vacía. Las cadenas vacías de esta
    // lista son los renglones en blanco que separan los bloques del correo;
    // filtrarlas deja un muro de texto ilegible (ya pasó al probarlo).
    ].filter(l => l !== null).join('\n')
      // Un renglón condicional que no aplica deja sus dos blancos pegados. En
      // vez de encadenar condiciones por cada blanco, se colapsan al final.
      .replace(/\n{3,}/g, '\n\n')

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
