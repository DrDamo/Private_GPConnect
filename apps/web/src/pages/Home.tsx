import Link from '../Link'
import { useApiHealth } from '../useApiHealth'

const personas: Array<{ title: string; description: string; step: number; href?: string }> = [
  {
    title: 'Provider clinician',
    description:
      'Find a patient, request consent, then view their GP record and send documents back to the practice.',
    step: 5,
  },
  {
    title: 'Patient',
    description:
      'Approve or decline a request with NHS login or a text message code, see who has accessed your record, withdraw consent.',
    step: 4,
    href: '/patient',
  },
  {
    title: 'Admin & audit',
    description: 'Tamper-evident audit trail, consent register, provider organisations and fault injection.',
    step: 8,
  },
  {
    title: 'GP practice inbox',
    description: 'What the practice receives through GP Connect Send Document (simulated MESH).',
    step: 7,
  },
]

function ApiStatus() {
  const health = useApiHealth()
  if (health.state === 'loading') return <span className="text-gray-500">checking…</span>
  if (health.state === 'error') return <span className="text-red-700">unavailable ({health.message})</span>
  const h = health.data
  return (
    <span className={h.status === 'ok' ? 'text-green-700' : 'text-amber-700'}>
      {h.status} · v{h.version}
      {h.commit && ` · ${h.commit}`} · store: {h.store}
      {h.database !== 'ok' && ' · database unavailable'}
    </span>
  )
}

export default function Home() {
  return (
    <>
      <section aria-labelledby="personas" className="mb-10">
        <h2 id="personas" className="mb-4 text-lg font-semibold">
          Choose a view
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {personas.map(p => (
            <li key={p.title} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-brand">
                  {p.href ? (
                    <Link className="underline" href={p.href}>
                      {p.title}
                    </Link>
                  ) : (
                    p.title
                  )}
                </h3>
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${p.href ? 'bg-green-100 text-green-900' : 'bg-gray-100 text-gray-600'}`}>
                  {p.href ? 'Available' : `Build step ${p.step}`}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-700">{p.description}</p>
            </li>
          ))}
          <li className="rounded-lg border border-brand/30 bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-brand">
              <Link className="underline" href="/sim/request">
                Try it: send a consent request
              </Link>
            </h3>
            <p className="mt-2 text-sm text-gray-700">
              Act as a simulated clinician, ask a synthetic patient for consent, then follow the text message on the simulated
              phone.
            </p>
          </li>
          <li className="rounded-lg border border-brand/30 bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-brand">
              <Link className="underline" href="/test-patients">
                Synthetic test patients
              </Link>
            </h3>
            <p className="mt-2 text-sm text-gray-700">
              The invented patients the simulation uses, and the scenario each one exercises.
            </p>
          </li>
        </ul>
      </section>

      <section aria-labelledby="developers" className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 id="developers" className="font-semibold">
          For developers
        </h2>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-gray-600">API status</dt>
          <dd>
            <ApiStatus />
          </dd>
          <dt className="text-gray-600">API documentation</dt>
          <dd>
            <a className="text-brand underline" href="/api-docs/">
              OpenAPI / Swagger UI
            </a>
          </dd>
        </dl>
      </section>
    </>
  )
}
