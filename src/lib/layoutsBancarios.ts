// ═══════════════════════════════════════════════════════════════════════════
//  Layouts bancarios BBVA Net Cash para pagar órdenes de compra en bloque.
//
//  Dos archivos, porque BBVA los procesa por módulos distintos:
//
//  1. TERCEROS BBVA (proveedor con cuenta BBVA) — 85 posiciones, CRLF:
//       cuenta abono (18, la cuenta de 10 dígitos con ceros a la izquierda)
//     + cuenta cargo (18, la de OMM igual)
//     + divisa (3, 'MXN')
//     + importe (16, con punto y 2 decimales, ceros a la izquierda)
//     + motivo de pago (30)
//
//  2. SPEI (proveedor en otro banco) — 128 posiciones, CRLF. El mismo que ya
//     se usa para nómina y primas (src/pages/nomina/TabPeriodos.tsx):
//       CLABE (18) + cuenta cargo (18) + divisa (3) + importe (16) +
//       titular (30) + tipo de cuenta (2, '40' = CLABE) + banco (3, los
//       primeros 3 de la CLABE) + concepto (30) + referencia numérica (7) +
//       disponibilidad (1, 'H' = mismo día)
//
//  El motivo / concepto es el FOLIO DE LA OC SIN GUIONES (MAT-IE01-C30 →
//  MATIE01C30). Es lo que lee la conciliación para ligar el cargo con su
//  orden, y sin guiones cabe completo aunque el banco corte el texto (BBVA
//  deja ~18 caracteres en el estado de cuenta). Va SOLO el folio y al
//  principio: cualquier texto antes lo empuja fuera del corte.
//
//  Un renglón por OC (no uno por proveedor): así cada cargo trae su folio y
//  su monto exacto, y la conciliación la liga sola.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuenta BBVA MXN de OMM de la que salen los pagos (10 dígitos). */
export const CUENTA_CARGO_OMM = '0118270236'

export type TipoDestino = 'bbva' | 'spei'

export interface Destino {
  tipo: TipoDestino
  /** 10 dígitos si es BBVA; 18 (CLABE) si es SPEI. */
  numero: string
  /** Texto para mostrar: "BBVA · 0453506150" / "SPEI · 014… (Santander)". */
  etiqueta: string
}

export interface LineaPago {
  folio: string            // con guiones, como lo ve el usuario
  monto: number            // MXN
  titular: string          // nombre del proveedor
  destino: Destino
}

const soloDigitos = (s: any) => String(s || '').replace(/\D/g, '')

/** Mayúsculas sin acentos ni eñes: los layouts son ASCII. */
export function aAscii(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/Ñ/g, 'N').replace(/ñ/g, 'n')
    .replace(/[^\x20-\x7E]/g, '')
    .toUpperCase()
}

/** MAT-IE01-C30 → MATIE01C30 (solo letras y números). */
export function folioSinGuiones(folio: string): string {
  return aAscii(folio).replace(/[^A-Z0-9]/g, '')
}

const BANCOS: Record<string, string> = {
  '002': 'Banamex', '012': 'BBVA', '014': 'Santander', '021': 'HSBC', '030': 'Bajío',
  '036': 'Inbursa', '044': 'Scotiabank', '058': 'Banregio', '062': 'Afirme', '072': 'Banorte',
  '127': 'Azteca', '137': 'BanCoppel', '646': 'STP', '638': 'Nu', '722': 'Mercado Pago',
}
export function nombreBanco(clabe: string): string {
  return BANCOS[soloDigitos(clabe).slice(0, 3)] || 'banco ' + soloDigitos(clabe).slice(0, 3)
}

/**
 * La cuenta BBVA de 10 dígitos que vive dentro de una CLABE BBVA.
 * CLABE = banco(3) + plaza(3) + cuenta(11) + verificador(1); en BBVA la cuenta
 * de 11 trae un 0 adelante. 012 180 00453506150 9 → 0453506150.
 */
export function cuentaBbvaDeClabe(clabe: string): string | null {
  const d = soloDigitos(clabe)
  if (d.length !== 18 || !d.startsWith('012')) return null
  return d.slice(7, 17)
}

export interface CuentaProveedor {
  clabe?: string | null
  cuenta_bancaria?: string | null
  banco?: string | null
  bnet_codigo?: string | null
  moneda?: string | null
  is_default?: boolean | null
  etiqueta?: string | null
}

/**
 * Los destinos posibles de un proveedor, a partir de sus cuentas registradas.
 * Una cuenta BBVA se paga por TERCEROS (no por SPEI: BBVA no manda SPEI a
 * sus propias cuentas). Una CLABE de otro banco, por SPEI.
 */
export function destinosDe(cuentas: CuentaProveedor[]): Destino[] {
  const out: Destino[] = []
  const ya = new Set<string>()
  const add = (d: Destino) => { const k = d.tipo + d.numero; if (!ya.has(k)) { ya.add(k); out.push(d) } }
  const ordenadas = [...cuentas]
    .filter(c => (c.moneda || 'MXN') === 'MXN')
    .sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default))
  for (const c of ordenadas) {
    const bnet = soloDigitos(c.bnet_codigo)
    const clabe = soloDigitos(c.clabe)
    const cta = soloDigitos(c.cuenta_bancaria)
    const esBbva = /bbva|bancomer/i.test(c.banco || '')
    // El código BNET es la cuenta BBVA del beneficiario (así sale en el
    // estado de cuenta: "BNET 0453506150"). Algunos registros traen la CLABE
    // en ese campo; se trata como CLABE.
    if (bnet.length === 10) add({ tipo: 'bbva', numero: bnet, etiqueta: 'BBVA · ' + bnet })
    if (bnet.length === 18) {
      const cb = cuentaBbvaDeClabe(bnet)
      if (cb) add({ tipo: 'bbva', numero: cb, etiqueta: 'BBVA · ' + cb })
      else add({ tipo: 'spei', numero: bnet, etiqueta: `SPEI · ${bnet} (${nombreBanco(bnet)})` })
    }
    if (clabe.length === 18) {
      const cb = cuentaBbvaDeClabe(clabe)
      if (cb) add({ tipo: 'bbva', numero: cb, etiqueta: 'BBVA · ' + cb })
      else add({ tipo: 'spei', numero: clabe, etiqueta: `SPEI · ${clabe} (${nombreBanco(clabe)})` })
    }
    if (cta.length === 10 && esBbva) add({ tipo: 'bbva', numero: cta, etiqueta: 'BBVA · ' + cta })
  }
  return out
}

const pad18 = (n: string) => soloDigitos(n).padStart(18, '0').slice(-18)
const importe16 = (m: number) => (Math.round(m * 100) / 100).toFixed(2).padStart(16, '0').slice(-16)
const campo = (s: string, n: number) => aAscii(s).padEnd(n, ' ').slice(0, n)

/** Archivo de terceros BBVA. Una línea de 85 posiciones por pago. */
export function layoutTercerosBbva(lineas: LineaPago[]): string {
  const cargo = pad18(CUENTA_CARGO_OMM)
  return lineas.map(l => {
    const linea = pad18(l.destino.numero) + cargo + 'MXN' + importe16(l.monto) + campo(folioSinGuiones(l.folio), 30)
    if (linea.length !== 85) throw new Error(`Línea BBVA de ${l.folio} mide ${linea.length}, no 85`)
    return linea
  }).join('\r\n') + '\r\n'
}

/** Archivo SPEI. Una línea de 128 posiciones por pago. */
export function layoutSpei(lineas: LineaPago[]): string {
  const cargo = pad18(CUENTA_CARGO_OMM)
  return lineas.map((l, i) => {
    const clabe = soloDigitos(l.destino.numero)
    const linea = clabe + cargo + 'MXN' + importe16(l.monto) + campo(l.titular, 30) + '40' + clabe.slice(0, 3)
      + campo(folioSinGuiones(l.folio), 30) + String(i + 1).padStart(7, '0') + 'H'
    if (linea.length !== 128) throw new Error(`Línea SPEI de ${l.folio} mide ${linea.length}, no 128`)
    return linea
  }).join('\r\n') + '\r\n'
}

/** Descarga un texto como archivo .txt (ASCII, CRLF ya incluido). */
export function descargarTxt(nombre: string, contenido: string) {
  const blob = new Blob([contenido], { type: 'text/plain;charset=us-ascii' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
