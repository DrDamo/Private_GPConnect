// MESH (Message Exchange for Social care and Health): store-and-forward
// messaging to organisations' mailboxes. GP Connect Send Document travels over
// it. Ref: https://digital.nhs.uk/services/message-exchange-for-social-care-and-health-mesh

export type MeshStatus = 'accepted' | 'downloaded' | 'acknowledged' | 'rejected'

export interface MeshMessage {
  id: string
  sentAt: string
  from: string
  to: string
  workflowId: string
  /** Sender's own reference (we use the consent id). */
  localId: string
  subject: string
  contentType: string
  content: unknown
  status: MeshStatus
  statusAt: string
  /** Business acknowledgement from the recipient, e.g. "Filed in patient record". */
  statusNote?: string
}

export interface MeshAdapter {
  /** Mailbox for an organisation and workflow, or null if it doesn't accept it. */
  lookupMailbox(odsCode: string, workflowId: string): Promise<string | null>
  send(message: { from: string; to: string; workflowId: string; localId: string; subject: string; contentType: string; content: unknown }): Promise<{ messageId: string }>
  status(messageId: string): Promise<{ status: MeshStatus; statusAt: string; statusNote?: string } | null>
}
