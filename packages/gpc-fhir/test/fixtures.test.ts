import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  extractAllergies,
  extractCodedData,
  extractConsultations,
  extractDiaryEntries,
  extractDocuments,
  extractImmunisations,
  extractInvestigations,
  extractLists,
  extractMedications,
  extractPatientInfo,
  extractProblems,
  extractReferrals,
  isValidNhsNumber,
  parseBundle,
  validateBundle,
} from '../src'

const fixturesDir = new URL('../fixtures/', import.meta.url)
const fixtureNames = readdirSync(fixturesDir).filter(f => f.endsWith('.json'))

function loadFixture(name: string): fhir3.Bundle {
  const result = parseBundle(readFileSync(new URL(name, fixturesDir), 'utf8'))
  if (!result.ok) throw new Error(`${name}: ${result.error}`)
  return result.data
}

const extractors = {
  extractAllergies,
  extractCodedData,
  extractConsultations,
  extractDiaryEntries,
  extractDocuments,
  extractImmunisations,
  extractInvestigations,
  extractLists,
  extractMedications,
  extractProblems,
  extractReferrals,
}

describe.each(fixtureNames)('fixture %s', name => {
  const bundle = loadFixture(name)

  it('parses as a Bundle with a patient whose NHS number is valid', () => {
    expect(bundle.resourceType).toBe('Bundle')
    const patient = extractPatientInfo(bundle)
    expect(patient).toBeDefined()
    expect(isValidNhsNumber(patient!.nhsNumber)).toBe(true)
  })

  it('has no validation errors', () => {
    const errors = validateBundle(bundle).issues.filter(i => i.severity === 'error')
    expect(errors).toEqual([])
  })

  it.each(Object.entries(extractors))('%s runs without throwing', (_, extract) => {
    expect(() => extract(bundle)).not.toThrow()
  })
})

describe('gpc-sample-bundle.json', () => {
  const bundle = loadFixture('gpc-sample-bundle.json')

  it('extracts the clinical areas the mock relies on', () => {
    expect(extractMedications(bundle).length).toBeGreaterThan(0)
    expect(extractAllergies(bundle).length).toBeGreaterThan(0)
    expect(extractProblems(bundle).length).toBeGreaterThan(0)
    expect(extractConsultations(bundle).length).toBeGreaterThan(0)
  })
})
