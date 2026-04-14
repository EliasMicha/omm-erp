// OMM Agent — Tools v3
// Asistente ejecutivo: captura pendientes, extras, prefacturas, consultas, acciones sobre OCs.
// Todas las tools escriben en tablas existentes del ERP (project_tasks, obra_extras, facturas, etc.)

import type { ToolDefinition, ToolExecutionContext, ToolResult } from './types.ts';

type ToolHandler = (input: any, ctx: ToolExecutionContext) => Promise<ToolResult>;

interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
  allowed_roles: Array<'admin' | 'interno' | 'cliente' | 'arquitecto'>;
}

// ============================================================
// HELPERS
// ============================================================

// Mapea un nombre (ej "Ricardo") a employee_id. Busca en name y nombre.
async function resolveEmployee(supabase: any, nameHint: string): Promise<{ id: string; name: string } | null> {
  if (!nameHint) return null;
  const { data } = await supabase
    .from('employees')
    .select('id, name, nombre')
    .or(`name.ilike.%${nameHint}%,nombre.ilike.%${nameHint}%`)
    .eq('activo', true)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, name: data.name || data.nombre };
}

// Busca obra por nombre (parcial). Si hay una activa en contexto, la prefiere.
async function resolveObra(supabase: any, ctx: ToolExecutionContext, nameHint?: string): Promise<any | null> {
  if (!nameHint && ctx.conversation.active_obra_id) {
    const { data } = await supabase.from('obras').select('id, nombre, cliente, project_id').eq('id', ctx.conversation.active_obra_id).maybeSingle();
    return data;
  }
  if (!nameHint) return null;
  const { data } = await supabase
    .from('obras')
    .select('id, nombre, cliente, project_id')
    .ilike('nombre', `%${nameHint}%`)
    .limit(1)
    .maybeSingle();
  return data;
}

// Actualiza el contexto activo de la conversación
async function setContext(supabase: any, conversationId: string, obraId: string | null, leadId: string | null = null) {
  await supabase
    .from('agent_conversations')
    .update({ active_obra_id: obraId, active_lead_id: leadId })
    .eq('id', conversationId);
}

// ============================================================
// TOOL: set_conversation_context
// "Estoy en junta de Oasis 5" → fija contexto
// ============================================================
const setConversationContext: Tool = {
  allowed_roles: ['admin', 'interno'],
  definition: {
    name: 'set_conversation_context',
    description: 'Fija el contexto activo de la conversación a una obra o lead. Úsalo cuando el usuario diga "estoy en junta de X", "hablando de X", "vamos a ver X". Así las siguientes acciones (crear tareas, extras, prefactura) se vinculan a esa entidad sin tener que repetirla.',
    input_schema: {
      type: 'object',
      properties: {
        obra_search: { type: 'string', description: 'Nombre parcial de la obra a fijar como contexto' },
        lead_search: { type: 'string', description: 'Nombre parcial del lead a fijar como contexto' },
      },
    },
  },
  handler: async (input, ctx) => {
    const { obra_search, lead_search } = input;
    if (obra_search) {
      const obra = await resolveObra(ctx.supabase, ctx, obra_search);
      if (!obra) return { success: false, error: `No encontré obra que coincida con "${obra_search}"` };
      await setContext(ctx.supabase, ctx.conversation.id, obra.id);
      return {
        success: true,
        data: { obra_id: obra.id, obra_nombre: obra.nombre },
        user_facing_message: `📍 Contexto activo: ${obra.nombre} (${obra.cliente})`,
      };
    }
    if (lead_search) {
      const { data: lead } = await ctx.supabase
        .from('leads')
        .select('id, name, company')
        .ilike('name', `%${lead_search}%`)
        .limit(1)
        .maybeSingle();
      if (!lead) return { success: false, error: `No encontré lead que coincida con "${lead_search}"` };
      await setContext(ctx.supabase, ctx.conversation.id, null, lead.id);
      return {
        success: true,
        data: { lead_id: lead.id, lead_nombre: lead.name },
        user_facing_message: `📍 Contexto activo: lead ${lead.name} (${lead.company ?? ''})`,
      };
    }
    return { success: false, error: 'Debes proveer obra_search o lead_search' };
  },
};

// ============================================================
// TOOL: query_obras
// ============================================================
const queryObras: Tool = {
  allowed_roles: ['admin', 'interno', 'cliente', 'arquitecto'],
  definition: {
    name: 'query_obras',
    description: 'Busca obras (proyectos en ejecución). Devuelve nombre, cliente, status, avance, sistemas, valor. Úsalo para consultas de status.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'integer', default: 10 },
      },
    },
  },
  handler: async (input, ctx) => {
    const { search, status, limit = 10 } = input;
    let q = ctx.supabase
      .from('obras')
      .select('id, nombre, cliente, direccion, status, sistemas, fecha_inicio, fecha_fin_plan, avance_global, valor_contrato, moneda, urgencia, notas, project_id')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (['cliente', 'arquitecto'].includes(ctx.contact.role) && ctx.contact.obra_id) {
      q = q.eq('id', ctx.contact.obra_id);
    }
    if (search) q = q.or(`nombre.ilike.%${search}%,cliente.ilike.%${search}%`);
    if (status) q = q.eq('status', status);

    const { data, error } = await q;
    if (error) return { success: false, error: error.message };
    return { success: true, data };
  },
};

// ============================================================
// TOOL: query_leads
// ============================================================
const queryLeads: Tool = {
  allowed_roles: ['admin', 'interno'],
  definition: {
    name: 'query_leads',
    description: 'Busca leads en el CRM (pipeline, prospectos antes de que se vuelvan obra).',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'integer', default: 10 },
      },
      required: ['search'],
    },
  },
  handler: async (input, ctx) => {
    const { search, status, limit = 10 } = input;
    let q = ctx.supabase
      .from('leads')
      .select('id, name, company, contact_name, contact_phone, status, estimated_value, notes, project_id, updated_at')
      .or(`name.ilike.%${search}%,company.ilike.%${search}%,contact_name.ilike.%${search}%`)
      .limit(limit);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return { success: false, error: error.message };
    return { success: true, data };
  },
};

// ============================================================
// TOOL: create_tasks_batch
// Captura una lista de pendientes de junta y los crea en project_tasks con assignees mapeados.
// ============================================================
const createTasksBatch: Tool = {
  allowed_roles: ['admin', 'interno'],
  definition: {
    name: 'create_tasks_batch',
    description: 'Crea múltiples tareas/pendientes en project_tasks de una sola vez. Úsalo para capturar pendientes de una junta. Cada tarea puede tener un assignee (nombre que se mapea a employee_id), prioridad, due_date, sistema. Si no especificas project_id, usa el de la obra activa del contexto.',
    input_schema: {
      type: 'object',
      properties: {
        obra_search: { type: 'string', description: 'Nombre parcial de la obra (opcional si ya hay contexto)' },
        tasks: {
          type: 'array',
          description: 'Lista de tareas a crear',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Título corto de la tarea' },
              description: { type: 'string', description: 'Detalle opcional' },
              assignee_name: { type: 'string', description: 'Nombre del responsable (ej "Ricardo", "Alfredo")' },
              priority: { type: 'integer', description: '1=baja, 2=media, 3=alta', default: 2 },
              due_date: { type: 'string', description: 'Fecha ISO yyyy-mm-dd' },
              system: { type: 'string', description: 'ELE/ESP/ILU/CORT/PROY' },
              area: { type: 'string' },
            },
            required: ['name'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  handler: async (input, ctx) => {
    const { obra_search, tasks } = input;

    // Resolver obra y project_id
    const obra = await resolveObra(ctx.supabase, ctx, obra_search);
    if (!obra) {
      return { success: false, error: 'No hay obra activa en contexto y no se proveyó obra_search' };
    }
    if (!obra.project_id) {
      return { success: false, error: `La obra "${obra.nombre}" no tiene project_id asociado` };
    }

    // Mapear assignees en paralelo
    const resolvedTasks = await Promise.all(
      tasks.map(async (t: any) => {
        let assignee_id: string | null = null;
        let assignee_name: string | null = null;
        if (t.assignee_name) {
          const emp = await resolveEmployee(ctx.supabase, t.assignee_name);
          if (emp) {
            assignee_id = emp.id;
            assignee_name = emp.name;
          } else {
            assignee_name = t.assignee_name + ' (no mapeado)';
          }
        }
        return {
          project_id: obra.project_id,
          name: t.name,
          description: t.description ?? null,
          assignee_id,
          status: 'pending',
          priority: t.priority ?? 2,
          due_date: t.due_date ?? null,
          system: t.system ?? null,
          area: t.area ?? null,
          notes: `Creada por agente WhatsApp desde conversación con ${ctx.contact.display_name}`,
          _resolved_name: assignee_name,
        };
      })
    );

    const toInsert = resolvedTasks.map(({ _resolved_name, ...rest }) => rest);
    const { data, error } = await ctx.supabase.from('project_tasks').insert(toInsert).select();
    if (error) return { success: false, error: error.message };

    // Auto-fijar contexto si no estaba
    if (!ctx.conversation.active_obra_id) {
      await setContext(ctx.supabase, ctx.conversation.id, obra.id);
    }

    const summary = resolvedTasks
      .map((t, i) => `${i + 1}. ${t.name}${t._resolved_name ? ` → ${t._resolved_name}` : ''}`)
      .join('\n');

    return {
      success: true,
      data: { count: data?.length ?? 0, tasks: data },
      affected_entity_type: 'obra',
      affected_entity_id: obra.id,
      user_facing_message: `✅ ${data?.length ?? 0} tareas creadas en ${obra.nombre}:\n${summary}`,
    };
  },
};

// ============================================================
// TOOL: create_obra_extras
// Captura extras por cotizar en la tabla obra_extras (buffer pre-cotización)
// ============================================================
const createObraExtras: Tool = {
  allowed_roles: ['admin', 'interno'],
  definition: {
    name: 'create_obra_extras',
    description: 'Registra extras de una obra (cambios, adiciones) en obra_extras para que después sean cotizados. Úsalo cuando el usuario dicte "extras de X: agregar/cambiar/mover Y". Cada item puede tener cantidad, unidad, sistema, área, precio estimado.',
    input_schema: {
      type: 'object',
      properties: {
        obra_search: { type: 'string', description: 'Nombre parcial de la obra (opcional si hay contexto)' },
        extras: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              descripcion: { type: 'string' },
              cantidad: { type: 'number', default: 1 },
              unidad: { type: 'string', default: 'pza' },
              sistema: { type: 'string', description: 'ELE/ESP/ILU/CORT/PROY' },
              area: { type: 'string' },
              tipo: { type: 'string', enum: ['adicion', 'cambio', 'remocion', 'upgrade'], default: 'adicion' },
              precio_estimado: { type: 'number' },
              moneda: { type: 'string', enum: ['MXN', 'USD'], default: 'MXN' },
            },
            required: ['descripcion'],
          },
        },
      },
      required: ['extras'],
    },
  },
  handler: async (input, ctx) => {
    const { obra_search, extras } = input;
    const obra = await resolveObra(ctx.supabase, ctx, obra_search);
    if (!obra) return { success: false, error: 'No hay obra en contexto y no se proveyó obra_search' };

    const toInsert = extras.map((e: any) => ({
      obra_id: obra.id,
      tipo: e.tipo ?? 'adicion',
      descripcion: e.descripcion,
      cantidad: e.cantidad ?? 1,
      unidad: e.unidad ?? 'pza',
      sistema: e.sistema ?? null,
      area: e.area ?? null,
      precio_estimado: e.precio_estimado ?? null,
      moneda: e.moneda ?? 'MXN',
      status: 'pendiente',
      detectado_por: 'whatsapp_agent',
      texto_original: e.descripcion,
    }));

    const { data, error } = await ctx.supabase.from('obra_extras').insert(toInsert).select();
    if (error) return { success: false, error: error.message };

    if (!ctx.conversation.active_obra_id) {
      await setContext(ctx.supabase, ctx.conversation.id, obra.id);
    }

    const list = extras.map((e: any, i: number) => `${i + 1}. ${e.descripcion}${e.cantidad > 1 ? ` (${e.cantidad} ${e.unidad})` : ''}`).join('\n');
    return {
      success: true,
      data: { count: data?.length, extras: data },
      affected_entity_type: 'obra',
      affected_entity_id: obra.id,
      user_facing_message: `📋 ${data?.length} extras registrados en ${obra.nombre}:\n${list}\n\nListos para cotizar en el ERP.`,
    };
  },
};

// ============================================================
// TOOL: query_cobranza
// ============================================================
const queryCobranza: Tool = {
  allowed_roles: ['admin', 'interno'],
  definition: {
    name: 'query_cobranza',
    description: 'Status de cobranza de una obra/proyecto: hitos, monto cobrado, pendiente, % avance. Úsalo para "cuánto llevamos cobrado de X" o "qué hitos están vencidos".',
    input_schema: {
      type: 'object',
      properties: {
        obra_search: { type: 'string' },
        only_pending: { type: 'boolean', default: false, description: 'Solo hitos no cobrados' },
      },
    },
  },
  handler: async (input, ctx) => {
    const { obra_search, only_pending = false } = input;
    const obra = await resolveObra(ctx.supabase, ctx, obra_search);
    if (!obra) return { success: false, error: 'No hay obra en contexto' };
    if (!obra.project_id) return { success: false, error: 'La obra no tiene project_id' };

    let q = ctx.supabase
      .from('hitos_cobro')
      .select('id, numero_hito, descripcion, monto, porcentaje, fecha_programada, fecha_cobro_real, estado, monto_cobrado, monto_pendiente, factura_id')
      .eq('proyecto_id', obra.project_id)
      .order('numero_hito');
    if (only_pending) q = q.neq('estado', 'cobrado');

    const { data, error } = await q;
    if (error) return { success: false, error: error.message };

    const totalContrato = obra.valor_contrato ?? 0;
    const totalCobrado = (data ?? []).reduce((s: number, h: any) => s + Number(h.monto_cobrado ?? 0), 0);
    const totalPendiente = (data ?? []).reduce((s: number, h: any) => s + Number(h.monto_pendiente ?? 0), 0);
    const pctCobrado = totalContrato > 0 ? (totalCobrado / totalContrato) * 100 : 0;

    return {
      success: true,
      data: {
        obra: { id: obra.id, nombre: obra.nombre, valor_contrato: totalContrato },
        resumen: { total_cobrado: totalCobrado, total_pendiente: totalPendiente, pct_cobrado: pctCobrado.toFixed(1) },
        hitos: data,
      },
    };
  },
};

// ============================================================
// TOOL: generate_prefactura_draft
// Crea una factura en estado 'borrador' (sin timbrar). Vincula a hito si aplica.
// ============================================================
const generatePrefacturaDraft: Tool = {
  allowed_roles: ['admin', 'interno'],
  definition: {
    name: 'generate_prefactura_draft',
    description: 'Crea una PREFACTURA EN BORRADOR (no fiscal, no timbrada) para una obra. Si el usuario dice "prefactura del 40%", busca el hito que coincida con ese porcentaje. Insert en facturas con estado=borrador + factura_conceptos. Devuelve el id para poder timbrarla después.',
    input_schema: {
      type: 'object',
      properties: {
        obra_search: { type: 'string' },
        monto: { type: 'number', description: 'Monto explícito (subtotal sin IVA)' },
        porcentaje_hito: { type: 'number', description: 'Si se refiere a un hito por %, ej. 40' },
        concepto: { type: 'string', description: 'Descripción del concepto (ej "Anticipo 40% obra Oasis 5")' },
        moneda: { type: 'string', enum: ['MXN', 'USD'], default: 'MXN' },
      },
    },
  },
  handler: async (input, ctx) => {
    const { obra_search, monto, porcentaje_hito, concepto, moneda = 'MXN' } = input;
    const obra = await resolveObra(ctx.supabase, ctx, obra_search);
    if (!obra) return { success: false, error: 'No hay obra en contexto' };

    // Buscar cliente facturable
    const { data: obraFull } = await ctx.supabase
      .from('obras')
      .select('id, nombre, cliente_id, valor_contrato, project_id, quotation_id')
      .eq('id', obra.id)
      .maybeSingle();
    if (!obraFull?.cliente_id) return { success: false, error: 'La obra no tiene cliente_id asignado; no se puede facturar' };

    const { data: cliente } = await ctx.supabase
      .from('clientes')
      .select('id, rfc, razon_social, facturapi_customer_id, uso_cfdi, regimen_fiscal, codigo_postal, email')
      .eq('id', obraFull.cliente_id)
      .maybeSingle();
    if (!cliente) return { success: false, error: 'Cliente no encontrado' };

    // Resolver hito si aplica
    let hito: any = null;
    let subtotal = monto ?? 0;
    let conceptoTxt = concepto ?? '';
    if (porcentaje_hito && obraFull.project_id) {
      const { data: hitos } = await ctx.supabase
        .from('hitos_cobro')
        .select('*')
        .eq('proyecto_id', obraFull.project_id)
        .neq('estado', 'cobrado');
      hito = hitos?.find((h: any) => Math.abs(Number(h.porcentaje) - porcentaje_hito) < 0.5);
      if (hito) {
        subtotal = Number(hito.monto);
        conceptoTxt = conceptoTxt || `${hito.descripcion || `Hito ${hito.numero_hito}`} — ${porcentaje_hito}% de ${obra.nombre}`;
      }
    }

    if (subtotal <= 0) {
      return { success: false, error: 'No se pudo determinar monto. Especifica monto o un porcentaje_hito que exista.' };
    }

    if (!conceptoTxt) conceptoTxt = `Anticipo ${obra.nombre}`;

    const iva = subtotal * 0.16;
    const total = subtotal + iva;

    // Insert en facturas (estado borrador)
    const { data: factura, error: facErr } = await ctx.supabase
      .from('facturas')
      .insert({
        estado: 'borrador',
        tipo_comprobante: 'I',  // Ingreso
        fecha_emision: new Date().toISOString(),
        emisor_rfc: Deno.env.get('OMM_RFC') ?? 'OMM000000000',
        emisor_nombre: 'OMM TECHNOLOGIES',
        receptor_rfc: cliente.rfc,
        receptor_nombre: cliente.razon_social,
        receptor_regimen_fiscal: cliente.regimen_fiscal,
        receptor_uso_cfdi: cliente.uso_cfdi || 'G03',
        receptor_domicilio_fiscal: cliente.codigo_postal,
        subtotal,
        iva,
        total,
        moneda,
        tipo_cambio: moneda === 'USD' ? null : 1,
        metodo_pago: 'PPD',
        forma_pago: '99',
        proyecto_id: obraFull.project_id,
        cliente_id: cliente.id,
        cotizacion_id: obraFull.quotation_id,
      })
      .select()
      .single();

    if (facErr) return { success: false, error: facErr.message };

    // Insert concepto único
    const { error: conErr } = await ctx.supabase.from('factura_conceptos').insert({
      factura_id: factura.id,
      clave_prod_serv: '81101500', // Servicios de ingeniería
      clave_unidad: 'E48',          // Unidad de servicio
      unidad: 'Servicio',
      cantidad: 1,
      descripcion: conceptoTxt,
      valor_unitario: subtotal,
      importe: subtotal,
      objeto_imp: '02',
      iva_tasa: 0.16,
      iva_importe: iva,
      orden_display: 1,
      order_index: 1,
    });
    if (conErr) {
      // rollback: borrar factura
      await ctx.supabase.from('facturas').delete().eq('id', factura.id);
      return { success: false, error: `Error en concepto: ${conErr.message}` };
    }

    // Si vino de un hito, vincular
    if (hito) {
      await ctx.supabase.from('hitos_cobro').update({ factura_id: factura.id }).eq('id', hito.id);
    }

    return {
      success: true,
      data: { factura_id: factura.id, subtotal, iva, total, moneda, cliente: cliente.razon_social },
      affected_entity_type: 'factura',
      affected_entity_id: factura.id,
      user_facing_message: `📄 Prefactura BORRADOR creada:\n• ${cliente.razon_social}\n• ${conceptoTxt}\n• Subtotal: $${subtotal.toLocaleString('es-MX')} ${moneda}\n• IVA: $${iva.toLocaleString('es-MX')}\n• Total: $${total.toLocaleString('es-MX')} ${moneda}\n\nID: ${factura.id}\n\n⚠️ Es borrador, NO está timbrada. Dime "timbra la prefactura ${factura.id.slice(0, 8)}" cuando quieras emitir el CFDI real.`,
    };
  },
};

// ============================================================
// TOOL: timbrar_prefactura (requiere confirmación explícita)
// ============================================================
const timbrarPrefactura: Tool = {
  allowed_roles: ['admin'],
  definition: {
    name: 'timbrar_prefactura',
    description: 'Timbra (emite CFDI real vía FacturAPI) una prefactura que está en estado borrador. ACCIÓN IRREVERSIBLE — solo ejecuta si el usuario confirmó explícitamente con palabras como "sí timbra", "confirma timbrado", "adelante timbra".',
    input_schema: {
      type: 'object',
      properties: {
        factura_id: { type: 'string', description: 'UUID de la factura borrador' },
        confirmed: { type: 'boolean', description: 'true solo si el usuario confirmó explícitamente' },
      },
      required: ['factura_id', 'confirmed'],
    },
  },
  handler: async (input, ctx) => {
    if (!input.confirmed) {
      return {
        success: false,
        error: 'Timbrado no confirmado. Pregunta al usuario antes de volver a llamar.',
        requires_confirmation: true,
      };
    }
    // Por ahora: solo cambiamos estado. La llamada real a FacturAPI la agregamos en la siguiente iteración.
    const { data, error } = await ctx.supabase
      .from('facturas')
      .update({ estado: 'pendiente_timbrado_agent' })
      .eq('id', input.factura_id)
      .eq('estado', 'borrador')
      .select()
      .single();
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data,
      affected_entity_type: 'factura',
      affected_entity_id: input.factura_id,
      user_facing_message: `⏳ Prefactura marcada para timbrado. (Integración con FacturAPI pendiente — por ahora el timbrado final lo debes hacer desde el ERP).`,
    };
  },
};

// ============================================================
// TOOL: query_purchase_orders
// ============================================================
const queryPurchaseOrders: Tool = {
  allowed_roles: ['admin', 'interno'],
  definition: {
    name: 'query_purchase_orders',
    description: 'Lista OCs filtradas por status, proveedor u obra. Úsalo para "qué OCs siguen sin pagar", "OCs pendientes con Lutron", etc.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        supplier_search: { type: 'string' },
        obra_search: { type: 'string' },
        limit: { type: 'integer', default: 20 },
      },
    },
  },
  handler: async (input, ctx) => {
    const { status, supplier_search, obra_search, limit = 20 } = input;
    let q = ctx.supabase
      .from('purchase_orders')
      .select('id, created_at, status, total, currency, obra_id, supplier_id, suppliers(name), obras(nombre)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);
    if (obra_search) {
      const obra = await resolveObra(ctx.supabase, ctx, obra_search);
      if (obra) q = q.eq('obra_id', obra.id);
    }
    const { data, error } = await q;
    if (error) return { success: false, error: error.message };

    let filtered = data ?? [];
    if (supplier_search) {
      const s = supplier_search.toLowerCase();
      filtered = filtered.filter((po: any) => po.suppliers?.name?.toLowerCase().includes(s));
    }
    return { success: true, data: filtered };
  },
};

// ============================================================
// TOOL: update_purchase_order
// ============================================================
const updatePurchaseOrder: Tool = {
  allowed_roles: ['admin'],
  definition: {
    name: 'update_purchase_order',
    description: 'Actualiza el status de una OC (aprobar cotejo, cancelar, marcar entregada). ACCIÓN que requiere confirmación si es destructiva.',
    input_schema: {
      type: 'object',
      properties: {
        po_id: { type: 'string' },
        new_status: { type: 'string', description: 'Nuevo status' },
        reason: { type: 'string' },
      },
      required: ['po_id', 'new_status'],
    },
  },
  handler: async (input, ctx) => {
    const { po_id, new_status, reason } = input;
    const { data, error } = await ctx.supabase
      .from('purchase_orders')
      .update({ status: new_status })
      .eq('id', po_id)
      .select()
      .single();
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data,
      affected_entity_type: 'purchase_order',
      affected_entity_id: po_id,
      user_facing_message: `✅ OC ${po_id.slice(0, 8)} → ${new_status}${reason ? ` (${reason})` : ''}`,
    };
  },
};

// ============================================================
// TOOL: send_document_whatsapp
// ============================================================
const sendDocumentWhatsapp: Tool = {
  allowed_roles: ['admin', 'interno'],
  definition: {
    name: 'send_document_whatsapp',
    description: 'Envía un documento ya generado (PDF, XML) por WhatsApp a un número específico. Úsalo después de generar una prefactura o cotización si el usuario pide "mándamelo" o "mándaselo al cliente".',
    input_schema: {
      type: 'object',
      properties: {
        storage_path: { type: 'string', description: 'Ruta en agent-documents bucket' },
        recipient_phone: { type: 'string', description: 'Número destino en formato E.164 (+52...)' },
        filename: { type: 'string' },
        caption: { type: 'string' },
      },
      required: ['storage_path', 'recipient_phone', 'filename'],
    },
  },
  handler: async (input, ctx) => {
    // Placeholder: la implementación real descarga de storage, sube a WA media, y manda
    // Lo implementamos en la siguiente iteración junto con el PDF generator
    return {
      success: false,
      error: 'send_document_whatsapp todavía no implementado (requiere PDF generator)',
    };
  },
};

// ============================================================
// Registro central
// ============================================================
export const TOOLS: Record<string, Tool> = {
  set_conversation_context: setConversationContext,
  query_obras: queryObras,
  query_leads: queryLeads,
  create_tasks_batch: createTasksBatch,
  create_obra_extras: createObraExtras,
  query_cobranza: queryCobranza,
  generate_prefactura_draft: generatePrefacturaDraft,
  timbrar_prefactura: timbrarPrefactura,
  query_purchase_orders: queryPurchaseOrders,
  update_purchase_order: updatePurchaseOrder,
  send_document_whatsapp: sendDocumentWhatsapp,
};

export function getToolsForContact(role: string, allowedOverride: string[] = []): ToolDefinition[] {
  return Object.values(TOOLS)
    .filter(t => {
      if (allowedOverride.length > 0) return allowedOverride.includes(t.definition.name);
      return t.allowed_roles.includes(role as any);
    })
    .map(t => t.definition);
}

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const tool = TOOLS[name];
  if (!tool) return { success: false, error: `Tool desconocida: ${name}` };
  if (!tool.allowed_roles.includes(ctx.contact.role)) {
    return { success: false, error: `El rol ${ctx.contact.role} no puede ejecutar ${name}` };
  }
  try {
    return await tool.handler(input, ctx);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
