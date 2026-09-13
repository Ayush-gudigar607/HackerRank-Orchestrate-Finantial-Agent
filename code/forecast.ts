import type { FinancialEvent } from "./types";
import type { FinancialState } from "./finantial-state";

export interface DailyBalance {
  date: string;
  balance: number;
}

export interface ForecastResult {
  startDate: string;
  endDate: string;
  startingBalance: number;
  minimumBalance: number;
  minimumBalanceDate: string;
  dailyBalances: DailyBalance[];
  staysAboveMinimum: boolean;
}

const FORECAST_DAYS = 90;

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function isValidEvent(event: FinancialEvent): boolean {
  const status = event.status.trim().toLowerCase();

  if (status === "cancelled") {
    return false;
  }

  if (status === "failed") {
    return false;
  }

  if (status === "pending") {
    return false;
  }

  if (status === "declined") {
    return false;
  }

  return true;
}

function isIncomeEvent(event: FinancialEvent): boolean {
  const type = event.event_type.trim().toLowerCase();

  return (
    type.includes("income") ||
    type.includes("salary") ||
    type.includes("deposit") ||
    type.includes("refund")
  );
}

function convertToHomeCurrency(
  state: FinancialState,
  amount: number,
  fromCurrency: string,
  date: string,
): number {
  const homeCurrency = state.profile.currency;

  if (fromCurrency === homeCurrency) {
    return amount;
  }

  const rate = state.exchangeRates.find(
    (rate) =>
      rate.rate_date === date &&
      rate.from_currency === fromCurrency &&
      rate.to_currency === homeCurrency,
  );

  if (!rate) {
    throw new Error(
      `Missing exchange rate: ${fromCurrency} -> ${homeCurrency} on ${date}`,
    );
  }

  return amount * rate.rate;
}

function eventAmountInHomeCurrency(
  state: FinancialState,
  event: FinancialEvent,
): number | null {
  if (event.amount === null) {
    return null;
  }

  return convertToHomeCurrency(
    state,
    event.amount,
    event.currency,
    event.event_date,
  );
}

export function forecast90Days(
  state: FinancialState,
): ForecastResult {
  const startDate = state.request.request_date;
  const endDate = addDays(startDate, FORECAST_DAYS);

  const dailyBalances: DailyBalance[] = [];

  let balance = state.profile.current_balance;

  let minimumBalance = balance;
  let minimumBalanceDate = startDate;

  for (let day = 0; day <= FORECAST_DAYS; day++) {
    const date = addDays(startDate, day);

    const eventsForDay = state.events.filter(
      (event) =>
        event.event_date === date &&
        isValidEvent(event),
    );

    for (const event of eventsForDay) {
      const amount = eventAmountInHomeCurrency(
        state,
        event,
      );

      // Amount is unknown.
      // Image resolution will happen before the final forecast.
      if (amount === null) {
        continue;
      }

      if (isIncomeEvent(event)) {
        balance += amount;
      } else {
        balance -= amount;
      }
    }

    dailyBalances.push({
      date,
      balance,
    });

    if (balance < minimumBalance) {
      minimumBalance = balance;
      minimumBalanceDate = date;
    }
  }

  return {
    startDate,
    endDate,
    startingBalance: state.profile.current_balance,
    minimumBalance,
    minimumBalanceDate,
    dailyBalances,
    staysAboveMinimum:
      minimumBalance >= state.profile.minimum_balance_to_keep,
  };
}