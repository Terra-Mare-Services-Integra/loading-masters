-- Tablero principal del tracker ("Terra Mare"): sus miembros ven y editan las tareas de todos los tableros.
-- Los miembros de los otros tableros siguen viendo solo el suyo (no saben que el principal existe).
alter table public.lean_tableros add column principal boolean not null default false;
create unique index lean_un_principal on public.lean_tableros (principal) where principal;

create or replace function public.lean_es_miembro_principal()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lean_miembros m join public.lean_tableros t on t.id = m.tablero_id
    where t.principal and m.email = lower(auth.jwt() ->> 'email'))
$$;
revoke all on function public.lean_es_miembro_principal() from public, anon;
grant execute on function public.lean_es_miembro_principal() to authenticated;

drop policy "lean tableros: ver" on public.lean_tableros;
create policy "lean tableros: ver" on public.lean_tableros for select to authenticated
  using (public.lean_es_miembro(id) or creado_por = lower(auth.jwt() ->> 'email') or public.tm_es_admin() or public.lean_es_miembro_principal());

drop policy "lean tareas: ver" on public.lean_tareas;
drop policy "lean tareas: editar" on public.lean_tareas;
drop policy "lean tareas: borrar" on public.lean_tareas;
create policy "lean tareas: ver" on public.lean_tareas for select to authenticated
  using (public.lean_es_miembro(tablero_id) or public.lean_es_miembro_principal());
create policy "lean tareas: editar" on public.lean_tareas for update to authenticated
  using (public.lean_es_miembro(tablero_id) or public.lean_es_miembro_principal())
  with check (public.lean_es_miembro(tablero_id) or public.lean_es_miembro_principal());
create policy "lean tareas: borrar" on public.lean_tareas for delete to authenticated
  using (public.lean_es_miembro(tablero_id) or public.lean_es_miembro_principal());
