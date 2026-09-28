// Formatting helpers shared by pages.

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Wording for patients. */
export const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Waiting for your answer', tone: 'bg-amber-100 text-amber-900' },
  active: { label: 'Agreed', tone: 'bg-green-100 text-green-900' },
  declined: { label: 'Declined', tone: 'bg-gray-200 text-gray-800' },
  withdrawn: { label: 'Withdrawn', tone: 'bg-gray-200 text-gray-800' },
  expired: { label: 'Expired', tone: 'bg-gray-200 text-gray-800' },
}

/** Wording for provider staff. */
export const PROVIDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for patient',
  active: 'Consent given',
  declined: 'Declined by patient',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
}
