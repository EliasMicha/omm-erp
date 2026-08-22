// ═══════════════════════════════════════════════════════════════════════════
// pagoProveedor — hasta cuándo se le puede pagar a un proveedor.
//
// La fecha de entrega y la fecha de pago no son la misma cosa y confundirlas
// cuesta dinero: una OC puede llegar el martes y tener que pagarse a 30 días,
// o pagarse por adelantado y llegar en seis semanas. Por eso `expected_delivery`
// no alcanza y la OC guarda su propia `fecha_maxima_pago`.
//
// La fecha se captura a mano — el proveedor la pone, no el sistema — pero se
// puede proponer a partir de las condiciones de pago del proveedor para no
// escribirla desde cero cada vez.
// ═══════════════════════════════════════════════════════════════════════════

export type CondicionPago = 'contado' | 'credito_15' | 'credito_30' | 'credito_60' | 'anticipo_50'

/** Días de gracia que da cada condición. Contado y anticipo se pagan el mismo día. */
export const DIAS_CREDITO: Record<CondicionPago, number> = {
  contado: 0,
  credito_15: 15,
  credito_30: 30,
  credito_60: 60,
  anticipo_50: 0,
}

const hoyISO = () => new Date().toISOString().slice(0, 10)

/** Suma días a una fecha ISO sin que el huso horario mueva el día. */
export function sumarDias(fechaISO: string, dias: number): string {
  const d = new Date(fechaISO + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Propone una fecha máxima de pago.
 *
 * La base es deliberadamente la entrega esperada cuando existe: el crédito del
 * proveedor casi siempre corre desde que factura, y factura al entregar. Si no
 * hay entrega esperada se usa la fecha de la OC, que es lo único que hay.
 * Se devuelve también `base` para poder decirle al usuario de dónde salió el
 * número en vez de darle una fecha que aparece sola.
 */
export function sugerirFechaMaximaPago(
  condicion: CondicionPago | null | undefined,
  opts: { entregaEsperada?: string | null; fechaOC?: string | null },
): { fecha: string; dias: number; base: 'entrega' | 'oc'; baseFecha: string } | null {
  if (!condicion || !(condicion in DIAS_CREDITO)) return null
  const entrega = (opts.entregaEsperada || '').slice(0, 10)
  const oc = (opts.fechaOC || '').slice(0, 10) || hoyISO()
  const base: 'entrega' | 'oc' = entrega ? 'entrega' : 'oc'
  const baseFecha = entrega || oc
  const dias = DIAS_CREDITO[condicion]
  return { fecha: sumarDias(baseFecha, dias), dias, base, baseFecha }
}

export type EstadoPago = 'sin_fecha' | 'pagada' | 'vencido' | 'hoy' | 'proximo' | 'ok'

/**
 * En qué situación está el pago de una OC. `proximo` son los siete días
 * siguientes: es la ventana en la que todavía se puede programar una
 * transferencia sin correr.
 */
export function estadoPago(
  fechaMaxima: string | null | undefined,
  opts?: { pagadaAt?: string | null; cancelada?: boolean; hoy?: string },
): { estado: EstadoPago; dias: number | null; color: string; label: string } {
  if (opts?.pagadaAt) return { estado: 'pagada', dias: null, color: '#10B981', label: 'Pagada' }
  const f = (fechaMaxima || '').slice(0, 10)
  if (!f) return { estado: 'sin_fecha', dias: null, color: '#444', label: 'Sin fecha' }
  if (opts?.cancelada) return { estado: 'ok', dias: null, color: '#444', label: '—' }

  const hoy = opts?.hoy || hoyISO()
  const dias = Math.round(
    (new Date(f + 'T12:00:00').getTime() - new Date(hoy + 'T12:00:00').getTime()) / 86400000,
  )
  if (dias < 0) return { estado: 'vencido', dias, color: '#DC2626', label: `Vencido ${Math.abs(dias)}d` }
  if (dias === 0) return { estado: 'hoy', dias, color: '#DC2626', label: 'Vence hoy' }
  if (dias <= 7) return { estado: 'proximo', dias, color: '#D97706', label: `En ${dias}d` }
  return { estado: 'ok', dias, color: '#666', label: `En ${dias}d` }
}
