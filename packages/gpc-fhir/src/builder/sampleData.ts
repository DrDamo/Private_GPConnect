import type {
  DraftRecord,
  DraftPatient,
  DraftPractitioner,
  DraftOrganisation,
  DraftContact,
} from './types'
import { nhsNumberCheckDigit } from '../fhir/nhsNumber'

// ---------------------------------------------------------------------------
// Randomisation helpers
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomItem<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length - 1)]
}

/** Pick `count` distinct items from a list without replacement. */
function randomDistinct<T>(items: readonly T[], count: number): T[] {
  const pool = [...items]
  const picked: T[] = []
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = randomInt(0, pool.length - 1)
    picked.push(pool[idx])
    pool.splice(idx, 1)
  }
  return picked
}

function randomDigits(length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += randomInt(0, 9)
  return out
}

function randomLetter(): string {
  return String.fromCharCode(randomInt(65, 90))
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function randomDateString(startYear: number, endYear: number): string {
  const year = randomInt(startYear, endYear)
  const month = randomInt(1, 12)
  const day = randomInt(1, 28) // avoid month-length edge cases
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/** Generates a syntactically valid NHS number in the reserved 999 test range. */
function generateNhsNumber(): string {
  for (;;) {
    const firstNine = [9, 9, 9, ...Array.from({ length: 6 }, () => randomInt(0, 9))].join('')
    const check = nhsNumberCheckDigit(firstNine)
    if (check === null) continue // invalid combination — retry
    return firstNine + check
  }
}

// ---------------------------------------------------------------------------
// Name pools
// ---------------------------------------------------------------------------

const MALE_FIRST_NAMES = [
  'David', 'Peter', 'John', 'Michael', 'Brian', 'Gerald', 'Lester', 'Otis',
  'Naaif', 'Maitland', 'Westley', 'Norbert', 'Brent', 'Micah', 'Jordan',
  'Raymund', 'Loren', 'Haywood', 'Garth', 'Roy', 'George', 'Daniel', 'Simon',
  'Martin', 'Eamon', 'Shiraz', 'Andrew', 'Barney', 'Tom', 'Steven', 'Jamal',
  'Masood', 'Jason', 'Dominic', 'Animesh', 'Philip', 'Damian', 'Charlie',
  'Robert', 'James',
] as const

const FEMALE_FIRST_NAMES = [
  'Jane', 'Nichole', 'Catherine', 'Anneka', 'Melissa', 'Gemma', 'Heidi',
  'Elaine', 'Clare', 'Rachel', 'Alice', 'Pippa', 'Hannah', 'Aishah',
  'Alyssia', 'Sana', 'Emma', 'Agnieszka', 'Faith', 'Gwenda', 'Pollie',
  'Amanjeet', 'Eileen', 'Barbara', 'Sarah', 'Sophia', 'Gina', 'Susan',
  'Alexi', 'Keeley', 'Sherri', 'Quianna', 'Cammie', 'Raphaela', 'Amie',
  'Lizzy', 'Shantel', 'Louise', 'Zoe', 'Lindsey',
] as const

const SURNAMES = [
  'Jackson', 'Lindon', 'Steinberg', 'Job', 'Egan', 'McGinn', 'Sutton',
  'Belle', 'Crank', 'Iizuka', 'Hage', 'Barlas', 'Nagra', 'Noonan',
  'Brennan', 'Miehm', 'Thompson', 'Meakin', 'Adams', 'Wookey', 'Grace',
  'Horn', 'Skelly', 'Reardon', 'Kay', 'Edwardson', 'Smith', 'Thrush',
  'Bristol', 'Phillpotts', 'Mulvihill', 'Gard', 'Hulme', 'Kilgallon',
  'Elsner', 'Perola', 'Marriner', 'McMunn', 'Munyaradzi', 'Middlebrook',
  'Longthorpe', 'Gunawardana', 'Hallinan', 'Mahmood', 'Elgie', 'Guerra',
  'Porteous', 'McAvenue', 'Gilbert', 'Whitcombe', 'Stables', 'Norman',
  'Clarson', 'Waters', 'Potter', 'Wilson', 'Williams', 'Salisbury',
  'McCarthy', 'Trevithick', 'Brooks', 'Fraser', 'Turnbull', 'Hunt', 'Syed',
  'Nazir', 'Parsons', 'Kershaw', 'Askey', 'Sinha', 'Anglin', 'Palmer',
  'Ahluwalia', 'Ho', 'Lanceley', 'Lyon', 'Arnold', 'Foster', 'Harrison',
  'Davies', 'Downing', 'Young', 'Hillyard', "O'Brien", 'Malik', 'Turner',
  'Zafar', 'Rogers', 'Booker', 'Osei', 'Clarke', 'Griffiths',
] as const

type Gender = DraftPatient['gender']

function randomFirstName(gender: Gender): string {
  if (gender === 'male') return randomItem(MALE_FIRST_NAMES)
  if (gender === 'female') return randomItem(FEMALE_FIRST_NAMES)
  return randomItem([...MALE_FIRST_NAMES, ...FEMALE_FIRST_NAMES])
}

function randomPatientGender(): Gender {
  const r = Math.random()
  if (r < 0.47) return 'male'
  if (r < 0.94) return 'female'
  if (r < 0.97) return 'other'
  return 'unknown'
}

// Realistic UK title distribution: common titles dominate, with rare
// honorifics (Dr/Rev/Sir/Lady/Lord) occasionally appearing for either sex.
function patientPrefix(gender: Gender): string {
  const r = Math.random()
  if (gender === 'male') {
    if (r < 0.90) return 'Mr'
    if (r < 0.94) return 'Dr'
    if (r < 0.97) return 'Rev'
    if (r < 0.99) return 'Sir'
    return 'Lord'
  }
  if (gender === 'female') {
    if (r < 0.55) return 'Mrs'
    if (r < 0.85) return 'Miss'
    if (r < 0.92) return 'Ms'
    if (r < 0.96) return 'Dr'
    if (r < 0.98) return 'Rev'
    return 'Lady'
  }
  return ''
}

function randomGivenName(gender: Gender): string {
  const first = randomFirstName(gender)
  if (Math.random() < 0.3) {
    let middle = randomFirstName(gender)
    while (middle === first) middle = randomFirstName(gender)
    return `${first} ${middle}`
  }
  return first
}

// ---------------------------------------------------------------------------
// Place pools
// ---------------------------------------------------------------------------

const TOWNS = [
  { town: 'Leeds', outcode: 'LS7', areaCode: '0113' },
  { town: 'Bristol', outcode: 'BS10', areaCode: '0117' },
  { town: 'Manchester', outcode: 'M14', areaCode: '0161' },
  { town: 'Warrington', outcode: 'WA1', areaCode: '01925' },
  { town: 'York', outcode: 'YO24', areaCode: '01904' },
  { town: 'Newcastle upon Tyne', outcode: 'NE6', areaCode: '0191' },
  { town: 'Sheffield', outcode: 'S10', areaCode: '0114' },
  { town: 'Birmingham', outcode: 'B15', areaCode: '0121' },
  { town: 'Nottingham', outcode: 'NG7', areaCode: '0115' },
  { town: 'Liverpool', outcode: 'L15', areaCode: '0151' },
] as const

const STREET_BASE_WORDS = [
  'Wellbrook', 'Sycamore', 'Kirkstall', 'Mill', 'Orchard', 'Chestnut',
  'Birchwood', 'Elm', 'Foxglove', 'Kingsley', 'Maple', 'Priory', 'Ashfield',
  'Cedar', 'Thornbury', 'Meadow', 'Oakfield', 'Riverside', 'Hillcrest',
  'Fernleigh', 'Rosemount', 'Woodgate', 'Springfield', 'Lonsdale',
  'Greenway', 'Larkspur', 'Bramble', 'Willow', 'Hazelwood', 'Fenwick',
] as const

const ROAD_TYPES = [
  'Road', 'Lane', 'Avenue', 'Close', 'Drive', 'Way', 'Court', 'Grove',
  'Street', 'Gardens', 'Terrace', 'Walk', 'Rise', 'Crescent', 'Mews',
] as const

// Fictional practice names, built from generic place-word + practice-type
// combinations rather than reusing real GP practice names — avoids any
// resemblance to actual NHS test/production practices.
const PRACTICE_PLACE_WORDS = [
  'Wellbrook', 'Ashfield', 'Meadowbank', 'Oakfield', 'Riverside', 'Hillside',
  'Kingsmead', 'Foxglove', 'Elmwood', 'Birchfield', 'Thornbury', 'Priorsgate',
  'Sycamore', 'Chestnut', 'Maplewood', 'Cedarhurst', 'Northgate', 'Southmead',
  'Westfield', 'Eastbrook', 'Rosedale', 'Greenacre', 'Fairview', 'Highfield',
  'Lonsdale', 'Brookfield', 'Ferndale', 'Woodside', 'Millbrook', 'Springvale',
] as const

const PRACTICE_TYPE_WORDS = [
  'Surgery', 'Medical Practice', 'Health Centre', 'Group Practice',
  'Family Practice', 'Medical Centre',
] as const

function randomPracticeName(exclude?: string): string {
  for (;;) {
    const place = randomItem(PRACTICE_PLACE_WORDS)
    const name = Math.random() < 0.15 ? `The ${place} Practice` : `${place} ${randomItem(PRACTICE_TYPE_WORDS)}`
    if (name !== exclude) return name
  }
}

// Real, well-known NHS hospitals — large public institutions, safe to name
// directly (unlike small GP practices, which are fictionalised above).
const HOSPITAL_NAMES = [
  'Manchester Royal Infirmary', "Queen's Medical Centre, Nottingham",
  'Royal Stoke University Hospital', 'Royal Derby Hospital',
  'The Royal London Hospital', 'Leeds General Infirmary',
  "St James's University Hospital, Leeds", 'North Manchester General Hospital',
  'Wythenshawe Hospital', "St Thomas' Hospital", "Guy's Hospital",
  "Addenbrooke's Hospital", 'John Radcliffe Hospital',
  'Queen Elizabeth Hospital Birmingham', 'Southampton General Hospital',
  'Bristol Royal Infirmary', 'Freeman Hospital', 'Royal Victoria Infirmary',
  "King's College Hospital", 'Norfolk and Norwich University Hospital',
  'Hull Royal Infirmary', 'Northern General Hospital',
  'Aintree University Hospital', 'Salford Royal Hospital',
  'Glasgow Royal Infirmary',
] as const

const PHARMACY_CHAIN_NAMES = [
  'Boots Pharmacy', 'Superdrug Pharmacy', 'Well Pharmacy', 'Lloyds Pharmacy',
  'Tesco Pharmacy', 'Asda Pharmacy', "Sainsbury's Pharmacy",
  'Morrisons Pharmacy', 'Rowlands Pharmacy',
] as const

function randomPharmacyName(): string {
  if (Math.random() < 0.5) return randomItem(PHARMACY_CHAIN_NAMES)
  return `${randomItem(STREET_BASE_WORDS)} Pharmacy`
}

function randomTempId(): string {
  return crypto.randomUUID().slice(0, 8)
}

function randomOrganisation(name: string): DraftOrganisation {
  const town = randomItem(TOWNS)
  return {
    _tempId: randomTempId(),
    name,
    odsCode: randomOdsCode(),
    phone: randomPhone(town.areaCode),
    address: randomAddress(town),
  }
}

function randomStreetName(): string {
  return `${randomItem(STREET_BASE_WORDS)} ${randomItem(ROAD_TYPES)}`
}

function randomPostcode(outcode: string): string {
  return `${outcode} ${randomInt(1, 9)}${randomLetter()}${randomLetter()}`
}

function randomPhone(areaCode: string): string {
  return `${areaCode} ${randomDigits(7 - (areaCode.length - 4))}`
}

function randomAddress(town: { town: string; outcode: string }): string {
  const number = randomInt(1, 199)
  return `${number} ${randomStreetName()}, ${town.town}, ${randomPostcode(town.outcode)}`
}

function randomOdsCode(): string {
  return `${randomLetter()}${randomDigits(5)}`
}

function randomSdsSuffix(): string {
  return randomDigits(7)
}

// ---------------------------------------------------------------------------
// Communication / language
// ---------------------------------------------------------------------------

const OTHER_LANGUAGES = [
  'Polish', 'Urdu', 'Punjabi', 'Bengali', 'Gujarati', 'Arabic', 'Portuguese',
  'Romanian', 'Spanish', 'French', 'Somali', 'Turkish', 'Chinese (Mandarin)',
  'Chinese (Cantonese)',
] as const

const COMMUNICATION_MODES = [
  'Received spoken', 'Received written', 'Expressed spoken', 'Expressed written',
] as const

interface RandomCommunication {
  preferredLanguage: string
  communicationProficiency: string
  modeOfCommunication: string
  interpreterRequired: boolean
}

function randomCommunication(): RandomCommunication {
  if (Math.random() < 0.7) {
    return {
      preferredLanguage: 'English',
      communicationProficiency: 'Excellent',
      modeOfCommunication: randomItem(COMMUNICATION_MODES),
      interpreterRequired: false,
    }
  }
  const proficiency = randomItem(['Excellent', 'Good', 'Fair', 'Poor'])
  return {
    preferredLanguage: randomItem(OTHER_LANGUAGES),
    communicationProficiency: proficiency,
    modeOfCommunication: randomItem(COMMUNICATION_MODES),
    interpreterRequired: proficiency === 'Poor' || (proficiency === 'Fair' && Math.random() < 0.5),
  }
}

// ---------------------------------------------------------------------------
// Practitioner generation
// ---------------------------------------------------------------------------

type PractitionerRole = 'General Practitioner' | 'Practice Nurse'

// GPs/doctors in primary care are conventionally always titled "Dr"; practice
// nurses (any gender) conventionally use Mr/Mrs/Miss rather than "Nurse".
function randomPractitioner(tempId: string, role: PractitionerRole): DraftPractitioner {
  const gender: 'male' | 'female' = Math.random() < 0.5 ? 'male' : 'female'
  const suffix = randomSdsSuffix()
  const prefix = role === 'General Practitioner' ? 'Dr' : (gender === 'male' ? 'Mr' : randomItem(['Mrs', 'Miss']))
  return {
    _tempId: tempId,
    prefix,
    givenName: randomFirstName(gender),
    familyName: randomItem(SURNAMES),
    sdsUserId: `G${suffix}`,
    sdsRoleProfileId: `R${suffix}`,
    gender,
    role,
  }
}

// ---------------------------------------------------------------------------
// Next of kin
// ---------------------------------------------------------------------------

const RELATIONSHIPS = [
  'Spouse', 'Partner', 'Parent', 'Son', 'Daughter', 'Sibling', 'Friend', 'Neighbour',
] as const

const SHARED_SURNAME_RELATIONSHIPS = new Set(['Spouse', 'Partner', 'Son', 'Daughter'])

function randomContact(patientSurname: string): DraftContact {
  const gender: 'male' | 'female' = Math.random() < 0.5 ? 'male' : 'female'
  const relationship = randomItem(RELATIONSHIPS)
  const sharesSurname = SHARED_SURNAME_RELATIONSHIPS.has(relationship) && Math.random() < 0.8
  return {
    _tempId: randomTempId(),
    relationship,
    prefix: patientPrefix(gender) || undefined,
    givenName: randomFirstName(gender),
    familyName: sharesSurname ? patientSurname : randomItem(SURNAMES),
    phone: `07${randomDigits(9)}`,
    gender,
  }
}

function randomContacts(patientSurname: string): DraftContact[] {
  const r = Math.random()
  const count = r < 0.2 ? 0 : r < 0.9 ? 1 : 2
  return Array.from({ length: count }, () => randomContact(patientSurname))
}

// ---------------------------------------------------------------------------
// Draft factory
// ---------------------------------------------------------------------------

export function createSampleDraft(): DraftRecord {
  const gender = randomPatientGender()
  const town = randomItem(TOWNS)
  const practiceName = randomPracticeName()
  const practiceAddress = `1 ${randomStreetName()}, ${town.town}, ${randomPostcode(town.outcode)}`
  const dob = randomDateString(1935, 2022)
  const registrationStart = randomDateString(
    Math.max(Number(dob.slice(0, 4)), 2005),
    2024,
  )

  const [patientSurname, ...practitionerNames] = randomDistinct(SURNAMES, 4)
  const communication = randomCommunication()

  const hospitalNames = randomDistinct(HOSPITAL_NAMES, Math.random() < 0.5 ? 1 : 2)
  const otherOrganisations: DraftOrganisation[] = [
    ...hospitalNames.map(name => randomOrganisation(name)),
    randomOrganisation(randomPracticeName(practiceName)),
    randomOrganisation(randomPharmacyName()),
  ]

  return {
    patient: {
      _tempId: 'patient-1',
      nhsNumber: generateNhsNumber(),
      nhsNumberVerified: true,
      prefix: patientPrefix(gender),
      givenName: randomGivenName(gender),
      familyName: patientSurname,
      dateOfBirth: dob,
      gender,
      isActive: true,
      registrationType: 'Regular',
      registrationStart,
      address: randomAddress(town),
      phone: randomPhone(town.areaCode),
      preferredLanguage: communication.preferredLanguage,
      communicationProficiency: communication.communicationProficiency,
      modeOfCommunication: communication.modeOfCommunication,
      interpreterRequired: communication.interpreterRequired,
      registeredGpTempId: 'prac-1',
      contacts: randomContacts(patientSurname),
    },
    organisation: {
      _tempId: 'org-1',
      name: practiceName,
      odsCode: randomOdsCode(),
      phone: randomPhone(town.areaCode),
      address: practiceAddress,
    },
    organisations: otherOrganisations,
    practitioners: [
      { ...randomPractitioner('prac-1', 'General Practitioner'), familyName: practitionerNames[0] },
      { ...randomPractitioner('prac-2', 'General Practitioner'), familyName: practitionerNames[1] },
      { ...randomPractitioner('prac-3', 'Practice Nurse'), familyName: practitionerNames[2] },
    ],
    locations: [
      {
        _tempId: 'loc-1',
        name: `${practiceName} — Main Building`,
        address: practiceAddress,
      },
    ],
    medications: [],
    allergies: [],
    problems: [],
    consultations: [],
    immunisations: [],
    investigations: [],
    referrals: [],
    diaryEntries: [],
    codedData: [],
    documents: [],
  }
}

export function createFullSampleDraft(): DraftRecord {
  const base = createSampleDraft()
  return {
    ...base,
    medications: [{
      _tempId: 'med-1',
      drugName: 'Atorvastatin 20mg tablets',
      snomedCode: '325278007',
      prescriptionType: 'repeat',
      status: 'active',
      dose: '20 mg',
      frequency: 'Once a day',
      route: 'Oral',
      dosageInstruction: '1 tablet once daily at night',
      prescribedQuantityValue: 28,
      prescribedQuantityUnit: 'tablet',
      numberOfRepeatsAllowed: 6,
      startDate: '2022-01-15',
      prescriberTempId: 'prac-1',
      recorderTempId: 'prac-1',
      issues: [],
    }],
    allergies: [{
      _tempId: 'allergy-1',
      causativeAgent: 'Penicillin',
      snomedCode: '372687004',
      category: 'medication',
      criticality: 'high',
      reaction: 'Anaphylaxis',
      status: 'active',
      assertedDate: '2019-06-10',
      recorderTempId: 'prac-2',
    }],
    problems: [{
      _tempId: 'prob-1',
      problem: 'Hypertension',
      snomedCode: '38341003',
      clinicalStatus: 'active',
      significance: 'major',
      startDate: '2018-03-22',
      asserterTempId: 'prac-1',
    }],
    consultations: [{
      _tempId: 'cons-1',
      date: '2024-02-14',
      typeDisplay: 'Telephone consultation',
      clinicianTempId: 'prac-1',
      orgTempId: 'org-1',
      encounterClass: 'AMB',
      topics: [{
        _tempId: 'topic-1',
        title: 'Hypertension review',
        categories: [{
          _tempId: 'cat-1',
          title: 'History',
          items: [{
            _tempId: 'item-1',
            itemType: 'note',
            date: '2024-02-14',
            narrativeText: 'Patient reports well-controlled blood pressure at home readings.',
          }],
        }],
        items: [],
      }],
    }],
    immunisations: [{
      _tempId: 'imm-1',
      vaccinationProcedureCode: '86198006',
      vaccinationProcedureDisplay: 'Seasonal influenza vaccination',
      vaccineName: 'Influenza vaccine',
      snomedCode: '46233009',
      dateGiven: '2023-10-15',
      status: 'completed',
      administeringPractitionerTempId: 'prac-3',
      locationTempId: 'loc-1',
    }],
    investigations: [{
      _tempId: 'inv-1',
      name: 'Full blood count',
      snomedCode: '26604007',
      date: '2024-01-10',
      status: 'final',
      performerTempId: 'prac-1',
      specimens: [{
        _tempId: 'invs-1',
        type: 'Venous blood specimen',
        snomedCode: '122555007',
        collectedDate: '2024-01-10',
        receivedDate: '2024-01-10',
        status: 'available',
      }],
      testRequests: [],
      testGroups: [{
        _tempId: 'invg-1',
        name: 'Full blood count',
        snomedCode: '26604007',
        results: [{
          _tempId: 'invr-1',
          name: 'Haemoglobin',
          snomedCode: '718-7',
          value: '138',
          unit: 'g/L',
          referenceRangeLow: '120',
          referenceRangeHigh: '160',
          interpretation: 'normal',
        }],
      }],
    }],
    referrals: [{
      _tempId: 'ref-1',
      date: '2024-03-01',
      recipientName: 'Cardiology Outpatients',
      priority: 'routine',
      reason: 'Chest pain assessment',
      status: 'active',
      requesterTempId: 'prac-1',
    }],
    diaryEntries: [{
      _tempId: 'diary-1',
      description: 'Annual diabetes review',
      snomedCode: '390906001',
      date: '2024-06-01',
      occurrenceStart: '2024-06-01',
      clinicianTempId: 'prac-1',
      status: 'active',
      intent: 'plan',
    }],
    codedData: [{
      _tempId: 'coded-1',
      description: 'Body weight',
      snomedCode: '27113001',
      date: '2024-02-14',
      value: '78',
      unit: 'kg',
      performerTempId: 'prac-3',
    }],
    documents: [{
      _tempId: 'doc-1',
      type: 'Discharge summary',
      indexedDate: '2023-11-20',
      createdDate: '2023-11-19',
      description: 'Discharge summary from Leeds General Infirmary',
      status: 'current',
      authorTempId: 'prac-1',
      custodianOrgTempId: 'org-1',
    }],
  }
}
