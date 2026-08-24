// ═══════════════════════════════════════════════════════════════════════════
// scopeIA — redactar el alcance de una propuesta a partir de notas sueltas.
//
// Cómo se escribe un scope en la vida real: alguien teclea "8800m2 oficinas,
// niveles b2 a n5, no incluye estacionamiento, planos rev B". Eso está bien
// como nota y mal como documento que el cliente firma.
//
// Lo que hace la IA aquí es SOLO redactar: ordena, completa la sintaxis y usa
// el lenguaje de una propuesta de ingeniería. Lo que NO hace, y está escrito
// en el prompt tres veces, es inventar compromisos. Un alcance con una entrega
// que nadie prometió es peor que un alcance mal redactado: uno se ve
// descuidado, el otro se cobra.
//
// Por eso el resultado nunca se aplica solo. Se muestra al lado de lo que
// había y una persona decide.
// ═══════════════════════════════════════════════════════════════════════════

export interface ScopeTexto {
  alcance: string
  incluye: string[]
  noIncluye: string[]
  supuestos: string[]
}

export interface ContextoScope {
  tipoProyecto: string          // 'Ingeniería Eléctrica', etc.
  proyecto?: string
  cliente?: string
  moneda?: string
  /** Sistemas incluidos con su superficie y precio. Es el hecho duro. */
  sistemas: Array<{ nombre: string; m2: number; descripcion?: string; entregables?: string[] }>
}

const SISTEMA = `Eres el redactor de propuestas de OMM Technologies, una empresa mexicana de ingeniería eléctrica, iluminación e instalaciones especiales. Escribes el ALCANCE de una propuesta técnica.

REGLAS ABSOLUTAS:
1. NO INVENTES COMPROMISOS. Solo puedes redactar con: (a) lo que el usuario escribió en sus notas, y (b) los sistemas cotizados que se te dan. Si algo no está en ninguna de las dos fuentes, no existe. Nunca agregues entregables, visitas, revisiones, plazos, garantías ni cantidades que no te hayan dado.
2. Si una nota del usuario es ambigua, redáctala conservadora, no generosa. Ante la duda, lo que se promete es MENOS, no más.
3. Los supuestos SÍ los puedes proponer aunque el usuario no los haya escrito, porque protegen a quien cotiza — pero solo supuestos genéricos y verificables (versión de planos sobre la que se cotizó, superficie considerada, que el cliente entrega la información base). Nunca un supuesto que suene a compromiso.
4. Español de México, tono profesional y directo. Sin adjetivos de venta ("excelente", "de la más alta calidad"), sin relleno. Un ingeniero leyendo esto debe saber exactamente qué recibe.
5. Devuelve SOLO JSON válido, sin markdown ni texto alrededor.`

export function promptScope(actual: ScopeTexto, ctx: ContextoScope): string {
  const sistemas = ctx.sistemas.length
    ? ctx.sistemas.map(s => `- ${s.nombre}${s.m2 ? ` (${s.m2.toLocaleString('es-MX')} m²)` : ''}${s.descripcion ? ` — ${s.descripcion}` : ''}${s.entregables?.length ? `\n    entregables: ${s.entregables.join('; ')}` : ''}`).join('\n')
    : '(sin sistemas capturados)'

  const notas = [
    actual.alcance?.trim() ? `ALCANCE (notas del usuario):\n${actual.alcance.trim()}` : '',
    actual.incluye?.filter(Boolean).length ? `SÍ INCLUYE (notas):\n${actual.incluye.filter(Boolean).map(x => '- ' + x).join('\n')}` : '',
    actual.noIncluye?.filter(Boolean).length ? `NO INCLUYE (notas):\n${actual.noIncluye.filter(Boolean).map(x => '- ' + x).join('\n')}` : '',
    actual.supuestos?.filter(Boolean).length ? `SUPUESTOS (notas):\n${actual.supuestos.filter(Boolean).map(x => '- ' + x).join('\n')}` : '',
  ].filter(Boolean).join('\n\n') || '(el usuario no ha escrito nada todavía)'

  return `Redacta el alcance de esta propuesta.

TIPO DE PROPUESTA: ${ctx.tipoProyecto}
${ctx.proyecto ? `PROYECTO: ${ctx.proyecto}\n` : ''}${ctx.cliente ? `CLIENTE: ${ctx.cliente}\n` : ''}
SISTEMAS COTIZADOS (esto es lo que se está vendiendo — es tu fuente de hechos):
${sistemas}

NOTAS DEL USUARIO:
${notas}

Qué tienes que devolver:
- "alcance": uno o dos párrafos. Qué se va a desarrollar, para qué inmueble y sobre qué superficie. Si el usuario escribió notas, respétalas: redáctalas bien, no las sustituyas por generalidades. Si no escribió nada, constrúyelo ÚNICAMENTE a partir de los sistemas cotizados.
- "incluye": lo específico de este proyecto que conviene dejar por escrito. Máximo 8 puntos. Si el usuario no escribió nada y los sistemas no dan para más, devuelve pocos o ninguno — no rellenes.
- "noIncluye": exclusiones específicas de este proyecto. NO repitas las exclusiones estándar que ya trae toda propuesta de OMM (suministro de material, instalación, canalización, trámites ante CFE, pruebas, puesta en marcha, supervisión de obra). Solo lo particular de este caso.
- "supuestos": sobre qué información se cotizó. Aquí sí propón los genéricos útiles si el usuario no los puso: versión y fecha de los planos base, superficie considerada, información que entrega el cliente.
- "notaRevision": una frase corta si detectaste algo que el usuario debería confirmar antes de mandar la propuesta (una nota ambigua, un dato que falta). Cadena vacía si no hay nada.

Formato exacto:
{
  "alcance": "…",
  "incluye": ["…"],
  "noIncluye": ["…"],
  "supuestos": ["…"],
  "notaRevision": ""
}`
}

export interface ResultadoScope extends ScopeTexto {
  notaRevision?: string
}

/** Llama al proxy del ERP. La llave vive en el servidor, nunca en el bundle. */
export async function redactarScope(actual: ScopeTexto, ctx: ContextoScope): Promise<ResultadoScope> {
  const res = await fetch('/api/anthropic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: SISTEMA,
      messages: [{ role: 'user', content: promptScope(actual, ctx) }],
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'Error de la IA')
  const txt = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  const limpio = String(txt || '').replace(/```json|```/g, '').trim()
  const ini = limpio.indexOf('{')
  const fin = limpio.lastIndexOf('}')
  if (ini === -1 || fin === -1) throw new Error('La IA no devolvió un scope legible.')
  const p = JSON.parse(limpio.slice(ini, fin + 1))
  const lista = (v: any): string[] => Array.isArray(v) ? v.map((x: any) => String(x).trim()).filter(Boolean) : []
  return {
    alcance: String(p.alcance || '').trim(),
    incluye: lista(p.incluye),
    noIncluye: lista(p.noIncluye),
    supuestos: lista(p.supuestos),
    notaRevision: String(p.notaRevision || '').trim(),
  }
}
