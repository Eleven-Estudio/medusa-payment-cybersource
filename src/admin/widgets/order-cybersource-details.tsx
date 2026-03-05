import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Container, Heading, Text } from "@medusajs/ui"

type CybersourcePaymentData = {
  cs_payment_id?: string
  cs_capture_id?: string
  cs_reconciliation_id?: string
  cs_status?: string
  cs_last_refund_id?: string
  cs_last_refund_amount?: string
  card_type?: string
  card_last_four?: string
  amount?: string
  currency?: string
}

const STATUS_COLORS: Record<
  string,
  "green" | "orange" | "red" | "grey" | "blue"
> = {
  AUTHORIZED: "orange",
  AUTHORIZED_PENDING_REVIEW: "orange",
  CAPTURED: "green",
  SETTLED: "green",
  REFUNDED: "blue",
  PARTIALLY_REFUNDED: "blue",
  VOIDED: "grey",
  VOID_FAILED: "red",
  DECLINED: "red",
  INVALID_REQUEST: "red",
  AUTHORIZED_RISK_DECLINED: "red",
  PENDING: "grey",
}

function Row({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between px-6 py-3">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text size="small" className="text-ui-fg-base font-mono">
        {value}
      </Text>
    </div>
  )
}

const OrderCybersourceDetailsWidget = ({
  data: order,
}: DetailWidgetProps<AdminOrder>) => {
  const payments = order.payment_collections?.flatMap((pc) => pc.payments ?? [])
  const csPayment = payments?.find((p) =>
    p.provider_id?.includes("cybersource")
  )

  if (!csPayment) return null

  const data = (csPayment.data ?? {}) as CybersourcePaymentData

  if (!data.cs_payment_id) return null

  // Derive the display status from the stored data:
  // 1. Refunded: cs_last_refund_id is set (partial or full)
  // 2. Auto-capture: AUTHORIZED + cs_capture_id set → effectively CAPTURED
  // 3. Otherwise: use cs_status as-is (VOIDED, VOID_FAILED, CAPTURED, etc.)
  const isRefunded = !!data.cs_last_refund_id
  const isAutoCapture =
    !isRefunded && !!data.cs_capture_id && data.cs_status === "AUTHORIZED"

  let displayStatus: string | undefined
  if (isRefunded) {
    displayStatus = "REFUNDED"
  } else if (isAutoCapture) {
    displayStatus = "CAPTURED"
  } else {
    displayStatus = data.cs_status
  }

  const statusColor = displayStatus
    ? (STATUS_COLORS[displayStatus] ?? "grey")
    : "grey"

  const cardLabel =
    data.card_type && data.card_last_four
      ? `${data.card_type} •••• ${data.card_last_four}`
      : data.card_last_four
        ? `•••• ${data.card_last_four}`
        : "—"

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">CyberSource</Heading>
        {displayStatus && (
          <Badge color={statusColor} size="2xsmall">
            {displayStatus}
          </Badge>
        )}
      </div>

      {data.cs_payment_id && (
        <Row label="Transaction ID" value={data.cs_payment_id} />
      )}
      {data.cs_capture_id && data.cs_capture_id !== data.cs_payment_id && (
        <Row label="Capture ID" value={data.cs_capture_id} />
      )}
      {data.cs_reconciliation_id && (
        <Row label="Reconciliation ID" value={data.cs_reconciliation_id} />
      )}
      {(data.card_type || data.card_last_four) && (
        <Row label="Card" value={cardLabel} />
      )}
      {data.cs_last_refund_id && (
        <Row label="Last Refund ID" value={data.cs_last_refund_id} />
      )}
      {data.cs_last_refund_amount && (
        <Row
          label="Last Refund Amount"
          value={`${data.cs_last_refund_amount} ${data.currency ?? ""}`}
        />
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default OrderCybersourceDetailsWidget
