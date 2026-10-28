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
  mes: fila.mes,
  facturaNumero: fila.factura_numero ?? '',
  facturaEmitidaEl: fila.factura_emitida_el ?? '',
  cobradaEl: fila.cobrada_el ?? '',
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
  mes: carga.mes,
  factura_numero: carga.facturaNumero || null,
  factura_emitida_el: carga.facturaEmitidaEl || null,
  cobrada_el: carga.cobradaEl || null,
  factores: carga.factores,
  reembolsables: carga.reembolsables,
  observaciones: carga.observaciones,
  total,
});

export async function listarFacturaciones() {
  return ok(
    await supabase.from('certificaciones').select('id, nombre, mes, desde, hasta, total').order('desde', { ascending: false }),
  );
}

// Facturaciones de todos los meses, con lo necesario para el estado y el P&L.
export async function listarFacturacionesPorMes() {
  const filas = ok(await supabase.from('certificaciones')
    .select('id, nombre, mes, desde, hasta, total, factores, reembolsables, fecha_proforma, factura_numero, factura_emitida_el, cobrada_el, observaciones, numero'));
  return Object.fromEntries(filas.map((f) => [f.mes, {
    id: f.id, nombre: f.nombre, mes: f.mes, desde: f.desde, hasta: f.hasta, total: Number(f.total),
    factores: f.factores, reembolsables: f.reembolsables ?? {}, fechaProforma: f.fecha_proforma, facturaNumero: f.factura_numero || null, facturaEmitidaEl: f.factura_emitida_el, cobradaEl: f.cobrada_el,
    observaciones: f.observaciones, numero: f.numero,
  }]));
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
      .select('id, numero, total, emitida_at, emitida_por, datos, estado, enviada_el, reemplazada_por, motivo_anulacion, estado_at, estado_por')
      .single(),
  );
}

export async function leerProformas(certificacionId) {
  return ok(
    await supabase
      .from('proformas')
      .select('id, numero, total, emitida_at, emitida_por, datos, estado, enviada_el, reemplazada_por, motivo_anulacion, estado_at, estado_por')
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
    supabase.from('serie_ipc').select('mes, valor, fuente').eq('mes', mesIpc).maybeSingle(),
    supabase.from('serie_usd').select('fecha, valor').gte('fecha', `${mes}-01`).lt('fecha', finMes)
      .order('fecha').limit(1).maybeSingle(),
  ]);
  return {
    ipc: ok(ipc) ? { valor: Number(ipc.data.valor), mes: ipc.data.mes, fuente: ipc.data.fuente } : null,
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

// Estado de las proformas emitidas: la que se mandó a VMOS (reemplaza a la anterior y mueve la fecha
// de proforma de la facturación) o anulada con motivo. No se borran.
export async function marcarProformaEnviada(id, fecha) {
  const { error } = await supabase.rpc('marcar_proforma_enviada', { p_id: id, p_fecha: fecha });
  if (error) throw error;
}

export async function anularProforma(id, motivo) {
  ok(await supabase.from('proformas').update({ estado: 'anulada', motivo_anulacion: motivo }).eq('id', id).select('id').single());
}

// ─── Resultado proyectado: supuestos por escenario ───────────────────────────

export async function leerEscenarios() {
  return Object.fromEntries(ok(await supabase.from('escenarios').select('clave, supuestos, original, updated_at, updated_by'))
    .map((f) => [f.clave, {
      supuestos: f.supuestos,
      original: f.original,
      editado: JSON.stringify(f.supuestos) !== JSON.stringify(f.original),
      actualizado: { at: f.updated_at, por: f.updated_by },
    }]));
}

export async function guardarEscenario(clave, supuestos) {
  const f = ok(await supabase.from('escenarios').update({ supuestos }).eq('clave', clave).select('updated_at, updated_by').single());
  return { at: f.updated_at, por: f.updated_by };
}

// Vuelve los supuestos a los valores originales del Excel (columna `original`).
export async function restaurarEscenario(clave, original) {
  return guardarEscenario(clave, original);
}

export async function leerReferencia(clave) {
  return ok(await supabase.from('referencias').select('valor').eq('clave', clave).maybeSingle())?.valor ?? null;
}

// ─── Capitanes y tipo de cambio para el P&L ──────────────────────────────────

export async function leerPersonal() {
  return ok(await supabase.from('personal').select('*').order('rol', { ascending: false }).order('nombre')).map((p) => ({
    id: p.id, nombre: p.nombre, rol: p.rol, inicio: p.inicio, fin: p.fin,
    sueldoBrutoArs: Number(p.sueldo_bruto_ars), bonoAnualUsd: Number(p.bono_anual_usd), osdeCostoArs: Number(p.osde_costo_ars),
    notas: p.notas,
  }));
}

// Dólar del primer día hábil de cada mes desde `desdeMes`; para los meses sin dato, el último conocido.
export async function leerDolarPorMes(desdeMes) {
  const filas = ok(await supabase.from('serie_usd').select('fecha, valor').gte('fecha', `${desdeMes}-01`).order('fecha'));
  const primero = {};
  for (const f of filas) primero[f.fecha.slice(0, 7)] ??= Number(f.valor);
  const ultimo = filas.length ? Number(filas.at(-1).valor) : null;
  return { porMes: primero, ultimo };
}

// ─── Sueldos reales por mes ──────────────────────────────────────────────────

const CAMPOS_SUELDO = ['bruto_ars', 'cargas_ars', 'osde_ars', 'bono_ars', 'otros_ars'];
export const totalSueldo = (f) => CAMPOS_SUELDO.reduce((s, k) => s + Number(f[k] ?? 0), 0);

// Por mes: { personaId: fila } (montos como números).
export async function leerSueldosMes() {
  const filas = ok(await supabase.from('sueldos_mes').select('*'));
  const porMes = {};
  for (const f of filas) {
    porMes[f.mes] ??= {};
    porMes[f.mes][f.persona_id] = { ...f, ...Object.fromEntries(CAMPOS_SUELDO.map((k) => [k, Number(f[k])])) };
  }
  return porMes;
}

export async function guardarSueldo(mes, personaId, valores) {
  return ok(await supabase.from('sueldos_mes').upsert({ mes, persona_id: personaId, ...valores }, { onConflict: 'mes,persona_id' })
    .select('*').single());
}

export async function borrarSueldo(mes, personaId) {
  ok(await supabase.from('sueldos_mes').delete().eq('mes', mes).eq('persona_id', personaId));
}

export async function actualizarPersona(id, cambios) {
  ok(await supabase.from('personal').update(cambios).eq('id', id));
}

export async function guardarReferencia(clave, valor, descripcion = '') {
  ok(await supabase.from('referencias').upsert({ clave, valor, ...(descripcion ? { descripcion } : {}) }));
}

// ─── Evaluación de desempeño y bono semestral ────────────────────────────────

const numOnull = (x) => (x === null || x === undefined ? null : Number(x));

// Por semestre: { personaId: { evaluacion, reviews } }.
export async function leerEvaluaciones() {
  const [evals, reviews] = await Promise.all([
    supabase.from('evaluaciones').select('*'),
    supabase.from('reviews_360').select('*').order('created_at'),
  ]);
  const porId = {};
  const porSemestre = {};
  for (const e of ok(evals)) {
    const ev = { ...e, presentismo: numOnull(e.presentismo), hse: numOnull(e.hse), bono_pagado_ars: numOnull(e.bono_pagado_ars) };
    porId[e.id] = { evaluacion: ev, reviews: [] };
    porSemestre[e.semestre] ??= {};
    porSemestre[e.semestre][e.persona_id] = porId[e.id];
  }
  for (const r of ok(reviews)) porId[r.evaluacion_id]?.reviews.push({ ...r, puntaje: Number(r.puntaje) });
  return porSemestre;
}

export async function guardarEvaluacion(personaId, semestre, cambios) {
  return ok(await supabase.from('evaluaciones').upsert({ persona_id: personaId, semestre, ...cambios }, { onConflict: 'persona_id,semestre' })
    .select('*').single());
}

export async function agregarReview(evaluacionId, review) {
  return ok(await supabase.from('reviews_360').insert({ evaluacion_id: evaluacionId, ...review }).select('*').single());
}

export async function borrarReview(id) {
  ok(await supabase.from('reviews_360').delete().eq('id', id));
}

// ─── Gastos de operación ─────────────────────────────────────────────────────

export async function leerGastos() {
  return ok(await supabase.from('gastos_operacion').select('*').order('fecha').order('created_at'))
    .map((g) => ({ ...g, monto: Number(g.monto), iva_pct: Number(g.iva_pct), tipo_cambio: g.tipo_cambio === null ? null : Number(g.tipo_cambio) }));
}

export async function guardarGasto(gasto) {
  const { id, created_at, updated_at, updated_by, ...campos } = gasto;
  const q = id ? supabase.from('gastos_operacion').update(campos).eq('id', id) : supabase.from('gastos_operacion').insert(campos);
  return ok(await q.select('*').single());
}

export async function borrarGasto(id) {
  ok(await supabase.from('gastos_operacion').delete().eq('id', id));
}

export async function marcarReembolsablesFacturados(ids, mes) {
  if (!ids.length) return;
  ok(await supabase.from('gastos_operacion').update({ facturado_en: mes }).in('id', ids));
}

// ─── Gastos de administración y del vehículo (columna area) ──────────────────

export async function leerGastosAdmin() {
  return ok(await supabase.from('gastos_administracion').select('*').order('fecha').order('created_at'))
    .map((g) => ({ ...g, monto: Number(g.monto), iva_pct: Number(g.iva_pct), tipo_cambio: g.tipo_cambio === null ? null : Number(g.tipo_cambio) }));
}

export async function guardarGastoAdmin(gasto) {
  const { id, created_at, updated_at, updated_by, ...campos } = gasto;
  const q = id ? supabase.from('gastos_administracion').update(campos).eq('id', id) : supabase.from('gastos_administracion').insert(campos);
  return ok(await q.select('*').single());
}

export async function guardarGastosAdmin(gastos) {
  if (!gastos.length) return [];
  return ok(await supabase.from('gastos_administracion').insert(gastos).select('*'));
}

export async function borrarGastoAdmin(id) {
  ok(await supabase.from('gastos_administracion').delete().eq('id', id));
}

// ─── Up selling ──────────────────────────────────────────────────────────────

export async function leerUpselling() {
  return ok(await supabase.from('upselling').select('*').order('mes').order('created_at'))
    .map((u) => ({ ...u, ingreso: Number(u.ingreso), costo: Number(u.costo), tipo_cambio: u.tipo_cambio === null ? null : Number(u.tipo_cambio) }));
}

export async function guardarUpselling(linea) {
  const { id, created_at, updated_at, updated_by, ...campos } = linea;
  const q = id ? supabase.from('upselling').update(campos).eq('id', id) : supabase.from('upselling').insert(campos);
  return ok(await q.select('*').single());
}

export async function borrarUpselling(id) {
  ok(await supabase.from('upselling').delete().eq('id', id));
}

// ─── Xubio ───────────────────────────────────────────────────────────────────

// Prueba la conexión con Xubio y trae una muestra de OC, facturas de compra y pagos.
export async function diagnosticoXubio(desde, hasta) {
  const { data, error } = await supabase.functions.invoke('xubio', { body: { accion: 'diagnostico', desde, hasta } });
  if (error) throw new Error(data?.error ?? error.message);
  return data;
}

// Trae de Xubio las facturas de compra del proyecto (mismo proceso que el cron diario).
export async function sincronizarXubio(desde, hasta) {
  const { data, error } = await supabase.functions.invoke('xubio', { body: { accion: 'sincronizar-compras', desde, hasta } });
  if (error) throw new Error(data?.error ?? error.message);
  return data;
}

export async function leerComprasXubio() {
  return ok(await supabase.from('xubio_compras').select('*').order('fecha').order('id'))
    .map((x) => ({ ...x, importe: Number(x.importe), importe_ars: Number(x.importe_ars), iva_pct: Number(x.iva_pct) }));
}

export async function leerMapeoXubio() {
  return ok(await supabase.from('xubio_mapeo').select('*').order('producto_base'));
}

// Clasifica un producto: guarda el mapeo y lo aplica a sus renglones (salvo los clasificados a mano).
export async function guardarMapeoXubio(productoBase, area, rubro) {
  ok(await supabase.from('xubio_mapeo').upsert({ producto_base: productoBase, area, rubro }));
  ok(await supabase.from('xubio_compras').update({ area, rubro }).eq('producto_base', productoBase).eq('manual', false));
}

// Clasificación de un renglón puntual (queda fijo aunque cambie el mapeo del producto).
export async function clasificarCompraXubio(id, area, rubro) {
  ok(await supabase.from('xubio_compras').update({ area, rubro, manual: Boolean(area) }).eq('id', id));
}

// Solo lo que maneja la app (por ahora, la fecha de pago).
export async function actualizarCompraXubio(id, { pagado_el }) {
  ok(await supabase.from('xubio_compras').update({ pagado_el: pagado_el || null }).eq('id', id));
}

// ─── Xubio: presupuesto de cada proforma ─────────────────────────────────────

async function accionXubio(accion, extra = {}) {
  const { data, error } = await supabase.functions.invoke('xubio', { body: { accion, ...extra } });
  if (error) {
    // El mensaje de la función viene en el cuerpo de la respuesta.
    const detalle = await error.context?.json?.().catch(() => null);
    throw new Error(detalle?.error ?? data?.error ?? error.message);
  }
  return data;
}

export const opcionesVentasXubio = () => accionXubio('opciones-ventas');
export const altaVentasXubio = (items, confirmar = false, modeloProductoId = null) => accionXubio('alta-ventas', { items, confirmar, modeloProductoId });
export const enviarPresupuestoXubio = (proformaId) => accionXubio('enviar-presupuesto', { proformaId });
export const pdfPresupuestoXubio = (proformaId) => accionXubio('pdf-presupuesto', { proformaId });
export const estadoPresupuestoXubio = (proformaId, estado) => accionXubio('estado-presupuesto', { proformaId, estado });

export async function leerPresupuestosXubio(proformaIds) {
  if (!proformaIds.length) return {};
  const filas = ok(await supabase.from('xubio_presupuestos').select('*').in('proforma_id', proformaIds));
  return Object.fromEntries(filas.map((f) => [f.proforma_id, f]));
}

// ─── Documentos (PDF guardados en Supabase Storage, carpeta "documentos") ─────

// Genera en el servidor el PDF de la proforma y lo guarda; devuelve la ruta.
export async function guardarPdfProforma(proformaId) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch('/api/proforma-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify({ proformaId }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `El servidor respondió ${r.status}`);
  return d.ruta;
}

export const bajarDocumento = async (ruta) => ok(await supabase.storage.from('documentos').download(ruta));
