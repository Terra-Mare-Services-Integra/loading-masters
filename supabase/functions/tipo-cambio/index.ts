// Tipo de cambio USD para una fecha (calculadora de sueldos): BNA divisa y billete, compra y venta, más el
// BCRA (serie "Cotizaciones" de estadisticascambiarias = BNA divisa vendedor) como control.
// GET /tipo-cambio?fecha=YYYY-MM-DD[&refrescar=1]  → usa la última cotización hábil ≤ fecha.
// Requiere usuario logueado con acceso a la calculadora (cs_puede_ver). Guarda en cs_tipo_cambio.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const num = (s: string) => Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
const iso = (d: string) => { const [dd, mm, yy] = d.split('/'); return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`; };
const ddmmyyyy = (f: string) => { const [y, m, d] = f.split('-'); return `${d}/${m}/${y}`; };

// Histórico BNA: tabla con "Dolar U.S.A | compra | venta | d/m/aaaa" de los días hábiles previos a la fecha.
async function bnaDia(tipo: 'billetes' | 'divisas', fecha: string) {
  const idMoneda = tipo === 'billetes' ? 22 : 55;
  const url = `https://www.bna.com.ar/Cotizador/HistoricoPrincipales?id=${tipo}&fecha=${encodeURIComponent(ddmmyyyy(fecha))}&idMoneda=${idMoneda}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (calculadora-sueldos)' } });
  if (!r.ok) throw new Error(`BNA ${tipo} respondió ${r.status}`);
  const html = await r.text();
  const filas = [...html.matchAll(/<td>\s*Dolar U\.S\.A\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>\s*<td>\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*<\/td>/g)]
    .map((m) => ({ compra: num(m[1]), venta: num(m[2]), fecha: iso(m[3]) }))
    .filter((f) => f.fecha <= fecha && f.compra > 0 && f.venta > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  return filas.at(-1) ?? null;
}

// El histórico solo trae los días hábiles cercanos a la fecha pedida: si no hay, se retrocede día a día (hasta 10).
async function bna(tipo: 'billetes' | 'divisas', fecha: string) {
  let f = fecha;
  for (let i = 0; i <= 10; i++) {
    const r = await bnaDia(tipo, f);
    if (r) return r;
    f = new Date(new Date(f + 'T00:00:00Z').getTime() - 864e5).toISOString().slice(0, 10);
  }
  return null;
}

async function bcra(fecha: string) {
  const desde = new Date(new Date(fecha + 'T00:00:00Z').getTime() - 10 * 864e5).toISOString().slice(0, 10);
  const r = await fetch(`https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde=${desde}&fechahasta=${fecha}`);
  if (!r.ok) throw new Error(`BCRA respondió ${r.status}`);
  const d = await r.json();
  const filas = (d.results ?? [])
    .map((x: { fecha: string; detalle: { tipoCotizacion: number }[] }) => ({ fecha: x.fecha, venta: x.detalle?.[0]?.tipoCotizacion }))
    .filter((x: { venta: number }) => x.venta > 0)
    .sort((a: { fecha: string }, b: { fecha: string }) => a.fecha.localeCompare(b.fecha));
  return filas.at(-1) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const usuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: puede } = await usuario.rpc('cs_puede_ver');
    if (!puede) return responder({ error: 'No autorizado' }, 403);

    const u = new URL(req.url);
    const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // hora de Argentina
    const fecha = (u.searchParams.get('fecha') ?? hoy).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoy) return responder({ error: 'Fecha inválida (no puede ser futura)' }, 400);

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // Fechas pasadas ya consultadas no cambian; el día de hoy se refresca siempre.
    if (fecha < hoy && !u.searchParams.get('refrescar')) {
      const { data } = await db.from('cs_tipo_cambio').select('*').eq('fecha', fecha).maybeSingle();
      // Si se había usado un día anterior (feriado o dato aún no publicado), se reintenta durante 10 días.
      const firme = data?.fecha_bna === fecha || fecha < new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
      if (data && data.divisa_venta && data.billete_venta && firme) return responder({ ...data, cache: true });
    }

    const avisos: string[] = [];
    const intentar = async <T>(nombre: string, fn: () => Promise<T>) => {
      try { return await fn(); } catch (e) { avisos.push(`${nombre}: ${(e as Error).message}`); return null; }
    };
    const [billete, divisa, central] = await Promise.all([
      intentar('BNA billete', () => bna('billetes', fecha)),
      intentar('BNA divisa', () => bna('divisas', fecha)),
      intentar('BCRA', () => bcra(fecha)),
    ]);
    if (!billete && !divisa && !central) return responder({ error: 'No se pudo obtener ninguna cotización', avisos }, 502);

    const fila = {
      fecha,
      fecha_bna: divisa?.fecha ?? billete?.fecha ?? null,
      divisa_compra: divisa?.compra ?? null,
      divisa_venta: divisa?.venta ?? null,
      billete_compra: billete?.compra ?? null,
      billete_venta: billete?.venta ?? null,
      fecha_bcra: central?.fecha ?? null,
      bcra_divisa_venta: central?.venta ?? null,
      actualizado_at: new Date().toISOString(),
    };
    if (divisa && billete && divisa.fecha !== billete.fecha) avisos.push(`BNA billete del ${billete.fecha} y divisa del ${divisa.fecha}`);
    if (divisa && central && Math.abs(divisa.venta - central.venta) > 0.01 && divisa.fecha === central.fecha)
      avisos.push(`BNA divisa venta ${divisa.venta} ≠ BCRA ${central.venta}`);
    await db.from('cs_tipo_cambio').upsert(fila);
    return responder({ ...fila, avisos });
  } catch (e) {
    return responder({ error: (e as Error).message }, 500);
  }
});
