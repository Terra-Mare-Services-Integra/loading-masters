-- Presupuesto de Xubio creado a partir de cada proforma (la proforma emitida queda congelada; el vínculo
-- vive aparte). Lo escribe la función `xubio` (enviar-presupuesto / estado-presupuesto).
create table public.xubio_presupuestos (
  proforma_id uuid primary key references public.proformas (id) on delete restrict,
  transaccion_id bigint not null,                       -- el presupuesto en Xubio
  numero text not null default '',
  total numeric(16, 2),                                 -- total con IVA que devolvió Xubio
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado', 'facturado')),
  enviado_at timestamptz not null default now(),
  enviado_por text,
  actualizado_at timestamptz not null default now()
);

alter table public.xubio_presupuestos enable row level security;
create policy "usuarios autorizados leen" on public.xubio_presupuestos
  for select to authenticated using (public.es_usuario_autorizado());
revoke all on public.xubio_presupuestos from anon;

-- Configuración de ventas (cliente, punto de venta, centro de costo y producto de cada ítem) y
-- destinatarios del mail: se completan desde la app.
insert into public.referencias (clave, valor, descripcion)
values ('xubio_ventas', '{"puntoVenta": null, "cliente": null, "centroDeCosto": null, "productos": {}, "mail": {"para": "", "cc": ""}}',
        'Xubio: datos para crear el presupuesto de cada proforma y destinatarios del mail a VMOS')
on conflict (clave) do nothing;
