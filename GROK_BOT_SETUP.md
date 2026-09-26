# Grok Bot ↔ OMM ERP — MCP de CRM

Cómo conectar Grok Bot al ERP para que **haga** cosas (dar de alta un lead,
asignar una tarea, avisarle a alguien), no para que navegue la pantalla.

El servidor vive en Supabase como Edge Function. Expone seis tools de negocio.
Ninguna recibe SQL: el modelo pide resultados, no consultas.

---

## 1. La URL

```
https://ubbumxommqjcpdozpunf.supabase.co/functions/v1/mcp-crm
```

Transporte: **Streamable HTTP**. El JSON-RPC se contesta en el mismo POST; el
GET responde 405 a propósito, porque este servidor no abre stream SSE.

## 2. El secreto (lo pone un humano, una sola vez)

En el Dashboard de Supabase → **Edge Functions → Secrets**:

| Secreto | Para qué |
|---|---|
| `GROK_MCP_CRM_TOKEN` | El Bearer que autentica a Grok Bot. Largo y aleatorio. |
| `MCP_CRM_ACTOR_EMAIL` | Opcional. Cuenta del ERP a cuyo nombre escribe el bot. Default `grok@omniious.com`. |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase solo.

Para generar el token, algo de 40+ caracteres aleatorios:

```bash
openssl rand -base64 48
```

**El token no va en el repo, ni en este archivo, ni en ejemplos.** En todos
lados se escribe `<GROK_MCP_CRM_TOKEN>`.

Sin ese secreto, la function contesta `500 Servidor sin configurar` a todo.

## 3. Conectar el MCP en Grok Bot

En el chat de Grok Bot:

```
Add a remote MCP server named "omm-crm" at
https://ubbumxommqjcpdozpunf.supabase.co/functions/v1/mcp-crm
using Streamable HTTP.
Send this header on every request:
Authorization: Bearer <GROK_MCP_CRM_TOKEN>
```

El token va **en el header, nunca en la URL**: los parámetros de URL se quedan
escritos en logs, historiales y proxies.

## 4. Probar sin Grok

```bash
TOKEN='<GROK_MCP_CRM_TOKEN>'
URL='https://ubbumxommqjcpdozpunf.supabase.co/functions/v1/mcp-crm'

# handshake
curl -s -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# las seis tools
curl -s -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# un dry_run: no escribe nada, devuelve lo que haría
curl -s -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
        "name":"crm_create_lead_with_task",
        "arguments":{
          "nombre":"PRUEBA Grok","empresa":"FRB Arquitectos",
          "tarea_titulo":"Contactar mañana","tarea_area":"ESP",
          "tarea_asignado_email":"ricardo@omniious.com",
          "dry_run":true}}}'
```

Sin header o con token equivocado: `401 No autorizado`.

## 5. Las seis tools

| Tool | Qué hace | Escribe |
|---|---|---|
| `crm_search_people` | Resuelve "Ana" a ids reales. Devuelve `user_id` (para notificar) y `employee_id` (para asignar) | no |
| `crm_search_leads` | Busca leads para no duplicar. Devuelve el folio OMM | no |
| `crm_create_lead` | Da de alta el lead. La clave (PILO, RD175) se genera sola | sí |
| `crm_assign_task` | Tarea ligada al lead, asignada a un empleado | sí |
| `notify_user` | Notificación dentro del ERP | sí |
| `crm_create_lead_with_task` | **La principal**: lead + tarea + avisos en una llamada | sí |

Todas las de escritura aceptan `dry_run: true`.

Dos padrones que se confunden y por eso las tools los separan:

- **app_users** — cuentas que entran al ERP. Reciben notificaciones.
- **employees** — fichas de personal. Reciben tareas.

Hay gente con una y no la otra. `crm_search_people` dice cuál tiene cada quien.

## 6. Prompt de OMM Chief (orquestador)

```
Eres OMM Chief, el coordinador de los bots de OMM Technologies.

Recibes pedidos amplios de personas de OMM y los delegas al bot del módulo que
corresponde. Tú no escribes en ningún módulo: ni creas leads, ni asignas
tareas, ni tocas cotizaciones. Delegas y reportas.

Módulos y sus bots:
- CRM (leads, prospectos, tareas comerciales, avisos) → OMM CRM
- Cotizaciones, Obra, Compras, Cobranza → aún no existen; dilo en vez de
  improvisar.

Cuando un pedido cruza módulos, pártelo y delega cada parte, en orden.

Si el pedido es ambiguo en algo que cambia el resultado —quién es el
responsable, para cuándo, de qué área es el trabajo— pregunta antes de
delegar. Una pregunta cuesta segundos; un lead asignado a la persona
equivocada cuesta una semana.

Al terminar reporta en dos líneas qué quedó hecho y con qué folios.
```

## 7. Prompt de OMM CRM

```
Eres OMM CRM, el bot del módulo comercial de OMM Technologies. Trabajas con
las tools del servidor omm-crm y con nada más.

Cómo trabajas:

1. Antes de crear un lead, búscalo con crm_search_leads. En OMM el mismo
   despacho manda varias obras y se parecen entre sí; un duplicado ensucia el
   CRM y parte el historial de la obra en dos.
2. Antes de asignar o notificar a alguien, resuélvelo con crm_search_people.
   Nunca inventes un correo ni un id. Si la búsqueda devuelve dos personas
   parecidas, pregunta cuál.
3. Para "sube este lead, asígnaselo a alguien y avísale", usa
   crm_create_lead_with_task: hace las tres cosas en una llamada.
4. Corre siempre primero con dry_run: true, enseña en dos o tres líneas lo que
   vas a hacer, y escribe de verdad solo cuando te lo confirmen.
5. Si falta un dato crítico —el área de la tarea, quién se encarga— pregunta.
   No lo adivines.
6. Al terminar di qué quedó creado, con su clave OMM y a nombre de quién.

Lo que no haces:
- No escribes SQL ni pides acceso a la base.
- No usas otros módulos: nómina, compras, finanzas y facturación no son tuyos.
- No navegas la interfaz del ERP. Si algo no se puede con tus tools, dilo.
```

## 8. Mensaje de prueba

```
Crea el lead de PRUEBA Grok, del despacho FRB Arquitectos.
Asígnale a Ricardo la tarea "Contactar mañana" del área de especiales,
y avísame a mí.
```

Lo correcto es que primero enseñe el `dry_run` y espere el visto bueno.

## 9. Qué NO hacer

- No mezclar módulos en un mismo bot. Un bot que ve 80 tools escoge mal.
- No darle SQL ni acceso directo a la base.
- No usar computer use sobre el ERP como camino principal: se rompe con cada
  cambio de pantalla y no deja rastro de auditoría.
- No poner el token en la URL.
- No conectar el MCP a un chat donde cualquiera pueda pedirle escrituras: el
  Bearer es una llave, y quien la tiene escribe.

## 10. Rotar el token

1. Genera uno nuevo (`openssl rand -base64 48`).
2. Cámbialo en Supabase → Edge Functions → Secrets.
3. Redespliega la function (`supabase functions deploy mcp-crm --no-verify-jwt`).
4. Actualiza el header en el conector de Grok Bot.

Entre el paso 2 y el 4, Grok Bot recibe 401. Es de esperarse.

## 11. Auditoría

Cada llamada queda en `agent_actions_log`: tool, input, output, estado, error,
duración y qué entidad tocó. Las del MCP traen `_origen: "mcp-crm"` en el
input.

```sql
select created_at, tool_name, status, affected_entity_type, affected_entity_id
from agent_actions_log
where tool_input->>'_origen' = 'mcp-crm'
order by created_at desc limit 50;
```
