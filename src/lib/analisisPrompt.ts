// El prompt del análisis y la forma del veredicto. SIN imports a propósito:
// lo usan el navegador (src/lib/analisisCandidato.ts) y la función de servidor
// (api/gmail.ts?action=ingesta). Si cada lado tuviera su copia, dos candidatos
// analizados por caminos distintos dejarían de ser comparables y el orden por
// compatibilidad no significaría nada.

/** Lo que necesita el prompt de una vacante. Se declara aquí para no importar. */
export interface VacanteParaPrompt {
  titulo?: string | null
  puesto?: string | null
  area?: string | null
  ubicacion?: string | null
  tipo_jornada?: string | null
  descripcion?: string | null
  requisitos?: string | null
}

export const MODELO_ANALISIS = 'claude-sonnet-4-6'

export type Cumple = 'si' | 'parcial' | 'no' | 'no_dice'
export type Severidad = 'alta' | 'media' | 'baja'

export interface Analisis {
  compatibilidad: number            // 0-100, SOLO factores de trabajo
  veredicto: 'recomendado' | 'con_reservas' | 'no_cumple'
  resumen: string
  puesto_actual: string | null
  anos_experiencia: number | null
  /** Lo que dice saber, y si el CV lo respalda. */
  dice_saber: Array<{ habilidad: string; evidencia: 'respaldada' | 'mencionada' | 'sin_respaldo'; nota?: string }>
  /** Dónde ha trabajado y cuánto duró en cada lugar. */
  trayectoria: Array<{ empresa: string; puesto: string; desde: string | null; hasta: string | null; meses: number | null; nota?: string }>
  permanencia: { promedio_meses: number | null; empleos: number | null; patron: string } | null
  /** Cada requisito de la vacante, contestado. */
  requisitos: Array<{ requisito: string; cumple: Cumple; por_que: string }>
  fortalezas: string[]
  riesgos: string[]
  /** Lo que hay que mirar de cerca: huecos, saltos, incoherencias. */
  banderas: Array<{ senal: string; severidad: Severidad; por_que: string }>
  /** Para cerrar los huecos en la entrevista. */
  preguntas: string[]
  /** Datos de contexto. NO entran en la calificación — ver el prompt. */
  contexto: {
    edad: number | null
    ubicacion: string | null
    distancia: string | null
    riesgo_traslado: 'bajo' | 'medio' | 'alto' | 'no_se_sabe'
    nota_traslado: string | null
  }
  /** Lo que el CV no dice y hace falta para decidir. */
  falta_saber: string[]
}

export const VEREDICTO_CFG: Record<Analisis['veredicto'], { label: string; color: string }> = {
  recomendado:  { label: 'Recomendado',   color: '#10B981' },
  con_reservas: { label: 'Con reservas',  color: '#D9A441' },
  no_cumple:    { label: 'No cumple',     color: '#DC2626' },
}

export const colorCompat = (n?: number | null) =>
  n == null ? '#555' : n >= 75 ? '#10B981' : n >= 50 ? '#D9A441' : '#DC2626'

/**
 * El prompt. Vive aquí y solo aquí.
 *
 * Sobre la edad: Elias la pidió y se reporta, pero NO se califica con ella. El
 * artículo 133 de la Ley Federal del Trabajo prohíbe negar trabajo por edad,
 * y una lista ordenada por un número que descuenta por edad es exactamente la
 * evidencia que nadie quiere tener. Se separa: la edad es dato, no puntaje.
 */
export function promptDeAnalisis(c: {
  nombre: string; puesto_solicitado?: string | null; carta?: string | null; email?: string | null
}, v: VacanteParaPrompt | null): string {
  const vac = v
    ? `PUESTO: ${v.titulo || v.puesto || '—'}
ÁREA: ${v.area || '—'}
UBICACIÓN DEL TRABAJO: ${v.ubicacion || 'no especificada'}
JORNADA: ${v.tipo_jornada || 'no especificada'}
DESCRIPCIÓN:
${v.descripcion || '(sin descripción)'}
REQUISITOS:
${v.requisitos || '(sin requisitos capturados)'}`
    : `No hay vacante ligada. Evalúa contra el puesto al que dice postularse: "${c.puesto_solicitado || 'no especificado'}".`

  return `Eres el reclutador de OMM Technologies, un despacho mexicano de ingeniería eléctrica, instalaciones especiales e iluminación arquitectónica. Analiza a este candidato contra la vacante y devuelve un veredicto que se pueda defender.

── VACANTE ──
${vac}

── CANDIDATO ──
NOMBRE: ${c.nombre}
SE POSTULÓ A: ${c.puesto_solicitado || '—'}
${c.carta ? `CARTA DE PRESENTACIÓN:\n${c.carta.slice(0, 2000)}` : 'Sin carta de presentación.'}

El CV va adjunto a este mensaje. Léelo completo antes de contestar.

── CÓMO CALIFICAR ──
"compatibilidad" (0-100) mide SOLO el ajuste al trabajo:
  · qué tanto de lo que pide la vacante sabe hacer, con evidencia en el CV
  · profundidad y años en ese tipo de trabajo específico
  · señales de que termina lo que empieza (permanencia, crecimiento, responsabilidades)
  · qué tanto de lo que dice saber está respaldado por dónde estuvo y qué hizo

NUNCA metas en "compatibilidad": edad, sexo, estado civil, si tiene hijos,
apariencia, escuela de origen por prestigio, ni dónde vive. Reportas esos datos
en "contexto" porque el director los pidió, pero el número no los toca. Un
número que castiga por edad es discriminación laboral (LFT art. 133) y además
no predice desempeño.

El traslado va aparte, en "contexto.riesgo_traslado": un trayecto muy largo
predice ausentismo y renuncia temprana. Es información de logística que el
director pondera aparte — no la mezcles con el ajuste técnico.

── REGLAS ──
· No inventes. Si el CV no lo dice, usa null o "no_dice" y ponlo en "falta_saber".
· Distingue lo que DICE saber de lo que el CV RESPALDA. Un CV que dice "dominio
  de AutoCAD" sin un solo puesto de dibujante es "mencionada", no "respaldada".
· Calcula los meses reales de cada empleo. Si solo hay años, estima y dilo.
· Un hueco de más de 6 meses sin explicar es una bandera; no lo interpretes tú,
  ponlo como pregunta de entrevista.
· Trabajo de campo (electricistas, instaladores) NO se juzga con la vara de
  gabinete: ahí pesa el oficio, las obras hechas y las certificaciones, no los
  títulos.
· "distancia": estima el trayecto entre donde vive y la ubicación del trabajo en
  palabras ("~1 h en transporte público desde Ecatepec"). Si falta cualquiera de
  las dos, pon null y riesgo_traslado "no_se_sabe". No inventes kilómetros.
· Español de México, directo, sin adornos.

── FORMATO ──
Responde SOLO con este JSON, sin texto antes ni después:
{
  "compatibilidad": 0,
  "veredicto": "recomendado|con_reservas|no_cumple",
  "resumen": "2-3 renglones: quién es y por qué sí o por qué no",
  "puesto_actual": "su puesto más reciente o null",
  "anos_experiencia": 0,
  "dice_saber": [{"habilidad":"", "evidencia":"respaldada|mencionada|sin_respaldo", "nota":""}],
  "trayectoria": [{"empresa":"", "puesto":"", "desde":"AAAA-MM o AAAA", "hasta":"AAAA-MM, AAAA o actual", "meses":0, "nota":""}],
  "permanencia": {"promedio_meses":0, "empleos":0, "patron":"una línea: estable, brinca cada año, etc."},
  "requisitos": [{"requisito":"", "cumple":"si|parcial|no|no_dice", "por_que":""}],
  "fortalezas": [""],
  "riesgos": [""],
  "banderas": [{"senal":"", "severidad":"alta|media|baja", "por_que":""}],
  "preguntas": [""],
  "contexto": {
    "edad": null,
    "ubicacion": "colonia/municipio/estado o null",
    "distancia": "estimación en palabras o null",
    "riesgo_traslado": "bajo|medio|alto|no_se_sabe",
    "nota_traslado": "o null"
  },
  "falta_saber": [""]
}`
}

/** Normaliza lo que vuelve del modelo para que la pantalla nunca reviente. */
export function normalizarAnalisis(d: any): Analisis {
  const arr = (v: any) => (Array.isArray(v) ? v : [])
  const num = (v: any) => { const n = Number(v); return isFinite(n) ? n : null }
  const compat = Math.max(0, Math.min(100, Math.round(num(d?.compatibilidad) ?? 0)))
  const ver = ['recomendado', 'con_reservas', 'no_cumple'].includes(d?.veredicto)
    ? d.veredicto : (compat >= 75 ? 'recomendado' : compat >= 50 ? 'con_reservas' : 'no_cumple')
  const ctx = d?.contexto || {}
  return {
    compatibilidad: compat,
    veredicto: ver,
    resumen: String(d?.resumen || '').trim(),
    puesto_actual: d?.puesto_actual ? String(d.puesto_actual) : null,
    anos_experiencia: num(d?.anos_experiencia),
    dice_saber: arr(d?.dice_saber).map((x: any) => ({
      habilidad: String(x?.habilidad || ''),
      evidencia: ['respaldada', 'mencionada', 'sin_respaldo'].includes(x?.evidencia) ? x.evidencia : 'mencionada',
      nota: x?.nota ? String(x.nota) : undefined,
    })).filter((x: any) => x.habilidad),
    trayectoria: arr(d?.trayectoria).map((x: any) => ({
      empresa: String(x?.empresa || '—'), puesto: String(x?.puesto || '—'),
      desde: x?.desde ? String(x.desde) : null, hasta: x?.hasta ? String(x.hasta) : null,
      meses: num(x?.meses), nota: x?.nota ? String(x.nota) : undefined,
    })),
    permanencia: d?.permanencia ? {
      promedio_meses: num(d.permanencia.promedio_meses),
      empleos: num(d.permanencia.empleos),
      patron: String(d.permanencia.patron || ''),
    } : null,
    requisitos: arr(d?.requisitos).map((x: any) => ({
      requisito: String(x?.requisito || ''),
      cumple: ['si', 'parcial', 'no', 'no_dice'].includes(x?.cumple) ? x.cumple : 'no_dice',
      por_que: String(x?.por_que || ''),
    })).filter((x: any) => x.requisito),
    fortalezas: arr(d?.fortalezas).map((x: any) => String(x)).filter(Boolean),
    riesgos: arr(d?.riesgos).map((x: any) => String(x)).filter(Boolean),
    banderas: arr(d?.banderas).map((x: any) => ({
      senal: String(x?.senal || ''),
      severidad: ['alta', 'media', 'baja'].includes(x?.severidad) ? x.severidad : 'media',
      por_que: String(x?.por_que || ''),
    })).filter((x: any) => x.senal),
    preguntas: arr(d?.preguntas).map((x: any) => String(x)).filter(Boolean),
    contexto: {
      edad: num(ctx.edad),
      ubicacion: ctx.ubicacion ? String(ctx.ubicacion) : null,
      distancia: ctx.distancia ? String(ctx.distancia) : null,
      riesgo_traslado: ['bajo', 'medio', 'alto', 'no_se_sabe'].includes(ctx.riesgo_traslado) ? ctx.riesgo_traslado : 'no_se_sabe',
      nota_traslado: ctx.nota_traslado ? String(ctx.nota_traslado) : null,
    },
    falta_saber: arr(d?.falta_saber).map((x: any) => String(x)).filter(Boolean),
  }
}


// ── Extracción de datos del correo de postulación ───────────────────────────
// Vive aquí por lo mismo que el de análisis: lo usan el navegador y el cron.

export interface CorreoParaPrompt {
  asunto?: string | null
  de?: string | null
  texto?: string | null
}

export function promptDeExtraccion(correo: CorreoParaPrompt): string {
  return `Este es un correo de aviso de postulación de una bolsa de trabajo. Saca los datos del CANDIDATO.

ASUNTO: ${correo.asunto || ''}
DE: ${correo.de || ''}
CUERPO:
${String(correo.texto || '').slice(0, 6000)}

Responde SOLO con este JSON, sin texto alrededor:
{
  "nombre": "nombre completo del candidato",
  "puesto": "el puesto al que se postuló",
  "email_real": "su correo personal si aparece, o null",
  "email_relay": "el correo que termina en @indeedemail.com si aparece, o null",
  "telefono": "su teléfono si aparece en el cuerpo, solo dígitos, o null",
  "carta": "el mensaje o carta de presentación que escribió, o null"
}

Reglas:
- El nombre del candidato NO es el de la empresa ni el del puesto.
- Un correo que termina en @indeedemail.com es un alias, va en email_relay, NUNCA en email_real.
- Si un dato no está, pon null. No inventes.`
}
