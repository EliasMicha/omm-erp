// ═══════════════════════════════════════════════════════════════════════════
//  acotar.ts — el limite duro de los bots. Se copia igual en cada MCP.
//
//  Regla de Elias: un bot opera el ERP, NUNCA cambia como funciona el ERP.
//  Eso no se sostiene con una frase en el prompt de un bot — un prompt se
//  rodea, con o sin mala intencion. Se sostiene quitando el alcance: si la
//  tabla no esta en la lista, la llamada revienta antes de salir del servidor,
//  aunque una tool futura la pida por error.
//
//  Dos listas por MCP, no una:
//    lectura   — lo que el modulo puede consultar
//    escritura — lo que puede modificar (siempre subconjunto de lectura)
//
//  Y una lista global de CONFIGURACION que ningun MCP puede escribir jamas,
//  ni aunque su autor la incluya por descuido. Es lo que define el
//  comportamiento del ERP: las reglas del cotizador, quien tiene permisos, el
//  precio maestro, las plantillas de las que se generan las tareas. Cambiar
//  cualquiera de esas no es operar el negocio, es reprogramarlo.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Nunca escribibles desde un MCP. Cambiar una de estas altera el
 * comportamiento del ERP para todos, hacia atras y hacia adelante.
 */
export const CONFIGURACION_DEL_ERP = new Set([
  'design_rules',            // las reglas con las que cotiza el ERP
  'app_users',               // quien entra y con que permisos
  'employees',               // el padron y la cadena de mando
  'catalog_products',        // el precio maestro
  'catalog_bundles',
  'catalog_bundle_items',
  'suppliers',               // a quien se le compra y en que moneda
  'supplier_bank_accounts',  // a que cuenta se le paga
  'project_task_templates',
  'project_phase_templates',
  'prerequisitos_catalogo',
  'entregable_tipos',
  'capacitacion_bloques',
  'capacitacion_preguntas',
])

export interface Alcance {
  /** Nombre del MCP, para que el error diga quien se paso de la raya. */
  modulo: string
  lectura: string[]
  escritura: string[]
}

export class FueraDeAlcance extends Error {
  constructor(modulo: string, tabla: string, operacion: 'leer' | 'escribir') {
    super(
      `El MCP ${modulo} no puede ${operacion} ${tabla}. ` +
      (CONFIGURACION_DEL_ERP.has(tabla)
        ? 'Esa tabla define COMO funciona el ERP, y eso no lo cambia un bot: pidelo por escalacion.'
        : 'Esa tabla es de otro modulo: pasa el pendiente al bot que la tiene a su cargo.'),
    )
    this.name = 'FueraDeAlcance'
  }
}

const MUTADORES = new Set(['insert', 'update', 'upsert', 'delete'])

/**
 * Devuelve un cliente de Supabase que solo alcanza las tablas del modulo.
 *
 * El builder de PostgREST encadena devolviendose a si mismo, asi que el
 * envoltorio se propaga a cada eslabon: da igual si la escritura va en
 * .from(t).update(...) o detras de varios .eq() — la llamada pasa por aqui.
 */
export function acotarSupabase(supabase: any, alcance: Alcance): any {
  const lectura = new Set(alcance.lectura)
  // La configuracion se descuenta aunque el modulo la haya listado: el
  // descuido de un autor no deberia poder abrir la puerta.
  const escritura = new Set(alcance.escritura.filter(t => !CONFIGURACION_DEL_ERP.has(t)))

  const envolver = (builder: any, tabla: string): any =>
    new Proxy(builder, {
      get(target, prop: string | symbol) {
        const valor = (target as any)[prop]
        if (typeof prop === 'string' && MUTADORES.has(prop) && !escritura.has(tabla)) {
          throw new FueraDeAlcance(alcance.modulo, tabla, 'escribir')
        }
        if (typeof valor !== 'function') return valor
        return (...args: unknown[]) => {
          const r = (valor as any).apply(target, args)
          // Si sigue siendo builder, sigue acotado. Si ya es la promesa del
          // resultado, se devuelve tal cual.
          return r && typeof r === 'object' && typeof (r as any).then !== 'function' && typeof (r as any).select === 'function'
            ? envolver(r, tabla)
            : r
        }
      },
    })

  return {
    from(tabla: string) {
      if (!lectura.has(tabla)) throw new FueraDeAlcance(alcance.modulo, tabla, 'leer')
      return envolver(supabase.from(tabla), tabla)
    },
    // Las RPC se bloquean enteras: una funcion de Postgres puede tocar
    // cualquier tabla y el nombre no dice cual. Si un modulo necesita una,
    // se agrega aqui a proposito y por nombre.
    rpc(nombre: string) {
      throw new FueraDeAlcance(alcance.modulo, `rpc:${nombre}`, 'escribir')
    },
    /** Para el log de auditoria, que escribe fuera del alcance del modulo. */
    sinAcotar: supabase,
  }
}
