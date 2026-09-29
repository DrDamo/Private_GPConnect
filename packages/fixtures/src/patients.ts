// Synthetic patients. Everything here is invented:
// - NHS numbers are in the 999 range with valid Modulus 11 check digits.
// - Mobile numbers are in Ofcom's reserved drama range (07700 900000–900999).
// - Addresses are fictional streets.
// Each patient exists to exercise a scenario; `scenario` says which.

export type Gender = 'female' | 'male' | 'other' | 'unknown'

/** Which synthetic GP record the Structured/HTML simulators return (step 5–6). */
export type RecordProfile = 'standard' | 'weight-management' | 'cannabis' | 'polypharmacy' | 'confidential-items' | 'minimal'

export interface SimPatient {
  nhsNumber: string
  name: { prefix?: string; given: string[]; family: string }
  gender: Gender
  birthDate: string
  deceasedDateTime?: string
  /** PDS confidentiality: R = restricted (S-flag), address/GP/telecom withheld. */
  confidentiality: 'U' | 'R'
  address?: { line: string[]; city: string; postalCode: string }
  mobile?: string
  gpOdsCode: string
  gpRegisteredSince: string
  /** Patient has an NHS login account, and at what identity level. */
  nhsLogin?: { sub: string; identityProofingLevel: 'P9' | 'P5' }
  recordProfile: RecordProfile
  /**
   * Whether the practice's GP system will return the record over GP Connect
   * (default 'held'). 'not-held': the record isn't there (yet). 'dissent': the
   * patient has asked the practice not to share it. GP Connect returns the same
   * PATIENT_NOT_FOUND (404) for both, deliberately, so a consumer can't tell
   * which, and nor should this service.
   */
  gpRecordAtPractice?: 'held' | 'not-held' | 'dissent'
  scenario: string
  tags: string[]
}

export const PATIENTS: SimPatient[] = [
  {
    nhsNumber: '9990000018',
    name: { prefix: 'Mrs', given: ['Sarah', 'Jane'], family: 'Thompson' },
    gender: 'female',
    birthDate: '1984-03-12',
    confidentiality: 'U',
    address: { line: ['14 Simulation Street'], city: 'Leeds', postalCode: 'LS6 1AA' },
    mobile: '07700900001',
    gpOdsCode: 'SIMGP1',
    gpRegisteredSince: '2015-06-01',
    nhsLogin: { sub: 'sim-nhslogin-0001', identityProofingLevel: 'P9' },
    recordProfile: 'standard',
    scenario: 'Straightforward adult at an EMIS practice. The happy path for any provider.',
    tags: ['happy-path', 'emis'],
  },
  {
    nhsNumber: '9990000026',
    name: { prefix: 'Mr', given: ['James'], family: 'Okafor' },
    gender: 'male',
    birthDate: '1979-11-02',
    confidentiality: 'U',
    address: { line: ['3 Example Avenue'], city: 'Bristol', postalCode: 'BS1 2AB' },
    mobile: '07700900002',
    gpOdsCode: 'SIMGP2',
    gpRegisteredSince: '2011-01-20',
    nhsLogin: { sub: 'sim-nhslogin-0002', identityProofingLevel: 'P9' },
    recordProfile: 'standard',
    scenario: 'Straightforward adult at a TPP practice, to show supplier differences.',
    tags: ['happy-path', 'tpp'],
  },
  {
    nhsNumber: '9990000034',
    name: { prefix: 'Ms', given: ['Priya'], family: 'Sharma' },
    gender: 'female',
    birthDate: '1990-07-25',
    confidentiality: 'U',
    address: { line: ['27 Sample Road'], city: 'Leeds', postalCode: 'LS7 3CD' },
    mobile: '07700900003',
    gpOdsCode: 'SIMGP1',
    gpRegisteredSince: '2019-09-15',
    nhsLogin: { sub: 'sim-nhslogin-0003', identityProofingLevel: 'P9' },
    recordProfile: 'weight-management',
    scenario: 'Weight management candidate: raised BMI, type 2 diabetes, and a past eating disorder the prescriber must see.',
    tags: ['weight-management', 'safety-relevant'],
  },
  {
    nhsNumber: '9990000042',
    name: { prefix: 'Mr', given: ['Liam'], family: 'Walsh' },
    gender: 'male',
    birthDate: '1988-01-30',
    confidentiality: 'U',
    address: { line: ['8 Placeholder Close'], city: 'Norwich', postalCode: 'NR2 4EF' },
    mobile: '07700900004',
    gpOdsCode: 'SIMGP3',
    gpRegisteredSince: '2016-04-11',
    nhsLogin: { sub: 'sim-nhslogin-0004', identityProofingLevel: 'P9' },
    recordProfile: 'cannabis',
    scenario: 'Medical cannabis candidate: chronic pain, with a history of drug-induced psychosis relevant to prescribing.',
    tags: ['medical-cannabis', 'safety-relevant'],
  },
  {
    nhsNumber: '9990000050',
    name: { prefix: 'Mrs', given: ['Margaret'], family: 'Evans' },
    gender: 'female',
    birthDate: '1950-05-09',
    confidentiality: 'U',
    address: { line: ['2 Test Terrace'], city: 'Bristol', postalCode: 'BS3 5GH' },
    mobile: '07700900005',
    gpOdsCode: 'SIMGP2',
    gpRegisteredSince: '1998-02-03',
    nhsLogin: { sub: 'sim-nhslogin-0005', identityProofingLevel: 'P9' },
    recordProfile: 'polypharmacy',
    scenario: 'Older patient on warfarin with a penicillin allergy: a pharmacy interaction check.',
    tags: ['pharmacy', 'safety-relevant', 'polypharmacy'],
  },
  {
    nhsNumber: '9990000069',
    name: { given: ['Alex'], family: 'Morgan' },
    gender: 'other',
    birthDate: '1993-12-14',
    confidentiality: 'R',
    gpOdsCode: 'SIMGP1',
    gpRegisteredSince: '2020-03-01',
    nhsLogin: { sub: 'sim-nhslogin-0006', identityProofingLevel: 'P9' },
    recordProfile: 'standard',
    scenario: 'Restricted (S-flag) record: PDS withholds address, contact and GP details, and access must be refused.',
    tags: ['restricted', 'must-deny'],
  },
  {
    nhsNumber: '9990000077',
    name: { prefix: 'Mr', given: ['Harold'], family: 'Price' },
    gender: 'male',
    birthDate: '1941-08-19',
    deceasedDateTime: '2026-08-02T10:15:00+01:00',
    confidentiality: 'U',
    address: { line: ['11 Fictional Grove'], city: 'Norwich', postalCode: 'NR5 6JK' },
    gpOdsCode: 'SIMGP3',
    gpRegisteredSince: '1990-10-10',
    recordProfile: 'minimal',
    scenario: 'Deceased patient: access must be refused.',
    tags: ['deceased', 'must-deny'],
  },
  {
    nhsNumber: '9990000085',
    name: { given: ['Ella'], family: 'Hughes' },
    gender: 'female',
    birthDate: '2012-02-17',
    confidentiality: 'U',
    address: { line: ['40 Mock Lane'], city: 'Leeds', postalCode: 'LS8 7LM' },
    mobile: '07700900008',
    gpOdsCode: 'SIMGP1',
    gpRegisteredSince: '2012-03-01',
    recordProfile: 'minimal',
    scenario: 'Aged 14: under-16s are out of scope for the MVP, so access must be refused.',
    tags: ['under-16', 'must-deny'],
  },
  {
    nhsNumber: '9990000093',
    name: { prefix: 'Mr', given: ['Tomasz'], family: 'Nowak' },
    gender: 'male',
    birthDate: '1975-06-06',
    confidentiality: 'U',
    address: { line: ['6 Demo Street'], city: 'Birmingham', postalCode: 'B15 2NP' },
    gpOdsCode: 'SIMGP3',
    gpRegisteredSince: '2008-07-07',
    recordProfile: 'standard',
    scenario: 'No mobile number on PDS and no NHS login account: consent can only be given by other means.',
    tags: ['no-mobile', 'no-nhs-login'],
  },
  {
    nhsNumber: '9990000107',
    name: { prefix: 'Ms', given: ['Grace'], family: 'Adeyemi' },
    gender: 'female',
    birthDate: '1982-10-21',
    confidentiality: 'U',
    address: { line: ['19 Canal View'], city: 'Birmingham', postalCode: 'B1 1QR' },
    mobile: '07700900010',
    gpOdsCode: 'SIMGP4',
    gpRegisteredSince: '2014-05-05',
    nhsLogin: { sub: 'sim-nhslogin-0010', identityProofingLevel: 'P9' },
    recordProfile: 'standard',
    scenario: 'Registered at a practice without GP Connect: consent works but the record cannot be retrieved.',
    tags: ['gp-connect-disabled'],
  },
  {
    nhsNumber: '9990000115',
    name: { prefix: 'Mr', given: ['Daniel'], family: 'Reid' },
    gender: 'male',
    birthDate: '1996-04-03',
    confidentiality: 'U',
    address: { line: ['55 Relocation Road'], city: 'Bristol', postalCode: 'BS6 8ST' },
    mobile: '07700900011',
    gpOdsCode: 'SIMGP2',
    gpRegisteredSince: '2026-09-23',
    nhsLogin: { sub: 'sim-nhslogin-0011', identityProofingLevel: 'P9' },
    recordProfile: 'minimal',
    scenario: 'Changed GP five days ago: the new practice may hold little history yet.',
    tags: ['recent-registration'],
  },
  {
    nhsNumber: '9990000123',
    name: { prefix: 'Ms', given: ['Chloe'], family: 'Bennett' },
    gender: 'female',
    birthDate: '1987-09-09',
    confidentiality: 'U',
    address: { line: ['31 Privacy Place'], city: 'Leeds', postalCode: 'LS2 9UV' },
    mobile: '07700900012',
    gpOdsCode: 'SIMGP1',
    gpRegisteredSince: '2010-01-15',
    nhsLogin: { sub: 'sim-nhslogin-0012', identityProofingLevel: 'P9' },
    recordProfile: 'confidential-items',
    scenario: 'Record contains confidential items that GP Connect withholds, so a "some items withheld" warning should show.',
    tags: ['confidential-items'],
  },
  {
    nhsNumber: '9990000131',
    name: { prefix: 'Mr', given: ['Kwame'], family: 'Mensah' },
    gender: 'male',
    birthDate: '1970-12-01',
    confidentiality: 'U',
    address: { line: ['4 Verify Way'], city: 'Norwich', postalCode: 'NR1 3WX' },
    mobile: '07700900013',
    gpOdsCode: 'SIMGP3',
    gpRegisteredSince: '2003-03-03',
    nhsLogin: { sub: 'sim-nhslogin-0013', identityProofingLevel: 'P5' },
    recordProfile: 'standard',
    scenario: 'Has an NHS login account that is only verified to P5, which is not enough to give consent.',
    tags: ['nhs-login-p5'],
  },
  {
    nhsNumber: '9990000174',
    name: { prefix: 'Ms', given: ['Nadia'], family: 'Rahman' },
    gender: 'female',
    birthDate: '1992-11-30',
    confidentiality: 'U',
    address: { line: ['7 Transfer Terrace'], city: 'Norwich', postalCode: 'NR3 2DE' },
    mobile: '07700900016',
    gpOdsCode: 'SIMGP3',
    gpRegisteredSince: '2026-09-27',
    nhsLogin: { sub: 'sim-nhslogin-0016', identityProofingLevel: 'P9' },
    recordProfile: 'minimal',
    gpRecordAtPractice: 'not-held',
    scenario:
      "PDS shows a new practice, but that practice's GP system doesn't hold her record yet: GP Connect returns PATIENT_NOT_FOUND (404).",
    tags: ['gp-record-not-found'],
  },
  {
    nhsNumber: '9990000182',
    name: { prefix: 'Mr', given: ['Owen'], family: 'Clarke' },
    gender: 'male',
    birthDate: '1978-04-18',
    confidentiality: 'U',
    address: { line: ['15 Choice Crescent'], city: 'Leeds', postalCode: 'LS4 2FG' },
    mobile: '07700900017',
    gpOdsCode: 'SIMGP1',
    gpRegisteredSince: '2011-08-08',
    nhsLogin: { sub: 'sim-nhslogin-0017', identityProofingLevel: 'P9' },
    recordProfile: 'standard',
    gpRecordAtPractice: 'dissent',
    scenario:
      'Has told his GP practice not to share his record. He can still consent here, but the practice\'s choice wins: GP Connect returns PATIENT_NOT_FOUND, exactly as when no record is held.',
    tags: ['gp-sharing-dissent', 'gp-record-not-found'],
  },
  {
    nhsNumber: '9990000158',
    name: { prefix: 'Mr', given: ['John'], family: 'Smith' },
    gender: 'male',
    birthDate: '1985-02-14',
    confidentiality: 'U',
    address: { line: ['12 Common Street'], city: 'Leeds', postalCode: 'LS9 0YZ' },
    mobile: '07700900014',
    gpOdsCode: 'SIMGP1',
    gpRegisteredSince: '2012-12-12',
    nhsLogin: { sub: 'sim-nhslogin-0014', identityProofingLevel: 'P9' },
    recordProfile: 'standard',
    scenario: 'Shares name and date of birth with another patient, so a demographic search is ambiguous; add the postcode.',
    tags: ['ambiguous-search'],
  },
  {
    nhsNumber: '9990000166',
    name: { prefix: 'Mr', given: ['John'], family: 'Smith' },
    gender: 'male',
    birthDate: '1985-02-14',
    confidentiality: 'U',
    address: { line: ['98 Other Street'], city: 'Bristol', postalCode: 'BS4 1AB' },
    mobile: '07700900015',
    gpOdsCode: 'SIMGP2',
    gpRegisteredSince: '2009-09-09',
    recordProfile: 'standard',
    scenario: 'The other John Smith (see above).',
    tags: ['ambiguous-search'],
  },
]

export const patientByNhsNumber = (nhsNumber: string) => PATIENTS.find(p => p.nhsNumber === nhsNumber)
