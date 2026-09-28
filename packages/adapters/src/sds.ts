// Spine Directory Service: find a practice's GP Connect endpoint.
// Ref: https://digital.nhs.uk/developer/api-catalogue/spine-directory-service-fhir

export interface GpConnectEndpoint {
  odsCode: string
  asid: string
  partyKey: string
  address: string
  supplier: 'EMIS' | 'TPP' | 'OTHER'
}

export interface SdsAdapter {
  /** Returns null when the practice has no GP Connect endpoint (not enabled). */
  getGpConnectEndpoint(odsCode: string): Promise<GpConnectEndpoint | null>
}
