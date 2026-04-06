// ═══════════════════════════════════════════════════════════════════
// CotEditorESP.tsx — Cotizador de Sistemas Especiales
// 
// ESTRUCTURA:
//   Cotización define SISTEMAS globales (Audio, Redes, CCTV, etc.)
//   Áreas son zonas físicas (Recámara Principal, Sala/Comedor, etc.)
//   Productos pertenecen a un Área + Sistema
//   Si un sistema no tiene productos en un área, no se muestra
//
// COLUMNAS CLIENTE: Imagen | Cant. | Descripción | Precio | Precio Ampliado | Mano de Obra Ampliado | Total
// COLUMNAS INTERNAS: + Costo real, Margen %, Utilidad
// Margen = % utilidad sobre precio de VENTA (no markup)
// Fórmula: Costo = Precio × (1 - Margen%)
// ═══════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { F, STAGE_CONFIG } from '../lib/utils'
import { Badge, Btn, Loading } from '../components/layout/UI'
import { Plus, ChevronLeft, ChevronRight, ChevronDown, X, Trash2, Image as ImageIcon } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface EspProduct {
  id: string
  areaId: string
  systemId: string
  name: string
  description: string
  imageUrl: string | null
  quantity: number
  price: number
  laborCost: number
  costReal: number
  margin: number
  order: number
}

interface EspArea {
  id: string
  name: string
  collapsed: boolean
  order: number
}

interface EspSystemDef {
  id: string
  name: string
  color: string
}

interface EspQuoteConfig {
  currency: 'USD' | 'MXN'
  ivaRate: number
  paymentSchedule: Array<{ label: string; percentage: number }>
  version: string
  programacion: number
}

// ═══════════════════════════════════════════════════════════════════
// CATALOGS
// ═══════════════════════════════════════════════════════════════════

const ALL_SYSTEMS: EspSystemDef[] = [
  { id: 'audio', name: 'Audio', color: '#8B5CF6' },
  { id: 'redes', name: 'Redes', color: '#06B6D4' },
  { id: 'cctv', name: 'CCTV', color: '#3B82F6' },
  { id: 'control_acceso', name: 'Control de Acceso', color: '#F59E0B' },
  { id: 'control_iluminacion', name: 'Control de Iluminación', color: '#C084FC' },
  { id: 'deteccion_humo', name: 'Detección de Humo', color: '#EF4444' },
  { id: 'bms', name: 'BMS', color: '#10B981' },
  { id: 'telefonia', name: 'Telefonía', color: '#F97316' },
  { id: 'red_celular', name: 'Red Celular', color: '#EC4899' },
  { id: 'cortinas_ctrl', name: 'Cortinas y Persianas', color: '#67E8F9' },
]

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function uid(): string { return Math.random().toString(36).slice(2, 10) }

function calcLine(p: EspProduct) {
  const precioAmp = p.price * p.quantity
  const moAmp = p.laborCost * p.quantity
  const total = precioAmp + moAmp
  const costReal = p.price * (1 - p.margin / 100)
  const utilidad = p.price - costReal
  return { precioAmp, moAmp, total, costReal, utilidad }
}

function calcSummary(products: EspProduct[], config: EspQuoteConfig) {
  let equipoTotal = 0
  let instalacion = 0
  products.forEach(p => {
    equipoTotal += p.price * p.quantity
    instalacion += p.laborCost * p.quantity
  })
  const manoObraTotal = instalacion + config.programacion
  const subtotal = equipoTotal + manoObraTotal
  const iva = subtotal * (config.ivaRate / 100)
  const total = subtotal + iva
  return { equipoTotal, instalacion, programacion: config.programacion, manoObraTotal, subtotal, iva, total }
}

// ═══════════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════════

function buildMock(): { areas: EspArea[]; systems: string[]; products: EspProduct[] } {
  const a1 = uid(), a2 = uid(), a3 = uid()
  const areas: EspArea[] = [
    { id: a1, name: 'Recámara Principal', collapsed: false, order: 0 },
    { id: a2, name: 'Sala/Comedor', collapsed: true, order: 1 },
    { id: a3, name: 'Site', collapsed: true, order: 2 },
  ]
  const systems = ['audio', 'redes']
  const products: EspProduct[] = [
    // Recámara - Audio
    { id: uid(), areaId: a1, systemId: 'audio', name: 'Extendable Soundbar TV Mount Designed for Sonos Arc Sound...', description: '', imageUrl: null, quantity: 1, price: 150, laborCost: 40, costReal: 105, margin: 30, order: 0 },
    { id: uid(), areaId: a1, systemId: 'audio', name: 'Sonos® Sub 4 Subwoofer - Black', description: '', imageUrl: null, quantity: 1, price: 799, laborCost: 140, costReal: 559.30, margin: 30, order: 1 },
    { id: uid(), areaId: a1, systemId: 'audio', name: 'Sonos® Arc Ultra Soundbar - Black', description: '', imageUrl: null, quantity: 1, price: 959, laborCost: 160, costReal: 671.30, margin: 30, order: 2 },
    // Recámara - Redes
    { id: uid(), areaId: a1, systemId: 'redes', name: 'Salida de 1 Nodos de Red', description: '', imageUrl: null, quantity: 1, price: 56.10, laborCost: 5.81, costReal: 39.27, margin: 30, order: 0 },
    { id: uid(), areaId: a1, systemId: 'redes', name: 'Ubiquiti U7-PRO WiF7 AP', description: '', imageUrl: null, quantity: 1, price: 318.25, laborCost: 60, costReal: 222.78, margin: 30, order: 1 },
    // Sala - Audio
    { id: uid(), areaId: a2, systemId: 'audio', name: 'Sonos AMP 125W per channel', description: '', imageUrl: null, quantity: 2, price: 770, laborCost: 170, costReal: 539, margin: 30, order: 0 },
    { id: uid(), areaId: a2, systemId: 'audio', name: 'Triad In-Ceiling Speaker 6.5"', description: '', imageUrl: null, quantity: 4, price: 200, laborCost: 80, costReal: 140, margin: 30, order: 1 },
    // Sala - Redes
    { id: uid(), areaId: a2, systemId: 'redes', name: 'Ubiquiti U7-PRO WiF7 AP', description: '', imageUrl: null, quantity: 1, price: 318.25, laborCost: 60, costReal: 222.78, margin: 30, order: 0 },
    // Site - Redes
    { id: uid(), areaId: a3, systemId: 'redes', name: '10G Cloud Gateway with integrated WiFi 7', description: '', imageUrl: null, quantity: 1, price: 402.50, laborCost: 100.56, costReal: 281.75, margin: 30, order: 0 },
    { id: uid(), areaId: a3, systemId: 'redes', name: 'RACK MEDIANO', description: '', imageUrl: null, quantity: 1, price: 1960.10, laborCost: 220.74, costReal: 1372.07, margin: 30, order: 1 },
  ]
  return { areas, systems, products }
}

// ═══════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════

const S = {
  input: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 12, fontFamily: 'inherit', padding: '5px 8px', textAlign: 'right' as const, width: 70 },
  th: { padding: '6px 8px', fontSize: 9, fontWeight: 600, color: '#444', textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '1px solid #222', whiteSpace: 'nowrap' as const },
  td: { padding: '6px 8px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a' },
  tdR: { padding: '6px 8px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a', textAlign: 'right' as const },
  tdM: { padding: '6px 8px', fontSize: 12, fontWeight: 600, color: '#fff', borderBottom: '1px solid #1a1a1a', textAlign: 'right' as const },
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCT ROW
// ═══════════════════════════════════════════════════════════════════

function ProductRow({ p, onUpdate, onRemove, showInt }: {
  p: EspProduct; onUpdate: (id: string, f: string, v: number) => void; onRemove: (id: string) => void; showInt: boolean
}) {
  const { precioAmp, moAmp, total, costReal, utilidad } = calcLine(p)
  return (
    <tr>
      <td style={{ ...S.td, width: 50, textAlign: 'center' }}>
        {p.imageUrl ? (
          <img src={p.imageUrl} alt="" style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 4 }} />
        ) : (
          <div style={{ width: 40, height: 40, background: '#1a1a1a', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
            <ImageIcon size={14} color="#333" />
          </div>
        )}
      </td>
      <td style={{ ...S.td, width: 50 }}>
        <input type="number" value={p.quantity} min={1}
          onChange={e => onUpdate(p.id, 'quantity', parseInt(e.target.value) || 1)}
          style={{ ...S.input, width: 45 }} />
      </td>
      <td style={{ ...S.td, minWidth: 200 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#ddd' }}>{p.name}</div>
        {p.description && <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{p.description}</div>}
      </td>
      <td style={S.tdR}>
        <input type="number" value={p.price} step={0.01}
          onChange={e => onUpdate(p.id, 'price', parseFloat(e.target.value) || 0)}
          style={S.input} />
      </td>
      <td style={S.tdM}>${precioAmp.toFixed(2)}</td>
      <td style={S.tdR}>
        <input type="number" value={p.laborCost} step={0.01}
          onChange={e => onUpdate(p.id, 'laborCost', parseFloat(e.target.value) || 0)}
          style={S.input} />
      </td>
      <td style={{ ...S.tdM, color: '#57FF9A' }}>${total.toFixed(2)}</td>
      {showInt && (
        <>
          <td style={{ ...S.tdR, color: '#555', fontSize: 10 }}>${costReal.toFixed(2)}</td>
          <td style={S.tdR}>
            <input type="number" value={p.margin} step={1} min={0} max={99}
              onChange={e => onUpdate(p.id, 'margin', parseFloat(e.target.value) || 0)}
              style={{ ...S.input, width: 45, color: p.margin >= 25 ? '#57FF9A' : p.margin >= 15 ? '#F59E0B' : '#EF4444' }} />
          </td>
          <td style={{ ...S.tdR, fontSize: 10, color: utilidad >= 0 ? '#57FF9A' : '#EF4444' }}>${utilidad.toFixed(2)}</td>
        </>
      )}
      <td style={{ ...S.td, width: 30 }}>
        <button onClick={() => onRemove(p.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Trash2 size={12} /></button>
      </td>
    </tr>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SYSTEM BLOCK (within an area)
// ═══════════════════════════════════════════════════════════════════

function SystemBlock({ sysDef, products, collapsed, onToggle, onUpdate, onRemove, onAdd, showInt }: {
  sysDef: EspSystemDef; products: EspProduct[]; collapsed: boolean
  onToggle: () => void; onUpdate: (id: string, f: string, v: number) => void
  onRemove: (id: string) => void; onAdd: () => void; showInt: boolean
}) {
  const sysTotal = products.reduce((s, p) => s + calcLine(p).total, 0)
  return (
    <div style={{ marginBottom: 12 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer', background: '#111', borderRadius: 6, marginBottom: 2 }}>
        {collapsed ? <ChevronRight size={12} color="#555" /> : <ChevronDown size={12} color="#555" />}
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: sysDef.color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: sysDef.color, textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>{sysDef.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#888' }}>{products.length} items</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>${sysTotal.toFixed(2)}</span>
      </div>
      {!collapsed && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#0e0e0e' }}>
              <th style={{ ...S.th, textAlign: 'center' }}>IMAGEN</th>
              <th style={{ ...S.th, textAlign: 'center' }}>CANT.</th>
              <th style={S.th}>DESCRIPCIÓN</th>
              <th style={{ ...S.th, textAlign: 'right' }}>PRECIO</th>
              <th style={{ ...S.th, textAlign: 'right' }}>PRECIO AMP.</th>
              <th style={{ ...S.th, textAlign: 'right' }}>MANO DE OBRA</th>
              <th style={{ ...S.th, textAlign: 'right' }}>TOTAL</th>
              {showInt && (<>
                <th style={{ ...S.th, textAlign: 'right', color: '#555' }}>COSTO</th>
                <th style={{ ...S.th, textAlign: 'right', color: '#555' }}>MG%</th>
                <th style={{ ...S.th, textAlign: 'right', color: '#555' }}>UTIL.</th>
              </>)}
              <th style={S.th}></th>
            </tr></thead>
            <tbody>
              {products.map(p => <ProductRow key={p.id} p={p} onUpdate={onUpdate} onRemove={onRemove} showInt={showInt} />)}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px' }}>
            <Btn size="sm" onClick={onAdd}><Plus size={12} /> Producto</Btn>
            <span style={{ fontSize: 11, color: '#555' }}>{sysDef.name.toUpperCase()} TOTAL <span style={{ fontWeight: 700, color: '#fff', marginLeft: 8 }}>${sysTotal.toFixed(2)}</span></span>
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AREA BLOCK
// ═══════════════════════════════════════════════════════════════════

function AreaBlock({ area, activeSystems, products, collapsedSys, onToggleArea, onToggleSys, onUpdateProd, onRemoveProd, onAddProd, showInt }: {
  area: EspArea; activeSystems: EspSystemDef[]; products: EspProduct[]
  collapsedSys: Record<string, boolean>
  onToggleArea: () => void; onToggleSys: (sysId: string) => void
  onUpdateProd: (id: string, f: string, v: number) => void
  onRemoveProd: (id: string) => void; onAddProd: (sysId: string) => void; showInt: boolean
}) {
  const areaProds = products.filter(p => p.areaId === area.id)
  const areaTotal = areaProds.reduce((s, p) => s + calcLine(p).total, 0)

  // Only show systems that have products in this area, OR all active systems for adding
  const systemsWithProducts = activeSystems.filter(sys => areaProds.some(p => p.systemId === sys.id))
  const systemsEmpty = activeSystems.filter(sys => !areaProds.some(p => p.systemId === sys.id))

  return (
    <div style={{ marginBottom: 16 }}>
      <div onClick={onToggleArea} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer',
        background: '#1a1a1a', borderRadius: 10, borderLeft: '3px solid #57FF9A',
      }}>
        {area.collapsed ? <ChevronRight size={16} color="#57FF9A" /> : <ChevronDown size={16} color="#57FF9A" />}
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', flex: 1, textTransform: 'uppercase' as const }}>{area.name}</span>
        <span style={{ fontSize: 11, color: '#555' }}>{systemsWithProducts.length} sistemas</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#57FF9A' }}>${areaTotal.toFixed(2)}</span>
      </div>

      {!area.collapsed && (
        <div style={{ paddingLeft: 14, paddingTop: 8 }}>
          {/* Systems with products */}
          {systemsWithProducts.map(sys => (
            <SystemBlock key={sys.id} sysDef={sys}
              products={areaProds.filter(p => p.systemId === sys.id)}
              collapsed={collapsedSys[area.id + '_' + sys.id] || false}
              onToggle={() => onToggleSys(area.id + '_' + sys.id)}
              onUpdate={onUpdateProd} onRemove={onRemoveProd}
              onAdd={() => onAddProd(sys.id)} showInt={showInt} />
          ))}

          {/* Empty systems — show as add buttons */}
          {systemsEmpty.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 0', marginTop: 4 }}>
              {systemsEmpty.map(sys => (
                <button key={sys.id} onClick={() => onAddProd(sys.id)} style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
                  border: '1px dashed ' + sys.color + '44', background: 'transparent', color: sys.color + '88',
                }}>
                  + {sys.name}
                </button>
              ))}
            </div>
          )}

          {/* Area total */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px', borderTop: '1px solid #1e1e1e', marginTop: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#555', marginRight: 16 }}>{area.name.toUpperCase()} TOTAL</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>${areaTotal.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY PANEL
// ═══════════════════════════════════════════════════════════════════

function SummaryPanel({ products, areas, config, activeSystems, showInt, onConfigChange }: {
  products: EspProduct[]; areas: EspArea[]; config: EspQuoteConfig
  activeSystems: EspSystemDef[]; showInt: boolean
  onConfigChange: (field: string, value: number) => void
}) {
  const sm = calcSummary(products, config)
  const rows = [
    { label: 'EQUIPO TOTAL', value: sm.equipoTotal, bold: true },
    { label: 'INSTALACIÓN', value: sm.instalacion, bold: false },
    { label: 'PROGRAMACIÓN', value: sm.programacion, bold: false, editable: true },
    { label: 'MANO DE OBRA TOTAL', value: sm.manoObraTotal, bold: true },
    { label: 'SUBTOTAL', value: sm.subtotal, bold: true },
    { label: 'TOTAL IVA', value: sm.iva, bold: false },
    { label: 'TOTAL DEL PROYECTO', value: sm.total, bold: true, highlight: true },
  ]

  return (
    <div>
      {/* Financial summary */}
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Resumen</div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderTop: r.bold ? '1px solid #222' : 'none' }}>
            <span style={{ fontSize: 11, color: r.highlight ? '#57FF9A' : r.bold ? '#ccc' : '#555', fontWeight: r.bold ? 700 : 400 }}>{r.label}</span>
            {r.editable ? (
              <input type="number" value={r.value} step={10}
                onChange={e => onConfigChange('programacion', parseFloat(e.target.value) || 0)}
                style={{ ...S.input, width: 80, fontSize: 12, fontWeight: 600 }} />
            ) : (
              <span style={{ fontSize: r.highlight ? 16 : 12, fontWeight: r.bold ? 700 : 400, color: r.highlight ? '#57FF9A' : '#fff' }}>${r.value.toFixed(2)}</span>
            )}
          </div>
        ))}

        {/* Payment schedule */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #222' }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: '#444', textTransform: 'uppercase', marginBottom: 6 }}>Multivencimiento</div>
          {config.paymentSchedule.map((ps, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}>
              <span style={{ color: '#666' }}>{ps.percentage}% {ps.label}</span>
              <span style={{ color: '#aaa' }}>${(sm.total * ps.percentage / 100).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* By area */}
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Por Área</div>
        {areas.map(area => {
          const t = products.filter(p => p.areaId === area.id).reduce((s, p) => s + calcLine(p).total, 0)
          return (
            <div key={area.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
              <span style={{ color: '#888' }}>{area.name}</span>
              <span style={{ color: '#ccc', fontWeight: 500 }}>${t.toFixed(2)}</span>
            </div>
          )
        })}
      </div>

      {/* By system */}
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Por Sistema</div>
        {activeSystems.map(sys => {
          const t = products.filter(p => p.systemId === sys.id).reduce((s, p) => s + calcLine(p).total, 0)
          return (
            <div key={sys.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
              <span style={{ color: sys.color }}>{sys.name}</span>
              <span style={{ color: '#ccc', fontWeight: 500 }}>${t.toFixed(2)}</span>
            </div>
          )
        })}
      </div>

      {/* Internal margin */}
      {showInt && (
        <div style={{ background: '#1a1414', border: '1px solid #332222', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Análisis Interno</div>
          {(() => {
            let venta = 0, costo = 0
            products.forEach(p => { venta += p.price * p.quantity; costo += p.price * (1 - p.margin / 100) * p.quantity })
            const mg = venta > 0 ? Math.round((venta - costo) / venta * 100) : 0
            return (<>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                <span style={{ color: '#888' }}>Venta equipo</span><span style={{ color: '#fff', fontWeight: 600 }}>${venta.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                <span style={{ color: '#888' }}>Costo real</span><span style={{ color: '#ccc' }}>${costo.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11, borderTop: '1px solid #332222', marginTop: 4, paddingTop: 6 }}>
                <span style={{ color: '#F59E0B', fontWeight: 600 }}>Margen global</span>
                <span style={{ color: mg >= 25 ? '#57FF9A' : mg >= 15 ? '#F59E0B' : '#EF4444', fontWeight: 700, fontSize: 14 }}>{mg}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                <span style={{ color: '#888' }}>Utilidad equipo</span>
                <span style={{ color: '#57FF9A', fontWeight: 600 }}>${(venta - costo).toFixed(2)}</span>
              </div>
            </>)
          })()}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function CotEditorESP({ cotId, onBack }: { cotId: string; onBack: () => void }) {
  const [areas, setAreas] = useState<EspArea[]>([])
  const [activeSysIds, setActiveSysIds] = useState<string[]>([])
  const [products, setProducts] = useState<EspProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<EspQuoteConfig>({
    currency: 'USD', ivaRate: 16, programacion: 740,
    paymentSchedule: [
      { label: 'Anticipo', percentage: 80 },
      { label: 'Entrega de equipos', percentage: 10 },
      { label: 'Finalización de Obra', percentage: 10 },
    ],
    version: '1.0',
  })
  const [showInt, setShowInt] = useState(true)
  const [stage, setStage] = useState('oportunidad')
  const [collapsedSys, setCollapsedSys] = useState<Record<string, boolean>>({})
  const [showSystemPicker, setShowSystemPicker] = useState(false)
  const [cotName, setCotName] = useState('')
  const [clientName, setClientName] = useState('')

  // Load quotation data from Supabase
  useEffect(() => {
    async function load() {
      const [{ data: cot }, { data: qAreas }] = await Promise.all([
        supabase.from('quotations').select('*,project:projects(name,client_name)').eq('id', cotId).single(),
        supabase.from('quotation_areas').select('*').eq('quotation_id', cotId).order('order_index'),
      ])
      if (cot) {
        setCotName(cot.name || '')
        setClientName(cot.client_name || '')
        setStage(cot.stage || 'oportunidad')
      }
      if (qAreas && qAreas.length > 0) {
        setAreas(qAreas.map((a: any, i: number) => ({ id: a.id, name: a.name, collapsed: false, order: i })))
      }
      setLoading(false)
    }
    load()
  }, [cotId])

  const activeSystems = useMemo(() => ALL_SYSTEMS.filter(s => activeSysIds.includes(s.id)), [activeSysIds])
  const summary = useMemo(() => calcSummary(products, config), [products, config])

  // ─── ACTIONS ───────────────────────────────────────────────────
  function toggleArea(areaId: string) {
    setAreas(prev => prev.map(a => a.id === areaId ? { ...a, collapsed: !a.collapsed } : a))
  }

  function toggleSys(key: string) {
    setCollapsedSys(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function addArea() {
    const name = prompt('Nombre del área (zona):')
    if (!name) return
    setAreas(prev => [...prev, { id: uid(), name, collapsed: false, order: prev.length }])
  }

  function toggleGlobalSystem(sysId: string) {
    setActiveSysIds(prev => prev.includes(sysId) ? prev.filter(s => s !== sysId) : [...prev, sysId])
  }

  function updateProduct(id: string, field: string, value: number) {
    setProducts(prev => prev.map(p => {
      if (p.id !== id) return p
      const updated = { ...p, [field]: value }
      if (field === 'price' || field === 'margin') {
        updated.costReal = updated.price * (1 - updated.margin / 100)
      }
      return updated
    }))
  }

  function removeProduct(id: string) {
    setProducts(prev => prev.filter(p => p.id !== id))
  }

  function addProduct(areaId: string, systemId: string) {
    setProducts(prev => [...prev, {
      id: uid(), areaId, systemId, name: 'Nuevo producto', description: '', imageUrl: null,
      quantity: 1, price: 0, laborCost: 0, costReal: 0, margin: 30,
      order: prev.filter(p => p.areaId === areaId && p.systemId === systemId).length,
    }])
  }

  function removeArea(areaId: string) {
    if (!confirm('¿Eliminar esta área y todos sus productos?')) return
    setAreas(prev => prev.filter(a => a.id !== areaId))
    setProducts(prev => prev.filter(p => p.areaId !== areaId))
  }

  // ─── RENDER ────────────────────────────────────────────────────
  if (loading) return <Loading />

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: '#111' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <ChevronLeft size={14} /> Cotizaciones
        </button>
        <span style={{ color: '#333' }}>/</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#57FF9A' }}>◈ {cotName || 'Cotización ESP'}</span>
        <Badge label="ESP" color="#57FF9A" />
        {clientName && <span style={{ fontSize: 11, color: '#555' }}>{clientName}</span>}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {/* Stage buttons */}
          {(Object.entries(STAGE_CONFIG) as Array<[string, { label: string; color: string }]>).map(([s, cfg]) => (
            <button key={s} onClick={() => setStage(s)} style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid ' + (stage === s ? cfg.color : '#333'),
              background: stage === s ? cfg.color + '22' : 'transparent',
              color: stage === s ? cfg.color : '#555',
            }}>{cfg.label}</button>
          ))}

          {/* Systems config */}
          <button onClick={() => setShowSystemPicker(true)} style={{
            padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            border: '1px solid #57FF9A44', background: 'transparent', color: '#57FF9A', marginLeft: 8,
          }}>⚙ Sistemas ({activeSysIds.length})</button>

          {/* Toggle internal */}
          <button onClick={() => setShowInt(!showInt)} style={{
            padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            border: '1px solid ' + (showInt ? '#F59E0B' : '#333'),
            background: showInt ? '#F59E0B22' : 'transparent',
            color: showInt ? '#F59E0B' : '#555',
          }}>{showInt ? '👁 Interno' : '👁 Cliente'}</button>

          <span style={{ fontSize: 16, fontWeight: 700, color: '#57FF9A', marginLeft: 12 }}>${summary.total.toFixed(2)}</span>
        </div>
      </div>

      {/* Active systems bar */}
      <div style={{ padding: '6px 16px', borderBottom: '1px solid #1e1e1e', display: 'flex', gap: 6, alignItems: 'center', background: '#0e0e0e', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: '#444', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 8 }}>Sistemas:</span>
        {activeSystems.map(sys => {
          const sysTotal = products.filter(p => p.systemId === sys.id).reduce((s, p) => s + calcLine(p).total, 0)
          return (
            <span key={sys.id} style={{
              padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
              background: sys.color + '18', color: sys.color, border: '1px solid ' + sys.color + '33',
            }}>
              {sys.name} ${sysTotal.toFixed(0)}
            </span>
          )
        })}
      </div>

      {/* Main content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', flex: 1, overflow: 'hidden' }}>
        {/* Left: Areas */}
        <div style={{ overflowY: 'auto', padding: '16px 20px' }}>
          {areas.map(area => (
            <AreaBlock key={area.id} area={area} activeSystems={activeSystems}
              products={products} collapsedSys={collapsedSys}
              onToggleArea={() => toggleArea(area.id)}
              onToggleSys={toggleSys}
              onUpdateProd={updateProduct}
              onRemoveProd={removeProduct}
              onAddProd={(sysId) => addProduct(area.id, sysId)}
              showInt={showInt} />
          ))}
          <div onClick={addArea} style={{
            padding: '14px', border: '1px dashed #333', borderRadius: 10, textAlign: 'center',
            cursor: 'pointer', color: '#444', fontSize: 12,
          }}>+ Agregar área (zona)</div>
        </div>

        {/* Right: Summary */}
        <div style={{ borderLeft: '1px solid #222', overflowY: 'auto', padding: '16px 12px', background: '#0e0e0e' }}>
          <SummaryPanel products={products} areas={areas} config={config}
            activeSystems={activeSystems} showInt={showInt}
            onConfigChange={(f, v) => setConfig(prev => ({ ...prev, [f]: v }))} />
        </div>
      </div>

      {/* System picker modal */}
      {showSystemPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 380 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Sistemas de la cotización</div>
              <button onClick={() => setShowSystemPicker(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 12 }}>Selecciona los sistemas que aplican para esta cotización. Todos los que elijas estarán disponibles en todas las áreas.</div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
              {ALL_SYSTEMS.map(sys => {
                const active = activeSysIds.includes(sys.id)
                const count = products.filter(p => p.systemId === sys.id).length
                return (
                  <button key={sys.id} onClick={() => toggleGlobalSystem(sys.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    background: active ? sys.color + '11' : '#1a1a1a',
                    border: '1px solid ' + (active ? sys.color + '44' : '#222'),
                    borderRadius: 10, cursor: 'pointer', color: active ? '#fff' : '#666',
                    fontSize: 13, fontFamily: 'inherit', textAlign: 'left' as const,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: active ? sys.color : '#333', flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{sys.name}</span>
                    {count > 0 && <span style={{ fontSize: 10, color: '#555' }}>{count} productos</span>}
                    <span style={{ fontSize: 16, color: active ? sys.color : '#333' }}>{active ? '✓' : '○'}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
