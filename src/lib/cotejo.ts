// ═══════════════════════════════════════════════════════════════════════════
//  Cotejo de una orden de compra — qué se compró DE VERDAD.
//
//  Elias: "cuando hago el cotejo de precios y apruebo la OC con sustituciones
//  o cantidades cotejadas, no me guarda eso, me guarda lo original".
//
//  ── Lo que pasaba, que era peor que "no se guarda" ──────────────────────
//
//  El cotejo SÍ se guardaba: vive en las columnas `real_*` de `po_items`, y el
//  ENCABEZADO de la orden ya traía los totales cotejados. Lo que no se
//  enteraba era el PDF: imprime cada renglón con los campos canónicos (los del
//  catálogo) y el bloque de totales con `purchase_orders.subtotal/iva/total`.
//
//  Resultado en E102C-ES01-C05: renglones que suman $6,140.62 y un TOTAL de
//  $4,436.69 al pie. Una orden de compra que no cuadra consigo misma, firmada
//  y enviada al proveedor. 23 órdenes estaban así.
//
//  ── Por qué existían dos verdades ───────────────────────────────────────
//
//  Los `real_*` se volcaban a los campos canónicos SOLO al marcar la orden
//  como "pedida". Pero el PDF se manda al aprobar, que es antes. Entre aprobar
//  y pedir, la orden vivía con el precio viejo en los renglones y el nuevo en
//  el total.
//
//  Se arregla por los dos lados: aquí, resolviendo el renglón para cualquiera
//  que lo pinte, y en `changeStatus`, volcando también al aprobar.
//
//  ⚠️ EL MODELO EN UNA SUSTITUCIÓN. Si se sustituyó el producto (`real_name`)
//  y no se capturó `real_modelo`, el `modelo` viejo es de OTRO producto:
//  imprimirlo manda al proveedor un modelo que no corresponde al nombre. Se
//  deja en blanco. Un dato faltante se pregunta; uno equivocado se compra.
// ═══════════════════════════════════════════════════════════════════════════

export interface ItemCotejable {
  name?: string
  marca?: string | null
  modelo?: string | null
  quantity?: number
  unit_cost?: number
  total?: number
  cotejo_status?: string | null
  real_name?: string | null
  real_marca?: string | null
  real_modelo?: string | null
  real_quantity?: number | null
  real_unit_cost?: number | null
  real_total?: number | null
}

/** Cotejado o sustituido: en los dos casos manda lo `real_*`. */
export const estaCotejado = (it: ItemCotejable | null | undefined): boolean =>
  it?.cotejo_status === 'cotejado' || it?.cotejo_status === 'sustituido'

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * El renglón como quedó después del cotejo, listo para pintarse o imprimirse.
 *
 * No toca la base: devuelve una copia. Quien pinte una orden —el PDF, una
 * tabla, un correo— pasa por aquí y ve lo mismo que el encabezado.
 */
export function comoQuedo<T extends ItemCotejable>(it: T): T & { sustituido: boolean } {
  if (!estaCotejado(it)) return { ...it, sustituido: false }

  const sustituido = !!it.real_name
  const quantity = it.real_quantity != null ? Number(it.real_quantity) : Number(it.quantity ?? 0)
  const unit_cost = it.real_unit_cost != null ? Number(it.real_unit_cost) : Number(it.unit_cost ?? 0)
  const total = it.real_total != null ? Number(it.real_total) : r2(quantity * unit_cost)

  return {
    ...it,
    name: it.real_name || it.name,
    marca: it.real_marca ?? (sustituido ? '' : it.marca),
    // Ver el aviso de arriba: el modelo viejo pertenece al producto sustituido.
    modelo: it.real_modelo ?? (sustituido ? '' : it.modelo),
    quantity, unit_cost, total,
    sustituido,
  }
}

/**
 * Los campos a ESCRIBIR cuando la orden se vuelve definitiva.
 *
 * Es la misma resolución de `comoQuedo`, pero devolviendo solo lo que cambia,
 * para no escribir columnas que nadie tocó. Estaba copiada en dos lugares
 * —`commitCotejadoItemsDB` y el bloque de "pedida" en `changeStatus`— con el
 * riesgo de que una se corrigiera y la otra no.
 */
export function camposCotejados(it: ItemCotejable): Record<string, unknown> {
  if (!estaCotejado(it)) return {}
  const f: Record<string, unknown> = {}
  if (it.real_quantity != null) f.quantity = it.real_quantity
  if (it.real_unit_cost != null) f.unit_cost = it.real_unit_cost
  if (it.real_total != null) f.total = it.real_total
  else if (it.real_quantity != null || it.real_unit_cost != null) {
    const q = it.real_quantity != null ? Number(it.real_quantity) : Number(it.quantity ?? 0)
    const c = it.real_unit_cost != null ? Number(it.real_unit_cost) : Number(it.unit_cost ?? 0)
    f.total = r2(q * c)
  }
  if (it.real_name) {
    f.name = it.real_name
    // Sustitución sin modelo nuevo: se borra el viejo en vez de heredarlo.
    if (!it.real_modelo) f.modelo = ''
  }
  if (it.real_marca) f.marca = it.real_marca
  if (it.real_modelo) f.modelo = it.real_modelo
  return f
}
