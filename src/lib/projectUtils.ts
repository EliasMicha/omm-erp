/**
 * Auto-create a project from a quotation when it moves to 'contrato' stage.
 * Replicates the same phase/task template instantiation logic from NewProjectModal.
 */
import { supabase } from './supabase'

interface PhaseTemplate {
  id: string
  specialty: string
  name: string
  order_index: number
  is_post_sale: boolean
}

interface TaskTemplate {
  id: string
  specialty: string
  name: string
  start_phase_order: number
  end_phase_order: number
  expands_by_system: boolean
  default_subtasks: string[]
  order_index: number
}

/**
 * Maps tipoProyecto (from quotation notes) to the project specialty used for templates.
 */
const TIPO_TO_SPECIALTY: Record<string, string> = {
  especiales: 'esp',
  electrica: 'elec',
  iluminacion: 'ilum',
}

/**
 * Auto-creates a project + phases + tasks from a 'proy' quotation.
 * Called when quotation stage changes to 'contrato'.
 *
 * @returns The created project id, or null if creation failed.
 */
export async function autoCreateProjectFromQuotation(quotationId: string): Promise<string | null> {
  try {
    // 1. Load the quotation
    const { data: cot, error: cotErr } = await supabase
      .from('quotations')
      .select('*')
      .eq('id', quotationId)
      .single()
    if (cotErr || !cot) {
      console.error('autoCreateProject: could not load quotation', cotErr)
      return null
    }

    // Don't create if quotation already linked to a project
    if (cot.project_id) {
      console.log('autoCreateProject: quotation already linked to project', cot.project_id)
      return cot.project_id
    }

    // Parse notes
    let meta: any = {}
    try { meta = JSON.parse(cot.notes || '{}') } catch {}

    const tipoProyecto = meta.tipoProyecto || 'especiales'
    const specialty = TIPO_TO_SPECIALTY[tipoProyecto] || 'esp'
    const leadId = meta.lead_id || null

    // 2. Detect systems from quotation items (for ESP expand_by_system)
    let detectedSystems: string[] = []
    if (specialty === 'esp') {
      const { data: qItems } = await supabase
        .from('quotation_items')
        .select('system')
        .eq('quotation_id', quotationId)
      if (qItems) {
        detectedSystems = [...new Set(qItems.map((i: any) => i.system).filter(Boolean))]
      }
    }

    // 3. Create the project
    const { data: proj, error: projErr } = await supabase.from('projects').insert({
      name: cot.name || 'Proyecto sin nombre',
      client_name: cot.client_name || '',
      specialty,
      lines: [specialty],
      status: 'activo',
      contract_value: cot.total || 0,
      advance_pct: 0,
      cotizacion_id: quotationId,
      lead_id: leadId,
    }).select().single()

    if (projErr || !proj) {
      console.error('autoCreateProject: could not create project', projErr)
      return null
    }

    // 4. Link quotation back to project
    await supabase.from('quotations').update({ project_id: proj.id }).eq('id', quotationId)

    // 5. Load phase templates
    const { data: phaseTemplates } = await supabase
      .from('project_phase_templates')
      .select('*')
      .in('specialty', [specialty, 'postventa'])
      .order('order_index')

    if (!phaseTemplates || phaseTemplates.length === 0) {
      console.warn('autoCreateProject: no phase templates for', specialty)
      return proj.id
    }

    // 6. Insert project phases
    const phaseInserts = (phaseTemplates as PhaseTemplate[]).map(pt => ({
      project_id: proj.id,
      template_id: pt.id,
      name: pt.name,
      order_index: pt.order_index,
      is_post_sale: pt.is_post_sale,
      is_unlocked: !pt.is_post_sale,
      status: 'pendiente' as const,
    }))

    const { data: insertedPhases, error: phErr } = await supabase
      .from('project_phases').insert(phaseInserts).select()

    if (phErr || !insertedPhases) {
      console.error('autoCreateProject: could not create phases', phErr)
      return proj.id
    }

    function phaseByOrder(orderIndex: number) {
      return (insertedPhases || []).find((p: any) => p.order_index === orderIndex)
    }

    // 7. Load task templates
    const { data: taskTemplatesData } = await supabase
      .from('project_task_templates')
      .select('*')
      .in('specialty', [specialty, 'postventa'])
      .order('order_index')

    const taskTemplates = (taskTemplatesData || []) as TaskTemplate[]

    // 8. Instantiate tasks across phase ranges
    const taskInserts: any[] = []
    for (const tt of taskTemplates) {
      for (let ord = tt.start_phase_order; ord <= tt.end_phase_order; ord++) {
        const ph = phaseByOrder(ord)
        if (!ph) continue
        taskInserts.push({
          project_id: proj.id,
          phase_id: (ph as any).id,
          template_id: tt.id,
          name: tt.name,
          order_index: tt.order_index,
          status: 'pendiente',
          progress: 0,
          priority: 0,
        })
      }
    }

    let insertedTasks: any[] = []
    if (taskInserts.length > 0) {
      const { data: tdata, error: tErr } = await supabase
        .from('project_tasks').insert(taskInserts).select()
      if (tErr) {
        console.error('autoCreateProject: could not create tasks', tErr)
        return proj.id
      }
      insertedTasks = tdata || []
    }

    // 9. Instantiate subtasks (with system expansion for ESP)
    const subtaskInserts: any[] = []
    for (const task of insertedTasks) {
      const tt = taskTemplates.find(t => t.id === task.template_id)
      if (!tt || !tt.default_subtasks || tt.default_subtasks.length === 0) continue

      if (tt.expands_by_system && detectedSystems.length > 0) {
        let idx = 0
        for (const sys of detectedSystems) {
          for (const subText of tt.default_subtasks) {
            subtaskInserts.push({
              task_id: task.id,
              text: subText,
              completed: false,
              order_index: idx++,
              system: sys,
            })
          }
        }
      } else {
        tt.default_subtasks.forEach((text: string, idx: number) => {
          subtaskInserts.push({
            task_id: task.id,
            text,
            completed: false,
            order_index: idx,
            system: null,
          })
        })
      }
    }

    if (subtaskInserts.length > 0) {
      const batchSize = 500
      for (let i = 0; i < subtaskInserts.length; i += batchSize) {
        const batch = subtaskInserts.slice(i, i + batchSize)
        await supabase.from('project_task_subtasks').insert(batch)
      }
    }

    return proj.id
  } catch (err) {
    console.error('autoCreateProject: unexpected error', err)
    return null
  }
}
