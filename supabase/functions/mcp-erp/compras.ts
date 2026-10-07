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

export const DEFINICIONES_COM = [
  {
    name: 'crear_orden_compra',
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
    name: 'exportar_orden_compra',
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
