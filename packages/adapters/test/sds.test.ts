import { describe, expect, it } from 'vitest'
import { MockSds } from '../src'

describe('MockSds', () => {
  const sds = new MockSds()

  it('returns the endpoint for an enabled practice', async () => {
    expect(await sds.getGpConnectEndpoint('simgp2')).toMatchObject({ odsCode: 'SIMGP2', supplier: 'TPP', asid: '900000000102' })
  })

  it('never points at a resolvable host', async () => {
    const e = await sds.getGpConnectEndpoint('SIMGP1')
    expect(new URL(e!.address).hostname.endsWith('.invalid')).toBe(true)
  })

  it.each(['SIMGP4', 'NOPE01'])('returns null for %s (not enabled / unknown)', async ods => {
    expect(await sds.getGpConnectEndpoint(ods)).toBeNull()
  })
})
