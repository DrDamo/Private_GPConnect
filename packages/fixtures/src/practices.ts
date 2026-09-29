// Synthetic GP practices. ODS codes use a SIM prefix so they can never collide
// with real organisations; endpoints use the reserved .invalid TLD.

export type GpSupplier = 'EMIS' | 'TPP'

export interface SimPractice {
  odsCode: string
  name: string
  supplier: GpSupplier
  /** Practice has GP Connect switched on (SDS returns an endpoint). */
  gpConnectEnabled: boolean
  /** Practice accepts GP Connect Send Document over MESH. */
  acceptsSendDocument: boolean
  asid: string
  address: string
}

export const PRACTICES: SimPractice[] = [
  { odsCode: 'SIMGP1', acceptsSendDocument: true, name: 'Riverside Medical Practice (simulated)', supplier: 'EMIS', gpConnectEnabled: true, asid: '900000000101', address: '1 River Road, Leeds' },
  { odsCode: 'SIMGP2', acceptsSendDocument: true, name: 'Hillview Surgery (simulated)', supplier: 'TPP', gpConnectEnabled: true, asid: '900000000102', address: '22 Hill Street, Bristol' },
  { odsCode: 'SIMGP3', acceptsSendDocument: true, name: 'Market Square Health Centre (simulated)', supplier: 'EMIS', gpConnectEnabled: true, asid: '900000000103', address: '5 Market Square, Norwich' },
  { odsCode: 'SIMGP4', acceptsSendDocument: false, name: 'Canal Side Practice (simulated)', supplier: 'TPP', gpConnectEnabled: false, asid: '900000000104', address: '9 Wharf Lane, Birmingham' },
]

export const practiceByOds = (odsCode: string) => PRACTICES.find(p => p.odsCode === odsCode)

/** This middleware's own identity on the (simulated) Spine. */
export const MIDDLEWARE = {
  asid: '900000000999',
  meshMailbox: 'SIMMW1OT001',
  odsCode: 'SIMMW1',
  name: 'Private GP Connect middleware (simulated)',
} as const

/** Simulated MESH mailbox id for a practice. */
export const meshMailboxFor = (odsCode: string) => `${odsCode.toUpperCase()}OT001`
