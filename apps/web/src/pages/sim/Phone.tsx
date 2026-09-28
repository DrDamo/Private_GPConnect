import { useEffect, useState } from 'react'
import { api } from '../../api'
import { formatDateTime } from '../../format'
import { SimNote } from '../../ui'

interface Message {
  id: string
  sentAt: string
  to: string
  body: string
}

interface PatientSummary {
  name: string
  mobile: string | null
}

const STORAGE_KEY = 'pgpc.sim.phone'

function readSaved(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Turns URLs in a message into links. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g)
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} className="break-all text-blue-700 underline" href={p}>
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

export default function Phone() {
  const [patients, setPatients] = useState<PatientSummary[]>([])
  const [mobile, setMobile] = useState(readSaved)
  const [messages, setMessages] = useState<Message[]>([])

  useEffect(() => {
    api<PatientSummary[]>('/api/sim/patients').then(r => r.ok && setPatients(r.data.filter(p => p.mobile)))
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mobile)
    } catch {
      // Remembering the choice is a convenience only.
    }
    if (!mobile) return
    let cancelled = false
    const poll = async () => {
      const r = await api<Message[]>(`/api/sim/phone/${mobile}/messages`)
      if (!cancelled && r.ok) setMessages(r.data)
    }
    poll()
    const timer = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [mobile])

  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Simulated phone</h2>
      <SimNote>Text messages the simulation “sends” appear here. Nothing is sent to a real phone. This page refreshes every 3 seconds.</SimNote>
      <label className="block max-w-sm">
        <span className="font-semibold">Whose phone?</span>
        <select className="mt-1 block w-full rounded border border-gray-400 px-3 py-2" value={mobile} onChange={e => setMobile(e.target.value)}>
          <option value="">Choose a synthetic patient…</option>
          {patients.map(p => (
            <option key={p.mobile} value={p.mobile!}>
              {p.name} · {p.mobile}
            </option>
          ))}
        </select>
      </label>

      {mobile && (
        <div className="mx-auto w-full max-w-sm rounded-[2rem] border-8 border-gray-800 bg-gray-100 shadow-lg">
          <div className="rounded-t-[1.5rem] bg-gray-800 py-2 text-center text-xs text-gray-300">Messages · {mobile}</div>
          <ol className="flex min-h-80 flex-col-reverse gap-3 p-4">
            {messages.length === 0 && <li className="text-center text-sm text-gray-500">No messages</li>}
            {messages.map(m => (
              <li key={m.id} className="max-w-[90%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm shadow">
                <Linkified text={m.body} />
                <div className="mt-1 text-right text-[10px] text-gray-500">{formatDateTime(m.sentAt)}</div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
