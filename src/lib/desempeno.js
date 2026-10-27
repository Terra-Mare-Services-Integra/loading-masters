// Evaluación de desempeño semestral y bono de los capitanes. La oferta firmada fija un bono anual
// máximo en USD, sujeto a objetivos de seguridad, salud y ambiente (HSE), asistencia (presentismo) y
// desempeño interno y del cliente (performance, con reviews 360°), proporcional al tiempo trabajado.
// Las ponderaciones y los montos llegan desde la base.

import { CONTRATO_VMOS } from './contrato.js';
import { rangoDias, sumarDias } from './fechas.js';

const iso = (d) => d.toISOString().slice(0, 10);

// Semestres calendario del contrato (el primero y el último, recortados a las fechas del contrato).
export function semestresContrato(meses, inicio = CONTRATO_VMOS.inicioServicio) {
  const [y, m, d] = inicio.split('-').map(Number);
  const fin = sumarDias(iso(new Date(Date.UTC(y, m - 1 + meses, d))), -1);
  const semestres = [];
  for (let anio = y; anio <= Number(fin.slice(0, 4)); anio++) {
    for (const s of [1, 2]) {
      const completo = s === 1 ? { desde: `${anio}-01-01`, hasta: `${anio}-06-30` } : { desde: `${anio}-07-01`, hasta: `${anio}-12-31` };
      if (completo.hasta < inicio || completo.desde > fin) continue;
      semestres.push({
        clave: `${anio}-S${s}`,
        nombre: `${s === 1 ? '1er' : '2do'} semestre ${anio}`,
        desde: completo.desde < inicio ? inicio : completo.desde,
        hasta: completo.hasta > fin ? fin : completo.hasta,
        completo,
      });
    }
  }
  return semestres;
}

// Performance = promedio de las reviews 360° (0 a 100); null si todavía no hay reviews.
export function performance(reviews) {
  if (!reviews?.length) return null;
  return reviews.reduce((s, r) => s + Number(r.puntaje), 0) / reviews.length;
}

/**
 * Cumplimiento ponderado de un semestre (0 a 1). Completo solo si están los tres componentes.
 * @param {{presentismo: number|null, hse: number|null}} evaluacion
 * @param {object[]} reviews
 * @param {{performance: number, presentismo: number, hse: number}} pesos
 */
export function cumplimiento(evaluacion, reviews, pesos) {
  const partes = {
    performance: performance(reviews),
    presentismo: evaluacion?.presentismo ?? null,
    hse: evaluacion?.hse ?? null,
  };
  const completo = Object.values(partes).every((v) => v !== null && v !== undefined);
  const total = Object.entries(pesos).reduce((s, [k, w]) => s + w * (Number(partes[k]) || 0), 0) / 100;
  return { ...partes, total, completo };
}

// Fracción del semestre calendario en la que la persona estuvo activa (para prorratear el bono).
export function fraccionSemestre(semestre, persona) {
  if (!persona.inicio) return 0;
  const a = persona.inicio > semestre.desde ? persona.inicio : semestre.desde;
  const b = persona.fin && persona.fin < semestre.hasta ? persona.fin : semestre.hasta;
  if (a > b) return 0;
  return rangoDias(a, b).length / rangoDias(semestre.completo.desde, semestre.completo.hasta).length;
}

// Bono del semestre en USD: la mitad del anual, proporcional al tiempo trabajado y al cumplimiento.
export function bonoSemestre(persona, semestre, cumplimientoTotal) {
  const maximo = (persona.bonoAnualUsd / 2) * fraccionSemestre(semestre, persona);
  return { maximo, aPagar: maximo * cumplimientoTotal };
}
