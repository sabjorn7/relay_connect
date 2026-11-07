# BuyCourse — review package, 2026-11-07

## Problem and fix

PickBuyerRow collapsed multiple purchased positions to the first item. paid=true was written before completion. The previous financial chain credited the first author from a stale balance snapshot. The prepared fix validates every position, then issues accesses, inserts sales, atomically increments each author balance and marks completion in a single PostgreSQL transaction. Order locks and unique completion receipts prevent duplicate settlement. Historical paid orders are skipped.

## Files and usage

- Full migration: `supabase/migrations/pending_order_access_fulfillment.sql`.
- Sanitized fixed workflow and production baseline: `reviews/2026-11-07-multicourse-access/`.
- `BuyCourse.workflow.diff`: canonical JSON unified diff of those sanitized graphs (38 -> 31 nodes). Redactions cover the same unrelated sensitive configuration; this is a review diff, not a deployment patch.
- Helpers: `scripts/`; tests: `tests/`; actual test results: `results/`.
- Detailed implementation, access-period/commission rules, deployment and rollback: `reviews/2026-11-07-multicourse-access/README.md`. Its original preflight prerequisites are historical; current deployment status is below.
- `tests/stream-visibility.integration.py` is an unchanged dependency providing the disposable loopback PostgreSQL launcher. BuyCourse tests import its Stand class only; do not execute unrelated stream tests. Paths default to Homebrew PostgreSQL 15/PostgREST on macOS; installing dependencies is a separate action.

Run from this package directory:

```sh
node tests/order-access-fulfillment.unit.mjs
python3 tests/order-access-fulfillment.integration.py
```

Do not import review JSON into n8n. Its credentials/URLs/unrelated sensitive parameters are placeholders and active=false. The local preparation script consumes a separately protected fresh real export and preserves credential bindings and webhook configuration. No real export, API client configuration, key or callback payload is included here.

## Tests actually executed

2026-11-07: 8 unit PASS, 0 FAIL; 19 real PostgreSQL scenarios PASS, 0 FAIL; separate cleanup/closed-port check PASS (launcher total 20). Synthetic fixtures only, loopback temporary database. Temporary processes stopped. Tests cover single/four courses, multiple authors, repeat/parallel callbacks, full rollback, renewal/lifetime, historical paid skip and access denial. These are not n8n engine or real-payment E2E tests.

## Actual production status at 2026-11-07 11:48:46 MSK

A fresh protected workflow backup was saved outside this package at 11:48:02 MSK. Migration application failed before DDL because the MCP migration tool has no configured direct DATABASE_URL. Subsequent read-only verification confirmed both new RPC and receipt table absent. BuyCourse remains active and unchanged, updatedAt=2026-10-29T14:14:01.485Z. The fix has NOT been deployed. No old payments or restored accesses were processed.

The owner accepted the credential/cutover delivery residual risks and will reconcile Prodamus sales manually if needed. No 503 barrier, new queue or credential test workflow was deployed. Never infer settlement from webhook HTTP 200.

## Deployment and rollback boundaries

Apply the reviewed SQL through an authorized direct PostgreSQL session, then `NOTIFY pgrst, 'reload schema';`. Verify service_role-only EXECUTE and schema discovery. Save a fresh protected workflow backup and stop on baseline drift; generate the API body with the included script, then update only BuyCourse preserving webhook and credentials. A new control payment needs separate approval. Reconcile accesses/sales/author credits/receipt, not merely HTTP status. Do not replay historical paid orders.

SQL failure rolls back its transaction. After any successful settlement retain receipts, accesses, sales and author balances. Restoring the old workflow reintroduces its known bugs; do not blindly reset paid, delete receipts or undo balances. Prefer targeted recovery/fix-forward after inspecting the affected new payment.

## Security and limits

Only sanitized review graphs and source/test files are included. Synthetic fixture credentials are test-only and must never be reused in production. The full protected production export, its backup paths, real customer/order/payment identifiers and secrets are excluded. Production workflow baseline last checked during the controlled deployment attempt; no new production audit is claimed by this publication. Safari/frontend/Splash changes are out of scope.
