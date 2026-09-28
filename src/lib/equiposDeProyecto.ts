// ═══════════════════════════════════════════════════════════════════════════
//  equiposDeProyecto — quién puede ser dueño de una cotización o un proyecto.
//
//  Regla de Elias: "Los proyectos y cotizaciones solo los hacen los equipos de
//  proyecto de oficina. Iluminación es Juan Pablo y su equipo, Especiales
//  Alfredo y su equipo, Eléctricas Ricardo y su equipo. En todas puedo ser
//  asignado yo."
//
//  El selector de Dueño listaba el padrón COMPLETO — los 13 oficiales y
//  chalanes de obra, los 8 instaladores, el chofer, ventas de NULED y Casa
//  Luce. Nadie de esos cotiza. Peor, ofrecía dos Alfredos seguidos:
//
//    ALFREDO SANCHEZ HUERTA          [DIRECTOR INSTALADORES]  ← obra
//    LUIS ALFREDO ROSAS VILLICAÑA    [DIRECTOR INSTALACIONES ESPECIALES] ← el que cotiza
//
//  y el primero aparece antes en la lista alfabética. Un selector que ofrece
//  la respuesta equivocada más arriba que la correcta no es solo ruido.
//
//  ⚠️ Dos áreas se parecen y NO son la misma:
//    'INGENIERIAS ESPECIALES'   → oficina, cotiza      (Alfredo Rosas)
//    'INSTALACIONES ESPECIALES' → obra, NO cotiza      (Alfredo Sánchez)
//  Por eso la comparación es exacta sobre el nombre completo del área.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Especialidad de la cotización/proyecto → áreas de `employees` que la trabajan.
 *
 * `cort` va con Iluminación y `proy` con las tres ingenierías: así estaba ya en
 * Proyectos y así se queda. `dist` lo definió Elias (2026-09-28): Especiales.
 */
export const AREAS_POR_ESPECIALIDAD: Record<string, string[]> = {
  esp:  ['INGENIERIAS ESPECIALES'],
  elec: ['INGENIERIAS ELECTRICAS'],
  ilum: ['ILUMINACION'],
  cort: ['ILUMINACION'],
  dist: ['INGENIERIAS ESPECIALES'],
  proy: ['INGENIERIAS ESPECIALES', 'INGENIERIAS ELECTRICAS', 'ILUMINACION'],
}

/**
 * El DG entra en todas. Se reconoce por el PUESTO, no por el área (Elias está
 * en ADMINISTRACION) y no por `role`, que vale 'instalador' para los 32
 * empleados —incluido él— y por lo tanto no distingue nada.
 */
export const PUESTO_DG = 'DIRECTOR GENERAL'

export interface EmpleadoAsignable {
  id: string
  area?: string | null
  puesto?: string | null
}

const norm = (s: string | null | undefined) => (s || '').trim().toUpperCase()

/** true si este empleado puede ser dueño de algo de esta especialidad. */
export function puedeSerDueno(specialty: string | null | undefined, e: EmpleadoAsignable): boolean {
  if (norm(e.puesto) === PUESTO_DG) return true
  const areas = specialty ? AREAS_POR_ESPECIALIDAD[specialty] : null
  if (!areas) return true // especialidad que no conocemos: no esconder a nadie
  return areas.some(a => norm(a) === norm(e.area))
}

/**
 * El equipo que puede tomar esta especialidad.
 *
 * `dueñoActual` se incluye SIEMPRE aunque ya no pertenezca al equipo: si alguien
 * cambió de área después de que le asignaron la cotización, y su opción
 * desaparece de la lista, el <select> se queda sin valor que empatar y el
 * renglón se ve "Sin asignar" aunque en la base tenga dueño. Peor: el primer
 * clic en ese selector le borraría el dueño de verdad.
 */
export function equipoDe<T extends EmpleadoAsignable>(
  specialty: string | null | undefined,
  empleados: T[],
  duenoActual?: string | null,
): T[] {
  return empleados.filter(e => puedeSerDueno(specialty, e) || (!!duenoActual && e.id === duenoActual))
}
