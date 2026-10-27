import { CONTRATO_VMOS } from '../lib/contrato.js';
import { certificar, calendarioCobro, periodoDeCierre } from '../lib/certificacion.js';
import { rangoDias, sumarDias } from '../lib/fechas.js';

export const EMISOR = {
  razonSocial: 'Terra Mare Services S.A.',
  cuit: '30-71861758-4',
  domicilio: 'Alvear 653, B1646 San Fernando, Provincia de Buenos Aires',
};

export const CLIENTE_VMOS = {
  razonSocial: 'VMOS S.A.',
  domicilio: 'Juana Manso 1069, Piso 6°, C1107CBU Ciudad Autónoma de Buenos Aires',
};

// Los factores de la certificación se cargan por tramos: [{ desde, hasta, factor }].
export function expandirTramos(tramos = []) {
  const porFecha = {};
  for (const { desde, hasta, factor } of tramos) {
    for (const f of rangoDias(desde, hasta)) porFecha[f] = factor;
  }
  return porFecha;
}

// Inverso de expandirTramos: agrupa días consecutivos con el mismo factor (los ceros no se guardan).
export function comprimirTramos(porFecha, periodo) {
  const tramos = [];
  for (const f of rangoDias(periodo.desde, periodo.hasta)) {
    const factor = porFecha[f] ?? 0;
    const ultimo = tramos.at(-1);
    if (factor && ultimo && ultimo.factor === factor && ultimo.hasta === sumarDias(f, -1)) ultimo.hasta = f;
    else if (factor) tramos.push({ desde: f, hasta: f, factor });
  }
  return tramos;
}

/**
 * Arma los datos de una proforma a partir de la carga de certificación de un mes.
 *
 * @param {object} carga
 * @param {string} carga.cierre Mes de cierre 'YYYY-MM' (período del 21 anterior al 20).
 * @param {string} carga.numero Número de proforma.
 * @param {string} carga.fechaEmision
 * @param {Record<string, {desde: string, hasta: string, factor: number}[]>} [carga.tramos]
 * @param {Record<string, Record<string, number>>} [carga.factores] Alternativa a tramos: factor por fecha.
 * @param {Record<string, number>} [carga.reembolsables]
 * @param {string[]} [carga.feriados]
 * @param {number} [carga.iva] Alícuota de IVA (0,21 por defecto).
 */
export function armarProforma(carga, contrato = CONTRATO_VMOS) {
  const periodo = periodoDeCierre(carga.cierre, contrato);
  const factores = carga.factores ?? Object.fromEntries(Object.entries(carga.tramos ?? {}).map(([c, t]) => [c, expandirTramos(t)]));
  const cert = certificar({ periodo, factores, reembolsables: carga.reembolsables, precios: carga.precios }, contrato);
  const iva = carga.iva ?? 0.21;
  const ivaImporte = Math.round(cert.total * iva * 100) / 100;

  return {
    numero: carga.numero,
    fechaEmision: carga.fechaEmision ?? periodo.hasta,
    emisor: EMISOR,
    cliente: CLIENTE_VMOS,
    referencia: `Oferta ${contrato.oferta} — Servicio de Capitán Operativo y Carga (CO&C), Terminal offshore Punta Colorada`,
    moneda: contrato.moneda,
    certificacion: cert,
    subtotal: cert.total,
    iva,
    ivaImporte,
    total: Math.round((cert.total + ivaImporte) * 100) / 100,
    calendario: calendarioCobro(periodo, { feriados: carga.feriados ?? [] }, contrato),
    plazos: contrato.plazos,
    observaciones: carga.observaciones ?? [],
  };
}
