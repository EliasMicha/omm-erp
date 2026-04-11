import React, { useState, useRef, useEffect } from 'react'
import { MOCK_CLIENTES } from './Clientes'
import type { ClienteFiscal } from './Clientes'
import { supabase } from '../lib/supabase'
import { SectionHeader, KpiCard, Table, Th, Td, Badge, Btn, EmptyState } from '../components/layout/UI'
import { F, formatDate } from '../lib/utils'
import {
  FileText, Building2, ArrowLeftRight, ShieldCheck,
  Banknote, Users, TrendingUp, Plus, Upload, Search,
  ChevronRight, AlertTriangle, CheckCircle, Clock,
  DollarSign, FolderOpen, Eye, X, Loader2
} from 'lucide-react'

/* --------- Types ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ */

type Tab = 'facturacion' | 'conciliacion' | 'supervision' | 'efectivo' | 'cobranza' | 'flujo'

type InvoiceDirection = 'emitida' | 'recibida'
type InvoiceStatus = 'borrador' | 'timbrada' | 'enviada' | 'pagada' | 'cancelada' | 'error'
type CfdiType = 'I' | 'E' | 'T' | 'P' | 'N'

interface Concepto {
  clave_prod_serv: string
  cantidad: number
  clave_unidad: string
  unidad: string
  descripcion: string
  valor_unitario: number
  importe: number
}

interface Invoice {
  id: string
  direccion: InvoiceDirection
  serie: string
  folio: string
  tipo_comprobante: CfdiType
  receptor_nombre: string
  emisor_nombre: string
  total: number
  estado: InvoiceStatus
  fecha_emision: string
  proyecto_nombre?: string
  conciliada: boolean
  metodo_pago?: string
  uuid?: string
  uuid_relacionado?: string
  subtotal?: number
  iva?: number
  moneda?: string
  forma_pago?: string
  emisor_rfc?: string
  emisor_regimen?: string
  receptor_rfc?: string
  receptor_regimen?: string
  receptor_uso_cfdi?: string
  receptor_cp?: string
  conceptos?: Concepto[]
}

interface CashMovement {
  id: string
  tipo: 'cobro_cliente' | 'pago_proveedor' | 'nomina_efectivo'
  direccion: 'ingreso' | 'egreso'
  persona: string
  concepto: string
  monto: number
  fecha: string
  proyecto_nombre?: string
}

interface Sale {
  id: string
  referencia: string
  cliente_nombre: string
  proyecto_nombre: string
  monto_total: number
  monto_cobrado_total: number
  monto_facturado: number
  monto_pendiente: number
  porcentaje_cobrado: number
}

interface ProjectAccount {
  proyecto_nombre: string
  venta_total: number
  ingreso_total: number
  egreso_total: number
  utilidad: number
  margen: number
  por_cobrar: number
  por_pagar: number
}

interface BankMovement {
  id: string; fecha: string; concepto: string; referencia: string
  monto: number; tipo: 'cargo' | 'abono'; saldo: number
  categoria_sugerida?: string; proyecto_sugerido?: string; conciliado: boolean
  beneficiario?: string; factura_match_id?: string; factura_match_info?: string
  rfc_contraparte?: string; proyecto_codigo?: string; banco?: string; cuenta?: string
  // Conciliación v2 - campos nuevos
  moneda?: 'MXN' | 'USD'
  saldo_posterior?: number
  proveedor?: string; cliente?: string
  uuid_factura?: string; folio_serie?: string; uso_cfdi?: string; observaciones?: string
  confianza_autodetect?: 'alta' | 'media' | 'baja' | 'manual'
  traspaso_usd_monto?: number; traspaso_pair_id?: string
  folio_spei?: string; clabe_contraparte?: string
  source?: 'pdf-monthly' | 'txt-tabular' | 'manual' | 'excel-import'
}

/* --------- Config --------------------------------------------------------------------------------------------------------------------------------------------------------------------- */

const TABS: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'facturacion', label: 'Facturacion', icon: FileText },
  { key: 'conciliacion', label: 'Conciliacion', icon: ArrowLeftRight },
  { key: 'supervision', label: 'Supervision', icon: ShieldCheck },
  { key: 'efectivo', label: 'Efectivo', icon: Banknote },
  { key: 'cobranza', label: 'Cobranza', icon: DollarSign },
  { key: 'flujo', label: 'Flujo de efectivo', icon: TrendingUp },
]

const INVOICE_STATUS_CONFIG: Record<InvoiceStatus, { label: string; color: string }> = {
  borrador: { label: 'Borrador', color: '#6B7280' },
  timbrada: { label: 'Timbrada', color: '#3B82F6' },
  enviada: { label: 'Enviada', color: '#8B5CF6' },
  pagada: { label: 'Pagada', color: '#57FF9A' },
  cancelada: { label: 'Cancelada', color: '#EF4444' },
  error: { label: 'Error', color: '#F59E0B' },
}

const CFDI_TYPE_LABELS: Record<CfdiType, string> = {
  I: 'Ingreso', E: 'Egreso', T: 'Traslado', P: 'Pago', N: 'Nomina'
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 16, padding: 24, minWidth: 500, maxWidth: 700, maxHeight: '80vh', overflowY: 'auto' as const }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 500 }}>{label}</div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #333',
  borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box' as const,
}
const selectStyle: React.CSSProperties = { ...inputStyle }

/* --------- Mock Data ------------------------------------------------------------------------------------------------------------------------------------------------------------ */

const MOCK_INVOICES: Invoice[] = [
  { id: '1', direccion: 'emitida', serie: 'FAC', folio: '001', tipo_comprobante: 'I', receptor_nombre: 'Alex Niz', emisor_nombre: 'OMM Technologies', total: 116000, estado: 'timbrada', fecha_emision: '2026-04-03', proyecto_nombre: 'Oasis', conciliada: false, metodo_pago: 'PPD' },
  { id: '2', direccion: 'emitida', serie: 'FAC', folio: '002', tipo_comprobante: 'I', receptor_nombre: 'Grupo Inmobiliario', emisor_nombre: 'OMM Technologies', total: 290000, estado: 'pagada', fecha_emision: '2026-04-01', proyecto_nombre: 'Reforma 222', conciliada: true, metodo_pago: 'PUE' },
  { id: '3', direccion: 'emitida', serie: 'NC', folio: '001', tipo_comprobante: 'E', receptor_nombre: 'Alex Niz', emisor_nombre: 'OMM Technologies', total: 16000, estado: 'timbrada', fecha_emision: '2026-04-02', proyecto_nombre: 'Oasis', conciliada: false },
  { id: '4', direccion: 'emitida', serie: 'PAG', folio: '001', tipo_comprobante: 'P', receptor_nombre: 'Oasis SA', emisor_nombre: 'OMM Technologies', total: 145000, estado: 'timbrada', fecha_emision: '2026-03-28', proyecto_nombre: 'Oasis', conciliada: true },
  { id: '5', direccion: 'recibida', serie: '', folio: 'A-4521', tipo_comprobante: 'I', receptor_nombre: 'OMM Technologies', emisor_nombre: 'Electricos del Centro', total: 23456, estado: 'timbrada', fecha_emision: '2026-04-01', proyecto_nombre: 'Oasis', conciliada: false },
  { id: '6', direccion: 'recibida', serie: '', folio: 'B-892', tipo_comprobante: 'I', receptor_nombre: 'OMM Technologies', emisor_nombre: 'Ferreteria Diaz', total: 8200, estado: 'timbrada', fecha_emision: '2026-03-30', proyecto_nombre: 'Pachuca', conciliada: false },
]

const MOCK_CASH: CashMovement[] = [
  { id: '1', tipo: 'cobro_cliente', direccion: 'ingreso', persona: 'Alex Niz', concepto: 'Pago parcial obra Oasis', monto: 50000, fecha: '2026-03-29', proyecto_nombre: 'Oasis' },
  { id: '2', tipo: 'cobro_cliente', direccion: 'ingreso', persona: 'Grupo Inmobiliario', concepto: 'Adelanto Reforma', monto: 85000, fecha: '2026-04-01', proyecto_nombre: 'Reforma 222' },
  { id: '3', tipo: 'pago_proveedor', direccion: 'egreso', persona: 'Ferreteria Diaz', concepto: 'Material menor', monto: 8500, fecha: '2026-04-01', proyecto_nombre: 'Pachuca' },
  { id: '4', tipo: 'nomina_efectivo', direccion: 'egreso', persona: 'Ricardo Flores', concepto: 'Semana 14 efectivo', monto: 12000, fecha: '2026-04-02' },
  { id: '5', tipo: 'nomina_efectivo', direccion: 'egreso', persona: 'Juan Pablo', concepto: 'Semana 14 efectivo', monto: 12000, fecha: '2026-04-02' },
  { id: '6', tipo: 'nomina_efectivo', direccion: 'egreso', persona: 'Alfredo Rosas', concepto: 'Semana 14 efectivo', monto: 12000, fecha: '2026-03-31' },
]

const MOCK_SALES: Sale[] = [
  { id: '1', referencia: 'COT-2024-045', cliente_nombre: 'Alex Niz', proyecto_nombre: 'Oasis', monto_total: 490000, monto_cobrado_total: 200000, monto_facturado: 290000, monto_pendiente: 290000, porcentaje_cobrado: 41 },
  { id: '2', referencia: 'COT-2024-038', cliente_nombre: 'Grupo Inmobiliario', proyecto_nombre: 'Reforma 222', monto_total: 850000, monto_cobrado_total: 600000, monto_facturado: 600000, monto_pendiente: 250000, porcentaje_cobrado: 71 },
  { id: '3', referencia: 'COT-2024-051', cliente_nombre: 'Desarrollos Pachuca', proyecto_nombre: 'Pachuca', monto_total: 320000, monto_cobrado_total: 80000, monto_facturado: 160000, monto_pendiente: 240000, porcentaje_cobrado: 25 },
  { id: '4', referencia: 'COT-2024-033', cliente_nombre: 'Chapultepec Desarrollo', proyecto_nombre: 'Chapultepec Uno', monto_total: 680000, monto_cobrado_total: 400000, monto_facturado: 680000, monto_pendiente: 280000, porcentaje_cobrado: 59 },
  { id: '5', referencia: 'COT-2025-002', cliente_nombre: 'Alex Niz', proyecto_nombre: 'Oasis 6', monto_total: 500000, monto_cobrado_total: 320000, monto_facturado: 0, monto_pendiente: 180000, porcentaje_cobrado: 64 },
]

const MOCK_PROJECT_ACCOUNTS: ProjectAccount[] = [
  { proyecto_nombre: 'Oasis', venta_total: 490000, ingreso_total: 200000, egreso_total: 145000, utilidad: 55000, margen: 28, por_cobrar: 290000, por_pagar: 46200 },
  { proyecto_nombre: 'Reforma 222', venta_total: 850000, ingreso_total: 600000, egreso_total: 380000, utilidad: 220000, margen: 37, por_cobrar: 250000, por_pagar: 32000 },
  { proyecto_nombre: 'Pachuca', venta_total: 320000, ingreso_total: 80000, egreso_total: 95000, utilidad: -15000, margen: -19, por_cobrar: 240000, por_pagar: 18000 },
  { proyecto_nombre: 'Chapultepec Uno', venta_total: 680000, ingreso_total: 400000, egreso_total: 310000, utilidad: 90000, margen: 23, por_cobrar: 280000, por_pagar: 0 },
  { proyecto_nombre: 'Oasis 6', venta_total: 500000, ingreso_total: 320000, egreso_total: 48000, utilidad: 272000, margen: 85, por_cobrar: 180000, por_pagar: 12000 },
]

/* --------- Main Page ------------------------------------------------------------------------------------------------------------------------------------------------------------ */

export default function Contabilidad() {
  const [activeTab, setActiveTab] = useState<Tab>('facturacion')
  const [invoices, setInvoices] = useState<Invoice[]>(MOCK_INVOICES)
  const [bankMovements, setBankMovements] = useState<BankMovement[]>([])
  const [projectNames, setProjectNames] = useState<string[]>([])

  // Load bank movements from Supabase
  useEffect(() => {
    supabase.from('bank_movements').select('*').order('fecha', { ascending: false }).then(({ data }) => {
      if (data && data.length > 0) {
        setBankMovements(data.map((m: any) => ({
          id: m.id,
          fecha: m.fecha || '',
          concepto: m.concepto || '',
          referencia: m.referencia || '',
          monto: Number(m.monto) || 0,
          tipo: m.tipo || 'cargo',
          saldo: Number(m.saldo) || 0,
          categoria_sugerida: m.categoria || 'otro',
          proyecto_sugerido: m.proyecto || '',
          beneficiario: m.beneficiario || '',
          conciliado: m.conciliado || false,
          factura_match_id: m.factura_match_id || undefined,
          factura_match_info: m.factura_match_info || '',
          rfc_contraparte: m.rfc_contraparte || '',
          proyecto_codigo: m.proyecto_codigo || '',
          banco: m.banco || '',
          cuenta: m.cuenta || '',
        })))
      }
    })
  }, [])

  // Load real project names from Supabase (para el dropdown de manual entry)
  useEffect(() => {
    supabase.from('projects').select('name').order('name').then(({ data }) => {
      if (data && data.length > 0) {
        setProjectNames(data.map((p: any) => p.name).filter(Boolean))
      }
    })
  }, [])

  // Load facturas from Supabase
  useEffect(() => {
    const loadFacturas = async () => {
      const { data } = await supabase.from('facturas').select('*, factura_conceptos(*)').order('created_at', { ascending: false })
      if (data && data.length > 0) {
        setInvoices(data.map((f: any) => ({
          id: f.id,
          direccion: f.direccion || 'emitida',
          serie: f.serie || '',
          folio: f.folio || '',
          tipo_comprobante: f.tipo_comprobante || 'I',
          receptor_nombre: f.receptor_nombre || '',
          emisor_nombre: f.emisor_nombre || '',
          total: Number(f.total) || 0,
          estado: f.estado || 'borrador',
          fecha_emision: f.fecha_emision ? f.fecha_emision.substring(0,10) : '',
          proyecto_nombre: f.proyecto_nombre || '',
          conciliada: f.conciliada || false,
          metodo_pago: f.metodo_pago || '',
          uuid: f.uuid_fiscal || '',
          subtotal: Number(f.subtotal) || 0,
          iva: Number(f.iva) || 0,
          moneda: f.moneda || 'MXN',
          forma_pago: f.forma_pago || '',
          emisor_rfc: f.emisor_rfc || '',
          emisor_regimen: f.emisor_regimen_fiscal || '',
          receptor_rfc: f.receptor_rfc || '',
          receptor_regimen: f.receptor_regimen_fiscal || '',
          receptor_uso_cfdi: f.receptor_uso_cfdi || '',
          receptor_cp: f.receptor_domicilio_fiscal || '',
          conceptos: (f.factura_conceptos || []).map((cp: any) => ({
            clave_prod_serv: cp.clave_prod_serv || '',
            cantidad: Number(cp.cantidad) || 0,
            clave_unidad: cp.clave_unidad || '',
            unidad: cp.unidad || '',
            descripcion: cp.descripcion || '',
            valor_unitario: Number(cp.valor_unitario) || 0,
            importe: Number(cp.importe) || 0,
          })),
        })))
      }
    }
    loadFacturas()
  }, [])

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200 }}>
      <SectionHeader
        title="Contabilidad"
        subtitle="Facturacion, conciliacion, cobranza y flujo de efectivo"
      />

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 24,
        borderBottom: '1px solid #222', paddingBottom: 0,
      }}>
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = activeTab === key
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', fontSize: 12, fontWeight: active ? 600 : 400,
                color: active ? '#57FF9A' : '#666',
                background: active ? 'rgba(87,255,154,0.08)' : 'transparent',
                border: 'none', borderBottom: active ? '2px solid #57FF9A' : '2px solid transparent',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.12s', borderRadius: '8px 8px 0 0',
              }}
            >
              <Icon size={13} />
              {label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'facturacion' && <TabFacturacion invoices={invoices} setInvoices={setInvoices} bankMovements={bankMovements} projectNames={projectNames} />}
      {activeTab === 'conciliacion' && <TabConciliacion bankMovements={bankMovements} setBankMovements={setBankMovements} invoices={invoices} projectNames={projectNames} />}
      {activeTab === 'supervision' && <TabSupervision invoices={invoices} />}
      {activeTab === 'efectivo' && <TabEfectivo />}
      {activeTab === 'cobranza' && <TabCobranza />}
      {activeTab === 'flujo' && <TabFlujo />}
    </div>
  )
}

/* --------- Tab 1: Facturaci--n --------------------------------------------------------------------------------------------------------------------------------- */

function TabFacturacion({ invoices, setInvoices, bankMovements, projectNames }: { invoices: Invoice[]; setInvoices: (i: Invoice[]) => void; bankMovements: BankMovement[]; projectNames: string[] }) {
  const [filter, setFilter] = useState<'todas' | 'emitidas' | 'recibidas'>('todas')
  const [search, setSearch] = useState('')
  const [monthOffset, setMonthOffset] = useState(0) // 0 = mes actual, -1 = mes pasado, +1 = siguiente
  const [showNewForm, setShowNewForm] = useState(false)
  const [xmlProcessing, setXmlProcessing] = useState(false)
  const [xmlResult, setXmlResult] = useState<string | null>(null)
  const xmlInputRef = useRef<HTMLInputElement>(null)
  const [newConceptos, setNewConceptos] = useState<Concepto[]>([])
  const addConcepto = () => setNewConceptos([...newConceptos, { clave_prod_serv: '', cantidad: 1, clave_unidad: 'E48', unidad: 'Servicio', descripcion: '', valor_unitario: 0, importe: 0 }])
  const updateConcepto = (i: number, field: string, val: string | number) => {
    const updated = [...newConceptos]
    const cp = { ...updated[i], [field]: val } as Concepto
    if (field === 'cantidad' || field === 'valor_unitario') cp.importe = Math.round(cp.cantidad * cp.valor_unitario * 100) / 100
    updated[i] = cp
    setNewConceptos(updated)
  }
  const removeConcepto = (i: number) => setNewConceptos(newConceptos.filter((_, idx) => idx !== i))
  const conceptosSubtotal = newConceptos.reduce((s, cp) => s + cp.importe, 0)
  const conceptosIva = Math.round(conceptosSubtotal * 0.16 * 100) / 100
  const conceptosTotal = conceptosSubtotal + conceptosIva
  const [selectedInv, setSelectedInv] = useState<Invoice | null>(null)
  const [newInv, setNewInv] = useState({ direccion: 'emitida' as InvoiceDirection, serie: 'FAC', folio: '', tipo_comprobante: 'I' as CfdiType, receptor_nombre: '', emisor_nombre: 'OMM Technologies SA de CV', cliente_id: '', rfc_receptor: '', regimen_receptor: '', cp_receptor: '', uso_cfdi: '', total: '', fecha_emision: new Date().toISOString().split('T')[0], proyecto_nombre: '', metodo_pago: 'PUE' })

  const handleXml = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setXmlProcessing(true)
    try {
      const text = await file.text()
      const parser = new DOMParser()
      const xml = parser.parseFromString(text, 'text/xml')
      const ns = 'http://www.sat.gob.mx/cfd/4'
      const tfdNs = 'http://www.sat.gob.mx/TimbreFiscalDigital'
      const comp = xml.getElementsByTagNameNS(ns, 'Comprobante')[0] || xml.documentElement
      const emisor = xml.getElementsByTagNameNS(ns, 'Emisor')[0]
      const receptor = xml.getElementsByTagNameNS(ns, 'Receptor')[0]
      const timbre = xml.getElementsByTagNameNS(tfdNs, 'TimbreFiscalDigital')[0]
      const conceptosNodes = xml.getElementsByTagNameNS(ns, 'Concepto')
      const conceptos: any[] = []
      for (let i = 0; i < conceptosNodes.length; i++) {
        const cn = conceptosNodes[i]
        conceptos.push({
          clave_prod_serv: cn.getAttribute('ClaveProdServ') || '',
          cantidad: parseFloat(cn.getAttribute('Cantidad') || '0'),
          clave_unidad: cn.getAttribute('ClaveUnidad') || '',
          unidad: cn.getAttribute('Unidad') || '',
          descripcion: cn.getAttribute('Descripcion') || '',
          valor_unitario: parseFloat(cn.getAttribute('ValorUnitario') || '0'),
          importe: parseFloat(cn.getAttribute('Importe') || '0'),
        })
      }
      const parsed = {
        uuid: timbre?.getAttribute('UUID') || '',
        serie: comp.getAttribute('Serie') || '',
        folio: comp.getAttribute('Folio') || '',
        fecha: (comp.getAttribute('Fecha') || '').substring(0, 10),
        tipo_comprobante: comp.getAttribute('TipoDeComprobante') || 'I',
        subtotal: parseFloat(comp.getAttribute('SubTotal') || '0'),
        total: parseFloat(comp.getAttribute('Total') || '0'),
        moneda: comp.getAttribute('Moneda') || 'MXN',
        forma_pago: comp.getAttribute('FormaPago') || '',
        metodo_pago: comp.getAttribute('MetodoPago') || '',
        emisor_rfc: emisor?.getAttribute('Rfc') || '',
        emisor_nombre: emisor?.getAttribute('Nombre') || '',
        emisor_regimen: emisor?.getAttribute('RegimenFiscal') || '',
        receptor_rfc: receptor?.getAttribute('Rfc') || '',
        receptor_nombre: receptor?.getAttribute('Nombre') || '',
        receptor_regimen: receptor?.getAttribute('RegimenFiscalReceptor') || '',
        receptor_uso_cfdi: receptor?.getAttribute('UsoCFDI') || '',
        receptor_cp: receptor?.getAttribute('DomicilioFiscalReceptor') || '',
        conceptos,
      }
      const iva = parsed.total - parsed.subtotal
      setXmlResult(JSON.stringify({...parsed, iva: Math.round(iva*100)/100}, null, 2))
      const newInvoice: Invoice = {
        id: String(Date.now()),
        direccion: parsed.emisor_rfc.includes('OMM') || parsed.emisor_nombre.includes('OMM') ? 'emitida' : 'recibida',
        serie: parsed.serie, folio: parsed.folio,
        tipo_comprobante: (parsed.tipo_comprobante || 'I') as CfdiType,
        receptor_nombre: parsed.receptor_nombre,
        emisor_nombre: parsed.emisor_nombre,
        total: parsed.total,
        estado: 'timbrada',
        fecha_emision: parsed.fecha,
        proyecto_nombre: '',
        conciliada: false,
        metodo_pago: parsed.metodo_pago,
        uuid: parsed.uuid,
        subtotal: parsed.subtotal,
        iva: Math.round((parsed.total - parsed.subtotal) * 100) / 100,
        moneda: parsed.moneda,
        forma_pago: parsed.forma_pago,
        emisor_rfc: parsed.emisor_rfc,
        emisor_regimen: parsed.emisor_regimen,
        receptor_rfc: parsed.receptor_rfc,
        receptor_regimen: parsed.receptor_regimen,
        receptor_uso_cfdi: parsed.receptor_uso_cfdi,
        receptor_cp: parsed.receptor_cp,
        conceptos: parsed.conceptos,
      }
      // Save to Supabase
      const { data: savedFact } = await supabase.from('facturas').insert({
        direccion: newInvoice.direccion,
        uuid_fiscal: parsed.uuid || null,
        serie: newInvoice.serie,
        folio: newInvoice.folio,
        tipo_comprobante: newInvoice.tipo_comprobante,
        receptor_nombre: newInvoice.receptor_nombre,
        emisor_nombre: newInvoice.emisor_nombre,
        total: newInvoice.total,
        subtotal: parsed.subtotal,
        iva: Math.round((parsed.total - parsed.subtotal) * 100) / 100,
        estado: 'timbrada',
        fecha_emision: newInvoice.fecha_emision,
        metodo_pago: newInvoice.metodo_pago,
        forma_pago: parsed.forma_pago,
        moneda: parsed.moneda,
        emisor_rfc: parsed.emisor_rfc,
        emisor_regimen_fiscal: parsed.emisor_regimen,
        receptor_rfc: parsed.receptor_rfc,
        receptor_regimen_fiscal: parsed.receptor_regimen,
        receptor_uso_cfdi: parsed.receptor_uso_cfdi,
        receptor_domicilio_fiscal: parsed.receptor_cp,
      }).select().single()
      // Save conceptos
      if (savedFact && parsed.conceptos.length > 0) {
        await supabase.from('factura_conceptos').insert(
          parsed.conceptos.map((cp: any) => ({
            factura_id: savedFact.id,
            clave_prod_serv: cp.clave_prod_serv,
            cantidad: cp.cantidad,
            clave_unidad: cp.clave_unidad,
            unidad: cp.unidad,
            descripcion: cp.descripcion,
            valor_unitario: cp.valor_unitario,
            importe: cp.importe,
          }))
        )
      }
      setInvoices([{...newInvoice, id: savedFact?.id || newInvoice.id}, ...invoices])
    } catch (err) {
      setXmlResult('Error al parsear XML: ' + (err as Error).message)
    }
    setXmlProcessing(false)
    if (xmlInputRef.current) xmlInputRef.current.value = ''
  }

  const handleNew = async () => {
    if (!newInv.folio) return
    const finalTotal = newConceptos.length > 0 ? conceptosTotal : parseFloat(newInv.total) || 0
    const finalSubtotal = newConceptos.length > 0 ? conceptosSubtotal : 0
    const finalIva = newConceptos.length > 0 ? conceptosIva : 0
    // Save to Supabase
    const { data: saved } = await supabase.from('facturas').insert({
      direccion: newInv.direccion,
      serie: newInv.serie,
      folio: newInv.folio,
      tipo_comprobante: newInv.tipo_comprobante,
      receptor_nombre: newInv.receptor_nombre,
      emisor_nombre: newInv.emisor_nombre,
      total: finalTotal,
      subtotal: finalSubtotal || null,
      iva: finalIva || null,
      estado: 'borrador',
      fecha_emision: newInv.fecha_emision,
      metodo_pago: newInv.metodo_pago,
      proyecto_nombre: newInv.proyecto_nombre || null,
    }).select().single()
    // Save conceptos to Supabase
    if (saved && newConceptos.length > 0) {
      await supabase.from('factura_conceptos').insert(
        newConceptos.map(cp => ({ factura_id: saved.id, clave_prod_serv: cp.clave_prod_serv, cantidad: cp.cantidad, clave_unidad: cp.clave_unidad, unidad: cp.unidad, descripcion: cp.descripcion, valor_unitario: cp.valor_unitario, importe: cp.importe }))
      )
    }
    setInvoices([{ id: saved?.id || String(Date.now()), ...newInv, total: finalTotal, subtotal: finalSubtotal, iva: finalIva, estado: 'borrador', conciliada: false, conceptos: newConceptos } as Invoice, ...invoices])
    setNewConceptos([])
    setShowNewForm(false)
  }

  // Mes seleccionado por navegación
  const now = new Date()
  const monthDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999)
  const monthLabel = monthDate.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
  const monthLabelCapitalized = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)

  // Filtra por si una fecha cae en el mes seleccionado
  const inSelectedMonth = (fechaStr: string | undefined) => {
    if (!fechaStr) return false
    const d = new Date(fechaStr)
    if (isNaN(d.getTime())) return false
    return d >= monthStart && d <= monthEnd
  }

  // Facturas y movimientos del mes seleccionado
  const monthInvoices = invoices.filter(inv => inSelectedMonth(inv.fecha_emision))
  const monthMovements = bankMovements.filter(m => inSelectedMonth(m.fecha))

  // KPIs del mes
  const monthEmitidas = monthInvoices.filter(i => i.direccion === 'emitida')
  const monthRecibidas = monthInvoices.filter(i => i.direccion === 'recibida')
  const totalFacturado = monthEmitidas.reduce((s, i) => s + (i.total || 0), 0)
  const totalRecibido = monthRecibidas.reduce((s, i) => s + (i.total || 0), 0)

  // IVA por pagar = IVA cobrado (emitidas conciliadas) - IVA pagado (recibidas conciliadas)
  // Solo cuenta facturas conciliadas porque el IVA se causa con el flujo de efectivo.
  const ivaCobrado = monthEmitidas.filter(i => i.conciliada).reduce((s, i) => s + (i.iva || 0), 0)
  const ivaPagado = monthRecibidas.filter(i => i.conciliada).reduce((s, i) => s + (i.iva || 0), 0)
  const ivaPorPagar = ivaCobrado - ivaPagado

  // Ingresos sin factura: abonos del mes categorizados como cobro_cliente (o sin categoría clara)
  // que NO tienen factura_match_id asociado.
  const movimientosSinFactura = monthMovements.filter(m =>
    m.tipo === 'abono' &&
    (m.categoria_sugerida === 'cobro_cliente' || !m.categoria_sugerida || m.categoria_sugerida === 'otro') &&
    !m.factura_match_id
  )
  const ingresosSinFactura = movimientosSinFactura.reduce((s, m) => s + (m.monto || 0), 0)

  // Filtros aplicados a las facturas del mes: dirección + búsqueda
  const searchLower = search.trim().toLowerCase()
  const filtered = monthInvoices
    .filter(i =>
      filter === 'todas' ? true : filter === 'emitidas' ? i.direccion === 'emitida' : i.direccion === 'recibida'
    )
    .filter(i => {
      if (!searchLower) return true
      const haystack = [
        i.serie, i.folio, i.receptor_nombre, i.emisor_nombre,
        i.emisor_rfc, i.receptor_rfc, i.proyecto_nombre, i.uuid,
        i.receptor_uso_cfdi, i.metodo_pago,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(searchLower)
    })
    // Más nuevas primero
    .sort((a, b) => (b.fecha_emision || '').localeCompare(a.fecha_emision || ''))

  return (
    <div>
      {/* Month navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '10px 14px', background: '#141414', border: '1px solid #222', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setMonthOffset(monthOffset - 1)}
            style={{ padding: '6px 10px', fontSize: 12, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', cursor: 'pointer', fontFamily: 'inherit' }}
          >◀ Mes anterior</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', minWidth: 160, textAlign: 'center' }}>{monthLabelCapitalized}</span>
          <button
            onClick={() => setMonthOffset(monthOffset + 1)}
            style={{ padding: '6px 10px', fontSize: 12, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', cursor: 'pointer', fontFamily: 'inherit' }}
          >Mes siguiente ▶</button>
          {monthOffset !== 0 && (
            <button
              onClick={() => setMonthOffset(0)}
              style={{ padding: '6px 10px', fontSize: 11, background: 'rgba(87,255,154,0.08)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 6, color: '#57FF9A', cursor: 'pointer', fontFamily: 'inherit' }}
            >Hoy</button>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#666' }}>
          {monthInvoices.length} factura{monthInvoices.length !== 1 ? 's' : ''} · {monthMovements.length} movimiento{monthMovements.length !== 1 ? 's' : ''} bancario{monthMovements.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Total Facturado" value={F(totalFacturado)} color="#3B82F6" icon={<DollarSign size={16} />} />
        <KpiCard label="Total Recibido" value={F(totalRecibido)} color="#F59E0B" icon={<DollarSign size={16} />} />
        <KpiCard
          label="IVA por pagar"
          value={F(ivaPorPagar)}
          color={ivaPorPagar >= 0 ? '#EF4444' : '#57FF9A'}
          icon={<ShieldCheck size={16} />}
        />
        <KpiCard
          label="Ingresos sin factura"
          value={F(ingresosSinFactura)}
          color={ingresosSinFactura > 0 ? '#F59E0B' : '#57FF9A'}
          icon={<AlertTriangle size={16} />}
        />
      </div>

      {/* Toolbar: filtros + busqueda + acciones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['todas', 'emitidas', 'recibidas'] as const).map(f => (
            <Btn key={f} size="sm" variant={filter === f ? 'primary' : 'default'} onClick={() => setFilter(f)}>
              {f === 'todas' ? 'Todas' : f === 'emitidas' ? 'Emitidas' : 'Recibidas'}
            </Btn>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 260px', maxWidth: 400, minWidth: 200 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#555' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar folio, cliente, RFC, proyecto, UUID..."
              style={{
                width: '100%', padding: '7px 10px 7px 30px', fontSize: 12,
                background: '#0a0a0a', border: '1px solid #333', borderRadius: 8,
                color: '#fff', fontFamily: 'inherit',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 0, display: 'flex' }}
              ><X size={12} /></button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn size="sm" variant="default" onClick={() => xmlInputRef.current?.click()}>{xmlProcessing ? 'Procesando...' : <><Upload size={12} /> Subir XML</>}</Btn>
          <Btn size="sm" variant="primary" onClick={() => setShowNewForm(true)}><Plus size={12} /> Nueva factura</Btn>
        </div>
      </div>

      {/* Tabla con scroll */}
      <div style={{ maxHeight: 'calc(100vh - 360px)', minHeight: 300, overflowY: 'auto', border: '1px solid #222', borderRadius: 10, background: '#0d0d0d' }}>
        <Table>
          <thead style={{ position: 'sticky', top: 0, background: '#141414', zIndex: 1 }}>
            <tr>
              <Th>Folio</Th>
              <Th>Dir.</Th>
              <Th>Tipo</Th>
              <Th>Cliente / Proveedor</Th>
              <Th>Uso CFDI</Th>
              <Th>Proyecto</Th>
              <Th right>Ingreso</Th>
              <Th right>Egreso</Th>
              <Th>Estado</Th>
              <Th>Fecha</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><Td colSpan={10} muted>
                {monthInvoices.length === 0
                  ? `Sin facturas en ${monthLabelCapitalized}`
                  : 'Sin resultados para los filtros aplicados'}
              </Td></tr>
            )}
            {filtered.map(inv => {
              const cfg = INVOICE_STATUS_CONFIG[inv.estado]
              const isIngreso = inv.direccion === 'emitida'
              return (
                <tr key={inv.id} style={{cursor:'pointer'}} onClick={() => setSelectedInv(inv)}>
                  <Td>
                    <span style={{ fontWeight: 600, color: '#fff' }}>
                      {inv.serie ? `${inv.serie}-${inv.folio}` : inv.folio}
                    </span>
                  </Td>
                  <Td>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                      background: isIngreso ? '#3B82F622' : '#F59E0B22',
                      color: isIngreso ? '#3B82F6' : '#F59E0B',
                    }}>
                      {isIngreso ? 'EMI' : 'REC'}
                    </span>
                  </Td>
                  <Td muted>{CFDI_TYPE_LABELS[inv.tipo_comprobante]}</Td>
                  <Td>
                    <span style={{ color: '#ccc' }}>
                      {isIngreso ? inv.receptor_nombre : inv.emisor_nombre}
                    </span>
                  </Td>
                  <Td>
                    {inv.receptor_uso_cfdi ? (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                        background: '#1a1a1a', border: '1px solid #333',
                        color: '#aaa', fontFamily: 'monospace',
                      }}>{inv.receptor_uso_cfdi}</span>
                    ) : <span style={{ color: '#444' }}>—</span>}
                  </Td>
                  <Td muted>{inv.proyecto_nombre || '—'}</Td>
                  <Td right>
                    {isIngreso
                      ? <span style={{ color: '#57FF9A', fontWeight: 600 }}>{F(inv.total)}</span>
                      : <span style={{ color: '#444' }}>—</span>}
                  </Td>
                  <Td right>
                    {!isIngreso
                      ? <span style={{ color: '#EF4444', fontWeight: 600 }}>{F(inv.total)}</span>
                      : <span style={{ color: '#444' }}>—</span>}
                  </Td>
                  <Td><Badge label={cfg.label} color={cfg.color} /></Td>
                  <Td muted>{formatDate(inv.fecha_emision)}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </div>

      <input type="file" ref={xmlInputRef} accept=".xml" style={{ display: 'none' }} onChange={handleXml} />

      {showNewForm && (
        <Modal title="Nueva Factura" onClose={() => setShowNewForm(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Cliente *">
              <select style={selectStyle} onChange={e => {
                const cl = MOCK_CLIENTES.find(c => c.id === e.target.value)
                if (cl) setNewInv({...newInv, receptor_nombre: cl.razon_social, emisor_nombre: 'OMM Technologies SA de CV', cliente_id: cl.id, rfc_receptor: cl.rfc, regimen_receptor: cl.regimen_fiscal_clave, cp_receptor: cl.codigo_postal, uso_cfdi: cl.uso_cfdi_clave})
              }}>
                <option value="">-- Seleccionar cliente --</option>
                {MOCK_CLIENTES.filter(cl => cl.activo).map(cl => <option key={cl.id} value={cl.id}>{cl.rfc} - {cl.razon_social}</option>)}
              </select>
            </Field>
            {newInv.receptor_nombre && (
              <div style={{ background: '#0a0a0a', border: '1px solid #222', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#57FF9A', fontWeight: 600, marginBottom: 6 }}>Datos fiscales del cliente (solo lectura)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 11 }}>
                  <div><span style={{color:'#555'}}>RFC:</span> <span style={{color:'#fff', fontFamily:'monospace'}}>{newInv.rfc_receptor}</span></div>
                  <div><span style={{color:'#555'}}>Regimen:</span> <span style={{color:'#ccc'}}>{newInv.regimen_receptor}</span></div>
                  <div style={{gridColumn:'1/-1'}}><span style={{color:'#555'}}>Razon Social:</span> <span style={{color:'#fff'}}>{newInv.receptor_nombre}</span></div>
                  <div><span style={{color:'#555'}}>C.P.:</span> <span style={{color:'#ccc'}}>{newInv.cp_receptor}</span></div>
                  <div><span style={{color:'#555'}}>Uso CFDI:</span> <span style={{color:'#ccc'}}>{newInv.uso_cfdi}</span></div>
                </div>
                <div style={{ fontSize: 10, color: '#444', marginTop: 6 }}>Para modificar datos fiscales, ve a Clientes</div>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Direccion">
              <select style={selectStyle} value={newInv.direccion} onChange={e => setNewInv({...newInv, direccion: e.target.value as InvoiceDirection})}><option value="emitida">Emitida</option><option value="recibida">Recibida</option></select>
            </Field>
            <Field label="Tipo CFDI">
              <select style={selectStyle} value={newInv.tipo_comprobante} onChange={e => setNewInv({...newInv, tipo_comprobante: e.target.value as CfdiType})}><option value="I">Ingreso</option><option value="E">Egreso</option><option value="P">Pago</option></select>
            </Field>
            <Field label="Serie"><input style={inputStyle} value={newInv.serie} onChange={e => setNewInv({...newInv, serie: e.target.value})} placeholder="FAC" /></Field>
            <Field label="Folio *"><input style={inputStyle} value={newInv.folio} onChange={e => setNewInv({...newInv, folio: e.target.value})} placeholder="003" /></Field>
            <Field label="Total *"><input style={inputStyle} type="number" value={newInv.total} onChange={e => setNewInv({...newInv, total: e.target.value})} placeholder="0.00" /></Field>
            <Field label="Fecha"><input style={inputStyle} type="date" value={newInv.fecha_emision} onChange={e => setNewInv({...newInv, fecha_emision: e.target.value})} /></Field>
            <Field label="Proyecto"><select style={selectStyle} value={newInv.proyecto_nombre} onChange={e => setNewInv({...newInv, proyecto_nombre: e.target.value})}><option value="">Sin proyecto</option>{projectNames.map(p => <option key={p} value={p}>{p}</option>)}</select></Field>
            <Field label="Metodo pago"><select style={selectStyle} value={newInv.metodo_pago} onChange={e => setNewInv({...newInv, metodo_pago: e.target.value})}><option value="PUE">PUE</option><option value="PPD">PPD</option></select></Field>
          </div>
          <div style={{ borderTop: '1px solid #222', paddingTop: 16, marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Conceptos / Productos</div>
              <Btn size="sm" variant="default" onClick={addConcepto}><Plus size={12} /> Agregar linea</Btn>
            </div>
            {newConceptos.length === 0 ? (
              <div style={{ fontSize: 11, color: '#444', textAlign: 'center', padding: '16px 0' }}>Agrega al menos un concepto para la factura</div>
            ) : (
              <>
                {newConceptos.map((cp, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 60px 90px 90px 30px', gap: 6, marginBottom: 8, alignItems: 'end' }}>
                    <div>
                      <div style={{ fontSize: 9, color: '#555', marginBottom: 2 }}>Clave SAT</div>
                      <input style={inputStyle} value={cp.clave_prod_serv} onChange={e => updateConcepto(i, 'clave_prod_serv', e.target.value)} placeholder="84111506" />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: '#555', marginBottom: 2 }}>Descripcion</div>
                      <input style={inputStyle} value={cp.descripcion} onChange={e => updateConcepto(i, 'descripcion', e.target.value)} placeholder="Servicio de instalacion electrica" />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: '#555', marginBottom: 2 }}>Cant.</div>
                      <input style={inputStyle} type="number" value={cp.cantidad} onChange={e => updateConcepto(i, 'cantidad', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: '#555', marginBottom: 2 }}>P. Unitario</div>
                      <input style={inputStyle} type="number" value={cp.valor_unitario} onChange={e => updateConcepto(i, 'valor_unitario', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: '#555', marginBottom: 2 }}>Importe</div>
                      <div style={{ padding: '8px 12px', background: '#0a0a0a', border: '1px solid #222', borderRadius: 8, color: '#57FF9A', fontSize: 13, fontWeight: 600 }}>{F(cp.importe)}</div>
                    </div>
                    <button onClick={() => removeConcepto(i)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '8px 0' }}><X size={14} /></button>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginTop: 12, fontSize: 12, borderTop: '1px solid #1a1a1a', paddingTop: 8 }}>
                  <div><span style={{color:'#555'}}>Subtotal:</span> <span style={{color:'#ccc'}}>{F(conceptosSubtotal)}</span></div>
                  <div><span style={{color:'#555'}}>IVA 16%:</span> <span style={{color:'#ccc'}}>{F(conceptosIva)}</span></div>
                  <div><span style={{color:'#fff', fontWeight: 700}}>Total: {F(conceptosTotal)}</span></div>
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <Btn size="sm" variant="default" onClick={() => setShowNewForm(false)}>Cancelar</Btn>
            <Btn size="sm" variant="primary" onClick={handleNew}>Crear factura</Btn>
          </div>
        </Modal>
      )}

      {selectedInv && (
        <Modal title={selectedInv.serie ? selectedInv.serie + '-' + selectedInv.folio : selectedInv.folio} onClose={() => setSelectedInv(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: 12 }}>
            <div><span style={{color:'#555'}}>Direccion:</span> <Badge label={selectedInv.direccion === 'emitida' ? 'Emitida' : 'Recibida'} color={selectedInv.direccion === 'emitida' ? '#3B82F6' : '#F59E0B'} /></div>
            <div><span style={{color:'#555'}}>Tipo CFDI:</span> <span style={{color:'#fff'}}>{CFDI_TYPE_LABELS[selectedInv.tipo_comprobante]}</span></div>
            <div><span style={{color:'#555'}}>Emisor:</span> <span style={{color:'#ccc'}}>{selectedInv.emisor_nombre}</span></div>
            <div><span style={{color:'#555'}}>Receptor:</span> <span style={{color:'#ccc'}}>{selectedInv.receptor_nombre}</span></div>
            <div><span style={{color:'#555'}}>Fecha:</span> <span style={{color:'#ccc'}}>{formatDate(selectedInv.fecha_emision)}</span></div>
            <div><span style={{color:'#555'}}>Estado:</span> <Badge label={INVOICE_STATUS_CONFIG[selectedInv.estado].label} color={INVOICE_STATUS_CONFIG[selectedInv.estado].color} /></div>
            <div><span style={{color:'#555'}}>Metodo pago:</span> <span style={{color:'#ccc'}}>{selectedInv.metodo_pago || '--'}</span></div>
            <div><span style={{color:'#555'}}>Proyecto:</span> <span style={{color:'#ccc'}}>{selectedInv.proyecto_nombre || '--'}</span></div>
            <div><span style={{color:'#555'}}>Conciliada:</span> <span style={{color: selectedInv.conciliada ? '#57FF9A' : '#F59E0B'}}>{selectedInv.conciliada ? 'Si' : 'No'}</span></div>
            <div><span style={{color:'#555'}}>Total:</span> <span style={{color:'#fff', fontWeight: 700, fontSize: 16}}>{F(selectedInv.total)}</span></div>
          </div>
          <div style={{ marginTop: 16, padding: '12px 0', borderTop: '1px solid #222' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 10 }}>Conceptos</div>
            <div style={{ fontSize: 11, color: '#555', textAlign: 'center', padding: 20 }}>Los conceptos se mostraran al cargar desde XML o generar via Facturapi</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <Btn size="sm" variant="default" onClick={() => setSelectedInv(null)}>Cerrar</Btn>
          </div>
        </Modal>
      )}

      {selectedInv && (
        <Modal title={(selectedInv.serie ? selectedInv.serie + '-' + selectedInv.folio : selectedInv.folio) + ' - Detalle'} onClose={() => setSelectedInv(null)}>
          <div style={{ fontSize: 11, color: '#444', marginBottom: 12 }}>{selectedInv.uuid ? 'UUID: ' + selectedInv.uuid : 'Sin UUID (factura no timbrada)'}</div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px 16px', fontSize: 12, marginBottom: 16 }}>
            <div><span style={{color:'#555'}}>Direccion:</span> <Badge label={selectedInv.direccion === 'emitida' ? 'Emitida' : 'Recibida'} color={selectedInv.direccion === 'emitida' ? '#3B82F6' : '#F59E0B'} /></div>
            <div><span style={{color:'#555'}}>Tipo:</span> <span style={{color:'#fff'}}>{CFDI_TYPE_LABELS[selectedInv.tipo_comprobante]}</span></div>
            <div><span style={{color:'#555'}}>Estado:</span> <Badge label={INVOICE_STATUS_CONFIG[selectedInv.estado].label} color={INVOICE_STATUS_CONFIG[selectedInv.estado].color} /></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 12, marginBottom: 16 }}>
            <div style={{borderBottom:'1px solid #1a1a1a', paddingBottom: 4}}>
              <div style={{color:'#57FF9A', fontWeight: 600, fontSize: 11, marginBottom: 4}}>Emisor</div>
              <div><span style={{color:'#555'}}>RFC:</span> <span style={{color:'#fff', fontFamily:'monospace'}}>{selectedInv.emisor_rfc || '--'}</span></div>
              <div><span style={{color:'#555'}}>Nombre:</span> <span style={{color:'#ccc'}}>{selectedInv.emisor_nombre}</span></div>
              <div><span style={{color:'#555'}}>Regimen:</span> <span style={{color:'#888'}}>{selectedInv.emisor_regimen || '--'}</span></div>
            </div>
            <div style={{borderBottom:'1px solid #1a1a1a', paddingBottom: 4}}>
              <div style={{color:'#3B82F6', fontWeight: 600, fontSize: 11, marginBottom: 4}}>Receptor</div>
              <div><span style={{color:'#555'}}>RFC:</span> <span style={{color:'#fff', fontFamily:'monospace'}}>{selectedInv.receptor_rfc || '--'}</span></div>
              <div><span style={{color:'#555'}}>Nombre:</span> <span style={{color:'#ccc'}}>{selectedInv.receptor_nombre}</span></div>
              <div><span style={{color:'#555'}}>Regimen:</span> <span style={{color:'#888'}}>{selectedInv.receptor_regimen || '--'}</span></div>
              <div><span style={{color:'#555'}}>Uso CFDI:</span> <span style={{color:'#888'}}>{selectedInv.receptor_uso_cfdi || '--'}</span></div>
              <div><span style={{color:'#555'}}>C.P.:</span> <span style={{color:'#888'}}>{selectedInv.receptor_cp || '--'}</span></div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px 16px', fontSize: 12, marginBottom: 16 }}>
            <div><span style={{color:'#555'}}>Fecha:</span> <span style={{color:'#ccc'}}>{formatDate(selectedInv.fecha_emision)}</span></div>
            <div><span style={{color:'#555'}}>Metodo:</span> <span style={{color:'#ccc'}}>{selectedInv.metodo_pago || '--'}</span></div>
            <div><span style={{color:'#555'}}>Forma:</span> <span style={{color:'#ccc'}}>{selectedInv.forma_pago || '--'}</span></div>
            <div><span style={{color:'#555'}}>Moneda:</span> <span style={{color:'#ccc'}}>{selectedInv.moneda || 'MXN'}</span></div>
          </div>

          <div style={{ borderTop: '1px solid #222', paddingTop: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Conceptos</div>
            {selectedInv.conceptos && selectedInv.conceptos.length > 0 ? (
              <Table>
                <thead><tr><Th>Clave SAT</Th><Th>Descripcion</Th><Th>Unidad</Th><Th right>Cant.</Th><Th right>P. Unit.</Th><Th right>Importe</Th></tr></thead>
                <tbody>
                  {selectedInv.conceptos.map((cp, i) => (
                    <tr key={i}>
                      <Td><span style={{fontFamily:'monospace', fontSize: 11, color:'#888'}}>{cp.clave_prod_serv}</span></Td>
                      <Td><span style={{color:'#ccc', fontSize: 11}}>{cp.descripcion}</span></Td>
                      <Td muted style={{fontSize: 11}}>{cp.clave_unidad} {cp.unidad ? '(' + cp.unidad + ')' : ''}</Td>
                      <Td right muted>{cp.cantidad}</Td>
                      <Td right muted>{F(cp.valor_unitario)}</Td>
                      <Td right style={{fontWeight: 600, color:'#fff'}}>{F(cp.importe)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <div style={{ fontSize: 11, color: '#444', textAlign: 'center', padding: '16px 0' }}>Sin conceptos. Sube el XML de la factura para ver el detalle.</div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 20, marginTop: 12, borderTop: '1px solid #222', paddingTop: 12 }}>
            <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
              <div><span style={{color:'#555'}}>Subtotal:</span> <span style={{color:'#ccc'}}>{F(selectedInv.subtotal || 0)}</span></div>
              <div><span style={{color:'#555'}}>IVA:</span> <span style={{color:'#ccc'}}>{F(selectedInv.iva || 0)}</span></div>
              <div><span style={{color:'#fff', fontWeight: 700, fontSize: 16}}>Total: {F(selectedInv.total)}</span></div>
            </div>
            <Btn size="sm" variant="default" onClick={() => setSelectedInv(null)}>Cerrar</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* --------- Tab 2: Conciliaci--n Bancaria --------------------------------------------------------------------------------------------------- */

function TabConciliacion({ bankMovements, setBankMovements, invoices, projectNames }: { bankMovements: BankMovement[]; setBankMovements: (m: BankMovement[]) => void; invoices: Invoice[]; projectNames: string[] }) {
  const [processing, setProcessing] = useState(false)
  const [status, setStatus] = useState('')
  const [lastCheck, setLastCheck] = useState<any>(null)
  const [filtro, setFiltro] = useState<'todos' | 'pendientes' | 'conciliados'>('todos')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [manual, setManual] = useState({ fecha: new Date().toISOString().substring(0, 10), concepto: '', beneficiario: '', monto: '', tipo: 'cargo' as 'cargo' | 'abono', categoria: 'otro', proyecto: '' })
  const fileRef = useRef<HTMLInputElement>(null)
  // Conciliacion v2 - 3 cuentas
  const [activeAccount, setActiveAccount] = useState<'bbva-mxn' | 'bbva-usd' | 'banorte-mxn'>('bbva-mxn')
  const [showTxtModal, setShowTxtModal] = useState<null | 'bbva-mxn' | 'bbva-usd'>(null)
  const [txtPayload, setTxtPayload] = useState('')
  const [txtPreview, setTxtPreview] = useState<any[] | null>(null)
  const [txtSummary, setTxtSummary] = useState<any | null>(null)

  /* --- Supabase sync helpers --- */
  const toRow = (m: BankMovement) => ({
    id: m.id, fecha: m.fecha, concepto: m.concepto, referencia: m.referencia,
    monto: m.monto, tipo: m.tipo, saldo: m.saldo,
    categoria: m.categoria_sugerida || 'otro', proyecto: m.proyecto_sugerido || '',
    beneficiario: m.beneficiario || '', conciliado: m.conciliado,
    factura_match_id: m.factura_match_id || null, factura_match_info: m.factura_match_info || '',
    rfc_contraparte: m.rfc_contraparte || null, proyecto_codigo: m.proyecto_codigo || null,
    banco: m.banco || null, cuenta: m.cuenta || null,
    moneda: m.moneda || 'MXN',
    saldo_posterior: m.saldo_posterior ?? null,
    proveedor: m.proveedor || null, cliente: m.cliente || null,
    uuid_factura: m.uuid_factura || null, folio_serie: m.folio_serie || null,
    uso_cfdi: m.uso_cfdi || null, observaciones: m.observaciones || null,
    confianza_autodetect: m.confianza_autodetect || null,
    traspaso_usd_monto: m.traspaso_usd_monto ?? null,
    traspaso_pair_id: m.traspaso_pair_id || null,
    folio_spei: m.folio_spei || null, clabe_contraparte: m.clabe_contraparte || null,
    source: m.source || 'manual',
  })

  const dbInsertMany = async (movements: BankMovement[]) => {
    if (movements.length === 0) return
    const rows = movements.map(toRow)
    // Batch in chunks of 50
    for (let i = 0; i < rows.length; i += 50) {
      await supabase.from('bank_movements').upsert(rows.slice(i, i + 50), { onConflict: 'id' })
    }
  }

  const dbDeleteMany = async (ids: string[]) => {
    if (ids.length === 0) return
    await supabase.from('bank_movements').delete().in('id', ids)
  }

  const dbUpdate = async (id: string, updates: Record<string, any>) => {
    await supabase.from('bank_movements').update(updates).eq('id', id)
  }

  const dbUpdateMany = async (ids: string[], updates: Record<string, any>) => {
    if (ids.length === 0) return
    await supabase.from('bank_movements').update(updates).in('id', ids)
  }

  const addManual = async () => {
    const monto = Math.abs(parseFloat(manual.monto) || 0)
    if (!manual.concepto.trim() || monto === 0) return
    const newMov: BankMovement = {
      id: crypto.randomUUID(),
      fecha: manual.fecha,
      concepto: manual.concepto.trim(),
      referencia: '',
      monto,
      tipo: manual.tipo,
      saldo: 0,
      categoria_sugerida: manual.categoria,
      proyecto_sugerido: manual.proyecto,
      beneficiario: manual.beneficiario.trim(),
      conciliado: false,
    }
    setBankMovements([newMov, ...bankMovements])
    dbInsertMany([newMov])
    setManual({ fecha: new Date().toISOString().substring(0, 10), concepto: '', beneficiario: '', monto: '', tipo: 'cargo', categoria: 'otro', proyecto: '' })
    setShowManual(false)
  }

  /* --- Auto-match movements with invoices ---
     Orden de prioridad:
     1. RFC exacto + monto con tolerancia 0.5%
     2. RFC exacto (sin importar monto — útil si es pago parcial)
     3. Monto exacto + dirección coherente (abono↔emitida, cargo↔recibida)
     4. Nombre similar + monto tolerancia 2%
     Devuelve el mejor match con un score del 0-100 para debugging. */
  const normalizeRfc = (s?: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim()

  const findMatch = (m: BankMovement): { id: string; info: string; score: number } | null => {
    if (!invoices || invoices.length === 0) return null

    const movRfc = normalizeRfc(m.rfc_contraparte)
    const benefLower = (m.beneficiario || m.concepto || '').toLowerCase()

    // Filtrar por dirección coherente primero
    const coherent = invoices.filter(inv => {
      if (m.tipo === 'abono' && inv.direccion === 'emitida') return true // cobro recibido = factura emitida
      if (m.tipo === 'cargo' && inv.direccion === 'recibida') return true // pago enviado = factura recibida
      return false
    })
    if (coherent.length === 0) return null

    type Scored = { inv: Invoice; score: number }
    const scored: Scored[] = coherent.map(inv => {
      let score = 0
      // RFC match (peso alto)
      const invRfc = normalizeRfc(m.tipo === 'abono' ? inv.receptor_rfc : inv.emisor_rfc)
      if (movRfc && invRfc && movRfc === invRfc) score += 60

      // Monto exacto (tolerancia 0.5%)
      const montoDiff = Math.abs(inv.total - m.monto) / Math.max(inv.total, 1)
      if (montoDiff <= 0.005) score += 30
      else if (montoDiff <= 0.02) score += 15

      // Ventana de fecha ±7 días
      if (inv.fecha_emision && m.fecha) {
        const dMov = new Date(m.fecha).getTime()
        const dInv = new Date(inv.fecha_emision).getTime()
        const daysDiff = Math.abs(dMov - dInv) / (1000 * 60 * 60 * 24)
        if (daysDiff <= 7) score += 10
        else if (daysDiff <= 30) score += 5
      }

      // Nombre similar (fallback sin RFC)
      if (!movRfc && benefLower) {
        const invName = (inv.direccion === 'emitida' ? inv.receptor_nombre : inv.emisor_nombre || '').toLowerCase()
        if (invName && (benefLower.includes(invName) || (benefLower.split(' ')[0] && invName.includes(benefLower.split(' ')[0])))) {
          score += 20
        }
      }

      // Factura ya conciliada pesa menos (evita conflictos)
      if (inv.conciliada) score -= 5

      return { inv, score }
    })

    // Ordenar por score descendente
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]

    // Umbral mínimo: 30 (significa al menos un hit significativo)
    if (!best || best.score < 30) return null

    const inv = best.inv
    const who = inv.direccion === 'emitida' ? inv.receptor_nombre : inv.emisor_nombre
    return {
      id: inv.id,
      info: `${inv.serie || ''}${inv.serie ? '-' : ''}${inv.folio} · ${who} · ${F(inv.total)} · ${inv.proyecto_nombre || 'Sin proyecto'}`,
      score: best.score,
    }
  }

  /* --- Upload handler — usa edge function server-side /api/extract-bank-statement --- */
  const handleBankUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setProcessing(true); setStatus('Leyendo archivo...')
    const ext = file.name.split('.').pop()?.toLowerCase()

    try {
      let kind: 'pdf' | 'text'
      let payload: string

      if (ext === 'pdf') {
        setStatus('Procesando PDF con AI...')
        kind = 'pdf'
        payload = await new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res((r.result as string).split(',')[1])
          r.onerror = () => rej(new Error('Error leyendo PDF'))
          r.readAsDataURL(file)
        })
      } else {
        setStatus('Procesando archivo con AI...')
        kind = 'text'
        payload = await file.text()
      }

      const response = await fetch('/api/extract-bank-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, payload }),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const errMsg = errData.error || String(response.status)
        const isOverloaded = response.status === 529 || errMsg.toLowerCase().includes('overloaded') || errMsg.toLowerCase().includes('saturado')
        setStatus(isOverloaded
          ? '⚠ Claude API saturado. Espera 1-2 min y vuelve a subir el archivo.'
          : 'Error: ' + errMsg)
        setProcessing(false); return
      }

      const data = await response.json()
      if (!data.ok) {
        setStatus('Error: ' + (data.error || 'sin respuesta'))
        setProcessing(false); return
      }

      // Guarda el resultado del check de cuadre para mostrarlo al usuario
      setLastCheck(data.totals_check || null)

      const movements: any[] = Array.isArray(data.movements) ? data.movements : []
      if (movements.length === 0) {
        setStatus('No se encontraron movimientos')
        setProcessing(false); return
      }

      const banco = data.banco || ''
      const cuenta = data.cuenta || ''

      const newMovs: BankMovement[] = movements.map((m: any) => ({
        id: crypto.randomUUID(),
        fecha: m.fecha || '',
        concepto: m.concepto || '',
        referencia: m.referencia || '',
        monto: Math.abs(Number(m.monto) || 0),
        tipo: m.tipo === 'abono' ? 'abono' : 'cargo',
        saldo: 0,
        categoria_sugerida: m.categoria || 'otro',
        proyecto_sugerido: m.proyecto_nombre || '',
        beneficiario: m.beneficiario || '',
        rfc_contraparte: m.rfc_contraparte || '',
        proyecto_codigo: m.proyecto_codigo || '',
        banco,
        cuenta,
        conciliado: false,
      }))

      // Deduplicate: skip if same fecha+monto+tipo+concepto already exists
      const existing = bankMovements
      const deduped = newMovs.filter(n => !existing.some(e =>
        e.fecha === n.fecha && Math.abs(e.monto - n.monto) < 0.01 && e.tipo === n.tipo && e.concepto === n.concepto
      ))
      const warningsMsg = (data.warnings && data.warnings.length > 0) ? ` · ${data.warnings.length} warning(s)` : ''
      if (deduped.length < newMovs.length) {
        setStatus(`✓ ${deduped.length} nuevos (${newMovs.length - deduped.length} duplicados)${warningsMsg}`)
      } else {
        setStatus(`✓ ${deduped.length} movimientos extraídos${warningsMsg}`)
      }
      setBankMovements([...deduped, ...existing])
      dbInsertMany(deduped)
      setSelected(new Set())
    } catch (err) {
      setStatus('Error: ' + (err as Error).message)
    }
    setProcessing(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  /* --- Conciliacion v2: configuracion de cuentas --- */
  const ACCOUNTS = {
    'bbva-mxn':    { banco: 'BBVA',    moneda: 'MXN' as const, cuenta: '0118270236', label: 'BBVA MXN',    color: '#3B82F6' },
    'bbva-usd':    { banco: 'BBVA',    moneda: 'USD' as const, cuenta: '0119196919', label: 'BBVA USD',    color: '#10B981' },
    'banorte-mxn': { banco: 'Banorte', moneda: 'MXN' as const, cuenta: '1263311182', label: 'Banorte MXN', color: '#EF4444' },
  }
  type AccountId = keyof typeof ACCOUNTS

  /* --- Helper: ultima fecha importada por cuenta --- */
  const getUltimaFechaCuenta = (accountId: AccountId): string | null => {
    const acc = ACCOUNTS[accountId]
    const movs = bankMovements.filter(m => m.banco === acc.banco && (m.moneda || 'MXN') === acc.moneda)
    if (movs.length === 0) return null
    const sorted = [...movs].sort((a, b) => b.fecha.localeCompare(a.fecha))
    return sorted[0].fecha
  }

  /* --- Conciliacion v2: procesar TXT pegado --- */
  const handleTxtProcess = async () => {
    if (!showTxtModal) return
    if (!txtPayload.trim()) { setStatus('Pega el TXT antes de procesar'); return }
    const accountId = showTxtModal as AccountId
    const acc = ACCOUNTS[accountId]
    const ultimaFecha = getUltimaFechaCuenta(accountId)
    setProcessing(true); setStatus('Procesando TXT con AI...')
    try {
      const response = await fetch('/api/extract-bank-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'txt-tabular',
          payload: txtPayload,
          ultima_fecha_importada: ultimaFecha,
        }),
      })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        setStatus('Error: ' + (errData.error || String(response.status)))
        setProcessing(false); return
      }
      const data = await response.json()
      if (!data.ok) { setStatus('Error: ' + (data.error || 'sin respuesta')); setProcessing(false); return }
      setLastCheck(data.totals_check || null)
      const movements: any[] = Array.isArray(data.movements) ? data.movements : []
      if (movements.length === 0) { setStatus('No se encontraron movimientos nuevos'); setProcessing(false); return }
      // Preview antes de insertar
      setTxtPreview(movements)
      setTxtSummary({ totals_check: data.totals_check, warnings: data.warnings, periodo: data.periodo })
      setStatus('Preview listo: ' + movements.length + ' movimientos')
    } catch (err) {
      setStatus('Error: ' + (err as Error).message)
    }
    setProcessing(false)
  }

  /* --- Conciliacion v2: confirmar importacion del TXT --- */
  const handleTxtConfirm = async () => {
    if (!showTxtModal || !txtPreview) return
    const accountId = showTxtModal as AccountId
    const acc = ACCOUNTS[accountId]
    const batchId = crypto.randomUUID()
    const newMovs: BankMovement[] = txtPreview.map((m: any) => ({
      id: crypto.randomUUID(),
      fecha: m.fecha || '',
      concepto: m.concepto || '',
      referencia: '',
      monto: Math.abs(Number(m.monto) || 0),
      tipo: m.tipo === 'abono' ? 'abono' : 'cargo',
      saldo: 0,
      saldo_posterior: Number(m.saldo_posterior) || undefined,
      categoria_sugerida: m.categoria || 'otro',
      proyecto_sugerido: m.proyecto_nombre || '',
      beneficiario: m.beneficiario || '',
      rfc_contraparte: m.rfc_contraparte || '',
      proyecto_codigo: m.proyecto_codigo || '',
      banco: acc.banco,
      cuenta: acc.cuenta,
      moneda: acc.moneda,
      confianza_autodetect: m.confianza_autodetect || 'media',
      traspaso_usd_monto: Number(m.traspaso_usd_monto) || undefined,
      folio_spei: m.folio_spei || '',
      clabe_contraparte: m.clabe_contraparte || '',
      source: 'txt-tabular',
      conciliado: false,
    }))
    setBankMovements([...newMovs, ...bankMovements])
    await dbInsertMany(newMovs)
    setStatus('Importados ' + newMovs.length + ' movimientos a ' + acc.label)
    setShowTxtModal(null)
    setTxtPayload('')
    setTxtPreview(null)
    setTxtSummary(null)
  }

  /* --- Conciliacion v2: filtros y derivados por cuenta activa (tiene que ir ANTES de filtered) --- */
  const activeAcc = ACCOUNTS[activeAccount]
  const movsCuenta = bankMovements.filter(m => m.banco === activeAcc.banco && (m.moneda || 'MXN') === activeAcc.moneda)
  const cargosCuenta = movsCuenta.filter(m => m.tipo === 'cargo').reduce((s, m) => s + m.monto, 0)
  const abonosCuenta = movsCuenta.filter(m => m.tipo === 'abono').reduce((s, m) => s + m.monto, 0)
  const conciliadosCuenta = movsCuenta.filter(m => m.conciliado).length

  /* --- Selection helpers --- */
  // Conciliacion v2: filtrar PRIMERO por cuenta activa, luego por estado
  const filtered = bankMovements
    .filter(m => m.banco === activeAcc.banco && (m.moneda || 'MXN') === activeAcc.moneda)
    .filter(m => filtro === 'todos' ? true : filtro === 'pendientes' ? !m.conciliado : m.conciliado)
  const allSelected = filtered.length > 0 && filtered.every(m => selected.has(m.id))
  const toggleAll = () => {
    if (allSelected) { setSelected(new Set()) }
    else { setSelected(new Set(filtered.map(m => m.id))) }
  }
  const toggleOne = (id: string) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }
  const deleteSelected = () => {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    setBankMovements(bankMovements.filter(m => !selected.has(m.id)))
    dbDeleteMany(ids)
    setSelected(new Set())
  }
  const conciliarSelected = () => {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    setBankMovements(bankMovements.map(m => selected.has(m.id) ? { ...m, conciliado: true } : m))
    dbUpdateMany(ids, { conciliado: true })
    setSelected(new Set())
  }

  /* --- Toggle conciliar one --- */
  const toggleConciliar = (id: string) => {
    const mov = bankMovements.find(m => m.id === id)
    const newVal = !mov?.conciliado
    setBankMovements(bankMovements.map(m => m.id === id ? { ...m, conciliado: newVal } : m))
    dbUpdate(id, { conciliado: newVal })
  }



  /* --- KPIs --- */
  const totalCargos = bankMovements.filter(m => m.tipo === 'cargo').reduce((s, m) => s + m.monto, 0)
  const totalAbonos = bankMovements.filter(m => m.tipo === 'abono').reduce((s, m) => s + m.monto, 0)
  const conciliados = bankMovements.filter(m => m.conciliado).length

  /* --- Project summary --- */
  const projectMap = new Map<string, { cargos: number; abonos: number; count: number }>()
  bankMovements.forEach(m => {
    const proy = m.proyecto_sugerido || 'Sin proyecto'
    const cur = projectMap.get(proy) || { cargos: 0, abonos: 0, count: 0 }
    cur.count++
    if (m.tipo === 'cargo') cur.cargos += m.monto; else cur.abonos += m.monto
    projectMap.set(proy, cur)
  })

  const catColors: Record<string, string> = { nomina: '#C084FC', proveedor: '#F59E0B', cobro_cliente: '#57FF9A', impuestos: '#EF4444', comision: '#6B7280', traspaso: '#3B82F6', prestamo: '#06B6D4', suscripcion: '#EC4899', otro: '#555' }
  const chkStyle: React.CSSProperties = { width: 15, height: 15, accentColor: '#57FF9A', cursor: 'pointer' }

  return (
    <div>
      {/* Selector de cuenta (Conciliacion v2) */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#0f0f0f', borderRadius: 10, padding: 4, border: '1px solid #1f1f1f' }}>
        {(Object.keys(ACCOUNTS) as AccountId[]).map(accId => {
          const acc = ACCOUNTS[accId]
          const count = bankMovements.filter(m => m.banco === acc.banco && (m.moneda || 'MXN') === acc.moneda).length
          const isActive = activeAccount === accId
          return (
            <button key={accId} onClick={() => setActiveAccount(accId)} style={{
              flex: 1, background: isActive ? '#1a1a1a' : 'transparent',
              border: isActive ? '1px solid ' + acc.color : '1px solid transparent',
              borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: acc.color }} />
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? '#fff' : '#aaa' }}>{acc.label}</div>
                  <div style={{ fontSize: 9, color: '#666' }}>{acc.cuenta}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: isActive ? acc.color : '#555', fontWeight: 700 }}>{count}</div>
            </button>
          )
        })}
      </div>

      {/* KPIs filtrados por cuenta activa */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Movimientos" value={movsCuenta.length} icon={<ArrowLeftRight size={16} />} />
        <KpiCard label="Cargos" value={F(cargosCuenta)} color="#EF4444" icon={<TrendingUp size={16} />} />
        <KpiCard label="Abonos" value={F(abonosCuenta)} color="#57FF9A" icon={<Banknote size={16} />} />
        <KpiCard label="Conciliados" value={`${conciliadosCuenta}/${movsCuenta.length}`} color="#3B82F6" icon={<CheckCircle size={16} />} />
      </div>

      {/* Toolbar — Conciliacion v2 con botones contextuales por cuenta */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" ref={fileRef} accept=".pdf,.csv,.xlsx,.xls,.txt" style={{ display: 'none' }} onChange={handleBankUpload} />
        {(activeAccount === 'bbva-mxn' || activeAccount === 'bbva-usd') && (
          <Btn size="sm" variant="primary" onClick={() => { setShowTxtModal(activeAccount); setTxtPayload(''); setTxtPreview(null); setTxtSummary(null); }}>
            {processing ? '⏳ Procesando...' : <><Upload size={12} /> Pegar TXT {activeAcc.label}</>}
          </Btn>
        )}
        {activeAccount === 'banorte-mxn' && (
          <Btn size="sm" variant="primary" onClick={() => fileRef.current?.click()}>
            {processing ? '⏳ Procesando...' : <><Upload size={12} /> Subir PDF Banorte</>}
          </Btn>
        )}
        <Btn size="sm" variant="default" onClick={() => setShowManual(!showManual)}>
          <Plus size={12} /> Manual
        </Btn>
        {(() => {
          const ultima = getUltimaFechaCuenta(activeAccount)
          return ultima ? (
            <span style={{ fontSize: 10, color: '#888', marginLeft: 4 }}>Última: {ultima}</span>
          ) : (
            <span style={{ fontSize: 10, color: '#555', marginLeft: 4 }}>Sin movimientos previos</span>
          )
        })()}

        {/* Filtro */}
        {bankMovements.length > 0 && (
          <div style={{ display: 'flex', gap: 2, marginLeft: 'auto', background: '#141414', borderRadius: 8, padding: 2, border: '1px solid #222' }}>
            {(['todos', 'pendientes', 'conciliados'] as const).map(f => (
              <button key={f} onClick={() => { setFiltro(f); setSelected(new Set()) }} style={{
                padding: '4px 10px', fontSize: 11, fontWeight: filtro === f ? 600 : 400,
                color: filtro === f ? '#fff' : '#666',
                background: filtro === f ? '#333' : 'transparent',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
              }}>{f}</button>
            ))}
          </div>
        )}

        {status && <span style={{ fontSize: 11, color: status.startsWith('✓') ? '#57FF9A' : status.startsWith('Error') ? '#EF4444' : '#888' }}>{status}</span>}
      </div>

      {/* Banner de cuadre de totales (aparece después de upload con expected_totals del PDF) */}
      {lastCheck && lastCheck.expected && (
        <div style={{
          padding: '10px 14px', marginBottom: 16, borderRadius: 8, fontSize: 11,
          background: lastCheck.cuadra ? 'rgba(87,255,154,0.06)' : 'rgba(239,68,68,0.06)',
          border: `1px solid ${lastCheck.cuadra ? 'rgba(87,255,154,0.2)' : 'rgba(239,68,68,0.25)'}`,
          color: lastCheck.cuadra ? '#57FF9A' : '#f87171',
          display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <strong>{lastCheck.cuadra ? '✓ Extracción cuadra con el PDF' : '⚠ Extracción NO cuadra con los totales del PDF'}</strong>
          <span style={{ color: '#888' }}>
            Cargos: <strong style={{ color: lastCheck.cargos_sum_ok ? '#57FF9A' : '#f87171' }}>{F(lastCheck.sum_cargos_extraido)}</strong>
            {' / esperado '}{F(lastCheck.expected.cargos_total)}
            {' ('}{lastCheck.count_cargos_extraido}/{lastCheck.expected.cargos_count} mov{')'}
          </span>
          <span style={{ color: '#888' }}>
            Abonos: <strong style={{ color: lastCheck.abonos_sum_ok ? '#57FF9A' : '#f87171' }}>{F(lastCheck.sum_abonos_extraido)}</strong>
            {' / esperado '}{F(lastCheck.expected.abonos_total)}
            {' ('}{lastCheck.count_abonos_extraido}/{lastCheck.expected.abonos_count} mov{')'}
          </span>
          <button
            onClick={() => setLastCheck(null)}
            style={{ marginLeft: 'auto', fontSize: 10, color: '#666', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >Ocultar</button>
        </div>
      )}

      {/* Manual entry form */}
      {showManual && (
        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Agregar movimiento manual</div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 120px 100px', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Fecha</div>
              <input type="date" value={manual.fecha} onChange={e => setManual(m => ({ ...m, fecha: e.target.value }))} style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit' }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Concepto</div>
              <input value={manual.concepto} onChange={e => setManual(m => ({ ...m, concepto: e.target.value }))} placeholder="Descripción del movimiento" style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit' }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Beneficiario</div>
              <input value={manual.beneficiario} onChange={e => setManual(m => ({ ...m, beneficiario: e.target.value }))} placeholder="Persona o empresa" style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit' }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Monto</div>
              <input type="number" value={manual.monto} onChange={e => setManual(m => ({ ...m, monto: e.target.value }))} placeholder="0.00" style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit', textAlign: 'right' }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Tipo</div>
              <select value={manual.tipo} onChange={e => setManual(m => ({ ...m, tipo: e.target.value as 'cargo' | 'abono' }))} style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit' }}>
                <option value="cargo">Cargo</option>
                <option value="abono">Abono</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <div>
              <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Categoría</div>
              <select value={manual.categoria} onChange={e => setManual(m => ({ ...m, categoria: e.target.value }))} style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit' }}>
                {['nomina', 'proveedor', 'cobro_cliente', 'impuestos', 'comision', 'traspaso', 'prestamo', 'suscripcion', 'otro'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>Proyecto</div>
              <select value={manual.proyecto} onChange={e => setManual(m => ({ ...m, proyecto: e.target.value }))} style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: '#0a0a0a', border: '1px solid #333', borderRadius: 6, color: '#fff', fontFamily: 'inherit' }}>
                <option value="">Sin proyecto</option>
                {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Btn size="sm" variant="primary" onClick={addManual}>Agregar</Btn>
              <Btn size="sm" variant="default" onClick={() => setShowManual(false)}>Cancelar</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Batch actions */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', padding: '8px 12px', background: 'rgba(87,255,154,0.05)', border: '1px solid rgba(87,255,154,0.15)', borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: '#57FF9A', fontWeight: 600 }}>{selected.size} seleccionado{selected.size > 1 ? 's' : ''}</span>
          <Btn size="sm" variant="primary" onClick={conciliarSelected}><CheckCircle size={11} /> Conciliar</Btn>
          <Btn size="sm" variant="default" onClick={deleteSelected} style={{ color: '#EF4444', borderColor: '#EF4444' }}><X size={11} /> Eliminar</Btn>
          <button onClick={() => setSelected(new Set())} style={{ marginLeft: 'auto', fontSize: 11, color: '#666', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Deseleccionar</button>
        </div>
      )}

      {/* Project summary bar */}
      {bankMovements.length > 0 && projectMap.size > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {Array.from(projectMap.entries()).filter(([k]) => k !== 'Sin proyecto').sort((a, b) => b[1].count - a[1].count).slice(0, 8).map(([proy, d]) => (
            <div key={proy} style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, padding: '6px 10px', fontSize: 11 }}>
              <span style={{ color: '#fff', fontWeight: 600 }}>{proy}</span>
              <span style={{ color: '#666', marginLeft: 6 }}>{d.count} mov</span>
              {d.abonos > 0 && <span style={{ color: '#57FF9A', marginLeft: 6 }}>+{F(d.abonos)}</span>}
              {d.cargos > 0 && <span style={{ color: '#EF4444', marginLeft: 6 }}>-{F(d.cargos)}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {bankMovements.length === 0 ? (
        <EmptyState message="Sube un estado de cuenta (PDF de BBVA/Banorte, CSV o Excel) para iniciar la conciliación automática" />
      ) : (
        <Table>
          <thead><tr>
            <Th><input type="checkbox" checked={allSelected} onChange={toggleAll} style={chkStyle} /></Th>
            <Th>Fecha</Th><Th>Concepto</Th><Th>Beneficiario</Th><Th>Proyecto</Th><Th>Categoría</Th><Th right>Cargo</Th><Th right>Abono</Th><Th>Match</Th><Th></Th>
          </tr></thead>
          <tbody>
            {filtered.map(m => {
              const match = !m.conciliado ? findMatch(m) : (m.factura_match_info ? { id: m.factura_match_id || '', info: m.factura_match_info } : null)
              const isExpanded = expandedId === m.id
              return (
                <React.Fragment key={m.id}>
                  <tr style={{ opacity: m.conciliado ? 0.55 : 1, background: selected.has(m.id) ? 'rgba(87,255,154,0.04)' : undefined }}>
                    <Td><input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleOne(m.id)} style={chkStyle} /></Td>
                    <Td muted>{m.fecha}</Td>
                    <Td>
                      <span style={{ color: '#ccc', fontSize: 12, cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : m.id)}>
                        {m.concepto.length > 40 ? m.concepto.substring(0, 40) + '...' : m.concepto}
                      </span>
                    </Td>
                    <Td muted>{m.beneficiario || '—'}</Td>
                    <Td>
                      {(m.proyecto_codigo || m.proyecto_sugerido) ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          {m.proyecto_codigo && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4,
                              background: 'rgba(87,255,154,0.12)', border: '1px solid rgba(87,255,154,0.3)',
                              color: '#57FF9A', fontFamily: 'monospace', letterSpacing: 0.3,
                            }}>{m.proyecto_codigo}</span>
                          )}
                          {m.proyecto_sugerido && <Badge label={m.proyecto_sugerido} color="#3B82F6" />}
                        </span>
                      ) : (
                        <span style={{ color: '#444' }}>—</span>
                      )}
                    </Td>
                    <Td><Badge label={m.categoria_sugerida || 'otro'} color={catColors[m.categoria_sugerida || 'otro'] || '#555'} /></Td>
                    <Td right>{m.tipo === 'cargo' ? <span style={{ color: '#EF4444' }}>{F(m.monto)}</span> : ''}</Td>
                    <Td right>{m.tipo === 'abono' ? <span style={{ color: '#57FF9A' }}>{F(m.monto)}</span> : ''}</Td>
                    <Td>{match ? <span style={{ fontSize: 10, color: '#3B82F6', cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : m.id)}>🔗 Ver</span> : <span style={{ fontSize: 10, color: '#444' }}>—</span>}</Td>
                    <Td>
                      <button
                        onClick={() => {
                          if (!m.conciliado && match) {
                            setBankMovements(bankMovements.map(x => x.id === m.id ? { ...x, conciliado: true, factura_match_id: match.id, factura_match_info: match.info } : x))
                            dbUpdate(m.id, { conciliado: true, factura_match_id: match.id, factura_match_info: match.info })
                          } else {
                            toggleConciliar(m.id)
                          }
                        }}
                        style={{
                          padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                          border: m.conciliado ? '1px solid #333' : '1px solid rgba(87,255,154,0.3)',
                          background: m.conciliado ? '#1a1a1a' : 'rgba(87,255,154,0.08)',
                          color: m.conciliado ? '#666' : '#57FF9A', fontFamily: 'inherit',
                        }}
                      >
                        {m.conciliado ? 'Desconciliar' : 'Conciliar ✓'}
                      </button>
                    </Td>
                  </tr>
                  {/* Expanded row */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={10} style={{ padding: '8px 16px', background: '#0d0d0d', borderBottom: '1px solid #1a1a1a' }}>
                        <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}><strong style={{ color: '#aaa' }}>Concepto completo:</strong> {m.concepto}</div>
                        {m.referencia && <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}><strong style={{ color: '#aaa' }}>Referencia:</strong> {m.referencia}</div>}
                        {m.rfc_contraparte && <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}><strong style={{ color: '#aaa' }}>RFC:</strong> <span style={{ fontFamily: 'monospace' }}>{m.rfc_contraparte}</span></div>}
                        {(m.banco || m.cuenta) && <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}><strong style={{ color: '#aaa' }}>Banco/Cuenta:</strong> {m.banco} {m.cuenta && `· ${m.cuenta}`}</div>}
                        {match && (
                          <div style={{ fontSize: 11, color: '#3B82F6', marginTop: 6, padding: '6px 10px', background: 'rgba(59,130,246,0.06)', borderRadius: 6, border: '1px solid rgba(59,130,246,0.15)' }}>
                            <strong>Match sugerido:</strong> {match.info}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </Table>
      )}

      {/* Modal TXT — Conciliacion v2 */}
      {showTxtModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={() => { if (!processing) { setShowTxtModal(null); setTxtPayload(''); setTxtPreview(null); setTxtSummary(null); } }}>
          <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 14, padding: 24, width: '100%', maxWidth: 1100, maxHeight: '90vh', overflowY: 'auto' as const }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Ingesta TXT — {ACCOUNTS[showTxtModal].label}</div>
                <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>Cuenta {ACCOUNTS[showTxtModal].cuenta}</div>
              </div>
              <button onClick={() => { setShowTxtModal(null); setTxtPayload(''); setTxtPreview(null); setTxtSummary(null); }} disabled={processing} style={{ background: 'none', border: 'none', color: '#666', cursor: processing ? 'not-allowed' : 'pointer', fontSize: 20 }}>×</button>
            </div>

            {(() => {
              const ultima = getUltimaFechaCuenta(showTxtModal)
              return (
                <div style={{ background: ultima ? '#0e1f2b' : '#1f1a0e', border: '1px solid ' + (ultima ? '#1e3a5f' : '#3a2d1e'), borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 11, color: ultima ? '#7dd3fc' : '#fbbf24' }}>
                  {ultima
                    ? <>📅 Última transacción registrada: <b>{ultima}</b>. Se ignorarán movimientos con fecha ≤ a esta.</>
                    : <>⚠️ Primera importación para esta cuenta. Se importarán todos los movimientos del TXT.</>}
                </div>
              )
            })()}

            {!txtPreview && (
              <>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Pega el TSV del portal BBVA (Día ⇥ Concepto ⇥ cargo ⇥ Abono ⇥ Saldo):</div>
                <textarea
                  value={txtPayload}
                  onChange={e => setTxtPayload(e.target.value)}
                  disabled={processing}
                  placeholder={'Día\tConcepto / Referencia\tcargo\tAbono\tSaldo\n31-03-2026\tUBER RIDE/...\t129.95\t\t385,811.65\n...'}
                  style={{ width: '100%', minHeight: 280, background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 8, padding: 12, color: '#ddd', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' as const }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <div style={{ fontSize: 10, color: '#666' }}>{txtPayload.length} caracteres · ~{txtPayload.split('\n').filter(l => l.trim()).length - 1} filas</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn size="sm" variant="default" onClick={() => { setShowTxtModal(null); setTxtPayload(''); }} disabled={processing}>Cancelar</Btn>
                    <Btn size="sm" variant="primary" onClick={handleTxtProcess} disabled={processing || !txtPayload.trim()}>
                      {processing ? '⏳ Procesando...' : 'Procesar con AI'}
                    </Btn>
                  </div>
                </div>
                {status && <div style={{ fontSize: 11, color: status.startsWith('Error') ? '#ef4444' : '#888', marginTop: 10 }}>{status}</div>}
              </>
            )}

            {txtPreview && (
              <>
                {/* Banner de cuadre */}
                {txtSummary?.totals_check && (
                  <div style={{ background: txtSummary.totals_check.cuadra ? '#0e2a1a' : '#2a1a1a', border: '1px solid ' + (txtSummary.totals_check.cuadra ? '#1e5a3a' : '#5a2a2a'), borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 11, color: txtSummary.totals_check.cuadra ? '#86efac' : '#fca5a5' }}>
                    {txtSummary.totals_check.cuadra ? '✓ ' : '⚠ '}
                    Cuadre por delta de saldo: esperado {txtSummary.totals_check.delta_esperado}, calculado {txtSummary.totals_check.delta_calculado}
                    {txtSummary.totals_check.delta_diff != null && !txtSummary.totals_check.cuadra && ' · diff ' + txtSummary.totals_check.delta_diff}
                  </div>
                )}

                {/* Warnings */}
                {txtSummary?.warnings && txtSummary.warnings.length > 0 && (
                  <div style={{ background: '#2a1f0e', border: '1px solid #5a3a1e', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 10, color: '#fcd34d' }}>
                    {txtSummary.warnings.map((w: string, i: number) => <div key={i}>⚠ {w}</div>)}
                  </div>
                )}

                {/* Stats confianza */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, fontSize: 11 }}>
                  <div style={{ background: '#0e2a1a', border: '1px solid #1e5a3a', color: '#86efac', padding: '6px 10px', borderRadius: 6 }}>
                    🟢 Alta: {txtPreview.filter((m: any) => m.confianza_autodetect === 'alta').length}
                  </div>
                  <div style={{ background: '#2a250e', border: '1px solid #5a4e1e', color: '#fcd34d', padding: '6px 10px', borderRadius: 6 }}>
                    🟡 Media: {txtPreview.filter((m: any) => m.confianza_autodetect === 'media').length}
                  </div>
                  <div style={{ background: '#2a1a1a', border: '1px solid #5a2a2a', color: '#fca5a5', padding: '6px 10px', borderRadius: 6 }}>
                    🔴 Baja: {txtPreview.filter((m: any) => m.confianza_autodetect === 'baja').length}
                  </div>
                  <div style={{ marginLeft: 'auto', color: '#888', padding: '6px 0' }}>Total: {txtPreview.length} movimientos</div>
                </div>

                {/* Tabla preview */}
                <div style={{ maxHeight: 380, overflowY: 'auto' as const, border: '1px solid #2a2a2a', borderRadius: 8, marginBottom: 12 }}>
                  <table style={{ width: '100%', fontSize: 10, color: '#ccc', borderCollapse: 'collapse' as const }}>
                    <thead style={{ position: 'sticky' as const, top: 0, background: '#1a1a1a' }}>
                      <tr>
                        <th style={{ padding: 8, textAlign: 'left' as const, borderBottom: '1px solid #2a2a2a' }}>Fecha</th>
                        <th style={{ padding: 8, textAlign: 'left' as const, borderBottom: '1px solid #2a2a2a' }}>Concepto</th>
                        <th style={{ padding: 8, textAlign: 'left' as const, borderBottom: '1px solid #2a2a2a' }}>Beneficiario</th>
                        <th style={{ padding: 8, textAlign: 'left' as const, borderBottom: '1px solid #2a2a2a' }}>Proy</th>
                        <th style={{ padding: 8, textAlign: 'left' as const, borderBottom: '1px solid #2a2a2a' }}>Categoría</th>
                        <th style={{ padding: 8, textAlign: 'right' as const, borderBottom: '1px solid #2a2a2a' }}>Cargo</th>
                        <th style={{ padding: 8, textAlign: 'right' as const, borderBottom: '1px solid #2a2a2a' }}>Abono</th>
                        <th style={{ padding: 8, textAlign: 'center' as const, borderBottom: '1px solid #2a2a2a' }}>Conf.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txtPreview.map((m: any, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                          <td style={{ padding: 8 }}>{m.fecha}</td>
                          <td style={{ padding: 8, maxWidth: 280, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }}>{m.concepto}</td>
                          <td style={{ padding: 8, color: '#aaa' }}>{m.beneficiario || '—'}</td>
                          <td style={{ padding: 8 }}>{m.proyecto_codigo || m.proyecto_nombre || '—'}</td>
                          <td style={{ padding: 8, color: '#888' }}>{m.categoria || '—'}</td>
                          <td style={{ padding: 8, textAlign: 'right' as const, color: '#fca5a5' }}>{m.tipo === 'cargo' ? F(m.monto) : ''}</td>
                          <td style={{ padding: 8, textAlign: 'right' as const, color: '#86efac' }}>{m.tipo === 'abono' ? F(m.monto) : ''}</td>
                          <td style={{ padding: 8, textAlign: 'center' as const }}>
                            {m.confianza_autodetect === 'alta' ? '🟢' : m.confianza_autodetect === 'media' ? '🟡' : '🔴'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Btn size="sm" variant="default" onClick={() => { setTxtPreview(null); setTxtSummary(null); }}>← Volver a editar</Btn>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn size="sm" variant="default" onClick={() => { setShowTxtModal(null); setTxtPayload(''); setTxtPreview(null); setTxtSummary(null); }}>Cancelar</Btn>
                    <Btn size="sm" variant="primary" onClick={handleTxtConfirm}>✓ Importar {txtPreview.length} movimientos</Btn>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* --------- Tab 3: Supervisi--n Fiscal ------------------------------------------------------------------------------------------------------------ */

function TabSupervision({ invoices }: { invoices: Invoice[] }) {
  const vigentes = invoices.filter(i => i.estado !== 'cancelada').length
  const canceladas = invoices.filter(i => i.estado === 'cancelada').length

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="CFDIs vigentes" value={vigentes} icon={<CheckCircle size={16} />} />
        <KpiCard label="Cancelados" value={canceladas} color="#EF4444" icon={<ShieldCheck size={16} />} />
        <KpiCard label="Con complemento pago" value="1" color="#3B82F6" icon={<FileText size={16} />} />
        <KpiCard label="Alertas activas" value="2" color="#F59E0B" icon={<AlertTriangle size={16} />} />
      </div>

      {/* Alerts */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Alertas activas</div>
        {[
          { title: 'FAC-001: Anticipo sin egreso de aplicacion', desc: 'Riesgo de deducibilidad si no se aplica el anticipo', severity: 'alta', action: 'Crear egreso' },
          { title: '2 facturas recibidas sin validar contra SAT', desc: 'Verificar UUID de facturas de proveedores', severity: 'media', action: 'Validar' },
        ].map((a, i) => (
          <div key={i} style={{
            background: '#141414', border: '1px solid #222', borderRadius: 10,
            padding: '12px 16px', marginBottom: 8,
            borderLeft: `3px solid ${a.severity === 'alta' ? '#EF4444' : '#F59E0B'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 2 }}>
                  â ï¸ {a.title}
                </div>
                <div style={{ fontSize: 11, color: '#666' }}>{a.desc}</div>
              </div>
              <Btn size="sm" variant="default">{a.action}</Btn>
            </div>
          </div>
        ))}
      </div>

      <EmptyState message="Las cadenas de documentos relacionados apareceran conforme se registren facturas con relaciones CFDI" />
    </div>
  )
}

/* --------- Tab 4: Movimientos de Efectivo --------------------------------------------------------------------------------------------- */

function TabEfectivo() {
  const cobros = MOCK_CASH.filter(m => m.tipo === 'cobro_cliente')
  const pagos = MOCK_CASH.filter(m => m.tipo === 'pago_proveedor')
  const nomina = MOCK_CASH.filter(m => m.tipo === 'nomina_efectivo')

  const totalCobros = cobros.reduce((s, m) => s + m.monto, 0)
  const totalPagos = pagos.reduce((s, m) => s + m.monto, 0)
  const totalNomina = nomina.reduce((s, m) => s + m.monto, 0)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Cobros cash (clientes)" value={F(totalCobros)} color="#57FF9A" icon={<DollarSign size={16} />} />
        <KpiCard label="Pagos cash (proveedores)" value={F(totalPagos)} color="#F59E0B" icon={<Banknote size={16} />} />
        <KpiCard label="Nomina cash" value={F(totalNomina)} color="#C084FC" icon={<Users size={16} />} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#666' }}>
          Efectivo neto del mes: <span style={{ color: totalCobros - totalPagos - totalNomina >= 0 ? '#57FF9A' : '#EF4444', fontWeight: 700 }}>
            {F(totalCobros - totalPagos - totalNomina)}
          </span>
        </div>
        <Btn size="sm" variant="primary"><Plus size={12} /> Registrar movimiento</Btn>
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Tipo</Th>
            <Th>Persona</Th>
            <Th>Concepto</Th>
            <Th>Proyecto</Th>
            <Th right>Monto</Th>
          </tr>
        </thead>
        <tbody>
          {MOCK_CASH.map(m => (
            <tr key={m.id}>
              <Td muted>{formatDate(m.fecha)}</Td>
              <Td>
                <Badge
                  label={m.tipo === 'cobro_cliente' ? 'Cobro' : m.tipo === 'pago_proveedor' ? 'Pago' : 'Nomina'}
                  color={m.tipo === 'cobro_cliente' ? '#57FF9A' : m.tipo === 'pago_proveedor' ? '#F59E0B' : '#C084FC'}
                />
              </Td>
              <Td><span style={{ color: '#fff', fontWeight: 500 }}>{m.persona}</span></Td>
              <Td muted>{m.concepto}</Td>
              <Td muted>{m.proyecto_nombre || '—'}</Td>
              <Td right style={{
                fontWeight: 600,
                color: m.direccion === 'ingreso' ? '#57FF9A' : '#ccc',
              }}>
                {m.direccion === 'ingreso' ? '+' : '-'}{F(m.monto)}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

/* --------- Tab 5: Cobranza ------------------------------------------------------------------------------------------------------------------------------------------ */

function TabCobranza() {
  const totalVendido = MOCK_SALES.reduce((s, v) => s + v.monto_total, 0)
  const totalCobrado = MOCK_SALES.reduce((s, v) => s + v.monto_cobrado_total, 0)
  const totalPendiente = MOCK_SALES.reduce((s, v) => s + v.monto_pendiente, 0)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Vendido (confirmado)" value={F(totalVendido)} icon={<FolderOpen size={16} />} />
        <KpiCard label="Cobrado (real)" value={F(totalCobrado)} color="#57FF9A" icon={<CheckCircle size={16} />} />
        <KpiCard label="Pendiente (deben)" value={F(totalPendiente)} color="#EF4444" icon={<AlertTriangle size={16} />} />
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Por venta / proyecto</div>

      <Table>
        <thead>
          <tr>
            <Th>Proyecto</Th>
            <Th right>Venta</Th>
            <Th right>Facturado</Th>
            <Th right>Cobrado</Th>
            <Th right>Pendiente</Th>
            <Th>Avance</Th>
          </tr>
        </thead>
        <tbody>
          {MOCK_SALES.map(s => (
            <tr key={s.id} style={{ cursor: 'pointer' }}>
              <Td>
                <div style={{ fontWeight: 600, color: '#fff' }}>{s.proyecto_nombre}</div>
                <div style={{ fontSize: 10, color: '#555' }}>{s.cliente_nombre}</div>
              </Td>
              <Td right muted>{F(s.monto_total)}</Td>
              <Td right muted>{F(s.monto_facturado)}</Td>
              <Td right style={{ color: '#57FF9A', fontWeight: 600 }}>{F(s.monto_cobrado_total)}</Td>
              <Td right style={{ color: '#EF4444', fontWeight: 600 }}>{F(s.monto_pendiente)}</Td>
              <Td>
                {/* Stacked bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 140 }}>
                  <div style={{ flex: 1, height: 8, background: '#2a2a2a', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                    {/* Cobrado banco */}
                    <div style={{
                      width: `${Math.min(100, (s.monto_cobrado_total / s.monto_total) * 100)}%`,
                      height: '100%', background: '#1D9E75',
                    }} />
                    {/* Facturado sin cobrar */}
                    <div style={{
                      width: `${Math.max(0, ((s.monto_facturado - s.monto_cobrado_total) / s.monto_total) * 100)}%`,
                      height: '100%', background: '#EF9F27', opacity: 0.6,
                    }} />
                  </div>
                  <span style={{ fontSize: 11, color: '#666', minWidth: 30 }}>{s.porcentaje_cobrado}%</span>
                </div>
              </Td>
            </tr>
          ))}
          <tr style={{ background: '#1a1a1a' }}>
            <Td><span style={{ fontWeight: 700, color: '#666', fontSize: 11 }}>TOTAL</span></Td>
            <Td right style={{ fontWeight: 700, color: '#fff' }}>{F(totalVendido)}</Td>
            <Td right muted>{F(MOCK_SALES.reduce((s, v) => s + v.monto_facturado, 0))}</Td>
            <Td right style={{ fontWeight: 700, color: '#57FF9A' }}>{F(totalCobrado)}</Td>
            <Td right style={{ fontWeight: 700, color: '#EF4444' }}>{F(totalPendiente)}</Td>
            <Td>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#57FF9A' }}>
                {Math.round((totalCobrado / totalVendido) * 100)}%
              </span>
            </Td>
          </tr>
        </tbody>
      </Table>
    </div>
  )
}

/* --------- Tab 6: Flujo de Efectivo --------------------------------------------------------------------------------------------------------------- */

function TabFlujo() {
  const [view, setView] = useState<'proyecto' | 'mensual'>('proyecto')

  const gastosFijos = 362000
  const oc = 216456
  const factPorPagar = 24000
  const totalEgresos = gastosFijos + oc + factPorPagar

  const hitosCobro = 320000
  const factPorCobrar = 201000
  const efectivoEsperado = 50000
  const totalIngresos = hitosCobro + factPorCobrar + efectivoEsperado

  const gap = totalIngresos - totalEgresos
  const saldoBancario = 584567

  const subtotalObra = MOCK_PROJECT_ACCOUNTS.reduce((s, p) => s + p.utilidad, 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        <Btn size="sm" variant={view === 'proyecto' ? 'primary' : 'default'} onClick={() => setView('proyecto')}>
          <FolderOpen size={12} /> Por proyecto
        </Btn>
        <Btn size="sm" variant={view === 'mensual' ? 'primary' : 'default'} onClick={() => setView('mensual')}>
          <TrendingUp size={12} /> Mensual
        </Btn>
      </div>

      {view === 'proyecto' ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Estado de cuenta por proyecto</div>
          <Table>
            <thead>
              <tr>
                <Th>Proyecto</Th>
                <Th right>Venta</Th>
                <Th right>Cobrado</Th>
                <Th right>Gastado</Th>
                <Th right>Utilidad</Th>
                <Th right>Margen</Th>
              </tr>
            </thead>
            <tbody>
              {MOCK_PROJECT_ACCOUNTS.map((p, i) => (
                <tr key={i} style={{ cursor: 'pointer' }}>
                  <Td><span style={{ fontWeight: 600, color: '#fff' }}>{p.proyecto_nombre}</span></Td>
                  <Td right muted>{F(p.venta_total)}</Td>
                  <Td right style={{ color: '#57FF9A' }}>{F(p.ingreso_total)}</Td>
                  <Td right style={{ color: '#F59E0B' }}>{F(p.egreso_total)}</Td>
                  <Td right style={{ fontWeight: 700, color: p.utilidad >= 0 ? '#57FF9A' : '#EF4444' }}>
                    {p.utilidad >= 0 ? '+' : ''}{F(p.utilidad)}
                  </Td>
                  <Td right>
                    <span style={{
                      fontSize: 12, fontWeight: 700,
                      color: p.margen >= 30 ? '#57FF9A' : p.margen >= 0 ? '#F59E0B' : '#EF4444',
                    }}>
                      {p.margen >= 0 ? '' : ''}{p.margen}%
                    </span>
                  </Td>
                </tr>
              ))}
              <tr style={{ background: '#1a1a1a' }}>
                <Td><span style={{ fontWeight: 700, color: '#666', fontSize: 11 }}>SUBTOTAL OBRAS</span></Td>
                <Td right style={{ fontWeight: 700, color: '#fff' }}>{F(MOCK_PROJECT_ACCOUNTS.reduce((s, p) => s + p.venta_total, 0))}</Td>
                <Td right style={{ fontWeight: 700, color: '#57FF9A' }}>{F(MOCK_PROJECT_ACCOUNTS.reduce((s, p) => s + p.ingreso_total, 0))}</Td>
                <Td right style={{ fontWeight: 700, color: '#F59E0B' }}>{F(MOCK_PROJECT_ACCOUNTS.reduce((s, p) => s + p.egreso_total, 0))}</Td>
                <Td right style={{ fontWeight: 700, color: '#57FF9A' }}>+{F(subtotalObra)}</Td>
                <Td right style={{ fontWeight: 700, color: '#57FF9A' }}>
                  {Math.round((subtotalObra / MOCK_PROJECT_ACCOUNTS.reduce((s, p) => s + p.ingreso_total, 0)) * 100)}%
                </Td>
              </tr>
              <tr>
                <Td><span style={{ color: '#666' }}>OMM — Gastos generales</span></Td>
                <Td right muted>—</Td>
                <Td right muted>—</Td>
                <Td right style={{ color: '#F59E0B' }}>{F(gastosFijos)}</Td>
                <Td right style={{ fontWeight: 700, color: '#EF4444' }}>-{F(gastosFijos)}</Td>
                <Td right muted>—</Td>
              </tr>
              <tr style={{ background: '#1a1a1a', borderTop: '2px solid #333' }}>
                <Td><span style={{ fontWeight: 700, color: '#fff', fontSize: 13 }}>TOTAL EMPRESA</span></Td>
                <Td right colSpan={3}>{' '}</Td>
                <Td right style={{ fontSize: 16, fontWeight: 700, color: subtotalObra - gastosFijos >= 0 ? '#57FF9A' : '#EF4444' }}>
                  {subtotalObra - gastosFijos >= 0 ? '+' : ''}{F(subtotalObra - gastosFijos)}
                </Td>
                <Td right>{' '}</Td>
              </tr>
            </tbody>
          </Table>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 20, marginBottom: 24 }}>
            {/* Egresos */}
            <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#EF4444', marginBottom: 12 }}>Debo pagar</div>
              {[
                { label: 'Gastos fijos', value: gastosFijos },
                { label: 'Ordenes de compra', value: oc },
                { label: 'Facturas por pagar', value: factPorPagar },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <span style={{ fontSize: 12, color: '#888' }}>{item.label}</span>
                  <span style={{ fontSize: 12, color: '#ccc', fontWeight: 500 }}>{F(item.value)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', marginTop: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#EF4444' }}>Total</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#EF4444' }}>{F(totalEgresos)}</span>
              </div>
            </div>

            {/* Gap */}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: gap >= 0 ? '#57FF9A11' : '#EF444411',
              border: `1px solid ${gap >= 0 ? '#57FF9A33' : '#EF444433'}`,
              borderRadius: 12, padding: '16px 24px', minWidth: 140,
            }}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>GAP DEL MES</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: gap >= 0 ? '#57FF9A' : '#EF4444' }}>
                {gap >= 0 ? '+' : ''}{F(gap)}
              </div>
              <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>Abril 2026</div>
            </div>

            {/* Ingresos */}
            <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#57FF9A', marginBottom: 12 }}>Debo cobrar</div>
              {[
                { label: 'Hitos de cobro', value: hitosCobro },
                { label: 'Facturas pendientes', value: factPorCobrar },
                { label: 'Efectivo esperado', value: efectivoEsperado },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <span style={{ fontSize: 12, color: '#888' }}>{item.label}</span>
                  <span style={{ fontSize: 12, color: '#ccc', fontWeight: 500 }}>{F(item.value)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', marginTop: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#57FF9A' }}>Total</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#57FF9A' }}>{F(totalIngresos)}</span>
              </div>
            </div>
          </div>

          <div style={{
            background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '12px 16px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, color: '#666' }}>Saldo actual en bancos: <span style={{ color: '#fff', fontWeight: 600 }}>{F(saldoBancario)}</span></span>
            <span style={{ fontSize: 12, color: '#666' }}>Saldo proyectado al cierre: <span style={{ color: '#57FF9A', fontWeight: 700 }}>{F(saldoBancario + gap)}</span></span>
          </div>
        </>
      )}
    </div>
  )
}
