import { describe, expect, it } from 'vitest'
import {
  buildBundle,
  createFullSampleDraft,
  createSampleDraft,
  extractAllergies,
  extractMedications,
  extractPatientInfo,
  extractProblems,
  isValidNhsNumber,
  validateBundle,
} from '../src'

// The mock's GP Connect Structured simulator will generate records with the
// Demonstrator's builder, so its output must round-trip through our own
// parser/extractors cleanly.
describe.each([
  ['sample draft', createSampleDraft],
  ['full sample draft', createFullSampleDraft],
])('builder: %s', (_, createDraft) => {
  const draft = createDraft()
  const bundle = buildBundle(draft)

  it('produces a GP Connect Bundle with no validation errors', () => {
    expect(bundle.resourceType).toBe('Bundle')
    const errors = validateBundle(bundle).issues.filter(i => i.severity === 'error')
    expect(errors).toEqual([])
  })

  it('round-trips the patient', () => {
    const patient = extractPatientInfo(bundle)
    expect(patient).toBeDefined()
    expect(isValidNhsNumber(patient!.nhsNumber)).toBe(true)
  })

  it('round-trips non-confidential problems and medications', () => {
    const visible = <T extends { confidential?: boolean }>(items: T[]) =>
      items.filter(i => !i.confidential).length
    expect(extractProblems(bundle)).toHaveLength(visible(draft.problems))
    expect(extractMedications(bundle)).toHaveLength(visible(draft.medications))
  })

  it('extracts allergies without throwing', () => {
    expect(() => extractAllergies(bundle)).not.toThrow()
  })
})
