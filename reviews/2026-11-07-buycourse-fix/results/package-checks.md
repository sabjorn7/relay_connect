# Package validation

- 8 unit tests PASS, 0 FAIL; executed again from the self-contained package.
- 19 PostgreSQL scenarios PASS, 0 FAIL; cleanup/closed-port check PASS.
- Production baseline matches fresh protected export for connections and all retained parameters; credentials/URLs/unrelated sensitive nodes remain redacted.
- Canonical unified diff: git apply --check PASS; applied output equals the fixed canonical graph.
- Common JWT, private-key, GitHub-token and known real-order-ID scans: no matches.
- Workflow parameters reviewed: only placeholders and invalid-domain RPC URLs; no payment payloads or customer data.
- No protected exports, environment files, deployment API credentials or preflight backup paths included.
