-- MoM: período de notas que se trajo a la minuta (por la fecha de la nota). Al volver a copiar una MoM anterior,
-- se incluyen otra vez las notas de las tareas de ese período (las cargadas hasta que se guardó la reunión).
alter table public.lean_reuniones
  add column notas_desde date,
  add column notas_hasta date,
  add constraint lean_reuniones_periodo check (notas_hasta is null or notas_desde is null or notas_hasta >= notas_desde);
