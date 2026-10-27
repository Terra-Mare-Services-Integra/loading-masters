// Gastos de operación: cada gasto tiene un rubro y es Compra (costo de Terra Mare) o Reembolsable
// (se le factura a VMOS con el fee del ítem 1d). Los honorarios de Sergio son un rubro más.

export const RUBROS = [
  { id: 'transporte_aereo', nombre: 'Transporte aéreo' },
  { id: 'transporte_terrestre', nombre: 'Transporte terrestre' },
  { id: 'combustible', nombre: 'Combustible' },
  { id: 'hospedaje', nombre: 'Hospedaje' },
  { id: 'vivienda', nombre: 'Vivienda (alquiler y expensas)' },
  { id: 'comida', nombre: 'Comida y viáticos' },
  { id: 'ropa', nombre: 'Ropa de trabajo y EPP' },
  { id: 'equipamiento', nombre: 'Equipamiento técnico' },
  { id: 'documentacion', nombre: 'Documentación y cursos' },
  { id: 'examenes', nombre: 'Exámenes médicos' },
  { id: 'comunicaciones', nombre: 'Celulares y comunicaciones' },
  { id: 'superintendente', nombre: 'Superintendente técnico (Sergio)' },
  { id: 'miscelaneos', nombre: 'Misceláneos' },
];
export const nombreRubro = (id) => RUBROS.find((r) => r.id === id)?.nombre ?? id;
export const etiquetaGasto = (g) => (g.rubro === 'superintendente' && !g.reembolsable
  ? 'Honorarios de Sergio (superintendente)'
  : `${g.reembolsable ? 'Reembolsable' : 'Compra'} ${nombreRubro(g.rubro).toLowerCase()}`);

// Monto sin IVA en pesos (los gastos en USD se convierten al tipo de cambio cargado).
export const montoArs = (g) => Number(g.monto) * (g.moneda === 'USD' ? Number(g.tipo_cambio) : 1);
export const conIvaArs = (g) => montoArs(g) * (1 + Number(g.iva_pct || 0));

/**
 * Totales de un mes, sin IVA y en pesos: compras (sin Sergio), honorarios de Sergio y reembolsables,
 * más el detalle por rubro.
 */
export function resumenGastos(gastos) {
  const r = { compras: 0, sergio: 0, reembolsables: 0, total: 0, pendientesDePago: 0, porRubro: {}, cantidad: gastos.length };
  for (const g of gastos) {
    const m = montoArs(g);
    if (g.reembolsable) r.reembolsables += m;
    else if (g.rubro === 'superintendente') r.sergio += m;
    else r.compras += m;
    r.total += m;
    if (!g.pagado_el) r.pendientesDePago += 1;
    r.porRubro[g.rubro] ??= { compra: 0, reembolsable: 0 };
    r.porRubro[g.rubro][g.reembolsable ? 'reembolsable' : 'compra'] += m;
  }
  return r;
}

// Gastos agrupados por mes de imputación → resumen de cada mes.
export function gastosPorMes(gastos) {
  const porMes = {};
  for (const g of gastos) (porMes[g.mes] ??= []).push(g);
  return Object.fromEntries(Object.entries(porMes).map(([mes, gs]) => [mes, resumenGastos(gs)]));
}
