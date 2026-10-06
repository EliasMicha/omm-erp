-- ════════════════════════════════════════════════════════════════════════════
--  Guardar un borrador de factura en UNA transaccion, con idempotencia y
--  auditoria. Es la primera pieza del Hito A.
--
--  Por que una funcion en la base y no codigo en el servidor: hoy
--  guardarBorrador() en Facturacion.tsx hace varias escrituras sueltas y, al
--  editar, BORRA los conceptos anteriores antes de insertar los nuevos. Si la
--  segunda escritura falla, la factura se queda sin renglones y nadie se
--  entera. Una funcion de Postgres corre entera o no corre: esa es la garantia
--  que se ocupa, y no se puede dar desde fuera.
--
--  IDENTIDAD: se resuelve con public.mi_app_user() (que lee auth.uid()), NUNCA
--  de un parametro. Un actor_id que manda el cliente no es identidad, es una
--  sugerencia. Esto hace que un modelo no pueda decir "soy Dafne".
--
--  SECURITY INVOKER a proposito: RLS sigue mandando. Quien no pueda insertar en
--  `facturas` por politica, tampoco puede por aqui. No se usa SECURITY DEFINER
--  como atajo para errores de permiso.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Registro de operaciones: idempotencia acotada + auditoria ───────────
--
-- agent_idempotencia ya existe pero su llave primaria es `clave` a secas, o sea
-- GLOBAL: dos actores distintos, o la misma clave para dos acciones distintas,
-- chocan entre si. Aqui la unicidad es (actor, accion, clave), que es lo que
-- de verdad identifica una operacion.
create table if not exists public.erp_operaciones (
  operation_id    uuid primary key default gen_random_uuid(),
  actor_app_user  uuid not null references public.app_users(id),
  accion          text not null,
  idempotency_key text not null,
  -- Hash canonico de la peticion. Reintentar con la MISMA clave y distinto
  -- contenido no es un reintento, es otra operacion disfrazada.
  peticion_hash   text not null,
  estado          text not null check (estado in ('running','succeeded','failed')),
  resultado       jsonb,
  error           jsonb,
  entidad_tipo    text,
  entidad_id      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_erp_op_actor_accion_clave unique (actor_app_user, accion, idempotency_key)
);

create index if not exists idx_erp_op_entidad on public.erp_operaciones (entidad_tipo, entidad_id);
create index if not exists idx_erp_op_creada  on public.erp_operaciones (created_at desc);

alter table public.erp_operaciones enable row level security;

-- Cada quien ve SUS operaciones; el DG ve todas. Nadie las edita ni las borra:
-- una bitacora que el rol operativo puede reescribir no es una bitacora.
drop policy if exists erp_operaciones_lee_propio_o_dg on public.erp_operaciones;
create policy erp_operaciones_lee_propio_o_dg on public.erp_operaciones
  for select using (actor_app_user = public.mi_app_user() or public.soy_dg());

comment on table public.erp_operaciones is
  'Operaciones de escritura del ERP: idempotencia acotada a (actor, accion, clave) y resultado duradero. Solo se escribe por los ayudantes SECURITY DEFINER de abajo; no hay politica de insert/update/delete a proposito.';


-- ─── 1b. Los dos unicos que escriben la bitacora ───────────────────────────
--
-- Van SECURITY DEFINER y el resto NO. Si se le abriera insert/update al rol
-- operativo, cualquiera podria reescribir su propia auditoria — y una bitacora
-- que el auditado puede editar no sirve de nada. Estas dos funciones son la
-- unica puerta, sellan el actor ellas mismas (nunca lo reciben) y no tocan
-- ninguna otra tabla.
-- Devuelve {nuevo, operation_id, estado, peticion_hash, resultado}.
-- `nuevo` es un dato, no una inferencia: la primera version lo deducia
-- comparando created_at contra now(), y eso es fragil — now() es la hora de
-- INICIO de la transaccion, asi que un renglon recien insertado empata exacto
-- y cualquier cambio de precision rompe la comparacion en silencio.
create or replace function public.erp_op_reclamar(
  p_accion text, p_clave text, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.mi_app_user();
  v_op    public.erp_operaciones%rowtype;
  v_nuevo boolean := false;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  insert into public.erp_operaciones
        (actor_app_user, accion, idempotency_key, peticion_hash, estado)
  values (v_actor, p_accion, p_clave, p_hash, 'running')
  on conflict on constraint uq_erp_op_actor_accion_clave do nothing
  returning * into v_op;

  if v_op.operation_id is null then
    -- No se inserto: ya existia. Se devuelve para que quien llama decida si es
    -- replay o choque. Ojo: solo se busca por el actor de ESTA sesion, asi
    -- que la clave de otra persona nunca se alcanza desde aqui.
    select * into v_op from public.erp_operaciones
     where actor_app_user = v_actor and accion = p_accion and idempotency_key = p_clave;
    -- Un `failed` se vuelve a abrir aqui, dentro de la misma funcion que es
    -- dueña de la tabla, en vez de dejar que el llamador la actualice.
    if v_op.estado = 'failed' then
      update public.erp_operaciones
         set estado='running', peticion_hash=p_hash, error=null, updated_at=now()
       where operation_id = v_op.operation_id and peticion_hash = p_hash;
    end if;
  else
    v_nuevo := true;
  end if;

  return jsonb_build_object(
    'nuevo', v_nuevo,
    'operation_id', v_op.operation_id,
    'estado', v_op.estado,
    'peticion_hash', v_op.peticion_hash,
    'resultado', v_op.resultado);
end;
$$;

create or replace function public.erp_op_cerrar(
  p_operation_id uuid, p_estado text, p_resultado jsonb,
  p_error jsonb default null, p_entidad_tipo text default null,
  p_entidad_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_estado not in ('running','succeeded','failed') then
    raise exception 'VALIDATION_ERROR: estado invalido' using errcode = '22023';
  end if;
  -- El filtro por actor es la guarda: nadie cierra la operacion de otro.
  update public.erp_operaciones
     set estado = p_estado, resultado = coalesce(p_resultado, resultado),
         error = p_error, updated_at = now(),
         entidad_tipo = coalesce(p_entidad_tipo, entidad_tipo),
         entidad_id   = coalesce(p_entidad_id, entidad_id)
   where operation_id = p_operation_id
     and actor_app_user = public.mi_app_user();
end;
$$;

revoke all on function public.erp_op_reclamar(text,text,text) from public;
revoke all on function public.erp_op_cerrar(uuid,text,jsonb,jsonb,text,uuid) from public;
grant execute on function public.erp_op_reclamar(text,text,text) to authenticated;
grant execute on function public.erp_op_cerrar(uuid,text,jsonb,jsonb,text,uuid) to authenticated;


-- ─── 2. Guardar el borrador ────────────────────────────────────────────────
create or replace function public.factura_borrador_guardar(
  p_datos           jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor        uuid;
  v_hash         text;
  v_op           jsonb;
  v_op_id        uuid;
  v_factura_id   uuid;
  v_cliente      public.clientes%rowtype;
  v_concepto     jsonb;
  v_subtotal     numeric(14,2) := 0;
  v_iva          numeric(14,2) := 0;
  v_total        numeric(14,2);
  v_n            int := 0;
  v_dup          uuid;
  v_faltantes    text[] := '{}';
  v_resultado    jsonb;
  v_importe      numeric(14,2);
  v_iva_importe  numeric(14,2);
begin
  -- ── Identidad ────────────────────────────────────────────────────────────
  v_actor := public.mi_app_user();
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: no hay una cuenta del ERP para esta sesion'
      using errcode = '28000';
  end if;

  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'VALIDATION_ERROR: idempotency_key de al menos 8 caracteres'
      using errcode = '22023';
  end if;

  v_hash := md5(p_datos::text);

  -- ── Reclamo de idempotencia ──────────────────────────────────────────────
  -- Va ANTES de validar y escribir: dos llamadas simultaneas identicas tienen
  -- que chocar aqui, no en la tabla de facturas.
  v_op := public.erp_op_reclamar('factura_borrador_guardar', p_idempotency_key, v_hash);
  v_op_id := (v_op->>'operation_id')::uuid;

  if not (v_op->>'nuevo')::boolean then
    -- Ya habia una operacion con esa clave.
    if (v_op->>'peticion_hash') is distinct from v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT: esa clave ya se uso con otro contenido'
        using errcode = '23505';
    end if;

    if v_op->>'estado' = 'succeeded' then
      -- Reintento de algo que ya termino: se devuelve el MISMO resultado, no se
      -- vuelve a escribir. El replay es la razon de ser de la clave.
      return jsonb_build_object(
        'ok', true, 'replayed', true,
        'operation_id', v_op_id,
        'data', v_op->'resultado');
    end if;

    if v_op->>'estado' = 'running' then
      raise exception 'OPERATION_IN_PROGRESS: operacion %, consultala antes de reintentar', v_op_id
        using errcode = '55006';
    end if;
    -- 'failed' ya lo reabrio erp_op_reclamar; se sigue de largo.
  end if;

  -- ── Validacion del cliente ───────────────────────────────────────────────
  select * into v_cliente from public.clientes
   where id = (p_datos->>'cliente_id')::uuid;
  if v_cliente.id is null then
    raise exception 'ENTITY_NOT_FOUND: cliente_id no existe o no es visible'
      using errcode = 'P0002';
  end if;

  -- ── Conceptos y aritmetica ───────────────────────────────────────────────
  -- Los importes se calculan AQUI, no se creen los que manda el cliente: un
  -- total que viene de afuera es una afirmacion, no un calculo.
  if jsonb_array_length(coalesce(p_datos->'conceptos','[]'::jsonb)) = 0 then
    raise exception 'MISSING_REQUIRED_FIELD: al menos un concepto'
      using errcode = '22023';
  end if;

  for v_concepto in select * from jsonb_array_elements(p_datos->'conceptos') loop
    v_n := v_n + 1;
    if (v_concepto->>'cantidad')::numeric <= 0 then
      raise exception 'VALIDATION_ERROR: concepto % con cantidad no positiva', v_n
        using errcode = '22023';
    end if;
    if (v_concepto->>'valor_unitario')::numeric < 0 then
      raise exception 'VALIDATION_ERROR: concepto % con valor unitario negativo', v_n
        using errcode = '22023';
    end if;
    v_importe := round((v_concepto->>'cantidad')::numeric
                     * (v_concepto->>'valor_unitario')::numeric, 2);
    v_iva_importe := round(v_importe * coalesce((v_concepto->>'iva_tasa')::numeric, 0), 2);
    v_subtotal := v_subtotal + v_importe;
    v_iva      := v_iva + v_iva_importe;
  end loop;
  v_total := round(v_subtotal + v_iva, 2);

  -- ── Posible duplicado de negocio ─────────────────────────────────────────
  -- La deduplicacion tecnica (la clave) no evita que alguien capture dos veces
  -- la misma factura con claves distintas. Esto NO bloquea: avisa, porque
  -- facturar dos veces el mismo monto al mismo cliente a veces es legitimo.
  select f.id into v_dup from public.facturas f
   where f.direccion = 'emitida'
     and f.receptor_rfc = v_cliente.rfc
     and f.total = v_total
     and f.status <> 'cancelada'
     and f.created_at > now() - interval '30 days'
     and (p_datos->>'factura_id') is null
   limit 1;

  -- ── Faltantes para TIMBRAR (no para guardar) ─────────────────────────────
  -- array[...] y no la cadena suelta: `v_faltantes || 'metodo_pago'` hace que
  -- Postgres intente leer el texto como literal de arreglo y truene con
  -- "malformed array literal". Lo caso la prueba, no el compilador.
  if coalesce(p_datos->>'metodo_pago','') = '' then v_faltantes := v_faltantes || array['metodo_pago']; end if;
  if coalesce(p_datos->>'forma_pago','')  = '' then v_faltantes := v_faltantes || array['forma_pago'];  end if;

  -- ── La escritura ─────────────────────────────────────────────────────────
  -- status manda; `estado` se escribe por compatibilidad y NO es autoridad:
  -- hay 4,127 facturas con estado='borrador' y status='timbrada'.
  insert into public.facturas (
    direccion, tipo_comprobante, status, estado,
    emisor_rfc, emisor_nombre, emisor_regimen_fiscal,
    receptor_rfc, receptor_nombre, receptor_regimen_fiscal,
    receptor_uso_cfdi, receptor_codigo_postal,
    cliente_id, lead_id, quotation_id,
    subtotal, iva, total, moneda, tipo_cambio,
    metodo_pago, forma_pago, notas, created_by
  ) values (
    'emitida', 'I', 'borrador', 'borrador',
    p_datos->>'emisor_rfc', p_datos->>'emisor_nombre', p_datos->>'emisor_regimen_fiscal',
    v_cliente.rfc, v_cliente.razon_social, v_cliente.regimen_fiscal_clave,
    coalesce(p_datos->>'uso_cfdi', v_cliente.uso_cfdi_clave), v_cliente.codigo_postal,
    v_cliente.id,
    nullif(p_datos->>'lead_id','')::uuid,
    nullif(p_datos->>'quotation_id','')::uuid,
    v_subtotal, v_iva, v_total,
    coalesce(p_datos->>'moneda','MXN'),
    nullif(p_datos->>'tipo_cambio','')::numeric,
    nullif(p_datos->>'metodo_pago',''), nullif(p_datos->>'forma_pago',''),
    nullif(p_datos->>'notas',''),
    v_actor
  ) returning id into v_factura_id;

  v_n := 0;
  for v_concepto in select * from jsonb_array_elements(p_datos->'conceptos') loop
    v_importe := round((v_concepto->>'cantidad')::numeric
                     * (v_concepto->>'valor_unitario')::numeric, 2);
    insert into public.factura_conceptos (
      factura_id, descripcion, cantidad, valor_unitario, importe,
      clave_prod_serv, clave_unidad, unidad, iva_tasa, iva_importe, order_index
    ) values (
      v_factura_id,
      v_concepto->>'descripcion',
      (v_concepto->>'cantidad')::numeric,
      (v_concepto->>'valor_unitario')::numeric,
      v_importe,
      v_concepto->>'clave_prod_serv',
      v_concepto->>'clave_unidad',
      nullif(v_concepto->>'unidad',''),
      nullif(v_concepto->>'iva_tasa','')::numeric,
      round(v_importe * coalesce((v_concepto->>'iva_tasa')::numeric,0), 2),
      v_n
    );
    v_n := v_n + 1;
  end loop;

  v_resultado := jsonb_build_object(
    'factura_id', v_factura_id,
    'status', 'borrador',
    'subtotal', v_subtotal, 'iva', v_iva, 'total', v_total,
    'moneda', coalesce(p_datos->>'moneda','MXN'),
    'conceptos', v_n,
    'missing_fields', to_jsonb(v_faltantes),
    'listo_para_timbrar', (array_length(v_faltantes,1) is null),
    'duplicado_posible', v_dup);

  perform public.erp_op_cerrar(v_op_id, 'succeeded', v_resultado, null, 'factura', v_factura_id);

  return jsonb_build_object('ok', true, 'replayed', false,
                            'operation_id', v_op_id,
                            'data', v_resultado);
end;
$$;

comment on function public.factura_borrador_guardar(jsonb, text) is
  'Guarda cabecera y conceptos de un borrador de factura en una sola transaccion. Identidad por mi_app_user(), nunca por parametro. Importes calculados en el servidor. SECURITY INVOKER: RLS manda.';
