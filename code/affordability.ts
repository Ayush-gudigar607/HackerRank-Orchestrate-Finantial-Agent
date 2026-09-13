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

  const minRequired = state.profile.minimum_balance_to_keep;
  const maxBuffer = forecast.minimumBalance - minRequired;
  const safeAmount = Math.max(
    0,
    Math.min(requestedAmount, Math.floor(maxBuffer * 100) / 100),
  );

  const finalResult = simulatePayment(
    state,
    requestDate,
    safeAmount,
  );

  return {
    amountSafeToPay: safeAmount,
    requestedAmount,
    minimumBalanceAfterPayment: finalResult.minBalance,
    minimumBalanceDate: finalResult.minDate,
    isFullAmountSafe: safeAmount >= requestedAmount,
  };
}