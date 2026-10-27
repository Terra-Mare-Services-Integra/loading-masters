// Plantilla HTML de la proforma, con el TERRAMARE Design System (tokens de color, Jost /
// Montserrat / IBM Plex Mono, filete azul bajo títulos, radio 0, A4 20/18/16 mm).
// Todo el texto queda como texto real: el PDF se genera imprimiendo este HTML.

import { parse } from '../lib/fechas.js';

const ars = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 });
const dec2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fecha = (iso) => iso.split('-').reverse().join('/');
const pesos = (x) => `$ ${ars.format(x)}`;
const pct = (x) => `${dec2.format(x * 100)} %`;

export const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500&family=Montserrat:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap");
:root{
  --tm-blue:#235C96; --tm-blue-deep:#213363; --tm-blue-mid:#6381A7; --tm-blue-light:#A5B5CC;
  --tm-surface:#F4F6F9; --tm-ink:#101820; --tm-blue-050:#E7EDF4;
  --text-muted:#5B6672; --border-subtle:#E2E7EE;
  --font-display:"Jost",system-ui,sans-serif; --font-body:"Montserrat",system-ui,sans-serif;
  --font-mono:"IBM Plex Mono",ui-monospace,monospace;
}
@page{ size:A4; margin:18mm 20mm 16mm; }
*{ box-sizing:border-box; }
html,body{ margin:0; background:#fff; color:var(--tm-ink); font-family:var(--font-body); font-size:9.5pt; line-height:1.5; }
.salto{ break-before:page; }

.cabecera{ display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:5mm; border-bottom:1px solid var(--border-subtle); }
.cabecera img{ height:15mm; display:block; }
.doc-id{ text-align:right; }
.overline{ font-weight:600; font-size:8pt; letter-spacing:.18em; text-transform:uppercase; color:var(--tm-blue); }
.overline.muted{ color:var(--tm-blue-mid); }
.doc-id .numero{ font-family:var(--font-mono); font-weight:500; font-size:12pt; margin-top:1mm; }
.doc-id .fecha{ font-family:var(--font-mono); font-size:9pt; color:var(--text-muted); }

h1{ font-family:var(--font-display); font-weight:400; font-size:22pt; line-height:1.05; letter-spacing:-.01em; margin:7mm 0 0; }
.periodo{ font-family:var(--font-mono); font-weight:500; font-size:11pt; margin-top:2mm; }
h2{ font-family:var(--font-display); font-weight:400; font-size:16pt; line-height:1.15; letter-spacing:-.01em; margin:0; }
.filete{ width:80px; height:4px; background:var(--tm-blue); margin-top:3mm; }
.lead{ color:var(--tm-blue-mid); font-size:10.5pt; line-height:1.5; margin:3mm 0 0; max-width:70ch; }

.partes{ display:grid; grid-template-columns:1fr 1fr; gap:5mm; margin-top:6mm; }
.tarjeta{ background:var(--tm-surface); border:1px solid var(--border-subtle); padding:4mm 5mm; }
.tarjeta .nombre{ font-weight:600; font-size:10.5pt; margin-top:1.5mm; }
.tarjeta .dato{ color:var(--text-muted); font-size:8.5pt; }
.mono{ font-family:var(--font-mono); }

.cifras{ display:flex; gap:12mm; margin-top:6mm; }
.cifra .valor{ font-family:var(--font-mono); font-weight:500; font-size:13pt; color:var(--tm-blue); }
.cifra .leyenda{ font-size:8pt; color:var(--text-muted); text-transform:uppercase; letter-spacing:.12em; }

section{ margin-top:7mm; }
table{ width:100%; border-collapse:collapse; margin-top:3mm; }
th{ text-align:left; font-weight:600; font-size:8pt; letter-spacing:.04em; padding:0 2mm 2mm; border-bottom:1px solid var(--tm-blue-light); vertical-align:bottom; white-space:nowrap; }
td{ padding:1.6mm 2mm; vertical-align:top; }
tbody tr:nth-child(odd){ background:var(--tm-surface); }
td.n, th.n{ text-align:right; }
td.n{ font-family:var(--font-mono); font-size:8pt; color:var(--text-muted); white-space:nowrap; }
td.n.fuerte{ color:var(--tm-ink); font-weight:500; }
td.cod{ font-family:var(--font-mono); font-size:8.5pt; color:var(--tm-blue); width:9mm; }
td.desc{ font-size:8pt; line-height:1.35; }
.dato{ color:var(--text-muted); }
tr.inactivo td{ color:var(--tm-blue-light); }
tr.inactivo td.cod{ color:var(--tm-blue-light); }

.totales{ margin-left:auto; width:85mm; margin-top:3mm; break-inside:avoid; }
.totales div{ display:flex; justify-content:space-between; padding:1.3mm 2mm; }
.totales span:last-child{ font-family:var(--font-mono); }
.totales .total{ background:var(--tm-blue-deep); color:#fff; font-weight:600; margin-top:1mm; }
.totales .total span:last-child{ font-weight:500; }

.circuito{ display:grid; grid-template-columns:repeat(4,1fr); gap:0; margin-top:4mm; border-top:4px solid var(--tm-blue); }
.paso{ padding:3mm 3mm 0 0; }
.paso .cuando{ font-family:var(--font-mono); font-weight:500; font-size:10pt; }
.paso .que{ font-size:8pt; color:var(--text-muted); margin-top:.5mm; }

.notas{ margin-top:6mm; font-size:8pt; color:var(--text-muted); }
.notas p{ margin:0 0 1.5mm; }

table.diario td, table.diario th{ padding-top:.9mm; padding-bottom:.9mm; }
table.diario td{ font-size:8pt; }
table.diario td.f{ font-family:var(--font-mono); white-space:nowrap; }
table.diario td.dow{ color:var(--text-muted); width:10mm; }
table.diario td.n.cero{ color:var(--tm-blue-light); }
table.diario tr.finde td.f, table.diario tr.finde td.dow{ color:var(--tm-blue-mid); }
table.diario tfoot td{ border-top:1px solid var(--tm-blue-light); font-weight:600; padding-top:2mm; }
table.diario tfoot td.n{ color:var(--tm-ink); }
`;

function filaItem(it) {
  const activo = it.importe > 0;
  if (it.tipo === 'reembolsable') {
    return `<tr class="${activo ? '' : 'inactivo'}">
      <td class="cod">${esc(it.codigo)}</td>
      <td class="desc">${esc(it.descripcion)}<br><span class="dato">Gastos ${pesos(it.gasto)} × ${dec2.format(it.fee)}</span></td>
      <td class="n">—</td><td class="n">—</td><td class="n">—</td>
      <td class="n fuerte">${pesos(it.importe)}</td></tr>`;
  }
  return `<tr class="${activo ? '' : 'inactivo'}">
    <td class="cod">${esc(it.codigo)}</td>
    <td class="desc">${esc(it.descripcion)}</td>
    <td class="n">${pesos(it.precioMensual)}</td>
    <td class="n">${pesos(it.costoDiario)}</td>
    <td class="n">${num.format(it.diasEquivalentes)}</td>
    <td class="n fuerte">${pesos(it.importe)}</td></tr>`;
}

function tablaDiaria(cert) {
  const mensuales = cert.items.filter((i) => i.tipo === 'mensual');
  const filas = cert.dias.map((f, k) => {
    const dow = parse(f).getUTCDay();
    const celdas = mensuales.map((i) => {
      const v = i.porDia[k].factor;
      return `<td class="n ${v ? '' : 'cero'}">${v ? num.format(v) : '–'}</td>`;
    }).join('');
    return `<tr class="${dow === 0 || dow === 6 ? 'finde' : ''}"><td class="f">${fecha(f)}</td><td class="dow">${DIAS[dow]}</td>${celdas}</tr>`;
  }).join('');
  return `<table class="diario">
    <thead><tr><th>Fecha</th><th></th>${mensuales.map((i) => `<th class="n">Ítem ${esc(i.codigo)}</th>`).join('')}</tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr><td colspan="2">Días equivalentes</td>${mensuales.map((i) => `<td class="n">${num.format(i.diasEquivalentes)}</td>`).join('')}</tr>
    <tr><td colspan="2">Fracción del mes</td>${mensuales.map((i) => `<td class="n">${pct(i.fraccionMes)}</td>`).join('')}</tr></tfoot>
  </table>`;
}

// Pie paginado con cajas de margen @page, para cuando se imprime desde el navegador
// (con Puppeteer el pie lo pone footerTemplate).
const piePagina = (numero) => `
@page{
  @bottom-left{ content:"TERRAMARE · Proforma ${numero}"; font-family:Montserrat,sans-serif; font-size:7pt; letter-spacing:.06em; color:#5B6672; }
  @bottom-right{ content:counter(page) " / " counter(pages); font-family:"IBM Plex Mono",monospace; font-size:7pt; color:#5B6672; }
}`;

export function renderProforma(p, { logo, pie = false } = {}) {
  const cert = p.certificacion;
  const cal = p.calendario;
  const diasHabiles = p.plazos.diasHabilesRevisionProforma;
  const diasPago = p.plazos.diasPagoFactura;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${esc(p.numero)}</title>
<style>${CSS}${pie ? piePagina(esc(p.numero)) : ''}</style></head>
<body>

<header class="cabecera">
  ${logo ? `<img src="${logo}" alt="TERRAMARE">` : '<div class="overline">TERRAMARE</div>'}
  <div class="doc-id">
    <div class="overline">Proforma</div>
    <div class="numero">${esc(p.numero)}</div>
    <div class="fecha">Emitida ${fecha(p.fechaEmision)}</div>
  </div>
</header>

<h1>Certificación de servicios.</h1>
<div class="periodo">${fecha(cert.periodo.desde)} – ${fecha(cert.periodo.hasta)}</div>
<div class="filete"></div>
<p class="lead">${esc(p.referencia)}.</p>

<div class="partes">
  <div class="tarjeta"><div class="overline muted">Emisor</div>
    <div class="nombre">${esc(p.emisor.razonSocial)}</div>
    <div class="dato">CUIT <span class="mono">${esc(p.emisor.cuit)}</span></div>
    <div class="dato">${esc(p.emisor.domicilio)}</div></div>
  <div class="tarjeta"><div class="overline muted">Cliente</div>
    <div class="nombre">${esc(p.cliente.razonSocial)}</div>
    <div class="dato">${esc(p.cliente.domicilio)}</div></div>
</div>

<div class="cifras">
  <div class="cifra"><div class="valor">${cert.dias.length}</div><div class="leyenda">Días del período</div></div>
  ${cert.items.filter((i) => i.tipo === 'mensual' && i.diasEquivalentes > 0).map((i) =>
    `<div class="cifra"><div class="valor">${num.format(i.diasEquivalentes)}</div><div class="leyenda">Días equiv. ítem ${esc(i.codigo)}</div></div>`).join('')}
  <div class="cifra"><div class="valor">${pesos(p.total)}</div><div class="leyenda">Total ${esc(p.moneda)} c/IVA</div></div>
</div>

<section>
  <div class="overline">Resumen</div>
  <table>
    <thead><tr><th>Ítem</th><th>Descripción</th><th class="n">Precio mensual</th><th class="n">Costo diario</th><th class="n">Días equiv.</th><th class="n">Importe</th></tr></thead>
    <tbody>${cert.items.map(filaItem).join('')}</tbody>
  </table>
  <div class="totales">
    <div><span>Subtotal neto</span><span>${pesos(p.subtotal)}</span></div>
    <div><span>IVA ${pct(p.iva)}</span><span>${pesos(p.ivaImporte)}</span></div>
    <div class="total"><span>Total ${esc(p.moneda)}</span><span>${pesos(p.total)}</span></div>
  </div>
</section>

<section>
  <div class="overline">Circuito de aprobación y cobro</div>
  <div class="circuito">
    <div class="paso"><div class="cuando">${fecha(cal.envioProforma)}</div><div class="que">Envío de proforma</div></div>
    <div class="paso"><div class="cuando">${fecha(cal.finRevision)}</div><div class="que">Fin del plazo de observaciones (${diasHabiles} días hábiles)</div></div>
    <div class="paso"><div class="cuando">${fecha(cal.factura)}</div><div class="que">Emisión de factura</div></div>
    <div class="paso"><div class="cuando">${fecha(cal.vencimientoPago)}</div><div class="que">Vencimiento de pago (${diasPago} días)</div></div>
  </div>
</section>

<div class="salto"></div>
<h2>Detalle de días trabajados.</h2>
<div class="filete"></div>
<p class="lead">Factor diario por ítem certificado, ${fecha(cert.periodo.desde)} al ${fecha(cert.periodo.hasta)}.</p>
<div class="notas">
  <p>Costo diario = precio mensual / ${cert.divisor} días del período. Factor diario 1 = servicio completo; las fracciones reflejan la dotación efectivamente afectada.
  Precios en ${esc(p.moneda)}, sin IVA, según tarifario de la Oferta.</p>
  ${p.observaciones.map((o) => `<p>${esc(o)}</p>`).join('')}
</div>
${tablaDiaria(cert)}

</body></html>`;
}
