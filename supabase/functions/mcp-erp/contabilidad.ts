// ═══════════════════════════════════════════════════════════════════════════
//  contabilidad.ts — Contabilidad en el MCP del ERP (oct-2026).
//
//  Para Dafne (Administración) desde su propio Claude, con SU login: lo que
//  RLS le deja en la pantalla es exactamente lo que le deja aquí. Sin llave
//  maestra.
//
//  Dos partes:
//   1. Las 6 tools de mcp-contabilidad (cobranza, facturas, banco, estado de
//      cuenta...) se REUSAN tal cual importando su archivo. Una definición, no
//      dos: si allá se corrige, aquí también.
//   2. Las escrituras de la pantalla Contabilidad.tsx, espejadas regla por
//      regla (clasificar, beneficiario, asignar, conciliar, prorratear,
//      efectivo). Cada una con vista previa: SIN confirmar=true no escribe.
//
//  Fuera, a propósito: timbrar o cancelar CFDI (irreversible ante el SAT) e
//  importar estados de cuenta (necesita el archivo). Eso sigue en el ERP.
//
//  Reglas que NO se negocian aquí (vienen de la pantalla y de CLAUDE.md):
//   · Monedas nunca se suman. Un cruce de moneda exige TC explícito: aquí NO
//     hay TC por defecto (la pantalla sugiere 18; un bot no debe adivinar).
//   · Clasificar a mano pone categoria_manual=true (el clasificador ya no la
//     pisa). Asignar a mano pone asignacion_auto=false (auditoría).
//   · Dinero sólo se amarra a CONTRATOS vivos (o a la cotización que ya tenía).
//   · Ingreso = CFDI tipo I − tipo E. N (nómina) y P (REP) NO son venta.
//   · Nómina: la serie es payroll_periods, nunca banco + efectivo.
//   · prestamo / pago_tdc / traspaso_interno no son gasto: es el mismo dinero.
//   · PostgREST corta en 1000 filas: todo lo que puede pasar se pagina.
// ═══════════════════════════════════════════════════════════════════════════
import { CONTA_TOOLS, executeContaTool } from '../mcp-contabilidad/conta_tools.ts'

type SB = any
export interface QuienConta {
  id: string
  nombre?: string | null
  email?: string | null
  empleadoId?: string | null
  area?: string | null
  nivel?: string | null
}

const texto = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] })
const esUuid = (s: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''))
const c2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100
const limpio = (t: unknown) => String(t ?? '').replace(/[,()%]/g, ' ').replace(/\s+/g, ' ').trim()
const cur = (m: unknown): 'MXN' | 'USD' => (String(m || 'MXN').toUpperCase() === 'USD' ? 'USD' : 'MXN')
const monedaCot = (q: any): 'MXN' | 'USD' => { try { return cur(JSON.parse(q?.notes || '{}').currency) } catch { return 'MXN' } }
const AREAS_CONTA = ['Administracion', 'DG']

export const NATURALEZAS = [
  'cobro_cliente', 'pago_proveedor', 'anticipo_proveedor',
  'nomina_directa', 'nomina_admin', 'gasto_general',
  'impuestos', 'comision_bancaria', 'traspaso_interno',
  'pago_tdc', 'prestamo', 'otro',
]
export const TIPOS_GASTO = [
  'material_electrico', 'luminarias', 'instalaciones_especiales',
  'cortinas_persianas', 'insumos_generales', 'herramienta', 'otro',
]
const tieneGasto = (nat: string) => nat === 'pago_proveedor' || nat === 'anticipo_proveedor'
const NO_ES_GASTO = new Set(['traspaso_interno', 'traspaso', 'pago_tdc', 'prestamo'])
const TIPOS_EFECTIVO = [
  'cobro_cliente', 'aportacion', 'pago_proveedor', 'nomina_efectivo', 'viaticos', 'gasolina',
  'gastos_generales', 'comida', 'papeleria', 'mantenimiento', 'envio_paqueteria', 'herramientas', 'otro_gasto',
]

/** PostgREST corta en 1000 sin avisar. */
async function todas(construir: (desde: number, hasta: number) => any): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await construir(i, i + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

const bnetDe = (concepto: string): string | null => {
  const a = (concepto || '').match(/\bBNET\s+(\d{8,12})\b/i)
  return a ? a[1] : null
}
const cuentaTerceroDe = (concepto: string): string | null => {
  const b = (concepto || '').match(/\b(\d{8,12})\s+BNET\b/i)
  return b ? b[1] : null
}

const facturaCancelada = (f: any) =>
  String(f?.status || '').toLowerCase() === 'cancelada' || String(f?.estado || '').toLowerCase() === 'cancelada'

async function facturaDe(sb: SB, ref: string): Promise<{ f?: any; error?: string; candidatos?: any[] }> {
  const r = String(ref || '').trim()
  if (!r) return { error: 'Falta la factura.' }
  const cols = 'id,direccion,uuid_fiscal,serie,folio,tipo_comprobante,fecha_emision,emisor_nombre,receptor_nombre,subtotal,iva,total,moneda,status,estado,sandbox,metodo_pago'
  if (esUuid(r)) {
    const { data: a } = await sb.from('facturas').select(cols).eq('id', r).maybeSingle()
    if (a) return { f: a }
    const { data: b } = await sb.from('facturas').select(cols).eq('uuid_fiscal', r.toLowerCase()).limit(2)
    if (b?.length === 1) return { f: b[0] }
    if (b?.length > 1) return { error: 'Ese UUID está duplicado en el ERP.', candidatos: b }
    return { error: 'No encontré esa factura.' }
  }
  const m = r.match(/^([A-Za-z]*)[-\s]?(\d+)$/)
  let q = sb.from('facturas').select(cols).or('sandbox.is.null,sandbox.eq.false').limit(10)
  q = m && m[1] ? q.eq('serie', m[1].toUpperCase()).eq('folio', m[2]) : q.eq('folio', m ? m[2] : r)
  const { data } = await q
  if (!data?.length) return { error: `No encontré la factura "${r}". Usa el id o el UUID fiscal.` }
  if (data.length > 1) return { error: 'Varias facturas tienen ese folio. Elige por id.', candidatos: data }
  return { f: data[0] }
}

async function movimientoDe(sb: SB, id: string) {
  if (!esUuid(id)) return { error: 'El id del movimiento no es válido.' }
  const { data } = await sb.from('bank_movements').select('*').eq('id', id).maybeSingle()
  return data ? { m: data } : { error: 'No encontré ese movimiento.' }
}

async function leadDe(sb: SB, ref: string) {
  const r = String(ref || '').trim()
  const q = sb.from('leads').select('id,codigo,name,company').limit(5)
  const { data } = esUuid(r) ? await q.eq('id', r) : await q.ilike('codigo', r)
  if (data?.length === 1) return { l: data[0] }
  if (!esUuid(r)) {
    const { data: porNombre } = await sb.from('leads').select('id,codigo,name,company').ilike('name', `%${limpio(r)}%`).limit(8)
    if (porNombre?.length === 1) return { l: porNombre[0] }
    if (porNombre?.length > 1) return { error: 'Varios leads empatan. Elige por clave o id.', candidatos: porNombre }
  }
  return { error: `No encontré el lead "${r}".` }
}

const COLS_COT = 'id,folio,name,stage,archived_at,vigente,version_group_id,total,total_final,notes'
const esContratoVivo = (c: any) =>
  !c.archived_at && String(c.stage || '') === 'contrato' && (!c.version_group_id || c.vigente === true)

async function cotizacionDe(sb: SB, ref: string) {
  const r = String(ref || '').trim()
  const q = sb.from('quotations').select(COLS_COT).limit(3)
  const { data } = esUuid(r) ? await q.eq('id', r) : await q.ilike('folio', r)
  if (data?.length === 1) return { q: data[0] }
  return { error: `No encontré la cotización "${r}". Usa el folio (ej. CONC-ES01) o el id.` }
}

const leadDeCot = (q: any): string | null => { try { return JSON.parse(q?.notes || '{}').lead_id || null } catch { return null } }

async function linksDeMov(sb: SB, movId: string) {
  const { data } = await sb.from('conciliacion_links').select('id,invoice_id,monto_aplicado,tc_aplicado,monto_en_moneda_factura,nota').eq('bank_movement_id', movId)
  return data || []
}
async function linksDeFactura(sb: SB, facturaId: string) {
  const { data } = await sb.from('conciliacion_links').select('id,bank_movement_id,monto_aplicado,tc_aplicado,monto_en_moneda_factura').eq('invoice_id', facturaId)
  return data || []
}
/** Lo aplicado a una factura, en SU moneda. Un vínculo cruzado guarda el equivalente aparte. */
const aplicadoEnFactura = (links: any[]) =>
  c2(links.reduce((s, l) => s + Number(l.monto_en_moneda_factura ?? l.monto_aplicado ?? 0), 0))
const aplicadoEnMov = (links: any[]) => c2(links.reduce((s, l) => s + Number(l.monto_aplicado || 0), 0))
const convertir = (monto: number, de: string, a: string, tc: number) =>
  de === a ? c2(monto) : de === 'MXN' && a === 'USD' ? c2(monto / tc) : c2(monto * tc)

// ═══ Definiciones ═══════════════════════════════════════════════════════════

const REUSADAS = Object.values(CONTA_TOOLS).map((t: any) => ({
  name: t.definition.name,
  annotations: t.clase === 'consulta' ? { readOnlyHint: true } : { readOnlyHint: false, destructiveHint: false },
  description: t.definition.description,
  inputSchema: t.definition.input_schema,
}))

const ids = { type: 'array', items: { type: 'string' }, description: 'ids de bank_movements (máximo 200).' }
const confirmar = { type: 'boolean', description: 'SIN esto sólo enseña lo que haría. Enséñaselo a la persona y repite con confirmar=true.' }

const NUEVAS = [
  {
    name: 'conta_pendientes',
    annotations: { readOnlyHint: true },
    description: 'La cola de trabajo de Contabilidad: movimientos de banco sin clasificar, cargos a proveedor sin beneficiario, cobros sin conciliar ni cotización, facturas emitidas sin cobro vinculado y efectivo sin comprobante. Con conteos y una muestra de cada uno. Empiece por aquí cuando pregunten "qué hay pendiente".',
    inputSchema: { type: 'object', properties: {
      desde: { type: 'string', description: 'AAAA-MM-DD. Por defecto el 1 de enero del año en curso.' },
      hasta: { type: 'string', description: 'AAAA-MM-DD. Por defecto hoy.' },
      muestra: { type: 'integer', description: 'Cuántos ejemplos por grupo. Por defecto 10.' },
    } },
  },
  {
    name: 'conta_ver_movimiento',
    annotations: { readOnlyHint: true },
    description: 'Un movimiento de banco completo: clasificación, beneficiario, lead/cotización/OC, facturas vinculadas, reparto entre cotizaciones, y SUGERENCIAS de facturas que podrían empatar (misma moneda, monto parecido, con saldo). Úselo antes de conciliar o clasificar.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'conta_clasificar_movimientos',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: 'Pone la naturaleza (categoria) a uno o varios movimientos y, si es pago o anticipo a proveedor, el tipo de gasto. Queda como clasificación MANUAL: el clasificador automático ya no la cambia. Naturalezas: ' + NATURALEZAS.join(', ') + '. Tipos de gasto: ' + TIPOS_GASTO.join(', ') + '.',
    inputSchema: { type: 'object', properties: {
      ids, categoria: { type: 'string', enum: NATURALEZAS },
      tipo_gasto: { type: 'string', enum: TIPOS_GASTO, description: 'Sólo para pago_proveedor o anticipo_proveedor.' },
      observaciones: { type: 'string', description: 'Comentario que se guarda en cada movimiento. Vacío para no tocarlo.' },
      confirmar,
    }, required: ['ids', 'categoria'] },
  },
  {
    name: 'conta_asignar_beneficiario',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: 'Liga uno o varios movimientos a la FICHA de un proveedor, cliente o empleado (no a un texto suelto: el texto sin ficha no suma en el estado de cuenta). Con aprender_cuenta=true, en cargos a proveedor guarda en su ficha el BNET o la cuenta del concepto para que los siguientes se detecten solos; una cuenta que ya conoce CUALQUIER proveedor no se toca.',
    inputSchema: { type: 'object', properties: {
      ids, tipo: { type: 'string', enum: ['proveedor', 'cliente', 'empleado', 'ninguno'], description: 'ninguno = quitar el beneficiario.' },
      beneficiario: { type: 'string', description: 'id de la ficha o parte del nombre. Si empata con varios se devuelven los candidatos.' },
      aprender_cuenta: { type: 'boolean' },
      confirmar,
    }, required: ['ids', 'tipo'] },
  },
  {
    name: 'conta_asignar_proyecto',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: 'Amarra movimientos a Lead → Cotización → OC, en cascada como la pantalla: cambiar el lead limpia cotización y OC; cambiar la cotización limpia la OC. Sólo acepta cotizaciones en CONTRATO vivo (no archivadas, versión vigente) o la que el movimiento ya tenía: amarrar dinero a una propuesta ensucia el estado de cuenta.',
    inputSchema: { type: 'object', properties: {
      ids, lead: { type: 'string', description: 'Clave de 4 letras, id o nombre. Vacío "" para quitar todo.' },
      cotizacion: { type: 'string', description: 'Folio o id. Opcional.' },
      orden: { type: 'string', description: 'Folio o id de la OC. Opcional.' },
      confirmar,
    }, required: ['ids', 'lead'] },
  },
  {
    name: 'conta_conciliar',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: 'Vincula un movimiento de banco con una factura (se permiten pagos parciales y varias facturas por movimiento). Sin monto, aplica lo que le falte a la factura o al movimiento, lo menor. Si las monedas difieren, el tipo de cambio es OBLIGATORIO (el TC BBVA venta del día del pago) y no se inventa. Marca el movimiento como conciliado cuando los vínculos cubren su monto.',
    inputSchema: { type: 'object', properties: {
      movimiento: { type: 'string', description: 'id del movimiento.' },
      factura: { type: 'string', description: 'id, UUID fiscal o serie-folio.' },
      monto: { type: 'number', description: 'En la moneda del MOVIMIENTO. Opcional.' },
      tc: { type: 'number', description: 'Sólo si las monedas difieren.' },
      nota: { type: 'string' },
      confirmar,
    }, required: ['movimiento', 'factura'] },
  },
  {
    name: 'conta_desconciliar',
    annotations: { readOnlyHint: false, destructiveHint: true },
    description: 'Quita el vínculo entre un movimiento y una factura. Sin factura, quita TODOS los vínculos del movimiento y lo deja como no conciliado. Recalcula el estado conciliado.',
    inputSchema: { type: 'object', properties: {
      movimiento: { type: 'string' }, factura: { type: 'string', description: 'Opcional.' }, confirmar,
    }, required: ['movimiento'] },
  },
  {
    name: 'conta_prorratear_cobro',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: 'Reparte un cobro (abono) entre una o varias cotizaciones. REEMPLAZA el reparto anterior de ese movimiento. Montos en la moneda del movimiento; si una cotización está en otra moneda, su tc es obligatorio. Avisa si el reparto no cuadra con el monto del movimiento. Lista vacía = quitar el reparto.',
    inputSchema: { type: 'object', properties: {
      movimiento: { type: 'string' },
      reparto: { type: 'array', items: { type: 'object', properties: {
        cotizacion: { type: 'string', description: 'Folio o id.' },
        monto: { type: 'number', description: 'En la moneda del movimiento.' },
        tc: { type: 'number' },
      }, required: ['cotizacion', 'monto'] } },
      confirmar,
    }, required: ['movimiento', 'reparto'] },
  },
  {
    name: 'conta_registrar_efectivo',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: 'Registra un movimiento de EFECTIVO (cobro a cliente, aportación, pago a proveedor, nómina en efectivo, viáticos, etc.). Ingreso para cobro_cliente y aportacion; egreso para lo demás. Si es cobro a una cotización en otra moneda, el tc es obligatorio. No acepta OC canceladas. Con orden de compra, la base refleja el pago en la OC.',
    inputSchema: { type: 'object', properties: {
      tipo: { type: 'string', enum: TIPOS_EFECTIVO },
      monto: { type: 'number' }, moneda: { type: 'string', enum: ['MXN', 'USD'] },
      fecha: { type: 'string', description: 'AAAA-MM-DD. Por defecto hoy.' },
      persona: { type: 'string', description: 'Quién entregó o recibió el dinero.' },
      concepto: { type: 'string' },
      lead: { type: 'string' }, cotizacion: { type: 'string' }, orden: { type: 'string' },
      tc: { type: 'number' },
      confirmar,
    }, required: ['tipo', 'monto', 'moneda', 'persona'] },
  },
  {
    name: 'conta_buscar_efectivo',
    annotations: { readOnlyHint: true },
    description: 'Movimientos de efectivo por fecha, tipo, persona o texto, con totales separados por moneda y por ingreso/egreso.',
    inputSchema: { type: 'object', properties: {
      desde: { type: 'string' }, hasta: { type: 'string' },
      tipo: { type: 'string', enum: TIPOS_EFECTIVO }, texto: { type: 'string' }, lead: { type: 'string' },
      limite: { type: 'integer' },
    } },
  },
  {
    name: 'conta_resumen_mes',
    annotations: { readOnlyHint: true },
    description: 'El mes en números correctos: facturación neta (I − E, sin nómina ni REP), cobranza (banco + efectivo, sin aportaciones), egresos del banco por naturaleza (separando lo que NO es gasto: traspasos, tarjeta, préstamo), nómina del módulo de nómina, e IVA trasladado y acreditable por lo facturado y por lo conciliado. Todo por moneda, sin convertir.',
    inputSchema: { type: 'object', properties: { mes: { type: 'string', description: 'AAAA-MM.' } }, required: ['mes'] },
  },
  {
    name: 'conta_nomina',
    annotations: { readOnlyHint: true },
    description: 'Periodos de nómina con sus totales (transferencia, efectivo, ISR, IMSS, caja chica) y si la transferencia ya se pagó. Es la serie correcta de nómina: no sumar la del banco con la del efectivo.',
    inputSchema: { type: 'object', properties: { anio: { type: 'integer' }, mes: { type: 'integer' } } },
  },
]

export const DEFINICIONES_CONTA = [...REUSADAS, ...NUEVAS]

// ═══ Ejecución ═════════════════════════════════════════════════════════════

export async function ejecutarConta(nombre: string, args: any, sb: SB, quien: QuienConta) {
  if (!AREAS_CONTA.includes(String(quien.area || ''))) {
    return texto({ error: 'Las herramientas de Contabilidad son del área de Administración y de Dirección General. Tu cuenta es de ' + (quien.area || 'otra área') + '.' })
  }

  // ── Las reusadas de mcp-contabilidad, con el login de la persona ─────────
  if ((CONTA_TOOLS as any)[nombre]) {
    sb.sinAcotar = sb
    const actor = {
      app_user_id: quien.id, nombre: quien.nombre || '', email: quien.email || '',
      employee_id: quien.empleadoId || null, permission_area: quien.area || '', nivel: quien.nivel || '',
    }
    const r = await executeContaTool(nombre, args, { supabase: sb, actor })
    return texto(r.success ? r.data : { error: r.error })
  }

  const hoy = new Date().toISOString().slice(0, 10)
  const lista = (v: any): string[] => (Array.isArray(v) ? v.map(String).filter(esUuid) : [])

  switch (nombre) {
    // ─────────────────────────────────────────────────────────────────────
    case 'conta_pendientes': {
      const desde = args?.desde || `${hoy.slice(0, 4)}-01-01`
      const hasta = args?.hasta || hoy
      const n = Math.min(Math.max(Number(args?.muestra) || 10, 1), 50)
      const movs = await todas((a, b) => sb.from('bank_movements')
        .select('id,fecha,tipo,monto,moneda,concepto,categoria,categoria_manual,beneficiario_id,beneficiario,conciliado,quotation_id,lead_id,cuenta')
        .gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false }).range(a, b))
      const links = await todas((a, b) => sb.from('conciliacion_links').select('bank_movement_id,invoice_id').range(a, b))
      const allocs = await todas((a, b) => sb.from('payment_allocations').select('bank_movement_id').range(a, b))
      const conLink = new Set(links.map(l => l.bank_movement_id))
      const conAlloc = new Set(allocs.map(l => l.bank_movement_id))
      const fila = (m: any) => ({ id: m.id, fecha: m.fecha, tipo: m.tipo, monto: Number(m.monto), moneda: cur(m.moneda), concepto: m.concepto, categoria: m.categoria, beneficiario: m.beneficiario || null })
      const sinClasificar = movs.filter(m => !m.categoria || m.categoria === 'otro')
      const sinBenef = movs.filter(m => m.tipo === 'cargo' && ['pago_proveedor', 'anticipo_proveedor', 'proveedor', 'proveedor_obra'].includes(m.categoria) && !m.beneficiario_id)
      const cobrosSueltos = movs.filter(m => m.tipo === 'abono' && m.categoria === 'cobro_cliente' && !conLink.has(m.id) && !m.conciliado)
      const cobrosSinCot = movs.filter(m => m.tipo === 'abono' && m.categoria === 'cobro_cliente' && !m.quotation_id && !conAlloc.has(m.id))
      const facts = await todas((a, b) => sb.from('facturas')
        .select('id,serie,folio,fecha_emision,receptor_nombre,total,moneda,metodo_pago,status,estado,sandbox,tipo_comprobante,direccion')
        .eq('direccion', 'emitida').eq('tipo_comprobante', 'I').gte('fecha_emision', desde).lte('fecha_emision', hasta + 'T23:59:59').range(a, b))
      const conLinkF = new Set(links.map(l => l.invoice_id))
      const factSinCobro = facts.filter(f => !f.sandbox && !facturaCancelada(f) && String(f.status || f.estado) !== 'borrador' && !conLinkF.has(f.id))
      const efec = await todas((a, b) => sb.from('cash_movements').select('id,fecha,tipo,monto,moneda,persona,concepto,comprobante_path')
        .eq('direccion', 'egreso').is('comprobante_path', null).gte('fecha', desde).lte('fecha', hasta).range(a, b))
      const suma = (arr: any[]) => {
        const o: any = {}
        for (const m of arr) { const k = cur(m.moneda); o[k] = c2((o[k] || 0) + Number(m.monto ?? m.total ?? 0)) }
        return o
      }
      return texto({
        periodo: { desde, hasta },
        movimientos_sin_clasificar: { cuantos: sinClasificar.length, montos: suma(sinClasificar), muestra: sinClasificar.slice(0, n).map(fila),
          por_que_importa: 'En septiembre, 106 transferencias en "otro" sumaban 3.39 M. Si son proveedores, la contribución por área del año cambia de signo.' },
        cargos_a_proveedor_sin_beneficiario: { cuantos: sinBenef.length, montos: suma(sinBenef), muestra: sinBenef.slice(0, n).map(fila),
          por_que_importa: 'Sin la ficha del proveedor no hay estado de cuenta de proveedor.' },
        cobros_sin_conciliar_con_factura: { cuantos: cobrosSueltos.length, montos: suma(cobrosSueltos), muestra: cobrosSueltos.slice(0, n).map(fila) },
        cobros_sin_cotizacion: { cuantos: cobrosSinCot.length, montos: suma(cobrosSinCot), muestra: cobrosSinCot.slice(0, n).map(fila),
          por_que_importa: 'Un cobro sin cotización no aparece en la cobranza del cliente.' },
        facturas_emitidas_sin_cobro_vinculado: { cuantas: factSinCobro.length, montos: suma(factSinCobro),
          muestra: factSinCobro.slice(0, n).map(f => ({ id: f.id, folio: `${f.serie || ''}${f.folio || ''}`, fecha: String(f.fecha_emision).slice(0, 10), cliente: f.receptor_nombre, total: Number(f.total), moneda: cur(f.moneda), metodo: f.metodo_pago })) },
        efectivo_sin_comprobante: { cuantos: efec.length, montos: suma(efec), muestra: efec.slice(0, n) },
        siguiente: 'Para cada uno: conta_ver_movimiento, y luego clasificar, asignar beneficiario, conciliar o prorratear.',
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    case 'conta_ver_movimiento': {
      const { m, error } = await movimientoDe(sb, String(args?.id || ''))
      if (!m) return texto({ error })
      const links = await linksDeMov(sb, m.id)
      const facIds = links.map((l: any) => l.invoice_id)
      const { data: facs } = facIds.length ? await sb.from('facturas').select('id,serie,folio,receptor_nombre,emisor_nombre,total,moneda,tipo_comprobante').in('id', facIds) : { data: [] }
      const { data: allocs } = await sb.from('payment_allocations').select('quotation_id,monto,monto_origen,moneda_origen,tc_aplicado').eq('bank_movement_id', m.id)
      const cotIds = [...new Set([m.quotation_id, ...(allocs || []).map((a: any) => a.quotation_id)].filter(Boolean))]
      const { data: cots } = cotIds.length ? await sb.from('quotations').select('id,folio,name,stage').in('id', cotIds) : { data: [] }
      const { data: lead } = m.lead_id ? await sb.from('leads').select('id,codigo,name').eq('id', m.lead_id).maybeSingle() : { data: null }
      const { data: oc } = m.purchase_order_id ? await sb.from('purchase_orders').select('id,folio,po_number,status,total,currency').eq('id', m.purchase_order_id).maybeSingle() : { data: null }
      const restaMov = c2(Number(m.monto) - aplicadoEnMov(links))

      // Sugerencias: misma moneda, ±2% del saldo del movimiento, con saldo, dirección que corresponde.
      let sugerencias: any[] = []
      if (restaMov > 0.01) {
        const dir = m.tipo === 'abono' ? 'emitida' : 'recibida'
        const { data: cands } = await sb.from('facturas')
          .select('id,serie,folio,fecha_emision,receptor_nombre,emisor_nombre,total,moneda,status,estado,sandbox,tipo_comprobante')
          .eq('direccion', dir).in('tipo_comprobante', ['I', 'E']).eq('moneda', cur(m.moneda))
          .gte('total', c2(restaMov * 0.98)).lte('total', c2(restaMov * 1.02)).limit(15)
        for (const f of cands || []) {
          if (f.sandbox || facturaCancelada(f)) continue
          const ya = aplicadoEnFactura(await linksDeFactura(sb, f.id))
          if (Number(f.total) - ya > 0.01) sugerencias.push({ id: f.id, folio: `${f.serie || ''}${f.folio || ''}`, fecha: String(f.fecha_emision).slice(0, 10), contraparte: dir === 'emitida' ? f.receptor_nombre : f.emisor_nombre, total: Number(f.total), por_aplicar: c2(Number(f.total) - ya), moneda: cur(f.moneda) })
        }
        sugerencias = sugerencias.slice(0, 8)
      }
      return texto({
        movimiento: { id: m.id, fecha: m.fecha, cuenta: m.cuenta, banco: m.banco, tipo: m.tipo, monto: Number(m.monto), moneda: cur(m.moneda), concepto: m.concepto,
          categoria: m.categoria, categoria_manual: !!m.categoria_manual, tipo_gasto: m.tipo_gasto, observaciones: m.observaciones,
          beneficiario: m.beneficiario, beneficiario_tipo: m.beneficiario_tipo, beneficiario_id: m.beneficiario_id,
          bnet_del_concepto: bnetDe(m.concepto), cuenta_tercero_del_concepto: cuentaTerceroDe(m.concepto),
          conciliado: !!m.conciliado, asignacion_auto: !!m.asignacion_auto, folio_detectado: m.folio_detectado },
        proyecto: { lead, cotizacion: (cots || []).find((c: any) => c.id === m.quotation_id) || null, orden_de_compra: oc },
        facturas_vinculadas: links.map((l: any) => ({ ...l, factura: (facs || []).find((f: any) => f.id === l.invoice_id) || null })),
        falta_por_vincular: restaMov,
        reparto_entre_cotizaciones: (allocs || []).map((a: any) => ({ ...a, cotizacion: (cots || []).find((c: any) => c.id === a.quotation_id) || null })),
        facturas_que_podrian_empatar: sugerencias,
        ojo: sugerencias.length ? 'Son sugerencias por monto y moneda, no un empate seguro: confirme cliente y fecha antes de conciliar.' : undefined,
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    case 'conta_clasificar_movimientos': {
      const idsOk = lista(args?.ids).slice(0, 200)
      if (!idsOk.length) return texto({ error: 'Faltan los ids de los movimientos.' })
      const cat = String(args?.categoria || '')
      if (!NATURALEZAS.includes(cat)) return texto({ error: 'categoria debe ser una de: ' + NATURALEZAS.join(', ') })
      const tg = args?.tipo_gasto ? String(args.tipo_gasto) : null
      if (tg && !tieneGasto(cat)) return texto({ error: 'El tipo de gasto sólo aplica a pago_proveedor o anticipo_proveedor.' })
      if (tg && !TIPOS_GASTO.includes(tg)) return texto({ error: 'tipo_gasto debe ser uno de: ' + TIPOS_GASTO.join(', ') })
      const { data: movs } = await sb.from('bank_movements').select('id,fecha,tipo,monto,moneda,concepto,categoria,tipo_gasto').in('id', idsOk)
      if (!movs?.length) return texto({ error: 'No encontré esos movimientos.' })
      const patch: any = { categoria: cat, categoria_manual: true }
      if (!tieneGasto(cat)) patch.tipo_gasto = null
      else if (tg) patch.tipo_gasto = tg
      if (typeof args?.observaciones === 'string' && args.observaciones.trim()) patch.observaciones = args.observaciones.trim()
      const avisos: string[] = []
      if (cat === 'cobro_cliente' && movs.some((m: any) => m.tipo === 'cargo')) avisos.push('Hay cargos marcados como cobro a cliente: un cobro es un abono.')
      if (tieneGasto(cat) && movs.some((m: any) => m.tipo === 'abono')) avisos.push('Hay abonos marcados como pago a proveedor: ¿es una devolución?')
      if (!args?.confirmar) {
        return texto({ clasificado: false, vista_previa: true, cuantos: movs.length, de: idsOk.length,
          queda: patch, movimientos: movs.map((m: any) => ({ id: m.id, fecha: m.fecha, tipo: m.tipo, monto: Number(m.monto), moneda: cur(m.moneda), concepto: m.concepto, antes: m.categoria, despues: cat })),
          avisos: avisos.length ? avisos : undefined, para_ejecutar: 'repita con confirmar=true' })
      }
      const { error } = await sb.from('bank_movements').update(patch).in('id', movs.map((m: any) => m.id))
      if (error) return texto({ clasificado: false, error: error.message })
      return texto({ clasificado: true, cuantos: movs.length, categoria: cat, tipo_gasto: patch.tipo_gasto ?? '(sin cambio)', avisos: avisos.length ? avisos : undefined })
    }

    // ─────────────────────────────────────────────────────────────────────
    case 'conta_asignar_beneficiario': {
      const idsOk = lista(args?.ids).slice(0, 200)
      if (!idsOk.length) return texto({ error: 'Faltan los ids de los movimientos.' })
      const tipo = String(args?.tipo || '')
      let ficha: { id: string; nombre: string } | null = null
      if (tipo !== 'ninguno') {
        const ref = limpio(args?.beneficiario)
        if (!ref) return texto({ error: 'Falta el beneficiario (id o nombre).' })
        let cands: any[] = []
        if (tipo === 'proveedor') {
          const { data } = esUuid(args.beneficiario)
            ? await sb.from('suppliers').select('id,name,rfc').eq('id', args.beneficiario)
            : await sb.from('suppliers').select('id,name,rfc').ilike('name', `%${ref}%`).eq('is_active', true).limit(10)
          cands = (data || []).map((x: any) => ({ id: x.id, nombre: x.name, rfc: x.rfc }))
        } else if (tipo === 'cliente') {
          const { data } = esUuid(args.beneficiario)
            ? await sb.from('clientes').select('id,razon_social,nombre_comercial,rfc').eq('id', args.beneficiario)
            : await sb.from('clientes').select('id,razon_social,nombre_comercial,rfc').or(`razon_social.ilike.%${ref}%,nombre_comercial.ilike.%${ref}%`).limit(10)
          cands = (data || []).map((x: any) => ({ id: x.id, nombre: x.nombre_comercial || x.razon_social, rfc: x.rfc }))
        } else if (tipo === 'empleado') {
          const { data } = esUuid(args.beneficiario)
            ? await sb.from('employees').select('id,name,area').eq('id', args.beneficiario)
            : await sb.from('employees').select('id,name,area').ilike('name', `%${ref}%`).eq('activo', true).limit(10)
          cands = (data || []).map((x: any) => ({ id: x.id, nombre: x.name, area: x.area }))
        } else return texto({ error: 'tipo debe ser proveedor, cliente, empleado o ninguno.' })
        if (!cands.length) return texto({ error: `No encontré ${tipo} "${ref}".` })
        if (cands.length > 1) return texto({ asignado: false, motivo: 'Varios empatan. Elija uno y repita con su id.', candidatos: cands })
        ficha = cands[0]
      }
      const { data: movs } = await sb.from('bank_movements').select('id,fecha,tipo,monto,moneda,concepto,beneficiario,cuenta_destino_detectada,clabe_contraparte').in('id', idsOk)
      if (!movs?.length) return texto({ error: 'No encontré esos movimientos.' })
      const upd = { beneficiario_id: ficha?.id || null, beneficiario_tipo: ficha ? tipo : null, beneficiario: ficha?.nombre || null }

      // Aprender la cuenta: sólo proveedores y sólo cargos. Lo que ya conoce
      // CUALQUIER proveedor no se toca: si está mal, se corrige en su ficha.
      let aprender: any[] = []
      if (ficha && tipo === 'proveedor' && args?.aprender_cuenta) {
        const { data: conocidas } = await sb.from('supplier_bank_accounts').select('bnet_codigo,cuenta_bancaria,clabe')
        const { data: provs } = await sb.from('suppliers').select('bnet_codigo,cuenta_bancaria,clabe')
        const todasCtas = [...(conocidas || []), ...(provs || [])]
        const nuevas = new Map<string, any>()
        for (const m of movs) {
          if (m.tipo !== 'cargo') continue
          const bnet = bnetDe(m.concepto || '')
          const cuenta = cuentaTerceroDe(m.concepto || '') || m.cuenta_destino_detectada || m.clabe_contraparte || null
          if (!bnet && !cuenta) continue
          const ya = todasCtas.some((a: any) => (bnet && a.bnet_codigo === bnet) || (cuenta && (a.clabe === cuenta || a.cuenta_bancaria === cuenta)))
          if (ya) continue
          nuevas.set(`${bnet || ''}|${cuenta || ''}`, { supplier_id: ficha.id, etiqueta: bnet ? `BNET ${bnet}` : `Cuenta ${cuenta}`, moneda: 'MXN', bnet_codigo: bnet, cuenta_bancaria: cuenta })
        }
        aprender = [...nuevas.values()]
      }
      if (!args?.confirmar) {
        return texto({ asignado: false, vista_previa: true, beneficiario: ficha ? { tipo, ...ficha } : '— se quita —',
          movimientos: movs.map((m: any) => ({ id: m.id, fecha: m.fecha, tipo: m.tipo, monto: Number(m.monto), moneda: cur(m.moneda), concepto: m.concepto, antes: m.beneficiario || null })),
          cuentas_que_aprenderia: aprender.length ? aprender : undefined, para_ejecutar: 'repita con confirmar=true' })
      }
      const { error } = await sb.from('bank_movements').update(upd).in('id', movs.map((m: any) => m.id))
      if (error) return texto({ asignado: false, error: error.message })
      let aprendidas = 0, errorAprender: string | undefined
      if (aprender.length) {
        const { error: e2 } = await sb.from('supplier_bank_accounts').insert(aprender)
        if (e2) errorAprender = 'El beneficiario sí se guardó, pero no pude registrar la cuenta: ' + e2.message
        else aprendidas = aprender.length
      }
      return texto({ asignado: true, cuantos: movs.length, beneficiario: ficha?.nombre || null, cuentas_aprendidas: aprendidas, error: errorAprender })
    }

    // ─────────────────────────────────────────────────────────────────────
    case 'conta_asignar_proyecto': {
      const idsOk = lista(args?.ids).slice(0, 200)
      if (!idsOk.length) return texto({ error: 'Faltan los ids de los movimientos.' })
      const { data: movs } = await sb.from('bank_movements').select('id,fecha,tipo,monto,moneda,concepto,lead_id,quotation_id,purchase_order_id').in('id', idsOk)
      if (!movs?.length) return texto({ error: 'No encontré esos movimientos.' })
      const quitar = String(args?.lead ?? '').trim() === ''
      let lead: any = null, cot: any = null, oc: any = null
      if (!quitar) {
        const r = await leadDe(sb, String(args.lead))
        if (!r.l) return texto({ error: r.error, candidatos: (r as any).candidatos })
        lead = r.l
        if (args?.cotizacion) {
          const rq = await cotizacionDe(sb, String(args.cotizacion))
          if (!rq.q) return texto({ error: rq.error })
          cot = rq.q
          if (leadDeCot(cot) && leadDeCot(cot) !== lead.id) return texto({ error: `La cotización ${cot.folio} no es del lead ${lead.codigo}.` })
          const yaLaTienen = movs.every((m: any) => m.quotation_id === cot.id)
          if (!esContratoVivo(cot) && !yaLaTienen) {
            return texto({ error: `${cot.folio} no es un contrato vivo (etapa ${cot.stage}${cot.archived_at ? ', archivada' : ''}${cot.version_group_id && !cot.vigente ? ', versión no vigente' : ''}). Sólo se amarra dinero a contratos: a una propuesta o una estimación ensucia el estado de cuenta.` })
          }
        }
        if (args?.orden) {
          const ref = String(args.orden).trim()
          const q = sb.from('purchase_orders').select('id,folio,po_number,status,lead_id,quotation_id').limit(2)
          const { data } = esUuid(ref) ? await q.eq('id', ref) : await q.or(`folio.ilike.${limpio(ref)},po_number.ilike.${limpio(ref)}`)
          if (data?.length !== 1) return texto({ error: `No encontré la OC "${ref}".` })
          oc = data[0]
          if (oc.lead_id && oc.lead_id !== lead.id) return texto({ error: `La OC ${oc.folio || oc.po_number} es de otro lead.` })
          if (cot && oc.quotation_id && oc.quotation_id !== cot.id) return texto({ error: `La OC ${oc.folio || oc.po_number} es de otra cotización.` })
        }
      }
      const upd: any = {
        lead_id: lead?.id || null, quotation_id: cot?.id || null, purchase_order_id: oc?.id || null,
        proyecto: lead?.name || '', asignacion_auto: false,
      }
      if (!args?.confirmar) {
        return texto({ asignado: false, vista_previa: true,
          queda: { lead: lead ? `${lead.codigo} — ${lead.name}` : '— se quita —', cotizacion: cot?.folio || null, orden: oc ? (oc.folio || oc.po_number) : null },
          movimientos: movs.map((m: any) => ({ id: m.id, fecha: m.fecha, tipo: m.tipo, monto: Number(m.monto), moneda: cur(m.moneda), concepto: m.concepto })),
          nota: 'En cascada: si no da cotización u OC, quedan vacías aunque antes tuvieran una.', para_ejecutar: 'repita con confirmar=true' })
      }
      const { error } = await sb.from('bank_movements').update(upd).in('id', movs.map((m: any) => m.id))
      if (error) return texto({ asignado: false, error: error.message })
      return texto({ asignado: true, cuantos: movs.length, lead: lead?.codigo || null, cotizacion: cot?.folio || null, orden: oc ? (oc.folio || oc.po_number) : null })
    }

    // ─────────────────────────────────────────────────────────────────────
    case 'conta_conciliar': {
      const { m, error } = await movimientoDe(sb, String(args?.movimiento || ''))
      if (!m) return texto({ error })
      const rf = await facturaDe(sb, String(args?.factura || ''))
      if (!rf.f) return texto({ error: rf.error, candidatos: rf.candidatos })
      const f = rf.f
      if (f.sandbox) return texto({ error: 'Esa factura es de pruebas (sandbox).' })
      if (facturaCancelada(f)) return texto({ error: 'Esa factura está cancelada.' })
      const lm = await linksDeMov(sb, m.id)
      if (lm.some((l: any) => l.invoice_id === f.id)) return texto({ error: 'Ese movimiento ya está vinculado a esa factura. Para cambiar el monto, desconcilie y vuelva a conciliar.' })
      const lf = await linksDeFactura(sb, f.id)
      const mMov = cur(m.moneda), mFac = cur(f.moneda)
      const cruzado = mMov !== mFac
      const tc = Number(args?.tc) || 0
      if (cruzado && !(tc > 0)) {
        return texto({ conciliado: false, error: `El movimiento es en ${mMov} y la factura en ${mFac}. Necesito el tipo de cambio del día del pago (BBVA venta). No lo invento.` })
      }
      const restaMov = c2(Number(m.monto) - aplicadoEnMov(lm))
      const restaFacEnSuMoneda = c2(Number(f.total) - aplicadoEnFactura(lf))
      const restaFacEnMonedaMov = cruzado ? convertir(restaFacEnSuMoneda, mFac, mMov, mFac === 'USD' ? tc : tc) : restaFacEnSuMoneda
      const monto = c2(args?.monto != null ? Number(args.monto) : Math.min(restaMov, restaFacEnMonedaMov))
      if (!(monto > 0)) return texto({ conciliado: false, error: 'No queda nada por aplicar: el movimiento o la factura ya están cubiertos.', falta_movimiento: restaMov, falta_factura: restaFacEnSuMoneda })
      const avisos: string[] = []
      if (monto > restaMov + 0.01) avisos.push(`El monto (${monto}) es mayor a lo que le falta al movimiento (${restaMov}).`)
      const enFactura = cruzado ? convertir(monto, mMov, mFac, tc) : monto
      if (enFactura > restaFacEnSuMoneda + 0.01) avisos.push(`Aplicaría ${enFactura} ${mFac} y a la factura sólo le faltan ${restaFacEnSuMoneda}.`)
      const dirEsperada = m.tipo === 'abono' ? 'emitida' : 'recibida'
      if (f.direccion !== dirEsperada) avisos.push(`Un ${m.tipo} normalmente va contra una factura ${dirEsperada} y ésta es ${f.direccion}.`)
      if (['P', 'N'].includes(String(f.tipo_comprobante))) avisos.push(`Es un CFDI tipo ${f.tipo_comprobante}; normalmente se concilia la factura tipo I.`)
      const fila: any = { bank_movement_id: m.id, invoice_id: f.id, monto_aplicado: monto }
      if (cruzado) { fila.tc_aplicado = tc; fila.monto_en_moneda_factura = enFactura }
      if (args?.nota) fila.nota = String(args.nota)
      const cubre = aplicadoEnMov(lm) + monto >= Number(m.monto) - 0.01
      const vista = {
        movimiento: { id: m.id, fecha: m.fecha, tipo: m.tipo, monto: Number(m.monto), moneda: mMov, concepto: m.concepto, ya_vinculado: aplicadoEnMov(lm) },
        factura: { id: f.id, folio: `${f.serie || ''}${f.folio || ''}`, tipo: f.tipo_comprobante, direccion: f.direccion, contraparte: f.direccion === 'emitida' ? f.receptor_nombre : f.emisor_nombre, total: Number(f.total), moneda: mFac, ya_aplicado: aplicadoEnFactura(lf) },
        se_aplica: { monto, moneda: mMov, tc: cruzado ? tc : undefined, equivale_en_factura: cruzado ? `${enFactura} ${mFac}` : undefined },
        movimiento_queda_conciliado: cubre,
      }
      if (!args?.confirmar) return texto({ conciliado: false, vista_previa: true, ...vista, avisos: avisos.length ? avisos : undefined, para_ejecutar: 'repita con confirmar=true' })
      const { error: e1 } = await sb.from('conciliacion_links').insert(fila)
      if (e1) return texto({ conciliado: false, error: e1.message })
      if (cubre && !m.conciliado) await sb.from('bank_movements').update({ conciliado: true }).eq('id', m.id)
      return texto({ conciliado: true, ...vista, avisos: avisos.length ? avisos : undefined })
    }

    // ─────────────────────────────────────────────────────────────────────
    case 'conta_desconciliar': {
      const { m, error } = await movimientoDe(sb, String(args?.movimiento || ''))
      if (!m) return texto({ error })
      const lm = await linksDeMov(sb, m.id)
      let quitar = lm
      if (args?.factura) {
        const rf = await facturaDe(sb, String(args.factura))
        if (!rf.f) return texto({ error: rf.error, candidatos: rf.candidatos })
        quitar = lm.filter((l: any) => l.invoice_id === rf.f.id)
        if (!quitar.length) return texto({ error: 'Ese movimiento no está vinculado a esa factura.' })
      }
      const quedan = lm.filter((l: any) => !quitar.includes(l))
      const sigueConciliado = aplicadoEnMov(quedan) >= Number(m.monto) - 0.01
      if (!args?.confirmar) {
        return texto({ desconciliado: false, vista_previa: true, movimiento: { id: m.id, fecha: m.fecha, monto: Number(m.monto), moneda: cur(m.moneda), concepto: m.concepto },
          vinculos_que_se_quitan: quitar, vinculos_que_quedan: quedan.length, queda_conciliado: sigueConciliado, para_ejecutar: 'repita con confirmar=true' })
      }
      const { error: e1 } = await sb.from('conciliacion_links').delete().in('id', quitar.map((l: any) => l.id))
      if (e1) return texto({ desconciliado: false, error: e1.message })
      const patch: any = {}
      if (!sigueConciliado && m.conciliado) patch.conciliado = false
      if (!args?.factura) { patch.conciliado = false; patch.factura_match_id = null; patch.factura_match_info = null }
      if (Object.keys(patch).length) await sb.from('bank_movements').update(patch).eq('id', m.id)
      return texto({ desconciliado: true, quitados: quitar.length, queda_conciliado: args?.factura ? sigueConciliado : false })
    }

    // ─────────────────────────────────────────────────────────────────────
    case 'conta_prorratear_cobro': {
      const { m, error } = await movimientoDe(sb, String(args?.movimiento || ''))
      if (!m) return texto({ error })
      const reparto = Array.isArray(args?.reparto) ? args.reparto : []
      const mMov = cur(m.moneda)
      const filas: any[] = []
      let leadComun: string | null = m.lead_id || null
      for (const r of reparto) {
        const rq = await cotizacionDe(sb, String(r?.cotizacion || ''))
        if (!rq.q) return texto({ error: rq.error })
        const q = rq.q
        const actual = m.quotation_id === q.id
        if (!esContratoVivo(q) && !actual) return texto({ error: `${q.folio} no es un contrato vivo. Sólo se reparte dinero entre contratos.` })
        const monto = c2(r?.monto)
        if (!(monto > 0)) return texto({ error: `Monto inválido para ${q.folio}.` })
        const qCur = monedaCot(q)
        const tc = Number(r?.tc) || 0
        if (qCur !== mMov && !(tc > 0)) return texto({ error: `${q.folio} está en ${qCur} y el cobro en ${mMov}: falta el tc de esa cotización. No lo invento.` })
        filas.push({ bank_movement_id: m.id, quotation_id: q.id, monto: qCur === mMov ? monto : convertir(monto, mMov, qCur, tc), monto_origen: monto, moneda_origen: mMov, tc_aplicado: qCur !== mMov ? tc : null, _folio: q.folio, _moneda_cot: qCur })
        leadComun = leadComun || leadDeCot(q)
      }
      const suma = c2(filas.reduce((s, f) => s + f.monto_origen, 0))
      const cuadra = Math.abs(suma - Number(m.monto)) <= 0.01
      const { data: previo } = await sb.from('payment_allocations').select('quotation_id,monto,moneda_origen').eq('bank_movement_id', m.id)
      const vista = {
        movimiento: { id: m.id, fecha: m.fecha, tipo: m.tipo, monto: Number(m.monto), moneda: mMov, concepto: m.concepto },
        reparto_anterior: previo || [],
        reparto_nuevo: filas.map(f => ({ cotizacion: f._folio, monto_del_cobro: f.monto_origen, moneda_cobro: mMov, cuenta_en_cotizacion: `${f.monto} ${f._moneda_cot}`, tc: f.tc_aplicado || undefined })),
        suma, cuadra,
        aviso: cuadra || !filas.length ? undefined : `El reparto suma ${suma} y el movimiento es de ${Number(m.monto)} ${mMov}.`,
      }
      if (m.tipo !== 'abono') (vista as any).aviso2 = 'Este movimiento es un cargo; el reparto es para cobros.'
      if (!args?.confirmar) return texto({ guardado: false, vista_previa: true, ...vista, para_ejecutar: 'repita con confirmar=true' })
      const { error: e1 } = await sb.from('payment_allocations').delete().eq('bank_movement_id', m.id)
      if (e1) return texto({ guardado: false, error: e1.message })
      if (filas.length) {
        const { error: e2 } = await sb.from('payment_allocations').insert(filas.map(({ _folio, _moneda_cot, ...f }) => f))
        if (e2) return texto({ guardado: false, error: 'Se borró el reparto anterior pero falló el nuevo: ' + e2.message + '. Repita la llamada.' })
      }
      const upd: any = { quotation_id: filas.length === 1 ? filas[0].quotation_id : null }
      if (leadComun) upd.lead_id = leadComun
      await sb.from('bank_movements').update(upd).eq('id', m.id)
      return texto({ guardado: true, ...vista })
    }

    // ─────────────────────────────────────────────────────────────────────
    case 'conta_registrar_efectivo': {
      const tipo = String(args?.tipo || '')
      if (!TIPOS_EFECTIVO.includes(tipo)) return texto({ error: 'tipo debe ser uno de: ' + TIPOS_EFECTIVO.join(', ') })
      const monto = c2(args?.monto)
      if (!(monto > 0)) return texto({ error: 'Monto inválido.' })
      const persona = String(args?.persona || '').trim()
      if (!persona) return texto({ error: 'Falta la persona.' })
      const moneda = cur(args?.moneda)
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(args?.fecha || '')) ? String(args.fecha) : hoy
      let lead: any = null, cot: any = null, oc: any = null
      if (args?.lead) { const r = await leadDe(sb, String(args.lead)); if (!r.l) return texto({ error: r.error, candidatos: (r as any).candidatos }); lead = r.l }
      if (args?.cotizacion) {
        const r = await cotizacionDe(sb, String(args.cotizacion)); if (!r.q) return texto({ error: r.error }); cot = r.q
        if (cot.archived_at || (cot.version_group_id && !cot.vigente)) return texto({ error: `${cot.folio} no es la versión vigente o está archivada.` })
        if (!lead && leadDeCot(cot)) { const { data } = await sb.from('leads').select('id,codigo,name').eq('id', leadDeCot(cot)).maybeSingle(); lead = data }
      }
      if (args?.orden) {
        const ref = String(args.orden).trim()
        const q = sb.from('purchase_orders').select('id,folio,po_number,status,lead_id,currency').limit(2)
        const { data } = esUuid(ref) ? await q.eq('id', ref) : await q.or(`folio.ilike.${limpio(ref)},po_number.ilike.${limpio(ref)}`)
        if (data?.length !== 1) return texto({ error: `No encontré la OC "${ref}".` })
        oc = data[0]
        if (oc.status === 'cancelada') return texto({ error: 'Esa OC está cancelada: no se le abona efectivo.' })
      }
      const qCur = cot ? monedaCot(cot) : null
      const cruce = tipo === 'cobro_cliente' && qCur && qCur !== moneda
      const tc = Number(args?.tc) || 0
      if (cruce && !(tc > 0)) return texto({ error: `El cobro es en ${moneda} y la cotización en ${qCur}. Necesito el tipo de cambio.` })
      const fila: any = {
        tipo, direccion: tipo === 'cobro_cliente' || tipo === 'aportacion' ? 'ingreso' : 'egreso',
        persona, concepto: String(args?.concepto || '').trim(), monto, fecha,
        proyecto_nombre: lead?.name || cot?.name || null,
        lead_id: lead?.id || null, quotation_id: cot?.id || null, purchase_order_id: oc?.id || null,
        moneda, tc_aplicado: cruce ? tc : null, moneda_cotizacion: cruce ? qCur : null,
        monto_cotizacion: cruce ? convertir(monto, moneda, qCur as string, tc) : null,
      }
      // Guarda contra el reintento: mismo día, monto, tipo y persona.
      const { data: gemelos } = await sb.from('cash_movements').select('id,created_at,concepto').eq('fecha', fecha).eq('monto', monto).eq('tipo', tipo).eq('persona', persona).limit(3)
      const avisos: string[] = []
      if (gemelos?.length) avisos.push(`Ya hay ${gemelos.length} movimiento(s) de efectivo idénticos ese día (mismo tipo, monto y persona). ¿Es el mismo?`)
      if (tipo === 'nomina_efectivo') avisos.push('La nómina en efectivo ya está en el módulo de nómina; este registro es para la caja, no se suma dos veces en reportes.')
      if (oc && oc.currency && cur(oc.currency) !== moneda) avisos.push(`La OC es en ${cur(oc.currency)} y el pago en ${moneda}.`)
      if (!args?.confirmar) return texto({ registrado: false, vista_previa: true, movimiento: fila, lead: lead?.codigo, cotizacion: cot?.folio, orden: oc ? (oc.folio || oc.po_number) : undefined, avisos: avisos.length ? avisos : undefined, para_ejecutar: 'repita con confirmar=true' })
      if (gemelos?.length && !args?.forzar) {
        return texto({ registrado: false, motivo: avisos[0], gemelos, para_ejecutar: 'si de verdad es otro, repita con confirmar=true y forzar=true' })
      }
      const { data, error } = await sb.from('cash_movements').insert(fila).select('id,tipo,direccion,monto,moneda,fecha').single()
      if (error) return texto({ registrado: false, error: error.message })
      return texto({ registrado: true, movimiento: data, siguiente: 'El recibo con folio y el comprobante se suben desde la pestaña Efectivo del ERP.' })
    }

    // ─────────────────────────────────────────────────────────────────────
    case 'conta_buscar_efectivo': {
      const lim = Math.min(Math.max(Number(args?.limite) || 50, 1), 500)
      let q = sb.from('cash_movements').select('id,fecha,tipo,direccion,monto,moneda,persona,concepto,proyecto_nombre,lead_id,quotation_id,purchase_order_id,folio_recibo,comprobante_path,tc_aplicado,monto_cotizacion,moneda_cotizacion')
        .order('fecha', { ascending: false }).limit(lim)
      if (args?.desde) q = q.gte('fecha', args.desde)
      if (args?.hasta) q = q.lte('fecha', args.hasta)
      if (args?.tipo) q = q.eq('tipo', args.tipo)
      if (args?.texto) { const t = limpio(args.texto); q = q.or(`persona.ilike.%${t}%,concepto.ilike.%${t}%,proyecto_nombre.ilike.%${t}%`) }
      if (args?.lead) { const r = await leadDe(sb, String(args.lead)); if (!r.l) return texto({ error: r.error }); q = q.eq('lead_id', r.l.id) }
      const { data, error } = await q
      if (error) return texto({ error: error.message })
      const tot: any = {}
      for (const m of data || []) { const k = `${m.direccion}_${cur(m.moneda)}`; tot[k] = c2((tot[k] || 0) + Number(m.monto)) }
      return texto({ encontrados: data?.length || 0, totales_por_direccion_y_moneda: tot, aviso: (data?.length || 0) >= lim ? `Hay más de ${lim}; acote las fechas.` : undefined, movimientos: data })
    }

    // ─────────────────────────────────────────────────────────────────────
    case 'conta_resumen_mes': {
      const mes = String(args?.mes || '')
      if (!/^\d{4}-\d{2}$/.test(mes)) return texto({ error: 'mes debe ser AAAA-MM.' })
      const [a, mm] = mes.split('-').map(Number)
      const ini = `${mes}-01`
      const fin = new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10)
      const sumaPor = (arr: any[], k: (x: any) => string, v: (x: any) => number) => {
        const o: any = {}; for (const x of arr) { const kk = k(x); o[kk] = c2((o[kk] || 0) + v(x)) } return o
      }
      // Facturas del mes
      const facts = await todas((x, y) => sb.from('facturas').select('id,direccion,tipo_comprobante,subtotal,descuento,iva,total,moneda,status,estado,sandbox')
        .gte('fecha_emision', ini).lte('fecha_emision', fin + 'T23:59:59').range(x, y))
      const vivas = facts.filter(f => !f.sandbox && !facturaCancelada(f) && String(f.status || f.estado) !== 'borrador')
      const em = vivas.filter(f => f.direccion === 'emitida'), re = vivas.filter(f => f.direccion === 'recibida')
      const base = (f: any) => Number(f.subtotal || 0) - Number(f.descuento || 0)
      const netoEmitido: any = {}
      for (const f of em) { const k = cur(f.moneda); if (f.tipo_comprobante === 'I') netoEmitido[k] = c2((netoEmitido[k] || 0) + base(f)); if (f.tipo_comprobante === 'E') netoEmitido[k] = c2((netoEmitido[k] || 0) - base(f)) }
      const ivaTrasl = sumaPor(em.filter(f => ['I', 'E'].includes(f.tipo_comprobante)), f => cur(f.moneda), f => (f.tipo_comprobante === 'E' ? -1 : 1) * Number(f.iva || 0))
      const ivaAcred = sumaPor(re.filter(f => ['I', 'E'].includes(f.tipo_comprobante)), f => cur(f.moneda), f => (f.tipo_comprobante === 'E' ? -1 : 1) * Number(f.iva || 0))
      // Banco del mes
      const movs = await todas((x, y) => sb.from('bank_movements').select('id,tipo,monto,moneda,categoria').gte('fecha', ini).lte('fecha', fin).range(x, y))
      const cobrosBanco = sumaPor(movs.filter(m => m.tipo === 'abono' && m.categoria === 'cobro_cliente'), m => cur(m.moneda), m => Number(m.monto))
      const cargos = movs.filter(m => m.tipo === 'cargo')
      const egresosGasto = sumaPor(cargos.filter(m => !NO_ES_GASTO.has(m.categoria)), m => `${m.categoria || 'sin_categoria'} ${cur(m.moneda)}`, m => Number(m.monto))
      const noGasto = sumaPor(cargos.filter(m => NO_ES_GASTO.has(m.categoria)), m => `${m.categoria} ${cur(m.moneda)}`, m => Number(m.monto))
      const sinClasificar = movs.filter(m => !m.categoria || m.categoria === 'otro').length
      // IVA por flujo: lo que la conciliación dice que se cobró/pagó en el mes, proporcional.
      const idsMes = movs.map(m => m.id)
      let ivaFlujo: any = { trasladado: {}, acreditable: {} }, vinculos = 0
      for (let i = 0; i < idsMes.length; i += 200) {
        const { data: ls } = await sb.from('conciliacion_links').select('invoice_id,monto_aplicado,monto_en_moneda_factura').in('bank_movement_id', idsMes.slice(i, i + 200))
        const fIds = [...new Set((ls || []).map((l: any) => l.invoice_id))]
        const { data: fs } = fIds.length ? await sb.from('facturas').select('id,direccion,iva,total,moneda,tipo_comprobante').in('id', fIds) : { data: [] }
        const porId = new Map((fs || []).map((f: any) => [f.id, f]))
        for (const l of ls || []) {
          const f: any = porId.get(l.invoice_id)
          if (!f || !(Number(f.total) > 0) || !['I', 'E'].includes(f.tipo_comprobante)) continue
          vinculos++
          const prop = Number(l.monto_en_moneda_factura ?? l.monto_aplicado) / Number(f.total)
          const lado = f.direccion === 'emitida' ? 'trasladado' : 'acreditable'
          const k = cur(f.moneda)
          ivaFlujo[lado][k] = c2((ivaFlujo[lado][k] || 0) + prop * Number(f.iva || 0))
        }
      }
      // Efectivo
      const efec = await todas((x, y) => sb.from('cash_movements').select('tipo,direccion,monto,moneda').gte('fecha', ini).lte('fecha', fin).range(x, y))
      const cobrosEfec = sumaPor(efec.filter(e => e.tipo === 'cobro_cliente'), e => cur(e.moneda), e => Number(e.monto))
      const egresosEfec = sumaPor(efec.filter(e => e.direccion === 'egreso' && e.tipo !== 'nomina_efectivo'), e => `${e.tipo} ${cur(e.moneda)}`, e => Number(e.monto))
      const aport = sumaPor(efec.filter(e => e.tipo === 'aportacion'), e => cur(e.moneda), e => Number(e.monto))
      // Nómina: el módulo manda
      const { data: nom } = await sb.from('payroll_periods').select('numero_periodo,fecha_pago,total_transferencia,total_efectivo,total_isr,total_imss_obrero,total_imss_patron,estatus').gte('fecha_pago', ini).lte('fecha_pago', fin)
      const nomina = { periodos: nom?.length || 0, transferencia: c2((nom || []).reduce((s: number, p: any) => s + Number(p.total_transferencia || 0), 0)), efectivo: c2((nom || []).reduce((s: number, p: any) => s + Number(p.total_efectivo || 0), 0)) }
      return texto({
        mes,
        facturacion_neta_sin_iva: { valor: netoEmitido, como: 'CFDI emitidos tipo I menos tipo E, subtotal − descuento, sin cancelados ni borradores. NO incluye nómina timbrada (N) ni complementos de pago (P): sumarlos infla ~50%.' },
        cobranza_con_iva: { banco: cobrosBanco, efectivo: cobrosEfec, aportaciones_excluidas: Object.keys(aport).length ? aport : undefined, como: 'Banco: abonos clasificados cobro_cliente. Efectivo: cobro_cliente. Las aportaciones son capital, no venta.' },
        egresos_banco_con_iva: { por_naturaleza: egresosGasto, no_son_gasto: noGasto, nota: 'traspaso_interno, pago_tdc y prestamo son el mismo dinero moviéndose: sumarlos como gasto es doble conteo.' },
        egresos_efectivo: egresosEfec,
        nomina: { ...nomina, total: c2(nomina.transferencia + nomina.efectivo), como: 'Del módulo de nómina (transferencia + efectivo). La nómina del banco y la nómina en efectivo NO se suman aparte: ya están aquí.' },
        iva: {
          por_lo_facturado: { trasladado: ivaTrasl, acreditable: ivaAcred },
          por_lo_conciliado_en_el_mes: { ...ivaFlujo, vinculos },
          nota: 'El IVA se causa por flujo. "Por lo conciliado" toma el IVA proporcional de las facturas cuyo cobro o pago cayó en el mes; sólo cuenta lo que está conciliado, así que subestima mientras haya cobros y pagos sin conciliar.',
        },
        pendientes_que_mueven_estos_numeros: { movimientos_sin_clasificar_en_el_mes: sinClasificar },
        monedas: 'Todo va en su moneda. No se suman pesos con dólares.',
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    case 'conta_nomina': {
      let q = sb.from('payroll_periods').select('id,numero_periodo,frequency,anio,mes,fecha_desde,fecha_hasta,fecha_pago,estatus,total_transferencia,total_efectivo,total_fiscal,total_isr,total_imss_obrero,total_imss_patron,total_infonavit,total_caja_chica,total_bonos,total_horas_extras,transferencia_pagada,transferencia_pagada_at')
        .order('fecha_pago', { ascending: false }).limit(60)
      if (args?.anio) q = q.eq('anio', Number(args.anio))
      if (args?.mes) q = q.eq('mes', Number(args.mes))
      const { data, error } = await q
      if (error) return texto({ error: error.message })
      const total = c2((data || []).reduce((s: number, p: any) => s + Number(p.total_transferencia || 0) + Number(p.total_efectivo || 0), 0))
      return texto({ periodos: data?.length || 0, total_transferencia_mas_efectivo: total, periodos_detalle: data })
    }

    default:
      return texto({ error: `Herramienta desconocida: ${nombre}` })
  }
}
