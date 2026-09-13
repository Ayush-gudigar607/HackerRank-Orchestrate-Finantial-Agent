import type { FinancialEvent } from "./types";
import type { FinancialState } from "./finantial-state";

export interface ResolvedEventAmount {
  eventId: string;
  amount: number | null;
  source: "csv" | "image" | "unresolved";
}

/**
 * Resolve a financial event amount.
 *
 * CSV amount is preferred when present.
 * If the CSV amount is blank, the matching image must be used.
 */
export function resolveEventAmount(
  state: FinancialState,
  event: FinancialEvent,
): ResolvedEventAmount {
  if (event.amount !== null) {
    return {
      eventId: event.event_id,
      amount: event.amount,
      source: "csv",
    };
  }

  const image = state.images.find(
    (item) =>
      item.related_event_id === event.event_id,
  );

  if (!image) {
    return {
      eventId: event.event_id,
      amount: null,
      source: "unresolved",
    };
  }

  /*
   * Image OCR will be connected here.
   *
   * For now we deliberately return null instead of
   * treating the missing amount as zero.
   */
  return {
    eventId: event.event_id,
    amount: null,
    source: "image",
  };
}