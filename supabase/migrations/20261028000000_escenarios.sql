-- Supuestos editables de los escenarios del resultado proyectado (arranque 75 % / esperado 100 %).
-- Si no hay fila, la app usa los valores de los Excel del usuario.
create table public.escenarios (
  clave text primary key check (clave in ('arranque', 'esperado')),
  supuestos jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email')
);

create trigger escenarios_updated_at
  before update on public.escenarios
  for each row execute function public.tocar_updated_at();

alter table public.escenarios enable row level security;

create policy "usuarios autorizados" on public.escenarios
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());

revoke all on public.escenarios from anon;
