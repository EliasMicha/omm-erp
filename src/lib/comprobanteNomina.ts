/**
 * Comprobante de pago de nómina → quién ya cobró.
 *
 * BBVA cambió el formato (oct-2026). El "Resumen general de grupo de Pago de
 * nómina" ya NO trae la cuenta completa: trae •5627 (últimos 4), el nombre del
 * TITULAR de la cuenta y el importe. Y las transferencias SPEI a otros bancos
 * suelen llegar como captura de pantalla de la banca en línea (CLABE completa,
 * nombre cortado con "...", importe).
 *
 * Por eso el cruce ya no es "cuenta completa = cuenta del empleado":
 *   1. Cuenta/CLABE completa igual → es él.
 *   2. Últimos 4 iguales + (importe igual o nombre parecido) → es él.
 *   3. Sin cuenta: nombre parecido + importe igual → es él.
 * El nombre NO manda: el titular de la cuenta puede ser otra persona (pasa:
 * la nómina de un empleado cae en la cuenta de un familiar). Por eso cuenta +
 * importe pesan más que el nombre, y cuando no coincide el nombre se avisa.
 *
 * Lectura:
 *   · PDF con texto → se lee por posición de cada renglón (sin IA, gratis).
 *     También sigue leyendo el formato viejo (cuenta de 10/18 dígitos + importe).
 *   · Imagen, o PDF que no se pudo leer → Claude (visión) vía /api/anthropic.
 */
import { loadPdfJs, matchEmployeeByName } from './nominaPdfParser'

export interface PagoComprobante {
  cuenta: string        // sólo dígitos; completa o los últimos 4
  parcial: boolean      // true = sólo últimos 4 (•5627)
  nombre: string
  importe: number | null
  exitoso: boolean
}

export interface LecturaComprobante {
  pagos: PagoComprobante[]
  origen: 'pdf' | 'ia'
}

export interface EmpleadoParaPago {
  itemId: string
  nombre: string
  cuenta: string | null
  clabe: string | null
  neto: number
}

export interface ResultadoCruce {
  marcar: string[]                 // payroll_items.id a marcar como pagados
  sinEmpleado: PagoComprobante[]   // pagos del comprobante que no encontré en el periodo
  avisos: string[]
}

const RE_IMPORTE = /^\$?\s*([\d,]+\.\d{2})$/
const RE_FECHA = /^\d{1,2}\/\d{1,2}\/\d{4}$/
const RE_CUENTA_PARCIAL = /^[•*·∙●]\s*(\d{4})$/
const RE_CUENTA_COMPLETA = /^(\d{10}|\d{18})$/
const RE_ESTADO = /exitos|rechaz|pendient|liquidad|aplicad|devuel|cancel/i

const num = (s: string): number => Number(String(s).replace(/[^\d.]/g, ''))
const soloDigitos = (s: string | null | undefined): string => String(s || '').replace(/\D/g, '')

interface ItemPdf { s: string; x: number; y: number }

/* ── PDF por posición ─────────────────────────────────────────────────── */

async function leerPdfPorPosicion(file: File): Promise<PagoComprobante[]> {
  const pdfjsLib = await loadPdfJs()
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const pagos: PagoComprobante[] = []
  let textoPlano = ''

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const items: ItemPdf[] = (content.items as any[])
      .map(it => ({ s: String(it.str || '').trim(), x: it.transform[4], y: it.transform[5] }))
      .filter(it => it.s)
    textoPlano += items.map(i => i.s).join(' ') + '\n'

    // Un renglón de pago = una cuenta con una fecha a la misma altura.
    // (La cuenta de ORIGEN "•3020" no tiene fecha al lado: queda fuera.)
    const anclas = items.filter(it =>
      (RE_CUENTA_PARCIAL.test(it.s) || RE_CUENTA_COMPLETA.test(it.s)) &&
      items.some(o => o !== it && RE_FECHA.test(o.s) && Math.abs(o.y - it.y) <= 3),
    ).sort((a, b) => b.y - a.y)

    for (let i = 0; i < anclas.length; i++) {
      const a = anclas[i]
      const arriba = i === 0 ? a.y + 25 : (anclas[i - 1].y + a.y) / 2
      const abajo = i === anclas.length - 1 ? a.y - 25 : (anclas[i + 1].y + a.y) / 2
      const banda = items
        .filter(it => it.y <= arriba && it.y > abajo && it !== a)
        .sort((m, n) => (Math.abs(n.y - m.y) > 3 ? n.y - m.y : m.x - n.x))

      const parcial = RE_CUENTA_PARCIAL.exec(a.s)
      const montoItem = banda.find(it => RE_IMPORTE.test(it.s))
      const estadoItem = banda.find(it => RE_ESTADO.test(it.s))
      const nombre = banda
        .filter(it => /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(it.s) && it !== estadoItem &&
          !/^(MXN|USD|SPEI|NOMINA|NÓMINA)$/i.test(it.s) && !RE_FECHA.test(it.s))
        .map(it => it.s).join(' ').replace(/\s+/g, ' ').trim()

      pagos.push({
        cuenta: parcial ? parcial[1] : a.s,
        parcial: !!parcial,
        nombre,
        importe: montoItem ? num(montoItem.s) : null,
        exitoso: estadoItem ? /exitos|liquidad|aplicad/i.test(estadoItem.s) : true,
      })
    }
  }

  // Formato viejo: "<cuenta 10/18 dígitos> $1,234.56" en el texto corrido.
  if (!pagos.length) {
    const re = /\b(\d{18}|\d{10})\b\s*\$?\s*([\d,]+\.\d{2})/g
    let m: RegExpExecArray | null
    while ((m = re.exec(textoPlano)) !== null) {
      pagos.push({ cuenta: m[1], parcial: false, nombre: '', importe: num(m[2]), exitoso: true })
    }
  }
  return pagos
}

/* ── Imagen / PDF ilegible → Claude ───────────────────────────────────── */

async function aBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)))
  return btoa(bin)
}

/** Reduce la captura a ≤1800 px y JPEG: el body de Vercel tope ~4.5 MB. */
async function imagenLigera(file: File): Promise<{ data: string; mediaType: string }> {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * k)
    canvas.height = Math.round(bmp.height * k)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('sin canvas')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const url = canvas.toDataURL('image/jpeg', 0.9)
    const coma = url.indexOf(',')
    if (coma < 0 || !url.startsWith('data:image/jpeg')) throw new Error('sin jpeg')
    return { data: url.slice(coma + 1), mediaType: 'image/jpeg' }
  } catch {
    return { data: await aBase64(file), mediaType: file.type || 'image/png' }
  }
}

const PROMPT_IA = `Es un comprobante bancario de pagos de nómina o transferencias (BBVA u otro banco: PDF o captura de pantalla).
Extrae CADA renglón de pago. Responde SOLO JSON, sin texto ni backticks:
{"pagos":[{"nombre":"destinatario/empleado tal cual aparece","cuenta":"sólo los dígitos de la cuenta o CLABE del destinatario; si aparece enmascarada como •5627 pon sólo 5627","importe":4725.60,"estado":"Exitoso|Rechazado|Pendiente|..."}]}
Reglas: no inventes renglones; no incluyas la cuenta de ORIGEN (la de la empresa que paga); importe como número sin comas; si un dato no se ve, pon "" o null.`

async function leerConIA(file: File, esPdf: boolean): Promise<PagoComprobante[]> {
  const bloque = esPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await aBase64(file) } }
    : await imagenLigera(file).then(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }))
  const r = await fetch('/api/anthropic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6', max_tokens: 4000,
      messages: [{ role: 'user', content: [bloque, { type: 'text', text: PROMPT_IA }] }],
    }),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok || !j) throw new Error('No pude leer el comprobante con IA: ' + (j?.error?.message || r.status))
  const texto = (j.content || []).map((c: any) => c.text || '').join('')
  const crudo = texto.match(/\{[\s\S]*\}/)
  if (!crudo) throw new Error('La IA no devolvió renglones legibles del comprobante.')
  let lista: any[] = []
  try { lista = JSON.parse(crudo[0]).pagos || [] } catch { throw new Error('La IA devolvió un formato inválido.') }
  return lista.map((p: any) => {
    const cuenta = soloDigitos(p.cuenta)
    const importe = p.importe === null || p.importe === undefined || p.importe === '' ? null : num(String(p.importe))
    return {
      cuenta,
      parcial: cuenta.length > 0 && cuenta.length < 10,
      nombre: String(p.nombre || '').replace(/[.…]+$/, '').trim(),
      importe: importe && importe > 0 ? importe : null,
      exitoso: !p.estado || /exitos|liquidad|aplicad|complet|pagad/i.test(String(p.estado)),
    }
  }).filter(p => p.cuenta || p.nombre)
}

export async function leerComprobantePagos(file: File): Promise<LecturaComprobante> {
  const esPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)
  if (esPdf) {
    let pagos: PagoComprobante[] = []
    try { pagos = await leerPdfPorPosicion(file) } catch { pagos = [] }
    if (pagos.length) return { pagos, origen: 'pdf' }
  }
  return { pagos: await leerConIA(file, esPdf), origen: 'ia' }
}

/* ── Cruce contra los empleados del periodo ───────────────────────────── */

const fmt = (n: number): string => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const palabras = (s: string): string[] =>
  s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(w => w.length > 0)

function nombreParecido(a: string, b: string): boolean {
  if (!a || !b) return false
  const m = matchEmployeeByName({ nombre: a, rfc: '' }, [{ id: 'x', nombre: b }])
  if (m && m.score >= 0.6) return true
  // Nombre cortado por la banca en línea ("DAFNE ROMERO M..."): cada palabra
  // del comprobante es el inicio de una palabra distinta del empleado.
  const pa = palabras(a), pb = palabras(b)
  if (pa.length < 2) return false
  const usadas = new Set<number>()
  return pa.every(w => {
    const i = pb.findIndex((x, k) => !usadas.has(k) && x.startsWith(w))
    if (i < 0) return false
    usadas.add(i)
    return true
  })
}

export function cruzarPagos(pagos: PagoComprobante[], emps: EmpleadoParaPago[]): ResultadoCruce {
  const marcar: string[] = []
  const sinEmpleado: PagoComprobante[] = []
  const avisos: string[] = []
  const usados = new Set<string>()

  for (const p of pagos) {
    if (!p.exitoso) { avisos.push(`${p.nombre || 'Cuenta ' + p.cuenta}: el banco lo marca como NO exitoso; no lo marqué.`); continue }
    const libres = emps.filter(e => !usados.has(e.itemId))
    const importeOk = (e: EmpleadoParaPago) => p.importe !== null && Math.abs(e.neto - p.importe) < 0.015
    const nombreOk = (e: EmpleadoParaPago) => nombreParecido(p.nombre, e.nombre)

    let elegido: EmpleadoParaPago | null = null
    if (p.cuenta && !p.parcial) {
      const c = libres.filter(e => soloDigitos(e.cuenta) === p.cuenta || soloDigitos(e.clabe) === p.cuenta)
      if (c.length === 1) elegido = c[0]
    } else if (p.cuenta && p.parcial) {
      const c = libres.filter(e => {
        const cu = soloDigitos(e.cuenta), cl = soloDigitos(e.clabe)
        return (cu.length >= 4 && cu.endsWith(p.cuenta)) || (cl.length >= 4 && cl.endsWith(p.cuenta))
      })
      const fuertes = c.filter(e => importeOk(e) && nombreOk(e))
      const buenos = c.filter(e => importeOk(e) || nombreOk(e))
      if (fuertes.length === 1) elegido = fuertes[0]
      else if (buenos.length === 1) elegido = buenos[0]
    } else {
      const c = libres.filter(e => importeOk(e) && nombreOk(e))
      if (c.length === 1) elegido = c[0]
    }

    if (!elegido) { sinEmpleado.push(p); continue }
    usados.add(elegido.itemId)
    marcar.push(elegido.itemId)
    const etiqueta = p.parcial ? `•${p.cuenta}` : p.cuenta
    if (p.nombre && !nombreOk(elegido)) {
      avisos.push(`"${p.nombre}" (cuenta ${etiqueta}) lo tomé como ${elegido.nombre}: coincide la cuenta${importeOk(elegido) ? ' y el importe' : ''}, el nombre no (la cuenta puede ser de un familiar).`)
    }
    if (p.importe !== null && !importeOk(elegido)) {
      avisos.push(`${elegido.nombre}: el comprobante dice ${fmt(p.importe)} y la nómina ${fmt(elegido.neto)}.`)
    }
  }
  return { marcar, sinEmpleado, avisos }
}
