// Quién le puede encargar trabajo a quién. Regla ÚNICA de la casa.
//
// El DG no reparte a los 20 al mismo tiempo: encarga al director del área y el
// director reparte adentro. Si el DG quiere bajar a alguien del equipo de ese
// director, puede — pero pasando por el director, no saltándoselo. Así el
// director nunca se entera al final de que le movieron a su gente.
//
// Vive aparte de roles.ts porque necesita AREAS_TRABAJO (que vive en tareas.ts)
// y roles.ts es hoja: nadie la importa desde arriba.
import { EmpleadoRol, Rol, ROLES_GABINETE, ROL_CFG } from './roles'
import { AREAS_TRABAJO } from './tareas'

/** El DG manda sobre todas las áreas y no es el director de ninguna. */
export const esDirectorGeneral = (e?: { puesto?: string | null } | null): boolean =>
  /DIRECTOR\s+GENERAL|DIRECCION\s+GENERAL/i.test(
    (e?.puesto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''))

export interface AreaDeMando {
  specialty: string
  area: string
  label: string
  color: string
  /** El director del área. null = área sin cabeza; hay que nombrar una. */
  director: EmpleadoRol | null
  /** Su gente de gabinete, sin él y sin el DG. */
  equipo: EmpleadoRol[]
}

const esGabinete = (e: EmpleadoRol) => (e.roles || [e.rol]).some(r => ROLES_GABINETE.includes(r))

/**
 * Las áreas con su cabeza y su gente. `specialties` acota (un director ve solo
 * la suya); sin él salen todas, que es lo que ve el DG.
 */
export function cadenaDeMando(emps: EmpleadoRol[], specialties?: string[]): AreaDeMando[] {
  return AREAS_TRABAJO
    .filter(a => !specialties || specialties.includes(a.specialty))
    .map(a => {
      const dentro = emps.filter(e => e.area === a.area && esGabinete(e) && !esDirectorGeneral(e))
      const director = dentro.find(e => e.rol === 'director') || null
      return {
        specialty: a.specialty,
        area: a.area,
        label: a.label,
        color: a.color,
        director,
        equipo: dentro.filter(e => e.id !== director?.id),
      }
    })
}

/** En qué área cae una persona. */
export const areaDePersona = (cadena: AreaDeMando[], personaId?: string | null): AreaDeMando | null =>
  !personaId ? null
    : cadena.find(a => a.director?.id === personaId || a.equipo.some(e => e.id === personaId)) || null

export type Nivel = 'director' | 'equipo'

export interface OpcionDeMando {
  id: string
  nombre: string
  rol: Rol
  rolLabel: string
  areaLabel: string
  color: string
  nivel: Nivel
}

/**
 * A quién se le puede pasar ESTA actividad ahora mismo, en orden de mando.
 *
 * - Sin dueño → solo directores. Se encarga al área, no a una persona suelta.
 * - Con un director → sus directores pares (mover de área) y, ya abierto, su
 *   equipo (bajar un nivel dentro de la misma área).
 * - Con alguien del equipo → su propio director y sus compañeros. Nunca brinca
 *   a otra área sin volver a pasar por un director.
 */
export function aQuienPuedoPasarla(
  cadena: AreaDeMando[],
  duenoActual?: string | null,
): { directores: OpcionDeMando[]; equipo: OpcionDeMando[]; areaActual: AreaDeMando | null } {
  const op = (e: EmpleadoRol, a: AreaDeMando, nivel: Nivel): OpcionDeMando => ({
    id: e.id, nombre: e.name, rol: e.rol,
    rolLabel: (e.roles || [e.rol]).map(r => ROL_CFG[r].label).join(' + '),
    areaLabel: a.label, color: a.color, nivel,
  })
  // Quien ya la trae no se ofrece a si mismo.
  const directores = cadena
    .filter(a => a.director && a.director.id !== duenoActual)
    .map(a => op(a.director as EmpleadoRol, a, 'director'))
  const areaActual = areaDePersona(cadena, duenoActual)
  const equipo = areaActual
    ? areaActual.equipo.filter(e => e.id !== duenoActual).map(e => op(e, areaActual, 'equipo'))
    : []
  return { directores, equipo, areaActual }
}

/** Áreas sin director nombrado: nadie a quién encargarles. */
export const areasSinCabeza = (cadena: AreaDeMando[]) => cadena.filter(a => !a.director)
