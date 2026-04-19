/**
 * Parser for SFacil NOMINAS PDF documents
 * Loads pdf.js dynamically from CDN to avoid Vercel build issues
 * Uses multiple strategies for robust text extraction and employee matching
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
  rawText?: string // for debugging
}

/* ── Dynamic pdf.js loader ── */

let pdfjsLoaded: any = null

async function loadPdfJs(): Promise<any> {
  if (pdfjsLoaded) return pdfjsLoaded
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

/* ── Text extraction with better line handling ── */

async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjsLib = await loadPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    // Group text items by Y position to reconstruct lines
    const items = content.items as any[]
    if (items.length === 0) continue

    // Sort by Y (descending = top to bottom) then X (ascending = left to right)
    const sorted = [...items].sort((a, b) => {
      const dy = b.transform[5] - a.transform[5]
      if (Math.abs(dy) > 3) return dy // different line (3px tolerance)
      return a.transform[4] - b.transform[4] // same line, sort by X
    })

    let lastY = sorted[0]?.transform[5] ?? 0
    let line = ''

    for (const item of sorted) {
      const y = item.transform[5]
      if (Math.abs(y - lastY) > 3) {
        // New line
        fullText += line.trim() + '\n'
        line = ''
        lastY = y
      }
      line += item.str + ' '
    }
    fullText += line.trim() + '\n\n'
  }

  return fullText
}

/* ── Main parser ── */

export async function parseSFacilNominaPDF(file: File): Promise<NominaPDFResult> {
  const fullText = await extractTextFromPdf(file)

  console.log('[NominaPDF] Extracted text (first 3000 chars):', fullText.substring(0, 3000))

  // Extract period info
  const freqMatch = fullText.match(/NOMINA\s+(SEMANAL|QUINCENAL)/i)
  const frequency = (freqMatch?.[1]?.toLowerCase() || 'semanal') as 'semanal' | 'quincenal'

  const periodoMatch = fullText.match(/PERIODO\s+NO\.?\s*(\d+)/i)
  const numeroPeriodo = periodoMatch ? parseInt(periodoMatch[1]) : 0

  const dateMatch = fullText.match(/DEL\s+(\d{2})\/(\d{2})\/(\d{4})\s+AL\s+(\d{2})\/(\d{2})\/(\d{4})/)
  let periodStart = ''
  let periodEnd = ''
  if (dateMatch) {
    periodStart = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
    periodEnd = `${dateMatch[6]}-${dateMatch[5]}-${dateMatch[4]}`
  }

  // Strategy 1: Extract names using 6-digit employee number pattern
  // Handles: "000001 MEDEL MEDEL LUIS ALEJANDRO" or "000001  MEDEL MEDEL LUIS ALEJANDRO RFC:"
  let names: string[] = []
  let rfcs: string[] = []

  const blockPattern = /0{2,}\d+\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+)/g
  let m
  while ((m = blockPattern.exec(fullText)) !== null) {
    let name = m[1].trim()
    // Remove everything after RFC:, Puesto:, Fijo, etc.
    name = name.split(/\s+(?:RFC|Puesto|Fijo|Salario|No\.|Departamento)/i)[0].trim()
    // Remove trailing single letters
    name = name.replace(/\s+[A-Z]$/g, '').trim()
    if (name.length > 3) names.push(name)
  }

  // Strategy 2: Extract RFCs
  const rfcPattern = /RFC:\s*([A-Z]{3,4}\d{6}[A-Z0-9]{2,3})/gi
  while ((m = rfcPattern.exec(fullText)) !== null) {
    rfcs.push(m[1].toUpperCase())
  }

  // Strategy 3: If Strategy 1 found no names, try broader pattern
  if (names.length === 0) {
    console.log('[NominaPDF] Strategy 1 failed, trying Strategy 3...')
    // Look for lines that are all uppercase words (likely names)
    const lines = fullText.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      // Name lines: all caps, 2+ words, no numbers, no special keywords
      if (/^[A-ZÁÉÍÓÚÑ]{2,}(\s+[A-ZÁÉÍÓÚÑ]{2,})+$/.test(trimmed) && trimmed.length > 5) {
        if (!/SUELDO|TOTAL|PERCEPCIONES|DEDUCCIONES|TIPO|NOMINA|TECHNOLOGIES|BOSQUES|MEXICO|PERIODO/i.test(trimmed)) {
          names.push(trimmed)
        }
      }
    }
  }

  console.log('[NominaPDF] Names found:', names)
  console.log('[NominaPDF] RFCs found:', rfcs)

  // Extract "Neto a Pagar" amounts - multiple patterns for robustness
  const netos: number[] = []
  const netoPatterns = [
    /Neto\s+a\s+Pagar:?\s*\$?([\d,]+\.\d{2})/gi,
    /Neto\s*a\s*Pagar\s*:?\s*\$?\s*([\d,]+\.\d{2})/gi,
  ]
  for (const pat of netoPatterns) {
    while ((m = pat.exec(fullText)) !== null) {
      const val = parseFloat(m[1].replace(/,/g, ''))
      if (!netos.includes(val) || netos.length < names.length) {
        netos.push(val)
      }
    }
    if (netos.length >= names.length) break
  }

  // Extract percepciones and deducciones
  const percepciones: number[] = []
  const percepPattern = /Total\s+Percepciones:?\s*\$?([\d,]+\.\d{2})/gi
  while ((m = percepPattern.exec(fullText)) !== null) {
    percepciones.push(parseFloat(m[1].replace(/,/g, '')))
  }

  const deducciones: number[] = []
  const deducPattern = /Total\s+Deducciones:?\s*\$?([\d,]+\.\d{2})/gi
  while ((m = deducPattern.exec(fullText)) !== null) {
    deducciones.push(parseFloat(m[1].replace(/,/g, '')))
  }

  // Extract SDI
  const sdis: number[] = []
  const sdiPattern = /S\.?D\.?I\.?:?\s*([\d,]+\.\d{2})/gi
  while ((m = sdiPattern.exec(fullText)) !== null) {
    sdis.push(parseFloat(m[1].replace(/,/g, '')))
  }

  console.log('[NominaPDF] Netos found:', netos.length, netos)

  // Build employee records
  const count = Math.max(names.length, netos.length)
  const empleados: NominaEmpleadoPDF[] = []

  for (let i = 0; i < count; i++) {
    empleados.push({
      nombre: names[i] || `Empleado ${i + 1}`,
      rfc: rfcs[i] || '',
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
    rawText: fullText.substring(0, 5000),
  }
}

/* ── Employee matching: fuzzy name + RFC ── */

export function matchEmployeeByName(
  pdfEmpleado: { nombre: string; rfc: string },
  dbEmployees: { id: string; nombre: string; rfc?: string | null }[],
): { id: string; nombre: string; score: number } | null {

  // Strategy 1: Match by RFC (most reliable)
  if (pdfEmpleado.rfc && pdfEmpleado.rfc.length >= 10) {
    const rfcMatch = dbEmployees.find(e =>
      e.rfc && e.rfc.toUpperCase() === pdfEmpleado.rfc.toUpperCase()
    )
    if (rfcMatch) return { id: rfcMatch.id, nombre: rfcMatch.nombre, score: 1.0 }
  }

  // Strategy 2: Fuzzy word-set matching (handles different name order)
  const pdfWords = normalizeWords(pdfEmpleado.nombre)
  let bestMatch: { id: string; nombre: string; score: number } | null = null

  for (const emp of dbEmployees) {
    const dbWords = normalizeWords(emp.nombre)

    // Count matching words (order-independent)
    let matches = 0
    const usedDb = new Set<number>() // track used DB words to avoid double-counting

    for (const pw of pdfWords) {
      for (let di = 0; di < dbWords.length; di++) {
        if (usedDb.has(di)) continue
        const dw = dbWords[di]
        if (pw === dw || levenshtein(pw, dw) <= 1) {
          matches++
          usedDb.add(di)
          break
        }
      }
    }

    // Score: matches / max words, with a bonus if all DB words matched
    const maxLen = Math.max(pdfWords.length, dbWords.length)
    let score = maxLen > 0 ? matches / maxLen : 0

    // Boost if all short-name (DB) words are found in long-name (PDF)
    if (matches === dbWords.length && dbWords.length >= 2) {
      score = Math.max(score, 0.8)
    }

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
