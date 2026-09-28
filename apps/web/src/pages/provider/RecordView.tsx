import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { formatDate, formatDateTime } from '../../format'
import Link from '../../Link'
import { ErrorBox, SimNote } from '../../ui'
import ProviderFrame from './ProviderFrame'
import StructuredView from './StructuredView'
import { REASON_TEXT, type ConsentSummary } from './types'

interface SectionResponse {
  section: string
  title: string
  html: string
  generatedAt: string | null
  practice: { odsCode: string; name: string; supplier: string }
  placeholder: boolean
  viewedBy: string
  viewedAt: string
  exchange: { url: string; headers: Record<string, string>; jwtClaims: unknown; body: unknown }
}

// Styles for GP-supplied HTML, rendered in a sandboxed iframe: no scripts, no
// same-origin access, so even hostile markup could not reach this page.
const FRAME_CSS = `
  body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111827; margin: 12px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 16px; margin: 20px 0 6px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
  th, td { border: 1px solid #d1d5db; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  .exclusion-banner { background: #fef3c7; border-left: 4px solid #b45309; padding: 4px 10px; margin: 8px 0; }
  p { margin: 4px 0; }
`

function Frame({ html }: { html: string }) {
  const doc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_CSS}</style></head><body>${html}</body></html>`, [html])
  return <iframe title="GP record section" sandbox="" srcDoc={doc} className="h-[65vh] w-full rounded border border-gray-300 bg-white" />
}

function Content({ consentId }: { consentId: string }) {
  const [consent, setConsent] = useState<ConsentSummary | null>(null)
  const [section, setSection] = useState<string | null>(null)
  const [mode, setMode] = useState<'html' | 'structured'>('html')
  const [result, setResult] = useState<{ section: string; data?: SectionResponse; error?: { message: string; reasons?: string[] } } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    api<ConsentSummary>(`/api/provider/consents/${consentId}`).then(r => {
      if (!r.ok) return setLoadError(r.message)
      setConsent(r.data)
      setSection(r.data.htmlSections[0]?.code ?? null)
    })
  }, [consentId])

  useEffect(() => {
    if (!section) return
    let cancelled = false
    api<SectionResponse>(`/api/provider/consents/${consentId}/html/${section}`).then(r => {
      if (cancelled) return
      if (r.ok) setResult({ section, data: r.data })
      else setResult({ section, error: { message: r.message, reasons: Array.isArray(r.details.reasons) ? (r.details.reasons as string[]) : undefined } })
    })
    return () => {
      cancelled = true
    }
  }, [consentId, section])

  // Derived: the response on screen belongs to the section that is selected.
  const loading = section !== null && result?.section !== section
  const data = loading ? null : (result?.data ?? null)
  const error = loading ? null : (result?.error ?? null)

  if (!consent) return loadError ? <ErrorBox>{loadError}</ErrorBox> : <p className="text-gray-600">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">GP record: {consent.patientName ?? consent.nhsNumber}</h2>
        <Link className="text-brand underline" href={`/provider/patient/${consent.nhsNumber}`}>
          Back to patient
        </Link>
      </div>
      <p className="text-sm text-gray-700">
        Consent until {formatDate(consent.expiresAt)} · {consent.purpose}. Every view is logged and visible to the patient.
      </p>

      {consent.scope.actions.includes('structured.retrieve') && (
        <div className="flex gap-4 border-b border-gray-300" role="tablist">
          {(['html', 'structured'] as const).map(m => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`-mb-px border-b-2 px-1 pb-2 font-semibold ${mode === m ? 'border-brand text-brand' : 'border-transparent text-gray-600'}`}
            >
              {m === 'html' ? 'View record' : 'Structured data'}
            </button>
          ))}
        </div>
      )}

      {mode === 'structured' ? (
        <StructuredView consentId={consentId} />
      ) : (
        <>
      <nav className="flex flex-wrap gap-2" aria-label="Record sections">
        {consent.htmlSections.map(s => (
          <button
            key={s.code}
            onClick={() => setSection(s.code)}
            aria-current={section === s.code ? 'page' : undefined}
            className={`rounded px-3 py-1.5 text-sm ${section === s.code ? 'bg-brand text-white' : 'bg-white ring-1 ring-gray-300 hover:bg-gray-50'}`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {loading && <p className="text-gray-600">Retrieving from the GP system…</p>}
      {error && (
        <ErrorBox>
          <p>{error.message}</p>
          {error.reasons?.map(r => (
            <p key={r}>{REASON_TEXT[r] ?? r}</p>
          ))}
        </ErrorBox>
      )}

      {data && !loading && (
        <>
          {data.placeholder && <SimNote>Placeholder HTML generated by the simulator. Real GP Connect dummy examples will replace it.</SimNote>}
          <div className="relative">
            <Frame html={data.html} />
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
              <span className="-rotate-12 select-none whitespace-nowrap text-3xl font-bold text-gray-400/25">
                {data.viewedBy} · {formatDateTime(data.viewedAt)} · SIMULATION
              </span>
            </div>
          </div>
          <p className="text-xs text-gray-600">
            From {data.practice.name} ({data.practice.supplier}) · generated {data.generatedAt ? formatDateTime(data.generatedAt) : 'unknown'}
          </p>
          <details className="rounded border border-gray-300 bg-white p-3 text-sm">
            <summary className="cursor-pointer font-semibold">Technical: what was sent to the GP system</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify({ url: data.exchange.url, headers: data.exchange.headers, jwtClaims: data.exchange.jwtClaims, body: data.exchange.body }, null, 2)}
            </pre>
          </details>
        </>
      )}
        </>
      )}
    </div>
  )
}

export default function RecordView({ consentId }: { consentId: string }) {
  return <ProviderFrame>{() => <Content consentId={consentId} />}</ProviderFrame>
}
