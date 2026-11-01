-- Adjuntos de las tareas del tracker: links (por ejemplo, carpetas de SharePoint) y archivos subidos.
-- Quien ve la tarea ve y agrega sus adjuntos; la visibilidad sale de las políticas de lean_tareas.
create table public.lean_adjuntos (
  id uuid primary key default gen_random_uuid(),
  tarea_id uuid not null references public.lean_tareas(id) on delete cascade,
  tipo text not null check (tipo in ('link', 'archivo')),
  nombre text not null check (length(trim(nombre)) > 0),
  url text check (url ~* '^https?://'),
  ruta text,
  creado_por text not null default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  check ((tipo = 'link') = (url is not null) and (tipo = 'archivo') = (ruta is not null))
);
create index lean_adjuntos_tarea on public.lean_adjuntos (tarea_id);
alter table public.lean_adjuntos enable row level security;

create policy "lean adjuntos: ver" on public.lean_adjuntos for select to authenticated
  using (exists (select 1 from public.lean_tareas t where t.id = tarea_id));
create policy "lean adjuntos: agregar" on public.lean_adjuntos for insert to authenticated
  with check (exists (select 1 from public.lean_tareas t where t.id = tarea_id));
create policy "lean adjuntos: borrar" on public.lean_adjuntos for delete to authenticated
  using (exists (select 1 from public.lean_tareas t where t.id = tarea_id));

-- Archivos: bucket privado, carpeta por tarea (tareas/<tarea_id>/<archivo>).
insert into storage.buckets (id, name, public, file_size_limit)
values ('tracker', 'tracker', false, 26214400)
on conflict (id) do nothing;

create policy "tracker: ver" on storage.objects for select to authenticated
  using (bucket_id = 'tracker' and exists (
    select 1 from public.lean_tareas t where t.id::text = (storage.foldername(name))[2]));
create policy "tracker: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'tracker' and (storage.foldername(name))[1] = 'tareas' and exists (
    select 1 from public.lean_tareas t where t.id::text = (storage.foldername(name))[2]));
create policy "tracker: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'tracker' and exists (
    select 1 from public.lean_tareas t where t.id::text = (storage.foldername(name))[2]));
