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

## Etapas

| # | Etapa | Estado |
|---|-------|--------|
| 0 | Motor de cálculo: tarifario, certificación, calendario de cobro, fórmula de ajuste | ✅ hecho |
| 1 | App web: carga de la certificación día por día (grilla tipo Excel) y vista del total | pendiente |
| 2 | Proforma en PDF con el detalle de días trabajados por ítem | pendiente |
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
