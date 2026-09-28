import type { ProviderType, UserRole } from '@pgpc/core'

// Synthetic private providers and their staff. Registration numbers are
// deliberately invalid formats so nothing can be mistaken for a real clinician.

export interface SimProviderOrg {
  odsCode: string
  name: string
  type: ProviderType
  active: boolean
  regulator: 'CQC' | 'GPhC'
}

export interface SimProviderUser {
  userId: string
  name: string
  role: UserRole
  organisationOdsCode: string
  active: boolean
  professionalRegistration?: string
}

export const PROVIDER_ORGS: SimProviderOrg[] = [
  { odsCode: 'SIMPH1', name: 'Northern Online Pharmacy (simulated)', type: 'pharmacy', active: true, regulator: 'GPhC' },
  { odsCode: 'SIMWM1', name: 'Balance Weight Clinic (simulated)', type: 'weight-management', active: true, regulator: 'CQC' },
  { odsCode: 'SIMMC1', name: 'Meridian Cannabis Clinic (simulated)', type: 'medical-cannabis', active: true, regulator: 'CQC' },
  { odsCode: 'SIMPH9', name: 'Suspended Pharmacy Ltd (simulated)', type: 'pharmacy', active: false, regulator: 'GPhC' },
]

export const PROVIDER_USERS: SimProviderUser[] = [
  { userId: 'sim-user-ph-pharm', name: 'Priya Desai (Pharmacist)', role: 'clinician', organisationOdsCode: 'SIMPH1', active: true, professionalRegistration: 'SIM-GPhC-0001' },
  { userId: 'sim-user-ph-admin', name: 'Tom Barker (Practice manager)', role: 'provider-admin', organisationOdsCode: 'SIMPH1', active: true },
  { userId: 'sim-user-wm-doc', name: 'Dr Helen Carter', role: 'clinician', organisationOdsCode: 'SIMWM1', active: true, professionalRegistration: 'SIM-GMC-0002' },
  { userId: 'sim-user-wm-left', name: 'Dr Mark Lowe (left organisation)', role: 'clinician', organisationOdsCode: 'SIMWM1', active: false, professionalRegistration: 'SIM-GMC-0003' },
  { userId: 'sim-user-mc-doc', name: 'Dr Samuel Adeyemi', role: 'clinician', organisationOdsCode: 'SIMMC1', active: true, professionalRegistration: 'SIM-GMC-0004' },
  { userId: 'sim-user-ph9-pharm', name: 'Nina Clarke (Pharmacist)', role: 'clinician', organisationOdsCode: 'SIMPH9', active: true, professionalRegistration: 'SIM-GPhC-0005' },
]

export const providerOrgByOds = (odsCode: string) => PROVIDER_ORGS.find(o => o.odsCode === odsCode)
export const providerUserById = (userId: string) => PROVIDER_USERS.find(u => u.userId === userId)
