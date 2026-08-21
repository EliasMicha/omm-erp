// ═══════════════════════════════════════════════════════════════════════════
// pdfPaginado — cortar un canvas largo en páginas SIN partir el contenido.
//
// Los PDF de propuestas se generan rasterizando el documento con html2canvas y
// rebanándolo cada 297 mm. El corte caía donde cayera: partía un título por la
// mitad, y como la mitad de arriba queda en una página y la de abajo en la
// siguiente, el encabezado parecía repetido y roto.
//
// Aquí el corte se busca en un renglón EN BLANCO. Se parte del corte ideal y se
// sube pixel por pixel hasta encontrar una banda de renglones del color del
// fondo — o sea, el espacio entre dos bloques. Si en toda la ventana de
// búsqueda no hay ni un hueco (una tabla larguísima, por ejemplo) se corta
// donde tocaba: mejor una página cortada que un documento sin fin.
// ═══════════════════════════════════════════════════════════════════════════

/** Un renglón cuenta como vacío si todos sus pixeles son casi del color de fondo. */
function renglonVacio(ctx: CanvasRenderingContext2D, ancho: number, y: number, umbral: number): boolean {
  // Se muestrea 1 de cada 4 pixeles: basta para detectar tinta y es 4x más rápido.
  const d = ctx.getImageData(0, y, ancho, 1).data
  for (let i = 0; i < d.length; i += 16) {
    if (d[i] < umbral || d[i + 1] < umbral || d[i + 2] < umbral) return false
  }
  return true
}

/**
 * Altura de la rebanada que va en esta página.
 *
 * @param corteIdeal  cuánto cabe en una página, en pixeles del canvas
 * @param ventana     cuánto se permite recortar hacia arriba buscando el hueco
 *                    (por defecto 18% de la página: más que eso deja huecos feos)
 * @param minBanda    renglones vacíos seguidos que se exigen para considerarlo
 *                    un corte limpio y no el interlineado de un párrafo
 */
export function alturaDeCorte(
  canvas: HTMLCanvasElement,
  desde: number,
  corteIdeal: number,
  opts?: { ventana?: number; minBanda?: number; umbral?: number },
): number {
  const restante = canvas.height - desde
  if (restante <= corteIdeal) return restante // última página: no hay nada que buscar

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return corteIdeal

  const ventana = Math.floor(opts?.ventana ?? corteIdeal * 0.18)
  const minBanda = opts?.minBanda ?? 6
  const umbral = opts?.umbral ?? 245
  const limite = Math.max(1, corteIdeal - ventana)

  let seguidos = 0
  try {
    for (let alto = corteIdeal; alto > limite; alto--) {
      if (renglonVacio(ctx, canvas.width, desde + alto - 1, umbral)) {
        seguidos++
        // Se corta arriba de la banda para que el hueco quede en la página que
        // termina, no encabezando la que sigue.
        if (seguidos >= minBanda) return alto + seguidos - 1
      } else {
        seguidos = 0
      }
    }
  } catch {
    // getImageData truena si el canvas quedó "sucio" por una imagen de otro
    // dominio. En ese caso se corta a lo bruto, como antes.
    return corteIdeal
  }
  return corteIdeal
}
