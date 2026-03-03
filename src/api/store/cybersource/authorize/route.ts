import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { CybersourceClient } from "../../../../client/cybersource-client"

type AuthorizeRequestBody = {
  payment_session_id: string
  transient_token: string
  bill_to?: {
    firstName?: string
    lastName?: string
    address1?: string
    locality?: string
    administrativeArea?: string
    country?: string
    email?: string
    postalCode?: string
  }
}

/**
 * POST /store/cybersource/authorize
 *
 * Pre-authorizes a payment using the Flex Microform transient token.
 * Must be called by the storefront BEFORE calling cart complete (placeOrder).
 *
 * Flow:
 * 1. Storefront gets captureContext from payment_session.data.captureContext
 * 2. Storefront initializes Flex Microform and collects card data
 * 3. Storefront calls microform.createToken() → gets transient_token
 * 4. Storefront calls this endpoint with { payment_session_id, transient_token }
 * 5. This endpoint calls CyberSource to authorize
 * 6. Stores cs_payment_id in PaymentSession.data
 * 7. Storefront calls placeOrder() → authorizePayment() reads cs_payment_id
 */
export const POST = async (
  req: MedusaRequest<AuthorizeRequestBody>,
  res: MedusaResponse
) => {
  const { payment_session_id, transient_token, bill_to } = req.body

  if (!payment_session_id) {
    return res
      .status(400)
      .json({ error: "payment_session_id is required" })
  }

  if (!transient_token) {
    return res
      .status(400)
      .json({ error: "transient_token is required" })
  }

  const paymentModule = req.scope.resolve(Modules.PAYMENT)

  // Fetch the existing payment session
  const sessions = await paymentModule.listPaymentSessions({
    id: [payment_session_id],
  })

  const session = sessions[0]

  if (!session) {
    return res
      .status(404)
      .json({ error: "Payment session not found" })
  }

  // Verify this session belongs to a CyberSource provider
  if (!session.provider_id?.includes("cybersource")) {
    return res
      .status(400)
      .json({ error: "Payment session is not a CyberSource session" })
  }

  const sessionData = session.data as Record<string, any>

  if (!sessionData?.amount || !sessionData?.currency) {
    return res
      .status(400)
      .json({ error: "Payment session data is missing amount or currency" })
  }

  const autoCapture = process.env.CYBERSOURCE_AUTO_CAPTURE === "true"

  // If the order total is zero (100% discount, free gift, etc.), skip CyberSource
  // entirely — gateways reject $0 authorizations. Mark as authorized directly.
  const orderAmount = parseFloat(sessionData.amount as string)
  if (orderAmount <= 0) {
    await paymentModule.updatePaymentSession({
      id: payment_session_id,
      amount: 0,
      currency_code: session.currency_code,
      data: {
        ...sessionData,
        cs_payment_id: "FREE_ORDER",
        cs_status: "AUTHORIZED",
        ...(autoCapture && { cs_capture_id: "FREE_ORDER" }),
      },
    })
    return res.json({
      success: true,
      cs_payment_id: "FREE_ORDER",
      cs_status: "AUTHORIZED",
    })
  }

  // Initialize the CyberSource client with env vars
  const csOptions = {
    merchantID: process.env.CYBERSOURCE_MERCHANT_ID!,
    merchantKeyId: process.env.CYBERSOURCE_KEY_ID!,
    merchantsecretKey: process.env.CYBERSOURCE_SECRET_KEY!,
    environment: (process.env.CYBERSOURCE_ENV === "production"
      ? "production"
      : "sandbox") as "sandbox" | "production",
    capture: autoCapture,
  }

  const client = new CybersourceClient(csOptions)

  try {
    const authResult = await client.authorizePayment({
      transientToken: transient_token,
      amount: sessionData.amount,
      currency: sessionData.currency,
      // Use medusa session id as idempotency key to prevent duplicate charges
      referenceCode: payment_session_id,
      capture: autoCapture,
      billTo: bill_to,
    })

    // Check for declined authorization
    if (
      authResult.status === "DECLINED" ||
      authResult.status === "INVALID_REQUEST" ||
      authResult.status === "AUTHORIZED_RISK_DECLINED"
    ) {
      const reason =
        authResult.errorInformation?.reason ?? authResult.status
      const message =
        authResult.errorInformation?.message ?? "Payment was declined"

      return res.status(402).json({
        error: "Payment declined",
        reason,
        message,
        cs_status: authResult.status,
      })
    }

    // Update the payment session with the CyberSource authorization result.
    // amount must always be provided to updatePaymentSession or MikroORM throws.
    // Medusa v2 stores amounts in standard units (quetzales, not centavos).
    // session.amount is a BigNumber object that MikroORM may mishandle if passed directly.
    // Parse sessionData.amount (our stored quetzales string, e.g. "1780.63") as a plain
    // JS number so Medusa correctly persists PaymentSession.amount and downstream
    // Capture.amount, which is required for the refund balance to be non-zero.
    const sessionAmountPlain = parseFloat(sessionData.amount as string)
    await paymentModule.updatePaymentSession({
      id: payment_session_id,
      amount: sessionAmountPlain,
      currency_code: session.currency_code,
      data: {
        ...sessionData,
        transient_token,
        cs_payment_id: authResult.id,
        cs_status: authResult.status,
        cs_reconciliation_id: authResult.reconciliationId,
        // En sale/auto-capture mode, CyberSource devuelve "AUTHORIZED" (no "CAPTURED")
        // porque el capture ocurre en el batch de liquidación. El mismo transaction ID
        // es el auth ID y el capture ID. Lo guardamos para que capturePayment no
        // intente capturar de nuevo en CyberSource.
        ...(autoCapture && { cs_capture_id: authResult.id }),
        card_last_four:
          authResult.paymentAccountInformation?.card?.suffix,
        card_type: authResult.paymentAccountInformation?.card?.type,
      },
    })

    return res.json({
      success: true,
      cs_payment_id: authResult.id,
      cs_status: authResult.status,
    })
  } catch (error: any) {
    console.error("CyberSource authorize error:", error)
    return res.status(500).json({
      error: "Payment authorization failed",
      message: error.message,
    })
  }
}
