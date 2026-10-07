// Bloque 2 — levantamientos.
//
// Un levantamiento NO es una cosa: son tres pasos con consecuencias muy
// distintas, y las herramientas los respetan por separado.
//
//   1. crear/actualizar   un papel en borrador. No le avisa a nadie.
//   2. canalizar          le asigna areas a sus DIRECTORES con fecha limite
//                         para contestar. Aqui empieza a correr el reloj de
//                         una persona real.
//   3. derivar            crea el proyecto y expande las plantillas en 25-31
//                         actividades. El propio modulo del ERP advierte que
//                         ya hay 646 actividades con dos responsables y cero
//                         fechas; esto suma a esa cuenta.
//
// Los dos ultimos piden `confirmar: true`. No es un freno: es que el modelo
// tenga que ENSEÑAR primero a quien le va a caer el trabajo y con que fecha,
// y que la persona apruebe eso y no una intencion vaga.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Quien } from './tools.ts'

// Mismo mapa que src/lib/levantamiento.ts. Si alla cambia, aqui tambien.
const ESPECIALIDADES: Record<string, { label: string; area: string }> = {
  elec: { label: 'Ingeniería Eléctrica', area: 'INGENIERIAS ELECTRICAS' },
  esp:  { label: 'Ingenierías Especiales', area: 'INGENIERIAS ESPECIALES' },
  ilum: { label: 'Diseño de Iluminación', area: 'ILUMINACION' },
}
const DIAS_URGENCIA: Record<string, number> = { urgente: 1, alta: 2, normal: 4, baja: 7 }

/** Fecha de hoy en CDMX. new Date().toISOString() da UTC y en Mexico adelanta
 *  el dia despues de las 6 de la tarde: una fecha limite con un dia de mas. */
function hoyCDMX(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
}
function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const f = new Date(Date.UTC(a, m - 1, d))
  f.setUTCDate(f.getUTCDate() + dias)
  return f.toISOString().slice(0, 10)
}
/** RQ-261007-04. Mismo formato que folioLevantamiento() del front. */
function folio(): string {
  return `RQ-${hoyCDMX().slice(2).replace(/-/g, '')}-${Math.floor(Math.random() * 90 + 10)}`
}

export const DEFINICIONES_LEV = [
  {
    name: 'crear_levantamiento',
    annotations: { readOnlyHint: false, destructiveHint: false },
    description:
      'Crea un levantamiento (requerimiento) en BORRADOR colgado de un lead, con su folio RQ. ' +
      'No le avisa a nadie todavia: es el papel donde se captura que pidio el cliente. ' +
      'Capture el texto original tal como llego en origen_texto, sin resumirlo.',
    inputSchema: {
      type: 'object',
      properties: {
        lead: { type: 'string', description: 'id del lead o su clave de 4 letras.' },
        inmueble: { type: 'string', description: 'Como se llama el inmueble o proyecto.' },
        direccion: { type: 'string' },
        superficie_m2: { type: 'number' },
        niveles: { type: 'string' },
        tipo_inmueble: { type: 'string', description: 'casa, hotel, oficina, departamento...' },
        solicita: { type: 'string', description: 'Quien lo pide (despacho, cliente, contratista).' },
        contacto_cliente: { type: 'string' },
        contacto_rfi: { type: 'string', description: 'A quien preguntarle las dudas tecnicas.' },
        fecha_visita: { type: 'string', description: 'AAAA-MM-DD. Omitir si no la dieron.' },
        fecha_compromiso_cliente: { type: 'string', description: 'AAAA-MM-DD que se le prometio al cliente.' },
        urgencia: { type: 'string', enum: ['urgente','alta','normal','baja'], description: 'Por defecto normal.' },
        indicaciones: { type: 'string', description: 'Lo que el DG le indica al equipo.' },
        origen_texto: { type: 'string', description: 'El mensaje original COMPLETO, sin resumir.' },
        origen_canal: { type: 'string', description: 'whatsapp, correo, llamada, junta...' },
        notas: { type: 'string' },
      },
      required: ['lead'],
    },
  },
  {
    name: 'ver_levantamientos',
    annotations: { readOnlyHint: true },
    description: 'Lista los levantamientos de un lead, con sus areas, a quien se le canalizo y si ya contestaron.',
    inputSchema: {
      type: 'object',
      properties: { lead: { type: 'string', description: 'id del lead o su clave de 4 letras.' } },
      required: ['lead'],
    },
  },
  {
    name: 'actualizar_levantamiento',
    description: 'Cambia campos de un levantamiento que sigue en borrador o listo. Solo toca lo que se le mande.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        inmueble: { type: 'string' }, direccion: { type: 'string' },
        superficie_m2: { type: 'number' }, niveles: { type: 'string' },
        tipo_inmueble: { type: 'string' }, solicita: { type: 'string' },
        contacto_cliente: { type: 'string' }, contacto_rfi: { type: 'string' },
        fecha_visita: { type: 'string' }, fecha_compromiso_cliente: { type: 'string' },
        urgencia: { type: 'string', enum: ['urgente','alta','normal','baja'] },
        indicaciones: { type: 'string' }, origen_texto: { type: 'string' }, notas: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'canalizar_levantamiento',
    description:
      'Asigna el levantamiento a las areas que lo van a atender, cada una a su DIRECTOR y con fecha limite ' +
      'para contestar segun la urgencia (urgente 1 dia, alta 2, normal 4, baja 7). ' +
      'SIN confirmar=true solo devuelve a quien le caeria y con que fecha, sin escribir nada: ensene eso ' +
      'a la persona y espere su visto bueno antes de repetir con confirmar=true.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id del levantamiento.' },
        areas: {
          type: 'array', items: { type: 'string', enum: ['elec','esp','ilum'] },
          description: 'Especialidades que lo van a atender.',
        },
        urgencia: { type: 'string', enum: ['urgente','alta','normal','baja'] },
        alcance: { type: 'string', description: 'Que le toca a estas areas, en una linea.' },
        confirmar: { type: 'boolean' },
      },
      required: ['id','areas'],
    },
  },
  {
    name: 'derivar_levantamiento',
    description:
      'Convierte un area del levantamiento en PROYECTO y expande sus plantillas en actividades. ' +
      'Es el paso mas pesado del ERP. SIN confirmar=true solo dice cuantas actividades crearia y como se ' +
      'llamaria el proyecto, sin escribir nada. Las actividades nacen sin responsable y sin fecha a ' +
      'proposito: las fecha el director.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id del levantamiento.' },
        area: { type: 'string', enum: ['elec','esp','ilum'] },
        confirmar: { type: 'boolean' },
      },
      required: ['id','area'],
    },
  },
]

const texto = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] })
const esUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

async function leadDe(sb: SupabaseClient, ref: string) {
  const q = sb.from('leads').select('id,codigo,name').limit(1)
  const { data } = esUuid(ref) ? await q.eq('id', ref) : await q.ilike('codigo', ref.trim())
  return data?.[0] || null
}

/** El director del area. Se busca por area + puesto, igual que el front.
 *  OJO: hay dos Alfredos en el padron y uno es de obra. El filtro por AREA es
 *  lo que distingue a Alfredo Rosas (INGENIERIAS ESPECIALES, cotiza) de
 *  Alfredo Sanchez (INSTALACIONES ESPECIALES, obra). No quitar. */
async function directorDe(sb: SupabaseClient, specialty: string) {
  const area = ESPECIALIDADES[specialty]?.area
  if (!area) return null
  const { data } = await sb.from('employees').select('id,name,puesto').eq('area', area).limit(50)
  return (data || []).find((e: any) => /DIRECTOR|DIRECCION/i.test(e.puesto || '')) || null
}

export async function ejecutarLev(nombre: string, args: any, sb: SupabaseClient, quien: Quien) {
  switch (nombre) {

    case 'crear_levantamiento': {
      const lead = await leadDe(sb, String(args?.lead || ''))
      if (!lead) return texto({ error: 'No encontre ese lead.' })
      const fila: Record<string, unknown> = {
        lead_id: (lead as any).id,
        folio: folio(),
        capturado_por: quien.nombre || quien.email,
      }
      // capturado_por_id apunta a employees(id), NO a app_users(id). Mandar el
      // segundo revienta levantamientos_capturado_por_id_fkey y el levantamiento
      // no se guarda. Si esta cuenta no esta ligada a un empleado, la columna se
      // OMITE: acepta null y el nombre ya quedo en capturado_por, que es lo que
      // la pantalla del ERP ha escrito siempre.
      if (quien.empleadoId) fila.capturado_por_id = quien.empleadoId
      for (const c of ['inmueble','direccion','niveles','tipo_inmueble','solicita','contacto_cliente',
                       'contacto_rfi','fecha_visita','fecha_compromiso_cliente','urgencia',
                       'indicaciones','origen_texto','origen_canal','notas']) {
        if (args?.[c] !== undefined && args[c] !== null && args[c] !== '') fila[c] = args[c]
      }
      if (args?.superficie_m2 !== undefined) fila.superficie_m2 = Number(args.superficie_m2)
      // estado se queda en su default 'borrador'. Ese es el punto: nace inerte.
      const { data, error } = await sb.from('levantamientos').insert(fila)
        .select('id,folio,estado,urgencia,inmueble,created_at').single()
      if (error) return texto({ creado: false, error: error.message })
      return texto({
        creado: true, levantamiento: data,
        lead: (lead as any).codigo,
        liga: `https://omm-erp.vercel.app/crm/${(lead as any).id}`,
        siguiente: 'Esta en borrador y no le ha llegado a nadie. Para asignarlo use canalizar_levantamiento.',
      })
    }

    case 'ver_levantamientos': {
      const lead = await leadDe(sb, String(args?.lead || ''))
      if (!lead) return texto({ error: 'No encontre ese lead.' })
      const { data: levs } = await sb.from('levantamientos').select('*')
        .eq('lead_id', (lead as any).id).order('created_at', { ascending: false }).limit(50)
      const ids = (levs || []).map((l: any) => l.id)
      const { data: areas } = ids.length
        ? await sb.from('levantamiento_areas').select('*').in('levantamiento_id', ids).limit(200)
        : { data: [] as any[] }
      // Los nombres de los directores, para que no salgan uuids que nadie lee.
      const dirIds = [...new Set((areas || []).map((a: any) => a.director_id).filter(Boolean))]
      const { data: emps } = dirIds.length
        ? await sb.from('employees').select('id,name').in('id', dirIds)
        : { data: [] as any[] }
      const nombre = new Map((emps || []).map((e: any) => [e.id, e.name]))
      return texto({
        lead: (lead as any).codigo,
        levantamientos: (levs || []).map((l: any) => ({
          ...l,
          areas: (areas || []).filter((a: any) => a.levantamiento_id === l.id)
            .map((a: any) => ({ ...a, director: nombre.get(a.director_id) || null })),
        })),
      })
    }

    case 'actualizar_levantamiento': {
      const id = String(args?.id || '')
      if (!esUuid(id)) return texto({ error: 'El id no es valido.' })
      const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() }
      for (const c of ['inmueble','direccion','niveles','tipo_inmueble','solicita','contacto_cliente',
                       'contacto_rfi','fecha_visita','fecha_compromiso_cliente','urgencia',
                       'indicaciones','origen_texto','notas']) {
        if (args?.[c] !== undefined) cambios[c] = args[c] === '' ? null : args[c]
      }
      if (args?.superficie_m2 !== undefined) cambios.superficie_m2 = Number(args.superficie_m2)
      const { data, error } = await sb.from('levantamientos').update(cambios).eq('id', id)
        .select('id,folio,estado,inmueble,urgencia').single()
      if (error) return texto({ error: error.message })
      return texto({ ok: true, levantamiento: data })
    }

    case 'canalizar_levantamiento': {
      const id = String(args?.id || '')
      if (!esUuid(id)) return texto({ error: 'El id no es valido.' })
      const { data: lev } = await sb.from('levantamientos').select('*').eq('id', id).maybeSingle()
      if (!lev) return texto({ error: 'No encontre ese levantamiento.' })

      const claves: string[] = Array.isArray(args?.areas) ? args.areas : []
      if (!claves.length) return texto({ error: 'Sin area no hay a quien canalizarle.' })

      const urg = String(args?.urgencia || (lev as any).urgencia || 'normal')
      const limite = sumarDias(hoyCDMX(), DIAS_URGENCIA[urg] ?? 4)

      const plan = []
      for (const k of claves) {
        const dir = await directorDe(sb, k)
        plan.push({
          area: ESPECIALIDADES[k]?.label || k,
          responde: dir ? (dir as any).name : '— sin director en el padron —',
          director_id: dir ? (dir as any).id : null,
          clave: k,
          contesta_antes_de: limite,
        })
      }

      // Sin confirmar: se ENSEÑA a quien le cae y con que fecha. Nada se escribe.
      if (!args?.confirmar) {
        return texto({
          canalizado: false,
          revise_antes: 'Esto le pone fecha limite a personas reales. Enseñe este plan y pida visto bueno.',
          folio: (lev as any).folio,
          urgencia: urg,
          plan,
          para_ejecutar: 'repita con confirmar=true',
        })
      }

      for (const p of plan) {
        const { data: ya } = await sb.from('levantamiento_areas').select('id')
          .eq('levantamiento_id', id).eq('specialty', p.clave).maybeSingle()
        const fila = {
          levantamiento_id: id, specialty: p.clave,
          director_id: p.director_id, urgencia: urg,
          fecha_respuesta_limite: limite,
          fecha_compromiso: (lev as any).fecha_compromiso_cliente || null,
          alcance: args?.alcance || null,
          estado: 'canalizada',
        }
        if (ya) await sb.from('levantamiento_areas').update(fila).eq('id', (ya as any).id)
        else await sb.from('levantamiento_areas').insert(fila)
      }
      await sb.from('levantamientos').update({ estado: 'listo', updated_at: new Date().toISOString() }).eq('id', id)
      return texto({ canalizado: true, folio: (lev as any).folio, urgencia: urg, plan })
    }

    case 'derivar_levantamiento': {
      const id = String(args?.id || '')
      const clave = String(args?.area || '')
      if (!esUuid(id)) return texto({ error: 'El id no es valido.' })
      if (!ESPECIALIDADES[clave]) return texto({ error: 'Area no valida.' })

      const { data: lev } = await sb.from('levantamientos').select('*').eq('id', id).maybeSingle()
      if (!lev) return texto({ error: 'No encontre ese levantamiento.' })
      const { data: area } = await sb.from('levantamiento_areas').select('*')
        .eq('levantamiento_id', id).eq('specialty', clave).maybeSingle()
      if (!area) return texto({ error: 'Esa area no esta canalizada todavia. Use canalizar_levantamiento primero.' })
      if ((area as any).project_id) {
        return texto({ derivado: false, motivo: 'Esta area ya tiene proyecto.', project_id: (area as any).project_id })
      }

      const { data: lead } = await sb.from('leads').select('id,name,codigo').eq('id', (lev as any).lead_id).maybeSingle()
      const leadNombre = (lead as any)?.name || ''
      const nombreProy = `${(lev as any).inmueble || leadNombre} — ${ESPECIALIDADES[clave].label}`

      // Se cuentan las actividades ANTES de escribir, con las mismas plantillas
      // que usara el alta. Asi la vista previa dice el numero de verdad y no uno
      // aproximado: "25-31" no es una cifra que alguien pueda aprobar.
      const { data: fasesTpl } = await sb.from('project_phase_templates').select('*')
        .in('specialty', [clave, 'postventa']).order('order_index')
      const { data: tareasTpl } = await sb.from('project_task_templates').select('*')
        .in('specialty', [clave, 'postventa']).order('order_index')
      const ordenes = new Set((fasesTpl || []).map((f: any) => f.order_index))
      let cuantas = 0
      for (const tt of (tareasTpl || []) as any[]) {
        for (let o = tt.start_phase_order; o <= tt.end_phase_order; o++) if (ordenes.has(o)) cuantas++
      }

      if (!args?.confirmar) {
        return texto({
          derivado: false,
          revise_antes: 'Esto crea un proyecto y sus actividades. Las actividades nacen sin responsable y sin fecha; las fecha el director.',
          proyecto_se_llamaria: nombreProy,
          fases: (fasesTpl || []).length,
          actividades_que_crearia: cuantas,
          para_ejecutar: 'repita con confirmar=true',
        })
      }

      const { data: proj, error: e1 } = await sb.from('projects').insert({
        name: nombreProy, specialty: clave, lead_id: (lev as any).lead_id,
        levantamiento_id: id, status: 'activo', client_name: leadNombre,
      }).select('id').single()
      if (e1 || !proj) return texto({ derivado: false, error: e1?.message || 'No pude crear el proyecto.' })
      const projectId = (proj as any).id

      const fases = (fasesTpl || []).map((pt: any) => ({
        project_id: projectId, template_id: pt.id, name: pt.name,
        order_index: pt.order_index, is_post_sale: pt.is_post_sale,
        is_unlocked: !pt.is_post_sale, status: 'pendiente',
      }))
      const { data: fasesIns } = fases.length
        ? await sb.from('project_phases').insert(fases).select()
        : { data: [] as any[] }
      const porOrden = new Map(((fasesIns as any[]) || []).map((f: any) => [f.order_index, f.id]))

      const tareas: any[] = []
      for (const tt of (tareasTpl || []) as any[]) {
        for (let o = tt.start_phase_order; o <= tt.end_phase_order; o++) {
          const faseId = porOrden.get(o)
          if (!faseId) continue
          tareas.push({
            project_id: projectId, phase_id: faseId, template_id: tt.id,
            name: tt.name, order_index: tt.order_index,
            status: 'pendiente', progress: 0, priority: 0,
          })
        }
      }
      if (tareas.length) {
        const { error: e2 } = await sb.from('project_tasks').insert(tareas)
        if (e2) return texto({ derivado: 'a medias', project_id: projectId, error: e2.message })
      }

      await sb.from('levantamiento_areas').update({
        project_id: projectId, derivado_at: new Date().toISOString(), estado: 'canalizada',
      }).eq('id', (area as any).id)
      await sb.from('levantamientos').update({
        estado: 'derivado', derivado_at: new Date().toISOString(),
      }).eq('id', id)

      return texto({
        derivado: true, project_id: projectId, proyecto: nombreProy,
        fases: fases.length, actividades: tareas.length,
        pendiente: 'Las actividades no tienen responsable ni fecha. El area no cuenta como atendida hasta que las tengan.',
      })
    }

    default:
      return texto({ error: `Herramienta desconocida: ${nombre}` })
  }
}
