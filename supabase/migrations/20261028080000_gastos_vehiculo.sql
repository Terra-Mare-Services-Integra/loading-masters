-- Los gastos del vehículo (póliza, services, patente, combustible...) usan la misma tabla que los de
-- administración, separados por área. La compra de la camioneta se amortiza aparte (referencias.vehiculo).
alter table public.gastos_administracion
  add column area text not null default 'administracion' check (area in ('administracion', 'vehiculo'));
