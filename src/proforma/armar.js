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
 * Arma los datos de una proforma a partir de la carga de una facturación.
 *
 * @param {object} carga
 * @param {string} [carga.nombre] Nombre de la facturación ("Facturar noviembre").
 * @param {string} [carga.desde] Inicio del período certificado.
 * @param {string} [carga.hasta] Fin del período certificado.
 * @param {string} [carga.cierre] Alternativa a desde/hasta: mes 'YYYY-MM' (21 del anterior al 20).
 * @param {string} carga.numero Número de proforma.
 * @param {string} [carga.fechaProforma] Envío de la proforma (por defecto, `hasta`).
 * @param {string} [carga.fechaFactura] Fecha de factura fijada a mano (por defecto, proforma + 5 días hábiles).
 * @param {Record<string, {desde: string, hasta: string, factor: number}[]>} [carga.tramos]
 * @param {Record<string, Record<string, number>>} [carga.factores] Alternativa a tramos: factor por fecha.
 * @param {Record<string, number>} [carga.reembolsables]
 * @param {string[]} [carga.feriados]
 * @param {number} [carga.iva] Alícuota de IVA (0,21 por defecto).
 */
export function armarProforma(carga, contrato = CONTRATO_VMOS) {
  const periodo = carga.desde ? { desde: carga.desde, hasta: carga.hasta } : periodoDeCierre(carga.cierre, contrato);
  const factores = carga.factores ?? Object.fromEntries(Object.entries(carga.tramos ?? {}).map(([c, t]) => [c, expandirTramos(t)]));
  const cert = certificar({ periodo, factores, reembolsables: carga.reembolsables, precios: carga.precios }, contrato);
  const iva = carga.iva ?? 0.21;
  const ivaImporte = Math.round(cert.total * iva * 100) / 100;
  const fechaProforma = carga.fechaProforma ?? carga.fechaEmision ?? periodo.hasta;

  return {
    nombre: carga.nombre ?? null,
    numero: carga.numero,
    fechaEmision: fechaProforma,
    emisor: EMISOR,
    cliente: CLIENTE_VMOS,
    referencia: `Oferta ${contrato.oferta} — Servicio de Capitán Operativo y Carga (CO&C), Terminal offshore Punta Colorada`,
    moneda: contrato.moneda,
    certificacion: cert,
    subtotal: cert.total,
    iva,
    ivaImporte,
    total: Math.round((cert.total + ivaImporte) * 100) / 100,
    calendario: calendarioCobro(fechaProforma, { feriados: carga.feriados ?? [], factura: carga.fechaFactura || undefined }, contrato),
    plazos: contrato.plazos,
    observaciones: carga.observaciones ?? [],
  };
}
