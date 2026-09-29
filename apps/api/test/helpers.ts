import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

export class Browser {
  private readonly app: FastifyInstance
  constructor(app: FastifyInstance) {
    this.app = app
  }
  private jar = new Map<string, string>()
  private store(res: LightMyRequestResponse) {
    for (const c of res.cookies as Array<{ name: string; value: string; maxAge?: number; expires?: Date }>) {
      const expired = c.maxAge === 0 || (c.expires && c.expires.getTime() <= Date.now()) || c.value === ''
      if (expired) this.jar.delete(c.name)
      else this.jar.set(c.name, c.value)
    }
    return res
  }
  private get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  async get(url: string) {
    return this.store(await this.app.inject({ method: 'GET', url, headers: { cookie: this.cookie } }))
  }
  async put(url: string, payload: unknown = {}) {
    return this.store(await this.app.inject({ method: 'PUT', url, payload: payload as object, headers: { cookie: this.cookie } }))
  }
  async post(url: string, payload: unknown = {}) {
    return this.store(await this.app.inject({ method: 'POST', url, payload: payload as object, headers: { cookie: this.cookie } }))
  }
}

export async function createRequest(app: FastifyInstance, userId: string, nhsNumber: string) {
  const res = await app.inject({ method: 'POST', url: '/api/sim/consent-requests', payload: { userId, nhsNumber } })
  return res
}

export async function signInWithNhsLogin(browser: Browser, sub: string, returnTo = '/patient') {
  const start = await browser.post('/api/patient/nhs-login/start', { returnTo })
  const authUrl = new URL(start.json().authorizationUrl, 'http://x')
  const authorize = await browser.post('/api/sim/nhs-login/authorize', {
    sub,
    state: authUrl.searchParams.get('state'),
    nonce: authUrl.searchParams.get('nonce'),
    redirectUri: authUrl.searchParams.get('redirect_uri'),
  })
  const back = new URL(authorize.json().location, 'http://x')
  return browser.post('/api/patient/nhs-login/callback', { code: back.searchParams.get('code'), state: back.searchParams.get('state') })
}

export async function latestSms(app: FastifyInstance, mobile: string) {
  const res = await app.inject({ method: 'GET', url: `/api/sim/phone/${mobile}/messages` })
  return (res.json() as Array<{ body: string }>)[0]?.body ?? ''
}


/** Signs the patient in with NHS login and agrees to the request. */
export async function patientGrants(app: FastifyInstance, consentId: string, sub: string) {
  const browser = new Browser(app)
  await signInWithNhsLogin(browser, sub)
  const view = (await browser.get(`/api/patient/consents/${consentId}`)).json()
  const res = await browser.post(`/api/patient/consents/${consentId}/decision`, {
    decision: 'grant',
    consentTextVersion: view.consentTextVersion,
    consentTextHash: view.consentTextHash,
  })
  if (res.statusCode !== 200) throw new Error(`grant failed: ${res.body}`)
  return browser
}
