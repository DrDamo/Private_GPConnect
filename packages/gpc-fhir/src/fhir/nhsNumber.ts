// NHS Number Modulus 11 check digit — https://www.datadictionary.nhs.uk/attributes/nhs_number.html
const CHECK_DIGIT_WEIGHTS = [10, 9, 8, 7, 6, 5, 4, 3, 2]

/**
 * Computes the Modulus 11 check digit for the first 9 digits of an NHS Number.
 * Returns null if the digits are not a 9-digit string, or if the algorithm
 * yields a remainder of 10 (the Data Dictionary defines this combination as invalid).
 */
export function nhsNumberCheckDigit(firstNineDigits: string): number | null {
  if (!/^\d{9}$/.test(firstNineDigits)) return null
  const sum = firstNineDigits
    .split('')
    .reduce((total, digit, i) => total + Number(digit) * CHECK_DIGIT_WEIGHTS[i], 0)
  let checkDigit = 11 - (sum % 11)
  if (checkDigit === 11) checkDigit = 0
  if (checkDigit === 10) return null
  return checkDigit
}

/** Validates a 10-digit NHS Number's format and Modulus 11 check digit. */
export function isValidNhsNumber(value: string | undefined | null): boolean {
  if (!value) return false
  const digits = value.replace(/\s/g, '')
  if (!/^\d{10}$/.test(digits)) return false
  const checkDigit = nhsNumberCheckDigit(digits.slice(0, 9))
  return checkDigit !== null && checkDigit === Number(digits[9])
}
