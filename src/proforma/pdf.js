// Opciones de impresión del PDF de la proforma (las usan el script local y la función de Vercel).
export const opcionesPdf = (numero) => ({
  format: 'A4',
  preferCSSPageSize: true,
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: `<div style="width:100%;margin:0 20mm;display:flex;justify-content:space-between;font-family:Montserrat,Arial,sans-serif;font-size:7pt;letter-spacing:.06em;color:#5B6672;">
      <span>TERRAMARE · Proforma ${numero}</span>
      <span style="font-family:'IBM Plex Mono',monospace;"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
});

// Dónde se guardan los documentos de una proforma en Supabase Storage (carpeta "documentos").
export const carpetaProforma = (proformaId) => `proformas/${proformaId}`;
export const archivoProforma = (numero) => `Proforma ${numero}.pdf`;
