// ═══════════════════════════════════════════════════════════════════════════
// Cotización en PDF — formato de la casa, igual que la estimación.
//
// Antes esto era `window.open()` + `window.print()` de un HTML suelto. El
// navegador le estampaba encima su propio encabezado y su pie con la URL
// (`https://omm-erp.vercel.app/cotizaciones · Page 1 of 1`), y el documento que
// le llegaba al cliente decía a gritos "esto es una página web impresa". Aquí
// se dibuja el PDF a mano con jsPDF: sin cromo del navegador, con membrete,
// folio, vigencia, importe con letra y condiciones comerciales.
//
// Es genérico a propósito: los totales entran como lista, así el mismo formato
// sirve para distribución, cortinas y mantenimiento sin duplicar el diseño.
// ═══════════════════════════════════════════════════════════════════════════
import jsPDF from 'jspdf'
import { montoConLetra } from './reciboEfectivo'

const EMPRESA = 'OMM TECHNOLOGIES S.A. DE C.V.'
const RFC = 'OTE210910PW5'

export interface PartidaCot {
  name: string
  marca?: string | null
  modelo?: string | null
  cantidad: number
  unidad?: string | null
  precioUnitario: number
}

export interface RenglonTotal {
  label: string
  monto: number
  /** 'resta' pinta el monto en rojo con signo; 'fuerte' lo destaca sin ser el total. */
  tono?: 'normal' | 'resta' | 'fuerte'
}

export interface DatosCotizacionPdf {
  /** Lo que va bajo el título: "Cotización de distribución", etc. */
  tipo: string
  /** Identificador estable del documento; si falta se arma con el id. */
  folio: string
  nombre: string
  cliente?: string | null
  atencion?: string | null
  proyecto?: string | null
  fecha?: string | null
  vigenciaDias?: number
  moneda: string
  tipoCambio?: number | null
  partidas: PartidaCot[]
  totales: RenglonTotal[]
  total: number
  /** Renglones extra de condiciones, además de las de casa. */
  condiciones?: string[]
  elaboro?: string | null
  notaPie?: string | null
}

/** Folio legible y estable a partir del id de la cotización. */
export const folioDeCotizacion = (id: string, anio?: number | null, version?: string | null) =>
  `COT-${anio || new Date().getFullYear()}-${String(id || '').replace(/-/g, '').slice(0, 6).toUpperCase()}${version ? `-${version}` : ''}`

export function generarCotizacionPdf(d: DatosCotizacionPdf): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const M = 15
  const R = W - M
  let y = 18

  const GREEN: [number, number, number] = [16, 185, 129]
  const DARK: [number, number, number] = [26, 26, 26]
  const GRAY: [number, number, number] = [120, 120, 120]
  const LINEA: [number, number, number] = [226, 228, 227]
  const ZEBRA: [number, number, number] = [248, 249, 249]
  const ROJO: [number, number, number] = [190, 40, 40]

  const txt = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const simbolo = d.moneda === 'USD' ? 'US$' : '$'
  const money = (n: number) => simbolo + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fechaLarga = (s?: string | null) => {
    const base = s ? new Date(String(s).slice(0, 10) + 'T12:00:00') : new Date()
    return base.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
  }
  const masDias = (s: string | null | undefined, dias: number) => {
    const base = s ? new Date(String(s).slice(0, 10) + 'T12:00:00') : new Date()
    base.setDate(base.getDate() + dias)
    return base.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
  }

  const nuevaPagina = () => { doc.addPage(); y = 18; encabezadoTabla() }
  const espacio = (need: number) => { if (y + need > 250) nuevaPagina() }

  // ── Membrete ─────────────────────────────────────────────────────────────
  txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  doc.text('OMM', M, y)
  fill(GREEN); doc.rect(M + 20.5, y - 4.2, 4, 4, 'F')
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); txt(GRAY)
  doc.text(`${EMPRESA} · RFC ${RFC}`, M, y + 5)

  txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('COTIZACIÓN', R, y, { align: 'right' })
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); txt(GRAY)
  doc.text(d.folio, R, y + 5, { align: 'right' })
  y += 10
  fill(DARK); doc.rect(M, y, R - M, 0.8, 'F'); y += 8

  // ── Bloque de datos: a quién va y bajo qué condiciones ───────────────────
  const cajaH = 26
  fill([250, 250, 250]); doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2])
  doc.rect(M, y, R - M, cajaH, 'FD')
  const colB = M + (R - M) * 0.55
  doc.setLineWidth(0.2); doc.line(colB - 4, y + 3, colB - 4, y + cajaH - 3)

  const campo = (etiqueta: string, valor: string, x: number, yy: number, ancho: number) => {
    txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
    doc.text(etiqueta.toUpperCase(), x, yy)
    txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text(doc.splitTextToSize(valor || '—', ancho)[0], x, yy + 4)
  }
  // El nombre de la cotizacion casi siempre empieza con el del cliente
  // ("Manuel Casas - Lutron - Botoneras Seetouch"). Repetirlo debajo del
  // cliente no informa; se recorta el prefijo y queda el concepto real.
  const sinPrefijoCliente = (n: string) => {
    const t = String(n || '').trim()
    const c = String(d.cliente || '').trim()
    if (c && t.toLowerCase().startsWith(c.toLowerCase())) {
      const resto = t.slice(c.length).replace(/^\s*[-·–—]\s*/, '').trim()
      if (resto) return resto
    }
    return t
  }
  const concepto = sinPrefijoCliente(d.nombre)
  const anchoIzq = colB - M - 10
  campo('Cliente', d.cliente || '—', M + 4, y + 6, anchoIzq)
  campo(d.atencion ? 'Atención' : 'Concepto', d.atencion || concepto, M + 4, y + 15, anchoIzq)
  const extra = d.proyecto && d.proyecto.trim().toLowerCase() !== concepto.toLowerCase() ? d.proyecto : ''
  if (extra) {
    txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    doc.text(doc.splitTextToSize(extra, anchoIzq)[0], M + 4, y + 23)
  }

  const anchoDer = R - colB - 4
  campo('Fecha', fechaLarga(d.fecha), colB, y + 6, anchoDer)
  campo('Vigencia', masDias(d.fecha, d.vigenciaDias ?? 15), colB, y + 15, anchoDer)
  txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text(`Moneda: ${d.moneda}${d.tipoCambio ? `  ·  TC pactado ${d.tipoCambio}` : ''}`, colB, y + 23)
  y += cajaH + 8

  // ── Tabla de partidas ────────────────────────────────────────────────────
  // Anchos fijos: la descripción se queda con lo que sobra.
  const cX = { num: M + 2, desc: M + 10, marca: R - 84, cant: R - 56, pu: R - 30, imp: R }
  const anchoDesc = cX.marca - cX.desc - 4

  function encabezadoTabla() {
    fill(DARK); doc.rect(M, y, R - M, 7, 'F')
    fill(GREEN); doc.rect(M, y, 2, 7, 'F')
    txt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    doc.text('#', cX.num + 2, y + 4.7)
    doc.text('DESCRIPCIÓN', cX.desc, y + 4.7)
    doc.text('MARCA', cX.marca, y + 4.7)
    doc.text('CANT.', cX.cant, y + 4.7, { align: 'right' })
    doc.text('P. UNITARIO', cX.pu, y + 4.7, { align: 'right' })
    doc.text('IMPORTE', cX.imp, y + 4.7, { align: 'right' })
    y += 7
  }
  encabezadoTabla()

  d.partidas.forEach((p, i) => {
    // El modelo solo baja como segundo renglón si dice algo distinto al nombre:
    // repetir "HQWD-W6BRL-WH" bajo "HQWD-W6BRL-WH" no informa, ensucia.
    const modelo = (p.modelo || '').trim()
    const nombre = (p.name || '').trim()
    const traeModelo = !!modelo && modelo.toLowerCase() !== nombre.toLowerCase()
    const lineas = doc.splitTextToSize(nombre || '—', anchoDesc) as string[]
    const alto = Math.max(9, lineas.length * 4 + (traeModelo ? 4 : 0) + 4)
    espacio(alto + 4)

    if (i % 2 === 1) { fill(ZEBRA); doc.rect(M, y, R - M, alto, 'F') }
    txt([150, 150, 150]); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    doc.text(String(i + 1), cX.num + 2, y + 5.4)

    txt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    lineas.forEach((l, k) => doc.text(l, cX.desc, y + 5.4 + k * 4))
    if (traeModelo) {
      txt(GRAY); doc.setFontSize(7)
      doc.text(`Modelo ${modelo}`, cX.desc, y + 5.4 + lineas.length * 4)
    }

    txt([90, 90, 90]); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.text(String(p.marca || '—').slice(0, 16), cX.marca, y + 5.4)
    doc.text(`${p.cantidad}${p.unidad ? ' ' + p.unidad : ''}`, cX.cant, y + 5.4, { align: 'right' })
    doc.text(money(p.precioUnitario), cX.pu, y + 5.4, { align: 'right' })
    txt(DARK); doc.setFont('helvetica', 'bold')
    doc.text(money(p.precioUnitario * p.cantidad), cX.imp, y + 5.4, { align: 'right' })

    doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]); doc.setLineWidth(0.2)
    doc.line(M, y + alto, R, y + alto)
    y += alto
  })
  // Cierra la tabla: con una sola partida, sin esta linea los totales quedaban
  // flotando en medio de la hoja.
  fill([200, 203, 202]); doc.rect(M, y, R - M, 0.5, 'F')
  y += 7

  // ── Totales ──────────────────────────────────────────────────────────────
  const totW = 82
  const totX = R - totW
  espacio(d.totales.length * 5.5 + 30)
  d.totales.forEach(t => {
    const esResta = t.tono === 'resta'
    txt(esResta ? ROJO : [90, 90, 90])
    doc.setFont('helvetica', t.tono === 'fuerte' ? 'bold' : 'normal'); doc.setFontSize(8.5)
    doc.text(t.label, totX, y + 3.5)
    txt(esResta ? ROJO : DARK); doc.setFont('helvetica', t.tono === 'normal' ? 'normal' : 'bold')
    // Guion normal, no el signo menos tipografico: Helvetica en WinAnsi no lo
    // trae y jsPDF lo pinta como una comilla ("$59,555.25).
    doc.text((esResta ? '-' : '') + money(Math.abs(t.monto)), R, y + 3.5, { align: 'right' })
    y += 5.5
  })

  y += 1.5
  fill(DARK); doc.rect(totX - 4, y, totW + 4, 10, 'F')
  fill(GREEN); doc.rect(totX - 4, y, 2, 10, 'F')
  txt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('TOTAL', totX + 1, y + 6.4)
  doc.setFontSize(12)
  doc.text(`${money(d.total)} ${d.moneda}`, R - 3, y + 6.6, { align: 'right' })
  y += 14

  // Importe con letra: se pide en cualquier documento formal en México y evita
  // discusiones sobre un punto decimal mal leído.
  espacio(12)
  txt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5)
  const letra = doc.splitTextToSize('Importe con letra: ' + montoConLetra(d.total, d.moneda), R - M) as string[]
  letra.slice(0, 2).forEach((l, k) => doc.text(l, M, y + k * 3.6))
  y += letra.slice(0, 2).length * 3.6 + 6

  // ── Condiciones comerciales ──────────────────────────────────────────────
  const condiciones = [
    `Vigencia de la oferta: ${d.vigenciaDias ?? 15} días naturales a partir de la fecha de esta cotización.`,
    'Precios sujetos a disponibilidad de existencias al momento del pedido.',
    ...(d.moneda === 'USD' ? ['Los precios en dólares se facturan al tipo de cambio pactado en esta cotización.'] : []),
    ...(d.condiciones || []),
  ]
  espacio(condiciones.length * 4.2 + 16)
  fill(DARK); doc.rect(M, y, R - M, 6, 'F')
  fill(GREEN); doc.rect(M, y, 2, 6, 'F')
  txt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
  doc.text('CONDICIONES COMERCIALES', M + 5, y + 4.1)
  y += 9
  txt([90, 90, 90]); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  condiciones.forEach(c => {
    const ls = doc.splitTextToSize(c, R - M - 5) as string[]
    ls.forEach((l, k) => doc.text((k === 0 ? '·  ' : '   ') + l, M, y))
    y += ls.length * 4.2
  })

  if (d.notaPie) {
    y += 3
    txt(GRAY); doc.setFontSize(7.5)
    doc.splitTextToSize(d.notaPie, R - M).forEach((l: string) => { doc.text(l, M, y); y += 3.6 })
  }

  // ── Firma ────────────────────────────────────────────────────────────────
  espacio(24)
  y += 10
  doc.setDrawColor(160, 160, 160); doc.setLineWidth(0.3)
  doc.line(M, y, M + 62, y)
  txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  doc.text(d.elaboro || 'OMM Technologies', M, y + 4.5)
  txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text('Elaboró', M, y + 8.5)

  // ── Pie en todas las páginas ─────────────────────────────────────────────
  const paginas = (doc as any).internal.getNumberOfPages()
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p)
    fill(GREEN); doc.rect(M, 264, R - M, 0.5, 'F')
    txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    // Dos bloques y no tres: con el centro, el RFC y el tipo se encimaban.
    doc.text(`${EMPRESA} · RFC ${RFC}`, M, 269)
    doc.text(`${d.tipo} · ${d.folio} · Pág. ${p}/${paginas}`, R, 269, { align: 'right' })
  }

  return doc
}
