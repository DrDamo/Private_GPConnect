# Private GP Connect Middleware: Delivery Plan

**Status:** Draft v0.2. Updated with answers to the open questions. No code yet.
**Date:** 28 September 2026

---

## 1. What we're building

This is a middleware service that lets **independent (private) healthcare providers** see a patient's GP record, and send documents back to the GP, **only when the patient has given explicit consent**.

| Side | Capabilities |
|---|---|
| **NHS (Spine)** | PDS FHIR (trace/verify), SDS (endpoint lookup), GP Connect Access Record: HTML, GP Connect Access Record: Structured, GP Connect Send Document (via MESH) |
| **Consumer** | Private providers, through a web portal and an API for their EPR |
| **Patient** | Consent given through NHS login (preferred) or an SMS link. Patients can see who has accessed their record and can withdraw consent |

---

## 2. Issues to resolve before building (critical-friend section)

These are the risks that could stop the project. Each one should be settled at a **Phase 0 go/no-go gate** before any significant build spend.

### 2.1 Permitted use of GP Connect by privately funded care: *existential*
GP Connect is provided for **direct care**. Before building, get written confirmation from NHS England that a provider delivering **privately funded** care, not NHS-commissioned care, is an eligible consumer organisation. The same confirmation should cover access through an intermediary supplier, and the practice-side data sharing arrangements.
- Ref: GP Connect service overview, https://digital.nhs.uk/services/gp-connect
- Ref: GP Connect specifications, https://developer.nhs.uk/apis/gpconnect/

**Current position (confirmed):** the policy is uncertain, and **NHS England is not currently granting connections to private providers**. A recent HSSIB report highlighted the safety case for sharing records with private providers. *(Full HSSIB citation to be added.)*

**What this means for the plan:**
- Treat Phase 0 as a **policy-shaping** exercise, not just a confirmation exercise. Use the HSSIB findings to propose a **controlled pilot**, such as a First of Type or sandbox, run under NHS England oversight. Offer the consent, audit and assurance design as the answer to "how do we make this safe?".
- Only build up to what can be exercised in **national INT / sandbox environments** until a pilot is agreed. Don't spend on production infrastructure (HSCN, live Spine certificates) before then.
- Evaluate the patient-mediated route in §2.8 as a **parallel, possibly earlier** way to reach the market.

### 2.8 Alternative route: patient-mediated access (IM1 Patient Facing Services / NHS login)
Patients can already access their own GP record online, and IM1 **Patient Facing Services (PFS)** lets assured third-party apps retrieve it with the patient's own NHS login credentials. A patient-mediated model, where the patient pulls their own record and chooses to share it with the provider, could:
- avoid the GP Connect policy blocker
- make consent **real and patient-driven**, not a gate imposed on the patient
- reuse the same consent, audit and provider-side components

**Caveats:**
- IM1 PFS terms of use and pairing assurance must be checked to confirm that provider-initiated or provider-facing use is permitted.
- What the patient can see depends on the practice's online-access settings, and third-party information may be redacted.
- The data is less complete and less structured than GP Connect Structured.

**Recommendation:** assess this in Phase 0, alongside the GP Connect route. Design the architecture so that the source adaptor ("GP Connect" or "IM1 PFS") can be swapped.
- Ref: IM1 interface mechanism, https://digital.nhs.uk/services/gp-it-futures-systems/im1-pairing-integration

### 2.2 The commercial framing: "pay for access to patient records"
This phrasing will be read as **selling NHS data**. That is likely to fail with NHS England, the ICO, the BMA/RCGP, practices and the press. Recommendations:
- Charge for the **service**: a platform subscription or a per-episode integration fee. Don't charge per record retrieved.
- Describe it everywhere as *"supporting safe direct care for patients who choose private treatment"*.
- Commission an early **public/patient involvement** exercise and consult the BMA GPC. Practices are the controllers of the GP record, and their goodwill decides whether the service works.

### 2.3 Consent is not the UK GDPR lawful basis
It's a common mistake to treat patient consent as the UK GDPR lawful basis. For direct care, the lawful basis for the private provider is typically:
- **Art 6(1)(b)** (contract) or **6(1)(f)** (legitimate interests), and
- **Art 9(2)(h)** (provision of health care) together with DPA 2018 Sch 1 Part 1 para 2.

The patient's **explicit consent** is then the mechanism that satisfies the **common law duty of confidentiality**, and it is also a strong transparency control. Keep these two things separate in the DPIA and in patient-facing wording. If you rely on Art 6(1)(a) consent instead, you inherit withdrawal and "freely given" problems, because there is a power imbalance when a patient wants treatment.
- Ref: ICO, *Lawful basis for processing special category data*, https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/
- Ref: *National Data Guardian*, Caldicott Principles (2020), https://www.gov.uk/government/publications/the-caldicott-principles

### 2.4 SMS is weak evidence of consent
SMS proves control of a phone number and nothing more. There is no identity proofing, SIM-swap is a real attack, and the mobile number held on PDS is not guaranteed to be verified or current. Recommendations:
- **NHS login at P9** as the primary route. It gives verified identity and the NHS number.
  - Ref: NHS login identity verification levels, https://nhsconnect.github.io/nhslogin/
- Allow SMS **only** as a lower-assurance fallback, under all of these conditions:
  - it is sent **only to the mobile number held on PDS**, never to a number the provider supplies
  - it is a one-time link plus a knowledge check such as DOB and postcode
  - it has a short expiry
  - the provider has recorded that it verified the patient's identity face to face
- Consider limiting SMS-consented access to **HTML view, single episode, short duration**.
- Get the Clinical Safety Officer (CSO) and DPO to sign off the risk explicitly.

### 2.5 Data can't be "un-consented" once it has been copied
When a provider has viewed or imported GP data, withdrawing consent stops **future** access only. The patient wording has to say this clearly. The provider's own record-keeping obligations then apply.

### 2.6 Groups to exclude or treat carefully
- **PDS restricted (S-flag) patients.** Exclude them. Never return their address or GP details.
- **Under-16s, Gillick competence, proxies, and patients lacking capacity.** Exclude these from the MVP.
- **Deceased patients.** Exclude.
- **Patients not currently GP-registered in England, or at practices without GP Connect enabled.** Fail gracefully with a clear message.
- **Sensitive-data exclusions.** Rely on the GP Connect producer's existing exclusions and don't try to re-filter. Document the reliance in the hazard log.
- **Patients who have dissented at their GP practice.** GP Connect returns the same `PATIENT_NOT_FOUND` as when no record is held (confirmed by the GP Connect team). Consent given through this service can't override the practice-level choice. Tell patients this in the consent wording. The provider message must not hint at which cause applies, and must never let "no record returned" read as "nothing recorded". This belongs in the hazard log.

### 2.7 Middleware role
Decide early whether you are a **data processor for each provider** (recommended) or a controller. Build to a **pass-through, no-persistence** model for clinical content: don't cache GP records at rest. This shrinks the security and IG burden a great deal.

---

## 3. Assurance and regulatory workstreams

These run in parallel with the build and are usually the **critical path**, not the code.

| Workstream | What's needed | Owner | Ref |
|---|---|---|---|
| NHS England onboarding | Digital Onboarding, SCAL (Supplier Conformance Assessment List), Connection Agreement, product-level assurance for GP Connect consumer and PDS | Product / Technical lead | https://digital.nhs.uk/developer/guides-and-documentation/digital-onboarding |
| Clinical safety | **DCB0129** (you as manufacturer): named CSO, Clinical Risk Management Plan, Hazard Log, Safety Case. Each provider completes **DCB0160** | CSO | https://digital.nhs.uk/data-and-information/information-standards/information-standards-and-data-collections-including-extractions/publications-and-notifications/standards-and-collections/dcb0129-clinical-risk-management-its-application-in-the-manufacture-of-health-it-systems |
| Data protection | DPIA (yours, plus a template for providers), ICO registration, Records of Processing, DPO appointed, processor contracts (Art 28) with each provider | DPO | UK GDPR / DPA 2018 |
| DSPT | **Standards Met** for your organisation. Make it an onboarding requirement for every provider | SIRO | https://www.dsptoolkit.nhs.uk |
| DTAC | Complete the Digital Technology Assessment Criteria. Commissioners and practices will ask for it | Product | https://transform.england.nhs.uk/key-tools-and-info/digital-technology-assessment-criteria-dtac/ |
| Cyber | Cyber Essentials Plus (minimum), ISO 27001 (strongly recommended), CREST/CHECK penetration test before go-live and annually, NCSC Cloud Security Principles | Security lead | https://www.ncsc.gov.uk/collection/cloud/the-cloud-security-principles |
| NHS login | Partner onboarding: DPIA, clinical safety and a technical conformance process | Product | https://digital.nhs.uk/services/nhs-login |
| Network | Confirm which APIs are internet-facing (PDS FHIR and MESH API are) and which still need **HSCN** / Spine Secure Proxy. Budget for an HSCN connection if required | Technical lead | https://digital.nhs.uk/services/health-and-social-care-network |
| Provider due diligence | Check CQC registration, clinicians' GMC/NMC registration, DSPT, a signed data sharing agreement and a DCB0160 safety case before a provider can be activated | Onboarding team | https://www.cqc.org.uk |
| Records & audit retention | Retention periods for audit and consent records | DPO | NHS Records Management Code of Practice, https://transform.england.nhs.uk/information-governance/guidance/records-management-code/ |

**Named roles needed from day one:**
- SIRO
- Caldicott Guardian (or a named equivalent)
- DPO
- CSO: a registered clinician with the appropriate training
- Security lead

---

## 4. Target architecture

```
 Private provider EPR / portal                     Patient
            │  (OIDC + MFA / CIS2, mTLS API)          │ NHS login (P9) or SMS link
            ▼                                         ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  Edge: WAF, rate limiting, API gateway                           │
 ├──────────────────────────────────────────────────────────────────┤
 │  Provider Service   │  Consent Service     │  Patient Portal     │
 │  - org onboarding   │  - request/grant     │  - approve/deny     │
 │  - users & RBAC     │  - FHIR Consent      │  - view access log  │
 │  - episodes         │  - revoke / expire   │  - revoke           │
 ├──────────────────────────────────────────────────────────────────┤
 │  Policy Decision Point: every Spine call must pass               │
 │  (valid consent + scope + active user + org active + not S-flag) │
 ├──────────────────────────────────────────────────────────────────┤
 │  Spine Integration Layer                                         │
 │  - PDS FHIR (trace / verify / GP ODS / S-flag)                   │
 │  - SDS endpoint & ASID lookup                                    │
 │  - GP Connect Access Record HTML                                 │
 │  - GP Connect Access Record Structured (STU3)                    │
 │  - GP Connect Send Document (MESH)                               │
 ├──────────────────────────────────────────────────────────────────┤
 │  Audit Service (append-only, hash-chained, WORM storage, SIEM)   │
 │  Key Mgmt (HSM-backed KMS) · Secrets · Observability             │
 └──────────────────────────────────────────────────────────────────┘
            │  mTLS / HSCN where required
            ▼
       NHS Spine / API Management / MESH
```

### 4.1 Key design principles
1. **Consent is the gate for every Spine call.** A central policy decision point checks it on every request, with no bypass and no "break glass". This is private, planned care, not an emergency.
2. **Pass-through for clinical data.** Render or return the data to the provider, then discard it. Store no GP record at rest. If a document has to be staged for Send Document, encrypt it and set a TTL.
3. **Every request carries a full identity chain.** The GP Connect JWT needs the requesting organisation, practitioner and purpose. Populate these from **real authenticated identities**, never service accounts. Prefer **NHS CIS2** for provider clinicians if private providers can obtain it through a Registration Authority; otherwise use OIDC with phishing-resistant MFA (FIDO2) and check registration with the GMC/NMC.
4. **Tamper-evident audit.** For every event, record:
   - who: user, role, organisation, ODS
   - which patient: NHS number, stored as a hash plus an encrypted value
   - what was requested and returned, and the response code
   - why: consent ID and episode ID
   - when, and the correlation / Spine interaction IDs

   Keep the log append-only and hash-chained on immutable storage. Give patients a readable view of it.
5. **Detect misuse.** Alert on bulk access, access outside working hours, repeated consent failures, and one user accessing many patients.
6. **UK data residency.** Use a UK-region cloud (e.g. AWS eu-west-2 or Azure UK South), private networking, and encryption in transit and at rest with customer-managed keys.
7. **FHIR version strategy.** GP Connect is STU3, while UK Core and newer national APIs (PDS FHIR) are R4. Use an **R4 / UK Core-aligned internal model**, with a narrowly scoped STU3 adaptor for GP Connect only. Keep this adaptor separate from the rest of the service. **Always keep the original dosage free text** alongside any structured dose.

### 4.2 Consent model (outline)
- **Stored as** a FHIR R4 `Consent` resource, bound to: patient (NHS number), provider organisation (ODS), purpose (an episode of care), **scope** (HTML / Structured / Send Document), **assurance level** (NHS login P9 or SMS), start and expiry, and status.
- **Default duration:** time-limited to the episode, e.g. 90 days, with renewal on request. Never open-ended.
- **Revocation:** the patient can withdraw at any time. Withdrawal takes effect immediately, and the provider is notified.
- **Evidence kept:** timestamp, channel, the text shown to the patient, its version hash, and the IP / NHS login `sub`.

### 4.3 Consent journey (NHS login)
1. The provider creates an episode and requests access.
2. A PDS trace confirms the NHS number and the patient's registered GP, and checks for an S-flag.
3. The patient is notified by email or SMS to the **PDS** contact details, or in clinic by QR code.
4. The patient signs in with NHS login at P9. The service checks that the NHS number matches the one in the request.
5. The patient is shown the provider's name, purpose, data scope and duration, and approves or declines.
6. A consent record is created and the audit event is written.
7. The provider can now make GP Connect calls within that scope.

### 4.4 Target providers and data-minimisation profiles
The first targets are **direct-care** providers: **private pharmacies, weight management services and medical cannabis clinics**. All three are areas where prescribing without sight of the GP record creates real safety risk. Examples include GLP-1 agonists prescribed to patients with eating disorders or pancreatitis, and cannabis-based products prescribed to patients with psychosis history or interacting medicines.

Access Record Structured lets a consumer request specific clinical areas. The consent screen should show a **fixed profile for each provider type**, not a request for everything. The profiles below are illustrative; the CSO should agree the final contents:

| Provider type | Structured sections (illustrative) | Send Document back to GP |
|---|---|---|
| Private pharmacy | Medications, Allergies | Supply / prescription notification |
| Weight management | Medications, Allergies, Problems, relevant Observations (weight, BMI, HbA1c) | Mandatory: prescribing notification (e.g. GLP-1) |
| Medical cannabis | Medications, Allergies, Problems (incl. mental health), Consultations (time-limited) | Mandatory: CBPM prescribing notification |

**Send Document is a safety feature, not a nice-to-have.** For these providers, telling the GP what has been prescribed is arguably as important as reading the record. Consider making it a **condition of service** for prescribing providers.

### 4.5 Structured data consumed by provider EPRs
Structured data is meant to be **consumed**, so it will persist in the provider's system after retrieval. The middleware stays pass-through, but the following controls are needed:
- **Output format:** offer the **native STU3** response and an **R4 / UK Core** rendering. The R4 conversion comes from the narrowly scoped bridge, which always keeps the dosage free text. Label the R4 rendering as derived.
- **Provider EPR integration assurance:** each EPR that consumes the API needs a light-touch conformance check, and the provider's **DCB0160** must cover how the data is imported and shown to clinicians.
- **Provenance:** every resource returned should carry its source (practice ODS, retrieval time), so the provider's record shows where the data came from and how current it is.
- **Contract:** the provider agreement should restrict use to the consented episode. Secondary use, analytics and marketing must be prohibited, with audit rights.

HTML stays **view-only**. Render it sanitised in the portal, or in a secure embedded viewer inside the provider EPR, with no download, printing restricted and a watermark showing user and time.

---

## 5. Suggested technology (non-binding)

| Concern | Suggestion | Why |
|---|---|---|
| Language / FHIR | **.NET + Firely SDK** or **Java + HAPI FHIR** | Both have mature STU3 and R4 support, and both are widely used by NHS suppliers |
| Hosting | AWS or Azure UK region, Kubernetes or managed containers | NHS-familiar, and makes the NCSC principles easier to evidence |
| Data | PostgreSQL (consent, orgs, users). Audit on append-only storage with object lock / WORM | Simple and well understood |
| Identity | Keycloak / Entra ID for provider users; NHS login OIDC (`private_key_jwt`); CIS2 where possible | Standards-based |
| Messaging | MESH API client for Send Document | National standard |
| Security | HSM-backed KMS, a secrets vault, SIEM, WAF | Needed for DSPT and ISO 27001 evidence |
| Test | GP Connect Demonstrator / INT environment, PDS sandbox, NHS login sandpit, MESH sandbox | Build against national test environments from the first sprint |

---

## 6. Phased delivery

| Phase | Scope | Exit criteria | Indicative duration* |
|---|---|---|---|
| **0. Discovery, policy & feasibility** | Pilot proposal to NHS England built on the HSSIB findings (§2.1); feasibility of the IM1 PFS route (§2.8); legal advice on lawful basis and consent, commercial model, stakeholder engagement (BMA/RCGP, 2–3 ICBs/practices), appoint CSO/DPO/SIRO, draft DPIA and hazard log | **Go/no-go gate:** NHS England agrees a pilot for GP Connect, **or** the IM1 PFS route is confirmed viable; legal opinion; at least 1 pilot provider and pilot practices willing | 2–3 months |
| **1. Foundations** | Review the GP Connect Demonstrator for reuse; company IG framework, start DSPT, cloud landing zone, identity for provider users, **audit service built first**, CI/CD with security scanning | DSPT submitted; audit service tested | 2–3 months |
| **2. Identity & consent** | PDS FHIR integration, NHS login integration, consent service, patient portal, SMS fallback (if approved) | End-to-end consent working in the sandbox; clinical safety review of consent hazards | 2–3 months |
| **3. GP Connect Access Record: HTML** | SDS lookup, JWT construction, HTML retrieval and safe rendering (sanitised, no caching) | Passes GP Connect consumer assurance in INT; SCAL submitted | 2–3 months |
| **4. Send Document** | MESH integration, document packaging, delivery tracking and acknowledgement handling | Assurance passed | 1–2 months |
| **5. Access Record: Structured** | STU3 parsing, R4 internal mapping, provider API for structured data, medication safety handling | Assurance passed; hazard log updated for data transformation risks | 3–4 months |
| **6. Pilot (First of Type)** | 1–2 providers, a small cohort of practices, close monitoring, patient feedback | Safety case signed off; pen test remediated; FoT report accepted by NHS England | 3 months |
| **7. Scale** | Decide single supplier vs platform; provider self-service onboarding, billing, support desk, 24/7 incident response | — | ongoing |

\*These durations are rough and assume a small, experienced team. In practice, **national assurance and onboarding usually take longer than engineering**. Plan for 15–20 months to live pilot.

**Why this order:** HTML is the most widely deployed GP Connect capability, carries the least transformation risk and delivers most of the clinical value, so it comes first. Structured has the highest clinical safety burden (medications and dosage), so it comes last.

---

## 7. Team (minimum viable)
- Product owner with NHS IG experience
- Clinical Safety Officer: registered clinician, DCB0129 trained. Part-time to start
- DPO / IG lead. Can be outsourced initially
- Security lead / architect
- 3–4 engineers with FHIR and Spine integration experience
- 1 QA / test engineer
- DevOps / SRE
- Onboarding & support lead, from Phase 6

---

## 8. Key risks (summary)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| NHS England doesn't permit privately funded use | Medium | **Fatal** | Phase 0 gate; written confirmation |
| Practice / BMA opposition; practices disable GP Connect | Medium | High | Early engagement; transparent service model; patient-controlled design |
| Consent spoofing (SMS) | Medium | High | NHS login first; tight controls on SMS; audit and anomaly detection |
| Provider misuse (browsing records) | Medium | High | Episode-bound consent; RBAC; audit review; contractual sanctions |
| Data breach at middleware | Low | Severe | Pass-through design; encryption; pen testing; ISO 27001 |
| Clinical harm from rendering / mapping errors | Low–Medium | Severe | DCB0129; show HTML unaltered; keep dosage free text |
| Assurance timelines slip | High | Medium | Start onboarding in Phase 0; engage NHS England early |
| Consent is coerced ("consent or no prescription") | High | Medium | Explain to the patient that a provider may decline to treat without the record, and why. Consent is not the GDPR lawful basis (§2.3). Monitor refusal rates |
| Provider sectors under regulatory scrutiny (online GLP-1, cannabis) damage reputation | Medium | High | Onboard only CQC/GPhC-registered providers in good standing, and suspend a provider on regulator action. Publish the list of connected providers |
| Policy remains closed indefinitely | Medium | High | Pursue the IM1 PFS patient-mediated route in parallel (§2.8) |

---

## 9. Decisions and answers

| # | Question | Answer | Effect on the plan |
|---|---|---|---|
| 1 | NHS England position on private providers | Uncertain; connections not currently being granted. A recent HSSIB report supports sharing | Phase 0 becomes policy-shaping with a pilot proposal (§2.1). IM1 PFS is evaluated as a parallel route (§2.8). No production spend before agreement |
| 2 | First provider types | Direct care: private pharmacies, weight management, medical cannabis | Fixed data profiles per provider type. Send Document is mandatory for prescribers (§4.4) |
| 3 | Consent | Patient consent is required to build trust | Kept as a universal gate. NHS login first; SMS fallback with tight controls (§2.4) |
| 4 | HTML vs Structured | HTML view-only; Structured is consumed | Secure viewer for HTML. API with STU3 and R4 output, plus provider EPR assurance, for Structured (§4.5) |
| 5 | Single supplier or platform | Undecided | **Recommendation:** build API-first, with the portal as the first client. This keeps the platform option open at little extra cost. Decide at the end of the pilot |
| 6 | Reuse of the GP Connect Demonstrator | Substantial reuse is possible | Review the Demonstrator at the start of Phase 1 for JWT building, SDS lookup, STU3 parsing and test fixtures. Make it available to this project (e.g. add the repo to the session) |

### Remaining open questions
1. What is the full reference for the HSSIB report, so it can be cited in the policy proposal?
2. Is there a senior sponsor in NHS England, or an ICB, who would host a pilot?
3. Should minors, proxies and patients without NHS login be permanently out of scope for these provider types? I recommend they should be.

---

## 10. Recommended next steps
1. Hold a **Phase 0** meeting with the NHS England GP Connect / onboarding team (§2.1).
2. Get a short legal opinion on lawful basis, consent and the processor/controller split (§2.3, §2.7).
3. Appoint a CSO and a DPO. Start the hazard log and DPIA **now**; both will shape the design.
4. Register for the national sandboxes (PDS, NHS login, MESH) and the GP Connect INT environment.
5. Only after the gate: start Phase 1, beginning with the audit service.
