-- Ajuste de precios (Anexo II): índices mensuales y pedidos de revisión.

-- Índices del mes de aplicación de la fórmula: MO1 (básico Capitán de Ultramar, FENA),
-- IPC1 (INDEC Nivel General de dos meses antes) y USD1 (BNA divisa vendedor, primer día hábil).
create table public.indices (
  mes text primary key check (mes ~ '^\d{4}-\d{2}$'),
  mo numeric(16, 2),
  ipc numeric(12, 4),
  usd numeric(12, 4),
  paritaria boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email')
);

-- Pedido de revisión hecho en la ventana del 1 al 10 de `mes`. Si VMOS lo aprueba, rige desde el
-- 1 del mes siguiente y sus índices y precios pasan a ser la base de la próxima revisión.
create table public.ajustes (
  id uuid primary key default gen_random_uuid(),
  mes text not null unique check (mes ~ '^\d{4}-\d{2}$'),
  fecha_pedido date not null check (extract(day from fecha_pedido) between 1 and 10),
  rige_desde date not null,
  estado text not null default 'solicitado' check (estado in ('solicitado', 'aprobado', 'rechazado')),
  fecha_resolucion date,
  indices jsonb not null,
  base jsonb not null,
  factor numeric(12, 9) not null,
  precios jsonb not null,
  motivos text[] not null default '{}',
  notas text not null default '',
  created_at timestamptz not null default now(),
  created_by text default (auth.jwt() ->> 'email'),
  constraint ajustes_pedido_en_ventana check (to_char(fecha_pedido, 'YYYY-MM') = mes)
);

create trigger indices_updated_at
  before update on public.indices
  for each row execute function public.tocar_updated_at();

alter table public.indices enable row level security;
alter table public.ajustes enable row level security;

create policy "usuarios autorizados" on public.indices
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());

create policy "usuarios autorizados" on public.ajustes
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());

revoke all on public.indices, public.ajustes from anon;
