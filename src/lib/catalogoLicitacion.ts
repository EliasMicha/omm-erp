// ═══════════════════════════════════════════════════════════════════════════
// catalogoLicitacion — exporta cualquier cotización como CATÁLOGO DE CONCEPTOS
// en formato de licitación formal (.xlsx).
//
// Dos variantes:
//   • "para cotizar"  (conPrecios=false) → partida, descripción, marca y modelo
//     de referencia, unidad y cantidad. PRECIO UNITARIO va en blanco; el IMPORTE
//     y todos los totales son FÓRMULAS vivas, así que en cuanto el licitante
//     teclea sus precios el Excel se calcula solo.
//   • "valorizado"    (conPrecios=true)  → los mismos conceptos con tus precios,
//     también con fórmulas (no números pegados) para que se pueda auditar.
//
// Lee directo de la BD (quotations + quotation_areas + quotation_items), así que
// sirve IGUAL para los 6 cotizadores: todos persisten sus partidas ahí.
//
// Agrupación:
//   • Especiales (esp) → UNA PESTAÑA POR SISTEMA (cada una cierra con su propio
//     concepto de instalación y puesta en marcha) + pestaña "Resumen" que suma
//     todo con referencias entre hojas.
//   • Las demás especialidades → una sola pestaña, agrupada por área.
//
// CONSOLIDACIÓN: un mismo producto capturado en varias áreas sale UNA SOLA VEZ
// con la cantidad sumada. En valorizado, si el mismo producto quedó con precios
// unitarios distintos se mantienen renglones separados para no falsear importes.
//
// INSTALACIÓN (solo Especiales): en el cotizador de Especiales la instalación NO
// es una partida, va escondida dentro de cada producto (`installation_cost`) y la
// programación es un monto suelto en la config. Aquí se extraen y se presentan
// como CONCEPTO AL FINAL DE CADA SISTEMA — que es como se licita, y además evita
// que el catálogo se quedara corto contra el total real de la cotización.
// La programación (monto global) se prorratea entre los sistemas en proporción a
// su instalación, para que cada pestaña quede autocontenida y el total cuadre.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'
import { descargarXlsx, HojaXlsx, Fila, Celda } from './xlsxExport'

const EMPRESA = 'OMM TECHNOLOGIES S.A. DE C.V.'

const NOMBRE_ESPECIALIDAD: Record<string, string> = {
  esp: 'Instalaciones Especiales',
  ilum: 'Iluminación',
  cort: 'Cortinas y Persianas',
  elec: 'Ingeniería Eléctrica',
  proy: 'Proyecto e Ingeniería',
  dist: 'Distribución / Suministro',
}

interface ItemDB {
  id: string; area_id: string | null; name: string | null; description: string | null
  system: string | null; type: string | null; quantity: number | null; price: number | null
  installation_cost: number | null
  marca: string | null; modelo: string | null; sku: string | null; nomenclatura: string | null
  order_index: number | null; provider: string | null
}

// Columnas fijas: A PARTIDA · B DESCRIPCIÓN · C ESPECIFICACIÓN · D MARCA
// E MODELO · F UNIDAD · G CANTIDAD · H PRECIO UNITARIO · I IMPORTE
const COL_CANT = 'G', COL_PU = 'H', COL_IMP = 'I'

const COLS_BASE = [
  { titulo: 'PARTIDA', ancho: 10 },
  { titulo: 'DESCRIPCIÓN', ancho: 42 },
  { titulo: 'ESPECIFICACIÓN TÉCNICA', ancho: 46 },
  { titulo: 'MARCA (REF.)', ancho: 18 },
  { titulo: 'MODELO / N° DE PARTE', ancho: 24 },
  { titulo: 'UNIDAD', ancho: 10 },
  { titulo: 'CANTIDAD', ancho: 11 },
  { titulo: 'PRECIO UNITARIO', ancho: 17, moneda: true },
  { titulo: 'IMPORTE', ancho: 17, moneda: true },
]

function nombreHoja(s: string, usados: Set<string>): string {
  const base = (s || 'Hoja').replace(/[:\\/?*[\]]/g, '-').trim().slice(0, 31) || 'Hoja'
  let n = base, i = 2
  while (usados.has(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf }
  usados.add(n.toLowerCase())
  return n
}
// Referencia a otra hoja dentro de una fórmula: 'Nombre'!I25 (las comillas se duplican)
const refHoja = (hoja: string, celda: string) => `'${hoja.replace(/'/g, "''")}'!${celda}`

function unidadDe(it: ItemDB): string {
  const t = `${it.name || ''} ${it.description || ''}`.toLowerCase()
  if (it.type === 'labor' || it.type === 'mano_de_obra' || it.type === 'servicio') return 'SERV'
  if (/\bcable\b|\bconduit\b|tuber[ií]a|\bmanguera\b|\briel\b|\bcanaleta\b/.test(t)) return 'M'
  if (/\brollo\b/.test(t)) return 'ROLLO'
  if (/\bjuego\b|\bkit\b/.test(t)) return 'JGO'
  return 'PZA'
}

export interface OpcionesCatalogo {
  conPrecios: boolean
  vigenciaDias?: number
}

interface Concepto {
  descripcion: string; especificacion: string; marca: string; modelo: string
  unidad: string; cantidad: number; precio: number; orden: number
}

export async function exportarCatalogoLicitacion(cotId: string, opts: OpcionesCatalogo): Promise<void> {
  const [{ data: cot }, { data: areasRaw }, { data: itemsRaw }] = await Promise.all([
    supabase.from('quotations').select('id,name,specialty,notes,client_name,created_at,project:projects!quotations_project_id_fkey(name,client_name)').eq('id', cotId).single(),
    supabase.from('quotation_areas').select('id,name,order_index').eq('quotation_id', cotId).order('order_index'),
    supabase.from('quotation_items').select('id,area_id,name,description,system,type,quantity,price,installation_cost,marca,modelo,sku,nomenclatura,order_index,provider').eq('quotation_id', cotId),
  ])
  if (!cot) throw new Error('No se encontró la cotización')
  const items = (itemsRaw || []) as ItemDB[]
  if (items.length === 0) throw new Error('Esta cotización no tiene partidas que exportar')

  let meta: any = {}
  try { meta = JSON.parse((cot as any).notes || '{}') } catch { /* notas libres */ }
  const moneda: string = meta.currency === 'USD' ? 'USD' : 'MXN'
  const ivaPct: number = typeof meta.ivaRate === 'number' ? meta.ivaRate : 16
  const descPct: number = typeof meta.descuento === 'number' ? meta.descuento : 0
  const tc: number = moneda === 'USD' ? (Number(meta.tipoCambio) > 0 ? Number(meta.tipoCambio) : 18) : 1
  const programacion: number = Number(meta.programacion) || 0

  let cliente = (cot as any).client_name || (cot as any).project?.client_name || ''
  if (meta.lead_id) {
    const { data: lead } = await supabase.from('leads').select('name,company,contact_name').eq('id', meta.lead_id).maybeSingle()
    if (lead) cliente = (lead as any).company || (lead as any).name || cliente
  }
  const proyecto = (cot as any).project?.name || (cot as any).name || '—'
  const especialidad = NOMBRE_ESPECIALIDAD[(cot as any).specialty] || 'Cotización'
  const fecha = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })

  const areaNombre = new Map<string, string>()
  for (const a of (areasRaw || []) as any[]) areaNombre.set(a.id, a.name || 'Sin área')

  const esESP = (cot as any).specialty === 'esp'
  const claveGrupo = (it: ItemDB) => esESP
    ? (it.system || 'General')
    : (it.area_id ? (areaNombre.get(it.area_id) || 'Sin área') : 'General')

  const grupos = new Map<string, ItemDB[]>()
  for (const it of items) {
    const k = claveGrupo(it)
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k)!.push(it)
  }
  const nombresGrupo = Array.from(grupos.keys()).sort((a, b) => a.localeCompare(b, 'es'))

  // Instalación embebida por producto (Especiales) → se saca a partida propia
  const instPorSistema = new Map<string, number>()
  if (esESP) {
    for (const it of items) {
      const v = (Number(it.installation_cost) || 0) * (Number(it.quantity) || 0)
      if (v > 0) {
        const k = it.system || 'General'
        instPorSistema.set(k, (instPorSistema.get(k) || 0) + v)
      }
    }
  }
  // Concepto de cierre por sistema: instalación + su parte proporcional de programación
  interface Extra { descripcion: string; especificacion: string; monto: number }
  const extraPorGrupo = new Map<string, Extra>()
  if (esESP) {
    const totalInst = Array.from(instPorSistema.values()).reduce((a, b) => a + b, 0)
    const sistemas = instPorSistema.size > 0 ? Array.from(instPorSistema.keys()) : (programacion > 0 ? nombresGrupo : [])
    for (const sis of sistemas) {
      const inst = instPorSistema.get(sis) || 0
      const prog = programacion > 0
        ? (totalInst > 0 ? programacion * (inst / totalInst) : programacion / Math.max(1, sistemas.length))
        : 0
      const monto = Math.round((inst + prog) * 100) / 100
      if (monto <= 0) continue
      extraPorGrupo.set(sis, {
        descripcion: `Instalación, programación y puesta en marcha — ${sis}`,
        especificacion: `Mano de obra especializada, cableado de interconexión, montaje y fijación de equipos, configuración y programación, pruebas de funcionamiento y puesta en marcha del sistema de ${sis}. Incluye material de instalación menor${prog > 0 ? ' y la parte proporcional de programación e integración correspondiente a este sistema' : ''}.`,
        monto,
      })
    }
  }

  // ── Consolidación ──
  function consolidar(arr: ItemDB[]): Concepto[] {
    const mapa = new Map<string, Concepto>()
    arr.forEach((it, i) => {
      const c: Concepto = {
        descripcion: it.name || '—',
        especificacion: it.description || '',
        marca: it.marca || '',
        modelo: it.modelo || it.sku || it.nomenclatura || '',
        unidad: unidadDe(it),
        cantidad: Number(it.quantity) || 0,
        precio: Number(it.price) || 0,
        orden: it.order_index ?? i,
      }
      const k = [c.descripcion, c.especificacion, c.marca, c.modelo, c.unidad, opts.conPrecios ? c.precio : '']
        .map(v => String(v).trim().toLowerCase()).join('||')
      const prev = mapa.get(k)
      if (prev) { prev.cantidad += c.cantidad; prev.orden = Math.min(prev.orden, c.orden) }
      else mapa.set(k, c)
    })
    return Array.from(mapa.values()).sort((a, b) => a.orden - b.orden || a.descripcion.localeCompare(b.descripcion, 'es'))
  }

  const portada = (subtitulo: string): Fila[] => {
    const f: Fila[] = [
      { celdas: [EMPRESA], estilo: 'titulo' },
      { celdas: ['CATÁLOGO DE CONCEPTOS'], estilo: 'titulo' },
      { celdas: [opts.conPrecios ? 'Propuesta económica' : 'Formato para cotización — precios a llenar por el licitante'], estilo: 'etiqueta' },
      { celdas: [] },
      { celdas: ['Proyecto:', proyecto], estilo: 'etiqueta' },
      { celdas: ['Cliente:', cliente || '—'], estilo: 'etiqueta' },
      { celdas: ['Especialidad:', especialidad], estilo: 'etiqueta' },
      { celdas: ['Cotización:', (cot as any).name || '—'], estilo: 'etiqueta' },
      { celdas: ['Fecha:', fecha], estilo: 'etiqueta' },
      { celdas: ['Moneda:', moneda], estilo: 'etiqueta' },
      { celdas: ['Partida:', subtitulo || 'Catálogo completo'], estilo: 'etiqueta' },
      { celdas: [] },
    ]
    return f
  }
  const FILAS_PORTADA = 12          // portada + fila de encabezado = primera fila de datos en 14

  const notasPie = (): Fila[] => {
    const n: Fila[] = [
      { celdas: [] },
      { celdas: ['NOTAS Y CONDICIONES'], estilo: 'etiqueta' },
      { celdas: ['1. Las marcas y modelos indicados son DE REFERENCIA. Se aceptan equivalentes de características técnicas iguales o superiores, sujetos a aprobación.'] },
      { celdas: [`2. Los importes están expresados en ${moneda}. Los precios no incluyen IVA; el impuesto se muestra por separado en el bloque de totales.`] },
      { celdas: ['3. Las cantidades corresponden al alcance del proyecto a la fecha de emisión de este catálogo. Cualquier variación deberá cotizarse por separado.'] },
      { celdas: ['4. Cada concepto se presenta consolidado: la cantidad indicada es el TOTAL requerido para el proyecto, sumando todas sus ubicaciones.'] },
      { celdas: ['5. Las celdas de IMPORTE y de totales contienen fórmulas: al capturar el precio unitario, el archivo calcula solo.'] },
      { celdas: [`6. Vigencia de la propuesta: ${opts.vigenciaDias || 15} días naturales a partir de la fecha de emisión.`] },
    ]
    if (!opts.conPrecios) {
      n.push({ celdas: ['7. El licitante deberá llenar únicamente la columna PRECIO UNITARIO de cada concepto, sin modificar descripciones ni cantidades.'] })
      n.push({ celdas: ['8. La propuesta deberá presentarse firmada, indicando tiempo de entrega y condiciones de pago por partida.'] })
      n.push({ celdas: [] })
      n.push({ celdas: ['Nombre y firma del licitante:', '', '', 'Tiempo de entrega:', '', 'Condiciones de pago:'], estilo: 'etiqueta' })
    }
    return n
  }

  // ── Bloque de totales con fórmulas + tipo de cambio ──
  // Devuelve las filas y la fila donde queda el TOTAL en moneda.
  function bloqueTotales(rInicio: number, formulaSubtotal: string, valorSubtotal: number) {
    const filas: Fila[] = [{ celdas: [] }]
    let r = rInicio + 1
    const et = (txt: string, celda: Celda): Fila => ({ estilo: 'total', celdas: ['', txt, '', '', '', '', '', '', celda] })

    const rSub = r++
    filas.push(et('SUBTOTAL', { f: formulaSubtotal, v: valorSubtotal }))
    let rBase = rSub
    let base = valorSubtotal
    if (descPct > 0) {
      const rDesc = r++
      filas.push(et(`DESCUENTO (${descPct}%)`, { f: `-${COL_IMP}${rSub}*${descPct}/100`, v: -valorSubtotal * descPct / 100 }))
      rBase = r++
      base = valorSubtotal - valorSubtotal * descPct / 100
      filas.push(et('SUBTOTAL CON DESCUENTO', { f: `${COL_IMP}${rSub}+${COL_IMP}${rDesc}`, v: base }))
    }
    const rIva = r++
    filas.push(et(`IVA (${ivaPct}%)`, { f: `${COL_IMP}${rBase}*${ivaPct}/100`, v: base * ivaPct / 100 }))
    const rTot = r++
    filas.push(et(`TOTAL ${moneda}`, { f: `${COL_IMP}${rBase}+${COL_IMP}${rIva}`, v: base * (1 + ivaPct / 100) }))

    // Tipo de cambio en la columna CANTIDAD (G) para que no se muestre como moneda.
    const rTC = r++
    filas.push({ estilo: 'total', celdas: ['', 'TIPO DE CAMBIO (USD → MXN)', '', '', '', '', tc, '', ''] })
    r++
    filas.push({ estilo: 'total', celdas: ['', 'TOTAL EN PESOS (MXN)', '', '', '', '', '', '', { f: `${COL_IMP}${rTot}*${COL_CANT}${rTC}`, v: base * (1 + ivaPct / 100) * tc }] })
    return { filas, rTot }
  }

  // ── Hoja de conceptos ──
  function hojaConceptos(nombre: string, gruposHoja: string[], subtitulo: string) {
    const filas: Fila[] = []
    const refsSubtotal: string[] = []
    let total = 0
    let r = FILAS_PORTADA + 1        // fila del encabezado de columnas
    r++                              // primera fila de datos

    gruposHoja.forEach((g, gi) => {
      const arr = consolidar(grupos.get(g) || [])
      const rGrupo = r++
      const rPrimero = r
      arr.forEach((c, ii) => {
        const fila = r++
        const importe = c.precio * c.cantidad
        if (opts.conPrecios) total += importe
        filas.push({
          estilo: 'dato',
          celdas: [
            `${gi + 1}.${ii + 1}`, c.descripcion, c.especificacion, c.marca, c.modelo, c.unidad, c.cantidad,
            opts.conPrecios ? c.precio : '',
            { f: `${COL_CANT}${fila}*${COL_PU}${fila}`, v: opts.conPrecios ? importe : 0 },
          ],
        })
      })
      // Concepto de cierre del sistema (instalación + programación prorrateada)
      const extra = extraPorGrupo.get(g)
      if (extra) {
        const fila = r++
        if (opts.conPrecios) total += extra.monto
        filas.push({
          estilo: 'dato',
          celdas: [`${gi + 1}.${arr.length + 1}`, extra.descripcion, extra.especificacion, '', '', 'LOTE', 1,
            opts.conPrecios ? extra.monto : '',
            { f: `${COL_CANT}${fila}*${COL_PU}${fila}`, v: opts.conPrecios ? extra.monto : 0 }],
        })
      }
      const rUltimo = r - 1
      const sumaGrupo = arr.reduce((s, c) => s + c.precio * c.cantidad, 0) + (extra ? extra.monto : 0)
      const formula = rUltimo >= rPrimero ? `SUM(${COL_IMP}${rPrimero}:${COL_IMP}${rUltimo})` : '0'
      // la fila de grupo se inserta en su lugar (antes de sus conceptos)
      filas.splice(filas.length - arr.length - (extra ? 1 : 0), 0, {
        estilo: 'grupo',
        celdas: [String(gi + 1), g.toUpperCase(), '', '', '', '', '', '', { f: formula, v: opts.conPrecios ? sumaGrupo : 0 }],
      })
      refsSubtotal.push(`${COL_IMP}${rGrupo}`)
    })

    const { filas: tot, rTot } = bloqueTotales(r, refsSubtotal.length ? refsSubtotal.join('+') : '0', total)
    return {
      hoja: {
        nombre, columnas: COLS_BASE, preFilas: portada(subtitulo),
        filas: [...filas, ...tot], notas: notasPie(), congelarEn: FILAS_PORTADA + 1,
      } as HojaXlsx,
      rTot, total,
    }
  }

  // ── Armado del libro ──
  const hojas: HojaXlsx[] = []
  const usados = new Set<string>()

  if (esESP && nombresGrupo.length > 1) {
    const nombreResumen = nombreHoja('Resumen', usados)
    const construidas: { nombre: string; etiqueta: string; conceptos: number; piezas: number; rSubtotalGrupo: number; total: number }[] = []

    for (const g of nombresGrupo) {
      const nom = nombreHoja(g, usados)
      const { hoja, total } = hojaConceptos(nom, [g], g)
      hojas.push(hoja)
      const arr = consolidar(grupos.get(g) || [])
      const extra = extraPorGrupo.get(g)
      construidas.push({
        nombre: nom, etiqueta: g.toUpperCase(),
        conceptos: arr.length + (extra ? 1 : 0),
        piezas: arr.reduce((s, c) => s + c.cantidad, 0),
        rSubtotalGrupo: FILAS_PORTADA + 2, total,
      })
    }

    // Resumen: cada renglón apunta al subtotal de su hoja (fórmula entre hojas)
    const filasRes: Fila[] = []
    let r = FILAS_PORTADA + 2
    const rPrimero = r
    construidas.forEach((c, i) => {
      r++
      filasRes.push({
        estilo: 'dato',
        celdas: [String(i + 1), c.etiqueta, `${c.conceptos} conceptos`, `${c.piezas.toLocaleString('es-MX')} en total`, '', '', '', '',
          { f: refHoja(c.nombre, `${COL_IMP}${c.rSubtotalGrupo}`), v: opts.conPrecios ? c.total : 0 }],
      })
    })
    const rUltimo = r - 1
    const totalGral = construidas.reduce((s, c) => s + c.total, 0)
    const { filas: tot } = bloqueTotales(r, `SUM(${COL_IMP}${rPrimero}:${COL_IMP}${rUltimo})`, totalGral)
    hojas.unshift({
      nombre: nombreResumen,
      columnas: [
        { titulo: 'PARTIDA', ancho: 10 },
        { titulo: 'PARTIDA / SISTEMA', ancho: 42 },
        { titulo: 'CONCEPTOS', ancho: 16 },
        { titulo: 'CANTIDAD', ancho: 16 },
        { titulo: '', ancho: 4 }, { titulo: '', ancho: 4 },
        { titulo: '', ancho: 11 }, { titulo: '', ancho: 4 },
        { titulo: 'IMPORTE', ancho: 18, moneda: true },
      ],
      preFilas: portada('Resumen general'),
      filas: [...filasRes, ...tot],
      notas: notasPie(),
      congelarEn: FILAS_PORTADA + 1,
    })
  } else {
    hojas.push(hojaConceptos(nombreHoja('Catálogo de conceptos', usados), nombresGrupo, '').hoja)
  }

  const limpio = (s: string) => (s || '').replace(/[\\/:*?"<>|]/g, '-').trim()
  descargarXlsx(`Catalogo_${opts.conPrecios ? 'Valorizado' : 'para_Cotizar'}_${limpio(proyecto)}_${limpio(especialidad)}`, hojas)
}
