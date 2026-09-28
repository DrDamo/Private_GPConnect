import SimulationBanner from './SimulationBanner'
import Home from './pages/Home'
import TestPatients from './pages/TestPatients'
import Link from './Link'
import { usePath } from './router'

const routes: Record<string, () => React.JSX.Element> = {
  '/': Home,
  '/test-patients': TestPatients,
}

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
  const path = usePath()
  const Page = routes[path.replace(/\/+$/, '') || '/'] ?? NotFound

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <SimulationBanner />
      <header className="bg-brand text-white">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <h1 className="text-2xl font-bold">
            <Link href="/">Private GP Connect</Link>
          </h1>
          <p className="mt-1 text-white/80">
            Consent-based access to GP records for independent healthcare providers — working mock-up
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Page />
      </main>
    </div>
  )
}
