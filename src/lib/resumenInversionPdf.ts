// ═══════════════════════════════════════════════════════════════════════════
// Resumen de Inversión en PDF — formato de la casa.
//
// Antes se dibujaba a mano dentro de LeadDashboard: Helvetica suelta, cajitas
// verde pastel, sin logo, sin datos fiscales y sin pie. Era el único documento
// que el cliente recibe de OMM que no se parecía a los demás. Aquí usa el mismo
// vocabulario que `cotizacionPdf`: membrete con OMNIIOUS_LOGO y la ficha de
// `identidadOmm`, regla oscura, caja de datos con etiquetas, encabezados
// oscuros con el filo verde, zebra, franja de total y condiciones.
//
// Es genérico a propósito: recibe un bloque por moneda, así el mismo formato
// sirve para un lead en pesos, uno en dólares o uno con las dos.
// ═══════════════════════════════════════════════════════════════════════════
import jsPDF from 'jspdf'
import { OMNIIOUS_LOGO } from '../assets/logo'
import { identidadOmm, sinPlaceholder } from './identidadOmm'

export interface CotResumen {
  id: string
  nombre: string
  especialidad: string
  partidas: number
  /** Total con IVA, en la moneda del bloque. */
  totalConIva: number
  /** % del total que se pide de anticipo. 0 = no se pide. */
  anticipoPct: number
}

export interface BloqueMoneda {
  moneda: 'USD' | 'MXN'
  total: number
  cotizaciones: CotResumen[]
  sistemas: { nombre: string; subtotal: number }[]
}

export interface DatosResumenInversion {
  /** El lead como vive en el CRM. Da el título del documento. */
  lead: string
  /** El despacho o contacto. `leads.company`. */
  cliente?: string | null
  fecha?: string | null
  vigenciaDias?: number
  bloques: BloqueMoneda[]
  elaboro?: string | null
}

export function generarResumenInversionPdf(d: DatosResumenInversion): jsPDF {
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
  const AMBAR: [number, number, number] = [180, 105, 20]

  const txt = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const money = (n: number, cur: string) =>
    (cur === 'USD' ? 'US$' : '$') + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const corto = (n: number, cur: string) =>
    (cur === 'USD' ? 'US$' : '$') + Math.round(Number(n) || 0).toLocaleString('es-MX')
  const fechaLarga = (s?: string | null) => {
    const base = s ? new Date(String(s).slice(0, 10) + 'T12:00:00') : new Date()
    return base.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
  }
  const masDias = (s: string | null | undefined, dias: number) => {
    const base = s ? new Date(String(s).slice(0, 10) + 'T12:00:00') : new Date()
    base.setDate(base.getDate() + dias)
    return base.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
  }

  // El nombre del lead ya va en la caja de datos; cada cotización lo repite como
  // prefijo y se come el ancho ("Cero5cien I-402 - Assa - Ingeniería Eléctrica").
  // Se compara NORMALIZADO porque el lead es "Cero5cien I402" y la cotización
  // "Cero5cien I-402": un startsWith exacto no empata por el guion.
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9áéíóúñ]/gi, '')
  const sinPrefijo = (n: string): string => {
    const completo = String(n || '—').trim()
    const base = norm(String(d.lead || '')) + norm(String(d.cliente || ''))
    if (!base) return completo
    const partes = completo.split(' - ')
    let i = 0
    while (i < partes.length - 1 && norm(partes[i]) && base.includes(norm(partes[i]))) i++
    return partes.slice(i).join(' - ').trim() || completo
  }

  let encabezadoTabla: () => void = () => {}
  const nuevaPagina = () => { doc.addPage(); y = 18; encabezadoTabla() }
  const espacio = (need: number) => { if (y + need > 250) nuevaPagina() }

  // ── Membrete ─────────────────────────────────────────────────────────────
  const id = identidadOmm()
  const LOGO_W = 22
  const LOGO_H = LOGO_W / 1.15
  y = 13
  try { doc.addImage(OMNIIOUS_LOGO, 'JPEG', M, y, LOGO_W, LOGO_H) } catch { /* sin logo, el resto se imprime igual */ }

  const fichaEmpresa = [
    sinPlaceholder(id.rfc) ? `RFC ${sinPlaceholder(id.rfc)}` : '',
    sinPlaceholder(id.domicilio),
    [sinPlaceholder(id.codigoPostal), sinPlaceholder(id.ciudad)].filter(Boolean).join(' · '),
    [sinPlaceholder(id.telefono), sinPlaceholder(id.email)].filter(Boolean).join(' · '),
    sinPlaceholder(id.web),
  ].filter(Boolean)

  txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
  doc.text(sinPlaceholder(id.razonSocial) || 'OMM Technologies SA de CV', R, y + 3.5, { align: 'right' })
  txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  fichaEmpresa.forEach((l, k) => doc.text(l, R, y + 8 + k * 3.4, { align: 'right' }))

  y += Math.max(LOGO_H, 8 + fichaEmpresa.length * 3.4) + 3
  fill(DARK); doc.rect(M, y, R - M, 0.8, 'F'); y += 8

  // ── Título ───────────────────────────────────────────────────────────────
  const monedas = d.bloques.map(b => b.moneda).join(' · ')
  txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
  doc.text('CONSOLIDADO DE COTIZACIONES', M, y)
  txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
  doc.text('RESUMEN DE INVERSIÓN', R, y + 1, { align: 'right' })
  y += 11

  // ── Caja de datos ────────────────────────────────────────────────────────
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

  const nCots = d.bloques.reduce((a, b) => a + b.cotizaciones.length, 0)
  const anchoIzq = colB - M - 10
  campo('Cliente', d.cliente || d.lead, M + 4, y + 6, anchoIzq)
  campo('Proyecto', d.lead, M + 4, y + 15, anchoIzq)
  txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text(`${nCots} cotización${nCots === 1 ? '' : 'es'} incluida${nCots === 1 ? '' : 's'}`, M + 4, y + 23)

  const anchoDer = R - colB - 4
  campo('Fecha', fechaLarga(d.fecha), colB, y + 6, anchoDer)
  campo('Vigencia', masDias(d.fecha, d.vigenciaDias ?? 15), colB, y + 15, anchoDer)
  txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text(`Moneda: ${monedas}`, colB, y + 23)
  y += cajaH + 9

  const barra = (titulo: string, alto = 6.5) => {
    fill(DARK); doc.rect(M, y, R - M, alto, 'F')
    fill(GREEN); doc.rect(M, y, 2, alto, 'F')
    txt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    doc.text(titulo.toUpperCase(), M + 5, y + alto / 2 + 1.4)
    y += alto + 4
  }

  let hayUSD = false
  let hayAnticipoDoc = false

  // ── Un bloque por moneda ─────────────────────────────────────────────────
  d.bloques.forEach(b => {
    if (b.cotizaciones.length === 0) return
    if (b.moneda === 'USD') hayUSD = true
    const cur = b.moneda
    const pctDe = (c: CotResumen) => Number(c.anticipoPct) || 0
    const anticipo = b.cotizaciones.reduce((a, c) => a + c.totalConIva * pctDe(c) / 100, 0)
    // La columna de anticipo solo sale si alguna cotización de ESTA moneda lo
    // pide. Una columna de ceros le pregunta al cliente algo que nadie dijo.
    const hayAnticipo = anticipo > 0
    if (hayAnticipo) hayAnticipoDoc = true

    espacio(46)
    barra(`Inversión ${cur}`)

    // Las x de las columnas. Los encabezados se escriben a 6.8pt bold: a
    // "ESPECIALIDAD" le caben ~14 mm y a "PARTIDAS" ~13, asi que entre el
    // inicio de una y el fin de la otra tiene que haber ese margen. Con
    // esp en R-86 salia "ESPECIALIDARTIDAS" encimado — verificado mirando
    // el PDF renderizado, no leyendo el codigo.
    const cX = hayAnticipo
      ? { num: M + 2, cot: M + 10, esp: R - 100, part: R - 62, ant: R - 32, tot: R }
      : { num: M + 2, cot: M + 10, esp: R - 86,  part: R - 40, ant: 0,      tot: R }
    const anchoCot = cX.esp - cX.cot - 4

    encabezadoTabla = () => {
      fill([238, 240, 239]); doc.rect(M, y, R - M, 6.5, 'F')
      txt([70, 70, 70]); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8)
      doc.text('#', cX.num + 2, y + 4.3)
      doc.text('COTIZACIÓN', cX.cot, y + 4.3)
      doc.text('ESPECIALIDAD', cX.esp, y + 4.3)
      doc.text('PARTIDAS', cX.part, y + 4.3, { align: 'right' })
      if (hayAnticipo) doc.text('ANTICIPO', cX.ant, y + 4.3, { align: 'right' })
      doc.text('TOTAL C/IVA', cX.tot, y + 4.3, { align: 'right' })
      y += 6.5
    }
    encabezadoTabla()

    b.cotizaciones.forEach((c, i) => {
      const lineas = doc.splitTextToSize(sinPrefijo(c.nombre), anchoCot) as string[]
      const alto = Math.max(8.5, lineas.length * 4 + 4.5)
      espacio(alto + 4)
      if (i % 2 === 1) { fill(ZEBRA); doc.rect(M, y, R - M, alto, 'F') }

      txt([150, 150, 150]); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      doc.text(String(i + 1), cX.num + 2, y + 5.3)
      txt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      lineas.forEach((l, k) => doc.text(l, cX.cot, y + 5.3 + k * 4))
      txt([90, 90, 90]); doc.setFontSize(8)
      doc.text(String(c.especialidad || '—').toUpperCase(), cX.esp, y + 5.3)
      doc.text(String(c.partidas), cX.part, y + 5.3, { align: 'right' })
      if (hayAnticipo) {
        const a = c.totalConIva * pctDe(c) / 100
        if (a > 0) {
          txt(AMBAR); doc.setFont('helvetica', 'normal')
          doc.text(`${corto(a, cur)} (${pctDe(c)}%)`, cX.ant, y + 5.3, { align: 'right' })
        } else {
          txt([180, 180, 180]); doc.text('—', cX.ant, y + 5.3, { align: 'right' })
        }
      }
      txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
      doc.text(money(c.totalConIva, cur), cX.tot, y + 5.3, { align: 'right' })

      doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]); doc.setLineWidth(0.2)
      doc.line(M, y + alto, R, y + alto)
      y += alto
    })

    // ── Franja de total de la moneda ───────────────────────────────────────
    y += 4
    espacio(hayAnticipo ? 26 : 14)
    const totW = 92
    const totX = R - totW
    fill(DARK); doc.rect(totX - 4, y, totW + 4, 10, 'F')
    fill(GREEN); doc.rect(totX - 4, y, 2, 10, 'F')
    txt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text(`INVERSIÓN ${cur}`, totX + 1, y + 6.4)
    doc.setFontSize(12)
    doc.text(money(b.total, cur), R - 3, y + 6.6, { align: 'right' })
    y += 12

    if (hayAnticipo) {
      txt(AMBAR); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
      doc.text('Anticipo requerido', totX + 1, y + 3.2)
      doc.text(money(anticipo, cur), R - 3, y + 3.2, { align: 'right' })
      y += 5
      txt([120, 120, 120]); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
      doc.text(`Resto contra avance  (${((anticipo / b.total) * 100).toFixed(0)}% / ${(100 - (anticipo / b.total) * 100).toFixed(0)}%)`, totX + 1, y + 3.2)
      doc.text(money(b.total - anticipo, cur), R - 3, y + 3.2, { align: 'right' })
      y += 6
    }
    y += 5

    // ── Desglose por sistema ───────────────────────────────────────────────
    if (b.sistemas.length > 0) {
      espacio(b.sistemas.length * 5.4 + 18)
      txt(GRAY); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
      doc.text(`DESGLOSE POR SISTEMA · ${cur}`, M, y)
      y += 3
      fill(LINEA); doc.rect(M, y, R - M, 0.3, 'F')
      y += 5

      const barX = R - 64, barW = 26
      b.sistemas.forEach(sis => {
        espacio(6)
        const pct = b.total > 0 ? (sis.subtotal / b.total) * 100 : 0
        txt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
        doc.text(doc.splitTextToSize(sinPrefijo(sis.nombre), barX - M - 6)[0], M + 2, y + 2.6)
        fill([232, 234, 233]); doc.rect(barX, y, barW, 2.6, 'F')
        fill(GREEN); doc.rect(barX, y, barW * Math.min(pct, 100) / 100, 2.6, 'F')
        txt([110, 110, 110]); doc.setFontSize(8)
        doc.text(`${pct.toFixed(0)}%`, R - 32, y + 2.6, { align: 'right' })
        txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
        doc.text(money(sis.subtotal, cur), R, y + 2.6, { align: 'right' })
        y += 5.4
      })
      y += 6
    }
    y += 2
  })

  // ── Condiciones ──────────────────────────────────────────────────────────
  // No se suman las monedas: un total en pesos y uno en dólares no se juntan
  // sin un TC pactado, y aquí no hay uno. Se dice, en vez de inventarlo.
  const condiciones = [
    `Vigencia: ${d.vigenciaDias ?? 15} días naturales a partir de la fecha de este resumen.`,
    'Todos los importes incluyen IVA del 16%.',
    'Este resumen consolida las cotizaciones listadas; cada una conserva su alcance, sus exclusiones y sus condiciones particulares.',
    ...(d.bloques.filter(b => b.cotizaciones.length > 0).length > 1
      ? ['Los totales se presentan por separado en cada moneda: no se consolidan en una sola cifra sin un tipo de cambio pactado.'] : []),
    ...(hayAnticipoDoc
      ? ['El anticipo indicado se factura al inicio de los trabajos; el saldo se cobra contra avance conforme al plan de pagos de cada cotización.'] : []),
    ...(hayUSD
      ? ['Los importes en dólares se facturan al tipo de cambio pactado en cada cotización.'] : []),
  ]
  espacio(condiciones.length * 4.2 + 18)
  barra('Condiciones', 6)
  y -= 1
  txt([90, 90, 90]); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  condiciones.forEach(c => {
    const ls = doc.splitTextToSize(c, R - M - 5) as string[]
    ls.forEach((l, k) => doc.text((k === 0 ? '·  ' : '   ') + l, M, y))
    y += ls.length * 4.2
  })

  // ── Firma ────────────────────────────────────────────────────────────────
  espacio(24)
  y += 10
  doc.setDrawColor(160, 160, 160); doc.setLineWidth(0.3)
  doc.line(M, y, M + 62, y)
  txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  doc.text(d.elaboro || sinPlaceholder(id.responsableNombre) || 'OMM Technologies', M, y + 4.5)
  txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text('Elaboró', M, y + 8.5)

  // ── Pie en todas las páginas ─────────────────────────────────────────────
  const paginas = (doc as any).internal.getNumberOfPages()
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p)
    fill(GREEN); doc.rect(M, 264, R - M, 0.5, 'F')
    txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    const pieIzq = [sinPlaceholder(id.razonSocial) || 'OMM Technologies SA de CV',
      sinPlaceholder(id.rfc) ? `RFC ${sinPlaceholder(id.rfc)}` : '',
      sinPlaceholder(id.web)].filter(Boolean).join(' · ')
    doc.text(pieIzq, M, 269)
    doc.text(`Resumen de Inversión · ${d.lead} · Pág. ${p}/${paginas}`, R, 269, { align: 'right' })
  }

  return doc
}
