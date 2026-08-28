// ═══════════════════════════════════════════════════════════════════════════
// estimacionPdf — la carátula de estimación que se le entrega al cliente.
//
// Un documento de estimación no es un reporte interno: es lo que el cliente
// firma para autorizar un pago. Por eso solo lleva lo que SE EJECUTÓ en el
// periodo. Los 192 conceptos del contrato con cero avance no aportan nada y
// entierran lo que sí importa; el saldo por ejecutar se resume en el bloque de
// avance del contrato, que es donde el cliente sí lo quiere ver.
//
// Estructura (la que se acostumbra en obra en México):
//   1. Carátula — obra, cliente, número de estimación, periodo
//   2. Avance del contrato — contratado, estimado anterior, este periodo, saldo
//   3. Conceptos ejecutados, agrupados por área, con cantidad de contrato,
//      anterior, del periodo y acumulado (el "generador" resumido)
//   4. EXTRAS — aparte, nunca revueltos con el contrato: es lo que se autoriza
//      por separado y lo que más se discute
//   5. Resumen de cobro — subtotal, amortización de anticipo, IVA, total
//   6. Firmas de elaboró / revisó / autorizó
// ═══════════════════════════════════════════════════════════════════════════
import jsPDF from 'jspdf'
import { montoConLetra } from './reciboEfectivo'

const EMPRESA = 'OMM TECHNOLOGIES S.A. DE C.V.'
const RFC = 'OTE210910PW5'

export interface DatosEstimacionPdf {
  numero: number
  fecha: string
  periodoInicio?: string | null
  periodoFin?: string | null
  estado: string
  moneda: string
  ivaPct: number
  amortizacionPct: number
  /** Monto ya calculado (negativo). Si viene, manda sobre el porcentaje: el
   *  anticipo se amortiza por cantidad y el % es solo la forma de decirlo. */
  amortizacionMonto?: number
  descuentoPct?: number
  contrato: { nombre: string; total: number }
  cliente: string
  obra: string
  items: Array<{
    origen: string
    area?: string | null
    concepto: string
    unidad?: string | null
    precio_unitario: number
    cant_contratada: number
    cant_anterior: number
    cant_periodo: number
    notas?: string | null
  }>
  /** Acumulado de estimaciones anteriores, en dinero. */
  estimadoAnterior: number
  notas?: string | null
}

const n = (v: any) => Number(v) || 0

export function generarEstimacionPdf(d: DatosEstimacionPdf): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const M = 14
  const R = W - M
  let y = 16

  const DARK: [number, number, number] = [26, 26, 26]
  const GREEN: [number, number, number] = [16, 185, 129]
  const AMBER: [number, number, number] = [180, 120, 20]
  const GRAY: [number, number, number] = [120, 120, 120]
  const HEAD: [number, number, number] = [238, 241, 240]
  const ZEBRA: [number, number, number] = [248, 249, 249]
  const txt = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const money = (v: number) => {
    const x = n(v)
    const signo = x < 0 ? '-' : ''
    return signo + (d.moneda === 'USD' ? 'US$' : '$') + Math.abs(x).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  const qty = (v: number) => { const x = n(v); return Number.isInteger(x) ? String(x) : x.toFixed(2) }
  const fechaLarga = (s?: string | null) => {
    if (!s) return '—'
    try { return new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }) } catch { return String(s) }
  }

  const pie = () => {
    const total = (doc as any).internal.getNumberOfPages()
    for (let p = 1; p <= total; p++) {
      doc.setPage(p)
      txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      const izq = `${EMPRESA} · RFC ${RFC}`
      const centro = `Estimación ${d.numero} · ${String(d.contrato.nombre).slice(0, 46)}`
      doc.text(izq, M, 268)
      doc.text(centro, R - 22, 268, { align: 'right' })
      doc.text(`Pág. ${p}/${total}`, R, 268, { align: 'right' })
    }
  }
  const nuevaPagina = () => { doc.addPage(); y = 18 }
  const espacio = (need: number) => { if (y + need > 258) nuevaPagina() }
  const titulo = (t: string) => {
    espacio(16)
    fill(DARK); doc.rect(M, y, R - M, 7, 'F')
    fill(GREEN); doc.rect(M, y, 2, 7, 'F')
    txt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    doc.text(t.toUpperCase(), M + 5, y + 4.8)
    txt(DARK); y += 11
  }

  // ── 1. Carátula ──────────────────────────────────────────────────────────
  txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  doc.text('OMM', M, y)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); txt(GRAY)
  doc.text(`${EMPRESA} · RFC ${RFC}`, M, y + 5)

  txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text(`ESTIMACIÓN ${d.numero}`, R, y, { align: 'right' })
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); txt(GRAY)
  doc.text(fechaLarga(d.fecha), R, y + 5, { align: 'right' })
  y += 12
  fill(DARK); doc.rect(M, y, R - M, 0.8, 'F'); y += 8

  const dato = (k: string, v: string, x: number, ancho: number) => {
    txt(GRAY); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    doc.text(k.toUpperCase(), x, y)
    txt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    doc.text(doc.splitTextToSize(v || '—', ancho), x, y + 4.5)
  }
  const mitad = (R - M) / 2
  dato('Obra / proyecto', d.obra, M, mitad - 4)
  dato('Cliente', d.cliente, M + mitad, mitad - 4)
  y += 13
  dato('Contrato', d.contrato.nombre, M, mitad - 4)
  dato('Periodo estimado', `${fechaLarga(d.periodoInicio)} al ${fechaLarga(d.periodoFin)}`, M + mitad, mitad - 4)
  y += 15

  // ── 2. Avance del contrato ───────────────────────────────────────────────
  const ejec = d.items.filter(i => n(i.cant_periodo) !== 0)
  const deContrato = ejec.filter(i => i.origen === 'contrato')
  const deExtras = ejec.filter(i => i.origen !== 'contrato')
  const impDe = (i: any) => n(i.cant_periodo) * n(i.precio_unitario)
  const subContrato = deContrato.reduce((s, i) => s + impDe(i), 0)
  const subExtras = deExtras.filter(i => i.origen === 'extra').reduce((s, i) => s + impDe(i), 0)
  const subDeduct = deExtras.filter(i => i.origen === 'deductiva').reduce((s, i) => s + impDe(i), 0)
  // El descuento pactado al cerrar aplica a lo contratado, no a los extras
  // (un extra se cotiza a precio nuevo). Va como renglón visible y no
  // prorrateado en cada P.U.: el precio unitario de la estimación tiene que
  // ser el mismo que firmó el cliente.
  const descuento = -Math.abs((subContrato + subDeduct) * (n(d.descuentoPct) / 100))
  const subtotal = subContrato + subDeduct + descuento + subExtras
  const amortizacion = d.amortizacionMonto != null
    ? -Math.abs(n(d.amortizacionMonto))
    : -Math.abs(subtotal * (n(d.amortizacionPct) / 100))
  const base = subtotal + amortizacion
  const iva = base * (n(d.ivaPct) / 100)
  const total = base + iva

  titulo('Avance del contrato')
  // Este bloque va en NETO: con el descuento de cierre ya aplicado.
  //
  // `contrato.total` y los renglones vienen a precio de lista, porque el P.U.
  // que firmó el cliente no se toca. Pero anunciar "importe contratado
  // $2,137,637.55" cuando el contrato se firmó en $1,945,250.17 confunde a
  // quien lo lee: parece que se está cobrando sobre otra base. El descuento
  // sigue apareciendo como renglón visible en el resumen de cobro; aquí sólo
  // se muestra el efecto ya hecho.
  //
  // El porcentaje de avance no cambia: lista y neto están escalados por el
  // mismo factor.
  const factorNeto = 1 - Math.abs(n(d.descuentoPct)) / 100
  const contratoNeto = n(d.contrato.total) * factorNeto
  const anteriorNeto = n(d.estimadoAnterior) * factorNeto
  const periodoNeto = subContrato * factorNeto
  const acumulado = anteriorNeto + periodoNeto
  const saldo = Math.max(0, contratoNeto - acumulado)
  const pct = contratoNeto > 0 ? acumulado / contratoNeto : 0
  const celdas: Array<[string, string, [number, number, number]]> = [
    ['Importe contratado', money(contratoNeto), DARK],
    ['Estimado anterior', money(anteriorNeto), GRAY],
    ['Este periodo (contrato)', money(periodoNeto), GREEN],
    ['Acumulado', `${money(acumulado)}  (${Math.round(pct * 100)}%)`, DARK],
    ['Saldo por ejecutar', money(saldo), AMBER],
  ]
  const anchoCelda = (R - M) / celdas.length
  celdas.forEach(([k, v, c], i) => {
    const x = M + i * anchoCelda
    txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
    doc.text(k.toUpperCase(), x, y)
    txt(c); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text(v, x, y + 5)
  })
  y += 12
  // Barra de avance
  fill([230, 232, 232]); doc.rect(M, y, R - M, 3, 'F')
  fill(GREEN); doc.rect(M, y, (R - M) * Math.min(pct, 1), 3, 'F')
  y += 10
  if (n(d.descuentoPct) > 0) {
    txt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(6)
    doc.text(`Importes netos: incluyen el descuento de contrato de ${n(d.descuentoPct)}%. Los precios unitarios del generador van a precio de lista y el descuento se desglosa en el resumen de cobro.`, M, y)
    y += 6
  }

  // ── 3. Conceptos ejecutados ──────────────────────────────────────────────
  // Columnas: concepto | unidad | P.U. | contrato | ant. | periodo | acum. | importe
  const cX = { con: M + 1, uni: M + 85, pu: M + 112, ctr: M + 129, ant: M + 143, per: M + 156, acu: M + 170, imp: R - 1 }
  const encabezado = () => {
    espacio(12)
    fill(HEAD); doc.rect(M, y, R - M, 6.5, 'F')
    txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
    doc.text('CONCEPTO', cX.con, y + 4.3)
    doc.text('UNIDAD', cX.uni, y + 4.3)
    doc.text('P.U.', cX.pu, y + 4.3, { align: 'right' })
    doc.text('CONTR.', cX.ctr, y + 4.3, { align: 'right' })
    doc.text('ANT.', cX.ant, y + 4.3, { align: 'right' })
    doc.text('PERIODO', cX.per, y + 4.3, { align: 'right' })
    doc.text('ACUM.', cX.acu, y + 4.3, { align: 'right' })
    doc.text('IMPORTE', cX.imp, y + 4.3, { align: 'right' })
    y += 6.5
  }
  const renglon = (it: any, z: boolean) => {
    const nombre = doc.splitTextToSize(it.concepto || '—', 80)
    const alto = Math.max(6, nombre.length * 3.4 + 2.6)
    espacio(alto + 4)
    if (z) { fill(ZEBRA); doc.rect(M, y, R - M, alto, 'F') }
    txt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    doc.text(nombre, cX.con, y + 4)
    txt(GRAY); doc.setFontSize(6.8)
    doc.text(String(it.unidad || '—'), cX.uni, y + 4)
    doc.text(money(it.precio_unitario), cX.pu, y + 4, { align: 'right' })
    doc.text(qty(it.cant_contratada), cX.ctr, y + 4, { align: 'right' })
    doc.text(qty(it.cant_anterior), cX.ant, y + 4, { align: 'right' })
    txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    doc.text(qty(it.cant_periodo), cX.per, y + 4, { align: 'right' })
    doc.setFont('helvetica', 'normal'); txt(GRAY); doc.setFontSize(6.8)
    doc.text(qty(n(it.cant_anterior) + n(it.cant_periodo)), cX.acu, y + 4, { align: 'right' })
    txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    doc.text(money(impDe(it)), cX.imp, y + 4, { align: 'right' })
    y += alto
  }

  titulo('Conceptos ejecutados en el periodo')
  if (deContrato.length === 0) {
    txt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(8)
    doc.text('Sin avance de contrato en este periodo.', M, y + 3); y += 10
  } else {
    const areas = new Map<string, any[]>()
    for (const it of deContrato) {
      const a = it.area || 'GENERAL'
      const arr = areas.get(a); if (arr) arr.push(it); else areas.set(a, [it])
    }
    let z = false
    areas.forEach((renglones, area) => {
      espacio(18)
      txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
      doc.text(area.toUpperCase(), M, y + 3.5)
      const subArea = renglones.reduce((s, i) => s + impDe(i), 0)
      doc.text(money(subArea), R, y + 3.5, { align: 'right' })
      y += 6
      fill([220, 222, 222]); doc.rect(M, y, R - M, 0.3, 'F'); y += 1.5
      encabezado()
      for (const it of renglones) { renglon(it, z); z = !z }
      y += 3
    })
    espacio(10)
    fill(HEAD); doc.rect(M, y, R - M, 7, 'F')
    txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    doc.text('SUBTOTAL OBRA CONTRATADA', M + 2, y + 4.7)
    doc.text(money(subContrato), R - 1, y + 4.7, { align: 'right' })
    y += 12
  }

  // ── 4. Extras ────────────────────────────────────────────────────────────
  if (deExtras.length > 0) {
    titulo('Extras y deductivas del periodo')
    txt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(7)
    doc.text('Trabajos fuera del alcance contratado, presentados por separado para su autorización.', M, y + 2)
    y += 7
    encabezado()
    let z = false
    for (const it of deExtras) {
      const esDed = it.origen === 'deductiva'
      const nombre = doc.splitTextToSize((esDed ? '(Deductiva) ' : '') + (it.concepto || '—'), 80)
      const alto = Math.max(6, nombre.length * 3.4 + 2.6)
      espacio(alto + 4)
      if (z) { fill(ZEBRA); doc.rect(M, y, R - M, alto, 'F') }
      txt(esDed ? [180, 40, 40] : AMBER); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      doc.text(nombre, cX.con, y + 4)
      txt(GRAY); doc.setFontSize(6.8)
      doc.text(String(it.unidad || '—'), cX.uni, y + 4)
      doc.text(money(it.precio_unitario), cX.pu, y + 4, { align: 'right' })
      doc.text('—', cX.ctr, y + 4, { align: 'right' })
      doc.text('—', cX.ant, y + 4, { align: 'right' })
      txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
      doc.text(qty(it.cant_periodo), cX.per, y + 4, { align: 'right' })
      doc.setFont('helvetica', 'normal'); txt(GRAY); doc.setFontSize(6.8)
      doc.text(qty(it.cant_periodo), cX.acu, y + 4, { align: 'right' })
      txt(esDed ? [180, 40, 40] : AMBER); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
      doc.text(money(impDe(it)), cX.imp, y + 4, { align: 'right' })
      y += alto; z = !z
    }
    espacio(10)
    fill(HEAD); doc.rect(M, y, R - M, 7, 'F')
    txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    doc.text('SUBTOTAL EXTRAS Y DEDUCTIVAS', M + 2, y + 4.7)
    doc.text(money(subExtras + subDeduct), R - 1, y + 4.7, { align: 'right' })
    y += 12
  }

  // ── 5. Resumen de cobro ──────────────────────────────────────────────────
  espacio(70)
  titulo('Resumen de cobro')
  const xL = R - 85
  const linea = (k: string, v: number, bold = false, color: [number, number, number] = DARK) => {
    txt(bold ? DARK : GRAY); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 9 : 8)
    doc.text(k, xL, y)
    txt(color); doc.setFont('helvetica', 'bold')
    doc.text(money(v), R, y, { align: 'right' })
    y += bold ? 6.5 : 5.5
  }
  linea('Obra contratada ejecutada', subContrato)
  if (subDeduct !== 0) linea('Deductivas', subDeduct, false, [180, 40, 40])
  if (descuento !== 0) linea(`Descuento de contrato (${n(d.descuentoPct)}%)`, descuento, false, [180, 40, 40])
  if (subExtras !== 0) linea('Extras', subExtras, false, AMBER)
  fill([220, 222, 222]); doc.rect(xL, y - 3, R - xL, 0.3, 'F'); y += 1
  linea('Subtotal', subtotal, true)
  if (amortizacion !== 0) {
    const pctEfectivo = subtotal > 0 ? Math.abs(amortizacion) / subtotal * 100 : n(d.amortizacionPct)
    linea(`Amortización de anticipo (${pctEfectivo.toFixed(2)}%)`, amortizacion)
  }
  linea('Base gravable', base)
  linea(`IVA ${n(d.ivaPct)}%`, iva)
  fill(DARK); doc.rect(xL, y - 3, R - xL, 0.6, 'F'); y += 2
  txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('TOTAL A PAGAR', xL, y + 2)
  txt(GREEN); doc.text(money(total) + ' ' + d.moneda, R, y + 2, { align: 'right' })
  y += 7
  txt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(7)
  doc.text(`(${montoConLetra(total, d.moneda)})`, R, y + 2, { align: 'right', maxWidth: R - xL + 40 })
  y += 10

  if (d.notas) {
    espacio(20)
    txt(GRAY); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    doc.text('OBSERVACIONES', M, y); y += 4
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    const t = doc.splitTextToSize(d.notas, R - M)
    doc.text(t, M, y); y += t.length * 3.6 + 4
  }

  // ── 6. Firmas ────────────────────────────────────────────────────────────
  espacio(34)
  y += 10
  const firmas = ['Elaboró — OMM Technologies', 'Revisó — Supervisión de obra', 'Autorizó — Cliente']
  const anchoF = (R - M) / 3
  firmas.forEach((f, i) => {
    const x = M + i * anchoF
    fill(DARK); doc.rect(x + 5, y, anchoF - 14, 0.3, 'F')
    txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    doc.text(f, x + anchoF / 2 - 5, y + 4, { align: 'center' })
    doc.setFontSize(6)
    doc.text('Nombre y firma', x + anchoF / 2 - 5, y + 7.5, { align: 'center' })
  })
  y += 16
  txt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5)
  doc.text(
    'Este documento ampara únicamente los trabajos ejecutados en el periodo indicado. Los conceptos del contrato sin avance en el periodo no se listan; su saldo se refleja en el bloque de avance del contrato. Los extras requieren autorización expresa del cliente y no sustituyen al contrato original.',
    M, y, { maxWidth: R - M },
  )

  pie()
  return doc
}
