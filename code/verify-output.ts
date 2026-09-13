import { loadDataset, parseCSV } from "./data-loader";
import { readFile } from "node:fs/promises";
import { validateDecision } from "./validator";
import type { DecisionResult } from "./decision-engine";

async function verifyOutput() {
  console.log("Loading dataset and output.csv...");
  const dataset = await loadDataset("./dataset");
  const outputContent = await readFile("./output.csv", "utf-8");
  const rows = parseCSV(outputContent);

  console.log(`Total rows in output.csv: ${rows.length}`);

  if (rows.length !== 250) {
    throw new Error(`Expected 250 rows, got ${rows.length}`);
  }

  const expectedHeaders = [
    "request_id",
    "amount_safe_to_pay",
    "affordability_status",
    "recommended_payment_method",
    "payment_plan",
    "earliest_date_for_full_payment",
    "spending_changes_needed",
    "decision_explanation",
  ];

  const firstRow = rows[0];
  if (!firstRow) {
    throw new Error("output.csv is empty");
  }

  for (const h of expectedHeaders) {
    if (!(h in firstRow)) {
      throw new Error(`Missing expected header: ${h}`);
    }
  }

  const requestMap = new Map(dataset.requests.map((r) => [r.request_id, r]));
  const seenIds = new Set<string>();

  let errorCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const reqId = row.request_id ?? "";
    if (!reqId) {
      console.error(`Missing request_id on row ${i + 1}`);
      errorCount++;
      continue;
    }

    if (seenIds.has(reqId)) {
      console.error(`Duplicate request_id: ${reqId}`);
      errorCount++;
    }
    seenIds.add(reqId);

    const req = requestMap.get(reqId);
    if (!req) {
      console.error(`Unknown request_id: ${reqId}`);
      errorCount++;
      continue;
    }

    const decision: DecisionResult = {
      request_id: reqId,
      amount_safe_to_pay: Number(row.amount_safe_to_pay ?? 0),
      affordability_status: (row.affordability_status ?? "") as any,
      recommended_payment_method: (row.recommended_payment_method ?? "") as any,
      payment_plan: row.payment_plan ?? "",
      earliest_date_for_full_payment: row.earliest_date_for_full_payment ?? "",
      spending_changes_needed: row.spending_changes_needed ?? "",
      decision_explanation: row.decision_explanation ?? "",
    };

    const errors = validateDecision(req, decision);
    if (errors.length > 0) {
      console.error(`Validation error on row ${i + 1} (${reqId}):`, errors);
      errorCount++;
    }
  }

  if (seenIds.size !== 250) {
    throw new Error(`Expected 250 unique requests, got ${seenIds.size}`);
  }

  if (errorCount > 0) {
    throw new Error(`Validation failed with ${errorCount} errors!`);
  }

  console.log("All 250 rows successfully verified and passed validation!");
}

verifyOutput().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});

