import { api } from '../../api'

/** Starts simulated NHS login and sends the browser to the persona picker. */
export async function startNhsLogin(returnTo: string): Promise<string | null> {
  const res = await api<{ authorizationUrl: string }>('/api/patient/nhs-login/start', { body: { returnTo } })
  if (!res.ok) return res.message
  window.location.assign(res.data.authorizationUrl)
  return null
}
