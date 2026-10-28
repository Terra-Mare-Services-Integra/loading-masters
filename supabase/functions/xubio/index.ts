// Conexión con Xubio (API 1.1, OAuth2 client_credentials). Las credenciales viven solo en los secretos
// de la función (XUBIO_CLIENT_ID, XUBIO_SECRET_ID): nunca en el repo ni en el navegador.
// Acciones:
// - "diagnostico": prueba la conexión y trae una muestra de OC, facturas de compra y pagos.
// - "sincronizar-compras": trae los renglones de facturas de compra del centro de costo del proyecto a
//   xubio_compras y les aplica la clasificación por producto. La corre un cron diario y el botón de la app.
// - "opciones-ventas": clientes, productos de venta, puntos de venta y centros de costo para configurar.
// - "enviar-presupuesto": crea (o actualiza) en Xubio el presupuesto de una proforma emitida.
// - "pdf-presupuesto": devuelve el PDF del presupuesto (base64).
// - "estado-presupuesto": pasa el presupuesto a aprobado, rechazado o facturado.
// - "alta-ventas": vista previa (o, con confirmar, alta) del cliente y los productos de venta del contrato.
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

async function xubio(tk: string, ruta: string, metodo = 'GET', cuerpo?: unknown) {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${tk}`, Accept: 'application/json', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  // Xubio manda UTF-8 aunque el encabezado diga otra cosa: se decodifica a mano para no romper los acentos.
  const texto = new TextDecoder('utf-8').decode(await r.arrayBuffer());
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
    cliente: nombre(c.cliente),
    puntoVenta: nombre(c.puntoVenta),
    estado: nombre(c.estado) ?? c.estado ?? null,
    fechaVto: c.fechaVto ?? null,
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
      precioConIva: i.precioconivaincluido ?? null,
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

  // Ventas: lo necesario para crear el presupuesto de la proforma desde la app.
  resultado.clientes = await paso(async () => {
    const todos = lista(await xubio(tk, '/clienteBean'));
    const vmos = todos.filter((c: any) => /vmos/i.test(`${c.nombre ?? ''} ${c.razonSocial ?? ''}`));
    return { cantidad: todos.length, lista: vmos.map((c: any) => `${c.nombre ?? c.razonSocial} (id ${c.cliente_id ?? c.clienteid ?? c.id ?? '?'}, CUIT ${c.cuit ?? '—'})`), campos: Object.keys(todos[0] ?? {}) };
  });
  resultado.productosDeVenta = await paso(async () => ({ lista: lista(await xubio(tk, '/ProductoVentaBean')).map((p: any) => `${nombre(p)}${p.codigo ? ` [${p.codigo}]` : ''}`) }));
  resultado.puntosDeVenta = await paso(async () => ({ lista: lista(await xubio(tk, '/puntoVentaBean')).map((p: any) => `${nombre(p)}${p.puntoVenta ? ` (${p.puntoVenta})` : ''}`) }));
  resultado.presupuestos = await paso(async () => {
    const todos = lista(await xubio(tk, '/presupuestoBean'));
    const ultimos = [...todos].sort((a: any, b: any) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 3);
    const detalle = await Promise.all(ultimos.map((o: any) => {
      const id = o.transaccionid ?? o.transaccionId;
      return id ? xubio(tk, `/presupuestoBean/${id}`).catch(() => o) : o;
    }));
    return { cantidad: todos.length, muestra: detalle.map(resumirComprobante) };
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

// ─── Ventas: presupuesto de la proforma ──────────────────────────────────────

const selector = (x: { id: number; nombre: string } | null) => (x ? { ID: x.id, id: x.id, nombre: x.nombre } : null);
// Ítem del servicio mensual y el producto aparte para los días con servicio reducido (75 %).
const ITEM_SERVICIO = '1';
const ITEM_SERVICIO_REDUCIDO = '1-75';
const diasMes = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();
const redondear = (n: number) => Math.round(n * 100) / 100;
const ESTADOS_PRESUPUESTO: Record<string, number> = { pendiente: -3, aprobado: -2, rechazado: -7, facturado: -5 };

// El id de un objeto de Xubio: ID o id según el listado, o cualquier campo numérico que termine en "id".
const idDe = (x: any) => x?.ID ?? x?.id ?? Object.entries(x ?? {}).find(([k, v]) => /id$/i.test(k) && typeof v === 'number')?.[1] ?? null;

// El listado de centros de costo puede venir sin id: en ese caso se toma de los renglones de las
// facturas de compra recientes, que sí lo traen.
async function centrosDeCosto(tk: string) {
  const centros = lista(await xubio(tk, '/centroDeCostoBean')).map((c: any) => ({ id: idDe(c), nombre: nombre(c) }));
  if (centros.every((c) => c.id != null)) return centros;
  const hoy = new Date();
  const facturas = lista(await xubio(tk, `/comprobanteCompraBean?fechaDesde=${fechaIso(new Date(hoy.getTime() - 120 * 864e5))}&fechaHasta=${fechaIso(hoy)}`));
  const ids = new Map<string, number>();
  for (const f of facturas.slice(-20)) {
    const id = f.transaccionid ?? f.transaccionId;
    const detalle = lista(f.transaccionProductoItems).length ? f : lista(await xubio(tk, `/comprobanteCompraBean/${id}`).catch(() => null))[0];
    for (const i of lista(detalle?.transaccionProductoItems)) {
      const c = i.centroDeCosto;
      if (c && nombre(c) && idDe(c) != null) ids.set(nombre(c), idDe(c));
    }
    if (centros.every((c) => c.id != null || ids.has(c.nombre))) break;
  }
  return centros.map((c) => ({ ...c, id: c.id ?? ids.get(c.nombre) ?? null }));
}

async function opcionesVentas() {
  const tk = await token();
  const [clientes, productos, puntos, centros] = await Promise.all([
    xubio(tk, '/clienteBean'), xubio(tk, '/ProductoVentaBean'), xubio(tk, '/puntoVentaBean'), centrosDeCosto(tk),
  ]);
  return {
    clientes: lista(clientes).map((c: any) => ({ id: c.cliente_id ?? c.id, nombre: c.razonSocial || c.nombre, cuit: c.identificacionTributaria?.numero ?? c.cuit ?? null })),
    productos: lista(productos).filter((p: any) => p.activo !== false).map((p: any) => ({ id: p.productoid ?? p.id, nombre: p.nombre, codigo: p.codigo ?? null })),
    puntosDeVenta: lista(puntos).map((p: any) => ({ id: p.puntoVentaId ?? p.id, nombre: `${p.nombre}${p.puntoVenta ? ` (${p.puntoVenta})` : ''}` })),
    centrosDeCosto: centros.filter((c) => c.id != null),
  };
}

async function configVentas() {
  const { data } = await db.from('referencias').select('valor').eq('clave', 'xubio_ventas').maybeSingle();
  const cfg = data?.valor ?? {};
  const faltan = ['cliente', 'puntoVenta', 'centroDeCosto'].filter((k) => !cfg[k]?.id);
  return { cfg, faltan };
}

// Un renglón por ítem facturado de la proforma, con cantidad 1 y el importe del ítem con IVA: así el
// total coincide exacto con la proforma. El cálculo (meses equivalentes × precio) va en la descripción.
function cuerpoPresupuesto(pf: any, cfg: any) {
  const d = pf.datos;
  const cert = d.certificacion;
  const iva = Number(d.iva ?? 0.21);
  const renglon = (codigoProducto: string, importe: number, descripcion: string) => {
    const producto = cfg.productos?.[codigoProducto];
    if (!producto?.id) throw new Error(`Falta elegir el producto de venta para el ítem ${codigoProducto}`);
    const conIva = Math.round(importe * (1 + iva) * 100) / 100;
    return {
      producto: selector(producto),
      centroDeCosto: selector(cfg.centroDeCosto),
      descripcion,
      cantidad: 1,
      precio: conIva,
      precioconivaincluido: conIva,
      importe,
      total: conIva,
    };
  };
  const renglones = cert.items.filter((i: any) => Number(i.importe) > 0).flatMap((i: any) => {
    if (i.tipo === 'reembolsable') {
      return [renglon(i.codigo, Number(i.importe), `${i.codigo} · ${i.descripcion} · gastos reembolsables ${Number(i.gasto).toFixed(2)} + fee`)];
    }
    // El servicio (ítem 1) se parte en días completos y días con servicio reducido (factor < 1), cada uno
    // con su producto, para seguir en Xubio cuánto se facturó en cada régimen. El total no cambia.
    const reducidos = i.codigo === ITEM_SERVICIO ? lista(i.porDia).filter((d: any) => d.factor > 0 && d.factor < 1) : [];
    const meses = (dias: any[]) => dias.reduce((s, d) => s + d.factor / (cert.divisor ?? diasMes(d.fecha)), 0);
    const texto = (m: number) => `${m.toFixed(4)} meses equivalentes × ${Number(i.precioMensual).toFixed(2)}`;
    if (!reducidos.length) return [renglon(i.codigo, Number(i.importe), `${i.codigo} · ${i.descripcion} · ${texto(Number(i.mesesEquivalentes))}`)];
    const importeReducido = redondear(reducidos.reduce((s: number, d: any) => s + d.precio * d.factor / (cert.divisor ?? diasMes(d.fecha)), 0));
    const importeCompleto = redondear(Number(i.importe) - importeReducido);
    const mesesReducido = meses(reducidos);
    return [
      ...(importeCompleto > 0 ? [renglon(i.codigo, importeCompleto, `${i.codigo} · ${i.descripcion} · días completos · ${texto(Number(i.mesesEquivalentes) - mesesReducido)}`)] : []),
      renglon(ITEM_SERVICIO_REDUCIDO, importeReducido, `${i.codigo} · ${i.descripcion} · ${reducidos.length} días con servicio reducido · ${texto(mesesReducido)}`),
    ];
  });
  if (!renglones.length) throw new Error('La proforma no tiene ítems con importe');
  const dma = (iso: string) => iso.split('-').reverse().join('/');
  return {
    externalId: pf.id,
    cliente: selector(cfg.cliente),
    puntoVenta: selector(cfg.puntoVenta),
    fecha: d.fechaEmision,
    fechaVto: d.calendario?.finRevision ?? d.fechaEmision,
    condicionDePago: 1,
    cotizacion: 1,
    descripcion: `Proforma ${pf.numero} · Servicio CO&C VMOS · período ${dma(cert.periodo.desde)} al ${dma(cert.periodo.hasta)}`,
    transaccionProductoItems: renglones,
  };
}

async function enviarPresupuesto(proformaId: string, email: string | null) {
  const { cfg, faltan } = await configVentas();
  if (faltan.length) throw new Error(`Falta configurar en Xubio: ${faltan.join(', ')}`);
  const { data: pf, error } = await db.from('proformas').select('id, numero, datos, estado').eq('id', proformaId).single();
  if (error || !pf) throw new Error('No se encontró la proforma');
  if (pf.estado === 'anulada' || pf.estado === 'reemplazada') throw new Error(`La proforma está ${pf.estado}`);
  const cuerpo = cuerpoPresupuesto(pf, cfg);
  const tk = await token();
  // Si ya se envió, se actualiza el mismo presupuesto en vez de crear otro.
  const { data: previo } = await db.from('xubio_presupuestos').select('*').eq('proforma_id', proformaId).maybeSingle();
  const res = previo
    ? await xubio(tk, `/presupuestoBean/${previo.transaccion_id}`, 'PUT', { ...cuerpo, transaccionid: previo.transaccion_id })
    : await xubio(tk, '/presupuestoBean', 'POST', cuerpo);
  const p = lista(res)[0] ?? {};
  const fila = {
    proforma_id: proformaId,
    transaccion_id: p.transaccionid ?? previo?.transaccion_id,
    numero: p.numeroDocumento ?? previo?.numero ?? '',
    total: p.importetotal ?? null,
    estado: 'pendiente',
    enviado_por: email,
    actualizado_at: new Date().toISOString(),
  };
  if (!fila.transaccion_id) throw new Error('Xubio no devolvió el número de transacción del presupuesto');
  const { error: e2 } = await db.from('xubio_presupuestos').upsert(fila);
  if (e2) throw e2;
  return { ...fila, totalProforma: pf.datos.total };
}

async function pdfPresupuesto(proformaId: string) {
  const { data: v } = await db.from('xubio_presupuestos').select('transaccion_id, numero').eq('proforma_id', proformaId).maybeSingle();
  if (!v) throw new Error('Esta proforma todavía no se envió a Xubio');
  const tk = await token();
  const errores: string[] = [];
  // El tipo de impresión no está documentado: se prueban los valores habituales.
  for (const tipo of [1, 0, 2]) {
    try {
      const r = lista(await xubio(tk, `/imprimirPDF?idtransaccion=${v.transaccion_id}&tipoimpresion=${tipo}`))[0] ?? {};
      if (!r.urlPdf) continue;
      const pdf = await fetch(r.urlPdf);
      if (!pdf.ok) throw new Error(`descarga ${pdf.status}`);
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { nombre: `Presupuesto Xubio ${v.numero || v.transaccion_id}.pdf`, base64: btoa(bin), tipoimpresion: tipo };
    } catch (e) {
      errores.push(`tipo ${tipo}: ${(e as Error).message}`);
    }
  }
  throw new Error(`Xubio no devolvió el PDF (${errores.join(' · ') || 'sin URL'})`);
}

async function estadoPresupuesto(proformaId: string, estado: string) {
  const codigo = ESTADOS_PRESUPUESTO[estado];
  if (!codigo) throw new Error(`Estado desconocido: ${estado}`);
  const { data: v } = await db.from('xubio_presupuestos').select('transaccion_id').eq('proforma_id', proformaId).maybeSingle();
  if (!v) return { sinPresupuesto: true };
  const tk = await token();
  await xubio(tk, `/presupuestoBean/${v.transaccion_id}/estado`, 'PUT', { ID: codigo, id: codigo });
  await db.from('xubio_presupuestos').update({ estado, actualizado_at: new Date().toISOString() }).eq('proforma_id', proformaId);
  return { estado };
}

// ─── Alta del cliente y los productos de venta ──────────────────────────────────────────────────
// La razón social y el CUIT viven en referencias.xubio_ventas.alta (no en el repo). Los campos
// contables (categoría fiscal, cuentas, IVA, unidad) se copian de un cliente y un producto que ya
// existen en Xubio, para que queden igual que los que carga administración.
const soloDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const codigoProducto = (item: string) => `VMOS-${item.toUpperCase()}`;
const CAMPOS_PRODUCTO = ['unidadMedida', 'categoria', 'tasaIva', 'cuentaContable', 'catFormIVA2002', 'actividadEconomica', 'tipoOperacionIvaSimple', 'noObjetoImpuesto', 'sincronizaStock', 'stockNegativo'];
const CAMPOS_CLIENTE = ['categoriaFiscal', 'identificacionTributaria', 'tipoDeOrganizacion', 'responsabilidadOrganizacionItem', 'cuentaVenta_id', 'cuentaCompra_id', 'pais', 'provincia', 'listaPrecioVenta', 'esclienteextranjero', 'esProveedor'];
const elegirCampos = (x: any, campos: string[]) => Object.fromEntries(campos.filter((k) => x?.[k] != null).map((k) => [k, x[k]]));

// El modelo más reciente que cumpla la condición (se trae el detalle de a uno, de atrás para adelante).
async function plantilla(tk: string, ruta: string, ids: unknown[], ok: (x: any) => boolean) {
  for (const id of ids.slice(-15).reverse()) {
    const x = lista(await xubio(tk, `${ruta}/${id}`).catch(() => null))[0];
    if (x && ok(x)) return x;
  }
  return null;
}

async function altaVentas(items: { codigo: string; descripcion: string }[], confirmar: boolean, email: string | null, modeloProductoId?: number) {
  const { data } = await db.from('referencias').select('valor').eq('clave', 'xubio_ventas').maybeSingle();
  const cfg = data?.valor ?? {};
  const alta = cfg.alta ?? {};
  if (!alta.razonSocial || soloDigitos(alta.cuit).length !== 11) throw new Error('Falta la razón social o el CUIT del cliente en la configuración');
  if (!items?.length) throw new Error('Faltan los ítems del contrato');
  const tk = await token();
  const [clientes, productos] = await Promise.all([xubio(tk, '/clienteBean'), xubio(tk, '/ProductoVentaBean')]);

  // Cliente: si ya hay uno con ese CUIT, se usa ese.
  const cuit = soloDigitos(alta.cuit);
  const existente = lista(clientes).find((c: any) => soloDigitos(c.cuit ?? c.CUIT ?? c.identificacionTributaria?.numero) === cuit);
  let cliente: any;
  if (existente) {
    cliente = { estado: 'existe', id: existente.cliente_id ?? existente.id, nombre: existente.razonSocial || existente.nombre };
  } else {
    const modelo = await plantilla(tk, '/clienteBean', lista(clientes).map((c: any) => c.cliente_id ?? c.id),
      (c) => /inscripto/i.test(nombre(c.categoriaFiscal) ?? '') && soloDigitos(c.cuit ?? c.CUIT).length === 11);
    if (!modelo) throw new Error('No encontré en Xubio un cliente Responsable Inscripto para copiar los datos contables');
    const cuitGuiones = `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
    cliente = {
      estado: 'a crear',
      modelo: modelo.razonSocial || modelo.nombre,
      cuerpo: {
        ...elegirCampos(modelo, CAMPOS_CLIENTE),
        nombre: alta.razonSocial,
        razonSocial: alta.razonSocial,
        cuit: cuitGuiones,
        CUIT: cuitGuiones,
        email: alta.email ?? '',
        direccion: alta.direccion ?? '',
        descripcion: 'Contrato CO&C · Loading Masters',
      },
    };
  }

  // Productos: uno por ítem del contrato, con código VMOS-<ítem>; si el código ya existe, se usa ese.
  const lp = lista(productos);
  // Xubio no tiene GET de un producto de venta suelto: el modelo sale del listado, que trae todos los campos.
  const iva21 = (p: any) => Number(p.tasaIva?.porcentaje) === 21 || /21/.test(`${p.tasaIva?.nombre ?? ''} ${p.tasaIva?.codigo ?? ''}`);
  // Se puede elegir el modelo; si no, se propone uno con IVA 21 % y cuenta de ventas o servicios.
  const activos = lp.filter((p: any) => p.activo !== 0 && p.activo !== false);
  const ivaTexto = (p: any) => (p.tasaIva?.porcentaje != null ? `${p.tasaIva.porcentaje} %` : nombre(p.tasaIva));
  const modelos = activos.map((p: any) => ({ id: p.productoid ?? p.id, nombre: p.nombre, iva: ivaTexto(p), cuenta: nombre(p.cuentaContable) }));
  const modeloProducto = (modeloProductoId
    ? activos.find((p: any) => String(p.productoid ?? p.id) === String(modeloProductoId))
    : [...activos].reverse().find((p: any) => iva21(p) && /venta|servicio/i.test(nombre(p.cuentaContable) ?? ''))
      ?? [...activos].reverse().find(iva21)) ?? null;
  const ivas = [...new Set(lp.map((p: any) => JSON.stringify(p.tasaIva ?? null)))].slice(0, 5).join(' | ');
  const prods: any[] = items.map((it) => {
    const codigo = codigoProducto(it.codigo);
    const ya = lp.find((p: any) => String(p.codigo ?? '').toUpperCase() === codigo);
    if (ya) return { item: it.codigo, estado: 'existe', id: ya.productoid ?? ya.id, nombre: ya.nombre, codigo };
    if (!modeloProducto) throw new Error(`No encontré en Xubio un producto de venta con IVA 21 % para copiar los datos contables (hay ${lp.length} productos; IVA vistos: ${ivas || 'ninguno'})`);
    return {
      item: it.codigo,
      estado: 'a crear',
      codigo,
      cuerpo: { ...elegirCampos(modeloProducto, CAMPOS_PRODUCTO), nombre: `VMOS ${it.codigo} · ${it.descripcion}`.slice(0, 120), codigo, usrcode: codigo, activo: 1 },
    };
  });

  const resumen = {
    cliente: { estado: cliente.estado, nombre: cliente.nombre ?? alta.razonSocial, cuit: alta.cuit, modelo: cliente.modelo ?? null, categoriaFiscal: nombre(cliente.cuerpo?.categoriaFiscal), cuentaVenta: nombre(cliente.cuerpo?.cuentaVenta_id) },
    productos: prods.map((p) => ({ item: p.item, estado: p.estado, codigo: p.codigo, nombre: p.nombre ?? p.cuerpo?.nombre, iva: p.cuerpo ? ivaTexto(p.cuerpo) : null, cuenta: nombre(p.cuerpo?.cuentaContable) })),
    modeloProducto: modeloProducto?.nombre ?? null,
    modeloProductoId: modeloProducto ? modeloProducto.productoid ?? modeloProducto.id : null,
    modelos,
  };
  if (!confirmar) {
    await db.from('referencias').upsert({ clave: 'xubio_alta_previa', valor: { ...resumen, at: new Date().toISOString(), por: email }, descripcion: 'Última vista previa del alta de VMOS en Xubio' });
    return { previa: true, ...resumen };
  }

  // Crear lo que falta y dejarlo elegido en la configuración de ventas.
  if (cliente.estado === 'a crear') {
    const r = lista(await xubio(tk, '/clienteBean', 'POST', cliente.cuerpo))[0] ?? {};
    cliente = { estado: 'creado', id: r.cliente_id ?? r.id, nombre: r.razonSocial || r.nombre || alta.razonSocial };
    if (!cliente.id) throw new Error('Xubio no devolvió el id del cliente');
  }
  const elegidos: Record<string, { id: number; nombre: string }> = { ...(cfg.productos ?? {}) };
  for (const p of prods) {
    if (p.estado === 'a crear') {
      const r = lista(await xubio(tk, '/ProductoVentaBean', 'POST', p.cuerpo))[0] ?? {};
      p.id = r.productoid ?? r.id;
      p.nombre = r.nombre ?? p.cuerpo.nombre;
      p.estado = 'creado';
      if (!p.id) throw new Error(`Xubio no devolvió el id del producto ${p.codigo}`);
    }
    elegidos[p.item] = { id: p.id, nombre: p.nombre };
  }
  const nuevo = { ...cfg, cliente: { id: cliente.id, nombre: cliente.nombre, cuit: alta.cuit }, productos: elegidos };
  const { error } = await db.from('referencias').update({ valor: nuevo, updated_by: email }).eq('clave', 'xubio_ventas');
  if (error) throw error;
  return { creado: true, cliente, productos: prods.map((p) => ({ item: p.item, estado: p.estado, id: p.id, nombre: p.nombre, codigo: p.codigo })) };
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

    const { data: { user } } = await usuario.auth.getUser();
    const { accion = 'diagnostico', desde, hasta, proformaId, estado, items, confirmar, modeloProductoId } = cuerpo;
    const hoy = new Date();
    const hace90 = new Date(hoy.getTime() - 90 * 864e5);
    if (accion === 'diagnostico') return responder(await diagnostico(desde ?? fechaIso(hace90), hasta ?? fechaIso(hoy)));
    if (accion === 'sincronizar-compras') return responder(await sincronizarCompras(desde, hasta));
    if (accion === 'opciones-ventas') return responder(await opcionesVentas());
    if (accion === 'enviar-presupuesto') return responder(await enviarPresupuesto(proformaId, user?.email ?? null));
    if (accion === 'pdf-presupuesto') return responder(await pdfPresupuesto(proformaId));
    if (accion === 'estado-presupuesto') return responder(await estadoPresupuesto(proformaId, estado));
    if (accion === 'alta-ventas') return responder(await altaVentas(items, confirmar === true, user?.email ?? null, modeloProductoId));
    return responder({ error: `Acción desconocida: ${accion}` }, 400);
  } catch (e) {
    return responder({ error: (e as Error).message }, 500);
  }
});
