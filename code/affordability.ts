import type { FinancialState } from "./finantial-state";
import type { ForecastResult } from "./forecast";

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
 * Spending changes are NOT considered here.
 */
export function calculateAmountSafeToPay(
  state: FinancialState,
  forecast: ForecastResult,
): AffordabilityResult {
  const requestedAmount = state.request.requested_amount;
  const minimumRequired = state.profile.minimum_balance_to_keep;

  /*
   * The forecast already contains balances after all
   * normal financial events.
   *
   * If we pay an additional amount today, that amount
   * reduces every balance from today onward.
   */
  const minimumForecastBalance = forecast.minimumBalance;
  
  /*
   * Maximum amount we can remove while still keeping
   * the minimum forecast balance >= required minimum.
   */
  const safeAmountFromForecast =
    minimumForecastBalance - minimumRequired;

  /*
   * A negative value means the user is already projected
   * to fall below their minimum balance even without this request.
   */
  const amountSafeToPay = Math.max(
    0,
    Math.min(requestedAmount, safeAmountFromForecast),
  );

  const minimumBalanceAfterPayment =
    minimumForecastBalance - amountSafeToPay;

  return {
    amountSafeToPay,
    requestedAmount,
    minimumBalanceAfterPayment,
    minimumBalanceDate: forecast.minimumBalanceDate,
    isFullAmountSafe:
      amountSafeToPay >= requestedAmount,
  };
}