/**
 * OMM Technologies — Client-side Sembrado PDF Generator
 * Overlays device symbols on the original architectural floor plan,
 * matching OMM's professional engineering plan style.
 */
import jsPDF from 'jspdf'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DevicePosition {
  x: number   // 0-100 percentage
  y: number   // 0-100 percentage
  label: string
  height: string
}

export interface SembradoDevice {
  nomenclature: string
  name: string
  brand: string
  model: string
  area: string
  quantity: number
  install_height: string
  requirements: string
  symbol_type: string
  positions?: DevicePosition[]
}

export interface ConduitEntry {
  id: string
  cable: string
  additional: string
  conduit: string
}

export interface SembradoSystem {
  devices: SembradoDevice[]
  conduit_schedule: ConduitEntry[]
}

export interface SembradoProject {
  name: string
  prefix: string
  location: string
  date: string
  drawn_by: string
  reviewed_by: string
  coordinated_by?: string
  scale: string
}

export interface SembradoData {
  project: SembradoProject
  systems: Record<string, SembradoSystem>
  planImageBase64?: string      // base64 data (without data:... prefix)
  planImageType?: string        // 'image/png' | 'image/jpeg' | 'application/pdf'
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const GREEN: [number, number, number] = [87, 255, 154]
const DARK_GREEN: [number, number, number] = [46, 204, 113]
const BLACK: [number, number, number] = [26, 26, 26]
const GRAY: [number, number, number] = [102, 102, 102]
const LINE_COLOR: [number, number, number] = [51, 51, 51]
const WHITE: [number, number, number] = [255, 255, 255]

// System-specific colors for conduit lines
const SYS_COLORS: Record<string, [number, number, number]> = {
  'Audio': [87, 255, 154],       // green
  'CCTV': [239, 68, 68],         // red
  'Control de Acceso': [239, 68, 68],
  'Acceso': [239, 68, 68],
  'Control de Iluminación': [192, 132, 252], // purple
  'Iluminacion': [192, 132, 252],
  'Detección de Humo': [251, 191, 36],  // amber
  'Humo': [251, 191, 36],
  'Red': [59, 130, 246],         // blue
  'Redes': [59, 130, 246],
  'Persianas': [103, 232, 249],  // cyan
  'Cortinas': [103, 232, 249],
}

// ─── Symbol Drawing ─────────────────────────────────────────────────────────

function drawSymbol(doc: jsPDF, type: string, x: number, y: number, sz: number = 4, sysColor?: [number, number, number]) {
  const r = sz / 2
  const color = sysColor || BLACK
  doc.setLineWidth(0.3)
  doc.setDrawColor(...color)

  const circleWithText = (text: string) => {
    doc.setFillColor(...WHITE)
    doc.circle(x, y, r, 'FD')
    doc.setFontSize(Math.max(4, sz * 1.1))
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...color)
    doc.text(text, x, y + sz * 0.15, { align: 'center' })
  }

  const rectWithText = (text: string, wm = 1.2, hm = 0.7) => {
    const w = sz * wm, h = sz * hm
    doc.setFillColor(...WHITE)
    doc.rect(x - w / 2, y - h / 2, w, h, 'FD')
    doc.setFontSize(Math.max(3.5, sz * 1.0))
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...color)
    doc.text(text, x, y + sz * 0.12, { align: 'center' })
  }

  switch (type) {
    case 'speaker_ceiling': {
      doc.setFillColor(...WHITE)
      doc.circle(x, y, r, 'FD')
      doc.setFillColor(...color)
      doc.circle(x, y, r * 0.25, 'F')
      doc.setLineWidth(0.15)
      for (const angle of [0.5, 2.1, 3.7, 5.3]) {
        const dx = Math.cos(angle) * r * 0.6, dy = Math.sin(angle) * r * 0.6
        const dx2 = Math.cos(angle) * r * 0.85, dy2 = Math.sin(angle) * r * 0.85
        doc.setDrawColor(...color)
        doc.line(x + dx, y + dy, x + dx2, y + dy2)
      }
      break
    }
    case 'speaker_wall': rectWithText('♪'); break
    case 'subwoofer': circleWithText('SW'); break
    case 'amplifier': rectWithText('AMP', 1.5, 0.7); break
    case 'camera_wifi': {
      doc.setFillColor(...WHITE)
      doc.circle(x, y, r, 'FD')
      doc.setFillColor(...color)
      doc.circle(x, y, r * 0.25, 'F')
      doc.setLineWidth(0.15)
      doc.setDrawColor(...color)
      doc.line(x + r * 0.3, y - r * 0.3, x + r * 0.55, y - r * 0.5)
      break
    }
    case 'camera_bullet': circleWithText('CB'); break
    case 'biometric_reader': {
      const w = sz * 0.8, h = sz * 1.0
      doc.setFillColor(...WHITE)
      doc.rect(x - w / 2, y - h / 2, w, h, 'FD')
      doc.setLineWidth(0.15)
      doc.setDrawColor(...color)
      doc.line(x - sz * 0.12, y - sz * 0.05, x, y + sz * 0.1)
      doc.line(x, y + sz * 0.1, x + sz * 0.12, y - sz * 0.05)
      break
    }
    case 'magnetic_lock': rectWithText('MAG', 1.3, 0.7); break
    case 'release_button': circleWithText('B'); break
    case 'keypad': {
      const w = sz * 0.9, h = sz * 1.1
      doc.setFillColor(...WHITE)
      doc.rect(x - w / 2, y - h / 2, w, h, 'FD')
      doc.setLineWidth(0.12)
      doc.setDrawColor(...color)
      for (let i = 1; i <= 3; i++) {
        const ly = y - h / 2 + (h * i / 4)
        doc.line(x - w * 0.3, ly, x + w * 0.3, ly)
      }
      break
    }
    case 'keypad_wireless': {
      const w = sz * 0.9, h = sz * 1.1
      doc.setFillColor(...WHITE)
      doc.rect(x - w / 2, y - h / 2, w, h, 'FD')
      doc.setLineWidth(0.12)
      doc.setDrawColor(...color)
      for (let i = 1; i <= 3; i++) {
        const ly = y - h / 2 + (h * i / 4)
        doc.line(x - w * 0.3, ly, x + w * 0.3, ly)
      }
      doc.line(x - sz * 0.08, y - h / 2 - sz * 0.08, x, y - h / 2 - sz * 0.2)
      doc.line(x, y - h / 2 - sz * 0.2, x + sz * 0.08, y - h / 2 - sz * 0.08)
      break
    }
    case 'smoke_detector': circleWithText('DH'); break
    case 'gas_detector': circleWithText('DG'); break
    case 'temperature_detector': circleWithText('DT'); break
    case 'manual_station': rectWithText('EM', 1.0, 0.9); break
    case 'horn_strobe': circleWithText('BS'); break
    case 'fire_panel': rectWithText('PANEL', 1.8, 0.8); break
    case 'network_node': {
      doc.setFillColor(...WHITE)
      doc.circle(x, y, r, 'FD')
      doc.setLineWidth(0.18)
      doc.setDrawColor(...color)
      doc.line(x - r * 0.4, y, x + r * 0.4, y)
      doc.line(x, y - r * 0.4, x, y + r * 0.4)
      break
    }
    case 'phone': rectWithText('TEL', 1.1, 0.8); break
    case 'access_panel': rectWithText('TAC', 1.3, 0.8); break
    case 'blind_node': {
      const w = sz * 1.0, h = sz * 0.7
      doc.setFillColor(...WHITE)
      doc.rect(x - w / 2, y - h / 2, w, h, 'FD')
      doc.setLineWidth(0.12)
      doc.setDrawColor(...color)
      for (let i = -2; i <= 2; i++) {
        const lx = x + i * sz * 0.12
        doc.line(lx, y - h * 0.3, lx, y + h * 0.3)
      }
      break
    }
    case 'projector': rectWithText('PROY', 1.4, 0.8); break
    case 'projection_screen': {
      doc.setLineWidth(0.3)
      doc.setDrawColor(...color)
      const w = sz * 1.6
      doc.line(x - w / 2, y, x + w / 2, y)
      doc.line(x - w / 2, y - sz * 0.2, x - w / 2, y + sz * 0.2)
      doc.line(x + w / 2, y - sz * 0.2, x + w / 2, y + sz * 0.2)
      break
    }
    case 'rack': {
      const w = sz * 1.0, h = sz * 0.7
      doc.setFillColor(68, 68, 68)
      doc.rect(x - w / 2, y - h / 2, w, h, 'FD')
      doc.setTextColor(...WHITE)
      doc.setFontSize(Math.max(3, sz * 0.8))
      doc.setFont('helvetica', 'bold')
      doc.text('RACK', x, y + sz * 0.1, { align: 'center' })
      doc.setTextColor(...BLACK)
      return // skip the color reset below since we handle it
    }
    case 'control_module': rectWithText('MOD', 1.3, 0.8); break
    default: circleWithText('?'); break
  }
  doc.setTextColor(...BLACK) // reset
}

// ─── Standard OMM Notes ─────────────────────────────────────────────────────

const NOTAS_OMM = [
  '1. TODAS LAS DIMENSIONES ARQUITECTÓNICAS, ALTURAS Y COTAS',
  '   SERÁN VERIFICADAS EN CAMPO ANTES DE LA INSTALACIÓN.',
  '2. CANALIZACIONES Y TUBERÍA:',
  '   2.1 TODAS LAS CANALIZACIONES SERÁN EMPOTRADAS EN MURO.',
  '   2.2 LAS TUBERÍAS SERÁN DE CONDUIT PVC PARED DELGADA,',
  '       REFORZADO EN PUNTOS DONDE SE REQUIERA.',
  '   2.3 LAS EXPUESTAS SERÁN GALVANIZADO O PVC PESADO.',
  '3. CONEXIONES:',
  '   3.1 REGISTROS DE LÁMINA GALV. O PLÁSTICO.',
  '4. CABLEADO:',
  '   4.1 CONDUCTORES DE COBRE THW-LS / TF.',
]

const SYS_CODE: Record<string, string> = {
  'Audio': 'AUD', 'CCTV': 'CCTV', 'Control de Acceso': 'ACC', 'Acceso': 'ACC',
  'Control de Iluminación': 'CTRL', 'Iluminacion': 'CTRL',
  'Detección de Humo': 'DH', 'Humo': 'DH',
  'Red': 'RED', 'Redes': 'RED',
  'Persianas': 'PRS', 'Cortinas': 'PRS',
  'BMS': 'BMS', 'Telefonía': 'TEL',
}

// ─── Main Generator ─────────────────────────────────────────────────────────

export function generateSembradoPdf(data: SembradoData): jsPDF {
  const hasPlan = !!data.planImageBase64
  // Use tabloid landscape for plan overlay (better resolution), letter for no-plan
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
  const pw = 279.4, ph = 215.9
  const margin = 6
  const rpW = 72        // right panel width
  const rpX = pw - margin - rpW
  // Plan area = left content area
  const planX = margin
  const planY = margin
  const planW = rpX - margin - 2
  const planH = ph - 2 * margin

  const systemEntries = Object.entries(data.systems)

  systemEntries.forEach(([sysName, sysData], idx) => {
    if (idx > 0) doc.addPage()

    const sysColor = SYS_COLORS[sysName] || BLACK

    // ── Page border ──
    doc.setDrawColor(...LINE_COLOR)
    doc.setLineWidth(0.4)
    doc.rect(margin, margin, pw - 2 * margin, ph - 2 * margin)

    // ── Vertical divider ──
    doc.setLineWidth(0.3)
    doc.line(rpX, margin, rpX, ph - margin)

    // ══════ LEFT SIDE: PLAN + SYMBOLS ══════
    if (hasPlan && data.planImageBase64) {
      try {
        // Determine image format
        let imgType: 'JPEG' | 'PNG' = 'JPEG'
        if (data.planImageType?.includes('png')) imgType = 'PNG'

        // Add plan image as background filling the left area
        doc.addImage(
          `data:${data.planImageType || 'image/jpeg'};base64,${data.planImageBase64}`,
          imgType,
          planX, planY, planW, planH
        )
      } catch (e) {
        console.warn('Failed to add plan image:', e)
        // Fallback: show placeholder
        doc.setFontSize(10)
        doc.setTextColor(...GRAY)
        doc.text('(Error cargando plano)', planX + planW / 2, planY + planH / 2, { align: 'center' })
      }

      // ── Overlay device symbols at their positions ──
      const symbolSize = 3.5 // mm
      doc.setDrawColor(...sysColor)

      for (const dev of sysData.devices) {
        if (!dev.positions || dev.positions.length === 0) continue

        for (const pos of dev.positions) {
          // Convert percentage to absolute position within plan area
          const absX = planX + (pos.x / 100) * planW
          const absY = planY + (pos.y / 100) * planH

          // Draw symbol
          drawSymbol(doc, dev.symbol_type || 'network_node', absX, absY, symbolSize, sysColor)

          // Draw label (nomenclature) near symbol
          doc.setFontSize(3.5)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(...sysColor)

          // White background behind label for readability
          const labelText = pos.label || dev.nomenclature
          const labelWidth = doc.getTextWidth(labelText)
          doc.setFillColor(255, 255, 255)
          doc.rect(absX - labelWidth / 2 - 0.5, absY + symbolSize / 2 + 0.5, labelWidth + 1, 3, 'F')

          doc.text(labelText, absX, absY + symbolSize / 2 + 2.8, { align: 'center' })

          // Height info below label
          if (pos.height) {
            doc.setFontSize(2.8)
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...GRAY)
            const hText = `H: ${pos.height}`
            const hWidth = doc.getTextWidth(hText)
            doc.setFillColor(255, 255, 255)
            doc.rect(absX - hWidth / 2 - 0.3, absY + symbolSize / 2 + 3.5, hWidth + 0.6, 2.5, 'F')
            doc.text(hText, absX, absY + symbolSize / 2 + 5.3, { align: 'center' })
          }
        }
      }
    } else {
      // ── No plan: show device schedule table ──
      drawDeviceTable(doc, sysName, sysData, planX + 2, planY + 2, planW - 4, planH - 14)
    }

    // ── Bottom title bar (on the plan side) ──
    const barY = ph - margin - 8
    const barH = 8
    doc.setFillColor(240, 240, 240)
    doc.rect(margin, barY, rpX - margin, barH, 'F')

    doc.setDrawColor(...LINE_COLOR)
    doc.setLineWidth(0.25)
    doc.line(margin, barY, rpX, barY)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5)
    doc.setTextColor(...BLACK)
    doc.text('INSTALACIONES ESPECIALES', margin + 3, barY + 3)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(sysName.toUpperCase(), margin + 3, barY + 6.5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.5)
    doc.text(`ESC. ${data.project.scale}`, margin + 65, barY + 5)

    const sysCode = SYS_CODE[sysName] || sysName.substring(0, 4).toUpperCase()
    const docKey = `${data.project.prefix}-IESP-${sysCode}_01`
    doc.setFontSize(4.5)
    doc.text('CONTENIDO:', rpX - 48, barY + 3)
    doc.text(`Proyección de ${sysName}`, rpX - 33, barY + 3)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5)
    doc.text('CLAVE:', rpX - 48, barY + 6.5)
    doc.setTextColor(...GREEN)
    doc.setFontSize(6)
    doc.text(docKey, rpX - 38, barY + 6.5)

    // ══════ RIGHT PANEL ══════
    drawRightPanel(doc, data, sysName, sysData, rpX, rpW, margin, ph)
  })

  return doc
}

// ─── Right Panel Drawing ────────────────────────────────────────────────────

function drawRightPanel(
  doc: jsPDF, data: SembradoData,
  sysName: string, sysData: SembradoSystem,
  rpX: number, rpW: number, margin: number, ph: number
) {
  let ry = margin

  // ── Header ──
  doc.setFillColor(...GREEN)
  doc.rect(rpX, ry, rpW, 0.8, 'F')
  ry += 3.5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...GREEN)
  doc.text('OMNIIOUS', rpX + rpW - 2, ry, { align: 'right' })
  ry += 2.5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(4)
  doc.setTextColor(...GRAY)
  doc.text('Bosques de Durango No. 69, PB Int. 4', rpX + rpW - 2, ry, { align: 'right' })
  ry += 1.8
  doc.text('Bosques de Reforma, CDMX, C.P. 11700', rpX + rpW - 2, ry, { align: 'right' })
  ry += 2.5

  doc.setDrawColor(...LINE_COLOR)
  doc.setLineWidth(0.2)
  doc.line(rpX, ry, rpX + rpW, ry)
  ry += 2.5

  // ── Project info ──
  const rows: [string, string][] = [
    ['PROYECTO:', data.project.name],
    ['UBICACIÓN:', data.project.location],
    ['DIBUJO:', data.project.drawn_by],
    ['REVISÓ:', data.project.reviewed_by],
    ['COORDINÓ:', data.project.coordinated_by || data.project.reviewed_by],
    ['FECHA:', data.project.date],
    ['ESCALA:', data.project.scale],
  ]

  const infoY = ry
  doc.setTextColor(...BLACK)
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5)
    doc.text(label, rpX + 2, ry)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5)
    doc.text(String(value).substring(0, 30), rpX + 22, ry)
    ry += 3.8
  }
  doc.setDrawColor(...LINE_COLOR)
  doc.setLineWidth(0.2)
  doc.rect(rpX + 1, infoY - 2, rpW - 2, ry - infoY + 1)
  ry += 1.5
  doc.line(rpX, ry, rpX + rpW, ry)
  ry += 3

  // ── Symbology ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...BLACK)
  doc.text('SIMBOLOGÍA:', rpX + 2, ry)
  ry += 4

  const seen = new Map<string, string>()
  for (const dev of sysData.devices) {
    const st = dev.symbol_type || 'network_node'
    if (!seen.has(st)) seen.set(st, dev.name)
  }

  const sysColor = SYS_COLORS[sysName] || BLACK
  for (const [symType, name] of seen) {
    if (ry > ph - 60) break
    drawSymbol(doc, symType, rpX + 6, ry, 3, sysColor)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5)
    doc.setTextColor(...BLACK)
    doc.text(name.substring(0, 26).toUpperCase(), rpX + 12, ry + 0.5)
    ry += 5.5
  }

  ry += 2
  doc.setDrawColor(...LINE_COLOR)
  doc.line(rpX, ry, rpX + rpW, ry)
  ry += 3

  // ── Cédula de Tubería ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...BLACK)
  doc.text('CÉDULA DE TUBERÍA', rpX + 2, ry)
  ry += 3.5

  const schedules = sysData.conduit_schedule || []
  if (schedules.length > 0) {
    const cx = [rpX + 2, rpX + 12, rpX + 34, rpX + 48]
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(4.5)
    doc.text('CÉDULA', cx[0], ry)
    doc.text('CABLE', cx[1], ry)
    doc.text('ADIC.', cx[2], ry)
    doc.text('CONDUIT', cx[3], ry)
    ry += 1.5
    doc.setLineWidth(0.15)
    doc.line(rpX + 1, ry, rpX + rpW - 1, ry)
    ry += 2.5

    for (const sched of schedules.slice(0, 10)) {
      doc.setFillColor(...WHITE)
      doc.setDrawColor(...BLACK)
      doc.circle(cx[0] + 2.5, ry - 0.3, 1.8, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(4)
      doc.setTextColor(...BLACK)
      doc.text(String(sched.id), cx[0] + 2.5, ry, { align: 'center' })

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(4.5)
      doc.text(String(sched.cable).substring(0, 14), cx[1], ry)
      doc.text(String(sched.additional || '---').substring(0, 8), cx[2], ry)
      doc.text(String(sched.conduit).substring(0, 15), cx[3], ry)
      ry += 3.5
    }

    ry += 1.5
    doc.setLineWidth(0.2)
    doc.setDrawColor(...BLACK)
    doc.line(rpX + 2, ry, rpX + 16, ry)
    doc.setFontSize(4)
    doc.text('TUBERÍA POR PLAFÓN', rpX + 18, ry + 0.5)
    ry += 3
    doc.setLineDashPattern([1, 1], 0)
    doc.line(rpX + 2, ry, rpX + 16, ry)
    doc.setLineDashPattern([], 0)
    doc.text('TUBERÍA POR PISO', rpX + 18, ry + 0.5)
    ry += 2
  }

  ry += 2
  doc.setDrawColor(...LINE_COLOR)
  doc.setLineWidth(0.15)
  doc.line(rpX, ry, rpX + rpW, ry)
  ry += 2.5

  // ── Notes ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(5.5)
  doc.setTextColor(...BLACK)
  doc.text('NOTAS:', rpX + 2, ry)
  ry += 2.5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(3.5)
  doc.setTextColor(...GRAY)
  for (const line of NOTAS_OMM) {
    if (ry > ph - margin - 3) break
    doc.text(line.substring(0, 55), rpX + 2, ry)
    ry += 2.2
  }
}

// ─── Device Table (no-plan fallback) ────────────────────────────────────────

function drawDeviceTable(
  doc: jsPDF, sysName: string, sysData: SembradoSystem,
  x0: number, y0: number, w: number, maxH: number
) {
  let y = y0

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...GREEN)
  doc.text(`INSTALACIONES ESPECIALES — ${sysName.toUpperCase()}`, x0, y)
  y += 2
  doc.setDrawColor(...GREEN)
  doc.setLineWidth(0.5)
  doc.line(x0, y, x0 + w, y)
  y += 5

  const areaMap = new Map<string, SembradoDevice[]>()
  for (const dev of sysData.devices) {
    const area = dev.area || 'General'
    if (!areaMap.has(area)) areaMap.set(area, [])
    areaMap.get(area)!.push(dev)
  }

  const cols = [x0, x0 + 7, x0 + 25, x0 + 55, x0 + 78, x0 + 98, x0 + 110, x0 + 130, x0 + 148]
  const colLabels = ['SÍM.', 'NOMENCLATURA', 'DESCRIPCIÓN', 'MARCA', 'MODELO', 'CANT.', 'UBICACIÓN', 'ALTURA']
  const bottom = y0 + maxH

  for (const [areaName, areaDevs] of areaMap) {
    if (y > bottom - 10) break

    doc.setFillColor(232, 255, 240)
    doc.rect(x0 - 1, y - 2.5, w + 2, 5.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...(DARK_GREEN))
    doc.text(areaName.toUpperCase(), x0, y)
    y += 5.5

    doc.setFillColor(245, 245, 245)
    doc.rect(x0 - 1, y - 2.5, w + 2, 4.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(4.2)
    doc.setTextColor(...BLACK)
    colLabels.forEach((l, i) => doc.text(l, cols[i], y))
    y += 1.5
    doc.setDrawColor(...LINE_COLOR)
    doc.setLineWidth(0.12)
    doc.line(x0, y, x0 + w, y)
    y += 3.5

    for (const dev of areaDevs) {
      if (y > bottom) break
      drawSymbol(doc, dev.symbol_type || 'network_node', cols[0] + 2.5, y - 0.5, 2.8)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(4.5)
      doc.setTextColor(...BLACK)
      doc.text(dev.nomenclature.substring(0, 14), cols[1], y)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5)
      doc.text(dev.name.substring(0, 22), cols[2], y)
      doc.text(dev.brand.substring(0, 12), cols[3], y)
      doc.text(dev.model.substring(0, 14), cols[4], y)
      doc.text(String(dev.quantity), cols[5], y)
      doc.text(dev.area.substring(0, 10), cols[6], y)
      doc.setFontSize(4.5)
      doc.text(dev.install_height ? `H: ${dev.install_height}` : '', cols[7], y)

      if (dev.requirements) {
        y += 2.5
        doc.setFontSize(3.8)
        doc.setTextColor(...GRAY)
        doc.text(`REQ: ${dev.requirements.substring(0, 42)}`, cols[2], y)
        doc.setTextColor(...BLACK)
      }
      y += 4
      doc.setDrawColor(224, 224, 224)
      doc.setLineWidth(0.08)
      doc.line(x0, y - 1, x0 + w, y - 1)
    }
    y += 3
  }

  const total = sysData.devices.reduce((s, d) => s + (d.quantity || 1), 0)
  if (y < bottom) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(...(DARK_GREEN))
    doc.text(`TOTAL DISPOSITIVOS: ${total}`, x0, y)
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function downloadSembradoPdf(data: SembradoData, filename?: string): void {
  const doc = generateSembradoPdf(data)
  doc.save(filename || `Sembrado_${data.project.name}.pdf`)
}
