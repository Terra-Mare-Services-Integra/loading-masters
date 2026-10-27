// Vehículo: la camioneta se amortiza en cuotas mensuales iguales desde el mes de compra (por defecto
// hasta el fin del contrato) y sus gastos (póliza, services, patente...) se cargan por mes como en
// Administración. Los montos viven en la base (referencias.vehiculo): acá solo están las fórmulas.

export const RUBROS_VEHICULO = [
  { id: 'poliza', nombre: 'Póliza del vehículo' },
  { id: 'service', nombre: 'Services y mantenimiento' },
  { id: 'reparaciones', nombre: 'Reparaciones y neumáticos' },
  { id: 'patente', nombre: 'Patente y VTV' },
  { id: 'combustible', nombre: 'Combustible' },
  { id: 'peajes', nombre: 'Peajes y estacionamiento' },
  { id: 'miscelaneos', nombre: 'Misceláneos' },
];

const mesesEntre = (desde, hasta) => {
  const [y1, m1] = desde.split('-').map(Number);
  const [y2, m2] = hasta.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
};

// Meses de amortización: los cargados o, si no hay, desde el mes de compra hasta el fin del contrato.
export const mesesAmortizacion = (v, finContrato) => (Number(v?.meses) > 0
  ? Number(v.meses)
  : v?.fechaCompra ? Math.max(mesesEntre(v.fechaCompra.slice(0, 7), finContrato.slice(0, 7)), 1) : 0);

export const cuotaAmortizacionUsd = (v, finContrato) => {
  const meses = mesesAmortizacion(v, finContrato);
  return meses ? Math.max(Number(v.precioUsd || 0) - Number(v.residualUsd || 0), 0) / meses : 0;
};

// Amortización en USD de un mes calendario (0 antes de la compra y después de la última cuota).
export function amortizacionMesUsd(v, finContrato, mes) {
  if (!v?.fechaCompra) return 0;
  const n = mesesEntre(v.fechaCompra.slice(0, 7), mes);
  return n >= 1 && n <= mesesAmortizacion(v, finContrato) ? cuotaAmortizacionUsd(v, finContrato) : 0;
}
