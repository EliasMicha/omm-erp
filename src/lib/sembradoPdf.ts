/**
 * OMM Technologies — Client-side Sembrado PDF Generator
 * Uses jsPDF to create professional installation layout documents
 * matching OMM's engineering plan style.
 */
import jsPDF from 'jspdf'

// ─── Types ──────────────────────────────────────────────────────────────────

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
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const GREEN = [87, 255, 154] as const
const BLACK = [26, 26, 26] as const
const GRAY = [102, 102, 102] as const
const LIGHT_GRAY = [204, 204, 204] as const
const LINE_COLOR = [51, 51, 51] as const
const WHITE = [255, 255, 255] as const

// ─── Symbol Drawing ─────────────────────────────────────────────────────────

function drawSymbol(doc: jsPDF, type: string, x: number, y: number, sz: number = 4) {
  const r = sz / 2
  doc.setLineWidth(0.25)
  doc.setDrawColor(...BLACK)

  const circleWithText = (text: string) => {
    doc.setFillColor(...WHITE)
    doc.circle(x, y, r, 'FD')
    doc.setFontSize(sz * 1.4)
    doc.setFont('helvetica', 'bold')
    doc.text(text, x, y + sz * 0.15, { align: 'center' })
  }

  const rectWithText = (text: string, wm = 1.2, hm = 0.7) => {
    const w = sz * wm, h = sz * hm
    doc.setFillColor(...WHITE)
    doc.rect(x - w / 2, y - h / 2, w, h, 'FD')
    doc.setFontSize(sz * 1.2)
    doc.setFont('helvetica', 'bold')
    doc.text(text, x, y + sz * 0.12, { align: 'center' })
  }

  switch (type) {
    case 'speaker_ceiling': {
      doc.setFillColor(...WHITE)
      doc.circle(x, y, r, 'FD')
      doc.setFillColor(...BLACK)
      doc.circle(x, y, r * 0.3, 'F')
      // Small arcs
      doc.setLineWidth(0.15)
      for (const angle of [0.5, 2.1, 3.7, 5.3]) {
        const dx = Math.cos(angle) * r * 0.65
        const dy = Math.sin(angle) * r * 0.65
        const dx2 = Math.cos(angle) * r * 0.9
        const dy2 = Math.sin(angle) * r * 0.9
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
      doc.setFillColor(...BLACK)
      doc.circle(x, y, r * 0.25, 'F')
      // Wifi hint
      doc.setLineWidth(0.12)
      const ax = x + r * 0.3, ay = y - r * 0.3
      doc.line(ax, ay, ax + r * 0.3, ay - r * 0.2)
      break
    }
    case 'camera_bullet': circleWithText('CB'); break
    case 'biometric_reader': {
      const w = sz * 0.8, h = sz * 1.0
      doc.setFillColor(...WHITE)
      doc.rect(x - w / 2, y - h / 2, w, h, 'FD')
      doc.setLineWidth(0.12)
      // Fingerprint arcs
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
      doc.setLineWidth(0.1)
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
      doc.setLineWidth(0.1)
      for (let i = 1; i <= 3; i++) {
        const ly = y - h / 2 + (h * i / 4)
        doc.line(x - w * 0.3, ly, x + w * 0.3, ly)
      }
      // WiFi arc hint
      doc.line(x - sz * 0.1, y - h / 2 - sz * 0.1, x, y - h / 2 - sz * 0.25)
      doc.line(x, y - h / 2 - sz * 0.25, x + sz * 0.1, y - h / 2 - sz * 0.1)
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
      doc.setLineWidth(0.15)
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
      doc.setLineWidth(0.1)
      for (let i = -2; i <= 2; i++) {
        const lx = x + i * sz * 0.12
        doc.line(lx, y - h * 0.3, lx, y + h * 0.3)
      }
      break
    }
    case 'projector': rectWithText('PROY', 1.4, 0.8); break
    case 'projection_screen': {
      doc.setLineWidth(0.25)
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
      doc.setFontSize(sz * 0.9)
      doc.setFont('helvetica', 'bold')
      doc.text('RACK', x, y + sz * 0.1, { align: 'center' })
      doc.setTextColor(...BLACK)
      break
    }
    case 'control_module': rectWithText('MOD', 1.3, 0.8); break
    default: circleWithText('?'); break
  }
}

// ─── Standard OMM Notes ─────────────────────────────────────────────────────

const NOTAS_OMM = [
  '1. TODAS LAS DIMENSIONES ARQUITECTÓNICAS, ALTURAS Y COTAS SERÁN',
  '   VERIFICADAS EN CAMPO ANTES DE LA INSTALACIÓN.',
  '2. CANALIZACIONES Y TUBERÍA:',
  '   2.1 TODAS LAS CANALIZACIONES Y TUBERÍA SERÁN EMPOTRADAS EN MURO.',
  '   2.2 LAS CANALIZACIONES Y TUBERÍAS DE LA INSTALACIÓN SERÁN DE CONDUIT',
  '       PVC DELGADO PARED DELGADA, REFORZADO EN PUNTOS DONDE SE REQUIERA.',
  '   2.3 LAS CANALIZACIONES Y TUBERÍAS QUE SERÁN EXPUESTAS DEBERÁN SER',
  '       MATERIAL GALVANIZADO O CONDUIT PVC TIPO PESADO.',
  '3. CONEXIONES:',
  '   3.1 TODOS LOS REGISTROS DE LA INSTALACIÓN INTERIOR SERÁN DE LÁMINA',
  '       GALVANIZADA O PLÁSTICO DE ACUERDO AL ESPACIO Y CANTIDAD DE CABLES.',
  '4. CABLEADO:',
  '   4.1 TODOS LOS CONDUCTORES ELÉCTRICOS UTILIZADOS SERÁN CABLE DE COBRE',
  '       CON AISLAMIENTO PVC THW-LS / TF, MARCA CONDUMEX, IUSA O SIMILAR.',
]

// ─── System code map ────────────────────────────────────────────────────────

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
  // Landscape letter: 279.4 x 215.9 mm
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
  const pw = 279.4, ph = 215.9
  const margin = 8
  const rpW = 78  // right panel width
  const rpX = pw - margin - rpW
  const contentW = rpX - margin - 4

  const systemEntries = Object.entries(data.systems)

  systemEntries.forEach(([sysName, sysData], idx) => {
    if (idx > 0) doc.addPage()

    // ── Page border ──
    doc.setDrawColor(...LINE_COLOR)
    doc.setLineWidth(0.4)
    doc.rect(margin, margin, pw - 2 * margin, ph - 2 * margin)

    // Vertical divider
    doc.setLineWidth(0.25)
    doc.line(rpX, margin, rpX, ph - margin)

    let ry = margin  // right panel y cursor

    // ══════ RIGHT PANEL: HEADER ══════
    // Green accent bar
    doc.setFillColor(...GREEN)
    doc.rect(rpX, ry, rpW, 1, 'F')
    ry += 4

    // OMNIIOUS
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...GREEN)
    doc.text('OMNIIOUS', rpX + rpW - 2, ry, { align: 'right' })
    ry += 3

    // Address
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(4.5)
    doc.setTextColor(...GRAY)
    doc.text('Bosques de Durango No. 69, Planta Baja, Interior 4', rpX + rpW - 2, ry, { align: 'right' })
    ry += 2
    doc.text('Bosques de Reforma, Miguel Hidalgo, CDMX, C.P. 11700', rpX + rpW - 2, ry, { align: 'right' })
    ry += 3

    // Divider
    doc.setDrawColor(...LINE_COLOR)
    doc.setLineWidth(0.2)
    doc.line(rpX, ry, rpX + rpW, ry)
    ry += 3

    // ══════ RIGHT PANEL: PROJECT INFO ══════
    const infoRows: [string, string][] = [
      ['PROYECTO:', data.project.name],
      ['UBICACIÓN:', data.project.location],
      ['DIBUJO / PROYECTÓ:', data.project.drawn_by],
      ['REVISÓ:', data.project.reviewed_by],
      ['COORDINÓ:', data.project.coordinated_by || data.project.reviewed_by],
      ['FECHA:', data.project.date],
      ['ESCALA:', data.project.scale],
    ]

    const infoStartY = ry
    doc.setTextColor(...BLACK)
    for (const [label, value] of infoRows) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(5.5)
      doc.text(label, rpX + 3, ry)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5.5)
      doc.text(String(value).substring(0, 35), rpX + 28, ry)
      ry += 4.2
    }

    // Info box
    doc.setDrawColor(...LINE_COLOR)
    doc.setLineWidth(0.2)
    doc.rect(rpX + 1.5, infoStartY - 2.5, rpW - 3, ry - infoStartY + 1.5)
    ry += 2

    // Divider
    doc.line(rpX, ry, rpX + rpW, ry)
    ry += 4

    // ══════ RIGHT PANEL: SYMBOLOGY ══════
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...BLACK)
    doc.text('SIMBOLOGÍA:', rpX + 3, ry)
    ry += 5

    // Unique symbols
    const seen = new Map<string, string>()
    for (const dev of sysData.devices) {
      const st = dev.symbol_type || 'network_node'
      if (!seen.has(st)) seen.set(st, dev.name)
    }

    doc.setTextColor(...BLACK)
    for (const [symType, name] of seen) {
      if (ry > ph - 70) break
      drawSymbol(doc, symType, rpX + 7, ry, 3.5)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(5.5)
      doc.setTextColor(...BLACK)
      doc.text(name.substring(0, 28).toUpperCase(), rpX + 14, ry + 0.5)
      ry += 6.5
    }

    ry += 2
    doc.setDrawColor(...LINE_COLOR)
    doc.line(rpX, ry, rpX + rpW, ry)
    ry += 4

    // ══════ RIGHT PANEL: CÉDULA DE TUBERÍA ══════
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...BLACK)
    doc.text('CÉDULA DE TUBERÍA', rpX + 3, ry)
    ry += 4

    const schedules = sysData.conduit_schedule || []
    if (schedules.length > 0) {
      // Headers
      const cx = [rpX + 3, rpX + 15, rpX + 38, rpX + 55]
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(5)
      doc.text('CÉDULA', cx[0], ry)
      doc.text('CABLE DUPLEX', cx[1], ry)
      doc.text('ADICIONAL', cx[2], ry)
      doc.text('CONDUIT', cx[3], ry)
      ry += 1.5
      doc.setLineWidth(0.2)
      doc.line(rpX + 2, ry, rpX + rpW - 2, ry)
      ry += 3

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5)
      for (const sched of schedules.slice(0, 10)) {
        // Circle with ID
        doc.setFillColor(...WHITE)
        doc.setDrawColor(...BLACK)
        doc.circle(cx[0] + 3, ry - 0.5, 2, 'FD')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(4.5)
        doc.text(String(sched.id), cx[0] + 3, ry, { align: 'center' })

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(5)
        doc.text(String(sched.cable).substring(0, 14), cx[1], ry)
        doc.text(String(sched.additional || '---').substring(0, 10), cx[2], ry)
        doc.text(String(sched.conduit).substring(0, 16), cx[3], ry)
        ry += 4
      }

      // Line types
      ry += 2
      doc.setLineWidth(0.25)
      doc.setDrawColor(...BLACK)
      doc.line(rpX + 3, ry, rpX + 18, ry)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(4.5)
      doc.text('TUBERÍA POR PLAFÓN', rpX + 20, ry + 0.5)
      ry += 3.5
      doc.setLineDashPattern([1, 1], 0)
      doc.line(rpX + 3, ry, rpX + 18, ry)
      doc.setLineDashPattern([], 0)
      doc.text('TUBERÍA POR PISO', rpX + 20, ry + 0.5)
      ry += 3
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5)
      doc.setTextColor(...GRAY)
      doc.text('Sin cédula definida', rpX + 3, ry)
      ry += 4
    }

    ry += 2
    doc.setDrawColor(...LINE_COLOR)
    doc.setLineWidth(0.2)
    doc.line(rpX, ry, rpX + rpW, ry)
    ry += 3

    // ══════ RIGHT PANEL: NOTES ══════
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(...BLACK)
    doc.text('NOTAS:', rpX + 3, ry)
    ry += 3

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(3.8)
    doc.setTextColor(...GRAY)
    for (const line of NOTAS_OMM) {
      if (ry > ph - margin - 12) break
      doc.text(line.substring(0, 65), rpX + 3, ry)
      ry += 2.5
    }

    // ══════ LEFT CONTENT: DEVICE SCHEDULE ══════
    const lx = margin + 4
    let ly = margin + 5

    // System title
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...GREEN)
    doc.text(`INSTALACIONES ESPECIALES — ${sysName.toUpperCase()}`, lx, ly)
    ly += 2

    doc.setDrawColor(...GREEN)
    doc.setLineWidth(0.5)
    doc.line(lx, ly, rpX - 4, ly)
    ly += 6

    // Organize by area
    const areaMap = new Map<string, SembradoDevice[]>()
    for (const dev of sysData.devices) {
      const area = dev.area || 'General'
      if (!areaMap.has(area)) areaMap.set(area, [])
      areaMap.get(area)!.push(dev)
    }

    // Column positions
    const cols = [lx, lx + 8, lx + 28, lx + 62, lx + 86, lx + 108, lx + 120, lx + 140, lx + 160]
    const colLabels = ['SÍM.', 'NOMENCLATURA', 'DESCRIPCIÓN', 'MARCA', 'MODELO', 'CANT.', 'UBICACIÓN', 'ALTURA INST.']
    const bottomLimit = ph - margin - 12

    doc.setTextColor(...BLACK)

    for (const [areaName, areaDevs] of areaMap) {
      if (ly > bottomLimit - 12) break

      // Area header with green background
      doc.setFillColor(232, 255, 240)
      doc.rect(lx - 1, ly - 3, contentW + 2, 6, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(46, 204, 113)
      doc.text(areaName.toUpperCase(), lx, ly)
      ly += 6

      // Column headers
      doc.setFillColor(245, 245, 245)
      doc.rect(lx - 1, ly - 3, contentW + 2, 5, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(4.5)
      doc.setTextColor(...BLACK)
      colLabels.forEach((label, i) => doc.text(label, cols[i], ly))
      ly += 1.5
      doc.setDrawColor(...LINE_COLOR)
      doc.setLineWidth(0.15)
      doc.line(lx, ly, rpX - 4, ly)
      ly += 4

      // Device rows
      for (const dev of areaDevs) {
        if (ly > bottomLimit) break

        // Symbol
        drawSymbol(doc, dev.symbol_type || 'network_node', cols[0] + 3, ly - 0.5, 3)

        // Text
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(5)
        doc.setTextColor(...BLACK)
        doc.text(dev.nomenclature.substring(0, 14), cols[1], ly)

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(5.5)
        doc.text(dev.name.substring(0, 24), cols[2], ly)
        doc.text(dev.brand.substring(0, 14), cols[3], ly)
        doc.text(dev.model.substring(0, 16), cols[4], ly)
        doc.text(String(dev.quantity), cols[5], ly)
        doc.text(dev.area.substring(0, 12), cols[6], ly)

        doc.setFontSize(5)
        doc.text(dev.install_height ? `H: ${dev.install_height}` : '', cols[7], ly)

        // Requirements line
        if (dev.requirements) {
          ly += 3
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(4)
          doc.setTextColor(...GRAY)
          doc.text(`REQ: ${dev.requirements.substring(0, 45)}`, cols[2], ly)
          doc.setTextColor(...BLACK)
        }

        ly += 4.5

        // Row separator
        doc.setDrawColor(224, 224, 224)
        doc.setLineWidth(0.1)
        doc.line(lx, ly - 1.5, rpX - 4, ly - 1.5)
      }

      ly += 3
    }

    // Total count
    const total = sysData.devices.reduce((s, d) => s + (d.quantity || 1), 0)
    if (ly < bottomLimit) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6)
      doc.setTextColor(46, 204, 113)
      doc.text(`TOTAL DISPOSITIVOS: ${total}`, lx, ly)
    }

    // ══════ BOTTOM BAR ══════
    const barY = ph - margin - 9
    const barH = 9

    doc.setFillColor(240, 240, 240)
    doc.rect(margin, barY, rpX - margin, barH, 'F')
    doc.setDrawColor(...LINE_COLOR)
    doc.setLineWidth(0.25)
    doc.line(margin, barY, rpX, barY)

    // Left: title
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5)
    doc.setTextColor(...BLACK)
    doc.text('INSTALACIONES ESPECIALES', margin + 4, barY + 3)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(sysName.toUpperCase(), margin + 4, barY + 7)

    // Scale
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.text(`ESC. ${data.project.scale}`, margin + 75, barY + 5)

    // Document key
    const sysCode = SYS_CODE[sysName] || sysName.substring(0, 4).toUpperCase()
    const docKey = `${data.project.prefix}-IESP-${sysCode}_01`

    doc.setFontSize(4.5)
    doc.text('CONTENIDO:', rpX - 50, barY + 3)
    doc.text(`Proyección de ${sysName}`, rpX - 35, barY + 3)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5)
    doc.text('CLAVE:', rpX - 50, barY + 6.5)
    doc.setTextColor(...GREEN)
    doc.setFontSize(6)
    doc.text(docKey, rpX - 39, barY + 6.5)
    doc.setTextColor(...BLACK)
  })

  return doc
}

/**
 * Generate and trigger download of the Sembrado PDF.
 */
export function downloadSembradoPdf(data: SembradoData, filename?: string): void {
  const doc = generateSembradoPdf(data)
  doc.save(filename || `Sembrado_${data.project.name}.pdf`)
}
