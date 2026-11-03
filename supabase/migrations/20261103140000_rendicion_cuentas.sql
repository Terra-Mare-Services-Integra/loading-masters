-- Datos bancarios para cobrar reembolsos (opcionales). Cada persona ve y edita solo los suyos;
-- tesorería (y el admin) los lee para pagar. Otro usuario de gastos no ve los de nadie.
create table public.rg_cuentas (
  email text primary key default lower(auth.jwt() ->> 'email') check (email = lower(email)),
  alias text not null default '' check (alias = '' or alias ~ '^[A-Za-z0-9.-]{6,20}$'),
  cbu text not null default '' check (cbu = '' or cbu ~ '^[0-9]{22}$'),
  titular text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.rg_cuentas enable row level security;

create policy "rg cuentas: ver" on public.rg_cuentas for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.rg_consolida());
create policy "rg cuentas: crear" on public.rg_cuentas for insert to authenticated
  with check (email = lower(auth.jwt() ->> 'email') and public.rg_carga());
create policy "rg cuentas: editar" on public.rg_cuentas for update to authenticated
  using (email = lower(auth.jwt() ->> 'email')) with check (email = lower(auth.jwt() ->> 'email'));
create policy "rg cuentas: borrar" on public.rg_cuentas for delete to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

revoke all on public.rg_cuentas from anon;
