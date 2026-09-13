import type { FinancialState } from "./finantial-state";
import type { ForecastResult } from "./forecast";
import { simulatePayment } from "./forecast";

export interface AffordabilityResult {
  amountSafeToPay: number;
  requestedAmount: number;
  minimumBalanceAfterPayment: number;
  minimumBalanceDate: string;
  isFullAmountSafe: boolean;
}

/**
 * Calculate the maximum amount that can be paid today
 * without causing the 90-day forecast to fall below
 * the user's required minimum balance.
 *
 * Uses binary search to efficiently find the maximum safe amount.
 * For each candidate amount, simulates the payment on request_date
 * and checks EVERY day of the 90-day forecast.
 *
 * Spending changes are NOT considered here.
 */
export function calculateAmountSafeToPay(
  state: FinancialState,
  forecast: ForecastResult,
): AffordabilityResult {
  const requestedAmount = state.request.requested_amount;
  const requestDate = state.request.request_date;

  // First check if paying 0 is even safe (i.e., baseline forecast stays above min)
  const zeroResult = simulatePayment(
    state,
    requestDate,
    0,
  );

  if (!zeroResult.safe) {
    return {
      amountSafeToPay: 0,
      requestedAmount,
      minimumBalanceAfterPayment: zeroResult.minBalance,
      minimumBalanceDate: zeroResult.minDate,
      isFullAmountSafe: false,
    };
  }

  // Check if full amount is safe
  const fullResult = simulatePayment(
    state,
    requestDate,
    requestedAmount,
  );

  if (fullResult.safe) {
    return {
      amountSafeToPay: requestedAmount,
      requestedAmount,
      minimumBalanceAfterPayment: fullResult.minBalance,
      minimumBalanceDate: fullResult.minDate,
      isFullAmountSafe: true,
    };
  }

  // Binary search for maximum safe amount
  let lo = 0;
  let hi = requestedAmount;
  const precision = 0.01;

  while (hi - lo > precision) {
    const mid = Math.floor((lo + hi) / 2 * 100) / 100;

    const result = simulatePayment(
      state,
      requestDate,
      mid,
    );

    if (result.safe) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Use lo (the highest known safe amount)
  const safeAmount = Math.floor(lo * 100) / 100;
  const finalResult = simulatePayment(
    state,
    requestDate,
    safeAmount,
  );

  return {
    amountSafeToPay: Math.max(0, Math.min(requestedAmount, safeAmount)),
    requestedAmount,
    minimumBalanceAfterPayment: finalResult.minBalance,
    minimumBalanceDate: finalResult.minDate,
    isFullAmountSafe: safeAmount >= requestedAmount,
  };
}