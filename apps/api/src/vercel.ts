// Vercel serverless entry point. scripts/build-vercel.mjs bundles this file
// into a single Node function; Vercel routes every /api/* request to it.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildApp } from './app'

const appPromise = buildApp().then(async app => {
  await app.ready()
  return app
})

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await appPromise
  app.server.emit('request', req, res)
}
