import type { FinancialState } from "./finantial-state";
import type { ForecastResult } from "./forecast";
import type { AffordabilityResult } from "./affordability";
import {
  addDays,
  simulatePayment,
  simulatePayments,
} from "./forecast";

export interface PaymentPlan {
  paymentMethod:
    | "full_payment"
    | "partial_payment"
    | "installments"
    | "wait"
    | "not_recommended";

  payments: {
    date: string;
    amount: number;
  }[];

  totalAmount: number;

  earliestFullPaymentDate: string | null;

  isSafe: boolean;

  paymentOptionId?: string;

  requiresSpendingChanges: boolean;
}

function isPaymentMethodAllowed(
  state: FinancialState,
  method: string,
): boolean {
  const allowed = state.profile.payment_methods_user_will_consider
    .split(/[|,;]/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(method.toLowerCase());
}

/**
 * Find the earliest date on which the entire requested amount
 * can safely be paid as a single payment.
 *
 * For each candidate date, simulates the full payment and verifies
 * the minimum balance on EVERY remaining forecast day.
 */
export function findEarliestFullPaymentDate(
  state: FinancialState,
  forecast: ForecastResult,
  stoppedEvents: Set<string> = new Set(),
  reducedEvents: Map<string, number> = new Map(),
): string | null {
  const requestedAmount = state.request.requested_amount;

  for (const daily of forecast.dailyBalances) {
    const result = simulatePayment(
      state,
      daily.date,
      requestedAmount,
      stoppedEvents,
      reducedEvents,
    );

    if (result.safe) {
      return daily.date;
    }
  }

  return null;
}

/**
 * Generate ALL eligible safe plans and rank them.
 *
 * Ranking rules (in order):
 * 1. Complete the full request by the deadline
 * 2. No spending changes
 * 3. Minimize total amount paid
 * 4. Start earlier
 * 5. Fewer payments
 * 6. Lowest payment_option_id
 */
export function createPaymentPlan(
  state: FinancialState,
  forecast: ForecastResult,
  affordability: AffordabilityResult,
): PaymentPlan {
  const requestDate = state.request.request_date;
  const requestedAmount = state.request.requested_amount;
  const safeToday = affordability.amountSafeToPay;
  const desiredDate = state.request.desired_completion_date;

  const candidates: PaymentPlan[] = [];

  // Find earliest full payment date
  const earliestFullPaymentDate =
    findEarliestFullPaymentDate(state, forecast);

  /*
   * Case 1: Full payment today
   */
  if (
    safeToday >= requestedAmount &&
    isPaymentMethodAllowed(state, "full_payment")
  ) {
    candidates.push({
      paymentMethod: "full_payment",
      payments: [
        {
          date: requestDate,
          amount: requestedAmount,
        },
      ],
      totalAmount: requestedAmount,
      earliestFullPaymentDate: requestDate,
      isSafe: true,
      requiresSpendingChanges: false,
    });
  }

  /*
   * Case 2: Partial payment
   * Requires: allows_partial_payment, user accepts it,
   * 0 < safeToday < requestedAmount,
   * full payment becomes safe by desired_completion_date
   */
  if (
    state.request.allows_partial_payment &&
    isPaymentMethodAllowed(state, "partial_payment") &&
    safeToday > 0 &&
    safeToday < requestedAmount &&
    earliestFullPaymentDate !== null &&
    earliestFullPaymentDate <= desiredDate
  ) {
    const remaining = requestedAmount - safeToday;

    // Verify the two-payment plan is actually safe
    const planResult = simulatePayments(
      state,
      [
        { date: requestDate, amount: safeToday },
        { date: earliestFullPaymentDate, amount: remaining },
      ],
    );

    if (planResult.safe) {
      candidates.push({
        paymentMethod: "partial_payment",
        payments: [
          {
            date: requestDate,
            amount: safeToday,
          },
          {
            date: earliestFullPaymentDate,
            amount: remaining,
          },
        ],
        totalAmount: requestedAmount,
        earliestFullPaymentDate,
        isSafe: true,
        requiresSpendingChanges: false,
      });
    }
  }

  /*
   * Case 3: Installments using supplied payment options
   */
  if (isPaymentMethodAllowed(state, "installments")) {
    const installmentOptions = state.paymentOptions
      .filter(
        (option) =>
          option.payment_method.toLowerCase() ===
          "installments",
      )
      .sort(
        (a, b) =>
          a.total_payable - b.total_payable ||
          a.payment_option_id.localeCompare(
            b.payment_option_id,
          ),
      );

    for (const option of installmentOptions) {
      const paymentsCount = option.number_of_payments;
      const paymentFrequencyDays =
        option.payment_frequency_days;

      if (
        !Number.isInteger(paymentsCount) ||
        paymentsCount < 2 ||
        paymentFrequencyDays === null ||
        paymentFrequencyDays <= 0
      ) {
        continue;
      }

      // Respect max_installment_months
      if (
        state.profile.max_installment_months !== null &&
        paymentsCount >
          state.profile.max_installment_months
      ) {
        continue;
      }

      // Build individual payments from the option
      const payments: {
        date: string;
        amount: number;
      }[] = [];

      for (
        let paymentIndex = 0;
        paymentIndex < paymentsCount;
        paymentIndex++
      ) {
        const date = addDays(
          option.first_payment_date,
          paymentIndex * paymentFrequencyDays,
        );

        payments.push({
          date,
          amount:
            paymentIndex === paymentsCount - 1
              ? option.total_payable -
                option.payment_amount * (paymentsCount - 1)
              : option.payment_amount,
        });
      }

      // Verify the ENTIRE installment plan against the 90-day forecast
      const planResult = simulatePayments(state, payments);

      if (planResult.safe) {
        // Check if last payment is within forecast period
        const lastPaymentDate =
          payments[payments.length - 1]!.date;

        candidates.push({
          paymentMethod: "installments",
          payments,
          totalAmount: option.total_payable,
          earliestFullPaymentDate,
          isSafe: true,
          paymentOptionId: option.payment_option_id,
          requiresSpendingChanges: false,
        });
      }
    }
  }

  /*
   * Case 4: Wait for full payment later
   */
  if (
    earliestFullPaymentDate !== null &&
    earliestFullPaymentDate !== requestDate &&
    isPaymentMethodAllowed(state, "full_payment")
  ) {
    candidates.push({
      paymentMethod: "wait",
      payments: [
        {
          date: earliestFullPaymentDate,
          amount: requestedAmount,
        },
      ],
      totalAmount: requestedAmount,
      earliestFullPaymentDate,
      isSafe: true,
      requiresSpendingChanges: false,
    });
  }

  // If no candidates found, return not_recommended
  if (candidates.length === 0) {
    return {
      paymentMethod: "not_recommended",
      payments: [],
      totalAmount: 0,
      earliestFullPaymentDate,
      isSafe: false,
      requiresSpendingChanges: false,
    };
  }

  // Rank candidates
  candidates.sort((a, b) => {
    // 1. Complete full request by deadline
    const aByDeadline = completesBeforeDeadline(a, desiredDate);
    const bByDeadline = completesBeforeDeadline(b, desiredDate);
    if (aByDeadline && !bByDeadline) return -1;
    if (!aByDeadline && bByDeadline) return 1;

    // 2. No spending changes preferred
    if (!a.requiresSpendingChanges && b.requiresSpendingChanges)
      return -1;
    if (a.requiresSpendingChanges && !b.requiresSpendingChanges)
      return 1;

    // 3. Minimize total amount paid
    if (a.totalAmount !== b.totalAmount)
      return a.totalAmount - b.totalAmount;

    // 4. Start earlier
    const aStart = a.payments[0]?.date ?? "";
    const bStart = b.payments[0]?.date ?? "";
    if (aStart !== bStart) return aStart.localeCompare(bStart);

    // 5. Fewer payments
    if (a.payments.length !== b.payments.length)
      return a.payments.length - b.payments.length;

    // 6. Lowest payment_option_id
    const aId = a.paymentOptionId ?? "";
    const bId = b.paymentOptionId ?? "";
    return aId.localeCompare(bId);
  });

  return candidates[0]!;
}

function completesBeforeDeadline(
  plan: PaymentPlan,
  deadline: string,
): boolean {
  if (plan.payments.length === 0) return false;
  const lastPaymentDate =
    plan.payments[plan.payments.length - 1]!.date;
  return lastPaymentDate <= deadline;
}