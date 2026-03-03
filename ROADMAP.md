# Medusa Payment Cybersource — Roadmap

## Estado actual (v1.0)

Plugin funcional para Medusa v2 con:
- Flex Microform v2 (PCI DSS SAQ-A)
- Autorización + captura manual desde admin
- Auto-captura (sale mode)
- Reembolsos parciales y totales
- Pedidos de monto cero (descuentos 100%)
- Route `/store/cybersource/authorize` incluido en el plugin (cero archivos manuales)

---

## Pendiente para Producción

### 1. Webhooks de CyberSource
**Prioridad: Alta**

Sin webhooks, si un pago se cancela/disputa directamente desde el portal de CyberSource, Medusa no se entera y queda desincronizado.

**Qué hacer:**
- Configurar Notification Services en CyberSource Business Center:
  - URL: `https://tu-backend.com/hooks/payment/pp_cybersource_cybersource`
  - Eventos: `payments.payments.updated`, `risk.profile.decision`
- Completar `getWebhookActionAndData` en `src/providers/cybersource.ts`:
  - Mapear `VOIDED` → `PaymentActions.CANCELED`
  - Mapear `SETTLED` → `PaymentActions.SUCCESSFUL`
  - Verificar firma del webhook (HMAC o certificado)
- Agregar `webhookSecret` a `CybersourceOptions` para validación

**Referencias:**
- https://developer.cybersource.com/docs/cybs/en-us/notifications/developer/all/rest/notifications/notif-events.html

---

### 2. Expiración de autorizaciones
**Prioridad: Media**

CyberSource voids las autorizaciones automáticamente a los 5-7 días si no se capturan.
Solo aplica en modo manual (no auto-capture).

**Qué hacer:**
- En `capturePayment`, manejar el error de autorización expirada con un mensaje claro
- Considerar subscriber en `order.placed` que alerte si la captura tarda más de N días
- Opción: re-autorizar automáticamente si la original expiró

---

### 3. Saved Cards (vaulting)
**Prioridad: Media**

Permitir que clientes guarden su tarjeta para compras futuras sin ingresar datos de nuevo.

**Qué hacer:**
- Implementar `createAccountHolder`, `savePaymentMethod`, `listPaymentMethods`, `deletePaymentMethod`
- Usar CyberSource Token Management (TMS) para almacenar instrumentos de pago
- El `transient_token` se convierte en un `instrument_identifier` permanente

**API:**
- `POST /tms/v2/customers` → crear customer
- `POST /tms/v2/customers/{id}/payment-instruments` → guardar tarjeta

---

### 4. 3DS (3D Secure / autenticación del emisor)
**Prioridad: Media-Baja**

Para mercados que requieren autenticación adicional del banco emisor.

**Qué hacer:**
- Agregar `deviceInformation` y `consumerAuthenticationInformation` al request de `authorizePayment`
- Manejar status `AUTHORIZED_PENDING_REVIEW` con challenge 3DS en el frontend
- Puede requerir el SDK de Payer Authentication de CyberSource

---

### 5. Pagos recurrentes / suscripciones
**Prioridad: Baja**

Para modelos de negocio con cobros periódicos.

**Qué hacer:**
- Requiere Saved Cards (punto 3) primero
- Usar `processingInformation.actionList: ["TOKEN_CREATE"]` para crear token
- Cargos subsecuentes con `processingInformation.initiator.type: "merchant"`

---

### 6. Multi-currency / conversión de moneda
**Prioridad: Baja**

**Qué hacer:**
- CyberSource soporta Dynamic Currency Conversion (DCC)
- Agregar `foreignCurrency` y `foreignAmount` en el request si aplica