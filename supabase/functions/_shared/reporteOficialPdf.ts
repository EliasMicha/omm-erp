// Reporte oficial de obra en PDF — lo que el coordinador le manda a un
// residente, segurista o cliente cuando algo en sitio no depende de OMM
// (otra contratista dañó trabajo, el área no está lista, un riesgo de
// seguridad, un cambio que pide el cliente) o cuando conviene dejarlo por
// escrito.
//
// Corre en Deno (bot de WhatsApp) y en el navegador: jsPDF puro, sin DOM.
// Va el export CON NOMBRE de jspdf por la misma razón que estadoCuentaPdf.ts:
// fuera del navegador el default no es un constructor.
import { jsPDF } from 'jspdf'

export interface FotoReporte { data: Uint8Array; formato: 'JPEG' | 'PNG'; pie?: string }

export interface ReporteOficialInput {
  folio: string
  fecha: string                 // AAAA-MM-DD
  para: 'residente' | 'segurista' | 'cliente' | 'otro'
  dirigido_a?: string | null    // "Ing. Pérez, residente de obra (Grupo X)"
  obra: { nombre: string; direccion?: string | null; cliente?: string | null }
  asunto: string
  hechos: string[]
  solicitudes: string[]
  fotos?: FotoReporte[]
  elaboro: { nombre: string; puesto?: string | null }
}

const ROL: Record<string, string> = { residente: 'Residente de obra', segurista: 'Seguridad e higiene', cliente: 'Cliente', otro: '' }

export function generarReporteOficialPdf(r: ReporteOficialInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const M = 18
  const RIGHT = W - M
  const ANCHO = RIGHT - M
  let y = 16
  const GREEN: [number, number, number] = [16, 185, 129]
  const DARK: [number, number, number] = [26, 26, 26]
  const GRAY: [number, number, number] = [110, 110, 110]
  const setTxt = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const setFill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const nueva = () => { doc.addPage(); y = 18 }
  const espacio = (n: number) => { if (y + n > 255) nueva() }
  const fechaLarga = new Date(r.fecha + 'T12:00:00Z').toLocaleDateString('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })

  // Encabezado
  setFill(GREEN); doc.rect(M, y, 5, 5, 'F')
  setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('OMM TECHNOLOGIES', M + 7.5, y + 4)
  setTxt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text(`${r.folio} · ${fechaLarga}`, RIGHT, y + 4, { align: 'right' })
  y += 12
  setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
  doc.text('Reporte de obra', M, y); y += 7
  setTxt([60, 60, 60]); doc.setFont('helvetica', 'normal'); doc.setFontSize(11)
  for (const l of doc.splitTextToSize(r.obra.nombre, ANCHO)) { doc.text(l, M, y); y += 5 }
  if (r.obra.direccion) { setTxt(GRAY); doc.setFontSize(9); for (const l of doc.splitTextToSize(r.obra.direccion, ANCHO)) { doc.text(l, M, y); y += 4.2 } }
  setFill(GREEN); doc.rect(M, y + 1, ANCHO, 0.8, 'F'); y += 7

  // Datos
  const fila = (etq: string, val: string) => {
    if (!val) return
    const lineas = doc.splitTextToSize(val, ANCHO - 30)
    espacio(lineas.length * 4.8 + 2)
    setTxt(GRAY); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(etq.toUpperCase(), M, y)
    setTxt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    lineas.forEach((l: string, i: number) => doc.text(l, M + 30, y + i * 4.8))
    y += lineas.length * 4.8 + 2
  }
  const rol = ROL[r.para] || ''
  const yaDiceRol = !!r.dirigido_a && !!rol && r.dirigido_a.toLowerCase().includes(rol.split(' ')[0].toLowerCase())
  fila('Para', [r.dirigido_a, yaDiceRol ? '' : rol].filter(Boolean).join(' — '))
  if (r.obra.cliente) fila('Cliente', r.obra.cliente)
  fila('Asunto', r.asunto)
  y += 3

  const seccion = (titulo: string, items: string[]) => {
    if (!items.length) return
    espacio(14)
    setFill(DARK); doc.rect(M, y, ANCHO, 7, 'F'); setFill(GREEN); doc.rect(M, y, 2, 7, 'F')
    setTxt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    doc.text(titulo.toUpperCase(), M + 5, y + 4.8); y += 11
    setTxt(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    items.forEach((it, i) => {
      const lineas = doc.splitTextToSize(String(it), ANCHO - 8)
      espacio(lineas.length * 5 + 2)
      doc.setFont('helvetica', 'bold'); doc.text(`${i + 1}.`, M, y)
      doc.setFont('helvetica', 'normal')
      lineas.forEach((l: string, k: number) => doc.text(l, M + 7, y + k * 5))
      y += lineas.length * 5 + 2
    })
    y += 3
  }
  seccion('Lo que observamos', r.hechos)
  seccion('Lo que solicitamos', r.solicitudes)

  // Evidencia: dos por renglón, respetando la proporción de cada foto.
  const fotos = (r.fotos || []).slice(0, 8)
  if (fotos.length) {
    espacio(20)
    setFill(DARK); doc.rect(M, y, ANCHO, 7, 'F'); setFill(GREEN); doc.rect(M, y, 2, 7, 'F')
    setTxt([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    doc.text('EVIDENCIA FOTOGRÁFICA', M + 5, y + 4.8); y += 11
    const gap = 6
    const celda = (ANCHO - gap) / 2
    const altoMax = 70
    for (let i = 0; i < fotos.length; i += 2) {
      const par = fotos.slice(i, i + 2).map(f => {
        let w = celda, h = altoMax
        try {
          const p = doc.getImageProperties(f.data)
          const k = Math.min(celda / p.width, altoMax / p.height)
          w = p.width * k; h = p.height * k
        } catch (_) { /* proporción por omisión */ }
        return { f, w, h }
      })
      const altoFotos = Math.max(...par.map(p => p.h))
      const alto = altoFotos + 8
      espacio(alto)
      par.forEach((p, j) => {
        const x = M + j * (celda + gap) + (celda - p.w) / 2
        try { doc.addImage(p.f.data, p.f.formato, x, y, p.w, p.h) }
        catch (_) { setTxt(GRAY); doc.setFontSize(8); doc.text('(foto no legible)', x + 2, y + 6) }
        if (p.f.pie) {
          setTxt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
          doc.text(doc.splitTextToSize(p.f.pie, celda)[0], x, y + altoFotos + 4)
        }
      })
      y += alto
    }
  }

  // Firma
  espacio(28)
  y += 8
  doc.setDrawColor(180, 180, 180); doc.line(M, y + 10, M + 70, y + 10)
  setTxt(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text(r.elaboro.nombre, M, y + 15)
  setTxt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text([r.elaboro.puesto, 'OMM Technologies SA de CV'].filter(Boolean).join(' · '), M, y + 19.5)

  const paginas = doc.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    setTxt(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    doc.text(`${r.folio} · OMM Technologies`, M, 272)
    doc.text(`Página ${i} de ${paginas}`, RIGHT, 272, { align: 'right' })
  }
  return doc
}
