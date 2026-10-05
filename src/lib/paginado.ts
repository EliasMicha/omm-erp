// Trae TODOS los renglones de una consulta, no los primeros mil.
//
// PostgREST corta en 1000 renglones por respuesta y no avisa: no hay error, no
// hay bandera, nada mas llegan menos. Un `.select()` sin filtro sobre una tabla
// que crece se comporta perfecto hasta el dia que cruza los mil, y de ahi en
// adelante miente en silencio.
//
// Eso ya nos paso: po_items cruzo los 1000 y la lista de Compras empezo a
// recibir las ordenes mas nuevas con una parte de sus renglones. La orden
// E102C-CO01-C01 recibio 8 de 29 y por eso decia "cotejo 8/8" y marcaba
// "Pagado" con $200,000 de $338,597.28.
//
// Primero hay que preguntarse si esa suma puede hacerse del lado del servidor
// (una vista con group by baja un renglon por orden en vez de mil por
// renglon). Cuando de veras se ocupan los renglones completos, esto los pagina.
//
// El orden importa: sin un `order` estable, dos paginas pueden traer el mismo
// renglon o saltarse uno. Por eso la columna de orden es obligatoria.

const PAGINA = 1000

/**
 * @param armar  Funcion que arma la consulta ya filtrada, SIN range ni order.
 * @param orden  Columna estable por la cual ordenar (normalmente 'id').
 */
export async function traerTodo<T = any>(
  armar: () => any,
  orden = 'id',
): Promise<T[]> {
  const todo: T[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await armar()
      .order(orden, { ascending: true })
      .range(desde, desde + PAGINA - 1)
    if (error) throw error
    const lote = (data as T[]) || []
    todo.push(...lote)
    // Una pagina incompleta es la ultima. Si vino exacta, hay que volver a
    // preguntar: puede ser que ahi se acabo justo, o que falte mas.
    if (lote.length < PAGINA) break
  }
  return todo
}
