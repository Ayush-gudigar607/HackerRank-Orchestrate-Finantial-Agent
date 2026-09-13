import type { FinancialState } from "./finantial-state";
import type { FinancialEvent } from "./types";
import { simulatePayment } from "./forecast";

export interface SpendingChange {
  action: "stop" | "reduce_to";
  eventId: string;
  newAmount?: number;
}

export interface SpendingPlan {
  changes: SpendingChange[];
  totalSavings: number;
  isSafe: boolean;
}

/**
 * Check whether an event is a protected expense category.
 */
function isProtectedCategory(
  state: FinancialState,
  event: FinancialEvent,
): boolean {
  const protectedCategories =
    state.profile.expense_categories_to_protect
      .split(/[|,;]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

  const category = event.category.trim().toLowerCase();
  const eventType = event.event_type.trim().toLowerCase();

  return protectedCategories.some(
    (item) =>
      category.includes(item) || eventType.includes(item),
  );
}

/**
 * Check whether an event is income (should never be changed).
 */
function isIncomeEvent(event: FinancialEvent): boolean {
  const direction = event.direction.trim().toLowerCase();
  if (direction === "credit") return true;

  const type = event.event_type.trim().toLowerCase();
  return (
    type.includes("income") ||
    type.includes("salary") ||
    type.includes("deposit") ||
    type.includes("refund")
  );
}

/**
 * Check whether an event is a one-time expense (not recurring).
 * Only recurring/flexible expenses should be changed.
 */
function isRecurringFlexible(event: FinancialEvent): boolean {
  const flexibility = event.flexibility.trim().toLowerCase();
  return (
    flexibility === "stoppable" ||
    flexibility === "reducible" ||
    flexibility === "flexible"
  );
}

/**
 * Determine whether the event can be completely stopped.
 */
function canStopEvent(
  state: FinancialState,
  event: FinancialEvent,
): boolean {
  if (event.flexibility.trim().toLowerCase() !== "stoppable") {
    return false;
  }

  const stoppable =
    state.profile.expense_categories_user_is_willing_to_stop
      .split(/[|,;]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

  const category = event.category.trim().toLowerCase();
  const eventType = event.event_type.trim().toLowerCase();

  return stoppable.some(
    (item) =>
      category.includes(item) || eventType.includes(item),
  );
}

/**
 * Determine whether the event can be reduced.
 */
function canReduceEvent(
  state: FinancialState,
  event: FinancialEvent,
): boolean {
  const flexibility = event.flexibility.trim().toLowerCase();
  if (flexibility !== "reducible" && flexibility !== "flexible") {
    return false;
  }

  const reducible =
    state.profile.expense_categories_user_is_willing_to_reduce
      .split(/[|,;]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

  const category = event.category.trim().toLowerCase();
  const eventType = event.event_type.trim().toLowerCase();

  return reducible.some(
    (item) =>
      category.includes(item) || eventType.includes(item),
  );
}

/**
 * Check if an event can be changed (flexible and allowed by user).
 */
function canBeChanged(
  state: FinancialState,
  event: FinancialEvent,
): boolean {
  // Never change income
  if (isIncomeEvent(event)) return false;

  // Never change protected categories
  if (isProtectedCategory(state, event)) return false;

  // Must be recurring/flexible
  if (!isRecurringFlexible(event)) return false;

  // Must be in user's allowed change categories
  return (
    canStopEvent(state, event) ||
    canReduceEvent(state, event)
  );
}

/**
 * Create a spending-change plan.
 *
 * For every candidate spending-change plan:
 * 1. Apply the changes
 * 2. Simulate the requested payment
 * 3. Run the complete 90-day forecast
 * 4. Verify minimum balance on every day
 *
 * Maximum 3 changes allowed.
 * The same event cannot be both stopped and reduced.
 * Prefer fewer changes where possible.
 */
export function createSpendingPlan(
  state: FinancialState,
  requiredSavings: number,
): SpendingPlan {
  if (requiredSavings <= 0) {
    return {
      changes: [],
      totalSavings: 0,
      isSafe: true,
    };
  }

  // Collect unique candidate events (deduplicate by description+category
  // to avoid showing the same recurring event multiple times)
  const seen = new Set<string>();
  const candidates = state.events
    .filter((event) => event.amount !== null)
    .filter((event) => event.amount! > 0)
    .filter((event) => canBeChanged(state, event))
    .filter((event) => {
      const key = `${event.category}|${event.description}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const amountA = a.amount ?? 0;
      const amountB = b.amount ?? 0;

      /*
       * Prefer larger savings first.
       * This reduces the number of changes required.
       */
      return amountB - amountA;
    });

  const changes: SpendingChange[] = [];
  let totalSavings = 0;

  for (const event of candidates) {
    if (changes.length >= 3) break;
    if (totalSavings >= requiredSavings) break;

    const amount = event.amount!;

    /*
     * Prefer stopping an expense when the user allows it.
     */
    if (canStopEvent(state, event)) {
      changes.push({
        action: "stop",
        eventId: event.event_id,
      });

      totalSavings += amount;
      continue;
    }

    /*
     * Otherwise reduce it only as much as necessary.
     */
    if (canReduceEvent(state, event)) {
      const needed = requiredSavings - totalSavings;
      const minAllowed = event.minimum_allowed_amount ?? 0;

      const newAmount = Math.max(
        minAllowed,
        amount - needed,
      );

      const savings = amount - newAmount;

      if (savings > 0) {
        changes.push({
          action: "reduce_to",
          eventId: event.event_id,
          newAmount,
        });

        totalSavings += savings;
      }
    }
  }

  // Verify the spending plan is actually safe by simulating
  if (changes.length > 0) {
    const stoppedEvents = new Set<string>();
    const reducedEvents = new Map<string, number>();

    for (const change of changes) {
      if (change.action === "stop") {
        stoppedEvents.add(change.eventId);
      } else if (change.action === "reduce_to") {
        reducedEvents.set(change.eventId, change.newAmount ?? 0);
      }
    }

    const simResult = simulatePayment(
      state,
      state.request.request_date,
      state.request.requested_amount,
      stoppedEvents,
      reducedEvents,
    );

    return {
      changes,
      totalSavings,
      isSafe: simResult.safe,
    };
  }

  return {
    changes,
    totalSavings,
    isSafe: totalSavings >= requiredSavings,
  };
}