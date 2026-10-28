// Estado de cuenta en PDF — fuente ÚNICA. La usan el CRM (LeadDashboard), Cobranza
// y el Edge Function `mcp-contabilidad`, desde el que un bot autorizado lo pide
// sin navegador. Vive aquí, en _shared, para que exista UNA sola versión del
// documento: dos copias se separan solas y el que lo nota es el cliente,
// comparando dos estados de cuenta de OMM que no dicen lo mismo.
//
// No toca el DOM ni html2canvas — por eso corre igual en el navegador y en Deno.
// Si algún día necesita medir algo de la pantalla, deja de poder correr en el
// servidor: ese es el límite, no el tamaño del archivo.
//
// Devuelve el documento jsPDF (sin guardar); el que llama decide save(),
// output('datauristring') o output('arraybuffer').
//
// ⚠️ DOS COSAS DEL IMPORT QUE NO SON ESTÉTICA:
//
// 1. `jspdf` va sin URL ni prefijo npm: en el ERP lo resuelve Vite desde
//    node_modules y en el Edge Function el mapa de `deno.json`. Ponerle una URL
//    de CDN rompe el build del ERP.
//
// 2. Va el export CON NOMBRE, no el default. Los demás PDF del ERP usan
//    `import jsPDF from 'jspdf'` y funcionan — pero solo porque corren en el
//    navegador, donde Vite resuelve la build ESM cuyo default ES la clase.
//    Fuera del navegador el paquete resuelve a la build de Node y ahí el
//    default es el objeto del módulo, no un constructor:
//
//        import jsPDF from 'jspdf'   → typeof default === 'object'
//        new jsPDF(...)              → TypeError: not a constructor
//
//    El export con nombre existe en las dos builds, así que es el único que
//    sirve para un archivo que corre de los dos lados. Comprobado en Node
//    contra el paquete instalado, no deducido de la documentación.
import { jsPDF } from 'jspdf'

export interface EstadoCuentaInput {
  lead: { name?: string; company?: string }
  quotations: any[]        // cotizaciones del lead (se filtran stage==='contrato' aquí)
  bankMovements: any[]     // movimientos de banco del lead
  cashMovements: any[]     // movimientos de efectivo del lead
  paymentAllocations: any[]// prorrateos del lead
  // Estado de cuenta PARCIAL (oct-2026): ids de las cotizaciones a incluir.
  // Vacío o ausente = el general de siempre. Hay clientes que llevan cada
  // proyecto por separado y el general los confunde.
  soloCotizaciones?: string[]
}

export function generarEstadoCuentaPdf(input: EstadoCuentaInput): jsPDF {
  const { lead, quotations, bankMovements, cashMovements, paymentAllocations } = input
  const seleccion = new Set((input.soloCotizaciones || []).filter(Boolean))
  const parcial = seleccion.size > 0

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
  const ROJO: [number, number, number] = [220, 38, 38]
  const AMBAR: [number, number, number] = [217, 119, 6]
  const setTxt = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const setFill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const money = (n: number, cur: string) => (cur === 'USD' ? 'US$' : '$') + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // El nombre del lead ya esta en el encabezado del documento; repetirlo en cada
  // renglon solo come el ancho y hace que dos cotizaciones distintas se corten
  // igual ("... - Adicionales C" y "... - Adicionales E"). Se recorta el prefijo.
  const nombreCorto = (n: any): string => {
    const t = String(n || '—').trim()
    const pre = String(lead.name || '').trim()
    if (pre && t.toLowerCase().startsWith(pre.toLowerCase() + ' - ')) return t.slice(pre.length + 3).trim() || t
    return t
  }
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
  if (parcial) {
    const n = quotations.filter(q => q.stage === 'contrato' && seleccion.has(q.id)).length
    setTxt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(9)
    doc.text(`Estado de cuenta parcial: incluye ${n === 1 ? '1 cotización seleccionada' : n + ' cotizaciones seleccionadas'}.`, M, y + 1); y += 5
  }
  setFill(GREEN); doc.rect(M, y + 1, RIGHT - M, 0.8, 'F'); y += 8

  // Datos consolidados
  const contratos = quotations.filter(q => q.stage === 'contrato' && (!parcial || seleccion.has(q.id)))
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
      doc.text(parcial ? 'SELECCIÓN' : 'GENERAL', x + 21, y + 7.6)
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
      doc.text(nombreCorto(q.name).substring(0, 46), cX.nom, y + 4)
      setTxt(GRAY); doc.setFontSize(7.5); doc.text((q.specialty || '—').toUpperCase(), cX.esp, y + 4); doc.text(cur, cX.mon, y + 4)
      setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(money(total, cur), RIGHT - 3, y + 4, { align: 'right' })
      y += 6
    })
    y += 6
  }

  // Movimientos de cobro recibidos
  // En el PARCIAL no se listan todos los cobros del lead: sólo lo aplicado a las
  // cotizaciones elegidas, por el monto que les tocó (una transferencia
  // prorrateada entre dos proyectos aparece sólo con la parte de éste). Así el
  // "Total recibido" cuadra con el "Cobrado" de las tarjetas.
  // Cada renglón dice lo que REALMENTE entró (recibido, en su moneda) y, si se
  // aplicó a una cotización en otra moneda, el TC acordado y lo aplicado.
  // Antes el parcial pintaba solo lo ya convertido: un depósito de $43,015 MXN
  // salía como "US$2,325.14 USD" y parecía que el cliente había pagado en dólares.
  interface FilaCobro {
    fecha: string; concepto: string; metodo: string
    recibido: number; monRecibido: 'USD' | 'MXN'
    tc: number | null; aplicado: number; monAplicado: 'USD' | 'MXN'
  }
  const aMon = (c: any): 'USD' | 'MXN' => (c === 'USD' ? 'USD' : 'MXN')
  const curDeCot: Record<string, 'USD' | 'MXN'> = {}
  quotations.forEach((q: any) => { curDeCot[q.id] = getQuotCurrency(q) })
  // General: para un movimiento de banco, si sus prorrateos lo convirtieron a la
  // moneda de la cotización, se reporta el TC y lo aplicado. Solo si todo fue a
  // UNA moneda distinta a la del depósito; si no, se deja como entró.
  const cruceDeMovimiento = (m: any): { tc: number; aplicado: number; mon: 'USD' | 'MXN' } | null => {
    const pas = paymentAllocations.filter((pa: any) => pa.bank_movement_id === m.id && pa.tc_aplicado && pa.monto_origen)
    if (pas.length === 0) return null
    const destinos = new Set(pas.map((pa: any) => curDeCot[pa.quotation_id] || ''))
    if (destinos.size !== 1) return null
    const mon = aMon(Array.from(destinos)[0])
    if (mon === aMon(m.moneda)) return null
    const aplicado = pas.reduce((t: number, pa: any) => t + (Number(pa.monto) || 0), 0)
    const origen = pas.reduce((t: number, pa: any) => t + (Number(pa.monto_origen) || 0), 0)
    if (!(aplicado > 0)) return null
    const tcs = new Set(pas.map((pa: any) => Number(pa.tc_aplicado)))
    const tc = tcs.size === 1 ? Number(pas[0].tc_aplicado) : Math.round((origen / aplicado) * 10000) / 10000
    return { tc, aplicado, mon }
  }
  const ingresos: FilaCobro[] = (parcial
    ? quoteData.flatMap(d => d.pagos.map(p => {
        const cruce = !!(p.tc && p.montoOrigen && p.monedaOrigen)
        const fila: FilaCobro = {
          fecha: p.date, concepto: (p.concepto || '').replace(/💵 /, ''), metodo: p.source === 'efectivo' ? 'Efectivo' : 'Transf.',
          recibido: cruce ? Number(p.montoOrigen) : p.monto, monRecibido: cruce ? aMon(p.monedaOrigen) : aMon(p.cur),
          tc: cruce ? Number(p.tc) : null, aplicado: p.monto, monAplicado: aMon(p.cur),
        }
        return fila
      }))
    : [
      ...bankMovements.filter((m: any) => m.tipo === 'abono').map((m: any) => {
        const c = cruceDeMovimiento(m)
        const fila: FilaCobro = {
          fecha: m.fecha, concepto: m.concepto || 'Transferencia', metodo: 'Transf.',
          recibido: Number(m.monto) || 0, monRecibido: aMon(m.moneda),
          tc: c ? c.tc : null, aplicado: c ? c.aplicado : (Number(m.monto) || 0), monAplicado: c ? c.mon : aMon(m.moneda),
        }
        return fila
      }),
      ...cashMovements.filter((m: any) => m.tipo === 'cobro_cliente').map((m: any) => {
        const cruce = !!(m.tc_aplicado && m.moneda_cotizacion && aMon(m.moneda) !== aMon(m.moneda_cotizacion) && Number(m.monto_cotizacion) > 0)
        const fila: FilaCobro = {
          fecha: m.fecha, concepto: m.concepto || m.persona || 'Efectivo', metodo: 'Efectivo',
          recibido: Number(m.monto) || 0, monRecibido: aMon(m.moneda),
          tc: cruce ? Number(m.tc_aplicado) : null,
          aplicado: cruce ? Number(m.monto_cotizacion) : (Number(m.monto) || 0),
          monAplicado: cruce ? aMon(m.moneda_cotizacion) : aMon(m.moneda),
        }
        return fila
      }),
    ]).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
  const hayCruce = ingresos.some(m => m.tc !== null)
  const tcTxt = (n: number) => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  sectionTitle('Movimientos de cobro recibidos')
  if (ingresos.length === 0) {
    setTxt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.text('Sin cobros registrados', M + 3, y); y += 8
  } else if (!hayCruce) {
    const cX = { fec: M + 3, con: 40, met: 112, mon: 138 }
    setFill(HEADFILL); doc.rect(M, y, RIGHT - M, 6, 'F')
    setTxt(GRAY); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    doc.text('FECHA', cX.fec, y + 4); doc.text('CONCEPTO', cX.con, y + 4); doc.text('MÉTODO', cX.met, y + 4); doc.text('MON.', cX.mon, y + 4); doc.text('MONTO', RIGHT - 3, y + 4, { align: 'right' })
    y += 6
    const totCobros = { USD: 0, MXN: 0 }
    ingresos.forEach((m, i) => {
      checkPage(7)
      const cur = m.monRecibido
      totCobros[cur] += m.recibido
      if (i % 2 === 1) { setFill(ZEBRA); doc.rect(M, y, RIGHT - M, 6, 'F') }
      setTxt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      doc.text(m.fecha || '—', cX.fec, y + 4)
      doc.text((m.concepto || '—').substring(0, 40), cX.con, y + 4)
      setTxt(GRAY); doc.setFontSize(7.5); doc.text(m.metodo, cX.met, y + 4); doc.text(cur, cX.mon, y + 4)
      setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(money(m.recibido, cur), RIGHT - 3, y + 4, { align: 'right' })
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
  } else {
    // Con conversión: RECIBIDO (lo que entró, en su moneda) · TC · APLICADO
    const cX = { fec: M + 3, con: 37, met: 100, rec: 146, tc: 163 }
    setFill(HEADFILL); doc.rect(M, y, RIGHT - M, 6, 'F')
    setTxt(GRAY); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    doc.text('FECHA', cX.fec, y + 4); doc.text('CONCEPTO', cX.con, y + 4); doc.text('MÉTODO', cX.met, y + 4)
    doc.text('RECIBIDO', cX.rec, y + 4, { align: 'right' }); doc.text('TC', cX.tc, y + 4, { align: 'right' }); doc.text('APLICADO', RIGHT - 3, y + 4, { align: 'right' })
    y += 6
    const totRec = { USD: 0, MXN: 0 }
        ingresos.forEach((m, i) => {
      checkPage(7)
      totRec[m.monRecibido] += m.recibido
      if (i % 2 === 1) { setFill(ZEBRA); doc.rect(M, y, RIGHT - M, 6, 'F') }
      setTxt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
      doc.text(m.fecha || '—', cX.fec, y + 4)
      doc.text((m.concepto || '—').substring(0, 34), cX.con, y + 4)
      setTxt(GRAY); doc.setFontSize(7.5); doc.text(m.metodo, cX.met, y + 4)
      setTxt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      doc.text(`${money(m.recibido, m.monRecibido)} ${m.monRecibido}`, cX.rec, y + 4, { align: 'right' })
      setTxt(GRAY); doc.setFontSize(8)
      doc.text(m.tc !== null ? tcTxt(m.tc) : '—', cX.tc, y + 4, { align: 'right' })
      setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
      doc.text(`${money(m.aplicado, m.monAplicado)} ${m.monAplicado}`, RIGHT - 3, y + 4, { align: 'right' })
      y += 6
    })
    // Totales: lo que entró por moneda, y aparte cuánto de eso se convirtió.
    const conv: Record<string, { rec: number; apl: number; de: 'USD' | 'MXN'; a: 'USD' | 'MXN' }> = {}
    ingresos.filter(m => m.monRecibido !== m.monAplicado).forEach(m => {
      const k = m.monRecibido + '>' + m.monAplicado
      if (!conv[k]) conv[k] = { rec: 0, apl: 0, de: m.monRecibido, a: m.monAplicado }
      conv[k].rec += m.recibido; conv[k].apl += m.aplicado
    })
    const nomMon = (c: string) => (c === 'MXN' ? 'pesos' : 'dólares')
    const filasTot = (['USD', 'MXN'] as const).filter(c => totRec[c] > 0).length + Object.keys(conv).length
    checkPage(6 * filasTot + 10)
    ;(['MXN', 'USD'] as const).filter(c => totRec[c] > 0).forEach(c => {
      setFill([242, 245, 244]); doc.rect(M, y, RIGHT - M, 6, 'F')
      setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
      doc.text(`Total recibido en ${nomMon(c)}`, M + 3, y + 4)
      doc.text(`${money(totRec[c], c)} ${c}`, cX.rec, y + 4, { align: 'right' })
      y += 6
    })
    Object.values(conv).forEach(cv => {
      setFill([242, 245, 244]); doc.rect(M, y, RIGHT - M, 6, 'F')
      setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
      doc.text(`De eso, convertido de ${nomMon(cv.de)} a ${nomMon(cv.a)}`, M + 3, y + 4)
      doc.setFont('helvetica', 'normal')
      doc.text(`${money(cv.rec, cv.de)} ${cv.de}`, cX.rec, y + 4, { align: 'right' })
      doc.setFont('helvetica', 'bold')
      doc.text(`${money(cv.apl, cv.a)} ${cv.a}`, RIGHT - 3, y + 4, { align: 'right' })
      y += 6
    })
    y += 2
    setTxt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5)
    doc.text('Los pagos se reciben en la moneda indicada en RECIBIDO; cuando la cotización es en otra moneda se aplican al tipo de cambio acordado (TC).', M + 3, y + 2, { maxWidth: RIGHT - M - 6 })
    y += 9
  }

  // Cobros por cotización (mini estado de cuenta)
  checkPage(40)
  sectionTitle('Cobros por cotización')
  // Se listan TODOS los contratos, hayan pagado o no. Una cotizacion sin un solo
  // cobro es justamente la que hay que ver en un estado de cuenta: sale con
  // adeudo al 100% y en rojo. Antes se filtraban por `pagos.length > 0` y
  // desaparecian del documento, que es como no tener el adeudo.
  const conCobros = quoteData.filter(d => d.pagos.length > 0 || d.total > 0)
  if (conCobros.length === 0) {
    setTxt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.text('Aún no hay contratos con importe registrado', M + 3, y); y += 8
  } else {
    conCobros.forEach(({ q, cur, total, cobrado, pagos }) => {
      const pend = Math.max(0, total - cobrado)
      const pct = total > 0 ? Math.min(cobrado / total, 1) : 0
      const sinPagos = pagos.length === 0
      const acento = sinPagos ? ROJO : GREEN
      checkPage(10 + Math.max(pagos.length, 1) * 5.4 + 22)
      setFill(sinPagos ? [253, 242, 242] : [243, 245, 244]); doc.rect(M, y, RIGHT - M, 8.5, 'F')
      setFill(acento); doc.rect(M, y, 1.6, 8.5, 'F')
      setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
      doc.text(nombreCorto(q.name).substring(0, sinPagos ? 40 : 52), M + 4, y + 5.6)
      if (sinPagos) {
        setFill(ROJO); doc.roundedRect(RIGHT - 40, y + 2.4, 19, 4.6, 1, 1, 'F')
        setTxt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
        doc.text('SIN PAGOS', RIGHT - 30.5, y + 5.5, { align: 'center' })
      }
      setFill(cur === 'USD' ? [6, 182, 212] : [167, 139, 250]); doc.roundedRect(RIGHT - 18, y + 2.4, 14, 4.6, 1, 1, 'F')
      setTxt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text(cur, RIGHT - 11, y + 5.6, { align: 'center' })
      y += 10
      setTxt([150, 150, 150]); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
      doc.text('FECHA', M + 6, y + 2); doc.text('CONCEPTO', M + 28, y + 2); doc.text('ORIGEN', RIGHT - 34, y + 2, { align: 'right' }); doc.text('MONTO', RIGHT - 3, y + 2, { align: 'right' })
      y += 4
      if (sinPagos) {
        setFill([252, 248, 248]); doc.rect(M + 3, y, RIGHT - M - 3, 5.2, 'F')
        setTxt([150, 150, 150]); doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5)
        doc.text('Sin pagos registrados a la fecha', M + 6, y + 3.6)
        setTxt(ROJO); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
        doc.text(money(0, cur), RIGHT - 3, y + 3.6, { align: 'right' })
        y += 5.2
      }
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
          doc.text(`Cobro en ${money(p.montoOrigen as number, p.monedaOrigen as string)} ${p.monedaOrigen}  ·  TC acordado ${p.tc}  =  ${money(p.monto, p.cur)} ${p.cur}`, M + 28, y + 7.4)
        }
        y += rh
      })
      y += 2
      const barX = M + 4, barW = RIGHT - M - 8
      setFill(sinPagos ? [252, 226, 226] : [228, 228, 228]); doc.rect(barX, y, barW, 4, 'F')
      if (pct > 0) { setFill(pct >= 1 ? GREEN : [37, 99, 235]); doc.rect(barX, y, barW * pct, 4, 'F') }
      y += 8
      setTxt(sinPagos ? ROJO : [90, 90, 90]); doc.setFont('helvetica', sinPagos ? 'bold' : 'normal'); doc.setFontSize(8)
      doc.text(sinPagos
        ? `Adeudo del 100%  ·  ${money(0, cur)} cobrado de ${money(total, cur)}`
        : `${Math.round(pct * 100)}% cobrado  ·  ${money(cobrado, cur)} de ${money(total, cur)}`, M + 4, y)
      setTxt(sinPagos ? ROJO : AMBAR); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
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
    doc.text(`OMM ERP · Estado de Cuenta${parcial ? ' (parcial)' : ''} · ${lead.name || ''}`, M, 274)
    doc.text(`Página ${i} de ${pageCount}`, RIGHT, 274, { align: 'right' })
  }

  return doc
}
