# Auditoría OMM ERP — Seguridad, Datos, Código y Negocio
**Fecha:** 2026-06-09 · **Auditor:** Claude (Cowork) · **Repo:** EliasMicha/omm-erp · **Supabase:** ubbumxommqjcpdozpunf · **Prod:** https://omm-erp.vercel.app

---

## 0. Resumen ejecutivo

El ERP es funcionalmente muy ambicioso: ~64,000 líneas de TypeScript/React, 87 tablas en Supabase, y cubre todo el ciclo Lead → Cotización → Compra → Obra → Entrega → Factura → Cobranza, más nómina, mantenimiento, un app móvil de obra y un asistente. **El problema no es la funcionalidad: es la arquitectura de seguridad y la deuda técnica acumulada por crecer rápido sin refactor.**

El hallazgo más importante, y es **crítico**: hoy **toda la base de datos de la empresa está expuesta a internet**. Cualquier persona que abra la página puede extraer la `anon key` del bundle público y leer/escribir directamente facturas (3,017), clientes (99), leads (131), empleados con sueldos y RFC (40), nómina, movimientos bancarios (428) y los hashes de contraseña de los 8 usuarios — sin pasar por el login. El control de acceso por área que ves en la app es **puramente cosmético** (vive en React) y se evade hablándole directo a Supabase. Además, **la API key de Anthropic se compila dentro del JavaScript público**, así que cualquiera puede gastar tu cuenta de Anthropic sin límite.

Estos dos puntos hay que atacarlos antes que cualquier otra cosa. El resto (modelo de datos, duplicación, WhatsApp, asistente) es importante pero secundario frente a esto.

**Veredicto por área:**

| Área | Estado | Severidad máxima |
|------|--------|------------------|
| Seguridad | 🔴 Crítico | Base de datos y API key totalmente expuestas |
| Modelo de datos | 🟠 Regular | FKs duplicadas, ~35 tablas vacías/abandonadas, embeds ambiguos |
| Calidad de código | 🟠 Regular | 225 `as any`, typecheck desactivado, archivos de 5,000 líneas, duplicación entre cotizadores |
| Negocio/UX | 🟡 Mejorable | Mucho módulo construido y nunca adoptado; el flujo central sí funciona |
| WhatsApp | 🔴 Roto | Código contra un esquema que ya no existe; key falsa |
| Asistente | 🟡 Parcial | Funciona en-app, sin function-calling robusto ni seguridad |

---

## 1. Seguridad 🔴 (máxima prioridad)

### 1.1 — CRÍTICO: La base de datos completa es pública (RLS permisivo + auth falsa)

**Qué encontré:**
- El login **no usa Supabase Auth**. `AuthContext.signIn()` llama a un RPC `verify_login` que regresa el perfil del usuario y lo guarda en `localStorage`. La app **siempre** habla con Supabase usando la `anon key` — nunca hay una sesión JWT real (`auth.uid()` siempre es null).
- Casi todas las tablas tienen RLS "activado" pero con una política `USING (true) WITH CHECK (true)` para el rol `public`/`anon`. Eso significa: **RLS activado, pero abierto de par en par**. Verifiqué las 90+ políticas: la inmensa mayoría son `allow_all` / `Allow all for anon`.
- La `anon key` está hardcodeada en `src/lib/supabase.ts` y se sirve en el bundle. Esto es *normal* en Supabase **solo si** RLS es restrictivo. Aquí no lo es.

**Consecuencia:** cualquiera con la URL de la app puede, desde la consola del navegador:
```js
// La anon key está en el bundle. Con ella:
fetch('https://ubbumxommqjcpdozpunf.supabase.co/rest/v1/facturas?select=*', {
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }
}) // → 3,017 facturas fiscales. Lo mismo con empleados, nómina, bancos, clientes.
```
Y no solo leer: **escribir y borrar** (las políticas son `ALL`). El gating de `ProtectedRoute` por `permission_area` no protege nada a nivel datos; solo esconde botones en la UI.

**Tablas con RLS DESACTIVADO por completo** (advisor de Supabase, severidad crítica) — exposición aún más directa:
`app_users`, `quotation_versions`, `supplier_quote_playbooks`, `supplier_credentials`, `quote_requests`.

`app_users` es la peor: contiene `password_hash` y `permission_area`. Con RLS apagado, un atacante puede **leer los hashes** (bcrypt, no triviales de romper pero offline-crackeables) y, peor aún, **insertar su propio usuario DG** directamente en la tabla → toma total del sistema. En la práctica ni siquiera necesita eso: con la anon key ya tiene todo.

**Cómo debería ser:**
1. Migrar a **Supabase Auth** real (sesión JWT por usuario), o bien
2. Enrutar **todo** el acceso a datos por funciones serverless (`/api/*`) con la **service-role key** del lado servidor, dejando el frontend sin acceso directo a tablas sensibles.
3. Reemplazar las políticas `USING(true)` por políticas reales basadas en `auth.uid()` y `permission_area`.

La opción (1) es la correcta a mediano plazo. La (2) es más rápida de blindar para los datos más sensibles (facturas, nómina, app_users, bancos). Es un proyecto, no un parche — lo desgloso en el backlog (P0).

### 1.2 — CRÍTICO: La API key de Anthropic se filtra en el bundle público

`src/lib/config.ts` expone `import.meta.env.VITE_ANTHROPIC_KEY`. **Toda variable con prefijo `VITE_` se incrusta en el JavaScript compilado** que se sirve al navegador. Esa key se usa en llamadas directas a `api.anthropic.com` (con el header `anthropic-dangerous-direct-browser-access: true`) en al menos **9 archivos**: `CotEditorESP`, `Catalogo` (3 veces), `Compras`, `Obra` (3 veces), `Clientes`, `ImportCotizaciones`, `Cotizaciones`, `CRM`.

**Consecuencia:** cualquiera extrae la key del bundle y puede gastar tu cuenta de Anthropic ilimitadamente. Esto es un riesgo financiero directo y se explota en minutos.

**Solución:** mover esas llamadas a un proxy serverless (`/api/anthropic`) que guarde la key en una env var **sin** prefijo `VITE_` y solo del lado servidor. Ya tienes el patrón correcto en `api/facturapi.ts` (proxy). **Y rotar la key actual de inmediato**, porque ya estuvo expuesta en producción.

### 1.3 — Webhook de WhatsApp sin validación de firma

`api/whatsapp.ts` no valida la firma de Twilio (`X-Twilio-Signature`). Cualquiera puede POSTear al webhook, inyectar conversaciones falsas y disparar costos de Anthropic. (Además está roto — ver §6.)

### 1.4 — Otros

- `verify_login` no tiene rate limiting → fuerza bruta posible (mitigado en parte porque app_users ya es leíble directo, lo cual es peor).
- `supplier_credentials.value_encrypted` es `bytea` cifrado (bien diseñado) pero con RLS apagado; enciéndelo.
- 132 `console.log/error` en el frontend pueden filtrar datos en la consola del cliente.
- El app móvil de obra (`src/obra-app/*`) manda la anon key como `Bearer` a Storage/REST directamente — mismo problema de fondo.

---

## 2. Modelo de datos 🟠

El esquema está **bien conectado** (≈160 FKs, buena cobertura referencial). Los problemas son de redundancia y de diseños abandonados, no de falta de integridad.

### 2.1 — FKs duplicadas → embeds ambiguos (PGRST201)

Ya documentaste el caso `quotations`↔`projects` (dos FKs: `quotations.project_id` directo y `projects.cotizacion_id` inverso). Hay **más casos** del mismo patrón que rompen los embeds de PostgREST:

- **`facturas` tiene DOS columnas FK a `projects`**: `project_id` **y** `proyecto_id`. Esto es redundancia pura y fuente garantizada de embeds ambiguos. Hay que elegir una, migrar datos y borrar la otra.
- `projects` ↔ `quotations`: `projects.cotizacion_id` + `quotations.project_id` (relación circular, ya conocida).
- `projects` ↔ `leads`: `projects.lead_id` + `leads.project_id` (circular).

**Recomendación:** auditar todos los `.select('*,project:projects(...)')` y forzar el FK explícito (`projects!quotations_project_id_fkey`). Y a mediano plazo, eliminar las columnas duplicadas (`facturas.proyecto_id`, una de las circulares).

### 2.2 — ~35 tablas vacías: módulos construidos y nunca adoptados

De 87 tablas, **muchas tienen 0 filas pese a tener UI completa**. Esto cuenta una historia: hubo mucha construcción de módulos que nunca entraron en operación.

| Módulo | Tablas vacías | Señal |
|--------|---------------|-------|
| Entregas v2 | `deliveries` (0), `delivery_items` (0) | UI de 1,554 líneas construida, **sin usarse** |
| Mantenimiento | `maintenance_*` (las 5 en 0) | Módulo de 1,831 líneas, sin datos |
| Change Orders | `change_orders` (0), `change_order_items` (0) | 862 líneas, sin uso |
| Cobranza/ventas | `ventas`, `hitos_cobro`, `cobranza_seguimiento`, `payment_milestones`, `payment_allocations`, `factura_pagos` (todas 0) | **6 tablas** para cobranza, ninguna en uso |
| Banca "v2" | `movimientos_bancarios`, `cuentas_bancarias`, `movimientos_efectivo` (0) | Conviven con `bank_movements` (428, la real) |
| Conciliación | `conciliacion_match` (0), `conciliacion_mensual` (0) | La real es `conciliacion_links` (135) |
| Reportes/planeación | `work_reports`, `work_report_items`, `weekly_plans`, `weekly_plan_assignments`, `attendance_*` (0) | Sustituidos por el módulo `obra_*` |
| Notificaciones/tareas | `notifications`, `action_items`, `action_item_comments`, `activity_log` (0) | Construido, sin adopción |

**Esto no es "borrar y ya"** — algunas son features que quieres activar (Entregas, Mantenimiento, Cobranza). Pero hay **redundancia real** que sí conviene consolidar: tres sistemas de cobranza paralelos, dos sistemas de banca, tres de conciliación. Hay que decidir **uno** de cada y retirar el resto.

### 2.3 — Convención inconsistente español/inglés

El esquema mezcla `proyecto_id` y `project_id`, `factura` y `quotation`, `obra` y `project`. Es el síntoma de capas construidas en épocas distintas. No es bug, pero multiplica la carga cognitiva y los errores de embed.

---

## 3. Calidad de código 🟠

| Métrica | Valor | Lectura |
|---------|-------|---------|
| LOC totales (src+api) | ~64,000 | Grande para un proyecto sin tests |
| Archivos > 3,000 líneas | 5 (`Contabilidad` 4,960, `Obra` 4,095, `CotEditorESP` 3,480, `Compras` 3,362, `Facturacion` 3,049) | Inmantenibles; difíciles de revisar |
| `as any` | 225 | Tipado anulado en masa |
| `catch` | 191 | Muchos errores tragados silenciosamente |
| Typecheck | **Desactivado** (`build: "vite build"`, sin `tsc`) | Errores de tipo llegan a prod |
| Llamadas `.from('quotations')` | 91 (y 78 a `quotation_items`, etc.) | Acceso a datos disperso, sin capa de servicio |
| Tests | 0 | Ninguna red de seguridad |

**Problemas estructurales:**

1. **Sin capa de datos.** Cada página llama directo a `supabase.from(...)`. La misma lógica (leer cotización + áreas + items, calcular totales) está reimplementada decenas de veces. Un cambio de esquema obliga a tocar N archivos. Recomendación: una carpeta `src/data/` con funciones tipadas (`getQuotation`, `saveQuotationItems`, etc.) reutilizadas por todas las páginas.

2. **Cuatro cotizadores casi gemelos.** `CotEditorESP`, `CotEditorCortinas`, `CotEditorIlum`, `CotEditorProyecto` reimplementan cada uno sus helpers (`fmt`, `calcLine`, manejo de áreas/items, generación de PDF). Confirmé `fmt` y `calcLine` duplicados literalmente. Esto debería ser **un** motor de cotización con configuración por especialidad. Es la mayor oportunidad de reducir código (probablemente -30/40% en esa zona).

3. **Typecheck apagado.** `build:typecheck` existe pero no se usa. Con 225 `as any`, encenderlo hoy rompería el build — por eso se apagó. Hay que ir reduciendo errores de tipo hasta poder restaurar `tsc && vite build`.

4. **Generación de PDF duplicada** en `poPdf.ts`, `sembradoPdf.ts`, `CotizacionPdf.tsx`, `MemoriaTecnica.tsx` y dentro de cada cotizador, cada una con su propio HTML+jsPDF.

---

## 4. Negocio y flujo del ERP 🟡

### 4.1 — El flujo central (el que sí usas) es correcto

El **Lead** como entidad maestra es la decisión arquitectónica acertada: conecta cotizaciones, compras, facturas, obras y cobranza. El recorrido real, según dónde están los datos:

```
Lead (131) → Cotización (105) → [versiones] → Proyecto (3) / Obra (2)
                  ↓                                    ↓
            quotation_items (5,786)            obra_actividades (109)
                  ↓                                    ↓
         Compras/PO (9) → po_items (77)        obra_reportes (2)
                  ↓
            Facturas (3,017) → conceptos (4,955) → conciliación (135)
```

Lo que está **vivo de verdad**: Cotizaciones, Catálogo (959 productos), Facturación/Contabilidad (el módulo más maduro, con FacturAPI, CFDI relacionado y REP), Nómina (8 periodos, 133 items), y el catálogo de obra. Eso es el corazón del negocio y funciona.

### 4.2 — Dónde se rompe la cadena (oportunidad real de optimización)

El ERP **modela** todo el ciclo, pero la cadena se corta justo donde el negocio aún opera fuera del sistema:

- **Compras → Entregas → Inventario en obra:** Compras (9 POs) existe, pero `deliveries` está en 0. La matriz Cotizado/Pedido/Recibido/Entregado de Obra no se alimenta porque nadie registra entregas. **Si activas Entregas, cierras el bucle logístico** que hoy se lleva en cabeza/WhatsApp.
- **Facturación → Cobranza:** facturas hay miles, pero las 6 tablas de cobranza están vacías. No hay seguimiento sistemático de quién te debe. **El Monitor de Anticipos** (documentado, pendiente) y un módulo de cobranza único cerrarían esto.
- **Obra → Mantenimiento (post-venta):** Mantenimiento está construido pero en 0. Es ingreso recurrente (pólizas) que hoy no capturas en el sistema.

**Recomendación de negocio:** no construir más módulos nuevos. **Adoptar** los que ya existen, en este orden de retorno: (1) Cobranza/Anticipos — impacto directo en caja; (2) Entregas/Inventario — cierra el control de material y merma; (3) Mantenimiento — ingreso recurrente. Cada uno ya tiene UI; falta proceso y, sobre todo, que el dato entre.

### 4.3 — El asistente y WhatsApp como palanca de adopción

La razón por la que los módulos no se usan suele ser fricción de captura. Aquí es donde **WhatsApp + asistente** valen oro: si un instalador puede mandar por WhatsApp "entregué 3 cajas de cable a Zerenity" y eso crea el `delivery`, la adopción sube sola. Por eso esas dos tareas (que pediste anotar) no son un extra: son el mecanismo para que el resto del ERP por fin se llene de datos.

---

## 5. Estado de Vercel / build

- `build` = `vite build` (sin typecheck). Deploy automático en push a `main`.
- `vercel.json` configura `maxDuration` para `ai-chat` (300s), `chatbot` (60s), `generate-quote` (120s), `agent` (60s, 1GB). Plan Hobby = máx 12 funciones serverless; por eso `api/agent.ts` enruta múltiples agentes por query param (decisión correcta).
- No hay `.vercel/project.json` en el repo, así que no pude consultar el estado en vivo de los deployments desde aquí. El historial en CLAUDE.md indica builds sanos (~17–19s).

---

## 6. WhatsApp y Asistente (tareas pendientes que pediste anotar)

### 6.1 — WhatsApp 🔴 está roto (no solo "por hacer")

`api/whatsapp.ts` está escrito contra un **esquema que ya no existe**:
- Consulta `agent_conversations?phone_number=eq...` e inserta `{ phone_number }`. **`agent_conversations` no tiene `phone_number`** — el esquema real es `contact_id` → `agent_contacts.phone_e164`.
- Guarda `agent_messages.content` como **string**, pero la columna es **`jsonb`**.
- La `SUPABASE_KEY` hardcodeada es un **placeholder falso/expirado** (`iat` y `exp` = 1700000000, firma vacía) → toda llamada a Supabase falla.
- Mezcla convenciones: el GET valida con `hub.challenge` (estilo Meta/Facebook) pero el POST parsea payload de **Twilio**. Hay que decidir un proveedor.
- Sin validación de firma (§1.3).

**Para hacerlo funcional** (tarea): elegir proveedor (Twilio vs Meta Cloud API), reescribir contra el esquema real (`agent_contacts` + `agent_conversations.contact_id` + `agent_messages.content` jsonb + `wa_message_id`), usar service-role key del lado servidor, validar firma, y conectar al asistente con `allowed_tools` por contacto (el esquema ya lo contempla: `agent_contacts.allowed_tools`, `role`).

### 6.2 — Asistente 🟡 funciona parcialmente

`src/components/ChatBot.tsx` (widget flotante) + `api/chatbot.ts` están desplegados y hay datos reales (`agent_messages`: 8 filas). El esquema `agent_*` está bien pensado (contactos, conversaciones, log de acciones, documentos, tokens). Lo que falta para que sea "el asistente" de verdad:
- Function-calling robusto con herramientas reales y seguras del lado servidor (no con la anon key).
- Permisos por contacto/rol (`allowed_tools`) realmente aplicados.
- Memoria de conversación + `agent_actions_log` para auditar qué hizo.
- Unificar con `api/agent.ts` (hoy ese archivo es el **agente de cotización a proveedores** vía Puppeteer — Lutron login funciona, `create_quote` es 501). Son dos cosas distintas con nombre parecido; conviene nombrarlas claro.

---

## 7. Backlog priorizado

### P0 — Crítico, esta semana (seguridad; el ERP no debería operar así)
1. **Rotar la API key de Anthropic** y moverla a un proxy `/api/anthropic` con env var sin `VITE_`. Quitar las 9 llamadas directas desde el navegador.
2. **Encender RLS** en `app_users`, `supplier_credentials`, `quotation_versions`, `quote_requests`, `supplier_quote_playbooks` con políticas reales (no romper la app).
3. **Plan de blindaje de datos:** decidir Supabase Auth real vs. proxy server-side con service key. Empezar por las tablas más sensibles (`app_users`, `facturas`, `payroll_*`, `bank_movements`, `clientes`, `employees`): sacarlas del acceso anónimo directo.
4. **Validación de firma** en el webhook de WhatsApp antes de exponerlo.

### P1 — Alto, este mes
5. Reemplazar políticas `USING(true)` por políticas basadas en `permission_area` (depende de #3).
6. Resolver FK duplicada `facturas.project_id` vs `proyecto_id`; auditar embeds ambiguos restantes (Proyectos, Compras, Obra, Contabilidad).
7. Restaurar typecheck: ir bajando los 225 `as any` y los errores de `tsc` hasta poder usar `tsc && vite build`.
8. **Hacer funcional WhatsApp** (reescribir contra esquema real + proveedor + seguridad).

### P2 — Medio, trimestre
9. **Hacer funcional el asistente** (function-calling seguro, permisos por rol, memoria, auditoría).
10. Extraer una capa de datos `src/data/` y **unificar los 4 cotizadores** en un motor con config por especialidad.
11. Consolidar las familias de tablas redundantes (cobranza ×6, banca ×3, conciliación ×3) a una de cada.
12. Activar **Cobranza + Monitor de Anticipos** (impacto en caja).

### P3 — Mejora continua
13. Activar **Entregas/Inventario** y **Mantenimiento** (con captura vía WhatsApp para que se llenen solos).
14. Partir los archivos de 3,000–5,000 líneas en módulos.
15. Unificar la generación de PDF en una utilidad común.
16. Quitar tablas/migraciones realmente muertas tras decidir qué se consolida.

---

## 8. Propuesta de arranque (qué empiezo a arreglar ya)

Sugiero atacar primero lo que es **alto impacto y bajo riesgo de romper la app**, en este orden:

1. **Proxy de Anthropic** (`/api/anthropic`) + reemplazar las 9 llamadas directas. No cambia comportamiento visible, elimina el peor riesgo financiero. *(Tú rotas la key en Anthropic + Vercel; yo dejo el código listo.)*
2. **Encender RLS en las 5 tablas sin RLS** con políticas mínimas que no rompan la app (te muestro el SQL antes de aplicar).
3. Diseñar contigo el plan de auth real (Supabase Auth vs proxy) — es decisión de arquitectura, no la tomo solo.

Cada cambio te lo presento para aprobación antes de aplicarlo.
