// ═══════════════════════════════════════════════════════════════════════════
//  OMM Cotizaciones — tools de negocio para el MCP (mcp-cotizaciones).
//
//  El cotizador es la pieza mas complicada del ERP: cada especialidad cotiza
//  distinto, los costos vienen en la moneda del proveedor y se convierten con
//  un tipo de cambio que vive en la pantalla, no en la base. Ya nos costo un
//  error de 18x por leer una moneda de menos.
//
//  De ahi la regla de este modulo, y es la unica que importa:
//
//      ESTE BOT NO COTIZA.
//
//  No pone partidas, no toca costos, no pone markups, no cambia la moneda ni
//  el tipo de cambio, no recalcula totales. Nada que produzca un numero que
//  alguien le vaya a mandar a un cliente. Eso lo hace quien sabe cotizar esa
//  especialidad, en la pantalla que se hizo para eso.
//
//  Lo que si hace es el seguimiento, que es justo lo que hoy no existe:
//   - contesta en que va el pipeline,
//   - dice que cotizaciones llevan mas dias parados de lo que aguanta su etapa,
//   - abre el cascaron vacio para que el especialista solo llegue a cotizar,
//   - pone dueño y mueve la etapa dentro de lo reversible.
//
//  Lo que NO hace, a proposito:
//   - marcar CONTRATO. En el ERP eso dispara la generacion de ordenes de
//     compra y, en proy, la creacion del proyecto. Es una cascada que sale de
//     Cotizaciones y aterriza en Compras y Obra: la aprieta una persona.
//   - marcar PERDIDA. Es un juicio comercial, y sacar una obra del pipeline
//     no es trabajo de seguimiento.
//   - escribir partidas, precios, totales o design_rules.
// ═══════════════════════════════════════════════════════════════════════════

export interface CotActor {
  app_user_id: string
  nombre: string
  email: string
  employee_id: string | null
  permission_area: string
  nivel: string
}

export interface CotCtx { supabase: any; actor: CotActor }

export interface CotToolResult {
  success: boolean
  data?: unknown
  error?: string
  affected_entity_type?: string
  affected_entity_id?: string
}

export type ClaseDeTool = 'consulta' | 'operacion' | 'escalacion'

export interface CotTool {
  clase: ClaseDeTool
  definition: { name: string; description: string; input_schema: Record<string, unknown> }
  handler: (input: any, ctx: CotCtx) => Promise<CotToolResult>
}

/**
 * Lo que alcanza Cotizaciones. Lee su modulo completo y el contexto minimo
 * para saber de quien es cada cosa (leads, obras, el padron).
 *
 * quotation_items se LEE y no se escribe: ahi viven costo, markup y precio.
 * Es la linea entre consultar una cotizacion y cotizarla.
 *
 * design_rules no esta ni en lectura: son las reglas con las que el ERP
 * cotiza, y acotar.ts las tiene en CONFIGURACION_DEL_ERP de todos modos.
 */
export const ALCANCE_COT = {
  modulo: 'mcp-cotizaciones',
  lectura: [
    'quotations', 'quotation_areas', 'quotation_items',
    'leads', 'projects', 'clientes', 'sla_config',
    'employees',
  ],
  // app_users NO esta a proposito: ninguna tool la lee. El actor se resuelve en
  // index.ts con el cliente sin acotar, antes de que este alcance exista, asi
  // que listarla aqui solo seria permiso de mas.
  // Ventaja secundaria: como el resto de las tablas se ven igual con anon que
  // con service role, las pruebas contra datos reales miden lo que va a pasar
  // en produccion. Eso es lo que no se hizo en la validacion de Cobranza.

  escritura: ['quotations', 'quotation_areas'],
}

/**
 * acotar.ts cuida TABLAS; esto cuida COLUMNAS.
 *
 * Poder escribir `quotations` es poder escribir `total`, `total_final` y
 * `stage`, que es justo lo que este modulo no debe tocar. En vez de confiar en
 * que cada handler se porte bien, toda escritura pasa por aqui y la lista de
 * columnas permitidas se declara en el lugar de la llamada. Si un handler
 * futuro intenta colar `total`, revienta aqui y no en la cotizacion de alguien.
 */
class ColumnaProhibida extends Error {
  constructor(tabla: string, columnas: string[]) {
    super(
      `mcp-cotizaciones no puede escribir ${columnas.join(', ')} en ${tabla}. ` +
      'Costos, precios y totales los calcula el cotizador del ERP, no un bot.',
    )
    this.name = 'ColumnaProhibida'
  }
}

function soloCampos<T extends Record<string, unknown>>(tabla: string, fila: T, permitidas: string[]): T {
  const sobra = Object.keys(fila).filter(k => !permitidas.includes(k))
  if (sobra.length > 0) throw new ColumnaProhibida(tabla, sobra)
  return fila
}

/** Lo unico que este modulo puede tocar de una cotizacion ya existente. */
const CAMPOS_QUOTATION = ['stage', 'stage_changed_at', 'assignee_id', 'updated_at']
/** Al crear el cascaron, ademas de los de arriba. Ningun campo de dinero. */
const CAMPOS_NUEVA = [
  'name', 'specialty', 'stage', 'client_name', 'project_id', 'notes',
  'assignee_id', 'stage_changed_at',
]

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const esDryRun = (input: any): boolean => input?.dry_run === true
const num = (v: unknown): number => Number(v) || 0
const likeSafe = (q: string): string => q.replace(/[%,()]/g, ' ').trim()

const ESPECIALIDADES = ['esp', 'elec', 'ilum', 'cort', 'proy', 'dist'] as const
const MONEDAS = ['MXN', 'USD'] as const
const TIPOS_PROYECTO = ['especiales', 'electrica', 'iluminacion'] as const

/**
 * Las etiquetas son las de la pantalla, no las de la base. Si el bot dice
 * "propuesta" y Elias ve "Por cerrar", estan hablando de lo mismo sin saberlo.
 */
const ETAPA_LABEL: Record<string, string> = {
  oportunidad: 'Oportunidad',
  estimacion: 'Estimación',
  propuesta: 'Por cerrar',
  contrato: 'Contrato',
  perdida: 'Perdida',
}

const ESPECIALIDAD_LABEL: Record<string, string> = {
  esp: 'Especiales', elec: 'Eléctrico', ilum: 'Iluminación',
  cort: 'Cortinas', proy: 'Proyectos', dist: 'Distribución',
}

/** El avance comercial, en orden. contrato y perdida no estan: son salidas. */
const AVANCE = ['oportunidad', 'estimacion', 'propuesta'] as const
/** Etapas que este modulo puede poner. */
const ETAPAS_PERMITIDAS = new Set<string>(AVANCE)
/** Etapas que este modulo no pone ni desde las que mueve. */
const ETAPAS_CERRADAS = new Set(['contrato', 'perdida'])

const POR_QUE_NO: Record<string, string> = {
  contrato:
    'Marcar contrato en el ERP genera las ordenes de compra de la cotizacion y, si es de Proyectos, ' +
    'crea el proyecto en Obra. Es una cascada que sale de Cotizaciones, asi que la aprieta una persona.',
  perdida:
    'Dar una cotizacion por perdida es un juicio comercial, no seguimiento. Lo marca quien la trabajo.',
}

/** Lee la meta que el ERP guarda como JSON en quotations.notes. */
function meta(notes: unknown): Record<string, any> {
  try { return JSON.parse(typeof notes === 'string' ? notes : '{}') || {} } catch { return {} }
}

function monedaDe(notes: unknown): string {
  const m = meta(notes)
  return m.currency === 'MXN' ? 'MXN' : 'USD'
}

/** El importe que cuenta: total_final si ya se cerro, si no el total. Igual que Cobranza. */
const importeDe = (q: any): number => (q.total_final != null ? num(q.total_final) : num(q.total))

const dias = (desde: unknown): number | null => {
  if (!desde) return null
  const t = new Date(String(desde)).getTime()
  if (!isFinite(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

/**
 * El sufijo del folio, igual que omm_sufijo_cotizacion en Postgres. Se replica
 * para poder ENSEÑAR el folio en dry_run sin escribir: predecirlo mal seria
 * peor que no predecirlo, asi que si esto y la base se separan, se nota aqui.
 */
const SUFIJO_ESPECIALIDAD: Record<string, string> = {
  esp: 'ES', elec: 'IE', ilum: 'IL', cort: 'CO', proy: 'PR', dist: 'DI',
}
const SUFIJO_PROY: Record<string, string> = {
  electrica: 'PR-IE', iluminacion: 'PR-ILU', especiales: 'PR-IESP',
}
function sufijoDe(specialty: string, tipoProyecto?: string): string {
  if (specialty === 'proy') return SUFIJO_PROY[tipoProyecto || 'especiales'] || 'PR-IESP'
  return SUFIJO_ESPECIALIDAD[specialty] || 'GE'
}

/**
 * El folio que le tocaria. Misma cuenta que omm_folio_cotizacion: el maximo
 * consecutivo del prefijo, mas uno. Sin lock, porque esto solo predice; el
 * numero de verdad lo pone el trigger cuando se inserta.
 */
async function folioPrevisto(
  supabase: any, codigoLead: string, sufijo: string,
): Promise<{ folio: string | null; nota?: string }> {
  if (!codigoLead) return { folio: null, nota: 'El lead no tiene codigo, asi que la cotizacion nacera sin folio.' }
  const prefijo = codigoLead + '-' + sufijo
  const { data } = await supabase.from('quotations').select('folio').like('folio', prefijo + '%')
  let n = 0
  for (const r of data || []) {
    const m = String(r.folio || '').match(new RegExp('^' + prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$'))
    if (m) n = Math.max(n, parseInt(m[1], 10))
  }
  return { folio: prefijo + String(n + 1).padStart(2, '0') }
}

/** El padron por id, para poner nombres en vez de uuids. */
async function padron(supabase: any): Promise<Record<string, string>> {
  const { data } = await supabase.from('employees').select('id, name, nombre').eq('is_active', true)
  const m: Record<string, string> = {}
  for (const e of data || []) m[e.id] = (e.nombre || e.name || '').trim()
  return m
}

// ═══ TOOL: cot_buscar ══════════════════════════════════════════════════════
const cotBuscar: CotTool = {
  clase: 'consulta',
  definition: {
    name: 'cot_buscar',
    description:
      'Busca cotizaciones por nombre, folio, cliente o lead, y filtra por etapa y especialidad. ' +
      'Devuelve el renglon de seguimiento de cada una: folio, etapa, dueño, dias en la etapa e importe en su moneda. ' +
      'Es la tool para "que cotizaciones tiene tal lead", "que trae Iluminacion por cerrar" o "de quien es este folio". ' +
      'Por defecto solo trae las VIGENTES: las no vigentes son versiones viejas que se dejaron atras y ' +
      'contarlas es contar dos veces la misma obra. No escribe nada.',
    input_schema: {
      type: 'object',
      properties: {
        busqueda: { type: 'string', description: 'Texto libre: nombre de la cotizacion, folio o cliente' },
        lead_id: { type: 'string', description: 'Para ver todas las cotizaciones de un lead' },
        etapa: { type: 'string', enum: ['oportunidad', 'estimacion', 'propuesta', 'contrato', 'perdida'], description: 'propuesta es lo que la pantalla llama "Por cerrar"' },
        especialidad: { type: 'string', enum: [...ESPECIALIDADES] },
        solo_abiertas: { type: 'boolean', default: false, description: 'Deja fuera contrato y perdida: lo que todavia se puede mover' },
        solo_vigentes: { type: 'boolean', default: true, description: 'Deja fuera las versiones superadas' },
        sin_dueno: { type: 'boolean', default: false, description: 'Solo las que no tienen responsable' },
        limit: { type: 'integer', default: 25 },
      },
    },
  },
  handler: async (input, ctx) => {
    const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100)

    let q = ctx.supabase.from('quotations')
      .select('id, folio, name, specialty, stage, client_name, total, total_final, notes, assignee_id, vigente, created_at, updated_at, stage_changed_at, version_label')
      .order('updated_at', { ascending: false })

    if (input.solo_vigentes !== false) q = q.eq('vigente', true)
    if (s(input.etapa)) q = q.eq('stage', s(input.etapa))
    if (s(input.especialidad)) q = q.eq('specialty', s(input.especialidad))
    if (input.solo_abiertas === true) q = q.in('stage', [...AVANCE])
    if (input.sin_dueno === true) q = q.is('assignee_id', null)

    const texto = likeSafe(s(input.busqueda))
    if (texto) q = q.or(`name.ilike.%${texto}%,folio.ilike.%${texto}%,client_name.ilike.%${texto}%`)

    // El lead vive dentro del JSON de notes, asi que no se puede filtrar en la
    // consulta: se trae mas y se filtra aqui.
    const leadId = s(input.lead_id)
    const { data, error } = await q.limit(leadId ? 500 : limit)
    if (error) return { success: false, error: error.message }

    let filas = data || []
    if (leadId) filas = filas.filter((r: any) => meta(r.notes).lead_id === leadId).slice(0, limit)

    const emp = await padron(ctx.supabase)

    return {
      success: true,
      data: {
        encontradas: filas.length,
        cotizaciones: filas.map((r: any) => {
          const m = meta(r.notes)
          const d = dias(r.stage_changed_at || r.updated_at || r.created_at)
          return {
            id: r.id,
            folio: r.folio || '(sin folio)',
            nombre: r.name + (r.version_label ? ' (v' + r.version_label + ')' : ''),
            especialidad: ESPECIALIDAD_LABEL[r.specialty] || r.specialty,
            etapa: ETAPA_LABEL[r.stage] || r.stage,
            lead: m.lead_name || null,
            lead_id: m.lead_id || null,
            cliente: r.client_name || null,
            dueno: r.assignee_id ? (emp[r.assignee_id] || '(alguien que ya no esta activo)') : 'Sin asignar',
            importe: importeDe(r),
            moneda: monedaDe(r.notes),
            dias_en_etapa: d,
            vigente: r.vigente,
          }
        }),
        nota: input.solo_vigentes === false ? 'Incluye versiones no vigentes: no sumes sus importes, son la misma obra repetida.' : undefined,
      },
    }
  },
}

// ═══ TOOL: cot_detalle ═════════════════════════════════════════════════════
const cotDetalle: CotTool = {
  clase: 'consulta',
  definition: {
    name: 'cot_detalle',
    description:
      'Abre una cotizacion: encabezado, areas con su subtotal, que partidas trae y su estado de seguimiento. ' +
      'Sirve para contestar "que incluye esta cotizacion" y "que le falta". ' +
      'Da los subtotales por area y el total —los mismos que ya se ven en CRM y Cobranza— pero NO da ' +
      'costo, markup ni precio unitario de cada partida: eso es el cotizador y no es asunto de un bot. ' +
      'Si te preguntan por que un precio es el que es, pasalo con quien cotiza esa especialidad.',
    input_schema: {
      type: 'object',
      properties: {
        quotation_id: { type: 'string', description: 'El id que devolvio cot_buscar' },
        folio: { type: 'string', description: 'Alternativa al id, si lo que tienes es el folio' },
        incluir_partidas: { type: 'boolean', default: false, description: 'Lista los nombres y cantidades de las partidas, sin importes' },
      },
    },
  },
  handler: async (input, ctx) => {
    const id = s(input.quotation_id)
    const folio = s(input.folio)
    if (!id && !folio) return { success: false, error: 'Dame quotation_id o folio.' }

    const sel = 'id, folio, name, specialty, stage, client_name, total, total_final, notes, assignee_id, vigente, project_id, created_at, updated_at, stage_changed_at, version_label, anticipo_monto, anticipo_pct'
    const { data: cot, error } = id
      ? await ctx.supabase.from('quotations').select(sel).eq('id', id).maybeSingle()
      : await ctx.supabase.from('quotations').select(sel).eq('folio', folio).maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!cot) return { success: false, error: `No encontre la cotizacion ${id || folio}.` }

    const [{ data: areas }, { data: items }, emp] = await Promise.all([
      ctx.supabase.from('quotation_areas').select('id, name, order_index, subtotal').eq('quotation_id', cot.id).order('order_index'),
      ctx.supabase.from('quotation_items').select('id, area_id, name, quantity, system, type').eq('quotation_id', cot.id),
      padron(ctx.supabase),
    ])

    const porArea: Record<string, number> = {}
    for (const it of items || []) porArea[it.area_id] = (porArea[it.area_id] || 0) + 1

    const m = meta(cot.notes)
    const moneda = monedaDe(cot.notes)
    const d = dias(cot.stage_changed_at || cot.updated_at || cot.created_at)

    // El SLA de su etapa, si la etapa tiene uno.
    const { data: slas } = await ctx.supabase.from('sla_config')
      .select('stage, max_days, alert_days').eq('entity_type', 'quotation').eq('stage', cot.stage)
    const sla = (slas || [])[0]

    const detalle: Record<string, unknown> = {
      id: cot.id,
      folio: cot.folio || '(sin folio)',
      nombre: cot.name + (cot.version_label ? ' (v' + cot.version_label + ')' : ''),
      especialidad: ESPECIALIDAD_LABEL[cot.specialty] || cot.specialty,
      etapa: ETAPA_LABEL[cot.stage] || cot.stage,
      etapa_clave: cot.stage,
      vigente: cot.vigente,
      lead: m.lead_name || null,
      lead_id: m.lead_id || null,
      cliente: cot.client_name || null,
      dueno: cot.assignee_id ? (emp[cot.assignee_id] || '(inactivo)') : 'Sin asignar',
      importe: importeDe(cot),
      moneda,
      creada: cot.created_at,
      dias_en_etapa: d,
      sla_de_la_etapa: sla ? { limite_dias: sla.max_days, alerta_dias: sla.alert_days, pasada: d != null && d >= sla.max_days } : null,
      areas: (areas || []).map((a: any) => ({
        nombre: a.name, partidas: porArea[a.id] || 0, subtotal: num(a.subtotal), moneda,
      })),
      partidas_totales: (items || []).length,
      sistemas: m.systems && Array.isArray(m.systems) && m.systems.length ? m.systems : null,
      ...(cot.specialty === 'proy' ? { tipo_proyecto: m.tipoProyecto || null, m2_construccion: m.m2Construccion || null } : {}),
    }

    if ((items || []).length === 0) {
      detalle.estado = 'Cascaron vacio: tiene areas pero ni una partida. Todavia no esta cotizada.'
    }

    if (input.incluir_partidas === true) {
      const nombreArea: Record<string, string> = {}
      for (const a of areas || []) nombreArea[a.id] = a.name
      detalle.partidas = (items || []).map((it: any) => ({
        area: nombreArea[it.area_id] || '(sin area)',
        nombre: it.name,
        cantidad: num(it.quantity),
        sistema: it.system || null,
        tipo: it.type || null,
      }))
      detalle.nota_partidas = 'Sin importes a proposito: los precios los pone el cotizador.'
    }

    return { success: true, data: detalle }
  },
}

// ═══ TOOL: cot_pipeline ════════════════════════════════════════════════════
const cotPipeline: CotTool = {
  clase: 'consulta',
  definition: {
    name: 'cot_pipeline',
    description:
      'El pipeline comercial de un golpe: cuantas cotizaciones y cuanto importe hay en cada etapa, ' +
      'partido por especialidad si se pide, mas el conteo de las que no tienen dueño. ' +
      'Los importes van SEPARADOS por moneda y no se suman entre si: mezclar pesos y dolares sin decir ' +
      'el tipo de cambio es como se producen los errores de 18x. Solo cuenta las vigentes. No escribe nada.',
    input_schema: {
      type: 'object',
      properties: {
        por_especialidad: { type: 'boolean', default: false, description: 'Desglosa cada etapa por especialidad' },
        especialidad: { type: 'string', enum: [...ESPECIALIDADES], description: 'Limita todo a una especialidad' },
      },
    },
  },
  handler: async (input, ctx) => {
    let q = ctx.supabase.from('quotations')
      .select('id, specialty, stage, total, total_final, notes, assignee_id')
      .eq('vigente', true)
    if (s(input.especialidad)) q = q.eq('specialty', s(input.especialidad))

    const { data, error } = await q
    if (error) return { success: false, error: error.message }
    const filas = data || []

    const bucket = () => ({ cotizaciones: 0, MXN: 0, USD: 0, sin_dueno: 0 })
    const porEtapa: Record<string, any> = {}
    const porEtapaEsp: Record<string, Record<string, any>> = {}

    for (const r of filas) {
      const moneda = monedaDe(r.notes)
      const imp = importeDe(r)
      porEtapa[r.stage] ||= bucket()
      porEtapa[r.stage].cotizaciones++
      porEtapa[r.stage][moneda] += imp
      if (!r.assignee_id) porEtapa[r.stage].sin_dueno++

      if (input.por_especialidad === true) {
        porEtapaEsp[r.stage] ||= {}
        porEtapaEsp[r.stage][r.specialty] ||= bucket()
        porEtapaEsp[r.stage][r.specialty].cotizaciones++
        porEtapaEsp[r.stage][r.specialty][moneda] += imp
        if (!r.assignee_id) porEtapaEsp[r.stage][r.specialty].sin_dueno++
      }
    }

    const orden = ['oportunidad', 'estimacion', 'propuesta', 'contrato', 'perdida']
    const etapas = orden.filter(e => porEtapa[e]).map(e => ({
      etapa: ETAPA_LABEL[e], etapa_clave: e,
      cotizaciones: porEtapa[e].cotizaciones,
      importe_MXN: Math.round(porEtapa[e].MXN),
      importe_USD: Math.round(porEtapa[e].USD),
      sin_dueno: porEtapa[e].sin_dueno,
      ...(input.por_especialidad === true
        ? { por_especialidad: Object.entries(porEtapaEsp[e] || {}).map(([k, v]: any) => ({
            especialidad: ESPECIALIDAD_LABEL[k] || k, cotizaciones: v.cotizaciones,
            importe_MXN: Math.round(v.MXN), importe_USD: Math.round(v.USD), sin_dueno: v.sin_dueno,
          })) }
        : {}),
    }))

    const abiertas = filas.filter((r: any) => ETAPAS_PERMITIDAS.has(r.stage))

    return {
      success: true,
      data: {
        etapas,
        totales: {
          vigentes: filas.length,
          abiertas: abiertas.length,
          abiertas_sin_dueno: abiertas.filter((r: any) => !r.assignee_id).length,
        },
        nota: 'MXN y USD van aparte a proposito. Si necesitas un solo numero, di con que tipo de cambio lo sumaste.',
      },
    }
  },
}

// ═══ TOOL: cot_estancadas ══════════════════════════════════════════════════
const cotEstancadas: CotTool = {
  clase: 'consulta',
  definition: {
    name: 'cot_estancadas',
    description:
      'Que cotizaciones llevan mas dias parados de los que aguanta su etapa, segun el SLA que ya tiene ' +
      'configurado el ERP (oportunidad 5 dias, estimacion 7, por cerrar 10). Es la tool del seguimiento: ' +
      'de aqui sale a quien hay que empujar y con que. Ordena por lo mas atrasado primero. ' +
      'Cada renglon dice de donde salio su reloj: "desde_cambio_de_etapa" es un dato confiable; ' +
      '"desde_creacion" quiere decir que esa cotizacion nunca registro cuando cambio de etapa, asi que el ' +
      'numero es dias desde que nacio y es un techo, no los dias reales en la etapa. Di siempre cual es. ' +
      'No escribe nada.',
    input_schema: {
      type: 'object',
      properties: {
        especialidad: { type: 'string', enum: [...ESPECIALIDADES] },
        etapa: { type: 'string', enum: ['oportunidad', 'estimacion', 'propuesta'] },
        incluir_alertas: { type: 'boolean', default: true, description: 'Tambien las que van llegando al limite, no solo las pasadas' },
        limit: { type: 'integer', default: 20 },
      },
    },
  },
  handler: async (input, ctx) => {
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 80)

    const { data: slas, error: errSla } = await ctx.supabase.from('sla_config')
      .select('stage, max_days, alert_days').eq('entity_type', 'quotation')
    if (errSla) return { success: false, error: errSla.message }
    const slaDe: Record<string, { max_days: number; alert_days: number }> = {}
    for (const r of slas || []) slaDe[r.stage] = { max_days: r.max_days, alert_days: r.alert_days }

    let q = ctx.supabase.from('quotations')
      .select('id, folio, name, specialty, stage, client_name, total, total_final, notes, assignee_id, created_at, updated_at, stage_changed_at')
      .eq('vigente', true)
      .in('stage', s(input.etapa) ? [s(input.etapa)] : [...AVANCE])
    if (s(input.especialidad)) q = q.eq('specialty', s(input.especialidad))

    const { data, error } = await q
    if (error) return { success: false, error: error.message }

    const emp = await padron(ctx.supabase)
    const conAlertas = input.incluir_alertas !== false
    const filas: any[] = []
    let sinReloj = 0

    for (const r of data || []) {
      const sla = slaDe[r.stage]
      if (!sla) continue

      // El reloj: stage_changed_at solo sirve si de veras registro un cambio de
      // etapa. Si es igual a la creacion y la cotizacion ya avanzo, nadie lo
      // movio nunca y lo que mide son dias desde que nacio.
      const creada = new Date(String(r.created_at)).getTime()
      const cambio = r.stage_changed_at ? new Date(String(r.stage_changed_at)).getTime() : NaN
      const relojReal = isFinite(cambio) && isFinite(creada) && Math.abs(cambio - creada) > 60000
      const origen = relojReal ? 'desde_cambio_de_etapa' : 'desde_creacion'
      if (!relojReal && r.stage !== 'oportunidad') sinReloj++

      const d = dias(relojReal ? r.stage_changed_at : (r.created_at || r.updated_at))
      if (d == null) continue

      const pasada = d >= sla.max_days
      const enAlerta = d >= sla.alert_days
      if (!pasada && !(conAlertas && enAlerta)) continue

      const m = meta(r.notes)
      filas.push({
        id: r.id,
        folio: r.folio || '(sin folio)',
        nombre: r.name,
        especialidad: ESPECIALIDAD_LABEL[r.specialty] || r.specialty,
        etapa: ETAPA_LABEL[r.stage] || r.stage,
        etapa_clave: r.stage,
        lead: m.lead_name || null,
        cliente: r.client_name || null,
        dueno: r.assignee_id ? (emp[r.assignee_id] || '(inactivo)') : 'Sin asignar',
        importe: importeDe(r), moneda: monedaDe(r.notes),
        dias: d, limite_dias: sla.max_days,
        dias_de_mas: Math.max(0, d - sla.max_days),
        gravedad: pasada ? (d >= sla.max_days * 2 ? 'critica' : 'pasada') : 'alerta',
        reloj: origen,
      })
    }

    filas.sort((a, b) => (b.dias - b.limite_dias) - (a.dias - a.limite_dias))
    const recorte = filas.slice(0, limit)

    return {
      success: true,
      data: {
        estancadas: recorte.length,
        total_detectadas: filas.length,
        pasadas: filas.filter(f => f.gravedad !== 'alerta').length,
        sin_dueno: filas.filter(f => f.dueno === 'Sin asignar').length,
        cotizaciones: recorte,
        aviso_del_reloj: sinReloj > 0
          ? `${sinReloj} de estas ya avanzaron de etapa pero nunca registraron cuando, asi que su reloj cuenta ` +
            'desde que se creo la cotizacion. Tomalo como el maximo posible, no como los dias reales en la etapa. ' +
            'Las que se muevan de aqui en adelante si quedan bien fechadas.'
          : undefined,
      },
    }
  },
}

// ═══ TOOL: cot_crear_borrador ══════════════════════════════════════════════
const cotCrearBorrador: CotTool = {
  clase: 'operacion',
  definition: {
    name: 'cot_crear_borrador',
    description:
      'Abre el cascaron de una cotizacion: lead, nombre, especialidad, moneda y areas. CERO partidas y ' +
      'CERO precios — deja lista la carpeta para que el especialista llegue nada mas a cotizar. ' +
      'Nace en Oportunidad. ' +
      'OJO: consume un folio de ese lead, que es un consecutivo que ya no regresa y que la gente usa para ' +
      'referirse a la obra. Asi que corre PRIMERO con dry_run: true, confirma con quien te lo pidio el folio ' +
      'y el nombre que va a quedar, y solo entonces hazlo de verdad con idempotency_key. ' +
      'Un cascaron de mas no rompe nada, pero ensucia el pipeline y le quita el numero al que si iba.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'Obligatorio. De ahi sale el codigo del folio. Sacalo del CRM.' },
        name: { type: 'string', description: 'Obligatorio. Como se va a llamar, con la obra y la especialidad: "Sinaloa 87 - Iluminacion"' },
        especialidad: { type: 'string', enum: [...ESPECIALIDADES], description: 'Obligatorio. Cada una cotiza distinto y de aqui sale el folio.' },
        moneda: { type: 'string', enum: [...MONEDAS], description: 'Por defecto USD, salvo Proyectos y Cortinas que van en MXN, igual que la pantalla' },
        areas: { type: 'array', items: { type: 'string' }, description: 'Solo para Especiales. Si no mandas, van las cuatro de siempre. Las demas especialidades llevan un area General.' },
        tipo_proyecto: { type: 'string', enum: [...TIPOS_PROYECTO], description: 'Solo Proyectos: cambia el folio (PR-IE / PR-ILU / PR-IESP)' },
        m2_construccion: { type: 'number', description: 'Solo Proyectos' },
        project_id: { type: 'string', description: 'Si ya existe la obra en Proyectos' },
        dueno_employee_id: { type: 'string', description: 'Quien la va a trabajar. Si lo sabes, ponlo desde aqui: una cotizacion sin dueño no la mueve nadie.' },
        dry_run: { type: 'boolean', description: 'Corre esto primero. Te dice el folio que le tocaria, sin escribir.' },
        idempotency_key: { type: 'string', description: 'Para la de verdad. Si se corta la conexion y reintentas con la misma clave, no salen dos cotizaciones.' },
      },
      required: ['lead_id', 'name', 'especialidad'],
    },
  },
  handler: async (input, ctx) => {
    const leadId = s(input.lead_id)
    const nombre = s(input.name)
    const esp = s(input.especialidad)

    if (!leadId) return { success: false, error: 'Falta lead_id: sin lead la cotizacion nace sin folio y sin dueño de obra. Buscalo en el CRM.' }
    if (!nombre) return { success: false, error: 'Falta name. Ponle la obra y la especialidad, como "Sinaloa 87 - Iluminacion".' }
    if (!ESPECIALIDADES.includes(esp as any)) {
      return { success: false, error: `especialidad invalida: "${input.especialidad}". Las que hay: ${ESPECIALIDADES.join(', ')}.` }
    }

    const { data: lead } = await ctx.supabase.from('leads')
      .select('id, name, company, codigo').eq('id', leadId).maybeSingle()
    if (!lead) return { success: false, error: `El lead ${leadId} no existe. Confirmalo en el CRM antes de crear la cotizacion.` }

    const esProy = esp === 'proy'
    const esEsp = esp === 'esp'
    const tipoProyecto = esProy ? (TIPOS_PROYECTO.includes(s(input.tipo_proyecto) as any) ? s(input.tipo_proyecto) : 'especiales') : undefined

    // La moneda por defecto es la de la pantalla: USD salvo proy y cort.
    const monedaPedida = s(input.moneda).toUpperCase()
    if (monedaPedida && !MONEDAS.includes(monedaPedida as any)) {
      return { success: false, error: `moneda invalida: "${input.moneda}". Solo MXN o USD.` }
    }
    const moneda = monedaPedida || (esProy || esp === 'cort' ? 'MXN' : 'USD')

    const AREAS_DE_SIEMPRE = ['Recámara Principal', 'Sala/Comedor', 'Cocina', 'Site']
    const areasPedidas = Array.isArray(input.areas) ? input.areas.map((a: unknown) => s(a)).filter(Boolean) : []
    const areas = esEsp ? (areasPedidas.length ? areasPedidas : AREAS_DE_SIEMPRE) : ['General']

    // El dueño, si lo mandaron, tiene que existir y estar activo.
    let duenoId: string | null = null
    if (s(input.dueno_employee_id)) {
      const { data: e } = await ctx.supabase.from('employees')
        .select('id, name, nombre, is_active').eq('id', s(input.dueno_employee_id)).maybeSingle()
      if (!e) return { success: false, error: `No existe el empleado ${input.dueno_employee_id}.` }
      if (e.is_active === false) return { success: false, error: `${e.nombre || e.name} ya no esta activo; no le puedes asignar la cotizacion.` }
      duenoId = e.id
    }

    if (s(input.project_id)) {
      const { data: p } = await ctx.supabase.from('projects').select('id').eq('id', s(input.project_id)).maybeSingle()
      if (!p) return { success: false, error: `No existe el proyecto ${input.project_id}.` }
    }

    const sufijo = sufijoDe(esp, tipoProyecto)
    const { folio: previsto, nota: notaFolio } = await folioPrevisto(ctx.supabase, lead.codigo || '', sufijo)

    // La meta exactamente como la escribe la pantalla: es lo que leen el folio,
    // Cobranza, CRM y el PDF. Un campo distinto aqui y el folio sale mal.
    const notesObj: Record<string, unknown> = {
      systems: [],
      currency: moneda,
      lead_id: lead.id,
      lead_name: lead.name || '',
      ...(esProy ? { m2Construccion: num(input.m2_construccion), tipoProyecto } : {}),
    }

    const ahora = new Date().toISOString()
    const fila = soloCampos('quotations', {
      name: nombre,
      specialty: esp,
      stage: 'oportunidad',
      client_name: lead.company || lead.name || null,
      project_id: s(input.project_id) || null,
      notes: JSON.stringify(notesObj),
      assignee_id: duenoId,
      stage_changed_at: ahora,
    } as Record<string, unknown>, CAMPOS_NUEVA)

    if (esDryRun(input)) {
      return {
        success: true,
        data: {
          dry_run: true,
          se_crearia: {
            nombre, especialidad: ESPECIALIDAD_LABEL[esp], etapa: 'Oportunidad',
            lead: lead.name, cliente: fila.client_name, moneda,
            areas, partidas: 0,
            ...(esProy ? { tipo_proyecto: tipoProyecto, m2_construccion: num(input.m2_construccion) } : {}),
            dueno: duenoId ? 'asignado' : 'Sin asignar',
          },
          folio_que_le_tocaria: previsto,
          nota_folio: notaFolio || 'Ese folio se consume al crearla y no regresa. Confirmalo antes de hacerlo de verdad.',
          aviso: 'Nace vacia: sin partidas y sin precios. Cotizarla es trabajo del especialista en la pantalla de Cotizaciones.',
        },
      }
    }

    const { data: creada, error } = await ctx.supabase.from('quotations').insert(fila).select().single()
    if (error) return { success: false, error: error.message }

    const { error: errAreas } = await ctx.supabase.from('quotation_areas').insert(
      areas.map((name, i) => soloCampos('quotation_areas', { quotation_id: creada.id, name, order_index: i },
        ['quotation_id', 'name', 'order_index'])),
    )

    return {
      success: true,
      affected_entity_type: 'quotation',
      affected_entity_id: creada.id,
      data: {
        dry_run: false,
        id: creada.id,
        folio: creada.folio || '(no se genero folio)',
        folio_previsto: previsto,
        folio_coincidio: previsto ? creada.folio === previsto : null,
        nombre: creada.name,
        especialidad: ESPECIALIDAD_LABEL[esp],
        etapa: 'Oportunidad',
        lead: lead.name, moneda, areas,
        partidas: 0,
        dueno: duenoId ? 'asignado' : 'Sin asignar',
        error_areas: errAreas ? errAreas.message : undefined,
        siguiente_paso: 'Avisale al especialista de ' + ESPECIALIDAD_LABEL[esp] + ' que ya tiene el cascaron y con que fecha lo necesitas cotizado.',
      },
    }
  },
}

// ═══ TOOL: cot_mover_etapa ═════════════════════════════════════════════════
const cotMoverEtapa: CotTool = {
  clase: 'operacion',
  definition: {
    name: 'cot_mover_etapa',
    description:
      'Mueve una cotizacion dentro del avance comercial: Oportunidad → Estimacion → Por cerrar (propuesta). ' +
      'Nada mas eso, y nada mas hacia adelante. Sirve para que el pipeline diga la verdad y para que el ' +
      'reloj del SLA arranque donde debe. ' +
      'NO puede marcar contrato: en el ERP eso genera las ordenes de compra y, en Proyectos, crea el ' +
      'proyecto en Obra. Tampoco puede marcar perdida. Esas dos las aprieta una persona, y si alguien te ' +
      'pide una de las dos, dile eso y pasale el folio. ' +
      'Tampoco toca cotizaciones que ya estan en contrato o perdida.',
    input_schema: {
      type: 'object',
      properties: {
        quotation_id: { type: 'string' },
        etapa: { type: 'string', enum: [...AVANCE], description: 'propuesta es "Por cerrar" en la pantalla' },
        motivo: { type: 'string', description: 'Por que se mueve. Queda en la auditoria.' },
        dry_run: { type: 'boolean' },
        idempotency_key: { type: 'string' },
      },
      required: ['quotation_id', 'etapa'],
    },
  },
  handler: async (input, ctx) => {
    const id = s(input.quotation_id)
    const destino = s(input.etapa)
    if (!id) return { success: false, error: 'Falta quotation_id.' }

    if (ETAPAS_CERRADAS.has(destino)) {
      return { success: false, error: `${ETAPA_LABEL[destino]} no lo pone un bot. ${POR_QUE_NO[destino]} Pasale el folio a quien la trabaja.` }
    }
    if (!ETAPAS_PERMITIDAS.has(destino)) {
      return { success: false, error: `Etapa invalida: "${input.etapa}". Este bot solo mueve entre ${AVANCE.join(', ')}.` }
    }

    const { data: cot } = await ctx.supabase.from('quotations')
      .select('id, folio, name, specialty, stage, vigente, total, total_final, notes, assignee_id, created_at, stage_changed_at')
      .eq('id', id).maybeSingle()
    if (!cot) return { success: false, error: `No existe la cotizacion ${id}.` }

    if (ETAPAS_CERRADAS.has(cot.stage)) {
      return {
        success: false,
        error: `Esa cotizacion ya esta en ${ETAPA_LABEL[cot.stage]} y de ahi no la regresa un bot. ` +
          'Si se marco por error, lo corrige una persona en la pantalla de Cotizaciones.',
      }
    }
    if (cot.vigente === false) {
      return { success: false, error: 'Esa es una version que ya se dejo atras (no vigente). Mueve la vigente.' }
    }
    if (cot.stage === destino) {
      return { success: false, error: `Ya esta en ${ETAPA_LABEL[destino]}; no hay nada que mover.` }
    }

    const iDe = AVANCE.indexOf(cot.stage as any)
    const iA = AVANCE.indexOf(destino as any)
    if (iDe >= 0 && iA < iDe) {
      return {
        success: false,
        error: `Eso seria regresarla de ${ETAPA_LABEL[cot.stage]} a ${ETAPA_LABEL[destino]}. ` +
          'Este bot solo avanza: echar para atras es deshacer el criterio de alguien, y eso se hace a mano.',
      }
    }

    // Una propuesta sin partidas es una cotizacion que no existe: mandarla a
    // "Por cerrar" seria reportar como vendible un cascaron vacio.
    const { count: partidas } = await ctx.supabase.from('quotation_items')
      .select('id', { count: 'exact', head: true }).eq('quotation_id', id)
    if (destino === 'propuesta' && !partidas) {
      return {
        success: false,
        error: 'Esa cotizacion no tiene ni una partida, asi que no hay nada que el cliente pueda cerrar. ' +
          'Primero la cotiza el especialista; el pipeline no debe decir "Por cerrar" de un cascaron vacio.',
      }
    }

    const ahora = new Date().toISOString()
    const fila = soloCampos('quotations', { stage: destino, stage_changed_at: ahora }, CAMPOS_QUOTATION)

    if (esDryRun(input)) {
      return {
        success: true,
        data: {
          dry_run: true,
          cotizacion: cot.folio || cot.name,
          de: ETAPA_LABEL[cot.stage], a: ETAPA_LABEL[destino],
          partidas: partidas || 0,
          importe: importeDe(cot), moneda: monedaDe(cot.notes),
          se_escribiria: fila,
          efecto: 'Reinicia el reloj del SLA: a partir de hoy los dias se cuentan en ' + ETAPA_LABEL[destino] + '.',
        },
      }
    }

    const { error } = await ctx.supabase.from('quotations').update(fila).eq('id', id)
    if (error) return { success: false, error: error.message }

    const { data: slas } = await ctx.supabase.from('sla_config')
      .select('max_days').eq('entity_type', 'quotation').eq('stage', destino)
    const limite = (slas || [])[0]?.max_days ?? null

    return {
      success: true,
      affected_entity_type: 'quotation',
      affected_entity_id: id,
      data: {
        dry_run: false,
        cotizacion: cot.folio || cot.name,
        de: ETAPA_LABEL[cot.stage], a: ETAPA_LABEL[destino],
        motivo: s(input.motivo) || null,
        movida_por: ctx.actor.nombre,
        reloj_reiniciado: ahora,
        limite_dias_de_la_nueva_etapa: limite,
        nota: limite ? `Si en ${limite} dias sigue ahi, va a salir en cot_estancadas.` : undefined,
      },
    }
  },
}

// ═══ TOOL: cot_asignar_dueno ═══════════════════════════════════════════════
const cotAsignarDueno: CotTool = {
  clase: 'operacion',
  definition: {
    name: 'cot_asignar_dueno',
    description:
      'Le pone responsable a una cotizacion. Es el "quien" que hoy no existe: sin dueño nadie la mueve y ' +
      'no hay a quien preguntarle en que va. No mueve dinero, no cambia la etapa y se corrige escribiendo ' +
      'encima, asi que es de lo mas barato de deshacer que hay. ' +
      'El dueño tiene que ser alguien activo del padron. Cuando no sepas a quien le toca, no adivines: ' +
      'preguntalo, porque asignarle a la persona equivocada es peor que dejarlo sin asignar.',
    input_schema: {
      type: 'object',
      properties: {
        quotation_id: { type: 'string' },
        employee_id: { type: 'string', description: 'Quien queda responsable. Vacio o null lo deja sin asignar.' },
        motivo: { type: 'string', description: 'Queda en la auditoria' },
        dry_run: { type: 'boolean' },
        idempotency_key: { type: 'string' },
      },
      required: ['quotation_id'],
    },
  },
  handler: async (input, ctx) => {
    const id = s(input.quotation_id)
    if (!id) return { success: false, error: 'Falta quotation_id.' }

    const { data: cot } = await ctx.supabase.from('quotations')
      .select('id, folio, name, specialty, stage, vigente, assignee_id').eq('id', id).maybeSingle()
    if (!cot) return { success: false, error: `No existe la cotizacion ${id}.` }

    const empId = s(input.employee_id)
    let nuevo: string | null = null
    let nombreNuevo = 'Sin asignar'
    if (empId) {
      const { data: e } = await ctx.supabase.from('employees')
        .select('id, name, nombre, is_active, puesto, area').eq('id', empId).maybeSingle()
      if (!e) return { success: false, error: `No existe el empleado ${empId}. Buscalo en el padron antes de asignar.` }
      if (e.is_active === false) return { success: false, error: `${e.nombre || e.name} ya no esta activo.` }
      nuevo = e.id
      nombreNuevo = (e.nombre || e.name || '').trim()
    }

    if (cot.assignee_id === nuevo) {
      return { success: false, error: `Ya estaba asi (${nombreNuevo}); no hay nada que cambiar.` }
    }

    const emp = await padron(ctx.supabase)
    const antes = cot.assignee_id ? (emp[cot.assignee_id] || '(inactivo)') : 'Sin asignar'
    const fila = soloCampos('quotations', { assignee_id: nuevo }, CAMPOS_QUOTATION)

    if (esDryRun(input)) {
      return {
        success: true,
        data: {
          dry_run: true,
          cotizacion: cot.folio || cot.name,
          etapa: ETAPA_LABEL[cot.stage] || cot.stage,
          de: antes, a: nombreNuevo,
          se_escribiria: fila,
        },
      }
    }

    const { error } = await ctx.supabase.from('quotations').update(fila).eq('id', id)
    if (error) return { success: false, error: error.message }

    return {
      success: true,
      affected_entity_type: 'quotation',
      affected_entity_id: id,
      data: {
        dry_run: false,
        cotizacion: cot.folio || cot.name,
        especialidad: ESPECIALIDAD_LABEL[cot.specialty] || cot.specialty,
        etapa: ETAPA_LABEL[cot.stage] || cot.stage,
        dueno_antes: antes, dueno_ahora: nombreNuevo,
        motivo: s(input.motivo) || null,
        asignado_por: ctx.actor.nombre,
        nota: nuevo
          ? 'Ya aparece en su carga en el tablero de Ventas. Si le pusiste fecha, ponla en la tarea del CRM: aqui no hay campo de fecha.'
          : 'Quedo sin dueño, y sin dueño nadie la va a mover.',
      },
    }
  },
}

// ═══ Registro ══════════════════════════════════════════════════════════════
export const COT_TOOLS: Record<string, CotTool> = {
  cot_buscar: cotBuscar,
  cot_detalle: cotDetalle,
  cot_pipeline: cotPipeline,
  cot_estancadas: cotEstancadas,
  cot_crear_borrador: cotCrearBorrador,
  cot_mover_etapa: cotMoverEtapa,
  cot_asignar_dueno: cotAsignarDueno,
}

export function cotToolDefinitions() {
  return Object.values(COT_TOOLS).map(t => t.definition)
}

export const claseDeTool = (name: string): ClaseDeTool | null => COT_TOOLS[name]?.clase ?? null

export async function executeCotTool(name: string, input: unknown, ctx: CotCtx): Promise<CotToolResult> {
  const tool = COT_TOOLS[name]
  if (!tool) return { success: false, error: 'Tool desconocida: ' + name }
  try {
    return await tool.handler(input ?? {}, ctx)
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
