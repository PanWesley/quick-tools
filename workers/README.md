# BillNest first-party analytics worker

This Worker receives anonymous analytics events from `/tools/expense/` and stores daily aggregates in Cloudflare D1.

It does not store bill amounts, notes, tag names, or imported file contents. DAU uses a daily SHA-256 key derived from the request IP, user agent, date, and `ANALYTICS_SALT`; the raw IP is not stored.

## Cloudflare setup

1. Create a D1 database, for example `billnest_analytics`.
2. Deploy `workers/analytics-worker.mjs` with the D1 binding name `ANALYTICS_DB`.
3. Add two Worker variables:
   - `ANALYTICS_SALT`: any long random secret.
   - `ANALYTICS_READ_TOKEN`: a long random token for reading summaries.
4. Route both `billnest.top/api/analytics*` and `www.billnest.top/api/analytics*` to this Worker.
5. Keep the `www` DNS record proxied through Cloudflare. DNS-only records bypass Worker routes and go straight to Vercel.

## Endpoints

- `POST /api/analytics`: receives client events.
- `GET /api/analytics/summary?days=14&token=...`: returns daily DAU, sessions, pageviews, engaged seconds, and top routes.
