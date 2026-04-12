import { ProjectLine, QuoteStage, ProjectStatus, DeliveryStatus, PaymentStatus, PayrollStatus, UserRole, UserLevel, PurchasePhase } from '../types'

export const F = (n: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

export const FUSD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

export const FCUR = (n: number, currency?: string | null) =>
  (currency === 'USD' ? FUSD : F)(n)


export const PHASE_CONFIG: Record<PurchasePhase, { label: string; color: string; order: number }> = {
  inicio:   { label: 'Inicio',   color: '#3B82F6', order: 0 },
  roughin:  { label: 'Rough-in', color: '#F59E0B', order: 1 },
  acabados: { label: 'Acabados', color: '#C084FC', order: 2 },
  cierre:   { label: 'Cierre',   color: '#57FF9A', order: 3 },
}

export const SPECIALTY_CONFIG: Record<ProjectLine, { label: string; color: string; icon: string }> = {
  esp: { label: 'Especiales', color: '#57FF9A', icon: '◈' },
  elec: { label: 'Eléctrico', color: '#FFB347', icon: '◉' },
  ilum: { label: 'Iluminación', color: '#C084FC', icon: '◇' },
  cort: { label: 'Cortinas', color: '#67E8F9', icon: '▦' },
  proy: { label: 'Proyectos', color: '#F9A8D4', icon: '◎' },
}

export const STAGE_CONFIG: Record<QuoteStage, { label: string; color: string }> = {
  oportunidad: { label: 'Oportunidad', color: '#6B7280' },
  estimacion:  { label: 'Estimación',  color: '#F59E0B' },
  propuesta:   { label: 'Propuesta',   color: '#3B82F6' },
  contrato:    { label: 'Contrato',    color: '#57FF9A' },
}

export const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string }> = {
  activo:     { label: 'Activo',     color: '#57FF9A' },
  pausado:    { label: 'Pausado',    color: '#F59E0B' },
  completado: { label: 'Completado', color: '#6B7280' },
  cancelado:  { label: 'Cancelado',  color: '#EF4444' },
}

export const DELIVERY_STATUS_CONFIG: Record<DeliveryStatus, { label: string; color: string }> = {
  pendiente:  { label: 'Pendiente',  color: '#F59E0B' },
  en_ruta:    { label: 'En ruta',    color: '#3B82F6' },
  entregado:  { label: 'Entregado',  color: '#57FF9A' },
  cancelado:  { label: 'Cancelado',  color: '#EF4444' },
}

export const PAYMENT_STATUS_CONFIG: Record<PaymentStatus, { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: '#6B7280' },
  vigente:   { label: 'Vigente',   color: '#3B82F6' },
  vencido:   { label: 'Vencido',   color: '#EF4444' },
  cobrado:   { label: 'Cobrado',   color: '#57FF9A' },
}

export const PAYROLL_STATUS_CONFIG: Record<PayrollStatus, { label: string; color: string }> = {
  borrador: { label: 'Borrador', color: '#6B7280' },
  aprobado: { label: 'Aprobado', color: '#3B82F6' },
  pagado:   { label: 'Pagado',   color: '#57FF9A' },
}

export const ROLE_LABELS: Record<UserRole, string> = {
  dg:           'Director General',
  coordinador:  'Coordinador',
  instalador:   'Instalador',
  admin:        'Administrativo',
  disenador:    'Diseñador',
  ingeniero:    'Ingeniero',
}

export const LEVEL_CONFIG: Record<UserLevel, { label: string; color: string }> = {
  oro:       { label: 'Oro',       color: '#F59E0B' },
  plata:     { label: 'Plata',     color: '#9CA3AF' },
  bronce:    { label: 'Bronce',    color: '#B45309' },
  sin_nivel: { label: 'Sin nivel', color: '#4B5563' },
}

export const calcItemPrice = (cost: number, markup: number) =>
  Math.round(cost * (1 + markup / 100))

export const calcItemTotal = (cost: number, markup: number, qty: number) =>
  Math.round(qty * calcItemPrice(cost, markup))

export const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
