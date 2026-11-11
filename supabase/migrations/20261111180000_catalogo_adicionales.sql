-- Calculadora de sueldos: catálogo de adicionales (Supply A/B/C, RJ, buque mayor, gasero, inflamable, …).
-- Cada adicional entra al cálculo por un "casillero" del Excel:
--   rj       → % sobre el básico (Resp. jerárquica / plus operativo)
--   supply   → % sobre básico + RJ (Supply type / buque mayor)
--   locacion → % sobre básico + RJ + supply (Locación costa afuera / buque gasero)
--   acta     → % sobre el bruto (Adicional Acta 04-08-22)
-- Los adicionales que caen en el mismo casillero se suman. Los valores se cargan desde la app (repo público).

alter table public.cs_log drop constraint cs_log_tipo_check;
alter table public.cs_log add constraint cs_log_tipo_check
  check (tipo in ('escala', 'divisas', 'parametros', 'override', 'categorias', 'adicionales', 'logica', 'nota'));

create table public.cs_adicionales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  descripcion text not null default '',
  casillero text not null check (casillero in ('rj', 'supply', 'locacion', 'acta')),
  -- [{ nombre, valor (fracción), grupos: ['cubierta','maquinas','subalterno','pilotaje','car'] (preselección por grupo) }]
  opciones jsonb not null default '[]' check (jsonb_typeof(opciones) = 'array'),
  predeterminada int not null default 0,          -- índice de la opción que se preselecciona
  por_defecto boolean not null default false,     -- viene tildado en los proyectos nuevos
  orden int not null default 100,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text not null default public.cs_email(),
  updated_at timestamptz not null default now(),
  updated_by text not null default public.cs_email()
);
alter table public.cs_adicionales enable row level security;
create policy "cs adicionales: ver" on public.cs_adicionales for select to authenticated using (public.cs_puede_ver());
create policy "cs adicionales: crear" on public.cs_adicionales for insert to authenticated with check (public.cs_puede_editar());
create policy "cs adicionales: editar" on public.cs_adicionales for update to authenticated using (public.cs_puede_editar()) with check (public.cs_puede_editar());
-- No se borran (los proyectos guardados los referencian): se desactivan.

create or replace function public.cs_log_adicionales()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now(); new.updated_by := public.cs_email();
    perform public.cs_registrar('adicionales',
      case when old.activo and not new.activo then 'Adicional desactivado: ' else 'Adicional modificado: ' end || new.nombre, null,
      jsonb_build_object('antes', to_jsonb(old) - 'updated_at' - 'updated_by', 'despues', to_jsonb(new) - 'updated_at' - 'updated_by'));
  else
    perform public.cs_registrar('adicionales', 'Adicional agregado al catálogo: ' || new.nombre, null, to_jsonb(new));
  end if;
  return new;
end $$;
create trigger cs_log_adicionales_upd before update on public.cs_adicionales for each row execute function public.cs_log_adicionales();
create trigger cs_log_adicionales_ins after insert on public.cs_adicionales for each row execute function public.cs_log_adicionales();

revoke all on public.cs_adicionales from anon;
