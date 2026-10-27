// Genera la proforma en PDF a partir de una carga de certificación.
//   npm run proforma -- certificaciones/2026-11.json
// Deja <numero>.html y <numero>.pdf en salidas/.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { armarProforma } from '../src/proforma/armar.js';
import { renderProforma } from '../src/proforma/plantilla.js';

const NAVEGADORES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: npm run proforma -- certificaciones/AAAA-MM.json');
  process.exit(1);
}

const carga = JSON.parse(await readFile(archivo, 'utf8'));
const proforma = armarProforma(carga);
const logo = `data:image/png;base64,${(await readFile(new URL('../assets/isologo-horizontal-azul.png', import.meta.url))).toString('base64')}`;
const html = renderProforma(proforma, { logo });

await mkdir('salidas', { recursive: true });
const base = path.join('salidas', proforma.numero);
await writeFile(`${base}.html`, html);

const executablePath = NAVEGADORES.find((p) => existsSync(p));
if (!executablePath) throw new Error('No encontré Chrome ni Edge; definí CHROME_PATH.');

const browser = await puppeteer.launch({ executablePath });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: `${base}.pdf`,
    format: 'A4',
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;margin:0 20mm;display:flex;justify-content:space-between;font-family:Montserrat,Arial,sans-serif;font-size:7pt;letter-spacing:.06em;color:#5B6672;">
      <span>TERRAMARE · Proforma ${proforma.numero}</span>
      <span style="font-family:'IBM Plex Mono',monospace;"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
} finally {
  await browser.close();
}

console.log(`Proforma ${proforma.numero}: total ${proforma.moneda} ${proforma.total.toFixed(2)} → ${base}.pdf`);
