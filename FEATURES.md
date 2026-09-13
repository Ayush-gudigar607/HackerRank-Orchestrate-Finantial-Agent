# Buy or Wait? — Code Architecture and Features

This document provides a comprehensive overview of the codebase, module responsibilities, core features, and financial decision engine built for the **HackerRank Orchestrate: Buy or Wait?** challenge.

---

## 1. Overview of Markdown Documentation in This Repository

| Markdown File | Description |
|---|---|
| [`README.md`](./README.md) | Starter hackathon guide, quick start, directory structure, and evaluation rules. |
| [`problem_statement.md`](./problem_statement.md) | Official challenge specification, column requirements, domain rules, and conflict resolution policies. |
| [`evaluation/usage_report.md`](./evaluation/usage_report.md) | Final run report tracking model calls, token usage, runtime information, and zero-cost local execution metrics. |
| [`AGENTS.md`](./AGENTS.md) | Guidelines and lifecycle requirements for AI coding harnesses and conversational session logging. |
| [`FEATURES.md`](./FEATURES.md) | This document: in-depth architectural breakdown of code modules and financial logic features. |

---

## 2. System Architecture & Pipeline

The pipeline follows a deterministic multi-stage financial forecasting and decision workflow:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Data Ingestion & Currency Conversion (data-loader.ts)   │
│    - Loads requests, profiles, events, rates, options, msgs │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Event Normalization & Resolution (event-amount.ts)       │
│    - Resolves missing amounts from image records            │
│    - Applies currency conversions to user home currency     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Unstructured Evidence Parsing (message-interpreter.ts)   │
│    - Interprets cancellations, settlements, modifications   │
│    - Safely handles untrusted messages and clarifications   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Financial State Reconstruction (finantial-state.ts)      │
│    - Reconstructs starting balance, min balance buffer      │
│    - Separates settled history, pending debits, schedule    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Conservative Cash-Flow Forecasting (forecast.ts)         │
│    - Projects daily cash balance over a 90-day horizon      │
│    - Detects recurring expenses & conservative salary dates │
│    - Never drops below user's minimum_balance_to_keep       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Strategy Search & Decision Engine (decision-engine.ts)   │
│    - Evaluates affordability: now vs later (affordability)  │
│    - Evaluates seller installments & partial plans (payment)│
│    - Optimizes flexible spending cuts (spending-plans.ts)   │
│    - Selects optimal plan adhering to user preferences      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Validation & Output Verification (validator, verify)     │
│    - Validates bounds (0 <= safe_to_pay <= requested_amount)│
│    - Verifies plan syntax, dates, sums, and explanations    │
│    - Generates and verifies output.csv (250 rows)           │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Code Modules and File Responsibilities

All implementation code is located in [`code/`](./code):

### 3.1 Data Layer
- **[`code/types.ts`](./code/types.ts)**:
  Defines core TypeScript domain types and data models: `Request`, `FinancialProfile`, `FinancialEvent`, `PaymentOption`, `Message`, `ImageRecord`, `ExchangeRate`, and internal state structures.
- **[`code/data-loader.ts`](./code/data-loader.ts)**:
  Parses CSV dataset files into typed objects with proper type coercions and handles escaping/quoting. Exports `loadDataset()` and `parseCSV()`.

### 3.2 Evidence Resolution
- **[`code/event-amount.ts`](./code/event-amount.ts)**:
  Resolves blank event amounts by cross-referencing `images.csv` (e.g. salary slips, utility bills, receipts). Applies exact dated exchange rate conversions using `exchange_rates.csv` to convert transactions into the user's `home_currency`.
- **[`code/message-interpreter.ts`](./code/message-interpreter.ts)**:
  Processes unstructured text messages (`messages.csv`). Detects cancellations, delayed bills, amended recurring payment amounts, and salary confirmations while ignoring prompt injections or untrusted rule overrides.

### 3.3 State & Forecasting
- **[`code/finantial-state.ts`](./code/finantial-state.ts)**:
  Reconstructs the user's starting available balance. Reserves pending debits immediately. Segregates settled events, confirmed future salary, and recurring obligations.
- **[`code/forecast.ts`](./code/forecast.ts)**:
  Runs daily day-by-day cash flow simulation across a 90-day forecast horizon. Detects weekly, bi-weekly, and monthly recurring patterns. Simulates balances under different payment plans to verify that the balance never drops below `minimum_balance_to_keep`.

### 3.4 Planning & Strategy Evaluation
- **[`code/affordability.ts`](./code/affordability.ts)**:
  Calculates `amount_safe_to_pay` on `request_date` before optional spending modifications. Checks whether full payment is affordable immediately (`affordable_now`) or computes `earliest_date_for_full_payment` (`affordable_later`).
- **[`code/payment-plans.ts`](./code/payment-plans.ts)**:
  Evaluates seller/provider payment options (`request_payment_options.csv`). Enforces user's `payment_preferences` and `max_installment_months`. Validates partial payments (pay safe amount on `request_date`, remainder on completion date) when permitted.
- **[`code/spending-plans.ts`](./code/spending-plans.ts)**:
  Identifies non-protected, flexible recurring expenses in user-permitted adjustable categories. Tests up to three `stop:<event_id>` or `reduce_to:<event_id>:<amount>` changes to unlock affordability (`affordable_with_plan`).

### 3.5 Engine, Execution & Verification
- **[`code/decision-engine.ts`](./code/decision-engine.ts)**:
  Synthesizes state, forecast, payment options, and spending reductions into the final recommendation. Emits the exact 8 required output columns and generates concise, grounded explanations.
- **[`code/validator.ts`](./code/validator.ts)**:
  Enforces all domain contract rules:
  - `0 <= amount_safe_to_pay <= requested_amount`
  - Valid statuses and recommended payment methods
  - Installment plan dates, counts, and amounts match an available option
  - Two-payment partial payment schedule sums to `requested_amount`
  - Minimum balance buffer compliance
- **[`code/main.ts`](./code/main.ts)**:
  Primary CLI entry point. Loads the dataset, evaluates all 250 requests, validates outputs, and writes `output.csv`.
- **[`code/verify-output.ts`](./code/verify-output.ts)**:
  Stand-alone verification script that reads `output.csv`, parses all 250 rows, and runs `validateDecision` to ensure complete compliance.

---

## 4. Key Financial Decision Features

### 4.1 Conservative Balance Protection
- **Hard Floor**: At every projected day in the forecast, the user's available cash balance must stay at or above `minimum_balance_to_keep`.
- **Debit Reservation**: All pending debits are subtracted from available cash immediately.
- **Credit Conservatism**: Pending credits, bonuses, commissions, refunds, and investment gains are **not** counted until settled. Confirmed salary is only credited on its settlement date.

### 4.2 Multi-Tier Affordability Hierarchy
1. **`affordable_now`**:
   Full requested amount can be paid safely on `request_date` without spending changes.
   - Recommended method: `full_payment`
   - Plan: `none`
   - Earliest full payment date: `request_date`
2. **`affordable_with_plan`**:
   The expense can be completed by `desired_completion_date` via:
   - **`installments`**: An approved option from `request_payment_options.csv` respecting user's `max_installment_months` and payment preferences.
   - **`partial_payment`**: Exactly two payments (safe amount today, remainder on completion date) if `allows_partial_payment = true`.
   - **Spending changes**: Applying up to 3 `stop` or `reduce_to` adjustments on flexible categories.
3. **`affordable_later`**:
   Cannot be safely completed by `desired_completion_date` even with plans, but becomes safe as a single payment at a later date within the 90-day forecast.
   - Recommended method: `wait`
4. **`not_affordable`**:
   Cannot be safely afforded within the forecast window without violating minimum balance or protected commitments.
   - Recommended method: `not_recommended`

### 4.3 Preference & Protection Compliance
- Never stops or reduces expenses in protected categories (`protected_spending_categories`).
- Only modifies categories listed in `adjustable_categories`.
- Rejects installment plans exceeding `max_installment_months` or unsupported payment types.

---

## 5. Running the Code & Verifying

### Run the full pipeline
```bash
bun run code/main.ts
```
*Generates `output.csv` with predictions for all 250 evaluation requests.*

### Run verification and type checks
```bash
# Type check all TypeScript files
bun x tsc --noEmit

# Verify output format and rule compliance on output.csv
bun run code/verify-output.ts
```
