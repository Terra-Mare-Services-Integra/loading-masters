-- Tracker Lean: una tarea se replica en otros tableros desde cualquier tablero, no solo desde el principal.
-- Sigue siendo una sola tarea (compartida_con): completar, editar, notas y adjuntos se ven en todos.
-- Reglas: se agrega un tablero si sos miembro de él; se quita si sos miembro de ese tablero o del de origen.
-- El admin del portal y los miembros del tablero principal (que ven todo) comparten con cualquiera.
-- Ahora también se controla al crear la tarea (antes el trigger solo miraba las ediciones).
create or replace function public.lean_proteger_compartida()
returns trigger language plpgsql as $$
declare
  antes uuid[] := '{}';
  b uuid;
begin
  if tg_op = 'UPDATE' then antes := old.compartida_con; end if;
  -- Sin repetidos ni el propio tablero de origen.
  new.compartida_con := array(select distinct x from unnest(new.compartida_con) x where x is not null and x <> new.tablero_id);
  if new.compartida_con is not distinct from antes or public.tm_es_admin() or public.lean_es_miembro_principal() then
    return new;
  end if;
  for b in select unnest(new.compartida_con) except select unnest(antes) loop
    if not public.lean_es_miembro(b) then
      raise exception 'Solo se puede replicar la tarea en tableros de los que sos miembro';
    end if;
  end loop;
  for b in select unnest(antes) except select unnest(new.compartida_con) loop
    if not (public.lean_es_miembro(b) or public.lean_es_miembro(new.tablero_id)) then
      raise exception 'Solo quitan la tarea de un tablero sus miembros o los del tablero donde se creó';
    end if;
  end loop;
  return new;
end $$;

drop trigger lean_tareas_compartida on public.lean_tareas;
create trigger lean_tareas_compartida before insert or update on public.lean_tareas
  for each row execute function public.lean_proteger_compartida();

-- Quitar la tarea de un tablero donde está replicada. Va por función porque, si el usuario solo es miembro de
-- ese tablero, después del cambio ya no ve la tarea y la política de edición rechazaría el update.
create or replace function public.lean_quitar_de_tablero(tarea uuid, tablero uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.lean_es_miembro(tablero) or public.tm_es_admin() or public.lean_es_miembro_principal()) then
    raise exception 'No sos miembro de ese tablero';
  end if;
  update public.lean_tareas set compartida_con = array_remove(compartida_con, tablero)
  where id = tarea and tablero = any(compartida_con);
  if not found then raise exception 'La tarea no está replicada en ese tablero'; end if;
end $$;
revoke all on function public.lean_quitar_de_tablero(uuid, uuid) from public, anon;
grant execute on function public.lean_quitar_de_tablero(uuid, uuid) to authenticated;
