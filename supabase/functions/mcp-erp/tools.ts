// Las herramientas que dot puede usar. Bloque 1: CRM de lectura, alta de lead,
// notas, y los pendientes del tablero.
//
// Cada una recibe el cliente de Supabase YA armado con el token de la persona,
// asi que RLS decide que ve y que puede escribir. Ninguna recibe un id de actor:
// la identidad no es un parametro, se deduce de la sesion.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/** Las TRES identidades de este ERP, que no coinciden entre si:
 *
 *    auth.uid()      la sesion de Supabase
 *    app_users.id    el usuario del ERP      <- `id` de aqui
 *    employees.id    la persona en el padron <- `empleadoId` de aqui
 *
 *  Cual se manda depende de la columna, no de cual se tenga a mano:
 *    action_items.owner_user_id          -> app_users.id
 *    levantamientos.capturado_por_id     -> employees.id
 *    project_tasks.assignee_id           -> employees.id
 *    obra_actividades.instalador_id      -> employees.id
 *
 *  empleadoId puede venir null: 6 de 9 app_users no tienen employee_id. Las
 *  columnas que lo usan lo aceptan null, asi que se OMITE, no se inventa. */
export interface Quien {
  id: string
  nombre: string | null
  email: string | null
  empleadoId?: string | null
}

const TOPE = 200 // PostgREST corta en 1000 sin avisar; aqui se pide menos y explicito.

export const DEFINICIONES = [
  {
    name: 'buscar_leads',
    annotations: { readOnlyHint: true },
    description:
      'Busca leads (proyectos) en el CRM por nombre, clave, despacho o contacto. ' +
      'Uselo para encontrar el lead antes de cualquier otra cosa: casi todo en el ERP cuelga de un lead.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Parte del nombre, la clave de 4 letras, o el despacho.' },
        estado: { type: 'string', enum: ['nuevo','contactado','diagnostico','cotizando','ganado','perdido','pausado'] },
        limite: { type: 'integer', description: 'Cuantos devolver. Por defecto 25, maximo 200.' },
      },
    },
  },
  {
    name: 'ver_lead',
    annotations: { readOnlyHint: true },
    description:
      'Devuelve un lead con su alcance capturado, sus cotizaciones y sus ordenes de compra. ' +
      'Acepta el id o la clave de 4 letras.',
    inputSchema: {
      type: 'object',
      properties: {
        lead: { type: 'string', description: 'id del lead, o su clave de 4 letras (ej. SEVI).' },
      },
      required: ['lead'],
    },
  },
  {
    name: 'crear_lead',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description:
      'Da de alta un lead nuevo en el CRM. Antes de crear, busca parecidos y, si encuentra uno, ' +
      'DEVUELVE EL CANDIDATO SIN CREAR NADA — para crearlo de todas formas hay que repetir con confirmar=true. ' +
      'La clave de 4 letras la asigna la base, no se manda. El estado inicial es el normal del CRM.',
    inputSchema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del proyecto como vive en el CRM (ej. "Secrets The Vine").' },
        despacho: { type: 'string', description: 'Arquitecto o despacho que lo trae. Opcional.' },
        contacto: { type: 'string' },
        telefono: { type: 'string' },
        correo: { type: 'string' },
        lineas: {
          type: 'array', items: { type: 'string', enum: ['esp','elec','ilum','cort','proy','dist'] },
          description: 'Especialidades que se van a cotizar. Omitir si no se sabe: inventarlas desvia el lead al equipo equivocado.',
        },
        notas: { type: 'string', description: 'Alcance, ubicacion, pendientes por confirmar. Texto libre, tal como lo dicten.' },
        confirmar: { type: 'boolean', description: 'true para crear aunque existan parecidos.' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'agregar_nota_lead',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description:
      'Agrega texto a las notas de un lead sin borrar lo que ya tenia. ' +
      'Uselo para ir capturando el alcance conforme se levanta.',
    inputSchema: {
      type: 'object',
      properties: {
        lead: { type: 'string', description: 'id del lead o su clave de 4 letras.' },
        texto: { type: 'string' },
      },
      required: ['lead','texto'],
    },
  },
  {
    name: 'mis_pendientes',
    annotations: { readOnlyHint: true },
    description: 'Los pendientes del tablero de quien esta conectado. Son los mismos que ve en su pantalla.',
    inputSchema: {
      type: 'object',
      properties: {
        estado: { type: 'string', enum: ['pendiente','completada','todas'], description: 'Por defecto pendiente.' },
      },
    },
  },
  {
    name: 'crear_pendiente',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: 'Agrega un pendiente al tablero de quien esta conectado. Aparece en su pantalla de inmediato.',
    inputSchema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        fecha: { type: 'string', description: 'Fecha limite AAAA-MM-DD. Omitir si no la dieron: no inventarla.' },
        prioridad: { type: 'integer', description: '1 alta, 2 normal, 3 baja. Por defecto 2.' },
      },
      required: ['titulo'],
    },
  },
  {
    name: 'actualizar_pendiente',
    description: 'Marca un pendiente como completado o lo regresa a pendiente, y puede mover su fecha o prioridad.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        estado: { type: 'string', enum: ['pendiente','completada'] },
        fecha: { type: 'string', description: 'AAAA-MM-DD, o vacio para quitarla.' },
        prioridad: { type: 'integer' },
      },
      required: ['id'],
    },
  },
]

const texto = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] })
const esUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

/** Limpia el texto que va DENTRO de un .or() de PostgREST.
 *
 *  El .or() manda los filtros en una sola cadena separados por COMAS. Un lead
 *  como "Nauma Development Group, S.A. de C.V." parte esa cadena a la mitad y
 *  PostgREST acaba leyendo campos inventados. En una busqueda eso da resultados
 *  raros; en la revision de duplicados es peor, porque falla en silencio y deja
 *  pasar el duplicado que justamente iba a evitar.
 *
 *  Los parentesis delimitan el grupo del or(), asi que tambien salen. */
const paraOr = (t: string) => t.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim()

/** Resuelve "SEVI" o un uuid a un lead. Devuelve null si no existe. */
async function hallarLead(sb: SupabaseClient, ref: string) {
  const q = sb.from('leads').select('*').limit(1)
  const { data } = esUuid(ref) ? await q.eq('id', ref) : await q.ilike('codigo', ref.trim())
  return data?.[0] || null
}

export async function ejecutar(nombre: string, args: any, sb: SupabaseClient, quien: Quien) {
  switch (nombre) {

    case 'buscar_leads': {
      const lim = Math.min(Math.max(Number(args?.limite) || 25, 1), TOPE)
      let q = sb.from('leads')
        .select('id,codigo,name,company,contact_name,status,priority,needs,estimated_value,created_at')
        .order('created_at', { ascending: false }).limit(lim)
      if (args?.estado) q = q.eq('status', args.estado)
      if (args?.texto) {
        const limpio = paraOr(String(args.texto))
        if (limpio) {
          const t = `%${limpio}%`
          q = q.or(`name.ilike.${t},codigo.ilike.${t},company.ilike.${t},contact_name.ilike.${t}`)
        }
      }
      const { data, error } = await q
      if (error) return texto({ error: error.message })
      return texto({ encontrados: data?.length || 0, leads: data })
    }

    case 'ver_lead': {
      const lead = await hallarLead(sb, String(args?.lead || ''))
      if (!lead) return texto({ error: 'No encontre ese lead.' })

      // Sin embeds a proposito: purchase_orders tiene varias rutas hacia leads y
      // un embed ambiguo de PostgREST devuelve 300 (PGRST201), que en este ERP
      // ya dejo pantallas vacias. Tres consultas chicas cuestan menos que ese bug.
      //
      // Y quotations NO tiene columna de lead: el vinculo vive dentro de notes,
      // que es JSON de texto. Por eso se busca por contenido.
      const [{ data: cots }, { data: ocs }] = await Promise.all([
        sb.from('quotations').select('id,folio,name,specialty,stage,total')
          .like('notes', `%${lead.id}%`).limit(TOPE),
        sb.from('purchase_orders').select('id,folio,status,tipo,total,currency')
          .eq('lead_id', lead.id).order('folio').limit(TOPE),
      ])
      return texto({ lead, cotizaciones: cots || [], ordenes_de_compra: ocs || [] })
    }

    case 'crear_lead': {
      const nombreLead = String(args?.nombre || '').trim()
      if (!nombreLead) return texto({ error: 'Falta el nombre.' })

      // Buscar parecidos ANTES de escribir. Un CRM con el mismo proyecto dos
      // veces es peor que uno sin el: las cotizaciones se reparten entre los dos
      // y ninguno enseña el total real.
      // Dos consultas sueltas en vez de un .or(): asi el nombre va como VALOR de
      // un filtro y no como parte de la cadena que PostgREST parte por comas.
      // La busqueda de duplicados no se puede dar el lujo de fallar callada.
      const primera = paraOr(nombreLead).split(' ')[0] || nombreLead
      const [{ data: porNombre }, { data: porPalabra }] = await Promise.all([
        sb.from('leads').select('id,codigo,name,company,status').ilike('name', `%${nombreLead}%`).limit(10),
        sb.from('leads').select('id,codigo,name,company,status').ilike('name', `%${primera}%`).limit(10),
      ])
      const vistos = new Set<string>()
      const parecidos = [...(porNombre || []), ...(porPalabra || [])]
        .filter(l => !vistos.has((l as any).id) && vistos.add((l as any).id))

      if (parecidos?.length && !args?.confirmar) {
        return texto({
          creado: false,
          motivo: 'Ya hay leads parecidos. Revisalos; si de verdad es uno nuevo, repite con confirmar=true.',
          candidatos: parecidos,
        })
      }

      const fila: Record<string, unknown> = { name: nombreLead }
      if (args?.despacho) fila.company = String(args.despacho).trim()
      if (args?.contacto) fila.contact_name = String(args.contacto).trim()
      if (args?.telefono) fila.contact_phone = String(args.telefono).trim()
      if (args?.correo) fila.contact_email = String(args.correo).trim()
      if (Array.isArray(args?.lineas) && args.lineas.length) fila.needs = args.lineas
      if (args?.notas) fila.notes = String(args.notas)
      // codigo, status, priority y origin NO se mandan: la clave la pone el
      // trigger y los otros tres toman el default del CRM. Mandar un valor
      // inventado aqui es decidir por el usuario sin que se entere.

      const { data, error } = await sb.from('leads').insert(fila)
        .select('id,codigo,name,status,priority,origin,needs,notes,created_at').single()
      if (error) return texto({ creado: false, error: error.message })
      return texto({
        creado: true, lead: data,
        liga: `https://omm-erp.vercel.app/crm/${(data as any).id}`,
        nota: 'Lo creo el asistente conectado como ' + (quien.email || quien.nombre),
      })
    }

    case 'agregar_nota_lead': {
      const lead = await hallarLead(sb, String(args?.lead || ''))
      if (!lead) return texto({ error: 'No encontre ese lead.' })
      const nuevo = String(args?.texto || '').trim()
      if (!nuevo) return texto({ error: 'Falta el texto.' })

      // OJO: notes a veces es texto plano y a veces un JSON
      // {client_final, client_id, text} que guarda el cliente final del lead.
      // Escribir texto plano encima de ese JSON borra la liga al cliente sin
      // que nadie lo note. Por eso se detecta la forma y se respeta.
      const previo = (lead as any).notes || ''
      const sello = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' })
      const linea = `[${sello}] ${nuevo}`
      let salida: string
      try {
        const j = JSON.parse(previo)
        if (j && typeof j === 'object' && !Array.isArray(j)) {
          j.text = j.text ? `${j.text}\n${linea}` : linea
          salida = JSON.stringify(j)
        } else throw new Error('no es objeto')
      } catch {
        salida = previo ? `${previo}\n${linea}` : linea
      }

      const { error } = await sb.from('leads').update({ notes: salida }).eq('id', (lead as any).id)
      if (error) return texto({ error: error.message })
      return texto({ ok: true, lead: (lead as any).codigo, agregado: linea })
    }

    case 'mis_pendientes': {
      // Los MISMOS filtros que usa el tablero. Si se cambia uno, el asistente y
      // la pantalla dejan de estar viendo la misma lista.
      let q = sb.from('action_items')
        .select('id,title,status,priority,due_date,created_at')
        .eq('source_type', 'dashboard').eq('owner_user_id', quien.id)
        .order('created_at', { ascending: false }).limit(TOPE)
      const e = args?.estado || 'pendiente'
      if (e !== 'todas') q = q.eq('status', e)
      const { data, error } = await q
      if (error) return texto({ error: error.message })
      return texto({ total: data?.length || 0, pendientes: data })
    }

    case 'crear_pendiente': {
      const titulo = String(args?.titulo || '').trim()
      if (!titulo) return texto({ error: 'Falta el titulo.' })
      // source_type='dashboard' y owner_user_id NO son decorativos: el tablero
      // filtra por los dos. Un pendiente sin ellos existe en la base y es
      // invisible en la pantalla — lo peor de los dos mundos.
      //
      // Y el dueño es app_users.id, NO auth.uid(). En este ERP son columnas
      // distintas y no coinciden en ninguna fila.
      const { data, error } = await sb.from('action_items').insert({
        title: titulo,
        area: 'DG',
        source_type: 'dashboard',
        status: 'pendiente',
        priority: Number(args?.prioridad) || 2,
        due_date: args?.fecha || null,
        owner_user_id: quien.id,
      }).select('id,title,status,priority,due_date').single()
      if (error) return texto({ creado: false, error: error.message })
      return texto({ creado: true, pendiente: data })
    }

    case 'actualizar_pendiente': {
      const id = String(args?.id || '')
      if (!esUuid(id)) return texto({ error: 'El id no es valido.' })
      const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (args?.estado) {
        cambios.status = args.estado
        cambios.completed_at = args.estado === 'completada' ? new Date().toISOString() : null
      }
      if (args?.fecha !== undefined) cambios.due_date = args.fecha || null
      if (args?.prioridad !== undefined) cambios.priority = Number(args.prioridad) || 2
      // El .eq de dueño es la segunda cerradura: RLS ya deberia impedirlo, pero
      // una herramienta que acepta un id suelto no debe depender de una sola.
      const { data, error } = await sb.from('action_items').update(cambios)
        .eq('id', id).eq('owner_user_id', quien.id)
        .select('id,title,status,priority,due_date').single()
      if (error) return texto({ error: error.message })
      if (!data) return texto({ error: 'No encontre ese pendiente, o no es tuyo.' })
      return texto({ ok: true, pendiente: data })
    }

    default:
      return texto({ error: `Herramienta desconocida: ${nombre}` })
  }
}
