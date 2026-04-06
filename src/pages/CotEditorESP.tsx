// ═══════════════════════════════════════════════════════════════════
// CotEditorESP.tsx — Cotizador de Sistemas Especiales
// Estructura: Área (zona física) → Sistema (Audio, Redes, etc.) → Productos
// Columnas cliente: Imagen | Cant. | Descripción | Precio | Precio Ampliado | Mano de Obra Ampliado | Total
// Columnas internas: + Costo real, Margen %, Utilidad
// Margen = % utilidad sobre precio de VENTA (no markup)
// Fórmula: Costo = Precio × (1 - Margen%)
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { F, STAGE_CONFIG, formatDate } from '../lib/utils'
import { Badge, Btn, Loading, EmptyState } from '../components/layout/UI'
import { Plus, ChevronLeft, ChevronRight, ChevronDown, X, Zap, Trash2, GripVertical, Image } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════
// TYPES — ESP Cotizador
// ═══════════════════════════════════════════════════════════════════

interface EspProduct {
  id: string
  name: string
  description: string
  imageUrl: string | null
  system: string
  quantity: number
  price: number          // Precio de venta (público) — ya incluye margen
  laborCost: number      // Mano de obra (instalación + programación)
  costReal: number       // Costo real interno (price × (1 - margin))
  margin: number         // Margen % sobre precio de venta
  order: number
}

interface EspSystem {
  id: string
  name: string           // "Audio", "Redes", "CCTV", etc.
  products: EspProduct[]
  collapsed: boolean
}

interface EspArea {
  id: string
  name: string           // "Recámara Principal", "Sala/Comedor", "Site", etc.
  systems: EspSystem[]
  collapsed: boolean
}

interface EspQuoteSummary {
  equipoTotal: number
  instalacion: number
  programacion: number
  manoObraTotal: number
  subtotal: number
  iva: number
  total: number
}

interface EspPaymentSchedule {
  label: string
  percentage: number
}

interface EspQuoteConfig {
  currency: 'USD' | 'MXN'
  ivaRate: number
  paymentSchedule: EspPaymentSchedule[]
  version: string
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const SYSTEMS_CATALOG = [
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

const DEFAULT_CONFIG: EspQuoteConfig = {
  currency: 'USD',
  ivaRate: 16,
  paymentSchedule: [
    { label: 'Anticipo', percentage: 80 },
    { label: 'Entrega de equipos', percentage: 10 },
    { label: 'Finalización de Obra', percentage: 10 },
  ],
  version: '1.0',
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function calcProductTotals(p: EspProduct) {
  const precioAmpliado = p.price * p.quantity
  const moAmpliado = p.laborCost * p.quantity
  const totalLine = precioAmpliado + moAmpliado
  const costReal = p.price * (1 - p.margin / 100)
  const utilidad = p.price - costReal
  return { precioAmpliado, moAmpliado, totalLine, costReal, utilidad }
}

function calcSystemTotal(sys: EspSystem): number {
  return sys.products.reduce((sum, p) => {
    const { totalLine } = calcProductTotals(p)
    return sum + totalLine
  }, 0)
}

function calcAreaTotal(area: EspArea): number {
  return area.systems.reduce((sum, sys) => sum + calcSystemTotal(sys), 0)
}

function calcSummary(areas: EspArea[], config: EspQuoteConfig): EspQuoteSummary {
  let equipoTotal = 0
  let instalacion = 0

  areas.forEach(area => {
    area.systems.forEach(sys => {
      sys.products.forEach(p => {
        equipoTotal += p.price * p.quantity
        instalacion += p.laborCost * p.quantity
      })
    })
  })

  const programacion = 0 // Separate line — can be set manually
  const manoObraTotal = instalacion + programacion
  const subtotal = equipoTotal + manoObraTotal
  const iva = subtotal * (config.ivaRate / 100)
  const total = subtotal + iva

  return { equipoTotal, instalacion, programacion, manoObraTotal, subtotal, iva, total }
}

// ═══════════════════════════════════════════════════════════════════
// MOCK DATA (for development — will be replaced by Supabase)
// ═══════════════════════════════════════════════════════════════════

function buildMockData(): EspArea[] {
  return [
    {
      id: uid(), name: 'Recámara Principal', collapsed: false,
      systems: [
        {
          id: uid(), name: 'Audio', collapsed: false,
          products: [
            { id: uid(), name: 'Extendable Soundbar TV Mount Designed for Sonos Arc Sound...', description: '', imageUrl: null, system: 'Audio', quantity: 1, price: 150, laborCost: 40, costReal: 105, margin: 30, order: 0 },
            { id: uid(), name: 'Sonos® Sub 4 Subwoofer - Black', description: '', imageUrl: null, system: 'Audio', quantity: 1, price: 799, laborCost: 140, costReal: 559.30, margin: 30, order: 1 },
            { id: uid(), name: 'Sonos® Arc Ultra Soundbar - Black', description: '', imageUrl: null, system: 'Audio', quantity: 1, price: 959, laborCost: 160, costReal: 671.30, margin: 30, order: 2 },
          ],
        },
        {
          id: uid(), name: 'Redes', collapsed: false,
          products: [
            { id: uid(), name: 'Salida de 1 Nodos de Red', description: '', imageUrl: null, system: 'Redes', quantity: 1, price: 56.10, laborCost: 5.81, costReal: 39.27, margin: 30, order: 0 },
            { id: uid(), name: 'Conector Jack Estilo 110 (de Impacto), Tipo Keystone, Cate...', description: '', imageUrl: null, system: 'Redes', quantity: 2, price: 9.30, laborCost: 1.20, costReal: 6.51, margin: 30, order: 1 },
            { id: uid(), name: 'Ubiquiti U7-PRO | U7-PRO WiF7 AP Wireless Access Point', description: '', imageUrl: null, system: 'Redes', quantity: 1, price: 318.25, laborCost: 60, costReal: 222.78, margin: 30, order: 2 },
          ],
        },
      ],
    },
    {
      id: uid(), name: 'Sala/Comedor', collapsed: true,
      systems: [
        {
          id: uid(), name: 'Audio', collapsed: false,
          products: [
            { id: uid(), name: 'Sonos AMP 125W per channel', description: '', imageUrl: null, system: 'Audio', quantity: 2, price: 770, laborCost: 170, costReal: 539, margin: 30, order: 0 },
            { id: uid(), name: 'Triad Distributed Audio Series 2 In-Ceiling Speaker (Each) - 6.5"', description: '', imageUrl: null, system: 'Audio', quantity: 4, price: 200, laborCost: 80, costReal: 140, margin: 30, order: 1 },
          ],
        },
        {
          id: uid(), name: 'Redes', collapsed: false,
          products: [
            { id: uid(), name: 'Ubiquiti U7-PRO | U7-PRO WiF7 AP Wireless Access Point', description: '', imageUrl: null, system: 'Redes', quantity: 1, price: 318.25, laborCost: 60, costReal: 222.78, margin: 30, order: 0 },
          ],
        },
      ],
    },
    {
      id: uid(), name: 'Site', collapsed: true,
      systems: [
        {
          id: uid(), name: 'Audio', collapsed: false,
          products: [
            { id: uid(), name: 'Bobina de 152 Metros / Cable de Cobre / 2 x 14 AWG / Tipo Audio...', description: '', imageUrl: null, system: 'Audio', quantity: 2, price: 278.58, laborCost: 69.64, costReal: 195.01, margin: 30, order: 0 },
          ],
        },
        {
          id: uid(), name: 'Redes', collapsed: false,
          products: [
            { id: uid(), name: '10G Cloud Gateway with integrated WiFi 7', description: '', imageUrl: null, system: 'Redes', quantity: 1, price: 402.50, laborCost: 100.56, costReal: 281.75, margin: 30, order: 0 },
            { id: uid(), name: 'RACK MEDIANO', description: '', imageUrl: null, system: 'Redes', quantity: 1, price: 1960.10, laborCost: 220.74, costReal: 1372.07, margin: 30, order: 1 },
            { id: uid(), name: 'UPS de 2000VA/1800W / Topología On-Line Doble Conversi...', description: '', imageUrl: null, system: 'Redes', quantity: 1, price: 714.33, laborCost: 40, costReal: 500.03, margin: 30, order: 2 },
          ],
        },
      ],
    },
  ]
}

// ═══════════════════════════════════════════════════════════════════
// STYLE CONSTANTS (matching ERP design system)
// ═══════════════════════════════════════════════════════════════════

const S = {
  input: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 12, fontFamily: 'inherit', padding: '5px 8px', textAlign: 'right' as const, width: 70 },
  inputWide: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 12, fontFamily: 'inherit', padding: '5px 8px', textAlign: 'left' as const, width: '100%' },
  th: { padding: '6px 8px', fontSize: 9, fontWeight: 600, color: '#444', textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '1px solid #222', whiteSpace: 'nowrap' as const },
  td: { padding: '6px 8px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a' },
  tdRight: { padding: '6px 8px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a', textAlign: 'right' as const },
  tdMoney: { padding: '6px 8px', fontSize: 12, fontWeight: 600, color: '#fff', borderBottom: '1px solid #1a1a1a', textAlign: 'right' as const },
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCT ROW COMPONENT
// ═══════════════════════════════════════════════════════════════════

function ProductRow({ product, onUpdate, onRemove, showInternal }: {
  product: EspProduct
  onUpdate: (id: string, field: string, value: number | string) => void
  onRemove: (id: string) => void
  showInternal: boolean
}) {
  const { precioAmpliado, moAmpliado, totalLine, costReal, utilidad } = calcProductTotals(product)

  return (
    <tr>
      {/* Image */}
      <td style={{ ...S.td, width: 50, textAlign: 'center' }}>
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 4 }} />
        ) : (
          <div style={{ width: 40, height: 40, background: '#1a1a1a', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
            <Image size={14} color="#333" />
          </div>
        )}
      </td>
      {/* Quantity */}
      <td style={{ ...S.td, width: 50 }}>
        <input type="number" value={product.quantity} min={1}
          onChange={e => onUpdate(product.id, 'quantity', parseInt(e.target.value) || 1)}
          style={{ ...S.input, width: 45 }} />
      </td>
      {/* Description */}
      <td style={{ ...S.td, minWidth: 200 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#ddd' }}>{product.name}</div>
        {product.description && <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{product.description}</div>}
      </td>
      {/* Precio unitario */}
      <td style={S.tdRight}>
        <input type="number" value={product.price} step={0.01}
          onChange={e => onUpdate(product.id, 'price', parseFloat(e.target.value) || 0)}
          style={S.input} />
      </td>
      {/* Precio Ampliado */}
      <td style={S.tdMoney}>${precioAmpliado.toFixed(2)}</td>
      {/* Mano de Obra unitaria */}
      <td style={S.tdRight}>
        <input type="number" value={product.laborCost} step={0.01}
          onChange={e => onUpdate(product.id, 'laborCost', parseFloat(e.target.value) || 0)}
          style={S.input} />
      </td>
      {/* Mano de Obra Ampliado — NOT editable, calculated */}
      {/* We show labor × qty in the "MANO DE OBRA AMPLIADO" column like the PDF */}
      {/* But the PDF actually shows total labor per line, let me check... */}
      {/* In the PDF: Qty=1, MO=$40 means $40 total. Qty=2, MO=$340 means $170 each × 2 */}
      {/* So the PDF "MANO DE OBRA AMPLIADO" = laborCost × quantity */}
      {/* But the input for laborCost should be per-unit */}
      {/* Wait — looking at the PDF more carefully: */}
      {/* Sonos AMP: Qty=2, Precio=$770, PrecioAmp=$1,540, MO Amp=$340, Total=$1,880 */}
      {/* $340 / 2 = $170 per unit. So laborCost is per unit, ampliado = laborCost × qty */}

      {/* Total */}
      <td style={{ ...S.tdMoney, color: '#57FF9A' }}>${totalLine.toFixed(2)}</td>

      {/* Internal columns */}
      {showInternal && (
        <>
          <td style={{ ...S.tdRight, color: '#555', fontSize: 10 }}>${costReal.toFixed(2)}</td>
          <td style={S.tdRight}>
            <input type="number" value={product.margin} step={1} min={0} max={99}
              onChange={e => onUpdate(product.id, 'margin', parseFloat(e.target.value) || 0)}
              style={{ ...S.input, width: 45, color: product.margin >= 25 ? '#57FF9A' : product.margin >= 15 ? '#F59E0B' : '#EF4444' }} />
          </td>
          <td style={{ ...S.tdRight, fontSize: 10, color: utilidad >= 0 ? '#57FF9A' : '#EF4444' }}>${utilidad.toFixed(2)}</td>
        </>
      )}

      {/* Delete */}
      <td style={{ ...S.td, width: 30 }}>
        <button onClick={() => onRemove(product.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}>
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SYSTEM SECTION COMPONENT
// ═══════════════════════════════════════════════════════════════════

function SystemSection({ system, onToggle, onUpdateProduct, onRemoveProduct, onAddProduct, showInternal }: {
  system: EspSystem
  onToggle: () => void
  onUpdateProduct: (prodId: string, field: string, value: number | string) => void
  onRemoveProduct: (prodId: string) => void
  onAddProduct: () => void
  showInternal: boolean
}) {
  const sysTotal = calcSystemTotal(system)
  const sysCfg = SYSTEMS_CATALOG.find(s => s.name === system.name)
  const color = sysCfg?.color || '#666'

  return (
    <div style={{ marginBottom: 16 }}>
      {/* System header */}
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', background: '#111', borderRadius: 8, marginBottom: 4 }}>
        {system.collapsed ? <ChevronRight size={14} color="#555" /> : <ChevronDown size={14} color="#555" />}
        <span style={{ fontSize: 13, fontWeight: 700, color, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{system.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: '#888' }}>{system.products.length} items</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>${sysTotal.toFixed(2)}</span>
      </div>

      {!system.collapsed && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#0e0e0e' }}>
                <th style={{ ...S.th, textAlign: 'center' }}>IMAGEN</th>
                <th style={{ ...S.th, textAlign: 'center' }}>CANT.</th>
                <th style={S.th}>DESCRIPCIÓN</th>
                <th style={{ ...S.th, textAlign: 'right' }}>PRECIO</th>
                <th style={{ ...S.th, textAlign: 'right' }}>PRECIO AMPLIADO</th>
                <th style={{ ...S.th, textAlign: 'right' }}>MANO DE OBRA</th>
                <th style={{ ...S.th, textAlign: 'right' }}>TOTAL</th>
                {showInternal && (
                  <>
                    <th style={{ ...S.th, textAlign: 'right', color: '#555' }}>COSTO</th>
                    <th style={{ ...S.th, textAlign: 'right', color: '#555' }}>MG%</th>
                    <th style={{ ...S.th, textAlign: 'right', color: '#555' }}>UTIL.</th>
                  </>
                )}
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {system.products.map(p => (
                <ProductRow
                  key={p.id}
                  product={p}
                  onUpdate={onUpdateProduct}
                  onRemove={onRemoveProduct}
                  showInternal={showInternal}
                />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={showInternal ? 11 : 8} style={{ padding: '6px 8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Btn size="sm" onClick={onAddProduct}><Plus size={12} /> Agregar producto</Btn>
                    <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
                      <span style={{ color: '#555' }}>{system.name.toUpperCase()} TOTAL</span>
                      <span style={{ fontWeight: 700, color: '#fff' }}>${sysTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AREA SECTION COMPONENT
// ═══════════════════════════════════════════════════════════════════

function AreaSection({ area, onToggle, onToggleSystem, onUpdateProduct, onRemoveProduct, onAddProduct, onAddSystem, showInternal }: {
  area: EspArea
  onToggle: () => void
  onToggleSystem: (sysId: string) => void
  onUpdateProduct: (areaId: string, sysId: string, prodId: string, field: string, value: number | string) => void
  onRemoveProduct: (areaId: string, sysId: string, prodId: string) => void
  onAddProduct: (areaId: string, sysId: string) => void
  onAddSystem: (areaId: string) => void
  showInternal: boolean
}) {
  const areaTotal = calcAreaTotal(area)

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Area header bar */}
      <div onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer',
        background: '#1a1a1a', borderRadius: 10, borderLeft: '3px solid #57FF9A',
      }}>
        {area.collapsed ? <ChevronRight size={16} color="#57FF9A" /> : <ChevronDown size={16} color="#57FF9A" />}
        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', flex: 1, textTransform: 'uppercase' as const }}>{area.name}</span>
        <span style={{ fontSize: 11, color: '#555' }}>{area.systems.length} sistemas</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#57FF9A' }}>${areaTotal.toFixed(2)}</span>
      </div>

      {!area.collapsed && (
        <div style={{ paddingLeft: 16, paddingTop: 8 }}>
          {area.systems.map(sys => (
            <SystemSection
              key={sys.id}
              system={sys}
              onToggle={() => onToggleSystem(sys.id)}
              onUpdateProduct={(prodId, field, value) => onUpdateProduct(area.id, sys.id, prodId, field, value)}
              onRemoveProduct={(prodId) => onRemoveProduct(area.id, sys.id, prodId)}
              onAddProduct={() => onAddProduct(area.id, sys.id)}
              showInternal={showInternal}
            />
          ))}
          <div style={{ padding: '4px 0' }}>
            <Btn size="sm" onClick={() => onAddSystem(area.id)}>
              <Plus size={12} /> Agregar sistema
            </Btn>
          </div>

          {/* Area total footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px', borderTop: '1px solid #222', marginTop: 8 }}>
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

function SummaryPanel({ summary, config }: { summary: EspQuoteSummary; config: EspQuoteConfig }) {
  const rows = [
    { label: 'EQUIPO TOTAL', value: summary.equipoTotal, bold: true },
    { label: 'ENVÍO TOTAL', value: 0, bold: false },
    { label: 'INGENIERÍA', value: 0, bold: false },
    { label: 'INSTALACIÓN', value: summary.instalacion, bold: false },
    { label: 'GERENCIA', value: 0, bold: false },
    { label: 'PROGRAMACIÓN', value: summary.programacion, bold: false },
    { label: 'MANO DE OBRA TOTAL', value: summary.manoObraTotal, bold: true },
    { label: 'SUBTOTAL', value: summary.subtotal, bold: true },
    { label: 'TOTAL IVA', value: summary.iva, bold: false },
    { label: 'TOTAL DEL PROYECTO', value: summary.total, bold: true, highlight: true },
  ]

  return (
    <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Resumen Financiero</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: r.bold ? '1px solid #222' : 'none' }}>
          <span style={{ fontSize: 11, color: r.highlight ? '#57FF9A' : r.bold ? '#ccc' : '#555', fontWeight: r.bold ? 700 : 400 }}>{r.label}</span>
          <span style={{ fontSize: r.highlight ? 16 : 12, fontWeight: r.bold ? 700 : 400, color: r.highlight ? '#57FF9A' : '#fff' }}>${r.value.toFixed(2)}</span>
        </div>
      ))}

      {/* Payment schedule */}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #222' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#555', textTransform: 'uppercase', marginBottom: 8 }}>Multivencimiento</div>
        {config.paymentSchedule.map((ps, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
            <span style={{ color: '#888' }}>{ps.percentage}% {ps.label}</span>
            <span style={{ color: '#ccc', fontWeight: 500 }}>${(summary.total * ps.percentage / 100).toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Currency note */}
      <div style={{ marginTop: 12, fontSize: 10, color: '#444' }}>
        * Precios en {config.currency === 'USD' ? 'dólares americanos' : 'pesos mexicanos'}. No incluyen IVA.
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN EDITOR COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function CotEditorESP({ cotId, onBack }: { cotId: string; onBack: () => void }) {
  const [areas, setAreas] = useState<EspArea[]>(buildMockData)
  const [config, setConfig] = useState<EspQuoteConfig>(DEFAULT_CONFIG)
  const [showInternal, setShowInternal] = useState(true)
  const [cotName, setCotName] = useState('Mizrahi - Miralta')
  const [clientName, setClientName] = useState('Mizrahi')
  const [projectName, setProjectName] = useState('Miralta')
  const [stage, setStage] = useState('propuesta')
  const [showAddSystem, setShowAddSystem] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // TODO: Load from Supabase using cotId
  // useEffect(() => { loadFromSupabase(cotId) }, [cotId])

  const summary = useMemo(() => calcSummary(areas, config), [areas, config])

  // ─── AREA ACTIONS ──────────────────────────────────────────────
  function addArea() {
    const name = prompt('Nombre del área (zona):')
    if (!name) return
    setAreas(prev => [...prev, { id: uid(), name, systems: [], collapsed: false }])
  }

  function toggleArea(areaId: string) {
    setAreas(prev => prev.map(a => a.id === areaId ? { ...a, collapsed: !a.collapsed } : a))
  }

  // ─── SYSTEM ACTIONS ────────────────────────────────────────────
  function toggleSystem(areaId: string, sysId: string) {
    setAreas(prev => prev.map(a => a.id === areaId ? {
      ...a, systems: a.systems.map(s => s.id === sysId ? { ...s, collapsed: !s.collapsed } : s)
    } : a))
  }

  function addSystem(areaId: string, systemName: string) {
    setAreas(prev => prev.map(a => a.id === areaId ? {
      ...a, systems: [...a.systems, { id: uid(), name: systemName, products: [], collapsed: false }]
    } : a))
    setShowAddSystem(null)
  }

  // ─── PRODUCT ACTIONS ───────────────────────────────────────────
  function addProduct(areaId: string, sysId: string) {
    const newProduct: EspProduct = {
      id: uid(), name: 'Nuevo producto', description: '', imageUrl: null,
      system: '', quantity: 1, price: 0, laborCost: 0, costReal: 0, margin: 30, order: 0,
    }
    setAreas(prev => prev.map(a => a.id === areaId ? {
      ...a, systems: a.systems.map(s => s.id === sysId ? {
        ...s, products: [...s.products, newProduct]
      } : s)
    } : a))
  }

  function updateProduct(areaId: string, sysId: string, prodId: string, field: string, value: number | string) {
    setAreas(prev => prev.map(a => a.id === areaId ? {
      ...a, systems: a.systems.map(s => s.id === sysId ? {
        ...s, products: s.products.map(p => {
          if (p.id !== prodId) return p
          const updated = { ...p, [field]: value }
          // Recalculate costReal when price or margin changes
          if (field === 'price' || field === 'margin') {
            updated.costReal = updated.price * (1 - updated.margin / 100)
          }
          return updated
        })
      } : s)
    } : a))
  }

  function removeProduct(areaId: string, sysId: string, prodId: string) {
    setAreas(prev => prev.map(a => a.id === areaId ? {
      ...a, systems: a.systems.map(s => s.id === sysId ? {
        ...s, products: s.products.filter(p => p.id !== prodId)
      } : s)
    } : a))
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
        <span style={{ fontSize: 12, fontWeight: 500, color: '#57FF9A' }}>◈ {cotName}</span>
        <Badge label="ESP" color="#57FF9A" />
        <span style={{ fontSize: 11, color: '#555' }}>{clientName}</span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {(Object.entries(STAGE_CONFIG) as Array<[string, { label: string; color: string }]>).map(([s, cfg]) => (
            <button key={s} onClick={() => setStage(s)} style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid ' + (stage === s ? cfg.color : '#333'),
              background: stage === s ? cfg.color + '22' : 'transparent',
              color: stage === s ? cfg.color : '#555',
            }}>{cfg.label}</button>
          ))}

          {/* Toggle internal view */}
          <button onClick={() => setShowInternal(!showInternal)} style={{
            padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            border: '1px solid ' + (showInternal ? '#F59E0B' : '#333'),
            background: showInternal ? '#F59E0B22' : 'transparent',
            color: showInternal ? '#F59E0B' : '#555', marginLeft: 8,
          }}>
            {showInternal ? '👁 Interno' : '👁 Cliente'}
          </button>

          <span style={{ fontSize: 16, fontWeight: 700, color: '#57FF9A', marginLeft: 12 }}>${summary.total.toFixed(2)}</span>
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', flex: 1, overflow: 'hidden' }}>
        {/* Left: Areas / Systems / Products */}
        <div style={{ overflowY: 'auto', padding: '16px 20px' }}>
          {areas.map(area => (
            <AreaSection
              key={area.id}
              area={area}
              onToggle={() => toggleArea(area.id)}
              onToggleSystem={(sysId) => toggleSystem(area.id, sysId)}
              onUpdateProduct={updateProduct}
              onRemoveProduct={removeProduct}
              onAddProduct={(aId, sId) => addProduct(aId, sId)}
              onAddSystem={(aId) => setShowAddSystem(aId)}
              showInternal={showInternal}
            />
          ))}

          {/* Add area button */}
          <div onClick={addArea} style={{
            padding: '14px', border: '1px dashed #333', borderRadius: 10, textAlign: 'center',
            cursor: 'pointer', color: '#444', fontSize: 12, fontWeight: 500,
          }}>
            + Agregar área (zona)
          </div>
        </div>

        {/* Right: Summary panel */}
        <div style={{ borderLeft: '1px solid #222', overflowY: 'auto', padding: '16px', background: '#0e0e0e' }}>
          <SummaryPanel summary={summary} config={config} />

          {/* Area breakdown */}
          <div style={{ marginTop: 16, background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Por Área</div>
            {areas.map(area => {
              const aTotal = calcAreaTotal(area)
              const pct = summary.subtotal > 0 ? Math.round(aTotal / summary.subtotal * 100) : 0
              return (
                <div key={area.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11 }}>
                  <span style={{ color: '#888' }}>{area.name}</span>
                  <span style={{ color: '#ccc', fontWeight: 500 }}>${aTotal.toFixed(2)} <span style={{ color: '#444' }}>({pct}%)</span></span>
                </div>
              )
            })}
          </div>

          {/* Internal margin summary */}
          {showInternal && (
            <div style={{ marginTop: 16, background: '#1a1414', border: '1px solid #332222', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Análisis Interno</div>
              {(() => {
                let totalVenta = 0
                let totalCosto = 0
                areas.forEach(a => a.systems.forEach(s => s.products.forEach(p => {
                  totalVenta += p.price * p.quantity
                  totalCosto += p.price * (1 - p.margin / 100) * p.quantity
                })))
                const margenGlobal = totalVenta > 0 ? Math.round((totalVenta - totalCosto) / totalVenta * 100) : 0
                return (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11 }}>
                      <span style={{ color: '#888' }}>Venta equipo</span>
                      <span style={{ color: '#fff', fontWeight: 600 }}>${totalVenta.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11 }}>
                      <span style={{ color: '#888' }}>Costo real</span>
                      <span style={{ color: '#ccc' }}>${totalCosto.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11, borderTop: '1px solid #332222', marginTop: 4, paddingTop: 8 }}>
                      <span style={{ color: '#F59E0B', fontWeight: 600 }}>Margen global</span>
                      <span style={{ color: margenGlobal >= 25 ? '#57FF9A' : margenGlobal >= 15 ? '#F59E0B' : '#EF4444', fontWeight: 700, fontSize: 14 }}>{margenGlobal}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11 }}>
                      <span style={{ color: '#888' }}>Utilidad equipo</span>
                      <span style={{ color: '#57FF9A', fontWeight: 600 }}>${(totalVenta - totalCosto).toFixed(2)}</span>
                    </div>
                  </>
                )
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Add system modal */}
      {showAddSystem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 360 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Agregar sistema</div>
              <button onClick={() => setShowAddSystem(null)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
              {SYSTEMS_CATALOG.map(sys => {
                const areaObj = areas.find(a => a.id === showAddSystem)
                const alreadyAdded = areaObj?.systems.some(s => s.name === sys.name)
                return (
                  <button key={sys.id} onClick={() => !alreadyAdded && addSystem(showAddSystem, sys.name)}
                    disabled={alreadyAdded}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      background: alreadyAdded ? '#0e0e0e' : '#1a1a1a',
                      border: '1px solid ' + (alreadyAdded ? '#1a1a1a' : '#222'),
                      borderRadius: 10, cursor: alreadyAdded ? 'not-allowed' : 'pointer',
                      color: alreadyAdded ? '#333' : '#ccc', fontSize: 13, fontFamily: 'inherit', textAlign: 'left' as const,
                      opacity: alreadyAdded ? 0.5 : 1,
                    }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: sys.color, flexShrink: 0 }} />
                    {sys.name}
                    {alreadyAdded && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#444' }}>ya agregado</span>}
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
