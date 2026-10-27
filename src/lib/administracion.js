// Gastos de administración: la estructura de Terra Mare para el contrato. Siempre son costo (no se
// reembolsan). La proyección es un presupuesto mensual en USD por rubro (referencias.administracion);
// los montos viven en la base, este archivo solo tiene las fórmulas.

import { montoArs } from './operacion.js';

export const RUBROS_ADMIN = [
  { id: 'liquidacion_sueldos', nombre: 'Sistema de liquidación de sueldos' },
  { id: 'sistema_contable', nombre: 'Sistema contable' },
  { id: 'telefonia', nombre: 'Telefonía e internet' },
  { id: 'software', nombre: 'Licencias de software (Office, etc.)' },
  { id: 'honorarios', nombre: 'Honorarios profesionales (contables, legales)' },
  { id: 'bancarios', nombre: 'Gastos bancarios' },
  { id: 'oficina', nombre: 'Oficina e insumos' },
  { id: 'tasas', nombre: 'Tasas, sellados y trámites' },
  { id: 'miscelaneos', nombre: 'Misceláneos' },
];
export const nombreRubroAdmin = (id) => RUBROS_ADMIN.find((r) => r.id === id)?.nombre ?? id;

// Presupuesto mensual (USD) de un rubro en un año: cada rubro guarda un valor por año
// ({ '2027': 50 }); un número solo vale para todos los años.
export const presupuestoRubroUsd = (valor, anio) => Number(valor !== null && typeof valor === 'object' ? valor[anio] : valor) || 0;

// Suma del presupuesto mensual (USD) de todos los rubros en un año.
export const presupuestoMensualUsd = (presupuesto = {}, anio) => Object.values(presupuesto)
  .reduce((s, v) => s + presupuestoRubroUsd(v, anio), 0);

// Totales de un mes, sin IVA y en pesos, con el detalle por rubro.
export function resumenAdmin(gastos) {
  const r = { total: 0, pendientesDePago: 0, porRubro: {}, cantidad: gastos.length };
  for (const g of gastos) {
    const m = montoArs(g);
    r.total += m;
    r.porRubro[g.rubro] = (r.porRubro[g.rubro] ?? 0) + m;
    if (!g.pagado_el) r.pendientesDePago += 1;
  }
  return r;
}

export function adminPorMes(gastos) {
  const porMes = {};
  for (const g of gastos) (porMes[g.mes] ??= []).push(g);
  return Object.fromEntries(Object.entries(porMes).map(([mes, gs]) => [mes, resumenAdmin(gs)]));
}

// Copia los gastos de un mes al siguiente (mismo día, sin pago): sirve para los abonos que se repiten.
export function copiarAlMes(gastos, mes) {
  const [y, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return gastos.map(({ id, created_at, updated_at, updated_by, pagado_el, ...g }) => ({
    ...g, mes, fecha: `${mes}-${String(Math.min(Number(g.fecha.slice(8, 10)), ultimo)).padStart(2, '0')}`, pagado_el: null,
  }));
}
