-- Terra Mare como empresa aparte: este proyecto es el Supabase de Terra Mare (Loading Masters, portal y
-- tracker), con una sola lista de usuarios. Los accesos se manejan desde el panel de Administración del portal.

-- ─── Admins de Terra Mare ───────────────────────────────────────────────────
create table public.tm_admins (email text primary key check (email = lower(email)));
alter table public.tm_admins enable row level security;

create or replace function public.tm_es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tm_admins where email = lower(auth.jwt() ->> 'email'))
$$;

-- ─── Loading Masters: acceso por lista (ya no por dominio) ─────────────────
-- 'editor' ve y carga todo; 'lector' solo ve Resultado y Dashboards.
create table public.lm_accesos (
  email text primary key check (email = lower(email) and email like '%@%'),
  rol text not null check (rol in ('editor', 'lector')),
  updated_at timestamptz not null default now(),
  updated_by text default lower(auth.jwt() ->> 'email')
);
alter table public.lm_accesos enable row level security;
create policy "lm accesos: admin" on public.lm_accesos for all to authenticated
  using (public.tm_es_admin()) with check (public.tm_es_admin());

insert into public.lm_accesos (email, rol) select email, 'lector' from public.accesos_lectura on conflict do nothing;

create or replace function public.es_usuario_autorizado()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.lm_accesos where email = lower(auth.jwt() ->> 'email') and rol = 'editor')
$$;

create or replace function public.es_lector()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.lm_accesos where email = lower(auth.jwt() ->> 'email'))
$$;

drop table public.accesos_lectura;

-- ─── Portal: quién entra y qué módulos ve ───────────────────────────────────
create table public.tm_accesos (
  user_id uuid primary key references auth.users (id) on delete cascade,
  modulos text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by text default lower(auth.jwt() ->> 'email')
);
alter table public.tm_accesos enable row level security;
create policy "tm accesos: propio" on public.tm_accesos for select to authenticated using (user_id = auth.uid() or public.tm_es_admin());
create policy "tm accesos: admin" on public.tm_accesos for all to authenticated using (public.tm_es_admin()) with check (public.tm_es_admin());

-- ─── Tracker Lean ───────────────────────────────────────────────────────────
create table public.lean_tableros (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  creado_por text not null default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

create table public.lean_miembros (
  tablero_id uuid not null references public.lean_tableros (id) on delete cascade,
  email text not null check (email = lower(email) and email like '%@%'),
  nombre text not null default '',
  rol text not null default 'miembro' check (rol in ('admin', 'miembro')),
  created_at timestamptz not null default now(),
  primary key (tablero_id, email)
);

create table public.lean_tareas (
  id uuid primary key default gen_random_uuid(),
  tablero_id uuid not null references public.lean_tableros (id) on delete cascade,
  proyecto text not null default '',
  titulo text not null check (length(trim(titulo)) > 0),
  responsable text not null default '',
  inicio date,
  fin_tentativa date,
  completada_el date,
  nota text not null default '',
  created_at timestamptz not null default now(),
  creado_por text default lower(auth.jwt() ->> 'email'),
  updated_at timestamptz not null default now(),
  actualizado_por text default lower(auth.jwt() ->> 'email')
);
create index lean_tareas_tablero on public.lean_tareas (tablero_id);

create or replace function public.lean_es_miembro(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.lean_miembros where tablero_id = t and email = lower(auth.jwt() ->> 'email'))
$$;

create or replace function public.lean_es_admin(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.lean_miembros where tablero_id = t and email = lower(auth.jwt() ->> 'email') and rol = 'admin')
$$;

-- Quien crea un tablero queda como admin.
create or replace function public.lean_tablero_creador()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.lean_miembros (tablero_id, email, rol) values (new.id, new.creado_por, 'admin') on conflict do nothing;
  return new;
end $$;
create trigger lean_tablero_creador after insert on public.lean_tableros
  for each row execute function public.lean_tablero_creador();

create or replace function public.lean_tocar()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.actualizado_por := lower(auth.jwt() ->> 'email');
  return new;
end $$;
create trigger lean_tareas_tocar before update on public.lean_tareas
  for each row execute function public.lean_tocar();

alter table public.lean_tableros enable row level security;
alter table public.lean_miembros enable row level security;
alter table public.lean_tareas enable row level security;

create policy "lean tableros: ver" on public.lean_tableros for select to authenticated
  using (public.lean_es_miembro(id) or creado_por = lower(auth.jwt() ->> 'email') or public.tm_es_admin());
create policy "lean tableros: crear" on public.lean_tableros for insert to authenticated with check (creado_por = lower(auth.jwt() ->> 'email'));
create policy "lean tableros: editar" on public.lean_tableros for update to authenticated using (public.lean_es_admin(id)) with check (public.lean_es_admin(id));
create policy "lean tableros: borrar" on public.lean_tableros for delete to authenticated using (public.lean_es_admin(id));

create policy "lean miembros: ver" on public.lean_miembros for select to authenticated using (public.lean_es_miembro(tablero_id) or public.tm_es_admin());
create policy "lean miembros: agregar" on public.lean_miembros for insert to authenticated with check (public.lean_es_admin(tablero_id) or public.tm_es_admin());
create policy "lean miembros: editar" on public.lean_miembros for update to authenticated using (public.lean_es_admin(tablero_id) or public.tm_es_admin()) with check (public.lean_es_admin(tablero_id) or public.tm_es_admin());
create policy "lean miembros: quitar" on public.lean_miembros for delete to authenticated using (public.lean_es_admin(tablero_id) or public.tm_es_admin());

create policy "lean tareas: ver" on public.lean_tareas for select to authenticated using (public.lean_es_miembro(tablero_id));
create policy "lean tareas: crear" on public.lean_tareas for insert to authenticated with check (public.lean_es_miembro(tablero_id));
create policy "lean tareas: editar" on public.lean_tareas for update to authenticated using (public.lean_es_miembro(tablero_id)) with check (public.lean_es_miembro(tablero_id));
create policy "lean tareas: borrar" on public.lean_tareas for delete to authenticated using (public.lean_es_miembro(tablero_id));

-- ─── Panel de Administración ────────────────────────────────────────────────
create or replace function public.tm_usuarios()
returns table (user_id uuid, email text, portal boolean, modulos text[], lm text, tableros uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tm_es_admin() then raise exception 'No autorizado'; end if;
  return query
    select au.id, au.email::text, ta.user_id is not null, coalesce(ta.modulos, '{}'),
      (select a.rol from public.lm_accesos a where a.email = lower(au.email)),
      coalesce((select array_agg(m.tablero_id) from public.lean_miembros m where m.email = lower(au.email)), '{}')
    from auth.users au
    left join public.tm_accesos ta on ta.user_id = au.id
    order by au.email;
end $$;

revoke all on function public.tm_es_admin(), public.tm_usuarios(), public.lean_es_miembro(uuid), public.lean_es_admin(uuid) from public, anon;
grant execute on function public.tm_es_admin(), public.tm_usuarios(), public.lean_es_miembro(uuid), public.lean_es_admin(uuid) to authenticated;
revoke all on public.lean_tableros, public.lean_miembros, public.lean_tareas, public.tm_accesos, public.lm_accesos, public.tm_admins from anon;
