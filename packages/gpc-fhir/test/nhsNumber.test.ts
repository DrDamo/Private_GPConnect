import { describe, expect, it } from 'vitest'
import { isValidNhsNumber, nhsNumberCheckDigit } from '../src'

describe('NHS number validation', () => {
  it.each(['9692136701', '9000000009'])('accepts valid number %s', n => {
    expect(isValidNhsNumber(n)).toBe(true)
  })

  it.each(['9692136702', '123', '', null, undefined, 'abcdefghij'])('rejects %s', n => {
    expect(isValidNhsNumber(n)).toBe(false)
  })

  it('computes the modulus 11 check digit', () => {
    expect(nhsNumberCheckDigit('969213670')).toBe(1)
  })
})
