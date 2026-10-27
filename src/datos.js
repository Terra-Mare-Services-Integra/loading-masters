// Acceso a Supabase: facturaciones (tabla certificaciones), feriados y proformas emitidas.
import { supabase } from './lib/supabase.js';

const ok = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const desdeFila = (fila) => ({
  id: fila.id,
  nombre: fila.nombre,
  desde: fila.desde,
  hasta: fila.hasta,
  numero: fila.numero,
  fechaProforma: fila.fecha_proforma,
  fechaFactura: fila.fecha_factura ?? '',
  factores: fila.factores,
  reembolsables: fila.reembolsables,
  observaciones: fila.observaciones,
  actualizado: { at: fila.updated_at, por: fila.updated_by },
});

const aFila = (carga, total) => ({
  nombre: carga.nombre,
  desde: carga.desde,
  hasta: carga.hasta,
  numero: carga.numero,
  fecha_proforma: carga.fechaProforma,
  fecha_factura: carga.fechaFactura || null,
  factores: carga.factores,
  reembolsables: carga.reembolsables,
  observaciones: carga.observaciones,
  total,
});

export async function listarFacturaciones() {
  return ok(
    await supabase.from('certificaciones').select('id, nombre, desde, hasta, total').order('desde', { ascending: false }),
  );
}

export async function leerFacturacion(id) {
  return desdeFila(ok(await supabase.from('certificaciones').select('*').eq('id', id).single()));
}

export async function crearFacturacion(carga, total) {
  return desdeFila(ok(await supabase.from('certificaciones').insert(aFila(carga, total)).select('*').single()));
}

export async function guardarFacturacion(carga, total) {
  const fila = ok(
    await supabase.from('certificaciones').update(aFila(carga, total)).eq('id', carga.id)
      .select('updated_at, updated_by').single(),
  );
  return { at: fila.updated_at, por: fila.updated_by };
}

export async function leerFeriados() {
  return ok(await supabase.from('feriados').select('fecha, descripcion').order('fecha')).map((f) => f.fecha);
}

export async function agregarFeriado(fecha) {
  ok(await supabase.from('feriados').upsert({ fecha }));
}

export async function quitarFeriado(fecha) {
  ok(await supabase.from('feriados').delete().eq('fecha', fecha));
}

export async function registrarProforma(certificacionId, proforma) {
  return ok(
    await supabase
      .from('proformas')
      .insert({
        certificacion_id: certificacionId,
        numero: proforma.numero,
        datos: proforma,
        subtotal: proforma.subtotal,
        total: proforma.total,
      })
      .select('id, numero, total, emitida_at, emitida_por, datos')
      .single(),
  );
}

export async function leerProformas(certificacionId) {
  return ok(
    await supabase
      .from('proformas')
      .select('id, numero, total, emitida_at, emitida_por, datos')
      .eq('certificacion_id', certificacionId)
      .order('emitida_at', { ascending: false }),
  );
}
