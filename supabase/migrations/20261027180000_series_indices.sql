-- Series oficiales para la fórmula de ajuste, descargadas automáticamente por la función
-- `sincronizar-indices` (ver supabase/functions). La app solo las lee.

-- IPC INDEC, Nivel General Nacional, base dic-2016 (datos.gob.ar, serie 148.3_INIVELNAL_DICI_M_26).
create table public.serie_ipc (
  mes text primary key check (mes ~ '^\d{4}-\d{2}$'),
  valor numeric(14, 4) not null,
  actualizado_at timestamptz not null default now()
);

-- Dólar BNA divisa vendedor (API de estadísticas cambiarias del BCRA). Solo días hábiles cambiarios.
create table public.serie_usd (
  fecha date primary key,
  valor numeric(12, 4) not null,
  actualizado_at timestamptz not null default now()
);

-- Registro de cada corrida de la sincronización.
create table public.sincronizaciones (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ok boolean not null,
  detalle jsonb not null default '{}'
);

alter table public.serie_ipc enable row level security;
alter table public.serie_usd enable row level security;
alter table public.sincronizaciones enable row level security;

create policy "usuarios autorizados leen" on public.serie_ipc
  for select to authenticated using (public.es_usuario_autorizado());
create policy "usuarios autorizados leen" on public.serie_usd
  for select to authenticated using (public.es_usuario_autorizado());
create policy "usuarios autorizados leen" on public.sincronizaciones
  for select to authenticated using (public.es_usuario_autorizado());

revoke all on public.serie_ipc, public.serie_usd, public.sincronizaciones from anon;
