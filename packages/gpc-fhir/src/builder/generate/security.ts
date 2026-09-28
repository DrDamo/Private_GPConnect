// ---------------------------------------------------------------------------
// Confidentiality / PFS handling — shared by every domain generator.
//
// "Confidential" items are excluded from generated output entirely (the
// domain's List gets a `confidential-items` warning instead — see lists.ts).
// "Not for PFS" items are output as normal but carry a NOPAT security label
// so patient-facing services know to withhold them.
// ---------------------------------------------------------------------------

// https://simplifier.net/guide/gpconnect-data-model/Home/Build/FHIR-resources — "Resources not to be disclosed to a patient"
export const NOPAT_SECURITY_CODING: fhir3.Coding = {
  system: 'http://hl7.org/fhir/v3/ActCode',
  code: 'NOPAT',
  display: "no disclosure to patient, family or caregivers without attending provider's authorization",
}

/** Excludes confidential items from generated output. */
export function excludeConfidential<T extends { confidential?: boolean }>(items: T[]): T[] {
  return items.filter(item => !item.confidential)
}

/** Spread into a resource literal to attach the NOPAT security label when the item is marked "not for PFS". */
export function nopatMeta(notForPfs: boolean | undefined): { meta?: fhir3.Meta } {
  return notForPfs ? { meta: { security: [NOPAT_SECURITY_CODING] } } : {}
}
