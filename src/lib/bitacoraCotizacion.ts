// ═══════════════════════════════════════════════════════════════════════════
//  bitacoraCotizacion — de los movimientos crudos a un resumen que se lee.
//
//  Elias: "No quiero paso por paso porque sería mucho, sino algo procesado:
//  se agrega x, se quita y, se agrega tal sistema, se agrega tal área, se
//  apaga tal sistema. Como un resumensito."
//
//  La captura la hacen los triggers de la base (migración
//  `bitacora_de_cotizaciones`), que escriben un renglón por movimiento en
//  activity_log. Un rato de trabajo en el cotizador deja decenas: mandar eso
//  tal cual sería peor que no mandar nada — el director dejaría de leerlo a la
//  segunda vez.
//
//  Aquí se consolida. Tres cosas que hace y que un log crudo no hace:
//
//  1. NETEA. Un producto que se agregó y se borró en la misma ventana no
//     aparece: nunca pasó nada. Una cantidad que fue de 3 a 7 y volvió a 3
//     tampoco. Esto es lo que más recorta, y es justo el ruido que hace que
//     un aviso se ignore.
//  2. AGRUPA por área. "SALA: +4 productos" en vez de cuatro renglones.
//  3. ORDENA por lo que mueve el trato: primero alcance y dinero, al final
//     los productos. Un director quiere saber si cambió el descuento antes
//     que qué bocina entró.
// ═══════════════════════════════════════════════════════════════════════════

export interface EventoBitacora {
  id: string
  created_at: string
  action: string
  actor_id: string | null
  old_value: string | null
  new_value: string | null
  metadata: Record<string, any> | null
}

export interface SeccionResumen {
  titulo: string
  lineas: string[]
}

export interface ResumenCotizacion {
  /** null = nunca se ha mandado un aviso; la ventana es toda la vida de la cotización. */
  desde: string | null
  hasta: string
  /** Movimientos crudos que se leyeron (antes de netear). */
  eventosCrudos: number
  secciones: SeccionResumen[]
  /** true = después de netear no quedó nada que contar. No se manda. */
  vacio: boolean
}

/** id interno de sistema → como se le dice en la junta. */
const NOMBRE_SISTEMA: Record<string, string> = {
  audio: 'Audio', redes: 'Redes', cctv: 'CCTV',
  control_acceso: 'Control de Acceso', control_iluminacion: 'Control de Iluminación',
  deteccion_humo: 'Detección de Incendio', bms: 'BMS', telefonia: 'Telefonía',
  red_celular: 'Señal Celular', lutron_hwqs: 'Lutron HW QS', lutron: 'Lutron',
  somfy: 'Somfy', electrico: 'Eléctrico', cortinas: 'Cortinas', general: 'General',
}
const sis = (id: string | null) => (id ? (NOMBRE_SISTEMA[id] || id) : '—')

const ETIQUETA_AJUSTE: Record<string, string> = {
  ajuste_descuento: 'Descuento',
  ajuste_tipoCambio: 'Tipo de cambio',
  ajuste_currency: 'Moneda',
  ajuste_ivaRate: 'IVA',
  ajuste_programacion: 'Programación',
  ajuste_nominaPct: 'Nómina',
}

const ETAPA: Record<string, string> = {
  oportunidad: 'Oportunidad', estimacion: 'Estimación', propuesta: 'Por cerrar',
  contrato: 'Contrato', perdida: 'Perdida',
}

const num = (v: string | null) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
/** 3.00 → "3", 3.50 → "3.5". Las cantidades vienen como numeric de Postgres. */
const cant = (v: string | null) => {
  const n = num(v)
  return n === null ? (v ?? '—') : String(n)
}
// Sin `style: 'currency'` a propósito: Intl escribe "USD 120,000.00" en es-MX,
// y el símbolo de la cotización lo pone quien llama, que es el que sabe si son
// pesos o dólares.
const money = (n: number, moneda = '') =>
  `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${moneda ? ' ' + moneda : ''}`

/** Primer valor viejo y último valor nuevo de una serie de cambios al mismo campo. */
function deAtras<T extends EventoBitacora>(evs: T[]): { de: string | null; a: string | null } {
  const ord = [...evs].sort((x, y) => x.created_at.localeCompare(y.created_at))
  return { de: ord[0].old_value, a: ord[ord.length - 1].new_value }
}

function listar(nombres: string[], max = 4): string {
  const vistos = nombres.filter(Boolean)
  if (vistos.length === 0) return ''
  if (vistos.length <= max) return vistos.join(', ')
  return `${vistos.slice(0, max).join(', ')} y ${vistos.length - max} más`
}

export interface OpcionesResumen {
  desde: string | null
  hasta?: string
  totalAntes?: number | null
  totalDespues?: number | null
  moneda?: string
}

/**
 * Consolida los movimientos en secciones legibles.
 *
 * `eventos` debe venir ya filtrado a UNA cotización y a la ventana de tiempo.
 */
export function construirResumen(eventos: EventoBitacora[], opts: OpcionesResumen): ResumenCotizacion {
  const secciones: SeccionResumen[] = []
  const por = (a: string) => eventos.filter(e => e.action === a)
  const meta = (e: EventoBitacora, k: string): string => String(e.metadata?.[k] ?? '')

  // ── Dinero y etapa ────────────────────────────────────────────────────
  const cabecera: string[] = []
  const etapas = por('etapa')
  if (etapas.length) {
    const { de, a } = deAtras(etapas)
    if (de !== a) cabecera.push(`Etapa: ${ETAPA[de || ''] || de || '—'} → ${ETAPA[a || ''] || a || '—'}`)
  }
  const tA = opts.totalAntes, tD = opts.totalDespues
  if (tA != null && tD != null && Math.abs(tD - tA) > 0.005) {
    const d = tD - tA
    const pct = tA !== 0 ? ` (${d > 0 ? '+' : ''}${((d / tA) * 100).toFixed(1)}%)` : ''
    cabecera.push(`Total: ${money(tA, opts.moneda)} → ${money(tD, opts.moneda)}${pct}`)
  } else if (tD != null && tA == null) {
    cabecera.push(`Total actual: ${money(tD, opts.moneda)}`)
  }
  if (cabecera.length) secciones.push({ titulo: 'Lo grande', lineas: cabecera })

  // ── Alcance: sistemas y áreas ─────────────────────────────────────────
  const alcance: string[] = []

  // Un sistema agregado y quitado en la misma ventana no es noticia.
  const netoPorNombre = (accionMas: string, accionMenos: string) => {
    const mas = new Map<string, number>()
    for (const e of por(accionMas)) {
      const k = e.new_value || e.old_value || ''
      mas.set(k, (mas.get(k) || 0) + 1)
    }
    for (const e of por(accionMenos)) {
      const k = e.old_value || e.new_value || ''
      mas.set(k, (mas.get(k) || 0) - 1)
    }
    const suben: string[] = [], bajan: string[] = []
    for (const [k, v] of mas) { if (v > 0) suben.push(k); else if (v < 0) bajan.push(k) }
    return { suben, bajan }
  }

  const sistemas = netoPorNombre('sistema_agregado', 'sistema_quitado')
  for (const s of sistemas.suben) alcance.push(`Se agregó el sistema ${sis(s)}`)
  for (const s of sistemas.bajan) alcance.push(`Se quitó el sistema ${sis(s)}`)

  const apagados = netoPorNombre('sistema_apagado', 'sistema_prendido')
  for (const s of apagados.suben) alcance.push(`Se APAGÓ ${sis(s)} — deja de sumar al total`)
  for (const s of apagados.bajan) alcance.push(`Se prendió ${sis(s)} — vuelve a sumar`)

  const areas = netoPorNombre('area_agregada', 'area_quitada')
  for (const a of areas.suben) alcance.push(`Se agregó el área ${a}`)
  for (const a of areas.bajan) alcance.push(`Se quitó el área ${a}`)
  for (const e of por('area_renombrada')) alcance.push(`Área renombrada: ${e.old_value} → ${e.new_value}`)

  if (alcance.length) secciones.push({ titulo: 'Alcance', lineas: alcance })

  // ── Condiciones comerciales ───────────────────────────────────────────
  const comercial: string[] = []
  for (const accion of Object.keys(ETIQUETA_AJUSTE)) {
    const evs = por(accion)
    if (!evs.length) continue
    const { de, a } = deAtras(evs)
    if (de === a) continue // fue y volvió
    const suf = accion === 'ajuste_descuento' || accion === 'ajuste_ivaRate' || accion === 'ajuste_nominaPct' ? '%' : ''
    comercial.push(`${ETIQUETA_AJUSTE[accion]}: ${de ?? '—'}${de != null ? suf : ''} → ${a ?? '—'}${a != null ? suf : ''}`)
  }
  if (comercial.length) secciones.push({ titulo: 'Condiciones comerciales', lineas: comercial })

  // ── Productos, agrupados por área y ya neteados ───────────────────────
  // Un renglón que se agregó y se borró en la ventana no se cuenta.
  const vivos = new Map<string, EventoBitacora>()   // item_id → evento de alta
  const muertos = new Set<string>()
  for (const e of por('item_agregado')) vivos.set(meta(e, 'item_id'), e)
  for (const e of por('item_quitado')) {
    const id = meta(e, 'item_id')
    if (vivos.has(id)) vivos.delete(id)  // nació y murió aquí: nunca existió
    else muertos.add(id)
  }
  const quitadosReales = por('item_quitado').filter(e => muertos.has(meta(e, 'item_id')))

  const porArea = new Map<string, { alta: string[]; baja: string[] }>()
  const cubo = (a: string) => {
    if (!porArea.has(a)) porArea.set(a, { alta: [], baja: [] })
    return porArea.get(a)!
  }
  for (const e of vivos.values()) cubo(meta(e, 'area') || 'Sin área').alta.push(e.new_value || '')
  for (const e of quitadosReales) cubo(meta(e, 'area') || 'Sin área').baja.push(e.old_value || '')

  const productos: string[] = []
  for (const [area, { alta, baja }] of porArea) {
    const partes: string[] = []
    if (alta.length) partes.push(`+${alta.length} producto${alta.length > 1 ? 's' : ''} (${listar(alta)})`)
    if (baja.length) partes.push(`−${baja.length} producto${baja.length > 1 ? 's' : ''} (${listar(baja)})`)
    if (partes.length) productos.push(`${area}: ${partes.join(' · ')}`)
  }

  // Cantidades y precios: primer valor viejo contra último nuevo, por renglón.
  const porItem = (accion: string, etiqueta: (de: string, a: string) => string) => {
    const grupos = new Map<string, EventoBitacora[]>()
    for (const e of por(accion)) {
      const id = meta(e, 'item_id')
      if (vivos.has(id) || muertos.has(id)) continue // ya se cuenta como alta o baja
      if (!grupos.has(id)) grupos.set(id, [])
      grupos.get(id)!.push(e)
    }
    for (const [, evs] of grupos) {
      const { de, a } = deAtras(evs)
      if (de === a) continue // fue y volvió
      const e0 = evs[0]
      const nombre = meta(e0, 'nombre') || 'Renglón'
      const area = meta(e0, 'area') || 'Sin área'
      productos.push(`${area} · ${nombre}: ${etiqueta(cant(de), cant(a))}`)
    }
  }
  porItem('item_cantidad', (de, a) => `cantidad ${de} → ${a}`)
  porItem('item_precio', (de, a) => `precio ${de} → ${a}`)
  for (const e of por('item_sustituido')) {
    productos.push(`${meta(e, 'area') || 'Sin área'}: se sustituyó ${e.old_value} por ${e.new_value}`)
  }

  if (productos.length) secciones.push({ titulo: 'Productos', lineas: productos })

  return {
    desde: opts.desde,
    hasta: opts.hasta || new Date().toISOString(),
    eventosCrudos: eventos.length,
    secciones,
    vacio: secciones.length === 0,
  }
}

/** El resumen en texto plano, para el correo y la notificación. */
export function resumenATexto(r: ResumenCotizacion): string {
  return r.secciones
    .map(s => `${s.titulo.toUpperCase()}\n` + s.lineas.map(l => `  · ${l}`).join('\n'))
    .join('\n\n')
}
