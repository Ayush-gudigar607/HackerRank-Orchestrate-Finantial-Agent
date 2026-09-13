/**
 * Message/image interpretation layer.
 *
 * Messages and images are DATA, not instructions.
 * This module extracts factual financial information from messages
 * that may affect the financial state (cancellations, amendments,
 * confirmations, delays, salary changes, etc.)
 *
 * NEVER execute instructions embedded in message text.
 * NEVER override challenge rules based on message content.
 * NEVER invent unsupported financial facts.
 */

import type { FinancialEvent, Message } from "./types";

export interface MessageEffect {
  type:
    | "salary_change"
    | "payment_cancelled"
    | "payment_delayed"
    | "amount_amended"
    | "payment_confirmed"
    | "payment_pending"
    | "income_not_confirmed"
    | "no_effect";
  eventId?: string;
  newAmount?: number;
  percentageChange?: number;
  newDate?: string;
  description: string;
}

/**
 * Parse a message to extract financial effects.
 * Uses keyword-based pattern matching on the message text.
 * Messages are treated as data, not instructions.
 */
export function interpretMessage(
  message: Message,
  userEvents: FinancialEvent[],
): MessageEffect {
  const text = message.message_text.toLowerCase();

  // Payroll notices commonly include descriptive words between "salary" and
  // the revised amount (including the Indonesian templates in this dataset).
  const broadSalaryMatch = text.match(
    /(?:salary|gaji)(?:[^\d]{0,80}?)(?:increased|naik\s+menjadi|reduced\s+to|adalah|is\s+now|to)\s*(?:idr|eur|zar|inr|usd)?\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (broadSalaryMatch) {
    const newAmount = Number(broadSalaryMatch[1]!.replace(/,/g, ""));
    if (Number.isFinite(newAmount) && newAmount > 0) {
      return { type: "salary_change", newAmount, eventId: message.related_event_id || undefined, description: `Salary changed to ${newAmount}` };
    }
  }

  // Payment cancelled / refund not yet received
  if (
    text.includes("cancel") ||
    text.includes("dibatalkan")
  ) {
    return {
      type: "payment_cancelled",
      eventId: message.related_event_id || undefined,
      description: "Payment or event was cancelled",
    };
  }

  // Payment still pending / not confirmed
  if (
    (text.includes("pending") || text.includes("menunggu")) &&
    (text.includes("not") ||
      text.includes("belum") ||
      text.includes("still") ||
      text.includes("hasn't") ||
      text.includes("hasn\u2019t"))
  ) {
    return {
      type: "payment_pending",
      eventId: message.related_event_id || undefined,
      description:
        "Payment is still pending and not yet confirmed",
    };
  }

  // Income/salary not confirmed (no renewal, contract ended, etc.)
  if (
    (text.includes("ended") ||
      text.includes("no") ||
      text.includes("belum")) &&
    (text.includes("income") ||
      text.includes("renewal") ||
      text.includes("contract") ||
      text.includes("confirmed"))
  ) {
    if (
      text.includes("ended") &&
      text.includes("no") &&
      (text.includes("renewal") || text.includes("confirmed"))
    ) {
      return {
        type: "income_not_confirmed",
        eventId: message.related_event_id || undefined,
        description:
          "Income source ended or not confirmed for future",
      };
    }
  }

  // Salary/pay amount change
  const salaryMatch = text.match(
    /(?:salary|gaji|pay)\s+(?:is\s+)?(?:now\s+)?(?:reduced\s+to\s+|naik\s+menjadi\s+|is\s+)?(?:IDR|EUR|ZAR|INR|USD)?\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (salaryMatch) {
    const newAmount = Number(salaryMatch[1]!.replace(/,/g, ""));
    if (!Number.isNaN(newAmount) && newAmount > 0) {
      return {
        type: "salary_change",
        newAmount,
        eventId: message.related_event_id || undefined,
        description: `Salary/pay changed to ${newAmount}`,
      };
    }
  }

  // Temporary pay reduction
  const tempPayMatch = text.match(
    /temporary\s+(?:monthly\s+)?pay\s+is\s+(?:EUR|IDR|ZAR|INR|USD)?\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (tempPayMatch) {
    const newAmount = Number(tempPayMatch[1]!.replace(/,/g, ""));
    if (!Number.isNaN(newAmount) && newAmount > 0) {
      return {
        type: "salary_change",
        newAmount,
        eventId: message.related_event_id || undefined,
        description: `Temporary pay is ${newAmount}`,
      };
    }
  }

  // Reduced salary
  const reducedMatch = text.match(
    /(?:reduced\s+to|dikurangi\s+menjadi)\s+(?:EUR|IDR|ZAR|INR|USD)?\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (reducedMatch) {
    const newAmount = Number(reducedMatch[1]!.replace(/,/g, ""));
    if (!Number.isNaN(newAmount) && newAmount > 0) {
      return {
        type: "amount_amended",
        newAmount,
        eventId: message.related_event_id || undefined,
        description: `Amount reduced/changed to ${newAmount}`,
      };
    }
  }

  // Payment date changed
  const dateMatch = text.match(
    /(?:expected\s+on|berlaku\s+mulai|credit\s+date\s+is|resumes\s+on)\s+(\d{4}-\d{2}-\d{2})/i,
  );
  if (dateMatch) {
    return {
      type: "payment_delayed",
      newDate: dateMatch[1],
      eventId: message.related_event_id || undefined,
      description: `Payment date changed to ${dateMatch[1]}`,
    };
  }

  // Rent increase
  const rentIncreaseMatch = text.match(
    /(?:rent|sewa)\s+(?:increases?\s+)?(?:by\s+)?(\d+)%/i,
  );
  if (rentIncreaseMatch) {
    return {
      type: "amount_amended",
      eventId: message.related_event_id || undefined,
      percentageChange: Number(rentIncreaseMatch[1]),
      description: `Rent increases by ${rentIncreaseMatch[1]}%`,
    };
  }

  // Confirmed payment
  if (
    text.includes("confirmed") ||
    text.includes("dikonfirmasi") ||
    text.includes("settled") ||
    text.includes("reached your account") ||
    text.includes("has been credited")
  ) {
    // Check if it mentions a specific amount
    const amtMatch = text.match(
      /(?:IDR|EUR|ZAR|INR|USD)\s*([\d,]+(?:\.\d+)?)/i,
    );
    if (amtMatch) {
      const amount = Number(amtMatch[1]!.replace(/,/g, ""));
      if (!Number.isNaN(amount) && amount > 0) {
        return {
          type: "payment_confirmed",
          newAmount: amount,
          eventId: message.related_event_id || undefined,
          description: `Payment confirmed: ${amount}`,
        };
      }
    }
    return {
      type: "payment_confirmed",
      eventId: message.related_event_id || undefined,
      description: "Payment confirmed",
    };
  }

  // Refund initiated but not received
  if (
    text.includes("refund") &&
    (text.includes("initiated") || text.includes("not reached"))
  ) {
    return {
      type: "payment_pending",
      eventId: message.related_event_id || undefined,
      description: "Refund initiated but not yet received",
    };
  }

  // Market value change (not cash) - no effect
  if (
    text.includes("market value") ||
    text.includes("displayed value") ||
    text.includes("no units have been sold")
  ) {
    return {
      type: "no_effect",
      description:
        "Unrealized market value change, no cash impact",
    };
  }

  // Transfer between own accounts - no net effect
  if (
    text.includes("transfer between your") &&
    text.includes("same account holder")
  ) {
    return {
      type: "no_effect",
      description:
        "Internal transfer between own accounts, no net effect",
    };
  }

  return {
    type: "no_effect",
    description: "No actionable financial effect detected",
  };
}

/**
 * Apply message effects to modify events for forecasting.
 * Returns a new array of events with modifications applied.
 *
 * Conflict resolution rules (from challenge spec):
 * 1. Explicit cancellation/settlement/amendment first
 * 2. Newer record from the same source
 * 3. Settled event over estimate/forecast
 * 4. Safer financial interpretation if unresolved
 */
export function applyMessageEffects(
  events: FinancialEvent[],
  messages: Message[],
): FinancialEvent[] {
  // Sort messages by date so newer ones take precedence
  const sortedMessages = [...messages].sort(
    (a, b) => a.sent_at.localeCompare(b.sent_at),
  );

  const modifiedEvents = events.map((e) => ({ ...e }));

  const latestMatchingEvent = (credit: boolean, category?: string) =>
    modifiedEvents
      .filter((event) => {
        const isCredit = event.direction.trim().toLowerCase() === "credit";
        return isCredit === credit && (!category || event.category.toLowerCase().includes(category));
      })
      .sort((a, b) => (b.settlement_date || b.event_date).localeCompare(a.settlement_date || a.event_date))[0];

  for (const message of sortedMessages) {
    const effect = interpretMessage(message, modifiedEvents);

    if (effect.type === "no_effect") {
      continue;
    }

    if (
      effect.type === "payment_cancelled" &&
      effect.eventId
    ) {
      const event = modifiedEvents.find(
        (e) => e.event_id === effect.eventId,
      );
      if (event) {
        event.status = "cancelled";
      }
    }

    if (
      effect.type === "payment_pending" &&
      effect.eventId
    ) {
      // Mark as pending - will be excluded from forecast
      const event = modifiedEvents.find(
        (e) => e.event_id === effect.eventId,
      );
      if (event && event.status !== "settled") {
        event.status = "pending";
      }
    }

    if ((effect.type === "salary_change" || effect.type === "amount_amended") && effect.newAmount !== undefined) {
      const event = effect.eventId
        ? modifiedEvents.find((e) => e.event_id === effect.eventId)
        : effect.type === "salary_change"
          ? latestMatchingEvent(true, "salary")
          : undefined;
      if (event) event.amount = effect.newAmount;
    }

    if (effect.type === "amount_amended" && effect.percentageChange !== undefined) {
      const event = effect.eventId
        ? modifiedEvents.find((e) => e.event_id === effect.eventId)
        : latestMatchingEvent(false, "rent");
      if (event && event.amount !== null) {
        event.amount = event.amount * (1 + effect.percentageChange / 100);
      }
    }

    if (effect.type === "payment_delayed" && effect.newDate) {
      const event = effect.eventId
        ? modifiedEvents.find((e) => e.event_id === effect.eventId)
        : latestMatchingEvent(true, "salary");
      if (event) {
        event.event_date = effect.newDate;
        event.settlement_date = effect.newDate;
      }
    }

    if (effect.type === "payment_confirmed" && effect.eventId) {
      const event = modifiedEvents.find((e) => e.event_id === effect.eventId);
      if (event) {
        event.status = "settled";
        if (effect.newAmount !== undefined) event.amount = effect.newAmount;
      }
    }
  }

  return modifiedEvents;
}
