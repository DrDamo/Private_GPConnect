# Demo script

A walkthrough for stakeholders, in about 20 minutes. **Everything is simulated**: no NHS
service is called, and every patient, practice and provider is synthetic.

Tips for running it:
- Use two browser windows side by side, one for the **provider** and one for the
  **patient**, or a private window for the patient. Each role has its own sign-in cookie.
- The header links go to every view: Provider, Patient, Phone (the patient's simulated
  handset), GP inbox (the practice) and Admin.
- *Test patients* lists all 15 synthetic patients and the scenario each one covers.
- The hosted demo keeps its data between sessions, and fault injection affects everyone
  using it. **Set every fault back to Normal when you finish.**

## 1. The happy path: consent by NHS login (5 min)

**Story:** a pharmacy needs to check an older patient's medicines and allergies before
supplying a medicine.

1. **Provider:** go to *Provider* and sign in as **Priya Desai (Pharmacist)**, Northern
   Online Pharmacy.
   - Search NHS number **999 000 0050** (Margaret Evans, who takes warfarin and is
     allergic to penicillin).
   - Point out that PDS returns identity details only. No clinical data is available
     before consent.
2. Under *Why do you need to see their record?* enter a plain reason, for example
   "Check for interactions before supplying hay fever medication", then choose **Ask the
   patient for consent**.
   - The request is texted to the mobile number held on **PDS**, not one the provider types in.
   - The text doesn't name the provider.
3. **Patient:** open *Phone*, choose Margaret, and follow the link. Nothing identifying is
   shown until she signs in.
   - Choose **Sign in with NHS login**, then pick Margaret, who is verified to P9.
4. The consent page shows:
   - who is asking and why
   - exactly which parts of the record they will see, and for how long
   - the full, versioned wording
   - that a choice not to share, made at the GP practice, still applies

   Choose **I agree**.
5. **Provider:** open the record.
   - **View record:** the GP Connect Access Record HTML sections, rendered in a sandbox
     with a viewer watermark.
   - **Structured data:** the medicines and allergies as FHIR STU3, limited to the
     consented areas.
   - The request inspector shows what was sent to the GP system, including the Spine
     headers and the JWT.
6. **Patient:** go back to *Patient*. The access log says in plain English who looked at
   what, and when.
   - Point out **Withdraw consent**, which takes effect immediately.

## 2. Consent by text message code, and why it gives less (3 min)

1. As the provider, request consent for **999 000 0018** (Sarah Thompson).
2. On the *Phone*, follow the link. Under **Use a text message code instead**, choose
   **Text me a code**, then enter the code from the new text and her date of birth
   (12 March 1984, shown on *Test patients*).
3. Point out that the consent is limited:
   - it lasts at most **30 days** (NHS login allows up to 180)
   - it allows **viewing and notifying the GP only**

   As the provider, there is no *Structured data* tab, and the API refuses a direct call
   for structured data. A text-message code is weaker evidence of identity than NHS login,
   so it cannot authorise copying data into another system.

## 3. Telling the GP what was done: Send Document (3 min)

1. On an active consent, open **Send to GP**. Record a medicine supplied, with its dosage
   exactly as written, then choose **Send to GP practice**.
2. Open the **GP inbox**. The practice reads the document and chooses **File in patient
   record**.
3. **Provider:** choose **Refresh status**. The provider now sees *Filed by the practice*.
4. Point out that the middleware passes the document through without keeping a copy. The
   audit trail records only the MESH message id.

## 4. Refusals: the service says no safely (4 min)

Search for each of these as the provider. The first three are refused at search; the rest need the patient step too:

| NHS number | Patient | What happens |
|---|---|---|
| 999 000 0069 | Restricted (S-flag) record | PDS withholds the details. The provider sees only the NHS number and cannot ask for consent |
| 999 000 0077 | Harold Price, deceased | Refused |
| 999 000 0085 | Ella Hughes, aged 14 | Refused: under-16s are out of scope for now |
| 999 000 0131 | Kwame Mensah | Consent can be requested, but when he signs in, his NHS login is verified only to P5 and is refused. He can still use a text message code, which gives the limited consent |
| 999 000 0182 | Owen Clarke | Consent works, but GP Connect returns *patient not found*: he has opted out at his practice |
| 999 000 0174 | Nadia Rahman | Also *patient not found*: her new practice doesn't hold her record yet |

For the last two, point out that:
- the provider gets **exactly the same** response in both cases, so the service never
  reveals that a patient has opted out
- the message warns that "nothing returned" does not mean "no allergies"

## 5. Oversight: the admin console (4 min)

1. Open *Admin* and sign in as **Alex Reed (IG auditor)**.
2. **Overview:** consents by status, recent record accesses, refusals and failures. Choose
   **Verify the chain now**: every audit event is hash-chained, so any edit, deletion or
   reordering would be detected.
3. **Audit trail:** filter by event type or outcome.
   - Search by NHS number **999 000 0050**. The log stores only a keyed pseudonym, never
     the NHS number.
   - Back in Margaret's patient view, her access log now says staff reviewed the log of
     access to her record. **Watching the watchers is visible to the patient.**
4. **Consent register:** every consent, with NHS numbers masked.
5. **Fault injection:** the auditor can't change anything, because the roles are least
   privilege.
   - Sign out and sign in as **Sam Patel (service operator)**.
   - Set **GP Connect** to *Unavailable*, then reopen a record as the provider. The
     provider gets a clear "not available, try again later" message, and the failure is
     audited.
   - Try *Slow (3s)* on PDS as well.
6. **Set every fault back to Normal.**

## Questions to expect

- **"Is this real NHS data?"** No. The data is synthetic, the NHS numbers are in the 999
  test range, and the mobile numbers are in the drama range.
- **"How would this connect for real?"** Each simulator sits behind the same interface a
  real client would implement: PDS FHIR, SDS, NHS login OIDC, GP Connect HTML 0.7 and
  Structured 1.x, and MESH. See `docs/MOCKUP_PLAN.md` §3.2.
- **"What's still unverified?"** See *Still to verify* in `docs/MOCKUP_PLAN.md` §7: the
  Send Document format and workflow id, the Structured 1.x JWT and parameters, and some
  error codes.
