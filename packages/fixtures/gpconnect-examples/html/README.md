# Real GP Connect examples

Request/response pairs captured from the **GP Connect Demonstrator** test
environment (`orange.testlab.nhs.uk`, version 0.7.2). They were supplied by the GP
Connect clinical lead on 29 September 2026. **All data is test data**: the test
patient (NHS number 9658218873), practice A20047 and the practitioners are
fictitious.

They are the reference the simulator and the protocol code are checked against
(`packages/adapters/test/realExamples.test.ts`). Don't edit them. Add new files
alongside them instead.

| File | Interaction | What it confirmed |
|---|---|---|
| `demonstrator-0.7.2-ALL.*` | Access Record HTML, `recordSection=ALL`: full request, response and headers | See below |
| `demonstrator-0.7.2-ALL-2.section.json` | The ALL section only (Composition.section), for a patient with no current allergies and one historical allergy | The empty-table message, and `class="date-column"` on **both** date columns of the historical table |
| `demonstrator-0.7.2-PATIENT_NOT_FOUND.response.json` | The error response (HTTP 404, OperationOutcome) | The error shape and codes. **The GP Connect team confirmed the same response is returned when the patient has dissented to sharing**, so a consumer can't, and mustn't try to, tell the two apart |

What the ALL example confirmed:

- The JWT `aud` is the fixed `https://authorize.fhir.nhs.net/token`, not the request URL.
- The JWT resources are DSTU2-shaped: `requesting_practitioner.name` is a single HumanName with array `family`, plus `practitionerRole`.
- `sub` equals `requesting_practitioner.id`.
- The response is FHIR **DSTU2** (1.0.2) (`x-powered-by: HAPI FHIR 2.2 … FHIR 1.0.2/DSTU2`), not STU3.
- The Composition shape, with `fullUrl` entries for Practitioner, Organization and Patient.
- The section HTML: table ids (`all-tab-curr`, `all-tab-hist`) and `class="date-column"` on date cells.

Response headers noted at capture: `content-type: application/json+fhir;charset=UTF-8`
and `x-powered-by: HAPI FHIR 2.2 REST Server (FHIR Server; FHIR 1.0.2/DSTU2)`.
