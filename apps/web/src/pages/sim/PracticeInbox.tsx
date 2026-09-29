import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { formatDateTime } from '../../format'
import { Button, Card, ErrorBox, SimNote } from '../../ui'

interface Practice {
  odsCode: string
  name: string
  supplier: string
  mailbox: string
  acceptsSendDocument: boolean
}

interface InboxItem {
  id: string
  sentAt: string
  subject: string
  senderName: string
  nhsNumber: string | null
  status: string
  statusNote: string | null
}

interface OpenedItem extends InboxItem {
  title: string
  html: string
  bundle: unknown
}

const FRAME_CSS = `
  body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111827; margin: 12px; }
  h1 { font-size: 20px; margin: 0 0 12px; } h2 { font-size: 16px; margin: 18px 0 6px; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #d1d5db; padding: 4px 8px; text-align: left; } th { background: #f3f4f6; }
`

// What the receiving GP practice sees: stands in for the practice's GP system
// workflow (documents arriving over MESH, to be read and filed).
export default function PracticeInbox() {
  const [practices, setPractices] = useState<Practice[]>([])
  const [ods, setOds] = useState('SIMGP1')
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [opened, setOpened] = useState<OpenedItem | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Practice[]>('/api/sim/practices').then(r => r.ok && setPractices(r.data))
  }, [])

  const load = useCallback(async () => {
    const r = await api<InboxItem[]>(`/api/sim/practices/${ods}/inbox`)
    if (r.ok) setItems(r.data)
    else setError(r.message)
  }, [ods])

  useEffect(() => {
    let cancelled = false
    api<InboxItem[]>(`/api/sim/practices/${ods}/inbox`).then(r => {
      if (cancelled) return
      if (r.ok) setItems(r.data)
      else setError(r.message)
    })
    return () => {
      cancelled = true
    }
  }, [ods])

  async function open(id: string) {
    const r = await api<OpenedItem>(`/api/sim/practices/${ods}/inbox/${id}`)
    if (r.ok) {
      setOpened(r.data)
      load()
    } else setError(r.message)
  }

  async function acknowledge(action: 'file' | 'reject') {
    if (!opened) return
    const r = await api<InboxItem>(`/api/sim/practices/${ods}/inbox/${opened.id}/acknowledge`, {
      body: action === 'reject' ? { action, reason: 'Not registered here' } : { action },
    })
    if (r.ok) {
      setOpened({ ...opened, ...r.data })
      load()
    } else setError(r.message)
  }

  const doc = useMemo(
    () => (opened ? `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_CSS}</style></head><body>${opened.html}</body></html>` : ''),
    [opened],
  )
  const practice = practices.find(p => p.odsCode === ods)

  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">GP practice inbox</h2>
      <SimNote>
        What a GP practice receives through GP Connect Send Document over MESH. In reality this arrives in the practice&rsquo;s GP system
        workflow; here you can read it and file or reject it, and the provider sees the status.
      </SimNote>
      <label className="block max-w-md">
        <span className="font-semibold">Practice</span>
        <select
          className="mt-1 block w-full rounded border border-gray-400 px-3 py-2"
          value={ods}
          onChange={e => {
            setOds(e.target.value)
            setOpened(null)
          }}
        >
          {practices.map(p => (
            <option key={p.odsCode} value={p.odsCode}>
              {p.name} ({p.supplier}){p.acceptsSendDocument ? '' : ': does not accept Send Document'}
            </option>
          ))}
        </select>
      </label>
      {practice && <p className="text-sm text-gray-600">MESH mailbox {practice.mailbox}</p>}
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section>
          <h3 className="mb-2 font-semibold">Received</h3>
          {!items?.length ? (
            <p className="text-sm text-gray-600">No documents.</p>
          ) : (
            <ul className="space-y-2">
              {items.map(i => (
                <li key={i.id}>
                  <button className="w-full text-left" onClick={() => open(i.id)}>
                    <Card className={`text-sm hover:border-brand ${opened?.id === i.id ? 'border-brand' : ''}`}>
                      <div className="font-semibold">{i.subject}</div>
                      <div className="text-gray-700">
                        {i.senderName} · NHS {i.nhsNumber}
                      </div>
                      <div className="text-gray-600">
                        {formatDateTime(i.sentAt)} · {i.status}
                        {i.status === 'accepted' && <span className="ml-1 rounded bg-amber-100 px-1.5 text-amber-900">new</span>}
                      </div>
                    </Card>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          {opened ? (
            <div className="space-y-3">
              <iframe title="Received document" sandbox="" srcDoc={doc} className="h-[55vh] w-full rounded border border-gray-300 bg-white" />
              {['accepted', 'downloaded'].includes(opened.status) ? (
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => acknowledge('file')}>File in patient record</Button>
                  <Button variant="secondary" onClick={() => acknowledge('reject')}>
                    Reject (not registered here)
                  </Button>
                </div>
              ) : (
                <p className="text-sm font-semibold">{opened.statusNote ?? opened.status}</p>
              )}
              <details className="rounded border border-gray-300 bg-white p-3 text-sm">
                <summary className="cursor-pointer font-semibold">Technical: the FHIR message received</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(opened.bundle, null, 2)}</pre>
              </details>
            </div>
          ) : (
            <p className="text-sm text-gray-600">Choose a document to read it.</p>
          )}
        </section>
      </div>
    </div>
  )
}
