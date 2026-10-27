-- Evaluación de desempeño semestral de cada capitán, atada al bono (pagado semestralmente).
-- Performance = promedio de las reviews 360° (supervisor, pares, cliente, autoevaluación).
create table public.evaluaciones (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personal (id) on delete restrict,
  semestre text not null check (semestre ~ '^\d{4}-S[12]$'),
  presentismo numeric(5, 2) check (presentismo between 0 and 100),
  hse numeric(5, 2) check (hse between 0 and 100),
  cerrada boolean not null default false,
  bono_pagado_el date,
  bono_pagado_ars numeric(16, 2),
  notas text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'),
  unique (persona_id, semestre)
);

create table public.reviews_360 (
  id uuid primary key default gen_random_uuid(),
  evaluacion_id uuid not null references public.evaluaciones (id) on delete cascade,
  evaluador text not null,
  relacion text not null check (relacion in ('supervisor', 'par', 'cliente', 'autoevaluacion', 'otro')),
  puntaje numeric(5, 2) not null check (puntaje between 0 and 100),
  comentario text not null default '',
  created_at timestamptz not null default now(),
  created_by text default (auth.jwt() ->> 'email')
);

create trigger evaluaciones_updated_at
  before update on public.evaluaciones
  for each row execute function public.tocar_updated_at();

alter table public.evaluaciones enable row level security;
alter table public.reviews_360 enable row level security;

create policy "usuarios autorizados" on public.evaluaciones
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());
create policy "usuarios autorizados" on public.reviews_360
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());

revoke all on public.evaluaciones, public.reviews_360 from anon;
