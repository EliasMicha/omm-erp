-- Titular de la cuenta del proveedor cuando no es el proveedor mismo (2026-11-27).
-- Caso: las órdenes de NULED se pagan a la cuenta de Constructora Kanso (Bankaool).
alter table public.supplier_bank_accounts add column if not exists titular text;
comment on column public.supplier_bank_accounts.titular is 'Titular de la cuenta cuando no es el proveedor (p.ej. NULED se paga a Constructora Kanso). Va en el campo titular del layout SPEI.';
