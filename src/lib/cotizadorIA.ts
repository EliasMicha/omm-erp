// ═══════════════════════════════════════════════════════════════════════════
// cotizadorIA — convertir una lista de Lutron (PDF, foto, Excel) en partidas
// cotizables, amarradas al catálogo.
//
// El problema no es leer el PDF: eso ya lo hacía el importador viejo. El
// problema es que lo leído quedaba SUELTO — un texto con un precio — sin liga
// al catálogo. Así no hay precio público, no hay marca correcta, no hay
// historial de qué le cuesta a OMM ese modelo, y el catálogo nunca crece.
//
// Aquí la identidad de un producto es su NÚMERO DE PARTE. No el nombre: el
// mismo HQWT-U-P4W-BL aparece como "PALLADIOM HWQS US 4B", como "Lutron
// HQWT-U-P4W-BL" y como "Palladiom keypad 4 botones negro". El part number no
// cambia. Por eso el emparejamiento va, en orden:
//
//   1. modelo o SKU idénticos (normalizados)      → exacto
//   2. el part number aparece DENTRO del modelo   → probable
//      (el catálogo tiene "Claro CA-1PS-AL" cuando el parte es "CA-1PS-AL")
//   3. el part number aparece en el nombre        → probable
//   4. parecido de nombre por palabras            → dudoso
//   5. nada                                       → nuevo
//
// Lo que NO se hace: adivinar. Un renglón "dudoso" o "nuevo" llega a la
// pantalla marcado para que una persona lo confirme. Cotizar de más un
// procesador Lutron equivocado cuesta miles de dólares.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProductoCatalogo {
  id: string
  name?: string | null
  marca?: string | null
  modelo?: string | null
  sku?: string | null
  system?: string | null
  cost?: any
  precio_venta?: any
  moneda?: string | null
  unit?: string | null
}

export interface PartidaExtraida {
  name: string
  modelo: string
  marca: string
  cantidad: number
  costoUnitario: number
  archivo?: string
}

export type Confianza = 'exacto' | 'probable' | 'dudoso' | 'nuevo'

export interface Emparejamiento {
  extraido: PartidaExtraida
  producto: ProductoCatalogo | null
  confianza: Confianza
  motivo: string
  alternativas: ProductoCatalogo[]
}

const num = (v: any) => Number(v) || 0

/**
 * Un part number sin ruido. Se conservan letras y dígitos y se tiran guiones,
 * espacios y puntos: "HQWT-U-P4W-BL", "hqwt u p4w bl" y "HQWTUP4WBL" son el
 * mismo aparato, y los proveedores los escriben de las tres formas.
 */
export function normalizarModelo(s: any): string {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Palabras útiles de un nombre, sin las que no distinguen nada. */
const RUIDO = new Set(['de', 'la', 'el', 'los', 'las', 'para', 'con', 'y', 'a', 'en', 'the', 'of', 'for', 'with', 'lutron'])
function palabras(s: any): string[] {
  return String(s ?? '').toLowerCase()
    .replace(/[^a-z0-9áéíóúñ ]/g, ' ')
    .split(/\s+/).filter(w => w.length > 2 && !RUIDO.has(w))
}

export interface IndiceCatalogo {
  porClave: Map<string, ProductoCatalogo[]>
  todos: ProductoCatalogo[]
}

/** Índice por número de parte, alimentado de modelo Y de sku. */
export function indexarCatalogo(productos: ProductoCatalogo[]): IndiceCatalogo {
  const porClave = new Map<string, ProductoCatalogo[]>()
  const agregar = (clave: string, p: ProductoCatalogo) => {
    if (clave.length < 4) return   // claves cortas generan falsos positivos
    const arr = porClave.get(clave)
    if (arr) { if (!arr.includes(p)) arr.push(p) } else porClave.set(clave, [p])
  }
  for (const p of productos) {
    agregar(normalizarModelo(p.modelo), p)
    agregar(normalizarModelo(p.sku), p)
  }
  return { porClave, todos: productos }
}

/**
 * Empareja una partida extraída con el catálogo.
 *
 * Cuando una clave devuelve varios productos (el mismo modelo capturado dos
 * veces con distinto precio, que en este catálogo pasa seguido) se toma el
 * primero y los demás quedan como alternativas: es una decisión de precio y la
 * tiene que tomar una persona, no un desempate automático.
 */
export function emparejar(ex: PartidaExtraida, idx: IndiceCatalogo): Emparejamiento {
  const clave = normalizarModelo(ex.modelo)
  const base = { extraido: ex, alternativas: [] as ProductoCatalogo[] }

  // 1. Clave idéntica
  if (clave.length >= 4) {
    const exactos = idx.porClave.get(clave)
    if (exactos && exactos.length > 0) {
      return { ...base, producto: exactos[0], confianza: 'exacto', motivo: 'Número de parte idéntico', alternativas: exactos.slice(1) }
    }
  }

  // 2 y 3. El part number vive DENTRO del modelo o del nombre del catálogo.
  //   El catálogo guarda "Claro CA-1PS-AL" donde el parte es "CA-1PS-AL", y a
  //   veces el número solo está en el nombre. Entre varios candidatos gana el
  //   que coincide por modelo/SKU sobre el que coincide por nombre, y a igual
  //   coincidencia el que sí tiene costo capturado: un producto en $0 no sirve
  //   para cotizar.
  if (clave.length >= 5) {
    const candidatos: Array<{ p: ProductoCatalogo; rango: number }> = []
    for (const p of idx.todos) {
      const m = normalizarModelo(p.modelo)
      const sk = normalizarModelo(p.sku)
      const nm = normalizarModelo(p.name)
      let rango = 0
      if ((m && (m.includes(clave) || (clave.includes(m) && m.length >= 5))) ||
          (sk && (sk.includes(clave) || (clave.includes(sk) && sk.length >= 5)))) rango = 2
      else if (nm && nm.includes(clave)) rango = 1
      if (rango > 0) candidatos.push({ p, rango })
    }
    if (candidatos.length > 0) {
      candidatos.sort((a, b) => (b.rango - a.rango) || (num(b.p.cost) > 0 ? 1 : 0) - (num(a.p.cost) > 0 ? 1 : 0))
      return {
        ...base, producto: candidatos[0].p, confianza: 'probable',
        motivo: 'El número de parte aparece en el catálogo',
        alternativas: candidatos.slice(1, 5).map(c => c.p),
      }
    }
    // El renglón TRAE número de parte y no está en el catálogo: es un producto
    // nuevo, punto. Aquí NO se busca por nombre.
    //
    // Esto no es un detalle: HQWT-U-P4W-BL y HQWT-U-P4W-SN se llaman igual
    // ("PALLADIOM HWQS US 4B") y son acabados distintos con precios distintos;
    // PD9-59F-120 y PD8-59F-120 se llaman casi igual y son paneles de 9 y de 8
    // módulos. Por nombre, los dos pares empatan al 100%. Cotizar el hermano
    // equivocado cuesta miles de dólares y nadie lo nota hasta que llega el
    // material. Un part number desconocido se marca NUEVO y lo resuelve una
    // persona.
    const familia = idx.todos.filter(p => {
      const m = normalizarModelo(p.modelo) || normalizarModelo(p.sku)
      if (m.length < 6 || clave.length < 6) return false
      // Comparten el prefijo largo: casi seguro son el mismo producto en otro
      // acabado. Se ofrecen como pista, nunca como selección.
      const pref = Math.min(m.length, clave.length) - 2
      return pref >= 6 && m.slice(0, pref) === clave.slice(0, pref)
    }).slice(0, 5)
    return {
      ...base, producto: null, confianza: 'nuevo',
      motivo: familia.length
        ? 'Ese número de parte no está en el catálogo (hay modelos parecidos: revísalos)'
        : 'No está en el catálogo',
      alternativas: familia,
    }
  }

  // 4. Sin número de parte: solo aquí tiene sentido buscar por nombre, y el
  //    resultado siempre llega marcado para revisión.
  const pex = palabras(ex.name)
  if (pex.length > 0) {
    let mejor: ProductoCatalogo | null = null
    let mejorPuntaje = 0
    const cercanos: Array<{ p: ProductoCatalogo; s: number }> = []
    for (const p of idx.todos) {
      const pp = palabras(p.name)
      if (pp.length === 0) continue
      const comunes = pex.filter(w => pp.includes(w)).length
      const s = comunes / Math.max(pex.length, pp.length)
      if (s > 0.34) cercanos.push({ p, s })
      if (s > mejorPuntaje) { mejorPuntaje = s; mejor = p }
    }
    if (mejor && mejorPuntaje > 0.5) {
      cercanos.sort((a, b) => b.s - a.s)
      return {
        ...base, producto: mejor, confianza: 'dudoso',
        motivo: `Sin número de parte; solo se parece el nombre (${Math.round(mejorPuntaje * 100)}%) — confírmalo`,
        alternativas: cercanos.filter(c => c.p !== mejor).slice(0, 4).map(c => c.p),
      }
    }
  }

  return { ...base, producto: null, confianza: 'nuevo', motivo: 'No está en el catálogo', alternativas: [] }
}

/**
 * Junta las partidas de VARIOS archivos. Un mismo modelo repetido entre hojas
 * se suma en un solo renglón: las listas de Lutron vienen paginadas y cotizar
 * dos veces el mismo keypad es un error caro y difícil de ver.
 */
export function consolidar(partidas: PartidaExtraida[]): PartidaExtraida[] {
  const mapa = new Map<string, PartidaExtraida>()
  const sueltas: PartidaExtraida[] = []
  for (const p of partidas) {
    const clave = normalizarModelo(p.modelo)
    if (!clave) { sueltas.push(p); continue }
    const prev = mapa.get(clave)
    if (prev) {
      prev.cantidad += num(p.cantidad)
      // Ante dos precios distintos del mismo modelo se conserva el MAYOR: es
      // el más reciente en la práctica y protege el margen. La diferencia se
      // ve en pantalla porque el renglón queda marcado.
      if (num(p.costoUnitario) > num(prev.costoUnitario)) prev.costoUnitario = num(p.costoUnitario)
      if (p.archivo && prev.archivo && !prev.archivo.includes(p.archivo)) prev.archivo += ', ' + p.archivo
    } else {
      mapa.set(clave, { ...p, cantidad: num(p.cantidad) })
    }
  }
  return [...mapa.values(), ...sueltas]
}

/**
 * Margen con el que se propone el precio público. Se toma el del producto en
 * el catálogo (precio_venta / costo) para respetar cómo se ha vendido antes;
 * si no hay referencia se usa 2.0, que es el patrón del catálogo actual.
 */
export function margenDe(p: ProductoCatalogo | null): number {
  const c = num(p?.cost)
  const v = num(p?.precio_venta)
  if (c > 0 && v > 0) {
    const m = v / c
    if (m >= 1 && m <= 6) return Math.round(m * 100) / 100
  }
  return 2
}

/** Diferencia entre lo que cuesta hoy y lo que decía el catálogo. */
export function variacionCosto(ex: PartidaExtraida, p: ProductoCatalogo | null): number | null {
  const viejo = num(p?.cost)
  const nuevo = num(ex.costoUnitario)
  if (viejo <= 0 || nuevo <= 0) return null
  return (nuevo - viejo) / viejo
}

export const CONFIANZA_CFG: Record<Confianza, { label: string; color: string }> = {
  exacto:   { label: 'Exacto',   color: '#10B981' },
  probable: { label: 'Probable', color: '#2563EB' },
  dudoso:   { label: 'Revisar',  color: '#D9A441' },
  nuevo:    { label: 'Nuevo',    color: '#A78BFA' },
}

// ── Extracción con IA ──────────────────────────────────────────────────────

export const PROMPT_SISTEMA =
  'Eres un parser de listas y órdenes de equipo de distribución (Lutron, Crestron, Schneider y similares). ' +
  'Devuelve SOLO un objeto JSON válido, sin texto adicional, sin markdown.'

export function promptExtraccion(): string {
  return `Extrae TODAS las partidas de equipo de este documento.

Reglas:
- Una partida por renglón de producto. Si el documento tiene varias páginas o tablas, inclúyelas todas.
- "modelo" es el número de parte / part number / model tal como aparece (ej. HQWT-U-P4W-BL, LQSE-4A1-D). Cópialo EXACTO, sin traducir ni corregir.
- "name" es la descripción del producto. Si no hay descripción, deja el modelo.
- "cantidad" es Qty/Cant. Si no aparece, usa 1.
- "costoUnitario" es el precio unitario (Unit Price / Unit Cost / Precio). Si el documento solo trae importe total y cantidad, divide. Si no hay precio, usa 0.
- NO incluyas renglones de Subtotal, Total, IVA, Tax, Shipping, Discount ni notas: esos van en los campos de cargos.
- Si un renglón está ilegible o dudoso, inclúyelo igual con lo que se alcance a leer y marca "dudoso": true.

Responde EXACTAMENTE con este formato:
{
  "moneda": "USD",
  "fletes": 0,
  "factorImportacion": 0,
  "descuentoPct": 0,
  "items": [
    { "name": "Palladiom Keypad 4 botones", "modelo": "HQWT-U-P4W-BL", "marca": "Lutron", "cantidad": 7, "costoUnitario": 509.20, "dudoso": false }
  ]
}`
}

/** Saca el JSON de la respuesta del modelo, aunque venga envuelto en texto. */
export function parsearRespuesta(texto: string): any {
  const limpio = String(texto || '').replace(/```json|```/g, '').trim()
  const ini = limpio.indexOf('{')
  const fin = limpio.lastIndexOf('}')
  if (ini === -1 || fin === -1) throw new Error('El modelo no devolvió JSON')
  return JSON.parse(limpio.slice(ini, fin + 1))
}
