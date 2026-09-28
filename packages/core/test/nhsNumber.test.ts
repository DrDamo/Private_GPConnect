import { describe, expect, it } from 'vitest'
import { isValidNhsNumber, normaliseNhsNumber } from '../src'

describe('isValidNhsNumber', () => {
  it.each(['9692136701', '9000000009', '9990000018'])('accepts %s', n => expect(isValidNhsNumber(n)).toBe(true))
  it.each(['9692136702', '969 213 6701', '123', '', null, undefined, 'abcdefghij', '1000000010'])('rejects %s', n =>
    expect(isValidNhsNumber(n)).toBe(false),
  )
  it('normalises spaces', () => expect(normaliseNhsNumber('969 213 6701')).toBe('9692136701'))
})
