import { AbstractPaymentProvider, MedusaError } from "@medusajs/framework/utils"
import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  PaymentSessionStatus,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { CybersourceClient } from "../client/cybersource-client"
import {
  CybersourceOptions,
  CybersourceSessionData,
  CybersourcePaymentData,
} from "../types"

// Maps CyberSource authorization status strings to Medusa PaymentSessionStatus
const CS_STATUS_MAP: Record<string, PaymentSessionStatus> = {
  AUTHORIZED: "authorized",
  AUTHORIZED_PENDING_REVIEW: "requires_more",
  PARTIAL_AUTHORIZED: "requires_more",
  DECLINED: "error",
  INVALID_REQUEST: "error",
  AUTHORIZED_RISK_DECLINED: "error",
  PENDING: "pending",
  VOIDED: "canceled",
  CAPTURED: "captured",
  PENDING_REVIEW: "requires_more",
}

// Converts a Medusa BigNumberInput amount to a 2-decimal string for CyberSource.
// Medusa v2 passes amounts in standard units (e.g. Q1780.63 = 1780.63).
// When called from paymentModule internals (e.g. refundPaymentFromProvider_),
// the amount is a BigNumber raw object: { value: "1780.63", precision?: N }.
function toAmountString(amount: any): string {
  let num: number

  if (typeof amount === "object" && amount !== null) {
    // Medusa BigNumber raw value: { value: "1780.63" }
    const val = amount.value ?? amount.numeric
    num = parseFloat(String(val))
  } else {
    num = Number(amount)
  }

  if (isNaN(num)) {
    throw new Error(`Invalid amount: ${JSON.stringify(amount)}`)
  }

  return num.toFixed(2)
}

class CybersourcePaymentProvider extends AbstractPaymentProvider<CybersourceOptions> {
  static identifier = "cybersource"

  private client: CybersourceClient
  private captureMode: boolean
  private allowedCardNetworks: string[]

  static validateOptions(options: Record<string, any>): void {
    if (!options.merchantID) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "CyberSource: merchantID is required in provider options."
      )
    }
    if (!options.merchantKeyId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "CyberSource: merchantKeyId is required in provider options."
      )
    }
    if (!options.merchantsecretKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "CyberSource: merchantsecretKey is required in provider options."
      )
    }
    const env = options.environment
    if (env && env !== "sandbox" && env !== "production") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'CyberSource: environment must be "sandbox" or "production".'
      )
    }
  }

  constructor(
    cradle: Record<string, unknown>,
    options: CybersourceOptions
  ) {
    super(cradle, options)
    this.client = new CybersourceClient(options)
    this.captureMode = options.capture ?? false
    this.allowedCardNetworks = options.allowedCardNetworks ?? [
      "VISA",
      "MASTERCARD",
      "AMEX",
      "DISCOVER",
    ]
  }

  /**
   * Called when the customer selects CyberSource as the payment method.
   * Creates a Flex Microform session in CyberSource and returns the captureContext
   * so the storefront can initialize the card form.
   */
  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context } = input

    // CyberSource only allows:
    // - http:// for localhost
    // - https:// for any other origin
    const rawOrigins = process.env.STORE_CORS
      ? process.env.STORE_CORS.split(",").map((o) => o.trim())
      : ["http://localhost:8000"]

    const targetOrigins = rawOrigins.filter((origin) => {
      if (origin.startsWith("https://")) return true
      if (origin.startsWith("http://localhost")) return true
      if (origin.startsWith("http://127.0.0.1")) return true
      return false
    })

    if (targetOrigins.length === 0) {
      targetOrigins.push("http://localhost:8000")
    }

    try {
      const captureContext = await this.client.generateCaptureContext({
        targetOrigins,
        amount: toAmountString(amount as any),
        currency: currency_code.toUpperCase(),
        allowedCardNetworks: this.allowedCardNetworks,
      })

      // Generate a unique session ID for CyberSource reference tracking
      const sessionId = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

      const sessionData: CybersourceSessionData = {
        captureContext,
        medusa_session_id: sessionId,
        amount: toAmountString(amount as any),
        currency: currency_code.toUpperCase(),
      }

      return {
        id: sessionId,
        data: sessionData as unknown as Record<string, unknown>,
      }
    } catch (error: any) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `CyberSource initiatePayment failed: ${error.message}`
      )
    }
  }

  /**
   * Called during cart completion (before order creation).
   * By this point, the custom route /store/cybersource/authorize should have
   * already called CyberSource and stored cs_payment_id + cs_status in session data.
   * This method reads that stored result and returns the Medusa status.
   */
  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = input.data as Partial<CybersourceSessionData> | undefined

    // If cs_payment_id is present, the pre-auth custom route ran successfully
    if (data?.cs_payment_id && data?.cs_status) {
      const medusaStatus =
        CS_STATUS_MAP[data.cs_status] ?? ("error" as PaymentSessionStatus)

      return {
        status: medusaStatus,
        data: {
          cs_payment_id: data.cs_payment_id,
          cs_status: data.cs_status,
          amount: data.amount,
          currency: data.currency,
        } as unknown as Record<string, unknown>,
      }
    }

    // If no pre-authorization data exists, the storefront did not call the
    // pre-auth route. Return "pending" so the order does not complete.
    return {
      status: "pending" as PaymentSessionStatus,
      data: input.data,
    }
  }

  /**
   * Called when the admin captures the payment from the Medusa dashboard.
   */
  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const data = input.data as Partial<CybersourcePaymentData> | undefined

    console.log("[CyberSource] capturePayment called", {
      cs_payment_id: data?.cs_payment_id,
      cs_status: data?.cs_status,
      cs_capture_id: data?.cs_capture_id,
      amount: data?.amount,
      currency: data?.currency,
    })

    if (!data?.cs_payment_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "CyberSource: cs_payment_id not found in payment data. Cannot capture."
      )
    }

    // If already captured (auto-capture mode was enabled), return as-is
    if (data.cs_status === "CAPTURED" && data.cs_capture_id) {
      console.log("[CyberSource] capturePayment: already captured, returning as-is")
      return { data: input.data }
    }

    try {
      const result = await this.client.capturePayment({
        csPaymentId: data.cs_payment_id,
        amount: data.amount!,
        currency: data.currency!,
        referenceCode: data.cs_payment_id,
      })

      console.log("[CyberSource] capturePayment success", {
        cs_capture_id: result.id,
        cs_reconciliation_id: result.reconciliationId,
        status: result.status,
      })

      return {
        data: {
          ...data,
          cs_capture_id: result.id,
          cs_reconciliation_id:
            result.reconciliationId ?? data.cs_reconciliation_id,
          cs_status: "CAPTURED",
        } as unknown as Record<string, unknown>,
      }
    } catch (error: any) {
      console.error("[CyberSource] capturePayment error:", error.message)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `CyberSource capturePayment failed: ${error.message}`
      )
    }
  }

  /**
   * Called when the admin cancels an order (only before capture).
   * Voids the authorization at CyberSource.
   */
  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    const data = input.data as Partial<CybersourcePaymentData> | undefined

    if (!data?.cs_payment_id) {
      // No payment was ever authorized — nothing to cancel
      return { data: input.data }
    }

    try {
      await this.client.voidPayment({
        csPaymentId: data.cs_payment_id,
        referenceCode: data.cs_payment_id,
      })

      return {
        data: {
          ...data,
          cs_status: "VOIDED",
        } as unknown as Record<string, unknown>,
      }
    } catch (error: any) {
      // Void may fail if payment was already settled — log but don't block cancellation
      console.warn(
        `CyberSource: void failed for ${data.cs_payment_id}: ${error.message}. ` +
          `Payment may have already settled. Consider issuing a refund instead.`
      )
      return {
        data: {
          ...data,
          cs_status: "VOID_FAILED",
          cs_void_error: error.message,
        } as unknown as Record<string, unknown>,
      }
    }
  }

  /**
   * Called when the customer switches to a different payment method.
   * There is no persistent CyberSource resource to delete for a Flex session —
   * the captureContext simply expires. Return data as-is.
   */
  async deletePayment(
    input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  /**
   * Called when the cart amount changes after a session was already initiated.
   * Generates a new captureContext for the updated amount.
   */
  async updatePayment(
    input: UpdatePaymentInput
  ): Promise<UpdatePaymentOutput> {
    const { amount, currency_code } = input
    const prevData = input.data as Partial<CybersourceSessionData> | undefined

    // Called with no amount — Medusa is just persisting data, return as-is.
    if (!amount) {
      return { data: input.data }
    }

    // If the session already has a CyberSource authorization, the authorize
    // route just saved cs_payment_id/cs_status via updatePaymentSession.
    // Do NOT regenerate the captureContext or clear those fields.
    if (prevData?.cs_payment_id) {
      return { data: input.data }
    }

    const rawOriginsUpdate = process.env.STORE_CORS
      ? process.env.STORE_CORS.split(",").map((o) => o.trim())
      : ["http://localhost:8000"]

    const targetOrigins = rawOriginsUpdate.filter((origin) => {
      if (origin.startsWith("https://")) return true
      if (origin.startsWith("http://localhost")) return true
      if (origin.startsWith("http://127.0.0.1")) return true
      return false
    })

    if (targetOrigins.length === 0) {
      targetOrigins.push("http://localhost:8000")
    }

    try {
      const captureContext = await this.client.generateCaptureContext({
        targetOrigins,
        amount: toAmountString(amount as any),
        currency: currency_code.toUpperCase(),
        allowedCardNetworks: this.allowedCardNetworks,
      })

      return {
        data: {
          ...prevData,
          captureContext,
          amount: toAmountString(amount as any),
          currency: currency_code.toUpperCase(),
          // Clear any stale pre-auth data since the amount changed
          transient_token: undefined,
          cs_payment_id: undefined,
          cs_status: undefined,
        } as unknown as Record<string, unknown>,
      }
    } catch (error: any) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `CyberSource updatePayment failed: ${error.message}`
      )
    }
  }

  /**
   * Retrieves the raw payment data from CyberSource.
   */
  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const data = input.data as Partial<CybersourcePaymentData> | undefined

    if (!data?.cs_payment_id) {
      return { data: input.data }
    }

    try {
      const transaction = await this.client.getTransaction(data.cs_payment_id)
      return {
        data: {
          ...data,
          cs_raw: transaction,
        } as unknown as Record<string, unknown>,
      }
    } catch (error: any) {
      // Non-fatal: return existing data if retrieve fails
      return { data: input.data }
    }
  }

  /**
   * Returns the current status of a payment based on stored data.
   */
  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const data = input.data as
      | Partial<CybersourceSessionData & CybersourcePaymentData>
      | undefined

    if (!data?.cs_status) {
      return { status: "pending" as PaymentSessionStatus }
    }

    const medusaStatus =
      CS_STATUS_MAP[data.cs_status] ?? ("error" as PaymentSessionStatus)
    return { status: medusaStatus }
  }

  /**
   * Refunds a captured payment. Can be called multiple times for partial refunds.
   */
  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    const data = input.data as Partial<CybersourcePaymentData> | undefined

    // Use capture ID if available, otherwise fall back to payment ID
    const refundTargetId = data?.cs_capture_id ?? data?.cs_payment_id
    const refundAmount = toAmountString(input.amount as any)

    console.log("[CyberSource] refundPayment called", {
      cs_payment_id: data?.cs_payment_id,
      cs_capture_id: data?.cs_capture_id,
      cs_status: data?.cs_status,
      refundTargetId,
      refundAmount,
      inputAmount: input.amount,
      currency: data?.currency,
    })

    if (!refundTargetId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "CyberSource: no capture or payment ID found in data. Cannot refund."
      )
    }

    try {
      const result = await this.client.refundPayment({
        csCaptureId: refundTargetId,
        amount: refundAmount,
        currency: data?.currency ?? "USD",
        referenceCode: refundTargetId,
      })

      console.log("[CyberSource] refundPayment success", {
        cs_refund_id: result.id,
        refundAmount,
        status: result.status,
      })

      return {
        data: {
          ...data,
          cs_last_refund_id: result.id,
          cs_last_refund_amount: refundAmount,
        } as unknown as Record<string, unknown>,
      }
    } catch (error: any) {
      console.error("[CyberSource] refundPayment error:", error.message)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `CyberSource refundPayment failed: ${error.message}`
      )
    }
  }

  /**
   * Processes incoming webhooks from CyberSource.
   * In v1, CyberSource webhooks are optional since the flow is synchronous.
   * Returns "not_supported" for unrecognized events.
   */
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const { data } = payload

    // CyberSource webhook event types
    // https://developer.cybersource.com/docs/cybs/en-us/notifications/developer/all/rest/notifications/notif-events.html
    const eventType = data?.eventType as string | undefined

    switch (eventType) {
      case "payments.payments.updated": {
        const status = (data as any)?.payload?.data?.object?.status as string
        const sessionId = (data as any)?.payload?.data?.object
          ?.clientReferenceInformation?.code as string | undefined

        if (!sessionId) {
          return { action: "not_supported" }
        }

        if (status === "AUTHORIZED" || status === "AUTHORIZED_PENDING_REVIEW") {
          return {
            action: "authorized",
            data: {
              session_id: sessionId,
              amount: 0,
            },
          }
        }

        if (status === "CAPTURED") {
          return {
            action: "captured",
            data: {
              session_id: sessionId,
              amount: 0,
            },
          }
        }

        if (status === "DECLINED" || status === "INVALID_REQUEST") {
          return {
            action: "failed",
            data: {
              session_id: sessionId,
              amount: 0,
            },
          }
        }

        return { action: "not_supported" }
      }

      default:
        return { action: "not_supported" }
    }
  }
}

export default CybersourcePaymentProvider
