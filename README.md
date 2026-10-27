# Loading Masters — Certificación y facturación VMOS

Circuito mensual del servicio de Capitán Operativo (CO&C) para VMOS S.A. en la terminal
offshore de Punta Colorada (Oferta 1/2026):

```
certificación diaria → proforma (PDF) → presupuesto en Xubio → 5 días hábiles de revisión VMOS → factura → cobro a 30 días
```

Ejemplo, cierre de noviembre 2026: período 21/10 – 20/11, proforma el viernes 20/11,
revisión hasta el 27/11, factura el 30/11, vencimiento de pago el 30/12
(sin contar feriados; ver `calendarioCobro`).

## Reglas de cálculo

- **Precios** (ARS, sin IVA, base oct-2026) en [`src/lib/contrato.js`](src/lib/contrato.js), tomados del
  tarifario de la carta oferta firmada.
- **Costo diario** = precio mensual / días del período. El período 21/10–20/11 tiene 31 días, igual
  que el divisor fijo del Excel `Certificación.xlsx`.
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

```bash
npm test
```

## App de carga

```bash
npm install
npm run dev
```

- **Mes de cierre**: elige el período (21 del mes anterior al 20). Número y fecha de emisión se
  completan solos y se pueden editar.
- **Completar un tramo**: ítem + desde/hasta + factor, para cargar muchos días de una vez.
- **Grilla**: un casillero por día e ítem, como el Excel. Acepta coma o punto, entre 0 y 1;
  fines de semana y feriados sombreados.
- **Resumen** en vivo (días equivalentes, neto, IVA, total) y fechas del circuito de cobro.
- **Emitir proforma PDF**: abre el diálogo de impresión con la proforma; elegir *Guardar como PDF*
  y desmarcar *Encabezados y pies de página*. Mismo diseño que el PDF de la línea de comandos.
- **Descargar / Importar JSON**: mismo formato que `certificaciones/*.json`.

Mientras no haya base de datos, la carga de cada mes queda como borrador en el navegador (se
pierde si se borran los datos del sitio): el respaldo es el JSON descargado.

## Emitir la proforma por línea de comandos

1. Copiar `certificaciones/2026-11.json` como `certificaciones/AAAA-MM.json` (mes de cierre) y cargar
   los tramos de cada ítem: `{ "desde", "hasta", "factor" }`. Los días sin tramo cuentan 0.
2. Generar el PDF (usa el Chrome o Edge instalado; `CHROME_PATH` para otro):

```bash
npm run proforma -- certificaciones/2026-11.json
```

Deja `salidas/<numero>.pdf` (y el `.html`). Página 1: emisor/cliente, resumen por ítem con costo
diario y días equivalentes, neto + IVA 21 % + total, y el circuito proforma → revisión → factura →
pago. Página 2: detalle día por día del factor de cada ítem.

El diseño sigue el TERRAMARE Design System (Jost / Montserrat / IBM Plex Mono, azul `#235C96`,
filete bajo títulos, radio 0, márgenes A4 20/18/16 mm) y el PDF sale con texto nativo, no imagen.

## Etapas

| # | Etapa | Estado |
|---|-------|--------|
| 0 | Motor de cálculo: tarifario, certificación, calendario de cobro, fórmula de ajuste | ✅ hecho |
| 1 | Proforma en PDF con el detalle de días trabajados por ítem (carga por JSON) | ✅ hecho |
| 2 | App web: carga de la certificación día por día (grilla tipo Excel) y emisión desde ahí | ✅ hecho (sin base de datos) |
| 2b | Guardar certificaciones y proformas emitidas en Supabase, con login | pendiente |
| 3 | Integración Xubio: crear el **Presupuesto** de venta y seguir su estado | pendiente |
| 4 | Seguimiento del circuito: plazo de revisión, aprobación, factura, vencimiento de cobro | pendiente |
| 5 | Ajuste de precios: carga mensual de índices (FENA, INDEC, BNA), alertas de disparadores, historial de precios vigentes | pendiente |

### Notas para la integración con Xubio (etapa 3)

La API REST de Xubio (`https://xubio.com/API/1.1`, OAuth2 client credentials) tiene
`POST /presupuestoBean` y `PUT /presupuestoBean/{id}/estado`
(-3 Pendiente de Aprobar, -2 Aprobado, -7 Rechazado, -5 Facturado), que encajan con el circuito.
**No tiene endpoint para adjuntar archivos**: el PDF de la proforma se guarda en nuestra app y se
referencia en la descripción del presupuesto (o se adjunta a mano en Xubio).
Las credenciales de la API se generan en Xubio → Configuración → Integraciones → API de Xubio.
