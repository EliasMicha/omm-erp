export type UserRole = 'dg' | 'coordinador' | 'instalador' | 'admin' | 'disenador' | 'ingeniero'
export type UserLevel = 'oro' | 'plata' | 'bronce' | 'sin_nivel'
export type ProjectStatus = 'activo' | 'pausado' | 'completado' | 'cancelado'
export type ProjectLine = 'esp' | 'elec' | 'ilum' | 'cort' | 'proy'
export type ProductType = 'material' | 'labor'
export type ProductSystem = 'Redes' | 'CCTV' | 'Audio' | 'Lutron' | 'Acceso' | 'Somfy' | 'Electrico' | 'Iluminacion' | 'Cortinas' | 'General'
export type QuoteStage = 'oportunidad' | 'estimacion' | 'propuesta' | 'contrato'
export type ReportItemType = 'avance' | 'faltante' | 'freno' | 'material'
export type PayrollFrequency = 'quincenal' | 'semanal'
export type PayrollStatus = 'borrador' | 'aprobado' | 'pagado'
export type DeliveryStatus = 'pendiente' | 'en_ruta' | 'entregado' | 'cancelado'
export type DeliveryType = 'entrega' | 'recoleccion'
export type PaymentStatus = 'pendiente' | 'vigente' | 'vencido' | 'cobrado'
export type PurchasePhase = 'inicio' | 'roughin' | 'acabados' | 'cierre'

export interface Employee {
  id: string
  created_at: string
  name: string
  email?: string
  phone?: string
  role: UserRole
  level: UserLevel
  salary_base: number
  salary_fiscal: number
  is_active: boolean
  hire_date?: string
  skills: string[]
  notes?: string
}

export interface Project {
  id: string
  created_at: string
  name: string
  client_name: string
  client_contact?: string
  address?: string
  status: ProjectStatus
  lines: ProjectLine[]
  contract_value: number
  start_date?: string
  end_date_planned?: string
  end_date_real?: string
  advance_pct: number
  notes?: string
  site_lead_id?: string
}

export interface CatalogProduct {
  id: string
  created_at: string
  name: string
  description?: string
  system?: ProductSystem
  type: ProductType
  specialty: ProjectLine
  provider?: string
  supplier_id?: string
  purchase_phase: PurchasePhase
  unit: string
  cost: number
  markup: number
  is_active: boolean
}

export interface Quotation {
  id: string
  created_at: string
  updated_at: string
  project_id: string
  name: string
  specialty: ProjectLine
  stage: QuoteStage
  client_name?: string
  total: number
  notes?: string
  created_by?: string
  project?: Project
}

export interface QuotationArea {
  id: string
  created_at: string
  quotation_id: string
  name: string
  order_index: number
  subtotal: number
}

export interface QuotationItem {
  id: string
  created_at: string
  area_id: string
  quotation_id: string
  catalog_product_id?: string
  name: string
  description?: string
  system?: ProductSystem
  type: ProductType
  provider?: string
  supplier_id?: string
  purchase_phase: PurchasePhase
  quantity: number
  cost: number
  markup: number
  price: number
  total: number
  installation_cost: number
  order_index: number
}

export interface WorkReport {
  id: string
  created_at: string
  project_id: string
  employee_id: string
  report_date: string
  raw_text?: string
  ai_processed: boolean
  check_in_time?: string
  check_out_time?: string
  check_in_location?: { lat: number; lng: number }
  check_out_location?: { lat: number; lng: number }
  project?: Project
  employee?: Employee
}

export interface PayrollPeriod {
  id: string
  created_at: string
  period_start: string
  period_end: string
  frequency: PayrollFrequency
  status: PayrollStatus
  total_fiscal: number
  total_cash: number
  approved_by?: string
  approved_at?: string
}

export interface PayrollItem {
  id: string
  period_id: string
  employee_id: string
  base_amount: number
  fiscal_amount: number
  cash_amount: number
  punctuality_bonus: number
  deductions: number
  late_minutes: number
  absences: number
  net_total: number
  notes?: string
  employee?: Employee
}

export interface Delivery {
  id: string
  created_at: string
  delivery_date: string
  type: DeliveryType
  origin: string
  destination: string
  material_description?: string
  project_id?: string
  status: DeliveryStatus
  driver_id?: string
  signed_gabriel: boolean
  signed_ivan: boolean
  signed_installer: boolean
  signed_gabriel_at?: string
  signed_ivan_at?: string
  signed_installer_at?: string
  project?: Project
  driver?: Employee
}

export interface PaymentMilestone {
  id: string
  created_at: string
  project_id: string
  quotation_id?: string
  name: string
  percentage?: number
  amount: number
  due_date?: string
  status: PaymentStatus
  paid_at?: string
  payment_method?: string
  notes?: string
  project?: Project
}
