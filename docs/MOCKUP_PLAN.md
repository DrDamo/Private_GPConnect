# Mock-up Plan: Simulated Middleware

**Status:** Draft v0.1. Technical only; policy and IG are deliberately out of scope for now.
**Date:** 28 September 2026
**Related:** [PLAN.md](./PLAN.md)

---

## 1. Recommendation: yes, build a mock-up first, but make it a *walking skeleton*, not a throwaway clickable prototype

A mock-up is worthwhile because it lets us:
- **show** the end-to-end journey to NHS England, providers and practices while the policy route is closed
- test the consent UX, the thing most likely to decide whether patients and stakeholders trust it, before any Spine work
- settle the internal contracts early: consent, policy decision, audit, and the source adaptors

**The key design choice:** the mock runs the **real** consent, policy and audit logic on a **server**, and puts *only* the national services behind simulated adaptors. Each simulator implements the same interface a real client will implement later. Moving to INT then means swapping adaptors, not rewriting the app.

Things to avoid:
- A browser-only mock where consent and audit happen in React state. It would demo well but show nothing about enforcement, and it would all be thrown away.
- Building simulators more faithful than the demo needs. Each simulator only needs to be as realistic as the journeys it supports.

---

## 2. What we can reuse from GP-Connect-Demo

Source reviewed: `DrDamo/GP-Connect-Demo` @ `b49223f` (2026-09-25). It is **read-only** for this project; any code we take will be **copied in, with provenance recorded**, and the original repository will not be changed.

| Demonstrator module | Reuse | Use in the mock |
|---|---|---|
| `src/fhir/*.ts`: parser (JSON/XML), extractors for medications, allergies, problems, consultations, investigations, immunisations, referrals, documents, diary, coded data, lists; NHS number validation | **High, copy nearly as-is** | Turns the simulated Structured response into the provider's clinical view, and validates NHS numbers. Already handles EMIS/TPP differences (`docs/emis-tpp-medicus-variations.md`) |
| `src/components/clinical/*`: domain views, patient banner, warning banners | **High, copy and restyle** | Provider portal "Structured record" view |
| `src/builder/generate/*`: builds a GP Connect STU3 Bundle from a draft record, including confidential-item exclusion and `NOPAT` labels | **High** | **Synthetic patient generator** for the GP Connect Structured simulator: a scripted persona in, a realistic Bundle out |
| `public/gpc-sample-bundle.json`, `src/sample-data/*`, `training-content/fhir_examples/*` | **High** | Fixtures and test data. **Confirm all of it is INT/synthetic before copying**, since the variations doc mentions "real" EMIS/TPP bundles |
| `src/fhir/validator.ts` | Medium | Checks the simulator's output (it keeps the simulator honest) |
| `server/`: SNOMED/dm+d terminology proxy | Optional | Not needed for the mock; useful later |
| Supabase auth, training, onboarding, marketing | **Don't reuse** | Out of scope. The 16 Sep code review also found security issues in this area (S-07 to S-09): worth confirming the admin password was rotated, since the repo is public |

The extractors and clinical views are **not tied to Supabase**, so lifting them out is straightforward. There are about 12.6k lines across the `fhir`, `builder/generate` and `clinical` folders.

**Stack decision:** PLAN.md §5 suggested .NET or Java. Given how much TypeScript can be reused, I now recommend **TypeScript end to end** for the mock and very probably for production. If we need stricter conformance checks later, the HAPI FHIR validator can run as a separate service.

---

## 3. Mock-up scope

### 3.1 Personas and screens
1. **Provider clinician** (portal):
   - log in
   - pick provider type (pharmacy / weight management / medical cannabis)
   - search for the patient (PDS)
   - request consent
   - view the HTML record
   - view the Structured record
   - send a document to the GP
2. **Patient**:
   - receives the request
   - NHS login (simulated) or SMS link (simulated)
   - sees the scope and approves or declines
   - views the access log
   - withdraws consent
3. **Admin / auditor**:
   - live audit trail, filterable, with a hash-chain integrity check
   - consent register
   - provider organisations and users
4. **GP practice view** (simulated): a MESH inbox showing what the practice receives through Send Document.

### 3.2 Simulated adaptors
Each one has an interface in `packages/adapters` and a mock implementation. The real client is added later.

| Adaptor | Mock behaviour |
|---|---|
| **PDS** | About 15 synthetic patients, including edge cases: S-flag (restricted), deceased, no mobile on record, under-16, recently changed GP, invalid NHS number |
| **SDS** | Maps practice ODS code to endpoint, ASID and supplier (EMIS/TPP). Some practices are "not GP Connect enabled" |
| **GP Connect Access Record HTML** | Returns canned HTML sections per patient (summary, encounters, medications, problems…) in the GP Connect HTML view structure |
| **GP Connect Access Record Structured** | Generated with the Demonstrator's builder; honours clinical-area parameters so data minimisation by provider-type profile is enforced; EMIS/TPP flavours; confidential items excluded; OperationOutcome for disabled areas |
| **Send Document / MESH** | Accepts the document Bundle, adds it to the simulated practice inbox, and returns acknowledgements (success, delayed or failed) |
| **NHS login** | A fake OIDC provider. Pick a persona, get an ID token with `nhs_number` and `identity_proofing_level=P9` |
| **SMS** | An on-screen "phone" panel shows the message and one-time code. No real SMS is sent |

**Fault injection:** an admin toggle that makes any adaptor time out, return an error, or return a 404 for a patient. This is useful for demos and essential for testing the error UX.

### 3.3 Real logic, even in the mock
- **Consent service:** FHIR R4 `Consent`-shaped records with scope, provider-type profile, assurance level, expiry and withdrawal.
- **Policy decision point:** every adaptor call goes through a single check: valid consent + scope + active user/org + patient not S-flagged. The UI has no way around it.
- **Audit service:** append-only and hash-chained, with a correlation ID across the whole request. The patient-facing log is generated from it.
- **JWT construction:** build the real GP Connect access-token claims, even though no call goes to the Spine. This shows the identity chain and is directly reusable later.

### 3.4 Explicitly *not* in the mock
- real Spine, HSCN or certificates
- real NHS login or SMS
- real provider EPR integration (a Swagger UI for the provider API is enough)
- STU3→R4 conversion (keep the interface, and return STU3 only for now)
- production hosting hardening

---

## 4. Proposed structure

```
Private_GPConnect/
├── apps/
│   ├── web/            React + Vite + Tailwind: provider, patient, admin, practice views
│   └── api/            Node + TypeScript (Fastify): REST API for the provider EPR, OpenAPI docs
├── packages/
│   ├── core/           consent, policy decision point, audit (no I/O dependencies)
│   ├── adapters/       interfaces + mock/* implementations (later: int/*, live/*)
│   ├── gpc-fhir/       copied from GP-Connect-Demo (parser, extractors, builder) + PROVENANCE.md
│   └── fixtures/       synthetic patients, HTML views, practices, provider orgs
└── docs/
```

- **Storage:** SQLite or local Postgres via Docker. The mock must not depend on a hosted database.
- **Config:** `ADAPTER_MODE=mock|int` selects the implementations at start-up.
- **Tests:**
  - unit tests for core (the policy decision point must be exhaustively tested)
  - contract tests that every adaptor implementation must pass (mock now, INT later)
  - one Playwright end-to-end test for the main journey
- **Hosting for demos:** Vercel or similar is fine, since all data is synthetic. Show a "SIMULATION – NOT REAL PATIENT DATA" banner on every page.

---

## 5. Build order

| Step | Deliverable | Rough effort* |
|---|---|---|
| 1 | Repo scaffold, CI, lint and test; copy `gpc-fhir` from the Demonstrator with provenance | 2–3 days |
| 2 | `core`: consent model, policy decision point, hash-chained audit, with unit tests | 3–4 days |
| 3 | Mock PDS, SDS, NHS login and SMS, plus synthetic patient fixtures | 3 days |
| 4 | Patient consent journey (NHS login and SMS) and the patient access log | 3–4 days |
| 5 | Provider portal: search, consent request, HTML view | 3–4 days |
| 6 | Structured simulator (builder-based) and clinical views reused from the Demonstrator; provider-type profiles | 4–5 days |
| 7 | Send Document plus the simulated practice MESH inbox | 2–3 days |
| 8 | Admin/audit console, fault injection, demo script | 3 days |

\*Assumes one experienced developer working with Claude Code. That comes to **about 5–6 weeks**. Steps 1–5 alone make a demonstrable consent-and-HTML journey in about 2.5 weeks, and that would be a sensible first checkpoint.

---

## 6. Decisions (28 Sep 2026)
1. **Provider API:** in scope. Fastify with OpenAPI; Swagger UI at `/api-docs/`.
2. **Hosting:** a hosted link on Vercel, deployed through the Build Output API (`scripts/build-vercel.mjs`). A persistent database is needed from step 2, because serverless functions are stateless. I propose Postgres in a UK/EU region, e.g. Supabase or Neon, with an in-memory store for tests.
3. **Fixtures:** all Demonstrator data is dummy data (confirmed by its author).

## 7. Progress
- [x] **Step 1:** workspace scaffold (npm workspaces: `apps/web`, `apps/api`, `packages/gpc-fhir`), ESLint, TypeScript, Vitest, GitHub Actions CI, and the Vercel build. `gpc-fhir` was copied from the Demonstrator @ `b49223f`, with tests showing the fixtures parse and validate and the builder round-trips.
