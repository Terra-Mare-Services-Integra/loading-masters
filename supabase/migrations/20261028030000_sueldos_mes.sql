-- Sueldos reales de cada capitán por mes calendario (liquidación y pago). Mientras un mes no tenga
-- filas, el P&L usa el costo proyectado.
create table public.sueldos_mes (
  id uuid primary key default gen_random_uuid(),
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),
  persona_id uuid not null references public.personal (id) on delete restrict,
  bruto_ars numeric(16, 2) not null default 0,      -- remuneración liquidada (incluye SAC y vacaciones si corresponden)
  cargas_ars numeric(16, 2) not null default 0,     -- contribuciones patronales, ART, seguro de vida (F.931)
  osde_ars numeric(16, 2) not null default 0,       -- diferencia de OSDE a cargo de la empresa
  bono_ars numeric(16, 2) not null default 0,       -- bono y sus contribuciones, si se pagó ese mes
  otros_ars numeric(16, 2) not null default 0,
  pagado_el date,
  notas text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'),
  unique (mes, persona_id)
);

create trigger sueldos_mes_updated_at
  before update on public.sueldos_mes
  for each row execute function public.tocar_updated_at();

alter table public.sueldos_mes enable row level security;

create policy "usuarios autorizados" on public.sueldos_mes
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());

revoke all on public.sueldos_mes from anon;
