// ═══════════════════════════════════════════════════════════════════════════
//  OMM Contabilidad — tools de negocio para el MCP (mcp-contabilidad).
//
//  Es el modulo de mas volumen del ERP (4,064 facturas, 3,808 movimientos de
//  banco) y el de mas cuidado: aqui un error no se queda adentro, se ve en el
//  SAT. Por eso esta version es casi toda de CONSULTA. La unica escritura es
//  el seguimiento de cobranza, que son notas y fechas: se corrige escribiendo
//  encima y no altera un solo peso.
//
//  Lo que este MCP NO hace, a proposito y no por falta de tiempo:
//   - emitir, timbrar o cancelar facturas. Timbrar es irreversible.
//   - registrar pagos o aplicar cobros.
//   - conciliar movimientos contra facturas. Esa escritura toca tres tablas a
//     la vez y hay que espejar el flujo exacto del ERP antes de automatizarla;
//     mientras tanto la tool sugiere y el humano aplica.
//
//  Los montos salen SIEMPRE en su moneda nativa, con el tipo de cambio dicho
//  aparte. Un total en pesos que no dice a que TC se convirtio es un numero
//  que nadie puede cotejar.
// ═══════════════════════════════════════════════════════════════════════════

export interface ContaActor {
  app_user_id: string
  nombre: string
  email: string
  employee_id: string | null
  permission_area: string
  nivel: string
}

export interface ContaCtx { supabase: any; actor: ContaActor }

export interface ContaToolResult {
  success: boolean
  data?: unknown
  error?: string
  affected_entity_type?: string
  affected_entity_id?: string
}

export type ClaseDeTool = 'consulta' | 'operacion' | 'escalacion'

export interface ContaTool {
  clase: ClaseDeTool
  definition: { name: string; description: string; input_schema: Record<string, unknown> }
  handler: (input: any, ctx: ContaCtx) => Promise<ContaToolResult>
}

/**
 * Lo que alcanza Contabilidad. Lee mucho porque su trabajo es contestar
 * preguntas; escribe casi nada porque aqui equivocarse cuesta caro.
 *
 * Las vistas v_cobranza_* son la MISMA definicion de vendido y cobrado que usa
 * la pantalla de Cobranza. Se leen en vez de recalcular para que el bot y el
 * ERP no puedan dar numeros distintos de lo mismo.
 */
export const ALCANCE_CONTA = {
  modulo: 'mcp-contabilidad',
  lectura: [
    'facturas', 'factura_conceptos', 'factura_pagos',
    'bank_movements', 'cash_movements', 'conciliacion_links', 'payment_allocations',
    'cobranza_tracking', 'cobranza_obra',
    'quotations', 'leads', 'app_users', 'employees',
    'v_cobranza_lead', 'v_cobranza_cotizacion',
  ],
  escritura: ['cobranza_tracking', 'cobranza_obra', 'notifications'],
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const esDryRun = (input: any): boolean => input?.dry_run === true
const num = (v: unknown): number => Number(v) || 0
const likeSafe = (q: string): string => q.replace(/[%,()]/g, ' ').trim()

/** El TC por defecto del ERP para 2026 (src/lib/fx.ts). Siempre se reporta. */
const TC_DEFAULT = 18

/**
 * El TC no se puede leer con `num(x) || DEFAULT`: un cero es falso en JS y se
 * caeria al default en silencio, que es justo lo contrario de rechazarlo.
 * Sin dato = default; con dato = se valida.
 */
function tcDe(v: unknown): { tc: number; error?: string } {
  if (v === undefined || v === null || v === '') return { tc: TC_DEFAULT }
  const n = Number(v)
  if (!isFinite(n) || n <= 0) return { tc: 0, error: 'El tipo de cambio tiene que ser un numero mayor que cero; llego "' + String(v) + '".' }
  return { tc: n }
}

const dinero = (n: number, m = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: m, maximumFractionDigits: 0 }).format(n)

// ═══ TOOL: conta_cobranza ══════════════════════════════════════════════════
const contaCobranza: ContaTool = {
  clase: 'consulta',
  definition: {
    name: 'conta_cobranza',
    description:
      'Cuanto nos deben y quien. Devuelve por obra lo vendido y lo cobrado de los contratos VIGENTES, ' +
      'en moneda nativa, mas el saldo convertido con el tipo de cambio que se indique. ' +
      'Usa la misma definicion que la pantalla de Cobranza del ERP, asi que los numeros cuadran con lo que ' +
      've Elias. Los contratos no vigentes y las cotizaciones que no son contrato no cuentan. No escribe nada.',
    input_schema: {
      type: 'object',
      properties: {
        solo_con_saldo: { type: 'boolean', default: true, description: 'Deja fuera las obras ya finiquitadas' },
        tipo_cambio: { type: 'number', default: TC_DEFAULT, description: 'Para convertir los dolares. Por defecto 18, que es el del ERP para 2026. Se reporta siempre cual se uso.' },
        limit: { type: 'integer', default: 15, description: 'Cuantas obras devolver, de mayor a menor saldo' },
      },
    },
  },
  handler: async (input, ctx) => {
    const { tc, error: errTc } = tcDe(input.tipo_cambio)
    if (errTc) return { success: false, error: errTc }
    const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 60)

    const { data, error } = await ctx.supabase.from('v_cobranza_lead')
      .select('lead_id, lead, clave, contratos, vendido_mxn, cobrado_mxn, vendido_usd, cobrado_usd')
    if (error) return { success: false, error: error.message }

    const filas = (data || []).map((r: any) => {
      const saldoMXN = Math.max(0, num(r.vendido_mxn) - num(r.cobrado_mxn))
      const saldoUSD = Math.max(0, num(r.vendido_usd) - num(r.cobrado_usd))
      const vendidoEq = num(r.vendido_mxn) + num(r.vendido_usd) * tc
      const cobradoEq = num(r.cobrado_mxn) + num(r.cobrado_usd) * tc
      return {
        lead_id: r.lead_id, obra: r.lead, clave: r.clave, contratos: r.contratos,
        saldo_mxn: Math.round(saldoMXN), saldo_usd: Math.round(saldoUSD),
        saldo_equivalente_mxn: Math.round(saldoMXN + saldoUSD * tc),
        avance_cobro_pct: vendidoEq > 0 ? Math.round((cobradoEq / vendidoEq) * 100) : 0,
      }
    })

    const conSaldo = input.solo_con_saldo === false ? filas : filas.filter((f: any) => f.saldo_equivalente_mxn > 1)
    conSaldo.sort((a: any, b: any) => b.saldo_equivalente_mxn - a.saldo_equivalente_mxn)
    const total = conSaldo.reduce((a: number, f: any) => a + f.saldo_equivalente_mxn, 0)

    return {
      success: true,
      data: {
        tipo_cambio_usado: tc,
        obras_con_saldo: conSaldo.length,
        por_cobrar_total: dinero(total),
        por_cobrar_total_numero: total,
        obras: conSaldo.slice(0, limit),
        nota: conSaldo.length > limit ? `Se muestran las ${limit} de mayor saldo de ${conSaldo.length}.` : undefined,
      },
    }
  },
}

// ═══ TOOL: conta_cobranza_obra ═════════════════════════════════════════════
const contaCobranzaObra: ContaTool = {
  clase: 'consulta',
  definition: {
    name: 'conta_cobranza_obra',
    description:
      'El desglose de una obra: cada contrato vigente con su vendido, su cobrado y su saldo, mas la nota y la ' +
      'fecha de cobro pronosticada si alguien las capturo. Usala cuando pregunten por UNA obra en concreto; ' +
      'para el panorama completo usa conta_cobranza. No escribe nada.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'uuid de la obra' },
        obra: { type: 'string', description: 'Alternativa al id: nombre o clave de la obra (PILO, MAT...)' },
        tipo_cambio: { type: 'number', default: TC_DEFAULT },
      },
    },
  },
  handler: async (input, ctx) => {
    const { tc, error: errTc } = tcDe(input.tipo_cambio)
    if (errTc) return { success: false, error: errTc }
    let leadId = s(input.lead_id)

    if (!leadId) {
      const q = likeSafe(s(input.obra))
      if (!q) return { success: false, error: 'Dame el lead_id o el nombre de la obra.' }
      const { data: ls } = await ctx.supabase.from('leads')
        .select('id, name, codigo').or(`name.ilike.%${q}%,codigo.ilike.%${q}%`).limit(3)
      if (!ls || ls.length === 0) return { success: false, error: `No encontre ninguna obra que se parezca a "${q}".` }
      if (ls.length > 1) {
        return { success: false, error: `"${q}" se parece a varias: ${ls.map((l: any) => `${l.name} (${l.codigo})`).join(', ')}. Se mas especifico o manda el lead_id.` }
      }
      leadId = ls[0].id
    }

    const [{ data: lead }, { data: cots }] = await Promise.all([
      ctx.supabase.from('leads').select('id, name, codigo, company').eq('id', leadId).maybeSingle(),
      ctx.supabase.from('v_cobranza_cotizacion')
        .select('quotation_id, name, specialty, moneda, vendido, cobrado').eq('lead_id', leadId),
    ])
    if (!lead) return { success: false, error: `No existe la obra ${leadId}.` }

    const ids = (cots || []).map((c: any) => c.quotation_id)
    const { data: track } = ids.length
      ? await ctx.supabase.from('cobranza_tracking')
          .select('quotation_id, fase, fecha_pago_pronosticada, monto_esperado_mes, notas').in('quotation_id', ids)
      : { data: [] }
    const tm = new Map((track || []).map((t: any) => [t.quotation_id, t]))

    const contratos = (cots || []).map((c: any) => {
      const t = tm.get(c.quotation_id)
      return {
        quotation_id: c.quotation_id, contrato: c.name, especialidad: c.specialty, moneda: c.moneda,
        vendido: num(c.vendido), cobrado: num(c.cobrado),
        saldo: Math.max(0, num(c.vendido) - num(c.cobrado)),
        fase: t?.fase ?? null,
        cobro_pronosticado: t?.fecha_pago_pronosticada ?? null,
        nota: t?.notas ?? null,
      }
    })
    const eq = (v: number, m: string) => (m === 'USD' ? v * tc : v)
    const saldoEq = contratos.reduce((a, c) => a + eq(c.saldo, c.moneda), 0)

    return {
      success: true,
      data: {
        obra: lead.name, clave: lead.codigo, despacho: lead.company,
        tipo_cambio_usado: tc,
        saldo_equivalente_mxn: Math.round(saldoEq),
        saldo_legible: dinero(saldoEq),
        contratos,
      },
    }
  },
}

// ═══ TOOL: conta_buscar_facturas ═══════════════════════════════════════════
const contaBuscarFacturas: ContaTool = {
  clase: 'consulta',
  definition: {
    name: 'conta_buscar_facturas',
    description:
      'Busca facturas por cliente, proveedor, folio o UUID. direccion=emitida son las que OMM cobra y ' +
      'recibida las que OMM paga. Sirve para "ya facturamos esto", "que nos facturo este proveedor" o ' +
      'para encontrar un UUID. No escribe nada.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Nombre del cliente o proveedor, folio, serie o UUID' },
        direccion: { type: 'string', enum: ['emitida', 'recibida'], description: 'Emitida = la cobramos. Recibida = la pagamos.' },
        desde: { type: 'string', description: 'Fecha de emision desde, yyyy-mm-dd' },
        hasta: { type: 'string', description: 'Fecha de emision hasta, yyyy-mm-dd' },
        limit: { type: 'integer', default: 15 },
      },
    },
  },
  handler: async (input, ctx) => {
    const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 50)
    let q = ctx.supabase.from('facturas')
      .select('id, direccion, serie, folio, uuid_fiscal, fecha_emision, emisor_nombre, receptor_nombre, total, moneda, tipo_comprobante, estado, metodo_pago')
      .order('fecha_emision', { ascending: false }).limit(limit)

    if (input.direccion) q = q.eq('direccion', s(input.direccion))
    if (s(input.desde)) q = q.gte('fecha_emision', s(input.desde))
    if (s(input.hasta)) q = q.lte('fecha_emision', s(input.hasta))

    const texto = likeSafe(s(input.query))
    if (texto) {
      q = q.or(`emisor_nombre.ilike.%${texto}%,receptor_nombre.ilike.%${texto}%,folio.ilike.%${texto}%,uuid_fiscal.ilike.%${texto}%`)
    }

    const { data, error } = await q
    if (error) return { success: false, error: error.message }

    return {
      success: true,
      data: {
        total: (data || []).length,
        facturas: (data || []).map((f: any) => ({
          id: f.id, direccion: f.direccion,
          folio: [f.serie, f.folio].filter(Boolean).join('-') || null,
          uuid: f.uuid_fiscal, fecha: f.fecha_emision,
          contraparte: f.direccion === 'emitida' ? f.receptor_nombre : f.emisor_nombre,
          total: num(f.total), moneda: f.moneda || 'MXN',
          tipo: f.tipo_comprobante, estado: f.estado, metodo_pago: f.metodo_pago,
        })),
      },
    }
  },
}

// ═══ TOOL: conta_movimientos_banco ═════════════════════════════════════════
const contaMovimientos: ContaTool = {
  clase: 'consulta',
  definition: {
    name: 'conta_movimientos_banco',
    description:
      'Movimientos bancarios: abonos (entra dinero) y cargos (sale). Con sin_conciliar=true salen los que ' +
      'todavia no estan amarrados a una factura, que es la pila de trabajo de conciliacion. No escribe nada.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto en el concepto o la referencia' },
        tipo: { type: 'string', enum: ['abono', 'cargo'] },
        sin_conciliar: { type: 'boolean', default: false },
        desde: { type: 'string', description: 'yyyy-mm-dd' },
        hasta: { type: 'string', description: 'yyyy-mm-dd' },
        limit: { type: 'integer', default: 15 },
      },
    },
  },
  handler: async (input, ctx) => {
    const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 50)
    let q = ctx.supabase.from('bank_movements')
      .select('id, fecha, concepto, referencia, monto, tipo, moneda, banco, conciliado, lead_id, quotation_id')
      .order('fecha', { ascending: false }).limit(limit)

    if (input.tipo) q = q.eq('tipo', s(input.tipo))
    if (input.sin_conciliar === true) q = q.or('conciliado.is.null,conciliado.eq.false')
    if (s(input.desde)) q = q.gte('fecha', s(input.desde))
    if (s(input.hasta)) q = q.lte('fecha', s(input.hasta))

    const texto = likeSafe(s(input.query))
    if (texto) q = q.or(`concepto.ilike.%${texto}%,referencia.ilike.%${texto}%`)

    const { data, error } = await q
    if (error) return { success: false, error: error.message }

    return {
      success: true,
      data: {
        total: (data || []).length,
        movimientos: (data || []).map((m: any) => ({
          id: m.id, fecha: m.fecha, tipo: m.tipo,
          monto: num(m.monto), moneda: m.moneda || 'MXN',
          concepto: (m.concepto || '').slice(0, 120),
          banco: m.banco, conciliado: !!m.conciliado,
          ya_ligado_a_obra: !!m.lead_id,
        })),
      },
    }
  },
}

// ═══ TOOL: conta_registrar_seguimiento ═════════════════════════════════════
const contaSeguimiento: ContaTool = {
  clase: 'operacion',
  definition: {
    name: 'conta_registrar_seguimiento_cobranza',
    description:
      'Deja anotado cuando se espera cobrar un contrato y por que. Es la UNICA escritura de este servidor y ' +
      'no mueve un solo peso: son la fecha pronosticada y una nota, que se corrigen escribiendo encima. ' +
      'Usala cuando el humano diga "este me lo pagan el 15" o "quedaron de depositar la semana que entra". ' +
      'No registra pagos ni concilia: eso lo hace una persona.',
    input_schema: {
      type: 'object',
      properties: {
        quotation_id: { type: 'string', description: 'uuid del contrato (de conta_cobranza_obra)' },
        fecha_pago_pronosticada: { type: 'string', description: 'Cuando esperamos el dinero, yyyy-mm-dd' },
        monto_esperado: { type: 'number', description: 'Cuanto se espera en ese pago' },
        nota: { type: 'string', description: 'Lo que dijo el cliente, en sus palabras' },
        idempotency_key: { type: 'string', description: 'Identificador que TU inventas para esta operacion. Si se reintenta con la misma clave, el servidor devuelve el resultado original.' },
        dry_run: { type: 'boolean', default: false },
      },
      required: ['quotation_id'],
    },
  },
  handler: async (input, ctx) => {
    const qid = s(input.quotation_id)
    if (!qid) return { success: false, error: 'Falta quotation_id. Sacalo de conta_cobranza_obra.' }
    if (!s(input.fecha_pago_pronosticada) && !s(input.nota) && input.monto_esperado == null) {
      return { success: false, error: 'No hay nada que anotar: manda al menos la fecha pronosticada, el monto o la nota.' }
    }

    const { data: cot } = await ctx.supabase.from('v_cobranza_cotizacion')
      .select('quotation_id, name, moneda, vendido, cobrado').eq('quotation_id', qid).maybeSingle()
    if (!cot) return { success: false, error: `${qid} no es un contrato vigente. El seguimiento de cobranza solo aplica a contratos vigentes.` }

    const fila: Record<string, unknown> = { quotation_id: qid, updated_at: new Date().toISOString() }
    if (s(input.fecha_pago_pronosticada)) fila.fecha_pago_pronosticada = s(input.fecha_pago_pronosticada)
    if (input.monto_esperado != null) fila.monto_esperado_mes = num(input.monto_esperado)
    if (s(input.nota)) fila.notas = s(input.nota) + ' — anotado por ' + ctx.actor.nombre

    if (esDryRun(input)) {
      return {
        success: true,
        data: {
          dry_run: true, contrato: cot.name,
          saldo_actual: Math.max(0, num(cot.vendido) - num(cot.cobrado)), moneda: cot.moneda,
          se_anotaria: fila,
        },
      }
    }

    const { data: previo } = await ctx.supabase.from('cobranza_tracking')
      .select('id').eq('quotation_id', qid).maybeSingle()

    const { error } = previo
      ? await ctx.supabase.from('cobranza_tracking').update(fila).eq('quotation_id', qid)
      : await ctx.supabase.from('cobranza_tracking').insert(fila)
    if (error) return { success: false, error: error.message }

    return {
      success: true,
      affected_entity_type: 'cobranza_tracking',
      affected_entity_id: qid,
      data: {
        contrato: cot.name, moneda: cot.moneda,
        saldo_actual: Math.max(0, num(cot.vendido) - num(cot.cobrado)),
        anotado: fila, dry_run: false,
      },
    }
  },
}

// ═══ Registro ══════════════════════════════════════════════════════════════
export const CONTA_TOOLS: Record<string, ContaTool> = {
  conta_cobranza: contaCobranza,
  conta_cobranza_obra: contaCobranzaObra,
  conta_buscar_facturas: contaBuscarFacturas,
  conta_movimientos_banco: contaMovimientos,
  conta_registrar_seguimiento_cobranza: contaSeguimiento,
}

export function contaToolDefinitions() {
  return Object.values(CONTA_TOOLS).map(t => t.definition)
}

export const claseDeTool = (name: string): ClaseDeTool | null => CONTA_TOOLS[name]?.clase ?? null

export async function executeContaTool(name: string, input: unknown, ctx: ContaCtx): Promise<ContaToolResult> {
  const tool = CONTA_TOOLS[name]
  if (!tool) return { success: false, error: 'Tool desconocida: ' + name }
  try {
    return await tool.handler(input ?? {}, ctx)
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
