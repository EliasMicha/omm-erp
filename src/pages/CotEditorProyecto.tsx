import React, { useState, useMemo, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { F, STAGE_CONFIG } from '../lib/utils'
import { Badge, Btn, Loading } from '../components/layout/UI'
import { ChevronLeft, ChevronDown, ChevronRight, Settings, X, Printer } from 'lucide-react'
import { OMNIIOUS_LOGO } from '../assets/logo'

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
  {
    id: 'ing_electrica',
    name: 'Ingeniería Eléctrica',
    defaultPrecioM2: 10,
    defaultDesc: 'Proyecto de Ingeniería Eléctrica',
    entregables: [
      'Diagrama unifilar',
      'Cuadro de cargas',
      'Canalización y circuitos',
      'Especificaciones técnicas'
    ]
  },
  {
    id: 'diseno_iluminacion',
    name: 'Diseño de Iluminación',
    defaultPrecioM2: 60,
    defaultDesc: 'Proyecto de Diseño de Iluminación',
    entregables: [
      'Sembrado de luminarias',
      'Cálculos luminotécnicos',
      'Especificaciones de luminarias',
      'Criterios de diseño'
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
  specialty,
}: {
  items: ProyItem[]
  config: ProyConfig
  cotName: string
  clientName: string
  projectName: string
  onClose: () => void
  systems: ProySystem[]
  specialty: string
}) {
  const systemsMap = new Map(systems.map(s => [s.id, s]))

  const includedItems = items.filter(it => it.included)
  const subtotal = includedItems.reduce((sum, it) => sum + it.m2 * it.precioM2, 0)
  const iva = Math.round(subtotal * config.ivaRate / 100 * 100) / 100
  const total = subtotal + iva

  const now = new Date()
  const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`

  const pdf = `
    <html>
      <head>
        <title>Cotización Proyecto</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #fff; color: #333; }
          .page { page-break-after: always; margin-bottom: 40px; }
          .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
          .logo { font-weight: bold; font-size: 18px; }
          .header-info { text-align: right; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          thead { background: #f0f0f0; }
          th { text-align: left; padding: 8px; font-weight: bold; border-bottom: 1px solid #999; font-size: 11px; }
          td { padding: 8px; border-bottom: 1px solid #ddd; font-size: 11px; }
          .text-right { text-align: right; }
          .text-bold { font-weight: bold; }
          .summary { display: flex; justify-content: flex-end; margin-top: 20px; }
          .summary-table { width: 200px; }
          .summary-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 12px; }
          .summary-total { display: flex; justify-content: space-between; padding: 8px 0; font-weight: bold; font-size: 13px; border-top: 2px solid #333; }
          h2 { font-size: 14px; margin-top: 30px; margin-bottom: 15px; border-bottom: 1px solid #999; padding-bottom: 8px; }
          .entregables-table { width: 100%; border-collapse: collapse; }
          .entregables-table th { background: #f0f0f0; padding: 8px; text-align: left; font-weight: bold; border: 1px solid #999; font-size: 10px; }
          .entregables-table td { padding: 8px; border: 1px solid #ddd; font-size: 10px; }
          .section-title { font-weight: bold; margin-top: 20px; margin-bottom: 10px; font-size: 12px; }
          .section-text { font-size: 11px; line-height: 1.6; margin-bottom: 12px; }
        </style>
      </head>
      <body>
        <!-- PAGE 1: QUOTATION -->
        <div class="page">
          <div class="header">
            <div class="logo">OMM</div>
            <div class="header-info">
              <div><strong>Cotización</strong></div>
              <div>${cotName}</div>
              <div>${dateStr}</div>
            </div>
          </div>
          <div style="margin-bottom: 20px;">
            <div><strong>Cliente:</strong> ${clientName || '---'}</div>
            <div><strong>Proyecto:</strong> ${projectName || '---'}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>DESCRIPCIÓN</th>
                <th class="text-right">CANTIDAD (m²)</th>
                <th class="text-right">PRECIO UNITARIO</th>
                <th class="text-right">IMPUESTOS</th>
                <th class="text-right">IMPORTE</th>
              </tr>
            </thead>
            <tbody>
              ${includedItems
                .map(it => {
                  const system = systemsMap.get(it.systemId)
                  const importe = it.m2 * it.precioM2
                  const impuesto = Math.round(importe * config.ivaRate / 100 * 100) / 100
                  return `
                    <tr>
                      <td>${system?.name || 'Sistema'}</td>
                      <td class="text-right">${it.m2.toFixed(2)}</td>
                      <td class="text-right">$${it.precioM2.toFixed(2)}</td>
                      <td class="text-right">$${impuesto.toFixed(2)}</td>
                      <td class="text-right">$${(importe + impuesto).toFixed(2)}</td>
                    </tr>
                  `
                })
                .join('')}
            </tbody>
          </table>
          <div class="summary">
            <div class="summary-table">
              <div class="summary-row">
                <span>Subtotal</span>
                <span>$${subtotal.toFixed(2)}</span>
              </div>
              <div class="summary-row">
                <span>IVA ${config.ivaRate}%</span>
                <span>$${iva.toFixed(2)}</span>
              </div>
              <div class="summary-total">
                <span>TOTAL</span>
                <span>$${total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- PAGE 2+: ENTREGABLES -->
        ${
          includedItems.some(it => systemsMap.get(it.systemId)?.entregables.length)
            ? `
          <div class="page">
            <h2>Entregables de Proyecto (Ingeniería Ejecutiva)</h2>
            <p style="font-size: 11px; color: #666; margin-bottom: 15px;">Solamente artículos solicitados en cotización</p>
            <table class="entregables-table">
              <thead>
                <tr>
                  <th>SISTEMA</th>
                  <th>ENTREGABLES INCLUIDOS EN INGENIERÍA EJECUTIVA</th>
                </tr>
              </thead>
              <tbody>
                ${includedItems
                  .filter(it => systemsMap.get(it.systemId)?.entregables.length)
                  .map(it => {
                    const system = systemsMap.get(it.systemId)!
                    const activeEntregables = it.entregablesActivos
                      .filter(e => system.entregables.includes(e))
                      .map(e => `• ${e}`)
                      .join('<br/>')
                    return `
                      <tr>
                        <td><strong>${system.name}</strong></td>
                        <td>${activeEntregables || '(ninguno)'}</td>
                      </tr>
                    `
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
            `
            : ''
        }

        <!-- PAGE 3+: SCOPE & TERMS -->
        <div class="page">
          ${specialty === 'ilum' ? ILUM_PDF_CONDITIONS : PROY_PDF_CONDITIONS}
        </div>
      </body>
    </html>
  `

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
            <div style={{ fontSize: 11, color: '#F9A8D4' }}>
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
            onClick={() => {
              const win = window.open()
              if (win) {
                win.document.write(pdf)
                win.document.close()
              }
            }}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              border: '1px solid #F9A8D4',
              background: '#F9A8D422',
              color: '#F9A8D4',
            }}
          >
            <Printer size={12} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Ver PDF
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
}: {
  items: ProyItem[]
  config: ProyConfig
  onConfigChange: (field: string, value: any) => void
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
            const system = SYSTEMS.find(s => s.id === it.systemId)
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
  const SYSTEMS = specialty === 'ilum' ? ILUM_SYSTEMS : PROYECTO_SYSTEMS
  const BADGE_LABEL = specialty === 'ilum' ? 'ILUM' : 'PROY'
  const BADGE_COLOR = specialty === 'ilum' ? '#C084FC' : '#F9A8D4'
  const TITLE_PREFIX = specialty === 'ilum' ? 'DISEÑO DE ILUMINACIÓN' : 'PROYECTO DE INGENIERÍA'
  const [items, setItems] = useState<ProyItem[]>([])
  const [loading, setLoading] = useState(true)
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
      } catch {}
    }

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
      // Auto-populate with all systems — use m2Construccion from notes if available
      let initialM2 = 0
      try {
        const meta = JSON.parse(cot?.notes || '{}')
        if (meta.m2Construccion && meta.m2Construccion > 0) initialM2 = meta.m2Construccion
      } catch {}
      const newItems = SYSTEMS.map((sys, i) => ({ ...defaultItem(sys.id, i, SYSTEMS), m2: initialM2 }))
      setItems(newItems)
      // Insert them into DB
      for (const item of newItems) {
        await insertItem(item)
      }
    }

    setLoading(false)
  }

  async function insertItem(item: ProyItem) {
    await supabase.from('quotation_items').insert({
      quotation_id: cotId,
      system: 'Proyecto',
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
    })
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

  // Sync total to DB
  useEffect(() => {
    if (!loading && cotId) {
      supabase.from('quotations').update({ total: Math.round(grandTotal * 100) / 100 }).eq('id', cotId)
    }
  }, [grandTotal, loading, cotId])

  function updateConfig(field: string, value: any) {
    const next = { ...config, [field]: value }
    setConfig(next)
    supabase
      .from('quotations')
      .update({ notes: JSON.stringify({ proyConfig: next }) })
      .eq('id', cotId)
  }

  function updateItem(id: string, field: string, value: any) {
    setItems(prev => {
      const next = prev.map(it =>
        it.id === id ? { ...it, [field]: value } : it
      )
      const updated = next.find(it => it.id === id)
      if (updated) {
        const importe = updated.m2 * updated.precioM2
        supabase
          .from('quotation_items')
          .update({
            name: updated.descripcion,
            quantity: updated.m2,
            price: updated.precioM2,
            total: importe,
            notes: JSON.stringify({
              systemId: updated.systemId,
              m2: updated.m2,
              precioM2: updated.precioM2,
              descripcion: updated.descripcion,
              entregablesActivos: updated.entregablesActivos,
              included: updated.included,
            }),
          })
          .eq('id', id)
      }
      return next
    })
  }

  function setGlobalM2Value(val: number) {
    setGlobalM2(val)
    setItems(prev =>
      prev.map(it => ({ ...it, m2: val }))
    )
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
          {String.fromCodePoint(0x25A6)} {cotName || (specialty === 'ilum' ? 'Cotización Iluminación' : 'Cotización Proyecto')}
        </span>
        <Badge label={BADGE_LABEL} color={BADGE_COLOR} />
        {clientName && <span style={{ fontSize: 11, color: '#888' }}>{clientName}</span>}
        {projectName && <span style={{ fontSize: 10, color: '#555' }}>| {projectName}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {(Object.entries(STAGE_CONFIG) as Array<[string, { label: string; color: string }]>).map(([s, cfg]) => (
            <button
              key={s}
              onClick={() => {
                setStage(s)
                supabase.from('quotations').update({ stage: s }).eq('id', cotId)
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
            onClick={() => setShowPdf(true)}
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
          <ProySummary items={items} config={config} onConfigChange={updateConfig} />
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
          specialty={specialty}
        />
      )}
    </div>
  )
}
