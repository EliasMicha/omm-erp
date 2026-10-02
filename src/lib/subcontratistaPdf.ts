// Estado de cuenta de un subcontratista — el documento que se le manda a el.
//
// Elias: "dejame bajar un pdf para mandarselo al respectivo contratista".
//
// Es un documento que sale de OMM hacia un tercero, asi que lleva SOLO lo que a
// el le toca ver: su contrato, cada abono con fecha y concepto, y el saldo. No
// lleva el comparativo contra catalogo, ni el margen, ni sus otras obras.
//
// El renglon de nomina va con nombre y monto a proposito: es justo lo que hay
// que poder discutir con el. "Te pague a Gaudencio $2,205.28 el 23 de
// septiembre y eso baja tu saldo" solo se sostiene si el papel lo dice.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { OMNIIOUS_LOGO } from '../assets/logo'

export interface MovimientoSubcontrato {
  fecha: string | null
  tipo: 'cargo' | 'abono'
  origen: string            // contrato | nomina | pago_efectivo | pago_transferencia | ...
  concepto: string
  persona?: string | null
  monto: number             // cargos positivos, abonos negativos
  moneda: string
}

export interface DatosEstadoSubcontrato {
  folio: string
  subcontratista: string
  obra?: string | null
  descripcion?: string | null
  moneda: 'MXN' | 'USD'
  contrato: number
  pagadoDirecto: number
  pagadoNomina: number
  saldo: number
  movimientos: MovimientoSubcontrato[]
}

const fmtFecha = (iso?: string | null) => {
  if (!iso) return 'Sin fecha'
  try {
    // Fecha suelta (YYYY-MM-DD): se parte a mano. new Date('2026-09-23') la lee
    // como UTC y en Mexico la retrocede un dia.
    const [a, m, d] = iso.slice(0, 10).split('-').map(Number)
    return new Date(a, m - 1, d).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return iso }
}

const fmtMoney = (n: number, moneda: string) =>
  (moneda === 'USD' ? 'USD $' : '$') +
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const ETIQUETA_ORIGEN: Record<string, string> = {
  contrato: 'Contrato',
  nomina: 'Nómina de su gente',
  pago_efectivo: 'Efectivo',
  pago_transferencia: 'Transferencia',
  pago_cheque: 'Cheque',
  pago_tarjeta: 'Tarjeta',
  pago_otro: 'Otro',
}

/** Arma el documento y lo devuelve. Separado de la descarga a proposito: asi se
 *  puede construir fuera del navegador para revisarlo antes de soltarlo. */
export function construirEstadoSubcontratoPdf(d: DatosEstadoSubcontrato): jsPDF {
  return armar(d)
}

/** Lo arma y lo baja. Es lo que llama el boton. */
export function generarEstadoSubcontratoPdf(d: DatosEstadoSubcontrato) {
  const doc = armar(d)
  const limpio = d.subcontratista.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
  doc.save(`EstadoCuenta_${limpio}_${d.folio}.pdf`)
}

function armar(d: DatosEstadoSubcontrato): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 18
  const contentW = pageW - margin * 2
  let y = margin

  const logoW = 18
  const logoH = logoW / 1.15
  try { doc.addImage(OMNIIOUS_LOGO, 'JPEG', margin, y, logoW, logoH) } catch { /* sin logo */ }

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 30)
  doc.text('Estado de Cuenta', pageW - margin, y + 6, { align: 'right' })

  doc.setFontSize(20)
  doc.setTextColor(0, 120, 80)
  doc.text(d.folio, pageW - margin, y + 14, { align: 'right' })

  y += Math.max(logoH + 4, 22)
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.line(margin, y, pageW - margin, y)
  y += 6

  // ── Encabezado de dos columnas ──
  const info: string[][] = [
    ['Subcontratista', d.subcontratista],
    ['Obra', d.obra || '--'],
  ]
  if (d.descripcion) info.push(['Concepto', d.descripcion])
  info.push(['Moneda', d.moneda])
  info.push(['Fecha de corte', fmtFecha(new Date().toISOString())])

  doc.setFontSize(8)
  for (const [label, valor] of info) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 100, 100)
    doc.text(label.toUpperCase(), margin, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(40, 40, 40)
    const lineas = doc.splitTextToSize(String(valor), contentW - 42)
    doc.text(lineas, margin + 42, y)
    y += 4.5 * Math.max(1, lineas.length)
  }
  y += 4

  // ── Resumen ──
  const caja = (x: number, w: number, etiqueta: string, valor: number, destacado = false) => {
    doc.setDrawColor(220, 220, 220)
    doc.setFillColor(destacado ? 245 : 250, destacado ? 250 : 250, destacado ? 246 : 250)
    doc.roundedRect(x, y, w, 16, 1.5, 1.5, 'FD')
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(120, 120, 120)
    doc.text(etiqueta.toUpperCase(), x + 3, y + 5)
    doc.setFontSize(11)
    doc.setTextColor(destacado ? 0 : 40, destacado ? 120 : 40, destacado ? 80 : 40)
    doc.text(fmtMoney(valor, d.moneda), x + 3, y + 12)
  }
  const anchoCaja = (contentW - 9) / 4
  caja(margin, anchoCaja, 'Contrato', d.contrato)
  caja(margin + anchoCaja + 3, anchoCaja, 'Pagos directos', d.pagadoDirecto)
  caja(margin + (anchoCaja + 3) * 2, anchoCaja, 'Vía nómina', d.pagadoNomina)
  caja(margin + (anchoCaja + 3) * 3, anchoCaja, 'Saldo', d.saldo, true)
  y += 22

  // ── Movimientos, con saldo corrido ──
  // El saldo corrido es lo que vuelve discutible un estado de cuenta: sin el,
  // el otro tiene que rehacer la suma para saber si coincide.
  const movs = [...d.movimientos].sort((a, b) => {
    // Sin fecha se va al final: con '' se colaba arriba del contrato y el saldo
    // corrido arrancaba en negativo.
    const fa = a.fecha || '9999-12-31', fb = b.fecha || '9999-12-31'
    if (fa !== fb) return fa.localeCompare(fb)
    return a.tipo === 'cargo' ? -1 : 1
  })
  let corrido = 0
  const cuerpo = movs.map(m => {
    corrido += Number(m.monto) || 0
    return [
      fmtFecha(m.fecha),
      ETIQUETA_ORIGEN[m.origen] || m.origen,
      m.concepto,
      m.tipo === 'cargo' ? fmtMoney(m.monto, d.moneda) : '',
      m.tipo === 'abono' ? fmtMoney(Math.abs(m.monto), d.moneda) : '',
      fmtMoney(corrido, d.moneda),
    ]
  })

  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Tipo', 'Concepto', 'Cargo', 'Abono', 'Saldo']],
    body: cuerpo,
    margin: { left: margin, right: margin },
    styles: { fontSize: 7.5, cellPadding: 2, textColor: [40, 40, 40], lineColor: [220, 220, 220], lineWidth: 0.2 },
    headStyles: { fillColor: [30, 30, 30], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 28 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 26, halign: 'right' },
      4: { cellWidth: 26, halign: 'right' },
      5: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
    },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    didDrawPage: () => {
      const pageH = doc.internal.pageSize.getHeight()
      doc.setFontSize(7)
      doc.setTextColor(160, 160, 160)
      doc.text(`${d.folio} — OMM Technologies`, margin, pageH - 8)
      doc.text(`Página ${doc.getNumberOfPages()}`, pageW - margin, pageH - 8, { align: 'right' })
    },
  })

  y = (doc as any).lastAutoTable.finalY + 8

  // ── Saldo final, alineado a la derecha ──
  const pageH = doc.internal.pageSize.getHeight()
  if (y > pageH - 50) { doc.addPage(); y = margin }
  doc.setDrawColor(200, 200, 200)
  doc.line(pageW - margin - 70, y, pageW - margin, y)
  y += 6
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 30)
  doc.text('SALDO A LA FECHA', pageW - margin - 70, y)
  doc.setTextColor(0, 120, 80)
  doc.text(fmtMoney(d.saldo, d.moneda), pageW - margin, y, { align: 'right' })
  y += 10

  // ── La nota que evita la discusion ──
  if (d.pagadoNomina > 0) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 100, 100)
    doc.text('SOBRE LOS PAGOS VÍA NÓMINA', margin, y)
    y += 4.5
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    const nota = doc.splitTextToSize(
      'Su personal está dado de alta en la nómina de OMM Technologies por el requisito de seguro de la obra. ' +
      'El neto que se le entrega a cada persona se descuenta de este saldo, con el nombre y la fecha de cada pago en la tabla de arriba. ' +
      'Las cuotas patronales no se le descuentan.', contentW)
    doc.text(nota, margin, y)
    y += nota.length * 4 + 6
  }

  // ── Conformidad ──
  if (y > pageH - 32) { doc.addPage(); y = margin }
  doc.setFontSize(8)
  doc.setTextColor(100, 100, 100)
  doc.text('Si algún movimiento no coincide con sus registros, avísenos antes del siguiente pago.', margin, y)
  y += 14
  doc.setDrawColor(180, 180, 180)
  doc.line(margin, y, margin + 65, y)
  doc.line(pageW - margin - 65, y, pageW - margin, y)
  y += 4
  doc.setFontSize(7)
  doc.setTextColor(120, 120, 120)
  doc.text('OMM Technologies', margin, y)
  doc.text('Recibí de conformidad', pageW - margin, y, { align: 'right' })

  return doc
}
