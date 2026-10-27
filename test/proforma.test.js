import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarProforma, expandirTramos, comprimirTramos } from '../src/proforma/armar.js';
import { periodoDeCierre } from '../src/lib/certificacion.js';
import { renderProforma } from '../src/proforma/plantilla.js';

const NOVIEMBRE = {
  nombre: 'Facturar noviembre',
  desde: '2026-10-26',
  hasta: '2026-11-30',
  fechaProforma: '2026-11-20',
  numero: 'PF-2026-11',
  tramos: { 1: [{ desde: '2026-10-26', hasta: '2026-11-30', factor: 0.75 }] },
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

test('proforma de noviembre: neto, IVA, total y fechas', () => {
  const p = armarProforma(NOVIEMBRE);
  assert.equal(p.subtotal, 127_736_411.14);
  assert.equal(p.ivaImporte, 26_824_646.34);
  assert.equal(p.total, 154_561_057.48);
  assert.equal(p.fechaEmision, '2026-11-20');
  assert.equal(p.calendario.factura, '2026-11-27');
  assert.equal(p.calendario.vencimientoPago, '2026-12-27');
});

test('compatibilidad: carga por mes de cierre (21 al 20)', () => {
  const p = armarProforma({ cierre: '2026-11', numero: 'X', tramos: NOVIEMBRE.tramos });
  assert.deepEqual(p.certificacion.periodo, { desde: '2026-10-21', hasta: '2026-11-20' });
  assert.equal(p.fechaEmision, '2026-11-20');
});

test('el HTML trae nombre, período, importes y una fila por día', () => {
  const html = renderProforma(armarProforma(NOVIEMBRE));
  assert.match(html, /Facturar noviembre\./);
  assert.match(html, /26\/10\/2026 – 30\/11\/2026/);
  assert.match(html, /\$ 127\.736\.411,14/);
  assert.equal(html.match(/<td class="f">/g).length, 36);
});
