import { useMemo, useState } from 'react'
import { useApi } from '../useApi'

interface SimPatientSummary {
  nhsNumber: string
  name: string
  birthDate: string
  age: number
  restricted: boolean
  deceased: boolean
  mobile: string | null
  nhsLogin: 'P9' | 'P5' | null
  practice: { odsCode: string; name: string; supplier: string; gpConnectEnabled: boolean } | null
  scenario: string
  tags: string[]
}

const formatNhs = (n: string) => `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`

function Badge({ tone, children }: { tone: 'red' | 'amber' | 'grey' | 'green'; children: React.ReactNode }) {
  const tones = {
    red: 'bg-red-50 text-red-800 ring-red-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    grey: 'bg-gray-100 text-gray-700 ring-gray-200',
    green: 'bg-green-50 text-green-800 ring-green-200',
  }
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs ring-1 ring-inset ${tones[tone]}`}>{children}</span>
}

export default function TestPatients() {
  const result = useApi<SimPatientSummary[]>('/api/sim/patients')
  const [filter, setFilter] = useState('')

  const patients = useMemo(() => {
    if (result.state !== 'ok') return []
    const q = filter.trim().toLowerCase()
    return q
      ? result.data.filter(p =>
          [p.name, p.nhsNumber, p.scenario, ...p.tags].some(s => s.toLowerCase().includes(q)),
        )
      : result.data
  }, [result, filter])

  return (
    <div>
      <h2 className="text-xl font-semibold">Synthetic test patients</h2>
      <p className="mt-1 max-w-3xl text-sm text-gray-700">
        Every patient is invented and exists to exercise one scenario. The NHS numbers are in the 999 test range
        and the mobile numbers are in Ofcom&rsquo;s reserved drama range (07700 900xxx).
      </p>

      <label className="mt-4 block text-sm">
        <span className="text-gray-700">Filter</span>
        <input
          className="mt-1 block w-full max-w-sm rounded border border-gray-300 px-3 py-2"
          placeholder="name, NHS number, scenario or tag"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </label>

      {result.state === 'loading' && <p className="mt-6 text-gray-500">Loading…</p>}
      {result.state === 'error' && <p className="mt-6 text-red-700">Could not load patients ({result.message}).</p>}

      <ul className="mt-6 grid gap-3">
        {patients.map(p => (
          <li key={p.nhsNumber} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">
                {p.name} <span className="font-normal text-gray-600">· {p.age}</span>
              </h3>
              <span className="font-mono text-sm text-gray-700">{formatNhs(p.nhsNumber)}</span>
            </div>
            <p className="mt-1 text-sm text-gray-800">{p.scenario}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.restricted && <Badge tone="red">Restricted (S-flag)</Badge>}
              {p.deceased && <Badge tone="red">Deceased</Badge>}
              {p.age < 16 && <Badge tone="red">Under 16</Badge>}
              {p.practice && !p.practice.gpConnectEnabled && <Badge tone="amber">Practice not on GP Connect</Badge>}
              {p.nhsLogin === 'P9' && <Badge tone="green">NHS login P9</Badge>}
              {p.nhsLogin === 'P5' && <Badge tone="amber">NHS login P5 only</Badge>}
              {!p.nhsLogin && <Badge tone="grey">No NHS login</Badge>}
              {p.mobile ? <Badge tone="grey">Mobile {p.mobile}</Badge> : <Badge tone="amber">No mobile on PDS</Badge>}
              {p.practice && !p.restricted && (
                <Badge tone="grey">
                  {p.practice.name} · {p.practice.supplier}
                </Badge>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
