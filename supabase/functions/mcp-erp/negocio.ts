// Bloque 4 — el resto del negocio, en modo lectura: cotizaciones, compras,
// cobranza, catalogo, inventario y facturas.
//
// Casi todo aqui SOLO LEE. Es a proposito: lo que dot necesita para coordinar
// es ver, y ver no se puede equivocar de forma cara. Las escrituras de
// cotizacion y catalogo entran despues, con la moneda preguntada.
//
// ⚠️ DOS COSAS DE ESTE ERP QUE HAY QUE RESPETAR AQUI
//
// 1. facturas.status manda; facturas.estado es ruido. Hay 4,127 renglones con
//    estado='borrador' Y status='timbrada' al mismo tiempo. Leer `estado` como
//    si fuera la verdad hace creer que algo esta sin timbrar cuando ya se
//    timbro. Aqui solo se devuelve status, y estado ni se selecciona.
//
// 2. La moneda del COSTO (catalogo) y la de VENTA (cotizacion) son distintas y
//    viven en la misma fila a proposito. quotation_items.cost va en la moneda
//    del proveedor y .price en la de la cotizacion. Por eso el catalogo SIEMPRE
//    se devuelve con su moneda al lado: un costo sin moneda es el error de 18x
//    que este ERP ya pago.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Quien } from './tools.ts'

const TOPE = 200
const texto = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] })
const esUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const limpio = (t: string) => String(t).replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim()

async function leadDe(sb: SupabaseClient, ref: string) {
  const q = sb.from('leads').select('id,codigo,name,company').limit(1)
  const { data } = esUuid(ref) ? await q.eq('id', ref) : await q.ilike('codigo', ref.trim())
  return data?.[0] || null
}

export const DEFINICIONES_NEG = [
  {
    name: 'ver_obra',
    annotations: { readOnlyHint: true },
    description:
      'La foto completa de un proyecto: sus cotizaciones, sus ordenes de compra, lo vendido contra lo ' +
      'cobrado, y como van sus tareas. Es la respuesta a "como va X". Acepta la clave de 4 letras.',
    inputSchema: {
      type: 'object',
      properties: { lead: { type: 'string', description: 'id del lead o su clave de 4 letras.' } },
      required: ['lead'],
    },
  },
  {
    name: 'buscar_cotizaciones',
    annotations: { readOnlyHint: true },
    description: 'Busca cotizaciones por lead, etapa, especialidad o nombre. Devuelve folio, etapa y total.',
    inputSchema: {
      type: 'object',
      properties: {
        lead: { type: 'string', description: 'id del lead o clave de 4 letras.' },
        etapa: { type: 'string', description: 'oportunidad, propuesta, estimacion, contrato...' },
        especialidad: { type: 'string', enum: ['esp','elec','ilum','cort','proy','dist'] },
        texto: { type: 'string', description: 'Parte del nombre o del folio.' },
        limite: { type: 'integer' },
      },
    },
  },
  {
    name: 'ver_cotizacion',
    annotations: { readOnlyHint: true },
    description:
      'El detalle de una cotizacion: sus partidas con cantidades y precios, y su costo de material. ' +
      'Acepta el id o el folio. OJO con las monedas: el costo va en la del proveedor y el precio en la ' +
      'de la cotizacion — no los compare sin convertir. Devuelve `version`, que es lo que pide ' +
      'editar_cotizacion para no pisar cambios de otra persona.',
    inputSchema: {
      type: 'object',
      properties: { cotizacion: { type: 'string', description: 'id o folio (ej. MAT-IE01).' } },
      required: ['cotizacion'],
    },
  },
  {
    name: 'buscar_ordenes_compra',
    annotations: { readOnlyHint: true },
    description:
      'Ordenes de compra por lead, proveedor, estado o tipo. tipo=servicio son las de mano de obra y ' +
      'destajo, que no llevan IVA ni cotejo. Devuelve folio, proveedor, total y moneda.',
    inputSchema: {
      type: 'object',
      properties: {
        lead: { type: 'string' },
        proveedor: { type: 'string', description: 'Parte del nombre del proveedor.' },
        estado: { type: 'string', description: 'borrador, aprobada, pedida, pagada...' },
        tipo: { type: 'string', enum: ['material','servicio'] },
        limite: { type: 'integer' },
      },
    },
  },
  {
    name: 'ver_orden_compra',
    annotations: { readOnlyHint: true },
    description:
      'El detalle de una orden: sus partidas, el cotejo contra lo que ofrecio el proveedor, lo que se le ' +
      'ha pagado y el saldo. Acepta id o folio.',
    inputSchema: {
      type: 'object',
      properties: { orden: { type: 'string', description: 'id o folio (ej. MAT-IE01-C21).' } },
      required: ['orden'],
    },
  },
  {
    name: 'cobranza',
    annotations: { readOnlyHint: true },
    description:
      'Lo vendido contra lo cobrado. Sin lead devuelve el panorama de todos; con lead, el desglose por ' +
      'cotizacion. Los montos vienen separados por moneda a proposito: sumar pesos con dolares es el ' +
      'error que este ERP ya pago caro.',
    inputSchema: {
      type: 'object',
      properties: {
        lead: { type: 'string', description: 'id del lead o clave de 4 letras. Omitir para ver todos.' },
        limite: { type: 'integer' },
      },
    },
  },
  {
    name: 'buscar_catalogo',
    annotations: { readOnlyHint: true },
    description:
      'Busca productos del catalogo. SIEMPRE devuelve la moneda del costo junto al costo: en este ERP la ' +
      'moneda del costo la dicta el catalogo y nunca se mueve, y un costo sin su moneda ya produjo ' +
      'cotizaciones con pesos contados como dolares.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Parte del nombre, marca, modelo o SKU.' },
        proveedor: { type: 'string', description: 'Marca o fabricante.' },
        sistema: { type: 'string' },
        limite: { type: 'integer' },
      },
    },
  },
  {
    name: 'buscar_facturas',
    annotations: { readOnlyHint: true },
    description:
      'Facturas emitidas o recibidas, por cliente, mes o estado. OJO: el estado bueno es status; la ' +
      'columna estado de esta tabla es ruido y no se devuelve.',
    inputSchema: {
      type: 'object',
      properties: {
        direccion: { type: 'string', enum: ['emitida','recibida'] },
        cliente: { type: 'string', description: 'Parte del nombre o RFC del receptor o emisor.' },
        desde: { type: 'string', description: 'AAAA-MM-DD' },
        hasta: { type: 'string', description: 'AAAA-MM-DD' },
        limite: { type: 'integer' },
      },
    },
  },
]

export async function ejecutarNeg(nombre: string, args: any, sb: SupabaseClient, _quien: Quien) {
  const lim = Math.min(Math.max(Number(args?.limite) || 40, 1), TOPE)

  switch (nombre) {

    case 'ver_obra': {
      const lead = await leadDe(sb, String(args?.lead || ''))
      if (!lead) return texto({ error: 'No encontre ese lead.' })
      const id = (lead as any).id
      // Sin embeds: purchase_orders tiene varias rutas a leads y un embed
      // ambiguo devuelve 300 (PGRST201), que aqui ya dejo pantallas vacias.
      const [cots, ocs, cob, tareas] = await Promise.all([
        sb.from('quotations').select('id,folio,name,specialty,stage,total,vigente').like('notes', `%${id}%`).limit(TOPE),
        sb.from('purchase_orders').select('id,folio,status,tipo,total,currency,supplier_id').eq('lead_id', id).limit(TOPE),
        sb.from('v_cobranza_lead').select('*').eq('lead_id', id).maybeSingle(),
        sb.from('v_tareas_unificadas').select('donde,abierta,sin_dueno,sin_fecha,vencida').eq('lead_id', id).limit(TOPE),
      ])
      const t = tareas.data || []
      return texto({
        lead,
        liga: `https://omm-erp.vercel.app/crm/${id}`,
        cobranza: cob.data || 'sin movimientos',
        cotizaciones: cots.data || [],
        ordenes_de_compra: ocs.data || [],
        tareas_resumen: {
          abiertas: t.filter((x: any) => x.abierta).length,
          sin_dueno: t.filter((x: any) => x.abierta && x.sin_dueno).length,
          sin_fecha: t.filter((x: any) => x.abierta && x.sin_fecha).length,
          vencidas: t.filter((x: any) => x.vencida).length,
          nota: 'Solo cuenta tareas de oficina: las de campo cuelgan de la obra, no del lead.',
        },
      })
    }

    case 'buscar_cotizaciones': {
      let q = sb.from('quotations')
        .select('id,folio,name,specialty,stage,total,total_final,vigente,version_label,commercial_year,created_at')
        .order('created_at', { ascending: false }).limit(lim)
      if (args?.lead) {
        const lead = await leadDe(sb, String(args.lead))
        if (!lead) return texto({ error: 'No encontre ese lead.' })
        q = q.like('notes', `%${(lead as any).id}%`)
      }
      if (args?.etapa) q = q.eq('stage', args.etapa)
      if (args?.especialidad) q = q.eq('specialty', args.especialidad)
      if (args?.texto) {
        const t = limpio(args.texto)
        if (t) q = q.or(`name.ilike.%${t}%,folio.ilike.%${t}%`)
      }
      const { data, error } = await q
      if (error) return texto({ error: error.message })
      return texto({ encontradas: data?.length || 0, cotizaciones: data })
    }

    case 'ver_cotizacion': {
      const ref = String(args?.cotizacion || '').trim()
      const qb = sb.from('quotations').select('*').limit(1)
      const { data: cab } = esUuid(ref) ? await qb.eq('id', ref) : await qb.ilike('folio', ref)
      const cot = cab?.[0]
      if (!cot) return texto({ error: 'No encontre esa cotizacion.' })
      const [items, costo] = await Promise.all([
        sb.from('quotation_items')
          .select('id,name,marca,modelo,system,quantity,cost,provider_currency,markup,price,total,provider')
          .eq('quotation_id', (cot as any).id).order('order_index').limit(TOPE),
        sb.from('v_cotizacion_costo_material').select('*').eq('quotation_id', (cot as any).id).maybeSingle(),
      ])
      return texto({
        cotizacion: cot,
        // `version` es el mismo updated_at, con el nombre que pide
        // editar_cotizacion. Dos nombres para el mismo dato es como se
        // manda el campo equivocado y la edicion se rechaza sin motivo claro.
        version: (cot as any).updated_at,
        costo_material: costo.data || null,
        ojo_monedas: 'cost va en provider_currency (la del proveedor) y price en la moneda de la cotizacion. No los reste sin convertir.',
        partidas: items.data || [],
      })
    }

    case 'buscar_ordenes_compra': {
      let q = sb.from('purchase_orders')
        .select('id,folio,po_number,status,tipo,total,currency,supplier_id,lead_id,fecha_maxima_pago,created_at')
        .order('created_at', { ascending: false }).limit(lim)
      if (args?.lead) {
        const lead = await leadDe(sb, String(args.lead))
        if (!lead) return texto({ error: 'No encontre ese lead.' })
        q = q.eq('lead_id', (lead as any).id)
      }
      if (args?.estado) q = q.eq('status', args.estado)
      if (args?.tipo) q = q.eq('tipo', args.tipo)
      if (args?.proveedor) {
        const { data: provs } = await sb.from('suppliers').select('id').ilike('name', `%${limpio(args.proveedor)}%`).limit(20)
        const ids = (provs || []).map((p: any) => p.id)
        if (!ids.length) return texto({ encontradas: 0, nota: 'Ningun proveedor con ese nombre.' })
        q = q.in('supplier_id', ids)
      }
      const { data, error } = await q
      if (error) return texto({ error: error.message })
      // Los nombres de proveedor, para que no salgan uuids.
      const sIds = [...new Set((data || []).map((o: any) => o.supplier_id).filter(Boolean))]
      const { data: provs } = sIds.length
        ? await sb.from('suppliers').select('id,name').in('id', sIds) : { data: [] as any[] }
      const nom = new Map((provs || []).map((p: any) => [p.id, p.name]))
      return texto({
        encontradas: data?.length || 0,
        ordenes: (data || []).map((o: any) => ({ ...o, proveedor: nom.get(o.supplier_id) || null })),
      })
    }

    case 'ver_orden_compra': {
      const ref = String(args?.orden || '').trim()
      const qb = sb.from('purchase_orders').select('*').limit(1)
      const { data: cab } = esUuid(ref) ? await qb.eq('id', ref) : await qb.ilike('folio', ref)
      const oc = cab?.[0]
      if (!oc) return texto({ error: 'No encontre esa orden.' })
      const ocId = (oc as any).id
      const [items, cotejo, pagos, prov, sub] = await Promise.all([
        sb.from('po_items')
          .select('id,name,marca,modelo,quantity,unit_cost,total,real_name,real_quantity,real_unit_cost,real_total,cotejo_status,quantity_received,currency')
          .eq('purchase_order_id', ocId).order('order_index').limit(TOPE),
        sb.from('v_po_cotejo_resumen').select('*').eq('purchase_order_id', ocId).maybeSingle(),
        sb.from('purchase_order_payments').select('id,amount,currency,payment_date,method,reference').eq('purchase_order_id', ocId).order('payment_date').limit(TOPE),
        (oc as any).supplier_id
          ? sb.from('suppliers').select('id,name,rfc,contacto,telefono').eq('id', (oc as any).supplier_id).maybeSingle()
          : Promise.resolve({ data: null }),
        sb.from('v_subcontrato_saldo').select('*').eq('purchase_order_id', ocId).maybeSingle(),
      ])
      const pagado = (pagos.data || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
      return texto({
        orden: oc,
        proveedor: prov.data || null,
        cotejo: cotejo.data || null,
        partidas: items.data || [],
        pagos: pagos.data || [],
        pagado,
        saldo: Number((oc as any).total || 0) - pagado,
        subcontrato: sub.data || null,
      })
    }

    case 'cobranza': {
      if (args?.lead) {
        const lead = await leadDe(sb, String(args.lead))
        if (!lead) return texto({ error: 'No encontre ese lead.' })
        const [general, porCot] = await Promise.all([
          sb.from('v_cobranza_lead').select('*').eq('lead_id', (lead as any).id).maybeSingle(),
          sb.from('v_cobranza_cotizacion').select('*').eq('lead_id', (lead as any).id).limit(TOPE),
        ])
        return texto({ lead: (lead as any).codigo, total: general.data || null, por_cotizacion: porCot.data || [] })
      }
      const { data, error } = await sb.from('v_cobranza_lead').select('*')
        .order('vendido_mxn', { ascending: false }).limit(lim)
      if (error) return texto({ error: error.message })
      return texto({
        ojo: 'MXN y USD vienen separados a proposito. Sumarlos da un numero que no existe.',
        leads: data,
      })
    }

    case 'buscar_catalogo': {
      let q = sb.from('catalog_products')
        .select('id,name,marca,modelo,sku,system,provider,unit,cost,moneda,markup,precio_venta,is_active,supplier_id')
        .eq('is_active', true).limit(lim)
      if (args?.texto) {
        const t = limpio(args.texto)
        if (t) q = q.or(`name.ilike.%${t}%,marca.ilike.%${t}%,modelo.ilike.%${t}%,sku.ilike.%${t}%`)
      }
      if (args?.proveedor) q = q.ilike('provider', `%${limpio(args.proveedor)}%`)
      if (args?.sistema) q = q.ilike('system', `%${limpio(args.sistema)}%`)
      const { data, error } = await q
      if (error) return texto({ error: error.message })
      return texto({
        encontrados: data?.length || 0,
        ojo: 'moneda es la del COSTO y la dicta el catalogo: nunca se mueve. Un costo sin su moneda no se puede usar.',
        productos: data,
      })
    }

    case 'buscar_facturas': {
      // estado NO se selecciona: 4,127 renglones dicen estado='borrador' y
      // status='timbrada' a la vez. status es el que manda.
      let q = sb.from('facturas')
        .select('id,direccion,serie,folio,uuid_fiscal,status,tipo_comprobante,fecha_emision,subtotal,iva,total,moneda,receptor_nombre,receptor_rfc,emisor_nombre,emisor_rfc')
        .order('fecha_emision', { ascending: false }).limit(lim)
      if (args?.direccion) q = q.eq('direccion', args.direccion)
      if (args?.desde) q = q.gte('fecha_emision', args.desde)
      if (args?.hasta) q = q.lte('fecha_emision', args.hasta)
      if (args?.cliente) {
        const t = limpio(args.cliente)
        if (t) q = q.or(`receptor_nombre.ilike.%${t}%,receptor_rfc.ilike.%${t}%,emisor_nombre.ilike.%${t}%,emisor_rfc.ilike.%${t}%`)
      }
      const { data, error } = await q
      if (error) return texto({ error: error.message })
      return texto({
        encontradas: data?.length || 0,
        ojo: 'El estado bueno es status. La columna estado de esta tabla contradice a status en miles de renglones y no se devuelve.',
        facturas: data,
      })
    }

    default:
      return texto({ error: `Herramienta desconocida: ${nombre}` })
  }
}
