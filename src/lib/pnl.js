// P&L mensual del contrato: un período por mes durante todo el contrato. Cada mes usa lo real si
// existe (facturación emitida) y si no, la proyección. Todos los valores (sueldos, cargas, supuestos)
// llegan desde la base: este archivo solo tiene las fórmulas.

import { CONTRATO_VMOS } from './contrato.js';
import { certificar, diasDelMes } from './certificacion.js';
import { rangoDias, sumarDias } from './fechas.js';
import { preciosEnFecha } from './ajuste.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const iso = (d) => d.toISOString().slice(0, 10);
const finDeMes = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return iso(new Date(Date.UTC(y, m, 0)));
};
const mesSiguiente = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return iso(new Date(Date.UTC(y, m, 1))).slice(0, 7);
};
export const nombreMes = (mes) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;

/**
 * Períodos de facturación del contrato: un período por mes calendario; si el servicio arranca a mitad
 * de mes, esos días van con el mes siguiente (26/10 → 30/11). El último termina el día anterior al
 * aniversario del inicio.
 */
export function periodosContrato(meses, inicio = CONTRATO_VMOS.inicioServicio) {
  const [y, m, d] = inicio.split('-').map(Number);
  const fin = sumarDias(iso(new Date(Date.UTC(y, m - 1 + meses, d))), -1);
  const periodos = [];
  // Si el servicio no arranca un día 1, esos primeros días se suman al mes siguiente (26/10 → 30/11).
  let mes = d === 1 ? inicio.slice(0, 7) : mesSiguiente(inicio.slice(0, 7));
  for (let n = 1; n <= meses; n++, mes = mesSiguiente(mes)) {
    const desde = n === 1 ? inicio : `${mes}-01`;
    const hasta = n === meses ? fin : finDeMes(mes);
    periodos.push({ n, mes, nombre: nombreMes(mes), desde, hasta });
  }
  return periodos;
}

// Fracción de mes de un rango de días (cada día vale 1/días de su mes), opcionalmente recortado a
// [desde, hasta] de una persona.
export function mesesEquivalentes(periodo, desde = periodo.desde, hasta = periodo.hasta) {
  const a = desde > periodo.desde ? desde : periodo.desde;
  const b = hasta && hasta < periodo.hasta ? hasta : periodo.hasta;
  if (a > b) return 0;
  return rangoDias(a, b).reduce((s, d) => s + 1 / diasDelMes(d), 0);
}

/**
 * Costo mensual para la empresa de un empleado, con el armado del Excel "Arranque contrato":
 * básico + licencia anual + SAC; cargas sociales y ART sobre eso; seguro de vida y fondo; diferencia
 * entre OSDE y el aporte de obra social; y el bono anual (en USD) con sus contribuciones.
 */
export function costoEmpleado(persona, c) {
  const basico = persona.sueldoBrutoArs;
  const licencia = (basico / c.divisorVacaciones) * c.diasVacaciones / 12 - (basico / 30) * c.diasVacaciones / 12;
  const sac = (basico + licencia) * c.pctSac;
  const remuneracion = basico + licencia + sac;
  const cargas = remuneracion * (c.pctCargas + c.pctArt) + c.seguroVidaArs + c.fondoArs;
  const sindical = (basico + sac) * c.pctSindical;
  const deltaOsde = persona.osdeCostoArs - basico * c.pctAporteOs;
  const bonoUsd = persona.bonoAnualUsd / 12;
  return {
    ars: remuneracion + cargas + sindical + deltaOsde,
    bonoUsd: bonoUsd * (1 + c.pctCargas + c.pctArt + c.pctSac + c.pctSindical),
    detalle: { remuneracion, cargas: cargas + sindical, osde: deltaOsde },
  };
}

/**
 * Meses de sueldos: un período por mes calendario desde el inicio del servicio (octubre, proporcional
 * del 26 al 31) hasta el último día del contrato.
 */
export function periodosSueldos(meses, inicio = CONTRATO_VMOS.inicioServicio) {
  const [y, m, d] = inicio.split('-').map(Number);
  const fin = sumarDias(iso(new Date(Date.UTC(y, m - 1 + meses, d))), -1);
  const periodos = [];
  for (let mes = inicio.slice(0, 7), n = 1; mes <= fin.slice(0, 7); mes = mesSiguiente(mes), n++) {
    periodos.push({
      n, mes, nombre: nombreMes(mes),
      desde: mes === inicio.slice(0, 7) ? inicio : `${mes}-01`,
      hasta: mes === fin.slice(0, 7) ? fin : finDeMes(mes),
    });
  }
  return periodos;
}

/**
 * Costo de capitanes de un mes calendario. Por persona: lo real si está cargado (sueldos_mes) y si no,
 * el costo proyectado proporcional a los días activos del mes.
 * @param {Record<string, number>} [reales] total real por id de persona en ese mes
 */
export function costoCapitanesMes(periodoMes, personal, cargas, tc, reales = {}) {
  const porPersona = personal.filter((pe) => pe.inicio).map((pe) => {
    const meq = mesesEquivalentes(periodoMes, pe.inicio, pe.fin);
    const c = costoEmpleado(pe, cargas);
    const proyectado = (c.ars + c.bonoUsd * tc) * meq;
    const real = reales[pe.id];
    return { persona: pe, meq, proyectado, real: real ?? null, costo: real ?? proyectado, detalle: c.detalle };
  }).filter((x) => x.meq > 0 || x.real !== null);
  return {
    porPersona,
    proyectado: porPersona.reduce((s, x) => s + x.proyectado, 0),
    total: porPersona.reduce((s, x) => s + x.costo, 0),
    conReales: porPersona.some((x) => x.real !== null),
  };
}

const estado = (f) => (f?.cobradaEl ? 'cobrado' : f?.facturaEmitidaEl ? 'facturado' : 'proyeccion');

/**
 * P&L de cada período, en pesos.
 * @param {object} p
 * @param {object[]} p.periodos            periodosContrato()
 * @param {Record<string, object>} p.facturaciones  por mes: { total, factores, facturaEmitidaEl, cobradaEl, hasta }
 * @param {object[]} p.personal            { sueldoBrutoArs, bonoAnualUsd, osdeCostoArs, inicio, fin }
 * @param {object} p.cargas                parámetros de cargas sociales
 * @param {{arranque: object, esperado: object}} p.escenarios  supuestos (se usa arranque si el factor < 1)
 * @param {object[]} p.ajustes             ajustes de precio aprobados
 * @param {(mes: string) => number} p.fx   tipo de cambio ARS/USD de cada mes
 * @param {string|null} p.inicioSeguros    desde cuándo se facturan y pagan las pólizas (null = todavía no)
 * @param {Record<string, Record<string, number>>} [p.sueldosReales]  por mes calendario: total real por persona
 */
export function calcularPnl({ periodos, facturaciones, personal, cargas, escenarios, ajustes = [], fx, inicioSeguros = null, sueldosReales = {} }) {
  // El factor de la proyección es el del último día de la última facturación cargada (p. ej. 0,75).
  const cargadas = periodos.map((p) => facturaciones[p.mes]).filter(Boolean);
  const ultima = cargadas.at(-1);
  const factorVigente = ultima?.factores?.['1']?.[ultima.hasta] ?? escenarios.arranque.factorPrecio;


  return periodos.map((periodo) => {
    const f = facturaciones[periodo.mes];
    const real = estado(f) !== 'proyeccion';
    const factor = f?.factores?.['1']?.[periodo.hasta] ?? factorVigente;
    const esc = factor < 1 ? escenarios.arranque : escenarios.esperado;
    const tc = fx(periodo.mes);
    const meq = mesesEquivalentes(periodo);
    const usd = (montoUsdMes) => montoUsdMes * tc * meq;

    // Ingresos: la facturación cargada (emitida o en preparación) o la proyección al factor vigente.
    const ingresoCoc = f
      ? f.total
      : certificar({
        periodo,
        factores: { 1: Object.fromEntries(rangoDias(periodo.desde, periodo.hasta).map((d) => [d, factor])) },
        precios: (d) => preciosEnFecha(ajustes, d),
      }).total;
    const conSeguros = inicioSeguros && inicioSeguros <= periodo.hasta;
    const ingresoSeguros = conSeguros ? usd(esc.ingresoSegurosUsd) : 0;
    const ingreso = ingresoCoc + ingresoSeguros;

    // Capitanes: suma de los meses calendario que abarca el período (el primero incluye octubre).
    let capitanes = 0;
    let sueldosReales_ = false;
    for (let mes = periodo.desde.slice(0, 7); mes <= periodo.hasta.slice(0, 7); mes = mesSiguiente(mes)) {
      const tramo = {
        mes,
        desde: mes === periodo.desde.slice(0, 7) ? periodo.desde : `${mes}-01`,
        hasta: mes === periodo.hasta.slice(0, 7) ? periodo.hasta : finDeMes(mes),
      };
      const c = costoCapitanesMes(tramo, personal, cargas, fx(mes), sueldosReales[mes]);
      capitanes += c.total;
      sueldosReales_ ||= c.conReales;
    }
    const operacion = usd(esc.operacionUsd);
    const polizas = conSeguros ? usd(esc.costoSegurosUsd) : 0;
    const estructura = usd(esc.estructuraTmUsd);
    const sergioFijo = usd(esc.sgFijoUsd * factor);
    const impuestos = ingreso * (esc.pctImprevistos + esc.pctCredito + esc.pctIibb);
    const costosTotal = capitanes + operacion + polizas + estructura + sergioFijo + impuestos;
    const bruto = ingreso - costosTotal;
    // Participación de Sergio sobre el resultado del servicio (sin la parte de seguros).
    const brutoSeguros = ingresoSeguros - polizas - ingresoSeguros * (esc.pctImprevistos + esc.pctCredito + esc.pctIibb);
    const participacion = esc.pctParticipacionSg * (bruto - brutoSeguros) - esc.pctParticipacionSg * usd(esc.estructuraBaseSgUsd * factor);

    return {
      ...periodo,
      estado: estado(f),
      real,
      cargada: Boolean(f),
      factor,
      fx: tc,
      ingresoCoc, ingresoSeguros, ingreso,
      capitanes, sueldosReales: sueldosReales_, operacion, polizas, estructura, sergioFijo, impuestos,
      // Sergio factura como proveedor: su fijo va dentro de Operación.
      operacionTotal: operacion + sergioFijo,
      bruto,
      participacion,
      generacion: bruto - participacion,
    };
  });
}

// Sumas de una lista de filas del P&L.
export function totalesPnl(filas) {
  const campos = ['ingresoCoc', 'ingresoSeguros', 'ingreso', 'capitanes', 'operacion', 'operacionTotal', 'polizas', 'estructura', 'sergioFijo', 'impuestos', 'bruto', 'participacion', 'generacion'];
  return Object.fromEntries(campos.map((k) => [k, filas.reduce((s, f) => s + f[k], 0)]));
}

