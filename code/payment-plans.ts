import type { FinancialState } from "./finantial-state";
import type { ForecastResult } from "./forecast";
import type { AffordabilityResult } from "./affordability";

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
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
 * Find the earliest date on which the complete request
 * can safely be paid in one payment.
 */
export function findEarliestFullPaymentDate(
  state: FinancialState,
  forecast: ForecastResult,
): string | null {
  const requestedAmount = state.request.requested_amount;
  const minimumBalance =
    state.profile.minimum_balance_to_keep;

  for (const daily of forecast.dailyBalances) {
    const available =
      daily.balance - minimumBalance;

    if (available >= requestedAmount) {
      return daily.date;
    }
  }

  return null;
}

/**
 * Create a payment plan using the safest eligible method.
 *
 * Spending changes are intentionally NOT considered here.
 */
export function createPaymentPlan(
  state: FinancialState,
  forecast: ForecastResult,
  affordability: AffordabilityResult,
): PaymentPlan {
  const requestDate = state.request.request_date;
  const requestedAmount = state.request.requested_amount;
  const safeToday = affordability.amountSafeToPay;

  /*
   * Case 1:
   * Full amount can safely be paid today.
   */
  if (
    safeToday >= requestedAmount &&
    isPaymentMethodAllowed(state, "full_payment")
  ) {
    return {
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
    };
  }

  /*
   * Find when the complete amount becomes affordable.
   */
  const earliestFullPaymentDate =
    findEarliestFullPaymentDate(state, forecast);

  /*
   * Case 2:
   * User allows partial payment and the remaining amount
   * can be paid by the desired completion date.
   *
   * The challenge requires exactly two payments.
   */
  if (
    state.request.allows_partial_payment &&
    isPaymentMethodAllowed(state, "partial_payment") &&
    safeToday > 0 &&
    safeToday < requestedAmount &&
    earliestFullPaymentDate !== null &&
    earliestFullPaymentDate <=
      state.request.desired_completion_date
  ) {
    const remaining =
      requestedAmount - safeToday;

    return {
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
    };
  }

  /*
   * Case 3:
   * Full payment is possible later and the user accepts
   * full payment.
   */
  if (
    earliestFullPaymentDate !== null &&
    isPaymentMethodAllowed(state, "full_payment")
  ) {
    return {
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
    };
  }

  /*
   * Case 4:
   * Try installments using the supplied payment options.
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
      const interval =
        option.recurring_interval.toLowerCase();

      let months = 1;

      if (interval.includes("3")) {
        months = 3;
      } else if (interval.includes("6")) {
        months = 6;
      } else if (interval.includes("9")) {
        months = 9;
      } else if (interval.includes("12")) {
        months = 12;
      }

      if (
        state.profile.max_installment_months !== null &&
        months >
          state.profile.max_installment_months
      ) {
        continue;
      }

      const installmentAmount =
        option.total_payable / months;

      const payments: {
        date: string;
        amount: number;
      }[] = [];

      let safe = true;

      for (let month = 0; month < months; month++) {
        const date = addDays(
          option.start_date,
          month * 30,
        );

        const daily = forecast.dailyBalances.find(
          (item) => item.date === date,
        );

        if (!daily) {
          safe = false;
          break;
        }

        const available =
          daily.balance -
          state.profile.minimum_balance_to_keep;

        if (available < installmentAmount) {
          safe = false;
          break;
        }

        payments.push({
          date,
          amount:
            month === months - 1
              ? option.total_payable -
                installmentAmount * (months - 1)
              : installmentAmount,
        });
      }

      if (safe) {
        return {
          paymentMethod: "installments",
          payments,
          totalAmount: option.total_payable,
          earliestFullPaymentDate,
          isSafe: true,
        };
      }
    }
  }

  /*
   * Nothing safe and eligible was found.
   */
  return {
    paymentMethod: "not_recommended",
    payments: [],
    totalAmount: 0,
    earliestFullPaymentDate,
    isSafe: false,
  };
}