// Resultado proyectado del contrato, con las fórmulas de los Excel del usuario
// ("Arranque contrato" al 75 % y "Resultado esperado" al 100 %, hoja Generacion). Todo en USD/mes.

const sumar = (xs) => xs.reduce((s, x) => s + x, 0);

// Los supuestos de cada escenario (arranque 75 % / esperado 100 %) viven solo en la base de datos
// (tabla escenarios): este repositorio es público y no debe contener ningún valor de esos Excel.
export const CLAVES_ESCENARIOS = ['arranque', 'esperado'];

// Forma de un escenario, en cero. Sirve de plantilla para los campos que falten en la base.
export const ESCENARIO_VACIO = {
  nombre: '',
  factorPrecio: 1,
  ingresoCocUsd: 0,
  ingresoSegurosUsd: 0,
  capitanesSr: { cantidad: 0, costoUsd: 0 },
  capitanesJr: { cantidad: 0, costoUsd: 0 },
  operacionUsd: 0,
  costoSegurosUsd: 0,
  estructuraTmUsd: 0,
  estructuraBaseSgUsd: 0,
  sgFijoUsd: 0,
  pctImprevistos: 0,
  pctCredito: 0,
  pctIibb: 0,
  pctParticipacionSg: 0,
  mesesContrato: 0,
  fx: 0,
};

export const completarEscenario = (s) => ({
  ...ESCENARIO_VACIO,
  ...s,
  capitanesSr: { ...ESCENARIO_VACIO.capitanesSr, ...s?.capitanesSr },
  capitanesJr: { ...ESCENARIO_VACIO.capitanesJr, ...s?.capitanesJr },
});

/**
 * Calcula el resultado mensual de un escenario. Dos columnas como en el Excel: CO&C (W) y Seguros (X).
 * Sergio: fijo y estructura base escalan con el factor de precio; participación = % × resultado bruto
 * CO&C − % × estructura base (W35 = V35*W34 − Y29*0,1).
 */
export function calcularResultado(s) {
  const f = s.factorPrecio;
  const impuestos = (ingreso) => ({
    imprevistos: ingreso * s.pctImprevistos,
    credito: ingreso * s.pctCredito,
    iibb: ingreso * s.pctIibb,
  });

  const ingresoCoc = s.ingresoCocUsd * f;
  const sueldosSr = s.capitanesSr.cantidad * s.capitanesSr.costoUsd;
  const sueldosJr = s.capitanesJr.cantidad * s.capitanesJr.costoUsd;
  const sgFijo = s.sgFijoUsd * f;
  const estructuraBaseSg = s.estructuraBaseSgUsd * f;
  const impCoc = impuestos(ingresoCoc);
  const costosCoc = {
    sueldosSr, sueldosJr, operacion: s.operacionUsd, estructuraTm: s.estructuraTmUsd, sgFijo, ...impCoc,
  };
  const brutoCoc = ingresoCoc - sumar(Object.values(costosCoc));
  const participacionSg = s.pctParticipacionSg * brutoCoc - estructuraBaseSg * s.pctParticipacionSg;
  const coc = { ingreso: ingresoCoc, ...costosCoc, bruto: brutoCoc, participacionSg, generacion: brutoCoc - participacionSg };

  const ingresoSeg = s.ingresoSegurosUsd;
  const costosSeg = { costoSeguros: s.costoSegurosUsd, ...impuestos(ingresoSeg) };
  const brutoSeg = ingresoSeg - sumar(Object.values(costosSeg));
  const seguros = { ingreso: ingresoSeg, ...costosSeg, bruto: brutoSeg, generacion: brutoSeg };

  const ingreso = ingresoCoc + ingresoSeg;
  const generacion = coc.generacion + seguros.generacion;
  return {
    coc,
    seguros,
    total: { ingreso, bruto: brutoCoc + brutoSeg, participacionSg, generacion, margen: ingreso ? generacion / ingreso : 0 },
    sergio: { fijo: sgFijo, participacion: participacionSg, mensual: sgFijo + participacionSg },
    contrato: {
      meses: s.mesesContrato,
      generacionCoc: coc.generacion * s.mesesContrato,
      generacionSeguros: seguros.generacion * s.mesesContrato,
      sergio: (sgFijo + participacionSg) * s.mesesContrato,
    },
  };
}
