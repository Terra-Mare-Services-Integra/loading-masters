import { useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from '../assets/isologo-horizontal-azul.png';
import { CONTRATO_VMOS } from './lib/contrato.js';
import { periodoDeCierre } from './lib/certificacion.js';
import { rangoDias, parse } from './lib/fechas.js';
import { supabase, DOMINIOS } from './lib/supabase.js';
import { armarProforma, comprimirTramos, expandirTramos } from './proforma/armar.js';
import { renderProforma } from './proforma/plantilla.js';
import * as db from './datos.js';

const MENSUALES = CONTRATO_VMOS.items.filter((i) => i.tipo === 'mensual');
const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const ars = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 });
const hora = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const pesos = (x) => `$ ${ars.format(x)}`;
const fecha = (iso) => iso.split('-').reverse().join('/');
const lineas = (texto) => texto.split('\n').map((s) => s.trim()).filter(Boolean);

// Mes de cierre por defecto: el del próximo día 20.
function cierrePorDefecto(hoy = new Date()) {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() + (hoy.getDate() > 20 ? 1 : 0), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function cargaVacia(cierre) {
  return {
    id: null,
    cierre,
    numero: `PF-${cierre}`,
    fechaEmision: periodoDeCierre(cierre).hasta,
    factores: {},
    reembolsables: { '1d': 0 },
    observaciones: '',
  };
}

// El JSON de archivo usa tramos (igual que certificaciones/*.json); la app trabaja por día.
function aArchivo(carga, feriados) {
  const periodo = periodoDeCierre(carga.cierre);
  const { cierre, numero, fechaEmision, factores, reembolsables, observaciones } = carga;
  const tramos = Object.fromEntries(
    Object.entries(factores).map(([c, f]) => [c, comprimirTramos(f, periodo)]).filter(([, t]) => t.length),
  );
  return { cierre, numero, fechaEmision, tramos, reembolsables, feriados, observaciones: lineas(observaciones) };
}
function desdeArchivo(json, actual) {
  const { cierre, numero, fechaEmision, tramos = {}, reembolsables, observaciones = [] } = json;
  return {
    ...actual,
    cierre,
    numero: numero ?? actual.numero,
    fechaEmision: fechaEmision ?? actual.fechaEmision,
    reembolsables: reembolsables ?? actual.reembolsables,
    factores: Object.fromEntries(Object.entries(tramos).map(([c, t]) => [c, expandirTramos(t)])),
    observaciones: observaciones.join('\n'),
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
  const [carga, setCarga] = useState(() => cargaVacia(cierrePorDefecto()));
  const [feriados, setFeriados] = useState([]);
  const [proformas, setProformas] = useState([]);
  // estado del guardado: cargando | guardado | pendiente | guardando | error
  const [estado, setEstado] = useState({ tipo: 'cargando' });
  const cambiosSinGuardar = useRef(false);

  const periodo = useMemo(() => periodoDeCierre(carga.cierre), [carga.cierre]);
  const dias = useMemo(() => rangoDias(periodo.desde, periodo.hasta), [periodo]);
  const proforma = useMemo(
    () => armarProforma({ ...carga, feriados, observaciones: lineas(carga.observaciones) }),
    [carga, feriados],
  );

  useEffect(() => {
    db.leerFeriados().then(setFeriados).catch((e) => setEstado({ tipo: 'error', texto: e.message }));
  }, []);

  // Al cambiar de mes se lee la certificación guardada (o se arranca vacía).
  useEffect(() => {
    let vigente = true;
    setEstado({ tipo: 'cargando' });
    db.leerCertificacion(carga.cierre)
      .then(async (guardada) => {
        if (!vigente) return;
        cambiosSinGuardar.current = false;
        if (guardada) {
          setCarga({ ...cargaVacia(guardada.cierre), ...guardada });
          setProformas(await db.leerProformas(guardada.id));
          setEstado({ tipo: 'guardado', ...guardada.actualizado });
        } else {
          setCarga((c) => (c.cierre === carga.cierre && !c.id ? c : cargaVacia(carga.cierre)));
          setProformas([]);
          setEstado({ tipo: 'nuevo' });
        }
      })
      .catch((e) => vigente && setEstado({ tipo: 'error', texto: e.message }));
    return () => { vigente = false; };
  }, [carga.cierre]);

  // Guardado automático, 800 ms después del último cambio.
  useEffect(() => {
    if (!cambiosSinGuardar.current) return;
    setEstado({ tipo: 'pendiente' });
    const t = setTimeout(async () => {
      setEstado({ tipo: 'guardando' });
      try {
        const r = await db.guardarCertificacion(carga, proforma.subtotal);
        cambiosSinGuardar.current = false;
        setCarga((c) => (c.id ? c : { ...c, id: r.id }));
        setEstado({ tipo: 'guardado', ...r.actualizado });
      } catch (e) {
        setEstado({ tipo: 'error', texto: e.message });
      }
    }, 800);
    return () => clearTimeout(t);
  }, [carga, proforma.subtotal]);

  const editar = (cambio) => {
    cambiosSinGuardar.current = true;
    setCarga(cambio);
  };
  const set = (cambios) => editar((c) => ({ ...c, ...cambios }));

  function cambiarMes(cierre) {
    if (/^\d{4}-\d{2}$/.test(cierre)) setCarga(cargaVacia(cierre));
  }

  function setFactor(codigo, dia, valor) {
    editar((c) => {
      const fila = { ...(c.factores[codigo] ?? {}) };
      if (valor) fila[dia] = valor;
      else delete fila[dia];
      return { ...c, factores: { ...c.factores, [codigo]: fila } };
    });
  }

  async function cambiarFeriado(fecha, agregar) {
    try {
      if (agregar) await db.agregarFeriado(fecha);
      else await db.quitarFeriado(fecha);
      setFeriados(await db.leerFeriados());
    } catch (e) {
      setEstado({ tipo: 'error', texto: e.message });
    }
  }

  // Se registra la emisión (foto de la proforma) antes de imprimir.
  async function emitir() {
    const guardada = await db.guardarCertificacion(carga, proforma.subtotal);
    cambiosSinGuardar.current = false;
    setCarga((c) => ({ ...c, id: guardada.id }));
    const emitida = await db.registrarProforma(guardada.id, proforma);
    setProformas((ps) => [emitida, ...ps]);
    imprimir(emitida.datos);
  }

  return (
    <main>
      <section className="encabezado">
        <div>
          <h1>Certificación de servicios.</h1>
          <div className="periodo mono">{fecha(periodo.desde)} – {fecha(periodo.hasta)} · {dias.length} días</div>
          <div className="filete" />
        </div>
        <div className="campos">
          <label>Mes de cierre
            <input type="month" value={carga.cierre} onChange={(e) => cambiarMes(e.target.value)} />
          </label>
          <label>Número
            <input value={carga.numero} onChange={(e) => set({ numero: e.target.value })} />
          </label>
          <label>Emisión
            <input type="date" value={carga.fechaEmision} onChange={(e) => set({ fechaEmision: e.target.value })} />
          </label>
          <EstadoGuardado estado={estado} />
        </div>
      </section>

      <fieldset disabled={estado.tipo === 'cargando'} className="contenido">
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
          onLimpiar={() => editar((c) => ({ ...cargaVacia(c.cierre), id: c.id }))} />

        <Historial proformas={proformas} />
      </fieldset>
    </main>
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
                  {d.endsWith('-21') || d.endsWith('-01') ? <div className="mes">{d.slice(5, 7)}</div> : <div className="mes">&nbsp;</div>}
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
    a.download = `${carga.cierre}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importar(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (json.cierre !== carga.cierre) throw new Error(`es del cierre ${json.cierre}; elegí ese mes antes de importar`);
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
      <button type="button" className="terciario" onClick={() => { if (confirm('¿Borrar la carga de este mes?')) onLimpiar(); }}>Limpiar mes</button>
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
