-- Estados de las proformas emitidas: emitida → enviada (a VMOS) / anulada; una enviada pasa a
-- reemplazada cuando se envía otra de la misma facturación. Nunca se borran ni cambia su contenido.

alter table public.proformas
  add column estado text not null default 'emitida'
    check (estado in ('emitida', 'enviada', 'reemplazada', 'anulada')),
  add column enviada_el date,
  add column reemplazada_por uuid references public.proformas (id),
  add column motivo_anulacion text,
  add column estado_at timestamptz,
  add column estado_por text;

-- Una sola enviada por facturación.
create unique index proformas_una_enviada on public.proformas (certificacion_id) where estado = 'enviada';

-- Solo cambia el estado, y solo por transiciones válidas; el contenido emitido queda congelado.
create or replace function public.proteger_proforma()
returns trigger
language plpgsql
as $$
begin
  if (new.certificacion_id, new.numero, new.datos, new.subtotal, new.total, new.emitida_at, new.emitida_por)
     is distinct from
     (old.certificacion_id, old.numero, old.datos, old.subtotal, old.total, old.emitida_at, old.emitida_por) then
    raise exception 'El contenido de una proforma emitida no se puede modificar';
  end if;
  if new.estado is distinct from old.estado and not (
       (old.estado = 'emitida' and new.estado in ('enviada', 'anulada'))
    or (old.estado = 'enviada' and new.estado = 'reemplazada')
  ) then
    raise exception 'No se puede pasar una proforma de % a %', old.estado, new.estado;
  end if;
  if new.estado = 'anulada' and coalesce(trim(new.motivo_anulacion), '') = '' then
    raise exception 'Para anular una proforma hay que indicar el motivo';
  end if;
  if new.estado = 'enviada' and new.enviada_el is null then
    raise exception 'Falta la fecha de envío';
  end if;
  new.estado_at := now();
  new.estado_por := auth.jwt() ->> 'email';
  return new;
end;
$$;

create trigger proformas_proteger
  before update on public.proformas
  for each row execute function public.proteger_proforma();

create policy "usuarios autorizados cambian el estado" on public.proformas
  for update to authenticated using (public.es_usuario_autorizado()) with check (public.es_usuario_autorizado());

-- Marca una proforma como la enviada a VMOS: la enviada anterior de la misma facturación pasa a
-- reemplazada, y la fecha de envío pasa a ser la fecha de proforma de la facturación (calendario).
create or replace function public.marcar_proforma_enviada(p_id uuid, p_fecha date)
returns void
language plpgsql
security invoker
as $$
declare
  v_cert uuid;
begin
  select certificacion_id into v_cert from public.proformas where id = p_id and estado = 'emitida';
  if v_cert is null then
    raise exception 'Solo se puede marcar como enviada una proforma emitida';
  end if;
  update public.proformas set estado = 'reemplazada', reemplazada_por = p_id
    where certificacion_id = v_cert and estado = 'enviada';
  update public.proformas set estado = 'enviada', enviada_el = p_fecha where id = p_id;
  update public.certificaciones set fecha_proforma = p_fecha where id = v_cert;
end;
$$;

grant execute on function public.marcar_proforma_enviada(uuid, date) to authenticated;
revoke execute on function public.marcar_proforma_enviada(uuid, date) from anon;
