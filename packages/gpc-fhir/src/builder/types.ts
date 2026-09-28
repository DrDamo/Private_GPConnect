// Draft types for the Record Builder — mirror of GpConnect* from src/fhir/types.ts
// but with all fields optional and a _tempId on every object.

export interface DraftPatient {
  _tempId: string
  nhsNumber?: string
  nhsNumberVerified?: boolean
  prefix?: string
  givenName?: string
  familyName?: string
  dateOfBirth?: string
  gender?: 'male' | 'female' | 'other' | 'unknown'
  isActive?: boolean
  registrationType?: string
  registrationStart?: string
  address?: string
  phone?: string
  email?: string
  preferredLanguage?: string
  interpreterRequired?: boolean
  communicationProficiency?: string
  modeOfCommunication?: string
  registeredGpTempId?: string
  contacts?: DraftContact[]
}

export interface DraftContact {
  _tempId: string
  relationship?: string
  prefix?: string
  givenName?: string
  familyName?: string
  phone?: string
  gender?: string
}

export interface DraftPractitioner {
  _tempId: string
  prefix?: string
  givenName?: string
  familyName?: string
  sdsUserId?: string
  sdsRoleProfileId?: string
  gender?: string
  role?: string
}

export interface DraftOrganisation {
  _tempId: string
  name?: string
  odsCode?: string
  phone?: string
  address?: string
}

export interface DraftLocation {
  _tempId: string
  name?: string
  address?: string
}

export interface DraftMedicationIssue {
  _tempId: string
  status?: 'cancelled' | string
  issueDate?: string
  startDate?: string
  endDate?: string
  quantityValue?: number
  quantityUnit?: string
  supplyDurationValue?: number
  supplyDurationUnit?: string
  dosageInstruction?: string
  patientInstructions?: string
  pharmacyInstructions?: string
  recorderTempId?: string
}

export interface DraftMedication {
  _tempId: string
  drugName?: string
  snomedCode?: string
  dmdCode?: string
  dmdDisplay?: string
  dmdType?: 'VMP' | 'AMP'
  prescriptionType?: 'acute' | 'repeat' | 'repeat-dispensing' | 'prescribed-elsewhere'
  status?: string
  dose?: string
  frequency?: string
  route?: string
  dosageInstruction?: string
  prescribedQuantityValue?: number
  prescribedQuantityUnit?: string
  supplyDurationValue?: number
  supplyDurationUnit?: string
  numberOfRepeatsAllowed?: number
  startDate?: string
  endDate?: string
  prescriberTempId?: string
  recorderTempId?: string
  orgTempId?: string
  patientInstructions?: string
  pharmacyInstructions?: string
  associatedText?: string
  issues?: DraftMedicationIssue[]
  stopReason?: 'reauthorisation' | string
  reauthorisedFromTempId?: string
  linkedProblemTempIds?: string[]
  linkedConsultationTempId?: string
  /** Excluded entirely from generated output; a "confidential items withheld" warning is added to this domain's List instead. */
  confidential?: boolean
  /** Output as normal, but tagged with a NOPAT security label (withheld from patient-facing services). */
  notForPfs?: boolean
}

export interface DraftAllergy {
  _tempId: string
  causativeAgent?: string
  snomedCode?: string
  category?: 'food' | 'medication' | 'environment' | 'biologic'
  criticality?: 'low' | 'high' | 'unable-to-assess'
  /** The coded manifestation of the reaction (FHIR AllergyIntolerance.reaction.manifestation). */
  reaction?: string
  reactionCode?: string
  /** Free-text description of the reaction event as a whole. Only meaningful once a manifestation is recorded. */
  reactionDescription?: string
  /** Date/time the manifestation showed. */
  reactionOnset?: string
  /** Clinical assessment of the severity of the reaction event as a whole. */
  reactionSeverity?: 'mild' | 'moderate' | 'severe'
  status?: 'active' | 'inactive' | 'resolved'
  assertedDate?: string
  onsetDate?: string
  /** Date the reaction most recently occurred (FHIR AllergyIntolerance.lastOccurrence). Not mandatory. */
  lastOccurrence?: string
  endDate?: string
  endReason?: string
  recorderTempId?: string
  associatedText?: string
  linkedProblemTempIds?: string[]
  linkedConsultationTempId?: string
  confidential?: boolean
  notForPfs?: boolean
}

export interface DraftProblem {
  _tempId: string
  problem?: string
  snomedCode?: string
  clinicalStatus?: 'active' | 'inactive' | 'recurrence' | 'remission' | 'resolved'
  significance?: 'major' | 'minor'
  /** Subjective severity of the problem — fixed SNOMED CT set (Condition.severity). Not mandatory. */
  severity?: 'severe' | 'moderate' | 'mild'
  startDate?: string
  endDate?: string
  assertedDate?: string
  asserterTempId?: string
  associatedText?: string
  linkedProblemTempIds?: string[]
  linkedConsultationTempId?: string
  confidential?: boolean
  notForPfs?: boolean
  /** Set on a "child" problem after a Group/Combine/Evolve action in the Problems list —
   * references the parent problem's _tempId. Drives the Extension-CareConnect-
   * RelatedProblemHeader-1 parent/child/sibling links and the EMIS-style descriptive notes
   * generated in builder/generate/problems.ts. Distinct from linkedProblemTempIds, which
   * produces the generic RelatedClinicalContent link, not a problem hierarchy. */
  relatedProblemParentTempId?: string
  /** How this child became related to its parent — only meaningful alongside relatedProblemParentTempId. */
  relatedProblemEventType?: 'group' | 'combine' | 'evolve'
}

export type DraftConsultationItemType = 'note' | 'coded'

export interface DraftConsultationItem {
  _tempId: string
  itemType: DraftConsultationItemType
  date?: string
  narrativeText?: string
  snomedCode?: string
  /** SNOMED semantic tag of the linked code (e.g. "observable entity"), captured
   * at selection time — gates whether the value/units/range fields are shown. */
  semanticTag?: string
  description?: string
  value?: string
  unit?: string
  minRange?: string
  maxRange?: string
  interpretation?: 'normal' | 'abnormal' | 'potentially-abnormal'
  associatedText?: string
}

// A category whose title is one of these (Allergy, Document, Investigation,
// Diary Entry, Medication, Referral) doesn't hold free note/coded items like
// History or Examination — instead it references records created in their
// own section via the matching "Add <kind>" dialogue, so the right data
// items are always collected for that resource type.
export type ConsultationLinkKind = 'allergy' | 'document' | 'investigation' | 'diaryEntry' | 'medication' | 'referral'

export interface DraftConsultationLinkedRef {
  kind: ConsultationLinkKind
  /** _tempId of the record in its own top-level list (draft.allergies, draft.documents, …). */
  tempId: string
}

export interface DraftConsultationCategory {
  _tempId: string
  title?: string
  items: DraftConsultationItem[]
  /** Present only for a linked-kind category (see ConsultationLinkKind) — the
   * records it references, in the order they were added. */
  linkedRefs?: DraftConsultationLinkedRef[]
}

export interface DraftConsultationTopic {
  _tempId: string
  title?: string
  /** Single Problem (Condition) created for this topic — max one per topic. */
  problemTempId?: string
  categories: DraftConsultationCategory[]
  items: DraftConsultationItem[]
}

export interface DraftConsultation {
  _tempId: string
  date?: string
  endDate?: string
  typeDisplay?: string
  typeCode?: string
  clinicianTempId?: string
  orgTempId?: string
  encounterClass?: string
  topics: DraftConsultationTopic[]
  linkedProblemTempIds?: string[]
  confidential?: boolean
  notForPfs?: boolean
}

export interface DraftImmunisation {
  _tempId: string
  vaccineName?: string
  snomedCode?: string
  vaccinationProcedureCode?: string
  vaccinationProcedureDisplay?: string
  dateGiven?: string
  dateRecorded?: string
  status?: string
  notGiven?: boolean
  parentPresent?: boolean
  reason?: string
  site?: string
  route?: string
  batchNumber?: string
  expirationDate?: string
  manufacturer?: string
  administeringPractitionerTempId?: string
  enteringPractitionerTempId?: string
  locationTempId?: string
  associatedText?: string
  linkedProblemTempIds?: string[]
  linkedConsultationTempId?: string
  confidential?: boolean
  notForPfs?: boolean
}

export interface DraftInvestigationResult {
  _tempId: string
  name?: string
  snomedCode?: string
  value?: string
  unit?: string
  referenceRangeLow?: string
  referenceRangeHigh?: string
  interpretation?: string
  comment?: string
}

// A panel/battery of tests (e.g. "Full blood count") — the middle tier of the
// GP Connect Investigations model: Test Report > Test Group > Test Result.
// https://simplifier.net/guide/gp-connect-access-record-structured/Home/Design/Investigations-guidance
export interface DraftTestGroup {
  _tempId: string
  name?: string
  snomedCode?: string
  /** "Lab Comment" for this group — same mechanism as the report-level Lab
   * Comment (its own Comment Note Observation, has-member linked to this
   * group), just scoped to this group's results instead of the whole report. */
  labComment?: string
  /** "GP Filing Comment" — also its own Comment Note Observation has-member
   * linked to this group, alongside labComment; the two are independent
   * (lab's comment on the results vs. the GP's comment on filing them). */
  comment?: string
  results: DraftInvestigationResult[]
}

// A specimen linked to a Test Report — a report can have more than one
// (e.g. blood + urine on the same request), so these are a repeatable list.
export interface DraftSpecimen {
  _tempId: string
  type?: string
  snomedCode?: string
  collectedDate?: string
  receivedDate?: string
  status?: string
  note?: string
}

// A test request linked to a Test Report — also repeatable, for a report
// that was raised against more than one requested test/procedure.
export interface DraftTestRequest {
  _tempId: string
  name?: string
  snomedCode?: string
  status?: string
  intent?: string
  requesterTempId?: string
}

export interface DraftInvestigation {
  _tempId: string
  name?: string
  snomedCode?: string
  date?: string
  status?: string
  performerTempId?: string
  // Report-level "Lab Comment" filing comment
  comment?: string
  specimens: DraftSpecimen[]
  testRequests: DraftTestRequest[]
  testGroups: DraftTestGroup[]
  linkedProblemTempIds?: string[]
  linkedConsultationTempId?: string
  confidential?: boolean
  notForPfs?: boolean
}

export interface DraftReferral {
  _tempId: string
  date?: string
  recipientName?: string
  priority?: 'routine' | 'urgent' | 'asap' | 'stat'
  reason?: string
  description?: string
  requesterTempId?: string
  status?: string
  intent?: string
  associatedText?: string
  linkedProblemTempIds?: string[]
  linkedConsultationTempId?: string
  confidential?: boolean
  notForPfs?: boolean
}

export interface DraftDiaryEntry {
  _tempId: string
  description?: string
  snomedCode?: string
  date?: string
  occurrenceStart?: string
  occurrenceEnd?: string
  clinicianTempId?: string
  priority?: string
  status?: string
  intent?: string
  associatedText?: string
  linkedProblemTempIds?: string[]
  linkedConsultationTempId?: string
  confidential?: boolean
  notForPfs?: boolean
}

export interface DraftCodedDataItem {
  _tempId: string
  description?: string
  snomedCode?: string
  date?: string
  status?: string
  value?: string
  unit?: string
  comment?: string
  interpretation?: string
  performerTempId?: string
  linkedProblemTempIds?: string[]
  linkedConsultationTempId?: string
  confidential?: boolean
  notForPfs?: boolean
}

export interface DraftDocument {
  _tempId: string
  type?: string
  /** Date of filing to the record-keeping system (DocumentReference.indexed). Mandatory, full date only. */
  indexedDate?: string
  /** Date the original document was created (DocumentReference.created). Optional. */
  createdDate?: string
  description?: string
  mimeType?: string
  url?: string
  authorTempId?: string
  custodianOrgTempId?: string
  status?: string
  linkedProblemTempIds?: string[]
  linkedConsultationTempId?: string
  confidential?: boolean
  notForPfs?: boolean
}

export interface DraftRecord {
  patient: DraftPatient
  organisation: DraftOrganisation
  organisations: DraftOrganisation[]
  practitioners: DraftPractitioner[]
  locations: DraftLocation[]
  medications: DraftMedication[]
  allergies: DraftAllergy[]
  problems: DraftProblem[]
  consultations: DraftConsultation[]
  immunisations: DraftImmunisation[]
  investigations: DraftInvestigation[]
  referrals: DraftReferral[]
  diaryEntries: DraftDiaryEntry[]
  codedData: DraftCodedDataItem[]
  documents: DraftDocument[]
}
