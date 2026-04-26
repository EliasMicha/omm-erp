import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { F, STAGE_CONFIG } from '../lib/utils'
import { Badge, Btn, Loading } from '../components/layout/UI'
import { ChevronLeft, ChevronDown, ChevronRight, Settings, X, Printer, Download, Save, Check, Pencil } from 'lucide-react'
import EditCotInfoModal from '../components/EditCotInfoModal'
import { OMNIIOUS_LOGO } from '../assets/logo'
import { autoCreateProjectFromQuotation } from '../lib/projectUtils'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface ProyConfig {
  currency: 'USD' | 'MXN'
  tipoCambio: number
  ivaRate: number
}

interface ProyItem {
  id: string
  systemId: string
  m2: number
  precioM2: number
  descripcion: string
  entregablesActivos: string[]
  included: boolean
  order: number
}

interface ProySystem {
  id: string
  name: string
  defaultPrecioM2: number
  defaultDesc: string
  entregables: string[]
}

// ═══════════════════════════════════════════════════════════════════
// PROYECTO SYSTEMS DATA
// ═══════════════════════════════════════════════════════════════════

const PROYECTO_SYSTEMS: ProySystem[] = [
  {
    id: 'cctv',
    name: 'CCTV (Videovigilancia)',
    defaultPrecioM2: 10,
    defaultDesc: 'Proyecto de CCTV',
    entregables: [
      'Sembrado ejecutivo de cámaras por área',
      'Rutas de tubería y canalización',
      'Alturas, orientaciones y criterios de cobertura',
      'Diagrama del sistema CCTV',
      'Criterios de selección de equipos'
    ]
  },
  {
    id: 'audio',
    name: 'Audio Ambiental',
    defaultPrecioM2: 10,
    defaultDesc: 'Proyecto de Audio',
    entregables: [
      'Sembrado ejecutivo de bocinas por zona',
      'Rutas de tubería y canalización',
      'Simbología y alturas de montaje',
      'Diagrama del sistema de audio',
      'Criterios de selección de equipos'
    ]
  },
  {
    id: 'redes',
    name: 'Redes (Datos / WiFi)',
    defaultPrecioM2: 12,
    defaultDesc: 'Proyecto de Voz y Datos',
    entregables: [
      'Sembrado ejecutivo de puntos de red y WiFi',
      'Rutas de tubería y canalización',
      'Simbología técnica y alturas de instalación',
      'Diagrama de arquitectura de red',
      'Criterios y especificación de equipos'
    ]
  },
  {
    id: 'control_acceso',
    name: 'Control de Acceso',
    defaultPrecioM2: 5,
    defaultDesc: 'Proyecto de Control de Acceso',
    entregables: [
      'Sembrado ejecutivo de lectores, cerraduras y controladoras',
      'Rutas de tubería y canalización',
      'Alturas, simbología y criterios de instalación',
      'Diagrama del sistema',
      'Criterios de operación'
    ]
  },
  {
    id: 'control_iluminacion',
    name: 'Control de Iluminación',
    defaultPrecioM2: 10,
    defaultDesc: 'Proyecto de Control de Iluminación',
    entregables: [
      'Sembrado ejecutivo de cargas, botoneras y dispositivos de control',
      'Rutas de tubería y canalización',
      'Simbología, alturas y criterios de control',
      'Diagrama del sistema de control de iluminación'
    ]
  },
  {
    id: 'deteccion_incendios',
    name: 'Detección de Incendios',
    defaultPrecioM2: 10,
    defaultDesc: 'Proyecto de Detección de Incendios',
    entregables: [
      'Sembrado ejecutivo de detectores, estaciones manuales, sirenas y estrobos',
      'Rutas de tubería y canalización',
      'Alturas de instalación y simbología normalizada',
      'Diagrama del sistema de detección y alarmas',
      'Criterios de diseño conforme a normatividad aplicable'
    ]
  },
  {
    id: 'bms',
    name: 'BMS',
    defaultPrecioM2: 10,
    defaultDesc: 'Proyecto de BMS',
    entregables: [
      'Diagrama de arquitectura BMS',
      'Lista de puntos de monitoreo y control',
      'Criterios de integración con sistemas'
    ]
  },
  {
    id: 'automatizacion',
    name: 'Automatización / Integración',
    defaultPrecioM2: 10,
    defaultDesc: 'Proyecto de Automatización',
    entregables: [
      'Diagrama ejecutivo de integración entre sistemas',
      'Arquitectura de automatización del proyecto'
    ]
  },
  {
    id: 'cortinas',
    name: 'Persianas / Cortinas Motorizadas',
    defaultPrecioM2: 10,
    defaultDesc: 'Proyecto de Persianas y Cortinas',
    entregables: [
      'Sembrado ejecutivo de motores y controles',
      'Rutas de canalización',
      'Alturas y criterios de montaje',
      'Esquema de control'
    ]
  },
  {
    id: 'site',
    name: 'SITE / Cuartos Técnicos',
    defaultPrecioM2: 10,
    defaultDesc: 'Proyecto de Cuartos Técnicos',
    entregables: [
      'Layout ejecutivo de cuartos técnicos (SITE, MDF, IDF)',
      'Diagramas de racks',
      'Rutas de canalización y criterios eléctricos básicos'
    ]
  },
  {
    id: 'doc_general',
    name: 'Documentación General',
    defaultPrecioM2: 0,
    defaultDesc: 'Documentación General',
    entregables: [
      'Memoria técnica ejecutiva',
      'Alcance, criterios de diseño y notas para construcción'
    ]
  },
]

// ═══════════════════════════════════════════════════════════════════
// INGENIERÍA ELÉCTRICA SYSTEMS
// ═══════════════════════════════════════════════════════════════════

const ELECTRICA_SYSTEMS: ProySystem[] = [
  {
    id: 'unifilar',
    name: 'Diagrama Unifilar y Cuadro de Cargas',
    defaultPrecioM2: 12,
    defaultDesc: 'Diagrama Unifilar y Cuadro de Cargas',
    entregables: [
      'Diagrama unifilar general del proyecto',
      'Cuadro de cargas detallado por tablero',
      'Especificación de protecciones (interruptores, fusibles)',
      'Coordinación de protecciones',
      'Diagrama de alimentadores principales',
    ]
  },
  {
    id: 'canalizacion_electrica',
    name: 'Canalización y Circuitos',
    defaultPrecioM2: 10,
    defaultDesc: 'Canalización y Circuitos Eléctricos',
    entregables: [
      'Rutas de canalización eléctrica (charolas, tubería, ductos)',
      'Planos de circuitos derivados',
      'Especificación de cables y conductores',
      'Detalle de acometida y medición',
      'Criterios de instalación y simbología',
    ]
  },
  {
    id: 'alumbrado',
    name: 'Alumbrado',
    defaultPrecioM2: 10,
    defaultDesc: 'Planos de Alumbrado',
    entregables: [
      'Planta de alumbrado interior',
      'Planta de alumbrado exterior (si aplica)',
      'Circuitos de alumbrado y apagadores',
      'Criterios y niveles de iluminación por área',
    ]
  },
  {
    id: 'contactos',
    name: 'Contactos y Salidas de Fuerza',
    defaultPrecioM2: 8,
    defaultDesc: 'Contactos y Salidas de Fuerza',
    entregables: [
      'Planta de contactos normales y regulados',
      'Salidas de fuerza para equipos especiales',
      'Circuitos de contactos por tablero',
      'Criterios de instalación y alturas',
    ]
  },
  {
    id: 'tierras',
    name: 'Sistema de Tierras y Pararrayos',
    defaultPrecioM2: 5,
    defaultDesc: 'Sistema de Tierras y Pararrayos',
    entregables: [
      'Diseño de malla o red de tierras',
      'Sistema de pararrayos (si aplica)',
      'Especificaciones de electrodos y conductores de tierra',
      'Detalle de conexiones a tierra de equipos',
    ]
  },
  {
    id: 'memoria_electrica',
    name: 'Memoria Técnica y Especificaciones',
    defaultPrecioM2: 0,
    defaultDesc: 'Documentación Técnica Eléctrica',
    entregables: [
      'Memoria técnica descriptiva del proyecto eléctrico',
      'Especificaciones de materiales y equipos',
      'Notas y criterios generales de construcción',
      'Lista de planos del proyecto',
    ]
  },
]

// ═══════════════════════════════════════════════════════════════════
// ILUMINACIÓN SYSTEMS (specialty: 'ilum')
// ═══════════════════════════════════════════════════════════════════

const ILUM_SYSTEMS: ProySystem[] = [
  {
    id: 'ilum_residencial',
    name: 'Iluminación Residencial',
    defaultPrecioM2: 60,
    defaultDesc: 'Proyecto de Iluminación Residencial',
    entregables: [
      'Elaboración de Concepto Lumínico: Desarrollo de un concepto integral de iluminación acorde con las necesidades del espacio y los requerimientos estéticos y funcionales del proyecto',
      'Propuesta de diseño basada en tendencias actuales y normativas aplicables, buscando optimizar el rendimiento energético y la experiencia visual',
      'Presentación de Luminarias: Selección cuidadosa de luminarias específicas para el proyecto, considerando estética, funcionalidad y eficiencia energética',
      'Creación de una presentación profesional para mostrar las opciones seleccionadas, incluyendo imágenes, especificaciones clave y beneficios',
      'Catálogo de Fichas Técnicas: Compilación de un catálogo detallado que incluya las fichas técnicas de todas las luminarias propuestas',
      'Información técnica completa para cada luminaria, incluyendo dimensiones, potencia, flujo luminoso, temperaturas de color y acabados',
      'Sembrado Ejecutivo: Creación de planos ejecutivos de iluminación que indiquen la ubicación exacta de cada luminaria en el espacio',
      'Coordinación con otras disciplinas del proyecto para garantizar la correcta implementación en sitio',
      'Propuesta de Luminarias Decorativas: Desarrollo de una propuesta especializada en luminarias decorativas que complementen el diseño interior y aporten valor estético al espacio',
      'Selección de luminarias decorativas que armonicen con el concepto lumínico general y la arquitectura del proyecto',
      'Detalles Constructivos: Preparación de detalles constructivos específicos para la instalación de luminarias, asegurando una correcta ejecución en sitio',
      'Inclusión de instrucciones claras para soportes, conexiones eléctricas y acabados, en coordinación con el equipo de obra',
    ]
  },
  {
    id: 'ilum_comercial',
    name: 'Iluminación Comercial',
    defaultPrecioM2: 50,
    defaultDesc: 'Proyecto de Iluminación Comercial',
    entregables: [
      'Elaboración de Concepto Lumínico para espacios comerciales',
      'Propuesta de diseño orientada a la experiencia del usuario y eficiencia energética',
      'Presentación de Luminarias: Selección de luminarias para espacios comerciales',
      'Catálogo de Fichas Técnicas de luminarias propuestas',
      'Sembrado Ejecutivo: Planos ejecutivos de iluminación',
      'Coordinación con arquitectura e interiorismo',
      'Cálculos luminotécnicos conforme a normativa',
      'Detalles Constructivos para instalación',
    ]
  },
  {
    id: 'ilum_exterior',
    name: 'Iluminación Exterior / Paisaje',
    defaultPrecioM2: 45,
    defaultDesc: 'Proyecto de Iluminación Exterior',
    entregables: [
      'Concepto lumínico para áreas exteriores y paisaje',
      'Selección de luminarias IP65+ para exteriores',
      'Sembrado ejecutivo en planos de paisaje',
      'Criterios de instalación y protección contra intemperie',
      'Detalles constructivos para montaje exterior',
    ]
  },
]

// Iluminación-specific PDF conditions
// Proyecto (instalaciones especiales) PDF conditions
const PROY_PDF_CONDITIONS = `
  <div class="section-title">Alcance del Proyecto</div>
  <div class="section-text">
    El alcance del proyecto comprende exclusivamente el <strong>desarrollo de ingeniería y documentación técnica</strong>, sin considerar bajo ninguna circunstancia la ejecución física en obra.
  </div>
  <div class="section-text">
    <strong><u>No están incluidos</u></strong>, salvo que se indique expresamente en esta cotización:
  </div>
  <div class="section-text" style="padding-left: 20px;">
    • Suministro de equipos y materiales.<br/>
    • Instalación, canalizaciones o cableado.<br/>
    • Programación, configuración o integración de sistemas.<br/>
    • Pruebas, puesta en marcha o capacitación.<br/>
    • Supervisión de obra o dirección técnica en sitio.
  </div>

  <div class="section-title">Información Base del Cliente</div>
  <div class="section-text">
    Las ingenierías se desarrollan con base en la información proporcionada por el cliente, incluyendo planos arquitectónicos, ingenierías base y criterios definidos al inicio del proyecto.
  </div>
  <div class="section-text">
    Cualquier modificación posterior en:
  </div>
  <div class="section-text" style="padding-left: 20px;">
    • Arquitectura.<br/>
    • Layout.<br/>
    • Uso de áreas.<br/>
    • Criterios operativos.<br/>
    • Alcances originalmente definidos.
  </div>
  <div class="section-text">
    Será considerada <strong>un cambio de alcance</strong> y podrá generar ajustes en costo, tiempos y entregables.
  </div>

  <div class="section-title">Cambios y Ajustes de Alcance</div>
  <div class="section-text">
    La cotización incluye <strong>una ronda de ajustes razonables</strong> derivada de observaciones del cliente sobre la ingeniería presentada.
  </div>
  <div class="section-text">
    Cambios adicionales, o modificaciones que impliquen:
  </div>
  <div class="section-text" style="padding-left: 20px;">
    • Rehacer sembrados.<br/>
    • Cambiar rutas de tubería.<br/>
    • Ajustar criterios técnicos.<br/>
    • Modificar sistemas ya desarrollados.
  </div>
  <div class="section-text">
    Se cotizarán de manera independiente previo a su ejecución.
  </div>

  <div class="section-title">Coordinación con Otras Ingenierías</div>
  <div class="section-text">
    El alcance contempla <strong>coordinación técnica a nivel de proyecto</strong>, con las ingenierías involucradas (arquitectura, eléctrica, HVAC, etc.), únicamente para compatibilizar la información contenida en los planos.
  </div>
  <div class="section-text">
    No se incluye:
  </div>
  <div class="section-text" style="padding-left: 20px;">
    • Resolución de conflictos en obra.<br/>
    • Ajustes derivados de errores de terceros.<br/>
    • Supervisión de ejecución en campo.
  </div>

  <div class="section-title">Condiciones de Pago</div>
  <div class="section-text">
    Para el inicio del desarrollo de las <strong>Ingenierías Ejecutivas de Instalaciones Especiales</strong>, se establecen las siguientes condiciones de pago:
  </div>
  <div class="section-text" style="padding-left: 20px;">
    • <strong>50% de anticipo</strong> al momento de la aceptación de la cotización, requerido para iniciar los trabajos de ingeniería.<br/><br/>
    • <strong>50% restante</strong> contra entrega de la ingeniería ejecutiva completa.
  </div>
  <div class="section-text">
    En caso de que el cliente decida <strong>ejecutar la obra completa</strong> de los sistemas de instalaciones especiales con <strong>nuestro equipo</strong>, el monto pagado por concepto de ingeniería ejecutiva será <strong>acreditado como descuento</strong> en el siguiente pago correspondiente a la etapa de ejecución de obra, de acuerdo con el esquema de contratación acordado.
  </div>
  <div class="section-text">
    En caso de que el cliente decida <strong>ejecutar la obra con un proveedor distinto</strong>, el <strong>100% del monto</strong> correspondiente a la ingeniería ejecutiva deberá quedar liquidado, sin excepción, conforme a los términos de esta cotización.
  </div>
  <div class="section-text">
    El inicio de cualquier etapa posterior (suministro, instalación, programación o puesta en marcha) estará sujeto a la liquidación de los montos correspondientes y a la firma de los acuerdos contractuales aplicables.
  </div>

  <div class="section-title">Vigencia</div>
  <div class="section-text">
    Esta cotización tiene validez de 30 días calendario a partir de su emisión. Sujeta a disponibilidad de personal y confirmación de calendario.
  </div>
`

const ILUM_PDF_CONDITIONS = `
  <div class="section-title">ALCANCES GENERALES</div>

  <div class="section-text"><strong>Elaboración de Concepto Lumínico:</strong></div>
  <div class="section-text" style="padding-left: 20px;">
    A) Desarrollo de un concepto integral de iluminación acorde con las necesidades del espacio y los requerimientos estéticos y funcionales del proyecto.<br/><br/>
    B) Propuesta de diseño basada en tendencias actuales y normativas aplicables, buscando optimizar el rendimiento energético y la experiencia visual.
  </div>

  <div class="section-text"><strong>Presentación de Luminarias:</strong></div>
  <div class="section-text" style="padding-left: 20px;">
    A) Selección cuidadosa de luminarias específicas para el proyecto, considerando estética, funcionalidad y eficiencia energética.<br/><br/>
    B) Creación de una presentación profesional para mostrar las opciones seleccionadas, incluyendo imágenes, especificaciones clave y beneficios.
  </div>

  <div class="section-text"><strong>Catálogo de Fichas Técnicas:</strong></div>
  <div class="section-text" style="padding-left: 20px;">
    A) Compilación de un catálogo detallado que incluya las fichas técnicas de todas las luminarias propuestas.<br/><br/>
    B) Información técnica completa para cada luminaria, incluyendo dimensiones, potencia, flujo luminoso, temperaturas de color y acabados.
  </div>

  <div class="section-text"><strong>Sembrado Ejecutivo:</strong></div>
  <div class="section-text" style="padding-left: 20px;">
    A) Creación de planos ejecutivos de iluminación que indiquen la ubicación exacta de cada luminaria en el espacio.<br/><br/>
    B) Coordinación con otras disciplinas del proyecto para garantizar la correcta implementación en sitio.
  </div>

  <div class="section-text"><strong>Propuesta de Luminarias Decorativas:</strong></div>
  <div class="section-text" style="padding-left: 20px;">
    A) Desarrollo de una propuesta especializada en luminarias decorativas que complementen el diseño interior y aporten valor estético al espacio.<br/><br/>
    B) Selección de luminarias decorativas que armonicen con el concepto lumínico general y la arquitectura del proyecto.
  </div>

  <div class="section-text"><strong>Detalles Constructivos:</strong></div>
  <div class="section-text" style="padding-left: 20px;">
    A) Preparación de detalles constructivos específicos para la instalación de luminarias, asegurando una correcta ejecución en sitio.<br/><br/>
    B) Inclusión de instrucciones claras para soportes, conexiones eléctricas y acabados, en coordinación con el equipo de obra.
  </div>

  <div class="section-title">TÉRMINOS GENERALES</div>
  <div class="section-text" style="padding-left: 20px;">
    1) Se requiere un anticipo del <strong>70% del costo total</strong> para dar inicio al proyecto. El <strong>30% restante</strong> deberá liquidarse al momento de la entrega final.<br/><br/>
    2) La fecha de entrega del proyecto será acordada directamente con el cliente.<br/><br/>
    3) Cualquier cambio o ajuste en los alcances del proyecto estará sujeto a una cotización adicional.<br/><br/>
    4) En caso de que la ejecución del proyecto sea realizada por OMM Technologies SA de CV, se podrá otorgar un <strong>crédito del 50% del costo total</strong> del proyecto.
  </div>

  <div class="section-title">Vigencia</div>
  <div class="section-text">
    Esta cotización tiene validez de 30 días calendario a partir de su emisión.
  </div>
`

// Ingeniería Eléctrica PDF conditions
const ELECTRICA_PDF_CONDITIONS = `
  <div class="section-title">Alcance del Proyecto</div>
  <div class="section-text">
    El alcance del proyecto comprende exclusivamente el <strong>desarrollo de ingeniería eléctrica y documentación técnica</strong>, sin considerar bajo ninguna circunstancia la ejecución física en obra.
  </div>
  <div class="section-text">
    <strong><u>No están incluidos</u></strong>, salvo que se indique expresamente en esta cotización:
  </div>
  <div class="section-text" style="padding-left: 20px;">
    • Suministro de materiales, tableros o equipos eléctricos.<br/>
    • Instalación, canalización o cableado.<br/>
    • Trámites ante CFE u organismos reguladores.<br/>
    • Pruebas, puesta en marcha o certificaciones.<br/>
    • Supervisión de obra o dirección técnica en sitio.
  </div>

  <div class="section-title">Información Base del Cliente</div>
  <div class="section-text">
    La ingeniería eléctrica se desarrolla con base en la información proporcionada por el cliente, incluyendo planos arquitectónicos, ingenierías base y criterios definidos al inicio del proyecto.
  </div>
  <div class="section-text">
    Cualquier modificación posterior en arquitectura, layout, uso de áreas, criterios operativos o alcances originalmente definidos será considerada <strong>un cambio de alcance</strong> y podrá generar ajustes en costo, tiempos y entregables.
  </div>

  <div class="section-title">Cambios y Ajustes de Alcance</div>
  <div class="section-text">
    La cotización incluye <strong>una ronda de ajustes razonables</strong> derivada de observaciones del cliente sobre la ingeniería presentada.
  </div>
  <div class="section-text">
    Cambios adicionales o modificaciones que impliquen rehacer diagramas, recalcular cargas, cambiar rutas de canalización o modificar criterios de diseño se cotizarán de manera independiente previo a su ejecución.
  </div>

  <div class="section-title">Coordinación con Otras Ingenierías</div>
  <div class="section-text">
    El alcance contempla <strong>coordinación técnica a nivel de proyecto</strong> con las ingenierías involucradas (arquitectura, instalaciones especiales, HVAC, etc.), únicamente para compatibilizar la información contenida en los planos.
  </div>
  <div class="section-text">
    No se incluye resolución de conflictos en obra, ajustes derivados de errores de terceros ni supervisión de ejecución en campo.
  </div>

  <div class="section-title">Condiciones de Pago</div>
  <div class="section-text" style="padding-left: 20px;">
    • <strong>50% de anticipo</strong> al momento de la aceptación de la cotización, requerido para iniciar los trabajos de ingeniería.<br/><br/>
    • <strong>50% restante</strong> contra entrega de la ingeniería eléctrica completa.
  </div>
  <div class="section-text">
    En caso de que el cliente decida <strong>ejecutar la obra eléctrica completa</strong> con <strong>nuestro equipo</strong>, el monto pagado por concepto de ingeniería será <strong>acreditado como descuento</strong> en el siguiente pago de la etapa de ejecución.
  </div>

  <div class="section-title">Vigencia</div>
  <div class="section-text">
    Esta cotización tiene validez de 30 días calendario a partir de su emisión. Sujeta a disponibilidad de personal y confirmación de calendario.
  </div>
`

// ═══════════════════════════════════════════════════════════════════
// TIPO PROYECTO CONFIG
// ═══════════════════════════════════════════════════════════════════

type TipoProyecto = 'especiales' | 'electrica' | 'iluminacion'

const TIPO_PROYECTO_CONFIG: Record<TipoProyecto, {
  label: string
  icon: string
  color: string
  systems: ProySystem[]
  conditions: string
  badgeLabel: string
  titlePrefix: string
}> = {
  especiales: {
    label: 'Ingenierías Especiales',
    icon: '⚡',
    color: '#F9A8D4',
    systems: PROYECTO_SYSTEMS,
    conditions: PROY_PDF_CONDITIONS,
    badgeLabel: 'PROY',
    titlePrefix: 'PROYECTO DE INGENIERÍA',
  },
  electrica: {
    label: 'Ingeniería Eléctrica',
    icon: '🔌',
    color: '#F59E0B',
    systems: ELECTRICA_SYSTEMS,
    conditions: ELECTRICA_PDF_CONDITIONS,
    badgeLabel: 'ELEC',
    titlePrefix: 'INGENIERÍA ELÉCTRICA',
  },
  iluminacion: {
    label: 'Diseño de Iluminación',
    icon: '💡',
    color: '#C084FC',
    systems: ILUM_SYSTEMS,
    conditions: ILUM_PDF_CONDITIONS,
    badgeLabel: 'ILUM',
    titlePrefix: 'DISEÑO DE ILUMINACIÓN',
  },
}

// ═══════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════

const S = {
  input: {
    background: '#1e1e1e',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#ccc',
    fontSize: 12,
    fontFamily: 'inherit',
    padding: '5px 8px',
    textAlign: 'right' as const,
    width: 70,
  },
  select: {
    background: '#1e1e1e',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#ccc',
    fontSize: 11,
    fontFamily: 'inherit',
    padding: '5px 6px',
  },
  th: {
    padding: '6px 8px',
    fontSize: 9,
    fontWeight: 600,
    color: '#444',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    borderBottom: '1px solid #222',
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '5px 6px',
    fontSize: 12,
    color: '#ccc',
    borderBottom: '1px solid #1a1a1a',
  },
  tdR: {
    padding: '5px 6px',
    fontSize: 12,
    color: '#ccc',
    borderBottom: '1px solid #1a1a1a',
    textAlign: 'right' as const,
  },
  tdM: {
    padding: '5px 6px',
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    borderBottom: '1px solid #1a1a1a',
    textAlign: 'right' as const,
  },
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function defaultItem(systemId: string, order: number, systems: ProySystem[] = PROYECTO_SYSTEMS): ProyItem {
  const system = systems.find(s => s.id === systemId)!
  return {
    id: uid(),
    systemId,
    m2: 0,
    precioM2: system.defaultPrecioM2,
    descripcion: system.defaultDesc,
    entregablesActivos: [...system.entregables],
    included: true,
    order,
  }
}

// ═══════════════════════════════════════════════════════════════════
// PDF MODAL
// ═══════════════════════════════════════════════════════════════════

function ProyPdfModal({
  items,
  config,
  cotName,
  clientName,
  projectName,
  onClose,
  systems,
  tipoProyecto,
}: {
  items: ProyItem[]
  config: ProyConfig
  cotName: string
  clientName: string
  projectName: string
  onClose: () => void
  systems: ProySystem[]
  tipoProyecto: TipoProyecto
}) {
  const pdfContainerRef = useRef<HTMLDivElement>(null)
  const [generating, setGenerating] = useState(false)
  const systemsMap = new Map(systems.map(s => [s.id, s]))

  const includedItems = items.filter(it => it.included)
  const subtotal = includedItems.reduce((sum, it) => sum + it.m2 * it.precioM2, 0)
  const iva = Math.round(subtotal * config.ivaRate / 100 * 100) / 100
  const total = subtotal + iva

  const now = new Date()
  const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`
  const fileName = `${cotName || 'Cotizacion'}_Proyecto.pdf`

  const tipoCfg = TIPO_PROYECTO_CONFIG[tipoProyecto]

  async function generatePdf() {
    if (!pdfContainerRef.current) return
    setGenerating(true)
    try {
      const canvas = await html2canvas(pdfContainerRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: 860,
      })
      const pageW = 210
      const pageH = 297
      const contentW = pageW
      const imgW = canvas.width
      const imgH = canvas.height
      const ratio = contentW / imgW
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      let yOffset = 0
      let page = 0
      const pageHeightPx = pageH / ratio

      while (yOffset < imgH) {
        if (page > 0) doc.addPage()
        const sliceH = Math.min(pageHeightPx, imgH - yOffset)
        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = imgW
        pageCanvas.height = sliceH
        const ctx = pageCanvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, imgW, sliceH)
        ctx.drawImage(canvas, 0, yOffset, imgW, sliceH, 0, 0, imgW, sliceH)
        const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.95)
        doc.addImage(pageImgData, 'JPEG', 0, 0, contentW, sliceH * ratio)
        yOffset += sliceH
        page++
      }
      doc.save(fileName)
    } catch (err) {
      console.error('PDF generation error:', err)
      alert('Error al generar PDF.')
    } finally {
      setGenerating(false)
    }
  }

  // Build entregables rows
  const hasEntregables = includedItems.some(it => systemsMap.get(it.systemId)?.entregables.length)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 1030,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: '#141414',
          border: '1px solid #333',
          borderRadius: 16,
          padding: 24,
          width: 500,
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Propuesta PDF</div>
            <div style={{ fontSize: 11, color: tipoCfg.color }}>
              {includedItems.length} sistema(s) | ${total.toFixed(2)} MXN
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={generatePdf}
            disabled={generating}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: generating ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              border: `1px solid ${tipoCfg.color}`,
              background: tipoCfg.color + '22',
              color: tipoCfg.color,
              opacity: generating ? 0.6 : 1,
            }}
          >
            <Download size={12} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {generating ? 'Generando...' : 'Descargar PDF'}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              border: '1px solid #333',
              background: '#1a1a1a',
              color: '#ccc',
            }}
          >
            Cerrar
          </button>
        </div>
      </div>

      {/* ── Hidden container rendered off-screen for html2canvas ── */}
      <div
        ref={pdfContainerRef}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: 0,
          width: 860,
          background: '#ffffff',
          color: '#111',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          padding: '32px 48px',
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        {/* ── HEADER with logo + company info ── */}
        <div style={{ borderBottom: '2px solid #111', paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <img src={OMNIIOUS_LOGO} alt="OMNIIOUS" style={{ height: 72, width: 'auto', objectFit: 'contain' }} />
            </div>
            <div style={{ textAlign: 'right', fontSize: 9, color: '#555', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: '#111', fontSize: 11 }}>OMM Technologies SA de CV</div>
              <div>contacto@ommtechnologies.mx</div>
              <div>www.ommtechnologies.mx</div>
            </div>
          </div>
        </div>

        {/* ── TÍTULO + DATOS PROYECTO ── */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
            Propuesta de {tipoCfg.label}
          </div>
          <h1 style={{ fontSize: 18, color: '#111', marginBottom: 10, fontWeight: 600 }}>
            {cotName || `Cotización ${tipoCfg.label}`}
          </h1>
          <table style={{ width: '100%', fontSize: 10 }}>
            <tbody>
              <tr>
                <td style={{ padding: '3px 12px 3px 0', color: '#888', width: 120 }}>Fecha</td>
                <td style={{ padding: '3px 0' }}>{dateStr}</td>
                <td style={{ padding: '3px 12px 3px 0', color: '#888', width: 120 }}>Moneda</td>
                <td style={{ padding: '3px 0' }}>MXN</td>
              </tr>
              <tr>
                <td style={{ padding: '3px 12px 3px 0', color: '#888' }}>Cliente</td>
                <td style={{ padding: '3px 0', fontWeight: 600 }}>{clientName || '—'}</td>
                <td style={{ padding: '3px 12px 3px 0', color: '#888' }}>Vigencia</td>
                <td style={{ padding: '3px 0' }}>30 días</td>
              </tr>
              {projectName && (
                <tr>
                  <td style={{ padding: '3px 12px 3px 0', color: '#888' }}>Proyecto</td>
                  <td colSpan={3} style={{ padding: '3px 0' }}>{projectName}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── RESUMEN POR SISTEMA ── */}
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 13, color: '#111', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #ddd', fontWeight: 600 }}>
            Resumen por sistema
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ background: '#f5f5f5', padding: '6px 8px', textAlign: 'left', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#666', fontWeight: 600, borderBottom: '1px solid #ddd' }}>Sistema</th>
                <th style={{ background: '#f5f5f5', padding: '6px 8px', textAlign: 'right', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#666', fontWeight: 600, borderBottom: '1px solid #ddd', width: 80 }}>m²</th>
                <th style={{ background: '#f5f5f5', padding: '6px 8px', textAlign: 'right', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#666', fontWeight: 600, borderBottom: '1px solid #ddd', width: 100 }}>Precio / m²</th>
                <th style={{ background: '#f5f5f5', padding: '6px 8px', textAlign: 'right', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#666', fontWeight: 600, borderBottom: '1px solid #ddd', width: 120 }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {includedItems.map(it => {
                const system = systemsMap.get(it.systemId)
                const importe = it.m2 * it.precioM2
                return (
                  <tr key={it.id}>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #eee', fontSize: 10, fontWeight: 600, verticalAlign: 'top' }}>{system?.name || 'Sistema'}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #eee', fontSize: 10, textAlign: 'right', verticalAlign: 'top' }}>{it.m2.toFixed(2)}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #eee', fontSize: 10, textAlign: 'right', verticalAlign: 'top' }}>${it.precioM2.toFixed(2)}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #eee', fontSize: 10, textAlign: 'right', fontWeight: 500, verticalAlign: 'top' }}>${importe.toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── TOTALES ── */}
        <div style={{ marginTop: 20, marginBottom: 22, padding: '14px 0', borderTop: '2px solid #111' }}>
          <table style={{ width: '100%', fontSize: 11 }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 0', color: '#666' }}>Subtotal</td>
                <td style={{ padding: '4px 0', textAlign: 'right' }}>${subtotal.toFixed(2)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', color: '#888' }}>IVA {config.ivaRate}%</td>
                <td style={{ padding: '4px 0', textAlign: 'right', color: '#888' }}>${iva.toFixed(2)}</td>
              </tr>
              <tr>
                <td style={{ padding: '8px 0 4px 0', fontWeight: 700, fontSize: 14, color: '#111', borderTop: '1px solid #111' }}>TOTAL</td>
                <td style={{ padding: '8px 0 4px 0', textAlign: 'right', fontWeight: 700, fontSize: 14, color: '#111', borderTop: '1px solid #111' }}>${total.toFixed(2)} MXN</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── ENTREGABLES ── */}
        {hasEntregables && (
          <div style={{ marginBottom: 22 }}>
            <h2 style={{ fontSize: 13, color: '#111', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #ddd', fontWeight: 600 }}>
              Entregables de Ingeniería Ejecutiva
            </h2>
            <div style={{ fontSize: 9, color: '#888', marginBottom: 12 }}>Solamente artículos incluidos en esta cotización</div>
            {includedItems
              .filter(it => systemsMap.get(it.systemId)?.entregables.length)
              .map(it => {
                const system = systemsMap.get(it.systemId)!
                const activeEntregables = it.entregablesActivos.filter(e => system.entregables.includes(e))
                if (activeEntregables.length === 0) return null
                return (
                  <div key={it.id} style={{ marginBottom: 14 }}>
                    <div style={{ background: '#f0f0f0', padding: '6px 12px', marginBottom: 4, borderLeft: '3px solid #111', borderRadius: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#111' }}>{system.name}</span>
                    </div>
                    <div style={{ paddingLeft: 16 }}>
                      {activeEntregables.map((e, i) => (
                        <div key={i} style={{ fontSize: 10, color: '#555', lineHeight: 1.8, paddingLeft: 8, position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 0 }}>•</span>
                          {e}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
          </div>
        )}

        {/* ── CONDICIONES Y TÉRMINOS ── */}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 13, color: '#111', marginBottom: 10, paddingBottom: 4, borderBottom: '1px solid #ddd', fontWeight: 600 }}>
            Términos y condiciones
          </h2>
          <div
            style={{ fontSize: 10, color: '#555', lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: tipoCfg.conditions }}
          />
        </div>

        {/* ── FIRMA ── */}
        <div style={{ marginTop: 40, marginBottom: 20 }}>
          <div style={{ borderTop: '1px solid #111', paddingTop: 6, width: 260, fontSize: 10 }}>
            <div style={{ fontWeight: 700, color: '#111' }}>Elias Gabriel Micha Cohen</div>
            <div style={{ color: '#666' }}>Director General</div>
            <div style={{ color: '#666' }}>OMM Technologies SA de CV</div>
          </div>
        </div>

        {/* ── FOOTER ── */}
        <div style={{ marginTop: 24, paddingTop: 10, borderTop: '1px solid #ddd', fontSize: 8, color: '#999', textAlign: 'center' }}>
          OMM Technologies SA de CV · www.ommtechnologies.mx
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PROYECTO ITEM ROW
// ═══════════════════════════════════════════════════════════════════

function ProyItemRow({
  item,
  system,
  onUpdate,
  onToggleExpanded,
  expanded,
}: {
  item: ProyItem
  system: ProySystem
  onUpdate: (id: string, field: string, value: any) => void
  onToggleExpanded: (id: string) => void
  expanded: boolean
}) {
  const importe = item.m2 * item.precioM2

  return (
    <>
      <tr style={{ background: item.included ? '#141414' : '#0e0e0e' }}>
        <td style={S.td}>
          <input
            type="checkbox"
            checked={item.included}
            onChange={e => onUpdate(item.id, 'included', e.target.checked)}
            style={{ cursor: 'pointer', width: 16, height: 16 }}
          />
        </td>
        <td style={{ ...S.td, paddingLeft: 12 }}>
          <button
            onClick={() => onToggleExpanded(item.id)}
            style={{
              background: 'none',
              border: 'none',
              color: '#67E8F9',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              fontWeight: 500,
              padding: 0,
              fontFamily: 'inherit',
            }}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {system.name}
          </button>
        </td>
        <td style={S.tdR}>
          <input
            type="number"
            value={item.m2}
            step={0.1}
            min={0}
            onChange={e => onUpdate(item.id, 'm2', parseFloat(e.target.value) || 0)}
            disabled={!item.included}
            style={{
              ...S.input,
              width: 60,
              opacity: item.included ? 1 : 0.5,
            }}
          />
        </td>
        <td style={S.tdR}>
          <input
            type="number"
            value={item.precioM2}
            step={0.01}
            min={0}
            onChange={e => onUpdate(item.id, 'precioM2', parseFloat(e.target.value) || 0)}
            disabled={!item.included}
            style={{
              ...S.input,
              width: 70,
              opacity: item.included ? 1 : 0.5,
            }}
          />
        </td>
        <td style={{ ...S.td, flex: 1 }}>
          <input
            type="text"
            value={item.descripcion}
            onChange={e => onUpdate(item.id, 'descripcion', e.target.value)}
            disabled={!item.included}
            style={{
              ...S.input,
              width: '100%',
              maxWidth: 200,
              opacity: item.included ? 1 : 0.5,
            }}
          />
        </td>
        <td style={{ ...S.tdM, textAlign: 'right' }}>
          ${(importe || 0).toFixed(2)}
        </td>
      </tr>
      {expanded && item.included && system.entregables.length > 0 && (
        <tr style={{ background: '#0a0a0a' }}>
          <td colSpan={6} style={{ padding: '12px 16px' }}>
            <div style={{ marginLeft: 24 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#555', textTransform: 'uppercase', marginBottom: 8 }}>
                Entregables
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {system.entregables.map((ent, i) => (
                  <label
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      fontSize: 11,
                      color: '#ccc',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={item.entregablesActivos.includes(ent)}
                      onChange={e => {
                        const updated = e.target.checked
                          ? [...item.entregablesActivos, ent]
                          : item.entregablesActivos.filter(x => x !== ent)
                        onUpdate(item.id, 'entregablesActivos', updated)
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                    {ent}
                  </label>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY PANEL
// ═══════════════════════════════════════════════════════════════════

function ProySummary({
  items,
  config,
  onConfigChange,
  systems,
}: {
  items: ProyItem[]
  config: ProyConfig
  onConfigChange: (field: string, value: any) => void
  systems: ProySystem[]
}) {
  const includedItems = items.filter(it => it.included)
  const subtotal = includedItems.reduce((sum, it) => sum + it.m2 * it.precioM2, 0)
  const iva = Math.round(subtotal * config.ivaRate / 100 * 100) / 100
  const total = subtotal + iva

  const inputS = { ...S.input, width: 55, fontSize: 11 }

  return (
    <div>
      {/* Config */}
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: '#555',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 8,
          }}
        >
          Configuración
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#888' }}>IVA %</span>
            <input
              type="number"
              value={config.ivaRate}
              step={1}
              onChange={e => onConfigChange('ivaRate', parseFloat(e.target.value) || 0)}
              style={inputS}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#888' }}>Tipo Cambio</span>
            <input
              type="number"
              value={config.tipoCambio}
              step={0.1}
              onChange={e => onConfigChange('tipoCambio', parseFloat(e.target.value) || 20.5)}
              style={inputS}
            />
          </div>
        </div>
      </div>

      {/* Totals by system */}
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: '#F9A8D4',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 8,
          }}
        >
          Resumen por Sistema
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          {includedItems.map(it => {
            const system = systems.find(s => s.id === it.systemId)
            const importe = it.m2 * it.precioM2
            return (
              <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                <span style={{ color: '#888' }}>{system?.name || 'Sistema'}</span>
                <span style={{ color: '#ccc', fontWeight: 500 }}>${importe.toFixed(2)}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Summary */}
      <div style={{ background: '#1a141a', border: '1px solid #332233', borderRadius: 12, padding: 14 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '2px 0',
            fontSize: 11,
            marginBottom: 6,
          }}
        >
          <span style={{ color: '#888' }}>Subtotal</span>
          <span style={{ color: '#ccc' }}>${subtotal.toFixed(2)}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '2px 0',
            fontSize: 11,
            marginBottom: 6,
          }}
        >
          <span style={{ color: '#888' }}>IVA {config.ivaRate}%</span>
          <span style={{ color: '#ccc' }}>${iva.toFixed(2)}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '8px 0',
            fontSize: 13,
            fontWeight: 700,
            borderTop: '1px solid #332233',
            paddingTop: 8,
          }}
        >
          <span style={{ color: '#F9A8D4' }}>TOTAL</span>
          <span style={{ color: '#F9A8D4' }}>${total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function CotEditorProyecto({ cotId, onBack, specialty = 'proy' }: { cotId: string; onBack: () => void; specialty?: string }) {
  // tipoProyecto drives everything: systems, conditions, badge, etc.
  // Backward compat: old 'ilum' specialty → 'iluminacion', old 'proy' → 'especiales'
  const fallbackTipo: TipoProyecto = specialty === 'ilum' ? 'iluminacion' : 'especiales'
  const [tipoProyecto, setTipoProyecto] = useState<TipoProyecto>(fallbackTipo)

  const tipoCfg = TIPO_PROYECTO_CONFIG[tipoProyecto]
  const SYSTEMS = tipoCfg.systems
  const BADGE_LABEL = tipoCfg.badgeLabel
  const BADGE_COLOR = tipoCfg.color
  const TITLE_PREFIX = tipoCfg.titlePrefix

  const [items, setItems] = useState<ProyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [config, setConfig] = useState<ProyConfig>({
    currency: 'MXN',
    tipoCambio: 20.5,
    ivaRate: 16,
  })
  const [stage, setStage] = useState('oportunidad')
  const [cotName, setCotName] = useState('')
  const [clientName, setClientName] = useState('')
  const [projectName, setProjectName] = useState('')
  const [showPdf, setShowPdf] = useState(false)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [globalM2, setGlobalM2] = useState(0)
  const [showConfigGear, setShowConfigGear] = useState(false)
  const [showEditInfo, setShowEditInfo] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)

  // ── Load from DB ──
  async function load() {
    const [{ data: cot }, { data: qItems }] = await Promise.all([
      supabase
        .from('quotations')
        .select('*,project:projects!quotations_project_id_fkey(name,client_name)')
        .eq('id', cotId)
        .single(),
      supabase.from('quotation_items').select('*').eq('quotation_id', cotId).order('order_index'),
    ])

    if (cot) {
      setCotName(cot.name || '')
      setClientName(cot.client_name || '')
      setStage(cot.stage || 'oportunidad')
      setProjectId(cot.project_id || null)
      const proj = cot.project as any
      setProjectName(proj?.name || '')
      try {
        const meta = JSON.parse(cot.notes || '{}')
        if (meta.proyConfig) {
          setConfig(c => ({ ...c, ...meta.proyConfig }))
        }
        if (meta.m2Construccion && meta.m2Construccion > 0) {
          setGlobalM2(meta.m2Construccion)
        }
        if (meta.tipoProyecto && TIPO_PROYECTO_CONFIG[meta.tipoProyecto as TipoProyecto]) {
          setTipoProyecto(meta.tipoProyecto as TipoProyecto)
        }
      } catch {}
    }

    let resolvedTipo: TipoProyecto = fallbackTipo
    try {
      const meta2 = JSON.parse(cot?.notes || '{}')
      if (meta2.tipoProyecto && TIPO_PROYECTO_CONFIG[meta2.tipoProyecto as TipoProyecto]) {
        resolvedTipo = meta2.tipoProyecto as TipoProyecto
      }
    } catch {}
    const resolvedSystems = TIPO_PROYECTO_CONFIG[resolvedTipo].systems

    if (qItems && qItems.length > 0) {
      const loaded = qItems.map((it: any) => {
        let meta: any = {}
        try {
          meta = JSON.parse(it.notes || '{}')
        } catch {}
        return {
          id: it.id,
          systemId: meta.systemId || '',
          m2: meta.m2 || 0,
          precioM2: meta.precioM2 || 0,
          descripcion: meta.descripcion || '',
          entregablesActivos: meta.entregablesActivos || [],
          included: meta.included !== false,
          order: it.order_index || 0,
        } as ProyItem
      })
      setItems(loaded)
    } else {
      let initialM2 = 0
      try {
        const meta = JSON.parse(cot?.notes || '{}')
        if (meta.m2Construccion && meta.m2Construccion > 0) initialM2 = meta.m2Construccion
      } catch {}
      const newItems = resolvedSystems.map((sys, i) => ({ ...defaultItem(sys.id, i, resolvedSystems), m2: initialM2 }))
      // Get area_id for this quotation (use the first/General area)
      const { data: areaRow } = await supabase.from('quotation_areas').select('id').eq('quotation_id', cotId).limit(1).single()
      const areaId = areaRow?.id || null
      const itemsWithDbIds: ProyItem[] = []
      for (const item of newItems) {
        const { data, error } = await supabase.from('quotation_items').insert({
          quotation_id: cotId,
          area_id: areaId || null,
          system: 'General',
          type: 'material',
          name: item.descripcion,
          quantity: item.m2,
          cost: 0,
          price: item.precioM2,
          total: item.m2 * item.precioM2,
          markup: 0,
          installation_cost: 0,
          order_index: item.order,
          notes: JSON.stringify({
            systemId: item.systemId,
            m2: item.m2,
            precioM2: item.precioM2,
            descripcion: item.descripcion,
            entregablesActivos: item.entregablesActivos,
            included: item.included,
          }),
        }).select('id').single()
        if (error) console.error('Insert item error:', error)
        itemsWithDbIds.push({ ...item, id: data?.id || item.id })
      }
      setItems(itemsWithDbIds)
    }

    setLoading(false)
    setDirty(false)
  }

  useEffect(() => {
    load()
  }, [cotId])

  const grandTotal = useMemo(() => {
    const included = items.filter(it => it.included)
    const subtotal = included.reduce((sum, it) => sum + it.m2 * it.precioM2, 0)
    const iva = subtotal * config.ivaRate / 100
    return subtotal + iva
  }, [items, config])

  // ── GUARDAR TODO ── botón explícito que persiste items + config + total
  const saveAll = useCallback(async () => {
    setSaving(true)
    try {
      // 1. Save each item to DB
      const promises = items.map(it => {
        const importe = it.m2 * it.precioM2
        return supabase
          .from('quotation_items')
          .update({
            name: it.descripcion,
            quantity: it.m2,
            price: it.precioM2,
            total: importe,
            order_index: it.order,
            notes: JSON.stringify({
              systemId: it.systemId,
              m2: it.m2,
              precioM2: it.precioM2,
              descripcion: it.descripcion,
              entregablesActivos: it.entregablesActivos,
              included: it.included,
            }),
          })
          .eq('id', it.id)
      })

      // 2. Save quotation config + total
      const { data: cotData } = await supabase.from('quotations').select('notes').eq('id', cotId).single()
      let existingNotes: any = {}
      try { existingNotes = JSON.parse(cotData?.notes || '{}') } catch {}
      const quotationPromise = supabase
        .from('quotations')
        .update({
          total: Math.round(grandTotal * 100) / 100,
          notes: JSON.stringify({ ...existingNotes, proyConfig: config }),
        })
        .eq('id', cotId)

      // Execute all in parallel
      const results = await Promise.all([...promises, quotationPromise])
      const errors = results.filter(r => r.error)
      if (errors.length > 0) {
        console.error('Save errors:', errors.map(r => r.error))
        alert(`Error al guardar: ${errors.length} error(es)`)
      } else {
        setDirty(false)
        setLastSaved(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }))
      }
    } catch (err) {
      console.error('Save error:', err)
      alert('Error al guardar')
    } finally {
      setSaving(false)
    }
  }, [items, config, cotId, grandTotal])

  // Keyboard shortcut: Cmd/Ctrl + S
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        saveAll()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [saveAll])

  function updateConfig(field: string, value: any) {
    setConfig(prev => ({ ...prev, [field]: value }))
    setDirty(true)
  }

  function updateItem(id: string, field: string, value: any) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
    setDirty(true)
  }

  function setGlobalM2Value(val: number) {
    setGlobalM2(val)
    setItems(prev => prev.map(it => ({ ...it, m2: val })))
    setDirty(true)
  }

  function toggleExpanded(id: string) {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (loading) return <Loading />

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <div
        style={{
          padding: '7px 16px',
          borderBottom: '1px solid #222',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
          background: '#111',
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
          }}
        >
          <ChevronLeft size={14} /> Cotizaciones
        </button>
        <span style={{ color: '#333' }}>/</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: BADGE_COLOR }}>
          {String.fromCodePoint(0x25A6)} {cotName || `Cotización ${tipoCfg.label}`}
        </span>
        <Badge label={BADGE_LABEL} color={BADGE_COLOR} />
        {clientName && <span style={{ fontSize: 11, color: '#888' }}>{clientName}</span>}
        {projectName && <span style={{ fontSize: 10, color: '#555' }}>| {projectName}</span>}
        <button onClick={() => setShowEditInfo(true)} style={{background:'none',border:'none',color:'#555',cursor:'pointer',padding:2,display:'flex',alignItems:'center'}} title="Editar info"><Pencil size={12}/></button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {(Object.entries(STAGE_CONFIG) as Array<[string, { label: string; color: string }]>).map(([s, cfg]) => (
            <button
              key={s}
              onClick={async () => {
                setStage(s)
                await supabase.from('quotations').update({ stage: s }).eq('id', cotId)
                // Auto-create project when moving to 'contrato'
                if (s === 'contrato') {
                  const projId = await autoCreateProjectFromQuotation(cotId)
                  if (projId) {
                    alert('✅ Proyecto creado automáticamente en la sección de Proyectos.')
                  }
                }
              }}
              style={{
                padding: '3px 10px',
                borderRadius: 20,
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                border: '1px solid ' + (stage === s ? cfg.color : '#333'),
                background: stage === s ? cfg.color + '22' : 'transparent',
                color: stage === s ? cfg.color : '#555',
              }}
            >
              {cfg.label}
            </button>
          ))}
          <button
            onClick={saveAll}
            disabled={saving}
            style={{
              padding: '3px 12px',
              borderRadius: 20,
              fontSize: 10,
              fontWeight: 600,
              cursor: saving ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              border: dirty ? '1px solid #57FF9A' : '1px solid #333',
              background: dirty ? '#57FF9A22' : 'transparent',
              color: dirty ? '#57FF9A' : '#555',
              marginLeft: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              opacity: saving ? 0.6 : 1,
              transition: 'all 0.2s',
            }}
          >
            {saving ? (
              <><Save size={12} /> Guardando...</>
            ) : dirty ? (
              <><Save size={12} /> Guardar</>
            ) : (
              <><Check size={12} /> Guardado</>
            )}
          </button>
          {lastSaved && !dirty && (
            <span style={{ fontSize: 9, color: '#555' }}>{lastSaved}</span>
          )}
          <button
            onClick={() => { if (dirty) { saveAll().then(() => setShowPdf(true)) } else { setShowPdf(true) } }}
            style={{
              padding: '3px 10px',
              borderRadius: 20,
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              border: `1px solid ${BADGE_COLOR}`,
              background: BADGE_COLOR + '22',
              color: BADGE_COLOR,
              marginLeft: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Printer size={12} /> Propuesta
          </button>
          <span style={{ fontSize: 15, fontWeight: 700, color: BADGE_COLOR, marginLeft: 10 }}>
            ${grandTotal.toFixed(2)}
          </span>
          <div style={{ position: 'relative', marginLeft: 8 }}>
            <button
              onClick={() => setShowConfigGear(!showConfigGear)}
              style={{
                background: 'none',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Settings size={16} />
            </button>
            {showConfigGear && (
              <div
                style={{
                  position: 'absolute',
                  top: 24,
                  right: 0,
                  background: '#141414',
                  border: '1px solid #333',
                  borderRadius: 8,
                  padding: 12,
                  minWidth: 200,
                  zIndex: 100,
                }}
              >
                <button
                  onClick={() => setShowConfigGear(false)}
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    background: 'none',
                    border: 'none',
                    color: '#666',
                    cursor: 'pointer',
                  }}
                >
                  <X size={14} />
                </button>
                <div style={{ fontSize: 10, color: '#555', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>
                  Configuración
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Global m² bar */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid #1e1e1e',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#0e0e0e',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>m² Global (aplica a todos):</span>
        <input
          type="number"
          value={globalM2}
          step={0.1}
          min={0}
          onChange={e => setGlobalM2Value(parseFloat(e.target.value) || 0)}
          style={{
            ...S.input,
            width: 80,
          }}
        />
        <span style={{ fontSize: 10, color: '#555' }}>m²</span>
      </div>

      {/* Content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', flex: 1, overflow: 'hidden' }}>
        <div style={{ overflowY: 'auto', overflowX: 'auto', padding: '14px 18px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ background: '#0e0e0e' }}>
                <th style={{ ...S.th, width: 30 }}>✓</th>
                <th style={{ ...S.th, textAlign: 'left', flex: 1 }}>Sistema</th>
                <th style={{ ...S.th, textAlign: 'right' }}>m²</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Precio/m²</th>
                <th style={{ ...S.th, textAlign: 'left' }}>Descripción</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Importe</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const system = SYSTEMS.find(s => s.id === item.systemId)!
                return (
                  <ProyItemRow
                    key={item.id}
                    item={item}
                    system={system}
                    onUpdate={updateItem}
                    onToggleExpanded={toggleExpanded}
                    expanded={expandedItems.has(item.id)}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ borderLeft: '1px solid #222', overflowY: 'auto', padding: '14px 10px', background: '#0e0e0e' }}>
          <ProySummary items={items} config={config} onConfigChange={updateConfig} systems={SYSTEMS} />
        </div>
      </div>

      {/* PDF modal */}
      {showPdf && (
        <ProyPdfModal
          items={items}
          config={config}
          cotName={cotName}
          clientName={clientName}
          projectName={projectName}
          onClose={() => setShowPdf(false)}
          systems={SYSTEMS}
          tipoProyecto={tipoProyecto}
        />
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
