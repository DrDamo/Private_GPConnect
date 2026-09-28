import SimulationBanner from './SimulationBanner'
import Link from './Link'
import Home from './pages/Home'
import TestPatients from './pages/TestPatients'
import Callback from './pages/patient/Callback'
import ConsentReview from './pages/patient/ConsentReview'
import PatientHome from './pages/patient/PatientHome'
import PatientPage from './pages/provider/PatientPage'
import ProviderHome from './pages/provider/ProviderHome'
import RecordView from './pages/provider/RecordView'
import DemoRequest from './pages/sim/DemoRequest'
import NhsLoginSim from './pages/sim/NhsLoginSim'
import Phone from './pages/sim/Phone'
import { useLocation } from './router'

type Route = [RegExp, (params: string[]) => React.JSX.Element]

const routes: Route[] = [
  [/^\/$/, () => <Home />],
  [/^\/test-patients$/, () => <TestPatients />],
  [/^\/patient$/, () => <PatientHome />],
  [/^\/patient\/callback$/, () => <Callback />],
  [/^\/patient\/consent\/([0-9a-fA-F-]{36})$/, ([id]) => <ConsentReview key={id} id={id} />],
  [/^\/provider$/, () => <ProviderHome />],
  [/^\/provider\/patient\/(\d{10})$/, ([n]) => <PatientPage key={n} nhsNumber={n} />],
  [/^\/provider\/record\/([0-9a-fA-F-]{36})$/, ([id]) => <RecordView key={id} consentId={id} />],
  [/^\/sim\/nhs-login$/, () => <NhsLoginSim />],
  [/^\/sim\/phone$/, () => <Phone />],
  [/^\/sim\/request$/, () => <DemoRequest />],
]

function NotFound() {
  return (
    <p>
      Page not found.{' '}
      <Link className="text-brand underline" href="/">
        Go home
      </Link>
    </p>
  )
}

export default function App() {
  const { path } = useLocation()
  const normalised = path.replace(/\/+$/, '') || '/'
  let page = <NotFound />
  for (const [pattern, render] of routes) {
    const m = pattern.exec(normalised)
    if (m) {
      page = render(m.slice(1))
      break
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <SimulationBanner />
      <header className="bg-brand text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-2 px-4 py-5">
          <div>
            <h1 className="text-2xl font-bold">
              <Link href="/">Private GP Connect</Link>
            </h1>
            <p className="mt-1 text-white/80">Consent-based access to GP records for independent healthcare providers — working mock-up</p>
          </div>
          <nav className="flex gap-4 text-sm">
            <Link className="underline" href="/provider">
              Provider
            </Link>
            <Link className="underline" href="/patient">
              Patient
            </Link>
            <Link className="underline" href="/sim/request">
              Demo request
            </Link>
            <Link className="underline" href="/sim/phone">
              Phone
            </Link>
            <Link className="underline" href="/test-patients">
              Test patients
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{page}</main>
    </div>
  )
}
