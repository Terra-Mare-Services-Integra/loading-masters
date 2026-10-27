import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodoDeCierre, certificar, calendarioCobro } from '../src/lib/certificacion.js';
import { rangoDias } from '../src/lib/fechas.js';

test('el período que cierra en noviembre va del 21/10 al 20/11 (31 días)', () => {
  const p = periodoDeCierre('2026-11');
  assert.deepEqual(p, { desde: '2026-10-21', hasta: '2026-11-20' });
  assert.equal(rangoDias(p.desde, p.hasta).length, 31);
});

test('el período que cierra en enero cruza el año', () => {
  assert.deepEqual(periodoDeCierre('2027-01'), { desde: '2026-12-21', hasta: '2027-01-20' });
});

test('noviembre 2026: ítem 1 al 0,75 desde el 26/10, sin adicionales', () => {
  const periodo = periodoDeCierre('2026-11');
  const factor1 = Object.fromEntries(rangoDias('2026-10-26', '2026-11-20').map((f) => [f, 0.75]));
  const cert = certificar({ periodo, factores: { 1: factor1 } });

  const item1 = cert.items.find((i) => i.codigo === '1');
  assert.equal(item1.diasEquivalentes, 19.5); // 26 días × 0,75
  assert.equal(item1.costoDiario.toFixed(2), '4603113.91'); // 142.696.531,36 / 31
  assert.equal(item1.importe, 89_760_721.34); // 142.696.531,36 × 19,5 / 31
  for (const c of ['1a', '1b', '1c', '1d']) assert.equal(cert.items.find((i) => i.codigo === c).importe, 0);
  assert.equal(cert.total, item1.importe);
});

test('servicio completo todo el período = precio mensual', () => {
  const periodo = periodoDeCierre('2026-11');
  const full = Object.fromEntries(rangoDias(periodo.desde, periodo.hasta).map((f) => [f, 1]));
  const cert = certificar({ periodo, factores: { 1: full, '1a': full } });
  assert.equal(cert.items[0].importe, 142_696_531.36);
  assert.equal(cert.items[1].importe, 1_016_319.05);
});

test('reembolsables se facturan con 10% de fee', () => {
  const cert = certificar({ periodo: periodoDeCierre('2026-11'), factores: {}, reembolsables: { '1d': 1_000_000 } });
  assert.equal(cert.items.find((i) => i.codigo === '1d').importe, 1_100_000);
});

test('calendario de cobro de noviembre 2026', () => {
  const cal = calendarioCobro(periodoDeCierre('2026-11'));
  assert.deepEqual(cal, {
    envioProforma: '2026-11-20', // viernes
    finRevision: '2026-11-27', // 5 días hábiles
    factura: '2026-11-30',
    vencimientoPago: '2026-12-30',
  });
});

test('los feriados corren el fin de la revisión', () => {
  const cal = calendarioCobro(periodoDeCierre('2026-11'), { feriados: ['2026-11-23'] });
  assert.equal(cal.finRevision, '2026-11-30');
});
