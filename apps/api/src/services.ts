import {
  AuditLog,
  ConsentService,
  InMemoryAuditStore,
  InMemoryConsentRepository,
  type AuditStore,
  type ConsentRepository,
} from '@pgpc/core'
import { createPostgresClient, PostgresAuditStore, PostgresConsentRepository } from '@pgpc/store-postgres'

export interface Services {
  storeKind: 'memory' | 'postgres'
  audit: AuditLog
  consents: ConsentService
  /** Cheap connectivity check for /api/health. */
  ping(): Promise<boolean>
  close(): Promise<void>
}

// Only ever used for the in-memory store (tests, local dev without a DB).
const DEV_PSEUDONYM_KEY = 'local-development-only-not-a-secret'

export interface ServiceEnv {
  DATABASE_URL?: string
  AUDIT_PSEUDONYM_KEY?: string
}

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
    return assemble('postgres', new PostgresConsentRepository(sql), new PostgresAuditStore(sql), env.AUDIT_PSEUDONYM_KEY, {
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
  return assemble('memory', new InMemoryConsentRepository(), new InMemoryAuditStore(), env.AUDIT_PSEUDONYM_KEY || DEV_PSEUDONYM_KEY, {
    ping: async () => true,
    close: async () => {},
  })
}

function assemble(
  storeKind: Services['storeKind'],
  repository: ConsentRepository,
  auditStore: AuditStore,
  pseudonymKey: string,
  lifecycle: Pick<Services, 'ping' | 'close'>,
): Services {
  const audit = new AuditLog(auditStore, { pseudonymKey })
  return { storeKind, audit, consents: new ConsentService({ repository, audit }), ...lifecycle }
}
