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

test('vehículo: amortización desde la compra hasta el fin del contrato', async () => {
  const { mesesAmortizacion, amortizacionMesUsd } = await import('../src/lib/vehiculo.js');
  const v = { precioUsd: 1_300, residualUsd: 100, fechaCompra: '2027-01-15' };
  assert.equal(mesesAmortizacion(v, '2027-12-31'), 12);
  assert.equal(amortizacionMesUsd(v, '2027-12-31', '2026-12'), 0);
  assert.equal(amortizacionMesUsd(v, '2027-12-31', '2027-01'), 100);
  assert.equal(amortizacionMesUsd(v, '2027-12-31', '2027-12'), 100);
  assert.equal(amortizacionMesUsd({ ...v, meses: 6 }, '2027-12-31', '2027-07'), 0);
});

test('up selling: líneas y reembolsables, fuera del ingreso del contrato', async () => {
  const { upsellingPorMes } = await import('../src/lib/upselling.js');
  const up = upsellingPorMes([
    { mes: '2027-01', moneda: 'ARS', ingreso: 500, costo: 200 },
    { mes: '2027-01', moneda: 'USD', ingreso: 2, costo: 1, tipo_cambio: 100 },
  ]);
  assert.deepEqual(up['2027-01'], { ingreso: 700, costo: 300, cantidad: 2 });
  const periodos = periodosContrato(1, '2027-01-01');
  const esc = completarEscenario({ factorPrecio: 1 });
  const [ene] = calcularPnl({
    periodos, personal: [], cargas: {}, fx: () => 1, escenarios: { arranque: esc, esperado: esc }, upselling: up,
    gastos: { '2027-01': { compras: 0, sergio: 0, reembolsables: 1_000 } },
    facturaciones: { '2027-01': { total: 9_000, factores: {}, reembolsables: { '1d': 1_000 }, facturaEmitidaEl: '2027-02-01', hasta: periodos[0].hasta } },
  });
  cerca(ene.ingresoContrato, 9_000 - 1_100);
  cerca(ene.upsellingIngreso, 1_100 + 700);
  cerca(ene.upsellingCosto, 1_000 + 300);
  cerca(ene.upselling, 500);
  cerca(ene.bruto, 9_000 - 1_100 + 500);
});
