-- Cada certificación pasa a ser una "facturación" con nombre y fechas propias,
-- en lugar de un mes de cierre fijo del 21 al 20.

alter table public.certificaciones
  add column nombre text,
  add column desde date,
  add column hasta date,
  -- Fecha de factura fijada a mano; null = proforma + 5 días hábiles.
  add column fecha_factura date;

alter table public.certificaciones rename column fecha_emision to fecha_proforma;

update public.certificaciones
set
  nombre = 'Facturar ' || to_char(to_date(cierre, 'YYYY-MM'), 'TMmonth YYYY'),
  desde = (to_date(cierre, 'YYYY-MM') - interval '1 month' + interval '20 days')::date,
  hasta = (to_date(cierre, 'YYYY-MM') + interval '19 days')::date;

alter table public.certificaciones
  alter column nombre set not null,
  alter column desde set not null,
  alter column hasta set not null,
  add constraint certificaciones_periodo_check check (hasta >= desde),
  drop column cierre;

create index certificaciones_desde_idx on public.certificaciones (desde desc);
