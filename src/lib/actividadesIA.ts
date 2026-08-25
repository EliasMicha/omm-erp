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
import { Rol, ROLES_GABINETE, ROL_CFG, EmpleadoRol } from './roles'
import { AREAS_TRABAJO, UrgenciaTarea } from './tareas'
import { ActividadPlantilla } from './plantillas'

export interface ContextoNegocio {
  areas: Array<{ specialty: string; label: string; roles: Array<{ rol: Rol; cuantos: number }> }>
  entregables: Array<{ id: string; clave: string; nombre: string; specialty?: string | null; descripcion?: string | null }>
  plantillas: Array<{ nombre: string; tipo: string; specialty?: string | null; actividades: number }>
}

export async function contextoDelNegocio(): Promise<ContextoNegocio> {
  const [{ data: emps }, { data: tipos }, { data: plts }] = await Promise.all([
    supabase.from('employees').select('id,name,area,puesto').eq('is_active', true),
    supabase.from('entregable_tipos').select('id,clave,nombre,specialty,descripcion').eq('activo', true).order('orden'),
    supabase.from('plantillas_encargo').select('nombre,tipo,specialty,plantilla_actividades(id)').eq('activo', true),
  ])
  const { rolDe } = await import('./roles')

  const areas = AREAS_TRABAJO.map(a => {
    const gente = ((emps as any[]) || []).filter(e => e.area === a.area).map(e => rolDe(e.puesto))
    return {
      specialty: a.specialty,
      label: a.label,
      roles: ROLES_GABINETE
        .map(r => ({ rol: r, cuantos: gente.filter(g => g === r).length }))
        .filter(r => r.cuantos > 0),
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
1. SOLO puedes usar los roles y los entregables que se te dan en el contexto. No inventes roles ("arquitecto", "supervisor") ni entregables que no estén en la lista. Si algo que hace falta no existe en el catálogo, no lo inventes: menciónalo en "advertencias".
2. NO asignes personas. Solo roles. No sabes quién está saturado.
3. Las actividades deben ser ACCIONES CONCRETAS con un entregable identificable, no fases abstractas. Mal: "Etapa de diseño". Bien: "Elaborar sembrado de iluminación de planta baja".
4. Respeta la cadena real de responsabilidad de un despacho de ingeniería: quien EJECUTA no es quien REVISA. Toda entrega técnica importante lleva su actividad de revisión a cargo del rol director, después de la ejecución y antes del compromiso con el cliente.
5. Los días son de calendario y realistas para un despacho pequeño (menos de 40 personas). No propongas planes de 30 actividades: entre 3 y 9 según el tamaño del encargo. Prefiere pocas actividades reales a muchas decorativas.
6. Usa "dias_antes_entrega" cuando exista fecha objetivo — el plan se cuenta hacia atrás desde el compromiso con el cliente. La última actividad (la entrega o su revisión final) va con dias_antes_entrega 0 o 1.
7. Español de México, directo, sin relleno. Los nombres de actividad empiezan con verbo en infinitivo.

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

function contextoTexto(c: ContextoNegocio, p: PeticionPlan): string {
  const areas = c.areas.map(a =>
    `- ${a.label} (specialty "${a.specialty}"): ${a.roles.map(r => `${r.cuantos} ${ROL_CFG[r.rol].plural.toLowerCase()}`).join(', ') || 'sin gente registrada'}`
  ).join('\n')

  const ents = c.entregables.map(e =>
    `- clave "${e.clave}" — ${e.nombre}${e.specialty ? ` [${e.specialty}]` : ' [cualquier área]'}${e.descripcion ? `: ${e.descripcion.slice(0, 160)}` : ''}`
  ).join('\n')

  const plts = c.plantillas.length
    ? c.plantillas.map(x => `- ${x.nombre} (${x.tipo}${x.specialty ? `, ${x.specialty}` : ''}) — ${x.actividades} actividades`).join('\n')
    : '(todavía no hay plantillas guardadas)'

  const areaLabel = AREAS_TRABAJO.find(a => a.specialty === p.specialty)?.label || p.specialty

  return `CONTEXTO DE OMM

Áreas y gente disponible:
${areas}

Entregables definidos con su instructivo (usa SOLO estas claves):
${ents}

Plantillas que ya existen:
${plts}

ENCARGO A PLANEAR
Tipo: ${p.tipo}
Área responsable: ${areaLabel} (specialty "${p.specialty}")
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

  // ── Filtro: solo lo que existe de verdad ──
  const porClave = new Map(ctx.entregables.map(e => [e.clave, e.id]))
  const descartadas: string[] = []
  const actividades: ActividadPlantilla[] = []

  for (const a of (Array.isArray(j.actividades) ? j.actividades : [])) {
    const nombre = String(a?.nombre || '').trim()
    if (!nombre) continue
    const rol = String(a?.rol || '').trim() as Rol
    if (!ROLES_GABINETE.includes(rol)) {
      descartadas.push(`${nombre} — rol "${a?.rol}" no existe en OMM`)
      continue
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
      specialty: null,
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
    const cand = empleados.filter(e => e.rol === a.rol && (!area || e.area === area))
    return cand.length !== 1 && !(a.rol === 'director' && cand.length > 0)
  }).length
}
