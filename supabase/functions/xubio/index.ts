// Conexión con Xubio (API 1.1, OAuth2 client_credentials). Las credenciales viven solo en los secretos
// de la función (XUBIO_CLIENT_ID, XUBIO_SECRET_ID): nunca en el repo ni en el navegador.
// Por ahora: accion "diagnostico", que prueba la conexión y trae una muestra de órdenes de compra,
// facturas de compra y pagos para decidir cómo se imputan los gastos en la app.
import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE = 'https://xubio.com/API/1.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function token() {
  const id = Deno.env.get('XUBIO_CLIENT_ID');
  const secreto = Deno.env.get('XUBIO_SECRET_ID');
  if (!id || !secreto) throw new Error('Faltan los secretos XUBIO_CLIENT_ID y XUBIO_SECRET_ID en Supabase');
  const r = await fetch(`${BASE}/TokenEndpoint`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${id}:${secreto}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Xubio no dio el token (${r.status}): ${d.error_description ?? d.error ?? 'sin detalle'}`);
  return d.access_token as string;
}

async function xubio(tk: string, ruta: string) {
  const r = await fetch(`${BASE}${ruta}`, { headers: { Authorization: `Bearer ${tk}`, Accept: 'application/json' } });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${ruta} respondió ${r.status}: ${texto.slice(0, 200)}`);
  return texto ? JSON.parse(texto) : null;
}

const lista = (x: unknown) => (Array.isArray(x) ? x : x ? [x] : []);
const nombre = (x: any) => x?.nombre ?? x?.razonSocial ?? x?.codigo ?? null;
const fechaIso = (d: Date) => d.toISOString().slice(0, 10);

// Lo que interesa de un comprobante (OC o factura): cabecera y renglones con producto y centro de costo.
function resumirComprobante(c: any) {
  return {
    id: c.transaccionid ?? c.transaccionId ?? null,
    numero: c.numeroDocumento ?? null,
    tipo: c.tipo ?? null,
    fecha: c.fecha ?? c.fechaComprobante ?? null,
    proveedor: nombre(c.proveedor),
    descripcion: c.descripcion ?? null,
    externalId: c.externalId ?? null,
    moneda: nombre(c.moneda) ?? null,
    cotizacion: c.cotizacion ?? null,
    gravado: c.importeGravado ?? null,
    total: c.importetotal ?? null,
    renglones: lista(c.transaccionProductoItems).map((i: any) => ({
      producto: nombre(i.producto),
      descripcion: i.descripcion ?? null,
      centroDeCosto: nombre(i.centroDeCosto),
      cantidad: i.cantidad ?? null,
      precio: i.precio ?? null,
      importe: i.importe ?? null,
      iva: i.iva ?? null,
    })),
    campos: Object.keys(c),
  };
}

// Cada paso por separado: si uno falla, el resto igual se informa.
async function paso<T>(fn: () => Promise<T>) {
  const t0 = Date.now();
  try {
    const datos = await fn();
    return { ok: true, ...datos as object, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: (e as Error).message };
  }
}

async function diagnostico(desde: string, hasta: string) {
  const resultado: Record<string, unknown> = { desde, hasta };
  let tk = '';
  resultado.conexion = await paso(async () => {
    tk = await token();
    return {};
  });
  if (!tk) return resultado;

  resultado.empresa = await paso(async () => {
    const e = await xubio(tk, '/miempresa');
    return { nombre: e?.nombre ?? e?.razonSocial ?? null, cuit: e?.cuit ?? null };
  });
  resultado.centrosDeCosto = await paso(async () => ({ lista: lista(await xubio(tk, '/centroDeCostoBean')).map(nombre) }));
  resultado.productosDeCompra = await paso(async () => ({ lista: lista(await xubio(tk, '/ProductoCompraBean')).map(nombre) }));

  // Órdenes de compra: el listado no filtra por fecha; se muestran las últimas con su detalle.
  resultado.ordenesDeCompra = await paso(async () => {
    const todas = lista(await xubio(tk, '/ordenCompraBean'));
    const ultimas = todas.slice(-5);
    const detalle = await Promise.all(ultimas.map((o: any) => {
      const id = o.transaccionid ?? o.transaccionId;
      return id ? xubio(tk, `/ordenCompraBean/${id}`).catch(() => o) : o;
    }));
    return { cantidad: todas.length, muestra: detalle.map(resumirComprobante) };
  });

  resultado.facturasDeCompra = await paso(async () => {
    const todas = lista(await xubio(tk, `/comprobanteCompraBean?fechaDesde=${desde}&fechaHasta=${hasta}`));
    const ultimas = todas.slice(-5);
    const detalle = await Promise.all(ultimas.map((f: any) => {
      const id = f.transaccionid ?? f.transaccionId;
      return id ? xubio(tk, `/comprobanteCompraBean/${id}`).catch(() => f) : f;
    }));
    return { cantidad: todas.length, muestra: detalle.map(resumirComprobante) };
  });

  resultado.pagos = await paso(async () => {
    const todos = lista(await xubio(tk, `/pagoBean?fechaDesde=${desde}&fechaHasta=${hasta}`));
    return {
      cantidad: todos.length,
      muestra: todos.slice(-5).map((p: any) => ({ id: p.transaccionid ?? null, fecha: p.fecha ?? null, proveedor: nombre(p.proveedor), recibo: p.numeroRecibo ?? null, campos: Object.keys(p) })),
    };
  });
  return resultado;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // Solo usuarios autorizados de la app (mismo criterio que las tablas).
    const usuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: autorizado, error } = await usuario.rpc('es_usuario_autorizado');
    if (error || !autorizado) return responder({ error: 'No autorizado' }, 403);

    const { accion = 'diagnostico', desde, hasta } = await req.json().catch(() => ({}));
    const hoy = new Date();
    const hace90 = new Date(hoy.getTime() - 90 * 864e5);
    if (accion === 'diagnostico') return responder(await diagnostico(desde ?? fechaIso(hace90), hasta ?? fechaIso(hoy)));
    return responder({ error: `Acción desconocida: ${accion}` }, 400);
  } catch (e) {
    return responder({ error: (e as Error).message }, 500);
  }
});
