import type { FinancialEvent, ExchangeRate } from "./types";
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

export function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateDiffDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  return Math.round(
    (db.getTime() - da.getTime()) / (24 * 60 * 60 * 1000),
  );
}

/**
 * Determine if an event should be included in the forecast.
 * Ignore pending, failed, cancelled/canceled, declined events.
 * Also ignore unrealized investment gains.
 */
function isValidCashEvent(event: FinancialEvent): boolean {
  const status = event.status.trim().toLowerCase();

  if (
    [
      "cancelled",
      "canceled",
      "failed",
      "pending",
      "declined",
      "unrealized",
    ].includes(status)
  ) {
    return false;
  }

  return true;
}

/**
 * Determine if an event generates income (credit) based on direction field.
 */
function isCredit(event: FinancialEvent): boolean {
  const direction = event.direction.trim().toLowerCase();
  if (direction === "credit") return true;
  if (direction === "debit") return false;

  // Fallback to event_type if direction is not set
  const type = event.event_type.trim().toLowerCase();
  return (
    type.includes("income") ||
    type.includes("salary") ||
    type.includes("deposit") ||
    type.includes("refund") ||
    type.includes("credit")
  );
}

/**
 * Convert amount to home currency using supplied FX rates.
 * Uses the closest available rate date (rates are typically monthly on the 15th).
 */
function convertToHomeCurrency(
  exchangeRates: ExchangeRate[],
  homeCurrency: string,
  amount: number,
  fromCurrency: string,
  date: string,
): number {
  if (fromCurrency === homeCurrency) {
    return amount;
  }

  // Find exact date match first
  let rate = exchangeRates.find(
    (item) =>
      item.rate_date === date &&
      item.from_currency === fromCurrency &&
      item.to_currency === homeCurrency,
  );

  if (!rate) {
    // Find nearest rate date
    const candidates = exchangeRates.filter(
      (item) =>
        item.from_currency === fromCurrency &&
        item.to_currency === homeCurrency,
    );

    if (candidates.length > 0) {
      candidates.sort(
        (a, b) =>
          Math.abs(dateDiffDays(a.rate_date, date)) -
          Math.abs(dateDiffDays(b.rate_date, date)),
      );
      rate = candidates[0]!;
    }
  }

  if (!rate) {
    // Try reverse rate
    let reverseRate = exchangeRates.find(
      (item) =>
        item.rate_date === date &&
        item.from_currency === homeCurrency &&
        item.to_currency === fromCurrency,
    );

    if (!reverseRate) {
      const reverseCandidates = exchangeRates.filter(
        (item) =>
          item.from_currency === homeCurrency &&
          item.to_currency === fromCurrency,
      );
      if (reverseCandidates.length > 0) {
        reverseCandidates.sort(
          (a, b) =>
            Math.abs(dateDiffDays(a.rate_date, date)) -
            Math.abs(dateDiffDays(b.rate_date, date)),
        );
        reverseRate = reverseCandidates[0]!;
      }
    }

    if (reverseRate) {
      return amount / reverseRate.rate;
    }

    // If no rate found, return the amount as-is (same-currency assumption)
    console.warn(
      `No exchange rate found: ${fromCurrency} -> ${homeCurrency} near ${date}, using amount as-is`,
    );
    return amount;
  }

  return amount * rate.rate;
}

/**
 * Detect if an event is recurring by analyzing event history.
 * Only events that actually repeat on a pattern in the dataset are treated
 * as recurring - we don't invent patterns.
 */
function detectRecurrenceInterval(
  event: FinancialEvent,
  allEvents: FinancialEvent[],
): number | null {
  // Find events with same category, direction, and similar description
  const similar = allEvents.filter(
    (e) =>
      e.event_id !== event.event_id &&
      e.user_id === event.user_id &&
      e.category === event.category &&
      e.direction === event.direction &&
      e.status !== "cancelled" &&
      e.status !== "canceled" &&
      e.status !== "failed" &&
      e.description === event.description,
  );

  if (similar.length < 2) return null;

  // Sort by date
  const dates = [...similar, event]
    .map((e) => e.event_date)
    .sort();

  // Calculate intervals between consecutive occurrences
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const diff = dateDiffDays(dates[i - 1]!, dates[i]!);
    if (diff > 0) {
      intervals.push(diff);
    }
  }

  if (intervals.length < 2) return null;

  // Check if intervals are roughly consistent
  const avgInterval =
    intervals.reduce((s, v) => s + v, 0) / intervals.length;

  // Allow 5-day tolerance for monthly patterns
  const consistent = intervals.every(
    (i) => Math.abs(i - avgInterval) <= 5,
  );

  if (!consistent) return null;

  // Round to common periods
  if (avgInterval >= 26 && avgInterval <= 35) return 30; // monthly
  if (avgInterval >= 5 && avgInterval <= 9) return 7; // weekly
  if (avgInterval >= 12 && avgInterval <= 16) return 14; // bi-weekly
  if (avgInterval >= 85 && avgInterval <= 95) return 90; // quarterly

  return null;
}

/**
 * Check if a linked event is a duplicate that should be skipped.
 * Conflict resolution:
 * 1. Settled over non-settled
 * 2. Newer event_id wins for same status
 */
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

  const eventStatus = event.status.trim().toLowerCase();
  const linkedStatus = linked.status.trim().toLowerCase();

  // Settled record always wins
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

  // Newer event_id takes precedence (larger event_id = newer)
  return event.event_id > linked.event_id;
}

/**
 * Build a map of event_date -> net balance change for the forecast period.
 * Handles both one-time and recurring events.
 */
function buildDailyChanges(
  state: FinancialState,
  startDate: string,
  endDate: string,
  stoppedEvents: Set<string>,
  reducedEvents: Map<string, number>,
): Map<string, number> {
  const changes = new Map<string, number>();

  const usableEvents = state.events.filter(
    (event) =>
      isValidCashEvent(event) &&
      !isDuplicateEvent(event, state.events),
  );

  for (const event of usableEvents) {
    if (stoppedEvents.has(event.event_id)) continue;

    const resolved = resolveEventAmount(state, event);
    if (resolved.amount === null) continue;

    let amount = resolved.amount;

    // Apply reduction if applicable
    if (reducedEvents.has(event.event_id)) {
      amount = reducedEvents.get(event.event_id)!;
    }

    const amountHome = convertToHomeCurrency(
      state.exchangeRates,
      state.profile.currency,
      amount,
      event.currency,
      event.settlement_date || event.event_date,
    );

    const signedAmount = isCredit(event)
      ? amountHome
      : -amountHome;

    // Get the effective date for the event
    const effectiveDate = event.settlement_date || event.event_date;

    // One-time: if within forecast window
    if (effectiveDate >= startDate && effectiveDate <= endDate) {
      changes.set(
        effectiveDate,
        (changes.get(effectiveDate) ?? 0) + signedAmount,
      );
    }

    // Recurring: detect from history and project forward
    const interval = detectRecurrenceInterval(
      event,
      state.events,
    );

    if (interval !== null) {
      // Find the latest occurrence date
      const lastDate = effectiveDate;

      // Project forward from the last known occurrence
      let nextDate = lastDate;

      // Advance to get occurrences within forecast window
      while (nextDate < startDate) {
        nextDate = addDays(nextDate, interval);
      }

      // If the one-time date already added this, skip the first occurrence
      while (nextDate <= endDate) {
        if (nextDate !== effectiveDate) {
          changes.set(
            nextDate,
            (changes.get(nextDate) ?? 0) + signedAmount,
          );
        }
        nextDate = addDays(nextDate, interval);
      }
    }
  }

  return changes;
}

/**
 * Run a 90-day forecast from the given start date.
 */
export function forecast90Days(
  state: FinancialState,
  stoppedEvents: Set<string> = new Set(),
  reducedEvents: Map<string, number> = new Map(),
): ForecastResult {
  const startDate = state.request.request_date;
  const endDate = addDays(startDate, FORECAST_DAYS);

  const dailyBalances: DailyBalance[] = [];

  let balance = state.profile.current_balance;
  let minimumBalance = balance;
  let minimumBalanceDate = startDate;

  const dailyChanges = buildDailyChanges(
    state,
    startDate,
    endDate,
    stoppedEvents,
    reducedEvents,
  );

  for (
    let day = 0;
    day <= FORECAST_DAYS;
    day++
  ) {
    const date = addDays(startDate, day);

    const change = dailyChanges.get(date) ?? 0;
    balance += change;

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
      minimumBalance >=
      state.profile.minimum_balance_to_keep,
  };
}

/**
 * Simulate a payment on a specific date and check safety.
 * Returns the minimum balance across the entire remaining forecast.
 */
export function simulatePayment(
  state: FinancialState,
  paymentDate: string,
  paymentAmount: number,
  stoppedEvents: Set<string> = new Set(),
  reducedEvents: Map<string, number> = new Map(),
): { safe: boolean; minBalance: number; minDate: string } {
  const forecast = forecast90Days(
    state,
    stoppedEvents,
    reducedEvents,
  );

  const minRequired = state.profile.minimum_balance_to_keep;
  let minBalance = Infinity;
  let minDate = "";

  for (const daily of forecast.dailyBalances) {
    let effectiveBalance = daily.balance;

    // If this day is on or after the payment date, subtract payment
    if (daily.date >= paymentDate) {
      effectiveBalance -= paymentAmount;
    }

    if (effectiveBalance < minBalance) {
      minBalance = effectiveBalance;
      minDate = daily.date;
    }
  }

  return {
    safe: minBalance >= minRequired,
    minBalance,
    minDate,
  };
}

/**
 * Simulate multiple payments and check overall safety.
 */
export function simulatePayments(
  state: FinancialState,
  payments: { date: string; amount: number }[],
  stoppedEvents: Set<string> = new Set(),
  reducedEvents: Map<string, number> = new Map(),
): { safe: boolean; minBalance: number } {
  const forecast = forecast90Days(
    state,
    stoppedEvents,
    reducedEvents,
  );

  const minRequired = state.profile.minimum_balance_to_keep;
  let minBalance = Infinity;

  for (const daily of forecast.dailyBalances) {
    let effectiveBalance = daily.balance;

    // Subtract all payments that occur on or before this day
    for (const payment of payments) {
      if (daily.date >= payment.date) {
        effectiveBalance -= payment.amount;
      }
    }

    if (effectiveBalance < minBalance) {
      minBalance = effectiveBalance;
    }
  }

  return {
    safe: minBalance >= minRequired,
    minBalance,
  };
}

export { convertToHomeCurrency, isValidCashEvent, isCredit, isDuplicateEvent };