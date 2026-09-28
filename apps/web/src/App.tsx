import SimulationBanner from './SimulationBanner'
import { useApiHealth } from './useApiHealth'

const personas = [
  {
    title: 'Provider clinician',
    description:
      'Find a patient, request consent, then view their GP record and send documents back to the practice.',
    step: 5,
  },
  {
    title: 'Patient',
    description:
      'Approve or decline a request with NHS login or an SMS link, see who has accessed your record, withdraw consent.',
    step: 4,
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
  return (
    <span className="text-green-700">
      online · v{health.version}
      {health.commit && ` · ${health.commit}`}
    </span>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <SimulationBanner />
      <header className="bg-brand text-white">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <h1 className="text-2xl font-bold">Private GP Connect</h1>
          <p className="mt-1 text-white/80">
            Consent-based access to GP records for independent healthcare providers — working mock-up
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <section aria-labelledby="personas" className="mb-10">
          <h2 id="personas" className="mb-4 text-lg font-semibold">
            Choose a view
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {personas.map(p => (
              <li key={p.title} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-brand">{p.title}</h3>
                  <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    Build step {p.step}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-700">{p.description}</p>
              </li>
            ))}
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
      </main>
    </div>
  )
}
