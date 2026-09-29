# Open items

Collated on 29 Sep 2026, at the end of mock-up step 8, from `PLAN.md`, `MOCKUP_PLAN.md`
and the working sessions. The detail and references are in the linked sections.

## A. Questions for you

| # | Question | Why it matters | Source |
|---|---|---|---|
| A1 | What is the full reference for the HSSIB report? | Needed to cite it in any policy or pilot proposal | PLAN §2.1, §9 Q1 |
| A2 | Is there a senior sponsor in NHS England or an ICB who would host a pilot? | Connections aren't being granted, so a sponsored pilot is the likely route | PLAN §9 Q2 |
| A3 | Should minors, proxies and patients without NHS login be permanently out of scope? (Recommended: yes) | Affects the consent design and the hazard log | PLAN §2.6, §9 Q3 |
| A4 | Single supplier or platform? | Undecided. The recommendation is to build API-first and decide after the pilot | PLAN §9 Q5 |
| A5 | After consent is withdrawn, should a provider still be able to notify the GP about care already given? | At present withdrawal blocks it. The two options are patient control versus safety-positive information flow | MOCKUP_PLAN §7, step 7 |
| A6 | Does a *coded* "no known allergies" entry render differently from "no allergies recorded" in the real HTML ALL section? | Clinically significant: absence of data must never read as a negative assertion | Conformance work, 29 Sep |
| A7 | Should stakeholders be able to open the hosted demo without a Vercel login? It's protected by Vercel SSO at present | All the data is synthetic, but a public link needs a decision | Hosting |

## B. Decisions needing a Clinical Safety Officer (CSO) or Data Protection Officer (DPO)

| # | Decision | Current mock-up behaviour | Source |
|---|---|---|---|
| B1 | May text-message (SMS) consent authorise **notifying the GP** (Send Document)? | Yes: view and notify only, with no structured copying, for at most 30 days | MOCKUP_PLAN §7, step 7 |
| B2 | Accept the SMS fallback as a whole, and its controls? | PDS number only, one-time code plus date of birth, 10-minute expiry, 5 attempts, view-only, 30 days | PLAN §2.4 |
| B3 | Hazard-log entry: **dissent and "record not held" are indistinguishable** (both return `PATIENT_NOT_FOUND`) | A neutral message that warns "no information returned ≠ no allergies" | PLAN §2.6 |
| B4 | Hazard-log entry: reliance on the GP Connect producer's sensitive-data exclusions | We don't re-filter; we show the producer's "items withheld" banner | PLAN §2.6 |
| B5 | Retention periods for audit and consent records | Not set; the audit is append-only | PLAN §3 (NHS Records Management Code of Practice) |

## C. Evidence needed to verify the simulation

Each of these needs a real example from the GP Connect Demonstrator, the specifications or the NHS England team.

| # | Item | Status | Where in the code |
|---|---|---|---|
| C1 | HTML sections other than ALL (SUM, MED, PRB, ENC, CLI, REF, OBS, IMM, ADM) | Placeholder HTML | `packages/adapters/src/mock/careRecordHtml.ts` |
| C2 | Send Document: Bundle structure, MessageHeader event, MESH workflow id (`GPFED_CONSULT_REPORT` assumed) | ⚠ Unverified | `packages/adapters/src/sendDocument.ts` |
| C3 | Structured 1.x: the JWT `aud` value and the `include*` parameter names | Unverified | `packages/adapters/src/gpConnectStructured.ts` |
| C4 | Structured 1.x error response shape | Unverified | same |
| C5 | Status and codes for malformed requests and JWTs (we assume 400 `BAD_REQUEST` and 422 `INVALID_PARAMETER`) | Unverified | `packages/adapters/src/mock/gpConnectProducer.ts` |
| C6 | The SDS job role code a real consumer should send in the JWT | Placeholder `sds-job-role-name` | `packages/adapters/src/gpConnect.ts` |

Already verified against real traffic: the HTML 0.7.2 request (JWT, headers, body), the ALL section (byte-identical in two cases), and the `PATIENT_NOT_FOUND` 404.

## D. Actions outside this repository

| # | Action | Owner |
|---|---|---|
| D1 | **Fix the blood-pressure bug in GP-Connect-Demo.** Its builder uses `parseFloat`, so "138/86 mmHg" becomes 138. This project works around it, but the Demonstrator itself is affected, and this project must not push to that repository | You |
| D2 | Hold a Phase 0 meeting with the NHS England GP Connect and onboarding team | You |
| D3 | Get a legal opinion on lawful basis, consent, and the processor/controller split | You |
| D4 | Appoint a CSO and a DPO. Start the hazard log (DCB0129) and the DPIA now | You |
| D5 | Register for the national sandboxes (PDS, NHS login, MESH) and GP Connect INT | You |
| D6 | Assess IM1 Patient Facing Services as a parallel, patient-mediated route | You |

## E. Technical backlog, if the mock-up continues

| # | Item | Notes |
|---|---|---|
| E1 | Demo-data reset | The hosted demo accumulates data, and the audit table blocks deletes by design. Suggest a separate demo database that is thrown away and recreated |
| E2 | Automatic expiry for injected faults (e.g. 15 minutes) | A fault left switched on breaks the demo for everyone |
| E3 | Auditor report per patient and per provider | At present "who viewed what" has to be read from raw event details |
| E4 | STU3→R4 conversion for provider systems | Out of scope for the mock (MOCKUP_PLAN §3.4); the interface is ready |
| E5 | Swap in real HTML examples as they arrive (C1) and correct against C2–C6 | |
| E6 | Implement the outcome of A5 and B1 | |
| E7 | A source adaptor for IM1 Patient Facing Services, if D6 is pursued | The architecture already allows the source adaptor to be swapped |

## F. Non-coding issues raised (policy, IG, clinical safety, commercial)

1. **Permitted use: existential.** GP Connect is for direct care. NHS England isn't currently
   granting connections to private providers. Treat Phase 0 as policy-shaping: propose a
   controlled pilot using the HSSIB findings. Don't spend on production (HSCN, live
   certificates) before agreement.
   (PLAN §2.1; https://digital.nhs.uk/services/gp-connect)
2. **The commercial framing.** "Pay for access to patient records" reads as selling NHS
   data. Charge for the service, not per record. Present it as supporting safe direct care
   the patient has chosen. Involve patients and the BMA GPC early; practices are the
   controllers.
   (PLAN §2.2)
3. **Consent is not the UK GDPR lawful basis.**
   - The likely basis is Art 6(1)(b) or (f), together with Art 9(2)(h) and DPA 2018 Sch 1
     para 2.
   - Explicit consent satisfies the common-law duty of confidentiality.
   - Keep the two separate in the DPIA and in patient wording.

   (PLAN §2.3; ICO special category data guidance; Caldicott Principles 2020)
4. **SMS is weak evidence of identity.** Use NHS login P9 first. SMS is a restricted
   fallback that needs CSO and DPO sign-off.
   (PLAN §2.4; https://nhsconnect.github.io/nhslogin/)
5. **Copied data can't be "un-consented".** Withdrawing consent stops future access only,
   and the patient wording must say so.
   (PLAN §2.5)
6. **Groups to exclude:**
   - S-flag (restricted) records
   - under-16s, proxies, and patients lacking capacity
   - deceased patients
   - dissent at the practice, which consent through this service can't override
   - practices without GP Connect, where the service must fail gracefully

   (PLAN §2.6)
7. **Middleware role.** Act as a data processor for each provider, and keep a pass-through
   model with no persistence of clinical content. The mock-up already does this, including
   for Send Document.
   (PLAN §2.7)
8. **Coerced consent.** "Consent or no prescription" is a high-likelihood risk. Explain it to
   patients and monitor refusal rates.
   (PLAN §8)
9. **Reputational risk from sectors under scrutiny** (online GLP-1 supply, medical
   cannabis). Onboard only CQC or GPhC-registered providers in good standing, suspend a
   provider on regulator action, and publish the list of connected providers.
   (PLAN §8)
10. **Practice and BMA opposition.** Practices could disable GP Connect. Engage early and be
    transparent.
    (PLAN §8)
11. **The assurance workstreams are the critical path, not the code:**
    - NHS England Digital Onboarding and the Supplier Conformance Assessment List (SCAL)
    - DCB0129 and DCB0160
    - DPIA and Art 28 contracts
    - Data Security and Protection Toolkit (DSPT): Standards Met
    - Digital Technology Assessment Criteria (DTAC)
    - Cyber Essentials Plus, ISO 27001, penetration testing
    - NHS login partner onboarding
    - HSCN connection, if needed
    - provider due diligence

    (PLAN §3)
12. **Named roles from day one:** SIRO, Caldicott Guardian, DPO, CSO, security lead.
    (PLAN §3)
13. **Oversight of staff.** Any look at the audit trail should itself be audited and visible
    to the patient. The mock-up does this. Decide whether the real service should too.
    (Step 8)
