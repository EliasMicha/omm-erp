import { ProjectLine, QuoteStage, ProjectStatus, DeliveryStatus, PaymentStatus, PayrollStatus, UserRole, UserLevel, PurchasePhase } from '../types'

export const F = (n: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

export const FUSD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

export const FCUR = (n: number, currency?: string | null) =>
  (currency === 'USD' ? FUSD : F)(n)


export const PHASE_CONFIG: Record<PurchasePhase, { label: string; color: string; order: number }> = {
  inicio:   { label: 'Inicio',   color: '#2563EB', order: 0 },
  roughin:  { label: 'Rough-in', color: '#D97706', order: 1 },
  acabados: { label: 'Acabados', color: '#A78BFA', order: 2 },
  cierre:   { label: 'Cierre',   color: '#10B981', order: 3 },
}

export const SPECIALTY_CONFIG: Record<ProjectLine, { label: string; color: string; icon: string }> = {
  esp: { label: 'Especiales', color: '#10B981', icon: '◈' },
  elec: { label: 'Eléctrico', color: '#FFB347', icon: '◉' },
  ilum: { label: 'Iluminación', color: '#A78BFA', icon: '◇' },
  cort: { label: 'Cortinas', color: '#67E8F9', icon: '▦' },
  proy: { label: 'Proyectos', color: '#F9A8D4', icon: '◎' },
}

export const STAGE_CONFIG: Record<QuoteStage, { label: string; color: string }> = {
  oportunidad: { label: 'Oportunidad', color: '#6B7280' },
  estimacion:  { label: 'Estimación',  color: '#D97706' },
  propuesta:   { label: 'Propuesta',   color: '#2563EB' },
  contrato:    { label: 'Contrato',    color: '#10B981' },
}

export const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string }> = {
  activo:     { label: 'Activo',     color: '#10B981' },
  pausado:    { label: 'Pausado',    color: '#D97706' },
  completado: { label: 'Completado', color: '#6B7280' },
  cancelado:  { label: 'Cancelado',  color: '#DC2626' },
}

export const DELIVERY_STATUS_CONFIG: Record<DeliveryStatus, { label: string; color: string }> = {
  pendiente:  { label: 'Pendiente',  color: '#D97706' },
  en_ruta:    { label: 'En ruta',    color: '#2563EB' },
  entregado:  { label: 'Entregado',  color: '#10B981' },
  cancelado:  { label: 'Cancelado',  color: '#DC2626' },
}

export const PAYMENT_STATUS_CONFIG: Record<PaymentStatus, { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: '#6B7280' },
  vigente:   { label: 'Vigente',   color: '#2563EB' },
  vencido:   { label: 'Vencido',   color: '#DC2626' },
  cobrado:   { label: 'Cobrado',   color: '#10B981' },
}

export const PAYROLL_STATUS_CONFIG: Record<PayrollStatus, { label: string; color: string }> = {
  borrador: { label: 'Borrador', color: '#6B7280' },
  aprobado: { label: 'Aprobado', color: '#2563EB' },
  pagado:   { label: 'Pagado',   color: '#10B981' },
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
  oro:       { label: 'Oro',       color: '#D97706' },
  plata:     { label: 'Plata',     color: '#9CA3AF' },
  bronce:    { label: 'Bronce',    color: '#B45309' },
  sin_nivel: { label: 'Sin nivel', color: '#4B5563' },
}

export const calcItemPrice = (cost: number, margin: number) =>
  margin >= 100 ? cost : Math.round(cost / (1 - margin / 100) * 100) / 100

export const calcItemTotal = (cost: number, margin: number, qty: number) =>
  Math.round(qty * calcItemPrice(cost, margin) * 100) / 100

export const formatDate = (d: string) => {
  // Forzar interpretación local para fechas sin hora (evita UTC shift)
  const s = d.length === 10 ? d + 'T00:00:00' : d
  return new Date(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}
