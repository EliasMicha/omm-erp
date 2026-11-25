// Plan de compra de una cotización (2026-11-25).
//
// Una sola cuenta de "qué se vendió, qué ya se pidió y qué falta", para que
// "Generar en bloque" y "Desde cotización" (dentro de una orden) digan lo mismo.
//
// Reglas (las mismas que ya tenía Generar en bloque):
//  - Partidas: material de las áreas de la cotización. Distribución guarda sus
//    renglones sin área y sin type='material', y su costo es el PACTADO en la
//    moneda de la cotización (excepción documentada en CLAUDE.md).
//  - Un sistema apagado no se vendió: no se compra.
//  - El catálogo manda en proveedor, moneda y costo.
//  - El mismo producto repetido en varias áreas se consolida.
//  - Llave de producto: catalog_product_id; sin catálogo, el nombre. Es la
//    misma llave con la que se cuenta lo ya pedido, por eso un renglón de orden
//    capturado a mano (sin catálogo y con otro texto) NO cuenta como pedido.
import { supabase } from './supabase'
import { soloSistemasVendidos } from './sistemasVendidos'
import { normalizarMoneda, monedaDeCosto, type Moneda } from './moneda'

export interface OCDelProducto { id: string; numero: string; status: string; cantidad: number }

export interface RenglonPlan {
  key: string
  catalog_product_id: string | null
  name: string
  description: string | null
  marca: string | null
  modelo: string | null
  system: string | null
  unit: string
  purchase_phase: string
  cantidad: number          // vendido (consolidado)
  ordenado: number          // en órdenes no canceladas de la cotización
  falta: number             // max(0, cantidad - ordenado)
  costo: number             // unitario, en `moneda`
  moneda: Moneda
  supplierId: string | null
  proveedor: string
  ocs: OCDelProducto[]
}

export interface PlanCompra { renglones: RenglonPlan[]; omitidos: number; esDist: boolean }

export function llaveProducto(catalogId: string | null | undefined, name: string | null | undefined): string {
  return catalogId || String(name || '')
}

export async function planDeCotizacion(quotationId: string): Promise<PlanCompra> {
  const { data: cot } = await supabase.from('quotations').select('id,specialty,notes').eq('id', quotationId).single()
  const esDist = (cot as any)?.specialty === 'dist'
  let monedaDist: Moneda = 'USD'
  if (esDist) { try { monedaDist = normalizarMoneda(JSON.parse((cot as any)?.notes || '{}').currency, 'USD') } catch { /* notas libres */ } }

  let items: any[] = []
  if (esDist) {
    const { data } = await supabase.from('quotation_items').select('*').eq('quotation_id', quotationId).order('order_index')
    items = data || []
  } else {
    const { data: areas } = await supabase.from('quotation_areas').select('id').eq('quotation_id', quotationId)
    const areaIds = (areas || []).map((a: any) => a.id)
    if (areaIds.length) {
      const { data } = await supabase.from('quotation_items').select('*').in('area_id', areaIds).eq('type', 'material').order('order_index')
      items = data || []
    }
  }
  const antes = items.length
  items = soloSistemasVendidos(items, (cot as any)?.notes)
  const omitidos = antes - items.length

  const catIds = [...new Set(items.map(i => i.catalog_product_id).filter(Boolean))]
  const catMap = new Map<string, any>()
  for (let k = 0; k < catIds.length; k += 200) {
    const { data: cps } = await supabase.from('catalog_products')
      .select('id,provider,supplier_id,moneda,cost,unit,marca,modelo').in('id', catIds.slice(k, k + 200))
    ;(cps || []).forEach((c: any) => catMap.set(c.id, c))
  }

  // Lo ya pedido en órdenes no canceladas de esta cotización, y en cuáles.
  const { data: pos } = await supabase.from('purchase_orders').select('id,status,po_number,folio').eq('quotation_id', quotationId)
  const vivas = (pos || []).filter((p: any) => p.status !== 'cancelada')
  const ordenado = new Map<string, number>()
  const ocsPor = new Map<string, OCDelProducto[]>()
  if (vivas.length) {
    const { data: prev } = await supabase.from('po_items').select('purchase_order_id,catalog_product_id,name,quantity')
      .in('purchase_order_id', vivas.map((p: any) => p.id))
    for (const pi of (prev || []) as any[]) {
      const k = llaveProducto(pi.catalog_product_id, pi.name)
      const q = Number(pi.quantity) || 0
      ordenado.set(k, (ordenado.get(k) || 0) + q)
      const p: any = vivas.find((v: any) => v.id === pi.purchase_order_id)
      const lista = ocsPor.get(k) || []
      const ya = lista.find(o => o.id === p.id)
      if (ya) ya.cantidad += q
      else lista.push({ id: p.id, numero: p.folio || p.po_number || '', status: p.status, cantidad: q })
      ocsPor.set(k, lista)
    }
  }

  const consolidado = new Map<string, RenglonPlan>()
  for (const it of items) {
    const cat = it.catalog_product_id ? catMap.get(it.catalog_product_id) : null
    const costo = esDist ? (Number(it.cost) || 0) : (Number(cat?.cost) || Number(it.cost) || 0)
    const moneda: Moneda = esDist ? monedaDist : monedaDeCosto(cat || { moneda: it.provider_currency })
    const k = llaveProducto(it.catalog_product_id, it.name)
    const prev = consolidado.get(k)
    if (prev) { prev.cantidad += Number(it.quantity) || 0; continue }
    consolidado.set(k, {
      key: k, catalog_product_id: it.catalog_product_id || null,
      name: it.name, description: it.description || null,
      marca: it.marca || cat?.marca || null, modelo: it.modelo || cat?.modelo || null,
      system: it.system || null, unit: cat?.unit || 'pza',
      purchase_phase: it.purchase_phase || 'inicio',
      cantidad: Number(it.quantity) || 0, ordenado: 0, falta: 0,
      costo, moneda,
      supplierId: cat?.supplier_id || it.supplier_id || null,
      proveedor: cat?.provider || it.provider || (esDist ? it.marca : '') || '',
      ocs: [],
    })
  }
  for (const r of consolidado.values()) {
    r.ordenado = ordenado.get(r.key) || 0
    r.falta = Math.max(0, r.cantidad - r.ordenado)
    r.ocs = ocsPor.get(r.key) || []
  }
  return { renglones: Array.from(consolidado.values()), omitidos, esDist }
}
