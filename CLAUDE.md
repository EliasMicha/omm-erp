# CLAUDE.md — OMM ERP Context Document
## Last updated: 2026-04-11

---

## Project Overview
Custom ERP for OMM Technologies SA de CV (RFC OTE210910PW5).
Stack: React 18 + TypeScript + Vite + Supabase + Vercel.
Repo: `EliasMicha/omm-erp`
Prod: https://omm-erp.vercel.app
Supabase project: `ubbumxommqjcpdozpunf`

## Access & Deployment
- GitHub push pattern: `git remote set-url origin https://EliasMicha:{PAT}@github.com/EliasMicha/omm-erp.git && git push`
- GitHub API (api.github.com) is blocked from Claude container but direct HTTPS works
- Supabase REST API blocked from container — use browser `javascript_tool` fetch from omm-erp.vercel.app
- File uploads to GitHub MUST use API via browser JS (never web editor — corrupts JSX closing tags)
- SQL migrations: Elias runs manually in Supabase SQL Editor
- Build: `vite build` only (tsc disabled temporarily via `"build": "vite build"` in package.json)
- Deploy: automatic on push to main (~17-19s build time)

## Architecture
- The **Lead** is the master entity linking quotations, purchases, payments, and collections
- Leads have two client roles: Arquitecto/Despacho and Cliente Final
- Currency (USD/MXN) chosen per quotation with editable tipo de cambio
- `catalog_products` distinguish between `provider` (brand/manufacturer) and `supplier_id` (distributor)

## Key Modules & Status

### Facturación (standalone at /facturacion)
**File**: `src/pages/Facturacion.tsx` (~94KB)
**Proxy**: `api/facturapi.ts` (~7.4KB)

**Features implemented**:
- FacturAPI integration (dual mode TEST/LIVE with banner)
- Tabs: Todas / Emitidas / Recibidas
- Monthly navigation with counter breakdown
- Sync incremental por mes (`sincronizarMes()`) with `date_gte`/`date_lte` filters
- Re-check de status de TODAS las facturas locales del mes (detecta cancelaciones)
- `computeAmounts(inv)` helper handles tipo I, N (nóminas), P (REPs/pagos)
- `saveInvoiceItems(facturaId, items)` saves invoice line items to `factura_conceptos`
- Modal de detalle al click (sub-componente `DetalleModal` — header + emisor/receptor + totales + botones PDF/XML)
- PDF/XML download via proxy (`/api/facturapi?action=download_pdf|xml&mode=test|live&id=...`)

**FacturAPI v2 structure (confirmed)**:
- Emitidas: `inv.customer.{tax_id, legal_name, tax_system, address.zip}`
- Recibidas: `inv.issuer_info.{tax_id, legal_name, tax_system, address.zip}` (NOT `inv.issuer`)
- REPs tipo P: `inv.total_payment_amount` in header (NOT in complements)
- Nóminas tipo N: `inv.items[0].product.price` = bruto, `inv.items[0].discount` = deducciones
- Complements: array indexed `inv.complements = [{ type: 'pago', data: [...] }]`
- Related documents: `inv.related_documents = [{ relationship: "07", documents: ["UUID..."] }]`
- Recibidas param: `issuer_type=receiving` (NOT `received`)

**Known issues**:
- Full modal with conceptos table causes Vercel build error (esbuild). Current deployed modal is simplified (no conceptos table). Root cause undiagnosed — inline JSX expressions or table within ternary may confuse esbuild parser.
- 3 BBVA bank statement invoices (tipo I recibida) have `total=0` — edge case, folio = account number

### Contabilidad (/contabilidad)
**File**: `src/pages/Contabilidad.tsx` (~137KB)

**Features implemented**:
- Tab Facturación with monthly KPIs (now separated MXN/USD — 8 cards total)
- Table with columns: Folio, Dir., Tipo, Mon. (NEW), Cliente/Proveedor, Uso CFDI, Proyecto, Ingreso, Egreso, Estado, Fecha
- Mon. column shows badge MXN (blue) or USD (green)
- Bank statement upload (BBVA PDF/CSV/Excel, Banorte) with AI extraction
- Conciliación v2 with factura matching
- Tab Supervision, Efectivo, Cobranza, Flujo de efectivo

### CRM, Cotizaciones, Compras, Obra, Catálogo, Clientes, Proyectos
All functional — see respective .tsx files.

## Database Schema (key tables)

### facturas
```
id, direccion ('emitida'|'recibida'), facturapi_id, uuid_fiscal,
serie, folio, status, estado, fecha_emision, fecha_timbrado,
emisor_rfc, emisor_nombre, emisor_regimen_fiscal,
receptor_rfc, receptor_nombre, receptor_regimen_fiscal,
receptor_codigo_postal, receptor_uso_cfdi,
subtotal, iva, total, moneda, forma_pago, metodo_pago,
tipo_comprobante ('I'|'E'|'N'|'P'|'T'), sandbox (boolean),
tipo_relacion (text) — SAT relationship code: 01-07,
uuids_relacionados (jsonb) — array of related UUIDs,
conciliada, proyecto_nombre, created_at
```
Index: `idx_facturas_tipo_relacion` on tipo_relacion WHERE NOT NULL

### factura_conceptos
```
id, factura_id (FK), clave_prod_serv, no_identificacion, descripcion,
clave_unidad, unidad, cantidad, valor_unitario, importe, descuento,
objeto_imp, iva_tasa, iva_importe, isr_retencion_tasa, isr_retencion_importe,
producto_catalogo_id, orden_display, order_index
```

### bank_movements
```
id, fecha, concepto, referencia, monto, tipo ('cargo'|'abono'), saldo,
categoria_sugerida, conciliado, factura_match_id, moneda ('MXN'|'USD'),
banco, cuenta, source
```

## PENDING IMPLEMENTATION — Monitor de Anticipos (PRIORITY)

### Context
Mexican fiscal law (SAT Apéndice 6, Anexo 20, Procedimiento A) requires a chain of 3 invoices for every advance payment:
1. **ANTICIPO** (tipo I, clave SAT `84111506`, descripción "Anticipo del bien o servicio") — UUID_X
2. **FACTURA PRODUCTO** (tipo I) con CFDI Relacionado `TipoRelacion=07` → UUID_X
3. **NOTA DE EGRESO** (tipo E, clave `84111506`, descripción "Aplicación de anticipo") con CFDI Relacionado `TipoRelacion=07` → UUID de la factura producto (NOT the anticipo directly)

### Mathematical rules
- Σ(facturas producto pointing to anticipo UUID_X) MUST = monto(anticipo UUID_X)
- Each factura producto MUST have its own NC (tipo E) of the EXACT SAME amount
- NCs subtract from totals, they do NOT add
- If >60 days pass without closing = ALERT

### Implementation status
**DONE**:
- Schema: `tipo_relacion` (text) and `uuids_relacionados` (jsonb) columns exist in `facturas` table with index

**NOT DONE (3 phases)**:

#### FASE 1 — Sync with relationships
- Modify `Facturacion.tsx` sync payloads (both emit + rec) to populate:
  ```ts
  tipo_relacion: Array.isArray(inv.related_documents) && inv.related_documents.length > 0
    ? (inv.related_documents[0].relationship || null) : null,
  uuids_relacionados: Array.isArray(inv.related_documents) && inv.related_documents.length > 0
    ? inv.related_documents.flatMap((rd) => Array.isArray(rd.documents) ? rd.documents : [])
    : null,
  ```
- Push + deploy + re-sync month to populate

#### FASE 2 — Anticipos view in Contabilidad.tsx
- New sub-tab "Anticipos" with toggle Recibidos/Emitidos
- Detection: `tipo_comprobante='I'` AND (clave SAT `84111506` in conceptos OR descripcion ILIKE '%anticipo%')
- For each anticipo, group related invoices using `uuids_relacionados` contains UUID
- Validate 3 rules and assign state:
  - 🟢 CERRADO: Σ products = anticipo AND each product has NC of same amount
  - 🟡 EN PROGRESO: Σ products < anticipo, age < 60 days
  - 🟠 ALERTA NC FALTANTE: product invoiced without NC
  - 🔴 DESCUADRADO: Σ products > anticipo
  - 🔴 VENCIDO: age > 60 days without closing
- 4 KPIs: anticipos vivos $, quantity pending, fiscal risk $, oldest days
- Expandable table showing chain: Anticipo → [Factura producto → NC] (...)
- Manual reconciliation button for cases where provider NC doesn't point to correct UUID

#### FASE 3 — Validation with real case
- Real test case: LUTRON CN, NC folio 2099 ($704.70 USD), tipo E, relationship 07
- Points to anticipo UUID: `ACC95C2D-299F-494E-A434-EEDF11B6D3D6`
- facturapi_id (charCodes): [54,57,100,97,98,53,97,53,100,51,55,100,53,57,99,101,49,54,51,56,56,49,52,48]

### KPIs correction needed
Current KPIs sum ALL tipo I as income and tipo E as expense. This double-counts anticipos.
Correct calculation:
```
Total Facturado neto = SUM(emitidas tipo I, excluding tipo_relacion=04)
                     - SUM(emitidas tipo E with tipo_relacion in [01, 03, 07])

Total Recibido neto = SUM(recibidas tipo I, excluding tipo_relacion=04)
                    - SUM(recibidas tipo E with tipo_relacion in [01, 03, 07])
```

## Other Pending Items

### Technical debt
- Restore `"build": "tsc && vite build"` after fixing TS errors (currently only `vite build`)
- Run `npx tsc --noEmit` to identify TS errors
- Consolidate `estado` vs `status` field in `facturas` table (currently writing both)
- Full conceptos table in DetalleModal (bisect esbuild issue)

### Facturación
- Webhook handler `api/facturapi-webhook.ts` with `facturapi_webhook_log` table
- FacturAPI reception (REST polling vs Gmail) + Service Account JWT
- Sync in ListaEmitidas and ListaRecibidas tabs (currently only ListaTodas has sync)

### Operations
- AI Coordinator: centralize field info, daily summaries, weekly planning
- Data migration from Jetbuilt, Odoo, Excel/CSV

## Bank Accounts
```
bbva-mxn:    BBVA    MXN  0118270236
bbva-usd:    BBVA    USD  0119196919
banorte-mxn: Banorte MXN  1263311182
```

## Commit History (Sesión B — Facturación standalone)
| Commit | Description | Status |
|--------|-------------|--------|
| 5a83557 | proxy dual mode | ✅ |
| 3e59831 | banner TabFacturacion (Contabilidad) | ✅ |
| 915c3f8 | create_invoice + cancel + PDF/XML | ✅ |
| fb8a87f | banner + nav Facturacion.tsx standalone | ✅ |
| e26e9cc | fix emisor + ListaRecibidas | ✅ |
| 68914a0 | fix issuer_type=receiving, issuer_info, computeAmounts | ✅ |
| 1f35048 | Tab Todas + sync unificado + paginación | ✅ |
| a77a1b7 | computeAmounts tipo N y P | ✅ |
| 956ced5 | discount + complements array indexado | ✅ |
| a24fd97 | saveInvoiceItems + sync conceptos + fix REPs | ✅ |
| 8653047 | modal de detalle al click + descarga PDF/XML | ✅ |
| a792f8d | proxy: date_gte/date_lte support | ✅ |
| c0dda0a | sync incremental por mes + re-check status | ✅ |
| 61b4edf | contabilidad: KPIs MXN/USD + columna Mon. | ✅ |

## Sync Stats (verified 2026-04-11)
```
emitida I:  60   sum $5,626,062.52  zero=0
emitida N: 232   sum $936,373.00    zero=0
emitida P:  13   sum $1,785,601.86  zero=0
recibida E: 53   sum $141,620.32    zero=0
recibida I: 307  sum $4,108,168.15  zero=3 (BBVA edge case)
recibida P:  20  sum $223,768.09    zero=0
TOTAL:     685 facturas, $12,821,594, conceptos=1204
```
