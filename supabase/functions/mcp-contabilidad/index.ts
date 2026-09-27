// ═══════════════════════════════════════════════════════════════════════════
//  mcp-contabilidad — servidor MCP (Streamable HTTP) del modulo de Contabilidad.
//
//  Lo consume Grok Bot como "custom MCP server". Expone SEIS tools de negocio
//  —ni una mas— y ninguna recibe SQL: el modelo pide resultados, no consultas.
//
//  Por que un MCP por modulo y no uno con todo: un bot que ve 80 tools escoge
//  mal. El de Contabilidad no tiene por que enterarse de que existe el CRM.
//
//  Auth: Authorization: Bearer <GROK_MCP_CONTABILIDAD_TOKEN>, comparado en tiempo
//  constante. El token NUNCA por query string: los parametros de URL se
//  quedan escritos en logs, historiales y proxies.
//
//  Identidad de escritura: el token autentica al BOT, no a una persona. Todo
//  lo que escribe queda a nombre de una cuenta de servicio del ERP
//  (MCP_CONTA_ACTOR_EMAIL, por defecto grok@omniious.com), y cada llamada se
//  guarda en agent_actions_log con su input, su salida y lo que toco.
//
//  Secretos (Dashboard → Edge Functions → Secrets, los pone un humano):
//    GROK_MCP_CONTABILIDAD_TOKEN    secreto largo y aleatorio
//    MCP_CONTA_ACTOR_EMAIL   opcional, default grok@omniious.com
//    SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   los inyecta Supabase
//
//  verify_jwt: OFF para esta function. Quien llama es un bot, no un usuario
//  con sesion; el porton es el Bearer de servicio.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ALCANCE_CONTA, CONTA_TOOLS, claseDeTool, contaToolDefinitions, executeContaTool, type ContaActor } from './conta_tools.ts'
import { acotarSupabase } from './acotar.ts'
import { unaSolaVez } from './idempotencia.ts'

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'omm-contabilidad', version: '1.0.0' }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-session-id',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

/** Comparacion en tiempo constante: un == normal filtra el token caracter por caracter. */
function tokenValido(recibido: string, esperado: string): boolean {
  if (!esperado || recibido.length !== esperado.length) return false
  let diff = 0
  for (let i = 0; i < esperado.length; i++) diff |= recibido.charCodeAt(i) ^ esperado.charCodeAt(i)
  return diff === 0
}

function rpcError(id: unknown, code: number, message: string) {
  return json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Streamable HTTP admite GET para abrir un stream SSE, pero es opcional: este
  // server contesta en el mismo POST, asi que no hay stream que abrir.
  //
  // El 405 sale en TEXTO PLANO y sin cuerpo JSON a proposito. Un 405 con un
  // cuerpo que parezca JSON-RPC algunos clientes lo emparejan con la peticion
  // que tienen en vuelo —normalmente el tools/list— y se quedan creyendo que
  // fallo. Sin cuerpo que parsear no hay con que confundirse. El Allow le dice
  // al cliente por donde si.
  if (req.method !== 'POST') {
    return new Response(null, {
      status: 405,
      headers: { ...CORS, Allow: 'POST, OPTIONS' },
    })
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const esperado = Deno.env.get('GROK_MCP_CONTABILIDAD_TOKEN') || ''
  if (!esperado) {
    console.error('[mcp-contabilidad] falta el secreto GROK_MCP_CONTABILIDAD_TOKEN')
    return json({ error: 'Servidor sin configurar' }, 500)
  }
  const auth = req.headers.get('authorization') || ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!bearer || !tokenValido(bearer, esperado)) {
    return json({ error: 'No autorizado' }, 401)
  }
  // El token por URL se ignora a proposito, aunque venga: aceptar los dos
  // caminos vuelve normal el inseguro.

  let mensaje: any
  try {
    mensaje = await req.json()
  } catch {
    return rpcError(null, -32700, 'JSON invalido')
  }

  // Un cliente puede mandar un lote. Se contesta lo que lleva id.
  const mensajes = Array.isArray(mensaje) ? mensaje : [mensaje]
  const respuestas: unknown[] = []

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  for (const m of mensajes) {
    const { id, method, params } = m || {}
    const esNotificacion = id === undefined || id === null

    if (method === 'initialize') {
      respuestas.push({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'Contabilidad y cobranza de OMM Technologies. Este servidor casi solo consulta: no emite, ' +
            'no timbra, no cancela, no registra pagos y no concilia. Timbrar es irreversible y conciliar ' +
            'toca tres tablas a la vez, asi que eso lo hace una persona. ' +
            'Los montos van en su moneda nativa y el tipo de cambio se reporta aparte: si das un total en ' +
            'pesos, di siempre a que TC lo convertiste, porque si no nadie puede cotejarlo. ' +
            'Solo cuentan los contratos vigentes; las cotizaciones que no son contrato no son cobranza. ' +
            'La unica escritura es el seguimiento de cobranza (fecha pronosticada y nota), que no mueve dinero. ' +
            'Corre primero con dry_run: true y manda idempotency_key en las escrituras reales.',
        },
      })
      continue
    }

    if (method === 'notifications/initialized' || esNotificacion) continue

    if (method === 'ping') {
      respuestas.push({ jsonrpc: '2.0', id, result: {} })
      continue
    }

    if (method === 'tools/list') {
      respuestas.push({
        jsonrpc: '2.0', id,
        result: {
          tools: contaToolDefinitions().map(d => ({
            name: d.name, description: d.description, inputSchema: d.input_schema,
          })),
        },
      })
      continue
    }

    if (method === 'tools/call') {
      const nombre = params?.name
      const args = params?.arguments ?? {}
      if (!nombre || !CONTA_TOOLS[nombre]) {
        respuestas.push({ jsonrpc: '2.0', id, error: { code: -32602, message: `Tool desconocida: ${nombre}` } })
        continue
      }

      // Actor: la cuenta de servicio del ERP a cuyo nombre escribe el bot.
      const actorEmail = (Deno.env.get('MCP_CONTA_ACTOR_EMAIL') || 'grok_contabilidad@omniious.com').toLowerCase()
      const { data: cuenta } = await supabase.from('app_users')
        .select('id, nombre, email, employee_id, permission_area, nivel, activo')
        .eq('email', actorEmail).maybeSingle()

      if (!cuenta || cuenta.activo === false) {
        respuestas.push({
          jsonrpc: '2.0', id,
          error: { code: -32000, message: `La cuenta de servicio ${actorEmail} no existe o esta inactiva en el ERP.` },
        })
        continue
      }

      const actor: ContaActor = {
        app_user_id: cuenta.id, nombre: cuenta.nombre, email: cuenta.email,
        employee_id: cuenta.employee_id, permission_area: cuenta.permission_area, nivel: cuenta.nivel,
      }

      // Las tools ven un cliente acotado a las tablas de Contabilidad: una tool que
      // por error pidiera design_rules o catalog_products revienta aqui, no
      // en produccion. El limite es del servidor, no del prompt del bot.
      const acotado = acotarSupabase(supabase, ALCANCE_CONTA)

      // Idempotencia solo para las escrituras reales. Una consulta no la
      // necesita y un dry_run no escribe nada, asi que ninguno quema clave.
      const clase = claseDeTool(nombre)
      const claveIdem = clase === 'operacion' && args?.dry_run !== true
        ? (typeof args?.idempotency_key === 'string' ? args.idempotency_key : null)
        : null

      const t0 = Date.now()
      // La tabla de idempotencia es infraestructura, no datos del modulo: va
      // con el cliente sin acotar.
      const envuelto = await unaSolaVez(supabase, claveIdem,
        { tool_name: nombre, actor_email: actor.email, origen: 'mcp-contabilidad' },
        async () => {
          const r = await executeContaTool(nombre, args, { supabase: acotado, actor })
          return { ok: r.success, valor: r, error: r.error }
        })
      const ms = Date.now() - t0

      const resultado: any = envuelto.valor ?? { success: false, error: envuelto.error }
      // Al bot se le dice que fue repetida, para que no lo reporte como si
      // acabara de crear algo por segunda vez.
      if (envuelto.repetido && resultado?.data && typeof resultado.data === 'object') {
        resultado.data = { ...resultado.data, repetido: true, nota: 'Esta operacion ya se habia hecho con esa misma clave; es el resultado original, no uno nuevo.' }
      }

      // Auditoria: quien, que, cuando, con que payload y que toco.
      await supabase.from('agent_actions_log').insert({
        tool_name: nombre,
        tool_input: { ...args, _origen: 'mcp-contabilidad', _actor: actor.email, _clase: clase, _repetido: envuelto.repetido || undefined },
        tool_output: resultado.data ?? null,
        status: resultado.success ? 'success' : 'error',
        error_message: resultado.error ?? null,
        duration_ms: ms,
        affected_entity_type: resultado.affected_entity_type ?? null,
        affected_entity_id: resultado.affected_entity_id ?? null,
      })

      // MCP marca el error de negocio dentro del resultado, no como error de
      // protocolo: el modelo tiene que poder leerlo y corregir.
      respuestas.push({
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(resultado.success ? resultado.data : { error: resultado.error }, null, 2) }],
          isError: !resultado.success,
        },
      })
      continue
    }

    respuestas.push({ jsonrpc: '2.0', id, error: { code: -32601, message: `Metodo no soportado: ${method}` } })
  }

  if (respuestas.length === 0) return new Response(null, { status: 202, headers: CORS })
  return json(Array.isArray(mensaje) ? respuestas : respuestas[0])
})
