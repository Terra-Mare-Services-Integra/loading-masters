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
  cerca(feb.impuestos, 0, 'facturado: sin imprevistos ni impuestos proyectados');
  cerca(feb.bruto, 1_000_000 - 1_707_800 - 11_000 - 11_000, 'resultado bruto');
  cerca(feb.participacion, 0.1 * feb.bruto - 0.1 * 30 * 0.5 * 1_100, 'participación');
  assert.ok(ene.ingreso > 0, 'enero se proyecta con el precio del contrato');
  cerca(totalesPnl(filas).generacion, ene.generacion + feb.generacion, 'totales');
});

import { periodosSueldos, costoCapitanesMes } from '../src/lib/pnl.js';

test('meses de sueldos: arrancan en el mes del inicio, proporcional', () => {
  const p = periodosSueldos(2, '2026-10-26');
  assert.deepEqual(p.map((x) => [x.mes, x.desde, x.hasta]), [
    ['2026-10', '2026-10-26', '2026-10-31'],
    ['2026-11', '2026-11-01', '2026-11-30'],
    ['2026-12', '2026-12-01', '2026-12-25'],
  ]);
});

test('costo de capitanes de un mes: real por persona si está cargado, si no proyectado', () => {
  const [oct] = periodosSueldos(2, '2026-10-26');
  const personal = [
    { id: 'a', sueldoBrutoArs: 1_200_000, osdeCostoArs: 150_000, bonoAnualUsd: 0, inicio: '2026-10-26', fin: null },
    { id: 'b', sueldoBrutoArs: 1_200_000, osdeCostoArs: 150_000, bonoAnualUsd: 0, inicio: '2026-10-26', fin: null },
    { id: 'c', sueldoBrutoArs: 1_200_000, osdeCostoArs: 150_000, bonoAnualUsd: 0, inicio: null, fin: null },
  ];
  const sinReales = costoCapitanesMes(oct, personal, CARGAS, 1_100);
  assert.equal(sinReales.porPersona.length, 2, 'el que no tiene fecha no cuenta');
  cerca(sinReales.total, 2 * 1_707_800 * 6 / 31, 'proporcional del 26 al 31');
  const conUno = costoCapitanesMes(oct, personal, CARGAS, 1_100, { a: 400_000 });
  assert.equal(conUno.conReales, true);
  cerca(conUno.total, 400_000 + 1_707_800 * 6 / 31, 'uno real y otro proyectado');
});

test('P&L: el primer período suma octubre y noviembre de sueldos, con lo real cargado', () => {
  const periodos = periodosContrato(1, '2026-10-26').slice(0, 1);
  const esc = completarEscenario({ factorPrecio: 0.5 });
  const personal = [{ id: 'a', sueldoBrutoArs: 1_200_000, osdeCostoArs: 150_000, bonoAnualUsd: 0, inicio: '2026-10-26', fin: null }];
  const [fila] = calcularPnl({
    periodos, facturaciones: {}, personal, cargas: CARGAS, escenarios: { arranque: esc, esperado: esc }, fx: () => 1_100,
    sueldosReales: { '2026-11': { a: 2_000_000 } },
  });
  cerca(fila.capitanes, 1_707_800 * 6 / 31 + 2_000_000, 'octubre proyectado + noviembre real');
  assert.equal(fila.sueldosReales, true);
});

import { participacionPorAnio } from '../src/lib/pnl.js';

test('participación de Sergio: se agrupa por año calendario, separando real y proyectado', () => {
  const filas = [
    { mes: '2026-11', desde: '2026-10-26', hasta: '2026-11-30', participacion: 100, real: true },
    { mes: '2026-12', desde: '2026-12-01', hasta: '2026-12-31', participacion: 120, real: false },
    { mes: '2027-01', desde: '2027-01-01', hasta: '2027-01-31', participacion: 130, real: false },
  ];
  const [a2026, a2027] = participacionPorAnio(filas);
  assert.deepEqual([a2026.anio, a2026.devengado, a2026.real, a2026.proyectado, a2026.desde, a2026.hasta], ['2026', 220, 100, 120, '2026-10-26', '2026-12-31']);
  assert.deepEqual([a2027.anio, a2027.devengado, a2027.meses], ['2027', 130, 1]);
});

test('P&L: imprevistos e impuestos solo en los meses proyectados', () => {
  const periodos = periodosContrato(2, '2027-01-01');
  const esc = completarEscenario({ factorPrecio: 1, pctImprevistos: 0.01, pctIibb: 0.04 });
  const [ene, feb] = calcularPnl({
    periodos, personal: [], cargas: {}, fx: () => 1, escenarios: { arranque: esc, esperado: esc },
    facturaciones: { '2027-01': { total: 1_000, factores: {}, facturaEmitidaEl: '2027-02-01', hasta: periodos[0].hasta } },
  });
  assert.equal(ene.impuestos, 0);
  cerca(feb.impuestos, feb.ingreso * 0.05, 'proyección');
});
