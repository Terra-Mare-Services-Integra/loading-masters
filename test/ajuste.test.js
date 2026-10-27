import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factorAjuste, preciosAjustados, disparadores, vigenciaPedido } from '../src/lib/ajuste.js';
import { CONTRATO_VMOS } from '../src/lib/contrato.js';
import { ventanasDelPeriodo, evaluarVentana, baseVigente, preciosEnFecha, estadoVentana, mesesEntre } from '../src/lib/ajuste.js';
import { certificar } from '../src/lib/certificacion.js';
import { rangoDias } from '../src/lib/fechas.js';

const base = CONTRATO_VMOS.ajuste.base;

test('con los índices base el factor es 1', () => {
  assert.equal(factorAjuste(base).toFixed(12), '1.000000000000');
});

test('ponderación 70/20/10', () => {
  // Solo sube MO un 10% → factor 1,07
  assert.equal(factorAjuste({ ...base, mo: base.mo * 1.1 }).toFixed(6), '1.070000');
  // IPC +10% → 1,02 ; USD +10% → 1,01
  assert.equal(factorAjuste({ ...base, ipc: base.ipc * 1.1 }).toFixed(6), '1.020000');
  assert.equal(factorAjuste({ ...base, usd: base.usd * 1.1 }).toFixed(6), '1.010000');
});

test('precios ajustados solo para ítems mensuales', () => {
  const p = preciosAjustados({ ...base, mo: base.mo * 1.1 }, base);
  assert.deepEqual(Object.keys(p), ['1', '1a', '1b', '1c']);
  assert.equal(p['1'], 152_685_288.56);
});

test('disparadores de revisión', () => {
  assert.equal(disparadores(base, base).habilitado, false);
  assert.deepEqual(disparadores({ ...base, ipc: base.ipc * 1.16 }, base).motivos, ['ipc']);
  assert.deepEqual(disparadores({ ...base, usd: base.usd * 1.15 }, base).motivos, []); // tiene que superar el 15%
  assert.deepEqual(disparadores(base, base, { paritaria: true, mesesDesdeUltima: 6 }).motivos, ['paritaria', 'plazo']);
});

test('ventana de pedido: días 1 a 10, rige desde el mes siguiente', () => {
  assert.deepEqual(vigenciaPedido('2027-02-05'), { enVentana: true, rigeDesde: '2027-03-01' });
  assert.deepEqual(vigenciaPedido('2026-12-15'), { enVentana: false, rigeDesde: '2027-01-01' });
});

// ─── Evaluación por ventana ──────────────────────────────────────────────────

const NOV = { mo: 6_700_000, ipc: 12_900, usd: 1_600 };
const aprobadoNov = { mes: '2026-11', rigeDesde: '2026-12-01', indices: NOV, factor: 1.050019586, precios: { 1: 149_834_152.84, '1a': 1, '1b': 1, '1c': 1 } };

test('ventanas del 1 al 10 dentro de cada facturación', () => {
  assert.deepEqual(ventanasDelPeriodo({ desde: '2026-10-26', hasta: '2026-11-30' }).map((v) => v.mes), ['2026-11']);
  assert.deepEqual(ventanasDelPeriodo({ desde: '2026-12-01', hasta: '2026-12-31' })[0],
    { mes: '2026-12', desde: '2026-12-01', hasta: '2026-12-10', rigeDesde: '2027-01-01' });
  assert.deepEqual(ventanasDelPeriodo({ desde: '2026-11-15', hasta: '2027-01-05' }).map((v) => v.mes), ['2026-12', '2027-01']);
});

test('estado de la ventana según el día', () => {
  const v = { desde: '2026-11-01', hasta: '2026-11-10' };
  assert.equal(estadoVentana(v, '2026-10-27'), 'futura');
  assert.equal(estadoVentana(v, '2026-11-10'), 'abierta');
  assert.equal(estadoVentana(v, '2026-11-11'), 'cerrada');
});

test('evaluar noviembre contra la base del contrato', () => {
  const e = evaluarVentana({ mes: '2026-11', indices: NOV });
  assert.equal(e.base.origen, 'contrato');
  assert.equal(e.rigeDesde, '2026-12-01');
  assert.equal(e.factor.toFixed(9), '1.050019586');
  assert.equal(e.precios['1'], 149_834_152.84);
  assert.equal(e.variaciones.ipc.toFixed(4), '0.0508');
  assert.deepEqual(e.motivos, []); // ninguna variación supera el 15% y pasó 1 mes
  assert.equal(e.habilitado, false);
});

test('disparadores: IPC > 15%, paritaria y 6 meses desde la base', () => {
  assert.deepEqual(evaluarVentana({ mes: '2026-12', indices: { ...NOV, ipc: 12_276.8 * 1.16 } }).motivos, ['ipc']);
  assert.deepEqual(evaluarVentana({ mes: '2026-12', indices: {}, paritaria: true }).motivos, ['paritaria']);
  assert.equal(mesesEntre('2026-10', '2027-04'), 6);
  assert.deepEqual(evaluarVentana({ mes: '2027-04', indices: {} }).motivos, ['plazo']);
  assert.equal(evaluarVentana({ mes: '2027-04', indices: {} }).completo, false);
});

test('un ajuste aprobado pasa a ser la base de la próxima revisión', () => {
  const base = baseVigente([aprobadoNov], '2026-12');
  assert.equal(base.mes, '2026-11');
  assert.deepEqual(base.indices, NOV);
  const e = evaluarVentana({ mes: '2026-12', indices: NOV, aprobados: [aprobadoNov] });
  assert.equal(e.factor.toFixed(9), '1.000000000');
  assert.equal(e.precios['1'], 149_834_152.84);
  // la cuenta de 6 meses arranca desde la última actualización
  assert.deepEqual(evaluarVentana({ mes: '2027-05', indices: {}, aprobados: [aprobadoNov] }).motivos, ['plazo']);
});

test('precios por fecha y certificación que cruza el inicio de un ajuste', () => {
  assert.equal(preciosEnFecha([aprobadoNov], '2026-11-30')['1'], 142_696_531.36);
  assert.equal(preciosEnFecha([aprobadoNov], '2026-12-01')['1'], 149_834_152.84);
  const periodo = { desde: '2026-11-21', hasta: '2026-12-10' };
  const unos = Object.fromEntries(rangoDias(periodo.desde, periodo.hasta).map((f) => [f, 1]));
  const cert = certificar({ periodo, factores: { 1: unos }, precios: (f) => preciosEnFecha([aprobadoNov], f) });
  assert.equal(cert.items[0].importe, 95_899_108.14); // 10/30 a precio base + 10/31 a precio ajustado
  assert.equal(cert.items[0].preciosDistintos.length, 2);
});

test('con índices incompletos igual muestra cada variación y evalúa los disparadores', () => {
  const e = evaluarVentana({ mes: '2026-11', indices: { mo: 7_000_000, ipc: 12_514.1508 } });
  assert.equal(e.completo, false);
  assert.equal(e.variaciones.mo.toFixed(4), '0.0969');
  assert.equal(e.variaciones.ipc.toFixed(4), '0.0193');
  assert.equal(e.variaciones.usd, null);
  assert.equal(e.factor, undefined);
  assert.deepEqual(evaluarVentana({ mes: '2026-12', indices: { ipc: 12_276.8 * 1.16 } }).motivos, ['ipc']);
});
