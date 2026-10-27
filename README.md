# Loading Masters — Certificación y facturación VMOS

Circuito mensual del servicio de Capitán Operativo (CO&C) para VMOS S.A. en la terminal
offshore de Punta Colorada (Oferta 1/2026):

```
certificación diaria → proforma (PDF) → presupuesto en Xubio → 5 días hábiles de revisión VMOS → factura → cobro a 30 días
```

Cada **facturación** es un subproyecto con nombre y fechas propias. Ejemplo, "Facturar
noviembre": servicio del 26/10 (inicio del contrato) al 30/11, proforma el viernes 20/11, fin de
observaciones de VMOS y factura el 27/11 (5 días hábiles), vencimiento de pago el 27/12
(sin contar feriados; ver `calendarioCobro`). La fecha de factura se puede fijar a mano.

## Reglas de cálculo

- **Precios** (ARS, sin IVA, base oct-2026) en [`src/lib/contrato.js`](src/lib/contrato.js), tomados del
  tarifario de la carta oferta firmada.
- **Costo diario** = precio mensual / días del mes calendario de cada fecha, así un período puede
  abarcar varios meses y un mes completo al 1 vale exactamente el precio mensual. Importe =
  precio mensual × meses equivalentes (Σ factor diario / días del mes). El Excel original dividía
  siempre por 31; `certificar({ divisor: 31 })` reproduce ese criterio.
- **Factor diario por ítem**: 1 = servicio completo; hoy el ítem 1 va al **0,75** (3 capitanes) y los
  adicionales 1a, 1b y 1c en 0.
- **Ítem 1d** (reembolsables): costo × 1,10.
- **Ajuste de precios** (Anexo II):
  `P1 = P0 × (70% MO1/MO0 + 20% IPC1/IPC0 + 10% USD1/USD0)`, con
  MO0 = básico Capitán de Ultramar sep-2026 ($ 6.381.693,35, FENA),
  IPC0 = INDEC NG ago-2026 (n-2) 12.276,8, USD0 = BNA divisa vendedor oct-2026 $ 1.524,5.
  No es automático: habilita a **pedir** la revisión cuando IPC o USD acumulan más de 15%, hay un
  acuerdo paritario avalado por VMOS, o pasan 6 meses. El pedido se hace del 1 al 10 y rige desde el
  1 del mes siguiente.
- **Ajuste en cada facturación**: la app muestra las ventanas del 1 al 10 que caen en el período,
  con los índices del mes (MO1 de FENA, IPC1 de INDEC n-2, USD1 de BNA del primer día hábil, más la
  casilla de acuerdo gremial), las variaciones contra la base vigente, qué disparadores se cumplen,
  el factor y los precios nuevos. Si corresponde, se registra el pedido (solo con fecha del 1 al 10
  y no futura) y después lo que resuelva VMOS. Un ajuste aprobado rige desde el 1 del mes siguiente:
  cada día se valoriza al precio vigente ese día, y sus índices y precios pasan a ser la base de la
  próxima revisión (también para contar los 6 meses).

```bash
npm test
```

## App de carga

```bash
npm install
npm run dev
```

- **Facturaciones**: una pestaña por facturación ("Facturar noviembre"…). *Nueva facturación*
  propone arrancar el día siguiente a la última, terminar a fin de ese mes y enviar la proforma el
  20 (o el hábil siguiente). Nombre, inicio, fin, número y fechas se editan en la ficha; fin de
  observaciones, factura (+5 días hábiles, o manual) y vencimiento (+30 días) se calculan.
- **Completar un tramo**: ítem + desde/hasta + factor, para cargar muchos días de una vez.
- **Grilla**: un casillero por día e ítem, como el Excel. Acepta coma o punto, entre 0 y 1;
  fines de semana y feriados sombreados.
- **Resumen** en vivo (días equivalentes, neto, IVA, total) y fechas del circuito de cobro.
- **Emitir proforma PDF**: abre el diálogo de impresión con la proforma; elegir *Guardar como PDF*
  y desmarcar *Encabezados y pies de página*. Mismo diseño que el PDF de la línea de comandos.
- **Descargar / Importar JSON**: mismo formato que `certificaciones/*.json`.

Requiere `.env.local` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (ver `.env.example`).

## Base de datos (Supabase)

Proyecto propio `loading-masters` (ref `sehlulimgrxdterocaml`, sa-east-1, org Integra). Esquema en
`supabase/migrations/`, configuración de auth en `supabase/config.toml`.

- `certificaciones`: una por facturación (nombre, desde, hasta, fecha de proforma y de factura);
  la app guarda sola 0,8 s después de cada cambio.
- `feriados`: compartidos entre meses.
- `indices`: MO1, IPC1, USD1 y acuerdo gremial por mes de aplicación.
- `serie_ipc` (IPC INDEC Nivel General, base dic-2016, serie `148.3_INIVELNAL_DICI_M_26` de
  datos.gob.ar) y `serie_usd` (dólar BNA divisa vendedor, API de estadísticas cambiarias del BCRA):
  las descarga la Edge Function `sincronizar-indices`, que pg_cron corre a las 9 y a las 18 h
  (hora argentina); `sincronizaciones` registra cada corrida. La app completa sola IPC1 (mes n-2) y
  USD1 (primer día hábil del mes); MO1 (FENA) sigue siendo manual. El IPC sale primero del CSV
  del INDEC (`serie_ipc_divisiones.csv`, Nivel General **Nacional**, disponible el día del informe) y,
  de respaldo, de la API de datos.gob.ar, que se actualiza unos días después.
- Pestaña **Fórmula de ajuste**: el seguimiento mes a mes como el Excel "Formula de ajuste" (una fila
  por mes desde oct-26 con básico, IPC(-2), dólar, aporte de cada componente, índice, variaciones y
  si se puede pedir), más el paso de referencia mar-26 → oct-26.
- `ajustes`: pedidos de revisión por ventana (solicitado / aprobado / rechazado), con los índices,
  la base, el factor y los precios resultantes congelados al pedir.
- `proformas`: cada emisión guarda la foto exacta de lo generado; no se editan ni se borran, y se
  pueden reimprimir desde el historial. Estados: **emitida** → **enviada** a VMOS (una sola por
  facturación; la enviada anterior pasa a **reemplazada**; su fecha de envío pasa a ser la fecha de
  proforma de la facturación) o **anulada** con motivo. Una enviada no se anula: se reemplaza.
  Lo controla la base (trigger `proteger_proforma` y función `marcar_proforma_enviada`).
- **Acceso**: email y contraseña, con confirmación por email. Las políticas RLS solo dejan leer y
  escribir a cuentas `@terra-mare.com.ar` (función `es_usuario_autorizado()`); para sumar otro
  dominio hay que cambiarla ahí y en `src/lib/supabase.js`.

```bash
npx supabase db push        # aplicar migraciones nuevas
npx supabase config push    # aplicar cambios de config.toml (auth)
```

La contraseña de la base está en `.env.local` (`SUPABASE_DB_PASSWORD`), fuera de git.
La función se publica con `npx supabase functions deploy sincronizar-indices --use-api`; el cron
lee la URL y la clave pública de los secretos `lm_project_url` y `lm_anon_key` del Vault.

## Deploy

Vercel `terracompras-projects/loading-masters`, producción en https://loading-masters.vercel.app.
Conectado al repo: cada push a `main` despliega a producción y cada rama genera un preview.
(El repo es público porque el plan Hobby de Vercel no conecta repos privados de organizaciones.)

## Emitir la proforma por línea de comandos

1. Copiar `certificaciones/2026-11.json` y ajustar `nombre`, `desde`, `hasta`, `fechaProforma`
   (opcional `fechaFactura`) y los tramos de cada ítem: `{ "desde", "hasta", "factor" }`. Los días
   sin tramo cuentan 0.
2. Generar el PDF (usa el Chrome o Edge instalado; `CHROME_PATH` para otro):

```bash
npm run proforma -- certificaciones/2026-11.json
```

Deja `salidas/<numero>.pdf` (y el `.html`). Página 1: emisor/cliente, resumen por ítem con costo
diario y días equivalentes, neto + IVA 21 % + total, y el circuito proforma → revisión → factura →
pago. Página 2: detalle día por día del factor de cada ítem.

El diseño sigue el TERRAMARE Design System (Jost / Montserrat / IBM Plex Mono, azul `#235C96`,
filete bajo títulos, radio 0, márgenes A4 20/18/16 mm) y el PDF sale con texto nativo, no imagen.

## Inicio y resultado proyectado

La app abre en un **inicio con cajitas** por módulo: Facturación, Fórmula de ajuste y Resultado
(activos), y Sueldos, Sergio, Operación, Vehículo, Vivienda, Administración y Seguros (a armar).

**Resultado proyectado** (`src/lib/resultado.js`) aplica las fórmulas de la hoja "Generacion" de los
Excel internos de arranque (75 %) y esperado (100 %): ingresos, capitanes, operación, pólizas,
estructura, Sergio (fijo + participación sobre el resultado bruto), imprevistos e impuestos.

**Los valores de esos Excel no están en este repositorio, que es público**: viven solo en la base
(tabla `escenarios`, con `original` para "Volver al Excel", y `referencias` para el paso
mar-26 → oct-26). Los tests públicos usan números inventados; la verificación al centavo contra
los Excel está en `test/local/` (ignorada por git): `npm run test:excel`.

## Etapas

| # | Etapa | Estado |
|---|-------|--------|
| 0 | Motor de cálculo: tarifario, certificación, calendario de cobro, fórmula de ajuste | ✅ hecho |
| 1 | Proforma en PDF con el detalle de días trabajados por ítem (carga por JSON) | ✅ hecho |
| 2 | App web: carga de la certificación día por día (grilla tipo Excel) y emisión desde ahí | ✅ hecho |
| 2b | Guardar certificaciones y proformas emitidas en Supabase, con login | ✅ hecho |
| 2c | Deploy en Vercel: https://loading-masters.vercel.app | ✅ hecho |
| 3 | Integración Xubio: crear el **Presupuesto** de venta y seguir su estado | pendiente |
| 4 | Seguimiento del circuito: plazo de revisión, aprobación, factura, vencimiento de cobro | pendiente |
| 5 | Ajuste de precios: índices por mes, disparadores, pedido en ventana 1–10, aprobación y precios vigentes por fecha | ✅ hecho (IPC y dólar automáticos, MO a mano) |

### Notas para la integración con Xubio (etapa 3)

La API REST de Xubio (`https://xubio.com/API/1.1`, OAuth2 client credentials) tiene
`POST /presupuestoBean` y `PUT /presupuestoBean/{id}/estado`
(-3 Pendiente de Aprobar, -2 Aprobado, -7 Rechazado, -5 Facturado), que encajan con el circuito.
**No tiene endpoint para adjuntar archivos**: el PDF de la proforma se guarda en nuestra app y se
referencia en la descripción del presupuesto (o se adjunta a mano en Xubio).
Las credenciales de la API se generan en Xubio → Configuración → Integraciones → API de Xubio.
