-- Notas del tracker editables por un administrador: el admin del tablero de la tarea (o de un tablero con el que
-- está compartida, o del tablero principal) y los admins del portal (tm_admins) pueden corregir el texto y la
-- fecha de cualquier nota. Para no perder trazabilidad, queda registrado quién la editó y cuándo, y el resto de
-- la fila (autor, tarea, reunión, fecha de carga) no se puede cambiar.
alter table public.lean_notas
  add column editada_por text,
  add column editada_el timestamptz;

create or replace function public.lean_admin_tarea(tarea uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.tm_es_admin() or exists (
    select 1 from public.lean_tareas t
    where t.id = tarea
      and (public.lean_es_admin(t.tablero_id)
        or exists (select 1 from unnest(t.compartida_con) b where public.lean_es_admin(b))
        or exists (select 1 from public.lean_tableros p where p.principal and public.lean_es_admin(p.id)))
  )
$$;
revoke all on function public.lean_admin_tarea(uuid) from public, anon;
grant execute on function public.lean_admin_tarea(uuid) to authenticated;

create policy "lean notas: editar admin" on public.lean_notas for update to authenticated
  using (public.lean_admin_tarea(tarea_id)) with check (public.lean_admin_tarea(tarea_id));

create or replace function public.lean_nota_editada()
returns trigger language plpgsql as $$
begin
  if new.tarea_id is distinct from old.tarea_id or new.autor is distinct from old.autor
     or new.created_at is distinct from old.created_at or new.reunion_id is distinct from old.reunion_id then
    raise exception 'De una nota solo se editan el texto y la fecha';
  end if;
  new.editada_por := lower(auth.jwt() ->> 'email');
  new.editada_el := now();
  return new;
end $$;
create trigger lean_notas_editada before update on public.lean_notas
  for each row execute function public.lean_nota_editada();
