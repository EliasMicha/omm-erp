/**
 * Parser for SFacil NOMINAS PDF documents
 * Loads pdf.js dynamically from CDN to avoid Vercel build issues
 */

export interface NominaEmpleadoPDF {
  nombre: string
  rfc: string
  sdi: number
  percepciones: number
  deducciones: number
  netoAPagar: number
}

export interface NominaPDFResult {
  frequency: 'semanal' | 'quincenal'
  periodStart: string
  periodEnd: string
  numeroPeriodo: number
  empleados: NominaEmpleadoPDF[]
  totalPercepciones: number
  totalDeducciones: number
  totalNeto: number
}

/* ── Dynamic pdf.js loader ── */

let pdfjsLoaded: any = null

async function loadPdfJs(): Promise<any> {
  if (pdfjsLoaded) return pdfjsLoaded

  // Load pdf.js from CDN dynamically
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    script.onload = () => {
      const lib = (window as any).pdfjsLib
      if (!lib) { reject(new Error('pdfjsLib not found')); return }
      lib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      pdfjsLoaded = lib
      resolve(lib)
    }
    script.onerror = () => reject(new Error('Failed to load pdf.js from CDN'))
    document.head.appendChild(script)
  })
}

/* ── Main parser ── */

export async function parseSFacilNominaPDF(file: File): Promise<NominaPDFResult> {
  const pdfjsLib = await loadPdfJs()

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
  const frequency = (freqMatch?.[1]?.toLowerCase() || 'semanal') as 'semanal' | 'quincenal'

  const periodoMatch = fullText.match(/PERIODO\s+NO\.\s*(\d+)/)
  const numeroPeriodo = periodoMatch ? parseInt(periodoMatch[1]) : 0

  const dateMatch = fullText.match(/DEL\s+(\d{2})\/(\d{2})\/(\d{4})\s+AL\s+(\d{2})\/(\d{2})\/(\d{4})/)
  let periodStart = ''
  let periodEnd = ''
  if (dateMatch) {
    periodStart = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
    periodEnd = `${dateMatch[6]}-${dateMatch[5]}-${dateMatch[4]}`
  }

  // Extract names — appear after 6-digit employee number: 000001 NAME NAME NAME
  const namePattern = /\d{6}\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]+?)(?:\s+RFC:|\s+Puesto:)/g
  const names: string[] = []
  let m
  while ((m = namePattern.exec(fullText)) !== null) {
    names.push(m[1].replace(/\s*RFC\s*$/, '').trim())
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
    empleados.push({
      nombre: names[i] || '',
      rfc: '',
      sdi: sdis[i] || 0,
      percepciones: percepciones[i] || 0,
      deducciones: deducciones[i] || 0,
      netoAPagar: netos[i] || 0,
    })
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

/* ── Fuzzy name matching ── */

export function matchEmployeeByName(
  pdfName: string,
  dbEmployees: { id: string; nombre: string }[],
): { id: string; nombre: string; score: number } | null {
  const pdfWords = normalizeWords(pdfName)

  let bestMatch: { id: string; nombre: string; score: number } | null = null

  for (const emp of dbEmployees) {
    const dbWords = normalizeWords(emp.nombre)

    let matches = 0
    for (const pw of pdfWords) {
      for (const dw of dbWords) {
        if (pw === dw || levenshtein(pw, dw) <= 1) {
          matches++
          break
        }
      }
    }

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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1)
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
