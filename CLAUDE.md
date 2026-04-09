# CLAUDE.md — Contexto del proyecto OMM ERP

> **Lee este archivo antes de tocar cualquier código.** Se actualiza al final de cada sesión con lo aprendido.
> Última actualización: 2026-04-08

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

### Tablas confirmadas (verificadas contra Supabase el 2026-04-08)

| Tabla | Uso | Notas |
|---|---|---|
| `clientes` | Clientes fiscales (CSF) | **NO es `clientes_fiscales`**. Columnas: id, rfc, razon_social, regimen_fiscal, regimen_fiscal_clave, codigo_postal, uso_cfdi, uso_cfdi_clave, curp, calle, num_exterior, num_interior, colonia, localidad, municipio, estado, tipo_persona, email, telefono, activo, facturapi_customer_id, created_at |
| `leads` | CRM | id, name, company, ... |
| `projects` | Proyectos | id, name, client_name, status |
| `quotations` | Cotizaciones | id, name, client_name, project_id, specialty, stage, total, notes (JSON con systems/currency/tipoCambio/lead_id/lead_name), created_at |
| `quotation_areas` | Áreas de cada cotización | id, quotation_id, name, order_index, subtotal |
| `quotation_items` | Items de cotización | id, quotation_id, area_id, catalog_product_id, name, description, system, type ('material'\|'labor'), provider, supplier_id, purchase_phase, quantity, cost, markup, price, total, installation_cost, order_index |
| `catalog_products` | Catálogo | id, name, description, system, type, unit, cost, markup, precio_venta, provider, marca, modelo, sku, clave_prod_serv, clave_unidad, moneda, iva_rate, is_active, purchase_phase |
| `suppliers` | Proveedores/distribuidores | id, name, is_active, ... |
| `purchase_orders` | Órdenes de compra | id, po_number, project_id, supplier_id, specialty, status, purchase_phase, subtotal, iva, total, currency |
| `po_items` | Items de OC | id, purchase_order_id, catalog_product_id, name, quantity, unit_cost, total, quantity_received, real_name, real_unit_cost |
| `purchase_order_payments` | Pagos a proveedor | |
| `facturas` | CFDI emitidos | |
| `factura_conceptos` | |
| `bank_movements` | Movimientos bancarios | |

### ⚠️ Tablas que NO EXISTEN (bugs históricos)

- ~~`clientes_fiscales`~~ → usar `clientes`
- ~~`obras`~~ → **no existe**. Todo el módulo `Obra.tsx` usa mock data (`MOCK_OBRAS`). Ver deuda técnica.

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
| Cotizador ESP | ✅ Funcional | CotEditorESP.tsx | 10 sistemas internos, pricing rules por proveedor, dual currency USD/MXN |
| AI Importer de cotizaciones | ✅ Funcional | CotEditorESP.tsx (AIImportModal) + api/extract.ts | Parseo directo para formato D-Tools (Manufacturer/Model/Room/System), fallback a Claude API. SheetJS via CDN. |
| Catálogo de productos | ✅ Funcional | Catalogo.tsx + CotEditorESP (CreateProductModal con búsqueda AI) | |
| Compras (OC) | ✅ Funcional | Compras.tsx | Agrupación proveedor × fase, cotejo de precios, recepción parcial |
| Clientes | ✅ Funcional (tras fix 2026-04-08) | Clientes.tsx | Tabla es `clientes`, no `clientes_fiscales` |
| Facturación CFDI | ✅ Funcional | Facturacion.tsx + api/facturapi.ts | FacturAPI sandbox phase 1 integrado |
| Contabilidad | 🟡 En desarrollo | Contabilidad.tsx | Bank statement upload con AI extraction en progreso |
| Obras (tab Materiales) | ✅ Funcional | Obra.tsx (SubMateriales) | Lee quotation_items vía obra.cotizacion_id, agrupado por Área → Sistema |
| Obras (resto) | 🔴 Mock data | Obra.tsx | Ver deuda técnica |

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

### (agregar siguiente sesión aquí)

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
