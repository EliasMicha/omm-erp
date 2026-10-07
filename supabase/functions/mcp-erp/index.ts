// ═══════════════════════════════════════════════════════════════════════════
//  mcp-erp — servidor MCP del ERP, con identidad de persona.
//
//  Reemplaza al modelo de Grok, que esta retirado. La diferencia de fondo:
//
//    Grok:   un token FIJO compartido + SUPABASE_SERVICE_ROLE_KEY.
//            Saltaba RLS por completo y escribia a nombre de un bot.
//    Aqui:   OAuth. El usuario autoriza desde /oauth/consent en el ERP,
//            Supabase emite un JWT SUYO, y este servidor arma el cliente con
//            ESE token y la ANON KEY. RLS gobierna cada lectura y cada
//            escritura, igual que si la persona estuviera en la pantalla.
//
//  ⚠️ La service_role key NO se usa en este archivo. Ni para "solo leer". Es
//  la unica regla que no se negocia: en el momento en que aparezca, el modelo
//  deja de estar sujeto a RLS y volvemos a tener el problema que quitamos.
//
//  ── Sobre verify_jwt: OFF ──────────────────────────────────────────────────
//  Grok tambien la tenia apagada, asi que vale la pena decir por que aqui SI
//  corresponde y alla no:
//
//    - El flujo de OAuth EXIGE que el servidor conteste sin credenciales en
//      dos casos: el documento de descubrimiento, y el 401 que le dice al
//      cliente a donde ir a autenticarse. Si el porton de Supabase rechaza
//      antes, el cliente nunca ve esa pista y no puede ni empezar.
//    - La diferencia real no es si el porton valida, sino QUE valida la
//      function. Grok comparaba un secreto compartido. Esta valida un JWT de
//      usuario contra Supabase y de ahi saca una persona. Un token robado de
//      aqui caduca y se revoca desde el dashboard; el de Grok era para siempre.
//
//  ── Estado: BLOQUE 1 ───────────────────────────────────────────────────────
//  Siete herramientas: consultar el CRM, dar de alta un lead, capturar alcance,
//  y los pendientes del tablero. Viven en tools.ts.
//
//  Son pocas a proposito. Un modelo que ve demasiadas herramientas escoge mal,
//  y eso ya se vio con el servidor anterior. Cotizaciones, catalogo y facturas
//  entran despues, cada bloque cuando el anterior se haya usado de verdad.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DEFINICIONES, ejecutar } from './tools.ts'

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'omm-erp', version: '0.2.0' }

const PROJECT = 'https://ubbumxommqjcpdozpunf.supabase.co'
const ISSUER = `${PROJECT}/auth/v1`
const RECURSO = `${PROJECT}/functions/v1/mcp-erp`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-session-id, www-authenticate',
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  })
}

/** El 401 que arranca todo el flujo de OAuth.
 *
 *  El header WWW-Authenticate es la pieza clave (RFC 9728): le dice al cliente
 *  DONDE esta el documento que describe a este recurso. Sin el, un cliente que
 *  no adivine la ruta se queda sin saber contra quien autenticarse — y las
 *  Edge Functions no cuelgan de la raiz del dominio, asi que adivinar la ruta
 *  estandar aqui no funciona. Por eso se manda siempre, no solo la primera vez. */
function noAutorizado(detalle: string) {
  return json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: detalle } },
    401,
    { 'WWW-Authenticate': `Bearer realm="omm-erp", resource_metadata="${RECURSO}/.well-known/oauth-protected-resource"` },
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  // Supabase entrega la ruta con el nombre de la function adelante y, segun el
  // entorno, con o sin /functions/v1. Se compara por el final para no depender
  // de cual de las dos formas toco.
  const ruta = url.pathname

  // ── Descubrimiento (sin credenciales, a proposito) ────────────────────────
  if (req.method === 'GET' && ruta.endsWith('/.well-known/oauth-protected-resource')) {
    return json({
      resource: RECURSO,
      authorization_servers: [ISSUER],
      scopes_supported: ['openid', 'email', 'profile'],
      bearer_methods_supported: ['header'],
      resource_name: 'OMM ERP',
    })
  }

  // Espejo del documento del servidor de autorizacion. Supabase ya lo publica
  // en su propia ruta; se repite aqui porque algunos clientes lo buscan pegado
  // a la URL del servidor MCP en vez de ir al emisor.
  if (req.method === 'GET' && (
    ruta.endsWith('/.well-known/oauth-authorization-server') ||
    ruta.endsWith('/.well-known/openid-configuration')
  )) {
    try {
      const r = await fetch(`${PROJECT}/.well-known/oauth-authorization-server/auth/v1`)
      if (!r.ok) return json({ error: 'no se pudo leer el documento del emisor' }, 502)
      return json(await r.json())
    } catch {
      return json({ error: 'no se pudo leer el documento del emisor' }, 502)
    }
  }

  if (req.method !== 'POST') {
    // Sin cuerpo que parsear: un 405 con algo que parezca JSON-RPC algunos
    // clientes lo emparejan con la peticion que traen en vuelo y creen que
    // fallo. El Allow le dice por donde si.
    return new Response(null, { status: 405, headers: { ...CORS, Allow: 'GET, POST, OPTIONS' } })
  }

  // ── Identidad ─────────────────────────────────────────────────────────────
  const auth = req.headers.get('Authorization') || ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) return noAutorizado('Falta el token de acceso.')

  const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!anon) return json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Servidor sin configurar.' } }, 500)

  // Se valida contra Supabase en vez de verificar la firma a mano: asi un token
  // revocado deja de servir de inmediato. Verificar solo la firma lo aceptaria
  // hasta que expire, que es justo lo que no se quiere de una llave revocada.
  const sb = createClient(PROJECT, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: quien, error: errUsuario } = await sb.auth.getUser(token)
  if (errUsuario || !quien?.user) return noAutorizado('Token invalido o expirado.')

  // La cuenta tiene que existir y estar viva en el ERP. auth.uid() no es
  // app_users.id — se busca por auth_user_id, que es el enlace real.
  const { data: cuenta } = await sb
    .from('app_users')
    .select('id,nombre,email,permission_area,activo,es_bot')
    .eq('auth_user_id', quien.user.id)
    .maybeSingle()

  if (!cuenta || cuenta.activo === false || cuenta.es_bot === true) {
    return noAutorizado('Esta cuenta no tiene acceso al ERP.')
  }

  // ── MCP ───────────────────────────────────────────────────────────────────
  let rpc: any
  try { rpc = await req.json() } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalido' } }) }

  const id = rpc?.id ?? null
  switch (rpc?.method) {
    case 'initialize':
      return json({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            `ERP de OMM Technologies, conectado como ${cuenta.nombre || cuenta.email}. ` +
            `Casi todo cuelga de un LEAD (el proyecto): busquelo primero con buscar_leads. ` +
            `Lo que se escriba queda a nombre de esta persona y sujeto a sus permisos. ` +
            `No invente fechas, montos ni especialidades que no le hayan dicho: en este ERP ` +
            `un dato faltante se pregunta, uno equivocado se compra.`,
        },
      })

    case 'notifications/initialized':
      // Una notificacion no lleva respuesta.
      return new Response(null, { status: 202, headers: CORS })

    case 'ping':
      return json({ jsonrpc: '2.0', id, result: {} })

    case 'tools/list':
      return json({ jsonrpc: '2.0', id, result: { tools: DEFINICIONES } })

    case 'tools/call': {
      const quien = { id: cuenta.id, nombre: cuenta.nombre, email: cuenta.email }
      try {
        const r = await ejecutar(rpc?.params?.name, rpc?.params?.arguments || {}, sb, quien)
        return json({ jsonrpc: '2.0', id, result: r })
      } catch (e) {
        // Un error de una herramienta se devuelve COMO RESULTADO, no como error
        // de protocolo: asi el modelo lo lee, se lo explica a la persona y puede
        // corregir. Un error de JSON-RPC lo deja sin texto que mostrar.
        return json({
          jsonrpc: '2.0', id,
          result: { isError: true, content: [{ type: 'text', text: `Fallo la herramienta: ${(e as Error)?.message || e}` }] },
        })
      }
    }

    default:
      return json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Metodo no soportado: ${rpc?.method}` } })
  }
})
