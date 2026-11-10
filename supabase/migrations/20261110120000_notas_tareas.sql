-- Notas por fecha dentro de cada tarea del tracker: bitácora de lo que se fue hablando (por ejemplo,
-- tomando nota en vivo en una call). Para que quede trazabilidad no se editan; el autor puede borrar
-- una nota suya solo en los primeros 15 minutos (para corregir un error de tipeo).
-- Quien ve la tarea ve y agrega sus notas; la visibilidad sale de las políticas de lean_tareas.
create table public.lean_notas (
  id uuid primary key default gen_random_uuid(),
  tarea_id uuid not null references public.lean_tareas(id) on delete cascade,
  fecha date not null default current_date,
  texto text not null check (length(trim(texto)) > 0),
  autor text not null default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index lean_notas_tarea on public.lean_notas (tarea_id, fecha desc, created_at desc);
alter table public.lean_notas enable row level security;

create policy "lean notas: ver" on public.lean_notas for select to authenticated
  using (exists (select 1 from public.lean_tareas t where t.id = tarea_id));
create policy "lean notas: agregar" on public.lean_notas for insert to authenticated
  with check (autor = lower(auth.jwt() ->> 'email') and exists (select 1 from public.lean_tareas t where t.id = tarea_id));
create policy "lean notas: borrar" on public.lean_notas for delete to authenticated
  using (autor = lower(auth.jwt() ->> 'email') and created_at > now() - interval '15 minutes');

revoke all on public.lean_notas from anon;
