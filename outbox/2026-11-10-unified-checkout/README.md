# MeetGuru unified cart - independent review package

Source branch: feature/unified-cart-checkout. No changes published to MeetGuru or production.

## Read first

- reviews/2026-11-10-unified-checkout/README.md
- reviews/2026-11-10-unified-checkout/architecture.md
- reviews/2026-11-10-unified-checkout/acceptance.md
- reviews/2026-11-10-unified-checkout/deployment.md
- reviews/2026-11-10-unified-checkout/files.md

Complete source files retain their MeetGuru-relative paths below src/, supabase/, scripts/, tests/.
The review repository is a transport repository, not an independently runnable application.
No node_modules, real env, credentials, production backups or buyer records are included.
JSON artifacts contain only synthetic test results; machine-local artifact paths are omitted.
Existing static service domains in source are configuration references, not credentials.

## Patch integrity

Apply changes.diff to MeetGuru base commit **47c7f765dc39fe9881138ad49da60756239ba1e7**.
The original development branch started at 9282d3f6c3a2344a2c0d581aff0b51b208336a31.
The transport patch is rebased by file comparison onto the later production baseline above,
so the separately deployed lifetime-renewal-row fix is retained and not duplicated.
No source branch history was changed and no application commit was made.

SHA-256 changes.diff: **1af8bbf1c36c9b89be1f54111605e3fb518a81018aae1ec23547b259a089807b**.
Forward git apply --check passed against a pristine archive of the exact base commit.
Context-only spaces in unified diff are intentional; do not strip them.
SHA256SUMS covers every published file other than itself.

## Test evidence

13 unit + 28 PostgreSQL/PostgREST integration + 13 cart browser + 12 real-page browser scenarios:
**66 PASS, 0 FAIL**. Vite build without production SEO postbuild passed.
PostgreSQL tests use disposable loopback services and synthetic fixtures.
Browser tests use real Vue pages/API helpers with synthetic Supabase boundaries, local CSP/DNS blocking,
and an isolated Chrome profile. They do not prove real provider callback, Safari or media playback.
The 28 PostgreSQL checks remain from the unchanged SQL revision; no redundant production tests were run.

## Implementation scope

Existing shop -> order -> Prodamus -> BuyCourse, backing courses preserved.
One cart and checkout supports courses, events and streams together. No event seat reservations,
booking timers, capacity enforcement or new ticket system. Existing course financial/date logic retained.
Adding stays on the product page; In cart/manual header action opens cart; checkout is explicit.
No n8n workflow changes are required by this candidate.
SQL is prepared ONLY for owner manual application after review and separate release authorization.
Read deployment.md for coordinated schema-cache / Edge Function / frontend cutover and safe stop.
The rollback script blocks new checkout but keeps already-created payments fulfillable; it is not a destructive downgrade.

Known unverified areas and inherited promo-limit semantics are listed in acceptance.md/deployment.md.

Whitespace validation: unified-diff context spaces and the existing extra EOF newline of the tested migration are preserved byte-for-byte. Other staged files pass standard whitespace checks. A second check excluding only blank-at-eof passes for all non-patch files.
