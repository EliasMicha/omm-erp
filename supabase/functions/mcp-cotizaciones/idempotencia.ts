// ═══════════════════════════════════════════════════════════════════════════
//  idempotencia.ts — que un reintento no escriba dos veces. Se copia igual
//  en cada MCP.
//
//  El caso que esto ataja no es el doble clic: es el reintento del cliente.
//  El bot llama crm_create_lead, el servidor escribe el lead, la respuesta
//  tarda, el cliente se da por vencido por timeout y vuelve a llamar con los
//  MISMOS argumentos. Sin guarda quedan dos leads gemelos y nadie se entera
//  hasta que alguien cotiza el equivocado.
//
//  Consultar-y-luego-escribir no sirve — entre la consulta y la escritura cabe
//  el otro intento. Es exactamente el bug que duplicaba salidas de inventario
//  en este ERP, pero entre procesos. La guarda tiene que ser atomica y vivir
//  en la base:
//
//    insert ... on conflict do nothing returning *
//
//  Solo UNA llamada se lleva la fila; esa ejecuta. Las demas leen lo que
//  quedo guardado y lo devuelven tal cual, marcado como repetido.
//
//  El lease existe porque un proceso puede morirse despues de reclamar y
//  antes de terminar. Sin el, esa clave quedaria trabada para siempre.
// ═══════════════════════════════════════════════════════════════════════════

export interface ResultadoIdem<T> {
  /** true = esta llamada NO ejecuto; devuelve lo que dejo la primera. */
  repetido: boolean
  /** true = la primera sigue corriendo; no hay resultado todavia. */
  enVuelo?: boolean
  valor?: T
}

const LEASE_MIN = 2

/**
 * Corre `ejecutar` a lo mas una vez por clave.
 *
 * Sin clave no hay nada que deduplicar y se ejecuta directo: la idempotencia
 * es opcional a proposito, porque una consulta no la necesita y obligarla
 * volveria mas dificil llamar a las tools de lectura.
 */
export async function unaSolaVez<T>(
  supabase: any,
  clave: string | null | undefined,
  meta: { tool_name: string; actor_email?: string; origen?: string },
  ejecutar: () => Promise<{ ok: boolean; valor: T; error?: string }>,
): Promise<ResultadoIdem<T> & { ok: boolean; valor?: T; error?: string }> {
  const k = (clave || '').trim()
  if (!k) {
    const r = await ejecutar()
    return { repetido: false, ok: r.ok, valor: r.valor, error: r.error }
  }

  const ahora = new Date()
  const lease = new Date(ahora.getTime() + LEASE_MIN * 60_000).toISOString()

  // Reclamo atomico. Si otro ya tiene la clave, esto no devuelve fila.
  const { data: reclamada } = await supabase
    .from('agent_idempotencia')
    .insert({ clave: k, tool_name: meta.tool_name, actor_email: meta.actor_email ?? null, origen: meta.origen ?? null, leased_until: lease })
    .select('clave')
    .maybeSingle()

  if (!reclamada) {
    const { data: previa } = await supabase
      .from('agent_idempotencia')
      .select('estado, resultado, error_message, leased_until')
      .eq('clave', k).maybeSingle()

    if (previa?.estado === 'hecho') {
      return { repetido: true, ok: true, valor: previa.resultado as T }
    }
    if (previa?.estado === 'error') {
      return { repetido: true, ok: false, error: previa.error_message || 'La primera llamada con esta clave fallo.' }
    }
    // Sigue en proceso. Si el lease ya vencio, el dueño murio: se retoma.
    const vencido = previa?.leased_until ? new Date(previa.leased_until) < ahora : true
    if (!vencido) {
      return {
        repetido: true, enVuelo: true, ok: false,
        error: 'Esta misma operacion ya va en camino con la clave ' + k + '. No la repitas: espera y consulta el resultado.',
      }
    }
    await supabase.from('agent_idempotencia')
      .update({ leased_until: lease, updated_at: ahora.toISOString() }).eq('clave', k)
  }

  try {
    const r = await ejecutar()
    await supabase.from('agent_idempotencia').update({
      estado: r.ok ? 'hecho' : 'error',
      resultado: r.ok ? (r.valor as unknown as Record<string, unknown>) : null,
      error_message: r.ok ? null : (r.error ?? 'error sin mensaje'),
      updated_at: new Date().toISOString(),
    }).eq('clave', k)
    return { repetido: false, ok: r.ok, valor: r.valor, error: r.error }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Se marca error y NO se deja en_proceso: una clave trabada bloquea el
    // reintento legitimo, que es justo lo que el bot va a hacer despues.
    await supabase.from('agent_idempotencia')
      .update({ estado: 'error', error_message: msg, updated_at: new Date().toISOString() }).eq('clave', k)
    throw e
  }
}
