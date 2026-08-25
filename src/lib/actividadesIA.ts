// ═══════════════════════════════════════════════════════════════════════════
// actividadesIA — la IA propone el plan; una persona lo firma.
//
// Lo que se le pide a la IA NO es "adivina qué hay que hacer". Es: con el
// contexto real del negocio —las áreas que existen, los roles que hay en cada
// una, los entregables que OMM ya tiene definidos con su instructivo, y las
// plantillas que ya se usan— convierte este encargo en una cadena de
// actividades con rol, orden, dependencia y días.
//
// Tres candados, en el prompt y en el código:
//
//   1. SOLO ROLES Y ENTREGABLES QUE EXISTEN. Si inventa "arquitecto" o un
//      entregable que no está en el catálogo, se descarta al parsear. Un plan
//      con un rol inexistente nace sin dueño y nadie lo reclama.
//
//   2. NO ASIGNA PERSONAS. La IA no sabe quién está saturado ni quién está de
//      vacaciones. Propone el rol; el director reparte.
//
//   3. EL PLAN NO SE APLICA SOLO. Se muestra, se edita y una persona lo crea.
//      Y lo que se corrigió se puede guardar como plantilla: así la IA se usa
//      una vez por tipo de encargo y de ahí en adelante manda el estándar de
//      la casa, no el criterio del modelo.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'
import { Rol, ROLES_GABINETE, ROL_CFG, EmpleadoRol, ALCANCE_ROL, TIPOS_ENCARGO, tieneRol } from './roles'
import { AREAS_TRABAJO, UrgenciaTarea } from './tareas'
import { ActividadPlantilla } from './plantillas'

export interface ContextoNegocio {
  areas: Array<{
    specialty: string
    label: string
    roles: Array<{ rol: Rol; cuantos: number }>
    /** Gente que cubre más de un rol, en texto legible. */
    dobles: string[]
  }>
  entregables: Array<{ id: string; clave: string; nombre: string; specialty?: string | null; descripcion?: string | null }>
  plantillas: Array<{ nombre: string; tipo: string; specialty?: string | null; actividades: number }>
}

export async function contextoDelNegocio(): Promise<ContextoNegocio> {
  const [{ data: emps }, { data: tipos }, { data: plts }] = await Promise.all([
    supabase.from('employees').select('id,name,area,puesto,roles_extra').eq('is_active', true),
    supabase.from('entregable_tipos').select('id,clave,nombre,specialty,descripcion').eq('activo', true).order('orden'),
    supabase.from('plantillas_encargo').select('nombre,tipo,specialty,plantilla_actividades(id)').eq('activo', true),
  ])
  const { rolesDe } = await import('./roles')

  const areas = AREAS_TRABAJO.map(a => {
    // Una persona puede traer varios sombreros: en un área chica el director
    // es además el ingeniero. Contar solo el rol principal hacía creer que el
    // área no tenía ingeniero y toda su ingeniería nacía sin dueño.
    const gente = ((emps as any[]) || []).filter(e => e.area === a.area).map(e => rolesDe(e))
    return {
      specialty: a.specialty,
      label: a.label,
      roles: ROLES_GABINETE
        .map(r => ({ rol: r, cuantos: gente.filter(rs => rs.includes(r)).length }))
        .filter(r => r.cuantos > 0),
      dobles: ((emps as any[]) || []).filter(e => e.area === a.area && rolesDe(e).length > 1)
        .map(e => `${e.name}: ${rolesDe(e).map(r => ROL_CFG[r].label).join(' + ')}`),
    }
  })

  return {
    areas,
    entregables: ((tipos as any[]) || []) as any,
    plantillas: ((plts as any[]) || []).map(p => ({
      nombre: p.nombre, tipo: p.tipo, specialty: p.specialty,
      actividades: (p.plantilla_actividades || []).length,
    })),
  }
}

export interface PeticionPlan {
  /** El scope, el levantamiento pegado, o la descripción de la actividad. */
  texto: string
  /** proyecto | cotizacion | levantamiento | licitacion | mejora | interna | repetida */
  tipo: string
  specialty: string
  fechaObjetivo?: string | null
  /** Nombre del proyecto o cliente, si lo hay. */
  titulo?: string | null
  /** Documentos que YA tenemos. Cambian el plan: si el arquitectónico ya
   *  llegó, no hay que pedirlo; si no está, la primera actividad es
   *  conseguirlo. */
  documentos?: string[]
}

export interface PlanPropuesto {
  nombre: string
  resumen: string
  actividades: ActividadPlantilla[]
  advertencias: string[]
  /** Lo que la IA propuso y se descartó por no existir. Se muestra, no se esconde. */
  descartadas: string[]
}

const SISTEMA = `Eres el jefe de planeación de OMM Technologies, una empresa mexicana de ingeniería eléctrica, iluminación e instalaciones especiales (audio, redes, CCTV, control de acceso, control de iluminación, detección de humo, BMS). Conviertes un encargo en una cadena de actividades ejecutables.

REGLAS ABSOLUTAS:
1. PLANEAS PARA UNA SOLA ÁREA. El contexto te dice cuál. Aunque el encargo mencione otras especialidades —eléctrico, iluminación, especiales—, tú NO propones actividades de esas áreas: cada una recibe su propio plan por separado y duplicarlas crea trabajo fantasma que alguien tiene que cerrar. Si el encargo pide cosas de otra área, no las planees: menciónalo en "advertencias".
2. RESPETA EL ALCANCE DE LO QUE SE PIDIÓ. El contexto te dice si es solo una cotización, un proyecto ejecutivo, un levantamiento o una licitación. Una cotización NO lleva planos ejecutivos ni memorias: se cuantifica sobre lo que el cliente mandó y se cotiza. Inflar el plan no es inofensivo — son actividades reales que ensucian el cumplimiento de todos.
3. CADA ROL HACE LO SUYO. El contexto trae el alcance exacto de cada rol en OMM, incluido lo que NO hace. Nunca le asignes a un rol algo de su lista de "no hace": un dibujante no cotiza, un director no dibuja, y la revisión final SIEMPRE es del director.
4. SOLO puedes usar los roles y los entregables que se te dan en el contexto. No inventes roles ("arquitecto", "supervisor") ni entregables fuera de la lista. Si hace falta algo que no existe en el catálogo, no lo inventes: dilo en "advertencias".
5. NO asignes personas. Solo roles. No sabes quién está saturado.
6. Las actividades deben ser ACCIONES CONCRETAS con un entregable identificable, no fases abstractas. Mal: "Etapa de diseño". Bien: "Elaborar sembrado de iluminación de planta baja".
7. Quien EJECUTA no es quien REVISA. Toda entrega importante lleva su actividad de revisión a cargo del rol director, después de la ejecución y antes del compromiso con el cliente.
8. Los días son de calendario y realistas para un despacho pequeño. Respeta el máximo de actividades que te da el contexto según el tipo de encargo. Prefiere pocas actividades reales a muchas decorativas.
9. Usa "dias_antes_entrega" cuando exista fecha objetivo — el plan se cuenta hacia atrás desde el compromiso con el cliente. La última actividad (la entrega o su revisión final) va con dias_antes_entrega 0 o 1.
10. Español de México, directo, sin relleno. Los nombres de actividad empiezan con verbo en infinitivo.

Devuelve EXCLUSIVAMENTE un JSON (sin markdown, sin backticks, sin texto antes ni después) con esta forma exacta:
{
  "nombre": "nombre corto de la plantilla, ej. 'Proyecto eléctrico residencial'",
  "resumen": "una frase de qué cubre este plan",
  "actividades": [
    {
      "orden": 0,
      "nombre": "verbo en infinitivo + objeto",
      "descripcion": "qué se espera exactamente, 1-2 líneas",
      "rol": "director|ingeniero|dibujante|disenador|admin",
      "entregable_clave": "clave del catálogo o null si no aplica",
      "urgencia": "urgente|alta|normal|baja",
      "dias_desde_inicio": número o null,
      "dias_antes_entrega": número o null,
      "depende_de": orden de la actividad previa o null,
      "obligatoria": true|false
    }
  ],
  "advertencias": ["cosas que faltan por definir, supuestos que tomaste, o entregables que no existen en el catálogo"]
}`

/** Los entregables que esta área PUEDE producir: los suyos y los transversales. */
export function entregablesDe(c: ContextoNegocio, specialty: string) {
  return c.entregables.filter(e => !e.specialty || e.specialty === specialty)
}

function contextoTexto(c: ContextoNegocio, p: PeticionPlan): string {
  const areaLabel = AREAS_TRABAJO.find(a => a.specialty === p.specialty)?.label || p.specialty
  const miArea = c.areas.find(a => a.specialty === p.specialty)

  // Solo los roles que EXISTEN en esta área, con su alcance real. Si al área
  // no le queda ningún rol, el plan no puede repartirse y hay que decirlo.
  // Si una misma persona cubre dos roles, se dice: cambia quién puede revisar
  // a quién, y el plan tiene que salir sabiéndolo.
  const dobles = (miArea?.dobles || [])
  const rolesArea = (miArea?.roles || []).map(r => {
    const al = ALCANCE_ROL[r.rol]
    return `- ${ROL_CFG[r.rol].label} (rol "${r.rol}", ${r.cuantos} persona(s)): ${al.resumen}\n` +
      `    Hace: ${al.hace.join('; ')}\n` +
      `    NO hace: ${al.noHace.join('; ')}`
  }).join('\n')

  // Solo los entregables que ESTA área produce. Si no ve los de otras áreas,
  // no puede proponerlos — que es el punto.
  const ents = entregablesDe(c, p.specialty).map(e =>
    `- clave "${e.clave}" — ${e.nombre}${e.specialty ? '' : ' [transversal]'}${e.descripcion ? `: ${e.descripcion.slice(0, 160)}` : ''}`
  ).join('\n')

  const plts = c.plantillas.filter(x => !x.specialty || x.specialty === p.specialty)
  const plantillasTxt = plts.length
    ? plts.map(x => `- ${x.nombre} (${x.tipo}) — ${x.actividades} actividades`).join('\n')
    : '(todavía no hay plantillas guardadas para esta área)'

  const tipo = TIPOS_ENCARGO.find(t => t.key === p.tipo)

  return `CONTEXTO DE OMM

ÁREA PARA LA QUE PLANEAS: ${areaLabel} (specialty "${p.specialty}")
Otras áreas de la empresa existen y reciben SU PROPIO plan por separado. No planees para ellas.

Roles que hay en esta área, y de qué responde cada uno:
${rolesArea || '(esta área no tiene gente de gabinete registrada — dilo en advertencias)'}
${dobles.length ? `\nOJO: en esta área hay gente que cubre VARIOS roles a la vez (${dobles.join('; ')}). El área todavía es chica. Planea igual —cada actividad a su rol— pero si el mismo rol ejecuta y revisa, dilo en "advertencias": esa revisión no es independiente.` : ''}

Entregables que ESTA área produce (usa SOLO estas claves):
${ents}

Plantillas que ya existen para esta área:
${plantillasTxt}

ENCARGO A PLANEAR
Qué se está pidiendo: ${tipo ? `${tipo.label} — ${tipo.descripcion}` : p.tipo}
${tipo ? `Este encargo TERMINA EN: ${tipo.termina_en}. Máximo ${tipo.maxActividades} actividades.` : ''}
${p.titulo ? `Proyecto/cliente: ${p.titulo}` : ''}
${p.fechaObjetivo ? `Fecha comprometida con el cliente: ${p.fechaObjetivo} (hoy es ${new Date().toISOString().slice(0, 10)})` : 'Sin fecha comprometida: usa dias_desde_inicio.'}
${p.documentos && p.documentos.length
  ? `Documentos que YA tenemos:\n${p.documentos.map(d => `- ${d}`).join('\n')}\nNo propongas actividades para conseguir lo que ya está en esta lista.`
  : 'No tenemos ningún documento todavía: si el plan necesita información base del cliente, la primera actividad es conseguirla.'}

Lo que se pidió, tal como llegó:
"""
${p.texto.slice(0, 6000)}
"""`
}

const URGENCIAS: UrgenciaTarea[] = ['urgente', 'alta', 'normal', 'baja']

export async function sugerirPlan(p: PeticionPlan): Promise<{ plan?: PlanPropuesto; error?: string }> {
  if (!p.texto.trim()) return { error: 'Pega el levantamiento, el scope o la descripción de la actividad.' }
  if (!p.specialty) return { error: 'Falta el área responsable.' }

  const ctx = await contextoDelNegocio()

  let res: Response
  try {
    res = await fetch('/api/anthropic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system: SISTEMA,
        messages: [{ role: 'user', content: contextoTexto(ctx, p) }],
      }),
    })
  } catch (e: any) {
    return { error: 'No se pudo contactar a la IA: ' + (e?.message || e) }
  }
  if (!res.ok) return { error: 'La IA respondió con error: ' + (await res.text()).slice(0, 200) }

  const data = await res.json()
  const texto = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  const m = texto.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)
  if (!m) return { error: 'La IA no devolvió un plan legible.' }

  let j: any
  try { j = JSON.parse(m[0]) } catch { return { error: 'La IA devolvió un JSON inválido.' } }

  // ── Filtro: solo lo que existe de verdad Y es de esta área ──
  // El catálogo que se le mandó ya venía acotado; esto es el segundo candado,
  // por si el modelo recuerda una clave de otra área de su propio contexto.
  const porClave = new Map(entregablesDe(ctx, p.specialty).map(e => [e.clave, e.id]))
  const descartadas: string[] = []
  const actividades: ActividadPlantilla[] = []
  const rolesDelArea = new Set((ctx.areas.find(a => a.specialty === p.specialty)?.roles || []).map(r => r.rol))

  for (const a of (Array.isArray(j.actividades) ? j.actividades : [])) {
    const nombre = String(a?.nombre || '').trim()
    if (!nombre) continue
    const rol = String(a?.rol || '').trim() as Rol
    if (!ROLES_GABINETE.includes(rol)) {
      descartadas.push(`${nombre} — rol "${a?.rol}" no existe en OMM`)
      continue
    }
    // Un rol que no existe en esta área nace huérfano y nadie lo reclama.
    // Se conserva la actividad pero se avisa, porque a veces es legítimo
    // (el director revisa aunque el área no tenga más gente).
    if (!rolesDelArea.has(rol)) {
      descartadas.push(`${nombre} — no hay ${ROL_CFG[rol].label.toLowerCase()} en esta área: la actividad nace sin dueño`)
    }
    let entregableId: string | null = null
    if (a?.entregable_clave) {
      const id = porClave.get(String(a.entregable_clave))
      if (id) entregableId = id
      else descartadas.push(`${nombre} — entregable "${a.entregable_clave}" no está en el catálogo (la actividad se conserva, sin entregable)`)
    }
    const urg = URGENCIAS.includes(a?.urgencia) ? a.urgencia : 'normal'
    const nOrNull = (v: any) => (v === null || v === undefined || isNaN(Number(v)) ? null : Math.abs(Math.round(Number(v))))

    actividades.push({
      orden: actividades.length,
      nombre: nombre.slice(0, 180),
      descripcion: a?.descripcion ? String(a.descripcion).slice(0, 600) : null,
      rol,
      // El área la manda quien pidió el plan, nunca el modelo: así una
      // actividad no puede acabar colgada de otra especialidad.
      specialty: p.specialty,
      tipo_entregable_id: entregableId,
      urgencia: urg,
      dias_desde_inicio: nOrNull(a?.dias_desde_inicio),
      dias_antes_entrega: p.fechaObjetivo ? nOrNull(a?.dias_antes_entrega) : null,
      depende_de: a?.depende_de === null || a?.depende_de === undefined ? null : Number(a.depende_de),
      obligatoria: a?.obligatoria !== false,
    })
  }

  if (actividades.length === 0) return { error: 'La IA no propuso ninguna actividad utilizable. Revisa el texto del encargo.' }

  // Una actividad no puede depender de sí misma ni de una posterior: eso sería
  // una cadena que nunca arranca.
  for (const a of actividades) {
    if (a.depende_de != null && a.depende_de >= a.orden) a.depende_de = null
  }

  return {
    plan: {
      nombre: String(j.nombre || 'Plan propuesto').slice(0, 120),
      resumen: String(j.resumen || '').slice(0, 400),
      actividades,
      advertencias: Array.isArray(j.advertencias) ? j.advertencias.map((x: any) => String(x)).slice(0, 8) : [],
      descartadas,
    },
  }
}

/** Cuántas actividades del plan quedarían sin dueño con la gente que hay hoy. */
export function sinDuenoDe(acts: ActividadPlantilla[], empleados: EmpleadoRol[], specialty: string): number {
  const area = AREAS_TRABAJO.find(a => a.specialty === specialty)?.area
  return acts.filter(a => {
    const cand = empleados.filter(e => tieneRol(e, a.rol) && (!area || e.area === area))
    return cand.length !== 1 && !(a.rol === 'director' && cand.length > 0)
  }).length
}
