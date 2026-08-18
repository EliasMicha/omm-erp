// ═══════════════════════════════════════════════════════════════════════════
// entregaFlow — todo lo que arrastra "programar una entrega".
//
// Antes, programar una entrega solo escribía un renglón en `deliveries` y ahí
// moría: no aparecía en la ruta del día, no salían recibos y el inventario
// seguía diciendo que el material estaba en bodega. Este archivo es el único
// lugar donde se cierra el círculo completo:
//
//   PROGRAMAR  →  deliveries          (lo que ve el instalador en su celular)
//              →  delivery_items      (qué se le va a llevar, con marca/modelo)
//              →  logistics_tasks     (la parada en la ruta del día del chofer)
//              →  solicitud 'aprobada' + delivery_id
//              →  recibos imprimibles (chofer + quien recibe en obra)
//
//   CONFIRMAR  →  stock_movements bodega_a_obra   ← AQUÍ se mueve el inventario
//              →  deliveries.status = 'entregado'
//              →  logistics_tasks.estatus = 'completada'
//              →  cantidad_surtida de la solicitud, y status surtida/parcial
//
// Por qué el inventario se mueve al CONFIRMAR y no al PROGRAMAR: mientras la
// camioneta no salga, el material sigue físicamente en bodega. Si se descontara
// al programar, el almacén vería faltantes que sí tiene enfrente. Programar
// reserva; confirmar mueve.
//
// Idempotencia: el egreso de bodega se escribe con `delivery_id`. Antes de
// insertar se revisa si ya hay movimientos de esa entrega — así, volver a picar
// "confirmar" (o completar la tarea de ruta que ya se había confirmado desde la
// solicitud) no duplica la salida.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'

export interface ItemEntrega {
  clave?: string | null
  catalog_product_id?: string | null
  quotation_item_id?: string | null
  solicitud_item_id?: string | null
  marca?: string | null
  modelo?: string | null
  descripcion: string
  unidad?: string | null
  qty: number
}

export interface DestinoEntrega {
  obra_id: string | null
  obra_nombre: string
  lead_id: string | null
  quotation_id: string | null
  project_id: string | null
  direccion: string | null
}

export interface ResultadoPrograma {
  delivery_id: string
  task_id: string | null
  folio: string
}

const hoyISO = () => new Date().toISOString().slice(0, 10)

export function folioEntrega(fecha: string) {
  return 'ENT-' + (fecha || hoyISO()).slice(2).replace(/-/g, '') + '-' + Math.floor(Math.random() * 900 + 100)
}

const fmtQ = (n: any) => Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })

/* ────────────────────────────────────────────────────────────────────────────
   Resolver el destino
   Una obra sabe su cotización; la cotización sabe su lead (va en notes, como
   JSON). El lead importa porque `stock_movements.destino_obra_id` guarda el
   LEAD, no la obra — así se capturó todo el histórico y no se toca.
──────────────────────────────────────────────────────────────────────────── */

async function leadDeCotizacion(quotationId: string | null): Promise<string | null> {
  if (!quotationId) return null
  const { data } = await supabase.from('quotations').select('notes').eq('id', quotationId).maybeSingle()
  try { return JSON.parse((data as any)?.notes || '{}').lead_id || null } catch { return null }
}

export async function destinoDeObra(obraId: string): Promise<DestinoEntrega | null> {
  const { data: o } = await supabase.from('obras')
    .select('id,nombre,quotation_id,quotation_ids,project_id,direccion,direccion_completa')
    .eq('id', obraId).maybeSingle()
  if (!o) return null
  const q = (o as any).quotation_id || ((o as any).quotation_ids || [])[0] || null
  return {
    obra_id: (o as any).id,
    obra_nombre: (o as any).nombre || 'Obra',
    quotation_id: q,
    lead_id: await leadDeCotizacion(q),
    project_id: (o as any).project_id || null,
    direccion: (o as any).direccion_completa || (o as any).direccion || null,
  }
}

/** Cuando la entrega se arma desde Entregas (por lead + cotización) y hay que
 *  averiguar a qué obra pertenece, para que la app de obra la vea. */
export async function destinoDeCotizacion(quotationId: string | null, leadId?: string | null, nombreFallback?: string): Promise<DestinoEntrega> {
  // Hay tareas de ruta viejas sin cotización. En ese caso se busca la obra por
  // el lead; si tampoco hay, se entrega igual pero sin obra (no aparecerá en la
  // app del instalador, y así se le avisa a quien programa).
  let o: any = null
  if (quotationId) {
    const { data } = await supabase.from('obras')
      .select('id,nombre,quotation_id,quotation_ids,project_id,direccion,direccion_completa')
      .or(`quotation_id.eq.${quotationId},quotation_ids.cs.{${quotationId}}`)
      .limit(1)
    o = ((data as any[]) || [])[0] || null
  }
  if (!o && leadId) {
    // `quotations` no tiene columna lead_id: el lead viaja dentro de `notes`
    // como JSON, así que se busca por texto y se confirma al parsear.
    const { data: qs } = await supabase.from('quotations')
      .select('id,notes').ilike('notes', `%${leadId}%`).limit(20)
    const ids = ((qs as any[]) || []).filter(q => {
      try { return JSON.parse(q.notes || '{}').lead_id === leadId } catch { return false }
    }).map(q => q.id)
    if (ids.length) {
      const { data } = await supabase.from('obras')
        .select('id,nombre,quotation_id,quotation_ids,project_id,direccion,direccion_completa')
        .in('quotation_id', ids).limit(1)
      o = ((data as any[]) || [])[0] || null
    }
  }
  return {
    obra_id: o?.id || null,
    obra_nombre: o?.nombre || nombreFallback || 'Obra',
    quotation_id: quotationId || o?.quotation_id || null,
    lead_id: leadId || await leadDeCotizacion(quotationId),
    project_id: o?.project_id || null,
    direccion: o?.direccion_completa || o?.direccion || null,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   PROGRAMAR
──────────────────────────────────────────────────────────────────────────── */

export interface ArgsProgramar {
  destino: DestinoEntrega
  fecha: string
  hora?: string | null
  items: ItemEntrega[]
  chofer?: { id?: string | null; nombre?: string | null } | null
  recibe?: { nombre?: string | null; rol?: string | null } | null
  solicitud_id?: string | null
  notas?: string | null
  titulo?: string | null
  folio?: string | null
  prioridad?: string
  /** dirección para la ruta; si no viene se usa la de la obra */
  ubicacion?: string | null
  /** si ya existe la tarea de ruta (se programó desde Agenda) no se duplica */
  task_id?: string | null
  creado_por?: string | null
}

export async function programarEntrega(a: ArgsProgramar): Promise<ResultadoPrograma> {
  const items = (a.items || []).filter(i => Number(i.qty) > 0)
  if (!items.length) throw new Error('No hay nada que entregar: todos los renglones quedaron en 0.')
  if (!a.fecha) throw new Error('Falta la fecha de entrega.')

  const folio = a.folio || folioEntrega(a.fecha)
  const d = a.destino

  // 1 ── La entrega: es lo que el instalador ve en su celular.
  const { data: del, error: e1 } = await supabase.from('deliveries').insert({
    obra_id: d.obra_id,
    project_id: d.project_id,
    quotation_id: d.quotation_id,
    lead_id: d.lead_id,
    solicitud_id: a.solicitud_id || null,
    logistics_task_id: a.task_id || null,
    delivery_date: a.fecha,
    scheduled_time: a.hora || null,
    type: 'entrega',
    status: 'pendiente',
    origin: 'Bodega OMM',
    destination: d.obra_nombre,
    folio,
    driver_id: a.chofer?.id || null,
    driver_nombre: a.chofer?.nombre || null,
    recibe_nombre: a.recibe?.nombre || null,
    created_by_id: a.creado_por || null,
    material_description: items.map(i => `${fmtQ(i.qty)} ${i.unidad || 'pza'} ${i.modelo || i.descripcion}`).join(' | ').slice(0, 900),
    notes: a.notas || null,
  }).select('id').single()
  if (e1) throw e1
  const deliveryId = (del as any).id

  try {
    // 2 ── Los renglones, con identidad completa: sin marca/modelo no se puede
    //      escribir después el movimiento de inventario con la misma llave.
    const { error: e2 } = await supabase.from('delivery_items').insert(items.map(i => ({
      delivery_id: deliveryId,
      obra_id: d.obra_id,
      product_id: i.catalog_product_id || null,
      quotation_item_id: i.quotation_item_id || null,
      solicitud_item_id: i.solicitud_item_id || null,
      clave: i.clave || null,
      marca: i.marca || null,
      modelo: i.modelo || null,
      description: i.descripcion,
      qty: Number(i.qty) || 0,
      unit: i.unidad || 'pza',
      direction: 'out_bodega_to_obra',
    })))
    if (e2) throw e2

    // 3 ── La parada en la ruta del día. Sin esto la entrega nunca aparece en
    //      Agenda y el chofer no se entera.
    let taskId = a.task_id || null
    const filaRuta = {
      tipo: 'entrega',
      titulo: a.titulo || ('Entrega — ' + d.obra_nombre),
      fecha: a.fecha,
      hora: a.hora || null,
      ubicacion: a.ubicacion || d.direccion || d.obra_nombre,
      prioridad: a.prioridad || 'media',
      lead_id: d.lead_id,
      quotation_id: d.quotation_id,
      obra_id: d.obra_id,
      asignado_a: a.chofer?.id || null,
      asignado_nombre: a.chofer?.nombre || null,
      notas: a.notas || null,
      items: items.map(i => ({
        clave: i.clave || null, marca: i.marca || '', modelo: i.modelo || '',
        descripcion: i.descripcion, qty: Number(i.qty) || 0, unidad: i.unidad || 'pza',
      })),
      recibe_nombre: a.recibe?.nombre || null,
      recibe_rol: a.recibe?.rol || null,
      folio,
      delivery_id: deliveryId,
      solicitud_id: a.solicitud_id || null,
      estatus: 'pendiente',
    }
    if (taskId) {
      await supabase.from('logistics_tasks').update({ delivery_id: deliveryId, folio, solicitud_id: a.solicitud_id || null }).eq('id', taskId)
    } else {
      const { data: t, error: e3 } = await supabase.from('logistics_tasks').insert(filaRuta).select('id').single()
      if (e3) throw e3
      taskId = (t as any).id
      await supabase.from('deliveries').update({ logistics_task_id: taskId }).eq('id', deliveryId)
    }

    // 4 ── La solicitud queda aprobada y amarrada a su entrega.
    if (a.solicitud_id) {
      await supabase.from('obra_material_solicitudes').update({
        status: 'aprobada', delivery_id: deliveryId, revisado_at: new Date().toISOString(),
      }).eq('id', a.solicitud_id)
    }

    return { delivery_id: deliveryId, task_id: taskId, folio }
  } catch (err) {
    // Si algo tronó a media programación, no dejamos una entrega huérfana
    // colgada en el celular del instalador.
    await supabase.from('delivery_items').delete().eq('delivery_id', deliveryId)
    await supabase.from('deliveries').delete().eq('id', deliveryId)
    throw err
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   CONFIRMAR — aquí se mueve el inventario
──────────────────────────────────────────────────────────────────────────── */

export interface ArgsConfirmar {
  fecha?: string
  /** quién sacó el material de bodega */
  movido_por?: string | null
  movido_por_nombre?: string | null
  /** quién firmó en obra */
  recibido_por?: string | null
  notas?: string | null
}

export interface ResultadoConfirma {
  movimientos: number
  piezas: number
  folio: string
  yaEstaba: boolean
}

export async function confirmarEntrega(deliveryId: string, a: ArgsConfirmar = {}): Promise<ResultadoConfirma> {
  const { data: del, error: eD } = await supabase.from('deliveries')
    .select('id,folio,obra_id,project_id,quotation_id,lead_id,delivery_date,status,driver_nombre,recibe_nombre,solicitud_id,logistics_task_id,notes')
    .eq('id', deliveryId).maybeSingle()
  if (eD) throw eD
  if (!del) throw new Error('No encontré esa entrega.')
  const D: any = del
  const folio = D.folio || folioEntrega(D.delivery_date || hoyISO())

  // ── Idempotencia: ¿ya se movió el inventario de esta entrega? ──
  const { data: yaMov } = await supabase.from('stock_movements')
    .select('id').eq('delivery_id', deliveryId).eq('anulado', false).limit(1)
  const yaEstaba = ((yaMov as any[]) || []).length > 0

  const { data: itemsRaw } = await supabase.from('delivery_items')
    .select('id,description,marca,modelo,qty,unit,product_id,clave,solicitud_item_id')
    .eq('delivery_id', deliveryId)
  const items = ((itemsRaw as any[]) || []).filter(i => Number(i.qty) > 0)

  let movimientos = 0
  let piezas = 0

  if (!yaEstaba && items.length) {
    const fecha = a.fecha || D.delivery_date || hoyISO()
    const batch = (globalThis.crypto as any)?.randomUUID
      ? (globalThis.crypto as any).randomUUID()
      : undefined

    const rows = items.map(i => ({
      fecha,
      catalog_product_id: i.product_id || null,
      descripcion: i.description,
      marca: i.marca || null,
      modelo: i.modelo || null,
      qty: Number(i.qty),
      unit: i.unit || 'pza',
      tipo: 'bodega_a_obra',
      origen_tipo: 'bodega',
      origen_obra_id: null,
      destino_tipo: 'obra',
      // ⚠️ el libro guarda el LEAD en destino_obra_id: así está todo el histórico.
      destino_obra_id: D.lead_id || null,
      bucket_destino: 'proyecto',
      proyecto_id: D.project_id || null,
      quotation_id: D.quotation_id || null,
      movido_por: a.movido_por || null,
      movido_por_nombre: a.movido_por_nombre || D.driver_nombre || null,
      recibido_por: a.recibido_por || D.recibe_nombre || null,
      notas: a.notas || D.notes || null,
      folio,
      batch_id: batch,
      delivery_id: deliveryId,
    }))
    const { error: eM } = await supabase.from('stock_movements').insert(rows)
    if (eM) throw eM
    movimientos = rows.length
    piezas = rows.reduce((s, r) => s + Number(r.qty || 0), 0)
  }

  // ── La entrega y su parada en la ruta quedan cerradas ──
  await supabase.from('deliveries').update({
    status: 'entregado',
    delivered_at: new Date().toISOString(),
    folio,
    updated_at: new Date().toISOString(),
  }).eq('id', deliveryId)

  if (D.logistics_task_id) {
    await supabase.from('logistics_tasks').update({ estatus: 'completada' }).eq('id', D.logistics_task_id)
  } else {
    await supabase.from('logistics_tasks').update({ estatus: 'completada' }).eq('delivery_id', deliveryId)
  }

  // ── La solicitud que originó la entrega: cuánto quedó surtido ──
  if (D.solicitud_id) await surtirSolicitud(D.solicitud_id, items)

  return { movimientos, piezas, folio, yaEstaba }
}

/** Suma lo entregado a `cantidad_surtida` y recalcula el status de la solicitud. */
async function surtirSolicitud(solicitudId: string, itemsEntrega: any[]) {
  const { data: sItems } = await supabase.from('obra_material_solicitud_items')
    .select('id,clave,cantidad,cantidad_surtida').eq('solicitud_id', solicitudId)
  const lista = ((sItems as any[]) || [])
  if (!lista.length) return

  // Se empata primero por el id exacto del renglón de la solicitud; si la
  // entrega se armó por fuera (desde Agenda), se cae al empate por clave.
  const porId = new Map<string, number>()
  const porClave = new Map<string, number>()
  itemsEntrega.forEach(i => {
    const q = Number(i.qty) || 0
    if (i.solicitud_item_id) porId.set(i.solicitud_item_id, (porId.get(i.solicitud_item_id) || 0) + q)
    else if (i.clave) porClave.set(i.clave, (porClave.get(i.clave) || 0) + q)
  })

  for (const it of lista) {
    const entregado = porId.get(it.id) ?? porClave.get(it.clave) ?? 0
    if (entregado <= 0) continue
    const nuevo = Math.min(Number(it.cantidad) || 0, (Number(it.cantidad_surtida) || 0) + entregado)
    await supabase.from('obra_material_solicitud_items').update({ cantidad_surtida: nuevo }).eq('id', it.id)
    it.cantidad_surtida = nuevo
  }

  const completa = lista.every(i => (Number(i.cantidad_surtida) || 0) >= (Number(i.cantidad) || 0))
  const algo = lista.some(i => (Number(i.cantidad_surtida) || 0) > 0)
  await supabase.from('obra_material_solicitudes').update({
    status: completa ? 'surtida' : algo ? 'surtida_parcial' : 'aprobada',
    revisado_at: new Date().toISOString(),
  }).eq('id', solicitudId)
}

/** Deshacer una entrega programada (todavía no confirmada). */
export async function cancelarEntrega(deliveryId: string) {
  const { data: mv } = await supabase.from('stock_movements')
    .select('id').eq('delivery_id', deliveryId).eq('anulado', false).limit(1)
  if (((mv as any[]) || []).length) {
    throw new Error('Esta entrega ya movió inventario. Para deshacerla hay que anular el movimiento en el libro.')
  }
  const { data: del } = await supabase.from('deliveries')
    .select('id,solicitud_id,logistics_task_id').eq('id', deliveryId).maybeSingle()
  const D: any = del || {}
  await supabase.from('logistics_tasks').update({ estatus: 'cancelada' }).eq('delivery_id', deliveryId)
  await supabase.from('deliveries').update({ status: 'cancelado', updated_at: new Date().toISOString() }).eq('id', deliveryId)
  if (D.solicitud_id) {
    await supabase.from('obra_material_solicitudes')
      .update({ status: 'solicitada', delivery_id: null }).eq('id', D.solicitud_id)
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   RECIBOS — dos por entrega: el del chofer y el de quien recibe en obra.
   Vive aquí (y no en Entregas.tsx) para que la bandeja de solicitudes imprima
   exactamente el mismo documento.
──────────────────────────────────────────────────────────────────────────── */

export function generarRecibosEntrega({ folio, fecha, leadName, ubicacion, chofer, recibeNombre, recibeRol, items, notas }: any) {
  const rolLabel: any = { instalador: 'Instalador OMM', residente: 'Residente de obra', cliente: 'Cliente' }
  const fechaTxt = (() => { try { return new Date(fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }) } catch { return fecha } })()
  const lista: any[] = items || []
  const filas = lista.map((it: any, i: number) => `<tr><td style="text-align:center">${i + 1}</td><td>${it.marca || ''}</td><td>${it.modelo || ''}</td><td>${it.descripcion || it.description || ''}</td><td style="text-align:center;font-weight:700">${fmtQ(it.qty)}</td></tr>`).join('')
  const totalPzs = lista.reduce((s: number, it: any) => s + Number(it.qty || 0), 0)
  const bloque = (titulo: string, quienLabel: string, quienNombre: string, leyenda: string) => `
    <div class="recibo">
      <div class="hd"><div><div class="logo">OMM</div><div class="sub">OMM Technologies · Entrega de material</div></div>
        <div style="text-align:right"><div class="folio">${folio}</div><div class="sub">${fechaTxt}</div></div></div>
      <div class="tt">${titulo}</div>
      <table class="meta"><tr><td style="width:55%"><b>Obra / Lead:</b> ${leadName}</td><td><b>Ubicación:</b> ${ubicacion || '—'}</td></tr>
        <tr><td><b>Chofer:</b> ${chofer || '—'}</td><td><b>${quienLabel}:</b> ${quienNombre || '—'}</td></tr></table>
      <table class="items"><thead><tr><th style="width:34px">#</th><th>Marca</th><th>Modelo</th><th>Descripción</th><th style="width:60px">Cant.</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><td colspan="4" style="text-align:right"><b>Total de piezas</b></td><td style="text-align:center"><b>${fmtQ(totalPzs)}</b></td></tr></tfoot></table>
      ${notas ? `<div class="notas"><b>Notas:</b> ${notas}</div>` : ''}
      <div class="leyenda">${leyenda}</div>
      <div class="firmas"><div class="fw"><div class="ln"></div>${quienNombre || quienLabel}<div class="sub">Firma de quien recibe</div></div>
        <div class="fw"><div class="ln"></div>OMM Technologies<div class="sub">Entregó</div></div></div>
    </div>`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Recibos ${folio}</title><style>
    *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
    body{margin:0;color:#111}
    .recibo{padding:34px 40px;page-break-after:always}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:10px}
    .logo{font-size:30px;font-weight:800;letter-spacing:1px}
    .sub{font-size:11px;color:#666;margin-top:2px}
    .folio{font-size:15px;font-weight:700}
    .tt{font-size:16px;font-weight:800;margin:18px 0 12px;text-transform:uppercase}
    table{width:100%;border-collapse:collapse;font-size:12px}
    .meta td{padding:3px 0;font-size:12px}
    .items{margin-top:8px}
    .items th{background:#111;color:#fff;padding:7px 8px;text-align:left;font-size:11px}
    .items td{border-bottom:1px solid #ddd;padding:6px 8px}
    .items tfoot td{border:none;padding-top:8px}
    .notas{margin-top:12px;font-size:12px}
    .leyenda{margin-top:20px;font-size:11px;color:#333;line-height:1.5;border:1px solid #ccc;border-radius:6px;padding:10px}
    .firmas{display:flex;gap:60px;margin-top:54px}
    .fw{flex:1;text-align:center;font-size:12px}
    .ln{border-top:1px solid #111;margin-bottom:6px;height:1px}
    @media print{.recibo{padding:24px 30px}}
  </style></head><body>
  ${bloque('Recibo del chofer', 'Recibe (chofer)', chofer, 'El chofer confirma que RECIBE la mercancía descrita, en buen estado y en las cantidades indicadas, haciéndose responsable de su traslado hasta la obra destino.')}
  ${bloque('Recibo en obra', (rolLabel[recibeRol] || 'Recibe en obra'), recibeNombre, 'Quien recibe en obra confirma haber RECIBIDO la mercancía descrita en las cantidades indicadas y en buen estado.')}
  <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
  </body></html>`
  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close() }
}
