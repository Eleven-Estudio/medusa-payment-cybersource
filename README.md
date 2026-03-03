# Medusa Payment Cybersource for Medusa

CyberSource payment plugin for [Medusa.js v2](https://medusajs.com/), built on **Flex Microform v2** (PCI DSS SAQ-A compliant).

## Features

- **Flex Microform v2** — card data is tokenized directly at CyberSource; it never touches your server
- **Authorization + manual capture** from the Medusa admin dashboard
- **Auto-capture (sale mode)** for instant settlement
- **Partial and full refunds**
- **Zero-amount orders** — 100% discounts and free orders are handled automatically (no gateway call)

## Requirements

- Medusa.js v2 (`@medusajs/medusa >= 2.0.0`)
- CyberSource Business Center account
- Node.js 18+

## Installation

```bash
npm install medusa-payment-cybersource
```

## Environment Variables

Add these to your `.env`:

```env
CYBERSOURCE_MERCHANT_ID=your_merchant_id
CYBERSOURCE_KEY_ID=your_shared_key_id
CYBERSOURCE_SECRET_KEY=your_shared_secret_key
CYBERSOURCE_ENV=sandbox           # or "production"
CYBERSOURCE_AUTO_CAPTURE=false    # set to "true" for sale/auto-capture mode
```

> **Where to find these values:** CyberSource Business Center → Account Management → Transaction Security Keys → Security Keys for the HTTP Signature Security Policy

## Configuration

In `medusa-config.ts`, add the plugin to **both** `plugins` (for the API route) and `modules` (for the payment provider):

```typescript
import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

module.exports = defineConfig({
  plugins: [
    // Required: registers the built-in /store/cybersource/authorize route
    { resolve: "medusa-payment-cybersource" },
  ],
  projectConfig: {
    // ... your existing config
  },
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "medusa-payment-cybersource",
            id: "cybersource",
            options: {
              merchantID: process.env.CYBERSOURCE_MERCHANT_ID,
              merchantKeyId: process.env.CYBERSOURCE_KEY_ID,
              merchantsecretKey: process.env.CYBERSOURCE_SECRET_KEY,
              environment:
                process.env.CYBERSOURCE_ENV === "production"
                  ? "production"
                  : "sandbox",
              capture: process.env.CYBERSOURCE_AUTO_CAPTURE === "true",
            },
          },
        ],
      },
    },
  ],
})
```

## Plugin Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `merchantID` | `string` | Yes | — | Your CyberSource Merchant ID |
| `merchantKeyId` | `string` | Yes | — | Shared key ID (HTTP Signature) |
| `merchantsecretKey` | `string` | Yes | — | Shared secret key (HTTP Signature) |
| `environment` | `"sandbox" \| "production"` | No | `"sandbox"` | CyberSource API environment |
| `capture` | `boolean` | No | `false` | Auto-capture on authorization (sale mode) |
| `allowedCardNetworks` | `string[]` | No | `["VISA","MASTERCARD","AMEX","DISCOVER"]` | Card networks shown in the Flex form |

## Payment Flow

```
Storefront                    Backend                          CyberSource
    |                            |                                 |
    |-- select payment method -->|                                 |
    |<-- captureContext JWT ------|-- POST /flex/v2/sessions ------>|
    |                            |                                 |
    | [Flex Microform renders card iFrames — SAQ-A]               |
    |                            |                                 |
    |-- microform.createToken() ---------------------------------->|
    |<-- transient_token (JWT, 15 min) ---------------------------|
    |                            |                                 |
    |-- POST /store/cybersource/authorize -->|                     |
    |         { payment_session_id,          |-- POST /pts/v2/payments -->|
    |           transient_token, bill_to? }  |<-- AUTHORIZED ------------|
    |<-- { success, cs_payment_id } --------|                     |
    |                            |                                 |
    |-- POST /store/carts/:id/complete -->  |                     |
    |   (placeOrder)             |-- authorizePayment()            |
    |<-- order created ----------|   reads cs_payment_id           |
```

## Frontend Integration

### 1. Load Flex Microform

```html
<script src="https://flex.cybersource.com/microform/bundle/v2/flex-microform.min.js"></script>
```

### 2. Initialize Flex

```javascript
// captureContext comes from payment_session.data.captureContext
const flex = new Flex(captureContext)
const microform = flex.microform()

const cardNumber = microform.createField("number", {
  placeholder: "Card number",
})
const cvn = microform.createField("securityCode", {
  placeholder: "CVV",
})

cardNumber.load("#card-number-container")
cvn.load("#cvn-container")
```

### 3. Tokenize and Pre-authorize

Call this **before** `placeOrder()`:

```javascript
async function authorizePayment(paymentSessionId) {
  // 1. Get transient token from Flex Microform
  const transientToken = await new Promise((resolve, reject) => {
    microform.createToken({ expirationMonth: "12", expirationYear: "2030" }, (err, token) => {
      if (err) reject(err)
      else resolve(token)
    })
  })

  // 2. Pre-authorize at CyberSource via the built-in plugin route
  const response = await fetch("/store/cybersource/authorize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-publishable-api-key": YOUR_PUBLISHABLE_API_KEY,
    },
    body: JSON.stringify({
      payment_session_id: paymentSessionId,
      transient_token: transientToken,
      bill_to: {               // optional but recommended
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        address1: "123 Main St",
        locality: "Guatemala City",
        administrativeArea: "Guatemala",
        postalCode: "01001",
        country: "GT",
      },
    }),
  })

  const result = await response.json()

  if (!response.ok) {
    throw new Error(result.message || "Payment declined")
  }

  return result // { success: true, cs_payment_id, cs_status }
}

// Usage
await authorizePayment(cart.payment_collection.payment_sessions[0].id)
await placeOrder() // Medusa completes the order using the stored cs_payment_id
```

### `/store/cybersource/authorize` — Request / Response

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payment_session_id` | `string` | Yes | Medusa payment session ID |
| `transient_token` | `string` | Yes | JWT from `microform.createToken()` |
| `bill_to` | `object` | No | Billing address for AVS/fraud checks |

**Success response (200):**
```json
{ "success": true, "cs_payment_id": "7278957202756800104005", "cs_status": "AUTHORIZED" }
```

**Declined response (402):**
```json
{ "error": "Payment declined", "reason": "INSUFFICIENT_FUND", "cs_status": "DECLINED" }
```

## Capture Modes

### Manual Capture (default)
CyberSource authorizes the card on order placement. You capture the funds from the **Medusa Admin → Orders → Payment** panel. Authorization expires in **5–7 days** if not captured.

### Auto-Capture (sale mode)
Set `CYBERSOURCE_AUTO_CAPTURE=true`. CyberSource processes authorization and capture together; the payment is marked as captured immediately on order placement.

## Admin Refund Route

Medusa's default refund UI has a `pendingDifference` validation that can block refunds in some edge cases. Add this route to your Medusa store for a direct refund bypass:

Create `src/api/admin/cybersource/refund/route.ts` in your Medusa project:

```typescript
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"

type RefundRequestBody = {
  payment_id: string
  amount?: number
  note?: string
}

export const POST = async (
  req: MedusaRequest<RefundRequestBody>,
  res: MedusaResponse
) => {
  const { payment_id, amount, note } = req.body

  if (!payment_id) {
    return res.status(400).json({ error: "payment_id is required" })
  }

  const paymentModule = req.scope.resolve(Modules.PAYMENT)

  const payments = await paymentModule.listPayments(
    { id: [payment_id] },
    { relations: ["captures", "refunds"] }
  )
  const payment = payments[0]

  if (!payment) {
    return res.status(404).json({ error: "Payment not found" })
  }

  const captured = (payment.captures ?? []).reduce(
    (sum: number, c: any) => sum + Number(c.amount ?? 0),
    0
  )
  const alreadyRefunded = (payment.refunds ?? []).reduce(
    (sum: number, r: any) => sum + Number(r.amount ?? 0),
    0
  )
  const refundable = captured - alreadyRefunded

  if (refundable <= 0) {
    return res.status(400).json({ error: "No capturable amount available to refund" })
  }

  const refundAmount = amount ?? refundable

  if (refundAmount > refundable) {
    return res.status(400).json({
      error: `Cannot refund ${refundAmount}. Maximum refundable: ${refundable}`,
    })
  }

  const updatedPayment = await paymentModule.refundPayment({
    payment_id,
    amount: refundAmount,
    created_by: (req as any).auth_context?.actor_id,
    note,
  })

  return res.json({ payment: updatedPayment })
}
```

Call it from your admin UI or custom dashboard:

```bash
curl -X POST http://localhost:9000/admin/cybersource/refund \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{ "payment_id": "pay_01...", "amount": 50.00 }'
```

## Development

```bash
# Clone
git clone https://github.com/your-org/medusa-payment-cybersource.git
cd medusa-payment-cybersource

# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev
```

### Linking to a local Medusa store with yalc

```bash
# In the plugin directory
npm run build
npx yalc push

# In your Medusa store directory
npx yalc add medusa-payment-cybersource
npx medusa develop
```

After any plugin change, re-run `npm run build && npx yalc push` in the plugin directory, then **fully restart** the Medusa server (yalc updates `node_modules`, hot-reload won't pick it up).

## CyberSource Resources

- [Business Center](https://businesscenter.cybersource.com) — sandbox + production portal
- [Flex Microform v2 docs](https://developer.cybersource.com/docs/cybs/en-us/digital-accept-flex/developer/all/rest/digital-accept-flex/flex-intro.html)
- [Payments API reference](https://developer.cybersource.com/api-reference-assets/index.html#payments)
- [Sandbox test cards](https://developer.cybersource.com/hello-world/testing-guide.html)

## License

MIT
