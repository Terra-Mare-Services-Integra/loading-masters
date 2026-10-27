-- Up selling: trabajos que se cobran aparte dentro del contrato. Por ahora una línea por trabajo con
-- su ingreso y su costo (sin IVA). Los reembolsables (ítem 1d) se muestran junto a estas líneas.
create table public.upselling (
  id uuid primary key default gen_random_uuid(),
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),     -- mes al que se imputa
  descripcion text not null default '',
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  ingreso numeric(16, 2) not null default 0 check (ingreso >= 0),
  costo numeric(16, 2) not null default 0 check (costo >= 0),
  tipo_cambio numeric(12, 4),                           -- obligatorio si la moneda es USD
  notas text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'),
  constraint upselling_tc_usd check (moneda = 'ARS' or tipo_cambio > 0)
);
create index upselling_mes on public.upselling (mes);

create trigger upselling_updated_at
  before update on public.upselling
  for each row execute function public.tocar_updated_at();

alter table public.upselling enable row level security;

create policy "usuarios autorizados" on public.upselling
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());

revoke all on public.upselling from anon;
