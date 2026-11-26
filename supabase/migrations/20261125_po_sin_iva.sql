-- Orden de compra sin IVA (proveedor extranjero / importación). 2026-11-25
alter table public.purchase_orders add column if not exists sin_iva boolean not null default false;
comment on column public.purchase_orders.sin_iva is 'Orden sin IVA (p.ej. proveedor extranjero / importación). La pone el usuario en la orden.';
