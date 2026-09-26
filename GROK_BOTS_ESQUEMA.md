# Los bots de OMM — qué puede hacer cada uno y cómo se resuelven las cosas

Acordado entre Claude (lado servidor) y Grok (lado bots) el 26-sep-2026.
La implementación va en `supabase/functions/mcp-*`; cómo conectar el primero
está en `GROK_BOT_SETUP.md`.

---

## Lo que Elias pidió, en sus términos

> Quiero que sea mi conducto hacia mi equipo y hacia mi equipo de bots para
> poder orquestar todo desde un solo punto. No quiero que un solo bot se lleve
> todo el contexto de todo el ERP, sino que haya bots por módulo. Ningún bot
> puede cambiar el cómo funciona el ERP. Esto es puramente operativo.

Son tres requisitos y cada uno tiene una respuesta distinta:

| Requisito | Cómo se cumple |
|---|---|
| Un solo punto para Elias | El orquestador (Chief), que **no** carga los módulos |
| Que ningún bot cargue todo el contexto | El contexto pesado vive en las **tools del servidor**, no en el prompt |
| Que ningún bot cambie el ERP | **Quitándole el alcance**, no pidiéndoselo por prompt |

El tercero es el que más fácil se hace mal. Una frase en el prompt —"no toques
las reglas"— se rodea sin mala intención: el modelo encuentra otra forma de
llegar. Lo que no se rodea es una tool que no existe y una tabla que el
servidor no deja tocar. Eso ya está construido y probado; ver "El límite" más
abajo.

---

## La regla de fondo: los bots calcan la organización

El ERP ya tiene escrita la regla de mando (`src/lib/cadenaDeMando.ts`):

> El DG no reparte a los 20 al mismo tiempo: encarga al director del área y el
> director reparte adentro.

Los bots siguen exactamente esa regla. Un bot por área, y **el dueño humano de
ese bot es el mismo director que ya manda en esa área**. No se inventa una
segunda jerarquía de bots paralela a la de personas, porque entonces habría dos
versiones de quién manda y tarde o temprano se contradicen.

De ahí sale el mapa, con la gente real de `app_users`:

| Bot | Módulos del ERP | Escala a |
|---|---|---|
| **OMM Chief** (orquestador) | ninguno — enruta | Elias |
| **OMM CRM** ✅ ya construido | CRM, Leads, Prospectos, Clientes | el director de la especialidad que toque |
| **OMM Cotizaciones** | Cotizaciones (los 5 cotizadores), Estimaciones, Change Orders | Ricardo Flores (ELE) · Alfredo Rosas (ESP) · Juan Pablo Gómez (ILU) |
| **OMM Obra** | Obra, Proyectos, Actividades, Gantt | Alfredo Sánchez |
| **OMM Compras** | Compras, OCs, Proveedores (lectura) | Gabriel Ruiz |
| **OMM Logística** | Entregas, Recolecciones, Inventario | Gabriel Ruiz |
| **OMM Cobranza** | Cobranza, Facturación, Estados de cuenta | Dafne Romero |
| **OMM Admin** | Nómina, Empleados, Contabilidad, Caja | Dafne Romero |
| **OMM Mantenimiento** | Mantenimiento, Tickets, Pólizas | Axel Loyden |

Se construyen **en ese orden** y no todos de una. CRM ya está.

**El organigrama no va en el prompt.** Va en una tool de lectura que sale de
`app_users`. Si el prompt dice "Alfredo es especiales" y mañana cambia el
puesto, el bot miente con toda confianza. Leer quién es director es referencia
operativa; cambiarlo es reprogramar la empresa, y eso está bloqueado.

---

## Chief: el conducto, sin el contexto

Chief es el único con el que habla Elias, y **no tiene los MCP de los módulos**.
Tiene uno propio, chico y casi todo de lectura:

| Tool | Qué hace |
|---|---|
| `chief_resumen` | El estado de cada módulo en números, no en filas |
| `chief_localizar` | "PILO-ES01 es una cotización, vive en Cotizaciones, su dueño es Alfredo Rosas" |
| `chief_resolver_dueno` | Quién manda en un módulo o en qué área cae una persona, leído de `app_users` |
| `chief_abrir_pendiente` | Deja el trabajo en la cola del módulo que toca |
| `chief_ver_pendientes` | La bandeja de Elias: lo abierto, lo vencido, lo que espera su OK |

Así Elias pregunta lo que sea en un solo lugar sin que ese lugar cargue el ERP
completo. Chief sabe **dónde vive cada cosa y quién responde por ella**; el
detalle lo tiene el bot del área.

### Chief no le habla al bot del área. Le escribe al ERP.

Esta es la corrección más importante que trajo Grok, y cambia el diseño.

Grok Bot **sí** deja que los bots se hablen entre ellos. Lo que **no** existe es
un contrato con acuse, timeout e idempotencia. O sea: es conversación entre
agentes, no una cola. Se pierde, se duplica y no deja rastro en el ERP.

Entonces el flujo real es:

```
Elias → Chief → escribe un PENDIENTE en el ERP
                        ↓
        el bot del área lo levanta cuando despierta
                        ↓
        lo trabaja con las tools de SU módulo
                        ↓
        lo cierra, o lo escala al director del área
```

El hilo de chat sigue existiendo y sirve —es donde Elias ve lo que pasa— pero
**el sistema de record es el ERP, no la conversación**. Si algo no quedó escrito
en una fila, no pasó.

---

## Las tres clases de tool. No hay una cuarta.

Toda tool de todo MCP es exactamente una de estas:

| Clase | Qué hace | Regla |
|---|---|---|
| `consulta` | Lee | Libre |
| `operacion` | Escribe un registro operativo del negocio | `dry_run` primero, `idempotency_key` siempre |
| `escalacion` | No toca el registro: le abre un pendiente a un humano | — |

La clase queda guardada en `agent_actions_log._clase`, así que después se puede
contestar "qué escribieron los bots esta semana" sin leer el código de cada
tool.

---

## El límite: lo que ningún bot puede tocar

`supabase/functions/mcp-crm/acotar.ts` envuelve el cliente de Supabase que ven
las tools. Cada MCP declara dos listas —qué tablas lee y cuáles escribe— y
además hay una lista global que **nadie escribe jamás**, aunque el autor de un
módulo la incluyera por descuido:

```
design_rules            las reglas con las que cotiza el ERP
app_users, employees    quién entra, con qué permisos, quién manda
catalog_products        el precio maestro
catalog_bundles         los paquetes
suppliers               a quién se le compra y a qué cuenta se le paga
*_templates             las plantillas de las que se generan tareas y fases
prerequisitos_catalogo  las condiciones de obra
```

Las RPC están bloqueadas enteras: una función de Postgres puede tocar cualquier
tabla y el nombre no dice cuál.

Un bot puede **leer** `app_users` y `employees` —los necesita para resolver a
quién asignarle algo— y no puede escribirlos. Esa es la línea exacta entre
operar y reprogramar.

**Probado contra el cliente real, 12 de 12**: pasan las lecturas y las
escrituras permitidas con la cadena completa de PostgREST, y revientan las
lecturas de `design_rules`, las escrituras a `app_users` y `catalog_products`,
el acceso a `purchase_orders` desde el CRM, las RPC, y un `delete` sobre una
tabla que el módulo solo lee.

### Sobre el aislamiento entre bots — lo que sí y lo que no

Hay que decirlo claro porque es la única parte donde la promesa es parcial.

Un conector de Grok Bot **queda en la cuenta, no en un bot**. Un token distinto
por MCP evita la autenticación cruzada (el token de Compras no abre el CRM),
pero no evita que alguien adjunte el conector de Compras en un hilo de CRM.
**El aislamiento por bot es higiene, no candado.**

Lo que sí es candado es el techo del daño: cada MCP solo tiene las tools de su
módulo, acotadas a sus tablas, con la configuración bloqueada y todo auditado.
El peor caso de una fuga de conector es un bot operando en el módulo de otro
—visible en el log— y nunca tocando cómo funciona el ERP.

---

## La escalera de resolución

De abajo hacia arriba. Cada escalón solo sube cuando el de abajo no alcanza.

| # | Quién | Cuándo sube |
|---|---|---|
| 1 | El bot del área, con sus tools | — |
| 2 | El bot le pregunta al humano en el hilo | Falta un dato: quién, cuándo, qué área |
| 3 | Chief reparte | El pedido cruza módulos |
| 4 | **El director del área** | Hay que decidir: dinero, fecha, alcance, una promesa al cliente |
| 5 | **Elias**, en la bandeja de Chief | El director no resolvió dentro del plazo |
| 6 | **Claude** | Hay que cambiar cómo funciona el ERP. Nunca un bot. |

Los escalones 4 y 5 son **filas del ERP, no memoria del bot**. Grok fue
explícito: la memoria entre hilos es blanda y las rutinas no son un motor de
plazos sobre las filas del ERP. Pedirle a un bot "acuérdate de esperar 48 horas"
no funciona. El reloj es del ERP; el bot solo ejecuta o reporta cuando despierta.

Lo mismo con las aprobaciones: el "espérate a mi OK" del chat es comodidad de
sesión, no un estado durable ni auditable ni visible para Dafne. **Una
aprobación de negocio es un estado en el ERP.**

---

## Cómo despiertan los bots (y por qué no cada 15 minutos)

No hay push del ERP hacia Grok Bot. La única vía que de verdad corre es una
rutina del bot que despierta, pide sus pendientes nuevos y los trabaja.

Lo que Grok confirmó de la plataforma: las rutinas no pueden quedar a menos de
5 minutos una de otra, hay tope de 50 por bot, solo guarda las últimas 20
corridas, la rutina se puede pausar si nadie usa el bot en un rato, y **cada
corrida gasta cuota**.

Entonces lo que aguanta en operación —no lo ideal, lo que sobrevive al mes—:

- **Cada 15 minutos, 24/7: no.** Son ~96 corridas diarias por bot. Con seis bots
  se acaba la cuota a media semana.
- **Horario laboral, hora pico.** Lunes a viernes, 08:00 / 11:00 / 14:00 / 17:00
  hora de la Ciudad de México.
- **Lo urgente de Elias no espera a la rutina**: Chief además lo deja en el hilo,
  y ahí se atiende en el momento.

O sea: la cola es para el trabajo normal; el hilo es para lo que no puede esperar.

---

## Idempotencia: por qué no basta con reclamar la fila

Un pendiente se reclama con un update atómico —de `nuevo` a `en_proceso`
devolviendo la fila— y solo quien se lleva la fila lo trabaja. Eso resuelve que
dos rutinas encimadas trabajen lo mismo.

**Pero no resuelve el caso que de verdad duele**, que Grok señaló: el bot llama
`crm_create_lead`, el servidor escribe el lead, la respuesta tarda, el cliente
se da por vencido por timeout y **vuelve a llamar con los mismos argumentos**.
El claim ya no interviene ahí: la segunda llamada es una escritura suelta.
Quedan dos leads gemelos y nadie se entera hasta que alguien cotiza el
equivocado.

Es la misma familia del doble clic que duplicaba salidas de inventario en este
ERP, pero entre procesos. La guarda tiene que ser atómica y vivir en la base.

Por eso toda tool de escritura recibe un `idempotency_key` que el bot inventa
por operación. El servidor reclama esa clave con `insert ... on conflict do
nothing`: solo una llamada se la lleva y es la única que ejecuta. Las demás leen
lo que quedó guardado y devuelven **el mismo `lead_id`**, marcado como repetido,
en vez de crear otro.

El lease de 2 minutos existe porque un proceso se puede morir después de
reclamar; sin él esa clave quedaría trabada para siempre y el reintento legítimo
—que es justo lo que el bot va a hacer— nunca pasaría.

**Probado con tres llamadas encimadas sobre la misma clave**: el trabajo se
ejecutó una sola vez, dos llamadas recibieron "ya va en camino, no la repitas",
una cuarta en frío recibió el mismo id marcado como repetido, y un error
guardado se recuerda como error en vez de reintentarse a ciegas.

---

## Qué contexto recibe cada bot

Corto a propósito. Tres cosas y nada más:

1. Las descripciones de las tools de **su** MCP. Ahí está el conocimiento real,
   del lado del servidor, donde el bot no lo puede olvidar ni malrecordar.
2. **Media página** con las reglas de su área — las que ya están escritas en
   `CLAUDE.md`. Para Compras, por ejemplo: una OC nunca mezcla pesos con
   dólares; el costo va en la moneda del proveedor y el precio en la de la
   cotización; las órdenes de servicio son OS, no llevan IVA y no entran a
   inventario.
3. El nombre de su director y de su equipo — **leído de la tool**, no escrito
   en el prompt.

Cero nombres de tablas, cero schema, cero SQL. Si el bot necesita saber algo del
ERP, es porque falta una tool, no porque falte prompt.

---

## Estado

**Hecho y desplegado**

- `mcp-crm` con las seis tools, `dry_run`, auditoría y las tres clases.
- `acotar.ts` — el límite de tablas, con la configuración bloqueada. 12/12.
- `idempotencia.ts` + tabla `agent_idempotencia`. Probado con llamadas encimadas.
- `GROK_BOT_SETUP.md` — cómo conectar, con los prompts de Chief y de CRM.
- `supabase/functions/mcp-crm/README.md` — cómo clonar el patrón.

**Lo siguiente, en orden**

1. La cola: tabla de pendientes con reclamo atómico, plazo y estado de
   aprobación, más la bandeja en el ERP para que los humanos la vean.
2. `mcp-chief` con sus cinco tools.
3. Un MCP por área, en el orden del mapa.
4. Las rutinas de cada bot en el horario de arriba.

**Falta de Elias**

- El secreto `GROK_MCP_CRM_TOKEN` en Supabase → Edge Functions → Secrets.
  Sin eso el endpoint contesta `500 Servidor sin configurar` a todo.
- Un token distinto por MCP conforme se vayan construyendo.
