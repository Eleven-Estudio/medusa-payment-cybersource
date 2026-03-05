# Admin Widget: CyberSource Order Details

Inyecta un panel en la vista de detalle de pedido del admin de Medusa
(`order.details.side.after`) mostrando los datos de la transacción CyberSource.

## Zona de inyección

```
order.details.side.after
```

## Campos mostrados

| Campo | Fuente (payment.data) | Descripción |
|---|---|---|
| Badge de estado | derivado (ver lógica abajo) | Estado visual de la transacción |
| Transaction ID | `cs_payment_id` | ID de la autorización en CyberSource |
| Capture ID | `cs_capture_id` | Solo se muestra si es distinto al Transaction ID (capture manual) |
| Reconciliation ID | `cs_reconciliation_id` | ID de conciliación CyberSource |
| Card | `card_type` + `card_last_four` | Ej: `VISA •••• 1234` |
| Last Refund ID | `cs_last_refund_id` | ID del último reembolso emitido |
| Last Refund Amount | `cs_last_refund_amount` | Monto del último reembolso |

## Lógica del badge de estado

El estado mostrado se **deriva** de los datos almacenados, no se toma directamente
de `cs_status`. La precedencia es:

1. **REFUNDED** → si `cs_last_refund_id` tiene valor (reembolso parcial o total)
2. **CAPTURED** → si `cs_status === "AUTHORIZED"` Y `cs_capture_id` está set
   (auto-capture/sale mode: CyberSource devuelve AUTHORIZED pero el batch
   liquida automáticamente)
3. **`cs_status` as-is** → cualquier otro caso

## Tabla de estados

| `cs_status` almacenado | Condición extra | Badge mostrado | Color |
|---|---|---|---|
| `AUTHORIZED` | `cs_capture_id` set (auto-capture) | **CAPTURED** | 🟢 Verde |
| `AUTHORIZED` | sin `cs_capture_id` | **AUTHORIZED** | 🟠 Naranja |
| `AUTHORIZED_PENDING_REVIEW` | — | **AUTHORIZED_PENDING_REVIEW** | 🟠 Naranja |
| `CAPTURED` | — | **CAPTURED** | 🟢 Verde |
| `SETTLED` | — | **SETTLED** | 🟢 Verde |
| cualquiera | `cs_last_refund_id` set | **REFUNDED** | 🔵 Azul |
| `VOIDED` | — | **VOIDED** | ⚫ Gris |
| `VOID_FAILED` | — | **VOID_FAILED** | 🔴 Rojo |
| `DECLINED` | — | **DECLINED** | 🔴 Rojo |
| `INVALID_REQUEST` | — | **INVALID_REQUEST** | 🔴 Rojo |
| `AUTHORIZED_RISK_DECLINED` | — | **AUTHORIZED_RISK_DECLINED** | 🔴 Rojo |
| `PENDING` | — | **PENDING** | ⚫ Gris |

## ¿Cuándo se guardan los datos?

| Operación | Quién escribe | Campos que actualiza |
|---|---|---|
| `POST /store/cybersource/authorize` | `authorize/route.ts` | `cs_payment_id`, `cs_status`, `cs_capture_id` (si auto-capture), `cs_reconciliation_id`, `card_type`, `card_last_four` |
| `capturePayment` (capture manual) | `providers/cybersource.ts` | `cs_capture_id`, `cs_status = "CAPTURED"` |
| `cancelPayment` (void exitoso) | `providers/cybersource.ts` | `cs_status = "VOIDED"` |
| `cancelPayment` (void fallido) | `providers/cybersource.ts` | `cs_status = "VOID_FAILED"`, `cs_void_error` |
| `refundPayment` | `providers/cybersource.ts` | `cs_last_refund_id`, `cs_last_refund_amount` |

## Build

El widget se compila con Vite usando `@medusajs/admin-vite-plugin` en modo plugin:

```bash
npm run build  # tsc (backend) + vite build --config vite.admin.config.mts (admin)
```

El output va a `.medusa/server/src/admin/index.mjs` y se expone via:

```json
"./admin": {
  "import": "./.medusa/server/src/admin/index.mjs"
}
```

Medusa lo carga automáticamente gracias a la entrada `plugins` en `medusa-config.ts`.

## Nota sobre auto-capture (CYBERSOURCE_AUTO_CAPTURE=true)

CyberSource devuelve `status: "AUTHORIZED"` incluso en modo sale/auto-capture.
La captura real ocurre en el batch de liquidación nocturno. El widget detecta
este caso por la presencia de `cs_capture_id` (que se setea igual al
`cs_payment_id` en la ruta de autorización) y muestra **CAPTURED** en verde.
