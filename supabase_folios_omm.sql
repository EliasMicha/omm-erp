-- ═══════════════════════════════════════════════════════════════════════════
--  FOLIOS OMM — aplicado en produccion el 2026-09-25
--
--   Lead        PILO                4 letras del nombre, unicas
--   Cotizacion  PILO-ES01           nucleo fijo; COT- solo es etiqueta
--   Compra      PILO-ES01-C03       tercera compra de ese contrato
--
--  El folio se genera en la base y no en la pantalla: asi nace igual si el
--  registro lo crea el ERP, una importacion o un script.
--
--  Autoasignacion bancaria: al llegar un movimiento, el concepto se compara en
--  forma compacta (solo letras y numeros) contra los folios. Si aparece el de
--  una compra se asigna lead + cotizacion + orden; si solo aparece el del
--  contrato, lead + cotizacion. La clave de lead sola NO asigna: cuatro letras
--  pegan por casualidad dentro de cualquier palabra.
--
--  Este archivo es la copia de lo aplicado (Supabase migrations
--  folios_omm_columnas_y_funciones, folios_omm_triggers,
--  folios_omm_fix_enum_specialty y folios_omm_autoasignacion_bancaria).
--  Se guarda en el repo para que el esquema no viva solo en el dashboard.
-- ═══════════════════════════════════════════════════════════════════════════

-- Columnas
alter table leads            add column if not exists codigo text;
alter table quotations       add column if not exists folio  text;
alter table purchase_orders  add column if not exists folio  text;
alter table bank_movements   add column if not exists folio_detectado text;
alter table bank_movements   add column if not exists asignacion_auto boolean default false;

create unique index if not exists uq_leads_codigo      on leads (codigo)           where codigo is not null;
create unique index if not exists uq_quotations_folio  on quotations (folio)       where folio  is not null;
create unique index if not exists uq_po_folio          on purchase_orders (folio)  where folio  is not null;

-- Las funciones y disparadores completos estan en las migraciones de Supabase:
--   omm_normaliza, omm_compacta
--   omm_lead_codigo_base, omm_lead_codigo_unico, omm_tg_lead_codigo
--   omm_specialty2, omm_lead_de_cotizacion
--   omm_folio_cotizacion, omm_tg_cot_folio
--   omm_folio_compra,     omm_tg_po_folio
--   omm_folio_en_concepto, omm_tg_movimiento_folio
