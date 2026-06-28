# AGENTS.md

Guidance for AI coding agents and humans working in this repository.

## Project Overview

Venezuela Ayuda is the central coordination backend and public web surface for
earthquake-response data. It accepts partner writes through an authenticated API,
serves public reads through redacted views, and keeps moderation, audit history,
deduplication, and partner attribution close to the source database.

The project is public and community-oriented, but it handles crisis-response
data. Treat privacy, provenance, and reversibility as core product features.

## Non-Negotiables

- Never expose private contact details, phone numbers, raw admin notes, API keys,
  Supabase service keys, database URLs, personal IDs, private photos, or private
  relay data.
- Public reads must come from explicit public projections or whitelisted fields.
  Do not serialize raw table rows to API or UI responses.
- Partner writes must be authenticated server-to-server with `x-api-key`.
  Browser-based writes with partner keys are not allowed.
- Preserve source attribution. Do not trust a caller-provided `source`; stamp it
  from the authenticated partner record.
- Duplicate matching is advisory. Do not imply automatic identity merge,
  automatic resolution, or destructive cleanup without coordinator review.
- Keep migrations append-only once reviewed. Add a new migration instead of
  editing a migration that may already have run.
- Write paths should be deterministic. AI may classify or assist, but must not
  silently mutate canonical records.

## Stack

- Next.js App Router with TypeScript
- Supabase Postgres/PostGIS as the source of truth
- Server Actions for local public flows
- `/api/v1/reports` as the partner data exchange API
- `node --test` for focused backend/helper tests
- ESLint and `next build` for app validation
- Vercel for hosting

## Commands

```bash
npm install
npm run lint
npm test
npm run build
```

For local development:

```bash
cp .env.example .env.local
npm run dev
```

Use real secrets only in `.env.local` or platform secret stores. Never commit
local backups, exported data, Supabase temp state, or copied production payloads.

## Repository Layout

```text
src/app/                   Next.js routes, Server Actions, and API routes
src/app/api/v1/reports/    Partner read/write hub API
src/components/            Public UI, forms, admin components
src/lib/                   Backend helpers, validation, auth, audit, reports
messages/{es,en}/          next-intl message namespaces
supabase/migrations/       Database schema and policy history
scripts/                   Tests, migration helpers, ingest/dedup utilities
public/openapi.yaml        Partner API contract
docs/                      Handoffs, plans, and operator guidance
```

## Coding Conventions

- Prefer small, deterministic helpers in `src/lib/` and keep route handlers thin.
- Validate external input before writing. Reject or normalize at the boundary,
  not after data reaches Postgres.
- Select public fields explicitly. Do not use `select("*")` for public API
  responses or audit-history projection.
- Keep privacy rules duplicated only when tests assert the shared invariant.
  Prefer shared maps like `VIEW_COLUMNS`, `VIEW_FOR_TABLE`, and canonical enums.
- Keep Spanish public copy in `messages/es/`; keep machine enum values stable.
- Use server-only Supabase clients for writes. Client code should never receive
  service-role credentials or partner API keys.
- Preserve `request_id`, partner source, audit entries, and idempotency behavior
  when touching write paths.
- For migrations, update tests and docs when changing public views, private
  fields, partner auth, audit behavior, or API response shapes.

## Observability / Logging

Server failures must never be silent. Every `catch` and every error-swallow path
(a Supabase read that returns `[]`/`null`, an external fetch that falls back) logs
through the structured logger in `src/lib/log.mjs` before it degrades.

- Helpers: `logError(event, err, context)`, `logWarn(event, context, err?)`,
  `logInfo(event, context)`, `logDebug(event, context)`.
- Levels: `error` (server failure an operator must see, e.g. a write/RPC failure)
  → `console.error`; `warn` (graceful degradation: empty read, external API down,
  fallback) → `console.warn`; `info` (low-volume lifecycle, NOT per-request) →
  `console.log`; `debug` (diagnostics) → `console.debug`, **no-op unless**
  `LOG_LEVEL=debug` (or `DEBUG` truthy) so production logs stay quiet.
- Output is one JSON line per event (`{ level, event, message?, name?, code?,
  digest?, ...context, ts }`) so Vercel parses it into queryable fields and a
  future alert/log-drain can filter on `level`/`event`.
- **No PII in logs.** Pass only `err` (the logger keeps just message/name/code/
  digest) plus an allow-listed `context` (event, `scope`, `request_id`, view/
  table, status, counts). Never pass request bodies, form fields, Supabase rows,
  headers, IPs, `x-api-key`, phone/contact, or free text. `sanitizeContext`
  drops denylisted keys as a safety net, but call sites must not rely on it.
  Correlate with `request_id` (from `resolveRequestId`), never with the payload.
- Client crashes: `src/app/error.tsx` forwards `message` + `digest` to
  `POST /api/client-error` (`src/app/api/client-error/route.ts`), which logs
  server-side — a browser `console.error` never reaches Vercel logs. This
  round-trip is OFF by default and only runs when
  `NEXT_PUBLIC_CLIENT_ERROR_LOGGING="true"` (both the client send and the route
  honor the flag).
- Expected control flow (auth denials, validation 400s, bad JSON) is NOT logged
  as `error`; use `logDebug` or nothing so real failures stay visible.

Alerting is not wired yet: logs are alert-ready. Wire later via a Vercel Log
Drain → Logflare/Datadog/Sentry alerting on `level=error`, or add `@sentry/nextjs`
(`src/app/api/.../instrumentation`). No logging dependency is added today.

## Review Checklist

- Does the change preserve private-field redaction in UI, API, and audit history?
- Does every write path keep source attribution and auditability?
- Are new migrations forward-only and safe for both `staging` and `main`?
- Does issue automation only add obvious first-pass labels and leave
  `status:triaged`, assignment, and closing decisions to humans?
- Are public docs clear that reports are community coordination signals, not
  official government or structural-safety certification?
- Did you run the narrowest useful test plus `npm run lint` or `npm run build`
  when touching application code?
- Does every new server `catch` or error-swallow path log via `logError`/
  `logWarn` (from `src/lib/log.mjs`) with no PII in the event or context?

## Git

Use focused branches and pull requests. Do not push directly to `main` or
`staging` unless the maintainers explicitly instruct you to do so.

Default PR target: `staging`. Branch from `upstream/staging`, push to a fork or
feature branch, and open the PR against `mawmawmaw/venezuela-ayuda:staging`.
Review the staged app at <https://venezuela-ayuda-staging.vercel.app/>. If a PR
was accidentally opened against `main`, rebase the feature branch onto
`upstream/staging` before changing the PR base so unrelated `main`-only commits
do not appear in the diff.

When a PR touches frontend (UI, components, or anything visually observable),
attach a short **GIF** of the feature working so reviewers can see the change
without checking out the branch. In Claude Code, run `/verify` to drive the app
and record the GIF. This is recommended (best-effort), not a hard gate: `/verify`
runs locally and not every contributor uses Claude Code, so reviewers should not
block solely on a missing GIF.

Recommended branch names:

```text
feat/<area>-<short-description>
fix/<area>-<short-description>
docs/<short-description>
task/<short-description>
```

Use conventional commits when possible, for example:

```text
docs: add open-source contribution guide
fix(api): preserve request id on partner write failures
feat(admin): add duplicate review filter
```

## Security

Follow the repository security policy and the collaboration docs once they land.
Do not open public issues or PR comments that contain real phone numbers, private
contacts, API keys, database URLs, or sensitive crisis records. Use sanitized
examples.
