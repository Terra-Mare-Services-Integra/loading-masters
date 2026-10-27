import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodoDeCierre, certificar, calendarioCobro, diasDelMes, costoDiario } from '../src/lib/certificacion.js';
import { rangoDias } from '../src/lib/fechas.js';

const llenar = (desde, hasta, factor) => Object.fromEntries(rangoDias(desde, hasta).map((f) => [f, factor]));

test('el período sugerido que cierra en noviembre va del 21/10 al 20/11', () => {
  assert.deepEqual(periodoDeCierre('2026-11'), { desde: '2026-10-21', hasta: '2026-11-20' });
  assert.deepEqual(periodoDeCierre('2027-01'), { desde: '2026-12-21', hasta: '2027-01-20' });
});

test('días del mes y costo diario por mes calendario', () => {
  assert.equal(diasDelMes('2026-10-26'), 31);
  assert.equal(diasDelMes('2026-11-30'), 30);
  assert.equal(diasDelMes('2028-02-10'), 29);
  assert.equal(costoDiario(142_696_531.36, '2026-10-26').toFixed(2), '4603113.91');
  assert.equal(costoDiario(142_696_531.36, '2026-11-01').toFixed(2), '4756551.05');
});

test('facturación de noviembre: 26/10 al 30/11, ítem 1 al 0,75', () => {
  const periodo = { desde: '2026-10-26', hasta: '2026-11-30' };
  const cert = certificar({ periodo, factores: { 1: llenar(periodo.desde, periodo.hasta, 0.75) } });
  const item1 = cert.items.find((i) => i.codigo === '1');
  assert.equal(cert.dias.length, 36);
  assert.equal(item1.diasEquivalentes, 27); // 36 × 0,75
  assert.equal(item1.mesesEquivalentes.toFixed(6), '0.895161'); // 6×0,75/31 + 30×0,75/30
  assert.equal(item1.importe, 127_736_411.14);
  assert.equal(cert.total, item1.importe);
});

test('un mes calendario completo al 1 vale exactamente el precio mensual', () => {
  for (const [desde, hasta] of [['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-31'], ['2027-02-01', '2027-02-28']]) {
    const cert = certificar({ periodo: { desde, hasta }, factores: { 1: llenar(desde, hasta, 1), '1a': llenar(desde, hasta, 1) } });
    assert.equal(cert.items[0].importe, 142_696_531.36);
    assert.equal(cert.items[1].importe, 1_016_319.05);
  }
});

test('divisor fijo (como el Excel original, /31)', () => {
  const periodo = periodoDeCierre('2026-11');
  const cert = certificar({ periodo, factores: { 1: llenar('2026-10-26', '2026-11-20', 0.75) }, divisor: 31 });
  assert.equal(cert.items[0].importe, 89_760_721.34); // 142.696.531,36 × 19,5 / 31
});

test('reembolsables se facturan con 10% de fee', () => {
  const cert = certificar({ periodo: periodoDeCierre('2026-11'), factores: {}, reembolsables: { '1d': 1_000_000 } });
  assert.equal(cert.items.find((i) => i.codigo === '1d').importe, 1_100_000);
});

test('calendario: factura a los 5 días hábiles de la proforma, pago a 30 días', () => {
  assert.deepEqual(calendarioCobro('2026-11-20'), {
    envioProforma: '2026-11-20', // viernes
    finRevision: '2026-11-27',
    factura: '2026-11-27',
    vencimientoPago: '2026-12-27',
  });
});

test('los feriados corren el plazo, y la factura se puede fijar a mano', () => {
  assert.equal(calendarioCobro('2026-11-20', { feriados: ['2026-11-23'] }).factura, '2026-11-30');
  const cal = calendarioCobro('2026-11-20', { factura: '2026-12-01' });
  assert.equal(cal.finRevision, '2026-11-27');
  assert.equal(cal.vencimientoPago, '2026-12-31');
});
