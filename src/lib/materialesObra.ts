// ═══════════════════════════════════════════════════════════════════════════
// materialesObra — la única fuente de verdad del material de una obra.
//
// La usan tres pantallas: la pestaña Materiales del ERP, la solicitud de
// material de la app de obra y la bandeja de solicitudes. Antes cada una
// contaba distinto, así que un mismo producto podía verse "recibido" en una y
// "falta pedir" en otra.
//
// Cuatro etapas por producto, acumulativas (no excluyentes):
//   COTIZADO   — cantidad del catálogo de la cotización de la obra
//   PEDIDO     — cantidad en órdenes de compra del proyecto (sin cancelar)
//   SOLICITADO — cantidad que el instalador pidió desde la app de obra
//   RECIBIDO   — cantidad que físicamente llegó a ESTA obra
//
// De dónde sale "recibido": de `stock_movements`, NO de `delivery_items`.
// delivery_items tenía RLS sin políticas y estaba vacía; el inventario real
// vive en el libro de movimientos que usa el módulo de Entregas.
//
// La llave de cruce es la misma que ya usa Entregas.tsx: catalog_product_id
// cuando existe, y si no marca|modelo|descripción normalizados. Los renglones
// que se reciben en obra casi nunca traen catalog_product_id, así que el
// empate por texto no es un lujo: es el camino normal.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'

export type EtapaMaterial = 'falta_pedir' | 'pedido' | 'solicitado' | 'recibido' | 'completo'

export const ETAPA_CFG: Record<EtapaMaterial, { label: string; color: string }> = {
  falta_pedir: { label: 'Solo cotizado', color: '#6B7280' },
  pedido:      { label: 'Pedido',        color: '#D97706' },
  solicitado:  { label: 'Solicitado en obra', color: '#A78BFA' },
  recibido:    { label: 'Recibido en obra',   color: '#2563EB' },
  completo:    { label: 'Completo en obra',   color: '#10B981' },
}

const norm = (s: any): string =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** Llave de cruce entre quotation_items ↔ po_items ↔ stock_movements ↔ solicitudes. */
export function claveMaterial(o: {
  catalog_product_id?: string | null
  product_id?: string | null
  marca?: string | null
  modelo?: string | null
  name?: string | null
  descripcion?: string | null
  description?: string | null
}): string {
  const cp = o.catalog_product_id || o.product_id
  if (cp) return 'c:' + cp
  const texto = norm(o.name || o.descripcion || o.description)
  const mm = [norm(o.marca), norm(o.modelo)].filter(Boolean).join('|')
  if (mm && texto) return 't:' + mm + '|' + texto
  return 't:' + (mm || texto || '?')
}

export interface EventoMaterial {
  etapa: 'pedido' | 'solicitado' | 'recibido'
  cantidad: number
  fecha: string | null
  quien: string
  ref: string        // folio de OC, folio de recepción, folio de solicitud
  detalle?: string
}

export interface RenglonMaterial {
  clave: string
  descripcion: string
  marca: string
  modelo: string
  unidad: string
  sistema: string
  catalog_product_id: string | null
  /** id de un quotation_item representativo (para ligar la solicitud) */
  quotation_item_id: string | null
  cotizado: number
  pedido: number
  solicitado: number
  recibido: number
  /** cuánto queda por pedir en obra = cotizado − solicitado (nunca negativo) */
  porSolicitar: number
  /** desglose por área: nombre de área → cantidad cotizada */
  porArea: Record<string, number>
  areas: string[]
  eventos: EventoMaterial[]
  etapa: EtapaMaterial
  /** true = llegó material a la obra que no tiene renglón en la cotización */
  fueraDeCatalogo: boolean
  /** pista del renglón cotizado más parecido (NO se fusiona solo: se sugiere) */
  parecidoA?: string
}

export interface MaterialesObra {
  renglones: RenglonMaterial[]
  areas: { id: string; name: string; order_index: number }[]
  sistemas: string[]
  /** true si la obra no tiene cotización vinculada */
  sinCotizacion: boolean
  error: string | null
}

function etapaDe(r: { cotizado: number; pedido: number; solicitado: number; recibido: number }): EtapaMaterial {
  if (r.cotizado > 0 && r.recibido >= r.cotizado) return 'completo'
  if (r.recibido > 0) return 'recibido'
  if (r.solicitado > 0) return 'solicitado'
  if (r.pedido > 0) return 'pedido'
  return 'falta_pedir'
}

export async function cargarMaterialesObra(obra: {
  id: string
  cotizacion_id?: string | null
  quotation_ids?: string[] | null
  project_id?: string | null
}): Promise<MaterialesObra> {
  const cotIds = Array.from(new Set([
    ...(obra.quotation_ids || []),
    ...(obra.cotizacion_id ? [obra.cotizacion_id] : []),
  ].filter(Boolean))) as string[]

  if (cotIds.length === 0) {
    return { renglones: [], areas: [], sistemas: [], sinCotizacion: true, error: null }
  }

  const projectId = obra.project_id || null

  // OJO: `stock_movements.destino_obra_id` NO guarda el id de `obras` — guarda
  // el id del LEAD (el selector de "obra" del módulo de Entregas es en realidad
  // un selector de leads). El puente es la cotización: quotations.notes trae
  // lead_id. Sin esto, la pestaña de Materiales veía cero recibido en obras que
  // sí tienen material entregado.
  const { data: cotRows } = await supabase.from('quotations').select('id,notes').in('id', cotIds)
  const leadIds = Array.from(new Set(((cotRows || []) as any[]).map(q => {
    try { return JSON.parse(q.notes || '{}').lead_id || null } catch { return null }
  }).filter(Boolean))) as string[]

  const filtroMovs = [
    `quotation_id.in.(${cotIds.join(',')})`,
    leadIds.length ? `destino_obra_id.in.(${leadIds.join(',')})` : '',
  ].filter(Boolean).join(',')

  const [areasRes, itemsRes, poRes, movRes, solRes] = await Promise.all([
    supabase.from('quotation_areas').select('id,name,order_index,quotation_id').in('quotation_id', cotIds).order('order_index'),
    supabase.from('quotation_items')
      .select('id,area_id,name,description,system,type,quantity,marca,modelo,catalog_product_id,quotation_id')
      .in('quotation_id', cotIds).order('order_index'),
    // Las OC de la obra no siempre traen project_id: también se ligan por la
    // cotización o porque la logística apunta a esta obra. Buscamos por las tres.
    supabase.from('purchase_orders')
      .select('id,po_number,status,created_at,requested_by,expected_delivery,project_id,quotation_id,logistics_target_obra_id')
      .or([
        projectId ? `project_id.eq.${projectId}` : '',
        `quotation_id.in.(${cotIds.join(',')})`,
        `logistics_target_obra_id.eq.${obra.id}`,
      ].filter(Boolean).join(',')),
    supabase.from('stock_movements')
      .select('id,fecha,catalog_product_id,descripcion,marca,modelo,qty,unit,tipo,destino_tipo,destino_obra_id,folio,movido_por_nombre,recibido_por,notas')
      .eq('destino_tipo', 'obra').eq('anulado', false).or(filtroMovs),
    supabase.from('obra_material_solicitud_items')
      .select('id,clave,cantidad,cantidad_surtida,descripcion,obra_material_solicitudes!inner(id,folio,fecha,status,solicitante_nombre)')
      .eq('obra_id', obra.id),
  ])

  const err = [areasRes, itemsRes, poRes, movRes, solRes]
    .map((r: any) => r?.error?.message).filter(Boolean)[0] || null

  const areas = ((areasRes as any).data || []).map((a: any) => ({ id: a.id, name: a.name || 'Sin nombre', order_index: a.order_index || 0 }))
  const areaName = new Map<string, string>(areas.map((a: any) => [a.id, a.name]))

  // ── Cotizado (solo material, la mano de obra no se surte) ──
  const mapa = new Map<string, RenglonMaterial>()
  const nuevo = (base: any, clave: string): RenglonMaterial => ({
    clave,
    descripcion: base.name || base.descripcion || base.description || 'Sin descripción',
    marca: base.marca || '',
    modelo: base.modelo || '',
    unidad: base.unit || base.unidad || 'pza',
    sistema: base.system || base.sistema || 'General',
    catalog_product_id: base.catalog_product_id || null,
    quotation_item_id: null,
    cotizado: 0, pedido: 0, solicitado: 0, recibido: 0, porSolicitar: 0,
    porArea: {}, areas: [], eventos: [], etapa: 'falta_pedir', fueraDeCatalogo: false,
  })

  ;(((itemsRes as any).data || []) as any[])
    .filter(it => it.type !== 'labor' && it.type !== 'mano_de_obra' && it.type !== 'servicio')
    .forEach(it => {
      const k = claveMaterial(it)
      const r = mapa.get(k) || nuevo(it, k)
      r.cotizado += Number(it.quantity) || 0
      if (!r.quotation_item_id) r.quotation_item_id = it.id
      if (!r.marca && it.marca) r.marca = it.marca
      if (!r.modelo && it.modelo) r.modelo = it.modelo
      const an = areaName.get(it.area_id) || 'Sin área'
      r.porArea[an] = (r.porArea[an] || 0) + (Number(it.quantity) || 0)
      if (!r.areas.includes(an)) r.areas.push(an)
      mapa.set(k, r)
    })

  // ── Pedido (órdenes de compra de la obra) ──
  const pos = (((poRes as any).data || []) as any[])
    .filter(po => String(po.status || '').toLowerCase() !== 'cancelada')
  const poById = new Map<string, any>(pos.map(po => [po.id, po]))
  let poItems: any[] = []
  if (pos.length) {
    const { data } = await supabase.from('po_items')
      .select('id,purchase_order_id,catalog_product_id,name,marca,modelo,quantity,unit')
      .in('purchase_order_id', pos.map(p => p.id))
    poItems = (data as any[]) || []
  }
  poItems.forEach(p => {
    const po = poById.get(p.purchase_order_id) || {}
    const k = claveMaterial(p)
    const r = mapa.get(k) || nuevo(p, k)
    const q = Number(p.quantity) || 0
    r.pedido += q
    if (!r.unidad || r.unidad === 'pza') r.unidad = p.unit || r.unidad
    r.eventos.push({
      etapa: 'pedido', cantidad: q,
      fecha: String(po.created_at || '').substring(0, 10) || null,
      quien: po.requested_by || 'Compras',
      ref: po.po_number || '',
      detalle: po.expected_delivery ? `Llega ~${String(po.expected_delivery).substring(0, 10)}` : undefined,
    })
    mapa.set(k, r)
  })

  // ── Recibido en obra (libro de movimientos) ──
  ;(((movRes as any).data || []) as any[]).forEach(m => {
    if (m.destino_tipo !== 'obra') return
    const k = claveMaterial(m)
    const r = mapa.get(k) || nuevo(m, k)
    const q = Number(m.qty) || 0
    r.recibido += q
    r.eventos.push({
      etapa: 'recibido', cantidad: q,
      fecha: m.fecha || null,
      quien: m.recibido_por || m.movido_por_nombre || 'Obra',
      ref: m.folio || '',
      detalle: m.tipo === 'bodega_a_obra' ? 'Salió de bodega' : 'Entrega directa de proveedor',
    })
    mapa.set(k, r)
  })

  // ── Solicitado desde la app de obra ──
  ;(((solRes as any).data || []) as any[]).forEach(s => {
    const sol = s.obra_material_solicitudes || {}
    if (['rechazada', 'cancelada'].includes(String(sol.status || ''))) return
    const k = s.clave
    const r = mapa.get(k) || nuevo({ name: s.descripcion }, k)
    const q = Number(s.cantidad) || 0
    r.solicitado += q
    r.eventos.push({
      etapa: 'solicitado', cantidad: q,
      fecha: sol.fecha || null,
      quien: sol.solicitante_nombre || 'Obra',
      ref: sol.folio || '',
      detalle: Number(s.cantidad_surtida) > 0 ? `${Number(s.cantidad_surtida)} ya surtidas` : undefined,
    })
    mapa.set(k, r)
  })

  // Lo que llegó a la obra y no tiene renglón cotizado se marca aparte en vez de
  // fusionarlo por parecido: las recepciones no guardan catalog_product_id y
  // "CONTACTO … BCO" contra "CONTACTO … NGO" son productos distintos. Mejor que
  // Elias vea la diferencia a que el tablero invente una cantidad.
  const cotizados = Array.from(mapa.values()).filter(r => r.cotizado > 0)
  const tokensDe = (t: string) => new Set(norm(t).split(' ').filter(w => w.length > 2))
  const parecido = (desc: string): string | undefined => {
    const a = tokensDe(desc)
    if (!a.size) return undefined
    let mejor: { s: number; d: string } | null = null
    for (const c of cotizados) {
      const b = tokensDe(c.descripcion)
      let inter = 0
      a.forEach(t => { if (b.has(t)) inter++ })
      const s = inter / Math.max(a.size, b.size)
      if (!mejor || s > mejor.s) mejor = { s, d: c.descripcion }
    }
    return mejor && mejor.s >= 0.5 ? mejor.d : undefined
  }

  const renglones = Array.from(mapa.values()).map(r => {
    r.porSolicitar = Math.max(0, r.cotizado - r.solicitado)
    r.etapa = etapaDe(r)
    r.eventos.sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')))
    if (r.areas.length === 0) r.areas = ['Sin área']
    if (r.cotizado === 0) {
      r.fueraDeCatalogo = true
      r.parecidoA = parecido(r.descripcion)
    }
    return r
  }).sort((a, b) =>
    Number(a.fueraDeCatalogo) - Number(b.fueraDeCatalogo) ||
    a.sistema.localeCompare(b.sistema) ||
    a.descripcion.localeCompare(b.descripcion))

  const sistemas = Array.from(new Set(renglones.map(r => r.sistema).filter(Boolean))).sort()

  return { renglones, areas, sistemas, sinCotizacion: false, error: err }
}

/** Folio incremental para solicitudes: SM-AAMM-NNN */
export async function folioSolicitud(): Promise<string> {
  const d = new Date()
  const prefix = `SM-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`
  const { data } = await supabase.from('obra_material_solicitudes')
    .select('folio').like('folio', `${prefix}%`).order('folio', { ascending: false }).limit(1)
  const ultimo = (data && (data as any[])[0]?.folio) || ''
  const n = (parseInt(String(ultimo).split('-')[2] || '0', 10) || 0) + 1
  return `${prefix}-${String(n).padStart(3, '0')}`
}

export const STATUS_SOLICITUD: Record<string, { label: string; color: string }> = {
  solicitada:      { label: 'Solicitada',       color: '#D97706' },
  aprobada:        { label: 'Aprobada',         color: '#2563EB' },
  surtida_parcial: { label: 'Surtida parcial',  color: '#A78BFA' },
  surtida:         { label: 'Surtida',          color: '#10B981' },
  rechazada:       { label: 'Rechazada',        color: '#DC2626' },
  cancelada:       { label: 'Cancelada',        color: '#6B7280' },
}
