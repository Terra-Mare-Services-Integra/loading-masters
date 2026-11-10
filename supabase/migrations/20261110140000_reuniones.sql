-- MoM (minuta de reunión) del tracker: se arma con tareas del tablero y una nota por tarea. Al guardar,
-- cada nota queda en lean_notas (en la bitácora de su tarea) con reunion_id, y la reunión guarda el orden
-- de las tareas para volver a copiar la minuta para un mail. Ven la reunión los miembros de su tablero
-- (y los del tablero principal, que ven todo).
create table public.lean_reuniones (
  id uuid primary key default gen_random_uuid(),
  tablero_id uuid not null references public.lean_tableros(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) > 0),
  fecha date not null default current_date,
  asistentes text not null default '',
  tareas uuid[] not null default '{}',            -- orden de los ítems de la minuta
  creado_por text not null default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index lean_reuniones_tablero on public.lean_reuniones (tablero_id, fecha desc);
alter table public.lean_reuniones enable row level security;

create or replace function public.lean_ve_reunion(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.lean_es_miembro(t) or public.lean_es_miembro_principal()
$$;
revoke all on function public.lean_ve_reunion(uuid) from public, anon;
grant execute on function public.lean_ve_reunion(uuid) to authenticated;

create policy "lean reuniones: ver" on public.lean_reuniones for select to authenticated
  using (public.lean_ve_reunion(tablero_id));
create policy "lean reuniones: crear" on public.lean_reuniones for insert to authenticated
  with check (creado_por = lower(auth.jwt() ->> 'email') and public.lean_ve_reunion(tablero_id));
-- Solo quien la armó la borra (las notas quedan en sus tareas, sin la reunión).
create policy "lean reuniones: borrar" on public.lean_reuniones for delete to authenticated
  using (creado_por = lower(auth.jwt() ->> 'email'));

alter table public.lean_notas add column reunion_id uuid references public.lean_reuniones(id) on delete set null;
create index lean_notas_reunion on public.lean_notas (reunion_id);

revoke all on public.lean_reuniones from anon;
