-- De qué fuente salió cada valor del IPC (INDEC o datos.gob.ar).
alter table public.serie_ipc add column fuente text not null default 'datos.gob.ar';
