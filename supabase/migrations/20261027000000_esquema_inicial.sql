-- Loading Masters: certificaciones mensuales del servicio CO&C a VMOS y proformas emitidas.

-- Acceso: solo usuarios con email confirmado de los dominios de la empresa.
-- (Con confirmación de email activa, un usuario no confirmado no puede iniciar sesión.)
create or replace function public.es_usuario_autorizado()
returns boolean
language sql
stable
as $$
  select coalesce(split_part(auth.jwt() ->> 'email', '@', 2) in ('terra-mare.com.ar'), false)
$$;

-- Una certificación por mes de cierre (período 21 → 20). Es la carga editable.
create table public.certificaciones (
  id uuid primary key default gen_random_uuid(),
  cierre text not null unique check (cierre ~ '^\d{4}-\d{2}$'),
  numero text not null,
  fecha_emision date not null,
  -- { "<codigo>": { "AAAA-MM-DD": factor } }
  factores jsonb not null default '{}',
  -- { "1d": gastos }
  reembolsables jsonb not null default '{}',
  observaciones text not null default '',
  total numeric(16, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email')
);

-- Feriados nacionales: corren el plazo de revisión de VMOS. Valen para todos los meses.
create table public.feriados (
  fecha date primary key,
  descripcion text not null default ''
);

-- Cada emisión de proforma guarda la foto exacta de lo que se envió (armarProforma),
-- para poder reimprimirla igual aunque después cambie la certificación.
create table public.proformas (
  id uuid primary key default gen_random_uuid(),
  certificacion_id uuid not null references public.certificaciones (id) on delete restrict,
  numero text not null,
  datos jsonb not null,
  subtotal numeric(16, 2) not null,
  total numeric(16, 2) not null,
  emitida_at timestamptz not null default now(),
  emitida_por text default (auth.jwt() ->> 'email')
);
create index proformas_certificacion_idx on public.proformas (certificacion_id, emitida_at desc);

create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.jwt() ->> 'email';
  return new;
end;
$$;

create trigger certificaciones_updated_at
  before update on public.certificaciones
  for each row execute function public.tocar_updated_at();

alter table public.certificaciones enable row level security;
alter table public.feriados enable row level security;
alter table public.proformas enable row level security;

create policy "usuarios autorizados" on public.certificaciones
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());

create policy "usuarios autorizados" on public.feriados
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());

-- Las proformas emitidas no se editan ni se borran: solo se leen y se agregan.
create policy "usuarios autorizados leen" on public.proformas
  for select to authenticated using (public.es_usuario_autorizado());
create policy "usuarios autorizados emiten" on public.proformas
  for insert to authenticated with check (public.es_usuario_autorizado());

revoke all on public.certificaciones, public.feriados, public.proformas from anon;
