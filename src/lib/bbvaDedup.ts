// ═══════════════════════════════════════════════════════════════════════════
//  bbvaDedup — decidir qué movimientos del banco YA están en el ERP.
//
//  ── POR QUÉ NO BASTA LA LLAVE QUE YA HABÍA ────────────────────────────────
//
//  `dedupKey` compara `cuenta|fecha|concepto|monto|tipo`, y ese `concepto` lo
//  REESCRIBE la IA al importar. Si el modelo redacta distinto el mismo
//  movimiento, la llave no empata y el duplicado entra.
//
//  ── Y POR QUÉ NO SE PUEDE SIMPLEMENTE AFLOJAR ─────────────────────────────
//
//  La tentación es quitar el concepto de la llave y comparar solo
//  cuenta+fecha+monto+tipo. NO SIRVE: en la base hay 92 grupos que comparten
//  esos cuatro datos y NO son duplicados. Por ejemplo, el mismo día y por el
//  mismo importe:
//
//      SPEI ENVIADO INBURSA /0048772099 036 ...
//      SPEI ENVIADO SANTANDER/0048718272 014 ...
//
//  Son dos transferencias distintas. Con la llave floja se perdería una, y un
//  movimiento bancario que desaparece es peor que uno repetido: el repetido se
//  ve en la conciliación, el que falta no.
//
//  ── LO QUE SÍ DISTINGUE ───────────────────────────────────────────────────
//
//  La REFERENCIA del banco (AUT, BNET, CIE, el número de cuenta destino). Es
//  un dato del banco, no una redacción, así que sobrevive aunque la IA escriba
//  el concepto de otra forma — y es justo lo que separa a INBURSA de SANTANDER.
//
//  ── LOS TRES MONTONES ─────────────────────────────────────────────────────
//
//  nuevos     se importan
//  repetidos  se descartan, con el motivo
//  dudosos    NO se deciden solos: se le enseñan al usuario
//
//  El tercer montón existe a propósito. Este ERP ya aprendió —con las fechas
//  masivas de obra— que una acción en bloque tiene que decir a cuántos
//  renglones alcanzó Y a cuántos no y por qué; si no, el usuario no puede
//  distinguir "no aplicó" de "no guardó".
// ═══════════════════════════════════════════════════════════════════════════

import type { MovimientoBBVA } from './bbvaExcel'

/** Un movimiento que ya vive en el ERP, para comparar contra él. */
export interface MovExistente {
  fecha: string
  monto: number
  tipo: string
  cuenta?: string | null
  /** Lo que escribió la IA. */
  concepto?: string | null
  referencia?: string | null
  /** El texto crudo del banco, cuando se guardó (columna `texto_banco`). */
  texto_banco?: string | null
}

export interface Repetido { mov: MovimientoBBVA; porque: string }
export interface Dudoso { mov: MovimientoBBVA; yaHay: number; porque: string }

export interface Clasificacion {
  nuevos: MovimientoBBVA[]
  repetidos: Repetido[]
  dudosos: Dudoso[]
}

const soloDigitos = (s: string) => s.replace(/\D/g, '')

/**
 * Las referencias del banco que aparecen en un texto.
 *
 * Se buscan las etiquetadas (AUT, BNET, REF, CIE) y además cualquier corrida
 * larga de dígitos, que es donde viven los números de cuenta destino y los
 * folios. Siete dígitos como mínimo: más corto empieza a cazar horas, importes
 * y los cuatro dígitos de la tarjeta (******6919), que se repiten en TODOS los
 * movimientos y no distinguen nada.
 */
export function referenciasDe(texto: string): Set<string> {
  const refs = new Set<string>()
  const t = texto || ''
  // Sin \b antes de la etiqueta A PROPÓSITO: el banco pega la referencia al
  // número que la precede — "USD 45.03TC017.9304AUT: 044699" — y entre el 4 y
  // la A no hay frontera de palabra, así que \bAUT no caza nada. Con \b, los
  // cargos de Anthropic y Supabase quedaban sin referencia y caían a dudosos.
  const etiquetadas: Array<[RegExp, string]> = [
    [/AUT[:\s]+(\d{4,})/gi, 'aut'],
    [/BNET[:\s]+(\d{6,})/gi, 'bnet'],
    [/REF[:\s]*(\d{4,})/gi, 'ref'],
    [/CIE[:\s]*(\d{4,})/gi, 'cie'],
  ]
  for (const [re, pre] of etiquetadas) {
    for (const m of t.matchAll(re)) refs.add(`${pre}:${m[1]}`)
  }
  for (const m of t.matchAll(/\d{7,}/g)) refs.add(`n:${m[0]}`)
  return refs
}

/** ¿El texto de un movimiento ya guardado menciona alguna de estas referencias? */
function mencionaAlguna(existente: MovExistente, refs: Set<string>): string | null {
  const texto = [existente.texto_banco, existente.concepto, existente.referencia]
    .filter(Boolean).join(' ')
  if (!texto) return null
  const suyas = referenciasDe(texto)
  for (const r of refs) if (suyas.has(r)) return r
  return null
}

const clave = (fecha: string, monto: number, tipo: string) =>
  `${fecha}|${Math.round(monto * 100)}|${tipo}`

/**
 * Reparte los movimientos del archivo en nuevos / repetidos / dudosos.
 *
 * El criterio, por grupo de (fecha, monto, tipo) — que es donde puede haber
 * confusión, porque fuera de ese grupo nada se parece:
 *
 *   1. Si una referencia del candidato aparece en un movimiento ya guardado
 *      de ese grupo → REPETIDO. Es el caso normal.
 *   2. Si no empata con ninguno, se cuenta: el banco dice que ese día, por ese
 *      importe, hubo P movimientos; el ERP tiene E.
 *        · P > E  → sobran en el banco: los que no empataron son NUEVOS.
 *        · P ≤ E  → el ERP ya tiene tantos como el banco: probablemente ya
 *                   están y la referencia no se pudo cotejar → DUDOSO.
 *
 * El conteo es la parte importante: usa al banco como fuente de verdad sobre
 * CUÁNTOS movimientos hubo, en vez de adivinar por el texto.
 */
export function clasificar(
  candidatos: MovimientoBBVA[],
  existentes: MovExistente[],
  cuentaErp: string,
): Clasificacion {
  const cta = soloDigitos(cuentaErp)
  const mismos = existentes.filter(e => {
    if (!e.cuenta) return true
    const c = soloDigitos(e.cuenta)
    return !c || !cta || c.endsWith(cta) || cta.endsWith(c)
  })

  const porClave = new Map<string, MovExistente[]>()
  for (const e of mismos) {
    const k = clave(e.fecha, Number(e.monto), e.tipo)
    const arr = porClave.get(k)
    if (arr) arr.push(e); else porClave.set(k, [e])
  }

  // Cuántos trae el archivo en cada grupo.
  const enArchivo = new Map<string, number>()
  for (const m of candidatos) {
    const k = clave(m.fecha, m.monto, m.tipo)
    enArchivo.set(k, (enArchivo.get(k) || 0) + 1)
  }

  const nuevos: MovimientoBBVA[] = []
  const repetidos: Repetido[] = []
  const dudosos: Dudoso[] = []
  /** Un movimiento guardado solo puede explicar UN renglón del archivo. */
  const yaUsado = new Set<MovExistente>()
  const sinEmpatar = new Map<string, MovimientoBBVA[]>()
  /** Si el renglón traía referencia o no: cambia qué tan en serio se toma que
   *  no haya empatado. Sin referencia, no empatar no dice nada. */
  const teniaRef = new Map<MovimientoBBVA, boolean>()

  // ── Primera pasada: empatar por referencia ───────────────────────────────
  for (const m of candidatos) {
    const k = clave(m.fecha, m.monto, m.tipo)
    const grupo = porClave.get(k) || []
    if (grupo.length === 0) { nuevos.push(m); continue }

    const refs = referenciasDe(`${m.descripcion} ${m.concepto}`)
    teniaRef.set(m, refs.size > 0)
    let empate: MovExistente | null = null
    let cual = ''
    if (refs.size) {
      for (const e of grupo) {
        if (yaUsado.has(e)) continue
        const r = mencionaAlguna(e, refs)
        if (r) { empate = e; cual = r; break }
      }
    }
    if (empate) {
      yaUsado.add(empate)
      repetidos.push({ mov: m, porque: `ya está en el ERP (referencia ${cual})` })
    } else {
      const arr = sinEmpatar.get(k)
      if (arr) arr.push(m); else sinEmpatar.set(k, [m])
    }
  }

  // ── Segunda pasada: los que no empataron, por conteo ─────────────────────
  for (const [k, movs] of sinEmpatar) {
    const grupo = porClave.get(k) || []
    const libres = grupo.filter(e => !yaUsado.has(e)).length
    const enBanco = enArchivo.get(k) || 0
    // Si el banco trae más de los que el ERP tiene, el excedente es real.
    const sobran = Math.max(0, enBanco - grupo.length)
    // Los que SÍ traían referencia se revisan primero: que no haya empatado es
    // una señal real de conflicto y vale la pena que la vea una persona. Los
    // que no traen referencia no dicen nada al no empatar, así que se quedan
    // con lo que diga el conteo.
    const orden = [...movs].sort((a, b) => Number(teniaRef.get(b)) - Number(teniaRef.get(a)))
    for (let i = 0; i < orden.length; i++) {
      const m = orden[i]
      // El banco trae más de los que el ERP tiene: el excedente es real.
      if (i >= orden.length - sobran) { nuevos.push(m); continue }
      if (!teniaRef.get(m)) {
        // Sin referencia que cotejar, y el banco no reporta más de los que ya
        // hay. Preguntar aquí es ruido: son comisiones, IVA de servicios y
        // compensaciones de SPEI, que nunca traen folio.
        repetidos.push({ mov: m, porque: `ya está en el ERP (el banco reporta ${enBanco} ese día por ese importe y el ERP ya tiene ${grupo.length})` })
        continue
      }
      dudosos.push({
        mov: m,
        yaHay: libres,
        porque: `trae referencia pero no empata con ninguno de los ${grupo.length} que el ERP ya tiene de ese día por ese importe`,
      })
    }
  }

  const porFecha = (a: MovimientoBBVA, b: MovimientoBBVA) => a.fecha.localeCompare(b.fecha)
  nuevos.sort(porFecha)
  return { nuevos, repetidos, dudosos }
}
