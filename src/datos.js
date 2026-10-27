// Acceso a Supabase: certificaciones (una por mes de cierre), feriados y proformas emitidas.
import { supabase } from './lib/supabase.js';

const ok = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export async function leerCertificacion(cierre) {
  const fila = ok(await supabase.from('certificaciones').select('*').eq('cierre', cierre).maybeSingle());
  if (!fila) return null;
  return {
    id: fila.id,
    cierre: fila.cierre,
    numero: fila.numero,
    fechaEmision: fila.fecha_emision,
    factores: fila.factores,
    reembolsables: fila.reembolsables,
    observaciones: fila.observaciones,
    actualizado: { at: fila.updated_at, por: fila.updated_by },
  };
}

export async function guardarCertificacion(carga, total) {
  const fila = ok(
    await supabase
      .from('certificaciones')
      .upsert(
        {
          cierre: carga.cierre,
          numero: carga.numero,
          fecha_emision: carga.fechaEmision,
          factores: carga.factores,
          reembolsables: carga.reembolsables,
          observaciones: carga.observaciones,
          total,
        },
        { onConflict: 'cierre' },
      )
      .select('id, updated_at, updated_by')
      .single(),
  );
  return { id: fila.id, actualizado: { at: fila.updated_at, por: fila.updated_by } };
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
