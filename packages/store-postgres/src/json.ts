/**
 * Values for jsonb columns. Parameters are cast `$n::text::jsonb` so every
 * driver sends plain text: postgres.js JSON-encodes anything bound to a jsonb
 * parameter, so passing a pre-serialised string there stored a JSON *string*.
 * Rows written that way (before 30 Sep 2026) are decoded on read.
 */
export function fromJsonb<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T
}
