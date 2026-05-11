import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { OMNIIOUS_LOGO } from '../assets/logo'

// ─── Types (mirrors Compras.tsx) ──────────────────────────────────────────────

interface POForPdf {
  po_number: string
  created_at: string
  status: string
  specialty: string
  purchase_phase?: string
  currency: 'MXN' | 'USD'
  subtotal: number
  iva: number
  total: number
  notes?: string
  supplier_doc_number?: string
  expected_delivery?: string
  supplier?: { name: string; contact_name?: string; contact_phone?: string; contact_email?: string; rfc?: string; address?: string }
  project?: { name: string; client_name?: string }
  quotation?: { name: string }
}

interface POItemForPdf {
  name: string
  description?: string
  system?: string
  unit: string
  quantity: number
  unit_cost: number
  total: number
  marca?: string
  modelo?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso?: string | null): string {
  if (!iso) return '--'
  try {
    return new Date(iso).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return iso }
}

function fmtMoney(n: number, currency: string): string {
  const symbol = currency === 'USD' ? 'USD $' : '$'
  return symbol + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUS_LABELS: Record<string, string> = {
  borrador: 'Borrador', aprobada: 'Aprobada', pedida: 'Pedida',
  recibida_parcial: 'Parcial', recibida: 'Recibida', cancelada: 'Cancelada',
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function generatePOPdf(po: POForPdf, items: POItemForPdf[]) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 18
  const contentW = pageW - margin * 2
  let y = margin

  // ── Logo ──
  try {
    doc.addImage(OMNIIOUS_LOGO, 'JPEG', margin, y, 36, 10)
  } catch { /* skip if logo fails */ }

  // ── Title ──
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 30)
  doc.text('Orden de Compra', pageW - margin, y + 6, { align: 'right' })

  doc.setFontSize(20)
  doc.setTextColor(0, 120, 80)
  doc.text(po.po_number, pageW - margin, y + 14, { align: 'right' })

  y += 22

  // ── Separator ──
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.line(margin, y, pageW - margin, y)
  y += 6

  // ── Info columns ──
  const col1X = margin
  const col2X = margin + contentW * 0.55

  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  doc.setFont('helvetica', 'normal')

  // Left column — PO info
  const infoLeft = [
    ['Estado', STATUS_LABELS[po.status] || po.status],
    ['Fecha', fmtDate(po.created_at)],
    ['Moneda', po.currency],
    ['Especialidad', po.specialty],
  ]
  if (po.purchase_phase) infoLeft.push(['Fase', po.purchase_phase])
  if (po.supplier_doc_number) infoLeft.push(['Doc proveedor', po.supplier_doc_number])
  if (po.expected_delivery) infoLeft.push(['Entrega esperada', fmtDate(po.expected_delivery)])
  if (po.quotation?.name) infoLeft.push(['Cotizacion', po.quotation.name])
  if (po.project?.name) infoLeft.push(['Proyecto', po.project.name])

  let yInfo = y
  for (const [label, value] of infoLeft) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 100, 100)
    doc.text(label.toUpperCase(), col1X, yInfo)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(40, 40, 40)
    doc.text(value || '--', col1X + 30, yInfo)
    yInfo += 4.5
  }

  // Right column — Supplier info
  const sup = po.supplier
  if (sup) {
    let ySup = y
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(40, 40, 40)
    doc.text('PROVEEDOR', col2X, ySup)
    ySup += 5

    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(sup.name || '', col2X, ySup)
    ySup += 5

    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80, 80, 80)
    if (sup.rfc) { doc.text(`RFC: ${sup.rfc}`, col2X, ySup); ySup += 4 }
    if (sup.contact_name) { doc.text(`Contacto: ${sup.contact_name}`, col2X, ySup); ySup += 4 }
    if (sup.contact_phone) { doc.text(`Tel: ${sup.contact_phone}`, col2X, ySup); ySup += 4 }
    if (sup.contact_email) { doc.text(`Email: ${sup.contact_email}`, col2X, ySup); ySup += 4 }
    if (sup.address) {
      const lines = doc.splitTextToSize(sup.address, contentW * 0.4)
      doc.text(lines, col2X, ySup)
      ySup += lines.length * 3.5
    }
    yInfo = Math.max(yInfo, ySup)
  }

  y = yInfo + 6

  // ── Items table ──
  const tableHead = [['#', 'Marca', 'Modelo', 'Descripción', 'Unidad', 'Cant', 'P. Unitario', 'Total']]
  const tableBody = items.map((it, i) => [
    String(i + 1),
    it.marca || '--',
    it.modelo || '--',
    it.name || '',
    it.unit,
    String(it.quantity),
    fmtMoney(it.unit_cost, po.currency),
    fmtMoney(it.total, po.currency),
  ])

  autoTable(doc, {
    startY: y,
    head: tableHead,
    body: tableBody,
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      textColor: [40, 40, 40],
      lineColor: [220, 220, 220],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [30, 30, 30],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 22 },
      2: { cellWidth: 22 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 14, halign: 'center' },
      5: { cellWidth: 12, halign: 'center' },
      6: { cellWidth: 26, halign: 'right' },
      7: { cellWidth: 26, halign: 'right' },
    },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    didDrawPage: (data: any) => {
      // Footer on every page
      const pageH = doc.internal.pageSize.getHeight()
      doc.setFontSize(7)
      doc.setTextColor(160, 160, 160)
      doc.text(`${po.po_number} — OMM Technologies`, margin, pageH - 8)
      doc.text(`Pagina ${doc.getNumberOfPages()}`, pageW - margin, pageH - 8, { align: 'right' })
    },
  })

  // ── Totals ──
  y = (doc as any).lastAutoTable?.finalY + 4 || y + 40
  const totalsX = pageW - margin - 60

  const totals = [
    ['Subtotal', fmtMoney(po.subtotal, po.currency)],
    ['IVA (16%)', fmtMoney(po.iva, po.currency)],
    ['TOTAL', fmtMoney(po.total, po.currency)],
  ]

  for (const [label, value] of totals) {
    const isBold = label === 'TOTAL'
    doc.setFontSize(isBold ? 10 : 8)
    doc.setFont('helvetica', isBold ? 'bold' : 'normal')
    doc.setTextColor(isBold ? 0 : 80, isBold ? 100 : 80, isBold ? 60 : 80)
    doc.text(label, totalsX, y, { align: 'right' })
    doc.setTextColor(isBold ? 0 : 40, isBold ? 80 : 40, isBold ? 50 : 40)
    doc.text(value, pageW - margin, y, { align: 'right' })
    if (isBold) {
      doc.setDrawColor(0, 120, 80)
      doc.setLineWidth(0.5)
      doc.line(totalsX + 2, y + 1.5, pageW - margin, y + 1.5)
    }
    y += isBold ? 6 : 5
  }

  // ── Notes ──
  if (po.notes) {
    y += 4
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 100, 100)
    doc.text('NOTAS', margin, y)
    y += 4
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    const noteLines = doc.splitTextToSize(po.notes, contentW)
    doc.text(noteLines, margin, y)
  }

  // ── Download ──
  doc.save(`${po.po_number}.pdf`)
}
