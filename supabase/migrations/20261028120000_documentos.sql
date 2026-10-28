-- Carpeta privada de documentos (PDF de la proforma y del presupuesto de Xubio), por proforma:
-- documentos/proformas/<proforma_id>/<archivo>.pdf. Solo usuarios autorizados de la app.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "documentos: leer" on storage.objects
  for select to authenticated
  using (bucket_id = 'documentos' and public.es_usuario_autorizado());

create policy "documentos: subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documentos' and public.es_usuario_autorizado());

create policy "documentos: reemplazar" on storage.objects
  for update to authenticated
  using (bucket_id = 'documentos' and public.es_usuario_autorizado())
  with check (bucket_id = 'documentos' and public.es_usuario_autorizado());
