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
function detectIntervalFromDates(dates: string[]): number | null {
  if (dates.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const diff = dateDiffDays(dates[i - 1]!, dates[i]!);
    if (diff > 0) intervals.push(diff);
  }
  if (intervals.length === 0) return null;
  const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  if (avg >= 25 && avg <= 35) return 30;
  if (avg >= 12 && avg <= 16) return 14;
  if (avg >= 5 && avg <= 9) return 7;
  if (avg >= 85 && avg <= 95) return 90;
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

  // For two linked records with neither settled, retain the newer record.
  // Event ids are generated in chronological order in the supplied dataset,
  // so the older record is the duplicate.
  return event.event_id < linked.event_id;
}

/**
 * Build a map of event_date -> net balance change for the forecast period.
 * Handles both one-time and recurring events without multiplying historical clones.
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

  // 1. One-time occurrences already scheduled in the forecast window
  const scheduledDatesByEvent = new Set<string>();
  for (const event of usableEvents) {
    if (stoppedEvents.has(event.event_id)) continue;

    const effectiveDate = event.settlement_date || event.event_date;
    if (effectiveDate >= startDate && effectiveDate <= endDate) {
      const resolved = resolveEventAmount(state, event);
      if (resolved.amount === null) continue;

      let amount = resolved.amount;
      if (reducedEvents.has(event.event_id)) {
        amount = reducedEvents.get(event.event_id)!;
      }

      const amountHome = convertToHomeCurrency(
        state.exchangeRates,
        state.profile.currency,
        amount,
        event.currency,
        effectiveDate,
      );

      const signedAmount = isCredit(event) ? amountHome : -amountHome;
      changes.set(
        effectiveDate,
        (changes.get(effectiveDate) ?? 0) + signedAmount,
      );
      scheduledDatesByEvent.add(`${event.category}|${effectiveDate}`);
    }
  }

  // 2. Group recurring events by series:
  // For expenses: group by category and description
  // For salary/income: group by category === 'salary' or isCredit(event)
  const expenseSeriesMap = new Map<string, FinancialEvent[]>();
  const incomeSeries: FinancialEvent[] = [];

  for (const event of usableEvents) {
    if (isCredit(event)) {
      incomeSeries.push(event);
    } else {
      const key = `${event.category}|${event.description}`;
      if (!expenseSeriesMap.has(key)) {
        expenseSeriesMap.set(key, []);
      }
      expenseSeriesMap.get(key)!.push(event);
    }
  }

  // Project expense series from latest event only
  for (const [key, events] of expenseSeriesMap.entries()) {
    events.sort((a, b) =>
      (a.settlement_date || a.event_date).localeCompare(
        b.settlement_date || b.event_date,
      ),
    );
    const dates = events.map((e) => e.settlement_date || e.event_date);
    const interval = detectIntervalFromDates(dates);

    if (interval !== null) {
      const latest = events[events.length - 1]!;
      if (stoppedEvents.has(latest.event_id)) continue;

      const resolved = resolveEventAmount(state, latest);
      if (resolved.amount === null) continue;

      let amount = resolved.amount;
      if (reducedEvents.has(latest.event_id)) {
        amount = reducedEvents.get(latest.event_id)!;
      }

      const amountHome = convertToHomeCurrency(
        state.exchangeRates,
        state.profile.currency,
        amount,
        latest.currency,
        latest.settlement_date || latest.event_date,
      );
      const signedAmount = -amountHome;

      let nextDate = latest.settlement_date || latest.event_date;
      while (nextDate <= endDate) {
        nextDate = addDays(nextDate, interval);
        if (nextDate >= startDate && nextDate <= endDate) {
          if (!scheduledDatesByEvent.has(`${latest.category}|${nextDate}`)) {
            changes.set(
              nextDate,
              (changes.get(nextDate) ?? 0) + signedAmount,
            );
          }
        }
      }
    }
  }

  // Project income/salary series from latest confirmed salary
  if (incomeSeries.length >= 1) {
    incomeSeries.sort((a, b) =>
      (a.settlement_date || a.event_date).localeCompare(
        b.settlement_date || b.event_date,
      ),
    );
    const latestIncome = incomeSeries[incomeSeries.length - 1]!;
    const desc = latestIncome.description.toLowerCase();

    // Only project if not a "final" severance or terminated payroll
    if (
      !desc.includes("final") &&
      !desc.includes("terminated") &&
      !desc.includes("last")
    ) {
      const dates = incomeSeries.map(
        (e) => e.settlement_date || e.event_date,
      );
    // Do not invent a monthly income stream from one observed payment.  A
    // future income forecast needs a demonstrated cadence (or an explicit
    // scheduled event, which was handled above).
    const interval = detectIntervalFromDates(dates);

    if (interval !== null) {
      const resolved = resolveEventAmount(state, latestIncome);
      if (resolved.amount !== null && resolved.amount > 0) {
        const amountHome = convertToHomeCurrency(
          state.exchangeRates,
          state.profile.currency,
          resolved.amount,
          latestIncome.currency,
          latestIncome.settlement_date || latestIncome.event_date,
        );

        let nextDate =
          latestIncome.settlement_date || latestIncome.event_date;
        while (nextDate <= endDate) {
          nextDate = addDays(nextDate, interval);
          if (nextDate >= startDate && nextDate <= endDate) {
            if (
              !scheduledDatesByEvent.has(
                `${latestIncome.category}|${nextDate}`,
              )
            ) {
              changes.set(
                nextDate,
                (changes.get(nextDate) ?? 0) + amountHome,
              );
            }
          }
        }
      }
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

  // Reserve pending debits immediately from available balance
  for (const e of state.events) {
    if (e.status.trim().toLowerCase() === "pending" && !isCredit(e)) {
      const r = resolveEventAmount(state, e);
      if (r.amount !== null) {
        balance -= convertToHomeCurrency(
          state.exchangeRates,
          state.profile.currency,
          r.amount,
          e.currency,
          e.settlement_date || e.event_date,
        );
      }
    }
  }

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
