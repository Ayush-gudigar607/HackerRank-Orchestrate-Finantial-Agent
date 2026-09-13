import { writeFile } from "node:fs/promises";

import { loadDataset } from "./data-loader";
import { buildFinancialState } from "./finantial-state";
import { forecast90Days } from "./forecast";
import { calculateAmountSafeToPay } from "./affordability";
import { createPaymentPlan } from "./payment-plans";
import { createSpendingPlan } from "./spending-plans";
import { makeDecision } from "./decision-engine";
import {
  validateDecision,
} from "./validator";



function escapeCSV(value: string | number): string {
  const text = String(value);

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function createCSV(
  rows: ReturnType<typeof makeDecision>[],
): string {
  const headers = [
    "request_id",
    "amount_safe_to_pay",
    "affordability_status",
    "recommended_payment_method",
    "payment_plan",
    "earliest_date_for_full_payment",
    "spending_changes_needed",
    "decision_explanation",
  ];

  const lines = [
    headers.join(","),
  ];

  for (const row of rows) {
    lines.push(
      [
        row.request_id,
        row.amount_safe_to_pay,
        row.affordability_status,
        row.recommended_payment_method,
        row.payment_plan,
        row.earliest_date_for_full_payment,
        row.spending_changes_needed,
        row.decision_explanation,
      ]
        .map(escapeCSV)
        .join(","),
    );
  }

  return lines.join("\n") + "\n";
}

async function main() {
  const datasetDir =
    process.env.DATASET_DIR ?? "./dataset";

  const outputPath =
    process.env.OUTPUT_PATH ?? "./output.csv";

  console.log("Loading dataset...");

  const dataset = await loadDataset(datasetDir);

  console.log(
    `Loaded ${dataset.requests.length} requests.`,
  );

  // Keep the successful and fallback results type-compatible. Without an
  // explicit type, an empty array can be inferred too narrowly by TypeScript.
  const results: ReturnType<typeof makeDecision>[] = [];

  for (const request of dataset.requests) {
    console.log(
      `Processing ${request.request_id}...`,
    );

    try {
      // 1. Build all financial information
      //    required for this request.
      const state = buildFinancialState(
        dataset,
        request,
      );

      // 2. Forecast the next 90 days.
      const forecast = forecast90Days(state);

      // 3. Calculate how much can safely be paid today.
      const affordability =
        calculateAmountSafeToPay(
          state,
          forecast,
        );

      // 4. Create the best available payment plan.
      let paymentPlan =
        createPaymentPlan(
          state,
          forecast,
          affordability,
        );

      // 5. Calculate optional spending changes
      //    if additional savings are required.
      const requiredSavings = Math.max(
        0,
        request.requested_amount -
          affordability.amountSafeToPay,
      );

      const spendingPlan =
        createSpendingPlan(
          state,
          requiredSavings,
        );

      // A spending-change recommendation is a real candidate only after its
      // complete forecast simulation succeeds. Prefer an ordinary plan that
      // completes by the requested deadline; otherwise a safe full payment
      // today with the permitted changes is better than waiting past it.
      const completesByDeadline =
        paymentPlan.payments.length > 0 &&
        paymentPlan.payments[paymentPlan.payments.length - 1]!.date <=
          request.desired_completion_date;
      if (spendingPlan.isSafe && spendingPlan.changes.length > 0 &&
          (!paymentPlan.isSafe || !completesByDeadline)) {
        paymentPlan = {
          paymentMethod: "full_payment",
          payments: [{ date: request.request_date, amount: request.requested_amount }],
          totalAmount: request.requested_amount,
          earliestFullPaymentDate: request.request_date,
          isSafe: true,
          requiresSpendingChanges: true,
        };
      }

      // // 6. Combine everything into the final answer.
      // const decision = makeDecision(
      //   state,
      //   affordability,
      //   paymentPlan,
      //   spendingPlan,
      // );

      // results.push(decision);

      const decision = makeDecision(
  state,
  affordability,
  paymentPlan,
  spendingPlan,
);

const validationErrors = validateDecision(
  request,
  decision,
);

if (validationErrors.length > 0) {
  console.error(
    `Validation failed for ${request.request_id}`,
  );

  for (const error of validationErrors) {
    console.error(
      `  ${error.field}: ${error.message}`,
    );
  }
}

results.push(decision);
    } catch (error) {
      console.error(
        `Failed ${request.request_id}:`,
        error,
      );

      /*
       * Do not stop the complete dataset because
       * one request has a problem.
       */
      results.push({
        request_id: request.request_id,
        amount_safe_to_pay: 0,
        affordability_status: "not_affordable",
        recommended_payment_method:
          "not_recommended",
        payment_plan: "none",
        earliest_date_for_full_payment: "",
        spending_changes_needed: "none",
        decision_explanation:
          `Unable to safely evaluate this request: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
      });
    }
  }

  const csv = createCSV(results);

  await writeFile(
    outputPath,
    csv,
    "utf-8",
  );

  console.log("");
  console.log(
    `Completed ${results.length} requests.`,
  );
  console.log(
    `Output written to ${outputPath}`,
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
