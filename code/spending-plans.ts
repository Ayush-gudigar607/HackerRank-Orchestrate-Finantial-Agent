import type { FinancialState } from "./finantial-state";
import type { FinancialEvent } from "./types";

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
 * Check whether an event is a flexible expense that can be changed.
 */
function isFlexibleExpense(
  state: FinancialState,
  event: FinancialEvent,
): boolean {
  const type = event.event_type.trim().toLowerCase();

  if (type.includes("income")) return false;
  if (type.includes("salary")) return false;
  if (type.includes("deposit")) return false;
  if (type.includes("refund")) return false;

  /*
   * Only categories explicitly mentioned by the user
   * as reducible/stoppable should be considered.
   */
  const reducible =
    state.profile.expense_categories_user_is_willing_to_reduce
      .split(/[|,;]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

  const stoppable =
    state.profile.expense_categories_user_is_willing_to_stop
      .split(/[|,;]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

  const category = type;

  return (
    reducible.some((item) => category.includes(item)) ||
    stoppable.some((item) => category.includes(item))
  );
}

/**
 * Determine whether the event can be completely stopped.
 */
function canStopEvent(
  state: FinancialState,
  event: FinancialEvent,
): boolean {
  const stoppable =
    state.profile.expense_categories_user_is_willing_to_stop
      .split(/[|,;]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

  const category = event.event_type.trim().toLowerCase();

  return stoppable.some((item) => category.includes(item));
}

/**
 * Determine whether the event can be reduced.
 */
function canReduceEvent(
  state: FinancialState,
  event: FinancialEvent,
): boolean {
  const reducible =
    state.profile.expense_categories_user_is_willing_to_reduce
      .split(/[|,;]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

  const category = event.event_type.trim().toLowerCase();

  return reducible.some((item) => category.includes(item));
}

/**
 * Create a spending-change plan.
 *
 * This function only considers expenses that the user has
 * explicitly said can be stopped or reduced.
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

  const candidates = state.events
    .filter((event) => event.amount !== null)
    .filter((event) => event.amount! > 0)
    .filter((event) => canBeChanged(state, event))
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
    if (totalSavings >= requiredSavings) {
      break;
    }

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

      const newAmount = Math.max(
        0,
        amount - needed,
      );

      const savings = amount - newAmount;

      changes.push({
        action: "reduce_to",
        eventId: event.event_id,
        newAmount,
      });

      totalSavings += savings;
    }
  }

  /*
   * Maximum three spending changes are allowed.
   */
  const limitedChanges = changes.slice(0, 3);

  const limitedSavings = limitedChanges.reduce(
    (total, change) => {
      const event = state.events.find(
        (item) => item.event_id === change.eventId,
      );

      if (!event || event.amount === null) {
        return total;
      }

      if (change.action === "stop") {
        return total + event.amount;
      }

      return (
        total +
        Math.max(
          0,
          event.amount - (change.newAmount ?? event.amount),
        )
      );
    },
    0,
  );

  return {
    changes: limitedChanges,
    totalSavings: limitedSavings,
    isSafe: limitedSavings >= requiredSavings,
  };
}

function canBeChanged(
  state: FinancialState,
  event: FinancialEvent,
): boolean {
  return isFlexibleExpense(state, event);
}