import { CONTRATO_VMOS } from './contrato.js';

const redondear = (x) => Math.round(x * 100) / 100;

// Factor de la fórmula polinómica del Anexo II para los índices del mes de aplicación.
// indices: { mo, ipc, usd } — MO1 (básico capitán FENA), IPC1 (INDEC n-2), USD1 (BNA divisa vendedor,
// primer día hábil del mes).
export function factorAjuste(indices, base = CONTRATO_VMOS.ajuste.base, ajuste = CONTRATO_VMOS.ajuste) {
  const { mo, ipc, usd } = ajuste.ponderaciones;
  const variable = mo * (indices.mo / base.mo) + ipc * (indices.ipc / base.ipc) + usd * (indices.usd / base.usd);
  return ajuste.costoFijo + (1 - ajuste.costoFijo) * variable;
}

// Precios ajustados de los ítems mensuales.
export function preciosAjustados(indices, base, contrato = CONTRATO_VMOS) {
  const f = factorAjuste(indices, base, contrato.ajuste);
  return Object.fromEntries(
    contrato.items.filter((i) => i.tipo === 'mensual').map((i) => [i.codigo, redondear(i.precioMensual * f)]),
  );
}

// Qué disparadores de revisión se cumplen. El ajuste NO es automático: habilita a pedir la revisión.
// `paritaria` indica un acuerdo gremial avalado por VMOS que altera el costo.
export function disparadores(indices, base, { mesesDesdeUltima = 0, paritaria = false } = {}, ajuste = CONTRATO_VMOS.ajuste) {
  const d = ajuste.disparadores;
  const varIpc = indices.ipc / base.ipc - 1;
  const varUsd = indices.usd / base.usd - 1;
  const motivos = [];
  if (varIpc > d.ipcAcumulado) motivos.push('ipc');
  if (varUsd > d.usdAcumulado) motivos.push('usd');
  if (paritaria) motivos.push('paritaria');
  if (mesesDesdeUltima >= d.meses) motivos.push('plazo');
  return { varIpc, varUsd, motivos, habilitado: motivos.length > 0 };
}

// Si se pide la revisión en `fechaPedido`, ¿es válido y desde cuándo rige?
export function vigenciaPedido(fechaPedido, ajuste = CONTRATO_VMOS.ajuste) {
  const [y, m, d] = fechaPedido.split('-').map(Number);
  const { desde, hasta } = ajuste.ventanaPedido;
  const siguiente = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { enVentana: d >= desde && d <= hasta, rigeDesde: siguiente };
}

// ─── Evaluación por ventana mensual ──────────────────────────────────────────
// Un "ajuste" aprobado guarda { mes, rigeDesde, indices, precios }: el mes de la ventana en que se
// pidió, desde cuándo rige, los índices usados (MO1, IPC1, USD1) y los precios resultantes. Según el
// Anexo II, esos índices y precios pasan a ser la base de la próxima revisión.

const mesSiguiente = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};

export function mesesEntre(desde, hasta) {
  const [y1, m1] = desde.split('-').map(Number);
  const [y2, m2] = hasta.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function baseContrato(contrato = CONTRATO_VMOS) {
  return {
    mes: contrato.inicioComputo,
    indices: contrato.ajuste.base,
    precios: Object.fromEntries(contrato.items.filter((i) => i.tipo === 'mensual').map((i) => [i.codigo, i.precioMensual])),
    origen: 'contrato',
  };
}

// Base contra la que se evalúa la ventana de `mes`: el último ajuste aprobado en una ventana anterior,
// o los valores del contrato.
export function baseVigente(aprobados, mes, contrato = CONTRATO_VMOS) {
  const previo = aprobados.filter((a) => a.mes < mes).sort((a, b) => a.mes.localeCompare(b.mes)).at(-1);
  return previo ? { mes: previo.mes, indices: previo.indices, precios: previo.precios, origen: previo.id ?? previo.mes } : baseContrato(contrato);
}

// Precios mensuales vigentes en una fecha: los del último ajuste aprobado que ya rige, o los del contrato.
export function preciosEnFecha(aprobados, fecha, contrato = CONTRATO_VMOS) {
  const vigente = aprobados.filter((a) => a.rigeDesde <= fecha).sort((a, b) => a.rigeDesde.localeCompare(b.rigeDesde)).at(-1);
  return vigente ? vigente.precios : baseContrato(contrato).precios;
}

// Ventanas de pedido (días 1 a 10) que caen dentro del período de una facturación.
export function ventanasDelPeriodo(periodo, contrato = CONTRATO_VMOS) {
  const { desde: d1, hasta: d10 } = contrato.ajuste.ventanaPedido;
  const pad = (n) => String(n).padStart(2, '0');
  const ventanas = [];
  for (let mes = periodo.desde.slice(0, 7); mes <= periodo.hasta.slice(0, 7); mes = mesSiguiente(mes)) {
    const v = { mes, desde: `${mes}-${pad(d1)}`, hasta: `${mes}-${pad(d10)}`, rigeDesde: `${mesSiguiente(mes)}-01` };
    if (v.desde <= periodo.hasta && v.hasta >= periodo.desde && mes >= contrato.inicioComputo) ventanas.push(v);
  }
  return ventanas;
}

export function estadoVentana(ventana, hoy) {
  if (hoy < ventana.desde) return 'futura';
  if (hoy > ventana.hasta) return 'cerrada';
  return 'abierta';
}

/**
 * Evalúa la fórmula del Anexo II en la ventana de `mes`.
 * @param {object} p
 * @param {string} p.mes Mes de aplicación 'YYYY-MM'.
 * @param {{mo?: number, ipc?: number, usd?: number}} p.indices MO1, IPC1 (n-2) y USD1 de ese mes.
 * @param {object[]} p.aprobados Ajustes aprobados hasta hoy.
 * @param {boolean} [p.paritaria] Acuerdo gremial avalado por VMOS que altera el costo.
 */
export function evaluarVentana({ mes, indices, aprobados = [], paritaria = false }, contrato = CONTRATO_VMOS) {
  const base = baseVigente(aprobados, mes, contrato);
  const mesesDesdeBase = mesesEntre(base.mes, mes);
  const tiene = (k) => Number(indices?.[k]) > 0;
  const completo = ['mo', 'ipc', 'usd'].every(tiene);
  // Cada variación y cada disparador se evalúan con lo que haya; el factor necesita los tres índices.
  const variaciones = Object.fromEntries(['mo', 'ipc', 'usd'].map((k) => [k, tiene(k) ? indices[k] / base.indices[k] - 1 : null]));
  const d = contrato.ajuste.disparadores;
  const motivos = [];
  if (variaciones.ipc !== null && variaciones.ipc > d.ipcAcumulado) motivos.push('ipc');
  if (variaciones.usd !== null && variaciones.usd > d.usdAcumulado) motivos.push('usd');
  if (paritaria) motivos.push('paritaria');
  if (mesesDesdeBase >= d.meses) motivos.push('plazo');
  const resultado = { mes, rigeDesde: `${mesSiguiente(mes)}-01`, base, mesesDesdeBase, completo, variaciones, motivos, habilitado: motivos.length > 0 };
  if (!completo) return resultado;
  const factor = factorAjuste(indices, base.indices, contrato.ajuste);
  return {
    ...resultado,
    factor,
    precios: Object.fromEntries(Object.entries(base.precios).map(([c, p]) => [c, redondear(p * factor)])),
  };
}
