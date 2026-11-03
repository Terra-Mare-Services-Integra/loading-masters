-- Rendición de gastos del portal Terra Mare (#/gastos): facturas, tickets y reembolsos con su comprobante,
-- para que nadie tenga que mandar mails. Acceso desde el panel de Administración:
--   tm_accesos.modulos 'gastos'            → carga sus propios gastos
--   tm_accesos.modulos 'gastos-consolida'  → además ve todos, concilia contra el resumen y marca reembolsos pagados
--   tm_admins                              → aprueba o rechaza (aprobador único) y administra las tarjetas
-- Prefijo rg_ para no chocar con gastos_operacion / gastos_administracion de Loading Masters.

create or replace function public.rg_carga()
returns boolean language sql stable security definer set search_path = public as $$
  select public.tm_es_admin() or exists (
    select 1 from public.tm_accesos where user_id = auth.uid() and modulos && array['gastos', 'gastos-consolida'])
$$;

create or replace function public.rg_consolida()
returns boolean language sql stable security definer set search_path = public as $$
  select public.tm_es_admin() or exists (
    select 1 from public.tm_accesos where user_id = auth.uid() and 'gastos-consolida' = any(modulos))
$$;

-- ─── Tarjetas de la empresa ─────────────────────────────────────────────────
create table public.rg_tarjetas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),          -- p. ej. "Visa Galicia"
  ultimos4 text not null default '' check (ultimos4 ~ '^[0-9]{0,4}$'),
  titular text not null default '',
  activa boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.rg_tarjetas enable row level security;
create policy "rg tarjetas: ver" on public.rg_tarjetas for select to authenticated using (public.rg_carga());
create policy "rg tarjetas: admin" on public.rg_tarjetas for all to authenticated
  using (public.tm_es_admin()) with check (public.tm_es_admin());

-- ─── Gastos ─────────────────────────────────────────────────────────────────
create table public.rg_gastos (
  id uuid primary key default gen_random_uuid(),
  email text not null default lower(auth.jwt() ->> 'email') check (email = lower(email)),
  fecha date not null,
  proveedor text not null default '',
  cuit_proveedor text not null default '' check (cuit_proveedor ~ '^[0-9]{0,11}$'),
  categoria text not null default '',
  centro_costo text not null default '',
  motivo text not null default '',

  -- Con qué se pagó y qué comprobante hay
  medio text not null check (medio in ('tarjeta_empresa', 'propio', 'cuenta_corriente')),
  tarjeta_id uuid references public.rg_tarjetas (id),
  comprobante text not null check (comprobante in ('factura_a', 'factura_b', 'factura_c', 'ticket', 'sin_comprobante')),
  punto_venta int,
  numero bigint,
  cae text not null default '',
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  importe numeric(14, 2) not null check (importe >= 0),     -- total del comprobante, IVA incluido
  iva numeric(14, 2) not null default 0 check (iva >= 0),   -- solo informativo para Factura A

  -- Propina fuera del comprobante y parte personal pagada con la tarjeta de la empresa
  propina numeric(14, 2) not null default 0 check (propina >= 0),
  propina_propia boolean not null default false,            -- true: la pagó de su bolsillo → se reembolsa
  parte_personal numeric(14, 2) not null default 0 check (parte_personal >= 0),

  -- Comidas y representación
  asistentes jsonb not null default '[]' check (jsonb_typeof(asistentes) = 'array'),  -- [{nombre, empresa, interno}]
  cliente text not null default '',
  reembolsable_cliente boolean not null default false,

  -- Circuito
  estado text not null default 'borrador' check (estado in ('borrador', 'enviado', 'aprobado', 'rechazado')),
  enviado_el timestamptz,
  revision_nota text not null default '',
  revisado_por text,
  revisado_el timestamptz,
  resumen_mes date check (resumen_mes = date_trunc('month', resumen_mes)::date),  -- resumen de tarjeta al que corresponde
  conciliado_el timestamptz,
  conciliado_por text,
  pagado_el date,                                           -- pago del reembolso por tesorería
  pagado_por text,

  -- Lo que la empresa le debe a la persona (+) o la persona a la empresa (−)
  a_reembolsar numeric(14, 2) generated always as (
    case when medio = 'propio' then importe + propina
         when propina_propia then propina
         else 0 end
    - case when medio = 'tarjeta_empresa' then parte_personal else 0 end
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((medio = 'tarjeta_empresa') = (tarjeta_id is not null)),
  check (parte_personal <= importe)
);
create index rg_gastos_email on public.rg_gastos (email, fecha desc);
create index rg_gastos_estado on public.rg_gastos (estado);
create index rg_gastos_tarjeta on public.rg_gastos (tarjeta_id, resumen_mes);

-- Reglas de cada rol (las políticas solo dicen quién toca la fila; el trigger dice qué campos):
--   dueño        → edita datos mientras está en borrador o rechazado, y lo pasa a borrador/enviado
--   admin        → aprueba o rechaza un enviado (y puede corregir cualquier cosa)
--   consolidador → solo resumen_mes, conciliado y pagado, y solo sobre aprobados
create or replace function public.rg_reglas()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  yo text := lower(auth.jwt() ->> 'email');
  admin boolean := public.tm_es_admin();
  cambios text[];
  consolidacion text[] := array['resumen_mes', 'conciliado_el', 'conciliado_por', 'pagado_el', 'pagado_por'];
  reservados text[] := array['id', 'email', 'created_at', 'enviado_el', 'revision_nota', 'revisado_por', 'revisado_el',
    'resumen_mes', 'conciliado_el', 'conciliado_por', 'pagado_el', 'pagado_por'];
begin
  if tg_op = 'INSERT' then
    if new.email <> yo and not admin then raise exception 'Solo podés cargar gastos propios'; end if;
    if new.estado not in ('borrador', 'enviado') then raise exception 'Un gasto nuevo entra como borrador o enviado'; end if;
    new.revision_nota := ''; new.revisado_por := null; new.revisado_el := null;
    new.conciliado_el := null; new.conciliado_por := null; new.pagado_el := null; new.pagado_por := null;
    new.enviado_el := case when new.estado = 'enviado' then now() end;
    new.resumen_mes := case when new.medio = 'tarjeta_empresa' then date_trunc('month', new.fecha)::date end;
    return new;
  end if;

  select coalesce(array_agg(k), '{}') into cambios
    from jsonb_each(to_jsonb(new)) n(k, v)
    where v is distinct from to_jsonb(old) -> k and k not in ('updated_at', 'a_reembolsar');
  if cardinality(cambios) = 0 then return old; end if;
  new.updated_at := now();

  if cambios <@ consolidacion then
    -- Tesorería: conciliar contra el resumen de la tarjeta y marcar reembolsos pagados
    if not public.rg_consolida() then raise exception 'Solo tesorería concilia y marca pagos'; end if;
    if old.estado <> 'aprobado' then raise exception 'Solo se concilian o pagan gastos aprobados'; end if;
    -- pagado_el también registra cuándo la persona devolvió una parte personal (a_reembolsar negativo)
    if new.pagado_el is not null and old.a_reembolsar = 0 then raise exception 'Este gasto no tiene reembolso'; end if;
    if new.conciliado_el is distinct from old.conciliado_el then
      new.conciliado_por := case when new.conciliado_el is not null then yo end;
    end if;
    if new.pagado_el is distinct from old.pagado_el then
      new.pagado_por := case when new.pagado_el is not null then yo end;
    end if;
    return new;
  end if;

  if new.estado in ('aprobado', 'rechazado') and new.estado is distinct from old.estado then
    -- Revisión del aprobador
    if not admin then raise exception 'Solo el aprobador aprueba o rechaza'; end if;
    if old.estado <> 'enviado' then raise exception 'Solo se aprueba o rechaza un gasto enviado'; end if;
    if new.estado = 'rechazado' and trim(new.revision_nota) = '' then raise exception 'Indicá el motivo del rechazo'; end if;
    new.revisado_por := yo; new.revisado_el := now();
  elsif admin and old.email <> yo then
    null;  -- el aprobador corrige un gasto ajeno
  elsif old.email = yo then
    if old.estado not in ('borrador', 'rechazado') then raise exception 'Este gasto ya se envió: no se puede modificar'; end if;
    if new.estado not in ('borrador', 'enviado') then raise exception 'Solo el aprobador cambia el estado'; end if;
    if cambios && reservados then raise exception 'Campo reservado al aprobador o a tesorería'; end if;
    if new.estado = 'enviado' then new.enviado_el := now(); end if;
  else
    raise exception 'Sin permiso para modificar este gasto';
  end if;

  -- El resumen de la tarjeta sale del mes de la compra, salvo que tesorería lo haya movido.
  if new.medio <> 'tarjeta_empresa' then
    new.resumen_mes := null;
  elsif new.resumen_mes is not distinct from old.resumen_mes
        and (new.fecha <> old.fecha or old.medio <> 'tarjeta_empresa' or old.resumen_mes is null) then
    new.resumen_mes := date_trunc('month', new.fecha)::date;
  end if;
  return new;
end $$;
create trigger rg_reglas before insert or update on public.rg_gastos
  for each row execute function public.rg_reglas();

alter table public.rg_gastos enable row level security;
create policy "rg gastos: ver" on public.rg_gastos for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') and public.rg_carga() or public.rg_consolida());
create policy "rg gastos: crear" on public.rg_gastos for insert to authenticated with check (public.rg_carga());
create policy "rg gastos: editar" on public.rg_gastos for update to authenticated
  using (email = lower(auth.jwt() ->> 'email') and public.rg_carga() or public.rg_consolida())
  with check (email = lower(auth.jwt() ->> 'email') and public.rg_carga() or public.rg_consolida());
create policy "rg gastos: borrar" on public.rg_gastos for delete to authenticated
  using (email = lower(auth.jwt() ->> 'email') and estado in ('borrador', 'rechazado') or public.tm_es_admin());

-- ─── Comprobantes: bucket privado, carpeta por gasto (<gasto_id>/<archivo>) ──
create table public.rg_archivos (
  id uuid primary key default gen_random_uuid(),
  gasto_id uuid not null references public.rg_gastos (id) on delete cascade,
  ruta text not null unique,
  nombre text not null,
  created_at timestamptz not null default now()
);
create index rg_archivos_gasto on public.rg_archivos (gasto_id);
alter table public.rg_archivos enable row level security;

-- Se ve si se ve el gasto; se agrega o quita mientras el dueño puede editarlo.
create or replace function public.rg_puede_editar(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rg_gastos where id = g and (
    email = lower(auth.jwt() ->> 'email') and estado in ('borrador', 'rechazado') or public.tm_es_admin()))
$$;
create or replace function public.rg_puede_ver(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rg_gastos where id = g and (
    email = lower(auth.jwt() ->> 'email') and public.rg_carga() or public.rg_consolida()))
$$;

create policy "rg archivos: ver" on public.rg_archivos for select to authenticated using (public.rg_puede_ver(gasto_id));
create policy "rg archivos: agregar" on public.rg_archivos for insert to authenticated with check (public.rg_puede_editar(gasto_id));
create policy "rg archivos: quitar" on public.rg_archivos for delete to authenticated using (public.rg_puede_editar(gasto_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gastos', 'gastos', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create policy "gastos: ver" on storage.objects for select to authenticated
  using (bucket_id = 'gastos' and public.rg_puede_ver(((storage.foldername(name))[1])::uuid));
create policy "gastos: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'gastos' and public.rg_puede_editar(((storage.foldername(name))[1])::uuid));
create policy "gastos: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'gastos' and public.rg_puede_editar(((storage.foldername(name))[1])::uuid));

revoke all on function public.rg_carga(), public.rg_consolida(), public.rg_puede_editar(uuid), public.rg_puede_ver(uuid) from public, anon;
grant execute on function public.rg_carga(), public.rg_consolida(), public.rg_puede_editar(uuid), public.rg_puede_ver(uuid) to authenticated;
revoke all on public.rg_tarjetas, public.rg_gastos, public.rg_archivos from anon;
