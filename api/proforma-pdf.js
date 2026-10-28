// Genera el PDF de una proforma emitida con Chrome (el mismo HTML que imprime la app) y lo guarda en
// Supabase Storage (documentos/proformas/<id>/). Actúa con el token del usuario: la base y el storage
// aplican sus permisos (solo usuarios autorizados).
import { readFile } from 'node:fs/promises';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';
import { renderProforma } from '../src/proforma/plantilla.js';
import { opcionesPdf, carpetaProforma, archivoProforma } from '../src/proforma/pdf.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usar POST' });
  try {
    const autorizacion = req.headers.authorization ?? '';
    if (!autorizacion.startsWith('Bearer ')) return res.status(401).json({ error: 'Falta iniciar sesión' });
    const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: autorizacion } },
      auth: { persistSession: false },
    });
    const { data: autorizado } = await sb.rpc('es_usuario_autorizado');
    if (!autorizado) return res.status(403).json({ error: 'No autorizado' });

    const { proformaId } = req.body ?? {};
    const { data: pf, error } = await sb.from('proformas').select('id, numero, datos').eq('id', proformaId).single();
    if (error || !pf) return res.status(404).json({ error: 'No se encontró la proforma' });

    const logo = `data:image/png;base64,${(await readFile(new URL('../assets/isologo-horizontal-azul.png', import.meta.url))).toString('base64')}`;
    const html = renderProforma(pf.datos, { logo });
    const browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
    let pdf;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.evaluate(() => document.fonts.ready);
      pdf = await page.pdf(opcionesPdf(pf.numero));
    } finally {
      await browser.close();
    }

    const ruta = `${carpetaProforma(pf.id)}/${archivoProforma(pf.numero)}`;
    const { error: e2 } = await sb.storage.from('documentos').upload(ruta, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true });
    if (e2) throw e2;
    return res.status(200).json({ ruta, bytes: pdf.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
