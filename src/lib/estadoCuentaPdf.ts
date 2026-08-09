// Estado de cuenta en PDF — fuente ÚNICA usada por el CRM (LeadDashboard) y por Cobranza.
// Devuelve el documento jsPDF (sin guardar); el que llama decide save() o output('datauristring').
import jsPDF from 'jspdf'

interface EstadoCuentaInput {
  lead: { name?: string; company?: string }
  quotations: any[]        // cotizaciones del lead (se filtran stage==='contrato' aquí)
  bankMovements: any[]     // movimientos de banco del lead
  cashMovements: any[]     // movimientos de efectivo del lead
  paymentAllocations: any[]// prorrateos del lead
}

export function generarEstadoCuentaPdf(input: EstadoCuentaInput): jsPDF {
  const { lead, quotations, bankMovements, cashMovements, paymentAllocations } = input

  const getQuotCurrency = (q: any): 'USD' | 'MXN' => {
    try { const n = typeof q.notes === 'string' ? JSON.parse(q.notes) : q.notes; return n?.currency === 'MXN' ? 'MXN' : 'USD' } catch { return 'USD' }
  }
  const quoteFinalConIva = (q: any): number => {
    if (typeof q.total_final === 'number' && !isNaN(q.total_final)) return Number(q.total_final)
    if (q.specialty === 'esp' || q.specialty === 'cort' || q.specialty === 'ilum' || q.specialty === 'proy') return Number(q.total) || 0
    return (Number(q.total) || 0) * 1.16
  }
  function getPagosDeCotizacion(qId: string, cur: string) {
    const allocMovIds = new Set(paymentAllocations.map((pa: any) => pa.bank_movement_id).filter(Boolean))
    const items: { date: string; concepto: string; monto: number; cur: string; tc?: number | null; montoOrigen?: number | null; monedaOrigen?: string | null; source: 'prorrateo' | 'banco' | 'efectivo' }[] = []
    paymentAllocations.filter((pa: any) => pa.quotation_id === qId).forEach((pa: any) => {
      const mov = bankMovements.find((m: any) => m.id === pa.bank_movement_id)
      const cruce = pa.tc_aplicado && pa.monto_origen && pa.moneda_origen && pa.moneda_origen !== cur
      items.push({ date: mov?.fecha || '', concepto: mov?.concepto || 'Pago (prorrateo)', monto: Number(pa.monto) || 0, cur, source: 'prorrateo', tc: cruce ? Number(pa.tc_aplicado) : null, montoOrigen: cruce ? Number(pa.monto_origen) : null, monedaOrigen: cruce ? pa.moneda_origen : null })
    })
    bankMovements.filter((m: any) => m.tipo === 'abono' && m.quotation_id === qId && !allocMovIds.has(m.id) && (m.moneda || 'MXN') === cur)
      .forEach((m: any) => items.push({ date: m.fecha || '', concepto: m.concepto || 'Transferencia', monto: Number(m.monto) || 0, cur, source: 'banco', tc: null, montoOrigen: null, monedaOrigen: null }))
    cashMovements.filter((m: any) => {
      if (m.tipo !== 'cobro_cliente' || m.quotation_id !== qId || allocMovIds.has(m.id)) return false
      const efCur = (m.tc_aplicado && m.moneda_cotizacion) ? m.moneda_cotizacion : (m.moneda || 'MXN')
      return efCur === cur
    }).forEach((m: any) => {
      const cruce = !!(m.tc_aplicado && m.moneda_cotizacion && (m.moneda || 'MXN') !== m.moneda_cotizacion)
      const monto = cruce ? (Number(m.monto_cotizacion) || 0) : (Number(m.monto) || 0)
      items.push({ date: m.fecha || '', concepto: '💵 ' + (m.concepto || m.persona || 'Efectivo'), monto, cur, source: 'efectivo', tc: cruce ? Number(m.tc_aplicado) : null, montoOrigen: cruce ? Number(m.monto) : null, monedaOrigen: cruce ? (m.moneda || 'MXN') : null })
    })
    return items.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const M = 15
  const RIGHT = W - M
  let y = 16

  const GREEN: [number, number, number] = [16, 185, 129]
  const DARK: [number, number, number] = [26, 26, 26]
  const GRAY: [number, number, number] = [120, 120, 120]
  const HEADFILL: [number, number, number] = [238, 241, 240]
  const ZEBRA: [number, number, number] = [248, 249, 249]
  const setTxt = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const setFill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const money = (n: number, cur: string) => (cur === 'USD' ? 'US$' : '$') + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const addPage = () => { doc.addPage(); y = 18 }
  const checkPage = (need: number) => { if (y + need > 258) addPage() }
  const sectionTitle = (t: string) => {
    checkPage(16)
    setFill(DARK); doc.rect(M, y, RIGHT - M, 7, 'F')
    setFill(GREEN); doc.rect(M, y, 2, 7, 'F')
    setTxt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    doc.text(t.toUpperCase(), M + 5, y + 4.8)
    setTxt(DARK); y += 11
  }

  // Encabezado
  setFill(GREEN); doc.rect(M, y, 5, 5, 'F')
  setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('OMM TECHNOLOGIES', M + 7.5, y + 4)
  setTxt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text(new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }), RIGHT, y + 4, { align: 'right' })
  y += 10
  setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  doc.text('Estado de Cuenta', M, y + 2); y += 8
  setTxt([60, 60, 60]); doc.setFont('helvetica', 'normal'); doc.setFontSize(12)
  doc.text(lead.name || 'Sin nombre', M, y + 2); y += 6
  if (lead.company) { setTxt(GRAY); doc.setFontSize(9.5); doc.text(lead.company, M, y + 1); y += 5 }
  setFill(GREEN); doc.rect(M, y + 1, RIGHT - M, 0.8, 'F'); y += 8

  // Datos consolidados
  const contratos = quotations.filter(q => q.stage === 'contrato')
  const resumen = { USD: { vendido: 0, cobrado: 0 }, MXN: { vendido: 0, cobrado: 0 } }
  const quoteData = contratos.map(q => {
    const cur = getQuotCurrency(q)
    const total = quoteFinalConIva(q)
    const pagos = getPagosDeCotizacion(q.id, cur)
    const cobrado = pagos.reduce((s, p) => s + p.monto, 0)
    resumen[cur].vendido += total
    resumen[cur].cobrado += cobrado
    return { q, cur, total, cobrado, pagos }
  })

  // Resumen: tarjetas por moneda
  const curs = (['USD', 'MXN'] as const).filter(c => resumen[c].vendido > 0 || resumen[c].cobrado > 0)
  if (curs.length > 0) {
    const gap = 6
    const cardW = (RIGHT - M - gap * (curs.length - 1)) / curs.length
    const cardH = 30
    checkPage(cardH + 4)
    curs.forEach((c, i) => {
      const x = M + i * (cardW + gap)
      const pend = Math.max(0, resumen[c].vendido - resumen[c].cobrado)
      const pct = resumen[c].vendido > 0 ? resumen[c].cobrado / resumen[c].vendido : 0
      setFill([250, 250, 250]); doc.setDrawColor(225, 228, 227); doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD')
      setFill(c === 'USD' ? [6, 182, 212] : [167, 139, 250]); doc.roundedRect(x + 4, y + 4, 14, 5, 1, 1, 'F')
      setTxt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text(c, x + 11, y + 7.6, { align: 'center' })
      setTxt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      doc.text('GENERAL', x + 21, y + 7.6)
      const line = (label: string, val: string, cc: [number, number, number], yy: number) => {
        setTxt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(label, x + 4, yy)
        setTxt(cc); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(val, x + cardW - 4, yy, { align: 'right' })
      }
      line('Total vendido', money(resumen[c].vendido, c), DARK, y + 15)
      line('Cobrado', money(resumen[c].cobrado, c), GREEN, y + 20.5)
      line('Pendiente', money(pend, c), [217, 119, 6], y + 26)
      setFill([230, 230, 230]); doc.rect(x + 4, y + cardH - 2.5, cardW - 8, 1.4, 'F')
      setFill(GREEN); doc.rect(x + 4, y + cardH - 2.5, (cardW - 8) * Math.min(pct, 1), 1.4, 'F')
    })
    y += cardH + 8
  }

  // Cotizaciones cerradas
  sectionTitle('Cotizaciones cerradas')
  if (quoteData.length === 0) {
    setTxt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.text('Sin cotizaciones cerradas', M + 3, y); y += 8
  } else {
    const cX = { nom: M + 3, esp: 108, mon: 140 }
    setFill(HEADFILL); doc.rect(M, y, RIGHT - M, 6, 'F')
    setTxt(GRAY); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    doc.text('COTIZACIÓN', cX.nom, y + 4); doc.text('ESP.', cX.esp, y + 4); doc.text('MON.', cX.mon, y + 4); doc.text('TOTAL', RIGHT - 3, y + 4, { align: 'right' })
    y += 6
    quoteData.forEach(({ q, cur, total }, i) => {
      checkPage(7)
      if (i % 2 === 1) { setFill(ZEBRA); doc.rect(M, y, RIGHT - M, 6, 'F') }
      setTxt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      doc.text((q.name || '—').substring(0, 46), cX.nom, y + 4)
      setTxt(GRAY); doc.setFontSize(7.5); doc.text((q.specialty || '—').toUpperCase(), cX.esp, y + 4); doc.text(cur, cX.mon, y + 4)
      setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(money(total, cur), RIGHT - 3, y + 4, { align: 'right' })
      y += 6
    })
    y += 6
  }

  // Movimientos de cobro recibidos
  const ingresos = [
    ...bankMovements.filter((m: any) => m.tipo === 'abono').map((m: any) => ({ fecha: m.fecha, concepto: m.concepto || 'Transferencia', moneda: (m.moneda === 'USD' ? 'USD' : 'MXN'), monto: Number(m.monto) || 0, metodo: 'Transf.' })),
    ...cashMovements.filter((m: any) => m.tipo === 'cobro_cliente').map((m: any) => ({ fecha: m.fecha, concepto: m.concepto || m.persona || 'Efectivo', moneda: (m.moneda === 'USD' ? 'USD' : 'MXN'), monto: Number(m.monto) || 0, metodo: 'Efectivo' })),
  ].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
  sectionTitle('Movimientos de cobro recibidos')
  if (ingresos.length === 0) {
    setTxt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.text('Sin cobros registrados', M + 3, y); y += 8
  } else {
    const cX = { fec: M + 3, con: 40, met: 112, mon: 138 }
    setFill(HEADFILL); doc.rect(M, y, RIGHT - M, 6, 'F')
    setTxt(GRAY); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    doc.text('FECHA', cX.fec, y + 4); doc.text('CONCEPTO', cX.con, y + 4); doc.text('MÉTODO', cX.met, y + 4); doc.text('MON.', cX.mon, y + 4); doc.text('MONTO', RIGHT - 3, y + 4, { align: 'right' })
    y += 6
    const totCobros = { USD: 0, MXN: 0 }
    ingresos.forEach((m, i) => {
      checkPage(7)
      const cur = m.moneda as 'USD' | 'MXN'
      totCobros[cur] += m.monto
      if (i % 2 === 1) { setFill(ZEBRA); doc.rect(M, y, RIGHT - M, 6, 'F') }
      setTxt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      doc.text(m.fecha || '—', cX.fec, y + 4)
      doc.text((m.concepto || '—').substring(0, 40), cX.con, y + 4)
      setTxt(GRAY); doc.setFontSize(7.5); doc.text(m.metodo, cX.met, y + 4); doc.text(cur, cX.mon, y + 4)
      setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(money(m.monto, cur), RIGHT - 3, y + 4, { align: 'right' })
      y += 6
    })
    checkPage(6 * (Object.values(totCobros).filter(v => v > 0).length) + 4)
    ;(['USD', 'MXN'] as const).filter(c => totCobros[c] > 0).forEach(c => {
      setFill([242, 245, 244]); doc.rect(M, y, RIGHT - M, 6, 'F')
      setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
      doc.text(`Total recibido ${c}`, M + 3, y + 4)
      doc.text(money(totCobros[c], c), RIGHT - 3, y + 4, { align: 'right' })
      y += 6
    })
    y += 6
  }

  // Cobros por cotización (mini estado de cuenta)
  sectionTitle('Cobros por cotización')
  const conCobros = quoteData.filter(d => d.pagos.length > 0)
  if (conCobros.length === 0) {
    setTxt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.text('Aún no hay cobros adjudicados a cotizaciones', M + 3, y); y += 8
  } else {
    conCobros.forEach(({ q, cur, total, cobrado, pagos }) => {
      const pend = Math.max(0, total - cobrado)
      const pct = total > 0 ? Math.min(cobrado / total, 1) : 0
      checkPage(10 + pagos.length * 5.4 + 22)
      setFill([243, 245, 244]); doc.rect(M, y, RIGHT - M, 8.5, 'F')
      setFill(GREEN); doc.rect(M, y, 1.6, 8.5, 'F')
      setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
      doc.text((q.name || '—').substring(0, 52), M + 4, y + 5.6)
      setFill(cur === 'USD' ? [6, 182, 212] : [167, 139, 250]); doc.roundedRect(RIGHT - 18, y + 2.4, 14, 4.6, 1, 1, 'F')
      setTxt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text(cur, RIGHT - 11, y + 5.6, { align: 'center' })
      y += 10
      setTxt([150, 150, 150]); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
      doc.text('FECHA', M + 6, y + 2); doc.text('CONCEPTO', M + 28, y + 2); doc.text('ORIGEN', RIGHT - 34, y + 2, { align: 'right' }); doc.text('MONTO', RIGHT - 3, y + 2, { align: 'right' })
      y += 4
      pagos.forEach((p, i) => {
        const cruce = !!(p.tc && p.montoOrigen && p.monedaOrigen)
        const rh = cruce ? 9 : 5.2
        checkPage(rh)
        if (i % 2 === 1) { setFill(ZEBRA); doc.rect(M + 3, y, RIGHT - M - 3, rh, 'F') }
        setTxt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
        doc.text(p.date || '—', M + 6, y + 3.6)
        setTxt([70, 70, 70]); doc.text((p.concepto || '').replace(/💵 /, '').substring(0, 46), M + 28, y + 3.6)
        setTxt([160, 160, 160]); doc.setFontSize(6.5); doc.text(p.source.toUpperCase(), RIGHT - 34, y + 3.6, { align: 'right' })
        setTxt(GREEN); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(money(p.monto, p.cur), RIGHT - 3, y + 3.6, { align: 'right' })
        if (cruce) {
          setTxt([150, 150, 150]); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8)
          doc.text(`Cobro en ${money(p.montoOrigen as number, p.monedaOrigen as string)} ${p.monedaOrigen}  ·  TC acordado ${p.tc}  →  ${money(p.monto, p.cur)}`, M + 28, y + 7.4)
        }
        y += rh
      })
      y += 2
      const barX = M + 4, barW = RIGHT - M - 8
      setFill([228, 228, 228]); doc.rect(barX, y, barW, 4, 'F')
      setFill(pct >= 1 ? GREEN : [37, 99, 235]); doc.rect(barX, y, barW * pct, 4, 'F')
      y += 8
      setTxt([90, 90, 90]); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
      doc.text(`${Math.round(pct * 100)}% cobrado  ·  ${money(cobrado, cur)} de ${money(total, cur)}`, M + 4, y)
      setTxt([217, 119, 6]); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
      doc.text(`Por cobrar  ${money(pend, cur)}`, RIGHT - 3, y + 0.3, { align: 'right' })
      y += 11
    })
  }

  // Footer
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    setFill(GREEN); doc.rect(M, 270, RIGHT - M, 0.5, 'F')
    doc.setFontSize(7); setTxt(GRAY)
    doc.text(`OMM ERP · Estado de Cuenta · ${lead.name || ''}`, M, 274)
    doc.text(`Página ${i} de ${pageCount}`, RIGHT, 274, { align: 'right' })
  }

  return doc
}
