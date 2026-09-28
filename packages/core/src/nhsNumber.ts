// NHS Number format + Modulus 11 check digit
// (https://www.datadictionary.nhs.uk/attributes/nhs_number.html).
// gpc-fhir has an equivalent copied from the Demonstrator; core keeps its own so
// it stays free of that package's dependencies.

const WEIGHTS = [10, 9, 8, 7, 6, 5, 4, 3, 2]

export function isValidNhsNumber(value: string | null | undefined): boolean {
  if (!value || !/^\d{10}$/.test(value)) return false
  const sum = WEIGHTS.reduce((total, w, i) => total + w * Number(value[i]), 0)
  const check = (11 - (sum % 11)) % 11
  return check !== 10 && check === Number(value[9])
}

/** Removes spaces, so "999 000 0018" and "9990000018" compare equal. */
export const normaliseNhsNumber = (value: string) => value.replace(/\s/g, '')
