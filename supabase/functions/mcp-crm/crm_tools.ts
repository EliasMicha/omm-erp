// ═══════════════════════════════════════════════════════════════════════════
//  OMM CRM — tools de negocio para el MCP (mcp-crm).
//
//  Mismo patron que _shared/tools.ts (definition + handler + allowed_roles),
//  pero con un contexto propio: aqui no hay conversacion de WhatsApp, hay un
//  bot llamando por HTTP en nombre de un usuario de servicio del ERP.
//
//  Reglas que valen para todas:
//
//   - Ninguna escribe SQL crudo: todo pasa por el cliente de Supabase y las
//     tablas reales del ERP (leads, project_tasks, notifications).
//   - Si falta un dato critico NO se inventa. Se devuelve un error claro para
//     que el bot pregunte: un lead con el responsable equivocado cuesta mas
//     caro que una pregunta de mas.
//   - dry_run devuelve exactamente lo que haria, sin escribir una sola fila.
//   - Toda escritura queda con actor: quien pidio, con que cuenta.
//
//  Dos padrones distintos que hay que tener claros, porque se confunden:
//   - app_users  = cuentas que entran al ERP (hay usuarios sin ficha)
//   - employees  = fichas de personal (hay empleados sin cuenta)
//  Las tareas se asignan a un EMPLEADO (project_tasks.assignee_id) y las
//  notificaciones van a una CUENTA (notifications.user_id).
// ═══════════════════════════════════════════════════════════════════════════

export interface CrmActor {
  /** app_users.id — la cuenta con la que el bot escribe. */
  app_user_id: string
  nombre: string
  email: string
  /** employees.id si esa cuenta tiene ficha; null si no (caso normal de un bot). */
  employee_id: string | null
  permission_area: string
  nivel: string
}

export interface CrmCtx {
  supabase: any
  actor: CrmActor
}

export interface CrmToolResult {
  success: boolean
  data?: unknown
  error?: string
  affected_entity_type?: string
  affected_entity_id?: string
}

export interface CrmTool {
  definition: { name: string; description: string; input_schema: Record<string, unknown> }
  handler: (input: any, ctx: CrmCtx) => Promise<CrmToolResult>
}

// ── Helpers ────────────────────────────────────────────────────────────────

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const esDryRun = (input: any): boolean => input?.dry_run === true

/** Escapa los comodines de PostgREST en una busqueda libre. */
function likeSafe(q: string): string {
  return q.replace(/[%,()]/g, ' ').trim()
}

/**
 * Resuelve una persona a partir de un id, un email o un nombre.
 * Devuelve las dos identidades porque sirven para cosas distintas.
 */
async function resolvePersona(
  supabase: any,
  args: { user_id?: string; employee_id?: string; email?: string; nombre?: string },
): Promise<{ app_user_id: string | null; employee_id: string | null; nombre: string; email: string | null } | null> {
  const porUsuario = async (col: string, val: string) => {
    const { data } = await supabase.from('app_users')
      .select('id, nombre, email, employee_id, activo').eq(col, val).eq('activo', true).maybeSingle()
    return data
  }

  if (args.user_id) {
    const u = await porUsuario('id', args.user_id)
    if (u) return { app_user_id: u.id, employee_id: u.employee_id, nombre: u.nombre, email: u.email }
  }
  if (args.email) {
    const u = await porUsuario('email', args.email.toLowerCase())
    if (u) return { app_user_id: u.id, employee_id: u.employee_id, nombre: u.nombre, email: u.email }
    // Puede ser un empleado con correo pero sin cuenta en el ERP.
    const { data: e } = await supabase.from('employees')
      .select('id, name, nombre, email').ilike('email', args.email).eq('activo', true).maybeSingle()
    if (e) return { app_user_id: null, employee_id: e.id, nombre: e.name || e.nombre, email: e.email }
  }
  if (args.employee_id) {
    const { data: e } = await supabase.from('employees')
      .select('id, name, nombre, email').eq('id', args.employee_id).maybeSingle()
    if (e) {
      const { data: u } = await supabase.from('app_users')
        .select('id, nombre, email').eq('employee_id', e.id).eq('activo', true).maybeSingle()
      return { app_user_id: u?.id ?? null, employee_id: e.id, nombre: u?.nombre || e.name || e.nombre, email: u?.email || e.email }
    }
  }
  if (args.nombre) {
    const q = likeSafe(args.nombre)
    if (!q) return null
    const { data: us } = await supabase.from('app_users')
      .select('id, nombre, email, employee_id').ilike('nombre', `%${q}%`).eq('activo', true).limit(2)
    // Un solo match es una respuesta; dos es una pregunta al usuario.
    if (us && us.length === 1) {
      return { app_user_id: us[0].id, employee_id: us[0].employee_id, nombre: us[0].nombre, email: us[0].email }
    }
    if (!us || us.length === 0) {
      const { data: es } = await supabase.from('employees')
        .select('id, name, nombre, email').or(`name.ilike.%${q}%,nombre.ilike.%${q}%`).eq('activo', true).limit(2)
      if (es && es.length === 1) {
        return { app_user_id: null, employee_id: es[0].id, nombre: es[0].name || es[0].nombre, email: es[0].email }
      }
    }
  }
  return null
}

// ═══ TOOL: crm_search_people ═══════════════════════════════════════════════
const crmSearchPeople: CrmTool = {
  definition: {
    name: 'crm_search_people',
    description:
      'Busca personas de OMM por nombre o correo para resolver "Ana" o "Carlos" a ids reales. ' +
      'Devuelve DOS identidades por persona: user_id (cuenta del ERP, sirve para notificar) y ' +
      'employee_id (ficha de personal, sirve para asignar tareas). No todas las personas tienen ambas. ' +
      'Usala SIEMPRE antes de crear o asignar algo a una persona mencionada por su nombre. No escribe nada.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Nombre o correo, completo o parcial' },
        limit: { type: 'integer', description: 'Maximo de resultados', default: 8 },
      },
      required: ['query'],
    },
  },
  handler: async (input, ctx) => {
    const q = likeSafe(s(input.query))
    if (!q) return { success: false, error: 'Dame un nombre o correo para buscar.' }
    const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 25)

    const { data: usuarios, error: e1 } = await ctx.supabase.from('app_users')
      .select('id, nombre, email, permission_area, nivel, activo, employee_id')
      .or(`nombre.ilike.%${q}%,email.ilike.%${q}%`).eq('activo', true).limit(limit)
    if (e1) return { success: false, error: e1.message }

    const conCuenta = new Set((usuarios || []).map((u: any) => u.employee_id).filter(Boolean))
    const { data: empleados, error: e2 } = await ctx.supabase.from('employees')
      .select('id, name, nombre, email, area, puesto, activo')
      .or(`name.ilike.%${q}%,nombre.ilike.%${q}%,email.ilike.%${q}%`).eq('activo', true).limit(limit)
    if (e2) return { success: false, error: e2.message }

    const personas = [
      ...(usuarios || []).map((u: any) => ({
        nombre: u.nombre, email: u.email,
        user_id: u.id, employee_id: u.employee_id,
        area: u.permission_area, nivel: u.nivel,
        puede_recibir_notificacion: true,
        puede_recibir_tarea: !!u.employee_id,
      })),
      ...(empleados || []).filter((e: any) => !conCuenta.has(e.id)).map((e: any) => ({
        nombre: e.name || e.nombre, email: e.email,
        user_id: null, employee_id: e.id,
        area: e.area, nivel: e.puesto,
        puede_recibir_notificacion: false,
        puede_recibir_tarea: true,
      })),
    ].slice(0, limit)

    return { success: true, data: { personas, total: personas.length } }
  },
}

// ═══ TOOL: crm_search_leads ════════════════════════════════════════════════
const crmSearchLeads: CrmTool = {
  definition: {
    name: 'crm_search_leads',
    description:
      'Busca leads existentes por nombre de proyecto, despacho o contacto. Usala ANTES de crear un lead ' +
      'para no duplicar: en OMM el mismo despacho manda varias obras y se parecen entre si. ' +
      'Devuelve el folio OMM (clave de 4-8 caracteres de la que cuelgan cotizaciones y compras). No escribe nada.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Nombre del proyecto, despacho o contacto' },
        estado: {
          type: 'string',
          enum: ['nuevo', 'contactado', 'cotizando', 'ganado', 'perdido', 'pausado'],
          description: 'Filtra por etapa comercial',
        },
        limit: { type: 'integer', default: 10 },
      },
      required: ['query'],
    },
  },
  handler: async (input, ctx) => {
    const q = likeSafe(s(input.query))
    if (!q) return { success: false, error: 'Dame algo que buscar.' }
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 25)

    let query = ctx.supabase.from('leads')
      .select('id, codigo, name, company, contact_name, status, estimated_value, updated_at')
      .or(`name.ilike.%${q}%,company.ilike.%${q}%,contact_name.ilike.%${q}%,codigo.ilike.%${q}%`)
      .order('updated_at', { ascending: false }).limit(limit)
    if (input.estado) query = query.eq('status', input.estado)

    const { data, error } = await query
    if (error) return { success: false, error: error.message }

    return {
      success: true,
      data: {
        leads: (data || []).map((l: any) => ({
          lead_id: l.id, clave: l.codigo, nombre: l.name, despacho: l.company,
          contacto: l.contact_name, estado: l.status, ultima_actividad: l.updated_at,
        })),
        total: (data || []).length,
      },
    }
  },
}

// ═══ TOOL: crm_create_lead ═════════════════════════════════════════════════
const crmCreateLead: CrmTool = {
  definition: {
    name: 'crm_create_lead',
    description:
      'Da de alta un lead nuevo en el CRM. La clave OMM (PILO, RD175...) se genera sola en la base; no la mandes. ' +
      'Busca primero con crm_search_leads para no duplicar. ' +
      'Si ademas hay que asignarle una tarea, usa crm_create_lead_with_task en vez de esta.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del proyecto u obra. Es como se conoce internamente.' },
        empresa: { type: 'string', description: 'Despacho de arquitectura o constructora' },
        contacto: { type: 'string', description: 'Nombre de la persona de contacto' },
        email: { type: 'string' },
        telefono: { type: 'string' },
        origen: {
          type: 'string',
          enum: ['inbound', 'referido', 'repetido', 'prospeccion', 'otro'],
          description: 'Como llego el lead', default: 'inbound',
        },
        notas: { type: 'string' },
        responsable_email: { type: 'string', description: 'Correo del comercial responsable' },
        dry_run: { type: 'boolean', description: 'true = solo previsualiza, no escribe', default: false },
      },
      required: ['nombre'],
    },
  },
  handler: async (input, ctx) => {
    const nombre = s(input.nombre)
    if (!nombre) return { success: false, error: 'El lead necesita nombre: sin nombre nadie sabe de que obra hablamos.' }

    let responsable: any = null
    if (input.responsable_email || input.responsable_id) {
      responsable = await resolvePersona(ctx.supabase, {
        email: s(input.responsable_email), user_id: s(input.responsable_id),
      })
      if (!responsable) {
        return { success: false, error: `No encontre al responsable "${input.responsable_email || input.responsable_id}". Busca con crm_search_people y vuelve a intentar.` }
      }
    }

    const notas = [s(input.notas), responsable ? `Responsable: ${responsable.nombre}` : '']
      .filter(Boolean).join(' · ')

    const fila = {
      name: nombre,
      company: s(input.empresa) || null,
      contact_name: s(input.contacto) || null,
      contact_email: s(input.email) || null,
      contact_phone: s(input.telefono) || null,
      origin: s(input.origen) || 'inbound',
      status: 'nuevo',
      notes: notas || null,
      needs: [],
    }

    if (esDryRun(input)) {
      return { success: true, data: { dry_run: true, se_crearia: fila, responsable: responsable?.nombre ?? null, nota: 'La clave OMM se genera al guardar.' } }
    }

    const { data, error } = await ctx.supabase.from('leads').insert(fila).select('id, codigo, name, status').single()
    if (error) return { success: false, error: error.message }

    return {
      success: true,
      affected_entity_type: 'lead',
      affected_entity_id: data.id,
      data: { lead_id: data.id, clave: data.codigo, nombre: data.name, estado: data.status, responsable: responsable?.nombre ?? null, dry_run: false },
    }
  },
}

// ═══ TOOL: crm_assign_task ═════════════════════════════════════════════════
const AREAS = ['ELE', 'ESP', 'ILU', 'CORT', 'PROY'] as const

const crmAssignTask: CrmTool = {
  definition: {
    name: 'crm_assign_task',
    description:
      'Crea una tarea ligada a un lead y se la asigna a alguien. Escribe en project_tasks, que es el tablero ' +
      'que la gente de OMM ya usa. El asignado tiene que tener ficha de empleado (employee_id): resuelvelo ' +
      'antes con crm_search_people. El area es obligatoria porque define de quien es el trabajo; si el humano ' +
      'no la dijo, preguntale en vez de adivinarla.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'uuid del lead (de crm_search_leads o crm_create_lead)' },
        titulo: { type: 'string', description: 'Que hay que hacer, en una linea' },
        descripcion: { type: 'string' },
        asignado_employee_id: { type: 'string', description: 'employee_id del responsable' },
        asignado_email: { type: 'string', description: 'Alternativa al employee_id' },
        area: { type: 'string', enum: AREAS as unknown as string[], description: 'ELE electrico, ESP especiales, ILU iluminacion, CORT cortinas, PROY proyecto' },
        fecha: { type: 'string', description: 'Fecha limite en formato yyyy-mm-dd' },
        prioridad: { type: 'string', enum: ['baja', 'media', 'alta'], default: 'media' },
        dry_run: { type: 'boolean', default: false },
      },
      required: ['lead_id', 'titulo', 'area'],
    },
  },
  handler: async (input, ctx) => {
    const titulo = s(input.titulo)
    const leadId = s(input.lead_id)
    const area = s(input.area).toUpperCase()
    if (!leadId) return { success: false, error: 'Falta lead_id.' }
    if (!titulo) return { success: false, error: 'La tarea necesita titulo: sin titulo nadie sabe que hacer.' }
    if (!AREAS.includes(area as any)) {
      return { success: false, error: `Falta el area de la tarea. Tiene que ser una de: ${AREAS.join(', ')}. Preguntale al humano cual es.` }
    }

    const { data: lead } = await ctx.supabase.from('leads').select('id, name, codigo').eq('id', leadId).maybeSingle()
    if (!lead) return { success: false, error: `No existe el lead ${leadId}.` }

    const persona = await resolvePersona(ctx.supabase, {
      employee_id: s(input.asignado_employee_id), email: s(input.asignado_email), nombre: s(input.asignado_nombre),
    })
    if (!persona) return { success: false, error: 'No encontre a esa persona. Busca con crm_search_people y manda el employee_id.' }
    if (!persona.employee_id) {
      return { success: false, error: `${persona.nombre} tiene cuenta en el ERP pero no ficha de empleado, y las tareas se asignan a fichas. Escoge a alguien mas o pide que le liguen su ficha en Usuarios.` }
    }

    const prioridadNum = { baja: 1, media: 2, alta: 3 }[s(input.prioridad) || 'media'] ?? 2
    const urgencia = { baja: 'baja', media: 'normal', alta: 'urgente' }[s(input.prioridad) || 'media'] ?? 'normal'

    const fila = {
      name: titulo,
      description: s(input.descripcion) || null,
      lead_id: leadId,
      assignee_id: persona.employee_id,
      specialty: area === 'ELE' ? 'elec' : area === 'ESP' ? 'esp' : area === 'ILU' ? 'ilum' : area === 'CORT' ? 'cort' : 'proy',
      tipo: 'comercial',
      urgencia,
      priority: prioridadNum,
      due_date: s(input.fecha) || null,
      status: 'pendiente',
      progress: 0,
      order_index: 0,
      solicitada_por: ctx.actor.nombre,
      solicitada_por_id: ctx.actor.employee_id,
      titulo_cliente: lead.name,
    }

    if (esDryRun(input)) {
      return { success: true, data: { dry_run: true, se_crearia: { ...fila, asignado: persona.nombre }, lead: lead.name } }
    }

    const { data, error } = await ctx.supabase.from('project_tasks').insert(fila).select('id, name, due_date').single()
    if (error) return { success: false, error: error.message }

    return {
      success: true,
      affected_entity_type: 'project_task',
      affected_entity_id: data.id,
      data: {
        tarea_id: data.id, lead_id: leadId, lead: lead.name,
        asignado: { nombre: persona.nombre, employee_id: persona.employee_id, user_id: persona.app_user_id },
        fecha: data.due_date, dry_run: false,
      },
    }
  },
}

// ═══ TOOL: notify_user ═════════════════════════════════════════════════════
const notifyUser: CrmTool = {
  definition: {
    name: 'notify_user',
    description:
      'Deja una notificacion dentro del ERP para una persona con cuenta. Sirve para avisar "ya te asigne esto". ' +
      'No manda correo ni WhatsApp. El destinatario tiene que tener cuenta en el ERP (user_id): los empleados ' +
      'sin cuenta no pueden recibir notificaciones, usa crm_search_people para saberlo antes.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'app_user del destinatario' },
        email: { type: 'string', description: 'Alternativa al user_id' },
        titulo: { type: 'string' },
        mensaje: { type: 'string' },
        link: { type: 'string', description: 'Ruta del ERP, por ejemplo /crm o /mi-trabajo' },
        dry_run: { type: 'boolean', default: false },
      },
      required: ['titulo', 'mensaje'],
    },
  },
  handler: async (input, ctx) => {
    const titulo = s(input.titulo)
    const mensaje = s(input.mensaje)
    if (!titulo || !mensaje) return { success: false, error: 'La notificacion necesita titulo y mensaje.' }

    const persona = await resolvePersona(ctx.supabase, {
      user_id: s(input.user_id), email: s(input.email), nombre: s(input.nombre),
    })
    if (!persona) return { success: false, error: 'No encontre a esa persona. Busca con crm_search_people.' }
    if (!persona.app_user_id) {
      return { success: false, error: `${persona.nombre} no tiene cuenta en el ERP, asi que no hay donde dejarle la notificacion.` }
    }

    const fila = {
      user_id: persona.app_user_id,
      title: titulo,
      body: mensaje + (s(input.link) ? ` · ${s(input.link)}` : ''),
      type: 'info',
      read: false,
      dismissed: false,
    }

    if (esDryRun(input)) {
      return { success: true, data: { dry_run: true, se_notificaria_a: persona.nombre, titulo, mensaje } }
    }

    const { data, error } = await ctx.supabase.from('notifications').insert(fila).select('id').single()
    if (error) return { success: false, error: error.message }

    return {
      success: true,
      affected_entity_type: 'notification',
      affected_entity_id: data.id,
      data: { notificacion_id: data.id, canal: 'in_app', destinatario: { nombre: persona.nombre, email: persona.email }, dry_run: false },
    }
  },
}

// ═══ TOOL: crm_create_lead_with_task ═══════════════════════════════════════
const crmCreateLeadWithTask: CrmTool = {
  definition: {
    name: 'crm_create_lead_with_task',
    description:
      'La tool principal del CRM: da de alta el lead, crea la tarea, se la asigna a alguien y avisa. ' +
      'Usala cuando el humano pide las tres cosas en una frase ("sube este lead, asignaselo a Ana y avisale a Carlos"). ' +
      'Si algo falla despues de crear el lead, devuelve lo que si quedo hecho — no deshace el lead, porque un lead ' +
      'capturado a medias se arregla y uno perdido se pierde. Corre primero con dry_run para enseñarle al humano que va a pasar.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del proyecto u obra' },
        empresa: { type: 'string' },
        contacto: { type: 'string' },
        email: { type: 'string' },
        telefono: { type: 'string' },
        origen: { type: 'string', enum: ['inbound', 'referido', 'repetido', 'prospeccion', 'otro'], default: 'inbound' },
        notas: { type: 'string' },
        tarea_titulo: { type: 'string', description: 'Que hay que hacer con este lead' },
        tarea_descripcion: { type: 'string' },
        tarea_asignado_email: { type: 'string', description: 'Correo de quien se encarga' },
        tarea_asignado_employee_id: { type: 'string' },
        tarea_area: { type: 'string', enum: AREAS as unknown as string[], description: 'Obligatoria. Preguntala si no la dijeron.' },
        tarea_fecha: { type: 'string', description: 'yyyy-mm-dd' },
        tarea_prioridad: { type: 'string', enum: ['baja', 'media', 'alta'], default: 'media' },
        notificar_a: { type: 'array', items: { type: 'string' }, description: 'Correos de quienes ademas deben enterarse' },
        dry_run: { type: 'boolean', default: false },
      },
      required: ['nombre', 'tarea_titulo', 'tarea_area'],
    },
  },
  handler: async (input, ctx) => {
    const dry = esDryRun(input)

    // 1) Lead
    const lead = await crmCreateLead.handler({
      nombre: input.nombre, empresa: input.empresa, contacto: input.contacto,
      email: input.email, telefono: input.telefono, origen: input.origen, notas: input.notas,
      dry_run: dry,
    }, ctx)
    if (!lead.success) return lead

    const leadId = dry ? 'dry-run' : (lead.data as any).lead_id
    const clave = dry ? null : (lead.data as any).clave

    // 2) Tarea
    const tarea = await crmAssignTask.handler({
      lead_id: dry ? leadId : leadId,
      titulo: input.tarea_titulo, descripcion: input.tarea_descripcion,
      asignado_email: input.tarea_asignado_email, asignado_employee_id: input.tarea_asignado_employee_id,
      area: input.tarea_area, fecha: input.tarea_fecha, prioridad: input.tarea_prioridad,
      dry_run: dry,
    }, ctx)

    // En dry_run la tarea no puede validar el lead porque el lead no existe:
    // ese error concreto no cuenta, cualquier otro si.
    const tareaFalloDeVerdad = !tarea.success && !(dry && String(tarea.error || '').startsWith('No existe el lead'))
    if (tareaFalloDeVerdad) {
      return {
        success: false,
        error: `El lead ${dry ? 'se crearia' : 'quedo creado'} pero la tarea no: ${tarea.error}`,
        data: { lead: lead.data, tarea: null },
      }
    }

    // 3) Notificaciones: al asignado y a quien mas pidieron
    const destinatarios: string[] = []
    if (input.tarea_asignado_email) destinatarios.push(s(input.tarea_asignado_email))
    for (const d of (Array.isArray(input.notificar_a) ? input.notificar_a : [])) {
      const e = s(d)
      if (e && !destinatarios.includes(e)) destinatarios.push(e)
    }

    const notificados = []
    for (const email of destinatarios) {
      const n = await notifyUser.handler({
        email,
        titulo: `Nuevo lead: ${input.nombre}`,
        mensaje: `${input.tarea_titulo}${input.tarea_fecha ? ` · para el ${input.tarea_fecha}` : ''}`,
        link: '/crm',
        dry_run: dry,
      }, ctx)
      notificados.push({ email, ok: n.success, error: n.success ? undefined : n.error })
    }

    return {
      success: true,
      affected_entity_type: 'lead',
      affected_entity_id: dry ? undefined : leadId,
      data: {
        lead_id: dry ? null : leadId,
        clave,
        tarea_id: dry ? null : (tarea.data as any)?.tarea_id ?? null,
        asignado: (tarea.data as any)?.asignado ?? (tarea.data as any)?.se_crearia?.asignado ?? null,
        notificados,
        dry_run: dry,
      },
    }
  },
}

// ═══ Registro ══════════════════════════════════════════════════════════════
export const CRM_TOOLS: Record<string, CrmTool> = {
  crm_search_people: crmSearchPeople,
  crm_search_leads: crmSearchLeads,
  crm_create_lead: crmCreateLead,
  crm_assign_task: crmAssignTask,
  notify_user: notifyUser,
  crm_create_lead_with_task: crmCreateLeadWithTask,
}

export function crmToolDefinitions() {
  return Object.values(CRM_TOOLS).map(t => t.definition)
}

export async function executeCrmTool(name: string, input: unknown, ctx: CrmCtx): Promise<CrmToolResult> {
  const tool = CRM_TOOLS[name]
  if (!tool) return { success: false, error: `Tool desconocida: ${name}` }
  try {
    return await tool.handler(input ?? {}, ctx)
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
