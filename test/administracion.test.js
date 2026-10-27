import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presupuestoMensualUsd, resumenAdmin, adminPorMes, copiarAlMes } from '../src/lib/administracion.js';
import { periodosContrato, calcularPnl } from '../src/lib/pnl.js';
import { completarEscenario } from '../src/lib/resultado.js';

// Números inventados (repo público).
const cerca = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);
const GASTOS = [
  { mes: '2027-01', fecha: '2027-01-31', rubro: 'telefonia', moneda: 'ARS', monto: 700, pagado_el: '2027-02-01' },
  { mes: '2027-01', fecha: '2027-01-05', rubro: 'sistema_contable', moneda: 'USD', monto: 3, tipo_cambio: 100, pagado_el: null },
];

test('administración: presupuesto, resumen y copia al mes siguiente', () => {
  assert.equal(presupuestoMensualUsd({ telefonia: 4, software: '6', vacio: '' }), 10);
  const r = resumenAdmin(GASTOS);
  assert.equal(r.total, 1_000);
  assert.equal(r.pendientesDePago, 1);
  assert.deepEqual(r.porRubro, { telefonia: 700, sistema_contable: 300 });
  assert.equal(adminPorMes(GASTOS)['2027-01'].cantidad, 2);
  const c = copiarAlMes(GASTOS.map((g) => ({ ...g, id: 'x' })), '2027-02');
  assert.deepEqual(c.map((g) => [g.mes, g.fecha, g.pagado_el, g.id]), [['2027-02', '2027-02-28', null, undefined], ['2027-02', '2027-02-05', null, undefined]]);
});

test('P&L: administración real reemplaza al presupuesto del mes', () => {
  const periodos = periodosContrato(2, '2027-01-01');
  const esc = completarEscenario({ factorPrecio: 1, estructuraTmUsd: 99 });
  const [ene, feb] = calcularPnl({
    periodos, facturaciones: {}, personal: [], cargas: {}, fx: () => 10, escenarios: { arranque: esc, esperado: esc },
    administracion: { '2027-01': { total: 1_000 } }, administracionUsd: 5,
  });
  assert.equal(ene.estructura, 1_000);
  assert.equal(ene.administracionReal, true);
  cerca(feb.estructura, 50);
});
