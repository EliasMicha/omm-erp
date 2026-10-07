// Bloque 3 — coordinacion del equipo: obra y oficina juntas.
//
// Elias: "quiero que lleve la coordinacion general de tareas de mi equipo
// tanto de obra como de oficina, pero para eso necesito que tenga visibilidad
// general".
//
// Las tareas viven en DOS tablas que no se parecen (project_tasks para
// oficina, obra_actividades para campo), con nombres distintos para lo mismo.
// La vista v_tareas_unificadas las normaliza y es lo que se lee aqui.
//
// ⚠️ EL NUMERO QUE MIENTE
// Las dos mitades fallan al reves: en oficina 784 de 800 abiertas NO tienen
// fecha, asi que "16 vencidas" suena bien y no significa nada — casi nada
// puede llegar tarde si casi nada tiene fecha. En obra si hay fechas y por eso
// se ven 431 vencidas de verdad.
//
// Por eso TODA respuesta de aqui lleva sin_fecha junto a vencidas. Un conteo
// de vencidas sin su sin_fecha al lado es una cifra que tranquiliza y esconde.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Quien } from './tools.ts'

const TOPE = 200

export const DEFINICIONES_EQ = [
  {
    name: 'panorama_equipo',
    annotations: { readOnlyHint: true },
    description:
      'Como viene la carga del equipo: cuantas tareas abiertas, cuantas sin responsable, cuantas sin fecha y ' +
      'cuantas vencidas. Agrupa por persona, area, obra o por donde (oficina/campo). ' +
      'Empiece por aqui cuando le pregunten "como vamos" o "quien esta atorado".',
    inputSchema: {
      type: 'object',
      properties: {
        agrupar_por: { type: 'string', enum: ['donde','persona','area','obra'], description: 'Por defecto donde.' },
      },
    },
  },
  {
    name: 'buscar_tareas',
    annotations: { readOnlyHint: true },
    description:
      'Busca tareas del equipo en oficina y campo a la vez. Sirve para "que trae pendiente Ricardo", ' +
      '"que falta en la obra X", "que esta vencido". Use filtro=sin_dueno para lo que no tiene a quien ' +
      'cobrarle, que en este ERP es la mayoria.',
    inputSchema: {
      type: 'object',
      properties: {
        donde: { type: 'string', enum: ['oficina','obra','ambas'], description: 'Por defecto ambas.' },
        persona: { type: 'string', description: 'Nombre o parte del nombre del responsable.' },
        obra: { type: 'string', description: 'Nombre o parte del nombre de la obra o proyecto.' },
        area: { type: 'string' },
        texto: { type: 'string', description: 'Parte del titulo de la tarea.' },
        filtro: {
          type: 'string', enum: ['abiertas','sin_dueno','sin_fecha','vencidas','todas'],
          description: 'Por defecto abiertas.',
        },
        limite: { type: 'integer', description: 'Por defecto 40, maximo 200.' },
      },
    },
  },
  {
    name: 'asignar_tarea',
    description:
      'Le pone responsable y/o fecha compromiso a una tarea. SIN confirmar=true solo devuelve que tarea es, ' +
      'a quien se le pondria y con que fecha, sin escribir: ensene eso y espere el visto bueno. ' +
      'Asignarle trabajo a una persona con fecha es un compromiso suyo, no del asistente.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id de la tarea.' },
        donde: { type: 'string', enum: ['oficina','obra'], description: 'De cual de las dos mitades es.' },
        responsable: { type: 'string', description: 'Nombre del empleado, o su id. Omitir para no cambiarlo.' },
        fecha: { type: 'string', description: 'AAAA-MM-DD. Omitir para no cambiarla; vacio para quitarla.' },
        confirmar: { type: 'boolean' },
      },
      required: ['id','donde'],
    },
  },
  {
    name: 'directorio_equipo',
    annotations: { readOnlyHint: true },
    description:
      'Quien es quien: empleados con su area y su puesto. Uselo para saber a quien se le puede asignar algo ' +
      'y para no confundir homonimos — hay dos Alfredos y uno es de obra y otro de oficina.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Parte del nombre.' },
        area: { type: 'string' },
      },
    },
  },
]

const texto = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] })
const esUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

/** Busca un empleado por nombre. Devuelve TODOS los parecidos a proposito:
 *  si hay dos, quien pregunta tiene que elegir. Asignarle trabajo al Alfredo
 *  equivocado es un error que nadie detecta hasta que el trabajo no se hizo. */
async function empleadosPorNombre(sb: SupabaseClient, t: string) {
  const limpio = t.replace(/[,()]/g, ' ').trim()
  const { data } = await sb.from('employees').select('id,name,area,puesto')
    .ilike('name', `%${limpio}%`).limit(10)
  return data || []
}

export async function ejecutarEq(nombre: string, args: any, sb: SupabaseClient, _quien: Quien) {
  switch (nombre) {

    case 'panorama_equipo': {
      const por = String(args?.agrupar_por || 'donde')
      const { data, error } = await sb.rpc('panorama_tareas', { p_agrupar: por })
      if (error) return texto({ error: error.message })
      return texto({
        agrupado_por: por,
        como_leerlo:
          'sin_fecha va al lado de vencidas a proposito: donde casi nada tiene fecha, un numero bajo de ' +
          'vencidas no quiere decir que se vaya bien, quiere decir que no se puede medir.',
        grupos: data,
      })
    }

    case 'buscar_tareas': {
      const lim = Math.min(Math.max(Number(args?.limite) || 40, 1), TOPE)
      let q = sb.from('v_tareas_unificadas')
        .select('donde,id,titulo,obra,cliente,area,responsable,estado,fecha_plan,sin_dueno,sin_fecha,vencida')
        .limit(lim)

      const donde = args?.donde || 'ambas'
      if (donde !== 'ambas') q = q.eq('donde', donde)

      const filtro = args?.filtro || 'abiertas'
      if (filtro === 'abiertas')       q = q.eq('abierta', true)
      else if (filtro === 'sin_dueno') q = q.eq('abierta', true).eq('sin_dueno', true)
      else if (filtro === 'sin_fecha') q = q.eq('abierta', true).eq('sin_fecha', true)
      else if (filtro === 'vencidas')  q = q.eq('vencida', true)

      if (args?.persona) q = q.ilike('responsable', `%${String(args.persona).replace(/[,()]/g,' ').trim()}%`)
      if (args?.obra)    q = q.ilike('obra', `%${String(args.obra).replace(/[,()]/g,' ').trim()}%`)
      if (args?.area)    q = q.ilike('area', `%${String(args.area).replace(/[,()]/g,' ').trim()}%`)
      if (args?.texto)   q = q.ilike('titulo', `%${String(args.texto).replace(/[,()]/g,' ').trim()}%`)

      // Lo vencido primero, y dentro de eso lo mas viejo. Una lista de
      // coordinacion ordenada por fecha de creacion no sirve de nada.
      q = q.order('vencida', { ascending: false }).order('fecha_plan', { ascending: true, nullsFirst: false })

      const { data, error } = await q
      if (error) return texto({ error: error.message })
      const filas = data || []
      return texto({
        filtro, donde, devueltas: filas.length,
        aviso: filas.length >= lim
          ? `Hay mas de ${lim}. Esto es una muestra, no el total — use panorama_equipo para la cuenta real.`
          : undefined,
        tareas: filas,
      })
    }

    case 'asignar_tarea': {
      const id = String(args?.id || '')
      const donde = String(args?.donde || '')
      if (!esUuid(id)) return texto({ error: 'El id no es valido.' })
      if (donde !== 'oficina' && donde !== 'obra') return texto({ error: 'donde debe ser oficina u obra.' })

      const tabla = donde === 'oficina' ? 'project_tasks' : 'obra_actividades'
      const colResp = donde === 'oficina' ? 'assignee_id' : 'instalador_id'
      const colFecha = donde === 'oficina' ? 'due_date' : 'fecha_fin_plan'
      const colTitulo = donde === 'oficina' ? 'name' : 'descripcion'

      const { data: tarea } = await sb.from(tabla)
        .select(`id,${colTitulo},${colResp},${colFecha}`).eq('id', id).maybeSingle()
      if (!tarea) return texto({ error: 'No encontre esa tarea en ' + donde + '.' })

      // El responsable es employees.id. OJO: en este ERP conviven tres columnas
      // de identidad distintas —auth.uid(), app_users.id y employees.id— y las
      // tareas usan la tercera. Mandar la equivocada deja la tarea asignada a
      // nadie, o revienta la llave foranea.
      let respId: string | null | undefined
      let respNombre: string | undefined
      if (args?.responsable !== undefined) {
        const r = String(args.responsable).trim()
        if (!r) { respId = null; respNombre = '— se le quita el responsable —' }
        else if (esUuid(r)) {
          const { data: e } = await sb.from('employees').select('id,name').eq('id', r).maybeSingle()
          if (!e) return texto({ error: 'Ese id de empleado no existe.' })
          respId = (e as any).id; respNombre = (e as any).name
        } else {
          const cand = await empleadosPorNombre(sb, r)
          if (cand.length === 0) return texto({ error: `No encontre a nadie que se llame "${r}".` })
          if (cand.length > 1) {
            return texto({
              asignado: false,
              motivo: 'Hay mas de una persona con ese nombre. Elija cual antes de asignar.',
              candidatos: cand,
            })
          }
          respId = (cand[0] as any).id; respNombre = (cand[0] as any).name
        }
      }

      const cambios: Record<string, unknown> = {}
      if (respId !== undefined) cambios[colResp] = respId
      if (args?.fecha !== undefined) cambios[colFecha] = args.fecha || null
      if (Object.keys(cambios).length === 0) return texto({ error: 'No mando nada que cambiar.' })

      if (!args?.confirmar) {
        return texto({
          asignado: false,
          revise_antes: 'Esto le asigna trabajo con fecha a una persona real.',
          tarea: (tarea as any)[colTitulo],
          donde,
          responsable_actual: (tarea as any)[colResp] || null,
          quedaria_en: respNombre ?? '(sin cambio)',
          fecha_quedaria: args?.fecha !== undefined ? (args.fecha || null) : '(sin cambio)',
          para_ejecutar: 'repita con confirmar=true',
        })
      }

      if (donde === 'oficina') cambios.updated_at = new Date().toISOString()
      const { data, error } = await sb.from(tabla).update(cambios).eq('id', id)
        .select(`id,${colTitulo},${colResp},${colFecha}`).single()
      if (error) return texto({ asignado: false, error: error.message })
      return texto({ asignado: true, donde, tarea: data, responsable: respNombre })
    }

    case 'directorio_equipo': {
      let q = sb.from('employees').select('id,name,area,puesto,role').order('area').limit(TOPE)
      if (args?.area)  q = q.ilike('area', `%${String(args.area).replace(/[,()]/g,' ').trim()}%`)
      if (args?.texto) q = q.ilike('name', `%${String(args.texto).replace(/[,()]/g,' ').trim()}%`)
      const { data, error } = await q
      if (error) return texto({ error: error.message })
      return texto({ total: data?.length || 0, empleados: data })
    }

    default:
      return texto({ error: `Herramienta desconocida: ${nombre}` })
  }
}
