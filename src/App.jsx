import { useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from '../assets/isologo-horizontal-azul.png';
import { CONTRATO_VMOS } from './lib/contrato.js';
import { periodoDeCierre } from './lib/certificacion.js';
import { rangoDias, parse, sumarDias, esHabil } from './lib/fechas.js';
import { supabase, DOMINIOS } from './lib/supabase.js';
import { armarProforma, comprimirTramos, expandirTramos } from './proforma/armar.js';
import { renderProforma } from './proforma/plantilla.js';
import * as db from './datos.js';

const MENSUALES = CONTRATO_VMOS.items.filter((i) => i.tipo === 'mensual');
const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ars = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 });
const hora = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const pesos = (x) => `$ ${ars.format(x)}`;
const fecha = (iso) => iso.split('-').reverse().join('/');
const lineas = (texto) => texto.split('\n').map((s) => s.trim()).filter(Boolean);
const finDeMes = (iso) => {
  const d = parse(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

const proximoHabil = (iso) => (esHabil(iso) ? iso : proximoHabil(sumarDias(iso, 1)));

// Propuesta para una facturación nueva: arranca el día siguiente a la última y llega a fin de ese mes.
function propuestaNueva(ultima) {
  const desde = ultima ? sumarDias(ultima.hasta, 1) : new Date().toISOString().slice(0, 10);
  const hasta = finDeMes(desde);
  const mes = parse(hasta).getUTCMonth();
  return {
    nombre: `Facturar ${MESES[mes]}`,
    desde,
    hasta,
    numero: `PF-${hasta.slice(0, 7)}`,
    fechaProforma: proximoHabil(hasta.slice(0, 8) + '20'), // día 20 del mes, o el hábil siguiente
    fechaFactura: '',
    factores: {},
    reembolsables: { '1d': 0 },
    observaciones: '',
  };
}

// El JSON de archivo usa tramos (igual que certificaciones/*.json); la app trabaja por día.
function aArchivo(carga, feriados) {
  const { nombre, desde, hasta, numero, fechaProforma, fechaFactura, factores, reembolsables, observaciones } = carga;
  const tramos = Object.fromEntries(
    Object.entries(factores).map(([c, f]) => [c, comprimirTramos(f, { desde, hasta })]).filter(([, t]) => t.length),
  );
  return {
    nombre, desde, hasta, numero, fechaProforma, ...(fechaFactura ? { fechaFactura } : {}),
    tramos, reembolsables, feriados, observaciones: lineas(observaciones),
  };
}
function desdeArchivo(json, actual) {
  const periodo = json.desde ? { desde: json.desde, hasta: json.hasta } : json.cierre ? periodoDeCierre(json.cierre) : actual;
  return {
    ...actual,
    nombre: json.nombre ?? actual.nombre,
    desde: periodo.desde,
    hasta: periodo.hasta,
    numero: json.numero ?? actual.numero,
    fechaProforma: json.fechaProforma ?? json.fechaEmision ?? actual.fechaProforma,
    fechaFactura: json.fechaFactura ?? '',
    reembolsables: json.reembolsables ?? actual.reembolsables,
    factores: Object.fromEntries(Object.entries(json.tramos ?? {}).map(([c, t]) => [c, expandirTramos(t)])),
    observaciones: (json.observaciones ?? []).join('\n'),
  };
}

export default function App() {
  const [sesion, setSesion] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <div className="app">
      <header className="barra">
        <img src={logoUrl} alt="TERRAMARE" />
        <div className="barra-titulo">
          <div className="overline">Loading Masters</div>
          <div>Certificación de servicios · {CONTRATO_VMOS.cliente}</div>
        </div>
        {sesion && (
          <div className="usuario">
            <span>{sesion.user.email}</span>
            <button className="terciario" onClick={() => supabase.auth.signOut()}>Salir</button>
          </div>
        )}
      </header>
      {sesion === undefined ? null : sesion ? <Certificacion /> : <Ingreso />}
    </div>
  );
}

function Ingreso() {
  const [modo, setModo] = useState('entrar');
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setAviso(null);
    const dominio = email.split('@')[1]?.toLowerCase();
    if (!DOMINIOS.includes(dominio)) {
      setAviso({ error: true, texto: `Solo pueden ingresar cuentas @${DOMINIOS.join(', @')}.` });
      return;
    }
    setEnviando(true);
    const r = modo === 'entrar'
      ? await supabase.auth.signInWithPassword({ email, password: clave })
      : await supabase.auth.signUp({ email, password: clave, options: { emailRedirectTo: window.location.origin } });
    setEnviando(false);
    if (r.error) {
      setAviso({ error: true, texto: r.error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos.' : r.error.message });
    } else if (modo === 'crear') {
      setAviso({ texto: `Te enviamos un email a ${email} para confirmar la cuenta. Después ingresá desde acá.` });
      setModo('entrar');
    }
  }

  return (
    <main className="ingreso">
      <h1>{modo === 'entrar' ? 'Ingresar.' : 'Crear cuenta.'}</h1>
      <div className="filete" />
      <form onSubmit={enviar}>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Contraseña{modo === 'crear' && ' (mínimo 10 caracteres)'}
          <input type="password" autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} required
            minLength={modo === 'crear' ? 10 : undefined} value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        <button disabled={enviando}>{modo === 'entrar' ? 'Ingresar' : 'Crear cuenta'}</button>
      </form>
      {aviso && <p className={aviso.error ? 'aviso error' : 'aviso'}>{aviso.texto}</p>}
      <button className="terciario" onClick={() => { setModo(modo === 'entrar' ? 'crear' : 'entrar'); setAviso(null); }}>
        {modo === 'entrar' ? 'No tengo cuenta: crear una' : 'Ya tengo cuenta: ingresar'}
      </button>
    </main>
  );
}

function Certificacion() {
  const [lista, setLista] = useState(null);
  const [seleccion, setSeleccion] = useState(null);
  const [nueva, setNueva] = useState(null);
  const [error, setError] = useState('');

  async function recargarLista(elegir) {
    const filas = await db.listarFacturaciones();
    setLista(filas);
    setSeleccion((actual) => elegir ?? actual ?? filas[0]?.id ?? null);
    if (!filas.length) setNueva(propuestaNueva(null));
  }

  useEffect(() => {
    recargarLista().catch((e) => setError(e.message));
  }, []);

  async function crear(datos) {
    try {
      const creada = await db.crearFacturacion(datos, 0);
      setNueva(null);
      await recargarLista(creada.id);
    } catch (e) {
      setError(e.message);
    }
  }

  if (lista === null) return <main>{error ? <p className="aviso error">Error: {error}</p> : 'Cargando…'}</main>;

  return (
    <main>
      <section className="facturaciones">
        <div className="overline">Facturaciones</div>
        <div className="fila">
          {lista.map((f) => (
            <button key={f.id} type="button" className={`pestana ${f.id === seleccion && !nueva ? 'activa' : ''}`}
              onClick={() => { setNueva(null); setSeleccion(f.id); }}>
              <span>{f.nombre}</span>
              <span className="mono">{fecha(f.desde)} – {fecha(f.hasta)}</span>
            </button>
          ))}
          <button type="button" className="secundario" onClick={() => setNueva(propuestaNueva(lista[0]))}>+ Nueva facturación</button>
        </div>
        {error && <p className="aviso error">Error: {error}</p>}
      </section>

      {nueva
        ? <NuevaFacturacion inicial={nueva} onCrear={crear} onCancelar={lista.length ? () => setNueva(null) : null} />
        : seleccion && <Facturacion key={seleccion} id={seleccion} onCambioResumen={() => recargarLista()} />}
    </main>
  );
}

function NuevaFacturacion({ inicial, onCrear, onCancelar }) {
  const [d, setD] = useState(inicial);
  const set = (c) => setD((x) => ({ ...x, ...c }));
  const valido = d.nombre.trim() && d.desde && d.hasta && d.hasta >= d.desde && d.fechaProforma;
  return (
    <section className="tarjeta nueva">
      <div className="overline">Nueva facturación</div>
      <div className="campos">
        <label className="ancho">Nombre<input value={d.nombre} onChange={(e) => set({ nombre: e.target.value })} /></label>
        <label>Inicio<input type="date" value={d.desde} onChange={(e) => set({ desde: e.target.value })} /></label>
        <label>Fin<input type="date" value={d.hasta} onChange={(e) => set({ hasta: e.target.value })} /></label>
        <label>Envío de proforma<input type="date" value={d.fechaProforma} onChange={(e) => set({ fechaProforma: e.target.value })} /></label>
        <label>Número<input value={d.numero} onChange={(e) => set({ numero: e.target.value })} /></label>
      </div>
      <p className="aviso">La factura se calcula a los {CONTRATO_VMOS.plazos.diasHabilesRevisionProforma} días hábiles del envío de la proforma y el vencimiento a los {CONTRATO_VMOS.plazos.diasPagoFactura} días de la factura; se pueden ajustar después.</p>
      <div className="fila">
        <button type="button" disabled={!valido} onClick={() => onCrear({ ...d, nombre: d.nombre.trim() })}>Crear</button>
        {onCancelar && <button type="button" className="terciario" onClick={onCancelar}>Cancelar</button>}
      </div>
    </section>
  );
}

function Facturacion({ id, onCambioResumen }) {
  const [carga, setCarga] = useState(null);
  const [feriados, setFeriados] = useState([]);
  const [proformas, setProformas] = useState([]);
  // estado del guardado: cargando | guardado | pendiente | guardando | error
  const [estado, setEstado] = useState({ tipo: 'cargando' });
  const cambiosSinGuardar = useRef(false);

  useEffect(() => {
    Promise.all([db.leerFacturacion(id), db.leerFeriados(), db.leerProformas(id)])
      .then(([f, fer, pfs]) => {
        setCarga(f);
        setFeriados(fer);
        setProformas(pfs);
        setEstado({ tipo: 'guardado', ...f.actualizado });
      })
      .catch((e) => setEstado({ tipo: 'error', texto: e.message }));
  }, [id]);

  const periodo = useMemo(() => carga && { desde: carga.desde, hasta: carga.hasta }, [carga?.desde, carga?.hasta]);
  const periodoValido = periodo && periodo.desde && periodo.hasta && periodo.hasta >= periodo.desde;
  const dias = useMemo(() => (periodoValido ? rangoDias(periodo.desde, periodo.hasta) : []), [periodo, periodoValido]);
  const proforma = useMemo(
    () => carga && periodoValido && carga.fechaProforma
      ? armarProforma({ ...carga, feriados, observaciones: lineas(carga.observaciones) })
      : null,
    [carga, feriados, periodoValido],
  );

  // Guardado automático, 800 ms después del último cambio.
  useEffect(() => {
    if (!cambiosSinGuardar.current || !proforma) return;
    setEstado({ tipo: 'pendiente' });
    const t = setTimeout(async () => {
      setEstado({ tipo: 'guardando' });
      try {
        const actualizado = await db.guardarFacturacion(carga, proforma.subtotal);
        cambiosSinGuardar.current = false;
        setEstado({ tipo: 'guardado', ...actualizado });
        onCambioResumen();
      } catch (e) {
        setEstado({ tipo: 'error', texto: e.message });
      }
    }, 800);
    return () => clearTimeout(t);
  }, [carga, proforma?.subtotal]);

  if (!carga) return <EstadoGuardado estado={estado} />;

  const editar = (cambio) => {
    cambiosSinGuardar.current = true;
    setCarga(cambio);
  };
  const set = (cambios) => editar((c) => ({ ...c, ...cambios }));

  function setFactor(codigo, dia, valor) {
    editar((c) => {
      const fila = { ...(c.factores[codigo] ?? {}) };
      if (valor) fila[dia] = valor;
      else delete fila[dia];
      return { ...c, factores: { ...c.factores, [codigo]: fila } };
    });
  }

  async function cambiarFeriado(f, agregar) {
    try {
      if (agregar) await db.agregarFeriado(f);
      else await db.quitarFeriado(f);
      setFeriados(await db.leerFeriados());
    } catch (e) {
      setEstado({ tipo: 'error', texto: e.message });
    }
  }

  // Se registra la emisión (foto de la proforma) antes de imprimir.
  async function emitir() {
    const actualizado = await db.guardarFacturacion(carga, proforma.subtotal);
    cambiosSinGuardar.current = false;
    setEstado({ tipo: 'guardado', ...actualizado });
    const emitida = await db.registrarProforma(carga.id, proforma);
    setProformas((ps) => [emitida, ...ps]);
    imprimir(emitida.datos);
  }

  return (
    <>
      <section className="encabezado">
        <div>
          <h1>{carga.nombre || 'Sin nombre'}.</h1>
          {periodoValido && <div className="periodo mono">{fecha(periodo.desde)} – {fecha(periodo.hasta)} · {dias.length} días</div>}
          <div className="filete" />
        </div>
        <EstadoGuardado estado={estado} />
      </section>

      <section className="tarjeta fechas">
        <div className="campos">
          <label className="ancho">Nombre<input value={carga.nombre} onChange={(e) => set({ nombre: e.target.value })} /></label>
          <label>Número de proforma<input value={carga.numero} onChange={(e) => set({ numero: e.target.value })} /></label>
        </div>
        <div className="campos">
          <label>Inicio<input type="date" value={carga.desde} onChange={(e) => set({ desde: e.target.value })} /></label>
          <label>Fin<input type="date" value={carga.hasta} onChange={(e) => set({ hasta: e.target.value })} /></label>
          <label>Envío de proforma<input type="date" value={carga.fechaProforma} onChange={(e) => set({ fechaProforma: e.target.value })} /></label>
          <label>Fin observaciones VMOS
            <input type="date" value={proforma?.calendario.finRevision ?? ''} readOnly tabIndex={-1} className="calculado" />
          </label>
          <label>Factura {carga.fechaFactura ? '(manual)' : `(+${CONTRATO_VMOS.plazos.diasHabilesRevisionProforma} días hábiles)`}
            <input type="date" value={carga.fechaFactura || proforma?.calendario.factura || ''}
              onChange={(e) => set({ fechaFactura: e.target.value })} />
          </label>
          {carga.fechaFactura && (
            <button type="button" className="terciario" onClick={() => set({ fechaFactura: '' })}>Volver a automática</button>
          )}
          <label>Vencimiento de pago
            <input type="date" value={proforma?.calendario.vencimientoPago ?? ''} readOnly tabIndex={-1} className="calculado" />
          </label>
        </div>
        {!periodoValido && <p className="aviso error">El fin tiene que ser igual o posterior al inicio.</p>}
      </section>

      {periodoValido && proforma && (
        <>
          <Rellenar periodo={periodo} onAplicar={(codigo, desde, hasta, factor) => {
            for (const d of rangoDias(desde, hasta)) setFactor(codigo, d, factor);
          }} />

          <Grilla dias={dias} carga={carga} feriados={feriados} proforma={proforma} setFactor={setFactor} />

          <div className="columnas">
            <section className="tarjeta">
              <div className="overline">Otros datos</div>
              <label>Reembolsables ítem 1d (gastos, sin fee)
                <input type="number" min="0" step="0.01" value={carga.reembolsables['1d'] || ''}
                  onChange={(e) => set({ reembolsables: { '1d': Number(e.target.value) || 0 } })} />
              </label>
              <Feriados feriados={feriados} periodo={periodo} onCambiar={cambiarFeriado} />
              <label>Observaciones (una por línea, salen en la proforma)
                <textarea rows={3} value={carga.observaciones} onChange={(e) => set({ observaciones: e.target.value })} />
              </label>
            </section>

            <Resumen proforma={proforma} />
          </div>

          <Acciones carga={carga} feriados={feriados} onEmitir={emitir}
            onImportar={(json) => editar((c) => desdeArchivo(json, c))}
            onLimpiar={() => editar((c) => ({ ...c, factores: {}, reembolsables: { '1d': 0 }, observaciones: '' }))} />

          <Historial proformas={proformas} />
        </>
      )}
    </>
  );
}

function EstadoGuardado({ estado }) {
  const textos = {
    cargando: 'Cargando…',
    nuevo: 'Mes sin cargar',
    pendiente: 'Cambios sin guardar',
    guardando: 'Guardando…',
    guardado: estado.at && `Guardado ${hora.format(new Date(estado.at))}${estado.por ? ` · ${estado.por}` : ''}`,
    error: `Error: ${estado.texto}`,
  };
  return <div className={`estado ${estado.tipo}`}>{textos[estado.tipo]}</div>;
}

function imprimir(datosProforma) {
  const logo = new URL(logoUrl, window.location.href).href;
  const html = renderProforma(datosProforma, { logo, pie: true });
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  iframe.onload = async () => {
    await iframe.contentDocument.fonts.ready;
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 1000);
  };
  iframe.srcdoc = html;
}

function Rellenar({ periodo, onAplicar }) {
  const [codigo, setCodigo] = useState('1');
  const [desde, setDesde] = useState(periodo.desde);
  const [hasta, setHasta] = useState(periodo.hasta);
  const [factor, setFactor] = useState('1');

  useEffect(() => {
    setDesde(periodo.desde);
    setHasta(periodo.hasta);
  }, [periodo]);

  const valor = Number(String(factor).replace(',', '.'));
  const valido = desde >= periodo.desde && hasta <= periodo.hasta && desde <= hasta && valor >= 0 && valor <= 1;

  return (
    <section className="rellenar">
      <div className="overline">Completar un tramo</div>
      <div className="fila">
        <label>Ítem
          <select value={codigo} onChange={(e) => setCodigo(e.target.value)}>
            {MENSUALES.map((i) => <option key={i.codigo} value={i.codigo}>{i.codigo}</option>)}
          </select>
        </label>
        <label>Desde<input type="date" min={periodo.desde} max={periodo.hasta} value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" min={periodo.desde} max={periodo.hasta} value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label>Factor<input className="corto" value={factor} onChange={(e) => setFactor(e.target.value)} /></label>
        <button disabled={!valido} onClick={() => onAplicar(codigo, desde, hasta, valor)}>Aplicar</button>
      </div>
    </section>
  );
}

function Grilla({ dias, carga, feriados, proforma, setFactor }) {
  return (
    <section className="grilla-marco">
      <table className="grilla">
        <thead>
          <tr>
            <th className="fijo">Ítem</th>
            {dias.map((d) => {
              const dow = parse(d).getUTCDay();
              const libre = dow === 0 || dow === 6 || feriados.includes(d);
              return (
                <th key={d} className={libre ? 'libre' : ''} title={fecha(d)}>
                  <div className="dow">{DOW[dow]}</div>
                  <div className="mono">{d.slice(8)}</div>
                  {d === dias[0] || d.endsWith('-01') ? <div className="mes">{MESES[parse(d).getUTCMonth()].slice(0, 3)}</div> : <div className="mes">&nbsp;</div>}
                </th>
              );
            })}
            <th className="tot">Días</th>
          </tr>
        </thead>
        <tbody>
          {MENSUALES.map((item) => {
            const calc = proforma.certificacion.items.find((i) => i.codigo === item.codigo);
            return (
              <tr key={item.codigo}>
                <th className="fijo" title={item.descripcion}>
                  <span className="cod">{item.codigo}</span> <span className="desc">{item.descripcion}</span>
                </th>
                {dias.map((d) => (
                  <td key={d}>
                    <Celda valor={carga.factores[item.codigo]?.[d] ?? 0} onChange={(v) => setFactor(item.codigo, d, v)} />
                  </td>
                ))}
                <td className="tot mono">{num.format(calc.diasEquivalentes)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// Celda editable: acepta coma o punto, entre 0 y 1. Vacío = 0.
function Celda({ valor, onChange }) {
  const [texto, setTexto] = useState(valor ? num.format(valor) : '');
  const [error, setError] = useState(false);
  const enFoco = useRef(false);

  useEffect(() => {
    if (!enFoco.current) setTexto(valor ? num.format(valor) : '');
  }, [valor]);

  function confirmar() {
    enFoco.current = false;
    const t = texto.trim().replace(',', '.');
    const v = t === '' ? 0 : Number(t);
    if (Number.isNaN(v) || v < 0 || v > 1) {
      setError(true);
      return;
    }
    setError(false);
    onChange(v);
    setTexto(v ? num.format(v) : '');
  }

  return (
    <input className={`celda ${valor ? 'con' : ''} ${error ? 'error' : ''}`} value={texto} inputMode="decimal"
      onFocus={(e) => { enFoco.current = true; e.target.select(); }}
      onChange={(e) => setTexto(e.target.value)} onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

// Los feriados son compartidos entre meses; se muestran los que pueden afectar a este período.
function Feriados({ feriados, periodo, onCambiar }) {
  const [nuevo, setNuevo] = useState('');
  const visibles = feriados.filter((f) => f >= periodo.desde);
  return (
    <div className="feriados">
      <span className="etiqueta">Feriados (corren el plazo de revisión de VMOS; valen para todos los meses)</span>
      <div className="fila">
        <input type="date" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        <button type="button" className="secundario" disabled={!nuevo || feriados.includes(nuevo)}
          onClick={() => { onCambiar(nuevo, true); setNuevo(''); }}>Agregar</button>
      </div>
      <div className="chips">
        {visibles.map((f) => (
          <button type="button" key={f} className="chip" onClick={() => onCambiar(f, false)} title="Quitar">
            {fecha(f)} ×
          </button>
        ))}
      </div>
    </div>
  );
}

function Resumen({ proforma: p }) {
  const cal = p.calendario;
  return (
    <section className="tarjeta resumen">
      <div className="overline">Resumen</div>
      <table>
        <thead><tr><th>Ítem</th><th className="n">Días equiv.</th><th className="n">Importe</th></tr></thead>
        <tbody>
          {p.certificacion.items.map((i) => (
            <tr key={i.codigo} className={i.importe ? '' : 'inactivo'}>
              <td className="mono cod">{i.codigo}</td>
              <td className="n mono">{i.tipo === 'mensual' ? num.format(i.diasEquivalentes) : '—'}</td>
              <td className="n mono">{pesos(i.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totales">
        <div><span>Neto</span><span className="mono">{pesos(p.subtotal)}</span></div>
        <div><span>IVA 21 %</span><span className="mono">{pesos(p.ivaImporte)}</span></div>
        <div className="total"><span>Total {p.moneda}</span><span className="mono">{pesos(p.total)}</span></div>
      </div>
      <div className="calendario">
        <div><span className="mono">{fecha(cal.envioProforma)}</span> envío de proforma</div>
        <div><span className="mono">{fecha(cal.finRevision)}</span> fin de observaciones</div>
        <div><span className="mono">{fecha(cal.factura)}</span> factura</div>
        <div><span className="mono">{fecha(cal.vencimientoPago)}</span> vencimiento de pago</div>
      </div>
    </section>
  );
}

function Acciones({ carga, feriados, onEmitir, onImportar, onLimpiar }) {
  const archivo = useRef(null);
  const [aviso, setAviso] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);

  async function emitirPdf() {
    setEmitiendo(true);
    try {
      await onEmitir();
      setAviso('Emisión registrada. En el diálogo de impresión elegí "Guardar como PDF" y desmarcá "Encabezados y pies de página".');
    } catch (e) {
      setAviso(`No se pudo emitir: ${e.message}`);
    } finally {
      setEmitiendo(false);
    }
  }

  function descargarJson() {
    const blob = new Blob([JSON.stringify(aArchivo(carga, feriados), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${carga.numero || carga.nombre}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importar(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (!json.desde && !json.cierre) throw new Error('falta "desde"/"hasta"');
      if (!confirm(`¿Reemplazar la carga de "${carga.nombre}" con ${f.name}?`)) return;
      onImportar(json);
      setAviso(`Importado ${f.name}.`);
    } catch (err) {
      setAviso(`No se pudo importar ${f.name}: ${err.message}`);
    }
  }

  return (
    <section className="acciones">
      <button type="button" onClick={emitirPdf} disabled={emitiendo}>{emitiendo ? 'Emitiendo…' : 'Emitir proforma PDF'}</button>
      <button type="button" className="secundario" onClick={descargarJson}>Descargar JSON</button>
      <button type="button" className="secundario" onClick={() => archivo.current.click()}>Importar JSON</button>
      <input ref={archivo} type="file" accept="application/json,.json" hidden onChange={importar} />
      <button type="button" className="terciario" onClick={() => { if (confirm('¿Borrar los factores, reembolsables y observaciones de esta facturación?')) onLimpiar(); }}>Limpiar carga</button>
      {aviso && <span className="aviso">{aviso}</span>}
    </section>
  );
}

// Proformas emitidas de este mes: cada una se reimprime tal cual se envió.
function Historial({ proformas }) {
  if (!proformas.length) return null;
  return (
    <section className="historial">
      <div className="overline">Proformas emitidas</div>
      <table>
        <thead><tr><th>Emitida</th><th>Número</th><th>Por</th><th className="n">Total</th><th /></tr></thead>
        <tbody>
          {proformas.map((p) => (
            <tr key={p.id}>
              <td className="mono">{hora.format(new Date(p.emitida_at))}</td>
              <td className="mono">{p.numero}</td>
              <td>{p.emitida_por}</td>
              <td className="n mono">{pesos(Number(p.total))}</td>
              <td className="n"><button type="button" className="secundario chico" onClick={() => imprimir(p.datos)}>Reimprimir</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
