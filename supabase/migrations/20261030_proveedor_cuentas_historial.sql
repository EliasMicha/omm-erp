-- Cuántas veces ya se le pagó a cada cuenta (cuenta BBVA de 10 dígitos o
-- CLABE de 18), según los conceptos de los cargos del banco. Semáforo del pago
-- masivo de OC: una cuenta a la que nunca se le ha pagado se revisa antes de
-- mandar dinero. SECURITY INVOKER: respeta el RLS del banco.
create or replace function public.proveedor_cuentas_historial(p_numeros text[])
returns table(numero text, veces bigint, ultima date)
language sql stable security invoker set search_path = public as $$
  with n as (select distinct x numero from unnest(p_numeros) x where x ~ '^\d{10}$|^\d{18}$')
  select n.numero, count(b.id), max(b.fecha)
    from n left join bank_movements b
      on b.tipo = 'cargo'
     and b.concepto like '%' || n.numero || '%'
     and (length(n.numero) = 18 or b.concepto ~ ('BNET\s+' || n.numero))
   group by n.numero
$$;
revoke execute on function public.proveedor_cuentas_historial(text[]) from public, anon;
grant execute on function public.proveedor_cuentas_historial(text[]) to authenticated;
