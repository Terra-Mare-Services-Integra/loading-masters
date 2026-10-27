import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumenGastos, gastosPorMes, montoArs, etiquetaGasto } from '../src/lib/operacion.js';
import { periodosContrato, calcularPnl } from '../src/lib/pnl.js';
import { completarEscenario } from '../src/lib/resultado.js';

// Números inventados (repo público).
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
const G = [
  { mes: '2027-01', rubro: 'transporte_aereo', reembolsable: false, moneda: 'ARS', monto: 300, iva_pct: 0.21, pagado_el: '2027-01-05' },
  { mes: '2027-01', rubro: 'transporte_aereo', reembolsable: true, moneda: 'USD', monto: 2, tipo_cambio: 1_100, iva_pct: 0, pagado_el: null },
  { mes: '2027-01', rubro: 'superintendente', reembolsable: false, moneda: 'USD', monto: 3, tipo_cambio: 1_100, iva_pct: 0, pagado_el: null },
];

test('monto en pesos y etiqueta Compra / Reembolsable', () => {
  assert.equal(montoArs(G[1]), 2_200);
  assert.equal(etiquetaGasto(G[0]), 'Compra transporte aéreo');
  assert.equal(etiquetaGasto(G[1]), 'Reembolsable transporte aéreo');
});

test('resumen del mes: compras, Sergio y reembolsables por separado', () => {
  const r = resumenGastos(G);
  assert.deepEqual([r.compras, r.sergio, r.reembolsables, r.total, r.pendientesDePago], [300, 3_300, 2_200, 5_800, 2]);
  assert.deepEqual(r.porRubro.transporte_aereo, { compra: 300, reembolsable: 2_200 });
});

test('P&L: lo cargado en Operación reemplaza a lo proyectado de ese mes', () => {
  const periodos = periodosContrato(2, '2027-01-01');
  const esc = completarEscenario({ factorPrecio: 0.5, operacionUsd: 10, sgFijoUsd: 20 });
  const [ene, feb] = calcularPnl({
    periodos, facturaciones: {}, personal: [], cargas: {}, escenarios: { arranque: esc, esperado: esc }, fx: () => 1_100,
    gastos: gastosPorMes(G),
  });
  assert.deepEqual([ene.operacion, ene.sergioFijo, ene.reembolsables, ene.operacionReal], [300, 3_300, 2_200, true]);
  cerca(feb.operacion, 10 * 1_100, 'febrero proyectado');
  cerca(feb.sergioFijo, 20 * 0.5 * 1_100, 'Sergio proyectado');
  assert.equal(feb.operacionReal, false);
});
