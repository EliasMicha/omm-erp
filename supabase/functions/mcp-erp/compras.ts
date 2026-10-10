// Bloque 5 — compras con escritura: crear una orden, cotejarla, aprobarla.
//
// Las tres escriben con confirmar=true y antes devuelven los numeros. Una orden
// de compra es un documento que sale hacia un proveedor: lo que se aprueba es
// un total concreto con su moneda, no una intencion.
//
// ── Las reglas de este ERP que aqui NO se pueden romper ────────────────────
//
// 1. UNA ORDEN NUNCA MEZCLA MONEDAS. Si una cotizacion trae pesos y dolares,
//    salen DOS ordenes. Mezclarlas produjo ordenes con importes sumados en
//    crudo, que es el error de 18x que este ERP ya pago.
//
// 2. EL IVA SE REDONDEA A CENTAVOS, no a pesos. Estuvo escrito
//    Math.round(subtotal * 0.16) en seis lugares, y eso redondea a pesos
//    enteros: $35,171.00 daba $5,627.00 en vez de $5,627.36, y la orden salia
//    36 centavos abajo de lo que factura el proveedor. Las de SERVICIO
//    (destajo, mano de obra) no causan IVA.
//
// 3. EL MODELO EN UNA SUSTITUCION. Si se sustituyo el producto y no se capturo
//    el modelo nuevo, el modelo viejo es de OTRO producto: imprimirlo le manda
//    al proveedor un modelo que no corresponde al nombre. Se deja en blanco.
//    Un dato faltante se pregunta; uno equivocado se compra.
//
// 4. APROBAR VUELCA EL COTEJO. Aprobar es decir "comprala asi", y "asi" es lo
//    cotejado. Antes solo se volcaba al marcar "pedida", pero el PDF se manda
//    al aprobar: entre un paso y otro la orden vivia con el precio viejo en
//    los renglones y el nuevo en el total. 23 ordenes se firmaron asi.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Quien } from './tools.ts'

const TOPE = 200
const ERP = 'https://omm-erp.vercel.app'
const texto = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] })
const esUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const limpio = (t: string) => String(t).replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim()

/** Copias exactas de src/lib/ivaCompra.ts. Si alla cambia la tasa, aqui tambien. */
const TASA_IVA_COMPRA = 0.16
const centavos = (n: any) => Math.round((Number(n) || 0) * 100) / 100
const ivaDeOrden = (subtotal: any, tipo?: string | null) =>
  tipo === 'servicio' ? 0 : centavos((Number(subtotal) || 0) * TASA_IVA_COMPRA)

const estaCotejado = (it: any) => it?.cotejo_status === 'cotejado' || it?.cotejo_status === 'sustituido'

/** Copia de camposCotejados() de src/lib/cotejo.ts. Los campos a ESCRIBIR
 *  cuando la orden se vuelve definitiva. */
function camposCotejados(it: any): Record<string, unknown> {
  if (!estaCotejado(it)) return {}
  const f: Record<string, unknown> = {}
  if (it.real_quantity != null) f.quantity = it.real_quantity
  if (it.real_unit_cost != null) f.unit_cost = it.real_unit_cost
  if (it.real_total != null) f.total = it.real_total
  else if (it.real_quantity != null || it.real_unit_cost != null) {
    const q = it.real_quantity != null ? Number(it.real_quantity) : Number(it.quantity ?? 0)
    const c = it.real_unit_cost != null ? Number(it.real_unit_cost) : Number(it.unit_cost ?? 0)
    f.total = centavos(q * c)
  }
  if (it.real_name) {
    f.name = it.real_name
    if (!it.real_modelo) f.modelo = ''   // ver la regla 3 del encabezado
  }
  if (it.real_marca) f.marca = it.real_marca
  if (it.real_modelo) f.modelo = it.real_modelo
  return f
}

async function ordenDe(sb: SupabaseClient, ref: string) {
  const q = sb.from('purchase_orders').select('*').limit(1)
  const { data } = esUuid(ref) ? await q.eq('id', ref) : await q.ilike('folio', ref.trim())
  return data?.[0] || null
}

/** Copia de SYSTEM_DB_NAME de src/lib/sistemasVendidos.ts. Si alla cambia,
 *  aqui tambien: un sistema apagado que no se reconozca se compra de mas. */
const SISTEMA_DB: Record<string, string> = {
  audio: 'Audio', redes: 'Redes', cctv: 'CCTV',
  control_acceso: 'Control de acceso', control_iluminacion: 'Control de iluminacion',
  deteccion_humo: 'Humo', bms: 'BMS', telefonia: 'Telefonia', red_celular: 'Celular',
  lutron_hwqs: 'Lutron', lutron: 'Lutron', somfy: 'Somfy', electrico: 'Electrico',
  cortinas: 'Cortinas', general: 'General',
}

const jsonDe = (t: any) => { try { return JSON.parse(t || '{}') } catch { return {} } }

/** Quita las partidas de un sistema APAGADO en la cotizacion. Apagado = no
 *  sumo al total = no se vendio = no se le compra nada. Copia de
 *  soloSistemasVendidos(), incluida su prudencia: 'lutron' y 'lutron_hwqs'
 *  comparten la etiqueta 'Lutron', asi que solo se excluye por etiqueta
 *  cuando TODOS los ids que la comparten estan apagados. Ante la duda se deja
 *  pasar: ofrecer de mas se desmarca, esconder algo no se nota. */
function soloVendidos(items: any[], notas: any): any[] {
  const apagados: string[] = Array.isArray(notas?.systems_no_suma)
    ? notas.systems_no_suma.filter((x: any) => typeof x === 'string') : []
  if (!apagados.length) return items
  const set = new Set(apagados)
  const custom = new Set(apagados.filter(id => id.startsWith('custom_')))
  const etiquetas = new Set<string>()
  for (const [id, et] of Object.entries(SISTEMA_DB)) {
    if (!set.has(id)) continue
    const hermanos = Object.entries(SISTEMA_DB).filter(([, e]) => e === et).map(([i]) => i)
    if (hermanos.every(h => set.has(h))) etiquetas.add(et)
  }
  return items.filter(it => {
    const cid = jsonDe(it.notes)?.customSystemId
    if (typeof cid === 'string') return !custom.has(cid)
    return !etiquetas.has(String(it.system || ''))
  })
}

const ORDEN_FASE: Record<string, number> = { inicio: 0, roughin: 1, acabados: 2, cierre: 3 }

export const DEFINICIONES_COM = [
  {
    name: 'crear_orden_compra',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description:
      'Crea una orden de compra en BORRADOR con sus partidas. tipo=servicio para destajo y mano de obra ' +
      '(sin IVA, serie OS). UNA ORDEN NUNCA MEZCLA MONEDAS: si hay partidas en pesos y en dolares, salen ' +
      'dos ordenes. SIN confirmar=true devuelve subtotal, IVA y total para revisar, y no escribe nada.',
    inputSchema: {
      type: 'object',
      properties: {
        lead: { type: 'string', description: 'id del lead o clave de 4 letras. De aqui cuelga la orden.' },
        proveedor: { type: 'string', description: 'Nombre del proveedor, o su id.' },
        cotizacion: { type: 'string', description: 'id o folio de la cotizacion. Dalo si existe: de ahi sale el folio bueno de la orden.' },
        tipo: { type: 'string', enum: ['material','servicio'], description: 'Por defecto material.' },
        moneda: { type: 'string', enum: ['MXN','USD'], description: 'La del COSTO, no la de la cotizacion.' },
        descripcion: { type: 'string' },
        fecha_maxima_pago: { type: 'string', description: 'AAAA-MM-DD' },
        partidas: {
          type: 'array',
          description: 'Lo que se le compra al proveedor.',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string' },
              marca: { type: 'string' }, modelo: { type: 'string' },
              unidad: { type: 'string', description: 'pza, m, rollo... por defecto pza.' },
              cantidad: { type: 'number' },
              costo_unitario: { type: 'number', description: 'En la moneda de la orden.' },
              catalogo_id: { type: 'string', description: 'id del producto de catalogo, si se conoce.' },
            },
            required: ['nombre','cantidad','costo_unitario'],
          },
        },
        confirmar: { type: 'boolean' },
      },
      required: ['lead','proveedor','moneda','partidas'],
    },
  },
  {
    name: 'cotejar_partida',
    description:
      'Registra lo que el proveedor OFRECIO de verdad en una partida: otro producto, otra cantidad u otro ' +
      'precio. No pisa lo original, lo guarda al lado. Si sustituye el producto y no sabe el modelo nuevo, ' +
      'NO mande el viejo: dejelo vacio y preguntelo. SIN confirmar=true solo ensena la diferencia.',
    inputSchema: {
      type: 'object',
      properties: {
        partida: { type: 'string', description: 'id de la partida (po_items).' },
        real_nombre: { type: 'string', description: 'Solo si sustituyo el producto.' },
        real_marca: { type: 'string' },
        real_modelo: { type: 'string' },
        real_cantidad: { type: 'number' },
        real_costo_unitario: { type: 'number' },
        estado: { type: 'string', enum: ['cotejado','sustituido','pendiente'], description: 'sustituido si cambio el producto.' },
        notas: { type: 'string' },
        confirmar: { type: 'boolean' },
      },
      required: ['partida'],
    },
  },
  {
    name: 'aprobar_orden_compra',
    description:
      'Aprueba la orden: vuelca el cotejo a los campos definitivos y recalcula subtotal, IVA y total. ' +
      'Aprobar es decir "comprala asi". SIN confirmar=true ensena exactamente como quedarian los renglones ' +
      'y los totales, incluidas las sustituciones, sin escribir nada.',
    inputSchema: {
      type: 'object',
      properties: {
        orden: { type: 'string', description: 'id o folio de la orden.' },
        confirmar: { type: 'boolean' },
      },
      required: ['orden'],
    },
  },
  {
    name: 'generar_ordenes_de_cotizacion',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description:
      'Levanta las ordenes de compra de una cotizacion importando lo que se VENDIO, igual que el boton ' +
      '"Generar en bloque" del ERP: toma las partidas de la cotizacion, el catalogo manda en proveedor, ' +
      'moneda y costo, consolida el mismo producto repetido en varias areas, DESCUENTA lo que ya se pidio ' +
      'en ordenes anteriores de esa cotizacion, y agrupa por PROVEEDOR x MONEDA — una orden nunca mezcla ' +
      'pesos con dolares. El folio sale solo de la clave de la cotizacion (CONC-ES01-C01). ' +
      'SIN confirmar=true devuelve el plan completo con los totales por orden y no escribe nada.',
    inputSchema: {
      type: 'object',
      properties: {
        cotizacion: { type: 'string', description: 'id o folio de la cotizacion (ej. CONC-ES01).' },
        proveedores: {
          type: 'array', items: { type: 'string' },
          description: 'Solo estos proveedores (nombre o id). Omitir para todos los del plan.',
        },
        clave_idempotencia: { type: 'string', description: 'Mandela SIEMPRE: si la llamada se reintenta devuelve las ordenes que ya creo en vez de duplicar la compra.' },
        confirmar: { type: 'boolean' },
      },
      required: ['cotizacion'],
    },
  },
  {
    name: 'cotejar_orden',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description:
      'Coteja de un jalon los costos de una orden contra el Quote que mando el proveedor. Cada renglon del ' +
      'Quote se empareja con su partida por modelo, SKU o nombre; lo que no empareje se REPORTA, no se ' +
      'adivina. No pisa lo original: lo guarda al lado en las columnas real_*. ' +
      'SIN confirmar=true ensena renglon por renglon que cambia, la diferencia de cada uno y la del total.',
    inputSchema: {
      type: 'object',
      properties: {
        orden: { type: 'string', description: 'id o folio de la orden (ej. CONC-ES01-C01).' },
        lineas: {
          type: 'array',
          description: 'Los renglones del Quote del proveedor.',
          items: {
            type: 'object',
            properties: {
              partida: { type: 'string', description: 'id de la partida, si lo sabe. Si no, use modelo o nombre.' },
              modelo: { type: 'string', description: 'Modelo o SKU tal como viene en el Quote.' },
              nombre: { type: 'string', description: 'Descripcion del Quote, para emparejar si no hay modelo.' },
              costo_unitario: { type: 'number', description: 'El precio unitario que ofrecio el proveedor.' },
              cantidad: { type: 'number', description: 'Solo si el proveedor cambio la cantidad.' },
              nombre_real: { type: 'string', description: 'Solo si SUSTITUYO el producto por otro.' },
              marca_real: { type: 'string' },
              modelo_real: { type: 'string', description: 'Si sustituye y no sabe el modelo nuevo, NO mande el viejo: dejelo vacio y preguntelo.' },
            },
          },
        },
        confirmar: { type: 'boolean' },
      },
      required: ['orden', 'lineas'],
    },
  },
  {
    name: 'exportar_orden_compra',
    annotations: { readOnlyHint: true },
    description:
      'Da la liga para descargar el PDF de la orden desde el ERP, y de paso avisa si la orden tiene algo ' +
      'que la haria salir mal impresa (partidas sin cotejar, totales que no cuadran con los renglones).',
    inputSchema: {
      type: 'object',
      properties: { orden: { type: 'string', description: 'id o folio.' } },
      required: ['orden'],
    },
  },
]

export async function ejecutarCom(nombre: string, args: any, sb: SupabaseClient, _quien: Quien) {
  switch (nombre) {

    case 'crear_orden_compra': {
      const partidas: any[] = Array.isArray(args?.partidas) ? args.partidas : []
      if (!partidas.length) return texto({ error: 'Sin partidas no hay orden.' })
      const moneda = String(args?.moneda || '').toUpperCase()
      if (moneda !== 'MXN' && moneda !== 'USD') return texto({ error: 'La moneda debe ser MXN o USD.' })
      const tipo = args?.tipo === 'servicio' ? 'servicio' : 'material'

      const { data: leadRows } = esUuid(String(args.lead))
        ? await sb.from('leads').select('id,codigo,name').eq('id', args.lead).limit(1)
        : await sb.from('leads').select('id,codigo,name').ilike('codigo', String(args.lead).trim()).limit(1)
      const lead = leadRows?.[0]
      if (!lead) return texto({ error: 'No encontre ese lead.' })

      // El proveedor: si el nombre es ambiguo NO se elige, se devuelven los
      // candidatos. Mandarle una orden al proveedor equivocado no se deshace.
      let provId: string; let provNombre: string
      const p = String(args.proveedor).trim()
      if (esUuid(p)) {
        const { data: pr } = await sb.from('suppliers').select('id,name').eq('id', p).maybeSingle()
        if (!pr) return texto({ error: 'Ese id de proveedor no existe.' })
        provId = (pr as any).id; provNombre = (pr as any).name
      } else {
        const { data: prs } = await sb.from('suppliers').select('id,name,rfc')
          .ilike('name', `%${limpio(p)}%`).eq('is_active', true).limit(10)
        if (!prs?.length) return texto({ error: `No encontre proveedor que se llame "${p}".` })
        if (prs.length > 1) return texto({ creada: false, motivo: 'Hay varios proveedores con ese nombre. Elija cual.', candidatos: prs })
        provId = (prs[0] as any).id; provNombre = (prs[0] as any).name
      }

      let cotId: string | null = null
      if (args?.cotizacion) {
        const c = String(args.cotizacion).trim()
        const { data: cs } = esUuid(c)
          ? await sb.from('quotations').select('id,folio').eq('id', c).limit(1)
          : await sb.from('quotations').select('id,folio').ilike('folio', c).limit(1)
        if (!cs?.length) return texto({ error: 'No encontre esa cotizacion.' })
        cotId = (cs[0] as any).id
      }

      const renglones = partidas.map((it, i) => {
        const cant = Number(it.cantidad) || 0
        const cu = Number(it.costo_unitario) || 0
        return {
          name: String(it.nombre || '').trim(),
          marca: it.marca || null, modelo: it.modelo || null,
          unit: it.unidad || 'pza',
          quantity: cant, unit_cost: cu, total: centavos(cant * cu),
          catalog_product_id: it.catalogo_id && esUuid(String(it.catalogo_id)) ? it.catalogo_id : null,
          currency: moneda,         // la misma que la orden, siempre. Ver regla 1.
          order_index: i,
        }
      })
      const subtotal = centavos(renglones.reduce((s, r) => s + r.total, 0))
      const iva = ivaDeOrden(subtotal, tipo)
      const total = centavos(subtotal + iva)

      if (!args?.confirmar) {
        return texto({
          creada: false,
          revise_antes: 'Esto crea un documento dirigido a un proveedor. Revise proveedor, moneda y total.',
          lead: (lead as any).codigo, proveedor: provNombre, tipo, moneda,
          partidas: renglones.length, subtotal,
          iva: tipo === 'servicio' ? '0 — las ordenes de servicio no causan IVA' : iva,
          total,
          folio: cotId ? 'lo asigna la base con la clave de la cotizacion' : 'consecutivo de respaldo (sin cotizacion ligada)',
          para_ejecutar: 'repita con confirmar=true',
        })
      }

      const { data: oc, error: e1 } = await sb.from('purchase_orders').insert({
        lead_id: (lead as any).id, supplier_id: provId, quotation_id: cotId,
        tipo, currency: moneda, status: 'borrador',
        subtotal, iva, total,
        descripcion: args?.descripcion || null,
        fecha_maxima_pago: args?.fecha_maxima_pago || null,
      }).select('id,folio,po_number,status,tipo,currency,subtotal,iva,total').single()
      if (e1 || !oc) return texto({ creada: false, error: e1?.message || 'No pude crear la orden.' })

      const { error: e2 } = await sb.from('po_items')
        .insert(renglones.map(r => ({ ...r, purchase_order_id: (oc as any).id })))
      if (e2) return texto({ creada: 'a medias', orden: oc, error: 'La orden se creo pero fallaron las partidas: ' + e2.message })

      return texto({ creada: true, orden: oc, proveedor: provNombre, partidas: renglones.length })
    }

    case 'cotejar_partida': {
      const id = String(args?.partida || '')
      if (!esUuid(id)) return texto({ error: 'El id de la partida no es valido.' })
      const { data: it } = await sb.from('po_items').select('*').eq('id', id).maybeSingle()
      if (!it) return texto({ error: 'No encontre esa partida.' })

      const cambios: Record<string, unknown> = {}
      if (args?.real_nombre !== undefined) cambios.real_name = args.real_nombre || null
      if (args?.real_marca !== undefined) cambios.real_marca = args.real_marca || null
      if (args?.real_modelo !== undefined) cambios.real_modelo = args.real_modelo || null
      if (args?.real_cantidad !== undefined) cambios.real_quantity = Number(args.real_cantidad)
      if (args?.real_costo_unitario !== undefined) cambios.real_unit_cost = Number(args.real_costo_unitario)
      if (args?.notas !== undefined) cambios.cotejo_notes = args.notas || null

      const q = cambios.real_quantity != null ? Number(cambios.real_quantity) : Number((it as any).quantity || 0)
      const c = cambios.real_unit_cost != null ? Number(cambios.real_unit_cost) : Number((it as any).unit_cost || 0)
      if (cambios.real_quantity != null || cambios.real_unit_cost != null) cambios.real_total = centavos(q * c)

      const sustituye = !!cambios.real_name
      cambios.cotejo_status = args?.estado || (sustituye ? 'sustituido' : 'cotejado')

      const antes = centavos(Number((it as any).total || 0))
      const despues = cambios.real_total != null ? Number(cambios.real_total) : antes

      const aviso = sustituye && !cambios.real_modelo
        ? 'Sustituye el producto y no mando modelo nuevo. Al imprimir, el modelo saldra EN BLANCO a proposito: ' +
          'el viejo es de otro producto y mandarselo al proveedor hace que compre lo que no es. Preguntelo.'
        : undefined

      if (!args?.confirmar) {
        return texto({
          cotejado: false,
          partida: (it as any).name,
          original: { cantidad: (it as any).quantity, costo_unitario: (it as any).unit_cost, total: antes },
          quedaria: {
            nombre: cambios.real_name || (it as any).name,
            cantidad: cambios.real_quantity ?? (it as any).quantity,
            costo_unitario: cambios.real_unit_cost ?? (it as any).unit_cost,
            total: despues,
          },
          diferencia: centavos(despues - antes),
          aviso,
          para_ejecutar: 'repita con confirmar=true',
        })
      }

      const { data, error } = await sb.from('po_items').update(cambios).eq('id', id)
        .select('id,name,real_name,real_quantity,real_unit_cost,real_total,cotejo_status').single()
      if (error) return texto({ cotejado: false, error: error.message })
      return texto({ cotejado: true, partida: data, diferencia: centavos(despues - antes), aviso })
    }

    case 'aprobar_orden_compra': {
      const oc = await ordenDe(sb, String(args?.orden || ''))
      if (!oc) return texto({ error: 'No encontre esa orden.' })
      const ocId = (oc as any).id
      const { data: items } = await sb.from('po_items').select('*')
        .eq('purchase_order_id', ocId).order('order_index').limit(TOPE)
      const lista = items || []
      if (!lista.length) return texto({ error: 'Esa orden no tiene partidas.' })

      // Como quedaria cada renglon despues de volcar el cotejo, y el total que
      // de ahi sale. Los dos tienen que cuadrar: una orden cuyos renglones no
      // suman su total es la que se firmo y se mando 23 veces.
      const resueltos = lista.map((it: any) => {
        const f = camposCotejados(it)
        return {
          id: it.id,
          nombre: (f.name as string) ?? it.name,
          modelo: f.modelo !== undefined ? f.modelo : it.modelo,
          cantidad: (f.quantity as number) ?? it.quantity,
          costo_unitario: (f.unit_cost as number) ?? it.unit_cost,
          total: centavos((f.total as number) ?? it.total ?? 0),
          sustituido: !!it.real_name,
          campos: f,
        }
      })
      const subtotal = centavos(resueltos.reduce((s, r) => s + r.total, 0))
      const iva = ivaDeOrden(subtotal, (oc as any).tipo)
      const total = centavos(subtotal + iva)

      if (!args?.confirmar) {
        return texto({
          aprobada: false,
          revise_antes: 'Aprobar es decir "comprala asi". Lo cotejado se vuelve definitivo y asi se imprime.',
          folio: (oc as any).folio || (oc as any).po_number,
          estado_actual: (oc as any).status,
          moneda: (oc as any).currency, tipo: (oc as any).tipo,
          totales_ahora: { subtotal: (oc as any).subtotal, iva: (oc as any).iva, total: (oc as any).total },
          totales_quedarian: { subtotal, iva, total },
          renglones: resueltos.map(({ campos, ...r }) => r),
          sustituciones: resueltos.filter(r => r.sustituido).length,
          para_ejecutar: 'repita con confirmar=true',
        })
      }

      for (const r of resueltos) {
        if (Object.keys(r.campos).length) await sb.from('po_items').update(r.campos).eq('id', r.id)
      }
      const { data, error } = await sb.from('purchase_orders')
        .update({ status: 'aprobada', approved_at: new Date().toISOString(), subtotal, iva, total })
        .eq('id', ocId).select('id,folio,status,subtotal,iva,total,currency,tipo').single()
      if (error) return texto({ aprobada: false, error: error.message })
      return texto({
        aprobada: true, orden: data,
        renglones_volcados: resueltos.filter(r => Object.keys(r.campos).length).length,
        liga: `https://omm-erp.vercel.app/compras`,
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    // Puerto de "Generar en bloque" de Compras.tsx. Mismos criterios, mismo
    // orden de decisiones. Cualquier cambio alla tiene que llegar aqui, o el
    // boton y el modelo empezarian a comprar cosas distintas.
    case 'generar_ordenes_de_cotizacion': {
      const ref = String(args?.cotizacion || '').trim()
      const qb = sb.from('quotations').select('id,folio,name,specialty,notes,project_id,stage').limit(1)
      const { data: cs } = esUuid(ref) ? await qb.eq('id', ref) : await qb.ilike('folio', ref)
      const cot: any = cs?.[0]
      if (!cot) return texto({ error: 'No encontre esa cotizacion.' })

      const notas = jsonDe(cot.notes)
      const leadId = notas?.lead_id || null
      const esDist = cot.specialty === 'dist'

      // Distribucion guarda sus renglones SIN area y sin type='material': por
      // eso se leen distinto. Es la excepcion documentada de la regla de
      // monedas, donde el costo ya viene pactado en la moneda de la cotizacion.
      let items: any[] = []
      if (esDist) {
        const { data } = await sb.from('quotation_items').select('*')
          .eq('quotation_id', cot.id).order('order_index').limit(TOPE)
        items = data || []
      } else {
        const { data: areas } = await sb.from('quotation_areas').select('id').eq('quotation_id', cot.id)
        const areaIds = (areas || []).map((a: any) => a.id)
        if (!areaIds.length) return texto({ error: 'Esa cotizacion no tiene areas con partidas.' })
        const { data } = await sb.from('quotation_items').select('*')
          .in('area_id', areaIds).eq('type', 'material').order('order_index').limit(TOPE)
        items = data || []
      }
      const antes = items.length
      items = soloVendidos(items, notas)
      const omitidosApagados = antes - items.length
      if (!items.length) return texto({ error: 'No hay partidas de material vendidas en esa cotizacion.' })

      // El CATALOGO manda en proveedor, moneda y costo. El renglon de la
      // cotizacion trae el precio de VENTA; comprar a ese precio seria pagarle
      // al proveedor nuestro margen.
      const catIds = [...new Set(items.map(i => i.catalog_product_id).filter(Boolean))]
      const cat = new Map<string, any>()
      if (catIds.length) {
        const { data: cps } = await sb.from('catalog_products')
          .select('id,provider,supplier_id,moneda,cost,unit').in('id', catIds)
        for (const c of cps || []) cat.set((c as any).id, c)
      }

      const monedaDist = String(notas?.currency || 'USD').toUpperCase()

      // Lo ya pedido en ordenes anteriores de esta cotizacion NO se vuelve a
      // pedir: si no, cada corrida duplica la compra.
      const { data: posPrev } = await sb.from('purchase_orders')
        .select('id,status,folio').eq('quotation_id', cot.id)
      const poIds = (posPrev || []).filter((o: any) => o.status !== 'cancelada').map((o: any) => o.id)
      const yaPedido = new Map<string, number>()
      if (poIds.length) {
        const { data: prev } = await sb.from('po_items')
          .select('catalog_product_id,name,quantity').in('purchase_order_id', poIds).limit(1000)
        for (const pi of prev || []) {
          const k = (pi as any).catalog_product_id || (pi as any).name
          yaPedido.set(k, (yaPedido.get(k) || 0) + (Number((pi as any).quantity) || 0))
        }
      }

      // Consolidar el mismo producto repetido en varias areas.
      const consol = new Map<string, any>()
      for (const it of items) {
        const c = it.catalog_product_id ? cat.get(it.catalog_product_id) : null
        const costo = esDist ? (Number(it.cost) || 0) : (Number(c?.cost) || Number(it.cost) || 0)
        const moneda = esDist ? monedaDist
          : String(c?.moneda || it.provider_currency || 'MXN').toUpperCase()
        const k = it.catalog_product_id || it.name
        const prev = consol.get(k)
        if (prev) { prev.cantidad += Number(it.quantity) || 0; continue }
        consol.set(k, {
          key: k,
          catalog_product_id: it.catalog_product_id || null,
          name: it.name, description: it.description || null,
          marca: it.marca || null, modelo: it.modelo || null, system: it.system || null,
          unit: c?.unit || 'pza',
          purchase_phase: it.purchase_phase || 'inicio',
          cantidad: Number(it.quantity) || 0,
          costo, moneda,
          supplierId: c?.supplier_id || it.supplier_id || null,
          proveedor: c?.provider || it.provider || (esDist ? it.marca : '') || '',
        })
      }

      let cerrados = 0
      const pendientes: any[] = []
      for (const it of consol.values()) {
        const falta = centavos(it.cantidad - (yaPedido.get(it.key) || 0))
        if (falta <= 0) { cerrados++; continue }
        pendientes.push({ ...it, cantidad: falta })
      }

      // Sin distribuidor no hay a quien comprarle: se aparta y se dice cual.
      const sinProveedor = pendientes.filter(i => !i.supplierId)
      const conProveedor = pendientes.filter(i => i.supplierId)
      if (!conProveedor.length) {
        return texto({
          creadas: false,
          error: 'Ninguna partida pendiente tiene distribuidor asignado en el catalogo, asi que no hay a quien comprarle.',
          sin_distribuidor: sinProveedor.map(i => ({ producto: i.name, modelo: i.modelo, cantidad: i.cantidad })),
          ya_cubiertas: cerrados,
        })
      }

      const provIds = [...new Set(conProveedor.map(i => i.supplierId))]
      const { data: provs } = await sb.from('suppliers').select('id,name').in('id', provIds)
      const nombreProv = new Map((provs || []).map((p: any) => [p.id, p.name]))

      // ── Agrupar: PROVEEDOR x MONEDA ──────────────────────────────────────
      const mapa = new Map<string, any>()
      for (const it of conProveedor) {
        const k = `${it.supplierId}__${it.moneda}`
        const g = mapa.get(k)
        if (g) {
          g.items.push(it); g.subtotal = centavos(g.subtotal + it.costo * it.cantidad)
          if (!g.fases.includes(it.purchase_phase)) g.fases.push(it.purchase_phase)
        } else {
          mapa.set(k, {
            key: k, supplier_id: it.supplierId, moneda: it.moneda,
            proveedor: nombreProv.get(it.supplierId) || it.proveedor || 'Proveedor',
            fases: [it.purchase_phase], items: [it],
            subtotal: centavos(it.costo * it.cantidad),
          })
        }
      }
      let grupos = [...mapa.values()].sort((a, b) =>
        String(a.proveedor).localeCompare(String(b.proveedor)) || a.moneda.localeCompare(b.moneda))

      if (Array.isArray(args?.proveedores) && args.proveedores.length) {
        const quiere = args.proveedores.map((x: any) => String(x).toLowerCase().trim())
        grupos = grupos.filter(g =>
          quiere.includes(String(g.supplier_id).toLowerCase()) ||
          quiere.some((q: string) => String(g.proveedor).toLowerCase().includes(q)))
        if (!grupos.length) return texto({ error: 'Ninguno de esos proveedores sale en el plan de compra de esta cotizacion.' })
      }

      // La fase de la orden es la MAS TEMPRANA del grupo: si algo de ese
      // proveedor se necesita en Inicio, la orden no puede esperar a Cierre.
      for (const g of grupos) {
        g.fases.sort((x: string, y: string) => (ORDEN_FASE[x] ?? 9) - (ORDEN_FASE[y] ?? 9))
        g.fase = g.fases[0] || 'inicio'
        g.iva = ivaDeOrden(g.subtotal, 'material')
        g.total = centavos(g.subtotal + g.iva)
      }

      const resumen = {
        cotizacion: cot.folio, nombre: cot.name, especialidad: cot.specialty,
        partidas_vendidas: items.length,
        omitidas_por_sistema_apagado: omitidosApagados || undefined,
        ya_cubiertas_por_ordenes_previas: cerrados || undefined,
        ordenes_previas: poIds.length || undefined,
        sin_distribuidor: sinProveedor.length
          ? sinProveedor.map(i => ({ producto: i.name, modelo: i.modelo, cantidad: i.cantidad }))
          : undefined,
        ordenes: grupos.map(g => ({
          proveedor: g.proveedor, moneda: g.moneda, fase: g.fase,
          partidas: g.items.length,
          subtotal: g.subtotal, iva: g.iva, total: g.total,
          renglones: g.items.map((i: any) => ({
            producto: i.name, modelo: i.modelo, cantidad: i.cantidad,
            costo_unitario: i.costo, importe: centavos(i.costo * i.cantidad),
          })),
        })),
      }

      if (!args?.confirmar) {
        return texto({
          creadas: false, vista_previa: true, ...resumen,
          por_que_varias: grupos.length > 1
            ? 'Una orden nunca mezcla monedas ni proveedores: salen ' + grupos.length + ' documentos.'
            : undefined,
          folios: 'los asigna la base con la clave de la cotizacion (ej. ' + cot.folio + '-C01)',
          para_ejecutar: 'repita con confirmar=true, y mande clave_idempotencia para que un reintento no duplique la compra.',
        })
      }

      const { data, error } = await sb.rpc('omm_mcp_oc_desde_cotizacion', {
        p: {
          idem: args?.clave_idempotencia || null,
          lead_id: leadId, quotation_id: cot.id, project_id: cot.project_id || null,
          specialty: cot.specialty || 'esp',
          grupos: grupos.map(g => ({
            supplier_id: g.supplier_id, moneda: g.moneda, fase: g.fase,
            subtotal: g.subtotal, iva: g.iva, total: g.total,
            notes: `Generada desde el MCP | ${cot.name || ''} | ${g.proveedor} | ${g.moneda}`,
            items: g.items.map((i: any) => ({
              catalog_product_id: i.catalog_product_id, name: i.name, description: i.description,
              system: i.system, marca: i.marca, modelo: i.modelo, unit: i.unit,
              quantity: i.cantidad, unit_cost: i.costo, total: centavos(i.costo * i.cantidad),
              purchase_phase: i.purchase_phase,
            })),
          })),
        },
      })
      if (error) return texto({ creadas: false, error: error.message })
      const r: any = data
      return texto({
        creadas: !r.reusada,
        ...(r.reusada ? { nota: 'Ya se habia corrido con esa clave de idempotencia. No se crearon otras; estas son las que hay.' } : {}),
        cotizacion: cot.folio,
        ordenes: r.ordenes,
        liga: `${ERP}/compras`,
        estado: 'Todas quedan en BORRADOR. No se le mando nada a ningun proveedor.',
        siguiente: 'Coteje los costos contra el Quote del proveedor con cotejar_orden, y despues apruebe con aprobar_orden_compra.',
        sin_distribuidor: resumen.sin_distribuidor,
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    case 'cotejar_orden': {
      const oc: any = await ordenDe(sb, String(args?.orden || ''))
      if (!oc) return texto({ error: 'No encontre esa orden.' })
      const lineas: any[] = Array.isArray(args?.lineas) ? args.lineas : []
      if (!lineas.length) return texto({ error: 'No me mando ningun renglon del Quote.' })

      const { data: parts } = await sb.from('po_items').select('*')
        .eq('purchase_order_id', oc.id).order('order_index').limit(TOPE)
      const partidas = parts || []
      if (!partidas.length) return texto({ error: 'Esa orden no tiene partidas.' })

      const norm = (t: any) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const usadas = new Set<string>()

      /** Empareja un renglon del Quote con UNA partida. Por id, luego por
       *  modelo exacto, luego por nombre. Lo que empate con dos o con ninguna
       *  se reporta: cotejar el renglon equivocado cambia el precio de un
       *  producto que no era, y eso se compra. */
      function emparejar(l: any) {
        if (l.partida) {
          const p = partidas.find((x: any) => x.id === String(l.partida))
          return p ? { p } : { motivo: `la partida ${l.partida} no es de esta orden` }
        }
        const claves = [l.modelo, l.nombre].filter(Boolean).map(norm).filter(Boolean)
        if (!claves.length) return { motivo: 'el renglon no trae partida, modelo ni nombre' }
        for (const k of claves) {
          const exactos = partidas.filter((x: any) =>
            !usadas.has(x.id) && (norm(x.modelo) === k || norm(x.name) === k))
          if (exactos.length === 1) return { p: exactos[0] }
          if (exactos.length > 1) return { motivo: `"${l.modelo || l.nombre}" empata con ${exactos.length} partidas de la orden` }
        }
        for (const k of claves) {
          const parciales = partidas.filter((x: any) =>
            !usadas.has(x.id) && (norm(x.modelo).includes(k) || norm(x.name).includes(k)))
          if (parciales.length === 1) return { p: parciales[0] }
          if (parciales.length > 1) return { motivo: `"${l.modelo || l.nombre}" empata con ${parciales.length} partidas de la orden` }
        }
        return { motivo: `"${l.modelo || l.nombre}" no empata con ninguna partida de la orden` }
      }

      const cambios: any[] = []
      const sinEmparejar: any[] = []
      const avisos: string[] = []

      for (const l of lineas) {
        const m = emparejar(l)
        if (!(m as any).p) { sinEmparejar.push({ renglon: l.modelo || l.nombre || l.partida || '(sin referencia)', motivo: (m as any).motivo }); continue }
        const p: any = (m as any).p
        usadas.add(p.id)

        const cant = l.cantidad != null ? Number(l.cantidad) : Number(p.quantity || 0)
        const cu = l.costo_unitario != null ? centavos(l.costo_unitario) : Number(p.unit_cost || 0)
        const sustituye = !!l.nombre_real
        const campos: Record<string, unknown> = {
          real_quantity: cant, real_unit_cost: cu, real_total: centavos(cant * cu),
          cotejo_status: sustituye ? 'sustituido' : 'cotejado',
        }
        if (sustituye) {
          campos.real_name = String(l.nombre_real)
          // Ver la regla 3 del encabezado: el modelo viejo es de OTRO producto.
          if (!l.modelo_real) {
            campos.real_modelo = null
            avisos.push(`"${p.name}" se sustituye por "${l.nombre_real}" y no mando modelo nuevo. Al imprimir saldra EN BLANCO a proposito: el viejo es de otro producto y mandarselo al proveedor hace que compre lo que no es. Preguntelo.`)
          }
        }
        if (l.marca_real) campos.real_marca = String(l.marca_real)
        if (l.modelo_real) campos.real_modelo = String(l.modelo_real)

        const antesT = centavos(p.total || 0)
        cambios.push({
          id: p.id, campos,
          vista: {
            partida: p.name, modelo: p.modelo,
            antes: { cantidad: Number(p.quantity), costo_unitario: Number(p.unit_cost), importe: antesT },
            quote: { nombre: l.nombre_real || undefined, cantidad: cant, costo_unitario: cu, importe: centavos(cant * cu) },
            diferencia: centavos(centavos(cant * cu) - antesT),
          },
        })
      }

      if (!cambios.length) {
        return texto({ cotejado: false, error: 'Ningun renglon del Quote empato con una partida de la orden.', sin_emparejar: sinEmparejar })
      }

      // El total cotejado incluye las partidas que NO venian en el Quote, con
      // su costo original: una orden parcialmente cotejada sigue siendo una
      // orden completa.
      const porId = new Map(cambios.map(c => [c.id, c]))
      const subtotal = centavos(partidas.reduce((s: number, p: any) => {
        const c = porId.get(p.id)
        return s + (c ? (c.campos.real_total as number) : Number(p.total || 0))
      }, 0))
      const iva = ivaDeOrden(subtotal, oc.tipo)
      const total = centavos(subtotal + iva)
      const sinCotejar = partidas.filter((p: any) => !porId.has(p.id) && !estaCotejado(p))

      if (!args?.confirmar) {
        return texto({
          cotejado: false, vista_previa: true,
          orden: oc.folio || oc.po_number, moneda: oc.currency,
          empatan: cambios.length, de: partidas.length,
          renglones: cambios.map(c => c.vista),
          sin_emparejar: sinEmparejar.length ? sinEmparejar : undefined,
          partidas_que_el_quote_no_menciona: sinCotejar.length
            ? sinCotejar.map((p: any) => ({ partida: p.name, modelo: p.modelo, importe: Number(p.total) }))
            : undefined,
          totales: {
            antes: { subtotal: centavos(oc.subtotal), iva: centavos(oc.iva), total: centavos(oc.total) },
            cotejado: { subtotal, iva, total },
            diferencia: centavos(total - centavos(oc.total)),
          },
          avisos: avisos.length ? avisos : undefined,
          nota: 'Esto NO pisa lo original: el cotejo se guarda al lado, en las columnas real_*. Los importes definitivos se vuelcan al aprobar la orden.',
          para_ejecutar: 'repita con confirmar=true',
        })
      }

      let escritas = 0
      for (const c of cambios) {
        const { error } = await sb.from('po_items').update(c.campos).eq('id', c.id).eq('purchase_order_id', oc.id)
        if (error) return texto({ cotejado: 'a medias', escritas, error: `Fallo en "${c.vista.partida}": ${error.message}` })
        escritas++
      }
      const { error: eTot } = await sb.from('purchase_orders')
        .update({ subtotal, iva, total }).eq('id', oc.id)
      if (eTot) return texto({ cotejado: true, escritas, error: 'Las partidas quedaron cotejadas pero no pude actualizar el total de la orden: ' + eTot.message })

      return texto({
        cotejado: true,
        orden: oc.folio || oc.po_number, moneda: oc.currency,
        partidas_cotejadas: escritas, de: partidas.length,
        sin_emparejar: sinEmparejar.length ? sinEmparejar : undefined,
        partidas_que_el_quote_no_menciona: sinCotejar.length
          ? sinCotejar.map((p: any) => ({ partida: p.name, modelo: p.modelo, importe: Number(p.total) }))
          : undefined,
        totales: { subtotal, iva, total },
        diferencia_contra_lo_que_decia: centavos(total - centavos(oc.total)),
        avisos: avisos.length ? avisos : undefined,
        siguiente: 'aprobar_orden_compra vuelca el cotejo a los campos definitivos. Hasta entonces los renglones conservan el costo de catalogo.',
        compruebelo: `ver_orden_compra con "${oc.folio || oc.po_number}"`,
      })
    }

    case 'exportar_orden_compra': {
      const oc = await ordenDe(sb, String(args?.orden || ''))
      if (!oc) return texto({ error: 'No encontre esa orden.' })
      const ocId = (oc as any).id
      const { data: items } = await sb.from('po_items').select('*').eq('purchase_order_id', ocId).limit(TOPE)
      const lista = items || []
      const resueltos = lista.map((it: any) => {
        const f = camposCotejados(it)
        return centavos((f.total as number) ?? it.total ?? 0)
      })
      const sumaRenglones = centavos(resueltos.reduce((s, n) => s + n, 0))
      const cabecera = centavos(Number((oc as any).subtotal || 0))
      const descuadre = centavos(sumaRenglones - cabecera)

      const avisos: string[] = []
      if (Math.abs(descuadre) > 0.01) {
        avisos.push(
          `Los renglones suman ${sumaRenglones} y el encabezado dice ${cabecera} (diferencia ${descuadre}). ` +
          `Apruebe la orden para volcar el cotejo antes de mandarla: asi se firmaron 23 ordenes que no cuadraban consigo mismas.`)
      }
      const sinCotejar = lista.filter((it: any) => !estaCotejado(it)).length
      if (sinCotejar && (oc as any).tipo !== 'servicio') {
        avisos.push(`${sinCotejar} de ${lista.length} partidas sin cotejar.`)
      }

      return texto({
        orden: { folio: (oc as any).folio || (oc as any).po_number, estado: (oc as any).status, moneda: (oc as any).currency, total: (oc as any).total },
        liga: 'https://omm-erp.vercel.app/compras',
        como_bajarla: 'Abra Compras, busque el folio y use el boton de PDF. El archivo todavia se genera en el navegador; no lo puedo adjuntar aqui.',
        avisos: avisos.length ? avisos : ['Sin pendientes: los renglones cuadran con el encabezado.'],
      })
    }

    default:
      return texto({ error: `Herramienta desconocida: ${nombre}` })
  }
}
