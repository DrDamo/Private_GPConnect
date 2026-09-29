import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { formatDateTime } from '../../format'
import { Button, Card, ErrorBox, Notice } from '../../ui'
import { REASON_TEXT } from './types'

interface SentDocument {
  messageId: string | null
  title: string
  sentAt: string
  sentBy: string
  status: 'accepted' | 'downloaded' | 'acknowledged' | 'rejected' | 'unknown' | 'unconfirmed'
  statusAt: string | null
  statusNote: string | null
}

const STATUS_TEXT: Record<SentDocument['status'], string> = {
  accepted: 'Delivered to the practice mailbox',
  downloaded: 'Opened by the practice',
  acknowledged: 'Filed by the practice',
  rejected: 'Rejected by the practice',
  unknown: 'Status unknown',
  unconfirmed: 'Not confirmed: it may have been sent',
}

const today = () => new Date().toISOString().slice(0, 10)
const blankMedicine = () => ({ name: '', dosageInstruction: '', quantity: '', date: today() })

export default function SendToGp({ consentId }: { consentId: string }) {
  const [kind, setKind] = useState<'supply-notification' | 'care-summary'>('supply-notification')
  const [summary, setSummary] = useState('')
  const [advice, setAdvice] = useState('')
  const [medicines, setMedicines] = useState([blankMedicine()])
  const [sent, setSent] = useState<SentDocument[] | null>(null)
  const [error, setError] = useState<{ message: string; reasons?: string[] } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await api<SentDocument[]>(`/api/provider/consents/${consentId}/documents`)
    if (r.ok) setSent(r.data)
  }, [consentId])

  useEffect(() => {
    let cancelled = false
    api<SentDocument[]>(`/api/provider/consents/${consentId}/documents`).then(r => !cancelled && r.ok && setSent(r.data))
    return () => {
      cancelled = true
    }
  }, [consentId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    const res = await api<{ title: string; practice: { name: string } }>(`/api/provider/consents/${consentId}/documents`, {
      body: {
        kind,
        summary,
        ...(advice.trim() ? { adviceForGp: advice } : {}),
        ...(kind === 'supply-notification' ? { medicines: medicines.filter(m => m.name.trim()) } : {}),
      },
    })
    setBusy(false)
    if (!res.ok) {
      setError({ message: res.message, reasons: Array.isArray(res.details.reasons) ? (res.details.reasons as string[]) : undefined })
      return
    }
    setNotice(`Sent “${res.data.title}” to ${res.data.practice.name}.`)
    setSummary('')
    setAdvice('')
    setMedicines([blankMedicine()])
    load()
  }

  const input = 'mt-1 block w-full rounded border border-gray-400 px-3 py-2'
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-700">
        Tell the patient&rsquo;s GP what you have done. It goes to the practice&rsquo;s mailbox over MESH (GP Connect Send Document) and is
        filed in the patient&rsquo;s record. For anything you prescribe or supply, this is expected.
      </p>
      {notice && <Notice>{notice}</Notice>}
      {error && (
        <ErrorBox>
          <p>{error.message}</p>
          {error.reasons?.map(r => (
            <p key={r}>{REASON_TEXT[r] ?? r}</p>
          ))}
        </ErrorBox>
      )}
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="flex flex-wrap gap-5">
            <legend className="mb-1 font-semibold">What are you sending?</legend>
            {(
              [
                ['supply-notification', 'Medicine supplied or prescribed'],
                ['care-summary', 'Summary of care (no medicine)'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name="kind" checked={kind === value} onChange={() => setKind(value)} /> {label}
              </label>
            ))}
          </fieldset>
          <label className="block">
            <span className="font-semibold">Summary</span>
            <textarea className={`${input} min-h-24`} value={summary} onChange={e => setSummary(e.target.value)} minLength={10} maxLength={4000} required />
          </label>
          {kind === 'supply-notification' && (
            <fieldset className="space-y-3">
              <legend className="font-semibold">Medicines</legend>
              <p className="text-sm text-gray-600">Write the dosage exactly as you prescribed it; it is sent as written.</p>
              {medicines.map((m, i) => (
                <div key={i} className="grid gap-2 rounded border border-gray-200 p-3 sm:grid-cols-2">
                  {(
                    [
                      ['name', 'Medicine'],
                      ['dosageInstruction', 'Dosage instruction'],
                      ['quantity', 'Quantity'],
                      ['date', 'Date'],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field} className="block text-sm">
                      {label}
                      <input
                        className={input}
                        type={field === 'date' ? 'date' : 'text'}
                        value={m[field]}
                        required={i === 0}
                        onChange={e => setMedicines(medicines.map((x, j) => (j === i ? { ...x, [field]: e.target.value } : x)))}
                      />
                    </label>
                  ))}
                </div>
              ))}
              <button type="button" className="text-sm text-brand underline" onClick={() => setMedicines([...medicines, blankMedicine()])}>
                Add another medicine
              </button>
            </fieldset>
          )}
          <label className="block">
            <span className="font-semibold">Advice for the GP (optional)</span>
            <textarea className={`${input} min-h-16`} value={advice} onChange={e => setAdvice(e.target.value)} maxLength={2000} />
          </label>
          <Button type="submit" disabled={busy}>
            Send to GP practice
          </Button>
        </form>
      </Card>

      <section>
        <h3 className="mb-2 font-semibold">Sent to the GP</h3>
        {!sent?.length ? (
          <p className="text-sm text-gray-600">Nothing sent yet.</p>
        ) : (
          <ul className="space-y-2">
            {sent.map(d => (
              <li key={d.messageId ?? `${d.sentAt}-${d.title}`}>
                <Card className="text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-semibold">{d.title}</span>
                    <span
                      className={
                        d.status === 'rejected' || d.status === 'unconfirmed' ? 'text-red-700' : d.status === 'acknowledged' ? 'text-green-700' : 'text-gray-700'
                      }
                    >
                      {STATUS_TEXT[d.status]}
                    </span>
                  </div>
                  <p className="text-gray-600">
                    Sent {formatDateTime(d.sentAt)} by {d.sentBy}
                    {d.statusNote && ` · ${d.statusNote}`}
                  </p>
                  {d.status === 'unconfirmed' && (
                    <p className="mt-1 text-red-700">
                      The send started but its result was not recorded. Check with the practice before sending again, to avoid a duplicate.
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
        <button className="mt-2 text-sm text-brand underline" onClick={load}>
          Refresh status
        </button>
      </section>
    </div>
  )
}
