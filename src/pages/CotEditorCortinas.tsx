import React, { useState, useMemo, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { F, STAGE_CONFIG } from '../lib/utils'
import { Badge, Btn, Loading } from '../components/layout/UI'
import { Plus, ChevronLeft, ChevronDown, ChevronRight, X, Trash2, Settings, Copy, Printer, Pencil, Download, Upload, Loader2, Sparkles, FileText } from 'lucide-react'
import EditCotInfoModal from '../components/EditCotInfoModal'
import VersionManager, { VersionSnapshot } from '../components/VersionManager'
import { OMNIIOUS_LOGO } from '../assets/logo'
import { useIsMobile } from '../lib/useIsMobile'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

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
  descuento: number      // discount % (default 0)
}

type ItemKind = 'CORTINA' | 'PERSIANA' | 'EXTRA'
type PersianaTipo = 'ROLLER' | 'VENECIANA' | 'ROMANA'

// Each curtain or blind line item
interface CortItem {
  id: string
  areaId: string
  ubicacion: string      // e.g. "Ventana Sala", "Recámara Principal"
  ancho: number          // window width in meters
  alto: number           // window height in meters
  cantidad: number       // qty of identical units
  // Kind discriminator — CORTINA uses fabric (tela/pliegue/confección),
  // PERSIANA uses material price per m² (roller/veneciana/romana).
  itemKind: ItemKind
  tipoCierre: 'MANUAL' | 'MOTORIZADO'
  motorBrand: 'SOMFY' | 'LUTRON' | 'NINGUNO'
  motorSystem: string    // e.g. "MOVELITE 35 KG", "GLYDEA35WT", "ALENA QS", "SIVOIA QS"
  // Somfy config (when motorBrand=SOMFY) — cortinas only
  somfyHojas: 1 | 2
  somfyPliegue: 'TRADICIONAL' | 'ONDULADO'
  somfyAbundancia: number
  somfySoportePared: boolean
  somfyAmrado: boolean
  somfyCurveado: boolean
  // Fabric (cortinas only)
  tipoTela: string       // e.g. "TRASLUCIDA", "BLACKOUT", "SHEER"
  anchoTela: number      // fabric width in meters (manual input)
  tipoPliegue: string    // e.g. "ONDA PERFECTA", "PLANO", "TABLEADO"
  // Pricing (cortinas, manual or calculated)
  precioTelaPorML: number
  precioConfeccion: number  // confection/sewing price per ML
  telaIncluida: boolean     // true = client provides own fabric (no fabric charge)
  precioMotor: number    // manual for Lutron, auto-calculated for Somfy
  // Persianas-only fields
  persianaTipo: PersianaTipo            // ROLLER / VENECIANA / ROMANA
  persianaMaterial: string              // free-text (e.g. "Blackout", "Screen 5%", "Madera 50mm")
  persianaPrecioPorM2: number           // unit cost per m² of material (MXN)
  // Extras-only fields (controles, interfaces, accesorios sueltos)
  extraDescripcion: string              // free-text (e.g. "Control SITUO 5", "INTERFACE INTERTEC 16 RTS")
  extraPrecioUnitario: number           // unit cost per piece (MXN) — uses margenMotor for markup
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
  if (item.itemKind !== 'CORTINA') return 0
  if (item.telaIncluida) return 0
  return Math.round(calcFabricML(item) * item.precioTelaPorML * item.cantidad * 100) / 100
}

function calcConfeccionCost(item: CortItem): number {
  if (item.itemKind !== 'CORTINA') return 0
  // precioConfeccion is cost per ML — multiply by fabric meters
  const ml = calcFabricML(item)
  return Math.round(item.precioConfeccion * ml * item.cantidad * 100) / 100
}

// Persiana material cost (MXN). Persianas are priced per m² of finished
// surface, not by fabric ML. m² = ancho × alto, multiplied by quantity.
function calcPersianaMaterialCost(item: CortItem): number {
  if (item.itemKind !== 'PERSIANA') return 0
  const m2 = (item.ancho || 0) * (item.alto || 0)
  return Math.round(m2 * (item.persianaPrecioPorM2 || 0) * item.cantidad * 100) / 100
}

// Extra cost (MXN). Items like controls, interfaces, switches — flat
// price per piece × quantity. Uses margenMotor for markup (hardware).
function calcExtraCost(item: CortItem): number {
  if (item.itemKind !== 'EXTRA') return 0
  return Math.round((item.extraPrecioUnitario || 0) * item.cantidad * 100) / 100
}

// Motor cost in MXN — Somfy is already MXN (auto-BOM for cortinas), Lutron is USD * tipoCambio.
// Persianas always use manual precioMotor (no auto-BOM); Lutron still in USD.
function calcMotorCostMXN(item: CortItem, tipoCambio: number): number {
  if (item.itemKind === 'EXTRA') return 0
  if (item.tipoCierre !== 'MOTORIZADO') return 0
  if (item.itemKind === 'PERSIANA') {
    if (item.motorBrand === 'LUTRON') return item.precioMotor * item.cantidad * tipoCambio
    return item.precioMotor * item.cantidad
  }
  if (item.motorBrand === 'SOMFY') return calcSomfyTotal(item) * item.cantidad
  if (item.motorBrand === 'LUTRON') return item.precioMotor * item.cantidad * tipoCambio
  return 0
}

// Motor cost in native currency (USD for Lutron, MXN for Somfy)
function calcMotorCostRaw(item: CortItem): number {
  if (item.itemKind === 'EXTRA') return 0
  if (item.tipoCierre !== 'MOTORIZADO') return 0
  if (item.itemKind === 'PERSIANA') {
    return item.precioMotor * item.cantidad
  }
  if (item.motorBrand === 'SOMFY') return calcSomfyTotal(item) * item.cantidad
  if (item.motorBrand === 'LUTRON') return item.precioMotor * item.cantidad
  return 0
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
    itemKind: 'CORTINA',
    tipoCierre: 'MANUAL', motorBrand: 'NINGUNO', motorSystem: '',
    somfyHojas: 1, somfyPliegue: 'TRADICIONAL', somfyAbundancia: 0,
    somfySoportePared: false, somfyAmrado: false, somfyCurveado: false,
    tipoTela: 'TRASLUCIDA', anchoTela: 0, tipoPliegue: 'ONDA PERFECTA',
    precioTelaPorML: 0, precioConfeccion: 0, telaIncluida: false, precioMotor: 0,
    persianaTipo: 'ROLLER', persianaMaterial: '', persianaPrecioPorM2: 0,
    extraDescripcion: '', extraPrecioUnitario: 0,
    order,
  }
}

function defaultPersiana(areaId: string, order: number): CortItem {
  return {
    ...defaultItem(areaId, order),
    itemKind: 'PERSIANA',
    persianaTipo: 'ROLLER',
    persianaMaterial: 'Blackout',
    persianaPrecioPorM2: 0,
  }
}

function defaultExtra(areaId: string, order: number): CortItem {
  return {
    ...defaultItem(areaId, order),
    itemKind: 'EXTRA',
    extraDescripcion: '',
    extraPrecioUnitario: 0,
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOMFY DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════
function SomfyDetailModal({ item, onClose }: { item: CortItem; onClose: () => void }) {
  const isMobile = useIsMobile()
  const bom = calcSomfyBOM(item)
  const total = bom.reduce((s, l) => s + l.total, 0)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1030, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: isMobile ? 0 : 16, padding: isMobile ? 12 : 24, width: isMobile ? '100vw' : 550, height: isMobile ? '100vh' : 'auto', maxHeight: isMobile ? '100vh' : '80vh', overflowY: 'auto', margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Desglose Somfy</div>
            <div style={{ fontSize: 11, color: '#14B8A6' }}>{item.motorSystem} | {item.ancho}m ancho</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ overflowX: 'auto' }}>
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
        </div>
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
  const isMobile = useIsMobile()
  const pdfRef = useRef<HTMLDivElement>(null)

  // Calculate totals (all in MXN)
  let telaCost = 0, confCost = 0, motorCost = 0, persianaCost = 0, extraCost = 0
  items.forEach(item => {
    telaCost += calcFabricCost(item)
    confCost += calcConfeccionCost(item)
    motorCost += calcMotorCostMXN(item, config.tipoCambio)
    persianaCost += calcPersianaMaterialCost(item)
    extraCost += calcExtraCost(item)
  })
  const telaVenta = config.margenTela > 0 ? Math.round(telaCost / (1 - config.margenTela / 100) * 100) / 100 : telaCost
  const confVenta = config.margenTela > 0 ? Math.round(confCost / (1 - config.margenTela / 100) * 100) / 100 : confCost
  const motorVenta = config.margenMotor > 0 ? Math.round(motorCost / (1 - config.margenMotor / 100) * 100) / 100 : motorCost
  const persianaVenta = config.margenTela > 0 ? Math.round(persianaCost / (1 - config.margenTela / 100) * 100) / 100 : persianaCost
  const extraVenta = config.margenMotor > 0 ? Math.round(extraCost / (1 - config.margenMotor / 100) * 100) / 100 : extraCost
  const subtotalVenta = telaVenta + confVenta + motorVenta + persianaVenta + extraVenta
  const instalacion = Math.round(subtotalVenta * config.instPct / 100 * 100) / 100
  const subConInst = subtotalVenta + instalacion
  const descuentoAmt = Math.round(subConInst * (config.descuento || 0) / 100 * 100) / 100
  const subConDesc = subConInst - descuentoAmt
  const iva = Math.round(subConDesc * config.ivaRate / 100 * 100) / 100
  const total = subConDesc + iva

  const manualCount = items.filter(i => i.tipoCierre === 'MANUAL').reduce((s, i) => s + i.cantidad, 0)
  const motorCount = items.filter(i => i.tipoCierre === 'MOTORIZADO').reduce((s, i) => s + i.cantidad, 0)

  const fmtC = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const [downloading, setDownloading] = useState(false)

  function handlePrint() {
    const content = pdfRef.current
    if (!content) return
    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>Propuesta Cortinas - ${cotName}</title><style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
      table { border-collapse: collapse; width: 100%; }
      @media print { body { margin: 0; padding: 16px; } }
    </style></head><body>${content.innerHTML}</body></html>`)
    w.document.close()
    setTimeout(() => { w.print() }, 300)
  }

  async function handleDownloadPdf() {
    const el = pdfRef.current
    if (!el || downloading) return
    setDownloading(true)
    try {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const margin = 10
      const usableW = pageW - margin * 2
      const imgW = canvas.width
      const imgH = canvas.height
      const ratio = usableW / imgW
      const scaledH = imgH * ratio
      // Multi-page support
      let yOffset = 0
      const usableH = pageH - margin * 2
      while (yOffset < scaledH) {
        if (yOffset > 0) pdf.addPage()
        pdf.addImage(imgData, 'PNG', margin, margin - yOffset, usableW, scaledH)
        yOffset += usableH
      }
      const filename = `Propuesta_Cortinas_${(cotName || 'cotizacion').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`
      pdf.save(filename)
    } catch (err) {
      console.error('PDF generation error:', err)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="cort-pdf-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1040, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: isMobile ? 0 : 8, overflow: 'hidden', width: isMobile ? '100vw' : '8.5in', height: isMobile ? '100vh' : 'auto', maxHeight: isMobile ? '100vh' : '90vh', boxShadow: isMobile ? 'none' : '0 20px 50px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <div ref={pdfRef} style={{ padding: 32 }}>
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

            {/* Items table grouped by area */}
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20, fontSize: 9 }}>
              <thead>
                <tr style={{ background: '#f3f3f3', borderBottom: '2px solid #000' }}>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Ancho</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Alto</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Cant</th>
                  <th style={{ textAlign: 'left', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Motor / Tipo</th>
                  <th style={{ textAlign: 'left', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Tipo Tela</th>
                  <th style={{ textAlign: 'left', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Pliegue</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Confección</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Tela</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Motor</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600, color: '#000' }}>Total MXN</th>
                </tr>
              </thead>
              <tbody>
                {areas.map(area => {
                  const areaItems = items.filter(i => i.areaId === area.id)
                  if (areaItems.length === 0) return null
                  return (
                    <React.Fragment key={area.id}>
                      <tr><td colSpan={10} style={{ padding: '8px 4px 4px', fontWeight: 700, color: '#000', fontSize: 10, background: '#f8f8f8', borderBottom: '1px solid #ccc', textTransform: 'uppercase' }}>{area.name}</td></tr>
                      {areaItems.map((item) => {
                        const isPersiana = item.itemKind === 'PERSIANA'
                        const isExtra = item.itemKind === 'EXTRA'
                        const itemFabricCost = calcFabricCost(item)
                        const itemConfCost = calcConfeccionCost(item)
                        const itemMotorCostMXN = calcMotorCostMXN(item, config.tipoCambio)
                        const itemPersianaCost = calcPersianaMaterialCost(item)
                        const itemExtraCost = calcExtraCost(item)
                        // Apply margins for client-facing PDF (all in MXN)
                        const mT = config.margenTela > 0 ? 1 / (1 - config.margenTela / 100) : 1
                        const mM = config.margenMotor > 0 ? 1 / (1 - config.margenMotor / 100) : 1
                        const itemTelaVenta = Math.round(itemFabricCost * mT * 100) / 100
                        const itemConfVenta = Math.round(itemConfCost * mT * 100) / 100
                        const itemMotorVenta = Math.round(itemMotorCostMXN * mM * 100) / 100
                        const itemPersianaVenta = Math.round(itemPersianaCost * mT * 100) / 100
                        const itemExtraVenta = Math.round(itemExtraCost * mM * 100) / 100
                        const itemTotalVenta = isExtra
                          ? itemExtraVenta
                          : isPersiana
                            ? (itemPersianaVenta + itemMotorVenta)
                            : (itemTelaVenta + itemConfVenta + itemMotorVenta)
                        return (
                          <tr key={item.id} style={{ borderBottom: '1px solid #e0e0e0' }}>
                            <td style={{ textAlign: 'right', padding: '4px', color: '#444' }}>{isExtra ? '—' : item.ancho.toFixed(2)}</td>
                            <td style={{ textAlign: 'right', padding: '4px', color: '#444' }}>{isExtra ? '—' : item.alto.toFixed(2)}</td>
                            <td style={{ textAlign: 'right', padding: '4px', color: '#444' }}>{item.cantidad}</td>
                            <td style={{ textAlign: 'left', padding: '4px', color: '#444' }}>
                              {isExtra
                                ? (item.extraDescripcion || 'Extra')
                                : isPersiana
                                  ? `Persiana ${item.persianaTipo}${item.tipoCierre === 'MOTORIZADO' ? ' (Mot.)' : ' (Man.)'}`
                                  : (item.tipoCierre === 'MANUAL' ? 'Manual' : item.motorSystem || 'Motorizado')}
                            </td>
                            <td style={{ textAlign: 'left', padding: '4px', color: '#444' }}>{isExtra ? '—' : isPersiana ? (item.persianaMaterial || '—') : item.tipoTela}</td>
                            <td style={{ textAlign: 'left', padding: '4px', color: '#444' }}>{(isPersiana || isExtra) ? '—' : item.tipoPliegue}</td>
                            <td style={{ textAlign: 'right', padding: '4px', color: '#000' }}>{(isPersiana || isExtra) ? '—' : fmtC(itemConfVenta)}</td>
                            <td style={{ textAlign: 'right', padding: '4px', color: item.telaIncluida && !isPersiana && !isExtra ? '#999' : '#000', fontStyle: item.telaIncluida && !isPersiana && !isExtra ? 'italic' : 'normal' }}>
                              {isExtra ? fmtC(itemExtraVenta) : isPersiana ? fmtC(itemPersianaVenta) : (item.telaIncluida ? 'CLIENTE' : fmtC(itemTelaVenta))}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px', color: '#000' }}>{!isExtra && itemMotorCostMXN > 0 ? fmtC(itemMotorVenta) : '---'}{item.motorBrand === 'LUTRON' && itemMotorCostMXN > 0 && !isExtra ? <span style={{ fontSize: 7, color: '#888' }}> (USD→MXN)</span> : ''}</td>
                            <td style={{ textAlign: 'right', padding: '4px', color: '#000', fontWeight: 700 }}>{fmtC(itemTotalVenta)}</td>
                          </tr>
                        )
                      })}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
            </div>

            {/* Summary */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 8, fontSize: 10 }}>
                <div style={{ textAlign: 'right', color: '#555' }}>Persianas Manuales:</div>
                <div style={{ textAlign: 'right', fontWeight: 600, color: '#000' }}>{manualCount}</div>
                <div style={{ textAlign: 'right', color: '#555' }}>Total Tela:</div>
                <div style={{ textAlign: 'right', fontWeight: 600, color: '#000' }}>{fmtC(telaVenta)}</div>
                <div style={{ textAlign: 'right', color: '#555' }}>Total Confección:</div>
                <div style={{ textAlign: 'right', fontWeight: 600, color: '#000' }}>{fmtC(confVenta)}</div>
                <div style={{ textAlign: 'right', color: '#555', fontWeight: 600 }}>Total Telas Confeccionadas:</div>
                <div style={{ textAlign: 'right', fontWeight: 700, color: '#000' }}>{fmtC(telaVenta + confVenta)}</div>
                <div style={{ textAlign: 'right', color: '#555' }}>Total Motorización:</div>
                <div style={{ textAlign: 'right', fontWeight: 600, color: '#000' }}>{fmtC(motorVenta)}</div>
                <div style={{ textAlign: 'right', color: '#555' }}>Instalación ({config.instPct}%):</div>
                <div style={{ textAlign: 'right', fontWeight: 600, color: '#000' }}>{fmtC(instalacion)}</div>
                <div style={{ textAlign: 'right', color: '#555', borderTop: '1px solid #000', paddingTop: 4 }}>Subtotal:</div>
                <div style={{ textAlign: 'right', fontWeight: 600, color: '#000', borderTop: '1px solid #000', paddingTop: 4 }}>{fmtC(subConInst)}</div>
                {(config.descuento || 0) > 0 && <>
                  <div style={{ textAlign: 'right', color: '#c00' }}>Descuento ({config.descuento}%):</div>
                  <div style={{ textAlign: 'right', fontWeight: 600, color: '#c00' }}>-{fmtC(descuentoAmt)}</div>
                  <div style={{ textAlign: 'right', color: '#555' }}>Subtotal con descuento:</div>
                  <div style={{ textAlign: 'right', fontWeight: 600, color: '#000' }}>{fmtC(subConDesc)}</div>
                </>}
                <div style={{ textAlign: 'right', color: '#555' }}>IVA ({config.ivaRate}%):</div>
                <div style={{ textAlign: 'right', fontWeight: 600, color: '#000' }}>{fmtC(iva)}</div>
                <div style={{ textAlign: 'right', fontWeight: 700, color: '#000', fontSize: 11, borderTop: '2px solid #000', paddingTop: 6 }}>TOTAL FINAL:</div>
                <div style={{ textAlign: 'right', fontWeight: 700, color: '#000', fontSize: 11, borderTop: '2px solid #000', paddingTop: 6 }}>{fmtC(total)}</div>
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
          </div>
        </div>

        {/* Footer buttons - outside ref */}
        <div className="cort-pdf-no-print" style={{ display: 'flex', gap: 10, padding: 16, justifyContent: 'center', borderTop: '1px solid #ddd', background: '#f9f9f9' }}>
          <button onClick={handleDownloadPdf} disabled={downloading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#57FF9A', color: '#000', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: downloading ? 'wait' : 'pointer', opacity: downloading ? 0.6 : 1 }}>
            <Download size={14} /> {downloading ? 'Generando...' : 'Descargar PDF'}
          </button>
          <button onClick={handlePrint} style={{ padding: '8px 16px', background: '#000', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Imprimir</button>
          <button onClick={onClose} style={{ padding: '8px 16px', background: '#eee', color: '#000', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AREA PICKER MODAL
// ═══════════════════════════════════════════════════════════════════
const AREA_PRESETS = [
  'Recámara Principal', 'Recámara 2', 'Recámara 3', 'Recámara Niños',
  'Sala', 'Comedor', 'Sala / Comedor', 'Cocina', 'Estudio',
  'Baño Principal', 'Baño Servicio', 'Vestidor', 'Pasillo',
  'Terraza', 'Jardín', 'Consultorio', 'Oficina', 'Gimnasio',
  'Cuarto de Servicio', 'Fuentes', 'Sala TV',
]

function AreaPickerModal({ existingNames, onSelect, onClose }: {
  existingNames: string[]
  onSelect: (name: string) => void
  onClose: () => void
}) {
  const isMobile = useIsMobile()
  const [custom, setCustom] = useState('')
  const available = AREA_PRESETS.filter(n => !existingNames.includes(n))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1030, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: isMobile ? 0 : 16, padding: isMobile ? 12 : 24, width: isMobile ? '100vw' : 420, height: isMobile ? '100vh' : 'auto', maxHeight: isMobile ? '100vh' : '70vh', overflowY: 'auto', margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Agregar Área</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {/* Preset grid */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 4 : 6, marginBottom: 16 }}>
          {available.map(name => (
            <button key={name} onClick={() => onSelect(name)} style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid #333', background: '#1a1a1a', color: '#ccc',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#67E8F9'; e.currentTarget.style.color = '#67E8F9' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#ccc' }}
            >{name}</button>
          ))}
        </div>

        {/* Custom input */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="Nombre personalizado..."
            onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) { onSelect(custom.trim()); } }}
            style={{ flex: 1, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 12, fontFamily: 'inherit' }} />
          <button onClick={() => { if (custom.trim()) onSelect(custom.trim()) }} disabled={!custom.trim()}
            style={{ padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #67E8F9', background: '#67E8F922', color: '#67E8F9', opacity: custom.trim() ? 1 : 0.4 }}>
            Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CURTAIN ROW
// ═══════════════════════════════════════════════════════════════════
function CortRow({ item, config, onUpdate, onRemove, onShowSomfy, onCopy, showInt }: {
  item: CortItem; config: CortConfig
  onUpdate: (id: string, field: string, value: any) => void
  onRemove: (id: string) => void
  onShowSomfy: (item: CortItem) => void
  onCopy: (item: CortItem) => void
  showInt: boolean
}) {
  const fabricML = calcFabricML(item)
  const fabricCost = calcFabricCost(item)
  const confeccionCost = calcConfeccionCost(item)

  // Motor cost — use helper functions
  const motorCostRaw = calcMotorCostRaw(item)   // native currency (MXN for Somfy, USD for Lutron)
  const motorCostMXN = calcMotorCostMXN(item, config.tipoCambio)  // always MXN

  const totalTela = fabricCost       // MXN
  const totalConf = confeccionCost   // MXN
  const totalMotor = motorCostMXN    // MXN (converted if Lutron)
  const totalLinea = totalTela + totalConf + totalMotor  // all MXN

  // With margin (all in MXN)
  const precioTelaConMargen = config.margenTela > 0 ? Math.round(totalTela / (1 - config.margenTela / 100) * 100) / 100 : totalTela
  const precioConfConMargen = config.margenTela > 0 ? Math.round(totalConf / (1 - config.margenTela / 100) * 100) / 100 : totalConf
  const precioMotorConMargen = config.margenMotor > 0 ? Math.round(totalMotor / (1 - config.margenMotor / 100) * 100) / 100 : totalMotor
  const totalConMargen = precioTelaConMargen + precioConfConMargen + precioMotorConMargen

  const motorSystems = item.motorBrand === 'SOMFY' ? ALL_SOMFY_SYSTEMS
    : item.motorBrand === 'LUTRON' ? LUTRON_SYSTEMS : []

  return (
    <tr>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 9, color: '#F59E0B', fontWeight: 600 }}>USD</span>
            <input type="number" defaultValue={item.precioMotor} step={1} min={0}
              onBlur={e => onUpdate(item.id, 'precioMotor', parseFloat(e.target.value) || 0)}
              style={{ ...S.input, width: 65 }} />
          </div>
        ) : item.tipoCierre === 'MOTORIZADO' && item.motorBrand === 'SOMFY' ? (
          <span style={{ color: '#14B8A6', fontWeight: 600, fontSize: 12 }}>${motorCostRaw.toFixed(2)} <span style={{ fontSize: 8, color: '#555' }}>MXN</span></span>
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
      <td style={{ ...S.td, width: 28, display: 'flex', gap: 4 }}>
        <button onClick={() => onCopy(item)} title="Copiar a otra área" style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Copy size={12} /></button>
        <button onClick={() => onRemove(item.id)} title="Eliminar" style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Trash2 size={12} /></button>
      </td>
    </tr>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PERSIANA ROW
// ═══════════════════════════════════════════════════════════════════
function PersianaRow({ item, config, onUpdate, onRemove, onCopy, showInt }: {
  item: CortItem; config: CortConfig
  onUpdate: (id: string, field: string, value: any) => void
  onRemove: (id: string) => void
  onCopy: (item: CortItem) => void
  showInt: boolean
}) {
  const m2 = (item.ancho || 0) * (item.alto || 0)
  const matCost = calcPersianaMaterialCost(item)
  const motorCostMXN = calcMotorCostMXN(item, config.tipoCambio)
  const motorCostRaw = calcMotorCostRaw(item)
  const totalLinea = matCost + motorCostMXN
  // Persiana material uses margenTela (same fabric/material margin)
  const matConMargen = config.margenTela > 0 ? Math.round(matCost / (1 - config.margenTela / 100) * 100) / 100 : matCost
  const motorConMargen = config.margenMotor > 0 ? Math.round(motorCostMXN / (1 - config.margenMotor / 100) * 100) / 100 : motorCostMXN
  const totalConMargen = matConMargen + motorConMargen

  return (
    <tr>
      <td style={S.tdR}><input type="number" defaultValue={item.ancho || ''} step={0.01} placeholder="0" onBlur={e => onUpdate(item.id, 'ancho', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: 60 }} /></td>
      <td style={S.tdR}><input type="number" defaultValue={item.alto || ''} step={0.01} placeholder="0" onBlur={e => onUpdate(item.id, 'alto', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: 60 }} /></td>
      <td style={S.tdR}><input type="number" defaultValue={item.cantidad} min={1} onBlur={e => onUpdate(item.id, 'cantidad', parseInt(e.target.value) || 1)} style={{ ...S.input, width: 45 }} /></td>
      <td style={S.td}>
        <select value={item.persianaTipo} onChange={e => onUpdate(item.id, 'persianaTipo', e.target.value)} style={{ ...S.select, width: 100 }}>
          <option value="ROLLER">Roller</option>
          <option value="VENECIANA">Veneciana</option>
          <option value="ROMANA">Romana</option>
        </select>
      </td>
      <td style={S.td}>
        <input type="text" defaultValue={item.persianaMaterial || ''} placeholder="Blackout / Madera 50mm…" onBlur={e => onUpdate(item.id, 'persianaMaterial', e.target.value)} style={{ ...S.input, width: 130, textAlign: 'left' }} />
      </td>
      <td style={S.td}>
        <select value={item.tipoCierre} onChange={e => {
          const v = e.target.value as 'MANUAL' | 'MOTORIZADO'
          onUpdate(item.id, 'tipoCierre', v)
          if (v === 'MANUAL') {
            onUpdate(item.id, 'motorBrand', 'NINGUNO')
            onUpdate(item.id, 'motorSystem', '')
          }
        }} style={{ ...S.select, width: 95 }}>
          <option value="MANUAL">Manual</option>
          <option value="MOTORIZADO">Motorizado</option>
        </select>
      </td>
      <td style={S.td}>
        {item.tipoCierre === 'MOTORIZADO' ? (
          <select value={item.motorBrand} onChange={e => onUpdate(item.id, 'motorBrand', e.target.value)} style={{ ...S.select, width: 85 }}>
            <option value="NINGUNO">--</option>
            <option value="SOMFY">Somfy</option>
            <option value="LUTRON">Lutron</option>
          </select>
        ) : <span style={{ color: '#444' }}>--</span>}
      </td>
      <td style={S.td}>
        {item.tipoCierre === 'MOTORIZADO' && item.motorBrand !== 'NINGUNO' ? (
          <input type="text" defaultValue={item.motorSystem || ''} placeholder="Sonesse 30 / Sivoia…" onBlur={e => onUpdate(item.id, 'motorSystem', e.target.value)} style={{ ...S.input, width: 110, textAlign: 'left' }} />
        ) : <span style={{ color: '#444' }}>--</span>}
      </td>
      <td style={S.tdR}>
        <input type="number" defaultValue={item.persianaPrecioPorM2 || ''} step={0.01} placeholder="0" onBlur={e => onUpdate(item.id, 'persianaPrecioPorM2', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: 80 }} />
      </td>
      <td style={S.tdR}>{m2.toFixed(2)}</td>
      <td style={{ ...S.tdR, color: '#ccc', fontWeight: 600 }}>${matCost.toFixed(2)}</td>
      <td style={S.tdR}>
        {item.tipoCierre === 'MOTORIZADO' && item.motorBrand !== 'NINGUNO' ? (
          item.motorBrand === 'LUTRON' ? (
            <input type="number" defaultValue={item.precioMotor || ''} step={0.01} placeholder="0 USD" onBlur={e => onUpdate(item.id, 'precioMotor', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: 75 }} />
          ) : (
            <input type="number" defaultValue={item.precioMotor || ''} step={0.01} placeholder="0 MXN" onBlur={e => onUpdate(item.id, 'precioMotor', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: 75 }} />
          )
        ) : <span style={{ color: '#444' }}>--</span>}
        {item.tipoCierre === 'MOTORIZADO' && item.motorBrand === 'LUTRON' && (
          <div style={{ fontSize: 8, color: '#14B8A6' }}>= ${motorCostRaw.toFixed(2)} USD × {config.tipoCambio}</div>
        )}
      </td>
      <td style={{ ...S.tdM, color: '#57FF9A' }}>${(showInt ? totalLinea : totalConMargen).toFixed(2)}</td>
      {showInt && <td style={{ ...S.tdM, color: '#67E8F9' }}>${totalConMargen.toFixed(2)}</td>}
      <td style={{ ...S.td, width: 28, display: 'flex', gap: 4 }}>
        <button onClick={() => onCopy(item)} title="Copiar a otra área" style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Copy size={12} /></button>
        <button onClick={() => onRemove(item.id)} title="Eliminar" style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Trash2 size={12} /></button>
      </td>
    </tr>
  )
}

// ═══════════════════════════════════════════════════════════════════
// EXTRA ROW (controles, interfaces, accesorios sueltos)
// ═══════════════════════════════════════════════════════════════════
function ExtraRow({ item, config, onUpdate, onRemove, onCopy, showInt }: {
  item: CortItem; config: CortConfig
  onUpdate: (id: string, field: string, value: any) => void
  onRemove: (id: string) => void
  onCopy: (item: CortItem) => void
  showInt: boolean
}) {
  const totalLinea = calcExtraCost(item)
  // Extras use margenMotor (hardware accessories)
  const totalConMargen = config.margenMotor > 0 ? Math.round(totalLinea / (1 - config.margenMotor / 100) * 100) / 100 : totalLinea

  return (
    <tr>
      <td style={S.td}>
        <input
          type="text"
          defaultValue={item.extraDescripcion || ''}
          placeholder="Control SITUO 5, Interface INTERTEC 16 RTS…"
          onBlur={e => onUpdate(item.id, 'extraDescripcion', e.target.value)}
          style={{ ...S.input, width: 320, textAlign: 'left' }}
        />
      </td>
      <td style={S.tdR}>
        <input type="number" defaultValue={item.cantidad} min={1} onBlur={e => onUpdate(item.id, 'cantidad', parseInt(e.target.value) || 1)} style={{ ...S.input, width: 45 }} />
      </td>
      <td style={S.tdR}>
        <input type="number" defaultValue={item.extraPrecioUnitario || ''} step={0.01} placeholder="0" onBlur={e => onUpdate(item.id, 'extraPrecioUnitario', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: 90 }} />
      </td>
      <td style={{ ...S.tdR, color: '#ccc', fontWeight: 600 }}>${totalLinea.toFixed(2)}</td>
      <td style={{ ...S.tdM, color: '#57FF9A' }}>${(showInt ? totalLinea : totalConMargen).toFixed(2)}</td>
      {showInt && <td style={{ ...S.tdM, color: '#67E8F9' }}>${totalConMargen.toFixed(2)}</td>}
      <td style={{ ...S.td, width: 28, display: 'flex', gap: 4 }}>
        <button onClick={() => onCopy(item)} title="Copiar a otra área" style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Copy size={12} /></button>
        <button onClick={() => onRemove(item.id)} title="Eliminar" style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Trash2 size={12} /></button>
      </td>
    </tr>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AREA BLOCK (Room)
// ═══════════════════════════════════════════════════════════════════
function CortAreaBlock({ area, items, config, onToggle, onUpdate, onRemove, onAddCortina, onAddPersiana, onAddExtra, onRemoveArea, onShowSomfy, onCopy, showInt }: {
  area: CortArea; items: CortItem[]; config: CortConfig
  onToggle: () => void
  onUpdate: (id: string, field: string, value: any) => void
  onRemove: (id: string) => void
  onAddCortina: () => void
  onAddPersiana: () => void
  onAddExtra: () => void
  onRemoveArea: () => void
  onShowSomfy: (item: CortItem) => void
  onCopy: (item: CortItem) => void
  showInt: boolean
}) {
  const areaItems = items.filter(i => i.areaId === area.id)
  const cortinaItems = areaItems.filter(i => i.itemKind === 'CORTINA' || (!i.itemKind))
  const persianaItems = areaItems.filter(i => i.itemKind === 'PERSIANA')
  const extraItems = areaItems.filter(i => i.itemKind === 'EXTRA')

  // Totals (all MXN — Lutron motors converted via tipoCambio)
  let telaCost = 0, confCost = 0, motorCost = 0, persianaCost = 0, extraCost = 0
  areaItems.forEach(item => {
    telaCost += calcFabricCost(item)
    confCost += calcConfeccionCost(item)
    motorCost += calcMotorCostMXN(item, config.tipoCambio)
    persianaCost += calcPersianaMaterialCost(item)
    extraCost += calcExtraCost(item)
  })
  const areaTotal = telaCost + confCost + motorCost + persianaCost + extraCost
  // With margin
  const telaConMargen = config.margenTela > 0 ? Math.round(telaCost / (1 - config.margenTela / 100) * 100) / 100 : telaCost
  const confConMargen = config.margenTela > 0 ? Math.round(confCost / (1 - config.margenTela / 100) * 100) / 100 : confCost
  const motorConMargen = config.margenMotor > 0 ? Math.round(motorCost / (1 - config.margenMotor / 100) * 100) / 100 : motorCost
  const persianaConMargen = config.margenTela > 0 ? Math.round(persianaCost / (1 - config.margenTela / 100) * 100) / 100 : persianaCost
  const extraConMargen = config.margenMotor > 0 ? Math.round(extraCost / (1 - config.margenMotor / 100) * 100) / 100 : extraCost
  const areaTotalVenta = telaConMargen + confConMargen + motorConMargen + persianaConMargen + extraConMargen

  return (
    <div style={{ marginBottom: 14 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', background: '#1a1a1a', borderRadius: 10, borderLeft: '3px solid #67E8F9' }}>
        {area.collapsed ? <ChevronRight size={16} color="#67E8F9" /> : <ChevronDown size={16} color="#67E8F9" />}
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', flex: 1, textTransform: 'uppercase' as const }}>{area.name}</span>
        <span style={{ fontSize: 10, color: '#555' }}>
          {cortinaItems.length} cortina(s){persianaItems.length > 0 ? ` · ${persianaItems.length} persiana(s)` : ''}{extraItems.length > 0 ? ` · ${extraItems.length} extra(s)` : ''}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#67E8F9' }}>${(showInt ? areaTotal : areaTotalVenta).toFixed(2)}</span>
        <button
          onClick={e => { e.stopPropagation(); onRemoveArea() }}
          title="Eliminar esta área y todos sus items"
          style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', padding: 4, marginLeft: 4, display: 'flex', alignItems: 'center' }}
        ><Trash2 size={14} /></button>
      </div>
      {!area.collapsed && (
        <div style={{ paddingLeft: 8, paddingTop: 6 }}>
          {/* ───────── CORTINAS sub-section ───────── */}
          <div style={{ fontSize: 9, fontWeight: 700, color: '#67E8F9', letterSpacing: '0.08em', padding: '4px 2px 2px' }}>CORTINAS</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
              <thead><tr style={{ background: '#0e0e0e' }}>
                <th style={{ ...S.th, textAlign: 'right' }}>Ancho</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Alto</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Cant</th>
                <th style={S.th}>Cierre</th>
                <th style={S.th}>Motor</th>
                <th style={S.th}>Config</th>
                <th style={S.th}>Tela</th>
                <th style={S.th}>Pliegue</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Ancho Tela</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Costo/ML<br/><span style={{ fontSize: 8, color: '#555' }}>MXN</span></th>
                <th style={S.th}>Tela Inc.</th>
                <th style={{ ...S.th, textAlign: 'right' }}>ML</th>
                <th style={{ ...S.th, textAlign: 'right' }}>$ Tela<br/><span style={{ fontSize: 8, color: '#555' }}>MXN</span></th>
                <th style={{ ...S.th, textAlign: 'right' }}>Costo Conf<br/><span style={{ fontSize: 8, color: '#555' }}>MXN</span></th>
                <th style={{ ...S.th, textAlign: 'right' }}>$ Conf<br/><span style={{ fontSize: 8, color: '#555' }}>MXN</span></th>
                <th style={{ ...S.th, textAlign: 'right' }}>Costo Motor</th>
                <th style={{ ...S.th, textAlign: 'right', color: '#57FF9A' }}>{showInt ? 'Costo' : 'Total'}</th>
                {showInt && <th style={{ ...S.th, textAlign: 'right', color: '#67E8F9' }}>Venta</th>}
                <th style={S.th}></th>
              </tr></thead>
              <tbody>
                {cortinaItems.map(item => (
                  <CortRow key={item.id} item={item} config={config} onUpdate={onUpdate} onRemove={onRemove} onShowSomfy={onShowSomfy} onCopy={onCopy} showInt={showInt} />
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '6px 8px', marginTop: 4 }}>
            <Btn size="sm" onClick={onAddCortina}><Plus size={12} /> Cortina</Btn>
          </div>

          {/* ───────── PERSIANAS sub-section ───────── */}
          <div style={{ fontSize: 9, fontWeight: 700, color: '#C084FC', letterSpacing: '0.08em', padding: '10px 2px 2px', borderTop: persianaItems.length > 0 ? '1px solid #222' : undefined, marginTop: persianaItems.length > 0 ? 6 : 0 }}>PERSIANAS</div>
          {persianaItems.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                <thead><tr style={{ background: '#0e0e0e' }}>
                  <th style={{ ...S.th, textAlign: 'right' }}>Ancho</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Alto</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Cant</th>
                  <th style={S.th}>Tipo</th>
                  <th style={S.th}>Material</th>
                  <th style={S.th}>Cierre</th>
                  <th style={S.th}>Motor</th>
                  <th style={S.th}>Sistema</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Precio/m²<br/><span style={{ fontSize: 8, color: '#555' }}>MXN</span></th>
                  <th style={{ ...S.th, textAlign: 'right' }}>m²</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>$ Material<br/><span style={{ fontSize: 8, color: '#555' }}>MXN</span></th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Costo Motor</th>
                  <th style={{ ...S.th, textAlign: 'right', color: '#57FF9A' }}>{showInt ? 'Costo' : 'Total'}</th>
                  {showInt && <th style={{ ...S.th, textAlign: 'right', color: '#67E8F9' }}>Venta</th>}
                  <th style={S.th}></th>
                </tr></thead>
                <tbody>
                  {persianaItems.map(item => (
                    <PersianaRow key={item.id} item={item} config={config} onUpdate={onUpdate} onRemove={onRemove} onCopy={onCopy} showInt={showInt} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ padding: '6px 8px', marginTop: 4 }}>
            <Btn size="sm" onClick={onAddPersiana}><Plus size={12} /> Persiana</Btn>
          </div>

          {/* ───────── EXTRAS sub-section (controles, interfaces, etc.) ───────── */}
          <div style={{ fontSize: 9, fontWeight: 700, color: '#F59E0B', letterSpacing: '0.08em', padding: '10px 2px 2px', borderTop: extraItems.length > 0 ? '1px solid #222' : undefined, marginTop: extraItems.length > 0 ? 6 : 0 }}>EXTRAS</div>
          {extraItems.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                <thead><tr style={{ background: '#0e0e0e' }}>
                  <th style={S.th}>Descripción</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Cant</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Precio unit.<br/><span style={{ fontSize: 8, color: '#555' }}>MXN</span></th>
                  <th style={{ ...S.th, textAlign: 'right' }}>$ Subtotal<br/><span style={{ fontSize: 8, color: '#555' }}>MXN</span></th>
                  <th style={{ ...S.th, textAlign: 'right', color: '#57FF9A' }}>{showInt ? 'Costo' : 'Total'}</th>
                  {showInt && <th style={{ ...S.th, textAlign: 'right', color: '#67E8F9' }}>Venta</th>}
                  <th style={S.th}></th>
                </tr></thead>
                <tbody>
                  {extraItems.map(item => (
                    <ExtraRow key={item.id} item={item} config={config} onUpdate={onUpdate} onRemove={onRemove} onCopy={onCopy} showInt={showInt} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', marginTop: 4 }}>
            <Btn size="sm" onClick={onAddExtra}><Plus size={12} /> Extra</Btn>
            <div style={{ fontSize: 10, color: '#555' }}>
              Tela: <span style={{ color: '#ccc', fontWeight: 600 }}>${(showInt ? telaCost : telaConMargen).toFixed(2)}</span>
              <span style={{ margin: '0 6px' }}>|</span>
              Conf: <span style={{ color: '#ccc', fontWeight: 600 }}>${(showInt ? confCost : confConMargen).toFixed(2)}</span>
              <span style={{ margin: '0 6px' }}>|</span>
              Persianas: <span style={{ color: '#C084FC', fontWeight: 600 }}>${(showInt ? persianaCost : persianaConMargen).toFixed(2)}</span>
              <span style={{ margin: '0 6px' }}>|</span>
              Motor: <span style={{ color: '#14B8A6', fontWeight: 600 }}>${(showInt ? motorCost : motorConMargen).toFixed(2)}</span>
              <span style={{ margin: '0 6px' }}>|</span>
              Extras: <span style={{ color: '#F59E0B', fontWeight: 600 }}>${(showInt ? extraCost : extraConMargen).toFixed(2)}</span>
              <span style={{ margin: '0 6px' }}>|</span>
              <span style={{ fontWeight: 700, color: '#67E8F9' }}>${(showInt ? areaTotal : areaTotalVenta).toFixed(2)} MXN</span>
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
  let telaCost = 0, confCost = 0, motorCost = 0, persianaCost = 0, extraCost = 0
  items.forEach(item => {
    telaCost += calcFabricCost(item)
    confCost += calcConfeccionCost(item)
    motorCost += calcMotorCostMXN(item, config.tipoCambio)
    persianaCost += calcPersianaMaterialCost(item)
    extraCost += calcExtraCost(item)
  })

  const telaVenta = config.margenTela > 0 ? Math.round(telaCost / (1 - config.margenTela / 100) * 100) / 100 : telaCost
  const confVenta = config.margenTela > 0 ? Math.round(confCost / (1 - config.margenTela / 100) * 100) / 100 : confCost
  const motorVenta = config.margenMotor > 0 ? Math.round(motorCost / (1 - config.margenMotor / 100) * 100) / 100 : motorCost
  const persianaVenta = config.margenTela > 0 ? Math.round(persianaCost / (1 - config.margenTela / 100) * 100) / 100 : persianaCost
  const extraVenta = config.margenMotor > 0 ? Math.round(extraCost / (1 - config.margenMotor / 100) * 100) / 100 : extraCost
  const subtotalVenta = telaVenta + confVenta + motorVenta + persianaVenta + extraVenta
  const instalacion = Math.round(subtotalVenta * config.instPct / 100 * 100) / 100
  const subConInst = subtotalVenta + instalacion
  const descuentoAmt = Math.round(subConInst * (config.descuento || 0) / 100 * 100) / 100
  const subConDesc = subConInst - descuentoAmt
  const iva = Math.round(subConDesc * config.ivaRate / 100 * 100) / 100
  const total = subConDesc + iva

  // Cost side
  const subtotalCost = telaCost + confCost + motorCost + persianaCost + extraCost
  const utilidadTela = telaVenta - telaCost
  const utilidadConf = confVenta - confCost
  const utilidadMotor = motorVenta - motorCost
  const utilidadPersiana = persianaVenta - persianaCost
  const utilidadExtra = extraVenta - extraCost
  const utilidadTotal = utilidadTela + utilidadConf + utilidadMotor + utilidadPersiana + utilidadExtra
  const margenReal = subtotalVenta > 0 ? Math.round(utilidadTotal / subtotalVenta * 100) : 0

  // Fabric summary (cortinas only)
  const fabricByType: Record<string, number> = {}
  items.forEach(item => {
    if (item.itemKind === 'PERSIANA') return
    const ml = calcFabricML(item) * item.cantidad
    if (ml > 0) {
      fabricByType[item.tipoTela] = (fabricByType[item.tipoTela] || 0) + ml
    }
  })

  // Cortina vs persiana counts
  const cortinaCount = items.filter(i => i.itemKind !== 'PERSIANA').reduce((s, i) => s + i.cantidad, 0)
  const persianaCount = items.filter(i => i.itemKind === 'PERSIANA').reduce((s, i) => s + i.cantidad, 0)
  // Manual/Motorizada split — across both cortinas and persianas
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
            <span style={{ fontSize: 10, color: '#888' }}>Descuento %</span>
            <input type="number" value={config.descuento || 0} step={1} min={0} max={100}
              onChange={e => onConfigChange('descuento', Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))} style={inputS} />
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
          { l: 'CORTINAS (total)', v: cortinaCount, isCount: true },
          { l: 'PERSIANAS (total)', v: persianaCount, isCount: true },
          { l: 'MANUALES', v: manualCount, isCount: true },
          { l: 'MOTORIZADAS', v: motorCount, isCount: true },
          { l: 'TELA (costo)', v: telaCost, b: false },
          { l: 'TELA (venta)', v: telaVenta, b: true },
          { l: 'CONFECCION (costo)', v: confCost, b: false },
          { l: 'CONFECCION (venta)', v: confVenta, b: true },
          { l: 'TELAS CONFECCIONADAS', v: telaVenta + confVenta, b: true },
          ...(persianaCount > 0 ? [
            { l: 'PERSIANAS MATERIAL (costo)', v: persianaCost, b: false },
            { l: 'PERSIANAS MATERIAL (venta)', v: persianaVenta, b: true },
          ] : []),
          { l: 'MOTORIZACION (costo)', v: motorCost, b: false },
          { l: 'MOTORIZACION (venta)', v: motorVenta, b: true },
          ...(extraCost > 0 ? [
            { l: 'EXTRAS (costo)', v: extraCost, b: false },
            { l: 'EXTRAS (venta)', v: extraVenta, b: true },
          ] : []),
          { l: 'SUBTOTAL', v: subtotalVenta, b: true },
          { l: 'INSTALACION (' + config.instPct + '%)', v: instalacion },
          { l: 'SUBTOTAL + INST', v: subConInst, b: true },
          ...((config.descuento || 0) > 0 ? [
            { l: 'DESCUENTO (' + config.descuento + '%)', v: -descuentoAmt, b: false, disc: true },
            { l: 'SUBTOTAL C/DESC', v: subConDesc, b: true },
          ] : []),
          { l: 'IVA (' + config.ivaRate + '%)', v: iva },
          { l: 'TOTAL', v: total, b: true, h: true },
        ] as Array<{ l: string; v: number; isCount?: boolean; b?: boolean; h?: boolean; disc?: boolean }>).map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderTop: r.b ? '1px solid #222' : 'none' }}>
            <span style={{ fontSize: 10, color: r.disc ? '#EF4444' : r.h ? '#67E8F9' : r.b ? '#ccc' : '#555', fontWeight: r.b ? 700 : 400 }}>{r.l}</span>
            <span style={{ fontSize: r.h ? 15 : 11, fontWeight: r.b ? 700 : 400, color: r.disc ? '#EF4444' : r.h ? '#67E8F9' : '#fff' }}>
              {r.isCount ? r.v : '$' + Math.abs(r.v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
            m += calcMotorCostMXN(item, config.tipoCambio)
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
// AI IMPORT MODAL — Importar cotización de cortinas/persianas desde PDF
// ═══════════════════════════════════════════════════════════════════
interface AIExtractedItemCort {
  _rowId: string
  area: string
  itemKind: ItemKind
  persianaTipo: PersianaTipo
  persianaMaterial: string
  ancho: number
  alto: number
  cantidad: number
  tipoCierre: 'MANUAL' | 'MOTORIZADO'
  motorBrand: 'SOMFY' | 'LUTRON' | 'NINGUNO'
  motorSystem: string
  tipoTela: string
  tipoPliegue: string
  totalVenta: number
  notas: string
}

interface AIExtraCort {
  _rowId: string
  nombre: string
  cantidad: number
  precioUnitario: number
  total: number
}

function AIImportModalCortinas({ cotId, areas, config, onClose, onImported }: {
  cotId: string
  areas: CortArea[]
  config: CortConfig
  onClose: () => void
  onImported: () => void
}) {
  const isMobile = useIsMobile()
  const [step, setStep] = useState<'upload' | 'processing' | 'review' | 'inserting'>('upload')
  const [items, setItems] = useState<AIExtractedItemCort[]>([])
  const [extras, setExtras] = useState<AIExtraCort[]>([])
  const [meta, setMeta] = useState<any>({})
  const [warnings, setWarnings] = useState<string[]>([])
  const [confidence, setConfidence] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')
  const [insertedCount, setInsertedCount] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  // Precios en el archivo son venta (con margen al cliente — default, lo más común)
  // o costo (interno, sin margen). Si venta, back-calculamos costo = total × (1 − margenTela/100).
  const [priceMode, setPriceMode] = useState<'venta' | 'costo'>('venta')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function fileToBase64(file: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res((r.result as string).split(',')[1])
      r.onerror = () => rej(new Error('Error leyendo archivo'))
      r.readAsDataURL(file)
    })
  }

  async function loadXLSX(): Promise<any> {
    if ((window as any).XLSX) return (window as any).XLSX
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('No se pudo cargar SheetJS desde CDN'))
      document.head.appendChild(script)
    })
    if (!(window as any).XLSX) throw new Error('SheetJS cargado pero no disponible')
    return (window as any).XLSX
  }

  async function handleFile(file: File) {
    setError(null); setStep('processing'); setProgress('Procesando archivo...')
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase()
      let apiBody: any = null

      if (ext === 'pdf') {
        setProgress('Codificando PDF...')
        const base64 = await fileToBase64(file)
        apiBody = { kind: 'pdf', payload: base64, context: 'cortinas' }
      } else if (ext === 'xlsx' || ext === 'xls') {
        setProgress('Cargando parser de Excel...')
        const XLSX = await loadXLSX()
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        setProgress('Extrayendo texto de Excel...')
        // Concatenate all sheets as CSV so Claude can read the tabular structure
        let text = ''
        for (const sheetName of wb.SheetNames) {
          text += '\n=== Hoja: ' + sheetName + ' ===\n'
          text += XLSX.utils.sheet_to_csv(wb.Sheets[sheetName])
        }
        if (text.trim().length < 20) throw new Error('Excel vacío o sin datos legibles')
        apiBody = { kind: 'text', payload: text, context: 'cortinas' }
      } else if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        setProgress('Leyendo archivo...')
        const text = await file.text()
        if (text.trim().length < 20) throw new Error('Archivo vacío')
        apiBody = { kind: 'text', payload: text, context: 'cortinas' }
      } else {
        throw new Error('Formato no soportado: .' + ext + ' (usa PDF, Excel xlsx/xls o CSV)')
      }

      setProgress('Analizando con AI (puede tardar 20-40 seg)...')
      const r = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiBody),
      })
      const data = await r.json()
      if (!r.ok || !data.ok) throw new Error(data.error || 'Error en /api/extract (' + r.status + ')')

      // Normalize items from API into AIExtractedItemCort
      const rawItems: any[] = data.items || []
      const normalized: AIExtractedItemCort[] = rawItems.map((it: any) => ({
        _rowId: uid(),
        area: String(it.area || 'GENERAL').trim().toUpperCase(),
        itemKind: it.itemKind === 'CORTINA' ? 'CORTINA' : 'PERSIANA',
        persianaTipo: ['ROLLER', 'VENECIANA', 'ROMANA'].includes(it.persianaTipo) ? it.persianaTipo : 'ROLLER',
        persianaMaterial: String(it.persianaMaterial || '').trim(),
        ancho: Number(it.ancho) || 0,
        alto: Number(it.alto) || 0,
        cantidad: parseInt(it.cantidad) || 1,
        tipoCierre: it.tipoCierre === 'MANUAL' ? 'MANUAL' : 'MOTORIZADO',
        motorBrand: ['SOMFY', 'LUTRON', 'NINGUNO'].includes(it.motorBrand) ? it.motorBrand : 'NINGUNO',
        motorSystem: String(it.motorSystem || '').trim(),
        tipoTela: String(it.tipoTela || '').trim(),
        tipoPliegue: String(it.tipoPliegue || '').trim(),
        totalVenta: Number(it.totalVenta) || 0,
        notas: String(it.notas || '').trim(),
      }))
      const rawExtras: any[] = data.extras || []
      const normalizedExtras: AIExtraCort[] = rawExtras.map((e: any) => ({
        _rowId: uid(),
        nombre: String(e.nombre || '').trim(),
        cantidad: parseInt(e.cantidad) || 1,
        precioUnitario: Number(e.precioUnitario) || 0,
        total: Number(e.total) || (Number(e.precioUnitario) || 0) * (parseInt(e.cantidad) || 1),
      }))

      setItems(normalized)
      setExtras(normalizedExtras)
      setMeta(data.meta || {})
      setWarnings(data.warnings || [])
      setConfidence(data.confidence || 'medium')
      setStep('review')
    } catch (err: any) {
      setError(err.message || 'Error procesando archivo')
      setStep('upload')
    }
  }

  function updateRow(rowId: string, field: keyof AIExtractedItemCort, value: any) {
    setItems(prev => prev.map(it => it._rowId === rowId ? { ...it, [field]: value } : it))
  }
  function removeRow(rowId: string) { setItems(prev => prev.filter(it => it._rowId !== rowId)) }
  function updateExtra(rowId: string, field: keyof AIExtraCort, value: any) {
    setExtras(prev => prev.map(e => e._rowId === rowId ? { ...e, [field]: value } : e))
  }
  function removeExtra(rowId: string) { setExtras(prev => prev.filter(e => e._rowId !== rowId)) }

  async function handleConfirm() {
    setStep('inserting'); setError(null); setInsertedCount(0)
    try {
      // 1) Ensure all unique areas exist
      setProgress('Sincronizando áreas...')
      const areaCache: Record<string, string> = {}
      areas.forEach(a => { areaCache[a.name.toUpperCase().trim()] = a.id })

      const uniqueAreaNames = new Set<string>()
      items.forEach(it => uniqueAreaNames.add((it.area || 'GENERAL').toUpperCase().trim()))
      if (extras.length > 0) uniqueAreaNames.add('EXTRAS')

      for (const name of uniqueAreaNames) {
        if (areaCache[name]) continue
        const { data: newArea, error: areaErr } = await supabase.from('quotation_areas').insert({
          quotation_id: cotId, name, order_index: Object.keys(areaCache).length,
        }).select().single()
        if (areaErr) throw new Error('Error creando área "' + name + '": ' + areaErr.message)
        if (newArea) areaCache[name] = newArea.id
      }

      // 2) Insert items (cortinas/persianas)
      setProgress('Insertando productos...')
      let inserted = 0
      // If the PDF has VENTA prices (default), back-calculate cost so that when the
      // editor applies margenTela on top, totals match the PDF exactly.
      // factor = (1 − margenTela/100): a 40% margin gives factor = 0.6
      const costFactor = priceMode === 'venta'
        ? Math.max(0.01, 1 - (config.margenTela || 0) / 100)
        : 1
      for (const it of items) {
        const areaKey = (it.area || 'GENERAL').toUpperCase().trim()
        const areaId = areaCache[areaKey]
        if (!areaId) continue

        // Back-calculate precio per m² from totalVenta (since PDF only has total per row)
        const m2 = it.ancho * it.alto * it.cantidad
        const baseTotal = it.totalVenta * costFactor  // becomes cost basis after margin reversal
        const persianaPrecioPorM2 = (it.itemKind === 'PERSIANA' && m2 > 0) ? Math.round((baseTotal / m2) * 100) / 100 : 0

        // Build CortItem-shaped note JSON
        const noteObj: any = {
          itemKind: it.itemKind,
          ancho: it.ancho, alto: it.alto,
          tipoCierre: it.tipoCierre, motorBrand: it.motorBrand, motorSystem: it.motorSystem,
          somfyHojas: 1, somfyPliegue: 'TRADICIONAL', somfyAbundancia: 0,
          somfySoportePared: false, somfyAmrado: false, somfyCurveado: false,
          tipoTela: it.tipoTela || 'TRASLUCIDA', anchoTela: 0, tipoPliegue: it.tipoPliegue || 'ONDA PERFECTA',
          precioTelaPorML: 0, precioConfeccion: 0, telaIncluida: false, precioMotor: 0,
          persianaTipo: it.persianaTipo, persianaMaterial: it.persianaMaterial, persianaPrecioPorM2,
        }

        const itemName = it.notas || (it.itemKind === 'PERSIANA' ? `${it.persianaTipo} ${it.persianaMaterial}`.trim() : it.tipoTela)
        const { error: itemErr } = await supabase.from('quotation_items').insert({
          quotation_id: cotId, area_id: areaId,
          name: itemName, system: 'Cortinas', type: 'material',
          quantity: it.cantidad, cost: 0, price: 0, total: it.totalVenta, markup: 0,
          installation_cost: 0, order_index: inserted,
          notes: JSON.stringify(noteObj),
        })
        if (itemErr) throw new Error('Error insertando "' + itemName + '": ' + itemErr.message)
        inserted++
        setInsertedCount(inserted)
      }

      // 3) Insert extras as proper EXTRA items in EXTRAS area
      const extrasAreaId = areaCache['EXTRAS']
      for (const ex of extras) {
        if (!extrasAreaId) continue
        const totalEx = ex.total || (ex.precioUnitario * ex.cantidad)
        const baseTotalEx = totalEx * costFactor
        // extraPrecioUnitario = costo unitario después del back-calc
        const precioUnitario = ex.cantidad > 0 ? Math.round((baseTotalEx / ex.cantidad) * 100) / 100 : 0
        const noteObj: any = {
          itemKind: 'EXTRA',
          ancho: 0, alto: 0,
          tipoCierre: 'MANUAL', motorBrand: 'NINGUNO', motorSystem: '',
          somfyHojas: 1, somfyPliegue: 'TRADICIONAL', somfyAbundancia: 0,
          somfySoportePared: false, somfyAmrado: false, somfyCurveado: false,
          tipoTela: 'TRASLUCIDA', anchoTela: 0, tipoPliegue: 'ONDA PERFECTA',
          precioTelaPorML: 0, precioConfeccion: 0, telaIncluida: false, precioMotor: 0,
          persianaTipo: 'ROLLER', persianaMaterial: '', persianaPrecioPorM2: 0,
          extraDescripcion: ex.nombre, extraPrecioUnitario: precioUnitario,
        }
        const { error: exErr } = await supabase.from('quotation_items').insert({
          quotation_id: cotId, area_id: extrasAreaId,
          name: ex.nombre, system: 'Cortinas', type: 'material',
          quantity: ex.cantidad, cost: 0, price: 0, total: totalEx, markup: 0,
          installation_cost: 0, order_index: inserted,
          notes: JSON.stringify(noteObj),
        })
        if (exErr) throw new Error('Error insertando extra "' + ex.nombre + '": ' + exErr.message)
        inserted++
        setInsertedCount(inserted)
      }

      onImported()
    } catch (err: any) {
      setError(err.message || 'Error insertando items')
      setStep('review')
    }
  }

  return (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={e => e.preventDefault()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: isMobile ? 0 : 14, padding: isMobile ? 16 : 24, width: isMobile ? '100vw' : 'min(1200px, 95vw)', height: isMobile ? '100vh' : 'auto', maxHeight: isMobile ? '100vh' : '90vh', overflowY: 'auto', margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={16} color="#A855F7" /> Importar Cotización (PDF / Excel)
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Sube tu cotización y Claude la parsea automáticamente.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {error && <div style={{ background: '#EF444422', border: '1px solid #EF4444', borderRadius: 8, padding: 10, marginBottom: 12, color: '#FCA5A5', fontSize: 11 }}>⚠ {error}</div>}

        {step === 'upload' && (
          <div>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }}
              onDragLeave={e => {
                e.preventDefault(); e.stopPropagation()
                // Only un-highlight if leaving the drop zone entirely (not entering a child)
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                setIsDragging(false)
              }}
              onDrop={e => {
                e.preventDefault(); e.stopPropagation(); setIsDragging(false)
                const f = e.dataTransfer.files?.[0]
                if (f) handleFile(f)
              }}
              style={{
                border: isDragging ? '2px dashed #A855F7' : '2px dashed #444',
                borderRadius: 12,
                padding: 40,
                textAlign: 'center',
                cursor: 'pointer',
                background: isDragging ? '#A855F71A' : '#0e0e0e',
                transition: 'all 0.15s ease',
              }}
            >
              <Upload size={32} color={isDragging ? '#C084FC' : '#A855F7'} style={{ margin: '0 auto 12px', transition: 'color 0.15s ease' }} />
              <div style={{ fontSize: 13, color: isDragging ? '#C084FC' : '#ccc', fontWeight: 600, marginBottom: 4 }}>
                {isDragging ? 'Suelta el archivo aquí' : 'Click o arrastra el archivo aquí'}
              </div>
              <div style={{ fontSize: 10, color: '#666' }}>
                PDF · Excel (.xlsx/.xls) · CSV — formato de cotización Somfy / OMM
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.xls,.csv,.tsv,.txt" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

            {/* Toggle: ¿los precios del archivo son venta o costo? */}
            <div style={{ marginTop: 16, padding: 12, background: '#0e0e0e', border: '1px solid #222', borderRadius: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Precios en el archivo</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setPriceMode('venta')}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                    border: '1px solid ' + (priceMode === 'venta' ? '#A855F7' : '#333'),
                    background: priceMode === 'venta' ? '#A855F722' : 'transparent',
                    color: priceMode === 'venta' ? '#C084FC' : '#888',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700 }}>Venta (cliente)</div>
                  <div style={{ fontSize: 9, marginTop: 2, opacity: 0.85 }}>El total ya incluye margen — back-calcular costo con margenTela {config.margenTela}%</div>
                </button>
                <button
                  onClick={() => setPriceMode('costo')}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                    border: '1px solid ' + (priceMode === 'costo' ? '#A855F7' : '#333'),
                    background: priceMode === 'costo' ? '#A855F722' : 'transparent',
                    color: priceMode === 'costo' ? '#C084FC' : '#888',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700 }}>Costo (interno)</div>
                  <div style={{ fontSize: 9, marginTop: 2, opacity: 0.85 }}>Los precios son costos sin margen — importar tal cual</div>
                </button>
              </div>
              {priceMode === 'venta' && config.margenTela > 0 && (
                <div style={{ marginTop: 6, fontSize: 9, color: '#666' }}>
                  Costo aplicado = total × {(1 - config.margenTela / 100).toFixed(2)} (con margen {config.margenTela}% de la cotización)
                </div>
              )}
            </div>

            <div style={{ marginTop: 14, fontSize: 10, color: '#666', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: '#888', marginBottom: 4 }}>El importador extrae:</div>
              • Items de cortinas/persianas con área, dimensiones, motor, tela, total<br/>
              • Extras (controles, interfaces) van a un área "EXTRAS" separada<br/>
              • Precio/m² se back-calcula desde el total + el modo elegido arriba
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={32} color="#A855F7" style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
            <div style={{ fontSize: 13, color: '#ccc' }}>{progress}</div>
            <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {step === 'review' && (
          <div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, fontSize: 11 }}>
              <span style={{ padding: '2px 8px', borderRadius: 5, background: confidence === 'high' ? '#10B98122' : confidence === 'low' ? '#EF444422' : '#F59E0B22', color: confidence === 'high' ? '#10B981' : confidence === 'low' ? '#EF4444' : '#F59E0B', fontWeight: 600 }}>Confianza: {confidence}</span>
              <span style={{ color: '#888' }}>{items.length} items · {extras.length} extras</span>
              {meta.cliente && <span style={{ color: '#888' }}>· Cliente: <span style={{ color: '#ccc' }}>{meta.cliente}</span></span>}
              {meta.proyecto && <span style={{ color: '#888' }}>· Proyecto: <span style={{ color: '#ccc' }}>{meta.proyecto}</span></span>}
            </div>
            {warnings.length > 0 && (
              <div style={{ background: '#F59E0B22', border: '1px solid #F59E0B', borderRadius: 8, padding: 8, marginBottom: 10, fontSize: 10, color: '#FCD34D' }}>
                {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}

            <div style={{ maxHeight: '50vh', overflowY: 'auto', border: '1px solid #222', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead style={{ background: '#0e0e0e', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ ...S.th, textAlign: 'left' }}>Área</th>
                    <th style={S.th}>Tipo</th>
                    <th style={S.th}>Material</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Ancho</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Alto</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Cant</th>
                    <th style={S.th}>Cierre</th>
                    <th style={S.th}>Motor</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Total MXN</th>
                    <th style={S.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it._rowId}>
                      <td style={{ ...S.td, fontSize: 10 }}>
                        <input type="text" defaultValue={it.area} onBlur={e => updateRow(it._rowId, 'area', e.target.value.toUpperCase())} style={{ ...S.input, width: 120, textAlign: 'left', fontSize: 10 }} />
                      </td>
                      <td style={S.td}>
                        <select value={it.itemKind} onChange={e => updateRow(it._rowId, 'itemKind', e.target.value)} style={{ ...S.select, width: 85 }}>
                          <option value="PERSIANA">Persiana</option>
                          <option value="CORTINA">Cortina</option>
                        </select>
                      </td>
                      <td style={S.td}>
                        <input type="text" defaultValue={it.persianaMaterial || it.tipoTela} onBlur={e => updateRow(it._rowId, it.itemKind === 'PERSIANA' ? 'persianaMaterial' : 'tipoTela', e.target.value)} style={{ ...S.input, width: 110, textAlign: 'left', fontSize: 10 }} />
                      </td>
                      <td style={S.tdR}><input type="number" defaultValue={it.ancho} step={0.01} onBlur={e => updateRow(it._rowId, 'ancho', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: 55 }} /></td>
                      <td style={S.tdR}><input type="number" defaultValue={it.alto} step={0.01} onBlur={e => updateRow(it._rowId, 'alto', parseFloat(e.target.value) || 0)} style={{ ...S.input, width: 55 }} /></td>
                      <td style={S.tdR}><input type="number" defaultValue={it.cantidad} min={1} onBlur={e => updateRow(it._rowId, 'cantidad', parseInt(e.target.value) || 1)} style={{ ...S.input, width: 45 }} /></td>
                      <td style={S.td}>
                        <select value={it.tipoCierre} onChange={e => updateRow(it._rowId, 'tipoCierre', e.target.value)} style={{ ...S.select, width: 90 }}>
                          <option value="MANUAL">Manual</option>
                          <option value="MOTORIZADO">Motorizado</option>
                        </select>
                      </td>
                      <td style={{ ...S.td, fontSize: 10 }}>
                        <input type="text" defaultValue={it.motorSystem} onBlur={e => updateRow(it._rowId, 'motorSystem', e.target.value)} placeholder="LSN50…" style={{ ...S.input, width: 100, textAlign: 'left', fontSize: 10 }} />
                      </td>
                      <td style={{ ...S.tdM, color: '#57FF9A' }}>${it.totalVenta.toFixed(2)}</td>
                      <td style={S.td}><button onClick={() => removeRow(it._rowId)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                  {extras.length > 0 && (
                    <>
                      <tr style={{ background: '#1a1a1a' }}><td colSpan={10} style={{ padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#A855F7', letterSpacing: '0.08em' }}>EXTRAS (controles, interfaces, etc.)</td></tr>
                      {extras.map(ex => (
                        <tr key={ex._rowId}>
                          <td colSpan={2} style={S.td}>
                            <input type="text" defaultValue={ex.nombre} onBlur={e => updateExtra(ex._rowId, 'nombre', e.target.value)} style={{ ...S.input, width: '95%', textAlign: 'left', fontSize: 10 }} />
                          </td>
                          <td style={S.td} colSpan={3}>—</td>
                          <td style={S.tdR}><input type="number" defaultValue={ex.cantidad} min={1} onBlur={e => updateExtra(ex._rowId, 'cantidad', parseInt(e.target.value) || 1)} style={{ ...S.input, width: 45 }} /></td>
                          <td style={S.td} colSpan={2}>—</td>
                          <td style={{ ...S.tdM, color: '#57FF9A' }}>${ex.total.toFixed(2)}</td>
                          <td style={S.td}><button onClick={() => removeExtra(ex._rowId)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><Trash2 size={12} /></button></td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <button onClick={() => setStep('upload')} style={{ padding: '6px 14px', background: 'transparent', border: '1px solid #444', borderRadius: 6, color: '#ccc', cursor: 'pointer', fontSize: 11 }}>← Cargar otro PDF</button>
              <Btn onClick={handleConfirm}><FileText size={12} /> Importar {items.length + extras.length} items</Btn>
            </div>
          </div>
        )}

        {step === 'inserting' && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={32} color="#A855F7" style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
            <div style={{ fontSize: 13, color: '#ccc' }}>{progress}</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>{insertedCount} / {items.length + extras.length} insertados</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function CotEditorCortinas({ cotId, onBack, onSwitchVersion }: { cotId: string; onBack: () => void; onSwitchVersion?: (id: string) => void }) {
  const isMobile = useIsMobile()
  const [areas, setAreas] = useState<CortArea[]>([])
  const [items, setItems] = useState<CortItem[]>([])
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<CortConfig>({
    currency: 'MXN', tipoCambio: 20.5, ivaRate: 16, instPct: 15,
    margenTela: 40, margenMotor: 45, descuento: 0,
  })
  const [showInt, setShowInt] = useState(true)
  const [stage, setStage] = useState('oportunidad')
  const [cotName, setCotName] = useState('')
  const [clientName, setClientName] = useState('')
  const [projectName, setProjectName] = useState('')
  const [somfyDetail, setSomfyDetail] = useState<CortItem | null>(null)
  const [showPdf, setShowPdf] = useState(false)
  const [showAIImport, setShowAIImport] = useState(false)
  const [showAreaPicker, setShowAreaPicker] = useState(false)
  const [copyingItem, setCopyingItem] = useState<CortItem | null>(null)
  const [showEditInfo, setShowEditInfo] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)

  // ── Load from DB ──
  async function load() {
    const [{ data: cot }, { data: qAreas }, { data: qItems }] = await Promise.all([
      supabase.from('quotations').select('*,project:projects!quotations_project_id_fkey(name,client_name)').eq('id', cotId).single(),
      supabase.from('quotation_areas').select('*').eq('quotation_id', cotId).order('order_index'),
      supabase.from('quotation_items').select('*').eq('quotation_id', cotId).order('order_index'),
    ])
    if (cot) {
      setCotName(cot.name || ''); setClientName(cot.client_name || ''); setStage(cot.stage || 'oportunidad')
      setProjectId(cot.project_id || null)
      const proj = cot.project as any
      setProjectName(proj?.name || '')
      try {
        const meta = JSON.parse(cot.notes || '{}')
        existingNotesRef.current = meta
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
          itemKind: (meta.itemKind === 'PERSIANA' ? 'PERSIANA' : meta.itemKind === 'EXTRA' ? 'EXTRA' : 'CORTINA') as ItemKind,
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
          persianaTipo: (meta.persianaTipo as PersianaTipo) || 'ROLLER',
          persianaMaterial: meta.persianaMaterial || '',
          persianaPrecioPorM2: meta.persianaPrecioPorM2 || 0,
          extraDescripcion: meta.extraDescripcion || '',
          extraPrecioUnitario: meta.extraPrecioUnitario || 0,
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
  const existingNotesRef = useRef<Record<string, any>>({})

  function saveQuotationNotes(configToSave: CortConfig) {
    // Merge with existing notes to preserve lead_id, lead_name, systems, etc.
    const merged = { ...existingNotesRef.current, cortConfig: configToSave, currency: configToSave.currency, tipoCambio: configToSave.tipoCambio }
    existingNotesRef.current = merged
    supabase.from('quotations').update({ notes: JSON.stringify(merged) }).eq('id', cotId)
      .then(({ error }) => { if (error) console.error('saveQuotationNotes error:', error) })
  }

  function itemToDbNotes(item: CortItem): string {
    return JSON.stringify({
      itemKind: item.itemKind,
      ancho: item.ancho, alto: item.alto,
      tipoCierre: item.tipoCierre, motorBrand: item.motorBrand, motorSystem: item.motorSystem,
      somfyHojas: item.somfyHojas, somfyPliegue: item.somfyPliegue,
      somfyAbundancia: item.somfyAbundancia, somfySoportePared: item.somfySoportePared,
      somfyAmrado: item.somfyAmrado, somfyCurveado: item.somfyCurveado,
      tipoTela: item.tipoTela, anchoTela: item.anchoTela, tipoPliegue: item.tipoPliegue,
      precioTelaPorML: item.precioTelaPorML, precioConfeccion: item.precioConfeccion, telaIncluida: item.telaIncluida, precioMotor: item.precioMotor,
      persianaTipo: item.persianaTipo, persianaMaterial: item.persianaMaterial, persianaPrecioPorM2: item.persianaPrecioPorM2,
      extraDescripcion: item.extraDescripcion, extraPrecioUnitario: item.extraPrecioUnitario,
    })
  }

  function calcItemTotal(item: CortItem): number {
    if (item.itemKind === 'EXTRA') return calcExtraCost(item)
    if (item.itemKind === 'PERSIANA') {
      return calcPersianaMaterialCost(item) + calcMotorCostMXN(item, config.tipoCambio)
    }
    return calcFabricCost(item) + calcConfeccionCost(item) + calcMotorCostMXN(item, config.tipoCambio)
  }

  // ── Total for header ──
  const grandTotal = useMemo(() => {
    let telaCost = 0, confCost = 0, motorCost = 0, persianaCost = 0, extraCost = 0
    items.forEach(item => {
      telaCost += calcFabricCost(item)
      confCost += calcConfeccionCost(item)
      motorCost += calcMotorCostMXN(item, config.tipoCambio)
      persianaCost += calcPersianaMaterialCost(item)
      extraCost += calcExtraCost(item)
    })
    const telaVenta = config.margenTela > 0 ? Math.round(telaCost / (1 - config.margenTela / 100) * 100) / 100 : telaCost
    const confVenta = config.margenTela > 0 ? Math.round(confCost / (1 - config.margenTela / 100) * 100) / 100 : confCost
    const motorVenta = config.margenMotor > 0 ? Math.round(motorCost / (1 - config.margenMotor / 100) * 100) / 100 : motorCost
    // Persiana material uses the same fabric margin (margenTela) for simplicity
    const persianaVenta = config.margenTela > 0 ? Math.round(persianaCost / (1 - config.margenTela / 100) * 100) / 100 : persianaCost
    // Extras use margenMotor (hardware accessories priced similarly to motors)
    const extraVenta = config.margenMotor > 0 ? Math.round(extraCost / (1 - config.margenMotor / 100) * 100) / 100 : extraCost
    const sub = telaVenta + confVenta + motorVenta + persianaVenta + extraVenta
    const inst = sub * config.instPct / 100
    const subInst = sub + inst
    const descAmt = subInst * (config.descuento || 0) / 100
    const subDesc = subInst - descAmt
    return subDesc + subDesc * config.ivaRate / 100
  }, [items, config])

  // Sync total to quotations table
  useEffect(() => {
    if (!loading && cotId) {
      const rounded = Math.round(grandTotal * 100) / 100
      supabase.from('quotations').update({ total: rounded }).eq('id', cotId)
        .then(({ error }) => { if (error) console.error('sync total error:', error); else console.log('synced total:', rounded) })
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

  async function addItem(areaId: string, kind: ItemKind = 'CORTINA') {
    const order = items.filter(i => i.areaId === areaId).length
    const newItem = kind === 'PERSIANA' ? defaultPersiana(areaId, order)
                  : kind === 'EXTRA' ? defaultExtra(areaId, order)
                  : defaultItem(areaId, order)
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

  async function addAreaByName(name: string) {
    const { data, error } = await supabase.from('quotation_areas').insert({
      quotation_id: cotId, name, order_index: areas.length,
    }).select().single()
    if (error) { alert('Error: ' + error.message); return }
    if (data) {
      setAreas(prev => [...prev, { id: data.id, name, collapsed: false, order: prev.length }])
    }
  }

  async function removeArea(areaId: string) {
    const areaItems = items.filter(i => i.areaId === areaId)
    const areaName = areas.find(a => a.id === areaId)?.name || 'esta área'
    if (areaItems.length > 0) {
      if (!confirm(`"${areaName}" tiene ${areaItems.length} item(s) (cortinas/persianas). ¿Eliminar el área y todos sus items?`)) return
      const { error: delItemsErr } = await supabase.from('quotation_items').delete().eq('area_id', areaId)
      if (delItemsErr) { alert('Error eliminando items: ' + delItemsErr.message); return }
      setItems(prev => prev.filter(i => i.areaId !== areaId))
    } else {
      if (!confirm(`¿Eliminar el área "${areaName}"?`)) return
    }
    const { error: delAreaErr } = await supabase.from('quotation_areas').delete().eq('id', areaId)
    if (delAreaErr) { alert('Error eliminando área: ' + delAreaErr.message); return }
    setAreas(prev => prev.filter(a => a.id !== areaId))
  }

  function getVersionSnapshot(): VersionSnapshot {
    let telaCost = 0, confCost = 0, motorCost = 0
    items.forEach(item => {
      telaCost += calcFabricCost(item)
      confCost += calcConfeccionCost(item)
      motorCost += calcMotorCostMXN(item, config.tipoCambio)
    })
    const telaVenta = config.margenTela > 0 ? Math.round(telaCost / (1 - config.margenTela / 100) * 100) / 100 : telaCost
    const confVenta = config.margenTela > 0 ? Math.round(confCost / (1 - config.margenTela / 100) * 100) / 100 : confCost
    const motorVenta = config.margenMotor > 0 ? Math.round(motorCost / (1 - config.margenMotor / 100) * 100) / 100 : motorCost
    const sub = telaVenta + confVenta + motorVenta
    const inst = sub * config.instPct / 100
    const subInst = sub + inst
    const descAmt = subInst * (config.descuento || 0) / 100
    const subDesc = subInst - descAmt
    const totalCalc = subDesc + subDesc * config.ivaRate / 100
    return {
      config: { ...config },
      areas: areas.map(a => ({ id: a.id, name: a.name, order: a.order })),
      items: items.map(it => ({
        id: it.id, areaId: it.areaId, name: it.ubicacion || 'Cortina',
        description: `${it.ancho}m x ${it.alto}m | ${it.tipoCierre} | ${it.motorBrand}`,
        quantity: it.cantidad, price: calcItemTotal(it) / (it.cantidad || 1),
        cost: 0, total: calcItemTotal(it),
        system: 'Cortinas',
        tipoCierre: it.tipoCierre, motorBrand: it.motorBrand,
        tipoTela: it.tipoTela, ancho: it.ancho, alto: it.alto,
      })),
      total: totalCalc,
      subtotal: subDesc,
      editorType: 'cortinas',
      meta: { margenTela: config.margenTela, margenMotor: config.margenMotor, instPct: config.instPct },
    }
  }

  if (loading) return <Loading />

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ padding: isMobile ? '7px 8px' : '7px 16px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10, flexShrink: 0, background: '#111', flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><ChevronLeft size={14} /> Cotizaciones</button>
        <span style={{ color: '#333' }}>/</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#67E8F9' }}>{String.fromCodePoint(0x25A6)} {cotName || 'Cotizacion Cortinas'}</span>
        <Badge label="CORT" color="#67E8F9" />
        {clientName && <span style={{ fontSize: 11, color: '#888' }}>{clientName}</span>}
        {projectName && <span style={{ fontSize: 10, color: '#555' }}>| {projectName}</span>}
        <button onClick={() => setShowEditInfo(true)} style={{background:'none',border:'none',color:'#555',cursor:'pointer',padding:2,display:'flex',alignItems:'center'}} title="Editar info"><Pencil size={12}/></button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {(Object.entries(STAGE_CONFIG) as Array<[string, { label: string; color: string }]>).map(([s, cfg]) => (
            <button key={s} onClick={() => { setStage(s); supabase.from('quotations').update({ stage: s }).eq('id', cotId) }} style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid ' + (stage === s ? cfg.color : '#333'), background: stage === s ? cfg.color + '22' : 'transparent', color: stage === s ? cfg.color : '#555',
            }}>{cfg.label}</button>
          ))}
          <button onClick={() => setShowInt(!showInt)} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid ' + (showInt ? '#F59E0B' : '#333'), background: showInt ? '#F59E0B22' : 'transparent', color: showInt ? '#F59E0B' : '#555', marginLeft: 8 }}>{showInt ? 'Interno' : 'Cliente'}</button>
          <button onClick={() => setShowAIImport(true)} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #A855F7', background: '#A855F722', color: '#A855F7', marginLeft: 4, display: 'flex', alignItems: 'center', gap: 4 }} title="Importar PDF o Excel de cortinas/persianas con AI"><Upload size={12} /> Importar</button>
          <button onClick={() => setShowPdf(true)} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #67E8F9', background: '#67E8F922', color: '#67E8F9', marginLeft: 4, display: 'flex', alignItems: 'center', gap: 4 }}><Printer size={12} /> PDF</button>
          <VersionManager cotId={cotId} getCurrentSnapshot={getVersionSnapshot} onSwitchVersion={onSwitchVersion || (() => {})} accentColor="#67E8F9" compact={isMobile} />
          <span style={{ fontSize: 15, fontWeight: 700, color: '#67E8F9', marginLeft: 10 }}>${grandTotal.toFixed(2)}</span>
        </div>
      </div>

      {/* Currency bar */}
      <div style={{ padding: isMobile ? '5px 8px' : '5px 16px', borderBottom: '1px solid #1e1e1e', display: 'flex', gap: isMobile ? 4 : 8, alignItems: 'center', background: '#0e0e0e', flexShrink: 0, flexWrap: 'wrap' }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 280px', flex: 1, overflow: 'hidden' }}>
        <div style={{ overflowY: 'auto', overflowX: 'auto', padding: isMobile ? '10px 8px' : '14px 18px' }}>
          {areas.map(area => (
            <CortAreaBlock key={area.id} area={area} items={items} config={config}
              onToggle={() => toggleArea(area.id)}
              onUpdate={updateItem} onRemove={removeItem}
              onAddCortina={() => addItem(area.id, 'CORTINA')}
              onAddPersiana={() => addItem(area.id, 'PERSIANA')}
              onAddExtra={() => addItem(area.id, 'EXTRA')}
              onRemoveArea={() => removeArea(area.id)}
              onShowSomfy={setSomfyDetail}
              onCopy={setCopyingItem}
              showInt={showInt} />
          ))}
          <div onClick={() => setShowAreaPicker(true)} style={{ padding: '12px', border: '1px dashed #333', borderRadius: 10, textAlign: 'center', cursor: 'pointer', color: '#444', fontSize: 12 }}>+ Agregar area</div>
        </div>
        <div style={{ borderLeft: '1px solid #222', overflowY: 'auto', padding: '14px 10px', background: '#0e0e0e' }}>
          <CortSummary items={items} areas={areas} config={config} showInt={showInt} onConfigChange={updateConfig} />
        </div>
      </div>

      {/* Somfy detail modal */}
      {somfyDetail && <SomfyDetailModal item={somfyDetail} onClose={() => setSomfyDetail(null)} />}

      {/* PDF proposal modal */}
      {showPdf && <CortPdfModal items={items} areas={areas} config={config} cotName={cotName} clientName={clientName} projectName={projectName} onClose={() => setShowPdf(false)} />}
      {showAIImport && <AIImportModalCortinas cotId={cotId} areas={areas} config={config} onClose={() => setShowAIImport(false)} onImported={() => { setShowAIImport(false); load() }} />}

      {/* Area picker modal */}
      {showAreaPicker && <AreaPickerModal existingNames={areas.map(a => a.name)} onSelect={name => { addAreaByName(name); setShowAreaPicker(false) }} onClose={() => setShowAreaPicker(false)} />}

      {/* Copy to area modal */}
      {copyingItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1030, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 340 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Copiar cortina a:</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {areas.filter(a => a.id !== copyingItem.areaId).map(a => (
                <button key={a.id} onClick={async () => {
                  const order = items.filter(i => i.areaId === a.id).length
                  const newItem = { ...copyingItem, id: uid(), areaId: a.id, order }
                  const { data, error } = await supabase.from('quotation_items').insert({
                    quotation_id: cotId, area_id: a.id,
                    name: '', system: 'Cortinas', type: 'material',
                    quantity: newItem.cantidad, cost: 0, price: 0, total: calcItemTotal(newItem), markup: 0,
                    installation_cost: 0, order_index: order,
                    notes: itemToDbNotes(newItem),
                  }).select().single()
                  if (data) {
                    setItems(prev => [...prev, { ...newItem, id: data.id }])
                  }
                  setCopyingItem(null)
                }} style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  border: '1px solid #333', background: '#1a1a1a', color: '#ccc', textAlign: 'left',
                }}>{a.name}</button>
              ))}
            </div>
            <button onClick={() => setCopyingItem(null)} style={{ marginTop: 12, padding: '6px 12px', background: 'none', border: '1px solid #333', borderRadius: 8, color: '#666', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>Cancelar</button>
          </div>
        </div>
      )}
      {showEditInfo && (
        <EditCotInfoModal
          cotId={cotId}
          name={cotName}
          clientName={clientName}
          projectId={projectId}
          onClose={() => setShowEditInfo(false)}
          onSaved={(name, client, projId, projName) => {
            setCotName(name)
            setClientName(client)
            setProjectId(projId)
            setProjectName(projName)
            setShowEditInfo(false)
          }}
        />
      )}
    </div>
  )
}
