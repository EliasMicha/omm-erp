// ═══════════════════════════════════════════════════════════════════════════
//  bbvaPdf — leer el PDF "Listado de movimientos" del portal nuevo de BBVA.
//
//  Es EL MISMO documento que el .xlsx: misma cabecera (Titular, Cuenta,
//  Divisa, Saldo final contable, Periodo) y las mismas cuatro columnas
//  (FECHA OP · CONCEPTO · DESCRIPCIÓN · IMPORTE con signo).
//
//  Por eso este módulo NO vuelve a parsear fechas, importes ni cuentas: arma
//  la MISMA matriz que entrega SheetJS y se la pasa a `leerHojaBBVA()` de
//  bbvaExcel.ts. Toda la validación —formato mexicano de números, cotejo de
//  cuenta por terminación, divisa, renglones ilegibles— se reusa tal cual.
//  Dos lectores del mismo banco con dos reglas distintas es justo cómo se
//  empieza a diferir sin que nadie lo note.
//
//  ── POR QUÉ POR COORDENADA Y NO POR REGEX ─────────────────────────────────
//
//  Las celdas envuelven, y la descripción se parte CON UN PEDAZO ARRIBA Y OTRO
//  ABAJO del renglón de la fecha:
//
//      y=548.9  x=301.4   "DEP.CHEQUES DE OTRO"      ← descripción, arriba
//      y=542.6  x= 33.8   "05/10/2026"               ← la fecha
//      y=542.6  x=140.8   "OCT05 12:56 MEXICO C07"   ← concepto
//      y=542.6  x=493.2   "2,051.46 MXN"             ← importe
//      y=536.3  x=301.4   "BANCO0005504"             ← descripción, abajo
//
//  Leer línea por línea parte ese movimiento en tres y pega la descripción al
//  renglón equivocado. Por posición no: las fechas están a 42.5 unidades una
//  de otra y los pedazos caen a ±6.3 de la suya.
//
//  ── LAS DOS ANCLAS QUE HACEN ESTO ROBUSTO ─────────────────────────────────
//
//  1. Las tres primeras columnas están alineadas a la IZQUIERDA en una x fija
//     que se lee del encabezado (33.8 / 140.8 / 301.4). No se adivina.
//  2. El importe está alineado a la DERECHA en el mismo borde que su
//     encabezado (x+ancho = 561.5, exacto en los 251 movimientos). Por eso la
//     columna de importe se reconoce por su borde derecho y no por un margen
//     inventado, que es lo que se rompería el día que BBVA mueva las columnas.
// ═══════════════════════════════════════════════════════════════════════════

/** Un fragmento de texto con su posición, tal como lo da pdf.js. */
export interface ItemPdf {
  texto: string
  /** Borde izquierdo (transform[4]). */
  x: number
  /** Línea base (transform[5]). Mayor = más arriba. */
  y: number
  ancho: number
}

export interface PaginaPdf {
  items: ItemPdf[]
}

/** Qué tan lejos puede estar un pedazo de su fecha para ser del mismo renglón.
 *  Las filas van a ~42.5 de distancia y los pedazos a ~6.3, así que 18 deja
 *  margen de sobra sin alcanzar la fila vecina. */
const TOL_FILA = 18
/** Dos items son de la misma línea visual si su y difiere menos que esto. */
const TOL_LINEA = 2.5
/** Para reconocer el borde derecho del importe. */
const TOL_DERECHA = 3

const limpio = (s: string) => s.replace(/\s+/g, ' ').trim()
const esFecha = (s: string) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(limpio(s))

/** Renglones de adorno que no son datos y no deben acabar pegados a un
 *  movimiento. El pie y el folio de página se repiten en las 16 hojas. */
function esAdorno(t: string): boolean {
  const s = limpio(t)
  return (
    !s ||
    /^\d+\s+de\s+\d+$/i.test(s) ||                       // "1 de 16"
    /^listado de movimientos$/i.test(s) ||
    /^bbva\.mx$/i.test(s) ||
    /^este documento es informativo/i.test(s) ||
    /^bbva méxico, s\.a\./i.test(s) ||
    /^(fecha op|concepto|descripci[oó]n|importe)$/i.test(s)  // encabezado de tabla
  )
}

interface Columnas { fecha: number; concepto: number; descripcion: number; derechaImporte: number }

/** Encuentra la x de cada columna leyendo el encabezado de la tabla. */
function columnasDe(items: ItemPdf[]): Columnas | null {
  const hFecha = items.find(i => /^fecha op$/i.test(limpio(i.texto)))
  if (!hFecha) return null
  const mismaLinea = items.filter(i => Math.abs(i.y - hFecha.y) < TOL_LINEA)
  const h = (re: RegExp) => mismaLinea.find(i => re.test(limpio(i.texto)))
  const hConcepto = h(/^concepto$/i)
  const hDesc = h(/^descripci[oó]n$/i)
  const hImporte = h(/^importe$/i)
  if (!hConcepto || !hDesc || !hImporte) return null
  return {
    fecha: hFecha.x,
    concepto: hConcepto.x,
    descripcion: hDesc.x,
    // El importe va alineado a la derecha: se guarda su BORDE DERECHO.
    derechaImporte: hImporte.x + hImporte.ancho,
  }
}

/** ¿A qué columna pertenece este fragmento? */
function columnaDe(it: ItemPdf, c: Columnas): 'fecha' | 'concepto' | 'descripcion' | 'importe' {
  // El importe primero: se reconoce por su borde derecho, no por su izquierda,
  // porque su x cambia con el largo del número (480.9 para 129,045.53 y 494.3
  // para 5,769.51) mientras el borde derecho es siempre el mismo.
  if (Math.abs((it.x + it.ancho) - c.derechaImporte) < TOL_DERECHA) return 'importe'
  const d = (ref: number) => Math.abs(it.x - ref)
  const m = Math.min(d(c.fecha), d(c.concepto), d(c.descripcion))
  if (m === d(c.fecha)) return 'fecha'
  if (m === d(c.concepto)) return 'concepto'
  return 'descripcion'
}

/** Las etiquetas de la cabecera, con el nombre EXACTO que espera
 *  `leerHojaBBVA`. En el PDF "Saldo final contable" viene partido en dos
 *  líneas ("Saldo final" arriba, "contable" abajo) con el valor pegado a la
 *  primera, así que se reconoce por el principio y se emite completo. */
const ETIQUETAS: Array<[RegExp, string]> = [
  [/^titular$/i,            'Titular'],
  [/^cuenta$/i,             'Cuenta'],
  [/^divisa$/i,             'Divisa'],
  [/^banco$/i,              'Banco'],
  [/^saldo final\b/i,       'Saldo final contable'],
  [/^periodo$/i,            'Periodo'],
]

/** Cabecera del documento: pares etiqueta/valor de la primera página. */
function filasDeCabecera(items: ItemPdf[], yTabla: number): unknown[][] {
  const filas: unknown[][] = []
  const arriba = items.filter(i => i.y > yTabla)
  for (const it of arriba) {
    const t = limpio(it.texto)
    const par = ETIQUETAS.find(([re]) => re.test(t))
    if (!par) continue
    // El valor es el fragmento de la MISMA línea que está a su derecha.
    const valor = arriba
      .filter(o => o !== it && Math.abs(o.y - it.y) < TOL_LINEA && o.x > it.x)
      .sort((a, b) => a.x - b.x)[0]
    if (valor) filas.push([par[1], limpio(valor.texto)])
  }
  return filas
}

/**
 * Convierte las páginas del PDF en la misma matriz que `sheet_to_json(header:1)`
 * entrega para el Excel, para poder pasarla por `leerHojaBBVA()` sin cambios.
 *
 * Devuelve: filas de cabecera [etiqueta, valor], luego el encabezado de la
 * tabla con los nombres que el lector del Excel busca, y luego un renglón por
 * movimiento: [fecha, concepto, descripción, importe].
 */
export function matrizDesdePdf(paginas: PaginaPdf[]): unknown[][] {
  const matriz: unknown[][] = []
  let cols: Columnas | null = null
  let cabeceraPuesta = false

  for (const pag of paginas) {
    const items = pag.items.filter(i => limpio(i.texto))
    const colsPag = columnasDe(items)
    if (colsPag) cols = colsPag        // el encabezado se repite en cada hoja
    if (!cols) continue                 // hoja antes de que empiece la tabla

    const yTabla = colsPag
      ? (items.find(i => /^fecha op$/i.test(limpio(i.texto)))?.y ?? 0)
      : Number.POSITIVE_INFINITY

    // ── Cabecera del documento (solo donde aparece) ───────────────────────
    if (!cabeceraPuesta && colsPag) {
      const cab = filasDeCabecera(items, yTabla)
      if (cab.length) {
        matriz.push(...cab)
        cabeceraPuesta = true
      }
    }

    // El encabezado de la tabla se escribe UNA vez, con los nombres que busca
    // el lector del Excel (el PDF dice "FECHA OP", el Excel "Fecha de operación").
    if (matriz.every(f => !/^fecha de operaci[oó]n$/i.test(String(f[0] ?? '')))) {
      matriz.push(['Fecha de operación', 'Concepto', 'Descripción', 'Importe'])
    }

    // ── Movimientos ────────────────────────────────────────────────────────
    const utiles = items.filter(i => i.y < yTabla && !esAdorno(i.texto))

    // Las fechas son el ancla de cada renglón.
    const anclas = utiles
      .filter(i => columnaDe(i, cols!) === 'fecha' && esFecha(i.texto))
      .sort((a, b) => b.y - a.y)
    if (anclas.length === 0) continue

    const filas = anclas.map(a => ({
      y: a.y,
      fecha: limpio(a.texto),
      concepto: [] as ItemPdf[],
      descripcion: [] as ItemPdf[],
      importe: [] as ItemPdf[],
    }))

    for (const it of utiles) {
      if (anclas.includes(it)) continue
      // A la fecha más cercana. Los pedazos envueltos caen arriba Y abajo de
      // su propia fecha, así que no sirve "la de arriba" ni "la de abajo".
      let mejor = -1, dist = Infinity
      for (let k = 0; k < filas.length; k++) {
        const d = Math.abs(it.y - filas[k].y)
        if (d < dist) { dist = d; mejor = k }
      }
      if (mejor < 0 || dist > TOL_FILA) continue
      const col = columnaDe(it, cols!)
      if (col === 'fecha') continue     // otra fecha suelta: no es dato
      filas[mejor][col].push(it)
    }

    // Dentro de una celda: de arriba hacia abajo, y de izquierda a derecha.
    const unir = (xs: ItemPdf[]) =>
      xs.sort((a, b) => b.y - a.y || a.x - b.x).map(i => limpio(i.texto)).join(' ').trim()

    for (const f of filas) {
      matriz.push([f.fecha, unir(f.concepto), unir(f.descripcion), unir(f.importe)])
    }
  }

  return matriz
}

/**
 * Saca los items de texto de un PDF ya abierto con pdf.js.
 *
 * Recibe el documento en vez de cargar pdf.js por dentro para que este módulo
 * se pueda correr y probar fuera del navegador — que es como se verificó
 * contra el estado de cuenta real de 16 hojas.
 */
export async function itemsDePdf(doc: any): Promise<PaginaPdf[]> {
  const paginas: PaginaPdf[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const contenido = await page.getTextContent()
    const items: ItemPdf[] = (contenido.items || [])
      .filter((i: any) => typeof i.str === 'string' && i.str.trim())
      .map((i: any) => ({
        texto: i.str,
        x: i.transform[4],
        y: i.transform[5],
        ancho: i.width,
      }))
    paginas.push({ items })
  }
  return paginas
}
