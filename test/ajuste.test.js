import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factorAjuste, preciosAjustados, disparadores, vigenciaPedido } from '../src/lib/ajuste.js';
import { CONTRATO_VMOS } from '../src/lib/contrato.js';

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
