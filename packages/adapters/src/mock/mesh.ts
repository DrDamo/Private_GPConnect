import { meshMailboxFor, PRACTICES, type SimPractice } from '@pgpc/fixtures'
import { AdapterError } from '../errors'
import type { MeshAdapter, MeshMessage, MeshStatus } from '../mesh'
import { SEND_DOCUMENT_WORKFLOW_ID } from '../sendDocument'

// Simulated MESH plus the receiving practices' inboxes. In a real deployment
// the message lives in MESH and then the GP system; this middleware keeps no
// copy (only the message id, in the audit trail).

export interface SimMeshStore {
  add(message: MeshMessage): Promise<void>
  get(id: string): Promise<MeshMessage | null>
  /** Newest first. */
  listForMailbox(mailbox: string, limit: number): Promise<MeshMessage[]>
  setStatus(id: string, status: MeshStatus, at: string, note?: string): Promise<boolean>
}

export class InMemoryMeshStore implements SimMeshStore {
  private readonly messages = new Map<string, MeshMessage>()
  async add(m: MeshMessage) {
    this.messages.set(m.id, structuredClone(m))
  }
  async get(id: string) {
    const m = this.messages.get(id)
    return m ? structuredClone(m) : null
  }
  async listForMailbox(mailbox: string, limit: number) {
    return [...this.messages.values()]
      .filter(m => m.to === mailbox)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
      .slice(0, limit)
      .map(m => structuredClone(m))
  }
  async setStatus(id: string, status: MeshStatus, at: string, note?: string) {
    const m = this.messages.get(id)
    if (!m) return false
    m.status = status
    m.statusAt = at
    if (note) m.statusNote = note
    else delete m.statusNote
    return true
  }
}

export class MockMesh implements MeshAdapter {
  private readonly store: SimMeshStore
  private readonly practices: SimPractice[]
  private readonly clock: () => Date
  constructor(store: SimMeshStore, options: { practices?: SimPractice[]; clock?: () => Date } = {}) {
    this.store = store
    this.practices = options.practices ?? PRACTICES
    this.clock = options.clock ?? (() => new Date())
  }

  async lookupMailbox(odsCode: string, workflowId: string) {
    const p = this.practices.find(x => x.odsCode === odsCode.toUpperCase())
    if (!p) return null
    if (workflowId === SEND_DOCUMENT_WORKFLOW_ID && !p.acceptsSendDocument) return null
    return meshMailboxFor(p.odsCode)
  }

  async send(m: Parameters<MeshAdapter['send']>[0]) {
    if (!this.practices.some(p => meshMailboxFor(p.odsCode) === m.to)) {
      throw new AdapterError('mesh', 'not-found', `Unknown MESH mailbox ${m.to}`)
    }
    const id = crypto.randomUUID()
    const now = this.clock().toISOString()
    await this.store.add({ ...m, id, sentAt: now, status: 'accepted', statusAt: now })
    return { messageId: id }
  }

  async status(messageId: string) {
    const m = await this.store.get(messageId)
    return m ? { status: m.status, statusAt: m.statusAt, ...(m.statusNote ? { statusNote: m.statusNote } : {}) } : null
  }
}
