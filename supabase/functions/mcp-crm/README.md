# `mcp-crm` — plantilla de servidor MCP por modulo

Esta carpeta es el **molde**. Los modulos que faltan
(`mcp-cotizaciones`, `mcp-proyectos`, `mcp-compras`, `mcp-cobranza`)
se hacen copiandola, no escribiendo otro servidor desde cero.

La conexion con Grok Bot (URL, header, prompts de los bots) vive en
`GROK_BOT_SETUP.md`, en la raiz del repo. Aqui esta como se construye.

---

## Como esta partido

| Archivo | Que contiene | Se toca al clonar |
|---|---|---|
| `index.ts` | Transporte: CORS, auth Bearer, JSON-RPC, actor de servicio, auditoria | **casi nada** — 4 constantes |
| `crm_tools.ts` | Las tools del modulo: schema + handler | **todo** |

El corte es a proposito: el transporte es identico en los cinco modulos y ya
esta probado. Lo unico que cambia de un modulo a otro es que sabe hacer.

---

## Clonar, paso a paso

```bash
cp -r supabase/functions/mcp-crm supabase/functions/mcp-compras
cd supabase/functions/mcp-compras
mv crm_tools.ts compras_tools.ts
```

### 1. En `index.ts`, cuatro lineas

```ts
const SERVER_INFO = { name: 'omm-compras', version: '1.0.0' }
import { COMPRAS_TOOLS, comprasToolDefinitions, executeComprasTool } from './compras_tools.ts'
const esperado = Deno.env.get('GROK_MCP_COMPRAS_TOKEN') || ''
const actorEmail = (Deno.env.get('MCP_COMPRAS_ACTOR_EMAIL') || 'grok@omniious.com').toLowerCase()
```

Y el texto de `instructions` en `initialize`: son las reglas de la casa de ese
modulo, lo primero que lee el bot. En CRM dice "busca antes de crear para no
duplicar" y "corre con dry_run primero". En Compras diria lo que corresponda
(por ejemplo: una OC nunca mezcla monedas).

**Un token por modulo, no uno compartido.** Si un dia hay que revocar el de
Compras, el de CRM sigue vivo. Y `verify_jwt: false` al desplegar, igual que
aqui: quien llama es un bot, no un usuario con sesion; el porton es el Bearer.

### 2. En `<modulo>_tools.ts`, el trabajo de verdad

Se conservan `CrmActor`, `CrmCtx`, `CrmToolResult`, `CrmTool` (renombrando el
prefijo) y los helpers `s`, `esDryRun`, `likeSafe`. Se borran las seis tools y
se escriben las del modulo.

Una tool es:

```ts
const comprasBuscarOC: ComprasTool = {
  definition: {
    name: 'compras_search_oc',
    description: '...',            // ver "Como se escribe una description"
    input_schema: { type: 'object', properties: { ... }, required: [...] },
  },
  async handler(input, ctx) {
    // 1. validar y resolver nombres a ids
    // 2. si esDryRun(input) → devolver el preview y NO escribir
    // 3. escribir
    // 4. return { success, data, affected_entity_type, affected_entity_id }
  },
}
```

y al final del archivo entra al registro:

```ts
export const COMPRAS_TOOLS: Record<string, ComprasTool> = { compras_search_oc: comprasBuscarOC, ... }
```

`crmToolDefinitions()` y `executeCrmTool()` se copian tal cual (renombradas).
`executeCrmTool` envuelve el handler en try/catch: una excepcion se vuelve
`success: false` con el mensaje, nunca un 500 que el bot no pueda leer.

---

## Las reglas que hacen que esto sirva

Salieron del brief y de construir el de CRM. No son estilo; cada una tapa una
forma concreta de fallar.

**1. Tools de resultado, no CRUD.** `crm_create_lead_with_task` existe porque
lo que pide el humano es "sube el lead, asignaselo a Ana y avisale a Carlos" —
una sola cosa. Partirlo en tres deja al modelo a cargo de la consistencia, y a
la mitad del camino se queda un lead sin tarea.

**2. Nada de SQL, nada de `filters: {}`.** Argumentos planos y con enum. Un
parametro libre es una inyeccion esperando su turno, y ademas el modelo lo
llena mal.

**3. `dry_run` en toda escritura**, y que devuelva el MISMO shape que la
escritura real, con los nombres ya resueltos. Un preview que no ensena a quien
se le va a asignar no sirve para aprobar nada.

**4. Resolver personas antes de escribir.** En el ERP una persona puede tener
cuenta (`app_users`) y ficha (`employees`), o solo una. `resolvePersona()`
devuelve las dos identidades porque **notificar y asignar usan tablas
distintas**: `notifications` quiere el `app_user_id`, `project_tasks` la ficha.
Confundirlas revienta la FK y el mensaje de Postgres no le dice nada al bot.

**5. Si falta un dato critico, error claro — no inventar.** Un asignado que no
se encontro se contesta con el nombre que se busco y a quien si se parecio,
para que el bot pregunte en vez de adivinar.

**6. Un error de negocio va en `result.isError`, no como error JSON-RPC.** El
error de protocolo el modelo no lo ve como algo corregible; `isError` con el
detalle en `content` si, y reintenta con los argumentos arreglados.

**7. Toda escritura a `agent_actions_log`**, con `_origen` y `_actor` en el
input. Es la unica forma de contestar despues "quien creo este lead".

**8. Respuestas cortas.** Campos que el humano va a leer, no el `select *`.
Un dump de filas se come el contexto del bot y no aporta.

**9. Pocas tools por servidor.** Seis en CRM. Un bot que ve ochenta escoge mal;
por eso hay un MCP por modulo y no uno con todo. Ese es el aislamiento de
verdad — el prompt del bot es solo el recordatorio.

---

## Como se escribe una description

Es lo unico que el modelo lee para decidir. Cuatro cosas, en este orden:

1. **Que hace**, en una linea.
2. **Que devuelve** y como interpretarlo (las dos identidades del punto 4).
3. **Cuando usarla** — "usala SIEMPRE antes de asignar algo a alguien
   mencionado por su nombre".
4. **Que NO hace** y si escribe o no. `crm_search_people` termina con "No
   escribe nada" para que el bot no la trate como accion.

---

## Desplegar y probar

```bash
supabase functions deploy mcp-compras --no-verify-jwt --project-ref ubbumxommqjcpdozpunf
```

El secreto lo pone un humano en Dashboard → Edge Functions → Secrets. **Nunca
en el codigo, en el README ni en un ejemplo commiteado**: aqui el token siempre
se escribe `<GROK_MCP_COMPRAS_TOKEN>`.

Orden de pruebas, sin saltarse ninguna:

```bash
# 1. sin token → 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL" -d '{}'

# 2. initialize → protocolVersion + serverInfo
curl -s -X POST "$URL" -H "Authorization: Bearer <TOKEN>" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# 3. tools/list → tus tools, con su inputSchema
# 4. tools/call con dry_run:true  → preview, y NADA en la base
# 5. tools/call con dry_run:false → el registro aparece en el ERP
```

El paso 4 se verifica **mirando la tabla**, no leyendo la respuesta: un
`dry_run` que devuelve un preview bonito y ademas escribe se ve identico desde
afuera.
