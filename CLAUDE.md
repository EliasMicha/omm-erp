# CLAUDE.md — Contexto del proyecto OMM ERP

> **Lee este archivo antes de tocar cualquier código.** Se actualiza al final de cada sesión con lo aprendido.
> Última actualización: 2026-04-08 (continuación 3)

---

## 🎯 Qué es este proyecto

ERP propio para **OMM Technologies SA de CV** (Ciudad de México, ~30 personas), empresa de instalaciones especiales (AV, redes, CCTV, control de acceso, control de iluminación, detección de humo, BMS, telefonía, cortinas motorizadas) + diseño y suministro de iluminación.

- **Stack:** React 18 + TypeScript + Vite + Supabase + Vercel
- **Repo:** `EliasMicha/omm-erp` (público), branch `main`
- **Prod:** https://omm-erp.vercel.app
- **Supabase:** proyecto `ubbumxommqjcpdozpunf`
- **Deploy:** automático desde `main` vía Vercel
- **Usuario principal:** Elias Micha (dueño, director general)

Este ERP **reemplaza a Odoo** — Odoo ya no es la opción prioritaria. Toda automatización se hace directamente aquí.

NULED y Casa Luce son entidades separadas **fuera del alcance** de este ERP.

---

## 📁 Estructura del repo

```
src/
  pages/
    Dashboard.tsx        KPIs globales
    CRM.tsx              Leads + pipeline
    Cotizaciones.tsx     Lista de cotizaciones
    CotEditorESP.tsx     Editor de cotizaciones ESP (instalaciones especiales) — 1700+ líneas, módulo grande
    Catalogo.tsx         Catálogo de productos
    Compras.tsx          OC, proveedores, cotejo de precios
    Obra.tsx             Coordinación de obras en campo — 1900+ líneas, ⚠️ parcialmente mock data
    Proyectos.tsx        Proyectos
    Clientes.tsx         Clientes fiscales (CSF)
    Facturacion.tsx      Emisión CFDI via FacturAPI
    Contabilidad.tsx     Movimientos bancarios, conciliación
  components/layout/
    UI.tsx               ← todos los componentes UI vienen de aquí
  lib/
    supabase.ts          Cliente de Supabase
    config.ts            ANTHROPIC_API_KEY (client-side, VITE_ANTHROPIC_KEY)
    utils.ts             F(), formatDate, STAGE_CONFIG
  types/index.ts         QuotationArea, QuotationItem, etc.
api/
  facturapi.ts           Edge Function para FacturAPI
  extract.ts             Edge Function para AI importer (usa ANTHROPIC_KEY server-side)
```

---

## 🗄️ Base de datos — tablas REALES

**⚠️ Crítico:** verificar siempre el nombre real antes de hacer queries. Ha habido bugs por usar nombres asumidos (ej. `clientes_fiscales` que no existe, es `clientes`).

### 📊 Auditoría completa del schema (2026-04-08)

Hay **38 tablas totales** en `public`. Auditoría verificada contra `information_schema.tables` y cruzada contra todas las referencias `supabase.from('X')` en el código del repo.

**Resultado clave:** cero bugs tipo 404 actualmente. Cada tabla referenciada por el código existe. Las 21 tablas huérfanas están **vacías** — son andamios de módulos planeados pero no construidos. **NO eliminar** hasta que Elias termine todos los módulos y haga una prueba general con DB vacía.

#### ✅ Tablas ACTIVAS usadas por el código (17)

| Tabla | Filas | Usada en | Notas |
|---|---:|---|---|
| `clientes` | 2 | Clientes, CRM, Cotizaciones, CotEditorESP, Facturacion | **NO es `clientes_fiscales`**. Columnas: id, rfc, razon_social, regimen_fiscal, regimen_fiscal_clave, codigo_postal, uso_cfdi, uso_cfdi_clave, curp, calle, num_exterior, num_interior, colonia, localidad, municipio, estado, tipo_persona, email, telefono, activo, facturapi_customer_id, created_at |
| `leads` | 1 | CRM | id, name, company, ... |
| `projects` | 1 | Proyectos, Compras, Obras | id, name, client_name, status, lines (TEXT[]), specialty (TEXT: esp/ilum/elec/cort/proy), lead_id (FK leads), cotizacion_id (FK quotations), area_lead_id (FK employees), contract_value, advance_pct, start_date, end_date_planned, end_date_real, notes. **Reglas del refactor 2026-04-10**: `specialty` singular es la fuente de verdad (derivada de `lines[0]`); `lead_id` es obligatorio desde la UI (aunque nullable en schema); un proyecto = una especialidad (lines siempre tiene 1 elemento) |
| `quotations` | 10 | Cotizaciones, CotEditorESP | id, name, client_name, project_id, specialty, stage, total, notes (JSON con systems/currency/tipoCambio/lead_id/lead_name), created_at |
| `quotation_areas` | 35 | CotEditorESP, Compras, Obra (SubMateriales) | id, quotation_id, name, order_index, subtotal |
| `quotation_items` | 8 | CotEditorESP, Compras, Obra (SubMateriales) | id, quotation_id, area_id, catalog_product_id, name, description, system, type ('material'\|'labor'), provider, supplier_id, purchase_phase, quantity, cost, markup, price, total, installation_cost, order_index |
| `catalog_products` | 8 | CotEditorESP, Catalogo, Compras | id, name, description, system, type, unit, cost, markup, precio_venta, provider, marca, modelo, sku, clave_prod_serv, clave_unidad, moneda, iva_rate, is_active, purchase_phase |
| `suppliers` | 2 | Compras, CotEditorESP | id, name, is_active, ... |
| `purchase_orders` | 2 | Compras | id, po_number, project_id, supplier_id, specialty, status, purchase_phase, subtotal, iva, total, currency |
| `po_items` | 19 | Compras | id, purchase_order_id, catalog_product_id, name, quantity, unit_cost, total, quantity_received, real_name, real_unit_cost |
| `purchase_order_payments` | 0 | Compras | (vacía, módulo de pagos activo) |
| `payment_milestones` | 0 | Cotizaciones | Hitos de cobro (vacía aún) |
| `facturas` | 3 | Facturacion | CFDI emitidos |
| `factura_conceptos` | 3 | Facturacion | Conceptos de CFDI |
| `bank_movements` | 1 | Contabilidad | Movimientos bancarios |
| `employees` | 0 | (lectura en algún lugar, verificar) | Empleados |
| `work_reports` | 0 | Obra | Reportes de trabajo |
| `project_phase_templates` | 18 | Proyectos | Templates de fases por especialidad (5 ESP + 5 ILU + 5 ELEC + 3 postventa). Fases homologadas: Arranque, Conceptual, Diseño, Revisión, Ejecutivo + Suministro, Seguimiento de Obra, Cierre |
| `project_task_templates` | 40 | Proyectos | Templates de tareas. Columnas clave: `specialty`, `start_phase_order`, `end_phase_order` (rango de fases donde vive la tarea, si start<end se clona en cada fase), `expands_by_system` (bool: si true, al instanciar se genera una subtask por sistema de la cotización ligada), `default_subtasks` TEXT[] |
| `project_phases` | variable | Proyectos | Instancias de fases por proyecto. Incluye 8 fases por proyecto ESP/ILU/ELEC (5 pre + 3 post). `is_unlocked=false` para postventa hasta que una cotización ligada pase a `stage='contrato'` |
| `project_tasks` | variable | Proyectos | Tareas instanciadas. Las tareas multi-fase (start<end) tienen **N filas**, una por cada fase del rango. Todas con el mismo `template_id` y `name`, distinta `phase_id`. Campos: assignee_id, status, progress, priority (0-3), due_date, system, notes |
| `project_task_subtasks` | variable | Proyectos | Checklist de cada tarea. Para ESP con `expands_by_system=true`: cada subtask tiene `system` seteado (Redes/Audio/CCTV/etc) y se agrupan por sistema en la UI. Para ILU/ELEC: checklist plano con `system=null` |

#### 💤 Tablas HUÉRFANAS — vacías, módulos planeados (21, NO ELIMINAR)

Son andamios. Elias tiene planeado construir estos módulos más adelante. Conservar.

**Módulo fiscal v2 (planeado):**
- `alertas_fiscales` · `cfdi_relaciones` · `cfdi_validaciones` · `factura_pagos`

**Contabilidad completa (planeado):**
- `movimientos_bancarios` · `movimientos_efectivo` · `conciliacion_match` · `estados_cuenta_uploads` · `cuentas_bancarias` · `flujo_mensual` · `gastos_fijos` · `ventas`

**Cobranza / seguimiento (planeado, duplicado conceptual con `payment_milestones`):**
- `cobranza_seguimiento` · `hitos_cobro`

**Payroll / RH (planeado):**
- `payroll_items` · `payroll_periods` · `attendance_records`

**Planeación semanal (planeado):**
- `weekly_plans` · `weekly_plan_assignments`

**Otros andamios:**
- `work_report_items` (duplicado conceptual con `work_reports`)
- `deliveries` (gestión de entregas a obra)

#### Duplicados conceptuales a resolver cuando se construyan los módulos

| Concepto | Versión en uso | Duplicado(s) huérfano(s) |
|---|---|---|
| Movimientos bancarios | `bank_movements` ✅ | `movimientos_bancarios` 💤 |
| Cuentas por cobrar | `payment_milestones` ✅ | `hitos_cobro`, `cobranza_seguimiento` 💤 |
| Reportes de obra | `work_reports` ✅ | `work_report_items` 💤 |

Cuando Elias construya el módulo de contabilidad o el de cobranza, **decidir primero** cuál versión va a ganar (la que ya tiene datos es fuerte candidata) y borrar la otra. Nunca construir dos implementaciones paralelas.

### ⚠️ Tablas que NO EXISTEN (bugs históricos / deuda)

- ~~`clientes_fiscales`~~ → usar `clientes` (fix aplicado en commit `2561ea9`)
- ~~`obras`~~ → **no existe**. Todo el módulo `Obra.tsx` usa mock data (`MOCK_OBRAS`). **Próximo gran trabajo pendiente** — ver deuda técnica.

### 🪣 Supabase Storage

Bucket activo: **`product-images`** (creado 2026-04-09)
- Público, 5 MB máximo por archivo
- Tipos MIME permitidos: `image/jpeg, image/jpg, image/png, image/webp, image/gif`
- 4 RLS policies: lectura pública + INSERT/UPDATE/DELETE con anon key
- Estructura de carpetas: `product-images/products/{timestamp}-{random}.{ext}`
- Usado por: `ImageUpload` component en `src/components/ImageUpload.tsx`
- Referenciado desde: `catalog_products.image_url` (text nullable)

Para crear nuevos buckets desde SQL (sin tocar el dashboard):

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('nombre-bucket', 'nombre-bucket', true, 5242880,
  ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Policies mínimas (adaptar según necesidades de permisos):
CREATE POLICY "Public read nombre-bucket" ON storage.objects
  FOR SELECT USING (bucket_id = 'nombre-bucket');
CREATE POLICY "Anon upload nombre-bucket" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'nombre-bucket');
```

### Antes de asumir que una tabla existe

```js
// Desde DevTools en la app productiva:
const apikey = /* extraer del bundle */;
fetch('https://ubbumxommqjcpdozpunf.supabase.co/rest/v1/NOMBRE_TABLA?select=*&limit=1', {
  headers: { apikey, Authorization: 'Bearer ' + apikey }
}).then(r => r.json()).then(console.log);
```

Si devuelve 404 con `"Perhaps you meant the table 'public.X'"`, el hint te dice el nombre real.

---

## 🎨 Convenciones de UI

### Paleta (estilos inline, no Tailwind)

- Fondo principal: `#0e0e0e` / `#111` / `#141414` / `#1a1a1a` / `#1e1e1e`
- Bordes: `#222` / `#333`
- Acento principal (verde OMM): `#57FF9A`
- Texto primario: `#fff`
- Texto secundario: `#ccc` / `#888` / `#666`
- Texto terciario/placeholder: `#555` / `#444` / `#333`
- Error: `#EF4444` / `#f87171` con fondo `#2a1414` y borde `#5a2828`
- Warning: `#F59E0B` con fondo `#2a200a` y borde `#3a2e10`
- Info: `#06B6D4` / `#3B82F6`

### Colores de sistemas ESP (ALL_SYSTEMS en CotEditorESP)

| Sistema | Color | ID interno |
|---|---|---|
| Audio | `#8B5CF6` | `audio` |
| Redes | `#06B6D4` | `redes` |
| CCTV | `#3B82F6` | `cctv` |
| Control de Acceso | `#F59E0B` | `control_acceso` |
| Control de Iluminación | `#C084FC` | `control_iluminacion` |
| Detección de Humo | `#EF4444` | `deteccion_humo` |
| BMS | `#10B981` | `bms` |
| Telefonía | `#F97316` | `telefonia` |
| Red Celular | `#EC4899` | `red_celular` |
| Cortinas y Persianas | `#67E8F9` | `cortinas_ctrl` |

### Componentes UI disponibles en `components/layout/UI.tsx`

```ts
import {
  SectionHeader, KpiCard, Table, Th, Td,
  Badge, Btn, EmptyState, ProgressBar, Loading
} from '../components/layout/UI'
```

`Btn` API: `{children, onClick, variant?: 'default'|'primary'|'ghost'|'danger', size?: 'sm'|'md', style?, disabled?}`

### Iconos

Todos los iconos vienen de `lucide-react`. Importar solo los que se usan.

---

## 🔑 Patrones obligatorios

### 1. Manejo de errores en operaciones de Supabase

**NUNCA hacer esto** (silenciosamente ignora errores):
```tsx
const { data } = await supabase.from('x').insert(payload).select().single()
setItems([...items, {...local, id: data?.id || local.id}])  // ❌ BUG: si falla, mete basura
```

**SIEMPRE hacer esto:**
```tsx
const [saveError, setSaveError] = useState<string | null>(null)
const [saving, setSaving] = useState(false)

async function save() {
  setSaveError(null)
  setSaving(true)
  try {
    const { data, error } = await supabase.from('x').insert(payload).select().single()
    if (error) {
      console.error('Error al guardar x:', error)
      setSaveError('Error al guardar: ' + error.message)
      setSaving(false)
      return
    }
    if (data) setItems(prev => [data, ...prev])
    setShowForm(false)
  } catch (err: any) {
    console.error('Excepción:', err)
    setSaveError('Error inesperado: ' + (err?.message || String(err)))
  } finally {
    setSaving(false)
  }
}
```

Y en el JSX, **banner visible dentro del modal** antes de los botones:
```tsx
{saveError && (
  <div style={{ marginTop: 16, padding: '10px 12px', background: '#2a1414', border: '1px solid #5a2828', borderRadius: 8, color: '#f87171', fontSize: 12, display: 'flex', gap: 8 }}>
    <span>⚠</span><span>{saveError}</span>
  </div>
)}
```

### 2. No inventar IDs en el cliente

Cuando se inserta en Supabase, usar el UUID que devuelve la BD (`data.id`), no `String(Date.now())`.

### 3. Modales

Overlay estándar:
```tsx
<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
  <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 600, maxHeight: '90vh', overflowY: 'auto' }}>
    {/* header con título + botón X */}
    {/* body */}
    {/* error banner si aplica */}
    {/* footer con Btn Cancelar + Btn primary */}
  </div>
</div>
```

---

## 🛠️ Cómo trabajar con el repo

### Clone + credenciales

```bash
cd /tmp && rm -rf omm-erp
git clone --depth 1 https://PAT@github.com/EliasMicha/omm-erp.git
cd /tmp/omm-erp
npm install --no-audit --no-fund --loglevel=error
```

El PAT se pide al usuario por chat cada sesión — **nunca está en memoria**. Para verificarlo desde el browser: `sessionStorage.getItem('GH_PAT')` en el tab de la app.

### Flujo estándar de un cambio

1. `git pull origin main`
2. Editar archivos con `str_replace` o `python3 << PYEOF`
3. **Validar sintaxis** con balance de llaves/paréntesis:
   ```bash
   node -e "..." # script que cuenta balance ignorando strings/comments
   ```
4. **Validar tipos** (OBLIGATORIO antes de cada push):
   ```bash
   cd /tmp/omm-erp && npx tsc --noEmit
   ```
   Si falla, arreglar antes de commitear. `node_modules/` ya está instalado en `/tmp/omm-erp/` para iteraciones rápidas.
5. `git add -A && git commit -m "..." && git push origin main`
6. Verificar deploy en Vercel: https://vercel.com/eliasmichas-projects/omm-erp/deployments

### 🗄️ Operar SQL en Supabase desde el navegador

El SQL Editor de Supabase usa **Monaco editor**. La forma más confiable de interactuar con él desde automatización es acceder directo al Monaco API vía JavaScript. **No pelear con clicks + `cmd+a` + `type`** — con cierta frecuencia el `cmd+a` selecciona el sidebar en vez del editor, o el `type` no modifica el texto.

**Patrón canónico:**

```js
// 1. Setear el query desde JS (confiable, no depende de focus ni clicks)
window.monaco.editor.getEditors()[0].setValue("SELECT ...");
window.monaco.editor.getEditors()[0].focus();
```

```
// 2. Disparar la ejecución con cmd+Return (después del focus)
computer → key → cmd+Return
```

```js
// 3. Leer el resultado del grid
[...document.querySelectorAll('[role="gridcell"]')]
  .map(c => c.textContent || '')
  .filter(t => t.length > 0)
```

**Truco para resultados grandes:** el grid del SQL Editor usa virtual scroll y solo renderiza ~12 filas a la vez. Si necesitas extraer muchas filas, **concaténalas en una sola celda** con `string_agg()` en la propia query:

```sql
SELECT string_agg(table_name, ', ' ORDER BY table_name) FROM ...;
```

Así el resultado completo cabe en una celda única y se lee en un solo `querySelectorAll`.

**Limitaciones conocidas:**
- El anon key de Supabase NO puede listar tablas via `/rest/v1/` OpenAPI (requiere `service_role`). Para listar tablas, usar SQL contra `information_schema.tables`.
- `ALTER TYPE ... ADD VALUE` **debe correrse una sentencia a la vez** — Postgres no permite agregar múltiples valores en una sola transacción.

### ❌ NO hacer

- **Nunca usar github.dev o el editor web de GitHub** — corrompe los tags de cierre JSX.
- **Nunca hacer push sin `tsc --noEmit`** — mi validación de balance no cacha errores como "Cannot find name 'Loading'".
- **No usar la API REST de github.com desde bash** (`api.github.com` no está en el whitelist del proxy). Para commits, usar `git push` directo con PAT embebido en URL.
- **No asumir schemas de Supabase** — verificar con una request real al REST API.
- **No usar `Tailwind`**, todo es estilos inline.
- **No depender de `xlsx` como dep npm** — se carga dinámicamente vía CDN (SheetJS).

---

## 🔧 Variables de entorno

### En Vercel (producción)

- `VITE_ANTHROPIC_KEY` — API key de Anthropic para llamadas **client-side** (ej. búsqueda con AI en catálogo)
- `ANTHROPIC_KEY` — API key de Anthropic para llamadas **server-side** desde `api/extract.ts`. **Sin esta var el AI importer devuelve 500.**
- `FACTURAPI_*` — credenciales de FacturAPI

### En cliente (expuestas en el bundle)

Todas las `VITE_*` están en el bundle JS. **No poner secretos reales ahí.**

---

## 📦 Features principales y estado

| Feature | Estado | Archivo | Notas |
|---|---|---|---|
| CRM (leads) | ✅ Funcional | CRM.tsx | Dropdown de cliente fiscal OK después del fix `clientes` |
| Cotizador ESP | ✅ Funcional | CotEditorESP.tsx | 9 sistemas (cortinas es especialidad aparte), pricing rules por proveedor, dual currency USD/MXN |
| AI Importer de cotizaciones | ✅ Funcional | CotEditorESP.tsx (AIImportModal) + api/extract.ts | Parseo directo para formato D-Tools (Manufacturer/Model/Room/System), fallback a Claude API. SheetJS via CDN. |
| **Cotizar con AI** (generación) | ✅ Funcional | Cotizaciones.tsx (AIGenerateModal) + api/generate-quote.ts | Cuestionario guiado o scope libre → genera cotización completa con áreas+items. Usa 3 cotizaciones previas como precedentes + catálogo filtrado. Productos sugeridos se crean en catalog_products con prefijo `[AI Suggested]`. |
| **Dashboard Cotizaciones** (búsqueda + arquitecto + KPIs) | ✅ Funcional | Cotizaciones.tsx | Barra de búsqueda en memoria, columna arquitecto (desde `leads.company`), KPIs por etapa y por especialidad con USD/MXN separados. |
| **Export PDF de cotizaciones** | ✅ Funcional | CotizacionPdf.tsx + ruta fuera de layout | 3 formatos: ejecutivo/técnico/lista. Logo OMNIIOUS embebido en base64. Datos OMM y términos editables via localStorage. Tipo de cambio USD/MXN cuando aplica. Sin dependencias externas (usa diálogo nativo del navegador). |
| Catálogo de productos | ✅ Funcional | Catalogo.tsx + CotEditorESP (CreateProductModal con búsqueda AI) | **Fotos de producto** via ImageUpload → Supabase Storage bucket `product-images`. Thumbnail en listado. Se propaga automáticamente al PDF. |
| Compras (OC) | ✅ Funcional | Compras.tsx | Agrupación proveedor × fase, cotejo de precios, recepción parcial |
| Clientes | ✅ Funcional (tras fix 2026-04-08) | Clientes.tsx | Tabla es `clientes`, no `clientes_fiscales` |
| Facturación CFDI | ✅ Funcional | Facturacion.tsx + api/facturapi.ts | FacturAPI sandbox phase 1 integrado |
| Contabilidad | 🟡 En desarrollo | Contabilidad.tsx | Bank statement upload con AI extraction en progreso |
| Obras (tab Materiales) | ✅ Funcional | Obra.tsx (SubMateriales) | Lee quotation_items vía obra.cotizacion_id, agrupado por Área → Sistema |
| Obras (resto) | 🔴 Mock data | Obra.tsx | Ver deuda técnica |

### Patrones reutilizables nuevos

- **`ImageUpload`** (`src/components/ImageUpload.tsx`): componente reutilizable para subir imágenes a Supabase Storage. Props: `value`, `onChange`, `bucket`, `folder`, `maxSizeMB`, `label`, `size`. Uso actual: fotos de productos en Catálogo y CotEditorESP. Futuro: fotos de obras, avatares de empleados, logos de clientes, comprobantes de pago, etc. Nombres únicos con timestamp+random para evitar colisiones.
- **Datos editables en localStorage**: patrón usado en `CotizacionPdf.tsx` para datos OMM y términos comerciales. Funciona para datos que son de configuración pero no críticos de sincronizar entre dispositivos. Para v2 mover a tabla Supabase.
- **Rutas sin sidebar**: patrón de dos árboles de rutas en `App.tsx` — uno wrappa con sidebar + layout oscuro, otro renderiza standalone (PDF, presentaciones, vistas de impresión).

---

## 🚨 Deuda técnica conocida

### 1. Módulo de Obras usa mock data

**Síntoma:** crear una obra nueva → aparece en la lista → al recargar, desaparece.

**Causa raíz:** `Obra.tsx` línea 224: `useState<ObraData[]>(MOCK_OBRAS)`. La tabla `obras` **no existe en Supabase**. `NuevaObraModal.crear()` solo llama `onCreate(obra)` con un ID `'o' + Date.now()` sin hacer `supabase.from('obras').insert()`. Lo mismo pasa con `instaladores` (mock), `actividades`, `reportes`, `entrega_docs`.

**Arreglo pendiente:**
1. Crear tabla `obras` en Supabase con todos los campos de `ObraData`
2. Decidir si `actividades`/`reportes`/`entrega_docs` van como JSONB en la misma fila, o tablas separadas con FK
3. Reemplazar `MOCK_OBRAS` por `useEffect` que cargue de Supabase
4. Hacer que `NuevaObraModal.crear()` y `updateObra()` persistan
5. Hacer que SubActividades/SubReportes/SubEntrega/SubEquipo persistan sus cambios
6. Si se normalizan las subtablas, crear `obra_actividades`, `obra_reportes`, `obra_entrega_docs`

**Impacto estimado:** 1-2 horas bien hecho.

### 2. Bugs del mismo patrón en otros módulos (posibles)

El patrón `const { data } = await supabase.from(...).insert(...); setState([...])` (sin verificar error) probablemente existe en más lugares. Vale la pena un `grep` periódico:
```bash
grep -rn "const { data } = await supabase.from" src/ --include="*.tsx"
```
Cualquier resultado que no haga destructuring de `error` es candidato a bug silencioso.

### 3. AI Importer fallback de Excel

Si el archivo `.xlsx` NO tiene formato D-Tools (sin columnas `Manufacturer`/`Model`/`Room`/`System`), cae al fallback de Claude API con texto plano truncado a 30k chars. Archivos grandes fuera de D-Tools probablemente fallan.

### 4. Tab Materiales en Obra — sin cruce con Compras

Actualmente es solo lectura. Pendiente (si el coordinador lo pide): cruzar con `po_items` via `catalog_product_id` para mostrar estado pedido/recibido por item.

---

## 🧠 Cosas específicas del negocio que debo saber

### Terminología

- **Proyecto** = trabajo de oficina (planos, presentaciones, cotizaciones, diagramas)
- **Obra** = ejecución en sitio

**NUNCA confundir estos términos.** Son dos cosas distintas para Elias.

### Fases de compra (purchase_phase)

`inicio`, `roughin`, `acabados`, `cierre` — orden fijo. Las OC se agrupan por proveedor × fase.

### Pricing rules (CotEditorESP)

| Proveedor | costoMult | margen | instPct | precioPublico |
|---|---|---|---|---|
| SYSCOM | 1.05 | 38% | 22% | No |
| UBIQUITI | 1.05 | 30% | 22% | No |
| DEALERSHOP | 1.05 | 38% | 22% | No |
| LUTRON | 1.05 | — | 22% | **Sí** |
| SONOS | 1.00 | — | 22% | **Sí** |
| SOMFY | 1.00 | 45% | 14% | No |
| DEFAULT | 1.05 | 33% | 22% | No |

`precioPublico: true` significa que el precio se toma directo, no se calcula desde costo + margen.

### Monedas

Cotizaciones son per-quotation en USD o MXN, guardado en `quotations.notes` JSON. Productos de catálogo tienen su propia `moneda` y se auto-convierten cuando se agregan a una cotización en otra moneda. Valores estimados del lead siempre en MXN.

### Coordinadores y equipo

- **Ricardo Flores** — líder eléctrico
- **Alfredo Rosas** — líder instalaciones especiales (default coordinator en NuevaObraModal)
- **Juan Pablo** — líder diseño de iluminación

### Clientes fiscales importantes

- Artek (aparece en el proyecto Ventanas Sacal)
- Niz + Chauvet Arquitectos
- Otros que ya están en la tabla `clientes`

### Fiscal (México)

- Régimen default persona moral: **601** — General de Ley Personas Morales
- Uso CFDI default: **G03** — Gastos en general
- IVA: 16%
- Clave unidad SAT default: **H87** (pieza)
- Para calcular ISR provisional persona moral (Título II): 30% tasa, coeficiente de utilidad

### Reglas que Elias dejó claras

- **Todo gasto con nombre de persona en el concepto** = categorizar como salario
- **Flete de luminarias importadas** = siempre calcular sobre transporte aéreo, peso volumétrico, tarifas por kg aéreo
- **Automatización directa en Odoo/Supabase**, sin Make como intermediario
- **Coordinador AI** centraliza operativo vía ChatGPT/WhatsApp/Odoo directamente, resumen diario en PDF por WhatsApp a las 9pm, planeación semanal los miércoles
- **Branding: OMNIIOUS vs OMM Technologies.** OMNIIOUS es el nombre comercial (aparece en documentos hacia el cliente — logos de PDFs, presentaciones). OMM Technologies SA de CV es la razón social legal (aparece en datos fiscales, RFC, sidebar del ERP, CLAUDE.md, footers). **NO mezclar.** Solo el logo visual del header del PDF es OMNIIOUS, todo lo demás del ERP es OMM Technologies.
- **USD y MXN NUNCA se suman.** Ninguna vista del ERP debe hacer `totalUSD + totalMXN`. Siempre mostrar ambos por separado en KPIs, dashboards, PDFs, reportes. Si una cotización está en USD, mostrar `US$X`, si está en MXN mostrar `$X`, nunca mezclar. El helper correcto es `FCUR(n, currency)` de `lib/utils.ts` que ya incluye el símbolo apropiado.
- **Cortinas y persianas** son especialidad separada. No aparecen en el cotizador ESP. Tienen su propio `id: 'cortinas'` en `Proyectos.tsx` para cuando se construya su cotizador.
- **Terminología proyecto vs obra.** "Proyecto" = trabajo de oficina (planos, presentaciones, cotizaciones, diagramas). "Obra" = ejecución en sitio. Esta distinción debe mantenerse consistentemente en todo el código y la UI.

---

## 🧪 Testing y verificación

### Smoke test después de cada deploy

1. ¿Vercel deploy está en `Ready` (no `Error`)?
2. ¿`/clientes` carga la lista?
3. ¿`/cotizaciones` carga?
4. ¿Abrir una cotización ESP existente funciona?
5. ¿El botón "✨ Importar con AI" abre el modal?

### Cómo verificar un error en producción

- **Console errors:** DevTools en tab productiva → Console
- **Network errors:** DevTools → Network → filtrar por `supabase.co/rest`
- **Build errors:** Vercel → Deployments → click en el deploy fallido → Build Logs
- **Schema errors (tabla no existe):** buscar en el body del response `"PGRST205"` / `"Could not find the table"`

---

## 📝 Log de cambios por sesión

> Formato: `YYYY-MM-DD` · commit corto · descripción · archivos tocados

### 2026-04-08

- `ec58a15` · feat(cotizador): AI Importer con Edge Function `/api/extract` + `AIImportModal` en CotEditorESP · `api/extract.ts` (nuevo), `src/pages/CotEditorESP.tsx`
- `8bded0f` · feat(cotizador): parseo directo de Excel D-Tools (sin AI), carga dinámica de SheetJS vía CDN, detector automático de fila de headers · `src/pages/CotEditorESP.tsx`
- `a3fc34a` · feat(obra): sub-tab Materiales en ObraDetail agrupado por Área → Sistema · `src/pages/Obra.tsx` **(build falló)**
- `9d3f6e0` · fix(obra): agregar `Loading` al import de UI (faltaba) · `src/pages/Obra.tsx`
- `ef6b756` · fix(clientes): manejar error del insert/update, banner visible, no perder registros · `src/pages/Clientes.tsx`
- `2561ea9` · fix: tabla se llama `clientes` no `clientes_fiscales` (7 usos en 4 archivos) · `Clientes.tsx`, `CRM.tsx`, `Cotizaciones.tsx`, `CotEditorESP.tsx`
- `(este commit)` · docs: agregar `CLAUDE.md` como documento vivo de contexto · `CLAUDE.md` (nuevo)

**Descubrimientos importantes:**
- La tabla fiscal se llama `clientes`, no `clientes_fiscales`. Error histórico que rompía crear clientes en 4 módulos.
- El módulo de Obras es **100% mock data**, no hay tabla `obras` en Supabase. Crear una obra no persiste nada.
- `tsc --noEmit` es **obligatorio** antes de cada push — mi validación de balance no cacha errores de símbolo no definido.
- El archivo `Ventanas_Sacal.xlsx` es un export de **D-Tools** con 98 columnas. El parseo directo lo lee en instantes sin gastar tokens de AI.

**Decisiones tomadas:**
- Mantener este archivo `CLAUDE.md` como primer paso de cada sesión.
- AI Importer prioriza parseo directo sobre llamadas a Claude API (más confiable, más rápido, sin tokens).
- Fix de Clientes ahora es el patrón estándar para manejo de errores en TODA operación de Supabase.

### 2026-04-08 (continuación — sesión de tarde/noche)

- `37b3003` · docs: crear `CLAUDE.md` como documento vivo de contexto entre sesiones · `CLAUDE.md` (nuevo)
- `(pendiente)` · docs: actualizar `CLAUDE.md` con auditoría completa del schema de Supabase · `CLAUDE.md`

**Descubrimientos importantes de esta continuación:**
- **Auditoría completa del schema:** 38 tablas en public, 17 usadas por código (todas existen), 21 huérfanas vacías (andamios de módulos planeados). Cero bugs tipo 404 actualmente.
- **El anon key de Supabase NO puede listar tablas** via OpenAPI del REST API (requiere `service_role`). Para listar tablas hay que usar el SQL Editor de Supabase con `information_schema.tables`.
- **El grid de resultados del SQL Editor usa virtual scroll** — no renderiza todas las filas a la vez. Para extraer resultados grandes, usar `string_agg(col, ', ')` para concatenar en una sola celda, o el botón "Export".
- **Duplicados conceptuales detectados pero no resueltos** (a decidir cuando se construyan los módulos): `bank_movements` vs `movimientos_bancarios`, `payment_milestones` vs `hitos_cobro`/`cobranza_seguimiento`, `work_reports` vs `work_report_items`.

**Decisiones tomadas:**
- **NO eliminar tablas huérfanas** hasta que Elias termine todos los módulos. Muchas son andamios planeados (payroll, planeación semanal, fiscal v2, contabilidad completa, etc.) — destruirlas perdería trabajo de diseño.
- Estrategia futura: al terminar todos los módulos, hacer **auditoría general con DB vaciada** y eliminar lo que no esté conectado ni sea módulo planeado activamente.
- Cuando se construya un módulo que tenga duplicado conceptual, **decidir primero cuál versión gana** (la que tenga datos = candidata fuerte) y borrar la otra. **Nunca construir dos implementaciones paralelas.**

### 2026-04-08 (continuación 2 — sesión nocturna)

- `7d8a154` · feat(cotizaciones): Cotizar con AI - genera cotización completa desde scope estructurado · `api/generate-quote.ts` (nuevo), `src/pages/Cotizaciones.tsx`
- `(pendiente)` · docs: actualizar CLAUDE.md con feature de Cotizar con AI

**Nueva feature: Cotizar con AI**

Arquitectura:
- **Edge Function `api/generate-quote.ts`**: recibe scope + catálogo filtrado + precedentes, llama a Claude server-side con ANTHROPIC_KEY, devuelve JSON con areas/items sanitizados (valida catalog_product_id contra lista real).
- **Componente `AIGenerateModal`** en Cotizaciones.tsx (755 líneas): modal multi-step con states `mode → questionnaire|freetext → generating → preview`. Preview editable con stats (✓ del catálogo, ⚡ AI Suggested).
- **Botón "✨ Cotizar con AI"** en la página de Cotizaciones al lado del botón "Nueva cotización".

Flujo del cuestionario (6-8 campos):
1. Tipo de proyecto (residencial/corporativo/hotelería/retail/industrial)
2. Nombre + cliente
3. Tamaño m² + habitaciones/oficinas + ubicación
4. Nivel (básico/medio/alto/premium) — sugerido, afecta marcas
5. Sistemas a incluir (multi-select de los 10 ESP)
6. Áreas específicas (textarea libre opcional, "si el arquitecto ya te pasó la lista")
7. Notas y restricciones

Al confirmar el preview:
- Crea `quotation` con `specialty='esp'`, `stage='oportunidad'`
- Crea `quotation_areas` en orden
- Para cada item: si hay catalog_product_id válido, usa datos reales del catálogo. Si no, crea un producto nuevo en `catalog_products` con `name='[AI Suggested] ...'`, `provider='AI Suggested'`, `cost=0` (para que el ingeniero lo llene después)
- Inserta `quotation_items` con pricing básico (el editor ESP recalcula después)
- Navega directo al editor ESP sobre la nueva cotización

Usa los 3 precedentes más recientes con `specialty='esp'` y `total > 0` como contexto. Hoy esos son: Ventanas Sacal, Casa Salame - Especiales (x2). La idea es que conforme se acumulen más cotizaciones reales, el sistema aprende progresivamente el estilo OMM sin tocar código.

**Decisiones tomadas:**
- Productos sugeridos se crean con `is_active=true` y prefijo `[AI Suggested]` en el nombre (opción 3 del cuestionario): el ingeniero los identifica fácil después para corregir/reemplazar. No se usa `is_active=false` porque perderían visibilidad en el catálogo del editor ESP.
- La AI NO inventa marcas específicas fuera del catálogo. Si no encuentra match, usa descripciones genéricas tipo "Access Point WiFi 6", "Switch PoE 24 puertos", "Cámara IP domo 4MP exterior".
- El modo "texto libre" actualmente manda el texto directo al generador sin un paso intermedio de "extraer scope estructurado". En v2 se podría agregar ese paso si hace falta más precisión.
- `tsc --noEmit` pasó al primer intento esta vez, sin necesidad de fixes. El patrón de validación local antes del push ya está internalizado.

**Descubrimientos importantes:**
- Solo hay **3 cotizaciones reales** en Supabase (Ventanas Sacal + 2 Casa Salame). Las otras 7 son vacías/de prueba. Para que la AI aprenda de precedentes, necesita más volumen — pero v1 ya es útil con lo que hay.
- El catálogo tiene solo 8 productos (según auditoría). Esto significa que en los primeros usos la AI va a crear muchos productos sugeridos. Es esperado y es parte del plan: el feature también sirve como herramienta para **descubrir los huecos del catálogo** que falta poblar.

### 2026-04-08 (continuación 3 — cierre del loop del enum product_system)

- `38e7da8` · fix(cotizaciones): mapear sistemas al enum real product_system (parcial, 5 de 9 sistemas con enumValue, los otros 4 `enumValue: null`)
- `7079880` · refactor(esp): cortinas y persianas fuera del cotizador ESP (son especialidad separada)
- `226883b` · fix(cotizaciones): mapear los 4 sistemas faltantes al enum product_system (cierre del loop)

**Enum `product_system` actualizado en Supabase** — 14 valores finales:
```
Redes, CCTV, Audio, Lutron, Acceso, Somfy, Electrico, Iluminacion,
Cortinas, General, BMS, Humo, Telefonia, Celular
```

Los 4 valores nuevos (`BMS`, `Humo`, `Telefonia`, `Celular`) se agregaron con `ALTER TYPE product_system ADD VALUE IF NOT EXISTS ...` uno por uno (Postgres no permite múltiples en una transacción).

**Refactor importante: Cortinas y Persianas fuera del cotizador ESP.** Son especialidad separada (existe el id `cortinas` en `Proyectos.tsx` para cuando se construya su cotizador). Removido de 5 puntos: `AI_ALL_SYSTEMS`, `SYSTEM_PRESETS`, `ALL_SYSTEMS` del editor ESP, detector automático del importer de Excel, prompts de ambos Edge Functions. El cotizador ESP ahora maneja exactamente **9 sistemas**: Audio, Redes, CCTV, Control de Acceso, Control de Iluminación, Detección de Humo, BMS, Telefonía, Red Celular.

**Descubrimiento técnico clave: Monaco editor directo.** Ver la sección nueva "🗄️ Operar SQL en Supabase desde el navegador". El método `window.monaco.editor.getEditors()[0].setValue()` es mucho más confiable que pelear con `cmd+a` + `type` que a veces selecciona el sidebar del explorer en vez del editor. Esto va a ahorrar tiempo considerable en futuras sesiones donde haya que correr SQL.

**Bug del enum original (contexto):** Cotizar con AI fallaba con `invalid input value for enum product_system: "Control de Acceso"` porque el código filtraba `.in('system', [...nombres bonitos...])` pero el enum usa valores cortos sin espacios ni tildes (`Acceso`, `Iluminacion`). El fix requirió (1) agregar un campo `enumValue` a `AI_ALL_SYSTEMS` con el valor exacto del enum, (2) agregar los 4 valores faltantes al enum en Supabase, (3) actualizar los 4 mapeos en el código.

**Decisiones tomadas:**
- Valores del enum sin tildes ni espacios (`Humo` en vez de "Detección de Humo", `Telefonia` sin tilde, `Celular` en vez de "Red Celular") — consistente con el patrón ya existente (`Acceso` sin "Control de", `Iluminacion` sin tilde). Los labels bonitos viven solo en el frontend via `name` y el mapeo `enumValue` hace el puente.
- `systemsWithoutCatalog` en `Cotizaciones.tsx` queda como código defensivo aunque ahora sea siempre `[]`. No estorba y protege si en el futuro se agrega un sistema sin enumValue.
- **NO tocar `Lutron`, `Somfy`, `Cortinas`, `General`, `Electrico` del enum** por ahora. Son valores legacy que pueden tener productos asociados. Se limpian cuando se haga la auditoría general con DB vacía al terminar todos los módulos (ver ritual planeado en auditoría del schema).

**Estado final de Cotizar con AI:**
- ✅ Los 9 sistemas ESP ahora pueden filtrar catálogo correctamente
- ✅ Cero error 400 al generar con cualquier combinación de sistemas
- 🟡 Pendiente de prueba real con el flujo completo desde el cuestionario

### 2026-04-09 (sesión larga — UX de Cotizaciones + PDF exportable + fotos de producto)

Cinco commits significativos en una sola sesión, cubriendo mejoras de UX, un feature grande (PDF export), y el primer módulo de Storage del proyecto.

- `fe77032` · feat(cotizaciones): barra búsqueda + columna arquitecto + KPIs por especialidad
- `de053fe` · feat(cotizaciones): exportar a PDF con 3 formatos y datos editables
- `5358a6d` · fix(pdf): doble símbolo de moneda + nuevas columnas desglose + logo OMNIIOUS
- `433167a` · feat(pdf): agregar tipo de cambio USD/MXN en header, totales y términos
- `117f53f` · feat(catalogo): fotos de producto con Supabase Storage + ImageUpload

#### Cambios en dashboard de Cotizaciones (`fe77032`)

- **Nueva columna "Arquitecto"** en la tabla — se obtiene de `leads.company` (el despacho) a través del `lead_id` guardado en `quotations.notes` JSON. Carga en paralelo con Promise.all, `leadsMap` indexado por id para lookup O(1). Color rosa pastel `#F9A8D4`.
- **Barra de búsqueda** arriba de la tabla. Filtra en memoria por: nombre cotización, cliente, arquitecto, lead. Icon `Search` de lucide, botón X para limpiar.
- **Nueva fila de KPIs por especialidad** (5 cards: ESP, ELEC, ILUM, CORT, PROY). USD y MXN **separados visualmente** (refuerzo del principio de nunca sumar monedas distintas). Cada card con border-left del color de la especialidad, icon y label.
- **Subtitle del header** con separadores más limpios: `N cotizaciones · USD X · MXN Y` en vez de pipes.
- Columna "Cotizacion" renombrada a "Cotización" (con tilde).

Importante para la nomenclatura:
- **Lead** = nombre del proyecto/lead (ej. "Casa Salame")
- **Cliente** = `quotations.client_name` (el cliente final fiscal)
- **Arquitecto** = `leads.company` (el despacho cuando aplica)

Los datos existentes tienen cierta mezcla histórica entre `client_name` y arquitecto, pero las cotizaciones nuevas creadas desde el CRM con lead bien ligado van a quedar limpias.

#### Feature grande: Export PDF de cotizaciones (`de053fe`)

**Nuevo componente:** `src/pages/CotizacionPdf.tsx` (~681 líneas al principio, ahora ~750). Vista HTML optimizada para impresión, **sin dependencias externas** — usa el diálogo nativo del navegador para guardar como PDF.

**3 formatos disponibles:**
1. **Ejecutivo** — Para cliente final. Sin costos internos ni markups. Diseño formal.
2. **Técnico detallado** — Para ingeniería. Incluye SKUs, proveedores, fases, costos, markups.
3. **Lista de precios** — Tabla plana sin agrupar, rápida comparación.

**Estructura del PDF (los 3 formatos comparten header y cierre):**
- Header: logo OMNIIOUS + datos fiscales OMM completos + datos del cliente (folio, fecha, vigencia, arquitecto, moneda, proyecto)
- Sección 1: Resumen por sistema (tabla con componentes y subtotal)
- Sección 2: Alcance del proyecto (párrafo breve automático por sistema con marcas detectadas)
- Page break
- Sección 3: Desglose (formato varía según tipo elegido)
- Totales finales con subtotal + mano de obra + IVA + TOTAL
- Page break
- Sección 4: Términos comerciales (vigencia, condiciones de pago, garantía, exclusiones, observaciones, tipo de cambio si aplica)
- Firma del responsable
- Footer con datos fiscales

**Datos OMM y términos son EDITABLES** desde un modal "Editar datos y términos" (botón en la barra flotante, oculta al imprimir). Se guardan en `localStorage` del navegador para persistir entre sesiones. Campos editables:
- Razón social, RFC, domicilio fiscal, CP, ciudad, régimen fiscal
- Teléfono, email, web
- Nombre y puesto del firmante
- Vigencia en días, porcentajes de pago (anticipo/avance/entrega), garantía, exclusiones, observaciones

**Arquitectura técnica:**
- Nueva ruta `/cotizacion/:id/pdf/:format` **fuera del layout con sidebar** — se restructuró `App.tsx` para tener 2 árboles de rutas (una para la vista PDF sin sidebar, otra para el resto del ERP con sidebar)
- La vista PDF abre en **pestaña nueva** via `window.open()`
- `@media print` oculta la barra flotante y usa background blanco
- Cero dependencias nuevas (sin jsPDF, sin html2pdf, sin Puppeteer)

**UX desde el editor ESP:**
- Nuevo botón "📄 Exportar PDF" azul al lado de "✨ Importar con AI" en la barra superior
- Click → modal con 3 cards grandes (ejecutivo/técnico/lista)
- Click en una card → abre la vista PDF en pestaña nueva
- Usuario ajusta datos/términos si es primera vez, después click "🖨 Imprimir / Guardar PDF"

#### Fixes importantes del PDF (`5358a6d`)

**1. Bug de doble símbolo de moneda.** Mostraba `$$9,339` y `US$$4,705`. Causa raíz: el helper `F()` de `lib/utils.ts` ya usa `Intl.NumberFormat` con `style: 'currency', currency: 'MXN'`, que **ya incluye el símbolo**. Yo estaba concatenando `{sym}{F(x)}` encima, generando dos. Fix: uso `FCUR(x, currency)` que usa el helper correcto según la moneda. 17 reemplazos limpios, `sym` y `curSymbol` eliminados del archivo.

**2. Nuevas columnas en el desglose** (según feedback de Elias):
- Antes: `Producto | Cant | P.unit | Total`
- Ahora: `[foto 42x42] | Marca | Modelo | Descripción | Cant | P.unit`
- Foto: thumbnail condicional si el producto tiene `image_url`, placeholder punteado si no
- Marca y Modelo separados en columnas propias (antes iban mezclados en el subtitle)
- Descripción tiene el nombre como título y la description del catálogo como subtítulo
- Quitada la columna Total de línea (confundía al cliente viendo precio por línea, el total está en los totales finales)
- Técnico agrega: SKU/Proveedor, Costo, Markup a la derecha

**3. Logo OMNIIOUS en el header del PDF** (reemplaza el texto "OMM"). El logo original (871×756 JPEG, 194 KB) se optimizó a 400×347 JPEG 85% = 22 KB y se embebió como base64 data URI en `src/assets/logo.ts` (~30 KB). No requiere hosting externo, funciona offline, portable entre hostings.

**4. Interfaz `ItemRow` preparada con `image_url?: string | null`** — deja listo el render de fotos en el PDF para cuando el schema tuviera el campo.

#### Branding clarificado

**OMNIIOUS** es el nombre comercial de **OMM Technologies SA de CV**. Coexisten:
- **OMNIIOUS** → aparece en documentos hacia el cliente (logos en PDFs, presentaciones)
- **OMM Technologies** → razón social legal, aparece en datos fiscales, RFC, contratos, el sidebar del ERP

**NO mezclar.** El sidebar del ERP, CLAUDE.md, datos fiscales del footer del PDF siguen diciendo "OMM Technologies SA de CV". Solo el logo visual del header del PDF es OMNIIOUS.

#### Tipo de cambio USD/MXN en el PDF (`433167a`)

Cuando la cotización está en USD y tiene `tipoCambio` registrado en `quotations.notes`, ahora aparece en **3 lugares del PDF**:

1. **Header** — celda "Moneda" ampliada: `USD · TC $20.50 MXN`
2. **Totales finales** — fila italica pequeña debajo del TOTAL: `Equivalente en MXN (TC $20.50)    $1,339,101`. Facilita al cliente ver cuánto son en pesos sin sacar calculadora.
3. **Términos comerciales** — nueva subsección "Tipo de cambio" con texto legal: *"Los montos en esta cotización están expresados en Dólares Americanos (USD). Para referencia de facturación en Pesos Mexicanos (MXN), se utiliza un tipo de cambio de $X.XX MXN por USD, calculado a la fecha de emisión. El tipo de cambio aplicable al momento del pago será el publicado por el Banco de México (DOF) en la fecha efectiva de cada abono."*

Texto legal importante: fija el TC de referencia pero **no amarra** a OMM a ese TC al momento del cobro. Si el dólar sube entre firma y último pago, se cobra al TC de ese día.

**Helper nuevo:** `getTipoCambio(cot): number | null` que parsea `notes.tipoCambio` y devuelve null si no es un número positivo.

**🚨 Descubrimiento al verificar datos:** las 4 cotizaciones existentes en producción (Ventanas Sacal, Casa Salame × 3) **ninguna tiene `tipoCambio` guardado**. El feature funciona correctamente (solo muestra TC cuando existe), pero para que aparezca en cotizaciones viejas hay que entrar una por una al editor ESP y guardarles el TC. **Deuda técnica relacionada:** en v2 del editor ESP hay que hacer que el campo de tipo de cambio sea **obligatorio** cuando la moneda es USD, para evitar que sigan saliendo cotizaciones sin él.

#### Fotos de producto con Supabase Storage (`117f53f`)

Primer uso de **Supabase Storage** en el proyecto. Schema y bucket creados via SQL Editor (con truco del Monaco directo):

```sql
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS image_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', true, 5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;

-- 4 policies: lectura pública + INSERT/UPDATE/DELETE anon
```

Supabase Studio mostró un warning de "destructive operations" por los `DROP POLICY IF EXISTS` — son seguros, solo borro policies que quizás no existen antes de recrearlas. Click en "Run this query" para confirmar.

**Componente nuevo reutilizable:** `src/components/ImageUpload.tsx` (~183 líneas).

```tsx
<ImageUpload
  value={form.image_url}
  onChange={url => setForm({...form, image_url: url})}
  size="md"           // 'sm' (60x60) | 'md' (100x100) | 'lg' (160x160)
  label="Subir foto"
  folder="products"   // sub-carpeta dentro del bucket
  bucket="product-images"  // default
  maxSizeMB={5}       // default
/>
```

- Nombres únicos: `timestamp-random.ext` para evitar colisiones
- Cache-Control: `31536000` (1 año) porque las URLs son únicas por archivo
- Validaciones: tipo `image/*`, tamaño máximo
- Estados visuales: idle (icon + label), uploading (spinner), filled (preview con X para eliminar), error (texto rojo)
- Preview con `object-fit: contain` sobre fondo blanco (se ve bien con logos de fabricantes que son transparentes)

**Integrado en 2 lugares:**

1. **`src/pages/Catalogo.tsx`** — form Nuevo/Editar Producto:
   - Layout flex con ImageUpload (md) a la izquierda + Nombre/Marca/Modelo a la derecha
   - Marca y Modelo se quitaron del grid inferior para evitar duplicados
   - Nueva columna de thumbnail 32×32 al inicio de la tabla del listado (con placeholder punteado si no hay foto)
   - `image_url: string | null` agregado a la interfaz Product y al payload de `guardar()`
   - `colSpan` del EmptyState de 9 a 10

2. **`src/pages/CotEditorESP.tsx`** — `CreateProductModal` inline:
   - ImageUpload dentro del form, layout flex con Nombre/Descripción
   - `image_url` agregado al state inicial y al payload del insert

**Propagación automática al PDF:** el commit `5358a6d` ya había preparado `CotizacionPdf.tsx` para mostrar `image_url` si existe (interfaz `ItemRow` con el campo opcional, tag `<img>` condicional con placeholder punteado). Ahora cuando subas una foto a un producto del catálogo y ese producto esté en una cotización, la foto **aparece automáticamente en el PDF exportado** sin tocar nada más.

**Flujo completo del feature:**
1. Elias crea/edita producto en Catálogo → click en el cuadro de foto → file picker → selecciona imagen
2. ImageUpload sube a `product-images/products/{timestamp}-{random}.{ext}`
3. Supabase Storage devuelve URL pública permanente
4. La URL se guarda en `catalog_products.image_url` al guardar el producto
5. Al exportar PDF de una cotización que usa ese producto, la foto aparece en la tabla de desglose

#### Descubrimientos técnicos importantes de esta sesión

**1. Monaco editor directo en Supabase SQL Editor** (ya documentado en sesión anterior pero usado intensivamente hoy):

```javascript
const ed = window.monaco.editor.getEditors()[0];
ed.setValue("ALTER TYPE ...");
ed.focus();
// después: cmd+Return via tool de browser
```

Es **mucho más confiable** que `cmd+a` + `type` que a veces selecciona la sidebar. Se usó para confirmar el estado del enum `product_system`, correr la migración de fotos, y verificar resultados de queries. En esta sesión se usó una decena de veces sin fallar.

**2. Para leer resultados de queries SQL en Supabase:**

```javascript
[...document.querySelectorAll('[role="gridcell"]')]
  .map(c => c.textContent || '')
  .filter(t => t.length > 0)
```

Devuelve array plano de celdas. Sirve para verificar estado del schema/datos sin necesidad de screenshot.

**3. Helpers de formateo de moneda — usar siempre `FCUR`:**

`F()` y `FUSD()` ya incluyen el símbolo de moneda porque usan `Intl.NumberFormat` con `style: 'currency'`. **Nunca** anteponer un símbolo manualmente como `{sym}{F(x)}` — causa doble símbolo. Usar `FCUR(n, currency)` que elige el helper correcto y devuelve el string completo formateado.

**4. Embeber imágenes pequeñas como base64 en TS** es una buena solución para assets críticos del branding (logos, iconos) que deben estar siempre disponibles sin dependencias de red. Para el logo OMNIIOUS: redimensionado a 400px, JPEG 85%, resulta en ~30 KB base64 — aceptable para un bundle que se carga una sola vez. Para imágenes de usuario (fotos de productos), usar Supabase Storage.

#### Reglas de negocio reforzadas

- **USD y MXN NUNCA se suman** — refuerzo explícito en todos los KPIs del dashboard de Cotizaciones y en todos los totales del PDF. Siempre mostrar ambos separados o solo el que aplica a la cotización específica.
- **Cortinas y persianas** siguen siendo especialidad separada (fuera del cotizador ESP). Confirmado y documentado desde hace 2 commits.
- **Terminología**: "Proyecto" = trabajo de oficina (planos, cotizaciones). "Obra" = ejecución en sitio. No mezclar.

#### Estado de features al cierre de la sesión

| Feature | Estado |
|---|---|
| Dashboard de Cotizaciones con búsqueda + arquitecto + KPIs especialidad | ✅ Listo |
| Export PDF ejecutivo/técnico/lista con datos editables | ✅ Listo |
| Tipo de cambio USD/MXN en PDF | ✅ Listo (pendiente: hacer obligatorio en editor ESP) |
| Fotos de producto con Supabase Storage | ✅ Listo |
| Render automático de fotos en PDF | ✅ Listo (requiere subir fotos a cada producto) |

#### Deuda técnica nueva identificada

1. **Tipo de cambio no obligatorio** en editor ESP cuando moneda es USD. Las 4 cotizaciones existentes no lo tienen. En v2 hacer el campo `tipoCambio` required cuando `currency='USD'` en el editor, y correr un script de fixup para las cotizaciones viejas.

2. **localStorage para datos OMM del PDF**: los datos fiscales y términos se guardan en `localStorage` del navegador. Si Elias cambia de computadora o navegador, tiene que volver a llenarlos. **Migración futura a v2**: mover a tabla `omm_settings` en Supabase para que sean globales.

3. **Alcance por sistema es automático** (genérico). El texto dice cosas como "Incluye 4 componentes del sistema de Audio. Marcas principales: Sonos, Lutron." Si Elias quiere textos descriptivos ricos ("Sistema multizona con 4 zonas distribuidas, control desde app móvil..."), se puede: (a) pre-generar con AI al abrir el PDF, o (b) campo editable en `quotations.notes`.

#### Fix tardío de la sesión: snapshot completo en quotation_items (`8b4038b`)

Elias reportó después de probar el feature de fotos: *"cuando actualizas el producto en catálogo sí se queda, pero no sale en cotizaciones ni en el PDF"*.

**Causa raíz:** la tabla `quotation_items` **no tenía** columnas `marca`, `modelo`, `sku`, ni `image_url`. El editor ESP al agregar un producto del catálogo solo copiaba `name/description/price/cost/etc` — los campos nuevos (incluida la foto) nunca llegaban al snapshot. El PDF lee intencionalmente de `quotation_items` (no hace JOIN con `catalog_products`) porque una cotización es un documento legal fijo — si después cambias la foto del producto, la cotización vieja debe mantener la original.

**Migración ejecutada en esta sesión** (via Monaco directo):

```sql
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS marca text;
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS modelo text;
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS image_url text;

-- Backfill para items existentes ligados al catalogo
UPDATE quotation_items qi
SET marca = cp.marca, modelo = cp.modelo,
    sku = cp.sku, image_url = cp.image_url
FROM catalog_products cp
WHERE qi.catalog_product_id = cp.id
  AND (qi.marca IS NULL OR qi.modelo IS NULL
    OR qi.sku IS NULL OR qi.image_url IS NULL);
```

**Resultado verificado:** 18 items totales, todos con `catalog_product_id`, 9 recibieron `image_url` del backfill, 11 con marca y modelo.

**Código modificado — 5 INSERTs en `quotation_items` ahora copian los 4 campos nuevos como snapshot:**

1. `CotEditorESP.tsx:700` — `AIImportModal` onImported
2. `CotEditorESP.tsx:1504` — `addFromCatalog`
3. `CotEditorESP.tsx:1537` — `handleCreateAndAdd`
4. `Cotizaciones.tsx:739` — `addFromCatalog` (editor inline legacy)
5. `Cotizaciones.tsx:1427` — `AIGenerator` crea items

**Interfaces TypeScript actualizadas** para aceptar `sku?: string | null`:
- `AIExtractedItem` (CotEditorESP.tsx línea 240)
- `AIGenItem` (Cotizaciones.tsx línea 1032)

**Principio reforzado: snapshot vs live-join**

Una cotización es un documento legal con fecha y folio. Los datos del producto (precio, marca, modelo, foto) que mandaste al cliente deben **quedar fijos para siempre**. Si después cambias la foto del producto en el catálogo, la cotización vieja mantiene la foto original del momento de la firma. Esto es por qué `price` y `cost` ya se copiaban al item (nunca se hacía JOIN con el catálogo al leer) — el fix extiende ese mismo principio a marca/modelo/sku/image_url.

**Efecto práctico para el usuario:**
- Cotizaciones NUEVAS: al agregar producto del catálogo, foto y metadatos se copian automáticamente
- Cotizaciones EXISTENTES: el backfill ya les puso las fotos disponibles en el catálogo
- Cambios futuros en fotos del catálogo: **NO** se propagan a cotizaciones viejas (comportamiento deseado)
- Para actualizar manualmente una cotización vieja con fotos nuevas: correr UPDATE con filtro por `quotation_id`

#### Reflexión sobre estrategia de migración inicial (conversación al cierre)

Elias preguntó cómo hacer la primera carga de datos al ERP antes de arrancar en operaciones reales. Decisión tomada: **estrategia híbrida** con Claude cargando masa de datos estables y Elias/equipo cargando manualmente los flujos vivos. Detalles en la sección nueva "📋 Plan de migración inicial" abajo.

#### Estado final de features al cierre (9 de abril, noche)

| Feature | Estado | Notas |
|---|---|---|
| Dashboard Cotizaciones (búsqueda + arquitecto + KPIs) | ✅ Listo | USD/MXN separados siempre |
| Export PDF ejecutivo/técnico/lista con datos editables | ✅ Listo | Logo OMNIIOUS embebido, términos editables en localStorage |
| Tipo de cambio USD/MXN en PDF | ✅ Listo | Header, totales y términos legales |
| Fotos de producto con Supabase Storage | ✅ Listo | Bucket público, ImageUpload reutilizable |
| Snapshot de marca/modelo/sku/image_url en quotation_items | ✅ Listo | Los 5 INSERTs copian, backfill ejecutado |
| Propagación automática foto catálogo → PDF | ✅ Listo | Verificado end-to-end con las cotizaciones reales |

**Commits totales de la sesión: 7** (fe77032, de053fe, 5358a6d, 433167a, 117f53f, 7aef0e8, 8b4038b) — una de las sesiones más productivas del proyecto.

### 2026-04-09 (continuación nocturna — Módulo de Obras: infraestructura + Commit 1)

Sesión grande dedicada al módulo de Obras (la deuda técnica #1 del proyecto). Se ejecutó la migración SQL completa y el primer commit del refactor del frontend.

#### Migración SQL ejecutada en Supabase

8 tablas nuevas, 8 enums nuevos, columnas extras a `employees` y `quotations`, y un bucket nuevo de Storage:

**Tablas nuevas:**
- `obras` — datos principales con FK a `clientes`, `quotations`, `projects`, `employees` (coordinador)
- `obra_instaladores` — pivote M:N entre obras y employees con role 'instalador'
- `obra_actividades` — actividades por obra con estado, instalador asignado, % avance, origen ('manual'|'cotizacion'|'ai_reporte'|'adendum')
- `obra_reportes` — reportes diarios con fotos en Storage, campos `ai_*` para procesamiento, `procesado` boolean y `procesamiento_error` text
- `obra_entrega_docs` — checklist de documentos de entrega
- `obra_bloqueos` — mini sistema de tickets de bloqueos con tipo, severidad, status, asignación, escalación al residente
- `obra_extras` — bandeja del coordinador para extras detectados por AI; soporta selección múltiple y agrupación en cotización adendum
- `obra_documentos` — links a Drive (planos, fichas técnicas, etc), pertenecen al `project_id` y se consumen desde la obra ligada

**Enums nuevos:** `obra_status`, `actividad_status`, `bloqueo_tipo`, `bloqueo_severidad`, `bloqueo_status`, `doc_tipo`, `extra_tipo`, `extra_status`

**Columnas nuevas en `employees`:** `disponible boolean`, `foto_url text`, `calificacion numeric(2,1)`. **NO se creó tabla `instaladores` separada** — los instaladores son `employees` con `role='instalador'`. Los coordinadores son `employees` con `role IN ('coordinador','dg')`. Esto integra obras con el futuro módulo de RH/payroll.

**Columnas nuevas en `quotations`:** `parent_obra_id uuid REFERENCES obras(id)`, `tipo_cotizacion text` (`'original'|'adendum'|'revision'`). Permite que las cotizaciones adendum generadas desde la bandeja de extras estén ligadas a su obra padre.

**Bucket nuevo en Storage:** `obra-evidencias` (privado, 10 MB max, imágenes). Para fotos de reportes diarios. Privado con anon-RLS porque las fotos son sensibles (interiores de propiedades de cliente, caras de empleados).

**Columnas que el SQL agregó al diseño durante la conversación:**
- `obras.margen_acordado numeric(5,2) DEFAULT 33.00` — % default para cotizaciones adendum (consistente con DEFAULT_RULE del cotizador ESP)
- `obra_extras.match_confianza numeric(3,2)` — para que la AI auto-asigne `catalog_product_id` solo si confianza > 0.8
- `obra_extras.precio_estimado` + `obra_extras.moneda` — soporte para pricing inicial sugerido por AI o coordinador
- `obra_actividades.origen` — distingue actividades manuales vs detectadas por AI vs heredadas de cotización vs adendum

#### Decisiones de negocio importantes registradas

**Bloqueos como mini-tickets, no como campo simple.** El campo `bloqueo: text` del módulo viejo se reemplazó por la tabla `obra_bloqueos` con tipo, severidad, asignación a coordinador, flag `notificado_residente`, y notas de resolución. Permite escalación y KPIs futuros (tiempo medio de resolución por tipo).

**Documentación técnica vive en Drive, no en Storage de Supabase.** Los planos y fichas técnicas son archivos grandes (5-50 MB cada uno, sets de 30-80 docs por obra). Se decidió que solo metadatos + links a Drive viven en `obra_documentos`. El equipo de ingeniería sigue trabajando en Drive nativo y solo agrega los docs "finales" como links al ERP. Beneficios: no infla la BD, no duplica trabajo de versionado, respeta los permisos de Drive ya configurados, mantiene Drive como source of truth.

**Tab Documentación: gestión en Proyectos, vista en Obras.** Los ingenieros suben los links desde el módulo Proyectos (CRUD completo). En cada Obra el tab solo muestra los documentos del proyecto ligado vía `obra.project_id`. Sin duplicación.

**Procesamiento de reportes con AI — Nivel 2 (recomendación adoptada).** Decisión clave de negocio:
- La AI detecta actividad/material extra en reportes y los registra en `obra_extras` con `status='pendiente_revision'`. **Nada llega al cliente sin revisión humana del coordinador.**
- Para actividades extras: se crea `obra_actividades` nueva con `origen='ai_reporte'`, marcada como pendiente de revisión.
- Para materiales extras: se crea `obra_bloqueos` con tipo `falta_material`, severidad según contexto.
- El coordinador en su bandeja decide: aprobar interno (lo absorbe OMM), cotizar al cliente (genera adendum), rechazar (falsa alarma), o absorber arquitecto.
- **Nivel 3 (auto-cotización al cliente sin revisión) descartado** por riesgo legal/comercial.

**Bandeja de extras como herramienta de trabajo activa:**
- Vista solo dentro de cada obra (no global). Las alertas sí son transversales (badge en sidebar).
- Coordinador selecciona items con checkbox y click "Generar cotización adendum"
- Se crea `quotation` nueva con `tipo_cotizacion='adendum'`, `parent_obra_id=obra.id`, prellenada con los items seleccionados
- Margen heredado de `obra.margen_acordado`. Excepción: items de servicio puro (instalación de equipo dado por cliente) se cotizan con precio manual.
- **Auto-procesamiento siempre**: cada vez que se guarda un reporte, se dispara el Edge Function automáticamente
- **Escalación a 7 días**: extras `pendiente_revision` con `detectado_at < now() - 7 days` se promueven a severidad crítica con alerta máxima

#### Commit 1 del refactor — Capa base

Refactor de la página `Obra.tsx` para que use las tablas reales en vez de `MOCK_OBRAS` y `MOCK_INSTALADORES`. Estrategia: minimizar el blast radius en este commit para no romper subviews que aún usan datos en memoria. Las subtablas (actividades, reportes, entrega_docs, extras, bloqueos) siguen como mocks por ahora — Commit 2 las refactoriza.

**Cambios en `src/pages/Obra.tsx`:**

- **Eliminadas constantes `MOCK_OBRAS` y `MOCK_INSTALADORES`** (~70 líneas de datos demo)
- **Helpers nuevos `rowToInstalador` y `rowToObra`** que mapean rows de Supabase a los tipos `Instalador` y `ObraData` del frontend, manteniendo compat con todos los Sub* downstream
- **Carga inicial real**: `useEffect` con `Promise.all` que jala obras de `obras` table + employees activos. Filtra por role para separar instaladores (`role='instalador'`) de coordinadores (`role IN ('coordinador','dg')`)
- **Manejo de errores con banner visible**: estados `loading` y `loadError`. Si falla la carga, banner rojo arriba de los KPIs
- **Helper async `crearObraEnDB`**: persiste a Supabase con manejo completo de error (try/catch + return tipado `{ok:true,obra}|{ok:false,error}`). Resuelve `project_id` automáticamente si la obra se crea desde una cotización (lookup en `quotations.project_id`).
- **Helper async `crearInstaladorEnDB`**: persiste a `employees` con `role='instalador'`. Mapea el `nivel` del frontend (`senior/medio/junior`) al enum `user_level` de Supabase (`oro/plata/bronce`).
- **`NuevaObraModal` refactorizado**: ahora recibe `coordinadores` array como prop, `onSubmit` (helper async) y `onCreated` (callback). El campo coordinador pasó de input text libre a `<select>` que jala de la lista real de employees. Banner de error visible dentro del modal antes de los botones. Estado `saving` para deshabilitar botón.
- **`NuevoInstaladorModal` refactorizado**: misma estructura. `onSubmit` async, banner de error, estado `saving`.

**Patrón canónico de error handling reforzado en este commit** — sigue exactamente el patrón documentado en este CLAUDE.md sección "Manejo de errores en operaciones de Supabase":
- Helpers retornan `{ok:true, ...} | {ok:false, error:string}` discriminated union
- Modales setean `saveError` y muestran banner antes de los botones
- `disabled={saving}` en el botón primary
- Try/catch envuelve toda la operación

**Lo que NO se tocó en Commit 1 (queda para Commit 2):**
- `SubActividades` — sigue usando `obra.actividades` en memoria
- `SubReportes` — sigue usando `obra.reportes` en memoria
- `SubEntrega` — sigue usando `obra.entrega_docs` en memoria
- `SubEquipo` — sigue manejando `instaladores_ids` en memoria
- `SubMateriales` — ya estaba conectado a Supabase desde antes, sin cambios
- Tab `Planeacion` — sigue usando AI con datos en memoria
- Sub-tabs nuevos: Bandeja de Extras, Documentación, Bloqueos — no existen aún

**`tsc --noEmit` pasó al primer intento.** Sin errores de tipos.

#### Pendiente para Commit 2 (próximo en esta sesión)
- SubActividades persiste a `obra_actividades`
- SubReportes persiste a `obra_reportes` con upload de fotos al bucket `obra-evidencias`
- SubEntrega persiste a `obra_entrega_docs`
- Sub-tab nuevo Bloqueos
- Tab nuevo Documentación (vista solo lectura con jala automático del proyecto)

#### Pendiente para Commit 3 (próximo en esta sesión)
- Bandeja de Extras dentro de cada obra
- Botón "Generar cotización adendum" desde extras seleccionados
- Edge Function `/api/process-obra-report.ts` con Claude para procesamiento real
- Auto-procesamiento al guardar reporte
- CRUD de Documentación en `Proyectos.tsx`
- Sidebar/Layout: badge de alertas transversales

#### Commit 2 del refactor — Subtablas persistentes + sub-tabs nuevos

`577ec75` · feat(obras): subtablas persistentes + sub-tabs nuevos · `src/pages/Obra.tsx`, `api/process-obra-report.ts` (nuevo)

Refactor completo de `ObraDetail` y todos los `Sub*` para que persistan a Supabase, más 3 sub-tabs nuevos (Bloqueos, Extras, Documentación) y el Edge Function de procesamiento de reportes con AI.

**`ObraDetail` hidratación:**
- `useEffect` con `Promise.all` que carga al abrir cualquier obra: `obra_actividades`, `obra_reportes`, `obra_entrega_docs`, `obra_instaladores` (pivote)
- Los datos reemplazan las props en memoria vía `updateObra`, así los Sub* existentes siguen funcionando sin cambios en su código de lectura
- Banner `syncError` si la hidratación falla
- Estado `hydrated` con `Loading` mientras carga

**`SubActividades` — persistencia completa:**
- `addActividad` hace `INSERT` a `obra_actividades` con `origen='manual'` y usa el `id` devuelto por la BD (no `'a' + Date.now()` como antes)
- `updateActividad` hace `UPDATE` con optimistic update, mapea los campos del frontend a las columnas reales (`laborCost→installation_cost`, etc.). También actualiza `obras.avance_global` en cascada.
- El bulk del autogenerar-con-AI pasa por `insert(payloads).select()` con `origen='cotizacion'`, recibe los IDs reales y los mapea

**`SubReportes` — fotos en Storage + procesamiento AI real:**
- Las fotos **ya no son base64**. `handlePhotoUpload` sube cada archivo al bucket `obra-evidencias` con path `{obra_id}/{timestamp}-{random}.{ext}` y guarda las URLs públicas en el state
- `submitReporte` hace dos pasos: (1) inserta el reporte con `procesado=false` en `obra_reportes`, (2) llama al Edge Function `/api/process-obra-report` que procesa con Claude y actualiza el mismo reporte con los campos `ai_*`
- Si el Edge Function falla, el reporte queda con `procesamiento_error` + `procesado=false` — el coordinador puede reintentar manualmente después
- Eliminada la llamada directa a `api.anthropic.com` que había antes (eso era un anti-patrón: exponía la API key del cliente)

**`SubEntrega` — checklist persistente:**
- `toggleDoc` hace upsert por `(obra_id, nombre)`: busca si existe el doc en `obra_entrega_docs`, si sí lo actualiza, si no lo inserta con `order_index=idx`
- Al marcar todos + click en "Iniciar ejecución", actualiza `obras.status='en_ejecucion'`

**`SubEquipo` — asignación persistente:**
- `addInstalador` inserta a `obra_instaladores` (pivote M:N)
- `removeInstalador` hace `DELETE` con filtros `obra_id + employee_id`

**Nuevo `SubBloqueos`:**
- Sub-componente completo con CRUD de `obra_bloqueos`
- Carga inicial con `useEffect`
- Modal nuevo para crear bloqueo con: tipo (falta_material/falta_acceso/cliente/diseno/clima/otro), severidad (baja/media/alta/critica), descripción, asignación a empleado
- Cada bloqueo abierto muestra severidad con color, fecha, toggle "Residente notificado", botón "Resolver" con prompt de notas
- Sección aparte de resueltos con opacidad reducida

**Nuevo `SubExtras` — la bandeja del coordinador:**
- Lista todos los `obra_extras` de la obra, separados en "Pendientes" y "Revisados"
- Cada extra muestra: checkbox de selección, tipo (actividad/material/cambio_scope), sistema, cantidad/unidad, descripción, el `texto_original` del reporte que lo detectó, precio estimado si hay, badge de confianza de match si es > 0.8
- **Alerta de escalación visual:** extras con `detectado_at` > 7 días aparecen con borde `#C026D3` (crítico) y badge `⚠ Xd` — consistente con la regla de negocio documentada
- Acciones por extra: "Aprobar interno", "Rechazar"
- Acción agregada sobre seleccionados: **"Generar cotización adendum"** — botón que solo aparece cuando hay items seleccionados. Al hacer click:
  1. Crea un `quotations` nuevo con `tipo_cotizacion='adendum'`, `parent_obra_id=obra.id`, `specialty='esp'`, `stage='oportunidad'`, `name='Adendum: ...'`
  2. Crea una `quotation_areas` llamada "Extras detectados"
  3. Por cada extra seleccionado, inserta un `quotation_items` con precio + descripción + sistema. Tipo `labor` para actividades, `material` para lo demás.
  4. Actualiza cada `obra_extras` con `status='cotizado'`, `cotizacion_adendum_id`, `quotation_item_id`
  5. Actualiza el `total` de la cotización
  6. Muestra alert de confirmación y limpia selección

**Nuevo `SubDocumentacion`:**
- Vista solo lectura de `obra_documentos`
- Lógica de resolución: primero consulta `obra.cotizacion_id → quotations.project_id` para obtener el proyecto ligado, luego hace dos queries en `Promise.all`: `obra_documentos WHERE project_id = X` + `obra_documentos WHERE obra_id = obra.id`, y deduplica por id
- Filtros por tipo (plano/ficha técnica/diagrama/render/memoria cálculo/manual) y por sistema
- Cards con thumbnail opcional + badges + link que abre Drive en pestaña nueva
- Mensaje explícito "Para agregar documentos, ve al módulo de Proyectos" porque la gestión es allí

**Nuevo Edge Function `api/process-obra-report.ts`:**
- Recibe `{reporte_id, obra_id, obra_nombre, obra_sistemas, texto, fotos}`
- Llama a Claude con un system prompt específico que distingue 4 categorías de información: avances, faltantes, bloqueos, y **extras** (la categoría clave de negocio)
- El prompt tiene reglas explícitas para la detección de extras: palabras clave ("el residente pidió", "adicional", etc.), distinción entre faltante (error de cálculo) vs extra (scope creep), cómo clasificar tipo (actividad/material/cambio_scope)
- Persistencia automática:
  1. Actualiza el `obra_reportes` con `ai_resumen`, `ai_avances`, `ai_faltantes`, `ai_bloqueos`, `procesado=true`
  2. Por cada extra detectado, inserta a `obra_extras` con `status='pendiente_revision'`, `detectado_por='ai'`, respetando `match_confianza`
  3. Por cada bloqueo detectado, inserta a `obra_bloqueos` con `tipo='otro'` y `severidad='media'` (el coordinador ajusta después)
- Manejo de errores: si Claude falla, escribe `procesamiento_error` en el reporte
- Usa `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` del server-side env. Las policies RLS del ERP están abiertas con anon, así que funciona.
- Nota: en esta versión v1, las fotos NO se envían a Claude (aunque el parámetro las recibe). Se envía solo el texto. Para análisis visual de fotos, v2 debe fetchearlas desde Storage, convertirlas a base64, y mandarlas como content blocks de imagen.

#### Commit 3 del refactor — CRUD de Documentación en Proyectos

`(pendiente commit)` · feat(proyectos): tab Documentación técnica con CRUD de obra_documentos · `src/pages/Proyectos.tsx`

- `ProjectDetail` ahora tiene dos tabs: "Entregables por fase" (el existente) y "Documentación técnica" (nuevo)
- Componente nuevo `ProjectDocumentosTab` con CRUD completo:
  - Carga documentos con `project_id = project.id` (el ID del mock funciona consistente entre sesiones)
  - Modal para agregar documento nuevo con: nombre, tipo, sistema, URL de Drive, URL de thumbnail opcional, versión, notas
  - Validación: nombre y URL obligatorios, URL debe empezar con http
  - Grid de cards con thumbnail + badges + link que abre Drive en pestaña nueva
  - Botón de eliminar por card (solo borra el link en el ERP, el archivo en Drive permanece)
- El flujo operativo queda completo: ingeniero sube doc a Drive → entra a Proyectos → tab Documentación → pega link → guarda. Luego en cada obra ligada al proyecto, el tab Documentación del lado de Obras muestra los docs automáticamente solo lectura.

**Deuda técnica relacionada pendiente:** `Proyectos.tsx` sigue usando `INITIAL_PROJECTS` mock como fuente de proyectos. Los documentos técnicos ya son reales (persisten en Supabase), pero el proyecto padre sigue en memoria. Cuando se haga la migración de `Proyectos.tsx` a Supabase, los documentos seguirán funcionando porque los `project_id` son strings consistentes — solo hay que mantener esos IDs al crear la tabla `projects` real (probablemente insertando los mismos IDs del mock como fila inicial).

#### Lo que NO se hizo en esta sesión (queda pendiente)

- **Sidebar con badge de alertas transversales**: requiere tocar el layout global. Opté por no hacerlo para cerrar limpio. Es ~50 líneas más + query agregada que cuenta `obra_extras WHERE status='pendiente_revision'` y `obra_bloqueos WHERE status='abierto' AND severidad IN ('alta','critica')` en todas las obras.
- **Variables de entorno en Vercel**: hay que verificar que `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `ANTHROPIC_KEY` estén configuradas en el server-side de Vercel para que el Edge Function `/api/process-obra-report` funcione. Si no, los reportes se guardan pero el procesamiento AI falla silenciosamente.
- **Smoke test de generación de adendum**: la lógica está, pero no se ha probado end-to-end con una obra real y extras reales. La primera vez que Elias lo use, probablemente haya que ajustar detalles del mapeo quotation_items.
- **Migración de Proyectos.tsx a Supabase**: mencionado arriba. Los documentos técnicos ya usan Supabase pero los proyectos padre siguen mock.
- **Análisis visual de fotos en el Edge Function**: v1 solo manda texto del reporte a Claude. Las fotos se suben a Storage pero no se analizan. Para v2: fetchear las URLs, convertir a base64, mandar como content blocks de imagen.

#### Notas operativas para arrancar a usar el módulo

1. **Dar de alta empleados primero.** Antes de crear obras, ve al módulo Obras → tab "Equipo de instalación" → "Nuevo instalador". El modal guarda a `employees` con `role='instalador'`. Para coordinadores, hay que dar de alta directo en Supabase por ahora (hasta que haya una pantalla de RH), con `role='coordinador'` o `role='dg'`.
2. **El dropdown de coordinador en "Nueva obra"** jala todos los employees con role `coordinador` o `dg` que estén `is_active`.
3. **Los reportes se procesan con AI automáticamente** al guardarlos, siempre que Vercel tenga `ANTHROPIC_KEY` configurada.
4. **La bandeja de extras solo se llena desde el AI** en esta v1. Si quieres agregar extras manualmente (sin un reporte que los dispare), hay que hacerlo directo en Supabase por ahora. Flag para Commit siguiente: botón "Agregar extra manual" en SubExtras.
5. **Generación de adendum** crea una cotización nueva que vas a ver en el módulo Cotizaciones con el badge `tipo_cotizacion='adendum'`. Puedes abrirla desde Cotizaciones y ajustar precios como cualquier otra.

### Sesión Proyectos — Refactor completo a Supabase con modelo unificado por especialidad

**Commits de esta sesión:**
- `31eb2cb` · feat(obras): agregar sistemas faltantes Humo/BMS/Telefonia/Celular/Persianas
- `8415f02` · feat(proyectos): SQL migration — tablas, enums, 18 fases template, 41 tareas template
- `39326ec` · feat(proyectos): refactor completo a Supabase con modelo unificado

**Problema que resolvió:** `Proyectos.tsx` era 100% mock data (`INITIAL_PROJECTS` hardcodeado con 5 proyectos). La tabla `projects` ya existía en Supabase y era usada por Cotizaciones/Compras/Dashboard, pero Proyectos la ignoraba. Además, los 3 equipos de diseño (Alfredo ESP / Juan Pablo ILU / Ricardo ELEC) tenían workflows completamente distintos que el mock forzaba al modelo ESP con sub-especialidades — razón por la cual Juan Pablo y Ricardo nunca usaron el ERP y hacían su seguimiento en herramientas externas.

**Decisión arquitectónica clave: modelo unificado con templates por especialidad.** Todas las especialidades comparten la misma estructura de datos (`project_phases` + `project_tasks` + `project_task_subtasks`), pero cada una tiene su propio **catálogo de templates** (`project_phase_templates` + `project_task_templates`) que define sus fases y tareas default. Al crear un proyecto, se instancian los templates de su especialidad. Las **3 fases de postventa** (Suministro, Seguimiento de Obra, Cierre) son **universales** para los 3 equipos y se agregan a todos los proyectos con `is_unlocked=false` hasta que una cotización ligada al proyecto pasa a `stage='contrato'`, momento en que se desbloquean automáticamente.

**Otra decisión crítica: un proyecto = una especialidad.** Aunque el schema de `projects` tiene `lines: text[]` (array), en la práctica siempre se usa con un solo elemento + se agregó columna `specialty` singular para queries más limpias. Un proyecto multi-línea (ej. "Reforma 222 ESP+ILU+ELEC") se modela como 3 proyectos separados con el mismo nombre base, porque los workflows son tan distintos que forzarlos en uno solo era inmanejable.

**Tercera decisión: ESP plano con tag de sistema (Opción B).** El modelo viejo tenía "deliverables con sub-especialidades anidadas" (cada entregable de ESP se expandía en CCTV/Audio/Redes/etc. como sub-tareas), generando 30-50 checkboxes por proyecto. Lo eliminamos. Ahora los sistemas son un **tag por tarea** — cuando el proyecto es ESP aparece una columna adicional "Sistema" en la tabla donde asignas el sistema a cada tarea. Para ILU/ELEC esa columna no aparece porque no aplica.

#### SQL Migration — archivo `supabase_proyectos_migration.sql` en el repo

**3 columnas nuevas en `projects`:**
- `specialty TEXT CHECK IN ('esp','elec','ilum','cort','proy')`
- `area_lead_id UUID REFERENCES employees(id)` — líder del proyecto
- `cotizacion_id UUID REFERENCES quotations(id)` — cotización principal ligada (para detectar contrato)
- Backfill: `UPDATE projects SET specialty = lines[1]` para proyectos existentes

**5 tablas nuevas:**
1. `project_phase_templates` — catálogo de fases por especialidad. Columnas: `specialty` (esp/ilum/elec/cort/proy/**postventa**), `name`, `order_index`, `is_post_sale`, `activation_rule` (`'always'` o `'on_contract'`)
2. `project_task_templates` — catálogo de tareas por fase. FK a `phase_template_id`, con `default_subtasks TEXT[]` que lista los checks pre-poblados
3. `project_phases` — instancias por proyecto. FK a `project_id` y `template_id`. Campos `is_post_sale`, `is_unlocked` (false por default en postventa), `unlocked_at`
4. `project_tasks` — tareas planas con `assignee_id`, `status` (pendiente/en_progreso/bloqueada/completada), `priority` (0-3), `progress` (0-100), `due_date`, `system` (nullable, solo ESP usa), `area` (sub-área del proyecto), `notes`
5. `project_task_subtasks` — checklist por tarea con `text` y `completed`

**Seed data — 18 fases template y 41 tareas template:**
- **ESP** (5 fases, 10 tareas): Conceptual (3: Definición sistemas/Sembrado conceptual/Diseños conceptuales con 17 subtareas), Revisión Interna (1: Cotización), Revisión con Cliente (1: Entrega conceptual), Diseño Ejecutivo (4: Especificación/Sembrado ejecutivo/Memoria técnica/Carpeta fichas), Revisión Final (1: Entrega ejecutivo)
- **ILU** (6 fases, 12 tareas — exactas del workflow de Juan Pablo): Conceptual (2: Presentación/Sembrado de iluminación), Revisión (1: Entrega conceptual), Diseño (1: Sembrado de control), Revisión 2 (1: Entrega de diseño), Ejecutivo (5: Sembrado BV/Plano colocación/Carpeta fichas técnicas/Propuesta decorativas/Cotización luminarias), Revisión 3 (2: Entrega Ejecutiva/Entrega física)
- **ELEC** (4 fases, 10 tareas — exactas del workflow de Ricardo): Arranque de Proyecto (2: Recopilación planos/Plano referencia+base+tabla cálculos), Diseño de Instalaciones (6: Eléctrica Iluminación/Eléctrica Contactos/HVAC/Subestación MT-BT/Fotovoltaico/Emergencia), Revisión con Cliente (1: Revisión de planos), Entrega de Proyecto Ejecutivo (1: Entrega de planos)
- **POSTVENTA** universal (3 fases, 9 tareas): Suministro (2: Órdenes de Compra/Entregas a Obra), Seguimiento de Obra (3: Visitas de Obra/Seguimiento de Cambios y Adendums/Reporte de Avance), Cierre (4: Entrega Formal/As-Built/Pruebas y Certificación/Liberación de Pagos Finales)

**RLS abierto con anon** (consistente con resto del ERP). Índices en `project_id`, `phase_id`, `assignee_id`, `status`, `due_date`.

**Cómo se ejecutó la migration:** desde la herramienta Claude in Chrome, fetch del raw de GitHub directamente al Monaco editor de Supabase SQL Editor, Cmd+Enter, confirmación del warning "destructive operations" (por los `DROP POLICY` y `DELETE FROM`). Verificación final con query que devuelve count de cada tabla: 18 phase_templates, 41 task_templates, 0 project_phases (vacía hasta crear proyectos), 0 project_tasks, 0 project_task_subtasks, 1 projects con specialty (el backfill).

#### Refactor completo de `Proyectos.tsx` (~1270 líneas)

El rewrite eliminó `INITIAL_PROJECTS` y reemplazó con carga real desde Supabase. 6 componentes principales:

**1. `Proyectos` (main export):**
- `useEffect` con `Promise.all` de 4 queries paralelas al montar: `projects`, `employees` (activos), `project_phases` (todas), `project_tasks` (solo columnas mínimas para calcular progreso)
- Manejo de `loadError` con banner rojo visible
- `useMemo` para `stats`: itera sobre las phases+tasks cargadas en memoria para calcular avance promedio, proyectos activos, tareas vencidas
- Tabs de especialidad (TODAS/ESP/ILU/ELEC) con contador por cada una
- 4 KpiBoxes
- Filtro secundario de status (todos/activo/pausado/completado)
- Grid de `ProjectCard` o `EmptyState` si está vacío

**2. `ProjectCard`:**
- Recibe `phases` y `tasks` del proyecto específico ya filtradas desde el parent
- Calcula avance con `calcProjectProgress` (ignora fases bloqueadas y post-sale para el % visible)
- Badge de especialidad a la izquierda del nombre
- Muestra fase activa con `getActivePhase` (la primera no-100% de las desbloqueadas)
- Si tiene postventa activa, badge verde pequeño "● Postventa"

**3. `ProjectDetail`:**
- `hydrate` async con `Promise.all` de phases + tasks, luego `in(task_ids)` para subtasks
- Verifica cotización ligada: prioriza `project.cotizacion_id`, fallback a buscar en `quotations WHERE project_id = ...`
- `useEffect` separado que detecta `hasContractedQuote === true` + fases postventa bloqueadas → llama a `unlockPostSale` que hace `update({is_unlocked: true}).in('id', lockedIds)`
- Tabs: Tareas por fase / Documentación técnica
- Header con badge de especialidad, nombre, líder del área, progreso total, status

**4. `PhaseTimeline`:**
- Render horizontal de todas las fases ordenadas
- Fases desbloqueadas en color (verde si 100%, azul si >0%, gris si 0%)
- Fases bloqueadas con icono de candado, opacidad 0.6, fondo gris oscuro
- Badge % en cada fase desbloqueada
- Mensaje informativo abajo si hay fases postventa bloqueadas: "Las fases de postventa se activan automáticamente cuando una cotización ligada al proyecto pasa a 'contrato'"

**5. `TaskTable` (vista plana estilo Juan Pablo/Ricardo):**
- Agrupa tareas por fase. Cada grupo tiene header con nombre de la fase + contador de tareas + % avance + botón "+ Tarea"
- Fases bloqueadas aparecen con opacity 0.5 y no permiten crear tareas
- Cada fila de tarea: ChevronDown para expandir, nombre + badge AlertCircle si está vencida, contador de subtareas, fecha límite, dropdown de sistema (**solo ESP**), dropdown de asignado, 3 estrellas de prioridad, barra de progreso + %, dropdown de status, botón delete
- Expand muestra: input de fecha límite + lista de subtareas con checkbox (toggle actualiza progress de la tarea automáticamente y status en cascada) + delete por subtarea + input inline para agregar nueva con Enter
- Crear nueva tarea con formulario inline de 5 columnas en el header de la fase
- Todos los cambios (status, asignee, priority, due_date, system) hacen update inmediato a Supabase vía `supabase.from('project_tasks').update(...)`
- Subtask toggle recalcula progress = (done/total*100) y ajusta status automáticamente: pendiente si 0%, en_progreso si 1-99%, completada si 100%

**6. `NewProjectModal`:**
- Campos: nombre, cliente, especialidad (botones visuales ESP/ILU/ELEC con nombre del líder), líder del proyecto (opcional, dropdown de employees), cotización ligada (opcional, filtrada por especialidad)
- Al crear: ejecuta 4-5 queries secuenciales:
  1. Insert en `projects` con `specialty` + `lines: [specialty]` + `area_lead_id` + `cotizacion_id`
  2. Fetch `project_phase_templates` WHERE specialty IN (seleccionada, 'postventa')
  3. Insert bulk en `project_phases` mapeando cada template → fase del proyecto con `is_unlocked = !is_post_sale`
  4. Fetch `project_task_templates` WHERE phase_template_id IN (templates cargados)
  5. Insert bulk en `project_tasks` mapeando cada template a la fase recién creada (vía template_id)
  6. Insert bulk en `project_task_subtasks` con los `default_subtasks` de cada template

**7. `ProjectDocumentosTab`:**
- Heredado del commit anterior, sin cambios funcionales. CRUD de `obra_documentos` filtrado por `project_id`.

**Helpers de cálculo:**
- `calcPhaseProgress(tasks)`: promedio del `progress` de las tareas de esa fase
- `calcProjectProgress(phases, tasks)`: promedio de las fases **desbloqueadas y no post-sale** (para no contar las fases bloqueadas en el 0%)
- `getActivePhase(phases, tasks)`: la primera fase desbloqueada con progress < 100%

**Decisiones de diseño:**
- **Sin migración del mock viejo.** Los 5 proyectos de `INITIAL_PROJECTS` (Oasis 6, Reforma 222, etc.) no se preservan. Empiezas con base limpia y creas los reales con el modal.
- **Retrocompatibilidad con Cotizaciones/Compras**: como `lines` sigue existiendo como array, los módulos que la usan (Cotizaciones con `eq('status', 'activo')`, Compras con `order('name')`) siguen funcionando sin cambios.
- **Sin botón manual de activación de postventa**: el trigger es automático vía `useEffect` al detectar `hasContractedQuote`. Si en el futuro hay edge cases (ej. activación forzada sin contrato), se puede agregar un botón manual.
- **`system` en ESP es editable post-creación**: las tareas template se crean sin sistema asignado, el usuario elige cuál sistema le corresponde a cada tarea desde la UI con el dropdown.

#### Smoke test funcional

Verificado en producción con captura de screenshot:
- ✅ `/proyectos` renderiza sin errores
- ✅ KPIs cargados con datos reales (2 proyectos activos)
- ✅ 2 proyectos visibles: "Reforma 222" (ILU) y "Oasis" (ESP — el que había existido antes del rewrite)
- ✅ Click en "Reforma 222" abre ProjectDetail con:
  - Header correcto: badge ILU, título, "Niz+Chauvet · Creado 9 abr 2026 · Líder: Juan Pablo"
  - 9 fases en la timeline: **las 6 de ILU activas** (Conceptual/Revisión/Diseño/Revisión 2/Ejecutivo/Revisión 3) + **3 postventa con candado** (Suministro/Seguimiento de Obra/Cierre)
  - Banner informativo de postventa visible
  - Tabs funcionando
  - TaskTable con las 12 tareas template instanciadas correctamente, agrupadas por fase:
    - Conceptual (2): Presentación + Sembrado de iluminación
    - Revisión (1): Entrega conceptual
    - Diseño (1): Sembrado de control
    - Revisión 2, Ejecutivo, Revisión 3 también presentes con sus respectivas tareas
  - Cada tarea muestra contador de subtareas ("0/3", "0/2"), dropdowns de sistema/asignado/estado, 3 estrellas de prioridad, barra de progreso

**El proyecto "Oasis" mostraba "Sin fases"** porque fue creado ANTES del refactor (desde el módulo Cotizaciones que llama a `supabase.from('projects').insert(...)` sin instanciar templates). Es el comportamiento esperado — solo los proyectos creados con el nuevo modal de Proyectos tienen fases/tareas auto-instanciadas. Para "curar" proyectos pre-existentes habría que agregar un botón "Inicializar fases" que ejecute la lógica del modal sobre un projecto existente — futura sesión si es necesario.

#### Pendientes para futuras sesiones

- **Botón "Inicializar fases" para proyectos pre-existentes** sin fases (como "Oasis")
- **CORT y PROY**: las 2 especialidades faltantes. Necesitan brain-dump de entregables de los equipos responsables antes de definir sus templates.
- **Editor de templates desde UI**: el botón "Templates" existía en el mock pero no estaba conectado. Ahora con datos reales, se puede construir una pantalla que permita editar `project_phase_templates` y `project_task_templates` desde la UI en vez de SQL.
- **Integración con el cotizador**: cuando una cotización ESP/ILU/ELEC se crea desde Cotizaciones, debería opcionalmente crear también un proyecto ligado (con un checkbox en el modal de Cotizaciones "Crear proyecto en Proyectos"). Hoy tienes que crear las 2 cosas por separado.
- **Drag & drop de tareas entre fases** (estilo kanban). Útil para el workflow original de Juan Pablo donde "movía" una tarea de fase en fase.
- **Filtro/vista por asignado**: mostrar "mis tareas" filtrando por `assignee_id = usuario_actual`. Requiere saber quién es el usuario, que hoy no está implementado.
- **Notificaciones de tareas vencidas**: el KPI ya las cuenta, pero no hay alertas. Podría ser un badge en el sidebar.

### 2026-04-10 (sesión larga — Proyectos refactor v2: modelo con tareas multi-fase + flujo Lead obligatorio + PhaseTimeline grande)

**Commits de esta sesión:**
- `ab7af90` · feat(proyectos): SQL migration 2.0 — modelo unificado con tareas multi-fase
- `72961fd` · feat(proyectos): NewProjectModal con flujo Lead→Cotización→Especialidad + instanciación multi-fase
- `1d0c751` · feat(proyectos): PhaseTimeline grande estilo mock con círculos conectados

**Contexto:** después de la sesión anterior (commits `8415f02` + `39326ec` que crearon la v1 del refactor), Elias revisó el resultado en producción y rechazó dos cosas:

1. **La vista ESP perdía seguimiento granular**: el modelo "ESP plano con tag de sistema" (Opción B de la sesión anterior) no permitía ver "el sembrado ejecutivo de CCTV está al 100% pero el de Audio va al 40%" en un solo vistazo. Él necesitaba ver los sistemas **como sub-cards dentro de cada entregable transversal**, agrupados por sistema, cada uno con su propio checklist.
2. **El modal "Nuevo proyecto" pedía nombre y cliente a mano**: en la operación real, los proyectos siempre nacen de un Lead y su Cotización. El modal debía forzar ese flujo: sin lead no hay proyecto.

**Y introdujo un concepto nuevo que no estaba en v1: tareas multi-fase.** Elias explicó que en el workflow de sus equipos, una tarea como "Sembrado de iluminación" no vive en una sola fase — arranca como boceto en Conceptual, se refina en Diseño, y termina definitivo en Ejecutivo. **Es la misma tarea evolucionando a través de fases.** Otras tareas sí viven en una sola fase (ej: "Cotización de luminarias" solo existe en Ejecutivo).

Después de 3 rondas de aclaraciones (mi primera interpretación fue "milestones reales" que era overkill, la segunda fue "una sola fase por tarea" que era demasiado estricta), llegamos al modelo final: **cada template de tarea tiene `start_phase_order` y `end_phase_order`. Al instanciar, la tarea se CLONA en cada fase del rango** (Opción Z — filas separadas en `project_tasks`, no milestones reales).

Este es el modelo ganador y reemplaza parcialmente las decisiones arquitectónicas de la sesión anterior. La decisión "ESP plano con tag de sistema" se invirtió: ahora ESP tiene subtareas agrupadas por sistema dentro de cada tarea transversal.

#### Decisiones arquitectónicas finales (v2)

**1. Fases homologadas a 5 para las 3 especialidades.** La sesión anterior tenía 5 ESP / 6 ILU / 4 ELEC. Elias dijo "homologuemos todos a ILU simplificada: Arranque, Conceptual, Diseño, Revisión, Ejecutivo". Ahora los 3 equipos comparten las mismas 5 fases pre-venta + 3 postventa universales. Total: 8 fases por proyecto.

**2. Tareas con rango `[start_phase_order, end_phase_order]`.** Si start==end, la tarea vive en una sola fase. Si start<end, se clona en cada fase del rango al instanciar. Cada instancia tiene su propio `progress`, `status`, `assignee_id`, `due_date`. El usuario las percibe como "la misma tarea en múltiples fases", pero en BD son filas independientes.

**3. ESP con subtareas agrupadas por sistema.** Algunos templates tienen `expands_by_system=true`. Al instanciar, si hay sistemas detectados en la cotización ligada, las subtareas se multiplican: **por cada sistema × cada default_subtask = N subtasks** con el campo `system` seteado. La UI las agrupa en mini-cards con el color del sistema (SYSTEM_COLORS). Si `expands_by_system=false`, son checklists planas con `system=null`.

**4. Lead obligatorio para crear proyecto.** El modal no permite crear sin lead. Nombre del proyecto auto-generado: `"{lead.name} — {specialty.label}"`, editable. Cliente auto-rellenado desde `lead.company || lead.contact_name`. Cotización opcional pero recomendada (si no hay cotización en ESP, las tareas `expands_by_system` caen al modo plano).

**5. Un proyecto = una especialidad, siempre.** Sigue igual que v1. `lines` array se llena con 1 solo elemento. `specialty` singular es la fuente de verdad.

#### Templates finales (seeds en migration 2.0)

**ESP (10 tareas, 4 multi-fase + 1 single-phase con expand_by_system):**
| Tarea | Start | End | expand_by_system |
|---|---|---|---|
| Definición de Sistemas y Alcances | Arranque | Arranque | no |
| Recopilación de Planos | Arranque | Arranque | no |
| **Sembrado** | **Conceptual** | **Ejecutivo** | **sí** |
| **Diseños (diagramas unifilares, topología, bloques)** | **Conceptual** | **Ejecutivo** | **sí** |
| Entrega Conceptual al Cliente | Revisión | Revisión | no |
| Cotización | Diseño | Diseño | no |
| **Especificación de Equipos** | **Diseño** | **Ejecutivo** | **sí** |
| **Memoria Técnica** | **Diseño** | **Ejecutivo** | **sí** |
| **Carpeta de Fichas Técnicas** | Ejecutivo | Ejecutivo | **sí** |
| Entrega Ejecutiva | Ejecutivo | Ejecutivo | no |

**ILU (11 tareas, 2 multi-fase):**
| Tarea | Start | End |
|---|---|---|
| Presentación | Arranque | Arranque |
| **Sembrado de iluminación** | **Conceptual** | **Ejecutivo** |
| Entrega conceptual | Revisión | Revisión |
| **Sembrado de control** | **Diseño** | **Ejecutivo** |
| Sembrado de Bajo Voltaje | Ejecutivo | Ejecutivo |
| Plano de colocación | Ejecutivo | Ejecutivo |
| Carpeta de Fichas técnicas | Ejecutivo | Ejecutivo |
| Propuesta de Decorativas | Ejecutivo | Ejecutivo |
| Cotización de luminarias | Ejecutivo | Ejecutivo |
| Entrega Ejecutiva | Ejecutivo | Ejecutivo |
| Entrega física | Ejecutivo | Ejecutivo |

**ELEC (10 tareas, 6 multi-fase — los diseños):**
| Tarea | Start | End |
|---|---|---|
| Recopilación de Planos de Proyecto | Arranque | Arranque |
| Plano de Referencia, Plano Base y Tabla de Cálculos | Arranque | Arranque |
| **Diseño Instalación Eléctrica de Iluminación** | **Diseño** | **Ejecutivo** |
| **Diseño Instalación Eléctrica de Contactos** | **Diseño** | **Ejecutivo** |
| **Diseño Instalación Eléctrica de HVAC** | **Diseño** | **Ejecutivo** |
| **Diseño de Subestación Eléctrica en Media / Baja Tensión** | **Diseño** | **Ejecutivo** |
| **Diseño de Sistema Fotovoltaico** | **Diseño** | **Ejecutivo** |
| **Diseño de Sistema de Emergencia** | **Diseño** | **Ejecutivo** |
| Revisión de Planos con Cliente | Revisión | Revisión |
| Entrega de Planos | Ejecutivo | Ejecutivo |

**POSTVENTA (9 tareas, universales sin multi-fase):**
- **Suministro** (100): Órdenes de Compra, Entregas a Obra
- **Seguimiento de Obra** (101): Visitas de Obra, Seguimiento de Cambios y Adendums, Reporte de Avance de Obra
- **Cierre** (102): Entrega Formal, As-Built, Pruebas y Certificación, Liberación de Pagos Finales

**Total seeds:** 18 phase templates + 40 task templates + 12 tareas multi-fase + 5 tareas con `expands_by_system`.

#### SQL Migration 2.0 (`ab7af90`)

Archivo: `supabase_proyectos_migration.sql` (reemplaza el de la v1).

**Cambios de schema respecto a v1:**
- `project_task_templates`: **DROP y recreate**. Ya no es `phase_template_id` (FK) + `phase_template tiene order_index`, ahora es `specialty` (string) + `start_phase_order INT` + `end_phase_order INT` + `expands_by_system BOOLEAN`. El template ya no está anclado a una fase única; define su rango por order_index.
- `project_task_subtasks`: **ALTER ADD COLUMN `system TEXT`**. Para agrupar subtasks por sistema en la UI de ESP.
- `projects`: **ALTER ADD COLUMN `lead_id UUID REFERENCES leads(id)`**. Obligatorio desde UI, nullable en schema para permitir edge cases futuros.

**Limpieza destructiva incluida**: la migration borra `project_task_subtasks`, `project_tasks`, `project_phases` porque el modelo cambió. Los proyectos creados con la v1 se quedan sin fases/tareas — están en la BD pero huecos. En esta sesión se borraron varios proyectos huérfanos con DELETE directo (ver más abajo).

**Ejecución:** se cargó con el patrón habitual de `fetch` del raw de GitHub + `monaco.editor.setValue()` en el SQL Editor de Supabase, luego Cmd+Return + confirmación del warning destructivo.

#### NewProjectModal rewritten (`72961fd`)

El componente `NewProjectModal` se reescribió completo (~400 líneas nuevas dentro de `Proyectos.tsx`). Flujo:

1. **Paso 1 — Lead (obligatorio)**: dropdown de `leads` activos (filtrando status `perdido` y `ganado`). Borde rojo hasta seleccionar, mensaje "⚠ Sin lead no hay proyecto". Al seleccionar, muestra preview chip con nombre + company + contact_name.
2. **Paso 2 — Cotización del lead (opcional)**: dropdown de `quotations` del lead, filtrado **parseando `quotations.notes` JSON** por `lead_id` dentro. Si el lead no tiene cotizaciones, muestra un mensaje informativo. Al seleccionar una cotización, muestra un info-box con:
   - Nombre + stage + total formateado en MXN
   - **Preview de sistemas detectados** con badges de color del sistema (Redes cyan, Audio morado, CCTV azul, etc.)
   - Texto "las tareas transversales de ESP se expandirán por sistema" si la especialidad es ESP
3. **Paso 3 — Especialidad**: 3 botones (ESP/ILU/ELEC) con ícono, label y nombre del líder (Alfredo/Juan Pablo/Ricardo). Si se eligió una cotización, el specialty se auto-ajusta al de la cotización. Cambiar manualmente el specialty regenera el nombre auto-generado.
4. **Paso 4 — Nombre del proyecto**: auto-generado como `"{lead.name} — {specialty.label}"`, editable. + dropdown de "Líder del proyecto" (opcional) con employees activos.

**Lógica de instanciación** (al hacer click en "Crear proyecto"):

```typescript
1. INSERT into projects con lead_id, cotizacion_id, specialty, client_name del lead
2. SELECT project_phase_templates WHERE specialty IN (spec, 'postventa') ORDER BY order_index
3. INSERT phases: todas con is_unlocked = !is_post_sale (postventa bloqueada)
4. SELECT project_task_templates WHERE specialty IN (spec, 'postventa')
5. Para cada template:
   FOR ord FROM start_phase_order TO end_phase_order:
     Buscar la phase de ese ord en insertedPhases
     Push a taskInserts con phase_id correspondiente
6. INSERT all tasks in one call
7. Para cada task instanciada, buscar su template:
   IF template.expands_by_system && detectedSystems.length > 0:
     FOR each system in detectedSystems:
       FOR each subText in template.default_subtasks:
         Push subtask con system=X
   ELSE:
     Push subtasks planas con system=null
8. INSERT subtasks en batches de 500
```

**Garantía de integridad**: todo el proceso está en try/catch. Si cualquier paso falla, se muestra error en el modal. El proyecto sí queda creado aunque las fases/tareas fallen — potencial bug si alguien falla a mitad, pero mejor que rollback parcial manual.

**Edge case identificado** (no arreglado en esta sesión): durante el smoke test se crearon 3 proyectos duplicados "Casa Salame — Especialidades" porque hice doble-click en "Crear proyecto" antes de que el state `saving=true` se propagara. El modal usa `disabled={!canSubmit}` donde `canSubmit = !saving && ...`, pero React puede demorar un tick en re-renderizar. **Fix sugerido**: marcar `saving=true` ANTES del primer await, no depender de que la UI se actualice instantáneamente.

#### TaskTable — agrupación por sistema en ESP (`72961fd`)

Antes: `taskSubs.map(sub => <checkbox>)` — render plano.

Ahora: IIFE que separa `subsFlat` (sin system) y `subsWithSystem` (con system). Las primeras se renderizan como antes. Las segundas se agrupan con `reduce` en `systemGroups: Record<string, SubtaskRow[]>` y se renderizan como **mini-cards con borde de color del sistema**:

```
┌─── Audio (morado) · 0/3 ─────────┐
│ ☐ Ubicación de equipos en plano   │
│ ☐ Validar cobertura               │
│ ☐ Ajustar según restricciones     │
└───────────────────────────────────┘
┌─── CCTV (azul) · 0/3 ─────────────┐
│ ...                                │
```

Cada sub-card tiene su propio contador de progreso (done/total). Los colores vienen de `SYSTEM_COLORS` al principio del archivo. El `toggleSubtask` y `deleteSubtask` siguen funcionando igual, solo cambia el rendering.

#### PhaseTimeline grande estilo mock (`1d0c751`)

Rediseño completo. Antes eran badges chiquitos en fila. Ahora es el formato que Elias pidió desde hace varios mensajes:

- **Círculos de 48px** con borde de color según estado
- **Líneas conectoras** horizontales entre círculos (verdes cuando la fase está completada, grises cuando no)
- **Íconos contextuales** dentro del círculo:
  - `<Lock>` si está bloqueada
  - `<Check>` si está al 100%
  - Número de fase (1-5 pre-venta, 1-3 post-venta) en otros casos
- **Nombre de la fase** debajo del círculo (color se resalta cuando está activa)
- **Badge de progreso** debajo: `{prog}% · {n} tareas`
- **Separación visual clara** entre pre-venta y post-venta con un divisor horizontal + label "● Post-venta activa" (verde) o "🔒 Post-venta bloqueada" (gris)
- **Click en fase** → selecciona la fase activa, filtra `TaskTable` a solo esa fase
- **Badge de filtro activo** abajo con botón X para limpiar
- Las fases bloqueadas no se pueden seleccionar (cursor: not-allowed)

`ProjectDetail` ahora mantiene `activePhaseId` en state y se lo pasa a `PhaseTimeline` y a `TaskTable`. `TaskTable` filtra `sortedPhases` con `useMemo` basado en `activePhaseId`.

#### Smoke test end-to-end (2026-04-10)

Creé un proyecto de prueba desde cero usando el modal nuevo:
- **Lead**: Casa Salame · Niz+Chauvet Arquitectos
- **Cotización**: Casa Salame - Especiales (stage `contrato`, $5,150.61 MXN)
- **Sistemas detectados en items**: Redes, Audio, CCTV
- **Especialidad**: ESP

Resultado en BD verificado via REST API:
- 8 fases creadas (5 pre-venta + 3 post-venta)
- **29 tareas** instanciadas (20 ESP + 9 postventa)
- **203 subtasks** (156 con sistema + 47 planas)
- 3 sistemas encontrados en subtasks: Redes, Audio, CCTV ✅
- Multi-fase tasks confirmadas:
  - `Sembrado` → 4 instancias (Conceptual, Diseño, Revisión, Ejecutivo) ✅
  - `Diseños` → 4 instancias ✅
  - `Especificación de Equipos` → 3 instancias (Diseño, Revisión, Ejecutivo) ✅
  - `Memoria Técnica` → 3 instancias ✅

**Validación visual en la UI**: abrí el ProjectDetail, expandí la tarea "Sembrado" en Conceptual, y confirmé que las subtareas están agrupadas en 3 mini-cards con los colores correctos de Audio (morado), CCTV (azul) y Redes (cyan). Cada card tiene su checklist de 3 default_subtasks (= 9 subs por task = 3 sistemas × 3 subtasks).

**Post-venta auto-desbloqueo confirmado**: la cotización ligada está en stage `contrato`, así que al abrir el ProjectDetail, las 3 fases de postventa se marcaron `is_unlocked=true` automáticamente.

#### Limpieza de datos en BD

Durante el refactor quedaron proyectos basura en la BD. Se borraron via REST API (`DELETE /rest/v1/projects?id=eq.X`):

| Proyecto borrado | Razón |
|---|---|
| 2× duplicados `Casa Salame — Especialidades` | Smoke test con doble-click |
| `Reforma 222 Especiales` | Huérfano pre-refactor, sin lead, sin fases |
| `Reforma 222` (ILU) | Huérfano pre-refactor |
| `Oasis` | Intento de borrar → **409 Conflict** por FK desde otra tabla (probablemente payment_milestones o purchase_orders). **Se quedó en BD**. Sirve como test case del estado "proyecto sin fases" en la UI. |

Estado final de la BD después de limpieza:
- 3 proyectos (Casa Salame, Ventanas Sacal, Oasis)
- 16 fases (2 proyectos válidos × 8)
- 58 tareas (2 × 29)
- 302 subtasks (2 × 151 aprox)

#### Verificación y conteos pre-instanciación (post-migration 2.0)

```
phase_templates:       18  (5 esp + 5 ilum + 5 elec + 3 postventa)
task_templates:        40  (10 esp + 11 ilum + 10 elec + 9 postventa)
task_templates_multi_fase:     12  (4 esp + 2 ilum + 6 elec)
task_templates_expand_by_sys:   5  (solo ESP: Sembrado, Diseños, Especificación, Memoria, Carpeta de Fichas)
```

#### Bugs/pendientes detectados en esta sesión

1. **Doble-click en "Crear proyecto" crea duplicados** (edge case reproducible). Fix: marcar `saving=true` ANTES del await, no depender del re-render.
2. **"Oasis" no se puede borrar por FK desde otra tabla** (409 Conflict). Hay que identificar qué tabla tiene la FK y o borrar la dependencia primero, o hacer la columna `ON DELETE SET NULL`.
3. **Los proyectos pre-existentes sin lead_id siguen apareciendo en la vista** (Oasis). No tienen fases, muestran "Sin fases" en la card. Habría que un botón "Inicializar fases" o filtrar de la lista por `lead_id IS NOT NULL`.
4. **El `client_name` del proyecto se llena con `lead.contact_name || lead.company || lead.name`**, pero lo ideal sería que si el lead tiene un `client_final` en su JSON notes (convención del CRM), usar ese como prioridad. Mejora menor.
5. **Duplicados de proyectos con mismo nombre no se previenen**. La BD no tiene unique constraint. Podría ser deseable: "ya existe un proyecto 'Casa Salame — Especialidades' con el mismo lead + cotización, ¿quieres continuar?".

#### Notas para futuras sesiones

- **CORT y PROY**: siguen sin templates. Si Elias pide construir proyectos de cortinas o "proyecto genérico", habrá que definir sus fases/tareas con los equipos responsables.
- **Editor de templates desde UI**: sigue pendiente de v1. Ahora con más datos reales tiene más sentido construirlo.
- **Integración con Cotizaciones**: cuando se crea una cotización desde el módulo Cotizaciones, opcionalmente crear el proyecto ligado en un solo paso. Hoy es un flujo de 2 pasos separados.
- **Botón "Inicializar fases" para proyectos pre-existentes**: necesario para curar Oasis y cualquier proyecto creado fuera del modal (por ejemplo desde Compras o Cotizaciones directamente).
- **Commit siguiente con el flujo reverso**: cuando cambie el `specialty` de una cotización, el proyecto ligado podría avisar "esta cotización ahora es ILU pero tu proyecto es ESP, ¿quieres regenerarlo?".
- **Guardar snapshot del "proyecto sin fases"** como test de regresión — cuando algún día tengamos tests automáticos, es un caso borde útil.

### (agregar siguiente sesión aquí)

---

## 📋 Plan de migración inicial (decidido 2026-04-09, no ejecutado aún)

Al cerrar la sesión del 9 de abril, Elias preguntó cómo hacer la primera carga de datos reales al ERP antes de arrancar en operaciones. La decisión fue **estrategia híbrida** — Claude carga en masa los datos estables y verificables, Elias/equipo carga manualmente los flujos vivos.

### Qué migrar y quién lo hace

| Dato | Estrategia | Razón |
|---|---|---|
| **Catálogo de productos** | Claude en bulk | Cientos/miles de SKUs. Fabricantes mandan Excels en batch. Alto valor de automatización. |
| **Clientes fiscales** | Claude en bulk | Datos duros (RFC, razón social, dirección). Cero subjetividad. |
| **Proveedores / distribuidores** | Claude en bulk | Lista cerrada y estable. |
| **Empleados** | Elias manual | Son pocos (~30), tienen matices de rol/jerarquía que deben validarse uno por uno. |
| **Leads activos** | Elias manual | Fuerza familiaridad con la UI del CRM. |
| **Primeras 3-5 cotizaciones reales** | Elias manual | Detecta bugs, incomodidades del flujo, cosas que faltan. |
| **Obras en ejecución** | Elias manual | Pocas, tienen estado vivo. Captura manual forzando el flujo real. |
| **Cotizaciones históricas pasadas** | ❌ NO migrar | Documentos cerrados, precios obsoletos, contaminan los dashboards con ruido histórico. Quedan en sus PDFs/Excels originales. |
| **Contabilidad histórica** | ❌ NO migrar | Vive en el sistema de facturación actual. Arranca del corte. |
| **Gastos/movimientos bancarios antiguos** | ❌ NO migrar | Misma lógica. Arranca en fecha de corte. |

### Principios clave de la migración

1. **La carga masiva debe ser reproducible.** Si cargamos 800 productos y después encuentras 20 errores, debe ser posible re-correr el script con una versión corregida del Excel, no parchar manualmente. Los scripts deben:
   - Leer de un archivo fuente (Excel/CSV en GitHub o Storage)
   - Ser idempotentes (correr N veces con los mismos datos → mismo resultado)
   - Tener dry-run ("te muestro qué haría antes de hacerlo")
   - Loggear qué se insertó, qué se actualizó, qué falló

2. **Fecha de corte.** El ERP arranca fresco en una fecha específica. Todo lo previo vive en los sistemas anteriores. Esto mantiene los dashboards limpios y las métricas reales.

3. **No migrar documentos cerrados.** Las cotizaciones de hace 1-2 años no aportan valor operativo, solo son archivo. Archivar en PDFs, no en BD.

### Fases propuestas

**Fase 1 — Datos maestros (Claude en bulk):**
1. Proveedores y distribuidores
2. Clientes fiscales
3. Catálogo de productos con fotos (el más importante)

**Fase 2 — Flujos vivos (Elias y equipo):**
4. Primer lead del mes → primera cotización → primera OC → primera obra → primera factura
5. Iterar sobre bugs/incomodidades encontrados
6. A partir del mes siguiente: todo nuevo entra al ERP directo

**Fase 3 — Dejar viejo afuera:**
Lo previo a la fecha de corte vive en sistemas anteriores. ERP arranca fresco.

### Preguntas pendientes antes de arrancar fase 1

Elias aún no respondió estas 3 preguntas (se va a retomar en otra sesión):

1. **¿Qué fuente tienes hoy para el catálogo?** (Excels por proveedor / Excel maestro único / Odoo export / nada estructurado / mezcla)
2. **¿Cuántos productos estimas para el catálogo inicial?** (<100 / 100-500 / 500-2000 / 2000+ / decidimos juntos)
3. **¿Fotos automáticas vs manuales?** (AI busca con web search / Elias sube manual / mixto / sin fotos v1)

Cuando Elias retome la migración, las respuestas a estas 3 preguntas determinan el diseño del script de import.

### Lo que aún NO sabemos del contexto de Elias (hay que preguntar)

- Fecha de corte propuesta para arrancar
- Si tiene exports de su Odoo actual que podamos aprovechar
- Qué sistemas externos actuales reemplaza el ERP (¿todo Odoo? ¿Excels dispersos? ¿combinación?)
- Si hay datos fiscales sensibles que no deban cargarse via Claude por política de seguridad

### Script de carga masiva — diseño técnico (cuando llegue el momento)

Plantilla esperada para scripts de import:

```typescript
// Ejemplo: scripts/import-catalog.ts
import { supabase } from '../src/lib/supabase'
import * as XLSX from 'xlsx'
import { readFileSync } from 'fs'

interface ImportRow {
  name: string
  marca: string
  modelo: string
  sku?: string
  provider: string
  cost: number
  markup: number
  system: string
  image_url?: string
}

async function importCatalog(filePath: string, dryRun = true) {
  const wb = XLSX.readFile(filePath)
  const rows: ImportRow[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])

  console.log(`Leidos ${rows.length} productos del Excel`)

  // Validación
  const errores = rows.filter(r => !r.name || !r.marca || r.cost < 0)
  if (errores.length > 0) {
    console.error(`${errores.length} filas con errores:`, errores.slice(0, 5))
    return
  }

  if (dryRun) {
    console.log('DRY RUN — no se insertó nada. Primeros 3:')
    console.log(rows.slice(0, 3))
    return
  }

  // Upsert por SKU o nombre+marca+modelo como key
  const { data, error } = await supabase
    .from('catalog_products')
    .upsert(rows, { onConflict: 'sku', ignoreDuplicates: false })
    .select()

  if (error) {
    console.error('Error:', error)
  } else {
    console.log(`Insertados/actualizados ${data?.length} productos`)
  }
}

// Uso:
// npx tsx scripts/import-catalog.ts --file=catalogo-lutron.xlsx --dry-run
// npx tsx scripts/import-catalog.ts --file=catalogo-lutron.xlsx --commit
```

Este script vive en `/scripts/` del repo y se corre localmente o desde CI. **Nunca corre en producción** directamente — siempre dry-run primero.

---

## 🎬 Ritual de cierre de sesión

Al terminar cualquier sesión, **SIEMPRE** actualizar este archivo con:

1. **Commits del día** en el log de arriba (`git log --oneline` de la sesión)
2. **Tablas nuevas o renombradas** en la sección de base de datos
3. **Patrones o convenciones nuevas** que surgieron
4. **Deuda técnica nueva** que se descubrió
5. **Reglas de negocio nuevas** que Elias mencionó
6. **Decisiones de arquitectura** tomadas

Luego `git add CLAUDE.md && git commit -m "docs: actualizar CLAUDE.md sesión YYYY-MM-DD" && git push`.

Este archivo es el único mecanismo de continuidad entre sesiones. Mantenerlo al día es más importante que cualquier feature.
