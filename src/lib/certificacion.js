import { CONTRATO_VMOS } from './contrato.js';
import { parse, rangoDias, sumarDias, sumarDiasHabiles } from './fechas.js';

const redondear = (x) => Math.round(x * 100) / 100;

// Período que cierra en el mes `mesCierre` ('YYYY-MM'): del 21 del mes anterior al 20.
// Ej.: '2026-11' → 2026-10-21 a 2026-11-20. Se usa como período sugerido.
export function periodoDeCierre(mesCierre, contrato = CONTRATO_VMOS) {
  const { diaInicio, diaCierre } = contrato.periodo;
  const [y, m] = mesCierre.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const pad = (n) => String(n).padStart(2, '0');
  return {
    desde: `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(diaInicio)}`,
    hasta: `${y}-${pad(m)}-${pad(diaCierre)}`,
  };
}

export function diasDelMes(fecha) {
  const d = parse(fecha);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

// Costo diario de un ítem mensual en una fecha: precio mensual / días de ese mes calendario
// (o / `divisor` si se fija uno). Así un mes calendario completo vale exactamente el precio mensual.
export function costoDiario(precioMensual, fecha, divisor) {
  return precioMensual / (divisor ?? diasDelMes(fecha));
}

/**
 * Calcula la certificación de un período cualquiera (puede abarcar más de un mes).
 *
 * @param {object} p
 * @param {{desde: string, hasta: string}} p.periodo
 * @param {Record<string, Record<string, number>>} p.factores
 *   Por código de ítem, factor diario por fecha (1 = servicio completo, 0.75 = 3 capitanes...).
 *   Fechas ausentes cuentan como 0.
 * @param {Record<string, number>} [p.reembolsables] Gastos a reembolsar por código de ítem (sin fee).
 * @param {Record<string, number>} [p.precios] Precios mensuales vigentes (tras ajustes) por código.
 * @param {number} [p.divisor] Divisor fijo de días (p. ej. 31 como el Excel original). Por defecto,
 *   los días del mes calendario de cada fecha.
 */
export function certificar({ periodo, factores, reembolsables = {}, precios = {}, divisor }, contrato = CONTRATO_VMOS) {
  const dias = rangoDias(periodo.desde, periodo.hasta);

  const items = contrato.items.map((item) => {
    if (item.tipo === 'reembolsable') {
      const gasto = reembolsables[item.codigo] ?? 0;
      return { ...item, gasto, importe: redondear(gasto * item.fee) };
    }
    const precioMensual = precios[item.codigo] ?? item.precioMensual;
    const porDia = dias.map((fecha) => ({ fecha, factor: factores[item.codigo]?.[fecha] ?? 0 }));
    const diasEquivalentes = porDia.reduce((s, d) => s + d.factor, 0);
    // Meses equivalentes: suma de factor / días del mes de cada fecha.
    const mesesEquivalentes = porDia.reduce((s, d) => s + d.factor / (divisor ?? diasDelMes(d.fecha)), 0);
    return {
      ...item,
      precioMensual,
      porDia,
      diasEquivalentes,
      mesesEquivalentes,
      importe: redondear(precioMensual * mesesEquivalentes),
    };
  });

  return {
    periodo,
    dias,
    divisor: divisor ?? null,
    items,
    total: redondear(items.reduce((s, i) => s + i.importe, 0)),
  };
}

// Calendario del circuito: se envía la proforma, VMOS tiene N días hábiles para observarla,
// al cumplirse ese plazo se emite la factura y el pago vence a los 30 días corridos.
// `factura` permite fijar otra fecha de factura a mano.
export function calendarioCobro(fechaProforma, { feriados = [], factura } = {}, contrato = CONTRATO_VMOS) {
  const { diasHabilesRevisionProforma, diasPagoFactura } = contrato.plazos;
  const finRevision = sumarDiasHabiles(fechaProforma, diasHabilesRevisionProforma, feriados);
  const fechaFactura = factura ?? finRevision;
  return {
    envioProforma: fechaProforma,
    finRevision,
    factura: fechaFactura,
    vencimientoPago: sumarDias(fechaFactura, diasPagoFactura),
  };
}
