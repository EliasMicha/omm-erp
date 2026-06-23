# Handoff para la siguiente sesión de Claude

Este archivo describe **exactamente** cómo arrancar una nueva conversación con el mismo setup que la actual.

---

## 1. Lo que Claude ya tendrá automáticamente

### CLAUDE.md (proyecto)
El archivo `CLAUDE.md` en la raíz del repo se carga automáticamente al inicio de **cada conversación** que tenga este folder como mounted. Ahí está documentado:
- Stack, repo, Supabase project
- Workflow especial (PAT location, restricciones del contenedor)
- Reglas multi-moneda
- Pendientes
- Sesiones previas

### Memoria personal de Claude
Claude tiene un sistema de memoria que **se carga solo** en cada sesión. Lo que está guardado hoy:
- `omm_erp_project.md` — contexto del repo
- `omm_erp_pat_location.md` — dónde buscar el PAT
- `omm_multimoneda_rules.md` — regla contable de cobranza nativa
- `omm_sembrado_rules.md` — reglas de diseño de instalaciones
- `omm_erp_audit_2026-06.md` — backlog de seguridad/auditoría

**No necesitas hacer nada para que las recuerde.** Si Claude empieza preguntando algo que ya está en memoria, repórtalo como bug (es señal de que la memoria no cargó).

---

## 2. Conectores recomendados (MCPs)

Estos son los que usé en esta sesión. Actívalos en **Settings → Connectors** de Claude antes de iniciar:

### Críticos para trabajo en el ERP
| Connector | Para qué se usa | Status sugerido |
|-----------|----------------|-----------------|
| **Supabase** | SQL queries, migrations, schema lookups, advisors | ✅ ACTIVO |
| **Claude in Chrome** (extensión) | Verificar UI en producción, debugging de bundle, inspect del DOM | ✅ ACTIVO |
| **Vercel** | Ver build logs cuando un deploy falla, listar deployments | ✅ ACTIVO |

### Útiles pero opcionales
| Connector | Para qué se usa |
|-----------|----------------|
| **GitHub** | Alternativa al PAT — si lo conectas, no hace falta el archivo `.claude-pat` |
| **Gmail / Calendar** | Si quieres que Claude vea correos o agendas relacionadas |
| **Granola** | Notas de juntas (raramente útil para el ERP) |

### Activos por default (no necesitas hacer nada)
- **Cowork** (file management del workspace)
- **Computer use** (control del Mac — para screenshots, abrir apps)
- **Workspace shell** (bash en sandbox Linux)
- **Scheduled tasks** (tareas programadas)
- **MCP registry** (búsqueda de más connectors)

---

## 3. Mensaje sugerido para empezar la próxima conversación

Pega esto en el primer mensaje (o solo dile "continúa donde quedamos"):

```
Hola, sigo trabajando en el OMM ERP. Lee CLAUDE.md y carga
tus memorias para arrancar. El PAT está en .claude-pat.

[Aquí pegas qué quieres hacer hoy, ej: "Vamos a arreglar
EmpleadoExpediente que sigue como pendiente desde el bug
del signUp que sobreescribe la sesión del admin."]
```

Eso es todo. No necesitas explicar nada más.

---

## 4. Estado actual del proyecto (a 2026-06-22)

### Pendientes en backlog (orden de prioridad)
1. **Task #9** — `EmpleadoExpediente.tsx` línea 700: el `signUp` del instalador sobreescribe la sesión del admin. Necesita Edge Function con `service_role`. Es el bug original que causó el enredo del login esta sesión.
2. **Backlog de seguridad** documentado en `omm_erp_audit_2026-06.md`: RLS USING(true) en todas las tablas, Anthropic key en bundle, WhatsApp roto.
3. **Optimización Auth Stage 2** — hardening de RLS policies tabla por tabla con auth.jwt() (hoy está USING(true) que es muy permisivo).
4. **Sync de relationships en ListaEmitidas y ListaRecibidas** (hoy solo ListaRecibidas lo hace).
5. **Re-sync histórico** — re-correr sync de meses viejos para poblar `tipo_relacion`/`uuids_relacionados` retroactivamente.

### Trabajo hecho en la sesión actual (Jun 22, 2026)
- Migración a Supabase Auth + flow de "primer ingreso"
- Auth resiliente: hidratación manual desde LS, sin bucles, botón "Limpiar cache"
- PWA con autoUpdate (clientsClaim + skipWaiting)
- Multi-moneda en cobranza: TC del día por link
- Cotizaciones: KPIs Cotizado/Vendido por especialidad, campo commercial_year editable
- CRM: columnas Cobrado + Por cobrar con sort
- Facturación: editar borradores + acciones en "Todas" + Comentarios/TC en export
- Compras: checkboxes en OC desde cot (detecta duplicados), extras configurables, sync catalog → quotation_items
- Contabilidad: Monitor de Anticipos con carga propia, KPIs detallados por categoría en Efectivo, USD nativo en cash_movements, tipo Aportación
- Conciliación: buscador siempre activo, botón Guardar comentario explícito
- Dashboard: Cobranza por proyecto multi-moneda con dual columns

### Credenciales / accesos
- **Password Elias en ERP**: `omm123456` (temporal — debería cambiarla)
- **Auth user ID**: `cd4c28b2-6358-4f83-822a-c651a3baa16d`
- **App user ID**: `39e315dd-a243-4ef8-aac0-992bf544fbc6`
- **PAT GitHub**: en `.claude-pat` (gitignored)

---

## 5. Workflow técnico (referencia rápida)

### Para hacer pushes
1. Sandbox bash NO puede tocar `.git/` → SIEMPRE usar GitHub API
2. PAT viene de `.claude-pat` (auto)
3. Patrón Python con git blobs/trees/commits/refs ya documentado en CLAUDE.md

### Para SQL en Supabase
- Project ID: `ubbumxommqjcpdozpunf`
- Usar `mcp__supabase__execute_sql` para queries
- Usar `mcp__supabase__apply_migration` para DDL
- Migrations se aplican directo, no requiere aprobación manual del user

### Para deploy
- Vercel auto-deploy en push a main (~40-90s)
- Verificar bundle con: `curl -s https://omm-erp.vercel.app/ | grep 'index-XXX.js'`
- Si el deploy falló, ver logs con `mcp__vercel__get_deployment_build_logs`

---

## 6. Si algo se rompe

- **PAT 401** → user genera nuevo en https://github.com/settings/tokens y lo pega en `.claude-pat`
- **Deploy falló** → revisar build logs en Vercel, suele ser TS error o import roto
- **User no puede entrar al ERP** → ver `omm_erp_pat_location.md` y el patrón de "Limpiar cache" en Login
- **Bundle cacheado en browser** → user usa botón "¿Problemas para entrar? Limpia el cache" en el login

---

*Última actualización: 2026-06-22, sesión donde se hizo el catch-up grande y migración a Auth.*
