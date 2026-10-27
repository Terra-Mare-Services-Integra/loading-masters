import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cobranza, cobrosEsperados, porAnio, acumulado, margen } from '../src/lib/dashboard.js';

// Números inventados (repo público).
const cerca = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test('cobranza: cobradas, vencidas por antigüedad y a vencer, con IVA', () => {
  const filas = [
    { mes: '2027-01', ingreso: 100, facturaEmitidaEl: '2027-01-27', cobradaEl: '2027-02-20' },
    { mes: '2027-02', ingreso: 200, facturaEmitidaEl: '2027-02-25', cobradaEl: null },
    { mes: '2027-03', ingreso: 300, facturaEmitidaEl: '2027-03-26', cobradaEl: null },
    { mes: '2027-04', ingreso: 400, facturaEmitidaEl: null },
  ];
  const c = cobranza(filas, '2027-04-20');
  assert.deepEqual(c.facturas.map((f) => [f.mes, f.estado, f.atraso]), [
    ['2027-01', 'cobrada', 0], ['2027-02', 'vencida', 24], ['2027-03', 'a_vencer', 0],
  ]);
  cerca(c.facturado, 600 * 1.21);
  cerca(c.cobrado, 100 * 1.21);
  cerca(c.vencido, 200 * 1.21);
  cerca(c.pendiente, 500 * 1.21);
  cerca(c.tramos[0].monto, 200 * 1.21);
  assert.equal(c.diasPromedioCobro, 24);
  const e = cobrosEsperados(filas);
  assert.deepEqual(e.map((x) => [x.mes, x.cobro]), [['2027-04', sumar('2027-04-27', 30)]]);
});
const sumar = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

test('agregados: por año, acumulado y margen', () => {
  const filas = [{ mes: '2026-12', a: 1 }, { mes: '2027-01', a: 2 }, { mes: '2027-02', a: 3 }];
  assert.deepEqual(porAnio(filas, ['a']), { 2026: { a: 1 }, 2027: { a: 5 } });
  assert.deepEqual(acumulado(filas, 'a').map((x) => x.valor), [1, 3, 6]);
  assert.equal(margen(5, 0), null);
  assert.equal(margen(5, 20), 0.25);
});
