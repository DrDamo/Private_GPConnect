import type { RecordProfile } from './patients'

// Placeholder clinical content for each record profile, used to generate the
// simulated GP Connect HTML views until real dummy examples replace them.
// Clinically plausible but deliberately simple; every entry is invented.

export interface SimProblem {
  term: string
  onset: string
  status: 'active' | 'past'
  significance: 'major' | 'minor'
  ended?: string
  /** Withheld by GP Connect as confidential (shown as an exclusion banner instead). */
  confidential?: boolean
}

export interface SimMedication {
  name: string
  dosage: string
  quantity: string
  type: 'Acute' | 'Repeat'
  lastIssued: string
  started: string
}

export interface SimAllergy {
  substance: string
  reaction: string
  recorded: string
}

export interface SimObservation {
  name: string
  value: string
  date: string
}

export interface SimEncounter {
  date: string
  clinician: string
  type: string
  summary: string
  confidential?: boolean
}

export interface SimClinicalRecord {
  problems: SimProblem[]
  medications: SimMedication[]
  allergies: SimAllergy[] | 'no-known-allergies'
  observations: SimObservation[]
  encounters: SimEncounter[]
  immunisations: Array<{ vaccine: string; date: string }>
  referrals: Array<{ date: string; to: string; reason: string }>
}

const standard: SimClinicalRecord = {
  problems: [
    { term: 'Asthma', onset: '2009-04-14', status: 'active', significance: 'major' },
    { term: 'Sprained ankle', onset: '2021-06-02', status: 'past', significance: 'minor', ended: '2021-07-15' },
  ],
  medications: [
    { name: 'Salbutamol 100micrograms/dose inhaler', dosage: 'Two puffs when required', quantity: '1 inhaler', type: 'Repeat', lastIssued: '2026-08-20', started: '2009-04-14' },
    { name: 'Clenil Modulite 100micrograms/dose inhaler', dosage: 'Two puffs twice a day', quantity: '1 inhaler', type: 'Repeat', lastIssued: '2026-08-20', started: '2015-02-10' },
  ],
  allergies: 'no-known-allergies',
  observations: [
    { name: 'Blood pressure', value: '124/78 mmHg', date: '2026-03-11' },
    { name: 'Body mass index', value: '24.1 kg/m²', date: '2026-03-11' },
    { name: 'Peak expiratory flow', value: '410 L/min', date: '2026-03-11' },
  ],
  encounters: [
    { date: '2026-03-11', clinician: 'Dr A Patel (simulated)', type: 'Face to face', summary: 'Asthma annual review. Well controlled. Inhaler technique checked.' },
    { date: '2025-11-02', clinician: 'Nurse B Jones (simulated)', type: 'Face to face', summary: 'Seasonal flu vaccination given.' },
  ],
  immunisations: [{ vaccine: 'Influenza vaccine', date: '2025-11-02' }],
  referrals: [],
}

const RECORDS: Record<RecordProfile, SimClinicalRecord> = {
  standard,
  'weight-management': {
    problems: [
      { term: 'Type 2 diabetes mellitus', onset: '2021-05-19', status: 'active', significance: 'major' },
      { term: 'Obesity', onset: '2020-01-08', status: 'active', significance: 'major' },
      { term: 'Anorexia nervosa', onset: '2006-09-01', status: 'past', significance: 'major', ended: '2010-12-01' },
    ],
    medications: [
      { name: 'Metformin 500mg tablets', dosage: 'One tablet twice a day with meals', quantity: '112 tablets', type: 'Repeat', lastIssued: '2026-09-01', started: '2021-05-19' },
      { name: 'Atorvastatin 20mg tablets', dosage: 'One tablet at night', quantity: '28 tablets', type: 'Repeat', lastIssued: '2026-09-01', started: '2022-02-11' },
    ],
    allergies: 'no-known-allergies',
    observations: [
      { name: 'Body weight', value: '102.4 kg', date: '2026-08-14' },
      { name: 'Body mass index', value: '36.4 kg/m²', date: '2026-08-14' },
      { name: 'HbA1c', value: '58 mmol/mol', date: '2026-08-14' },
      { name: 'Blood pressure', value: '138/86 mmHg', date: '2026-08-14' },
    ],
    encounters: [
      { date: '2026-08-14', clinician: 'Dr C Okoro (simulated)', type: 'Face to face', summary: 'Diabetes review. HbA1c above target. Discussed weight management options.' },
    ],
    immunisations: [{ vaccine: 'Influenza vaccine', date: '2025-10-20' }],
    referrals: [{ date: '2026-08-14', to: 'Tier 3 weight management service (simulated)', reason: 'BMI 36.4 with type 2 diabetes' }],
  },
  cannabis: {
    problems: [
      { term: 'Chronic low back pain', onset: '2019-02-20', status: 'active', significance: 'major' },
      { term: 'Drug-induced psychosis', onset: '2014-07-03', status: 'past', significance: 'major', ended: '2015-01-15' },
      { term: 'Depression', onset: '2019-09-12', status: 'active', significance: 'minor' },
    ],
    medications: [
      { name: 'Naproxen 500mg tablets', dosage: 'One tablet twice a day with food', quantity: '56 tablets', type: 'Repeat', lastIssued: '2026-09-10', started: '2019-02-20' },
      { name: 'Amitriptyline 10mg tablets', dosage: 'One tablet at night', quantity: '28 tablets', type: 'Repeat', lastIssued: '2026-09-10', started: '2020-03-05' },
      { name: 'Sertraline 50mg tablets', dosage: 'One tablet daily', quantity: '28 tablets', type: 'Repeat', lastIssued: '2026-09-10', started: '2019-09-12' },
    ],
    allergies: 'no-known-allergies',
    observations: [{ name: 'Blood pressure', value: '126/80 mmHg', date: '2026-05-02' }],
    encounters: [
      { date: '2026-05-02', clinician: 'Dr D Hughes (simulated)', type: 'Telephone', summary: 'Back pain persisting despite physiotherapy. Patient asking about private cannabis-based medicine.' },
    ],
    immunisations: [],
    referrals: [{ date: '2025-01-10', to: 'Musculoskeletal physiotherapy (simulated)', reason: 'Chronic low back pain' }],
  },
  polypharmacy: {
    problems: [
      { term: 'Atrial fibrillation', onset: '2018-10-01', status: 'active', significance: 'major' },
      { term: 'Hypertension', onset: '2005-03-15', status: 'active', significance: 'major' },
      { term: 'Chronic kidney disease stage 3', onset: '2020-06-18', status: 'active', significance: 'major' },
    ],
    medications: [
      { name: 'Warfarin 1mg tablets', dosage: 'As directed by the anticoagulant clinic', quantity: '112 tablets', type: 'Repeat', lastIssued: '2026-09-05', started: '2018-10-01' },
      { name: 'Bisoprolol 2.5mg tablets', dosage: 'One tablet daily', quantity: '28 tablets', type: 'Repeat', lastIssued: '2026-09-05', started: '2018-10-01' },
      { name: 'Ramipril 5mg capsules', dosage: 'One capsule daily', quantity: '28 capsules', type: 'Repeat', lastIssued: '2026-09-05', started: '2005-03-15' },
      { name: 'Atorvastatin 20mg tablets', dosage: 'One tablet at night', quantity: '28 tablets', type: 'Repeat', lastIssued: '2026-09-05', started: '2012-07-20' },
      { name: 'Omeprazole 20mg capsules', dosage: 'One capsule daily', quantity: '28 capsules', type: 'Repeat', lastIssued: '2026-09-05', started: '2016-01-12' },
    ],
    allergies: [{ substance: 'Penicillin', reaction: 'Widespread rash and facial swelling', recorded: '1988-05-01' }],
    observations: [
      { name: 'INR', value: '2.6', date: '2026-09-15' },
      { name: 'eGFR', value: '48 mL/min/1.73m²', date: '2026-07-22' },
      { name: 'Blood pressure', value: '142/84 mmHg', date: '2026-07-22' },
    ],
    encounters: [
      { date: '2026-07-22', clinician: 'Dr E Morris (simulated)', type: 'Face to face', summary: 'Chronic disease review. Kidney function stable. Continue current medicines.' },
    ],
    immunisations: [
      { vaccine: 'Influenza vaccine', date: '2025-10-01' },
      { vaccine: 'Pneumococcal polysaccharide vaccine', date: '2016-10-12' },
    ],
    referrals: [],
  },
  'confidential-items': {
    ...standard,
    problems: [
      ...standard.problems,
      { term: 'Termination of pregnancy', onset: '2019-03-04', status: 'past', significance: 'minor', ended: '2019-03-04', confidential: true },
    ],
    encounters: [
      ...standard.encounters,
      { date: '2019-03-01', clinician: 'Dr F Grant (simulated)', type: 'Face to face', summary: 'Confidential consultation.', confidential: true },
    ],
  },
  minimal: {
    problems: [],
    medications: [],
    allergies: 'no-known-allergies',
    observations: [],
    encounters: [{ date: '2026-09-24', clinician: 'Reception (simulated)', type: 'Administrative', summary: 'New patient registration. Previous records requested.' }],
    immunisations: [],
    referrals: [],
  },
}

export const clinicalRecordFor = (profile: RecordProfile): SimClinicalRecord => RECORDS[profile]
