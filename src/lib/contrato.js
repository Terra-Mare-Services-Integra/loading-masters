// Datos del contrato VMOS — Oferta 1/2026 "Servicio de Capitán Operativo" (CO&C),
// Terminal offshore Punta Colorada. Fuente: Carta Oferta firmada, Anexo II (Precio)
// y tabla de IMPORTES. Precios en ARS, sin IVA, base octubre 2026.

export const CONTRATO_VMOS = {
  cliente: 'VMOS S.A.',
  oferta: '1/2026',
  moneda: 'ARS',
  inicioComputo: '2026-10',

  // Período de certificación: del día 21 de un mes al 20 del siguiente.
  periodo: { diaInicio: 21, diaCierre: 20 },

  items: [
    { codigo: '1', descripcion: 'Servicio mensual CO&C (incluye seguro de RC General con límite USD 2.000.000)', tipo: 'mensual', precioMensual: 142_696_531.36 },
    { codigo: '1a', descripcion: 'Adicional - Aumento límite de USD 2.000.000 a USD 5.000.000', tipo: 'mensual', precioMensual: 1_016_319.05 },
    { codigo: '1b', descripcion: 'Adicional - Inclusión Seguro de E&O', tipo: 'mensual', precioMensual: 4_446_395.84 },
    { codigo: '1c', descripcion: 'Adicional - Modificaciones en Seguro de RC "Fronting Local"', tipo: 'mensual', precioMensual: 2_522_735.92 },
    // 1d: elementos reembolsables, se facturan al costo + 10%.
    { codigo: '1d', descripcion: 'Fee Reembolsable', tipo: 'reembolsable', fee: 1.10 },
  ],

  // Anexo II — fórmula polinómica:
  // P1 = P0 × {CF + CV × [70% MO1/MO0 + 20% IPC1/IPC0 + 10% USD1/USD0]}, CF = 0.
  ajuste: {
    costoFijo: 0,
    ponderaciones: { mo: 0.70, ipc: 0.20, usd: 0.10 },
    base: {
      mo: 6_381_693.35, // Básico Capitán de Ultramar, septiembre 2026 (FENA)
      ipc: 12_276.8, // IPC Nivel General INDEC, agosto 2026 (n-2)
      usd: 1_524.5, // BNA vendedor divisa, octubre 2026
    },
    // De qué fecha es cada valor base, tal como lo escribe el Anexo II.
    fechasBase: {
      mo: 'Básico Capitán de Ultramar de septiembre 2026 (MO0 del contrato, FENA)',
      ipc: 'IPC Nivel General Nacional de agosto 2026, INDEC (IPC0 del contrato: n-2 de octubre)',
      usd: 'Dólar BNA divisa vendedor del 01/10/2026 (USD0 del contrato)',
    },
    // Paso anterior, de referencia (Excel "Formula de ajuste"): los precios de la oferta (base oct-26)
    // salen de ajustar los de marzo 2026 con la misma fórmula.
    historia: {
      mes: '2026-03',
      indices: { mo: 0, ipc: 0, usd: 0 }, // valores en la base de datos
      precios: { 1: 0, '1a': 0, '1b': 0, '1c': 0 }, // valores en la base de datos
    },
    disparadores: { ipcAcumulado: 0.15, usdAcumulado: 0.15, meses: 6 },
    // La revisión se pide entre el día 1 y el 10; rige desde el 1 del mes siguiente.
    ventanaPedido: { desde: 1, hasta: 10 },
  },

  plazos: {
    diasHabilesRevisionProforma: 5,
    diasPagoFactura: 30,
  },
};
