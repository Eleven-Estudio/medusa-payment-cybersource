export type CybersourceOptions = {
  /**
   * Merchant ID from CyberSource Business Center
   */
  merchantID: string
  /**
   * Key ID (shared key alias) from CyberSource Business Center
   */
  merchantKeyId: string
  /**
   * Base64-encoded shared secret key from CyberSource Business Center
   */
  merchantsecretKey: string
  /**
   * "sandbox" uses apitest.cybersource.com, "production" uses api.cybersource.com
   */
  environment: "sandbox" | "production"
  /**
   * If true, capture is included with the authorization (sale mode).
   * If false (default), admin must capture manually from the Medusa dashboard.
   */
  capture?: boolean
  /**
   * Allowed card networks for Flex Microform.
   * Defaults to ["VISA", "MASTERCARD", "AMEX", "DISCOVER"]
   */
  allowedCardNetworks?: string[]
}

/**
 * Data stored in PaymentSession.data (returned by initiatePayment).
 * This is accessible to the storefront.
 */
export type CybersourceSessionData = {
  /** JWT used to initialize Flex Microform on the frontend */
  captureContext: string
  /** Medusa PaymentSession ID — stored for webhook reference */
  medusa_session_id: string
  /** Amount as string with 2 decimals */
  amount: string
  /** ISO currency code */
  currency: string
  /** Transient token from Flex Microform — added by the pre-auth custom route */
  transient_token?: string
  /** CyberSource payment transaction ID — added after pre-authorization */
  cs_payment_id?: string
  /** CyberSource status string after pre-authorization */
  cs_status?: string
}

/**
 * Data stored in Payment.data (returned by authorizePayment and updated by capture/refund).
 */
export type CybersourcePaymentData = {
  /** CyberSource authorization transaction ID */
  cs_payment_id: string
  /** CyberSource capture transaction ID (set after capturePayment) */
  cs_capture_id?: string
  /** CyberSource reconciliation ID */
  cs_reconciliation_id?: string
  /** Last known CyberSource status */
  cs_status: string
  /** Amount as string */
  amount: string
  /** ISO currency code */
  currency: string
  /** Last 4 digits of the card (safe to store) */
  card_last_four?: string
  /** Card type code: "001"=Visa, "002"=MC, "003"=Amex */
  card_type?: string
}

/**
 * CyberSource authorization response (relevant fields)
 */
export type CybersourceAuthResponse = {
  id: string
  status:
    | "AUTHORIZED"
    | "AUTHORIZED_PENDING_REVIEW"
    | "DECLINED"
    | "INVALID_REQUEST"
    | "PARTIAL_AUTHORIZED"
    | "AUTHORIZED_RISK_DECLINED"
  reconciliationId?: string
  clientReferenceInformation?: { code: string }
  paymentAccountInformation?: {
    card?: { suffix?: string; type?: string }
  }
  processorInformation?: {
    approvalCode?: string
    responseCode?: string
  }
  errorInformation?: {
    reason?: string
    message?: string
  }
}

/**
 * CyberSource capture/void/refund response (relevant fields)
 */
export type CybersourceActionResponse = {
  id: string
  status: string
  reconciliationId?: string
}
