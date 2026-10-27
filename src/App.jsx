import { useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from '../assets/isologo-horizontal-azul.png';
import { CONTRATO_VMOS } from './lib/contrato.js';
import { periodoDeCierre } from './lib/certificacion.js';
import { ventanasDelPeriodo, estadoVentana, evaluarVentana, factorAjuste } from './lib/ajuste.js';
import { rangoDias, parse, sumarDias, esHabil } from './lib/fechas.js';
import { supabase, DOMINIOS } from './lib/supabase.js';
import { armarProforma, comprimirTramos, expandirTramos } from './proforma/armar.js';
import { renderProforma } from './proforma/plantilla.js';
import * as db from './datos.js';
import { calcularResultado, completarEscenario, CLAVES_ESCENARIOS } from './lib/resultado.js';

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
  const [vista, setVista] = useState('inicio');
  return (
    <>
      <nav className="vistas">
        {[['inicio', 'Inicio'], ['facturaciones', 'Facturación'], ['formula', 'Fórmula de ajuste'], ['resultado', 'Resultado']].map(([id, n]) => (
          <button key={id} type="button" className={`vista ${vista === id ? 'activa' : ''}`} onClick={() => setVista(id)}>{n}</button>
        ))}
      </nav>
      {vista === 'inicio' && <Inicio onAbrir={setVista} />}
      {vista === 'facturaciones' && <Facturaciones />}
      {vista === 'formula' && <main><SeguimientoFormula /></main>}
      {vista === 'resultado' && <Resultado />}
    </>
  );
}

function Facturaciones() {
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
  const [ajustes, setAjustes] = useState([]);
  // estado del guardado: cargando | guardado | pendiente | guardando | error
  const [estado, setEstado] = useState({ tipo: 'cargando' });
  const cambiosSinGuardar = useRef(false);

  useEffect(() => {
    Promise.all([db.leerFacturacion(id), db.leerFeriados(), db.leerProformas(id), db.leerAjustes()])
      .then(([f, fer, pfs, ajs]) => {
        setCarga(f);
        setFeriados(fer);
        setProformas(pfs);
        setAjustes(ajs);
        setEstado({ tipo: 'guardado', ...f.actualizado });
      })
      .catch((e) => setEstado({ tipo: 'error', texto: e.message }));
  }, [id]);

  const periodo = useMemo(() => carga && { desde: carga.desde, hasta: carga.hasta }, [carga?.desde, carga?.hasta]);
  const periodoValido = periodo && periodo.desde && periodo.hasta && periodo.hasta >= periodo.desde;
  const dias = useMemo(() => (periodoValido ? rangoDias(periodo.desde, periodo.hasta) : []), [periodo, periodoValido]);
  const proforma = useMemo(
    () => carga && periodoValido && carga.fechaProforma
      ? armarProforma({
        ...carga, feriados, observaciones: lineas(carga.observaciones),
        ajustes: ajustes.filter((a) => a.estado === 'aprobado'),
      })
      : null,
    [carga, feriados, ajustes, periodoValido],
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
        <div className="estado-lado">
          <EstadoGuardado estado={estado} />
          {(() => {
            const enviada = proformas.find((p) => p.estado === 'enviada');
            return enviada
              ? <div className="enviada-resumen">Enviada a VMOS: <span className="mono">{enviada.numero}</span> el {fecha(enviada.enviada_el)}</div>
              : <div className="enviada-resumen pendiente">Proforma todavía no enviada a VMOS</div>;
          })()}
        </div>
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

          <AjustePrecios periodo={periodo} ajustes={ajustes} onCambioAjustes={async () => setAjustes(await db.leerAjustes())} />

          <Acciones carga={carga} feriados={feriados} onEmitir={emitir}
            onImportar={(json) => editar((c) => desdeArchivo(json, c))}
            onLimpiar={() => editar((c) => ({ ...c, factores: {}, reembolsables: { '1d': 0 }, observaciones: '' }))} />

          <Historial proformas={proformas} onCambio={async () => {
            const [pfs, f] = await Promise.all([db.leerProformas(id), db.leerFacturacion(id)]);
            setProformas(pfs);
            // la fecha de envío pudo mover la fecha de proforma (ya guardada en la base)
            setCarga((c) => ({ ...c, fechaProforma: f.fechaProforma }));
          }} />
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
      {p.ajustesAplicados.length > 0 && (
        <div className="ajustes-aplicados">
          {p.ajustesAplicados.map((a) => (
            <div key={a.mes}>Precios ajustados (Anexo II) desde {fecha(a.rigeDesde)} · factor {dec(a.factor, 4)}</div>
          ))}
        </div>
      )}
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
const ESTADO_PROFORMA = { emitida: 'Emitida', enviada: 'Enviada a VMOS', reemplazada: 'Reemplazada', anulada: 'Anulada' };

// Proformas emitidas de esta facturación. Cada una se reimprime tal cual se generó; se marca cuál se
// mandó a VMOS (una sola; la anterior queda como reemplazada) o se anula con motivo. No se borran.
function Historial({ proformas, onCambio }) {
  const [verAnuladas, setVerAnuladas] = useState(false);
  const [enviando, setEnviando] = useState(null); // id de la que se está marcando como enviada
  const [fechaEnvio, setFechaEnvio] = useState(hoyIso());
  const [error, setError] = useState('');
  if (!proformas.length) return null;

  const anuladas = proformas.filter((p) => p.estado === 'anulada');
  const visibles = verAnuladas ? proformas : proformas.filter((p) => p.estado !== 'anulada');
  const emitidaEl = (id) => {
    const p = proformas.find((x) => x.id === id);
    return p ? `la emitida el ${hora.format(new Date(p.emitida_at))}` : 'otra';
  };

  async function accion(fn) {
    setError('');
    try {
      await fn();
      setEnviando(null);
      await onCambio();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section className="historial">
      <div className="overline">Proformas emitidas</div>
      <div className="tabla-scroll">
      <table>
        <thead><tr><th>Emitida</th><th>Número</th><th>Por</th><th className="n">Total</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {visibles.map((p) => (
            <tr key={p.id} className={`proforma-${p.estado}`}>
              <td className="mono">{hora.format(new Date(p.emitida_at))}</td>
              <td className="mono">{p.numero}</td>
              <td>{p.emitida_por}</td>
              <td className="n mono">{pesos(Number(p.total))}</td>
              <td>
                <span className={`chip proforma-chip-${p.estado}`}>{ESTADO_PROFORMA[p.estado]}</span>
                <span className="ayuda">
                  {p.estado === 'enviada' && ` el ${fecha(p.enviada_el)}`}
                  {p.estado === 'reemplazada' && ` (enviada el ${fecha(p.enviada_el)}, reemplazada por ${emitidaEl(p.reemplazada_por)})`}
                  {p.estado === 'anulada' && ` · ${p.motivo_anulacion}`}
                </span>
              </td>
              <td className="n acciones-proforma">
                {p.estado === 'emitida' && enviando === p.id ? (
                  <>
                    <input type="date" value={fechaEnvio} max={hoyIso()} onChange={(e) => setFechaEnvio(e.target.value)} />
                    <button type="button" className="chico" disabled={!fechaEnvio}
                      onClick={() => accion(() => db.marcarProformaEnviada(p.id, fechaEnvio))}>Confirmar envío</button>
                    <button type="button" className="terciario chico" onClick={() => setEnviando(null)}>Cancelar</button>
                  </>
                ) : p.estado === 'emitida' ? (
                  <>
                    <button type="button" className="chico" onClick={() => { setFechaEnvio(hoyIso()); setEnviando(p.id); }}>Marcar enviada</button>
                    <button type="button" className="terciario chico" onClick={() => {
                      const motivo = prompt('Motivo de la anulación (por ejemplo: prueba, error en días):');
                      if (motivo && motivo.trim()) accion(() => db.anularProforma(p.id, motivo.trim()));
                    }}>Anular</button>
                  </>
                ) : null}
                <button type="button" className="secundario chico" onClick={() => imprimir(p.datos)}>Reimprimir</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {anuladas.length > 0 && (
        <button type="button" className="terciario chico" onClick={() => setVerAnuladas((v) => !v)}>
          {verAnuladas ? 'Ocultar anuladas' : `Ver anuladas (${anuladas.length})`}
        </button>
      )}
      <p className="aviso">
        Al marcar una como enviada, su fecha de envío pasa a ser la fecha de proforma de la facturación y desde ahí se
        calculan el plazo de VMOS, la factura y el vencimiento. Las proformas no se borran: las de prueba se anulan.
      </p>
      {error && <p className="aviso error">Error: {error}</p>}
    </section>
  );
}

// ─── Ajuste de precios (Anexo II) ────────────────────────────────────────────
// Cada facturación muestra las ventanas de pedido (días 1 a 10) que caen en su período, evalúa la
// fórmula contra la base vigente y permite registrar el pedido y lo que resuelva VMOS.

const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nombreMes = (mes) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
const mesMenos = (mes, n) => {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
};
const pctSigno = (x) => {
  const v = Math.round(x * 10000) / 100 || 0; // || 0 evita "-0,00"
  return `${v >= 0 ? '+' : ''}${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
};
const variacion = (x) => (x === null || x === undefined ? '—' : pctSigno(x));
const dec = (x, n = 2) => x.toLocaleString('es-AR', { minimumFractionDigits: n, maximumFractionDigits: n });
// De qué fecha y fuente es cada valor de la fórmula (se muestra al pasar el mouse).
function origenBase(base, k) {
  if (base.origen === 'contrato') return CONTRATO_VMOS.ajuste.fechasBase[k];
  return {
    mo: `Básico Capitán de Ultramar de ${nombreMes(base.mes)} (del ajuste aprobado en esa ventana)`,
    ipc: `IPC Nivel General Nacional de ${nombreMes(mesMenos(base.mes, 2))} (n-2 del ajuste de ${nombreMes(base.mes)})`,
    usd: `Dólar BNA divisa vendedor del primer día hábil de ${nombreMes(base.mes)} (del ajuste aprobado)`,
  }[k];
}
function origenActual(mes, k, ipc, usd) {
  return {
    mo: `Básico Capitán de Ultramar de ${nombreMes(mes)}, cargado a mano`,
    ipc: ipc
      ? `IPC Nivel General Nacional de ${nombreMes(ipc.mes)}, ${ipc.fuente ?? 'INDEC'} (n-2 de ${nombreMes(mes)})`
      : `IPC Nivel General Nacional de ${nombreMes(mesMenos(mes, 2))} (n-2): todavía no publicado`,
    usd: usd
      ? `Dólar BNA divisa vendedor del ${fecha(usd.fecha)}, primer día hábil de ${nombreMes(mes)} (vía BCRA)`
      : `Dólar BNA divisa vendedor del primer día hábil de ${nombreMes(mes)}: todavía no disponible`,
  }[k];
}

const ESTADO_VENTANA = { abierta: 'Abierta hoy', cerrada: 'Cerrada', futura: 'Próxima' };
const ESTADO_PEDIDO = { solicitado: 'Pedido enviado', aprobado: 'Aprobado por VMOS', rechazado: 'Rechazado por VMOS' };

function AjustePrecios({ periodo, ajustes, onCambioAjustes }) {
  const ventanas = useMemo(() => ventanasDelPeriodo(periodo), [periodo]);
  const aprobados = ajustes.filter((a) => a.estado === 'aprobado');
  const [sync, setSync] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    db.ultimaSincronizacion().then(setSync).catch(() => setSync(null));
  }, [version]);

  async function sincronizar() {
    setSincronizando(true);
    try {
      await db.sincronizarAhora();
    } catch {
      // el resultado (bien o mal) queda registrado en la última sincronización
    }
    setSincronizando(false);
    setVersion((v) => v + 1);
  }

  return (
    <section className="ajuste">
      <div className="overline">Ajuste de precios · Anexo II</div>
      <p className="aviso">
        P1 = P0 × (70 % MO1/MO0 + 20 % IPC1/IPC0 + 10 % USD1/USD0). La revisión se pide del 1 al 10 del mes y, si VMOS
        la acepta, rige desde el 1 del mes siguiente. Se puede pedir si el IPC o el dólar acumulan más de 15 %, si hay un
        acuerdo gremial avalado por VMOS o si pasaron 6 meses desde la última actualización.
      </p>
      <div className="fila sync">
        <span className="aviso">
          IPC (INDEC, vía datos.gob.ar) y dólar BNA divisa vendedor (vía BCRA) se descargan solos a las 9 y a las 18 h.
          {sync && ` Última actualización: ${hora.format(new Date(sync.at))}${sync.ok ? '' : ' (con errores)'}${
            sync.detalle?.ipc?.ultimo ? ` · último IPC ${nombreMes(sync.detalle.ipc.ultimo.mes)}` : ''}${
            sync.detalle?.usd?.ultimo ? ` · último dólar ${fecha(sync.detalle.usd.ultimo.fecha)}` : ''}.`}
        </span>
        <button type="button" className="secundario chico" disabled={sincronizando} onClick={sincronizar}>
          {sincronizando ? 'Actualizando…' : 'Actualizar ahora'}
        </button>
      </div>
      {ventanas.length === 0
        ? <p className="aviso">Esta facturación no incluye ningún día 1 a 10: no tiene ventana de pedido.</p>
        : ventanas.map((v) => (
          <VentanaAjuste key={`${v.mes}-${version}`} ventana={v} aprobados={aprobados}
            pedido={ajustes.find((a) => a.mes === v.mes)} onCambioAjustes={onCambioAjustes} />
        ))}
    </section>
  );
}

function VentanaAjuste({ ventana, aprobados, pedido, onCambioAjustes }) {
  const [indices, setIndices] = useState(null);
  const [error, setError] = useState('');
  const sinGuardar = useRef(false);
  const hoy = hoyIso();
  const estado = estadoVentana(ventana, hoy);
  const [fechaPedido, setFechaPedido] = useState(estado === 'abierta' ? hoy : ventana.desde);
  const [fechaResolucion, setFechaResolucion] = useState(hoy);
  const [series, setSeries] = useState(null);
  const mesIpc = mesMenos(ventana.mes, 2);

  // IPC1 y USD1 salen de las series oficiales; si cambian (o recién se publican), se guardan solos.
  useEffect(() => {
    Promise.all([db.leerIndices([ventana.mes]), db.leerSeriesDeVentana(ventana.mes, mesIpc)])
      .then(([r, s]) => {
        const guardados = r[ventana.mes] ?? { mo: null, ipc: null, usd: null, paritaria: false };
        const completos = { ...guardados, ipc: s.ipc?.valor ?? guardados.ipc, usd: s.usd?.valor ?? guardados.usd };
        if (!pedido && (completos.ipc !== guardados.ipc || completos.usd !== guardados.usd)) sinGuardar.current = true;
        setSeries(s);
        setIndices(pedido ? guardados : completos);
      })
      .catch((e) => setError(e.message));
  }, [ventana.mes]);

  useEffect(() => {
    if (!sinGuardar.current || !indices) return;
    const t = setTimeout(() => {
      db.guardarIndices(ventana.mes, indices).then(() => { sinGuardar.current = false; }).catch((e) => setError(e.message));
    }, 800);
    return () => clearTimeout(t);
  }, [indices]);

  if (!indices) return <div className="ventana">{error ? `Error: ${error}` : 'Cargando índices…'}</div>;

  // Un pedido ya registrado queda congelado con los índices y la base que se usaron.
  const usados = pedido ? { ...pedido.indices, paritaria: pedido.motivos.includes('paritaria') } : indices;
  const ev = evaluarVentana({
    mes: ventana.mes, indices: usados, paritaria: usados.paritaria,
    aprobados: aprobados.filter((a) => a.mes !== ventana.mes),
  });
  const set = (k, v) => { sinGuardar.current = true; setIndices((x) => ({ ...x, [k]: v })); };
  const numero = (k, etiqueta, ayuda, automatico) => (
    <label>{etiqueta}
      <input type="number" step="any" min="0" value={indices[k] ?? ''} disabled={!!pedido || !!automatico}
        className={automatico ? 'calculado' : ''}
        onChange={(e) => set(k, e.target.value === '' ? null : Number(e.target.value))} />
      <span className="ayuda">{automatico ? `Automático · ${automatico}` : ayuda}</span>
    </label>
  );

  async function accion(fn) {
    setError('');
    try {
      await fn();
      await onCambioAjustes();
    } catch (e) {
      setError(e.message);
    }
  }

  const disparadoresTabla = [
    ['ipc', 'IPC acumulado mayor a 15 %', variacion(ev.variaciones.ipc)],
    ['usd', 'Dólar acumulado mayor a 15 %', variacion(ev.variaciones.usd)],
    ['paritaria', 'Acuerdo gremial avalado por VMOS', usados.paritaria ? 'Sí' : 'No'],
    ['plazo', '6 meses desde la última actualización', `${ev.mesesDesdeBase} ${ev.mesesDesdeBase === 1 ? 'mes' : 'meses'}`],
  ];
  const fechaPedidoValida = fechaPedido >= ventana.desde && fechaPedido <= ventana.hasta && fechaPedido <= hoy;
  const baseTexto = ev.base.origen === 'contrato' ? `contrato (${nombreMes(ev.base.mes)})` : `ajuste de ${nombreMes(ev.base.mes)}`;

  return (
    <div className="ventana tarjeta">
      <div className="ventana-cabeza">
        <div>
          <div className="ventana-titulo">Ventana {fecha(ventana.desde)} – {fecha(ventana.hasta)}</div>
          <div className="aviso">Base: {baseTexto} · si se aprueba, rige desde {fecha(ventana.rigeDesde)}</div>
        </div>
        <div className="chips">
          <span className={`chip estado-${estado}`}>{ESTADO_VENTANA[estado]}</span>
          {pedido && <span className={`chip pedido-${pedido.estado}`}>{ESTADO_PEDIDO[pedido.estado]}</span>}
        </div>
      </div>

      <div className="campos">
        {numero('mo', 'MO1 · Básico Capitán de Ultramar', `FENA, ${nombreMes(ventana.mes)}`)}
        {numero('ipc', 'IPC1 · INDEC Nivel General',
          `${nombreMes(mesIpc)} (n-2): todavía no publicado, se completa solo cuando salga`,
          series?.ipc && `INDEC, ${nombreMes(series.ipc.mes)} (n-2)`)}
        {numero('usd', 'USD1 · BNA divisa vendedor',
          `primer día hábil de ${nombreMes(ventana.mes)}: todavía no disponible, se completa solo`,
          series?.usd && `BNA vía BCRA, ${fecha(series.usd.fecha)}`)}
        <label className="check">
          <input type="checkbox" checked={!!indices.paritaria} disabled={!!pedido} onChange={(e) => set('paritaria', e.target.checked)} />
          Acuerdo gremial avalado por VMOS
        </label>
      </div>

      <div className="columnas">
        <table className="tabla-ajuste">
          <thead><tr><th>Componente</th><th className="n">Peso</th><th className="n">Base</th><th className="n">Actual</th><th className="n">Variación</th></tr></thead>
          <tbody>
            {[['mo', 'Mano de obra', 70, 2], ['ipc', 'IPC', 20, 1], ['usd', 'Dólar', 10, 2]].map(([k, n, w, d]) => (
              <tr key={k}>
                <td>{n}</td>
                <td className="n mono">{w} %</td>
                <td className="n mono"><span className="con-origen" title={origenBase(ev.base, k)}>{dec(ev.base.indices[k], d)}</span></td>
                <td className="n mono">
                  <span className="con-origen" title={origenActual(ventana.mes, k, series?.ipc, series?.usd)}>{usados[k] ? dec(usados[k], d) : '—'}</span>
                </td>
                <td className="n mono">{variacion(ev.variaciones[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="tabla-ajuste">
          <thead><tr><th>Disparador</th><th className="n">Valor</th><th className="n">¿Se cumple?</th></tr></thead>
          <tbody>
            {disparadoresTabla.map(([k, n, v]) => (
              <tr key={k} className={ev.motivos.includes(k) ? 'cumple' : ''}>
                <td>{n}</td>
                <td className="n mono">{v}</td>
                <td className="n">{ev.motivos.includes(k) ? 'Sí' : (k === 'ipc' || k === 'usd') && ev.variaciones[k] === null ? 'Falta el dato' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ev.completo ? (
        <div className="resultado">
          <div><span className="etiqueta">Factor P1/P0</span> <span className="mono fuerte">{dec(ev.factor, 4)} ({pctSigno(ev.factor - 1)})</span></div>
          <div className="precios-nuevos">
            {Object.entries(ev.precios).map(([c, p]) => (
              <span key={c}><span className="mono cod">{c}</span> {pesos(ev.base.precios[c])} → <span className="mono">{pesos(p)}</span></span>
            ))}
          </div>
        </div>
      ) : (
        <p className="aviso">Cargá los tres índices para calcular el factor.</p>
      )}

      <p className={`conclusion ${ev.habilitado ? 'si' : ''}`}>
        {ev.habilitado
          ? 'Se cumple al menos un disparador: corresponde pedir la revisión en esta ventana.'
          : ev.variaciones.ipc === null || ev.variaciones.usd === null
            ? `Con los datos cargados no se cumple ningún disparador. Falta ${[ev.variaciones.ipc === null && 'el IPC', ev.variaciones.usd === null && 'el dólar'].filter(Boolean).join(' y ')} para terminar de evaluar.`
            : 'No se cumple ningún disparador: no corresponde pedir la revisión en esta ventana.'}
      </p>

      {!pedido && ev.habilitado && ev.completo && (
        <div className="fila">
          <label>Fecha del pedido
            <input type="date" min={ventana.desde} max={ventana.hasta < hoy ? ventana.hasta : hoy} value={fechaPedido}
              onChange={(e) => setFechaPedido(e.target.value)} />
          </label>
          <button type="button" disabled={!fechaPedidoValida} onClick={() => accion(() => db.pedirAjuste(ev, indices, fechaPedido))}>
            Registrar pedido de revisión
          </button>
          {!fechaPedidoValida && (
            <span className="aviso">
              {estado === 'futura' ? 'La ventana todavía no abrió.' : 'El pedido tiene que estar entre el 1 y el 10, y no puede ser una fecha futura.'}
            </span>
          )}
        </div>
      )}

      {pedido && (
        <div className="fila">
          <span className="aviso">
            Pedido del {fecha(pedido.fechaPedido)} por {pedido.creado.por}
            {pedido.fechaResolucion ? ` · resuelto el ${fecha(pedido.fechaResolucion)}` : ''}.
          </span>
          {pedido.estado === 'solicitado' ? (
            <>
              <label>Fecha de respuesta<input type="date" value={fechaResolucion} onChange={(e) => setFechaResolucion(e.target.value)} /></label>
              <button type="button" onClick={() => accion(() => db.resolverAjuste(pedido.id, 'aprobado', fechaResolucion))}>VMOS aprobó</button>
              <button type="button" className="secundario" onClick={() => accion(() => db.resolverAjuste(pedido.id, 'rechazado', fechaResolucion))}>VMOS rechazó</button>
              <button type="button" className="terciario"
                onClick={() => { if (confirm('¿Borrar el pedido registrado?')) accion(() => db.borrarAjuste(pedido.id)); }}>Borrar pedido</button>
            </>
          ) : (
            <button type="button" className="terciario" onClick={() => accion(() => db.resolverAjuste(pedido.id, 'solicitado', null))}>
              Volver a pendiente
            </button>
          )}
        </div>
      )}
      {error && <p className="aviso error">Error: {error}</p>}
    </div>
  );
}

// ─── Fórmula de ajuste: seguimiento mensual (como el Excel "Formula de ajuste") ──
// Una fila por mes de aplicación desde el comienzo de cómputo: básico (a mano), IPC n-2 y dólar del
// primer día hábil (automáticos), aporte de cada componente contra la base vigente e índice resultante.

function SeguimientoFormula() {
  const hoy = hoyIso();
  const meses = useMemo(() => {
    const lista = [];
    const ultimo = mesMenos(hoy.slice(0, 7), -1); // hasta el mes próximo
    for (let m = CONTRATO_VMOS.inicioComputo; m <= ultimo; m = mesMenos(m, -1)) lista.push(m);
    return lista;
  }, [hoy]);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const pendientes = useRef({});

  async function cargar() {
    try {
      const [indices, series, ajustes, historia] = await Promise.all([
        db.leerIndices(meses),
        db.leerSeriesRango(meses, meses.map((m) => mesMenos(m, 2))),
        db.leerAjustes(),
        db.leerReferencia('historia_ajuste').catch(() => null),
      ]);
      setDatos({ indices, series, ajustes, historia });
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => { cargar(); }, [meses]);

  if (!datos) return <section className="seguimiento">{error ? <p className="aviso error">Error: {error}</p> : 'Cargando…'}</section>;

  const aprobados = datos.ajustes.filter((a) => a.estado === 'aprobado');
  const h = datos.historia;
  const factorHistorico = h && factorAjuste(CONTRATO_VMOS.ajuste.base, h.indices);

  function setMo(mes, valor) {
    const actual = datos.indices[mes] ?? { mo: null, ipc: null, usd: null, paritaria: false };
    const nuevo = { ...actual, mo: valor };
    setDatos((d) => ({ ...d, indices: { ...d.indices, [mes]: nuevo } }));
    clearTimeout(pendientes.current[mes]);
    pendientes.current[mes] = setTimeout(() => {
      const s = datos.series;
      db.guardarIndices(mes, { ...nuevo, ipc: s.ipc[mesMenos(mes, 2)]?.valor ?? nuevo.ipc, usd: s.usd[mes]?.valor ?? nuevo.usd })
        .catch((e) => setError(e.message));
    }, 800);
  }

  return (
    <section className="seguimiento">
      <h1>Fórmula de ajuste.</h1>
      <div className="filete" />
      <p className="aviso">
        Índice = 70 % × Básico/Básico base + 20 % × IPC(-2)/IPC base + 10 % × Dólar/Dólar base. Cada mes se compara contra
        la base vigente (la del contrato, oct-26, hasta que VMOS apruebe un ajuste). El IPC y el dólar se completan solos;
        el básico de Capitán de Ultramar se carga a mano.
      </p>

      <div className="tabla-scroll">
        <table className="tabla-seguimiento">
          <thead>
            <tr>
              <th>Mes</th><th className="n">Básico</th><th className="n">IPC (-2)</th><th className="n">Dólar</th>
              <th className="n">MO 70 %</th><th className="n">IPC 20 %</th><th className="n">Dólar 10 %</th>
              <th className="n">Índice</th><th className="n">Var. IPC</th><th className="n">Var. dólar</th>
              <th className="n">Meses</th><th>¿Se puede pedir?</th>
            </tr>
          </thead>
          <tbody>
            {h && <tr className="historia">
              <td>{nombreMes(h.mes)} <span className="ayuda">precios originales</span></td>
              <td className="n mono con-origen" title="Básico Capitán de Ultramar de marzo 2026 (Excel Formula de ajuste)">{dec(h.indices.mo, 0)}</td>
              <td className="n mono con-origen" title="IPC Nivel General Nacional de enero 2026, INDEC (n-2 de marzo)">{dec(h.indices.ipc, 1)}</td>
              <td className="n mono con-origen" title="Dólar BNA divisa vendedor del 02/03/2026, primer día hábil de marzo">{dec(h.indices.usd, 1)}</td>
              <td colSpan={8} className="ayuda">Paso a oct-26: índice {dec(factorHistorico * 100, 1)} % → precios de la oferta</td>
            </tr>}
            {meses.map((mes) => {
              const guardado = datos.indices[mes] ?? {};
              const ipc = datos.series.ipc[mesMenos(mes, 2)];
              const usd = datos.series.usd[mes];
              const pedido = datos.ajustes.find((a) => a.mes === mes);
              const valores = pedido ? pedido.indices : { mo: guardado.mo, ipc: ipc?.valor ?? guardado.ipc, usd: usd?.valor ?? guardado.usd };
              const ev = evaluarVentana({
                mes, indices: valores, paritaria: !!guardado.paritaria,
                aprobados: aprobados.filter((a) => a.mes !== mes),
              });
              const esBase = mes === ev.base.mes;
              const b = ev.base.indices;
              const aporte = (k, w) => (valores[k] ? `${dec((valores[k] / b[k]) * w * 100, 1)} %` : '—');
              return (
                <tr key={mes} className={esBase ? 'base' : ''}>
                  <td>{nombreMes(mes)}{esBase && <span className="chip">Base</span>}</td>
                  <td className="n con-origen" title={esBase && ev.base.origen === 'contrato' ? origenBase(ev.base, 'mo') : origenActual(mes, 'mo')}>
                    {esBase && ev.base.origen === 'contrato'
                      ? <span className="mono">{dec(b.mo, 0)}</span>
                      : <input type="number" step="any" min="0" className="mono" value={guardado.mo ?? ''} disabled={!!pedido}
                          placeholder="cargar" onChange={(e) => setMo(mes, e.target.value === '' ? null : Number(e.target.value))} />}
                  </td>
                  <td className="n mono con-origen" title={esBase && ev.base.origen === 'contrato' ? origenBase(ev.base, 'ipc') : origenActual(mes, 'ipc', ipc, usd)}>
                    {esBase && ev.base.origen === 'contrato' ? dec(b.ipc, 1) : ipc ? dec(ipc.valor, 1) : <span className="ayuda">{nombreMes(mesMenos(mes, 2))}: pendiente</span>}
                  </td>
                  <td className="n mono con-origen" title={esBase && ev.base.origen === 'contrato' ? origenBase(ev.base, 'usd') : origenActual(mes, 'usd', ipc, usd)}>
                    {esBase && ev.base.origen === 'contrato' ? dec(b.usd, 1) : usd ? dec(usd.valor, 1) : <span className="ayuda">pendiente</span>}
                  </td>
                  <td className="n mono">{esBase ? '70,0 %' : aporte('mo', 0.7)}</td>
                  <td className="n mono">{esBase ? '20,0 %' : aporte('ipc', 0.2)}</td>
                  <td className="n mono">{esBase ? '10,0 %' : aporte('usd', 0.1)}</td>
                  <td className="n mono fuerte">{esBase ? '100,0 %' : ev.completo ? `${dec(ev.factor * 100, 1)} %` : '—'}</td>
                  <td className="n mono">{esBase ? '—' : variacion(ev.variaciones.ipc)}</td>
                  <td className="n mono">{esBase ? '—' : variacion(ev.variaciones.usd)}</td>
                  <td className="n mono">{ev.mesesDesdeBase}</td>
                  <td>
                    {pedido ? <span className={`chip pedido-${pedido.estado}`}>{ESTADO_PEDIDO[pedido.estado]}</span>
                      : esBase ? '—'
                      : ev.motivos.length ? <span className="chip estado-abierta">Sí · {ev.motivos.map((m) => MOTIVOS[m]).join(', ')}</span>
                      : 'No'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="aviso">
        La variación del IPC y del dólar se calcula aunque falte el básico. El pedido y la respuesta de VMOS se registran en la
        facturación que incluye los días 1 a 10 de ese mes.
      </p>
      {error && <p className="aviso error">Error: {error}</p>}
    </section>
  );
}

const MOTIVOS = { ipc: 'IPC > 15 %', usd: 'dólar > 15 %', paritaria: 'acuerdo gremial', plazo: '6 meses' };

// ─── Inicio en cajitas ───────────────────────────────────────────────────────

const MODULOS = [
  { id: 'facturaciones', nombre: 'Facturación', desc: 'Certificaciones, proformas y envíos a VMOS', icono: 'FAC' },
  { id: 'formula', nombre: 'Fórmula de ajuste', desc: 'Índices, base y disparadores del Anexo II', icono: 'AJU' },
  { id: 'resultado', nombre: 'Resultado', desc: 'Proyección mensual: arranque 75 % y esperado 100 %', icono: 'RES' },
  { id: 'sueldos', nombre: 'Sueldos', desc: 'Capitanes Sr y Jr: sueldo, cargas, OSDE, bono' },
  { id: 'sergio', nombre: 'Sergio', desc: 'Superintendente técnico: fijo y participación' },
  { id: 'operacion', nombre: 'Operación', desc: 'Vuelos, remises, hoteles, viáticos, EPP' },
  { id: 'vehiculo', nombre: 'Vehículo', desc: 'Camioneta, pólizas, services' },
  { id: 'vivienda', nombre: 'Vivienda', desc: 'Alquiler del departamento' },
  { id: 'administracion', nombre: 'Administración', desc: 'Estructura TM: Xubio, Office, celulares' },
  { id: 'seguros', nombre: 'Seguros', desc: 'RC del contrato y pólizas 1a–1c' },
];
const ACTIVOS = ['facturaciones', 'formula', 'resultado'];

function Inicio({ onAbrir }) {
  const [datos, setDatos] = useState(null);
  useEffect(() => {
    Promise.all([db.listarFacturaciones(), db.leerEscenarios()])
      .then(([facturaciones, escenarios]) => setDatos({ facturaciones, escenarios }))
      .catch(() => setDatos({ facturaciones: [], escenarios: {} }));
  }, []);

  const ultima = datos?.facturaciones[0];
  const esperado = datos?.escenarios.esperado && calcularResultado(completarEscenario(datos.escenarios.esperado.supuestos));
  const detalle = {
    facturaciones: ultima ? `${ultima.nombre} · ${fecha(ultima.desde)} – ${fecha(ultima.hasta)}` : 'Sin facturaciones',
    formula: 'Base: contrato, octubre 2026',
    resultado: esperado ? `Esperado: USD ${dec(esperado.total.generacion, 0)}/mes para TM` : '',
  };

  return (
    <main>
      <section className="encabezado">
        <div>
          <div className="overline">VMOS · Terminal Punta Colorada</div>
          <h1>Loading Masters.</h1>
          <div className="filete" />
        </div>
      </section>
      <div className="cajitas">
        {MODULOS.map((m) => {
          const activo = ACTIVOS.includes(m.id);
          return activo ? (
            <button key={m.id} type="button" className="cajita" onClick={() => onAbrir(m.id)}>
              <span className="cajita-nombre">{m.nombre}</span>
              <span className="cajita-desc">{m.desc}</span>
              {detalle[m.id] && <span className="cajita-dato">{detalle[m.id]}</span>}
            </button>
          ) : (
            <div key={m.id} className="cajita apagada">
              <span className="cajita-nombre">{m.nombre}</span>
              <span className="cajita-desc">{m.desc}</span>
              <span className="cajita-dato">A armar</span>
            </div>
          );
        })}
      </div>
    </main>
  );
}

// ─── Resultado proyectado ────────────────────────────────────────────────────
// Mismo cuadro que los Excel "Arranque contrato" y "Resultado esperado". Los supuestos se editan acá
// y se guardan por escenario; "Volver al Excel" restaura los valores originales.

const usd = (x) => `${x < 0 ? '−' : ''}${dec(Math.abs(x), 0)}`;
const FILAS_RESULTADO = [
  ['Ingreso CO&C', (r) => r.coc.ingreso, 'ingreso'],
  ['Ingreso seguros (1a–1c)', (r) => r.seguros.ingreso, 'ingreso'],
  ['Capitanes Senior', (r) => -r.coc.sueldosSr],
  ['Capitanes Junior', (r) => -r.coc.sueldosJr],
  ['Operación (rotación y fijos)', (r) => -r.coc.operacion],
  ['Pólizas de seguros', (r) => -r.seguros.costoSeguros],
  ['Estructura TM', (r) => -r.coc.estructuraTm],
  ['Sergio · fijo', (r) => -r.coc.sgFijo],
  ['Imprevistos', (r) => -(r.coc.imprevistos + r.seguros.imprevistos)],
  ['Impuesto al crédito y débito', (r) => -(r.coc.credito + r.seguros.credito)],
  ['Ingresos brutos', (r) => -(r.coc.iibb + r.seguros.iibb)],
  ['Resultado bruto', (r) => r.total.bruto, 'subtotal'],
  ['Sergio · participación', (r) => -r.total.participacionSg],
  ['Generación TM', (r) => r.total.generacion, 'total'],
];

const CAMPOS_SUPUESTOS = [
  ['factorPrecio', 'Factor de precio (cl. 4.2)', 'número'],
  ['ingresoCocUsd', 'Ingreso CO&C al 100 % (USD/mes)'],
  ['ingresoSegurosUsd', 'Ingreso seguros (USD/mes)'],
  ['capitanesSr.cantidad', 'Capitanes Senior (cantidad)', 'número'],
  ['capitanesSr.costoUsd', 'Costo por Senior (USD/mes)'],
  ['capitanesJr.cantidad', 'Capitanes Junior (cantidad)', 'número'],
  ['capitanesJr.costoUsd', 'Costo por Junior (USD/mes)'],
  ['operacionUsd', 'Operación: rotación y fijos (USD/mes)'],
  ['costoSegurosUsd', 'Pólizas de seguros (USD/mes)'],
  ['estructuraTmUsd', 'Estructura TM que se resta (USD/mes)'],
  ['estructuraBaseSgUsd', 'Estructura base para Sergio (USD/mes, al 100 %)'],
  ['sgFijoUsd', 'Sergio fijo (USD/mes, al 100 %)'],
  ['pctImprevistos', 'Imprevistos (%)', '%'],
  ['pctCredito', 'Impuesto al crédito y débito (%)', '%'],
  ['pctIibb', 'Ingresos brutos (%)', '%'],
  ['pctParticipacionSg', 'Participación de Sergio (%)', '%'],
  ['mesesContrato', 'Meses de contrato', 'número'],
  ['fx', 'Tipo de cambio (ARS/USD)', 'número'],
];
const leerCampo = (o, ruta) => ruta.split('.').reduce((x, k) => x?.[k], o);
const conCampo = (o, ruta, v) => {
  const [k, ...resto] = ruta.split('.');
  return { ...o, [k]: resto.length ? conCampo(o[k], resto.join('.'), v) : v };
};

function Resultado() {
  const [escenarios, setEscenarios] = useState(null);
  const [error, setError] = useState('');
  const pendientes = useRef({});

  useEffect(() => {
    db.leerEscenarios()
      .then((guardados) => setEscenarios(Object.fromEntries(CLAVES_ESCENARIOS.filter((c) => guardados[c]).map((c) => [c, {
        ...guardados[c],
        supuestos: completarEscenario(guardados[c].supuestos),
      }]))))
      .catch((e) => setError(e.message));
  }, []);

  if (!escenarios) return <main>{error ? <p className="aviso error">Error: {error}</p> : 'Cargando…'}</main>;

  const claves = CLAVES_ESCENARIOS.filter((c) => escenarios[c]);
  if (!claves.length) return <main><p className="aviso">Todavía no hay escenarios cargados en la base de datos.</p></main>;
  const resultados = Object.fromEntries(claves.map((c) => [c, calcularResultado(escenarios[c].supuestos)]));

  function cambiar(clave, ruta, valor) {
    const supuestos = conCampo(escenarios[clave].supuestos, ruta, valor);
    setEscenarios((e) => ({ ...e, [clave]: { ...e[clave], supuestos, editado: true } }));
    clearTimeout(pendientes.current[clave]);
    pendientes.current[clave] = setTimeout(() => {
      db.guardarEscenario(clave, supuestos)
        .then((actualizado) => setEscenarios((e) => ({ ...e, [clave]: { ...e[clave], actualizado } })))
        .catch((err) => setError(err.message));
    }, 800);
  }

  async function volverAlExcel(clave) {
    const { original } = escenarios[clave];
    if (!confirm(`¿Volver los supuestos de "${original.nombre}" a los valores del Excel?`)) return;
    try {
      clearTimeout(pendientes.current[clave]);
      const actualizado = await db.restaurarEscenario(clave, original);
      setEscenarios((e) => ({ ...e, [clave]: { ...e[clave], supuestos: completarEscenario(original), editado: false, actualizado } }));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main>
      <section className="encabezado">
        <div>
          <h1>Resultado proyectado.</h1>
          <div className="filete" />
          <p className="aviso">USD por mes, con las fórmulas de tus Excel "Arranque contrato" y "Resultado esperado".</p>
        </div>
      </section>

      <div className="tabla-scroll">
        <table className="tabla-resultado">
          <thead>
            <tr><th>Concepto</th>{claves.map((c) => <th key={c} className="n">{escenarios[c].supuestos.nombre}</th>)}</tr>
          </thead>
          <tbody>
            {FILAS_RESULTADO.map(([nombre, fn, tipo]) => (
              <tr key={nombre} className={tipo ?? ''}>
                <td>{nombre}</td>
                {claves.map((c) => <td key={c} className="n mono">{usd(fn(resultados[c]))}</td>)}
              </tr>
            ))}
            <tr className="margen">
              <td>Margen sobre ingresos</td>
              {claves.map((c) => <td key={c} className="n mono">{dec(resultados[c].total.margen * 100, 1)} %</td>)}
            </tr>
            <tr className="margen">
              <td>Generación TM en pesos</td>
              {claves.map((c) => <td key={c} className="n mono">$ {dec(resultados[c].total.generacion * escenarios[c].supuestos.fx, 0)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="columnas">
        {claves.map((c) => {
          const r = resultados[c];
          const s = escenarios[c].supuestos;
          return (
            <section key={c} className="tarjeta">
              <div className="overline">{s.nombre} · {s.mesesContrato} meses</div>
              <div className="calendario">
                <div><span className="mono">USD {dec(r.contrato.generacionCoc + r.contrato.generacionSeguros, 0)}</span> generación TM del contrato</div>
                <div><span className="mono">USD {dec(r.sergio.mensual, 0)}</span> Sergio por mes (fijo + participación)</div>
                <div><span className="mono">USD {dec(r.contrato.sergio, 0)}</span> Sergio en el contrato</div>
                <div><span className="mono">USD {dec(r.total.participacionSg, 0)}</span> participación por mes</div>
              </div>
            </section>
          );
        })}
      </div>

      <section className="supuestos">
        <div className="overline">Supuestos</div>
        <p className="aviso">Se guardan solos. Sergio cobra el fijo y la estructura base escalados por el factor de precio, y su participación es el % del resultado bruto CO&C menos el % de la estructura base.</p>
        <div className="tabla-scroll">
          <table className="tabla-supuestos">
            <thead><tr><th>Supuesto</th>{claves.map((c) => <th key={c} className="n">{escenarios[c].supuestos.nombre}</th>)}</tr></thead>
            <tbody>
              {CAMPOS_SUPUESTOS.map(([ruta, nombre, tipo]) => (
                <tr key={ruta}>
                  <td>{nombre}</td>
                  {claves.map((c) => {
                    const v = leerCampo(escenarios[c].supuestos, ruta);
                    const mostrado = tipo === '%' ? Math.round(v * 10000) / 100 : tipo === 'número' ? v : Math.round(v * 100) / 100;
                    return (
                      <td key={c} className="n">
                        <input type="number" step="any" className="mono" value={mostrado}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (e.target.value === '' || Number.isNaN(n)) return;
                            cambiar(c, ruta, tipo === '%' ? n / 100 : n);
                          }} />
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td />
                {claves.map((c) => (
                  <td key={c} className="n">
                    <span className="ayuda">{escenarios[c].editado ? `Editado ${hora.format(new Date(escenarios[c].actualizado.at))}` : 'Valores del Excel'}</span>
                    {escenarios[c].editado && <button type="button" className="terciario chico" onClick={() => volverAlExcel(c)}>Volver al Excel</button>}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {escenarios.arranque && escenarios.esperado && escenarios.arranque.supuestos.operacionUsd === 0 && (
          <p className="aviso alerta">
            En el Excel de arranque "Costos Rotación" está vacío. En el esperado son USD {dec(escenarios.esperado.supuestos.operacionUsd, 0)}/mes
            (rotación, fijos por empleado y remise). Si en el arranque también hay vuelos, remises y viáticos, cargalos en "Operación".
          </p>
        )}
      </section>
      {error && <p className="aviso error">Error: {error}</p>}
    </main>
  );
}
