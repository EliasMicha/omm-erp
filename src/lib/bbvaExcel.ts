// ═══════════════════════════════════════════════════════════════════════════
//  bbvaExcel — leer el Excel del portal NUEVO de BBVA.
//
//  BBVA cambió su portal y el botón de descarga ahora entrega un .xlsx en vez
//  del TXT que se pegaba en la caja de Conciliación. Cambió la forma, no solo
//  el archivo:
//
//    portal viejo (TXT)   Día · Concepto/Referencia · cargo · Abono · Saldo
//    portal nuevo (XLSX)  Fecha de operación · Concepto · Descripción · Importe
//
//  Tres diferencias que importan:
//
//  1. UN SOLO IMPORTE CON SIGNO. Ya no hay columnas separadas de cargo y abono:
//     viene "-19477.58 MXN" y el signo es lo que distingue. Negativo = cargo,
//     positivo = abono.
//  2. DOS COLUMNAS DE TEXTO. El comercio va en `Descripción`
//     ("DLO*TDA UBER RIDES ******6919") y la referencia en `Concepto`
//     ("RFC: UPM 200220LK5 12:42 AUT: 662503"). Se juntan con la descripción
//     PRIMERO, porque así quedaba en el TXT viejo y es de donde el modelo saca
//     el beneficiario.
//  3. YA NO TRAE SALDO CORRIDO. El cuadre por delta de saldo que hacía el
//     importador deja de ser posible. A cambio, la cabecera trae "Saldo final
//     contable", que es un dato del banco y sirve para cotejar a mano.
//
//  Este módulo NO habla con la IA: convierte el Excel al mismo TSV de 5
//  columnas que el importador ya sabía procesar, y de ahí todo sigue igual
//  (extracción de beneficiario, categoría, proyecto, RFC). Cambiar el formato
//  de entrada no debía obligar a reescribir el resto.
// ═══════════════════════════════════════════════════════════════════════════

export interface MovimientoBBVA {
  /** YYYY-MM-DD, para comparar y filtrar. */
  fecha: string
  /** DD-MM-YYYY, que es como lo espera el importador. */
  fechaPortal: string
  concepto: string
  descripcion: string
  /** Con signo, tal cual lo da el banco. */
  importe: number
  /** Siempre positivo. */
  monto: number
  tipo: 'cargo' | 'abono'
  fila: number
}

export interface MetaBBVA {
  titular: string | null
  /** Como viene: 007400480118270236. */
  cuenta: string | null
  divisa: string | null
  saldoFinal: number | null
  periodo: string | null
}

export interface LecturaBBVA {
  meta: MetaBBVA
  movimientos: MovimientoBBVA[]
  /** Problemas por renglón: se reportan, no se tiran en silencio. */
  errores: string[]
}

const txt = (v: unknown): string => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim()

/** "-19,477.58 MXN" → -19477.58. null si no parece importe. */
export function parseImporte(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v
  const s = txt(v)
  if (!s) return null
  // Quitar la divisa y cualquier cosa que no sea numero, signo o separador.
  const m = s.match(/^\s*(-?\s*[\d.,]+)/)
  if (!m) return null
  let n = m[1].replace(/\s/g, '')
  // Formato mexicano: la coma es separador de miles.
  const ultPunto = n.lastIndexOf('.')
  const ultComa = n.lastIndexOf(',')
  if (ultPunto >= 0 && ultComa >= 0) {
    if (ultPunto > ultComa) n = n.replace(/,/g, '')
    else n = n.replace(/\./g, '').replace(',', '.')
  } else if (ultComa >= 0) {
    // Una sola coma: decimal solo si deja exactamente 2 digitos detras.
    n = (n.length - ultComa - 1) === 2 ? n.replace(',', '.') : n.replace(/,/g, '')
  }
  const r = parseFloat(n)
  return isFinite(r) ? r : null
}

/** "28/09/2026" → { iso: "2026-09-28", portal: "28-09-2026" }. */
export function parseFecha(v: unknown): { iso: string; portal: string } | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, '0')
    const d = p(v.getDate()), m = p(v.getMonth() + 1), a = v.getFullYear()
    return { iso: `${a}-${m}-${d}`, portal: `${d}-${m}-${a}` }
  }
  const s = txt(v)
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) {
    const d = m[1].padStart(2, '0'), mes = m[2].padStart(2, '0'), a = m[3]
    return { iso: `${a}-${mes}-${d}`, portal: `${d}-${mes}-${a}` }
  }
  // Por si algun dia lo entregan ya en ISO.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return { iso: s, portal: `${iso[3]}-${iso[2]}-${iso[1]}` }
  return null
}

/**
 * Lee la hoja como matriz (lo que devuelve SheetJS con header:1).
 *
 * No se asume que los datos empiecen en una fila fija: BBVA ya movió el
 * formato una vez. Se busca el renglón de encabezados por su texto y las
 * columnas por su nombre, así que si agregan un renglón arriba o recorren las
 * columnas, esto sigue funcionando.
 */
export function leerHojaBBVA(matriz: unknown[][]): LecturaBBVA {
  const errores: string[] = []
  const meta: MetaBBVA = { titular: null, cuenta: null, divisa: null, saldoFinal: null, periodo: null }

  // ── Cabecera: pares etiqueta/valor en cualquier par de columnas ──────────
  const etiquetas: Array<[RegExp, (val: string) => void]> = [
    [/^titular$/i,                v => { meta.titular = val(v) }],
    [/^cuenta$/i,                 v => { meta.cuenta = val(v) }],
    [/^divisa$/i,                 v => { meta.divisa = val(v) }],
    [/^saldo final contable$/i,   v => { meta.saldoFinal = parseImporte(v) }],
    [/^periodo$/i,                v => { meta.periodo = val(v) }],
  ]
  const val = (s: string) => (s ? s : null) as any

  let filaEnc = -1, colFecha = -1, colConcepto = -1, colDesc = -1, colImporte = -1

  for (let i = 0; i < matriz.length; i++) {
    const fila = matriz[i] || []
    for (let j = 0; j < fila.length; j++) {
      const celda = txt(fila[j])
      if (!celda) continue
      if (filaEnc < 0) {
        for (const [re, set] of etiquetas) {
          if (re.test(celda)) { set(txt(fila[j + 1])); break }
        }
      }
      // El encabezado de la tabla: la fecha es la unica obligatoria.
      if (/^fecha de operaci[oó]n$/i.test(celda)) {
        filaEnc = i
        for (let k = 0; k < fila.length; k++) {
          const h = txt(fila[k]).toLowerCase()
          if (/^fecha de operaci[oó]n$/.test(h)) colFecha = k
          else if (/^concepto$/.test(h)) colConcepto = k
          else if (/^descripci[oó]n$/.test(h)) colDesc = k
          else if (/^importe$/.test(h)) colImporte = k
        }
      }
    }
    if (filaEnc >= 0 && i > filaEnc) break
  }

  if (filaEnc < 0) {
    errores.push('No se encontró el encabezado "Fecha de operación". ¿Es el Excel de movimientos de BBVA?')
    return { meta, movimientos: [], errores }
  }
  if (colImporte < 0) {
    errores.push('No se encontró la columna "Importe".')
    return { meta, movimientos: [], errores }
  }

  // ── Movimientos ─────────────────────────────────────────────────────────
  const movimientos: MovimientoBBVA[] = []
  for (let i = filaEnc + 1; i < matriz.length; i++) {
    const fila = matriz[i] || []
    const crudoFecha = fila[colFecha]
    const crudoImporte = fila[colImporte]
    // Renglon completamente vacio: fin de la tabla o hueco, no es error.
    if (!txt(crudoFecha) && !txt(crudoImporte) && !txt(fila[colConcepto]) && !txt(fila[colDesc])) continue

    const f = parseFecha(crudoFecha)
    const imp = parseImporte(crudoImporte)
    if (!f) { errores.push(`Fila ${i + 1}: fecha ilegible (${txt(crudoFecha) || 'vacía'})`); continue }
    if (imp == null) { errores.push(`Fila ${i + 1}: importe ilegible (${txt(crudoImporte) || 'vacío'})`); continue }
    // Un importe en cero no se puede clasificar como cargo ni abono, pero
    // existe (BBVA los usa para compensaciones). Se deja como abono y se avisa.
    if (imp === 0) errores.push(`Fila ${i + 1}: importe en $0.00, revísalo a mano`)

    movimientos.push({
      fecha: f.iso,
      fechaPortal: f.portal,
      concepto: txt(fila[colConcepto]),
      descripcion: txt(fila[colDesc]),
      importe: imp,
      monto: Math.abs(imp),
      tipo: imp < 0 ? 'cargo' : 'abono',
      fila: i + 1,
    })
  }

  return { meta, movimientos, errores }
}

/**
 * El TSV de 5 columnas que el importador ya sabe procesar.
 *
 * La descripción va ANTES del concepto: en el TXT viejo la columna era
 * "Concepto / Referencia" con el comercio al frente, y de ahí saca el modelo
 * el beneficiario. Si se manda al revés, cada renglón empieza con "RFC: ...
 * AUT: ..." y el nombre del comercio queda sepultado.
 *
 * La columna Saldo va vacía a propósito: el portal nuevo ya no la entrega, y
 * es preferible un hueco honesto a un número inventado.
 */
export function aTsvDelPortal(movs: MovimientoBBVA[]): string {
  const cab = 'Día\tConcepto / Referencia\tcargo\tAbono\tSaldo'
  const f2 = (n: number) => n.toFixed(2)
  const lineas = movs.map(m => {
    const concepto = [m.descripcion, m.concepto].filter(Boolean).join(' / ')
    const cargo = m.tipo === 'cargo' ? f2(m.monto) : ''
    const abono = m.tipo === 'abono' ? f2(m.monto) : ''
    return `${m.fechaPortal}\t${concepto}\t${cargo}\t${abono}\t`
  })
  return [cab, ...lineas].join('\n')
}

/** Se descartan los que ya están importados. La fecha de corte es inclusiva. */
export function soloNuevos(movs: MovimientoBBVA[], ultimaFecha: string | null): MovimientoBBVA[] {
  if (!ultimaFecha) return movs
  return movs.filter(m => m.fecha > ultimaFecha)
}

export interface ResumenLectura {
  total: number
  nuevos: number
  yaImportados: number
  cargos: number
  abonos: number
  sumaCargos: number
  sumaAbonos: number
  neto: number
  desde: string | null
  hasta: string | null
}

export function resumir(todos: MovimientoBBVA[], nuevos: MovimientoBBVA[]): ResumenLectura {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const cargos = nuevos.filter(m => m.tipo === 'cargo')
  const abonos = nuevos.filter(m => m.tipo === 'abono')
  const fechas = nuevos.map(m => m.fecha).sort()
  const sc = r2(cargos.reduce((a, m) => a + m.monto, 0))
  const sa = r2(abonos.reduce((a, m) => a + m.monto, 0))
  return {
    total: todos.length,
    nuevos: nuevos.length,
    yaImportados: todos.length - nuevos.length,
    cargos: cargos.length,
    abonos: abonos.length,
    sumaCargos: sc,
    sumaAbonos: sa,
    neto: r2(sa - sc),
    desde: fechas[0] || null,
    hasta: fechas[fechas.length - 1] || null,
  }
}

/**
 * ¿El archivo es de la cuenta que está seleccionada en pantalla?
 *
 * BBVA escribe la cuenta larga (007400480118270236) y el ERP la corta
 * (0118270236). Importar el Excel de una cuenta en la pestaña de otra mete
 * movimientos ajenos que después hay que cazar uno por uno, así que se
 * compara por terminación.
 */
export function cuentaCoincide(cuentaArchivo: string | null, cuentaErp: string): boolean {
  if (!cuentaArchivo) return true // sin dato en el archivo no se puede afirmar que no
  const a = cuentaArchivo.replace(/\D/g, '')
  const b = cuentaErp.replace(/\D/g, '')
  if (!a || !b) return true
  return a.endsWith(b) || b.endsWith(a)
}
