-- Tareas compartidas: una tarea vive en su tablero y además aparece, como tarea normal, en los tableros
-- con los que se comparte (desde el tablero principal). Es la misma fila: lo que se cambia en uno se ve en todos.
alter table public.lean_tareas add column compartida_con uuid[] not null default '{}';
create index lean_tareas_compartida on public.lean_tareas using gin (compartida_con);

create or replace function public.lean_ve_tarea(t uuid, compartida uuid[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.lean_es_miembro(t) or public.lean_es_miembro_principal()
      or exists (select 1 from unnest(compartida) b where public.lean_es_miembro(b))
$$;
revoke all on function public.lean_ve_tarea(uuid, uuid[]) from public, anon;
grant execute on function public.lean_ve_tarea(uuid, uuid[]) to authenticated;

drop policy "lean tareas: ver" on public.lean_tareas;
drop policy "lean tareas: editar" on public.lean_tareas;
create policy "lean tareas: ver" on public.lean_tareas for select to authenticated
  using (public.lean_ve_tarea(tablero_id, compartida_con));
create policy "lean tareas: editar" on public.lean_tareas for update to authenticated
  using (public.lean_ve_tarea(tablero_id, compartida_con))
  with check (public.lean_ve_tarea(tablero_id, compartida_con));

-- Solo los miembros del tablero principal deciden con quién se comparte.
create or replace function public.lean_proteger_compartida()
returns trigger language plpgsql as $$
begin
  if new.compartida_con is distinct from old.compartida_con and not public.lean_es_miembro_principal() then
    raise exception 'Solo se comparte desde el tablero principal';
  end if;
  return new;
end $$;
create trigger lean_tareas_compartida before update on public.lean_tareas
  for each row execute function public.lean_proteger_compartida();
