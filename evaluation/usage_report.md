# Token Usage and Cost Report

This report summarizes the **final full-dataset run** that produced the submitted `output.csv`.

## Run Information


| Metric | Value |
| --- | ---: |
| Run started (UTC) | 2026-09-13T09:14:51.299Z |
| Run finished (UTC) | 2026-09-13T09:14:52.605Z |
| Dataset used | ./dataset |
| Requests processed | 250 |
| Output CSV | ./output-run.csv |

## Provider and Model Information

| Provider | Model |
| --- | --- |
| None | None |

## Usage and Cost Totals

| Metric | Value |
| --- | ---: |
| Requests processed | 250 |
| Model calls | 0 |
| Input tokens | 0 |
| Output tokens | 0 |
| Total tokens | 0 |
| Estimated total cost | $0.00 |
| Average tokens/request | 0.00 |
| Estimated cost/request | $0.00 |

## Per-Model Breakdown

No model calls were recorded for this run, so there is no per-model breakdown.

## Cost Calculation

No model/API calls were made during this run, so no token pricing applies and the estimated cost is $0.

## Data Availability and Limitations

Usage data unavailable because the implementation does not make model/API calls.

The Buy or Wait? agent is an MVP built on deterministic TypeScript financial logic (`code/finantial-state.ts`, `code/forecast.ts`, `code/affordability.ts`, `code/payment-plans.ts`, `code/spending-plans.ts`, `code/decision-engine.ts`). Every request in the dataset is evaluated locally from the CSV dataset, so there is no model provider, no model calls, and no token or API cost for the final full-dataset run. If an LLM is integrated later, `code/usage-tracker.ts` records real provider usage metadata per call and these totals will fill in automatically.

No API keys, credentials, or secret environment variables are used or reported.
