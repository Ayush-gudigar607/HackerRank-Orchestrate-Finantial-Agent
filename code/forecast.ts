import type { FinancialEvent } from "./types";
import { resolveEventAmount } from "./event-amount";
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

  return ![
    "cancelled",
    "canceled",
    "failed",
    "pending",
    "declined",
  ].includes(status);
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
    (item) =>
      item.rate_date === date &&
      item.from_currency === fromCurrency &&
      item.to_currency === homeCurrency,
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

function eventOccursOnDate(
  event: FinancialEvent,
  date: string,
): boolean {
  if (event.event_date === date) {
    return true;
  }

  const type = event.event_type.trim().toLowerCase();

  // Only treat clearly recurring events as recurring.
  const recurring =
    type.includes("recurring") ||
    type.includes("monthly") ||
    type.includes("weekly") ||
    type.includes("subscription");

  if (!recurring) {
    return false;
  }

  const start = new Date(`${event.event_date}T00:00:00Z`);
  const current = new Date(`${date}T00:00:00Z`);

  if (current < start) {
    return false;
  }

  const days =
    Math.floor(
      (current.getTime() - start.getTime()) /
        (24 * 60 * 60 * 1000),
    );

  if (type.includes("weekly")) {
    return days % 7 === 0;
  }

  if (
    type.includes("monthly") ||
    type.includes("subscription") ||
    type.includes("recurring")
  ) {
    return start.getUTCDate() === current.getUTCDate();
  }

  return false;
}

function isDuplicateEvent(
  event: FinancialEvent,
  allEvents: FinancialEvent[],
): boolean {
  if (!event.linked_event_id) {
    return false;
  }

  const linked = allEvents.find(
    (candidate) =>
      candidate.event_id === event.linked_event_id,
  );

  if (!linked) {
    return false;
  }

  // Prefer the newer/linked settled record when two
  // records represent the same financial event.
  const eventStatus = event.status.trim().toLowerCase();
  const linkedStatus = linked.status.trim().toLowerCase();

  if (
    eventStatus === "settled" &&
    linkedStatus !== "settled"
  ) {
    return false;
  }

  if (
    linkedStatus === "settled" &&
    eventStatus !== "settled"
  ) {
    return true;
  }

  return event.event_id > linked.event_id;
}

export function forecast90Days(
  state: FinancialState,
): ForecastResult {
  const startDate = state.request.request_date;
  const endDate = addDays(
    startDate,
    FORECAST_DAYS,
  );

  const dailyBalances: DailyBalance[] = [];

  let balance = state.profile.current_balance;
  let minimumBalance = balance;
  let minimumBalanceDate = startDate;

  const usableEvents = state.events.filter(
    (event) =>
      isValidEvent(event) &&
      !isDuplicateEvent(event, state.events),
  );

  for (
    let day = 0;
    day <= FORECAST_DAYS;
    day++
  ) {
    const date = addDays(startDate, day);

    const eventsForDay = usableEvents.filter(
      (event) =>
        eventOccursOnDate(event, date),
    );

    for (const event of eventsForDay) {
      const resolved = resolveEventAmount(
  state,
  event,
);

if (resolved.amount === null) {
  continue;
}

const amount = convertToHomeCurrency(
  state,
  resolved.amount,
  event.currency,
  event.event_date,
);

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
    startingBalance:
      state.profile.current_balance,
    minimumBalance,
    minimumBalanceDate,
    dailyBalances,
    staysAboveMinimum:
      minimumBalance >=
      state.profile.minimum_balance_to_keep,
  };
}