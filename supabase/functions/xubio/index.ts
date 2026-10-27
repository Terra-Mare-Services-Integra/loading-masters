// Conexión con Xubio (API 1.1, OAuth2 client_credentials). Las credenciales viven solo en los secretos
// de la función (XUBIO_CLIENT_ID, XUBIO_SECRET_ID): nunca en el repo ni en el navegador.
// Acciones:
// - "diagnostico": prueba la conexión y trae una muestra de OC, facturas de compra y pagos.
// - "sincronizar-compras": trae los renglones de facturas de compra del centro de costo del proyecto a
//   xubio_compras y les aplica la clasificación por producto. La corre un cron diario y el botón de la app.
import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE = 'https://xubio.com/API/1.1';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

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
    const e = lista(await xubio(tk, '/miempresa'))[0] ?? {};
    return { nombre: e.nombre ?? e.razonSocial ?? e.nombreEmpresa ?? null, cuit: e.cuit ?? null, campos: Object.keys(e) };
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
    const ultimas = [...todas].sort((a: any, b: any) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 5);
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

// Producto sin la alícuota del final: "Alquiler de Inmueble 21%" → "Alquiler de Inmueble".
const productoBase = (p: string) => p.replace(/\s*\d+([.,]\d+)?\s*%\s*$/, '').trim();
const alicuota = (p: string) => {
  const m = p.match(/(\d+(?:[.,]\d+)?)\s*%\s*$/);
  return m ? Number(m[1].replace(',', '.')) / 100 : 0;
};

async function sincronizarCompras(desdeParam?: string, hastaParam?: string) {
  const inicio = Date.now();
  const { data: ref } = await db.from('referencias').select('valor').eq('clave', 'xubio').maybeSingle();
  const cfg = ref?.valor ?? {};
  const centro = cfg.centroDeCosto ?? 'Proyecto VMOS';
  const desde = desdeParam ?? cfg.desde ?? '2026-10-01';
  const hasta = hastaParam ?? fechaIso(new Date());
  const log: Record<string, unknown> = { at: new Date().toISOString(), desde, hasta, centroDeCosto: centro };
  try {
    const tk = await token();
    const facturas = lista(await xubio(tk, `/comprobanteCompraBean?fechaDesde=${desde}&fechaHasta=${hasta}`));
    const filas: Record<string, unknown>[] = [];
    for (const f of facturas) {
      const tid = f.transaccionid ?? f.transaccionId;
      // Si el listado no trae los renglones con su centro de costo, se pide la factura completa.
      const conRenglones = lista(f.transaccionProductoItems).length && lista(f.transaccionProductoItems).every((i: any) => 'centroDeCosto' in i);
      const c = conRenglones || !tid ? f : await xubio(tk, `/comprobanteCompraBean/${tid}`);
      const moneda = nombre(c.moneda) ?? '';
      const enPesos = !moneda || /peso/i.test(moneda);
      const cot = Number(c.cotizacion) || 1;
      lista(c.transaccionProductoItems).forEach((i: any, n: number) => {
        if (nombre(i.centroDeCosto) !== centro) return;
        const producto = nombre(i.producto) ?? '';
        const importe = Number(i.importe) || 0;
        const fecha = String(c.fecha ?? c.fechaComprobante).slice(0, 10);
        filas.push({
          id: String(i.transaccionCVItemId ?? `${tid}-${n}`),
          transaccion_id: tid,
          numero: c.numeroDocumento ?? '',
          fecha,
          mes: fecha.slice(0, 7),
          proveedor: nombre(c.proveedor) ?? '',
          descripcion: i.descripcion || c.descripcion || '',
          producto,
          producto_base: productoBase(producto),
          moneda,
          cotizacion: enPesos ? null : cot,
          importe,
          importe_ars: Math.round(importe * (enPesos ? 1 : cot) * 100) / 100,
          iva_pct: alicuota(producto),
          sincronizado_at: new Date().toISOString(),
        });
      });
    }
    // Alta y actualización (sin tocar clasificación ni fecha de pago).
    if (filas.length) {
      const { error } = await db.from('xubio_compras').upsert(filas);
      if (error) throw error;
    }
    // Lo que ya no está en Xubio (borrado o reimputado a otro centro de costo) se quita.
    const { data: existentes } = await db.from('xubio_compras').select('id').gte('fecha', desde).lte('fecha', hasta);
    const vigentes = new Set(filas.map((f) => f.id));
    const quitar = (existentes ?? []).map((e) => e.id).filter((id) => !vigentes.has(id));
    if (quitar.length) await db.from('xubio_compras').delete().in('id', quitar);
    // Clasificación por producto para lo que no se clasificó a mano.
    const { data: mapeo } = await db.from('xubio_mapeo').select('*');
    for (const m of mapeo ?? []) {
      await db.from('xubio_compras').update({ area: m.area, rubro: m.rubro }).eq('producto_base', m.producto_base).eq('manual', false);
    }
    const { count } = await db.from('xubio_compras').select('id', { count: 'exact', head: true }).is('area', null);
    Object.assign(log, { ok: true, facturas: facturas.length, renglones: filas.length, quitados: quitar.length, porClasificar: count ?? 0 });
  } catch (e) {
    Object.assign(log, { ok: false, error: (e as Error).message });
  }
  log.ms = Date.now() - inicio;
  await db.from('referencias').upsert({ clave: 'xubio_sync', valor: log, descripcion: 'Última sincronización de compras con Xubio' });
  return log;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const cuerpo = await req.json().catch(() => ({}));
    // El cron diario se identifica con su token; todo lo demás, solo usuarios autorizados de la app.
    const tokenCron = Deno.env.get('XUBIO_CRON_TOKEN');
    if (tokenCron && req.headers.get('x-cron-token') === tokenCron) {
      return responder(await sincronizarCompras());
    }
    const usuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: autorizado, error } = await usuario.rpc('es_usuario_autorizado');
    if (error || !autorizado) return responder({ error: 'No autorizado' }, 403);

    const { accion = 'diagnostico', desde, hasta } = cuerpo;
    const hoy = new Date();
    const hace90 = new Date(hoy.getTime() - 90 * 864e5);
    if (accion === 'diagnostico') return responder(await diagnostico(desde ?? fechaIso(hace90), hasta ?? fechaIso(hoy)));
    if (accion === 'sincronizar-compras') return responder(await sincronizarCompras(desde, hasta));
    return responder({ error: `Acción desconocida: ${accion}` }, 400);
  } catch (e) {
    return responder({ error: (e as Error).message }, 500);
  }
});
