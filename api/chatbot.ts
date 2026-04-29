import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = { maxDuration: 60 }

const SUPABASE_URL = 'https://ubbumxommqjcpdozpunf.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViYnVteG9tbXFqY3Bkb3pwdW5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwODA3MzAsImV4cCI6MjA5MDY1NjczMH0.GPKeRgjzjZ96Qo6lYMHKF68YK4y6ZmexvORsNT8VGns'

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  message: string
  conversationId?: string
  history?: ConversationMessage[]
}

interface ChatResponse {
  ok: boolean
  reply: string
  conversationId: string
  actions?: any[]
  error?: string
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'search_quotations',
      description:
        'Busca cotizaciones en la base de datos con filtros opcionales por query, especialidad, etapa y límite',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Búsqueda por nombre o cliente' },
          specialty: { type: 'string', description: 'Filtrar por especialidad (ej: Electricidad)' },
          stage: { type: 'string', description: 'Filtrar por etapa (ej: Propuesta, Ganada, Perdida)' },
          limit: { type: 'number', description: 'Número máximo de resultados', default: 10 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_quotation_detail',
      description: 'Obtiene los detalles completos de una cotización incluyendo áreas e items',
      parameters: {
        type: 'object',
        properties: {
          quotation_id: { type: 'string', description: 'ID de la cotización' },
        },
        required: ['quotation_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_todo',
      description: 'Crea un nuevo pendiente/tarea en el sistema',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título del pendiente' },
          description: { type: 'string', description: 'Descripción detallada' },
          priority: {
            type: 'string',
            enum: ['alta', 'media', 'baja'],
            description: 'Prioridad de la tarea',
          },
          due_date: { type: 'string', description: 'Fecha de vencimiento (YYYY-MM-DD)' },
          assigned_to: { type: 'string', description: 'Usuario asignado' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Etiquetas' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_todos',
      description: 'Lista pendientes filtrados por estado y/o usuario asignado',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pendiente', 'en_progreso', 'completado', 'cancelado'],
            description: 'Filtrar por estado',
          },
          assigned_to: { type: 'string', description: 'Filtrar por usuario asignado' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_todo',
      description: 'Marca un pendiente como completado',
      parameters: {
        type: 'object',
        properties: {
          todo_id: { type: 'string', description: 'ID del pendiente' },
        },
        required: ['todo_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sales_report',
      description:
        'Obtiene un reporte de ventas con agregaciones por etapa y especialidad dentro de un período',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['week', 'month', 'quarter'],
            description: 'Período de análisis',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_collections_report',
      description: 'Obtiene reporte de cobros: hitos de pago vencidos y próximos',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_obra_report',
      description: 'Obtiene reporte de obras con conteos de actividad y reportes recientes',
      parameters: {
        type: 'object',
        properties: {
          obra_id: { type: 'string', description: 'ID específico de obra (opcional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_clients',
      description: 'Busca clientes por razón social, nombre comercial, RFC o email. Sin query trae los más recientes.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Búsqueda por razón social, nombre comercial, RFC o email (opcional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_leads',
      description: 'Busca leads con filtros opcionales',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Búsqueda por nombre o empresa' },
          status: {
            type: 'string',
            enum: ['nuevo', 'contactado', 'cotizando', 'ganado', 'perdido', 'pausado'],
            description: 'Filtrar por estado del lead',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_catalog',
      description: 'Busca productos en el catálogo por nombre, marca o modelo',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Búsqueda por nombre, marca o modelo' },
          system: {
            type: 'string',
            description: 'Filtrar por sistema/categoría',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard_summary',
      description: 'Obtiene un resumen KPI del dashboard: proyectos activos, pipeline, cobros vencidos',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_client',
      description: 'Crea un nuevo cliente (para facturación). Requiere al menos razón social y RFC.',
      parameters: {
        type: 'object',
        properties: {
          razon_social: { type: 'string', description: 'Razón social del cliente' },
          rfc: { type: 'string', description: 'RFC del cliente (13 caracteres persona física, 12 moral)' },
          nombre_comercial: { type: 'string', description: 'Nombre comercial (opcional)' },
          email: { type: 'string', description: 'Email de contacto' },
          telefono: { type: 'string', description: 'Teléfono de contacto' },
          codigo_postal: { type: 'string', description: 'Código postal' },
          tipo_persona: { type: 'string', enum: ['moral', 'fisica'], description: 'Tipo de persona' },
          regimen_fiscal: { type: 'string', description: 'Régimen fiscal' },
          calle: { type: 'string', description: 'Calle' },
          colonia: { type: 'string', description: 'Colonia' },
          municipio: { type: 'string', description: 'Municipio/Alcaldía' },
          estado: { type: 'string', description: 'Estado' },
        },
        required: ['razon_social', 'rfc'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_lead',
      description: 'Crea un nuevo lead/prospecto en el CRM',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre del proyecto o prospecto' },
          company: { type: 'string', description: 'Empresa o despacho' },
          contact_name: { type: 'string', description: 'Nombre de la persona de contacto' },
          contact_phone: { type: 'string', description: 'Teléfono de contacto' },
          contact_email: { type: 'string', description: 'Email de contacto' },
          origin: { type: 'string', enum: ['inbound', 'outbound', 'referido', 'web', 'otro'], description: 'Origen del lead' },
          needs: { type: 'array', items: { type: 'string' }, description: 'Necesidades/sistemas (ej: ["Audio", "CCTV", "Redes"])' },
          notes: { type: 'string', description: 'Notas adicionales' },
          estimated_value: { type: 'number', description: 'Valor estimado del proyecto' },
          priority: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Prioridad' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_lead',
      description: 'Actualiza un lead existente (cambiar status, agregar notas, etc.)',
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: 'string', description: 'ID del lead a actualizar' },
          status: { type: 'string', enum: ['nuevo', 'contactado', 'cotizando', 'ganado', 'perdido', 'pausado'], description: 'Nuevo status' },
          notes: { type: 'string', description: 'Notas a agregar/reemplazar' },
          estimated_value: { type: 'number', description: 'Valor estimado actualizado' },
          priority: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Prioridad' },
          contact_name: { type: 'string', description: 'Nombre de contacto' },
          contact_phone: { type: 'string', description: 'Teléfono' },
          contact_email: { type: 'string', description: 'Email' },
          lost_reason: { type: 'string', description: 'Razón de pérdida (si status=perdido)' },
        },
        required: ['lead_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_quotation',
      description: 'Crea una nueva cotización vacía (sin items) asociada a un cliente y especialidad',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre de la cotización (ej: "Casa García - Audio y CCTV")' },
          client_name: { type: 'string', description: 'Nombre del cliente' },
          specialty: { type: 'string', enum: ['esp', 'elec', 'ilum', 'cort', 'proy'], description: 'Especialidad: esp=especiales, elec=eléctrica, ilum=iluminación, cort=cortinas, proy=proyecto' },
          currency: { type: 'string', enum: ['USD', 'MXN'], description: 'Moneda' },
          notes: { type: 'string', description: 'Notas de la cotización' },
        },
        required: ['name', 'client_name', 'specialty'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_todo',
      description: 'Elimina o cancela un pendiente',
      parameters: {
        type: 'object',
        properties: {
          todo_id: { type: 'string', description: 'ID del pendiente a eliminar' },
        },
        required: ['todo_id'],
      },
    },
  },
]

async function supabaseQuery(
  table: string,
  filters: string = '',
  select: string = '*',
): Promise<any> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${select !== '*' ? `select=${encodeURIComponent(select)}` : 'select=*'}${filters ? `&${filters}` : ''}`

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Supabase query failed: ${error}`)
  }

  return response.json()
}

async function executeFunction(name: string, args: any): Promise<string> {
  try {
    switch (name) {
      case 'search_quotations': {
        const { query, specialty, stage, limit = 20 } = args
        let filters = `order=created_at.desc&limit=${limit}`
        if (query) filters += `&or=(name.ilike.%${query}%,client_name.ilike.%${query}%)`
        if (specialty) filters += `&specialty=eq.${encodeURIComponent(specialty)}`
        if (stage) filters += `&stage=eq.${encodeURIComponent(stage)}`
        const result = await supabaseQuery('quotations', filters)
        return JSON.stringify(result)
      }

      case 'get_quotation_detail': {
        const { quotation_id } = args
        const quotation = await supabaseQuery(
          'quotations',
          `id=eq.${quotation_id}`,
        )
        if (!quotation || quotation.length === 0) {
          return JSON.stringify({ error: 'Cotización no encontrada' })
        }

        const areas = await supabaseQuery(
          'quotation_areas',
          `quotation_id=eq.${quotation_id}`,
        )

        const items = await supabaseQuery(
          'quotation_items',
          `quotation_id=eq.${quotation_id}`,
        )

        return JSON.stringify({
          quotation: quotation[0],
          areas,
          items,
          item_count: items.length,
          area_count: areas.length,
        })
      }

      case 'create_todo': {
        const { title, description, priority = 'media', due_date, assigned_to, tags } = args
        const url = `${SUPABASE_URL}/rest/v1/todos`
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            title,
            description: description || null,
            priority,
            due_date: due_date || null,
            assigned_to: assigned_to || null,
            tags: tags || [],
            status: 'pendiente',
          }),
        })

        if (!response.ok) {
          const error = await response.text()
          return JSON.stringify({ error: `No se pudo crear el pendiente: ${error}` })
        }

        const created = await response.json()
        return JSON.stringify({
          success: true,
          todo: created[0] || created,
          message: 'Pendiente creado exitosamente',
        })
      }

      case 'list_todos': {
        const { status, assigned_to } = args
        let filters = ''
        if (status) filters += `status=eq.${encodeURIComponent(status)}`
        if (assigned_to) {
          filters += (filters ? '&' : '') + `assigned_to=eq.${encodeURIComponent(assigned_to)}`
        }
        const result = await supabaseQuery('todos', filters + (filters ? '&' : '') + 'order=due_date.asc')
        return JSON.stringify(result)
      }

      case 'complete_todo': {
        const { todo_id } = args
        const url = `${SUPABASE_URL}/rest/v1/todos?id=eq.${todo_id}`
        const response = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
          body: JSON.stringify({
            status: 'completado',
            completed_at: new Date().toISOString(),
          }),
        })

        if (!response.ok) {
          const error = await response.text()
          return JSON.stringify({ error: `No se pudo completar: ${error}` })
        }

        return JSON.stringify({
          success: true,
          message: 'Pendiente marcado como completado',
        })
      }

      case 'get_sales_report': {
        const { period = 'month' } = args
        const quotations = await supabaseQuery('quotations', '')

        // Group by stage and specialty
        const byStage: Record<string, number> = {}
        const bySpecialty: Record<string, number> = {}
        let total = 0

        quotations.forEach((q: any) => {
          const amount = parseFloat(q.total) || 0
          byStage[q.stage] = (byStage[q.stage] || 0) + amount
          bySpecialty[q.specialty] = (bySpecialty[q.specialty] || 0) + amount
          total += amount
        })

        return JSON.stringify({
          period,
          total_quotations: quotations.length,
          total_value: total,
          by_stage: byStage,
          by_specialty: bySpecialty,
        })
      }

      case 'get_collections_report': {
        const milestones = await supabaseQuery('payment_milestones', '')
        const today = new Date().toISOString().split('T')[0]

        const overdue = milestones.filter((m: any) => m.due_date < today && m.status !== 'pagado')
        const upcoming = milestones.filter(
          (m: any) => m.due_date >= today && m.due_date <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] && m.status !== 'pagado',
        )

        return JSON.stringify({
          overdue_count: overdue.length,
          overdue_total: overdue.reduce((sum: number, m: any) => sum + (parseFloat(m.amount) || 0), 0),
          upcoming_count: upcoming.length,
          upcoming_total: upcoming.reduce((sum: number, m: any) => sum + (parseFloat(m.amount) || 0), 0),
          overdue,
          upcoming,
        })
      }

      case 'get_obra_report': {
        const { obra_id } = args
        let filters = ''
        if (obra_id) filters = `id=eq.${obra_id}`

        const obras = await supabaseQuery('obras', filters)

        if (obra_id && obras.length === 0) {
          return JSON.stringify({ error: 'Obra no encontrada' })
        }

        // Get activities and reports count for each obra
        const enriched = await Promise.all(
          obras.map(async (obra: any) => {
            const activities = await supabaseQuery(
              'obra_actividades',
              `obra_id=eq.${obra.id}`,
            )
            const reports = await supabaseQuery(
              'obra_reportes',
              `obra_id=eq.${obra.id}`,
            )
            return {
              ...obra,
              activity_count: activities.length,
              report_count: reports.length,
              recent_activity: activities[activities.length - 1] || null,
            }
          }),
        )

        return JSON.stringify(
          obra_id ? enriched[0] : { obras: enriched, total: enriched.length },
        )
      }

      case 'search_clients': {
        const { query } = args
        let filters = 'order=created_at.desc&limit=50'
        if (query) filters += `&or=(razon_social.ilike.%${query}%,nombre_comercial.ilike.%${query}%,rfc.ilike.%${query}%,email.ilike.%${query}%)`
        const result = await supabaseQuery('clientes', filters)
        return JSON.stringify(result)
      }

      case 'search_leads': {
        const { query, status } = args
        let filters = 'order=priority.asc,created_at.desc&limit=50'
        if (query) filters += `&or=(name.ilike.%${query}%,company.ilike.%${query}%,contact_name.ilike.%${query}%)`
        if (status) filters += `&status=eq.${encodeURIComponent(status)}`
        const result = await supabaseQuery('leads', filters)
        return JSON.stringify(result)
      }

      case 'search_catalog': {
        const { query, system } = args
        let filters = `or=(name.ilike.%${query}%,marca.ilike.%${query}%,modelo.ilike.%${query}%)`
        if (system) filters += `&system=eq.${encodeURIComponent(system)}`
        const result = await supabaseQuery('catalog_products', filters)
        return JSON.stringify(result)
      }

      case 'get_dashboard_summary': {
        const [quotations, obras, milestones, employees] = await Promise.all([
          supabaseQuery('quotations', ''),
          supabaseQuery('obras', 'status=neq.completado'),
          supabaseQuery('payment_milestones', ''),
          supabaseQuery('employees', 'is_active=eq.true'),
        ])

        const today = new Date().toISOString().split('T')[0]
        const activeProjects = obras.filter((o: any) => o.status === 'en_progreso').length
        const pipelineTotal = quotations
          .filter((q: any) => q.stage === 'Propuesta')
          .reduce((sum: number, q: any) => sum + (parseFloat(q.total) || 0), 0)
        const overdueCollections = milestones
          .filter((m: any) => m.due_date < today && m.status !== 'pagado')
          .reduce((sum: number, m: any) => sum + (parseFloat(m.amount) || 0), 0)

        return JSON.stringify({
          active_projects: activeProjects,
          pipeline_total: pipelineTotal,
          overdue_collections: overdueCollections,
          active_employees: employees.length,
          recent_quotations: quotations.slice(0, 5),
          total_quotations: quotations.length,
          total_obras: obras.length,
        })
      }

      case 'create_client': {
        const { razon_social, rfc, nombre_comercial, email, telefono, codigo_postal, tipo_persona, regimen_fiscal, calle, colonia, municipio, estado } = args
        const url = `${SUPABASE_URL}/rest/v1/clientes`
        const body: any = { razon_social, rfc, codigo_postal: codigo_postal || '' }
        if (nombre_comercial) body.nombre_comercial = nombre_comercial
        if (email) body.email = email
        if (telefono) body.telefono = telefono
        if (tipo_persona) body.tipo_persona = tipo_persona
        if (regimen_fiscal) body.regimen_fiscal = regimen_fiscal
        if (calle) body.calle = calle
        if (colonia) body.colonia = colonia
        if (municipio) body.municipio = municipio
        if (estado) body.estado = estado

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: 'return=representation',
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const error = await response.text()
          return JSON.stringify({ error: `No se pudo crear el cliente: ${error}` })
        }

        const created = await response.json()
        return JSON.stringify({ success: true, client: created[0] || created, message: `Cliente "${razon_social}" creado exitosamente` })
      }

      case 'create_lead': {
        const { name: leadName, company, contact_name, contact_phone, contact_email, origin, needs, notes, estimated_value, priority } = args
        const url = `${SUPABASE_URL}/rest/v1/leads`
        const body: any = { name: leadName }
        if (company) body.company = company
        if (contact_name) body.contact_name = contact_name
        if (contact_phone) body.contact_phone = contact_phone
        if (contact_email) body.contact_email = contact_email
        if (origin) body.origin = origin
        if (needs) body.needs = needs
        if (notes) body.notes = notes
        if (estimated_value) body.estimated_value = estimated_value
        if (priority) body.priority = priority

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: 'return=representation',
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const error = await response.text()
          return JSON.stringify({ error: `No se pudo crear el lead: ${error}` })
        }

        const created = await response.json()
        return JSON.stringify({ success: true, lead: created[0] || created, message: `Lead "${leadName}" creado exitosamente` })
      }

      case 'update_lead': {
        const { lead_id, ...updates } = args
        const url = `${SUPABASE_URL}/rest/v1/leads?id=eq.${lead_id}`
        const body: any = { updated_at: new Date().toISOString() }
        for (const [key, val] of Object.entries(updates)) {
          if (val !== undefined && val !== null) body[key] = val
        }

        const response = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: 'return=representation',
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const error = await response.text()
          return JSON.stringify({ error: `No se pudo actualizar el lead: ${error}` })
        }

        const updated = await response.json()
        return JSON.stringify({ success: true, lead: updated[0] || updated, message: 'Lead actualizado exitosamente' })
      }

      case 'create_quotation': {
        const { name: quoteName, client_name, specialty, currency = 'USD', notes: qNotes } = args
        const url = `${SUPABASE_URL}/rest/v1/quotations`
        const body: any = {
          name: quoteName,
          client_name,
          specialty,
          currency,
          stage: 'borrador',
          total: 0,
        }
        if (qNotes) body.notes = JSON.stringify({ notes: qNotes })

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: 'return=representation',
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const error = await response.text()
          return JSON.stringify({ error: `No se pudo crear la cotización: ${error}` })
        }

        const created = await response.json()
        return JSON.stringify({ success: true, quotation: created[0] || created, message: `Cotización "${quoteName}" creada exitosamente` })
      }

      case 'delete_todo': {
        const { todo_id } = args
        const url = `${SUPABASE_URL}/rest/v1/todos?id=eq.${todo_id}`
        const response = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
          body: JSON.stringify({ status: 'cancelado' }),
        })

        if (!response.ok) {
          const error = await response.text()
          return JSON.stringify({ error: `No se pudo eliminar: ${error}` })
        }

        return JSON.stringify({ success: true, message: 'Pendiente cancelado' })
      }

      default:
        return JSON.stringify({ error: `Función desconocida: ${name}` })
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return JSON.stringify({ error: `Error ejecutando función: ${errorMessage}` })
  }
}

async function callOpenAI(
  messages: any[],
  apiKey: string,
): Promise<{
  content?: string
  tool_calls?: any[]
  stop_reason: string
}> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 2000,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${error}`)
  }

  const data = await response.json()
  const choice = data.choices[0]

  return {
    content: choice.message.content,
    tool_calls: choice.message.tool_calls,
    stop_reason: choice.finish_reason,
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método no permitido' })
    return
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      res.status(500).json({
        ok: false,
        error: 'OPENAI_API_KEY no configurada',
        reply: 'Disculpa, el servidor no está configurado correctamente.',
        conversationId: '',
      })
      return
    }

    const { message, conversationId, history = [] } = req.body as ChatRequest

    if (!message) {
      res.status(400).json({
        ok: false,
        error: 'Campo "message" requerido',
        reply: '',
        conversationId: '',
      })
      return
    }

    const systemPrompt = `Eres OMM Bot, el asistente inteligente de OMM Technologies — una empresa de instalaciones especiales (audio, redes, CCTV, control de acceso, iluminación, detección de humo, cortinas motorizadas) en CDMX.

REGLAS:
- Responde siempre en español, conciso y profesional. Usa emojis moderadamente.
- Cuando el usuario pida algo, USA LAS HERRAMIENTAS disponibles para ejecutar la acción. No digas que no puedes si tienes una herramienta para ello.
- Si el usuario pide información, SIEMPRE llama la herramienta primero y luego responde con los datos reales.
- Si una búsqueda no tiene resultados con un filtro, intenta sin filtro o con filtro más amplio antes de decir que no hay datos.
- Para listar leads con más prioridad: usa search_leads sin filtro de status (trae todos) y ordénalos tú por priority.

BASE DE DATOS — VALORES REALES:
- leads.status: "nuevo", "contactado", "cotizando", "ganado", "perdido", "pausado"
- leads.priority: "alta", "media", "fria"
- leads campos: id, name, company, contact_name, contact_phone, contact_email, origin, status, needs (array), notes, estimated_value, priority, created_at
- quotations.stage: "oportunidad", "contrato" (y posibles: "borrador", "enviada", "ganada", "perdida")
- quotations.specialty: "esp" (especiales), "elec" (eléctrica), "ilum" (iluminación), "proy" (proyecto)
- quotations campos: id, name, client_name, specialty, stage, total, currency, notes (jsonb), created_at
- clientes campos: id, rfc, razon_social, nombre_comercial, email, telefono, codigo_postal, tipo_persona, regimen_fiscal, calle, colonia, municipio, estado, activo
- catalog_products campos: id, name, marca, modelo, system, provider, cost, moneda, description, specialty
- todos campos: id, title, description, status ("pendiente","en_progreso","completado","cancelado"), priority ("alta","media","baja"), due_date, assigned_to, tags, created_at, completed_at
- obras campos: id, name, status, project_id, created_at
- employees campos: id, name, role, is_active

IMPORTANTE: Cuando busques leads, clientes o cotizaciones, si el usuario no especifica filtro, trae todos y presenta los más relevantes. No inventes datos — siempre consulta la base de datos.`

    // Build messages array
    let messages: any[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      ...history.map((m: ConversationMessage) => ({
        role: m.role,
        content: m.content,
      })),
      {
        role: 'user',
        content: message,
      },
    ]

    const conversationIdForUse = conversationId || `conv_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const actions: any[] = []
    let reply = ''
    let iterationCount = 0
    const maxIterations = 5

    // Agentic loop
    while (iterationCount < maxIterations) {
      iterationCount++

      const openaiResponse = await callOpenAI(messages, apiKey)
      const { content, tool_calls, stop_reason } = openaiResponse

      // Add assistant message
      const assistantMessage: any = {
        role: 'assistant',
        content: content || '',
      }

      if (tool_calls && tool_calls.length > 0) {
        assistantMessage.tool_calls = tool_calls
      }

      messages.push(assistantMessage)

      // If no tool calls or stop_reason is "stop", we're done
      if (!tool_calls || tool_calls.length === 0 || stop_reason === 'stop') {
        reply = content || ''
        break
      }

      // Execute tool calls
      const toolResults: any[] = []
      for (const toolCall of tool_calls) {
        const { id, function: func } = toolCall
        const functionName = func.name
        const functionArgs = JSON.parse(func.arguments)

        try {
          const result = await executeFunction(functionName, functionArgs)
          toolResults.push({
            tool_use_id: id,
            type: 'tool_result',
            content: result,
          })
          actions.push({
            function: functionName,
            args: functionArgs,
            result: JSON.parse(result),
          })
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          toolResults.push({
            tool_use_id: id,
            type: 'tool_result',
            content: JSON.stringify({ error: errorMsg }),
          })
        }
      }

      // Add tool results (OpenAI format: role 'tool' with tool_call_id)
      for (const result of toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: result.tool_use_id,
          content: result.content,
        })
      }
    }

    // Save conversation messages to agent_messages (schema: conversation_id uuid, role text, content jsonb)
    // Skip saving if no valid conversation_id (agent_messages.conversation_id is NOT NULL uuid)
    // For the ERP chatbot we just log to console; full persistence can be added later
    if (actions.length > 0) {
      console.log(`[chatbot] ${actions.length} tool calls:`, actions.map(a => a.function).join(', '))
    }

    const response: ChatResponse = {
      ok: true,
      reply,
      conversationId: conversationIdForUse,
    }

    if (actions.length > 0) {
      response.actions = actions
    }

    res.status(200).json(response)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Chatbot error:', errorMessage)

    res.status(500).json({
      ok: false,
      error: errorMessage,
      reply: 'Disculpa, ocurrió un error procesando tu solicitud.',
      conversationId: '',
    })
  }
}
