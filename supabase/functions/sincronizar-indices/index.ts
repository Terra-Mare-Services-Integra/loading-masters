// Descarga el IPC de INDEC (datos.gob.ar) y el dólar BNA divisa vendedor (BCRA) y los guarda en
// serie_ipc y serie_usd. La corre pg_cron dos veces por día; también se puede llamar desde la app.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SERIE_IPC = '148.3_INIVELNAL_DICI_M_26';
const DESDE = '2025-01-01';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function json(url: string) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
  return r.json();
}

// IPC Nivel General Nacional. Fuente principal: el CSV que publica el INDEC (sale el mismo día del
// informe); respaldo: la API de series de datos.gob.ar, que se actualiza unos días después.
async function ipcIndec() {
  const r = await fetch('https://www.indec.gob.ar/ftp/cuadros/economia/serie_ipc_divisiones.csv');
  if (!r.ok) throw new Error(`INDEC respondió ${r.status}`);
  const texto = new TextDecoder('latin1').decode(await r.arrayBuffer());
  // Codigo;Descripcion;Clasificador;Periodo;Indice_IPC;v_m_IPC;v_i_a_IPC;Region
  return texto.split(/\r?\n/)
    .map((l) => l.split(';'))
    .filter((c) => c[0] === '0' && c[7]?.trim() === 'Nacional' && c[3] >= DESDE.slice(0, 7).replace('-', ''))
    .map((c) => ({ mes: `${c[3].slice(0, 4)}-${c[3].slice(4, 6)}`, valor: Number(c[4].replace(',', '.')) }));
}

async function ipcDatosGob() {
  const d = await json(`https://apis.datos.gob.ar/series/api/series/?ids=${SERIE_IPC}&start_date=${DESDE}&limit=1000&format=json`);
  return (d.data as [string, number | null][])
    .filter(([, v]) => v !== null)
    .map(([f, v]) => ({ mes: f.slice(0, 7), valor: v as number }));
}

async function sincronizarIpc() {
  const porMes = new Map<string, { valor: number; fuente: string }>();
  const errores: string[] = [];
  // Primero la API y después el INDEC, así el INDEC pisa (y agrega el último mes).
  for (const [fuente, fn] of [['datos.gob.ar', ipcDatosGob], ['INDEC', ipcIndec]] as const) {
    try {
      for (const { mes, valor } of await fn()) if (valor > 0) porMes.set(mes, { valor, fuente });
    } catch (e) {
      errores.push(`${fuente}: ${(e as Error).message}`);
    }
  }
  if (!porMes.size) throw new Error(errores.join(' · '));
  const filas = [...porMes].sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, { valor, fuente }]) => ({ mes, valor, fuente, actualizado_at: new Date().toISOString() }));
  const { error } = await db.from('serie_ipc').upsert(filas);
  if (error) throw error;
  return { meses: filas.length, ultimo: filas.at(-1), ...(errores.length ? { avisos: errores } : {}) };
}

async function sincronizarUsd() {
  // Desde 10 días antes del último guardado (por correcciones), o desde el inicio si está vacía.
  const { data: ultima } = await db.from('serie_usd').select('fecha').order('fecha', { ascending: false }).limit(1).maybeSingle();
  const desde = ultima ? new Date(Date.parse(ultima.fecha) - 10 * 86400e3).toISOString().slice(0, 10) : DESDE;
  const hasta = new Date().toISOString().slice(0, 10);
  const d = await json(`https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde=${desde}&fechahasta=${hasta}&limit=1000`);
  const filas = (d.results as { fecha: string; detalle: { tipoCotizacion: number }[] }[])
    .filter((r) => r.detalle?.[0]?.tipoCotizacion > 0)
    .map((r) => ({ fecha: r.fecha, valor: r.detalle[0].tipoCotizacion, actualizado_at: new Date().toISOString() }));
  const { error } = await db.from('serie_usd').upsert(filas);
  if (error) throw error;
  return { dias: filas.length, desde, ultimo: filas.sort((a, b) => a.fecha.localeCompare(b.fecha)).at(-1) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const detalle: Record<string, unknown> = {};
  let ok = true;
  for (const [nombre, fn] of [['ipc', sincronizarIpc], ['usd', sincronizarUsd]] as const) {
    try {
      detalle[nombre] = await fn();
    } catch (e) {
      ok = false;
      detalle[nombre] = { error: String((e as Error).message ?? e) };
    }
  }
  await db.from('sincronizaciones').insert({ ok, detalle });

  return new Response(JSON.stringify({ ok, detalle }), {
    status: ok ? 200 : 502,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
