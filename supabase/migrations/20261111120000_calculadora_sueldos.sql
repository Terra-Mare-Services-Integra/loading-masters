-- Calculadora de sueldos (repo calculadora-sueldos). Prefijo cs_.
-- Acceso desde el panel de Administración del portal:
--   tm_accesos.modulos 'sueldos'        → usa la calculadora (lee escalas, parámetros y log; guarda sus tripulaciones)
--   tm_accesos.modulos 'sueldos-edita'  → además carga actas, divisas, parámetros y overrides
--   tm_admins                           → todo
-- Los valores (básicos, tasas, montos) NO van en este archivo: el repo es público. Se cargan desde la app.

create or replace function public.cs_puede_ver()
returns boolean language sql stable security definer set search_path = public as $$
  select public.tm_es_admin() or exists (
    select 1 from public.tm_accesos where user_id = auth.uid() and modulos && array['sueldos', 'sueldos-edita'])
$$;

create or replace function public.cs_puede_editar()
returns boolean language sql stable security definer set search_path = public as $$
  select public.tm_es_admin() or exists (
    select 1 from public.tm_accesos where user_id = auth.uid() and 'sueldos-edita' = any(modulos))
$$;

create or replace function public.cs_email() returns text language sql stable as $$ select lower(auth.jwt() ->> 'email') $$;

-- ─── Log de cambios (solo se agrega; nadie edita ni borra) ───────────────────
create table public.cs_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  email text not null default public.cs_email(),
  tipo text not null check (tipo in ('escala', 'divisas', 'parametros', 'override', 'categorias', 'logica', 'nota')),
  descripcion text not null check (length(trim(descripcion)) > 0),
  vigente_desde date,
  version text,
  detalle jsonb not null default '{}'
);
create unique index cs_log_version_logica on public.cs_log (version) where tipo = 'logica';
alter table public.cs_log enable row level security;
create policy "cs log: ver" on public.cs_log for select to authenticated using (public.cs_puede_ver());
create policy "cs log: agregar notas" on public.cs_log for insert to authenticated
  with check (public.cs_puede_editar() and tipo in ('nota', 'logica') and email = public.cs_email());

create or replace function public.cs_registrar(p_tipo text, p_desc text, p_desde date, p_detalle jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.cs_log (tipo, descripcion, vigente_desde, detalle) values (p_tipo, p_desc, p_desde, coalesce(p_detalle, '{}'))
$$;

-- ─── Categorías: cómo se obtiene el básico ───────────────────────────────────
-- forma 'monto' → sale de las actas (cs_basicos); 'coef' → coef × básico vigente de la categoría base.
create table public.cs_categorias (
  clave text primary key,
  forma text not null default 'monto' check (forma in ('monto', 'coef')),
  base text references public.cs_categorias (clave),
  coef numeric(12, 8),
  updated_at timestamptz not null default now(),
  updated_by text default public.cs_email(),
  check (forma = 'monto' or (base is not null and coef is not null and base <> clave))
);
alter table public.cs_categorias enable row level security;
create policy "cs categorias: ver" on public.cs_categorias for select to authenticated using (public.cs_puede_ver());
create policy "cs categorias: editar" on public.cs_categorias for all to authenticated
  using (public.cs_puede_editar()) with check (public.cs_puede_editar());

create or replace function public.cs_log_categorias()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.cs_registrar('categorias',
    case tg_op when 'INSERT' then 'Categoría agregada: ' when 'DELETE' then 'Categoría quitada: ' else 'Regla de categoría cambiada: ' end
      || coalesce(new.clave, old.clave), null,
    jsonb_build_object('antes', case when tg_op <> 'INSERT' then to_jsonb(old) end, 'despues', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  return coalesce(new, old);
end $$;
create trigger cs_log_categorias after insert or update or delete on public.cs_categorias
  for each row execute function public.cs_log_categorias();

-- ─── Actas paritarias y básicos por mes ──────────────────────────────────────
create table public.cs_actas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  firmada_el date,                 -- fecha del acta (puede ser posterior a los meses que fija: retroactivo)
  notas text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null default public.cs_email(),
  updated_at timestamptz not null default now(),
  updated_by text not null default public.cs_email()
);
create table public.cs_basicos (
  acta_id uuid not null references public.cs_actas (id) on delete cascade,
  categoria text not null,
  mes date not null check (mes = date_trunc('month', mes)::date),
  monto numeric(16, 2) not null check (monto >= 0),
  primary key (acta_id, categoria, mes)
);
alter table public.cs_actas enable row level security;
alter table public.cs_basicos enable row level security;
create policy "cs actas: ver" on public.cs_actas for select to authenticated using (public.cs_puede_ver());
create policy "cs basicos: ver" on public.cs_basicos for select to authenticated using (public.cs_puede_ver());
-- Las escrituras pasan por cs_guardar_acta / cs_borrar_acta, que dejan el log.

create or replace function public.cs_guardar_acta(p_acta jsonb, p_basicos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p_acta ->> 'id', '')::uuid;
  v_nueva boolean := v_id is null;
  v_antes jsonb;
  v_cambios jsonb;
  v_desde date;
begin
  if not public.cs_puede_editar() then raise exception 'No autorizado'; end if;
  if v_nueva then
    insert into public.cs_actas (nombre, firmada_el, notas)
      values (p_acta ->> 'nombre', nullif(p_acta ->> 'firmada_el', '')::date, coalesce(p_acta ->> 'notas', ''))
      returning id into v_id;
  else
    update public.cs_actas set nombre = p_acta ->> 'nombre', firmada_el = nullif(p_acta ->> 'firmada_el', '')::date,
      notas = coalesce(p_acta ->> 'notas', ''), updated_at = now(), updated_by = public.cs_email()
      where id = v_id;
    if not found then raise exception 'Acta inexistente'; end if;
  end if;

  select coalesce(jsonb_object_agg(categoria || '|' || mes, monto), '{}') into v_antes from public.cs_basicos where acta_id = v_id;
  delete from public.cs_basicos where acta_id = v_id;
  insert into public.cs_basicos (acta_id, categoria, mes, monto)
    select v_id, b ->> 'categoria', (b ->> 'mes')::date, (b ->> 'monto')::numeric
    from jsonb_array_elements(p_basicos) b where nullif(b ->> 'monto', '') is not null;

  select coalesce(jsonb_agg(jsonb_build_object('categoria', k.categoria, 'mes', k.mes, 'antes', (v_antes ->> (k.categoria || '|' || k.mes))::numeric, 'despues', n.monto)
           order by k.mes, k.categoria), '[]'),
         min(k.mes)
    into v_cambios, v_desde
    from (select categoria, mes from public.cs_basicos where acta_id = v_id
          union select split_part(key, '|', 1), split_part(key, '|', 2)::date from jsonb_object_keys(v_antes) key) k
    left join public.cs_basicos n on n.acta_id = v_id and n.categoria = k.categoria and n.mes = k.mes
    where (v_antes ->> (k.categoria || '|' || k.mes))::numeric is distinct from n.monto;

  if v_nueva or jsonb_array_length(v_cambios) > 0 then
    perform public.cs_registrar('escala',
      (case when v_nueva then 'Acta cargada: ' else 'Acta modificada: ' end) || (p_acta ->> 'nombre')
        || ' (' || jsonb_array_length(v_cambios) || ' valores)',
      v_desde, jsonb_build_object('acta_id', v_id, 'firmada_el', p_acta ->> 'firmada_el', 'cambios', v_cambios));
  end if;
  return v_id;
end $$;

create or replace function public.cs_borrar_acta(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_acta public.cs_actas; v_basicos jsonb; v_desde date;
begin
  if not public.cs_puede_editar() then raise exception 'No autorizado'; end if;
  select * into v_acta from public.cs_actas where id = p_id;
  if not found then return; end if;
  select jsonb_agg(to_jsonb(b) - 'acta_id'), min(mes) into v_basicos, v_desde from public.cs_basicos b where acta_id = p_id;
  delete from public.cs_actas where id = p_id;
  perform public.cs_registrar('escala', 'Acta borrada: ' || v_acta.nombre, v_desde,
    jsonb_build_object('acta', to_jsonb(v_acta), 'basicos', coalesce(v_basicos, '[]')));
end $$;

-- ─── Tablas versionadas por vigencia: parámetros de cálculo y divisas ────────
create table public.cs_parametros (
  id uuid primary key default gen_random_uuid(),
  vigente_desde date not null,
  valores jsonb not null check (jsonb_typeof(valores) = 'object'),  -- { terramare:{…}, eventuales:{…}, efectivos:{…}, globales:{…} }
  nota text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null default public.cs_email()
);
create table public.cs_divisas (
  id uuid primary key default gen_random_uuid(),
  vigente_desde date not null,
  valores jsonb not null check (jsonb_typeof(valores) = 'object'),  -- { <categoria>: { limitrofe, no_limitrofe } } USD/día
  nota text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null default public.cs_email()
);
alter table public.cs_parametros enable row level security;
alter table public.cs_divisas enable row level security;
create policy "cs parametros: ver" on public.cs_parametros for select to authenticated using (public.cs_puede_ver());
create policy "cs parametros: agregar" on public.cs_parametros for insert to authenticated with check (public.cs_puede_editar());
create policy "cs divisas: ver" on public.cs_divisas for select to authenticated using (public.cs_puede_ver());
create policy "cs divisas: agregar" on public.cs_divisas for insert to authenticated with check (public.cs_puede_editar());

-- Diferencias entre la versión nueva y la que regía antes de su vigencia (rutas "regimen.clave").
create or replace function public.cs_diff(a jsonb, b jsonb, prefijo text default '')
returns jsonb language plpgsql immutable as $$
declare k text; out jsonb := '[]'; va jsonb; vb jsonb;
begin
  for k in select jsonb_object_keys(coalesce(a, '{}')) union select jsonb_object_keys(coalesce(b, '{}')) order by 1 loop
    va := a -> k; vb := b -> k;
    if jsonb_typeof(coalesce(va, vb)) = 'object' then
      out := out || public.cs_diff(va, vb, prefijo || k || '.');
    elsif va is distinct from vb then
      out := out || jsonb_build_array(jsonb_build_object('clave', prefijo || k, 'antes', va, 'despues', vb));
    end if;
  end loop;
  return out;
end $$;

create or replace function public.cs_log_version()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prev jsonb; v_tipo text := case tg_table_name when 'cs_parametros' then 'parametros' else 'divisas' end;
begin
  execute format('select valores from public.%I where vigente_desde <= $1 and id <> $2 order by vigente_desde desc, created_at desc limit 1', tg_table_name)
    into v_prev using new.vigente_desde, new.id;
  perform public.cs_registrar(v_tipo,
    (case v_tipo when 'parametros' then 'Parámetros de cálculo' else 'Divisas USD/día' end) || ' actualizados'
      || case when new.nota <> '' then ': ' || new.nota else '' end,
    new.vigente_desde, jsonb_build_object('id', new.id, 'cambios', public.cs_diff(v_prev, new.valores)));
  return new;
end $$;
create trigger cs_log_parametros after insert on public.cs_parametros for each row execute function public.cs_log_version();
create trigger cs_log_divisas after insert on public.cs_divisas for each row execute function public.cs_log_version();

-- ─── Override manual de un básico (queda registrado) ─────────────────────────
create table public.cs_overrides (
  id uuid primary key default gen_random_uuid(),
  categoria text not null,
  monto numeric(16, 2) not null check (monto >= 0),
  desde date not null check (desde = date_trunc('month', desde)::date),
  hasta date check (hasta is null or hasta >= desde),
  motivo text not null check (length(trim(motivo)) > 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text not null default public.cs_email(),
  anulado_el timestamptz,
  anulado_por text
);
alter table public.cs_overrides enable row level security;
create policy "cs overrides: ver" on public.cs_overrides for select to authenticated using (public.cs_puede_ver());
create policy "cs overrides: agregar" on public.cs_overrides for insert to authenticated with check (public.cs_puede_editar());
create policy "cs overrides: anular" on public.cs_overrides for update to authenticated using (public.cs_puede_editar()) with check (public.cs_puede_editar());

create or replace function public.cs_log_override()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.activo is distinct from old.activo and not new.activo then
      new.anulado_el := now(); new.anulado_por := public.cs_email();
    end if;
    -- Solo se puede anular; el resto queda como se cargó.
    new.categoria := old.categoria; new.monto := old.monto; new.desde := old.desde; new.hasta := old.hasta; new.motivo := old.motivo;
  end if;
  return new;
end $$;
create trigger cs_override_reglas before update on public.cs_overrides for each row execute function public.cs_log_override();

create or replace function public.cs_log_override_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.cs_registrar('override', 'Override manual de ' || new.categoria || ': ' || new.motivo, new.desde, to_jsonb(new));
  elsif old.activo and not new.activo then
    perform public.cs_registrar('override', 'Override anulado: ' || new.categoria, new.desde, to_jsonb(new));
  end if;
  return new;
end $$;
create trigger cs_log_override after insert or update on public.cs_overrides for each row execute function public.cs_log_override_after();

-- ─── Tipo de cambio por fecha (caché de BNA / BCRA, la llena la función tipo-cambio) ──
create table public.cs_tipo_cambio (
  fecha date primary key,              -- fecha pedida
  fecha_bna date,                      -- fecha de la cotización BNA usada (último hábil ≤ fecha)
  divisa_compra numeric(14, 4),
  divisa_venta numeric(14, 4),
  billete_compra numeric(14, 4),
  billete_venta numeric(14, 4),
  fecha_bcra date,
  bcra_divisa_venta numeric(14, 4),
  actualizado_at timestamptz not null default now()
);
alter table public.cs_tipo_cambio enable row level security;
create policy "cs tipo cambio: ver" on public.cs_tipo_cambio for select to authenticated using (public.cs_puede_ver());

-- ─── Tripulaciones guardadas (Crewing) ───────────────────────────────────────
create table public.cs_crewing (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  datos jsonb not null default '{}',
  created_at timestamptz not null default now(),
  created_by text not null default public.cs_email(),
  updated_at timestamptz not null default now(),
  updated_by text not null default public.cs_email()
);
alter table public.cs_crewing enable row level security;
create policy "cs crewing: ver" on public.cs_crewing for select to authenticated using (public.cs_puede_ver());
create policy "cs crewing: crear" on public.cs_crewing for insert to authenticated with check (public.cs_puede_ver() and created_by = public.cs_email());
create policy "cs crewing: editar" on public.cs_crewing for update to authenticated using (public.cs_puede_ver()) with check (public.cs_puede_ver());
create policy "cs crewing: borrar" on public.cs_crewing for delete to authenticated using (created_by = public.cs_email() or public.cs_puede_editar());

create or replace function public.cs_crewing_tocar()
returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := public.cs_email(); return new; end $$;
create trigger cs_crewing_tocar before update on public.cs_crewing for each row execute function public.cs_crewing_tocar();

revoke all on function public.cs_puede_ver(), public.cs_puede_editar(), public.cs_guardar_acta(jsonb, jsonb), public.cs_borrar_acta(uuid),
  public.cs_registrar(text, text, date, jsonb) from public, anon;
grant execute on function public.cs_puede_ver(), public.cs_puede_editar(), public.cs_guardar_acta(jsonb, jsonb), public.cs_borrar_acta(uuid) to authenticated;
revoke all on public.cs_log, public.cs_categorias, public.cs_actas, public.cs_basicos, public.cs_parametros, public.cs_divisas,
  public.cs_overrides, public.cs_tipo_cambio, public.cs_crewing from anon;
