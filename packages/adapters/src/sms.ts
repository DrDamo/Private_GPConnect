// Outbound SMS (in production, e.g. GOV.UK Notify).
// Ref: https://www.notifications.service.gov.uk/

export interface SmsAdapter {
  send(message: { to: string; body: string; reference?: string }): Promise<{ messageId: string }>
}
