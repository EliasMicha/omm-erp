/**
 * Parser for SFacil NOMINAS PDF documents
 * Extracts per-employee payroll data: name, RFC, percepciones, deducciones, neto a pagar
 */

import * as pdfjsLib from 'pdfjs-dist'

// Use bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`

export interface NominaEmpleadoPDF {
  nombre: string
  rfc: string
  sdi: number
  percepciones: number
  deducciones: number
  netoAPagar: number
  isr: number
  cuotasImss: number
  infonavit: number
}

export interface NominaPDFResult {
  frequency: 'semanal' | 'quincenal'
  periodStart: string // YYYY-MM-DD
  periodEnd: string
  numeroPeriodo: number
  empleados: NominaEmpleadoPDF[]
  totalPercepciones: number
  totalDeducciones: number
  totalNeto: number
}

/**
 * Parse a SFacil NOMINAS PDF file and extract employee payroll data
 */
export async function parseSFacilNominaPDF(file: File): Promise<NominaPDFResult> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item: any) => item.str)
      .join(' ')
    fullText += pageText + '\n\n'
  }

  // Extract period info
  const freqMatch = fullText.match(/NOMINA\s+(SEMANAL|QUINCENAL)/)
  const frequency = freqMatch?.[1]?.toLowerCase() as 'semanal' | 'quincenal' || 'semanal'

  const periodoMatch = fullText.match(/PERIODO\s+NO\.\s*(\d+)/)
  const numeroPeriodo = periodoMatch ? parseInt(periodoMatch[1]) : 0

  const dateMatch = fullText.match(/DEL\s+(\d{2})\/(\d{2})\/(\d{4})\s+AL\s+(\d{2})\/(\d{2})\/(\d{4})/)
  let periodStart = ''
  let periodEnd = ''
  if (dateMatch) {
    periodStart = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
    periodEnd = `${dateMatch[6]}-${dateMatch[5]}-${dateMatch[4]}`
  }

  // Parse employee blocks using RFC as anchor
  // RFCs appear as: RFC: XXXX######XXX
  const rfcPattern = /RFC:\s*([A-Z]{3,4}\d{6}[A-Z0-9]{2,3})/g
  const rfcs: string[] = []
  let m
  while ((m = rfcPattern.exec(fullText)) !== null) {
    rfcs.push(m[1])
  }

  // Extract names — they appear after employee number like: 000001 NAME NAME NAME
  const namePattern = /\d{6}\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]+?)(?:\s+RFC:|\s+Puesto:)/g
  const names: string[] = []
  while ((m = namePattern.exec(fullText)) !== null) {
    names.push(m[1].trim())
  }

  // Extract SDI values
  const sdiPattern = /S\.D\.I\.:\s*([\d,]+\.\d{2})/g
  const sdis: number[] = []
  while ((m = sdiPattern.exec(fullText)) !== null) {
    sdis.push(parseFloat(m[1].replace(',', '')))
  }

  // Extract "Neto a Pagar:" amounts
  const netoPattern = /Neto a Pagar:\s*\$?([\d,]+\.\d{2})/g
  const netos: number[] = []
  while ((m = netoPattern.exec(fullText)) !== null) {
    netos.push(parseFloat(m[1].replace(',', '')))
  }

  // Extract Total Percepciones per employee
  const percepPattern = /Total Percepciones:\s*\$?([\d,]+\.\d{2})/g
  const percepciones: number[] = []
  while ((m = percepPattern.exec(fullText)) !== null) {
    percepciones.push(parseFloat(m[1].replace(',', '')))
  }

  // Extract Total Deducciones per employee
  const deducPattern = /Total Deducciones:\s*\$?([\d,]+\.\d{2})/g
  const deducciones: number[] = []
  while ((m = deducPattern.exec(fullText)) !== null) {
    deducciones.push(parseFloat(m[1].replace(',', '')))
  }

  // Build employee records
  const count = Math.min(names.length, netos.length)
  const empleados: NominaEmpleadoPDF[] = []

  for (let i = 0; i < count; i++) {
    // Clean name — remove trailing "RFC" if present
    let nombre = names[i]?.replace(/\s*RFC\s*$/, '').trim() || ''

    empleados.push({
      nombre,
      rfc: rfcs[i] || '',
      sdi: sdis[i] || 0,
      percepciones: percepciones[i] || 0,
      deducciones: deducciones[i] || 0,
      netoAPagar: netos[i] || 0,
      isr: 0, // Could parse individually but summary is enough
      cuotasImss: 0,
      infonavit: 0,
    })
  }

  // Parse individual deductions from text blocks
  // Look for ISR, Cuotas IMSS, D.INFONAVIT per employee
  const isrPattern = /ISR\s+([\d,]+\.\d{2})/g
  const isrValues: number[] = []
  while ((m = isrPattern.exec(fullText)) !== null) {
    isrValues.push(parseFloat(m[1].replace(',', '')))
  }

  const imssPattern = /Cuotas IMSS\s+([\d,]+\.\d{2})/g
  const imssValues: number[] = []
  while ((m = imssPattern.exec(fullText)) !== null) {
    imssValues.push(parseFloat(m[1].replace(',', '')))
  }

  const infonavitPattern = /D\.?INFONAVIT\s+([\d,]+\.\d{2})/g
  const infonavitValues: number[] = []
  while ((m = infonavitPattern.exec(fullText)) !== null) {
    infonavitValues.push(parseFloat(m[1].replace(',', '')))
  }

  return {
    frequency,
    periodStart,
    periodEnd,
    numeroPeriodo,
    empleados,
    totalPercepciones: percepciones.reduce((s, v) => s + v, 0),
    totalDeducciones: deducciones.reduce((s, v) => s + v, 0),
    totalNeto: netos.reduce((s, v) => s + v, 0),
  }
}

/**
 * Fuzzy match a PDF employee name to DB employees.
 * PDF names are "LASTNAME LASTNAME FIRSTNAME" while DB might be "FIRSTNAME LASTNAME LASTNAME"
 * Strategy: compare word sets (case-insensitive), pick best overlap
 */
export function matchEmployeeByName(
  pdfName: string,
  dbEmployees: { id: string; nombre: string }[],
): { id: string; nombre: string; score: number } | null {
  const pdfWords = normalizeWords(pdfName)

  let bestMatch: { id: string; nombre: string; score: number } | null = null

  for (const emp of dbEmployees) {
    const dbWords = normalizeWords(emp.nombre)

    // Count matching words
    let matches = 0
    for (const pw of pdfWords) {
      for (const dw of dbWords) {
        if (pw === dw || levenshtein(pw, dw) <= 1) {
          matches++
          break
        }
      }
    }

    // Score: matches / max(pdfWords, dbWords)
    const maxLen = Math.max(pdfWords.length, dbWords.length)
    const score = maxLen > 0 ? matches / maxLen : 0

    if (score > 0.5 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { id: emp.id, nombre: emp.nombre, score }
    }
  }

  return bestMatch
}

function normalizeWords(name: string): string[] {
  return name
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .split(/\s+/)
    .filter(w => w.length > 1) // skip single letters
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}
