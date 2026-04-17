import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { F, STAGE_CONFIG } from '../lib/utils'
import { Badge, Btn, Loading } from '../components/layout/UI'
import { Plus, ChevronLeft, ChevronDown, ChevronRight, X, Trash2, Settings, Copy, Printer } from 'lucide-react'
import { OMNIIOUS_LOGO } from '../assets/logo'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface CortConfig {
  currency: 'USD' | 'MXN'
  tipoCambio: number
  ivaRate: number
  instPct: number        // installation % (default 15)
  margenTela: number     // margin on fabric (%)
  margenMotor: number    // margin on motors/hardware (%)
}

// Each curtain line item
interface CortItem {
  id: string
  areaId: string
  ubicacion: string      // e.g. "Ventana Sala", "Recámara Principal"
  ancho: number          // window width in meters
  alto: number           // window height in meters
  cantidad: number       // qty of identical curtains
  tipoCierre: 'MANUAL' | 'MOTORIZADO'
  motorBrand: 'SOMFY' | 'LUTRON' | 'NINGUNO'
  motorSystem: string    // e.g. "MOVELITE 35 KG", "GLYDEA35WT", "ALENA QS", "SIVOIA QS"
  // Somfy config (when motorBrand=SOMFY)
  somfyHojas: 1 | 2
  somfyPliegue: 'TRADICIONAL' | 'ONDULADO'
  somfyAbundancia: number
  somfySoportePared: boolean
  somfyAmrado: boolean
  somfyCurveado: boolean
  // Fabric
  tipoTela: string       // e.g. "TRASLUCIDA", "BLACKOUT", "SHEER"
  anchoTela: number      // fabric width in meters (manual input)
  tipoPliegue: string    // e.g. "ONDA PERFECTA", "PLANO", "TABLEADO"
  // Pricing (manual or calculated)
  precioTelaPorML: number
  precioConfeccion: number  // confection/sewing price per curtain
  telaIncluida: boolean     // true = client provides own fabric (no fabric charge)
  precioMotor: number    // manual for Lutron, auto-calculated for Somfy
  // DB tracking
  order: number
}

interface CortArea {
  id: string
  name: string
  collapsed: boolean
  order: number
}

// ═══════════════════════════════════════════════════════════════════
// SOMFY PRICING LOGIC
// Extracted from "cotizadores Elias OMM Noviembre 2026.xlsx"
// ═══════════════════════════════════════════════════════════════════

interface SomfyBOMLine {
  concepto: string
  cantidad: number
  precioUnitario: number
  total: number
}

// MOVELITE unit prices (MXN)
const MOVELITE_PRICES: Record<string, number> = {
  'RIEL': 1104.80,
  'CINTA': 58.40,
  'SOPORTE_TECHO': 11.20,
  'SOPORTE_PARED': 60.00,
  'MOVELITE_35KG': 2684.00,
  'MOVELITE_BATERIA': 4539.20,
  'MOVELITE_50RTS': 3852.00,
  'BOLA_TOPE': 33.60,
  'PASADOR_DESLIZANTE': 30.80,
  'ONDULADO_RUNNER': 20.00,
  'ONDULADO_CLIP': 5.60,
  'CONTROL_SITUO1': 1299.20,
  'CONTROL_SITUO5': 1659.20,
}

// GLYDEA unit prices (MXN)
const GLYDEA_PRICES: Record<string, number> = {
  'RIEL': 1104.80,
  'CINTA': 58.40,
  'SOPORTE_TECHO': 11.20,
  'SOPORTE_PARED': 60.00,
  'GLYDEA35WT': 4167.20,
  'GLYDEA60WT': 4539.20,
  'GLYDEA60E_ULTRA_RTS': 6655.20,
  'GLYDEA35_ULTRA_RTS': 5222.40,
  'IRISMO_WIREFREE': 5632.00,
  'BOLA_TOPE': 33.60,
  'PASADOR_DESLIZANTE': 30.80,
  'ONDULADO_RUNNER': 20.00,
  'ONDULADO_CLIP': 5.60,
  'CONTROL_SITUO1': 1299.20,
  'CONTROL_SITUO5': 1659.20,
}

const SOMFY_MOVELITE_SYSTEMS = ['MOVELITE 35 KG', 'MOVELITE BATERIA RECARGABLE', 'MOVELITE 50 RTS']
const SOMFY_GLYDEA_SYSTEMS = ['GLYDEA35WT', 'GLYDEA60WT', 'GLYDEA60E ULTRA RTS', 'GLYDEA35 ULTRA RTS', 'IRISMO WIREFREE']
const ALL_SOMFY_SYSTEMS = [...SOMFY_MOVELITE_SYSTEMS, ...SOMFY_GLYDEA_SYSTEMS]

const LUTRON_SYSTEMS = ['ALENA QS', 'SIVOIA QS']
const TIPO_TELA_OPTIONS = ['TRASLUCIDA', 'BLACKOUT', 'SHEER', 'SCREEN', 'LINO', 'OTRA']
const TIPO_PLIEGUE_OPTIONS = ['ONDA PERFECTA', 'PLANO', 'TABLEADO', 'ONDULADO', 'TRADICIONAL']

function calcSomfyBOM(item: CortItem): SomfyBOMLine[] {
  const lines: SomfyBOMLine[] = []
  const ancho = item.ancho
  const isGlydea = SOMFY_GLYDEA_SYSTEMS.includes(item.motorSystem)
  const prices = isGlydea ? GLYDEA_PRICES : MOVELITE_PRICES
  const isOndulado = item.somfyPliegue === 'ONDULADO'

  // Riel: if width > 5m, need 2 rails
  const cantRiel = ancho > 5 ? 2 : 1
  lines.push({ concepto: 'Riel', cantidad: cantRiel, precioUnitario: prices['RIEL'], total: cantRiel * prices['RIEL'] })

  // Cinta (belt): ((ancho + 0.14) * 2) + 0.36 per hoja
  const cantCinta = ((ancho + 0.14) * 2 + 0.36) * item.somfyHojas
  const cintaTotal = Math.round(cantCinta * prices['CINTA'] * 100) / 100
  lines.push({ concepto: 'Cinta', cantidad: Math.round(cantCinta * 100) / 100, precioUnitario: prices['CINTA'], total: cintaTotal })

  // Soportes techo: (ancho/5) * 7
  const cantSopTecho = Math.ceil((ancho / 5) * 7)
  lines.push({ concepto: 'Soporte techo', cantidad: cantSopTecho, precioUnitario: prices['SOPORTE_TECHO'], total: cantSopTecho * prices['SOPORTE_TECHO'] })

  // Soportes pared (conditional)
  if (item.somfySoportePared) {
    const cantSopPared = item.somfyHojas === 2 ? 4 : 2
    lines.push({ concepto: 'Soporte pared', cantidad: cantSopPared, precioUnitario: prices['SOPORTE_PARED'], total: cantSopPared * prices['SOPORTE_PARED'] })
  }

  // Motor
  const motorKey = item.motorSystem.replace(/ /g, '_').replace(/-/g, '_').toUpperCase()
  const motorKeyLookup = isGlydea ? motorKey : (
    item.motorSystem === 'MOVELITE 35 KG' ? 'MOVELITE_35KG' :
    item.motorSystem === 'MOVELITE BATERIA RECARGABLE' ? 'MOVELITE_BATERIA' :
    item.motorSystem === 'MOVELITE 50 RTS' ? 'MOVELITE_50RTS' : motorKey
  )
  const motorPrice = prices[motorKeyLookup] || 0
  lines.push({ concepto: 'Motor ' + item.motorSystem, cantidad: 1, precioUnitario: motorPrice, total: motorPrice })

  // Bola tope
  const cantBola = item.somfyHojas === 2 ? 4 : 2
  lines.push({ concepto: 'Bola tope', cantidad: cantBola, precioUnitario: prices['BOLA_TOPE'], total: cantBola * prices['BOLA_TOPE'] })

  // Pasador deslizante
  const cantPasador = item.somfyHojas === 2 ? 2 : 1
  lines.push({ concepto: 'Pasador deslizante', cantidad: cantPasador, precioUnitario: prices['PASADOR_DESLIZANTE'], total: cantPasador * prices['PASADOR_DESLIZANTE'] })

  // Ondulado runners (only if pliegue = ONDULADO)
  if (isOndulado) {
    const cantRunners = Math.ceil((105 / 5) * ancho)
    lines.push({ concepto: 'Ondulado runners', cantidad: cantRunners, precioUnitario: prices['ONDULADO_RUNNER'], total: cantRunners * prices['ONDULADO_RUNNER'] })
    const cantClips = cantRunners
    lines.push({ concepto: 'Ondulado clips', cantidad: cantClips, precioUnitario: prices['ONDULADO_CLIP'], total: cantClips * prices['ONDULADO_CLIP'] })
  }

  // Control (1 per motor)
  lines.push({ concepto: 'Control Situo 1', cantidad: 1, precioUnitario: prices['CONTROL_SITUO1'], total: prices['CONTROL_SITUO1'] })

  return lines
}

function calcSomfyTotal(item: CortItem): number {
  return calcSomfyBOM(item).reduce((s, l) => s + l.total, 0)
}

// ═══════════════════════════════════════════════════════════════════
// FABRIC CALCULATION
// Formula: (anchoTela por ML) / alto * 2.5 * ancho_ventana
// But really: cantidadTela = ceil((ancho * 2.5) / anchoTela) * alto
// The user said: (Ancho de la tela por ML)/Altura*2.5*Ancho de la ventana
// Interpreted as: cantidad_ML = (alto * 2.5 * ancho) / anchoTela
// ═══════════════════════════════════════════════════════════════════

function calcFabricML(item: CortItem): number {
  if (item.anchoTela <= 0 || item.alto <= 0) return 0
  // ML of fabric needed = (alto * 2.5 * ancho) / anchoTela
  return Math.round((item.alto * 2.5 * item.ancho) / item.anchoTela * 100) / 100
}

function calcFabricCost(item: CortItem): number {
  if (item.telaIncluida) return 0
  return Math.round(calcFabricML(item) * item.precioTelaPorML * item.cantidad * 100) / 100
}

function calcConfeccionCost(item: CortItem): number {
  return Math.round(item.precioConfeccion * item.cantidad * 100) / 100
}

// ═══════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════

const S = {
  input: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 12, fontFamily: 'inherit', padding: '5px 8px', textAlign: 'right' as const, width: 70 },
  select: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 11, fontFamily: 'inherit', padding: '5px 6px' },
  th: { padding: '6px 8px', fontSize: 9, fontWeight: 600, color: '#444', textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '1px solid #222', whiteSpace: 'nowrap' as const },
  td: { padding: '5px 6px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a' },
  tdR: { padding: '5px 6px', fontSize: 12, color: '#ccc', borderBottom: '1px solid #1a1a1a', textAlign: 'right' as const },
  tdM: { padding: '5px 6px', fontSize: 12, fontWeight: 600, color: '#fff', borderBottom: '1px solid #1a1a1a', textAlign: 'right' as const },
}

function uid(): string { return Math.random().toString(36).slice(2, 10) }

function defaultItem(areaId: string, order: number): CortItem {
  return {
    id: uid(), areaId, ubicacion: '', ancho: 0, alto: 0, cantidad: 1,
    tipoCierre: 'MANUAL', motorBrand: 'NINGUNO', motorSystem: '',
    somfyHojas: 1, somfyPliegue: 'TRADICIONAL', somfyAbundancia: 0,
    somfySoportePared: false, somfyAmrado: false, somfyCurveado: false,
    tipoTela: 'TRASLUCIDA', anchoTela: 0, tipoPliegue: 'ONDA PERFECTA',
    precioTelaPorML: 0, precioConfeccion: 0, telaIncluida: false, precioMotor: 0, order,
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOMFY DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════
function SomfyDetailModal({ item, onClose }: { item: CortItem; onClose: () => void }) {
  const bom = calcSomfyBOM(item)
  const total = bom.reduce((s, l) => s + l.total, 0)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1030, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 550, maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Desglose Somfy</div>
            <div style={{ fontSize: 11, color: '#14B8A6' }}>{item.motorSystem} | {item.ancho}m ancho</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#0e0e0e' }}>
            <th style={{ ...S.th, textAlign: 'left' }}>Concepto</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Cant.</th>
            <th style={{ ...S.th, textAlign: 'right' }}>P. Unit.</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Total</th>
          </tr></thead>
          <tbody>
            {bom.map((l, i) => (
              <tr key={i}>
                <td style={S.td}>{l.concepto}</td>
                <td style={S.tdR}>{l.cantidad}</td>
                <td style={S.tdR}>${l.precioUnitario.toFixed(2)}</td>
                <td style={S.tdM}>${l.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #333' }}>
              <td colSpan={3} style={{ ...S.td, fontWeight: 700, color: '#14B8A6' }}>TOTAL MOTOR + HARDWARE</td>
              <td style={{ ...S.tdM, color: '#14B8A6', fontSize: 14 }}>${total.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        <div style={{ marginTop: 12, fontSize: 10, color: '#555' }}>
          Config: {item.somfyHojas} hoja(s) | {item.somfyPliegue} | Soporte pared: {item.somfySoportePared ? 'Si' : 'No'}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PDF PROPOSAL MODAL
// ═══════════════════════════════════════════════════════════════════
function CortPdfModal({ items, areas, config, cotName, clientName, projectName, onClose }: {
  items: CortItem[]; areas: CortArea[]; config: CortConfig
  cotName: string; clientName: string; projectName: string
  onClose: () => void
}) {
  // Calculate totals
  let telaCost = 0, confCost = 0, motorCost = 0
  items.forEach(item => {
    telaCost += calcFabricCost(item)
    confCost += calcConfeccionCost(item)
    if (item.tipoCierre === 'MOTORIZADO') {
      motorCost += item.motorBrand === 'SOMFY' ? calcSomfyTotal(item) * item.cantidad : item.precioMotor * item.cantidad
    }
  })
  const telaVenta = config.margenTela > 0 ? Math.round(telaCost / (1 - config.margenTela / 100) * 100) / 100 : telaCost
  const confVenta = config.margenTela > 0 ? Math.round(confCost / (1 - config.margenTela / 100) * 100) / 100 : confCost
  const motorVenta = config.margenMotor > 0 ? Math.round(motorCost / (1 - config.margenMotor / 100) * 100) / 100 : motorCost
  const subtotalVenta = telaVenta + confVenta + motorVenta
  const instalacion = Math.round(subtotalVenta * config.instPct / 100 * 100) / 100
  const subConInst = subtotalVenta + instalacion
  const iva = Math.round(subConInst * config.ivaRate / 100 * 100) / 100
  const total = subConInst + iva

  const manualCount = items.filter(i => i.tipoCierre === 'MANUAL').reduce((s, i) => s + i.cantidad, 0)
  const motorCount = items.filter(i => i.tipoCierre === 'MOTORIZADO').reduce((s, i) => s + i.cantidad, 0)

  return (
    <div className="cort-pdf-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1040, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 32, width: '8.5in', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
        {/* Print styles */}
        <style>{`
          @media print {
            body > *:not(.cort-pdf-overlay) { display: none !important; }
            .cort-pdf-overlay { position: static !important; background: white !important; }
            .cort-pdf-overlay > div { box-shadow: none !important; max-height: none !important; overflow: visible !important; }
            .cort-pdf-no-print { display: none !important; }
          }
        `}</style>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#000', marginBottom: 4 }}>PROPUESTA CORTINAS Y PERSIANAS</div>
            <div style={{ fontSize: 11, color: '#555' }}>OMM Technologies SA de CV</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ textAlign: 'right', fontSize: 10, color: '#666' }}>
              <div style={{ marginBottom: 4 }}>Fecha: {new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
              <div>Vigencia: 1 mes</div>
            </div>
            {OMNIIOUS_LOGO && <img src={OMNIIOUS_LOGO} alt="OMM" style={{ height: 36, objectFit: 'contain' }} />}
          </div>
        </div>

        {/* Project info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20, fontSize: 10, borderBottom: '1px solid #ddd', paddingBottom: 12 }}>
          <div><span style={{ fontWeight: 600, color: '#000' }}>Proyecto:</span> <span style={{ color: '#444' }}>{projectName || '---'}</span></div>
          <div><span style={{ fontWeight: 600, color: '#000' }}>Cliente:</span> <span style={{ color: '#444' }}>{clientName || '---'}</span></div>
          <div><span style={{ fontWeight: 600, color: '#000' }}>Total:</span> <span style={{ color: '#000', fontWeight: 700 }}>${total.toFixed(2)}</span></div>
          <div><span style={{ fontWeight: 600, color: '#000' }}>Ubicación:</span> <span style={{ color: '#444' }}>---</span></div>
        </div>

        {/* Items table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20, fontSize: 9 }}>
          <thead>
            <tr style={{ background: '#f3f3f3', borderBottom: '2px solid #000' }}>
              <th style={{ textAlign: 'left', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Ubicación</th>
              <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Ancho</th>
              <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Alto</th>
              <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Cant</th>
              <th style={{ textAlign: 'left', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Motor / Tipo</th>
              <th style={{ textAlign: 'left', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Tipo Tela</th>
              <th style={{ textAlign: 'left', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Pliegue</th>
              <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Confección</th>
              <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Tela</th>
              <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Motor</th>
              <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Total</th>
              <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000', fontSize: 8 }}>Mon.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const itemFabricCost = calcFabricCost(item)
              const itemConfCost = calcConfeccionCost(item)
              const itemMotorCost = item.tipoCierre === 'MOTORIZADO' ? (item.motorBrand === 'SOMFY' ? calcSomfyTotal(item) * item.cantidad : item.precioMotor * item.cantidad) : 0
              // Apply margins for client-facing PDF
              const mT = config.margenTela > 0 ? 1 / (1 - config.margenTela / 100) : 1
              const mM = config.margenMotor > 0 ? 1 / (1 - config.margenMotor / 100) : 1
              const itemTelaVenta = Math.round(itemFabricCost * mT * 100) / 100
              const itemConfVenta = Math.round(itemConfCost * mT * 100) / 100
              const itemMotorVenta = Math.round(itemMotorCost * mM * 100) / 100
              const itemTotalVenta = itemTelaVenta + itemConfVenta + itemMotorVenta
              const moneda = item.motorBrand === 'LUTRON' ? 'USD' : 'MXN'
              return (
                <tr key={item.id} style={{ borderBottom: '1px solid #e0e0e0' }}>
                  <td style={{ textAlign: 'left', padding: '4px', color: '#000' }}>{item.ubicacion}</td>
                  <td style={{ textAlign: 'right', padding: '4px', color: '#444' }}>{item.ancho.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', padding: '4px', color: '#444' }}>{item.alto.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', padding: '4px', color: '#444' }}>{item.cantidad}</td>
                  <td style={{ textAlign: 'left', padding: '4px', color: '#444' }}>{item.tipoCierre === 'MANUAL' ? 'Manual' : item.motorSystem || 'Motorizado'}</td>
                  <td style={{ textAlign: 'left', padding: '4px', color: '#444' }}>{item.tipoTela}</td>
                  <td style={{ textAlign: 'left', padding: '4px', color: '#444' }}>{item.tipoPliegue}</td>
                  <td style={{ textAlign: 'right', padding: '4px', color: '#000' }}>${itemConfVenta.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', padding: '4px', color: item.telaIncluida ? '#999' : '#000', fontStyle: item.telaIncluida ? 'italic' : 'normal' }}>{item.telaIncluida ? 'CLIENTE' : '$' + itemTelaVenta.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', padding: '4px', color: '#000' }}>{itemMotorCost > 0 ? '$' + itemMotorVenta.toFixed(2) : '---'}</td>
                  <td style={{ textAlign: 'right', padding: '4px', color: '#000', fontWeight: 700 }}>${itemTotalVenta.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', padding: '4px', color: '#888', fontSize: 8 }}>{moneda}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Summary */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 8, fontSize: 10 }}>
            <div style={{ textAlign: 'right', color: '#555' }}>Persianas Manuales:</div>
            <div style={{ textAlign: 'right', fontWeight: 600, color: '#000' }}>{manualCount}</div>
            <div style={{ textAlign: 'right', color: '#555' }}>Total Motorización:</div>
            <div style={{ textAlign: 'right', fontWeight: 600, color: '#000' }}>${motorVenta.toFixed(2)}</div>
            <div style={{ textAlign: 'right', color: '#555' }}>Instalación ({config.instPct}%):</div>
            <div style={{ textAlign: 'right', fontWeight: 600, color: '#000' }}>${instalacion.toFixed(2)}</div>
            <div style={{ textAlign: 'right', color: '#555', borderTop: '1px solid #000', paddingTop: 4 }}>Subtotal:</div>
            <div style={{ textAlign: 'right', fontWeight: 600, color: '#000', borderTop: '1px solid #000', paddingTop: 4 }}>${subtotalVenta.toFixed(2)}</div>
            <div style={{ textAlign: 'right', color: '#555' }}>IVA ({config.ivaRate}%):</div>
            <div style={{ textAlign: 'right', fontWeight: 600, color: '#000' }}>${iva.toFixed(2)}</div>
            <div style={{ textAlign: 'right', fontWeight: 700, color: '#000', fontSize: 11, borderTop: '2px solid #000', paddingTop: 6 }}>TOTAL FINAL:</div>
            <div style={{ textAlign: 'right', fontWeight: 700, color: '#000', fontSize: 11, borderTop: '2px solid #000', paddingTop: 6 }}>${total.toFixed(2)}</div>
          </div>
        </div>

        {/* Conditions */}
        <div style={{ fontSize: 8, color: '#666', borderTop: '1px solid #ddd', paddingTop: 12 }}>
          <div style={{ fontWeight: 600, color: '#333', marginBottom: 6, fontSize: 9, textTransform: 'uppercase' }}>Condiciones Generales</div>
          <div style={{ marginBottom: 3 }}>• Presupuesto sujeto a condiciones de entrega y disponibilidad de materiales.</div>
          <div style={{ marginBottom: 3 }}>• Vigencia de 1 mes a partir de la fecha de emisión.</div>
          <div style={{ marginBottom: 3 }}>• Tela y confección en MXN. Motores Somfy en MXN. Motores Lutron en USD (TC ${config.tipoCambio.toFixed(2)}).</div>
          {items.some(i => i.telaIncluida) && <div style={{ marginBottom: 3 }}>• Las partidas marcadas "CLIENTE" indican que la tela es suministrada por el cliente. Solo se cobra confección e instalación.</div>}
          <div style={{ marginBottom: 3 }}>• Instalación incluida ({config.instPct}% sobre subtotal).</div>
          <div>• Precios más IVA ({config.ivaRate}%).</div>
        </div>

        {/* Footer buttons */}
        <div className="cort-pdf-no-print" style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'center' }}>
          <button onClick={() => window.print()} style={{ padding: '8px 16px', background: '#000', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Imprimir / Guardar PDF</button>
          <button onClick={onClose} style={{ padding: '8px 16px', background: '#eee', color: '#000', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CURTAIN ROW
// ═══════════════════════════════════════════════════════════════════
function CortRow({ item, config, onUpdate, onRemove, onShowSomfy, showInt }: {
  item: CortItem; config: CortConfig
  onUpdate: (id: string, field: string, value: any) => void
  onRemove: (id: string) => void
  onShowSomfy: (item: CortItem) => void
  showInt: boolean
}) {
  const fabricML = calcFabricML(item)
  const fabricCost = calcFabricCost(item)
  const confeccionCost = calcConfeccionCost(item)

  // Motor cost
  let motorCost = 0
  if (item.tipoCierre === 'MOTORIZADO') {
    if (item.motorBrand === 'SOMFY') {
      motorCost = calcSomfyTotal(item) * item.cantidad
    } else {
      motorCost = item.precioMotor * item.cantidad
    }
  }

  const totalTela = fabricCost
  const totalConf = confeccionCost
  const totalMotor = motorCost
  const totalLinea = totalTela + totalConf + totalMotor

  // With margin
  const precioTelaConMargen = config.margenTela > 0 ? Math.round(totalTela / (1 - config.margenTela / 100) * 100) / 100 : totalTela
  const precioConfConMargen = config.margenTela > 0 ? Math.round(totalConf / (1 - config.margenTela / 100) * 100) / 100 : totalConf
  const precioMotorConMargen = config.margenMotor > 0 ? Math.round(totalMotor / (1 - config.margenMotor / 100) * 100) / 100 : totalMotor
  const totalConMargen = precioTelaConMargen + precioConfConMargen + precioMotorConMargen

  const motorSystems = item.motorBrand === 'SOMFY' ? ALL_SOMFY_SYSTEMS
    : item.motorBrand === 'LUTRON' ? LUTRON_SYSTEMS : []

  return (
    <tr>
      <td style={{ ...S.td, minWidth: 130 }}>
        <input value={item.ubicacion} onChange={e => onUpdate(item.id, 'ubicacion', e.target.value)}
          placeholder="Ubicacion..." style={{ ...S.input, textAlign: 'left', width: '100%' }} />
      </td>
      <td style={S.td}>
        <input type="number" defaultValue={item.ancho} step={0.01} min={0}
          onBlur={e => onUpdate(item.id, 'ancho', parseFloat(e.target.value) || 0)}
          style={{ ...S.input, width: 55 }} />
      </td>
      <td style={S.td}>
        <input type="number" defaultValue={item.alto} step={0.01} min={0}
          onBlur={e => onUpdate(item.id, 'alto', parseFloat(e.target.value) || 0)}
          style={{ ...S.input, width: 55 }} />
      </td>
      <td style={S.td}>
        <input type="number" defaultValue={item.cantidad} min={1}
          onBlur={e => onUpdate(item.id, 'cantidad', parseInt(e.target.value) || 1)}
          style={{ ...S.input, width: 40 }} />
      </td>
      <td style={S.td}>
        <select value={item.tipoCierre} onChange={e => {
          const v = e.target.value as 'MANUAL' | 'MOTORIZADO'
          onUpdate(item.id, 'tipoCierre', v)
          if (v === 'MANUAL') {
            onUpdate(item.id, 'motorBrand', 'NINGUNO')
            onUpdate(item.id, 'motorSystem', '')
          }
        }} style={S.select}>
          <option value="MANUAL">Manual</option>
          <option value="MOTORIZADO">Motorizado</option>
        </select>
      </td>
      <td style={S.td}>
        {item.tipoCierre === 'MOTORIZADO' ? (
          <div style={{ display: 'flex', gap: 4, flexDirection: 'column' }}>
            <select value={item.motorBrand} onChange={e => {
              const brand = e.target.value as 'SOMFY' | 'LUTRON' | 'NINGUNO'
              onUpdate(item.id, 'motorBrand', brand)
              if (brand === 'SOMFY') onUpdate(item.id, 'motorSystem', SOMFY_MOVELITE_SYSTEMS[0])
              else if (brand === 'LUTRON') onUpdate(item.id, 'motorSystem', LUTRON_SYSTEMS[0])
              else onUpdate(item.id, 'motorSystem', '')
            }} style={{ ...S.select, fontSize: 10 }}>
              <option value="NINGUNO">--</option>
              <option value="SOMFY">Somfy</option>
              <option value="LUTRON">Lutron</option>
            </select>
            {motorSystems.length > 0 && (
              <select value={item.motorSystem} onChange={e => onUpdate(item.id, 'motorSystem', e.target.value)}
                style={{ ...S.select, fontSize: 10 }}>
                {motorSystems.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {item.motorBrand === 'SOMFY' && (
              <button onClick={() => onShowSomfy(item)} style={{ background: 'none', border: '1px solid #14B8A633', borderRadius: 4, color: '#14B8A6', fontSize: 9, cursor: 'pointer', padding: '2px 6px' }}>
                Ver desglose
              </button>
            )}
          </div>
        ) : <span style={{ color: '#444', fontSize: 10 }}>--</span>}
      </td>
      {/* Somfy config (inline mini) */}
      <td style={S.td}>
        {item.motorBrand === 'SOMFY' ? (
          <div style={{ display: 'flex', gap: 3, flexDirection: 'column', fontSize: 10 }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ color: '#555' }}>H:</span>
              <select value={item.somfyHojas} onChange={e => onUpdate(item.id, 'somfyHojas', parseInt(e.target.value))}
                style={{ ...S.select, fontSize: 10, width: 38, padding: '2px 3px' }}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ color: '#555' }}>P:</span>
              <select value={item.somfyPliegue} onChange={e => onUpdate(item.id, 'somfyPliegue', e.target.value)}
                style={{ ...S.select, fontSize: 10, padding: '2px 3px' }}>
                <option value="TRADICIONAL">Trad</option>
                <option value="ONDULADO">Ond</option>
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#666', cursor: 'pointer' }}>
              <input type="checkbox" checked={item.somfySoportePared} onChange={e => onUpdate(item.id, 'somfySoportePared', e.target.checked)} style={{ width: 12, height: 12 }} />
              Pared
            </label>
          </div>
        ) : <span style={{ color: '#333', fontSize: 10 }}>--</span>}
      </td>
      {/* Fabric */}
      <td style={S.td}>
        <select value={item.tipoTela} onChange={e => onUpdate(item.id, 'tipoTela', e.target.value)} style={{ ...S.select, fontSize: 10 }}>
          {TIPO_TELA_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td style={S.td}>
        <select value={item.tipoPliegue} onChange={e => onUpdate(item.id, 'tipoPliegue', e.target.value)} style={{ ...S.select, fontSize: 10 }}>
          {TIPO_PLIEGUE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td style={S.td}>
        <input type="number" defaultValue={item.anchoTela} step={0.01} min={0}
          onBlur={e => onUpdate(item.id, 'anchoTela', parseFloat(e.target.value) || 0)}
          style={{ ...S.input, width: 50 }} />
      </td>
      <td style={S.td}>
        <input type="number" defaultValue={item.precioTelaPorML} step={1} min={0}
          onBlur={e => onUpdate(item.id, 'precioTelaPorML', parseFloat(e.target.value) || 0)}
          style={{ ...S.input, width: 60 }} />
      </td>
      <td style={S.td}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
          <input type="checkbox" checked={item.telaIncluida} onChange={e => onUpdate(item.id, 'telaIncluida', e.target.checked)} style={{ width: 12, height: 12 }} />
          <span style={{ fontSize: 9, color: item.telaIncluida ? '#F59E0B' : '#555' }}>Cliente</span>
        </label>
      </td>
      <td style={{ ...S.tdR, fontSize: 11, color: '#888' }}>{fabricML.toFixed(2)}</td>
      <td style={S.tdM}>${fabricCost.toFixed(2)}</td>
      <td style={S.td}>
        <input type="number" defaultValue={item.precioConfeccion} step={1} min={0}
          onBlur={e => onUpdate(item.id, 'precioConfeccion', parseFloat(e.target.value) || 0)}
          style={{ ...S.input, width: 60 }} />
      </td>
      <td style={S.tdM}>${confeccionCost.toFixed(2)}</td>
      <td style={S.td}>
        {item.tipoCierre === 'MOTORIZADO' && item.motorBrand === 'LUTRON' ? (
          <input type="number" defaultValue={item.precioMotor} step={1} min={0}
            onBlur={e => onUpdate(item.id, 'precioMotor', parseFloat(e.target.value) || 0)}
            style={{ ...S.input, width: 70 }} />
        ) : item.tipoCierre === 'MOTORIZADO' && item.motorBrand === 'SOMFY' ? (
          <span style={{ color: '#14B8A6', fontWeight: 600, fontSize: 12 }}>${(calcSomfyTotal(item) * item.cantidad).toFixed(2)}</span>
        ) : <span style={{ color: '#444' }}>--</span>}
      </td>
      <td style={{ ...S.tdM, color: '#57FF9A' }}>
        ${(showInt ? totalLinea : totalConMargen).toFixed(2)}
      </td>
      {showInt && (
        <td style={{ ...S.tdM, color: '#67E8F9' }}>
          ${totalConMargen.toFixed(2)}
        </td>
      )}
      <td style={{ ...S.td, width: 28 }}>
        <button onClick={() => onRemove(item.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Trash2 size={12} /></button>
      </td>
    </tr>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AREA BLOCK (Room)
// ═══════════════════════════════════════════════════════════════════
function CortAreaBlock({ area, items, config, onToggle, onUpdate, onRemove, onAdd, onShowSomfy, showInt }: {
  area: CortArea; items: CortItem[]; config: CortConfig
  onToggle: () => void
  onUpdate: (id: string, field: string, value: any) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onShowSomfy: (item: CortItem) => void
  showInt: boolean
}) {
  const areaItems = items.filter(i => i.areaId === area.id)

  // Totals
  let telaCost = 0, confCost = 0, motorCost = 0
  areaItems.forEach(item => {
    telaCost += calcFabricCost(item)
    confCost += calcConfeccionCost(item)
    if (item.tipoCierre === 'MOTORIZADO') {
      motorCost += item.motorBrand === 'SOMFY' ? calcSomfyTotal(item) * item.cantidad : item.precioMotor * item.cantidad
    }
  })
  const areaTotal = telaCost + confCost + motorCost
  // With margin
  const telaConMargen = config.margenTela > 0 ? Math.round(telaCost / (1 - config.margenTela / 100) * 100) / 100 : telaCost
  const confConMargen = config.margenTela > 0 ? Math.round(confCost / (1 - config.margenTela / 100) * 100) / 100 : confCost
  const motorConMargen = config.margenMotor > 0 ? Math.round(motorCost / (1 - config.margenMotor / 100) * 100) / 100 : motorCost
  const areaTotalVenta = telaConMargen + confConMargen + motorConMargen

  return (
    <div style={{ marginBottom: 14 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', background: '#1a1a1a', borderRadius: 10, borderLeft: '3px solid #67E8F9' }}>
        {area.collapsed ? <ChevronRight size={16} color="#67E8F9" /> : <ChevronDown size={16} color="#67E8F9" />}
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', flex: 1, textTransform: 'uppercase' as const }}>{area.name}</span>
        <span style={{ fontSize: 10, color: '#555' }}>{areaItems.length} cortina(s)</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#67E8F9' }}>${(showInt ? areaTotal : areaTotalVenta).toFixed(2)}</span>
      </div>
      {!area.collapsed && (
        <div style={{ paddingLeft: 8, paddingTop: 6 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
              <thead><tr style={{ background: '#0e0e0e' }}>
                <th style={{ ...S.th, textAlign: 'left' }}>Ubicacion</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Ancho</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Alto</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Cant</th>
                <th style={S.th}>Cierre</th>
                <th style={S.th}>Motor</th>
                <th style={S.th}>Config</th>
                <th style={S.th}>Tela</th>
                <th style={S.th}>Pliegue</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Ancho Tela</th>
                <th style={{ ...S.th, textAlign: 'right' }}>$/ML</th>
                <th style={S.th}>Tela Inc.</th>
                <th style={{ ...S.th, textAlign: 'right' }}>ML</th>
                <th style={{ ...S.th, textAlign: 'right' }}>$ Tela</th>
                <th style={{ ...S.th, textAlign: 'right' }}>$/Conf</th>
                <th style={{ ...S.th, textAlign: 'right' }}>$ Conf</th>
                <th style={{ ...S.th, textAlign: 'right' }}>$ Motor</th>
                <th style={{ ...S.th, textAlign: 'right', color: '#57FF9A' }}>{showInt ? 'Costo' : 'Total'}</th>
                {showInt && <th style={{ ...S.th, textAlign: 'right', color: '#67E8F9' }}>Venta</th>}
                <th style={S.th}></th>
              </tr></thead>
              <tbody>
                {areaItems.map(item => (
                  <CortRow key={item.id} item={item} config={config} onUpdate={onUpdate} onRemove={onRemove} onShowSomfy={onShowSomfy} showInt={showInt} />
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', marginTop: 4 }}>
            <Btn size="sm" onClick={onAdd}><Plus size={12} /> Cortina</Btn>
            <div style={{ fontSize: 10, color: '#555' }}>
              Tela: <span style={{ color: '#ccc', fontWeight: 600 }}>${(showInt ? telaCost : telaConMargen).toFixed(2)}</span>
              <span style={{ margin: '0 6px' }}>|</span>
              Conf: <span style={{ color: '#ccc', fontWeight: 600 }}>${(showInt ? confCost : confConMargen).toFixed(2)}</span>
              <span style={{ margin: '0 6px' }}>|</span>
              Motor: <span style={{ color: '#14B8A6', fontWeight: 600 }}>${(showInt ? motorCost : motorConMargen).toFixed(2)}</span>
              <span style={{ margin: '0 6px' }}>|</span>
              <span style={{ fontWeight: 700, color: '#67E8F9' }}>${(showInt ? areaTotal : areaTotalVenta).toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY PANEL
// ═══════════════════════════════════════════════════════════════════
function CortSummary({ items, areas, config, showInt, onConfigChange }: {
  items: CortItem[]; areas: CortArea[]; config: CortConfig; showInt: boolean
  onConfigChange: (field: string, value: number) => void
}) {
  let telaCost = 0, confCost = 0, motorCost = 0
  items.forEach(item => {
    telaCost += calcFabricCost(item)
    confCost += calcConfeccionCost(item)
    if (item.tipoCierre === 'MOTORIZADO') {
      motorCost += item.motorBrand === 'SOMFY' ? calcSomfyTotal(item) * item.cantidad : item.precioMotor * item.cantidad
    }
  })

  const telaVenta = config.margenTela > 0 ? Math.round(telaCost / (1 - config.margenTela / 100) * 100) / 100 : telaCost
  const confVenta = config.margenTela > 0 ? Math.round(confCost / (1 - config.margenTela / 100) * 100) / 100 : confCost
  const motorVenta = config.margenMotor > 0 ? Math.round(motorCost / (1 - config.margenMotor / 100) * 100) / 100 : motorCost
  const subtotalVenta = telaVenta + confVenta + motorVenta
  const instalacion = Math.round(subtotalVenta * config.instPct / 100 * 100) / 100
  const subConInst = subtotalVenta + instalacion
  const iva = Math.round(subConInst * config.ivaRate / 100 * 100) / 100
  const total = subConInst + iva

  // Cost side
  const subtotalCost = telaCost + confCost + motorCost
  const utilidadTela = telaVenta - telaCost
  const utilidadConf = confVenta - confCost
  const utilidadMotor = motorVenta - motorCost
  const utilidadTotal = utilidadTela + utilidadConf + utilidadMotor
  const margenReal = subtotalVenta > 0 ? Math.round(utilidadTotal / subtotalVenta * 100) : 0

  // Fabric summary
  const fabricByType: Record<string, number> = {}
  items.forEach(item => {
    const ml = calcFabricML(item) * item.cantidad
    if (ml > 0) {
      fabricByType[item.tipoTela] = (fabricByType[item.tipoTela] || 0) + ml
    }
  })

  const motorCount = items.filter(i => i.tipoCierre === 'MOTORIZADO').reduce((s, i) => s + i.cantidad, 0)
  const manualCount = items.filter(i => i.tipoCierre === 'MANUAL').reduce((s, i) => s + i.cantidad, 0)

  const inputS = { ...S.input, width: 55, fontSize: 11 }

  return (
    <div>
      {/* Config */}
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Configuracion</div>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#888' }}>Margen Tela %</span>
            <input type="number" value={config.margenTela} step={1}
              onChange={e => onConfigChange('margenTela', parseFloat(e.target.value) || 0)} style={inputS} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#888' }}>Margen Motor %</span>
            <input type="number" value={config.margenMotor} step={1}
              onChange={e => onConfigChange('margenMotor', parseFloat(e.target.value) || 0)} style={inputS} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#888' }}>Instalacion %</span>
            <input type="number" value={config.instPct} step={1}
              onChange={e => onConfigChange('instPct', parseFloat(e.target.value) || 0)} style={inputS} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#888' }}>IVA %</span>
            <input type="number" value={config.ivaRate} step={1}
              onChange={e => onConfigChange('ivaRate', parseFloat(e.target.value) || 0)} style={inputS} />
          </div>
        </div>
      </div>

      {/* Summary */}
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Resumen</div>
        {([
          { l: 'PERSIANAS MANUALES', v: manualCount, isCount: true },
          { l: 'PERSIANAS MOTORIZADAS', v: motorCount, isCount: true },
          { l: 'TELA (costo)', v: telaCost, b: false },
          { l: 'TELA (venta)', v: telaVenta, b: true },
          { l: 'CONFECCION (costo)', v: confCost, b: false },
          { l: 'CONFECCION (venta)', v: confVenta, b: true },
          { l: 'MOTORIZACION (costo)', v: motorCost, b: false },
          { l: 'MOTORIZACION (venta)', v: motorVenta, b: true },
          { l: 'SUBTOTAL', v: subtotalVenta, b: true },
          { l: 'INSTALACION (' + config.instPct + '%)', v: instalacion },
          { l: 'SUBTOTAL + INST', v: subConInst, b: true },
          { l: 'IVA (' + config.ivaRate + '%)', v: iva },
          { l: 'TOTAL', v: total, b: true, h: true },
        ] as const).map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderTop: r.b ? '1px solid #222' : 'none' }}>
            <span style={{ fontSize: 10, color: r.h ? '#67E8F9' : r.b ? '#ccc' : '#555', fontWeight: r.b ? 700 : 400 }}>{r.l}</span>
            <span style={{ fontSize: r.h ? 15 : 11, fontWeight: r.b ? 700 : 400, color: r.h ? '#67E8F9' : '#fff' }}>
              {r.isCount ? r.v : '$' + (r.v as number).toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      {/* Fabric totals by type */}
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Metros de Tela</div>
        {Object.entries(fabricByType).length === 0 && <div style={{ fontSize: 10, color: '#444' }}>Sin tela configurada</div>}
        {Object.entries(fabricByType).map(([type, ml]) => (
          <div key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}>
            <span style={{ color: '#888' }}>{type}</span>
            <span style={{ color: '#ccc', fontWeight: 500 }}>{ml.toFixed(1)} ML</span>
          </div>
        ))}
      </div>

      {/* Per area */}
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Por Area</div>
        {areas.map(a => {
          const aItems = items.filter(i => i.areaId === a.id)
          let t = 0, c = 0, m = 0
          aItems.forEach(item => {
            t += calcFabricCost(item)
            c += calcConfeccionCost(item)
            if (item.tipoCierre === 'MOTORIZADO') m += item.motorBrand === 'SOMFY' ? calcSomfyTotal(item) * item.cantidad : item.precioMotor * item.cantidad
          })
          const tv = config.margenTela > 0 ? Math.round(t / (1 - config.margenTela / 100) * 100) / 100 : t
          const cv = config.margenTela > 0 ? Math.round(c / (1 - config.margenTela / 100) * 100) / 100 : c
          const mv = config.margenMotor > 0 ? Math.round(m / (1 - config.margenMotor / 100) * 100) / 100 : m
          return (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}>
              <span style={{ color: '#888' }}>{a.name}</span>
              <span style={{ color: '#ccc', fontWeight: 500 }}>${(tv + cv + mv).toFixed(2)}</span>
            </div>
          )
        })}
      </div>

      {/* Internal analysis */}
      {showInt && (
        <div style={{ background: '#1a1414', border: '1px solid #332222', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Analisis Interno</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>Costo tela</span><span style={{ color: '#ccc' }}>${telaCost.toFixed(2)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>Costo conf</span><span style={{ color: '#ccc' }}>${confCost.toFixed(2)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>Costo motor</span><span style={{ color: '#ccc' }}>${motorCost.toFixed(2)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10, borderTop: '1px solid #332222', marginTop: 3, paddingTop: 5 }}>
            <span style={{ color: '#888' }}>Costo total</span><span style={{ color: '#ccc', fontWeight: 600 }}>${subtotalCost.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>Venta</span><span style={{ color: '#fff', fontWeight: 600 }}>${subtotalVenta.toFixed(2)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>Utilidad tela</span><span style={{ color: '#57FF9A' }}>${utilidadTela.toFixed(2)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>Utilidad conf</span><span style={{ color: '#57FF9A' }}>${utilidadConf.toFixed(2)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10 }}><span style={{ color: '#888' }}>Utilidad motor</span><span style={{ color: '#57FF9A' }}>${utilidadMotor.toFixed(2)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10, borderTop: '1px solid #332222', marginTop: 3, paddingTop: 5 }}>
            <span style={{ color: '#F59E0B', fontWeight: 600 }}>Margen</span>
            <span style={{ color: margenReal >= 25 ? '#57FF9A' : margenReal >= 15 ? '#F59E0B' : '#EF4444', fontWeight: 700, fontSize: 13 }}>{margenReal}%</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function CotEditorCortinas({ cotId, onBack }: { cotId: string; onBack: () => void }) {
  const [areas, setAreas] = useState<CortArea[]>([])
  const [items, setItems] = useState<CortItem[]>([])
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<CortConfig>({
    currency: 'MXN', tipoCambio: 20.5, ivaRate: 16, instPct: 15,
    margenTela: 40, margenMotor: 45,
  })
  const [showInt, setShowInt] = useState(true)
  const [stage, setStage] = useState('oportunidad')
  const [cotName, setCotName] = useState('')
  const [clientName, setClientName] = useState('')
  const [projectName, setProjectName] = useState('')
  const [somfyDetail, setSomfyDetail] = useState<CortItem | null>(null)
  const [showPdf, setShowPdf] = useState(false)

  // ── Load from DB ──
  async function load() {
    const [{ data: cot }, { data: qAreas }, { data: qItems }] = await Promise.all([
      supabase.from('quotations').select('*,project:projects!quotations_project_id_fkey(name,client_name)').eq('id', cotId).single(),
      supabase.from('quotation_areas').select('*').eq('quotation_id', cotId).order('order_index'),
      supabase.from('quotation_items').select('*').eq('quotation_id', cotId).order('order_index'),
    ])
    if (cot) {
      setCotName(cot.name || ''); setClientName(cot.client_name || ''); setStage(cot.stage || 'oportunidad')
      const proj = cot.project as any
      setProjectName(proj?.name || '')
      try {
        const meta = JSON.parse(cot.notes || '{}')
        if (meta.cortConfig) {
          setConfig(c => ({ ...c, ...meta.cortConfig }))
        }
        if (meta.currency) setConfig(c => ({ ...c, currency: meta.currency }))
        if (meta.tipoCambio) setConfig(c => ({ ...c, tipoCambio: meta.tipoCambio }))
      } catch {}
    }
    if (qAreas && qAreas.length > 0) {
      setAreas(qAreas.map((a: any, i: number) => ({ id: a.id, name: a.name, collapsed: false, order: i })))
    } else {
      setAreas([])
    }
    if (qItems && qItems.length > 0) {
      setItems(qItems.map((it: any) => {
        // Parse metadata stored in the `notes` JSON field
        let meta: any = {}
        try { meta = JSON.parse(it.notes || '{}') } catch {}
        return {
          id: it.id,
          areaId: it.area_id,
          ubicacion: it.name || '',
          ancho: meta.ancho || 0,
          alto: meta.alto || 0,
          cantidad: it.quantity || 1,
          tipoCierre: meta.tipoCierre || 'MANUAL',
          motorBrand: meta.motorBrand || 'NINGUNO',
          motorSystem: meta.motorSystem || '',
          somfyHojas: meta.somfyHojas || 1,
          somfyPliegue: meta.somfyPliegue || 'TRADICIONAL',
          somfyAbundancia: meta.somfyAbundancia || 0,
          somfySoportePared: meta.somfySoportePared || false,
          somfyAmrado: meta.somfyAmrado || false,
          somfyCurveado: meta.somfyCurveado || false,
          tipoTela: meta.tipoTela || 'TRASLUCIDA',
          anchoTela: meta.anchoTela || 0,
          tipoPliegue: meta.tipoPliegue || 'ONDA PERFECTA',
          precioTelaPorML: meta.precioTelaPorML || 0,
          precioConfeccion: meta.precioConfeccion || 0,
          telaIncluida: meta.telaIncluida || false,
          precioMotor: meta.precioMotor || 0,
          order: it.order_index || 0,
        }
      }))
    } else {
      setItems([])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [cotId])

  // ── Save helpers ──
  function saveQuotationNotes(overrides?: Partial<CortConfig>) {
    const c = { ...config, ...overrides }
    const data = { cortConfig: c, currency: c.currency, tipoCambio: c.tipoCambio }
    supabase.from('quotations').update({ notes: JSON.stringify(data) }).eq('id', cotId)
  }

  function itemToDbNotes(item: CortItem): string {
    return JSON.stringify({
      ancho: item.ancho, alto: item.alto,
      tipoCierre: item.tipoCierre, motorBrand: item.motorBrand, motorSystem: item.motorSystem,
      somfyHojas: item.somfyHojas, somfyPliegue: item.somfyPliegue,
      somfyAbundancia: item.somfyAbundancia, somfySoportePared: item.somfySoportePared,
      somfyAmrado: item.somfyAmrado, somfyCurveado: item.somfyCurveado,
      tipoTela: item.tipoTela, anchoTela: item.anchoTela, tipoPliegue: item.tipoPliegue,
      precioTelaPorML: item.precioTelaPorML, precioConfeccion: item.precioConfeccion, telaIncluida: item.telaIncluida, precioMotor: item.precioMotor,
    })
  }

  function calcItemTotal(item: CortItem): number {
    let t = calcFabricCost(item) + calcConfeccionCost(item)
    if (item.tipoCierre === 'MOTORIZADO') {
      t += item.motorBrand === 'SOMFY' ? calcSomfyTotal(item) * item.cantidad : item.precioMotor * item.cantidad
    }
    return t
  }

  // ── Total for header ──
  const grandTotal = useMemo(() => {
    let telaCost = 0, confCost = 0, motorCost = 0
    items.forEach(item => {
      telaCost += calcFabricCost(item)
      confCost += calcConfeccionCost(item)
      if (item.tipoCierre === 'MOTORIZADO') {
        motorCost += item.motorBrand === 'SOMFY' ? calcSomfyTotal(item) * item.cantidad : item.precioMotor * item.cantidad
      }
    })
    const telaVenta = config.margenTela > 0 ? Math.round(telaCost / (1 - config.margenTela / 100) * 100) / 100 : telaCost
    const confVenta = config.margenTela > 0 ? Math.round(confCost / (1 - config.margenTela / 100) * 100) / 100 : confCost
    const motorVenta = config.margenMotor > 0 ? Math.round(motorCost / (1 - config.margenMotor / 100) * 100) / 100 : motorCost
    const sub = telaVenta + confVenta + motorVenta
    const inst = sub * config.instPct / 100
    const subInst = sub + inst
    return subInst + subInst * config.ivaRate / 100
  }, [items, config])

  // Sync total to quotations table
  useEffect(() => {
    if (!loading && cotId) {
      supabase.from('quotations').update({ total: Math.round(grandTotal * 100) / 100 }).eq('id', cotId)
    }
  }, [grandTotal, loading])

  // ── Actions ──
  function updateConfig(field: string, value: number) {
    setConfig(prev => {
      const next = { ...prev, [field]: value }
      saveQuotationNotes(next)
      return next
    })
  }

  function updateItem(id: string, field: string, value: any) {
    setItems(prev => {
      const next = prev.map(it => it.id === id ? { ...it, [field]: value } : it)
      // Persist to DB
      const updated = next.find(it => it.id === id)
      if (updated) {
        const total = calcItemTotal(updated)
        supabase.from('quotation_items').update({
          name: updated.ubicacion,
          quantity: updated.cantidad,
          total,
          notes: itemToDbNotes(updated),
        }).eq('id', id).then(() => {})
      }
      return next
    })
  }

  async function addItem(areaId: string) {
    const order = items.filter(i => i.areaId === areaId).length
    const newItem = defaultItem(areaId, order)
    // Insert into DB
    const { data, error } = await supabase.from('quotation_items').insert({
      quotation_id: cotId, area_id: areaId,
      name: '', system: 'Cortinas', type: 'material',
      quantity: 1, cost: 0, price: 0, total: 0, markup: 0,
      installation_cost: 0, order_index: order,
      notes: itemToDbNotes(newItem),
    }).select().single()
    if (error) { alert('Error: ' + error.message); return }
    if (data) {
      setItems(prev => [...prev, { ...newItem, id: data.id }])
    }
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(it => it.id !== id))
    supabase.from('quotation_items').delete().eq('id', id).then(() => {})
  }

  function toggleArea(id: string) {
    setAreas(prev => prev.map(a => a.id === id ? { ...a, collapsed: !a.collapsed } : a))
  }

  async function addArea() {
    const n = prompt('Nombre del area (ej: Recamara Principal):')
    if (!n) return
    const { data, error } = await supabase.from('quotation_areas').insert({
      quotation_id: cotId, name: n, order_index: areas.length,
    }).select().single()
    if (error) { alert('Error: ' + error.message); return }
    if (data) {
      setAreas(prev => [...prev, { id: data.id, name: n, collapsed: false, order: prev.length }])
    }
  }

  if (loading) return <Loading />

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ padding: '7px 16px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: '#111' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><ChevronLeft size={14} /> Cotizaciones</button>
        <span style={{ color: '#333' }}>/</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#67E8F9' }}>{String.fromCodePoint(0x25A6)} {cotName || 'Cotizacion Cortinas'}</span>
        <Badge label="CORT" color="#67E8F9" />
        {clientName && <span style={{ fontSize: 11, color: '#888' }}>{clientName}</span>}
        {projectName && <span style={{ fontSize: 10, color: '#555' }}>| {projectName}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {(Object.entries(STAGE_CONFIG) as Array<[string, { label: string; color: string }]>).map(([s, cfg]) => (
            <button key={s} onClick={() => { setStage(s); supabase.from('quotations').update({ stage: s }).eq('id', cotId) }} style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid ' + (stage === s ? cfg.color : '#333'), background: stage === s ? cfg.color + '22' : 'transparent', color: stage === s ? cfg.color : '#555',
            }}>{cfg.label}</button>
          ))}
          <button onClick={() => setShowInt(!showInt)} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid ' + (showInt ? '#F59E0B' : '#333'), background: showInt ? '#F59E0B22' : 'transparent', color: showInt ? '#F59E0B' : '#555', marginLeft: 8 }}>{showInt ? 'Interno' : 'Cliente'}</button>
          <button onClick={() => setShowPdf(true)} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #67E8F9', background: '#67E8F922', color: '#67E8F9', marginLeft: 4, display: 'flex', alignItems: 'center', gap: 4 }}><Printer size={12} /> PDF</button>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#67E8F9', marginLeft: 10 }}>${grandTotal.toFixed(2)}</span>
        </div>
      </div>

      {/* Currency bar */}
      <div style={{ padding: '5px 16px', borderBottom: '1px solid #1e1e1e', display: 'flex', gap: 8, alignItems: 'center', background: '#0e0e0e', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: '#444', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Cortinas y Persianas</span>
        <span style={{ fontSize: 10, color: '#14B8A6', background: '#14B8A622', padding: '2px 8px', borderRadius: 5 }}>Somfy auto-BOM</span>
        <span style={{ fontSize: 10, color: '#A855F7', background: '#A855F722', padding: '2px 8px', borderRadius: 5 }}>Lutron manual</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: config.currency === 'USD' ? '#06B6D4' : '#F59E0B', background: config.currency === 'USD' ? '#06B6D422' : '#F59E0B22', padding: '2px 8px', borderRadius: 5 }}>{config.currency}</span>
          <span style={{ fontSize: 9, color: '#555' }}>TC:</span>
          <input type="number" value={config.tipoCambio} step={0.1}
            onChange={e => updateConfig('tipoCambio', parseFloat(e.target.value) || 20)}
            style={{ width: 55, padding: '2px 6px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' }} />
        </span>
      </div>

      {/* Content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', flex: 1, overflow: 'hidden' }}>
        <div style={{ overflowY: 'auto', padding: '14px 18px' }}>
          {areas.map(area => (
            <CortAreaBlock key={area.id} area={area} items={items} config={config}
              onToggle={() => toggleArea(area.id)}
              onUpdate={updateItem} onRemove={removeItem}
              onAdd={() => addItem(area.id)}
              onShowSomfy={setSomfyDetail}
              showInt={showInt} />
          ))}
          <div onClick={addArea} style={{ padding: '12px', border: '1px dashed #333', borderRadius: 10, textAlign: 'center', cursor: 'pointer', color: '#444', fontSize: 12 }}>+ Agregar area</div>
        </div>
        <div style={{ borderLeft: '1px solid #222', overflowY: 'auto', padding: '14px 10px', background: '#0e0e0e' }}>
          <CortSummary items={items} areas={areas} config={config} showInt={showInt} onConfigChange={updateConfig} />
        </div>
      </div>

      {/* Somfy detail modal */}
      {somfyDetail && <SomfyDetailModal item={somfyDetail} onClose={() => setSomfyDetail(null)} />}

      {/* PDF proposal modal */}
      {showPdf && <CortPdfModal items={items} areas={areas} config={config} cotName={cotName} clientName={clientName} projectName={projectName} onClose={() => setShowPdf(false)} />}
    </div>
  )
}
