-- Compras traídas de Xubio: un renglón por cada ítem de factura de compra imputado al centro de costo
-- del proyecto (referencias.xubio.centroDeCosto). Lo escribe la función `xubio` (sincronizar-compras);
-- la app solo clasifica (área y rubro) y carga la fecha de pago, que la sincronización no pisa.
create table public.xubio_compras (
  id text primary key,                                  -- id del renglón en Xubio
  transaccion_id bigint not null,                       -- la factura en Xubio
  numero text not null default '',
  fecha date not null,
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),
  proveedor text not null default '',
  descripcion text not null default '',
  producto text not null default '',
  producto_base text not null default '',               -- producto sin la alícuota ("Alquiler de Inmueble")
  moneda text not null default '',
  cotizacion numeric(14, 6),
  importe numeric(16, 2) not null default 0,            -- sin IVA, en la moneda de la factura
  importe_ars numeric(16, 2) not null default 0,        -- sin IVA, en pesos
  iva_pct numeric(5, 4) not null default 0,
  sincronizado_at timestamptz not null default now(),
  -- De la app (la sincronización no los toca):
  area text check (area in ('operacion', 'administracion', 'vehiculo', 'excluido')),  -- null: por clasificar
  rubro text,
  manual boolean not null default false,                -- clasificado a mano (no lo cambia el mapeo)
  pagado_el date,
  updated_by text default (auth.jwt() ->> 'email')
);
create index xubio_compras_mes on public.xubio_compras (mes);
create index xubio_compras_producto on public.xubio_compras (producto_base);

-- Clasificación por producto: la primera vez que llega un producto se elige área y rubro y se aplica
-- a todos sus renglones (salvo los clasificados a mano).
create table public.xubio_mapeo (
  producto_base text primary key,
  area text not null check (area in ('operacion', 'administracion', 'vehiculo', 'excluido')),
  rubro text,
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email')
);

alter table public.xubio_compras enable row level security;
alter table public.xubio_mapeo enable row level security;
create policy "usuarios autorizados" on public.xubio_compras
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());
create policy "usuarios autorizados" on public.xubio_mapeo
  for all to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());
revoke all on public.xubio_compras from anon;
revoke all on public.xubio_mapeo from anon;

insert into public.referencias (clave, valor, descripcion)
values ('xubio', '{"centroDeCosto": "Proyecto VMOS", "desde": "2026-10-01"}',
        'Xubio: centro de costo del proyecto y desde qué fecha se traen las compras')
on conflict (clave) do nothing;

-- Sincronización diaria de compras (08:00 hora argentina). La función valida el token del cron contra
-- su secreto XUBIO_CRON_TOKEN; en el Vault está como `lm_xubio_cron` (cargados aparte, no en el repo).
select cron.schedule(
  'sincronizar-xubio-compras',
  '0 11 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'lm_project_url') || '/functions/v1/xubio',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lm_anon_key'),
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'lm_xubio_cron')
    ),
    body := '{"accion": "sincronizar-compras"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
