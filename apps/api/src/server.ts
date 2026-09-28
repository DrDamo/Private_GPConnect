// Local development entry point. On Vercel the app is served by vercel.ts.
import { buildApp } from './app'

const port = Number(process.env.PORT ?? 3001)
const app = await buildApp({ logger: true })
await app.listen({ port, host: '127.0.0.1' })
