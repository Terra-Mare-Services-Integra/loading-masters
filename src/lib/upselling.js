// Up selling: trabajos que se cobran aparte dentro del contrato, una línea con ingreso y costo (sin IVA).
// Junto a ellos van los reembolsables: se facturan con el fee del ítem 1d y su costo sale de Operación.

const enArs = (u, x) => Number(x || 0) * (u.moneda === 'USD' ? Number(u.tipo_cambio) : 1);
export const ingresoArs = (u) => enArs(u, u.ingreso);
export const costoArs = (u) => enArs(u, u.costo);

// Totales por mes de imputación, en pesos.
export function upsellingPorMes(lineas) {
  const porMes = {};
  for (const u of lineas) {
    const m = (porMes[u.mes] ??= { ingreso: 0, costo: 0, cantidad: 0 });
    m.ingreso += ingresoArs(u);
    m.costo += costoArs(u);
    m.cantidad += 1;
  }
  return porMes;
}
