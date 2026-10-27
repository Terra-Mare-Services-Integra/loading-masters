import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularResultado, completarEscenario } from '../src/lib/resultado.js';

// Números inventados (el repo es público: los valores reales viven solo en la base de datos).
// La verificación contra los Excel del usuario está en test/local (no se versiona): npm run test:excel
const ESCENARIO = completarEscenario({
  factorPrecio: 0.5,
  ingresoCocUsd: 100_000,
  ingresoSegurosUsd: 10_000,
  capitanesSr: { cantidad: 2, costoUsd: 10_000 },
  capitanesJr: { cantidad: 1, costoUsd: 6_000 },
  operacionUsd: 3_000,
  costoSegurosUsd: 4_000,
  estructuraTmUsd: 1_000,
  estructuraBaseSgUsd: 6_000,
  sgFijoUsd: 3_400,
  pctImprevistos: 0.01,
  pctCredito: 0.01,
  pctIibb: 0.05,
  pctParticipacionSg: 0.1,
  mesesContrato: 12,
  fx: 1_000,
});
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

test('CO&C: ingreso escalado, costos, impuestos y resultado bruto', () => {
  const { coc } = calcularResultado(ESCENARIO);
  cerca(coc.ingreso, 50_000, 'ingreso al 50 %');
  cerca(coc.sueldosSr + coc.sueldosJr, 26_000, 'capitanes');
  cerca(coc.sgFijo, 1_700, 'fijo de Sergio escalado');
  cerca(coc.imprevistos + coc.credito + coc.iibb, 3_500, 'imprevistos + impuestos');
  cerca(coc.bruto, 14_800, '50.000 − 26.000 − 3.000 − 1.000 − 1.700 − 3.500');
});

test('participación de Sergio: % del bruto CO&C menos % de la estructura base escalada', () => {
  const r = calcularResultado(ESCENARIO);
  cerca(r.coc.participacionSg, 1_180, '10 % × 14.800 − 10 % × 3.000');
  cerca(r.coc.generacion, 13_620, 'generación CO&C');
  cerca(r.sergio.mensual, 2_880, 'fijo + participación');
  cerca(r.contrato.sergio, 34_560, '12 meses');
});

test('seguros por separado y totales', () => {
  const r = calcularResultado(ESCENARIO);
  cerca(r.seguros.bruto, 5_300, '10.000 − 4.000 − 700');
  cerca(r.total.generacion, 18_920, 'CO&C + seguros');
  cerca(r.total.margen, 18_920 / 60_000, 'margen');
  cerca(r.contrato.generacionCoc + r.contrato.generacionSeguros, 227_040, '12 meses');
});

test('un escenario vacío da todo en cero', () => {
  const r = calcularResultado(completarEscenario({}));
  cerca(r.total.generacion, 0, 'generación');
  cerca(r.total.margen, 0, 'margen sin ingresos');
});
