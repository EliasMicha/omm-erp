"""
OMM Technologies - Sembrado (Installation Layout) PDF Generator
Professional technical installation documents matching OMM's engineering plan style.

Usage:
    from generate_sembrado import generate_sembrado
    pdf_path = generate_sembrado(data_dict, "/path/to/output.pdf")
"""

from reportlab.lib.pagesizes import landscape, letter, A3
from reportlab.pdfgen import canvas
from reportlab.lib.units import inch, mm
from reportlab.lib.colors import HexColor, black, white, Color
from reportlab.lib import colors
import math
import json
from datetime import datetime
from typing import Dict, List, Tuple, Any
import os

# OMM Brand Colors
OMM_GREEN = HexColor("#57FF9A")
OMM_DARK_GREEN = HexColor("#2ECC71")
OMM_BLACK = HexColor("#1a1a1a")
OMM_GRAY = HexColor("#666666")
OMM_LIGHT_GRAY = HexColor("#CCCCCC")
OMM_LINE = HexColor("#333333")
OMM_BG_LIGHT = HexColor("#F8F8F8")

# Standard OMM notes for installation documents
NOTAS_OMM = [
    "1. TODAS LAS DIMENSIONES ARQUITECTÓNICAS, ALTURAS Y COTAS SERÁN",
    "   VERIFICADAS EN CAMPO ANTES DE LA INSTALACIÓN.",
    "2. CANALIZACIONES Y TUBERÍA:",
    "   2.1 TODAS LAS CANALIZACIONES Y TUBERÍA SERÁN EMPOTRADAS EN MURO.",
    "   2.2 TODAS LAS CANALIZACIONES Y TUBERÍAS DE LA INSTALACIÓN SERÁN DE CONDUIT",
    "       PVC DELGADO PARED DELGADA, REFORZADO EN PUNTOS DONDE SE REQUIERA.",
    "   2.3 LAS CANALIZACIONES Y TUBERÍAS QUE SERÁN EXPUESTAS DEBERÁN SER",
    "       MATERIAL GALVANIZADO O CONDUIT PVC TIPO PESADO.",
    "3. CONEXIONES:",
    "   3.1 TODOS LOS REGISTROS DE LA INSTALACIÓN INTERIOR SERÁN DE LÁMINA GALVANIZADA O",
    "       PLÁSTICO DE ACUERDO AL ESPACIO Y CANTIDAD DE CABLES, A MENOS QUE SE INDIQUE",
    "       LO CONTRARIO EN LOS PLANOS.",
    "4. CABLEADO:",
    "   4.1 TODOS LOS CONDUCTORES ELÉCTRICOS UTILIZADOS SERÁN CABLE DE COBRE CON",
    "       AISLAMIENTO PVC THW-LS / TF, MARCA CONDUMEX, IUSA O SIMILAR.",
    "   4.2 LOS CONECTORES DE AUDIO, BOCINAS PASIVAS SERÁN CABLE DE COBRE SPT O CABLE DE",
    "       PARLANTE CALIBRE INDICADO EN PLANOS.",
]


class SembradoSymbols:
    """Draw device symbols matching OMM's engineering plan style."""

    SZ = 10  # base symbol size

    @staticmethod
    def _circle_with_text(c, x, y, text, sz=10):
        r = sz / 2
        c.setLineWidth(0.8)
        c.setStrokeColor(OMM_BLACK)
        c.setFillColor(white)
        c.circle(x, y, r, fill=1, stroke=1)
        c.setFillColor(OMM_BLACK)
        c.setFont("Helvetica-Bold", max(5, sz * 0.55))
        c.drawCentredString(x, y - sz * 0.18, text)

    @staticmethod
    def _rect_with_text(c, x, y, text, sz=10, w_mult=1.2, h_mult=0.7):
        w = sz * w_mult
        h = sz * h_mult
        c.setLineWidth(0.8)
        c.setStrokeColor(OMM_BLACK)
        c.setFillColor(white)
        c.rect(x - w/2, y - h/2, w, h, fill=1, stroke=1)
        c.setFillColor(OMM_BLACK)
        c.setFont("Helvetica-Bold", max(5, sz * 0.5))
        c.drawCentredString(x, y - sz * 0.15, text)

    @staticmethod
    def draw_speaker_ceiling(c, x, y, sz=10):
        """Bocina de plafón — circle with radiating arcs."""
        r = sz / 2
        c.setLineWidth(0.8)
        c.setStrokeColor(OMM_BLACK)
        c.setFillColor(white)
        c.circle(x, y, r, fill=1, stroke=1)
        # Inner speaker cone
        c.setFillColor(OMM_BLACK)
        c.circle(x, y, r * 0.3, fill=1, stroke=0)
        # Radiating arcs
        c.setLineWidth(0.5)
        for angle_start in [30, 120, 210, 300]:
            c.arc(x - r*0.7, y - r*0.7, x + r*0.7, y + r*0.7, angle_start, 30)

    @staticmethod
    def draw_speaker_wall(c, x, y, sz=10):
        """Bocina de pared."""
        SembradoSymbols._rect_with_text(c, x, y, "♪", sz)

    @staticmethod
    def draw_subwoofer(c, x, y, sz=10):
        SembradoSymbols._circle_with_text(c, x, y, "SW", sz)

    @staticmethod
    def draw_amplifier(c, x, y, sz=10):
        SembradoSymbols._rect_with_text(c, x, y, "AMP", sz, 1.5)

    @staticmethod
    def draw_camera_wifi(c, x, y, sz=10):
        """Cámara WiFi — circle with lens dot + wifi arc."""
        r = sz / 2
        c.setLineWidth(0.8)
        c.setStrokeColor(OMM_BLACK)
        c.setFillColor(white)
        c.circle(x, y, r, fill=1, stroke=1)
        # Lens
        c.setFillColor(OMM_BLACK)
        c.circle(x, y, r * 0.25, fill=1, stroke=0)
        # WiFi arc
        c.setLineWidth(0.5)
        c.arc(x + r*0.1, y + r*0.1, x + r*0.8, y + r*0.8, 0, 90)

    @staticmethod
    def draw_camera_bullet(c, x, y, sz=10):
        SembradoSymbols._circle_with_text(c, x, y, "CB", sz)

    @staticmethod
    def draw_biometric_reader(c, x, y, sz=10):
        """Lector biométrico — rectangle with fingerprint hint."""
        w, h = sz * 0.8, sz * 1.0
        c.setLineWidth(0.8)
        c.setStrokeColor(OMM_BLACK)
        c.setFillColor(white)
        c.rect(x - w/2, y - h/2, w, h, fill=1, stroke=1)
        # Fingerprint arcs
        c.setLineWidth(0.4)
        c.setFillColor(OMM_BLACK)
        c.arc(x - sz*0.2, y - sz*0.2, x + sz*0.2, y + sz*0.2, 0, 180)
        c.arc(x - sz*0.12, y - sz*0.1, x + sz*0.12, y + sz*0.15, 0, 180)

    @staticmethod
    def draw_magnetic_lock(c, x, y, sz=10):
        SembradoSymbols._rect_with_text(c, x, y, "MAG", sz, 1.3)

    @staticmethod
    def draw_release_button(c, x, y, sz=10):
        SembradoSymbols._circle_with_text(c, x, y, "B", sz)

    @staticmethod
    def draw_keypad(c, x, y, sz=10):
        """Botonera pared — rect with horizontal grid lines."""
        w, h = sz * 0.9, sz * 1.1
        c.setLineWidth(0.8)
        c.setStrokeColor(OMM_BLACK)
        c.setFillColor(white)
        c.rect(x - w/2, y - h/2, w, h, fill=1, stroke=1)
        # Grid lines
        c.setLineWidth(0.3)
        for i in range(1, 4):
            yy = y - h/2 + (h * i / 4)
            c.line(x - w*0.35, yy, x + w*0.35, yy)

    @staticmethod
    def draw_keypad_wireless(c, x, y, sz=10):
        """Botonera inalámbrica."""
        SembradoSymbols.draw_keypad(c, x, y, sz)
        # WiFi arc on top
        c.setLineWidth(0.5)
        c.arc(x - sz*0.2, y + sz*0.35, x + sz*0.2, y + sz*0.65, 0, 180)

    @staticmethod
    def draw_smoke_detector(c, x, y, sz=10):
        SembradoSymbols._circle_with_text(c, x, y, "DH", sz)

    @staticmethod
    def draw_gas_detector(c, x, y, sz=10):
        SembradoSymbols._circle_with_text(c, x, y, "DG", sz)

    @staticmethod
    def draw_temperature_detector(c, x, y, sz=10):
        SembradoSymbols._circle_with_text(c, x, y, "DT", sz)

    @staticmethod
    def draw_manual_station(c, x, y, sz=10):
        SembradoSymbols._rect_with_text(c, x, y, "EM", sz, 1.0, 0.9)

    @staticmethod
    def draw_horn_strobe(c, x, y, sz=10):
        """Base sonora — circle with radiating lines."""
        r = sz / 2
        c.setLineWidth(0.8)
        c.setStrokeColor(OMM_BLACK)
        c.setFillColor(white)
        c.circle(x, y, r, fill=1, stroke=1)
        c.setFillColor(OMM_BLACK)
        c.setFont("Helvetica-Bold", max(5, sz*0.5))
        c.drawCentredString(x, y - sz*0.15, "BS")
        # Radiating lines
        c.setLineWidth(0.4)
        for ang in [45, 135]:
            rad = math.radians(ang)
            c.line(x + r*0.8*math.cos(rad), y + r*0.8*math.sin(rad),
                   x + r*1.3*math.cos(rad), y + r*1.3*math.sin(rad))

    @staticmethod
    def draw_fire_panel(c, x, y, sz=10):
        SembradoSymbols._rect_with_text(c, x, y, "PANEL", sz, 1.8, 0.8)

    @staticmethod
    def draw_network_node(c, x, y, sz=10):
        """Salida de nodos — circle with cross lines."""
        r = sz / 2
        c.setLineWidth(0.8)
        c.setStrokeColor(OMM_BLACK)
        c.setFillColor(white)
        c.circle(x, y, r, fill=1, stroke=1)
        c.setLineWidth(0.5)
        c.line(x - r*0.5, y, x + r*0.5, y)
        c.line(x, y - r*0.5, x, y + r*0.5)

    @staticmethod
    def draw_phone(c, x, y, sz=10):
        SembradoSymbols._rect_with_text(c, x, y, "TEL", sz, 1.1, 0.8)

    @staticmethod
    def draw_access_panel(c, x, y, sz=10):
        SembradoSymbols._rect_with_text(c, x, y, "TAC", sz, 1.3, 0.8)

    @staticmethod
    def draw_blind_node(c, x, y, sz=10):
        """Nodo persiana — rect with vertical lines."""
        w, h = sz * 1.0, sz * 0.7
        c.setLineWidth(0.8)
        c.setStrokeColor(OMM_BLACK)
        c.setFillColor(white)
        c.rect(x - w/2, y - h/2, w, h, fill=1, stroke=1)
        # Vertical slat lines
        c.setLineWidth(0.3)
        for i in range(-2, 3):
            xx = x + i * sz * 0.12
            c.line(xx, y - h*0.35, xx, y + h*0.35)

    @staticmethod
    def draw_projector(c, x, y, sz=10):
        SembradoSymbols._rect_with_text(c, x, y, "PROY", sz, 1.4, 0.8)

    @staticmethod
    def draw_projection_screen(c, x, y, sz=10):
        """Pantalla de proyección."""
        w = sz * 1.6
        c.setLineWidth(0.8)
        c.setStrokeColor(OMM_BLACK)
        c.line(x - w/2, y, x + w/2, y)
        # End caps
        c.line(x - w/2, y - sz*0.2, x - w/2, y + sz*0.2)
        c.line(x + w/2, y - sz*0.2, x + w/2, y + sz*0.2)

    @staticmethod
    def draw_rack(c, x, y, sz=10):
        """Rack — filled dark rectangle."""
        w, h = sz * 1.0, sz * 0.7
        c.setLineWidth(0.8)
        c.setStrokeColor(OMM_BLACK)
        c.setFillColor(HexColor("#444444"))
        c.rect(x - w/2, y - h/2, w, h, fill=1, stroke=1)
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", max(4, sz*0.4))
        c.drawCentredString(x, y - sz*0.12, "RACK")

    @staticmethod
    def draw_multicriterio(c, x, y, sz=10):
        SembradoSymbols._circle_with_text(c, x, y, "MC", sz)

    @staticmethod
    def draw_control_module(c, x, y, sz=10):
        SembradoSymbols._rect_with_text(c, x, y, "MOD", sz, 1.3, 0.8)

    DRAW_MAP = {
        'speaker_ceiling': draw_speaker_ceiling,
        'speaker_wall': draw_speaker_wall,
        'subwoofer': draw_subwoofer,
        'amplifier': draw_amplifier,
        'camera_wifi': draw_camera_wifi,
        'camera_bullet': draw_camera_bullet,
        'biometric_reader': draw_biometric_reader,
        'magnetic_lock': draw_magnetic_lock,
        'release_button': draw_release_button,
        'keypad': draw_keypad,
        'keypad_wireless': draw_keypad_wireless,
        'smoke_detector': draw_smoke_detector,
        'gas_detector': draw_gas_detector,
        'temperature_detector': draw_temperature_detector,
        'manual_station': draw_manual_station,
        'horn_strobe': draw_horn_strobe,
        'fire_panel': draw_fire_panel,
        'network_node': draw_network_node,
        'phone': draw_phone,
        'access_panel': draw_access_panel,
        'blind_node': draw_blind_node,
        'projector': draw_projector,
        'projection_screen': draw_projection_screen,
        'rack': draw_rack,
        'multicriterio': draw_multicriterio,
        'control_module': draw_control_module,
    }

    @staticmethod
    def draw(c, symbol_type: str, x, y, sz=10):
        fn = SembradoSymbols.DRAW_MAP.get(symbol_type)
        if fn:
            fn(c, x, y, sz)
        else:
            SembradoSymbols._circle_with_text(c, x, y, "?", sz)


# ─────────────────────────────────────────────────────────────────────────────
# PDF Generator
# ─────────────────────────────────────────────────────────────────────────────

class SembradoPDFGenerator:
    """Generate professional OMM-branded sembrado PDF documents."""

    def __init__(self, data: Dict[str, Any], output_path: str):
        self.data = data
        self.output_path = output_path
        self.project = data.get('project', {})
        self.systems = data.get('systems', {})

        # Page: landscape letter (11 × 8.5 inches)
        self.pw, self.ph = landscape(letter)
        self.margin = 0.4 * inch

        # Layout: right panel = 3.0 inches wide
        self.rpanel_w = 3.0 * inch
        self.rpanel_x = self.pw - self.margin - self.rpanel_w
        self.content_w = self.rpanel_x - self.margin - 0.15 * inch  # left content area

        self.c = None

    def generate(self) -> str:
        self.c = canvas.Canvas(self.output_path, pagesize=landscape(letter))
        self.c.setTitle(f"Sembrado - {self.project.get('name', 'OMM')}")
        self.c.setAuthor("OMM Technologies")

        for sys_name, sys_data in self.systems.items():
            self._page(sys_name, sys_data)
            self.c.showPage()

        self.c.save()
        return self.output_path

    # ── Full page ────────────────────────────────────────────────────────────

    def _page(self, sys_name: str, sys_data: dict):
        c = self.c

        # Page border
        c.setStrokeColor(OMM_LINE)
        c.setLineWidth(1.2)
        c.rect(self.margin, self.margin,
               self.pw - 2*self.margin, self.ph - 2*self.margin)

        # Vertical divider for right panel
        c.setLineWidth(0.8)
        c.line(self.rpanel_x, self.margin, self.rpanel_x, self.ph - self.margin)

        # Right panel sections
        y_cursor = self.ph - self.margin
        y_cursor = self._draw_header_block(sys_name, y_cursor)
        y_cursor = self._draw_project_info(y_cursor)
        y_cursor = self._draw_symbology(sys_data, y_cursor)
        y_cursor = self._draw_cedula(sys_data, y_cursor)
        self._draw_notes(y_cursor)

        # Left content: device schedule
        self._draw_device_schedule(sys_name, sys_data)

        # Bottom title bar
        self._draw_bottom_bar(sys_name)

    # ── Right panel: Header block ────────────────────────────────────────────

    def _draw_header_block(self, sys_name: str, y_top: float) -> float:
        c = self.c
        x = self.rpanel_x + 0.15 * inch
        w = self.rpanel_w - 0.3 * inch
        y = y_top - 0.15 * inch

        # OMM logo area with green accent bar
        bar_h = 3
        c.setFillColor(OMM_GREEN)
        c.rect(self.rpanel_x, y - 0.02*inch, self.rpanel_w, bar_h, fill=1, stroke=0)

        y -= 0.22 * inch

        # OMNIIOUS text
        c.setFillColor(OMM_GREEN)
        c.setFont("Helvetica-Bold", 14)
        c.drawRightString(x + w, y, "OMNIIOUS")
        y -= 0.12 * inch

        # Tagline
        c.setFillColor(OMM_GRAY)
        c.setFont("Helvetica", 5.5)
        c.drawRightString(x + w, y, "Bosques de Durango No. 69, Planta Baja, Interior 4")
        y -= 0.08 * inch
        c.drawRightString(x + w, y, "Bosques de Reforma, Miguel Hidalgo, CDMX, C.P. 11700")

        y -= 0.18 * inch

        # Divider line
        c.setStrokeColor(OMM_LINE)
        c.setLineWidth(0.5)
        c.line(self.rpanel_x, y, self.rpanel_x + self.rpanel_w, y)

        return y

    # ── Right panel: Project info table ──────────────────────────────────────

    def _draw_project_info(self, y_top: float) -> float:
        c = self.c
        x = self.rpanel_x + 0.12 * inch
        w = self.rpanel_w - 0.24 * inch
        y = y_top - 0.15 * inch

        rows = [
            ("PROYECTO:", self.project.get('name', 'N/A')),
            ("UBICACIÓN:", self.project.get('location', 'N/A')),
            ("DIBUJO / PROYECTÓ:", self.project.get('drawn_by', 'AI OMM Agent')),
            ("REVISÓ:", self.project.get('reviewed_by', '')),
            ("COORDINÓ:", self.project.get('coordinated_by', self.project.get('reviewed_by', ''))),
            ("FECHA:", self.project.get('date', datetime.now().strftime('%d/%m/%Y'))),
            ("ESCALA:", self.project.get('scale', 'Indicada')),
        ]

        row_h = 0.16 * inch
        for label, value in rows:
            # Label
            c.setFont("Helvetica-Bold", 6)
            c.setFillColor(OMM_BLACK)
            c.drawString(x, y, label)
            # Value
            c.setFont("Helvetica", 6.5)
            c.drawString(x + 0.95 * inch, y, str(value)[:35])
            y -= row_h

        # Box around info
        box_h = len(rows) * row_h + 0.08 * inch
        c.setStrokeColor(OMM_LINE)
        c.setLineWidth(0.5)
        c.rect(self.rpanel_x + 0.06*inch, y + 0.02*inch,
               self.rpanel_w - 0.12*inch, box_h)

        y -= 0.08 * inch
        c.line(self.rpanel_x, y, self.rpanel_x + self.rpanel_w, y)
        return y

    # ── Right panel: Symbology ───────────────────────────────────────────────

    def _draw_symbology(self, sys_data: dict, y_top: float) -> float:
        c = self.c
        x = self.rpanel_x + 0.15 * inch
        w = self.rpanel_w - 0.3 * inch
        y = y_top - 0.18 * inch

        # Section title
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(OMM_BLACK)
        c.drawString(x, y, "SIMBOLOGÍA:")
        y -= 0.22 * inch

        # Collect unique device types
        seen = {}
        for dev in sys_data.get('devices', []):
            st = dev.get('symbol_type', 'network_node')
            if st not in seen:
                seen[st] = dev.get('name', st)

        # Draw each symbol + label
        sym_x = x + 0.1 * inch
        label_x = x + 0.35 * inch
        row_h = 0.22 * inch

        for symbol_type, name in seen.items():
            if y < self.margin + 2.5 * inch:
                break

            # Draw symbol
            c.setFillColor(OMM_BLACK)
            c.setStrokeColor(OMM_BLACK)
            SembradoSymbols.draw(c, symbol_type, sym_x, y + 0.02*inch, sz=11)

            # Description block
            c.setFillColor(OMM_BLACK)
            c.setFont("Helvetica-Bold", 6.5)
            c.drawString(label_x, y + 0.04*inch, name[:28].upper())

            # Additional info if available
            c.setFont("Helvetica", 5.5)
            c.setFillColor(OMM_GRAY)
            # We could add brand/model info here in future
            c.drawString(label_x, y - 0.06*inch, "")

            y -= row_h

        y -= 0.1 * inch
        c.setStrokeColor(OMM_LINE)
        c.setLineWidth(0.5)
        c.line(self.rpanel_x, y, self.rpanel_x + self.rpanel_w, y)
        return y

    # ── Right panel: Cédula de tubería ───────────────────────────────────────

    def _draw_cedula(self, sys_data: dict, y_top: float) -> float:
        c = self.c
        x = self.rpanel_x + 0.12 * inch
        w = self.rpanel_w - 0.24 * inch
        y = y_top - 0.18 * inch

        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(OMM_BLACK)
        c.drawString(x, y, "CÉDULA DE TUBERÍA")
        y -= 0.18 * inch

        schedules = sys_data.get('conduit_schedule', [])
        if not schedules:
            c.setFont("Helvetica", 6)
            c.setFillColor(OMM_GRAY)
            c.drawString(x, y, "Sin cédula definida")
            y -= 0.15 * inch
            c.setStrokeColor(OMM_LINE)
            c.setLineWidth(0.5)
            c.line(self.rpanel_x, y, self.rpanel_x + self.rpanel_w, y)
            return y

        # Table headers
        cols = [
            (x, "CÉDULA"),
            (x + 0.45*inch, "CABLE DUPLEX"),
            (x + 1.3*inch, "ADICIONAL"),
            (x + 1.95*inch, "CONDUIT"),
        ]

        c.setFont("Helvetica-Bold", 5.5)
        c.setFillColor(OMM_BLACK)
        for cx, label in cols:
            c.drawString(cx, y, label)

        y -= 0.06 * inch
        c.setStrokeColor(OMM_BLACK)
        c.setLineWidth(0.6)
        c.line(x, y, x + w, y)
        y -= 0.12 * inch

        # Data rows
        c.setFont("Helvetica", 6)
        for sched in schedules[:10]:
            sid = str(sched.get('id', ''))
            cable = str(sched.get('cable', ''))
            addl = str(sched.get('additional', '---'))
            conduit = str(sched.get('conduit', ''))

            # Circle with ID letter
            c.setStrokeColor(OMM_BLACK)
            c.setFillColor(white)
            c.circle(x + 0.12*inch, y + 0.02*inch, 5, fill=1, stroke=1)
            c.setFillColor(OMM_BLACK)
            c.setFont("Helvetica-Bold", 5.5)
            c.drawCentredString(x + 0.12*inch, y - 0.01*inch, sid)

            c.setFont("Helvetica", 6)
            c.drawString(cols[1][0], y, cable[:14])
            c.drawString(cols[2][0], y, addl[:10])
            c.drawString(cols[3][0], y, conduit[:16])

            y -= 0.14 * inch

        # Line types legend
        y -= 0.08 * inch
        c.setStrokeColor(OMM_BLACK)
        c.setLineWidth(0.8)
        c.line(x, y + 0.04*inch, x + 0.5*inch, y + 0.04*inch)
        c.setFont("Helvetica", 5.5)
        c.drawString(x + 0.55*inch, y, "TUBERÍA POR PLAFÓN")
        y -= 0.12 * inch
        c.setDash([3, 3])
        c.line(x, y + 0.04*inch, x + 0.5*inch, y + 0.04*inch)
        c.setDash([])
        c.drawString(x + 0.55*inch, y, "TUBERÍA POR PISO")

        y -= 0.15 * inch
        c.setStrokeColor(OMM_LINE)
        c.setLineWidth(0.5)
        c.line(self.rpanel_x, y, self.rpanel_x + self.rpanel_w, y)
        return y

    # ── Right panel: Notes ───────────────────────────────────────────────────

    def _draw_notes(self, y_top: float):
        c = self.c
        x = self.rpanel_x + 0.12 * inch
        y = y_top - 0.15 * inch

        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(OMM_BLACK)
        c.drawString(x, y, "NOTAS:")
        y -= 0.14 * inch

        c.setFont("Helvetica", 4.5)
        c.setFillColor(OMM_GRAY)
        for line in NOTAS_OMM:
            if y < self.margin + 0.5 * inch:
                break
            c.drawString(x, y, line[:65])
            y -= 0.08 * inch

    # ── Bottom bar ───────────────────────────────────────────────────────────

    def _draw_bottom_bar(self, sys_name: str):
        c = self.c
        bar_h = 0.35 * inch
        bar_y = self.margin
        bar_w = self.rpanel_x - self.margin

        # Background
        c.setFillColor(HexColor("#f0f0f0"))
        c.rect(self.margin, bar_y, bar_w, bar_h, fill=1, stroke=0)

        # Divider line on top
        c.setStrokeColor(OMM_LINE)
        c.setLineWidth(0.8)
        c.line(self.margin, bar_y + bar_h, self.rpanel_x, bar_y + bar_h)

        # Left: Instalaciones Especiales badge
        cx = self.margin + 0.2 * inch
        cy = bar_y + bar_h / 2

        c.setFillColor(OMM_BLACK)
        c.setFont("Helvetica", 6)
        c.drawString(cx, cy + 0.04*inch, "INSTALACIONES ESPECIALES")
        c.setFont("Helvetica-Bold", 10)
        c.drawString(cx, cy - 0.14*inch, sys_name.upper())

        # Scale
        esc = self.project.get('scale', 'S/E')
        c.setFont("Helvetica", 7)
        c.drawString(cx + 2.5*inch, cy - 0.04*inch, f"ESC. {esc}")

        # Right side: document key
        proj_prefix = self.project.get('prefix', 'OMM')
        sys_code_map = {
            'Audio': 'AUD', 'CCTV': 'CCTV', 'Control de Acceso': 'ACC',
            'Control de Iluminación': 'CTRL', 'Detección de Humo': 'DH',
            'Red': 'RED', 'Persianas': 'PRS', 'Cortinas': 'PRS',
        }
        sys_code = sys_code_map.get(sys_name, sys_name[:4].upper())
        doc_key = f"{proj_prefix}-IESP-{sys_code}_01"

        c.setFont("Helvetica", 5.5)
        c.drawString(self.rpanel_x - 1.8*inch, cy + 0.06*inch, "CONTENIDO:")
        c.setFont("Helvetica", 5.5)
        c.drawString(self.rpanel_x - 1.8*inch + 0.55*inch, cy + 0.06*inch,
                     f"Proyección de {sys_name}")

        c.setFont("Helvetica-Bold", 6)
        c.drawString(self.rpanel_x - 1.8*inch, cy - 0.08*inch, "CLAVE:")
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(OMM_GREEN)
        c.drawString(self.rpanel_x - 1.8*inch + 0.4*inch, cy - 0.08*inch, doc_key)

    # ── Left content: Device schedule ────────────────────────────────────────

    def _draw_device_schedule(self, sys_name: str, sys_data: dict):
        c = self.c
        devices = sys_data.get('devices', [])
        x0 = self.margin + 0.2 * inch
        y = self.ph - self.margin - 0.3 * inch
        max_x = self.rpanel_x - 0.15 * inch
        table_w = max_x - x0

        # System title
        c.setFont("Helvetica-Bold", 14)
        c.setFillColor(OMM_GREEN)
        c.drawString(x0, y, f"INSTALACIONES ESPECIALES — {sys_name.upper()}")
        c.setFillColor(OMM_BLACK)

        y -= 0.12 * inch
        c.setStrokeColor(OMM_GREEN)
        c.setLineWidth(1.5)
        c.line(x0, y, max_x, y)
        y -= 0.25 * inch

        # Organize by area
        areas: Dict[str, list] = {}
        for dev in devices:
            area = dev.get('area', 'General')
            areas.setdefault(area, []).append(dev)

        # Column definitions
        col_defs = [
            (0,             "SÍM.",    0.3*inch),
            (0.3*inch,      "NOMENCLATURA", 0.9*inch),
            (1.2*inch,      "DESCRIPCIÓN",  1.6*inch),
            (2.8*inch,      "MARCA",        0.8*inch),
            (3.6*inch,      "MODELO",       1.0*inch),
            (4.6*inch,      "CANT.",        0.35*inch),
            (4.95*inch,     "UBICACIÓN",    0.7*inch),
            (5.65*inch,     "ALTURA INST.", 0.7*inch),
        ]

        bottom_limit = self.margin + 0.5 * inch

        for area_name, area_devs in areas.items():
            if y < bottom_limit + 0.5 * inch:
                break

            # Area header with green background
            c.setFillColor(HexColor("#E8FFF0"))
            c.rect(x0 - 0.05*inch, y - 0.04*inch, table_w + 0.1*inch, 0.22*inch,
                   fill=1, stroke=0)
            c.setFillColor(OMM_DARK_GREEN)
            c.setFont("Helvetica-Bold", 8)
            c.drawString(x0, y, area_name.upper())
            y -= 0.28 * inch

            # Column headers
            c.setFillColor(HexColor("#F5F5F5"))
            c.rect(x0 - 0.05*inch, y - 0.04*inch, table_w + 0.1*inch, 0.18*inch,
                   fill=1, stroke=0)
            c.setFillColor(OMM_BLACK)
            c.setFont("Helvetica-Bold", 5.5)
            for offset, label, _ in col_defs:
                c.drawString(x0 + offset, y, label)

            y -= 0.06 * inch
            c.setStrokeColor(OMM_LINE)
            c.setLineWidth(0.4)
            c.line(x0, y, max_x, y)
            y -= 0.16 * inch

            # Device rows
            c.setFont("Helvetica", 6.5)
            for dev in area_devs:
                if y < bottom_limit:
                    break

                sym_type = dev.get('symbol_type', 'network_node')
                nom = dev.get('nomenclature', '')
                name = dev.get('name', '')
                brand = dev.get('brand', '')
                model = dev.get('model', '')
                qty = str(dev.get('quantity', 1))
                area_short = dev.get('area', '')
                height = dev.get('install_height', '')
                reqs = dev.get('requirements', '')

                # Symbol
                c.setFillColor(OMM_BLACK)
                c.setStrokeColor(OMM_BLACK)
                SembradoSymbols.draw(c, sym_type, x0 + 0.12*inch, y + 0.02*inch, sz=9)

                # Text columns
                c.setFillColor(OMM_BLACK)
                c.setFont("Helvetica-Bold", 6)
                c.drawString(x0 + col_defs[1][0], y, nom[:12])

                c.setFont("Helvetica", 6.5)
                c.drawString(x0 + col_defs[2][0], y, name[:22])
                c.drawString(x0 + col_defs[3][0], y, brand[:12])
                c.drawString(x0 + col_defs[4][0], y, model[:14])
                c.drawString(x0 + col_defs[5][0], y, qty)
                c.drawString(x0 + col_defs[6][0], y, area_short[:10])

                c.setFont("Helvetica", 6)
                c.drawString(x0 + col_defs[7][0], y, f"H: {height}" if height else "")

                # Requirements line (smaller, gray)
                if reqs:
                    y -= 0.1 * inch
                    c.setFont("Helvetica", 5)
                    c.setFillColor(OMM_GRAY)
                    c.drawString(x0 + col_defs[2][0], y, f"REQ: {reqs[:40]}")
                    c.setFillColor(OMM_BLACK)

                y -= 0.18 * inch

                # Subtle row separator
                c.setStrokeColor(HexColor("#E0E0E0"))
                c.setLineWidth(0.3)
                c.line(x0, y + 0.12*inch, max_x, y + 0.12*inch)

            y -= 0.15 * inch

        # Summary count at the bottom
        total = sum(d.get('quantity', 1) for d in devices)
        if y > bottom_limit:
            c.setFont("Helvetica-Bold", 7)
            c.setFillColor(OMM_DARK_GREEN)
            c.drawString(x0, y, f"TOTAL DISPOSITIVOS: {total}")


def generate_sembrado(data: Dict[str, Any], output_path: str) -> str:
    """Generate a professional Sembrado PDF."""
    gen = SembradoPDFGenerator(data, output_path)
    return gen.generate()


if __name__ == "__main__":
    import sys
    # CLI mode: --input <json_file> --output <pdf_path>
    if '--input' in sys.argv and '--output' in sys.argv:
        input_idx = sys.argv.index('--input') + 1
        output_idx = sys.argv.index('--output') + 1
        input_path = sys.argv[input_idx]
        output_path = sys.argv[output_idx]
        with open(input_path, 'r') as f:
            data = json.load(f)
        result = generate_sembrado(data, output_path)
        print(f"OK:{result}")
        sys.exit(0)

    # Test mode with sample data
    test_data = {
        "project": {
            "name": "MARÍA ATTIE",
            "prefix": "MRTT",
            "location": "Torre B, Carretera Cto. M° 204, Las de Vista Hermosa, Cuajimalpa",
            "date": "16/04/2026",
            "drawn_by": "Luis Adrián Romero Garrige",
            "reviewed_by": "Alfonso Reyes Villalobos",
            "coordinated_by": "Elias Graneroinchu Cohen",
            "scale": "1:60",
        },
        "systems": {
            "Audio": {
                "devices": [
                    {"nomenclature": "NPS-BCN.01", "name": "Bocina de Plafón", "brand": "Sonance",
                     "model": "SS-4.0RD", "area": "Recámara Principal", "quantity": 2,
                     "install_height": "Plafón", "requirements": "Cable 14 AWG", "symbol_type": "speaker_ceiling"},
                    {"nomenclature": "NPS-BCN.02", "name": "Bocina de Plafón", "brand": "Sonance",
                     "model": "SS-4.0RD", "area": "Sala/Comedor", "quantity": 6,
                     "install_height": "Plafón", "requirements": "Cable 14 AWG", "symbol_type": "speaker_ceiling"},
                    {"nomenclature": "NPS-BCN.03", "name": "Bocina de Plafón", "brand": "Sonance",
                     "model": "SS-4.0RD", "area": "Cocina", "quantity": 2,
                     "install_height": "Plafón", "requirements": "Cable 14 AWG", "symbol_type": "speaker_ceiling"},
                    {"nomenclature": "NPS-BCN.04", "name": "Bocina de Plafón 6\"", "brand": "Sonance",
                     "model": "TL-4.0RD", "area": "Terraza", "quantity": 2,
                     "install_height": "Plafón", "requirements": "Cable 14 AWG", "symbol_type": "speaker_ceiling"},
                    {"nomenclature": "NPS-BCN.05", "name": "Bocina de Empotar", "brand": "Sonance",
                     "model": "SM Studio 8.1w/g", "area": "Sala/Comedor", "quantity": 2,
                     "install_height": "Plafón", "requirements": "Cable 14 AWG", "symbol_type": "speaker_wall"},
                    {"nomenclature": "NPS-SUB.01", "name": "Subwoofer", "brand": "Sonance",
                     "model": "?"  , "area": "Sala/Comedor", "quantity": 1,
                     "install_height": "Plafón", "requirements": "Cable 14 AWG", "symbol_type": "subwoofer"},
                    {"nomenclature": "NPS-SWP.01", "name": "Amplificador Sonance", "brand": "Sonance",
                     "model": "DSP-AMP01.5W", "area": "Rack", "quantity": 1,
                     "install_height": "Rack", "requirements": "120V", "symbol_type": "amplifier"},
                    {"nomenclature": "MDF-AMP.01", "name": "Amplificador Multi-zona", "brand": "Denon",
                     "model": "HEOS", "area": "Rack", "quantity": 1,
                     "install_height": "Rack", "requirements": "120V", "symbol_type": "amplifier"},
                    {"nomenclature": "PROY-01", "name": "Elevador de Proyector", "brand": "OPTOMA",
                     "model": "4K0", "area": "Rec. Principal", "quantity": 1,
                     "install_height": "Plafón", "requirements": "HDMI + 120V", "symbol_type": "projector"},
                    {"nomenclature": "PANT-01", "name": "Pantalla de Proyección", "brand": "SI",
                     "model": "LARGO", "area": "Rec. Principal", "quantity": 1,
                     "install_height": "Plafón", "requirements": "127V", "symbol_type": "projection_screen"},
                ],
                "conduit_schedule": [
                    {"id": "A", "cable": "2×14 AWG", "additional": "---", "conduit": "TSD 21mm (3/4\")"},
                    {"id": "B", "cable": "4×14 AWG", "additional": "---", "conduit": "TSD 21mm (3/4\")"},
                    {"id": "C", "cable": "6×14 AWG", "additional": "---", "conduit": "TSD 21mm (3/4\")"},
                    {"id": "D", "cable": "8×14 AWG", "additional": "---", "conduit": "TSD 27mm (1\")"},
                    {"id": "E", "cable": "10×14 AWG", "additional": "---", "conduit": "TSD 33mm (1 1/4\")"},
                ],
            },
            "CCTV": {
                "devices": [
                    {"nomenclature": "NPS-CAM.01", "name": "Cámara WiFi", "brand": "RING",
                     "model": "INDOOR/CAM", "area": "Acceso Principal", "quantity": 1,
                     "install_height": "Plafón", "requirements": "1 UTP Cat6", "symbol_type": "camera_wifi"},
                    {"nomenclature": "NPS-CAM.02", "name": "Cámara WiFi", "brand": "RING",
                     "model": "INDOOR/CAM", "area": "Vestíbulo", "quantity": 1,
                     "install_height": "Plafón", "requirements": "1 UTP Cat6", "symbol_type": "camera_wifi"},
                    {"nomenclature": "NPS-CAM.03", "name": "Cámara WiFi", "brand": "RING",
                     "model": "INDOOR/CAM", "area": "Cocina", "quantity": 1,
                     "install_height": "Plafón", "requirements": "1 UTP Cat6", "symbol_type": "camera_wifi"},
                    {"nomenclature": "NPS-CAM.04", "name": "Cámara WiFi", "brand": "RING",
                     "model": "INDOOR/CAM", "area": "Terraza", "quantity": 1,
                     "install_height": "Plafón", "requirements": "1 UTP Cat6", "symbol_type": "camera_wifi"},
                    {"nomenclature": "NPS-CAM.05", "name": "Cámara WiFi", "brand": "RING",
                     "model": "INDOOR/CAM", "area": "Safe", "quantity": 1,
                     "install_height": "Plafón", "requirements": "1 UTP Cat6", "symbol_type": "camera_wifi"},
                ],
                "conduit_schedule": [
                    {"id": "A", "cable": "1 UTP Cat6", "additional": "---", "conduit": "TSD 21mm (3/4\")"},
                    {"id": "B", "cable": "2 UTP Cat6", "additional": "---", "conduit": "TSD 21mm (3/4\")"},
                ],
            },
            "Control de Acceso": {
                "devices": [
                    {"nomenclature": "ACCS-BIO.01", "name": "Lector Biométrico", "brand": "ANVIZ",
                     "model": "DS-K1T680MFK-E1", "area": "Acceso Principal", "quantity": 1,
                     "install_height": "1.10m", "requirements": "2 UTP6, 20V", "symbol_type": "biometric_reader"},
                    {"nomenclature": "ACCS-BIO.02", "name": "Lector Biométrico", "brand": "ANVIZ",
                     "model": "DS-K1T680MFK-E1", "area": "Acceso Servicio", "quantity": 1,
                     "install_height": "1.10m", "requirements": "2 UTP6, 20V", "symbol_type": "biometric_reader"},
                    {"nomenclature": "ACCS-MAG.01", "name": "Chapa Magnética", "brand": "ACCESSPRO",
                     "model": "SOMETHING", "area": "Acceso Principal", "quantity": 1,
                     "install_height": "Plafón", "requirements": "1 UTP6", "symbol_type": "magnetic_lock"},
                    {"nomenclature": "ACCS-BOT.01", "name": "Botón Liberador", "brand": "Hikvision",
                     "model": "DS-K1T680", "area": "Acceso Principal", "quantity": 1,
                     "install_height": "1.10m", "requirements": "1 UTP6", "symbol_type": "release_button"},
                    {"nomenclature": "TAC-01", "name": "Tablero Control de Acceso", "brand": "ACCESSPRO",
                     "model": "DS-K2604/DS-KASE01", "area": "Safe", "quantity": 1,
                     "install_height": "Muro", "requirements": "127 VCA", "symbol_type": "access_panel"},
                ],
                "conduit_schedule": [
                    {"id": "A", "cable": "1 UTP Cat6", "additional": "---", "conduit": "TSD 21mm (3/4\")"},
                    {"id": "B", "cable": "2 UTP Cat6", "additional": "---", "conduit": "TSD 21mm (3/4\")"},
                    {"id": "C", "cable": "3 UTP Cat6", "additional": "---", "conduit": "TSD 21mm (3/4\")"},
                ],
            },
            "Control de Iluminación": {
                "devices": [
                    {"nomenclature": "BOT-PARED.01", "name": "Botonera Pared", "brand": "Lutron",
                     "model": "Palladiom", "area": "Sala/Comedor", "quantity": 3,
                     "install_height": "1.10m", "requirements": "1 Lutron Yellow, 1 Caja Gang", "symbol_type": "keypad"},
                    {"nomenclature": "BOT-PARED.02", "name": "Botonera Pared", "brand": "Lutron",
                     "model": "Palladiom", "area": "Recámara Principal", "quantity": 2,
                     "install_height": "1.10m", "requirements": "1 Lutron Yellow, 1 Caja Gang", "symbol_type": "keypad"},
                    {"nomenclature": "BOT-INAL.01", "name": "Botonera Inalámbrica", "brand": "Lutron",
                     "model": "PICO", "area": "Cocina", "quantity": 1,
                     "install_height": "1.10m", "requirements": "1 Caja Gang", "symbol_type": "keypad_wireless"},
                    {"nomenclature": "MOD-REP.01", "name": "Módulos Repetidora", "brand": "Lutron",
                     "model": "HQP-6RP-120", "area": "Rack", "quantity": 2,
                     "install_height": "Rack/Plafón", "requirements": "127V", "symbol_type": "control_module"},
                ],
                "conduit_schedule": [
                    {"id": "A", "cable": "1 Cable Lutron Yellow", "additional": "---", "conduit": "TSD 21mm (3/4\")"},
                    {"id": "B", "cable": "2 Cable Lutron Yellow", "additional": "---", "conduit": "TSD 21mm (3/4\")"},
                    {"id": "C", "cable": "3 Cable Lutron Yellow", "additional": "---", "conduit": "TSD 27mm (1\")"},
                ],
            },
            "Detección de Humo": {
                "devices": [
                    {"nomenclature": "DH-01", "name": "Detector de Humo", "brand": "Honeywell",
                     "model": "SD365", "area": "Sala/Comedor", "quantity": 2,
                     "install_height": "Plafón", "requirements": "2×18 UL", "symbol_type": "smoke_detector"},
                    {"nomenclature": "DH-02", "name": "Detector de Humo", "brand": "Honeywell",
                     "model": "SD365", "area": "Cocina", "quantity": 1,
                     "install_height": "Plafón", "requirements": "2×18 UL", "symbol_type": "smoke_detector"},
                    {"nomenclature": "DH-03", "name": "Detector de Humo", "brand": "Honeywell",
                     "model": "SD365", "area": "Recámaras", "quantity": 3,
                     "install_height": "Plafón", "requirements": "2×18 UL", "symbol_type": "smoke_detector"},
                    {"nomenclature": "DG-01", "name": "Detector de Gas", "brand": "MACURCO",
                     "model": "GD-2A", "area": "Cocina", "quantity": 1,
                     "install_height": "0.30 MTS", "requirements": "2×18 UL", "symbol_type": "gas_detector"},
                    {"nomenclature": "BS-01", "name": "Base Sonora", "brand": "Honeywell",
                     "model": "---", "area": "Sala/Comedor", "quantity": 2,
                     "install_height": "Plafón", "requirements": "2×18 UL", "symbol_type": "horn_strobe"},
                    {"nomenclature": "PANEL-01", "name": "Panel de Detección", "brand": "Fire-Lite",
                     "model": "ES-50X", "area": "Rack", "quantity": 1,
                     "install_height": "1.50 MTS", "requirements": "120V", "symbol_type": "fire_panel"},
                ],
                "conduit_schedule": [
                    {"id": "A", "cable": "2×18 AWG", "additional": "UL-1666", "conduit": "TSD 16mm"},
                    {"id": "B", "cable": "2×18 AWG", "additional": "UL-1666", "conduit": "TSD 16mm"},
                    {"id": "C", "cable": "3×18 AWG", "additional": "UL-1666", "conduit": "TSD 21mm"},
                ],
            },
            "Red": {
                "devices": [
                    {"nomenclature": "REC2-01", "name": "Salida 2 Nodos de Red", "brand": "---",
                     "model": "---", "area": "Cocina", "quantity": 1,
                     "install_height": "1.50 MTS", "requirements": "2 UTP Cat6A, 1 COAXIAL, Caja 4x2\"", "symbol_type": "network_node"},
                    {"nomenclature": "REC2-02", "name": "Salida 2 Nodos de Red", "brand": "---",
                     "model": "---", "area": "Sala/Comedor", "quantity": 2,
                     "install_height": "1.50 MTS", "requirements": "2 UTP Cat6A, 1 COAXIAL, Caja 4x2\"", "symbol_type": "network_node"},
                    {"nomenclature": "TEL-01", "name": "Teléfono HD", "brand": "Grandstream",
                     "model": "DP-730", "area": "Cocina", "quantity": 1,
                     "install_height": "Mueble", "requirements": "127VCA", "symbol_type": "phone"},
                    {"nomenclature": "TEL-02", "name": "Teléfono HD", "brand": "Grandstream",
                     "model": "DP-730", "area": "Recámara Principal", "quantity": 1,
                     "install_height": "Mueble", "requirements": "127VCA", "symbol_type": "phone"},
                ],
                "conduit_schedule": [
                    {"id": "A", "cable": "1 UTP Cat6A", "additional": "---", "conduit": "TSD 21mm"},
                    {"id": "B", "cable": "2 UTP Cat6A", "additional": "---", "conduit": "TSD 21mm"},
                    {"id": "C", "cable": "3 UTP Cat6A", "additional": "---", "conduit": "TSD 21mm"},
                ],
            },
            "Persianas": {
                "devices": [
                    {"nomenclature": "PRS-NOD.01", "name": "Nodos Persiana", "brand": "Lutron",
                     "model": "---", "area": "Sala/Comedor", "quantity": 4,
                     "install_height": "Plafón", "requirements": "2 Lutron Yellow, Caja 4x2\", 127V", "symbol_type": "blind_node"},
                    {"nomenclature": "PRS-NOD.02", "name": "Nodos Persiana", "brand": "Lutron",
                     "model": "---", "area": "Recámara Principal", "quantity": 2,
                     "install_height": "Plafón", "requirements": "2 Lutron Yellow, Caja 4x2\", 127V", "symbol_type": "blind_node"},
                ],
                "conduit_schedule": [
                    {"id": "A", "cable": "1 Cable Lutron Yellow", "additional": "---", "conduit": "TSD 21mm (3/4\")"},
                    {"id": "B", "cable": "2 Cable Lutron Yellow", "additional": "---", "conduit": "TSD 21mm (3/4\")"},
                ],
            },
        }
    }

    output_path = "/tmp/sembrado_omm_test.pdf"
    result = generate_sembrado(test_data, output_path)
    print(f"✓ PDF generated: {result}")
    print(f"  Size: {os.path.getsize(result) / 1024:.1f} KB")
