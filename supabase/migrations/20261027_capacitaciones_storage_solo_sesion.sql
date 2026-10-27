-- El bucket 'capacitaciones' dejaba subir, cambiar, borrar y listar con la llave anon.
-- Ahora solo usuarios con sesión real. Los archivos siguen viéndose por su URL pública
-- (el bucket es público), así que las capacitaciones se ven igual.
alter policy capacitaciones_insert on storage.objects to authenticated
  with check (bucket_id = 'capacitaciones' and (select public.usuario_real()));
alter policy capacitaciones_update on storage.objects to authenticated
  using (bucket_id = 'capacitaciones' and (select public.usuario_real()));
alter policy capacitaciones_delete on storage.objects to authenticated
  using (bucket_id = 'capacitaciones' and (select public.usuario_real()));
alter policy capacitaciones_select on storage.objects to authenticated
  using (bucket_id = 'capacitaciones' and (select public.usuario_real()));
