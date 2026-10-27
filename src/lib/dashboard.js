// Cálculos de los dashboards a partir de las filas del P&L y las facturaciones. Sin valores: solo fórmulas.

import { CONTRATO_VMOS } from './contrato.js';
import { calendarioCobro } from './certificacion.js';
import { sumarDias } from './fechas.js';

export const IVA = 0.21;
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

// Tramos de antigüedad de lo vencido (días desde el vencimiento).
export const TRAMOS_VENCIDO = [
  { id: 't1', nombre: '1 a 30 días', hasta: 30 },
  { id: 't2', nombre: '31 a 60 días', hasta: 60 },
  { id: 't3', nombre: 'más de 60 días', hasta: Infinity },
];

/**
 * Facturas emitidas a VMOS con su vencimiento y estado: cobrada, vencida o a vencer. Importes con IVA,
 * que es lo que se cobra. También los totales y la antigüedad de lo vencido.
 */
export function cobranza(filas, hoy, contrato = CONTRATO_VMOS) {
  const facturas = filas.filter((f) => f.facturaEmitidaEl).map((f) => {
    const vence = sumarDias(f.facturaEmitidaEl, contrato.plazos.diasPagoFactura);
    const conIva = f.ingreso * (1 + IVA);
    const estado = f.cobradaEl ? 'cobrada' : vence < hoy ? 'vencida' : 'a_vencer';
    return {
      mes: f.mes, nombre: f.nombre, numero: f.facturaNumero ?? null, emitida: f.facturaEmitidaEl, vence, cobrada: f.cobradaEl ?? null,
      conIva, estado,
      atraso: estado === 'vencida' ? dias(vence, hoy) : 0,
      diasCobro: f.cobradaEl ? dias(f.facturaEmitidaEl, f.cobradaEl) : null,
    };
  });
  const suma = (xs) => xs.reduce((s, x) => s + x.conIva, 0);
  const cobradas = facturas.filter((x) => x.estado === 'cobrada');
  const vencidas = facturas.filter((x) => x.estado === 'vencida');
  const tramos = TRAMOS_VENCIDO.map((t, i) => {
    const desde = i ? TRAMOS_VENCIDO[i - 1].hasta : 0;
    const xs = vencidas.filter((x) => x.atraso > desde && x.atraso <= t.hasta);
    return { ...t, monto: suma(xs), cantidad: xs.length };
  });
  return {
    facturas,
    facturado: suma(facturas),
    cobrado: suma(cobradas),
    pendiente: suma(facturas.filter((x) => x.estado !== 'cobrada')),
    vencido: suma(vencidas),
    aVencer: suma(facturas.filter((x) => x.estado === 'a_vencer')),
    tramos,
    diasPromedioCobro: cobradas.length ? cobradas.reduce((s, x) => s + x.diasCobro, 0) / cobradas.length : null,
  };
}

/**
 * Cobros esperados de los meses todavía no facturados: proforma el día 20 (o la cargada), factura a los
 * 5 días hábiles y cobro a los 30 días. Importes con IVA.
 */
export function cobrosEsperados(filas, contrato = CONTRATO_VMOS) {
  return filas.filter((f) => !f.facturaEmitidaEl).map((f) => {
    const cal = calendarioCobro(f.fechaProforma ?? `${f.mes}-20`, {}, contrato);
    return { mes: f.mes, nombre: f.nombre, factura: cal.factura, cobro: cal.vencimientoPago, conIva: f.ingreso * (1 + IVA) };
  });
}

// Categorías de costo del P&L, en el orden fijo de los colores.
export const CATEGORIAS_COSTO = [
  ['capitanes', 'Capitanes'],
  ['operacionTotal', 'Operación (incl. Sergio)'],
  ['polizas', 'Seguros'],
  ['estructura', 'Administración'],
  ['vehiculo', 'Vehículo'],
  ['impuestos', 'Imprev. e impuestos'],
];

// Suma de un campo por año (cada período va al año de su mes).
export function porAnio(filas, campos) {
  const out = {};
  for (const f of filas) {
    const a = (out[f.mes.slice(0, 4)] ??= Object.fromEntries(campos.map((c) => [c, 0])));
    for (const c of campos) a[c] += f[c] ?? 0;
  }
  return out;
}

// Serie acumulada de un campo, mes a mes.
export function acumulado(filas, campo) {
  let s = 0;
  return filas.map((f) => ({ mes: f.mes, valor: (s += f[campo] ?? 0) }));
}

// Margen (resultado bruto / ingresos); null si no hay ingresos.
export const margen = (bruto, ingreso) => (ingreso ? bruto / ingreso : null);
