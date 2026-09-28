import { describe, expect, it } from 'vitest'
import { createServices } from '../src/services'

describe('createServices', () => {
  it('uses in-memory stores without DATABASE_URL', () => {
    expect(createServices({}).storeKind).toBe('memory')
  })

  it.each([undefined, 'too-short'])('refuses Postgres without a strong pseudonym key (%s)', key => {
    expect(() =>
      createServices({ DATABASE_URL: 'postgres://u:p@localhost:6543/postgres', AUDIT_PSEUDONYM_KEY: key }),
    ).toThrow(/AUDIT_PSEUDONYM_KEY/)
  })

  it('uses Postgres when configured (connects lazily)', async () => {
    const services = createServices({
      DATABASE_URL: 'postgres://u:p@localhost:6543/postgres',
      AUDIT_PSEUDONYM_KEY: 'x'.repeat(32),
    })
    expect(services.storeKind).toBe('postgres')
    await services.close()
  })
})
