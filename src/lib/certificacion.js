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

// Tramos del cálculo de un ítem mensual: los días seguidos con el mismo mes, tarifa y factor se agrupan.
// Valor día = tarifa mensual / días del mes (o divisor fijo); importe = valor día × factor × días.
export function tramosCalculo(item, divisor) {
  const tramos = [];
  for (const d of (item.porDia ?? []).filter((x) => x.factor > 0)) {
    const mes = d.fecha.slice(0, 7);
    const ultimo = tramos.at(-1);
    if (ultimo && ultimo.mes === mes && ultimo.precio === d.precio && ultimo.factor === d.factor && sumarDias(ultimo.hasta, 1) === d.fecha) {
      ultimo.hasta = d.fecha;
      ultimo.dias += 1;
    } else {
      tramos.push({ mes, desde: d.fecha, hasta: d.fecha, precio: d.precio, factor: d.factor, dias: 1, divisor: divisor ?? diasDelMes(d.fecha) });
    }
  }
  return tramos.map((t) => ({ ...t, valorDia: t.precio / t.divisor, importe: (t.precio / t.divisor) * t.factor * t.dias }));
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
 * @param {Record<string, number> | ((fecha: string) => Record<string, number>)} [p.precios]
 *   Precios mensuales por código, fijos o según la fecha (ajustes que rigen desde un día).
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
    const precioEn = (fecha) => (typeof precios === 'function' ? precios(fecha) : precios)[item.codigo] ?? item.precioMensual;
    const porDia = dias.map((fecha) => ({ fecha, factor: factores[item.codigo]?.[fecha] ?? 0, precio: precioEn(fecha) }));
    const diasEquivalentes = porDia.reduce((s, d) => s + d.factor, 0);
    // Meses equivalentes: suma de factor / días del mes de cada fecha.
    const fraccion = (d) => d.factor / (divisor ?? diasDelMes(d.fecha));
    const mesesEquivalentes = porDia.reduce((s, d) => s + fraccion(d), 0);
    // Cada día se valoriza al precio vigente ese día (puede cambiar si rige un ajuste en el período).
    const importe = porDia.reduce((s, d) => s + d.precio * fraccion(d), 0);
    const preciosDistintos = [...new Set(porDia.map((d) => d.precio))];
    return {
      ...item,
      precioMensual: precioEn(periodo.hasta),
      preciosDistintos,
      porDia,
      diasEquivalentes,
      mesesEquivalentes,
      importe: redondear(importe),
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
