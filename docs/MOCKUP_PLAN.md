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
- [x] **Step 2:** `packages/core`, covering:
  - the consent lifecycle (request → grant/decline → withdraw/expire), with optimistic concurrency
  - provider-type data profiles
  - assurance rules (SMS consent = view-only, 30 days maximum)
  - the policy decision point, which reports every applicable deny reason and has each one tested
  - the hash-chained audit log, with HMAC-pseudonymised NHS numbers and tamper detection
  - a FHIR R4 Consent view

  `packages/store-postgres` persists this to Supabase (project `private-gpconnect-mock`, eu-west-2). The schema is private, and the audit table is append-only through database triggers. The same contract tests run against the in-memory and Postgres stores, the latter using PGlite.
- [x] **Step 3:** `packages/fixtures` holds the synthetic data:
  - 15 patients, each covering a scenario: happy path at EMIS and at TPP, weight management, medical cannabis, polypharmacy, S-flag, deceased, under-16, no mobile or NHS login, practice not on GP Connect, recent GP change, confidential items, NHS login at P5 only, and an ambiguous search
  - 4 practices, with one not enabled for GP Connect
  - 4 provider organisations, one of them suspended, and their users

  `packages/adapters` provides:
  - interfaces and simulators for PDS, SDS, NHS login and SMS
  - PDS responses rendered as FHIR R4 and parsed back through the same mapping a real client will use
  - NHS login authorisation codes that are signed and stateless, with checks on expiry, redirect URI and nonce, and no NHS number released for P5 accounts
  - an SMS simulator that is hard-limited to drama-range numbers, with a Postgres-backed outbox
  - fault injection (timeout, outage, latency) applied to every adapter

  The API adds `/api/sim/*` endpoints for the patient list, the NHS login persona picker and the on-screen phone. The web app has a *Synthetic test patients* page.
- [x] **Step 4:** the patient consent journey.
  - **Consent request:** a provider's request checks the patient on PDS and refuses S-flag, deceased and under-16 patients, using the same rules as the policy decision point. The patient is texted at the **PDS** mobile number, and the text doesn't name the provider.
  - **Sign-in:** nothing identifying is shown before sign-in. NHS login must be P9: P5 is refused, and the sign-in state is checked to stop login-CSRF. The fallback is a text-message code plus date of birth. Codes are hashed, expire after 10 minutes, allow 5 attempts, are single use, and at most 3 can be sent per 15 minutes. A code sign-in is limited to that one request, to viewing only, and to 30 days.
  - **Decision:** the patient agrees to a versioned, hashed wording, and the server rejects a decision made against out-of-date wording.
  - **Patient dashboard** (NHS login only): lists requests and consents, allows withdrawal, and shows a plain-English access log built from the audit trail.
  - **Simulator pages:** an NHS login persona picker, an on-screen phone, and a demo launcher that stands in for the provider portal.
- [x] **Step 5:** the provider portal and API.
  - **Sign-in:** simulated. The real service would use CIS2 or OIDC with MFA. The same token works as a cookie for the portal and as a Bearer token for provider systems.
  - **Patient search:** PDS search by NHS number, or by demographics with ambiguous matches handled. Providers see only identity details. An S-flag record shows nothing beyond the NHS number.
  - **Consent management:** request consent, cancel a request, or end access early.
  - **GP Connect Access Record: HTML:** the request is built to spec (Ssp-* headers and an unsigned JWT with the requesting organisation, practitioner, `directcare` and `requested_record`). A simulated GP system validates it the way a producer would and returns a Composition-based Bundle.
  - **Placeholder content:** per record profile, including "no data" messages and a confidential-items exclusion banner.
  - **Access check and audit:** every view goes through the policy decision point and is audited, whether permitted, denied or failed, and it appears in the patient's access log.
  - **Display:** HTML is sanitised on the server and rendered in a sandboxed iframe (no scripts, no same-origin access) with a viewer watermark. Responses are `no-store`.
  - **Request inspector:** shows exactly what was sent to the GP system.
  - **Still to do:** swap the placeholder HTML for real dummy examples.
- [x] **Step 6:** GP Connect Access Record: Structured (FHIR STU3).
  - **Request:** `$gpc.getstructuredrecord` asks only for the consented clinical areas, using `include*` parameters (1.x names, still to be verified).
  - **Simulated GP system:** builds each record with the GP Connect Demonstrator's builder from the same fixtures as the HTML view. It returns only the requested areas; an empty area still comes back as a List with an emptyReason; and confidential items are withheld with the List warning.
  - **Defence in depth:** the consumer strips anything outside the requested areas, including consultation-structure Lists and unreferenced Observations, and records how much it stripped.
  - **Safety behaviours covered by tests:**
    - the original dosage free text is always carried
    - "No known allergies" is positively asserted (716186003), which is distinct from nothing recorded
    - blood pressure is split into systolic and diastolic, never truncated
  - **Portal:** a *Structured data* tab parsed with the Demonstrator's extractors, and a FHIR bundle download. The API offers `format=bundle` for provider systems.
  - **Checks:** the policy decision point checks the action and every area, so SMS (view-only) consent can't retrieve structured data. Every retrieval is audited and appears in the patient's log.
  - **Found along the way:** the Demonstrator's builder parses any value with a unit using `parseFloat`, so "138/86 mmHg" becomes 138. This needs fixing upstream.
- [x] **Conformance with real GP Connect traffic** (29 Sep 2026). A real Access Record HTML 0.7.2 request/response pair (ALL section) from the GP Connect Demonstrator is kept in `packages/fixtures/gpconnect-examples/`, and tests check the simulator and the protocol code against it. Corrections made:
  - The JWT `aud` is the fixed `https://authorize.fhir.nhs.net/token` (we had used the request URL).
  - JWT resources are DSTU2-shaped (single HumanName, `practitionerRole`), and `sub` equals `requesting_practitioner.id`. The device and organisation carry ids.
  - Access Record HTML 0.7.x is **FHIR DSTU2**, not STU3. Structured 1.x remains STU3.
  - Simulated responses now carry the real Composition shape (profile, class, author, `fullUrl` entries for Practitioner, Organization and Patient) and `class="date-column"` on date cells.
  - The sanitiser is checked to keep all real content, with only `xmlns` dropped, and to strip scripts, handlers, links, images, styles and iframes.
  - **Still to verify:** the 1.x (Structured) JWT `aud` and the SDS job role code a real consumer should send.
- [x] **Real error responses** (29 Sep 2026). A real `PATIENT_NOT_FOUND` OperationOutcome (HTTP 404) is kept as a reference fixture. The simulated GP system now returns GP Connect errors as OperationOutcome responses, and its 404 is identical to the real one. The GP Connect team confirmed that **the same response is returned when the patient has dissented to sharing**, so:
  - The two causes are indistinguishable. Test patients cover both (record not held; dissented), and tests show the provider gets byte-identical responses.
  - The provider message is neutral, names both possibilities, and warns that no information returned doesn't mean no allergies, medicines or conditions. It isn't retryable.
  - Failures are audited with the GP Connect code, and the patient's log says their practice didn't return the record.
  - The consent wording (now `2026-09-v2`) tells patients that a choice not to share, made at their practice, still applies. Our consent never overrides it.
  - **Still to verify:** the status and codes for malformed requests and JWTs (we assume 400 BAD_REQUEST and 422 INVALID_PARAMETER), and the 1.x (Structured) error shape.
