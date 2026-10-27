-- Persona asociada a un gasto que no es capitán (superintendente, personal de Terra Mare u otro):
-- se guarda el nombre. La lista para elegir vive en referencias.personas_gastos.
alter table public.gastos_operacion add column persona text not null default '';
