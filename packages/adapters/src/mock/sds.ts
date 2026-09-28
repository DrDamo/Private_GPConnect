import { PRACTICES, type SimPractice } from '@pgpc/fixtures'
import type { GpConnectEndpoint, SdsAdapter } from '../sds'

export class MockSds implements SdsAdapter {
  private readonly practices: SimPractice[]
  constructor(practices: SimPractice[] = PRACTICES) {
    this.practices = practices
  }

  async getGpConnectEndpoint(odsCode: string): Promise<GpConnectEndpoint | null> {
    const p = this.practices.find(x => x.odsCode === odsCode.toUpperCase())
    if (!p || !p.gpConnectEnabled) return null
    return {
      odsCode: p.odsCode,
      asid: p.asid,
      partyKey: `${p.odsCode}-SIM001`,
      address: `https://${p.odsCode.toLowerCase()}.gpconnect.sim.invalid/STU3/1/gpconnect/structured/fhir`,
      supplier: p.supplier,
    }
  }
}
