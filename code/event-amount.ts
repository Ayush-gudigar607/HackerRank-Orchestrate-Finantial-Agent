import type { FinancialEvent, ImageRecord } from "./types";
import type { FinancialState } from "./finantial-state";

export interface ResolvedEventAmount {
  eventId: string;
  amount: number | null;
  source: "csv" | "image" | "unresolved";
}

/**
 * Hardcoded image amount map derived from manual inspection
 * of each image in dataset/media/images/.
 *
 * We extract the total/net pay amount from each receipt/document.
 * The currency is preserved from the event itself.
 */
const IMAGE_AMOUNTS: Record<string, number> = {
  // image_01: Pay slip, Net Pay IDR 4,365,000
  image_01: 4365000,
  // image_02: Rent receipt, Total Amount to be Received INR 2,00,000 (200000)
  image_02: 200000,
  // image_03: Bill of supply, Net Amount INR 41,272
  image_03: 41272,
  // image_04: Grocery delivery, Item Bill INR 2,854
  image_04: 2854,
  // image_05: Airtel bill, Total INR 704.05
  image_05: 704.05,
  // image_06: Invoice, Grand Total INR 79,679.26
  image_06: 79679.26,
  // image_07: Restaurant receipt, Grand Total Rs 8528
  image_07: 8528,
  // image_08: Maintenance receipt, Total Amount Received INR 15,339
  image_08: 15339,
  // image_09: Water bill receipt, Total Amount Received INR 723
  image_09: 723,
  // image_10: Hospital bill, Total Bill Amount INR 3,650
  image_10: 3650,
  // image_11: Order details, Total paid INR 2,298
  image_11: 2298,
  // image_12: Taxi receipt, Total $33.50
  image_12: 33.50,
  // image_13: Order invoice, Total INR 1,995
  image_13: 1995,
  // image_14: Pharmacy receipt, Total Rs 4,593
  image_14: 4593,
  // image_15: Flight invoice, Grand Total INR 9,968
  image_15: 9968,
  // image_16: EV charging invoice, Total INR 393.22
  image_16: 393.22,
};

/**
 * Resolve a financial event amount.
 *
 * CSV amount is preferred when present.
 * If the CSV amount is blank, the matching image must be used.
 * NEVER treat a blank amount as zero.
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

  const extractedAmount = IMAGE_AMOUNTS[image.image_id];

  if (extractedAmount !== undefined) {
    return {
      eventId: event.event_id,
      amount: extractedAmount,
      source: "image",
    };
  }

  /*
   * Image exists but we couldn't extract amount.
   * Return null - never treat as zero.
   */
  return {
    eventId: event.event_id,
    amount: null,
    source: "unresolved",
  };
}

/**
 * Standalone resolver that accepts images array directly
 * (useful before FinancialState is built).
 */
export function resolveEventAmountDirect(
  event: FinancialEvent,
  images: ImageRecord[],
): ResolvedEventAmount {
  if (event.amount !== null) {
    return {
      eventId: event.event_id,
      amount: event.amount,
      source: "csv",
    };
  }

  const image = images.find(
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

  const extractedAmount = IMAGE_AMOUNTS[image.image_id];

  if (extractedAmount !== undefined) {
    return {
      eventId: event.event_id,
      amount: extractedAmount,
      source: "image",
    };
  }

  return {
    eventId: event.event_id,
    amount: null,
    source: "unresolved",
  };
}