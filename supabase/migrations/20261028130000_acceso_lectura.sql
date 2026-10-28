-- Acceso de solo lectura para personas fuera de @terra-mare.com.ar (por ejemplo, socios). Los mails
-- se cargan en la base, no en el repo. Pueden leer todo; escribir sigue siendo solo de es_usuario_autorizado().
create table public.accesos_lectura (
  email text primary key check (email = lower(email)),
  nota text not null default '',
  created_at timestamptz not null default now()
);
-- Sin políticas: nadie la lee ni la edita desde la app; se administra desde la base.
alter table public.accesos_lectura enable row level security;

create or replace function public.es_lector()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.es_usuario_autorizado()
      or exists (select 1 from public.accesos_lectura where email = lower(auth.jwt() ->> 'email'))
$$;

-- Qué puede hacer el usuario en la app: 'editor' (todo), 'lector' (solo ver) o null (sin acceso).
create or replace function public.rol_usuario()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public.es_usuario_autorizado() then 'editor' when public.es_lector() then 'lector' end
$$;

revoke all on function public.es_lector(), public.rol_usuario() from public, anon;
grant execute on function public.es_lector(), public.rol_usuario() to authenticated;

-- Lectura en todas las tablas con RLS del esquema public (las políticas de lectura se suman a las existentes).
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname <> 'accesos_lectura'
  loop
    execute format('create policy "lectores: leer" on public.%I for select to authenticated using (public.es_lector())', t.relname);
  end loop;
end $$;

create policy "documentos: lectores" on storage.objects
  for select to authenticated
  using (bucket_id = 'documentos' and public.es_lector());
