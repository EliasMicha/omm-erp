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


// ═══════════════════════════════════════════════════════════════════════════
// QUIÉN ES RESPONSABLE DE QUÉ
//
// Dictado por la Dirección General. No es una descripción de puesto de RRHH:
// es la frontera que usa el sistema para repartir trabajo y la que lee la IA
// antes de proponer un plan. Si aquí dice que el dibujante no cotiza, ninguna
// automatización le va a mandar una cotización.
//
// El campo `noHace` importa tanto como el de arriba. Un rol definido solo por
// lo que hace se expande hasta comerse el de al lado, y ahí es donde se
// pierde la responsabilidad: cuando dos personas creen que algo era del otro.
// ═══════════════════════════════════════════════════════════════════════════

export interface AlcanceRol {
  resumen: string
  hace: string[]
  noHace: string[]
}

export const ALCANCE_ROL: Record<Rol, AlcanceRol> = {
  director: {
    resumen: 'Responde por el área: plantea, cotiza, revisa todo lo que sale y da la cara con el cliente.',
    hace: [
      'Supervisar y plantear el trabajo del área',
      'Cotizar y armar propuestas nuevas',
      'Seguimiento con el cliente final y con los arquitectos',
      'Entregas formales al cliente',
      'Generar las órdenes de compra cuando una cotización pasa a contrato',
      'Revisión de detalle de TODO entregable —cotizaciones, memorias, sembrados, planos—: la detección de errores es suya',
      'Comunicación con obra y logística cuando hay dudas o falta entendimiento ejecutivo',
    ],
    noHace: [
      'Dibujar en AutoCAD',
      'Ejecutar el detalle técnico que le corresponde al ingeniero o al diseñador',
    ],
  },
  ingeniero: {
    resumen: 'Define CÓMO se resuelve el proyecto a nivel técnico y estético, y cotiza lo que plantea.',
    hace: [
      'Dictar el planteamiento técnico y estético del proyecto y cómo se soluciona en general',
      'Trabajar de la mano del levantamiento con cliente y de las citas de retroalimentación',
      'Generar cotizaciones de lo que plantea — sabe cotizar y es su responsabilidad',
      'Memorias técnicas y de cálculo',
    ],
    noHace: [
      'La revisión final de calidad: eso lo firma el director',
      'El dibujo ejecutivo en AutoCAD',
    ],
  },
  disenador: {
    resumen: 'Resuelve el espacio técnica y estéticamente y lo lleva a ejecutivo al 100%.',
    hace: [
      'Solución técnica y estética de los espacios',
      'Selección de luminarias',
      'Llevar el proyecto a ejecutivo 100%',
      'Generar cotizaciones de lo que diseña',
    ],
    noHace: [
      'La revisión final de calidad: la firma el director',
    ],
  },
  dibujante: {
    resumen: 'Todo lo que es plano: lleva el dibujo a ejecutivo con detalle completo.',
    hace: [
      'Todo lo relacionado con planos en AutoCAD',
      'Llevar el dibujo a nivel ejecutivo con detalle completo',
      'Simbología, cuadros, cortes y detalles del plano',
    ],
    noHace: [
      'Cotizar',
      'Definir el planteamiento técnico: eso lo dicta el ingeniero o el diseñador',
      'Revisión final de calidad',
    ],
  },
  admin: {
    resumen: 'Soporte administrativo del área: facturación, cobranza, compras y control documental.',
    hace: [
      'Facturación y cobranza',
      'Capturar y dar seguimiento a órdenes de compra',
      'Control documental y archivo',
    ],
    noHace: [
      'Contenido técnico de ningún entregable',
    ],
  },
  ventas: {
    resumen: 'Venta de piso y distribución.',
    hace: ['Atención y venta a cliente de mostrador y distribuidores'],
    noHace: ['Ingeniería y planos'],
  },
  campo: {
    resumen: 'Ejecución en obra.',
    hace: ['Instalación y trabajo en sitio', 'Reportes de obra y evidencia'],
    noHace: ['Trabajo de gabinete: planos, cotizaciones y memorias'],
  },
}

// ── Qué se está pidiendo ───────────────────────────────────────────────────
//
// "Cotiza esto" y "haz el proyecto ejecutivo" son cadenas de trabajo
// distintas. Sin distinguirlas, un plan automático se infla — y un plan
// inflado no es inofensivo: son actividades reales que alguien tiene que
// cerrar y que ensucian el cumplimiento de todos.

export interface TipoEncargo {
  key: string
  label: string
  descripcion: string
  /** Lo que la IA debe entender que SÍ entra. */
  termina_en: string
  /** El techo de actividades razonable. */
  maxActividades: number
}

export const TIPOS_ENCARGO: TipoEncargo[] = [
  {
    key: 'cotizacion',
    label: 'Solo cotización',
    descripcion: 'Nos piden precio. NO hay ingeniería ejecutiva ni planos entregables: se cuantifica sobre lo que el cliente mandó y se cotiza.',
    termina_en: 'una propuesta enviada al cliente',
    maxActividades: 5,
  },
  {
    key: 'proyecto',
    label: 'Proyecto ejecutivo',
    descripcion: 'Diseño e ingeniería completos: planteamiento, planos ejecutivos, memorias y entrega formal.',
    termina_en: 'la entrega formal del paquete ejecutivo al cliente',
    maxActividades: 9,
  },
  {
    key: 'levantamiento',
    label: 'Levantamiento en sitio',
    descripcion: 'Ir a ver. Documentar lo existente con fotos y medidas para poder plantear o cotizar después.',
    termina_en: 'el levantamiento documentado y entregado',
    maxActividades: 4,
  },
  {
    key: 'licitacion',
    label: 'Licitación',
    descripcion: 'Concurso con bases y formato obligatorio. La fecha de entrega no se mueve.',
    termina_en: 'la propuesta entregada en el formato y la fecha que exigen las bases',
    maxActividades: 7,
  },
]
