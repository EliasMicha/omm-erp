# Plan de migración a Supabase Auth — OMM ERP
**Fecha:** 2026-06-09 · **Objetivo:** cerrar "la base de datos es pública" reemplazando el login casero (anon + `localStorage`) por Supabase Auth real, y sustituir las políticas `USING(true)` por control de acceso real por área — **sin romper producción durante el proceso.**

---

## Punto de partida (verificado)

Hoy conviven **dos sistemas de autenticación**:

| Sistema | Quién | Cómo | Estado |
|---------|-------|------|--------|
| **Supabase Auth (real)** | Instaladores / app de obra | `supabase.auth.signInWithPassword`, sesión JWT, `auth.uid()` | ✅ Funciona — 3 usuarios en `auth.users` |
| **Login casero (anon)** | 8 usuarios de oficina | RPC `verify_login` + perfil en `localStorage.omm_user`, todo como rol `anon` | ⚠️ Es el hueco de seguridad |

Las políticas RLS de las tablas compartidas ya tienen el patrón `auth.uid() ... OR auth.role() = 'anon'`: la rama `auth.uid()` la usan los instaladores; la rama `anon` la usa (y la abre de par en par) la oficina. **La migración consiste en quitar la dependencia de `anon` para la oficina y cerrar esa rama.**

Esto es una ventaja enorme: no introducimos un mecanismo nuevo, **extendemos uno que ya está probado en el mismo sistema.**

---

## Decisiones a confirmar antes de ejecutar

1. **Contraseñas de los 8 usuarios de oficina.** Dos caminos:
   - **(A) Reusar los hashes existentes.** `app_users.password_hash` ya es bcrypt (`crypt(...,gen_salt('bf'))`), y Supabase Auth también usa bcrypt. Es *probable* que podamos insertar el mismo hash en `auth.users.encrypted_password` y que cada quien conserve su contraseña actual. Hay que probarlo en un branch.
   - **(B) Resetear las 8.** Creamos los usuarios en Auth y a cada uno le asignamos una contraseña temporal (o link de reset). Son solo 8 personas — trivial de coordinar. Es el camino más seguro y predecible.
   - **Recomendación:** intentar (A) en un branch; si bcrypt no es 100% compatible, caer a (B).

2. **Dónde vive el rol (`permission_area`, `nivel`).** Recomiendo guardarlo en el **`app_metadata`** del usuario de Auth (se setea con la service key). Así las políticas lo leen del JWT (`auth.jwt() -> 'app_metadata' ->> 'permission_area'`) sin hacer subconsulta a `app_users` en cada fila (más rápido y sin riesgos de recursión en las políticas).

3. **Usar un branch de Supabase para probar todo.** El MCP permite crear un branch (copia aislada de la DB). Hacemos las Fases 1 y 3 ahí, probamos los módulos, y solo entonces lo aplicamos a producción. **Fuertemente recomendado** — es la red de seguridad.

---

## Fases

### Fase 0 — Preparación (cero impacto en producción)
- Crear branch de Supabase para pruebas.
- Añadir `app_users.auth_user_id uuid` (nullable, FK a `auth.users`) para ligar cada usuario de oficina con su identidad de Auth. (Alternativa: alinear `app_users.id = auth.users.id`.)
- Escribir la función helper de área para políticas (lee de JWT `app_metadata`), p. ej. `auth_area()`.

### Fase 1 — Crear las identidades de Auth (en branch primero)
- Por cada uno de los 8 `app_users`: crear su `auth.users` (vía Admin API con service key), con email y contraseña según la decisión #1.
- Setear `app_metadata = { permission_area, nivel }` en cada uno.
- Poblar `app_users.auth_user_id`.
- Verificar: los 8 pueden hacer `signInWithPassword` en el branch.

### Fase 2 — Cambiar el login del ERP de oficina
Aquí el frontend empieza a mandar JWT real, **pero las políticas siguen en `USING(true)`**, así que nada se rompe — solo que ahora `auth.uid()` queda poblado para la oficina también.
- Reescribir `src/contexts/AuthContext.tsx`:
  - `signIn` → `supabase.auth.signInWithPassword` (igual que ya hace `obra-app/LoginPage.tsx`).
  - Restaurar sesión con `supabase.auth.getSession()` + `onAuthStateChange` en vez de `localStorage.omm_user`.
  - El perfil (área, nivel, nombre) se lee del JWT o de `app_users` por `auth.uid()`.
- `ProtectedRoute` lee el área de la sesión/JWT.
- Quitar el almacenamiento manual en `localStorage`.
- **Desplegar y probar a fondo:** que los 8 usuarios entren y que cada módulo cargue. Este es el punto de no-retorno del login; las políticas todavía son permisivas como colchón.

### Fase 3 — Endurecer políticas, por oleadas (en branch, con rollback fácil)
Reemplazar `USING(true)` por políticas reales según el mapa de áreas:

| Área | Tablas (acceso) |
|------|-----------------|
| **DG** | todo |
| **Administracion** | facturas, factura_*, payroll_*, bank_movements, cash_movements, cuentas/movimientos bancarios, conciliación, clientes, employees |
| **Ventas_Ingenieria** | quotations, quotation_*, leads, projects, design_rules, change_orders |
| **Operaciones** | obras, obra_*, compras (purchase_orders/po_items), deliveries/delivery_items, maintenance_* |

- Patrón por tabla: `USING ( auth_area() = 'DG' OR auth_area() = ANY(<áreas permitidas>) )`.
- Ir por grupos, empezando por lo más sensible (facturas, nómina, bancos, empleados) y con un revert listo (recrear la política `allow_all`) si algo truena.
- **Quitar las ramas `OR auth.role() = 'anon'`** de las políticas de obra/instaladores: una vez que la oficina usa Auth, ya nadie legítimo entra como `anon`, así que esa rama solo sería un agujero.

### Fase 4 — Limpieza y cierre
- Retirar/!restringir los RPC caseros `verify_login`, `create_app_user`, `update_user_password` (mover alta de usuarios al Admin de Auth).
- Encender RLS en `quotation_versions` con políticas reales (hoy quedó pendiente porque el VersionManager la lee/escribe como anon).
- Revisar que `Usuarios.tsx` (alta/edición de usuarios) opere contra Auth Admin, no contra la tabla directo.
- (Pista aparte) restaurar `tsc` en el build, bajar los `as any`.

---

## Riesgos y mitigación
- **Romper el acceso de alguien** → todo se prueba en branch; Fase 2 mantiene políticas permisivas; Fase 3 va por oleadas con revert inmediato.
- **Contraseñas** → si los hashes no migran limpio, reset de 8 personas (coordinable en minutos).
- **Doble login (oficina vs obra)** → quedan unificados bajo el mismo Auth; revisar que un instalador que también es de oficina no quede con doble identidad (ligar por `employee_id`).

## Qué necesito de ti durante la migración
- Confirmar decisión #1 (reusar hashes vs reset) y #2 (rol en `app_metadata`).
- La parte de **código** (AuthContext, ProtectedRoute, Usuarios) sí requiere desplegarse → será tu push, o por el conector de GitHub si lo conectamos.
- La parte de **base de datos** (identidades, app_metadata, políticas, branch) la ejecuto yo directo por Supabase.
