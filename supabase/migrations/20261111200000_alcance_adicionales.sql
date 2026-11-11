-- Calculadora de sueldos: un adicional se elige una vez para toda la tripulación (Supply type, Acta, Locación…)
-- o en cada posición (RJ, gasero…). Cada proyecto puede cambiarlo.
alter table public.cs_adicionales
  add column alcance text not null default 'posicion' check (alcance in ('proyecto', 'posicion'));
