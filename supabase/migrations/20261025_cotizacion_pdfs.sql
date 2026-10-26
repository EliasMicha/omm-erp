-- PDFs de cotización generados en el ERP, para que el bot de WhatsApp (y después
-- correo / clientes) mande EXACTAMENTE el mismo documento que sale de la pantalla.
--
-- El PDF de propuesta se arma "fotografiando" la página en el navegador
-- (html2canvas), así que un servidor no lo puede reproducir. En vez de copiar el
-- diseño, cada descarga en el ERP sube su copia aquí y el bot manda la última.
--
-- total_al_generar: con eso se detecta un PDF viejo (la cotización cambió después).
-- interno: el formato 'tecnico' trae costos y márgenes; NUNCA debe ir a un cliente.

create table if not exists public.cotizacion_pdfs (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  formato text not null,
  interno boolean not null default false,
  storage_path text not null,
  filename text not null,
  bytes integer,
  total_al_generar numeric,
  moneda text,
  generado_por uuid references public.app_users(id) on delete set null,
  generado_at timestamptz not null default now()
);

create index if not exists idx_cotizacion_pdfs_cot on public.cotizacion_pdfs (quotation_id, generado_at desc);

alter table public.cotizacion_pdfs enable row level security;

drop policy if exists cotizacion_pdfs_select on public.cotizacion_pdfs;
create policy cotizacion_pdfs_select on public.cotizacion_pdfs
  for select to authenticated using ((select public.usuario_real()));

drop policy if exists cotizacion_pdfs_insert on public.cotizacion_pdfs;
create policy cotizacion_pdfs_insert on public.cotizacion_pdfs
  for insert to authenticated with check ((select public.usuario_real()));

revoke all on public.cotizacion_pdfs from anon;

-- Bucket privado. "Público" en Supabase solo abre la lectura por URL; aquí ni eso:
-- son documentos comerciales con precios.
insert into storage.buckets (id, name, public)
values ('cotizaciones-pdf', 'cotizaciones-pdf', false)
on conflict (id) do nothing;

drop policy if exists cotizaciones_pdf_select on storage.objects;
create policy cotizaciones_pdf_select on storage.objects
  for select to authenticated using (bucket_id = 'cotizaciones-pdf' and (select public.usuario_real()));

drop policy if exists cotizaciones_pdf_insert on storage.objects;
create policy cotizaciones_pdf_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'cotizaciones-pdf' and (select public.usuario_real()));

drop policy if exists cotizaciones_pdf_update on storage.objects;
create policy cotizaciones_pdf_update on storage.objects
  for update to authenticated using (bucket_id = 'cotizaciones-pdf' and (select public.usuario_real()));
