import { createHmac } from 'node:crypto'
import { MIDDLEWARE } from '@pgpc/fixtures'
import {
  GpConnectHtmlClient,
  GpConnectStructuredClient,
  InMemoryFaultSource,
  InMemoryMeshStore,
  InMemoryOutbox,
  MockMesh,
  MockNhsLogin,
  MockPds,
  MockSds,
  MockSms,
  simulatedGpSystems,
  withFaults,
  type GpConnectHtmlAdapter,
  type GpConnectStructuredAdapter,
  type FaultControl,
  type MeshAdapter,
  type SimMeshStore,
  type NhsLoginAdapter,
  type PdsAdapter,
  type SdsAdapter,
  type SimOutbox,
  type SmsAdapter,
} from '@pgpc/adapters'
import {
  AuditLog,
  ConsentService,
  InMemoryAuditStore,
  InMemoryConsentRepository,
  InMemoryOtpStore,
  OtpService,
  type AuditStore,
  type ConsentRepository,
  type OtpStore,
} from '@pgpc/core'
import {
  createPostgresClient,
  PostgresAuditStore,
  PostgresConsentRepository,
  PostgresFaultSource,
  PostgresMeshStore,
  PostgresOtpStore,
  PostgresOutbox,
} from '@pgpc/store-postgres'

export interface Adapters {
  pds: PdsAdapter
  sds: SdsAdapter
  nhsLogin: NhsLoginAdapter
  sms: SmsAdapter
  gpConnectHtml: GpConnectHtmlAdapter
  gpConnectStructured: GpConnectStructuredAdapter
  mesh: MeshAdapter
}

export interface Simulator {
  /** Mock NHS login, for the persona picker to issue codes. */
  nhsLogin: MockNhsLogin
  outbox: SimOutbox
  faults: FaultControl
  /** Simulated MESH mailboxes / practice inboxes. */
  mesh: SimMeshStore
}

export interface Services {
  storeKind: 'memory' | 'postgres'
  audit: AuditLog
  consents: ConsentService
  consentRepository: ConsentRepository
  otp: OtpService
  adapters: Adapters
  simulator: Simulator
  /** HMAC key for patient session and sign-in state cookies. */
  sessionKey: string
  /** HMAC key for provider session tokens. */
  providerSessionKey: string
  /** HMAC key for service admin session tokens. */
  adminSessionKey: string
  /** Cheap connectivity check for /api/health. */
  ping(): Promise<boolean>
  close(): Promise<void>
}

// Only ever used for the in-memory store (tests, local dev without a DB).
const DEV_SECRET = 'local-development-only-not-a-secret'

export interface ServiceEnv {
  DATABASE_URL?: string
  AUDIT_PSEUDONYM_KEY?: string
}

/** Derives an independent key for another purpose, so one secret serves both. */
const deriveKey = (secret: string, purpose: string) => createHmac('sha256', secret).update(purpose).digest('hex')

/**
 * Picks storage from the environment: Postgres when DATABASE_URL is set
 * (Supabase in the hosted demo), otherwise in-memory. Postgres requires a real
 * AUDIT_PSEUDONYM_KEY, since pseudonyms written with the dev key would be
 * reversible by anyone who reads this file.
 */
export function createServices(env: ServiceEnv = process.env): Services {
  if (env.DATABASE_URL) {
    if (!env.AUDIT_PSEUDONYM_KEY || env.AUDIT_PSEUDONYM_KEY.length < 32) {
      throw new Error('AUDIT_PSEUDONYM_KEY (at least 32 characters) is required when DATABASE_URL is set')
    }
    const sql = createPostgresClient(env.DATABASE_URL)
    return assemble({
      storeKind: 'postgres',
      repository: new PostgresConsentRepository(sql),
      auditStore: new PostgresAuditStore(sql),
      outbox: new PostgresOutbox(sql),
      otpStore: new PostgresOtpStore(sql),
      meshStore: new PostgresMeshStore(sql),
      faults: new PostgresFaultSource(sql),
      secret: env.AUDIT_PSEUDONYM_KEY,
      ping: async () => {
        try {
          await sql.query('select 1')
          return true
        } catch {
          return false
        }
      },
      close: () => sql.close(),
    })
  }
  return assemble({
    storeKind: 'memory',
    repository: new InMemoryConsentRepository(),
    auditStore: new InMemoryAuditStore(),
    outbox: new InMemoryOutbox(),
    otpStore: new InMemoryOtpStore(),
    meshStore: new InMemoryMeshStore(),
    faults: new InMemoryFaultSource(),
    secret: env.AUDIT_PSEUDONYM_KEY || DEV_SECRET,
    ping: async () => true,
    close: async () => {},
  })
}

function assemble(parts: {
  storeKind: Services['storeKind']
  repository: ConsentRepository
  auditStore: AuditStore
  outbox: SimOutbox
  otpStore: OtpStore
  meshStore: SimMeshStore
  faults: FaultControl
  secret: string
  ping: Services['ping']
  close: Services['close']
}): Services {
  const audit = new AuditLog(parts.auditStore, { pseudonymKey: parts.secret })
  const faults = parts.faults
  const nhsLogin = new MockNhsLogin({ signingKey: deriveKey(parts.secret, 'sim-nhs-login-signing') })
  return {
    storeKind: parts.storeKind,
    audit,
    consents: new ConsentService({ repository: parts.repository, audit }),
    consentRepository: parts.repository,
    otp: new OtpService({ store: parts.otpStore, key: deriveKey(parts.secret, 'otp-code-hash') }),
    sessionKey: deriveKey(parts.secret, 'patient-session'),
    providerSessionKey: deriveKey(parts.secret, 'provider-session'),
    adminSessionKey: deriveKey(parts.secret, 'admin-session'),
    adapters: {
      pds: withFaults('pds', new MockPds(), ['getPatient', 'search'], faults),
      sds: withFaults('sds', new MockSds(), ['getGpConnectEndpoint'], faults),
      nhsLogin: withFaults('nhs-login', nhsLogin, ['exchangeCode'], faults),
      sms: withFaults('sms', new MockSms(parts.outbox), ['send'], faults),
      gpConnectHtml: withFaults('gp-connect', new GpConnectHtmlClient(simulatedGpSystems(), MIDDLEWARE), ['getCareRecord'], faults),
      gpConnectStructured: withFaults(
        'gp-connect',
        new GpConnectStructuredClient(simulatedGpSystems(), MIDDLEWARE),
        ['getStructuredRecord'],
        faults,
      ),
      mesh: withFaults('mesh', new MockMesh(parts.meshStore), ['lookupMailbox', 'send', 'status'], faults),
    },
    simulator: { nhsLogin, outbox: parts.outbox, faults, mesh: parts.meshStore },
    ping: parts.ping,
    close: parts.close,
  }
}
