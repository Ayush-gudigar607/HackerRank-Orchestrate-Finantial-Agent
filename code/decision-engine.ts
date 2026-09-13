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

  const minBalance = formatAmount(
    state.profile.minimum_balance_to_keep,
  );

  const currency = state.profile.currency;

  switch (status) {
    case "affordable_now":
      return (
        `Pay ${currency} ${requested} today. ` +
        `This keeps the ${currency} ${minBalance} minimum available over the next 90 days.`
      );

    case "affordable_with_plan":
      if (paymentPlan.paymentMethod === "partial_payment") {
        return (
          `The full amount of ${currency} ${requested} is not safely payable today. ` +
          `However, ${currency} ${safeToday} can be paid today and the remaining ` +
          `amount can be paid on ${paymentPlan.earliestFullPaymentDate} within the requested completion date.`
        );
      }

      if (paymentPlan.paymentMethod === "installments") {
        const numPayments = paymentPlan.payments.length;
        const perPayment = formatAmount(
          paymentPlan.payments[0]?.amount ?? 0,
        );
        const startDate = paymentPlan.payments[0]?.date ?? "";
        return (
          `Use ${numPayments} installments of ${currency} ${perPayment}, ` +
          `starting ${startDate}. ` +
          `This leaves at least ${currency} ${minBalance} available.`
        );
      }

      if (paymentPlan.paymentMethod === "full_payment") {
        if (spendingPlan.changes.length > 0) {
          const changesDesc = spendingPlan.changes
            .map((c) => {
              if (c.action === "stop") return `stop ${c.eventId}`;
              return `reduce ${c.eventId} to ${formatAmount(c.newAmount ?? 0)}`;
            })
            .join(", ");
          return (
            `After spending changes (${changesDesc}), pay ${currency} ${requested} today. ` +
            `This leaves at least ${currency} ${minBalance} available.`
          );
        }
        return (
          `Pay ${currency} ${requested} today with the selected plan. ` +
          `This keeps the ${currency} ${minBalance} minimum available.`
        );
      }

      return (
        `The request is affordable using the selected payment plan ` +
        `while maintaining the required minimum balance of ${currency} ${minBalance}.`
      );

    case "affordable_later":
      return (
        `Pay ${currency} ${requested} in full on ${paymentPlan.earliestFullPaymentDate ?? "a later date"}. ` +
        `Paying earlier would take the balance below the ${currency} ${minBalance} minimum.`
      );

    case "not_affordable":
      if (spendingPlan.changes.length > 0) {
        return (
          `The requested amount of ${currency} ${requested} cannot be safely paid ` +
          `under the available payment options. Optional spending changes ` +
          `were considered, but they do not produce a safe eligible plan.`
        );
      }

      return (
        `Do not make this payment. ` +
        `None of the available options keeps the ${currency} ${minBalance} minimum protected.`
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

  if (!paymentPlan.isSafe) {
    status = "not_affordable";
  } else {
    switch (paymentPlan.paymentMethod) {
      case "full_payment":
        // Check if it requires spending changes
        if (spendingPlan.changes.length > 0 && spendingPlan.isSafe) {
          status = "affordable_with_plan";
        } else {
          status = "affordable_now";
        }
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

  const earliestDate =
    paymentPlan.earliestFullPaymentDate ?? "";

  // For affordable_now, earliest date must be request_date
  const finalEarliestDate =
    status === "affordable_now"
      ? state.request.request_date
      : earliestDate;

  // For not_recommended, payment_plan must be "none"
  const isRecommended = paymentPlan.isSafe;

  return {
    request_id: state.request.request_id,

    amount_safe_to_pay:
      formatAmount(amountSafeToPay),

    affordability_status: status,

    recommended_payment_method:
      isRecommended
        ? paymentPlan.paymentMethod
        : "not_recommended",

    payment_plan:
      isRecommended
        ? formatPaymentPlan(paymentPlan.payments)
        : "none",

    earliest_date_for_full_payment:
      finalEarliestDate,

    spending_changes_needed:
      spendingPlan.isSafe && spendingPlan.changes.length > 0
        ? formatSpendingChanges(spendingPlan)
        : "none",

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