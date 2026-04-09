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
| `projects` | 1 | Proyectos, Compras, Obras | id, name, client_name, status |
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
