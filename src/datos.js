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

// ─── Ajuste de precios (Anexo II) ────────────────────────────────────────────

export async function leerIndices(meses) {
  if (!meses.length) return {};
  const filas = ok(await supabase.from('indices').select('*').in('mes', meses));
  return Object.fromEntries(filas.map((f) => [f.mes, {
    mo: f.mo === null ? null : Number(f.mo),
    ipc: f.ipc === null ? null : Number(f.ipc),
    usd: f.usd === null ? null : Number(f.usd),
    paritaria: f.paritaria,
    actualizado: { at: f.updated_at, por: f.updated_by },
  }]));
}

export async function guardarIndices(mes, { mo, ipc, usd, paritaria }) {
  ok(await supabase.from('indices').upsert({ mes, mo: mo || null, ipc: ipc || null, usd: usd || null, paritaria: !!paritaria }));
}

const ajusteDesdeFila = (f) => ({
  id: f.id,
  mes: f.mes,
  fechaPedido: f.fecha_pedido,
  rigeDesde: f.rige_desde,
  estado: f.estado,
  fechaResolucion: f.fecha_resolucion,
  indices: f.indices,
  base: f.base,
  factor: Number(f.factor),
  precios: f.precios,
  motivos: f.motivos,
  notas: f.notas,
  creado: { at: f.created_at, por: f.created_by },
});

export async function leerAjustes() {
  return ok(await supabase.from('ajustes').select('*').order('mes')).map(ajusteDesdeFila);
}

export async function pedirAjuste(evaluacion, indices, fechaPedido) {
  return ajusteDesdeFila(ok(await supabase.from('ajustes').insert({
    mes: evaluacion.mes,
    fecha_pedido: fechaPedido,
    rige_desde: evaluacion.rigeDesde,
    indices: { mo: indices.mo, ipc: indices.ipc, usd: indices.usd },
    base: { mes: evaluacion.base.mes, indices: evaluacion.base.indices, precios: evaluacion.base.precios },
    factor: evaluacion.factor,
    precios: evaluacion.precios,
    motivos: evaluacion.motivos,
  }).select('*').single()));
}

export async function resolverAjuste(id, estado, fecha) {
  return ajusteDesdeFila(ok(await supabase.from('ajustes')
    .update({ estado, fecha_resolucion: estado === 'solicitado' ? null : fecha })
    .eq('id', id).select('*').single()));
}

export async function borrarAjuste(id) {
  ok(await supabase.from('ajustes').delete().eq('id', id));
}

// ─── Series oficiales (las descarga la función sincronizar-indices) ──────────

// IPC1 = IPC del mes n-2; USD1 = dólar del primer día hábil cambiario del mes.
export async function leerSeriesDeVentana(mes, mesIpc) {
  const [y, m] = mes.split('-').map(Number);
  const finMes = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const [ipc, usd] = await Promise.all([
    supabase.from('serie_ipc').select('mes, valor').eq('mes', mesIpc).maybeSingle(),
    supabase.from('serie_usd').select('fecha, valor').gte('fecha', `${mes}-01`).lt('fecha', finMes)
      .order('fecha').limit(1).maybeSingle(),
  ]);
  return {
    ipc: ok(ipc) ? { valor: Number(ipc.data.valor), mes: ipc.data.mes } : null,
    usd: ok(usd) ? { valor: Number(usd.data.valor), fecha: usd.data.fecha } : null,
  };
}

export async function ultimaSincronizacion() {
  return ok(await supabase.from('sincronizaciones').select('at, ok, detalle').order('at', { ascending: false }).limit(1).maybeSingle());
}

export async function sincronizarAhora() {
  const { data, error } = await supabase.functions.invoke('sincronizar-indices', { body: {} });
  if (error) throw error;
  return data;
}

// Series para un rango de meses de aplicación: IPC de n-2 y dólar del primer día hábil de cada mes.
export async function leerSeriesRango(meses, mesesIpc) {
  const desde = `${meses[0]}-01`;
  const [y, m] = meses.at(-1).split('-').map(Number);
  const hasta = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const [ipc, usd] = await Promise.all([
    supabase.from('serie_ipc').select('mes, valor, fuente').in('mes', mesesIpc),
    supabase.from('serie_usd').select('fecha, valor').gte('fecha', desde).lt('fecha', hasta).order('fecha'),
  ]);
  const primerDia = {};
  for (const f of ok(usd)) primerDia[f.fecha.slice(0, 7)] ??= { valor: Number(f.valor), fecha: f.fecha };
  return {
    ipc: Object.fromEntries(ok(ipc).map((f) => [f.mes, { valor: Number(f.valor), mes: f.mes, fuente: f.fuente }])),
    usd: primerDia,
  };
}
