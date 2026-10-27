import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodosContrato, mesesEquivalentes, costoEmpleado, calcularPnl, totalesPnl } from '../src/lib/pnl.js';
import { completarEscenario } from '../src/lib/resultado.js';

// Números inventados (repo público). La verificación contra el Excel está en test/local.
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);

test('períodos: si arranca un día 1, el primer período es ese mes', () => {
  assert.deepEqual(periodosContrato(2, '2027-01-01').map((x) => [x.mes, x.desde, x.hasta]), [
    ['2027-01', '2027-01-01', '2027-01-31'],
    ['2027-02', '2027-02-01', '2027-02-28'],
  ]);
});

test('períodos: el primero arranca con el servicio y el último termina antes del aniversario', () => {
  const p = periodosContrato(3, '2026-10-26');
  assert.deepEqual(p.map((x) => [x.mes, x.desde, x.hasta]), [
    ['2026-11', '2026-10-26', '2026-11-30'],
    ['2026-12', '2026-12-01', '2026-12-31'],
    ['2027-01', '2027-01-01', '2027-01-25'],
  ]);
  cerca(mesesEquivalentes(p[0]), 6 / 31 + 1, '26/10–30/11');
  cerca(mesesEquivalentes(p[1], '2026-12-16'), 16 / 31, 'ingreso a mitad de mes');
  cerca(mesesEquivalentes(p[1], '2027-02-01'), 0, 'todavía no ingresó');
});

const CARGAS = {
  pctCargas: 0.2, pctArt: 0.05, seguroVidaArs: 100, fondoArs: 200, pctSac: 0.1, pctSindical: 0,
  divisorVacaciones: 20, diasVacaciones: 12, pctAporteOs: 0.1,
};

test('costo empleador: licencia, SAC, cargas, OSDE y bono', () => {
  const c = costoEmpleado({ sueldoBrutoArs: 1_200_000, osdeCostoArs: 150_000, bonoAnualUsd: 2_400 }, CARGAS);
  // licencia = 1.200.000/20×12/12 − 1.200.000/30×12/12 = 60.000 − 40.000 = 20.000
  // SAC = 1.220.000 × 0,1 = 122.000 → remuneración 1.342.000
  // cargas = 1.342.000 × 0,25 + 300 = 335.800; OSDE = 150.000 − 120.000 = 30.000
  cerca(c.ars, 1_342_000 + 335_800 + 30_000, 'pesos');
  cerca(c.bonoUsd, 200 * 1.35, 'bono mensual con contribuciones');
});

test('P&L: proyección, facturación real y capitanes que entran después', () => {
  const periodos = periodosContrato(2, '2027-01-01');
  const esc = completarEscenario({
    factorPrecio: 0.5, operacionUsd: 10, sgFijoUsd: 20, estructuraBaseSgUsd: 30,
    pctImprevistos: 0.01, pctCredito: 0, pctIibb: 0.04, pctParticipacionSg: 0.1,
  });
  const filas = calcularPnl({
    periodos,
    facturaciones: { '2027-02': { total: 1_000_000, factores: {}, facturaEmitidaEl: '2027-03-01', hasta: periodos[1].hasta } },
    personal: [
      { sueldoBrutoArs: 1_200_000, osdeCostoArs: 150_000, bonoAnualUsd: 0, inicio: '2027-01-01', fin: null },
      { sueldoBrutoArs: 1_200_000, osdeCostoArs: 150_000, bonoAnualUsd: 0, inicio: '2027-03-01', fin: null },
    ],
    cargas: CARGAS,
    escenarios: { arranque: esc, esperado: esc },
    fx: () => 1_100,
  });
  const [ene, feb] = filas;
  assert.equal(ene.estado, 'proyeccion');
  assert.equal(feb.estado, 'facturado');
  assert.equal(feb.ingreso, 1_000_000);
  cerca(feb.capitanes, 1_707_800, 'el segundo capitán todavía no entró');
  cerca(feb.operacion, 10 * 1_100, 'operación en pesos');
  cerca(feb.sergioFijo, 20 * 0.5 * 1_100, 'fijo de Sergio escalado');
  cerca(feb.impuestos, 1_000_000 * 0.05, 'imprevistos e impuestos');
  cerca(feb.bruto, 1_000_000 - 1_707_800 - 11_000 - 11_000 - 50_000, 'resultado bruto');
  cerca(feb.participacion, 0.1 * feb.bruto - 0.1 * 30 * 0.5 * 1_100, 'participación');
  assert.ok(ene.ingreso > 0, 'enero se proyecta con el precio del contrato');
  cerca(totalesPnl(filas).generacion, ene.generacion + feb.generacion, 'totales');
});
