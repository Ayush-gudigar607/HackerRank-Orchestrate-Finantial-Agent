//**Produce the exact 8 required output columns. */
import type { FinancialState } from "./finantial-state";
import type { AffordabilityResult } from "./affordability";
import type { PaymentPlan } from "./payment-plans";
import type { SpendingPlan } from "./spending-plans";

export type AffordabilityStatus =
  | "affordable_now"
  | "affordable_with_plan"
  | "affordable_later"
  | "not_affordable";

export interface DecisionResult {
  request_id: string;
  amount_safe_to_pay: number;
  affordability_status: AffordabilityStatus;

  recommended_payment_method:
    | "full_payment"
    | "partial_payment"
    | "installments"
    | "wait"
    | "not_recommended";

  payment_plan: string;
  earliest_date_for_full_payment: string;

  spending_changes_needed: string;
  decision_explanation: string;
}

function formatAmount(amount: number): number {
  return Number(amount.toFixed(2));
}

function formatPaymentPlan(
  payments: { date: string; amount: number }[],
): string {
  if (payments.length === 0) {
    return "none";
  }

  return payments
    .map(
      (payment) =>
        `${payment.date}:${formatAmount(payment.amount)}`,
    )
    .join("|");
}

function formatSpendingChanges(
  spendingPlan: SpendingPlan,
): string {
  if (spendingPlan.changes.length === 0) {
    return "none";
  }

  return spendingPlan.changes
    .map((change) => {
      if (change.action === "stop") {
        return `stop:${change.eventId}`;
      }

      return `reduce_to:${change.eventId}:${formatAmount(
        change.newAmount ?? 0,
      )}`;
    })
    .join("|");
}

function buildExplanation(
  state: FinancialState,
  affordability: AffordabilityResult,
  paymentPlan: PaymentPlan,
  spendingPlan: SpendingPlan,
  status: AffordabilityStatus,
): string {
  const requested = formatAmount(
    state.request.requested_amount,
  );

  const safeToday = formatAmount(
    affordability.amountSafeToPay,
  );

  switch (status) {
    case "affordable_now":
      return (
        `The requested amount of ${requested} is affordable on ` +
        `${state.request.request_date} while maintaining the ` +
        `required minimum balance.`
      );

    case "affordable_with_plan":
      if (paymentPlan.paymentMethod === "partial_payment") {
        return (
          `The full amount of ${requested} is not safely payable today. ` +
          `However, ${safeToday} can be paid today and the remaining ` +
          `amount can be paid later within the requested completion date.`
        );
      }

      if (paymentPlan.paymentMethod === "installments") {
        return (
          `The full amount of ${requested} is not safely payable today, ` +
          `but a safe installment plan is available within the user's ` +
          `payment preferences.`
        );
      }

      return (
        `The request is affordable using the selected payment plan ` +
        `while maintaining the required minimum balance.`
      );

    case "affordable_later":
      return (
        `The requested amount of ${requested} is not safely payable today, ` +
        `but the forecast shows that the full amount becomes affordable ` +
        `on ${paymentPlan.earliestFullPaymentDate ?? "a later date"}.`
      );

    case "not_affordable":
      if (spendingPlan.changes.length > 0) {
        return (
          `The requested amount of ${requested} cannot be safely paid ` +
          `under the available payment options. Optional spending changes ` +
          `were considered, but they do not produce a safe eligible plan.`
        );
      }

      return (
        `The requested amount of ${requested} cannot be safely paid ` +
        `under the available payment options while maintaining the ` +
        `required minimum balance.`
      );
  }
}

export function makeDecision(
  state: FinancialState,
  affordability: AffordabilityResult,
  paymentPlan: PaymentPlan,
  spendingPlan: SpendingPlan,
): DecisionResult {
  const requestedAmount = state.request.requested_amount;

  let status: AffordabilityStatus;

  switch (paymentPlan.paymentMethod) {
    case "full_payment":
      status = "affordable_now";
      break;

    case "partial_payment":
    case "installments":
      status = "affordable_with_plan";
      break;

    case "wait":
      status = "affordable_later";
      break;

    default:
      status = "not_affordable";
  }

  /*
   * Safety guard:
   * Never allow the output amount to exceed the request.
   */
  const amountSafeToPay = Math.max(
    0,
    Math.min(
      requestedAmount,
      affordability.amountSafeToPay,
    ),
  );

  /*
   * If the payment plan says it is unsafe,
   * force the final decision to not_recommended.
   */
  if (!paymentPlan.isSafe) {
    status = "not_affordable";
  }

  const earliestDate =
    paymentPlan.earliestFullPaymentDate ?? "";

  return {
    request_id: state.request.request_id,

    amount_safe_to_pay:
      formatAmount(amountSafeToPay),

    affordability_status: status,

    recommended_payment_method:
      paymentPlan.isSafe
        ? paymentPlan.paymentMethod
        : "not_recommended",

    payment_plan:
      paymentPlan.isSafe
        ? formatPaymentPlan(paymentPlan.payments)
        : "none",

    earliest_date_for_full_payment:
      earliestDate,

    spending_changes_needed:
      formatSpendingChanges(spendingPlan),

    decision_explanation:
      buildExplanation(
        state,
        affordability,
        paymentPlan,
        spendingPlan,
        status,
      ),
  };
}