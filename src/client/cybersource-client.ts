import {
  CybersourceOptions,
  CybersourceAuthResponse,
  CybersourceActionResponse,
} from "../types"

// The cybersource-rest-client package uses CommonJS and has no TS types
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CyberSource = require("cybersource-rest-client")

type CybersourceConfig = {
  authenticationType: string
  merchantID: string
  merchantKeyId: string
  merchantsecretKey: string
  runEnvironment: string
  logConfiguration: { enableLog: boolean }
}

type AuthorizePaymentParams = {
  transientToken: string
  amount: string
  currency: string
  referenceCode: string
  capture: boolean
  billTo?: {
    firstName?: string
    lastName?: string
    address1?: string
    locality?: string
    administrativeArea?: string
    postalCode?: string
    country?: string
    email?: string
  }
}

type CapturePaymentParams = {
  csPaymentId: string
  amount: string
  currency: string
  referenceCode: string
}

type RefundPaymentParams = {
  csCaptureId: string
  amount: string
  currency: string
  referenceCode: string
}

type VoidPaymentParams = {
  csPaymentId: string
  referenceCode: string
}

type GenerateCaptureContextParams = {
  targetOrigins: string[]
  amount?: string
  currency?: string
  allowedCardNetworks: string[]
}

export class CybersourceClient {
  private config: CybersourceConfig
  private apiClient: typeof CyberSource.ApiClient

  constructor(options: CybersourceOptions) {
    this.config = {
      authenticationType: "http_signature",
      merchantID: options.merchantID,
      merchantKeyId: options.merchantKeyId,
      merchantsecretKey: options.merchantsecretKey,
      runEnvironment:
        options.environment === "production"
          ? "api.cybersource.com"
          : "apitest.cybersource.com",
      logConfiguration: { enableLog: false },
    }
    this.apiClient = new CyberSource.ApiClient()
  }

  /**
   * Generates a capture context JWT for Flex Microform initialization on the frontend.
   * Called in initiatePayment().
   */
  async generateCaptureContext(
    params: GenerateCaptureContextParams
  ): Promise<string> {
    const api = new CyberSource.MicroformIntegrationApi(
      this.config,
      this.apiClient
    )

    const request = new CyberSource.GenerateCaptureContextRequest()
    request.clientVersion = "v2"
    request.targetOrigins = params.targetOrigins
    request.allowedCardNetworks = params.allowedCardNetworks
    request.allowedPaymentTypes = ["CARD"]

    return new Promise((resolve, reject) => {
      api.generateCaptureContext(request, (error: any, data: string) => {
        if (error) {
          reject(
            new Error(
              `CyberSource generateCaptureContext failed: ${JSON.stringify(error)}`
            )
          )
          return
        }
        resolve(data)
      })
    })
  }

  /**
   * Authorizes a payment using a Flex Microform transient token.
   * Called from the pre-auth custom API route before placeOrder().
   */
  async authorizePayment(
    params: AuthorizePaymentParams
  ): Promise<CybersourceAuthResponse> {
    const api = new CyberSource.PaymentsApi(this.config, this.apiClient)

    const request = new CyberSource.CreatePaymentRequest()

    // Client reference (idempotency key)
    const clientRef =
      new CyberSource.Ptsv2paymentsClientReferenceInformation()
    clientRef.code = params.referenceCode
    request.clientReferenceInformation = clientRef

    // Processing information
    const processingInfo =
      new CyberSource.Ptsv2paymentsProcessingInformation()
    processingInfo.capture = params.capture
    processingInfo.commerceIndicator = "internet"
    request.processingInformation = processingInfo

    // Flex Microform v2: pass the transient token JWT via tokenInformation
    const tokenInfo = new CyberSource.Ptsv2paymentsTokenInformation()
    tokenInfo.transientTokenJwt = params.transientToken
    request.tokenInformation = tokenInfo

    // Order information
    const orderInfo = new CyberSource.Ptsv2paymentsOrderInformation()
    const amountDetails =
      new CyberSource.Ptsv2paymentsOrderInformationAmountDetails()
    amountDetails.totalAmount = params.amount
    amountDetails.currency = params.currency
    orderInfo.amountDetails = amountDetails

    if (params.billTo) {
      const billTo = new CyberSource.Ptsv2paymentsOrderInformationBillTo()
      if (params.billTo.firstName) billTo.firstName = params.billTo.firstName
      if (params.billTo.lastName) billTo.lastName = params.billTo.lastName
      if (params.billTo.address1) billTo.address1 = params.billTo.address1
      if (params.billTo.locality) billTo.locality = params.billTo.locality
      if (params.billTo.administrativeArea)
        billTo.administrativeArea = params.billTo.administrativeArea
      if (params.billTo.postalCode) billTo.postalCode = params.billTo.postalCode
      if (params.billTo.country) billTo.country = params.billTo.country
      if (params.billTo.email) billTo.email = params.billTo.email
      orderInfo.billTo = billTo
    }

    request.orderInformation = orderInfo

    return new Promise((resolve, reject) => {
      api.createPayment(
        request,
        (error: any, data: CybersourceAuthResponse) => {
          if (error) {
            reject(
              new Error(
                `CyberSource authorizePayment failed: ${JSON.stringify(error)}`
              )
            )
            return
          }
          resolve(data)
        }
      )
    })
  }

  /**
   * Captures a previously authorized payment.
   * Called in capturePayment().
   */
  async capturePayment(
    params: CapturePaymentParams
  ): Promise<CybersourceActionResponse> {
    const api = new CyberSource.CaptureApi(this.config, this.apiClient)

    const request = new CyberSource.CapturePaymentRequest()

    const clientRef =
      new CyberSource.Ptsv2paymentsidClientReferenceInformation()
    clientRef.code = params.referenceCode
    request.clientReferenceInformation = clientRef

    const orderInfo =
      new CyberSource.Ptsv2paymentsidcapturesOrderInformation()
    const amountDetails =
      new CyberSource.Ptsv2paymentsidcapturesOrderInformationAmountDetails()
    amountDetails.totalAmount = params.amount
    amountDetails.currency = params.currency
    orderInfo.amountDetails = amountDetails
    request.orderInformation = orderInfo

    return new Promise((resolve, reject) => {
      api.capturePayment(
        request,
        params.csPaymentId,
        (error: any, data: CybersourceActionResponse) => {
          if (error) {
            reject(
              new Error(
                `CyberSource capturePayment failed: ${JSON.stringify(error)}`
              )
            )
            return
          }
          resolve(data)
        }
      )
    })
  }

  /**
   * Voids an authorized payment (before capture / same-day only).
   * Called in cancelPayment().
   */
  async voidPayment(
    params: VoidPaymentParams
  ): Promise<CybersourceActionResponse> {
    const api = new CyberSource.VoidApi(this.config, this.apiClient)

    const request = new CyberSource.VoidPaymentRequest()

    const clientRef =
      new CyberSource.Ptsv2paymentsidClientReferenceInformation()
    clientRef.code = params.referenceCode
    request.clientReferenceInformation = clientRef

    return new Promise((resolve, reject) => {
      api.voidPayment(
        request,
        params.csPaymentId,
        (error: any, data: CybersourceActionResponse) => {
          if (error) {
            reject(
              new Error(
                `CyberSource voidPayment failed: ${JSON.stringify(error)}`
              )
            )
            return
          }
          resolve(data)
        }
      )
    })
  }

  /**
   * Refunds a captured payment (partial or full).
   * Called in refundPayment().
   */
  async refundPayment(
    params: RefundPaymentParams
  ): Promise<CybersourceActionResponse> {
    const api = new CyberSource.RefundApi(this.config, this.apiClient)

    const request = new CyberSource.RefundPaymentRequest()

    const clientRef =
      new CyberSource.Ptsv2paymentsidrefundsClientReferenceInformation()
    clientRef.code = params.referenceCode
    request.clientReferenceInformation = clientRef

    // The refund OrderInformation reuses the captures AmountDetails class
    const orderInfo =
      new CyberSource.Ptsv2paymentsidrefundsOrderInformation()
    const amountDetails =
      new CyberSource.Ptsv2paymentsidcapturesOrderInformationAmountDetails()
    amountDetails.totalAmount = params.amount
    amountDetails.currency = params.currency
    orderInfo.amountDetails = amountDetails
    request.orderInformation = orderInfo

    return new Promise((resolve, reject) => {
      api.refundPayment(
        request,
        params.csCaptureId,
        (error: any, data: CybersourceActionResponse) => {
          if (error) {
            reject(
              new Error(
                `CyberSource refundPayment failed: ${JSON.stringify(error)}`
              )
            )
            return
          }
          resolve(data)
        }
      )
    })
  }

  /**
   * Retrieves transaction details from CyberSource.
   * Called in retrievePayment() and getPaymentStatus().
   */
  async getTransaction(transactionId: string): Promise<any> {
    const api = new CyberSource.TransactionDetailsApi(
      this.config,
      this.apiClient
    )

    return new Promise((resolve, reject) => {
      api.getTransaction(transactionId, (error: any, data: any) => {
        if (error) {
          reject(
            new Error(
              `CyberSource getTransaction failed: ${JSON.stringify(error)}`
            )
          )
          return
        }
        resolve(data)
      })
    })
  }
}
