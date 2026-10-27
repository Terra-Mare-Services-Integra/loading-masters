-- Gastos de operación: compras (costo de Terra Mare) y reembolsables (se facturan a VMOS con el fee
-- del ítem 1d). Incluye los honorarios de Sergio, que factura como proveedor.
create table public.gastos_operacion (
  id uuid primary key default gen_random_uuid(),
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),     -- mes al que se imputa
  fecha date not null,
  rubro text not null,
  reembolsable boolean not null default false,
  descripcion text not null default '',
  proveedor text not null default '',
  factura_numero text not null default '',
  persona_id uuid references public.personal (id) on delete set null,
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  monto numeric(16, 2) not null check (monto >= 0),     -- sin IVA, en la moneda indicada
  iva_pct numeric(5, 4) not null default 0,
  tipo_cambio numeric(12, 4),                           -- obligatorio si la moneda es USD
  pagado_el date,
  pagado_por text not null default '',
  facturado_en text,                                    -- reembolsables: mes de la facturación a VMOS que lo incluyó
  notas text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'),
  constraint gastos_tc_usd check (moneda = 'ARS' or tipo_cambio > 0)
);
create index gastos_operacion_mes on public.gastos_operacion (mes);

create trigger gastos_operacion_updated_at
  before update on public.gastos_operacion
  for each row execute function public.tocar_updated_at();

alter table public.gastos_operacion enable row level security;

create policy "usuarios autorizados" on public.gastos_operacion
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());

revoke all on public.gastos_operacion from anon;
