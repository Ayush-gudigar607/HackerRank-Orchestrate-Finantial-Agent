import type { DecisionResult } from "./decision-engine";
import type { Request } from "./types";

const VALID_STATUSES = new Set([
  "affordable_now",
  "affordable_with_plan",
  "affordable_later",
  "not_affordable",
]);

const VALID_METHODS = new Set([
  "full_payment",
  "partial_payment",
  "installments",
  "wait",
  "not_recommended",
]);

function parsePaymentPlan(
  value: string,
): { date: string; amount: number }[] {
  if (!value || value === "none") return [];

  return value.split("|").map((item) => {
    const [date, amountText] = item.split(":");

    return {
      date: date!,
      amount: Number(amountText),
    };
  });
}

export interface ValidationError {
  requestId: string;
  field: string;
  message: string;
}

export function validateDecision(
  request: Request,
  result: DecisionResult,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (result.request_id !== request.request_id) {
    errors.push({
      requestId: request.request_id,
      field: "request_id",
      message: "request_id does not match request",
    });
  }

  if (
    !Number.isFinite(result.amount_safe_to_pay) ||
    result.amount_safe_to_pay < 0 ||
    result.amount_safe_to_pay >
      request.requested_amount
  ) {
    errors.push({
      requestId: request.request_id,
      field: "amount_safe_to_pay",
      message:
        "amount_safe_to_pay must be between 0 and requested_amount",
    });
  }

  if (!VALID_STATUSES.has(result.affordability_status)) {
    errors.push({
      requestId: request.request_id,
      field: "affordability_status",
      message: "Invalid affordability status",
    });
  }

  if (
    !VALID_METHODS.has(
      result.recommended_payment_method,
    )
  ) {
    errors.push({
      requestId: request.request_id,
      field: "recommended_payment_method",
      message: "Invalid payment method",
    });
  }

  const payments = parsePaymentPlan(
    result.payment_plan,
  );

  if (result.payment_plan !== "none" && payments.length === 0) {
    errors.push({ requestId: request.request_id, field: "payment_plan", message: "A recommended plan needs at least one payment" });
  }

  for (const payment of payments) {
    if (
      !payment.date ||
      !Number.isFinite(payment.amount) ||
      payment.amount <= 0
    ) {
      errors.push({
        requestId: request.request_id,
        field: "payment_plan",
        message: "Invalid payment entry",
      });
    }
  }

  for (let index = 1; index < payments.length; index++) {
    if (payments[index - 1]!.date > payments[index]!.date) {
      errors.push({ requestId: request.request_id, field: "payment_plan", message: "Payments must be chronological" });
      break;
    }
  }

  if (result.recommended_payment_method === "full_payment" && payments.length !== 1) {
    errors.push({ requestId: request.request_id, field: "payment_plan", message: "full_payment must contain one payment" });
  }
  if (result.recommended_payment_method === "wait" && payments.length !== 1) {
    errors.push({ requestId: request.request_id, field: "payment_plan", message: "wait must contain one deferred payment" });
  }
  if (result.recommended_payment_method === "installments" && payments.length < 2) {
    errors.push({ requestId: request.request_id, field: "payment_plan", message: "installments must contain at least two payments" });
  }

  if (
    result.affordability_status ===
    "affordable_now"
  ) {
    if (
      result.recommended_payment_method !==
      "full_payment"
    ) {
      errors.push({
        requestId: request.request_id,
        field: "recommended_payment_method",
        message:
          "affordable_now must use full_payment",
      });
    }

    if (
      result.earliest_date_for_full_payment !==
      request.request_date
    ) {
      errors.push({
        requestId: request.request_id,
        field: "earliest_date_for_full_payment",
        message:
          "affordable_now must have request date as earliest full payment date",
      });
    }
  }

  if (result.recommended_payment_method === "partial_payment") {
    if (payments[0]?.date !== request.request_date || payments[1]?.date !== result.earliest_date_for_full_payment) {
      errors.push({ requestId: request.request_id, field: "payment_plan", message: "Partial payments must start on request date and finish on earliest full-payment date" });
    }
    if (!(result.amount_safe_to_pay > 0 && result.amount_safe_to_pay < request.requested_amount)) {
      errors.push({ requestId: request.request_id, field: "amount_safe_to_pay", message: "Partial payment requires a positive, non-full safe amount" });
    }
  }

  const expectedMethods: Record<string, string[]> = {
    affordable_now: ["full_payment"],
    affordable_with_plan: ["partial_payment", "installments", "full_payment"],
    affordable_later: ["wait"],
    not_affordable: ["not_recommended"],
  };
  if (!expectedMethods[result.affordability_status]?.includes(result.recommended_payment_method)) {
    errors.push({ requestId: request.request_id, field: "recommended_payment_method", message: "Payment method does not match affordability status" });
  }

  const changes = result.spending_changes_needed === "none" ? [] : result.spending_changes_needed.split("|");
  if (changes.length > 3 || changes.some((change) => !/^(stop:[^:]+|reduce_to:[^:]+:\d+(?:\.\d+)?)$/.test(change))) {
    errors.push({ requestId: request.request_id, field: "spending_changes_needed", message: "Spending changes must contain at most three valid actions" });
  }

  if (
    result.recommended_payment_method ===
    "partial_payment"
  ) {
    if (!request.allows_partial_payment) {
      errors.push({
        requestId: request.request_id,
        field: "payment_plan",
        message:
          "Partial payment is not allowed for this request",
      });
    }

    if (payments.length !== 2) {
      errors.push({
        requestId: request.request_id,
        field: "payment_plan",
        message:
          "Partial payment must contain exactly two payments",
      });
    }

    const total = payments.reduce(
      (sum, payment) => sum + payment.amount,
      0,
    );

    if (Math.abs(total - request.requested_amount) > 0.01) {
      errors.push({
        requestId: request.request_id,
        field: "payment_plan",
        message:
          "Partial payment plan must total requested amount",
      });
    }
  }

  if (
    result.recommended_payment_method ===
      "not_recommended" &&
    result.payment_plan !== "none"
  ) {
    errors.push({
      requestId: request.request_id,
      field: "payment_plan",
      message:
        "not_recommended must have payment_plan=none",
    });
  }

  return errors;
}
