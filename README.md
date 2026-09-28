# Private GP Connect: simulated middleware

A working mock-up of a middleware service that lets independent healthcare providers
view GP records, with patient consent, through NHS Spine services. **Everything is
simulated.** Nothing connects to PDS, SDS, GP Connect, MESH or NHS login, and all data
is synthetic.

- Plan: [`docs/PLAN.md`](docs/PLAN.md)
- Mock-up plan: [`docs/MOCKUP_PLAN.md`](docs/MOCKUP_PLAN.md)

## Layout

| Path | What |
|---|---|
| `apps/web` | React + Vite + Tailwind UI (provider, patient, admin, practice views) |
| `apps/api` | Fastify API for providers; OpenAPI at `/api/openapi.json`, Swagger UI at `/api-docs/` |
| `packages/core` | Consent lifecycle, provider-type profiles, policy decision point, hash-chained audit log. Pure TypeScript, no I/O |
| `packages/adapters` | Interfaces to PDS, SDS, NHS login and SMS, their simulators, and fault injection |
| `packages/fixtures` | Synthetic patients (999-range NHS numbers, drama-range mobiles), practices and provider organisations |
| `packages/store-postgres` | Postgres/Supabase implementations of the consent and audit stores |
| `supabase/migrations` | Database schema (private `pgpc` schema, append-only audit table) |
| `packages/gpc-fhir` | GP Connect STU3 parser, extractors and synthetic record builder, copied from [GP-Connect-Demo](https://github.com/DrDamo/GP-Connect-Demo) (see its `PROVENANCE.md`) |
| `scripts/build-vercel.mjs` | Packages the web app and API as Vercel Build Output |
| `scripts/sync-gpc-fhir.sh` | Re-syncs `packages/gpc-fhir` from a GP-Connect-Demo checkout |

## Develop

Requires Node 22.12 or later.

```bash
npm install
npm run dev        # API on :3001, web on :5173 (proxies /api)
npm run check      # lint + typecheck + tests
npm run build      # web build + .vercel/output
```

## Deploy

Vercel runs `npm run build`, which writes `.vercel/output` using the
[Build Output API](https://vercel.com/docs/build-output-api/v3):
- the web app is served as static files
- every `/api/*` request goes to a single bundled Node function

Environment variables (Vercel → Project → Settings → Environment Variables):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres, **transaction pooler** connection string (port 6543). If unset, the API uses in-memory stores that reset on every cold start |
| `AUDIT_PSEUDONYM_KEY` | Secret (≥ 32 chars) used to pseudonymise NHS numbers in the audit log. Required with `DATABASE_URL`. Generate with `openssl rand -hex 32` |

`/api/health` reports which store is in use (`store`) and whether the database is reachable (`database`).

Migrations in `supabase/migrations/` are applied to the Supabase project `private-gpconnect-mock` (eu-west-2).
