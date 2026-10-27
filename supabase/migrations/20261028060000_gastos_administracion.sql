-- Gastos de administración (estructura de Terra Mare para el contrato): sistemas de sueldos y contable,
-- telefonía, licencias, honorarios, etc. Son siempre costo de Terra Mare (no se reembolsan).
create table public.gastos_administracion (
  id uuid primary key default gen_random_uuid(),
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),     -- mes al que se imputa
  fecha date not null,
  rubro text not null,
  descripcion text not null default '',
  proveedor text not null default '',
  factura_numero text not null default '',
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  monto numeric(16, 2) not null check (monto >= 0),     -- sin IVA, en la moneda indicada
  iva_pct numeric(5, 4) not null default 0,
  tipo_cambio numeric(12, 4),                           -- obligatorio si la moneda es USD
  pagado_el date,
  pagado_por text not null default '',
  notas text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'),
  constraint gastos_admin_tc_usd check (moneda = 'ARS' or tipo_cambio > 0)
);
create index gastos_administracion_mes on public.gastos_administracion (mes);

create trigger gastos_administracion_updated_at
  before update on public.gastos_administracion
  for each row execute function public.tocar_updated_at();

alter table public.gastos_administracion enable row level security;

create policy "usuarios autorizados" on public.gastos_administracion
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());

revoke all on public.gastos_administracion from anon;
