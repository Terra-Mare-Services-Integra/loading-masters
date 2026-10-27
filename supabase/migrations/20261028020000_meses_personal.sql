-- Cada facturación corresponde a un mes del contrato (36 meses desde el 26/10/2026) y registra la
-- factura emitida y el cobro, para el estado de cada mes (proyección / facturado / cobrado).
alter table public.certificaciones
  add column mes text check (mes ~ '^\d{4}-\d{2}$'),
  add column factura_numero text,
  add column factura_emitida_el date,
  add column cobrada_el date;

update public.certificaciones set mes = to_char(hasta, 'YYYY-MM') where mes is null;
alter table public.certificaciones alter column mes set not null;
create unique index certificaciones_mes on public.certificaciones (mes);

-- Capitanes (Loading Masters) y vacantes. Datos personales: viven solo en la base.
create table public.personal (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rol text not null check (rol in ('senior', 'junior')),
  inicio date,               -- null = todavía sin fecha de ingreso (no entra en la proyección)
  fin date,
  sueldo_bruto_ars numeric(16, 2) not null default 0,
  bono_anual_usd numeric(12, 2) not null default 0,
  osde_costo_ars numeric(16, 2) not null default 0, -- costo mensual del plan de OSDE para la empresa
  notas text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email')
);

create trigger personal_updated_at
  before update on public.personal
  for each row execute function public.tocar_updated_at();

alter table public.personal enable row level security;

create policy "usuarios autorizados" on public.personal
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());

revoke all on public.personal from anon;

-- Los parámetros de cargas sociales y fechas de inicio (seguros, etc.) van en `referencias`, que hasta
-- ahora era de solo lectura: ahora los usuarios autorizados también pueden editarlos.
create policy "usuarios autorizados editan" on public.referencias
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());
