-- Calculadora de sueldos: documentos de cada proyecto (MSM, MoM, mails, etc.).
-- Bucket privado "calculadora-documentos", carpeta por proyecto: <proyecto_id>/<archivo>.
-- Los ve y sube quien tiene acceso a la calculadora; borra quien lo subió o un editor.

create table public.cs_documentos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.cs_crewing (id) on delete cascade,
  ruta text not null unique,
  nombre text not null,
  tipo text not null default 'otro' check (tipo in ('msm', 'mom', 'mail', 'contrato', 'oferta', 'otro')),
  nota text not null default '',
  tamano bigint,
  mime text,
  created_at timestamptz not null default now(),
  created_by text not null default public.cs_email()
);
create index cs_documentos_proyecto on public.cs_documentos (proyecto_id);
alter table public.cs_documentos enable row level security;
create policy "cs documentos: ver" on public.cs_documentos for select to authenticated using (public.cs_puede_ver());
create policy "cs documentos: subir" on public.cs_documentos for insert to authenticated
  with check (public.cs_puede_ver() and created_by = public.cs_email());
create policy "cs documentos: editar nota" on public.cs_documentos for update to authenticated
  using (created_by = public.cs_email() or public.cs_puede_editar()) with check (created_by = public.cs_email() or public.cs_puede_editar());
create policy "cs documentos: borrar" on public.cs_documentos for delete to authenticated
  using (created_by = public.cs_email() or public.cs_puede_editar());
revoke all on public.cs_documentos from anon;

insert into storage.buckets (id, name, public, file_size_limit)
values ('calculadora-documentos', 'calculadora-documentos', false, 26214400)
on conflict (id) do nothing;

create policy "cs documentos archivos: ver" on storage.objects for select to authenticated
  using (bucket_id = 'calculadora-documentos' and public.cs_puede_ver());
create policy "cs documentos archivos: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'calculadora-documentos' and public.cs_puede_ver()
    and exists (select 1 from public.cs_crewing c where c.id::text = (storage.foldername(name))[1]));
create policy "cs documentos archivos: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'calculadora-documentos' and (owner_id = auth.uid()::text or public.cs_puede_editar()));
