import { CONTRATO_VMOS } from './contrato.js';
import { rangoDias, sumarDias, sumarDiasHabiles } from './fechas.js';

const redondear = (x) => Math.round(x * 100) / 100;

// Período que cierra en el mes `mesCierre` ('YYYY-MM'): del 21 del mes anterior al 20.
// Ej.: '2026-11' → 2026-10-21 a 2026-11-20.
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

// Costo diario de un ítem mensual: precio mensual / días del período.
export function costoDiario(precioMensual, diasPeriodo) {
  return precioMensual / diasPeriodo;
}

/**
 * Calcula la certificación de un período.
 *
 * @param {object} p
 * @param {{desde: string, hasta: string}} p.periodo
 * @param {Record<string, Record<string, number>>} p.factores
 *   Por código de ítem, factor diario por fecha (1 = servicio completo, 0.75 = 3 capitanes...).
 *   Fechas ausentes cuentan como 0.
 * @param {Record<string, number>} [p.reembolsables] Gastos a reembolsar por código de ítem (sin fee).
 * @param {Record<string, number>} [p.precios] Precios mensuales vigentes (tras ajustes) por código.
 * @param {number} [p.divisor] Días contra los que se prorratea el precio mensual.
 *   Por defecto, los días del período (31 para 21/10–20/11).
 */
export function certificar({ periodo, factores, reembolsables = {}, precios = {}, divisor }, contrato = CONTRATO_VMOS) {
  const dias = rangoDias(periodo.desde, periodo.hasta);
  const div = divisor ?? dias.length;

  const items = contrato.items.map((item) => {
    if (item.tipo === 'reembolsable') {
      const gasto = reembolsables[item.codigo] ?? 0;
      return { ...item, gasto, importe: redondear(gasto * item.fee) };
    }
    const precioMensual = precios[item.codigo] ?? item.precioMensual;
    const porDia = dias.map((fecha) => ({ fecha, factor: factores[item.codigo]?.[fecha] ?? 0 }));
    const diasEquivalentes = porDia.reduce((s, d) => s + d.factor, 0);
    return {
      ...item,
      precioMensual,
      costoDiario: costoDiario(precioMensual, div),
      porDia,
      diasEquivalentes,
      fraccionMes: diasEquivalentes / div,
      importe: redondear((precioMensual * diasEquivalentes) / div),
    };
  });

  return {
    periodo,
    dias,
    divisor: div,
    items,
    total: redondear(items.reduce((s, i) => s + i.importe, 0)),
  };
}

// Calendario del circuito: proforma al cierre, VMOS tiene N días hábiles para observarla,
// después se factura y el pago vence a los 30 días corridos.
export function calendarioCobro(periodo, { feriados = [] } = {}, contrato = CONTRATO_VMOS) {
  const { diasHabilesRevisionProforma, diasPagoFactura } = contrato.plazos;
  const envioProforma = periodo.hasta;
  const finRevision = sumarDiasHabiles(envioProforma, diasHabilesRevisionProforma, feriados);
  const factura = sumarDiasHabiles(finRevision, 1, feriados);
  return {
    envioProforma,
    finRevision,
    factura,
    vencimientoPago: sumarDias(factura, diasPagoFactura),
  };
}
