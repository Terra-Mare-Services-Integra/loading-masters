import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costoMensualUsd, vigencias, cronogramaCuotas } from '../src/lib/seguros.js';
import { periodosContrato, calcularPnl } from '../src/lib/pnl.js';
import { completarEscenario } from '../src/lib/resultado.js';

// Números inventados (repo público).
const cerca = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);
const POLIZAS = [{ id: 'a', primaAnualUsd: 1_200 }, { id: 'b', primaAnualUsd: 2_400 }];

test('seguros: devengado mensual y vigencias anuales', () => {
  assert.equal(costoMensualUsd(POLIZAS), 300);
  assert.deepEqual(vigencias('2027-01-01', '2028-06-30'), [
    { n: 1, desde: '2027-01-01', hasta: '2027-12-31' },
    { n: 2, desde: '2028-01-01', hasta: '2028-06-30' },
  ]);
});

test('seguros: cada vigencia en cuotas mensuales desde su inicio', () => {
  const c = cronogramaCuotas(POLIZAS, { inicio: '2027-01-01', hasta: '2028-12-31', cuotas: 4 });
  assert.equal(c.length, 8);
  assert.deepEqual(c.slice(0, 5).map((x) => [x.mes, x.vigencia, x.cuota, x.totalUsd]), [
    ['2027-01', 1, 1, 900], ['2027-02', 1, 2, 900], ['2027-03', 1, 3, 900], ['2027-04', 1, 4, 900], ['2028-01', 2, 1, 900],
  ]);
  assert.equal(c[0].porPoliza.b, 600);
});

test('P&L: desde la operación plena va al 100 % con seguros', () => {
  const periodos = periodosContrato(2, '2026-12-01');
  const arranque = completarEscenario({ factorPrecio: 0.5, sgFijoUsd: 20 });
  const esperado = completarEscenario({ factorPrecio: 1, sgFijoUsd: 20 });
  const [dic, ene] = calcularPnl({
    periodos, facturaciones: {}, personal: [], cargas: {}, fx: () => 10,
    escenarios: { arranque, esperado }, inicioSeguros: '2027-01-01', inicioPleno: '2027-01-01', costoSegurosUsd: 7,
  });
  assert.equal(dic.factor, 0.5);
  assert.equal(dic.ingresoSeguros, 0);
  assert.equal(dic.polizas, 0);
  cerca(dic.sergioFijo, 20 * 0.5 * 10);
  assert.equal(ene.factor, 1);
  assert.ok(ene.ingresoSeguros > 0);
  cerca(ene.polizas, 70);
  cerca(ene.sergioFijo, 200);
});
