// Seguros del contrato: pólizas anuales (RC y E&O) que se pagan en cuotas mensuales. En el P&L la prima
// se devenga por mes (1/12); el pago se reparte en cuotas desde el mes de inicio de cada vigencia.
// Las primas viven en la base (referencias.seguros): este archivo solo tiene las fórmulas.

import { sumarDias } from './fechas.js';

const mesMas = (mes, n) => {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

export const primaAnualUsd = (polizas = []) => polizas.reduce((s, p) => s + Number(p.primaAnualUsd || 0), 0);
export const costoMensualUsd = (polizas = []) => primaAnualUsd(polizas) / 12;

// Vigencias anuales desde el inicio hasta el fin del contrato (la última puede quedar más corta).
export function vigencias(inicio, hasta) {
  const lista = [];
  for (let n = 1, desde = inicio; desde <= hasta; n++) {
    const [y, m, d] = inicio.split('-').map(Number);
    const fin = sumarDias(new Date(Date.UTC(y + n, m - 1, d)).toISOString().slice(0, 10), -1);
    lista.push({ n, desde, hasta: fin < hasta ? fin : hasta });
    desde = sumarDias(fin, 1);
  }
  return lista;
}

/**
 * Cuotas a pagar: cada vigencia se paga en `cuotas` cuotas mensuales iguales, la primera en el mes en
 * que empieza la vigencia. Devuelve una fila por mes con el monto de cada póliza en USD.
 */
export function cronogramaCuotas(polizas, { inicio, hasta, cuotas }) {
  return vigencias(inicio, hasta).flatMap((v) => Array.from({ length: cuotas }, (_, k) => {
    const porPoliza = Object.fromEntries(polizas.map((p) => [p.id, Number(p.primaAnualUsd || 0) / cuotas]));
    return {
      mes: mesMas(v.desde.slice(0, 7), k),
      vigencia: v.n,
      cuota: k + 1,
      porPoliza,
      totalUsd: Object.values(porPoliza).reduce((s, x) => s + x, 0),
    };
  }));
}
