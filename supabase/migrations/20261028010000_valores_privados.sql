-- Los valores de los Excel internos (costos, márgenes, participación) viven solo en la base:
-- el repositorio es público. `original` guarda los valores del Excel para poder volver a ellos.
alter table public.escenarios add column original jsonb;

-- Datos de referencia que no van al código (por ejemplo, el paso histórico mar-26 → oct-26).
create table public.referencias (
  clave text primary key,
  valor jsonb not null,
  descripcion text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email')
);

create trigger referencias_updated_at
  before update on public.referencias
  for each row execute function public.tocar_updated_at();

alter table public.referencias enable row level security;

create policy "usuarios autorizados leen" on public.referencias
  for select to authenticated using (public.es_usuario_autorizado());

revoke all on public.referencias from anon;
