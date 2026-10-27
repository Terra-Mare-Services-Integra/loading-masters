import { useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from '../assets/isologo-horizontal-azul.png';
import { CONTRATO_VMOS } from './lib/contrato.js';
import { periodoDeCierre } from './lib/certificacion.js';
import { rangoDias, parse } from './lib/fechas.js';
import { armarProforma, comprimirTramos, expandirTramos } from './proforma/armar.js';
import { renderProforma } from './proforma/plantilla.js';

const MENSUALES = CONTRATO_VMOS.items.filter((i) => i.tipo === 'mensual');
const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const ars = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 });
const pesos = (x) => `$ ${ars.format(x)}`;
const fecha = (iso) => iso.split('-').reverse().join('/');

// Mes de cierre por defecto: el del próximo día 20.
function cierrePorDefecto(hoy = new Date()) {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() + (hoy.getDate() > 20 ? 1 : 0), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function cargaVacia(cierre) {
  return {
    cierre,
    numero: `PF-${cierre}`,
    fechaEmision: periodoDeCierre(cierre).hasta,
    factores: {},
    reembolsables: { '1d': 0 },
    feriados: [],
    observaciones: '',
  };
}

// Borrador por mes en el navegador. Es una comodidad: el respaldo es el JSON descargado.
const clave = (cierre) => `loading-masters:carga:${cierre}`;
function leerBorrador(cierre) {
  try {
    const raw = localStorage.getItem(clave(cierre));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function guardarBorrador(carga) {
  try {
    localStorage.setItem(clave(carga.cierre), JSON.stringify(carga));
  } catch {
    // sin almacenamiento disponible: se sigue trabajando en memoria
  }
}

// El JSON de archivo usa tramos (igual que certificaciones/*.json); la app trabaja por día.
function aArchivo(carga) {
  const periodo = periodoDeCierre(carga.cierre);
  const { factores, observaciones, ...resto } = carga;
  const tramos = Object.fromEntries(
    Object.entries(factores).map(([c, f]) => [c, comprimirTramos(f, periodo)]).filter(([, t]) => t.length),
  );
  return { ...resto, tramos, observaciones: observaciones.split('\n').map((s) => s.trim()).filter(Boolean) };
}
function desdeArchivo(json) {
  const { tramos = {}, observaciones = [], ...resto } = json;
  return {
    ...cargaVacia(json.cierre),
    ...resto,
    factores: Object.fromEntries(Object.entries(tramos).map(([c, t]) => [c, expandirTramos(t)])),
    observaciones: observaciones.join('\n'),
  };
}

export default function App() {
  const [carga, setCarga] = useState(() => {
    const cierre = cierrePorDefecto();
    return leerBorrador(cierre) ?? cargaVacia(cierre);
  });
  const periodo = useMemo(() => periodoDeCierre(carga.cierre), [carga.cierre]);
  const dias = useMemo(() => rangoDias(periodo.desde, periodo.hasta), [periodo]);
  const proforma = useMemo(
    () => armarProforma({ ...carga, observaciones: carga.observaciones.split('\n').map((s) => s.trim()).filter(Boolean) }),
    [carga],
  );

  useEffect(() => guardarBorrador(carga), [carga]);

  const set = (cambios) => setCarga((c) => ({ ...c, ...cambios }));

  function cambiarMes(cierre) {
    if (!/^\d{4}-\d{2}$/.test(cierre)) return;
    setCarga(leerBorrador(cierre) ?? cargaVacia(cierre));
  }

  function setFactor(codigo, dia, valor) {
    setCarga((c) => {
      const fila = { ...(c.factores[codigo] ?? {}) };
      if (valor) fila[dia] = valor;
      else delete fila[dia];
      return { ...c, factores: { ...c.factores, [codigo]: fila } };
    });
  }

  return (
    <div className="app">
      <header className="barra">
        <img src={logoUrl} alt="TERRAMARE" />
        <div className="barra-titulo">
          <div className="overline">Loading Masters</div>
          <div>Certificación de servicios · {CONTRATO_VMOS.cliente}</div>
        </div>
      </header>

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
          </div>
        </section>

        <Rellenar periodo={periodo} onAplicar={(codigo, desde, hasta, factor) => {
          for (const d of rangoDias(desde, hasta)) setFactor(codigo, d, factor);
        }} />

        <Grilla dias={dias} carga={carga} feriados={carga.feriados} proforma={proforma} setFactor={setFactor} />

        <div className="columnas">
          <section className="tarjeta">
            <div className="overline">Otros datos</div>
            <label>Reembolsables ítem 1d (gastos, sin fee)
              <input type="number" min="0" step="0.01" value={carga.reembolsables['1d'] || ''}
                onChange={(e) => set({ reembolsables: { '1d': Number(e.target.value) || 0 } })} />
            </label>
            <Feriados feriados={carga.feriados} onChange={(feriados) => set({ feriados })} />
            <label>Observaciones (una por línea, salen en la proforma)
              <textarea rows={3} value={carga.observaciones} onChange={(e) => set({ observaciones: e.target.value })} />
            </label>
          </section>

          <Resumen proforma={proforma} />
        </div>

        <Acciones carga={carga} proforma={proforma} onImportar={(c) => setCarga(c)}
          onLimpiar={() => setCarga(cargaVacia(carga.cierre))} />
      </main>
    </div>
  );
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

function Feriados({ feriados, onChange }) {
  const [nuevo, setNuevo] = useState('');
  return (
    <div className="feriados">
      <span className="etiqueta">Feriados (corren el plazo de revisión de VMOS)</span>
      <div className="fila">
        <input type="date" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        <button className="secundario" disabled={!nuevo || feriados.includes(nuevo)}
          onClick={() => { onChange([...feriados, nuevo].sort()); setNuevo(''); }}>Agregar</button>
      </div>
      <div className="chips">
        {feriados.map((f) => (
          <button key={f} className="chip" onClick={() => onChange(feriados.filter((x) => x !== f))} title="Quitar">
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

function Acciones({ carga, proforma, onImportar, onLimpiar }) {
  const archivo = useRef(null);
  const [aviso, setAviso] = useState('');

  async function emitirPdf() {
    const logo = new URL(logoUrl, window.location.href).href;
    const html = renderProforma(proforma, { logo, pie: true });
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
    setAviso('En el diálogo de impresión elegí "Guardar como PDF" y desmarcá "Encabezados y pies de página".');
  }

  function descargarJson() {
    const blob = new Blob([JSON.stringify(aArchivo(carga), null, 2)], { type: 'application/json' });
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
      if (!/^\d{4}-\d{2}$/.test(json.cierre)) throw new Error('falta "cierre" (AAAA-MM)');
      onImportar(desdeArchivo(json));
      setAviso(`Importado ${f.name}.`);
    } catch (err) {
      setAviso(`No se pudo importar ${f.name}: ${err.message}`);
    }
  }

  return (
    <section className="acciones">
      <button onClick={emitirPdf}>Emitir proforma PDF</button>
      <button className="secundario" onClick={descargarJson}>Descargar JSON</button>
      <button className="secundario" onClick={() => archivo.current.click()}>Importar JSON</button>
      <input ref={archivo} type="file" accept="application/json,.json" hidden onChange={importar} />
      <button className="terciario" onClick={() => { if (confirm('¿Borrar la carga de este mes?')) onLimpiar(); }}>Limpiar mes</button>
      {aviso && <span className="aviso">{aviso}</span>}
    </section>
  );
}
