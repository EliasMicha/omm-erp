// ═══════════════════════════════════════════════════════════════════════════
// catalogoLicitacion — exporta cualquier cotización como CATÁLOGO DE CONCEPTOS
// en formato de licitación formal (.xlsx).
//
// Dos variantes:
//   • "para cotizar"  (conPrecios=false) → lleva partida, descripción, marca y
//     modelo de referencia, unidad y cantidad, y deja P. UNITARIO e IMPORTE en
//     blanco para que un tercero los llene. Es el que se manda a concurso.
//   • "valorizado"    (conPrecios=true)  → los mismos conceptos con tus precios
//     unitarios e importes, subtotal, descuento, IVA y total.
//
// Lee directo de la BD (quotations + quotation_areas + quotation_items), así que
// sirve IGUAL para los 6 cotizadores (Especiales, Iluminación, Cortinas,
// Distribución, Proyecto e Ingeniería Eléctrica): todos persisten sus partidas
// en quotation_items.
//
// Agrupación:
//   • Especiales (esp) → UNA PESTAÑA POR SISTEMA (Audio, Video, Control…) más
//     una pestaña "Resumen" con el total por sistema. Es lo que pidió Elias.
//   • Las demás especialidades → una sola pestaña, agrupada por área.
// Numeración jerárquica: el grupo es 1, 2, 3… y sus conceptos 1.1, 1.2, 1.3…
//
// CONSOLIDACIÓN: un mismo producto capturado en varias áreas sale UNA SOLA VEZ
// con la cantidad sumada — un catálogo de licitación se cotiza por concepto, no
// por ubicación. En el modo valorizado, si el mismo producto quedó con precios
// unitarios distintos, se mantienen renglones separados para no falsear el
// importe (cada precio es su propio concepto).
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'
import { descargarXlsx, HojaXlsx, Fila } from './xlsxExport'

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
  marca: string | null; modelo: string | null; sku: string | null; nomenclatura: string | null
  order_index: number | null; provider: string | null
}

// Nombre de hoja válido en Excel: ≤31 chars y sin : \ / ? * [ ]
function nombreHoja(s: string, usados: Set<string>): string {
  let base = (s || 'Hoja').replace(/[:\\/?*[\]]/g, '-').trim().slice(0, 31) || 'Hoja'
  let n = base, i = 2
  while (usados.has(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf }
  usados.add(n.toLowerCase())
  return n
}

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

// Unidad: quotation_items no guarda unidad. Se infiere de la descripción para los
// casos obvios (cable/tubería por metro, mano de obra por servicio) y si no, PZA.
function unidadDe(it: ItemDB): string {
  const t = `${it.name || ''} ${it.description || ''}`.toLowerCase()
  if (it.type === 'labor' || it.type === 'mano_de_obra') return 'SERV'
  if (it.type === 'servicio') return 'SERV'
  if (/\bcable\b|\bconduit\b|tuber[ií]a|\bmanguera\b|\briel\b|\bcanaleta\b/.test(t)) return 'M'
  if (/\brollo\b/.test(t)) return 'ROLLO'
  if (/\bjuego\b|\bkit\b/.test(t)) return 'JGO'
  return 'PZA'
}

export interface OpcionesCatalogo {
  conPrecios: boolean
  /** Vigencia de la propuesta, en días naturales. */
  vigenciaDias?: number
}

export async function exportarCatalogoLicitacion(cotId: string, opts: OpcionesCatalogo): Promise<void> {
  const [{ data: cot }, { data: areasRaw }, { data: itemsRaw }] = await Promise.all([
    supabase.from('quotations').select('id,name,specialty,notes,client_name,created_at,project:projects!quotations_project_id_fkey(name,client_name)').eq('id', cotId).single(),
    supabase.from('quotation_areas').select('id,name,order_index').eq('quotation_id', cotId).order('order_index'),
    supabase.from('quotation_items').select('id,area_id,name,description,system,type,quantity,price,marca,modelo,sku,nomenclatura,order_index,provider').eq('quotation_id', cotId),
  ])
  if (!cot) throw new Error('No se encontró la cotización')
  const items = (itemsRaw || []) as ItemDB[]
  if (items.length === 0) throw new Error('Esta cotización no tiene partidas que exportar')

  let meta: any = {}
  try { meta = JSON.parse((cot as any).notes || '{}') } catch { /* notas libres */ }
  const moneda: string = meta.currency === 'USD' ? 'USD' : 'MXN'
  const ivaPct: number = typeof meta.ivaRate === 'number' ? meta.ivaRate : 16
  const descPct: number = typeof meta.descuento === 'number' ? meta.descuento : 0

  // Cliente: el lead del proyecto es la fuente más confiable; si no, el del proyecto.
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

  // ── Agrupación ──
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

    // ── Consolidación: mismo producto = un solo renglón con la cantidad sumada ──
  interface ItemCons {
    name: string; description: string; marca: string; modelo: string
    unidad: string; cantidad: number; price: number; orden: number
  }
  function consolidar(arr: ItemDB[]): ItemCons[] {
    const mapa = new Map<string, ItemCons>()
    arr.forEach((it, i) => {
      const cons: ItemCons = {
        name: it.name || '—',
        description: it.description || '',
        marca: it.marca || '',
        modelo: it.modelo || it.sku || it.nomenclatura || '',
        unidad: unidadDe(it),
        cantidad: Number(it.quantity) || 0,
        price: Number(it.price) || 0,
        orden: it.order_index ?? i,
      }
      // El precio entra en la llave solo cuando el catálogo va valorizado: si el
      // mismo producto tiene dos precios, son dos conceptos distintos y sumarlos
      // en un renglón daría un importe que no cuadra.
      const k = [cons.name, cons.description, cons.marca, cons.modelo, cons.unidad, opts.conPrecios ? cons.price : '']
        .map(v => String(v).trim().toLowerCase()).join('||')
      const prev = mapa.get(k)
      if (prev) { prev.cantidad += cons.cantidad; prev.orden = Math.min(prev.orden, cons.orden) }
      else mapa.set(k, cons)
    })
    return Array.from(mapa.values()).sort((a, b) => a.orden - b.orden || a.name.localeCompare(b.name, 'es'))
  }

  const importe = (it: ItemCons) => it.price * it.cantidad

  // ── Bloque de portada, igual en todas las hojas ──
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
    ]
    if (subtitulo) f.push({ celdas: ['Partida:', subtitulo], estilo: 'etiqueta' })
    f.push({ celdas: [] })
    return f
  }

  const notasPie = (): Fila[] => {
    const n: Fila[] = [
      { celdas: [] },
      { celdas: ['NOTAS Y CONDICIONES'], estilo: 'etiqueta' },
      { celdas: ['1. Las marcas y modelos indicados son DE REFERENCIA. Se aceptan equivalentes de características técnicas iguales o superiores, sujetos a aprobación.'] },
      { celdas: [`2. Los importes están expresados en ${moneda}. Los precios no incluyen IVA; el impuesto se muestra por separado en la fila de totales.`] },
      { celdas: ['3. Las cantidades corresponden al alcance del proyecto a la fecha de emisión de este catálogo. Cualquier variación deberá cotizarse por separado.'] },
      { celdas: ['4. Cada concepto se presenta consolidado: la cantidad indicada es el TOTAL requerido para el proyecto, sumando todas sus ubicaciones.'] },
      { celdas: [`5. Vigencia de la propuesta: ${opts.vigenciaDias || 15} días naturales a partir de la fecha de emisión.`] },
    ]
    if (!opts.conPrecios) {
      n.push({ celdas: ['6. El licitante deberá llenar las columnas PRECIO UNITARIO e IMPORTE de cada concepto, sin modificar descripciones ni cantidades.'] })
      n.push({ celdas: ['7. La propuesta deberá presentarse firmada, indicando tiempo de entrega y condiciones de pago por partida.'] })
      n.push({ celdas: [] })
      n.push({ celdas: ['Nombre y firma del licitante:', '', '', 'Tiempo de entrega:', '', 'Condiciones de pago:'], estilo: 'etiqueta' })
    }
    return n
  }

  // ── Construye una hoja con los grupos que se le pasen ──
  function hoja(nombre: string, gruposHoja: string[], subtitulo: string): HojaXlsx {
    const filas: Fila[] = []
    let sub = 0
    gruposHoja.forEach((g, gi) => {
      const arr = consolidar(grupos.get(g) || [])
      const totalGrupo = arr.reduce((s, it) => s + importe(it), 0)
      sub += totalGrupo
      filas.push({ celdas: [String(gi + 1), g.toUpperCase(), '', '', '', '', '', '', opts.conPrecios ? totalGrupo : ''], estilo: 'grupo' })
      arr.forEach((it, ii) => {
        filas.push({
          estilo: 'dato',
          celdas: [
            `${gi + 1}.${ii + 1}`,
            it.name,
            it.description,
            it.marca,
            it.modelo,
            it.unidad,
            it.cantidad,
            opts.conPrecios ? it.price : '',
            opts.conPrecios ? importe(it) : '',
          ],
        })
      })
    })

    const h: HojaXlsx = {
      nombre,
      columnas: COLS_BASE,
      preFilas: portada(subtitulo),
      filas,
      congelarEn: portada(subtitulo).length + 1,
      notas: notasPie(),
    }
    if (opts.conPrecios) {
      const desc = sub * (descPct / 100)
      const base = sub - desc
      const iva = base * (ivaPct / 100)
      const extra: Fila[] = [
        { celdas: [] },
        { celdas: ['', 'SUBTOTAL', '', '', '', '', '', '', sub], estilo: 'total' },
      ]
      if (descPct > 0) extra.push({ celdas: ['', `DESCUENTO (${descPct}%)`, '', '', '', '', '', '', -desc], estilo: 'total' })
      extra.push({ celdas: ['', `IVA (${ivaPct}%)`, '', '', '', '', '', '', iva], estilo: 'total' })
      extra.push({ celdas: ['', `TOTAL ${moneda}`, '', '', '', '', '', '', base + iva], estilo: 'total' })
      h.filas = [...filas, ...extra]
    } else {
      h.filas = [...filas, { celdas: [] }, { celdas: ['', 'SUMA (a llenar por el licitante)', '', '', '', '', '', '', ''], estilo: 'total' }]
    }
    return h
  }

  const hojas: HojaXlsx[] = []
  const usados = new Set<string>()

  if (esESP && nombresGrupo.length > 1) {
    // Resumen por sistema + una pestaña por sistema
    const resumen: Fila[] = nombresGrupo.map((g, i) => {
      const arr = consolidar(grupos.get(g) || [])
      const t = arr.reduce((s, it) => s + importe(it), 0)
      const piezas = arr.reduce((s, it) => s + it.cantidad, 0)
      return { estilo: 'dato' as const, celdas: [String(i + 1), g.toUpperCase(), `${arr.length} conceptos`, `${piezas.toLocaleString('es-MX')} en total`, '', '', '', '', opts.conPrecios ? t : ''] }
    })
    const totalGral = nombresGrupo.reduce((s, g) => s + consolidar(grupos.get(g) || []).reduce((a, it) => a + importe(it), 0), 0)
    const hr: HojaXlsx = {
      nombre: nombreHoja('Resumen', usados),
      columnas: [
        { titulo: 'PARTIDA', ancho: 10 },
        { titulo: 'SISTEMA', ancho: 34 },
        { titulo: 'CONCEPTOS', ancho: 16 },
        { titulo: 'CANTIDAD', ancho: 16 },
        { titulo: '', ancho: 4 }, { titulo: '', ancho: 4 }, { titulo: '', ancho: 4 },
        { titulo: '', ancho: 4 },
        { titulo: 'IMPORTE', ancho: 18, moneda: true },
      ],
      preFilas: portada('Resumen por sistema'),
      filas: opts.conPrecios
        ? [...resumen, { celdas: [] }, { celdas: ['', `SUBTOTAL ${moneda}`, '', '', '', '', '', '', totalGral], estilo: 'total' }]
        : [...resumen, { celdas: [] }, { celdas: ['', 'SUMA (a llenar por el licitante)', '', '', '', '', '', '', ''], estilo: 'total' }],
      notas: notasPie(),
    }
    hojas.push(hr)
    for (const g of nombresGrupo) hojas.push(hoja(nombreHoja(g, usados), [g], g))
  } else {
    hojas.push(hoja(nombreHoja('Catálogo de conceptos', usados), nombresGrupo, ''))
  }

  const limpio = (s: string) => (s || '').replace(/[\\/:*?"<>|]/g, '-').trim()
  const archivo = `Catalogo_${opts.conPrecios ? 'Valorizado' : 'para_Cotizar'}_${limpio(proyecto)}_${limpio(especialidad)}`
  descargarXlsx(archivo, hojas)
}
