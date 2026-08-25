// ═══════════════════════════════════════════════════════════════════════════
// roles — quién hace qué, derivado del puesto que ya está capturado.
//
// No se inventa una tabla de roles nueva: los puestos reales de OMM ya están
// en `employees.puesto` y de ahí sale todo. Una tabla paralela solo agregaría
// un segundo lugar que actualizar y una tercera versión de la verdad.
//
// El rol importa porque el trabajo se reparte por rol, no por persona: una
// plantilla dice "el DIBUJANTE hace el sembrado" y al aplicarse se resuelve
// contra quien tenga ese rol EN ESA ÁREA. Así la misma receta sirve para
// Eléctricas y para Especiales aunque la gente sea distinta.
// ═══════════════════════════════════════════════════════════════════════════

export type Rol = 'director' | 'ingeniero' | 'dibujante' | 'disenador' | 'admin' | 'ventas' | 'campo'

export const ROL_CFG: Record<Rol, { label: string; plural: string; color: string; orden: number }> = {
  director:  { label: 'Director',    plural: 'Directores',  color: '#2563EB', orden: 0 },
  ingeniero: { label: 'Ingeniero',   plural: 'Ingenieros',  color: '#10B981', orden: 1 },
  dibujante: { label: 'Dibujante',   plural: 'Dibujantes',  color: '#67E8F9', orden: 2 },
  disenador: { label: 'Diseñador',   plural: 'Diseñadores', color: '#A78BFA', orden: 3 },
  admin:     { label: 'Administración', plural: 'Administración', color: '#D9A441', orden: 4 },
  ventas:    { label: 'Ventas',      plural: 'Ventas',      color: '#F472B6', orden: 5 },
  campo:     { label: 'Campo',       plural: 'Campo',       color: '#94A3B8', orden: 6 },
}

/** Roles que reciben actividades de gabinete. Campo y ventas trabajan en otros módulos. */
export const ROLES_GABINETE: Rol[] = ['director', 'ingeniero', 'dibujante', 'disenador', 'admin']

const sinAcentos = (s: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()

/**
 * El rol que le toca a un puesto. El orden de las pruebas importa: "DIRECTOR
 * INSTALADORES" es director aunque diga instaladores, y "DIRECCION
 * ADMINISTRATIVA" es director aunque diga administrativa.
 */
export function rolDe(puesto?: string | null): Rol {
  const p = sinAcentos(puesto || '')
  if (!p) return 'admin'
  if (/DIRECTOR|DIRECCION/.test(p)) return 'director'
  if (/INGENIERO/.test(p)) return 'ingeniero'
  if (/DIBUJANTE/.test(p)) return 'dibujante'
  if (/DISENAD/.test(p)) return 'disenador'
  if (/VENTAS/.test(p)) return 'ventas'
  if (/INSTALADOR|OFICIAL|CHALAN|MANTENIMIENTO|CHOFER/.test(p)) return 'campo'
  return 'admin'
}

export const esDirector = (puesto?: string | null) => rolDe(puesto) === 'director'

export interface EmpleadoRol {
  id: string
  name: string
  area?: string | null
  puesto?: string | null
  rol: Rol
}

export const conRol = (e: { id: string; name: string; area?: string | null; puesto?: string | null }): EmpleadoRol =>
  ({ ...e, rol: rolDe(e.puesto) })

/**
 * A quién le toca una actividad de rol X en el área Y.
 *
 * Si hay exactamente una persona con ese rol en el área, se le asigna sola:
 * pedirle al director que elija entre uno es burocracia. Si hay varias, la
 * actividad nace SIN DUEÑO pero con el rol marcado, y el director reparte —
 * porque adivinar a quién le toca es justo lo que rompe la responsabilidad.
 */
export function resolverResponsable(empleados: EmpleadoRol[], rol: Rol, area?: string | null): string | null {
  const candidatos = empleados.filter(e => e.rol === rol && (!area || e.area === area))
  if (candidatos.length === 1) return candidatos[0].id
  // El director de un área es único por definición; si el área no tiene, se
  // deja sin dueño en vez de colgárselo a un director de otra área.
  if (rol === 'director' && candidatos.length > 1) return candidatos[0].id
  return null
}
