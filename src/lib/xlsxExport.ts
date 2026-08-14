// ═══════════════════════════════════════════════════════════════════════════
// Generador de XLSX (Excel) sin dependencias
//
// Escribe un .xlsx de verdad — no un CSV con otra extensión ni un HTML
// disfrazado, que es lo que hace que Excel salga con la advertencia de
// "el formato no coincide con la extensión". Aquí se arma el ZIP a mano
// (método STORE, sin comprimir: válido y sin necesitar librería de deflate),
// con las 6 partes mínimas que pide el formato OOXML.
//
// Soporta lo que la nómina necesita: encabezado en negrita, números como
// números (para poder sumarlos en Excel), formato de moneda, ancho de
// columnas y una fila de totales.
// ═══════════════════════════════════════════════════════════════════════════

export type Celda = string | number | null | undefined

export interface HojaXlsx {
  nombre: string
  columnas: { titulo: string; ancho?: number; moneda?: boolean }[]
  filas: Celda[][]
  totales?: Celda[]
}

// ── ZIP (STORE) ──
function crc32(bytes: Uint8Array): number {
  let tabla = (crc32 as any)._t as number[] | undefined
  if (!tabla) {
    tabla = []
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      tabla[i] = c >>> 0
    }
    ;(crc32 as any)._t = tabla
  }
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = tabla[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function zip(archivos: { nombre: string; datos: Uint8Array }[]): Blob {
  const partes: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff]
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]

  for (const f of archivos) {
    const nombre = new TextEncoder().encode(f.nombre)
    const crc = crc32(f.datos)
    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(f.datos.length), ...u32(f.datos.length),
      ...u16(nombre.length), ...u16(0),
    ])
    partes.push(local, nombre, f.datos)
    central.push(new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(f.datos.length), ...u32(f.datos.length),
      ...u16(nombre.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ...nombre,
    ]))
    offset += local.length + nombre.length + f.datos.length
  }
  const dirTam = central.reduce((s, c) => s + c.length, 0)
  const fin = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0),
    ...u16(archivos.length), ...u16(archivos.length), ...u32(dirTam), ...u32(offset), ...u16(0),
  ])
  return new Blob([...partes, ...central, fin], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ── XML ──
const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' } as any)[c])
const txt = (s: string) => new TextEncoder().encode(s)
const col = (n: number) => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }

// estilos: 0 normal · 1 negrita · 2 moneda · 3 negrita+moneda
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function hojaXml(h: HojaXlsx): string {
  const filaXml = (celdas: Celda[], fila: number, negrita: boolean) => {
    const cs = celdas.map((v, i) => {
      const ref = `${col(i)}${fila}`
      const moneda = !!h.columnas[i]?.moneda
      if (v === null || v === undefined || v === '') return ''
      if (typeof v === 'number' && isFinite(v)) {
        const s = moneda ? (negrita ? 3 : 2) : (negrita ? 1 : 0)
        return `<c r="${ref}" s="${s}"><v>${v}</v></c>`
      }
      return `<c r="${ref}" s="${negrita ? 1 : 0}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`
    }).join('')
    return `<row r="${fila}">${cs}</row>`
  }
  const cols = h.columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho || 16}" customWidth="1"/>`).join('')
  let r = 1
  const filas = [filaXml(h.columnas.map(c => c.titulo), r++, true)]
  for (const f of h.filas) filas.push(filaXml(f, r++, false))
  if (h.totales) filas.push(filaXml(h.totales, r++, true))
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${filas.join('')}</sheetData></worksheet>`
}

/** Genera y descarga un .xlsx. Nombre sin extensión; se agrega .xlsx. */
export function descargarXlsx(nombreArchivo: string, hojas: HojaXlsx[]) {
  const n = hojas.length
  const archivos = [
    {
      nombre: '[Content_Types].xml',
      datos: txt(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    },
    {
      nombre: '_rels/.rels',
      datos: txt(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    },
    {
      nombre: 'xl/workbook.xml',
      datos: txt(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${hojas.map((h, i) => `<sheet name="${esc(h.nombre.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      datos: txt(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    },
    { nombre: 'xl/styles.xml', datos: txt(STYLES) },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos: txt(hojaXml(h)) })),
  ]
  const url = URL.createObjectURL(zip(archivos))
  const a = document.createElement('a')
  a.href = url
  a.download = `${nombreArchivo.replace(/[\\/:*?"<>|]/g, '-')}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
