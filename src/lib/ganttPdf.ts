// El Gantt en PDF. Dos versiones del mismo plan:
//
//  · INTERNO — con responsable y avance. Es para la junta de obra.
//  · CLIENTE — sin nombres internos, y con la hoja de CONDICIONES DEL SITIO.
//
// La hoja de condiciones es la razón de ser de este documento. Sin ella, el
// cliente lee "11 de septiembre" como una promesa incondicional y luego viene
// el "tú dijiste ese día". Con ella, la conversación cambia: la fecha corre a
// partir de que el sitio esté listo, y ahí está escrito quién lo entrega.
import jsPDF from 'jspdf'
import { OMNIIOUS_LOGO } from '../assets/logo'
import { identidadOmm, sinPlaceholder } from './identidadOmm'
import { A_CARGO_CFG, ACargoDe, Prerequisito, PrereqCatalogo } from './prerequisitos'
import { BarraGantt, Escala, agrupar, escalaDe, condicionesDelProyecto, fechaCorta, fechaLarga, diasEntre } from './gantt'

export interface DatosGantt {
  obra: string
  cliente?: string | null
  barras: BarraGantt[]
  prereqs: Record<string, Prerequisito[]>
  agruparPor: 'sistema' | 'area'
  paraCliente: boolean
  elaboro?: string | null
  /** Condiciones de alcance 'obra': aplican a todo el proyecto y se listan
   *  una sola vez. Son las que mas le tocan al cliente (acceso, internet,
   *  resguardo de equipo) y si no salen aqui no salen en ningun lado. */
  generales?: PrereqCatalogo[]
}

export function generarGanttPdf(d: DatosGantt): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 12
  const R = W - M
  let y = 12

  const GREEN: [number, number, number] = [16, 185, 129]
  const DARK: [number, number, number] = [26, 26, 26]
  const GRAY: [number, number, number] = [120, 120, 120]
  const LINEA: [number, number, number] = [228, 230, 229]
  const AMBAR: [number, number, number] = [217, 119, 6]
  const ROJO: [number, number, number] = [200, 45, 45]

  const txt = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const id = identidadOmm()

  // Las descripciones vienen de la cotizacion y muchas terminan en " - Area"
  // o en un guion suelto cuando el area venia vacia. Cortarlo aqui evita
  // renglones que terminan en "... de acceso) -".
  const limpiar = (t: string) => t.replace(/[\s\u2013\u2014-]+$/, '').trim()

  const esc = escalaDe(d.barras)
  const LABEL = 78                    // ancho de la columna de nombres
  const PISTA = R - M - LABEL         // ancho del área de barras
  const px = (dias: number) => esc ? (dias / esc.dias) * PISTA : 0

  function membrete(titulo: string) {
    try { doc.addImage(OMNIIOUS_LOGO, 'JPEG', M, y, 16, 16 / 1.15) } catch { /* sigue sin logo */ }
    txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
    doc.text(titulo, M + 20, y + 5)
    txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.text(`${d.obra}${d.cliente ? '  ·  ' + d.cliente : ''}`, M + 20, y + 10)
    doc.setFontSize(7)
    doc.text(`${sinPlaceholder(id.razonSocial) || 'OMM Technologies'}  ·  ${fechaLarga(new Date())}`, R, y + 5, { align: 'right' })
    if (esc) doc.text(`Del ${fechaCorta(esc.inicio)} al ${fechaCorta(esc.fin)}`, R, y + 10, { align: 'right' })
    y += 19
    fill(DARK); doc.rect(M, y, R - M, 0.6, 'F'); y += 6
  }

  const nuevaPagina = (titulo: string) => { doc.addPage(); y = 12; membrete(titulo) }
  const espacio = (need: number, titulo: string) => { if (y + need > H - 16) nuevaPagina(titulo) }

  const TITULO = d.paraCliente ? 'Programa de obra' : 'Programa de obra — interno'
  membrete(TITULO)

  // ── Nota de condiciones: va ARRIBA, no en letra chica al final ────────────
  if (d.paraCliente) {
    const nota = 'Las fechas de este programa suponen que el sitio cumple las condiciones listadas al final para cada trabajo. El tiempo de cada actividad empieza a correr a partir de que esa condición está cumplida y verificada en obra.'
    fill([252, 248, 240]); doc.setDrawColor(235, 220, 190)
    const ls = doc.splitTextToSize(nota, R - M - 8) as string[]
    const alto = ls.length * 3.8 + 6
    doc.roundedRect(M, y, R - M, alto, 1.5, 1.5, 'FD')
    txt([140, 95, 20]); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    ls.forEach((l, i) => doc.text(l, M + 4, y + 5 + i * 3.8))
    y += alto + 5
  }

  if (!esc) {
    txt(GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(9)
    doc.text('No hay actividades con fecha para dibujar el programa.', M, y + 4)
    return doc
  }

  // ── Encabezado de la escala ───────────────────────────────────────────────
  function encabezadoEscala() {
    fill([245, 246, 246]); doc.rect(M + LABEL, y, PISTA, 6, 'F')
    doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]); doc.setLineWidth(0.2)
    txt(GRAY); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
    for (const mes of esc!.meses) {
      const x = M + LABEL + px(mes.offset)
      doc.line(x, y, x, y + 6)
      if (px(mes.dias) > 12) doc.text(mes.label.toUpperCase(), x + 1.5, y + 4)
    }
    y += 6
  }
  encabezadoEscala()

  // Línea de hoy, si cae dentro del plan
  const hoy = new Date()
  const offHoy = diasEntre(esc.inicio, hoy)
  const dibujarHoy = (desde: number, hasta: number) => {
    if (offHoy < 0 || offHoy > esc!.dias) return
    const x = M + LABEL + px(offHoy)
    doc.setDrawColor(200, 60, 60); doc.setLineWidth(0.4)
    doc.setLineDashPattern([1, 1], 0)
    doc.line(x, desde, x, hasta)
    doc.setLineDashPattern([], 0)
  }

  // ── Las barras, agrupadas ─────────────────────────────────────────────────
  const grupos = agrupar(d.barras, d.agruparPor)
  const ALTO = 6.4
  for (const g of grupos) {
    espacio(ALTO * 2 + 8, TITULO)
    fill([238, 241, 240]); doc.rect(M, y, R - M, 5.6, 'F')
    fill(GREEN); doc.rect(M, y, 1.6, 5.6, 'F')
    txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    doc.text(`${g.titulo}  (${g.barras.length})`, M + 4, y + 3.9)
    y += 7

    for (const b of g.barras) {
      espacio(ALTO + 2, TITULO)
      const yTop = y
      const nombre = limpiar(b.tarea.titulo_cliente || b.tarea.name)
      txt([70, 70, 70]); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      const lns = doc.splitTextToSize(nombre, LABEL - 6) as string[]
      // Limpiar DESPUES de cortar: el guion sobrante suele quedar en el corte,
      // no al final del texto original.
      doc.text(lns.length > 1 ? limpiar(lns[0]) + '\u2026' : lns[0], M + 2, y + 4)

      // pista
      fill([250, 250, 250]); doc.rect(M + LABEL, y, PISTA, ALTO - 1.4, 'F')
      const x = M + LABEL + px(b.offset)
      const w = Math.max(2.4, px(b.dias))
      // Bloqueada por el sitio = ámbar rayado: la fecha no depende de nosotros.
      const color = b.sitio.bloqueada ? AMBAR : b.vencida ? ROJO : GREEN
      fill(color); doc.roundedRect(x, y + 0.5, w, ALTO - 2.4, 0.8, 0.8, 'F')
      if (!d.paraCliente && b.tarea.progress > 0) {
        fill([255, 255, 255])
        doc.setGState(new (doc as any).GState({ opacity: 0.45 }))
        doc.roundedRect(x, y + 0.5, w * (1 - Math.min(1, b.tarea.progress / 100)), ALTO - 2.4, 0.8, 0.8, 'F')
        doc.setGState(new (doc as any).GState({ opacity: 1 }))
      }
      // Etiqueta unica a la derecha de la barra. Fecha + condicion en el mismo
      // renglon: dos textos separados se encimaban cuando la barra era de un dia.
      const cuando = b.soloFin ? fechaCorta(b.fin) : `${fechaCorta(b.inicio)} – ${fechaCorta(b.fin)}`
      const etiqueta = b.sitio.bloqueada ? `${cuando}  ·  sujeto a condición` : cuando
      doc.setFont('helvetica', b.sitio.bloqueada ? 'bold' : 'normal'); doc.setFontSize(5.6)
      txt(b.sitio.bloqueada ? AMBAR : GRAY)
      const ex = x + w + 1.8
      if (ex + doc.getTextWidth(etiqueta) < R) doc.text(etiqueta, ex, y + 3.4)
      y += ALTO
      dibujarHoy(yTop, y)
    }
    y += 2
  }

  // ── Leyenda ───────────────────────────────────────────────────────────────
  espacio(14, TITULO)
  y += 2
  const leyenda: Array<[string, [number, number, number]]> = d.paraCliente
    ? [['En programa', GREEN], ['Sujeto a condición del sitio', AMBAR]]
    : [['En programa', GREEN], ['Sujeto a condición del sitio', AMBAR], ['Vencida', ROJO]]
  let lx = M
  txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8)
  for (const [t, c] of leyenda) {
    fill(c); doc.roundedRect(lx, y, 5, 2.6, 0.6, 0.6, 'F')
    doc.text(t, lx + 6.5, y + 2.2); lx += doc.getTextWidth(t) + 14
  }
  y += 8

  // ── Hoja de condiciones ───────────────────────────────────────────────────
  const condiciones = condicionesDelProyecto(d.barras, d.prereqs)
  const generales = d.generales || []
  if (condiciones.length || generales.length) {
    const T2 = 'Condiciones del sitio'
    nuevaPagina(T2)
    txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    const intro = d.paraCliente
      ? 'Cada trabajo de este programa requiere que el área esté en cierta condición antes de que podamos entrar. No es una restricción administrativa: colocar una bocina de plafón antes de las luminarias obliga a desmontarla para alinearla, y conectar un módulo de control sin circuitos probados deja el sistema sin garantía. Aquí está, por responsable, lo que se necesita.'
      : 'Condiciones del sitio por responsable. Lo pendiente es lo que hay que destrabar antes de programar cuadrilla.'
    doc.splitTextToSize(intro, R - M).forEach((l: string) => { doc.text(l, M, y); y += 4 })
    y += 4

    // Generales de la obra: aplican a todo, no a una tarea. Van primero.
    if (generales.length) {
      espacio(16, T2)
      fill(DARK); doc.rect(M, y, R - M, 5.6, 'F')
      fill(GREEN); doc.rect(M, y, 1.8, 5.6, 'F')
      txt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
      doc.text('DE TODA LA OBRA', M + 4.5, y + 3.9)
      y += 8
      for (const g of generales) {
        const cfg = A_CARGO_CFG[g.a_cargo_de as ACargoDe] || A_CARGO_CFG.otro
        const ln = doc.splitTextToSize(g.descripcion, R - M - 42) as string[]
        espacio(ln.length * 4 + 3, T2)
        txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
        ln.forEach((l, i) => doc.text((i === 0 ? '\u00b7  ' : '   ') + l, M + 2, y + i * 4))
        txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8)
        doc.text(cfg.label, R, y, { align: 'right' })
        y += ln.length * 4 + 1.5
      }
      y += 4
    }

    for (const grupo of condiciones) {
      espacio(26, T2)
      const cfg = A_CARGO_CFG[grupo.aCargo as ACargoDe] || A_CARGO_CFG.otro
      const rgb = ((h: string): [number, number, number] =>
        [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)])(cfg.color)
      fill(DARK); doc.rect(M, y, R - M, 5.6, 'F')
      fill(rgb); doc.rect(M, y, 1.8, 5.6, 'F')
      txt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
      doc.text(cfg.label.toUpperCase(), M + 4.5, y + 3.9)
      y += 8

      for (const it of grupo.items) {
        const tareas = it.tareas.slice(0, 4).join(' · ') + (it.tareas.length > 4 ? ` · +${it.tareas.length - 4}` : '')
        const l1 = doc.splitTextToSize(it.descripcion, R - M - 30) as string[]
        const l2 = doc.splitTextToSize('Aplica a: ' + tareas, R - M - 30) as string[]
        espacio(l1.length * 4 + l2.length * 3.4 + 4, T2)
        txt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
        l1.forEach((l, i) => doc.text((i === 0 ? '·  ' : '   ') + l, M + 2, y + i * 4))
        y += l1.length * 4
        txt([150, 150, 150]); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8)
        l2.forEach((l, i) => doc.text('   ' + l, M + 2, y + i * 3.4))
        // Estado a la derecha: cumplido / pendiente
        txt(it.pendiente ? AMBAR : GREEN); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8)
        doc.text(it.pendiente ? 'PENDIENTE' : 'CUMPLIDO', R, y - l1.length * 4 + 4, { align: 'right' })
        y += l2.length * 3.4 + 2.5
      }
      y += 2
    }
  }

  // ── Pie ───────────────────────────────────────────────────────────────────
  const paginas = (doc as any).internal.getNumberOfPages()
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p)
    fill(GREEN); doc.rect(M, H - 9, R - M, 0.4, 'F')
    txt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
    const izq = [sinPlaceholder(id.razonSocial) || 'OMM Technologies',
      sinPlaceholder(id.rfc) ? `RFC ${sinPlaceholder(id.rfc)}` : ''].filter(Boolean).join('  ·  ')
    doc.text(izq, M, H - 5.5)
    doc.text(`${TITULO}  ·  ${d.obra}  ·  Pág. ${p}/${paginas}`, R, H - 5.5, { align: 'right' })
  }
  return doc
}
