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
