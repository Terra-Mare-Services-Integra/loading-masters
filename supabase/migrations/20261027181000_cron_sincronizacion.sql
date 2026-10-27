-- Corre la sincronización de IPC y dólar dos veces por día (09:00 y 18:00 hora argentina).
-- La URL y la clave pública se leen del Vault (secretos `lm_project_url` y `lm_anon_key`,
-- cargados aparte para no dejarlos en el repo).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sincronizar-indices',
  '0 12,21 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'lm_project_url') || '/functions/v1/sincronizar-indices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lm_anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
