import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semestresContrato, performance, cumplimiento, fraccionSemestre, bonoSemestre } from '../src/lib/desempeno.js';

// Números inventados (repo público).
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
const PESOS = { performance: 0.6, presentismo: 0.3, hse: 0.1 };

test('semestres calendario recortados al contrato', () => {
  const s = semestresContrato(12, '2026-10-26');
  assert.deepEqual(s.map((x) => [x.clave, x.desde, x.hasta]), [
    ['2026-S2', '2026-10-26', '2026-12-31'],
    ['2027-S1', '2027-01-01', '2027-06-30'],
    ['2027-S2', '2027-07-01', '2027-10-25'],
  ]);
});

test('performance: promedio de las reviews 360°', () => {
  assert.equal(performance([]), null);
  assert.equal(performance([{ puntaje: 80 }, { puntaje: 90 }, { puntaje: 100 }]), 90);
});

test('cumplimiento ponderado', () => {
  const c = cumplimiento({ presentismo: 100, hse: 50 }, [{ puntaje: 80 }], PESOS);
  cerca(c.total, (0.6 * 80 + 0.3 * 100 + 0.1 * 50) / 100, 'total');
  assert.equal(c.completo, true);
  assert.equal(cumplimiento({ presentismo: 100, hse: null }, [{ puntaje: 80 }], PESOS).completo, false);
});

test('bono: mitad del anual, proporcional a los días trabajados y al cumplimiento', () => {
  const [s2] = semestresContrato(12, '2026-10-26');
  const persona = { bonoAnualUsd: 2_200, inicio: '2026-10-26', fin: null };
  cerca(fraccionSemestre(s2, persona), 67 / 184, '26/10–31/12 sobre el semestre completo');
  const b = bonoSemestre(persona, s2, 0.5);
  cerca(b.maximo, 1_100 * 67 / 184, 'máximo');
  cerca(b.aPagar, 550 * 67 / 184, 'a pagar');
  assert.equal(fraccionSemestre(s2, { inicio: null }), 0, 'sin fecha de ingreso');
});
