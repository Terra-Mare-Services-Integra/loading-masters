import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarProforma, expandirTramos, comprimirTramos } from '../src/proforma/armar.js';
import { periodoDeCierre } from '../src/lib/certificacion.js';
import { renderProforma } from '../src/proforma/plantilla.js';

const NOVIEMBRE = {
  cierre: '2026-11',
  numero: 'PF-2026-11',
  tramos: { 1: [{ desde: '2026-10-26', hasta: '2026-11-20', factor: 0.75 }] },
};

test('los tramos se expanden día por día', () => {
  const f = expandirTramos([{ desde: '2026-10-30', hasta: '2026-11-01', factor: 0.5 }]);
  assert.deepEqual(f, { '2026-10-30': 0.5, '2026-10-31': 0.5, '2026-11-01': 0.5 });
});

test('comprimir tramos es el inverso de expandir', () => {
  const tramos = [
    { desde: '2026-10-26', hasta: '2026-11-05', factor: 0.75 },
    { desde: '2026-11-06', hasta: '2026-11-06', factor: 0.5 },
    { desde: '2026-11-10', hasta: '2026-11-20', factor: 1 },
  ];
  assert.deepEqual(comprimirTramos(expandirTramos(tramos), periodoDeCierre('2026-11')), tramos);
});

test('proforma de noviembre: neto, IVA y total', () => {
  const p = armarProforma(NOVIEMBRE);
  assert.equal(p.subtotal, 89_760_721.34);
  assert.equal(p.ivaImporte, 18_849_751.48);
  assert.equal(p.total, 108_610_472.82);
  assert.equal(p.fechaEmision, '2026-11-20');
  assert.equal(p.calendario.vencimientoPago, '2026-12-30');
});

test('el HTML trae el período, los importes y una fila por día', () => {
  const html = renderProforma(armarProforma(NOVIEMBRE));
  assert.match(html, /21\/10\/2026 – 20\/11\/2026/);
  assert.match(html, /\$ 89\.760\.721,34/);
  assert.equal(html.match(/<td class="f">/g).length, 31);
});
