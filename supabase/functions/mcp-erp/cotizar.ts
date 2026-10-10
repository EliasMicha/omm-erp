// ═══════════════════════════════════════════════════════════════════════════
//  Bloque 6 — cotizar: crear, editar y exportar cotizaciones desde el MCP.
//
//  Hasta aqui el modelo podia LEER cotizaciones y nada mas. Escribir una es
//  otra cosa: una cotizacion es el documento con el que se cierra un trato, y
//  hay cuatro reglas de este ERP que al escribirla NO se pueden romper.
//
//  ── 1. EL CATALOGO NO SE ENSUCIA ──────────────────────────────────────────
//  `trg_sync_quotation_item_to_catalog` corre BEFORE INSERT sobre
//  quotation_items: si la partida llega SIN catalog_product_id, busca por
//  (nombre, proveedor) y, si no empata, **da de alta un producto nuevo en el
//  catalogo** con 'pza' y 'USD' quemados. Asi se colaron 123 productos basura
//  en un solo dia.
//
//  Por eso aqui una partida se da por ID de catalogo o por bundle, nunca por
//  texto libre. Un nombre suelto no crea producto: se rechaza y se dice que
//  falta el id. Escribir en el catalogo es una decision de catalogo, no un
//  efecto colateral de cotizar.
//
//  ── 2. NI CONVERSIONES NI CARGOS IMPLICITOS ───────────────────────────────
//  · El costo va en la moneda del catalogo (provider_currency) y el precio en
//    la de la cotizacion. En la misma fila, en monedas distintas, a proposito.
//  · Si el costo esta en otra moneda que la cotizacion y no dieron precio
//    explicito, NO se inventa un tipo de cambio: se pide el precio. Un TC
//    inventado es el error de 18x que este ERP ya pago.
//  · `installation_cost` arranca en CERO. El editor propone 25% del precio
//    como instalacion para casi toda marca; aplicarlo aqui le agregaria al
//    cliente un cargo que nadie pidio.
//  · descuento 0, programacion 0, viaticos apagados. Un borrador nuevo no
//    hereda las condiciones de otro trato.
//
//  ── 3. EL TOTAL SE GUARDA DOS VECES Y TIENE QUE SER EL MISMO ──────────────
//  `update_quotation_total()` deja `quotations.total` = suma de renglones.
//  Pero el editor pisa esa columna con el total **CON IVA**. Si se inserta y
//  no se corrige, la misma cotizacion dice 1,554.68 en la lista y 1,803.43 en
//  el editor. Es el defecto de las dos verdades que ya costo 23 ordenes de
//  compra firmadas sin cuadrar consigo mismas. El RPC lo pisa al final.
//
//  ── 4. LAS PARTIDAS TIENEN QUE VERSE (y son DOS condiciones) ──────────────
//  a) El editor solo dibuja los sistemas que esten en `notes.systems`. Una
//     partida de un sistema que no este listado queda INVISIBLE en pantalla
//     aunque sume en el total. Por eso `systems` se deriva de los productos
//     que de verdad se metieron, no se recibe como parametro.
//  b) Y los renglones se dibujan DENTRO de un area:
//         products.filter(p => p.areaId === area.id)
//     asi que una partida con area_id NULL tampoco se ve — y SI suma. Toda
//     cotizacion nace con al menos un area ('General') y toda partida cuelga
//     de una. Esto se me fue en la primera version: la cotizacion ensenaba el
//     total y ni un renglon.
//
//  ── Y una de forma ────────────────────────────────────────────────────────
//  Un SKU ambiguo NO se resuelve adivinando. CW-1-WH son dos productos
//  distintos en el catalogo ($3.52 al 35% y $3.00 al 40%): se devuelven los
//  candidatos para que la persona escoja, igual que con los proveedores
//  homonimos en crear_orden_compra.
// ═══════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Quien } from './tools.ts'

const TOPE = 300
const texto = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] })
const esUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''))
const centavos = (n: any) => Math.round((Number(n) || 0) * 100) / 100
const ERP = 'https://omm-erp.vercel.app'

const ESPECIALIDADES = ['esp', 'elec', 'ilum', 'cort', 'proy', 'dist']

/** Copia de SYSTEM_DB_NAME de CotEditorESP, invertida: valor del enum de la
 *  base → id del sistema que usa el editor. Si alla cambia, aqui tambien:
 *  un id que no empate deja la partida invisible en pantalla (regla 4). */
const SISTEMA_A_ID: Record<string, string> = {
  'audio': 'audio',
  'redes': 'redes',
  'cctv': 'cctv',
  'control de acceso': 'control_acceso',
  'acceso': 'control_acceso',
  'control de iluminacion': 'control_iluminacion',
  'iluminacion': 'control_iluminacion',
  'humo': 'deteccion_humo',
  'bms': 'bms',
  'telefonia': 'telefonia',
  'celular': 'red_celular',
  'lutron': 'lutron',
  'somfy': 'somfy',
  'electrico': 'electrico',
  'cortinas': 'cortinas',
  'general': 'general',
}
const idDeSistema = (s?: string | null) =>
  SISTEMA_A_ID[String(s || '').toLowerCase()] || String(s || 'general').toLowerCase().replace(/ /g, '_')

/** El precio de venta que el ERP deriva de un producto del catalogo.
 *
 *  `markup` es MARGEN SOBRE EL PRECIO, no recargo sobre el costo:
 *  precio = costo / (1 - margen/100). Comprobado contra la base: 217 de 907
 *  renglones empatan con esta formula y CERO con costo*(1+margen). */
const precioDeCatalogo = (costo: number, margen: number) => centavos(costo / (1 - margen / 100))

async function leadDe(sb: SupabaseClient, ref: string) {
  const r = String(ref || '').trim()
  const q = sb.from('leads').select('id,name,codigo,company').limit(1)
  const { data } = esUuid(r) ? await q.eq('id', r) : await q.ilike('codigo', r)
  return data?.[0] || null
}

async function cotizacionDe(sb: SupabaseClient, ref: string) {
  const r = String(ref || '').trim()
  const q = sb.from('quotations').select('*').limit(1)
  const { data } = esUuid(r) ? await q.eq('id', r) : await q.ilike('folio', r)
  return data?.[0] || null
}

const CAMPOS_PROD = 'id,name,description,marca,modelo,sku,provider,system,specialty,cost,moneda,markup,supplier_id,image_url,unit,is_active'

/** Encuentra UN producto del catalogo, o devuelve los candidatos.
 *  Nunca escoge por el usuario: ver el caso CW-1-WH en el encabezado. */
async function resolverProducto(sb: SupabaseClient, ref: string) {
  const r = String(ref || '').trim()
  if (!r) return { error: 'Partida sin producto: falta catalogo_id o sku.' }
  if (esUuid(r)) {
    const { data } = await sb.from('catalog_products').select(CAMPOS_PROD).eq('id', r).maybeSingle()
    if (!data) return { error: `No existe un producto de catalogo con id ${r}.` }
    return { producto: data }
  }
  const { data } = await sb.from('catalog_products').select(CAMPOS_PROD)
    .or(`sku.ilike.${r},modelo.ilike.${r}`).eq('is_active', true).limit(10)
  const lista = data || []
  if (!lista.length) return { error: `No encontre en el catalogo ningun producto con SKU o modelo "${r}".` }
  if (lista.length > 1) {
    return {
      ambiguo: {
        buscado: r,
        motivo: `Hay ${lista.length} productos distintos con ese SKU o modelo. No escojo por usted: el precio y el costo cambian segun cual sea.`,
        candidatos: lista.map((p: any) => ({
          catalogo_id: p.id, nombre: p.name, marca: p.marca, modelo: p.modelo, sku: p.sku,
          costo: Number(p.cost), moneda_costo: p.moneda, margen: Number(p.markup),
          precio_derivado: Number(p.markup) > 0 && Number(p.markup) < 100 ? precioDeCatalogo(Number(p.cost), Number(p.markup)) : null,
          proveedor: p.provider,
        })),
        que_hacer: 'Repita la partida con catalogo_id en vez de sku.',
      },
    }
  }
  return { producto: lista[0] }
}

/** Convierte un producto de catalogo + cantidad + precio en un renglon listo
 *  para quotation_items. Devuelve el aviso cuando el precio explicito se
 *  aparta del que da el catalogo: no es un error, pero hay que verlo. */
function renglonDe(
  p: any, cantidad: number, monedaCot: string,
  precioExplicito: number | null, manoObra: number,
  extra: Record<string, unknown> = {},
) {
  const costo = Number(p.cost) || 0
  const margen = Number(p.markup) || 0
  const monedaCosto = String(p.moneda || 'USD').toUpperCase()
  const derivable = costo > 0 && margen > 0 && margen < 100
  const derivado = derivable ? precioDeCatalogo(costo, margen) : null

  let precio: number
  let origen: string
  if (precioExplicito != null) {
    precio = centavos(precioExplicito)
    origen = 'explicito'
  } else if (monedaCosto !== monedaCot) {
    return {
      error: `"${p.name}" tiene el costo en ${monedaCosto} y la cotizacion va en ${monedaCot}. ` +
        `Para derivar el precio habria que inventar un tipo de cambio. Mande precio_unitario.`,
    }
  } else if (derivado != null) {
    precio = derivado
    origen = `catalogo (costo ${costo} ${monedaCosto} con ${margen}% de margen)`
  } else {
    return {
      error: `"${p.name}" no tiene costo y margen utilizables en el catalogo (costo ${costo}, margen ${margen}). ` +
        `Mande precio_unitario.`,
    }
  }

  const aviso = (precioExplicito != null && derivado != null && Math.abs(precio - derivado) > 0.005)
    ? `"${p.name}": el precio que dio es ${precio} y el catalogo daria ${derivado} (costo ${costo} ${monedaCosto} al ${margen}%). Se respeta el suyo.`
    : null

  return {
    renglon: {
      catalog_product_id: p.id,
      name: p.name,
      description: p.description || null,
      system: p.system || null,
      type: 'material',
      provider: p.provider || null,
      marca: p.marca || null,
      modelo: p.modelo || null,
      sku: p.sku || null,
      quantity: cantidad,
      cost: costo,
      provider_currency: monedaCosto,   // la del CATALOGO, nunca la de la cotizacion
      markup: margen,
      price: precio,
      total: centavos(cantidad * precio),
      installation_cost: centavos(manoObra),
      supplier_id: p.supplier_id || null,
      image_url: p.image_url || null,
      purchase_phase: 'inicio',
      ...extra,
    },
    aviso,
    origen_precio: origen,
  }
}

/** Expande las partidas que pide el modelo en renglones de quotation_items.
 *  Un bundle se guarda EXPLOTADO —un renglon por componente, atados por
 *  bundle_instance_id— y sin renglon de cabecera: la cabecera se dibuja en
 *  pantalla. Un renglon extra por el paquete seria cobrarlo dos veces.
 *  Invariante: quantity = bundle_unit_qty * bundle_qty. */
async function armarRenglones(sb: SupabaseClient, partidas: any[], monedaCot: string) {
  const renglones: any[] = []
  const avisos: string[] = []
  const detalle: any[] = []

  for (let i = 0; i < partidas.length; i++) {
    const it = partidas[i] || {}
    const cantidad = Number(it.cantidad)
    if (!(cantidad > 0)) return { error: `Partida ${i + 1}: la cantidad tiene que ser mayor que cero.` }

    // ── Bundle ─────────────────────────────────────────────────────────────
    if (it.bundle_id) {
      if (!esUuid(String(it.bundle_id))) return { error: `Partida ${i + 1}: bundle_id no es un id valido.` }
      const { data: bundle } = await sb.from('catalog_bundles').select('id,name,specialty,system,is_active')
        .eq('id', it.bundle_id).maybeSingle()
      if (!bundle) return { error: `Partida ${i + 1}: no existe ese bundle.` }

      const { data: comps } = await sb.from('catalog_bundle_items')
        .select(`quantity, producto:catalog_products(${CAMPOS_PROD})`).eq('bundle_id', it.bundle_id)
      if (!comps?.length) return { error: `Partida ${i + 1}: el bundle "${(bundle as any).name}" no tiene componentes.` }

      // Una instancia = un juego de componentes atados. Si piden 5 paquetes,
      // es UNA instancia con bundle_qty=5, no cinco instancias: asi el editor
      // la dibuja como un solo renglon desplegable y cambiar la cantidad
      // recalcula desde bundle_unit_qty sin dividir (sin deriva por redondeo).
      const instancia = crypto.randomUUID()
      const preciosExtra: Record<string, number> = {}
      for (const pr of (Array.isArray(it.precios_componentes) ? it.precios_componentes : [])) {
        if (pr?.catalogo_id) preciosExtra[String(pr.catalogo_id)] = Number(pr.precio_unitario)
      }

      const delBundle: any[] = []
      for (const c of comps) {
        const p: any = (c as any).producto
        if (!p) return { error: `Partida ${i + 1}: un componente del bundle ya no existe en el catalogo.` }
        const uq = Number((c as any).quantity) || 0
        const r = renglonDe(p, centavos(uq * cantidad), monedaCot,
          preciosExtra[p.id] != null ? preciosExtra[p.id] : null, 0, {
            bundle_id: (bundle as any).id,
            bundle_instance_id: instancia,
            bundle_qty: cantidad,
            bundle_unit_qty: uq,
          })
        if ((r as any).error) return { error: `Partida ${i + 1} (componente del bundle): ${(r as any).error}` }
        if ((r as any).aviso) avisos.push((r as any).aviso)
        delBundle.push((r as any).renglon)
      }

      // Articulos adicionales DENTRO del paquete: se pegan a la misma
      // instancia para que viajen con el, pero son renglones propios.
      for (const ex of (Array.isArray(it.articulos_extra) ? it.articulos_extra : [])) {
        const res = await resolverProducto(sb, String(ex.catalogo_id || ex.sku || ''))
        if ((res as any).error) return { error: `Partida ${i + 1} (articulo extra): ${(res as any).error}` }
        if ((res as any).ambiguo) return { ambiguo: (res as any).ambiguo }
        const cex = Number(ex.cantidad)
        if (!(cex > 0)) return { error: `Partida ${i + 1}: un articulo extra viene sin cantidad.` }
        const r = renglonDe((res as any).producto, centavos(cex * cantidad), monedaCot,
          ex.precio_unitario != null ? Number(ex.precio_unitario) : null, Number(ex.mano_obra_unitaria) || 0, {
            bundle_id: (bundle as any).id,
            bundle_instance_id: instancia,
            bundle_qty: cantidad,
            bundle_unit_qty: cex,
          })
        if ((r as any).error) return { error: `Partida ${i + 1} (articulo extra): ${(r as any).error}` }
        if ((r as any).aviso) avisos.push((r as any).aviso)
        delBundle.push((r as any).renglon)
      }

      const areaB = String(it.area || '').trim() || 'General'
      for (const r of delBundle) r.area = areaB
      const importe = centavos(delBundle.reduce((s, r) => s + r.total, 0))
      detalle.push({
        tipo: 'bundle', area: areaB,
        bundle: (bundle as any).name,
        paquetes: cantidad,
        precio_por_paquete: centavos(importe / cantidad),
        importe,
        componentes: delBundle.map(r => ({
          nombre: r.name, modelo: r.modelo,
          por_paquete: r.bundle_unit_qty, piezas: r.quantity,
          precio_unitario: r.price, importe: r.total,
        })),
        nota: 'Se guarda explotado: un renglon por componente, sin renglon de cabecera. No hay cargo duplicado.',
      })
      renglones.push(...delBundle)
      continue
    }

    // ── Producto suelto ────────────────────────────────────────────────────
    const ref = String(it.catalogo_id || it.sku || '')
    const res = await resolverProducto(sb, ref)
    if ((res as any).error) return { error: `Partida ${i + 1}: ${(res as any).error}` }
    if ((res as any).ambiguo) return { ambiguo: (res as any).ambiguo }

    const r = renglonDe((res as any).producto, cantidad, monedaCot,
      it.precio_unitario != null ? Number(it.precio_unitario) : null,
      Number(it.mano_obra_unitaria) || 0)
    if ((r as any).error) return { error: `Partida ${i + 1}: ${(r as any).error}` }
    if ((r as any).aviso) avisos.push((r as any).aviso)

    const rg = (r as any).renglon
    rg.area = String(it.area || '').trim() || 'General'
    detalle.push({
      tipo: 'producto', area: rg.area, nombre: rg.name, modelo: rg.modelo, sku: rg.sku,
      cantidad: rg.quantity, precio_unitario: rg.price, importe: rg.total,
      precio: (r as any).origen_precio,
      costo: rg.cost, moneda_costo: rg.provider_currency,
      mano_obra_unitaria: rg.installation_cost || 0,
    })
    renglones.push(rg)
  }

  return { renglones, avisos, detalle }
}

/** La formula de totales del editor, con descuento/viaticos/programacion en
 *  cero porque un borrador nuevo no hereda nada de otro trato. */
function totalesDe(renglones: any[], ivaPct: number, programacion = 0) {
  const equipo = centavos(renglones.reduce((s, r) => s + Number(r.total || 0), 0))
  const instalacion = centavos(renglones.reduce((s, r) => s + Number(r.installation_cost || 0) * Number(r.quantity || 0), 0))
  const subtotal = centavos(equipo + instalacion + programacion)
  const iva = centavos(subtotal * (ivaPct / 100))
  return { equipo, instalacion, programacion, subtotal, iva, total: centavos(subtotal + iva) }
}

export const DEFINICIONES_COT = [
  {
    name: 'crear_cotizacion',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description:
      'Crea una cotizacion en BORRADOR (etapa oportunidad) con sus partidas. SIN confirmar=true devuelve la ' +
      'vista previa con subtotal, IVA y total y NO escribe nada. ' +
      'Las partidas van por catalogo_id o por bundle_id, NUNCA por texto libre: una partida sin id da de alta ' +
      'un producto nuevo en el catalogo por un trigger de la base, y asi se colaron 123 productos basura en un dia. ' +
      'Si el SKU es ambiguo devuelve los candidatos en vez de escoger. ' +
      'Cada partida puede llevar su `area` (Cocina, Site, Recamara Principal...); si no la dan, todo cae en ' +
      '"General". Las areas se crean solas. ' +
      'No convierte monedas, no aplica descuentos ni instalacion que no le hayan pedido, y no hereda nada de ' +
      'otra cotizacion. Crear un borrador NO lo manda al cliente, NO lo pasa a contrato y NO genera compras.',
    inputSchema: {
      type: 'object',
      properties: {
        lead: { type: 'string', description: 'id del lead o su clave de 4 letras (ej. L303).' },
        especialidad: { type: 'string', enum: ESPECIALIDADES },
        nombre: { type: 'string', description: 'Como se va a llamar la cotizacion.' },
        moneda: { type: 'string', enum: ['MXN', 'USD'], description: 'La moneda de VENTA. El costo conserva la del catalogo.' },
        partidas: {
          type: 'array',
          description: 'Productos del catalogo o bundles. Cada una por id, con su cantidad.',
          items: {
            type: 'object',
            properties: {
              catalogo_id: { type: 'string', description: 'id del producto en catalog_products.' },
              sku: { type: 'string', description: 'SKU o modelo exacto. Si resulta ambiguo se devuelven los candidatos.' },
              bundle_id: { type: 'string', description: 'id del bundle. Se guarda explotado en sus componentes.' },
              cantidad: { type: 'number', description: 'Piezas; para un bundle, cuantos paquetes.' },
              area: { type: 'string', description: 'En que area del proyecto va (Cocina, Recamara Principal, Site...). Por defecto "General". El editor dibuja los renglones DENTRO de un area: una partida sin area no se ve en pantalla aunque sume.' },
              precio_unitario: { type: 'number', description: 'Precio de venta explicito. Si se omite se deriva del catalogo con su margen.' },
              mano_obra_unitaria: { type: 'number', description: 'Instalacion por pieza. Por defecto CERO: no se aplica el 25% del editor sin que lo pidan.' },
              precios_componentes: {
                type: 'array', description: 'Solo para bundles: precio explicito de algun componente.',
                items: { type: 'object', properties: { catalogo_id: { type: 'string' }, precio_unitario: { type: 'number' } } },
              },
              articulos_extra: {
                type: 'array', description: 'Solo para bundles: articulos adicionales que viajan con el paquete. La cantidad es POR PAQUETE.',
                items: {
                  type: 'object',
                  properties: {
                    catalogo_id: { type: 'string' }, sku: { type: 'string' },
                    cantidad: { type: 'number' }, precio_unitario: { type: 'number' },
                  },
                },
              },
            },
          },
        },
        observaciones: { type: 'string', description: 'Nota libre que se guarda con la cotizacion.' },
        iva_pct: { type: 'number', description: 'Por defecto 16.' },
        tipo_cambio: { type: 'number', description: 'Solo si lo pactaron. No se inventa.' },
        clave_idempotencia: { type: 'string', description: 'Mandela SIEMPRE. Si la llamada se reintenta, devuelve la cotizacion que ya creo en vez de duplicarla.' },
        confirmar: { type: 'boolean' },
      },
      required: ['lead', 'especialidad', 'nombre', 'moneda', 'partidas'],
    },
  },
  {
    name: 'editar_cotizacion',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description:
      'Agrega, cambia o quita partidas concretas de una cotizacion, sin tocar las demas. ' +
      'Pide `version` (el que da ver_cotizacion) para no pisar lo que otra persona haya cambiado mientras tanto: ' +
      'si la version no empata, no escribe nada y le dice que vuelva a leerla. ' +
      'SIN confirmar=true solo ensena como quedaria.',
    inputSchema: {
      type: 'object',
      properties: {
        cotizacion: { type: 'string', description: 'id o folio.' },
        version: { type: 'string', description: 'El `version` que devolvio ver_cotizacion. Obligatorio para cambiar o quitar.' },
        agregar: { type: 'array', description: 'Partidas nuevas, con el mismo formato que crear_cotizacion. Cada una puede traer `area`: si esa area no existe en la cotizacion se crea, y si no la dan cae en la primera.', items: { type: 'object' } },
        cambiar: {
          type: 'array', description: 'Solo los campos que cambien; lo demas del renglon se queda.',
          items: {
            type: 'object',
            properties: {
              partida: { type: 'string', description: 'id del renglon (quotation_items).' },
              cantidad: { type: 'number' },
              precio_unitario: { type: 'number' },
              mano_obra_unitaria: { type: 'number' },
            },
            required: ['partida'],
          },
        },
        quitar: { type: 'array', description: 'ids de los renglones a borrar.', items: { type: 'string' } },
        confirmar: { type: 'boolean' },
      },
      required: ['cotizacion'],
    },
  },
  {
    name: 'buscar_bundles',
    annotations: { readOnlyHint: true },
    description:
      'Busca paquetes del catalogo (kits que se cotizan como una unidad) por nombre o especialidad. ' +
      'Devuelve cuantos componentes trae cada uno y cuanto cuesta el paquete completo.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Parte del nombre.' },
        especialidad: { type: 'string', enum: ESPECIALIDADES },
        limite: { type: 'integer' },
      },
    },
  },
  {
    name: 'ver_bundle',
    annotations: { readOnlyHint: true },
    description:
      'El desglose de un paquete: cada componente con su cantidad, marca, modelo, color, costo con su moneda, ' +
      'margen y precio. Mas el precio del paquete completo, que es la suma de sus componentes.',
    inputSchema: {
      type: 'object',
      properties: { bundle: { type: 'string', description: 'id del bundle o parte de su nombre.' } },
      required: ['bundle'],
    },
  },
  {
    name: 'exportar_cotizacion',
    annotations: { readOnlyHint: true },
    description:
      'Da la liga para abrir y descargar el PDF de la cotizacion en el ERP, y avisa si tiene algo que la haria ' +
      'salir mal impresa (total que no cuadra con los renglones, partidas sin precio).',
    inputSchema: {
      type: 'object',
      properties: { cotizacion: { type: 'string', description: 'id o folio.' } },
      required: ['cotizacion'],
    },
  },
]

export async function ejecutarCot(nombre: string, args: any, sb: SupabaseClient, quien: Quien) {
  switch (nombre) {

    // ─────────────────────────────────────────────────────────────────────────
    case 'crear_cotizacion': {
      const partidas: any[] = Array.isArray(args?.partidas) ? args.partidas : []
      if (!partidas.length) return texto({ error: 'Sin partidas no hay cotizacion.' })

      const esp = String(args?.especialidad || '').toLowerCase()
      if (!ESPECIALIDADES.includes(esp)) return texto({ error: `especialidad debe ser una de: ${ESPECIALIDADES.join(', ')}.` })

      const moneda = String(args?.moneda || '').toUpperCase()
      if (moneda !== 'MXN' && moneda !== 'USD') return texto({ error: 'La moneda debe ser MXN o USD.' })

      const lead = await leadDe(sb, String(args?.lead || ''))
      if (!lead) return texto({ error: 'No encontre ese lead.' })

      const ivaPct = args?.iva_pct != null ? Number(args.iva_pct) : 16

      const armado = await armarRenglones(sb, partidas, moneda)
      if ((armado as any).error) return texto({ creada: false, error: (armado as any).error })
      if ((armado as any).ambiguo) return texto({ creada: false, ...(armado as any).ambiguo })
      const { renglones, avisos, detalle } = armado as any

      const t = totalesDe(renglones, ivaPct)

      // Los sistemas salen de los productos que de verdad entraron. Ver regla 4a.
      const sistemas = [...new Set(renglones.map((r: any) => idDeSistema(r.system)))]
      // Y las areas, de las partidas. Ver regla 4b: sin area no se ven.
      const areas = [...new Set(renglones.map((r: any) => r.area || 'General'))]

      if (!args?.confirmar) {
        return texto({
          creada: false,
          vista_previa: true,
          lead: `${(lead as any).codigo} — ${(lead as any).name}`,
          cliente: (lead as any).company || null,
          nombre: args?.nombre, especialidad: esp, moneda,
          partidas: detalle,
          renglones_que_se_guardarian: renglones.length,
          totales: { ...t, moneda },
          areas_que_se_crean: areas,
          sistemas_que_se_activan: sistemas,
          sin_heredar: 'descuento 0, programacion 0, viaticos apagados, instalacion solo la que usted pidio.',
          avisos: avisos.length ? avisos : undefined,
          folio: 'lo asigna la base con la clave del lead al guardar',
          para_ejecutar: 'repita con confirmar=true, y mande clave_idempotencia para que un reintento no la duplique.',
        })
      }

      const notas = {
        systems: sistemas,
        systems_no_suma: [],
        currency: moneda,
        lead_id: (lead as any).id,
        lead_name: (lead as any).name,
        descuento: 0,
        programacion: 0,
        nominaPct: 20,
        ivaRate: ivaPct,
        viaticos: { activo: false, dias: 0, personas: 0, viaticoDia: 0, noches: 0, hospedajeNoche: 0, transporte: 0, nota: '' },
        customSystems: [],
        ...(args?.tipo_cambio != null ? { tipoCambio: Number(args.tipo_cambio) } : {}),
        ...(args?.observaciones ? { observaciones: String(args.observaciones) } : {}),
        origen: 'mcp',
      }

      const { data, error } = await sb.rpc('omm_mcp_cotizacion_crear', {
        p: {
          idem: args?.clave_idempotencia || null,
          cab: {
            name: String(args.nombre),
            specialty: esp,
            client_name: (lead as any).company || (lead as any).name || null,
            notes: JSON.stringify(notas),
            // created_by y assignee_id apuntan a EMPLOYEES, no a app_users.
            // Si esta cuenta no tiene empleado ligado se OMITE: inventar un id
            // ajeno es peor que dejarlo vacio.
            created_by: quien.empleadoId || null,
            assignee_id: quien.empleadoId || null,
          },
          areas,
          items: renglones.map((r: any, i: number) => ({ ...r, order_index: i })),
          total: t.total,
        },
      })
      if (error) return texto({ creada: false, error: error.message })

      const res: any = data
      const cot = await cotizacionDe(sb, res.id)
      return texto({
        creada: !res.reusada,
        ...(res.reusada ? { nota: 'Ya existia una cotizacion con esa clave de idempotencia. No se creo otra; esta es la que hay.' } : {}),
        id: res.id,
        folio: (cot as any)?.folio || res.folio,
        estado: (cot as any)?.stage,
        liga: `${ERP}/cotizaciones?open=${res.id}`,
        partidas: res.partidas ?? renglones.length,
        areas: res.areas ?? areas.length,
        totales: { ...t, moneda },
        version: (cot as any)?.updated_at,
        que_NO_se_hizo: 'No se mando al cliente, no paso a contrato y no genero ordenes de compra. Es un borrador.',
        compruebelo: `ver_cotizacion con "${(cot as any)?.folio || res.id}"`,
        avisos: avisos.length ? avisos : undefined,
      })
    }

    // ─────────────────────────────────────────────────────────────────────────
    case 'editar_cotizacion': {
      const cot = await cotizacionDe(sb, String(args?.cotizacion || ''))
      if (!cot) return texto({ error: 'No encontre esa cotizacion.' })
      const cotId = (cot as any).id

      const cambiar: any[] = Array.isArray(args?.cambiar) ? args.cambiar : []
      const quitar: string[] = Array.isArray(args?.quitar) ? args.quitar.map(String) : []
      const agregar: any[] = Array.isArray(args?.agregar) ? args.agregar : []
      if (!cambiar.length && !quitar.length && !agregar.length) {
        return texto({ error: 'No me dijo que cambiar: use agregar, cambiar o quitar.' })
      }
      if ((cambiar.length || quitar.length) && !args?.version) {
        return texto({
          error: 'Para cambiar o quitar partidas necesito `version`, para no pisar lo que otra persona haya modificado.',
          que_hacer: `Lea la cotizacion con ver_cotizacion y mande el campo version. Ahora mismo es ${(cot as any).updated_at}.`,
        })
      }

      const notas = (() => { try { return JSON.parse((cot as any).notes || '{}') } catch { return {} } })()
      const moneda = String(notas.currency || 'MXN').toUpperCase()
      const ivaPct = notas.ivaRate != null ? Number(notas.ivaRate) : 16
      const programacion = Number(notas.programacion) || 0

      const { data: actuales } = await sb.from('quotation_items')
        .select('id,name,modelo,quantity,price,total,installation_cost,bundle_instance_id')
        .eq('quotation_id', cotId).order('order_index').limit(TOPE)
      const vigentes = actuales || []

      // Lo que se agrega pasa por el mismo armador: mismas reglas de catalogo,
      // moneda y precio que al crear.
      let nuevos: any[] = []; let avisos: string[] = []; let detalleNuevos: any[] = []
      if (agregar.length) {
        const armado = await armarRenglones(sb, agregar, moneda)
        if ((armado as any).error) return texto({ editada: false, error: (armado as any).error })
        if ((armado as any).ambiguo) return texto({ editada: false, ...(armado as any).ambiguo })
        nuevos = (armado as any).renglones; avisos = (armado as any).avisos; detalleNuevos = (armado as any).detalle
      }

      const porId = new Map(vigentes.map((r: any) => [r.id, r]))
      for (const c of cambiar) if (!porId.has(String(c.partida))) {
        return texto({ editada: false, error: `La partida ${c.partida} no es de esta cotizacion.` })
      }
      for (const q of quitar) if (!porId.has(q)) {
        return texto({ editada: false, error: `La partida ${q} no es de esta cotizacion.` })
      }

      // Como quedaria todo, para la vista previa y para el total.
      const cambiosPorId = new Map(cambiar.map((c: any) => [String(c.partida), c]))
      const quitarSet = new Set(quitar)
      const resultantes = vigentes.filter((r: any) => !quitarSet.has(r.id)).map((r: any) => {
        const c = cambiosPorId.get(r.id)
        if (!c) return r
        const cant = c.cantidad != null ? Number(c.cantidad) : Number(r.quantity)
        const precio = c.precio_unitario != null ? centavos(c.precio_unitario) : Number(r.price)
        const mo = c.mano_obra_unitaria != null ? centavos(c.mano_obra_unitaria) : Number(r.installation_cost || 0)
        return { ...r, quantity: cant, price: precio, installation_cost: mo, total: centavos(cant * precio) }
      })
      const t = totalesDe([...resultantes, ...nuevos], ivaPct, programacion)

      if (!args?.confirmar) {
        return texto({
          editada: false, vista_previa: true,
          cotizacion: (cot as any).folio, moneda,
          version: (cot as any).updated_at,
          se_agregan: detalleNuevos.length ? detalleNuevos : undefined,
          se_cambian: cambiar.map((c: any) => {
            const a: any = porId.get(String(c.partida))
            const d: any = resultantes.find((r: any) => r.id === String(c.partida))
            return { partida: a.name, antes: { cantidad: Number(a.quantity), precio: Number(a.price), importe: Number(a.total) },
                     queda: { cantidad: d.quantity, precio: d.price, importe: d.total } }
          }),
          se_quitan: quitar.map(q => ({ partida: (porId.get(q) as any).name, importe: Number((porId.get(q) as any).total) })),
          renglones_al_final: resultantes.length + nuevos.length,
          totales: { ...t, moneda },
          avisos: avisos.length ? avisos : undefined,
          para_ejecutar: 'repita con confirmar=true y el mismo version.',
        })
      }

      const { data, error } = await sb.rpc('omm_mcp_cotizacion_editar', {
        p: {
          cotizacion_id: cotId,
          version: args?.version || null,
          agregar: nuevos,
          cambiar: cambiar.map((c: any) => {
            const d: any = resultantes.find((r: any) => r.id === String(c.partida))
            return {
              id: String(c.partida),
              ...(c.cantidad != null ? { quantity: d.quantity } : {}),
              ...(c.precio_unitario != null ? { price: d.price } : {}),
              ...(c.mano_obra_unitaria != null ? { installation_cost: d.installation_cost } : {}),
              ...(c.cantidad != null || c.precio_unitario != null ? { total: d.total } : {}),
            }
          }),
          quitar,
          total: t.total,
        },
      })
      if (error) return texto({ editada: false, error: error.message })
      const r: any = data
      if (!r?.ok) return texto({ editada: false, ...r })

      const fresca = await cotizacionDe(sb, cotId)
      return texto({
        editada: true,
        cotizacion: (fresca as any).folio, id: cotId,
        estado: (fresca as any).stage,
        liga: `${ERP}/cotizaciones?open=${cotId}`,
        agregadas: r.agregadas, cambiadas: r.cambiadas, quitadas: r.quitadas,
        totales: { ...t, moneda },
        version: r.version_nueva,
        compruebelo: `ver_cotizacion con "${(fresca as any).folio}"`,
        avisos: avisos.length ? avisos : undefined,
      })
    }

    // ─────────────────────────────────────────────────────────────────────────
    case 'buscar_bundles': {
      const lim = Math.min(Number(args?.limite) || 25, 50)
      let q = sb.from('catalog_bundles').select('id,name,description,specialty,system,is_active')
        .eq('is_active', true).limit(lim)
      if (args?.texto) q = q.ilike('name', `%${String(args.texto).trim()}%`)
      if (args?.especialidad) q = q.eq('specialty', String(args.especialidad).toLowerCase())
      const { data, error } = await q
      if (error) return texto({ error: error.message })
      const lista = data || []
      if (!lista.length) return texto({ encontrados: 0 })

      const { data: comps } = await sb.from('catalog_bundle_items')
        .select('bundle_id, quantity, producto:catalog_products(cost,moneda,markup)')
        .in('bundle_id', lista.map((b: any) => b.id))

      const porBundle = new Map<string, any[]>()
      for (const c of comps || []) {
        const k = (c as any).bundle_id
        const a = porBundle.get(k); if (a) a.push(c); else porBundle.set(k, [c])
      }
      return texto({
        encontrados: lista.length,
        bundles: lista.map((b: any) => {
          const cs = porBundle.get(b.id) || []
          const monedas = [...new Set(cs.map((c: any) => String(c.producto?.moneda || 'USD').toUpperCase()))]
          let precio: number | null = 0
          for (const c of cs) {
            const p: any = (c as any).producto
            const m = Number(p?.markup) || 0, co = Number(p?.cost) || 0
            if (!(co > 0 && m > 0 && m < 100)) { precio = null; break }
            precio = centavos((precio as number) + Number((c as any).quantity) * precioDeCatalogo(co, m))
          }
          return {
            bundle_id: b.id, nombre: b.name, especialidad: b.specialty, sistema: b.system,
            componentes: cs.length,
            precio_por_paquete: precio,
            moneda_costo: monedas.length === 1 ? monedas[0] : monedas,
            ...(precio === null ? { nota: 'Algun componente no tiene costo y margen utilizables: hay que dar su precio a mano.' } : {}),
          }
        }),
      })
    }

    // ─────────────────────────────────────────────────────────────────────────
    case 'ver_bundle': {
      const ref = String(args?.bundle || '').trim()
      const q = sb.from('catalog_bundles').select('id,name,description,specialty,system,is_active').limit(5)
      const { data: bs } = esUuid(ref) ? await q.eq('id', ref) : await q.ilike('name', `%${ref}%`)
      if (!bs?.length) return texto({ error: 'No encontre ese paquete.' })
      if (bs.length > 1) {
        return texto({ motivo: 'Varios paquetes empatan con ese nombre.', candidatos: bs.map((b: any) => ({ bundle_id: b.id, nombre: b.name })) })
      }
      const b: any = bs[0]
      const { data: comps } = await sb.from('catalog_bundle_items')
        .select(`quantity, producto:catalog_products(${CAMPOS_PROD})`).eq('bundle_id', b.id)

      let suma: number | null = 0
      const componentes = (comps || []).map((c: any) => {
        const p = c.producto || {}
        const costo = Number(p.cost) || 0, margen = Number(p.markup) || 0
        const der = costo > 0 && margen > 0 && margen < 100 ? precioDeCatalogo(costo, margen) : null
        if (der == null) suma = null
        else if (suma !== null) suma = centavos(suma + Number(c.quantity) * der)
        return {
          catalogo_id: p.id, nombre: p.name, marca: p.marca, modelo: p.modelo, sku: p.sku,
          cantidad_por_paquete: Number(c.quantity),
          costo, moneda_costo: String(p.moneda || 'USD').toUpperCase(), margen,
          precio_unitario: der,
          proveedor: p.provider, sistema: p.system,
          // El color vive en el nombre y el modelo del producto (WH = blanco,
          // MN = midnight, BL = negro). No hay columna de color en el catalogo.
        }
      })
      return texto({
        bundle_id: b.id, nombre: b.name, descripcion: b.description,
        especialidad: b.specialty, sistema: b.system, activo: b.is_active,
        componentes,
        precio_por_paquete: suma,
        como_se_inserta: 'Al cotizarlo se guarda EXPLOTADO: un renglon por componente atados por bundle_instance_id, ' +
          'sin renglon de cabecera. El precio del paquete es la suma de sus componentes, no un cargo aparte.',
        ojo_color: 'El color va en el nombre/modelo (WH blanco, MN midnight, BL negro). Si pide tapas de otro color, ' +
          'son articulos ADICIONALES: los componentes del paquete conservan el suyo.',
      })
    }

    // ─────────────────────────────────────────────────────────────────────────
    case 'exportar_cotizacion': {
      const cot = await cotizacionDe(sb, String(args?.cotizacion || ''))
      if (!cot) return texto({ error: 'No encontre esa cotizacion.' })
      const cotId = (cot as any).id
      const { data: items } = await sb.from('quotation_items')
        .select('id,name,quantity,price,total,installation_cost').eq('quotation_id', cotId).limit(TOPE)
      const lista = items || []
      const notas = (() => { try { return JSON.parse((cot as any).notes || '{}') } catch { return {} } })()
      const ivaPct = notas.ivaRate != null ? Number(notas.ivaRate) : 16
      const t = totalesDe(lista as any[], ivaPct, Number(notas.programacion) || 0)

      const avisos: string[] = []
      const guardado = centavos((cot as any).total)
      if (Math.abs(guardado - t.total) > 0.01) {
        avisos.push(
          `El total guardado es ${guardado} y los renglones dan ${t.total} (diferencia ${centavos(guardado - t.total)}). ` +
          `Abrala una vez en el editor para que se sincronice antes de mandarla.`)
      }
      const sinPrecio = lista.filter((r: any) => !(Number(r.price) > 0)).length
      if (sinPrecio) avisos.push(`${sinPrecio} de ${lista.length} partidas van en cero.`)

      return texto({
        cotizacion: { folio: (cot as any).folio, nombre: (cot as any).name, estado: (cot as any).stage, moneda: notas.currency || 'MXN', total: guardado },
        liga: `${ERP}/cotizaciones?open=${cotId}`,
        como_bajarla: 'Abra la cotizacion con esa liga y use el boton de PDF. El documento se dibuja en el navegador, ' +
          'asi que no se lo puedo adjuntar aqui todavia.',
        partidas: lista.length,
        totales: { ...t, moneda: notas.currency || 'MXN' },
        avisos: avisos.length ? avisos : ['Sin pendientes: los renglones cuadran con el total guardado.'],
      })
    }

    default:
      return texto({ error: `Herramienta desconocida: ${nombre}` })
  }
}
