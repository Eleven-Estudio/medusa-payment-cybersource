export type CybersourceOptions = {
  merchantID: string
  merchantKeyId: string
  merchantsecretKey: string
  environment: "sandbox" | "production"
  capture?: boolean
  allowedCardNetworks?: string[]
}

export type CybersourceSessionData = {
  captureContext: string
  medusa_session_id: string
  amount: string
  currency: string
  transient_token?: string
  cs_payment_id?: string
  cs_status?: string
  cs_capture_id?: string
  cs_reconciliation_id?: string
  card_last_four?: string
  card_type?: string
}

export type CybersourcePaymentData = {
  cs_payment_id: string
  cs_capture_id?: string
  cs_reconciliation_id?: string
  cs_status: string
  amount: string
  currency: string
  card_last_four?: string
  card_type?: string
}

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

export type CybersourceActionResponse = {
  id: string
  status: string
  reconciliationId?: string
}
